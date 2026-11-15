// Backend worker: settings, translation records in message metadata, automatic translation
// after generation, outgoing message translation, and the display (render) transform.

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import { BUILTIN_IDS, presetSummaries, promptPresets } from './presets';
import { CATCH_UP_TAIL, hostCaps, JOB_TAIL } from './adapter/host';
import { syncSourceFromEdits, type UpstreamRecord } from './adapter/sync-source';
import { createCatchUp } from './vendor/tt-1.8.0/catch-up';
import { buildPub, classifyPeer, handshake, glossaryText, PEER_ID, type PeerState, planGlossary, projectPub } from './adapter/contract';
import { hashText } from './vendor/tt-1.8.0/helpers';
import { cleanEdit, editablePairs, recordFromMap } from './translate/edit';
import { personaSectionFor, LIVE_PROMPT_PRESET_IDS } from './translate/prompt';
import { deleteBundle, saveBundle } from './bundles';
import {
  type ChatSettings,
  VIEW_WINDOW,
  type ConnectionSummary,
  effectiveConnectionId,
  INHERIT_PRESET_ID,
  METADATA_KEY,
  type MessageTranslations,
  type MessageView,
  normalizeSettings,
  normalizeStore,
  newNoteId,
  NOTE_LIMITS,
  normalizeView,
  recordHasMore,
  settingsFor,
  sourceHash,
  rawSourceHash,
  type Store,
  type ToBackend,
  type ToFrontend,
  type TranslationRecord,
} from './shared';
import { effectiveGuides } from './bundles';
import { type ConnectionHint, friendlyError, quietComplete, SOURCE_LABELS } from './connection';
import { renderMessage } from './display/render';
import { clearTranslation, isTranslationHidden, recordFor, recordKeyFor, skipFresh } from './message-ui';
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
  swipes?: string[];
  swipe_id?: number;
  created_at?: number;
  swipe_dates?: number[];
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
  send({ type: 'state', store, presets: presetSummaries(store.userPresets), connections: await connections(uid), link: await peerState() }, uid);
}

// ---- link with the memory extension (LV-TX v1, src/adapter/contract.ts) ----

const SELF_VERSION = '0.4.0';
const PEER_TTL_MS = 20_000;
let peer: { at: number; state: PeerState } = { at: 0, state: 'none' };

/** Whether the memory extension is installed and speaks our contract version. A missing peer is simply "none". */
async function peerState(): Promise<PeerState> {
  if (Date.now() - peer.at < PEER_TTL_MS) return peer.state;
  let state: PeerState = 'none';
  try {
    state = classifyPeer(await spindle.rpcPool.read(`${PEER_ID}.contract`));
  } catch {
    state = 'none';
  }
  peer = { at: Date.now(), state };
  return state;
}

try {
  // Every real host has the pool; the guard only keeps older test doubles quiet.
  spindle.rpcPool?.sync('contract', handshake(SELF_VERSION));
} catch (e) {
  spindle.log.warn(`[translator] contract handshake not published: ${e instanceof Error ? e.message : String(e)}`);
}

let warnedGlossary = false;

/**
 * Publishes the chat's glossary in chat metadata for the memory extension. Needs the peer, the host's
 * conditional metadata update and the `chats` permission; every missing piece just means "not published".
 */
async function publishGlossary(uid: Uid, chatId: string): Promise<void> {
  try {
    if (!hostCaps(spindle).conditionalMetadata || (await peerState()) !== 'ok') return;
    const store = await loadStore(uid);
    const text = glossaryText(effectiveGuides(store, settingsFor(store, chatId)).glossary);
    const chats = spindle.chats as unknown as {
      get(id: string, userId?: string): Promise<{ metadata?: Record<string, unknown> } | null>;
      compareAndSetMetadata(id: string, input: { expected_metadata: Record<string, unknown>; metadata: Record<string, unknown> }): Promise<unknown | null>;
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const chat = await chats.get(chatId, uid);
      if (!chat) return;
      const plan = planGlossary(chat.metadata ?? {}, text, Date.now());
      if (!plan) return;
      if (await chats.compareAndSetMetadata(chatId, plan)) return;
    }
  } catch (e) {
    if (!warnedGlossary) {
      warnedGlossary = true;
      spindle.log.warn(`[translator] glossary not published: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// ---- translation records ----

function readTranslations(message: ChatMessage): MessageTranslations | null {
  const raw = message.metadata?.[METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const mt = raw as MessageTranslations;
  if (!mt.entries || typeof mt.entries !== 'object') return null;
  return mt;
}

/** One shared snapshot per chat; render, controls and saves reuse the same rows. */
interface ChatSnapshot {
  messages: Map<string, ChatMessage>;
  loaded: boolean;
  reading: boolean;
  invalidations: number;
  load?: Promise<ChatSnapshot>;
  // Events arriving during a read must win over the older fetched rows.
  changes: Map<string, ChatMessage | null>;
}
const chatCache = new Map<string, ChatSnapshot>();

function snapshotFor(chatId: string): ChatSnapshot {
  let snapshot = chatCache.get(chatId);
  if (!snapshot) {
    snapshot = { messages: new Map(), loaded: false, reading: false, invalidations: 0, changes: new Map() };
    chatCache.set(chatId, snapshot);
  }
  return snapshot;
}

function cacheMessage(snapshot: ChatSnapshot, message: ChatMessage): void {
  const current = snapshot.messages.get(message.id);
  if (current) Object.assign(current, message);
  else snapshot.messages.set(message.id, message);
  if (snapshot.reading) snapshot.changes.set(message.id, snapshot.messages.get(message.id)!);
}

async function cachedChat(chatId: string, refresh = false): Promise<ChatSnapshot> {
  const snapshot = snapshotFor(chatId);
  if (snapshot.load) return snapshot.load;
  if (snapshot.loaded && !refresh) return snapshot;
  snapshot.changes.clear();
  snapshot.reading = true;
  const invalidations = snapshot.invalidations;
  snapshot.load = (async () => {
    const messages = (await spindle.chat.getMessages(chatId)) as unknown as ChatMessage[];
    const changes = new Map(snapshot.changes);
    const present = new Set(messages.map((message) => message.id));
    for (const id of snapshot.messages.keys()) if (!present.has(id)) snapshot.messages.delete(id);
    for (const message of messages) {
      const changed = changes.get(message.id);
      // The read supplies the host's normalized role (including system rows).
      if (changed) changed.role = message.role;
      if (!changes.has(message.id)) cacheMessage(snapshot, message);
    }
    for (const [id, message] of changes) {
      if (message) cacheMessage(snapshot, message);
      else snapshot.messages.delete(id);
    }
    snapshot.loaded = snapshot.invalidations === invalidations;
    return snapshot;
  })().finally(() => {
    snapshot.load = undefined;
    snapshot.reading = false;
    snapshot.changes.clear();
  });
  return snapshot.load;
}

/**
 * Brings the end of a loaded chat up to date at the start of a translation job. With the host's lean reads
 * this is one `tail` read (whole swipes, not `light`, so the stored rows stay complete); anything else, or a
 * message outside the tail, takes the full refresh.
 */
async function refreshForJob(chatId: string, messageId: string): Promise<ChatSnapshot> {
  const snapshot = snapshotFor(chatId);
  if (!snapshot.loaded || snapshot.load || !hostCaps(spindle).leanMessages) return cachedChat(chatId, true);
  const invalidations = snapshot.invalidations;
  snapshot.changes.clear();
  snapshot.reading = true;
  let rows: ChatMessage[];
  try {
    rows = (await (spindle.chat.getMessages as unknown as (id: string, options: { tail: number }) => Promise<unknown>)(chatId, { tail: JOB_TAIL })) as ChatMessage[];
  } finally {
    snapshot.reading = false;
  }
  const changes = new Map(snapshot.changes);
  snapshot.changes.clear();
  if (snapshot.invalidations !== invalidations || !rows.some((row) => row.id === messageId)) return cachedChat(chatId, true);
  for (const row of rows) {
    const changed = changes.get(row.id);
    if (changed) changed.role = row.role;
    else cacheMessage(snapshot, row);
  }
  for (const [id, message] of changes) if (!message) snapshot.messages.delete(id);
  return snapshot;
}

function orderedMessages(snapshot: ChatSnapshot): ChatMessage[] {
  return [...snapshot.messages.values()].sort((a, b) => (a.index_in_chat ?? 0) - (b.index_in_chat ?? 0));
}

/** Read-modify-write of our key only; other extensions' metadata is kept. */
async function writeTranslations(uid: Uid, chatId: string, messageId: string, change: (mt: MessageTranslations, message: ChatMessage) => void, snapshot?: ChatSnapshot, options: { content?: string } = {}): Promise<ChatMessage | null> {
  snapshot ??= await cachedChat(chatId);
  const message = snapshot.messages.get(messageId);
  if (!message) return null;
  const mt: MessageTranslations = structuredClone(readTranslations(message) ?? { v: 1, entries: {} });
  change(mt, message);
  const keys = Object.keys(mt.entries).sort((a, b) => (mt.entries[b]!.updatedAt ?? 0) - (mt.entries[a]!.updatedAt ?? 0));
  for (const k of keys.slice(MAX_ENTRIES_PER_MESSAGE)) delete mt.entries[k];
  // Public projection for the memory extension, from the content as it will be stored: the visible swipe,
  // not whichever swipe a job started on.
  const contentNow = options.content ?? message.content ?? '';
  projectPub(mt, contentNow, recordKeyFor(mt, contentNow), settingsFor(await loadStore(uid), chatId), (await peerState()) === 'ok', Date.now());
  const metadata = { ...(message.metadata ?? {}), [METADATA_KEY]: mt };
  const previousMetadata = message.metadata;
  // With lean writes only our own key is merged on the host, atomically; otherwise the whole bag is rewritten.
  // One call carries the content and the metadata, so listeners never see one without the other.
  const patch: Record<string, unknown> = hostCaps(spindle).leanMessages ? { ownMetadata: mt } : { metadata };
  if (options.content !== undefined) patch.content = options.content;
  await (spindle.chat.updateMessage as unknown as (id: string, mid: string, patch: Record<string, unknown>) => Promise<void>)(chatId, messageId, patch);
  if (options.content !== undefined) {
    message.content = options.content;
    if (Array.isArray(message.swipes)) message.swipes[message.swipe_id ?? 0] = options.content;
  }
  if (!snapshot.messages.has(messageId)) return null;
  // A newer event may already have updated this row while the write awaited.
  if (message.metadata === previousMetadata) message.metadata = metadata;
  if (snapshot.reading) snapshot.changes.set(messageId, message);
  return message;
}

// ---- views ----

const jobs = new Map<string, { controller: AbortController; finished: Promise<void> }>();
/** Messages whose `pub` is being refreshed after a swipe or edit (our own write must not start another). */
const reprojecting = new Set<string>();
const jobKey = (chatId: string, messageId: string) => `${chatId}:${messageId}`;

function viewOf(chatId: string, message: ChatMessage, settings: ChatSettings, overrideRecord?: TranslationRecord | null, position = 0): MessageView {
  const mt = readTranslations(message);
  const record = overrideRecord !== undefined ? overrideRecord : recordFor(mt, message.content);
  return {
    messageId: message.id,
    sourceKey: recordKeyFor(mt, message.content ?? '') ?? sourceHash(message.content ?? ''),
    role: message.role,
    text: record && record.parts.some((p) => p.trim()) ? recordToText(record, message.content) : null,
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

async function sendChatViews(uid: Uid, chatId: string, messageIds?: string[], replace = true): Promise<void> {
  const settings = settingsFor(await loadStore(uid), chatId);
  const snapshot = await cachedChat(chatId);
  const ids = messageIds
    ? [...new Set(messageIds.filter((id) => typeof id === 'string'))].slice(0, VIEW_WINDOW)
    : orderedMessages(snapshot).slice(-VIEW_WINDOW).map((message) => message.id);
  const views = ids.flatMap((id) => {
    const message = snapshot.messages.get(id);
    if (!message || (!readTranslations(message) && !jobs.has(jobKey(chatId, id)))) return [];
    return [viewOf(chatId, message, settings)];
  });
  // Include the requested ids so the frontend can clear deleted/edited state
  // without sending empty per-message views for untranslated messages.
  const plainIds = ids.filter((id) => {
    const message = snapshot.messages.get(id);
    return message && message.role !== 'system' && !readTranslations(message) && !jobs.has(jobKey(chatId, id));
  });
  send({ type: 'views', chatId, views, replace, requestedIds: ids, plainIds }, uid);
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
      const entry = recordFor(readTranslations(m), m.content);
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

interface TranslationOptions {
  force: boolean;
  automatic: boolean;
  generatedContent?: string;
  generationId?: string;
  generationType?: string;
}

function warnAutomatic(reason: string, context: Record<string, unknown>): void {
  spindle.log.warn(`[translator] auto translate: ${reason} ${JSON.stringify(context)}`);
}

async function translateMessage(uid: Uid, chatId: string, messageId: string, mode: 'fresh' | 'continue', options: TranslationOptions): Promise<void> {
  const key = jobKey(chatId, messageId);
  const context = { chatId, messageId, generationId: options.generationId, generationType: options.generationType };
  const warn = (reason: string, details: Record<string, unknown> = {}) => {
    if (options.automatic) warnAutomatic(reason, { ...context, ...details });
  };
  // A new generation can finish on the same message while its old swipe is
  // translating. Serialize metadata writes, but do not discard the new event.
  while (jobs.has(key)) {
    if (!options.automatic) {
      spindle.toast.info('이 메시지는 이미 번역 중입니다.', { userId: uid });
      return;
    }
    warn('in-flight: waiting for the current translation');
    await jobs.get(key)!.finished;
  }
  const controller = new AbortController();
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  jobs.set(key, { controller, finished });
  let message: ChatMessage | undefined;
  let source: string | undefined;
  let snapshot: ChatSnapshot | undefined;
  try {
    const store = await loadStore(uid);
    const settings = settingsFor(store, chatId);
    if (options.automatic && !settings.autoTranslate) return;
    // Generation may persist a new swipe without a preceding message event.
    // Refresh once at job entry, then all saves use this event-updated snapshot.
    snapshot = await refreshForJob(chatId, messageId);
    const messages = orderedMessages(snapshot);
    const index = messages.findIndex((m) => m.id === messageId);
    message = messages[index];
    if (!message) {
      warn('message-not-found');
      return;
    }
    if (options.automatic && message.role !== 'assistant') {
      warn('unexpected-role', { role: message.role });
      return;
    }
    // GENERATION_ENDED.content is the generated swipe, whereas getMessages()
    // returns the currently displayed swipe. Navigation can make them differ;
    // LV-Illust can also replace markup on that same swipe before this read.
    source = options.generatedContent ?? message.content;
    if (sourceHash(source) !== sourceHash(message.content) && !message.swipes?.some((swipe) => sourceHash(swipe) === sourceHash(source!))) {
      warn('generated-content-not-found', { sourceKey: sourceHash(source) });
      source = undefined;
      return;
    }
    if (!source.trim()) {
      warn('empty-content');
      return;
    }
    const hash = sourceHash(source);
    const existingKey = recordKeyFor(readTranslations(message), source);
    const existing = existingKey ? readTranslations(message)?.entries[existingKey] : undefined;
    if (skipFresh(mode, existing, options.force)) {
      warn('already-translated', { sourceKey: hash, status: existing?.status });
      return;
    }
    await sendView(uid, chatId, message);

    let lastProgressSave = -Infinity;
    const record = await translate(
      {
        direction: 'incoming',
        source,
        settings,
        store,
        presets: promptPresets(store.userPresets),
        previous: contextBefore(messages, index),
        resume: mode === 'continue' ? existing : undefined,
        persona: await personaFor(settings, store, messages, index),
      },
      {
        complete: completer(uid, chatId, effectiveConnectionId(store, chatId), controller.signal),
        signal: controller.signal,
        onProgress: async (progress) => {
          if (Date.now() - lastProgressSave < 1_000) return;
          lastProgressSave = Date.now();
          const updated = await writeTranslations(uid, chatId, messageId, (mt) => {
            if (existingKey) delete mt.entries[existingKey];
            delete mt.entries[rawSourceHash(source!)];
            mt.entries[hash] = progress;
            mt.hidden = false;
          }, snapshot);
          if (!updated) throw new Error('Message disappeared while saving translation progress');
          await sendView(uid, chatId, updated);
        },
      },
    );
    const saved = await writeTranslations(uid, chatId, messageId, (mt) => {
      if (existingKey) delete mt.entries[existingKey];
      delete mt.entries[rawSourceHash(source!)];
      mt.entries[hash] = record;
      mt.hidden = false;
    }, snapshot);
    if (!saved) throw new Error('Message disappeared while saving translation');
    if (record.status === 'partial') {
      warn('partial-translation', { sourceKey: hash });
      if (!options.automatic) spindle.toast.info('번역이 중간에 끊겼습니다. "이어서 번역"을 누르면 이어서 번역합니다.', { userId: uid });
    }
    if (saved) message = saved;
  } catch (e) {
    const text = errorText(e);
    warn('translation-failed', { error: text });
    const partial = e instanceof TranslationError ? e.record : null;
    if (message && source !== undefined) {
      const hash = sourceHash(source);
      const updated = await writeTranslations(uid, chatId, messageId, (mt) => {
        const prev = mt.entries[hash];
        const base = partial ?? prev ?? { parts: [], pieces: [], total: 1, truncatedPart: -1, status: 'error' as const, updatedAt: 0 };
        mt.entries[hash] = { ...base, status: 'error', error: text, updatedAt: Date.now() };
      }, snapshot).catch(() => null);
      if (updated) message = updated;
    }
    spindle.toast.error(`번역 실패: ${text}`, { userId: uid });
  } finally {
    try {
      // Finish the old job's view before a queued job begins publishing its own.
      // The view should show busy=false once this job is done.
      jobs.delete(key);
      message = snapshot?.messages.get(messageId);
      if (message) await sendView(uid, chatId, message).catch((e) => warn('view-update-failed', { error: errorText(e) }));
    } finally {
      finish();
    }
  }
}

async function translateOutgoing(uid: Uid, chatId: string, text: string): Promise<string> {
  const store = await loadStore(uid);
  const settings = { ...settingsFor(store, chatId), autoContinue: true };
  const messages = settings.contextEnabled && settings.contextIncludeUserInput ? orderedMessages(await cachedChat(chatId)) : [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const record = await translate(
      { direction: 'outgoing' as Direction, source: text, settings, store, presets: promptPresets(store.userPresets), previous: contextBefore(messages, messages.length) },
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

/**
 * The "# User Persona" section (live presets only). Upstream reads the chat's persona; without the
 * personas permission the name comes from the nearest earlier user message, which carries the persona's name.
 */
async function personaFor(settings: ChatSettings, store: Store, messages: ChatMessage[], index: number): Promise<string> {
  if (!LIVE_PROMPT_PRESET_IDS.has(settings.incomingPresetId)) return '';
  const named = (m: ChatMessage) => m.role === 'user' && typeof m.name === 'string' && m.name.trim() !== '';
  const user = messages.slice(0, Math.max(index, 0)).findLast(named) ?? messages.findLast(named);
  if (!user) return '';
  return personaSectionFor(settings, promptPresets(store.userPresets), user.name!.trim());
}

// ---- 번역 고치기 (hand correction, optionally rewriting the English source) ----

async function openEdit(uid: Uid, chatId: string, messageId: string): Promise<void> {
  const fail = (error: string) => send({ type: 'edit_data', chatId, messageId, ok: false, error }, uid);
  const snapshot = await cachedChat(chatId);
  const message = snapshot.messages.get(messageId);
  const mt = message ? readTranslations(message) : null;
  const key = message ? recordKeyFor(mt, message.content ?? '') : null;
  const record = key ? mt?.entries[key] : undefined;
  if (!message || !record) return fail('이 메시지에는 고칠 번역이 없습니다.');
  if (jobs.has(jobKey(chatId, messageId))) return fail('번역 중인 메시지는 고칠 수 없습니다.');
  const pairs = editablePairs(message.content, record, settingsFor(await loadStore(uid), chatId));
  if (!pairs) return fail('문단 단위로 끝까지 번역된 메시지만 고칠 수 있습니다. 문단 단위로 다시 번역해 주세요.');
  send({ type: 'edit_data', chatId, messageId, ok: true, sourceKey: key!, pairs: pairs.map((p) => ({ source: p.source, translation: p.translation, edited: p.edited })) }, uid);
}

async function saveEdit(uid: Uid, msg: Extract<ToBackend, { type: 'edit_save' }>): Promise<void> {
  const { chatId, messageId } = msg;
  const result = (r: { ok: boolean; error?: string; rewritten?: number; saved?: boolean }) => send({ type: 'edit_result', chatId, messageId, ...r }, uid);
  const key = jobKey(chatId, messageId);
  if (jobs.has(key)) return result({ ok: false, error: '번역 중인 메시지는 고칠 수 없습니다.' });
  const controller = new AbortController();
  let finish!: () => void;
  jobs.set(key, { controller, finished: new Promise<void>((resolve) => { finish = resolve; }) });
  let message: ChatMessage | undefined;
  try {
    const store = await loadStore(uid);
    const settings = settingsFor(store, chatId);
    const snapshot = await cachedChat(chatId);
    message = snapshot.messages.get(messageId);
    const mt = message ? readTranslations(message) : null;
    const oldKey = message ? recordKeyFor(mt, message.content ?? '') : null;
    const record = oldKey ? mt?.entries[oldKey] : undefined;
    if (!message || !record || oldKey !== msg.sourceKey) return result({ ok: false, error: '그 사이 메시지가 바뀌었습니다. 창을 닫고 다시 열어 주세요.' });
    const original = message.content;
    const pairs = editablePairs(original, record, settings);
    if (!pairs) return result({ ok: false, error: '문단 단위로 끝까지 번역된 메시지만 고칠 수 있습니다.' });

    const oldTranslations: Record<string, string> = {};
    for (const pair of pairs) oldTranslations[pair.key] = pair.translation;
    const edits: Record<string, string> = {};
    for (const { index, text } of Array.isArray(msg.edits) ? msg.edits : []) {
      const pair = Number.isInteger(index) ? pairs[index] : undefined;
      const corrected = cleanEdit(typeof text === 'string' ? text : '');
      if (pair && corrected && corrected !== pair.translation.trim()) edits[pair.key] = corrected;
    }
    if (!Object.keys(edits).length) return result({ ok: true, rewritten: 0, saved: false });

    // Upstream's order: the corrections go into the record first, then the English is rewritten against it.
    const edited: Record<string, number> = {};
    for (const pair of pairs) if (pair.edited) edited[pair.key] = 1;
    for (const k of Object.keys(edits)) edited[k] = 1;
    let state: UpstreamRecord = { v: 1, map: { ...oldTranslations, ...edits }, edited, view: '', at: Date.now() };
    let newContent: string | undefined;
    let rewritten = 0;
    let sourceError = '';
    if (msg.syncSource) {
      try {
        const complete = completer(uid, chatId, effectiveConnectionId(store, chatId), controller.signal);
        const synced = await syncSourceFromEdits({
          content: original,
          record: state,
          edits,
          oldTranslations,
          llm: async (system, user) => (await complete({ system, user, hasContext: false })).text,
        });
        if (synced.count && synced.content !== null) {
          newContent = synced.content;
          state = synced.record;
          rewritten = synced.count;
        }
      } catch (e) {
        // Upstream: "번역은 저장했지만 영어 원문은 고치지 못했습니다".
        sourceError = errorText(e);
      }
    }
    const content = newContent ?? original;
    const next = recordFromMap(content, state.map, Object.keys(state.edited));
    if (next.status !== 'done') return result({ ok: false, error: '문단 구조 때문에 이 번역을 저장할 수 없습니다. 아무것도 바꾸지 않았습니다.' });
    if (snapshot.messages.get(messageId)?.content !== original) return result({ ok: false, error: '그 사이 메시지 내용이 바뀌어 저장하지 않았습니다.' });
    const saved = await writeTranslations(uid, chatId, messageId, (draft) => {
      delete draft.entries[oldKey!];
      delete draft.entries[rawSourceHash(original)];
      draft.entries[sourceHash(content)] = next;
      draft.hidden = false;
    }, snapshot, newContent === undefined ? {} : { content: newContent });
    if (!saved) return result({ ok: false, error: '저장하는 사이 메시지가 사라졌습니다.' });
    message = saved;
    result({ ok: true, rewritten, saved: true, ...(sourceError ? { error: `번역은 저장했지만 영어 원문은 고치지 못했습니다: ${sourceError}` } : {}) });
  } catch (e) {
    result({ ok: false, error: errorText(e) });
  } finally {
    jobs.delete(key);
    message = chatCache.get(chatId)?.messages.get(messageId) ?? message;
    if (message) await sendView(uid, chatId, message).catch(() => {});
    finish();
  }
}

// ---- 놓친 최신 답변 자동 번역 (Translation Tools 1.7.2, vendored catch-up) ----

/** Chats with a generation running, and the partial replies the user stopped (never auto-translated later). */
const generationActive = new Map<string, true>();
const stoppedReplies = new Map<string, Set<string>>();
const catchUps = new Map<string, ReturnType<typeof createCatchUp>>();

function catchUpFor(uid: Uid) {
  const k = userKey(uid);
  let instance = catchUps.get(k);
  if (instance) return instance;
  const rows = new Map<string, ChatMessage>();
  const seconds = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? (value > 1e12 ? value / 1000 : value) : 0);
  instance = createCatchUp({
    PT_KEY: 'paraTranslate',
    getChat: async (chatId: string) => ({ metadata: { autoTranslate: settingsFor(await loadStore(uid), chatId).autoTranslate === true } }),
    handlesRow: () => true,
    api: async () => ({ active: false }),
    // Never a whole-chat read for this: an already loaded snapshot, else the end of the chat, else one first load.
    listMessages: async (chatId: string, n: number) => {
      const snapshot = snapshotFor(chatId);
      let list: ChatMessage[];
      if (snapshot.loaded) list = orderedMessages(snapshot).slice(-n);
      else if (hostCaps(spindle).leanMessages) list = (await (spindle.chat.getMessages as unknown as (id: string, options: { tail: number; light: boolean }) => Promise<unknown>)(chatId, { tail: n, light: true })) as ChatMessage[];
      else list = orderedMessages(await cachedChat(chatId)).slice(-n);
      rows.clear();
      for (const m of list) rows.set(m.id, m);
      return list.map((m) => {
        const stamp = Math.max(seconds(m.created_at), seconds(m.swipe_dates?.[m.swipe_id ?? 0]));
        return { id: m.id, role: m.role, content: typeof m.content === 'string' ? m.content : '', createdAt: stamp ? new Date(stamp * 1000).toISOString() : '', extra: { hiddenFromUser: m.extra?.hidden === true } };
      });
    },
    rememberMessage: () => {},
    getRecord: (id: string) => {
      const m = rows.get(id);
      return m && readTranslations(m) && Object.keys(readTranslations(m)!.entries).length ? true : null;
    },
    hashText,
    translateMessage: async (chatId: string, id: string) => {
      const content = rows.get(id)?.content ?? '';
      if (stoppedReplies.get(chatId)?.has(hashText(content))) return;
      await translateMessage(uid, chatId, id, 'fresh', { force: false, automatic: true });
    },
    generationActive,
    marinara: { log: { warn: (text: string, error?: unknown) => spindle.log.warn(`[translator] ${text} ${error instanceof Error ? error.message : ''}`.trim()) } },
  });
  catchUps.set(k, instance);
  return instance;
}


/** Brings `pub` in line with the message's current content after a swipe or an edit, when that changes anything. */
async function refreshPub(uid: Uid, chatId: string, id: string, snapshot: ChatSnapshot): Promise<void> {
  const key = jobKey(chatId, id);
  const row = snapshot.messages.get(id);
  const mt = row ? readTranslations(row) : null;
  if (!row || !mt || jobs.has(key) || reprojecting.has(key)) return;
  const stale = mt.pub !== undefined && mt.pub.h !== hashText(row.content ?? '');
  if (!stale && (mt.pub !== undefined || !Object.keys(mt.entries).length)) return;
  reprojecting.add(key);
  try {
    if (!stale) {
      // No pub yet: only worth a write when one can be built, or the same event would repeat forever.
      const content = row.content ?? '';
      const wanted = (await peerState()) === 'ok' && buildPub(content, recordFor(mt, content) ?? undefined, settingsFor(await loadStore(uid), chatId), 0) !== null;
      if (!wanted) return;
    }
    await writeTranslations(uid, chatId, id, () => {}, snapshot);
  } catch (e) {
    spindle.log.warn(`[translator] pub refresh failed: ${errorText(e)}`);
  } finally {
    reprojecting.delete(key);
  }
}

// ---- display transform ----

spindle.registerMessageContentProcessor(async (ctx) => {
  if (ctx.origin !== 'render' || !ctx.messageId || !ctx.content) return;
  const chat = await cachedChat(ctx.chatId);
  const message = chat.messages.get(ctx.messageId);
  const mt = message ? readTranslations(message) : null;
  if (!mt) return;
  const store = await loadStore(ctx.userId);
  const settings = settingsFor(store, ctx.chatId);
  // The paragraph view has no hide toggle, so a "hidden" flag left over from another mode must not hide it.
  if (isTranslationHidden(mt.hidden, settings.displayMode)) return;
  const record = recordFor(mt, ctx.content);
  if (!record || !record.parts.some((p) => p.trim())) return;
  return { content: renderMessage(ctx.content, record, settings, store.view) };
});

// ---- events ----

spindle.on('GENERATION_STARTED' as never, ((payload: { chatId?: string }) => {
  if (payload?.chatId) generationActive.set(payload.chatId, true);
}) as never);

spindle.on('GENERATION_STOPPED' as never, ((payload: { chatId?: string; content?: string }) => {
  if (!payload?.chatId) return;
  generationActive.delete(payload.chatId);
  if (typeof payload.content === 'string' && payload.content.trim()) {
    const set = stoppedReplies.get(payload.chatId) ?? new Set<string>();
    set.add(hashText(payload.content));
    stoppedReplies.set(payload.chatId, set);
  }
}) as never);

spindle.on('GENERATION_ENDED', (payload, userId) => {
  if (payload?.chatId) generationActive.delete(payload.chatId);
  const context = { chatId: payload?.chatId, messageId: payload?.messageId, generationId: payload?.generationId, generationType: payload?.generationType };
  // Impersonation produces user text (or an unsaved draft), not an AI reply.
  if (payload?.generationType === 'impersonate') return;
  if (payload?.error) {
    warnAutomatic('generation-error', { ...context, error: payload.error });
    return;
  }
  if (!payload?.chatId || !payload.messageId) {
    warnAutomatic(!payload?.chatId ? 'missing-chat-id' : 'missing-message-id', context);
    return;
  }
  void translateMessage(userId, payload.chatId, payload.messageId, 'fresh', {
    force: false,
    automatic: true,
    generatedContent: payload.content,
    generationId: payload.generationId,
    generationType: payload.generationType,
  }).catch((e) => warnAutomatic('handler-failed', { ...context, error: errorText(e) }));
});

for (const event of ['MESSAGE_EDITED', 'MESSAGE_SWIPED', 'SWIPE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SENT'] as const) {
  spindle.on(event as never, ((payload: { chatId?: string; messageId?: string; message?: ChatMessage & { is_user?: boolean } }, userId?: string) => {
    if (!payload?.chatId) return;
    const snapshot = chatCache.get(payload.chatId);
    if (!snapshot) return;
    const id = payload.messageId ?? payload.message?.id;
    if (event === 'MESSAGE_DELETED' && id) {
      snapshot.messages.delete(id);
      if (snapshot.reading) snapshot.changes.set(id, null);
      jobs.get(jobKey(payload.chatId, id))?.controller.abort();
    } else if (payload.message && id) {
      // Event DTOs carry metadata inside extra; getMessages normalizes it.
      const raw = payload.message;
      if (!raw.role && raw.is_user !== true && !snapshot.messages.has(id)) {
        // A new non-user wire DTO does not expose the normalized system role.
        // Refresh on demand rather than guessing its toolbar/context behavior.
        snapshot.loaded = false;
        snapshot.invalidations++;
      }
      const { spindle_metadata, ...extra } = raw.extra ?? {};
      cacheMessage(snapshot, {
        ...raw,
        role: raw.role ?? snapshot.messages.get(id)?.role ?? (raw.is_user ? 'user' : 'assistant'),
        extra,
        metadata: raw.metadata ?? (spindle_metadata as Record<string, unknown> | undefined),
      });
      // A swipe change or an edit can leave `pub` describing other content (replace or drop it), or reveal a
      // translation that has none yet. Our own write ends the chain: its `pub.h` already matches the content.
      void refreshPub(userId, payload.chatId, id, snapshot);
    } else {
      // Older hosts may send only a chat id. The next consumer refreshes once.
      snapshot.loaded = false;
      snapshot.invalidations++;
    }
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
      if (msg.open && msg.chatId) {
        catchUpFor(uid).catchUpLatest(msg.chatId);
        void publishGlossary(uid, msg.chatId);
      }
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
      await sendChatViews(uid, msg.chatId, msg.messageIds);
      return;
    case 'view_messages':
      await sendChatViews(uid, msg.chatId, msg.messageIds, false);
      return;
    case 'save_settings': {
      const store = await loadStore(uid);
      const settings = normalizeSettings(msg.settings, store.defaults, store.userBundles);
      if (msg.chatId) store.chats[msg.chatId] = settings;
      if (msg.asDefault || !msg.chatId) store.defaults = settings;
      await saveStore(uid, store);
      await sendState(uid);
      if (msg.chatId) void publishGlossary(uid, msg.chatId);
      // The frontend invalidates display settings; message data is unchanged.
      return;
    }
    case 'save_note': {
      const store = await loadStore(uid);
      const name = String(msg.note?.name ?? '').trim();
      const text = String(msg.note?.text ?? '').trim();
      const fail = (error: string) => send({ type: 'note_result', ok: false, error }, uid);
      if (!name) return fail('저장할 이름을 입력해 주세요.');
      if (name.length > NOTE_LIMITS.name) return fail(`이름은 ${NOTE_LIMITS.name}자까지 쓸 수 있습니다.`);
      if (!text) return fail('저장할 기타 지침이 비어 있습니다.');
      if (text.length > NOTE_LIMITS.text) return fail(`저장한 기타 지침은 ${NOTE_LIMITS.text.toLocaleString('en-US')}자까지입니다. 지금 ${text.length.toLocaleString('en-US')}자입니다. 내용은 잘라내지 않았습니다.`);
      const existing = store.notes.find((n) => n.name === name);
      if (existing && !msg.overwrite) {
        send({ type: 'note_result', ok: false, needsOverwrite: name }, uid);
        return;
      }
      if (!existing && store.notes.length >= NOTE_LIMITS.count) return fail(`저장한 기타 지침은 ${NOTE_LIMITS.count}개까지입니다. 안 쓰는 것을 지워 주세요.`);
      if (existing) existing.text = text;
      else store.notes.push({ id: newNoteId(), name, text });
      await saveStore(uid, store);
      await sendState(uid);
      send({ type: 'note_result', ok: true }, uid);
      return;
    }
    case 'delete_note': {
      // Chats that already loaded it keep their copy.
      const store = await loadStore(uid);
      store.notes = store.notes.filter((n) => n.id !== msg.id);
      await saveStore(uid, store);
      await sendState(uid);
      return;
    }
    case 'edit_open':
      await openEdit(uid, msg.chatId, msg.messageId);
      return;
    case 'edit_save':
      await saveEdit(uid, msg);
      return;
    case 'save_bundle': {
      const store = await loadStore(uid);
      saveBundle(store, msg.bundle);
      await saveStore(uid, store);
      await sendState(uid);
      return;
    }
    case 'delete_bundle': {
      const store = await loadStore(uid);
      deleteBundle(store, msg.id);
      await saveStore(uid, store);
      await sendState(uid);
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
      jobs.get(jobKey(msg.chatId, msg.messageId))?.controller.abort();
      return;
    case 'set_hidden': {
      const updated = await writeTranslations(uid, msg.chatId, msg.messageId, (mt) => {
        mt.hidden = msg.hidden;
      });
      if (updated) await sendView(uid, msg.chatId, updated);
      return;
    }
    case 'delete_translation': {
      const job = jobs.get(jobKey(msg.chatId, msg.messageId));
      job?.controller.abort();
      await job?.finished;
      // Only the translation of the swipe that was showing; the other swipes keep theirs.
      const key = typeof msg.sourceKey === 'string' && msg.sourceKey ? msg.sourceKey : null;
      const updated = await writeTranslations(uid, msg.chatId, msg.messageId, (mt, message) => clearTranslation(mt, key ?? recordKeyFor(mt, message.content ?? '') ?? sourceHash(message.content ?? '')));
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
