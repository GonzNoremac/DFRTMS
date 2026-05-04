# VehicleDMS

Used vehicle department management system. Vanilla JS + Firebase.

## Setup

### 1. Firebase Console — Auth
1. Go to **Firebase Console → Authentication → Sign-in method**
2. Enable **Email/Password**
3. Go to **Authentication → Users → Add user**
4. Add accounts for each team member (email + password)

### 2. Firebase Console — Firestore
1. Go to **Firestore Database → Create database**
2. Start in **production mode**
3. Choose your region (us-central1 recommended)
4. Go to the **Rules** tab and paste the contents of `firestore.rules`
5. Click **Publish**

### 3. GitHub Pages (or any static host)
Since the app uses ES modules, it **must be served over HTTP** — it won't work
opened directly as a file:// URL in a browser.

**Option A — GitHub Pages (free)**
1. Push this repo to GitHub
2. Go to **Settings → Pages → Source → Deploy from branch → main → / (root)**
3. Your app will be live at `https://yourusername.github.io/your-repo-name`

**Option B — Netlify (free, instant)**
1. Drag the project folder onto [app.netlify.com](https://app.netlify.com)
2. Done — live URL provided instantly

### 4. Firebase Auth domain
If using GitHub Pages or Netlify, add your domain to Firebase's allowed list:
1. **Firebase Console → Authentication → Settings → Authorized domains**
2. Add your GitHub Pages URL (e.g. `yourusername.github.io`)

## File structure

```
index.html          — App shell + login
css/main.css        — All styles
js/
  firebase.js       — Firebase init + re-exports
  app.js            — Auth, navigation, shared constants
  dashboard.js      — Inventory tracking (reads/writes Firestore: inventory/)
  purchases.js      — Purchases page (reads/writes Firestore: purchases/)
firestore.rules     — Paste into Firebase Console → Firestore → Rules
```

## Firestore collections

| Collection    | Document ID       | Fields |
|---------------|-------------------|--------|
| `inventory`   | store name (underscored) | forecast, stockPct, currentInv, tracking |
| `purchases`   | auto-generated ID | date, stock, year, make, model, vin, source, store, buyer, notes, arb, createdAt |
