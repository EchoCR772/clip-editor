'use strict';
// Shared basics for the page: icons, time formats, the listening volume, the audio engine's byte
// reader, and opening videos from outside the library (Open file, drag and drop, paste).
const T = window.trimmer;
const $ = id => document.getElementById(id);

// ---------- icons ----------
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const skip = (dir, n) => `<svg viewBox="0 0 24 24"><path ${S} d="${dir < 0 ? 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4' : 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4'}"/><text x="${dir < 0 ? 12.3 : 11.7}" y="15.1" font-size="${n > 9 ? 6.6 : 7.5}" font-weight="700" text-anchor="middle" fill="currentColor" font-family="Segoe UI,sans-serif">${n}</text></svg>`;
const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  back10: skip(-1, 10),
  fwd10: skip(1, 10),
  toStart: `<svg viewBox="0 0 24 24"><path d="M17.5 6v12L9 12z" fill="currentColor"/><path ${S} d="M6.5 6v12"/></svg>`,
  toEnd: `<svg viewBox="0 0 24 24"><path d="M6.5 6v12L15 12z" fill="currentColor"/><path ${S} d="M17.5 6v12"/></svg>`,
  loop: `<svg viewBox="0 0 24 24"><path ${S} d="M17 2.5l3 3-3 3M4 11.5V10a4.5 4.5 0 0 1 4.5-4.5H20M7 21.5l-3-3 3-3M20 12.5V14a4.5 4.5 0 0 1-4.5 4.5H4"/></svg>`,
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
  fileOpen: `<svg viewBox="0 0 24 24"><path ${S} d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z"/><path ${S} d="M13.5 3.5v5h5M10.5 11.5v5l4-2.5z"/></svg>`,
  folderPlus: `<svg viewBox="0 0 24 24"><path ${S} d="M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5zM12 10.5v5.5M9.25 13.25h5.5"/></svg>`,
  menu: `<svg viewBox="0 0 24 24"><path ${S} d="M4.5 7h15M4.5 12h15M4.5 17h15"/></svg>`,
  download: `<svg viewBox="0 0 24 24"><path ${S} d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/></svg>`,
  copy: `<svg viewBox="0 0 24 24"><rect ${S} x="8.5" y="8.5" width="11" height="11.5" rx="2"/><path ${S} d="M5 15.5V6a2 2 0 0 1 2-2h8.5"/></svg>`,
  export: `<svg viewBox="0 0 24 24"><path ${S} d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>`,
  replace: `<svg viewBox="0 0 24 24"><path ${S} d="M4.5 9.5a7.5 7.5 0 0 1 13.2-3.2M19.5 4v4h-4M19.5 14.5a7.5 7.5 0 0 1-13.2 3.2M4.5 20v-4h4"/></svg>`,
  checkCircle: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#0e0e10" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
function setIco(el, name) { if (el.dataset.ico !== name || !el.firstChild) { el.dataset.ico = name; el.innerHTML = ICONS[name] || ''; } }
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = ICONS[el.dataset.ico] || ''; });
const icoSpan = name => { const s = document.createElement('span'); s.className = 'ico'; setIco(s, name); return s; };

// ---------- formats ----------
const fmt = t => {
  if (!isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  const ss = (s < 10 ? '0' : '') + s.toFixed(2);
  return h ? `${h}:${m < 10 ? '0' : ''}${m}:${ss}` : `${m}:${ss}`;
};
// "1:02.5", "62.5", "1:02:03" -> seconds
const parse = s => {
  s = String(s).trim();
  if (!s) return NaN;
  const p = s.split(':').map(Number);
  if (p.length > 3 || p.some(isNaN)) return NaN;
  return p.reduce((a, x) => a * 60 + x, 0);
};
const fmtSize = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB';
const clamp = (t, a, b) => Math.min(b, Math.max(a, t));

// ---------- listening volume ----------
// Only changes what you hear, never the export. Saved between sessions. Squared so the slider
// feels even across its range.
let listenVol = 1, listenMute = false;
try {
  const l = JSON.parse(localStorage.getItem('listen') || 'null');
  if (l) { listenVol = Math.min(1, Math.max(0, +l.vol || 0)); listenMute = !!l.mute; }
} catch (e) { /* ignore */ }
const listenGain = () => (listenMute ? 0 : listenVol * listenVol);
function applyListen() {
  if (window.ClipAudio) window.ClipAudio.setListen(listenGain());
  try { localStorage.setItem('listen', JSON.stringify({ vol: listenVol, mute: listenMute })); } catch (e) { /* ignore */ }
}
window.addEventListener('clipaudio-ready', () => window.ClipAudio.setListen(listenGain()));

// ---------- the audio engine reads the clip through main ----------
const audioReady = window.ClipAudio ? Promise.resolve()
  : new Promise(r => window.addEventListener('clipaudio-ready', r, { once: true }));
const reader = { size: p => T.fileSize(p), read: (p, a, b) => T.readRange(p, a, b) };

// ---------- opening videos from outside the library ----------
// Each opens in the editor (quicktrim.mjs). A folder dropped on the window is
// offered as a new clip folder.
async function openResult(r) {
  if (!r || !r.ok) { if (r && r.error) libToast(r.error, 'err'); return; }
  if (r.clip && window.openQuickTrim) window.openQuickTrim(r.clip);
}
const pickFile = async () => openResult(await T.pick());
T.onOpen(clip => openResult({ ok: true, clip }));

async function openDropped(p) {
  const kind = await T.pathKind(p);
  if (kind === 'dir') {
    if (!(await confirmBox({ title: 'Add this folder?', body: `Clips in ${p} will show up in your library. Nothing is moved or changed.`, ok: 'Add folder', danger: false }))) return;
    await folderAdded(await T.libAddFolderPath(p));
    return;
  }
  openResult(await T.openPath(p));
}

// paste a video copied in File Explorer (Ctrl+V)
let pasteSeen = false;
document.addEventListener('paste', async e => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  pasteSeen = true;
  e.preventDefault();
  const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
  const p = files.map(f => { try { return T.pathFor(f); } catch (err) { return ''; } }).find(Boolean);
  if (p) openDropped(p); else openResult(await T.clipboardFile());
});
function pasteKey() {
  // the paste event carries files copied in Explorer; if it doesn't come, ask main for the clipboard
  pasteSeen = false;
  setTimeout(() => { if (!pasteSeen) T.clipboardFile().then(r => (r.ok ? openResult(r) : null)); }, 250);
}

// drag and drop: a simple card in the middle, the drop works anywhere on the window
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
window.addEventListener('dragenter', e => {
  if (!hasFiles(e) || document.body.classList.contains('dragout')) return;
  e.preventDefault(); dragDepth++;
  document.body.classList.add('dropping');
});
window.addEventListener('dragover', e => { if (hasFiles(e) && !document.body.classList.contains('dragout')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dropping'); });
window.addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
  if (document.body.classList.contains('dragout')) return; // one of our own cards
  for (const f of Array.from(e.dataTransfer.files)) { let p = ''; try { p = T.pathFor(f); } catch (err) { /* ignore */ } if (p) await openDropped(p); }
});

// keys that work everywhere
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl && k === 'o') { e.preventDefault(); pickFile(); return; }
  if (ctrl && k === ',') { e.preventDefault(); openSettings(); return; }
  if (e.altKey && !ctrl && (k === 'arrowleft' || k === 'arrowright')) { e.preventDefault(); navInput(k === 'arrowleft' ? -1 : 1, true); return; }
  if (ctrl && k === 'w') { e.preventDefault(); if (window.closeActiveTab) window.closeActiveTab(); return; }
  if (window.qtIsOpen && window.qtIsOpen()) return; // the editor handles its own keys
  if (settingsOpen()) { if (k === 'escape') { e.preventDefault(); closeSettings(); } return; }
  if (libKey(e)) return;
  if (ctrl && k === 'v' && e.target.tagName !== 'INPUT') pasteKey();
});

// zoom, full screen, sidebar: before the editor's own keys
window.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey, k = e.key;
  let act = null;
  if (ctrl && (k === '=' || k === '+')) act = () => T.win('zoom-in');
  else if (ctrl && k === '-') act = () => T.win('zoom-out');
  else if (ctrl && k === '0') act = () => T.win('zoom-reset');
  else if (k === 'F11') act = () => T.win('fullscreen');
  else if (ctrl && k.toLowerCase() === 'b' && !(window.qtIsOpen && window.qtIsOpen())) act = () => toggleSidebar();
  else if (ctrl && k === '/') act = () => shortcutsBox();
  if (!act) return;
  e.preventDefault(); e.stopPropagation();
  act();
}, true);
