import { describe, expect, test } from 'bun:test';
import { createApiFetch, type HostBridge } from '../src/host-emu/api';
import { AUTO_TAIL, createEmuBridge, eventRow, type EmuHost, messageRow, PT_KEY, TT_KEY, WideReads } from '../src/host-emu/backend-ops';
import { blockKey } from '../src/adapter/keys';

/** A host with `count` messages m0..m(count-1) (m(count-1) the newest) that honours `tail` and records every read and write. */
function host(count: number, metadata: (i: number) => Record<string, unknown> | undefined = () => undefined) {
  const messages = Array.from({ length: count }, (_, i) => ({ id: `m${i}`, role: 'assistant', content: `Text ${i}.`, extra: {}, metadata: metadata(i), name: undefined as string | undefined, swipes: ['x'], swipe_id: 0, send_date: 1_700_000_000 + i, swipe_dates: [1_700_000_000 + i] }));
  const reads: number[] = [];
  const writes: Array<{ id: string; patch: any }> = [];
  const h: EmuHost = {
    chats: { get: async (id) => ({ id, character_id: 'ch1', metadata: {} }) },
    chat: {
      getMessages: async (_c, o) => { reads.push(o?.tail ?? -1); return structuredClone(o?.tail ? messages.slice(-o.tail) : messages); },
      updateMessage: async (_c, id, patch) => { writes.push({ id, patch }); },
    },
    characters: { get: async () => ({ name: 'Mina' }) },
    personas: { get: async () => ({ name: 'Ethan' }) },
    world_books: { list: async () => ({ data: [] }), entries: { list: async () => ({ data: [] }) } },
    generate: { quiet: async () => ({ content: 'ok' }) },
    connections: { list: async () => [] },
  };
  return { h, messages, reads, writes };
}
const bridge = (x: ReturnType<typeof host>, more: Partial<Parameters<typeof createEmuBridge>[0]> = {}) =>
  createEmuBridge({ host: x.h, uid: 'u', metadataPatch: true, chatSettings: async () => ({ connectionId: 'c1', myLanguage: '한국어', autoTranslate: true }), ...more });

describe('reads are bounded (조건 3)', () => {
  test('the original\'s own background read (no limit asked) gets the end of the chat; the user\'s 모두 번역 keeps up to 1000', async () => {
    const x = host(2000);
    const b = bridge(x);
    expect((await b.listMessages('c', 0, true)).length).toBe(AUTO_TAIL);
    expect((await b.listMessages('c', 0, false)).length).toBe(1000);
    expect(x.reads).toEqual([AUTO_TAIL, 1000]);
  });

  test('which reads count as the original\'s own: only the ones its bulk helper (credentials same-origin) makes are the user\'s', async () => {
    const calls: unknown[][] = [];
    const proxy = new Proxy({}, { get: (_t, op: string) => async (...a: unknown[]) => { calls.push([op, ...a]); return []; } }) as unknown as HostBridge;
    const fetcher = createApiFetch(proxy, (async () => new Response('real')) as unknown as typeof fetch);
    await fetcher('/api/chats/c1/messages', { method: 'GET', headers: {}, cache: 'no-store', keepalive: false }); // automatic module: request()
    await fetcher('/api/chats/c1/messages', { method: 'GET', credentials: 'same-origin', cache: 'no-store' }); // the original's api(): listMessages(chatId) of 모두 번역
    await fetcher('/api/chats/c1/messages?limit=30', { credentials: 'same-origin' });
    expect(calls).toEqual([['listMessages', 'c1', 0, true], ['listMessages', 'c1', 0, false], ['listMessages', 'c1', 30, false]]);
  });

  test('saving records of many old messages (모두 번역) reads the 1000 rows once, not once per message', async () => {
    const x = host(300);
    const b = bridge(x);
    for (const i of [3, 4, 5, 6, 7]) await b.patchExtra('c', `m${i}`, { [PT_KEY]: { v: 1, map: { k: 'v' }, edited: {}, view: '', at: 1 } });
    expect(x.reads.filter((n) => n === 1000)).toHaveLength(1);
    expect(x.writes).toHaveLength(5);
  });

  test('a save of one of the newest messages looks at the end of the chat only', async () => {
    const x = host(300);
    await bridge(x).patchExtra('c', 'm299', { [PT_KEY]: { v: 1, map: {}, edited: {}, view: '', at: 1 } });
    expect(x.reads).toEqual([AUTO_TAIL]);
  });

  test('a message event keeps the wide read current: the next whole-bag write keeps what another extension just wrote', async () => {
    const x = host(300);
    const wide = new WideReads();
    const b = bridge(x, { wide, metadataPatch: false });
    await b.patchExtra('c', 'm3', { [PT_KEY]: { v: 1, map: { a: 'b' }, edited: {}, view: '', at: 1 } });
    // another extension writes its own key on m3; the event reaches the memo
    wide.update('c', { id: 'm3', metadata: { other: { n: 1 }, [TT_KEY]: { 0: { v: 1, map: { a: 'b' }, edited: {}, view: '', at: 1 } } } } as any);
    await b.patchExtra('c', 'm3', { [PT_KEY]: { v: 1, map: { a: 'b', c: 'd' }, edited: {}, view: '', at: 2 } });
    expect(x.writes.at(-1)!.patch.metadata.other).toEqual({ n: 1 });
  });
});

describe('messages on screen older than the opening read (e)', () => {
  test('are looked up by id in a window at the end of the chat, 200 then 500, never the whole chat', async () => {
    const x = host(1200);
    const b = bridge(x);
    const rows = await b.messagesFor('c', ['m1100', 'm900']); // depth 100 and 300 from the end
    expect(rows.map((r) => r.id).sort()).toEqual(['m1100', 'm900']);
    expect(x.reads).toEqual([200, 500]);
    expect((await b.messagesFor('c', ['m100'])).length).toBe(0); // deeper than 500: absent, not a 1000 read
    expect(Math.max(...x.reads)).toBe(500);
  });

  test('a short chat is read once', async () => {
    const x = host(50);
    expect((await bridge(x).messagesFor('c', ['m1', 'zzz'])).map((r) => r.id)).toEqual(['m1']);
    expect(x.reads).toEqual([200]);
  });
});

describe('what the original reads from a message', () => {
  test('a stored translation is also Marinara\'s extra.translation (+ the source it was made from), for 문맥 > 번역문 포함', () => {
    const content = 'The lamp burned.\n\nShe waited.';
    const rec = { v: 1, map: { [blockKey('The lamp burned.')]: '<x1>등불</x1>이 탔다.', [blockKey('She waited.')]: '그녀는 기다렸다.' }, edited: {}, view: '', at: 1 };
    const row = messageRow('c', { id: 'm', role: 'assistant', content, swipe_id: 0, metadata: { [TT_KEY]: { 0: rec } } }, null);
    expect(row.extra!.translation).toBe('등불이 탔다.\n\n그녀는 기다렸다.');
    expect(row.extra!.translationSource).toBe(content);
    expect(row.extra![PT_KEY]).toEqual(rec);
    const none = messageRow('c', { id: 'm', role: 'assistant', content, swipe_id: 0, metadata: {} }, null);
    expect(none.extra).not.toHaveProperty('translation');
  });

  test('a host message event (metadata inside extra.spindle_metadata, this swipe\'s record) becomes the same row a read makes', () => {
    const rec = { v: 1, map: { k: 'v' }, edited: {}, view: '', at: 3 };
    const wire = { id: 'm', is_user: false, content: 'B', swipe_id: 1, swipes: ['A', 'B'], send_date: 1, swipe_dates: [1, 2], extra: { x: 1, spindle_metadata: { [TT_KEY]: { 0: { v: 1, map: {}, at: 1 }, 1: rec } } } };
    const row = eventRow('c', wire, 'ch1');
    expect(row).toMatchObject({ id: 'm', role: 'assistant', content: 'B', activeSwipeIndex: 1, characterId: 'ch1' });
    expect(row.extra![PT_KEY]).toEqual(rec);
    expect(row.extra).not.toHaveProperty('spindle_metadata');
    expect(row.extra!.x).toBe(1);
  });

  test('the chat\'s own translation prompts (what 0.4.0 stored per chat) reach the original as the chat\'s native prompts', async () => {
    const x = host(1);
    const withPrompts = bridge(x, { chatSettings: async () => ({ connectionId: 'c1', myLanguage: '한국어', autoTranslate: false, outgoingPrompt: 'OUT', incomingPrompt: 'IN' }) });
    expect((await withPrompts.getChat('c')).metadata).toMatchObject({ translationPrompt: 'OUT', translationOutputPrompt: 'IN' });
    expect((await bridge(x).getChat('c')).metadata).not.toHaveProperty('translationOutputPrompt');
  });
});

describe('group chat speakers (d)', () => {
  const group = (chatId: string) => {
    const x = host(3);
    x.messages[0]!.name = 'Mina'; x.messages[1]!.name = 'Jun'; x.messages[2]!.name = 'Stranger';
    x.h.chats.get = async (id) => ({ id, character_id: 'chMain', metadata: { group: true, character_ids: ['chMina', 'chJun'] } });
    x.h.characters.get = async (id) => ({ name: ({ chMina: 'Mina', chJun: 'Jun', chMain: 'Main' } as Record<string, string>)[id] });
    return { x, b: bridge(x), chatId };
  };
  test('the chat lists its group members, and each reply goes to the member whose name matches exactly', async () => {
    const { x, b } = group('g1');
    expect((await b.getChat('g1')).characterIds).toEqual(['chMina', 'chJun']);
    const rows = await b.listMessages('g1', 10);
    expect(rows.map((r) => r.characterId)).toEqual(['chMina', 'chJun', 'chMain']); // no match -> the main character, as before
    expect(x.messages).toHaveLength(3);
  });
  test('messages found by id and event rows use the same attribution', async () => {
    const { b } = group('g2');
    expect((await b.messagesFor('g2', ['m1']))[0]!.characterId).toBe('chJun');
    expect((await b.getMessage('g2', 'm0')).characterId).toBe('chMina');
    const sp = await (await import('../src/host-emu/backend-ops')).resolveSpeakers({ chats: { get: async () => ({ id: 'g3', character_id: 'chMain', metadata: { group: true, character_ids: ['chJun'] } }) }, characters: { get: async () => ({ name: 'Jun' }) } }, 'u', 'g3');
    expect(eventRow('g3', { id: 'e', is_user: false, name: 'Jun', content: 'x', swipe_id: 0 }, sp).characterId).toBe('chJun');
    expect(eventRow('g3', { id: 'e', is_user: false, name: 'Nobody', content: 'x', swipe_id: 0 }, sp).characterId).toBe('chMain');
  });
  test('a solo chat is unchanged: its one character speaks every reply', async () => {
    const x = host(2);
    x.messages[0]!.name = 'Whoever';
    const rows = await bridge(x).listMessages('solo1', 10);
    expect(rows.map((r) => r.characterId)).toEqual(['ch1', 'ch1']);
    expect((await bridge(x).getChat('solo1')).characterIds).toEqual(['ch1']);
  });
});
