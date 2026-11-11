import { expect, test, spyOn } from 'bun:test';
import { METADATA_KEY, normalizeStore, sourceHash, rawSourceHash, type MessageTranslations, type Store, type ToBackend, type ToFrontend } from '../src/shared';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  extra: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  swipes: string[];
  swipe_id: number;
}

const makeMessage = (id: string, content: string, role: Message['role'] = 'assistant'): Message =>
  ({ id, role, content, extra: {}, swipes: [content], swipe_id: 0 });

function translatedMessage(id: string): Message {
  const message = makeMessage(id, `Source ${id}.`);
  message.metadata = { otherExtension: { kept: true }, [METADATA_KEY]: { v: 1, entries: {
    [sourceHash(message.content)]: { parts: [`번역 ${id}`], pieces: [], total: 1, truncatedPart: -1, status: 'done', updatedAt: 1 },
  } } };
  return message;
}

async function settle() {
  // The real worker dispatches events without awaiting extension callbacks.
  // Drain their async continuations, including reads, completions and writes.
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

let instance = 0;
async function withHost(run: (host: Awaited<ReturnType<typeof fakeHost>>) => Promise<void>) {
  const previous = Reflect.get(globalThis, 'spindle');
  const host = await fakeHost();
  try {
    Reflect.set(globalThis, 'spindle', host.api);
    await import(`../src/backend.ts?auto-test=${++instance}`);
    await run(host);
    await settle();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'spindle');
    else Reflect.set(globalThis, 'spindle', previous);
  }
}

async function fakeHost() {
  const uid = 'owner';
  const chatId = 'chat';
  let store = normalizeStore({ defaults: { autoTranslate: false }, chats: {
    [chatId]: { autoTranslate: true, translateMyMessages: true, contextEnabled: true, contextIncludeUserInput: true },
  } });
  const messages: Message[] = [];
  const chats = new Map<string, Message[]>([[chatId, messages]]);
  const counts = { reads: 0, writes: 0 };
  let onRead = async (_rows: Message[]) => {};
  const sent: ToFrontend[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const calls: Record<string, any>[] = [];
  const handlers = new Map<string, (payload: any, uid: string) => void>();
  let processor!: (ctx: any) => Promise<{ content: string } | undefined>;
  let receive!: (payload: ToBackend, uid: string) => void;
  let complete = async (_input: Record<string, any>) => ({ content: '번역문', finish_reason: 'stop' });
  const api = {
    on(event: string, handler: (payload: any, uid: string) => void) { handlers.set(event, handler); },
    onFrontendMessage(handler: typeof receive) { receive = handler; },
    registerMessageContentProcessor(fn: typeof processor) { processor = fn; },
    sendToFrontend(payload: ToFrontend, userId: string) { expect(userId).toBe(uid); sent.push(structuredClone(payload)); },
    log: { warn(text: string) { warnings.push(text); }, error(text: string) { errors.push(text); } },
    toast: { info() {}, warning() {}, error(text: string) { errors.push(text); } },
    userStorage: {
      async getJson(_path: string, options: { userId: string }) { expect(options.userId).toBe(uid); return structuredClone(store); },
      async setJson(_path: string, value: Store) { store = structuredClone(value); },
    },
    connections: { async list(userId: string) { expect(userId).toBe(uid); return [{ id: 'connection', is_default: true }]; } },
    generate: { async quiet(input: Record<string, any>) { calls.push(input); return complete(input); } },
    chat: {
      async getMessages(id: string) {
        counts.reads++;
        const rows = structuredClone(chats.get(id) ?? []);
        await onRead(rows);
        return rows;
      },
      async updateMessage(id: string, messageId: string, patch: { metadata: Record<string, unknown> }) {
        counts.writes++;
        const message = chats.get(id)?.find((m) => m.id === messageId);
        if (!message) throw new Error('Message not found');
        // worker-host splits extra.spindle_metadata into metadata on read and
        // merges it back on update. Content/swipe selection stays unchanged.
        message.metadata = structuredClone(patch.metadata);
        handlers.get('MESSAGE_EDITED')?.({ chatId: id, message: structuredClone(message) }, uid);
      },
    },
  };
  return {
    api, chatId, messages, sent, calls, warnings, errors, counts, chats,
    event(name: string, payload: Record<string, unknown>) { handlers.get(name)?.(structuredClone(payload), uid); },
    setRead(fn: typeof onRead) { onRead = fn; },
    async render(message: Message, forChat = chatId) { return processor({ origin: 'render', chatId: forChat, messageId: message.id, content: message.content, userId: uid }); },
    edit(message: Message, content: string) {
      message.content = content;
      message.swipes[message.swipe_id] = content;
      handlers.get('MESSAGE_EDITED')?.({ chatId, message }, uid);
    },
    setComplete(fn: typeof complete) { complete = fn; },
    async send(payload: ToBackend) { receive(payload, uid); await settle(); },
    async emit(payload: Record<string, unknown>) { handlers.get('GENERATION_ENDED')!({ generationId: 'generation', chatId, ...payload }, uid); await settle(); },
    record(message: Message, source = message.content) {
      return (message.metadata?.[METADATA_KEY] as MessageTranslations | undefined)?.entries[sourceHash(source)];
    },
  };
}

test('bidirectional normal reply: outgoing completion leaves no record/job that blocks incoming', async () => {
  await withHost(async (h) => {
    await h.send({ type: 'translate_text', reqId: 'outgoing', chatId: h.chatId, text: '안녕하세요' });
    expect(h.sent).toContainEqual({ type: 'text_result', reqId: 'outgoing', ok: true, text: '번역문' });
    expect(h.calls).toHaveLength(1);
    // Outgoing context read has already populated the render cache with [].
    h.messages.push(makeMessage('user', '번역문', 'user'));
    const reply = makeMessage('reply', 'Hello there.');
    h.messages.push(reply);
    await h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal', frontendSessionId: 'session' });
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.userId).toBe('owner');
    expect(h.record(reply)?.status).toBe('done');
    expect(h.record(h.messages[0]!)).toBeUndefined();
    expect(h.errors).toEqual([]);
  });
});

test.each(['regenerate', 'swipe', 'continue'])('%s end translates the generated swipe even after navigation to a translated old swipe', async (generationType) => {
  await withHost(async (h) => {
    await h.send({ type: 'translate_text', reqId: 'outgoing', chatId: h.chatId, text: '안녕하세요' });
    const reply = makeMessage('reply', 'Old reply.');
    h.messages.push(reply);
    await h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal' });
    expect(h.record(reply)?.status).toBe('done');
    // generate.service persists the regenerated swipe before GENERATION_ENDED.
    // If the user navigated mid-stream, content remains the old active swipe;
    // the event's content is the generated swipe. There is no targetSwipeId here.
    const generated = 'New regenerated reply.';
    reply.swipes.push(generated);
    await h.emit({ messageId: reply.id, content: generated, generationType });
    expect(h.record(reply, generated)?.status).toBe('done');
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2]!.messages[1].content).toContain(generated);
    expect(reply.content).toBe('Old reply.');
    expect(reply.swipe_id).toBe(0);
    expect(h.errors).toEqual([]);
  });
});

test('a new generated swipe waits for an in-flight translation instead of being dropped', async () => {
  await withHost(async (h) => {
    const reply = makeMessage('reply', 'First reply.');
    h.messages.push(reply);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    h.setComplete(async () => { await pending; return { content: '번역문', finish_reason: 'stop' }; });
    try {
      await h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal' });
      expect(h.calls).toHaveLength(1);
      reply.content = 'Second reply.';
      reply.swipes.push(reply.content);
      reply.swipe_id = 1;
      await h.emit({ messageId: reply.id, content: reply.content, generationType: 'regenerate', generationId: 'second' });
    } finally {
      release();
      await settle();
    }
    expect(h.record(reply, 'First reply.')?.status).toBe('done');
    expect(h.record(reply, 'Second reply.')?.status).toBe('done');
    expect(h.calls).toHaveLength(2);
    expect(h.errors).toEqual([]);
  });
});

test.each([
  ['missing-message-id', {}, undefined],
  ['missing-chat-id', { chatId: undefined, messageId: 'reply' }, undefined],
  ['generation-error', { error: 'provider failed', messageId: 'reply' }, undefined],
  ['message-not-found', { messageId: 'missing' }, undefined],
  ['unexpected-role', { messageId: 'reply' }, makeMessage('reply', 'User text', 'user')],
  ['empty-content', { messageId: 'reply', content: '' }, makeMessage('reply', '')],
  ['generated-content-not-found', { messageId: 'reply', content: 'Unavailable swipe' }, makeMessage('reply', 'Other swipe')],
] as const)('automatic skip warns with context: %s', async (reason, payload, message) => {
  await withHost(async (h) => {
    if (message) h.messages.push(structuredClone(message));
    await h.emit(payload);
    expect(h.calls).toHaveLength(0);
    expect(h.warnings.some((warning) => warning.includes(reason) && warning.includes('generation'))).toBe(true);
  });
});

test('duplicate events wait for one job, then skip only the completed matching source', async () => {
  await withHost(async (h) => {
    const reply = makeMessage('reply', 'Hello.');
    h.messages.push(reply);
    await Promise.all([
      h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal' }),
      h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal' }),
    ]);
    expect(h.calls).toHaveLength(1);
    expect(h.record(reply)?.status).toBe('done');
    expect(h.warnings.some((warning) => warning.includes('already-translated'))).toBe(true);
  });
});

test('chat settings override defaults and impersonation never translates a user message', async () => {
  await withHost(async (h) => {
    const reply = makeMessage('reply', 'Hello.');
    h.messages.push(reply);
    const settings = normalizeStore(null).defaults;
    await h.send({ type: 'save_settings', chatId: null, settings: { ...settings, autoTranslate: true }, asDefault: true });
    await h.send({ type: 'save_settings', chatId: h.chatId, settings: { ...settings, autoTranslate: false }, asDefault: false });
    await h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal' });
    expect(h.calls).toHaveLength(0);
    await h.send({ type: 'save_settings', chatId: h.chatId, settings: { ...settings, autoTranslate: true }, asDefault: false });
    await h.emit({ generationType: 'impersonate', impersonateDraft: true });
    await h.emit({ messageId: 'user', generationType: 'impersonate' });
    expect(h.calls).toHaveLength(0);
    expect(h.warnings).toEqual([]);
    // The earlier disabled path must have released its job key.
    await h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal' });
    expect(h.record(reply)?.status).toBe('done');
  });
});

test('a missing reply is diagnosed, releases its job, and is readable on a later event', async () => {
  await withHost(async (h) => {
    await h.emit({ messageId: 'reply', content: 'Hello.', generationType: 'normal' });
    expect(h.warnings.some((warning) => warning.includes('message-not-found'))).toBe(true);
    const reply = makeMessage('reply', 'Hello.');
    h.messages.push(reply);
    await h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal' });
    expect(h.record(reply)?.status).toBe('done');
    expect(h.calls).toHaveLength(1);
  });
});

test('failed nonactive swipe translation is logged and can retry without corrupting the active record', async () => {
  await withHost(async (h) => {
    const reply = makeMessage('reply', 'Old reply.');
    h.messages.push(reply);
    await h.emit({ messageId: reply.id, content: reply.content, generationType: 'normal' });
    reply.swipes.push('New reply.');
    h.setComplete(async () => { throw new Error('provider unavailable'); });
    await h.emit({ messageId: reply.id, content: 'New reply.', generationType: 'regenerate' });
    expect(h.record(reply)?.status).toBe('done');
    expect(h.record(reply, 'New reply.')?.status).toBe('error');
    expect(h.warnings.some((warning) => warning.includes('translation-failed') && warning.includes('provider unavailable'))).toBe(true);
    h.setComplete(async () => ({ content: '다시 번역', finish_reason: 'stop' }));
    await h.emit({ messageId: reply.id, content: 'New reply.', generationType: 'regenerate' });
    expect(h.record(reply, 'New reply.')?.status).toBe('done');
    expect(h.record(reply)?.parts).toEqual(['번역문']);
  });
});

const illustrationTag = '<pic chars="Ada" prompt="sunset">';
const illustrationImage = '![그림:p123|sunset](/api/v1/image-gen/results/123)';

test('saved automatic translation still renders after LV-Illust edits the same message', async () => {
  await withHost(async (h) => {
    const reply = makeMessage('reply', `Before ${illustrationTag} After`);
    h.messages.push(reply);
    h.setComplete(async () => ({ content: '앞 ⟦1⟧ 뒤', finish_reason: 'stop' }));
    await h.emit({ messageId: reply.id, content: reply.content });
    expect(h.record(reply)?.status).toBe('done');
    h.edit(reply, `Before ${illustrationImage} After`);
    const rendered = await h.render(reply);
    expect(rendered?.content).toContain(`앞 ${illustrationImage} 뒤`);
    expect(h.calls).toHaveLength(1);
  });
});

test('LV-Illust may replace the tag before the automatic handler reads the message', async () => {
  await withHost(async (h) => {
    const original = `Before ${illustrationTag} After`;
    const reply = makeMessage('reply', `Before ${illustrationImage} After`);
    h.messages.push(reply);
    h.setComplete(async () => ({ content: '앞 ⟦1⟧ 뒤', finish_reason: 'stop' }));
    await h.emit({ messageId: reply.id, content: original });
    expect(h.record(reply)?.status).toBe('done');
    expect((await h.render(reply))?.content).toContain(`앞 ${illustrationImage} 뒤`);
    expect(h.warnings.some((w) => w.includes('generated-content-not-found'))).toBe(false);
  });
});


test('legacy raw-hash record renders, skips duplicate work, and deletes using its actual UI key', async () => {
  await withHost(async (h) => {
    const original = `Before ${illustrationTag} After`;
    const reply = makeMessage('reply', original);
    const oldKey = rawSourceHash(original);
    reply.metadata = { [METADATA_KEY]: { v: 1, entries: {
      [oldKey]: { parts: ['앞 ⟦1⟧ 뒤'], pieces: [illustrationTag], total: 1, truncatedPart: -1, status: 'done', updatedAt: 1 },
    } } };
    h.messages.push(reply);
    expect((await h.render(reply))?.content).toContain(`앞 ${illustrationTag} 뒤`);
    h.edit(reply, `Before ${illustrationImage} After`);
    expect((await h.render(reply))?.content).toContain(`앞 ${illustrationImage} 뒤`);
    await h.emit({ messageId: reply.id, content: reply.content });
    expect(h.calls).toHaveLength(0);
    await h.send({ type: 'chat', chatId: h.chatId });
    const views = h.sent.filter((m) => m.type === 'views').at(-1);
    expect(views?.views[0]?.sourceKey).toBe(oldKey);
    expect(views?.views[0]?.text).toBe(`앞 ${illustrationImage} 뒤`);
    await h.send({ type: 'delete_translation', chatId: h.chatId, messageId: reply.id, sourceKey: oldKey });
    expect((await h.render(reply))?.content).toBeUndefined();
    expect((reply.metadata[METADATA_KEY] as MessageTranslations).entries).toEqual({});
  });
});

test('image swap while model completion is pending saves under the stable key', async () => {
  await withHost(async (h) => {
    const reply = makeMessage('reply', `Before ${illustrationTag} After`);
    h.messages.push(reply);
    h.setComplete(async () => {
      h.edit(reply, `Before ${illustrationImage} After`);
      return { content: '앞 ⟦1⟧ 뒤', finish_reason: 'stop' };
    });
    await h.emit({ messageId: reply.id, content: reply.content });
    expect(h.record(reply)?.status).toBe('done');
    expect((await h.render(reply))?.content).toContain(`앞 ${illustrationImage} 뒤`);
    expect(Object.keys((reply.metadata?.[METADATA_KEY] as MessageTranslations).entries)).toEqual([sourceHash(reply.content)]);
  });
});

test('fetch diet: 500-message open sends at most 30 views and shares one read with renders', async () => {
  await withHost(async (h) => {
    h.messages.push(...Array.from({ length: 500 }, (_, i) => translatedMessage(`m${i}`)));
    await Promise.all([
      h.send({ type: 'chat', chatId: h.chatId }),
      ...h.messages.slice(-30).map((message) => h.render(message)),
    ]);
    expect(h.counts.reads).toBe(1);
    const open = h.sent.filter((m) => m.type === 'views');
    expect(open).toHaveLength(1);
    expect(open[0]!.views).toHaveLength(30);
    expect(open[0]!.views[0]!.messageId).toBe('m470');
    // Older rows are delivered only when the browser requests their ids.
    await h.send({ type: 'view_messages', chatId: h.chatId, messageIds: ['m2', 'm3'] });
    expect(h.sent.at(-1)).toMatchObject({ type: 'views', replace: false, views: [{ messageId: 'm2' }, { messageId: 'm3' }] });
    expect(h.counts.reads).toBe(1);
    // Even a malformed/oversized client window cannot cause a full-chat push.
    await h.send({ type: 'chat', chatId: h.chatId, messageIds: h.messages.map((m) => m.id) });
    const capped = h.sent.at(-1);
    expect(capped?.type === 'views' && capped.views.length).toBe(30);
  });
});

test('fetch diet: untranslated rows carry only ids, and missing/deleted state is acknowledged', async () => {
  await withHost(async (h) => {
    h.messages.push(...Array.from({ length: 500 }, (_, i) => makeMessage(`m${i}`, 'Hello.')));
    h.messages[499]!.role = 'system';
    await h.send({ type: 'chat', chatId: h.chatId });
    expect(h.counts.reads).toBe(1);
    const open = h.sent.at(-1);
    expect(open?.type).toBe('views');
    if (open?.type !== 'views') throw new Error('Missing views');
    expect(open.views).toEqual([]);
    expect(open.plainIds).toHaveLength(29);
    expect(open.plainIds).not.toContain('m499');
    await h.send({ type: 'view_messages', chatId: h.chatId, messageIds: ['missing'] });
    expect(h.sent.at(-1)).toMatchObject({ views: [], requestedIds: ['missing'], plainIds: [] });
  });
});

test('fetch diet: ten rapid progress ticks use one read, two saves and single-message views', async () => {
  const now = spyOn(Date, 'now').mockReturnValue(10_000);
  try {
    await withHost(async (h) => {
      const settings = { ...normalizeStore(null).defaults, translationUnit: 'paragraph' as const };
      await h.send({ type: 'save_settings', chatId: h.chatId, settings, asDefault: false });
      const reply = makeMessage('ten', Array.from({ length: 10 }, (_, i) => `Paragraph ${i}.`).join('\n\n'));
      h.messages.push(reply);
      await h.send({ type: 'translate', chatId: h.chatId, messageId: reply.id, force: false });
      expect(h.calls).toHaveLength(10); // engine emits one onProgress for each paragraph
      expect(h.counts).toEqual({ reads: 1, writes: 2 });
      expect(h.record(reply)?.parts).toHaveLength(10);
      expect(h.record(reply)?.status).toBe('done');
      const views = h.sent.filter((m) => m.type === 'views');
      expect(views.map((m) => m.views.length)).toEqual([1, 1, 1]);
      expect(views.at(-1)?.views[0]?.busy).toBe(false);
      expect(h.errors).toEqual([]);
    });
  } finally { now.mockRestore(); }
});

test('fetch diet: spaced progress ticks save at 1s intervals and always flush the final result', async () => {
  let clock = 10_000;
  const now = spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    await withHost(async (h) => {
      const settings = { ...normalizeStore(null).defaults, translationUnit: 'paragraph' as const };
      await h.send({ type: 'save_settings', chatId: h.chatId, settings, asDefault: false });
      const reply = makeMessage('ten', Array.from({ length: 10 }, (_, i) => `Paragraph ${i}.`).join('\n\n'));
      h.messages.push(reply);
      h.setComplete(async () => { clock += 250; return { content: '번역', finish_reason: 'stop' }; });
      await h.send({ type: 'translate', chatId: h.chatId, messageId: reply.id, force: false });
      expect(h.counts).toEqual({ reads: 1, writes: 4 }); // ticks 1, 5, 9 + final
      expect(h.record(reply)?.parts).toHaveLength(10);
    });
  } finally { now.mockRestore(); }
});

test('fetch diet: new-message automatic translation reads once after chat open', async () => {
  await withHost(async (h) => {
    h.messages.push(...Array.from({ length: 500 }, (_, i) => translatedMessage(`m${i}`)));
    await h.send({ type: 'chat', chatId: h.chatId });
    const before = h.counts.reads;
    const reply = makeMessage('new', 'New reply.');
    h.messages.push(reply);
    h.event('MESSAGE_SENT', { chatId: h.chatId, message: reply });
    await h.emit({ messageId: reply.id, content: reply.content });
    expect(h.counts.reads - before).toBe(1);
    expect(h.record(reply)?.status).toBe('done');
    expect(h.sent.filter((m) => m.type === 'views').map((m) => m.views.length)).toEqual([30, 1, 1, 1]);
    expect((await h.render(reply))?.content).toContain('번역문');
    expect(h.counts.reads - before).toBe(1);
  });
});

test.each(['MESSAGE_EDITED', 'MESSAGE_SWIPED', 'SWIPE_EDITED'])('fetch diet: wire DTO %s updates cached metadata/content without another read', async (event) => {
  await withHost(async (h) => {
    const reply = translatedMessage('reply');
    h.messages.push(reply);
    await h.send({ type: 'chat', chatId: h.chatId });
    const original = reply.content;
    reply.content = 'New swipe.';
    reply.swipes.push(reply.content);
    const metadata = reply.metadata!;
    (metadata[METADATA_KEY] as MessageTranslations).entries[sourceHash(reply.content)] = {
      parts: ['새 번역'], pieces: [], total: 1, truncatedPart: -1, status: 'done', updatedAt: 2,
    };
    const { role, metadata: _metadata, ...wire } = reply;
    h.event(event, { chatId: h.chatId, message: { ...wire, is_user: false, extra: { spindle_metadata: metadata } } });
    expect((await h.render(reply))?.content).toContain('새 번역');
    await h.send({ type: 'view_messages', chatId: h.chatId, messageIds: [reply.id] });
    expect(h.sent.at(-1)).toMatchObject({ views: [{ sourceKey: sourceHash(reply.content), text: '새 번역' }] });
    await h.send({ type: 'set_hidden', chatId: h.chatId, messageId: reply.id, hidden: true });
    expect(reply.metadata?.otherExtension).toEqual({ kept: true });
    expect(h.record(reply, original)?.status).toBe('done');
    expect(h.counts.reads).toBe(1);
  });
});

test('fetch diet: edit/delete events during an in-flight read win over stale rows', async () => {
  await withHost(async (h) => {
    const reply = translatedMessage('reply');
    const deleted = translatedMessage('deleted');
    h.messages.push(reply, deleted);
    h.setRead(async () => {
      h.edit(reply, 'Edited text.');
      h.messages.splice(1, 1);
      h.event('MESSAGE_DELETED', { chatId: h.chatId, messageId: deleted.id });
    });
    await h.send({ type: 'chat', chatId: h.chatId });
    expect(await h.render(reply)).toBeUndefined();
    expect(await h.render(deleted)).toBeUndefined();
    expect(h.sent.at(-1)).toMatchObject({ views: [{ messageId: 'reply', text: null }] });
    expect(h.counts.reads).toBe(1);
  });
});

test('fetch diet: a deleted message is not saved or pushed again when its completion returns', async () => {
  await withHost(async (h) => {
    const reply = makeMessage('reply', 'Pending reply.');
    h.messages.push(reply);
    h.setComplete(async () => {
      h.messages.splice(0, 1);
      h.event('MESSAGE_DELETED', { chatId: h.chatId, messageId: reply.id });
      return { content: '번역', finish_reason: 'stop' };
    });
    await h.emit({ messageId: reply.id, content: reply.content });
    expect(h.counts).toEqual({ reads: 1, writes: 0 });
    expect(h.sent.filter((m) => m.type === 'views')).toHaveLength(1); // initial busy view only
    await h.send({ type: 'view_messages', chatId: h.chatId, messageIds: [reply.id] });
    expect(h.sent.at(-1)).toMatchObject({ views: [], requestedIds: ['reply'] });
  });
});

test('fetch diet: chat switches keep snapshots isolated, including edits to the inactive chat', async () => {
  await withHost(async (h) => {
    const first = translatedMessage('first');
    const second = translatedMessage('second');
    h.messages.push(first);
    h.chats.set('other', [second]);
    await h.send({ type: 'chat', chatId: h.chatId });
    await h.send({ type: 'chat', chatId: 'other' });
    h.edit(first, 'Edited while away.');
    await h.send({ type: 'chat', chatId: h.chatId });
    expect(h.sent.at(-1)).toMatchObject({ chatId: h.chatId, views: [{ messageId: 'first', text: null }] });
    expect((await h.render(second, 'other'))?.content).toContain('번역 second');
    expect(h.counts.reads).toBe(2);
  });
});

test('fetch diet: id-only host events invalidate once, including during a pending read', async () => {
  await withHost(async (h) => {
    const reply = translatedMessage('reply');
    h.messages.push(reply);
    h.setRead(async () => { h.event('MESSAGE_EDITED', { chatId: h.chatId }); });
    await h.send({ type: 'chat', chatId: h.chatId });
    h.setRead(async () => {});
    reply.content = 'Changed without a message DTO.';
    await h.send({ type: 'chat', chatId: h.chatId });
    await h.send({ type: 'chat', chatId: h.chatId });
    expect(h.counts.reads).toBe(2);
    expect(await h.render(reply)).toBeUndefined();
  });
});

test('fetch diet: failure flushes progress that was skipped by throttling', async () => {
  const now = spyOn(Date, 'now').mockReturnValue(10_000);
  try {
    await withHost(async (h) => {
      const settings = { ...normalizeStore(null).defaults, translationUnit: 'paragraph' as const };
      await h.send({ type: 'save_settings', chatId: h.chatId, settings, asDefault: false });
      const reply = makeMessage('reply', 'First.\n\nSecond.\n\nThird.');
      h.messages.push(reply);
      h.setComplete(async () => {
        if (h.calls.length === 3) throw new Error('provider failed');
        return { content: '번역', finish_reason: 'stop' };
      });
      await h.send({ type: 'translate', chatId: h.chatId, messageId: reply.id, force: false });
      expect(h.counts).toEqual({ reads: 1, writes: 2 });
      expect(h.record(reply)?.parts).toHaveLength(2);
      expect(h.record(reply)?.status).toBe('error');
    });
  } finally { now.mockRestore(); }
});

test('fetch diet: delete translation waits for cancellation so a final save cannot resurrect it', async () => {
  await withHost(async (h) => {
    const reply = translatedMessage('reply');
    h.messages.push(reply);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    h.setComplete(async () => { await pending; return { content: '새 번역', finish_reason: 'stop' }; });
    await h.send({ type: 'translate', chatId: h.chatId, messageId: reply.id, force: true });
    await h.send({ type: 'delete_translation', chatId: h.chatId, messageId: reply.id, sourceKey: sourceHash(reply.content) });
    release();
    await settle();
    expect(h.record(reply)).toBeUndefined();
    expect(reply.metadata?.otherExtension).toEqual({ kept: true });
    expect(h.counts.reads).toBe(1);
    expect(h.sent.at(-1)).toMatchObject({ views: [{ text: null, status: null, busy: false }] });
  });
});

test('fetch diet: outgoing context and hide/delete controls reuse the open snapshot', async () => {
  await withHost(async (h) => {
    const reply = translatedMessage('reply');
    h.messages.push(reply);
    await h.send({ type: 'chat', chatId: h.chatId });
    await h.send({ type: 'translate_text', reqId: 'outgoing', chatId: h.chatId, text: '안녕' });
    expect(h.calls[0]!.messages[1].content).toContain('<translation>번역 reply</translation>');
    expect(h.counts.reads).toBe(1);
    await h.send({ type: 'set_hidden', chatId: h.chatId, messageId: reply.id, hidden: true });
    await h.send({ type: 'delete_translation', chatId: h.chatId, messageId: reply.id });
    expect(h.counts.reads).toBe(1);
    expect(h.record(reply)).toBeUndefined();
  });
});

test('fetch diet: new wire system rows obtain the host-normalized role before offering translation', async () => {
  await withHost(async (h) => {
    await h.send({ type: 'chat', chatId: h.chatId });
    const system = makeMessage('system', 'System row.', 'system');
    h.messages.push(system);
    const { role, ...wire } = system;
    h.event('MESSAGE_SENT', { chatId: h.chatId, message: { ...wire, is_user: false } });
    await h.send({ type: 'view_messages', chatId: h.chatId, messageIds: ['system'] });
    expect(h.sent.at(-1)).toMatchObject({ views: [], plainIds: [] });
    expect(h.counts.reads).toBe(2); // initial snapshot + one necessary role normalization
  });
});
