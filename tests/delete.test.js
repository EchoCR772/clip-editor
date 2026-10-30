// Deleting: the confirm text follows Settings > Deleting (Recycle Bin by default, or permanently),
// no Shift shortcut skips it, and the empty-folder cleanup removes only folders with nothing in them.
const fs = require('fs');
const path = require('path');
const { launch, checker, OUT, FIX } = require('./helpers');

(async () => {
  const { check, done } = checker('delete');
  // a throwaway library (never touch the fixtures): two clips, one empty game folder (with an empty
  // subfolder), one folder with a screenshot, one hidden folder
  const lib = path.join(OUT, 'dellib', 'nv');
  fs.rmSync(path.dirname(lib), { recursive: true, force: true });
  const src = path.join(FIX, 'nv');
  const games = fs.readdirSync(src).filter(d => fs.statSync(path.join(src, d)).isDirectory());
  let copied = 0;
  for (const g of games) {
    for (const f of fs.readdirSync(path.join(src, g))) {
      if (copied >= 2 || !/\.mp4$/i.test(f)) continue;
      fs.mkdirSync(path.join(lib, g), { recursive: true });
      fs.copyFileSync(path.join(src, g, f), path.join(lib, g, f)); copied++;
    }
  }
  fs.mkdirSync(path.join(lib, 'Arc Raiders', 'sub'), { recursive: true });
  fs.mkdirSync(path.join(lib, 'Screens'), { recursive: true }); fs.writeFileSync(path.join(lib, 'Screens', 'shot.png'), 'x');
  fs.mkdirSync(path.join(lib, '.autoclip-cache'), { recursive: true });

  const run = await launch({ name: 'delete', library: [lib] });
  try {
    const { w } = run;
    const first = await w.$eval('.clip >> nth=0', e => e._clip.path);
    // default: Recycle Bin wording, no Shift hint
    await w.click('.clip >> nth=0', { button: 'right' }); await w.waitForTimeout(200);
    await w.click('#ctxmenu >> text=Delete'); await w.waitForSelector('.modal-ov.on .mbtn.danger');
    const t1 = await w.$eval('.modal-ov.on .modal', e => e.textContent);
    check(/Recycle Bin/.test(t1) && !/Shift/.test(t1), 'default asks to move to the Recycle Bin, no Shift hint', t1);
    await w.click('.modal-ov.on .mbtn:not(.danger)'); await w.waitForTimeout(300);

    // Settings > Deleting > Delete permanently
    await w.keyboard.press('Control+Comma'); await w.waitForTimeout(500);
    const opts = await w.$$eval('.setsec', ss => { const s = ss.find(x => x.querySelector('h3').textContent === 'Deleting'); return s ? [...s.querySelectorAll('.setopt')].map(e => [e.querySelector('.setname').textContent, e.classList.contains('on')]) : null; });
    check(JSON.stringify(opts) === JSON.stringify([['Move to the Recycle Bin', true], ['Delete permanently', false]]), 'Deleting setting, Recycle Bin by default', opts);
    await w.click('.setopt:has-text("Delete permanently")'); await w.waitForTimeout(400);

    // empty folders: only "Arc Raiders" (with its empty subfolder); not the hidden one or the one with a file
    await w.waitForFunction(() => /empty folder/.test(document.querySelector('#setbody').textContent));
    const etxt = await w.$$eval('.setsec', ss => ss.find(x => x.querySelector('h3').textContent === 'Empty folders').textContent);
    check(/1 empty folder/.test(etxt) && /Arc Raiders/.test(etxt) && !/autoclip/.test(etxt), 'empty folders skip hidden ones', etxt);
    await w.click('.setsec:has(h3:text-is("Empty folders")) >> text=Delete'); await w.waitForSelector('.modal-ov.on .mbtn.danger');
    await w.click('.modal-ov.on .mbtn.danger'); await w.waitForTimeout(800);
    check(!fs.existsSync(path.join(lib, 'Arc Raiders')) && fs.existsSync(path.join(lib, 'Screens', 'shot.png')) && fs.existsSync(path.join(lib, '.autoclip-cache')), 'only the empty folder is deleted (not to the Recycle Bin)');
    await w.keyboard.press('Escape'); await w.waitForTimeout(400);

    // delete a clip permanently
    await w.click('.clip >> nth=0', { button: 'right' }); await w.waitForTimeout(200);
    await w.click('#ctxmenu >> text=Delete'); await w.waitForSelector('.modal-ov.on .mbtn.danger');
    const t2 = await w.$eval('.modal-ov.on .modal', e => e.textContent);
    check(/permanently deleted/.test(t2) && !/Shift/.test(t2), 'permanent wording', t2);
    await w.click('.modal-ov.on .mbtn.danger'); await w.waitForTimeout(800);
    check(!fs.existsSync(first), 'the clip is gone');
    check(!(await w.$$eval('.clip', els => els.map(e => e._clip.path))).includes(first), 'its card is gone');
    check(/Deleted the clip/.test(await w.$eval('body', e => e.textContent)), 'toast says deleted');
    check(!run.errs.length, 'no page errors', run.errs);
  } catch (err) { check(false, 'test crashed: ' + err.message); } finally { await run.app.close(); done(); }
})();
