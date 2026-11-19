// Provenance check for the whole-file vendor copy of the original Translation Tools 1.10.0
// (tlsiddl/marinara-translation-tools, commit 0ff1338). Every file under src/vendor/tt-1.10.0/ must
// be byte-identical to the pinned original (SHA-256 below) and nothing else may live there.
// When a clone of the original exists, each file is also compared with `git show <commit>:<path>`.
//   node scripts/verify-original.mjs      (UPSTREAM_TT=/path/to/clone to override the clone location)
// Exit 0 = all identical. Prints counts: files / identical / patched (patched is always 0: the original is
// never edited; host differences live in src/host-emu/, outside vendor).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMMIT = '0ff1338';
export const VENDOR = 'src/vendor/tt-1.10.0';
export const PINS = {
  'personal-extension/extension.js': 'e2b1db9b0b4d29523eda7e4f951b9d2e551a265408cf9e0131e18f14c3187234',
  'personal-extension/manifest.json': '15815363ceac75b141854bdcef0e6f285ae40592d49587fd4b157b221c85bdce',
  'README.md': '72ff8292042a60dc2196aeadc26b8aa59e80218813e356d61172476bf1eb859d',
  'tests/auto-collect.test.js': '6afc3d05dfd698726f9221efc667a71e4ad1f833bd3e725a858a995e043060f8',
  'tests/auto-translate.test.js': '4dcc91104815714f90724738bd2973fcfac4192b3387cea2e896710a94bb0517',
  'tests/notes.test.js': '01399ced3396ef82191aef82249fb57190dfb49ec62e3092fb4f778d60d74005',
  'tests/speaker-names.test.js': 'c6eff3d8c792c75650bf3894dc4a14a130ff5a1ef732a796615bc352f84b1b92',
  'tests/test.js': 'f101fa3efbf1e43301cdf58044a042cf30944503890453d498a3db5849108d91',
  '기타 지침/지문 문체.txt': '178c33f27392ae9d4c326bde3c938ab15fada546887e6dc9976d20ca72761649',
};
/** Anchor patches applied to a vendor file by a script (none: the original is run whole). */
export const PATCHED = [];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function verify(root = fileURLToPath(new URL('../', import.meta.url))) {
  const problems = [];
  const base = join(root, VENDOR);
  const present = existsSync(base) ? walk(base).map((p) => relative(base, p)) : [];
  for (const f of present) if (!(f in PINS)) problems.push(`${f}: not a pinned original file (nothing else may live under vendor)`);
  let identical = 0;
  const clone = process.env.UPSTREAM_TT ?? join(homedir(), 'dev/marinara-translation-tools-upstream');
  const haveClone = existsSync(join(clone, '.git'));
  for (const [file, pin] of Object.entries(PINS)) {
    const p = join(base, file);
    if (!existsSync(p)) { problems.push(`${file}: missing`); continue; }
    const buf = readFileSync(p);
    let ok = true;
    if (sha(buf) !== pin) { problems.push(`${file}: sha256 ${sha(buf)} != pinned ${pin}`); ok = false; }
    if (haveClone) {
      try {
        const orig = execFileSync('git', ['-C', clone, 'show', `${COMMIT}:${file}`], { maxBuffer: 64 << 20 });
        if (!orig.equals(buf)) { problems.push(`${file}: differs from git ${COMMIT}`); ok = false; }
      } catch { problems.push(`${file}: not found in git ${COMMIT}`); ok = false; }
    }
    if (ok) identical++;
  }
  return { problems, files: Object.keys(PINS).length, identical, patched: PATCHED.length, comparedWithGit: haveClone };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = verify();
  console.log(JSON.stringify({ ok: !r.problems.length, files: r.files, identical: r.identical, patched: r.patched, comparedWithGit: r.comparedWithGit }));
  for (const b of r.problems) console.log(b);
  process.exit(r.problems.length ? 1 : 0);
}
