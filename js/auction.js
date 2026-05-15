// ============================================================
//  auction.js
// ============================================================

import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from './firebase.js';
import { Toast } from './constants.js';

const Auction = {
  vautoData: {}, vehicles: [], sessionId: null, sessionLabel: '',
  filterStatus: 'all', filterStore: '', wsFilterStore: '', pastSessions: [],
  wholesaleView: false, lastUpdated: null, selectedRows: new Set(),

  render(container) {
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
    window.Auction = this;
    this.container = container;

    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="page-title">Auction</div>
          <div class="page-sub">Upload extracts, track live bids, archive when complete.</div>
        </div>
        <div id="auc-header-btn"></div>
      </div>
      <div id="auc-workspace"><div style="padding:40px;text-align:center;color:var(--text-4)">Loading…</div></div>
    `;

    // NOTE: do NOT reset sessionId here — it persists from previous navigation
    // subscribeSessions will immediately fire and set correct state
    this.vautoData    = {};
    this.selectedRows = new Set();

    this.subscribeSessions();
  },


  showWorkspace() {
    const ws  = document.getElementById('auc-workspace');
    const btn = document.getElementById('auc-header-btn');
    if (!ws) return;

    if (this.sessionId) {
      if (btn) btn.innerHTML = '';  // Archive btn is inside renderSession header
      this.renderSession(ws);
    } else {
      if (btn) btn.innerHTML = `<button class="auc-btn-primary" onclick="Auction.showNewSession()">+ New auction</button>`;
      ws.innerHTML = `
        <div class="auc-empty">
          <div class="auc-empty-icon">🏷️</div>
          <div class="auc-empty-title">No active auction</div>
          <div class="auc-empty-sub">Start a new auction session to begin uploading and tracking bids.</div>
          <button class="auc-btn-primary" onclick="Auction.showNewSession()">+ New auction</button>
        </div>`;
    }
  },

  showNewSession() {
    if (this.sessionId) {
      Toast.show('An active auction already exists — archive it first', 'error');
      return;
    }
    const ws = document.getElementById('auc-workspace');
    ws.innerHTML = `
      <div class="auc-setup-card">
        <div class="auc-setup-title">New auction session</div>
        <div class="auc-setup-fields">
          <div class="auc-field-group">
            <label>Date</label>
            <input type="date" id="auc-date" value="${new Date().toISOString().slice(0,10)}">
          </div>
          <div class="auc-field-group">
            <label>Label <span style="color:var(--text-4);font-weight:400">(optional)</span></label>
            <input type="text" id="auc-label" placeholder="e.g. May 11 — Anderson Toyota">
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="auc-btn-primary" id="auc-create-btn">Create session</button>
          <button class="auc-btn-secondary" onclick="Auction.showWorkspace()">Cancel</button>
        </div>
      </div>`;
    document.getElementById('auc-create-btn').addEventListener('click', () => this.createSession());
  },

  async createSession() {
    const date  = document.getElementById('auc-date').value;
    const label = document.getElementById('auc-label').value.trim() || `Auction — ${date}`;
    const btn   = document.getElementById('auc-create-btn');
    btn.textContent = 'Creating…'; btn.disabled = true;
    try {
      const ref = await addDoc(collection(db, 'auction_sessions'), {
        date, label, vehicles: [], createdAt: new Date().toISOString(),
      });
      this.sessionId = ref.id; this.sessionLabel = label;
      this.vehicles = []; this.vautoData = {};
      this.filterStatus = 'all'; this.filterStore = ''; this.wsFilterStore = '';
      Toast.show('Session created', 'success');
      // subscribeSessions will pick up the new session automatically
    } catch(e) {
      console.error(e); Toast.show('Failed to create session', 'error');
      btn.textContent = 'Create session'; btn.disabled = false;
    }
  },

  renderSession(container) {
    if (!container) return;
    const hasV     = this.vehicles.length > 0;
    const hasVauto = Object.keys(this.vautoData).length > 0;
    const s        = this.calcStats();

    container.innerHTML = `
      <div class="auc-session-header">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="auc-session-label" id="auc-session-label-text">${this.sessionLabel}</div>
              <button class="auc-link-btn" id="auc-rename-btn" title="Rename session">✎</button>
            </div>
            <div class="auc-session-meta">
              <span class="auc-pill auc-pill-active">Active</span>
              ${hasV ? `${this.vehicles.length} vehicles` : 'No vehicles yet'}
              ${this.lastUpdated ? `<span style="font-size:11px;color:var(--text-4)">· Updated ${this.lastUpdated}</span>` : ''}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="auc-tab-btn${!this.wholesaleView?' active':''}" onclick="Auction.setView(false)">Auction results</button>
          <button class="auc-tab-btn${this.wholesaleView?' active':''}" onclick="Auction.setView(true)">Online listings${this.vehicles.filter(v=>v.goOnline).length>0?` <span class='auc-tab-count'>${this.vehicles.filter(v=>v.goOnline).length}</span>`:''}</button>
          <div style="width:1px;height:20px;background:var(--border);margin:0 2px"></div>
          <button class="auc-btn-secondary" id="auc-archive-btn">Archive session</button>
          ${hasV ? `
            <div style="width:1px;height:20px;background:var(--border);margin:0 2px"></div>
            <button class="auc-btn-secondary" onclick="Auction.exportManagerReview()">↓ Manager review</button>
            <button class="auc-btn-secondary" onclick="Auction.exportTitleClerk()">↓ Title clerk</button>
            <button class="auc-btn-secondary" onclick="Auction.exportOnlineListings()">↓ Online listings</button>
          ` : ''}
        </div>
      </div>

      ${hasV ? `
      <div class="auc-stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="auc-stat auc-stat-green">
          <div class="auc-stat-val">${s.sold}</div>
          <div class="auc-stat-label">Sold${s.onlineSold > 0 ? ` <span style="font-size:10px;font-weight:400;color:var(--green)">(${s.auctionSold} auction · ${s.onlineSold} online)</span>` : ''}</div>
        </div>
        <div class="auc-stat">
          <div class="auc-stat-val">${s.unsold}</div>
          <div class="auc-stat-label">Unsold</div>
        </div>
        <div class="auc-stat ${s.soldProfit === null ? '' : s.soldProfit >= 0 ? 'auc-stat-green' : 'auc-stat-red'}">
          <div class="auc-stat-val" style="font-size:20px">${s.soldProfit !== null ? (s.soldProfit>=0?'+$':'-$')+Math.abs(s.soldProfit).toLocaleString() : '—'}</div>
          <div class="auc-stat-label">Combined profit</div>
        </div>
      </div>

      <!-- Store breakdown -->
      ${this.calcStoreBreakdown().length > 1 ? `
      <div class="auc-store-breakdown">
        <div class="auc-breakdown-title" onclick="this.parentElement.querySelector('.auc-breakdown-body').classList.toggle('hidden')">
          By store <span style="font-size:11px;color:var(--text-3);font-weight:400;margin-left:4px">▾ toggle</span>
        </div>
        <div class="auc-breakdown-body hidden">
          <table class="auc-breakdown-table">
            <thead><tr><th>Store</th><th>Total</th><th>Sold</th><th>Unsold</th><th>Profit (sold units)</th></tr></thead>
            <tbody>
              ${this.calcStoreBreakdown().map(row => `<tr>
                <td style="font-weight:500">${row.store}</td>
                <td style="font-family:var(--font-mono)">${row.total}</td>
                <td style="font-family:var(--font-mono);color:var(--green)">${row.sold}</td>
                <td style="font-family:var(--font-mono);color:var(--text-3)">${row.unsold}</td>
                <td style="font-family:var(--font-mono);font-weight:600;color:${row.profit===null?'var(--text-3)':row.profit>=0?'var(--green)':'var(--red)'}">
                  ${row.profit!==null?(row.profit>=0?'+$':'-$')+Math.abs(row.profit).toLocaleString():'—'}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : ''}
      ` : ''}



      ${this.wholesaleView
        ? this.renderWholesale()
        : hasV ? `
      <!-- Selection action bar — appears when rows selected -->
      <div class="auc-action-bar${this.selectedRows.size > 0 ? ' visible' : ''}" id="auc-action-bar">
        <span class="auc-action-bar-count">${this.selectedRows.size} selected</span>
        <span style="color:var(--border);font-size:16px">|</span>
        <span style="font-size:12px;font-weight:500;color:var(--text-2)">Action:</span>
        <button class="auc-filter-btn" id="action-send-online">Send to Online</button>
        <button class="auc-filter-btn" id="action-remove-online">Remove from Online</button>
        <button class="auc-filter-btn" style="margin-left:4px;color:var(--text-3)" id="action-clear-sel">Clear selection</button>
      </div>

      <div class="auc-filter-bar">
        <input type="checkbox" id="auc-select-all" class="auc-chk" title="Select all visible"
          ${this.selectedRows.size > 0 && this.selectedRows.size === this.getFiltered().length ? 'checked' : ''}>
        ${['all','sold','unsold','nosale'].map(f => `
          <button class="auc-filter-btn${this.filterStatus===f?' active':''}" onclick="Auction.setFilter('${f}')">
            ${{all:'All',sold:'Sold',unsold:'Unsold',nosale:'No sale'}[f]}
          </button>`).join('')}
        <select class="auc-store-select" onchange="Auction.filterStore=this.value;Auction.renderSession(document.getElementById('auc-workspace'))">
          <option value="">All stores</option>
          ${this.getStores(this.vehicles).map(s => `<option value="${s}" ${this.filterStore===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <label class="auc-upload-btn" title="${hasVauto?'Vauto loaded':'Upload Vauto'}">
          📊 ${hasVauto?'Vauto ✓':'Vauto'}
          <input type="file" id="vauto-file" accept=".xlsx,.csv" style="display:none">
        </label>
        <label class="auc-upload-btn" title="Upload auction extract">
          🏷️ Extract
          <input type="file" id="extract-file" accept=".xlsx,.csv" style="display:none">
        </label>
        <span style="font-size:12px;color:var(--text-3);margin-left:auto">${this.getFiltered().length} of ${this.vehicles.length}</span>
        <button class="auc-filter-btn" onclick="Auction.openAddVehicleModal()">+ Add</button>
      </div>
      ${this.renderTable()}` : ''}
    `;

    document.getElementById('vauto-file')?.addEventListener('change', e => {
      if (e.target.files[0]) this.loadFile(e.target.files[0], 'vauto');
    });
    document.getElementById('extract-file')?.addEventListener('change', e => {
      if (e.target.files[0]) this.loadFile(e.target.files[0], 'extract');
    });
    document.getElementById('auc-archive-btn')?.addEventListener('click', () => this.archiveSession());
    document.getElementById('auc-rename-btn')?.addEventListener('click', () => this.renameSession());
    document.getElementById('auc-select-all')?.addEventListener('change', e => {
      const filtered = this.getFiltered();
      if (e.target.checked) filtered.forEach(r => this.selectedRows.add(r.stock));
      else this.selectedRows.clear();
      this.renderSession(document.getElementById('auc-workspace'));
    });
    document.getElementById('action-send-online')?.addEventListener('click', () => {
      this.vehicles.filter(v => this.selectedRows.has(v.stock)).forEach(v => {
        v.goOnline = true;
        if (!v.onlineListing) {
          v.onlineListing = {
            stock:         v.stock,
            year:          v.year,
            make:          v.make,
            model:         v.model,
            color:         v.color || '',
            vin:           v.vin   || '',
            store:         v.store || '',
            cost:          v.cost  || null,
            book:          v.book  || null,
            mmr:           v.mmr   || null,
            auctionHighBid: v.maxBid || null,
            openlane:      null,
            acv:           null,
            manheim:       null,
            onlineReserve: null,
            status:        'active',
            soldOn:        null,
            soldPrice:     null,
          };
        }
      });
      this.selectedRows.clear();
      this.saveSession();
      this.renderSession(document.getElementById('auc-workspace'));
      Toast.show('Sent to Online listings', 'success');
    });
    document.getElementById('action-remove-online')?.addEventListener('click', () => {
      this.vehicles.filter(v => this.selectedRows.has(v.stock)).forEach(v => {
        v.goOnline = false;
        v.onlineListing = null;
      });
      this.selectedRows.clear();
      this.saveSession();
      this.renderSession(document.getElementById('auc-workspace'));
      Toast.show('Removed from Online listings');
    });
    document.getElementById('action-clear-sel')?.addEventListener('click', () => {
      this.selectedRows.clear();
      this.renderSession(document.getElementById('auc-workspace'));
    });

    // Delegated listeners for auction table buttons
    const aucTable = container.querySelector('.auc-table tbody');
    if (aucTable) {
      aucTable.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]') || e.target.closest('.auc-delete-row');
        if (!btn) return;
        const action   = btn.dataset.action;
        const idx      = parseInt(btn.dataset.stock);
        const filtered = this.wholesaleView
          ? this.vehicles.filter(v => v.goOnline && v.onlineListing)
          : this.getFiltered();
        const rec      = filtered[idx];
        if (!rec) return;
        if (action === 'accept')    this.setDecision(rec.stock, 'accepted');
        if (action === 'deny')      this.setDecision(rec.stock, 'denied');
        if (action === 'delete')    this.deleteVehicle(rec.stock);
        if (action === 'selectRow') {
          if (btn.checked) this.selectedRows.add(rec.stock);
          else             this.selectedRows.delete(rec.stock);
          // Update action bar without full re-render
          const bar = document.getElementById('auc-action-bar');
          const cnt = document.querySelector('.auc-action-bar-count');
          if (bar) bar.classList.toggle('visible', this.selectedRows.size > 0);
          if (cnt) cnt.textContent = this.selectedRows.size + ' selected';
          return; // skip full re-render for perf
        }
        if (action === 'sell') {
          const platform = btn.dataset.platform;
          const val      = parseFloat(btn.dataset.val);
          this.sellVehicle(rec.stock, platform, val);
        }
        if (action === 'unsell') {
          this.unsellVehicle(rec.stock);
        }
      });
      // Delegated listener for wholesale bid inputs
      aucTable.addEventListener('change', e => {
        const input = e.target.closest('[data-bid-stock]');
        if (!input) return;
        const wsIdx    = parseInt(input.dataset.bidStock);
        const platform = input.dataset.bidPlatform;
        const wslist   = this.vehicles.filter(v => v.goOnline && v.onlineListing && v.onlineListing.status !== 'sold');
        const rec      = wslist[wsIdx];
        if (rec) this.updateBid(rec.stock, platform, input.value);
      });
    }
  },

  setFilter(f) {
    this.filterStatus = f;
    this.renderSession(document.getElementById('auc-workspace'));
  },

  setView(wholesale) {
    this.wholesaleView = wholesale;
    this.renderSession(document.getElementById('auc-workspace'));
  },

  getStores(list) {
    return [...new Set((list||[]).map(v => v.store).filter(Boolean))].sort();
  },

  getFiltered() {
    const v = this.vehicles, f = this.filterStatus;
    let result = f === 'sold'   ? v.filter(r => r.decision === 'auto' || r.decision === 'accepted')
               : f === 'unsold' ? v.filter(r => r.decision !== 'auto' && r.decision !== 'accepted' && r.decision !== 'nosale')
               : f === 'nosale' ? v.filter(r => r.decision === 'nosale')
               : v;
    if (this.filterStore) result = result.filter(r => r.store === this.filterStore);
    return result;
  },

  calcStats() {
    const v = this.vehicles;

    // Auction sold
    const auctionSold   = v.filter(r => r.decision === 'auto' || r.decision === 'accepted');
    const auctionUnsold = v.filter(r => r.decision !== 'auto' && r.decision !== 'accepted');

    // Online sold
    const onlineSold = v.filter(r => r.goOnline && r.onlineListing?.status === 'sold');

    // Combined sold count (avoid double-counting: auction-sold can't also be online-sold)
    const totalSold   = auctionSold.length + onlineSold.length;
    const totalUnsold = v.length - totalSold;

    // Profit: auction sold
    let soldProfit = null;
    auctionSold.forEach(r => {
      const bid  = parseFloat(r.maxBid) || 0;
      const cost = parseFloat(r.cost)   || 0;
      if (bid > 0 && cost > 0) soldProfit = (soldProfit || 0) + (bid - cost);
    });

    // Profit: online sold
    onlineSold.forEach(r => {
      const price = parseFloat(r.onlineListing.soldPrice) || 0;
      const cost  = parseFloat(r.onlineListing.cost)      || 0;
      if (price > 0 && cost > 0) soldProfit = (soldProfit || 0) + (price - cost);
    });

    return {
      total:      v.length,
      sold:       totalSold,
      unsold:     totalUnsold,
      soldProfit,
      auctionSold: auctionSold.length,
      onlineSold:  onlineSold.length,
    };
  },

  calcStoreBreakdown() {
    const fmt = n => n !== null ? (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString() : '—';
    const stores = [...new Set(this.vehicles.map(v => v.store).filter(Boolean))].sort();
    return stores.map(store => {
      const sv = this.vehicles.filter(v => v.store === store);
      const auctionSold = sv.filter(v => v.decision === 'auto' || v.decision === 'accepted');
      const onlineSold  = sv.filter(v => v.goOnline && v.onlineListing?.status === 'sold');
      const totalSold   = auctionSold.length + onlineSold.length;
      let profit = null;
      auctionSold.forEach(v => {
        const bid = parseFloat(v.maxBid)||0, cost = parseFloat(v.cost)||0;
        if (bid > 0 && cost > 0) profit = (profit||0) + (bid - cost);
      });
      onlineSold.forEach(v => {
        const price = parseFloat(v.onlineListing.soldPrice)||0, cost = parseFloat(v.onlineListing.cost)||0;
        if (price > 0 && cost > 0) profit = (profit||0) + (price - cost);
      });
      return { store, total: sv.length, sold: totalSold, unsold: sv.length - totalSold, profit };
    });
  },

  renderTable() {
    const rows = this.getFiltered().map((r,i) => ({...r, _idx: i}));
    if (!rows.length) return `<div class="auc-empty" style="margin-top:12px"><div class="auc-empty-sub">No vehicles match this filter.</div></div>`;
    return `
      <div class="auc-table-wrap">
        <table class="auc-table">
          <thead><tr>
            <th style='width:32px'></th><th>Stock #</th><th>Vehicle</th><th>Store</th><th>Reserve</th>
            <th>Bid</th><th>Cost / Book / MMR</th>
            <th>Profit</th><th>Reserve</th><th>Status</th><th style='width:24px'></th><th style='width:24px'></th>
          </tr></thead>
          <tbody>${rows.map(r => this.rowHTML(r)).join('')}</tbody>
        </table>
      </div>`;
  },

  rowHTML(r) {
    const bid     = parseFloat(r.maxBid)  || 0;
    const reserve = parseFloat(r.reserve) || 0;
    const cost    = parseFloat(r.cost)    || 0;
    const profit  = bid > 0 && cost > 0 ? bid - cost : null;
    const hitRes  = bid > 0 && reserve > 0 && bid >= reserve;
    const pc      = profit === null ? 'var(--text-3)' : profit >= 0 ? 'var(--green)' : 'var(--red)';
    const fmt     = n => '$' + Number(n).toLocaleString();
    const isSold  = r.decision === 'auto' || r.decision === 'accepted';

    // Left border color by status
    const borderColor = isSold                    ? 'var(--green)'
                      : r.decision === 'denied'   ? 'var(--red)'
                      : r.decision === 'nosale'   ? 'var(--amber)'
                      : r.decision === 'pending'  ? 'var(--amber)'
                      : 'transparent';

    // Status text — sold/denied/nosale/pending, no pill
    let statusText, actions;
    if (isSold) {
      statusText = `<span style="color:var(--green);font-weight:600;font-size:12px">Sold</span>`;
      actions    = `<span class="auc-link deny" data-action="deny" data-stock="${r._idx}">[Deny]</span>`;
    } else if (r.decision === 'denied') {
      statusText = `<span style="color:var(--red);font-weight:600;font-size:12px">Denied</span>`;
      actions    = `<span class="auc-link accept" data-action="accept" data-stock="${r._idx}">[Accept]</span>`;
    } else if (r.decision === 'nosale') {
      statusText = `<span style="color:var(--amber);font-weight:600;font-size:12px">No sale</span>`;
      actions    = `<span class="auc-link accept" data-action="accept" data-stock="${r._idx}">[Accept]</span>`;
    } else if (r.decision === 'pending') {
      statusText = `<span style="color:var(--amber);font-weight:500;font-size:12px">Pending</span>`;
      actions    = bid > 0
        ? `<span class="auc-link accept" data-action="accept" data-stock="${r._idx}">[Accept]</span>
           <span class="auc-link deny"   data-action="deny"   data-stock="${r._idx}">[Deny]</span>`
        : '';
    } else {
      statusText = `<span style="color:var(--text-4);font-size:11px">—</span>`;
      actions = '';
    }

    // Reserve status — text only, no badge
    const resText = hitRes
      ? `<span style="color:var(--green);font-size:11px">✓ Hit</span>`
      : bid > 0
        ? `<span style="color:var(--amber);font-size:11px">Below</span>`
        : `<span style="color:var(--text-4);font-size:11px">—</span>`;

    return `<tr class="auc-row" style="border-left:3px solid ${borderColor}">
      <td style="padding:10px 8px 10px 12px">
        <input type="checkbox" class="auc-chk auc-row-chk" data-action="selectRow" data-stock="${r._idx}" ${this.selectedRows.has(r.stock)?'checked':''}>
      </td>
      <td style="font-family:var(--font-mono);font-size:11px;font-weight:600">${r.stock}</td>
      <td><div style="font-weight:500">${r.year} ${r.make} ${r.model}</div>
          <div style="font-size:11px;color:var(--text-3)">${r.color||''}</div></td>
      <td style="font-size:11px;color:var(--text-2)">${r.store||'—'}</td>
      <td style="font-family:var(--font-mono);font-size:11px">${reserve > 0 ? fmt(reserve) : '—'}</td>
      <td>
        <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${bid>0?'var(--text-1)':'var(--text-3)'}">${bid>0?fmt(bid):'No bid'}</div>
        ${r.bidBy ? `<div style="font-size:11px;color:var(--text-3)">${r.bidBy}</div>` : ''}
      </td>
      <td style="font-family:var(--font-mono);font-size:11px;line-height:1.7">
        <span style="color:var(--text-2);font-weight:600">${r.cost?fmt(r.cost):'—'}</span><br>
        <span style="color:var(--text-3);font-size:10px">${r.book?fmt(r.book):'—'}</span><br>
        <span style="color:var(--text-3);font-size:10px">${r.mmr ?fmt(r.mmr) :'—'}</span>
      </td>
      <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${pc}">${profit!==null?(profit>=0?'+':'')+fmt(profit):'—'}</td>
      <td>${resText}</td>
      <td>
        <div>${statusText}</div>
        <div style="display:flex;gap:6px;margin-top:2px">${actions}</div>
      </td>
      <td style="text-align:center">
        ${r.goOnline ? '<span class="auc-online-dot" title="Flagged for online listing">●</span>' : ''}
      </td>
      <td><span class="auc-delete-row" data-action="delete" data-stock="${r._idx}" title="Remove vehicle">✕</span></td>
    </tr>`;
  },

  setDecision(stock, decision) {
    const v = this.vehicles.find(r => r.stock === stock);
    if (!v) return;
    v.decision = decision;
    this.saveSession();
    this.renderSession(document.getElementById('auc-workspace'));
    Toast.show(`${stock} — ${decision}`, 'success');
  },

  toggleOnline(stock, checked) {
    const v = this.vehicles.find(r => r.stock === stock);
    if (!v) return;
    v.goOnline = checked;
    if (checked && !v.onlineListing) {
      v.onlineListing = {
        stock: v.stock, year: v.year, make: v.make, model: v.model,
        color: v.color||'', vin: v.vin||'', store: v.store||'',
        cost: v.cost||null, book: v.book||null, mmr: v.mmr||null,
        auctionHighBid: v.maxBid||null,
        openlane: null, acv: null, manheim: null, onlineReserve: null,
        status: 'active', soldOn: null, soldPrice: null,
      };
    } else if (!checked) {
      v.onlineListing = null;
    }
    this.saveSession();
    this.renderSession(document.getElementById('auc-workspace'));
  },

  deleteVehicle(stock) {
    if (!confirm(`Remove ${stock} from this session?`)) return;
    this.vehicles = this.vehicles.filter(v => v.stock !== stock);
    this.saveSession();
    this.renderSession(document.getElementById('auc-workspace'));
    Toast.show(`${stock} removed`);
  },

  openAddVehicleModal() {
    const stores = this.getStores(this.vehicles);
    const storeOpts = (stores.length ? stores : ['Chevrolet','Chrysler','Ford BHC','Ford Kingman','Honda','Nissan','Toyota'])
      .map(s => `<option>${s}</option>`).join('');
    let overlay = document.getElementById('auc-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'auc-modal-overlay';
      overlay.className = 'auc-modal-overlay';
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="auc-modal">
        <div class="auc-modal-header">
          <div class="auc-modal-title">Add vehicle manually</div>
          <button class="auc-modal-close" onclick="document.getElementById('auc-modal-overlay').classList.add('hidden')">✕</button>
        </div>
        <div class="auc-modal-body">
          <div class="auc-setup-fields" style="grid-template-columns:1fr 1fr;gap:12px">
            <div class="auc-field-group"><label>Stock #</label><input type="text" id="av-stock" placeholder="e.g. Z3490"></div>
            <div class="auc-field-group"><label>Store</label><select id="av-store"><option value="">— Store —</option>${storeOpts}</select></div>
            <div class="auc-field-group"><label>Year</label><input type="number" id="av-year" placeholder="${new Date().getFullYear()}" style="-moz-appearance:textfield"></div>
            <div class="auc-field-group"><label>Make</label><input type="text" id="av-make" placeholder="Toyota"></div>
            <div class="auc-field-group"><label>Model</label><input type="text" id="av-model" placeholder="Tacoma"></div>
            <div class="auc-field-group"><label>Color</label><input type="text" id="av-color" placeholder="Silver"></div>
            <div class="auc-field-group"><label>VIN</label><input type="text" id="av-vin" placeholder="17-char VIN" maxlength="17" style="text-transform:uppercase"></div>
            <div class="auc-field-group"><label>Reserve ($)</label><input type="number" id="av-reserve" placeholder="0" style="-moz-appearance:textfield"></div>
            <div class="auc-field-group"><label>Cost ($)</label><input type="number" id="av-cost" placeholder="0" style="-moz-appearance:textfield"></div>
            <div class="auc-field-group"><label>Book ($)</label><input type="number" id="av-book" placeholder="0" style="-moz-appearance:textfield"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
            <button class="auc-btn-primary" id="av-save-btn">Add vehicle</button>
            <button class="auc-btn-secondary" onclick="document.getElementById('auc-modal-overlay').classList.add('hidden')">Cancel</button>
          </div>
        </div>
      </div>`;
    overlay.classList.remove('hidden');
    document.getElementById('av-save-btn').addEventListener('click', () => this.saveAddVehicle());
  },

  saveAddVehicle() {
    const stock = document.getElementById('av-stock').value.trim();
    const store = document.getElementById('av-store').value;
    if (!stock) { Toast.show('Stock # required', 'error'); return; }
    if (!store) { Toast.show('Select a store', 'error'); return; }
    if (this.vehicles.find(v => v.stock === stock)) { Toast.show(`${stock} already exists in this session`, 'error'); return; }
    this.vehicles.push({
      stock,
      store,
      year:    parseInt(document.getElementById('av-year').value)    || '',
      make:    document.getElementById('av-make').value.trim(),
      model:   document.getElementById('av-model').value.trim(),
      color:   document.getElementById('av-color').value.trim(),
      vin:     document.getElementById('av-vin').value.trim().toUpperCase(),
      reserve: parseFloat(document.getElementById('av-reserve').value) || 0,
      cost:    parseFloat(document.getElementById('av-cost').value)    || null,
      book:    parseFloat(document.getElementById('av-book').value)    || null,
      mmr:     null, maxBid: 0, bidBy: '', decision: 'nosale', goOnline: false, onlineListing: null,
    });
    this.saveSession();
    document.getElementById('auc-modal-overlay')?.classList.add('hidden');
    this.renderSession(document.getElementById('auc-workspace'));
    Toast.show(`${stock} added`, 'success');
  },

  // ---- Online listings ------------------------------------
  renderWholesale() {
    const list = this.vehicles.filter(v => v.goOnline && v.onlineListing);
    if (!list.length) return `
      <div class="auc-empty" style="margin-top:12px">
        <div class="auc-empty-sub">No vehicles marked for online listing yet. Select vehicles and use Action → Send to Online.</div>
      </div>`;

    const wsStores   = this.getStores(list);
    const wsFiltered = this.wsFilterStore ? list.filter(v => v.store === this.wsFilterStore) : list;
    const wsActive   = wsFiltered.filter(v => v.onlineListing.status !== 'sold').map((v,i) => ({...v, _wsIdx: i}));
    const wsSold     = wsFiltered.filter(v => v.onlineListing.status === 'sold').map((v,i) => ({...v, _wsIdx: wsActive.length+i}));

    const renderRow = v => {
      const ol  = v.onlineListing;
      const fmt = n => n ? '$' + Number(n).toLocaleString() : '—';
      const bids = [
        { platform: 'Openlane', val: ol.openlane },
        { platform: 'ACV',      val: ol.acv      },
        { platform: 'Manheim',  val: ol.manheim  },
      ].filter(b => b.val);
      const winning    = bids.length ? bids.reduce((a,b) => b.val > a.val ? b : a) : null;
      const profit     = (winning && ol.cost) ? winning.val - ol.cost : null;
      const profitColor = profit === null ? 'var(--text-3)' : profit >= 0 ? 'var(--green)' : 'var(--red)';

      if (ol.status === 'sold') {
        return `<tr class="auc-row" style="opacity:0.65;border-left:3px solid var(--green)">
          <td style="font-family:var(--font-mono);font-size:11px;font-weight:600">${v.stock}</td>
          <td><div style="font-weight:500">${v.year} ${v.make} ${v.model}</div>
              <div style="font-size:11px;color:var(--text-3)">${v.color||''}</div>
              ${ol.vin ? `<div style="font-family:var(--font-mono);font-size:10px;font-weight:700;color:var(--text-2);letter-spacing:0.04em;margin-top:2px">${ol.vin}</div>` : ''}</td>
          <td style="font-size:11px;color:var(--text-2)">${v.store||'—'}</td>
          <td style="font-family:var(--font-mono);font-size:11px;line-height:1.7">
            <span style="color:var(--text-2);font-weight:600">${fmt(ol.cost)}</span><br>
            <span style="color:var(--text-3);font-size:10px">${fmt(ol.book)}</span><br>
            <span style="color:var(--text-3);font-size:10px">${fmt(ol.mmr)}</span>
          </td>
          <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-2)">${ol.auctionHighBid?fmt(ol.auctionHighBid):'—'}</td>
          <td style="font-family:var(--font-mono);font-size:11px;color:var(--accent)">${ol.onlineReserve?fmt(ol.onlineReserve):'—'}</td>
          <td style="font-weight:600;color:var(--green);font-size:12px">Sold — ${ol.soldOn}</td>
          <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--green)">${fmt(ol.soldPrice)}</td>
          <td><span class="auc-link" style="color:var(--amber)" data-action="unsell" data-stock="${v._wsIdx}">[Mark unsold]</span></td>
        </tr>`;
      }

      return `<tr class="auc-row">
        <td style="font-family:var(--font-mono);font-size:11px;font-weight:600">${v.stock}</td>
        <td><div style="font-weight:500">${v.year} ${v.make} ${v.model}</div>
            <div style="font-size:11px;color:var(--text-3)">${v.color||''}</div>
            ${ol.vin ? `<div style="font-family:var(--font-mono);font-size:10px;font-weight:700;color:var(--text-2);letter-spacing:0.04em;margin-top:2px">${ol.vin}</div>` : ''}</td>
        <td style="font-size:11px;color:var(--text-2)">${v.store||'—'}</td>
        <td style="font-family:var(--font-mono);font-size:11px;line-height:1.7">
          <span style="color:var(--text-2);font-weight:600">${fmt(ol.cost)}</span><br>
          <span style="color:var(--text-3);font-size:10px">${fmt(ol.book)}</span><br>
          <span style="color:var(--text-3);font-size:10px">${fmt(ol.mmr)}</span>
        </td>
        <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${ol.auctionHighBid?'var(--amber)':'var(--text-4)'}">
          ${ol.auctionHighBid?fmt(ol.auctionHighBid):'—'}
        </td>
        <td>
          <div style="display:flex;flex-direction:column;gap:3px">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;padding-bottom:4px;border-bottom:1px solid var(--border)">
              <span style="font-size:9px;font-weight:600;color:var(--accent);width:54px;flex-shrink:0">RESERVE</span>
              <input type="number" class="ws-bid-input ws-bid-sm" placeholder="—"
                value="${ol.onlineReserve||''}"
                style="-moz-appearance:textfield;border-color:var(--accent-mid);color:var(--accent)"
                data-bid-stock="${v._wsIdx}" data-bid-platform="onlineReserve">
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:9px;font-weight:600;color:var(--text-3);width:54px;flex-shrink:0">OPENLANE</span>
              <input type="number" class="ws-bid-input ws-bid-sm" placeholder="—"
                value="${ol.openlane||''}"
                style="-moz-appearance:textfield;${winning?.platform==='Openlane'?'border-color:var(--green);color:var(--green);font-weight:600;':''}"
                data-bid-stock="${v._wsIdx}" data-bid-platform="openlane">
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:9px;font-weight:600;color:var(--text-3);width:54px;flex-shrink:0">ACV</span>
              <input type="number" class="ws-bid-input ws-bid-sm" placeholder="—"
                value="${ol.acv||''}"
                style="-moz-appearance:textfield;${winning?.platform==='ACV'?'border-color:var(--green);color:var(--green);font-weight:600;':''}"
                data-bid-stock="${v._wsIdx}" data-bid-platform="acv">
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:9px;font-weight:600;color:var(--text-3);width:54px;flex-shrink:0">MANHEIM</span>
              <input type="number" class="ws-bid-input ws-bid-sm" placeholder="—"
                value="${ol.manheim||''}"
                style="-moz-appearance:textfield;${winning?.platform==='Manheim'?'border-color:var(--green);color:var(--green);font-weight:600;':''}"
                data-bid-stock="${v._wsIdx}" data-bid-platform="manheim">
            </div>
          </div>
        </td>
        <td>
          ${winning
            ? `<span style="color:var(--green);font-weight:600;font-size:12px">${winning.platform} — ${fmt(winning.val)}</span>`
            : `<span style="color:var(--text-4);font-size:11px">No bids yet</span>`}
        </td>
        <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${profitColor}">
          ${profit!==null?(profit>=0?'+':'')+fmt(profit):'—'}
        </td>
        <td>
          ${winning
            ? `<button class="auc-action-btn accept" data-action="sell" data-stock="${v._wsIdx}" data-platform="${winning.platform}" data-val="${winning.val}">
                Sell on ${winning.platform}
               </button>`
            : ''}
        </td>
      </tr>`;
    };

    return `
      ${wsStores.length > 1 ? `
      <div class="auc-filter-bar" style="margin-bottom:12px">
        <select class="auc-store-select" onchange="Auction.wsFilterStore=this.value;Auction.renderSession(document.getElementById('auc-workspace'))">
          <option value="">All stores</option>
          ${wsStores.map(s => `<option value="${s}" ${this.wsFilterStore===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <span style="margin-left:auto;font-size:12px;color:var(--text-3)">${wsFiltered.length} of ${list.length}</span>
      </div>` : ''}
      <div class="auc-table-wrap">
        <table class="auc-table">
          <thead><tr>
            <th>Stock #</th><th>Vehicle</th><th>Store</th>
            <th>Cost / Book / MMR</th>
            <th>Auction high bid</th>
            <th>Reserve / Bids</th>
            <th>Winning bid</th><th>Profit</th><th>Action</th>
          </tr></thead>
          <tbody>
            ${wsActive.map(renderRow).join('')}
            ${wsSold.length ? `
              <tr><td colspan="9" style="padding:8px 12px;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-3);background:var(--bg-raised);border-top:1px solid var(--border)">Sold</td></tr>
              ${wsSold.map(renderRow).join('')}
            ` : ''}
          </tbody>
        </table>
      </div>`;
  },

  updateBid(stock, platform, value) {
    const v = this.vehicles.find(w => w.stock === stock);
    if (!v || !v.onlineListing) return;
    v.onlineListing[platform] = parseFloat(value) || null;
    this.saveSession();
    this.renderSession(document.getElementById('auc-workspace'));
  },

  sellVehicle(stock, platform, price) {
    const v = this.vehicles.find(w => w.stock === stock);
    if (!v || !v.onlineListing) return;
    if (!confirm(`Mark ${stock} as sold on ${platform} for $${Number(price).toLocaleString()}?`)) return;
    v.onlineListing.status    = 'sold';
    v.onlineListing.soldOn    = platform;
    v.onlineListing.soldPrice = price;
    this.saveSession();
    Toast.show(`${stock} sold on ${platform}`, 'success');
    this.renderSession(document.getElementById('auc-workspace'));
  },

  unsellVehicle(stock) {
    const v = this.vehicles.find(w => w.stock === stock);
    if (!v || !v.onlineListing) return;
    v.onlineListing.status    = 'active';
    v.onlineListing.soldOn    = null;
    v.onlineListing.soldPrice = null;
    this.saveSession();
    Toast.show(`${stock} marked unsold`);
    this.renderSession(document.getElementById('auc-workspace'));
  },

  fmtTimestamp(d) {
    const pad = n => String(n).padStart(2,'0');
    const h   = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr   = h % 12 || 12;
    return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()} ${hr}:${pad(m)} ${ampm}`;
  },

  // ---- Exports -----------------------------------------------
  csvDownload(filename, headers, rows) {
    const escape = v => {
      const s = (v === null || v === undefined) ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
    const blob  = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a     = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: filename
    });
    a.click(); URL.revokeObjectURL(a.href);
  },

  // Export 1: Manager review — ALL vehicles, all data, blank Accept column
  exportManagerReview() {
    if (!this.vehicles.length) { Toast.show('No vehicles to export', 'error'); return; }
    const fmt  = n => n ? '$' + Number(n).toLocaleString() : '';
    const dec  = d => ({ auto:'Auto Accepted', accepted:'Manually Accepted', denied:'Denied', nosale:'No Sale', pending:'Pending' }[d] || d);
    const date = this.sessionLabel.replace(/[^a-z0-9]/gi,'_');
    this.csvDownload(`${date}_manager_review.csv`,
      ['Stock #','Store','Year','Make','Model','Color','VIN','Miles','Reserve','Max Bid','Bid By',
       'Cost','Book','MMR','Profit','Current Decision','Manager Accept (Y/N)'],
      this.vehicles.map(v => {
        const bid    = parseFloat(v.maxBid) || 0;
        const cost   = parseFloat(v.cost)   || 0;
        const profit = bid > 0 && cost > 0  ? bid - cost : '';
        return [
          v.stock, v.store||'', v.year, v.make, v.model, v.color||'', v.vin||'',
          v.miles||'', v.reserve||'', bid||'', v.bidBy||'',
          v.cost||'', v.book||'', v.mmr||'',
          profit, dec(v.decision), ''
        ];
      })
    );
    Toast.show(`Exported ${this.vehicles.length} vehicles`, 'success');
  },

  // Export 2: Title clerk — accepted vehicles only (auto + manual)
  exportTitleClerk() {
    const sold = this.vehicles.filter(v => v.decision === 'auto' || v.decision === 'accepted');
    if (!sold.length) { Toast.show('No accepted vehicles to export', 'error'); return; }
    const fmt  = n => n ? '$' + Number(n).toLocaleString() : '';
    const date = this.sessionLabel.replace(/[^a-z0-9]/gi,'_');
    this.csvDownload(`${date}_title_clerk.csv`,
      ['Stock #','Store','Year','Make','Model','Color','VIN','Miles',
       'Sale Price','Bid By','Cost','Book','MMR','Profit','Decision Type'],
      sold.map(v => {
        const bid    = parseFloat(v.maxBid) || 0;
        const cost   = parseFloat(v.cost)   || 0;
        const profit = bid > 0 && cost > 0  ? bid - cost : '';
        return [
          v.stock, v.store||'', v.year, v.make, v.model, v.color||'', v.vin||'',
          v.miles||'', bid||'', v.bidBy||'',
          v.cost||'', v.book||'', v.mmr||'',
          profit, v.decision === 'auto' ? 'Auto Accepted' : 'Manually Accepted'
        ];
      })
    );
    Toast.show(`Exported ${sold.length} vehicles`, 'success');
  },

  // Export 3: Online listings — everything that did NOT sell
  exportOnlineListings() {
    const list = this.vehicles.filter(v => v.goOnline && v.onlineListing);
    if (!list.length) { Toast.show('No vehicles marked for online listing', 'error'); return; }
    const date = this.sessionLabel.replace(/[^a-z0-9]/gi,'_');
    this.csvDownload(`${date}_online_listings.csv`,
      ['Stock #','VIN','Year','Make','Model','Color','Store',
       'Cost','Book','MMR','Auction High Bid',
       'Openlane Bid','ACV Bid','Manheim Bid','Winning Platform','Winning Bid','Status'],
      list.map(v => {
        const ol = v.onlineListing;
        const bids = [
          { p:'Openlane', val: ol.openlane },
          { p:'ACV',      val: ol.acv      },
          { p:'Manheim',  val: ol.manheim  },
        ].filter(b => b.val);
        const winning = bids.length ? bids.reduce((a,b) => b.val>a.val?b:a) : null;
        return [
          v.stock, ol.vin||'', v.year, v.make, v.model, v.color||'', v.store||'',
          ol.cost||'', ol.book||'', ol.mmr||'', ol.auctionHighBid||'',
          ol.openlane||'', ol.acv||'', ol.manheim||'',
          winning ? winning.p : '', winning ? winning.val : '',
          ol.status === 'sold' ? `Sold — ${ol.soldOn}` : 'Active'
        ];
      })
    );
    Toast.show(`Exported ${list.length} vehicles`, 'success');
  },

  // ---- File loading ------------------------------------------
  loadFile(file, type) {
    if (typeof XLSX === 'undefined') {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => this.parseFile(file, type);
      document.head.appendChild(s);
    } else {
      this.parseFile(file, type);
    }
  },

  parseFile(file, type) {
    const reader = new FileReader();
    reader.onload = e => {
      if (type === 'vauto')   this.parseVauto(e.target.result);
      if (type === 'extract') this.parseExtract(e.target.result);
    };
    reader.readAsArrayBuffer(file);
  },

  parseVauto(buffer) {
    try {
      const wb   = XLSX.read(buffer, { type: 'array' });
      const name = wb.SheetNames.find(n => /vauto|wholesale/i.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      if (rows.length < 2) { Toast.show('No data in Vauto file', 'error'); return; }

      const hdr  = rows[0].map(h => (h||'').toString().toLowerCase().trim());
      const ci   = s => hdr.findIndex(h => h.includes(s));
      const iVin = ci('vin'), iStock = ci('stock'), iBook = ci('book'),
            iCost = ci('cost'), iMmr = ci('mmr'), iKbb = ci('kbb');

      this.vautoData = {};
      let count = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const vin   = iVin   > -1 ? (row[iVin]  ||'').toString().trim().toUpperCase() : '';
        const stock = iStock > -1 ? (row[iStock] ||'').toString().trim() : '';
        if (!vin && !stock) continue;
        const entry = {
          book: iBook > -1 ? parseFloat(row[iBook]) || null : null,
          cost: iCost > -1 ? parseFloat(row[iCost]) || null : null,
          mmr:  iMmr  > -1 ? parseFloat(row[iMmr])  || null : null,
          kbb:  iKbb  > -1 ? parseFloat(row[iKbb])  || null : null,
        };
        if (vin)   this.vautoData[vin]   = entry;
        if (stock) this.vautoData[stock] = entry;
        count++;
      }
      if (this.vehicles.length) this.enrich();
      this.saveSession();
      Toast.show(`Vauto loaded — ${count} vehicles`, 'success');
      this.renderSession(document.getElementById('auc-workspace'));
    } catch(e) {
      console.error(e);
      Toast.show('Failed to parse Vauto file', 'error');
    }
  },

  parseExtract(buffer) {
    try {
      const wb   = XLSX.read(buffer, { type: 'array' });
      const name = wb.SheetNames.find(n => /auction|extract/i.test(n)) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      if (rows.length < 2) { Toast.show('No data in extract', 'error'); return; }

      const hdr     = rows[0].map(h => (h||'').toString().toLowerCase().trim());
      const ci      = s => hdr.findIndex(h => h.includes(s));
      const iStock  = ci('stock'), iStore = ci('store'), iYear  = ci('year'),
            iMake   = ci('make'),  iModel = ci('model'), iColor = ci('color'),
            iVin    = ci('vin'),   iMiles = ci('miles'), iReserve = ci('reserve'),
            iBidBy  = ci('bid by'), iStatus = ci('status');
      const iMaxBid = hdr.findIndex(h => h === 'max bid' || h === 'bid');

      if (iStock === -1) { Toast.show('Could not find Stock # column', 'error'); return; }

      const prevMap = {};
      this.vehicles.forEach(v => { prevMap[v.stock] = v; });

      const incoming = [];
      for (let i = 1; i < rows.length; i++) {
        const row   = rows[i];
        const stock = (row[iStock]||'').toString().trim();
        if (!stock || stock.toLowerCase() === 'none') continue;

        const rawBid  = iMaxBid > -1 ? (row[iMaxBid]||'').toString().trim() : '';
        const bid     = parseFloat(rawBid) || 0;
        const noSale  = /not sold|no sale/i.test(rawBid) || (bid === 0 && rawBid !== '');
        const reserve = iReserve > -1 ? parseFloat(row[iReserve]) || 0 : 0;
        const bidBy   = iBidBy   > -1 ? (row[iBidBy]  ||'').toString().trim() : '';
        const prev    = prevMap[stock];

        let decision;
        if (noSale || bid === 0)                          decision = 'nosale';
        else if (reserve > 0 && bid >= reserve)           decision = 'auto';
        else if (prev?.decision && !['pending','nosale'].includes(prev.decision)) decision = prev.decision;
        else                                              decision = 'pending';

        incoming.push({
          stock,
          store:   iStore > -1 ? (row[iStore]||'').toString().trim() : '',
          year:    iYear  > -1 ? parseInt(row[iYear])  || '' : '',
          make:    iMake  > -1 ? (row[iMake] ||'').toString().trim() : '',
          model:   iModel > -1 ? (row[iModel]||'').toString().trim() : '',
          color:   iColor > -1 ? (row[iColor]||'').toString().trim() : '',
          vin:     iVin   > -1 ? (row[iVin]  ||'').toString().trim().toUpperCase() : '',
          miles:   iMiles > -1 ? parseInt(row[iMiles]) || null : null,
          maxBid: bid, bidBy, reserve,
          status:  iStatus > -1 ? (row[iStatus]||'').toString().trim() : '',
          book: prev?.book || null, cost: prev?.cost || null,
          mmr:  prev?.mmr  || null, kbb:  prev?.kbb  || null,
          decision,
          goOnline: prev?.goOnline || false,
          onlineListing: prev?.onlineListing || null,
        });
      }

      this.vehicles = incoming;
      this.enrich();
      this.lastUpdated = this.fmtTimestamp(new Date());
      this.saveSession();
      Toast.show(`Loaded ${this.vehicles.length} vehicles`, 'success');
      this.renderSession(document.getElementById('auc-workspace'));
    } catch(e) {
      console.error(e);
      Toast.show('Failed to parse extract', 'error');
    }
  },

  enrich() {
    this.vehicles.forEach(v => {
      const match = this.vautoData[v.vin] || this.vautoData[v.stock] || null;
      if (match) { v.book = match.book; v.cost = match.cost; v.mmr = match.mmr; v.kbb = match.kbb; }
    });
  },

  // ---- Firestore ---------------------------------------------
  async saveSession() {
    if (!this.sessionId) return;
    this._rendering = true; // block snapshot re-renders while we save
    try {
      await updateDoc(doc(db, 'auction_sessions', this.sessionId), {
        vehicles:    this.vehicles,
        wholesale:   this.wholesale || [],
        lastUpdated: this.lastUpdated || null,
      });
    } catch(e) { console.error('Save error:', e); }
    // Brief delay then unblock — gives Firestore time to echo our own write
    setTimeout(() => { this._rendering = false; }, 800);
  },

  subscribeSessions() {
    const q = collection(db, 'auction_sessions');
    this._unsubscribe = onSnapshot(q, snapshot => {
      if (this._rendering) return; // prevent re-entrant renders

      this.pastSessions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      const active = this.pastSessions.find(s => s.status !== 'archived');

      if (active) {
        const idChanged   = this.sessionId !== active.id;
        const tsChanged   = (active.lastUpdated || active.createdAt || '') !== this._lastTs;
        this.sessionId    = active.id;
        this.sessionLabel = active.label;
        this.lastUpdated  = active.lastUpdated || null;
        this._lastTs      = active.lastUpdated || active.createdAt || '';

        if (idChanged || tsChanged) {
          this.vehicles  = active.vehicles  || [];
          this.wholesale = active.wholesale || [];
          const ws = document.getElementById('auc-workspace');
          if (ws && !ws.querySelector('.auc-setup-card')) {
            this.showWorkspace();
          }
        }
      } else {
        if (this.sessionId !== null) {
          this.sessionId = null; this.sessionLabel = ''; this.vehicles = [];
          this.wholesale = []; this.lastUpdated = null; this._lastTs = null;
          this.showWorkspace();
        }
      }
    }, err => {
      console.error('Listener error:', err);
      Toast.show('Could not load auction data', 'error');
    });
  },


  async archiveSession() {
    if (!confirm('Archive this session? It will be saved as a read-only record and the live session will be deleted.')) return;
    if (!this.sessionId) return;

    const btn = document.getElementById('auc-archive-btn');
    if (btn) { btn.textContent = 'Archiving…'; btn.disabled = true; }

    try {
      // Build auction results snapshot — only the fields we want
      const auctionResults = this.vehicles.map(v => {
        const bid    = parseFloat(v.maxBid) || 0;
        const cost   = parseFloat(v.cost)   || 0;
        const profit = bid > 0 && cost > 0  ? bid - cost : null;
        const isSold = v.decision === 'auto' || v.decision === 'accepted';
        return {
          stock:    v.stock    || '',
          year:     v.year     || '',
          make:     v.make     || '',
          model:    v.model    || '',
          store:    v.store    || '',
          buyer:    v.buyer    || '',
          reserve:  v.reserve  || null,
          maxBid:   bid        || null,
          bidBy:    v.bidBy    || '',
          cost:     v.cost     || null,
          book:     v.book     || null,
          mmr:      v.mmr      || null,
          profit:   profit,
          decision: isSold ? 'Sold' : v.decision === 'denied' ? 'Denied' : v.decision === 'nosale' ? 'No sale' : 'Pending',
        };
      });

      // Build online listings snapshot — only vehicles flagged with onlineListing data
      const onlineListings = this.vehicles
        .filter(v => v.goOnline && v.onlineListing)
        .map(v => {
          const ol = v.onlineListing;
          const bids = [
            { p: 'Openlane', val: ol.openlane },
            { p: 'ACV',      val: ol.acv      },
            { p: 'Manheim',  val: ol.manheim  },
          ].filter(b => b.val);
          const winning = bids.length ? bids.reduce((a,b) => b.val > a.val ? b : a) : null;
          const profit  = (winning && ol.cost) ? winning.val - ol.cost : null;
          return {
            stock:          v.stock          || '',
            year:           v.year           || '',
            make:           v.make           || '',
            model:          v.model          || '',
            store:          v.store          || '',
            cost:           ol.cost          || null,
            book:           ol.book          || null,
            mmr:            ol.mmr           || null,
            auctionHighBid: ol.auctionHighBid|| null,
            openlane:       ol.openlane      || null,
            acv:            ol.acv           || null,
            manheim:        ol.manheim       || null,
            winningPlatform: winning ? winning.p   : null,
            winningBid:      winning ? winning.val : null,
            profit:          profit,
            status:          ol.status === 'sold' ? `Sold — ${ol.soldOn}` : 'Active',
            soldPrice:       ol.soldPrice    || null,
          };
        });

      // Write to auction_archives
      await addDoc(collection(db, 'auction_archives'), {
        sessionId:      this.sessionId,
        label:          this.sessionLabel,
        date:           this.pastSessions.find(s => s.id === this.sessionId)?.date || '',
        archivedAt:     new Date().toISOString(),
        totalVehicles:  this.vehicles.length,
        sold:           auctionResults.filter(v => v.decision === 'Sold').length,
        auctionResults,
        onlineListings,
      });

      // Delete the live session
      await deleteDoc(doc(db, 'auction_sessions', this.sessionId));

      this.vautoData     = {};
      this.wholesaleView = false;
      this.selectedRows  = new Set();

      Toast.show('Session archived', 'success');
      // subscribeSessions will clear state and show empty workspace automatically
    } catch(e) {
      console.error('Archive error:', e);
      Toast.show('Archive failed — check connection', 'error');
      if (btn) { btn.textContent = 'Archive session'; btn.disabled = false; }
    }
  },

  async renameSession() {
    const current = this.sessionLabel;
    const newName = prompt('Rename auction session:', current);
    if (!newName || newName.trim() === current) return;
    this.sessionLabel = newName.trim();
    await updateDoc(doc(db, 'auction_sessions', this.sessionId), { label: this.sessionLabel });
    Toast.show('Renamed', 'success');
    this.renderSession(document.getElementById('auc-workspace'));
  },


};

export default Auction;
