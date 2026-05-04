// ============================================================
//  dashboard.js — Inventory tracking with Firestore persistence
//
//  Firestore path: inventory/{storeId}
//  Document fields: forecast, stockPct, currentInv, tracking
// ============================================================

import { db, doc, getDoc, setDoc } from './firebase.js';
import { STORES, Toast } from './constants.js';

// Debounce timer per store so we don't write on every keystroke
const saveTimers = {};

const Dashboard = {

  state: {},

  initState() {
    // Called at render time, after all imports have resolved
    if (Object.keys(this.state).length === 0) {
      STORES.forEach(s => {
        this.state[s] = { forecast: '', stockPct: '', currentInv: '', tracking: '' };
      });
    }
  },

  async render(container) {
    this.initState();
    container.innerHTML = `
      <div class="page-header">
        <div class="page-title">Dashboard</div>
        <div class="page-sub">Inventory tracking — edit any cell to update calculations</div>
      </div>
      <div class="inv-section-title">Inventory tracking</div>
      <div class="inv-card">
        <table class="inv-table">
          <thead>
            <tr>
              <th style="text-align:left">Store</th>
              <th>Forecast</th>
              <th>Stock %</th>
              <th>Stock To</th>
              <th>Current Inv.</th>
              <th>Needed</th>
              <th style="text-align:left">Status</th>
              <th>Tracking</th>
              <th>% of Forecast</th>
            </tr>
          </thead>
          <tbody id="inv-body">
            ${STORES.map(s => this.rowHTML(s)).join('')}
          </tbody>
          <tfoot>${this.trackingRowHTML()}</tfoot>
        </table>
      </div>
    `;

    this.attachListeners();
    await this.loadFromFirestore();
  },

  // ---- Firestore load ----------------------------------------
  async loadFromFirestore() {
    try {
      const loads = STORES.map(async store => {
        const ref  = doc(db, 'inventory', store.replace(/\s+/g, '_'));
        const snap = await getDoc(ref);
        if (snap.exists()) {
          this.state[store] = { ...this.state[store], ...snap.data() };
        }
      });
      await Promise.all(loads);
      // Re-populate inputs with loaded data
      STORES.forEach(store => {
        const s = this.state[store];
        ['forecast','stockPct','currentInv','tracking'].forEach(field => {
          const input = document.querySelector(
            `input[data-store="${store}"][data-field="${field}"]`
          );
          if (input && s[field] !== '') input.value = s[field];
        });
        this.updateRow(store);
      });
      this.updateTotals();
    } catch (e) {
      console.error('Firestore load error:', e);
      Toast.show('Could not load inventory data', 'error');
    }
  },

  // ---- Firestore save (debounced 800ms) ----------------------
  saveStore(store) {
    clearTimeout(saveTimers[store]);
    saveTimers[store] = setTimeout(async () => {
      try {
        const ref = doc(db, 'inventory', store.replace(/\s+/g, '_'));
        await setDoc(ref, this.state[store], { merge: true });
      } catch (e) {
        console.error('Firestore save error:', e);
        Toast.show('Save failed — check connection', 'error');
      }
    }, 800);
  },

  // ---- Row HTML ----------------------------------------------
  rowHTML(store) {
    const s    = this.state[store];
    const calc = this.calcRow(s);
    return `
      <tr data-store="${store}">
        <td class="td-store">${store}</td>
        <td class="td-input"><input type="number" min="0" data-field="forecast"   data-store="${store}" value="${s.forecast}"   placeholder="0"></td>
        <td class="td-input"><input type="number" min="0" data-field="stockPct"   data-store="${store}" value="${s.stockPct}"   placeholder="0"></td>
        <td class="td-calc ${calc.stockTo !== '—' ? 'highlight' : ''}">${calc.stockTo}</td>
        <td class="td-input"><input type="number" min="0" data-field="currentInv" data-store="${store}" value="${s.currentInv}" placeholder="0"></td>
        <td class="td-calc ${calc.neededNum > 0 ? 'highlight' : ''}">${calc.needed}</td>
        <td class="td-status">${calc.statusPill}</td>
        <td class="td-input"><input type="number" min="0" data-field="tracking"   data-store="${store}" value="${s.tracking}"   placeholder="0"></td>
        <td class="td-calc ${calc.trackingPct !== '—' ? 'highlight' : ''}">${calc.trackingPct}</td>
      </tr>`;
  },

  trackingRowHTML() {
    const t = this.calcTotals();
    return `
      <tr class="tracking-row">
        <td class="td-store">Totals</td>
        <td class="td-calc" style="padding:10px 14px;text-align:right">${t.forecast}</td>
        <td class="td-calc" style="padding:10px 14px;text-align:right">—</td>
        <td class="td-calc" style="padding:10px 14px;text-align:right">${t.stockTo}</td>
        <td class="td-calc" style="padding:10px 14px;text-align:right">${t.currentInv}</td>
        <td class="td-calc" style="padding:10px 14px;text-align:right">${t.needed}</td>
        <td class="td-status"></td>
        <td class="td-calc" style="padding:10px 14px;text-align:right">${t.tracking}</td>
        <td class="td-calc" style="padding:10px 14px;text-align:right">${t.trackingPct}</td>
      </tr>`;
  },

  // ---- Calculations ------------------------------------------
  calcRow(s) {
    const forecast   = parseFloat(s.forecast);
    const stockPct   = parseFloat(s.stockPct);
    const currentInv = parseFloat(s.currentInv);
    const tracking   = parseFloat(s.tracking);
    const hasFC  = s.forecast   !== '' && !isNaN(forecast);
    const hasPct = s.stockPct   !== '' && !isNaN(stockPct);
    const hasInv = s.currentInv !== '' && !isNaN(currentInv);
    const hasTrk = s.tracking   !== '' && !isNaN(tracking);

    const stockToNum = (hasFC && hasPct) ? Math.round(forecast * stockPct / 100) : null;
    const stockTo    = stockToNum !== null ? stockToNum : '—';

    let neededNum = 0, needed = '—';
    if (stockToNum !== null && hasInv) {
      neededNum = Math.max(stockToNum - currentInv, 0);
      needed = neededNum;
    }

    let statusPill = `<span class="status-pill pill-nodata">No data</span>`;
    if (stockToNum !== null && hasInv) {
      const pct = stockToNum > 0 ? currentInv / stockToNum : 1;
      if (currentInv >= stockToNum)   statusPill = `<span class="status-pill pill-overstocked">Stocked</span>`;
      else if (pct < 0.75)             statusPill = `<span class="status-pill pill-critical">Critical — buy now</span>`;
      else if (pct < 0.9)             statusPill = `<span class="status-pill pill-low">Low — monitor closely</span>`;
      else                            statusPill = `<span class="status-pill pill-ok">On track</span>`;
    }

    const trackingPct = (hasFC && hasTrk && forecast > 0)
      ? Math.round(tracking / forecast * 100) + '%' : '—';

    return { stockTo, stockToNum, neededNum, needed, statusPill, trackingPct };
  },

  calcTotals() {
    let tFC=0, tST=0, tInv=0, tNeed=0, tTrk=0;
    let anyFC=false, anyST=false, anyInv=false, anyTrk=false;
    STORES.forEach(store => {
      const s = this.state[store];
      const c = this.calcRow(s);
      const fc=parseFloat(s.forecast), inv=parseFloat(s.currentInv), trk=parseFloat(s.tracking);
      if (s.forecast!==''&&!isNaN(fc))      { tFC+=fc;  anyFC=true; }
      if (c.stockToNum!==null)              { tST+=c.stockToNum; anyST=true; }
      if (s.currentInv!==''&&!isNaN(inv))   { tInv+=inv; anyInv=true; }
      if (c.stockToNum!==null&&s.currentInv!=='') tNeed+=c.neededNum;
      if (s.tracking!==''&&!isNaN(trk))     { tTrk+=trk; anyTrk=true; }
    });
    return {
      forecast:   anyFC  ? tFC  : '—',
      stockTo:    anyST  ? tST  : '—',
      currentInv: anyInv ? tInv : '—',
      needed:     (anyST&&anyInv) ? tNeed : '—',
      tracking:   anyTrk ? tTrk : '—',
      trackingPct: (anyFC&&anyTrk&&tFC>0) ? Math.round(tTrk/tFC*100)+'%' : '—',
    };
  },

  // ---- DOM updates -------------------------------------------
  attachListeners() {
    const inputs = Array.from(document.querySelectorAll('.inv-table input'));
    document.querySelectorAll('.td-input').forEach(td => {
      td.addEventListener('click', e => {
        if (e.target.tagName !== 'INPUT') td.querySelector('input').focus();
      });
    });
    inputs.forEach((input, idx) => {
      input.addEventListener('input', e => {
        const { store, field } = e.target.dataset;
        this.state[store][field] = e.target.value;
        this.updateRow(store);
        this.updateTotals();
        this.saveStore(store);
      });
      input.addEventListener('focus', e => e.target.select());
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const next = e.shiftKey ? inputs[idx-1] : inputs[idx+1];
          if (next) next.focus();
        }
      });
    });
  },

  updateRow(store) {
    const row = document.querySelector(`tr[data-store="${store}"]`);
    if (!row) return;
    const calc = this.calcRow(this.state[store]);
    row.cells[3].textContent = calc.stockTo;
    row.cells[3].className   = `td-calc${calc.stockTo !== '—' ? ' highlight' : ''}`;
    row.cells[5].textContent = calc.needed;
    row.cells[5].className   = `td-calc${calc.neededNum > 0 ? ' highlight' : ''}`;
    row.cells[6].innerHTML   = calc.statusPill;
    row.cells[8].textContent = calc.trackingPct;
    row.cells[8].className   = `td-calc${calc.trackingPct !== '—' ? ' highlight' : ''}`;
  },

  updateTotals() {
    const t = this.calcTotals();
    const fRow = document.querySelector('.tracking-row');
    if (!fRow) return;
    fRow.cells[1].textContent = t.forecast;
    fRow.cells[3].textContent = t.stockTo;
    fRow.cells[4].textContent = t.currentInv;
    fRow.cells[5].textContent = t.needed;
    fRow.cells[7].textContent = t.tracking;
    fRow.cells[8].textContent = t.trackingPct;
  },
};

export default Dashboard;
