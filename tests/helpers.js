// Shared setup for the end-to-end tests: launches the app with Playwright against the fake clip
// library in tests/fixtures, with its own throwaway profile and exports folder in tests/out.
const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const FIX = path.join(__dirname, 'fixtures');
const LIB = [path.join(FIX, 'nv'), path.join(FIX, 'dc')];

// a big library for scrolling tests: copies of one small clip under many NVIDIA-style names
function bigLibrary(n = 64) {
  const dir = path.join(OUT, 'biglib', 'nv');
  const src = path.join(FIX, 'nv', 'Desktop', 'Desktop 2026.10.27 - 15.36.33.06.DVR.mp4');
  for (let i = 0; i < n; i++) {
    const game = ['Peak', 'Destiny 2', 'Deadlock', 'Desktop'][i % 4];
    const d = new Date(2026, 9, 28 - (i % 27), i % 24, i % 60, i % 60);
    const p2 = x => String(x).padStart(2, '0');
    const f = path.join(dir, game, `${game} ${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} - ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}.${p2(i)}.DVR.mp4`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (!fs.existsSync(f)) fs.copyFileSync(src, f);
  }
  return [dir];
}

async function launch({ name = 'run', library = LIB, gpu = false, keepProfile = false } = {}) {
  const ud = path.join(OUT, 'profile-' + name);
  const ex = path.join(OUT, 'exports-' + name);
  if (!keepProfile) fs.rmSync(ud, { recursive: true, force: true });
  fs.rmSync(ex, { recursive: true, force: true });
  fs.mkdirSync(ex, { recursive: true });
  // software WebGPU in a headless container; without these flags the player uses its 2D fallback
  const gpuFlags = gpu ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] : [];
  const app = await _electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')),
    args: [ROOT, '--user-data-dir=' + ud, ...gpuFlags],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1', CLIP_TRIMMER_LIBRARY: library.join(path.delimiter), CLIP_TRIMMER_EXPORTS: ex },
  });
  const w = await app.firstWindow();
  const errs = [];
  w.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 400)));
  w.on('console', m => { if (m.type() === 'error' && !/No available adapters/.test(m.text())) errs.push('console: ' + m.text()); });
  await w.setViewportSize({ width: 1500, height: 920 });
  await w.waitForSelector('.clip', { timeout: 20000 });
  await w.waitForTimeout(1200);
  return { app, w, errs, ud, ex };
}

// tiny assertion helper: collects failures instead of stopping at the first
function checker(testName) {
  const fails = [];
  const check = (ok, what, got) => { if (!ok) fails.push(`${what}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ''}`); };
  const done = () => {
    if (fails.length) { console.log(`FAIL ${testName}\n  - ` + fails.join('\n  - ')); process.exitCode = 1; }
    else console.log(`PASS ${testName}`);
  };
  return { check, done };
}

// open the Discord "Destiny 2" fixture clip (has Discord-style multi-track audio) in the overlay
async function openDiscordClip(w) {
  await w.click('.game:has-text("dc")'); await w.waitForTimeout(400);
  await w.click('.game:has-text("Destiny 2")'); await w.waitForTimeout(500);
  await w.click('.clip >> nth=0');
  await w.waitForSelector('#qt.on', { timeout: 5000 });
  await w.waitForFunction(() => document.getElementById('qtstage').dataset.renderer, null, { timeout: 15000 });
  await w.waitForTimeout(1200);
}

module.exports = { ROOT, OUT, FIX, LIB, bigLibrary, launch, checker, openDiscordClip };
