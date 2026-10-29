// Overlay panel: collapse to the rail and back, rail labels, rail actions and menu, remembered state.
const { launch, checker, openDiscordClip } = require('./helpers');

(async () => {
  const { check, done } = checker('panel');
  const { app, w, errs } = await launch({ name: 'panel' });
  try {
    await openDiscordClip(w);
    const open = await w.$eval('#qtlane', e => e.clientWidth);
    await w.click('#qtcollapse'); await w.waitForTimeout(700);
    const collapsed = await w.$eval('#qtlane', e => e.clientWidth);
    check(collapsed > open + 200, 'timeline grows when collapsed', [open, collapsed]);
    await w.hover('#qtrcopy'); await w.waitForTimeout(200);
    check(await w.$eval('#tip', t => !t.hidden && t.textContent) === 'Copy Video', 'rail label');
    await w.click('#qtrcopy');
    await w.waitForFunction(() => /Copied|fail/i.test(document.getElementById('qtnote').textContent), null, { timeout: 30000 });
    check(await w.$eval('#qtnote', n => n.classList.contains('on') && /^Copied/.test(n.textContent)), 'message floats while collapsed');
    await w.click('#qtrmore'); await w.waitForTimeout(200);
    check(await w.$eval('#ctxmenu', m => !m.hidden && /Copy Audio/.test(m.innerText)), 'rail menu opens');
    await w.click('#qtrmore'); await w.waitForTimeout(200);
    check(await w.$eval('#ctxmenu', m => m.hidden), 'rail menu closes on second click');
    await w.keyboard.press('Escape'); await w.waitForTimeout(600);
    await w.click('.clip >> nth=0'); await w.waitForSelector('#qt.on'); await w.waitForTimeout(800);
    check(await w.$eval('.qt-box', b => b.classList.contains('collapsed')), 'collapsed state remembered');
    await w.click('#qtrexpand'); await w.waitForTimeout(600);
    check(await w.$eval('.qt-box', b => !b.classList.contains('collapsed')), 'expands again');
    check(!errs.length, 'no page errors', errs);
  } catch (err) { check(false, 'test crashed: ' + err.message); } finally { await app.close(); done(); }
})();
