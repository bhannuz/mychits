# MYCHITS — Setup after cloning into this repo

## Files of note
- `firestore.rules` — deploy this to Firebase Console → Firestore → Rules
- `migrate-to-multitenant.js` — one-time script, run in browser console BEFORE deploying the rules above (see instructions inside the file)
- `js/firebase.js` — contains your Firebase project config

## Order of operations
1. `git init`, add these files, push to your blank repo / hosting.
2. Firebase Console → Authentication → Sign-in method → enable **Phone**.
3. Firebase Console → Authentication → Settings → Authorized domains → add your hosting domain.
4. Deploy/host these files (GitHub Pages, Firebase Hosting, etc. — CNAME file suggests GitHub Pages).
5. Open the live site, log in as the existing admin, open DevTools console, paste and run the full contents of `migrate-to-multitenant.js`. Wait for "MIGRATION COMPLETE".
6. Firebase Console → Firestore → Rules → paste the contents of `firestore.rules` → Publish.
7. Log out, log back in via OTP, run through the smoke-test checklist (login, dashboard load, add member, add payment, member login, access-request flow, settings features).
