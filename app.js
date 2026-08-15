(() => {
  'use strict';

  const BUILD = window.SAMOS_BUILD || '0.11.0';
  const STORE_KEY = 'samos.classroom.data';
  const LEGACY_KEYS = ['samos.classroom.v3','samos.classroom.v2','samos.classroom.v1'];
  const SHELL_BUILD_KEY = 'samos.shell.build';
  const RESOURCE_DB = 'samos.resource.files';
  const RESOURCE_STORE = 'files';
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  const $ = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => [...r.querySelectorAll(s)];
  const clone = v => JSON.parse(JSON.stringify(v));
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
  const pad = n => String(n).padStart(2,'0');
  const dateKey = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayKey = () => dateKey(new Date());
  const prettyDate = (d=new Date()) => d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  const prettyDateKey = key => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  const weekdayName = (d=new Date()) => d.toLocaleDateString('en-GB',{weekday:'long'});
  const esc = v => String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const attr = esc;

  const defaultState = {
    settings:{teacherName:'',centre:''},
    learners:[],
    classes:[],
    activeClassId:null,
    attendance:{},
    history:[],
    resources:[],
    view:'home',
    selectedLearnerId:null,
    resourceFilter:'all'
  };

  let state = loadState();
  let assistantRoute = 'main';
  let assistantReturn = 'main';
  let assistantCloseFrame = 0;
  let installPrompt = null;
  let registerDraft = null;
  let registerWizardStep = 1;
  let ticker = 0;

  const app = $('#staffApp');
  const facePanel = $('#samosFacePanel');
  const overlay = $('#samosOverlay');
  const content = $('#samosContent');
  const prompt = $('#samosPrompt');
  const hint = $('#samosHint');

  function readStoredState(){
    for(const key of [STORE_KEY,...LEGACY_KEYS]){
      try{const raw=localStorage.getItem(key);if(!raw)continue;const x=JSON.parse(raw);if(x&&typeof x==='object')return x;}catch(_){ }
    }
    return null;
  }

  function normaliseLearners(saved,classes){
    const byId=new Map();
    const add=l=>{
      if(!l?.name)return;
      const id=l.id||uid();
      if(!byId.has(id))byId.set(id,{...l,id,name:String(l.name).trim(),externalId:String(l.externalId||'').trim()});
    };
    (Array.isArray(saved)?saved:[]).forEach(add);
    classes.forEach(c=>(Array.isArray(c.learners)?c.learners:[]).forEach(add));
    return [...byId.values()];
  }

  function normaliseBreaks(list){
    return (Array.isArray(list)?list:[]).map((b,i)=>({id:b.id||uid(),label:b.label||`Break ${i+1}`,start:String(b.start||''),end:String(b.end||'')})).filter(b=>b.start&&b.end);
  }

  function loadState(){
    const saved=readStoredState();
    if(!saved)return clone(defaultState);
    const classes=Array.isArray(saved.classes)?saved.classes.map(c=>({...c,breaks:normaliseBreaks(c.breaks),learners:Array.isArray(c.learners)?c.learners:[]})):[];
    const merged={
      ...clone(defaultState),...saved,
      settings:{...defaultState.settings,...(saved.settings||{})},
      learners:normaliseLearners(saved.learners,classes),
      classes,
      attendance:saved.attendance&&typeof saved.attendance==='object'?saved.attendance:{},
      history:Array.isArray(saved.history)?saved.history:[],
      resources:Array.isArray(saved.resources)?saved.resources:[],
      view:'home'
    };
    refreshLearnerAttendanceSummaries(merged);
    try{localStorage.setItem(STORE_KEY,JSON.stringify(merged));}catch(_){ }
    return merged;
  }

  function save(doRender=true){
    localStorage.setItem(STORE_KEY,JSON.stringify(state));
    if(doRender)render();
  }

  function toast(message){
    const el=$('#saveToast');
    el.textContent=message;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2400);
  }

  function activeRegister(){return state.classes.find(c=>c.id===state.activeClassId)||null;}
  function attendanceKey(id,key=todayKey()){return `${id}:${key}`;}
  function attendance(id,key=todayKey()){
    const k=attendanceKey(id,key);
    if(!state.attendance[k])state.attendance[k]={_meta:{date:key,startedAt:null}};
    if(!state.attendance[k]._meta)state.attendance[k]._meta={date:key,startedAt:null};
    return state.attendance[k];
  }
  function selectUsefulRegister(){
    const day=weekdayName();
    const today=state.classes.find(c=>c.day===day);
    if(today){state.activeClassId=today.id;return;}
    if(activeRegister())return;
    state.activeClassId=state.classes[0]?.id||null;
  }

  function localMs(key,time){
    const [y,m,d]=key.split('-').map(Number);
    const [hh,mm]=String(time||'00:00').split(':').map(Number);
    return new Date(y,m-1,d,hh||0,mm||0,0,0).getTime();
  }

  function sessionBounds(reg,key=todayKey()){
    const start=localMs(key,reg.start||'09:00');
    let end=localMs(key,reg.end||'16:00');
    if(end<=start)end=start+60*60*1000;
    return{start,end,open:start-FIFTEEN_MINUTES};
  }

  function breakWindows(reg,key=todayKey()){
    const bounds=sessionBounds(reg,key);
    return normaliseBreaks(reg.breaks).map(b=>({
      ...b,startMs:Math.max(bounds.start,localMs(key,b.start)),endMs:Math.min(bounds.end,localMs(key,b.end))
    })).filter(b=>b.endMs>b.startMs).sort((a,b)=>a.startMs-b.startMs);
  }

  function overlapMs(aStart,aEnd,bStart,bEnd){return Math.max(0,Math.min(aEnd,bEnd)-Math.max(aStart,bStart));}

  function scheduledMs(reg,key=todayKey()){
    const bounds=sessionBounds(reg,key);
    const breakMs=breakWindows(reg,key).reduce((sum,b)=>sum+(b.endMs-b.startMs),0);
    return Math.max(0,(bounds.end-bounds.start)-breakMs);
  }

  function intervalNetMs(start,end,reg,key){
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 0;
    let total=end-start;
    for(const b of breakWindows(reg,key))total-=overlapMs(start,end,b.startMs,b.endMs);
    return Math.max(0,total);
  }

  function recordAttendedMs(record,reg,key=todayKey(),cutoff=Date.now()){
    if(!record)return 0;
    const bounds=sessionBounds(reg,key);
    let total=0;
    for(const i of Array.isArray(record.intervals)?record.intervals:[]){
      const s=Number(i.start),e=Math.min(Number(i.end)||cutoff,bounds.end);
      total+=intervalNetMs(s,e,reg,key);
    }
    if(record.runningSince){
      const end=Math.min(cutoff,bounds.end);
      total+=intervalNetMs(Number(record.runningSince),end,reg,key);
    }
    return Math.max(0,total);
  }

  function formatDuration(ms,seconds=false){
    ms=Math.max(0,Number(ms)||0);
    const totalSeconds=Math.floor(ms/1000),h=Math.floor(totalSeconds/3600),m=Math.floor((totalSeconds%3600)/60),s=totalSeconds%60;
    if(seconds)return `${pad(h)}:${pad(m)}:${pad(s)}`;
    if(h&&m)return `${h}h ${m}m`;
    if(h)return `${h}h`;
    return `${m}m`;
  }

  function formatTime(ms){return new Date(ms).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});}

  function completedSession(reg,key=todayKey()){
    return state.history.find(h=>h.classId===reg.id&&h.date===key)||null;
  }

  function currentBreak(reg,key=todayKey(),now=Date.now()){
    return breakWindows(reg,key).find(b=>now>=b.startMs&&now<b.endMs)||null;
  }

  function sessionTimingState(reg,key=todayKey(),now=Date.now()){
    const b=sessionBounds(reg,key),isToday=key===todayKey(),scheduledDay=reg.day===weekdayName(new Date(`${key}T12:00:00`)),done=completedSession(reg,key);
    if(done)return{code:'completed',label:'Completed',done,b};
    if(!isToday||!scheduledDay)return{code:'not-today',label:`Scheduled ${reg.day}`,b};
    if(now<b.open)return{code:'early',label:`Opens ${formatTime(b.open)}`,b};
    if(now<b.start)return{code:'open-early',label:`Open · starts ${formatTime(b.start)}`,b};
    if(now>=b.end)return{code:'ended',label:'Session ended',b};
    const br=currentBreak(reg,key,now);
    if(br)return{code:'break',label:`${br.label} · timers paused`,break:br,b};
    return{code:'live',label:'Live session',b};
  }

  function registerStats(reg=activeRegister(),key=todayKey()){
    if(!reg)return{total:0,running:0,attended:0,completed:0,percent:0};
    const done=completedSession(reg,key),rows=reg.learners||[],a=attendance(reg.id,key);
    let running=0,attended=0;
    for(const l of rows){
      const r=done?.data?.[l.id]||a[l.id];
      if(r?.runningSince)running++;
      const actual=done?.data?.[l.id]?.attendedMs??recordAttendedMs(r,reg,key);
      if(actual>0)attended++;
    }
    return{total:rows.length,running,attended,completed:done?rows.length:0,percent:rows.length?Math.round(attended/rows.length*100):0};
  }

  function legacyActualMs(history,record,expected){
    if(Number.isFinite(record?.attendedMs))return Number(record.attendedMs);
    if(Number.isFinite(record?.attendedMinutes))return Number(record.attendedMinutes)*60000;
    if(record?.status==='present')return expected;
    if(record?.status==='late')return Math.max(0,expected-(Number(record.lateMinutes)||0)*60000);
    if(record?.status==='absent')return 0;
    return 0;
  }

  function learnerAttendanceStats(id,sourceState=state){
    let expected=0,actual=0,sessions=0;
    for(const h of sourceState.history||[]){
      const rec=h?.data?.[id];
      if(!rec)continue;
      const reg=(sourceState.classes||[]).find(c=>c.id===h.classId);
      const exp=Number(rec.expectedMs)||Number(h.scheduledMs)||(reg?scheduledMs(reg,h.date):0);
      if(exp<=0)continue;
      expected+=exp;
      actual+=legacyActualMs(h,rec,exp);
      sessions++;
    }
    return{sessions,expectedMs:expected,attendedMs:actual,percentage:expected?Math.min(100,Math.round(actual/expected*100)):0};
  }

  function refreshLearnerAttendanceSummaries(target=state){
    for(const l of target.learners||[])l.attendance=learnerAttendanceStats(l.id,target);
  }

  function finaliseSession(reg,key=todayKey(),auto=false,cutoff=Date.now()){
    const existing=completedSession(reg,key);if(existing)return existing;
    const a=attendance(reg.id,key),bounds=sessionBounds(reg,key),stopAt=Math.min(Math.max(cutoff,bounds.open),bounds.end),expected=scheduledMs(reg,key),data={};
    for(const l of reg.learners||[]){
      const rec=a[l.id]||{intervals:[],runningSince:null};
      if(rec.runningSince){
        rec.intervals=Array.isArray(rec.intervals)?rec.intervals:[];
        if(stopAt>Number(rec.runningSince))rec.intervals.push({start:Number(rec.runningSince),end:stopAt});
        rec.runningSince=null;
      }
      const actual=recordAttendedMs(rec,reg,key,stopAt);
      data[l.id]={...clone(rec),attendedMs:actual,expectedMs:expected,status:actual>0?'attended':'absent'};
      a[l.id]=clone(rec);
    }
    a._meta={...(a._meta||{}),date:key,completedAt:Date.now(),autoCompleted:auto};
    const actualTotal=Object.values(data).reduce((s,r)=>s+(Number(r.attendedMs)||0),0);
    const row={
      id:uid(),sessionKey:attendanceKey(reg.id,key),classId:reg.id,className:reg.name,date:key,dateLabel:prettyDateKey(key),
      total:(reg.learners||[]).length,present:Object.values(data).filter(r=>r.attendedMs>0).length,late:0,absent:Object.values(data).filter(r=>!r.attendedMs).length,
      scheduledMs:expected,breakMs:breakWindows(reg,key).reduce((s,b)=>s+(b.endMs-b.startMs),0),attendedMs:actualTotal,autoCompleted:auto,data
    };
    state.history.unshift(row);state.history=state.history.slice(0,250);refreshLearnerAttendanceSummaries();save(false);return row;
  }

  function reconcileEndedSessions(){
    const now=Date.now();let changed=false;
    for(const [key,a] of Object.entries(state.attendance||{})){
      const split=key.lastIndexOf(':');if(split<1)continue;
      const regId=key.slice(0,split),dayKey=key.slice(split+1),reg=state.classes.find(c=>c.id===regId);if(!reg||completedSession(reg,dayKey))continue;
      const started=Boolean(a?._meta?.startedAt)||Object.values(a||{}).some(r=>r&&typeof r==='object'&&(r.runningSince||(Array.isArray(r.intervals)&&r.intervals.length)));
      if(!started)continue;
      if(now>=sessionBounds(reg,dayKey).end){finaliseSession(reg,dayKey,true,sessionBounds(reg,dayKey).end);changed=true;}
    }
    if(changed)save(false);
  }

  function homeMetrics(){
    const assigned=new Set(state.classes.flatMap(c=>(c.learners||[]).map(l=>l.id)));
    const learners=state.learners.length?Math.round(state.learners.filter(l=>assigned.has(l.id)).length/state.learners.length*100):0;
    const attendanceValues=state.learners.map(l=>learnerAttendanceStats(l.id).percentage).filter((_,i)=>state.learners[i]?.attendance?.sessions>0);
    const registers=attendanceValues.length?Math.round(attendanceValues.reduce((a,b)=>a+b,0)/attendanceValues.length):registerStats().percent;
    const kinds=new Set(state.resources.map(r=>r.type));
    const resources=Math.min(100,(kinds.has('powerpoint')?50:0)+(kinds.has('lesson-plan')?50:0));
    return{learners,registers,resources,games:0};
  }

  function arch(label,value,key){
    return `<button class="vh-arch" type="button" data-home-metric="${key}" aria-label="Open ${label.toLowerCase()}"><strong>${label}</strong><svg viewBox="0 0 80 43" aria-hidden="true"><path class="vh-track" d="M8 39 A32 32 0 0 1 72 39"/><path class="vh-value" pathLength="100" style="stroke-dasharray:${value} 100" d="M8 39 A32 32 0 0 1 72 39"/></svg><span>${value}%</span></button>`;
  }

  function setHomeMode(on){document.body.classList.toggle('samos-home-centred',on);facePanel.hidden=!on;}

  function render(){
    reconcileEndedSessions();
    if(state.view==='home')renderHome();
    else if(state.view==='learners')renderLearnersPage();
    else if(state.view==='learner')renderLearnerProfile();
    else if(state.view==='registers')renderRegistersPage();
    else if(state.view==='resources')renderResourcesPage();
    else if(state.view==='games')renderGamesPage();
    else renderHome();
    manageTicker();
  }

  function renderHome(){
    state.view='home';setHomeMode(true);const m=homeMetrics();
    app.innerHTML=`<section class="assessor-value-home" aria-label="Classroom overview"><div class="vh-arches">${arch('LEARNERS',m.learners,'learners')}${arch('REGISTERS',m.registers,'registers')}${arch('RESOURCES',m.resources,'resources')}${arch('GAMES',m.games,'games')}</div></section>`;
  }

  function breadcrumb(title,sub='CLASSROOM'){return `<div class="staff-page-head"><button class="staff-back" type="button" data-home-back>←</button><div><small>${esc(sub)}</small><h1>${esc(title)}</h1></div></div>`;}

  function renderLearnersPage(){
    setHomeMode(false);const rows=[...state.learners].sort((a,b)=>a.name.localeCompare(b.name));
    app.innerHTML=`${breadcrumb('Learners')}<button class="blue-button full" type="button" data-add-learner>+ Add learner</button><section class="staff-card"><div class="samos-section-head"><h2>Learners</h2><small>${rows.length} saved</small></div><div class="learner-list">${rows.length?rows.map(l=>{const n=state.classes.filter(c=>(c.learners||[]).some(x=>x.id===l.id)).length,a=learnerAttendanceStats(l.id);return `<button class="learner-row" type="button" data-learner-info="${attr(l.id)}"><span><strong>${esc(l.name)}</strong><small>${esc(l.externalId||'No learner ID')} · ${a.sessions} session${a.sessions===1?'':'s'}</small></span><span class="mini-progress"><b>${a.percentage}%</b><small>ATT</small></span></button>`}).join(''):'<div class="empty-state"><strong>No learners yet</strong><p>Add your first learner to begin.</p></div>'}</div></section>`;
  }

  function learnerHistoryHtml(id){
    const rows=state.history.filter(h=>h?.data?.[id]).slice(0,12);
    return rows.length?rows.map(h=>{const r=h.data[id],expected=Number(r.expectedMs)||Number(h.scheduledMs)||0,actual=legacyActualMs(h,r,expected),pct=expected?Math.min(100,Math.round(actual/expected*100)):0;return `<div class="samos-row"><span><strong>${esc(h.className)}</strong><small>${esc(h.dateLabel||prettyDateKey(h.date))}</small><em>${formatDuration(actual)} / ${formatDuration(expected)} · ${pct}%</em></span></div>`}).join(''):'<div class="samos-empty"><strong>No completed sessions yet</strong><p>Attendance results will appear here after a register session ends.</p></div>';
  }

  function renderLearnerProfile(){
    setHomeMode(false);const l=state.learners.find(x=>x.id===state.selectedLearnerId);if(!l){state.view='learners';return renderLearnersPage();}
    const a=learnerAttendanceStats(l.id),assigned=state.classes.filter(c=>(c.learners||[]).some(x=>x.id===l.id));
    app.innerHTML=`${breadcrumb(l.name,'LEARNER PROFILE')}<section class="learner-hero samos-attendance-hero"><div><small>ATTENDANCE</small><strong>${a.percentage}%</strong><span>${formatDuration(a.attendedMs)} attended · ${formatDuration(a.expectedMs)} scheduled</span></div></section><div class="profile-attendance-grid"><div><strong>${a.sessions}</strong><span>Sessions</span></div><div><strong>${formatDuration(a.attendedMs)}</strong><span>Attended</span></div><div><strong>${formatDuration(a.expectedMs)}</strong><span>Scheduled</span></div></div><section class="staff-card"><div class="samos-section-head"><h2>Registers</h2><small>${assigned.length} assigned</small></div>${assigned.length?assigned.map(r=>`<button class="samos-row" type="button" data-open-register="${attr(r.id)}"><span><strong>${esc(r.name)}</strong><small>${esc(r.day)} · ${esc(r.start)}–${esc(r.end)}</small><em>${formatDuration(scheduledMs(r))} teaching time</em></span><b>›</b></button>`).join(''):'<div class="samos-empty"><strong>No registers assigned</strong></div>'}</section><section class="staff-card"><div class="samos-section-head"><h2>Attendance history</h2><small>${a.sessions} session${a.sessions===1?'':'s'}</small></div>${learnerHistoryHtml(l.id)}</section>`;
  }

  function renderRegistersPage(){
    setHomeMode(false);selectUsefulRegister();const reg=activeRegister();
    const chips=state.classes.map(c=>`<button class="${c.id===state.activeClassId?'active':''}" type="button" data-select-register="${attr(c.id)}">${esc(c.name)}</button>`).join('');
    app.innerHTML=`${breadcrumb('Registers','ATTENDANCE')}<div class="inline-actions"><button class="blue-button" type="button" data-new-register>+ Register</button><button class="soft-button" type="button" data-register-list>Register list</button></div>${state.classes.length?`<div class="segmented samos-register-picker">${chips}</div>`:''}<div id="registerWorkspace"></div>`;
    renderRegisterWorkspace(reg);
  }

  function sessionBanner(reg,key=todayKey()){
    const t=sessionTimingState(reg,key),b=t.b,breakText=breakWindows(reg,key).map(x=>`${x.start}–${x.end}`).join(' · ');
    return `<div class="session-banner ${t.code}"><span><small>SESSION</small><strong>${esc(t.label)}</strong><em>Timers open ${formatTime(b.open)} · finish ${formatTime(b.end)}</em></span><span><small>TEACHING TIME</small><strong>${formatDuration(scheduledMs(reg,key))}</strong><em>${breakText?`Breaks ${esc(breakText)}`:'No breaks'}</em></span></div>`;
  }

  function completedRecord(reg,l,key){return completedSession(reg,key)?.data?.[l.id]||null;}

  function timerRow(reg,l,key=todayKey()){
    const done=completedSession(reg,key),a=attendance(reg.id,key),live=a[l.id]||{},record=done?.data?.[l.id]||live,t=sessionTimingState(reg,key),actual=done?legacyActualMs(done,record,Number(record.expectedMs)||scheduledMs(reg,key)):recordAttendedMs(record,reg,key),running=Boolean(!done&&record.runningSince),inBreak=running&&Boolean(currentBreak(reg,key));
    const disabled=Boolean(done)||!['open-early','live','break'].includes(t.code);
    const status=done?`${Math.min(100,Math.round(actual/(Number(record.expectedMs)||scheduledMs(reg,key)||1)*100))}% attendance`:running?(inBreak?'Break · paused automatically':'Timing now'):(actual>0?'Paused':'Not started');
    return `<div class="attendance-row timed-row" data-attendance-learner="${attr(l.id)}"><div class="attendance-name"><strong>${esc(l.name)}</strong><small>${esc(l.externalId||'No learner ID')}</small><div class="timer-readout"><b>${formatDuration(actual,true)}</b><span>${esc(status)}</span></div></div><button class="attendance-timer ${running?'running':''} ${done?'complete':''}" type="button" data-toggle-timer="${attr(l.id)}" ${disabled?'disabled':''} aria-label="${running?'Stop':'Start'} timer for ${attr(l.name)}"><span></span></button></div>`;
  }

  function renderRegisterWorkspace(reg){
    const host=$('#registerWorkspace');if(!host)return;
    if(!reg){host.innerHTML='<section class="staff-card"><div class="empty-state"><strong>No registers yet</strong><p>Create a register and Samos will take you through each step.</p></div></section>';return;}
    const key=todayKey(),done=completedSession(reg,key),s=registerStats(reg,key),timing=sessionTimingState(reg,key),canFinish=!done&&['open-early','live','break','ended'].includes(timing.code);
    host.innerHTML=`${sessionBanner(reg,key)}<section class="staff-card"><div class="section-title"><div><h2>${esc(reg.name)}</h2><small>${esc([reg.day,`${reg.start||'09:00'}–${reg.end||'16:00'}`,reg.room].filter(Boolean).join(' · '))}</small></div><span class="status-pill">${esc(prettyDate())}</span></div><div class="register-summary timed-summary"><div><strong>${s.total}</strong><span>Learners</span></div><div><strong>${s.running}</strong><span>Timing</span></div><div><strong>${s.attended}</strong><span>Attended</span></div><div><strong>${formatDuration(scheduledMs(reg,key))}</strong><span>Session</span></div></div><div class="inline-actions"><button class="soft-button" type="button" data-edit-register>Edit register</button><button class="blue-button" type="button" data-assign-learners>+ Learners</button></div><div class="attendance-list">${(reg.learners||[]).length?(reg.learners||[]).map(l=>timerRow(reg,l,key)).join(''):'<div class="empty-state"><strong>No learners on this register</strong><p>Add learners from your learner directory.</p></div>'}</div>${(reg.learners||[]).length&&canFinish?'<button class="soft-button full finish-session" type="button" data-finish-register>Finish session now</button>':''}${done?'<div class="session-complete-note"><strong>Session saved</strong><span>Attendance hours have been added to each learner profile.</span></div>':''}</section><section class="staff-card"><div class="samos-section-head"><h2>Recent completed registers</h2><small>${state.history.filter(h=>h.classId===reg.id).length} saved</small></div>${historyHtml(reg.id)}</section>`;
  }

  function historyHtml(classId=null){
    const rows=state.history.filter(h=>!classId||h.classId===classId).slice(0,8);
    return rows.length?rows.map(h=>`<div class="samos-row"><span><strong>${esc(h.className)}</strong><small>${esc(h.dateLabel||prettyDateKey(h.date))} · ${h.total} learners</small><em>${h.present}/${h.total} attended · ${formatDuration(Number(h.scheduledMs)||0)} scheduled</em></span></div>`).join(''):'<div class="samos-empty"><strong>No completed registers</strong><p>Finished registers will appear here.</p></div>';
  }

  function renderRegisterList(){
    setHomeMode(false);state.view='registers';
    app.innerHTML=`${breadcrumb('Register list','ATTENDANCE')}<button class="blue-button full" type="button" data-new-register>+ Create register</button><section class="staff-card"><div class="samos-section-head"><h2>Registers</h2><small>${state.classes.length} saved</small></div>${state.classes.length?state.classes.map(c=>`<button class="samos-row" type="button" data-open-register="${attr(c.id)}"><span><strong>${esc(c.name)}</strong><small>${esc([c.day,`${c.start||'09:00'}–${c.end||'16:00'}`,c.room].filter(Boolean).join(' · '))}</small><em>${(c.learners||[]).length} learner${(c.learners||[]).length===1?'':'s'} · ${formatDuration(scheduledMs(c))} teaching</em></span><b>›</b></button>`).join(''):'<div class="samos-empty"><strong>No registers yet</strong><p>Create your first register.</p></div>'}</section><section class="staff-card"><div class="samos-section-head"><h2>Completed registers</h2><small>${state.history.length} saved</small></div>${historyHtml()}</section>`;
  }

  function renderResourcesPage(){
    setHomeMode(false);const filter=state.resourceFilter||'all';
    const rows=state.resources.filter(r=>filter==='all'||r.type===filter).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    app.innerHTML=`${breadcrumb('Resources','TEACHING')}<div class="inline-actions"><button class="blue-button" type="button" data-create-resource>+ Create</button><button class="soft-button" type="button" data-upload-resource>Upload resource</button></div><div class="resource-filter"><button class="${filter==='all'?'active':''}" data-resource-filter="all">All</button><button class="${filter==='powerpoint'?'active':''}" data-resource-filter="powerpoint">PowerPoints</button><button class="${filter==='lesson-plan'?'active':''}" data-resource-filter="lesson-plan">Lesson plans</button><button class="${filter==='other'?'active':''}" data-resource-filter="other">Other</button></div><section class="staff-card"><div class="samos-section-head"><h2>Resource library</h2><small>${rows.length} shown</small></div>${rows.length?rows.map(resourceRow).join(''):'<div class="samos-empty"><strong>No resources here yet</strong><p>Upload a file or create a teaching resource.</p></div>'}</section>`;
  }

  function resourceRow(r){
    const type=r.type==='powerpoint'?'PowerPoint':r.type==='lesson-plan'?'Lesson plan':'Resource';
    return `<div class="samos-row" data-resource-id="${attr(r.id)}"><span><strong>${esc(r.title)}</strong><small>${esc(type)} · ${r.kind==='upload'?esc(r.fileName||'Uploaded file'):'Created in Samos'}</small>${r.notes?`<em>${esc(String(r.notes).slice(0,80))}</em>`:''}</span><div class="row-actions">${r.kind==='upload'?'<button type="button" class="text-button" data-open-resource>Open</button>':''}<button type="button" class="danger-text" data-delete-resource>Delete</button></div></div>`;
  }

  function renderGamesPage(){setHomeMode(false);app.innerHTML=`${breadcrumb('Games','ACTIVITIES')}<section class="staff-card"><div class="empty-state"><strong>Classroom games</strong><p>Quizzes, random pickers, team games and quick recap activities will be added here.</p></div></section>`;}

  function goHome(){state.view='home';save();window.scrollTo({top:0,behavior:'auto'});}

  /* ---------------- Assistant ---------------- */
  function copy(title,sub){prompt.textContent=title;hint.textContent=sub;}
  function openAssistant(route='main'){
    if(assistantCloseFrame){cancelAnimationFrame(assistantCloseFrame);assistantCloseFrame=0;}
    overlay.classList.remove('samos-closing');assistantRoute=route;assistantReturn='main';overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');document.body.classList.add('evia-open');window.EviaAnimations?.setBusy?.(true);renderAssistant();$('#samosClose')?.focus();
  }
  function closeAssistant(){
    if(!overlay.classList.contains('open')){overlay.classList.remove('samos-closing');document.body.classList.remove('evia-open');window.EviaAnimations?.setBusy?.(false);assistantRoute='main';return;}
    if(assistantCloseFrame){cancelAnimationFrame(assistantCloseFrame);assistantCloseFrame=0;}
    window.EviaAnimations?.setBusy?.(true);overlay.classList.add('samos-closing');overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true');document.body.classList.remove('evia-open');assistantRoute='main';registerDraft=null;registerWizardStep=1;
    assistantCloseFrame=requestAnimationFrame(()=>{assistantCloseFrame=0;overlay.classList.remove('samos-closing');window.EviaAnimations?.setBusy?.(false);});
  }
  function assistantBack(){
    if(assistantRoute==='register:wizard'){
      syncRegisterDraft();
      if(registerWizardStep>1){registerWizardStep--;return renderRegisterWizard();}
      registerDraft=null;return assistantRegisters();
    }
    if(assistantRoute==='main')return closeAssistant();
    if(assistantRoute.startsWith('learners:'))return assistantLearners();
    if(assistantRoute.startsWith('registers:'))return assistantRegisters();
    if(assistantRoute.startsWith('resources:'))return assistantResources();
    assistantRoute='main';renderAssistant();
  }
  function renderAssistant(){
    if(assistantRoute==='main')return assistantMain();
    if(assistantRoute==='learners')return assistantLearners();
    if(assistantRoute==='registers')return assistantRegisters();
    if(assistantRoute==='resources')return assistantResources();
    if(assistantRoute==='games')return assistantGames();
    if(assistantRoute==='register:wizard')return renderRegisterWizard();
    return assistantMain();
  }
  function assistantMain(){
    assistantRoute='main';const reg=activeRegister(),rs=registerStats(reg);
    copy('What do you need?','Everything is organised into four clear areas.');
    content.innerHTML=`<div class="ta-menu as-main v39-main"><button data-assistant="learners"><strong>Learners</strong><span>${state.learners.length} learner${state.learners.length===1?'':'s'} saved.</span></button><button data-assistant="registers"><strong>Registers</strong><span>${reg?`${esc(reg.name)} · ${rs.running} timing now`:'Create and manage classroom registers.'}</span></button><button data-assistant="resources"><strong>Resources</strong><span>${state.resources.length} teaching resource${state.resources.length===1?'':'s'} saved.</span></button><button data-assistant="games"><strong>Games</strong><span>Classroom games, quizzes and recap activities.</span></button></div>`;
    window.EviaAnimations?.react?.('analysing');
  }
  function assistantLearners(q=''){
    assistantRoute='learners';copy('Learners','Search your classroom or add a learner.');
    content.innerHTML=`<div class="v39-learner-tools"><label><span>Find learner</span><input id="assistantLearnerSearch" type="search" value="${attr(q)}" placeholder="Learner name or ID" autocomplete="off"></label><button type="button" data-assistant-add-learner>+ Add learner</button></div><div id="assistantLearnerResults" class="v39-learner-list"></div>`;renderAssistantLearnerResults(q);
  }
  function renderAssistantLearnerResults(q=''){
    const box=$('#assistantLearnerResults');if(!box)return;const term=String(q).trim().toLowerCase();const rows=state.learners.filter(l=>!term||`${l.name} ${l.externalId||''}`.toLowerCase().includes(term)).sort((a,b)=>a.name.localeCompare(b.name));
    box.innerHTML=rows.length?rows.map(l=>{const a=learnerAttendanceStats(l.id);return `<button class="v39-learner-row" type="button" data-assistant-learner="${attr(l.id)}"><span><strong>${esc(l.name)}</strong><small>${esc(l.externalId||'No learner ID')}</small></span><i><b>ATTENDANCE</b><strong>${a.percentage}%</strong><small>${a.sessions} sessions</small></i></button>`}).join(''):'<div class="v39-empty"><strong>No matching learners</strong><span>Try another name or create a learner.</span></div>';
  }
  function assistantRegisters(){
    assistantRoute='registers';const reg=activeRegister();copy('Registers',reg?'Open today’s register, manage registers or create one.':'Create your first classroom register.');
    content.innerHTML=`<div class="ta-menu"><button data-assistant-action="registers:today"><strong>Today’s register</strong><span>${reg?`${esc(reg.name)} · ${registerStats(reg).running} timing now`:'No register selected yet.'}</span></button><button data-assistant-action="registers:list"><strong>List of registers</strong><span>${state.classes.length} register${state.classes.length===1?'':'s'} saved.</span></button><button data-assistant-action="registers:create"><strong>Create register</strong><span>Samos will take you through it step by step.</span></button></div>`;
  }
  function assistantResources(){assistantRoute='resources';copy('Resources','PowerPoints, lesson plans and teaching resources.');content.innerHTML=`<div class="ta-menu"><button data-assistant-action="resources:powerpoints"><strong>PowerPoints</strong><span>Open your PowerPoint resource library.</span></button><button data-assistant-action="resources:lessons"><strong>Lesson plans</strong><span>Open your saved lesson plans.</span></button><button data-assistant-action="resources:upload"><strong>Upload resource</strong><span>Add a PowerPoint, PDF, document or image.</span></button><button data-assistant-action="resources:create"><strong>Create resource</strong><span>Create a lesson plan or teaching resource in Samos.</span></button></div>`;}
  function assistantGames(){assistantRoute='games';copy('Games','Classroom games and recap activities.');content.innerHTML=`<div class="ta-card"><div class="v39-empty"><strong>Games are ready for the next build</strong><span>Quizzes, random pickers, team games and quick checks will live here.</span></div><div class="ta-actions"><button class="primary" type="button" data-assistant-open-games>Open Games</button></div></div>`;}

  /* ---------------- Register creation wizard ---------------- */
  function startRegisterWizard(edit=false,id=null){
    const reg=edit?state.classes.find(c=>c.id===(id||state.activeClassId)):null;
    registerDraft={
      id:reg?.id||null,edit:Boolean(reg),name:reg?.name||'',day:reg?.day||weekdayName(),room:reg?.room||'',start:reg?.start||'09:00',end:reg?.end||'16:00',
      breaks:normaliseBreaks(reg?.breaks),learnerIds:(reg?.learners||[]).map(l=>l.id)
    };
    registerWizardStep=1;
    if(!overlay.classList.contains('open'))openAssistant('register:wizard');else{assistantRoute='register:wizard';renderRegisterWizard();}
  }

  function wizardProgress(){return `<div class="wizard-progress"><span style="width:${registerWizardStep/5*100}%"></span></div>`;}

  function renderRegisterWizard(){
    assistantRoute='register:wizard';if(!registerDraft)return assistantRegisters();
    const d=registerDraft,edit=d.edit?'Edit':'Create';
    if(registerWizardStep===1){
      copy(`${edit} register`,'Step 1 of 5 · Register details');
      content.innerHTML=`${wizardProgress()}<div class="ta-card"><label class="ta-field"><span>Register name</span><input id="wizardRegisterName" value="${attr(d.name)}" placeholder="e.g. Level 2 Bricklaying" autocomplete="off"></label><div class="ta-row"><label class="ta-field"><span>Day</span><select id="wizardRegisterDay">${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(x=>`<option ${x===d.day?'selected':''}>${x}</option>`).join('')}</select></label><label class="ta-field"><span>Room</span><input id="wizardRegisterRoom" value="${attr(d.room)}" placeholder="Optional"></label></div><div class="ta-actions"><button class="primary" type="button" data-register-wizard-next>Next</button></div></div>`;return;
    }
    if(registerWizardStep===2){
      copy('Session times','Step 2 of 5 · Set the teaching day');
      content.innerHTML=`${wizardProgress()}<div class="ta-card"><div class="ta-row"><label class="ta-field"><span>Start time</span><input id="wizardRegisterStart" type="time" value="${attr(d.start)}"></label><label class="ta-field"><span>Finish time</span><input id="wizardRegisterEnd" type="time" value="${attr(d.end)}"></label></div><div class="wizard-note"><strong>Early start</strong><span>The register opens 15 minutes before the start time. Learner timers automatically stop at the finish time.</span></div><div class="ta-actions"><button class="primary" type="button" data-register-wizard-next>Next</button></div></div>`;return;
    }
    if(registerWizardStep===3){
      copy('Add breaks','Step 3 of 5 · Breaks are removed from attendance time');
      const rows=d.breaks.length?d.breaks.map((b,i)=>`<div class="break-editor" data-break-index="${i}"><div class="ta-row"><label class="ta-field"><span>Break starts</span><input type="time" data-wizard-break-start="${i}" value="${attr(b.start)}"></label><label class="ta-field"><span>Break ends</span><input type="time" data-wizard-break-end="${i}" value="${attr(b.end)}"></label></div><button type="button" class="danger-text" data-remove-wizard-break="${i}">Remove break</button></div>`).join(''):'<div class="v39-empty compact-empty"><strong>No breaks added</strong><span>If there are no breaks, just continue.</span></div>';
      content.innerHTML=`${wizardProgress()}<div class="ta-card"><div class="break-editor-list">${rows}</div><button class="soft-button full" type="button" data-add-wizard-break>+ Add break</button><div class="wizard-note"><strong>Automatic pause</strong><span>If a learner timer is running during a break, Samos keeps it running visually but does not count any break minutes.</span></div><div class="ta-actions"><button class="primary" type="button" data-register-wizard-next>Next</button></div></div>`;return;
    }
    if(registerWizardStep===4){
      copy('Choose learners','Step 4 of 5 · Select who belongs on this register');
      const selected=new Set(d.learnerIds||[]),rows=state.learners.length?[...state.learners].sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<label class="wizard-learner"><input type="checkbox" data-wizard-learner value="${attr(l.id)}" ${selected.has(l.id)?'checked':''}><span><strong>${esc(l.name)}</strong><small>${esc(l.externalId||'No learner ID')}</small></span></label>`).join(''):'<div class="v39-empty"><strong>No learners yet</strong><span>You can create the register now and add learners afterwards.</span></div>';
      content.innerHTML=`${wizardProgress()}<div class="ta-card"><div class="wizard-learners">${rows}</div><div class="ta-actions"><button class="primary" type="button" data-register-wizard-next>Review register</button></div></div>`;return;
    }
    const expected=scheduledMs(d,todayKey()),breakText=d.breaks.length?d.breaks.map(b=>`${b.start}–${b.end}`).join(' · '):'No breaks';
    copy('Check the register','Step 5 of 5 · Ready to save');
    content.innerHTML=`${wizardProgress()}<div class="ta-card"><div class="wizard-review"><span><small>REGISTER</small><strong>${esc(d.name||'Unnamed register')}</strong><em>${esc(d.day)} · ${esc(d.room||'No room set')}</em></span><span><small>SESSION</small><strong>${esc(d.start)}–${esc(d.end)}</strong><em>${formatDuration(expected)} teaching time</em></span><span><small>BREAKS</small><strong>${d.breaks.length}</strong><em>${esc(breakText)}</em></span><span><small>LEARNERS</small><strong>${(d.learnerIds||[]).length}</strong><em>Can be changed later</em></span></div><div class="ta-actions"><button class="primary" type="button" data-save-register-wizard>${d.edit?'Save changes':'Create register'}</button>${d.edit?'<button type="button" data-delete-register-wizard>Delete register</button>':''}</div></div>`;
  }

  function syncRegisterDraft(){
    if(!registerDraft)return;
    if(registerWizardStep===1){registerDraft.name=$('#wizardRegisterName')?.value.trim()??registerDraft.name;registerDraft.day=$('#wizardRegisterDay')?.value||registerDraft.day;registerDraft.room=$('#wizardRegisterRoom')?.value.trim()??registerDraft.room;}
    if(registerWizardStep===2){registerDraft.start=$('#wizardRegisterStart')?.value||registerDraft.start;registerDraft.end=$('#wizardRegisterEnd')?.value||registerDraft.end;}
    if(registerWizardStep===3){registerDraft.breaks=registerDraft.breaks.map((b,i)=>({...b,start:$(`[data-wizard-break-start="${i}"]`)?.value||b.start,end:$(`[data-wizard-break-end="${i}"]`)?.value||b.end}));}
    if(registerWizardStep===4){registerDraft.learnerIds=$$('[data-wizard-learner]:checked',content).map(x=>x.value);}
  }

  function validateWizardStep(){
    syncRegisterDraft();const d=registerDraft;if(!d)return false;
    if(registerWizardStep===1&& !d.name){toast('Add a register name');$('#wizardRegisterName')?.focus();return false;}
    if(registerWizardStep===2){const s=localMs(todayKey(),d.start),e=localMs(todayKey(),d.end);if(e<=s){toast('Finish time must be after the start time');return false;}}
    if(registerWizardStep===3){
      const bounds=sessionBounds(d,todayKey());
      for(const b of d.breaks){const s=localMs(todayKey(),b.start),e=localMs(todayKey(),b.end);if(!b.start||!b.end||e<=s){toast('Check each break start and finish time');return false;}if(s<bounds.start||e>bounds.end){toast('Breaks must be inside the session times');return false;}}
      const ordered=[...d.breaks].sort((a,b)=>a.start.localeCompare(b.start));for(let i=1;i<ordered.length;i++){if(ordered[i].start<ordered[i-1].end){toast('Break times cannot overlap');return false;}}
      d.breaks=ordered.map((b,i)=>({...b,label:`Break ${i+1}`}));
    }
    return true;
  }

  function saveRegisterWizard(){
    syncRegisterDraft();if(!registerDraft?.name)return;
    const values={name:registerDraft.name,day:registerDraft.day,room:registerDraft.room,start:registerDraft.start,end:registerDraft.end,breaks:normaliseBreaks(registerDraft.breaks)};
    const learnerRows=(registerDraft.learnerIds||[]).map(id=>state.learners.find(l=>l.id===id)).filter(Boolean).map(clone);
    if(registerDraft.edit){const reg=state.classes.find(c=>c.id===registerDraft.id);if(!reg)return;Object.assign(reg,values,{learners:learnerRows});state.activeClassId=reg.id;}
    else{const reg={id:uid(),...values,learners:learnerRows};state.classes.push(reg);state.activeClassId=reg.id;}
    const wasEdit=registerDraft.edit;registerDraft=null;registerWizardStep=1;save(false);closeAssistant();state.view='registers';save();toast(wasEdit?'Register updated':'Register created');
  }

  function deleteRegisterWizard(){
    if(!registerDraft?.edit)return;const reg=state.classes.find(c=>c.id===registerDraft.id);if(!reg||!confirm(`Delete ${reg.name}?`))return;
    state.classes=state.classes.filter(c=>c.id!==reg.id);Object.keys(state.attendance).filter(k=>k.startsWith(`${reg.id}:`)).forEach(k=>delete state.attendance[k]);state.activeClassId=state.classes[0]?.id||null;registerDraft=null;registerWizardStep=1;save(false);closeAssistant();state.view='registers';save();toast('Register deleted');
  }

  /* ---------------- Learners / assignment / timers ---------------- */
  function openLearnerDialog(){$('#learnerNameInput').value='';$('#learnerIdInput').value='';$('#learnerDialog').showModal();setTimeout(()=>$('#learnerNameInput').focus(),60);}
  function saveLearner(){const name=$('#learnerNameInput').value.trim();if(!name)return false;state.learners.push({id:uid(),name,externalId:$('#learnerIdInput').value.trim(),attendance:{sessions:0,expectedMs:0,attendedMs:0,percentage:0}});save(false);toast('Learner saved');if(overlay.classList.contains('open'))setTimeout(()=>assistantLearners(),0);else render();return true;}

  function openAssignDialog(){
    const reg=activeRegister();if(!reg){toast('Create or select a register first');return;}if(!state.learners.length){toast('Create a learner first');openLearnerDialog();return;}
    const assigned=new Set((reg.learners||[]).map(l=>l.id)),available=state.learners.filter(l=>!assigned.has(l.id)),box=$('#assignLearnerList');
    box.innerHTML=available.length?available.sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<label class="assign-option"><input type="checkbox" value="${attr(l.id)}"><span><strong>${esc(l.name)}</strong><span>${esc(l.externalId||'No learner ID')}</span></span></label>`).join(''):'<div class="samos-empty"><strong>Everyone is already assigned</strong><p>There are no more learners to add.</p></div>';$('#assignDialog').showModal();
  }
  function assignLearners(){const reg=activeRegister();if(!reg)return false;const ids=$$('#assignLearnerList input:checked').map(x=>x.value);if(!ids.length){toast('Choose at least one learner');return false;}const existing=new Set((reg.learners||[]).map(l=>l.id));ids.forEach(id=>{const l=state.learners.find(x=>x.id===id);if(l&&!existing.has(id))reg.learners.push(clone(l));});save();toast(`${ids.length} learner${ids.length===1?'':'s'} added`);return true;}

  function toggleTimer(learnerId){
    const reg=activeRegister();if(!reg)return;const key=todayKey(),t=sessionTimingState(reg,key),now=Date.now();
    if(completedSession(reg,key)){toast('This session is already complete');return;}
    if(t.code==='not-today'){toast(`This register is scheduled for ${reg.day}`);return;}
    if(t.code==='early'){toast(`Timers open at ${formatTime(t.b.open)}`);return;}
    if(t.code==='ended'){finaliseSession(reg,key,true,t.b.end);save();toast('Session ended and attendance saved');return;}
    const a=attendance(reg.id,key);a._meta={...(a._meta||{}),date:key,startedAt:a._meta?.startedAt||now};const rec=a[learnerId]||{intervals:[],runningSince:null};rec.intervals=Array.isArray(rec.intervals)?rec.intervals:[];
    if(rec.runningSince){const end=Math.min(now,t.b.end);if(end>Number(rec.runningSince))rec.intervals.push({start:Number(rec.runningSince),end});rec.runningSince=null;toast('Timer stopped');}
    else{rec.runningSince=now;toast('Timer started');}
    a[learnerId]=rec;save();
  }

  function finishRegister(){
    const reg=activeRegister();if(!reg||completedSession(reg,todayKey()))return;
    if(!confirm('Finish this session now? All running learner timers will stop and attendance will be saved.'))return;
    finaliseSession(reg,todayKey(),false,Date.now());save();toast('Session finished · attendance saved to learner profiles');
  }

  function manageTicker(){
    const key=todayKey(),current=activeRegister();
    const pending=state.classes.filter(reg=>{
      if(completedSession(reg,key))return false;
      const a=state.attendance[attendanceKey(reg.id,key)];
      return Boolean(a?._meta?.startedAt);
    });
    const needed=Boolean(pending.length)||(state.view==='registers'&&Boolean(current)&&!completedSession(current,key));
    if(needed&&!ticker)ticker=window.setInterval(()=>{
      const now=Date.now();
      let autoSaved=false;
      for(const reg of state.classes){
        if(completedSession(reg,key))continue;
        const a=state.attendance[attendanceKey(reg.id,key)];
        if(!a?._meta?.startedAt)continue;
        const bounds=sessionBounds(reg,key);
        if(now>=bounds.end){finaliseSession(reg,key,true,bounds.end);autoSaved=true;}
      }
      if(autoSaved)toast('Session ended · attendance saved');
      if(state.view==='registers'&&activeRegister())renderRegisterWorkspace(activeRegister());
      manageTicker();
    },1000);
    if(!needed&&ticker){clearInterval(ticker);ticker=0;}
  }

  /* ---------------- Resources / profile ---------------- */
  function openResourceDialog(type='lesson-plan'){$('#resourceTypeInput').value=type;$('#resourceTitleInput').value='';$('#resourceNotesInput').value='';$('#resourceDialog').showModal();setTimeout(()=>$('#resourceTitleInput').focus(),60);}
  function saveResource(){const title=$('#resourceTitleInput').value.trim();if(!title)return false;const type=$('#resourceTypeInput').value;state.resources.push({id:uid(),type,title,notes:$('#resourceNotesInput').value.trim(),kind:'created',createdAt:new Date().toISOString()});state.resourceFilter=type;save(false);toast('Resource saved');if(overlay.classList.contains('open')){closeAssistant();state.view='resources';}render();return true;}
  function detectType(file){return /\.(ppt|pptx)$/i.test(file?.name||'')?'powerpoint':'other';}
  function openResourceDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(RESOURCE_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(RESOURCE_STORE))db.createObjectStore(RESOURCE_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function putFile(id,file){const db=await openResourceDb();await new Promise((resolve,reject)=>{const tx=db.transaction(RESOURCE_STORE,'readwrite');tx.objectStore(RESOURCE_STORE).put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();}
  async function getFile(id){const db=await openResourceDb();const blob=await new Promise((resolve,reject)=>{const tx=db.transaction(RESOURCE_STORE,'readonly'),req=tx.objectStore(RESOURCE_STORE).get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)});db.close();return blob;}
  async function removeFile(id){try{const db=await openResourceDb();await new Promise((resolve,reject)=>{const tx=db.transaction(RESOURCE_STORE,'readwrite');tx.objectStore(RESOURCE_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();}catch(_){}}
  async function importResource(file){if(!file)return;const id=uid(),type=detectType(file);try{await putFile(id,file);state.resources.push({id,type,title:file.name.replace(/\.[^.]+$/,''),kind:'upload',fileName:file.name,mime:file.type||'',size:file.size||0,createdAt:new Date().toISOString()});state.resourceFilter=type;save(false);toast('Resource uploaded');if(overlay.classList.contains('open'))closeAssistant();state.view='resources';render();}catch(_){toast('This file could not be saved on this device');}$('#resourceFileInput').value='';}
  async function openResource(id){const r=state.resources.find(x=>x.id===id);if(!r)return;try{const blob=await getFile(id);if(!blob){toast('Stored file could not be found');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.fileName||r.title||'resource';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}catch(_){toast('Resource could not be opened');}}
  async function deleteResource(id){const r=state.resources.find(x=>x.id===id);if(!r||!confirm(`Delete ${r.title}?`))return;state.resources=state.resources.filter(x=>x.id!==id);save();if(r.kind==='upload')await removeFile(id);toast('Resource deleted');}
  function openProfile(){$('#teacherNameInput').value=state.settings.teacherName||'';$('#centreInput').value=state.settings.centre||'';$('#profileDialog').showModal();}
  function saveProfile(){state.settings.teacherName=$('#teacherNameInput').value.trim();state.settings.centre=$('#centreInput').value.trim();save(false);toast('Profile saved');return true;}

  /* ---------------- Events ---------------- */
  app.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-home-back'))return goHome();
    if(b.dataset.homeMetric)return openAssistant(b.dataset.homeMetric);
    if(b.hasAttribute('data-add-learner'))return openLearnerDialog();
    if(b.dataset.learnerInfo){state.selectedLearnerId=b.dataset.learnerInfo;state.view='learner';save();return;}
    if(b.hasAttribute('data-new-register'))return startRegisterWizard(false);
    if(b.hasAttribute('data-register-list'))return renderRegisterList();
    if(b.dataset.selectRegister){state.activeClassId=b.dataset.selectRegister;save();return;}
    if(b.dataset.openRegister){state.activeClassId=b.dataset.openRegister;state.view='registers';save();return;}
    if(b.hasAttribute('data-edit-register'))return startRegisterWizard(true);
    if(b.hasAttribute('data-assign-learners'))return openAssignDialog();
    if(b.dataset.toggleTimer)return toggleTimer(b.dataset.toggleTimer);
    if(b.hasAttribute('data-finish-register'))return finishRegister();
    if(b.hasAttribute('data-create-resource'))return openResourceDialog();
    if(b.hasAttribute('data-upload-resource'))return $('#resourceFileInput').click();
    if(b.dataset.resourceFilter){state.resourceFilter=b.dataset.resourceFilter;save();return;}
    if(b.hasAttribute('data-open-resource'))return openResource(b.closest('[data-resource-id]')?.dataset.resourceId);
    if(b.hasAttribute('data-delete-resource'))return deleteResource(b.closest('[data-resource-id]')?.dataset.resourceId);
  });

  $('#eviaFace').addEventListener('click',()=>openAssistant('main'));
  $('#samosClose').addEventListener('click',closeAssistant);
  $('#samosBack').addEventListener('click',assistantBack);
  content.addEventListener('input',event=>{if(event.target.id==='assistantLearnerSearch')renderAssistantLearnerResults(event.target.value)});
  content.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.assistant){assistantRoute=b.dataset.assistant;return renderAssistant();}
    if(b.hasAttribute('data-assistant-add-learner'))return openLearnerDialog();
    if(b.dataset.assistantLearner){state.selectedLearnerId=b.dataset.assistantLearner;closeAssistant();state.view='learner';save();return;}
    if(b.hasAttribute('data-register-wizard-next')){if(validateWizardStep()){registerWizardStep=Math.min(5,registerWizardStep+1);renderRegisterWizard();}return;}
    if(b.hasAttribute('data-add-wizard-break')){syncRegisterDraft();registerDraft.breaks.push({id:uid(),label:`Break ${registerDraft.breaks.length+1}`,start:'',end:''});renderRegisterWizard();return;}
    if(b.dataset.removeWizardBreak!==undefined){syncRegisterDraft();registerDraft.breaks.splice(Number(b.dataset.removeWizardBreak),1);renderRegisterWizard();return;}
    if(b.hasAttribute('data-save-register-wizard'))return saveRegisterWizard();
    if(b.hasAttribute('data-delete-register-wizard'))return deleteRegisterWizard();
    if(b.dataset.assistantAction){
      const a=b.dataset.assistantAction;
      if(a==='registers:today'){closeAssistant();state.view='registers';selectUsefulRegister();save();}
      else if(a==='registers:list'){closeAssistant();renderRegisterList();}
      else if(a==='registers:create')startRegisterWizard(false);
      else if(a==='resources:powerpoints'){closeAssistant();state.view='resources';state.resourceFilter='powerpoint';save();}
      else if(a==='resources:lessons'){closeAssistant();state.view='resources';state.resourceFilter='lesson-plan';save();}
      else if(a==='resources:upload')$('#resourceFileInput').click();
      else if(a==='resources:create')openResourceDialog('lesson-plan');
      return;
    }
    if(b.hasAttribute('data-assistant-open-games')){closeAssistant();state.view='games';save();}
  });

  $('#learnerForm').addEventListener('submit',e=>{if(!saveLearner())e.preventDefault()});
  $('#assignForm').addEventListener('submit',e=>{if(!assignLearners())e.preventDefault()});
  $('#resourceForm').addEventListener('submit',e=>{if(!saveResource())e.preventDefault()});
  $('#profileForm').addEventListener('submit',e=>{if(!saveProfile())e.preventDefault()});
  $('#resourceFileInput').addEventListener('change',e=>importResource(e.target.files?.[0]));
  $('#profileButton').addEventListener('click',openProfile);
  $('#helpButton').addEventListener('click',()=>openAssistant('main'));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){reconcileEndedSessions();render();}});
  window.addEventListener('focus',()=>{reconcileEndedSessions();if(state.view==='registers')render();});

  /* PWA update/cache reset on every build. */
  async function clearOldShellCaches(){if(!('caches' in window))return;const keys=await caches.keys();await Promise.all(keys.filter(k=>/^samos-/i.test(k)&&k!==`samos-${BUILD}`).map(k=>caches.delete(k)));}
  async function shellRefresh(){try{const previous=localStorage.getItem(SHELL_BUILD_KEY);if(previous!==BUILD){await clearOldShellCaches();localStorage.setItem(SHELL_BUILD_KEY,BUILD);if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration();await reg?.update?.();}}}catch(_){}}
  if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register(`./service-worker.js?v=${BUILD}`).then(reg=>reg.update()).catch(()=>{});
  shellRefresh();
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installApp').hidden=false;});
  $('#installApp').addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice.catch(()=>{});installPrompt=null;$('#installApp').hidden=true;});
  window.addEventListener('appinstalled',()=>{$('#installApp').hidden=true;installPrompt=null;});

  window.EviaAnimations?.init?.($('#eviaFace'));
  window.SamosApp={
    build:BUILD,getState:()=>clone(state),goHome,openAssistantMenu:()=>openAssistant('main'),
    openLearners:()=>{state.view='learners';save()},openRegisters:()=>{state.view='registers';selectUsefulRegister();save()},openResources:()=>{state.view='resources';save()},
    clearOldShellCaches,learnerAttendanceStats,scheduledMs,finaliseSession
  };

  reconcileEndedSessions();
  render();
})();
