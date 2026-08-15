(() => {
  'use strict';

  const BUILD = window.SAMOS_BUILD || '0.9.0';
  const STORE_KEY = 'samos.classroom.data';
  const LEGACY_KEYS = ['samos.classroom.v3','samos.classroom.v2','samos.classroom.v1'];
  const SHELL_BUILD_KEY = 'samos.shell.build';
  const RESOURCE_DB = 'samos.resource.files';
  const RESOURCE_STORE = 'files';
  const $ = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => [...r.querySelectorAll(s)];
  const clone = v => JSON.parse(JSON.stringify(v));
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
  const todayKey = () => new Date().toISOString().slice(0,10);
  const prettyDate = (d=new Date()) => d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  const weekdayName = () => new Date().toLocaleDateString('en-GB',{weekday:'long'});
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
    resourceFilter:'all'
  };

  let state = loadState();
  let editingRegisterId = null;
  let assistantRoute = 'main';
  let assistantReturn = 'main';
  let assistantCloseFrame = 0;
  let installPrompt = null;

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
    const add=l=>{if(!l?.name)return;const id=l.id||uid();if(!byId.has(id))byId.set(id,{id,name:String(l.name).trim(),externalId:String(l.externalId||'').trim()});};
    (Array.isArray(saved)?saved:[]).forEach(add);
    classes.forEach(c=>(Array.isArray(c.learners)?c.learners:[]).forEach(add));
    return [...byId.values()];
  }

  function loadState(){
    const saved=readStoredState();
    if(!saved)return clone(defaultState);
    const classes=Array.isArray(saved.classes)?saved.classes.map(c=>({...c,learners:Array.isArray(c.learners)?c.learners:[]})):[];
    const merged={...clone(defaultState),...saved,settings:{...defaultState.settings,...(saved.settings||{})},learners:normaliseLearners(saved.learners,classes),classes,attendance:saved.attendance&&typeof saved.attendance==='object'?saved.attendance:{},history:Array.isArray(saved.history)?saved.history:[],resources:Array.isArray(saved.resources)?saved.resources:[],view:'home'};
    try{localStorage.setItem(STORE_KEY,JSON.stringify(merged));}catch(_){ }
    return merged;
  }

  function save(render=true){
    localStorage.setItem(STORE_KEY,JSON.stringify(state));
    if(render)render();
  }

  function toast(message){
    const el=$('#saveToast');el.textContent=message;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2400);
  }

  function activeRegister(){return state.classes.find(c=>c.id===state.activeClassId)||null;}
  function attendanceKey(id,date=todayKey()){return `${id}:${date}`;}
  function attendance(id){const key=attendanceKey(id);if(!state.attendance[key])state.attendance[key]={};return state.attendance[key];}
  function selectUsefulRegister(){if(activeRegister())return;const day=weekdayName();state.activeClassId=state.classes.find(c=>c.day===day)?.id||state.classes[0]?.id||null;}

  function registerStats(reg=activeRegister()){
    if(!reg)return{total:0,present:0,late:0,absent:0,marked:0,markedIn:0,percent:0};
    const a=attendance(reg.id),rows=reg.learners||[],total=rows.length;
    const present=rows.filter(l=>a[l.id]?.status==='present').length;
    const late=rows.filter(l=>a[l.id]?.status==='late').length;
    const absent=rows.filter(l=>a[l.id]?.status==='absent').length;
    const marked=present+late+absent;
    return{total,present,late,absent,marked,markedIn:present+late,percent:total?Math.round(marked/total*100):0};
  }

  function homeMetrics(){
    const assigned=new Set(state.classes.flatMap(c=>(c.learners||[]).map(l=>l.id)));
    const learners=state.learners.length?Math.round(state.learners.filter(l=>assigned.has(l.id)).length/state.learners.length*100):0;
    const registers=registerStats().percent;
    const kinds=new Set(state.resources.map(r=>r.type));
    const resources=Math.min(100,(kinds.has('powerpoint')?50:0)+(kinds.has('lesson-plan')?50:0));
    return{learners,registers,resources,games:0};
  }

  function arch(label,value,key){
    return `<button class="vh-arch" type="button" data-home-metric="${key}" aria-label="Open ${label.toLowerCase()}"><strong>${label}</strong><svg viewBox="0 0 80 43" aria-hidden="true"><path class="vh-track" d="M8 39 A32 32 0 0 1 72 39"/><path class="vh-value" pathLength="100" style="stroke-dasharray:${value} 100" d="M8 39 A32 32 0 0 1 72 39"/></svg><span>${value}%</span></button>`;
  }

  function setHomeMode(on){
    document.body.classList.toggle('samos-home-centred',on);
    facePanel.hidden=!on;
  }

  function render(){
    if(state.view==='home')renderHome();
    else if(state.view==='learners')renderLearnersPage();
    else if(state.view==='registers')renderRegistersPage();
    else if(state.view==='resources')renderResourcesPage();
    else if(state.view==='games')renderGamesPage();
    else renderHome();
  }

  function renderHome(){
    state.view='home';setHomeMode(true);
    const m=homeMetrics();
    app.innerHTML=`<section class="assessor-value-home" aria-label="Classroom overview"><div class="vh-arches">${arch('LEARNERS',m.learners,'learners')}${arch('REGISTERS',m.registers,'registers')}${arch('RESOURCES',m.resources,'resources')}${arch('GAMES',m.games,'games')}</div></section>`;
  }

  function breadcrumb(title,sub='CLASSROOM'){return `<div class="staff-page-head"><button class="staff-back" type="button" data-home-back>←</button><div><small>${esc(sub)}</small><h1>${esc(title)}</h1></div></div>`;}

  function renderLearnersPage(){
    setHomeMode(false);
    const rows=[...state.learners].sort((a,b)=>a.name.localeCompare(b.name));
    app.innerHTML=`${breadcrumb('Learners')}<button class="blue-button full" type="button" data-add-learner>+ Add learner</button><section class="staff-card"><div class="samos-section-head"><h2>Learners</h2><small>${rows.length} saved</small></div><div class="learner-list">${rows.length?rows.map(l=>{const n=state.classes.filter(c=>(c.learners||[]).some(x=>x.id===l.id)).length;return `<button class="learner-row" type="button" data-learner-info="${attr(l.id)}"><span><strong>${esc(l.name)}</strong><small>${esc(l.externalId||'No learner ID')} · ${n} register${n===1?'':'s'}</small></span><span class="mini-progress"><b>${n}</b><small>REG</small></span></button>`}).join(''):'<div class="empty-state"><strong>No learners yet</strong><p>Add your first learner to begin.</p></div>'}</div></section>`;
  }

  function renderRegistersPage(){
    setHomeMode(false);selectUsefulRegister();const reg=activeRegister();
    const chips=state.classes.map(c=>`<button class="${c.id===state.activeClassId?'active':''}" type="button" data-select-register="${attr(c.id)}">${esc(c.name)}</button>`).join('');
    app.innerHTML=`${breadcrumb('Registers','ATTENDANCE')}<div class="inline-actions"><button class="blue-button" type="button" data-new-register>+ Register</button><button class="soft-button" type="button" data-register-list>Register list</button></div>${state.classes.length?`<div class="segmented samos-register-picker">${chips}</div>`:''}<div id="registerWorkspace"></div>`;
    renderRegisterWorkspace(reg);
  }

  function renderRegisterWorkspace(reg){
    const host=$('#registerWorkspace');if(!host)return;
    if(!reg){host.innerHTML='<section class="staff-card"><div class="empty-state"><strong>No registers yet</strong><p>Create a register, then add learners from your learner directory.</p></div></section>';return;}
    const s=registerStats(reg),a=attendance(reg.id);
    host.innerHTML=`<section class="staff-card"><div class="section-title"><div><h2>${esc(reg.name)}</h2><small>${esc([reg.day,`${reg.start||'09:00'}–${reg.end||'16:00'}`,reg.room].filter(Boolean).join(' · '))}</small></div><span class="status-pill">${esc(prettyDate())}</span></div><div class="register-summary"><div><strong>${s.present}</strong><span>Present</span></div><div><strong>${s.late}</strong><span>Late</span></div><div><strong>${s.absent}</strong><span>Absent</span></div><button type="button" data-mark-all>Mark all present</button></div><div class="inline-actions"><button class="soft-button" type="button" data-edit-register>Edit register</button><button class="blue-button" type="button" data-assign-learners>+ Learners</button></div><div class="attendance-list">${(reg.learners||[]).length?(reg.learners||[]).map(l=>attendanceRow(l,a[l.id])).join(''):'<div class="empty-state"><strong>No learners on this register</strong><p>Add learners from your learner directory.</p></div>'}</div>${(reg.learners||[]).length?'<button class="blue-button full" type="button" data-finish-register>Finish register</button>':''}</section><section class="staff-card"><div class="samos-section-head"><h2>Recent completed registers</h2><small>${state.history.filter(h=>h.classId===reg.id).length} saved</small></div>${historyHtml(reg.id)}</section>`;
  }

  function attendanceRow(l,record={}){
    const status=record?.status||'unmarked',mins=Number(record?.lateMinutes)||0;
    return `<div class="attendance-row" data-attendance-learner="${attr(l.id)}"><div class="attendance-name"><strong>${esc(l.name)}</strong><small>${esc(l.externalId||'No learner ID')}</small>${status==='late'?`<label class="late-field"><input type="number" min="0" max="240" step="1" value="${mins}" data-late-minutes><span>minutes late</span></label>`:''}</div><div class="attendance-controls"><button class="${status==='present'?'active':''}" type="button" data-status="present">P</button><button class="${status==='late'?'active':''}" type="button" data-status="late">L</button><button class="${status==='absent'?'active':''}" type="button" data-status="absent">A</button></div></div>`;
  }

  function historyHtml(classId=null){
    const rows=state.history.filter(h=>!classId||h.classId===classId).slice(0,8);
    return rows.length?rows.map(h=>`<div class="samos-row"><span><strong>${esc(h.className)}</strong><small>${esc(h.dateLabel)} · ${h.total} learners</small><em>${h.present+h.late}/${h.total} attended</em></span></div>`).join(''):'<div class="samos-empty"><strong>No completed registers</strong><p>Finished registers will appear here.</p></div>';
  }

  function renderRegisterList(){
    setHomeMode(false);state.view='registers';
    app.innerHTML=`${breadcrumb('Register list','ATTENDANCE')}<button class="blue-button full" type="button" data-new-register>+ Create register</button><section class="staff-card"><div class="samos-section-head"><h2>Registers</h2><small>${state.classes.length} saved</small></div>${state.classes.length?state.classes.map(c=>`<button class="samos-row" type="button" data-open-register="${attr(c.id)}"><span><strong>${esc(c.name)}</strong><small>${esc([c.day,`${c.start||'09:00'}–${c.end||'16:00'}`,c.room].filter(Boolean).join(' · '))}</small><em>${(c.learners||[]).length} learner${(c.learners||[]).length===1?'':'s'}</em></span><b>›</b></button>`).join(''):'<div class="samos-empty"><strong>No registers yet</strong><p>Create your first register.</p></div>'}</section><section class="staff-card"><div class="samos-section-head"><h2>Completed registers</h2><small>${state.history.length} saved</small></div>${historyHtml()}</section>`;
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

  function renderGamesPage(){
    setHomeMode(false);
    app.innerHTML=`${breadcrumb('Games','ACTIVITIES')}<section class="staff-card"><div class="empty-state"><strong>Classroom games</strong><p>Quizzes, random pickers, team games and quick recap activities will be added here.</p></div></section>`;
  }

  function goHome(){state.view='home';save();window.scrollTo({top:0,behavior:'auto'});}
  function openView(view){closeAssistant();state.view=view;if(view==='registers')selectUsefulRegister();save();window.scrollTo({top:0,behavior:'auto'});}

  /* ---------------- Assistant: exact current Tilos structure ---------------- */
  function copy(title,sub){prompt.textContent=title;hint.textContent=sub;}
  function openAssistant(route='main'){
    if(assistantCloseFrame){cancelAnimationFrame(assistantCloseFrame);assistantCloseFrame=0;}
    overlay.classList.remove('samos-closing');
    assistantRoute=route;assistantReturn='main';overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');document.body.classList.add('evia-open');window.EviaAnimations?.setBusy?.(true);renderAssistant();$('#samosClose')?.focus();
  }
  function closeAssistant(){
    if(!overlay.classList.contains('open')){overlay.classList.remove('samos-closing');document.body.classList.remove('evia-open');window.EviaAnimations?.setBusy?.(false);assistantRoute='main';return;}
    if(assistantCloseFrame){cancelAnimationFrame(assistantCloseFrame);assistantCloseFrame=0;}
    /* Prevent the overlay face cross-fading over the centred home face. That overlap looked like Samos jumped down the screen. */
    window.EviaAnimations?.setBusy?.(true);
    overlay.classList.add('samos-closing');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden','true');
    document.body.classList.remove('evia-open');
    assistantRoute='main';
    assistantCloseFrame=requestAnimationFrame(()=>{assistantCloseFrame=0;overlay.classList.remove('samos-closing');window.EviaAnimations?.setBusy?.(false);});
  }
  function assistantBack(){if(assistantRoute==='main')return closeAssistant();if(assistantRoute.startsWith('learners:'))return assistantLearners();if(assistantRoute.startsWith('registers:'))return assistantRegisters();if(assistantRoute.startsWith('resources:'))return assistantResources();assistantRoute='main';renderAssistant();}
  function renderAssistant(){
    if(assistantRoute==='main')return assistantMain();
    if(assistantRoute==='learners')return assistantLearners();
    if(assistantRoute==='registers')return assistantRegisters();
    if(assistantRoute==='resources')return assistantResources();
    if(assistantRoute==='games')return assistantGames();
    return assistantMain();
  }
  function assistantMain(){
    assistantRoute='main';const reg=activeRegister(),rs=registerStats(reg);
    copy('What do you need?','Everything is organised into four clear areas.');
    content.innerHTML=`<div class="ta-menu as-main v39-main"><button data-assistant="learners"><strong>Learners</strong><span>${state.learners.length} learner${state.learners.length===1?'':'s'} saved.</span></button><button data-assistant="registers"><strong>Registers</strong><span>${reg?`${esc(reg.name)} · ${rs.marked}/${rs.total} marked today`:'Create and manage classroom registers.'}</span></button><button data-assistant="resources"><strong>Resources</strong><span>${state.resources.length} teaching resource${state.resources.length===1?'':'s'} saved.</span></button><button data-assistant="games"><strong>Games</strong><span>Classroom games, quizzes and recap activities.</span></button></div>`;
    window.EviaAnimations?.react?.('analysing');
  }
  function assistantLearners(q=''){
    assistantRoute='learners';copy('Learners','Search your classroom or add a learner.');
    content.innerHTML=`<div class="v39-learner-tools"><label><span>Find learner</span><input id="assistantLearnerSearch" type="search" value="${attr(q)}" placeholder="Learner name or ID" autocomplete="off"></label><button type="button" data-assistant-add-learner>+ Add learner</button></div><div id="assistantLearnerResults" class="v39-learner-list"></div>`;
    renderAssistantLearnerResults(q);
  }
  function renderAssistantLearnerResults(q=''){
    const box=$('#assistantLearnerResults');if(!box)return;const term=String(q).trim().toLowerCase();const rows=state.learners.filter(l=>!term||`${l.name} ${l.externalId||''}`.toLowerCase().includes(term)).sort((a,b)=>a.name.localeCompare(b.name));
    box.innerHTML=rows.length?rows.map(l=>{const n=state.classes.filter(c=>(c.learners||[]).some(x=>x.id===l.id)).length;return `<button class="v39-learner-row" type="button" data-assistant-learner="${attr(l.id)}"><span><strong>${esc(l.name)}</strong><small>${esc(l.externalId||'No learner ID')}</small></span><i><b>REGISTERS</b><strong>${n}</strong><small>assigned</small></i></button>`}).join(''):'<div class="v39-empty"><strong>No matching learners</strong><span>Try another name or create a learner.</span></div>';
  }
  function assistantRegisters(){
    assistantRoute='registers';const reg=activeRegister();copy('Registers',reg?'Open today’s register, manage registers or create one.':'Create your first classroom register.');
    content.innerHTML=`<div class="ta-menu"><button data-assistant-action="registers:today"><strong>Today’s register</strong><span>${reg?`${esc(reg.name)} · ${registerStats(reg).percent}% marked`:'No register selected yet.'}</span></button><button data-assistant-action="registers:list"><strong>List of registers</strong><span>${state.classes.length} register${state.classes.length===1?'':'s'} saved.</span></button><button data-assistant-action="registers:create"><strong>Create register</strong><span>Add a new classroom register.</span></button></div>`;
  }
  function assistantResources(){
    assistantRoute='resources';copy('Resources','PowerPoints, lesson plans and teaching resources.');
    content.innerHTML=`<div class="ta-menu"><button data-assistant-action="resources:powerpoints"><strong>PowerPoints</strong><span>Open your PowerPoint resource library.</span></button><button data-assistant-action="resources:lessons"><strong>Lesson plans</strong><span>Open your saved lesson plans.</span></button><button data-assistant-action="resources:upload"><strong>Upload resource</strong><span>Add a PowerPoint, PDF, document or image.</span></button><button data-assistant-action="resources:create"><strong>Create resource</strong><span>Create a lesson plan or teaching resource in Samos.</span></button></div>`;
  }
  function assistantGames(){
    assistantRoute='games';copy('Games','Classroom games and recap activities.');
    content.innerHTML=`<div class="ta-card"><div class="v39-empty"><strong>Games are ready for the next build</strong><span>Quizzes, random pickers, team games and quick checks will live here.</span></div><div class="ta-actions"><button class="primary" type="button" data-assistant-open-games>Open Games</button></div></div>`;
  }

  /* ---------------- dialogs / editing ---------------- */
  function openLearnerDialog(){
    $('#learnerNameInput').value='';$('#learnerIdInput').value='';$('#learnerDialog').showModal();setTimeout(()=>$('#learnerNameInput').focus(),60);
  }
  function saveLearner(){const name=$('#learnerNameInput').value.trim();if(!name)return false;state.learners.push({id:uid(),name,externalId:$('#learnerIdInput').value.trim()});save(false);toast('Learner saved');if(overlay.classList.contains('open'))setTimeout(()=>assistantLearners(),0);else render();return true;}

  function openRegisterDialog(edit=false,id=null){
    const reg=edit?state.classes.find(c=>c.id===(id||state.activeClassId)):null;editingRegisterId=reg?.id||null;$('#registerDialogTitle').textContent=edit?'Edit register':'New register';$('#registerNameInput').value=reg?.name||'';$('#registerDayInput').value=reg?.day||weekdayName();$('#registerRoomInput').value=reg?.room||'';$('#registerStartInput').value=reg?.start||'09:00';$('#registerEndInput').value=reg?.end||'16:00';$('#deleteRegisterBtn').classList.toggle('show',!!edit);$('#registerDialog').showModal();setTimeout(()=>$('#registerNameInput').focus(),60);
  }
  function saveRegister(){
    const name=$('#registerNameInput').value.trim();if(!name)return false;const values={name,day:$('#registerDayInput').value,room:$('#registerRoomInput').value.trim(),start:$('#registerStartInput').value||'09:00',end:$('#registerEndInput').value||'16:00'};
    if(editingRegisterId){Object.assign(state.classes.find(c=>c.id===editingRegisterId),values);}else{const reg={id:uid(),...values,learners:[]};state.classes.push(reg);state.activeClassId=reg.id;}
    save(false);toast(editingRegisterId?'Register updated':'Register created');editingRegisterId=null;if(overlay.classList.contains('open')){closeAssistant();state.view='registers';}render();return true;
  }
  function deleteRegister(){const reg=state.classes.find(c=>c.id===editingRegisterId);if(!reg||!confirm(`Delete ${reg.name}?`))return;state.classes=state.classes.filter(c=>c.id!==reg.id);Object.keys(state.attendance).filter(k=>k.startsWith(`${reg.id}:`)).forEach(k=>delete state.attendance[k]);state.activeClassId=state.classes[0]?.id||null;$('#registerDialog').close();editingRegisterId=null;save();toast('Register deleted');}

  function openAssignDialog(){
    const reg=activeRegister();if(!reg){toast('Create or select a register first');return;}if(!state.learners.length){toast('Create a learner first');openLearnerDialog();return;}
    const assigned=new Set((reg.learners||[]).map(l=>l.id));const available=state.learners.filter(l=>!assigned.has(l.id));const box=$('#assignLearnerList');box.innerHTML=available.length?available.sort((a,b)=>a.name.localeCompare(b.name)).map(l=>`<label class="assign-option"><input type="checkbox" value="${attr(l.id)}"><span><strong>${esc(l.name)}</strong><span>${esc(l.externalId||'No learner ID')}</span></span></label>`).join(''):'<div class="samos-empty"><strong>Everyone is already assigned</strong><p>There are no more learners to add.</p></div>';$('#assignDialog').showModal();
  }
  function assignLearners(){const reg=activeRegister();if(!reg)return false;const ids=$$('#assignLearnerList input:checked').map(x=>x.value);if(!ids.length){toast('Choose at least one learner');return false;}const existing=new Set((reg.learners||[]).map(l=>l.id));ids.forEach(id=>{const l=state.learners.find(x=>x.id===id);if(l&&!existing.has(id))reg.learners.push(clone(l));});save();toast(`${ids.length} learner${ids.length===1?'':'s'} added`);return true;}

  function markStatus(learnerId,status){const reg=activeRegister();if(!reg)return;const a=attendance(reg.id);a[learnerId]=a[learnerId]||{lateMinutes:0};a[learnerId].status=status;if(status!=='late')a[learnerId].lateMinutes=0;save();toast('Attendance saved');}
  function markAll(){const reg=activeRegister();if(!reg)return;const a=attendance(reg.id);(reg.learners||[]).forEach(l=>a[l.id]={status:'present',lateMinutes:0});save();toast('Everyone marked present');}
  function finishRegister(){const reg=activeRegister();if(!reg)return;const a=attendance(reg.id),unmarked=(reg.learners||[]).filter(l=>!['present','late','absent'].includes(a[l.id]?.status));if(unmarked.length&&!confirm(`${unmarked.length} learner${unmarked.length===1?' is':'s are'} still unmarked. Finish anyway?`))return;const rows=reg.learners||[];state.history.unshift({id:uid(),classId:reg.id,className:reg.name,date:todayKey(),dateLabel:prettyDate(),total:rows.length,present:rows.filter(l=>a[l.id]?.status==='present').length,late:rows.filter(l=>a[l.id]?.status==='late').length,absent:rows.filter(l=>a[l.id]?.status==='absent').length,data:clone(a)});state.history=state.history.slice(0,100);save();toast('Register finished and saved');}

  function openResourceDialog(type='lesson-plan'){ $('#resourceTypeInput').value=type;$('#resourceTitleInput').value='';$('#resourceNotesInput').value='';$('#resourceDialog').showModal();setTimeout(()=>$('#resourceTitleInput').focus(),60); }
  function saveResource(){const title=$('#resourceTitleInput').value.trim();if(!title)return false;const type=$('#resourceTypeInput').value;state.resources.push({id:uid(),type,title,notes:$('#resourceNotesInput').value.trim(),kind:'created',createdAt:new Date().toISOString()});state.resourceFilter=type;save(false);toast('Resource saved');if(overlay.classList.contains('open')){closeAssistant();state.view='resources';}render();return true;}
  function detectType(file){return /\.(ppt|pptx)$/i.test(file?.name||'')?'powerpoint':'other';}
  function openResourceDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(RESOURCE_DB,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(RESOURCE_STORE))db.createObjectStore(RESOURCE_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function putFile(id,file){const db=await openResourceDb();await new Promise((resolve,reject)=>{const tx=db.transaction(RESOURCE_STORE,'readwrite');tx.objectStore(RESOURCE_STORE).put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();}
  async function getFile(id){const db=await openResourceDb();const blob=await new Promise((resolve,reject)=>{const tx=db.transaction(RESOURCE_STORE,'readonly'),req=tx.objectStore(RESOURCE_STORE).get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)});db.close();return blob;}
  async function removeFile(id){try{const db=await openResourceDb();await new Promise((resolve,reject)=>{const tx=db.transaction(RESOURCE_STORE,'readwrite');tx.objectStore(RESOURCE_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();}catch(_){}}
  async function importResource(file){if(!file)return;const id=uid(),type=detectType(file);try{await putFile(id,file);state.resources.push({id,type,title:file.name.replace(/\.[^.]+$/,''),kind:'upload',fileName:file.name,mime:file.type||'',size:file.size||0,createdAt:new Date().toISOString()});state.resourceFilter=type;save(false);toast('Resource uploaded');if(overlay.classList.contains('open'))closeAssistant();state.view='resources';render();}catch(_){toast('This file could not be saved on this device');}$('#resourceFileInput').value='';}
  async function openResource(id){const r=state.resources.find(x=>x.id===id);if(!r)return;try{const blob=await getFile(id);if(!blob){toast('Stored file could not be found');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=r.fileName||r.title||'resource';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}catch(_){toast('Resource could not be opened');}}
  async function deleteResource(id){const r=state.resources.find(x=>x.id===id);if(!r||!confirm(`Delete ${r.title}?`))return;state.resources=state.resources.filter(x=>x.id!==id);save();if(r.kind==='upload')await removeFile(id);toast('Resource deleted');}

  function openProfile(){ $('#teacherNameInput').value=state.settings.teacherName||'';$('#centreInput').value=state.settings.centre||'';$('#profileDialog').showModal(); }
  function saveProfile(){state.settings.teacherName=$('#teacherNameInput').value.trim();state.settings.centre=$('#centreInput').value.trim();save(false);toast('Profile saved');return true;}

  /* ---------------- events ---------------- */
  app.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.hasAttribute('data-home-back'))return goHome();
    if(b.dataset.homeMetric)return openAssistant(b.dataset.homeMetric);
    if(b.hasAttribute('data-add-learner'))return openLearnerDialog();
    if(b.dataset.learnerInfo){const l=state.learners.find(x=>x.id===b.dataset.learnerInfo);if(l)toast(`${l.name} · ${l.externalId||'No learner ID'}`);return;}
    if(b.hasAttribute('data-new-register'))return openRegisterDialog(false);
    if(b.hasAttribute('data-register-list'))return renderRegisterList();
    if(b.dataset.selectRegister){state.activeClassId=b.dataset.selectRegister;save();return;}
    if(b.dataset.openRegister){state.activeClassId=b.dataset.openRegister;state.view='registers';save();return;}
    if(b.hasAttribute('data-edit-register'))return openRegisterDialog(true);
    if(b.hasAttribute('data-assign-learners'))return openAssignDialog();
    if(b.hasAttribute('data-mark-all'))return markAll();
    if(b.hasAttribute('data-finish-register'))return finishRegister();
    if(b.dataset.status){const row=b.closest('[data-attendance-learner]');if(row)return markStatus(row.dataset.attendanceLearner,b.dataset.status);}
    if(b.hasAttribute('data-create-resource'))return openResourceDialog();
    if(b.hasAttribute('data-upload-resource'))return $('#resourceFileInput').click();
    if(b.dataset.resourceFilter){state.resourceFilter=b.dataset.resourceFilter;save();return;}
    if(b.hasAttribute('data-open-resource'))return openResource(b.closest('[data-resource-id]')?.dataset.resourceId);
    if(b.hasAttribute('data-delete-resource'))return deleteResource(b.closest('[data-resource-id]')?.dataset.resourceId);
  });

  app.addEventListener('change',event=>{
    if(event.target.hasAttribute('data-late-minutes')){const reg=activeRegister(),row=event.target.closest('[data-attendance-learner]');if(!reg||!row)return;const a=attendance(reg.id);a[row.dataset.attendanceLearner]=a[row.dataset.attendanceLearner]||{status:'late'};a[row.dataset.attendanceLearner].status='late';a[row.dataset.attendanceLearner].lateMinutes=Math.max(0,Math.min(240,Number(event.target.value)||0));save();toast('Lateness saved');}
  });

  $('#eviaFace').addEventListener('click',()=>openAssistant('main'));
  $('#samosClose').addEventListener('click',closeAssistant);
  $('#samosBack').addEventListener('click',assistantBack);
  content.addEventListener('input',event=>{if(event.target.id==='assistantLearnerSearch')renderAssistantLearnerResults(event.target.value)});
  content.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.assistant){assistantRoute=b.dataset.assistant;return renderAssistant();}
    if(b.hasAttribute('data-assistant-add-learner'))return openLearnerDialog();
    if(b.dataset.assistantLearner){const l=state.learners.find(x=>x.id===b.dataset.assistantLearner);if(l){copy(l.name,'Learner overview');const n=state.classes.filter(c=>(c.learners||[]).some(x=>x.id===l.id)).length;content.innerHTML=`<div class="ta-context"><span><small>LEARNER</small><strong>${esc(l.name)}</strong><em>${esc(l.externalId||'No learner ID')}</em></span></div><div class="ta-menu"><button data-assistant-action="learner:registers"><strong>Registers</strong><span>${n} register${n===1?'':'s'} assigned.</span></button><button data-assistant-action="learner:directory"><strong>Open learner directory</strong><span>View the full classroom learner list.</span></button></div>`;assistantRoute='learners:detail';assistantReturn='learners';}return;}
    if(b.dataset.assistantAction){const a=b.dataset.assistantAction;if(a==='registers:today'){closeAssistant();state.view='registers';selectUsefulRegister();save();}else if(a==='registers:list'){closeAssistant();renderRegisterList();}else if(a==='registers:create')openRegisterDialog(false);else if(a==='resources:powerpoints'){closeAssistant();state.view='resources';state.resourceFilter='powerpoint';save();}else if(a==='resources:lessons'){closeAssistant();state.view='resources';state.resourceFilter='lesson-plan';save();}else if(a==='resources:upload')$('#resourceFileInput').click();else if(a==='resources:create')openResourceDialog('lesson-plan');else if(a==='learner:registers'){closeAssistant();state.view='registers';selectUsefulRegister();save();}else if(a==='learner:directory'){closeAssistant();state.view='learners';save();}return;}
    if(b.hasAttribute('data-assistant-open-games')){closeAssistant();state.view='games';save();}
  });

  $('#learnerForm').addEventListener('submit',e=>{if(!saveLearner())e.preventDefault()});
  $('#registerForm').addEventListener('submit',e=>{if(!saveRegister())e.preventDefault()});
  $('#assignForm').addEventListener('submit',e=>{if(!assignLearners())e.preventDefault()});
  $('#resourceForm').addEventListener('submit',e=>{if(!saveResource())e.preventDefault()});
  $('#profileForm').addEventListener('submit',e=>{if(!saveProfile())e.preventDefault()});
  $('#deleteRegisterBtn').addEventListener('click',deleteRegister);
  $('#resourceFileInput').addEventListener('change',e=>importResource(e.target.files?.[0]));
  $('#profileButton').addEventListener('click',openProfile);
  $('#helpButton').addEventListener('click',()=>openAssistant('main'));

  /* PWA update/cache reset on every build. */
  async function clearOldShellCaches(){if(!('caches' in window))return;const keys=await caches.keys();await Promise.all(keys.filter(k=>/^samos-/i.test(k)&&k!==`samos-${BUILD}`).map(k=>caches.delete(k)));}
  async function shellRefresh(){try{const previous=localStorage.getItem(SHELL_BUILD_KEY);if(previous!==BUILD){await clearOldShellCaches();localStorage.setItem(SHELL_BUILD_KEY,BUILD);if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration();await reg?.update?.();}}}catch(_){}}
  if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register(`./service-worker.js?v=${BUILD}`).then(reg=>reg.update()).catch(()=>{});
  shellRefresh();
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installApp').hidden=false;});
  $('#installApp').addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice.catch(()=>{});installPrompt=null;$('#installApp').hidden=true;});
  window.addEventListener('appinstalled',()=>{$('#installApp').hidden=true;installPrompt=null;});

  /* Same Tilos motion system, using Samos home face. */
  window.EviaAnimations?.init?.($('#eviaFace'));

  /* Keep Naxos and diagnostics able to inspect the live app. */
  window.SamosApp={build:BUILD,getState:()=>clone(state),goHome,openAssistantMenu:()=>openAssistant('main'),openLearners:()=>{state.view='learners';save()},openRegisters:()=>{state.view='registers';selectUsefulRegister();save()},openResources:()=>{state.view='resources';save()},clearOldShellCaches};

  render();
})();
