import { describe, expect, test } from 'bun:test';
import { effectiveConnectionId, normalizeSettings, normalizeStore, settingsFor, LONG_SPLIT_DEFAULT } from '../src/shared';

// The merged form reads these from the extension's own store (translator.json); they need no migration. One test per field group.
const old040 = normalizeStore({
  defaults: { connectionId: 'conn-d', modelLanguage: 'Japanese', myLanguage: '영어', autoTranslate: true, translateMyMessages: true, showDraftButton: true, protectHtml: false, protectCode: false, excludeTags: 'status, ui', excludeRules: '<hp>', bundleId: 'b1', longSplitChars: 3000 },
  chats: { c1: { connectionId: 'conn-c1', modelLanguage: 'French', autoTranslate: false, excludeRules: '/x/', bundleId: 'b1' } },
  userBundles: [{ id: 'b1', name: '공용', glossary: 'A = B', freeContext: '배경', incomingVoicePrompt: '' }],
});

describe('0.4.0 store still feeds the merged form (0.5.3)', () => {
  test('languages', () => {
    expect(settingsFor(old040, null)).toMatchObject({ modelLanguage: 'Japanese', myLanguage: '영어' });
    expect(settingsFor(old040, 'c1').modelLanguage).toBe('French');
  });
  test('switches (자동 번역, 내 메시지 번역, 번역 버튼, HTML·코드 보호)', () => {
    expect(settingsFor(old040, null)).toMatchObject({ autoTranslate: true, translateMyMessages: true, showDraftButton: true, protectHtml: false, protectCode: false });
    expect(settingsFor(old040, 'c1').autoTranslate).toBe(false);
  });
  test('exclusion tags and rules', () => {
    expect(settingsFor(old040, null)).toMatchObject({ excludeTags: 'status, ui', excludeRules: '<hp>' });
    expect(settingsFor(old040, 'c1').excludeRules).toBe('/x/');
  });
  test('connection', () => {
    expect(effectiveConnectionId(old040, null)).toBe('conn-d');
    expect(effectiveConnectionId(old040, 'c1')).toBe('conn-c1');
  });
  test('bundles: the library and the room\'s choice', () => {
    expect(old040.userBundles.map((b) => b.id)).toEqual(['b1']);
    expect(settingsFor(old040, 'c1').bundleId).toBe('b1');
  });
});

describe('0.4.0 longSplitChars -> 한 번에 번역할 최대 글자수 (batchChars)', () => {
  test('a value the user chose carries over once; the default does not; a saved batchChars (even 0) wins', () => {
    expect(settingsFor(old040, null).batchChars).toBe(3000);
    expect(normalizeSettings({ longSplitChars: LONG_SPLIT_DEFAULT }).batchChars).toBe(0);
    expect(normalizeSettings({ longSplitChars: 0 }).batchChars).toBe(0);
    expect(normalizeSettings({ longSplitChars: 3000, batchChars: 0 }).batchChars).toBe(0);
    expect(normalizeSettings({ longSplitChars: 3000, batchChars: 900 }).batchChars).toBe(900);
    expect(normalizeSettings({}).batchChars).toBe(0);
  });
});
