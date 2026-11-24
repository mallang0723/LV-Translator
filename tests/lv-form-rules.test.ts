import { describe, expect, test } from 'bun:test';
import { effectiveGuides, outgoingBundleBlocks, saveBundle } from '../src/bundles';
import { mergeKeepTags, splitTagRules } from '../src/host-emu/lv-form';
import { DEFAULT_SETTINGS, normalizeStore } from '../src/shared';
import { parseExcludeRules } from '../src/translate/protect';

describe('제외 규칙 is a text-rule list: <tag> lines move to 번역에서 제외할 태그', () => {
  test('tag lines are taken out, the text rules stay in their order', () => {
    const r = splitTagRules('<status>\n/HP: \\d+/\n<Tracker/>\n[상태창] ... [/상태창]\n<status>');
    expect(r.tags).toEqual(['status', 'tracker']);
    expect(r.rest).toBe('/HP: \\d+/\n[상태창] ... [/상태창]');
    for (const line of r.rest.split('\n')) expect(() => parseExcludeRules(line)).not.toThrow();
  });
  test('without a tag line the text is returned untouched (blank lines and spacing included)', () => {
    const text = '  /x/ \n\n[a] ... [/a]\n';
    expect(splitTagRules(text)).toEqual({ rest: text, tags: [] });
  });
  test('a tag with attributes or text on its line is not a tag line', () => {
    expect(splitTagRules('<div class="a">\n<b>bold</b>').tags).toEqual([]);
  });
  test('merging is a union: names the list already has (any case, with <>) are not repeated; the existing text is not reordered', () => {
    expect(mergeKeepTags('tracker, <Status>', ['status', 'scene'])).toBe('tracker, <Status> scene');
    expect(mergeKeepTags('tracker', ['tracker'])).toBe('tracker');
    expect(mergeKeepTags('', ['a', 'b'])).toBe('a b');
  });
});

describe('a new bundle keeps the voice prompt, and applying the bundle uses it', () => {
  const store = normalizeStore(null);
  test('saved with glossary, 추가 지침 and 대사 지침 together', () => {
    const b = saveBundle(store, { id: '', name: 'Mine', glossary: 'Sola = 솔라', freeContext: '현대극', incomingVoicePrompt: '[Sola]\n반말' });
    expect(store.userBundles[0]).toEqual(b);
    expect(b.incomingVoicePrompt).toBe('[Sola]\n반말');
    expect(normalizeStore(JSON.parse(JSON.stringify(store))).userBundles[0]!.incomingVoicePrompt).toBe('[Sola]\n반말');
  });
  test('a room that selects the bundle gets the voice prompt (the room\'s own text is added after it)', () => {
    const b = store.userBundles[0]!;
    const g = effectiveGuides(store, { ...DEFAULT_SETTINGS, bundleId: b.id, incomingVoicePrompt: '[Mina]\n존댓말' });
    expect(g.incomingVoicePrompt).toBe('[Sola]\n반말\n\n[Mina]\n존댓말');
    expect(g.glossary).toBe('Sola = 솔라');
  });
  test('my-message translation puts all three into the system prompt', () => {
    const blocks = outgoingBundleBlocks(store.userBundles[0]!).join('\n\n');
    expect(blocks).toContain('Sola = 솔라');
    expect(blocks).toContain('## Additional guidance\n현대극');
    expect(blocks).toContain('Speaker voice guidance');
    expect(blocks).toContain('[Sola]\n반말');
  });
  test('an empty part adds no block', () => {
    expect(outgoingBundleBlocks({ glossary: '', freeContext: ' ', incomingVoicePrompt: '' })).toEqual([]);
  });
});
