// Library and window: card controls, right-click menu, rename from the menu, folder filter, games
// sidebar, tabs (open, switch, Ctrl+Tab, back/forward, prev/next clip), settings overlay, and
// scrolling (no previews start mid-scroll, every card has its picture, refreshes don't rebuild cards).
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
    check(await w.$eval('#libname', e => e.textContent) === 'All clips', 'library tab name');

    // right-click menu and rename
    await w.mouse.click(b.x, b.y, { button: 'right' }); await w.waitForTimeout(300);
    const menu = await w.$$eval('#ctxmenu button', els => els.map(e => e.innerText));
    check(menu.join('|') === 'Copy Video|Edit|Rename|Show in Folder|Delete', 'right-click menu', menu);
    await w.click('#ctxmenu >> text=Rename'); await w.waitForTimeout(300);
    await w.fill('.modal-in', 'Best clip'); await w.keyboard.press('Enter'); await w.waitForTimeout(800);
    check(await w.$eval('.clip >> nth=0', e => e.querySelector('.ctitle').textContent) === 'Best clip', 'rename from the menu');

    // NEW: clips saved since the view was last left; opening one clears it
    await w.evaluate(() => { L.newSince = 1; L.viewKey = viewKey(); renderGrid(); });
    const news = await w.$$eval('#libgrid .clip .cnew', e => e.length);
    check(news > 1, 'NEW badges', news);
    check(await w.$eval('.month', e => e.textContent) !== '', 'month sections');
    await w.click('.clip >> nth=1'); await w.waitForSelector('#qt.on'); await w.waitForTimeout(600);
    await w.keyboard.press('Escape'); await w.waitForTimeout(600);
    check(await w.$$eval('#libgrid .clip .cnew', e => e.length) === news - 1, 'opening a clip clears its NEW');
    await w.evaluate(() => { L.newSince = Date.now(); renderGrid(); });

    // folders: untick "nv" -> only the Discord-style clips; games follow
    await w.click('#folderbtn'); await w.waitForTimeout(400);
    check(await w.$eval('#folderbox', e => e.classList.contains('open')), 'folders panel opens');
    const before = await w.$$eval('#libgrid .clip', e => e.length);
    await w.click('.frow:has-text("nv")'); await w.waitForTimeout(600);
    const after = await w.$$eval('#libgrid .clip', els => els.map(e => e._clip.root.split(/[\\/]/).pop()));
    check(after.length < before && after.every(r => r === 'dc'), 'only the chosen folder', after);
    check(await w.$eval('#foldertext', e => e.textContent) === 'dc', 'folder button label', await w.$eval('#foldertext', e => e.textContent));
    const games = await w.$$eval('.game .gname', e => e.map(x => x.textContent));
    check(!games.includes('Peak') && games.includes('Deadlock'), 'games without clips there are hidden', games);
    await w.click('.frow:has-text("dc")'); await w.waitForTimeout(300);
    check(await w.$eval('#foldertext', e => e.textContent) === 'dc', 'the last folder stays on');
    await w.click('.frow:has-text("nv")'); await w.waitForTimeout(500);

    // the editor: next clip, the title bar's name closes it, back/forward
    await w.click('.game:has-text("Destiny 2")'); await w.waitForTimeout(500);
    check(await w.$eval('#libname', e => e.textContent) === 'Destiny 2', 'title bar follows the game');
    await w.click('.clip >> nth=0'); await w.waitForSelector('#qt.on'); await w.waitForTimeout(1000);
    const first = await w.$eval('#qtname', e => e.textContent);
    await w.click('#qtnext'); await w.waitForTimeout(1200);
    const second = await w.$eval('#qtname', e => e.textContent);
    check(second !== first, 'next clip', [first, second]);
    check(await w.$$eval('#tabs .cliptab', t => t.length) === 0, 'no tabs');
    await w.click('#libtab'); await w.waitForTimeout(500);
    check(await w.$eval('#qt', e => e.hidden), 'the title closes the editor');
    await w.click('.clip >> nth=1'); await w.waitForSelector('#qt.on'); await w.waitForTimeout(800);
    await w.click('.clip >> nth=0').catch(() => {});
    await w.mouse.click(5, 500); await w.waitForTimeout(500);
    check(await w.$eval('#qt', e => e.hidden), 'clicking outside closes the editor');
    await w.click('#navback'); await w.waitForTimeout(600);
    check(await w.$eval('#qt', e => e.hidden), 'back skips closed clips');

    // settings is an overlay; Escape closes it
    await w.click('#appmenu'); await w.waitForTimeout(200); await w.hover('#ctxmenu >> text=File'); await w.waitForTimeout(200); await w.click('#ctxsub >> text=Settings'); await w.waitForTimeout(500);
    check(await w.$eval('#setov', e => !e.hidden && /Clip folders/.test(e.textContent)), 'settings overlay');
    await w.keyboard.press('Escape'); await w.waitForTimeout(400);
    check(await w.$eval('#setov', e => e.hidden), 'Escape closes settings');
    check(!run.errs.length, 'no page errors (cards)', run.errs);
  } catch (err) { check(false, 'test crashed: ' + err.message); } finally { await run.app.close(); }

  run = await launch({ name: 'library-big', library: bigLibrary() });
  try {
    const { w } = run;
    await w.waitForFunction(() => [...document.querySelectorAll('.clip')].every(c => c.querySelector(':scope > img')), null, { timeout: 30000 }).catch(() => {});
    check(await w.evaluate(() => [...document.querySelectorAll('.clip')].filter(c => !c.querySelector(':scope > img')).length) === 0, 'every card has its picture');
    await w.evaluate(() => { window.__v = 0; new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'VIDEO') window.__v++; }).observe(document.getElementById('libgrid'), { childList: true, subtree: true }); });
    await w.mouse.move(700, 500);
    for (let i = 0; i < 20; i++) { await w.mouse.wheel(0, 300); await w.waitForTimeout(50); }
    check(await w.evaluate(() => window.__v) === 0, 'no previews start while scrolling');
    await w.waitForTimeout(400);
    const c = await w.evaluate(() => { const els = [...document.querySelectorAll('.clip')].filter(x => { const b = x.getBoundingClientRect(); return b.top > 100 && b.bottom < 900; }); const b = els[0].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await w.mouse.move(c.x, c.y); await w.waitForTimeout(250); await w.mouse.wheel(0, -120); await w.waitForTimeout(600); await w.mouse.move(c.x + 3, c.y + 3); await w.waitForTimeout(1200);
    check(await w.evaluate(() => window.__v) >= 1, 'card under the mouse previews after scrolling stops');
    // a library refresh (a new clip saved, say) keeps the existing cards instead of rebuilding them
    await w.evaluate(() => { window.__old = [...document.querySelectorAll('#libgrid .clip')]; L.sig = ''; loadLibrary(); });
    await w.waitForTimeout(1500);
    const kept = await w.evaluate(() => { const now = [...document.querySelectorAll('#libgrid .clip')]; return { same: now.filter(x => window.__old.includes(x)).length, total: now.length, loading: now.filter(x => x.classList.contains('loading')).length }; });
    check(kept.same === kept.total && kept.total > 0 && kept.loading === 0, 'refresh keeps the cards', kept);
    check(!run.errs.length, 'no page errors (scrolling)', run.errs);
  } catch (err) { check(false, 'test crashed: ' + err.message); } finally { await run.app.close(); done(); }
})();
