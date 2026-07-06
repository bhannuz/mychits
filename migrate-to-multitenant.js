// ═══════════════════════════════════════════════════════════════════════════
// ONE-TIME MIGRATION — run this BEFORE deploying firestore.rules
// ═══════════════════════════════════════════════════════════════════════════
//
// HOW TO RUN:
//   1. Open the app in your browser, log in as the current admin (9876543210).
//   2. Open DevTools (F12) → Console tab.
//   3. Paste this entire file and press Enter.
//   4. Wait for "✅ MIGRATION COMPLETE" in the console.
//   5. Only THEN deploy firestore.rules (Firebase Console → Firestore →
//      Rules → paste the contents of firestore.rules → Publish).
//
// This must run under the OLD (open/test-mode) rules, because it creates the
// very first users/{phone} documents that the NEW rules will require.
// Running it after the new rules are live will fail with permission errors.
// ═══════════════════════════════════════════════════════════════════════════

(async function migrate(){
    const ORG_ID = 'org_default';
    const ADMIN_PHONE_E164 = '+919876543210'; // ← change if your admin number differs

    console.log('▶ Starting MYCHITS multi-tenant migration…');

    // 1. Create the tenant record
    await db.collection('orgs').doc(ORG_ID).set({
        name: 'MYCHITS',
        slug: 'mychits',
        ownerPhone: ADMIN_PHONE_E164,
        status: 'active',
        plan: 'default',
        createdAt: new Date().toISOString()
    });
    console.log('✅ orgs/' + ORG_ID + ' created');

    // 2. Seed the admin's login profile (role = admin, scoped to this org)
    await db.collection('users').doc(ADMIN_PHONE_E164).set({
        role: 'admin',
        orgId: ORG_ID,
        name: 'Admin',
        phone: ADMIN_PHONE_E164,
        createdAt: new Date().toISOString()
    });
    console.log('✅ users/' + ADMIN_PHONE_E164 + ' created (role: admin)');

    // 3. Stamp orgId on every existing document in tenant-scoped collections
    const collections = ['members','groups','payments','memberCommitments','memberQrCodes'];
    for(const col of collections){
        const snap = await db.collection(col).get();
        let batch = db.batch();
        let n = 0;
        for(const doc of snap.docs){
            if(doc.data().orgId) continue; // already tagged, skip
            batch.update(doc.ref, {orgId: ORG_ID});
            n++;
            if(n % 400 === 0){ await batch.commit(); batch = db.batch(); } // stay under 500/batch limit
        }
        await batch.commit();
        console.log(`✅ ${col}: tagged ${n} of ${snap.docs.length} docs with orgId`);
    }

    // 4. Namespace the shared "settings" docs to this org (copy old -> new id)
    const settingsMap = {
        'collectionPayouts': 'payouts',
        'paidByOptions': 'options',
        'ncpPlanners': 'planners',
        'qrVersions': 'list',
        'waVersions': 'list'
    };
    for(const [oldId, dataKey] of Object.entries(settingsMap)){
        const oldDoc = await db.collection('settings').doc(oldId).get();
        if(oldDoc.exists){
            const data = oldDoc.data();
            await db.collection('settings').doc(ORG_ID + '_' + oldId).set({...data, orgId: ORG_ID});
            console.log(`✅ settings/${oldId} → settings/${ORG_ID}_${oldId}`);
        }
    }

    console.log('✅ MIGRATION COMPLETE. You may now deploy firestore.rules.');
})();
