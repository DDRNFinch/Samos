(() => {
  'use strict';

  const BUILD = window.SAMOS_BUILD || '0.14.0';
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
    courses:[],
    view:'home',
    selectedLearnerId:null,
    selectedResourceId:null,
    selectedCourseId:null,
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
  let quizDraft=null,quizWizardStep=1,quizEditIndex=null;
  let presentationDraft=null,presentationWizardStep=1,presentationEditIndex=null,presentationPendingImage=null;
  let courseDraft=null,courseWizardStep=1,courseImportedText='';
  let lessonDraft=null,lessonWizardStep=1;
  let playerState=null,presenterTimer=0,qrScanStream=null,qrScanTimer=0;
  let shareContext=null;

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
      courses:Array.isArray(saved.courses)?saved.courses:[],
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
    const resources=Math.min(100,[kinds.has('powerpoint')||kinds.has('presentation'),kinds.has('lesson-plan'),kinds.has('quiz'),kinds.has('sow')||state.courses.length].filter(Boolean).length*25);
    const games=Math.min(100,state.resources.filter(r=>r.type==='quiz').length*20);
    return{learners,registers,resources,games};
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
    else if(state.view==='resource')renderResourceDetail();
    else if(state.view==='courses')renderCoursesPage();
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
    const rows=state.resources.filter(r=>filter==='all'||(filter==='presentation'?(r.type==='presentation'||r.type==='powerpoint'):r.type===filter)).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    app.innerHTML=`${breadcrumb('Resources','TEACHING')}<div class="inline-actions"><button class="blue-button" type="button" data-create-resource>+ Create</button><button class="soft-button" type="button" data-import-samos>Import / Upload</button></div><div class="resource-filter"><button class="${filter==='all'?'active':''}" data-resource-filter="all">All</button><button class="${filter==='presentation'?'active':''}" data-resource-filter="presentation">Presentations</button><button class="${filter==='lesson-plan'?'active':''}" data-resource-filter="lesson-plan">Lesson plans</button><button class="${filter==='quiz'?'active':''}" data-resource-filter="quiz">Quizzes</button><button class="${filter==='sow'?'active':''}" data-resource-filter="sow">SOW</button><button class="${filter==='other'?'active':''}" data-resource-filter="other">Other</button></div><section class="staff-card"><div class="samos-section-head"><h2>Resource library</h2><small>${rows.length} shown</small></div>${rows.length?rows.map(resourceRow).join(''):'<div class="samos-empty"><strong>No resources here yet</strong><p>Create a lesson, presentation or quiz, or import a Samos resource.</p></div>'}</section><section class="staff-card"><div class="samos-section-head"><h2>Official courses</h2><small>${state.courses.length} uploaded</small></div>${state.courses.length?state.courses.slice(0,5).map(c=>`<button class="samos-row" type="button" data-open-course="${attr(c.id)}"><span><strong>${esc(c.name)}</strong><small>${esc([c.code,c.version].filter(Boolean).join(' · ')||'Course')}</small><em>${c.ksbs?.length||0} KSBs · ${c.plan?.totalSessions||0} planned sessions</em></span><b>›</b></button>`).join(''):'<div class="samos-empty compact-empty"><strong>No official course uploaded</strong><p>Upload KSB wording and Samos can build the SOW and lesson structure.</p></div>'}<button class="soft-button full" type="button" data-add-course>+ Upload official course</button></section>`;
  }

  function resourceLabel(r){return r.type==='presentation'?'Samos presentation':r.type==='powerpoint'?'PowerPoint':r.type==='lesson-plan'?'Lesson plan':r.type==='quiz'?'Quiz':r.type==='sow'?'Scheme of Work':'Resource';}

  function resourceRow(r){
    const extra=r.type==='quiz'?`${r.questions?.length||0} questions`:r.type==='presentation'?`${r.slides?.length||0} slides`:r.type==='lesson-plan'?(r.linkedKSBs?.length?`${r.linkedKSBs.length} KSB${r.linkedKSBs.length===1?'':'s'} linked`:'No KSB links'):r.type==='sow'?`${r.lessonPlanIds?.length||0} sessions`:r.kind==='upload'?esc(r.fileName||'Uploaded file'):'Created in Samos';
    return `<div class="samos-row resource-rich-row" data-resource-id="${attr(r.id)}"><button class="resource-main" type="button" data-view-resource="${attr(r.id)}"><span><strong>${esc(r.title)}</strong><small>${esc(resourceLabel(r))} · ${esc(extra)}</small>${r.notes?`<em>${esc(String(r.notes).slice(0,90))}</em>`:''}</span></button><div class="row-actions">${r.type==='quiz'?'<button type="button" class="text-button" data-play-quiz>Play</button>':''}${r.type==='presentation'?'<button type="button" class="text-button" data-play-presentation>Play</button>':''}${r.kind==='upload'?'<button type="button" class="text-button" data-open-resource>Open</button>':''}<button type="button" class="text-button" data-share-resource>Share</button><button type="button" class="danger-text" data-delete-resource>Delete</button></div></div>`;
  }

  function renderGamesPage(){
    setHomeMode(false);const quizzes=state.resources.filter(r=>r.type==='quiz').sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    app.innerHTML=`${breadcrumb('Games','ACTIVITIES')}<div class="inline-actions"><button class="blue-button" type="button" data-create-quiz>+ Create quiz</button><button class="soft-button" type="button" data-import-samos>Import quiz</button></div><section class="staff-card"><div class="samos-section-head"><h2>Quizzes</h2><small>${quizzes.length} saved</small></div>${quizzes.length?quizzes.map(resourceRow).join(''):'<div class="empty-state"><strong>No quizzes yet</strong><p>Samos can guide you through creating one question at a time.</p></div>'}</section>`;
  }

  function goHome(){state.view='home';save();window.scrollTo({top:0,behavior:'auto'});}

  /* ---------------- Assistant ---------------- */
  function copy(title,sub){prompt.textContent=title;hint.textContent=sub;}
  function stabiliseAssistantFace(){
    overlay.scrollTop=0;
    const face=overlay.querySelector('.evia-stage .evia-face');
    if(!face)return;
    try{face.getAnimations?.().forEach(animation=>animation.cancel());}catch(_){}
    face.style.transform='none';
  }
  function openAssistant(route='main'){
    if(assistantCloseFrame){cancelAnimationFrame(assistantCloseFrame);assistantCloseFrame=0;}
    overlay.classList.remove('samos-closing');assistantRoute=route;assistantReturn='main';
    document.body.classList.add('evia-open');
    overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');
    window.EviaAnimations?.setBusy?.(true);renderAssistant();stabiliseAssistantFace();$('#samosClose')?.focus();
  }
  function closeAssistant(){
    if(!overlay.classList.contains('open')){overlay.classList.remove('samos-closing');document.body.classList.remove('evia-open');window.EviaAnimations?.setBusy?.(false);assistantRoute='main';return;}
    if(assistantCloseFrame){cancelAnimationFrame(assistantCloseFrame);assistantCloseFrame=0;}
    window.EviaAnimations?.setBusy?.(true);overlay.classList.add('samos-closing');overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true');document.body.classList.remove('evia-open');assistantRoute='main';registerDraft=null;registerWizardStep=1;quizDraft=null;quizWizardStep=1;quizEditIndex=null;presentationDraft=null;presentationWizardStep=1;presentationEditIndex=null;presentationPendingImage=null;courseDraft=null;courseWizardStep=1;lessonDraft=null;lessonWizardStep=1;
    assistantCloseFrame=requestAnimationFrame(()=>{assistantCloseFrame=0;overlay.classList.remove('samos-closing');window.EviaAnimations?.setBusy?.(false);});
  }
  function assistantBack(){
    if(assistantRoute==='register:wizard'){
      syncRegisterDraft();
      if(registerWizardStep>1){registerWizardStep--;return renderRegisterWizard();}
      registerDraft=null;return assistantRegisters();
    }
    if(assistantRoute==='quiz:wizard'){
      syncQuizDraft();
      if(quizWizardStep===4){quizWizardStep=3;return renderQuizWizard();}
      if(quizWizardStep>1){quizWizardStep--;return renderQuizWizard();}
      quizDraft=null;return assistantGames();
    }
    if(assistantRoute==='presentation:wizard'){
      syncPresentationDraft();
      if(presentationWizardStep===3){presentationWizardStep=2;return renderPresentationWizard();}
      if(presentationWizardStep>1){presentationWizardStep--;return renderPresentationWizard();}
      presentationDraft=null;return assistantResources();
    }
    if(assistantRoute==='course:wizard'){
      syncCourseDraft();
      if(courseWizardStep>1){courseWizardStep--;return renderCourseWizard();}
      courseDraft=null;return assistantResources();
    }
    if(assistantRoute==='lesson:wizard'){
      syncLessonDraft();
      if(lessonWizardStep>1){lessonWizardStep--;return renderLessonWizard();}
      lessonDraft=null;return assistantResources();
    }
    if(assistantRoute==='main')return closeAssistant();
    if(assistantRoute.startsWith('learners:'))return assistantLearners();
    if(assistantRoute.startsWith('registers:'))return assistantRegisters();
    if(assistantRoute.startsWith('resources:'))return assistantResources();
    if(assistantRoute.startsWith('games:'))return assistantGames();
    assistantRoute='main';renderAssistant();
  }
  function renderAssistant(){
    overlay.scrollTop=0;
    if(assistantRoute==='main')assistantMain();
    else if(assistantRoute==='learners')assistantLearners();
    else if(assistantRoute==='registers')assistantRegisters();
    else if(assistantRoute==='resources')assistantResources();
    else if(assistantRoute==='resources:create')assistantCreateResource();
    else if(assistantRoute==='resources:import')assistantImportMenu();
    else if(assistantRoute==='games')assistantGames();
    else if(assistantRoute==='register:wizard')renderRegisterWizard();
    else if(assistantRoute==='quiz:wizard')renderQuizWizard();
    else if(assistantRoute==='presentation:wizard')renderPresentationWizard();
    else if(assistantRoute==='course:wizard')renderCourseWizard();
    else if(assistantRoute==='lesson:wizard')renderLessonWizard();
    else assistantMain();
    stabiliseAssistantFace();
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
  function assistantResources(){assistantRoute='resources';copy('Resources','Courses, lesson plans, presentations, quizzes and files.');content.innerHTML=`<div class="ta-menu"><button data-assistant-action="resources:courses"><strong>Official courses & SOW</strong><span>${state.courses.length} course${state.courses.length===1?'':'s'} uploaded.</span></button><button data-assistant-action="resources:presentations"><strong>Presentations</strong><span>Build Samos-led slides with an image box and short text.</span></button><button data-assistant-action="resources:lessons"><strong>Lesson plans</strong><span>Open or create editable lesson plans with KSB links.</span></button><button data-assistant-action="resources:quizzes"><strong>Quizzes</strong><span>Create, reuse and share classroom quizzes.</span></button><button data-assistant-action="resources:import"><strong>Import / upload</strong><span>Import a Samos package or add a normal teaching file.</span></button><button data-assistant-action="resources:create"><strong>Create resource</strong><span>Samos will guide you through it.</span></button></div>`;}
  function assistantImportMenu(){assistantRoute='resources:import';copy('Import / upload','Everything stays on this device.');content.innerHTML=`<div class="ta-menu"><button data-feature-action="scan-samos"><strong>Scan Samos QR</strong><span>Import a small quiz, lesson plan or course package from another Samos.</span></button><button data-feature-action="import-samos-file"><strong>Import .samos file</strong><span>Import larger shared resources, including presentations with images.</span></button><button data-feature-action="upload-normal-file"><strong>Upload normal resource</strong><span>Add a PowerPoint, PDF, document or image to your local library.</span></button></div>`;}
  function assistantCreateResource(){assistantRoute='resources:create';copy('Create resource','What would you like Samos to help you make?');content.innerHTML=`<div class="ta-menu"><button data-assistant-action="create:lesson"><strong>Lesson plan</strong><span>Editable plan with automatic KSB matching.</span></button><button data-assistant-action="create:presentation"><strong>Presentation</strong><span>Image + short text slides controlled by the tutor.</span></button><button data-assistant-action="create:quiz"><strong>Quiz</strong><span>Add questions one at a time and set the correct answer.</span></button><button data-assistant-action="create:course"><strong>Upload official course</strong><span>Add KSB wording, delivery pattern and generate the SOW.</span></button><button data-assistant-action="create:other"><strong>Other resource</strong><span>Create a simple teaching note or upload a file.</span></button></div>`;}
  function assistantGames(){assistantRoute='games';const q=state.resources.filter(r=>r.type==='quiz').length;copy('Games','Offline classroom quizzes and quick checks.');content.innerHTML=`<div class="ta-menu"><button data-assistant-action="games:create-quiz"><strong>Create a quiz</strong><span>Samos guides you through every question.</span></button><button data-assistant-action="games:saved-quizzes"><strong>Saved quizzes</strong><span>${q} quiz${q===1?'':'zes'} ready to reuse.</span></button><button data-assistant-action="games:import-result"><strong>Import learner result</strong><span>Scan or paste a result QR if you choose to record a fun quiz score.</span></button></div>`;}

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
  async function deleteResource(id){const r=state.resources.find(x=>x.id===id);if(!r||!confirm(`Delete ${r.title}?`))return;state.resources=state.resources.filter(x=>x.id!==id);if(state.selectedResourceId===id){state.selectedResourceId=null;state.view='resources';}save();if(r.kind==='upload')await removeFile(id);if(r.type==='presentation'){for(const sl of r.slides||[])if(sl.imageKey)await removeFile(sl.imageKey);}toast('Resource deleted');}
  function openProfile(){$('#teacherNameInput').value=state.settings.teacherName||'';$('#centreInput').value=state.settings.centre||'';$('#profileDialog').showModal();setTimeout(()=>$('#teacherNameInput')?.focus(),60);}
  function saveProfile(){state.settings.teacherName=$('#teacherNameInput').value.trim();state.settings.centre=$('#centreInput').value.trim();save(false);toast('Profile saved');return true;}

  /* ---------------- Teaching studio: quizzes, presentations, courses, SOW and KSB links ---------------- */
  const STOPWORDS=new Set('a an and are as at be been being by can could did do does for from had has have he her hers him his how i if in into is it its may might more most must my no not of on one or our ours out over should so some than that the their them then there these they this those through to too under up us very was we were what when where which who why will with would you your relevant appropriate including using use used working work requirements requirement required able demonstrate understand understanding know knowledge skill skills behaviour behaviours method methods process processes'.split(/\s+/));
  const LETTERS=['A','B','C','D'];
  const nowIso=()=>new Date().toISOString();
  function words(text){return String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(w=>w.length>2&&!STOPWORDS.has(w)).map(stemWord);}
  function stemWord(w){if(w.length>6&&w.endsWith('ing'))w=w.slice(0,-3);else if(w.length>5&&w.endsWith('ied'))w=w.slice(0,-3)+'y';else if(w.length>5&&w.endsWith('ed'))w=w.slice(0,-2);else if(w.length>5&&w.endsWith('es'))w=w.slice(0,-2);else if(w.length>4&&w.endsWith('s'))w=w.slice(0,-1);return w;}
  function ksbMatchPercent(lessonText,ksbText){const target=[...new Set(words(ksbText))],hay=new Set(words(lessonText));if(!target.length)return 0;const matched=target.filter(w=>hay.has(w)).length;return Math.round(matched/target.length*100);}
  function allCourseKsbs(courseId=null){const courses=courseId?state.courses.filter(c=>c.id===courseId):state.courses;return courses.flatMap(c=>(c.ksbs||[]).map(k=>({...k,courseId:c.id,courseName:c.name})));}
  function findKsb(courseId,code){return state.courses.find(c=>c.id===courseId)?.ksbs?.find(k=>k.code===code)||null;}
  function shortText(text,n=64){const s=String(text||'').trim();return s.length>n?s.slice(0,n-1).trimEnd()+'…':s;}
  function safeFileName(name,ext=''){const base=String(name||'Samos').replace(/[^a-z0-9 _-]+/gi,'').trim().replace(/\s+/g,'-')||'Samos';return base+ext;}
  function downloadBlob(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1800);}
  async function shareOrDownloadFile(blob,name,title='Samos resource'){
    try{
      const file=new File([blob],name,{type:blob.type||'application/octet-stream'});
      if(navigator.share&&navigator.canShare?.({files:[file]})){
        try{await navigator.share({title,files:[file]});return 'shared';}
        catch(err){if(err?.name==='AbortError')return 'cancelled';}
      }
    }catch(_){ }
    downloadBlob(blob,name);return 'downloaded';
  }
  function toB64Utf8(text){const bytes=new TextEncoder().encode(String(text));let bin='';for(const b of bytes)bin+=String.fromCharCode(b);return btoa(bin);}
  function fromB64Utf8(text){const bin=atob(String(text));const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes);}
  function randomShuffle(items){const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

  function startQuizWizard(id=null){
    const existing=id?state.resources.find(r=>r.id===id&&r.type==='quiz'):null;
    quizDraft=existing?clone(existing):{id:uid(),type:'quiz',title:'',quizType:'multiple-choice',questions:[],results:[],createdAt:nowIso(),kind:'created'};
    quizDraft.edit=Boolean(existing);quizWizardStep=1;quizEditIndex=null;
    if(!overlay.classList.contains('open'))openAssistant('quiz:wizard');else{assistantRoute='quiz:wizard';renderQuizWizard();}
  }
  function quizProgress(){return `<div class="wizard-progress"><span style="width:${quizWizardStep/4*100}%"></span></div>`;}
  function emptyQuizQuestion(){return{type:quizDraft?.quizType==='true-false'?'true-false':'multiple-choice',text:'',answers:quizDraft?.quizType==='true-false'?['True','False','','']:['','','',''],correct:0};}
  function syncQuizDraft(){
    if(!quizDraft)return;
    if(quizWizardStep===1)quizDraft.title=$('#quizNameInput')?.value.trim()??quizDraft.title;
    if(quizWizardStep===2){const active=content.querySelector('[data-quiz-type].active');if(active)quizDraft.quizType=active.dataset.quizType;}
  }
  function currentQuestionFromEditor(){
    const mixedType=$('#quizQuestionType')?.value||((quizDraft?.quizType==='true-false')?'true-false':'multiple-choice');
    const text=$('#quizQuestionText')?.value.trim()||'';let answers=[];
    if(mixedType==='true-false')answers=['True','False','',''];else answers=LETTERS.map((_,i)=>$(`#quizAnswer${i}`)?.value.trim()||'');
    const correct=Number(content.querySelector('input[name="quizCorrect"]:checked')?.value||0);
    return{type:mixedType,text,answers,correct};
  }
  function renderQuizWizard(){
    assistantRoute='quiz:wizard';if(!quizDraft)return assistantGames();const d=quizDraft;
    if(quizWizardStep===1){copy(d.edit?'Edit quiz':'Create a quiz','Step 1 of 4 · Give the quiz a name');content.innerHTML=`${quizProgress()}<div class="ta-card"><label class="ta-field"><span>Quiz name</span><input id="quizNameInput" value="${attr(d.title)}" maxlength="80" placeholder="e.g. Cavity wall recap" autocomplete="off"></label><div class="ta-actions"><button class="primary" type="button" data-quiz-next>Next</button></div></div>`;setTimeout(()=>$('#quizNameInput')?.focus(),40);return;}
    if(quizWizardStep===2){copy('Choose quiz type','Step 2 of 4 · You can still mix question types later');content.innerHTML=`${quizProgress()}<div class="ta-card"><div class="quiz-type-picks">${[['multiple-choice','Multiple choice','A, B, C or D'],['true-false','True / False','Two simple choices'],['mixed','Mixed quiz','Choose per question']].map(([v,t,s])=>`<button type="button" data-quiz-type="${v}" class="${d.quizType===v?'active':''}"><strong>${t}</strong><span>${s}</span></button>`).join('')}</div><div class="ta-actions"><button class="primary" type="button" data-quiz-next>Start questions</button></div></div>`;return;}
    if(quizWizardStep===3){
      const q=quizEditIndex!=null?(d.questions[quizEditIndex]||emptyQuizQuestion()):emptyQuizQuestion(),number=quizEditIndex!=null?quizEditIndex+1:d.questions.length+1,mixed=d.quizType==='mixed',type=q.type||'multiple-choice',tf=type==='true-false';copy(`Question ${number}`,quizEditIndex!=null?'Edit the question, answers and correct answer.':'Step 3 of 4 · Add the question, answers and correct answer');
      content.innerHTML=`${quizProgress()}<div class="ta-card">${mixed?`<label class="ta-field"><span>Question type</span><select id="quizQuestionType"><option value="multiple-choice" ${type==='multiple-choice'?'selected':''}>Multiple choice</option><option value="true-false" ${type==='true-false'?'selected':''}>True / False</option></select></label>`:''}<label class="ta-field"><span>Question</span><textarea id="quizQuestionText" rows="3" placeholder="Write the question">${esc(q.text)}</textarea></label><div id="quizAnswerEditor" class="quiz-answer-editor">${renderQuizAnswerEditor(q)}</div><div class="wizard-note"><strong>Correct answer</strong><span>Select the circle beside the answer that Samos should mark as correct.</span></div><div class="ta-actions"><button class="primary" type="button" data-quiz-save-question="another">${quizEditIndex!=null?'Save question':'Add question'}${quizEditIndex==null?' + another':''}</button><button type="button" data-quiz-save-question="finish">${quizEditIndex!=null?'Save & review':'Add & finish'}</button></div></div>`;return;
    }
    copy('Review quiz','Step 4 of 4 · Check everything before saving');content.innerHTML=`${quizProgress()}<div class="ta-card"><div class="section-title"><div><h2>${esc(d.title||'Untitled quiz')}</h2><small>${d.questions.length} question${d.questions.length===1?'':'s'} · ${esc(d.quizType.replace('-',' '))}</small></div></div><div class="quiz-question-list">${d.questions.map((q,i)=>quizReviewItem(q,i)).join('')}</div><div class="ta-actions"><button class="primary" type="button" data-save-quiz>${d.edit?'Save changes':'Save quiz'}</button><button type="button" data-quiz-add-more>+ Add question</button></div></div>`;
  }
  function renderQuizAnswerEditor(q){const tf=(q.type||'multiple-choice')==='true-false',answers=tf?['True','False']:LETTERS.map((_,i)=>q.answers?.[i]||'');return answers.map((ans,i)=>`<label class="quiz-answer-line"><input type="radio" name="quizCorrect" value="${i}" ${Number(q.correct)===i?'checked':''}><span><b>${LETTERS[i]}</b><input id="quizAnswer${i}" type="text" value="${attr(ans)}" ${tf?'readonly':''} placeholder="Answer ${LETTERS[i]}"></span></label>`).join('');}
  function quizReviewItem(q,i,all=[]){const total=Array.isArray(all)&&all.length?all.length:(quizDraft?.questions?.length||0);return `<div class="quiz-review-item"><header><span><small>QUESTION ${i+1}</small><strong>${esc(q.text)}</strong></span><div class="review-mini-actions"><button class="text-button" type="button" data-move-quiz-question="up" data-index="${i}" ${i<=0?'disabled':''}>↑</button><button class="text-button" type="button" data-move-quiz-question="down" data-index="${i}" ${total&&i>=total-1?'disabled':''}>↓</button><button class="text-button" type="button" data-edit-quiz-question="${i}">Edit</button><button class="danger-text" type="button" data-delete-quiz-question="${i}">Delete</button></div></header><div class="quiz-answer-preview">${q.answers.filter(Boolean).map((a,j)=>`<span class="${j===Number(q.correct)?'correct':''}">${LETTERS[j]}. ${esc(a)}</span>`).join('')}</div></div>`;}
  function validateQuizStep(){syncQuizDraft();if(quizWizardStep===1&&!quizDraft.title){toast('Add a quiz name');return false;}return true;}
  function saveQuizQuestion(mode){
    if(!quizDraft)return;const q=currentQuestionFromEditor();if(!q.text){toast('Add the question');return;}const usable=q.type==='true-false'?q.answers.slice(0,2):q.answers;if(usable.some(a=>!a)){toast('Add all answers');return;}if(q.correct<0||q.correct>=usable.length){toast('Choose the correct answer');return;}
    if(quizEditIndex!=null){quizDraft.questions[quizEditIndex]=q;quizEditIndex=null;}else quizDraft.questions.push(q);
    if(mode==='finish'){quizWizardStep=4;renderQuizWizard();}else{quizWizardStep=3;renderQuizWizard();}
  }
  function saveQuizWizard(){if(!quizDraft?.questions?.length){toast('Add at least one question');return;}const item={...quizDraft,edit:undefined,updatedAt:nowIso()};const i=state.resources.findIndex(r=>r.id===item.id);if(i>=0)state.resources[i]=item;else state.resources.push(item);state.resourceFilter='quiz';save(false);toast('Quiz saved');closeAssistant();state.view='resource';state.selectedResourceId=item.id;render();}
  function quizLearnerPayload(q){return `SQ1:${JSON.stringify({v:1,id:q.id,t:q.title,n:q.questions.length,a:q.questions.map(x=>LETTERS[Number(x.correct)||0]).join('')})}`;}

  function startPresentationWizard(id=null,prefill=null){
    const existing=id?state.resources.find(r=>r.id===id&&r.type==='presentation'):null;
    presentationDraft=existing?clone(existing):(prefill?{...clone(prefill),id:prefill.id||uid(),type:'presentation',kind:'created',createdAt:prefill.createdAt||nowIso()}:{id:uid(),type:'presentation',title:'',courseId:'',slides:[],kind:'created',createdAt:nowIso()});
    presentationDraft.edit=Boolean(existing);presentationWizardStep=1;presentationEditIndex=null;presentationPendingImage=null;
    if(!overlay.classList.contains('open'))openAssistant('presentation:wizard');else{assistantRoute='presentation:wizard';renderPresentationWizard();}
  }
  function presentationProgress(){return `<div class="wizard-progress"><span style="width:${presentationWizardStep/3*100}%"></span></div>`;}
  function syncPresentationDraft(){if(!presentationDraft)return;if(presentationWizardStep===1){presentationDraft.title=$('#presentationNameInput')?.value.trim()??presentationDraft.title;presentationDraft.courseId=$('#presentationCourseInput')?.value||presentationDraft.courseId;}}
  function currentSlideDraft(){const existing=presentationEditIndex!=null?presentationDraft.slides[presentationEditIndex]:null;return{id:existing?.id||uid(),title:$('#slideTitleInput')?.value.trim()||'',text:$('#slideTextInput')?.value.trim()||'',imageKey:existing?.imageKey||'',imageName:existing?.imageName||'',imageType:existing?.imageType||''};}
  function renderPresentationWizard(){
    assistantRoute='presentation:wizard';if(!presentationDraft)return assistantResources();const d=presentationDraft;
    if(presentationWizardStep===1){copy(d.edit?'Edit presentation':'Create presentation','Step 1 of 3 · Set up the presentation');content.innerHTML=`${presentationProgress()}<div class="ta-card"><label class="ta-field"><span>Presentation name</span><input id="presentationNameInput" value="${attr(d.title)}" maxlength="90" placeholder="e.g. Cavity wall construction"></label><label class="ta-field"><span>Linked official course (optional)</span><select id="presentationCourseInput"><option value="">No course link</option>${state.courses.map(c=>`<option value="${attr(c.id)}" ${c.id===d.courseId?'selected':''}>${esc(c.name)}${c.code?` · ${esc(c.code)}`:''}</option>`).join('')}</select></label><div class="wizard-note"><strong>Samos presentation</strong><span>Each slide has a title, an image box and short sentences. The tutor controls every slide with Next and Back.</span></div><div class="ta-actions"><button class="primary" type="button" data-presentation-next>${d.slides.length?'Review slides':'Add first slide'}</button></div></div>`;return;}
    if(presentationWizardStep===2){const current=presentationEditIndex!=null?d.slides[presentationEditIndex]:null,number=presentationEditIndex!=null?presentationEditIndex+1:d.slides.length+1;copy(`Slide ${number}`,presentationEditIndex!=null?'Edit this slide.':'Step 2 of 3 · Add an image and short teaching sentences');content.innerHTML=`${presentationProgress()}<div class="ta-card"><label class="ta-field"><span>Slide title</span><input id="slideTitleInput" value="${attr(current?.title||'')}" maxlength="120" placeholder="What is this slide about?"></label><div id="presentationImagePreview" class="presentation-image-picker"><button type="button" data-pick-presentation-image>${current?.imageKey?'Loading image…':'Add image (optional)'}</button></div><label class="ta-field"><span>Short sentences</span><textarea id="slideTextInput" rows="7" placeholder="Write one short sentence per line.">${esc(current?.text||'')}</textarea></label><div class="slide-sentence-note"><b>Keep it simple:</b> each non-empty line becomes a separate sentence on the classroom screen.</div><div class="ta-actions"><button class="primary" type="button" data-save-slide="another">${presentationEditIndex!=null?'Save slide':'Add slide + another'}</button><button type="button" data-save-slide="finish">${presentationEditIndex!=null?'Save & review':'Add & finish'}</button></div></div>`;hydratePresentationImagePreview(current?.imageKey);return;}
    copy('Review presentation','Step 3 of 3 · Check slides before saving');content.innerHTML=`${presentationProgress()}<div class="ta-card"><div class="section-title"><div><h2>${esc(d.title||'Untitled presentation')}</h2><small>${d.slides.length} slide${d.slides.length===1?'':'s'}</small></div></div><div class="slide-review-list">${d.slides.map((sl,i)=>`<div class="slide-review-item"><header><span><small>SLIDE ${i+1}</small><strong>${esc(sl.title||'Untitled slide')}</strong></span><div class="review-mini-actions"><button class="text-button" type="button" data-move-slide="up" data-index="${i}" ${i===0?'disabled':''}>↑</button><button class="text-button" type="button" data-move-slide="down" data-index="${i}" ${i===d.slides.length-1?'disabled':''}>↓</button><button class="text-button" type="button" data-edit-slide="${i}">Edit</button><button class="danger-text" type="button" data-delete-slide="${i}">Delete</button></div></header><small>${sl.imageKey?'Image added · ':''}${String(sl.text||'').split(/\n+/).filter(Boolean).length} sentence${String(sl.text||'').split(/\n+/).filter(Boolean).length===1?'':'s'}</small></div>`).join('')}</div><div class="ta-actions"><button class="primary" type="button" data-save-presentation>${d.edit?'Save changes':'Save presentation'}</button><button type="button" data-presentation-add-slide>+ Add slide</button></div></div>`;
  }
  async function hydratePresentationImagePreview(key){const box=$('#presentationImagePreview');if(!box)return;if(presentationPendingImage){const url=URL.createObjectURL(presentationPendingImage);box.innerHTML=`<img src="${url}" alt="Selected slide image"><button class="image-change" type="button" data-pick-presentation-image>Change image</button>`;setTimeout(()=>URL.revokeObjectURL(url),30000);return;}if(!key)return;try{const blob=await getFile(key);if(!blob)return;const url=URL.createObjectURL(blob);if($('#presentationImagePreview')===box)box.innerHTML=`<img src="${url}" alt="Slide image"><button class="image-change" type="button" data-pick-presentation-image>Change image</button>`;setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(_){}}
  async function savePresentationSlide(mode){if(!presentationDraft)return;const sl=currentSlideDraft();if(!sl.title&&!sl.text&&!presentationPendingImage){toast('Add a title, text or image');return;}if(presentationPendingImage){const key=`media:${presentationDraft.id}:${sl.id}`;try{await putFile(key,presentationPendingImage);sl.imageKey=key;sl.imageName=presentationPendingImage.name||'slide-image';sl.imageType=presentationPendingImage.type||'image/jpeg';}catch(_){toast('The image could not be saved');return;}}
    if(presentationEditIndex!=null){presentationDraft.slides[presentationEditIndex]=sl;presentationEditIndex=null;}else presentationDraft.slides.push(sl);presentationPendingImage=null;
    if(mode==='finish'){presentationWizardStep=3;renderPresentationWizard();}else{presentationWizardStep=2;renderPresentationWizard();}
  }
  function savePresentationWizard(){if(!presentationDraft?.title){toast('Add a presentation name');return;}if(!presentationDraft.slides?.length){toast('Add at least one slide');return;}const item={...presentationDraft,edit:undefined,updatedAt:nowIso()};const i=state.resources.findIndex(r=>r.id===item.id);if(i>=0)state.resources[i]=item;else state.resources.push(item);state.resourceFilter='presentation';save(false);toast('Presentation saved');closeAssistant();state.view='resource';state.selectedResourceId=item.id;render();}

  function parseKsbText(text){
    let source=String(text||'').trim();if(!source)return[];
    try{const j=JSON.parse(source);const arr=Array.isArray(j)?j:(Array.isArray(j.ksbs)?j.ksbs:null);if(arr)return arr.map(x=>({code:String(x.code||x.id||'').trim().toUpperCase(),text:String(x.text||x.description||x.wording||'').trim()})).filter(x=>/^[KSB]\d+[A-Z]*$/i.test(x.code)&&x.text); }catch(_){ }
    const out=[];for(const raw of source.split(/\r?\n/)){const line=raw.trim();if(!line)continue;let m=line.match(/^([KSB]\s*\d+[A-Z]*)\s*(?:[-–—:|,;\t]|\s{2,})\s*(.+)$/i);if(!m)m=line.match(/^([KSB]\s*\d+[A-Z]*)\s+(.+)$/i);if(!m)continue;const code=m[1].replace(/\s+/g,'').toUpperCase(),wording=m[2].replace(/^['"]|['"]$/g,'').trim();if(wording)out.push({code,text:wording});}
    const seen=new Set();return out.filter(k=>!seen.has(k.code)&&(seen.add(k.code),true));
  }
  function startCourseWizard(){courseDraft={id:uid(),name:'',code:'',version:'',ksbs:[],sessionsPerWeek:1,sessionHours:6,weeks:100};courseWizardStep=1;courseImportedText='';if(!overlay.classList.contains('open'))openAssistant('course:wizard');else{assistantRoute='course:wizard';renderCourseWizard();}}
  function courseProgress(){return `<div class="wizard-progress"><span style="width:${courseWizardStep/4*100}%"></span></div>`;}
  function syncCourseDraft(){if(!courseDraft)return;if(courseWizardStep===1){courseDraft.name=$('#courseNameInput')?.value.trim()??courseDraft.name;courseDraft.code=$('#courseCodeInput')?.value.trim()??courseDraft.code;courseDraft.version=$('#courseVersionInput')?.value.trim()??courseDraft.version;}if(courseWizardStep===2){const text=$('#courseKsbInput')?.value??courseImportedText;courseImportedText=text;courseDraft.ksbs=parseKsbText(text);}if(courseWizardStep===3){courseDraft.sessionsPerWeek=Math.max(1,Number($('#courseSessionsWeek')?.value)||1);courseDraft.sessionHours=Math.max(.5,Number($('#courseSessionHours')?.value)||6);courseDraft.weeks=Math.max(1,Math.round(Number($('#courseWeeks')?.value)||100));}}
  function courseSessionAssignments(d){const count=Math.max(1,Math.round(d.sessionsPerWeek*d.weeks)),ksbs=d.ksbs||[],rows=Array.from({length:count},(_,i)=>({index:i+1,week:Math.floor(i/d.sessionsPerWeek)+1,ksbCodes:[]}));if(!ksbs.length)return rows;if(count>=ksbs.length){const base=Math.floor(count/ksbs.length),extra=count%ksbs.length;let cursor=0;ksbs.forEach((k,i)=>{const repeats=base+(i<extra?1:0);for(let n=0;n<repeats&&cursor<rows.length;n++)rows[cursor++].ksbCodes=[k.code];});}else{ksbs.forEach((k,i)=>{const slot=Math.min(count-1,Math.floor(i*count/ksbs.length));rows[slot].ksbCodes.push(k.code);});}return rows;}
  function renderCourseWizard(){
    assistantRoute='course:wizard';if(!courseDraft)return assistantResources();const d=courseDraft;
    if(courseWizardStep===1){copy('Upload official course','Step 1 of 4 · Identify the course');content.innerHTML=`${courseProgress()}<div class="ta-card"><label class="ta-field"><span>Course / standard name</span><input id="courseNameInput" value="${attr(d.name)}" placeholder="e.g. Plumbing & Domestic Heating Technician"></label><div class="ta-row"><label class="ta-field"><span>Course / standard code</span><input id="courseCodeInput" value="${attr(d.code)}" placeholder="Optional"></label><label class="ta-field"><span>Version</span><input id="courseVersionInput" value="${attr(d.version)}" placeholder="Optional"></label></div><div class="wizard-note"><strong>Offline course brain</strong><span>Samos only stores the KSB wording you give it. No internet lookup is used and no other course is downloaded.</span></div><div class="ta-actions"><button class="primary" type="button" data-course-next>Next</button></div></div>`;return;}
    if(courseWizardStep===2){copy('Add the KSBs','Step 2 of 4 · Paste the official wording or choose a local file');content.innerHTML=`${courseProgress()}<div class="ta-card"><label class="ta-field"><span>KSB wording</span><textarea class="ksb-paste" id="courseKsbInput" placeholder="K1 - Official wording...\nK2 - Official wording...\nS1 - Official wording...">${esc(courseImportedText||d.ksbs.map(k=>`${k.code} - ${k.text}`).join('\n'))}</textarea></label><button class="soft-button full" type="button" data-pick-course-file>Choose KSB file</button><div class="wizard-note"><strong>Accepted formats</strong><span>Plain text, CSV, JSON or .samoscourse. Each line can begin K1, S1, B1 etc.</span></div><div class="ta-actions"><button class="primary" type="button" data-course-next>Check KSBs</button></div></div>`;return;}
    if(courseWizardStep===3){const total=Math.max(1,Math.round(d.sessionsPerWeek*d.weeks));copy('Plan the delivery','Step 3 of 4 · Tell Samos how much teaching time you have');content.innerHTML=`${courseProgress()}<div class="ta-card"><div class="ta-row"><label class="ta-field"><span>Sessions each week</span><input id="courseSessionsWeek" type="number" min="1" max="14" step="1" value="${d.sessionsPerWeek}"></label><label class="ta-field"><span>Hours per session</span><input id="courseSessionHours" type="number" min="0.5" max="12" step="0.5" value="${d.sessionHours}"></label></div><label class="ta-field"><span>Teaching weeks</span><input id="courseWeeks" type="number" min="1" max="300" step="1" value="${d.weeks}"></label><div class="course-summary-grid"><div><strong>${d.ksbs.length}</strong><span>KSBs</span></div><div><strong id="courseTotalSessions">${total}</strong><span>Sessions</span></div><div><strong id="courseTotalHours">${Math.round(total*d.sessionHours*10)/10}</strong><span>Hours</span></div><div><strong>${d.ksbs.length?Math.round(total/d.ksbs.length*10)/10:'—'}</strong><span>Sessions/KSB</span></div></div><div class="wizard-note"><strong>Initial allocation</strong><span>Samos spreads the KSBs evenly in their uploaded order. The tutor can change the linked KSBs on each lesson afterwards.</span></div><div class="ta-actions"><button class="primary" type="button" data-course-next>Build plan</button></div></div>`;return;}
    const assignments=courseSessionAssignments(d),total=assignments.length;copy('Check the course plan','Step 4 of 4 · Samos will create the SOW and editable lesson plans');content.innerHTML=`${courseProgress()}<div class="ta-card"><div class="course-summary-grid"><div><strong>${d.ksbs.length}</strong><span>KSBs</span></div><div><strong>${total}</strong><span>Sessions</span></div><div><strong>${Math.round(total*d.sessionHours*10)/10}</strong><span>Hours</span></div><div><strong>${d.weeks}</strong><span>Weeks</span></div></div><div class="ksb-preview-list">${d.ksbs.slice(0,12).map(k=>`<div class="ksb-preview-row"><b>${esc(k.code)}</b><span>${esc(k.text)}</span></div>`).join('')}${d.ksbs.length>12?`<div class="v39-empty compact-empty"><span>+ ${d.ksbs.length-12} more KSBs</span></div>`:''}</div><div class="course-plan-preview">${assignments.slice(0,10).map(r=>`<div><b>W${r.week}</b><strong>Session ${r.index}</strong><small>${esc(r.ksbCodes.join(' · '))}</small></div>`).join('')}${total>10?`<div><b>…</b><strong>${total-10} more sessions</strong><small>Generated locally</small></div>`:''}</div><div class="sow-alignment-note"><strong>Scheme of Work:</strong> Samos includes curriculum sequencing, learning outcomes, prior learning, teaching and learner activity, assessment/checks for understanding, inclusion/SEND, safeguarding/Prevent/EDI/wellbeing, English/maths/digital, workplace/employability, resources, health & safety and next learning. The tutor remains in control of all content and KSB links.</div><div class="ta-actions"><button class="primary" type="button" data-save-course>Generate course plan</button></div></div>`;
  }
  function validateCourseStep(){syncCourseDraft();if(courseWizardStep===1&&!courseDraft.name){toast('Add the course name');return false;}if(courseWizardStep===2&&!courseDraft.ksbs.length){toast('I could not find any KSB lines. Start each line with K1, S1 or B1.');return false;}return true;}
  function generatedLessonFields(course,assignment,index,total){const linked=assignment.ksbCodes.map(code=>findKsb(course.id,code)).filter(Boolean),wording=linked.map(k=>`${k.code}: ${k.text}`).join('\n'),topic=linked.length===1?`${linked[0].code} · ${shortText(linked[0].text,72)}`:`${assignment.ksbCodes.join(' + ')} · Combined session`;return{
    topic,
    learningOutcomes:`By the end of this session, learners should be able to explain, demonstrate or apply the requirements described in:\n${wording}`,
    priorLearning:index===0?'Establish prior experience and baseline understanding before introducing the new content.':'Retrieve key learning from the previous session and connect it explicitly to today’s KSB(s).',
    starter:`Retrieval / diagnostic starter: ask learners what they already know about ${linked.map(k=>k.code).join(', ')} and identify any misconceptions.`,
    tutorActivities:`Introduce the session outcome.\nModel or explain the subject-specific knowledge required by the linked KSB wording.\nUse worked examples, questioning and demonstration where appropriate.\nMake quality, safety and professional expectations explicit.`,
    learnerActivities:`Discuss prior knowledge.\nComplete guided practice or a vocational task linked to the KSB(s).\nApply the learning with progressively less support.\nExplain decisions and reflect on quality.`,
    assessment:`Use questioning and checks for understanding during teaching.\nObserve practice or review learner responses against the intended outcome.\nFinish with a short retrieval check / quiz and use the result to plan the next session.`,
    resources:`Add the tools, equipment, drawings, specifications, handouts, images or digital resources required for this subject.`,
    englishMathsDigital:`Identify naturally occurring English, maths and digital skills in the vocational activity and make these explicit where relevant.`,
    inclusion:`Check prior attainment and individual needs. Adapt explanations, task complexity, scaffolds, pace, language, visuals and support without lowering the intended outcome.`,
    safeguarding:`Record any relevant safeguarding, Prevent, equality, diversity, wellbeing or professional-boundary considerations for this session. Do not force a link where none is relevant.`,
    workplace:`Connect the KSB(s) to authentic workplace practice, professional behaviours, employer expectations and progression where relevant.`,
    healthSafety:`Identify the session-specific health, safety and welfare controls required before delivery.`,
    plenary:`Return to the learning outcome. Ask learners to explain what has changed in their understanding and identify one point to retain for next time.`,
    nextLearning:index<total-1?'Use assessment evidence from this session to adapt the next planned session and revisit misconceptions.':'Review overall course coverage and identify consolidation, assessment or progression needs.'
  };}
  function createCoursePlan(){
    if(!courseDraft?.ksbs?.length)return;const course={id:courseDraft.id,name:courseDraft.name,code:courseDraft.code,version:courseDraft.version,ksbs:clone(courseDraft.ksbs),createdAt:nowIso(),plan:{sessionsPerWeek:courseDraft.sessionsPerWeek,sessionHours:courseDraft.sessionHours,weeks:courseDraft.weeks,totalSessions:courseSessionAssignments(courseDraft).length,totalHours:courseSessionAssignments(courseDraft).length*courseDraft.sessionHours},lessonPlanIds:[],sowId:''};state.courses.push(course);
    const assignments=courseSessionAssignments(courseDraft);assignments.forEach((a,i)=>{const fields=generatedLessonFields(course,a,i,assignments.length),id=uid(),links=a.ksbCodes.map(code=>({code,courseId:course.id,percent:100,source:'generated'}));const lp={id,type:'lesson-plan',title:`Week ${a.week} · ${fields.topic}`,kind:'created',createdAt:nowIso(),courseId:course.id,sessionNumber:a.index,week:a.week,durationHours:courseDraft.sessionHours,linkedKSBs:links,fields,notes:`Generated from ${a.ksbCodes.join(', ')}. Tutor editable.`};state.resources.push(lp);course.lessonPlanIds.push(id);});
    const sowId=uid();course.sowId=sowId;state.resources.push({id:sowId,type:'sow',title:`${course.name} · Scheme of Work`,kind:'created',createdAt:nowIso(),courseId:course.id,lessonPlanIds:[...course.lessonPlanIds],notes:'DfE/Ofsted-aligned planning structure. Tutor controlled.'});state.resourceFilter='sow';save(false);toast(`Course plan created · ${assignments.length} sessions`);closeAssistant();state.view='courses';state.selectedCourseId=course.id;render();
  }

  function blankLessonFields(){return{topic:'',learningOutcomes:'',priorLearning:'',starter:'',tutorActivities:'',learnerActivities:'',assessment:'',resources:'',englishMathsDigital:'',inclusion:'',safeguarding:'',workplace:'',healthSafety:'',plenary:'',nextLearning:''};}
  function startLessonWizard(id=null,prefill=null){const existing=id?state.resources.find(r=>r.id===id&&r.type==='lesson-plan'):null;lessonDraft=existing?clone(existing):(prefill?clone(prefill):{id:uid(),type:'lesson-plan',title:'',courseId:'',durationHours:6,fields:blankLessonFields(),linkedKSBs:[],kind:'created',createdAt:nowIso()});lessonDraft.fields={...blankLessonFields(),...(lessonDraft.fields||{})};lessonDraft.edit=Boolean(existing);lessonWizardStep=1;if(!overlay.classList.contains('open'))openAssistant('lesson:wizard');else{assistantRoute='lesson:wizard';renderLessonWizard();}}
  function lessonProgress(){return `<div class="wizard-progress"><span style="width:${lessonWizardStep/3*100}%"></span></div>`;}
  function syncLessonDraft(){if(!lessonDraft)return;const d=lessonDraft;if(lessonWizardStep===1){d.title=$('#lessonTitleInput')?.value.trim()??d.title;d.courseId=$('#lessonCourseInput')?.value||d.courseId;d.durationHours=Math.max(.5,Number($('#lessonDurationInput')?.value)||d.durationHours||6);}if(lessonWizardStep===2){for(const key of Object.keys(blankLessonFields())){const el=$(`[data-lesson-field="${key}"]`);if(el)d.fields[key]=el.value.trim();}}if(lessonWizardStep===3){d.linkedKSBs=$$('[data-lesson-ksb]:checked',content).map(x=>({code:x.dataset.code,courseId:x.dataset.courseId,percent:Number(x.dataset.percent)||0,source:Number(x.dataset.percent)>=50?'auto':'tutor'}));}}
  function lessonText(d=lessonDraft){return [d?.title,...Object.values(d?.fields||{})].join('\n');}
  function lessonMatches(d=lessonDraft){const text=lessonText(d);return allCourseKsbs(d?.courseId||null).map(k=>({...k,percent:ksbMatchPercent(text,k.text)})).sort((a,b)=>b.percent-a.percent||a.code.localeCompare(b.code));}
  function renderLessonWizard(){
    assistantRoute='lesson:wizard';if(!lessonDraft)return assistantResources();const d=lessonDraft;
    if(lessonWizardStep===1){copy(d.edit?'Edit lesson plan':'Create lesson plan','Step 1 of 3 · Set up the session');content.innerHTML=`${lessonProgress()}<div class="ta-card"><label class="ta-field"><span>Lesson title</span><input id="lessonTitleInput" value="${attr(d.title)}" placeholder="e.g. Cavity wall components"></label><div class="ta-row"><label class="ta-field"><span>Official course (optional)</span><select id="lessonCourseInput"><option value="">No course</option>${state.courses.map(c=>`<option value="${attr(c.id)}" ${c.id===d.courseId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="ta-field"><span>Session hours</span><input id="lessonDurationInput" type="number" min="0.5" max="12" step="0.5" value="${d.durationHours||6}"></label></div><div class="ta-actions"><button class="primary" type="button" data-lesson-next>Next</button></div></div>`;return;}
    if(lessonWizardStep===2){copy('Build the lesson','Step 2 of 3 · Everything stays editable');content.innerHTML=`${lessonProgress()}<div class="ta-card lesson-fields">${lessonFieldDetails('topic','Topic / intent',d.fields.topic,true)}${lessonFieldDetails('learningOutcomes','Learning outcomes',d.fields.learningOutcomes,true)}${lessonFieldDetails('priorLearning','Prior learning',d.fields.priorLearning)}${lessonFieldDetails('starter','Starter / retrieval',d.fields.starter)}${lessonFieldDetails('tutorActivities','Tutor activities / modelling',d.fields.tutorActivities,true)}${lessonFieldDetails('learnerActivities','Learner activities / practice',d.fields.learnerActivities,true)}${lessonFieldDetails('assessment','Assessment / checks for understanding',d.fields.assessment,true)}${lessonFieldDetails('resources','Resources',d.fields.resources)}${lessonFieldDetails('englishMathsDigital','English · maths · digital',d.fields.englishMathsDigital)}${lessonFieldDetails('inclusion','Inclusion / SEND / adaptations',d.fields.inclusion)}${lessonFieldDetails('safeguarding','Safeguarding / Prevent / EDI / wellbeing',d.fields.safeguarding)}${lessonFieldDetails('workplace','Workplace / employability / progression',d.fields.workplace)}${lessonFieldDetails('healthSafety','Health & safety',d.fields.healthSafety)}${lessonFieldDetails('plenary','Plenary / recap',d.fields.plenary)}${lessonFieldDetails('nextLearning','Next learning',d.fields.nextLearning)}<div class="ta-actions"><button class="primary" type="button" data-lesson-next>Check KSB matches</button></div></div>`;return;}
    const matches=lessonMatches(d),existing=new Set((d.linkedKSBs||[]).map(x=>`${x.courseId}:${x.code}`));if(!(d._matchesInitialised)){for(const m of matches)if(m.percent>=50)existing.add(`${m.courseId}:${m.code}`);d._matchesInitialised=true;d._autoSelection=[...existing];}
    copy('Check KSB links','Step 3 of 3 · 50%+ wording matches are selected automatically; you decide');content.innerHTML=`${lessonProgress()}<div class="ta-card"><div class="wizard-note"><strong>Automatic matching</strong><span>Samos compares meaningful wording. A KSB at 50% or above is selected automatically, but you can remove it or select any other KSB before saving.</span></div><div class="ksb-match-list">${matches.length?matches.map(m=>{const key=`${m.courseId}:${m.code}`,checked=existing.has(key)||d._autoSelection?.includes(key);return `<label class="ksb-match ${m.percent<50?'weak':''}"><input type="checkbox" data-lesson-ksb data-code="${attr(m.code)}" data-course-id="${attr(m.courseId)}" data-percent="${m.percent}" ${checked?'checked':''}><b>${esc(m.code)}</b><span>${esc(m.text)}</span><em>${m.percent}%</em></label>`}).join(''):'<div class="v39-empty"><strong>No official course loaded</strong><span>You can save the lesson without KSB links.</span></div>'}</div><div class="ta-actions"><button class="primary" type="button" data-save-lesson>${d.edit?'Save changes':'Save lesson plan'}</button></div></div>`;
  }
  function lessonFieldDetails(key,label,value,open=false){return `<details ${open?'open':''}><summary>${label}</summary><label class="ta-field"><textarea data-lesson-field="${key}" rows="4">${esc(value||'')}</textarea></label></details>`;}
  function validateLessonStep(){syncLessonDraft();if(lessonWizardStep===1&&!lessonDraft.title){toast('Add a lesson title');return false;}return true;}
  function saveLessonWizard(){syncLessonDraft();const item={...lessonDraft,edit:undefined,_matchesInitialised:undefined,_autoSelection:undefined,updatedAt:nowIso()};const i=state.resources.findIndex(r=>r.id===item.id);if(i>=0)state.resources[i]=item;else state.resources.push(item);state.resourceFilter='lesson-plan';save(false);toast('Lesson plan saved');closeAssistant();state.view='resource';state.selectedResourceId=item.id;render();}

  function generatePresentationFromLesson(id){const lp=state.resources.find(r=>r.id===id&&r.type==='lesson-plan');if(!lp)return;const course=state.courses.find(c=>c.id===lp.courseId),linked=(lp.linkedKSBs||[]).map(l=>findKsb(l.courseId||lp.courseId,l.code)).filter(Boolean),keywords=[...new Set(linked.flatMap(k=>words(k.text)))].slice(0,8);const slides=[
    {id:uid(),title:lp.title,text:[`Session aim: ${lp.fields?.topic||lp.title}`,linked.length?`Linked KSBs: ${linked.map(k=>k.code).join(', ')}`:''].filter(Boolean).join('\n')},
    {id:uid(),title:'What are we learning?',text:linked.length?linked.map(k=>`${k.code}: ${k.text}`).join('\n'):(lp.fields?.learningOutcomes||'Add the learning outcome.')},
    {id:uid(),title:'Key language',text:keywords.length?keywords.map(k=>k.charAt(0).toUpperCase()+k.slice(1)).join('\n'):'Add the important terms learners need.'},
    {id:uid(),title:'Tutor explanation',text:'Add the subject-specific explanation in short sentences.\nAdd an image or diagram that supports the explanation.'},
    {id:uid(),title:'Demonstration / worked example',text:'Add the key stages of the demonstration.\nKeep each sentence short and reveal the slide when you are ready.'},
    {id:uid(),title:'Check understanding',text:(lp.fields?.assessment||'Ask a focused question.\nCheck for misconceptions.\nDecide what needs revisiting.')},
    {id:uid(),title:'Recap',text:(lp.fields?.plenary||'Return to the learning outcome.\nAsk learners for the key point they will remember.')}
  ].map(s=>({...s,imageKey:'',imageName:'',imageType:''}));startPresentationWizard(null,{id:uid(),type:'presentation',title:lp.title,courseId:course?.id||'',slides,sourceLessonPlanId:lp.id,kind:'created',createdAt:nowIso()});}

  function generateQuizFromLesson(id){const lp=state.resources.find(r=>r.id===id&&r.type==='lesson-plan');if(!lp)return;const course=state.courses.find(c=>c.id===lp.courseId);if(!course){toast('Link this lesson to an official course first');return;}const linked=(lp.linkedKSBs||[]).map(l=>findKsb(l.courseId||lp.courseId,l.code)).filter(Boolean);if(!linked.length){toast('Link at least one KSB first');return;}const questions=[];for(const k of linked.slice(0,5)){const distractors=randomShuffle((course.ksbs||[]).filter(x=>x.code!==k.code)).slice(0,3).map(x=>x.text);const answers=randomShuffle([k.text,...distractors]);while(answers.length<4)answers.push('Tutor to add another plausible answer');questions.push({type:'multiple-choice',text:`Which statement best matches ${k.code}?`,answers,correct:answers.indexOf(k.text)});}const q={id:uid(),type:'quiz',title:`${lp.title} · KSB check`,quizType:'multiple-choice',questions,results:[],sourceLessonPlanId:lp.id,courseId:course.id,kind:'created',createdAt:nowIso()};startQuizWizard(null);quizDraft=q;quizDraft.edit=false;quizWizardStep=4;renderQuizWizard();}

  function renderResourceDetail(){
    setHomeMode(false);const r=state.resources.find(x=>x.id===state.selectedResourceId);if(!r){state.view='resources';return renderResourcesPage();}
    if(r.type==='quiz')return renderQuizDetail(r);if(r.type==='presentation')return renderPresentationDetail(r);if(r.type==='lesson-plan')return renderLessonDetail(r);if(r.type==='sow')return renderSowDetail(r);
    app.innerHTML=`${breadcrumb(r.title,resourceLabel(r).toUpperCase())}<section class="staff-card"><p>${esc(r.notes||'No notes')}</p><div class="inline-actions">${r.kind==='upload'?'<button class="blue-button" data-open-resource>Open file</button>':''}<button class="soft-button" data-share-resource>Share</button></div></section>`;
  }
  function renderQuizDetail(r){const results=Array.isArray(r.results)?r.results:[];app.innerHTML=`${breadcrumb(r.title,'QUIZ')}<section class="staff-card"><div class="course-summary-grid"><div><strong>${r.questions?.length||0}</strong><span>Questions</span></div><div><strong>${esc((r.quizType||'multiple-choice').replace('-',' '))}</strong><span>Type</span></div><div><strong>${results.length}</strong><span>Results saved</span></div><div><strong>Offline</strong><span>Delivery</span></div></div><div class="inline-actions"><button class="blue-button" type="button" data-play-quiz-id="${attr(r.id)}">Start live quiz</button><button class="soft-button" type="button" data-edit-quiz="${attr(r.id)}">Edit</button></div><div class="inline-actions"><button class="soft-button" type="button" data-share-resource-id="${attr(r.id)}">Share</button><button class="soft-button" type="button" data-print-resource-id="${attr(r.id)}">PDF / Print</button></div></section><section class="staff-card"><div class="samos-section-head"><h2>Questions</h2><small>${r.questions?.length||0}</small></div><div class="quiz-question-list">${(r.questions||[]).map(quizReviewItem).join('')}</div></section><section class="staff-card"><div class="samos-section-head"><h2>Optional recorded results</h2><small>${results.length}</small></div>${results.length?results.slice().reverse().map(x=>`<div class="samos-row"><span><strong>${esc(x.learner||'Learner')}</strong><small>${esc(x.dateLabel||new Date(x.receivedAt||Date.now()).toLocaleString('en-GB'))}</small><em>${Number(x.score)||0}/${r.questions.length} · ${Math.round((Number(x.score)||0)/(r.questions.length||1)*100)}%</em></span></div>`).join(''):'<div class="samos-empty compact-empty"><strong>No results recorded</strong><p>Learners can keep scores on their own device. Importing a result is optional.</p></div>'}<button class="soft-button full" type="button" data-import-quiz-result="${attr(r.id)}">Import learner result QR</button></section>`;}
  function renderPresentationDetail(r){app.innerHTML=`${breadcrumb(r.title,'SAMOS PRESENTATION')}<section class="staff-card"><div class="course-summary-grid"><div><strong>${r.slides?.length||0}</strong><span>Slides</span></div><div><strong>${r.slides?.filter(s=>s.imageKey).length||0}</strong><span>Images</span></div><div><strong>Manual</strong><span>Next / Back</span></div><div><strong>Samos</strong><span>Presenter</span></div></div><div class="inline-actions"><button class="blue-button" type="button" data-play-presentation-id="${attr(r.id)}">Present</button><button class="soft-button" type="button" data-edit-presentation="${attr(r.id)}">Edit</button></div><div class="inline-actions"><button class="soft-button" type="button" data-share-resource-id="${attr(r.id)}">Share</button><button class="soft-button" type="button" data-print-resource-id="${attr(r.id)}">PDF / Print</button></div><p class="pdf-note">Live presentation mode animates Samos and the slide content. PDF / Print uses a static Samos mark in the top-right corner.</p></section><section class="staff-card"><div class="samos-section-head"><h2>Slides</h2><small>${r.slides?.length||0}</small></div><div class="slide-review-list">${(r.slides||[]).map((s,i)=>`<div class="slide-review-item"><header><span><small>SLIDE ${i+1}</small><strong>${esc(s.title||'Untitled')}</strong></span></header><small>${s.imageKey?'Image · ':''}${String(s.text||'').split(/\n+/).filter(Boolean).length} sentences</small></div>`).join('')}</div></section>`;}
  function renderLessonDetail(r){const links=r.linkedKSBs||[],blocks=[['topic','Topic / intent'],['learningOutcomes','Learning outcomes'],['priorLearning','Prior learning'],['starter','Starter / retrieval'],['tutorActivities','Tutor activities / modelling'],['learnerActivities','Learner activities / practice'],['assessment','Assessment / checks for understanding'],['resources','Resources'],['englishMathsDigital','English · maths · digital'],['inclusion','Inclusion / SEND / adaptations'],['safeguarding','Safeguarding / Prevent / EDI / wellbeing'],['workplace','Workplace / employability / progression'],['healthSafety','Health & safety'],['plenary','Plenary / recap'],['nextLearning','Next learning']];app.innerHTML=`${breadcrumb(r.title,'LESSON PLAN')}<section class="staff-card"><div class="inline-actions"><button class="blue-button" type="button" data-edit-lesson="${attr(r.id)}">Edit plan</button><button class="soft-button" type="button" data-print-resource-id="${attr(r.id)}">PDF / Print</button></div><div class="inline-actions"><button class="soft-button" type="button" data-generate-presentation="${attr(r.id)}">Create presentation</button><button class="soft-button" type="button" data-generate-quiz="${attr(r.id)}">Create quiz</button></div><button class="text-button full" type="button" data-share-resource-id="${attr(r.id)}">Share lesson</button></section><section class="staff-card"><div class="samos-section-head"><h2>KSB links</h2><small>${links.length} linked</small></div>${links.length?links.map(l=>{const k=findKsb(l.courseId||r.courseId,l.code);return `<div class="samos-row"><span><strong>${esc(l.code)}</strong><small>${esc(k?.text||'KSB wording')}</small><em>${l.percent??100}% wording match · ${l.source==='tutor'?'Tutor linked':l.source==='generated'?'Course plan':'Auto-linked'}</em></span></div>`}).join(''):'<div class="samos-empty compact-empty"><strong>No KSB links</strong></div>'}</section><section class="lesson-detail-grid">${blocks.map(([k,label])=>`<div class="lesson-detail-block"><small>${esc(label.toUpperCase())}</small><p>${esc(r.fields?.[k]||'Not added yet.')}</p></div>`).join('')}</section>`;}
  function sowRows(r){return (r.lessonPlanIds||[]).map(id=>state.resources.find(x=>x.id===id&&x.type==='lesson-plan')).filter(Boolean).sort((a,b)=>(a.sessionNumber||0)-(b.sessionNumber||0));}
  function renderSowDetail(r){const course=state.courses.find(c=>c.id===r.courseId),rows=sowRows(r);app.innerHTML=`${breadcrumb(r.title,'SCHEME OF WORK')}<section class="staff-card"><div class="sow-alignment-note">This SOW is designed around current FE expectations for coherent coverage, content, structure and sequencing, with assessment, inclusion, safeguarding and vocational relevance built into each editable session. Samos does not lock the tutor into a prescribed planning format.</div><div class="course-summary-grid"><div><strong>${rows.length}</strong><span>Sessions</span></div><div><strong>${course?.ksbs?.length||0}</strong><span>KSBs</span></div><div><strong>${course?.plan?.totalHours||0}</strong><span>Hours</span></div><div><strong>${course?.plan?.weeks||0}</strong><span>Weeks</span></div></div><div class="inline-actions"><button class="blue-button" type="button" data-print-resource-id="${attr(r.id)}">PDF / Print SOW</button><button class="soft-button" type="button" data-share-resource-id="${attr(r.id)}">Share</button></div></section><section class="staff-card"><div class="samos-section-head"><h2>Planned sessions</h2><small>${rows.length}</small></div><div class="sow-session-list">${rows.map(lp=>`<div class="sow-session-row"><header><span><small>WEEK ${lp.week||'—'} · SESSION ${lp.sessionNumber||'—'}</small><strong>${esc(lp.fields?.topic||lp.title)}</strong></span><button class="text-button" type="button" data-view-resource="${attr(lp.id)}">Open</button></header><small>${esc((lp.linkedKSBs||[]).map(x=>x.code).join(' · '))} · ${lp.durationHours||course?.plan?.sessionHours||0}h</small></div>`).join('')}</div></section>`;}

  function renderCoursesPage(){setHomeMode(false);const selected=state.courses.find(c=>c.id===state.selectedCourseId)||null;if(selected)return renderCourseDetail(selected);app.innerHTML=`${breadcrumb('Official courses','CURRICULUM')}<button class="blue-button full" type="button" data-add-course>+ Upload official course</button><section class="staff-card"><div class="samos-section-head"><h2>Courses</h2><small>${state.courses.length} saved</small></div>${state.courses.length?state.courses.map(c=>`<button class="samos-row" type="button" data-open-course="${attr(c.id)}"><span><strong>${esc(c.name)}</strong><small>${esc([c.code,c.version].filter(Boolean).join(' · ')||'Official KSB set')}</small><em>${c.ksbs?.length||0} KSBs · ${c.plan?.totalSessions||0} sessions · ${c.plan?.totalHours||0} hours</em></span><b>›</b></button>`).join(''):'<div class="samos-empty"><strong>No course uploaded</strong><p>Add the official KSB wording and Samos will build an editable teaching plan.</p></div>'}</section>`;}
  function renderCourseDetail(c){const sow=state.resources.find(r=>r.id===c.sowId),plans=(c.lessonPlanIds||[]).map(id=>state.resources.find(r=>r.id===id)).filter(Boolean);app.innerHTML=`${breadcrumb(c.name,'OFFICIAL COURSE')}<section class="staff-card"><div class="course-summary-grid"><div><strong>${c.ksbs?.length||0}</strong><span>KSBs</span></div><div><strong>${c.plan?.totalSessions||0}</strong><span>Sessions</span></div><div><strong>${c.plan?.totalHours||0}</strong><span>Hours</span></div><div><strong>${c.plan?.weeks||0}</strong><span>Weeks</span></div></div><div class="inline-actions">${sow?`<button class="blue-button" type="button" data-view-resource="${attr(sow.id)}">Open SOW</button>`:''}<button class="soft-button" type="button" data-share-course="${attr(c.id)}">Share course</button></div></section><section class="staff-card"><div class="samos-section-head"><h2>KSBs</h2><small>${c.ksbs?.length||0}</small></div><div class="ksb-preview-list">${(c.ksbs||[]).map(k=>`<div class="ksb-preview-row"><b>${esc(k.code)}</b><span>${esc(k.text)}</span></div>`).join('')}</div></section><section class="staff-card"><div class="samos-section-head"><h2>Lesson plans</h2><small>${plans.length}</small></div>${plans.slice(0,30).map(lp=>`<button class="samos-row" type="button" data-view-resource="${attr(lp.id)}"><span><strong>${esc(lp.title)}</strong><small>${esc((lp.linkedKSBs||[]).map(x=>x.code).join(' · '))}</small><em>${lp.durationHours||c.plan?.sessionHours||0}h</em></span><b>›</b></button>`).join('')}${plans.length>30?`<div class="samos-empty compact-empty"><strong>${plans.length-30} more sessions</strong><p>Open the SOW to navigate the complete sequence.</p></div>`:''}</section>`;}

  function presenterFace(){return `<div class="samos-presenter look-class" aria-hidden="true"><div class="presenter-eyes"><i></i><i></i></div></div>`;}
  function startPresenterAnimations(host){stopPresenterAnimations();const face=host?.querySelector('.samos-presenter');if(!face)return;const looks=['look-title','look-image','look-text','look-class'],fun=['fun-bob','fun-wink','fun-tilt'];let tick=0;presenterTimer=window.setInterval(()=>{if(!face.isConnected){stopPresenterAnimations();return;}face.classList.remove(...looks,...fun);face.classList.add(looks[tick%looks.length]);if(tick%4===3)face.classList.add(fun[Math.floor(tick/4)%fun.length]);tick++;},3200);}
  function stopPresenterAnimations(){if(presenterTimer){clearInterval(presenterTimer);presenterTimer=0;}}

  function fullscreenElement(){return document.fullscreenElement||document.webkitFullscreenElement||null;}
  async function togglePlayerFullscreen(){
    const host=document.querySelector('.classroom-player.open');if(!host)return;
    try{
      if(fullscreenElement()){
        const exit=document.exitFullscreen||document.webkitExitFullscreen;if(exit)await exit.call(document);
      }else{
        const request=host.requestFullscreen||host.webkitRequestFullscreen;if(!request){toast('Full screen is not available on this browser');return;}await request.call(host);
      }
    }catch(_){toast('Full screen could not be started');}
  }
  function exitPlayerFullscreen(){try{if(fullscreenElement()){const exit=document.exitFullscreen||document.webkitExitFullscreen;exit?.call(document);}}catch(_){}}
  function updateFullscreenButton(){const b=document.querySelector('.classroom-player.open [data-toggle-fullscreen]');if(!b)return;const on=Boolean(fullscreenElement());b.textContent=on?'↙':'⛶';b.title=on?'Exit full screen':'Full screen';b.setAttribute('aria-label',b.title);}

  function openQuizPlayer(id){const q=state.resources.find(r=>r.id===id&&r.type==='quiz');if(!q)return;closeAssistant();playerState={kind:'quiz',id:q.id,index:-1,reveal:false};renderQuizPlayer();}
  function renderQuizPlayer(){const host=$('#quizPlayer'),q=state.resources.find(r=>r.id===playerState?.id);if(!host||!q){closeClassroomPlayer();return;}host.classList.add('open');host.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
    if(playerState.index<0){host.innerHTML=`<div class="player-shell"><div class="player-topbar"><span><small>LIVE QUIZ</small><strong>${esc(q.title)}</strong></span><div class="player-top-actions"><button class="player-fullscreen" type="button" data-toggle-fullscreen aria-label="Toggle full screen" title="Full screen">⛶</button><button class="player-close" type="button" data-close-player aria-label="Close">×</button></div></div><div class="player-body">${presenterFace()}<div class="quiz-join"><h1>Join the quiz</h1><p>Learners scan this with the Samos Quiz feature in Evia. The QR contains only the quiz ID, number of questions and the A/B/C/D answer key — no question or answer wording.</p><div id="liveQuizQr" class="share-qr"></div><p>${q.questions.length} questions · completely offline</p></div></div><div class="player-controls"><button class="primary" type="button" data-quiz-player-start>Start question 1</button></div></div>`;try{window.SamosQR?.render($('#liveQuizQr'),quizLearnerPayload(q),286);}catch(_){$('#liveQuizQr').innerHTML='<p>QR could not be generated.</p>';}startPresenterAnimations(host);updateFullscreenButton();return;}
    if(playerState.index>=q.questions.length){host.innerHTML=`<div class="player-shell"><div class="player-topbar"><span><small>LIVE QUIZ</small><strong>${esc(q.title)}</strong></span><div class="player-top-actions"><button class="player-fullscreen" type="button" data-toggle-fullscreen aria-label="Toggle full screen" title="Full screen">⛶</button><button class="player-close" type="button" data-close-player aria-label="Close">×</button></div></div><div class="player-body">${presenterFace()}<div class="quiz-finish"><h1>Quiz complete</h1><p>Learners keep their score on their own device. If you want to record a result in Samos, scan the learner’s result QR afterwards.</p></div></div><div class="player-controls"><button type="button" data-close-player>Finish</button><button class="primary" type="button" data-import-quiz-result="${attr(q.id)}">Import a result</button></div></div>`;startPresenterAnimations(host);updateFullscreenButton();return;}
    const qu=q.questions[playerState.index],answers=qu.answers.filter(Boolean);host.innerHTML=`<div class="player-shell"><div class="player-topbar"><span><small>QUESTION ${playerState.index+1} OF ${q.questions.length}</small><strong>${esc(q.title)}</strong></span><div class="player-top-actions"><button class="player-fullscreen" type="button" data-toggle-fullscreen aria-label="Toggle full screen" title="Full screen">⛶</button><button class="player-close" type="button" data-close-player aria-label="Close">×</button></div></div><div class="player-body">${presenterFace()}<div class="quiz-question-stage"><div class="quiz-progress">Question ${playerState.index+1} / ${q.questions.length}</div><h1>${esc(qu.text)}</h1><div class="quiz-live-answers">${answers.map((a,i)=>`<div class="quiz-live-answer ${playerState.reveal&&i===Number(qu.correct)?'correct':''}"><b>${LETTERS[i]}</b><span>${esc(a)}</span></div>`).join('')}</div></div></div><div class="player-controls"><button type="button" data-quiz-player-prev ${playerState.index===0?'disabled':''}>Back</button>${playerState.reveal?`<button class="primary" type="button" data-quiz-player-next>${playerState.index===q.questions.length-1?'Finish':'Next question'}</button>`:'<button class="primary" type="button" data-quiz-player-reveal>Reveal answer</button>'}</div></div>`;startPresenterAnimations(host);updateFullscreenButton();}

  async function openPresentationPlayer(id){const p=state.resources.find(r=>r.id===id&&r.type==='presentation');if(!p)return;closeAssistant();playerState={kind:'presentation',id:p.id,index:0};await renderPresentationPlayer();}
  async function renderPresentationPlayer(){const host=$('#presentationPlayer'),p=state.resources.find(r=>r.id===playerState?.id);if(!host||!p){closeClassroomPlayer();return;}if(playerState.index<0)playerState.index=0;if(playerState.index>=p.slides.length)playerState.index=p.slides.length-1;const sl=p.slides[playerState.index]||{};let image='';if(sl.imageKey){try{const blob=await getFile(sl.imageKey);if(blob)image=URL.createObjectURL(blob);}catch(_){}}
    host.classList.add('open');host.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';const sentences=String(sl.text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);host.innerHTML=`<div class="player-shell"><div class="player-topbar"><span><small>SLIDE ${playerState.index+1} OF ${p.slides.length}</small><strong>${esc(p.title)}</strong></span><div class="player-top-actions"><button class="player-fullscreen" type="button" data-toggle-fullscreen aria-label="Toggle full screen" title="Full screen">⛶</button><button class="player-close" type="button" data-close-player aria-label="Close">×</button></div></div><div class="player-body">${presenterFace()}<article class="presentation-slide"><h1>${esc(sl.title||p.title)}</h1><div class="slide-image ${image?'':'empty'}">${image?`<img src="${image}" alt="">`:'<span>Add an image when editing this slide</span>'}</div><div class="slide-sentences">${sentences.length?sentences.map(x=>`<p>${esc(x)}</p>`).join(''):'<p>Add short teaching sentences when editing this slide.</p>'}</div></article></div><div class="player-controls"><button type="button" data-presentation-prev ${playerState.index===0?'disabled':''}>Back</button>${playerState.index===p.slides.length-1?'<button class="primary" type="button" data-close-player>Finish</button>':'<button class="primary" type="button" data-presentation-next>Next slide</button>'}</div></div>`;if(image)setTimeout(()=>URL.revokeObjectURL(image),60000);startPresenterAnimations(host);updateFullscreenButton();}
  function closeClassroomPlayer(){stopPresenterAnimations();exitPlayerFullscreen();for(const id of ['quizPlayer','presentationPlayer']){const h=$(`#${id}`);h?.classList.remove('open');h?.setAttribute('aria-hidden','true');if(h)h.innerHTML='';}playerState=null;document.body.style.overflow='';}

  async function blobToDataUrl(blob){return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
  function dataUrlToBlob(data){const [head,body]=String(data).split(',');const mime=(head.match(/data:([^;]+)/)||[])[1]||'application/octet-stream',bin=atob(body||''),arr=Uint8Array.from(bin,c=>c.charCodeAt(0));return new Blob([arr],{type:mime});}
  async function buildSharePackage(kind,id){
    const pkg={v:1,app:'Samos',build:BUILD,kind,createdAt:nowIso(),courses:[],resources:[],media:[]};
    if(kind==='course'){
      const c=state.courses.find(x=>x.id===id);if(!c)throw new Error('Course not found');pkg.courses.push(clone(c));const ids=new Set([c.sowId,...(c.lessonPlanIds||[])]);pkg.resources=state.resources.filter(r=>ids.has(r.id)).map(clone);
    }else{
      const r=state.resources.find(x=>x.id===id);if(!r)throw new Error('Resource not found');pkg.resources.push(clone(r));
      if(r.type==='sow'){const c=state.courses.find(x=>x.id===r.courseId);if(c){pkg.courses.push(clone(c));pkg.resources=state.resources.filter(x=>x.id===r.id||(c.lessonPlanIds||[]).includes(x.id)).map(clone);}}
      else if(r.courseId){const c=state.courses.find(x=>x.id===r.courseId);if(c)pkg.courses.push({...clone(c),lessonPlanIds:[],sowId:''});}
    }
    const keys=[...new Set(pkg.resources.flatMap(r=>r.type==='presentation'?(r.slides||[]).map(s=>s.imageKey).filter(Boolean):[]))];for(const key of keys){try{const b=await getFile(key);if(b)pkg.media.push({key,data:await blobToDataUrl(b),type:b.type||'',name:key});}catch(_){}}
    return pkg;
  }
  function compactQrPackage(pkg){if(pkg.media?.length)return null;const mini={v:1,k:pkg.kind,c:pkg.courses||[],r:pkg.resources||[]};const text=`SM1:${JSON.stringify(mini)}`;return new TextEncoder().encode(text).length<=2200?text:null;}
  async function openShare(kind,id){
    try{const pkg=await buildSharePackage(kind,id),title=kind==='course'?pkg.courses[0]?.name:pkg.resources[0]?.title;shareContext={kind,id,pkg};$('#shareDialogTitle').textContent=`Share ${title||'item'}`;const qr=compactQrPackage(pkg),body=$('#shareDialogBody');body.innerHTML=`${qr?'<div class="share-qr-wrap"><div id="shareQrCanvas" class="share-qr"></div></div><p class="share-note">This QR carries the Samos item itself. Another Samos app can scan it without an internet connection.</p>':'<div class="share-too-large"><strong>Use the Samos file for this item</strong><span>It contains too much information for a reliable QR code, usually because it includes many sessions or images.</span></div>'}<div class="inline-actions"><button class="blue-button" type="button" data-export-share-file>Share / export .samos</button>${qr?'<button class="soft-button" type="button" data-save-share-qr>Save QR</button>':''}</div>${qr?`<details><summary>QR data</summary><div class="share-code">${esc(qr)}</div></details>`:''}`;$('#shareDialog').showModal();if(qr){try{window.SamosQR?.render($('#shareQrCanvas'),qr,286);}catch(_){$('#shareQrCanvas').innerHTML='<p>QR could not be generated.</p>';}}}catch(_){toast('This item could not be prepared for sharing');}
  }
  async function exportShareFile(){if(!shareContext?.pkg)return;const data=JSON.stringify(shareContext.pkg,null,2),title=shareContext.kind==='course'?shareContext.pkg.courses[0]?.name:shareContext.pkg.resources[0]?.title;const name=safeFileName(title||'Samos-resource','.samos'),result=await shareOrDownloadFile(new Blob([data],{type:'application/json'}),name,title||'Samos resource');if(result==='shared')toast('Samos file shared');}
  async function saveShareQr(){const svg=$('#shareQrCanvas svg');if(!svg)return;const text=new XMLSerializer().serializeToString(svg),name=safeFileName($('#shareDialogTitle')?.textContent||'Samos-QR','.svg'),result=await shareOrDownloadFile(new Blob([text],{type:'image/svg+xml'}),name,'Samos QR');if(result==='shared')toast('QR shared');}
  async function importSamosPackage(file){if(!file)return;try{const text=await file.text(),pkg=JSON.parse(text);await importPackageObject(pkg);toast('Samos item imported');if(overlay.classList.contains('open'))closeAssistant();if($('#scanDialog')?.open)closeScanDialog();state.view='resources';state.resourceFilter='all';save();}catch(e){console.error(e);toast('That Samos file could not be imported');}finally{$('#samosPackageInput').value='';}}
  async function importPackageObject(raw){
    const pkg=raw?.v&&raw?.r&&!raw.resources?{v:raw.v,kind:raw.k,courses:raw.c||[],resources:raw.r||[],media:[]}:raw;if(!pkg||!Array.isArray(pkg.resources)||!Array.isArray(pkg.courses))throw new Error('Invalid package');
    const courseMap=new Map();for(const old of pkg.courses){let existing=state.courses.find(c=>(old.code&&c.code===old.code&&c.version===old.version)||(!old.code&&c.name===old.name));if(existing){courseMap.set(old.id,existing.id);continue;}const c=clone(old),newId=uid();courseMap.set(old.id,newId);c.id=newId;c.lessonPlanIds=[];c.sowId='';c.createdAt=nowIso();state.courses.push(c);}
    const resMap=new Map(),newResources=[];for(const old of pkg.resources){const r=clone(old),newId=uid();resMap.set(old.id,newId);r.id=newId;r.createdAt=nowIso();r.updatedAt=nowIso();if(r.courseId)r.courseId=courseMap.get(r.courseId)||r.courseId;if(r.type==='quiz')r.results=[];newResources.push(r);}
    for(const r of newResources){if(r.type==='sow')r.lessonPlanIds=(r.lessonPlanIds||[]).map(x=>resMap.get(x)).filter(Boolean);if(r.type==='presentation'){for(const s of r.slides||[]){if(s.imageKey){const media=(pkg.media||[]).find(m=>m.key===s.imageKey);if(media?.data){const newKey=`media:${r.id}:${s.id||uid()}`;await putFile(newKey,dataUrlToBlob(media.data));s.imageKey=newKey;}else s.imageKey='';}}}state.resources.push(r);}
    for(const old of pkg.courses){const cid=courseMap.get(old.id),c=state.courses.find(x=>x.id===cid);if(!c)continue;const mappedPlans=(old.lessonPlanIds||[]).map(x=>resMap.get(x)).filter(Boolean);if(mappedPlans.length)c.lessonPlanIds=[...new Set([...(c.lessonPlanIds||[]),...mappedPlans])];const sow=resMap.get(old.sowId);if(sow)c.sowId=sow;}
    return newResources;
  }
  async function parseIncomingCode(text,expectedQuizId=''){const raw=String(text||'').trim();if(raw.startsWith('SM1:')){const mini=JSON.parse(raw.slice(4));await importPackageObject(mini);toast('Samos item imported');closeScanDialog();state.view='resources';state.resourceFilter='all';save();return;}if(raw.startsWith('SQR1:')){const result=JSON.parse(raw.slice(5)),qid=expectedQuizId||result.q,quiz=state.resources.find(r=>r.id===qid&&r.type==='quiz');if(!quiz)throw new Error('Quiz not found');quiz.results=Array.isArray(quiz.results)?quiz.results:[];quiz.results.push({learner:String(result.n||'Learner').slice(0,60),answers:String(result.a||''),score:Number(result.s)||0,receivedAt:nowIso(),dateLabel:new Date().toLocaleString('en-GB')});save(false);toast('Quiz result saved');closeScanDialog();state.view='resource';state.selectedResourceId=quiz.id;render();return;}throw new Error('Unsupported QR');}
  async function openScanDialog(mode='import',quizId=''){$('#scanDialogTitle').textContent=mode==='result'?'Import learner result':'Scan Samos QR';const body=$('#scanDialogBody');body.innerHTML=`<div id="nativeScanArea"></div><div class="scan-fallback"><label class="ta-field"><span>Or paste the QR data</span><textarea id="scanPasteInput" placeholder="SM1:...${mode==='result'?' or SQR1:...':''}"></textarea></label><button class="blue-button full" type="button" data-use-pasted-qr data-scan-mode="${attr(mode)}" data-quiz-id="${attr(quizId)}">Import code</button>${mode==='import'?'<button class="soft-button full" type="button" data-pick-samos-file>Import .samos file instead</button>':''}</div>`;$('#scanDialog').showModal();await startNativeQrScan(mode,quizId);}
  async function startNativeQrScan(mode,quizId){
    const area=$('#nativeScanArea');if(!area)return;
    if(!('BarcodeDetector' in window)||!navigator.mediaDevices?.getUserMedia){area.innerHTML='<div class="share-too-large"><strong>Camera QR scanning is not available on this browser</strong><span>Paste the QR data or use a .samos file. Nothing is sent online.</span></div>';return;}
    try{
      const formats=await BarcodeDetector.getSupportedFormats?.();if(formats&&!formats.includes('qr_code'))throw new Error('qr unsupported');
      const detector=new BarcodeDetector({formats:['qr_code']});
      const attempts=[
        {video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false},
        {video:{width:{ideal:1280},height:{ideal:720}},audio:false},
        {video:true,audio:false}
      ];
      let lastError=null;
      for(const constraints of attempts){try{qrScanStream=await navigator.mediaDevices.getUserMedia(constraints);if(qrScanStream)break;}catch(err){lastError=err;}}
      if(!qrScanStream)throw lastError||new Error('camera unavailable');
      area.innerHTML='<video id="qrScanVideo" class="scan-video" playsinline muted autoplay></video><p class="share-note">Hold the Samos QR inside the camera view.</p>';
      const v=$('#qrScanVideo');v.srcObject=qrScanStream;await v.play();
      qrScanTimer=window.setInterval(async()=>{if(!v.isConnected||v.readyState<2)return;try{const found=await detector.detect(v);if(found?.[0]?.rawValue){clearInterval(qrScanTimer);qrScanTimer=0;await parseIncomingCode(found[0].rawValue,quizId);}}catch(_){}},350);
    }catch(_){stopQrScan();area.innerHTML='<div class="share-too-large"><strong>Camera could not start</strong><span>Check camera permission, or paste the QR data / use a .samos file instead.</span></div>';}
  }
  function stopQrScan(){if(qrScanTimer){clearInterval(qrScanTimer);qrScanTimer=0;}if(qrScanStream){qrScanStream.getTracks().forEach(t=>t.stop());qrScanStream=null;}}
  function closeScanDialog(){stopQrScan();try{$('#scanDialog').close();}catch(_){}}

  function printMark(){return `<div class="print-samos" aria-hidden="true"><i></i><i></i></div>`;}
  function printCss(){return `<style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#16201b;margin:0;font-size:10.5pt;line-height:1.42}h1{font-size:22pt;margin:0 80px 5mm 0;letter-spacing:-.03em}h2{font-size:13pt;margin:6mm 0 2mm}h3{font-size:11pt;margin:4mm 0 1mm}p{margin:1.5mm 0}.muted{color:#63736b}.page{position:relative;min-height:255mm;page-break-after:always;padding-top:2mm}.page:last-child{page-break-after:auto}.print-samos{position:absolute;right:0;top:0;width:18mm;height:18mm;border:2mm solid #63c495;border-radius:50%;display:flex;align-items:center;justify-content:space-evenly;padding:0 3.1mm}.print-samos i{display:block;width:4mm;height:4mm;border:1.2mm solid #63c495;border-radius:50%}.meta{display:flex;gap:4mm;flex-wrap:wrap;margin:2mm 0 5mm}.meta span{padding:1.5mm 2.4mm;border-radius:99px;background:#eef8f3;color:#35634c;font-size:8.5pt}.block{border:1px solid #dbe6df;border-radius:3mm;padding:3mm;margin:2.5mm 0}.block small{display:block;color:#4da979;font-size:7.5pt;font-weight:700;letter-spacing:.05em}.answers{display:grid;grid-template-columns:1fr 1fr;gap:2mm}.answer{padding:2.5mm;border:1px solid #e0e7e3;border-radius:2.5mm}.answer.correct{background:#eaf8f0;border-color:#63c495}.slide-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:6mm;align-items:center}.slide-image{min-height:110mm;background:#edf4f0;border-radius:4mm;overflow:hidden;display:flex;align-items:center;justify-content:center}.slide-image img{max-width:100%;max-height:135mm;object-fit:contain}.sentences p{border-left:2mm solid #63c495;padding:2.5mm 3mm;background:#f8fbf9;border-radius:0 2.5mm 2.5mm 0;margin:2.5mm 0}.sow{width:100%;border-collapse:collapse;font-size:7.6pt}.sow th,.sow td{border:1px solid #d7e1dc;padding:2mm;vertical-align:top}.sow th{background:#edf8f2;text-align:left}.sow tr{page-break-inside:avoid}.sow-note{font-size:8pt;padding:2.5mm;background:#eef8f3;border:1px solid #d1e8dc;border-radius:2.5mm;margin:3mm 0 5mm}@media print{button{display:none}}</style>`;}
  const nl=v=>esc(v||'').replace(/\n/g,'<br>');
  async function printResource(id){const r=state.resources.find(x=>x.id===id);if(!r)return;const w=window.open('about:blank','_blank');if(!w){toast('Allow pop-ups to create the PDF / print view');return;}w.document.write('<p style="font-family:Arial;padding:30px">Preparing Samos document…</p>');let body='';
    if(r.type==='quiz')body=`<section class="page">${printMark()}<h1>${esc(r.title)}</h1><div class="meta"><span>Quiz</span><span>${r.questions?.length||0} questions</span></div>${(r.questions||[]).map((q,i)=>`<div class="block"><small>QUESTION ${i+1}</small><h2>${esc(q.text)}</h2><div class="answers">${q.answers.filter(Boolean).map((a,j)=>`<div class="answer ${j===Number(q.correct)?'correct':''}">${LETTERS[j]}. ${esc(a)}</div>`).join('')}</div></div>`).join('')}</section>`;
    else if(r.type==='lesson-plan'){const blocks=[['topic','Topic / intent'],['learningOutcomes','Learning outcomes'],['priorLearning','Prior learning'],['starter','Starter / retrieval'],['tutorActivities','Tutor activities / modelling'],['learnerActivities','Learner activities / practice'],['assessment','Assessment / checks for understanding'],['resources','Resources'],['englishMathsDigital','English · maths · digital'],['inclusion','Inclusion / SEND / adaptations'],['safeguarding','Safeguarding / Prevent / EDI / wellbeing'],['workplace','Workplace / employability / progression'],['healthSafety','Health & safety'],['plenary','Plenary / recap'],['nextLearning','Next learning']];body=`<section class="page">${printMark()}<h1>${esc(r.title)}</h1><div class="meta"><span>Lesson plan</span><span>${r.durationHours||0} hours</span>${(r.linkedKSBs||[]).map(l=>`<span>${esc(l.code)} · ${l.percent??100}%</span>`).join('')}</div>${blocks.map(([k,label])=>`<div class="block"><small>${esc(label.toUpperCase())}</small><p>${nl(r.fields?.[k]||'Not added.')}</p></div>`).join('')}</section>`;}
    else if(r.type==='sow'){const course=state.courses.find(c=>c.id===r.courseId),rows=sowRows(r);body=`<section class="page">${printMark()}<h1>${esc(r.title)}</h1><div class="meta"><span>${esc(course?.code||'Course')}</span><span>${rows.length} sessions</span><span>${course?.plan?.totalHours||0} hours</span></div><div class="sow-note">Samos Scheme of Work: a tutor-controlled planning record covering curriculum sequencing, learning outcomes, prior learning, teaching and learner activity, assessment/checks for understanding, inclusion/SEND, safeguarding/Prevent/EDI/wellbeing, English/maths/digital, workplace/employability, resources, health & safety and next learning. There is no prescribed Ofsted lesson-plan format.</div><table class="sow"><thead><tr><th>Week / Session</th><th>Topic & KSBs</th><th>Learning outcomes</th><th>Teaching / learner activity</th><th>Assessment</th><th>Inclusion / EMD / workplace / H&S</th><th>Next</th></tr></thead><tbody>${rows.map(lp=>`<tr><td>W${lp.week||''}<br>S${lp.sessionNumber||''}<br>${lp.durationHours||course?.plan?.sessionHours||0}h</td><td><b>${esc(lp.fields?.topic||lp.title)}</b><br>${esc((lp.linkedKSBs||[]).map(x=>x.code).join(', '))}</td><td>${nl(lp.fields?.learningOutcomes)}</td><td><b>Tutor:</b> ${nl(lp.fields?.tutorActivities)}<br><b>Learner:</b> ${nl(lp.fields?.learnerActivities)}</td><td>${nl(lp.fields?.assessment)}</td><td><b>Inclusion:</b> ${nl(lp.fields?.inclusion)}<br><b>Safeguarding:</b> ${nl(lp.fields?.safeguarding)}<br><b>English/maths/digital:</b> ${nl(lp.fields?.englishMathsDigital)}<br><b>Workplace:</b> ${nl(lp.fields?.workplace)}<br><b>H&S:</b> ${nl(lp.fields?.healthSafety)}</td><td>${nl(lp.fields?.nextLearning)}</td></tr>`).join('')}</tbody></table></section>`;}
    else if(r.type==='presentation'){const pages=[];for(let i=0;i<(r.slides||[]).length;i++){const sl=r.slides[i];let image='';if(sl.imageKey){try{const b=await getFile(sl.imageKey);if(b)image=await blobToDataUrl(b);}catch(_){}}const sentences=String(sl.text||'').split(/\n+/).filter(Boolean);pages.push(`<section class="page">${printMark()}<small class="muted">${esc(r.title)} · Slide ${i+1}/${r.slides.length}</small><h1>${esc(sl.title||r.title)}</h1><div class="slide-grid"><div class="slide-image">${image?`<img src="${image}" alt="">`:'<span class="muted">No image</span>'}</div><div class="sentences">${sentences.map(x=>`<p>${esc(x)}</p>`).join('')}</div></div></section>`);}body=pages.join('');}
    else body=`<section class="page">${printMark()}<h1>${esc(r.title)}</h1><p>${nl(r.notes)}</p></section>`;
    w.document.open();w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)} · Samos</title>${printCss()}</head><body>${body}<script>setTimeout(()=>window.print(),450)<\/script></body></html>`);w.document.close();}


  /* ---------------- Events ---------------- */
  app.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-home-back')){
      if(state.view==='resource'){state.view='resources';state.selectedResourceId=null;return save();}
      if(state.view==='courses'&&state.selectedCourseId){state.selectedCourseId=null;return save();}
      return goHome();
    }
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

    if(b.hasAttribute('data-create-resource'))return openAssistant('resources:create');
    if(b.hasAttribute('data-import-samos'))return openAssistant('resources:import');
    if(b.hasAttribute('data-upload-resource'))return $('#resourceFileInput').click();
    if(b.hasAttribute('data-add-course'))return startCourseWizard();
    if(b.dataset.resourceFilter){state.resourceFilter=b.dataset.resourceFilter;state.view='resources';save();return;}
    if(b.dataset.viewResource){state.selectedResourceId=b.dataset.viewResource;state.view='resource';save();return;}
    if(b.dataset.openCourse){state.selectedCourseId=b.dataset.openCourse;state.view='courses';save();return;}

    const rowId=b.closest('[data-resource-id]')?.dataset.resourceId;
    const resourceId=b.dataset.playQuizId||b.dataset.playPresentationId||b.dataset.shareResourceId||b.dataset.printResourceId||b.dataset.editQuiz||b.dataset.editPresentation||b.dataset.editLesson||b.dataset.generatePresentation||b.dataset.generateQuiz||b.dataset.importQuizResult||rowId||state.selectedResourceId;
    if(b.hasAttribute('data-open-resource'))return openResource(resourceId);
    if(b.hasAttribute('data-delete-resource'))return deleteResource(resourceId);
    if(b.hasAttribute('data-play-quiz')||b.dataset.playQuizId)return openQuizPlayer(resourceId);
    if(b.hasAttribute('data-play-presentation')||b.dataset.playPresentationId)return openPresentationPlayer(resourceId);
    if(b.hasAttribute('data-share-resource')||b.dataset.shareResourceId)return openShare('resource',resourceId);
    if(b.dataset.shareCourse)return openShare('course',b.dataset.shareCourse);
    if(b.dataset.editQuiz)return startQuizWizard(b.dataset.editQuiz);
    if(b.dataset.editQuizQuestion!==undefined&&state.view==='resource'){const id=state.selectedResourceId;startQuizWizard(id);quizEditIndex=Number(b.dataset.editQuizQuestion);quizWizardStep=3;return renderQuizWizard();}
    if(b.dataset.moveQuizQuestion&&state.view==='resource'){const r=state.resources.find(x=>x.id===state.selectedResourceId&&x.type==='quiz'),i=Number(b.dataset.index),j=b.dataset.moveQuizQuestion==='up'?i-1:i+1;if(r&&j>=0&&j<r.questions.length){[r.questions[i],r.questions[j]]=[r.questions[j],r.questions[i]];save();}return;}
    if(b.dataset.deleteQuizQuestion!==undefined&&state.view==='resource'){const r=state.resources.find(x=>x.id===state.selectedResourceId&&x.type==='quiz'),i=Number(b.dataset.deleteQuizQuestion);if(r&&r.questions.length>1&&confirm('Delete this question?')){r.questions.splice(i,1);save();}else if(r?.questions?.length===1)toast('A quiz needs at least one question');return;}
    if(b.dataset.editPresentation)return startPresentationWizard(b.dataset.editPresentation);
    if(b.dataset.editLesson)return startLessonWizard(b.dataset.editLesson);
    if(b.dataset.printResourceId)return printResource(b.dataset.printResourceId);
    if(b.dataset.generatePresentation)return generatePresentationFromLesson(b.dataset.generatePresentation);
    if(b.dataset.generateQuiz)return generateQuizFromLesson(b.dataset.generateQuiz);
    if(b.dataset.importQuizResult)return openScanDialog('result',b.dataset.importQuizResult);
  });

  $('#eviaFace').addEventListener('click',()=>openAssistant('main'));
  $('#samosClose').addEventListener('click',closeAssistant);
  $('#samosBack').addEventListener('click',assistantBack);

  content.addEventListener('input',event=>{
    if(event.target.id==='assistantLearnerSearch')renderAssistantLearnerResults(event.target.value);
  });
  content.addEventListener('change',event=>{
    if(event.target.id==='quizQuestionType'&&quizDraft){
      const q=currentQuestionFromEditor();q.type=event.target.value;
      if(q.type==='true-false'){q.answers=['True','False','',''];q.correct=Math.min(q.correct,1);}
      const box=$('#quizAnswerEditor');if(box)box.innerHTML=renderQuizAnswerEditor(q);
    }
  });
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

    if(b.dataset.quizType){$$('[data-quiz-type]',content).forEach(x=>x.classList.toggle('active',x===b));quizDraft.quizType=b.dataset.quizType;return;}
    if(b.hasAttribute('data-quiz-next')){if(validateQuizStep()){quizWizardStep=Math.min(3,quizWizardStep+1);renderQuizWizard();}return;}
    if(b.dataset.quizSaveQuestion)return saveQuizQuestion(b.dataset.quizSaveQuestion);
    if(b.dataset.editQuizQuestion!==undefined){quizEditIndex=Number(b.dataset.editQuizQuestion);quizWizardStep=3;return renderQuizWizard();}
    if(b.dataset.moveQuizQuestion&&quizDraft){const i=Number(b.dataset.index),j=b.dataset.moveQuizQuestion==='up'?i-1:i+1;if(j>=0&&j<quizDraft.questions.length)[quizDraft.questions[i],quizDraft.questions[j]]=[quizDraft.questions[j],quizDraft.questions[i]];return renderQuizWizard();}
    if(b.dataset.deleteQuizQuestion!==undefined&&quizDraft){const i=Number(b.dataset.deleteQuizQuestion);if(quizDraft.questions.length<=1){toast('A quiz needs at least one question');return;}if(confirm('Delete this question?'))quizDraft.questions.splice(i,1);return renderQuizWizard();}
    if(b.hasAttribute('data-quiz-add-more')){quizEditIndex=null;quizWizardStep=3;return renderQuizWizard();}
    if(b.hasAttribute('data-save-quiz'))return saveQuizWizard();

    if(b.hasAttribute('data-presentation-next')){syncPresentationDraft();if(!presentationDraft?.title){toast('Add a presentation name');return;}presentationWizardStep=presentationDraft.slides?.length?3:2;return renderPresentationWizard();}
    if(b.hasAttribute('data-pick-presentation-image')){presentationPendingImage=null;$('#presentationImageInput').value='';return $('#presentationImageInput').click();}
    if(b.dataset.saveSlide)return savePresentationSlide(b.dataset.saveSlide);
    if(b.dataset.editSlide!==undefined){presentationEditIndex=Number(b.dataset.editSlide);presentationPendingImage=null;presentationWizardStep=2;return renderPresentationWizard();}
    if(b.dataset.moveSlide&&presentationDraft){const i=Number(b.dataset.index),j=b.dataset.moveSlide==='up'?i-1:i+1;if(j>=0&&j<presentationDraft.slides.length)[presentationDraft.slides[i],presentationDraft.slides[j]]=[presentationDraft.slides[j],presentationDraft.slides[i]];return renderPresentationWizard();}
    if(b.dataset.deleteSlide!==undefined&&presentationDraft){const i=Number(b.dataset.deleteSlide),sl=presentationDraft.slides[i];if(presentationDraft.slides.length<=1){toast('A presentation needs at least one slide');return;}if(confirm('Delete this slide?')){presentationDraft.slides.splice(i,1);if(sl?.imageKey)removeFile(sl.imageKey);}return renderPresentationWizard();}
    if(b.hasAttribute('data-presentation-add-slide')){presentationEditIndex=null;presentationPendingImage=null;presentationWizardStep=2;return renderPresentationWizard();}
    if(b.hasAttribute('data-save-presentation'))return savePresentationWizard();

    if(b.hasAttribute('data-course-next')){if(validateCourseStep()){syncCourseDraft();courseWizardStep=Math.min(4,courseWizardStep+1);renderCourseWizard();}return;}
    if(b.hasAttribute('data-pick-course-file')){return $('#courseFileInput').click();}
    if(b.hasAttribute('data-save-course')){syncCourseDraft();return createCoursePlan();}

    if(b.hasAttribute('data-lesson-next')){if(validateLessonStep()){syncLessonDraft();lessonWizardStep=Math.min(3,lessonWizardStep+1);renderLessonWizard();}return;}
    if(b.hasAttribute('data-save-lesson'))return saveLessonWizard();

    if(b.dataset.featureAction){
      const a=b.dataset.featureAction;
      if(a==='scan-samos')return openScanDialog('import');
      if(a==='import-samos-file')return $('#samosPackageInput').click();
      if(a==='upload-normal-file')return $('#resourceFileInput').click();
    }

    if(b.dataset.assistantAction){
      const a=b.dataset.assistantAction;
      if(a==='registers:today'){closeAssistant();state.view='registers';selectUsefulRegister();save();}
      else if(a==='registers:list'){closeAssistant();renderRegisterList();}
      else if(a==='registers:create')startRegisterWizard(false);
      else if(a==='resources:courses'){closeAssistant();state.view='courses';state.selectedCourseId=null;save();}
      else if(a==='resources:presentations'){closeAssistant();state.view='resources';state.resourceFilter='presentation';save();}
      else if(a==='resources:lessons'){closeAssistant();state.view='resources';state.resourceFilter='lesson-plan';save();}
      else if(a==='resources:quizzes'){closeAssistant();state.view='resources';state.resourceFilter='quiz';save();}
      else if(a==='resources:import'){assistantRoute='resources:import';assistantImportMenu();}
      else if(a==='resources:create'){assistantRoute='resources:create';assistantCreateResource();}
      else if(a==='create:lesson')startLessonWizard();
      else if(a==='create:presentation')startPresentationWizard();
      else if(a==='create:quiz')startQuizWizard();
      else if(a==='create:course')startCourseWizard();
      else if(a==='create:other')openResourceDialog('other');
      else if(a==='games:create-quiz')startQuizWizard();
      else if(a==='games:saved-quizzes'){closeAssistant();state.view='games';save();}
      else if(a==='games:import-result')openScanDialog('result','');
      return;
    }
    if(b.hasAttribute('data-assistant-open-games')){closeAssistant();state.view='games';save();}
  });

  $('#learnerForm').addEventListener('submit',e=>{if(!saveLearner())e.preventDefault()});
  $('#assignForm').addEventListener('submit',e=>{if(!assignLearners())e.preventDefault()});
  $('#resourceForm').addEventListener('submit',e=>{if(!saveResource())e.preventDefault()});
  $('#profileForm').addEventListener('submit',e=>{if(!saveProfile())e.preventDefault()});
  $('#resourceFileInput').addEventListener('change',e=>importResource(e.target.files?.[0]));
  $('#samosPackageInput').addEventListener('change',e=>importSamosPackage(e.target.files?.[0]));
  $('#presentationImageInput').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;presentationPendingImage=f;hydratePresentationImagePreview(presentationEditIndex!=null?presentationDraft?.slides?.[presentationEditIndex]?.imageKey:'');});
  $('#courseFileInput').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const text=await file.text();let ksbs=[],meta=null;
      try{const j=JSON.parse(text);meta=j;if(Array.isArray(j))ksbs=parseKsbText(text);else if(Array.isArray(j?.ksbs))ksbs=j.ksbs.map(x=>({code:String(x.code||x.id||'').trim().toUpperCase(),text:String(x.text||x.description||x.wording||'').trim()})).filter(x=>/^[KSB]\d+[A-Z]*$/i.test(x.code)&&x.text);}catch(_){ }
      if(!ksbs.length)ksbs=parseKsbText(text);
      if(!courseDraft)courseDraft={id:uid(),name:'',code:'',version:'',ksbs:[],sessionsPerWeek:1,sessionHours:6,weeks:100};
      if(meta&&!Array.isArray(meta)){courseDraft.name=String(meta.name||meta.title||courseDraft.name||'');courseDraft.code=String(meta.code||meta.standardCode||courseDraft.code||'');courseDraft.version=String(meta.version||courseDraft.version||'');}
      courseDraft.ksbs=ksbs;courseImportedText=ksbs.map(k=>`${k.code} - ${k.text}`).join('\n');courseWizardStep=2;assistantRoute='course:wizard';renderCourseWizard();
      if(!ksbs.length)toast('No KSB codes were found in that file');
    }catch(_){toast('That course file could not be read');}
    e.target.value='';
  });

  $('#profileButton').addEventListener('click',openProfile);
  $('#helpButton').addEventListener('click',()=>openAssistant('main'));

  document.addEventListener('click',async event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-close-share')){try{$('#shareDialog').close();}catch(_){}shareContext=null;return;}
    if(b.hasAttribute('data-close-scan')){closeScanDialog();return;}
    if(b.hasAttribute('data-export-share-file'))return exportShareFile();
    if(b.hasAttribute('data-save-share-qr'))return saveShareQr();
    if(b.hasAttribute('data-pick-samos-file'))return $('#samosPackageInput').click();
    if(b.hasAttribute('data-use-pasted-qr')){const text=$('#scanPasteInput')?.value||'';if(!text.trim()){toast('Paste the QR data first');return;}try{await parseIncomingCode(text,b.dataset.quizId||'');}catch(_){toast('That QR code could not be imported');}return;}
    if(b.hasAttribute('data-close-player'))return closeClassroomPlayer();
    if(b.hasAttribute('data-toggle-fullscreen'))return togglePlayerFullscreen();
    if(b.hasAttribute('data-quiz-player-start')&&b.closest('#quizPlayer')){playerState.index=0;playerState.reveal=false;return renderQuizPlayer();}
    if(b.hasAttribute('data-quiz-player-reveal')&&b.closest('#quizPlayer')){playerState.reveal=true;return renderQuizPlayer();}
    if(b.hasAttribute('data-quiz-player-next')&&b.closest('#quizPlayer')){playerState.index++;playerState.reveal=false;return renderQuizPlayer();}
    if(b.hasAttribute('data-quiz-player-prev')&&b.closest('#quizPlayer')){playerState.index=Math.max(0,playerState.index-1);playerState.reveal=false;return renderQuizPlayer();}
    if(b.hasAttribute('data-presentation-next')&&b.closest('#presentationPlayer')){playerState.index++;return renderPresentationPlayer();}
    if(b.hasAttribute('data-presentation-prev')&&b.closest('#presentationPlayer')){playerState.index=Math.max(0,playerState.index-1);return renderPresentationPlayer();}
    if(b.dataset.importQuizResult&&b.closest('#quizPlayer')){closeClassroomPlayer();return openScanDialog('result',b.dataset.importQuizResult);}
  });
  $('#scanDialog').addEventListener('close',stopQrScan);
  $('#shareDialog').addEventListener('close',()=>{shareContext=null;});

  function isTypingTarget(target){const tag=target?.tagName?.toLowerCase();return tag==='input'||tag==='textarea'||tag==='select'||target?.isContentEditable;}
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey)return;
    const typing=isTypingTarget(event.target);
    if(event.key==='Escape'){
      if(playerState){event.preventDefault();closeClassroomPlayer();return;}
      if(document.querySelector('dialog[open]'))return;
      if(overlay.classList.contains('open')){event.preventDefault();closeAssistant();return;}
    }
    if(!playerState||typing)return;
    if(event.key==='f'||event.key==='F'){event.preventDefault();togglePlayerFullscreen();return;}
    if(event.key==='ArrowLeft'||event.key==='PageUp'){
      event.preventDefault();
      if(playerState.kind==='presentation')document.querySelector('#presentationPlayer [data-presentation-prev]')?.click();
      else if(playerState.kind==='quiz')document.querySelector('#quizPlayer [data-quiz-player-prev]')?.click();
      return;
    }
    if(event.key==='ArrowRight'||event.key==='PageDown'||event.key===' '){
      event.preventDefault();
      if(playerState.kind==='presentation')document.querySelector('#presentationPlayer [data-presentation-next],#presentationPlayer [data-close-player].primary')?.click();
      else if(playerState.kind==='quiz')document.querySelector('#quizPlayer [data-quiz-player-start],#quizPlayer [data-quiz-player-reveal],#quizPlayer [data-quiz-player-next]')?.click();
    }
  });
  document.addEventListener('fullscreenchange',updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange',updateFullscreenButton);

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
