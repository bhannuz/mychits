// ═══════════════════════════════════════════════════════════
// MYCHITS — AUTH & ACCESS CONTROL
// Phone + password login (Firebase Email/Password auth, using a synthetic
// email of "{10-digit phone}@mychits.local"). No OTP/SMS involved.
//
// Hierarchy:
//   SUPREME (hardcoded bootstrap phone below) — sees/manages everything.
//   ADMIN   — created by Supreme. Owns one org: their own groups/members.
//   MEMBER  — created by their Admin. Read-only view of their own data.
// ═══════════════════════════════════════════════════════════

const SUPREME_PHONE = '9876543210';
const AUTH_EMAIL_DOMAIN = '@mychits.local';

function phoneToEmail(phoneLocal){ return phoneLocal + AUTH_EMAIL_DOMAIN; }
function emailToPhone(email){ return (email||'').split('@')[0]; }

function saveSession(user){ sessionStorage.setItem('mychits_session', JSON.stringify(user)); }
function clearSession(){ sessionStorage.removeItem('mychits_session'); }

// ── Init ─────────────────────────────────────────────────────────────────────
async function initAuth(){
    const saved = sessionStorage.getItem('mychits_session');
    if(saved){
        try{
            const u = JSON.parse(saved);
            CURRENT_USER = u;
            applyUserSession(u);
            return;
        }catch(e){}
    }
    document.getElementById('loginScreen').style.display = 'flex';
}

function _showLoginError(msg){
    const el = document.getElementById('loginErrorMsg');
    el.textContent = msg;
    el.style.display = 'block';
}
function _clearLoginError(){
    document.getElementById('loginErrorMsg').style.display = 'none';
}

// ── Login ──────────────────────────────────────────────────────────────────
async function handleLoginSubmit(){
    _clearLoginError();
    const phoneLocal = document.getElementById('loginPhone').value.trim();
    const password   = document.getElementById('loginPassword').value;
    if(phoneLocal.length !== 10){ _showLoginError('Enter a valid 10-digit number'); return; }
    if(!password){ _showLoginError('Enter your password'); return; }

    const email = phoneToEmail(phoneLocal);
    showToast('⏳ Logging in…', true);
    try{
        const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
        const uid = cred.user.uid;
        let userDoc = await db.collection('users').doc(uid).get();

        // First-ever login of the hardcoded Supreme phone — self-provision
        // its profile (rules only allow this for this exact phone).
        if(!userDoc.exists && phoneLocal === SUPREME_PHONE){
            await db.collection('users').doc(uid).set({
                role: 'supreme', phone: phoneLocal, name: 'Supreme Admin',
                createdAt: new Date().toISOString()
            });
            userDoc = await db.collection('users').doc(uid).get();
        }

        if(!userDoc.exists){
            await firebase.auth().signOut();
            _showLoginError('Account not set up yet. Ask your admin to create your login.');
            return;
        }

        const u = userDoc.data();
        const user = {
            uid, phone: phoneLocal, role: u.role,
            orgId: u.orgId || null, memberId: u.memberId || null,
            name: u.name || 'User'
        };
        CURRENT_USER = user;
        saveSession(user);
        applyUserSession(user);
    }catch(err){
        console.error(err);
        if(err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password'){
            _showLoginError('Incorrect phone number or password.');
        } else if(err.code === 'auth/too-many-requests'){
            _showLoginError('Too many attempts. Try again in a bit.');
        } else {
            _showLoginError('Login failed. Please try again.');
        }
    }
}

// ── Apply session UI ──────────────────────────────────────────────────────────
function applyUserSession(user){
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'block';

    if(user.role === 'admin' || user.role === 'supreme'){
        document.body.classList.add('admin-mode');
        document.documentElement.classList.add('admin-mode-early');
        document.getElementById('adminHeader').style.display = 'flex';
        document.getElementById('memberHeader').style.display = 'none';
        document.getElementById('headerRoleBadge').textContent = user.role === 'supreme' ? 'SUPREME' : 'ADMIN';
        document.getElementById('headerRoleBadge').style.display = 'inline';
        document.getElementById('accessReqBtn').style.display = (user.role === 'supreme') ? 'inline-flex' : 'none';
        document.getElementById('navSupreme').style.display = (user.role === 'supreme') ? '' : 'none';

        if(user.role === 'supreme'){
            // Supreme doesn't run their own chit fund — hide the operational
            // tabs and repurpose "Groups" into an Admins list instead.
            document.getElementById('navHome').style.display = 'none';
            document.getElementById('navPlanner').style.display = 'none';
            document.getElementById('navBackup').style.display = 'none';
            document.getElementById('navSupreme').style.display = 'none'; // merged into Groups tab below
            document.getElementById('adminStatCards').style.display = 'none';
            document.getElementById('adminActionBtns').style.display = 'none';
            document.getElementById('adminMemberSearch').style.display = 'none';
            document.getElementById('memberLedgerArea').style.display = 'none';
            document.getElementById('qrGeneratorSection').style.display = 'none';
            document.getElementById('waReminderSection').style.display = 'none';
            document.getElementById('adminQuickBtns').style.display = 'none';
            document.getElementById('memberQrArea').style.display = 'none';

            const navGroupsEl = document.getElementById('navGroups');
            navGroupsEl.style.display = '';
            navGroupsEl.innerHTML = '<div style="font-size:1.3rem;">👑</div><div>Admins</div>';
            navGroupsEl.onclick = function(){ switchTab('supreme'); loadSupremeDashboard(); };

            switchTab('supreme');
            loadSupremeDashboard();
        } else {
            document.getElementById('navHome').style.display = '';
            document.getElementById('navGroups').style.display = '';
            document.getElementById('navPlanner').style.display = '';
            document.getElementById('navBackup').style.display = '';

            const navGroupsEl = document.getElementById('navGroups');
            navGroupsEl.innerHTML = '<div style="font-size:1.3rem;">📂</div><div>Groups</div>';
            navGroupsEl.onclick = function(){ switchTab('groups'); };

            document.getElementById('adminStatCards').style.display = '';
            document.getElementById('adminActionBtns').style.display = 'flex';
            document.getElementById('adminMemberSearch').style.display = '';
            document.getElementById('memberLedgerArea').style.display = 'none';
            document.getElementById('qrGeneratorSection').style.display = '';
            document.getElementById('waReminderSection').style.display = '';
            document.getElementById('adminQuickBtns').style.display = 'flex';
            document.getElementById('memberQrArea').style.display = 'none';
            updateUI();
            setTimeout(checkAndShowBackupReminder, 1200);
        }
    } else {
        document.getElementById('adminHeader').style.display = 'none';
        document.getElementById('memberHeader').style.display = 'block';
        document.getElementById('logoutBtn').style.display = 'none';
        document.getElementById('memberHeaderAvatar').textContent = ini(user.name);
        document.getElementById('memberHeaderName').textContent = user.name;
        document.getElementById('memberHeaderPhone').textContent = '📱 +91 ' + user.phone;
        document.getElementById('adminStatCards').style.display = 'none';
        document.getElementById('adminActionBtns').style.display = 'none';
        document.getElementById('adminMemberSearch').style.display = 'none';
        document.getElementById('adminQuickBtns').style.display = 'none';
        document.getElementById('qrGeneratorSection').style.display = 'none';
        document.getElementById('waReminderSection').style.display = 'none';
        document.getElementById('memberLedgerArea').style.display = 'block';
        document.getElementById('memberQrArea').style.display = 'block';
        document.getElementById('summaryView').value = user.memberId;

        document.body.classList.remove('admin-mode');
        document.documentElement.classList.remove('admin-mode-early');

        const mNav = document.getElementById('memberSubNav');
        if(mNav) mNav.style.display = '';
        const ht = document.getElementById('homeTab');
        if(ht) ht.style.display = 'none';

        updateUI();
        if(typeof loadMemberQr === 'function') loadMemberQr(user.memberId);
        if(typeof switchMemberSubTab === 'function') switchMemberSubTab('dash');
    }
}

// ── Logout ────────────────────────────────────────────────────────────────────
function handleLogout(){
    document.body.classList.remove('admin-mode');
    document.documentElement.classList.remove('admin-mode-early');
    clearSession();
    CURRENT_USER = null;
    firebase.auth().signOut().catch(function(){});
    document.getElementById('adminHeader').style.display = 'flex';
    document.getElementById('memberHeader').style.display = 'none';
    const mNavL = document.getElementById('memberSubNav'); if(mNavL) mNavL.style.display = 'none';
    const htL = document.getElementById('homeTab'); if(htL) htL.style.display = '';
    ['mDashPanel','mPayPanel','mStatsPanel','mQrPanel'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});
    document.getElementById('navGroups').style.display = '';
    document.getElementById('navBackup').style.display = '';
    document.getElementById('navPlanner').style.display = '';
    document.querySelector('.nav-bar').style.display = '';
    document.getElementById('adminStatCards').style.display = '';
    document.getElementById('adminActionBtns').style.display = 'flex';
    document.getElementById('adminMemberSearch').style.display = '';
    document.getElementById('memberLedgerArea').style.display = 'none';
    document.getElementById('qrGeneratorSection').style.display = '';
    document.getElementById('waReminderSection').style.display = '';
    document.getElementById('adminQuickBtns').style.display = 'none';
    document.getElementById('memberQrArea').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('accessReqBtn').style.display = 'none';
    document.getElementById('navSupreme').style.display = 'none';
    document.getElementById('headerRoleBadge').textContent = 'ADMIN';
    document.getElementById('headerRoleBadge').className = 'badge text-warning border border-warning px-2';
    document.getElementById('ledgerData').innerHTML = '';
    document.getElementById('memberLedgerData').innerHTML = '';
    document.getElementById('summarySearch').value = '';
    document.getElementById('summaryView').value = '';
    document.getElementById('loginPhone').value = '';
    document.getElementById('loginPassword').value = '';
    _clearLoginError();
    document.getElementById('loginScreen').style.display = 'flex';
}

// ── Supreme: create a new Admin (+ their org) ─────────────────────────────────
// Uses the secondary Firebase app instance so Supreme's own session survives.
async function createAdminAccount(){
    if(!CURRENT_USER || CURRENT_USER.role !== 'supreme'){ showToast('🚫 Access denied', false); return; }
    const orgName = document.getElementById('newAdminOrgName').value.trim();
    const name    = document.getElementById('newAdminName').value.trim();
    const phoneLocal = document.getElementById('newAdminPhone').value.trim();
    const password = document.getElementById('newAdminPassword').value;

    if(!orgName || !name){ showToast('❌ Enter org name and admin name', false); return; }
    if(phoneLocal.length !== 10){ showToast('❌ Enter a valid 10-digit phone', false); return; }
    if(!password || password.length < 6){ showToast('❌ Password must be at least 6 characters', false); return; }

    showToast('⏳ Creating admin account…', true);
    try{
        const email = phoneToEmail(phoneLocal);
        const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
        const newUid = cred.user.uid;
        await secondaryAuth.signOut();

        const orgRef = db.collection('orgs').doc();
        const batch = db.batch();
        batch.set(orgRef, {
            name: orgName, ownerPhone: phoneLocal, status: 'active',
            plan: 'default', createdAt: new Date().toISOString()
        });
        batch.set(db.collection('users').doc(newUid), {
            role: 'admin', orgId: orgRef.id, name: name, phone: phoneLocal,
            createdAt: new Date().toISOString()
        });
        await batch.commit();

        showToast('✅ Admin "' + name + '" created!');
        if(typeof loadSupremeDashboard === 'function') loadSupremeDashboard();
        closeModal('createAdminModal');
        document.getElementById('newAdminOrgName').value = '';
        document.getElementById('newAdminName').value = '';
        document.getElementById('newAdminPhone').value = '';
        document.getElementById('newAdminPassword').value = '';
    }catch(err){
        console.error(err);
        if(err.code === 'auth/email-already-in-use'){
            showToast('❌ That phone number already has a login', false);
        } else {
            showToast('❌ Could not create admin: ' + (err.message||'unknown error'), false);
        }
    }
}

// ── Supreme: dashboard of all orgs/admins ─────────────────────────────────────
let _supremeCache = null;

async function loadSupremeDashboard(){
    if(!CURRENT_USER || CURRENT_USER.role !== 'supreme') return;
    const listEl = document.getElementById('supremeOrgList');
    listEl.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:24px;">Loading…</div>';

    let orgsSnap, adminsSnap, groups, members, payments;
    try{
        [orgsSnap, adminsSnap, groups, members, payments] = await Promise.all([
            db.collection('orgs').get(),
            db.collection('users').where('role','==','admin').get(),
            getCollection('groups', true),
            getCollection('members', true),
            getCollection('payments', true)
        ]);
    }catch(err){
        console.error(err);
        listEl.innerHTML = '<div style="text-align:center;color:#f87171;padding:24px;">Could not load: ' + (err.message||'permission error') + '</div>';
        return;
    }

    const orgs = orgsSnap.docs.map(d=>({id:d.id, ...d.data()}));
    const admins = adminsSnap.docs.map(d=>({uid:d.id, ...d.data()}));
    _supremeCache = {orgs, admins, groups, members, payments};

    const activeCount = orgs.filter(o=>o.status==='active').length;
    document.getElementById('supremeSummaryStrip').innerHTML = [
        ['👑', admins.length, 'Admins'],
        ['🏢', orgs.length, 'Orgs (' + activeCount + ' active)'],
        ['📂', groups.length, 'Groups'],
        ['👥', members.length, 'Members']
    ].map(function(s){
        return '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:10px;text-align:center;">' +
            '<div style="font-size:1.1rem;">' + s[0] + '</div>' +
            '<div style="font-weight:800;font-size:1.05rem;color:white;">' + s[1] + '</div>' +
            '<div style="font-size:0.65rem;color:var(--text-dim);">' + s[2] + '</div>' +
        '</div>';
    }).join('');

    if(!orgs.length){
        listEl.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:24px;">No organizations yet. Create one with "👑 New Admin".</div>';
        return;
    }

    listEl.innerHTML = orgs.map(function(org){
        const admin = admins.find(a=>a.orgId===org.id);
        const gCount = groups.filter(g=>g.orgId===org.id).length;
        const mCount = members.filter(m=>m.orgId===org.id).length;
        const statusColor = org.status === 'active' ? '#10b981' : '#ef4444';
        return '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:14px;padding:14px;cursor:pointer;" onclick="openOrgDetail(\'' + org.id + '\')">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                '<div>' +
                    '<div style="font-weight:800;font-size:1rem;color:white;">' + (org.name||'Unnamed') + '</div>' +
                    '<div style="font-size:0.78rem;color:var(--text-dim);margin-top:2px;">👤 ' + (admin?admin.name:'—') + ' &nbsp;·&nbsp; 📱 +91 ' + (admin?admin.phone:(org.ownerPhone||'—')) + '</div>' +
                '</div>' +
                '<span style="font-size:0.68rem;font-weight:800;color:' + statusColor + ';border:1px solid ' + statusColor + ';border-radius:8px;padding:2px 8px;">' + (org.status||'active').toUpperCase() + '</span>' +
            '</div>' +
            '<div style="display:flex;gap:14px;margin-top:10px;font-size:0.8rem;color:var(--text-dim);">' +
                '<span>📂 ' + gCount + ' group' + (gCount!==1?'s':'') + '</span>' +
                '<span>👥 ' + mCount + ' member' + (mCount!==1?'s':'') + '</span>' +
            '</div>' +
            '<div style="font-size:0.72rem;color:#6366f1;margin-top:8px;font-weight:700;">Tap for full details →</div>' +
            (admin ? '<button class="btn-cancel" style="width:100%;margin-top:10px;font-size:0.78rem;padding:7px;" onclick="event.stopPropagation();openResetPasswordModal(\'' + admin.uid + '\',\'' + admin.phone + '\',\'' + (admin.name||'').replace(/'/g,"\\'") + '\')">🔑 Reset Login Password</button>' : '') +
        '</div>';
    }).join('');
}

// ── Supreme: drill-down detail for one org ────────────────────────────────────
function openOrgDetail(orgId){
    if(!_supremeCache) return;
    const {orgs, admins, groups, members, payments} = _supremeCache;
    const org = orgs.find(o=>o.id===orgId); if(!org) return;
    const admin = admins.find(a=>a.orgId===orgId);
    const orgGroups   = groups.filter(g=>g.orgId===orgId);
    const orgMembers  = members.filter(m=>m.orgId===orgId);
    const orgPayments = payments.filter(p=>p.orgId===orgId);

    const totalCollected = orgPayments.reduce((s,p)=>s+(Number(p.paid)||0), 0);
    const totalBalance   = orgPayments.reduce((s,p)=>s+(Number(p.balance)||0), 0);

    // Breakdown by payment mode ("paidBy")
    const modeMap = {};
    orgPayments.forEach(function(p){
        const mode = p.paidBy || 'Unspecified';
        modeMap[mode] = (modeMap[mode]||0) + (Number(p.paid)||0);
    });
    const modeRows = Object.keys(modeMap).sort(function(a,b){ return modeMap[b]-modeMap[a]; });

    document.getElementById('orgDetailTitle').textContent = org.name || 'Unnamed Org';
    document.getElementById('orgDetailSubtitle').textContent =
        '👤 ' + (admin?admin.name:'—') + ' · 📱 +91 ' + (admin?admin.phone:(org.ownerPhone||'—'));

    document.getElementById('orgDetailStats').innerHTML = [
        ['📂', orgGroups.length, 'Groups'],
        ['👥', orgMembers.length, 'Members'],
        ['💰', '₹' + totalCollected.toLocaleString('en-IN'), 'Collected'],
        ['⚠️', '₹' + totalBalance.toLocaleString('en-IN'), 'Balance']
    ].map(function(s){
        return '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:10px;text-align:center;">' +
            '<div style="font-size:1.1rem;">' + s[0] + '</div>' +
            '<div style="font-weight:800;font-size:0.95rem;color:white;">' + s[1] + '</div>' +
            '<div style="font-size:0.62rem;color:var(--text-dim);">' + s[2] + '</div>' +
        '</div>';
    }).join('');

    document.getElementById('orgDetailModeBreakdown').innerHTML = modeRows.length
        ? modeRows.map(function(mode){
            return '<div style="display:flex;justify-content:space-between;font-size:0.82rem;padding:5px 0;border-bottom:1px solid var(--border);">' +
                '<span style="color:var(--text-dim);">' + mode + '</span>' +
                '<span style="color:white;font-weight:700;">₹' + modeMap[mode].toLocaleString('en-IN') + '</span>' +
            '</div>';
        }).join('')
        : '<div style="color:var(--text-dim);font-size:0.8rem;">No payments recorded yet</div>';

    document.getElementById('orgDetailGroups').innerHTML = orgGroups.length
        ? orgGroups.map(function(g){
            return '<div style="font-size:0.82rem;padding:6px 0;border-bottom:1px solid var(--border);">' +
                '<span style="color:white;font-weight:700;">' + (g.name||'Unnamed') + '</span>' +
                '<span style="color:var(--text-dim);"> — ₹' + (g.chitValue||g.amount||'—') + '</span>' +
            '</div>';
        }).join('')
        : '<div style="color:var(--text-dim);font-size:0.8rem;">No groups yet</div>';

    document.getElementById('orgDetailMembers').innerHTML = orgMembers.length
        ? orgMembers.map(function(m){
            const paidTotal = orgPayments.filter(p=>p.memberId===m.id).reduce((s,p)=>s+(Number(p.paid)||0),0);
            return '<div style="display:flex;justify-content:space-between;font-size:0.82rem;padding:6px 0;border-bottom:1px solid var(--border);">' +
                '<span style="color:white;">' + (m.name||'Unnamed') + ' <span style="color:var(--text-dim);">+91 ' + (m.phone||'—') + '</span></span>' +
                '<span style="color:#10b981;font-weight:700;">₹' + paidTotal.toLocaleString('en-IN') + '</span>' +
            '</div>';
        }).join('')
        : '<div style="color:var(--text-dim);font-size:0.8rem;">No members yet</div>';

    openModal('orgDetailModal');
}

// ── Supreme: reset an Admin/Member's password ─────────────────────────────────
// IMPORTANT LIMITATION: Firebase's client SDK cannot directly overwrite another
// user's password — that normally requires a backend (Cloud Function + Admin
// SDK) or a real, deliverable email address for Firebase's password-reset
// email. Until one of those is set up, this dialog can only show you how to
// do it manually via the Firebase Console (Authentication → Users).
let _resetTargetUid = null, _resetTargetPhone = null;

function openResetPasswordModal(uid, phone, name){
    _resetTargetUid = uid;
    _resetTargetPhone = phone;
    document.getElementById('resetPwTargetName').textContent = name + ' (+91 ' + phone + ')';
    document.getElementById('resetPwEmail').textContent = phone + '@mychits.local';
    openModal('resetPasswordModal');
}

// Uses the secondary Firebase app instance so the Admin's own session survives.
// Returns the new user's uid, or null if it failed (member doc is still saved
// either way — this only affects whether they can log in).
async function provisionMemberLogin(phoneLocal, password, name, memberId){
    if(!CURRENT_USER || (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'supreme')) return null;
    if(!phoneLocal || phoneLocal.length !== 10 || !password) return null;
    try{
        const email = phoneToEmail(phoneLocal);
        const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
        const newUid = cred.user.uid;
        await secondaryAuth.signOut();
        await db.collection('users').doc(newUid).set({
            role: 'member', orgId: CURRENT_USER.orgId, memberId: memberId,
            name: name, phone: phoneLocal, createdAt: new Date().toISOString()
        });
        return newUid;
    }catch(err){
        console.error(err);
        if(err.code === 'auth/email-already-in-use'){
            showToast('⚠️ Member saved, but that phone already has a login — ask them to use their existing password', false);
        } else {
            showToast('⚠️ Member saved, but login setup failed: ' + (err.message||'unknown error'), false);
        }
        return null;
    }
}
