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
  storeFilter: 'all',
  psDateFrom:  '',
  psDateTo:    '',

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

      <div style="border-top:2px solid var(--border);margin-top:28px;padding-top:24px">
        <div class="page-title" style="font-size:18px;margin-bottom:4px">Pay Scale Calculator</div>
        <div class="page-sub" style="margin-bottom:16px">Calculates buyer pay based on auction and ICO purchases by store.</div>
        <div class="rep-controls">
          <div class="rep-control-group">
            <label class="rep-label">Date range</label>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="date" id="ps-from" value="${this.psDateFrom}" class="rep-input">
              <span style="color:var(--text-4);font-size:12px">to</span>
              <input type="date" id="ps-to"   value="${this.psDateTo}"   class="rep-input">
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:flex-end">
            <button class="auc-btn-primary" id="ps-generate">Calculate pay</button>
            <button class="auc-btn-secondary" id="ps-pdf" style="display:none">⎙ Print / PDF</button>
          </div>
        </div>
        <div id="ps-output"></div>
      </div>
    `;

    document.getElementById('rep-from').addEventListener('change', e => { this.dateFrom = e.target.value; });
    document.getElementById('rep-to').addEventListener('change',   e => { this.dateTo   = e.target.value; });
    document.getElementById('rep-store').addEventListener('change', e => { this.storeFilter = e.target.value; });
    document.getElementById('rep-generate').addEventListener('click', () => this.generate());
    document.getElementById('ps-from')?.addEventListener('change', e => { this.psDateFrom = e.target.value; });
    document.getElementById('ps-to')?.addEventListener('change',   e => { this.psDateTo   = e.target.value; });
    document.getElementById('ps-generate')?.addEventListener('click', () => this.generatePayScale());
    document.getElementById('ps-pdf')?.addEventListener('click', () => this.printPayScale());
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
    // Normalize store names: strip Anderson prefix, lowercase, trim
    const normalizeStore = s => (s || '').trim().toLowerCase().replace(/^anderson\s+/, '');
    const storeMatch = s => !store || normalizeStore(s.store || s) === normalizeStore(store);

    const fmt = d => {
      if (!d) return '—';
      const [y,m,day] = d.slice(0,10).split('-');
      return `${m}/${day}/${y}`;
    };

    // Money OUT: purchases in range for this store
    const moneyOut = this.purchases
      .filter(r => (!store || normalizeStore(r.store) === normalizeStore(store)) && this.inRange(r.date))
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
    // Auction stores have 'Anderson ' prefix (e.g. 'Anderson Toyota') while purchases just use 'Toyota'
    // Match if either equals the other, or one contains the other
    const moneyIn = onlineSales
      .filter(s => storeMatch(s) && this.inRange(s.soldAt))
      .map(s => ({
        date:    s.soldAt,
        dateFmt: fmt(s.soldAt),
        stock:   s.stock || '—',
        vehicle: `${s.year || ''} ${s.make || ''} ${s.model || ''}`.trim(),
        platform: s.platform || '—',
        amount:  s.amount,
      }));

    // Money IN: unwound vehicles
    // Fall back to dateFiled if dateUnwound not set (older records)
    const unwound = this.purchases
      .filter(r => {
        if (!r.arb || r.arb.status !== 'Unwound') return false;
        if (!storeMatch(r)) return false;
        const date = r.arb.dateUnwound || r.arb.dateFiled || null;
        return this.inRange(date);
      })
      .map(r => {
        const date = r.arb.dateUnwound || r.arb.dateFiled || null;
        return {
          date,
          dateFmt:  fmt(date),
          stock:    r.stock || '—',
          vehicle:  `${r.year || ''} ${r.make || ''} ${r.model || ''}`.trim(),
          platform: 'Unwind',
          amount:   parseFloat(r.arb.amountReceived) || 0,
          note:     'Vehicle returned',
        };
      });

    // Money IN: won/closed arbs with money received
    const arbReceived = this.purchases
      .filter(r => {
        if (!r.arb) return false;
        if (!['Won', 'Closed'].includes(r.arb.status)) return false;
        if (!(parseFloat(r.arb.amountReceived) > 0)) return false;
        if (!storeMatch(r)) return false;
        // Use dateFiled as the date anchor (no separate "received" date yet)
        return this.inRange(r.arb.dateFiled);
      })
      .map(r => ({
        date:     r.arb.dateFiled,
        dateFmt:  fmt(r.arb.dateFiled),
        stock:    r.stock || '—',
        vehicle:  `${r.year || ''} ${r.make || ''} ${r.model || ''}`.trim(),
        platform: `Arb — ${r.arb.status}`,
        amount:   parseFloat(r.arb.amountReceived) || 0,
        note:     r.arb.issue || '',
      }));

    // Pending arbs: Open cases only
    const pending = this.purchases
      .filter(r => r.arb &&
        r.arb.status === 'Open' &&
        storeMatch(r) &&
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
    const allMoneyIn = [...moneyIn, ...unwound, ...arbReceived].sort((a,b) => (a.date||'').localeCompare(b.date||''));
    const totalIn    = allMoneyIn.reduce((a, r) => a + r.amount, 0);
    const net        = totalIn + totalOut; // totalOut is negative

    return { store, moneyOut, moneyIn: allMoneyIn, pending, totalOut, totalIn, net };
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


  // ---- Pay Scale Calculator ----------------------------------

  // Bump thresholds: each fires $500 when total ICO crosses it
  ICO_THRESHOLDS: [10, 14, 18, 22, 26, 30, 36, 44],

  calcBumpPool(totalICO) {
    return this.ICO_THRESHOLDS.filter(t => totalICO > t - 0.1).length * 500;
  },

  generatePayScale() {
    if (!this.psDateFrom || !this.psDateTo) {
      Toast.show('Select a date range first', 'error'); return;
    }
    if (!this.loaded.purchases) {
      Toast.show('Data still loading — try again in a moment', 'error'); return;
    }

    // Filter purchases to date range
    const inRange = r => (r.date || '') >= this.psDateFrom && (r.date || '') <= this.psDateTo;
    const ranged  = this.purchases.filter(inRange);

    // Split by buyer
    const buyers = [...new Set(this.purchases.map(r => r.buyer).filter(Boolean))].sort();
    if (!buyers.length) {
      document.getElementById('ps-output').innerHTML =
        `<div class="auc-empty" style="margin-top:12px"><div class="auc-empty-sub">No purchases with buyer data found.</div></div>`;
      return;
    }

    const html = buyers.map(buyer => {
      const recs = ranged.filter(r => r.buyer === buyer);
      return this.payScaleHTML(buyer, recs);
    }).join('');

    document.getElementById('ps-output').innerHTML = html;
    document.getElementById('ps-pdf').style.display = '';
  },

  payScaleHTML(buyer, recs) {
    const fmt     = n => '$' + Number(n).toLocaleString();
    const fmtFlt  = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    // Count auction and ICO per store
    const storeData = STORES.map(store => {
      const auction = recs.filter(r => r.store === store && r.source !== 'ICO').length;
      const ico     = recs.filter(r => r.store === store && r.source === 'ICO').length;
      return { store, auction, ico };
    }).filter(s => s.auction > 0 || s.ico > 0);

    const totalAuction = storeData.reduce((a, s) => a + s.auction, 0);
    const totalICO     = storeData.reduce((a, s) => a + s.ico,     0);
    const totalUnits   = totalAuction + totalICO;
    const bumpPool     = this.calcBumpPool(totalICO);
    const bumpPerICO   = totalICO > 0 ? bumpPool / totalICO : 0;
    // Every vehicle is $50 flat; ICO vehicles get additional bump bonus on top

    // Per-store pay
    const storeRows = storeData.map(s => {
      const auctionPay = s.auction * 50;
      const icoPay     = s.ico * 50; // base $50 same as auction
      const bumpBonus  = s.ico * bumpPerICO; // additional bump share
      const total      = auctionPay + icoPay + bumpBonus;
      return { ...s, auctionPay, icoPay, total };
    });

    const totalPay    = storeRows.reduce((a, s) => a + s.total, 0);
    const auctionPay  = storeRows.reduce((a, s) => a + s.auctionPay, 0);
    const icoPay      = storeRows.reduce((a, s) => a + s.icoPay, 0);
    const totalBonus  = storeRows.reduce((a, s) => a + s.bumpBonus, 0);

    // Which bumps fired
    const bumpsFired = this.ICO_THRESHOLDS.filter(t => totalICO > t - 0.1);
    const bumpsPending = this.ICO_THRESHOLDS.filter(t => totalICO <= t - 0.1);
    const nextBump = bumpsPending[0] || null;

    return `
      <div class="rep-store-block" style="margin-top:16px">
        <div class="rep-store-header">
          <div class="rep-store-name">${buyer}</div>
          <div class="rep-store-meta">${this.psDateFrom} – ${this.psDateTo}</div>
        </div>

        <!-- Summary stats -->
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px">
          <div class="auc-stat"><div class="auc-stat-val">${totalUnits}</div><div class="auc-stat-label">Total units (@$50)</div></div>
          <div class="auc-stat"><div class="auc-stat-val">${totalICO}</div><div class="auc-stat-label">ICO units</div></div>
          <div class="auc-stat ${bumpPool > 0 ? 'auc-stat-green' : ''}">
            <div class="auc-stat-val">${fmt(bumpPool)}</div>
            <div class="auc-stat-label">ICO bump pool</div>
          </div>
          <div class="auc-stat">
            <div class="auc-stat-val" style="font-size:18px">${fmtFlt(bumpPerICO)}</div>
            <div class="auc-stat-label">Bonus per ICO unit</div>
          </div>
          <div class="auc-stat auc-stat-green">
            <div class="auc-stat-val" style="font-size:20px">${fmt(totalPay)}</div>
            <div class="auc-stat-label">Total pay</div>
          </div>
        </div>

        <!-- Bump tier status -->
        <div style="margin-bottom:14px">
          <div class="rep-section-title" style="color:var(--text-2);border-bottom:1px solid var(--border);margin-bottom:8px">ICO Bump Tiers</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${this.ICO_THRESHOLDS.map(t => {
              const fired = totalICO > t - 0.1;
              return `<span style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;
                border:1.5px solid ${fired ? 'var(--green-mid)' : 'var(--border)'};
                background:${fired ? 'var(--green-bg)' : 'var(--bg-raised)'};
                color:${fired ? 'var(--green)' : 'var(--text-3)'}">
                ${fired ? '✓' : '○'} ${t} ICO = +$500
              </span>`;
            }).join('')}
          </div>
          ${nextBump ? `<div style="font-size:11px;color:var(--text-3);margin-top:8px">
            Next bump at <strong>${nextBump} ICO</strong> — need <strong>${nextBump - totalICO}</strong> more
          </div>` : `<div style="font-size:11px;color:var(--green);margin-top:8px;font-weight:600">
            🎉 All bump tiers achieved! Maximum $4,000 pool.
          </div>`}
        </div>

        <!-- Per-store breakdown -->
        <div class="rep-section-title rep-in" style="margin-bottom:8px">Per Store Breakdown</div>
        <table class="rep-table">
          <thead><tr>
            <th>Store</th>
            <th class="rep-amt">Auction</th>
            <th class="rep-amt">ICO</th>
            <th class="rep-amt">Units pay (@$50 each)</th>
            <th class="rep-amt">ICO bump bonus</th>
            <th class="rep-amt">Store total</th>
          </tr></thead>
          <tbody>
            ${storeRows.map(s => `
              <tr>
                <td style="font-weight:500">${s.store}</td>
                <td class="rep-amt">${s.auction}</td>
                <td class="rep-amt">${s.ico}</td>
                <td class="rep-amt">${fmt((s.auction + s.ico) * 50)}</td>
                <td class="rep-amt rep-in-amt">${s.bumpBonus > 0 ? fmtFlt(s.bumpBonus) : '—'}</td>
                <td class="rep-amt" style="font-weight:700">${fmt(s.total)}</td>
              </tr>`).join('')}
            <tr class="rep-subtotal">
              <td>Total</td>
              <td class="rep-amt">${totalAuction}</td>
              <td class="rep-amt">${totalICO}</td>
              <td class="rep-amt">${fmt(totalUnits * 50)}</td>
              <td class="rep-amt rep-in-amt">${fmtFlt(totalBonus)}</td>
              <td class="rep-amt">${fmt(totalPay)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  },

  printPayScale() {
    const content = document.getElementById('ps-output')?.innerHTML || '';
    const dateLabel = `${this.psDateFrom} to ${this.psDateTo}`;
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Pay Scale — ${dateLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 32px; }
  .rep-store-block { margin-bottom: 40px; page-break-inside: avoid; }
  .rep-store-header { display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 16px; }
  .rep-store-name { font-size: 18px; font-weight: 700; }
  .rep-store-meta { font-size: 11px; color: #666; }
  .rep-section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 6px 0 5px; margin-top: 14px; color: #15803d;
    border-bottom: 1px solid #bbf7d0; }
  .rep-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; }
  .rep-table th { padding: 5px 8px; font-size: 9px; font-weight: 700; letter-spacing: 0.05em;
    text-transform: uppercase; color: #666; border-bottom: 1px solid #e5e7eb; text-align: left; }
  .rep-table td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; }
  .rep-amt { text-align: right; font-family: monospace; }
  .rep-in-amt { color: #15803d; font-weight: 600; }
  .rep-subtotal td { font-weight: 700; border-top: 1.5px solid #111; border-bottom: none; }
  .auc-stat { text-align:center; padding:10px; border:1px solid #e5e7eb; border-radius:6px; }
  .auc-stat-val { font-size:22px; font-weight:700; }
  .auc-stat-label { font-size:10px; color:#666; text-transform:uppercase; letter-spacing:0.05em; margin-top:2px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-size:20px;font-weight:700">Pay Scale Report</div>
    <div style="font-size:13px;color:#666;margin-top:4px">${dateLabel}</div>
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

  // ---- PDF (financial ledger) --------------------------------
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
