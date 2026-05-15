// ============================================================
//  app.js — entry point, imports all pages
// ============================================================

import {
  auth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from './firebase.js';

import Dashboard from './dashboard.js';
import Purchases from './purchases.js';
import Calendar  from './calendar.js';
import Auction   from './auction.js';
import Archives  from './archives.js';
import Reports   from './reports.js';
import { STORES, SOURCES, BUYERS, Toast } from './constants.js';

const App = {
  user: null,
  currentPage: null,

  init() {
    onAuthStateChanged(auth, user => {
      if (user) { this.user = user; this.showApp(user); }
      else      { this.user = null; this.showLogin();   }
    });

    document.getElementById('login-btn')
      .addEventListener('click', () => this.login());
    document.getElementById('login-password')
      .addEventListener('keydown', e => { if (e.key === 'Enter') this.login(); });
    document.getElementById('btn-signout')
      .addEventListener('click', () => this.logout());
    document.getElementById('btn-tools')
      .addEventListener('click', () => this.openTools());

    document.querySelectorAll('.nav-link[data-page]').forEach(el => {
      el.addEventListener('click', () => this.navigate(el.dataset.page));
    });
  },

  async login() {
    const email = document.getElementById('login-email').value.trim();
    const pw    = document.getElementById('login-password').value;
    const err   = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');

    if (!email || !pw) {
      err.textContent = 'Please enter your email and password.';
      err.classList.remove('hidden');
      return;
    }
    err.classList.add('hidden');
    btn.textContent = 'Signing in…';
    btn.disabled = true;

    try {
      await signInWithEmailAndPassword(auth, email, pw);
    } catch(e) {
      err.textContent = this.authError(e.code);
      err.classList.remove('hidden');
      btn.textContent = 'Sign in';
      btn.disabled = false;
    }
  },

  async logout() {
    await signOut(auth);
  },

  showApp(user) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('login-btn').textContent = 'Sign in';
    document.getElementById('login-btn').disabled = false;
    const name = user.displayName || user.email.split('@')[0];
    document.getElementById('nav-user').textContent = name;
    this.navigate('dashboard');
  },

  showLogin() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').classList.add('hidden');
  },

  openTools() {
    const body = document.getElementById('tools-modal-body');
    if (!body) return;
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div style="padding-bottom:14px;border-bottom:1px solid var(--border)">
          <div style="font-size:13px;font-weight:600;color:var(--text-1);margin-bottom:4px">Strip Anderson prefix from store names</div>
          <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Removes "Anderson " prefix from all purchase store fields in the database.</div>
          <button class="auc-btn-secondary" id="tool-anderson-btn">🔧 Run migration</button>
          <span id="tool-anderson-result" style="font-size:11px;margin-left:10px;color:var(--text-3)"></span>
        </div>
        <div style="padding-bottom:14px;border-bottom:1px solid var(--border)">
          <div style="font-size:13px;font-weight:600;color:var(--text-1);margin-bottom:4px">Acknowledge pre-May 2025 financials</div>
          <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Stamps purchasePrice: 0 on non-ICO records before May 2026 to clear the No financials flag.</div>
          <button class="auc-btn-secondary" id="tool-oldfinance-btn">🔧 Run migration</button>
          <span id="tool-oldfinance-result" style="font-size:11px;margin-left:10px;color:var(--text-3)"></span>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text-1);margin-bottom:4px">Fix Excel serial dates</div>
          <div style="font-size:12px;color:var(--text-3);margin-bottom:10px">Converts Excel serial number dates to real dates on all purchase records.</div>
          <button class="auc-btn-secondary" id="tool-serial-btn">🔧 Run migration</button>
          <span id="tool-serial-result" style="font-size:11px;margin-left:10px;color:var(--text-3)"></span>
        </div>
      </div>`;
    document.getElementById('tools-overlay').classList.remove('hidden');

    const guard = (fn, resultId) => async () => {
      if (typeof Purchases === 'undefined' || !Purchases.records?.length) {
        document.getElementById(resultId).textContent = 'Go to Purchases page first to load data.';
        return;
      }
      await fn();
    };
    document.getElementById('tool-anderson-btn').addEventListener('click',
      guard(() => Purchases.fixAndersonStores(), 'tool-anderson-result'));
    document.getElementById('tool-oldfinance-btn').addEventListener('click',
      guard(() => Purchases.fixOldFinancials(), 'tool-oldfinance-result'));
    document.getElementById('tool-serial-btn').addEventListener('click',
      guard(() => Purchases.fixSerialDates(), 'tool-serial-result'));
  },

  navigate(page) {
    // Clean up previous page's Firestore listener before navigating away
    const cleanups = { dashboard: Dashboard, purchases: Purchases, calendar: Calendar, auction: Auction, archives: Archives, reports: Reports };
    if (this.currentPage && cleanups[this.currentPage]) {
      const prev = cleanups[this.currentPage];
      if (prev._unsubscribe) { prev._unsubscribe(); prev._unsubscribe = null; }
    }
    this.currentPage = page;

    document.querySelectorAll('.nav-link[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
    const content = document.getElementById('page-content');
    if      (page === 'dashboard') Dashboard.render(content);
    else if (page === 'purchases') Purchases.render(content);
    else if (page === 'calendar')  Calendar.render(content);
    else if (page === 'auction')   Auction.render(content);
    else if (page === 'archives')  Archives.render(content);
    else if (page === 'reports')   Reports.render(content);
  },

  authError(code) {
    const map = {
      'auth/invalid-email':          'Invalid email address.',
      'auth/user-not-found':         'No account found with that email.',
      'auth/wrong-password':         'Incorrect password.',
      'auth/invalid-credential':     'Incorrect email or password.',
      'auth/too-many-requests':      'Too many attempts — try again later.',
      'auth/network-request-failed': 'Network error — check your connection.',
    };
    return map[code] || 'Sign in failed. Please try again.';
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
