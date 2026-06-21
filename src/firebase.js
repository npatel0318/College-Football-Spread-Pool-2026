// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCMwXr6LepMmfoz_qfxGPFq96ppwmfwcEU",
  authDomain: "cfb-spread-pool-2026.firebaseapp.com",
  projectId: "cfb-spread-pool-2026",
  storageBucket: "cfb-spread-pool-2026.firebasestorage.app",
  messagingSenderId: "353505199504",
  appId: ":353505199504:web:d733f788471d2b822a9f15",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
