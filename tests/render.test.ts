import { describe, expect, test } from 'bun:test';
import { buildParagraphView } from '../src/display/paragraph-view';
import { renderMessage } from '../src/display/render';
import { DEFAULT_SETTINGS, DEFAULT_VIEW, normalizeSettings, normalizeView, type ChatSettings, type TranslationRecord } from '../src/shared';

const record: TranslationRecord = { parts: ['번역 하나\n\n번역 둘'], pieces: [], total: 1, truncatedPart: -1, status: 'done', updatedAt: 0 };
const content = 'One.\n\nTwo.';
const settings = (displayMode: ChatSettings['displayMode']): ChatSettings => ({ ...DEFAULT_SETTINGS, displayMode });
const at = (text: string, needle: string) => text.indexOf(needle);

describe('display modes', () => {
  test('below: original first, translation after', () => {
    const t = renderMessage(content, record, settings('below'), DEFAULT_VIEW);
    expect(at(t, 'One.')).toBeLessThan(at(t, '번역 하나'));
  });

  test('above: translation first, original after', () => {
    const t = renderMessage(content, record, settings('above'), DEFAULT_VIEW);
    expect(t.startsWith('번역 하나')).toBe(true);
    expect(at(t, '번역 둘')).toBeLessThan(at(t, 'One.'));
  });

  test('only and collapsed', () => {
    expect(renderMessage(content, record, settings('only'), DEFAULT_VIEW)).toBe('번역 하나\n\n번역 둘');
    const c = renderMessage(content, record, settings('collapsed'), DEFAULT_VIEW);
    expect(c.startsWith(content)).toBe(true);
    expect(c).toContain('<details class="stt-translation">');
  });

  test('paragraph view: order inside each pair', () => {
    const src = renderMessage(content, record, settings('paragraph'), { ...DEFAULT_VIEW, paragraphOrder: 'source-first' });
    expect(at(src, '원문 1')).toBeLessThan(at(src, '번역 1'));
    expect(src).not.toContain('stt-pr-tfirst');
    const tr = renderMessage(content, record, settings('paragraph'), { ...DEFAULT_VIEW, paragraphOrder: 'translation-first' });
    expect(at(tr, '번역 1')).toBeLessThan(at(tr, '원문 1'));
    expect(at(tr, '원문 2')).toBeGreaterThan(at(tr, '번역 2'));
    expect(tr).toContain('stt-pr-tfirst');
  });

  test('tap view ignores the order (translation is always on top)', () => {
    const t = buildParagraphView(content, record, settings('paragraph'), 'tap', 'source-first');
    expect(at(t, '번역 1')).toBeLessThan(at(t, '원문 1'));
    expect(t).not.toContain('stt-pr-tfirst');
  });

  test('settings: new mode and order are stored, unknown values fall back', () => {
    expect(normalizeSettings({ displayMode: 'above' }).displayMode).toBe('above');
    expect(normalizeSettings({ displayMode: 'nope' }).displayMode).toBe('below');
    expect(normalizeView({ paragraphOrder: 'translation-first' }).paragraphOrder).toBe('translation-first');
    expect(normalizeView({}).paragraphOrder).toBe('source-first');
  });
});
