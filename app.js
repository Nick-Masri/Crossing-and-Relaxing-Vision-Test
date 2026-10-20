'use strict';

/* ---------- small helpers ---------- */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('vt:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('vt:' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  },
};

const settings = Object.assign({ theme: 'dark', sound: true, pxPerMm: null, viewCm: 50 }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

function loadCfg(id, defaults) {
  const cfg = Object.assign({}, defaults, store.get('cfg:' + id, {}));
  return new Proxy(cfg, {
    set(target, key, value) {
      target[key] = value;
      store.set('cfg:' + id, target);
      return true;
    },
  });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const SLOAN = 'CDHKNORSVZ'.split('');
const randLetter = (not) => { let l; do { l = pick(SLOAN); } while (l === not); return l; };
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dayKey = d => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`; };

let audioCtx;
function beep(freq = 660, ms = 90, vol = 0.07) {
  if (!settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  } catch (e) { /* audio unavailable */ }
}
const chime = () => { beep(660, 160); setTimeout(() => beep(880, 260), 170); };

function logActivity(entry) {
  const log = store.get('log', []);
  log.push(Object.assign({ date: new Date().toISOString() }, entry));
  store.set('log', log);
}

const mm = px => settings.pxPerMm ? px / settings.pxPerMm : null;
const fmtLen = px => settings.pxPerMm ? `${mm(px).toFixed(0)} mm` : `${Math.round(px)} px`;
// Vergence demand relative to the screen plane: prism diopters = 100 * separation / viewing distance.
const prism = px => settings.pxPerMm ? 100 * (mm(px) / 10) / settings.viewCm : null;

function cssColor(el, prop) {
  return getComputedStyle(el).getPropertyValue(prop).trim();
}
function parseRgb(str) {
  const m = str.match(/\d+(\.\d+)?/g);
  return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
}
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

/* ---------- reusable controls ---------- */

function slider({ label, min, max, step = 1, value, fmt = v => v, onInput }) {
  const out = h('output', {}, fmt(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: e => { const v = +e.target.value; out.textContent = fmt(v); onInput(v); },
  });
  const el = h('label', { class: 'field' }, h('span', { class: 'field-top' }, h('span', {}, label), out), input);
  return {
    el,
    set(v) { input.value = v; out.textContent = fmt(+input.value); },
    setMax(m) { input.max = m; out.textContent = fmt(+input.value); },
  };
}

function choice({ label, options, value, onChange }) {
  const sel = h('select', { onchange: e => onChange(e.target.value) },
    options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
  return { el: h('label', { class: 'field' }, h('span', { class: 'field-top' }, h('span', {}, label)), sel), sel };
}

function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'group' });
  const buttons = options.map(([v, text]) => h('button', {
    type: 'button', class: v === value ? 'on' : '',
    onclick: e => {
      buttons.forEach(b => b.classList.remove('on'));
      e.currentTarget.classList.add('on');
      e.currentTarget.blur();
      onChange(v);
    },
  }, text));
  el.append(...buttons);
  return el;
}

function checkbox(label, checked, onChange) {
  return h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: e => onChange(e.target.checked) }), label);
}

function button(text, onClick, cls = 'btn') {
  return h('button', { type: 'button', class: cls, onclick: e => { e.currentTarget.blur(); onClick(e); } }, text);
}

function panel(title, ...kids) {
  return h('div', { class: 'panel' }, title ? h('h2', {}, title) : null, ...kids);
}

function howTo(steps, extra) {
  return h('details', { class: 'panel howto', open: true },
    h('summary', {}, 'How to do it'),
    h('ol', {}, steps.map(s => h('li', { html: s }))),
    extra || null);
}

/* Session timer that sits in the stage toolbar so it stays visible in fullscreen. */
function sessionTimer({ minutes = 2, onStart, onStop, onTick }) {
  let duration = minutes * 60;
  let elapsed = 0;
  let running = false;
  let last = 0;
  let raf = 0;

  const display = h('span', { class: 'timer-display' });
  const durSel = h('select', {
    'aria-label': 'Session length',
    onchange: e => { duration = +e.target.value; render(); },
  }, [[30, '30 sec'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min'], [0, 'No limit']]
    .map(([v, t]) => h('option', { value: v, selected: v === duration }, t)));
  const btn = button('Start', () => (running ? stop(false) : start()), 'btn primary');

  function render() {
    display.textContent = duration ? fmtTime(Math.max(0, duration - elapsed)) : fmtTime(elapsed);
    btn.textContent = running ? 'Stop' : 'Start';
    btn.classList.toggle('running', running);
    durSel.disabled = running;
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(1, (t - last) / 1000);
    last = t;
    elapsed += dt;
    if (onTick) onTick(dt, elapsed);
    if (duration && elapsed >= duration) {
      chime();
      stop(true);
      return;
    }
    render();
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    elapsed = 0;
    running = true;
    last = performance.now();
    beep(520, 80);
    if (onStart) onStart();
    render();
    raf = requestAnimationFrame(loop);
  }

  function stop(completed) {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    render();
    if (onStop) onStop(elapsed, completed);
  }

  render();
  return {
    els: [durSel, display, btn],
    start, stop,
    get running() { return running; },
    get elapsed() { return elapsed; },
  };
}

function toggleFullscreen(el) {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
}

/* Common exercise page scaffold: header, stage with toolbar, and a side column. */
function exercisePage(root, { title, lede, timer, toolbarExtras = [] }) {
  const stage = h('div', { class: 'stage' });
  const wrap = h('section', { class: 'stage-wrap' });
  const fsBtn = button('Fullscreen', () => toggleFullscreen(wrap), 'btn ghost small');
  wrap.append(
    h('div', { class: 'toolbar' }, ...timer.els, ...toolbarExtras, h('span', { class: 'spacer' }), fsBtn),
    stage);
  const side = h('aside', { class: 'side' });
  root.append(
    h('div', { class: 'ex-head' },
      h('a', { href: '#/', class: 'back' }, '← All exercises'),
      h('h1', {}, title),
      lede ? h('p', { class: 'lede' }, lede) : null),
    h('div', { class: 'ex-grid' }, wrap, side));
  return { stage, side, wrap };
}

/* Canvas that tracks its element size and device pixel ratio. */
function stageCanvas(stage, draw) {
  const cv = h('canvas');
  stage.append(cv);
  const ctx = cv.getContext('2d');
  const size = { w: 0, h: 0 };
  const ro = new ResizeObserver(() => {
    const dpr = window.devicePixelRatio || 1;
    size.w = stage.clientWidth;
    size.h = stage.clientHeight;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  });
  ro.observe(stage);
  return { cv, ctx, size, destroy: () => ro.disconnect() };
}

/* Keyboard handling scoped to one view. Ignores keys typed into form fields. */
function keys(map) {
  const handler = e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const fn = map[e.key] || map[e.key.toLowerCase()];
    if (fn) { e.preventDefault(); fn(e); }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

function lastDone(type) {
  const log = store.get('log', []);
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === type) return log[i].date;
  }
  return null;
}

/* ---------- exercise catalogue ---------- */

const ICONS = {
  vergence: '<svg viewBox="0 0 60 34" height="34"><circle cx="17" cy="17" r="14" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="20" cy="17" r="7" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="43" cy="17" r="14" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="40" cy="17" r="7" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  pursuits: '<svg viewBox="0 0 60 34" height="34"><path d="M6 17c8-14 16-14 24 0s16 14 24 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="3 4"/><circle cx="30" cy="17" r="6" fill="currentColor"/></svg>',
  saccades: '<svg viewBox="0 0 60 34" height="34"><circle cx="9" cy="17" r="6" fill="currentColor"/><circle cx="51" cy="17" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M19 17h18m-5-5 6 5-6 5" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  hart: '<svg viewBox="0 0 60 34" height="34"><g font-family="monospace" font-weight="700" font-size="11" fill="currentColor"><text x="4" y="13">K D R S</text><text x="4" y="29">N H O Z</text></g></svg>',
  vor: '<svg viewBox="0 0 60 34" height="34"><text x="30" y="24" text-anchor="middle" font-family="monospace" font-weight="700" font-size="18" fill="currentColor">E</text><path d="M8 17h8m-4-4-4 4 4 4M52 17h-8m4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
  peripheral: '<svg viewBox="0 0 60 34" height="34"><path d="M27 17h6M30 14v6" stroke="currentColor" stroke-width="2.5"/><circle cx="8" cy="17" r="4" fill="currentColor"/><circle cx="52" cy="17" r="4" fill="currentColor" opacity=".4"/><circle cx="30" cy="4" r="3" fill="currentColor" opacity=".4"/><circle cx="30" cy="30" r="3" fill="currentColor" opacity=".4"/></svg>',
  okn: '<svg viewBox="0 0 60 34" height="34"><g fill="currentColor"><rect x="4" y="4" width="6" height="26"/><rect x="18" y="4" width="6" height="26"/><rect x="32" y="4" width="6" height="26"/><rect x="46" y="4" width="6" height="26"/></g></svg>',
  rest: '<svg viewBox="0 0 60 34" height="34"><circle cx="30" cy="17" r="13" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="30" cy="17" r="6" fill="none" stroke="currentColor" stroke-width="2.5" opacity=".5"/></svg>',
};

const EXERCISES = [
  { id: 'vergence', group: 'Eye teaming', title: 'Vergence cards', blurb: 'Your original crossing and relaxing test, rebuilt: free fusion with depth cues, suppression checks, break and recovery drills.' },
  { id: 'pursuits', group: 'Eye movements', title: 'Smooth pursuits', blurb: 'Follow a moving target along lines, circles and figure 8s while keeping your head still.' },
  { id: 'saccades', group: 'Eye movements', title: 'Saccades', blurb: 'Jump your eyes between targets on a metronome and read the letter each time.' },
  { id: 'hart', group: 'Eye movements', title: 'Hart chart', blurb: 'Read letters in set patterns. Trains accurate eye jumps and reading tracking.' },
  { id: 'vor', group: 'Visual-vestibular', title: 'Gaze stabilization (VOR x1)', blurb: 'Keep a letter clear while turning your head in time with a beat.' },
  { id: 'okn', group: 'Visual-vestibular', title: 'Motion tolerance (OKN)', blurb: 'Moving stripes for gradual exposure to visual motion. Start short and low contrast.' },
  { id: 'peripheral', group: 'Visual processing', title: 'Peripheral awareness', blurb: 'Hold your gaze on the center and catch flashes at the edges of your vision.' },
  { id: 'rest', group: 'Recovery', title: 'Rest and reset', blurb: 'Palming with paced breathing, or 20-20-20 distance breaks between sets.' },
];
const exTitle = id => (EXERCISES.find(e => e.id === id) || { title: id }).title;

const views = {};

/* ---------- home ---------- */

function weekMinutes(log) {
  const since = Date.now() - 7 * 864e5;
  return Math.round(log.filter(l => new Date(l.date) >= since).reduce((s, l) => s + (l.seconds || 0), 0) / 60);
}

function streakDays(log) {
  const days = new Set(log.map(l => dayKey(l.date)));
  let streak = 0;
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

views.home = function (root) {
  const log = store.get('log', []);
  const today = log.filter(l => dayKey(l.date) === dayKey(Date.now()));
  const todayMin = Math.round(today.reduce((s, l) => s + (l.seconds || 0), 0) / 60);

  const routine = [
    ['rest', 'Rest and reset', '1 min, to settle in'],
    ['pursuits', 'Smooth pursuits', '2 min'],
    ['saccades', 'Saccades', '2 min'],
    ['vergence', 'Vergence cards', '3 to 5 min'],
    ['vor', 'Gaze stabilization', '1 min, if cleared for head movement'],
    ['rest', 'Rest and reset', '1 min'],
  ];

  root.append(h('div', { class: 'hero' },
    h('div', {},
      h('h1', {}, 'Vision therapy exercises'),
      h('p', { class: 'lede' },
        'Short sessions, done often, tend to work better than long ones. Aim for mild effort: a little strain is fine, ',
        'but if symptoms climb above a few points out of 10 or last after you stop, end the session and rest.'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, todayMin), h('span', {}, 'minutes today')),
        h('div', { class: 'stat' }, h('b', {}, weekMinutes(log)), h('span', {}, 'minutes this week')),
        h('div', { class: 'stat' }, h('b', {}, streakDays(log)), h('span', {}, 'day streak'))),
      h('p', { style: 'margin-top:14px' },
        h('a', { href: '#/progress' }, 'Log how you feel'), ' before and after a session so you can see trends.')),
    panel('A sample 10 minute routine',
      h('ol', { class: 'routine' }, routine.map(([id, name, mins]) =>
        h('li', {}, h('a', { href: '#/' + id }, name), ' ', h('span', { class: 'mins' }, mins)))),
      h('p', { class: 'note', style: 'margin:10px 0 0' }, 'Adjust to whatever your therapist has prescribed.'))));

  let group = null;
  let grid = null;
  for (const ex of EXERCISES) {
    if (ex.group !== group) {
      group = ex.group;
      root.append(h('div', { class: 'group-title' }, group));
      grid = h('div', { class: 'cards' });
      root.append(grid);
    }
    const last = lastDone(ex.id);
    grid.append(h('a', { class: 'card-link', href: '#/' + ex.id },
      h('div', { class: 'icon', html: ICONS[ex.id] }),
      h('h3', {}, ex.title),
      h('p', {}, ex.blurb),
      h('div', { class: 'last' }, last ? `Last done ${fmtDate(last)}` : 'Not done yet')));
  }
};

/* ---------- vergence (eccentric circles) ---------- */

function eccentricCard(side) {
  // Inner circle shifted toward the nose on each card, so it floats forward when relaxing and back when crossing.
  const dx = side === 'L' ? 7 : -7;
  const mark = side === 'L'
    ? '<text x="40" y="228" font-size="24" text-anchor="middle" font-weight="700">A</text>'
    : '<text x="160" y="228" font-size="24" text-anchor="middle" font-weight="700">B</text>';
  return `<svg viewBox="0 0 200 250" aria-hidden="true" fill="currentColor" font-family="system-ui, sans-serif">
    <rect x="4" y="4" width="192" height="242" rx="12" fill="none" stroke="currentColor" stroke-width="3"/>
    <circle cx="100" cy="105" r="72" fill="none" stroke="currentColor" stroke-width="9"/>
    <circle cx="${100 + dx}" cy="105" r="42" fill="none" stroke="currentColor" stroke-width="8"/>
    <text x="${100 + dx}" y="110" font-size="13" text-anchor="middle" letter-spacing="1">FOCUS</text>
    <path d="M100 206v24M88 218h24" stroke="currentColor" stroke-width="3"/>
    ${mark}
  </svg>`;
}

views.vergence = function (root) {
  const cfg = loadCfg('vergence', { mode: 'relaxed', size: 140, sep: 170, drill: 'free', stepPx: 6, stepSec: 4, jumpSec: 6, jumpNear: 150 });
  let sep = cfg.sep;
  let sessionBest = 0;
  let sessionRecords = [];
  let drillTimer = 0;
  let ramp = { phase: 'idle', breakAt: null };
  let rampResults = [];
  let jumps = 0;
  let jumpFar = false;

  const timer = sessionTimer({
    minutes: 3,
    onStart() {
      sessionBest = 0; sessionRecords = []; rampResults = []; jumps = 0;
      renderResults();
      startDrill();
    },
    onStop(seconds) {
      stopDrill();
      if (seconds >= 5) {
        logActivity({
          type: 'vergence', seconds: Math.round(seconds), mode: cfg.mode, drill: cfg.drill,
          bestPx: sessionBest || null, bestMm: sessionBest && mm(sessionBest),
          ramps: rampResults.length ? rampResults : undefined, jumps: jumps || undefined,
        });
      }
      banner.textContent = '';
      sep = cfg.sep;
      layout();
    },
  });

  const recordBtn = button('Record fusion', () => primaryAction(), 'btn small');
  const page = exercisePage(root, {
    title: 'Vergence cards',
    lede: 'Fuse the two cards into one 3D image in the middle, then push the separation further. Relaxing (looking past the screen) trains divergence. Crossing (looking in front of the screen) trains convergence.',
    timer,
    toolbarExtras: [recordBtn],
  });
  const { stage, side } = page;

  const L = h('div', { class: 'ecc', html: eccentricCard('L') });
  const R = h('div', { class: 'ecc', html: eccentricCard('R') });
  const hud = h('div', { class: 'hud' });
  const hudR = h('div', { class: 'hud hud-r' });
  const banner = h('div', { class: 'banner' });
  stage.append(L, R, hud, hudR, banner);

  const minSep = () => cfg.size + 4;
  const maxSep = () => Math.max(minSep() + 10, stage.clientWidth - cfg.size - 12);

  function layout() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const w = cfg.size;
    const s = clamp(sep, minSep(), maxSep());
    const top = Math.max(8, (H - w * 1.25) / 2 - 10);
    L.style.width = R.style.width = w + 'px';
    L.style.left = (W / 2 - s / 2 - w / 2) + 'px';
    R.style.left = (W / 2 + s / 2 - w / 2) + 'px';
    L.style.top = R.style.top = top + 'px';
    const p = prism(s);
    hud.textContent = `Separation ${fmtLen(s)}` + (p ? ` · about ${p.toFixed(1)}Δ ${cfg.mode === 'crossed' ? 'base out' : 'base in'}` : '');
    const best = bestFor(cfg.mode);
    hudR.textContent = best ? `Best ${cfg.mode === 'crossed' ? 'crossing' : 'relaxing'}: ${fmtLen(best.px)}` : '';
    sepSlider.setMax(maxSep());
    nearSlider.setMax(maxSep());
    ipdWarn.style.display = cfg.mode === 'relaxed' && settings.pxPerMm && mm(s) > 66 ? '' : 'none';
  }

  function records() { return store.get('vergence:records', []); }
  function bestFor(mode) {
    return records().filter(r => r.mode === mode).reduce((b, r) => (!b || r.px > b.px ? r : b), null);
  }

  function recordFusion(px) {
    const prev = bestFor(cfg.mode);
    const all = records();
    all.push({ date: new Date().toISOString(), mode: cfg.mode, px: Math.round(px), mm: mm(px) });
    store.set('vergence:records', all);
    sessionBest = Math.max(sessionBest, px);
    sessionRecords.push(px);
    const isBest = !prev || px > prev.px;
    banner.textContent = isBest ? `New best: ${fmtLen(px)}` : `Recorded ${fmtLen(px)}`;
    beep(isBest ? 990 : 760, 120);
    setTimeout(() => { if (cfg.drill === 'free') banner.textContent = ''; }, 1800);
    renderResults();
    layout();
  }

  function primaryAction() {
    if (cfg.drill === 'free') {
      recordFusion(clamp(sep, minSep(), maxSep()));
    } else if (cfg.drill === 'ramp') {
      if (!timer.running) { timer.start(); return; }
      if (ramp.phase === 'out') {
        ramp.breakAt = sep;
        ramp.phase = 'back';
        beep(440, 160);
        banner.textContent = `Break at ${fmtLen(sep)}. Now regain one image, then press Space.`;
      } else if (ramp.phase === 'back') {
        rampResults.push({ breakPx: Math.round(ramp.breakAt), recoveryPx: Math.round(sep) });
        recordFusion(ramp.breakAt);
        banner.textContent = `Recovery at ${fmtLen(sep)}. Resetting...`;
        ramp.phase = 'rest';
        setTimeout(() => {
          if (!timer.running) return;
          sep = cfg.sep;
          ramp.phase = 'out';
          banner.textContent = 'Separation is increasing. Press Space when it breaks into two.';
          layout();
        }, 3000);
      }
    }
  }

  function startDrill() {
    stopDrill();
    if (cfg.drill === 'ramp') {
      sep = cfg.sep;
      ramp = { phase: 'out', breakAt: null };
      banner.textContent = 'Separation is increasing. Press Space when it breaks into two.';
      drillTimer = setInterval(() => {
        if (ramp.phase === 'out') {
          if (sep + cfg.stepPx > maxSep()) {
            banner.textContent = 'Reached the edge of the screen. Try smaller cards or crossing mode.';
            return;
          }
          sep += cfg.stepPx;
          beep(600, 40, 0.03);
        } else if (ramp.phase === 'back') {
          sep = Math.max(minSep(), sep - cfg.stepPx);
          beep(600, 40, 0.03);
        }
        layout();
      }, cfg.stepSec * 1000);
    } else if (cfg.drill === 'jump') {
      jumpFar = true;
      sep = cfg.sep;
      banner.textContent = 'Re-fuse as fast as you can after each jump.';
      drillTimer = setInterval(() => {
        jumpFar = !jumpFar;
        sep = jumpFar ? cfg.sep : cfg.jumpNear;
        jumps++;
        beep(jumpFar ? 820 : 620, 90);
        renderResults();
        layout();
      }, cfg.jumpSec * 1000);
    }
    layout();
  }
  function stopDrill() { clearInterval(drillTimer); drillTimer = 0; }

  // Controls
  const modeSeg = segmented([['relaxed', 'Relaxing (divergence)'], ['crossed', 'Crossing (convergence)']], cfg.mode, v => {
    cfg.mode = v; renderHowTo(); renderResults(); layout();
  });
  const drillSeg = segmented([['free', 'Free'], ['ramp', 'Break / recovery'], ['jump', 'Jumps']], cfg.drill, v => {
    if (timer.running) timer.stop(false);
    cfg.drill = v; sep = cfg.sep; banner.textContent = ''; showDrillFields(); layout();
  });
  const sepSlider = slider({
    label: 'Separation', min: 60, max: 900, value: cfg.sep, fmt: fmtLen,
    onInput: v => { cfg.sep = v; if (cfg.drill !== 'ramp' || !timer.running) sep = v; layout(); },
  });
  const sizeSlider = slider({
    label: 'Card size', min: 70, max: 300, value: cfg.size, fmt: v => fmtLen(v),
    onInput: v => { cfg.size = v; layout(); },
  });
  const stepSlider = slider({ label: 'Step size', min: 2, max: 30, value: cfg.stepPx, fmt: fmtLen, onInput: v => { cfg.stepPx = v; } });
  const stepSecSlider = slider({ label: 'Seconds per step', min: 2, max: 10, value: cfg.stepSec, fmt: v => v + ' s', onInput: v => { cfg.stepSec = v; } });
  const nearSlider = slider({ label: 'Jump between this and Separation', min: 60, max: 900, value: cfg.jumpNear, fmt: fmtLen, onInput: v => { cfg.jumpNear = v; } });
  const jumpSecSlider = slider({ label: 'Seconds per jump', min: 2, max: 15, value: cfg.jumpSec, fmt: v => v + ' s', onInput: v => { cfg.jumpSec = v; } });
  const ipdWarn = h('p', { class: 'note', style: 'color:var(--warn)' },
    'Past roughly your pupil distance (about 55 to 70 mm) relaxed fusion would need your eyes to point outward, so it usually tops out here.');

  const drillHelp = h('p', { class: 'note' });
  const rampFields = h('div', {}, stepSlider.el, stepSecSlider.el);
  const jumpFields = h('div', {}, nearSlider.el, jumpSecSlider.el);
  function showDrillFields() {
    rampFields.style.display = cfg.drill === 'ramp' ? '' : 'none';
    jumpFields.style.display = cfg.drill === 'jump' ? '' : 'none';
    sepSlider.el.querySelector('.field-top span').textContent = cfg.drill === 'ramp' ? 'Starting separation' : 'Separation';
    recordBtn.textContent = cfg.drill === 'free' ? 'Record fusion' : cfg.drill === 'ramp' ? 'Broke / regained' : 'Record fusion';
    recordBtn.style.display = cfg.drill === 'jump' ? 'none' : '';
    drillHelp.innerHTML = {
      free: 'Set the separation, fuse, keep FOCUS clear for 10 seconds, then press <kbd>Space</kbd> to record it. Use <kbd>←</kbd> <kbd>→</kbd> to adjust.',
      ramp: 'Press Start. The cards slowly separate. Press <kbd>Space</kbd> the moment the middle image splits (break), then again when it comes back together (recovery). This is how clinicians measure fusional range.',
      jump: 'The separation snaps between two values. Each time it jumps, get back to one clear image as quickly as you can. Builds speed and flexibility.',
    }[cfg.drill];
  }

  const resultsBox = h('div');
  function renderResults() {
    const best = { relaxed: bestFor('relaxed'), crossed: bestFor('crossed') };
    resultsBox.replaceChildren(
      h('ul', { class: 'result-list' },
        h('li', {}, h('span', {}, 'Best relaxing'), h('b', {}, best.relaxed ? fmtLen(best.relaxed.px) : '–')),
        h('li', {}, h('span', {}, 'Best crossing'), h('b', {}, best.crossed ? fmtLen(best.crossed.px) : '–')),
        sessionBest ? h('li', {}, h('span', {}, 'This session'), h('b', {}, fmtLen(sessionBest))) : null,
        jumps ? h('li', {}, h('span', {}, 'Jumps'), h('b', {}, jumps)) : null,
        ...rampResults.map((r, i) => h('li', {}, h('span', {}, `Ramp ${i + 1}`),
          h('b', {}, `break ${fmtLen(r.breakPx)} / recover ${fmtLen(r.recoveryPx)}`)))),
      settings.pxPerMm ? null : h('p', { class: 'note', style: 'margin:8px 0 0' },
        h('a', { href: '#/settings' }, 'Calibrate your screen'), ' to see real millimeters and prism diopters.'));
  }

  const howBox = h('div');
  function renderHowTo() {
    const relaxed = cfg.mode === 'relaxed';
    howBox.replaceChildren(howTo(relaxed ? [
      'Sit about arm\'s length from the screen with the cards at eye level.',
      'Look <em>through</em> the screen as if at something far behind it. The two cards drift together and you see three.',
      'Hold your attention on the middle card until it becomes one clear image and the word FOCUS is sharp.',
      'The inner circle should float <b>toward</b> you. You should see both <b>A</b> and <b>B</b> under it.',
      'Hold for about 10 seconds, then increase the separation a little. Start where it is easy.',
    ] : [
      'Hold a pen tip between your eyes and the screen and look at it. The cards behind it double into three or four.',
      'Slide the pen closer or farther until the middle two overlap into one card.',
      'Without moving your eyes, shift your attention to that middle card until FOCUS is clear, then lower the pen.',
      'The inner circle should sink <b>away</b> from you and look smaller. You should see both <b>A</b> and <b>B</b>.',
      'Hold for about 10 seconds, then increase the separation a little.',
    ], h('p', { class: 'note', style: 'margin:10px 0 0' },
      'If A or B fades out, one eye is switching off (suppression). Blink, reduce the separation and rebuild. ',
      'If FOCUS stays blurry, the separation is past what you can hold clearly; that is still useful work but note it.')));
  }

  side.append(
    panel('Mode', modeSeg, drillSeg, drillHelp),
    panel('Settings', sepSlider.el, sizeSlider.el, rampFields, jumpFields, ipdWarn),
    panel('Records', resultsBox),
    howBox);

  showDrillFields();
  renderResults();
  renderHowTo();

  const ro = new ResizeObserver(layout);
  ro.observe(stage);
  const unkey = keys({
    ' ': () => primaryAction(),
    ArrowRight: () => { if (cfg.drill !== 'ramp' || !timer.running) { cfg.sep = clamp(cfg.sep + cfg.stepPx, minSep(), maxSep()); sep = cfg.sep; sepSlider.set(cfg.sep); layout(); } },
    ArrowLeft: () => { if (cfg.drill !== 'ramp' || !timer.running) { cfg.sep = clamp(cfg.sep - cfg.stepPx, minSep(), maxSep()); sep = cfg.sep; sepSlider.set(cfg.sep); layout(); } },
    f: () => toggleFullscreen(page.wrap),
    Enter: () => (timer.running ? timer.stop(false) : timer.start()),
  });

  return () => { timer.stop(false); stopDrill(); ro.disconnect(); unkey(); };
};

/* ---------- smooth pursuits ---------- */

const PATHS = {
  horizontal: t => [Math.sin(t), 0],
  vertical: t => [0, Math.sin(t)],
  diagonal: t => [Math.sin(t), Math.sin(t)],
  diagonal2: t => [Math.sin(t), -Math.sin(t)],
  circle: t => [Math.cos(t), Math.sin(t)],
  figure8: t => [Math.sin(t), Math.sin(2 * t)],
  wander: t => [0.65 * Math.sin(t) + 0.35 * Math.sin(2.3 * t + 1), 0.6 * Math.sin(1.3 * t) + 0.4 * Math.sin(0.7 * t + 2)],
};

views.pursuits = function (root) {
  const cfg = loadCfg('pursuits', { path: 'horizontal', speed: 20, size: 26, amp: 80, letters: true });
  let phase = 0;
  let letter = randLetter();
  let letterAge = 0;
  let speedRamp = 0;

  const timer = sessionTimer({
    minutes: 2,
    onStart() { phase = 0; speedRamp = 0; },
    onTick(dt) {
      speedRamp = Math.min(1, speedRamp + dt / 2);
      phase += dt * (cfg.speed / 60) * 2 * Math.PI * speedRamp;
      letterAge += dt;
      if (cfg.letters && letterAge > 1.8) { letter = randLetter(letter); letterAge = 0; }
      draw();
    },
    onStop(seconds) {
      if (seconds >= 5) logActivity({ type: 'pursuits', seconds: Math.round(seconds), path: cfg.path, speed: cfg.speed });
      phase = 0; draw();
    },
  });

  const page = exercisePage(root, {
    title: 'Smooth pursuits',
    lede: 'Keep your head still and follow the target with your eyes only. Smooth, not jumpy. If you have to catch up in little jumps, slow it down.',
    timer,
  });
  const { stage, side } = page;

  const canvas = stageCanvas(stage, () => draw());
  function draw() {
    const { ctx, size } = canvas;
    const { w, h: H } = size;
    ctx.clearRect(0, 0, w, H);
    const color = getComputedStyle(stage).color;
    const [x, y] = PATHS[cfg.path](phase);
    const ax = (w / 2 - cfg.size - 10) * cfg.amp / 100;
    const ay = (H / 2 - cfg.size - 10) * cfg.amp / 100;
    const px = w / 2 + x * ax;
    const py = H / 2 + y * ay;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, cfg.size, 0, Math.PI * 2);
    ctx.fill();
    if (cfg.letters) {
      ctx.fillStyle = cssColor(stage, '--stage-bg');
      ctx.font = `700 ${Math.round(cfg.size * 1.1)}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, px, py + 1);
    }
  }

  side.append(
    panel('Path', choice({
      label: 'Pattern',
      value: cfg.path,
      options: [['horizontal', 'Side to side'], ['vertical', 'Up and down'], ['diagonal', 'Diagonal ↘'], ['diagonal2', 'Diagonal ↗'],
        ['circle', 'Circle'], ['figure8', 'Figure 8'], ['wander', 'Unpredictable']],
      onChange: v => { cfg.path = v; draw(); },
    }).el,
    slider({ label: 'Speed', min: 6, max: 60, value: cfg.speed, fmt: v => `${v} cycles/min`, onInput: v => { cfg.speed = v; } }).el,
    slider({ label: 'Range', min: 20, max: 100, value: cfg.amp, fmt: v => v + '%', onInput: v => { cfg.amp = v; draw(); } }).el,
    slider({ label: 'Target size', min: 10, max: 60, value: cfg.size, fmt: v => v * 2 + ' px', onInput: v => { cfg.size = v; draw(); } }).el,
    checkbox('Show changing letters (read them aloud)', cfg.letters, v => { cfg.letters = v; draw(); })),
    howTo([
      'Sit centered, about arm\'s length away. Rest your chin on your hand if it helps keep your head still.',
      'Press Start and follow the target with your eyes only.',
      'With letters on, read each new letter out loud. It keeps your focus on the target instead of near it.',
      'Start slow and narrow. Raise speed or range only when it feels smooth for a full set.',
    ], h('p', { class: 'note', style: 'margin:10px 0 0' }, 'Keys: ', h('kbd', {}, 'Enter'), ' start/stop, ', h('kbd', {}, 'F'), ' fullscreen.')));

  const unkey = keys({
    Enter: () => (timer.running ? timer.stop(false) : timer.start()),
    ' ': () => (timer.running ? timer.stop(false) : timer.start()),
    f: () => toggleFullscreen(page.wrap),
  });
  return () => { timer.stop(false); canvas.destroy(); unkey(); };
};

/* ---------- saccades ---------- */

views.saccades = function (root) {
  const cfg = loadCfg('saccades', { layout: 'horizontal', pace: 'metronome', bpm: 50, spread: 80, size: 54 });
  let active = 0;
  let jumps = 0;
  let beatAcc = 0;
  let targets = [];

  const timer = sessionTimer({
    minutes: 2,
    onStart() { jumps = 0; beatAcc = 0; active = 0; build(); },
    onTick(dt) {
      if (cfg.pace !== 'metronome') return;
      beatAcc += dt;
      const beat = 60 / cfg.bpm;
      if (beatAcc >= beat) { beatAcc -= beat; advance(); }
    },
    onStop(seconds) {
      if (seconds >= 5) {
        logActivity({ type: 'saccades', seconds: Math.round(seconds), layout: cfg.layout, pace: cfg.pace, jumps, perMin: Math.round(jumps / (seconds / 60)) });
      }
      counter.textContent = `${jumps} jumps` + (seconds > 5 ? ` · ${Math.round(jumps / (seconds / 60))} per minute` : '');
    },
  });

  const page = exercisePage(root, {
    title: 'Saccades',
    lede: 'Jump your eyes, not your head, from target to target. Land right on the letter and read it before the next beat.',
    timer,
  });
  const { stage, side } = page;
  const counter = h('div', { class: 'hud' });
  stage.append(counter);

  function positions() {
    const s = cfg.spread / 100;
    switch (cfg.layout) {
      case 'vertical': return [[0.5, 0.5 - 0.42 * s], [0.5, 0.5 + 0.42 * s]];
      case 'diagonal': return [[0.5 - 0.45 * s, 0.5 - 0.4 * s], [0.5 + 0.45 * s, 0.5 + 0.4 * s]];
      case 'four': return [[0.5 - 0.45 * s, 0.5 - 0.4 * s], [0.5 + 0.45 * s, 0.5 - 0.4 * s], [0.5 + 0.45 * s, 0.5 + 0.4 * s], [0.5 - 0.45 * s, 0.5 + 0.4 * s]];
      case 'random': return [[0.5, 0.5]];
      default: return [[0.5 - 0.46 * s, 0.5], [0.5 + 0.46 * s, 0.5]];
    }
  }

  function build() {
    targets.forEach(t => t.remove());
    targets = positions().map(([x, y]) => {
      const t = h('div', { class: 'target' }, randLetter());
      t.style.left = x * 100 + '%';
      t.style.top = y * 100 + '%';
      t.style.width = t.style.height = cfg.size * 1.6 + 'px';
      t.style.fontSize = cfg.size + 'px';
      stage.append(t);
      return t;
    });
    mark();
  }

  function mark() {
    targets.forEach((t, i) => {
      t.classList.toggle('on', i === active && cfg.layout !== 'random');
      t.classList.toggle('dim', i !== active && cfg.layout !== 'random');
    });
  }

  function advance() {
    jumps++;
    if (cfg.layout === 'random') {
      const t = targets[0];
      const s = cfg.spread / 100;
      const prevX = parseFloat(t.style.left);
      let x;
      do { x = rand(50 - 45 * s, 50 + 45 * s); } while (Math.abs(x - prevX) < 15 * s);
      t.style.left = x + '%';
      t.style.top = rand(50 - 40 * s, 50 + 40 * s) + '%';
      t.textContent = randLetter(t.textContent);
    } else {
      active = (active + 1) % targets.length;
      targets[active].textContent = randLetter(targets[active].textContent);
      mark();
    }
    if (cfg.pace === 'metronome') beep(active % 2 ? 700 : 600, 50, 0.05);
    counter.textContent = `${jumps} jumps`;
  }

  const bpmSlider = slider({ label: 'Tempo', min: 20, max: 120, value: cfg.bpm, fmt: v => `${v} per minute`, onInput: v => { cfg.bpm = v; } });
  const paceHelp = h('p', { class: 'note' });
  function showPace() {
    bpmSlider.el.style.display = cfg.pace === 'metronome' ? '' : 'none';
    paceHelp.innerHTML = cfg.pace === 'metronome'
      ? 'Move your eyes on each beat.'
      : 'Press <kbd>Space</kbd> as soon as you have read the letter. Your jumps per minute are your speed score.';
  }

  side.append(
    panel('Setup',
      choice({
        label: 'Targets', value: cfg.layout,
        options: [['horizontal', 'Left and right'], ['vertical', 'Up and down'], ['diagonal', 'Diagonal'], ['four', 'Four corners'], ['random', 'Random jumps']],
        onChange: v => { cfg.layout = v; active = 0; build(); },
      }).el,
      segmented([['metronome', 'Metronome'], ['self', 'Self-paced']], cfg.pace, v => { cfg.pace = v; showPace(); }),
      bpmSlider.el, paceHelp,
      slider({ label: 'Distance apart', min: 20, max: 100, value: cfg.spread, fmt: v => v + '%', onInput: v => { cfg.spread = v; build(); } }).el,
      slider({ label: 'Letter size', min: 18, max: 110, value: cfg.size, fmt: v => v + ' px', onInput: v => { cfg.size = v; build(); } }).el),
    howTo([
      'Keep your head still and centered.',
      'Look at the highlighted target and read its letter, quietly or out loud.',
      'On each beat, jump to the next target. Try to land on it in one move, not creep up on it.',
      'Make it harder by speeding up, spreading targets wider, or shrinking the letters.',
    ]));

  showPace();
  build();

  const unkey = keys({
    ' ': () => { if (!timer.running) timer.start(); else if (cfg.pace === 'self') advance(); },
    Enter: () => (timer.running ? timer.stop(false) : timer.start()),
    f: () => toggleFullscreen(page.wrap),
  });
  return () => { timer.stop(false); unkey(); };
};

/* ---------- Hart chart ---------- */

views.hart = function (root) {
  const cfg = loadCfg('hart', { rows: 8, cols: 8, size: 34, pattern: 'rows', guide: true, bpm: 60 });
  let grid = [];
  let cells = [];
  let seq = [];
  let pos = 0;
  let beatAcc = 0;
  let steps = 0;

  const timer = sessionTimer({
    minutes: 2,
    onStart() { pos = 0; steps = 0; beatAcc = 0; highlight(); },
    onTick(dt) {
      if (!cfg.guide) return;
      beatAcc += dt;
      if (beatAcc >= 60 / cfg.bpm) { beatAcc -= 60 / cfg.bpm; next(); }
    },
    onStop(seconds) {
      if (seconds >= 5) logActivity({ type: 'hart', seconds: Math.round(seconds), pattern: cfg.pattern, letters: steps });
      cells.flat().forEach(c => c.classList.remove('on'));
    },
  });

  const page = exercisePage(root, {
    title: 'Hart chart',
    lede: 'Read the letters in a set pattern with your eyes only. The guide highlights where you should be on each beat.',
    timer,
  });
  const { stage, side } = page;
  const chart = h('div', { class: 'hart' });
  stage.append(chart);

  function sequence() {
    const out = [];
    const R = cfg.rows;
    const C = cfg.cols;
    if (cfg.pattern === 'rows') for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) out.push([r, c]);
    else if (cfg.pattern === 'columns') for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) out.push([r, c]);
    else if (cfg.pattern === 'ends') for (let r = 0; r < R; r++) out.push([r, 0], [r, C - 1]);
    else if (cfg.pattern === 'snake') for (let r = 0; r < R; r++) for (let i = 0; i < C; i++) out.push([r, r % 2 ? C - 1 - i : i]);
    else if (cfg.pattern === 'diagonal') for (let r = 0; r < R; r++) out.push([r, Math.round(r * (C - 1) / Math.max(1, R - 1))], [r, C - 1 - Math.round(r * (C - 1) / Math.max(1, R - 1))]);
    return out;
  }

  function build() {
    grid = Array.from({ length: cfg.rows }, () => Array.from({ length: cfg.cols }, () => randLetter()));
    const cellSize = cfg.size * 1.5;
    cells = grid.map(row => row.map(l => {
      const s = h('span', {}, l);
      s.style.width = s.style.height = cellSize + 'px';
      return s;
    }));
    chart.style.fontSize = cfg.size + 'px';
    chart.replaceChildren(...cells.map(row => h('div', { class: 'hart-row' }, row)));
    seq = sequence();
    pos = 0;
    highlight();
  }

  function highlight() {
    cells.flat().forEach(c => c.classList.remove('on'));
    if (timer.running && cfg.guide && seq[pos]) {
      const [r, c] = seq[pos];
      cells[r][c].classList.add('on');
    }
  }

  function next() {
    pos = (pos + 1) % seq.length;
    if (pos === 0) build();
    steps++;
    beep(620, 40, 0.035);
    highlight();
  }

  const bpmSlider = slider({ label: 'Guide tempo', min: 20, max: 140, value: cfg.bpm, fmt: v => `${v} per minute`, onInput: v => { cfg.bpm = v; } });

  side.append(
    panel('Chart',
      choice({
        label: 'Reading pattern', value: cfg.pattern,
        options: [['rows', 'Rows, left to right'], ['snake', 'Back and forth (snake)'], ['columns', 'Columns, top to bottom'], ['ends', 'First and last of each row'], ['diagonal', 'Crossing diagonals']],
        onChange: v => { cfg.pattern = v; seq = sequence(); pos = 0; highlight(); },
      }).el,
      checkbox('Highlight guide on a beat', cfg.guide, v => { cfg.guide = v; bpmSlider.el.style.display = v ? '' : 'none'; highlight(); }),
      bpmSlider.el,
      slider({ label: 'Letter size', min: 14, max: 64, value: cfg.size, fmt: v => v + ' px', onInput: v => { cfg.size = v; build(); } }).el,
      slider({ label: 'Rows', min: 3, max: 10, value: cfg.rows, onInput: v => { cfg.rows = v; build(); } }).el,
      slider({ label: 'Columns', min: 3, max: 12, value: cfg.cols, onInput: v => { cfg.cols = v; build(); } }).el,
      h('div', { class: 'btn-row' }, button('New letters', build, 'btn small'))),
    howTo([
      'Read the letters out loud in the chosen pattern, without moving your head and without using a finger.',
      'Use the guide at first. Once you can keep up, turn it off and time yourself through the whole chart.',
      '"First and last" and "crossing diagonals" force long eye jumps and are the hardest.',
      'Near-far version: print or write a small copy, hold it close, and alternate reading one letter from the paper and one from the screen.',
    ]));

  bpmSlider.el.style.display = cfg.guide ? '' : 'none';
  build();

  const unkey = keys({
    ' ': () => (timer.running && !cfg.guide ? next() : (timer.running ? timer.stop(false) : timer.start())),
    Enter: () => (timer.running ? timer.stop(false) : timer.start()),
    f: () => toggleFullscreen(page.wrap),
  });
  return () => { timer.stop(false); unkey(); };
};

/* ---------- VOR x1 ---------- */

views.vor = function (root) {
  const cfg = loadCfg('vor', { direction: 'horizontal', bpm: 90, size: 64, change: 2.5 });
  let beatAcc = 0;
  let letterAcc = 0;
  let flip = false;

  const timer = sessionTimer({
    minutes: 1,
    onStart() { beatAcc = 0; letterAcc = 0; },
    onTick(dt) {
      beatAcc += dt;
      letterAcc += dt;
      if (beatAcc >= 60 / cfg.bpm) {
        beatAcc -= 60 / cfg.bpm;
        flip = !flip;
        beep(flip ? 720 : 560, 50, 0.05);
        renderCue();
      }
      if (letterAcc >= cfg.change) { letterAcc = 0; letter.textContent = randLetter(letter.textContent); }
    },
    onStop(seconds) {
      if (seconds >= 5) logActivity({ type: 'vor', seconds: Math.round(seconds), direction: cfg.direction, bpm: cfg.bpm });
      cue.textContent = '';
    },
  });

  const page = exercisePage(root, {
    title: 'Gaze stabilization (VOR x1)',
    lede: 'Keep your eyes locked on the letter while you turn your head in time with the beat. The letter must stay clear and still.',
    timer,
  });
  const { stage, side } = page;
  const letter = h('div', { class: 'fix' }, randLetter());
  const cue = h('div', { class: 'banner' });
  stage.append(letter, cue);

  function renderCue() {
    letter.style.fontSize = cfg.size + 'px';
    if (!timer.running) { cue.textContent = ''; return; }
    cue.textContent = cfg.direction === 'horizontal' ? (flip ? 'turn →' : '← turn') : (flip ? 'tilt ↓' : '↑ tilt');
  }

  side.append(
    h('div', { class: 'warnbox' }, 'Only do head-movement exercises if your clinician has cleared you for them. Expect mild dizziness; stop if it is more than mild or lasts more than a few minutes after.'),
    panel('Setup',
      segmented([['horizontal', 'Side to side'], ['vertical', 'Up and down']], cfg.direction, v => { cfg.direction = v; renderCue(); }),
      slider({ label: 'Head turns', min: 40, max: 180, value: cfg.bpm, fmt: v => `${v} per minute`, onInput: v => { cfg.bpm = v; } }).el,
      slider({ label: 'Letter size', min: 20, max: 160, value: cfg.size, fmt: v => v + ' px', onInput: v => { cfg.size = v; renderCue(); } }).el,
      slider({ label: 'New letter every', min: 1, max: 6, step: 0.5, value: cfg.change, fmt: v => v + ' s', onInput: v => { cfg.change = v; } }).el),
    howTo([
      'Sit or stand about arm\'s length away, with the letter at eye level.',
      'Keep looking at the letter and turn your head about 20 to 30 degrees each way, one turn per beat.',
      'If the letter blurs or jumps, slow the beat down. Speed matters more than how far you turn.',
      'Read each new letter as it changes. Work up to 1 to 2 minutes, a few times a day, as your therapist directs.',
    ]));

  renderCue();
  const unkey = keys({
    ' ': () => (timer.running ? timer.stop(false) : timer.start()),
    Enter: () => (timer.running ? timer.stop(false) : timer.start()),
    f: () => toggleFullscreen(page.wrap),
  });
  return () => { timer.stop(false); unkey(); };
};

/* ---------- optokinetic stripes ---------- */

views.okn = function (root) {
  const cfg = loadCfg('okn', { dir: 'right', speed: 80, width: 60, contrast: 30 });
  let offset = 0;

  const timer = sessionTimer({
    minutes: 0.5,
    onTick(dt) { offset += dt * cfg.speed; draw(); },
    onStop(seconds) {
      if (seconds >= 5) logActivity({ type: 'okn', seconds: Math.round(seconds), dir: cfg.dir, speed: cfg.speed, contrast: cfg.contrast });
    },
  });

  const page = exercisePage(root, {
    title: 'Motion tolerance (OKN)',
    lede: 'Moving stripes for gradual exposure to busy visual motion, the kind found in grocery aisles, traffic, and scrolling screens.',
    timer,
  });
  const { stage, side } = page;
  const canvas = stageCanvas(stage, () => draw());

  function draw() {
    const { ctx, size } = canvas;
    const bg = parseRgb(getComputedStyle(stage).backgroundColor);
    const fg = parseRgb(getComputedStyle(stage).color);
    ctx.fillStyle = mix(bg, bg, 0);
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.fillStyle = mix(bg, fg, cfg.contrast / 100);
    const period = cfg.width * 2;
    const horizontal = cfg.dir === 'left' || cfg.dir === 'right';
    const sign = cfg.dir === 'right' || cfg.dir === 'down' ? 1 : -1;
    const o = ((offset * sign) % period + period) % period;
    const span = horizontal ? size.w : size.h;
    for (let p = o - period; p < span; p += period) {
      if (horizontal) ctx.fillRect(p, 0, cfg.width, size.h);
      else ctx.fillRect(0, p, size.w, cfg.width);
    }
  }

  side.append(
    h('div', { class: 'warnbox' }, 'This can bring on dizziness or nausea. Start at 30 seconds with low contrast, sitting down. Stop if symptoms rise more than a couple of points and give yourself time to settle.'),
    panel('Setup',
      choice({
        label: 'Direction', value: cfg.dir,
        options: [['right', 'Moving right'], ['left', 'Moving left'], ['up', 'Moving up'], ['down', 'Moving down']],
        onChange: v => { cfg.dir = v; draw(); },
      }).el,
      slider({ label: 'Speed', min: 20, max: 400, value: cfg.speed, fmt: v => v + ' px/s', onInput: v => { cfg.speed = v; } }).el,
      slider({ label: 'Stripe width', min: 20, max: 160, value: cfg.width, fmt: v => v + ' px', onInput: v => { cfg.width = v; draw(); } }).el,
      slider({ label: 'Contrast', min: 5, max: 100, value: cfg.contrast, fmt: v => v + '%', onInput: v => { cfg.contrast = v; draw(); } }).el),
    howTo([
      'Sit down, about arm\'s length away.',
      'First try just looking at the center of the screen and letting the stripes pass by.',
      'As that gets easy, let your eyes follow a stripe, snap back, and follow the next.',
      'Progress one thing at a time: longer, then faster, then higher contrast, then fullscreen.',
    ]));

  const unkey = keys({
    ' ': () => (timer.running ? timer.stop(false) : timer.start()),
    Enter: () => (timer.running ? timer.stop(false) : timer.start()),
    f: () => toggleFullscreen(page.wrap),
  });
  return () => { timer.stop(false); canvas.destroy(); unkey(); };
};

/* ---------- peripheral awareness ---------- */

const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

views.peripheral = function (root) {
  const cfg = loadCfg('peripheral', { ecc: 80, flash: 300, size: 18 });
  let stats = { hits: 0, wrong: 0, misses: 0, rts: [] };
  let trial = null;
  let nextAt = 0;
  let clock = 0;
  let fixAcc = 0;

  const timer = sessionTimer({
    minutes: 2,
    onStart() { stats = { hits: 0, wrong: 0, misses: 0, rts: [] }; clock = 0; nextAt = rand(1, 2); trial = null; renderStats(); },
    onTick(dt) {
      clock += dt;
      fixAcc += dt;
      if (fixAcc > 1.6) { fixAcc = 0; fix.textContent = Math.floor(Math.random() * 9) + 1; }
      if (!trial && clock >= nextAt) show();
      if (trial) {
        const age = clock - trial.at;
        if (trial.visible && age * 1000 >= cfg.flash) { dot.style.display = 'none'; trial.visible = false; }
        if (age > 1.6) { stats.misses++; trial = null; nextAt = clock + rand(0.8, 2); renderStats(); }
      }
    },
    onStop(seconds) {
      dot.style.display = 'none';
      trial = null;
      if (seconds >= 5) {
        const total = stats.hits + stats.wrong + stats.misses;
        logActivity({ type: 'peripheral', seconds: Math.round(seconds), accuracy: total ? Math.round(100 * stats.hits / total) : null, rtMs: avgRt(), flash: cfg.flash, ecc: cfg.ecc });
      }
    },
  });

  const page = exercisePage(root, {
    title: 'Peripheral awareness',
    lede: 'Keep your eyes on the center number. A dot will flash somewhere at the edge; report where with the arrow keys without looking at it.',
    timer,
  });
  const { stage, side } = page;
  const fix = h('div', { class: 'fix' }, '5');
  const dot = h('div', { class: 'dot', style: 'display:none' });
  const statsBox = h('div', { class: 'hud' });
  stage.append(fix, dot, statsBox);

  function show() {
    const dir = pick(Object.values(DIRS));
    const e = cfg.ecc / 100;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const pad = cfg.size + 6;
    const x = dir === 'left' ? W / 2 - (W / 2 - pad) * e : dir === 'right' ? W / 2 + (W / 2 - pad) * e : W / 2 + rand(-0.15, 0.15) * W;
    const y = dir === 'up' ? H / 2 - (H / 2 - pad) * e : dir === 'down' ? H / 2 + (H / 2 - pad) * e : H / 2 + rand(-0.15, 0.15) * H;
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    dot.style.width = dot.style.height = cfg.size + 'px';
    dot.style.display = '';
    trial = { dir, at: clock, visible: true };
  }

  function answer(dir) {
    if (!timer.running) return;
    if (!trial) { stats.wrong++; renderStats(); return; }
    const rt = (clock - trial.at) * 1000;
    if (dir === trial.dir) { stats.hits++; stats.rts.push(rt); beep(880, 50, 0.04); } else { stats.wrong++; beep(300, 90, 0.05); }
    dot.style.display = 'none';
    trial = null;
    nextAt = clock + rand(0.8, 2.2);
    renderStats();
  }

  const avgRt = () => stats.rts.length ? Math.round(stats.rts.reduce((a, b) => a + b, 0) / stats.rts.length) : null;
  function renderStats() {
    const total = stats.hits + stats.wrong + stats.misses;
    statsBox.textContent = total
      ? `${stats.hits}/${total} correct · ${stats.misses} missed` + (avgRt() ? ` · ${avgRt()} ms avg` : '')
      : 'Use the arrow keys or the buttons to answer';
  }

  const arrowPad = h('div', { class: 'arrows' },
    h('span'), button('↑', () => answer('up'), 'btn small'), h('span'),
    button('←', () => answer('left'), 'btn small'), h('span'), button('→', () => answer('right'), 'btn small'),
    h('span'), button('↓', () => answer('down'), 'btn small'), h('span'));

  side.append(
    panel('Setup',
      slider({ label: 'How far out', min: 30, max: 100, value: cfg.ecc, fmt: v => v + '%', onInput: v => { cfg.ecc = v; } }).el,
      slider({ label: 'Flash length', min: 80, max: 1000, step: 20, value: cfg.flash, fmt: v => v + ' ms', onInput: v => { cfg.flash = v; } }).el,
      slider({ label: 'Dot size', min: 6, max: 50, value: cfg.size, fmt: v => v + ' px', onInput: v => { cfg.size = v; } }).el),
    panel('Answer', h('p', { class: 'note' }, 'Arrow keys work too.'), arrowPad),
    howTo([
      'Sit centered, about arm\'s length away. Fullscreen makes this harder and more useful.',
      'Stare at the center number. Say it out loud when it changes so you know you stayed there.',
      'When a dot flashes, press the arrow for where it was. Don\'t move your eyes to find it.',
      'Make it harder with shorter flashes, smaller dots, and pushing them farther out.',
    ]));

  renderStats();
  const unkey = keys(Object.assign({
    ' ': () => (timer.running ? timer.stop(false) : timer.start()),
    Enter: () => (timer.running ? timer.stop(false) : timer.start()),
    f: () => toggleFullscreen(page.wrap),
  }, Object.fromEntries(Object.entries(DIRS).map(([k, d]) => [k, () => answer(d)]))));
  return () => { timer.stop(false); unkey(); };
};

/* ---------- rest ---------- */

views.rest = function (root) {
  const cfg = loadCfg('rest', { mode: 'breathe', inhale: 4, hold: 4 });
  let phaseIdx = -1;
  let phaseAcc = 0;
  let farAcc = 0;

  const breathPhases = () => [
    ['Breathe in', cfg.inhale, 1],
    ['Hold', cfg.hold, 1],
    ['Breathe out', cfg.inhale + 2, 0.5],
    ['Hold', cfg.hold, 0.5],
  ].filter(p => p[1] > 0);

  const timer = sessionTimer({
    minutes: 1,
    onStart() { phaseIdx = -1; phaseAcc = 0; farAcc = 0; step(); },
    onTick(dt) {
      if (cfg.mode === 'breathe') {
        phaseAcc += dt;
        const p = breathPhases()[phaseIdx];
        if (p && phaseAcc >= p[1]) { phaseAcc = 0; step(); }
      } else {
        farAcc += dt;
        const cycle = farAcc % 30;
        label.textContent = cycle < 20
          ? `Look at something 20 feet (6 m) away · ${Math.ceil(20 - cycle)}`
          : `Blink slowly and fully · ${Math.ceil(30 - cycle)}`;
        if (Math.abs(cycle - 20) < dt || cycle < dt) beep(520, 120, 0.04);
      }
    },
    onStop(seconds) {
      if (seconds >= 5) logActivity({ type: 'rest', seconds: Math.round(seconds), mode: cfg.mode });
      idle();
    },
  });

  const page = exercisePage(root, {
    title: 'Rest and reset',
    lede: 'Use between exercises or whenever symptoms build. Calm breathing settles the nervous system; distance looking relaxes focusing muscles.',
    timer,
  });
  const { stage, side } = page;
  const ring = h('div', { class: 'breath' });
  const label = h('div', { class: 'breath-label' });
  stage.append(ring, label);

  function step() {
    if (cfg.mode !== 'breathe') { ring.style.display = 'none'; return; }
    ring.style.display = '';
    const phases = breathPhases();
    phaseIdx = (phaseIdx + 1) % phases.length;
    const [text, secs, scale] = phases[phaseIdx];
    ring.style.transitionDuration = secs + 's';
    ring.style.transform = `scale(${scale})`;
    label.textContent = text;
    if (settings.sound) beep(text === 'Breathe in' ? 440 : text === 'Breathe out' ? 330 : 390, 140, 0.03);
  }

  function idle() {
    ring.style.transitionDuration = '1s';
    ring.style.transform = 'scale(.5)';
    ring.style.display = cfg.mode === 'breathe' ? '' : 'none';
    label.textContent = cfg.mode === 'breathe'
      ? 'Press Start, then close your eyes and cup your palms over them'
      : 'Press Start, then look away from the screen';
  }

  const breathFields = h('div', {},
    slider({ label: 'Breathe in for', min: 3, max: 6, value: cfg.inhale, fmt: v => `${v} s (out for ${v + 2} s)`, onInput: v => { cfg.inhale = v; } }).el,
    slider({ label: 'Hold for', min: 0, max: 6, value: cfg.hold, fmt: v => v + ' s', onInput: v => { cfg.hold = v; } }).el);

  side.append(
    panel('Mode',
      segmented([['breathe', 'Palming + breathing'], ['far', '20-20-20']], cfg.mode, v => {
        cfg.mode = v; breathFields.style.display = v === 'breathe' ? '' : 'none';
        if (timer.running) timer.stop(false);
        idle();
      }),
      breathFields),
    howTo([
      '<b>Palming:</b> rub your hands warm, close your eyes and cup your palms over them without pressing. Follow the tones: rising for in, falling for out.',
      'A longer out-breath than in-breath is the calming part.',
      '<b>20-20-20:</b> every 20 minutes of screen time, look about 20 feet away for 20 seconds, then blink slowly. Good between every vergence set.',
    ]));

  breathFields.style.display = cfg.mode === 'breathe' ? '' : 'none';
  idle();
  const unkey = keys({
    ' ': () => (timer.running ? timer.stop(false) : timer.start()),
    Enter: () => (timer.running ? timer.stop(false) : timer.start()),
    f: () => toggleFullscreen(page.wrap),
  });
  return () => { timer.stop(false); unkey(); };
};

/* ---------- progress ---------- */

const SYMPTOMS = [['headache', 'Headache'], ['dizzy', 'Dizziness'], ['strain', 'Eye strain'], ['fog', 'Fogginess'], ['light', 'Light sensitivity']];

function lineChart(series, { yLabel = '', height = 200 } = {}) {
  const W = 560;
  const H = height;
  const pad = { l: 40, r: 12, t: 10, b: 26 };
  const pts = series.flatMap(s => s.points);
  if (!pts.length) return h('p', { class: 'empty' }, 'Nothing recorded yet.');
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  if (x1 === x0) { x0 -= 864e5; x1 += 864e5; }
  const y0 = 0;
  const y1 = Math.max(1, ...ys) * 1.1;
  const sx = x => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const sy = y => H - pad.b - (y - y0) / (y1 - y0) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => y0 + f * (y1 - y0));
  const xt = [x0, (x0 + x1) / 2, x1];
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${yLabel} over time">
    <g class="grid">${ticks.map(t => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(t)}" y2="${sy(t)}"/>`).join('')}</g>
    ${ticks.map(t => `<text x="${pad.l - 6}" y="${sy(t) + 4}" text-anchor="end">${Math.round(t)}</text>`).join('')}
    ${xt.map((t, i) => `<text x="${sx(t)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][i]}">${fmtDate(t)}</text>`).join('')}
    ${series.map(s => {
      const p = s.points.slice().sort((a, b) => a.x - b.x);
      const d = p.map((q, i) => `${i ? 'L' : 'M'}${sx(q.x).toFixed(1)} ${sy(q.y).toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>` +
        p.map(q => `<circle cx="${sx(q.x)}" cy="${sy(q.y)}" r="3.5" fill="${s.color}"><title>${fmtDate(q.x)}: ${Math.round(q.y)} ${yLabel}</title></circle>`).join('');
    }).join('')}
  </svg>`;
  return h('div', {},
    h('div', { class: 'legend' }, series.map(s => h('span', {}, h('i', { style: `background:${s.color}` }), s.name))),
    h('div', { html: svg }));
}

function bestPerDay(records, mode, useMm) {
  const byDay = new Map();
  for (const r of records.filter(x => x.mode === mode)) {
    const v = useMm ? r.mm : r.px;
    if (v == null) continue;
    const k = dayKey(r.date);
    const d = new Date(r.date); d.setHours(12, 0, 0, 0);
    if (!byDay.has(k) || byDay.get(k).y < v) byDay.set(k, { x: d.getTime(), y: v });
  }
  return [...byDay.values()];
}

function describe(entry) {
  switch (entry.type) {
    case 'vergence': return [entry.mode === 'crossed' ? 'Crossing' : 'Relaxing', entry.drill !== 'free' ? entry.drill : null,
      entry.bestPx ? `best ${entry.bestMm ? Math.round(entry.bestMm) + ' mm' : entry.bestPx + ' px'}` : null,
      entry.jumps ? `${entry.jumps} jumps` : null].filter(Boolean).join(', ');
    case 'pursuits': return `${entry.path}, ${entry.speed}/min`;
    case 'saccades': return `${entry.layout}, ${entry.jumps} jumps (${entry.perMin}/min)`;
    case 'hart': return `${entry.pattern}, ${entry.letters} letters`;
    case 'vor': return `${entry.direction}, ${entry.bpm}/min`;
    case 'okn': return `${entry.dir}, ${entry.speed} px/s, ${entry.contrast}% contrast`;
    case 'peripheral': return `${entry.accuracy ?? '–'}% correct` + (entry.rtMs ? `, ${entry.rtMs} ms` : '');
    case 'rest': return entry.mode === 'far' ? '20-20-20' : 'Palming';
    default: return '';
  }
}

views.progress = function (root) {
  const log = store.get('log', []);
  const checkins = store.get('checkins', []);
  const records = store.get('vergence:records', []);
  const color = name => cssColor(document.documentElement, name);

  const values = Object.fromEntries(SYMPTOMS.map(([k]) => [k, 0]));
  let when = 'before';
  const noteEl = h('textarea', { placeholder: 'Optional note: sleep, screen time, anything that stood out' });
  const form = panel('How do you feel right now?',
    segmented([['before', 'Before session'], ['after', 'After session'], ['other', 'Other']], when, v => { when = v; }),
    SYMPTOMS.map(([k, label]) => slider({ label, min: 0, max: 10, value: 0, fmt: v => `${v} / 10`, onInput: v => { values[k] = v; } }).el),
    noteEl,
    h('div', { class: 'btn-row', style: 'margin-top:10px' }, button('Save check-in', () => {
      const all = store.get('checkins', []);
      all.push({ date: new Date().toISOString(), when, ...values, note: noteEl.value.trim() || undefined });
      store.set('checkins', all);
      route();
    }, 'btn primary')));

  const useMm = records.length > 0 && records.every(r => r.mm != null);
  const vergenceChart = panel('Vergence: best separation per day',
    lineChart([
      { name: 'Relaxing', color: color('--accent'), points: bestPerDay(records, 'relaxed', useMm) },
      { name: 'Crossing', color: color('--hi'), points: bestPerDay(records, 'crossed', useMm) },
    ], { yLabel: useMm ? 'mm' : 'px' }));

  const symptomChart = panel('Symptom total (0 to 50)',
    lineChart([
      { name: 'Before', color: color('--warn'), points: checkins.filter(c => c.when === 'before').map(c => ({ x: new Date(c.date).getTime(), y: SYMPTOMS.reduce((s, [k]) => s + (c[k] || 0), 0) })) },
      { name: 'After', color: color('--bad'), points: checkins.filter(c => c.when === 'after').map(c => ({ x: new Date(c.date).getTime(), y: SYMPTOMS.reduce((s, [k]) => s + (c[k] || 0), 0) })) },
      { name: 'Other', color: color('--muted'), points: checkins.filter(c => c.when !== 'before' && c.when !== 'after').map(c => ({ x: new Date(c.date).getTime(), y: SYMPTOMS.reduce((s, [k]) => s + (c[k] || 0), 0) })) },
    ].filter(s => s.points.length), { yLabel: 'points' }));

  const recent = log.slice(-40).reverse();
  const table = recent.length
    ? h('table', { class: 'log' },
      h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Exercise'), h('th', {}, 'Time'), h('th', {}, 'Details'))),
      h('tbody', {}, recent.map(e => h('tr', {},
        h('td', {}, new Date(e.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
        h('td', {}, exTitle(e.type)),
        h('td', {}, fmtTime(e.seconds || 0)),
        h('td', {}, describe(e))))))
    : h('p', { class: 'empty' }, 'No sessions yet. Anything you run for at least 5 seconds shows up here.');

  const recentCheckins = checkins.slice(-8).reverse();
  const checkinList = recentCheckins.length
    ? h('table', { class: 'log' },
      h('thead', {}, h('tr', {}, h('th', {}, 'When'), ...SYMPTOMS.map(([, l]) => h('th', {}, l.split(' ')[0])), h('th', {}, 'Note'))),
      h('tbody', {}, recentCheckins.map(c => h('tr', {},
        h('td', {}, `${fmtDate(c.date)} ${c.when === 'other' ? '' : c.when}`),
        ...SYMPTOMS.map(([k]) => h('td', {}, c[k] ?? 0)),
        h('td', {}, c.note || '')))))
    : h('p', { class: 'empty' }, 'No check-ins yet.');

  root.append(
    h('div', { class: 'ex-head' }, h('h1', {}, 'Progress'),
      h('p', { class: 'lede' }, 'Everything is stored only in this browser. Export a backup from Settings if you want to keep it or share it with your therapist.')),
    h('div', { class: 'prog-grid' },
      form,
      h('div', { class: 'side' }, symptomChart, panel('Recent check-ins', checkinList)),
      h('div', { class: 'wide' }, vergenceChart),
      h('div', { class: 'wide' }, panel('Session log', table))));
};

/* ---------- settings ---------- */

views.settings = function (root) {
  const CARD_MM = 85.6;
  let calibPx = settings.pxPerMm ? settings.pxPerMm * CARD_MM : 324;
  const card = h('div', { class: 'calib-card' }, 'Hold a credit card here');
  const sizeCard = () => { card.style.width = calibPx + 'px'; card.style.height = (calibPx * 53.98 / CARD_MM) + 'px'; };
  const calibStatus = h('p', { class: 'note' });
  const renderStatus = () => {
    calibStatus.textContent = settings.pxPerMm
      ? `Calibrated: ${settings.pxPerMm.toFixed(2)} px per mm.`
      : 'Not calibrated yet. Distances are shown in pixels.';
  };

  const themeSeg = segmented([['dark', 'Dark'], ['dim', 'Dim'], ['light', 'Light']], settings.theme, v => {
    settings.theme = v; saveSettings(); document.documentElement.dataset.theme = v;
  });

  const fileInput = h('input', {
    type: 'file', accept: 'application/json', style: 'display:none',
    onchange: async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || typeof data !== 'object' || !Array.isArray(data.log)) throw new Error('bad file');
        if (!confirm('Replace your current data with this backup?')) return;
        store.set('log', data.log);
        store.set('checkins', Array.isArray(data.checkins) ? data.checkins : []);
        store.set('vergence:records', Array.isArray(data.vergenceRecords) ? data.vergenceRecords : []);
        alert('Backup restored.');
      } catch (err) {
        alert('That file does not look like a Vision Trainer backup.');
      }
    },
  });

  function exportData() {
    const data = {
      app: 'vision-trainer', exported: new Date().toISOString(),
      log: store.get('log', []), checkins: store.get('checkins', []), vergenceRecords: store.get('vergence:records', []),
      settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `vision-trainer-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  root.append(
    h('div', { class: 'ex-head' }, h('h1', {}, 'Settings')),
    h('div', { class: 'prog-grid' },
      panel('Display',
        h('p', { class: 'note' }, 'Dark and Dim reduce glare, which helps with post-concussion light sensitivity. Lowering your screen brightness helps too.'),
        themeSeg,
        checkbox('Sound cues (metronome, start and finish tones)', settings.sound, v => { settings.sound = v; saveSettings(); })),
      panel('Screen calibration',
        h('p', { class: 'note' }, 'Hold a standard bank card against the screen and drag the slider until the dashed box is exactly the same width. This lets the vergence exercise show real millimeters and prism diopters.'),
        slider({ label: 'Box width', min: 150, max: 700, value: Math.round(calibPx), fmt: v => v + ' px', onInput: v => { calibPx = v; sizeCard(); } }).el,
        card,
        slider({ label: 'Your viewing distance', min: 25, max: 100, value: settings.viewCm, fmt: v => v + ' cm', onInput: v => { settings.viewCm = v; saveSettings(); } }).el,
        h('div', { class: 'btn-row' },
          button('Save calibration', () => { settings.pxPerMm = calibPx / CARD_MM; saveSettings(); renderStatus(); }, 'btn primary'),
          button('Clear', () => { settings.pxPerMm = null; saveSettings(); renderStatus(); }, 'btn')),
        calibStatus),
      panel('Your data',
        h('p', { class: 'note' }, 'Sessions, check-ins and records are saved in this browser only. Export a file to back them up or move them to another computer.'),
        h('div', { class: 'btn-row' },
          button('Export backup', exportData, 'btn'),
          button('Import backup', () => fileInput.click(), 'btn'),
          button('Delete all data', () => {
            if (!confirm('Delete all sessions, check-ins and records from this browser? This cannot be undone.')) return;
            ['log', 'checkins', 'vergence:records'].forEach(k => store.set(k, []));
            alert('Data deleted.');
          }, 'btn danger')),
        fileInput),
      panel('Keyboard',
        h('ul', { class: 'routine' },
          h('li', {}, h('kbd', {}, 'Enter'), ' start or stop the session'),
          h('li', {}, h('kbd', {}, 'Space'), ' main action (record, next, start)'),
          h('li', {}, h('kbd', {}, 'F'), ' fullscreen'),
          h('li', {}, h('kbd', {}, '←'), ' ', h('kbd', {}, '→'), ' adjust vergence separation'),
          h('li', {}, 'Arrow keys answer in Peripheral awareness')))));

  sizeCard();
  renderStatus();
};

/* ---------- router ---------- */

const app = document.getElementById('app');
let cleanup = null;

function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  const id = location.hash.replace(/^#\/?/, '') || 'home';
  const view = views[id] || views.home;
  app.replaceChildren();
  cleanup = view(app) || null;
  document.querySelectorAll('[data-nav]').forEach(a => {
    const nav = a.dataset.nav;
    a.classList.toggle('active', nav === id || (nav === 'home' && !['progress', 'settings'].includes(id)));
  });
  const ex = EXERCISES.find(e => e.id === id);
  document.title = ex ? `${ex.title} · Vision Trainer` : id === 'home' ? 'Vision Trainer' : `${id[0].toUpperCase() + id.slice(1)} · Vision Trainer`;
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
