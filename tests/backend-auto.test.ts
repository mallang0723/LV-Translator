import { expect, test } from 'bun:test';
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
      async getMessages(id: string) { expect(id).toBe(chatId); return structuredClone(messages); },
      async updateMessage(id: string, messageId: string, patch: { metadata: Record<string, unknown> }) {
        expect(id).toBe(chatId);
        const message = messages.find((m) => m.id === messageId);
        if (!message) throw new Error('Message not found');
        // worker-host splits extra.spindle_metadata into metadata on read and
        // merges it back on update. Content/swipe selection stays unchanged.
        message.metadata = structuredClone(patch.metadata);
        handlers.get('MESSAGE_EDITED')?.({ chatId, message: structuredClone(message) }, uid);
      },
    },
  };
  return {
    api, chatId, messages, sent, calls, warnings, errors,
    async render(message: Message) { return processor({ origin: 'render', chatId, messageId: message.id, content: message.content, userId: uid }); },
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
