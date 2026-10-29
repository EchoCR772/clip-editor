// Library: card hover controls, right-click menu, old editor still reachable, and scrolling
// (no previews start mid-scroll, every card has its picture, the card under the mouse previews after).
const { launch, checker, bigLibrary } = require('./helpers');

(async () => {
  const { check, done } = checker('library');
  let run = await launch({ name: 'library' });
  try {
    const { w } = run;
    const b = await w.$eval('.clip >> nth=0', e => { const x = e.getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2 }; });
    await w.mouse.move(b.x, b.y); await w.waitForTimeout(800);
    check(await w.$eval('.clip >> nth=0', e => [...e.querySelectorAll('.hbtn')].map(x => x.innerText.trim()).join('|')) === 'Trim|Copy Video', 'card buttons');
    const lens = await w.$$eval('#libgrid .clip', els => els.map(e => [e._clip.name, e.querySelector('.cdur').textContent]));
    check(lens.every(([n, l]) => /^\d+:\d\d$/.test(l)), 'every card shows its length', lens.filter(([n, l]) => !/^\d+:\d\d$/.test(l)));
    await w.mouse.click(b.x, b.y, { button: 'right' }); await w.waitForTimeout(300);
    const menu = await w.$$eval('#ctxmenu button', els => els.map(e => e.innerText));
    check(menu.join('|') === 'Copy Video|Quick trim|Edit|Show in Folder|Delete', 'right-click menu', menu);
    await w.click('#ctxmenu >> text=Edit');
    await w.waitForFunction(() => page === 'edit' && dur > 0, null, { timeout: 15000 });
    check(!run.errs.length, 'no page errors (cards)', run.errs);
  } catch (err) { check(false, 'test crashed: ' + err.message); } finally { await run.app.close(); }

  run = await launch({ name: 'library-big', library: bigLibrary() });
  try {
    const { w } = run;
    await w.waitForTimeout(5000);
    check(await w.evaluate(() => [...document.querySelectorAll('.clip')].filter(c => !c.querySelector(':scope > img')).length) === 0, 'every card has its picture');
    await w.evaluate(() => { window.__v = 0; new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'VIDEO') window.__v++; }).observe(document.getElementById('libgrid'), { childList: true, subtree: true }); });
    await w.mouse.move(700, 500);
    for (let i = 0; i < 20; i++) { await w.mouse.wheel(0, 300); await w.waitForTimeout(50); }
    check(await w.evaluate(() => window.__v) === 0, 'no previews start while scrolling');
    await w.waitForTimeout(400);
    const c = await w.evaluate(() => { const els = [...document.querySelectorAll('.clip')].filter(x => { const b = x.getBoundingClientRect(); return b.top > 100 && b.bottom < 900; }); const b = els[0].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await w.mouse.move(c.x, c.y); await w.waitForTimeout(250); await w.mouse.wheel(0, -120); await w.waitForTimeout(600); await w.mouse.move(c.x + 3, c.y + 3); await w.waitForTimeout(1200);
    check(await w.evaluate(() => window.__v) >= 1, 'card under the mouse previews after scrolling stops');
    check(!run.errs.length, 'no page errors (scrolling)', run.errs);
  } catch (err) { check(false, 'test crashed: ' + err.message); } finally { await run.app.close(); done(); }
})();
