const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');

let FFMPEG = null;
try {
  FFMPEG = require('ffmpeg-static');
  if (FFMPEG) FFMPEG = FFMPEG.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
} catch (e) { /* fall back to PATH below */ }
if (!FFMPEG || !fs.existsSync(FFMPEG)) FFMPEG = 'ffmpeg';

const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'ts', 'm4v'];
const AUDIO_EXT = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'];

const state = { outputs: new Set(), child: null, cancelled: false, nextId: 0 };
const clips = new Map(); // clip id -> { path, info, extras }  (one per open tab)
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function getClip(id) {
  const c = clips.get(Number(id));
  if (!c) throw new Error('That clip is no longer open.');
  return c;
}
let win = null;
const IS_WIN = process.platform === 'win32';
// Chromium skips drawing pictures it hasn't decoded yet while you scroll and fills them in a
// moment later, which made cards flash blank. Decode them as they're drawn instead.
app.commandLine.appendSwitch('disable-checker-imaging');
// The app's name comes from package.json (productName). Names it used to have, so a rename
// keeps everyone's settings, caches and trimmed-clips folder.
const APP_NAME = app.getName();
const OLD_NAMES = ['Clip Trimmer'].filter(n => n !== APP_NAME);
(function keepOldData() {
  try {
    const now = app.getPath('userData');
    if (fs.existsSync(now)) return;
    for (const n of OLD_NAMES) {
      const old = path.join(app.getPath('appData'), n);
      if (fs.existsSync(path.join(old, 'settings.json'))) { fs.renameSync(old, now); return; }
    }
  } catch (e) { /* start fresh */ }
})();
const copyDir = () => path.join(app.getPath('temp'), APP_NAME);

// ---------- clipboard (files) ----------

// One PowerShell kept running for clipboard work: starting a new one costs about half a second
// per copy. Commands go in one line at a time; each answer ends with a marker line.
let ps = null;
function psStart() {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command',
    "$OutputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8; while ($true) { $l = [Console]::In.ReadLine(); if ($l -eq $null) { break }; try { Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($l))) | Out-String -Width 4096 | Write-Output } catch { Write-Output '' }; Write-Output '<<END>>' }"],
  { windowsHide: true });
  const p = { child, buf: '', queue: [] };
  child.stdout.on('data', d => {
    p.buf += d.toString('utf8');
    let i;
    while ((i = p.buf.indexOf('<<END>>')) >= 0) {
      const out = p.buf.slice(0, i);
      p.buf = p.buf.slice(i + 7).replace(/^\r?\n/, '');
      const job = p.queue.shift();
      if (job) { clearTimeout(job.timer); job.resolve(out.trim()); }
    }
  });
  const dead = () => { if (ps === p) ps = null; for (const j of p.queue.splice(0)) { clearTimeout(j.timer); j.resolve(null); } };
  child.on('error', dead);
  child.on('close', dead);
  return p;
}
function powershell(cmd) {
  return new Promise(resolve => {
    try {
      if (!ps) ps = psStart();
      const p = ps;
      const job = { resolve, timer: setTimeout(() => { try { p.child.kill(); } catch (e) { /* ignore */ } }, 15000) };
      p.queue.push(job);
      p.child.stdin.write(Buffer.from(cmd, 'utf8').toString('base64') + '\n');
    } catch (e) { resolve(null); }
  });
}
// started a few seconds after launch so the first copy is quick too
app.whenReady().then(() => setTimeout(() => { if (IS_WIN && !ps) ps = psStart(); }, 4000));
app.on('will-quit', () => { if (ps) { try { ps.child.stdin.end(); ps.child.kill(); } catch (e) { /* ignore */ } } });
const psQuote = s => "'" + String(s).replace(/'/g, "''") + "'";

// Put a file on the clipboard the same way Explorer's Ctrl+C does, so Discord can paste it.
async function copyFileToClipboard(p) {
  const list = Array.isArray(p) ? p : [p];
  if (IS_WIN) {
    const r = await powershell(`Set-Clipboard -LiteralPath ${list.map(psQuote).join(',')}; (Get-Clipboard -Format FileDropList | Select-Object -First 1).FullName`);
    if (!r || !list.some(x => path.resolve(r).toLowerCase() === path.resolve(x).toLowerCase())) throw new Error("Couldn't put the clip on the clipboard.");
    return;
  }
  clipboard.writeText(list.join('\n'));
}

// Path of a file copied in Explorer, or a path copied as text. Tries each source and
// returns the first one that is an existing file.
async function clipboardPath() {
  const isFile = p => { try { return !!p && fs.statSync(cleanPath(p)).isFile(); } catch (e) { return false; } };
  if (IS_WIN) {
    try {
      const buf = await clipboard.readBuffer('FileNameW');
      const p = buf && buf.length ? Buffer.from(buf).toString('ucs2').replace(/\0[\s\S]*$/, '') : '';
      if (isFile(p)) return p;
    } catch (e) { /* ignore */ }
    const p = await powershell('(Get-Clipboard -Format FileDropList | Select-Object -First 1).FullName');
    if (isFile(p)) return p;
  }
  const t = String((await clipboard.readText()) || '').trim().split(/\r?\n/)[0];
  return isFile(t) ? cleanPath(t) : '';
}

// Copies made for the clipboard live in temp; clear out ones older than a day.
function cleanCopies() {
  try {
    for (const d of fs.readdirSync(copyDir())) {
      const full = path.join(copyDir(), d);
      if (Date.now() - fs.statSync(full).mtimeMs > 24 * 3600 * 1000) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch (e) { /* folder may not exist yet */ }
}

// ---------- ffmpeg helpers ----------

// Reads ffmpeg's own description of a file (no ffprobe needed).
function ffInfo(file) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-hide_banner', '-i', file], { windowsHide: true, maxBuffer: 1 << 22 }, (err, _out, stderr) => {
      if (err && err.code === 'ENOENT') return reject(new Error('ffmpeg was not found.'));
      const s = String(stderr || '');
      const dm = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const duration = dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]) : 0;
      let video = null, cur = null;
      const audio = [];
      for (const l of s.split(/\r?\n/)) {
        const sm = l.match(/^\s*Stream #0:\d+.*?: (Video|Audio|Subtitle|Data|Attachment): (.*)$/);
        if (sm) {
          cur = null;
          if (sm[1] === 'Video' && !video && !/attached pic/.test(l)) video = sm[2];
          if (sm[1] === 'Audio') {
            cur = { codec: (sm[2].match(/^(\w+)/) || [])[1] || '?', channels: ((sm[2].match(/\d+ Hz, ([^,]+)/) || [])[1] || '').trim(), title: '' };
            audio.push(cur);
          }
          continue;
        }
        const t = cur && l.match(/^\s+(title|handler_name)\s*:\s*(.+?)\s*$/);
        if (t) cur[t[1] === 'title' ? 'title' : 'handler'] = t[2];
      }
      resolve({ duration, video, audio });
    });
  });
}

async function probeVideo(file) {
  const { duration, video, audio } = await ffInfo(file);
  if (!video) throw new Error('No video stream found in that file.');
  const res = video.match(/,\s*(\d{2,5})x(\d{2,5})/);
  const f = video.match(/(\d+(?:\.\d+)?)\s*fps/) || video.match(/(\d+(?:\.\d+)?)\s*tbr/);
  let fps = f ? parseFloat(f[1]) : 30;
  if (!(fps >= 1 && fps <= 480)) fps = 30;
  // Discord clips label each audio track "<user id>:<kind>": all (full mix), application,
  // voice (one per person), soundboard, all_copy (duplicate of all)
  for (const a of audio) {
    const m = (a.handler || '').match(/^(\d+):([a-z_]+)$/);
    if (m) { a.kind = m[2]; a.user = m[1]; }
  }
  const discord = audio.length > 1 && audio.every(a => a.kind) && audio.some(a => a.kind === 'all');
  // Discord's clip info lists who was in the call, starting with whoever saved the clip
  let owner = null, users = [];
  if (discord) {
    const meta = await readDiscordMeta(file, fs.statSync(file).size);
    if (meta && Array.isArray(meta.users)) users = meta.users.map(String);
    // "You" is whoever saved most of the Discord clips on this PC (learned by the library);
    // until that's known, whoever saved this one
    const st = readSettings();
    owner = st.discordIdManual || st.discordId || users[0] || null;
  }
  // NVIDIA's own captures ("separate both tracks" gives game audio, then the mic)
  const nvidia = !discord && (NV_DATE.test(path.basename(file)) || audio.some(a => /^SoundHandle$/.test(a.handler || '')));
  return {
    discord, owner, users, nvidia, videoLine: video,
    name: path.basename(file),
    url: pathToFileURL(file).href,
    codec: (video.match(/^(\w+)/) || [])[1] || '?',
    width: res ? +res[1] : null,
    height: res ? +res[2] : null,
    fps: Math.round(fps * 1000) / 1000,
    duration,
    size: fs.statSync(file).size,
    audio,
  };
}

const cleanPath = p => String(p || '').trim().replace(/^"(.*)"$/, '$1');

async function openFile(p) {
  p = cleanPath(p);
  if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error('File not found: ' + p);
  for (const c of clips.values()) if (samePath(c.path, p)) return c.info; // already open in a tab
  const info = await probeVideo(p);
  info.id = ++state.nextId;
  info.path = p;
  clips.set(info.id, { path: p, info, extras: [] });
  return info;
}

// The bundled Windows ffmpeg has no software AV1 decoder (NVIDIA's AV1 recordings fail with
// "Bitstream not supported"), but it can decode AV1 on the graphics card - and any PC that
// records AV1 has a card that can decode it.
const av1In = codec => (IS_WIN && /^av1/i.test(codec || '') ? ['-hwaccel', 'd3d11va', '-c:v', 'av1'] : []);

function grabFrame(file, t, codec) {
  return new Promise(resolve => {
    const c = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...av1In(codec), '-ss', t.toFixed(3), '-i', file, '-frames:v', '1',
      '-vf', 'scale=-2:96', '-q:v', '6', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], { windowsHide: true });
    const bufs = [];
    c.stdout.on('data', d => bufs.push(d));
    c.on('error', () => resolve(null));
    c.on('close', () => resolve(bufs.length ? 'data:image/jpeg;base64,' + Buffer.concat(bufs).toString('base64') : null));
  });
}

function waveform(file, dur, buckets) {
  return new Promise(resolve => {
    const rate = 2000;
    const total = Math.max(1, dur * rate);
    const peaks = new Array(buckets).fill(0);
    let idx = 0, leftover = null;
    const c = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-vn',
      '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { windowsHide: true });
    c.stdout.on('data', d => {
      if (leftover) { d = Buffer.concat([leftover, d]); leftover = null; }
      if (d.length & 1) { leftover = d.subarray(d.length - 1); d = d.subarray(0, d.length - 1); }
      // each sample goes to the bucket for its moment in the clip, so the peaks always span the
      // whole width (rounding the bucket size up used to leave the last few empty)
      for (let i = 0; i < d.length; i += 2) {
        const v = Math.abs(d.readInt16LE(i));
        const b = Math.min(buckets - 1, Math.floor(idx++ * buckets / total));
        if (v > peaks[b]) peaks[b] = v;
      }
    });
    c.on('error', () => resolve(null));
    c.on('close', () => {
      const top = Math.max(1, ...peaks);
      resolve(peaks.map(p => Math.round(p / top * 1000) / 1000));
    });
  });
}

function uniquePath(base, ext) {
  let out = `${base}_trim${ext}`;
  for (let n = 2; fs.existsSync(out); n++) out = `${base}_trim${n}${ext}`;
  return out;
}

function runFfmpeg(args, length, onProgress, job = state) {
  return new Promise(resolve => {
    const tail = [];
    const child = spawn(FFMPEG, args, { windowsHide: true });
    job.child = child;
    let buf = '';
    child.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) {
        const m = l.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && length > 0 && onProgress) onProgress(Math.min(1, (+m[1] / 1e6) / length));
      }
    });
    child.stderr.on('data', d => {
      tail.push(...d.toString().split(/\r?\n/).filter(Boolean));
      if (tail.length > 8) tail.splice(0, tail.length - 8);
    });
    child.on('error', e => { job.child = null; resolve({ ok: false, err: [e.message] }); });
    child.on('close', code => {
      job.child = null;
      resolve({ ok: code === 0 && !job.cancelled, err: tail, cancelled: job.cancelled });
    });
  });
}

const clampVol = v => { v = Number(v); return isFinite(v) ? Math.max(0, Math.min(4, v)) : 1; };

async function doExport({ clipId, start, end, mode, volume, mute, tracks, mix, saveAs, toClipboard }) {
  const clip = getClip(clipId);
  const dur = clip.info.duration || 0;
  start = Number(start); end = Number(end);
  if (!(start >= 0 && end > start) || (dur && start >= dur)) throw new Error('Invalid start/end.');
  if (dur) end = Math.min(end, dur);
  const length = end - start;
  const src = clip.path;
  const srcExt = path.extname(src);
  const base = src.slice(0, src.length - srcExt.length);

  let chosen = null;
  if (toClipboard) {
    // keep the original name (Discord shows it) inside a fresh temp folder
    const dir = path.join(copyDir(), String(Date.now()));
    fs.mkdirSync(dir, { recursive: true });
    chosen = path.join(dir, path.basename(base) + '_trim.mp4');
  } else if (saveAs) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Save trimmed clip as',
      defaultPath: uniquePath(base, '.mp4'),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }, { name: 'MKV video', extensions: ['mkv'] }],
    });
    if (r.canceled || !r.filePath) return { cancelled: true, quiet: true };
    chosen = path.extname(r.filePath) ? r.filePath : r.filePath + '.mp4';
    if (path.resolve(chosen).toLowerCase() === path.resolve(src).toLowerCase()) {
      throw new Error("Can't overwrite the original clip. Pick a different name.");
    }
  }

  const t0 = Date.now();
  state.cancelled = false;
  mute = !!mute;
  const master = clampVol(volume);
  const nMain = (clip.info.audio || []).length;
  const extras = clip.extras.slice();
  const advanced = nMain > 1 || extras.length > 0;
  const tr = Array.isArray(tracks) ? tracks : [];

  // audio sources for the multi-track path: [input label, gain]
  const sources = [];
  if (advanced && !mute) {
    for (let k = 0; k < nMain; k++) {
      const t = tr[k] || {};
      if (t.include !== false) sources.push([`0:a:${k}`, clampVol(t.volume ?? 1) * master, clip.info.audio[k].channels]);
    }
    extras.forEach((_x, j) => {
      const t = tr[nMain + j] || {};
      if (t.include !== false) sources.push([`${j + 1}:a:0`, clampVol(t.volume ?? 1) * master, _x.channels]);
    });
  }
  const noAudio = mute || (advanced && sources.length === 0);
  const gain = Math.abs(master - 1) > 0.001;

  const build = (out, copy) => {
    const a = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats',
      ...(copy ? [] : av1In(clip.info.codec)), '-ss', start.toFixed(3), '-i', src];
    if (advanced && !noAudio) {
      for (const x of extras) a.push('-ss', start.toFixed(3), '-t', length.toFixed(3), '-i', x.path);
    }
    a.push('-t', length.toFixed(3), '-map', '0:v:0');
    if (copy) a.push('-c:v', 'copy', '-avoid_negative_ts', 'make_zero');
    else a.push('-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');

    if (noAudio) {
      a.push('-an');
    } else if (advanced) {
      // everything becomes 48 kHz stereo so tracks can be mixed; mono is copied to both
      // channels at full level (a plain upmix would drop it by 3 dB)
      const parts = sources.map(([lbl, g, ch], i) =>
        `[${lbl}]volume=${g.toFixed(3)},aresample=48000,` +
        (ch === 'mono' ? 'pan=stereo|c0=c0|c1=c0,' : '') +
        `aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      if (mix !== false && sources.length > 1) {
        parts.push(sources.map((_s, i) => `[a${i}]`).join('') + `amix=inputs=${sources.length}:duration=longest:normalize=0[aout]`);
        a.push('-filter_complex', parts.join(';'), '-map', '[aout]');
      } else {
        a.push('-filter_complex', parts.join(';'));
        sources.forEach((_s, i) => a.push('-map', `[a${i}]`));
      }
      a.push('-c:a', 'aac', '-b:a', '192k');
    } else {
      a.push('-map', '0:a?');
      if (gain) a.push('-af', `volume=${master.toFixed(2)}`, '-c:a', 'aac', '-b:a', '192k');
      else if (copy) a.push('-c:a', 'copy');
      else a.push('-c:a', 'aac', '-b:a', '192k');
    }
    if (out.toLowerCase().endsWith('.mp4')) a.push('-movflags', '+faststart');
    a.push(out);
    return a;
  };
  const progress = p => win && !win.isDestroyed() && win.webContents.send('progress', p);

  const copy = mode === 'fast';
  // exports go to their own folder, sorted by game (see exportBase); Save as goes wherever picked
  const outBase = chosen ? null : await exportBase(src);
  let out = chosen || uniquePath(outBase, '.mp4');
  let r = await runFfmpeg(build(out, copy), length, progress);
  if (!chosen && !r.ok && !r.cancelled && copy && srcExt.toLowerCase() !== '.mp4') {
    // some codecs can't be stream-copied into mp4; keep the original container instead
    fs.rmSync(out, { force: true });
    out = uniquePath(outBase, srcExt);
    r = await runFfmpeg(build(out, true), length, progress);
  }
  if (r.cancelled) { fs.rmSync(out, { force: true }); return { cancelled: true }; }
  if (!r.ok) {
    fs.rmSync(out, { force: true });
    const hint = copy ? ' (try Precise mode)' : '';
    throw new Error('ffmpeg failed' + hint + ': ' + r.err.join(' | '));
  }
  state.outputs.add(out);
  if (toClipboard) await copyFileToClipboard(out);
  return { out, size: fs.statSync(out).size, seconds: Math.round((Date.now() - t0) / 100) / 10, copied: !!toClipboard };
}

// ---------- quick trim (the overlay over the library) ----------
// Trims and audio settings are remembered per clip, like Discord: the clip itself is never
// changed, and a file is only made when you copy or save.
const editsFile = () => path.join(app.getPath('userData'), 'edits.json');
let edits = null, editsTimer = null;
const editKey = p => path.resolve(p).toLowerCase();
function allEdits() {
  if (!edits) { try { edits = JSON.parse(fs.readFileSync(editsFile(), 'utf8')) || {}; } catch (e) { edits = {}; } }
  return edits;
}
const editFor = p => allEdits()[editKey(p)] || null;
function setEdit(p, e) {
  const all = allEdits();
  if (e) all[editKey(p)] = { ...e, at: Date.now() }; else delete all[editKey(p)];
  clearTimeout(editsTimer);
  editsTimer = setTimeout(() => { try { fs.writeFileSync(editsFile(), JSON.stringify(all)); } catch (err) { /* ignore */ } }, 300);
}
const qtFiles = new Set(); // clips open in the overlay; their bytes can be read by the player

// Encoding on the graphics card when there is one (NVIDIA, AMD or Intel), else the CPU. Checked
// once with a tiny test encode, since an encoder can be listed but not work on this PC.
let videoEnc = null;
function encoderWorks(args) {
  return new Promise(resolve => {
    const c = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=0.5',
      ...args, '-f', 'null', '-'], { windowsHide: true });
    const t = setTimeout(() => { try { c.kill(); } catch (e) { /* ignore */ } resolve(false); }, 10000);
    c.on('error', () => { clearTimeout(t); resolve(false); });
    c.on('close', code => { clearTimeout(t); resolve(code === 0); });
  });
}
const rateArgs = k => ['-b:v', `${k}k`, '-maxrate', `${Math.round(k * 1.5)}k`, '-bufsize', `${k * 2}k`];
const ENCODERS = [
  // p3: measured on a 1440p60 clip, 25% faster than p4 at practically the same quality (SSIM .978 vs .979)
  ['h264_nvenc', k => ['-c:v', 'h264_nvenc', '-preset', 'p3', '-tune', 'hq', '-rc', 'vbr', ...rateArgs(k), '-pix_fmt', 'yuv420p']],
  ['h264_amf', k => ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'vbr_peak', ...rateArgs(k), '-pix_fmt', 'yuv420p']],
  ['h264_qsv', k => ['-c:v', 'h264_qsv', '-preset', 'medium', ...rateArgs(k), '-pix_fmt', 'nv12']],
];
const X264 = () => ['-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'];
async function pickEncoder() {
  if (videoEnc) return videoEnc;
  for (const [name, args] of ENCODERS) if (await encoderWorks(args(2000))) return (videoEnc = { name, args });
  return (videoEnc = { name: 'libx264', args: X264 });
}

// About the same bitrate as the original: the trim looks the same and stays about the same size per second
function sourceKbps(info) {
  const m = String(info.videoLine || '').match(/(\d+) kb\/s/);
  const k = m ? +m[1] : (info.size && info.duration ? info.size * 8 / info.duration / 1000 * 0.92 : 12000);
  return Math.round(Math.min(60000, Math.max(2000, k)));
}

// sources: [{ index, gain }] - which audio tracks to keep and how loud; [] means no audio
async function makeFile({ src, info, start, length, audioOnly, list, out, progress, job }) {
  const enc = audioOnly ? null : await pickEncoder();
  const build = videoArgs => {
    const a = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats',
      ...(audioOnly ? [] : av1In(info.codec)),
      '-ss', start.toFixed(3), '-t', length.toFixed(3), '-i', src];
    if (audioOnly) a.push('-vn'); else a.push('-map', '0:v:0', ...videoArgs);
    if (!list.length) a.push('-an');
    else if (list.length === 1 && Math.abs(list[0].gain - 1) < 0.001) a.push('-map', `0:a:${list[0].index}`);
    else {
      // everything becomes 48 kHz stereo so tracks can be mixed; mono is copied to both channels
      const parts = list.map((s, i) => `[0:a:${s.index}]volume=${s.gain.toFixed(3)},aresample=48000,` +
        (info.audio[s.index].channels === 'mono' ? 'pan=stereo|c0=c0|c1=c0,' : '') + `aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      if (list.length > 1) parts.push(list.map((_s, i) => `[a${i}]`).join('') + `amix=inputs=${list.length}:duration=longest:normalize=0[aout]`);
      a.push('-filter_complex', parts.join(';'), '-map', list.length > 1 ? '[aout]' : '[a0]');
    }
    if (list.length) a.push(...(audioOnly ? ['-c:a', 'libmp3lame', '-b:a', '192k'] : ['-c:a', 'aac', '-b:a', '192k']));
    if (!audioOnly) a.push('-movflags', '+faststart');
    a.push(out);
    return a;
  };
  if (audioOnly) return runFfmpeg(build([]), length, progress, job);
  let r = await runFfmpeg(build(enc.args(sourceKbps(info))), length, progress, job);
  // the card's encoder refused this one (odd size, driver trouble): use the CPU
  if (!r.ok && !r.cancelled && enc.name !== 'libx264') r = await runFfmpeg(build(X264()), length, progress, job);
  return r;
}

// Copy Video should feel instant: while you're trimming, the trimmed clip is made in the
// background (on the GPU), so by the time you press Copy it's usually already there.
const prepared = new Map(); // export key -> { out, ready: Promise<result>, job, used }
const exportKey = o => JSON.stringify([editKey(o.path), Math.round(o.start * 1000), Math.round(o.end * 1000), o.as || 'video', o.sources || []]);
// throw away background-made clips (all of them, or just one clip's)
function dropPrepared(forPath) {
  for (const [k, e] of prepared) {
    if (forPath && JSON.parse(k)[0] !== editKey(forPath)) continue;
    prepared.delete(k);
    e.job.cancelled = true;
    if (e.job.child) { try { e.job.child.kill(); } catch (err) { /* ignore */ } }
    if (!e.used) e.ready.then(() => { try { fs.rmSync(path.dirname(e.out), { recursive: true, force: true }); } catch (err) { /* ignore */ } });
  }
}
async function qtPrepare(o) {
  const src = o.path;
  if (!inLibrary(src) || !fs.existsSync(src)) return {};
  const info = await probeVideo(src);
  const start = Number(o.start), end = Math.min(Number(o.end), info.duration || Infinity);
  if (!(start >= 0 && end > start)) return {};
  const key = exportKey({ ...o, start, end });
  if (prepared.has(key)) return {};
  dropPrepared(null); // only the latest trim is worth having ready
  const dir = path.join(copyDir(), 'prep-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(src), out = path.join(dir, path.basename(src, ext) + '_trim.mp4');
  const list = (Array.isArray(o.sources) ? o.sources : []).filter(x => info.audio[x.index] && x.gain > 0.001);
  const job = { child: null, cancelled: false };
  const entry = { out, job, used: false };
  entry.ready = makeFile({ src, info, start, length: end - start, audioOnly: false, list, out, progress: null, job })
    .then(r => { if (!r.ok) { prepared.delete(key); fs.rmSync(dir, { recursive: true, force: true }); } return r; });
  prepared.set(key, entry);
  return {};
}

async function qtExport(o) {
  const { path: src, as, dest, sources } = o;
  if (!inLibrary(src) || !fs.existsSync(src)) throw new Error("That clip isn't there anymore.");
  const info = await probeVideo(src);
  const start = Number(o.start), end = Math.min(Number(o.end), info.duration || Infinity);
  if (!(start >= 0 && end > start)) throw new Error('Invalid start/end.');
  const length = end - start;
  const audioOnly = as === 'audio', ext = audioOnly ? '.mp3' : '.mp4';
  const srcExt = path.extname(src), base = src.slice(0, src.length - srcExt.length);
  const list = (Array.isArray(sources) ? sources : []).filter(s => info.audio[s.index] && s.gain > 0.001);
  if (audioOnly && !list.length) throw new Error('All the audio is muted, so there is nothing to export.');
  const t0 = Date.now();

  // already made in the background?
  if (!audioOnly && (dest === 'clipboard' || dest === 'temp')) {
    const e = prepared.get(exportKey({ ...o, start, end }));
    if (e) {
      const r = await e.ready;
      if (r.ok && fs.existsSync(e.out)) {
        e.used = true;
        state.outputs.add(e.out);
        if (dest === 'clipboard') await copyFileToClipboard(e.out);
        return { out: e.out, size: fs.statSync(e.out).size, seconds: Math.round((Date.now() - t0) / 100) / 10, prepared: true };
      }
    }
  }

  let out;
  if (dest === 'clipboard' || dest === 'temp') {
    const dir = path.join(copyDir(), String(Date.now()));
    fs.mkdirSync(dir, { recursive: true });
    out = path.join(dir, path.basename(base) + '_trim' + ext);
  } else if (dest === 'saveas') {
    const r = await dialog.showSaveDialog(win, {
      title: audioOnly ? 'Export audio as' : 'Export trimmed clip as',
      defaultPath: uniquePath(await exportBase(src), ext),
      filters: audioOnly ? [{ name: 'MP3 audio', extensions: ['mp3'] }] : [{ name: 'MP4 video', extensions: ['mp4'] }],
    });
    if (r.canceled || !r.filePath) return { cancelled: true };
    out = path.extname(r.filePath) ? r.filePath : r.filePath + ext;
    if (samePath(out, src)) throw new Error("Can't overwrite the original clip. Pick a different name.");
  } else out = uniquePath(await exportBase(src), ext);

  const progress = p => win && !win.isDestroyed() && win.webContents.send('qt-progress', p);
  state.cancelled = false;
  const r = await makeFile({ src, info, start, length, audioOnly, list, out, progress, job: state });
  if (r.cancelled) { fs.rmSync(out, { force: true }); return { cancelled: true }; }
  if (!r.ok) { fs.rmSync(out, { force: true }); throw new Error('Export failed: ' + r.err.join(' | ')); }
  state.outputs.add(out);
  if (dest === 'clipboard') await copyFileToClipboard(out);
  return { out, size: fs.statSync(out).size, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

// ---------- clip library ----------
// Browses the folders clips get saved to: NVIDIA's (one subfolder per game, "Desktop" when no
// game was running) and Discord's (flat; each clip carries Discord's own info - game, time,
// who was in the call, a thumbnail). Both are found on their own; the user can add or remove
// folders, and that list is saved in settings.json.

const LIB_EXT = new Set(['mp4', 'mkv', 'mov', 'webm', 'm4v']);
const NV_DATE = /(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})/; // "Game 2026.10.27 - 15.36.33.06.DVR.mp4"
const DISCORD_NAME = /^(.*)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i; // "Destiny_2_<uuid>.mp4"
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return {}; } }
function writeSettings(s) { try { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 1)); } catch (e) { /* ignore */ } }
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

let nvidiaRoot; // undefined = not looked up yet
function nvidiaFolder() {
  if (nvidiaRoot !== undefined || !IS_WIN) return Promise.resolve(nvidiaRoot || null);
  return new Promise(resolve => {
    execFile('reg', ['query', 'HKCU\\Software\\NVIDIA Corporation\\Global\\ShadowPlay\\NVSPCAPS', '/v', 'DefaultPathW'],
      { windowsHide: true, timeout: 5000 }, (err, out) => {
        let p = null;
        const m = !err && String(out).match(/DefaultPathW\s+REG_BINARY\s+([0-9A-Fa-f]+)/);
        if (m) p = Buffer.from(m[1], 'hex').toString('utf16le').replace(/\0[\s\S]*$/, '').trim();
        nvidiaRoot = p && isDir(p) ? p : null;
        resolve(nvidiaRoot);
      });
  });
}

// Discord keeps its clip folder setting in its own database, but its clip logs say where each
// clip was saved, so take the folder of the most recent one.
let discordRoot;
function discordFolder() {
  if (discordRoot !== undefined) return discordRoot;
  discordRoot = null;
  const found = [];
  for (const flavor of ['discord', 'discordptb', 'discordcanary']) {
    const dir = path.join(app.getPath('appData'), flavor, 'logs');
    let names = [];
    try { names = fs.readdirSync(dir).filter(n => /clips/i.test(n)); } catch (e) { continue; }
    for (const n of names) {
      try {
        const full = path.join(dir, n), st = fs.statSync(full);
        const fd = fs.openSync(full, 'r'), len = Math.min(st.size, 2 << 20), b = Buffer.alloc(len);
        fs.readSync(fd, b, 0, len, st.size - len); fs.closeSync(fd);
        const re = /(?:save clip:|metadata box to)\s+(.+?\.mp4)/g;
        let m, last = null;
        while ((m = re.exec(b.toString('utf8')))) last = m[1];
        if (last) found.push({ t: st.mtimeMs, dir: path.dirname(last.trim()) });
      } catch (e) { /* ignore */ }
    }
  }
  found.sort((a, b) => b.t - a.t);
  const hit = found.find(f => isDir(f.dir));
  if (hit) discordRoot = hit.dir;
  return discordRoot;
}

// ---------- where trimmed clips go ----------
// Their own folder, one subfolder per game, so the NVIDIA/Discord folders stay just recordings.
// Default: next to NVIDIA's folder (same drive), else in Videos, named after the app. Changeable in Settings.
async function exportDir() {
  if (process.env.CLIP_TRIMMER_EXPORTS) return process.env.CLIP_TRIMMER_EXPORTS;
  const s = readSettings();
  if (s.exportDir) return s.exportDir;
  const nv = await nvidiaFolder(), base = nv ? path.dirname(nv) : app.getPath('videos');
  // after a rename, keep using the folder that already has trims in it
  for (const n of OLD_NAMES) if (!isDir(path.join(base, APP_NAME)) && isDir(path.join(base, safeName(n)))) return path.join(base, safeName(n));
  return path.join(base, safeName(APP_NAME));
}
const safeName = n => String(n || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 80) || 'Other';
// which game a clip belongs to, as a folder name for its trims
async function gameFolderFor(src) {
  for (const f of await libFolders()) {
    if (f.kind === 'trimmed') continue;
    const rel = path.relative(f.path, src);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const parts = rel.split(path.sep);
    if (parts.length > 1) return parts[0];
    break;
  }
  try {
    const meta = await readDiscordMeta(src, fs.statSync(src).size);
    if (meta && meta.applicationName) return isDesktopName(meta.applicationName) ? 'Desktop' : safeName(meta.applicationName);
  } catch (e) { /* not Discord's */ }
  const nv = path.basename(src).match(/^(.*?) \d{4}\.\d{2}\.\d{2} - /), dn = path.basename(src).match(DISCORD_NAME);
  if (nv) return safeName(nv[1]);
  if (dn) return safeName(dn[1].replace(/_/g, ' '));
  return 'Other';
}
async function exportBase(src) {
  const dir = path.join(await exportDir(), await gameFolderFor(src));
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(src, path.extname(src)).replace(/_trim\d*$/, '');
  return path.join(dir, name);
}

async function libFolders() {
  if (process.env.CLIP_TRIMMER_LIBRARY) {
    const l = process.env.CLIP_TRIMMER_LIBRARY.split(path.delimiter).map(p => ({ path: p, kind: 'folder' }));
    const ex = await exportDir();
    if (process.env.CLIP_TRIMMER_EXPORTS && isDir(ex)) l.push({ path: ex, kind: 'trimmed' });
    return l;
  }
  const nv = await nvidiaFolder(), dc = discordFolder(), ex = await exportDir();
  const kindOf = p => (nv && samePath(p, nv) ? 'nvidia' : dc && samePath(p, dc) ? 'discord' : 'folder');
  const s = readSettings();
  const list = (Array.isArray(s.folders) ? s.folders : [nv, dc].filter(Boolean)).filter(p => typeof p === 'string' && !samePath(p, ex));
  const out = list.map(p => ({ path: p, kind: kindOf(p), missing: !isDir(p) }));
  // the trimmed-clips folder is always part of the library once something has been exported
  if (isDir(ex)) out.push({ path: ex, kind: 'trimmed' });
  return out;
}
async function detectedFolders() {
  return [await nvidiaFolder(), discordFolder()].filter(Boolean);
}

// Discord names a clip after the window when it isn't a game: browser tabs ("Home - Netflix -
// Your Microsoft Edge - Microsoft Edge"), whole screens ("Screen 1"), apps. Those all go under Desktop,
// same as NVIDIA's Desktop folder.
const BROWSER_END = /(microsoft\W{0,3}edge|google\W{0,3}chrome|chromium|mozilla\W{0,3}firefox|firefox|opera(\W{0,3}gx)?|brave|vivaldi|arc|zen browser|librewolf)\W*$/i;
const NOT_GAMES = new Set(['desktop', 'unknown', 'other', 'discord', 'spotify', 'fileexplorer', 'explorer', 'windowsexplorer',
  'obs', 'obsstudio', 'steam', 'epicgameslauncher', 'battlenet', 'riotclient', 'visualstudiocode', 'code', 'notepad',
  'snippingtool', 'photos', 'mediaplayer', 'windowsmediaplayer', 'vlc', 'vlcmediaplayer', 'netflix', 'youtube', 'twitch',
  'crunchyroll', 'disney', 'hulu', 'primevideo', 'peacock', 'settings', 'taskmanager', 'nvidiaapp', 'geforceexperience',
  'microsoftedge', 'googlechrome', 'chrome', 'firefox', 'opera', 'operagx', 'brave', 'whatsapp', 'telegram', 'slack', 'zoom', 'teams', 'microsoftteams']);
function isDesktopName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (/^screen\s*\d*$/i.test(n)) return true;
  if (BROWSER_END.test(n) && /\s[-|–—]\s/.test(n)) return true;
  return NOT_GAMES.has(n.toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]+/g, ''));
}

// NVIDIA names folders after the game with ":" dropped ("Call of Duty  Black Ops 6") or after
// the exe when it doesn't know the game ("peak.exe")
const gameName = folder => folder.replace(/\.exe$/i, '').replace(/\s{2,}/g, ': ').trim() || 'Other';
function clipKind(name, meta) {
  if (/_trim\d*\.\w+$/i.test(name)) return 'trim';
  if (meta || DISCORD_NAME.test(name)) return 'discord';
  if (/\.DVR\.\w+$/i.test(name)) return 'replay';
  if (NV_DATE.test(name)) return 'recording';
  return 'other';
}

// Discord or NVIDIA - also for trims, whose names keep the original's
function clipOrigin(name, meta, kind) {
  if (kind === 'discord' || meta || DISCORD_NAME.test(name)) return 'discord';
  if (kind === 'nvidia' || NV_DATE.test(name) || /\.DVR(_trim\d*)?\.\w+$/i.test(name)) return 'nvidia';
  return null;
}

// Discord stores its clip info as JSON in a "uuid" box at the end of the mp4
async function readDiscordMeta(p, size) {
  let fh;
  try { fh = await fs.promises.open(p, 'r'); } catch (e) { return null; }
  try {
    const h = Buffer.alloc(16);
    let pos = 0;
    for (let n = 0; n < 64 && pos + 8 <= size; n++) {
      if ((await fh.read(h, 0, 16, pos)).bytesRead < 8) break;
      let len = h.readUInt32BE(0), hdr = 8;
      const type = h.toString('latin1', 4, 8);
      if (len === 1) { len = Number(h.readBigUInt64BE(8)); hdr = 16; } else if (len === 0) len = size - pos;
      if (len < hdr) break;
      if (type === 'uuid' && len < (8 << 20)) {
        const b = Buffer.alloc(len - hdr);
        await fh.read(b, 0, b.length, pos + hdr);
        const txt = b.toString('utf8'), i = txt.indexOf('{"');
        if (i >= 0) {
          const body = txt.slice(i, txt.lastIndexOf('}') + 1);
          try { const j = JSON.parse(body); if (j && j.type === 'clip') return j; } catch (e) { /* not Discord's */ }
        }
      }
      pos += len;
    }
  } catch (e) { /* unreadable */ } finally { try { await fh.close(); } catch (e) { /* ignore */ } }
  return null;
}

const thumbDir = () => path.join(app.getPath('userData'), 'thumbs');
let thumbIndex = null, indexTimer = null;
function loadIndex() {
  if (!thumbIndex) { try { thumbIndex = JSON.parse(fs.readFileSync(path.join(thumbDir(), 'index.json'), 'utf8')); } catch (e) { thumbIndex = {}; } }
  return thumbIndex;
}
function saveIndexSoon() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => {
    try { fs.mkdirSync(thumbDir(), { recursive: true }); fs.writeFileSync(path.join(thumbDir(), 'index.json'), JSON.stringify(thumbIndex)); } catch (e) { /* ignore */ }
  }, 1000);
}
const thumbKey = (p, st) => require('crypto').createHash('sha1')
  .update(p.toLowerCase() + '|' + st.size + '|' + Math.round(st.mtimeMs)).digest('hex').slice(0, 20);

// What we know about a file without decoding it: Discord's info (read once, then cached).
async function fileFacts(full, name, st) {
  const idx = loadIndex(), key = thumbKey(full, st);
  let e = idx[key];
  if (!e || e.metaChecked === undefined) {
    e = e || {};
    e.metaChecked = true;
    const mayHaveMeta = /\.mp4$/i.test(name) && !NV_DATE.test(name);
    const j = mayHaveMeta ? await readDiscordMeta(full, st.size) : null;
    if (j) {
      e.meta = {
        app: typeof j.applicationName === 'string' ? j.applicationName : '',
        createdAt: Number(j.createdAt) || 0,
        users: Array.isArray(j.users) ? j.users.map(String) : [],
      };
      if (j.length > 0) e.duration = j.length / 1000;
      // Discord's own thumbnail saves generating one
      const m = typeof j.thumbnail === 'string' && j.thumbnail.match(/^data:image\/jpeg;base64,(.+)$/);
      if (m) {
        try {
          fs.mkdirSync(thumbDir(), { recursive: true });
          fs.writeFileSync(path.join(thumbDir(), key + '.jpg'), Buffer.from(m[1], 'base64'));
          e.thumbReady = true;
        } catch (err) { /* make one later */ }
      }
    }
    idx[key] = e;
    saveIndexSoon();
  }
  return { key, e };
}

async function scanFolder(root, kind, out, progress) {
  const walk = async (dir, folder, sub, depth) => {
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of ents) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (depth < 4) await walk(full, folder === null ? d.name : folder, folder === null ? '' : (sub ? sub + '/' : '') + d.name, depth + 1);
        continue;
      }
      if (!d.isFile() || !LIB_EXT.has(path.extname(d.name).slice(1).toLowerCase())) continue;
      let st;
      try { st = await fs.promises.stat(full); } catch (e) { continue; }
      const { e } = await fileFacts(full, d.name, st);
      progress();
      const meta = e.meta || null;
      const nv = d.name.match(NV_DATE), dn = d.name.match(DISCORD_NAME);
      const date = meta && meta.createdAt ? meta.createdAt
        : nv ? new Date(+nv[1], +nv[2] - 1, +nv[3], +nv[4], +nv[5], +nv[6]).getTime() : st.mtimeMs;
      // which game: Discord's info, else the folder it's in, else the Discord-style name
      let game = meta && meta.app ? meta.app
        : folder !== null ? gameName(folder)
        : dn ? dn[1].replace(/_/g, ' ').trim() : 'Other';
      if (game !== 'Other' && isDesktopName(game)) game = 'Desktop';
      out.push({
        path: full, root, url: pathToFileURL(full).href, name: d.name, sub, date, size: st.size,
        source: kind, kind: kind === 'trimmed' ? 'trim' : clipKind(d.name, meta), origin: clipOrigin(d.name, meta, kind), gameName: game, fromName: !(meta && meta.app) && folder === null && !!dn,
        duration: e.error ? null : (e.duration || null), users: meta ? meta.users : [], edit: editFor(full),
      });
    }
  };
  await walk(root, null, '', 0);
}

let scanning = null;
async function scanLibrary() {
  const folders = await libFolders();
  const clipsOut = [];
  let n = 0;
  const progress = () => { if (++n % 100 === 0 && win && !win.isDestroyed()) win.webContents.send('lib-progress', n); };
  for (const f of folders) if (!f.missing) await scanFolder(f.path, f.kind, clipsOut, progress);
  // Discord cuts long game names short in file names ("Warhammer_40000_Da"); older clips have
  // nothing else, so match them to the full name newer clips carry
  const flat = x => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const full = [...new Set(clipsOut.filter(c => !c.fromName && c.source !== 'nvidia').map(c => c.gameName))];
  for (const c of clipsOut) {
    if (!c.fromName) continue;
    const f = flat(c.gameName);
    const hit = f.length >= 4 && full.find(n => flat(n).startsWith(f));
    if (hit) c.gameName = hit;
  }
  // the same game from different folders ("Peak" and "peak.exe", NVIDIA and Discord) becomes
  // one entry, named after whichever spelling has the most clips
  const games = new Map();
  for (const c of clipsOut) {
    const key = c.gameName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || 'other';
    let g = games.get(key);
    if (!g) { g = { key, names: new Map(), count: 0, size: 0, latest: 0, latestPath: null }; games.set(key, g); }
    g.names.set(c.gameName, (g.names.get(c.gameName) || 0) + 1);
    g.count++; g.size += c.size;
    if (c.date > g.latest) { g.latest = c.date; g.latestPath = c.path; }
    c.game = key;
  }
  const list = [...games.values()].map(g => ({
    key: g.key, count: g.count, size: g.size, latest: g.latest, latestPath: g.latestPath,
    name: [...g.names.entries()].sort((a, b) => b[1] - a[1] || (/[A-Z]/.test(b[0][0]) - /[A-Z]/.test(a[0][0])))[0][0],
  })).sort((a, b) => b.latest - a.latest);
  const names = new Map(list.map(g => [g.key, g.name]));
  for (const c of clipsOut) c.gameName = names.get(c.game);
  watchFolders(folders.filter(f => !f.missing).map(f => f.path));
  // whoever saved most of the Discord clips here is the person using this PC
  const savers = new Map();
  for (const c of clipsOut) if (c.users && c.users[0]) savers.set(c.users[0], (savers.get(c.users[0]) || 0) + 1);
  const top = [...savers.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 3) {
    const s = readSettings();
    if (s.discordId !== top[0]) { s.discordId = top[0]; writeSettings(s); }
  }
  return { folders, detected: await detectedFolders(), custom: Array.isArray(readSettings().folders), games: list, clips: clipsOut };
}

// thumbnails: one frame from about a third of the way in, cached by path + size + date
const thumbQueue = [], thumbJobs = new Map();
let thumbBusy = 0;
function libThumb(p) {
  if (thumbJobs.has(p)) return thumbJobs.get(p);
  const pr = new Promise(resolve => { thumbQueue.push({ p, resolve }); pumpThumbs(); });
  thumbJobs.set(p, pr);
  pr.then(() => thumbJobs.delete(p));
  return pr;
}
function pumpThumbs() {
  while (thumbBusy < 3 && thumbQueue.length) {
    const job = thumbQueue.pop(); // newest request first: that's what's on screen
    thumbBusy++;
    makeThumb(job.p).catch(() => ({ error: true })).then(r => { thumbBusy--; job.resolve(r); pumpThumbs(); });
  }
}
async function makeThumb(p) {
  const st = fs.statSync(p);
  const { key, e } = await fileFacts(p, path.basename(p), st);
  const file = path.join(thumbDir(), key + '.jpg');
  const url = () => pathToFileURL(file).href + '?' + key;
  if (e.error && e.errV === 2) return { error: true };
  if ((e.thumbReady || e.thumbMade) && e.duration && fs.existsSync(file)) return { duration: e.duration, url: url() };
  const info = await ffInfo(p);
  if (!info.video) { if (Date.now() - st.mtimeMs > 120000) { e.error = true; e.errV = 2; saveIndexSoon(); } return { error: true }; }
  delete e.error;
  const codec = (info.video.match(/^(\w+)/) || [])[1];
  e.duration = e.duration || info.duration || 0;
  if (!(e.thumbReady && fs.existsSync(file))) {
    fs.mkdirSync(thumbDir(), { recursive: true });
    const d = e.duration, t = d > 1 ? Math.min(d * 0.3, d - 0.5) : 0;
    const ok = await new Promise(resolve => {
      const c = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...av1In(codec), '-ss', t.toFixed(2), '-i', p,
        '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', file], { windowsHide: true });
      c.on('error', () => resolve(false));
      c.on('close', code => resolve(code === 0 && fs.existsSync(file)));
    });
    // a file that's still being written fails now but will work later, so don't remember that
    if (!ok) { if (Date.now() - st.mtimeMs > 120000) { e.error = true; e.errV = 2; saveIndexSoon(); } return { error: true, duration: e.duration }; }
    e.thumbMade = true;
  }
  saveIndexSoon();
  return { duration: e.duration, url: url() };
}

// ---------- game icons ----------
// Discord publishes the list of games it can detect, each with an icon. NVIDIA names its folders
// after the game, so most folders match a name (or alias) in that list. The list is refreshed
// weekly; icons are downloaded once and kept.
const iconDir = () => path.join(app.getPath('userData'), 'icons');
let gameIndex = null, gameIndexLoading = null;
const flatName = x => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '');
async function loadGameIndex() {
  if (gameIndex) return gameIndex;
  if (gameIndexLoading) return gameIndexLoading;
  gameIndexLoading = (async () => {
    const file = path.join(app.getPath('userData'), 'games.json');
    let list = null;
    try {
      const st = fs.statSync(file);
      if (Date.now() - st.mtimeMs < 7 * 24 * 3600 * 1000) list = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { /* not downloaded yet */ }
    if (!list) {
      try {
        const res = await net.fetch('https://discord.com/api/v9/applications/detectable');
        if (res.ok) {
          const all = await res.json();
          // keep only what's needed: about 1 MB instead of 13
          list = all.filter(a => a && a.icon_hash && a.name).map(a => [a.id, a.icon_hash, a.name, ...(a.aliases || [])]);
          fs.writeFileSync(file, JSON.stringify(list));
        }
      } catch (e) { /* offline */ }
      if (!list) { try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { list = []; } }
    }
    const idx = new Map();
    for (const [id, icon, ...names] of list) for (const n of names) { const k = flatName(n); if (k && !idx.has(k)) idx.set(k, { id, icon }); }
    gameIndex = idx;
    return idx;
  })();
  return gameIndexLoading;
}
// ways the same game gets written: "Modern Warfare 2 (2022)" / "Modern Warfare II", "Overwatch 2" / "Overwatch"
function nameVariants(name) {
  const roman = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7' };
  const out = new Set();
  const add = n => { const k = flatName(n); if (k.length >= 3) out.add(k); };
  const base = name.replace(/\.exe$/i, '').replace(/\s{2,}/g, ': ');
  const noParen = base.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  for (const n of [base, noParen, base.replace(/:/g, ''), noParen.replace(/:/g, '')]) {
    add(n);
    add(n.replace(/\b(ii|iii|iv|vi|vii)\b/gi, m => roman[m.toLowerCase()]));
    add(n.replace(/\b([2-7])\b/g, d => Object.keys(roman).find(k => roman[k] === d)));
    add(n.replace(/\s+\d+$/, ''));
  }
  return [...out];
}
const iconJobs = new Map();
async function gameIcon(name) {
  if (!name || /^(desktop|other)$/i.test(name)) return null;
  const idx = await loadGameIndex();
  let hit = null;
  for (const k of nameVariants(name)) { hit = idx.get(k); if (hit) break; }
  if (!hit) return null;
  const file = path.join(iconDir(), `${hit.id}-${hit.icon}.png`);
  if (fs.existsSync(file)) return pathToFileURL(file).href;
  if (!iconJobs.has(file)) {
    iconJobs.set(file, (async () => {
      try {
        const res = await net.fetch(`https://cdn.discordapp.com/app-icons/${hit.id}/${hit.icon}.png?size=128`);
        if (!res.ok) return null;
        fs.mkdirSync(iconDir(), { recursive: true });
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        return pathToFileURL(file).href;
      } catch (e) { return null; } finally { setTimeout(() => iconJobs.delete(file), 60000); }
    })());
  }
  return iconJobs.get(file);
}

// new clips show up without a refresh
const watchers = new Map(); // folder -> fs.FSWatcher
let libTimer = null;
function watchFolders(list) {
  for (const [p, w] of watchers) if (!list.some(x => samePath(x, p))) { try { w.close(); } catch (e) { /* ignore */ } watchers.delete(p); }
  for (const p of list) {
    if ([...watchers.keys()].some(x => samePath(x, p))) continue;
    try {
      const w = fs.watch(p, { recursive: true }, () => {
        if (libTimer) return; // at most one refresh every 2 s, even while a recording is being written
        libTimer = setTimeout(() => { libTimer = null; if (win && !win.isDestroyed()) win.webContents.send('lib-changed'); }, 2000);
      });
      w.on('error', () => { /* folder went away */ });
      watchers.set(p, w);
    } catch (e) { /* not watchable */ }
  }
}
function inLibrary(p) {
  if (typeof p !== 'string') return false;
  for (const root of watchers.keys()) {
    const rel = path.relative(root, p);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  }
  return false;
}
async function setFolders(list) {
  const s = readSettings();
  s.folders = list;
  writeSettings(s);
}

// ---------- IPC ----------

const wrap = fn => async (...a) => {
  try { return { ok: true, ...(await fn(...a)) }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
};
const extrasOut = clip => ({ extras: clip.extras.map(x => ({ path: x.path, name: x.name, title: x.title })) });

// ---------- byte access for the live audio engine ----------
// The preview decodes audio itself (renderer/engine.mjs) and asks for byte ranges of the
// clip and of added audio files. Only files that are open in a tab can be read.
const fds = new Map(); // path -> file descriptor
function readable(p) {
  if (qtFiles.has(editKey(p))) return true;
  for (const c of clips.values()) {
    if (samePath(c.path, p) || c.extras.some(x => samePath(x.path, p))) return true;
  }
  return false;
}
function fdFor(p) {
  if (!readable(p)) throw new Error('Not an open file.');
  let fd = fds.get(p);
  if (fd === undefined) { fd = fs.openSync(p, 'r'); fds.set(p, fd); }
  return fd;
}
function closeUnusedFds() {
  for (const [p, fd] of fds) if (!readable(p)) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } fds.delete(p); }
}
ipcMain.handle('file-size', (_e, p) => fs.fstatSync(fdFor(p)).size);
ipcMain.handle('read-range', (_e, p, start, end) => {
  const fd = fdFor(p);
  const len = Math.max(0, Math.min(end - start, 64 * 1024 * 1024));
  const b = Buffer.allocUnsafe(len);
  const n = fs.readSync(fd, b, 0, len, start);
  return new Uint8Array(b.buffer, b.byteOffset, n);
});

ipcMain.handle('qt-open', wrap(async (_e, p) => {
  if (!inLibrary(p) || !fs.existsSync(p)) throw new Error("That clip isn't there anymore.");
  const info = await probeVideo(p);
  qtFiles.add(editKey(p));
  return { info: { ...info, path: p }, edit: editFor(p) };
}));
ipcMain.handle('qt-close', (_e, p) => { qtFiles.delete(editKey(p)); closeUnusedFds(); dropPrepared(p); });
ipcMain.handle('qt-wave', wrap(async (_e, p, dur, buckets) => {
  if (!qtFiles.has(editKey(p))) throw new Error('Not open.');
  return { peaks: await waveform(p, dur, Math.max(50, Math.min(4000, buckets | 0))) };
}));
ipcMain.handle('qt-edit', wrap(async (_e, p, e) => { if (!inLibrary(p)) throw new Error('Not a library clip.'); setEdit(p, e); return {}; }));
ipcMain.handle('qt-export', wrap((_e, o) => qtExport(o || {})));
ipcMain.handle('qt-prepare', wrap((_e, o) => qtPrepare(o || {})));
// copy files to the clipboard: library clips, or clips just made from saved trims
ipcMain.handle('copy-files', wrap(async (_e, list) => {
  const tmp = path.resolve(copyDir()).toLowerCase() + path.sep;
  const ok = (Array.isArray(list) ? list : []).filter(p => typeof p === 'string' && fs.existsSync(p) && (inLibrary(p) || path.resolve(p).toLowerCase().startsWith(tmp)));
  if (!ok.length) throw new Error("Those clips aren't there anymore.");
  await copyFileToClipboard(ok.length === 1 ? ok[0] : ok);
  return {};
}));
ipcMain.handle('qt-encoder', wrap(async () => ({ name: (await pickEncoder()).name })));

// ---------- self test (dev only): CLIP_TRIMMER_SELFTEST=<clip path> ----------
ipcMain.handle('selftest-config', () => process.env.CLIP_TRIMMER_SELFTEST || null);
ipcMain.handle('selftest-done', (_e, result) => {
  process.stdout.write('SELFTEST ' + JSON.stringify(result) + '\n');
  setTimeout(() => app.quit(), 100);
});

ipcMain.handle('initial', wrap(async () => ({ infos: [...clips.values()].map(c => c.info) })));
ipcMain.handle('close-clip', wrap(async (_e, id) => {
  clips.delete(Number(id));
  closeUnusedFds();
  return {};
}));
ipcMain.handle('open', wrap(async (_e, p) => ({ info: await openFile(p) })));
ipcMain.handle('pick', wrap(async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open a video clip',
    defaultPath: app.getPath('videos'),
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: VIDEO_EXT }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { info: null };
  return { info: await openFile(r.filePaths[0]) };
}));
ipcMain.handle('clipboard-file', wrap(async () => {
  const p = await clipboardPath();
  if (!p) throw new Error('No video on the clipboard. Copy a video file in File Explorer first.');
  return { info: await openFile(p) };
}));
ipcMain.handle('thumbs', wrap(async (_e, id, n) => {
  const clip = getClip(id), dur = clip.info.duration;
  n = Math.max(1, Math.min(60, n | 0));
  if (!dur) return { id, thumbs: [] };
  const out = new Array(n).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < n && clips.has(Number(id))) { const i = next++; out[i] = await grabFrame(clip.path, (i + 0.5) * dur / n, clip.info.codec); }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { id, thumbs: out };
}));
ipcMain.handle('waveform', wrap(async (_e, id, buckets) => {
  const clip = getClip(id), info = clip.info;
  if (!info.audio.length || !info.duration) return { id, peaks: null };
  return { id, peaks: await waveform(clip.path, info.duration, Math.max(50, Math.min(4000, buckets | 0))) };
}));
ipcMain.handle('add-audio', wrap(async (_e, id, p) => {
  const clip = getClip(id);
  if (!p) {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add an audio track',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXT }, { name: 'Video (use its audio)', extensions: VIDEO_EXT }, { name: 'All files', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return extrasOut(clip);
    p = r.filePaths[0];
  }
  p = cleanPath(p);
  if (!fs.existsSync(p)) throw new Error('File not found: ' + p);
  if (samePath(p, clip.path)) throw new Error("That's the clip you're editing.");
  if (clip.extras.some(x => samePath(x.path, p))) return extrasOut(clip);
  const { audio } = await ffInfo(p);
  if (!audio.length) throw new Error('No audio found in ' + path.basename(p));
  clip.extras.push({ path: p, name: path.basename(p), title: audio[0].title, channels: audio[0].channels });
  return extrasOut(clip);
}));
ipcMain.handle('remove-audio', wrap(async (_e, id, p) => {
  const clip = getClip(id);
  clip.extras = clip.extras.filter(x => x.path !== p);
  closeUnusedFds();
  return extrasOut(clip);
}));
ipcMain.handle('export', wrap((_e, o) => doExport(o || {})));
ipcMain.handle('cancel', wrap(async () => {
  state.cancelled = true;
  if (state.child) state.child.kill();
  return {};
}));
ipcMain.handle('reveal', wrap(async (_e, p) => {
  if (!state.outputs.has(p)) throw new Error('Unknown file.');
  shell.showItemInFolder(p);
  return {};
}));

ipcMain.handle('lib-scan', wrap(async () => {
  if (!scanning) scanning = scanLibrary().finally(() => { scanning = null; });
  return scanning;
}));
ipcMain.handle('game-icon', async (_e, name) => {
  try { return await gameIcon(String(name || '')); } catch (e) { return null; }
});
ipcMain.handle('lib-save-thumb', async (_e, p, dataUrl, duration) => {
  try {
    if (!inLibrary(p)) return null;
    const m = String(dataUrl || '').match(/^data:image\/jpeg;base64,(.+)$/);
    if (!m) return null;
    const st = fs.statSync(p);
    const { key, e } = await fileFacts(p, path.basename(p), st);
    const file = path.join(thumbDir(), key + '.jpg');
    fs.mkdirSync(thumbDir(), { recursive: true });
    fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
    delete e.error;
    e.thumbMade = true;
    if (duration > 0 && !e.duration) e.duration = duration;
    saveIndexSoon();
    return { url: pathToFileURL(file).href + '?' + key, duration: e.duration };
  } catch (err) { return null; }
});
ipcMain.handle('lib-thumb', async (_e, p) => {
  if (!inLibrary(p)) return { error: true };
  try { return await libThumb(p); } catch (e) { return { error: true }; }
});
ipcMain.handle('lib-action', wrap(async (_e, action, p) => {
  if (action === 'copy' && Array.isArray(p)) {
    const list = p.filter(x => inLibrary(x) && fs.existsSync(x));
    if (!list.length) throw new Error("Those clips aren't there anymore.");
    await copyFileToClipboard(list);
    return {};
  }
  if (!inLibrary(p) || !fs.existsSync(p)) throw new Error("That clip isn't there anymore.");
  if (action === 'reveal') shell.showItemInFolder(p);
  else if (action === 'copy') await copyFileToClipboard(p);
  else if (action === 'reveal-folder') { if (!isDir(p)) throw new Error("That folder isn't there anymore."); shell.openPath(p); }
  else throw new Error('Unknown action.');
  return {};
}));
// ---------- deleting (always to the Recycle Bin, always after asking) ----------
const fmtMB = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB';
function folderStats(dir) {
  const st = { videos: 0, other: 0, bytes: 0 };
  const walk = d => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try { st.bytes += fs.statSync(full).size; } catch (err) { /* ignore */ }
        if (LIB_EXT.has(path.extname(e.name).slice(1).toLowerCase())) st.videos++; else st.other++;
      }
    }
  };
  walk(dir);
  return st;
}
const openIn = p => [...clips.values()].some(c => samePath(c.path, p) || path.relative(p, c.path).split(path.sep)[0] !== '..' && !path.isAbsolute(path.relative(p, c.path)) && path.relative(p, c.path) !== '');
async function trashAll(list) {
  closeUnusedFds();
  const done = [], failed = [];
  for (const p of list) {
    try { await shell.trashItem(p); done.push(p); } catch (e) { failed.push(path.basename(p) + ': ' + (e.message || e)); }
  }
  return { trashed: done, failed };
}
// The app asks first with its own confirmation; `confirmed` skips Windows' dialog then.
ipcMain.handle('lib-trash', wrap(async (_e, paths, confirmed) => {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(p => inLibrary(p) && fs.existsSync(p));
  if (!list.length) throw new Error("Those clips aren't there anymore.");
  if (list.some(p => [...clips.values()].some(c => samePath(c.path, p)))) throw new Error("One of them is open in a tab. Close the tab first.");
  const bytes = list.reduce((s, p) => { try { return s + fs.statSync(p).size; } catch (e) { return s; } }, 0);
  if (confirmed) return trashAll(list);
  const r = await dialog.showMessageBox(win, {
    type: 'warning', title: 'Delete clips', buttons: ['Move to Recycle Bin', 'Cancel'], defaultId: 1, cancelId: 1,
    message: list.length === 1 ? `Move "${path.basename(list[0])}" to the Recycle Bin?` : `Move ${list.length} clips to the Recycle Bin?`,
    detail: `${fmtMB(bytes)}. You can restore ${list.length === 1 ? 'it' : 'them'} from the Recycle Bin.`,
  });
  if (r.response !== 0) return { cancelled: true };
  return trashAll(list);
}));
// a game's folder(s), e.g. "Peak" and "peak.exe" - only folders inside a clips folder, never
// the clips folder itself
ipcMain.handle('lib-folder-stats', wrap(async (_e, dirs) => {
  const list = (Array.isArray(dirs) ? dirs : []).filter(d => inLibrary(d) && isDir(d));
  const st = list.map(folderStats).reduce((a, b) => ({ videos: a.videos + b.videos, other: a.other + b.other, bytes: a.bytes + b.bytes }), { videos: 0, other: 0, bytes: 0 });
  return { ...st, folders: list.length };
}));
ipcMain.handle('lib-trash-folders', wrap(async (_e, dirs, label, confirmed) => {
  const list = (Array.isArray(dirs) ? dirs : []).filter(d => inLibrary(d) && isDir(d));
  if (!list.length) throw new Error("That folder isn't there anymore.");
  if (list.some(openIn)) throw new Error('A clip from that folder is open in a tab. Close the tab first.');
  const st = list.map(folderStats).reduce((a, b) => ({ videos: a.videos + b.videos, other: a.other + b.other, bytes: a.bytes + b.bytes }));
  if (confirmed) return trashAll(list);
  const parts = [`${st.videos} video${st.videos === 1 ? '' : 's'}`];
  if (st.other) parts.push(`${st.other} other file${st.other === 1 ? '' : 's'} (screenshots and such)`);
  const r = await dialog.showMessageBox(win, {
    type: 'warning', title: 'Delete folder', buttons: ['Move to Recycle Bin', 'Cancel'], defaultId: 1, cancelId: 1,
    message: `Move the ${label || path.basename(list[0])} folder${list.length > 1 ? 's' : ''} to the Recycle Bin?`,
    detail: `${list.join('\n')}\n\n${parts.join(' and ')}, ${fmtMB(st.bytes)}. You can restore it from the Recycle Bin.`,
  });
  if (r.response !== 0) return { cancelled: true };
  return trashAll(list);
}));
// NVIDIA makes a folder for every game it sees, clips or not
async function emptyFolders() {
  const out = [];
  for (const f of await libFolders()) {
    if (f.missing) continue;
    let ents = [];
    try { ents = fs.readdirSync(f.path, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      const full = path.join(f.path, e.name), st = folderStats(full);
      if (!st.videos && !st.other) out.push(full);
    }
  }
  return out;
}
ipcMain.handle('lib-empty-folders', wrap(async () => ({ folders: await emptyFolders() })));
ipcMain.handle('lib-trash-empty', wrap(async (_e, confirmed) => {
  const list = await emptyFolders();
  if (!list.length) return { trashed: [], failed: [] };
  if (confirmed) return trashAll(list);
  const r = await dialog.showMessageBox(win, {
    type: 'question', title: 'Clean up', buttons: ['Move to Recycle Bin', 'Cancel'], defaultId: 0, cancelId: 1,
    message: `Move ${list.length} empty folder${list.length === 1 ? '' : 's'} to the Recycle Bin?`,
    detail: list.map(p => path.basename(p)).join(', ') + '\n\nThey have no files in them. NVIDIA makes them again if you record that game.',
  });
  if (r.response !== 0) return { cancelled: true };
  return trashAll(list);
}));

ipcMain.handle('lib-add-folder', wrap(async () => {
  const cur = await libFolders();
  const r = await dialog.showOpenDialog(win, {
    title: 'Add a folder with clips', defaultPath: (cur[0] && cur[0].path) || app.getPath('videos'), properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { changed: false };
  const p = r.filePaths[0];
  if (cur.some(f => samePath(f.path, p))) return { changed: false };
  await setFolders([...cur.map(f => f.path), p]);
  return { changed: true };
}));
ipcMain.handle('lib-remove-folder', wrap(async (_e, p) => {
  const cur = await libFolders();
  await setFolders(cur.map(f => f.path).filter(x => !samePath(x, p)));
  return { changed: true };
}));
function dirSize(d) {
  let n = 0, files = 0;
  try { for (const f of fs.readdirSync(d)) { try { n += fs.statSync(path.join(d, f)).size; files++; } catch (e) { /* ignore */ } } } catch (e) { /* none yet */ }
  return { bytes: n, files };
}
// trims made before the trimmed folder existed, still sitting next to their originals
async function oldTrims() {
  const ex = await exportDir(), out = [];
  for (const f of await libFolders()) {
    if (f.kind === 'trimmed' || f.missing) continue;
    const walk = (d, depth) => {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 4 && !samePath(full, ex)) walk(full, depth + 1); }
        else if (/_trim\d*\.(mp4|mkv|mov|webm|m4v)$/i.test(e.name)) out.push(full);
      }
    };
    walk(f.path, 0);
  }
  return out;
}
async function moveFile(from, to) {
  try { fs.renameSync(from, to); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
  await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL); // other drive: copy, then remove
  fs.unlinkSync(from);
}
ipcMain.on('app-name', e => { e.returnValue = APP_NAME; });
ipcMain.handle('old-trims', wrap(async () => {
  const list = await oldTrims();
  return { count: list.length, bytes: list.reduce((n, p) => { try { return n + fs.statSync(p).size; } catch (e) { return n; } }, 0) };
}));
ipcMain.handle('move-old-trims', wrap(async () => {
  const list = await oldTrims();
  let moved = 0;
  const failed = [];
  for (const p of list) {
    if ([...clips.values()].some(c => samePath(c.path, p))) { failed.push(path.basename(p) + ': open in a tab'); continue; }
    try {
      const dir = path.join(await exportDir(), await gameFolderFor(p));
      fs.mkdirSync(dir, { recursive: true });
      let to = path.join(dir, path.basename(p));
      for (let n = 2; fs.existsSync(to); n++) to = path.join(dir, path.basename(p, path.extname(p)) + ` (${n})` + path.extname(p));
      await moveFile(p, to);
      moved++;
    } catch (e) { failed.push(path.basename(p) + ': ' + e.message); }
  }
  return { moved, failed };
}));
ipcMain.handle('export-pick-dir', wrap(async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Where should trimmed clips go?', defaultPath: await exportDir(), properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { changed: false };
  const s = readSettings(); s.exportDir = r.filePaths[0]; writeSettings(s);
  return { changed: true };
}));
ipcMain.handle('export-open-dir', wrap(async () => {
  const d = await exportDir();
  fs.mkdirSync(d, { recursive: true });
  const err = await shell.openPath(d);
  if (err) throw new Error(err);
  return {};
}));

ipcMain.handle('settings-get', wrap(async () => {
  const s = readSettings();
  return {
    exportDir: await exportDir(), exportDirCustom: !!s.exportDir,
    version: app.getVersion(),
    discordIdDetected: s.discordId || null, discordIdManual: s.discordIdManual || null,
    folders: await libFolders(), detected: await detectedFolders(), custom: Array.isArray(s.folders),
    cache: dirSize(thumbDir()),
  };
}));
ipcMain.handle('settings-set', wrap(async (_e, patch) => {
  const s = readSettings();
  if (patch && 'discordIdManual' in patch) {
    const v = patch.discordIdManual == null ? '' : String(patch.discordIdManual).trim();
    if (v && !/^\d{15,22}$/.test(v)) throw new Error("That doesn't look like a Discord user ID (15-22 digits).");
    if (v) s.discordIdManual = v; else delete s.discordIdManual;
  }
  writeSettings(s);
  return {};
}));
ipcMain.handle('thumbs-clear', wrap(async () => {
  fs.rmSync(thumbDir(), { recursive: true, force: true });
  thumbIndex = {};
  return {};
}));
ipcMain.handle('lib-open-folder', wrap(async (_e, p) => {
  if (!(await libFolders()).some(f => samePath(f.path, p))) throw new Error('Unknown folder.');
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
  return {};
}));
ipcMain.handle('lib-reset-folders', wrap(async () => {
  const s = readSettings(); delete s.folders; writeSettings(s);
  return { changed: true };
}));

// ---------- window / lifecycle ----------

function argvFile(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).find(a => !a.startsWith('--') && fs.existsSync(a) && fs.statSync(a).isFile());
}

function createWindow() {
  // size: last time's, else roomy enough for the library (sidebar + three cards a row), never
  // bigger than the screen
  const work = screen.getPrimaryDisplay().workAreaSize;
  const saved = readSettings().window || {};
  const onScreen = b => screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width - 100 && b.x + b.width > a.x + 100 && b.y >= a.y - 10 && b.y < a.y + a.height - 100;
  });
  const size = {
    width: Math.min(saved.width || 1500, work.width), height: Math.min(saved.height || 920, work.height),
  };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && onScreen({ ...size, x: saved.x, y: saved.y })) { size.x = saved.x; size.y = saved.y; }
  win = new BrowserWindow({
    ...size, minWidth: 980, minHeight: 640,
    backgroundColor: '#0a090c',
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // keep timers and playback running when the window is covered or in the background,
      // so the audio engine and video stay in sync (Chromium would otherwise throttle them)
      backgroundThrottling: false,
    },
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // mouse back/forward buttons (Windows sends them as app commands)
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') win.webContents.send('nav', 'back');
    else if (cmd === 'browser-forward') win.webContents.send('nav', 'forward');
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (saved.maximized) win.maximize();
  // remember size, position and maximized for next time
  let saveTimer = null;
  const remember = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      const s = readSettings();
      const b = win.isMaximized() ? (s.window || {}) : win.getBounds();
      s.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
      writeSettings(s);
    }, 400);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, remember);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// dev only: GPU engine test (tools/ isn't part of the installed app)
const engineTest = process.argv.includes('--engine-test');
if (engineTest) require('./tools/enginetest/main.js')();
const gotLock = engineTest || app.requestSingleInstanceLock();
if (engineTest) { /* the test sets up its own window */ } else if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', async (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    const f = argvFile(argv);
    if (f) {
      try { const info = await openFile(f); win && win.webContents.send('open', info); } catch (e) { /* ignore */ }
    }
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    cleanCopies();
    const f = argvFile(process.argv);
    if (f) { try { await openFile(f); } catch (e) { /* ignore */ } }
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
