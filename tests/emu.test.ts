import { describe, expect, test } from 'bun:test';
import { createApiFetch, type HostBridge } from '../src/host-emu/api';
import { createEmuBridge, messageRow, PT_KEY, TT_KEY, type EmuHost } from '../src/host-emu/backend-ops';

function fakeHost(messages: any[]) {
  const writes: Array<{ chatId: string; id: string; patch: any }> = [];
  const reads: Array<any> = [];
  const quiet: any[] = [];
  const host: EmuHost = {
    chats: { get: async (id) => ({ id, name: 'QA', character_id: 'ch1', metadata: { persona_id: 'p1' } }) },
    chat: {
      getMessages: async (_c, o) => { reads.push(o); return messages; },
      updateMessage: async (chatId, id, patch) => { writes.push({ chatId, id, patch }); },
    },
    characters: { get: async () => ({ name: 'Mina', description: 'd', personality: 'p', scenario: 's', first_mes: 'f', mes_example: 'm', world_book_ids: ['wb1'] }) },
    personas: { get: async () => ({ name: 'Ethan', description: 'x', attached_world_book_id: 'wb2' }), getActive: async () => ({ id: 'p9' }) },
    world_books: {
      list: async () => ({ data: [{ id: 'wb1', name: 'Book' }] }),
      entries: { list: async () => ({ data: [{ id: 'e1', comment: 'Lamp', key: ['lamp'], content: 'A lamp.', disabled: false }] }) },
    },
    generate: { quiet: async (i) => { quiet.push(i); return { content: 'ok' }; } },
    connections: { list: async () => [{ id: 'c1', name: 'Conn', model: 'm' }] },
  };
  return { host, writes, reads, quiet };
}
const msg = (id: string, extra: Record<string, unknown> = {}, metadata?: Record<string, unknown>) => ({ id, role: 'assistant', content: `text ${id}`, extra, metadata, swipes: ['a', 'b'], swipe_id: 1, send_date: 1_700_000_000, swipe_dates: [1, 1_700_000_100] });
const bridge = (h: ReturnType<typeof fakeHost>, patch = true) => createEmuBridge({
  host: h.host, uid: 'u', metadataPatch: patch,
  chatSettings: async () => ({ connectionId: 'c1', myLanguage: '한국어', autoTranslate: true }),
});

describe('host stand-in: backend half', () => {
  test('the chat row carries the translation settings the original reads from Marinara chat settings', async () => {
    const h = fakeHost([]);
    const chat = await bridge(h).getChat('c');
    expect(chat.metadata).toMatchObject({ translationProvider: 'ai', translationConnectionId: 'c1', translationTargetLang: '한국어', autoTranslate: true });
    expect(chat.characterIds).toEqual(['ch1']);
    expect(chat.personaId).toBe('p1');
    expect((chat.metadata!.activeLorebookIds as string[]).sort()).toEqual(['wb1', 'wb2']);
  });
  test('message reads are bounded tail reads and the record of the visible swipe becomes extra.paraTranslate', async () => {
    const rec = { v: 1, map: { k: 'v' }, edited: {}, view: '', at: 5 };
    const h = fakeHost([msg('m1', {}, { [TT_KEY]: { 0: { v: 1, map: {}, at: 1 }, 1: rec } })]);
    const rows = await bridge(h).listMessages('c', 80);
    expect(h.reads).toEqual([{ tail: 80 }]);
    expect(rows[0]!.extra![PT_KEY]).toEqual(rec);
    expect(rows[0]!.activeSwipeIndex).toBe(1);
    expect(rows[0]!.createdAt).toBe(new Date(1_700_000_100 * 1000).toISOString());
  });
  test('"all messages" (limit 0) is capped at the host maximum, never an unbounded read', async () => {
    const h = fakeHost([]);
    await bridge(h).listMessages('c', 0);
    expect(h.reads).toEqual([{ tail: 1000 }]);
  });
  test('saving a record merges only its own metadata key, per swipe, and a null clears it', async () => {
    const h = fakeHost([msg('m1', {}, { [TT_KEY]: { 0: { keep: 1 } } })]);
    const b = bridge(h);
    await b.patchExtra('c', 'm1', { [PT_KEY]: { v: 1, map: {}, at: 2 } });
    expect(h.writes[0]!.patch).toEqual({ metadata_patch: { [TT_KEY]: { 0: { keep: 1 }, 1: { v: 1, map: {}, at: 2 } } } });
    await b.patchExtra('c', 'm1', { [PT_KEY]: null }, 0);
    expect(h.writes[1]!.patch.metadata_patch[TT_KEY]).toEqual({ 1: { v: 1, map: {}, at: 2 } });
  });
  test('without metadata_patch the whole bag is rewritten with other extensions kept', async () => {
    const h = fakeHost([msg('m1', {}, { other: { a: 1 } })]);
    await bridge(h, false).patchExtra('c', 'm1', { [PT_KEY]: { v: 1, map: {}, at: 2 } });
    expect(h.writes[0]!.patch.metadata.other).toEqual({ a: 1 });
    expect(h.writes[0]!.patch.metadata[TT_KEY]).toBeTruthy();
  });
  test('other extra keys are ignored (the original only writes its own record)', async () => {
    const h = fakeHost([msg('m1')]);
    await bridge(h).patchExtra('c', 'm1', { somethingElse: 1 });
    expect(h.writes).toHaveLength(0);
  });
  test('content rewrite and raw generation go through the host; the connection id is passed on', async () => {
    const h = fakeHost([msg('m1')]);
    const b = bridge(h);
    await b.updateContent('c', 'm1', 'new');
    expect(h.writes[0]!.patch).toEqual({ content: 'new' });
    const out = await b.generateRaw({ connectionId: 'c1', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], parameters: { maxTokens: 99, temperature: 0.1 } });
    expect(out.content).toBe('ok');
    expect(h.quiet[0]).toMatchObject({ connection_id: 'c1', parameters: { temperature: 0.1, max_tokens: 99 } });
  });
  test('character, persona and lorebook shapes are what the original parses', async () => {
    const h = fakeHost([]);
    const b = bridge(h);
    expect((await b.character('ch1') as any).data.first_mes).toBe('f');
    expect((await b.persona('p1') as any).name).toBe('Ethan');
    expect(await b.lorebooks()).toEqual([{ id: 'wb1', name: 'Book', enabled: true }]);
    expect(await b.lorebookEntries('wb1')).toEqual([{ id: 'e1', name: 'Lamp', keys: ['lamp'], content: 'A lamp.', enabled: true }]);
  });
  test('messageRow: hidden becomes hiddenFromUser, spindle_metadata is not exposed', () => {
    const row = messageRow('c', { ...msg('m1', { hidden: true, spindle_metadata: { x: 1 } }) } as any, 'ch1');
    expect(row.extra).toMatchObject({ hiddenFromUser: true });
    expect(row.extra).not.toHaveProperty('spindle_metadata');
    expect(row.characterId).toBe('ch1');
  });
});

describe('host stand-in: /api router', () => {
  const calls: string[] = [];
  const b = new Proxy({}, { get: (_t, op: string) => async (...a: unknown[]) => { calls.push(`${op}:${JSON.stringify(a)}`); return op === 'generateActive' ? false : op === 'patchExtra' || op === 'updateContent' ? undefined : { ok: op }; } }) as unknown as HostBridge;
  const fetcher = createApiFetch(b, (async () => new Response('real')) as unknown as typeof fetch);
  test('the twelve routes the original uses are answered', async () => {
    const get = async (p: string) => (await fetcher(p)).json();
    expect(await get('/api/chats/c%201')).toEqual({ ok: 'getChat' });
    expect(await get('/api/chats/c1/messages?limit=40')).toEqual({ ok: 'listMessages' });
    expect(calls.at(-1)).toBe('listMessages:["c1",40]');
    expect(await get('/api/chats/c1/messages/m1')).toEqual({ ok: 'getMessage' });
    expect(await get('/api/generate/status/c1')).toEqual({ active: false });
    expect(await get('/api/connections')).toEqual({ ok: 'connections' });
    expect(await get('/api/characters/personas/p1')).toEqual({ ok: 'persona' });
    expect(await get('/api/characters/x')).toEqual({ ok: 'character' });
    expect(await get('/api/lorebooks')).toEqual({ ok: 'lorebooks' });
    expect(await get('/api/lorebooks/b/entries')).toEqual({ ok: 'lorebookEntries' });
    const res = await fetcher('/api/chats/c1/messages/m1/extra?swipeIndex=0', { method: 'PATCH', body: JSON.stringify({ paraTranslate: null }) });
    expect(res.status).toBe(200);
    expect(calls.at(-1)).toBe('patchExtra:["c1","m1",{"paraTranslate":null},0]');
    expect((await fetcher('/api/chats/c1/messages/m1', { method: 'PATCH', body: JSON.stringify({ content: 'x' }) })).status).toBe(200);
    const raw = await fetcher('/api/generate/raw', { method: 'POST', body: JSON.stringify({ connectionId: 'c', messages: [] }) });
    expect(await raw.json()).toEqual({ ok: 'generateRaw' });
  });
  test('unknown /api routes are 404 and non-API urls reach the real fetch', async () => {
    expect((await fetcher('/api/not-a-route', { method: 'POST', body: '{}' })).status).toBe(404);
    expect(await (await fetcher('/elsewhere')).text()).toBe('real');
  });
});
