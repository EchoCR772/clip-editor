// Quick trim: a Discord-style overlay over the library for trimming one clip.
// The trim and audio settings are saved per clip (the file is never changed); Copy/Export make a
// new file from them. The picture comes from the GPU player (gpuplayer.mjs), the sound from the
// audio engine (engine.mjs), which also drives the clock the picture follows.
// Uses the page's shared helpers from app.js / library.js ($, h, T, icoSpan, setIco, fmt, ...).
import { GpuPlayer, ElementPlayer } from './gpuplayer.mjs';

const Q = {
  open: false, clip: null, info: null, player: null, session: null,
  dur: 0, fps: 30, tin: 0, tout: 0, t: 0, playing: false, base: { t: 0, p: 0 },
  groups: [], drag: null, wasPlaying: false, exporting: false, saveTimer: null, peaks: null, gen: 0,
};
const qclamp = (x, a, b) => Math.min(b, Math.max(a, x));
const qpct = t => (Q.dur ? t / Q.dur * 100 : 0);

// ---------- audio groups ----------
// Discord clips carry each source separately (the game/app, every voice, the soundboard) plus a
// full mix; NVIDIA's "separate tracks" recordings have the game, then the mic.
function audioGroups(info) {
  const a = info.audio || [];
  const make = (key, name, icon, idx) => ({ key, name, icon, idx, mute: false, vol: 1, open: false });
  if (!a.length) return [];
  if (info.discord) {
    const of = test => a.map((x, i) => (test(x.kind) ? i : -1)).filter(i => i >= 0);
    const groups = [
      make('game', 'Game / Desktop', 'gamepad', of(k => k === 'application' || !['all', 'all_copy', 'voice', 'soundboard'].includes(k))),
      make('voice', 'Mic / Voices', 'mic', of(k => k === 'voice')),
      make('sb', 'Soundboard', 'music', of(k => k === 'soundboard')),
    ].filter(g => g.idx.length);
    if (groups.length) return groups;
    return [make('audio', 'Audio', 'speaker', [Math.max(0, a.findIndex(x => x.kind === 'all'))])];
  }
  if (a.length === 1) return [make('audio', 'Audio', 'speaker', [0])];
  const mic = a.map((x, i) => i).filter(i => i > 0 && (info.nvidia || /\b(mic|microphone|voice|commentary)\b/i.test(a[i].title || '') || a.length === 2));
  const game = a.map((x, i) => i).filter(i => !mic.includes(i));
  return [make('game', 'Game / Desktop', 'gamepad', game), make('voice', 'Microphone', 'mic', mic)].filter(g => g.idx.length);
}
function applySaved(groups, edit) {
  const saved = (edit && edit.audio) || {};
  for (const g of groups) if (saved[g.key]) { g.mute = !!saved[g.key].mute; g.vol = qclamp(+saved[g.key].vol || 1, 0, 2); }
  return groups;
}
// what goes into the exported file: an untouched Discord clip keeps Discord's own full mix
function sourcesFor(info, groups) {
  const untouched = groups.every(g => !g.mute && Math.abs(g.vol - 1) < 0.001);
  if (info.discord && untouched) { const all = (info.audio || []).findIndex(x => x.kind === 'all'); if (all >= 0) return [{ index: all, gain: 1 }]; }
  return groups.filter(g => !g.mute && g.vol > 0.001).flatMap(g => g.idx.map(i => ({ index: i, gain: g.vol })));
}
// for exporting a clip's saved trim without opening the overlay (Copy Video on a card)
window.qtExportSaved = async (c, dest) => {
  const o = await T.qtOpen(c.path);
  if (!o.ok) return o;
  try {
    const e = c.edit || o.edit || {};
    const groups = applySaved(audioGroups(o.info), e);
    return await T.qtExport({ path: c.path, start: e.in || 0, end: e.out || o.info.duration, as: 'video', dest, sources: sourcesFor(o.info, groups) });
  } finally { if (!(Q.open && Q.clip && Q.clip.path === c.path)) T.qtClose(c.path); }
};

// ---------- opening and closing ----------
async function openQuickTrim(c, el) {
  if (Q.open) await closeQuickTrim();
  const gen = ++Q.gen;
  Q.open = true; Q.clip = c; Q.exporting = false; Q.playing = false; Q.peaks = null;
  stopPreview(); hideMenu();
  el && el.classList.add('opening');
  const box = $('qt');
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add('on'));
  $('qttitle').textContent = `Clip from ${fmtWhen(c.date)}`;
  $('qtsub').replaceChildren(...subParts(c));
  $('qtname').textContent = c.name;
  $('qtmeta').textContent = '';
  const th = L.thumbs.get(c.path);
  $('qtthumb').replaceChildren();
  if (th && th.url) { const i = new Image(); i.src = th.url; i.alt = ''; $('qtthumb').append(i); }
  status('');
  $('qtmsg').textContent = '';
  $('qtaudio').replaceChildren();
  window.addEventListener('keydown', onKey, true);

  const r = await T.qtOpen(c.path);
  el && el.classList.remove('opening');
  if (gen !== Q.gen) return;
  if (!r.ok) { status(r.error, 'err'); return; }
  const info = Q.info = r.info;
  Q.dur = info.duration || c.duration || 0;
  Q.fps = info.fps || 30;
  const e = r.edit || c.edit || null;
  Q.tin = qclamp(e && e.in != null ? +e.in : 0, 0, Q.dur);
  Q.tout = qclamp(e && e.out != null ? +e.out : Q.dur, Q.tin + 0.05, Q.dur);
  if (Q.tout - Q.tin < 0.05) { Q.tin = 0; Q.tout = Q.dur; }
  Q.t = Q.tin;
  Q.groups = applySaved(audioGroups(info), e);
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
  if (Q.player) { Q.player.show(Q.t); $('qtstage').dataset.renderer = Q.player.renderer; }
  // sound
  try {
    await audioReady;
    const specs = Q.groups.flatMap(g => g.idx.map(i => ({ key: 't' + i, path: c.path, index: i })));
    if (specs.length) Q.session = await window.ClipAudio.Session.open(specs, reader);
  } catch (err) { Q.session = null; status("The sound can't be previewed for this clip (the export still has it).", '', 8000); }
  if (gen !== Q.gen) { closeMedia(); return; }
  applyGains();
  if (Q.session) Q.session.seek(Q.t);
  // timeline pictures and waveform, in the background
  loadWave(gen);
  loadStrip(gen);
  schedulePrepare(400);
  requestAnimationFrame(frame);
}
window.openQuickTrim = openQuickTrim;

function subParts(c) {
  const f = L.data && L.data.folders.find(x => samePathR(x.path, c.root));
  const parts = [c.gameName];
  if (f) parts.push(srcLabel(f));
  parts.push(new Date(c.date).toLocaleString());
  const out = [];
  parts.filter(Boolean).forEach((p, i) => { if (i) out.push(h('span', 'dot', '·')); out.push(h('span', '', p)); });
  return out;
}

function freshCanvas() {
  // a canvas can only ever have one kind of drawing context, so each clip gets a new one
  const old = $('qtcanvas'), c = document.createElement('canvas');
  c.id = 'qtcanvas';
  old.replaceWith(c);
  $('qtvideo').hidden = true;
  return c;
}

function closeMedia() {
  if (Q.player) { Q.player.close(); Q.player = null; }
  if (Q.session) { Q.session.close(); Q.session = null; }
}

async function closeQuickTrim() {
  if (!Q.open) return;
  if (Q.exporting) { T.cancel(); return; }
  Q.gen++;
  pause();
  flushSave();
  closeMedia();
  const c = Q.clip;
  Q.open = false; Q.clip = null; Q.info = null;
  window.removeEventListener('keydown', onKey, true);
  hideMenu(); $('qthelpbox') && $('qthelpbox').remove();
  const box = $('qt');
  box.classList.remove('on');
  setTimeout(() => { if (!Q.open) box.hidden = true; }, 160);
  if (c) T.qtClose(c.path);
}
$('qtclose').onclick = () => closeQuickTrim();
$('qt').addEventListener('pointerdown', e => { if (e.target === $('qt')) closeQuickTrim(); });

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

function frame() {
  if (!Q.open) return;
  if (Q.playing && !Q.starting) {
    const t = clock();
    if (t >= Q.tout - 0.005) play(Q.tin); // loop the selection
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
// while the panel slides the lane changes width every frame: the ruler and waveform follow
// right away, the pictures (which take decoding) once it settles
let stripTimer = null;
new ResizeObserver(() => {
  if (!Q.open) return;
  buildQtRuler(); drawWave();
  clearTimeout(stripTimer);
  if (Q.stripDrawn && Q.player) stripTimer = setTimeout(() => loadStrip(Q.gen), 250);
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

async function loadWave(gen) {
  const w = lane.clientWidth;
  const r = await T.qtWave(Q.clip.path, Q.dur, Math.round(w / 3));
  if (gen !== Q.gen || !r.ok || !r.peaks) return;
  Q.peaks = r.peaks;
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

async function loadStrip(gen) {
  const c = $('qtstrip'), dpr = devicePixelRatio || 1;
  const w = c.clientWidth, hh = c.clientHeight;
  if (!w || !hh || !Q.player || !Q.dur) return;
  c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
  const g = c.getContext('2d');
  const ar = (Q.player.width || 16) / (Q.player.height || 9);
  const tw = hh * ar, n = Math.max(1, Math.ceil(w / tw));
  const times = Array.from({ length: n }, (_x, i) => Math.min(Q.dur - 0.05, (i + 0.5) * Q.dur / n));
  Q.stripDrawn = true;
  await Q.player.thumbnails(times, (i, s) => {
    if (gen !== Q.gen) return;
    s.draw(g, Math.round(i * tw * dpr), 0, Math.ceil(tw * dpr), c.height);
  });
}

// ---------- trim ----------
function setIn(t) { Q.tin = qclamp(t, 0, Q.tout - 0.1); seekTo(Q.tin); drawWave(); scheduleSave(); }
function setOut(t) { Q.tout = qclamp(t, Q.tin + 0.1, Q.dur); drawWave(); scheduleSave(); }
$('qtreset').onclick = () => { Q.tin = 0; Q.tout = Q.dur; seekTo(0); drawWave(); scheduleSave(); };

function editState() {
  const audio = {};
  for (const g of Q.groups) if (g.mute || Math.abs(g.vol - 1) > 0.001) audio[g.key] = { mute: g.mute, vol: Math.round(g.vol * 100) / 100 };
  const trimmed = Q.tin > 0.01 || Q.tout < Q.dur - 0.01;
  if (!trimmed && !Object.keys(audio).length) return null;
  return { in: Math.round(Q.tin * 1000) / 1000, out: Math.round(Q.tout * 1000) / 1000, dur: Q.dur, audio };
}
function scheduleSave() { clearTimeout(Q.saveTimer); Q.saveTimer = setTimeout(flushSave, 250); schedulePrepare(); }
// make the trimmed clip in the background so Copy Video is instant (nothing to make when untouched)
function schedulePrepare(ms = 900) {
  clearTimeout(Q.prepTimer);
  Q.prepTimer = setTimeout(() => {
    if (!Q.open || !Q.info || Q.drag || !editState()) return;
    T.qtPrepare({ path: Q.clip.path, start: Q.tin, end: Q.tout, as: 'video', sources: sourcesFor(Q.info, Q.groups) });
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
    name.append(icoSpan(g.icon), h('span', '', g.name), h('span', 'qt-avol', Math.abs(g.vol - 1) > 0.001 ? Math.round(g.vol * 100) + '%' : ''));
    name.onclick = () => { g.open = !g.open; buildAudioRows(); };
    const mute = h('button', 'ibtn sm qt-amute');
    mute.title = g.mute ? 'Unmute' : 'Mute';
    mute.append(icoSpan(g.mute ? 'speakerOff' : 'speaker'));
    mute.onclick = () => { g.mute = !g.mute; applyGains(); buildAudioRows(); scheduleSave(); };
    head.append(name, mute);
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
function applyGains() {
  if (!Q.session) return;
  for (const g of Q.groups) for (const i of g.idx) Q.session.setGain('t' + i, g.mute ? 0 : g.vol);
}

// listening volume (shared with the rest of the app; never changes the export)
function showListen() {
  $('qtlvol').value = Math.round(listenVol * 100);
  setIco($('qtlmute').firstElementChild, listenMute || !listenVol ? 'headphonesOff' : 'headphones');
}
$('qtlvol').addEventListener('input', () => { listenVol = Number($('qtlvol').value) / 100; listenMute = false; applyListen(); showListen(); });
$('qtlmute').onclick = () => { listenMute = !listenMute; applyListen(); showListen(); };
showListen();

// ---------- copy / save ----------
// messages go under the buttons, or float over the timeline while the panel is collapsed
function status(text, cls, hideMs) {
  const parts = Array.isArray(text) ? text : [text || ''];
  const s = $('qtstatus'), n = $('qtnote');
  s.className = 'qt-status' + (cls ? ' ' + cls : '');
  s.replaceChildren(...parts);
  n.className = 'qt-note' + (cls ? ' ' + cls : '') + (parts.join('') || parts.some(x => x.nodeType) ? ' on' : '');
  n.replaceChildren(...parts.map(x => (x && x.nodeType ? x.cloneNode(true) : x)));
  for (const b of n.querySelectorAll('button')) b.onclick = () => s.querySelector('button') && s.querySelector('button').click();
  clearTimeout(status.t);
  if (hideMs) status.t = setTimeout(() => { s.replaceChildren(); n.classList.remove('on'); }, hideMs);
}
T.onQtProgress(p => {
  if (!Q.exporting) return;
  $('qtbar').value = p;
  const n = $('qtnote'), m = n.textContent.match(/^(.*?\.\.\.)/);
  if (m) n.textContent = `${m[1]} ${Math.round(p * 100)}%`;
});

// ---------- collapsible panel ----------
// Trimming mostly needs the picture and the timeline; the panel folds into a slim rail with
// the actions. Remembered between clips and sessions.
function setPanel(collapsed, save = true) {
  $('qt').querySelector('.qt-box').classList.toggle('collapsed', collapsed);
  if (save) { try { localStorage.setItem('qtPanel', collapsed ? 'collapsed' : 'open'); } catch (e) { /* ignore */ } }
  hideMenu();
  if (typeof hideTip === 'function') hideTip();
}
try { setPanel(localStorage.getItem('qtPanel') === 'collapsed', false); } catch (e) { /* ignore */ }
$('qtcollapse').onclick = () => setPanel(true);
$('qtrexpand').onclick = () => setPanel(false);
$('qtrclose').onclick = () => closeQuickTrim();
$('qtrcopy').onclick = () => exportAs('video', 'clipboard');
$('qtrexport').onclick = () => exportAs('video', 'save');
async function exportAs(as, dest) {
  if (!Q.open || !Q.info || Q.exporting) return;
  pause();
  flushSave();
  Q.exporting = true;
  $('qt').classList.add('busy');
  $('qtbar').hidden = false; $('qtbar').value = 0;
  status(dest === 'clipboard' ? `Making the ${as === 'audio' ? 'audio' : 'clip'}...` : 'Exporting...');
  // an untouched clip is copied as it is: nothing to make
  const r = as === 'video' && dest === 'clipboard' && !editState()
    ? await T.copyFiles([Q.clip.path]).then(x => (x.ok ? { ok: true, size: Q.clip.size } : x))
    : await T.qtExport({ path: Q.clip.path, start: Q.tin, end: Q.tout, as, dest, sources: sourcesFor(Q.info, Q.groups) });
  Q.exporting = false;
  $('qt').classList.remove('busy');
  $('qtbar').hidden = true;
  if (!Q.open) return;
  if (!r.ok) { status(r.error, 'err'); return; }
  if (r.cancelled) { status(''); return; }
  if (dest === 'clipboard') {
    const big = r.size > 10 * 1048576;
    status(`Copied (${fmtSize(r.size)}). Paste into Discord with Ctrl+V.${big ? " It's over 10 MB, so Discord needs Nitro to send it." : ''}`, 'ok', 9000);
  } else {
    const link = h('button', 'linkbtn', 'Show in folder');
    link.onclick = () => T.reveal(r.out);
    status([`Exported ${r.out.split(/[\\/]/).pop()} (${fmtSize(r.size)}). `, link], 'ok', 12000);
    if (L.data) L.dirty = true;
  }
}
$('qtcopy').onclick = () => exportAs('video', 'clipboard');
$('qtsave').onclick = () => exportAs('video', 'save');
// a menu button opens its menu, or closes it when it's already open
function menuOpenFor(id) {
  const m = $('ctxmenu');
  if (!m.hidden && m.dataset.for === id) { hideMenu(); return true; }
  return false;
}
function markMenu(id) { $('ctxmenu').dataset.for = id; $(id).classList.add('open'); }
$('qtsavemenu').onclick = e => {
  e.stopPropagation();
  if (menuOpenFor('qtsavemenu')) return;
  const r = $('qtsavemenu').getBoundingClientRect();
  openMenu(r.right, r.top - 6, [
    { icon: 'export', text: 'Export as...', run: () => exportAs('video', 'saveas') },
    { icon: 'music', text: 'Export audio as...', run: () => exportAs('audio', 'saveas') },
  ], true);
  const m = $('ctxmenu'); m.style.top = Math.max(8, r.top - m.offsetHeight - 6) + 'px';
  markMenu('qtsavemenu');
};
$('qtcopymenu').onclick = e => {
  e.stopPropagation();
  if (menuOpenFor('qtcopymenu')) return;
  const r = $('qtcopymenu').getBoundingClientRect();
  openMenu(r.right, r.top - 6, [{ icon: 'music', text: 'Copy Audio', run: () => exportAs('audio', 'clipboard') }], true);
  const m = $('ctxmenu'); m.style.top = Math.max(8, r.top - m.offsetHeight - 6) + 'px';
  markMenu('qtcopymenu');
};
const moreMenu = id => e => {
  e.stopPropagation();
  if (menuOpenFor(id)) return;
  const r = $(id).getBoundingClientRect();
  const rail = id === 'qtrmore';
  openMenu(rail ? r.left - 8 : r.right, rail ? r.top : r.bottom + 6, [
    { icon: 'copy', text: 'Copy Video', run: () => exportAs('video', 'clipboard') },
    { icon: 'music', text: 'Copy Audio', run: () => exportAs('audio', 'clipboard') },
    '-',
    { icon: 'export', text: 'Export Video File', run: () => exportAs('video', 'save') },
    { icon: 'export', text: 'Export Audio File', run: () => exportAs('audio', 'save') },
    '-',
    { icon: 'folder', text: 'Show in Folder', run: () => T.libAction('reveal', Q.clip.path) },
  ], true);
  markMenu(id);
};
$('qtmore').onclick = moreMenu('qtmore');
$('qtrmore').onclick = moreMenu('qtrmore');

// ---------- shortcuts ----------
const KEYS = [['Space', 'Play / pause'], ['I  O', 'Set start / end at the playhead'], ['←  →', 'One frame (Shift = 1 second)'],
  ['J  L', 'Back / forward 5 seconds'], ['Home  End', 'Jump to start / end'], ['Ctrl+C', 'Copy the trimmed clip'], ['Esc', 'Close']];
$('qthelp').onclick = e => {
  e.stopPropagation();
  if ($('qthelpbox')) { $('qthelpbox').remove(); return; }
  const b = h('div', 'qt-helpbox'); b.id = 'qthelpbox';
  for (const [k, d] of KEYS) b.append(h('kbd', '', k), h('span', '', d));
  $('qt').querySelector('.qt-side').append(b);
};
document.addEventListener('pointerdown', e => { const b = $('qthelpbox'); if (b && !b.contains(e.target) && e.target.closest('#qthelp') === null) b.remove(); });

function onKey(e) {
  if (!Q.open) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  e.stopPropagation();
  if (k === 'escape') {
    e.preventDefault();
    if (!$('ctxmenu').hidden) { hideMenu(); return; }
    if ($('qthelpbox')) { $('qthelpbox').remove(); return; }
    closeQuickTrim();
    return;
  }
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (ctrl && k === 'c') { e.preventDefault(); exportAs('video', 'clipboard'); return; }
  if (ctrl || e.altKey || !Q.dur || Q.exporting) return;
  const step = e.shiftKey ? 1 : 1 / Q.fps;
  let handled = true;
  if (k === ' ') toggle();
  else if (k === 'i') setIn(Q.t);
  else if (k === 'o') setOut(Q.t);
  else if (k === 'arrowleft') seekTo((Q.playing ? clock() : Q.t) - step);
  else if (k === 'arrowright') seekTo((Q.playing ? clock() : Q.t) + step);
  else if (k === 'j') seekTo((Q.playing ? clock() : Q.t) - 5);
  else if (k === 'l') seekTo((Q.playing ? clock() : Q.t) + 5);
  else if (k === 'home') seekTo(Q.tin);
  else if (k === 'end') seekTo(Q.tout);
  else handled = false;
  if (handled) e.preventDefault();
}
