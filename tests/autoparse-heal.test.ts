// 0.5.7: (A) the off-screen heal switch is a stored setting, default on; (B) Lumiverse's reasoning Auto-parse hands the display a think-stripped,
// trimmed body, but nothing 0.5.x stores, keys or writes uses that text: the write path works on the STORED text, think block included.
// (The browser side of both, with a real DOM, is scripts/qa-original.mjs "0.5.7".)
import { describe, expect, test } from 'bun:test';
import { mergeParagraphEdit } from '../src/host-emu/backend-ops';
import { blockKey } from '../src/adapter/keys';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared';

describe('0.5.7 (A) healOffscreen setting', () => {
  test('default on; a store saved before 0.5.7 (no key) reads as on; an explicit off stays off; junk falls back to the base', () => {
    expect(DEFAULT_SETTINGS.healOffscreen).toBe(true);
    expect(normalizeSettings({ modelLanguage: 'English' }).healOffscreen).toBe(true);
    expect(normalizeSettings({ healOffscreen: false }).healOffscreen).toBe(false);
    expect(normalizeSettings({ healOffscreen: 'no' }).healOffscreen).toBe(true);
    expect(normalizeSettings({}, { ...DEFAULT_SETTINGS, healOffscreen: false }).healOffscreen).toBe(false);
  });
});

describe('0.5.7 (B) Auto-parse: the write path never sees the think-stripped text', () => {
  const stored = '<think>\nsecret plan\n</think>\n\nHead up and look at the sky.\n\nThe stars were out.\n';
  test('a paragraph edit (영어 원문도 같이 고치기) is applied to the stored text; the think block survives byte for byte', () => {
    const next = stored.replace('The stars were out.', 'The stars were bright.');
    expect(mergeParagraphEdit(stored, next, stored)).toBe(next);
    expect(next.startsWith('<think>\nsecret plan\n</think>\n\n')).toBe(true);
    // the message changed meanwhile in another paragraph (here: the think block): only the original's paragraph is applied, the rest stays
    const meanwhile = stored.replace('secret plan', 'secret plan, revised');
    expect(mergeParagraphEdit(stored, next, meanwhile)).toBe(meanwhile.replace('The stars were out.', 'The stars were bright.'));
  });
  test('a key is the hash of a cell text, so the think-stripped body and the stored paragraphs agree on every paragraph that is not next to the think block', () => {
    const rendered = ['Head up and look at the sky.', 'The stars were out.'];
    const paragraphs = stored.split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
    expect(paragraphs.map(blockKey)).toContain(blockKey(rendered[0]!));
    expect(paragraphs.map(blockKey)).toContain(blockKey(rendered[1]!));
  });
  test('a think block that touches the first paragraph (no blank line) makes that stored paragraph differ from its cell: no rewrite, never a wrong one', () => {
    const touching = '<think>secret plan</think>\nHead up and look at the sky.\n\nThe stars were out.';
    const parts = touching.split(/(\n[ \t]*\n)/);
    const cellKey = blockKey('Head up and look at the sky.');
    expect(parts.findIndex((p, i) => i % 2 === 0 && p.trim() && blockKey(p) === cellKey)).toBe(-1); // syncSourceToEdits skips it (index < 0)
  });
});
