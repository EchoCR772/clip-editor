// GPU engine test (dev only). Not part of the installed app: main.js loads this file only when
// started with --engine-test, and tools/ isn't packaged.
//   npx electron . --engine-test --clip="<video>" [--clip="<video2>"] --out="<folder>"
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

module.exports = function runEngineTest() {
  const arg = n => process.argv.filter(a => a.startsWith(`--${n}=`)).map(a => a.slice(n.length + 3).replace(/^"(.*)"$/, '$1'));
  // its own profile, so it never touches the installed app's settings or caches
  app.setPath('userData', path.join(app.getPath('temp'), 'clip-engine-test-profile'));
  const clips = arg('clip');
  const outDir = arg('out')[0] || path.join(app.getPath('temp'), 'engine-test');
  fs.mkdirSync(outDir, { recursive: true });
  const allowed = new Set(clips.map(p => path.resolve(p)));
  const fds = new Map();
  const fdFor = p => {
    const r = path.resolve(p);
    if (!allowed.has(r)) throw new Error('not a test clip');
    if (!fds.has(r)) fds.set(r, fs.openSync(r, 'r'));
    return fds.get(r);
  };
  let outFd = null;
  let FFMPEG = require('ffmpeg-static');
  if (FFMPEG) FFMPEG = FFMPEG.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

  ipcMain.handle('et-config', () => ({ clips, outDir }));
  ipcMain.handle('et-size', (_e, p) => fs.fstatSync(fdFor(p)).size);
  ipcMain.handle('et-read', (_e, p, a, b) => {
    const len = Math.max(0, Math.min(b - a, 64 << 20));
    const buf = Buffer.allocUnsafe(len);
    const n = fs.readSync(fdFor(p), buf, 0, len, a);
    return new Uint8Array(buf.buffer, buf.byteOffset, n);
  });
  ipcMain.handle('et-open-out', (_e, name) => {
    if (outFd !== null) fs.closeSync(outFd);
    const p = path.join(outDir, path.basename(name));
    outFd = fs.openSync(p, 'w');
    return p;
  });
  ipcMain.handle('et-write', (_e, pos, data) => { fs.writeSync(outFd, Buffer.from(data), 0, data.byteLength, pos); });
  ipcMain.handle('et-close-out', () => { if (outFd !== null) { fs.closeSync(outFd); outFd = null; } });
  ipcMain.handle('et-save', (_e, name, data) => { fs.writeFileSync(path.join(outDir, path.basename(name)), Buffer.from(data)); });
  // the current export path for comparison: same range, no layers
  ipcMain.handle('et-ffmpeg', (_e, src, start, len, codec, av1) => new Promise(resolve => {
    const out = path.join(outDir, `ffmpeg-${codec}.mp4`);
    const args = ['-y', '-hide_banner', '-loglevel', 'error', ...(av1 ? ['-hwaccel', 'd3d11va', '-c:v', 'av1'] : []),
      '-ss', String(start), '-i', src, '-t', String(len), '-map', '0:v:0', '-an',
      ...(codec === 'x264' ? ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'] : ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '19']), out];
    const t0 = Date.now();
    const c = spawn(FFMPEG, args, { windowsHide: true });
    let err = '';
    c.stderr.on('data', d => { err += d; });
    c.on('error', e => resolve({ ok: false, err: e.message }));
    c.on('close', code => resolve({ ok: code === 0, seconds: (Date.now() - t0) / 1000, err: err.slice(-300) }));
  }));
  ipcMain.handle('et-done', (_e, result) => {
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(result, null, 1));
    process.stdout.write('ENGINE_TEST_DONE\n');
    setTimeout(() => app.quit(), 1500);
  });

  // --engine-diag: what the GPU process reports about hardware video encoding
  if (process.argv.includes('--engine-diag')) {
    app.whenReady().then(async () => {
      const out = { featureStatus: app.getGPUFeatureStatus() };
      try {
        const info = await app.getGPUInfo('complete');
        out.encodeProfiles = info.videoEncodeAcceleratorSupportedProfile || info.videoEncodeAcceleratorSupportedProfiles || null;
        out.decodeProfiles = (info.videoDecodeAcceleratorSupportedProfile || []).length;
        out.gpuDevice = info.gpuDevice;
        out.auxAttributes = info.auxAttributes && { glRenderer: info.auxAttributes.glRenderer, driverVersion: info.auxAttributes.driverVersion };
        out.keys = Object.keys(info);
      } catch (e) { out.gpuInfoError = String(e); }
      const w = new BrowserWindow({ width: 400, height: 200, show: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
      await w.loadFile(path.join(__dirname, 'index.html'), { query: { diag: '1' } }).catch(() => {});
      out.encodeSupport = await w.webContents.executeJavaScript(`(async () => {
        const r = {};
        for (const [name, codec] of [['avc', 'avc1.640033'], ['hevc', 'hvc1.1.6.L153.B0'], ['av1', 'av01.0.12M.08']])
          for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
            for (const fps of [30, 60, 0]) {
              const c = { codec, width: w, height: h, bitrate: 8e6, hardwareAcceleration: 'prefer-hardware' };
              if (fps) c.framerate = fps;
              try { const x = await VideoEncoder.isConfigSupported(c); r[name + ' ' + h + 'p@' + (fps || 'none')] = x.supported; }
              catch (e) { r[name + ' ' + h + 'p@' + (fps || 'none')] = 'err ' + e.message; }
            }
        // actually encode a few 1440p frames on the hardware path, to see what really happens
        try {
          const cv = new OffscreenCanvas(2560, 1440); cv.getContext('2d').fillRect(0, 0, 10, 10);
          let chunks = 0, err = null;
          const enc = new VideoEncoder({ output: () => { chunks++; }, error: e => { err = String(e); } });
          enc.configure({ codec: 'avc1.640033', width: 2560, height: 1440, bitrate: 8e6, framerate: 30, hardwareAcceleration: 'prefer-hardware' });
          const t0 = performance.now();
          for (let i = 0; i < 60; i++) { const f = new VideoFrame(cv, { timestamp: i * 33333 }); enc.encode(f, { keyFrame: i === 0 }); f.close(); }
          await enc.flush();
          r['real 1440p avc hw encode'] = { chunks, err, ms: Math.round(performance.now() - t0) };
        } catch (e) { r['real 1440p avc hw encode'] = 'err ' + e.message; }
        return r;
      })()`);
      fs.writeFileSync(path.join(outDir, 'diag-' + (arg('tag')[0] || 'default') + '.json'), JSON.stringify(out, null, 1));
      app.quit();
    });
    return;
  }

  app.whenReady().then(() => {
    const w = new BrowserWindow({
      width: 1280, height: 860, backgroundColor: '#111214', title: 'Engine test', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    w.loadFile(path.join(__dirname, 'index.html'));
  });
  app.on('window-all-closed', () => app.quit());
};
