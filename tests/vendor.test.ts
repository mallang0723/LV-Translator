import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import provenance from '../src/vendor/tt-1.8.0/provenance.json';
import { NARRATION_STYLE_EXAMPLE } from '../src/vendor/tt-1.8.0/example-narration-style';

const dir = new URL('../src/vendor/tt-1.8.0/', import.meta.url).pathname;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const BLOCK = /^\/\/ ==== BEGIN VERBATIM (\S+) \(upstream [^\n]*? L(\d+)-L(\d+), sha256 ([0-9a-f]{64})\)\n([\s\S]*?)\n\/\/ ==== END VERBATIM \1$/gm;

function blocks() {
  const out: Array<{ key: string; start: number; end: number; header: string; text: string }> = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    for (const m of source.matchAll(BLOCK)) out.push({ key: `${file}#${m[1]}`, start: Number(m[2]), end: Number(m[3]), header: m[4]!, text: m[5]! });
  }
  return out;
}

describe('vendored Translation Tools 1.8.0 code', () => {
  test('every verbatim block matches the stored SHA-256 and every slice is present', () => {
    const found = blocks();
    expect(found.map((b) => b.key).sort()).toEqual(Object.keys(provenance.slices).sort());
    for (const b of found) {
      const expected = (provenance.slices as Record<string, { sha256: string; startLine: number; endLine: number }>)[b.key]!;
      expect(sha(b.text)).toBe(expected.sha256);
      expect(b.header).toBe(expected.sha256);
      expect([b.start, b.end]).toEqual([expected.startLine, expected.endLine]);
    }
  });

  test('the bundled 기타 지침 example is the upstream file', () => {
    expect(sha(NARRATION_STYLE_EXAMPLE)).toBe(provenance.example.sha256);
    expect(NARRATION_STYLE_EXAMPLE).toContain('ABSOLUTE WORD BAN');
  });

  test('blocks equal the upstream commit when the clone is present', () => {
    const clone = join(homedir(), 'dev/marinara-translation-tools-upstream');
    if (!existsSync(join(clone, '.git'))) return;
    let upstream: string;
    try {
      upstream = execFileSync('git', ['-C', clone, 'show', `${provenance.commit}:${provenance.file}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
    } catch {
      return; // commit not in this clone
    }
    expect(sha(upstream)).toBe(provenance.fileSha256);
    const lines = upstream.split('\n');
    for (const b of blocks()) expect(lines.slice(b.start - 1, b.end).join('\n')).toBe(b.text);
  });
});
