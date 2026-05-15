// ============================================================
//  reports.js — Weekly financial ledger per store
//
//  Data sources:
//   - purchases/{id}            → money out (purchases + arbs)
//   - auction_sessions/{id}     → online listing sales (active)
//   - auction_archives/{id}     → online listing sales (archived)
// ============================================================

import { db, collection, onSnapshot } from './firebase.js';
import { STORES, Toast } from './constants.js';

let unsubPurchases = null;
let unsubSessions  = null;
let unsubArchives  = null;

const Reports = {

  purchases:   [],
  sessions:    [],
  archives:    [],
  loaded:      { purchases: false, sessions: false, archives: false },

  dateFrom:    '',
  dateTo:      '',
  storeFilter: 'all', // 'all' or a store name

  render(container) {
    this._cleanup();
    window.Reports = this;

    // Default date range: current week Mon–Sun
    const now   = new Date();
    const day   = now.getDay();
    const mon   = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));
    const sun   = new Date(mon); sun.setDate(mon.getDate() + 6);
    const fmt   = d => d.toISOString().slice(0, 10);
    if (!this.dateFrom) this.dateFrom = fmt(mon);
    if (!this.dateTo)   this.dateTo   = fmt(sun);

    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="page-title">Reports</div>
          <div class="page-sub">Financial ledger by store for bank controllers.</div>
        </div>
      </div>

      <div class="rep-controls">
        <div class="rep-control-group">
          <label class="rep-label">Date range</label>
          <div style="display:flex;align-items:center;gap:8px">
            <input type="date" id="rep-from" value="${this.dateFrom}" class="rep-input">
            <span style="color:var(--text-4);font-size:12px">to</span>
            <input type="date" id="rep-to"   value="${this.dateTo}"   class="rep-input">
          </div>
        </div>
        <div class="rep-control-group">
          <label class="rep-label">Store</label>
          <select id="rep-store" class="rep-input">
            <option value="all">All stores</option>
            ${STORES.map(s => `<option value="${s}" ${this.storeFilter===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <button class="auc-btn-primary" id="rep-generate">Generate report</button>
          <button class="auc-btn-secondary" id="rep-pdf" style="display:none">⎙ Print / PDF</button>
        </div>
      </div>

      <div id="rep-output"></div>
    `;

    document.getElementById('rep-from').addEventListener('change', e => { this.dateFrom = e.target.value; });
    document.getElementById('rep-to').addEventListener('change',   e => { this.dateTo   = e.target.value; });
    document.getElementById('rep-store').addEventListener('change', e => { this.storeFilter = e.target.value; });
    document.getElementById('rep-generate').addEventListener('click', () => this.generate());
    document.getElementById('rep-pdf').addEventListener('click', () => this.printPDF());

    this.subscribeAll();

    // Show loading state until all sources are ready
    const checkReady = setInterval(() => {
      if (this.loaded.purchases && this.loaded.sessions && this.loaded.archives) {
        clearInterval(checkReady);
        const btn = document.getElementById('rep-generate');
        if (btn) btn.textContent = 'Generate report';
      }
    }, 200);
    const btn = document.getElementById('rep-generate');
    if (btn) btn.textContent = 'Loading data…';
  },

  subscribeAll() {
    // Purchases
    unsubPurchases = onSnapshot(collection(db, 'purchases'), snap => {
      this.purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      this.loaded.purchases = true;
    }, err => console.error('Reports purchases error:', err));

    // Active auction sessions (for online listings not yet archived)
    unsubSessions = onSnapshot(collection(db, 'auction_sessions'), snap => {
      this.sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      this.loaded.sessions = true;
    }, err => console.error('Reports sessions error:', err));

    // Archives (for online listings in closed sessions)
    unsubArchives = onSnapshot(collection(db, 'auction_archives'), snap => {
      this.archives = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      this.loaded.archives = true;
    }, err => console.error('Reports archives error:', err));
  },

  _cleanup() {
    if (unsubPurchases) { unsubPurchases(); unsubPurchases = null; }
    if (unsubSessions)  { unsubSessions();  unsubSessions  = null; }
    if (unsubArchives)  { unsubArchives();   unsubArchives  = null; }
    this.loaded = { purchases: false, sessions: false, archives: false };
  },

  // ---- Data gathering ----------------------------------------

  getOnlineSales() {
    // Collect from active sessions
    const sales = [];
    this.sessions.forEach(session => {
      (session.vehicles || []).forEach(v => {
        const ol = v.onlineListing;
        if (!ol || ol.status !== 'sold') return;
        sales.push({
          stock:    v.stock,
          year:     v.year,
          make:     v.make,
          model:    v.model,
          store:    v.store || '',
          platform: ol.soldOn,
          amount:   parseFloat(ol.soldPrice) || 0,
          cost:     parseFloat(ol.cost)      || 0,
          soldAt:   ol.soldAt || new Date().toISOString().slice(0,10),
          source:   'session',
        });
      });
    });

    // Collect from archives
    this.archives.forEach(archive => {
      (archive.onlineListings || []).forEach(ol => {
        if (!ol.status?.startsWith('Sold')) return;
        sales.push({
          stock:    ol.stock,
          year:     ol.year,
          make:     ol.make,
          model:    ol.model,
          store:    ol.store || '',
          platform: ol.winningPlatform || ol.status?.replace('Sold — ', ''),
          amount:   parseFloat(ol.soldPrice || ol.winningBid) || 0,
          cost:     parseFloat(ol.cost)  || 0,
          soldAt:   ol.soldAt || archive.archivedAt?.slice(0,10) || null,
          source:   'archive',
        });
      });
    });

    return sales;
  },

  inRange(dateStr) {
    if (!dateStr) return false;
    const d = dateStr.slice(0, 10);
    return (!this.dateFrom || d >= this.dateFrom) &&
           (!this.dateTo   || d <= this.dateTo);
  },

  // ---- Report generation -------------------------------------

  generate() {
    if (!this.dateFrom || !this.dateTo) {
      Toast.show('Select a date range first', 'error'); return;
    }
    if (!this.loaded.purchases || !this.loaded.sessions || !this.loaded.archives) {
      Toast.show('Data still loading — try again in a moment', 'error'); return;
    }

    const stores = this.storeFilter === 'all' ? STORES : [this.storeFilter];
    const onlineSales = this.getOnlineSales();

    // Debug: show in output so we can see what data is found
    const dbg = {
      sessions: this.sessions.length,
      sessionVehicles: this.sessions.reduce((a,s) => a + (s.vehicles||[]).length, 0),
      onlineListings: this.sessions.reduce((a,s) => a + (s.vehicles||[]).filter(v=>v.onlineListing).length, 0),
      soldListings: this.sessions.reduce((a,s) => a + (s.vehicles||[]).filter(v=>v.onlineListing?.status==='sold').length, 0),
      onlineSalesFound: onlineSales.length,
      dateRange: `${this.dateFrom} to ${this.dateTo}`,
      salesInRange: onlineSales.filter(s => this.inRange(s.soldAt)).length,
    };
    console.log('Reports debug:', dbg);
    document.getElementById('rep-output').innerHTML = `
      <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 16px;font-family:var(--font-mono);font-size:11px;margin-bottom:16px;color:var(--text-2)">
        <strong>Debug:</strong> ${JSON.stringify(dbg, null, 2).replace(/\n/g,'<br>').replace(/ /g,'&nbsp;')}
      </div>`;

    const storeData = stores.map(store => this.buildStoreData(store, onlineSales));
    // Filter out stores with no data if showing all
    const active = this.storeFilter === 'all'
      ? storeData.filter(s => s.moneyOut.length || s.moneyIn.length || s.pending.length)
      : storeData;

    if (!active.length) {
      document.getElementById('rep-output').innerHTML =
        `<div class="auc-empty" style="margin-top:24px"><div class="auc-empty-sub">No transactions found for this date range${this.storeFilter !== 'all' ? ' and store' : ''}.</div></div>`;
      document.getElementById('rep-pdf').style.display = 'none';
      return;
    }

    document.getElementById('rep-output').innerHTML = active.map(s => this.storeHTML(s)).join('');
    document.getElementById('rep-pdf').style.display = '';
  },

  buildStoreData(store, onlineSales) {
    const fmt = d => {
      if (!d) return '—';
      const [y,m,day] = d.slice(0,10).split('-');
      return `${m}/${day}/${y}`;
    };

    // Money OUT: purchases in range for this store
    const moneyOut = this.purchases
      .filter(r => r.store === store && this.inRange(r.date))
      .map(r => {
        const price = parseFloat(r.purchasePrice) || 0;
        const trans = parseFloat(r.transport)     || 0;
        const fees  = parseFloat(r.fees)          || 0;
        const total = price + trans + fees;
        return {
          date:    r.date,
          dateFmt: fmt(r.date),
          stock:   r.stock || '—',
          vehicle: `${r.year || ''} ${r.make || ''} ${r.model || ''}`.trim(),
          vin:     r.vin || '',
          lines: [
            ...(price ? [{ label: 'Purchase price', amount: -price }] : []),
            ...(trans ? [{ label: 'Transport',       amount: -trans  }] : []),
            ...(fees  ? [{ label: 'Fees',            amount: -fees   }] : []),
          ],
          total: -total,
        };
      })
      .filter(r => r.lines.length > 0);

    // Money IN: online sales in range for this store
    const moneyIn = onlineSales
      .filter(s => s.store === store && this.inRange(s.soldAt))
      .map(s => ({
        date:    s.soldAt,
        dateFmt: fmt(s.soldAt),
        stock:   s.stock || '—',
        vehicle: `${s.year || ''} ${s.make || ''} ${s.model || ''}`.trim(),
        platform: s.platform || '—',
        amount:  s.amount,
      }));

    // Money IN: unwound vehicles in range for this store
    const unwound = this.purchases
      .filter(r => r.store === store && r.arb?.status === 'Unwound' && this.inRange(r.arb?.dateUnwound))
      .map(r => ({
        date:    r.arb.dateUnwound,
        dateFmt: fmt(r.arb.dateUnwound),
        stock:   r.stock || '—',
        vehicle: `${r.year || ''} ${r.make || ''} ${r.model || ''}`.trim(),
        platform: 'Unwind',
        amount:  parseFloat(r.arb.amountReceived) || 0,
        note:    'Vehicle returned',
      }));

    // Pending arbs: open cases filed on or before dateTo
    const pending = this.purchases
      .filter(r => r.store === store && r.arb &&
        ['Open'].includes(r.arb.status) &&
        (!this.dateTo || (r.arb.dateFiled || '') <= this.dateTo))
      .map(r => ({
        dateFmt:   fmt(r.arb.dateFiled),
        stock:     r.stock || '—',
        vehicle:   `${r.year || ''} ${r.make || ''} ${r.model || ''}`.trim(),
        issue:     r.arb.issue || '—',
        requested: parseFloat(r.arb.amount) || 0,
        received:  parseFloat(r.arb.amountReceived) || 0,
      }));

    // Totals
    const totalOut = moneyOut.reduce((a, r) => a + r.total, 0);
    const totalIn  = [...moneyIn, ...unwound].reduce((a, r) => a + r.amount, 0);
    const net      = totalIn + totalOut; // totalOut is negative

    return { store, moneyOut, moneyIn: [...moneyIn, ...unwound].sort((a,b) => (a.date||'').localeCompare(b.date||'')), pending, totalOut, totalIn, net };
  },

  storeHTML(s) {
    const fmt    = n => '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtNet = n => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const netColor = s.net >= 0 ? 'var(--green)' : 'var(--red)';

    const dateLabel = this.dateFrom === this.dateTo
      ? this.dateFrom
      : `${this.dateFrom} – ${this.dateTo}`;

    return `
      <div class="rep-store-block">
        <div class="rep-store-header">
          <div class="rep-store-name">${s.store}</div>
          <div class="rep-store-meta">${dateLabel}</div>
        </div>

        ${s.moneyOut.length ? `
        <div class="rep-section-title rep-out">▼ Money Out — Purchases</div>
        <table class="rep-table">
          <thead><tr><th>Date</th><th>Stock #</th><th>Vehicle</th><th>VIN</th><th>Transaction</th><th class="rep-amt">Amount</th></tr></thead>
          <tbody>
            ${s.moneyOut.map(r => r.lines.map((line, i) => `
              <tr>
                <td>${i === 0 ? r.dateFmt : ''}</td>
                <td style="font-family:var(--font-mono);font-size:11px">${i === 0 ? r.stock : ''}</td>
                <td>${i === 0 ? r.vehicle : ''}</td>
                <td style="font-family:var(--font-mono);font-size:10px;color:var(--text-3)">${i === 0 ? r.vin : ''}</td>
                <td style="color:var(--text-3)">${line.label}</td>
                <td class="rep-amt rep-out-amt">(${fmt(line.amount)})</td>
              </tr>`).join('')).join('')}
            <tr class="rep-subtotal">
              <td colspan="5">Total out</td>
              <td class="rep-amt rep-out-amt">(${fmt(s.totalOut)})</td>
            </tr>
          </tbody>
        </table>` : ''}

        ${s.moneyIn.length ? `
        <div class="rep-section-title rep-in">▲ Money In — Online Sales & Unwinds</div>
        <table class="rep-table">
          <thead><tr><th>Date</th><th>Stock #</th><th>Vehicle</th><th>Platform</th><th>Note</th><th class="rep-amt">Amount</th></tr></thead>
          <tbody>
            ${s.moneyIn.map(r => `
              <tr>
                <td>${r.dateFmt}</td>
                <td style="font-family:var(--font-mono);font-size:11px">${r.stock}</td>
                <td>${r.vehicle}</td>
                <td style="font-weight:600">${r.platform}</td>
                <td style="color:var(--text-3)">${r.note || ''}</td>
                <td class="rep-amt rep-in-amt">${fmt(r.amount)}</td>
              </tr>`).join('')}
            <tr class="rep-subtotal">
              <td colspan="5">Total in</td>
              <td class="rep-amt rep-in-amt">${fmt(s.totalIn)}</td>
            </tr>
          </tbody>
        </table>` : ''}

        ${s.pending.length ? `
        <div class="rep-section-title rep-pending">⏳ Pending — Open Arbitration</div>
        <table class="rep-table">
          <thead><tr><th>Filed</th><th>Stock #</th><th>Vehicle</th><th>Issue</th><th class="rep-amt">Requested</th><th class="rep-amt">Received</th></tr></thead>
          <tbody>
            ${s.pending.map(r => `
              <tr>
                <td>${r.dateFmt}</td>
                <td style="font-family:var(--font-mono);font-size:11px">${r.stock}</td>
                <td>${r.vehicle}</td>
                <td style="color:var(--text-3)">${r.issue}</td>
                <td class="rep-amt rep-pending-amt">${fmt(r.requested)}</td>
                <td class="rep-amt">${r.received ? fmt(r.received) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : ''}

        ${!s.moneyOut.length && !s.moneyIn.length && !s.pending.length ? `
          <div style="padding:20px;text-align:center;color:var(--text-4);font-size:13px">No transactions in this period.</div>
        ` : ''}

        <div class="rep-net" style="color:${netColor}">
          Net: <span>${fmtNet(s.net)}</span>
        </div>
      </div>
    `;
  },

  // ---- PDF ---------------------------------------------------
  printPDF() {
    const dateLabel = `${this.dateFrom} to ${this.dateTo}`;
    const storeLabel = this.storeFilter === 'all' ? 'All Stores' : this.storeFilter;
    const content = document.getElementById('rep-output')?.innerHTML || '';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Financial Report — ${storeLabel} — ${dateLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 32px; }
  .rep-store-block { margin-bottom: 40px; page-break-inside: avoid; }
  .rep-store-header { display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 16px; }
  .rep-store-name { font-size: 18px; font-weight: 700; }
  .rep-store-meta { font-size: 11px; color: #666; }
  .rep-section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 6px 0 4px; margin-top: 14px; }
  .rep-out     { color: #b91c1c; border-bottom: 1px solid #fecaca; }
  .rep-in      { color: #15803d; border-bottom: 1px solid #bbf7d0; }
  .rep-pending { color: #d97706; border-bottom: 1px solid #fde68a; }
  .rep-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; }
  .rep-table th { padding: 5px 8px; font-size: 9px; font-weight: 700; letter-spacing: 0.05em;
    text-transform: uppercase; color: #666; border-bottom: 1px solid #e5e7eb; text-align: left; }
  .rep-table td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; }
  .rep-amt { text-align: right; font-family: monospace; }
  .rep-out-amt { color: #b91c1c; }
  .rep-in-amt  { color: #15803d; }
  .rep-pending-amt { color: #d97706; }
  .rep-subtotal td { font-weight: 700; border-top: 1.5px solid #111; border-bottom: none; padding-top: 6px; }
  .rep-net { text-align: right; font-size: 15px; font-weight: 700; padding-top: 10px;
    border-top: 2px solid #111; margin-top: 8px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-size:20px;font-weight:700">Financial Report</div>
    <div style="font-size:13px;color:#666;margin-top:4px">${storeLabel} · ${dateLabel}</div>
    <div style="font-size:11px;color:#999;margin-top:2px">Generated ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
  </div>
  ${content}
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=1000');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  },
};

export default Reports;
