// ============================================================
//  calendar.js — Team calendar for absences and scheduling
//
//  Firestore path: calendar_events/{autoId}
//  Fields: date, endDate, person, type, title, note, allDay
// ============================================================

import {
  db,
  collection, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, doc
} from './firebase.js';
import { Toast } from './constants.js';

// Team members — eventually pull from Firestore users collection
const TEAM = ['Gonzalez','Manchester','Cameron G.','All Staff'];

const EVENT_TYPES = [
  { value: 'absent',    label: 'Absent',       color: '#ef4444', bg: '#fef2f2', border: '#fecaca' },
  { value: 'pto',       label: 'PTO',           color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  { value: 'auction',   label: 'Auction',       color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  { value: 'meeting',   label: 'Meeting',       color: '#7c3aed', bg: '#faf5ff', border: '#ddd6fe' },
  { value: 'schedule',  label: 'Schedule Note', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  { value: 'other',     label: 'Other',         color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
];

function typeConfig(value) {
  return EVENT_TYPES.find(t => t.value === value) || EVENT_TYPES[EVENT_TYPES.length - 1];
}

// Escape HTML to prevent XSS from user-entered event data
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const Calendar = {

  events:      [],
  year:        new Date().getFullYear(),
  month:       new Date().getMonth(), // 0-indexed
  selectedDay: null,

  render(container) {
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }

    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="page-title">Team Calendar</div>
          <div class="page-sub">Track absences, PTO, auctions, and team schedule.</div>
        </div>
        <button class="cal-add-btn" id="cal-add-btn">+ Add event</button>
      </div>

      <div class="cal-wrap">
        <!-- Calendar grid -->
        <div class="cal-main">
          <div class="cal-nav">
            <button class="cal-nav-btn" id="cal-prev">‹</button>
            <div class="cal-month-label" id="cal-month-label"></div>
            <button class="cal-nav-btn" id="cal-next">›</button>
            <button class="cal-today-btn" id="cal-today">Today</button>
          </div>
          <div class="cal-grid-wrap">
            <div class="cal-dow-row">
              ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d =>
                `<div class="cal-dow">${d}</div>`
              ).join('')}
            </div>
            <div class="cal-grid" id="cal-grid"></div>
          </div>
        </div>

        <!-- Sidebar: legend + upcoming -->
        <div class="cal-sidebar">
          <div class="cal-legend-title">Event types</div>
          <div class="cal-legend">
            ${EVENT_TYPES.map(t => `
              <div class="cal-legend-item">
                <span class="cal-legend-dot" style="background:${t.color}"></span>
                ${t.label}
              </div>`).join('')}
          </div>

          <div class="cal-legend-title" style="margin-top:20px">Upcoming</div>
          <div id="cal-upcoming"></div>
        </div>
      </div>

      <!-- Event modal -->
      <div id="cal-modal-overlay" class="cal-modal-overlay hidden" onclick="Calendar._closeModal()">
        <div class="cal-modal" onclick="event.stopPropagation()">
          <div class="cal-modal-header">
            <div class="cal-modal-title" id="cal-modal-title">Add event</div>
            <button class="cal-modal-close" onclick="Calendar._closeModal()">✕</button>
          </div>
          <div class="cal-modal-body" id="cal-modal-body"></div>
        </div>
      </div>
    `;

    document.getElementById('cal-prev').addEventListener('click', () => {
      this.month--;
      if (this.month < 0) { this.month = 11; this.year--; }
      this.renderGrid();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      this.month++;
      if (this.month > 11) { this.month = 0; this.year++; }
      this.renderGrid();
    });
    document.getElementById('cal-today').addEventListener('click', () => {
      this.year  = new Date().getFullYear();
      this.month = new Date().getMonth();
      this.renderGrid();
    });
    document.getElementById('cal-add-btn').addEventListener('click', () => {
      this.openEventModal();
    });

    // Make _closeModal available globally for inline onclick
    window.Calendar = this;

    this.subscribeFirestore();
  },

  subscribeFirestore() {
    const q = query(collection(db, 'calendar_events'), orderBy('date', 'asc'));
    this._unsubscribe = onSnapshot(q,
      snapshot => {
        this.events = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        this.renderGrid();
        this.renderUpcoming();
      },
      err => {
        console.error('Calendar Firestore error:', err);
        Toast.show('Could not load calendar', 'error');
      }
    );
  },

  // ---- Grid --------------------------------------------------
  renderGrid() {
    const label = document.getElementById('cal-month-label');
    const grid  = document.getElementById('cal-grid');
    if (!label || !grid) return;

    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    label.textContent = `${monthNames[this.month]} ${this.year}`;

    const firstDay  = new Date(this.year, this.month, 1).getDay();
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    const today     = new Date();
    const todayStr  = this.dateStr(today.getFullYear(), today.getMonth(), today.getDate());

    let html = '';

    // Leading empty cells
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="cal-cell cal-cell-empty"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr  = this.dateStr(this.year, this.month, d);
      const dayEvents = this.eventsOnDate(dateStr);
      const isToday  = dateStr === todayStr;
      const isWeekend = (firstDay + d - 1) % 7 === 0 || (firstDay + d - 1) % 7 === 6;

      html += `
        <div class="cal-cell${isToday ? ' cal-today' : ''}${isWeekend ? ' cal-weekend' : ''}"
             onclick="Calendar._dayClick('${dateStr}')">
          <div class="cal-cell-num${isToday ? ' cal-today-num' : ''}">${d}</div>
          <div class="cal-cell-events">
            ${dayEvents.slice(0, 3).map(e => {
              const tc = typeConfig(e.type);
              return `<div class="cal-event-chip"
                style="background:${tc.bg};color:${tc.color};border-color:${tc.border}"
                title="${e.person}: ${e.title}">${e.person} — ${e.title}</div>`;
            }).join('')}
            ${dayEvents.length > 3 ? `<div class="cal-event-more">+${dayEvents.length - 3} more</div>` : ''}
          </div>
        </div>`;
    }

    // Trailing empty cells to complete the last row
    const totalCells = firstDay + daysInMonth;
    const remainder  = totalCells % 7;
    if (remainder !== 0) {
      for (let i = 0; i < 7 - remainder; i++) {
        html += `<div class="cal-cell cal-cell-empty"></div>`;
      }
    }

    grid.innerHTML = html;
  },

  renderUpcoming() {
    const el = document.getElementById('cal-upcoming');
    if (!el) return;

    const todayStr = this.dateStr(
      new Date().getFullYear(), new Date().getMonth(), new Date().getDate()
    );

    const upcoming = this.events
      .filter(e => e.date >= todayStr)
      .slice(0, 8);

    if (!upcoming.length) {
      el.innerHTML = `<div style="font-size:12px;color:var(--text-4);padding:8px 0">No upcoming events</div>`;
      return;
    }

    el.innerHTML = upcoming.map(e => {
      const tc = typeConfig(e.type);
      return `
        <div class="cal-upcoming-item" onclick="Calendar._editEvent('${e.id}')">
          <div class="cal-upcoming-dot" style="background:${tc.color}"></div>
          <div class="cal-upcoming-info">
            <div class="cal-upcoming-title">${esc(e.title)}</div>
            <div class="cal-upcoming-meta">${esc(e.person)} · ${this.formatDate(e.date)}</div>
          </div>
        </div>`;
    }).join('');
  },

  // ---- Event helpers -----------------------------------------
  eventsOnDate(dateStr) {
    return this.events.filter(e => {
      if (!e.endDate || e.endDate === e.date) return e.date === dateStr;
      return dateStr >= e.date && dateStr <= e.endDate;
    });
  },

  dateStr(y, m, d) {
    return `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  },

  formatDate(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[parseInt(m)-1]} ${parseInt(d)}, ${y}`;
  },

  // ---- Modal -------------------------------------------------
  _dayClick(dateStr) {
    this.openEventModal({ date: dateStr });
  },

  _editEvent(id) {
    const e = this.events.find(ev => ev.id === id);
    if (e) this.openEventModal(e);
  },

  _closeModal() {
    document.getElementById('cal-modal-overlay').classList.add('hidden');
  },

  openEventModal(prefill = {}) {
    const isEdit = !!prefill.id;
    document.getElementById('cal-modal-title').textContent = isEdit ? 'Edit event' : 'Add event'; // textContent is safe
    document.getElementById('cal-modal-overlay').classList.remove('hidden');

    document.getElementById('cal-modal-body').innerHTML = `
      <div class="cal-form">
        <div class="cal-form-row two">
          <div class="cal-form-group">
            <label>Person</label>
            <select id="cf-person">
              ${TEAM.map(p => `<option ${(prefill.person||'')===p?'selected':''}>${p}</option>`).join('')}
            </select>
          </div>
          <div class="cal-form-group">
            <label>Type</label>
            <select id="cf-type">
              ${EVENT_TYPES.map(t => `<option value="${t.value}" ${(prefill.type||'absent')===t.value?'selected':''}>${t.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="cal-form-row one">
          <div class="cal-form-group">
            <label>Title / description</label>
            <input type="text" id="cf-title" value="${esc(prefill.title||'')}" placeholder="e.g. Out sick, Manheim auction, Team meeting">
          </div>
        </div>
        <div class="cal-form-row two">
          <div class="cal-form-group">
            <label>Start date</label>
            <input type="date" id="cf-date" value="${prefill.date||this.dateStr(this.year, this.month, new Date().getDate())}">
          </div>
          <div class="cal-form-group">
            <label>End date <span style="color:var(--text-4);font-weight:400">(optional)</span></label>
            <input type="date" id="cf-enddate" value="${prefill.endDate||''}">
          </div>
        </div>
        <div class="cal-form-row one">
          <div class="cal-form-group">
            <label>Notes <span style="color:var(--text-4);font-weight:400">(optional)</span></label>
            <textarea id="cf-note" placeholder="Any additional details…">${esc(prefill.note||'')}</textarea>
          </div>
        </div>
        <div class="cal-form-actions">
          <button class="btn-save" id="cf-save">${isEdit ? 'Save changes' : 'Add event'}</button>
          ${isEdit ? `<button class="btn-delete" id="cf-delete">Delete</button>` : ''}
          <button class="btn-ghost" onclick="Calendar._closeModal()">Cancel</button>
        </div>
      </div>
    `;

    document.getElementById('cf-save').addEventListener('click', () => {
      this.saveEvent(prefill.id || null);
    });
    if (isEdit) {
      document.getElementById('cf-delete').addEventListener('click', () => {
        this.deleteEvent(prefill.id);
      });
    }
  },

  async saveEvent(id) {
    const title  = document.getElementById('cf-title').value.trim();
    const date   = document.getElementById('cf-date').value;
    const person = document.getElementById('cf-person').value;

    if (!title)  { Toast.show('Title is required', 'error');      return; }
    if (!date)   { Toast.show('Start date is required', 'error'); return; }
    if (!person) { Toast.show('Select a person', 'error');        return; }

    const payload = {
      person,
      type:    document.getElementById('cf-type').value,
      title,
      date,
      endDate: document.getElementById('cf-enddate').value || date,
      note:    document.getElementById('cf-note').value.trim(),
    };

    try {
      if (id) {
        await updateDoc(doc(db, 'calendar_events', id), payload);
        Toast.show('Event updated', 'success');
      } else {
        await addDoc(collection(db, 'calendar_events'), {
          ...payload,
          createdAt: new Date().toISOString(),
        });
        Toast.show('Event added', 'success');
      }
      this._closeModal();
    } catch(e) {
      console.error(e);
      Toast.show('Save failed', 'error');
    }
  },

  async deleteEvent(id) {
    if (!confirm('Delete this event?')) return;
    try {
      await deleteDoc(doc(db, 'calendar_events', id));
      Toast.show('Event deleted');
      this._closeModal();
    } catch(e) {
      console.error(e);
      Toast.show('Delete failed', 'error');
    }
  },
};

export default Calendar;
