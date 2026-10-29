// GPU engine test: decode with WebCodecs (through Mediabunny), composite with WebGPU,
// play against a clock, scrub, and export by encoding the composited frames with WebCodecs.
// Everything is measured and written to results.json.
import {
  Input, ALL_FORMATS, CustomSource, VideoSampleSink, VideoSample, VideoSampleSource,
  Output, Mp4OutputFormat, StreamTarget, QUALITY_HIGH, canEncodeVideo,
} from '../../renderer/vendor/mediabunny.min.mjs';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const logBox = $('log');
function log(text, cls) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = text;
  logBox.append(d);
  logBox.scrollTop = logBox.scrollHeight;
}
const r2 = x => Math.round(x * 100) / 100;
const stats = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return { avg: r2(s.reduce((a, b) => a + b, 0) / s.length), p95: r2(s[Math.floor(s.length * 0.95)] ?? s[s.length - 1]), max: r2(s[s.length - 1]) };
};

// ---------- WebGPU compositor ----------
// One pass per frame: the video as an external texture (sampled straight from the decoder's
// YUV frame), then any number of layers (text, images) as textured quads with position,
// size and opacity.
const SHADER = /* wgsl */`
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vfull(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VOut;
  o.pos = vec4f(p[i], 0, 1);
  o.uv = vec2f((p[i].x + 1) * 0.5, 1 - (p[i].y + 1) * 0.5);
  return o;
}
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var vid: texture_external;
@fragment fn fvideo(i: VOut) -> @location(0) vec4f { return textureSampleBaseClampToEdge(vid, samp, i.uv); }

struct Layer { rect: vec4f, opacity: f32 };   // rect in 0..1 canvas units: x, y, w, h
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> L: Layer;
@vertex fn vquad(@builtin(vertex_index) i: u32) -> VOut {
  var c = array<vec2f, 6>(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
  let q = c[i];
  let xy = L.rect.xy + q * L.rect.zw;
  var o: VOut;
  o.pos = vec4f(xy.x * 2 - 1, 1 - xy.y * 2, 0, 1);
  o.uv = q;
  return o;
}
@fragment fn flayer(i: VOut) -> @location(0) vec4f { return textureSample(tex, samp, i.uv) * L.opacity; }
`;

class Compositor {
  static async create(canvas) {
    if (!navigator.gpu) throw new Error('WebGPU not available');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    const c = new Compositor();
    c.adapterInfo = adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description, device: adapter.info.device } : null;
    c.device = await adapter.requestDevice();
    c.canvas = canvas;
    c.ctx = canvas.getContext('webgpu');
    c.format = navigator.gpu.getPreferredCanvasFormat();
    c.ctx.configure({ device: c.device, format: c.format, alphaMode: 'opaque' });
    const mod = c.device.createShaderModule({ code: SHADER });
    c.sampler = c.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    c.vidPipe = c.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vfull' },
      fragment: { module: mod, entryPoint: 'fvideo', targets: [{ format: c.format }] },
    });
    c.layerPipe = c.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vquad' },
      fragment: {
        module: mod, entryPoint: 'flayer',
        targets: [{ format: c.format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }],
      },
    });
    c.layers = [];
    return c;
  }
  // a layer from any image source (canvas, ImageBitmap); returned object's rect/opacity can be changed per frame
  addLayer(source) {
    const { device } = this;
    const w = source.width, h = source.height;
    const tex = device.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source }, { texture: tex, premultipliedAlpha: true }, [w, h]);
    const ubuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({
      layout: this.layerPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: this.sampler }, { binding: 2, resource: tex.createView() }, { binding: 3, resource: { buffer: ubuf } }],
    });
    const layer = { tex, ubuf, bind, rect: [0, 0, 0.2, 0.2], opacity: 1, visible: true };
    this.layers.push(layer);
    return layer;
  }
  draw(frame) {
    const { device } = this;
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
    if (frame) {
      const ext = device.importExternalTexture({ source: frame });
      const bind = device.createBindGroup({ layout: this.vidPipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.sampler }, { binding: 1, resource: ext }] });
      pass.setPipeline(this.vidPipe);
      pass.setBindGroup(0, bind);
      pass.draw(3);
    }
    pass.setPipeline(this.layerPipe);
    for (const l of this.layers) {
      if (!l.visible) continue;
      device.queue.writeBuffer(l.ubuf, 0, new Float32Array([...l.rect, l.opacity, 0, 0, 0]));
      pass.setBindGroup(0, l.bind);
      pass.draw(6);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
  }
}

// layers that move and fade with time, like a title and a sticker would
function makeLayers(comp, W, H) {
  const tc = new OffscreenCanvas(Math.round(W * 0.5), Math.round(H * 0.12));
  const g = tc.getContext('2d');
  g.font = `700 ${Math.round(tc.height * 0.62)}px "Segoe UI", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = tc.height * 0.08; g.strokeStyle = '#000'; g.fillStyle = '#fff';
  g.strokeText('GPU engine test', tc.width / 2, tc.height / 2);
  g.fillText('GPU engine test', tc.width / 2, tc.height / 2);
  const text = comp.addLayer(tc);
  const ic = new OffscreenCanvas(256, 256);
  const h = ic.getContext('2d');
  const grad = h.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#5865f2'); grad.addColorStop(1, '#eb459e');
  h.fillStyle = grad; h.beginPath(); h.roundRect(0, 0, 256, 256, 48); h.fill();
  h.fillStyle = '#fff'; h.font = '700 120px "Segoe UI", sans-serif'; h.textAlign = 'center'; h.textBaseline = 'middle'; h.fillText('CE', 128, 136);
  const img = comp.addLayer(ic);
  const imgW = 0.14, imgH = imgW * W / H;
  return t => {
    text.rect = [0.25, 0.08, 0.5, 0.12];
    text.opacity = 0.6 + 0.4 * Math.sin(t * 2) ** 2;
    const x = 0.05 + 0.75 * (0.5 + 0.5 * Math.sin(t * 0.9));
    img.rect = [x, 0.62, imgW, imgH];
    img.opacity = 0.85;
  };
}

// ---------- input ----------
async function openClip(p) {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new CustomSource({ getSize: () => ET.size(p), read: (a, b) => ET.read(p, a, b), prefetchProfile: 'fileSystem' }),
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video track');
  const dur = await input.computeDuration();
  const stats = await track.computePacketStats(300);
  const cfg = await track.getDecoderConfig();
  return { input, track, dur, fps: stats.averagePacketRate, bitrate: stats.averageBitrate, cfg, W: track.displayWidth, H: track.displayHeight, codec: track.codec };
}

// ---------- tests ----------
async function decodeSpeed(clip, start, len) {
  const sink = new VideoSampleSink(clip.track);
  const t0 = performance.now();
  let n = 0;
  for await (const s of sink.samples(start, start + len)) { n++; s.close(); }
  const sec = (performance.now() - t0) / 1000;
  return { frames: n, seconds: r2(sec), fps: r2(n / sec), xRealtime: r2(len / sec) };
}

// real-time playback against a clock: a decode loop keeps a few frames queued, each display
// refresh shows the newest frame that's due
async function playback(clip, comp, animate, start, len) {
  const sink = new VideoSampleSink(clip.track);
  const queue = [];
  let produced = 0, ended = false, wake = null;
  (async () => {
    for await (const s of sink.samples(start, start + len)) {
      queue.push(s); produced++;
      while (queue.length >= 8) await new Promise(r => { wake = r; });
    }
    ended = true;
  })();
  while (queue.length < 4 && !ended) await sleep(5);
  let shown = 0, dropped = 0, stalls = 0, refreshes = 0;
  const drawMs = [], gaps = [];
  let lastShown = null;
  const t0 = performance.now();
  await new Promise(resolve => {
    const tick = now => {
      refreshes++;
      const clock = start + (now - t0) / 1000;
      while (queue.length > 1 && queue[1].timestamp <= clock) {
        const s = queue.shift();
        if (!s._shown) dropped++;
        s.close();
        if (wake) { wake(); wake = null; }
      }
      const s = queue[0];
      if (s && s.timestamp <= clock && !s._shown) {
        const a = performance.now();
        animate(clock);
        const f = s.toVideoFrame();
        comp.draw(f);
        f.close();
        drawMs.push(performance.now() - a);
        s._shown = true; shown++;
        if (lastShown !== null) gaps.push((now - lastShown));
        lastShown = now;
      } else if (!s && !ended) stalls++;
      if (clock >= start + len || (ended && queue.length <= 1 && (!queue[0] || queue[0]._shown))) {
        for (const q of queue) q.close();
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const wall = (performance.now() - t0) / 1000;
  return {
    seconds: r2(wall), produced, shown, dropped, stalls, displayRefreshes: refreshes,
    refreshHz: r2(refreshes / wall), shownFps: r2(shown / wall),
    drawCpuMs: stats(drawMs), frameGapMs: stats(gaps),
  };
}

async function scrub(clip, comp, animate) {
  const sink = new VideoSampleSink(clip.track);
  const jumps = [], steps = [];
  for (let i = 0; i < 15; i++) {
    const t = Math.random() * Math.max(0, clip.dur - 1);
    const a = performance.now();
    const s = await sink.getSample(t);
    if (s) { animate(t); const f = s.toVideoFrame(); comp.draw(f); f.close(); s.close(); }
    jumps.push(performance.now() - a);
  }
  // frame-by-frame forward from one spot (arrow-key stepping)
  const base = Math.min(clip.dur / 2, Math.max(0, clip.dur - 3));
  for (let i = 0; i < 30; i++) {
    const t = base + i / (clip.fps || 60);
    const a = performance.now();
    const s = await sink.getSample(t);
    if (s) { animate(t); const f = s.toVideoFrame(); comp.draw(f); f.close(); s.close(); }
    steps.push(performance.now() - a);
  }
  // dragging the playhead: many requests in a row, only the newest matters
  const drag = [];
  const t0 = performance.now();
  for await (const s of sink.samplesAtTimestamps(Array.from({ length: 40 }, (_x, i) => (clip.dur * 0.1) + i * 0.25))) {
    if (s) { const f = s.toVideoFrame(); comp.draw(f); f.close(); s.close(); }
  }
  drag.push((performance.now() - t0) / 40);
  return { randomJumpMs: stats(jumps), frameStepMs: stats(steps), dragPerFrameMs: r2(drag[0]) };
}

const CODECS = {
  avc: W => (W * (W * 9 / 16) > 2228224 ? 'avc1.640034' : 'avc1.640033'),
  hevc: () => 'hvc1.1.6.L153.B0',
  av1: () => 'av01.0.12M.08',
};
async function encoderSupport(W, H, fps) {
  const out = {};
  for (const [name, f] of Object.entries(CODECS)) {
    for (const hw of ['prefer-hardware', 'prefer-software']) {
      try {
        const r = await VideoEncoder.isConfigSupported({ codec: f(W), width: W, height: H, bitrate: 12e6, framerate: fps, hardwareAcceleration: hw });
        out[`${name}/${hw}`] = !!r.supported;
      } catch (e) { out[`${name}/${hw}`] = 'error: ' + e.message; }
    }
  }
  return out;
}

// export: decode -> composite on the GPU -> encode with WebCodecs -> mp4 on disk
async function exportTest(clip, comp, animate, start, len, codec, hw, tag) {
  const name = `export-${tag}.mp4`;
  const outPath = await ET.openOut(name);
  const writable = new WritableStream({ write: c => ET.write(c.position, c.data) });
  const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(writable, { chunked: true, chunkSize: 8 << 20 }) });
  let encoderConfig = null;
  const src = new VideoSampleSource({ codec, bitrate: QUALITY_HIGH, hardwareAcceleration: hw, latencyMode: 'quality', onEncoderConfig: c => { encoderConfig = { codec: c.codec, hardwareAcceleration: c.hardwareAcceleration, bitrate: c.bitrate }; } });
  output.addVideoTrack(src); // no frameRate: Chromium lists 1440p/4K hardware encoding at <=30 fps, and the hint alone blocks it
  await output.start();
  const sink = new VideoSampleSink(clip.track);
  let n = 0, snap = false;
  const t0 = performance.now();
  for await (const s of sink.samples(start, start + len)) {
    animate(s.timestamp);
    const f = s.toVideoFrame();
    comp.draw(f);
    f.close();
    const out = new VideoFrame(comp.canvas, { timestamp: Math.max(0, Math.round((s.timestamp - start) * 1e6)), duration: Math.round((s.duration || 1 / 60) * 1e6) });
    if (!snap && n === 30) {
      snap = true;
      const oc = new OffscreenCanvas(out.displayWidth, out.displayHeight);
      oc.getContext('2d').drawImage(out, 0, 0);
      const blob = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      await ET.save(`frame-${tag}.jpg`, new Uint8Array(await blob.arrayBuffer()));
    }
    s.close();
    const sample = new VideoSample(out);
    await src.add(sample);
    sample.close();
    n++;
  }
  await output.finalize();
  await ET.closeOut();
  const sec = (performance.now() - t0) / 1000;
  return { codec, hw, frames: n, seconds: r2(sec), fps: r2(n / sec), xRealtime: r2(len / sec), encoderConfig, file: outPath };
}

// ---------- run ----------
if (!new URLSearchParams(location.search).has('diag')) (async () => {
  const result = { when: new Date().toISOString(), userAgent: navigator.userAgent, clips: [] };
  try {
    const cfg = await ET.config();
    const canvas = $('c');
    log('Engine test', 'h');
    for (const p of cfg.clips) {
      const R = { path: p };
      result.clips.push(R);
      try {
        log(`\n${p.split(/[\\/]/).pop()}`, 'h');
        const clip = await openClip(p);
        Object.assign(R, { codec: clip.codec, decoderCodec: clip.cfg && clip.cfg.codec, width: clip.W, height: clip.H, fps: r2(clip.fps), duration: r2(clip.dur), mbps: r2(clip.bitrate / 1e6) });
        log(`${clip.W}x${clip.H} ${R.fps} fps, ${clip.codec} (${R.decoderCodec}), ${R.mbps} Mbps, ${R.duration}s`);
        try {
          const ds = await VideoDecoder.isConfigSupported({ ...clip.cfg, hardwareAcceleration: 'prefer-hardware' });
          R.decoderSupported = !!ds.supported;
        } catch (e) { R.decoderSupported = 'error: ' + e.message; }
        canvas.width = clip.W; canvas.height = clip.H;
        const comp = await Compositor.create(canvas);
        if (!result.gpu) result.gpu = comp.adapterInfo;
        log(`GPU: ${JSON.stringify(comp.adapterInfo)}`);
        const animate = makeLayers(comp, clip.W, clip.H);
        const start = Math.min(5, Math.max(0, clip.dur - 12));
        const len = Math.min(10, clip.dur - start - 0.5);

        log('decode speed...'); R.decode = await decodeSpeed(clip, start, len); log(JSON.stringify(R.decode));
        log('playback (10s, real time)...'); R.playback = await playback(clip, comp, animate, start, len); log(JSON.stringify(R.playback));
        log('scrubbing...'); R.scrub = await scrub(clip, comp, animate); log(JSON.stringify(R.scrub));
        if (!result.encoders) { result.encoders = await encoderSupport(clip.W, clip.H, clip.fps || 60); log('encoders: ' + JSON.stringify(result.encoders)); }
        R.exports = [];
        const tag = R.width + 'p' + (cfg.clips.indexOf(p) + 1);
        const tries = [['avc', 'prefer-hardware', len], ['avc', 'prefer-software', Math.min(4, len)], ['hevc', 'prefer-hardware', len], ['av1', 'prefer-hardware', len]];
        for (const [codec, hw, l] of tries) {
          if (!(await canEncodeVideo(codec, { width: clip.W, height: clip.H }))) { R.exports.push({ codec, hw, skipped: 'cannot encode' }); log(`${codec} ${hw}: can't encode here`); continue; }
          log(`export ${codec} ${hw} (${r2(l)}s)...`);
          try { const e = await exportTest(clip, comp, animate, start, l, codec, hw, `${tag}-${codec}-${hw === 'prefer-hardware' ? 'hw' : 'sw'}`); R.exports.push(e); log(JSON.stringify(e)); }
          catch (e) { R.exports.push({ codec, hw, error: String(e && e.message || e) }); log(`failed: ${e && e.message || e}`, 'bad'); await ET.closeOut(); }
        }
        // the current app's export path, same range, for comparison
        const av1 = /^av01|^av1/i.test(clip.cfg && clip.cfg.codec || '');
        for (const c of ['x264', 'nvenc']) {
          log(`ffmpeg ${c}...`);
          const f = await ET.ffmpeg(p, start, len, c, av1);
          R[`ffmpeg_${c}`] = f.ok ? { seconds: r2(f.seconds), xRealtime: r2(len / f.seconds) } : { error: f.err || 'failed' };
          log(JSON.stringify(R[`ffmpeg_${c}`]));
        }
        clip.input.dispose && clip.input.dispose();
      } catch (e) {
        R.error = String(e && e.stack || e);
        log('ERROR ' + R.error, 'bad');
      }
    }
  } catch (e) {
    result.error = String(e && e.stack || e);
    log('ERROR ' + result.error, 'bad');
  }
  log('\ndone', 'ok');
  await ET.done(result);
})();
