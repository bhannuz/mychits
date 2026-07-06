// ═══════════════════════════════════════════════════════════
// AK Chit Funds — PAYMENTS
// ═══════════════════════════════════════════════════════════

// MULTI-MONTH HELPERS
// ══════════════════════════════════════════
async function getPaidSlots(memberId, groupId, group, enrollmentId, slotNum){
    const allDueDates=getGroupDueDates(group);
    const ps=await getCollection('payments');
    // Scope to specific slot — never mix slots
    // Matches: new payments (by enrollmentId) OR old payments (no enrollmentId, matched by slotNum)
    const mPays=ps.filter(p=>{
        if(p.memberId!==memberId||p.groupId!==groupId) return false;
        // If slotNum is provided (multi-slot group), ALWAYS filter by slot
        // to prevent one slot's payments leaking into another
        if(slotNum){
            const pSlot = p.slotNum ? Number(p.slotNum) : 1; // default old payments to slot 1
            const mySlot = Number(slotNum);
            if(pSlot !== mySlot) return false;
        }
        // Within same slot: further narrow by enrollmentId if both sides have it
        if(enrollmentId && p.enrollmentId && p.enrollmentId!==''){
            return p.enrollmentId === enrollmentId;
        }
        return true;
    });
    const paidSlots=new Set();
    mPays.forEach(p=>{
        if(Array.isArray(p.monthSlots)) p.monthSlots.forEach(s=>paidSlots.add(s));
        else if(p.monthSlot!==undefined&&p.monthSlot!==null) paidSlots.add(p.monthSlot);
        else { const slot=getMonthSlot(allDueDates,p.date); if(slot>=0) paidSlots.add(slot); }
    });
    return {paidSlots, allDueDates};
}

// Check if a specific slot already has chitPicked=Yes — slot-isolated
async function isChitAlreadyPicked(ps, memberId, groupId, enrollmentId, slotNum){
    return ps.some(p => {
        if(p.chitPicked !== 'Yes') return false;
        if(p.memberId !== memberId || p.groupId !== groupId) return false;
        // Primary: slotNum match (most reliable, always present on new payments)
        const pSlot = p.slotNum ? Number(p.slotNum) : 1;
        const mySlot = Number(slotNum) || 1;
        if(pSlot !== mySlot) return false;
        // Secondary: if both have enrollmentId, they must match
        if(enrollmentId && p.enrollmentId && p.enrollmentId !== ''){
            return p.enrollmentId === enrollmentId;
        }
        return true;
    });
}


function getSelectedMonthSlots(){
    return Array.from(document.querySelectorAll('#monthSelectorGrid input[type=checkbox]:checked:not(:disabled)')).map(cb=>parseInt(cb.value));
}

// ══════════════════════════════════════════
// SINGLE MONTH SELECTOR — dropdown of all months
// ══════════════════════════════════════════
window._singleMonthPaidSlots = new Set();

async function buildSingleMonthDropdown(){
    const mid=document.getElementById('pMember').value;
    const gid=document.getElementById('pGroup').value;
    const wrap=document.getElementById('singleMonthDropdownWrap');
    const sel=document.getElementById('pSingleMonthSlot');
    const badge=document.getElementById('singleMonthBadge');
    window._singleMonthPaidSlots=new Set();
    sel.innerHTML='<option value="">-- Select Month --</option>';
    badge.style.display='none';
    if(!mid||!gid){wrap.style.display='none';return;}
    const gs=await getCollection('groups');
    const grp=gs.find(g=>g.id===gid);
    if(!grp){wrap.style.display='none';return;}
    const eid=document.getElementById('pEnrollmentId').value||'';
    const sn=parseInt(document.getElementById('pSlotNum').value||'1');
    const {paidSlots,allDueDates}=await getPaidSlots(mid,gid,grp,eid,sn);
    window._singleMonthPaidSlots=paidSlots;
    if(!allDueDates.length){wrap.style.display='none';return;}
    wrap.style.display='block';
    const today=new Date().toISOString().split('T')[0];
    const currentSlot=getMonthSlot(allDueDates,today);
    let autoSelect=currentSlot;
    // If current month already paid, jump to next unpaid
    if(paidSlots.has(currentSlot)){
        for(let i=currentSlot+1;i<allDueDates.length;i++){
            if(!paidSlots.has(i)){autoSelect=i;break;}
        }
    }
    sel.innerHTML='<option value="">-- Select Month --</option>'+allDueDates.map((dd,i)=>{
        const isPaid=paidSlots.has(i);
        const isPast=dd<today;
        const isCurrent=i===currentSlot;
        let tag='';
        if(isPaid) tag=' ✅ Paid';
        else if(isCurrent) tag=' ← Current';
        else if(isPast) tag=' ⚠ Overdue';
        else tag=' (Upcoming)';
        return `<option value="${i}" ${i===autoSelect?'selected':''}>${fmtDate(dd)}${tag}</option>`;
    }).join('');
    onSingleMonthSlotChange();
}


async function onNumMonthsChange(){
    const preview=document.getElementById('multiMonthPreview');
    document.getElementById('totalChitRef').style.display='none';
    document.getElementById('perMonthLabel').textContent='(per month)';
    preview.style.display='block';
    await buildMonthSelectorGrid();
    calcBalance();
    updateChitPickedOption();
}

async function buildMonthSelectorGrid(){
    const mid=document.getElementById('pMember').value;
    const gid=document.getElementById('pGroup').value;
    const grid=document.getElementById('monthSelectorGrid');
    const summary=document.getElementById('selectedSummary');
    grid.innerHTML='<div style="color:var(--text-dim);font-size:0.92rem;padding:8px;">Select member & group first\u2026</div>';
    summary.style.display='none';
    document.getElementById('perMonthAmtWrap').style.display='none';
    document.getElementById('perMonthCustomToggle').checked=false;
    if(!mid||!gid) return;
    const gs=await getCollection('groups');
    window._gs_cache=gs;
    const grp=gs.find(g=>g.id===gid);
    if(!grp){grid.innerHTML='<div style="color:#f87171;font-size:0.92rem;">Group not found</div>';return;}
    const eid=document.getElementById('pEnrollmentId').value||'';
    const sn=parseInt(document.getElementById('pSlotNum').value||'1');
    const {paidSlots,allDueDates}=await getPaidSlots(mid,gid,grp,eid,sn);
    if(!allDueDates.length){grid.innerHTML='<div style="color:#f87171;font-size:0.92rem;">No due dates configured for this group</div>';return;}
    const today=new Date().toISOString().split('T')[0];
    grid.innerHTML=allDueDates.map((dd,i)=>{
        const paid=paidSlots.has(i);
        const isPast=dd<=today;
        const label=paid?'✅':(isPast?'⚠':'·');
        const color=paid?'#34d399':(isPast?'#f87171':'var(--text-dim)');
        return`<label class="month-cb-item ${paid?'already-paid':''}" style="padding:4px 5px;gap:3px;">
            <input type="checkbox" value="${i}" ${paid?'disabled checked':''} onchange="updateSelectedSummary();calcBalance();" style="width:11px;height:11px;margin:0;">
            <div style="min-width:0;">
                <div style="font-size:0.65rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${fmtDate(dd)}</div>
                <div style="font-size:0.6rem;color:${color};">${label}</div>
            </div>
        </label>`;
    }).join('');
    updateSelectedSummary();
}

function updateSelectedSummary(){
    const newlySelected=Array.from(document.querySelectorAll('#monthSelectorGrid input[type=checkbox]:checked:not(:disabled)')).map(cb=>parseInt(cb.value));
    const summary=document.getElementById('selectedSummary');
    if(newlySelected.length===0){
        summary.style.display='none';
        document.getElementById('perMonthAmtWrap').style.display='none';
    } else {
        summary.style.display='block';
        summary.textContent=`\ud83d\udcc5 ${newlySelected.length} month${newlySelected.length>1?'s':''} selected for payment`;
        document.getElementById('perMonthAmtWrap').style.display='block';
        buildPerMonthAmtGrid(newlySelected);
    }
    calcBalance();
    updateChitPickedOption();
}

function buildPerMonthAmtGrid(selectedSlots){
    const isCustom=document.getElementById('perMonthCustomToggle').checked;
    const grid=document.getElementById('perMonthAmtGrid');
    if(!isCustom){ grid.style.display='none'; return; }
    grid.style.display='flex';
    const gs_cache=window._gs_cache||[];
    const gid=document.getElementById('pGroup').value;
    const grp=gs_cache.find(g=>g.id===gid);
    const allDueDates=grp?getGroupDueDates(grp):[];
    const chit=parseFloat(document.getElementById('pChit').value)||0;
    const existing={};
    grid.querySelectorAll('.pma-row').forEach(r=>{ existing[r.dataset.slot]=r.querySelector('input').value; });
    grid.innerHTML=selectedSlots.map(slot=>{
        const label=allDueDates[slot]?fmtDate(allDueDates[slot]):`Month ${slot+1}`;
        const val=existing[slot]!==undefined?existing[slot]:(chit||'');
        return `<div class="pma-row" data-slot="${slot}" style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;padding:7px 10px;">
            <span style="flex:1;font-size:0.92rem;color:#a5b4fc;font-weight:700;">${label}</span>
            <input type="number" placeholder="\u20b9 amount" value="${val}" style="width:110px;background:var(--input-bg);border:1px solid var(--border);color:white;padding:6px 9px;border-radius:7px;font-size:1rem;" oninput="calcBalance()">
        </div>`;
    }).join('');
}

function togglePerMonthCustom(){
    const isCustom=document.getElementById('perMonthCustomToggle').checked;
    const slots=Array.from(document.querySelectorAll('#monthSelectorGrid input[type=checkbox]:checked:not(:disabled)')).map(cb=>parseInt(cb.value));
    if(isCustom && slots.length>0) buildPerMonthAmtGrid(slots);
    else document.getElementById('perMonthAmtGrid').style.display='none';
    calcBalance();
    updateChitPickedOption();
}

function onChitAmtChange(){
    if(document.getElementById('perMonthCustomToggle')?.checked){
        const chit=parseFloat(document.getElementById('pChit').value)||0;
        document.querySelectorAll('#perMonthAmtGrid .pma-row input').forEach(inp=>{
            if(!inp.value) inp.value=chit||'';
        });
    }
    calcBalance();
    updateChitPickedOption();
}

function getPerMonthAmounts(){
    if(!document.getElementById('perMonthCustomToggle')?.checked) return null;
    const map={};
    document.querySelectorAll('#perMonthAmtGrid .pma-row').forEach(r=>{
        const slot=parseInt(r.dataset.slot);
        const val=parseFloat(r.querySelector('input').value)||0;
        if(!isNaN(slot)) map[slot]=val;
    });
    return map;
}

function calcBalance(){
    const chit=parseFloat(document.getElementById('pChit').value)||0;
    const paid=parseFloat(document.getElementById('pPaid').value)||0;
    const isMulti=document.getElementById('pNumMonths').value==='multi';
    if(isMulti){
        const selectedCBs=Array.from(document.querySelectorAll('#monthSelectorGrid input[type=checkbox]:checked:not(:disabled)'));
        const n=Math.max(1,selectedCBs.length);
        const isCustom=document.getElementById('perMonthCustomToggle')?.checked;
        let totalChit=0;
        if(isCustom){
            const amtMap=getPerMonthAmounts()||{};
            selectedCBs.forEach(cb=>{ totalChit+=(amtMap[parseInt(cb.value)]||chit); });
        } else {
            totalChit=chit*n;
        }
        const bal=Math.max(0,totalChit-paid);
        if(n>1){
            document.getElementById('totalChitRef').style.display='block';
            document.getElementById('totalChitVal').textContent=isCustom
                ? `\u20b9${totalChit.toLocaleString('en-IN')} (${n} months, custom amounts)`
                : `\u20b9${totalChit.toLocaleString('en-IN')} (${n}\u00d7\u20b9${chit.toLocaleString('en-IN')})`;
            document.getElementById('totalBalVal').textContent=`\u20b9${bal.toLocaleString('en-IN')}`;
        } else {
            document.getElementById('totalChitRef').style.display='none';
        }
    } else {
        document.getElementById('totalChitRef').style.display='none';
    }
}



// PAYMENT FORM
// ══════════════════════════════════════════
function resetPaymentForm(){
    document.getElementById('pDate').value=new Date().toISOString().split('T')[0];
    document.getElementById('pMemberSearch').value='';
    document.getElementById('pMember').value='';
    document.getElementById('pMemberList').style.display='none';
    document.getElementById('pGroup').innerHTML='<option value="">-- Select Member First --</option>';
    document.getElementById('pNumMonths').value='multi';
    if(document.getElementById('perMonthCustomToggle')) document.getElementById('perMonthCustomToggle').checked=false;
    if(document.getElementById('perMonthAmtGrid')) document.getElementById('perMonthAmtGrid').style.display='none';
    if(document.getElementById('perMonthAmtWrap')) document.getElementById('perMonthAmtWrap').style.display='none';
    document.getElementById('pChit').value='';
    document.getElementById('pPaid').value='';
    document.getElementById('pPaidBy').value='';
    document.getElementById('pChitPicked').value='No';
    document.getElementById('pChitPickedBy').value='';
    document.getElementById('chitPickedNameDiv').style.display='none';
    document.getElementById('multiMonthPreview').style.display='none';
    document.getElementById('totalChitRef').style.display='none';
    document.getElementById('perMonthLabel').textContent='';
    document.getElementById('monthSelectorGrid').innerHTML='';
    document.getElementById('selectedSummary').style.display='none';
    const sel=document.getElementById('pChitPicked');
    [...sel.options].forEach(o=>o.disabled=false);
    sel.title='';
    // reset single month dropdown
    if(document.getElementById('singleMonthDropdownWrap')) document.getElementById('singleMonthDropdownWrap').style.display='none';
    if(document.getElementById('pSingleMonthSlot')) document.getElementById('pSingleMonthSlot').innerHTML='<option value="">-- Select Month --</option>';
    if(document.getElementById('singleMonthBadge')) document.getElementById('singleMonthBadge').style.display='none';
    window._singleMonthPaidSlots=new Set();
    // Initialize correct mode UI (multi is default, onchange won't fire)
    onNumMonthsChange();
    loadPaidByOptions().then(()=>populatePaidBySelect('pPaidBy'));
}

function openPaymentModal(){
    if(!isAdmin()){showToast('\ud83d\udeab Access denied',false);return;}
    resetPaymentForm();
    openModal('paymentModal');
}

async function linkGroupForPayment(){
    const mid=document.getElementById('pMember').value;
    const ms=await getCollection('members');const m=ms.find(x=>x.id===mid);if(!m)return;
    const gs=await getCollection('groups');

    let opts='';
    if(m.enrollments && m.enrollments.length){
        opts = m.enrollments.map(e=>{
            const g=gs.find(x=>x.id===e.groupId);
            if(!g) return '';
            const qty = parseInt(e.qty||1);
            if(qty > 1){
                return Array.from({length:qty},(_,i)=>{
                    const slotLabel = e.label ? `${e.label} \u2014 Chit ${i+1}` : `Chit ${i+1} of ${qty}`;
                    return `<option value="${e.groupId}" data-enrollment-id="${e.enrollmentId}" data-slot="${i+1}">${g.name} (${slotLabel})</option>`;
                }).join('');
            } else {
                const dispLabel = e.label ? ` (${e.label})` : '';
                return `<option value="${e.groupId}" data-enrollment-id="${e.enrollmentId}" data-slot="1">${g.name}${dispLabel}</option>`;
            }
        }).join('');
    } else {
        opts = gs.filter(g=>m.groupIds&&m.groupIds.includes(g.id)).map(g=>`<option value="${g.id}" data-slot="1">${g.name}</option>`).join('');
    }
    document.getElementById('pGroup').innerHTML = opts || '<option value="">No groups assigned</option>';

    const sel = document.getElementById('pGroup');
    sel.onchange = function(){
        const chosen = sel.options[sel.selectedIndex];
        document.getElementById('pEnrollmentId').value = chosen ? (chosen.dataset.enrollmentId||'') : '';
        document.getElementById('pSlotNum').value = chosen ? (chosen.dataset.slot||'1') : '1';
        onGroupChange();
    };
    const first = sel.options[sel.selectedIndex];
    document.getElementById('pEnrollmentId').value = first ? (first.dataset.enrollmentId||'') : '';
    document.getElementById('pSlotNum').value = first ? (first.dataset.slot||'1') : '1';
    await onGroupChange();
}

async function onGroupChange(){
    document.getElementById('pChit').value='';
    document.getElementById('pPaid').value='';
    document.getElementById('totalChitRef').style.display='none';
    const mid=document.getElementById('pMember').value;
    const gid=document.getElementById('pGroup').value;
    // Show joint member info if this enrollment is a joint chit
    await showJointMemberInfo(mid, gid);
    if(gid){
        const gs=await getCollection('groups');
        const grp=gs.find(g=>g.id===gid);
        let autoChit=0;
        if(grp && grp.amtType!=='variable' && grp.fixedAmt){
            autoChit=parseFloat(grp.fixedAmt)||0;
        }
        if(!autoChit && mid){
            const ps2=await getCollection('payments');
            const lastP=ps2.filter(p=>p.memberId===mid&&p.groupId===gid&&p.chit).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
            if(lastP.length) autoChit=parseFloat(lastP[0].chit)||0;
        }
        if(autoChit){
            document.getElementById('pChit').value=autoChit;
            calcBalance();
    updateChitPickedOption();
        }
    }
    if(mid&&gid){
        const ps=await getCollection('payments');
        const eid=document.getElementById('pEnrollmentId').value||'';
        const alreadyPicked=await isChitAlreadyPicked(ps,mid,gid,eid,parseInt(document.getElementById('pSlotNum').value||'1'));
        const sel=document.getElementById('pChitPicked');
        if(alreadyPicked){
            sel.value='No';
            [...sel.options].forEach(o=>{if(o.value==='Yes')o.disabled=true;});
            sel.title='This slot already picked the chit';
            document.getElementById('chitPickedNameDiv').style.display='none';
        } else {
            [...sel.options].forEach(o=>o.disabled=false);
            sel.title='';
        }
    }
    if(document.getElementById('pNumMonths').value==='multi'){
        await buildMonthSelectorGrid();
    } else {
        await buildSingleMonthDropdown();
    }
}


// JOINT ENROLLMENT DISPLAY
// ══════════════════════════════════════════
async function showJointMemberInfo(mid, gid){
    let banner = document.getElementById('jointMemberBanner');
    if(!banner) return;
    banner.style.display='none';
    banner.innerHTML='';
    if(!mid||!gid) return;
    const ms = await getCollection('members');
    const m = ms.find(x=>x.id===mid);
    if(!m||!m.enrollments) return;
    const enr = m.enrollments.find(e=>e.groupId===gid);
    if(!enr||!enr.coMemberId) return;
    const coM = ms.find(x=>x.id===enr.coMemberId);
    if(!coM) return;
    banner.style.display='block';
    banner.innerHTML=`
        <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.3rem;">👥</span>
            <div>
                <div style="font-size:0.88rem;font-weight:800;color:#a5b4fc;">Joint Chit</div>
                <div style="font-size:0.8rem;color:var(--text-dim);">
                    <strong style="color:#c4b5fd;">${m.name}</strong>
                    <span style="margin:0 6px;color:var(--text-dim);">+</span>
                    <strong style="color:#c4b5fd;">${coM.name}</strong>
                    ${coM.phone?'<span style="color:var(--text-dim);"> · '+coM.phone+'</span>':''}
                    share this chit slot
                </div>
            </div>
        </div>`;
}
// ══════════════════════════════════════════

// Simplified savePayment - remove payment note temporarily to fix the issue
async function savePayment(){
    try {
        if(!isAdmin()){showToast('🚫 Access denied',false);return;}
        
        const mid=document.getElementById('pMember').value;
        const gid=document.getElementById('pGroup').value;
        const date=document.getElementById('pDate').value;
        const chitPerMonth=parseFloat(document.getElementById('pChit').value)||0;
        const paid=parseFloat(document.getElementById('pPaid').value)||0;
        const paidBy=document.getElementById('pPaidBy').value;
        const chitPicked=document.getElementById('pChitPicked').value;
        const chitPickedBy=document.getElementById('pChitPickedBy').value.trim();
        const mode = document.getElementById('pNumMonths').value;

        if(!mid){showToast('❌ Select a member',false);return;}
        if(!gid){showToast('❌ Select a group',false);return;}
        if(!date){showToast('❌ Enter date',false);return;}
        if(!paid){showToast('❌ Enter amount paid',false);return;}

        if(mode === '1') {
            // Single month mode
            const slotSel = document.getElementById('pSingleMonthSlot');
            const selectedSlot = slotSel.value !== '' ? parseInt(slotSel.value) : null;
            if(selectedSlot===null){showToast('❌ Select which month this payment is for',false);return;}
            
            const monthSlots = [selectedSlot];
            const balance = Math.max(0, chitPerMonth - paid);
            const enrollmentId1 = document.getElementById('pEnrollmentId').value||'';
            const slotNum1 = parseInt(document.getElementById('pSlotNum').value||'1');
            
            // Check if THIS enrollment slot already picked chit
            if(chitPicked==='Yes'){
                const ps=await getCollection('payments');
                const alreadyPicked=await isChitAlreadyPicked(ps,mid,gid,enrollmentId1,slotNum1);
                if(alreadyPicked){showToast('❌ Chit already picked for this slot',false);return;}
            }
            
            const paymentNote1=getPaymentNoteText();
            await db.collection('payments').add({
                memberId:mid, groupId:gid, enrollmentId:enrollmentId1, slotNum:slotNum1, date,
                chit:chitPerMonth, paid, balance, paidBy, chitPicked, chitPickedBy,
                numMonths:1, monthSlots, monthSlot:selectedSlot,
                paidPerMonth:paid, balPerMonth:balance, paymentNote:paymentNote1, orgId: CURRENT_USER.orgId
            });
            
        } else {
            // Multiple month mode
            const monthSlots=getSelectedMonthSlots();
            if(monthSlots.length===0){showToast('❌ Select at least one month',false);return;}
            
            const numMonths=monthSlots.length;
            const totalChit=chitPerMonth*numMonths;
            const balance=Math.max(0,totalChit-paid);
            const enrollmentId1 = document.getElementById('pEnrollmentId').value||'';
            const slotNum1 = parseInt(document.getElementById('pSlotNum').value||'1');
            
            // Check if THIS enrollment slot already picked chit
            if(chitPicked==='Yes'){
                const ps=await getCollection('payments');
                const alreadyPickedInSlots=await isChitAlreadyPicked(ps,mid,gid,enrollmentId1,slotNum1);
                if(alreadyPickedInSlots){showToast('❌ Chit already picked for this slot',false);return;}
            }
            
            const paymentNote2=getPaymentNoteText();
            await db.collection('payments').add({
                memberId:mid, groupId:gid, enrollmentId:enrollmentId1, slotNum:slotNum1, date,
                chit:chitPerMonth, paid, balance, paidBy, chitPicked, chitPickedBy,
                numMonths, monthSlots, monthSlot:monthSlots[0],
                paidPerMonth:paid/numMonths, balPerMonth:balance/numMonths, paymentNote:paymentNote2, orgId: CURRENT_USER.orgId
            });
        }
        
        bustCache('payments');
        showToast('✅ Payment recorded!');
        closeModal('paymentModal');
        resetPaymentForm();
        
        await updateUI();
        const summaryView = document.getElementById('summaryView');
        if(summaryView) {
            summaryView.value = mid;
            await loadMemberLedger();
        }
        
    } catch(error) {
        console.error('Payment save error:', error);
        showToast('❌ ' + error.message, false);
    }
}

// EDIT / DELETE EXISTING PAYMENT
// ══════════════════════════════════════════
async function openEditPayment(pid){
    if(!isAdmin()){showToast('\ud83d\udeab Access denied',false);return;}
    const ps=await getCollection('payments');
    const p=ps.find(x=>x.id===pid);if(!p)return;
    document.getElementById('epId').value=pid;
    document.getElementById('epDate').value=p.date||'';
    document.getElementById('epChit').value=p.chit||'';
    document.getElementById('epPaid').value=p.paid||'';
    document.getElementById('epBal').value=p.balance||'';
    document.getElementById('epPaidBy').value=p.paidBy||'';
    document.getElementById('epChitPicked').value=p.chitPicked||'No';
    document.getElementById('epChitPickedBy').value=p.chitPickedBy||'';
    document.getElementById('epPaymentNote').value=p.paymentNote||'';
    onEditNoteChange();
    document.getElementById('epChitPickedNameDiv').style.display=p.chitPicked==='Yes'?'block':'none';

    const infoBox=document.getElementById('epMultiMonthInfo');
    const detailEl=document.getElementById('epMultiMonthDetail');
    if(p.numMonths&&p.numMonths>1){
        infoBox.style.display='block';
        const gs=await getCollection('groups');
        const grp=gs.find(g=>g.id===p.groupId);
        let slotLabels='';
        if(grp&&p.monthSlots){
            const dueDates=getGroupDueDates(grp);
            slotLabels=p.monthSlots.map((s,i)=>dueDates[s]?fmtDate(dueDates[s]):`Month ${s+1}`).join(' \u2192 ');
        }
        detailEl.innerHTML=`Covers <strong>${p.numMonths} months</strong>${slotLabels?': '+slotLabels:''}`;
    } else {
        infoBox.style.display='none';
    }

    openModal('editPaymentModal');
}

function epCalcBalance(){
    const chit=parseFloat(document.getElementById('epChit').value)||0;
    const paid=parseFloat(document.getElementById('epPaid').value)||0;
    document.getElementById('epBal').value=Math.max(0,chit-paid);
}
function epTogglePickedName(){
    document.getElementById('epChitPickedNameDiv').style.display=document.getElementById('epChitPicked').value==='Yes'?'block':'none';
}

async function saveEditPayment(){
    if(!isAdmin()){showToast('\ud83d\udeab Access denied',false);return;}
    const pid=document.getElementById('epId').value;if(!pid)return;
    const date=document.getElementById('epDate').value;
    const chit=parseFloat(document.getElementById('epChit').value)||0;
    const paid=parseFloat(document.getElementById('epPaid').value)||0;
    const balance=Math.max(0,chit-paid);
    const paidBy=document.getElementById('epPaidBy').value;
    const chitPicked=document.getElementById('epChitPicked').value;
    const chitPickedBy=document.getElementById('epChitPickedBy').value.trim();
    if(!date)return showToast('\u274c Enter date',false);
    if(!paid)return showToast('\u274c Enter amount paid',false);
    const paymentNote=getEditPaymentNoteText();
    await db.collection('payments').doc(pid).update({date,chit,paid,balance,paidBy,chitPicked,chitPickedBy,paymentNote});
    bustCache('payments');
    closeModal('editPaymentModal');showToast('\u2705 Payment updated!');updateUI();
    const mid=document.getElementById('summaryView').value;
    if(mid)loadMemberLedger();
}

async function deletePayment(){
    if(!isAdmin()){showToast('\ud83d\udeab Access denied',false);return;}
    const pid=document.getElementById('epId').value;if(!pid)return;
    showConfirm('\ud83d\uddd1','Delete Payment?','This will permanently delete this payment record.',async()=>{
        await db.collection('payments').doc(pid).delete();
        bustCache('payments');
        closeModal('editPaymentModal');showToast('\ud83d\uddd1 Payment deleted');updateUI();
        const mid=document.getElementById('summaryView').value;
        if(mid)loadMemberLedger();
    });
}

// ══════════════════════════════════════════


// ── Paid By: Editable Combo Dropdown (Firestore-synced) ────
const DEFAULT_PAID_BY = ['UPI','GPay','PhonePe','PPay','Bank Transfer','Cash','Cheque'];
let _paidByOptions = null;
let _managingFor = null;

function getPaidByOptions() {
    if (_paidByOptions) return _paidByOptions;
    try {
        const stored = localStorage.getItem('ak_paidby_options');
        _paidByOptions = stored ? JSON.parse(stored) : [...DEFAULT_PAID_BY];
    } catch(e) { _paidByOptions = [...DEFAULT_PAID_BY]; }
    return _paidByOptions;
}

async function loadPaidByOptions() {
    try {
        const doc = await db.collection('settings').doc(orgKey('paidByOptions')).get();
        if (doc.exists && Array.isArray(doc.data().options)) {
            _paidByOptions = doc.data().options;
        } else {
            _paidByOptions = [...DEFAULT_PAID_BY];
        }
        localStorage.setItem('ak_paidby_options', JSON.stringify(_paidByOptions));
    } catch(e) {
        try {
            const stored = localStorage.getItem('ak_paidby_options');
            _paidByOptions = stored ? JSON.parse(stored) : [...DEFAULT_PAID_BY];
        } catch(e2) { _paidByOptions = [...DEFAULT_PAID_BY]; }
    }
    return _paidByOptions;
}

async function savePaidByToStorage() {
    try {
        await db.collection('settings').doc(orgKey('paidByOptions')).set({ options: _paidByOptions, orgId: CURRENT_USER.orgId });
        localStorage.setItem('ak_paidby_options', JSON.stringify(_paidByOptions));
    } catch(e) {
        try { localStorage.setItem('ak_paidby_options', JSON.stringify(_paidByOptions)); } catch(e2){}
        showToast('⚠️ Saved locally only — check connection', false);
    }
}

function populatePaidBySelect(selectId){
    const sel = document.getElementById(selectId);
    if(!sel || sel.tagName !== 'SELECT') return;
    const opts = getPaidByOptions();
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Mode --</option>' + opts.map(o=>`<option value="${o}"${o===cur?' selected':''}>${o}</option>`).join('');
}

function showPaidByDropdown(inputId, dropId) {
    const input = document.getElementById(inputId);
    const drop  = document.getElementById(dropId);
    if (!input || !drop) return;

    const q = input.value.toLowerCase().trim();
    const opts = getPaidByOptions().filter(o => !q || o.toLowerCase().includes(q));

    if (!opts.length) { drop.style.display = 'none'; return; }

    drop.innerHTML = opts.map(o =>
        `<div onclick="selectPaidBy('${inputId}','${dropId}','${o.replace(/'/g,"\\'")}');event.stopPropagation();"
              style="padding:10px 14px;font-size:0.85rem;font-weight:600;color:var(--text-primary);cursor:pointer;border-bottom:1px solid var(--border);"
              onmouseenter="this.style.background='rgba(99,102,241,0.15)'"
              onmouseleave="this.style.background=''">${o}</div>`
    ).join('');
    drop.style.display = 'block';

    // Close on outside click
    const close = (e) => {
        if (!input.contains(e.target) && !drop.contains(e.target)) {
            drop.style.display = 'none';
            document.removeEventListener('click', close);
        }
    };
    setTimeout(() => document.addEventListener('click', close), 50);
}

function selectPaidBy(inputId, dropId, value) {
    document.getElementById(inputId).value = value;
    document.getElementById(dropId).style.display = 'none';
}

function openManagePaidBy(inputId) {
    _managingFor = inputId;
    renderPaidByOptionsList();
    openModal('managePaidByModal');
}

function renderPaidByOptionsList() {
    const opts = getPaidByOptions();
    const el = document.getElementById('paidByOptionsList');
    if (!el) return;
    el.innerHTML = opts.map((o, i) =>
        `<div style="display:flex;align-items:center;gap:8px;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:8px 12px;">
            <span style="flex:1;font-size:0.85rem;font-weight:600;color:var(--text-primary);">${o}</span>
            <button onclick="movePaidByOption(${i},-1)" title="Move up" style="background:none;border:none;color:var(--text-dim);font-size:0.85rem;cursor:pointer;padding:2px 5px;" ${i===0?'disabled style="opacity:.3;"':''}>▲</button>
            <button onclick="movePaidByOption(${i},1)" title="Move down" style="background:none;border:none;color:var(--text-dim);font-size:0.85rem;cursor:pointer;padding:2px 5px;" ${i===opts.length-1?'disabled style="opacity:.3;"':''}>▼</button>
            <button onclick="deletePaidByOption(${i})" title="Delete" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#ef4444;border-radius:7px;padding:4px 9px;font-size:0.78rem;cursor:pointer;">✕</button>
        </div>`
    ).join('') || '<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;">No options yet</div>';
}

function addPaidByOption() {
    const input = document.getElementById('newPaidByInput');
    const val = (input.value || '').trim();
    if (!val) return;
    const opts = getPaidByOptions();
    if (opts.some(o => o.toLowerCase() === val.toLowerCase())) {
        showToast('⚠️ Option already exists', false); return;
    }
    opts.push(val);
    _paidByOptions = opts;
    input.value = '';
    renderPaidByOptionsList();
}

function deletePaidByOption(i) {
    const opts = getPaidByOptions();
    opts.splice(i, 1);
    _paidByOptions = opts;
    renderPaidByOptionsList();
}

function movePaidByOption(i, dir) {
    const opts = getPaidByOptions();
    const j = i + dir;
    if (j < 0 || j >= opts.length) return;
    [opts[i], opts[j]] = [opts[j], opts[i]];
    _paidByOptions = opts;
    renderPaidByOptionsList();
}

async function savePaidByOptions() {
    await savePaidByToStorage();
    populatePaidBySelect('pPaidBy');
    closeModal('managePaidByModal');
    showToast('✅ Payment modes saved!');
}


// ── Payment Notes Handling ──────────────────────────────────
function onPaymentNoteChange() {
    const sel = document.getElementById('pPaymentNote');
    const wrap = document.getElementById('pCustomNoteWrap');
    if (!sel) return;
    if(wrap) wrap.style.display = sel.value === 'Custom' ? '' : 'none';
}

function onEditNoteChange() {
    const sel = document.getElementById('epPaymentNote');
    const custom = document.getElementById('epCustomNote');
    if (!sel || !custom) return;
    custom.style.display = sel.value === 'Custom' ? '' : 'none';
}

// Get note text to store
function getPaymentNoteText() {
    const sel = document.getElementById('pPaymentNote');
    const custom = document.getElementById('pCustomNote');
    if (!sel) return '';
    if (sel.value === 'Custom') {
        return custom?.value || 'Custom Note';
    }
    return sel.value || '';
}

function getEditPaymentNoteText() {
    const sel = document.getElementById('epPaymentNote');
    const custom = document.getElementById('epCustomNote');
    if (!sel) return '';
    if (sel.value === 'Custom') {
        return custom?.value || 'Custom Note';
    }
    return sel.value || '';
}

// ── Update Chit Picked option based on selected months ──
// ── Update Chit Picked option based on selected months ──
async function onNumMonthsChange(){
    const isSingle = document.getElementById('pNumMonths').value === '1';
    document.getElementById('singleMonthDropdownWrap').style.display = isSingle ? '' : 'none';
    document.getElementById('multiMonthPreview').style.display = isSingle ? 'none' : '';
    
    if(isSingle) {
        await populateSingleMonthDropdown();
    } else {
        await buildMonthSelectorGrid();
    }
}

async function populateSingleMonthDropdown() {
    const mid = document.getElementById('pMember').value;
    const gid = document.getElementById('pGroup').value;
    const sel = document.getElementById('pSingleMonthSlot');
    
    if (!mid || !gid) {
        sel.innerHTML = '<option value="">-- Select member & group first --</option>';
        return;
    }
    
    const gs = await getCollection('groups');
    const grp = gs.find(g => g.id === gid);
    if (!grp) return;
    
    const eid=document.getElementById('pEnrollmentId').value||'';
    const sn=parseInt(document.getElementById('pSlotNum').value||'1');
    const {paidSlots, allDueDates} = await getPaidSlots(mid, gid, grp, eid, sn);
    
    sel.innerHTML = allDueDates.map((dd, i) => {
        const paid = paidSlots.has(i);
        const label = fmtDate(dd) + (paid ? ' ✅ Paid' : '');
        return `<option value="${i}" ${paid ? 'disabled' : ''}>${label}</option>`;
    }).join('');
    
    sel.value = '';
    onSingleMonthSlotChange();
}

function onSingleMonthSlotChange() {
    const slotVal = document.getElementById('pSingleMonthSlot').value;
    const badge = document.getElementById('singleMonthBadge');
    
    if (slotVal === '') {
        badge.style.display = 'none';
    } else {
        badge.style.display = 'block';
        badge.textContent = '📅 Month ' + (parseInt(slotVal) + 1);
        badge.style.background = 'rgba(34,197,94,0.1)';
        badge.style.borderColor = 'rgba(34,197,94,0.4)';
        badge.style.color = '#34d399';
    }
    
    updateChitPickedOptionForMode();
}

async function updateChitPickedOptionForMode() {
    const mode = document.getElementById('pNumMonths').value;
    
    if (mode === '1') {
        // Single month mode
        const slotVal = document.getElementById('pSingleMonthSlot').value;
        if (slotVal === '') return;
        
        const mid = document.getElementById('pMember').value;
        const gid = document.getElementById('pGroup').value;
        const eid2 = document.getElementById('pEnrollmentId').value||'';
        const slotNum = parseInt(document.getElementById('pSlotNum').value||'1');
        const chitSelect = document.getElementById('pChitPicked');
        const yesOption = chitSelect.querySelector('option[value="Yes"]');
        
        const ps = await getCollection('payments');
        const alreadyPicked = await isChitAlreadyPicked(ps, mid, gid, eid2, slotNum);
        yesOption.disabled = alreadyPicked;
        if (alreadyPicked) chitSelect.value = 'No';
    } else {
        // Multiple month mode
        await updateChitPickedOption();
    }
}
async function updateChitPickedOption() {
    try {
        const monthSlots = getSelectedMonthSlots();
        const mid = document.getElementById('pMember').value;
        const gid = document.getElementById('pGroup').value;
        const chitSelect = document.getElementById('pChitPicked');
        const yesOption = chitSelect ? chitSelect.querySelector('option[value="Yes"]') : null;
        
        if (!yesOption || !mid || !gid || monthSlots.length === 0) {
            if (yesOption) yesOption.disabled = false;
            return;
        }
        
        const eid3 = document.getElementById('pEnrollmentId').value||'';
        const slotNum = parseInt(document.getElementById('pSlotNum').value||'1');
        // Only block if THIS enrollment slot already picked — other slots are independent
        const ps = await getCollection('payments');
        const alreadyPicked = await isChitAlreadyPicked(ps, mid, gid, eid3, slotNum);
        yesOption.disabled = alreadyPicked;
        if (alreadyPicked) chitSelect.value = 'No';
    } catch(error) {
        console.error('Error in updateChitPickedOption:', error);
    }
}
