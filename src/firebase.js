// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCMwXr6LepMmfoz_qfxGPFq96ppwmfwcEU",
  authDomain: "cfb-spread-pool-2026.firebaseapp.com",
  projectId: "cfb-spread-pool-2026",
  storageBucket: "cfb-spread-pool-2026.firebasestorage.app",
  messagingSenderId: "353505199504",
  appId: "1:353505199504:web:d733f788471d2b822a9f15",
  measurementId: "G-0QQ697XJR0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);