(function () {
  'use strict';

  const personality = Object.freeze({ role: 'classroom-tutor', motion: 'calm-analytical', accent: 'green' });
  const expressions = ['anim-blink', 'anim-double-blink', 'anim-wink-left', 'anim-wink-right', 'anim-look-left', 'anim-look-right', 'anim-look-up', 'anim-look-down', 'anim-look-up-left', 'anim-look-up-right', 'anim-look-down-left', 'anim-look-down-right', 'anim-smile-eyes', 'anim-squint', 'anim-curious', 'anim-scan', 'anim-nod'];
  const durations = { 'anim-blink': 520, 'anim-double-blink': 920, 'anim-wink-left': 850, 'anim-wink-right': 850, 'anim-smile-eyes': 1150, 'anim-squint': 1200, 'anim-curious': 1400, 'anim-scan': 1650, 'anim-nod': 1050 };
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let homeFace = null;
  let mode = reducedQuery.matches ? 'reduced' : 'idle';
  let externallyBusy = false;
  let playing = false;
  let playTimer = 0;
  let generation = 0;
  let welcomeTimers = [];
  let hasWelcomed = false;
  let lastExpression = '';
  let lastGroup = '';
  const schedule = { micro: 0, blink: 0, major: 0 };
  const random = (min, max) => min + Math.random() * (max - min);
  const groups = name => name ? name.replace(/-up|-down/g, '').replace(/-left|-right/g, '-side') : '';

  function installPersonalityStyles() {
    if (document.getElementById('samos-personality-motion')) return;
    const style = document.createElement('style');
    style.id = 'samos-personality-motion';
    style.textContent = `
      .evia-face.anim-scan{animation:tilosScanFace 1.65s cubic-bezier(.25,.75,.28,1)!important}
      .evia-face.anim-scan .evia-eyes{animation:tilosScanEyes 1.65s cubic-bezier(.24,.78,.3,1)!important}
      .evia-face.anim-nod{animation:tilosNodFace 1.05s cubic-bezier(.25,.78,.32,1)!important}
      .evia-face.anim-nod .evia-eyes{animation:tilosNodEyes 1.05s ease!important}
      .evia-face.tilos-welcome-shimmer{box-shadow:0 0 0 7px rgba(99,196,149,.08),0 0 27px 11px rgba(99,196,149,.20);filter:drop-shadow(0 5px 8px rgba(99,196,149,.16)) drop-shadow(0 0 12px rgba(99,196,149,.20));transition:box-shadow .55s ease,filter .55s ease,transform .3s ease}
      @keyframes tilosScanFace{0%,100%{transform:translateY(0) scale(1)}46%{transform:translateY(-1px) scale(1.008)}72%{transform:translateY(0) scale(1.004)}}
      @keyframes tilosScanEyes{0%,100%{transform:translate(0)}18%{transform:translateX(-15%)}38%{transform:translateX(-13%)}58%{transform:translateX(15%)}78%{transform:translateX(12%)}90%{transform:translateX(0)}}
      @keyframes tilosNodFace{0%,100%{transform:translateY(0) scale(1)}28%{transform:translateY(3px) scale(.997)}55%{transform:translateY(-1px) scale(1.003)}76%{transform:translateY(1px)}}
      @keyframes tilosNodEyes{0%,100%{transform:translateY(0)}28%{transform:translateY(5%)}55%{transform:translateY(-2%)}76%{transform:translateY(2%)}}
      @media(prefers-reduced-motion:reduce){.evia-face.anim-scan,.evia-face.anim-nod{animation:none!important}.evia-face.anim-scan .evia-eyes,.evia-face.anim-nod .evia-eyes{animation:none!important}.evia-face.tilos-welcome-shimmer{box-shadow:0 0 0 6px rgba(99,196,149,.06),0 0 20px 8px rgba(99,196,149,.13);transition:box-shadow .2s ease!important}}
    `;
    document.head.appendChild(style);
  }

  function face() {
    return document.querySelector('#samosOverlay.open .evia-face, #tilosOverlay.open .evia-face, .study-overlay.open .evia-face, .portfolio-pack-overlay.open .evia-face, .progress-info-overlay.open .evia-face, .witness-overlay.open .evia-face, .epa-overlay.open .evia-face, #eviaOverlay.open .evia-face, .progress-coach-overlay.open .evia-face') || homeFace;
  }
  function clearExpression(target = face()) {
    if (!target) return;
    target.classList.remove(...expressions, 'anim-micro-left', 'anim-micro-right', 'anim-micro-up', 'anim-listening', 'anim-recording');
    target.style.removeProperty('--micro-delay');
  }
  function finish(token, target) {
    if (token !== generation) return;
    clearExpression(target);
    playing = false;
  }
  function play(name, options = {}) {
    const target = options.target || face();
    if (!target || !expressions.includes(name)) return false;
    if (reducedQuery.matches && !options.essential) return false;
    if ((externallyBusy || playing) && !options.force) return false;
    generation += 1;
    clearTimeout(playTimer);
    clearExpression(target);
    void target.offsetWidth;
    target.classList.add(name);
    playing = true;
    lastExpression = name;
    lastGroup = groups(name);
    const token = generation;
    playTimer = setTimeout(() => finish(token, target), options.duration || durations[name] || 1350);
    return true;
  }
  function playSequence(names) {
    if (externallyBusy || playing || reducedQuery.matches) return;
    let delay = 0;
    names.forEach((name, index) => {
      setTimeout(() => play(name, { force: index > 0 }), delay);
      delay += (durations[name] || 1050) + random(120, 260);
    });
  }
  function micro() {
    const target = face();
    if (!target || externallyBusy || playing || reducedQuery.matches) return;
    const choices = mode === 'listening' ? ['anim-micro-left', 'anim-micro-right'] : ['anim-micro-left', 'anim-micro-right'];
    const name = choices[Math.floor(Math.random() * choices.length)];
    clearExpression(target);
    target.style.setProperty('--micro-delay', `${Math.round(random(35, 95))}ms`);
    target.classList.add(name);
    setTimeout(() => target.classList.remove(name), 700);
  }
  function pickMajor() {
    // Tilos is the assessor/tutor companion: slower, deliberate scanning and acknowledgement rather than playful movement.
    const pool = mode === 'listening'
      ? ['anim-blink', 'anim-look-down']
      : ['anim-scan', 'anim-nod', 'anim-look-left', 'anim-look-right', 'anim-look-down', 'anim-squint'];
    const allowed = pool.filter(name => name !== lastExpression && groups(name) !== lastGroup);
    return allowed[Math.floor(Math.random() * allowed.length)] || 'anim-scan';
  }
  function tick(kind) {
    if (kind === 'micro') micro();
    if (kind === 'blink' && !externallyBusy && !playing) play('anim-blink');
    if (kind === 'major' && mode === 'idle' && !externallyBusy && !playing) {
      const selected = pickMajor();
      if (Math.random() < .18 && selected === 'anim-scan') playSequence(['anim-scan', 'anim-nod']);
      else play(selected);
    }
    arm(kind);
  }
  function arm(kind) {
    clearTimeout(schedule[kind]);
    const range = kind === 'micro' ? [2600, 4600] : kind === 'blink' ? [4300, 7600] : [8500, 14500];
    schedule[kind] = setTimeout(() => tick(kind), random(...range));
  }
  function start() { Object.keys(schedule).forEach(arm); }
  function stop() { Object.values(schedule).forEach(clearTimeout); Object.keys(schedule).forEach(key => { schedule[key] = 0; }); }
  function setMode(next = 'idle') {
    mode = reducedQuery.matches ? 'reduced' : next;
    const target = face();
    if (target) {
      target.dataset.eviaMode = mode;
      clearExpression(target);
      if (mode === 'recording') target.classList.add('anim-recording');
      if (mode === 'listening') target.classList.add('anim-listening');
    }
  }
  function react(context) {
    const reactions = {
      open: ['anim-scan'],
      curious: ['anim-scan'],
      acknowledge: ['anim-nod'],
      validation: ['anim-scan', 'anim-nod'],
      review: ['anim-scan', 'anim-look-down'],
      thinking: ['anim-squint', 'anim-scan'],
      analysing: ['anim-scan', 'anim-squint'],
      recommendation: ['anim-nod'],
      handover: ['anim-scan', 'anim-nod'],
      incorrect: ['anim-squint'],
      success: ['anim-nod'],
      correct: ['anim-nod'],
      complete: ['anim-nod']
    };
    const choices = reactions[context] || reactions.acknowledge;
    const selected = choices[Math.floor(Math.random() * choices.length)];
    if (['success', 'correct', 'complete'].includes(context) && Math.random() < .3) playSequence(['anim-nod', 'anim-smile-eyes']);
    else play(selected, { force: true });
  }

  function clearWelcome() {
    welcomeTimers.forEach(clearTimeout);
    welcomeTimers = [];
    if (homeFace) homeFace.classList.remove('tilos-welcome-shimmer', 'anim-scan', 'anim-nod');
  }
  function welcome() {
    const target = homeFace;
    if (!target) return;
    clearWelcome();
    generation += 1;
    clearTimeout(playTimer);
    playing = false;
    externallyBusy = true;
    clearExpression(target);
    target.classList.add('tilos-welcome-shimmer');
    if (reducedQuery.matches) {
      welcomeTimers.push(setTimeout(() => { target.classList.remove('tilos-welcome-shimmer'); externallyBusy = false; }, 1700));
      return;
    }
    target.classList.add('anim-scan');
    welcomeTimers.push(setTimeout(() => {
      target.classList.remove('anim-scan');
      void target.offsetWidth;
      target.classList.add('anim-nod');
    }, 1550));
    welcomeTimers.push(setTimeout(() => target.classList.remove('anim-nod'), 2380));
    welcomeTimers.push(setTimeout(() => {
      target.classList.remove('tilos-welcome-shimmer');
      externallyBusy = false;
      playing = false;
    }, 2800));
  }

  function setBusy(value) { externallyBusy = Boolean(value); if (externallyBusy) { generation += 1; clearTimeout(playTimer); playing = false; clearExpression(); } }
  function init(element) {
    installPersonalityStyles();
    if (element) homeFace = element;
    if (homeFace) homeFace.dataset.eviaPersonality = personality.motion;
    stop();
    if (!reducedQuery.matches) start();
    if (homeFace && !hasWelcomed) {
      hasWelcomed = true;
      setTimeout(welcome, 380);
    }
  }
  function destroy() { stop(); clearWelcome(); generation += 1; clearTimeout(playTimer); clearExpression(); homeFace = null; playing = false; }

  document.addEventListener('focusin', event => { if (event.target.matches('textarea, input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio])')) setMode('listening'); });
  document.addEventListener('focusout', event => { if (event.target.matches('textarea, input')) setTimeout(() => { if (!document.activeElement.matches?.('textarea, input')) setMode('idle'); }, 0); });
  reducedQuery.addEventListener?.('change', () => { mode = reducedQuery.matches ? 'reduced' : 'idle'; init(homeFace); });
  window.EviaAnimations = { personality, expressions, init, play, react, welcome, setMode, setBusy, destroy, isPlaying: () => playing };
}());
