import { expect, test } from 'bun:test';
import { makeMessage, withHost } from './helpers/fake-host';

const withEmu = (run: (h: Awaited<Parameters<Parameters<typeof withHost>[1]>[0]>) => Promise<void>) =>
  withHost({ caps: { 'chat-lean-messages-v1': 1, 'chat-metadata-patch-v1': 1 } }, async (h) => {
    // The slice of the real host the stand-in uses on top of what the 0.4.0 tests fake.
    h.api.personas = { get: async () => ({ name: 'Ethan' }), getActive: async () => null };
    h.api.characters = { get: async () => ({ name: 'Mina', world_book_ids: [] }) };
    h.api.world_books = { list: async () => ({ data: [] }), entries: { list: async () => ({ data: [] }) } };
    await run(h);
  });
const result = (h: any, id: string) => h.sent.findLast((m: any) => m.type === 'emu_result' && m.id === id);

test('backend: the original asks for chat, messages, a save and a raw generation through one RPC message', async () => {
  await withEmu(async (h) => {
    h.messages.push(makeMessage('u1', 'Hi.', 'user', 0), makeMessage('a1', 'The lamp was burning.', 'assistant', 1));
    await h.send({ type: 'emu', id: 'c', op: 'getChat', args: ['chat'] });
    expect(result(h, 'c')).toMatchObject({ ok: true, data: { metadata: { translationProvider: 'ai', translationConnectionId: 'connection' } } });
    await h.send({ type: 'emu', id: 'l', op: 'listMessages', args: ['chat', 40] });
    expect(result(h, 'l').data.map((m: any) => m.id)).toEqual(['u1', 'a1']);
    expect(h.readOptions.at(-1)).toEqual({ tail: 40 });
    await h.send({ type: 'emu', id: 'p', op: 'patchExtra', args: ['chat', 'a1', { paraTranslate: { v: 1, map: { k: 'v' }, edited: {}, view: '', at: 1 } }] });
    expect(result(h, 'p').ok).toBe(true);
    expect(h.updates.at(-1)).toMatchObject({ metadata_patch: { st_translator_tt: { 0: { map: { k: 'v' } } } } });
    h.setComplete(async () => ({ content: '<segment id="1">번역</segment>', finish_reason: 'stop' }));
    await h.send({ type: 'emu', id: 'g', op: 'generateRaw', args: [{ connectionId: 'connection', messages: [{ role: 'user', content: 'x' }] }] });
    expect(result(h, 'g')).toMatchObject({ ok: true, data: { content: '<segment id="1">번역</segment>' } });
    expect(h.calls.at(-1)).toMatchObject({ connection_id: 'connection' });
  });
});

test('backend: a reply still being generated is reported active, and an unknown op is refused', async () => {
  await withEmu(async (h) => {
    h.event('GENERATION_STARTED', { chatId: 'chat' });
    await h.send({ type: 'emu', id: 'a', op: 'generateActive', args: ['chat'] });
    expect(result(h, 'a').data).toBe(true);
    h.event('GENERATION_ENDED', { chatId: 'chat', generationType: 'impersonate' });
    await h.send({ type: 'emu', id: 'b', op: 'generateActive', args: ['chat'] });
    expect(result(h, 'b').data).toBe(false);
    await h.send({ type: 'emu', id: 'x', op: 'dropTable', args: [] });
    expect(result(h, 'x')).toMatchObject({ ok: false, status: 404 });
  });
});

test('backend: in the shipped mode a finished generation is not translated on the server (the original does it in the page)', async () => {
  await withEmu(async (h) => {
    Reflect.set(globalThis, '__LV_TRANSLATOR_LEGACY__', false);
    try {
      const mod = await import(`../src/backend.ts?legacy-off=${Math.random()}`);
      void mod;
      h.messages.push(makeMessage('a1', 'The lamp was burning.', 'assistant', 0));
      // the fresh import registered its own handlers on the same fake host: emit through them
      await h.emit({ messageId: 'a1', content: 'The lamp was burning.', generationType: 'normal' });
      expect(h.calls).toHaveLength(0);
    } finally {
      Reflect.set(globalThis, '__LV_TRANSLATOR_LEGACY__', true);
    }
  });
});
