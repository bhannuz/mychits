// ═══════════════════════════════════════════════════════════
// AK Chit Funds — PRINT & PDF
// Edit only this file when changing member statement print, group PDF generation
// ═══════════════════════════════════════════════════════════

// PRINT MEMBER STATEMENT
// ══════════════════════════════════════════
async function printMemberStatement(mid){
    showToast('⏳ Preparing statement…', true);
    const ms=await getCollection('members');
    const gs=await getCollection('groups');
    const ps=await getCollection('payments');
    const m=ms.find(x=>x.id===mid); if(!m){showToast('❌ Member not found',false);return;}
    const mPays=ps.filter(p=>p.memberId===mid);
    const totalPaid=mPays.reduce((s,p)=>s+(parseFloat(p.paid)||0),0);
    const totalBal=mPays.reduce((s,p)=>s+(parseFloat(p.balance)||0),0);
    const chitsPicked=mPays.filter(p=>p.chitPicked==='Yes').length;
    let enrollments=m.enrollments;
    if(!enrollments||!enrollments.length) enrollments=(m.groupIds||[]).map(gid=>({enrollmentId:'',groupId:gid,label:''}));
    const memberGroups=gs.filter(g=>m.groupIds&&m.groupIds.includes(g.id));
    const today=new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});

    // Build merged schedule+history rows with rowspan for multi-month payments
    function buildPrintSlot(g, enr, slotPays, allDueDates, elapsed, totalMonths, left, pct, gStartDisp, gDueDayDisp, slotNum, totalSlots){
        const gPaid   = slotPays.reduce((s,p)=>s+(parseFloat(p.paid)||0),0);
        const gBal    = slotPays.reduce((s,p)=>s+(parseFloat(p.balance)||0),0);
        const monthsCovered = slotPays.reduce((s,p)=>s+(p.numMonths||1),0);
        const slotBadge  = totalSlots>1 ? `<span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 6px;font-size:9px;font-weight:800;margin-left:4px;">Chit ${slotNum} of ${totalSlots}</span>` : '';
        const labelBadge = enr.label ? `<span style="background:#fff3cd;color:#92400e;border-radius:3px;padding:1px 5px;font-size:9px;margin-left:4px;">${enr.label}</span>` : '';
        const indentStyle = totalSlots>1 ? 'margin-left:12px;border-left:3px solid #f5c842;padding-left:8px;' : '';
        const todayStr = new Date().toISOString().split('T')[0];

        // Get fixed chit amount — from payments first, fallback to group amount/members
        const lastPay    = slotPays.length ? slotPays[slotPays.length-1] : null;
        const membersCount = parseInt(g.members||g.gMembers||0);
        const groupAmount  = parseFloat(g.amount||g.gAmount||0);
        const chitAmount   = lastPay && parseFloat(lastPay.chit)>0
            ? parseFloat(lastPay.chit)
            : (membersCount>0 && groupAmount>0 ? Math.round(groupAmount/membersCount) : 0);

        // Build paidSlotSet
        const paidSlotSet = new Set();
        slotPays.forEach(p=>{
            if(Array.isArray(p.monthSlots)) p.monthSlots.forEach(s=>paidSlotSet.add(s));
            else if(p.monthSlot!=null) paidSlotSet.add(p.monthSlot);
            else { const si=getMonthSlot(allDueDates,p.date); if(si>=0) paidSlotSet.add(si); }
        });

        // Build rowspan map for multi-month payments
        const payFirstSlot = {};
        const payRowSpan   = {};
        allDueDates.forEach((d,i)=>{
            const p = slotPays.find(pay=>{
                if(Array.isArray(pay.monthSlots)) return pay.monthSlots.includes(i);
                if(pay.monthSlot!=null) return pay.monthSlot===i;
                return getMonthSlot(allDueDates,pay.date)===i;
            });
            if(!p || !(p.numMonths>1)) return;
            if(payFirstSlot[p.id]===undefined) payFirstSlot[p.id]=i;
            payRowSpan[p.id]=(payRowSpan[p.id]||0)+1;
        });

        // Build merged rows
        const rows = allDueDates.map((dueDate,i)=>{
            const matchPay = slotPays.find(p=>{
                if(Array.isArray(p.monthSlots)) return p.monthSlots.includes(i);
                if(p.monthSlot!=null) return p.monthSlot===i;
                return getMonthSlot(allDueDates,p.date)===i;
            });
            const paidAmt       = matchPay ? (parseFloat(matchPay.paid)||0)    : 0;
            const chitAmt       = matchPay ? (parseFloat(matchPay.chit)||chitAmount||0) : (chitAmount||0);
            const balAmt        = matchPay ? (parseFloat(matchPay.balance)||0)  : 0;
            const isFullPaid    = paidSlotSet.has(i) && chitAmt>0 && paidAmt>=chitAmt;
            const isPartialPaid = paidSlotSet.has(i) && chitAmt>0 && paidAmt>0 && paidAmt<chitAmt;
            const isAnyPaid     = paidSlotSet.has(i);
            const isOverdue     = !isAnyPaid && dueDate<todayStr;
            const cp            = matchPay && matchPay.chitPicked==='Yes';
            const isMulti       = matchPay && matchPay.numMonths>1;
            const isFirstOfMulti= isMulti && matchPay && payFirstSlot[matchPay.id]===i;
            const isSubOfMulti  = isMulti && matchPay && payFirstSlot[matchPay.id]!==i;
            const span          = isFirstOfMulti ? payRowSpan[matchPay.id] : 1;
            const rs            = span>1 ? ` rowspan="${span}"` : '';

            // Status
            let status;
            if(isFullPaid||(isAnyPaid&&chitAmt===0)) status='✅ Paid';
            else if(isPartialPaid) status='⚡ Partial';
            else if(isOverdue)     status='🔴 Overdue';
            else                   status='⏳ Pending';

            // Row styling
            const bg = isFullPaid    ? '#f0fff8'
                     : isPartialPaid ? '#fffbeb'
                     : cp            ? '#f0fff8'
                     : isMulti       ? '#eef2ff'
                     : isOverdue     ? '#fff5f5'
                     : (i%2===0?'#fff':'#fafafa');
            const bl = cp            ? 'border-left:3px solid #10b981;'
                     : isMulti       ? 'border-left:3px solid #818cf8;'
                     : isPartialPaid ? 'border-left:3px solid #f59e0b;'
                     : '';

            // Sub-rows of multi: only show # and due date
            if(isSubOfMulti){
                return `<tr style="background:${bg};${bl}">
                    <td style="text-align:center;color:#888;">${i+1}</td>
                    <td style="color:#3730a3;">${fmtDate(dueDate)}</td>
                    <td style="color:#555;">Rs.${chitAmt>0?chitAmt.toLocaleString('en-IN'):'—'}</td>
                </tr>`;
            }

            // Multi tag
            const multiTag = isFirstOfMulti
                ? ` <small style="background:#e0e7ff;color:#3730a3;border-radius:3px;padding:1px 4px;font-size:8px;font-weight:800;">×${matchPay.numMonths} months bulk</small>`
                : '';

            const statusColor = isFullPaid?'#065f46':isPartialPaid?'#92400e':isOverdue?'#b91c1c':'#888';

            return `<tr style="background:${bg};${bl}">
                <td style="text-align:center;color:#888;">${i+1}</td>
                <td>${fmtDate(dueDate)}${multiTag}</td>
                <td style="color:#555;">Rs.${chitAmt>0?chitAmt.toLocaleString('en-IN'):'—'}</td>
                <td${rs} style="vertical-align:middle;">${matchPay?fmtDate(matchPay.date):'—'}</td>
                <td${rs} style="vertical-align:middle;color:#065f46;font-weight:700;">${isAnyPaid&&matchPay?'Rs.'+paidAmt.toLocaleString('en-IN'):'—'}</td>
                <td${rs} style="vertical-align:middle;color:${balAmt>0?'#92400e':'#065f46'};font-weight:700;">${matchPay?'Rs.'+balAmt.toLocaleString('en-IN'):'—'}</td>
                <td${rs} style="vertical-align:middle;font-weight:700;color:${statusColor};">${status}</td>
                <td${rs} style="vertical-align:middle;color:#555;">${matchPay&&matchPay.paidBy?matchPay.paidBy:'—'}</td>
                <td${rs} style="vertical-align:middle;text-align:center;">${cp?'<span style="color:#065f46;font-weight:800;">YES</span>':'—'}</td>
            </tr>`;
        }).join('');

        return `<div class="grp-block" style="${indentStyle}">
            <div class="grp-title">&#128194; ${g.name}${labelBadge}${slotBadge}</div>
            <div class="grp-meta">Start: <b>${gStartDisp}</b> &nbsp;|&nbsp; Due: <b>${gDueDayDisp}</b> &nbsp;|&nbsp; Month <b>${elapsed}/${totalMonths}</b> &nbsp;|&nbsp; Covered: <b>${monthsCovered}/${totalMonths}</b> &nbsp;|&nbsp; <b>${left} pending</b></div>
            <div class="prog-outer"><div class="prog-inner" style="width:${pct}%"></div></div>
            <div class="grp-totals">Paid: <b style="color:#065f46;">Rs.${gPaid.toLocaleString('en-IN')}</b> &nbsp;&nbsp; Balance: <b style="color:#92400e;">Rs.${gBal.toLocaleString('en-IN')}</b></div>
            <table>
                <colgroup><col style="width:4%"><col style="width:16%"><col style="width:12%"><col style="width:11%"><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:11%"><col style="width:10%"></colgroup>
                <thead><tr><th>#</th><th>Due Date</th><th>Chit/Mo</th><th>Pay Date</th><th>Paid</th><th>Balance</th><th>Status</th><th>Mode</th><th>Chit?</th></tr></thead>
                <tbody>${rows}
                <tr style="background:#fff8e1;font-weight:800;border-top:2px solid #f39c12;">
                    <td colspan="4" style="text-align:right;padding-right:8px;">Total</td>
                    <td style="color:#065f46;">Rs.${gPaid.toLocaleString('en-IN')}</td>
                    <td style="color:#92400e;">Rs.${gBal.toLocaleString('en-IN')}</td>
                    <td colspan="3"></td>
                </tr></tbody>
            </table>
        </div>`;
    }

    const groupSections = enrollments.map(enr=>{
        const g=gs.find(x=>x.id===enr.groupId); if(!g) return '';
        const qty=parseInt(enr.qty||1);
        const allPays=mPays.filter(p=>{
            if(enr.enrollmentId&&p.enrollmentId) return p.enrollmentId===enr.enrollmentId;
            return p.groupId===enr.groupId;
        }).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
        const totalMonths=parseInt(g.duration||g.gDuration)||21;
        let elapsed=0;
        if(g.startDate||g.gStart){const _s=new Date(g.startDate||g.gStart),_n=new Date();elapsed=Math.max(0,Math.min(totalMonths,(_n.getFullYear()-_s.getFullYear())*12+(_n.getMonth()-_s.getMonth())+1));}
        const left=Math.max(0,totalMonths-elapsed);
        const pct=Math.min(100,Math.round(elapsed/totalMonths*100));
        const allDueDates=getGroupDueDates(g);
        const gStartDisp=fmtDate(g.startDate||g.gStart||'');
        const gDueDayDisp=g.dueDay?`${g.dueDay}${['st','nd','rd'][((g.dueDay%100-11)%10)-1]||'th'} of month`:'—';

        if(qty<=1){
            return buildPrintSlot(g, enr, allPays, allDueDates, elapsed, totalMonths, left, pct, gStartDisp, gDueDayDisp, 1, 1);
        } else {
            const slotBlocks = Array.from({length:qty},(_,i)=>{
                const sn=i+1;
                const slotPays=allPays.filter(p=> p.slotNum ? p.slotNum===sn : true);
                return buildPrintSlot(g, enr, slotPays, allDueDates, elapsed, totalMonths, left, pct, gStartDisp, gDueDayDisp, sn, qty);
            }).join('');
            return `<div style="margin-bottom:14px;">
                <div style="font-size:11px;font-weight:900;color:#92400e;padding:5px 0 6px;border-bottom:2px solid #f5c842;margin-bottom:8px;">
                    &#128194; ${g.name}${enr.label?' — '+enr.label:''} &nbsp;<span style="background:#fef3c7;border-radius:3px;padding:2px 6px;font-size:9px;">×${qty} chits</span>
                </div>
                ${slotBlocks}
            </div>`;
        }
    }).join('');

    const printHTML = `
    <div id="printStatement">
        <style>
            #printStatement { font-family: Arial, sans-serif; color: #111; max-width: 800px; margin: 0 auto; padding: 16px; font-size: 13px; }
            #printStatement .hdr { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #f39c12; padding-bottom:12px; margin-bottom:16px; }
            #printStatement .brand { font-size:20px; font-weight:900; color:#f39c12; }
            #printStatement .brand-sub { font-size:11px; color:#888; margin-top:2px; }
            #printStatement .doc-title { font-size:16px; font-weight:800; text-align:right; }
            #printStatement .doc-sub { font-size:11px; color:#888; text-align:right; margin-top:3px; }
            #printStatement .mbox { background:#fffbf0; border:2px solid #f39c12; border-radius:10px; padding:14px 18px; margin-bottom:16px; }
            #printStatement .mname { font-size:18px; font-weight:800; margin-bottom:5px; }
            #printStatement .msub { font-size:12px; color:#555; margin-top:4px; }
            #printStatement .stats { display:flex; gap:0; margin-top:14px; border:1px solid #e5c76b; border-radius:8px; overflow:hidden; width:100%; }
            #printStatement .stat { flex:1; border-right:1px solid #e5c76b; padding:10px 8px; text-align:center; background:#fffdf0; }
            #printStatement .stat:last-child { border-right:none; }
            #printStatement .stat-v { font-size:15px; font-weight:800; }
            #printStatement .stat-l { font-size:10px; color:#888; text-transform:uppercase; margin-top:3px; }
            #printStatement .sec-title { font-size:11px; font-weight:800; color:#888; text-transform:uppercase; letter-spacing:1px; margin:16px 0 8px; border-bottom:2px solid #eee; padding-bottom:4px; }
            #printStatement .grp-block { margin-bottom:18px; page-break-inside:avoid; }
            #printStatement .grp-title { font-size:14px; font-weight:800; margin-bottom:4px; }
            #printStatement .grp-meta { font-size:11px; color:#666; margin-bottom:5px; line-height:1.6; }
            #printStatement .grp-totals { font-size:11px; text-align:right; margin-bottom:6px; }
            #printStatement .prog-outer { background:#eee; height:6px; border-radius:3px; margin-bottom:5px; overflow:hidden; }
            #printStatement .prog-inner { height:100%; background:linear-gradient(90deg,#f39c12,#f57c00); border-radius:3px; }
            #printStatement table { width:100%; border-collapse:collapse; font-size:11px; table-layout:fixed; margin-bottom:6px; }
            #printStatement thead { display:table-header-group; }
            #printStatement th { background:#f5f5f5; border:1px solid #ccc; padding:7px 6px; font-size:10px; text-transform:uppercase; color:#555; font-weight:700; }
            #printStatement td { border:1px solid #e0e0e0; padding:7px 6px; vertical-align:middle; word-break:break-word; font-size:11px; }
            #printStatement tr { page-break-inside:avoid; }
            #printStatement .ftr { margin-top:16px; border-top:1px solid #ddd; padding-top:8px; display:flex; justify-content:space-between; font-size:10px; color:#aaa; }
            #printStatement .print-btn-bar { display:flex; gap:10px; margin-bottom:16px; }
            #printStatement .print-btn { background:linear-gradient(90deg,#f39c12,#f57c00); color:#000; border:none; padding:10px 24px; border-radius:10px; font-weight:800; font-size:14px; cursor:pointer; }
            #printStatement .close-btn { background:#eee; color:#333; border:none; padding:10px 18px; border-radius:10px; font-weight:700; font-size:14px; cursor:pointer; }
            @media print {
                body > *:not(#printOverlay) { display:none !important; }
                #printOverlay { position:fixed !important; top:0 !important; left:0 !important; width:100% !important; background:white !important; z-index:99999 !important; }
                #printStatement .print-btn-bar { display:none !important; }
                @page { size:A4; margin:10mm; }
            }
        </style>
        <div class="print-btn-bar">
            <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
            <button class="close-btn" onclick="closePrintStatement()">✕ Close</button>
        </div>
        <div class="hdr">
            <div style="display:flex;align-items:center;gap:10px;"><img src="logo.png" style="width:48px;height:48px;border-radius:10px;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><span style="display:none;font-size:22px;">🏆</span><div><div class="brand">AK CHIT FUNDS</div><div class="brand-sub">Chit Fund Management &bull; Member Statement</div></div></div>
            <div><div class="doc-title">MEMBER STATEMENT</div><div class="doc-sub">Generated: ${today}</div></div>
        </div>
        <div class="mbox">
            <div class="mname">${m.name}</div>
            <div class="msub">&#128222; ${m.phone||'—'}</div>
            <div class="msub">Groups: ${enrollments.map(e=>{const g=gs.find(x=>x.id===e.groupId);const q=parseInt(e.qty||1);return g?(g.name+(e.label?' ('+e.label+')':'')+(q>1?' ×'+q+' chits':'')):'?';}).join(', ')||'—'}</div>
            <div class="stats">
                <div class="stat"><div class="stat-v" style="color:#065f46;">Rs.${totalPaid.toLocaleString('en-IN')}</div><div class="stat-l">Total Paid</div></div>
                <div class="stat"><div class="stat-v" style="color:#92400e;">Rs.${totalBal.toLocaleString('en-IN')}</div><div class="stat-l">Balance</div></div>
                <div class="stat"><div class="stat-v">${mPays.length}</div><div class="stat-l">Payments</div></div>
                <div class="stat"><div class="stat-v" style="color:#065f46;">${chitsPicked}</div><div class="stat-l">Chits Picked</div></div>
            </div>
        </div>
        <div class="sec-title">Payment History &mdash; Group Wise</div>
        ${groupSections||'<p style="color:#888;font-size:10px;">No payments recorded.</p>'}
        <div class="ftr">
            <span>AK Chit Funds &bull; Admin Portal</span>
            <span>Member: ${m.name} &bull; ${today}</span>
            <span>CONFIDENTIAL</span>
        </div>
    </div>`;

    let overlay = document.getElementById('printOverlay');
    if(!overlay){
        overlay = document.createElement('div');
        overlay.id = 'printOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:white;z-index:99999;overflow-y:auto;padding:16px;';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = printHTML;
    overlay.style.display = 'block';
    showToast('✅ Statement ready — tap Print', true);
}

function closePrintStatement(){
    const el = document.getElementById('printOverlay');
    if(el) el.style.display = 'none';
}

async function generateMemberPDF(mid){ return printMemberStatement(mid); }

async function generateGroupPDF(gid){
    showToast('⏳ Preparing group report…', true);
    const gs = await getCollection('groups');
    const ms = await getCollection('members');
    const ps = await getCollection('payments');
    const g  = gs.find(x => x.id === gid);
    if(!g){ showToast('❌ Group not found', false); return; }

    const gPays = ps.filter(p => p.groupId === gid);
    const tPaid = gPays.reduce((s,p) => s + (parseFloat(p.paid)||0), 0);
    const tBal  = gPays.reduce((s,p) => s + (parseFloat(p.balance)||0), 0);
    const picked = gPays.filter(p => p.chitPicked === 'Yes').length;
    const totalMonths = parseInt(g.duration || g.gDuration) || 21;
    let elapsed = 0;
    if(g.startDate || g.gStart){
        const _s = new Date(g.startDate || g.gStart), _n = new Date();
        elapsed = Math.max(0, Math.min(totalMonths, (_n.getFullYear()-_s.getFullYear())*12 + (_n.getMonth()-_s.getMonth()) + 1));
    }
    const left = Math.max(0, totalMonths - elapsed);
    const pct  = Math.min(100, Math.round(elapsed / totalMonths * 100));
    const allDueDates = getGroupDueDates(g);
    const gStartDisp  = fmtDate(g.startDate || g.gStart || '');
    const gDueDayDisp = g.dueDay ? `${g.dueDay}${['st','nd','rd'][((g.dueDay%100-11)%10)-1]||'th'} of every month` : '—';
    const today = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});

    const gMs = ms.filter(m => (m.enrollments||[]).some(e=>e.groupId===g.id) || (m.groupIds||[]).includes(g.id));
    const expandedSlots = [];
    gMs.forEach(m => {
        const enr = (m.enrollments||[]).find(e=>e.groupId===g.id);
        const qty = enr ? parseInt(enr.qty||1) : 1;
        for(let q=0; q<qty; q++) expandedSlots.push({m, slotNum:q+1, totalSlots:qty});
    });

    const summaryRows = expandedSlots.map(({m, slotNum, totalSlots}, i) => {
        const mp = ps.filter(p => p.memberId===m.id && p.groupId===g.id);
        const paid = mp.reduce((s,p)=>s+(parseFloat(p.paid)||0),0);
        const bal  = mp.reduce((s,p)=>s+(parseFloat(p.balance)||0),0);
        const monthsCovered = mp.reduce((s,p)=>s+(p.numMonths||1),0);
        const pickedPay = mp.find(p=>p.chitPicked==='Yes');
        const lastPay = mp.length ? mp.sort((a,b)=>b.date.localeCompare(a.date))[0].date : '';
        const slotLabel = totalSlots>1 ? ` <span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 4px;font-size:9px;font-weight:800;">Chit ${slotNum}/${totalSlots}</span>` : '';
        const bg = pickedPay ? '#f0fff8' : (i%2===0?'#f9fafb':'#fff');
        const bl = pickedPay ? 'border-left:3px solid #10b981;' : '';
        return `<tr style="background:${bg};${bl}">
            <td style="text-align:center;color:#888;font-weight:800;">${i+1}</td>
            <td><strong>${m.name}</strong>${slotLabel}<br><span style="font-size:9px;color:#888;">${m.phone||''}</span></td>
            <td style="color:#065f46;font-weight:700;">₹${paid.toLocaleString('en-IN')}</td>
            <td style="color:${bal>0?'#92400e':'#065f46'};font-weight:700;">₹${bal.toLocaleString('en-IN')}</td>
            <td style="text-align:center;">${monthsCovered}/${totalMonths}</td>
            <td style="color:#888;">${lastPay?fmtDate(lastPay):'—'}</td>
            <td style="text-align:center;">${pickedPay?'<span style="color:#065f46;font-weight:800;">✅ YES</span>':'—'}</td>
        </tr>`;
    }).join('');

    const detailSections = expandedSlots.map(({m, slotNum, totalSlots}) => {
        const mp = ps.filter(p => p.memberId===m.id && p.groupId===g.id)
                     .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
        if(!mp.length) return '';
        const mPaid = mp.reduce((s,p)=>s+(parseFloat(p.paid)||0),0);
        const mBal  = mp.reduce((s,p)=>s+(parseFloat(p.balance)||0),0);
        const slotBadge = totalSlots>1 ? ` <span style="background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:9px;font-weight:800;">Chit ${slotNum}/${totalSlots}</span>` : '';
        const rows = mp.map((p,idx) => {
            const isMulti = p.numMonths && p.numMonths > 1;
            let monthLabel = '—';
            if(isMulti && p.monthSlots && p.monthSlots.length>0){
                const f = allDueDates[p.monthSlots[0]] ? fmtDate(allDueDates[p.monthSlots[0]]) : '—';
                const l = allDueDates[p.monthSlots[p.monthSlots.length-1]] ? fmtDate(allDueDates[p.monthSlots[p.monthSlots.length-1]]) : '—';
                monthLabel = `${f} → ${l}`;
            } else {
                const si = p.monthSlot !== undefined ? p.monthSlot : getMonthSlot(allDueDates, p.date);
                monthLabel = si>=0 && allDueDates[si] ? fmtDate(allDueDates[si]) : '—';
            }
            const cp = p.chitPicked === 'Yes';
            const bg = cp ? '#f0fff8' : (isMulti ? '#eef2ff' : (idx%2===0?'#f9fafb':'#fff'));
            return `<tr style="background:${bg};">
                <td style="text-align:center;color:#888;">${idx+1}</td>
                <td>${monthLabel}${isMulti?` <span style="background:#e0e7ff;color:#3730a3;border-radius:3px;padding:1px 4px;font-size:9px;">${p.numMonths}mo</span>`:''}</td>
                <td>${fmtDate(p.date)}</td>
                <td>₹${(parseFloat(p.chit)||0).toLocaleString('en-IN')}${isMulti?`/mo×${p.numMonths}`:''}</td>
                <td style="color:#065f46;font-weight:700;">₹${(parseFloat(p.paid)||0).toLocaleString('en-IN')}</td>
                <td style="color:${(parseFloat(p.balance)||0)>0?'#92400e':'#065f46'};font-weight:700;">₹${(parseFloat(p.balance)||0).toLocaleString('en-IN')}</td>
                <td style="color:#888;">${p.paidBy||'—'}</td>
                <td style="text-align:center;">${cp?'<span style="color:#065f46;font-weight:800;">✅</span>':'—'}</td>
            </tr>`;
        }).join('');
        return `<div style="margin-bottom:16px;page-break-inside:avoid;">
            <div style="background:#f5f5f5;border-left:4px solid #f39c12;padding:7px 12px;font-size:12px;font-weight:800;margin-bottom:4px;">
                👤 ${m.name}${slotBadge} &nbsp;<span style="font-size:10px;color:#888;font-weight:400;">${m.phone||''}</span>
                <span style="float:right;font-size:11px;">Paid: <b style="color:#065f46;">₹${mPaid.toLocaleString('en-IN')}</b> &nbsp; Bal: <b style="color:#92400e;">₹${mBal.toLocaleString('en-IN')}</b></span>
            </div>
            <table>
                <colgroup><col style="width:4%"><col style="width:22%"><col style="width:12%"><col style="width:15%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:8%"></colgroup>
                <thead><tr><th>#</th><th>Month Covered</th><th>Pay Date</th><th>Chit Amt</th><th>Paid</th><th>Balance</th><th>Mode</th><th>Chit?</th></tr></thead>
                <tbody>${rows}
                <tr style="background:#fff8e1;font-weight:800;border-top:2px solid #f39c12;">
                    <td colspan="4">Total</td>
                    <td style="color:#065f46;">₹${mPaid.toLocaleString('en-IN')}</td>
                    <td style="color:#92400e;">₹${mBal.toLocaleString('en-IN')}</td>
                    <td colspan="2"></td>
                </tr></tbody>
            </table>
        </div>`;
    }).join('');

    const printHTML = `<div id="groupPrintDoc">
    <style>
        #groupPrintDoc { font-family:Arial,sans-serif; color:#111; max-width:860px; margin:0 auto; padding:16px; }
        #groupPrintDoc .hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #f39c12; padding-bottom:10px; margin-bottom:14px; page-break-inside:avoid; }
        #groupPrintDoc .brand { font-size:16px; font-weight:900; color:#f39c12; }
        #groupPrintDoc .info-box { background:#fffbf0; border:2px solid #f39c12; border-radius:8px; padding:12px 16px; margin-bottom:14px; page-break-inside:avoid; }
        #groupPrintDoc .chips { display:flex; gap:0; border:1px solid #e5c76b; border-radius:8px; overflow:hidden; margin-top:10px; }
        #groupPrintDoc .chip { flex:1; padding:8px; text-align:center; border-right:1px solid #e5c76b; }
        #groupPrintDoc .chip:last-child { border-right:none; }
        #groupPrintDoc .chip-v { font-size:14px; font-weight:800; }
        #groupPrintDoc .chip-l { font-size:9px; color:#888; text-transform:uppercase; margin-top:2px; }
        #groupPrintDoc .prog-outer { background:#eee; height:6px; border-radius:3px; margin:8px 0 4px; overflow:hidden; }
        #groupPrintDoc .prog-inner { height:100%; background:linear-gradient(90deg,#f39c12,#f57c00); border-radius:3px; }
        #groupPrintDoc .sec-title { font-size:8px; font-weight:800; color:#888; text-transform:uppercase; letter-spacing:1px; margin:16px 0 6px; border-bottom:1px solid #eee; padding-bottom:3px; page-break-after:avoid; }
        #groupPrintDoc table { width:100%; border-collapse:collapse; font-size:11px; table-layout:auto !important; margin-bottom:4px; page-break-inside:avoid; }
        #groupPrintDoc thead { display:table-header-group; background:#f5f5f5; }
        #groupPrintDoc th { background:#f5f5f5; border:1px solid #ccc; padding:6px 7px; font-size:9px; text-transform:uppercase; color:#555; font-weight:700; }
        #groupPrintDoc td { border:1px solid #e0e0e0; padding:6px 7px; vertical-align:middle; word-break:break-word; overflow-wrap:break-word; }
        #groupPrintDoc tr { page-break-inside:avoid; page-break-after:auto; }
        #groupPrintDoc .stats { display:flex; gap:8px; margin-top:10px; page-break-inside:avoid; }
        #groupPrintDoc .stat { flex:1; border:1px solid #ddd; border-radius:6px; padding:6px; text-align:center; page-break-inside:avoid; }
        #groupPrintDoc .stat-v { font-size:14px; font-weight:800; }
        #groupPrintDoc .stat-l { font-size:8px; color:#888; text-transform:uppercase; }
        #groupPrintDoc .ftr { margin-top:14px; border-top:1px solid #ddd; padding-top:6px; display:flex; justify-content:space-between; font-size:8px; color:#aaa; page-break-inside:avoid; }
        #groupPrintDoc .print-btn-bar { display:flex; gap:10px; margin-bottom:16px; }
        #groupPrintDoc .print-btn { background:linear-gradient(90deg,#f39c12,#f57c00); color:#000; border:none; padding:10px 24px; border-radius:10px; font-weight:800; font-size:14px; cursor:pointer; }
        #groupPrintDoc .close-btn { background:#eee; color:#333; border:none; padding:10px 18px; border-radius:10px; font-weight:700; font-size:14px; cursor:pointer; }
        @media print {
            body > *:not(#printOverlay) { display:none !important; }
            #printOverlay { position:static !important; top:0 !important; left:0 !important; width:100% !important; height:auto !important; background:white !important; z-index:99999 !important; padding:0 !important; overflow:visible !important; }
            #groupPrintDoc { max-width:100% !important; padding:0 !important; margin:0 !important; }
            #groupPrintDoc .print-btn-bar { display:none !important; }
            #groupPrintDoc table { table-layout:auto !important; width:100% !important; margin-bottom:8mm !important; }
            #groupPrintDoc td, #groupPrintDoc th { word-break:break-word !important; overflow-wrap:break-word !important; }
            @page { size:A4; margin:8mm 10mm; }
        }
    </style>
    <div class="print-btn-bar">
        <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
        <button class="close-btn" onclick="closePrintStatement()">✕ Close</button>
    </div>
    <div class="hdr">
        <div>
            <div style="display:flex;align-items:center;gap:10px;"><img src="logo.png" style="width:48px;height:48px;border-radius:10px;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><span style="display:none;font-size:22px;">🏆</span><div class="brand">AK CHIT FUNDS</div></div>
            <div style="font-size:9px;color:#888;">Chit Fund Management &bull; Group Report</div>
        </div>
        <div style="text-align:right;">
            <div style="font-size:14px;font-weight:800;">GROUP STATEMENT</div>
            <div style="font-size:9px;color:#888;">Generated: ${today}</div>
        </div>
    </div>
    <div class="info-box">
        <div style="font-size:18px;font-weight:900;margin-bottom:6px;">📂 ${g.name}</div>
        <div style="font-size:10px;color:#555;">Started: <b>${gStartDisp}</b> &nbsp;·&nbsp; Due: <b>${gDueDayDisp}</b> &nbsp;·&nbsp; Duration: <b>${totalMonths} months</b></div>
        <div class="prog-outer"><div class="prog-inner" style="width:${pct}%"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:#888;margin-bottom:8px;">
            <span>Month ${elapsed}/${totalMonths} (${pct}% complete)</span>
            <span>${left} months pending</span>
        </div>
        <div class="stats">
            <div class="stat"><div class="stat-v" style="color:#065f46;">₹${tPaid.toLocaleString('en-IN')}</div><div class="stat-l">Total Collected</div></div>
            <div class="stat"><div class="stat-v" style="color:#92400e;">₹${tBal.toLocaleString('en-IN')}</div><div class="stat-l">Total Balance</div></div>
            <div class="stat"><div class="stat-v">${expandedSlots.length}</div><div class="stat-l">Members</div></div>
            <div class="stat"><div class="stat-v" style="color:#065f46;">${picked}</div><div class="stat-l">Chits Picked</div></div>
            <div class="stat"><div class="stat-v">${gPays.length}</div><div class="stat-l">Payments</div></div>
        </div>
    </div>
    <div class="sec-title">Member Summary</div>
    <table>
        <colgroup><col style="width:4%"><col style="width:26%"><col style="width:14%"><col style="width:14%"><col style="width:12%"><col style="width:14%"><col style="width:16%"></colgroup>
        <thead><tr><th>#</th><th>Member</th><th>Total Paid</th><th>Balance</th><th>Months</th><th>Last Payment</th><th>Chit Picked</th></tr></thead>
        <tbody>${summaryRows}
        <tr style="background:#fff8e1;font-weight:800;border-top:2px solid #f39c12;">
            <td colspan="2">Grand Total</td>
            <td style="color:#065f46;">₹${tPaid.toLocaleString('en-IN')}</td>
            <td style="color:#92400e;">₹${tBal.toLocaleString('en-IN')}</td>
            <td colspan="3"></td>
        </tr></tbody>
    </table>
    <div class="sec-title" style="margin-top:20px;">Detailed Payment History — Member Wise</div>
    ${detailSections || '<p style="color:#888;font-size:10px;">No payments recorded.</p>'}
    <div class="ftr">
        <span>AK Chit Funds &bull; Admin Portal</span>
        <span>Group: ${g.name} &bull; ${today}</span>
        <span>CONFIDENTIAL</span>
    </div>
    </div>`;

    let overlay = document.getElementById('printOverlay');
    if(!overlay){
        overlay = document.createElement('div');
        overlay.id = 'printOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:white;z-index:99999;overflow-y:auto;padding:16px;';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = printHTML;
    overlay.style.display = 'block';
    showToast('✅ Group report ready — tap Print', true);
}

// ══════════════════════════════════════════
