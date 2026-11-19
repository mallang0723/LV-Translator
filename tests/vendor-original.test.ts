import { expect, test } from 'bun:test';
import { verify } from '../scripts/verify-original.mjs';

// Every file under src/vendor/tt-1.10.0 is the original, byte for byte (SHA-256 pins; also git show of the pinned commit when a clone exists).
test('the vendored original Translation Tools 1.10.0 is unmodified', () => {
  const r = verify();
  expect(r.problems).toEqual([]);
  expect(r.patched).toBe(0);
  expect(r.identical).toBe(r.files);
});
