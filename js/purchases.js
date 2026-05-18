// ============================================================
//  purchases.js
// ============================================================

import {
  db, auth,
  collection, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, doc, getDoc, setDoc
} from './firebase.js';
import { STORES, SOURCES, BUYERS, Toast } from './constants.js';

const Purchases = {

  records:      [],
  expandedId:   null,
  sortCol:      'date',
  sortDir:      -1,
  filterStore:  '',
  filterSource: '',
  filterBuyer:  '',
  filterMonth:  '',
  filterNoStock: false,
  filterOpenArb: false,
  filterNoFinance: false,
  filterMenuOpen: false,
  finFilter: {
    dateFrom: '', dateTo: '',
    priceMin: '', priceMax: '',
    transportMin: '', transportMax: '',
    feesMin: '', feesMax: '',
    totalMin: '', totalMax: '',
    arbMin: '', arbMax: '',
  },
  finFilterOpen: false,
  searchQ:      '',

  // ---- Render ------------------------------------------------
  render(container) {
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
    if (this._finBtnHandler) { document.removeEventListener("click", this._finBtnHandler); this._finBtnHandler = null; }
    window.Purchases = this;

    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="page-title">All Purchases</div>
          <div class="page-sub">Log and track every vehicle acquisition.</div>
        </div>
        <button class="auc-btn-primary" id="btn-add-purchase">+ Add purchase</button>
      </div>

      <div class="filter-bar">
        <input type="text" id="p-search" placeholder="Search stock #, VIN, make, model…" value="${this.searchQ}">
        <div class="p-filter-menu-wrap">
          <button class="btn-fin-filter${this._anyBasicFilter() ? ' active' : ''}" id="btn-filter-menu">
            ⊞ Filters${this._anyBasicFilter() ? ` <span class="fin-filter-dot"></span>` : ''}
          </button>
          <div id="p-filter-menu" class="p-filter-menu${this.filterMenuOpen ? '' : ' hidden'}">
            <div class="p-fm-row">
              <label class="p-fm-label">Month</label>
              <select id="p-month" class="p-fm-select">
                <option value="">All months</option>
                ${this.getMonths().map(m => `<option value="${m.val}" ${this.filterMonth===m.val?'selected':''}>${m.label}</option>`).join('')}
              </select>
            </div>
            <div class="p-fm-row">
              <label class="p-fm-label">Store</label>
              <select id="p-store" class="p-fm-select">
                <option value="">All stores</option>
                ${STORES.map(s => `<option value="${s}" ${this.filterStore===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="p-fm-row">
              <label class="p-fm-label">Source</label>
              <select id="p-source" class="p-fm-select">
                <option value="">All sources</option>
                ${SOURCES.map(s => `<option value="${s}" ${this.filterSource===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="p-fm-row">
              <label class="p-fm-label">Buyer</label>
              <select id="p-buyer" class="p-fm-select">
                <option value="">All buyers</option>
                ${BUYERS.map(b => `<option value="${b}" ${this.filterBuyer===b?'selected':''}>${b}</option>`).join('')}
              </select>
            </div>
            <div style="border-top:1px solid var(--border);padding-top:8px">
              <label class="p-fm-label" style="margin-bottom:6px;display:block">Flags</label>
              <div style="display:flex;flex-direction:column;gap:4px">
                <label class="p-fm-toggle ${this.filterNoStock?'active':''}">
                  <input type="checkbox" id="p-nostock-chk" ${this.filterNoStock?'checked':''}>
                  <span>⚠ No stock #</span>
                </label>
                <label class="p-fm-toggle ${this.filterOpenArb?'active':''}">
                  <input type="checkbox" id="p-openarb-chk" ${this.filterOpenArb?'checked':''}>
                  <span>⚖ Open arbitration</span>
                </label>
                <label class="p-fm-toggle ${this.filterNoFinance?'active':''}">
                  <input type="checkbox" id="p-nofinance-chk" ${this.filterNoFinance?'checked':''}>
                  <span>⚠ No financials</span>
                </label>
              </div>
            </div>
            <div style="border-top:1px solid var(--border);padding-top:8px;text-align:right">
              <button class="btn-ghost" id="p-clear-filters" style="font-size:11px">Clear all filters</button>
            </div>
          </div>
        </div>
        <button class="btn-fin-filter${this.finFilterOpen ? ' active' : ''}" id="btn-fin-filter">
          ⊞ Financials${this._finFilterActive() ? ' <span class="fin-filter-dot"></span>' : ''}
        </button>
        <span class="record-count" id="p-count"></span>
        <button class="btn-import" id="btn-export">↓ Export CSV</button>
        <button class="btn-import" id="btn-import">⬆ Import CSV</button>
      </div>

      ${this._anyBasicFilter() ? `
      <div class="p-active-chips">
        ${this.filterMonth  ? `<span class="p-chip">Month: ${this.filterMonth} <span class="p-chip-x" data-clear="month">✕</span></span>`   : ''}
        ${this.filterStore  ? `<span class="p-chip">Store: ${this.filterStore}  <span class="p-chip-x" data-clear="store">✕</span></span>`  : ''}
        ${this.filterSource ? `<span class="p-chip">Source: ${this.filterSource}<span class="p-chip-x" data-clear="source">✕</span></span>` : ''}
        ${this.filterBuyer  ? `<span class="p-chip">Buyer: ${this.filterBuyer}  <span class="p-chip-x" data-clear="buyer">✕</span></span>`  : ''}
        ${this.filterNoStock ? `<span class="p-chip p-chip-amber">⚠ No stock # <span class="p-chip-x" data-clear="nostock">✕</span></span>` : ''}
        ${this.filterOpenArb   ? `<span class="p-chip p-chip-amber">⚖ Open arb <span class="p-chip-x" data-clear="openarb">✕</span></span>` : ''}
        ${this.filterNoFinance ? `<span class="p-chip p-chip-amber">⚠ No financials <span class="p-chip-x" data-clear="nofinance">✕</span></span>` : ''}
      </div>` : ''}

      <div id="fin-filter-panel" class="${this.finFilterOpen ? '' : 'hidden'}">
        <div class="fin-filter-grid">
          <div class="fin-filter-group">
            <div class="fin-filter-label">Date range</div>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="date" class="fin-input" id="ff-dateFrom" value="${this.finFilter.dateFrom}" placeholder="From">
              <span style="color:var(--text-4);font-size:11px">to</span>
              <input type="date" class="fin-input" id="ff-dateTo"   value="${this.finFilter.dateTo}"   placeholder="To">
            </div>
          </div>
          <div class="fin-filter-group">
            <div class="fin-filter-label">Purchase price ($)</div>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="number" class="fin-input" id="ff-priceMin" value="${this.finFilter.priceMin}" placeholder="Min" style="-moz-appearance:textfield">
              <span style="color:var(--text-4);font-size:11px">–</span>
              <input type="number" class="fin-input" id="ff-priceMax" value="${this.finFilter.priceMax}" placeholder="Max" style="-moz-appearance:textfield">
            </div>
          </div>
          <div class="fin-filter-group">
            <div class="fin-filter-label">Transport ($)</div>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="number" class="fin-input" id="ff-transportMin" value="${this.finFilter.transportMin}" placeholder="Min" style="-moz-appearance:textfield">
              <span style="color:var(--text-4);font-size:11px">–</span>
              <input type="number" class="fin-input" id="ff-transportMax" value="${this.finFilter.transportMax}" placeholder="Max" style="-moz-appearance:textfield">
            </div>
          </div>
          <div class="fin-filter-group">
            <div class="fin-filter-label">Fees ($)</div>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="number" class="fin-input" id="ff-feesMin" value="${this.finFilter.feesMin}" placeholder="Min" style="-moz-appearance:textfield">
              <span style="color:var(--text-4);font-size:11px">–</span>
              <input type="number" class="fin-input" id="ff-feesMax" value="${this.finFilter.feesMax}" placeholder="Max" style="-moz-appearance:textfield">
            </div>
          </div>
          <div class="fin-filter-group">
            <div class="fin-filter-label">Total cost ($)</div>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="number" class="fin-input" id="ff-totalMin" value="${this.finFilter.totalMin}" placeholder="Min" style="-moz-appearance:textfield">
              <span style="color:var(--text-4);font-size:11px">–</span>
              <input type="number" class="fin-input" id="ff-totalMax" value="${this.finFilter.totalMax}" placeholder="Max" style="-moz-appearance:textfield">
            </div>
          </div>
          <div class="fin-filter-group">
            <div class="fin-filter-label">Arb received ($)</div>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="number" class="fin-input" id="ff-arbMin" value="${this.finFilter.arbMin}" placeholder="Min" style="-moz-appearance:textfield">
              <span style="color:var(--text-4);font-size:11px">–</span>
              <input type="number" class="fin-input" id="ff-arbMax" value="${this.finFilter.arbMax}" placeholder="Max" style="-moz-appearance:textfield">
            </div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px">
          <button class="btn-ghost" id="ff-clear">Clear financial filters</button>
        </div>
      </div>

      <div id="import-panel" class="import-panel hidden"></div>

      <div class="p-card">
        <table class="p-table">
          <thead><tr>
            <th style="width:28px"></th>
            <th data-col="date">Date</th>
            <th data-col="stock">Stock #</th>
            <th data-col="make">Vehicle / VIN</th>
            <th data-col="source">Source</th>
            <th data-col="store">Store</th>
            <th data-col="buyer">Buyer</th>
            <th>Notes</th>
          </tr></thead>
          <tbody id="p-tbody">
            <tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-4)">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('btn-add-purchase').addEventListener('click', () => this.openAddModal());
    this.bindFilters();
    this.bindTableSort();
    this.bindImport();
    this.loadPrefs().then(() => this.subscribeFirestore());
  },

  // ---- Firestore listener ------------------------------------
  fmtCost(price, transport, fees) {
    const p = parseFloat(price)    || 0;
    const t = parseFloat(transport)|| 0;
    const f = parseFloat(fees)     || 0;
    if (!p && !t && !f) return '—';
    return '$' + (p + t + f).toLocaleString();
  },

  fmtNetCost(price, transport, fees, arbReceived) {
    const p   = parseFloat(price)        || 0;
    const t   = parseFloat(transport)    || 0;
    const f   = parseFloat(fees)         || 0;
    const arb = parseFloat(arbReceived)  || 0;
    const total = p + t + f;
    if (!total) return '—';
    const net = total - arb;
    return '$' + net.toLocaleString();
  },

  async loadPrefs() {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const snap = await getDoc(doc(db, 'user_preferences', uid));
      if (snap.exists()) {
        const prefs = snap.data();
        if (prefs.filterBuyer !== undefined) this.filterBuyer = prefs.filterBuyer;
        if (prefs.filterMonth !== undefined) this.filterMonth = prefs.filterMonth;
      }
    } catch(e) { console.error('Load prefs error:', e); }
  },

  async savePrefs() {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      await setDoc(doc(db, 'user_preferences', uid), {
        filterBuyer: this.filterBuyer,
        filterMonth: this.filterMonth,
      }, { merge: true });
    } catch(e) { console.error('Save prefs error:', e); }
  },

  exportCSV() {
    const data = this.getFiltered();
    if (!data.length) { Toast.show('No records to export', 'error'); return; }

    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };

    const headers = [
      'Date', 'Stock #', 'Year', 'Make', 'Model', 'VIN',
      'Source', 'Store', 'Buyer',
      'Purchase Price', 'Transport', 'Fees', 'Total Cost',
      'Notes',
      'Arb Status', 'Arb Issue', 'Arb Requested', 'Arb Received',
      'Arb Date Filed', 'Arb Date Unwound', 'Arb Resolution'
    ];

    const rows = data.map(r => {
      const total = (parseFloat(r.purchasePrice)||0) +
                    (parseFloat(r.transport)||0) +
                    (parseFloat(r.fees)||0);
      return [
        r.date          || '',
        r.stock         || '',
        r.year          || '',
        r.make          || '',
        r.model         || '',
        r.vin           || '',
        r.source        || '',
        r.store         || '',
        r.buyer         || '',
        r.purchasePrice ?? '',
        r.transport     ?? '',
        r.fees          ?? '',
        total > 0 ? total : '',
        r.notes         || '',
        r.arb?.status        || '',
        r.arb?.issue         || '',
        r.arb?.amount        ?? '',
        r.arb?.amountReceived ?? '',
        r.arb?.dateFiled     || '',
        r.arb?.dateUnwound   || '',
        r.arb?.resolution    || '',
      ].map(esc).join(',');
    });

    const csv  = [headers.map(esc).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0,10);
    a.href     = url;
    a.download = `purchases_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.show(`Exported ${data.length} record${data.length > 1 ? 's' : ''}`, 'success');
  },

  subscribeFirestore() {
    const q = collection(db, 'purchases');
    this._unsubscribe = onSnapshot(q,
      snapshot => {
        const newRecords = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        // If user has a row expanded (actively editing), only update other records
        // to avoid collapsing their work mid-edit
        if (this.expandedId) {
          this.records = newRecords.map(r =>
            r.id === this.expandedId
              ? (this.records.find(x => x.id === r.id) || r) // keep local version
              : r
          );
          // Don't re-render — user is editing
          return;
        }

        this.records = newRecords;

        const monthSel = document.getElementById('p-month');
        if (monthSel) {
          const current = this.filterMonth;
          monthSel.innerHTML = '<option value="">All months</option>' +
            this.getMonths().map(m => `<option value="${m.val}"${current===m.val?' selected':''}>${m.label}</option>`).join('');
        }
        this.renderRows();
      },
      err => {
        console.error('Firestore error:', err);
        Toast.show('Could not load purchases', 'error');
      }
    );
  },

  // ---- Quick add ---------------------------------------------
  openAddModal() {
    let overlay = document.getElementById('p-add-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'p-add-overlay';
      overlay.className = 'cal-modal-overlay';
      overlay.addEventListener('click', e => { if (e.target === overlay) Purchases.closeAddModal(); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="cal-modal" style="width:620px;max-width:calc(100vw - 32px)">
        <div class="cal-modal-header">
          <div class="cal-modal-title">Add purchase</div>
          <button class="cal-modal-close" onclick="Purchases.closeAddModal()">✕</button>
        </div>
        <div class="cal-modal-body">
          <div class="p-add-grid">
            <div class="p-add-section-title" style="grid-column:1/-1">Vehicle info</div>
            <div class="p-add-field">
              <label>Date</label>
              <input type="date" id="pa-date" value="${today()}" tabindex="1">
            </div>
            <div class="p-add-field">
              <label>Stock # <span style="color:var(--text-4);font-weight:400">(optional)</span></label>
              <input type="text" id="pa-stock" placeholder="Z3490" autocomplete="off" tabindex="2">
            </div>
            <div class="p-add-field">
              <label>Year</label>
              <input type="number" id="pa-year" placeholder="${new Date().getFullYear()}" min="1990" max="2035" style="-moz-appearance:textfield" tabindex="3">
            </div>
            <div class="p-add-field">
              <label>Make</label>
              <input type="text" id="pa-make" placeholder="Toyota" autocomplete="off" tabindex="4">
            </div>
            <div class="p-add-field">
              <label>Model</label>
              <input type="text" id="pa-model" placeholder="Tacoma" autocomplete="off" tabindex="5">
            </div>
            <div class="p-add-field">
              <label>VIN</label>
              <input type="text" id="pa-vin" placeholder="17-char VIN" maxlength="17" autocomplete="off"
                style="text-transform:uppercase;font-family:var(--font-mono)" tabindex="6">
            </div>
            <div class="p-add-field">
              <label>Source</label>
              <select id="pa-source" tabindex="7">
                ${SOURCES.map(s => `<option>${s}</option>`).join('')}
              </select>
            </div>
            <div class="p-add-field">
              <label>Store</label>
              <select id="pa-store" tabindex="8">
                <option value="">— Store —</option>
                ${STORES.map(s => `<option>${s}</option>`).join('')}
              </select>
            </div>
            <div class="p-add-field">
              <label>Buyer</label>
              <select id="pa-buyer" tabindex="9">
                <option value="">— Buyer —</option>
                ${BUYERS.map(b => `<option>${b}</option>`).join('')}
              </select>
            </div>
            <div class="p-add-section-title" style="grid-column:1/-1;margin-top:8px">Cost breakdown</div>
            <div class="p-add-field">
              <label>Purchase price ($)</label>
              <input type="number" id="pa-price" placeholder="0" style="-moz-appearance:textfield" tabindex="10">
            </div>
            <div class="p-add-field">
              <label>Transport ($)</label>
              <input type="number" id="pa-transport" placeholder="0" style="-moz-appearance:textfield" tabindex="11">
            </div>
            <div class="p-add-field">
              <label>Fees ($)</label>
              <input type="number" id="pa-fees" placeholder="0" style="-moz-appearance:textfield" tabindex="12">
            </div>
            <div style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:10px 0 0;border-top:1px solid var(--border);margin-top:4px">
              <div style="font-size:13px;font-weight:600;color:var(--text-2)">
                Total cost: <span id="pa-total" style="color:var(--text-1);font-family:var(--font-mono)">—</span>
              </div>
              <div style="display:flex;gap:8px">
                <button class="auc-btn-primary" id="pa-save" tabindex="13">Save purchase</button>
                <button class="auc-btn-secondary" onclick="Purchases.closeAddModal()" tabindex="14">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    overlay.classList.remove('hidden');
    setTimeout(() => document.getElementById('pa-date')?.focus(), 50);

    ['pa-price','pa-transport','pa-fees'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        const p = parseFloat(document.getElementById('pa-price')?.value)     || 0;
        const t = parseFloat(document.getElementById('pa-transport')?.value) || 0;
        const f = parseFloat(document.getElementById('pa-fees')?.value)      || 0;
        const total = p + t + f;
        const el = document.getElementById('pa-total');
        if (el) el.textContent = total > 0 ? '$' + total.toLocaleString() : '—';
      });
    });

    document.getElementById('pa-vin')?.addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase();
    });

    document.getElementById('pa-fees')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); Purchases.submitAddModal(); }
    });

    document.getElementById('pa-save')?.addEventListener('click', () => Purchases.submitAddModal());
  },

  closeAddModal() {
    const el = document.getElementById('p-add-overlay');
    if (el) el.classList.add('hidden');
  },

  async submitAddModal() {
    const store = document.getElementById('pa-store')?.value;
    const buyer = document.getElementById('pa-buyer')?.value;
    if (!store) { Toast.show('Select a store', 'error'); document.getElementById('pa-store')?.focus(); return; }
    if (!buyer) { Toast.show('Select a buyer', 'error'); document.getElementById('pa-buyer')?.focus(); return; }

    // VIN duplicate check
    const vinVal = document.getElementById('pa-vin')?.value.trim().toUpperCase() || '';
    if (vinVal && vinVal.length > 3) {
      const dup = this.records.find(r => (r.vin || '').toUpperCase() === vinVal);
      if (dup) {
        const go = confirm(`⚠ VIN ${vinVal} already exists in the database\n(${dup.year} ${dup.make} ${dup.model} — Stock: ${dup.stock || 'no stock #'})\n\nSave anyway?`);
        if (!go) return;
      }
    }

    const btn = document.getElementById('pa-save');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

    const stock = document.getElementById('pa-stock')?.value.trim() || '';
    try {
      await addDoc(collection(db, 'purchases'), {
        date:          document.getElementById('pa-date')?.value || '',
        stock,
        year:          parseInt(document.getElementById('pa-year')?.value) || '',
        make:          document.getElementById('pa-make')?.value.trim() || '',
        model:         document.getElementById('pa-model')?.value.trim() || '',
        vin:           document.getElementById('pa-vin')?.value.trim().toUpperCase() || '',
        source:        document.getElementById('pa-source')?.value || '',
        store,
        buyer,
        purchasePrice: parseFloat(document.getElementById('pa-price')?.value)     || null,
        transport:     parseFloat(document.getElementById('pa-transport')?.value) || null,
        fees:          parseFloat(document.getElementById('pa-fees')?.value)      || null,
        notes:         '',
        arb:           null,
        createdAt:     new Date().toISOString(),
      });
      Toast.show(`Purchase added${stock ? ' — ' + stock : ''}`, 'success');
      this.closeAddModal();
    } catch(e) {
      console.error(e);
      Toast.show('Failed to save — check connection', 'error');
      if (btn) { btn.textContent = 'Save purchase'; btn.disabled = false; }
    }
  },

  bindFilters() {
    document.getElementById('p-search')?.addEventListener('input',  e => { this.searchQ     = e.target.value; this.renderRows(); });
    document.getElementById('p-month')?.addEventListener('change',  e => { this.filterMonth  = e.target.value; this.savePrefs(); this.renderRows(); });
    document.getElementById('btn-export')?.addEventListener('click', () => this.exportCSV());

    // Financial filter toggle — use document-level delegation so it survives re-renders
    this._finBtnHandler = (e) => {
      if (e.target.closest('#btn-fin-filter')) {
        this.finFilterOpen = !this.finFilterOpen;
        const panel = document.getElementById('fin-filter-panel');
        const btn   = document.getElementById('btn-fin-filter');
        if (panel) panel.classList.toggle('hidden', !this.finFilterOpen);
        if (btn)   btn.classList.toggle('active',    this.finFilterOpen);
      }
    };
    // Remove previous handler if navigating back
    document.removeEventListener('click', this._finBtnHandler);
    document.addEventListener('click', this._finBtnHandler);

    // Financial filter inputs — bind after render
    const ffBind = (id, key) => {
      document.getElementById(id)?.addEventListener('input', e => {
        this.finFilter[key] = e.target.value;
        this.renderRows();
      });
    };
    ffBind('ff-dateFrom',    'dateFrom');
    ffBind('ff-dateTo',      'dateTo');
    ffBind('ff-priceMin',    'priceMin');    ffBind('ff-priceMax',    'priceMax');
    ffBind('ff-transportMin','transportMin'); ffBind('ff-transportMax','transportMax');
    ffBind('ff-feesMin',     'feesMin');     ffBind('ff-feesMax',     'feesMax');
    ffBind('ff-totalMin',    'totalMin');    ffBind('ff-totalMax',    'totalMax');
    ffBind('ff-arbMin',      'arbMin');      ffBind('ff-arbMax',      'arbMax');

    document.getElementById('ff-clear')?.addEventListener('click', () => {
      this.finFilter = {
        dateFrom:'', dateTo:'',
        priceMin:'', priceMax:'', transportMin:'', transportMax:'',
        feesMin:'', feesMax:'', totalMin:'', totalMax:'',
        arbMin:'', arbMax:'',
      };
      // Clear visible input values too
      ['ff-dateFrom','ff-dateTo','ff-priceMin','ff-priceMax',
       'ff-transportMin','ff-transportMax','ff-feesMin','ff-feesMax',
       'ff-totalMin','ff-totalMax','ff-arbMin','ff-arbMax'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      this.renderRows();
    });
    // Filter menu toggle — use delegated handler
    if (this._filterMenuHandler) document.removeEventListener('click', this._filterMenuHandler);
    this._filterMenuHandler = (e) => {
      const btn  = e.target.closest('#btn-filter-menu');
      const menu = document.getElementById('p-filter-menu');
      const wrap = e.target.closest('.p-filter-menu-wrap');
      if (btn) {
        this.filterMenuOpen = !this.filterMenuOpen;
        if (menu) menu.classList.toggle('hidden', !this.filterMenuOpen);
        return;
      }
      // Close if clicking outside the menu
      if (!wrap && menu && !menu.classList.contains('hidden')) {
        this.filterMenuOpen = false;
        menu.classList.add('hidden');
      }
      // Chip clear buttons
      const chip = e.target.closest('[data-clear]');
      if (chip) {
        const key = chip.dataset.clear;
        if (key === 'month')  { this.filterMonth  = ''; }
        if (key === 'store')   { this.filterStore   = ''; }
        if (key === 'source')  { this.filterSource  = ''; }
        if (key === 'buyer')   { this.filterBuyer   = ''; }
        if (key === 'nostock') { this.filterNoStock = false; }
        if (key === 'openarb')   { this.filterOpenArb   = false; }
        if (key === 'nofinance') { this.filterNoFinance = false; }
        this.renderRows();
      }
    };
    document.addEventListener('click', this._filterMenuHandler);

    // Menu selects and checkboxes
    document.getElementById('p-store')?.addEventListener('change',  e => { this.filterStore   = e.target.value;    this.renderRows(); });
    document.getElementById('p-source')?.addEventListener('change', e => { this.filterSource  = e.target.value;    this.renderRows(); });
    document.getElementById('p-buyer')?.addEventListener('change',  e => { this.filterBuyer   = e.target.value;    this.savePrefs(); this.renderRows(); });
    document.getElementById('p-nostock-chk')?.addEventListener('change', e => {
      this.filterNoStock = e.target.checked;
      e.target.closest('label')?.classList.toggle('active', e.target.checked);
      this.renderRows();
    });
    document.getElementById('p-openarb-chk')?.addEventListener('change', e => {
      this.filterOpenArb = e.target.checked;
      e.target.closest('label')?.classList.toggle('active', e.target.checked);
      this.renderRows();
    });
    document.getElementById('p-nofinance-chk')?.addEventListener('change', e => {
      this.filterNoFinance = e.target.checked;
      e.target.closest('label')?.classList.toggle('active', e.target.checked);
      this.renderRows();
    });
    document.getElementById('p-clear-filters')?.addEventListener('click', () => {
      this.filterStore = ''; this.filterSource = ''; this.filterBuyer = ''; this.filterMonth = '';
      this.filterNoStock = false; this.filterOpenArb = false; this.filterNoFinance = false;
      this.filterMenuOpen = false;
      this.renderRows();
    });
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

  _anyBasicFilter() {
    return !!(this.filterStore || this.filterSource || this.filterBuyer || this.filterMonth ||
              this.filterNoStock || this.filterOpenArb || this.filterNoFinance);
  },

  _finFilterActive() {
    const f = this.finFilter;
    return !!(f.dateFrom || f.dateTo ||
      f.priceMin || f.priceMax || f.transportMin || f.transportMax ||
      f.feesMin  || f.feesMax  || f.totalMin     || f.totalMax     ||
      f.arbMin   || f.arbMax);
  },

  getMonths() {
    const seen = new Set();
    const months = [];
    // Sort records by date desc to get months in order
    const sorted = [...this.records].sort((a,b) => (b.date||'').localeCompare(a.date||''));
    sorted.forEach(r => {
      if (!r.date) return;
      const ym = r.date.slice(0, 7); // YYYY-MM
      if (!seen.has(ym)) {
        seen.add(ym);
        const [y, m] = ym.split('-');
        const label = new Date(y, parseInt(m)-1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
        months.push({ val: ym, label });
      }
    });
    return months;
  },

  getFiltered() {
    let data = [...this.records];
    const q = this.searchQ.trim().toLowerCase();
    if (q) data = data.filter(r =>
      (r.stock  || '').toLowerCase().includes(q) ||
      (r.vin    || '').toLowerCase().includes(q) ||
      (r.make   || '').toLowerCase().includes(q) ||
      (r.model  || '').toLowerCase().includes(q)
    );
    if (this.filterNoStock) data = data.filter(r => !r.stock || r.stock.trim() === '');
    if (this.filterOpenArb)   data = data.filter(r => r.arb && r.arb.status === 'Open');
    if (this.filterNoFinance) data = data.filter(r =>
      r.source !== 'ICO' &&
      (!r.purchasePrice && r.purchasePrice !== 0) &&
      (r.date || '') >= '2026-05-01'
    );
    if (this.filterMonth)   data = data.filter(r => (r.date||'').startsWith(this.filterMonth));

    // Financial filters
    const ff = this.finFilter;
    const inRange = (val, min, max) => {
      const n = parseFloat(val) || 0;
      if (min !== '' && n < parseFloat(min)) return false;
      if (max !== '' && n > parseFloat(max)) return false;
      return true;
    };
    if (ff.dateFrom)                 data = data.filter(r => (r.date||'') >= ff.dateFrom);
    if (ff.dateTo)                   data = data.filter(r => (r.date||'') <= ff.dateTo);
    if (ff.priceMin || ff.priceMax)  data = data.filter(r => inRange(r.purchasePrice, ff.priceMin, ff.priceMax));
    if (ff.transportMin || ff.transportMax) data = data.filter(r => inRange(r.transport, ff.transportMin, ff.transportMax));
    if (ff.feesMin || ff.feesMax)    data = data.filter(r => inRange(r.fees, ff.feesMin, ff.feesMax));
    if (ff.totalMin || ff.totalMax)  data = data.filter(r => {
      const total = (parseFloat(r.purchasePrice)||0) + (parseFloat(r.transport)||0) + (parseFloat(r.fees)||0);
      return inRange(total, ff.totalMin, ff.totalMax);
    });
    if (ff.arbMin || ff.arbMax)      data = data.filter(r => inRange(r.arb?.amountReceived, ff.arbMin, ff.arbMax));
    if (this.filterStore)  data = data.filter(r => r.store  === this.filterStore);
    if (this.filterSource) data = data.filter(r => r.source === this.filterSource);
    if (this.filterBuyer)  data = data.filter(r => r.buyer  === this.filterBuyer);
    const col = this.sortCol;
    data.sort((a, b) => {
      let av = a[col] ?? '', bv = b[col] ?? '';
      if (typeof av === 'number') return (av - bv) * this.sortDir;
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
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-4);font-size:13px">
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
    const srcClass   = 'src-' + (r.source || '').replace(/\s/g, '');
    const noStock     = !r.stock || r.stock.trim() === '';
    const unwound     = r.arb?.status === 'Unwound';
    const needsFinance = r.source !== 'ICO'
      && (!r.purchasePrice && r.purchasePrice !== 0)
      && (r.date || '') >= '2026-05-01';
    return `<tr class="p-row${isExpanded ? ' expanded' : ''}${hasArb ? ' has-arb' : ''}${noStock ? ' p-row-nostock' : ''}${unwound ? ' p-row-unwound' : ''}${needsFinance ? ' p-row-nofinance' : ''}" data-id="${r.id}">
      <td style="padding:10px 10px 10px 14px"><span class="row-chevron">▶</span></td>
      <td style="font-size:12px;color:var(--text-2);white-space:nowrap">${r.date || '—'}</td>
      <td class="td-stock" style="font-family:var(--font-mono);font-size:11px;font-weight:600">${r.stock || '<span style="color:var(--amber);font-size:10px;font-weight:600">⚠ No stock #</span>'}</td>
      <td>
        <div style="font-weight:500;font-size:13px">${r.year ? r.year+' ' : ''}${r.make || ''} ${r.model || ''}</div>
        ${r.vin ? `<div style="font-family:var(--font-mono);font-size:10px;font-weight:600;color:var(--text-2);letter-spacing:0.04em;margin-top:2px">${r.vin}</div>` : ''}
      </td>
      <td><span class="src-badge ${srcClass}">${r.source || ''}</span></td>
      <td style="color:var(--text-2);font-size:12px">${r.store || '—'}</td>
      <td style="font-size:12px;color:var(--text-2)">${r.buyer || '—'}</td>
      <td style="font-size:11px;color:var(--text-3);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.notes || ''}">${unwound ? '<span class="arb-status-badge arb-Unwound">Unwound</span>' : needsFinance ? '<span style="color:var(--amber);font-size:10px;font-weight:600">⚠ No financials</span>' : (r.notes || '')}</td>
    </tr>`;
  },

  detailRowHTML(r) {
    if (this.expandedId !== r.id)
      return `<tr class="detail-row" data-detail-id="${r.id}" style="display:none"><td colspan="9"></td></tr>`;

    const arb    = r.arb || {};
    const hasArb = r.arb !== null && r.arb !== undefined;

    return `<tr class="detail-row" data-detail-id="${r.id}">
      <td colspan="9">
        <div class="detail-panel" style="grid-template-columns:1fr 1fr 1fr">
          <!-- Col 1: Vehicle details -->
          <div>
            <div class="detail-section-title">Vehicle details</div>
            <div class="detail-fields three" style="margin-bottom:10px">
              <div class="detail-field"><label>Date</label>
                <input type="date" data-field="date" value="${r.date || ''}"></div>
              <div class="detail-field"><label>Stock #</label>
                <input type="text" data-field="stock" value="${r.stock || ''}"></div>
              <div class="detail-field"><label>Year</label>
                <input type="number" data-field="year" value="${r.year || ''}" style="-moz-appearance:textfield"></div>
            </div>
            <div class="detail-fields" style="margin-bottom:10px">
              <div class="detail-field"><label>Make</label>
                <input type="text" data-field="make" value="${r.make || ''}"></div>
              <div class="detail-field"><label>Model</label>
                <input type="text" data-field="model" value="${r.model || ''}"></div>
            </div>
            <div class="detail-fields one" style="margin-bottom:10px">
              <div class="detail-field"><label>VIN</label>
                <input type="text" data-field="vin" value="${r.vin || ''}" maxlength="17"
                  style="text-transform:uppercase;font-family:var(--font-mono)"></div>
            </div>
            <div class="detail-fields three" style="margin-bottom:10px">
              <div class="detail-field"><label>Source</label>
                <select data-field="source">
                  ${SOURCES.map(s => `<option ${r.source === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select></div>
              <div class="detail-field"><label>Store</label>
                <select data-field="store">
                  ${STORES.map(s => `<option ${r.store === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select></div>
              <div class="detail-field"><label>Buyer</label>
                <select data-field="buyer">
                  <option value="">— Buyer —</option>
                  ${BUYERS.map(b => `<option ${r.buyer === b ? 'selected' : ''}>${b}</option>`).join('')}
                </select></div>
            </div>
            <div class="detail-fields one">
              <div class="detail-field"><label>Notes</label>
                <textarea data-field="notes" placeholder="Any notes about this unit…">${r.notes || ''}</textarea>
              </div>
            </div>
          </div>

          <!-- Col 2: Financials -->
          <div>
            <div class="detail-section-title">Cost breakdown</div>
            <div class="detail-fields one" style="margin-bottom:10px">
              <div class="detail-field"><label>Purchase price ($)</label>
                <input type="number" data-field="purchasePrice" value="${r.purchasePrice || ''}"
                  placeholder="0" style="-moz-appearance:textfield" id="fp-price-${r.id}"></div>
            </div>
            <div class="detail-fields one" style="margin-bottom:10px">
              <div class="detail-field"><label>Transport ($)</label>
                <input type="number" data-field="transport" value="${r.transport || ''}"
                  placeholder="0" style="-moz-appearance:textfield" id="fp-transport-${r.id}"></div>
            </div>
            <div class="detail-fields one" style="margin-bottom:10px">
              <div class="detail-field"><label>Fees ($)</label>
                <input type="number" data-field="fees" value="${r.fees || ''}"
                  placeholder="0" style="-moz-appearance:textfield" id="fp-fees-${r.id}"></div>
            </div>
            <div class="cost-total-row">
              <span class="cost-total-label">Total cost</span>
              <span class="cost-total-val" id="fp-total-${r.id}">${Purchases.fmtCost(r.purchasePrice, r.transport, r.fees)}</span>
            </div>
            ${hasArb ? `
            <div class="cost-arb-row" style="margin-top:8px">
              <span class="cost-total-label" style="color:var(--green)">Arb recovery</span>
              <span class="cost-arb-val" style="color:var(--green)" id="fp-arbrecovery-${r.id}">
                ${arb.amountReceived ? '−$' + Number(arb.amountReceived).toLocaleString() : '—'}
              </span>
            </div>
            <div class="cost-total-row" style="border-top:2px solid var(--border);margin-top:4px">
              <span class="cost-total-label" style="font-size:13px">Net cost</span>
              <span class="cost-total-val" style="font-size:15px" id="fp-netcost-${r.id}">${Purchases.fmtNetCost(r.purchasePrice, r.transport, r.fees, arb.amountReceived)}</span>
            </div>` : ''}
          </div>

          <!-- Col 3: Arbitration -->
          <div>
            <div class="detail-section-title">Arbitration ${arb.status === "Unwound" ? "<span class='arb-status-badge arb-Unwound' style='margin-left:6px'>Unwound — vehicle returned</span>" : ""}</div>
            <div class="arb-toggle">
              <label class="toggle-switch">
                <input type="checkbox" id="arb-toggle-${r.id}" ${hasArb ? 'checked' : ''}>
                <span class="toggle-track"></span>
              </label>
              <span class="arb-toggle-label" id="arb-label-${r.id}">${hasArb ? 'Case open' : 'No arbitration case'}</span>
              ${hasArb && arb.status ? `<span class="arb-status-badge arb-${arb.status}">${arb.status}</span>` : ''}
            </div>
            <div class="arb-fields${hasArb ? ' visible' : ''}" id="arb-fields-${r.id}">
              <div class="detail-fields one" style="margin-bottom:10px">
                <div class="detail-field"><label>Issue</label>
                  <input type="text" data-arb-field="issue" value="${arb.issue || ''}" placeholder="e.g. Undisclosed engine misfire"></div>
              </div>
              <div class="detail-fields one" style="margin-bottom:10px">
                <div class="detail-field"><label>Amount requested ($)</label>
                  <input type="number" data-arb-field="amount" value="${arb.amount || ''}" placeholder="0" style="-moz-appearance:textfield"></div>
              </div>
              <div class="detail-fields" style="margin-bottom:10px">
                <div class="detail-field"><label>Date filed</label>
                  <input type="date" data-arb-field="dateFiled" value="${arb.dateFiled || today()}"></div>
                <div class="detail-field"><label>Status</label>
                  <select data-arb-field="status" id="arb-status-${r.id}">
                    ${['Open','Won','Lost','Closed','Unwound'].map(s =>
                      `<option ${(arb.status || 'Open') === s ? 'selected' : ''}>${s}</option>`
                    ).join('')}
                  </select></div>
              </div>
              <div class="detail-fields" id="arb-unwind-row-${r.id}" style="margin-bottom:10px;${arb.status === 'Unwound' ? '' : 'display:none'}">
                <div class="detail-field"><label>Date unwound</label>
                  <input type="date" data-arb-field="dateUnwound" value="${arb.dateUnwound || today()}" id="arb-dateunwound-${r.id}"></div>
                <div class="detail-field"><label>Amount returned ($)</label>
                  <input type="number" data-arb-field="amountReceived" value="${arb.amountReceived || ''}" placeholder="0" style="-moz-appearance:textfield" id="fp-arbreceived-${r.id}"></div>
              </div>
              <div class="detail-fields one">
                <div class="detail-field"><label>Resolution notes</label>
                  <textarea data-arb-field="resolution" placeholder="Outcome, credits applied, etc.">${arb.resolution || ''}</textarea>
                </div>
              </div>
            </div>
          </div>

          <div class="detail-actions" style="grid-column:1/-1">
            <button class="btn-save"   data-save-id="${r.id}">Save changes</button>
            <button class="btn-ghost"  data-close-id="${r.id}">Close</button>
            <button class="btn-ghost"  data-pdf-id="${r.id}">⎙ Print / PDF</button>
            <button class="btn-delete" data-delete-id="${r.id}">Delete record</button>
          </div>
        </div>
      </td>
    </tr>`;
  },

  // ---- Toggle & bind detail ----------------------------------
  toggleRow(id) {
    this.expandedId = this.expandedId === id ? null : id;
    this.renderRows();
    if (this.expandedId) {
      setTimeout(() => {
        document.querySelector(`tr[data-id="${id}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  },

  bindDetailPanel(id) {
    const rec = this.records.find(r => r.id === id);
    if (!rec) return;
    const pending = {};

    document.querySelectorAll(`tr[data-detail-id="${id}"] [data-field]`).forEach(el => {
      el.addEventListener('change', e => {
        let val = e.target.value;
        if (e.target.dataset.field === 'year') val = val ? parseInt(val) : '';
        if (e.target.dataset.field === 'vin')  val = val.toUpperCase();
        pending[e.target.dataset.field] = val;
        // Recalculate cost totals live
        if (['purchasePrice','transport','fees'].includes(e.target.dataset.field)) {
          const price     = document.getElementById(`fp-price-${id}`)?.value;
          const transport = document.getElementById(`fp-transport-${id}`)?.value;
          const fees      = document.getElementById(`fp-fees-${id}`)?.value;
          const arbRec    = document.getElementById(`fp-arbreceived-${id}`)?.value;
          const totalEl   = document.getElementById(`fp-total-${id}`);
          const netEl     = document.getElementById(`fp-netcost-${id}`);
          if (totalEl) totalEl.textContent = Purchases.fmtCost(price, transport, fees);
          if (netEl)   netEl.textContent   = Purchases.fmtNetCost(price, transport, fees, arbRec);
        }
      });
      el.addEventListener('input', e => {
        if (['purchasePrice','transport','fees'].includes(e.target.dataset.field)) {
          const price     = document.getElementById(`fp-price-${id}`)?.value;
          const transport = document.getElementById(`fp-transport-${id}`)?.value;
          const fees      = document.getElementById(`fp-fees-${id}`)?.value;
          const arbRec    = document.getElementById(`fp-arbreceived-${id}`)?.value;
          const totalEl   = document.getElementById(`fp-total-${id}`);
          const netEl     = document.getElementById(`fp-netcost-${id}`);
          if (totalEl) totalEl.textContent = Purchases.fmtCost(price, transport, fees);
          if (netEl)   netEl.textContent   = Purchases.fmtNetCost(price, transport, fees, arbRec);
        }
      });
    });

    const toggle    = document.getElementById(`arb-toggle-${id}`);
    const arbFields = document.getElementById(`arb-fields-${id}`);
    const arbLabel  = document.getElementById(`arb-label-${id}`);
    if (toggle) {
      toggle.addEventListener('change', e => {
        if (e.target.checked) {
          pending.arb = { issue: '', amount: '', amountReceived: '', dateFiled: today(), dateUnwound: '', status: 'Open', resolution: '' };
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

    document.querySelectorAll(`tr[data-detail-id="${id}"] [data-arb-field]`).forEach(el => {
      el.addEventListener('change', e => {
        const currentArb = pending.arb !== undefined ? pending.arb : { ...(rec.arb || {}) };
        if (currentArb) {
          const field = e.target.dataset.arbField;
          // Show/hide unwind date row based on status selection
          if (field === 'status') {
            const unwindRow = document.getElementById(`arb-unwind-row-${id}`);
            const unwindDate = document.getElementById(`arb-dateunwound-${id}`);
            if (unwindRow) unwindRow.style.display = e.target.value === 'Unwound' ? '' : 'none';
            if (unwindDate && e.target.value === 'Unwound' && !unwindDate.value) {
              unwindDate.value = today();
              currentArb.dateUnwound = today();
            }
          }
          currentArb[field] = ['amount','amountReceived'].includes(field)
            ? (parseFloat(e.target.value) || '')
            : e.target.value;
          pending.arb = currentArb;
          // Recalc net cost when arb received changes
          if (field === 'amountReceived') {
            const price     = document.getElementById(`fp-price-${id}`)?.value;
            const transport = document.getElementById(`fp-transport-${id}`)?.value;
            const fees      = document.getElementById(`fp-fees-${id}`)?.value;
            const netEl     = document.getElementById(`fp-netcost-${id}`);
            const arbRecEl  = document.getElementById(`fp-arbrecovery-${id}`);
            const val       = parseFloat(e.target.value) || 0;
            if (netEl)    netEl.textContent    = Purchases.fmtNetCost(price, transport, fees, val);
            if (arbRecEl) arbRecEl.textContent = val ? '−$' + val.toLocaleString() : '—';
          }
        }
      });
    });

    document.querySelector(`[data-save-id="${id}"]`)?.addEventListener('click', () => {
      if (Object.keys(pending).length === 0) { Toast.show('No changes to save'); return; }
      this.saveRecord(id, pending);
    });
    document.querySelector(`[data-close-id="${id}"]`)?.addEventListener('click', () => {
      this.expandedId = null;
      this.renderRows();
    });
    document.querySelector(`[data-pdf-id="${id}"]`)?.addEventListener('click', () => {
      // Merge pending changes into rec for PDF so unsaved edits show up
      const merged = { ...rec, ...pending };
      if (pending.arb !== undefined) merged.arb = pending.arb;
      this.printPDF(merged);
    });
    document.querySelector(`[data-delete-id="${id}"]`)?.addEventListener('click', () => {
      this.deleteRecord(id);
    });
  },

  async saveRecord(id, pending) {
    // Clear expandedId BEFORE the await so the snapshot listener
    // is not blocked when Firestore echoes our own write back
    this.expandedId = null;
    try {
      await updateDoc(doc(db, 'purchases', id), pending);
      Toast.show('Saved', 'success');
      this.renderRows();
    } catch(e) {
      console.error(e);
      Toast.show('Save failed — check connection', 'error');
    }
  },

  async deleteRecord(id) {
    if (!confirm('Delete this purchase? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'purchases', id));
      this.expandedId = null;
      Toast.show('Record deleted');
    } catch(e) {
      console.error(e);
      Toast.show('Delete failed', 'error');
    }
  },

  // ---- CSV Import --------------------------------------------
  bindImport() {
    document.getElementById('btn-import')
      .addEventListener('click', () => this.openImportPanel());
  },

  openImportPanel() {
    const panel = document.getElementById('import-panel');
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="import-header">
        <div class="import-title">Import purchases from CSV</div>
        <button class="import-close" id="import-close">✕</button>
      </div>
      <div class="import-body">
        <div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:13px;font-weight:500;color:var(--text-1)">Fix Excel serial dates</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:2px">Scan all existing purchases and convert any Excel serial number dates to real dates</div>
          </div>
          <button class="btn" id="fix-serials-btn" style="white-space:nowrap">🔧 Fix serial dates in database</button>
        </div>
<div class="import-buyer-row">
          <div class="import-buyer-label">Assign all imported records to buyer:</div>
          <select id="import-buyer" class="import-buyer-select">
            <option value="">— Select buyer —</option>
            ${BUYERS.map(b => `<option>${b}</option>`).join('')}
          </select>
        </div>
        <div class="import-drop" id="import-drop">
          <div class="import-drop-icon">📄</div>
          <div class="import-drop-text">Drop your CSV here or <label for="import-file" class="import-file-link">browse</label></div>
          <div class="import-drop-hint">Expected columns: Date · Stock # · Year · Make · Model · VIN · Source · Store · Comments</div>
          <input type="file" id="import-file" accept=".csv,.tsv,.txt" style="display:none">
        </div>
        <div id="import-preview"></div>
      </div>
    `;

    document.getElementById('import-close')
      .addEventListener('click', () => this.closeImportPanel());
    document.getElementById('fix-serials-btn')
      .addEventListener('click', () => this.fixSerialDates());



    document.getElementById('import-file')
      .addEventListener('change', e => {
        if (e.target.files[0]) this.readCSV(e.target.files[0]);
      });

    const drop = document.getElementById('import-drop');
    drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) this.readCSV(file);
      else Toast.show('Could not read that file', 'error');
    });

    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  closeImportPanel() {
    const panel = document.getElementById('import-panel');
    panel.classList.add('hidden');
    panel.innerHTML = '';
  },

  async fixAndersonStores() {
    const btn = document.getElementById('tool-anderson-btn') || document.getElementById('fix-anderson-btn');
    const targets = this.records.filter(r =>
      r.store && /^Anderson\s+/i.test(r.store)
    );
    if (!targets.length) {
      Toast.show('No records with Anderson prefix — all clear', 'success');
      return;
    }
    if (!confirm(`Found ${targets.length} record${targets.length>1?'s':''} with "Anderson " in the store name.\n\nStrip the prefix from all of them?`)) return;

    if (btn) { btn.textContent = 'Migrating…'; btn.disabled = true; }
    let done = 0, failed = 0;
    for (const r of targets) {
      try {
        const newStore = r.store.replace(/^Anderson\s+/i, '').trim();
        await updateDoc(doc(db, 'purchases', r.id), { store: newStore });
        r.store = newStore;
        done++;
      } catch(e) { console.error(e); failed++; }
    }
    if (btn) { btn.textContent = '🔧 Strip Anderson prefix'; btn.disabled = false; }
    if (failed === 0) Toast.show(`Fixed ${done} record${done>1?'s':''}`, 'success');
    else Toast.show(`${done} fixed, ${failed} failed`, 'error');
    this.renderRows();
  },

  async fixOldFinancials() {
    const btn = document.getElementById('fix-old-financials-btn') || document.getElementById('tool-oldfinance-btn');
    const targets = this.records.filter(r =>
      r.source !== 'ICO' &&
      (!r.purchasePrice && r.purchasePrice !== 0) &&
      (!r.date || r.date < '2026-05-01')
    );
    if (!targets.length) {
      Toast.show('No records to migrate — all clear', 'success');
      return;
    }
    if (!confirm(`Found ${targets.length} pre-May 2025 non-ICO record${targets.length>1?'s':''} with no financial data.\n\nStamp purchasePrice: 0 on all of them to clear the ⚠ flag?`)) return;

    if (btn) { btn.textContent = 'Migrating…'; btn.disabled = true; }
    let done = 0, failed = 0;
    for (const r of targets) {
      try {
        await updateDoc(doc(db, 'purchases', r.id), { purchasePrice: 0 });
        r.purchasePrice = 0;
        done++;
      } catch(e) { console.error(e); failed++; }
    }
    if (btn) { btn.textContent = '🔧 Run one-time migration'; btn.disabled = false; }
    if (failed === 0) Toast.show(`Migrated ${done} records`, 'success');
    else Toast.show(`${done} migrated, ${failed} failed`, 'error');
    this.renderRows();
  },

  async fixSerialDates() {
    const btn = document.getElementById('fix-serials-btn');
    const bad = this.records.filter(r => this.isExcelSerial(String(r.date || '').trim()));
    if (!bad.length) {
      Toast.show('No Excel serial dates found — all clear', 'success');
      return;
    }
    if (!confirm(`Found ${bad.length} record${bad.length > 1 ? 's' : ''} with Excel serial dates. Convert them now?\n\nExample: "${bad[0].date}" → "${this.excelSerialToDate(bad[0].date)}"`)) return;

    btn.textContent = 'Fixing…'; btn.disabled = true;
    let fixed = 0, failed = 0;

    for (const r of bad) {
      try {
        const newDate = this.excelSerialToDate(String(r.date).trim());
        if (!newDate) { failed++; continue; }
        await updateDoc(doc(db, 'purchases', r.id), { date: newDate });
        r.date = newDate; // update local copy
        fixed++;
      } catch(e) {
        console.error('Fix failed for', r.id, e);
        failed++;
      }
    }

    btn.textContent = '🔧 Fix serial dates in database'; btn.disabled = false;
    if (failed === 0) Toast.show(`Fixed ${fixed} date${fixed > 1 ? 's' : ''}`, 'success');
    else Toast.show(`Fixed ${fixed}, failed ${failed}`, 'error');
    this.renderRows(); // refresh table
  },

  readCSV(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const rows = this.parseCSV(e.target.result);
      this.showPreview(rows);
    };
    reader.readAsText(file);
  },

  parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    // Detect separator — tab-separated if header has tabs
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const headers = lines[0].split(sep).map(h => h.trim().replace(/^\uFEFF/, '')); // strip BOM

    const headerMap = {
      'date':     'date',
      'stock #':  'stock',
      'stock#':   'stock',
      'stock':    'stock',
      'year':     'year',
      'make':     'make',
      'model':    'model',
      'vin':      'vin',
      'source':   'source',
      'store':    'store',
      'comments': 'comments',
      'comment':  'comments',
      'notes':    'comments',
    };

    const fieldNames = headers.map(h => headerMap[h.toLowerCase()] || null);

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = sep === '\t' ? line.split('\t') : this.splitCSV(line);
      const row  = {};
      fieldNames.forEach((field, idx) => {
        if (field) row[field] = (cols[idx] || '').trim();
      });

      if (!row.stock) continue;

      const rawDate = row.date;
      if (row.date) {
        row._wasSerial = this.isExcelSerial(String(rawDate).trim());
        row.date = this.normalizeDate(row.date);
      }
      if (row.vin)  row.vin  = row.vin.toUpperCase();
      if (row.year) row.year = parseInt(row.year) || '';

      rows.push(row);
    }
    return rows;
  },

  splitCSV(line) {
    const result = [];
    let cur = '', inQuote = false;
    for (const c of line) {
      if (c === '"') { inQuote = !inQuote; }
      else if (c === ',' && !inQuote) { result.push(cur); cur = ''; }
      else { cur += c; }
    }
    result.push(cur);
    return result;
  },

  excelSerialToDate(serial) {
    // Excel serial: days since Jan 0 1900, with a known leap-year bug (treating 1900 as leap)
    const n = parseInt(serial);
    if (isNaN(n) || n < 1) return null;
    // Adjust for Excel's leap-year bug: subtract 1 extra day for dates after Feb 28 1900
    const adj    = n > 59 ? n - 1 : n;
    const epoch  = new Date(1900, 0, 1);  // Jan 1 1900
    const date   = new Date(epoch.getTime() + (adj - 1) * 86400000);
    const y      = date.getFullYear();
    const m      = String(date.getMonth() + 1).padStart(2, '0');
    const d      = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  isExcelSerial(raw) {
    // Excel serials for years 2000-2035 fall roughly between 36526 and 49672
    const n = parseInt(String(raw).trim());
    return !isNaN(n) && n >= 36526 && n <= 50000 && String(raw).trim() === String(n);
  },

  normalizeDate(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Excel serial number — auto-convert
    if (this.isExcelSerial(s)) return this.excelSerialToDate(s) || s;
    // M/D/YYYY or MM/DD/YYYY
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    // M/D/YY
    const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (m2) return `${2000 + parseInt(m2[3])}-${m2[1].padStart(2,'0')}-${m2[2].padStart(2,'0')}`;
    return s;
  },

  showPreview(rows) {
    const preview = document.getElementById('import-preview');
    if (!rows.length) {
      preview.innerHTML = `<div class="import-empty">No valid rows found. Make sure your file has a header row and at least one row with a Stock # value.</div>`;
      return;
    }

    const validSources = SOURCES.map(s => s.toLowerCase());
    const validStores  = STORES.map(s => s.toLowerCase());
    const annotated    = rows.map(r => ({
      ...r,
      _warnSource:    r.source && !validSources.includes(r.source.toLowerCase()),
      _warnStore:     r.store  && !validStores.includes(r.store.toLowerCase()),
      _warnSerialDate: r._wasSerial || false,
    }));
    const warnings     = annotated.filter(r => r._warnSource || r._warnStore).length;
    const serialDates  = annotated.filter(r => r._warnSerialDate).length;

    preview.innerHTML = `
      <div class="import-preview-header">
        <div class="import-preview-count">
          <strong>${rows.length}</strong> rows ready
          ${warnings ? `<span class="import-warn-badge">⚠ ${warnings} unrecognized source/store — will import as-is</span>` : ''}
          ${serialDates ? `<span class="import-warn-badge" style="background:var(--accent-light);color:var(--accent);border-color:var(--accent-mid)">📅 ${serialDates} Excel serial date${serialDates>1?'s':''} auto-converted</span>` : ''}
        </div>
        <button class="btn-import-confirm" id="btn-import-confirm">Import ${rows.length} records →</button>
      </div>
      <div class="import-table-wrap">
        <table class="import-table">
          <thead><tr>
            <th>Date</th><th>Stock #</th><th>Year</th><th>Make</th><th>Model</th>
            <th>VIN</th><th>Source</th><th>Store</th><th>Comments</th>
          </tr></thead>
          <tbody>
            ${annotated.map(r => `<tr class="${r._warnSource || r._warnStore ? 'import-row-warn' : r._warnSerialDate ? 'import-row-serial' : ''}">
              <td>${r.date || '—'}${r._warnSerialDate ? ' <span style="font-size:9px;color:var(--accent);font-weight:700">converted</span>' : ''}</td>
              <td style="font-family:var(--font-mono);font-size:11px;font-weight:600">${r.stock || '—'}</td>
              <td>${r.year || '—'}</td>
              <td>${r.make || '—'}</td>
              <td>${r.model || '—'}</td>
              <td style="font-family:var(--font-mono);font-size:10px;color:var(--text-3)">${r.vin || '—'}</td>
              <td><span class="src-badge src-${(r.source||'').replace(/\s/g,'')}">${r.source || '—'}</span></td>
              <td>${r.store || '—'}</td>
              <td style="color:var(--text-3);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.comments || ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('btn-import-confirm')
      .addEventListener('click', () => this.confirmImport(rows));
  },

  async confirmImport(rows) {
    const buyer = document.getElementById('import-buyer').value;
    if (!buyer) {
      Toast.show('Select a buyer before importing', 'error');
      document.getElementById('import-buyer').focus();
      return;
    }

    // Filter out rows whose VIN already exists in the database
    const existingVins = new Set(
      this.records
        .filter(r => r.vin && r.vin.trim().length > 3)
        .map(r => r.vin.trim().toUpperCase())
    );

    const dupes    = rows.filter(r => r.vin && existingVins.has(r.vin.trim().toUpperCase()));
    const newRows  = rows.filter(r => !r.vin || !existingVins.has(r.vin.trim().toUpperCase()));

    if (dupes.length > 0 && newRows.length === 0) {
      Toast.show(`All ${dupes.length} rows are already in the database — nothing to import`, 'error');
      return;
    }

    if (dupes.length > 0) {
      const dupList = dupes.slice(0, 5).map(r => `  • ${r.vin} (${r.year} ${r.make} ${r.model})`).join('\n');
      const more    = dupes.length > 5 ? `\n  … and ${dupes.length - 5} more` : '';
      const go      = confirm(
        `${dupes.length} duplicate VIN${dupes.length > 1 ? 's' : ''} will be skipped:\n${dupList}${more}\n\nImport the remaining ${newRows.length} record${newRows.length !== 1 ? 's' : ''}?`
      );
      if (!go) return;
    }

    const btn = document.getElementById('btn-import-confirm');
    btn.textContent = 'Importing…';
    btn.disabled = true;

    const col = collection(db, 'purchases');
    let success = 0, failed = 0;

    for (let i = 0; i < newRows.length; i += 10) {
      const chunk = newRows.slice(i, i + 10);
      await Promise.all(chunk.map(async r => {
        try {
          await addDoc(col, {
            date:      r.date     || '',
            stock:     r.stock    || '',
            year:      r.year     || '',
            make:      r.make     || '',
            model:     r.model    || '',
            vin:       r.vin      || '',
            source:    r.source   || '',
            store:     r.store    || '',
            notes:     r.comments || '',
            buyer,
            arb:       null,
            createdAt: new Date().toISOString(),
          });
          success++;
        } catch(e) {
          console.error('Row failed:', e, r);
          failed++;
        }
      }));
    }

    if (failed === 0) {
      const skippedMsg = dupes.length > 0 ? ` (${dupes.length} duplicate${dupes.length > 1 ? 's' : ''} skipped)` : '';
      Toast.show(`Imported ${success} record${success !== 1 ? 's' : ''}${skippedMsg}`, 'success');
      this.closeImportPanel();
    } else {
      Toast.show(`${success} imported, ${failed} failed`, 'error');
      btn.textContent = `Retry (${failed} failed)`;
      btn.disabled = false;
    }
  },
};

export default Purchases;

function today() { return new Date().toISOString().slice(0, 10); }

// ---- PDF generation (print-to-PDF via browser) ---------------------------------
Purchases.printPDF = function(r) {
  const arb   = r.arb || {};
  const price = parseFloat(r.purchasePrice) || 0;
  const trans = parseFloat(r.transport)     || 0;
  const fees  = parseFloat(r.fees)          || 0;
  const total = price + trans + fees;
  const arbRec= parseFloat(arb.amountReceived) || 0;
  const net   = total - arbRec;
  const fmt   = n => n ? '$' + Number(n).toLocaleString() : '—';
  const hasArb = r.arb !== null && r.arb !== undefined;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Purchase Order — ${r.stock || ''}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #111; padding: 40px; max-width: 700px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 12px; color: #666; margin-bottom: 28px; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
    color: #888; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .field label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #888; }
  .field p { font-size: 13px; font-weight: 500; margin-top: 2px; }
  .cost-table { width: 100%; border-collapse: collapse; }
  .cost-table td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
  .cost-table td:last-child { text-align: right; font-family: monospace; }
  .cost-table .total-row td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; font-size: 14px; }
  .cost-table .net-row td { font-weight: 700; color: #1d4ed8; border-bottom: none; font-size: 15px; }
  .cost-table .arb-row td { color: #16a34a; }
  .notes { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px;
    font-size: 13px; color: #444; min-height: 48px; }
  .vin { font-family: monospace; font-size: 12px; letter-spacing: 0.05em; }
  @media print {
    body { padding: 20px; }
    button { display: none; }
  }
</style>
</head>
<body>
  <h1>Purchase Order</h1>
  <div class="subtitle">Generated ${new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})}</div>

  <div class="section">
    <div class="section-title">Vehicle information</div>
    <div class="grid">
      <div class="field"><label>Stock #</label><p>${r.stock || '—'}</p></div>
      <div class="field"><label>Date purchased</label><p>${r.date || '—'}</p></div>
      <div class="field"><label>Year</label><p>${r.year || '—'}</p></div>
      <div class="field"><label>Source</label><p>${r.source || '—'}</p></div>
      <div class="field"><label>Make</label><p>${r.make || '—'}</p></div>
      <div class="field"><label>Store</label><p>${r.store || '—'}</p></div>
      <div class="field"><label>Model</label><p>${r.model || '—'}</p></div>
      <div class="field"><label>Buyer</label><p>${r.buyer || '—'}</p></div>
      <div class="field" style="grid-column:1/-1"><label>VIN</label><p class="vin">${r.vin || '—'}</p></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Cost breakdown</div>
    <table class="cost-table">
      <tr><td>Purchase price</td><td>${fmt(r.purchasePrice)}</td></tr>
      <tr><td>Transport</td><td>${fmt(r.transport)}</td></tr>
      <tr><td>Fees</td><td>${fmt(r.fees)}</td></tr>
      <tr class="total-row"><td>Total cost</td><td>${total ? fmt(total) : '—'}</td></tr>
      ${hasArb && arbRec ? `<tr class="arb-row"><td>Arb recovery (received)</td><td>−${fmt(arbRec)}</td></tr>
      <tr class="net-row"><td>Net cost</td><td>${fmt(net)}</td></tr>` : ''}
    </table>
  </div>

  ${hasArb ? `<div class="section">
    <div class="section-title">Arbitration</div>
    <div class="grid">
      <div class="field"><label>Issue</label><p>${arb.issue || '—'}</p></div>
      <div class="field"><label>Status</label><p>${arb.status || '—'}</p></div>
      <div class="field"><label>Amount requested</label><p>${fmt(arb.amount)}</p></div>
      <div class="field"><label>Amount received</label><p>${fmt(arb.amountReceived)}</p></div>
      <div class="field"><label>Date filed</label><p>${arb.dateFiled || '—'}</p></div>
      ${arb.dateUnwound ? `<div class="field"><label>Date unwound</label><p>${arb.dateUnwound}</p></div>` : ''}
      <div class="field"><label>Resolution</label><p>${arb.resolution || '—'}</p></div>
    </div>
  </div>` : ''}

  ${r.notes ? `<div class="section">
    <div class="section-title">Notes</div>
    <div class="notes">${r.notes}</div>
  </div>` : ''}
</body>
</html>`;

  const win = window.open('', '_blank', 'width=800,height=900');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
};
