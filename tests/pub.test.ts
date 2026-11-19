import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import fixture from './fixtures/translator-contract.json';
import { blockKey, hashText, normalizeForKey } from '../src/adapter/keys';
import { buildPubFromTt, contentUnits, convertLegacyRecord, keptTagNames } from '../src/adapter/pub';
import { DEFAULT_SETTINGS, type TranslationRecord } from '../src/shared';

const ORIGINAL = readFileSync(new URL('../src/vendor/tt-1.10.0/personal-extension/extension.js', import.meta.url), 'utf8');

/** The original's own three key functions, cut out of the vendored file and run as they are. */
function originalKeys() {
  const pick = (name: string) => {
    const start = ORIGINAL.indexOf(`  function ${name}(`);
    expect(start).toBeGreaterThan(0);
    const end = ORIGINAL.indexOf('\n  }\n', start) + 5;
    return ORIGINAL.slice(start, end);
  };
  return new Function(`${pick('hashText')}\n${pick('normalizeForKey')}\n${pick('blockKey')}\nreturn { hashText, normalizeForKey, blockKey };`)() as {
    hashText: (s: unknown) => string;
    normalizeForKey: (s: unknown) => string;
    blockKey: (s: unknown) => string;
  };
}

describe('keys are the original 1.10.0 functions', () => {
  const original = originalKeys();
  const samples = [...fixture.vectors.map(([text]) => text as string), 'He sighed.', '*She* said, “Come in.”', '> quoted _text_ #1', '  spaced   out\ttext  ', 'ㅎㅏㄴ글 문단'];
  test('hashText, normalizeForKey and blockKey agree on the memory extension vectors and more', () => {
    for (const text of samples) {
      expect(hashText(text)).toBe(original.hashText(text));
      expect(normalizeForKey(text)).toBe(original.normalizeForKey(text));
      expect(blockKey(text)).toBe(original.blockKey(text));
    }
    for (const [text, hash] of fixture.vectors) expect(hashText(text)).toBe(hash as string);
    for (const [text, key] of Object.entries(fixture.blockKeys)) expect(blockKey(text)).toBe(key);
  });
});

describe('pub projection (LV-TX v1) from the original record', () => {
  const record = { v: 1 as const, map: { '12gy3pg': '등불은 꺼져 있었다.', vxqklm: '한국어(He sighed.)' }, edited: { '12gy3pg': 1 }, view: '', at: 5 };
  test('equals the memory library fixture: h, lang, text in content order, paras keyed by blockKey, edited marks', () => {
    const pub = buildPubFromTt(fixture.content, record, 'Korean', new Set(), fixture.pub.at)!;
    expect(pub).toEqual(fixture.pub as never);
  });
  test('the sibling memory library fixture is the same file when it is present', () => {
    const sibling = join(homedir(), 'dev/lv-memory-library/tests/fixtures/translator-contract.json');
    if (!existsSync(sibling)) return;
    const theirs = JSON.parse(readFileSync(sibling, 'utf8'));
    expect(theirs.pub).toEqual(fixture.pub);
    expect(theirs.vectors).toEqual(fixture.vectors);
    expect(theirs.blockKeys).toEqual(fixture.blockKeys);
    expect(theirs.glossary).toEqual(fixture.glossary);
  });
  test('text follows the content order even when the record was written in another order; untranslated paragraphs stay as they are', () => {
    const reversed = { ...record, map: { vxqklm: '한국어(He sighed.)', '12gy3pg': '등불은 꺼져 있었다.' } };
    expect(buildPubFromTt(fixture.content, reversed, 'ko', new Set(), 1)!.text).toBe('등불은 꺼져 있었다.\n\n한국어(He sighed.)');
    const half = { ...record, map: { vxqklm: '한국어(He sighed.)' }, edited: {} };
    const pub = buildPubFromTt(fixture.content, half, 'ko', new Set(), 1)!;
    expect(pub.text).toBe('The lamp had gone out.\n\n한국어(He sighed.)');
    expect(pub.edited).toBeUndefined();
  });
  test('nothing in the record belongs to the content: no pub', () => {
    expect(buildPubFromTt('Another message here.', record, 'ko', new Set(), 1)).toBeNull();
    expect(buildPubFromTt('x y', null, 'ko', new Set(), 1)).toBeNull();
  });
  test('paragraphs are found as the original does for a message that is not on screen', () => {
    expect(contentUnits('One <b>bold</b> line.\r\n\r\n\n  \nTwo.\n\n12345\n\n<status>HP</status>')).toEqual(['One bold line.', 'Two.', 'HP']);
    expect(contentUnits('<keep>Stay</keep>\n\nGo', keptTagNames('keep, <x>'))).toEqual(['<keep>Stay</keep>', 'Go']);
  });
});

describe('0.4.0 record -> original record (N8)', () => {
  const content = 'The lamp had gone out.\n\nHe sighed.';
  const legacy = (over: Partial<TranslationRecord> = {}): TranslationRecord => ({
    parts: ['등불은 꺼져 있었다.', '그가 한숨을 쉬었다.'], pieces: [], unit: 'paragraph', total: 2, edited: [1], truncatedPart: -1, status: 'done', updatedAt: 42, ...over,
  });
  test('an exact paragraph pairing becomes the original record under the original keys, edits kept', () => {
    const rec = convertLegacyRecord(content, legacy(), DEFAULT_SETTINGS, new Set(), 7)!;
    expect(rec).toEqual({ v: 1, map: { [blockKey('The lamp had gone out.')]: '등불은 꺼져 있었다.', [blockKey('He sighed.')]: '그가 한숨을 쉬었다.' }, edited: { [blockKey('He sighed.')]: 1 }, view: '', at: 42 });
  });
  test('whole-message, partial, error and mismatching records are skipped (never guessed)', () => {
    expect(convertLegacyRecord(content, legacy({ unit: 'whole', total: 1, parts: ['통째 번역'] }), DEFAULT_SETTINGS, new Set(), 7)).toBeNull();
    expect(convertLegacyRecord(content, legacy({ status: 'partial', parts: ['등불은 꺼져 있었다.'] }), DEFAULT_SETTINGS, new Set(), 7)).toBeNull();
    expect(convertLegacyRecord(content, legacy({ status: 'error' }), DEFAULT_SETTINGS, new Set(), 7)).toBeNull();
    expect(convertLegacyRecord(`${content}\n\nA third paragraph.`, legacy(), DEFAULT_SETTINGS, new Set(), 7)).toBeNull();
    expect(convertLegacyRecord(content, undefined, DEFAULT_SETTINGS, new Set(), 7)).toBeNull();
  });
});
