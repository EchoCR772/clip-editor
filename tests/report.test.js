// "Help add recording software": the card beside a newly added folder, the preview (exactly what is
// sent, username replaced), sending (to a local stand-in for the form), closing the card for good,
// and the Settings section.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { launch, checker, OUT, FIX } = require('./helpers');

(async () => {
  const { check, done } = checker('report');
  // a fake "SteelSeries Moments" folder with a subfolder per game, and a plain one
  const root = path.join(OUT, 'replib');
  fs.rmSync(root, { recursive: true, force: true });
  const ss = path.join(root, 'SteelSeries Moments'), other = path.join(root, 'Captures2');
  const clip = (() => { for (const g of fs.readdirSync(path.join(FIX, 'nv'))) { const d = path.join(FIX, 'nv', g); if (!fs.statSync(d).isDirectory()) continue; const f = fs.readdirSync(d).find(x => /\.mp4$/i.test(x)); if (f) return path.join(d, f); } })();
  for (const [d, n] of [[path.join(ss, 'Valorant'), 'Valorant_2026-10-30_21-14-02.mp4'], [path.join(ss, 'Deadlock'), 'Deadlock_2026-10-29_20-01-10.mp4'], [other, 'clip.mp4']]) {
    fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(clip, path.join(d, n));
  }
  // stand-in for the Google Form
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { got.push(b); res.end('ok'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.CLIP_TRIMMER_REPORT_URL = `http://127.0.0.1:${srv.address().port}/formResponse`;
  process.env.HOME = path.resolve(OUT, '..', '..', '..'); // so the folder sits under "your user folder"

  const run = await launch({ name: 'report', library: [path.join(FIX, 'nv'), ss, other] });
  try {
    const { w } = run;
    // a folder was just added -> the card shows beside its row
    await w.evaluate(d => folderAdded({ ok: true, changed: true, added: d }), ss);
    await w.waitForSelector('.rcard.on', { timeout: 5000 });
    const card = await w.evaluate(() => { const c = document.querySelector('.rcard'), r = c.getBoundingClientRect(), s = document.querySelector('#libside').getBoundingClientRect(); return { left: r.left, side: s.right, text: c.textContent }; });
    check(card.left > card.side && /Help add this recording software/.test(card.text) && /See what's sent/.test(card.text), 'card beside the sidebar', card);
    check(await w.$eval('#folderbox', e => e.classList.contains('open')), 'Folders panel opens to show the folder');

    // the preview
    await w.click('.rcard >> text=See what\'s sent');
    await w.waitForSelector('.modal.report .report-pre', { timeout: 10000 });
    const pv = await w.evaluate(() => ({ name: document.querySelector('.modal.report .modal-in').value, pre: document.querySelector('.report-pre').textContent, all: document.querySelector('.modal.report').textContent }));
    check(pv.name === 'SteelSeries Moments', 'recording software guessed from the folder', pv.name);
    check(/Layout: a subfolder per game \(2 subfolders\)/.test(pv.pre) && /Valorant_2026-10-30_21-14-02\.mp4/.test(pv.pre), 'layout and example files', pv.pre);
    check(/%USERPROFILE%/.test(pv.pre) && !pv.pre.includes(process.env.HOME), 'user folder replaced', pv.pre.split('\n')[1]);
    check(/Audio tracks: (\d+|none)/.test(pv.pre) && /App version/.test(pv.all) && /%USERNAME%/.test(pv.all), 'audio tracks, version and the privacy note shown');
    await w.click('.modal.report .mbtn.primary'); await w.waitForTimeout(1200);
    check(got.length === 1, 'sent once', got.length);
    const sent = new URLSearchParams(got[0] || '');
    check(sent.get('entry.1525447683') === 'SteelSeries Moments' && /^\d+\.\d+\.\d+$/.test(sent.get('entry.388380471') || '') && sent.get('entry.1049009954') === pv.pre, 'sent exactly what was shown', [...sent.keys()]);
    check(!(got[0] || '').includes(encodeURIComponent(process.env.HOME)) && !(got[0] || '').includes(process.env.HOME), 'no user folder in what was sent');
    check(!(await w.$('.modal.report')), 'preview closes after sending');
    check(await w.evaluate(async d => (await T.reportCard(d)).show, ss) === false, 'no card again for a folder already sent');

    // closing the card is for good
    await w.evaluate(d => reportCard(d), other);
    await w.waitForSelector('.rcard.on', { timeout: 5000 });
    await w.click('.rcard .rc-x'); await w.waitForTimeout(400);
    check(!(await w.$('.rcard.on')), 'card closes');
    check(await w.evaluate(async d => (await T.reportCard(d)).show, other) === false, 'closed card stays closed');

    // Settings section
    await w.keyboard.press('Control+Comma'); await w.waitForTimeout(800);
    const rows = await w.$$eval('.setsec', ss2 => { const s = ss2.find(x => x.querySelector('h3').textContent === 'Help add recording software'); return s ? [...s.querySelectorAll('.setrow')].map(r => r.innerText.replace(/\s+/g, ' ')) : null; });
    check(rows && rows.length === 3 && rows.some(r => /SteelSeries Moments .*Sent · send again/.test(r)) && rows.some(r => /Send info/.test(r)), 'Settings lists the folders and what was sent', rows);
    check(!run.errs.length, 'no page errors', run.errs);
  } catch (err) { check(false, 'test crashed: ' + err.message); } finally { await run.app.close(); srv.close(); done(); }
})();
