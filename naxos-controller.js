(function(){
  'use strict';

  const brand = document.querySelector('.app-brand .brand-word');
  if(!brand) return;
  const BUILD = document.querySelector('meta[name="samos-build"]')?.content || window.SAMOS_BUILD || 'unknown';

  const style=document.createElement('style');
  style.id='naxos-developer-style';
  style.textContent=`
    body.naxos-open{overflow:hidden!important}
    .naxos-overlay{position:fixed;inset:0;z-index:99999;background:#000;color:#fff;display:none;overflow:auto;padding:max(10px,env(safe-area-inset-top)) 14px max(18px,env(safe-area-inset-bottom));font-family:system-ui,-apple-system,Segoe UI,sans-serif}
    .naxos-overlay.open{display:block}
    .naxos-shell{width:min(680px,100%);min-height:100%;margin:0 auto;display:flex;flex-direction:column;gap:16px}
    .naxos-toolbar{display:flex;align-items:center;justify-content:space-between;min-height:48px;border-bottom:1px solid #2e2e2e;padding-bottom:8px}
    .naxos-toolbar span{font-size:10px;letter-spacing:.2em;font-weight:900;color:#ccc}
    .naxos-toolbar button,.naxos-back{border:1px solid #444;background:#080808;color:#fff;border-radius:999px;min-width:42px;min-height:42px;font:inherit;font-size:21px}
    .naxos-identity{display:grid;place-items:center;text-align:center;gap:9px;padding:8px 0 2px}
    .naxos-face{width:104px;height:104px;border:6px solid #fff;border-radius:50%;background:#000;display:grid;place-items:center;box-shadow:0 0 0 1px #333,0 0 30px #ffffff12}
    .naxos-eyes{width:66%;height:38%;display:flex;align-items:center;justify-content:space-between;animation:naxosEyesHello .9s ease 1}
    .naxos-eye{display:block;width:36%;aspect-ratio:1;border:5px solid #fff;border-radius:50%;background:#000}
    @keyframes naxosEyesHello{0%,100%{transform:translateX(0)}25%{transform:translateX(-8%)}55%{transform:translateX(8%)}80%{transform:translateX(0)}}
    .naxos-identity small{font-size:10px;letter-spacing:.2em;color:#aaa;font-weight:850}.naxos-identity h2{margin:0;font-size:28px;letter-spacing:-.03em}.naxos-identity p{margin:0;max-width:560px;color:#bdbdbd;line-height:1.45;font-size:13px}
    .naxos-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .naxos-card,.naxos-action{border:1px solid #333;background:#090909;color:#fff;border-radius:15px;padding:14px;text-align:left;font:inherit;min-height:78px}
    .naxos-card strong,.naxos-action strong{display:block;font-size:14px}.naxos-card small,.naxos-action small{display:block;color:#aaa;margin-top:5px;line-height:1.35;font-size:11px}
    .naxos-page{display:grid;gap:11px}.naxos-page-head{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:10px}.naxos-page-head h3{margin:0;font-size:20px}.naxos-page-head p{grid-column:1/-1;margin:0;color:#aaa;font-size:12px;line-height:1.45}
    .naxos-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.naxos-metric{border:1px solid #303030;border-radius:12px;padding:11px;background:#070707}.naxos-metric small{display:block;color:#999;font-size:9px;text-transform:uppercase;letter-spacing:.08em}.naxos-metric strong{display:block;font-size:19px;margin-top:4px}
    .naxos-section{border:1px solid #2d2d2d;border-radius:14px;background:#070707;padding:12px}.naxos-section h4{margin:0 0 8px;font-size:13px}.naxos-section p{margin:0;color:#b7b7b7;font-size:12px;line-height:1.5}.naxos-health{display:grid;gap:8px}.naxos-check{display:grid;grid-template-columns:16px 1fr;gap:9px;border:1px solid #292929;border-radius:11px;padding:10px;background:#080808}.naxos-check i{width:9px;height:9px;border-radius:50%;margin-top:4px;background:#777}.naxos-check.ok i{background:#fff}.naxos-check.warn i{background:#888;border:2px solid #fff}.naxos-check strong{font-size:12px}.naxos-check span{display:block;color:#aaa;font-size:10.5px;line-height:1.35;margin-top:2px}
    .naxos-actions{display:grid;gap:9px}.naxos-action{min-height:auto}.naxos-action.danger{border-style:dashed}.naxos-status{min-height:22px;color:#fff;font-size:11px;font-weight:700;padding:4px 2px}.naxos-code{white-space:pre-wrap;word-break:break-word;font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#d8d8d8;background:#030303;border:1px solid #242424;border-radius:11px;padding:10px;max-height:42vh;overflow:auto}
    @media(max-width:520px){.naxos-grid{grid-template-columns:1fr}.naxos-face{width:96px;height:96px}.naxos-identity h2{font-size:26px}}
    @media(prefers-reduced-motion:reduce){.naxos-eyes{animation:none}}
  `;
  document.head.appendChild(style);

  const overlay=document.createElement('section');
  overlay.className='naxos-overlay';
  overlay.id='naxosOverlay';
  overlay.setAttribute('aria-hidden','true');
  overlay.innerHTML=`
    <div class="naxos-shell" role="dialog" aria-modal="true" aria-labelledby="naxosTitle">
      <div class="naxos-toolbar"><span>DEVELOPER MODE</span><button id="naxosClose" type="button" aria-label="Close Naxos">×</button></div>
      <div class="naxos-identity">
        <div class="naxos-face" aria-hidden="true"><div class="naxos-eyes"><span class="naxos-eye"></span><span class="naxos-eye"></span></div></div>
        <small>NAXOS · DEVELOPER ASSISTANT</small>
        <h2 id="naxosTitle">Naxos</h2>
        <p id="naxosHint">Independent developer mode for Samos. Inspect classroom data, app health and safe repair tools without changing register decisions.</p>
      </div>
      <div id="naxosContent"></div>
    </div>`;
  document.body.appendChild(overlay);

  const content=overlay.querySelector('#naxosContent');
  const title=overlay.querySelector('#naxosTitle');
  const hint=overlay.querySelector('#naxosHint');
  const closeButton=overlay.querySelector('#naxosClose');
  let view='home';

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const metric=(label,value)=>`<div class="naxos-metric"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`;
  const pageHead=(name,copy)=>`<div class="naxos-page-head"><button class="naxos-back" type="button" data-naxos="home" aria-label="Back">←</button><h3>${esc(name)}</h3><p>${esc(copy)}</p></div>`;

  function getState(){
    try{return window.SamosApp?.getState?.()||JSON.parse(localStorage.getItem('samos.classroom.data')||'{}')||{};}catch(_){return {};}
  }

  function counts(){
    const state=getState();
    const classes=Array.isArray(state.classes)?state.classes:[];
    const learners=Array.isArray(state.learners)?state.learners.length:classes.reduce((sum,c)=>sum+(Array.isArray(c.learners)?c.learners.length:0),0);
    const history=Array.isArray(state.history)?state.history.length:0;
    const resources=Array.isArray(state.resources)?state.resources.length:0;
    const attendance=state.attendance&&typeof state.attendance==='object'?Object.keys(state.attendance).length:0;
    return {classes,learners,history,resources,attendance};
  }

  function renderHome(){
    view='home';title.textContent='Naxos';hint.textContent='Independent developer mode. Inspect what Samos is doing and use safe repair tools.';
    content.innerHTML=`<div class="naxos-grid">
      <button class="naxos-card" type="button" data-naxos="overview"><strong>Classroom data</strong><small>Inspect class, learner, register and storage counts.</small></button>
      <button class="naxos-card" type="button" data-naxos="health"><strong>Run app health check</strong><small>Check shell build, local storage, service worker and viewport state.</small></button>
      <button class="naxos-card" type="button" data-naxos="background"><strong>Background information</strong><small>Show current build, runtime and installed-app information.</small></button>
      <button class="naxos-card" type="button" data-naxos="repairs"><strong>Repair tools</strong><small>Refresh the offline shell, clear cached app files or reload safely.</small></button>
      <button class="naxos-card" type="button" data-naxos="diagnostics"><strong>Developer diagnostics</strong><small>Generate a local JSON report for troubleshooting.</small></button>
    </div>`;
  }

  function renderOverview(){
    view='overview';title.textContent='Classroom data';hint.textContent='Samos local data overview';
    const c=counts();const state=getState();const active=(c.classes||[]).find(x=>x.id===state.activeClassId);
    content.innerHTML=`<div class="naxos-page">${pageHead('Classroom data','Counts only. Naxos does not alter attendance or learner records from this page.')}
      <div class="naxos-summary">${metric('Registers',c.classes.length)}${metric('Learners',c.learners)}${metric('Completed',c.history)}${metric('Resources',c.resources)}</div>
      <div class="naxos-section"><h4>Active register</h4><p>${active?esc(`${active.name} · ${(active.learners||[]).length} learners`):'No active register selected.'}</p></div>
      <div class="naxos-section"><h4>Storage</h4><p>Register data is stored locally in the browser under <b>samos.classroom.data</b>. Cache repair tools do not delete this register data.</p></div>
    </div>`;
  }

  async function healthChecks(){
    const c=counts();
    const checks=[];
    checks.push({state:document.querySelector('meta[name="samos-build"]')?.content===BUILD?'ok':'warn',name:'Build metadata',detail:`Running build ${BUILD}.`});
    let storage='ok';try{localStorage.setItem('__samos_health__','1');localStorage.removeItem('__samos_health__');}catch(_){storage='warn';}
    checks.push({state:storage,name:'Local storage',detail:storage==='ok'?'Local classroom storage is writable.':'Local storage could not be written.'});
    checks.push({state:'ok',name:'Register data model',detail:`${c.classes.length} register templates, ${c.learners} learners, ${c.resources} resources and ${c.history} completed registers found.`});
    const sw='serviceWorker' in navigator?(navigator.serviceWorker.controller?'ok':'warn'):'warn';
    checks.push({state:sw,name:'Offline shell',detail:sw==='ok'?'A Samos service worker is controlling this page.':'Service worker is not currently controlling this page.'});
    checks.push({state:(innerHeight>500&&innerWidth>280)?'ok':'warn',name:'Viewport',detail:`${innerWidth} × ${innerHeight}. Home uses a locked 100dvh layout.`});
    return checks;
  }

  async function renderHealth(){
    view='health';title.textContent='App health';hint.textContent='Samos health check';
    content.innerHTML=`<div class="naxos-page">${pageHead('App health','Checking the current Samos shell and local classroom data.')}<div class="naxos-status">Running checks…</div></div>`;
    const checks=await healthChecks();
    content.innerHTML=`<div class="naxos-page">${pageHead('App health','These checks inspect Samos without changing register decisions or classroom data.')}<div class="naxos-health">${checks.map(x=>`<div class="naxos-check ${x.state}"><i></i><div><strong>${esc(x.name)}</strong><span>${esc(x.detail)}</span></div></div>`).join('')}</div></div>`;
  }

  function renderBackground(){
    view='background';title.textContent='Background';hint.textContent='Runtime information';
    content.innerHTML=`<div class="naxos-page">${pageHead('Background information','Technical shell information for the current Samos installation.')}
      <div class="naxos-summary">${metric('Build',BUILD)}${metric('Mode',matchMedia('(display-mode: standalone)').matches?'Installed':'Browser')}${metric('Width',innerWidth)}${metric('Height',innerHeight)}</div>
      <div class="naxos-section"><h4>Cache policy</h4><p>Every Samos build uses a new shell version. Old Samos caches are deleted and app files use network-first loading so GitHub updates replace the previous layout.</p></div>
      <div class="naxos-section"><h4>Developer access</h4><p>Naxos is hidden behind the Samos name. Tap the Samos name seven times quickly to open Developer Mode.</p></div>
    </div>`;
  }

  function renderRepairs(message=''){
    view='repairs';title.textContent='Repair tools';hint.textContent='Safe shell repairs';
    content.innerHTML=`<div class="naxos-page">${pageHead('Repair tools','These tools repair the Samos app shell without deleting class, learner or register data.')}
      <div class="naxos-actions">
        <button class="naxos-action" type="button" data-repair="update"><strong>Check for app update</strong><small>Forces the service worker to check GitHub for the newest Samos shell.</small></button>
        <button class="naxos-action" type="button" data-repair="reload"><strong>Reload interface</strong><small>Reloads Samos while keeping local classroom data.</small></button>
        <button class="naxos-action danger" type="button" data-repair="cache"><strong>Clear app cache & reload</strong><small>Deletes only Samos cached app files, not registers, learners, resources or completed register history.</small></button>
      </div><div class="naxos-status" id="naxosRepairStatus">${esc(message)}</div></div>`;
  }

  async function diagnostics(){
    const c=counts();
    return {generatedAt:new Date().toISOString(),app:'Samos',build:BUILD,developerAssistant:'Naxos',counts:{registers:c.classes.length,learners:c.learners,resources:c.resources,completedRegisters:c.history,attendanceDays:c.attendance},runtime:{href:location.href,userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},standalone:matchMedia('(display-mode: standalone)').matches,serviceWorkerControlled:Boolean(navigator.serviceWorker?.controller)},health:await healthChecks()};
  }

  async function renderDiagnostics(){
    view='diagnostics';title.textContent='Developer diagnostics';hint.textContent='Samos diagnostic report';
    const report=await diagnostics();const text=JSON.stringify(report,null,2);
    content.innerHTML=`<div class="naxos-page">${pageHead('Developer diagnostics','Runtime and count information only. Learner names and register details are not copied into this report.')}
      <div class="naxos-actions"><button class="naxos-action" type="button" data-diagnostic="copy"><strong>Copy report</strong><small>Copy JSON to the clipboard.</small></button><button class="naxos-action" type="button" data-diagnostic="download"><strong>Download report</strong><small>Save a local Naxos diagnostics JSON file.</small></button></div>
      <pre class="naxos-code" id="naxosDiagnosticText">${esc(text)}</pre><div class="naxos-status" id="naxosDiagnosticStatus"></div></div>`;
  }

  async function clearAppCaches(){
    if(!('caches' in window)) return 0;
    const keys=await caches.keys();const targets=keys.filter(k=>/^samos-/i.test(k));await Promise.all(targets.map(k=>caches.delete(k)));return targets.length;
  }

  async function updateOffline(){
    if(!('serviceWorker' in navigator)) return 'Service workers are unavailable in this browser.';
    const reg=await navigator.serviceWorker.getRegistration();
    if(!reg) return 'No Samos service worker registration was found.';
    await reg.update();
    return 'Update check complete.';
  }

  function open(){view='home';overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');document.body.classList.add('naxos-open');renderHome();closeButton.focus();}
  function close(){overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true');document.body.classList.remove('naxos-open');brand.focus?.();}

  let taps=0,lastTap=0,resetTap=0;
  brand.addEventListener('click',event=>{
    event.stopPropagation();
    const now=Date.now();
    if(now-lastTap>900)taps=0;
    taps+=1;lastTap=now;clearTimeout(resetTap);resetTap=setTimeout(()=>{taps=0;},1400);
    if(taps>=7){taps=0;clearTimeout(resetTap);if(navigator.vibrate)navigator.vibrate(35);open();}
  });

  closeButton.addEventListener('click',close);
  overlay.addEventListener('click',async event=>{
    const nav=event.target.closest('[data-naxos]');
    if(nav){const target=nav.dataset.naxos;if(target==='home')renderHome();if(target==='overview')renderOverview();if(target==='health')await renderHealth();if(target==='background')renderBackground();if(target==='repairs')renderRepairs();if(target==='diagnostics')await renderDiagnostics();return;}
    const repair=event.target.closest('[data-repair]');
    if(repair){const status=overlay.querySelector('#naxosRepairStatus');try{
      if(repair.dataset.repair==='update'){status.textContent='Checking for update…';status.textContent=await updateOffline();}
      if(repair.dataset.repair==='reload'){location.reload();}
      if(repair.dataset.repair==='cache'){if(!confirm('Clear only Samos cached app files and reload? Register, learner and resource data will stay on this device.'))return;status.textContent='Clearing cached app files…';const n=await clearAppCaches();await updateOffline().catch(()=>{});status.textContent=`Cleared ${n} Samos cache${n===1?'':'s'}. Reloading…`;setTimeout(()=>location.reload(),350);}
    }catch(e){status.textContent=`Repair could not complete: ${e.message||e}`;}return;}
    const diagnostic=event.target.closest('[data-diagnostic]');
    if(diagnostic){const status=overlay.querySelector('#naxosDiagnosticStatus');const report=await diagnostics();const text=JSON.stringify(report,null,2);if(diagnostic.dataset.diagnostic==='copy'){try{await navigator.clipboard.writeText(text);status.textContent='Diagnostic report copied.';}catch(_){status.textContent='Clipboard unavailable. Use Download report instead.';}}else{const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`naxos-samos-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Diagnostic report downloaded locally.';} }
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay.classList.contains('open'))close();});
  window.NaxosDeveloper={open,close,runHealth:healthChecks,version:'1.0',samosBuild:BUILD};
}());
