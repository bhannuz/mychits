// ═══════════════════════════════════════════════════════════
// MYCHITS — AUTH & ACCESS CONTROL (Firebase Phone Auth + multi-tenant roles)
// ═══════════════════════════════════════════════════════════

// Single default tenant used until the "create new org" flow (Supreme
// dashboard, next phase) is built. Every new admin/member is scoped to
// this org for now.
const DEFAULT_ORG_ID = 'org_default';

let _confirmationResult = null;
let _recaptchaVerifier   = null;
let _pendingVerifiedPhone = null; // E.164, set once OTP is confirmed

function saveSession(user){ sessionStorage.setItem('mychits_session', JSON.stringify(user)); }
function loadSession(){ try{ return JSON.parse(sessionStorage.getItem('mychits_session'))||null; }catch(e){ return null; } }
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

function _getRecaptcha(){
    if(!_recaptchaVerifier){
        _recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            size: 'invisible'
        });
    }
    return _recaptchaVerifier;
}

// ── Step 1: send OTP ───────────────────────────────────────────────────────────
async function handleLoginSubmit(){
    const phoneLocal = document.getElementById('loginPhone').value.trim();
    if(phoneLocal.length !== 10){ showToast('❌ Enter valid 10-digit number', false); return; }
    const e164 = '+91' + phoneLocal;
    showToast('⏳ Sending OTP…', true);
    try{
        _confirmationResult = await firebase.auth().signInWithPhoneNumber(e164, _getRecaptcha());
        document.getElementById('otpPhoneLabel').textContent = '+91 ' + phoneLocal;
        showLoginStep('loginStep1b');
        showToast('📲 OTP sent', true);
    }catch(err){
        console.error(err);
        showToast('❌ Could not send OTP. Try again.', false);
        if(_recaptchaVerifier){ _recaptchaVerifier.render().then(function(id){ grecaptcha.reset(id); }).catch(function(){}); }
    }
}

// ── Step 1b: verify OTP, then resolve role from users/{phone} ─────────────────
async function handleOtpSubmit(){
    const code = document.getElementById('loginOtp').value.trim();
    if(!_confirmationResult){ showToast('❌ Request a new OTP', false); goBackToLogin(); return; }
    if(code.length !== 6){ showToast('❌ Enter the 6-digit code', false); return; }
    showToast('⏳ Verifying…', true);
    try{
        const result = await _confirmationResult.confirm(code);
        const e164 = result.user.phoneNumber; // e.g. "+919876543210"
        _pendingVerifiedPhone = e164;
        await resolveSessionForPhone(e164);
    }catch(err){
        console.error(err);
        showToast('❌ Incorrect or expired OTP', false);
    }
}

// Looks up users/{phone}; logs the person in if a profile exists, otherwise
// falls back to the access-request flow.
async function resolveSessionForPhone(e164){
    const phoneLocal = e164.replace(/\D/g,'').slice(-10);
    const userDoc = await db.collection('users').doc(e164).get().catch(()=>null);

    if(userDoc && userDoc.exists){
        const u = userDoc.data();
        const user = {
            phone: phoneLocal, phoneE164: e164,
            role: u.role, orgId: u.orgId || null,
            memberId: u.memberId || null, name: u.name || 'User'
        };
        CURRENT_USER = user;
        saveSession(user);
        applyUserSession(user);
        return;
    }

    // No profile yet — existing member or brand-new signup, both go through
    // an access request scoped to the default org for now.
    const members = await db.collection('members').where('orgId','==',DEFAULT_ORG_ID).get()
        .then(s=>s.docs.map(d=>({id:d.id,...d.data()}))).catch(()=>[]);
    const matched = members.find(function(m){
        return (m.phone||'').replace(/\D/g,'').slice(-10) === phoneLocal;
    });

    const reqs = await db.collection('accessRequests').where('phone','==',e164).get()
        .catch(function(){ return {empty:true, docs:[]}; });

    if(!reqs.empty && reqs.docs.length > 0){
        const req = reqs.docs[0].data();
        if(req.status === 'denied'){
            showLoginStep('loginStep3');
        } else {
            document.getElementById('pendingPhone').textContent = '+91 ' + phoneLocal;
            showLoginStep('loginStep2');
        }
    } else {
        await db.collection('accessRequests').add({
            phone: e164,
            phoneLocal: phoneLocal,
            orgId: DEFAULT_ORG_ID,
            name: matched ? matched.name : 'Unknown (' + phoneLocal + ')',
            memberId: matched ? matched.id : '',
            status: 'pending',
            requestedAt: new Date().toISOString()
        });
        document.getElementById('pendingPhone').textContent = '+91 ' + phoneLocal;
        showLoginStep('loginStep2');
        showToast('📨 Access request sent to admin', true);
    }
}

async function checkAccessStatus(){
    if(!_pendingVerifiedPhone){ goBackToLogin(); return; }
    const userDoc = await db.collection('users').doc(_pendingVerifiedPhone).get().catch(()=>null);
    if(userDoc && userDoc.exists){
        showToast('✅ Access approved! Loading…', true);
        await resolveSessionForPhone(_pendingVerifiedPhone);
        return;
    }
    const reqs = await db.collection('accessRequests').where('phone','==',_pendingVerifiedPhone).get()
        .catch(function(){ return {empty:true, docs:[]}; });
    if(!reqs.empty && reqs.docs.length > 0 && reqs.docs[0].data().status === 'denied'){
        showLoginStep('loginStep3');
        return;
    }
    showToast('⏳ Still pending approval', true);
}

// ── Login step switcher ───────────────────────────────────────────────────────
var _pendingPollTimer = null;

function showLoginStep(stepId){
    ['loginStep1','loginStep1b','loginStep2','loginStep3'].forEach(function(id){
        document.getElementById(id).classList.remove('active');
    });
    document.getElementById(stepId).classList.add('active');
    if(stepId === 'loginStep2'){
        if(_pendingPollTimer) clearInterval(_pendingPollTimer);
        _pendingPollTimer = setInterval(silentCheckStatus, 5000);
    } else {
        if(_pendingPollTimer){ clearInterval(_pendingPollTimer); _pendingPollTimer = null; }
    }
}

async function silentCheckStatus(){
    if(!_pendingVerifiedPhone) return;
    const userDoc = await db.collection('users').doc(_pendingVerifiedPhone).get().catch(()=>null);
    if(userDoc && userDoc.exists){
        if(_pendingPollTimer){ clearInterval(_pendingPollTimer); _pendingPollTimer = null; }
        showToast('✅ Access approved! Loading…', true);
        await resolveSessionForPhone(_pendingVerifiedPhone);
        return;
    }
    const reqs = await db.collection('accessRequests').where('phone','==',_pendingVerifiedPhone).get()
        .catch(function(){ return {docs:[]}; });
    if(reqs.docs && reqs.docs.length && reqs.docs[0].data().status === 'denied'){
        if(_pendingPollTimer){ clearInterval(_pendingPollTimer); _pendingPollTimer = null; }
        showLoginStep('loginStep3');
    }
}

function goBackToLogin(){
    document.getElementById('loginPhone').value = '';
    document.getElementById('loginOtp').value = '';
    _confirmationResult = null;
    _pendingVerifiedPhone = null;
    showLoginStep('loginStep1');
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
        document.getElementById('accessReqBtn').style.display = 'inline-flex';
        document.getElementById('adminStatCards').style.display = '';
        document.getElementById('adminActionBtns').style.display = 'flex';
        document.getElementById('adminMemberSearch').style.display = '';
        document.getElementById('memberLedgerArea').style.display = 'none';
        document.getElementById('qrGeneratorSection').style.display = '';
        document.getElementById('waReminderSection').style.display = '';
        document.getElementById('adminQuickBtns').style.display = 'flex';
        document.getElementById('memberQrArea').style.display = 'none';
        updateUI();
        pollPendingRequests();
        setTimeout(checkAndShowBackupReminder, 1200);
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
    sessionStorage.removeItem('mychits_session');
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
    document.getElementById('headerRoleBadge').textContent = 'ADMIN';
    document.getElementById('headerRoleBadge').className = 'badge text-warning border border-warning px-2';
    document.getElementById('ledgerData').innerHTML = '';
    document.getElementById('memberLedgerData').innerHTML = '';
    document.getElementById('summarySearch').value = '';
    document.getElementById('summaryView').value = '';
    showLoginStep('loginStep1');
    document.getElementById('loginPhone').value = '';
    document.getElementById('loginScreen').style.display = 'flex';
}

// ── Access Requests Panel ─────────────────────────────────────────────────────
var _reqFilter = 'pending';

async function openAccessRequests(){
    _reqFilter = 'pending';
    await renderAccessRequests();
    openModal('accessModal');
}

async function filterRequests(type){
    _reqFilter = type;
    ['pending','approved','all'].forEach(function(t){
        var btn = document.getElementById('reqTab' + t.charAt(0).toUpperCase() + t.slice(1));
        if(btn) btn.className = t === type ? 'btn-save' : 'btn-cancel';
    });
    await renderAccessRequests();
}

async function _accessRequestsQuery(){
    if(CURRENT_USER && CURRENT_USER.role === 'supreme'){
        return db.collection('accessRequests').orderBy('requestedAt','desc').get()
            .catch(function(){ return db.collection('accessRequests').get(); });
    }
    return db.collection('accessRequests').where('orgId','==',CURRENT_USER.orgId).get();
}

async function renderAccessRequests(){
    var list = document.getElementById('accessRequestsList');
    list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:16px;">Loading…</div>';
    var snap = await _accessRequestsQuery();
    var all      = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    all.sort(function(a,b){ return (b.requestedAt||'').localeCompare(a.requestedAt||''); });
    var filtered = _reqFilter === 'all' ? all : all.filter(function(r){ return r.status === _reqFilter; });

    if(!filtered.length){
        list.innerHTML = '<div style="text-align:center;color:var(--text-dim);padding:24px;">No ' + (_reqFilter==='all'?'':_reqFilter) + ' requests</div>';
        return;
    }

    list.innerHTML = filtered.map(function(r){
        var dateStr = r.requestedAt ? new Date(r.requestedAt).toLocaleDateString('en-IN') : '—';
        var phoneLocal = (r.phoneLocal || (r.phone||'').replace(/\D/g,'').slice(-10));
        var actions = '';
        if(r.status === 'pending'){
            actions = '<button class="btn-approve" onclick="handleApprove(\'' + r.id + '\',\'' + r.phone + '\')">✅ Approve</button>' +
                      '<button class="btn-deny" onclick="handleDeny(\'' + r.id + '\')">✕ Deny</button>';
        } else if(r.status === 'approved'){
            actions = '<span class="badge-approved">✅ Approved</span>' +
                      '<button class="btn-deny" style="font-size:0.92rem;padding:4px 8px;" onclick="handleDeny(\'' + r.id + '\')">Revoke</button>';
        } else {
            actions = '<span class="badge-denied">🚫 Denied</span>' +
                      '<button class="btn-approve" style="font-size:0.92rem;padding:4px 8px;" onclick="handleApprove(\'' + r.id + '\',\'' + r.phone + '\')">Re-approve</button>';
        }
        return '<div class="req-card">' +
            '<div style="flex:1;min-width:0;">' +
            '<div class="req-name">' + (r.name||'Unknown') + '</div>' +
            '<div class="req-phone">📱 +91 ' + phoneLocal + ' &nbsp;·&nbsp; ' + dateStr + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">' + actions + '</div>' +
            '</div>';
    }).join('');
}

// phone param here is the E.164 value stored on the accessRequests doc.
async function handleApprove(reqId, phone){
    const reqSnap = await db.collection('accessRequests').doc(reqId).get();
    const req = reqSnap.data();
    const orgId = req.orgId || CURRENT_USER.orgId;

    const phoneLocal = phone.replace(/\D/g,'').slice(-10);
    const members = await db.collection('members').where('orgId','==',orgId).get()
        .then(s=>s.docs.map(d=>({id:d.id,...d.data()}))).catch(()=>[]);
    const matched = members.find(function(m){ return (m.phone||'').replace(/\D/g,'').slice(-10) === phoneLocal; });

    await db.collection('users').doc(phone).set({
        role: 'member',
        orgId: orgId,
        memberId: matched ? matched.id : (req.memberId || null),
        name: matched ? matched.name : req.name,
        phone: phone,
        createdAt: new Date().toISOString()
    });

    await db.collection('accessRequests').doc(reqId).update({status:'approved', approvedAt: new Date().toISOString()});
    showToast('✅ Access approved!');
    await renderAccessRequests();
    await pollPendingRequests();
}

async function handleDeny(reqId){
    await db.collection('accessRequests').doc(reqId).update({status:'denied', deniedAt: new Date().toISOString()});
    showToast('🚫 Access denied');
    await renderAccessRequests();
    await pollPendingRequests();
}

// ── Poll pending requests (admin) ─────────────────────────────────────────────
var _knownPendingIds = {};
var _firstPoll = true;

async function pollPendingRequests(){
    if(!CURRENT_USER || (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'supreme')) return;
    var q = CURRENT_USER.role === 'supreme'
        ? db.collection('accessRequests').where('status','==','pending')
        : db.collection('accessRequests').where('status','==','pending').where('orgId','==',CURRENT_USER.orgId);
    var snap = await q.get().catch(function(){ return {docs:[]}; });
    var count = snap.docs.length;

    var newRequests = [];
    snap.docs.forEach(function(d){
        if(!_knownPendingIds[d.id]){
            if(!_firstPoll) newRequests.push(Object.assign({id:d.id}, d.data()));
            _knownPendingIds[d.id] = true;
        }
    });
    Object.keys(_knownPendingIds).forEach(function(id){
        if(!snap.docs.find(function(d){ return d.id === id; })){
            delete _knownPendingIds[id];
        }
    });
    _firstPoll = false;

    var badge = document.getElementById('pendingCount');
    if(count > 0){
        badge.style.display = 'flex';
        badge.textContent   = count;
    } else {
        badge.style.display = 'none';
    }

    newRequests.forEach(function(req){
        playRequestSound();
        showRequestBanner(req);
    });
}

// ── Notification sound ────────────────────────────────────────────────────────
function playRequestSound(){
    try{
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        [[0, 880],[0.18, 1100],[0.36, 1320]].forEach(function(pair){
            var delay = pair[0], freq = pair[1];
            var osc  = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
            gain.gain.setValueAtTime(0, ctx.currentTime + delay);
            gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + delay + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.5);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + 0.6);
        });
    } catch(e){}
}

// ── Floating request banner ───────────────────────────────────────────────────
function showRequestBanner(req){
    var name  = req.name  || 'Unknown';
    var phoneLocal = (req.phoneLocal || (req.phone||'').replace(/\D/g,'').slice(-10));
    var phone = req.phone || '';
    var reqId = req.id;

    if(!document.getElementById('akBannerStyle')){
        var s = document.createElement('style');
        s.id = 'akBannerStyle';
        s.textContent = '@keyframes akSlideDown{from{opacity:0;transform:translateX(-50%) translateY(-16px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
        document.head.appendChild(s);
    }

    var banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);' +
        'background:linear-gradient(135deg,#1c253b,#141b2d);' +
        'border:1px solid rgba(243,156,18,0.5);border-radius:16px;padding:14px 16px;' +
        'z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.6);' +
        'min-width:280px;max-width:320px;animation:akSlideDown 0.3s ease;';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;';

    var bell = document.createElement('div');
    bell.style.cssText = 'font-size:1.5rem;flex-shrink:0;';
    bell.textContent = '🔔';

    var txt = document.createElement('div');
    txt.style.cssText = 'flex:1;min-width:0;';
    txt.innerHTML = '<div style="font-size:0.78rem;font-weight:800;color:#f39c12;margin-bottom:2px;">New Access Request</div>' +
        '<div style="font-size:0.85rem;font-weight:700;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + name + '</div>' +
        '<div style="font-size:0.7rem;color:#8e9aaf;">📱 +91 ' + phoneLocal + '</div>';

    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;flex-direction:column;gap:5px;flex-shrink:0;';

    var btnApprove = document.createElement('button');
    btnApprove.style.cssText = 'background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:8px;padding:6px 10px;font-size:0.72rem;font-weight:800;cursor:pointer;';
    btnApprove.textContent = '✅ Approve';
    btnApprove.onclick = function(){ handleApprove(reqId, phone); banner.remove(); };

    var btnDeny = document.createElement('button');
    btnDeny.style.cssText = 'background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;border-radius:8px;padding:6px 10px;font-size:0.72rem;font-weight:700;cursor:pointer;';
    btnDeny.textContent = '✕ Deny';
    btnDeny.onclick = function(){ handleDeny(reqId); banner.remove(); };

    btns.appendChild(btnApprove);
    btns.appendChild(btnDeny);
    row.appendChild(bell);
    row.appendChild(txt);
    row.appendChild(btns);
    banner.appendChild(row);
    document.body.appendChild(banner);

    setTimeout(function(){ if(banner.parentNode) banner.remove(); }, 12000);
}
