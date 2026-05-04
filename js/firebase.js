// ============================================================
//  firebase.js — init Firebase, export auth + db
//  Uses CDN compat SDK (no bundler needed)
// ============================================================

import { initializeApp }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth,
         signInWithEmailAndPassword,
         signOut,
         onAuthStateChanged }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore,
         doc, getDoc, setDoc,
         collection,
         addDoc, updateDoc, deleteDoc,
         onSnapshot,
         query, orderBy }       from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyC2iXH36PYIS3n-EUsNL_0-EwQQ0O7IJRE",
  authDomain:        "vehicledms.firebaseapp.com",
  projectId:         "vehicledms",
  storageBucket:     "vehicledms.firebasestorage.app",
  messagingSenderId: "232867286290",
  appId:             "1:232867286290:web:30437fbc188e3f5b9fb7cb"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);

// Re-export Firestore helpers so other modules import from one place
export {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  doc, getDoc, setDoc,
  collection, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy
};
