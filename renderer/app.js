'use strict';
const T = window.trimmer;
const $ = id => document.getElementById(id);
const v = $('v'), lane = $('lanein');

// ---------- icons ----------
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  back5: `<svg viewBox="0 0 24 24"><path ${S} d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4"/><text x="12.2" y="15.2" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" font-family="Segoe UI,sans-serif">5</text></svg>`,
  fwd5: `<svg viewBox="0 0 24 24"><path ${S} d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4"/><text x="11.8" y="15.2" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" font-family="Segoe UI,sans-serif">5</text></svg>`,
  speaker: `<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path ${S} d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11"/></svg>`,
  speakerOff: `<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path ${S} d="M16 9.5l5 5M21 9.5l-5 5"/></svg>`,
  headphones: `<svg viewBox="0 0 24 24"><path ${S} d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3"/><rect ${S} x="4" y="14" width="4" height="6" rx="1.5"/><rect ${S} x="16" y="14" width="4" height="6" rx="1.5"/></svg>`,
  headphonesOff: `<svg viewBox="0 0 24 24"><path ${S} d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3"/><rect ${S} x="4" y="14" width="4" height="6" rx="1.5"/><rect ${S} x="16" y="14" width="4" height="6" rx="1.5"/><path ${S} d="M3 3l18 18"/></svg>`,
  grid: `<svg viewBox="0 0 24 24"><rect ${S} x="4" y="4" width="7" height="7" rx="1.5"/><rect ${S} x="13" y="4" width="7" height="7" rx="1.5"/><rect ${S} x="4" y="13" width="7" height="7" rx="1.5"/><rect ${S} x="13" y="13" width="7" height="7" rx="1.5"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle ${S} cx="11" cy="11" r="6.5"/><path ${S} d="M16 16l4 4"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path ${S} d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/></svg>`,
  more: `<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18" cy="12" r="1.7" fill="currentColor"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path ${S} d="M5.5 12.5l4.2 4.2 8.8-9.2"/></svg>`,
  edit: `<svg viewBox="0 0 24 24"><path ${S} d="M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z"/><path ${S} d="M13.5 7.3l3.2 3.2"/></svg>`,
  sort: `<svg viewBox="0 0 24 24"><path ${S} d="M8 19V5M4.5 8.5L8 5l3.5 3.5M16 5v14M12.5 15.5L16 19l3.5-3.5"/></svg>`,
  chev: `<svg viewBox="0 0 24 24"><path ${S} d="M7 10l5 5 5-5"/></svg>`,
  blank: '<svg viewBox="0 0 24 24"></svg>',
  scissors: `<svg viewBox="0 0 24 24"><circle ${S} cx="6.5" cy="7" r="2.5"/><circle ${S} cx="6.5" cy="17" r="2.5"/><path ${S} d="M8.6 8.4L19 17M8.6 15.6L19 7"/></svg>`,
  monitor: `<svg viewBox="0 0 24 24"><rect ${S} x="3.5" y="4.5" width="17" height="11.5" rx="1.5"/><path ${S} d="M9 20h6M12 16v4"/></svg>`,
  gamepad: `<svg viewBox="0 0 24 24"><path ${S} d="M7.5 8h9a4.5 4.5 0 0 1 4.4 5.4l-.7 3.3a2 2 0 0 1-3.4 1L15 16H9l-1.8 1.7a2 2 0 0 1-3.4-1l-.7-3.3A4.5 4.5 0 0 1 7.5 8z"/><path ${S} d="M8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01"/></svg>`,
  chat: `<svg viewBox="0 0 24 24"><path ${S} d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z"/><path ${S} d="M8.5 11.25h.01M12 11.25h.01M15.5 11.25h.01"/></svg>`,
  gear: `<svg viewBox="0 0 24 24"><circle ${S} cx="12" cy="12" r="3"/><path ${S} d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  back: `<svg viewBox="0 0 24 24"><path ${S} d="M14.5 6l-6 6 6 6"/></svg>`,
  sideClose: `<svg viewBox="0 0 24 24"><rect ${S} x="3.5" y="4.5" width="17" height="15" rx="2"/><path ${S} d="M9 4.5v15M15.5 9.5L13 12l2.5 2.5"/></svg>`,
  sideOpen: `<svg viewBox="0 0 24 24"><rect ${S} x="3.5" y="4.5" width="17" height="15" rx="2"/><path ${S} d="M9 4.5v15M13 9.5l2.5 2.5-2.5 2.5"/></svg>`,
  library: `<svg viewBox="0 0 24 24"><path ${S} d="M5 4v16M10 4v16M14.5 4.6l4.5 15"/></svg>`,
  wave: `<svg viewBox="0 0 24 24"><path ${S} d="M4 10.5v3M8 7.5v9M12 4.5v15M16 8v8M20 10.5v3"/></svg>`,
  mic: `<svg viewBox="0 0 24 24"><rect ${S} x="9" y="3.5" width="6" height="11" rx="3"/><path ${S} d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></svg>`,
  music: `<svg viewBox="0 0 24 24"><path ${S} d="M9 17.5V6l10-2v11.5"/><circle ${S} cx="6.5" cy="17.5" r="2.5"/><circle ${S} cx="16.5" cy="15.5" r="2.5"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><path ${S} d="M7 7l10 10M17 7L7 17"/></svg>`,
  help: `<svg viewBox="0 0 24 24"><circle ${S} cx="12" cy="12" r="8.5"/><path ${S} d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 16.8h.01"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path ${S} d="M12 5v14M5 12h14"/></svg>`,
  folder: `<svg viewBox="0 0 24 24"><path ${S} d="M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24"><rect ${S} x="8.5" y="8.5" width="11" height="11.5" rx="2"/><path ${S} d="M5 15.5V6a2 2 0 0 1 2-2h8.5"/></svg>`,
  export: `<svg viewBox="0 0 24 24"><path ${S} d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>`,
};
function setIco(el, name) { if (el.dataset.ico !== name || !el.firstChild) { el.dataset.ico = name; el.innerHTML = ICONS[name] || ''; } }
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = ICONS[el.dataset.ico] || ''; });
const icoSpan = name => { const s = document.createElement('span'); s.className = 'ico'; setIco(s, name); return s; };

// ---------- state ----------
// The active tab's values live in these variables while it's showing; switching tabs
// saves them into the tab object and loads the next tab's values.
let dur = 0, fps = 30, tin = 0, tout = 0, info = null;
let extras = [];               // extra audio files: [{path, name, title}]
let mainTracks = [];           // per audio stream in the clip: {include, volume}
let extraSet = new Map();      // extra file path -> {include, volume}
let masterMute = false, peaks = null, trackSyncs = [];
let session = null;            // live audio engine for the active tab (renderer/engine.mjs)
let sessionKey = '', sessionLoading = false;
let selfSeekTo = null;         // set when the sync loop moves the video, so that seek isn't echoed to the audio
let syncLog = null;            // self-test: records video-vs-audio offsets
let drag = null, wasPlaying = false, exporting = false;
let tabs = [], active = null;
let loop = true;
let libMode = true;          // a page other than the editor is showing (library.js)
try { loop = localStorage.getItem('loop') !== 'off'; } catch (e) { /* ignore */ }

const fmt = t => {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  const ss = (s < 10 ? '0' : '') + s.toFixed(2);
  return h ? `${h}:${m < 10 ? '0' : ''}${m}:${ss}` : `${m}:${ss}`;
};
const parse = s => {
  s = s.trim();
  if (!s) return NaN;
  const p = s.split(':').map(Number);
  if (p.length > 3 || p.some(isNaN)) return NaN;
  return p.reduce((a, x) => a * 60 + x, 0);
};
const fmtSize = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB';
const clamp = (t, a, b) => Math.min(b, Math.max(a, t));
const pct = t => (dur ? t / dur * 100 : 0);
// Status line under the sidebar. `hideMs`: fade it out after that long (paused while the mouse
// is over it, so "Show in folder" stays clickable). Progress and clip warnings stay put.
let hideTimer = null;
function msg(text, cls, hideMs) {
  const s = $('status');
  s.className = cls || '';
  s.textContent = text || '';
  autoHide(hideMs);
}
function autoHide(ms) {
  clearTimeout(hideTimer);
  if (!ms) return;
  const s = $('status');
  const arm = t => {
    hideTimer = setTimeout(() => {
      if (s.matches(':hover')) return arm(1500);
      s.classList.add('fade');
      hideTimer = setTimeout(() => { s.textContent = ''; s.className = ''; }, 400);
    }, t);
  };
  arm(ms);
}

const setIn = (t, seek = true) => { tin = clamp(t, 0, Math.max(0, tout - 0.05)); if (seek) v.currentTime = tin; };
const setOut = (t, seek = true) => { tout = clamp(t, Math.min(dur, tin + 0.05), dur); if (seek) v.currentTime = tout; };

// ---------- render loop ----------
function render() {
  const ct = v.currentTime || 0;
  $('selbox').style.left = `calc(${pct(tin)}% - 4px)`;
  $('selbox').style.width = `calc(${pct(tout) - pct(tin)}% + 8px)`;
  $('shadeL').style.width = pct(tin) + '%';
  $('shadeR').style.width = (100 - pct(tout)) + '%';
  $('playhead').style.left = pct(ct) + '%';
  if (document.activeElement !== $('tin')) $('tin').value = fmt(tin);
  if (document.activeElement !== $('tout')) $('tout').value = fmt(tout);
  $('len').textContent = fmt(tout - tin);
  $('cur').textContent = fmt(info ? ct : 0);
  $('tot').textContent = fmt(dur);
  setIco($('play').firstElementChild, v.paused ? 'play' : 'pause');
  // playback stays inside the selection
  if (!v.paused && dur && !drag) {
    if (ct >= tout - 0.01) { if (loop) v.currentTime = tin; else { v.pause(); v.currentTime = tout; } }
    else if (ct < tin - 0.05) v.currentTime = tin;
  }
  syncVideo();
  requestAnimationFrame(render);
}

// ---------- ruler, waveform, filmstrip ----------
function rulerLabel(t, major) {
  if (t < 60) return (major < 1 ? t.toFixed(1) : Math.round(t)) + 's';
  const m = Math.floor(t / 60), s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function buildRuler() {
  const r = $('ruler');
  r.replaceChildren();
  const w = lane.clientWidth;
  if (!dur || !w) return;
  const pps = w / dur;
  const steps = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const major = steps.find(s => s * pps >= 70) || 3600;
  const minor = major / 5;
  const frag = document.createDocumentFragment();
  const n = Math.floor(dur / minor + 1e-6);
  for (let i = 0; i <= n; i++) {
    const t = i * minor;
    const isMajor = i % 5 === 0;
    const d = document.createElement('div');
    d.className = 'tick' + (isMajor ? ' major' : '');
    d.style.left = pct(t) + '%';
    frag.append(d);
    if (isMajor && pct(t) < 96) {
      const l = document.createElement('div');
      l.className = 'tlabel';
      l.style.left = pct(t) + '%';
      l.textContent = rulerLabel(t, major);
      frag.append(l);
    }
  }
  r.append(frag);
}
function drawWave() {
  const c = $('wave');
  const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!peaks || !peaks.length || !w) return;
  g.fillStyle = '#4e4d54';
  const bars = Math.floor(w / 3), mid = c.height / 2;
  for (let i = 0; i < bars; i++) {
    const a = Math.floor(i / bars * peaks.length);
    const b = Math.max(a + 1, Math.floor((i + 1) / bars * peaks.length));
    let p = 0;
    for (let j = a; j < b; j++) if (peaks[j] > p) p = peaks[j];
    const bh = Math.max(dpr, p * (c.height - 2 * dpr));
    g.fillRect(Math.round(i * 3 * dpr), mid - bh / 2, Math.max(1, Math.round(2 * dpr)), bh);
  }
}
const placeholder = () => { const d = document.createElement('div'); d.className = 'ph'; return d; };
function paintStrip(t) {
  const strip = $('strip');
  if (!t) { strip.replaceChildren(); $('infothumb').style.backgroundImage = ''; return; }
  if (!t.thumbs) {
    const n = Math.max(8, Math.min(40, Math.round(lane.clientWidth / 96)));
    strip.replaceChildren(...Array.from({ length: n }, placeholder));
    $('infothumb').style.backgroundImage = '';
    return;
  }
  strip.replaceChildren(...t.thumbs.map(src => {
    if (!src) return placeholder();
    const img = document.createElement('img'); img.src = src; img.alt = ''; return img;
  }));
  const cover = t.thumbs[Math.floor(t.thumbs.length / 3)] || t.thumbs.find(Boolean);
  $('infothumb').style.backgroundImage = cover ? `url("${cover}")` : '';
}
// thumbnails and waveform are made once per tab and kept with it
async function loadVisuals(t) {
  if (t.visuals) return;
  t.visuals = true;
  const n = Math.max(8, Math.min(40, Math.round(lane.clientWidth / 96)));
  T.waveform(t.id, 1200).then(r => {
    if (!r.ok) return;
    t.peaks = r.peaks;
    if (t === active) { peaks = r.peaks; drawWave(); }
  });
  const r = await T.thumbs(t.id, n);
  if (!r.ok) return;
  t.thumbs = r.thumbs;
  if (t === active) paintStrip(t);
}
new ResizeObserver(() => { buildRuler(); drawWave(); }).observe(lane);

// ---------- audio ----------
// Discord clips carry a full mix ("all"), a duplicate of it ("all_copy") and the separate
// sources it was made from. Only the sources are shown as tracks.
const FULL_MIX = new Set(['all', 'all_copy']);
// Whose voice is "You": Discord's clip info lists whoever saved the clip first. Remembered, for
// the odd clip that has no info.
function myDiscordId() {
  try {
    if (info && info.owner) { localStorage.setItem('discordId', info.owner); return info.owner; }
    return localStorage.getItem('discordId') || '';
  } catch (e) { return (info && info.owner) || ''; }
}
const sourceIdx = () => (info.audio || []).map((a, k) => k).filter(k => !(info.discord && FULL_MIX.has(info.audio[k].kind)));
const multi = () => !!info && (sourceIdx().length > 1 || extras.length > 0);
const masterVol = () => Number($('vol').value) / 100;

// What each audio stream should do on export. For an untouched Discord clip that's just the
// original full mix; once a source is muted or turned up/down, the sources get mixed instead.
const untouched = () => sourceIdx().every(k => mainTracks[k].include && Math.abs(mainTracks[k].volume - 1) < 0.001);
function exportTracks() {
  const extraTracks = extras.map(x => extraSet.get(x.path));
  if (!info.discord) return [...mainTracks, ...extraTracks];
  const useFull = untouched() && $('mix').checked;
  const main = info.audio.map((a, k) => {
    if (a.kind === 'all') return { include: useFull, volume: 1 };
    if (a.kind === 'all_copy') return { include: false, volume: 1 };
    return useFull ? { include: false, volume: 1 } : mainTracks[k];
  });
  return [...main, ...extraTracks];
}

// Listening volume: scales only what you hear (the export uses the sidebar's volume). Saved
// between sessions. Squared so the slider feels even across its range.
let listenVol = 1, listenMute = false;
try {
  const l = JSON.parse(localStorage.getItem('listen') || 'null');
  if (l) { listenVol = Math.min(1, Math.max(0, +l.vol || 0)); listenMute = !!l.mute; }
} catch (e) { /* ignore */ }
const listenGain = () => (listenMute ? 0 : listenVol * listenVol);
function applyListen() {
  if (window.ClipAudio) window.ClipAudio.setListen(listenGain());
  $('lvol').value = Math.round(listenVol * 100);
  setIco($('lmute').firstElementChild, listenMute || !listenVol ? 'headphonesOff' : 'headphones');
  $('lmute').classList.toggle('off', listenMute);
  $('lmute').title = (listenMute ? 'Unmute' : 'Mute') + ' listening (the export is not affected)';
  $('lvol').title = `Listening volume ${Math.round(listenVol * 100)}% (the export is not affected)`;
  try { localStorage.setItem('listen', JSON.stringify({ vol: listenVol, mute: listenMute })); } catch (e) { /* ignore */ }
  applyAudio();
}
$('lvol').addEventListener('input', () => { listenVol = Number($('lvol').value) / 100; listenMute = false; applyListen(); });
$('lmute').onclick = () => { listenMute = !listenMute; applyListen(); };
$('listen').addEventListener('wheel', e => {
  e.preventDefault();
  listenVol = Math.min(1, Math.max(0, Math.round(listenVol * 100 - Math.sign(e.deltaY) * 5) / 100));
  listenMute = false;
  applyListen();
}, { passive: false });
window.addEventListener('clipaudio-ready', () => window.ClipAudio.setListen(listenGain()));

// While the audio engine is loaded, the preview plays every track at its own level through it -
// exactly what the export will contain - and the video stays muted. Until it's ready (or if a
// codec can't be decoded) the video's own audio plays instead.
function applyAudio() {
  if (session) {
    v.muted = true;
    const useFull = info.discord && untouched() && $('mix').checked && session.has('full');
    (info.audio || []).forEach((a, k) => {
      const t = mainTracks[k];
      if (session.has('s' + k)) session.setGain('s' + k, useFull ? 0 : (t.include ? t.volume : 0));
    });
    if (session.has('full')) session.setGain('full', useFull ? 1 : 0);
    for (const x of extras) {
      const set = extraSet.get(x.path);
      if (set) session.setGain('x:' + x.path, set.include ? set.volume : 0);
    }
    session.setMaster(masterMute ? 0 : masterVol());
  } else if (info) {
    let pv = masterVol(), pm = masterMute;
    if (multi() && mainTracks.length && !info.discord) {
      // the video plays track 1, so reflect its own setting
      if (!mainTracks[0].include) pm = true; else pv *= mainTracks[0].volume;
    }
    v.muted = pm;
    v.volume = Math.min(1, pv) * listenGain();
  }
  if (info && multi()) {
    $('trknote').textContent = session ? 'The preview plays your mix live, the same as the export.'
      : sessionLoading ? 'Loading the track preview...'
      : info.discord ? "The preview plays Discord's full mix; track changes apply when you export."
      : 'The preview plays track 1 only; your mix applies when you export.';
  }
  $('vol').disabled = masterMute;
  $('volv').textContent = masterMute ? 'Muted' : $('vol').value + '%';
  setIco($('mute').firstElementChild, masterMute ? 'speakerOff' : 'speaker');
  $('mute').classList.toggle('off', masterMute);
  $('mute').title = masterMute ? 'Unmute (M)' : 'Mute: removes all audio from the export (M)';
  $('vol').title = !session && masterVol() > 1 ? 'The preview tops out at 100%; the boost is applied on export' : '';
  trackSyncs.forEach(f => f());
}

function trackRow(r) {
  const row = document.createElement('div');
  row.className = 'arow';
  const nameBox = document.createElement('div'); nameBox.className = 'aname';
  nameBox.textContent = r.name;
  if (r.extra) { const s = document.createElement('small'); s.textContent = r.extra; nameBox.append(s); }
  nameBox.title = r.name + (r.extra ? ' - ' + r.extra : '');
  const range = document.createElement('input');
  Object.assign(range, { type: 'range', min: 0, max: 200, step: 5 });
  const val = document.createElement('span');
  const slider = document.createElement('div'); slider.className = 'aslider'; slider.append(range, val);
  const col = document.createElement('div'); col.className = 'acol'; col.append(nameBox, slider);
  const btns = document.createElement('div'); btns.className = 'abtns';
  const mb = document.createElement('button'); mb.className = 'ibtn sm'; mb.append(icoSpan('speaker'));
  btns.append(mb);
  if (r.removable) {
    const x = document.createElement('button'); x.className = 'ibtn sm'; x.title = 'Remove this audio file'; x.append(icoSpan('x'));
    x.onclick = async () => {
      const t = active;
      applyExtras(t, await T.removeAudio(t.id, r.key));
      if (t === active) extraSet.delete(r.key); else t.extraSet.delete(r.key);
    };
    btns.append(x);
  }
  row.append(icoSpan(r.icon), col, btns);

  const sync = () => {
    range.value = Math.round(r.set.volume * 100);
    val.textContent = r.set.include ? range.value + '%' : 'Off';
    range.disabled = !r.set.include || masterMute;
    setIco(mb.firstElementChild, r.set.include ? 'speaker' : 'speakerOff');
    mb.classList.toggle('off', !r.set.include);
    mb.title = r.set.include ? 'Leave this track out of the export' : 'Include this track';
    row.classList.toggle('excluded', !r.set.include);
  };
  range.addEventListener('input', () => { r.set.volume = range.value / 100; applyAudio(); });
  range.addEventListener('dblclick', () => { r.set.volume = 1; applyAudio(); });
  mb.onclick = () => { r.set.include = !r.set.include; applyAudio(); };
  trackSyncs.push(sync);
  return row;
}

function buildTracks() {
  const list = $('tracklist');
  list.replaceChildren();
  trackSyncs = [];
  const show = multi();
  list.hidden = $('mixrow').hidden = $('trknote').hidden = !show;
  $('mastername').textContent = show ? 'Master volume'
    : (info && !(info.audio || []).length ? 'Volume (this clip has no audio)' : 'Volume');
  if (show) {
    let voice = 0;
    const me = myDiscordId();
    const n = (info.audio || []).length;
    // what each track is: Discord labels its tracks; NVIDIA's "separate both tracks" puts game
    // or desktop audio first and your mic second; OBS and others title the mic track
    const label = (a, k) => {
      if (info.discord) {
        if (a.kind === 'application') return { rank: 0, name: 'Game / app audio' };
        if (a.kind === 'voice' && me && a.user === me) return { rank: 1, name: 'You', extra: 'your mic', icon: 'mic' };
        if (a.kind === 'voice') return { rank: 2, name: `Voice ${++voice}`, extra: 'person in the call', icon: 'mic' };
        if (a.kind === 'soundboard') return { rank: 3, name: 'Soundboard' };
        return { rank: 3, name: a.kind.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) };
      }
      if (/\b(mic|microphone|mic\/aux|commentary)\b/i.test(a.title || '')) return { rank: 1, name: 'You', extra: a.title, icon: 'mic' };
      if (info.nvidia && n === 2) {
        return k === 0 ? { rank: 0, name: 'Game / desktop audio' } : { rank: 1, name: 'You', extra: 'your mic', icon: 'mic' };
      }
      return { rank: 0, name: `Track ${k + 1}`, extra: a.title || a.channels };
    };
    const labels = new Map();
    // Discord voices are numbered in the order they're shown, so label after sorting by kind
    const rough = a => !info.discord ? 0 : a.kind === 'application' ? 0
      : a.kind === 'voice' && me && a.user === me ? 1 : a.kind === 'voice' ? 2 : 3;
    const pre = sourceIdx().sort((x, y) => rough(info.audio[x]) - rough(info.audio[y]) || x - y);
    for (const k of pre) labels.set(k, label(info.audio[k], k));
    const order = pre.sort((x, y) => labels.get(x).rank - labels.get(y).rank || x - y);
    for (const k of order) {
      const { name, extra = '', icon = 'wave' } = labels.get(k);
      list.append(trackRow({ key: 's' + k, set: mainTracks[k], icon, name, extra }));
    }
    extras.forEach(x => list.append(trackRow({
      key: x.path, set: extraSet.get(x.path), icon: 'music', name: x.name, extra: 'added file', removable: true,
    })));
  }
  ensureSession();
  applyAudio();
}

// ---------- live audio engine ----------
const audioReady = window.ClipAudio ? Promise.resolve()
  : new Promise(r => window.addEventListener('clipaudio-ready', r, { once: true }));
const reader = { size: p => T.fileSize(p), read: (p, a, b) => T.readRange(p, a, b) };

// which tracks the engine loads for the active clip
function engineSpecs() {
  if (!info) return [];
  const a = info.audio || [];
  const specs = [];
  if (info.discord) {
    const f = a.findIndex(x => x.kind === 'all');
    if (f >= 0) specs.push({ key: 'full', path: info.path, index: f });
  }
  for (const k of sourceIdx()) specs.push({ key: 's' + k, path: info.path, index: k });
  for (const x of extras) specs.push({ key: 'x:' + x.path, path: x.path, index: 0 });
  return specs;
}
function closeSession() {
  if (session) session.close();
  session = null;
  sessionKey = '';
  sessionLoading = false;
}
async function ensureSession() {
  const t = active;
  const specs = t ? engineSpecs() : [];
  const key = t ? t.id + '|' + specs.map(x => x.key).join(',') : '';
  if (key === sessionKey) return;
  closeSession();
  if (!specs.length) { applyAudio(); return; }
  sessionKey = key;
  sessionLoading = true;
  applyAudio();
  let s = null;
  try { await audioReady; s = await window.ClipAudio.Session.open(specs, reader); }
  catch (e) { console.warn('audio engine unavailable:', e); }
  if (sessionKey !== key) { if (s) s.close(); return; } // tab switched or tracks changed meanwhile
  sessionLoading = false;
  if (!s || !s.tracks.size) { if (s) s.close(); applyAudio(); return; } // fall back to the video's audio
  session = s;
  session.seek(v.currentTime || 0);
  applyAudio();
  if (!v.paused) session.play(v.currentTime);
}
// The engine follows play/pause/seek on the video. Audio only starts once the video is
// actually moving ('playing', or 'seeked' while playing), so a slow video seek or start
// doesn't leave the picture behind the sound.
const ownSeek = () => selfSeekTo !== null && Math.abs(v.currentTime - selfSeekTo) < 0.02;
// The video picture trails its own clock by about a frame when it starts. Start the audio that
// much later, and refine the estimate from what's measured right after each start.
let videoLag = 0.055, lagProbe = null, noLagLearning = false;
try { const l = parseFloat(localStorage.getItem('videoLag')); if (l >= 0 && l <= 0.12) videoLag = l; } catch (e) { /* ignore */ }
function startAudio() {
  if (!session || v.paused) return;
  session.play(v.currentTime, videoLag);
  if (!noLagLearning) lagProbe = { t0: performance.now(), diffs: [] };
}
v.addEventListener('playing', startAudio);
v.addEventListener('pause', () => { if (session) session.pause(); v.playbackRate = 1; });
v.addEventListener('seeking', () => {
  if (ownSeek() || !session) return;
  session.pause();
  session.seek(v.currentTime);
});
v.addEventListener('seeked', () => {
  const own = ownSeek();
  selfSeekTo = null;
  if (!own && !v.paused) startAudio();
});
// ...and while playing, the video follows the audio clock: tiny speed nudges for small
// differences, a jump only if it's way off
let syncMode = 'hysteresis'; // self-test can switch this to compare strategies
function syncVideo() {
  if (!session || !session.playing || v.paused || drag || v.seeking) return;
  const target = session.audible;
  const diff = v.currentTime - target;
  if (syncLog) { syncLog.push(diff); if (v.playbackRate !== 1) syncLog.nudged++; }
  if (lagProbe) {
    const age = performance.now() - lagProbe.t0;
    if (age > 250 && v.playbackRate === 1) lagProbe.diffs.push(diff);
    if (age > 700) {
      if (lagProbe.diffs.length >= 5) {
        const m = lagProbe.diffs.reduce((a, b) => a + b, 0) / lagProbe.diffs.length;
        videoLag = clamp(videoLag - m * 0.7, 0, 0.12);
        if (!noLagLearning) { try { localStorage.setItem('videoLag', videoLag.toFixed(4)); } catch (e) { /* ignore */ } }
      }
      lagProbe = null;
    }
  }
  if (Math.abs(diff) > 0.3) { selfSeekTo = Math.max(0, target); v.currentTime = selfSeekTo; v.playbackRate = 1; if (syncLog) syncLog.jumps++; return; }
  if (syncMode === 'none') return;
  if (syncMode === 'continuous') {
    if (Math.abs(diff) > 0.012) v.playbackRate = clamp(1 - diff * 2, 0.92, 1.08);
    else if (v.playbackRate !== 1) v.playbackRate = 1;
    return;
  }
  // hysteresis: leave the video alone while it's close; when it drifts past 35 ms, run it 3%
  // fast/slow until it's back within 8 ms. Few rate changes = smooth playback.
  if (v.playbackRate === 1) { if (Math.abs(diff) > 0.035) v.playbackRate = diff > 0 ? 0.97 : 1.03; }
  else if (Math.abs(diff) < 0.008 || (diff > 0) !== (v.playbackRate < 1)) v.playbackRate = 1;
}
setInterval(syncVideo, 50); // keeps going when the window is in the background

// result of add/remove audio for tab `t` (which may no longer be the one showing)
function applyExtras(t, r) {
  if (!r.ok) return msg(r.error, 'err', 15000);
  const set = t === active ? extraSet : t.extraSet;
  for (const x of r.extras) if (!set.has(x.path)) set.set(x.path, { include: true, volume: 1 });
  if (t === active) { extras = r.extras; buildTracks(); } else t.extras = r.extras;
}
async function addAudio(p) {
  if (!active) return;
  const t = active;
  applyExtras(t, await T.addAudio(t.id, p || null));
}

$('vol').addEventListener('input', applyAudio);
$('vol').addEventListener('dblclick', () => { $('vol').value = 100; applyAudio(); });
const toggleMute = () => { masterMute = !masterMute; applyAudio(); };
$('mute').onclick = toggleMute;
$('addaudio').onclick = () => addAudio(null);

// ---------- tabs ----------
function newTab(i) {
  return {
    id: i.id, info: i, init: false, tin: 0, tout: 0, dur: 0, time: 0,
    extras: [], mainTracks: (i.audio || []).map(() => ({ include: true, volume: 1 })), extraSet: new Map(),
    masterMute: false, vol: 100, mix: true, peaks: null, thumbs: null, visuals: false,
  };
}
function saveActive() {
  if (!active) return;
  Object.assign(active, {
    tin, tout, time: v.currentTime || 0, extras, mainTracks, extraSet, masterMute, peaks,
    vol: Number($('vol').value), mix: $('mix').checked,
  });
}
function loadTab(t) {
  info = t.info; fps = t.info.fps || 30;
  dur = t.init ? t.dur : 0; tin = t.tin; tout = t.tout;
  extras = t.extras; mainTracks = t.mainTracks; extraSet = t.extraSet;
  masterMute = t.masterMute; peaks = t.peaks;
  $('vol').value = t.vol; $('mix').checked = t.mix;
}

function renderTabs() {
  const bar = $('tabs');
  bar.replaceChildren();
  if (!tabs.length) return;
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t === active && !libMode ? ' active' : '');
    el.setAttribute('role', 'tab');
    el.title = t.info.path || t.info.name;
    const name = document.createElement('span'); name.className = 'tname'; name.textContent = t.info.name;
    const x = document.createElement('button'); x.className = 'tclose'; x.title = 'Close (Ctrl+W)'; x.append(icoSpan('x'));
    x.onclick = e => { e.stopPropagation(); closeTab(t); };
    el.append(name, x);
    el.onclick = () => { if (libMode) setLib(false); switchTo(t); };
    el.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); closeTab(t); } });
    bar.append(el);
    if (t === active) requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
}

function showActive() {
  const i = info;
  $('empty').style.display = 'none';
  document.title = i.name + ' - ' + T.appName;
  $('infoname').textContent = i.name;
  const nA = (i.audio || []).length;
  const res = i.width && i.height ? `${i.width}x${i.height}` : '';
  $('infometa').textContent =
    [res, `${i.fps} fps`, i.codec].filter(Boolean).join('  ·  ') + '\n' +
    [fmt(i.duration), fmtSize(i.size), nA === 1 ? '1 audio track' : `${nA} audio tracks`].join('  ·  ');
  msg('');
  $('timeline').classList.toggle('nolip', !active.init);
  buildRuler();
  buildTracks();
  drawWave();
  paintStrip(active);
  setBusy(false);
  v.src = i.url;
  loadVisuals(active);
}

function switchTo(t) {
  if (!t || t === active || exporting) return;
  saveActive();
  v.pause();
  closeSession();
  active = t;
  loadTab(t);
  renderTabs();
  showActive();
  if (typeof navCommit === 'function') navCommit();
}

function openInfo(i) {
  if (exporting) return;
  let t = tabs.find(x => x.id === i.id);
  if (!t) { t = newTab(i); tabs.push(t); }
  if (t !== active) switchTo(t);
  if (libMode) setPage('edit'); else renderTabs();
}

function closeTab(t) {
  if (!t || exporting) return;
  const idx = tabs.indexOf(t);
  if (idx < 0) return;
  if (t === active) closeSession(); // stop reading the file before main closes it
  T.closeClip(t.id);
  tabs.splice(idx, 1);
  if (t === active) {
    active = null;
    const next = tabs[idx] || tabs[idx - 1];
    if (next) switchTo(next); else { clearEditor(); setLib(true); }
  }
  renderTabs();
}

function clearEditor() {
  v.pause();
  closeSession();
  v.removeAttribute('src');
  v.load();
  info = null; dur = 0; tin = tout = 0; peaks = null; masterMute = false;
  extras = []; mainTracks = []; extraSet = new Map();
  $('vol').value = 100; $('mix').checked = true;
  $('empty').style.display = '';
  $('infoname').textContent = 'No clip loaded';
  $('infometa').textContent = '';
  document.title = T.appName;
  $('timeline').classList.add('nolip');
  paintStrip(null);
  buildRuler();
  drawWave();
  buildTracks();
  msg('');
  setBusy(false);
}

v.addEventListener('loadedmetadata', () => {
  if (!active) return;
  const d = isFinite(v.duration) && v.duration > 0 ? v.duration : info.duration;
  dur = d;
  if (!active.init) { tin = 0; tout = d; active.init = true; }
  active.dur = d;
  $('timeline').classList.remove('nolip');
  buildRuler();
  setBusy(false);
  v.currentTime = clamp(active.time || 0, 0, d);
});
v.addEventListener('error', () => {
  if (!active || !v.getAttribute('src')) return;
  // no preview, but the times can still be typed in and ffmpeg can still cut it
  dur = info.duration;
  if (!active.init) { tin = 0; tout = dur; active.init = true; }
  active.dur = dur;
  $('timeline').classList.toggle('nolip', !dur);
  buildRuler();
  setBusy(false);
  msg("This codec can't be previewed here. You can still type start and end times and export.", 'err');
});

async function handle(r) {
  if (!r.ok) { msg(r.error, 'err', 15000); return; }
  if (r.info) openInfo(r.info);
}
const pick = async () => { if (!exporting) handle(await T.pick()); };
$('pick').onclick = pick;
T.onOpen(openInfo);

// ---------- playback & trim controls ----------
// Play from `from` (or the playhead); if that's outside the selection, start at the selection start.
function playSelection(from) {
  if (!dur) return;
  let t = from ?? v.currentTime;
  if (t < tin - 0.01 || t >= tout - 0.02) t = tin;
  v.currentTime = t;
  v.play().catch(() => {});
}
function toggle() { if (!dur) return; v.paused ? playSelection() : v.pause(); }
v.addEventListener('ended', () => { if (loop && dur) playSelection(tin); });
$('play').onclick = toggle;
$('back').onclick = () => { if (dur) v.currentTime = Math.max(0, v.currentTime - 5); };
$('fwd').onclick = () => { if (dur) v.currentTime = Math.min(dur, v.currentTime + 5); };
const showLoop = () => $('loop').classList.toggle('on', loop);
$('loop').onclick = () => { loop = !loop; showLoop(); try { localStorage.setItem('loop', loop ? 'on' : 'off'); } catch (e) { /* ignore */ } };
showLoop();
$('setin').onclick = () => setIn(v.currentTime, false);
$('setout').onclick = () => setOut(v.currentTime, false);
v.addEventListener('click', toggle);
for (const [id, fn, get] of [['tin', setIn, () => tin], ['tout', setOut, () => tout]]) {
  const el = $(id);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const t = parse(el.value); if (!isNaN(t)) fn(t); el.blur(); }
    if (e.key === 'Escape') el.blur();
  });
  el.addEventListener('blur', () => { const t = parse(el.value); if (dur && !isNaN(t) && Math.abs(t - get()) > 0.001) fn(t); });
}

// timeline dragging: grips move start/end, anywhere else seeks
const xToT = e => { const r = lane.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width * dur, 0, dur); };
function dragTo(e) {
  const t = xToT(e);
  if (drag === 'in') setIn(t); else if (drag === 'out') setOut(t); else v.currentTime = clamp(t, tin, tout);
}
lane.addEventListener('pointerdown', e => {
  if (!dur || e.button !== 0) return;
  lane.setPointerCapture(e.pointerId);
  // hold playback while dragging; pick it back up on release
  wasPlaying = !v.paused;
  v.pause();
  drag = e.target.id === 'gin' ? 'in' : e.target.id === 'gout' ? 'out' : 'seek';
  dragTo(e);
});
lane.addEventListener('pointermove', e => { if (drag) dragTo(e); });
function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (wasPlaying) {
    if (d === 'in') playSelection(tin);
    else if (d === 'out') playSelection(Math.max(tin, tout - 2)); // replay the last 2s so you hear the new end
    else playSelection(v.currentTime);
  }
  wasPlaying = false;
}
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) lane.addEventListener(ev, endDrag);

// keyboard
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 'o') { e.preventDefault(); pick(); return; }
  if (e.altKey && !ctrl && (k === 'arrowleft' || k === 'arrowright')) { e.preventDefault(); navInput(k === 'arrowleft' ? -1 : 1, true); return; }
  if (libMode) {
    if (libKey(e)) return;
    if (ctrl && k === 'v' && e.target.tagName !== 'INPUT') {
      pasteSeen = false;
      setTimeout(() => { if (!pasteSeen && !exporting) T.clipboardFile().then(handle); }, 250);
    }
    return;
  }
  if (ctrl && k === 'w') { e.preventDefault(); closeTab(active); return; }
  if (ctrl && k === 'tab') {
    e.preventDefault();
    if (tabs.length > 1 && active) {
      const i = tabs.indexOf(active);
      switchTo(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]);
    }
    return;
  }
  if (e.target.tagName === 'INPUT' && (e.target.type === 'text' || e.target.type === 'range')) return;
  if (ctrl && k === 'v') {
    // let the normal paste event run (it carries copied files); fall back to reading the clipboard ourselves
    pasteSeen = false;
    setTimeout(() => { if (!pasteSeen && !exporting) T.clipboardFile().then(handle); }, 250);
    return;
  }
  if (ctrl && k === 'c') {
    if (String(window.getSelection())) return; // copying selected text
    e.preventDefault();
    doExport('clip');
    return;
  }
  if (ctrl || e.altKey || !dur) return;
  const step = e.shiftKey ? 1 : 1 / fps;
  if (k === ' ') toggle();
  else if (k === 'i') setIn(v.currentTime, false);
  else if (k === 'o') setOut(v.currentTime, false);
  else if (k === 'arrowleft') { v.pause(); v.currentTime = Math.max(0, v.currentTime - step); }
  else if (k === 'arrowright') { v.pause(); v.currentTime = Math.min(dur, v.currentTime + step); }
  else if (k === 'j') v.currentTime = Math.max(0, v.currentTime - 5);
  else if (k === 'l') v.currentTime = Math.min(dur, v.currentTime + 5);
  else if (k === 'k') v.pause();
  else if (k === 'm') toggleMute();
  else if (k === 'home') v.currentTime = tin;
  else if (k === 'end') v.currentTime = tout;
  else return;
  e.preventDefault();
});

// drag and drop / paste: videos open (in a new tab), audio files are added as a track
const AUDIO_RE = /\.(wav|mp3|m4a|aac|flac|ogg|opus|wma)$/i;
async function openPath(p) {
  if (active && !libMode && AUDIO_RE.test(p)) addAudio(p);
  else handle(await T.open(p));
}
let pasteSeen = false;
document.addEventListener('paste', async e => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  pasteSeen = true;
  e.preventDefault();
  if (exporting) return;
  const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
  const p = files.map(f => { try { return T.pathFor(f); } catch (err) { return ''; } }).find(Boolean);
  if (p) openPath(p);
  else handle(await T.clipboardFile());
});
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
window.addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
  if (exporting) return;
  // several videos dropped at once each get a tab
  for (const f of Array.from(e.dataTransfer.files)) await openPath(T.pathFor(f));
});

// ---------- export ----------
const MODE_NOTES = {
  precise: 'Re-encodes the video so the cut lands exactly where you set it.',
  fast: "No re-encode, nearly instant. The start snaps to the nearest keyframe, so it can begin a second or two early.",
};
const modeVal = () => document.querySelector('input[name=mode]:checked').value;
const showMode = () => { $('modenote').textContent = MODE_NOTES[modeVal()]; };
try { const m = localStorage.getItem('mode'); if (m && MODE_NOTES[m]) document.querySelector(`input[name=mode][value=${m}]`).checked = true; } catch (e) { /* ignore */ }
for (const r of document.querySelectorAll('input[name=mode]')) {
  r.addEventListener('change', () => { showMode(); try { localStorage.setItem('mode', r.value); } catch (e) { /* ignore */ } });
}
showMode();

function setBusy(b) {
  $('export').disabled = $('saveas').disabled = $('copy').disabled = b || !dur;
  $('cancel').hidden = !b;
  $('pick').disabled = b;
  $('libtab').disabled = $('setbtn').disabled = b;
  $('addaudio').disabled = b || !info;
  $('tabs').classList.toggle('busy', b);
  $('bar').hidden = !b;
  if (b) $('bar').value = 0;
}
T.onProgress(p => { $('bar').value = p; });
$('cancel').onclick = () => T.cancel();

// kind: 'export' (next to the original), 'saveas' (pick a place), 'clip' (to the clipboard)
async function doExport(kind) {
  if (!dur || exporting || !active) return;
  exporting = true;
  setBusy(true);
  const mode = modeVal();
  msg(kind === 'clip' ? 'Making the clip...' : mode === 'fast' ? 'Exporting...' : 'Exporting (re-encoding)...');
  const r = await T.export({
    clipId: active.id, start: tin, end: tout, mode, saveAs: kind === 'saveas', toClipboard: kind === 'clip',
    volume: masterVol(), mute: masterMute, mix: $('mix').checked,
    tracks: exportTracks(),
  });
  exporting = false;
  setBusy(false);
  if (!r.ok) return msg(r.error, 'err', 15000);
  if (r.cancelled) return msg(r.quiet ? '' : 'Export cancelled.', '', 4000);
  const s = $('status'); s.className = 'ok';
  autoHide(8000);
  if (r.copied) {
    s.textContent = `Copied (${fmtSize(r.size)}). Paste it into Discord with Ctrl+V.`;
    if (r.size > 10 * 1048576) {
      const w = document.createElement('div'); w.className = 'warn';
      w.textContent = "It's over 10 MB, so Discord will need Nitro to send it.";
      s.append(w);
    }
    return;
  }
  s.textContent = `Saved ${r.out} (${fmtSize(r.size)}, ${r.seconds}s)`;
  const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = 'Show in folder';
  b.onclick = () => T.reveal(r.out);
  s.append(b);
}
$('export').onclick = () => doExport('export');
$('saveas').onclick = () => doExport('saveas');
$('copy').onclick = () => doExport('clip');

// ---------- start ----------
$('timeline').classList.add('nolip');
setBusy(false);
applyListen();
renderTabs();
(async () => {
  const r = await T.initial();
  // library.js loads after this file; wait for it
  if (document.readyState === 'loading') await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  if (r.ok) for (const i of r.infos || []) openInfo(i);
  if (!tabs.length) setLib(true);
  requestAnimationFrame(render);
  selftest();
})();

// ---------- self test (dev only) ----------
// CLIP_TRIMMER_SELFTEST=<clip> makes the app open that clip, play it silently, and report how
// closely the video follows the audio engine, then quit.
async function selftest() {
  const cfg = await T.selftestConfig();
  if (!cfg) return;
  const [file, mode] = cfg.split('|');
  if (mode === 'nolag') { syncMode = 'hysteresis'; noLagLearning = true; videoLag = 0; }
  else if (mode) syncMode = mode;
  const wait = async (cond, ms = 15000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 50)); } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const stats = arr => {
    const a = arr.map(Math.abs).sort((x, y) => x - y);
    const q = f => a.length ? +(a[Math.min(a.length - 1, Math.floor(a.length * f))] * 1000).toFixed(1) : null;
    return { samples: a.length, meanMs: a.length ? +(arr.reduce((x, y) => x + y, 0) / arr.length * 1000).toFixed(1) : null, p50AbsMs: q(0.5), p95AbsMs: q(0.95), maxAbsMs: q(1) };
  };
  const out = {};
  try {
    handle(await T.open(file));
    await wait(() => dur > 0 && session);
    masterMute = true; applyAudio(); // silent
    out.tracks = [...session.tracks.keys()];
    out.latencyMs = +(session.latency * 1000).toFixed(1);
    v.currentTime = Math.min(20, dur / 4);
    await sleep(300);
    syncLog = Object.assign([], { jumps: 0, nudged: 0 });
    const trace = [];
    const snap = tag => trace.push([tag, Math.round(performance.now()), session ? session.ctx.state : 'none', session ? session.playing : null, session ? +session.audible.toFixed(3) : null, +v.currentTime.toFixed(3), v.paused, session ? session.nodes.size : null]);
    for (const ev of ['play', 'playing', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'ratechange']) v.addEventListener(ev, () => snap(ev));
    out.trace = trace;
    v.play();
    for (let i = 0; i < 6; i++) { await sleep(100); snap('t'); }
    await sleep(600); syncLog.length = 0; syncLog.jumps = 0; syncLog.nudged = 0; // let it settle, then measure
    await sleep(8000);
    out.mode = syncMode;
    out.steady = { ...stats(syncLog), jumps: syncLog.jumps, nudgedPct: Math.round(100 * syncLog.nudged / Math.max(1, syncLog.length)), seriesMs: syncLog.filter((_, i) => i % 40 === 0).map(x => Math.round(x * 1000)) };
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    if (q) out.frames = { total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
    // a seek while playing (like dragging the playhead or the selection looping)
    syncLog = Object.assign([], { jumps: 0, nudged: 0 });
    v.currentTime = Math.min(dur - 6, dur / 2);
    await sleep(4000);
    out.afterSeek = { ...stats(syncLog), jumps: syncLog.jumps };
    out.videoLagMs = Math.round(videoLag * 1000);
    // pause and play again (uses the learned lag)
    v.pause(); await sleep(300);
    syncLog = Object.assign([], { jumps: 0, nudged: 0 });
    v.play(); await sleep(3000);
    out.replay = { ...stats(syncLog), jumps: syncLog.jumps, nudgedPct: Math.round(100 * syncLog.nudged / Math.max(1, syncLog.length)) };
    // confirm the engine is producing real sound (master is muted, so tap the track gains)
    {
      const an = session.ctx.createAnalyser(); an.fftSize = 4096;
      for (const t of session.tracks.values()) t.gain.connect(an);
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      for (let i = 0; i < 6; i++) { await sleep(50); an.getFloatTimeDomainData(buf); for (const x of buf) peak = Math.max(peak, Math.abs(x)); }
      out.signalPeak = +peak.toFixed(3);
      for (const t of session.tracks.values()) t.gain.disconnect(an);
    }
    // mute a track and check its gain drops
    const k = [...session.tracks.keys()].find(x => x.startsWith('s'));
    if (k) {
      const idx = +k.slice(1);
      if (info.discord) { mainTracks[idx].include = false; applyAudio(); }
      else { mainTracks[idx].include = false; applyAudio(); }
      await sleep(150);
      out.mutedTrack = { key: k, gain: +session.tracks.get(k).gain.gain.value.toFixed(3), fullGain: session.has('full') ? +session.tracks.get('full').gain.gain.value.toFixed(3) : null };
    }
    v.pause();
    out.ok = true;
  } catch (e) { out.error = String(e && e.stack || e); }
  T.selftestDone(out);
}
