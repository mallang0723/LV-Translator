// Runs the original's own tests (vendored, unmodified) against the vendored original extension.js, as the original's README
// does: `node tests/<name>.test.js personal-extension/extension.js`. Needs Playwright for some of them:
//   PLAYWRIGHT_DIR=/path/to/node_modules node scripts/test-original.mjs     (the directory that contains `playwright`)
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = join(fileURLToPath(new URL('../', import.meta.url)), 'src/vendor/tt-1.10.0');
// The repo is `type: module`; the original's tests are CommonJS. Run unmodified copies from a scratch folder
// (nothing but the original may live under src/vendor).
const work = mkdtempSync(join(tmpdir(), 'tt-original-'));
cpSync(base, work, { recursive: true });
writeFileSync(join(work, 'package.json'), '{"type":"commonjs"}');
const env = { ...process.env, ...(process.env.PLAYWRIGHT_DIR ? { NODE_PATH: process.env.PLAYWRIGHT_DIR } : {}) };
let failed = 0;
for (const name of readdirSync(join(work, 'tests')).filter((f) => f.endsWith('.js')).sort()) {
  const r = spawnSync('node', [join(work, 'tests', name), join(work, 'personal-extension/extension.js')], { env, encoding: 'utf8', cwd: work });
  const lines = (r.stdout + r.stderr).split('\n');
  const pass = lines.filter((l) => /^PASS/.test(l)).length;
  const fail = lines.filter((l) => /^FAIL/.test(l)).length;
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${name}  pass=${pass} fail=${fail}`);
  if (r.status !== 0) {
    failed++;
    console.log(lines.slice(-12).join('\n'));
  }
}
process.exit(failed ? 1 : 0);
