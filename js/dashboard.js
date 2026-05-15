// ============================================================
//  dashboard.js — Inventory tracking with Firestore persistence
//
//  Firestore path: inventory/{storeId}
//  Document fields: forecast, stockPct, currentInv, tracking
// ============================================================

import { db, doc, getDoc, setDoc, collection, onSnapshot } from './firebase.js';
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

  dashAucStore: '',
  _aucSession: null,

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
      <div id="dash-auction-stats"></div>
    `;

    this.attachListeners();
    await this.loadFromFirestore();
    this.subscribeAuctionStats();
  },

  subscribeAuctionStats() {
    const q = collection(db, 'auction_sessions');
    onSnapshot(q, snapshot => {
      const sessions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const active   = sessions.find(s => s.status !== 'archived');
      this._aucSession = active || null;
      this.renderAuctionStats(this._aucSession);
    }, err => {
      console.error('Auction stats error:', err);
    });
  },

  renderAuctionStats(session) {
    const el = document.getElementById('dash-auction-stats');
    if (!el) return;

    if (!session || !session.vehicles?.length) {
      el.innerHTML = `
        <div class="inv-section-title" style="margin-top:24px">Current auction</div>
        <div style="padding:20px;text-align:center;color:var(--text-4);font-size:13px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg)">
          No active auction session
        </div>`;
      return;
    }

    // Get unique stores from session vehicles
    const allStores = [...new Set(session.vehicles.map(v => v.store).filter(Boolean))].sort();

    // Apply store filter
    const v = this.dashAucStore
      ? session.vehicles.filter(r => r.store === this.dashAucStore)
      : session.vehicles;

    const sold       = v.filter(r => r.decision === 'auto' || r.decision === 'accepted');
    const onlineSold = v.filter(r => r.goOnline && r.onlineListing?.status === 'sold');
    const pending    = v.filter(r => r.decision === 'pending');
    const denied     = v.filter(r => r.decision === 'denied');
    const online     = v.filter(r => r.goOnline);

    let profit = null;
    sold.forEach(r => {
      const bid = parseFloat(r.maxBid)||0, cost = parseFloat(r.cost)||0;
      if (bid > 0 && cost > 0) profit = (profit||0) + (bid - cost);
    });
    onlineSold.forEach(r => {
      const price = parseFloat(r.onlineListing?.soldPrice)||0, cost = parseFloat(r.onlineListing?.cost)||0;
      if (price > 0 && cost > 0) profit = (profit||0) + (price - cost);
    });

    const updated = session.lastUpdated ? `· Updated ${session.lastUpdated}` : '';

    el.innerHTML = `
      <div class="inv-section-title" style="margin-top:24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div>
          Current auction
          <span style="font-size:11px;font-weight:400;color:var(--text-3);margin-left:8px">${session.label || ''} ${updated}</span>
        </div>
        ${allStores.length > 1 ? `
        <select id="dash-auc-store" style="background:var(--bg-raised);border:1.5px solid var(--border);border-radius:var(--r-md);padding:4px 8px;font-size:12px;font-family:var(--font-sans);color:var(--text-1);outline:none">
          <option value="">All stores</option>
          ${allStores.map(s => `<option value="${s}" ${this.dashAucStore===s?'selected':''}>${s}</option>`).join('')}
        </select>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-top:10px">
        <div class="auc-stat"><div class="auc-stat-val">${v.length}</div><div class="auc-stat-label">${this.dashAucStore ? this.dashAucStore : 'Total'}</div></div>
        <div class="auc-stat auc-stat-green"><div class="auc-stat-val">${sold.length + onlineSold.length}</div><div class="auc-stat-label">Sold</div></div>
        <div class="auc-stat auc-stat-amber"><div class="auc-stat-val">${pending.length}</div><div class="auc-stat-label">Pending</div></div>
        <div class="auc-stat"><div class="auc-stat-val">${denied.length}</div><div class="auc-stat-label">Denied</div></div>
        <div class="auc-stat"><div class="auc-stat-val">${online.length}</div><div class="auc-stat-label">Online</div></div>
        <div class="auc-stat ${profit===null?'':profit>=0?'auc-stat-green':'auc-stat-red'}">
          <div class="auc-stat-val" style="font-size:18px">${profit!==null?(profit>=0?'+$':'-$')+Math.abs(profit).toLocaleString():'—'}</div>
          <div class="auc-stat-label">Profit</div>
        </div>
      </div>
    `;

    // Bind store dropdown after render
    document.getElementById('dash-auc-store')?.addEventListener('change', e => {
      this.dashAucStore = e.target.value;
      this.renderAuctionStats(this._aucSession);
    });
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
      if (currentInv >= stockToNum)   statusPill = `<span class="status-pill pill-overstocked">Stocked</span>`;
      else if (neededNum > 5)         statusPill = `<span class="status-pill pill-critical">Extremely low</span>`;
      else if (neededNum > 1)         statusPill = `<span class="status-pill pill-low">Low</span>`;
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
