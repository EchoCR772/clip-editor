// Runs every *.test.js in this folder (one after another) and reports PASS/FAIL for each.
//   xvfb-run -a node tests/run.js            all tests
//   xvfb-run -a node tests/run.js overlay    tests whose name contains "overlay"
//   add --gpu to also run the overlay with software WebGPU
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const gpu = process.argv.includes('--gpu');
const tests = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && (!only.length || only.some(o => f.includes(o))));
let failed = 0;
for (const t of tests) {
  const runs = gpu && t === 'overlay.test.js' ? [[], ['--gpu']] : [[]];
  for (const extra of runs) {
    const r = spawnSync(process.execPath, [path.join(__dirname, t), ...extra], { stdio: 'inherit', timeout: 300000 });
    if (r.status !== 0) failed++;
  }
}
console.log(failed ? `${failed} test file(s) failed` : 'all tests passed');
process.exit(failed ? 1 : 0);
