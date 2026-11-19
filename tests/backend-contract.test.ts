import { expect, test } from 'bun:test';
import fixture from './fixtures/translator-contract.json';
import { makeMessage, settle, withHost } from './helpers/fake-host';
import { blockKey, hashText } from '../src/adapter/keys';
import { METADATA_KEY, sourceHash } from '../src/shared';

const CAPS = { 'chat-lean-messages-v1': 1, 'chat-metadata-patch-v1': 1, 'chat-conditional-metadata-v1': 1 };
const PEER = 'anon_memory_lv.contract';
const PEER_OK = { name: 'lv-tx', v: 1, ext: 'anon_memory_lv', version: '9.9.9', provides: ['reads-pub-translation@1'] };
const TT = 'st_translator_tt';
const RECORD = { v: 1, map: { [blockKey('The lamp had gone out.')]: '등불은 꺼져 있었다.', [blockKey('He sighed.')]: '한국어(He sighed.)' }, edited: { [blockKey('The lamp had gone out.')]: 1 }, view: '', at: 5 };
const result = (h: any, id: string) => h.sent.findLast((m: any) => m.type === 'emu_result' && m.id === id);
const withEmu = (opts: Record<string, unknown>, run: (h: any) => Promise<void>) =>
  withHost({ caps: CAPS, ...opts }, async (h) => {
    h.api.personas = { get: async () => null, getActive: async () => null };
    h.api.characters = { get: async () => ({ name: 'Mina', world_book_ids: [] }) };
    h.api.world_books = { list: async () => ({ data: [] }), entries: { list: async () => ({ data: [] }) } };
    await run(h);
  });
const save = (h: any, id: string, message: string, record: unknown, swipe?: number) =>
  h.send({ type: 'emu', id, op: 'patchExtra', args: ['chat', message, { paraTranslate: record }, ...(swipe === undefined ? [] : [swipe])] });
const meta = (m: any) => m.metadata ?? {};

test('handshake: the translator provides pub-translation@1 and glossary@1 again, readable by any extension', async () => {
  await withEmu({}, async (h) => {
    expect(h.rpc.policies.get('contract')).toEqual({ requires: [] });
    expect(h.rpc.synced.get('contract')).toEqual({ name: 'lv-tx', v: 1, ext: 'st_translator', version: '0.5.3', provides: ['pub-translation@1', 'glossary@1'] });
  });
});

test('peer absent: the original record is saved and nothing is published for the memory extension', async () => {
  await withEmu({ ttConfig: { config: { defaults: { glossary: 'Alice = 앨리스' } } } }, async (h) => {
    const m = makeMessage('a1', fixture.content, 'assistant', 0);
    h.messages.push(m);
    await save(h, 's', 'a1', RECORD);
    expect(result(h, 's').ok).toBe(true);
    expect(meta(m)[TT]['0']).toEqual(RECORD);
    expect(meta(m)[METADATA_KEY]).toBeUndefined();
    await h.send({ type: 'hint', chatId: 'chat', open: true });
    expect(h.chatMetadata.writes).toEqual([]);
  });
});

test('peer present: the record of the visible swipe gets the memory extension pub, byte for byte the fixture', async () => {
  await withEmu({}, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    const m = makeMessage('a1', fixture.content, 'assistant', 0);
    h.messages.push(m);
    await save(h, 's', 'a1', RECORD);
    const pub = meta(m)[METADATA_KEY].pub;
    expect(typeof pub.at).toBe('number');
    expect({ ...pub, at: fixture.pub.at }).toEqual(fixture.pub as never);
    expect(pub.h).toBe(hashText(fixture.content));
    // the 0.4.0 entries beside it are kept, and the original's record is intact
    expect(meta(m)[TT]['0']).toEqual(RECORD);
  });
});

test('a record for a swipe that is not showing leaves pub alone; the swipe event then re-points pub and drops a stale one', async () => {
  await withEmu({}, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    const m = makeMessage('a1', fixture.content, 'assistant', 0);
    m.swipes = [fixture.content, 'Another swipe here.'];
    h.messages.push(m);
    await save(h, 's0', 'a1', RECORD);
    const first = meta(m)[METADATA_KEY].pub;
    await save(h, 's1', 'a1', { ...RECORD, map: { [blockKey('Another swipe here.')]: '다른 스와이프입니다.' }, edited: {} }, 1);
    expect(meta(m)[METADATA_KEY].pub).toEqual(first);
    // the user swipes to swipe 1: the host reports the message with its new content and swipe_id
    m.swipe_id = 1;
    m.content = 'Another swipe here.';
    h.event('MESSAGE_SWIPED', { chatId: 'chat', message: { ...structuredClone(m), extra: { spindle_metadata: structuredClone(m.metadata) }, metadata: undefined } });
    await settle();
    expect(meta(m)[METADATA_KEY].pub).toMatchObject({ h: hashText('Another swipe here.'), text: '다른 스와이프입니다.' });
    // and to a swipe without any record: no pub that could claim the old text
    m.swipes.push('Third swipe, nothing translated.');
    m.swipe_id = 2;
    m.content = 'Third swipe, nothing translated.';
    h.event('MESSAGE_SWIPED', { chatId: 'chat', message: { ...structuredClone(m), extra: { spindle_metadata: structuredClone(m.metadata) }, metadata: undefined } });
    await settle();
    expect(meta(m)[METADATA_KEY].pub).toBeUndefined();
  });
});

test('the chat glossary published for the memory extension is the original\'s own (chat scope first, then its defaults)', async () => {
  await withEmu({ ttConfig: { config: { defaults: { glossary: 'Default = 기본' }, chats: { chat: { glossary: 'Alice = 앨리스\nBob = 밥\nnot a pair' } } } } }, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    await h.send({ type: 'hint', chatId: 'chat', open: true });
    const written = h.chatMetadata.writes.at(-1)?.metadata?.st_translator;
    expect(written).toEqual({ v: 1, glossary: { text: 'Alice = 앨리스\nBob = 밥', hash: fixture.glossary.glossary.hash, at: expect.any(Number) } });
    expect(written.glossary.text).toBe(fixture.glossary.glossary.text);
    // saving the original's settings republishes the chat on screen
    await h.send({ type: 'emu', id: 'p', op: 'storage.patch', args: [{ config: { chats: { chat: { glossary: 'Carol = 캐롤' } } } }] });
    await settle();
    expect(h.chatMetadata.writes.at(-1)?.metadata?.st_translator.glossary.text).toBe('Carol = 캐롤');
  });
});

test('0.4.0 translations are shown by the original once: exact paragraph pairs only, the 0.4.0 record stays, an existing record wins', async () => {
  await withEmu({}, async (h) => {
    const legacy = (content: string, over: Record<string, unknown> = {}) => ({ v: 1, entries: { [sourceHash(content)]: { parts: ['등불은 꺼져 있었다.', '그가 한숨을 쉬었다.'], pieces: [], unit: 'paragraph', total: 2, truncatedPart: -1, status: 'done', updatedAt: 9, ...over } } });
    const a = makeMessage('a1', fixture.content, 'assistant', 0);
    a.metadata = { [METADATA_KEY]: legacy(fixture.content) };
    const whole = makeMessage('a2', 'A whole one here.', 'assistant', 1);
    whole.metadata = { [METADATA_KEY]: { v: 1, entries: { [sourceHash('A whole one here.')]: { parts: ['통째'], pieces: [], unit: 'whole', total: 1, truncatedPart: -1, status: 'done', updatedAt: 9 } } } };
    const mine = makeMessage('a3', fixture.content, 'assistant', 2);
    mine.metadata = { [METADATA_KEY]: legacy(fixture.content), [TT]: { '0': { ...RECORD, at: 77 } } };
    h.messages.push(a, whole, mine);
    await h.send({ type: 'emu', id: 'l', op: 'listMessages', args: ['chat', 10] });
    const rows = result(h, 'l').data;
    expect(rows[0].extra.paraTranslate.map).toEqual({ [blockKey('The lamp had gone out.')]: '등불은 꺼져 있었다.', [blockKey('He sighed.')]: '그가 한숨을 쉬었다.' });
    expect(rows[1].extra.paraTranslate).toBeUndefined();
    expect(rows[2].extra.paraTranslate.at).toBe(77);
    await settle();
    expect(meta(a)[TT]['0'].map[blockKey('He sighed.')]).toBe('그가 한숨을 쉬었다.');
    expect(Object.keys(meta(a)[METADATA_KEY].entries)).toHaveLength(1);
    expect(meta(whole)[TT]).toBeUndefined();
    expect(meta(mine)[TT]['0'].at).toBe(77);
    // read only what the original asked for: the tail, never the whole chat
    expect(h.readOptions.every((o: any) => o && o.tail)).toBe(true);
  });
});

test('0.4.0 translations are saved only for a screen-sized read; a big read (모두 번역) is converted in memory and writes nothing', async () => {
  await withEmu({}, async (h) => {
    const content = fixture.content;
    for (let i = 0; i < 5; i++) {
      const m = makeMessage(`a${i}`, content, 'assistant', i);
      m.metadata = { [METADATA_KEY]: { v: 1, entries: { [sourceHash(content)]: { parts: ['등불은 꺼져 있었다.', '그가 한숨을 쉬었다.'], pieces: [], unit: 'paragraph', total: 2, truncatedPart: -1, status: 'done', updatedAt: 9 } } } };
      h.messages.push(m);
    }
    await h.send({ type: 'emu', id: 'big', op: 'listMessages', args: ['chat', 0] });
    expect(result(h, 'big').data.every((r: any) => r.extra.paraTranslate)).toBe(true);
    await settle();
    expect(h.updates).toEqual([]);
    await h.send({ type: 'emu', id: 'small', op: 'listMessages', args: ['chat', 3] });
    await settle();
    expect(h.updates).toHaveLength(3);
    expect(h.messages.filter((m: any) => meta(m)[TT]).length).toBe(3);
  });
});

test('"내 메시지 번역": the original\'s prompt goes to the model with {{targetLanguage}} filled, in the original\'s message shape', async () => {
  await withEmu({}, async (h) => {
    h.setComplete(async () => ({ content: '  Hello there.  ', finish_reason: 'stop' }));
    await h.send({ type: 'emu', id: 't', op: 'translate', args: [{ text: '안녕하세요.', targetLanguage: 'English', systemPrompt: 'Translate to {{targetLanguage}}.', connectionId: 'connection', chatId: 'chat' }] });
    expect(result(h, 't')).toMatchObject({ ok: true, data: { translatedText: 'Hello there.' } });
    const call = h.calls.at(-1);
    expect(call.connection_id).toBe('connection');
    expect(call.messages).toEqual([
      { role: 'system', content: 'Translate to English.' },
      { role: 'user', content: 'Translate the following text to English:\n\n안녕하세요.' },
    ]);
    h.setComplete(async () => ({ content: '   ', finish_reason: 'stop' }));
    await h.send({ type: 'emu', id: 'e', op: 'translate', args: [{ text: 'x', targetLanguage: 'English', chatId: 'chat' }] });
    expect(result(h, 'e')).toMatchObject({ ok: false, status: 502 });
  });
});

test('one open page takes each generation (lease), the others are refused', async () => {
  await withEmu({}, async (h) => {
    await h.send({ type: 'emu', id: 'l1', op: 'lease', args: ['gen-1'] });
    await h.send({ type: 'emu', id: 'l2', op: 'lease', args: ['gen-1'] });
    await h.send({ type: 'emu', id: 'l3', op: 'lease', args: ['gen-2'] });
    expect([result(h, 'l1').data, result(h, 'l2').data, result(h, 'l3').data]).toEqual([true, false, true]);
  });
});

test('a finished generation is not translated on the server and a failing hook never throws into the host', async () => {
  await withEmu({}, async (h) => {
    h.messages.push(makeMessage('a1', 'The lamp was burning.', 'assistant', 0));
    await h.emit({ messageId: 'a1', content: 'The lamp was burning.', generationType: 'normal' });
    expect(h.calls).toHaveLength(0);
    expect(h.errors).toEqual([]);
  });
});
