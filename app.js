(() => {
  'use strict';

  const BUILD = window.SAMOS_BUILD || '0.7.0';
  const STORE_KEY = 'samos.classroom.data';
  const LEGACY_KEYS = ['samos.classroom.v3','samos.classroom.v2','samos.classroom.v1'];
  const SHELL_BUILD_KEY = 'samos.shell.build';
  const RESOURCE_DB = 'samos.resource.files';
  const RESOURCE_STORE = 'files';
  const METER_LEN = 157;
  const todayKey = () => new Date().toISOString().slice(0,10);
  const prettyDate = (date=new Date()) => date.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  const weekdayName = () => new Date().toLocaleDateString('en-GB',{weekday:'long'});
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const $ = (sel,root=document) => root.querySelector(sel);
  const $$ = (sel,root=document) => [...root.querySelectorAll(sel)];

  const defaultState = {
    settings:{teacherName:'',centre:''},
    learners:[],
    classes:[],
    activeClassId:null,
    attendance:{},
    history:[],
    resources:[],
    activeSection:'registers',
    currentView:'home',
    registerMode:'today',
    resourceFilter:'all'
  };

  let state = loadState();
  let editingRegisterId = null;
  let assistantMenuSection = null;

  function readStoredState(){
    for(const key of [STORE_KEY,...LEGACY_KEYS]){
      try{
        const raw=localStorage.getItem(key);
        if(!raw)continue;
        const parsed=JSON.parse(raw);
        if(parsed&&typeof parsed==='object')return parsed;
      }catch(_){ }
    }
    return null;
  }

  function normaliseLearners(saved,classes){
    const byId=new Map();
    const add=learner=>{
      if(!learner||!learner.name)return;
      const id=learner.id||uid();
      if(!byId.has(id))byId.set(id,{id,name:String(learner.name).trim(),externalId:String(learner.externalId||'').trim()});
    };
    (Array.isArray(saved)?saved:[]).forEach(add);
    classes.forEach(cls=>(Array.isArray(cls.learners)?cls.learners:[]).forEach(add));
    return [...byId.values()];
  }

  function loadState(){
    const saved=readStoredState();
    if(!saved)return clone(defaultState);
    const classes=Array.isArray(saved.classes)?saved.classes.map(cls=>({...cls,learners:Array.isArray(cls.learners)?cls.learners:[]})):[];
    const merged={
      ...clone(defaultState),
      ...saved,
      settings:{...defaultState.settings,...(saved.settings||{})},
      learners:normaliseLearners(saved.learners,classes),
      classes,
      attendance:saved.attendance&&typeof saved.attendance==='object'?saved.attendance:{},
      history:Array.isArray(saved.history)?saved.history:[],
      resources:Array.isArray(saved.resources)?saved.resources:[],
      currentView:'home',
      registerMode:saved.registerMode||'today',
      resourceFilter:saved.resourceFilter||'all'
    };
    try{localStorage.setItem(STORE_KEY,JSON.stringify(merged));}catch(_){ }
    return merged;
  }

  function saveState(render=true){
    localStorage.setItem(STORE_KEY,JSON.stringify(state));
    if(render)renderAll();
  }

  function persistQuick(message){
    saveState(true);
    showToast(message);
  }

  function showToast(message){
    const toast=$('#toast');
    if(!toast)return;
    toast.textContent=message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer=setTimeout(()=>toast.classList.remove('show'),2100);
  }

  function activeRegister(){return state.classes.find(c=>c.id===state.activeClassId)||null;}
  function attendanceKey(registerId,date=todayKey()){return `${registerId}:${date}`;}
  function getAttendance(registerId){
    const key=attendanceKey(registerId);
    if(!state.attendance[key])state.attendance[key]={};
    return state.attendance[key];
  }

  function registerStats(){
    const reg=activeRegister();
    if(!reg)return{total:0,present:0,late:0,absent:0,marked:0,markedIn:0,percent:0};
    const att=getAttendance(reg.id);
    const learners=reg.learners||[];
    const total=learners.length;
    const present=learners.filter(l=>att[l.id]?.status==='present').length;
    const late=learners.filter(l=>att[l.id]?.status==='late').length;
    const absent=learners.filter(l=>att[l.id]?.status==='absent').length;
    const marked=present+late+absent;
    return{total,present,late,absent,marked,markedIn:present+late,percent:total?Math.round(marked/total*100):0};
  }

  function goHome(){
    closeAssistantMenu();
    state.currentView='home';
    saveState();
    window.scrollTo({top:0,behavior:'auto'});
  }

  function openLearners(){
    closeAssistantMenu();
    state.currentView='learners';
    saveState();
    window.scrollTo({top:0,behavior:'auto'});
  }

  function openRegisters(mode='today'){
    closeAssistantMenu();
    state.activeSection='registers';
    state.currentView='registers';
    state.registerMode=mode;
    if(mode==='today')selectUsefulRegister();
    saveState();
    window.scrollTo({top:0,behavior:'auto'});
  }

  function openResources(filter='all',activeSection='lessons'){
    closeAssistantMenu();
    state.currentView='resources';
    state.activeSection=activeSection;
    state.resourceFilter=filter;
    saveState();
    window.scrollTo({top:0,behavior:'auto'});
  }

  function openGames(){
    closeAssistantMenu();
    state.currentView='games';
    state.activeSection='games';
    saveState();
    window.scrollTo({top:0,behavior:'auto'});
  }

  function selectUsefulRegister(){
    const current=activeRegister();
    if(current)return;
    const today=weekdayName();
    state.activeClassId=state.classes.find(c=>c.day===today)?.id||state.classes[0]?.id||null;
  }

  function renderAll(){
    renderViews();
    renderMeters();
    renderLearnerDirectory();
    renderRegisters();
    renderRegisterTemplates();
    renderHistory();
    renderResources();
  }

  function renderViews(){
    const current=state.currentView||'home';
    document.body.classList.toggle('home-mode',current==='home');
    $$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===current));
    $$('.metric-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.section===state.activeSection));
  }

  function setMeter(section,percent){
    const path=$(`#meter-${section}`),value=$(`#value-${section}`);
    const p=Math.max(0,Math.min(100,Number(percent)||0));
    if(path)path.style.strokeDashoffset=String(METER_LEN-(p/100)*METER_LEN);
    if(value)value.textContent=`${Math.round(p)}%`;
  }

  function renderMeters(){
    setMeter('registers',registerStats().percent);
    setMeter('lessons',0);
    setMeter('slides',0);
    setMeter('games',0);
  }

  function renderLearnerDirectory(){
    const wrap=$('#learnerDirectory');
    if(!wrap)return;
    $('#learnerDirectoryCount').textContent=String(state.learners.length);
    wrap.innerHTML='';
    if(!state.learners.length){
      wrap.innerHTML='<div class="history-empty">No learners yet. Create your first learner from Samos or the + Learner button.</div>';
      return;
    }
    [...state.learners].sort((a,b)=>a.name.localeCompare(b.name)).forEach(learner=>{
      const assigned=state.classes.filter(c=>(c.learners||[]).some(l=>l.id===learner.id)).length;
      const item=document.createElement('div');
      item.className='directory-item';
      item.innerHTML=`<div class="directory-main"><div class="directory-avatar">${escapeHtml(initials(learner.name))}</div><div class="directory-copy"><strong>${escapeHtml(learner.name)}</strong><span>${learner.externalId?escapeHtml(learner.externalId):'No learner ID'} · ${assigned} register${assigned===1?'':'s'}</span></div></div>`;
      wrap.appendChild(item);
    });
  }

  function initials(name=''){
    return String(name).trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'?';
  }

  function renderRegisters(){
    const todaySection=$('#todayRegisterSection'),listSection=$('#registerListSection');
    if(!todaySection||!listSection)return;
    const mode=state.registerMode||'today';
    todaySection.classList.toggle('hidden',mode!=='today');
    listSection.classList.toggle('hidden',mode!=='list');
    $('#todayRegisterTab').classList.toggle('active',mode==='today');
    $('#registerListTab').classList.toggle('active',mode==='list');

    const strip=$('#classStrip');
    strip.innerHTML='';
    const today=weekdayName();
    const ordered=[...state.classes].sort((a,b)=>Number(b.day===today)-Number(a.day===today)||String(a.name).localeCompare(String(b.name)));
    ordered.forEach(reg=>{
      const b=document.createElement('button');
      b.type='button';
      b.className=`class-chip${reg.id===state.activeClassId?' active':''}`;
      b.textContent=reg.day===today?`${reg.name} · Today`:reg.name;
      b.addEventListener('click',()=>{state.activeClassId=reg.id;saveState();});
      strip.appendChild(b);
    });

    const reg=activeRegister();
    $('#noClassPanel').classList.toggle('hidden',!!reg);
    $('#registerPanel').classList.toggle('hidden',!reg);
    if(!reg)return;

    $('#registerDate').textContent=prettyDate().toUpperCase();
    $('#activeClassName').textContent=reg.name;
    $('#activeClassMeta').textContent=[reg.day,`${reg.start||'09:00'}–${reg.end||'16:00'}`,reg.room].filter(Boolean).join(' · ');

    const list=$('#learnerList');
    const att=getAttendance(reg.id);
    list.innerHTML='';
    if(!(reg.learners||[]).length){
      list.innerHTML='<div class="history-empty">No learners are on this register yet. Tap + Learners to add them from your learner directory.</div>';
    }

    (reg.learners||[]).forEach(learner=>{
      const record=att[learner.id]||{status:'unmarked',lateMinutes:0};
      const row=document.createElement('div');
      row.className='learner-row';
      row.innerHTML=`
        <div class="learner-info">
          <strong>${escapeHtml(learner.name)}</strong>
          <small>${learner.externalId?escapeHtml(learner.externalId):'No learner ID'}</small>
          <div class="learner-tools">
            <input class="late-minutes" type="number" min="0" max="240" step="1" value="${Number(record.lateMinutes)||0}" aria-label="Minutes late" ${record.status!=='late'?'disabled':''}>
            <span class="muted">min late</span>
            <button class="remove-learner" type="button">Remove</button>
          </div>
        </div>
        <div class="attendance-controls">
          <button class="attendance-btn ${record.status==='present'?'active':''}" data-status="present" type="button">P</button>
          <button class="attendance-btn ${record.status==='late'?'active':''}" data-status="late" type="button">L</button>
          <button class="attendance-btn ${record.status==='absent'?'active':''}" data-status="absent" type="button">A</button>
        </div>`;
      $$('.attendance-btn',row).forEach(btn=>btn.addEventListener('click',()=>{
        att[learner.id]=att[learner.id]||{lateMinutes:0};
        att[learner.id].status=btn.dataset.status;
        if(btn.dataset.status!=='late')att[learner.id].lateMinutes=0;
        persistQuick('Attendance saved');
      }));
      $('.late-minutes',row).addEventListener('change',e=>{
        att[learner.id]=att[learner.id]||{status:'late'};
        att[learner.id].status='late';
        att[learner.id].lateMinutes=Math.max(0,Math.min(240,Number(e.target.value)||0));
        persistQuick('Lateness saved');
      });
      $('.remove-learner',row).addEventListener('click',()=>{
        if(!confirm(`Remove ${learner.name} from ${reg.name}?`))return;
        reg.learners=reg.learners.filter(l=>l.id!==learner.id);
        delete att[learner.id];
        saveState();showToast('Learner removed from register');
      });
      list.appendChild(row);
    });
    updateAttendanceSummary(reg,att);
  }

  function updateAttendanceSummary(reg,att){
    const statuses=(reg.learners||[]).map(l=>att[l.id]?.status||'unmarked');
    $('#summaryPresent').textContent=statuses.filter(s=>s==='present').length;
    $('#summaryLate').textContent=statuses.filter(s=>s==='late').length;
    $('#summaryAbsent').textContent=statuses.filter(s=>s==='absent').length;
  }

  function renderRegisterTemplates(){
    const wrap=$('#registerTemplateList');
    if(!wrap)return;
    wrap.innerHTML='';
    if(!state.classes.length){
      wrap.innerHTML='<div class="history-empty">No registers created yet.</div>';
      return;
    }
    [...state.classes].sort((a,b)=>String(a.name).localeCompare(String(b.name))).forEach(reg=>{
      const item=document.createElement('div');
      item.className='register-template-item';
      item.innerHTML=`<div class="register-template-main"><div class="register-template-copy"><strong>${escapeHtml(reg.name)}</strong><span>${escapeHtml(reg.day||'')} · ${escapeHtml(reg.start||'09:00')}–${escapeHtml(reg.end||'16:00')} · ${(reg.learners||[]).length} learner${(reg.learners||[]).length===1?'':'s'}</span></div></div><div class="item-actions"><button class="mini-btn primary-mini" data-open-register type="button">Open</button><button class="mini-btn" data-edit-register type="button">Edit</button></div>`;
      $('[data-open-register]',item).addEventListener('click',()=>{state.activeClassId=reg.id;state.registerMode='today';saveState();});
      $('[data-edit-register]',item).addEventListener('click',()=>openRegisterDialog(true,reg.id));
      wrap.appendChild(item);
    });
  }

  function renderHistory(){
    const wrap=$('#historyList');
    if(!wrap)return;
    wrap.innerHTML='';
    if(!state.history.length){wrap.innerHTML='<div class="history-empty">Finished registers will appear here.</div>';return;}
    state.history.slice(0,12).forEach(item=>{
      const div=document.createElement('div');
      div.className='history-item';
      div.innerHTML=`<div><strong>${escapeHtml(item.className||item.registerName||'Register')}</strong><span>${escapeHtml(item.dateLabel||item.date||'')} · ${Number(item.total)||0} learners</span></div><div class="history-score">${(Number(item.present)||0)+(Number(item.late)||0)}/${Number(item.total)||0}</div>`;
      wrap.appendChild(div);
    });
  }

  function renderResources(){
    const wrap=$('#resourceList');
    if(!wrap)return;
    const filter=state.resourceFilter||'all';
    $$('.resource-filter').forEach(btn=>btn.classList.toggle('active',btn.dataset.resourceFilter===filter));
    const labels={all:'All resources',powerpoint:'PowerPoints','lesson-plan':'Lesson plans',other:'Other resources'};
    $('#resourceHeading').textContent=labels[filter]||'All resources';
    const items=state.resources.filter(r=>filter==='all'||r.type===filter);
    $('#resourceCount').textContent=String(items.length);
    wrap.innerHTML='';
    if(!items.length){
      wrap.innerHTML='<div class="history-empty">No resources here yet. Upload a file or create a teaching resource.</div>';
      return;
    }
    [...items].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).forEach(resource=>{
      const item=document.createElement('div');
      item.className='resource-item';
      const typeLabel=resource.type==='powerpoint'?'PowerPoint':resource.type==='lesson-plan'?'Lesson plan':'Resource';
      item.innerHTML=`<div class="resource-main"><div class="resource-icon">${resource.type==='powerpoint'?'P':resource.type==='lesson-plan'?'L':'R'}</div><div class="resource-copy"><strong>${escapeHtml(resource.title)}</strong><span class="resource-type-badge">${typeLabel}</span><span>${resource.kind==='upload'?escapeHtml(resource.fileName||'Uploaded file'):escapeHtml((resource.notes||'Created in Samos').slice(0,90))}</span></div></div><div class="item-actions">${resource.kind==='upload'?'<button class="mini-btn primary-mini" data-resource-open type="button">Open</button>':''}<button class="mini-btn" data-resource-delete type="button">Delete</button></div>`;
      const openBtn=$('[data-resource-open]',item);
      if(openBtn)openBtn.addEventListener('click',()=>openStoredResource(resource));
      $('[data-resource-delete]',item).addEventListener('click',()=>deleteResource(resource));
      wrap.appendChild(item);
    });
  }

  function openRegisterDialog(edit=false,id=null){
    const reg=edit?(state.classes.find(c=>c.id===(id||state.activeClassId))||null):null;
    editingRegisterId=reg?.id||null;
    $('#registerDialogTitle').textContent=edit?'Edit register':'New register';
    $('#registerNameInput').value=reg?.name||'';
    $('#registerDayInput').value=reg?.day||weekdayName();
    $('#registerRoomInput').value=reg?.room||'';
    $('#registerStartInput').value=reg?.start||'09:00';
    $('#registerEndInput').value=reg?.end||'16:00';
    $('#deleteRegisterBtn').classList.toggle('hidden',!edit);
    $('#registerDialog').showModal();
    setTimeout(()=>$('#registerNameInput').focus(),50);
  }

  function saveRegisterFromForm(){
    const name=$('#registerNameInput').value.trim();
    if(!name)return false;
    const values={name,day:$('#registerDayInput').value,room:$('#registerRoomInput').value.trim(),start:$('#registerStartInput').value||'09:00',end:$('#registerEndInput').value||'16:00'};
    if(editingRegisterId){Object.assign(state.classes.find(c=>c.id===editingRegisterId),values);}
    else{
      const reg={id:uid(),...values,learners:[]};
      state.classes.push(reg);state.activeClassId=reg.id;
    }
    state.registerMode='today';state.currentView='registers';state.activeSection='registers';
    saveState();showToast(editingRegisterId?'Register updated':'Register created');editingRegisterId=null;return true;
  }

  function openLearnerDialog(){
    $('#learnerNameInput').value='';$('#learnerIdInput').value='';$('#learnerDialog').showModal();setTimeout(()=>$('#learnerNameInput').focus(),50);
  }

  function createLearnerFromForm(){
    const name=$('#learnerNameInput').value.trim();
    if(!name)return false;
    const externalId=$('#learnerIdInput').value.trim();
    state.learners.push({id:uid(),name,externalId});
    saveState();showToast('Learner created');return true;
  }

  function openAssignLearnersDialog(){
    const reg=activeRegister();
    if(!reg){showToast('Create or select a register first');return;}
    if(!state.learners.length){showToast('Create a learner first');openLearnerDialog();return;}
    const assigned=new Set((reg.learners||[]).map(l=>l.id));
    const wrap=$('#assignLearnersList');
    const available=state.learners.filter(l=>!assigned.has(l.id));
    wrap.innerHTML='';
    if(!available.length){wrap.innerHTML='<div class="history-empty">Every learner in the directory is already on this register.</div>';}
    available.sort((a,b)=>a.name.localeCompare(b.name)).forEach(learner=>{
      const label=document.createElement('label');
      label.className='assign-option';
      label.innerHTML=`<input type="checkbox" value="${escapeHtml(learner.id)}"><div><strong>${escapeHtml(learner.name)}</strong><span>${learner.externalId?escapeHtml(learner.externalId):'No learner ID'}</span></div>`;
      wrap.appendChild(label);
    });
    $('#assignLearnersDialog').showModal();
  }

  function assignSelectedLearners(){
    const reg=activeRegister();if(!reg)return false;
    const ids=$$('#assignLearnersList input:checked').map(input=>input.value);
    if(!ids.length){showToast('Choose at least one learner');return false;}
    const existing=new Set((reg.learners||[]).map(l=>l.id));
    ids.forEach(id=>{
      const learner=state.learners.find(l=>l.id===id);
      if(learner&&!existing.has(id))reg.learners.push(clone(learner));
    });
    saveState();showToast(`${ids.length} learner${ids.length===1?'':'s'} added`);return true;
  }

  function finishRegister(){
    const reg=activeRegister();if(!reg)return;
    const att=getAttendance(reg.id);
    const unmarked=(reg.learners||[]).filter(l=>!['present','late','absent'].includes(att[l.id]?.status));
    if(unmarked.length&&!confirm(`${unmarked.length} learner${unmarked.length===1?' is':'s are'} still unmarked. Finish anyway?`))return;
    const statuses=(reg.learners||[]).map(l=>att[l.id]?.status||'unmarked');
    state.history.unshift({id:uid(),classId:reg.id,className:reg.name,date:todayKey(),dateLabel:prettyDate(),total:reg.learners.length,present:statuses.filter(s=>s==='present').length,late:statuses.filter(s=>s==='late').length,absent:statuses.filter(s=>s==='absent').length,data:clone(att)});
    state.history=state.history.slice(0,100);
    saveState();showToast('Register finished and saved');
  }

  function openResourceDialog(type='lesson-plan'){
    $('#resourceTypeInput').value=type;
    $('#resourceTitleInput').value='';$('#resourceNotesInput').value='';
    $('#resourceDialog').showModal();setTimeout(()=>$('#resourceTitleInput').focus(),50);
  }

  function createResourceFromForm(){
    const title=$('#resourceTitleInput').value.trim();if(!title)return false;
    const type=$('#resourceTypeInput').value;
    state.resources.push({id:uid(),type,title,notes:$('#resourceNotesInput').value.trim(),kind:'created',createdAt:new Date().toISOString()});
    state.resourceFilter=type;state.currentView='resources';state.activeSection=type==='powerpoint'?'slides':'lessons';
    saveState();showToast('Resource saved');return true;
  }

  function detectResourceType(file){
    const name=String(file?.name||'').toLowerCase();
    if(/\.(ppt|pptx)$/.test(name))return'powerpoint';
    return'other';
  }

  function openResourceDb(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(RESOURCE_DB,1);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(RESOURCE_STORE))db.createObjectStore(RESOURCE_STORE);};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }

  async function putResourceFile(id,file){
    const db=await openResourceDb();
    await new Promise((resolve,reject)=>{const tx=db.transaction(RESOURCE_STORE,'readwrite');tx.objectStore(RESOURCE_STORE).put(file,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    db.close();
  }

  async function getResourceFile(id){
    const db=await openResourceDb();
    const blob=await new Promise((resolve,reject)=>{const tx=db.transaction(RESOURCE_STORE,'readonly');const req=tx.objectStore(RESOURCE_STORE).get(id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});
    db.close();return blob;
  }

  async function removeResourceFile(id){
    try{const db=await openResourceDb();await new Promise((resolve,reject)=>{const tx=db.transaction(RESOURCE_STORE,'readwrite');tx.objectStore(RESOURCE_STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();}catch(_){ }
  }

  async function importResourceFile(file){
    if(!file)return;
    const id=uid();const type=detectResourceType(file);
    try{
      await putResourceFile(id,file);
      state.resources.push({id,type,title:file.name.replace(/\.[^.]+$/,''),kind:'upload',fileName:file.name,mime:file.type||'',size:file.size||0,createdAt:new Date().toISOString()});
      state.resourceFilter=type;state.currentView='resources';state.activeSection=type==='powerpoint'?'slides':'lessons';
      saveState();showToast('Resource uploaded');
    }catch(_){showToast('This file could not be saved on this device');}
    $('#resourceFileInput').value='';
  }

  async function openStoredResource(resource){
    try{
      const blob=await getResourceFile(resource.id);
      if(!blob){showToast('Stored file could not be found');return;}
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=resource.fileName||resource.title||'resource';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    }catch(_){showToast('Resource could not be opened');}
  }

  async function deleteResource(resource){
    if(!confirm(`Delete ${resource.title}?`))return;
    state.resources=state.resources.filter(r=>r.id!==resource.id);saveState();
    if(resource.kind==='upload')await removeResourceFile(resource.id);
    showToast('Resource deleted');
  }

  function openAssistantMenu(){
    assistantMenuSection=null;
    renderAssistantMenu();
    const overlay=$('#samosMenuOverlay');overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');document.body.classList.add('samos-open');
  }

  function closeAssistantMenu(){
    const overlay=$('#samosMenuOverlay');if(!overlay)return;overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true');document.body.classList.remove('samos-open');assistantMenuSection=null;
  }

  function menuTile(title,copy,attrs=''){
    return `<button class="samos-menu-tile" type="button" ${attrs}><span class="samos-menu-copy"><strong>${title}</strong><span>${copy}</span></span></button>`;
  }

  function renderAssistantMenu(section=assistantMenuSection){
    assistantMenuSection=section||null;
    const back=$('#samosMenuBack'),title=$('#samosMenuTitle'),hint=$('#samosMenuHint'),content=$('#samosMenuContent');
    back.classList.remove('hidden');
    if(!assistantMenuSection){
      title.textContent='What do you need?';
      hint.textContent='Everything is organised into three clear areas.';
      content.innerHTML=[
        menuTile('Learners',`${state.learners.length} learner${state.learners.length===1?'':'s'} saved · view or create learners.`,'data-menu-root="learners"'),
        menuTile('Registers',`Today’s register, saved registers and register setup.`,'data-menu-root="registers"'),
        menuTile('Resources',`PowerPoints, lesson plans and teaching resources.`,'data-menu-root="resources"')
      ].join('');
      return;
    }
    if(assistantMenuSection==='learners'){
      title.textContent='Learners';
      hint.textContent='Choose what you want to do with your learners.';
      content.innerHTML=[
        menuTile('List of learners','View and manage the learner directory.','data-menu-action="learners:list"'),
        menuTile('Create learner','Add a new learner to Samos.','data-menu-action="learners:create"')
      ].join('');
    }
    if(assistantMenuSection==='registers'){
      title.textContent='Registers';
      hint.textContent='Open today’s register or manage your register setup.';
      content.innerHTML=[
        menuTile("Today's register",'Open today’s attendance screen.','data-menu-action="registers:today"'),
        menuTile('List of registers','View and manage all saved registers.','data-menu-action="registers:list"'),
        menuTile('Create register','Create a new classroom register.','data-menu-action="registers:create"')
      ].join('');
    }
    if(assistantMenuSection==='resources'){
      title.textContent='Resources';
      hint.textContent='Open, upload or create your classroom teaching resources.';
      content.innerHTML=[
        menuTile('PowerPoints','Open your PowerPoint resource library.','data-menu-action="resources:powerpoints"'),
        menuTile('Lesson plans','Open your lesson plan library.','data-menu-action="resources:lessons"'),
        menuTile('Upload resource','Add a PowerPoint, PDF, document or image.','data-menu-action="resources:upload"'),
        menuTile('Create resource','Create a lesson plan or teaching resource in Samos.','data-menu-action="resources:create"')
      ].join('');
    }
  }

  function handleAssistantAction(action){
    if(action==='learners:list')openLearners();
    if(action==='learners:create'){closeAssistantMenu();openLearnerDialog();}
    if(action==='registers:today')openRegisters('today');
    if(action==='registers:list')openRegisters('list');
    if(action==='registers:create'){closeAssistantMenu();openRegisterDialog(false);}
    if(action==='resources:powerpoints')openResources('powerpoint','slides');
    if(action==='resources:lessons')openResources('lesson-plan','lessons');
    if(action==='resources:upload'){closeAssistantMenu();openResources('all','lessons');setTimeout(()=>$('#resourceFileInput').click(),80);}
    if(action==='resources:create'){closeAssistantMenu();openResources('all','lessons');setTimeout(()=>openResourceDialog('lesson-plan'),80);}
  }

  function escapeHtml(value=''){return String(value).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}

  function bindEvents(){
    $('#samosFaceButton').addEventListener('click',openAssistantMenu);
    $('#samosMenuClose').addEventListener('click',closeAssistantMenu);
    $('#samosMenuBack').addEventListener('click',()=>{if(assistantMenuSection)renderAssistantMenu(null);else closeAssistantMenu();});
    $('#samosMenuOverlay').addEventListener('click',event=>{
      const root=event.target.closest('[data-menu-root]');if(root){renderAssistantMenu(root.dataset.menuRoot);return;}
      const action=event.target.closest('[data-menu-action]');if(action)handleAssistantAction(action.dataset.menuAction);
    });

    $$('.metric-tab').forEach(btn=>btn.addEventListener('click',()=>{
      const section=btn.dataset.section;
      if(section==='registers')openRegisters('today');
      if(section==='lessons')openResources('lesson-plan','lessons');
      if(section==='slides')openResources('powerpoint','slides');
      if(section==='games')openGames();
    }));
    $$('[data-back-home]').forEach(btn=>btn.addEventListener('click',goHome));
    $('#brandHomeBtn').addEventListener('click',()=>{if(state.currentView!=='home')goHome();});
    $('#helpBtn').addEventListener('click',()=>showToast('Tap Samos to open learners, registers and resources.'));
    $('#profileBtn').addEventListener('click',()=>{$('#teacherNameInput').value=state.settings.teacherName||'';$('#centreInput').value=state.settings.centre||'';$('#settingsDialog').showModal();});

    $('#createLearnerBtn').addEventListener('click',openLearnerDialog);
    $('#learnerForm').addEventListener('submit',event=>{if(!createLearnerFromForm())event.preventDefault();});

    $('#newRegisterBtn').addEventListener('click',()=>openRegisterDialog(false));
    $('#emptyNewRegisterBtn').addEventListener('click',()=>openRegisterDialog(false));
    $('#editRegisterBtn').addEventListener('click',()=>openRegisterDialog(true));
    $('#registerForm').addEventListener('submit',event=>{if(!saveRegisterFromForm())event.preventDefault();});
    $('#todayRegisterTab').addEventListener('click',()=>{state.registerMode='today';selectUsefulRegister();saveState();});
    $('#registerListTab').addEventListener('click',()=>{state.registerMode='list';saveState();});
    $('#assignLearnersBtn').addEventListener('click',openAssignLearnersDialog);
    $('#assignLearnersForm').addEventListener('submit',event=>{if(!assignSelectedLearners())event.preventDefault();});
    $('#deleteRegisterBtn').addEventListener('click',()=>{
      const reg=state.classes.find(c=>c.id===editingRegisterId);if(!reg||!confirm(`Delete ${reg.name}? This removes the register template and its current attendance.`))return;
      state.classes=state.classes.filter(c=>c.id!==reg.id);Object.keys(state.attendance).filter(k=>k.startsWith(`${reg.id}:`)).forEach(k=>delete state.attendance[k]);state.activeClassId=state.classes[0]?.id||null;editingRegisterId=null;$('#registerDialog').close();saveState();showToast('Register deleted');
    });
    $('#markAllBtn').addEventListener('click',()=>{const reg=activeRegister();if(!reg)return;const att=getAttendance(reg.id);(reg.learners||[]).forEach(l=>att[l.id]={status:'present',lateMinutes:0});persistQuick('Everyone marked present');});
    $('#finishRegisterBtn').addEventListener('click',finishRegister);
    $('#clearHistoryBtn').addEventListener('click',()=>{if(!state.history.length||!confirm('Clear the completed register history from this device?'))return;state.history=[];saveState();showToast('Register history cleared');});

    $('#createResourceBtn').addEventListener('click',()=>openResourceDialog(state.resourceFilter==='powerpoint'?'powerpoint':'lesson-plan'));
    $('#uploadResourceBtn').addEventListener('click',()=>$('#resourceFileInput').click());
    $('#resourceFileInput').addEventListener('change',event=>importResourceFile(event.target.files?.[0]));
    $('#resourceForm').addEventListener('submit',event=>{if(!createResourceFromForm())event.preventDefault();});
    $$('.resource-filter').forEach(btn=>btn.addEventListener('click',()=>{state.resourceFilter=btn.dataset.resourceFilter;saveState();}));

    $('#saveSettingsBtn').addEventListener('click',()=>{state.settings.teacherName=$('#teacherNameInput').value.trim();state.settings.centre=$('#centreInput').value.trim();saveState();$('#settingsDialog').close();showToast('Profile saved');});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#samosMenuOverlay').classList.contains('open'))closeAssistantMenu();});
  }

  async function clearOldShellCaches(){
    try{
      const previous=localStorage.getItem(SHELL_BUILD_KEY);
      if(previous===BUILD)return false;
      if('caches' in window){const keys=await caches.keys();await Promise.all(keys.filter(k=>/^samos-/i.test(k)).map(k=>caches.delete(k)));}
      localStorage.setItem(SHELL_BUILD_KEY,BUILD);
      return true;
    }catch(_){return false;}
  }

  async function registerServiceWorker(){
    if(!('serviceWorker' in navigator)||location.protocol==='file:')return;
    const changed=await clearOldShellCaches();
    let reloading=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(reloading)return;
      const key=`samos.controller.reload.${BUILD}`;
      if(sessionStorage.getItem(key))return;
      reloading=true;sessionStorage.setItem(key,'1');location.reload();
    });
    navigator.serviceWorker.addEventListener('message',event=>{
      if(event.data?.type==='SAMOS_BUILD_ACTIVATED'&&event.data.build===BUILD){
        const key=`samos.message.reload.${BUILD}`;
        if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,'1');location.reload();}
      }
    });
    try{
      const reg=await navigator.serviceWorker.register(`./sw.js?v=${BUILD}`,{updateViaCache:'none'});
      await reg.update();
      if(changed&&reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'});
    }catch(_){ }
  }

  bindEvents();
  selectUsefulRegister();
  renderAll();
  registerServiceWorker();

  window.SamosApp={build:BUILD,getState:()=>clone(state),goHome,openLearners,openRegisters,openResources,openAssistantMenu,clearOldShellCaches};
})();
