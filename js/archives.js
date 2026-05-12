// ============================================================
//  archives.js — Read-only view of archived auction sessions
//
//  Firestore: auction_archives/{autoId}
// ============================================================

import { db, collection, onSnapshot, deleteDoc, doc } from './firebase.js';
import { Toast } from './constants.js';

let unsubscribe = null;

const Archives = {

  archives:       [],
  selectedId:     null,   // which archive is open
  view:           'auction', // 'auction' | 'online'
  searchQ:        '',
  filterStore:    '',

  render(container) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }

    container.innerHTML = `
      <div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div class="page-title">Archives</div>
          <div class="page-sub">Read-only records of completed auction sessions.</div>
        </div>
      </div>
      <div id="arch-workspace"></div>
    `;

    window.Archives = this;
    this.subscribe();
  },

  subscribe() {
    const q = collection(db, 'auction_archives');
    unsubscribe = onSnapshot(q,
      snapshot => {
        this.archives = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
        this.renderWorkspace();
      },
      err => {
        console.error('Archives error:', err);
        Toast.show('Could not load archives', 'error');
      }
    );
  },

  renderWorkspace() {
    const ws = document.getElementById('arch-workspace');
    if (!ws) return;

    if (!this.archives.length) {
      ws.innerHTML = `
        <div class="auc-empty">
          <div class="auc-empty-icon">📦</div>
          <div class="auc-empty-title">No archived sessions yet</div>
          <div class="auc-empty-sub">When you archive a completed auction, it will appear here as a read-only record.</div>
        </div>`;
      return;
    }

    const selected = this.selectedId
      ? this.archives.find(a => a.id === this.selectedId)
      : null;

    ws.innerHTML = `
      <div style="display:grid;grid-template-columns:260px 1fr;gap:16px;align-items:start">

        <!-- Sidebar: archive list -->
        <div class="arch-list-card">
          <div class="arch-list-title">Archived sessions</div>
          ${this.archives.map(a => `
            <div class="arch-list-item${this.selectedId === a.id ? ' active' : ''}"
                 onclick="Archives.selectArchive('${a.id}')">
              <div class="arch-list-label">${a.label || 'Unnamed'}</div>
              <div class="arch-list-meta">${a.date || ''} · ${a.totalVehicles || 0} vehicles · ${a.sold || 0} sold</div>
              <div style="display:flex;justify-content:flex-end;margin-top:4px">
                <span class="auc-link" style="color:var(--red);font-size:10px"
                  onclick="event.stopPropagation();Archives.deleteArchive('${a.id}')">Delete</span>
              </div>
            </div>`).join('')}
        </div>

        <!-- Main: selected archive detail -->
        <div>
          ${selected ? this.renderDetail(selected) : `
            <div class="auc-empty" style="padding:60px 20px">
              <div class="auc-empty-sub">Select a session from the list to view its results.</div>
            </div>`}
        </div>
      </div>
    `;
  },

  selectArchive(id) {
    this.selectedId  = id;
    this.view        = 'auction';
    this.searchQ     = '';
    this.filterStore = '';
    this.renderWorkspace();
  },

  renderDetail(a) {
    const auctionRows  = a.auctionResults  || [];
    const onlineRows   = a.onlineListings  || [];

    // Apply filters
    const q = this.searchQ.toLowerCase();
    const filterRow = r => {
      if (q && !`${r.stock} ${r.make} ${r.model} ${r.bidBy||''} ${r.store||''}`.toLowerCase().includes(q)) return false;
      if (this.filterStore && r.store !== this.filterStore) return false;
      return true;
    };

    const filteredAuction = auctionRows.filter(filterRow);
    const filteredOnline  = onlineRows.filter(filterRow);

    const allStores = [...new Set([
      ...auctionRows.map(r => r.store),
      ...onlineRows.map(r => r.store),
    ].filter(Boolean))].sort();

    const fmt = n => n !== null && n !== undefined && n !== '' ? '$' + Number(n).toLocaleString() : '—';

    // Stats
    const sold   = auctionRows.filter(r => r.decision === 'Sold');
    const unsold = auctionRows.filter(r => r.decision !== 'Sold');
    const profit = sold.reduce((acc, r) => r.profit !== null ? acc + r.profit : acc, null);

    return `
      <div class="auc-session-header">
        <div>
          <div class="auc-session-label">${a.label}</div>
          <div class="auc-session-meta">
            <span class="auc-pill auc-pill-archived">Archived</span>
            ${a.date || ''} · ${a.totalVehicles || 0} vehicles
            · Archived ${new Date(a.archivedAt).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'})}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="auc-tab-btn${this.view==='auction'?' active':''}" onclick="Archives.setView('auction')">Auction results</button>
          <button class="auc-tab-btn${this.view==='online'?' active':''}"  onclick="Archives.setView('online')">Online listings${onlineRows.length?` <span class='auc-tab-count'>${onlineRows.length}</span>`:''}</button>
        </div>
      </div>

      <!-- Stats -->
      <div class="auc-stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
        <div class="auc-stat auc-stat-green">
          <div class="auc-stat-val">${sold.length}</div>
          <div class="auc-stat-label">Sold</div>
        </div>
        <div class="auc-stat">
          <div class="auc-stat-val">${unsold.length}</div>
          <div class="auc-stat-label">Unsold</div>
        </div>
        <div class="auc-stat ${profit === null ? '' : profit >= 0 ? 'auc-stat-green' : 'auc-stat-red'}">
          <div class="auc-stat-val" style="font-size:20px">${profit !== null ? (profit>=0?'+$':'-$')+Math.abs(profit).toLocaleString() : '—'}</div>
          <div class="auc-stat-label">Profit on sold</div>
        </div>
      </div>

      <!-- Search + filter -->
      <div class="auc-filter-bar" style="margin-bottom:12px">
        <input class="search-input" placeholder="Search stock #, make, model…"
          value="${this.searchQ}"
          oninput="Archives.searchQ=this.value;Archives.renderWorkspace()" style="max-width:240px">
        ${allStores.length > 1 ? `
        <select class="auc-store-select" onchange="Archives.filterStore=this.value;Archives.renderWorkspace()">
          <option value="">All stores</option>
          ${allStores.map(s => `<option value="${s}" ${this.filterStore===s?'selected':''}>${s}</option>`).join('')}
        </select>` : ''}
        <span style="font-size:12px;color:var(--text-3);margin-left:auto">
          ${this.view === 'auction' ? filteredAuction.length : filteredOnline.length} records
        </span>
      </div>

      <!-- Auction results table -->
      ${this.view === 'auction' ? `
      <div class="auc-table-wrap">
        <table class="auc-table">
          <thead><tr>
            <th>Stock #</th><th>Vehicle</th><th>Store</th><th>Buyer</th>
            <th>Reserve</th><th>Final bid</th><th>Bid by</th>
            <th>Cost / Book / MMR</th><th>Profit</th><th>Decision</th>
          </tr></thead>
          <tbody>
            ${filteredAuction.length ? filteredAuction.map(r => {
              const isSold  = r.decision === 'Sold';
              const isDenied = r.decision === 'Denied';
              const border  = isSold ? '3px solid var(--green)' : isDenied ? '3px solid var(--red)' : '3px solid var(--amber)';
              const pc      = r.profit === null ? 'var(--text-3)' : r.profit >= 0 ? 'var(--green)' : 'var(--red)';
              return `<tr class="auc-row" style="border-left:${border}">
                <td style="font-family:var(--font-mono);font-size:11px;font-weight:600">${r.stock}</td>
                <td><div style="font-weight:500">${r.year} ${r.make} ${r.model}</div></td>
                <td style="font-size:11px;color:var(--text-2)">${r.store||'—'}</td>
                <td style="font-size:11px;color:var(--text-2)">${r.buyer||'—'}</td>
                <td style="font-family:var(--font-mono);font-size:11px">${fmt(r.reserve)}</td>
                <td style="font-family:var(--font-mono);font-size:12px;font-weight:600">${fmt(r.maxBid)}</td>
                <td style="font-size:11px;color:var(--text-2)">${r.bidBy||'—'}</td>
                <td style="font-family:var(--font-mono);font-size:11px;line-height:1.7">
                  <span style="color:var(--text-2);font-weight:600">${fmt(r.cost)}</span><br>
                  <span style="color:var(--text-3);font-size:10px">${fmt(r.book)}</span><br>
                  <span style="color:var(--text-3);font-size:10px">${fmt(r.mmr)}</span>
                </td>
                <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${pc}">
                  ${r.profit!==null?(r.profit>=0?'+':'')+fmt(r.profit):'—'}
                </td>
                <td style="font-weight:600;font-size:12px;color:${isSold?'var(--green)':isDenied?'var(--red)':'var(--amber)'}">
                  ${r.decision}
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text-4)">No records match</td></tr>`}
          </tbody>
        </table>
      </div>` : ''}

      <!-- Online listings table -->
      ${this.view === 'online' ? `
      ${!filteredOnline.length ? `<div class="auc-empty" style="margin-top:12px"><div class="auc-empty-sub">No online listings in this archive.</div></div>` : `
      <div class="auc-table-wrap">
        <table class="auc-table">
          <thead><tr>
            <th>Stock #</th><th>Vehicle</th><th>Store</th>
            <th>Cost / Book / MMR</th><th>Auction high bid</th>
            <th>Openlane</th><th>ACV</th><th>Manheim</th>
            <th>Winning platform</th><th>Winning bid</th><th>Profit</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${filteredOnline.map(r => {
              const isSold = (r.status||'').startsWith('Sold');
              const pc     = r.profit===null ? 'var(--text-3)' : r.profit>=0 ? 'var(--green)' : 'var(--red)';
              return `<tr class="auc-row" style="border-left:3px solid ${isSold?'var(--green)':'transparent'}${isSold?';opacity:0.8':''}">
                <td style="font-family:var(--font-mono);font-size:11px;font-weight:600">${r.stock}</td>
                <td><div style="font-weight:500">${r.year} ${r.make} ${r.model}</div></td>
                <td style="font-size:11px;color:var(--text-2)">${r.store||'—'}</td>
                <td style="font-family:var(--font-mono);font-size:11px;line-height:1.7">
                  <span style="color:var(--text-2);font-weight:600">${fmt(r.cost)}</span><br>
                  <span style="color:var(--text-3);font-size:10px">${fmt(r.book)}</span><br>
                  <span style="color:var(--text-3);font-size:10px">${fmt(r.mmr)}</span>
                </td>
                <td style="font-family:var(--font-mono);font-size:11px;color:var(--amber)">${fmt(r.auctionHighBid)}</td>
                <td style="font-family:var(--font-mono);font-size:11px">${fmt(r.openlane)}</td>
                <td style="font-family:var(--font-mono);font-size:11px">${fmt(r.acv)}</td>
                <td style="font-family:var(--font-mono);font-size:11px">${fmt(r.manheim)}</td>
                <td style="font-size:12px;font-weight:500">${r.winningPlatform||'—'}</td>
                <td style="font-family:var(--font-mono);font-size:12px;font-weight:600">${fmt(r.winningBid)}</td>
                <td style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${pc}">
                  ${r.profit!==null?(r.profit>=0?'+':'')+fmt(r.profit):'—'}
                </td>
                <td style="font-size:12px;font-weight:600;color:${isSold?'var(--green)':'var(--text-2)'}">
                  ${r.status||'Active'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`}` : ''}
    `;
  },

  setView(v) {
    this.view = v;
    this.renderWorkspace();
  },

  async deleteArchive(id) {
    const a = this.archives.find(x => x.id === id);
    if (!confirm(`Permanently delete archive "${a?.label}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'auction_archives', id));
      if (this.selectedId === id) this.selectedId = null;
      Toast.show('Archive deleted');
    } catch(e) {
      console.error(e);
      Toast.show('Delete failed', 'error');
    }
  },
};

export default Archives;
