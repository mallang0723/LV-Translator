import { expect, test } from 'bun:test';
import { makeMessage, settle, withHost, type Message } from './helpers/fake-host';
import { METADATA_KEY, type MessageTranslations } from '../src/shared';
import { blockKey } from '../src/vendor/tt-1.8.0/helpers';

const LEAN = { 'chat-lean-messages-v1': 1, 'chat-metadata-patch-v1': 1 };
const PARAGRAPH = { defaults: { autoTranslate: false }, chats: { chat: { autoTranslate: true, translationUnit: 'paragraph' } } };
const translationOf = (user: string) => `한국어(${user.split('\n\n').slice(1).join('\n\n').trim()})`;

function entries(message: Message) {
  return (message.metadata?.[METADATA_KEY] as MessageTranslations | undefined)?.entries ?? {};
}

async function withTranslated(run: (h: any, reply: Message) => Promise<void>, caps: Record<string, number> = LEAN) {
  await withHost({ caps, store: PARAGRAPH }, async (h) => {
    const reply = makeMessage('reply', 'The lamp was still burning.\n\nHe sighed.\n\n"Come here," she said.', 'assistant', 1);
    h.messages.push(makeMessage('u1', 'Hi.', 'user', 0), reply);
    h.setComplete(async (input: any) => ({ content: translationOf(input.messages[1].content), finish_reason: 'stop' }));
    await h.send({ type: 'chat', chatId: h.chatId });
    await h.emit({ messageId: 'reply', content: reply.content, generationType: 'normal' });
    expect(Object.values(entries(reply))[0]?.status).toBe('done');
    await run(h, reply);
  });
}

test('edit: opening a finished paragraph translation lists the pairs with the source text', async () => {
  await withTranslated(async (h) => {
    await h.send({ type: 'edit_open', chatId: h.chatId, messageId: 'reply' });
    const data = h.sent.findLast((m: any) => m.type === 'edit_data');
    expect(data.ok).toBe(true);
    expect(data.pairs.map((p: any) => p.source)).toEqual(['The lamp was still burning.', 'He sighed.', '"Come here," she said.']);
    expect(data.pairs[1].translation).toBe('한국어(He sighed.)');
  });
});

test('edit with source rewrite: one updateMessage call carries the new English and the corrected translation', async () => {
  await withTranslated(async (h, reply) => {
    await h.send({ type: 'edit_open', chatId: h.chatId, messageId: 'reply' });
    const open = h.sent.findLast((m: any) => m.type === 'edit_data');
    const llmCalls: string[] = [];
    h.setComplete(async (input: any) => {
      llmCalls.push(input.messages[1].content);
      return { content: '```\nThe lamp had gone out.\n```', finish_reason: 'stop' };
    });
    const before = h.updates.length;
    await h.send({ type: 'edit_save', chatId: h.chatId, messageId: 'reply', sourceKey: open.sourceKey, edits: [{ index: 0, text: '등불은 꺼져 있었다.' }], syncSource: true });
    const result = h.sent.findLast((m: any) => m.type === 'edit_result');
    expect(result).toMatchObject({ ok: true, rewritten: 1, saved: true });
    // exactly one write, with content and our own metadata together
    expect(h.updates.length - before).toBe(1);
    const patch = h.updates.at(-1);
    expect(patch.content).toBe('The lamp had gone out.\n\nHe sighed.\n\n"Come here," she said.');
    expect(patch.ownMetadata.entries).toBeDefined();
    expect(patch.metadata).toBeUndefined();
    // the model saw the original English, the previous Korean and the corrected Korean
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toContain('[Original English]\nThe lamp was still burning.');
    expect(llmCalls[0]).toContain('[Previous Korean translation]\n한국어(The lamp was still burning.)');
    expect(llmCalls[0]).toContain('[Corrected Korean translation]\n등불은 꺼져 있었다.');
    // the translation moved to the new paragraph; other paragraphs keep theirs; old entry is gone
    expect(reply.content).toBe('The lamp had gone out.\n\nHe sighed.\n\n"Come here," she said.');
    const saved = Object.values(entries(reply));
    expect(saved).toHaveLength(1);
    expect(saved[0]!.parts).toEqual(['등불은 꺼져 있었다.', '한국어(He sighed.)', '한국어("Come here," she said.)']);
    expect(saved[0]!.edited).toEqual([0]);
    expect(saved[0]!.status).toBe('done');
    expect(h.errors).toEqual([]);
  });
});

test('edit without source rewrite: translation only, content untouched, no model call', async () => {
  await withTranslated(async (h, reply) => {
    await h.send({ type: 'edit_open', chatId: h.chatId, messageId: 'reply' });
    const open = h.sent.findLast((m: any) => m.type === 'edit_data');
    const calls = h.calls.length;
    await h.send({ type: 'edit_save', chatId: h.chatId, messageId: 'reply', sourceKey: open.sourceKey, edits: [{ index: 1, text: '그가 한숨을 쉬었다.' }], syncSource: false });
    expect(h.calls.length).toBe(calls);
    expect(h.updates.at(-1).content).toBeUndefined();
    expect(Object.values(entries(reply))[0]!.parts[1]).toBe('그가 한숨을 쉬었다.');
    expect(Object.values(entries(reply))[0]!.edited).toEqual([1]);
    expect(reply.content).toBe('The lamp was still burning.\n\nHe sighed.\n\n"Come here," she said.');
  });
});

test('edit: when the model fails, the correction is still saved and the English is left alone', async () => {
  await withTranslated(async (h, reply) => {
    await h.send({ type: 'edit_open', chatId: h.chatId, messageId: 'reply' });
    const open = h.sent.findLast((m: any) => m.type === 'edit_data');
    h.setComplete(async () => { throw new Error('boom'); });
    await h.send({ type: 'edit_save', chatId: h.chatId, messageId: 'reply', sourceKey: open.sourceKey, edits: [{ index: 0, text: '등불은 꺼져 있었다.' }], syncSource: true });
    const result = h.sent.findLast((m: any) => m.type === 'edit_result');
    expect(result.ok).toBe(true);
    expect(result.error).toContain('번역은 저장했지만 영어 원문은 고치지 못했습니다');
    expect(reply.content.startsWith('The lamp was still burning.')).toBe(true);
    expect(Object.values(entries(reply))[0]!.parts[0]).toBe('등불은 꺼져 있었다.');
  });
});

test('edit: a model reply with a blank line keeps the English and still saves the correction', async () => {
  await withTranslated(async (h, reply) => {
    await h.send({ type: 'edit_open', chatId: h.chatId, messageId: 'reply' });
    const open = h.sent.findLast((m: any) => m.type === 'edit_data');
    h.setComplete(async () => ({ content: 'The lamp went out.\n\nDarkness fell.', finish_reason: 'stop' }));
    const before = h.updates.length;
    await h.send({ type: 'edit_save', chatId: h.chatId, messageId: 'reply', sourceKey: open.sourceKey, edits: [{ index: 0, text: '등불이 꺼졌다.' }], syncSource: true });
    const result = h.sent.findLast((m: any) => m.type === 'edit_result');
    expect(result).toMatchObject({ ok: true, rewritten: 0, saved: true });
    expect(result.error).toContain('원문은 그대로 두었습니다');
    expect(h.updates.length - before).toBe(1);
    expect(h.updates.at(-1).content).toBeUndefined();
    expect(reply.content.startsWith('The lamp was still burning.')).toBe(true);
    expect(Object.values(entries(reply))[0]!.parts[0]).toBe('등불이 꺼졌다.');
  });
});

test('edit: a stale source key or an unfinished record is refused without writing', async () => {
  await withTranslated(async (h) => {
    const before = h.updates.length;
    await h.send({ type: 'edit_save', chatId: h.chatId, messageId: 'reply', sourceKey: 'stale', edits: [{ index: 0, text: 'x' }], syncSource: false });
    expect(h.sent.findLast((m: any) => m.type === 'edit_result').ok).toBe(false);
    expect(h.updates.length).toBe(before);
  });
});

test('edit works on an old host too (whole metadata rewrite in the same single call)', async () => {
  await withTranslated(async (h, reply) => {
    await h.send({ type: 'edit_open', chatId: h.chatId, messageId: 'reply' });
    const open = h.sent.findLast((m: any) => m.type === 'edit_data');
    h.setComplete(async () => ({ content: 'He exhaled.', finish_reason: 'stop' }));
    const before = h.updates.length;
    await h.send({ type: 'edit_save', chatId: h.chatId, messageId: 'reply', sourceKey: open.sourceKey, edits: [{ index: 1, text: '그가 숨을 내쉬었다.' }], syncSource: true });
    expect(h.updates.length - before).toBe(1);
    expect(h.updates.at(-1).content).toContain('He exhaled.');
    expect(h.updates.at(-1).metadata[METADATA_KEY]).toBeDefined();
    expect(reply.content).toContain('He exhaled.');
  }, {});
});

// ---- 기타 지침 보관함 ----

test('notes: save, overwrite with confirmation, limits, delete; loading is a copy done by the frontend', async () => {
  await withHost({}, async (h) => {
    await h.send({ type: 'save_note', note: { name: '지문 문체', text: '  규칙 A  ' } });
    expect(h.sent.findLast((m: any) => m.type === 'note_result').ok).toBe(true);
    let notes = h.store().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].id.startsWith('note-')).toBe(true);
    expect(notes[0].text).toBe('규칙 A');
    // same name: needs confirmation, then replaces the text and keeps the id
    await h.send({ type: 'save_note', note: { name: '지문 문체', text: '규칙 B' } });
    expect(h.sent.findLast((m: any) => m.type === 'note_result')).toMatchObject({ ok: false, needsOverwrite: '지문 문체' });
    expect(h.store().notes[0].text).toBe('규칙 A');
    await h.send({ type: 'save_note', note: { name: '지문 문체', text: '규칙 B' }, overwrite: true });
    notes = h.store().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('규칙 B');
    // inherited limits are reported, never silently cut
    await h.send({ type: 'save_note', note: { name: 'x', text: 'a'.repeat(12001) } });
    expect(h.sent.findLast((m: any) => m.type === 'note_result').error).toContain('12,000');
    await h.send({ type: 'save_note', note: { name: 'n'.repeat(61), text: 'a' } });
    expect(h.sent.findLast((m: any) => m.type === 'note_result').ok).toBe(false);
    expect(h.store().notes).toHaveLength(1);
    await h.send({ type: 'delete_note', id: notes[0].id });
    expect(h.store().notes).toEqual([]);
  });
});

// ---- 놓친 최신 답변 자동 번역 (1.7.2) / 끊긴 생성 (1.7.1) ----

const recentReply = (id = 'a1', index = 1) => makeMessage(id, 'English reply.', 'assistant', index);

test('catch-up: opening the chat translates a recent untranslated reply once, with no whole-chat read on a lean host', async () => {
  await withHost({ caps: LEAN, store: { defaults: { autoTranslate: false }, chats: { chat: { autoTranslate: true } } } }, async (h) => {
    h.messages.push(makeMessage('u1', 'Hi.', 'user', 0), recentReply());
    await h.send({ type: 'hint', chatId: h.chatId, open: true });
    await new Promise((r) => setTimeout(r, 1700));
    await settle();
    expect(h.calls).toHaveLength(1);
    expect(h.record(h.messages[1]!)?.status).toBe('done');
    // the decision read was a bounded tail read
    expect(h.readOptions[0]).toEqual({ tail: 4, light: true });
    // opening again does not translate again (attempt key id:hash)
    await h.send({ type: 'hint', chatId: h.chatId, open: true });
    await new Promise((r) => setTimeout(r, 1700));
    expect(h.calls).toHaveLength(1);
  });
});

test('catch-up skips old replies, translated replies, auto-translate off, running generations and user-stopped replies', async () => {
  const run = async (prepare: (h: any, reply: Message) => void | Promise<void>, autoTranslate = true) => {
    let calls = -1;
    await withHost({ caps: LEAN, store: { defaults: { autoTranslate: false }, chats: { chat: { autoTranslate } } } }, async (h) => {
      const reply = recentReply();
      h.messages.push(makeMessage('u1', 'Hi.', 'user', 0), reply);
      await prepare(h, reply);
      await h.send({ type: 'hint', chatId: h.chatId, open: true });
      await new Promise((r) => setTimeout(r, 1700));
      calls = h.calls.length;
    });
    return calls;
  };
  expect(await run((_h, reply) => { reply.created_at = Math.floor(Date.now() / 1000) - 7200; })).toBe(0);
  expect(await run((_h, reply) => { reply.metadata = { [METADATA_KEY]: { v: 1, entries: { x: { parts: ['번'], pieces: [], total: 1, truncatedPart: -1, status: 'done', updatedAt: 1 } } } }; })).toBe(0);
  expect(await run(() => {}, false)).toBe(0);
  expect(await run((h) => h.event('GENERATION_STARTED', { chatId: h.chatId }))).toBe(0);
  // the user pressed Stop: the partial reply stays untranslated, also on the next open
  expect(await run((h, reply) => h.event('GENERATION_STOPPED', { chatId: h.chatId, content: reply.content }))).toBe(0);
}, 20_000);

test('generation that ends without a normal end (STOPPED) is not translated; a normal end is, even on a lean host', async () => {
  await withHost({ caps: LEAN }, async (h) => {
    const reply = recentReply();
    h.messages.push(makeMessage('u1', 'Hi.', 'user', 0), reply);
    h.event('GENERATION_STOPPED', { chatId: h.chatId, content: reply.content });
    await settle();
    expect(h.calls).toHaveLength(0);
    await h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal' });
    expect(h.record(reply)?.status).toBe('done');
  });
});

// ---- paired dialogue and persona ----

test('paragraph mode: a paragraph the model already wrote as "original" (한국어) is kept without a request', async () => {
  await withHost({ caps: LEAN, store: PARAGRAPH }, async (h) => {
    const reply = makeMessage('reply', 'He smiled.\n\n빅터 | "Salut." (안녕.)\n\n"Come here."', 'assistant', 0);
    h.messages.push(reply);
    h.setComplete(async (input: any) => ({ content: translationOf(input.messages[1].content), finish_reason: 'stop' }));
    await h.send({ type: 'chat', chatId: h.chatId });
    await h.emit({ messageId: 'reply', content: reply.content, generationType: 'normal' });
    expect(h.calls).toHaveLength(2);
    const record = Object.values(entries(reply))[0]!;
    expect(record.parts[1]).toBe('빅터 | "Salut." (안녕.)');
    expect(record.status).toBe('done');
  });
});

test('live preset: the persona name comes from the latest user message and 기타 지침 is sent as a style instruction', async () => {
  await withHost({ caps: LEAN, store: { defaults: { autoTranslate: false }, chats: { chat: { autoTranslate: true, incomingPresetId: 'builtin-korean-style-keep-model-dialogue', freeContextEnabled: true, freeContext: 'STYLE-RULE', incomingVoiceEnabled: true, incomingVoicePrompt: '[Ethan]\n- 사용 언어: 영어' } } } }, async (h) => {
    const reply = recentReply('reply', 1);
    h.messages.push(makeMessage('u1', 'Hi.', 'user', 0), reply);
    await h.emit({ messageId: 'reply', content: reply.content, generationType: 'normal' });
    const system = h.calls[0]!.messages[0].content as string;
    expect(system).toContain('# User Persona\nThe user\'s persona is named "Mina".');
    expect(system).toContain('# User Translation Style Instructions\n');
    expect(system).toContain('STYLE-RULE');
    expect(system).toContain('- 사용 언어: 영어');
    expect(system).toContain('Write the Korean in Hangul only.');
    expect(system).not.toContain('{{voice}}');
  });
});

test('a non-live preset sends no persona section', async () => {
  await withHost({ caps: LEAN }, async (h) => {
    const reply = recentReply('reply', 1);
    h.messages.push(makeMessage('u1', 'Hi.', 'user', 0), reply);
    await h.emit({ messageId: 'reply', content: reply.content, generationType: 'normal' });
    expect(h.calls[0]!.messages[0].content).not.toContain('# User Persona');
  });
});

test('blockKey is the upstream FNV-1a base36 of the normalized paragraph', () => {
  expect(blockKey('*The lamp*  was “still” burning.')).toBe(blockKey('The lamp was "still" burning.'));
});
