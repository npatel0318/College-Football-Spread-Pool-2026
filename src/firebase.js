import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCMwXr6LepMmfoz_qfxGPFq96ppwmfwcEU",
  authDomain: "cfb-spread-pool-2026.firebaseapp.com",
  projectId: "cfb-spread-pool-2026",
  storageBucket: "cfb-spread-pool-2026.firebasestorage.app",
  messagingSenderId: "353505199504",
  appId: "1:353505199504:web:d733f788471d2b822a9f15",
};

export const app = initializeApp(firebaseConfig);

// persistentLocalCache stores all Firestore reads in IndexedDB on the device.
// This means data loads instantly from local storage even after mobile Safari
// suspends the app and kills the JS context — no waiting for network reconnect.
// The SDK syncs with the server in the background automatically.
//
// experimentalAutoDetectLongPolling: Firestore's default transport (WebChannel,
// a long-lived streaming connection) has a well-known compatibility issue with
// Safari/iOS — the connection can silently stall with no error and no timeout,
// especially right after the tab is backgrounded or on a fresh cold start. This
// setting makes the SDK detect when WebChannel isn't working and automatically
// fall back to long-polling (plain HTTP requests), which is far more reliable
// on Safari. Other browsers are unaffected — they keep using WebChannel.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
  experimentalAutoDetectLongPolling: true,
});