import { describe, expect, test } from 'bun:test';
import { blockKey } from '../src/adapter/keys';
import { reconcileTt, shiftAfterDelete } from '../src/adapter/swipe-repair';
import { makeMessage, settle, withHost, type Message } from './helpers/fake-host';

const TEXT = ['The lamp burned low.', 'Rain fell on the roof.', 'A door closed somewhere.', 'Nobody spoke at all.'];
const rec = (text: string, tr: string) => ({ v: 1, map: { [blockKey(text)]: tr }, edited: {}, view: '', at: 1 });
/** A message with one translated swipe per text, the way the original stores them: key = swipe number. */
function threeSwipes(h: { messages: Message[] }, texts = TEXT.slice(0, 3)): Message {
  const m = makeMessage('a1', texts[0]!, 'assistant', 0);
  m.swipes = [...texts];
  m.swipe_id = 0;
  m.metadata = { other_ext: { keep: 1 }, st_translator_tt: Object.fromEntries(texts.map((t, i) => [String(i), rec(t, `T${i}`)])) };
  h.messages.push(m);
  return m;
}
/** What Lumiverse does for a deleted swipe: the swipes are renumbered, the metadata is not. Then it emits the event. */
function remove(h: any, m: Message, at: number, swipeId?: number) {
  const previousSwipeId = m.swipe_id;
  m.swipes.splice(at, 1);
  m.swipe_id = swipeId ?? Math.min(at < previousSwipeId ? previousSwipeId - 1 : previousSwipeId, m.swipes.length - 1);
  m.content = m.swipes[m.swipe_id] as string;
  const payload = { chatId: 'chat', action: 'deleted', swipeId: at, previousSwipeId, message: { ...structuredClone(m), extra: { spindle_metadata: structuredClone(m.metadata) }, metadata: undefined } };
  h.event('MESSAGE_SWIPED', payload);
  return payload;
}
const tr = (m: Message) => Object.fromEntries(Object.entries(m.metadata!.st_translator_tt as Record<string, any>).map(([k, v]) => [k, Object.values(v.map)[0]]));
const caps = { 'chat-metadata-patch-v1': 1 };

describe('a deleted swipe: translation records follow the swipes', () => {
  test('first, middle, last', async () => {
    for (const [at, want] of [[0, { 0: 'T1', 1: 'T2' }], [1, { 0: 'T0', 1: 'T2' }], [2, { 0: 'T0', 1: 'T1' }]] as const) {
      await withHost({ caps }, async (h) => {
        const m = threeSwipes(h);
        remove(h, m, at);
        await settle();
        expect(tr(m)).toEqual(want);
        expect(m.metadata!.other_ext).toEqual({ keep: 1 });
        expect(h.updates.length).toBe(1);
        expect(Object.keys(h.updates[0]!.metadata_patch).sort()).toEqual(['st_translator', 'st_translator_tt']);
      });
    }
  });

  test('the visible swipe being deleted: the one that takes its place keeps its own record', async () => {
    await withHost({ caps }, async (h) => {
      const m = threeSwipes(h);
      m.swipe_id = 1;
      m.content = TEXT[1]!;
      remove(h, m, 1, 1); // swipe 1 deleted while shown; swipe 2 (now number 1) is shown
      await settle();
      expect(tr(m)).toEqual({ 0: 'T0', 1: 'T2' });
    });
  });

  test('consecutive deletes', async () => {
    await withHost({ caps }, async (h) => {
      const m = threeSwipes(h);
      remove(h, m, 0);
      await settle();
      remove(h, m, 0);
      await settle();
      expect(tr(m)).toEqual({ 0: 'T2' });
    });
  });

  test('a duplicated event does not shift twice, and neither does a late copy of an earlier one', async () => {
    await withHost({ caps }, async (h) => {
      // records the content cannot vouch for, so only the delete event decides
      const m = makeMessage('a1', 'x', 'assistant', 0);
      m.swipes = ['S zero', 'S one', 'S two', 'S three'];
      m.metadata = { st_translator_tt: { 0: { v: 1, map: { q0: 'T0' } }, 1: { v: 1, map: { q1: 'T1' } }, 2: { v: 1, map: { q2: 'T2' } }, 3: { v: 1, map: { q3: 'T3' } } } };
      h.messages.push(m);
      const first = remove(h, m, 0);
      await settle();
      expect(tr(m)).toEqual({ 0: 'T1', 1: 'T2', 2: 'T3' });
      h.event('MESSAGE_SWIPED', first);
      await settle();
      expect(tr(m)).toEqual({ 0: 'T1', 1: 'T2', 2: 'T3' });
      expect(h.updates.length).toBe(1);
      remove(h, m, 1);
      await settle();
      expect(tr(m)).toEqual({ 0: 'T1', 1: 'T3' });
      h.event('MESSAGE_SWIPED', first);
      await settle();
      expect(tr(m)).toEqual({ 0: 'T1', 1: 'T3' });
      expect(h.updates.length).toBe(2);
    });
  });

  test('the same slot deleted again after a new swipe took its place is a new delete, not a duplicate', async () => {
    await withHost({ caps }, async (h) => {
      const m = threeSwipes(h); // A B C
      remove(h, m, 2);
      await settle();
      expect(tr(m)).toEqual({ 0: 'T0', 1: 'T1' });
      for (const [i, text] of ['Fourth swipe text.', 'Fifth swipe text.'].entries()) {
        // generate and translate a new last swipe, then delete it again
        m.swipes.push(text);
        m.swipe_id = 2;
        m.content = text;
        (m.metadata!.st_translator_tt as Record<string, unknown>)['2'] = rec(text, `N${i}`);
        const gone = remove(h, m, 2);
        await settle();
        expect(tr(m)).toEqual({ 0: 'T0', 1: 'T1' });
        h.event('MESSAGE_SWIPED', gone); // and its duplicate is still ignored
        await settle();
        expect(tr(m)).toEqual({ 0: 'T0', 1: 'T1' });
      }
      expect(h.updates.length).toBe(3);
    });
  });

  test('a middle slot deleted twice (same number, same swipes left) is applied both times', async () => {
    await withHost({ caps }, async (h) => {
      // records the content cannot vouch for: only the event decides
      const m = makeMessage('a1', 'x', 'assistant', 0);
      m.swipes = ['S0', 'S1', 'S2'];
      m.metadata = { st_translator_tt: { 0: { v: 1, map: { q0: 'T0' } }, 1: { v: 1, map: { q1: 'T1' } }, 2: { v: 1, map: { q2: 'T2' } } } };
      h.messages.push(m);
      remove(h, m, 1); // S0 S2, records T0 T2
      await settle();
      expect(tr(m)).toEqual({ 0: 'T0', 1: 'T2' });
      // a swipe is added in the middle of the numbering by a host that inserts, with its own record, then removed again
      m.swipes.splice(1, 0, 'S1b');
      (m.metadata!.st_translator_tt as Record<string, any>) = { 0: { v: 1, map: { q0: 'T0' } }, 1: { v: 1, map: { qb: 'Tb' } }, 2: { v: 1, map: { q2: 'T2' } } };
      remove(h, m, 1);
      await settle();
      expect(tr(m)).toEqual({ 0: 'T0', 1: 'T2' });
    });
  });

  test('a message without a record is not written, and a host without metadata_patch gets the whole bag', async () => {
    await withHost({ caps }, async (h) => {
      const m = makeMessage('a1', 'x', 'assistant', 0);
      m.swipes = ['one', 'two'];
      h.messages.push(m);
      remove(h, m, 0);
      await settle();
      expect(h.updates.length).toBe(0);
    });
    await withHost({ caps: {} }, async (h) => {
      const m = threeSwipes(h);
      remove(h, m, 0);
      await settle();
      expect(tr(m)).toEqual({ 0: 'T1', 1: 'T2' });
      expect(m.metadata!.other_ext).toEqual({ keep: 1 });
    });
  });
});

describe('records on the wrong swipes (an earlier delete) are set right by content', () => {
  const swipes = [TEXT[1]!, TEXT[2]!];
  const stale = { 0: rec(TEXT[0]!, 'T0'), 1: rec(TEXT[1]!, 'T1'), 2: rec(TEXT[2]!, 'T2') } as Record<string, unknown>;

  test('reconcileTt: the shifted records go to their swipes, the deleted one\'s is dropped', () => {
    const out = reconcileTt(stale, swipes)!;
    expect(Object.keys(out).sort()).toEqual(['0', '1']);
    expect((out['0'] as any).map).toEqual({ [blockKey(TEXT[1]!)]: 'T1' });
    expect((out['1'] as any).map).toEqual({ [blockKey(TEXT[2]!)]: 'T2' });
  });
  test('reconcileTt: settled records stay, and the result settles (repeating changes nothing)', () => {
    const settled = { 0: rec(TEXT[1]!, 'T1'), 1: rec(TEXT[2]!, 'T2') };
    expect(reconcileTt(settled, swipes)).toBeNull();
    expect(reconcileTt(reconcileTt(stale, swipes)!, swipes)).toBeNull();
  });
  test('reconcileTt: a record that matches no swipe, or two swipes alike, or only part of a swipe, stays put', () => {
    expect(reconcileTt({ 0: rec('Something else entirely.', 'X') }, swipes)).toBeNull();
    expect(reconcileTt({ 0: rec(TEXT[1]!, 'X') }, [TEXT[2]!, TEXT[1]!, TEXT[1]!])).toBeNull();
    const half = { v: 1, map: { [blockKey(TEXT[1]!)]: 'a', [blockKey('Gone paragraph here.')]: 'b' }, edited: {}, view: '', at: 1 };
    expect(reconcileTt({ 0: half }, swipes)).toBeNull();
  });
  test('shiftAfterDelete leaves non-number keys alone', () => {
    expect(shiftAfterDelete({ 0: 'a', 1: 'b', note: 'n' }, 0)).toEqual({ 0: 'b', note: 'n' });
    expect(shiftAfterDelete({ 0: 'a' }, 1)).toBeNull();
  });

  test('a message read by the original is corrected once and written once', async () => {
    await withHost({ caps: { 'chat-lean-messages-v1': 1, 'chat-metadata-patch-v1': 1 } }, async (h) => {
      h.api.personas = { get: async () => ({ name: 'E' }), getActive: async () => null };
      h.api.characters = { get: async () => ({ name: 'Mina', world_book_ids: [] }) };
      h.api.world_books = { list: async () => ({ data: [] }), entries: { list: async () => ({ data: [] }) } };
      const m = makeMessage('a1', swipes[0]!, 'assistant', 0);
      m.swipes = [...swipes];
      m.metadata = { other_ext: { keep: 1 }, st_translator_tt: structuredClone(stale) };
      h.messages.push(m);
      for (const id of ['l1', 'l2']) await h.send({ type: 'emu', id, op: 'listMessages', args: ['chat', 20] });
      const rows = h.sent.findLast((x: any) => x.type === 'emu_result' && x.id === 'l2').data;
      expect(Object.keys(rows[0].extra.paraTranslate.map)).toEqual([blockKey(swipes[0]!)]);
      expect(rows[0].extra.paraTranslate.map[blockKey(swipes[0]!)]).toBe('T1');
      expect(h.updates.length).toBe(1);
      expect(tr(m)).toEqual({ 0: 'T1', 1: 'T2' });
      expect(m.metadata!.other_ext).toEqual({ keep: 1 });
    });
  });
});
