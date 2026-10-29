// ---------- pages: Clips library, editor, Settings ----------
// The "Clips" page lists every clip in the user's clip folders (NVIDIA's per-game folders,
// Discord's clip folder, anything they add). The sidebar starts with the folders; click one to
// see its games. Back/forward (mouse side buttons, Alt+arrows) moves between pages like a browser.

let page = 'lib'; // 'lib' | 'edit' | 'settings'
const L = {
  data: null, scanning: false, again: false, dirty: true,
  src: 'all', game: 'all', kind: 'all', sort: 'new', q: '',
  months: true,        // split Newest/Oldest into month sections
  trims: 'hide',       // trimmed clips in the other sections: 'show' | 'hide' | 'only'
  side: { w: 300, collapsed: false },
  thumbs: new Map(),   // path -> { url, duration, error }
  sel: new Set(), anchor: -1, // selected clip paths; last clicked (for Shift+click)
  list: [], shown: 0,  // filtered clips and how many are on the page so far
};
try {
  const p = JSON.parse(localStorage.getItem('library') || '{}');
  for (const k of ['src', 'game', 'kind', 'sort']) if (typeof p[k] === 'string') L[k] = p[k];
  if (typeof p.months === 'boolean') L.months = p.months;
  if (['show', 'hide', 'only'].includes(p.trims)) L.trims = p.trims;
  if (p.side) L.side = { w: Math.min(460, Math.max(220, +p.side.w || 300)), collapsed: !!p.side.collapsed };
} catch (e) { /* ignore */ }
const saveLibPrefs = () => {
  try { localStorage.setItem('library', JSON.stringify({ src: L.src, game: L.game, kind: L.kind, sort: L.sort, months: L.months, trims: L.trims, side: L.side })); } catch (e) { /* ignore */ }
};

const KINDS = [
  ['all', 'All'], ['discord', 'Discord'], ['replay', 'Instant Replay'], ['recording', 'Recordings'],
];
const KIND_BADGE = { discord: 'Clip', replay: 'Instant Replay', recording: 'Recording', trim: 'Trimmed' };
const SRC_LOOK = {
  nvidia: { label: 'NVIDIA', icon: 'gamepad', color: '#1e1e1e', img: 'img/nvidia.png' },
  discord: { label: 'Discord', icon: 'chat', color: '#1e1e1e', img: 'img/discord.png' },
  folder: { label: '', icon: 'folder', color: '#2e2d31' },
  trimmed: { label: 'Trimmed', icon: 'scissors', color: '#1f8b4c' },
};
const samePathR = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtWhen = ms => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtMonth = ms => new Date(ms).toLocaleString(undefined, { month: 'long', year: 'numeric' });
const fmtLen = s => { s = Math.round(s); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const hue = s => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x) % 360; };
const folderName = p => p.split(/[\\/]/).filter(Boolean).pop() || p;
const srcLabel = f => SRC_LOOK[f.kind].label || folderName(f.path);

function setPage(p) {
  if (p !== 'edit' && exporting) return;
  if (p === 'edit' && !active) p = 'lib';
  const was = page;
  page = p;
  libMode = p !== 'edit';
  const app = $('app');
  app.classList.toggle('nonedit', p !== 'edit');
  $('library').hidden = p !== 'lib';
  $('settings').hidden = p !== 'settings';
  $('libtab').classList.toggle('active', p === 'lib');
  $('setbtn').classList.toggle('on', p === 'settings');
  if (p !== 'edit') v.pause();
  if (p !== 'lib') { stopPreview(); hideMenu(); }
  if (p === 'lib') { document.title = 'Clips - ' + T.appName; if (L.dirty || !L.data) loadLibrary(); }
  else if (p === 'settings') { document.title = 'Settings - ' + T.appName; renderSettings(); }
  else document.title = info ? info.name + ' - ' + T.appName : T.appName;
  if (was !== p || p === 'edit') renderTabs();
  navCommit();
}
const setLib = on => setPage(on ? 'lib' : 'edit');
$('libtab').onclick = () => setPage('lib');
$('setbtn').onclick = () => { if (page !== 'settings') setPage('settings'); else if (H.i > 0) navGo(-1); else setPage('lib'); };

// ---------- back / forward ----------
const H = { list: [], i: -1, applying: false, timer: 0 };
function navState() {
  if (page === 'edit') return { page, tab: active ? active.id : null };
  if (page === 'lib') return { page, src: L.src, game: L.game };
  return { page };
}
// record where we are; several changes in one go (open a clip -> switch tab) become one step
function navCommit() {
  if (H.applying) return;
  clearTimeout(H.timer);
  H.timer = setTimeout(() => {
    const s = navState(), cur = H.list[H.i];
    if (cur && JSON.stringify(cur) === JSON.stringify(s)) return;
    H.list.splice(H.i + 1);
    H.list.push(s);
    if (H.list.length > 100) H.list.shift();
    H.i = H.list.length - 1;
  }, 0);
}
function navGo(d) {
  clearTimeout(H.timer);
  for (let j = H.i + d; j >= 0 && j < H.list.length; j += d) {
    const s = H.list[j];
    if (s.page === 'edit' && !tabs.some(t => t.id === s.tab)) continue; // that tab was closed
    if (JSON.stringify(s) === JSON.stringify(navState())) { H.i = j; continue; }
    H.i = j;
    H.applying = true;
    try {
      if (s.page === 'edit') { const t = tabs.find(x => x.id === s.tab); setPage('edit'); switchTo(t); }
      else if (s.page === 'lib') {
        const changed = L.src !== s.src || L.game !== s.game;
        L.src = s.src; L.game = s.game;
        setPage('lib');
        if (changed && L.data) { saveLibPrefs(); renderSide(); renderGrid(true); }
      } else setPage(s.page);
    } finally { H.applying = false; }
    return;
  }
}
let lastNav = 0;
function navInput(d, key) {
  const now = Date.now();
  if (!key && now - lastNav < 300) return; // the mouse button arrives both as a click and as an app command
  if (!key) lastNav = now;
  if (exporting) return;
  hideMenu();
  navGo(d);
}
window.addEventListener('mousedown', e => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
window.addEventListener('mouseup', e => { if (e.button === 3 || e.button === 4) { e.preventDefault(); navInput(e.button === 3 ? -1 : 1); } });
T.onNav(dir => navInput(dir === 'back' ? -1 : 1));

// ---------- loading ----------
async function loadLibrary() {
  if (L.scanning) { L.again = true; return; }
  L.scanning = true; L.dirty = false;
  if (!L.data) libEmpty('Looking for clips...');
  const r = await T.libScan();
  L.scanning = false;
  if (r.ok) {
    // folder activity often changes nothing we show; then leave the cards alone instead of rebuilding them
    const sig = JSON.stringify([r.folders, r.clips.map(c => [c.path, c.size, c.date, c.duration, c.game, c.gameName])]);
    if (!(L.data && sig === L.sig)) { L.sig = sig; L.data = r; renderLibrary(); }
  } else libEmpty(r.error);
  if (L.again) { L.again = false; loadLibrary(); }
}
T.onLibChanged(() => { if (page === 'lib') loadLibrary(); else L.dirty = true; });
T.onLibProgress(n => { if (!L.data) libEmpty(`Reading your clips... ${n}`); });

function libEmpty(text, withButton) {
  const box = $('libgrid');
  box.replaceChildren();
  const d = h('div', 'libempty');
  d.append(h('div', '', text));
  if (withButton) {
    const b = h('button', 'btn'); b.append(icoSpan('gear'), document.createTextNode('Open Settings'));
    b.onclick = () => setPage('settings');
    d.append(b);
  }
  box.append(d);
}

function renderLibrary() {
  const d = L.data;
  if (!d) return;
  if (L.src !== 'all' && !d.folders.some(f => !f.missing && samePathR(f.path, L.src))) { L.src = 'all'; L.game = 'all'; }
  if (L.game !== 'all' && !d.clips.some(c => c.game === L.game && (L.src === 'all' || samePathR(c.root, L.src)))) L.game = 'all';
  renderSide();
  renderGrid();
}

// ---------- tooltips (Spotify-style: a small dark label above the thing you hover) ----------
const tip = { el: null, timer: 0 };
function showTip(el, text, pos) {
  const t = $('tip');
  clearTimeout(tip.hideTimer);
  t.textContent = text || el.dataset.tip;
  t.classList.toggle('rail', pos === 'right' || pos === 'left');
  t.hidden = false;
  const r = el.getBoundingClientRect(), w = t.offsetWidth, ht = t.offsetHeight;
  let x, y;
  if (pos === 'left') { x = r.left - w - 10; y = r.top + r.height / 2 - ht / 2; }
  else if (pos === 'right' || el.dataset.tipPos === 'right') {
    const box = pos === 'right' ? (el.querySelector('.gav') || el).getBoundingClientRect() : r;
    x = box.right + 12; y = box.top + box.height / 2 - ht / 2;
  }
  else {
    x = r.left + r.width / 2 - w / 2; y = r.top - ht - 8;
    if (y < 4) y = r.bottom + 8; // no room above: show it below
  }
  t.style.left = Math.max(6, Math.min(x, innerWidth - w - 6)) + 'px';
  t.style.top = Math.max(4, Math.min(y, innerHeight - ht - 4)) + 'px';
  // restart the fade for each new label: jump to invisible with no transition, then fade in
  t.style.transition = 'none';
  t.classList.remove('on');
  void t.offsetWidth;
  t.style.transition = '';
  t.classList.add('on');
}
function hideTip() {
  clearTimeout(tip.timer);
  const t = $('tip');
  const wasRail = t.classList.contains('rail') && t.classList.contains('on');
  tip.el = null;
  t.classList.remove('on');
  clearTimeout(tip.hideTimer);
  // the sidebar labels fade out quickly (like Discord's); others just disappear
  if (wasRail) tip.hideTimer = setTimeout(() => { if (!tip.el) t.hidden = true; }, 110);
  else t.hidden = true;
}
document.addEventListener('mouseover', e => {
  // the app's own controls (buttons, icons, sliders) get this style: their title="" is turned
  // into one when hovered. Everything else (file names, game names, paths) keeps the normal tooltip.
  const titled = e.target.closest && e.target.closest('[title]');
  if (titled && titled.matches('button, input[type=range], .ibtn, .btn, .chip, .seg label')) {
    const tt = titled.getAttribute('title');
    titled.removeAttribute('title');
    if (tt) titled.dataset.tip = tt; else delete titled.dataset.tip;
  }
  const rail = e.target.closest && (($('libside').classList.contains('collapsed') && e.target.closest('#libside [data-rail-tip]')) || e.target.closest('.qt-rail [data-rail-tip]'));
  if (rail) {
    if (rail === tip.el) return;
    hideTip();
    tip.el = rail;
    showTip(rail, rail.dataset.railTip, rail.closest('.qt-rail') ? 'left' : 'right'); // no delay
    return;
  }
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el === tip.el) return;
  hideTip();
  if (!el) return;
  tip.el = el;
  tip.timer = setTimeout(() => { if (tip.el === el && el.isConnected) showTip(el); }, 250);
});
document.addEventListener('pointerdown', () => { if (tip.el) { const el = tip.el; hideTip(); tip.el = el; } }, true);
window.addEventListener('blur', hideTip);

// ---------- sidebar ----------
applySide();
function applySide() {
  $('library').style.setProperty('--sidew', (L.side.collapsed ? 80 : L.side.w) + 'px');
  $('libside').classList.toggle('collapsed', L.side.collapsed);
  $('sidetoggle').dataset.tip = L.side.collapsed ? 'Open Your Library' : 'Collapse Your Library';
  $('sidetoggle').dataset.tipPos = L.side.collapsed ? 'right' : '';
  if (tip.el === $('sidetoggle')) showTip($('sidetoggle'));
}
$('sidetoggle').onclick = () => { L.side.collapsed = !L.side.collapsed; applySide(); saveLibPrefs(); };

// drag the edge to resize; drag it narrow enough and it collapses
$('sidegrip').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  const grip = $('sidegrip'), left = $('libside').getBoundingClientRect().left;
  grip.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
  const move = ev => {
    const w = ev.clientX - left;
    if (w < 150) { if (!L.side.collapsed) { L.side.collapsed = true; applySide(); } return; }
    L.side.collapsed = false;
    L.side.w = Math.min(460, Math.max(220, Math.round(w)));
    applySide();
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    document.body.classList.remove('resizing');
    saveLibPrefs();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up, { once: true });
  grip.addEventListener('pointercancel', up, { once: true });
});
$('sidegrip').addEventListener('dblclick', () => { L.side.collapsed = false; L.side.w = 300; applySide(); saveLibPrefs(); });

// a game's picture: its icon from Discord's game list, else a frame from its newest clip,
// else its initials
const gameIcons = new Map(); // game name -> icon url or null
function avatar(name, path) {
  if (/^desktop$/i.test(name)) return iconAvatar('monitor', '#2e2d31');
  const a = h('div', 'gav');
  a.style.background = `hsl(${hue(name)} 45% 32%)`;
  a.textContent = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
  const picture = url => { a.textContent = ''; a.style.background = `#222 url("${url}") center/cover`; };
  const thumb = () => {
    if (!path) return;
    const fill = r => { if (r && r.url) picture(r.url); };
    const known = L.thumbs.get(path);
    if (known) fill(known); else T.libThumb(path).then(r => { L.thumbs.set(path, r); fill(r); });
  };
  if (gameIcons.has(name)) { const u = gameIcons.get(name); if (u) picture(u); else thumb(); }
  else T.gameIcon(name).then(u => { gameIcons.set(name, u || null); if (u) picture(u); else thumb(); });
  return a;
}
function iconAvatar(icon, color, img) {
  const a = h('div', 'gav ico-av' + (img ? ' logo ' + img.replace(/^img\/|\.png$/g, '') : ''));
  a.style.background = color;
  if (img) { const i = new Image(); i.src = img; i.alt = ''; i.draggable = false; a.append(i); } else a.append(icoSpan(icon));
  return a;
}

// games among `clips`, newest first
function gamesOf(clips) {
  const m = new Map();
  for (const c of clips) {
    let g = m.get(c.game);
    if (!g) { g = { key: c.game, name: c.gameName, count: 0, latest: 0, latestPath: null }; m.set(c.game, g); }
    g.count++;
    if (c.date > g.latest) { g.latest = c.date; g.latestPath = c.path; }
  }
  return [...m.values()].sort((a, b) => b.latest - a.latest);
}

function renderSide() {
  const d = L.data;
  const head = $('sidetitle'), box = $('games');
  head.replaceChildren();
  box.replaceChildren();
  const row = (key, name, count, av, on, click, title, sub) => {
    const r = h('div', 'game' + (on ? ' on' : ''));
    // collapsed sidebar: the name pops up right next to the picture, straight away (like Discord)
    r.dataset.railTip = name;
    // like Spotify: picture, name, and a quieter line underneath
    const txt = h('div', 'gtext');
    const nm = h('span', 'gname', name);
    nm.title = title || name; // expanded: the full name if it's cut off
    txt.append(nm, h('span', 'gcount', count == null ? '' : `${count} clip${count === 1 ? '' : 's'}${sub ? '  ·  ' + sub : ''}`));
    r.append(av, txt);
    r.onclick = click;
    return r;
  };
  if (L.src === 'all') {
    box.append(row('all', 'All clips', d.clips.length, iconAvatar('grid', '#1a191c'), L.game === 'all',
      () => { L.game = 'all'; saveLibPrefs(); renderSide(); renderGrid(true); navCommit(); }));
    const live = d.folders.filter(f => !f.missing);
    if (live.length) box.append(h('div', 'gsec', 'Folders'));
    for (const f of live) {
      const n = d.clips.filter(c => samePathR(c.root, f.path)).length;
      const look = SRC_LOOK[f.kind];
      box.append(row(f.path, srcLabel(f), n, iconAvatar(look.icon, look.color, look.img), false,
        () => { L.src = f.path; L.game = 'all'; saveLibPrefs(); renderSide(); renderGrid(true); navCommit(); },
        `${srcLabel(f)} - ${f.path} (${n})`, 'Folder'));
    }
    if (!live.length) {
      const b = h('button', 'linkbtn', 'Add a clips folder in Settings');
      b.onclick = () => setPage('settings');
      box.append(b);
    }
    return;
  }
  // inside one folder: its games
  const f = d.folders.find(x => samePathR(x.path, L.src));
  // which folder you're in, under "Your Library"; click it to go back up
  const crumb = h('button', 'crumb');
  crumb.title = 'Back to all folders';
  crumb.append(icoSpan('back'), h('span', 'crumbname', srcLabel(f)));
  crumb.onclick = () => { L.src = 'all'; L.game = 'all'; saveLibPrefs(); renderSide(); renderGrid(true); navCommit(); };
  head.append(crumb);
  const inSrc = d.clips.filter(c => samePathR(c.root, f.path));
  const look = SRC_LOOK[f.kind];
  box.append(row('all', `All ${srcLabel(f)} clips`, inSrc.length, iconAvatar(look.icon, look.color, look.img), L.game === 'all',
    () => { L.game = 'all'; saveLibPrefs(); renderSide(); renderGrid(true); navCommit(); }));
  const games = gamesOf(inSrc);
  if (games.length) box.append(h('div', 'gsec', 'Games'));
  for (const g of games) {
    const r = row(g.key, g.name, g.count, avatar(g.name, g.latestPath), L.game === g.key,
      () => { L.game = g.key; saveLibPrefs(); renderSide(); renderGrid(true); navCommit(); });
    r.addEventListener('contextmenu', e => gameMenu(e, g, f));
    box.append(r);
  }
}

// ---------- grid ----------
const isTrimRoot = p => !!L.data && L.data.folders.some(f => f.kind === 'trimmed' && samePathR(f.path, p));
const inTrimmedFolder = () => L.src !== 'all' && isTrimRoot(L.src);
function scope() {
  const d = L.data;
  let base = d.clips.filter(c => (L.src === 'all' || samePathR(c.root, L.src)) && (L.game === 'all' || c.game === L.game));
  if (inTrimmedFolder()) return base;
  // in NVIDIA/Discord/other folders, a game's trims (from the trimmed folder) can come along
  if (L.src !== 'all' && L.trims !== 'hide') {
    const games = L.game !== 'all' ? new Set([L.game]) : new Set(base.map(c => c.game));
    base = base.concat(d.clips.filter(c => isTrimRoot(c.root) && games.has(c.game)));
  }
  if (L.trims === 'hide') base = base.filter(c => c.kind !== 'trim');
  else if (L.trims === 'only') base = base.filter(c => c.kind === 'trim');
  return base;
}
function filtered(base) {
  const q = L.q.trim().toLowerCase();
  let list = base.filter(c => L.kind === 'all' || c.kind === L.kind);
  if (q) list = list.filter(c => (c.gameName + ' ' + c.name + ' ' + c.sub).toLowerCase().includes(q));
  const dur = c => { const t = L.thumbs.get(c.path); return (t && t.duration) || c.duration || 0; };
  const by = {
    new: (a, b) => b.date - a.date,
    old: (a, b) => a.date - b.date,
    long: (a, b) => dur(b) - dur(a) || b.date - a.date,
    big: (a, b) => b.size - a.size,
  }[L.sort] || ((a, b) => b.date - a.date);
  return list.sort(by);
}

function renderGrid(resetScroll) {
  const d = L.data;
  if (!d) return;
  const f = L.src === 'all' ? null : d.folders.find(x => samePathR(x.path, L.src));
  const base = scope();
  const g = L.game === 'all' ? null : base[0] || d.clips.find(c => c.game === L.game);
  $('libname').textContent = g ? g.gameName : f ? `All ${srcLabel(f)} clips` : 'All clips';
  // the game's (or folder's) picture next to the title, like Discord
  const hk = g ? 'g:' + g.game : f ? 'f:' + f.path : 'all';
  if ($('libicon').dataset.k !== hk) {
    $('libicon').dataset.k = hk;
    const look = f ? SRC_LOOK[f.kind] : null;
    $('libicon').replaceChildren(g ? avatar(g.gameName, (gamesOf(base)[0] || {}).latestPath)
      : look ? iconAvatar(look.icon, look.color, look.img) : iconAvatar('grid', '#1a191c'));
  }
  $('libwhere').textContent = g && f ? srcLabel(f) : '';
  // type chips: only the kinds that are here
  const chips = $('libkinds');
  chips.replaceChildren();
  const have = new Set(base.map(c => c.kind));
  if (L.kind !== 'all' && !have.has(L.kind)) L.kind = 'all';
  // only worth showing when there's more than one kind to pick between
  if (KINDS.filter(([k]) => k !== 'all' && have.has(k)).length < 2) L.kind = 'all';
  else {
    for (const [k, label] of KINDS) {
      if (k !== 'all' && !have.has(k)) continue;
      const c = h('button', 'chip' + (L.kind === k ? ' on' : ''), label);
      c.onclick = () => { L.kind = k; saveLibPrefs(); renderGrid(true); };
      chips.append(c);
    }
  }
  $('sorttext').textContent = (SORTS.find(x => x[0] === L.sort) || SORTS[0])[1];
  $('trimbtn').hidden = inTrimmedFolder();
  $('trimtext').textContent = (TRIMS.find(x => x[0] === L.trims) || TRIMS[1])[2];

  L.list = filtered(base);
  const here = new Set(L.list.map(c => c.path));
  for (const p of [...L.sel]) if (!here.has(p)) L.sel.delete(p);
  L.anchor = -1;
  queueMicrotask(showSel);
  const total = L.list.reduce((s, c) => s + c.size, 0);
  $('libcount').textContent = `${L.list.length} clip${L.list.length === 1 ? '' : 's'}  ·  ${fmtSize(total)}`;
  stopPreview();
  const box = $('libgrid');
  const keep = resetScroll ? 0 : $('libscroll').scrollTop;
  const want = resetScroll ? 60 : Math.max(60, L.shown);
  box.replaceChildren();
  L.shown = 0; L.lastMonth = null; L.cards = null;
  if (!d.folders.some(x => !x.missing)) return libEmpty("Couldn't find a clips folder. Add the folder your clips are saved in.", true);
  if (!d.clips.length) return libEmpty('No clips in your folders yet.', true);
  if (!L.list.length) return libEmpty(L.q ? `No clips match "${L.q}".` : 'No clips here.');
  showMore(want, true);
  $('libscroll').scrollTop = keep;
}

// cards are added in batches as you scroll
function showMore(n = 60, fresh) {
  const box = $('libgrid');
  const byDate = (L.sort === 'new' || L.sort === 'old') && L.months;
  const end = Math.min(L.list.length, L.shown + n);
  const t0 = performance.now(), first = L.shown;
  for (let i = L.shown; i < end; i++) {
    const c = L.list[i];
    const month = byDate ? fmtMonth(c.date) : '';
    if (!L.cards || month !== L.lastMonth) {
      if (byDate) box.append(h('h4', 'month', month));
      L.cards = h('div', 'cards');
      box.append(L.cards);
      L.lastMonth = month;
    }
    // only what's on screen when a folder opens waves in; everything further down is simply
    // there by the time you scroll to it
    const wave = fresh && i - first < 15;
    const el = card(c, wave);
    if (wave) el._waveAt = t0 + (i - first) * 45; // 45 ms apart
    L.cards.append(el);
  }
  L.shown = end;
  let s = $('libmore');
  if (s) s.remove();
  if (L.shown < L.list.length) { s = h('div'); s.id = 'libmore'; box.append(s); moreObs.observe(s); }
  backgroundThumbs();
}
const moreObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) showMore(); }, { root: $('libscroll'), rootMargin: '2000px' });
$('libscroll').addEventListener('scroll', hideMenu, { passive: true });

function loadThumb(el) {
  if (el._thumbing) return Promise.resolve();
  el._thumbing = true;
  thumbObs.unobserve(el);
  const c = el._clip, known = L.thumbs.get(c.path);
  if (known) { paintCard(el, known); return Promise.resolve(); }
  return T.libThumb(c.path).then(r => { L.thumbs.set(c.path, r); paintCard(el, r); });
}
const thumbObs = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) loadThumb(e.target);
}, { root: $('libscroll'), rootMargin: '1600px 0px' }); // load pictures well before they scroll into view
// and keep loading the rest in the background, in order, so nothing is blank when you get there
let bgThumbs = 0;
function backgroundThumbs() {
  const run = ++bgThumbs;
  const next = () => {
    if (run !== bgThumbs) return;
    const el = [...$('libgrid').querySelectorAll('.clip')].find(x => !x._thumbing);
    if (!el) return;
    loadThumb(el).then(() => (window.requestIdleCallback ? requestIdleCallback(next, { timeout: 300 }) : setTimeout(next, 16)));
  };
  setTimeout(next, 600); // after the first screen has had its turn
}

// scrolling: no hover effects or previews on the cards sliding under the mouse - they made it stutter
let scrollIdle = null;
$('libscroll').addEventListener('scroll', () => {
  const g = $('libgrid');
  if (!g.classList.contains('scrolling')) {
    g.classList.add('scrolling');
    if (!preview.dragging) stopPreview();
  }
  clearTimeout(scrollIdle);
  scrollIdle = setTimeout(() => {
    g.classList.remove('scrolling');
    // the card that ended up under the mouse gets its preview, same as hovering it
    const el = document.elementFromPoint(mouseAt.x, mouseAt.y);
    const cardEl = el && el.closest && el.closest('#libgrid .clip');
    if (cardEl && cardEl !== preview.el) schedulePreview(cardEl, cardEl._clip);
  }, 160);
}, { passive: true });
const mouseAt = { x: -1, y: -1 };
window.addEventListener('pointermove', e => { mouseAt.x = e.clientX; mouseAt.y = e.clientY; }, { passive: true });

function card(c, wave) {
  // starts as a dark placeholder; fades in once its picture is ready (paintCard)
  const el = h('div', 'clip' + (wave ? ' loading' : '') + (L.sel.has(c.path) ? ' sel' : ''));
  el._clip = c;
  el.tabIndex = 0;
  el.append(h('div', 'ph'), h('div', 'shade2'));
  const chk = h('button', 'cchk');
  chk.title = 'Select (Ctrl+click)';
  chk.append(icoSpan('check'));
  chk.onclick = e => { e.stopPropagation(); toggleSel(c, e.shiftKey); };
  el.append(chk);
  if (KIND_BADGE[c.kind] || c.origin) {
    const b = h('span', 'ckind');
    if (c.origin) { const t = h('span', 'csrc ' + c.origin), i = new Image(); i.src = SRC_LOOK[c.origin].img; i.alt = ''; i.draggable = false; t.append(i); b.append(t); }
    b.append(h('span', '', KIND_BADGE[c.kind] || SRC_LOOK[c.origin].label));
    el.append(b);
  }
  const acts = h('div', 'cact');
  const more = h('button', 'cbtn'); more.title = 'More'; more.append(icoSpan('more'));
  more.onclick = e => { e.stopPropagation(); const r = more.getBoundingClientRect(); showMenu(r.right - 8, r.bottom + 4, c, el); };
  const del = h('button', 'cbtn'); del.title = 'Delete'; del.append(icoSpan('trash'));
  del.onclick = e => { e.stopPropagation(); trashClips(L.sel.has(c.path) ? selected() : [c]); };
  acts.append(more, del);
  el.append(acts);
  // bottom: title, then a line that fades away on hover while the seek bar and buttons slide up
  const bottom = h('div', 'cbottom');
  bottom.append(h('div', 'ctitle', fmtWhen(c.date)));
  const subrow = h('div', 'csubrow');
  const sub = [L.game === 'all' ? c.gameName : '', c.sub, fmtSize(c.size)].filter(Boolean).join('  ·  ');
  const durEl = h('span', 'cdur');
  subrow.append(h('span', 'csub', sub), durEl);
  setLength(durEl, c);
  bottom.append(subrow);
  const hb = h('div', 'hbar');
  const trk = h('div', 'trk'); trk.append(h('div', 'fill'));
  trk.addEventListener('pointerdown', e => { e.stopPropagation(); seekPreview(el, c, e); });
  trk.onclick = e => e.stopPropagation();
  const btns = h('div', 'cbtns');
  const edit = h('button', 'hbtn'); edit.append(icoSpan('scissors'), h('span', '', 'Trim'));
  edit.onclick = e => { e.stopPropagation(); openQuickTrim(c, el); };
  const copy = h('button', 'hbtn primary'); copy.append(icoSpan('copy'), h('span', '', 'Copy Video'));
  copy.title = 'Copy the file, then paste it into Discord with Ctrl+V';
  copy.onclick = e => { e.stopPropagation(); copyClips([c]); };
  btns.append(edit, copy);
  hb.append(trk, btns);
  bottom.append(hb);
  el.append(bottom);
  el.onclick = e => {
    if (e.ctrlKey || e.metaKey) toggleSel(c);
    else if (e.shiftKey) toggleSel(c, true);
    else if (L.sel.size) toggleSel(c);
    else openQuickTrim(c, el);
  };
  el.addEventListener('keydown', e => { if (e.key === 'Enter') openQuickTrim(c, el); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); showMenu(e.clientX, e.clientY, c, el); });
  el.addEventListener('mouseenter', () => schedulePreview(el, c));
  el.addEventListener('mouseleave', () => { if (preview.el === el && !preview.dragging) stopPreview(); clearTimeout(preview.timer); });
  thumbObs.observe(el);
  return el;
}

// ---------- saved trims on cards ----------
// the part of the clip that's kept (whole clip when it hasn't been trimmed)
const trimOf = c => {
  const e = c.edit, d = c.duration || (e && e.dur) || 0;
  if (!e || !d || (e.in <= 0.01 && e.out >= d - 0.01)) return null;
  return { a: Math.max(0, e.in), b: Math.min(d, e.out) };
};
const showLength = (el, c) => setLength(el.querySelector('.cdur'), c);
function setLength(d, c) {
  if (!d) return;
  const t = trimOf(c);
  d.replaceChildren();
  if (t) { d.append(icoSpan('scissors'), document.createTextNode(fmtLen(t.b - t.a))); d.title = `Trimmed from ${fmtLen(c.duration)}`; }
  else { d.textContent = c.duration ? fmtLen(c.duration) : ''; d.removeAttribute('title'); }
}
function updateCardEdit(c) {
  for (const el of document.querySelectorAll('#libgrid .clip')) if (el._clip === c) showLength(el, c);
}

// ---------- selecting ----------
const selected = () => L.list.filter(c => L.sel.has(c.path));
function toggleSel(c, range) {
  const i = L.list.indexOf(c);
  if (range && L.anchor >= 0 && i >= 0) {
    const [a, b] = L.anchor < i ? [L.anchor, i] : [i, L.anchor];
    for (let k = a; k <= b; k++) L.sel.add(L.list[k].path);
  } else {
    if (L.sel.has(c.path)) L.sel.delete(c.path); else L.sel.add(c.path);
    L.anchor = i;
  }
  showSel();
}
function selectAll() { for (const c of L.list) L.sel.add(c.path); showSel(); }
function clearSel() { L.sel.clear(); L.anchor = -1; showSel(); }
function showSel() {
  for (const el of document.querySelectorAll('#libgrid .clip')) el.classList.toggle('sel', L.sel.has(el._clip.path));
  const list = selected();
  $('libgrid').classList.toggle('selecting', list.length > 0);
  $('selbar').hidden = !list.length;
  $('libtools').hidden = !!list.length;
  if (list.length) $('seltext').textContent = `${list.length} selected  ·  ${fmtSize(list.reduce((s, c) => s + c.size, 0))}`;
}
$('selall').onclick = selectAll;
$('selcopy').onclick = () => copyClips(selected());
$('seldel').onclick = () => trashClips(selected());
$('selclear').onclick = clearSel;

async function copyClips(list) {
  if (!list.length) return;
  // trimmed clips (or ones with audio changes) are made into new files first, like Discord does
  const sizes = new Map(), paths = [];
  const edited = list.filter(c => c.edit);
  if (edited.length) libToast(edited.length === 1 && list.length === 1 ? 'Making the trimmed clip...' : `Making ${edited.length} trimmed clip${edited.length === 1 ? '' : 's'}...`);
  for (const c of list) {
    if (!c.edit) { paths.push(c.path); sizes.set(c.path, c.size); continue; }
    const x = await qtExportSaved(c, 'temp');
    if (!x.ok) return libToast(x.error, 'err');
    paths.push(x.out); sizes.set(x.out, x.size);
  }
  const r = await T.copyFiles(paths);
  if (!r.ok) return libToast(r.error, 'err');
  const big = paths.filter(p => sizes.get(p) > 10 * 1048576).length;
  const what = list.length === 1 ? 'Copied' : `Copied ${list.length} clips`;
  libToast(big ? `${what}. ${big === 1 && list.length === 1 ? `It's ${fmtSize(sizes.get(paths[0]))}, so` : `${big} of them are over 10 MB, so`} Discord needs Nitro to send ${big === 1 ? 'it' : 'them'}.` : `${what}. Paste into Discord with Ctrl+V.`);
}

// cards fade in one after another in reading order (a wave), however the pictures happen to load
const showCard = el => {
  const wait = Math.max(0, (el._waveAt || 0) - performance.now());
  setTimeout(() => requestAnimationFrame(() => el.classList.remove('loading')), wait);
};
function paintCard(el, r) {
  if (r && r.url) {
    const img = h('img');
    img.alt = '';
    img.decoding = 'async';
    img.onerror = () => { img.remove(); el.classList.add('noimg'); showCard(el); };
    img.src = r.url;
    el.prepend(img);
    // only fade in once the picture is decoded, so it never pops in half-drawn
    (img.decode ? img.decode() : Promise.resolve()).then(() => { img.decoding = 'sync'; showCard(el); }, () => {});
  } else if (r && r.error && !r.triedPlayer) {
    // ffmpeg couldn't read it; the built-in player often can, so take the frame from there
    r.triedPlayer = true;
    playerThumb(el._clip).then(x => {
      if (x && x.url) { L.thumbs.set(el._clip.path, x); paintCard(el, x); } else paintCard(el, r);
    });
  } else {
    el.classList.add('noimg');
    el.querySelector('.ph').textContent = r && r.error ? "Can't preview this file" : '';
    showCard(el);
  }
  const c = el._clip;
  if (r && r.duration && !c.duration) { c.duration = r.duration; showLength(el, c); }
}

// one at a time: load the clip in a hidden player, grab a frame about a third in, save it
let playerQueue = Promise.resolve();
function playerThumb(c) {
  const job = playerQueue.then(() => new Promise(resolve => {
    const vid = document.createElement('video');
    vid.muted = true; vid.preload = 'auto';
    let done = false;
    const finish = x => { if (done) return; done = true; clearTimeout(timer); vid.removeAttribute('src'); vid.load(); resolve(x); };
    const timer = setTimeout(() => finish(null), 8000);
    vid.addEventListener('error', () => finish(null));
    vid.addEventListener('loadedmetadata', () => { vid.currentTime = isFinite(vid.duration) && vid.duration > 1 ? vid.duration * 0.3 : 0; });
    vid.addEventListener('seeked', async () => {
      try {
        const w = 480, ht = Math.round(w * (vid.videoHeight || 270) / (vid.videoWidth || 480));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = ht;
        cv.getContext('2d').drawImage(vid, 0, 0, w, ht);
        finish(await T.libSaveThumb(c.path, cv.toDataURL('image/jpeg', 0.8), vid.duration));
      } catch (e) { finish(null); }
    }, { once: true });
    vid.src = c.url;
  }));
  playerQueue = job.catch(() => null);
  return job;
}

async function openClip(c, el) {
  if (exporting) return;
  el && el.classList.add('opening');
  const r = await T.open(c.path);
  el && el.classList.remove('opening');
  if (!r.ok) return libToast(r.error, 'err');
  handle(r);
}

// ---------- hover preview ----------
const preview = { el: null, video: null, timer: null };
function schedulePreview(el, c) {
  clearTimeout(preview.timer);
  if ($('libgrid').classList.contains('scrolling')) return;
  preview.timer = setTimeout(() => startPreview(el, c), 120);
}
function startPreview(el, c) {
  stopPreview();
  if (!el.isConnected || page !== 'lib') return;
  const vid = h('video');
  vid.muted = true; vid.playsInline = true; vid.loop = true; vid.preload = 'auto';
  // Big clips are read from the drive as they play; the first time, the first frame shows up
  // well before the rest is buffered, so the picture would stall and jump. Wait until the
  // browser says it can keep playing, and only show the video once it has really drawn a few
  // frames in a row - until then the thumbnail stays up.
  vid.addEventListener('loadedmetadata', () => {
    if (preview.dragging) return; // the seek bar is being held; it decides where to start
    vid.currentTime = trimOf(c) ? trimOf(c).a : 0; // every hover starts from the beginning (of the trim)
  }, { once: true });
  let started = false;
  const go = () => {
    if (started || preview.video !== vid || preview.dragging) return;
    started = true;
    vid.play().catch(() => { /* ignore */ });
    if (vid.requestVideoFrameCallback) {
      let frames = 0;
      const seen = () => { if (preview.video !== vid) return; if (++frames >= 3) vid.classList.add('on'); else vid.requestVideoFrameCallback(seen); };
      vid.requestVideoFrameCallback(seen);
    } else vid.addEventListener('playing', () => setTimeout(() => vid.classList.add('on'), 120), { once: true });
  };
  vid.addEventListener('canplaythrough', go);
  // some files never report "can play through" (long recordings on a slow drive); don't wait forever
  vid.addEventListener('canplay', () => setTimeout(go, 700));
  vid.src = c.url;
  el.insertBefore(vid, el.querySelector('.shade2'));
  preview.el = el; preview.video = vid;
  const fill = el.querySelector('.fill');
  const tick = () => {
    if (preview.video !== vid) { fill.style.width = '0'; return; }
    const t = trimOf(c);
    if (t && !preview.dragging && !vid.seeking && (vid.currentTime >= t.b || vid.currentTime < t.a - 0.3)) vid.currentTime = t.a; // loop the kept part
    const a = t ? t.a : 0, b = t ? t.b : vid.duration;
    if (vid.duration && !preview.dragging) fill.style.width = Math.min(100, Math.max(0, (vid.currentTime - a) / (b - a) * 100)) + '%';
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// click or drag on the seek bar: while held, the preview pauses and only the knob follows the
// mouse; letting go jumps there once and plays on
function seekPreview(el, c, e) {
  const trk = el.querySelector('.trk'), fill = el.querySelector('.fill');
  if (preview.el !== el) startPreview(el, c);
  const vid = preview.video;
  if (!vid) return;
  let f = 0;
  const at = ev => {
    const r = trk.getBoundingClientRect();
    f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
    fill.style.width = (f * 100) + '%';
  };
  preview.dragging = true;
  el.classList.add('scrubbing');
  vid.pause();
  at(e);
  trk.setPointerCapture(e.pointerId);
  const move = ev => at(ev);
  const done = () => {
    trk.removeEventListener('pointermove', move);
    preview.dragging = false;
    el.classList.remove('scrubbing');
    if (preview.video !== vid) return;
    const go = () => { const t = trimOf(c); vid.currentTime = t ? t.a + f * (t.b - t.a) : f * vid.duration; vid.play().catch(() => { /* ignore */ }); vid.classList.add('on'); };
    if (vid.duration) go(); else vid.addEventListener('loadedmetadata', go, { once: true });
    if (!el.matches(':hover')) stopPreview(); // let go outside the card
  };
  trk.addEventListener('pointermove', move);
  trk.addEventListener('pointerup', done, { once: true });
  trk.addEventListener('pointercancel', done, { once: true });
}
function stopPreview() {
  clearTimeout(preview.timer);
  const vid = preview.video;
  if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); vid.remove(); }
  preview.el = preview.video = null;
  preview.dragging = false;
}

// ---------- right-click menu ----------
function openMenu(x, y, items, alignRight) {
  stopPreview();
  const m = $('ctxmenu');
  m.replaceChildren();
  m.dataset.for = '';
  for (const it of items) {
    if (it === '-') { m.append(h('div', 'msep')); continue; }
    const b = h('button', it.cls || ''); b.append(icoSpan(it.icon), h('span', '', it.text));
    b.onclick = () => { hideMenu(); it.run(); };
    m.append(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  if (alignRight) x -= r.width;
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
function showMenu(x, y, c, el) {
  const many = L.sel.has(c.path) && L.sel.size > 1 ? selected() : null;
  if (many) {
    openMenu(x, y, [
      { icon: 'copy', text: `Copy ${many.length} Videos`, run: () => copyClips(many) },
      '-',
      { icon: 'trash', text: `Delete ${many.length} Videos`, run: () => trashClips(many), cls: 'danger' },
    ]);
    return;
  }
  openMenu(x, y, [
    { icon: 'copy', text: 'Copy Video', run: () => copyClips([c]) },
    { icon: 'scissors', text: 'Quick trim', run: () => openQuickTrim(c, el) },
    { icon: 'edit', text: 'Edit', run: () => openClip(c, el) },
    '-',
    { icon: 'folder', text: 'Show in Folder', run: () => T.libAction('reveal', c.path) },
    '-',
    { icon: 'trash', text: 'Delete', run: () => trashClips([c]), cls: 'danger' },
  ]);
}
const MENU_BUTTONS = ['libsort', 'trimbtn', 'qtsavemenu', 'qtcopymenu', 'qtmore', 'qtrmore']; // buttons that open a menu; clicking one again closes it
function hideMenu() { $('ctxmenu').hidden = true; for (const id of MENU_BUTTONS) { const b = $(id); if (b) b.classList.remove('open'); } }
document.addEventListener('pointerdown', e => { if (!$('ctxmenu').contains(e.target) && !e.target.closest(MENU_BUTTONS.map(id => '#' + id).join(', '))) hideMenu(); });
window.addEventListener('blur', hideMenu);

// everything goes to the Recycle Bin, and main asks first
function closeTabsUnder(paths, dirs) {
  const inside = p => paths.some(x => samePathR(x, p)) || dirs.some(d => String(p).toLowerCase().startsWith(String(d).toLowerCase() + (d.includes('\\') ? '\\' : '/')));
  for (const t of tabs.slice()) if (t.info && inside(t.info.path)) closeTab(t);
}
function afterTrash(r, what) {
  if (!r.ok) { libToast(r.error, 'err'); return false; }
  if (r.cancelled) return false;
  const gone = new Set((r.trashed || []).map(p => p.toLowerCase()));
  const under = p => [...gone].some(g => p.toLowerCase() === g || p.toLowerCase().startsWith(g + '\\') || p.toLowerCase().startsWith(g + '/'));
  L.data.clips = L.data.clips.filter(c => !under(c.path));
  for (const p of [...L.sel]) if (under(p)) L.sel.delete(p);
  renderLibrary();
  showSel();
  if (r.failed && r.failed.length) libToast(`Couldn't delete: ${r.failed.join('; ')}`, 'err');
  else libToast(`Moved ${what} to the Recycle Bin.`);
  return true;
}
// ---------- confirm before deleting (styled like Discord's); hold Shift to skip it ----------
let shiftHeld = false;
window.addEventListener('keydown', e => { if (e.key === 'Shift') shiftHeld = true; }, true);
window.addEventListener('keyup', e => { if (e.key === 'Shift') shiftHeld = false; }, true);
window.addEventListener('blur', () => { shiftHeld = false; });

function confirmBox({ title, body, ok = 'Delete', danger = true }) {
  return new Promise(resolve => {
    hideTip(); hideMenu();
    const ov = h('div', 'modal-ov'), box = h('div', 'modal');
    const x = h('button', 'modal-x'); x.append(icoSpan('x')); x.setAttribute('aria-label', 'Close');
    const row = h('div', 'modal-btns');
    const cancel = h('button', 'mbtn', 'Cancel'), go = h('button', 'mbtn ' + (danger ? 'danger' : 'primary'), ok);
    row.append(cancel, go);
    box.append(x, h('h2', '', title), h('p', '', body), row);
    ov.append(box);
    document.body.append(ov);
    requestAnimationFrame(() => ov.classList.add('on'));
    const done = v => {
      document.removeEventListener('keydown', key, true);
      ov.classList.remove('on');
      setTimeout(() => ov.remove(), 160);
      resolve(v);
    };
    const key = e => {
      e.stopPropagation(); // the app's own shortcuts wait while this is open
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); done(true); }
    };
    document.addEventListener('keydown', key, true);
    cancel.onclick = () => done(false);
    x.onclick = () => done(false);
    go.onclick = () => done(true);
    ov.addEventListener('pointerdown', e => { if (e.target === ov) done(false); });
    go.focus();
  });
}

async function trashClips(list) {
  if (!list.length || exporting) return;
  stopPreview();
  const n = list.length, size = fmtSize(list.reduce((s, c) => s + c.size, 0));
  if (!shiftHeld && !(await confirmBox({
    title: n === 1 ? 'Delete this clip?' : `Delete ${n} clips?`,
    body: n === 1 ? `This moves the clip (${size}) to the Recycle Bin, so you can still get it back. Hold Shift to delete without asking.`
      : `This moves ${n} clips (${size}) to the Recycle Bin, so you can still get them back. Hold Shift to delete without asking.`,
  }))) return;
  const paths = list.map(c => c.path);
  closeTabsUnder(paths, []);
  afterTrash(await T.libTrash(paths, true), n === 1 ? 'the clip' : `${n} clips`);
}

// right-click a game in the sidebar: its folder(s), or (Discord, no folders) its clips
function gameMenu(e, g, f) {
  e.preventDefault();
  const clips = L.data.clips.filter(c => c.game === g.key && samePathR(c.root, f.path));
  const sep = f.path.includes('\\') ? '\\' : '/';
  const dirs = new Set();
  let loose = 0;
  for (const c of clips) {
    const rel = c.path.slice(f.path.replace(/[\\/]+$/, '').length + 1);
    const parts = rel.split(/[\\/]/);
    if (parts.length > 1) dirs.add(f.path.replace(/[\\/]+$/, '') + sep + parts[0]); else loose++;
  }
  const items = [];
  if (dirs.size) items.push({ icon: 'folder', text: 'Open folder', run: () => T.libAction('reveal-folder', [...dirs][0]) });
  items.push({ icon: 'check', text: `Select all ${clips.length} clips`, run: () => {
    if (L.game !== g.key) { L.game = g.key; saveLibPrefs(); renderSide(); renderGrid(true); navCommit(); }
    selectAll();
  } });
  items.push('-');
  if (dirs.size && !loose) {
    items.push({ icon: 'trash', cls: 'danger', text: `Delete folder${dirs.size > 1 ? 's' : ''}`, run: async () => {
      if (!shiftHeld) {
        const st = await T.libFolderStats([...dirs]);
        if (!st.ok) return libToast(st.error, 'err');
        const what = [`${st.videos} video${st.videos === 1 ? '' : 's'}`];
        if (st.other) what.push(`${st.other} other file${st.other === 1 ? '' : 's'} (screenshots and such)`);
        if (!(await confirmBox({
          title: `Delete the ${g.name} folder${dirs.size > 1 ? 's' : ''}?`,
          body: `Everything in it goes to the Recycle Bin: ${what.join(' and ')}, ${fmtSize(st.bytes)}. You can still get it back from there.`,
        }))) return;
      }
      closeTabsUnder([], [...dirs]);
      if (afterTrash(await T.libTrashFolders([...dirs], g.name, true), `the ${g.name} folder${dirs.size > 1 ? 's' : ''}`) && L.game === g.key) {
        L.game = 'all'; saveLibPrefs(); renderSide(); renderGrid(true);
      }
    } });
  } else {
    items.push({ icon: 'trash', cls: 'danger', text: `Delete all ${clips.length} clips`, run: () => trashClips(clips) });
  }
  openMenu(e.clientX, e.clientY, items);
}

let toastTimer = null;
function libToast(text, cls) {
  const t = $('libtoast');
  t.textContent = text;
  t.className = 'show' + (cls ? ' ' + cls : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, cls === 'err' ? 7000 : 3500);
}

// ---------- toolbar ----------
let searchTimer = null;
$('libsearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { L.q = $('libsearch').value; if (L.data) renderGrid(true); }, 120);
});
// trimmed clips: shown with the rest, hidden, or on their own
const TRIMS = [['show', 'Show trimmed clips', 'Trimmed: shown'], ['hide', 'Hide trimmed clips', 'Trimmed: hidden'], ['only', 'Only trimmed clips', 'Only trimmed']];
$('trimbtn').onclick = e => {
  e.stopPropagation();
  const m = $('ctxmenu');
  if (!m.hidden && m.dataset.for === 'trims') { hideMenu(); return; }
  const r = $('trimbtn').getBoundingClientRect();
  openMenu(r.right, r.bottom + 6, TRIMS.map(([k, label]) => ({
    icon: L.trims === k ? 'check' : 'blank', text: label, cls: L.trims === k ? 'cur' : '',
    run: () => { L.trims = k; saveLibPrefs(); renderGrid(true); },
  })), true);
  m.dataset.for = 'trims';
  $('trimbtn').classList.add('open');
};
// sort menu: a button like Discord's "Recent" that opens a small menu with a check on the current choice
const SORTS = [['new', 'Newest'], ['old', 'Oldest'], ['long', 'Longest'], ['big', 'Largest']];
$('libsort').onclick = e => {
  e.stopPropagation();
  const m = $('ctxmenu');
  if (!m.hidden && m.dataset.for === 'sort') { hideMenu(); return; }
  const r = $('libsort').getBoundingClientRect();
  openMenu(r.right, r.bottom + 6, SORTS.map(([k, label]) => ({
    icon: L.sort === k ? 'check' : 'blank', text: label, cls: L.sort === k ? 'cur' : '',
    run: () => { L.sort = k; saveLibPrefs(); renderGrid(true); },
  })).concat(L.sort === 'new' || L.sort === 'old' ? ['-', {
    icon: L.months ? 'check' : 'blank', text: 'Separate by month', cls: L.months ? 'cur' : '',
    run: () => { L.months = !L.months; saveLibPrefs(); renderGrid(); },
  }] : []), true);
  m.dataset.for = 'sort';
  $('libsort').classList.add('open');
};

// keys while the library or settings is showing
function libKey(e) {
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (e.altKey && (k === 'arrowleft' || k === 'arrowright')) { e.preventDefault(); navInput(k === 'arrowleft' ? -1 : 1, true); return true; }
  if (page !== 'lib') { if (k === 'escape') { navInput(-1, true); return true; } return false; }
  if (ctrl && k === 'f') { e.preventDefault(); $('libsearch').focus(); $('libsearch').select(); return true; }
  const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT';
  if (!typing && ctrl && k === 'a') { e.preventDefault(); selectAll(); return true; }
  if (!typing && k === 'delete') {
    e.preventDefault();
    if (L.sel.size) trashClips(selected());
    else if (document.activeElement && document.activeElement._clip) trashClips([document.activeElement._clip]);
    else if (preview.el) trashClips([preview.el._clip]);
    return true;
  }
  if (k === 'escape') {
    if (!$('ctxmenu').hidden) hideMenu();
    else if (L.sel.size) clearSel();
    else if ($('libsearch').value) { $('libsearch').value = ''; L.q = ''; renderGrid(true); }
    else if (L.src !== 'all' || L.game !== 'all') navInput(-1, true);
    return true;
  }
  return false;
}

// ---------- settings ----------
async function renderSettings() {
  const r = await T.settingsGet();
  const box = $('setbody');
  box.replaceChildren();
  if (!r.ok) { box.append(h('div', 'setnote', r.error)); return; }
  const section = (title, note) => {
    const s = h('section', 'setsec');
    s.append(h('h3', '', title));
    if (note) s.append(h('p', 'setnote', note));
    box.append(s);
    return s;
  };
  const after = async fn => { const x = await fn(); if (x && !x.ok) libToast(x.error, 'err'); L.dirty = true; L.thumbs.clear(); renderSettings(); };

  // clip folders
  const fs = section('Clip folders', 'Where the Clips page looks. NVIDIA and Discord folders are found automatically; removing one only hides it, nothing is deleted.');
  const list = h('div', 'setcard');
  for (const f of r.folders) {
    const row = h('div', 'setrow');
    const look = SRC_LOOK[f.kind];
    const txt = h('div', 'settext');
    const name = h('div', 'setname', srcLabel(f));
    if (f.missing) name.append(h('small', 'bad', '  not found'));
    txt.append(name, h('div', 'setpath', f.path));
    const open = h('button', 'btn sm ghost', 'Open');
    open.disabled = f.missing;
    open.onclick = async () => { const x = await T.libOpenFolder(f.path); if (!x.ok) libToast(x.error, 'err'); };
    const rm = h('button', 'btn sm ghost', f.kind === 'trimmed' ? 'Change' : 'Remove');
    rm.onclick = () => after(() => (f.kind === 'trimmed' ? T.exportPickDir() : T.libRemoveFolder(f.path)));
    row.append(iconAvatar(look.icon, look.color, look.img), txt, open, rm);
    list.append(row);
  }
  if (!r.folders.length) list.append(h('div', 'setnote pad', 'No folders yet.'));
  fs.append(list);
  const btns = h('div', 'setbtns');
  const add = h('button', 'btn sm'); add.append(icoSpan('plus'), document.createTextNode('Add folder'));
  add.onclick = () => after(() => T.libAddFolder());
  btns.append(add);
  if (r.custom && r.detected.length) {
    const reset = h('button', 'btn sm ghost', 'Use the detected folders');
    reset.title = r.detected.join('\n');
    reset.onclick = () => after(() => T.libResetFolders());
    btns.append(reset);
  }
  fs.append(btns);

  // trimmed clips
  const xs = section('Trimmed clips', 'Exports are saved here, in a folder for each game, so your NVIDIA and Discord folders stay just your recordings. They show up as "Trimmed" in the sidebar. Save as still lets you put one anywhere.');
  const xc = h('div', 'setcard');
  const xrow = h('div', 'setrow');
  const xt = h('div', 'settext');
  xt.append(h('div', 'setname', folderName(r.exportDir)), h('div', 'setpath', r.exportDir));
  const xo = h('button', 'btn sm ghost', 'Open');
  xo.onclick = async () => { const x = await T.exportOpenDir(); if (!x.ok) libToast(x.error, 'err'); };
  const xch = h('button', 'btn sm ghost', 'Change');
  xch.onclick = () => after(() => T.exportPickDir());
  xrow.append(iconAvatar('scissors', '#1f8b4c'), xt, xo, xch);
  xc.append(xrow);
  const mrow = h('div', 'setrow');
  const mt = h('div', 'settext', 'Looking for older trims...');
  mrow.append(mt);
  xc.append(mrow);
  xs.append(xc);
  T.oldTrims().then(o => {
    if (!o.ok || !o.count) { mt.replaceChildren(h('div', 'setname', 'No trimmed clips left in your other folders')); return; }
    mt.replaceChildren(h('div', 'setname', `${o.count} older trimmed clip${o.count === 1 ? '' : 's'} next to the originals`),
      h('div', 'setpath', `${fmtSize(o.bytes)}. Move them into the trimmed folder so they're all in one place.`));
    const mv = h('button', 'btn sm', 'Move them');
    mv.onclick = async () => {
      if (!(await confirmBox({ title: `Move ${o.count} trimmed clip${o.count === 1 ? '' : 's'}?`, body: `They go into ${r.exportDir}, sorted by game. Nothing is deleted.`, ok: 'Move', danger: false }))) return;
      mv.disabled = true; mv.textContent = 'Moving...';
      const y = await T.moveOldTrims();
      if (!y.ok) libToast(y.error, 'err');
      else libToast(y.failed.length ? `Moved ${y.moved}. Couldn't move: ${y.failed.join('; ')}` : `Moved ${y.moved} trimmed clip${y.moved === 1 ? '' : 's'}.`, y.failed.length ? 'err' : '');
      L.dirty = true; L.thumbs.clear(); renderSettings();
    };
    mrow.append(mv);
  });

  // Discord account
  const ds = section('Your Discord account', 'Used to label your own voice "You" in Discord clips. Found automatically from the clips you saved; set it here if it picks the wrong person.');
  const card = h('div', 'setcard');
  const row = h('div', 'setrow');
  const txt = h('div', 'settext');
  const cur = r.discordIdManual || r.discordIdDetected;
  txt.append(h('div', 'setname', cur ? `User ID ${cur}` : 'Not found yet'),
    h('div', 'setpath', r.discordIdManual ? 'Set by you' : r.discordIdDetected ? 'Detected from your clips' : 'Open a few Discord clips or add your Discord clips folder'));
  const input = h('input', 'setinput');
  input.placeholder = 'Discord user ID';
  input.value = r.discordIdManual || '';
  input.spellcheck = false;
  const save = h('button', 'btn sm', 'Save');
  save.onclick = () => after(() => T.settingsSet({ discordIdManual: input.value }));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save.click(); });
  row.append(txt, input, save);
  if (r.discordIdManual) {
    const auto = h('button', 'btn sm ghost', 'Use detected');
    auto.onclick = () => after(() => T.settingsSet({ discordIdManual: null }));
    row.append(auto);
  }
  card.append(row);
  ds.append(card);

  // thumbnails
  const ts = section('Thumbnails', 'Previews for the Clips page are saved so they load instantly. Clearing them is safe; they get made again as you scroll.');
  const tc = h('div', 'setcard');
  const trow = h('div', 'setrow');
  trow.append(h('div', 'settext', `${r.cache.files} files  ·  ${fmtSize(r.cache.bytes)}`));
  const clear = h('button', 'btn sm ghost', 'Clear');
  clear.onclick = () => after(() => T.thumbsClear());
  trow.append(clear);
  tc.append(trow);
  ts.append(tc);

  // empty folders
  const es = section('Empty folders', 'NVIDIA makes a folder for every game it sees, even if you never saved a clip. Folders with no files at all can go.');
  const ec = h('div', 'setcard');
  const erow = h('div', 'setrow');
  const etxt = h('div', 'settext', 'Checking...');
  erow.append(etxt);
  ec.append(erow);
  es.append(ec);
  T.libEmptyFolders().then(x => {
    const list = (x.ok && x.folders) || [];
    etxt.replaceChildren(h('div', 'setname', list.length ? `${list.length} empty folder${list.length === 1 ? '' : 's'}` : 'No empty folders'));
    if (list.length) {
      etxt.append(h('div', 'setpath wrap', list.map(folderName).join(', ')));
      const b = h('button', 'btn sm ghost', 'Move to Recycle Bin');
      b.onclick = async () => {
        if (!(await confirmBox({
          title: `Delete ${list.length} empty folder${list.length === 1 ? '' : 's'}?`,
          body: `${list.map(folderName).join(', ')}. They have no files in them, and NVIDIA makes them again if you record that game.`,
        }))) return;
        const y = await T.libTrashEmpty(true);
        if (!y.ok) libToast(y.error, 'err'); else if (!y.cancelled) { L.dirty = true; renderSettings(); }
      };
      erow.append(b);
    }
  });

  box.append(h('p', 'setnote ver', `${T.appName} ${r.version}`));
}
