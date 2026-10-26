// Syntax-checks every JavaScript file with `node --check`.
//
// The shared security pipeline (neotree/security-ci) requires a `lint` script. This one has
// no dependencies, so it adds nothing to install and nothing that runs install hooks.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'logs', '.git']);

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && full.endsWith('.js')) files.push(full);
  }
};
walk(ROOT);

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(result.stderr || `${file}: syntax check failed\n`);
  }
}

process.stdout.write(`lint: ${files.length} file(s) checked, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
