// A fake Spindle host for backend tests: counts full and tail reads, records every updateMessage patch,
// and (like the real worker-host) emits MESSAGE_EDITED with the new metadata inside extra.spindle_metadata.
import { expect } from 'bun:test';
import { METADATA_KEY, normalizeStore, sourceHash, type MessageTranslations, type Store, type ToBackend, type ToFrontend } from '../../src/shared';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  extra: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  swipes: Array<string | null>;
  swipe_id: number;
  index_in_chat?: number;
  name?: string;
  created_at?: number;
  is_user?: boolean;
}

export const makeMessage = (id: string, content: string, role: Message['role'] = 'assistant', index = 0): Message =>
  ({ id, role, content, extra: {}, swipes: [content], swipe_id: 0, index_in_chat: index, name: role === 'user' ? 'Mina' : 'Bot', created_at: Math.floor(Date.now() / 1000) - 60, is_user: role === 'user' });

export async function settle() {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

export interface HostOptions {
  caps?: Record<string, number>;
  store?: Partial<Store> | Record<string, unknown>;
  chatMetadata?: Record<string, unknown>;
  /** What spindle.chats.get throws when set (permission missing). */
  chatsDenied?: boolean;
}

let instance = 0;
export async function withHost(options: HostOptions, run: (host: Awaited<ReturnType<typeof fakeHost>>) => Promise<void>) {
  const previous = Reflect.get(globalThis, 'spindle');
  const host = await fakeHost(options);
  try {
    Reflect.set(globalThis, 'spindle', host.api);
    await import(`../../src/backend.ts?fake-host=${++instance}`);
    await run(host);
    await settle();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'spindle');
    else Reflect.set(globalThis, 'spindle', previous);
  }
}

export async function fakeHost(options: HostOptions = {}) {
  const uid = 'owner';
  const chatId = 'chat';
  let store = normalizeStore(options.store ?? { defaults: { autoTranslate: false }, chats: { [chatId]: { autoTranslate: true } } });
  const messages: Message[] = [];
  const chats = new Map<string, Message[]>([[chatId, messages]]);
  const counts = { fullReads: 0, tailReads: 0, writes: 0 };
  const readOptions: unknown[] = [];
  const updates: Array<Record<string, any>> = [];
  const sent: any[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const calls: Record<string, any>[] = [];
  const rpc = { synced: new Map<string, unknown>(), handlers: new Map<string, (ctx: any) => unknown>(), peers: new Map<string, unknown>(), reads: [] as string[] };
  const chatMetadata: { value: Record<string, unknown>; writes: Array<Record<string, any>> } = { value: structuredClone(options.chatMetadata ?? {}), writes: [] };
  const handlers = new Map<string, (payload: any, uid: string) => void>();
  let processor!: (ctx: any) => Promise<{ content: string } | undefined>;
  let receive!: (payload: ToBackend, uid: string) => void;
  let complete = async (_input: Record<string, any>) => ({ content: '번역문', finish_reason: 'stop' });
  const wire = (message: Message) => {
    const { metadata, ...rest } = structuredClone(message);
    return { ...rest, extra: { ...rest.extra, ...(metadata ? { spindle_metadata: metadata } : {}) } };
  };
  const api: Record<string, any> = {
    on(event: string, handler: (payload: any, uid: string) => void) { handlers.set(event, handler); },
    onFrontendMessage(handler: typeof receive) { receive = handler; },
    registerMessageContentProcessor(fn: typeof processor) { processor = fn; },
    sendToFrontend(payload: ToFrontend, userId: string) { expect(userId).toBe(uid); sent.push(structuredClone(payload)); },
    log: { warn(text: string) { warnings.push(text); }, error(text: string) { errors.push(text); }, info() {} },
    toast: { info() {}, warning() {}, error(text: string) { errors.push(text); } },
    userStorage: {
      async getJson() { return structuredClone(store); },
      async setJson(_path: string, value: Store) { store = structuredClone(value); },
    },
    connections: { async list() { return [{ id: 'connection', is_default: true }]; } },
    generate: { async quiet(input: Record<string, any>) { calls.push(input); return complete(input); } },
    chat: {
      async getMessages(id: string, opts?: { tail?: number; light?: boolean }) {
        readOptions.push(opts);
        const all = chats.get(id) ?? [];
        if (opts && options.caps?.['chat-lean-messages-v1']) {
          counts.tailReads++;
          const rows = structuredClone(opts.tail ? all.slice(-opts.tail) : all);
          if (opts.light) for (const row of rows) row.swipes = row.swipes.map((s, i) => (i === row.swipe_id ? s : null));
          return rows;
        }
        counts.fullReads++;
        return structuredClone(all);
      },
      async updateMessage(id: string, messageId: string, patch: Record<string, any>) {
        counts.writes++;
        updates.push(structuredClone(patch));
        const message = chats.get(id)?.find((m) => m.id === messageId);
        if (!message) throw new Error('Message not found');
        if (typeof patch.content === 'string') { message.content = patch.content; message.swipes[message.swipe_id] = patch.content; }
        if (patch.metadata !== undefined) message.metadata = structuredClone(patch.metadata);
        if (patch.ownMetadata !== undefined && options.caps?.['chat-lean-messages-v1']) message.metadata = { ...(message.metadata ?? {}), [METADATA_KEY]: structuredClone(patch.ownMetadata) };
        handlers.get('MESSAGE_EDITED')?.({ chatId: id, message: wire(message) }, uid);
      },
    },
    chats: {
      async get() {
        if (options.chatsDenied) throw new Error('permission denied: chats');
        return { id: chatId, metadata: structuredClone(chatMetadata.value) };
      },
      async compareAndSetMetadata(_id: string, input: { expected_metadata: Record<string, unknown>; metadata: Record<string, unknown> }) {
        if (options.chatsDenied) throw new Error('permission denied: chats');
        chatMetadata.writes.push(structuredClone(input));
        if (JSON.stringify(input.expected_metadata) !== JSON.stringify(chatMetadata.value)) return null;
        chatMetadata.value = structuredClone(input.metadata);
        return { id: chatId, metadata: structuredClone(chatMetadata.value) };
      },
    },
    host: { descriptorVersion: 1, lumiverseVersion: 'test', capabilities: options.caps ?? {}, extensionInstallationId: 'inst' },
    rpcPool: {
      sync(endpoint: string, value: unknown) { rpc.synced.set(endpoint, value); return endpoint; },
      handle(endpoint: string, handler: (ctx: any) => unknown) { rpc.handlers.set(endpoint, handler); return endpoint; },
      async read(endpoint: string) { rpc.reads.push(endpoint); if (!rpc.peers.has(endpoint)) throw new Error('endpoint not found'); return rpc.peers.get(endpoint); },
      unregister(endpoint: string) { rpc.synced.delete(endpoint); rpc.handlers.delete(endpoint); },
    },
  };
  return {
    api, chatId, uid, messages, sent, calls, warnings, errors, counts, readOptions, updates, rpc, chatMetadata, chats,
    event(name: string, payload: Record<string, unknown>) { handlers.get(name)?.(structuredClone(payload), uid); },
    async render(message: Message) { return processor({ origin: 'render', chatId, messageId: message.id, content: message.content, userId: uid }); },
    setComplete(fn: typeof complete) { complete = fn; },
    async send(payload: ToBackend) { receive(payload, uid); await settle(); },
    async emit(payload: Record<string, unknown>) { handlers.get('GENERATION_ENDED')!({ generationId: 'generation', chatId, ...payload }, uid); await settle(); },
    store: (): any => store,
    record(message: Message, source = message.content) {
      return (message.metadata?.[METADATA_KEY] as MessageTranslations | undefined)?.entries[sourceHash(source)];
    },
  };
}
