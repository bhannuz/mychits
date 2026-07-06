// ═══════════════════════════════════════════════════════════
// MYCHITS — FIREBASE CONFIG
// ═══════════════════════════════════════════════════════════

const firebaseConfig = {
    apiKey: "AIzaSyDKoL03pf3o_EbmnkSlHqWOFsO8UpPbEe0",
    authDomain: "mychits-37737.firebaseapp.com",
    projectId: "mychits-37737",
    storageBucket: "mychits-37737.firebasestorage.app",
    messagingSenderId: "427030647922",
    appId: "1:427030647922:web:2231e6d5541c4223b75eeb"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Secondary app instance: used ONLY to create new Auth accounts (new admins,
// new members) without signing the CURRENT user out. Firebase's client SDK
// signs in as whichever user you just created on the app instance you used,
// so we do account-creation on this separate, throwaway instance instead.
const secondaryApp = firebase.initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = secondaryApp.auth();

// ── Shared globals (used across ALL js files) ──
let ALL_MEMBERS = [];
let CURRENT_USER = null;  // ← THIS WAS MISSING — caused all the errors
