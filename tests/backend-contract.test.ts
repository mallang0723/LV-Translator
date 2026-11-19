import { expect, test } from 'bun:test';
import { makeMessage, settle, withHost, type Message } from './helpers/fake-host';
import { METADATA_KEY, type MessageTranslations } from '../src/shared';
import { blockKey, hashText } from '../src/vendor/tt-1.8.0/helpers';
import { buildPub, classifyPeer, glossaryText, langCode, planGlossary, PUB_PARAS_MAX } from '../src/adapter/contract';
import { DEFAULT_SETTINGS } from '../src/shared';

const CAPS = { 'chat-lean-messages-v1': 1, 'chat-metadata-patch-v1': 1, 'chat-conditional-metadata-v1': 1 };
const PEER = 'anon_memory_lv.contract';
const PEER_OK = { name: 'lv-tx', v: 1, ext: 'anon_memory_lv', version: '9.9.9', provides: ['reads-pub-translation@1'] };
const WHOLE = { defaults: { autoTranslate: false }, chats: { chat: { autoTranslate: true } } };
const PARAGRAPH = { defaults: { autoTranslate: false }, chats: { chat: { autoTranslate: true, translationUnit: 'paragraph', glossary: 'Alice = 앨리스' } } };
const translationOf = (user: string) => `한국어(${user.split('\n\n').slice(1).join('\n\n').trim()})`;
const mt = (m: Message) => m.metadata?.[METADATA_KEY] as MessageTranslations | undefined;

test('handshake: the translator publishes name, version and what it provides, readable by any extension', async () => {
  await withHost({ caps: CAPS }, async (h) => {
    expect(h.rpc.policies.get('contract')).toEqual({ requires: [] });
    expect(h.rpc.synced.get('contract')).toEqual({ name: 'lv-tx', v: 1, ext: 'st_translator', version: '0.4.2', provides: ['pub-translation@1', 'glossary@1'] });
  });
});

test('peer absent: nothing is published and translation works as before', async () => {
  await withHost({ caps: CAPS, store: WHOLE }, async (h) => {
    const reply = makeMessage('a1', 'Hello there.', 'assistant', 0);
    h.messages.push(reply);
    await h.emit({ messageId: 'a1', content: reply.content, generationType: 'normal' });
    expect(h.record(reply)?.status).toBe('done');
    expect(mt(reply)?.pub).toBeUndefined();
    await h.send({ type: 'save_settings', chatId: h.chatId, settings: { ...DEFAULT_SETTINGS, glossary: 'Alice = 앨리스' } as any, asDefault: false });
    expect(h.chatMetadata.writes).toEqual([]);
    expect(h.sent.findLast((m: any) => m.type === 'state').link).toBe('none');
    expect(h.errors).toEqual([]);
  });
});

test('peer present: pub is the finished translation of the visible content, keyed by the upstream hash', async () => {
  await withHost({ caps: CAPS, store: WHOLE }, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    const reply = makeMessage('a1', 'Hello there.', 'assistant', 0);
    h.messages.push(reply);
    await h.emit({ messageId: 'a1', content: reply.content, generationType: 'normal' });
    const pub = mt(reply)?.pub!;
    expect(pub).toMatchObject({ v: 1, h: hashText('Hello there.'), lang: 'ko', text: '번역문' });
    expect(typeof pub.at).toBe('number');
    expect(pub.paras).toBeUndefined();
    // other extensions' keys and our own entries are kept next to it
    expect(Object.keys(mt(reply)!.entries)).toHaveLength(1);
    expect(h.sent.findLast((m: any) => m.type === 'state')?.link ?? 'ok').toBe('ok');
  });
});

test('paragraph translation publishes paras keyed by the normalized paragraph, and edit marks + new hash arrive in the same write', async () => {
  await withHost({ caps: CAPS, store: PARAGRAPH }, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    const reply = makeMessage('reply', 'The lamp was still burning.\n\nHe sighed.', 'assistant', 0);
    h.messages.push(reply);
    h.setComplete(async (input: any) => ({ content: translationOf(input.messages[1].content), finish_reason: 'stop' }));
    await h.send({ type: 'chat', chatId: h.chatId });
    await h.emit({ messageId: 'reply', content: reply.content, generationType: 'normal' });
    expect(mt(reply)!.pub!.paras).toEqual({ [blockKey('The lamp was still burning.')]: '한국어(The lamp was still burning.)', [blockKey('He sighed.')]: '한국어(He sighed.)' });
    expect(mt(reply)!.pub!.edited).toBeUndefined();

    await h.send({ type: 'edit_open', chatId: h.chatId, messageId: 'reply' });
    const open = h.sent.findLast((m: any) => m.type === 'edit_data');
    h.setComplete(async () => ({ content: 'The lamp had gone out.', finish_reason: 'stop' }));
    const before = h.updates.length;
    await h.send({ type: 'edit_save', chatId: h.chatId, messageId: 'reply', sourceKey: open.sourceKey, edits: [{ index: 0, text: '등불은 꺼져 있었다.' }], syncSource: true });
    expect(h.updates.length - before).toBe(1);
    const patch = h.updates.at(-1)!;
    const newContent = 'The lamp had gone out.\n\nHe sighed.';
    expect(patch.content).toBe(newContent);
    // the memory side sees the new content and a matching pub in the very same event
    expect(patch.ownMetadata.pub.h).toBe(hashText(newContent));
    expect(patch.ownMetadata.pub.text).toBe('등불은 꺼져 있었다.\n\n한국어(He sighed.)');
    expect(patch.ownMetadata.pub.paras[blockKey('The lamp had gone out.')]).toBe('등불은 꺼져 있었다.');
    expect(patch.ownMetadata.pub.edited).toEqual({ [blockKey('The lamp had gone out.')]: 1 });
  });
});

test('a partial or failed translation publishes nothing; a swipe to another text replaces or drops pub without looping', async () => {
  await withHost({ caps: CAPS, store: WHOLE }, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    const reply = makeMessage('a1', 'Hello there.', 'assistant', 0);
    reply.swipes = ['Hello there.', 'Another swipe.'];
    h.messages.push(reply);
    await h.send({ type: 'chat', chatId: h.chatId });
    await h.emit({ messageId: 'a1', content: reply.content, generationType: 'normal' });
    expect(mt(reply)?.pub?.h).toBe(hashText('Hello there.'));
    // navigate to the untranslated swipe: the host sends MESSAGE_SWIPED with the new active content
    reply.content = 'Another swipe.';
    reply.swipe_id = 1;
    const before = h.updates.length;
    h.event('MESSAGE_SWIPED', { chatId: h.chatId, message: { ...structuredClone(reply), extra: { spindle_metadata: reply.metadata } } });
    await settle();
    expect(mt(reply)?.pub).toBeUndefined();
    expect(mt(reply)?.entries).toBeDefined();
    expect(h.updates.length - before).toBe(1); // our own write did not start another one
    // and back again: the stored translation is projected again
    reply.content = 'Hello there.';
    reply.swipe_id = 0;
    h.event('MESSAGE_SWIPED', { chatId: h.chatId, message: { ...structuredClone(reply), extra: { spindle_metadata: reply.metadata } } });
    await settle();
    expect(mt(reply)?.pub?.h).toBe(hashText('Hello there.'));
    expect(h.updates.length - before).toBe(2); // one write per change, none repeated
  });
});

test('without the peer, an old pub is dropped when the translation is rewritten (no stale text under a valid hash)', async () => {
  await withHost({ caps: CAPS, store: WHOLE }, async (h) => {
    const reply = makeMessage('a1', 'Hello there.', 'assistant', 0);
    reply.metadata = { [METADATA_KEY]: { v: 1, entries: {}, pub: { v: 1, h: hashText('Hello there.'), lang: 'ko', text: '옛 번역', at: 1 } } };
    h.messages.push(reply);
    await h.emit({ messageId: 'a1', content: reply.content, generationType: 'normal' });
    expect(h.record(reply)?.status).toBe('done');
    expect(mt(reply)?.pub).toBeUndefined();
  });
});

test('deleting the translation removes pub in the same write', async () => {
  await withHost({ caps: CAPS, store: WHOLE }, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    const reply = makeMessage('a1', 'Hello there.', 'assistant', 0);
    h.messages.push(reply);
    await h.emit({ messageId: 'a1', content: reply.content, generationType: 'normal' });
    expect(mt(reply)?.pub).toBeDefined();
    await h.send({ type: 'delete_translation', chatId: h.chatId, messageId: 'a1' });
    expect(mt(reply)?.pub).toBeUndefined();
  });
});

// ---- chat glossary ----

test('glossary: published once in chat metadata, other keys kept, unchanged text is not rewritten', async () => {
  await withHost({ caps: CAPS, store: WHOLE, chatMetadata: { keep: { me: 1 } } }, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    const settings = { ...DEFAULT_SETTINGS, glossary: '  Alice  =  앨리스 \nbad line\nBob = 밥' } as any;
    await h.send({ type: 'save_settings', chatId: h.chatId, settings, asDefault: false });
    expect(h.chatMetadata.writes).toHaveLength(1);
    const entry = h.chatMetadata.value.st_translator as any;
    expect(entry.v).toBe(1);
    expect(entry.glossary.text).toBe('Alice = 앨리스\nBob = 밥');
    expect(entry.glossary.hash).toBe(hashText('Alice = 앨리스\nBob = 밥'));
    expect(h.chatMetadata.value.keep).toEqual({ me: 1 });
    // same glossary on the next open: no second write
    await h.send({ type: 'hint', chatId: h.chatId, open: true });
    expect(h.chatMetadata.writes).toHaveLength(1);
    // a change is written again
    await h.send({ type: 'save_settings', chatId: h.chatId, settings: { ...settings, glossary: 'Alice = 앨리스' }, asDefault: false });
    expect(h.chatMetadata.writes).toHaveLength(2);
    expect((h.chatMetadata.value.st_translator as any).glossary.text).toBe('Alice = 앨리스');
  });
});

test('glossary degrades silently: no host capability, no chats permission, incompatible peer', async () => {
  const settings = { ...DEFAULT_SETTINGS, glossary: 'Alice = 앨리스' } as any;
  await withHost({ caps: { 'chat-lean-messages-v1': 1 }, store: WHOLE }, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    await h.send({ type: 'save_settings', chatId: h.chatId, settings, asDefault: false });
    expect(h.chatMetadata.writes).toEqual([]);
  });
  await withHost({ caps: CAPS, store: WHOLE, chatsDenied: true }, async (h) => {
    h.rpc.peers.set(PEER, PEER_OK);
    await h.send({ type: 'save_settings', chatId: h.chatId, settings, asDefault: false });
    await h.send({ type: 'save_settings', chatId: h.chatId, settings: { ...settings, glossary: 'B = 비' }, asDefault: false });
    expect(h.errors).toEqual([]);
    expect(h.warnings.filter((w) => w.includes('glossary not published'))).toHaveLength(1);
  });
  await withHost({ caps: CAPS, store: WHOLE }, async (h) => {
    h.rpc.peers.set(PEER, { ...PEER_OK, v: 2 });
    await h.send({ type: 'save_settings', chatId: h.chatId, settings, asDefault: false });
    expect(h.chatMetadata.writes).toEqual([]);
    expect(h.sent.findLast((m: any) => m.type === 'state').link).toBe('incompatible');
  });
});

// ---- pure pieces ----

test('classifyPeer, langCode, glossaryText and planGlossary', () => {
  expect(classifyPeer(undefined)).toBe('none');
  expect(classifyPeer(PEER_OK)).toBe('ok');
  expect(classifyPeer({ ...PEER_OK, v: 2 })).toBe('incompatible');
  expect(classifyPeer({ name: 'other', v: 1 })).toBe('incompatible');
  expect([langCode('Korean'), langCode('한국어'), langCode('English'), langCode('Klingon')]).toEqual(['ko', 'ko', 'en', 'klingon']);
  expect(glossaryText(' a = b \n=x\nc=d')).toBe('a = b\nc = d');
  expect(planGlossary({}, '', 1)).toBeNull();
  const plan = planGlossary({ other: 1, st_translator: { keep: true } }, 'a = b', 5)!;
  expect(plan.metadata).toEqual({ other: 1, st_translator: { keep: true, v: 1, glossary: { text: 'a = b', hash: hashText('a = b'), at: 5 } } });
  expect(planGlossary(plan.metadata, 'a = b', 6)).toBeNull();
  // an emptied glossary that was published before is published as empty
  expect(planGlossary(plan.metadata, '', 7)!.metadata.st_translator).toMatchObject({ glossary: { text: '' } });
});

test('buildPub caps paragraphs and publishes only finished records', () => {
  const content = Array.from({ length: PUB_PARAS_MAX + 5 }, (_, i) => `Paragraph number ${i}.`).join('\n\n');
  const record = { parts: content.split('\n\n').map((p) => `번역 ${p}`), pieces: [], unit: 'paragraph' as const, total: PUB_PARAS_MAX + 5, truncatedPart: -1, status: 'done' as const, updatedAt: 1 };
  const pub = buildPub(content, record, DEFAULT_SETTINGS, 1)!;
  expect(Object.keys(pub.paras!)).toHaveLength(PUB_PARAS_MAX);
  expect(pub.paras![blockKey('Paragraph number 0.')]).toBeUndefined(); // earliest dropped
  expect(pub.paras![blockKey(`Paragraph number ${PUB_PARAS_MAX + 4}.`)]).toBeDefined();
  expect(buildPub(content, { ...record, status: 'partial' }, DEFAULT_SETTINGS, 1)).toBeNull();
  expect(buildPub(content, undefined, DEFAULT_SETTINGS, 1)).toBeNull();
});
