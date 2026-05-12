// ============================================================
//  auction.js
// ============================================================

import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot } from './firebase.js';
import { Toast } from './constants.js';

const Auction = {
  vautoData: {}, vehicles: [], sessionId: null, sessionLabel: '',
  sessionStatus: 'active', filterStatus: 'all', filterStore: '', wsFilterStore: '', pastSessions: [],
  wholesaleView: false, lastUpdated: null,

  render(container) {
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
    window.Auction = this;
    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="page-title">Auction</div>
          <div class="page-sub">Upload extracts, track live bids, accept or deny at close.</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="auc-btn-secondary" id="auc-history-btn">📋 Past sessions</button>
          <button class="auc-btn-primary"   id="auc-new-btn">+ New session</button>
        </div>
      </div>
      <div id="auc-workspace"></div>
    `;
    document.getElementById('auc-new-btn').addEventListener('click', () => this.showNewSession());
    document.getElementById('auc-history-btn').addEventListener('click', () => this.openHistoryModal());
    this.subscribeSessions();
    this.showWorkspace();
  },

  showWorkspace() {
    const ws = document.getElementById('auc-workspace');
    if (!ws) return;
    if (this.sessionId) { this.renderSession(ws); return; }
    ws.innerHTML = `
      <div class="auc-empty">
        <div class="auc-empty-icon">🏷️</div>
        <div class="auc-empty-title">No active session</div>
        <div class="auc-empty-sub">Create a new session to start uploading and tracking bids.</div>
        <button class="auc-btn-primary" onclick="Auction.showNewSession()">+ New auction session</button>
      </div>`;
  },

  showNewSession() {
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
        date, label, status: 'active', vehicles: [], createdAt: new Date().toISOString(),
      });
      this.sessionId = ref.id; this.sessionLabel = label;
      this.sessionStatus = 'active'; this.vehicles = []; this.vautoData = {};
      this.filterStatus = 'all'; this.filterStore = ''; this.wsFilterStore = '';
      Toast.show('Session created', 'success');
      this.renderSession(document.getElementById('auc-workspace'));
    } catch(e) {
      console.error(e); Toast.show('Failed to create session', 'error');
      btn.textContent = 'Create session'; btn.disabled = false;
    }
  },

  renderSession(container) {
    if (!container) return;
    const hasV     = this.vehicles.length > 0;
    const hasVauto = Object.keys(this.vautoData).length > 0;
    const closed   = this.sessionStatus === 'closed';
    const s        = this.calcStats();

    container.innerHTML = `
      <div class="auc-session-header">
        <div>
          <div class="auc-session-label">${this.sessionLabel}</div>
          <div class="auc-session-meta">
            <span class="auc-pill ${closed ? 'auc-pill-closed' : 'auc-pill-active'}">${closed ? 'Closed' : 'Active'}</span>
            ${hasV ? `${this.vehicles.length} vehicles` : 'No vehicles yet'}
            ${this.lastUpdated ? `<span style="font-size:11px;color:var(--text-4)">· Updated ${this.lastUpdated}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${closed ? `
            <button class="auc-tab-btn${!this.wholesaleView?' active':''}" onclick="Auction.setView(false)">Auction results</button>
            <button class="auc-tab-btn${this.wholesaleView?' active':''}" onclick="Auction.setView(true)">Online listings${(this.wholesale||[]).length>0?` <span class='auc-tab-count'>${(this.wholesale||[]).length}</span>`:''}</button>
            <div style="width:1px;height:20px;background:var(--border);margin:0 2px"></div>
          ` : `<button class="auc-btn-secondary" id="auc-close-btn">Close auction</button>
            <div style="width:1px;height:20px;background:var(--border);margin:0 2px"></div>`}
          ${hasV ? `
            <button class="auc-btn-secondary" onclick="Auction.exportManagerReview()">↓ Manager review</button>
            <button class="auc-btn-secondary" onclick="Auction.exportTitleClerk()">↓ Title clerk</button>
            <button class="auc-btn-secondary" onclick="Auction.exportOnlineListings()">↓ Online listings</button>
          ` : ''}
        </div>
      </div>

      ${hasV ? `
      <div class="auc-stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="auc-stat auc-stat-green">
          <div class="auc-stat-val">${s.auto + s.accepted}</div>
          <div class="auc-stat-label">Sold</div>
        </div>
        <div class="auc-stat">
          <div class="auc-stat-val">${s.pending + s.denied + s.nosale}</div>
          <div class="auc-stat-label">Unsold</div>
        </div>
        <div class="auc-stat ${s.soldProfit === null ? '' : s.soldProfit >= 0 ? 'auc-stat-green' : 'auc-stat-red'}">
          <div class="auc-stat-val" style="font-size:20px">${s.soldProfit !== null ? (s.soldProfit>=0?'+$':'-$')+Math.abs(s.soldProfit).toLocaleString() : '—'}</div>
          <div class="auc-stat-label">Profit on sold</div>
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

      ${!closed ? `
      <div class="auc-uploads">
        <div class="auc-upload-card">
          <div class="auc-upload-icon">📊</div>
          <div class="auc-upload-title">Vauto Wholesale extract</div>
          <div class="auc-upload-sub">Upload once — provides Book, Cost, MMR</div>
          <label class="auc-btn-secondary" style="cursor:pointer">
            ${hasVauto ? '✓ Loaded — re-upload to refresh' : 'Choose file'}
            <input type="file" id="vauto-file" accept=".xlsx,.csv" style="display:none">
          </label>
        </div>
        <div class="auc-upload-card">
          <div class="auc-upload-icon">🏷️</div>
          <div class="auc-upload-title">Auction extract</div>
          <div class="auc-upload-sub">Upload anytime to refresh bids and status</div>
          <label class="auc-btn-secondary" style="cursor:pointer">
            ${hasV ? '↺ Re-upload to refresh' : 'Choose file'}
            <input type="file" id="extract-file" accept=".xlsx,.csv" style="display:none">
          </label>
        </div>
      </div>` : ''}

      ${closed && this.wholesaleView
        ? this.renderWholesale()
        : hasV ? `
      <div class="auc-filter-bar">
        ${['all','sold','unsold','nosale'].map(f => `
          <button class="auc-filter-btn${this.filterStatus===f?' active':''}" onclick="Auction.setFilter('${f}')">
            ${{all:'All',sold:'Sold',unsold:'Unsold',nosale:'No sale'}[f]}
          </button>`).join('')}
        <button class="auc-filter-btn" onclick="Auction.openAddVehicleModal()" style="margin-left:auto">+ Add vehicle</button>
        <select class="auc-store-select" onchange="Auction.filterStore=this.value;Auction.renderSession(document.getElementById('auc-workspace'))">
          <option value="">All stores</option>
          ${this.getStores(this.vehicles).map(s => `<option value="${s}" ${this.filterStore===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <span style="font-size:12px;color:var(--text-3)">${this.getFiltered().length} of ${this.vehicles.length}</span>
      </div>
      ${this.renderTable(closed)}` : ''}
    `;

    if (!closed) {
      document.getElementById('vauto-file')?.addEventListener('change', e => {
        if (e.target.files[0]) this.loadFile(e.target.files[0], 'vauto');
      });
      document.getElementById('extract-file')?.addEventListener('change', e => {
        if (e.target.files[0]) this.loadFile(e.target.files[0], 'extract');
      });
      document.getElementById('auc-close-btn')?.addEventListener('click', () => this.closeSession());
    }

    // Delegated listeners for auction table buttons
    const aucTable = container.querySelector('.auc-table tbody');
    if (aucTable) {
      aucTable.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]') || e.target.closest('.auc-delete-row');
        if (!btn) return;
        const action   = btn.dataset.action;
        const idx      = parseInt(btn.dataset.stock);
        const filtered = this.getFiltered();
        const rec      = filtered[idx];
        if (!rec) return;
        if (action === 'accept') this.setDecision(rec.stock, 'accepted');
        if (action === 'deny')   this.setDecision(rec.stock, 'denied');
        if (action === 'delete') this.deleteVehicle(rec.stock);
        if (action === 'sell') {
          const platform = btn.dataset.platform;
          const val      = parseFloat(btn.dataset.val);
          this.sellVehicle(rec.stock, platform, val);
        }
      });
      // Delegated listener for wholesale bid inputs
      aucTable.addEventListener('change', e => {
        const input = e.target.closest('[data-bid-stock]');
        if (!input) return;
        const wsIdx    = parseInt(input.dataset.bidStock);
        const platform = input.dataset.bidPlatform;
        const list     = (this.wholesale||[]).filter(v => v.status !== 'sold');
        const rec      = list[wsIdx];
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
    // Profit on sold vehicles (auto + accepted)
    const sold   = v.filter(r => r.decision === 'auto' || r.decision === 'accepted');
    const unsold = v.filter(r => r.decision !== 'auto' && r.decision !== 'accepted');
    let soldProfit = null, soldCount = 0;
    sold.forEach(r => {
      const bid = parseFloat(r.maxBid) || 0;
      const cost = parseFloat(r.cost)  || 0;
      if (bid > 0 && cost > 0) { soldProfit = (soldProfit || 0) + (bid - cost); soldCount++; }
    });
    return {
      total:    v.length,
      auto:     v.filter(r => r.decision === 'auto').length,
      pending:  v.filter(r => r.decision === 'pending').length,
      accepted: v.filter(r => r.decision === 'accepted').length,
      denied:   v.filter(r => r.decision === 'denied').length,
      nosale:   v.filter(r => r.decision === 'nosale').length,
      soldProfit, soldCount,
      soldVehicles: sold,
      unsoldVehicles: unsold,
    };
  },

  calcStoreBreakdown() {
    const fmt = n => n !== null ? (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString() : '—';
    const stores = [...new Set(this.vehicles.map(v => v.store).filter(Boolean))].sort();
    return stores.map(store => {
      const sv = this.vehicles.filter(v => v.store === store);
      const sold   = sv.filter(v => v.decision === 'auto' || v.decision === 'accepted');
      const unsold = sv.filter(v => v.decision !== 'auto' && v.decision !== 'accepted');
      let profit = null;
      sold.forEach(v => {
        const bid = parseFloat(v.maxBid)||0, cost = parseFloat(v.cost)||0;
        if (bid > 0 && cost > 0) profit = (profit||0) + (bid - cost);
      });
      return { store, total: sv.length, sold: sold.length, unsold: unsold.length, profit };
    });
  },

  renderTable(closed) {
    const rows = this.getFiltered().map((r,i) => ({...r, _idx: i}));
    if (!rows.length) return `<div class="auc-empty" style="margin-top:12px"><div class="auc-empty-sub">No vehicles match this filter.</div></div>`;
    return `
      <div class="auc-table-wrap">
        <table class="auc-table">
          <thead><tr>
            <th>Stock #</th><th>Vehicle</th><th>Store</th><th>Reserve</th>
            <th>Bid</th><th>Cost / Book / MMR</th>
            <th>Profit</th><th>Reserve</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>${rows.map(r => this.rowHTML(r, closed)).join('')}</tbody>
        </table>
      </div>`;
  },

  rowHTML(r, closed) {
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
      actions    = closed ? '' : `<span class="auc-link deny" data-action="deny" data-stock="${r._idx}">[Deny]</span>`;
    } else if (r.decision === 'denied') {
      statusText = `<span style="color:var(--red);font-weight:600;font-size:12px">Denied</span>`;
      actions    = closed ? '' : `<span class="auc-link accept" data-action="accept" data-stock="${r._idx}">[Accept]</span>`;
    } else if (r.decision === 'nosale') {
      statusText = `<span style="color:var(--amber);font-weight:600;font-size:12px">No sale</span>`;
      actions    = closed ? '' : `<span class="auc-link accept" data-action="accept" data-stock="${r._idx}">[Accept]</span>`;
    } else if (r.decision === 'pending') {
      statusText = `<span style="color:var(--amber);font-weight:500;font-size:12px">Pending</span>`;
      actions    = closed ? '' : bid > 0
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
      overlay.addEventListener('click', e => { if (e.target === overlay) this.closeHistoryModal(); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="auc-modal">
        <div class="auc-modal-header">
          <div class="auc-modal-title">Add vehicle manually</div>
          <button class="auc-modal-close" onclick="Auction.closeHistoryModal()">✕</button>
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
            <button class="auc-btn-secondary" onclick="Auction.closeHistoryModal()">Cancel</button>
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
      mmr:     null, maxBid: 0, bidBy: '', decision: 'pending',
    });
    this.saveSession();
    this.closeHistoryModal();
    this.renderSession(document.getElementById('auc-workspace'));
    Toast.show(`${stock} added`, 'success');
  },

  // ---- Online listings ------------------------------------
  renderWholesale() {
    const list = this.wholesale || [];
    if (!list.length) return `
      <div class="auc-empty" style="margin-top:12px">
        <div class="auc-empty-sub">No unsold vehicles — nothing to list online.</div>
      </div>`;

    const active = list.filter(v => v.status !== 'sold');
    const sold   = list.filter(v => v.status === 'sold');

    const renderRow = v => {
      const fmt  = n => n ? '$' + Number(n).toLocaleString() : '—';
      const bids = [
        { platform: 'Openlane', val: v.openlane },
        { platform: 'ACV',      val: v.acv      },
        { platform: 'Manheim',  val: v.manheim   },
      ].filter(b => b.val);
      const winning = bids.length ? bids.reduce((a,b) => b.val > a.val ? b : a) : null;

      if (v.status === 'sold') {
        return `<tr class="auc-row" style="opacity:0.6">
          <td style="font-family:var(--font-mono);font-size:11px;font-weight:600">${v.stock}</td>
          <td><div style="font-weight:500">${v.year} ${v.make} ${v.model}</div>
              <div style="font-size:11px;color:var(--text-3)">${v.color||''}</div></td>
          <td style="font-size:11px;color:var(--text-2)">${v.store||'—'}</td>
          <td style="font-family:var(--font-mono);font-size:11px;line-height:1.7">
            <span style="color:var(--text-2);font-weight:600">${fmt(v.cost)}</span><br>
            <span style="color:var(--text-3);font-size:10px">${fmt(v.book)}</span><br>
            <span style="color:var(--text-3);font-size:10px">${fmt(v.mmr)}</span>
          </td>
          <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-2)">${v.auctionBid?fmt(v.auctionBid):'—'}</td>
          <td style="text-align:center;font-size:11px;color:var(--text-3)">—</td>
          <td><span class="auc-res-badge hit" style="font-size:11px">Sold — ${v.soldOn}</span></td>
          <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--green)">${fmt(v.soldPrice)}</td>
          <td></td>
        </tr>`;
      }

      const profitColor = (winning && v.cost)
        ? (winning.val - v.cost >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-3)';
      const profit = (winning && v.cost) ? winning.val - v.cost : null;

      return `<tr class="auc-row">
        <td style="font-family:var(--font-mono);font-size:11px;font-weight:600">${v.stock}</td>
        <td><div style="font-weight:500">${v.year} ${v.make} ${v.model}</div>
            <div style="font-size:11px;color:var(--text-3)">${v.color||''}</div></td>
        <td style="font-size:11px;color:var(--text-2)">${v.store||'—'}</td>
        <td style="font-family:var(--font-mono);font-size:11px;line-height:1.7">
          <span style="color:var(--text-2);font-weight:600">${fmt(v.cost)}</span><br>
          <span style="color:var(--text-3);font-size:10px">${fmt(v.book)}</span><br>
          <span style="color:var(--text-3);font-size:10px">${fmt(v.mmr)}</span>
        </td>
        <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${v.auctionBid?'var(--amber)':'var(--text-4)'}">
          ${v.auctionBid?fmt(v.auctionBid):'—'}
        </td>
        <td>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:9px;font-weight:600;color:var(--text-3);width:54px;flex-shrink:0">OPENLANE</span>
              <input type="number" class="ws-bid-input ws-bid-sm" placeholder="—"
                value="${v.openlane||''}"
                style="-moz-appearance:textfield;${winning?.platform==='Openlane'?'border-color:var(--green);color:var(--green);font-weight:600;':''}"
                data-bid-stock="${v._wsIdx}" data-bid-platform="openlane">
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:9px;font-weight:600;color:var(--text-3);width:54px;flex-shrink:0">ACV</span>
              <input type="number" class="ws-bid-input ws-bid-sm" placeholder="—"
                value="${v.acv||''}"
                style="-moz-appearance:textfield;${winning?.platform==='ACV'?'border-color:var(--green);color:var(--green);font-weight:600;':''}"
                data-bid-stock="${v._wsIdx}" data-bid-platform="acv">
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:9px;font-weight:600;color:var(--text-3);width:54px;flex-shrink:0">MANHEIM</span>
              <input type="number" class="ws-bid-input ws-bid-sm" placeholder="—"
                value="${v.manheim||''}"
                style="-moz-appearance:textfield;${winning?.platform==='Manheim'?'border-color:var(--green);color:var(--green);font-weight:600;':''}"
                data-bid-stock="${v._wsIdx}" data-bid-platform="manheim">
            </div>
          </div>
        </td>
        <td>
          ${winning
            ? `<span class="auc-res-badge hit">${winning.platform} — ${fmt(winning.val)}</span>`
            : `<span class="auc-res-badge nosale">No bids yet</span>`}
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

    const wsStores = this.getStores(this.wholesale);
    const wsFiltered = this.wsFilterStore
      ? list.filter(v => v.store === this.wsFilterStore)
      : list;
    const wsActive = wsFiltered.filter(v => v.status !== 'sold').map((v,i) => ({...v, _wsIdx: i}));
    const wsSold   = wsFiltered.filter(v => v.status === 'sold').map((v,i) => ({...v, _wsIdx: wsActive.length+i}));

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
            <th>Platform bids</th>
            <th>Winning bid</th><th>Profit</th><th>Action</th>
          </tr></thead>
          <tbody>
            ${wsActive.map(renderRow).join('')}
            ${wsSold.length ? `
              <tr><td colspan="13" style="padding:8px 12px;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-3);background:var(--bg-raised);border-top:1px solid var(--border)">Sold</td></tr>
              ${wsSold.map(renderRow).join('')}
            ` : ''}
          </tbody>
        </table>
      </div>`;
  },

  updateBid(stock, platform, value) {
    const v = (this.wholesale || []).find(w => w.stock === stock);
    if (!v) return;
    v[platform] = parseFloat(value) || null;
    this.saveSession();
    this.renderSession(document.getElementById('auc-workspace'));
  },

  sellVehicle(stock, platform, price) {
    const v = (this.wholesale || []).find(w => w.stock === stock);
    if (!v) return;
    if (!confirm(`Mark ${stock} as sold on ${platform} for $${Number(price).toLocaleString()}?`)) return;
    v.status    = 'sold';
    v.soldOn    = platform;
    v.soldPrice = price;
    this.saveSession();
    Toast.show(`${stock} sold on ${platform}`, 'success');
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
    const unsold = this.vehicles.filter(v =>
      v.decision === 'denied' || v.decision === 'nosale' || v.decision === 'pending'
    );
    if (!unsold.length) { Toast.show('No unsold vehicles to export', 'error'); return; }
    const fmt  = n => n ? '$' + Number(n).toLocaleString() : '';
    const date = this.sessionLabel.replace(/[^a-z0-9]/gi,'_');
    this.csvDownload(`${date}_online_listings.csv`,
      ['Stock #','Store','Year','Make','Model','Color','VIN','Miles',
       'Reserve','Max Bid','Bid By','Cost','Book','MMR','Decision'],
      unsold.map(v => {
        const dec = { denied:'Denied', nosale:'No Sale', pending:'Pending' }[v.decision] || v.decision;
        return [
          v.stock, v.store||'', v.year, v.make, v.model, v.color||'', v.vin||'',
          v.miles||'', v.reserve||'', v.maxBid||'', v.bidBy||'',
          v.cost||'', v.book||'', v.mmr||'', dec
        ];
      })
    );
    Toast.show(`Exported ${unsold.length} vehicles`, 'success');
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
    try {
      await updateDoc(doc(db, 'auction_sessions', this.sessionId), {
        vehicles:    this.vehicles,
        status:      this.sessionStatus,
        wholesale:   this.wholesale || [],
        lastUpdated: this.lastUpdated || null,
      });
    } catch(e) { console.error('Save error:', e); }
  },

  subscribeSessions() {
    const q = collection(db, 'auction_sessions');
    this._unsubscribe = onSnapshot(q, snapshot => {
      this.pastSessions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      if (this.sessionId) {
        const cur = this.pastSessions.find(s => s.id === this.sessionId);
        if (cur) {
          // Always sync latest data from Firestore so live bid updates propagate
          const wasEmpty = !this.vehicles.length;
          this.vehicles    = cur.vehicles    || [];
          this.wholesale   = cur.wholesale   || [];
          this.lastUpdated = cur.lastUpdated || null;
          this.sessionStatus = cur.status;
          this.sessionLabel  = cur.label;
          // Re-render if we already have the workspace open
          const ws = document.getElementById('auc-workspace');
          if (ws && !wasEmpty) this.renderSession(ws);
        }
      }
      this.renderHistoryPanel();
    }, err => console.error('Listener error:', err));
  },

  async closeSession() {
    if (!confirm('Close this auction? You can still view results but no further edits.')) return;
    this.sessionStatus = 'closed';

    // Carry over everything that was not accepted (denied, no sale, still pending)
    const unsold = this.vehicles.filter(v =>
      v.decision !== 'auto' && v.decision !== 'accepted'
    );
    // Merge with existing wholesale entries so we don't overwrite existing bids
    const existingMap = {};
    (this.wholesale || []).forEach(w => { existingMap[w.stock] = w; });
    this.wholesale = unsold.map(v => existingMap[v.stock] || {
      stock:      v.stock,
      store:      v.store,
      auctionBid: v.maxBid || null,
      year:    v.year,
      make:    v.make,
      model:   v.model,
      color:   v.color,
      vin:     v.vin,
      miles:   v.miles,
      book:    v.book,
      mmr:     v.mmr,
      cost:    v.cost,
      reserve: v.reserve,
      openlane: null,
      acv:      null,
      manheim:  null,
      status:   'active',  // active | sold
      soldOn:   null,
      soldPrice: null,
    });

    await this.saveSession();
    Toast.show('Auction closed', 'success');
    this.wholesaleView = false;
    this.renderSession(document.getElementById('auc-workspace'));
  },

  openHistoryModal() {
    // Create modal overlay
    let overlay = document.getElementById('auc-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'auc-modal-overlay';
      overlay.className = 'auc-modal-overlay';
      overlay.addEventListener('click', e => {
        if (e.target === overlay) this.closeHistoryModal();
      });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="auc-modal">
        <div class="auc-modal-header">
          <div class="auc-modal-title">Past auction sessions</div>
          <button class="auc-modal-close" onclick="Auction.closeHistoryModal()">✕</button>
        </div>
        <div class="auc-modal-body" id="auc-modal-body">
          ${!this.pastSessions.length
            ? `<div class="auc-empty" style="padding:40px 20px"><div class="auc-empty-sub">No past sessions yet.</div></div>`
            : this.pastSessions.map(s => `
              <div class="auc-history-row">
                <div onclick="Auction.loadSession('${s.id}')" style="flex:1;cursor:pointer;min-width:0">
                  <div class="auc-history-label">${s.label}</div>
                  <div class="auc-history-meta">${s.date} · ${(s.vehicles||[]).length} vehicles</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  <span class="auc-pill ${s.status==='closed'?'auc-pill-closed':'auc-pill-active'}">${s.status}</span>
                  <button class="auc-action-btn deny" onclick="Auction.deleteSession('${s.id}')">Delete</button>
                </div>
              </div>`).join('')}
        </div>
      </div>`;
    overlay.classList.remove('hidden');
  },

  closeHistoryModal() {
    const el = document.getElementById('auc-modal-overlay');
    if (el) el.classList.add('hidden');
  },

  renderHistoryPanel() {
    // No-op — history is now a modal, not inline
  },

  async deleteSession(id) {
    const s = this.pastSessions.find(x => x.id === id);
    if (!s) return;
    if (!confirm(`Delete "${s.label}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'auction_sessions', id));
      // If currently viewing this session, clear it
      if (this.sessionId === id) {
        this.sessionId = null; this.sessionLabel = ''; this.vehicles = [];
        this.sessionStatus = 'active'; this.vautoData = {};
      }
      Toast.show('Session deleted');
      this.openHistoryModal(); // refresh modal
    } catch(e) {
      console.error(e); Toast.show('Delete failed', 'error');
    }
  },

  loadSession(id) {
    const s = this.pastSessions.find(x => x.id === id);
    if (!s) return;
    this.sessionId = s.id; this.sessionLabel = s.label;
    this.sessionStatus = s.status; this.vehicles = s.vehicles || [];
    this.wholesale = s.wholesale || [];
    this.lastUpdated = s.lastUpdated || null;
    this.vautoData = {}; this.filterStatus = 'all'; this.filterStore = ''; this.wsFilterStore = ''; this.wholesaleView = false;
    this.closeHistoryModal();
    this.renderSession(document.getElementById('auc-workspace'));
    Toast.show(`Loaded: ${s.label}`);
  },
};

export default Auction;
