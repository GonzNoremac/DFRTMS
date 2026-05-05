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
import Auction   from './auction.js';
import { STORES, SOURCES, BUYERS, Toast } from './constants.js';

const App = {
  user: null,

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

  navigate(page) {
    document.querySelectorAll('.nav-link[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
    const content = document.getElementById('page-content');
    if      (page === 'dashboard') Dashboard.render(content);
    else if (page === 'purchases') Purchases.render(content);
    else if (page === 'calendar')  Calendar.render(content);
    else if (page === 'auction')   Auction.render(content);
    else if (page === 'auction')    Auction.render(content);
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
