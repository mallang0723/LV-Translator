import { expect, test } from 'bun:test';
import { makeMessage, settle, withHost } from './helpers/fake-host';

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

test('backend: a message changed after the page read it is sent to the page as the row the original reads (condition 1)', async () => {
  await withEmu(async (h) => {
    h.messages.push(makeMessage('a1', 'The lamp was burning.', 'assistant', 0));
    // the original's own save, then the host's MESSAGE_EDITED for it
    await h.send({ type: 'emu', id: 'p', op: 'patchExtra', args: ['chat', 'a1', { paraTranslate: { v: 1, map: { k: 'v' }, edited: {}, view: '', at: 1 } }] });
    const saved = h.sent.findLast((m: any) => m.type === 'msg_event');
    expect(saved).toMatchObject({ chatId: 'chat', kind: 'upsert', row: { id: 'a1', content: 'The lamp was burning.', extra: { paraTranslate: { map: { k: 'v' } } } } });
    // a swipe to another variant: the row carries that swipe's content and no record of the other one
    const m = h.messages[0]!;
    m.swipes = ['The lamp was burning.', 'The lamp went out.'];
    m.swipe_id = 1;
    m.content = 'The lamp went out.';
    h.event('MESSAGE_SWIPED', { chatId: 'chat', message: { ...structuredClone(m), extra: { spindle_metadata: m.metadata } }, action: 'navigated', swipeId: 1 });
    await settle();
    const swiped = h.sent.findLast((x: any) => x.type === 'msg_event');
    expect(swiped.row).toMatchObject({ content: 'The lamp went out.', activeSwipeIndex: 1 });
    expect(swiped.row.extra).not.toHaveProperty('paraTranslate');
  });
});

test('backend: a deleted message is sent to the page too', async () => {
  await withEmu(async (h) => {
    h.event('MESSAGE_DELETED', { chatId: 'chat', messageId: 'a1' });
    await settle();
    expect(h.sent.findLast((m: any) => m.type === 'msg_event')).toEqual({ type: 'msg_event', chatId: 'chat', kind: 'delete', messageId: 'a1' });
  });
});

test('backend: the 0.4.0 glossary is carried into the original settings once, before the original reads them (condition 2)', async () => {
  await withHost({ store: { defaults: { glossary: 'Mina = 미나' }, chats: { chat: { glossary: 'Mina = 미나\nLamp = 등불' } } } }, async (h) => {
    await h.send({ type: 'emu', id: 's', op: 'storage.get', args: [] });
    const first = result(h, 's').data;
    expect(first.config.defaults.glossary).toBe('Mina = 미나');
    expect(first.lvMigrations.glossary052).toBeTruthy();
    expect(h.store().chats.chat.glossary).toBe('Mina = 미나\nLamp = 등불'); // translator.json (0.4.0's) is left as it was
    // the original saves its settings (as a whole `config`): the marker, outside config, stays and the glossary is not carried again
    await h.send({ type: 'emu', id: 'p', op: 'storage.patch', args: [{ config: { defaults: { glossary: '' } } }] });
    await h.send({ type: 'emu', id: 's2', op: 'storage.get', args: [] });
    expect(result(h, 's2').data.lvMigrations.glossary052).toBe(first.lvMigrations.glossary052);
    expect(result(h, 's2').data.config.defaults.glossary).toBe('');
  });
});

test('backend: while the original glossary is empty an already published glossary is not cleared (condition 2)', async () => {
  const published = { st_translator: { v: 1, glossary: { text: 'Mina = 미나', hash: 'old', at: 1 } } };
  const peer = { name: 'lv-tx', v: 1, ext: 'anon_memory_lv', version: '9.9.9', provides: ['reads-pub-translation@1'] };
  await withHost({ caps: { 'chat-lean-messages-v1': 1, 'chat-metadata-patch-v1': 1, 'chat-conditional-metadata-v1': 1 }, chatMetadata: published }, async (h) => {
    h.rpc.peers.set('anon_memory_lv.contract', peer);
    await h.send({ type: 'hint', chatId: 'chat', open: true });
    expect(h.chatMetadata.writes).toHaveLength(0);
  });
  // control: the same room with a glossary in the original's settings is published
  await withHost({ caps: { 'chat-lean-messages-v1': 1, 'chat-metadata-patch-v1': 1, 'chat-conditional-metadata-v1': 1 }, chatMetadata: published, ttConfig: { config: { defaults: { glossary: 'Lamp = 등불' } } } }, async (h) => {
    h.rpc.peers.set('anon_memory_lv.contract', peer);
    await h.send({ type: 'hint', chatId: 'chat', open: true });
    expect(h.chatMetadata.writes).toHaveLength(1);
  });
});

test('backend: a message event never becomes the original\'s base; its stale content write keeps the edit (SYHO-231)', async () => {
  await withEmu(async (h) => {
    const C0 = 'Alpha one.\n\nBeta two.\n\nGamma three.';
    const m = makeMessage('a1', C0, 'assistant', 0);
    h.messages.push(m);
    await h.send({ type: 'emu', id: 'l', op: 'listMessages', args: ['chat', 10] }); // the original's copy
    // the user edits elsewhere; the backend hears the event (the original, with a foreign cache, does not)
    m.content = 'Alpha one.\n\nBeta two.\n\nGamma three EDITED.';
    m.swipes[0] = m.content;
    h.event('MESSAGE_EDITED', { chatId: 'chat', message: { ...structuredClone(m), extra: {} } });
    await settle();
    await h.send({ type: 'emu', id: 'u', op: 'updateContent', args: ['chat', 'a1', 'Alpha one revised.\n\nBeta two.\n\nGamma three.'] });
    expect(result(h, 'u').ok).toBe(true);
    expect(m.content).toBe('Alpha one revised.\n\nBeta two.\n\nGamma three EDITED.');
  });
});
