import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { applyAnchors, LEGACY_UUID_PATCHES, patchLegacyAssembly, patchOriginal, UUID_PATCHES } from '../scripts/patches.mjs';
import { newId, type UUIDContext } from '../src/uuid';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const original = readFileSync(new URL('../src/vendor/tt-1.10.0/personal-extension/extension.js', import.meta.url), 'utf8');
const legacy = readFileSync(new URL('../src/vendor/tt-1.8.0/assembly.ts', import.meta.url), 'utf8');

// Deliberately stronger than the host: reject the capability name anywhere,
// including aliases, optional/bracket access, destructuring and embedded scripts.
const blocked = /randomUUID/;

describe('frontend UUID compatibility', () => {
  test('every shipped frontend bundle is free of the blocked API', () => {
    const dist = new URL('../dist/', import.meta.url);
    const files = readdirSync(dist).filter((file) => /^frontend.*\.js$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(new URL(file, dist), 'utf8');
      expect(source).not.toMatch(blocked);
      expect(source).toContain('0.5.11');
      expect(source).toContain('marinara.newId()');
    }
  });

  test.each([
    'crypto.randomUUID()', 'crypto?.randomUUID()', 'crypto["randomUUID"]()',
    'crypto?.["randomUUID"]()', 'const {randomUUID: id} = crypto;',
    'const c = crypto; c.randomUUID()', 'const w = window; w.crypto.randomUUID()',
    '// crypto.randomUUID()',
  ])('regression guard rejects %s', (source) => expect(source).toMatch(blocked));

  test('host v4 keeps its receiver and needs no platform entropy', () => {
    const ctx = { uuid: { value: 'host-id', v4() { return this.value; } } };
    expect(newId(ctx)).toBe('host-id');
  });

  test('HTTP fallback uses only getRandomValues and sets version/variant bits', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    let calls = 0;
    const api = { getRandomValues(bytes: Uint8Array) { expect(this).toBe(api); calls++; return bytes.fill(255); } };
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: api });
    try {
      for (const ctx of [undefined, {}, { uuid: {} }, { uuid: { v4: null } } as unknown as UUIDContext]) {
        expect(newId(ctx)).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
      }
      expect(calls).toBe(4);
    } finally {
      Object.defineProperty(globalThis, 'crypto', descriptor);
    }
  });

  test('legacy-host IDs are valid and distinct', () => {
    const ids = Array.from({ length: 100 }, () => newId());
    expect(ids.every((id) => uuid.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('all three vendor anchors replace only the ID calls', () => {
    const patched = patchOriginal(original);
    expect(patched).not.toMatch(blocked);
    expect(patchLegacyAssembly(legacy)).not.toMatch(blocked);
    for (const patch of UUID_PATCHES) {
      expect(patched).toContain(patch.after);
      const generate = new Function('marinara', patch.after);
      expect(generate({ newId: () => newId({ uuid: { v4: () => 'host-id' } }) })).toBe(`${patch.id.slice(5)}-host-id`);
    }
    const restored = UUID_PATCHES.reduce((source, patch) => source.replace(patch.after, patch.before), patched);
    expect(restored).toBe(original);
    const legacyPatched = applyAnchors(legacy, LEGACY_UUID_PATCHES);
    expect(legacyPatched.replace(LEGACY_UUID_PATCHES[0]!.after, LEGACY_UUID_PATCHES[0]!.before)).toBe(legacy);
    const generateLegacy = new Function('host', 'newId', LEGACY_UUID_PATCHES[0]!.after);
    expect(generateLegacy({ uuid: { v4: () => 'host-id' } }, newId)).toBe('note-host-id');
    expect(generateLegacy({}, newId).slice(5)).toMatch(uuid);
  });

  test('missing or duplicate anchors fail closed', () => {
    for (const patches of [UUID_PATCHES, LEGACY_UUID_PATCHES]) {
      expect(() => applyAnchors('', patches)).toThrow('exactly one anchor');
      expect(() => applyAnchors(patches.map((p) => p.before).join('\n').repeat(2), patches)).toThrow('exactly one anchor');
    }
  });
});
