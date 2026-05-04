// ============================================================
//  constants.js — shared config, no dependencies
// ============================================================

export const STORES  = ['Chevrolet','Chrysler','Ford BHC','Ford Kingman','Honda','Nissan','Toyota'];
export const SOURCES = ['ICO','Enterprise','VCG','Bidacar','ACV','Openlane','Manheim','Transfer'];
export const BUYERS  = ['Gonzalez','Manchester'];

export const Toast = {
  t: null,
  show(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + (type || '');
    el.classList.remove('hidden');
    clearTimeout(this.t);
    this.t = setTimeout(() => el.classList.add('hidden'), 2800);
  }
};
