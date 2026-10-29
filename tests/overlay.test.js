// Quick-trim overlay end to end: open, play, trim with keys, playhead stays inside the selection,
// mute a row, export video/audio, copy (background-prepared), menus, saved trim, card length.
const fs = require('fs');
const path = require('path');
const { launch, checker, openDiscordClip } = require('./helpers');

(async () => {
  const gpu = process.argv.includes('--gpu');
  const { check, done } = checker('overlay' + (gpu ? ' (webgpu)' : ''));
  const { app, w, errs, ud, ex } = await launch({ name: 'overlay', gpu });
  try {
    await openDiscordClip(w);
    check(await w.$eval('#qtstage', e => e.dataset.renderer) === (gpu ? 'webgpu' : '2d'), 'player renderer', await w.$eval('#qtstage', e => e.dataset.renderer));
    const rows = await w.$$eval('.qt-arow', els => els.map(e => e.innerText.trim()));
    check(rows.join('|') === 'Game / Desktop|Mic / Voices', 'Discord audio rows', rows);

    await w.keyboard.press('Space'); await w.waitForTimeout(1200); await w.keyboard.press('Space');
    const played = await w.$eval('#qtcur', e => e.textContent);
    check(played !== '0:00.00', 'playback advances', played);

    // trim 1s..4s with the keyboard
    await w.keyboard.press('Home'); await w.keyboard.press('Shift+ArrowRight'); await w.keyboard.press('i');
    await w.keyboard.press('l'); await w.keyboard.press('Shift+ArrowLeft'); await w.keyboard.press('o');
    await w.waitForTimeout(500);
    check(await w.$eval('#qtlen', e => e.textContent) === '0:03.00', 'trim length', await w.$eval('#qtlen', e => e.textContent));

    // clicking left of the selection keeps the playhead at the selection start
    const lane = await w.$eval('#qtlane', e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y }; });
    await w.mouse.click(lane.x + 2, lane.y + 80); await w.waitForTimeout(300);
    check(await w.$eval('#qtcur', e => e.textContent) === '0:01.00', 'playhead trapped in selection', await w.$eval('#qtcur', e => e.textContent));

    // export with the game audio muted
    await w.click('.qt-amute >> nth=0'); await w.waitForTimeout(400);
    await w.click('#qtsave');
    await w.waitForFunction(() => /Exported|fail|Invalid/i.test(document.getElementById('qtstatus').textContent), null, { timeout: 30000 });
    check(/^Exported .*_trim\.mp4/.test(await w.$eval('#qtstatus', e => e.textContent)), 'export video', await w.$eval('#qtstatus', e => e.textContent));
    await w.click('.qt-amute >> nth=0'); await w.waitForTimeout(300);

    // export audio from the "..." menu
    await w.click('#qtmore'); await w.waitForTimeout(200);
    await w.click('#ctxmenu >> text=Export Audio File');
    await w.waitForFunction(() => /\.mp3/.test(document.getElementById('qtstatus').textContent) || /fail/i.test(document.getElementById('qtstatus').textContent), null, { timeout: 30000 });
    check(/^Exported .*_trim\.mp3/.test(await w.$eval('#qtstatus', e => e.textContent)), 'export audio', await w.$eval('#qtstatus', e => e.textContent));

    // copy: the trimmed clip is made in the background, so this should be near-instant
    await w.waitForTimeout(3000);
    const t0 = Date.now();
    await w.click('#qtcopy');
    await w.waitForFunction(() => /Copied|fail/i.test(document.getElementById('qtstatus').textContent), null, { timeout: 30000 });
    const ms = Date.now() - t0;
    check(/^Copied/.test(await w.$eval('#qtstatus', e => e.textContent)), 'copy video', await w.$eval('#qtstatus', e => e.textContent));
    check(ms < 1500, 'copy uses the background-made clip (fast)', ms);

    // menus: arrow next to Copy Video, arrow next to Export; clicking again closes
    await w.click('#qtcopymenu'); await w.waitForTimeout(200);
    check(await w.$eval('#ctxmenu', m => !m.hidden && m.innerText === 'Copy Audio'), 'copy arrow menu');
    await w.click('#qtcopymenu'); await w.waitForTimeout(200);
    check(await w.$eval('#ctxmenu', m => m.hidden), 'copy arrow closes on second click');
    await w.click('#qtsavemenu'); await w.waitForTimeout(200);
    check(await w.$eval('#ctxmenu', m => m.innerText) === 'Export as...\nExport audio as...', 'export arrow menu', await w.$eval('#ctxmenu', m => m.innerText));
    await w.keyboard.press('Escape'); await w.waitForTimeout(200);
    check(await w.$eval('#ctxmenu', m => m.hidden) && await w.$eval('#qt', q => q.classList.contains('on')), 'Escape closes the menu, not the overlay');

    // close: the trim is saved and the card shows the trimmed length
    await w.keyboard.press('Escape'); await w.waitForTimeout(800);
    check(await w.$eval('#qt', e => e.hidden), 'overlay closes');
    const card = await w.$eval('.clip >> nth=0', e => ({ len: e.querySelector('.cdur').textContent, edit: e._clip.edit, dur: e._clip.duration }));
    check(card.len === '0:03', 'card shows trimmed length', card);
    const edits = JSON.parse(fs.readFileSync(path.join(ud, 'edits.json'), 'utf8'));
    const e = Object.values(edits)[0] || {};
    check(e.in === 1 && e.out === 4, 'edits.json has the trim', e);
    await w.click('.clip >> nth=0'); await w.waitForSelector('#qt.on'); await w.waitForTimeout(1200);
    check(await w.$eval('#qtlen', e2 => e2.textContent) === '0:03.00', 'trim restored on reopen');
    await w.keyboard.press('Escape'); await w.waitForTimeout(500);

    // Copy Video on a trimmed card makes the trimmed clip first
    const b = await w.$eval('.clip >> nth=0', el => { const x = el.getBoundingClientRect(); return { x: x.x + x.width / 2, y: x.y + x.height / 2 }; });
    await w.mouse.move(b.x, b.y); await w.waitForTimeout(500);
    await w.click('.clip >> nth=0 >> .hbtn.primary'); await w.waitForTimeout(4000);
    check(/Copied/.test(await w.$eval('#libtoast', t => t.textContent)), 'card copy of a trimmed clip', await w.$eval('#libtoast', t => t.textContent));

    const files = fs.readdirSync(ex, { recursive: true }).map(String);
    check(files.some(f => /Destiny 2[\\/].*_trim\.mp4$/.test(f)) && files.some(f => /_trim\.mp3$/.test(f)), 'files in the exports folder, by game', files);
    check(!errs.length, 'no page errors', errs);
  } catch (err) { check(false, 'test crashed: ' + err.message); } finally { await app.close(); done(); }
})();
