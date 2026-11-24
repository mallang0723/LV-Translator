import { describe, expect, test } from 'bun:test';
import { outgoingBundleBlocks, planRoomVoice, type RoomVoice, saveBundle } from '../src/bundles';
import { KEEP_TAGS_MAX, mergeKeepTags, planTagMove } from '../src/host-emu/lv-form';
import { normalizeStore } from '../src/shared';
import { parseExcludeRules } from '../src/translate/protect';

describe('제외 규칙 is a text-rule list: <tag> lines move to 번역에서 제외할 태그', () => {
  test('tag lines are taken out, the text rules stay in their order', () => {
    const r = planTagMove('<status>\n/HP: \\d+/\n<Tracker/>\n[상태창] ... [/상태창]\n<status>', 'scene');
    expect(r.moved).toEqual(['status', 'tracker']);
    expect(r.stayed).toEqual([]);
    expect(r.keep).toBe('scene status tracker');
    expect(r.rest).toBe('/HP: \\d+/\n[상태창] ... [/상태창]');
    for (const line of r.rest.split('\n')) expect(() => parseExcludeRules(line)).not.toThrow();
  });
  test('without a tag line the text is returned untouched (blank lines and spacing included)', () => {
    const text = '  /x/ \n\n[a] ... [/a]\n';
    expect(planTagMove(text, 'a')).toMatchObject({ rest: text, keep: 'a', moved: [], stayed: [] });
  });
  test('a tag with attributes or text on its line is not a tag line', () => {
    expect(planTagMove('<div class="a">\n<b>bold</b>', '').moved).toEqual([]);
  });
  test('a tag the list already has leaves the rules without being repeated', () => {
    const r = planTagMove('<Status>\n/x/', 'status tracker');
    expect(r).toMatchObject({ rest: '/x/', keep: 'status tracker', moved: ['status'] });
  });
  test('a tag that would push the list past the original\'s 500 characters is NOT moved: its line stays in the rules, the ones that fit move', () => {
    const full = Array.from({ length: 52 }, (_, i) => `tag_${String(i).padStart(4, '0')}`).join(' '); // 52 x 8 + 51 = 467
    expect(full.length).toBeLessThanOrEqual(KEEP_TAGS_MAX);
    const r = planTagMove('<short>\n<a_very_long_tag_name_that_does_not_fit_in_the_list>\n/x/', full);
    expect(r.moved).toEqual(['short']);
    expect(r.stayed).toEqual(['a_very_long_tag_name_that_does_not_fit_in_the_list']);
    expect(r.keep.length).toBeLessThanOrEqual(KEEP_TAGS_MAX);
    expect(r.keep.endsWith(' short')).toBe(true);
    expect(r.rest).toBe('<a_very_long_tag_name_that_does_not_fit_in_the_list>\n/x/');
    // nothing is lost: every tag is either in the list or still a rule
    expect(planTagMove('<overflow>', 'x'.repeat(KEEP_TAGS_MAX - 3))).toMatchObject({ rest: '<overflow>', keep: 'x'.repeat(KEEP_TAGS_MAX - 3), moved: [], stayed: ['overflow'] });
  });
  test('merging is a union: names the list already has (any case, with <>) are not repeated; the existing text is not reordered', () => {
    expect(mergeKeepTags('tracker, <Status>', ['status', 'scene'])).toBe('tracker, <Status> scene');
    expect(mergeKeepTags('tracker', ['tracker'])).toBe('tracker');
    expect(mergeKeepTags('', ['a', 'b'])).toBe('a b');
  });
});

describe('a new bundle keeps the voice prompt; applying it writes the room\'s own 대사 지침 (관리자 결정 2026-11-25)', () => {
  const store = normalizeStore(null);
  const none: RoomVoice = { from: '', backupSaved: false, backupPrompt: '', backupEnabled: false };
  test('saved with glossary, 추가 지침 and 대사 지침 together', () => {
    const b = saveBundle(store, { id: '', name: 'Mine', glossary: 'Sola = 솔라', freeContext: '현대극', incomingVoicePrompt: '[Sola]\n반말' });
    expect(store.userBundles[0]).toEqual(b);
    expect(normalizeStore(JSON.parse(JSON.stringify(store))).userBundles[0]!.incomingVoicePrompt).toBe('[Sola]\n반말');
  });
  test('my-message translation gets glossary and 추가 지침 only: the original uses the 대사 지침 for response translation, not here', () => {
    const blocks = outgoingBundleBlocks(store.userBundles[0]!).join('\n\n');
    expect(blocks).toContain('Sola = 솔라');
    expect(blocks).toContain('## Additional guidance\n현대극');
    expect(blocks).not.toContain('반말');
    expect(outgoingBundleBlocks({ glossary: '', freeContext: ' ' })).toEqual([]);
  });
  const bundles = [{ id: 'b1', incomingVoicePrompt: '[Sola]\n반말' }, { id: 'b2', incomingVoicePrompt: '[Mina]\n존댓말' }, { id: 'b3', incomingVoicePrompt: '' }];
  test('choosing a bundle replaces the room\'s own text and turns the switch on; the old text and switch are kept', () => {
    const p = planRoomVoice('b1', bundles, { prompt: '[Room]\n내 말투', enabled: false }, none);
    expect(p).toMatchObject({ prompt: '[Sola]\n반말', enabled: true, applied: true, replaced: true, restored: false });
    expect(p.voice).toEqual({ from: 'b1', backupSaved: true, backupPrompt: '[Room]\n내 말투', backupEnabled: false });
  });
  test('an empty room text is not reported as replaced', () => {
    expect(planRoomVoice('b1', bundles, { prompt: '', enabled: false }, none)).toMatchObject({ applied: true, replaced: false });
  });
  test('the same bundle again touches nothing (hand edits stay)', () => {
    const v: RoomVoice = { from: 'b1', backupSaved: true, backupPrompt: 'old', backupEnabled: true };
    expect(planRoomVoice('b1', bundles, { prompt: 'edited by hand', enabled: true }, v)).toMatchObject({ prompt: 'edited by hand', applied: false, restored: false, voice: v });
  });
  test('switching to another bundle puts the room\'s own value back first and keeps THAT as the backup', () => {
    const v: RoomVoice = { from: 'b1', backupSaved: true, backupPrompt: '[Room]\n내 말투', backupEnabled: true };
    const p = planRoomVoice('b2', bundles, { prompt: '[Sola]\n반말', enabled: true }, v);
    expect(p).toMatchObject({ prompt: '[Mina]\n존댓말', enabled: true, applied: true, restored: true });
    expect(p.voice).toEqual({ from: 'b2', backupSaved: true, backupPrompt: '[Room]\n내 말투', backupEnabled: true });
  });
  test('없음 (or a deleted bundle) restores the room\'s earlier text and switch', () => {
    const v: RoomVoice = { from: 'b1', backupSaved: true, backupPrompt: '[Room]\n내 말투', backupEnabled: false };
    for (const id of ['', 'gone']) {
      const p = planRoomVoice(id, bundles, { prompt: '[Sola]\n반말', enabled: true }, v);
      expect(p).toMatchObject({ prompt: '[Room]\n내 말투', enabled: false, restored: true, applied: false });
      expect(p.voice).toEqual(none);
    }
  });
  test('a bundle without a 대사 지침 never overwrites the room\'s own, and leaving it restores nothing', () => {
    const p = planRoomVoice('b3', bundles, { prompt: 'mine', enabled: true }, none);
    expect(p).toMatchObject({ prompt: 'mine', enabled: true, applied: false });
    expect(p.voice.from).toBe('b3');
    expect(planRoomVoice('', bundles, { prompt: 'mine', enabled: true }, p.voice)).toMatchObject({ prompt: 'mine', enabled: true, restored: false });
  });
  test('the bookkeeping survives normalization and the new-chat defaults do not take a chat\'s', () => {
    const n = normalizeStore({ chats: { c: { voiceFrom: 'b1', voiceBackupSaved: true, voiceBackupPrompt: 'x', voiceBackupEnabled: true } } });
    expect(n.chats.c).toMatchObject({ voiceFrom: 'b1', voiceBackupSaved: true, voiceBackupPrompt: 'x', voiceBackupEnabled: true });
    expect(n.defaults.voiceFrom).toBe('');
  });
});
