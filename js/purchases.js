// ============================================================
//  purchases.js — Purchases page with Firestore persistence
//
//  Firestore path: purchases/{autoId}
//  Real-time listener via onSnapshot
// ============================================================

import {
  db,
  collection, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, doc
} from './firebase.js';
import { STORES, SOURCES, BUYERS, Toast } from './app.js';

let unsubscribe = null; // hold Firestore listener so we can detach on navigate away

const Purchases = {

  records:      [],
  expandedId:   null,
  sortCol:      'date',
  sortDir:      -1,
  filterStore:  '',
  filterSource: '',
  filterBuyer:  '',
  searchQ:      '',

  // ---- Render ------------------------------------------------
  render(container) {
    // Detach any previous listener
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    container.innerHTML = `
      <div class="page-header">
        <div class="page-title">All Purchases</div>
        <div class="page-sub">Log and track every vehicle acquisition.</div>
      </div>

      <div class="quick-add">
        <div class="quick-add-label">Quick add</div>
        <div class="quick-add-fields">
          <div class="qa-group"><label>Date</label>
            <input type="date" id="qa-date" value="${today()}"></div>
          <div class="qa-group"><label>Stock #</label>
            <input type="text" id="qa-stock" placeholder="Z3490" autocomplete="off"></div>
          <div class="qa-group"><label>Year</label>
            <input type="number" id="qa-year" placeholder="${new Date().getFullYear()}" min="1990" max="2035" style="-moz-appearance:textfield"></div>
          <div class="qa-group"><label>Make</label>
            <input type="text" id="qa-make" placeholder="Toyota" autocomplete="off"></div>
          <div class="qa-group"><label>Model</label>
            <input type="text" id="qa-model" placeholder="Tacoma" autocomplete="off"></div>
          <div class="qa-group"><label>VIN</label>
            <input type="text" id="qa-vin" placeholder="17-char VIN" maxlength="17" autocomplete="off" style="text-transform:uppercase"></div>
          <div class="qa-group"><label>Source</label>
            <select id="qa-source">${SOURCES.map(s=>`<option>${s}</option>`).join('')}</select></div>
          <div class="qa-group"><label>Store</label>
            <select id="qa-store">
              <option value="">— Store —</option>
              ${STORES.map(s=>`<option>${s}</option>`).join('')}
            </select></div>
          <div class="qa-group"><label>Buyer</label>
            <select id="qa-buyer">
              <option value="">— Buyer —</option>
              ${BUYERS.map(b=>`<option>${b}</option>`).join('')}
            </select></div>
          <button class="qa-submit" id="qa-submit">Add</button>
        </div>
      </div>

      <div class="filter-bar">
        <input type="text" id="p-search" placeholder="Search stock #, VIN, make, model…" value="${this.searchQ}">
        <select id="p-store">
          <option value="">All stores</option>
          ${STORES.map(s=>`<option value="${s}" ${this.filterStore===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <select id="p-source">
          <option value="">All sources</option>
          ${SOURCES.map(s=>`<option value="${s}" ${this.filterSource===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <select id="p-buyer">
          <option value="">All buyers</option>
          ${BUYERS.map(b=>`<option value="${b}" ${this.filterBuyer===b?'selected':''}>${b}</option>`).join('')}
        </select>
        <span class="record-count" id="p-count"></span>
      </div>

      <div class="p-card">
        <table class="p-table">
          <thead><tr>
            <th style="width:28px"></th>
            <th data-col="date">Date</th>
            <th data-col="stock">Stock #</th>
            <th data-col="year">Year</th>
            <th data-col="make">Make</th>
            <th data-col="model">Model</th>
            <th>VIN</th>
            <th data-col="source">Source</th>
            <th data-col="store">Store</th>
            <th data-col="buyer">Buyer</th>
          </tr></thead>
          <tbody id="p-tbody">
            <tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-4)">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    `;

    this.bindQuickAdd();
    this.bindFilters();
    this.bindTableSort();
    this.subscribeFirestore();
  },

  // ---- Firestore real-time listener --------------------------
  subscribeFirestore() {
    const q = query(collection(db, 'purchases'), orderBy('date', 'desc'));
    unsubscribe = onSnapshot(q,
      snapshot => {
        this.records = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        this.renderRows();
      },
      err => {
        console.error('Firestore error:', err);
        Toast.show('Could not load purchases', 'error');
      }
    );
  },

  // ---- Quick add to Firestore --------------------------------
  async submitQuickAdd() {
    const stock  = document.getElementById('qa-stock').value.trim();
    const store  = document.getElementById('qa-store').value;
    const buyer  = document.getElementById('qa-buyer').value;

    if (!stock) { Toast.show('Stock # is required', 'error'); document.getElementById('qa-stock').focus(); return; }
    if (!store) { Toast.show('Select a store', 'error');      document.getElementById('qa-store').focus(); return; }
    if (!buyer) { Toast.show('Select a buyer', 'error');      document.getElementById('qa-buyer').focus(); return; }

    const btn = document.getElementById('qa-submit');
    btn.textContent = '…';
    btn.disabled = true;

    const rec = {
      date:   document.getElementById('qa-date').value,
      stock,
      year:   parseInt(document.getElementById('qa-year').value) || '',
      make:   document.getElementById('qa-make').value.trim(),
      model:  document.getElementById('qa-model').value.trim(),
      vin:    document.getElementById('qa-vin').value.trim().toUpperCase(),
      source: document.getElementById('qa-source').value,
      store,
      buyer,
      notes:  '',
      arb:    null,
      createdAt: new Date().toISOString(),
    };

    try {
      await addDoc(collection(db, 'purchases'), rec);
      Toast.show(`Added ${stock}`, 'success');
      // Clear vehicle fields, keep date/source/store/buyer for batch entry
      ['qa-stock','qa-year','qa-make','qa-model','qa-vin'].forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('qa-stock').focus();
    } catch(e) {
      console.error(e);
      Toast.show('Failed to save — check connection', 'error');
    }

    btn.textContent = 'Add';
    btn.disabled = false;
  },

  // ---- Update / delete ---------------------------------------
  async saveRecord(id, changes) {
    try {
      await updateDoc(doc(db, 'purchases', id), changes);
      Toast.show('Saved', 'success');
    } catch(e) {
      console.error(e);
      Toast.show('Save failed', 'error');
    }
  },

  async deleteRecord(id) {
    if (!confirm('Delete this purchase record? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'purchases', id));
      this.expandedId = null;
      Toast.show('Record deleted');
    } catch(e) {
      console.error(e);
      Toast.show('Delete failed', 'error');
    }
  },

  // ---- Filters & sort ----------------------------------------
  bindQuickAdd() {
    const qaInputs = Array.from(document.querySelectorAll('.quick-add-fields input, .quick-add-fields select'));
    qaInputs.forEach((el, i) => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (i === qaInputs.length - 1) this.submitQuickAdd();
          else qaInputs[i+1].focus();
        }
      });
    });
    document.getElementById('qa-vin').addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase();
    });
    document.getElementById('qa-submit').addEventListener('click', () => this.submitQuickAdd());
  },

  bindFilters() {
    document.getElementById('p-search').addEventListener('input', e => { this.searchQ = e.target.value; this.renderRows(); });
    document.getElementById('p-store').addEventListener('change', e => { this.filterStore = e.target.value; this.renderRows(); });
    document.getElementById('p-source').addEventListener('change', e => { this.filterSource = e.target.value; this.renderRows(); });
    document.getElementById('p-buyer').addEventListener('change', e => { this.filterBuyer = e.target.value; this.renderRows(); });
  },

  bindTableSort() {
    document.querySelectorAll('.p-table th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (this.sortCol === col) this.sortDir *= -1;
        else { this.sortCol = col; this.sortDir = 1; }
        this.renderRows();
      });
    });
  },

  getFiltered() {
    let data = [...this.records];
    const q = this.searchQ.trim().toLowerCase();
    if (q) data = data.filter(r =>
      (r.stock||'').toLowerCase().includes(q) ||
      (r.vin||'').toLowerCase().includes(q) ||
      (r.make||'').toLowerCase().includes(q) ||
      (r.model||'').toLowerCase().includes(q)
    );
    if (this.filterStore)  data = data.filter(r => r.store  === this.filterStore);
    if (this.filterSource) data = data.filter(r => r.source === this.filterSource);
    if (this.filterBuyer)  data = data.filter(r => r.buyer  === this.filterBuyer);
    const col = this.sortCol;
    data.sort((a,b) => {
      let av = a[col]??'', bv = b[col]??'';
      if (typeof av === 'number') return (av-bv) * this.sortDir;
      return String(av).localeCompare(String(bv)) * this.sortDir;
    });
    return data;
  },

  // ---- Row rendering -----------------------------------------
  renderRows() {
    const data  = this.getFiltered();
    const tbody = document.getElementById('p-tbody');
    if (!tbody) return;

    document.querySelectorAll('.p-table th[data-col]').forEach(th => {
      th.className = th.dataset.col === this.sortCol
        ? (this.sortDir === 1 ? 'sort-asc' : 'sort-desc') : '';
    });
    document.getElementById('p-count').textContent =
      `${data.length} record${data.length !== 1 ? 's' : ''}`;

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-4);font-size:13px">
        ${this.records.length === 0 ? 'No purchases yet — use quick add above.' : 'No records match your filters.'}
      </td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(r => this.rowHTML(r) + this.detailRowHTML(r)).join('');

    tbody.querySelectorAll('.p-row').forEach(tr => {
      tr.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        this.toggleRow(tr.dataset.id);
      });
    });

    if (this.expandedId) this.bindDetailPanel(this.expandedId);
  },

  rowHTML(r) {
    const isExpanded = this.expandedId === r.id;
    const hasArb     = r.arb !== null && r.arb !== undefined;
    const srcClass   = 'src-' + (r.source||'').replace(/\s/g,'');
    return `<tr class="p-row${isExpanded?' expanded':''}${hasArb?' has-arb':''}" data-id="${r.id}">
      <td style="padding:10px 10px 10px 14px"><span class="row-chevron">▶</span></td>
      <td>${r.date||'—'}</td>
      <td class="td-stock" style="font-family:var(--font-mono);font-size:11px;font-weight:600">${r.stock||''}</td>
      <td style="color:var(--text-2)">${r.year||'—'}</td>
      <td>${r.make||'—'}</td>
      <td>${r.model||'—'}</td>
      <td style="font-family:var(--font-mono);font-size:10px;color:var(--text-3)">${r.vin||'—'}</td>
      <td><span class="src-badge ${srcClass}">${r.source||''}</span></td>
      <td style="color:var(--text-2);font-size:12px">${r.store||'—'}</td>
      <td style="font-size:12px;color:var(--text-2)">${r.buyer||'—'}</td>
    </tr>`;
  },

  detailRowHTML(r) {
    if (this.expandedId !== r.id)
      return `<tr class="detail-row" data-detail-id="${r.id}" style="display:none"><td colspan="10"></td></tr>`;

    const arb    = r.arb || {};
    const hasArb = r.arb !== null && r.arb !== undefined;

    return `<tr class="detail-row" data-detail-id="${r.id}">
      <td colspan="10">
        <div class="detail-panel">

          <div>
            <div class="detail-section-title">Vehicle details</div>
            <div class="detail-fields three" style="margin-bottom:10px">
              <div class="detail-field"><label>Date</label>
                <input type="date" data-field="date" value="${r.date||''}"></div>
              <div class="detail-field"><label>Stock #</label>
                <input type="text" data-field="stock" value="${r.stock||''}"></div>
              <div class="detail-field"><label>Year</label>
                <input type="number" data-field="year" value="${r.year||''}" style="-moz-appearance:textfield"></div>
            </div>
            <div class="detail-fields" style="margin-bottom:10px">
              <div class="detail-field"><label>Make</label>
                <input type="text" data-field="make" value="${r.make||''}"></div>
              <div class="detail-field"><label>Model</label>
                <input type="text" data-field="model" value="${r.model||''}"></div>
            </div>
            <div class="detail-fields one" style="margin-bottom:10px">
              <div class="detail-field"><label>VIN</label>
                <input type="text" data-field="vin" value="${r.vin||''}" maxlength="17"
                  style="text-transform:uppercase;font-family:var(--font-mono)"></div>
            </div>
            <div class="detail-fields three" style="margin-bottom:10px">
              <div class="detail-field"><label>Source</label>
                <select data-field="source">
                  ${SOURCES.map(s=>`<option ${r.source===s?'selected':''}>${s}</option>`).join('')}
                </select></div>
              <div class="detail-field"><label>Store</label>
                <select data-field="store">
                  ${STORES.map(s=>`<option ${r.store===s?'selected':''}>${s}</option>`).join('')}
                </select></div>
              <div class="detail-field"><label>Buyer</label>
                <select data-field="buyer">
                  <option value="">— Buyer —</option>
                  ${BUYERS.map(b=>`<option ${r.buyer===b?'selected':''}>${b}</option>`).join('')}
                </select></div>
            </div>
            <div class="detail-fields one">
              <div class="detail-field"><label>Notes</label>
                <textarea data-field="notes" placeholder="Any notes about this unit…">${r.notes||''}</textarea>
              </div>
            </div>
          </div>

          <div>
            <div class="detail-section-title">Arbitration</div>
            <div class="arb-toggle">
              <label class="toggle-switch">
                <input type="checkbox" id="arb-toggle-${r.id}" ${hasArb?'checked':''}>
                <span class="toggle-track"></span>
              </label>
              <span class="arb-toggle-label" id="arb-label-${r.id}">${hasArb?'Case open':'No arbitration case'}</span>
              ${hasArb && arb.status ? `<span class="arb-status-badge arb-${arb.status}">${arb.status}</span>` : ''}
            </div>
            <div class="arb-fields${hasArb?' visible':''}" id="arb-fields-${r.id}">
              <div class="detail-fields" style="margin-bottom:10px">
                <div class="detail-field"><label>Issue</label>
                  <input type="text" data-arb-field="issue" value="${arb.issue||''}"
                    placeholder="e.g. Undisclosed engine misfire"></div>
                <div class="detail-field"><label>Amount requested ($)</label>
                  <input type="number" data-arb-field="amount" value="${arb.amount||''}"
                    placeholder="0" style="-moz-appearance:textfield"></div>
              </div>
              <div class="detail-fields" style="margin-bottom:10px">
                <div class="detail-field"><label>Date filed</label>
                  <input type="date" data-arb-field="dateFiled" value="${arb.dateFiled||today()}"></div>
                <div class="detail-field"><label>Status</label>
                  <select data-arb-field="status">
                    ${['Open','Won','Lost','Closed'].map(s=>
                      `<option ${(arb.status||'Open')===s?'selected':''}>${s}</option>`
                    ).join('')}
                  </select></div>
              </div>
              <div class="detail-fields one">
                <div class="detail-field"><label>Resolution notes</label>
                  <textarea data-arb-field="resolution"
                    placeholder="Outcome, credits applied, etc.">${arb.resolution||''}</textarea>
                </div>
              </div>
            </div>
          </div>

          <div class="detail-actions">
            <button class="btn-save"  data-save-id="${r.id}">Save changes</button>
            <button class="btn-ghost" data-close-id="${r.id}">Close</button>
            <button class="btn-delete" data-delete-id="${r.id}">Delete record</button>
          </div>

        </div>
      </td>
    </tr>`;
  },

  // ---- Toggle & bind -----------------------------------------
  toggleRow(id) {
    this.expandedId = this.expandedId === id ? null : id;
    this.renderRows();
    if (this.expandedId) {
      setTimeout(() => {
        document.querySelector(`tr[data-id="${id}"]`)
          ?.scrollIntoView({ behavior:'smooth', block:'nearest' });
      }, 50);
    }
  },

  bindDetailPanel(id) {
    const rec = this.records.find(r => r.id === id);
    if (!rec) return;

    // Collect pending changes locally; write on Save
    const pending = {};

    document.querySelectorAll(`tr[data-detail-id="${id}"] [data-field]`).forEach(el => {
      el.addEventListener('change', e => {
        let val = e.target.value;
        if (e.target.dataset.field === 'year') val = val ? parseInt(val) : '';
        if (e.target.dataset.field === 'vin')  val = val.toUpperCase();
        pending[e.target.dataset.field] = val;
      });
    });

    // Arb toggle
    const toggle    = document.getElementById(`arb-toggle-${id}`);
    const arbFields = document.getElementById(`arb-fields-${id}`);
    const arbLabel  = document.getElementById(`arb-label-${id}`);
    if (toggle) {
      toggle.addEventListener('change', e => {
        if (e.target.checked) {
          pending.arb = { issue:'', amount:'', dateFiled:today(), status:'Open', resolution:'' };
          arbFields.classList.add('visible');
          arbLabel.textContent = 'Case open';
        } else {
          if (!confirm('Remove the arbitration case from this unit?')) { toggle.checked = true; return; }
          pending.arb = null;
          arbFields.classList.remove('visible');
          arbLabel.textContent = 'No arbitration case';
        }
      });
    }

    // Arb fields
    document.querySelectorAll(`tr[data-detail-id="${id}"] [data-arb-field]`).forEach(el => {
      el.addEventListener('change', e => {
        const currentArb = pending.arb !== undefined ? pending.arb : { ...(rec.arb||{}) };
        if (currentArb) {
          currentArb[e.target.dataset.arbField] =
            e.target.dataset.arbField === 'amount'
              ? (parseFloat(e.target.value)||'')
              : e.target.value;
          pending.arb = currentArb;
        }
      });
    });

    // Save
    document.querySelector(`[data-save-id="${id}"]`)?.addEventListener('click', () => {
      if (Object.keys(pending).length === 0) { Toast.show('No changes to save'); return; }
      this.saveRecord(id, pending);
    });

    // Close
    document.querySelector(`[data-close-id="${id}"]`)?.addEventListener('click', () => {
      this.expandedId = null;
      this.renderRows();
    });

    // Delete
    document.querySelector(`[data-delete-id="${id}"]`)?.addEventListener('click', () => {
      this.deleteRecord(id);
    });
  },
};

export default Purchases;
window.Purchases = Purchases;

// ---- helpers ------------------------------------------------
function today() { return new Date().toISOString().slice(0,10); }
