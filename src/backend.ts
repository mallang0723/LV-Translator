// Backend worker: settings, translation records in message metadata, automatic translation
// after generation, outgoing message translation, and the display (render) transform.

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import { BUILTIN_IDS, presetSummaries, promptPresets } from './presets';
import {
  type ChatSettings,
  type ConnectionSummary,
  effectiveConnectionId,
  INHERIT_PRESET_ID,
  METADATA_KEY,
  type MessageTranslations,
  type MessageView,
  normalizeSettings,
  normalizeStore,
  normalizeView,
  recordHasMore,
  settingsFor,
  sourceHash,
  type Store,
  type ToBackend,
  type ToFrontend,
  type TranslationRecord,
} from './shared';
import { type ConnectionHint, friendlyError, quietComplete, SOURCE_LABELS } from './connection';
import { renderMessage } from './display/render';
import { clearTranslation, isTranslationHidden, recordFor, skipFresh } from './message-ui';
import { type Completion, recordToText, translate, TranslationError } from './translate/engine';
import type { ContextMessage, Direction, TranslationRequest } from './translate/prompt';
import { ExcludeRuleError } from './translate/protect';

const STORE_PATH = 'translator.json';
const MAX_ENTRIES_PER_MESSAGE = 12;

type Uid = string | undefined;
const userKey = (uid: Uid) => uid ?? '';

interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  extra: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  index_in_chat?: number;
  name?: string;
}

// ---- store ----

const stores = new Map<string, Store>();

async function loadStore(uid: Uid): Promise<Store> {
  const cached = stores.get(userKey(uid));
  if (cached) return cached;
  const raw = await spindle.userStorage.getJson<unknown>(STORE_PATH, { fallback: null, userId: uid });
  const store = normalizeStore(raw);
  stores.set(userKey(uid), store);
  return store;
}

async function saveStore(uid: Uid, store: Store): Promise<Store> {
  const clean = normalizeStore(store);
  await spindle.userStorage.setJson(STORE_PATH, clean, { indent: 2, userId: uid });
  stores.set(userKey(uid), clean);
  return clean;
}

function send(payload: ToFrontend, uid: Uid): void {
  spindle.sendToFrontend(payload, uid);
}

async function connections(uid: Uid): Promise<ConnectionSummary[]> {
  try {
    const list = await spindle.connections.list(uid);
    return list.map((c) => ({ id: c.id, name: c.name, model: c.model, provider: c.provider, isDefault: c.is_default === true }));
  } catch {
    return [];
  }
}

async function sendState(uid: Uid): Promise<void> {
  const store = await loadStore(uid);
  send({ type: 'state', store, presets: presetSummaries(store.userPresets), connections: await connections(uid) }, uid);
}

// ---- translation records ----

function readTranslations(message: ChatMessage): MessageTranslations | null {
  const raw = message.metadata?.[METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const mt = raw as MessageTranslations;
  if (!mt.entries || typeof mt.entries !== 'object') return null;
  return mt;
}

/** chatId -> messageId -> translations; used by the render transform. */
const chatCache = new Map<string, Map<string, MessageTranslations | null>>();
const chatLoads = new Map<string, Promise<Map<string, MessageTranslations | null>>>();

function cacheMessages(chatId: string, messages: ChatMessage[]): void {
  chatCache.set(chatId, new Map(messages.map((m) => [m.id, readTranslations(m)])));
}

async function getMessages(chatId: string): Promise<ChatMessage[]> {
  const messages = (await spindle.chat.getMessages(chatId)) as unknown as ChatMessage[];
  cacheMessages(chatId, messages);
  return messages;
}

function cachedChat(chatId: string): Promise<Map<string, MessageTranslations | null>> {
  const hit = chatCache.get(chatId);
  if (hit) return Promise.resolve(hit);
  let load = chatLoads.get(chatId);
  if (!load) {
    load = getMessages(chatId)
      .then(() => chatCache.get(chatId)!)
      .finally(() => chatLoads.delete(chatId));
    chatLoads.set(chatId, load);
  }
  return load;
}

/** Read-modify-write of our key only; other extensions' metadata is kept. */
async function writeTranslations(chatId: string, messageId: string, change: (mt: MessageTranslations, message: ChatMessage) => void): Promise<ChatMessage | null> {
  const messages = await getMessages(chatId);
  const message = messages.find((m) => m.id === messageId);
  if (!message) return null;
  const mt: MessageTranslations = structuredClone(readTranslations(message) ?? { v: 1, entries: {} });
  change(mt, message);
  const keys = Object.keys(mt.entries).sort((a, b) => (mt.entries[b]!.updatedAt ?? 0) - (mt.entries[a]!.updatedAt ?? 0));
  for (const k of keys.slice(MAX_ENTRIES_PER_MESSAGE)) delete mt.entries[k];
  const metadata = { ...(message.metadata ?? {}), [METADATA_KEY]: mt };
  await spindle.chat.updateMessage(chatId, messageId, { metadata });
  message.metadata = metadata;
  chatCache.get(chatId)?.set(messageId, mt);
  return message;
}

// ---- views ----

const jobs = new Map<string, AbortController>();
const jobKey = (chatId: string, messageId: string) => `${chatId}:${messageId}`;

function viewOf(chatId: string, message: ChatMessage, settings: ChatSettings, overrideRecord?: TranslationRecord | null, position = 0): MessageView {
  const mt = readTranslations(message);
  const record = overrideRecord !== undefined ? overrideRecord : recordFor(mt, message.content);
  return {
    messageId: message.id,
    sourceKey: sourceHash(message.content ?? ''),
    role: message.role,
    text: record && record.parts.some((p) => p.trim()) ? recordToText(record) : null,
    status: record?.status ?? null,
    hasMore: record ? recordHasMore(record) : false,
    progress: record && record.total > 1 ? { done: record.parts.length, total: record.total } : null,
    error: record?.error ?? null,
    hidden: mt?.hidden === true,
    busy: jobs.has(jobKey(chatId, message.id)),
    index: typeof message.index_in_chat === 'number' ? message.index_in_chat : position,
    name: typeof message.name === 'string' ? message.name : '',
  };
}

async function sendChatViews(uid: Uid, chatId: string): Promise<void> {
  const settings = settingsFor(await loadStore(uid), chatId);
  const messages = await getMessages(chatId);
  send({ type: 'views', chatId, views: messages.map((m, i) => viewOf(chatId, m, settings, undefined, i)), replace: true }, uid);
}

async function sendView(uid: Uid, chatId: string, message: ChatMessage, record?: TranslationRecord | null): Promise<void> {
  const settings = settingsFor(await loadStore(uid), chatId);
  send({ type: 'views', chatId, views: [viewOf(chatId, message, settings, record)], replace: false }, uid);
}

// ---- translation ----

function isHidden(m: ChatMessage): boolean {
  return m.extra?.hidden === true;
}

/** Messages before index `end` that can serve as previous context, with their saved translations. */
function contextBefore(messages: ChatMessage[], end: number): ContextMessage[] {
  return messages
    .slice(0, end)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !isHidden(m) && typeof m.content === 'string')
    .map((m) => {
      const entry = readTranslations(m)?.entries[sourceHash(m.content)];
      return { role: m.role as 'user' | 'assistant', content: m.content, translation: entry && entry.parts.length ? recordToText(entry) : null };
    });
}

/** Connection ids only the frontend can see (active profile, chat pin); remembered per user. */
const hints = new Map<string, { activeId?: string; chats: Map<string, string> }>();

function hintFor(uid: Uid, chatId: string): ConnectionHint {
  const h = hints.get(userKey(uid));
  return { activeId: h?.activeId, chatId: h?.chats.get(chatId) };
}

const warnedStale = new Set<string>();

function completer(uid: Uid, chatId: string, chosen: string, signal: AbortSignal) {
  return async (req: TranslationRequest): Promise<Completion> =>
    quietComplete(spindle as never, {
      uid,
      chosen: chosen || undefined,
      hint: hintFor(uid, chatId),
      system: req.system,
      user: req.user,
      signal,
      onStale: (staleId, used) => {
        const key = `${userKey(uid)}:${staleId}`;
        if (warnedStale.has(key)) return;
        warnedStale.add(key);
        spindle.toast.warning(`번역 설정에서 고른 연결이 없어졌습니다. 대신 ${SOURCE_LABELS[used.source]}으로 번역합니다. 번역 설정에서 연결을 다시 골라 주세요.`, { userId: uid });
      },
    });
}

function errorText(e: unknown): string {
  if (e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message))) return '번역을 취소했습니다.';
  return friendlyError(e instanceof Error ? e.message : String(e));
}

async function translateMessage(uid: Uid, chatId: string, messageId: string, mode: 'fresh' | 'continue', options: { force: boolean; automatic: boolean }): Promise<void> {
  const key = jobKey(chatId, messageId);
  if (jobs.has(key)) {
    if (!options.automatic) spindle.toast.info('이 메시지는 이미 번역 중입니다.', { userId: uid });
    return;
  }
  const controller = new AbortController();
  jobs.set(key, controller);
  let message: ChatMessage | undefined;
  try {
    const store = await loadStore(uid);
    const settings = settingsFor(store, chatId);
    const messages = await getMessages(chatId);
    const index = messages.findIndex((m) => m.id === messageId);
    message = messages[index];
    if (!message || !message.content.trim()) return;
    const hash = sourceHash(message.content);
    const existing = readTranslations(message)?.entries[hash];
    if (skipFresh(mode, existing, options.force)) return;
    await sendView(uid, chatId, message);

    const source = message.content;
    const record = await translate(
      {
        direction: 'incoming',
        source,
        settings,
        presets: promptPresets(store.userPresets),
        previous: contextBefore(messages, index),
        resume: mode === 'continue' ? existing : undefined,
      },
      {
        complete: completer(uid, chatId, effectiveConnectionId(store, chatId), controller.signal),
        signal: controller.signal,
        onProgress: async (progress) => {
          const updated = await writeTranslations(chatId, messageId, (mt) => {
            mt.entries[hash] = progress;
            mt.hidden = false;
          });
          if (updated) await sendView(uid, chatId, updated);
        },
      },
    );
    const saved = await writeTranslations(chatId, messageId, (mt) => {
      mt.entries[hash] = record;
      mt.hidden = false;
    });
    if (record.status === 'partial' && !options.automatic) {
      spindle.toast.info('번역이 중간에 끊겼습니다. "이어서 번역"을 누르면 이어서 번역합니다.', { userId: uid });
    }
    if (saved) message = saved;
  } catch (e) {
    const text = errorText(e);
    const partial = e instanceof TranslationError ? e.record : null;
    if (message) {
      const hash = sourceHash(message.content);
      const updated = await writeTranslations(chatId, messageId, (mt) => {
        const prev = mt.entries[hash];
        const base = partial ?? prev ?? { parts: [], pieces: [], total: 1, truncatedPart: -1, status: 'error' as const, updatedAt: 0 };
        mt.entries[hash] = { ...base, status: 'error', error: text, updatedAt: Date.now() };
      }).catch(() => null);
      if (updated) message = updated;
    }
    spindle.toast.error(`번역 실패: ${text}`, { userId: uid });
  } finally {
    jobs.delete(key);
    if (message) await sendView(uid, chatId, message).catch(() => {});
  }
}

async function translateOutgoing(uid: Uid, chatId: string, text: string): Promise<string> {
  const store = await loadStore(uid);
  const settings = { ...settingsFor(store, chatId), autoContinue: true };
  const messages = settings.contextEnabled && settings.contextIncludeUserInput ? await getMessages(chatId) : [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const record = await translate(
      { direction: 'outgoing' as Direction, source: text, settings, presets: promptPresets(store.userPresets), previous: contextBefore(messages, messages.length) },
      { complete: completer(uid, chatId, effectiveConnectionId(store, chatId), controller.signal), signal: controller.signal },
    );
    if (record.status !== 'done') throw new Error('번역이 끝까지 되지 않았습니다.');
    const out = recordToText(record).trim();
    if (!out) throw new Error('번역 결과가 비어 있습니다.');
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// ---- display transform ----

spindle.registerMessageContentProcessor(async (ctx) => {
  if (ctx.origin !== 'render' || !ctx.messageId || !ctx.content) return;
  const chat = await cachedChat(ctx.chatId);
  const mt = chat.get(ctx.messageId);
  if (!mt) return;
  const store = await loadStore(ctx.userId);
  const settings = settingsFor(store, ctx.chatId);
  // The paragraph view has no hide toggle, so a "hidden" flag left over from another mode must not hide it.
  if (isTranslationHidden(mt.hidden, settings.displayMode)) return;
  const record = mt.entries[sourceHash(ctx.content)];
  if (!record || !record.parts.some((p) => p.trim())) return;
  return { content: renderMessage(ctx.content, record, settings, store.view) };
});

// ---- events ----

spindle.on('GENERATION_ENDED', (payload, userId) => {
  if (!payload?.chatId || !payload.messageId || payload.error) return;
  void (async () => {
    const store = await loadStore(userId);
    if (!settingsFor(store, payload.chatId).autoTranslate) return;
    const messages = await getMessages(payload.chatId);
    const message = messages.find((m) => m.id === payload.messageId);
    if (!message || message.role !== 'assistant') return;
    await translateMessage(userId, payload.chatId, payload.messageId!, 'fresh', { force: false, automatic: true });
  })().catch((e) => spindle.log.error(`[translator] auto translate: ${errorText(e)}`));
});

for (const event of ['MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_SENT'] as const) {
  spindle.on(event as never, ((payload: { chatId?: string }) => {
    if (payload?.chatId) chatCache.delete(payload.chatId);
  }) as never);
}

// ---- frontend messages ----

async function handle(msg: ToBackend, uid: Uid): Promise<void> {
  switch (msg.type) {
    case 'hello':
      await sendState(uid);
      return;
    case 'hint': {
      const h = hints.get(userKey(uid)) ?? { chats: new Map<string, string>() };
      h.activeId = typeof msg.activeId === 'string' && msg.activeId ? msg.activeId : undefined;
      if (msg.chatId) {
        if (typeof msg.chatConnectionId === 'string' && msg.chatConnectionId) h.chats.set(msg.chatId, msg.chatConnectionId);
        else h.chats.delete(msg.chatId);
      }
      hints.set(userKey(uid), h);
      return;
    }
    case 'save_connection': {
      // The connection choice is saved the moment it changes: no separate save button.
      const id = typeof msg.connectionId === 'string' ? msg.connectionId.trim() : '';
      const store = await loadStore(uid);
      store.defaults = { ...store.defaults, connectionId: id };
      if (msg.chatId && store.chats[msg.chatId]) store.chats[msg.chatId] = { ...store.chats[msg.chatId]!, connectionId: id };
      await saveStore(uid, store);
      await sendState(uid);
      return;
    }
    case 'chat':
      await sendChatViews(uid, msg.chatId);
      return;
    case 'save_settings': {
      const store = await loadStore(uid);
      const settings = normalizeSettings(msg.settings, store.defaults);
      if (msg.chatId) store.chats[msg.chatId] = settings;
      if (msg.asDefault || !msg.chatId) store.defaults = settings;
      await saveStore(uid, store);
      await sendState(uid);
      // The display mode may have changed: make the chat render again.
      if (msg.chatId) chatCache.delete(msg.chatId);
      return;
    }
    case 'save_preset': {
      const store = await loadStore(uid);
      const id = msg.preset.id.startsWith('custom-') ? msg.preset.id : `custom-${crypto.randomUUID()}`;
      if (BUILTIN_IDS.has(id)) throw new Error('기본 프리셋은 수정할 수 없습니다.');
      if (!msg.preset.name.trim() || !msg.preset.prompt.trim()) throw new Error('프리셋 이름과 프롬프트를 입력해 주세요.');
      const preset = { id, name: msg.preset.name.trim(), prompt: msg.preset.prompt };
      const i = store.userPresets.findIndex((p) => p.id === id);
      if (i >= 0) store.userPresets[i] = preset;
      else store.userPresets.push(preset);
      await saveStore(uid, store);
      await sendState(uid);
      return;
    }
    case 'delete_preset': {
      const store = await loadStore(uid);
      store.userPresets = store.userPresets.filter((p) => p.id !== msg.id);
      // Chats that used it fall back to their own prompt.
      for (const s of [store.defaults, ...Object.values(store.chats)]) {
        if (s.incomingPresetId === msg.id) s.incomingPresetId = INHERIT_PRESET_ID;
        if (s.outgoingPresetId === msg.id) s.outgoingPresetId = INHERIT_PRESET_ID;
      }
      await saveStore(uid, store);
      await sendState(uid);
      return;
    }
    case 'translate':
      await translateMessage(uid, msg.chatId, msg.messageId, 'fresh', { force: msg.force, automatic: false });
      return;
    case 'continue':
      await translateMessage(uid, msg.chatId, msg.messageId, 'continue', { force: true, automatic: false });
      return;
    case 'cancel':
      jobs.get(jobKey(msg.chatId, msg.messageId))?.abort();
      return;
    case 'set_hidden': {
      const updated = await writeTranslations(msg.chatId, msg.messageId, (mt) => {
        mt.hidden = msg.hidden;
      });
      if (updated) await sendView(uid, msg.chatId, updated);
      return;
    }
    case 'delete_translation': {
      jobs.get(jobKey(msg.chatId, msg.messageId))?.abort();
      // Only the translation of the swipe that was showing; the other swipes keep theirs.
      const key = typeof msg.sourceKey === 'string' && msg.sourceKey ? msg.sourceKey : null;
      const updated = await writeTranslations(msg.chatId, msg.messageId, (mt, message) => clearTranslation(mt, key ?? sourceHash(message.content ?? '')));
      if (updated) await sendView(uid, msg.chatId, updated);
      return;
    }
    case 'save_view': {
      const store = await loadStore(uid);
      store.view = normalizeView(msg.view);
      await saveStore(uid, store);
      await sendState(uid);
      return;
    }
    case 'translate_text':
      try {
        send({ type: 'text_result', reqId: msg.reqId, ok: true, text: await translateOutgoing(uid, msg.chatId, msg.text) }, uid);
      } catch (e) {
        const text = e instanceof ExcludeRuleError ? e.message : errorText(e);
        send({ type: 'text_result', reqId: msg.reqId, ok: false, error: text }, uid);
      }
      return;
    case 'notify':
      if (msg.kind === 'info' || msg.kind === 'warning' || msg.kind === 'error') spindle.toast[msg.kind](String(msg.text).slice(0, 500), { userId: uid });
      return;
  }
}

spindle.onFrontendMessage((payload, userId) => {
  if (!payload || typeof payload !== 'object' || typeof (payload as { type?: unknown }).type !== 'string') return;
  handle(payload as ToBackend, userId).catch((e) => {
    spindle.log.error(`[translator] ${(payload as { type: string }).type}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    spindle.toast.error(errorText(e), { userId });
  });
});
