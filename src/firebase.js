import { initializeApp } from "firebase/app";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";

// Paste your own Firebase project's config here.
// Get it from: Firebase Console > Project Settings (gear icon) > General tab >
// "Your apps" section > Web app > SDK setup and configuration > Config.
//
// This object is safe to commit to a public repo. Firebase web config values
// are not secrets — they just identify which project to talk to. Your data is
// actually protected by the Firestore Security Rules you set in the Firebase
// console (see firestore.rules in this project for the rules to paste in),
// not by hiding this object.
const firebaseConfig = {
  apiKey: "AIzaSyCMwXr6LepMmfoz_qfxGPFq96ppwmfwcEU",
  authDomain: "cfb-spread-pool-2026.firebaseapp.com",
  projectId: "cfb-spread-pool-2026",
  storageBucket: "cfb-spread-pool-2026.firebasestorage.app",
  messagingSenderId: "353505199504",
  appId: "1:353505199504:web:d733f788471d2b822a9f15",
};

export const app = initializeApp(firebaseConfig);

// IMPORTANT: this was persistentLocalCache() (IndexedDB-backed) until now.
// Switched to memoryLocalCache() as a diagnostic/fix for Win Totals and
// Playoff hanging indefinitely on first load in mobile Safari, requiring a
// full page reload to recover. The long-polling fix (below) didn't resolve
// it, which points at Firestore's IndexedDB persistence layer itself —
// Safari/iOS has a long history of WebKit bugs where IndexedDB connections
// silently hang (no error, no timeout), especially around tab-lock
// contention between sessions. memoryLocalCache() removes IndexedDB from
// the picture entirely: reads either come from an in-memory cache or go to
// the network, so there's no IndexedDB lock to get stuck on.
// Trade-off: data no longer survives Safari fully suspending/killing the
// tab's JS context — on resume it'll need to refetch from network instead
// of replaying instantly from disk. If this fixes the hang, that's a small
// price. If it doesn't, it tells us the hang isn't IndexedDB after all.
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
  experimentalAutoDetectLongPolling: true,
});