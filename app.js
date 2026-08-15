(() => {
  'use strict';

  const STORE_KEY = 'samos.classroom.v1';
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const prettyDate = (date = new Date()) => date.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;

  const defaultState = {
    settings: { teacherName:'', centre:'' },
    classes: [],
    activeClassId: null,
    attendance: {},
    history: []
  };

  let state = loadState();
  let editingClassId = null;

  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

  function loadState(){
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!saved || typeof saved !== 'object') return structuredCloneSafe(defaultState);
      return {
        ...structuredCloneSafe(defaultState),
        ...saved,
        settings: { ...defaultState.settings, ...(saved.settings || {}) },
        classes: Array.isArray(saved.classes) ? saved.classes : [],
        attendance: saved.attendance || {},
        history: Array.isArray(saved.history) ? saved.history : []
      };
    } catch { return structuredCloneSafe(defaultState); }
  }

  function structuredCloneSafe(value){ return JSON.parse(JSON.stringify(value)); }
  function saveState(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); renderAll(); }
  function activeClass(){ return state.classes.find(c => c.id === state.activeClassId) || null; }
  function attendanceKey(classId, date=todayKey()){ return `${classId}:${date}`; }
  function getAttendance(classId){
    const key = attendanceKey(classId);
    if (!state.attendance[key]) state.attendance[key] = {};
    return state.attendance[key];
  }

  function showToast(message){
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function navigate(view){
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
    $$('.arch').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
    window.scrollTo({top:0, behavior:'smooth'});
    if (view === 'registers') renderRegisters();
  }

  function renderAll(){
    renderHome();
    renderRegisters();
    renderHistory();
  }

  function renderHome(){
    const teacher = state.settings.teacherName?.trim();
    const hour = new Date().getHours();
    const daypart = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    $('#greeting').textContent = teacher ? `${daypart}, ${teacher}.` : `${daypart}.`;
    $('#classCount').textContent = state.classes.length;
    $('#learnerCount').textContent = state.classes.reduce((sum,c) => sum + (c.learners?.length || 0), 0);
    const cls = activeClass();
    if (cls){
      const att = getAttendance(cls.id);
      const present = (cls.learners || []).filter(l => ['present','late'].includes(att[l.id]?.status)).length;
      $('#presentCount').textContent = present;
      $('#todayStatus').textContent = cls.name;
      $('#assistantMessage').textContent = `${cls.name} is ready. ${present} of ${cls.learners.length} learners are marked in today.`;
    } else {
      $('#presentCount').textContent = '0';
      $('#todayStatus').textContent = state.classes.length ? 'Choose a class' : 'No class selected';
      $('#assistantMessage').textContent = state.classes.length ? 'Choose a class and I’ll help you take today’s register.' : 'Create a class and I’ll keep the register organised.';
    }
  }

  function renderRegisters(){
    const strip = $('#classStrip');
    strip.innerHTML = '';
    state.classes.forEach(cls => {
      const b = document.createElement('button');
      b.className = `class-chip${cls.id === state.activeClassId ? ' active' : ''}`;
      b.textContent = cls.name;
      b.addEventListener('click', () => { state.activeClassId = cls.id; saveState(); });
      strip.appendChild(b);
    });

    const cls = activeClass();
    $('#noClassPanel').classList.toggle('hidden', !!cls);
    $('#registerPanel').classList.toggle('hidden', !cls);
    if (!cls) return;

    $('#registerDate').textContent = prettyDate().toUpperCase();
    $('#activeClassName').textContent = cls.name;
    $('#activeClassMeta').textContent = [cls.day, `${cls.start || '09:00'}–${cls.end || '16:00'}`, cls.room].filter(Boolean).join(' · ');

    const list = $('#learnerList');
    list.innerHTML = '';
    const att = getAttendance(cls.id);

    if (!(cls.learners || []).length){
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No learners yet. Add the first learner to this class.';
      list.appendChild(empty);
    }

    (cls.learners || []).forEach(learner => {
      const record = att[learner.id] || {status:'unmarked', lateMinutes:0};
      const row = document.createElement('div');
      row.className = 'learner-row';
      row.innerHTML = `
        <div class="learner-info">
          <strong>${escapeHtml(learner.name)}</strong>
          <small>${learner.externalId ? escapeHtml(learner.externalId) : 'No learner ID'}</small>
          <div class="learner-tools">
            <input class="late-minutes" type="number" min="0" max="240" step="1" value="${Number(record.lateMinutes)||0}" aria-label="Minutes late" ${record.status !== 'late' ? 'disabled' : ''}>
            <span class="muted">min late</span>
            <button class="remove-learner">Remove</button>
          </div>
        </div>
        <div class="attendance-controls">
          <button class="attendance-btn ${record.status === 'present' ? 'active' : ''}" data-status="present" title="Present">P</button>
          <button class="attendance-btn ${record.status === 'late' ? 'active' : ''}" data-status="late" title="Late">L</button>
          <button class="attendance-btn ${record.status === 'absent' ? 'active' : ''}" data-status="absent" title="Absent">A</button>
        </div>`;

      $$('.attendance-btn', row).forEach(btn => btn.addEventListener('click', () => {
        att[learner.id] = att[learner.id] || {lateMinutes:0};
        att[learner.id].status = btn.dataset.status;
        if (btn.dataset.status !== 'late') att[learner.id].lateMinutes = 0;
        persistQuick('Attendance saved');
      }));

      $('.late-minutes', row).addEventListener('change', e => {
        att[learner.id] = att[learner.id] || {status:'late'};
        att[learner.id].status = 'late';
        att[learner.id].lateMinutes = Math.max(0, Math.min(240, Number(e.target.value) || 0));
        persistQuick('Lateness saved');
      });

      $('.remove-learner', row).addEventListener('click', () => {
        if (!confirm(`Remove ${learner.name} from ${cls.name}?`)) return;
        cls.learners = cls.learners.filter(l => l.id !== learner.id);
        delete att[learner.id];
        saveState();
        showToast('Learner removed');
      });
      list.appendChild(row);
    });

    updateAttendanceSummary(cls, att);
  }

  function updateAttendanceSummary(cls, att){
    const statuses = (cls.learners || []).map(l => att[l.id]?.status || 'unmarked');
    $('#summaryPresent').textContent = statuses.filter(s => s === 'present').length;
    $('#summaryLate').textContent = statuses.filter(s => s === 'late').length;
    $('#summaryAbsent').textContent = statuses.filter(s => s === 'absent').length;
  }

  function persistQuick(message){
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    renderAll();
    showToast(message);
  }

  function renderHistory(){
    const wrap = $('#historyList');
    wrap.innerHTML = '';
    if (!state.history.length){
      wrap.innerHTML = '<div class="history-empty">Finished registers will appear here.</div>';
      return;
    }
    state.history.slice(0,8).forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-item';
      div.innerHTML = `<div><strong>${escapeHtml(item.className)}</strong><span>${escapeHtml(item.dateLabel)} · ${item.total} learners</span></div><div class="history-score">${item.present + item.late}/${item.total}</div>`;
      wrap.appendChild(div);
    });
  }

  function openClassDialog(edit=false){
    const cls = edit ? activeClass() : null;
    editingClassId = cls?.id || null;
    $('#classDialogTitle').textContent = edit ? 'Edit class' : 'New class';
    $('#classNameInput').value = cls?.name || '';
    $('#classDayInput').value = cls?.day || weekdayName();
    $('#classRoomInput').value = cls?.room || '';
    $('#classStartInput').value = cls?.start || '09:00';
    $('#classEndInput').value = cls?.end || '16:00';
    $('#deleteClassBtn').classList.toggle('hidden', !edit);
    $('#classDialog').showModal();
    setTimeout(() => $('#classNameInput').focus(), 50);
  }

  function weekdayName(){ return new Date().toLocaleDateString('en-GB',{weekday:'long'}); }

  function saveClassFromForm(){
    const name = $('#classNameInput').value.trim();
    if (!name) return false;
    const values = {
      name,
      day: $('#classDayInput').value,
      room: $('#classRoomInput').value.trim(),
      start: $('#classStartInput').value || '09:00',
      end: $('#classEndInput').value || '16:00'
    };
    if (editingClassId){
      const cls = state.classes.find(c => c.id === editingClassId);
      Object.assign(cls, values);
    } else {
      const cls = { id:uid(), ...values, learners:[] };
      state.classes.push(cls);
      state.activeClassId = cls.id;
    }
    saveState();
    showToast(editingClassId ? 'Class updated' : 'Class created');
    editingClassId = null;
    return true;
  }

  function addLearnerFromForm(){
    const cls = activeClass();
    const name = $('#learnerNameInput').value.trim();
    if (!cls || !name) return false;
    cls.learners ||= [];
    cls.learners.push({ id:uid(), name, externalId:$('#learnerIdInput').value.trim() });
    $('#learnerNameInput').value = '';
    $('#learnerIdInput').value = '';
    saveState();
    showToast('Learner added');
    return true;
  }

  function finishRegister(){
    const cls = activeClass();
    if (!cls) return;
    const att = getAttendance(cls.id);
    const unmarked = (cls.learners || []).filter(l => !['present','late','absent'].includes(att[l.id]?.status));
    if (unmarked.length && !confirm(`${unmarked.length} learner${unmarked.length===1?' is':'s are'} still unmarked. Finish anyway?`)) return;
    const statuses = (cls.learners || []).map(l => att[l.id]?.status || 'unmarked');
    state.history.unshift({
      id:uid(), classId:cls.id, className:cls.name, date:todayKey(), dateLabel:prettyDate(),
      total:cls.learners.length,
      present:statuses.filter(s=>s==='present').length,
      late:statuses.filter(s=>s==='late').length,
      absent:statuses.filter(s=>s==='absent').length,
      data:structuredCloneSafe(att)
    });
    state.history = state.history.slice(0,100);
    saveState();
    showToast('Register finished and saved');
  }

  function escapeHtml(value=''){
    return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function bindEvents(){
    $$('.arch').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.nav)));
    $$('[data-open-view]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.openView)));
    $('#newClassBtn').addEventListener('click', () => openClassDialog(false));
    $('#emptyNewClassBtn').addEventListener('click', () => openClassDialog(false));
    $('#editClassBtn').addEventListener('click', () => openClassDialog(true));
    $('#addLearnerBtn').addEventListener('click', () => {
      $('#learnerNameInput').value=''; $('#learnerIdInput').value=''; $('#learnerDialog').showModal(); setTimeout(()=>$('#learnerNameInput').focus(),50);
    });
    $('#classForm').addEventListener('submit', e => { if (!saveClassFromForm()) e.preventDefault(); });
    $('#learnerForm').addEventListener('submit', e => { if (!addLearnerFromForm()) e.preventDefault(); });
    $('#deleteClassBtn').addEventListener('click', () => {
      const cls = activeClass();
      if (!cls || !confirm(`Delete ${cls.name}? This removes the class and its current register.`)) return;
      state.classes = state.classes.filter(c => c.id !== cls.id);
      Object.keys(state.attendance).filter(k => k.startsWith(`${cls.id}:`)).forEach(k => delete state.attendance[k]);
      state.activeClassId = state.classes[0]?.id || null;
      $('#classDialog').close(); saveState(); showToast('Class deleted');
    });
    $('#markAllBtn').addEventListener('click', () => {
      const cls=activeClass(); if(!cls) return; const att=getAttendance(cls.id);
      cls.learners.forEach(l => att[l.id]={status:'present',lateMinutes:0});
      persistQuick('Everyone marked present');
    });
    $('#finishRegisterBtn').addEventListener('click', finishRegister);
    $('#clearHistoryBtn').addEventListener('click', () => {
      if (!state.history.length || !confirm('Clear the recent register history from this device?')) return;
      state.history=[]; saveState(); showToast('Register history cleared');
    });
    $('#settingsBtn').addEventListener('click', () => {
      $('#teacherNameInput').value=state.settings.teacherName||''; $('#centreInput').value=state.settings.centre||''; $('#settingsDialog').showModal();
    });
    $('#saveSettingsBtn').addEventListener('click', () => {
      state.settings.teacherName=$('#teacherNameInput').value.trim(); state.settings.centre=$('#centreInput').value.trim(); saveState(); showToast('Settings saved');
    });
    $('#assistantPrompt').addEventListener('click', () => {
      const cls=activeClass();
      if (!cls){ navigate('registers'); showToast(state.classes.length?'Choose a class':'Create your first class'); return; }
      const att=getAttendance(cls.id); const unmarked=cls.learners.filter(l=>!['present','late','absent'].includes(att[l.id]?.status)).length;
      $('#samosFace').animate([{transform:'translateY(0) rotate(0)'},{transform:'translateY(-13px) rotate(-4deg)'},{transform:'translateY(0) rotate(3deg)'}],{duration:700,easing:'ease-out'});
      showToast(unmarked ? `${unmarked} learner${unmarked===1?'':'s'} still to mark` : 'Today’s register is complete');
    });
  }

  function registerServiceWorker(){
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  bindEvents();
  renderAll();
  registerServiceWorker();
})();
