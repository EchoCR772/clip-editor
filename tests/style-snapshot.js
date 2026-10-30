// Records the computed style of every element in several app states, for proving a CSS cleanup
// changes nothing:  node tests/style-snapshot.js before.json  ->  edit CSS  ->  node tests/style-snapshot.js after.json
//                   node tests/style-snapshot.js --compare before.json after.json
const fs = require('fs');
const { launch } = require('./helpers');

if (process.argv[2] === '--compare') {
  const A = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), B = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  let total = 0;
  for (const st of Object.keys(A)) {
    const da = Object.fromEntries(A[st].map(x => [x[0], x])), db = Object.fromEntries((B[st] || []).map(x => [x[0], x]));
    let d = 0;
    for (const k of Object.keys(da)) {
      if (!db[k]) { d++; continue; }
      if (/\bfill\b/.test(da[k][1])) continue; // live seek bar of a playing preview
      for (const part of [2, 3, 4]) for (const p of new Set([...Object.keys(da[k][part]), ...Object.keys(db[k][part])])) if (da[k][part][p] !== db[k][part][p]) { d++; if (d < 6) console.log(st, k.slice(-80), p, da[k][part][p], '->', db[k][part][p]); }
    }
    console.log(st, 'differences:', d); total += d;
  }
  console.log(total ? `DIFFERENT (${total})` : 'IDENTICAL');
  process.exit(total ? 1 : 0);
}

(async () => {
  const outFile = process.argv[2] || 'styles.json';
  const { app, w } = await launch({ name: 'snapshot' });
  const snap = () => w.evaluate(() => {
    const out = [];
    const path = el => { const p = []; for (let e = el; e && e !== document.documentElement; e = e.parentElement) p.unshift(e.tagName + (e.id ? '#' + e.id : '') + '[' + [...e.parentElement.children].indexOf(e) + ']'); return p.join('>'); };
    const ser = cs => { const o = {}; for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]); return o; };
    for (const el of document.querySelectorAll('*')) out.push([path(el), typeof el.className === 'string' ? el.className : '', ser(getComputedStyle(el)), ser(getComputedStyle(el, '::before')), ser(getComputedStyle(el, '::after'))]);
    return out;
  });
  const settle = () => w.waitForTimeout(1200);
  const S = {};
  S.lib = await snap();
  const box = await w.$eval('.clip', e => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await w.mouse.move(box.x, box.y); await settle(); S.hoverCard = await snap();
  await w.keyboard.down('Control'); await w.mouse.click(box.x, box.y); await w.keyboard.up('Control'); await settle(); S.selecting = await snap();
  await w.keyboard.press('Escape'); await settle();
  await w.mouse.click(box.x, box.y, { button: 'right' }); await settle(); S.ctxmenu = await snap();
  await w.keyboard.press('Escape'); await settle();
  await w.mouse.move(box.x, box.y); await settle(); await w.click('.clip .cact .cbtn >> nth=1'); await settle(); S.modal = await snap();
  await w.keyboard.press('Escape'); await settle();
  await w.hover('#sidetoggle'); await settle(); S.sideHover = await snap();
  await w.click('#sidetoggle'); await settle(); await w.mouse.move(700, 500); await settle(); S.collapsed = await snap();
  await w.hover('#games .game >> nth=1'); await settle(); S.railTip = await snap();
  await w.click('#sidetoggle'); await settle();
  await w.click('#appmenu'); await w.waitForTimeout(200); await w.hover('#ctxmenu >> text=File'); await w.waitForTimeout(200); await w.click('#ctxsub >> text=Settings'); await settle(); S.settings = await snap();
  await w.keyboard.press('Escape'); await settle();
  await w.click('#folderbtn'); await settle(); S.folders = await snap();
  await w.click('#folderbtn'); await settle();
  await w.click('.clip >> nth=0'); await w.waitForSelector('#qt.on'); await settle(); await settle(); S.overlay = await snap();
  await w.keyboard.press('Escape'); await settle();
  fs.writeFileSync(outFile, JSON.stringify(S));
  console.log('wrote', outFile);
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
