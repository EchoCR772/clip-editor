// The clip editor: a Discord-style overlay over the library for trimming one clip, with a tab in
// the title bar for each open clip. Trims, audio settings and names are saved per clip (the file is
// never changed unless you choose Replace original); Copy/Export make a new file from them.
// The picture comes from the GPU player (gpuplayer.mjs), the sound from the audio engine
// (engine.mjs), which also drives the clock the picture follows.
// Uses the page's shared helpers from app.js / library.js ($, h, T, icoSpan, setIco, fmt, ...).
import { GpuPlayer, ElementPlayer } from './gpuplayer.mjs';

const Q = {
  tabs: [], tab: null,      // open clips; the one shown in the editor (null: the library is showing)
  loaded: null,             // the tab whose clip is loaded into the player
  visible: false,
  clip: null, info: null, player: null, session: null,
  dur: 0, fps: 30, tin: 0, tout: 0, t: 0, playing: false, base: { t: 0, p: 0 },
  groups: [], drag: null, wasPlaying: false, exporting: false, saveTimer: null, peaks: null, gen: 0,
  loop: true,
};
try { Q.loop = localStorage.getItem('qtLoop') !== 'off'; } catch (e) { /* ignore */ }
const qclamp = (x, a, b) => Math.min(b, Math.max(a, x));
const qpct = t => (Q.dur ? t / Q.dur * 100 : 0);
let tabSeq = 0;

// ---------- audio rows ----------
// The rows come from main (one per person in Discord clips); each keeps its mute and volume.
function savedFor(g, audio) {
  const s = (audio || {})[g.key] || (g.key.startsWith('v:') ? (audio || {}).voice : null);
  return { mute: !!(s && s.mute), vol: s ? qclamp(+s.vol || 0, 0, 2) : 1 };
}
const groupsFrom = (info, audio) => (info.groups || []).map(g => ({ ...g, ...savedFor(g, audio), open: false }));
function audioState() {
  const audio = {};
  for (const g of Q.groups) if (g.mute || Math.abs(g.vol - 1) > 0.001) audio[g.key] = { mute: g.mute, vol: Math.round(g.vol * 100) / 100 };
  return audio;
}

// ---------- the open clip ----------
// One clip at a time (Q.tab holds it and its state).
function findTab(path) { return Q.tabs.find(t => samePathR(t.clip.path, path)); }
async function openQuickTrim(c, el) {
  let tab = findTab(c.path);
  if (!tab) {
    for (const t of Q.tabs.slice()) await closeTab(t, true);
    tab = { id: ++tabSeq, clip: c, st: null, peaks: null, strip: null };
    Q.tabs.push(tab);
  } else tab.clip = c;
  await activate(tab, el);
}
window.openQuickTrim = openQuickTrim;

async function activate(tab, el) {
  hideMenu(); stopPreview(); closeSettings();
  Q.tab = tab;
  showEditor(true);
  renderTabs();
  startFrames();
  if (Q.loaded !== tab) {
    if (Q.loaded) unload();
    await load(tab, el);
  }
  navCommit();
}
// going to the library closes the editor
function qtHide() {
  if (Q.tab) closeTab(Q.tab);
}
window.qtHide = qtHide;
window.qtIsOpen = () => Q.visible;
window.qtActivePath = () => (Q.visible && Q.tab ? Q.tab.clip.path : null);
window.qtHasTab = p => !!findTab(p);
window.qtActivatePath = p => { const t = findTab(p); if (t) activate(t); return !!t; };
window.closeActiveTab = () => { if (Q.tab) closeTab(Q.tab); };
// what the app menu's Playback items do
window.qtApi = {
  toggle: () => toggle(), step: d => step(d), seek: d => seekTo(now() + d), loop: () => $('qtloop').click(),
  isLoop: () => Q.loop, hasPrev: () => !!neighbor(-1), hasNext: () => !!neighbor(1),
  copy: () => exportAs('video', 'clipboard'), rename: () => editTitle(),
};

function showEditor(on) {
  Q.visible = on;
  const box = $('qt');
  if (on) {
    box.hidden = false;
    requestAnimationFrame(() => box.classList.add('on'));
    $('library').classList.add('away');
    window.addEventListener('keydown', onKey, true);
  } else {
    box.classList.remove('on');
    setTimeout(() => { if (!Q.visible) box.hidden = true; }, 160);
    $('library').classList.remove('away');
    window.removeEventListener('keydown', onKey, true);
    $('qthelpbox') && $('qthelpbox').remove();
    if (L.dirty) loadLibrary();
  }
  $('libtab').classList.toggle('active', !on);
}

async function closeTab(tab, quiet) {
  if (Q.exporting && tab === Q.loaded) { T.cancel(); return; }
  const i = Q.tabs.indexOf(tab);
  if (i < 0) return;
  if (tab === Q.loaded) unload();
  Q.tabs.splice(i, 1);
  if (tab === Q.tab) { Q.tab = null; if (!quiet) { showEditor(false); navCommit(); } }
}
// clips about to be deleted: close their tabs first so the files aren't in use
window.qtCloseTabsFor = async (paths, dirs) => {
  const under = p => paths.some(x => samePathR(x, p)) || dirs.some(d => String(p).toLowerCase().startsWith(String(d).toLowerCase().replace(/[\\/]+$/, '') + (d.includes('\\') ? '\\' : '/')));
  for (const t of Q.tabs.slice()) if (under(t.clip.path)) await closeTab(t);
};

function renderTabs() { /* no tabs: one clip at a time */ }

// ---------- loading a clip into the editor ----------
async function load(tab, el) {
  const c = tab.clip;
  const gen = ++Q.gen;
  Q.loaded = tab;
  Q.clip = c; Q.exporting = false; Q.playing = false; Q.peaks = tab.peaks; Q.info = null;
  el && el.classList.add('opening');
  showHead();
  $('qtmeta').textContent = '';
  const th = L.thumbs.get(c.path);
  $('qtthumb').replaceChildren();
  if (th && th.url) { const i = new Image(); i.src = th.url; i.alt = ''; $('qtthumb').append(i); }
  status('');
  $('qtmsg').textContent = '';
  $('qtaudio').replaceChildren();
  clearCanvas($('qtstrip'));
  updateNav();

  const r = await T.qtOpen(c.path);
  el && el.classList.remove('opening');
  if (gen !== Q.gen) return;
  if (!r.ok) { status(r.error, 'err'); return; }
  const info = Q.info = r.info;
  if (r.title !== undefined && r.title !== c.title) { c.title = r.title; showHead(); renderTabs(); }
  Q.dur = info.duration || c.duration || 0;
  Q.fps = info.fps || 30;
  const e = r.edit || c.edit || null;
  const st = tab.st;
  Q.tin = qclamp(st ? st.tin : e && e.in != null ? +e.in : 0, 0, Q.dur);
  Q.tout = qclamp(st ? st.tout : e && e.out != null ? +e.out : Q.dur, Q.tin + 0.05, Q.dur);
  if (Q.tout - Q.tin < 0.05) { Q.tin = 0; Q.tout = Q.dur; }
  Q.t = qclamp(st ? st.t : Q.tin, Q.tin, Q.tout);
  Q.groups = groupsFrom(info, st ? st.audio : e && e.audio);
  $('qtmeta').textContent = [fmtSize(info.size), info.width && `${info.width}x${info.height}`, info.fps && `${Math.round(info.fps)} fps`, fmtLen(Q.dur)].filter(Boolean).join('  ·  ');
  $('qttot').textContent = fmt(Q.dur);
  buildAudioRows();
  layoutLane();

  // picture
  const canvas = freshCanvas();
  try {
    Q.player = await GpuPlayer.open(c.path, canvas);
  } catch (err) {
    canvas.hidden = true;
    const v = $('qtvideo'); v.hidden = false;
    try { Q.player = await ElementPlayer.open(c.url, v); } catch (err2) { $('qtmsg').textContent = "This video can't be previewed."; }
  }
  if (gen !== Q.gen) { if (Q.player) Q.player.close(); return; }
  if (Q.player) { Q.player.show(Q.t); $('qtstage').dataset.renderer = Q.player.renderer; fitPicture(); }
  // sound
  try {
    await audioReady;
    const specs = Q.groups.flatMap(g => g.idx.map(i => ({ key: 't' + i, path: c.path, index: i })));
    if (specs.length) Q.session = await window.ClipAudio.Session.open(specs, reader);
  } catch (err) { Q.session = null; status("The sound can't be previewed for this clip (the export still has it).", 'err', 8000); }
  if (gen !== Q.gen) { closeMedia(); return; }
  applyGains();
  if (Q.session) Q.session.seek(Q.t);
  // timeline pictures and waveform, in the background (kept with the tab)
  if (Q.peaks) drawWave(); else loadWave(gen, tab);
  if (tab.strip && tab.stripW === $('qtstrip').clientWidth) drawSavedStrip(tab); else loadStrip(gen, tab);
  schedulePrepare(400);
  startFrames();
}
// put the current clip away (switching tabs, closing): its state stays with the tab
function unload() {
  const tab = Q.loaded;
  Q.gen++;
  pause();
  flushSave();
  if (tab && Q.info) tab.st = { tin: Q.tin, tout: Q.tout, t: Q.t, audio: audioState() };
  if (tab) tab.peaks = Q.peaks;
  closeMedia();
  if (Q.clip) T.qtClose(Q.clip.path);
  Q.loaded = null; Q.clip = null; Q.info = null;
}

function showHead() {
  const c = Q.clip;
  $('qttitletext').textContent = clipTitle(c);
  $('qttitle').classList.toggle('named', !!c.title);
  $('qtsub').replaceChildren(...subParts(c));
  $('qtname').textContent = c.name;
  $('qtname').title = c.path;
  document.title = clipTitle(c) + ' - ' + (window.APP_TITLE || T.appName);
}
function subParts(c) {
  const f = L.data && c.root && L.data.folders.find(x => samePathR(x.path, c.root));
  const parts = [c.gameName];
  if (f) parts.push(srcLabel(f));
  parts.push(new Date(c.date).toLocaleString());
  const out = [];
  parts.filter(Boolean).forEach((p, i) => { if (i) out.push(h('span', 'dot', '·')); out.push(h('span', '', p)); });
  out.push(h('span', 'dot', '·'));
  const file = h('span', 'qt-file', c.name);
  file.title = c.path;
  out.push(file);
  return out;
}
window.qtTitleChanged = (p, title) => {
  const t = findTab(p);
  if (t) t.clip.title = title;
  if (Q.clip && samePathR(Q.clip.path, p)) { Q.clip.title = title; showHead(); }
  renderTabs();
};

// the picture is as big as fits in the stage at its own shape, so its outline sits on the video
function fitPicture() {
  const st = $('qtstage'), el = $('qtvideo').hidden ? $('qtcanvas') : $('qtvideo');
  const vw = (Q.player && Q.player.width) || el.videoWidth || el.width, vh = (Q.player && Q.player.height) || el.videoHeight || el.height;
  if (!vw || !vh || !st.clientWidth || !st.clientHeight) return;
  const k = Math.min(st.clientWidth / vw, st.clientHeight / vh);
  el.style.width = Math.floor(vw * k) + 'px';
  el.style.height = Math.floor(vh * k) + 'px';
}
new ResizeObserver(fitPicture).observe($('qtstage'));

function freshCanvas() {
  // a canvas can only ever have one kind of drawing context, so each clip gets a new one
  const old = $('qtcanvas'), c = document.createElement('canvas');
  c.id = 'qtcanvas';
  old.replaceWith(c);
  $('qtvideo').hidden = true;
  return c;
}
function clearCanvas(c) { const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); }

function closeMedia() {
  if (Q.player) { Q.player.close(); Q.player = null; }
  if (Q.session) { Q.session.close(); Q.session = null; }
}

$('qtclose').onclick = () => { if (Q.tab) closeTab(Q.tab); };
// clicking outside the editor closes it (right-clicks do nothing)
$('qt').addEventListener('pointerdown', e => { if (e.target === $('qt') && e.button === 0 && Q.tab) closeTab(Q.tab); });

// ---------- previous / next clip (in the library's current list) ----------
function neighbor(d) {
  if (!Q.clip || !L.list.length) return null;
  const i = L.list.findIndex(c => samePathR(c.path, Q.clip.path));
  return i < 0 ? null : L.list[i + d] || null;
}
function updateNav() { $('qtprev').disabled = !neighbor(-1); $('qtnext').disabled = !neighbor(1); }
async function step(d) {
  const c = neighbor(d);
  if (!c || Q.exporting) return;
  const open = findTab(c.path);
  if (open) { activate(open); return; }
  // the same tab moves on to the next clip
  const tab = Q.tab;
  unload();
  tab.clip = c; tab.st = null; tab.peaks = null; tab.strip = null;
  if (L.opened && !L.opened.has(c.path)) { L.opened.add(c.path); updateCardEdit(c); }
  renderTabs();
  await load(tab);
  navCommit();
}
$('qtprev').onclick = () => step(-1);
$('qtnext').onclick = () => step(1);

// ---------- renaming (click the title) ----------
function editTitle() {
  if (!Q.clip) return;
  const inp = $('qttitlein');
  inp.value = Q.clip.title || '';
  inp.placeholder = `Clip from ${fmtWhen(Q.clip.date)}`;
  $('qttitle').hidden = true;
  inp.hidden = false;
  inp.focus(); inp.select();
}
function endTitle(save) {
  const inp = $('qttitlein');
  if (inp.hidden) return;
  inp.hidden = true;
  $('qttitle').hidden = false;
  if (save && Q.clip && inp.value.trim() !== (Q.clip.title || '')) setClipTitle(Q.clip, inp.value);
}
$('qttitle').onclick = editTitle;
$('qttitlein').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); endTitle(true); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTitle(false); }
});
$('qttitlein').addEventListener('blur', () => endTitle(true));

// ---------- playback ----------
const clock = () => (Q.starting ? Q.base.t : Q.session && Q.session.playing ? Q.session.audible : Q.base.t + (performance.now() - Q.base.p) / 1000);
async function play(from = Q.t) {
  if (!Q.player || !Q.dur) return;
  if (from < Q.tin - 0.01 || from >= Q.tout - 0.03) from = Q.tin;
  Q.playing = true;
  Q.starting = true; // until the sound is scheduled, the clock holds at `from`
  setIco($('qtplay').firstElementChild, 'pause');
  Q.base = { t: from, p: performance.now() };
  Q.player.play(clock, from);
  if (Q.session) await Q.session.play(from);
  Q.base = { t: from, p: performance.now() };
  Q.starting = false;
}
function pause() {
  if (!Q.playing) return;
  Q.t = qclamp(clock(), Q.tin, Q.tout);
  Q.playing = false;
  Q.starting = false;
  setIco($('qtplay').firstElementChild, 'play');
  if (Q.session) Q.session.pause();
  if (Q.player) Q.player.stop();
}
const toggle = () => (Q.playing ? pause() : play());
$('qtplay').onclick = toggle;
function seekTo(t) {
  Q.t = qclamp(t, Q.tin, Q.tout);
  if (Q.playing) { play(Q.t); return; }
  if (Q.player) Q.player.show(Q.t);
  if (Q.session) Q.session.seek(Q.t);
}
const now = () => (Q.playing ? clock() : Q.t);
$('qttostart').onclick = () => seekTo(Q.tin);
$('qttoend').onclick = () => { pause(); seekTo(Q.tout - 1 / Q.fps); };
$('qtback').onclick = () => seekTo(now() - 10);
$('qtfwd').onclick = () => seekTo(now() + 10);
function showLoop() { $('qtloop').classList.toggle('on', Q.loop); $('qtloop').dataset.tip = Q.loop ? 'Looping the trim (click to play through once)' : 'Loop the trim while playing'; }
$('qtloop').onclick = () => { Q.loop = !Q.loop; showLoop(); try { localStorage.setItem('qtLoop', Q.loop ? 'on' : 'off'); } catch (e) { /* ignore */ } };
showLoop();
// click the picture to play / pause, with a quick icon like most players
$('qtstage').addEventListener('click', () => {
  if (!Q.player || Q.exporting) return;
  toggle();
  const f = $('qtflash');
  f.replaceChildren(icoSpan(Q.playing ? 'play' : 'pause'));
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
});

// one drawing loop, running while the editor is showing
function startFrames() { if (!Q.frameOn) { Q.frameOn = true; requestAnimationFrame(frame); } }
function frame() {
  if (!Q.visible && !Q.playing) { Q.frameOn = false; return; }
  if (Q.playing && !Q.starting) {
    const t = clock();
    if (t >= Q.tout - 0.005) { if (Q.loop) play(Q.tin); else { pause(); Q.t = Q.tout; } }
    else Q.t = Math.max(Q.tin, t);
  }
  $('qtph').style.left = qpct(Q.t) + '%';
  $('qtsel').style.left = `calc(${qpct(Q.tin)}% - 4px)`;
  $('qtsel').style.width = `calc(${qpct(Q.tout) - qpct(Q.tin)}% + 8px)`;
  $('qtshadeL').style.width = qpct(Q.tin) + '%';
  $('qtshadeR').style.width = (100 - qpct(Q.tout)) + '%';
  $('qtcur').textContent = fmt(Q.t);
  $('qtlen').textContent = fmt(Q.tout - Q.tin);
  $('qtof').textContent = ` of ${fmt(Q.dur)}`;
  if (document.activeElement !== $('qtin')) $('qtin').value = fmt(Q.tin);
  if (document.activeElement !== $('qtout')) $('qtout').value = fmt(Q.tout);
  $('qtreset').disabled = !(Q.tin > 0.01 || Q.tout < Q.dur - 0.01);
  requestAnimationFrame(frame);
}

// ---------- timeline ----------
const lane = $('qtlane');
const xToT = e => { const r = lane.getBoundingClientRect(); return qclamp((e.clientX - r.left) / r.width * Q.dur, 0, Q.dur); };
function dragTo(e) {
  const t = xToT(e);
  if (Q.drag === 'in') { Q.tin = qclamp(t, 0, Q.tout - 0.1); Q.t = Q.tin; if (Q.player) Q.player.show(Q.tin); drawWave(); }
  else if (Q.drag === 'out') { Q.tout = qclamp(t, Q.tin + 0.1, Q.dur); Q.t = Q.tout; if (Q.player) Q.player.show(Q.tout); drawWave(); }
  else { Q.t = qclamp(t, Q.tin, Q.tout); if (Q.player) Q.player.show(Q.t); } // the playhead stays inside the selection
}
lane.addEventListener('pointerdown', e => {
  if (!Q.dur || e.button !== 0 || Q.exporting) return;
  lane.setPointerCapture(e.pointerId);
  Q.wasPlaying = Q.playing;
  pause();
  Q.drag = e.target.id === 'qtgin' ? 'in' : e.target.id === 'qtgout' ? 'out' : 'seek';
  dragTo(e);
});
lane.addEventListener('pointermove', e => { if (Q.drag) dragTo(e); });
function endDrag() {
  if (!Q.drag) return;
  const d = Q.drag;
  Q.drag = null;
  if (d === 'in' || d === 'out') { Q.t = d === 'in' ? Q.tin : Q.t; scheduleSave(); }
  if (Q.session && !Q.wasPlaying) Q.session.seek(Q.t);
  if (Q.wasPlaying) play(d === 'out' ? Math.max(Q.tin, Q.tout - 2) : d === 'in' ? Q.tin : Q.t);
  Q.wasPlaying = false;
}
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) lane.addEventListener(ev, endDrag);

function layoutLane() { buildQtRuler(); drawWave(); }
// when the editor changes size the ruler and waveform follow right away, the pictures (which take
// decoding) once it settles
let stripTimer = null;
new ResizeObserver(() => {
  if (!Q.loaded) return;
  buildQtRuler(); drawWave();
  clearTimeout(stripTimer);
  if (Q.player) stripTimer = setTimeout(() => loadStrip(Q.gen, Q.loaded), 250);
}).observe(lane);

function buildQtRuler() {
  const r = $('qtruler');
  r.replaceChildren();
  const w = lane.clientWidth;
  if (!Q.dur || !w) return;
  const pps = w / Q.dur;
  const steps = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const major = steps.find(s => s * pps >= 70) || 3600, minor = major / 5;
  const n = Math.floor(Q.dur / minor + 1e-6);
  for (let i = 0; i <= n; i++) {
    const t = i * minor, isMajor = i % 5 === 0;
    const d = h('div', 'tick' + (isMajor ? ' major' : ''));
    d.style.left = qpct(t) + '%';
    r.append(d);
    if (isMajor && qpct(t) < 96) {
      const l = h('div', 'tlabel', t < 60 ? (major < 1 ? t.toFixed(1) : Math.round(t)) + 's' : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`);
      l.style.left = qpct(t) + '%';
      r.append(l);
    }
  }
}

async function loadWave(gen, tab) {
  const w = lane.clientWidth;
  // the waveform shows the voices (Discord voices, NVIDIA's mic track); clips without one show their audio
  const voices = Q.groups.filter(g => g.icon === 'mic').flatMap(g => g.idx);
  const r = await T.qtWave(Q.clip.path, Q.dur, Math.round(w / 3), voices.length ? voices : null);
  if (gen !== Q.gen || !r.ok || !r.peaks) return;
  Q.peaks = tab.peaks = r.peaks;
  drawWave();
}
function drawWave() {
  const c = $('qtwave'), dpr = devicePixelRatio || 1;
  const w = c.clientWidth, hh = c.clientHeight;
  c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!Q.peaks || !w) return;
  const n = Q.peaks.length, bw = w / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n * Q.dur;
    const v = Math.max(0.04, Q.peaks[i]);
    const bh = v * (hh - 2);
    g.fillStyle = t >= Q.tin && t <= Q.tout ? '#b5b6bc' : '#4a4950';
    g.fillRect(Math.round(i * bw * dpr), Math.round((hh - bh) / 2 * dpr), Math.max(1, Math.round((bw - 1) * dpr)), Math.max(1, Math.round(bh * dpr)));
  }
}

async function loadStrip(gen, tab) {
  const c = $('qtstrip'), dpr = devicePixelRatio || 1;
  const w = c.clientWidth, hh = c.clientHeight;
  if (!w || !hh || !Q.player || !Q.dur) return;
  c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
  const g = c.getContext('2d');
  const ar = (Q.player.width || 16) / (Q.player.height || 9);
  const tw = hh * ar, n = Math.max(1, Math.ceil(w / tw));
  const times = Array.from({ length: n }, (_x, i) => Math.min(Q.dur - 0.05, (i + 0.5) * Q.dur / n));
  await Q.player.thumbnails(times, (i, s) => {
    if (gen !== Q.gen) return;
    s.draw(g, Math.round(i * tw * dpr), 0, Math.ceil(tw * dpr), c.height);
  });
  // kept with the tab, so switching back doesn't decode them again
  if (gen === Q.gen && tab) { try { tab.strip = await createImageBitmap(c); tab.stripW = w; } catch (e) { /* ignore */ } }
}
function drawSavedStrip(tab) {
  const c = $('qtstrip');
  c.width = tab.strip.width; c.height = tab.strip.height;
  c.getContext('2d').drawImage(tab.strip, 0, 0);
}

// ---------- trim ----------
function setIn(t) { Q.tin = qclamp(t, 0, Q.tout - 0.1); seekTo(Q.tin); drawWave(); scheduleSave(); }
function setOut(t) { Q.tout = qclamp(t, Q.tin + 0.1, Q.dur); if (Q.t > Q.tout) seekTo(Q.tout); drawWave(); scheduleSave(); }
$('qtreset').onclick = () => { Q.tin = 0; Q.tout = Q.dur; seekTo(0); drawWave(); scheduleSave(); };
// typing a start or end time
for (const [id, fn, get] of [['qtin', setIn, () => Q.tin], ['qtout', setOut, () => Q.tout]]) {
  const el = $(id);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const t = parse(el.value); if (!isNaN(t)) fn(t); el.blur(); }
    if (e.key === 'Escape') { e.stopPropagation(); el.value = fmt(get()); el.blur(); }
  });
  el.addEventListener('blur', () => { const t = parse(el.value); if (Q.dur && !isNaN(t) && Math.abs(t - get()) > 0.001) fn(t); });
}

function editState() {
  const audio = audioState();
  const trimmed = Q.tin > 0.01 || Q.tout < Q.dur - 0.01;
  if (!trimmed && !Object.keys(audio).length) return null;
  return { in: Math.round(Q.tin * 1000) / 1000, out: Math.round(Q.tout * 1000) / 1000, dur: Q.dur, audio };
}
function scheduleSave() { clearTimeout(Q.saveTimer); Q.saveTimer = setTimeout(flushSave, 250); schedulePrepare(); }
// make the trimmed clip in the background so Copy Video and dragging the card are instant
function schedulePrepare(ms = 900) {
  clearTimeout(Q.prepTimer);
  Q.prepTimer = setTimeout(() => {
    if (!Q.loaded || !Q.info || Q.drag || !editState()) return;
    T.qtPrepare({ path: Q.clip.path, start: Q.tin, end: Q.tout, audio: audioState() });
  }, ms);
}
function flushSave() {
  if (!Q.saveTimer || !Q.clip || !Q.info) return;
  clearTimeout(Q.saveTimer); Q.saveTimer = null;
  const e = editState();
  Q.clip.edit = e;
  T.qtEdit(Q.clip.path, e);
  updateCardEdit(Q.clip);
}

// ---------- audio rows ----------
function buildAudioRows() {
  const box = $('qtaudio');
  box.replaceChildren();
  if (!Q.groups.length) { box.append(h('div', 'qt-none', 'This clip has no sound.')); return; }
  for (const g of Q.groups) {
    const row = h('div', 'qt-arow' + (g.open ? ' open' : '') + (g.mute ? ' muted' : ''));
    const head = h('div', 'qt-ahead');
    const name = h('button', 'qt-aname');
    name.title = 'Volume';
    name.append(icoSpan(g.icon), h('span', 'qt-anametext', g.name), h('span', 'qt-avol', Math.abs(g.vol - 1) > 0.001 ? Math.round(g.vol * 100) + '%' : ''));
    name.onclick = () => { g.open = !g.open; buildAudioRows(); };
    head.append(name);
    // people in Discord clips can be named once; the name is used in every clip they're in
    if (g.user && !g.me) {
      const ren = h('button', 'ibtn sm qt-aren');
      ren.title = g.named ? 'Rename' : 'Name this person';
      ren.append(icoSpan('edit'));
      ren.onclick = () => nameRow(row, g);
      head.append(ren);
    }
    const mute = h('button', 'ibtn sm qt-amute');
    mute.title = g.mute ? 'Unmute' : 'Mute';
    mute.append(icoSpan(g.mute ? 'speakerOff' : 'speaker'));
    mute.onclick = () => { g.mute = !g.mute; applyGains(); buildAudioRows(); scheduleSave(); };
    head.append(mute);
    row.append(head);
    if (g.open) {
      const sl = h('div', 'qt-aslider');
      const r = h('input'); r.type = 'range'; r.min = 0; r.max = 200; r.step = 5; r.value = Math.round(g.vol * 100);
      const v = h('span', '', Math.round(g.vol * 100) + '%');
      r.oninput = () => { g.vol = r.value / 100; v.textContent = r.value + '%'; if (g.vol > 0) g.mute = false; applyGains(); row.querySelector('.qt-avol').textContent = Math.abs(g.vol - 1) > 0.001 ? r.value + '%' : ''; scheduleSave(); };
      r.ondblclick = () => { r.value = 100; r.oninput(); };
      sl.append(r, v);
      row.append(sl);
    }
    box.append(row);
  }
}
function nameRow(row, g) {
  const label = row.querySelector('.qt-aname');
  const inp = h('input', 'qt-ain');
  inp.type = 'text'; inp.maxLength = 40; inp.spellcheck = false;
  inp.value = g.named ? g.name : ''; inp.placeholder = g.name;
  label.replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = async save => {
    if (done) return;
    done = true;
    if (save && inp.value.trim() !== (g.named ? g.name : '')) {
      const r = await T.personName(g.user, inp.value);
      if (r.ok) {
        // everywhere this person shows up, in every open tab
        for (const x of Q.groups) if (x.user === g.user) { x.named = !!r.name; if (r.name) x.name = r.name; }
        if (!r.name && Q.info) { const fresh = (await T.qtOpen(Q.clip.path)); if (fresh.ok) { Q.info.groups = fresh.info.groups; for (const x of Q.groups) { const f = fresh.info.groups.find(y => y.key === x.key); if (f) { x.name = f.name; x.named = f.named; } } } }
      } else status(r.error, 'err', 6000);
    }
    buildAudioRows();
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
}
function applyGains() {
  if (!Q.session) return;
  for (const g of Q.groups) for (const i of g.idx) Q.session.setGain('t' + i, g.mute ? 0 : g.vol);
}

// listening volume (shared with the rest of the app; never changes the export)
function showListen() {
  $('qtlvol').value = Math.round(listenVol * 100);
  setIco($('qtlmute').firstElementChild, listenMute || !listenVol ? 'headphonesOff' : 'headphones');
  $('qtlmute').classList.toggle('off', listenMute);
}
$('qtlvol').addEventListener('input', () => { listenVol = Number($('qtlvol').value) / 100; listenMute = false; applyListen(); showListen(); });
$('qtlmute').onclick = () => { listenMute = !listenMute; applyListen(); showListen(); };
$('qtlisten').addEventListener('wheel', e => {
  e.preventDefault();
  listenVol = Math.min(1, Math.max(0, Math.round(listenVol * 100 - Math.sign(e.deltaY) * 5) / 100));
  listenMute = false; applyListen(); showListen();
}, { passive: false });
showListen();

// ---------- messages and the export confirmation ----------
// A small card at the left of the bottom row: what happened, the file, and what you can do next.
function status(text, cls, hideMs) {
  const s = $('qtstatus');
  s.className = 'qt-status' + (cls ? ' ' + cls : '');
  s.replaceChildren(...(Array.isArray(text) ? text : [text || '']));
  clearTimeout(status.t);
  if (hideMs) armHide(hideMs);
}
function armHide(ms) {
  const s = $('qtstatus');
  status.t = setTimeout(() => { if (s.matches(':hover')) armHide(1500); else { s.classList.add('fade'); status.t = setTimeout(() => status(''), 300); } }, ms);
}
function done({ title, detail, actions = [], warn, cls = 'ok', ms = 10000 }) {
  const card = h('div', 'qt-done');
  const ic = h('span', 'qt-doneicon'); ic.append(icoSpan(cls === 'err' ? 'x' : 'checkCircle'));
  const txt = h('div', 'qt-donetext');
  txt.append(h('b', '', title));
  if (detail) { const d = h('span', 'qt-donedetail', detail); d.title = detail; txt.append(d); }
  if (warn) txt.append(h('span', 'qt-donewarn', warn));
  card.append(ic, txt);
  for (const a of actions) { const b = h('button', 'btn sm', a.text); b.onclick = a.run; card.append(b); }
  status([card], cls, ms);
}
T.onQtProgress(p => {
  if (!Q.exporting) return;
  $('qtbar').value = p;
  const n = $('qtstatus').querySelector('.qt-pct');
  if (n) n.textContent = Math.round(p * 100) + '%';
});
const working = text => { const w = h('span', 'qt-working'); w.append(h('span', 'qt-spin'), h('span', '', text + ' '), h('span', 'qt-pct', '')); status([w]); };

// ---------- copy / export ----------
async function exportAs(as, dest) {
  if (!Q.loaded || !Q.info || Q.exporting) return;
  pause();
  flushSave();
  Q.exporting = true;
  $('qt').classList.add('busy');
  // Copy Video is usually ready already; only show progress if it takes a moment
  const slow = setTimeout(() => { $('qtbar').hidden = false; $('qtbar').value = 0; working(dest === 'clipboard' ? `Making the ${as === 'audio' ? 'audio' : 'clip'}...` : 'Exporting...'); }, dest === 'clipboard' ? 250 : 0);
  const r = await T.qtExport({ path: Q.clip.path, start: Q.tin, end: Q.tout, as, dest, audio: audioState() });
  clearTimeout(slow);
  Q.exporting = false;
  $('qt').classList.remove('busy');
  $('qtbar').hidden = true;
  if (!Q.loaded) return;
  if (!r.ok) { done({ title: "Couldn't " + (dest === 'clipboard' ? 'copy it' : 'export it'), detail: r.error, cls: 'err', ms: 15000 }); return; }
  if (r.cancelled) { status(''); return; }
  const file = r.out.split(/[\\/]/).pop();
  if (dest === 'clipboard') {
    done({ title: as === 'audio' ? 'Audio copied' : 'Copied', detail: `${file}  ·  ${fmtSize(r.size)}`,
      warn: r.size > 10 * 1048576 && as !== 'audio' ? "Over 10 MB: Discord needs Nitro to send it." : 'Paste into Discord with Ctrl+V.', ms: 9000 });
  } else {
    done({ title: 'Exported', detail: `${file}  ·  ${fmtSize(r.size)}`, actions: [{ text: 'Show in folder', run: () => T.reveal(r.out) }], ms: 12000 });
    if (L.data) L.dirty = true;
  }
}
$('qtcopy').onclick = () => exportAs('video', 'clipboard');
$('qtsave').onclick = () => exportAs('video', 'save');
$('qtreveal').onclick = () => { if (Q.clip) T.libAction('reveal', Q.clip.path); };

// replace the original with the trimmed clip (asks first)
async function replaceOriginal() {
  if (!Q.loaded || !Q.info || Q.exporting) return;
  const trimmed = Q.tin > 0.01 || Q.tout < Q.dur - 0.01;
  if (!trimmed) { done({ title: 'Nothing to replace', detail: 'Trim the clip first.', cls: 'err', ms: 5000 }); return; }
  pause();
  if (!(await confirmBox({
    title: 'Replace the original?',
    body: `The original video will be permanently deleted. The trimmed clip (${fmtLen(Q.tout - Q.tin)}) takes its place with the same file name, date and audio tracks.`,
    ok: 'Replace',
  }))) return;
  const tab = Q.loaded, c = Q.clip;
  flushSave();
  const start = Q.tin, end = Q.tout;
  // the file can't be in use while it's replaced
  Q.gen++;
  closeMedia();
  await T.qtClose(c.path);
  Q.exporting = true;
  $('qt').classList.add('busy');
  $('qtbar').hidden = false; $('qtbar').value = 0;
  working('Replacing the original...');
  const r = await T.qtReplace({ path: c.path, start, end });
  Q.exporting = false;
  $('qt').classList.remove('busy');
  $('qtbar').hidden = true;
  if (Q.loaded !== tab) return;
  if (r.ok && !r.cancelled) {
    c.size = r.size; c.duration = r.duration;
    c.edit = null;
    L.thumbs.delete(c.path);
    tab.st = null; tab.peaks = null; tab.strip = null;
    if (L.data) L.dirty = true;
    updateCardEdit(c);
  }
  Q.loaded = null;
  await load(tab);
  if (!r.ok) done({ title: "Couldn't replace it", detail: r.error, cls: 'err', ms: 15000 });
  else if (!r.cancelled) done({ title: 'Original replaced', detail: `${c.name}  ·  ${fmtSize(r.size)}  ·  ${fmtLen(r.duration)}`, ms: 9000 });
}

// a menu button opens its menu, or closes it when it's already open
function menuOpenFor(id) {
  const m = $('ctxmenu');
  if (!m.hidden && m.dataset.for === id) { hideMenu(); return true; }
  return false;
}
function markMenu(id) { $('ctxmenu').dataset.for = id; $(id).classList.add('open'); }
const trimmedNow = () => Q.tin > 0.01 || Q.tout < Q.dur - 0.01;
function menuAbove(id, items) {
  const r = $(id).getBoundingClientRect();
  openMenu(r.right, r.top - 6, items, true);
  const m = $('ctxmenu'); m.style.top = Math.max(8, r.top - m.offsetHeight - 6) + 'px';
  markMenu(id);
}
$('qtsavemenu').onclick = e => {
  e.stopPropagation();
  if (menuOpenFor('qtsavemenu')) return;
  menuAbove('qtsavemenu', [
    { icon: 'export', text: 'Export as...', run: () => exportAs('video', 'saveas') },
    { icon: 'music', text: 'Export audio as...', run: () => exportAs('audio', 'saveas') },
    '-',
    { icon: 'replace', text: 'Replace original', run: replaceOriginal, cls: 'danger', disabled: !trimmedNow() },
  ]);
};
$('qtcopymenu').onclick = e => {
  e.stopPropagation();
  if (menuOpenFor('qtcopymenu')) return;
  menuAbove('qtcopymenu', [{ icon: 'music', text: 'Copy Audio', run: () => exportAs('audio', 'clipboard') }]);
};
$('qtmore').onclick = e => {
  e.stopPropagation();
  if (menuOpenFor('qtmore')) return;
  const r = $('qtmore').getBoundingClientRect();
  openMenu(r.right, r.bottom + 6, [
    { icon: 'copy', text: 'Copy Video', run: () => exportAs('video', 'clipboard') },
    { icon: 'music', text: 'Copy Audio', run: () => exportAs('audio', 'clipboard') },
    '-',
    { icon: 'export', text: 'Export Video File', run: () => exportAs('video', 'save') },
    { icon: 'export', text: 'Export Audio File', run: () => exportAs('audio', 'save') },
    '-',
    { icon: 'edit', text: 'Rename', run: editTitle },
    { icon: 'replace', text: 'Replace original', run: replaceOriginal, cls: 'danger', disabled: !trimmedNow() },
  ], true);
  markMenu('qtmore');
};

// ---------- shortcuts ----------
const KEYS = [['Space', 'Play / pause'], ['I  O', 'Set start / end at the playhead'], [',  .', 'One frame back / forward'], ['←  →', 'One frame (Shift = 1 second)'],
  ['J  L', 'Back / forward 10 seconds'], ['Home  End', 'Jump to start / end of the trim'], ['F2', 'Rename'], ['Ctrl+C', 'Copy the trimmed clip'],
  ['Esc', 'Close']];
$('qthelp').onclick = e => {
  e.stopPropagation();
  if ($('qthelpbox')) { $('qthelpbox').remove(); return; }
  const b = h('div', 'qt-helpbox'); b.id = 'qthelpbox';
  for (const [k, d] of KEYS) b.append(h('kbd', '', k), h('span', '', d));
  $('qt').querySelector('.qt-box').append(b);
};
document.addEventListener('pointerdown', e => { const b = $('qthelpbox'); if (b && !b.contains(e.target) && e.target.closest('#qthelp') === null) b.remove(); });

function onKey(e) {
  if (!Q.visible) return;
  if (document.querySelector('.modal-ov')) return; // a dialog is open
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  // text boxes (times, names) handle their own keys
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  e.stopPropagation();
  if (k === 'escape') {
    e.preventDefault();
    if (!$('ctxmenu').hidden) { hideMenu(); return; }
    if ($('qthelpbox')) { $('qthelpbox').remove(); return; }
    if (Q.exporting) { T.cancel(); return; }
    if (Q.tab) closeTab(Q.tab);
    return;
  }
  if (ctrl && k === 'w') { e.preventDefault(); if (Q.tab) closeTab(Q.tab); return; }
  if (ctrl && k === 'o') { e.preventDefault(); pickFile(); return; }
  if (e.altKey && (k === 'arrowleft' || k === 'arrowright')) { e.preventDefault(); navInput(k === 'arrowleft' ? -1 : 1, true); return; }
  if (ctrl && k === 'c') { if (String(window.getSelection())) return; e.preventDefault(); exportAs('video', 'clipboard'); return; }
  if (ctrl && k === 'v') { pasteKey(); return; }
  if (k === 'f2') { e.preventDefault(); editTitle(); return; }
  if (ctrl || e.altKey || !Q.dur || Q.exporting) return;
  const frameStep = 1 / Q.fps;
  let handled = true;
  if (k === ' ') toggle();
  else if (k === 'i') setIn(now());
  else if (k === 'o') setOut(now());
  else if (k === 'arrowleft') { pause(); seekTo(Q.t - (e.shiftKey ? 1 : frameStep)); }
  else if (k === 'arrowright') { pause(); seekTo(Q.t + (e.shiftKey ? 1 : frameStep)); }
  else if (k === ',') { pause(); seekTo(Q.t - frameStep); }
  else if (k === '.') { pause(); seekTo(Q.t + frameStep); }
  else if (k === 'j') seekTo(now() - 10);
  else if (k === 'l') seekTo(now() + 10);
  else if (k === 'home') seekTo(Q.tin);
  else if (k === 'end') { pause(); seekTo(Q.tout - frameStep); }
  else handled = false;
  if (handled) e.preventDefault();
}
