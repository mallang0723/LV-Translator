// Backend worker: settings, the host stand-in for the original Translation Tools 1.10.0 (src/host-emu), the memory
// extension's side of the record (LV-TX v1) and the one-time reading of 0.4.0 translations.

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;

import { hostCaps } from './adapter/host';
import { appliedMark, deleteMark, deleteSeen, reconcileTt, repairedKeys, shiftAfterDelete } from './adapter/swipe-repair';
import { classifyPeer, glossaryText, handshake, PEER_ID, type PeerState, planGlossary, PROVIDES } from './adapter/contract';
import { buildPubFromTt, keptTagNames } from './adapter/pub';
import { applyRebases, deleteBundle, reapplyBundleVoice, saveBundle, type VoiceRebase } from './bundles';
import { type ConnectionHint, friendlyError, resolveConnection } from './connection';
import { createEmuBridge, type EmuHost, eventMsg, eventRow, resolveSpeakers, TT_KEY, WideReads } from './host-emu/backend-ops';
import { planGlossaryMigration, planScopeMigration } from './adapter/migrate';
import {
  type ConnectionSummary,
  effectiveConnectionId,
  METADATA_KEY,
  normalizeSettings,
  normalizeStore,
  settingsFor,
  type Store,
  type ToBackend,
  type ToFrontend,
} from './shared';

const STORE_PATH = 'translator.json';
const TT_CONFIG_PATH = 'tt-config.json';

type Uid = string | undefined;
const userKey = (uid: Uid) => uid ?? '';

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
  send({ type: 'state', store, connections: await connections(uid), link: await peerState() }, uid);
}

function errorText(e: unknown): string {
  if (e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message))) return '번역을 취소했습니다.';
  return friendlyError(e instanceof Error ? e.message : String(e));
}

// ---- the original's own settings file (its chat scopes, glossary, kept tags) ----

interface TtScope {
  glossary?: string;
  incomingVoicePrompt?: string;
  incomingVoiceEnabled?: boolean;
}
interface TtConfig {
  config?: { defaults?: TtScope; chats?: Record<string, TtScope>; paragraph?: { keepTags?: string } };
}

/** Room 대사 지침 values changed by a bundle edit that an open original form may still hold the old text of (per user, `applyRebases`). */
const voiceRebases = new Map<string, VoiceRebase[]>();

const configCache = new Map<string, { at: number; value: TtConfig }>();

async function readTtConfig(uid: Uid, fresh = false): Promise<TtConfig> {
  const cached = configCache.get(userKey(uid));
  if (!fresh && cached && Date.now() - cached.at < 3_000) return cached.value;
  const value = ((await spindle.userStorage.getJson<unknown>(TT_CONFIG_PATH, { fallback: null, userId: uid })) ?? {}) as TtConfig;
  configCache.set(userKey(uid), { at: Date.now(), value });
  return value;
}

// ---- link with the memory extension (LV-TX v1, src/adapter/contract.ts) ----

const SELF_VERSION = '0.5.11';
const PEER_TTL_MS = 20_000;
let peer: { at: number; state: PeerState } = { at: 0, state: 'none' };
let warnedPeerDenied = false;

/** Whether the memory extension is installed and speaks our contract version. A missing peer is simply "none". */
async function peerState(): Promise<PeerState> {
  if (Date.now() - peer.at < PEER_TTL_MS) return peer.state;
  let state: PeerState = 'none';
  try {
    state = classifyPeer(await spindle.rpcPool.read(`${PEER_ID}.contract`));
  } catch (e) {
    state = 'none';
    // A missing endpoint is the normal "not installed"; a permission refusal deserves one line in the log.
    const text = e instanceof Error ? e.message : String(e);
    if (/requires/i.test(text) && !warnedPeerDenied) {
      warnedPeerDenied = true;
      spindle.log.warn(`[translator] memory extension link refused by the host: ${text}`);
    }
  }
  peer = { at: Date.now(), state };
  return state;
}

try {
  // Every real host has the pool; the guard only keeps older test doubles quiet.
  // `requires: []`: any extension may read it. Without a policy the host demands that the reader holds every
  // permission this extension has (shared-rpc-pool.service.ts assertRequesterCanReadEndpoint).
  // 0.5.1: provided again, now from the original's records (`pub`) and the original's chat glossary.
  spindle.rpcPool?.sync('contract', handshake(SELF_VERSION, PROVIDES), { requires: [] });
} catch (e) {
  spindle.log.warn(`[translator] contract handshake not published: ${e instanceof Error ? e.message : String(e)}`);
}

/**
 * 0.5.2, once: the glossaries 0.4.0 kept (per chat and the default, with the bundle's words merged as 0.4.0 published them) become the
 * original's own, in `tt-config.json`, before the original first reads that file. translator.json is left as it was. Done before the
 * original loads because its next save would otherwise overwrite what is added here; never replaces a glossary the original already has.
 */
async function migrateGlossary(uid: Uid): Promise<void> {
  try {
    const file = await readTtConfig(uid, true);
    const store = await loadStore(uid);
    const at = new Date().toISOString();
    // The glossary (0.5.2) and then the other settings with a counterpart in the original (0.5.3, its own marker): both once.
    let next = planGlossaryMigration(file as Record<string, unknown>, store, at);
    const rest = planScopeMigration(next ?? (file as Record<string, unknown>), store, at);
    if (rest) next = rest;
    if (!next) return;
    await spindle.userStorage.setJson(TT_CONFIG_PATH, next, { indent: 2, userId: uid });
    configCache.set(userKey(uid), { at: Date.now(), value: next as TtConfig });
  } catch (e) {
    spindle.log.warn(`[translator] 0.4.0 glossary not carried over (will retry): ${e instanceof Error ? e.message : String(e)}`);
  }
}

let warnedGlossary = false;
const lastChat = new Map<string, string>();

/** The original's glossary for this chat (its own chat scope, else its defaults), as the original reads it. */
async function chatGlossary(uid: Uid, chatId: string): Promise<string> {
  const cfg = (await readTtConfig(uid, true)).config;
  const scope = cfg?.chats?.[chatId] ?? cfg?.defaults;
  return typeof scope?.glossary === 'string' ? scope.glossary : '';
}

/**
 * Publishes the chat's glossary in chat metadata for the memory extension. Needs the peer, the host's
 * conditional metadata update and the `chats` permission; every missing piece just means "not published".
 */
async function publishGlossary(uid: Uid, chatId: string): Promise<void> {
  try {
    if (!hostCaps(spindle).conditionalMetadata || (await peerState()) !== 'ok') return;
    const text = glossaryText(await chatGlossary(uid, chatId));
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

// ---- connection hints, generation state ----

/** Connection ids only the frontend can see (active profile, chat pin); remembered per user. */
const hints = new Map<string, { activeId?: string; chats: Map<string, string> }>();

function hintFor(uid: Uid, chatId: string): ConnectionHint {
  const h = hints.get(userKey(uid));
  return { activeId: h?.activeId, chatId: h?.chats.get(chatId) };
}

/** Chats with a generation running: the original asks (`/generate/status`) before it translates a missed reply. */
const generationActive = new Map<string, true>();

spindle.on('GENERATION_STARTED' as never, ((payload: { chatId?: string }) => {
  if (payload?.chatId) generationActive.set(payload.chatId, true);
}) as never);
spindle.on('GENERATION_STOPPED' as never, ((payload: { chatId?: string }) => {
  if (payload?.chatId) generationActive.delete(payload.chatId);
}) as never);
spindle.on('GENERATION_ENDED' as never, ((payload: { chatId?: string }) => {
  if (payload?.chatId) generationActive.delete(payload.chatId);
}) as never);

// ---- `pub` follows the visible swipe (swipe, edit) ----

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

async function projectionFor(uid: Uid, chatId: string) {
  const store = await loadStore(uid);
  const cfg = (await readTtConfig(uid)).config;
  return { publish: (await peerState()) === 'ok', language: settingsFor(store, chatId).myLanguage, kept: keptTagNames(cfg?.paragraph?.keepTags) };
}

/** Brings `pub` in line with the message's current content after a swipe or an edit, when that changes anything. */
async function refreshPub(uid: Uid, chatId: string, raw: { id?: string; content?: string; swipe_id?: number; metadata?: Record<string, unknown>; extra?: Record<string, unknown> }): Promise<void> {
  if (!raw.id || typeof raw.content !== 'string') return;
  const meta = raw.metadata ?? (isObject(raw.extra?.spindle_metadata) ? (raw.extra!.spindle_metadata as Record<string, unknown>) : undefined);
  const st = isObject(meta?.[METADATA_KEY]) ? (meta![METADATA_KEY] as Record<string, unknown>) : null;
  const tt = isObject(meta?.[TT_KEY]) ? (meta![TT_KEY] as Record<string, unknown>) : null;
  if (!st?.pub && !tt) return;
  const proj = await projectionFor(uid, chatId);
  const swipe = Number.isInteger(raw.swipe_id) ? (raw.swipe_id as number) : 0;
  const want = proj.publish ? buildPubFromTt(raw.content, tt?.[String(swipe)], proj.language, proj.kept, Date.now()) : null;
  const have = isObject(st?.pub) ? (st!.pub as { h?: string }) : null;
  if (!want && !have) return;
  if (want && have?.h === want.h) return;
  const merged = { v: 1, entries: {}, ...(st ?? {}) } as Record<string, unknown>;
  if (want) merged.pub = want;
  else delete merged.pub;
  const patch = hostCaps(spindle).metadataPatch ? { metadata_patch: { [METADATA_KEY]: merged } } : { metadata: { ...(meta ?? {}), [METADATA_KEY]: merged } };
  await (spindle.chat.updateMessage as unknown as (id: string, mid: string, patch: Record<string, unknown>) => Promise<void>)(chatId, raw.id, patch);
}

/**
 * A swipe was deleted: its translation record goes and the higher ones move down (src/adapter/swipe-repair.ts), in one metadata write.
 * An event delivered twice (or late) must not shift again: the deletes already applied are kept in our own metadata key.
 */
async function realignAfterDelete(uid: Uid, chatId: string, raw: Record<string, any>, deleted: unknown): Promise<void> {
  if (!raw.id || !Number.isInteger(deleted) || !Array.isArray(raw.swipes) || raw.swipes.some((s: unknown) => typeof s !== 'string')) return;
  const mark = deleteMark(deleted as number, raw.swipes);
  // The event's copy of the message is a snapshot: a duplicate carries the same old one. What is stored now decides.
  let current: Record<string, any> | undefined;
  for (const n of [20, 200, 2000]) {
    const rows = (await (spindle.chat.getMessages as unknown as (id: string, o: { tail: number }) => Promise<unknown>)(chatId, { tail: n })) as unknown as Array<Record<string, any>>;
    current = rows.find((m) => m.id === raw.id);
    if (current || rows.length < n) break;
  }
  if (!current) return;
  const msg = eventMsg(current);
  const meta = msg.metadata;
  const tt = isObject(meta?.[TT_KEY]) ? (meta![TT_KEY] as Record<string, unknown>) : null;
  if (!tt || deleteSeen(meta, mark, tt)) return;
  if (!Array.isArray(msg.swipes) || deleteMark(deleted as number, msg.swipes) !== mark) return; // moved on since: a later event, or the repair on read, covers it
  const proj = await projectionFor(uid, chatId);
  const swipes = raw.swipes as string[];
  const shifted = shiftAfterDelete(tt, deleted as number) ?? tt;
  const next = reconcileTt(shifted, swipes, proj.kept) ?? shifted;
  const swipeId = Number.isInteger(msg.swipe_id) ? (msg.swipe_id as number) : 0;
  const changed = repairedKeys(TT_KEY, next, meta, { content: String(msg.content ?? ''), swipeId }, proj, appliedMark(mark, next));
  const patch = hostCaps(spindle).metadataPatch ? { metadata_patch: changed } : { metadata: { ...(meta ?? {}), ...changed } };
  await (spindle.chat.updateMessage as unknown as (id: string, mid: string, patch: Record<string, unknown>) => Promise<void>)(chatId, raw.id, patch);
}

/** Wide reads of old messages (src/host-emu/backend-ops.ts WideReads), shared by the stand-in's calls and kept current from the events below. */
const wideReads = new WideReads();

/**
 * A message changed after the page read it (edit, swipe, new): the page's message cache follows, which is the only way the
 * original (it takes its message list from a cache it expects the app to keep) learns of it. See src/host-emu/message-cache.ts.
 */
async function forwardMessage(uid: Uid, chatId: string, raw: Record<string, any>): Promise<void> {
  if (!raw?.id) return;
  wideReads.update(chatId, eventMsg(raw));
  let character: Awaited<ReturnType<typeof resolveSpeakers>> | null = null;
  try {
    character = await resolveSpeakers(spindle as unknown as EmuHost, uid, chatId);
  } catch {
    // the speaker is a nicety
  }
  const kept = keptTagNames((await readTtConfig(uid)).config?.paragraph?.keepTags);
  send({ type: 'msg_event', chatId, kind: 'upsert', row: eventRow(chatId, raw, character, kept) }, uid);
}

for (const event of ['MESSAGE_EDITED', 'MESSAGE_SWIPED', 'SWIPE_EDITED', 'MESSAGE_SENT'] as const) {
  spindle.on(event as never, ((payload: { chatId?: string; messageId?: string; message?: Parameters<typeof refreshPub>[2] }, userId?: string) => {
    if (!payload?.chatId || !payload.message) return;
    const message = { ...payload.message, id: payload.message.id ?? payload.messageId };
    void forwardMessage(userId, payload.chatId, message as Record<string, any>).catch((e) => spindle.log.warn(`[translator] message event not forwarded: ${errorText(e)}`));
    if (event === 'MESSAGE_SENT') return;
    if (event === 'MESSAGE_SWIPED' && (payload as { action?: string }).action === 'deleted') {
      // Lumiverse renumbered the swipes: the translation records follow (and `pub`, in the same write). refreshPub would read the old numbers.
      void realignAfterDelete(userId, payload.chatId, message, (payload as { swipeId?: number }).swipeId).catch((e) => spindle.log.warn(`[translator] swipe delete not followed: ${errorText(e)}`));
      return;
    }
    void refreshPub(userId, payload.chatId, message).catch((e) => spindle.log.warn(`[translator] pub refresh failed: ${errorText(e)}`));
  }) as never);
}

spindle.on('MESSAGE_DELETED' as never, ((payload: { chatId?: string; messageId?: string; message?: { id?: string } }, userId?: string) => {
  if (!payload?.chatId) return;
  wideReads.drop(payload.chatId);
  const id = payload.messageId ?? payload.message?.id;
  if (id) send({ type: 'msg_event', chatId: payload.chatId, kind: 'delete', messageId: id }, userId);
}) as never);

// ---- host stand-in for the original screens ----

const emuAborts = new Map<string, AbortController>();
/** Generations a page has taken over (Lumiverse sends each event to every open page; one page replays it). */
const leasedGenerations = new Set<string>();
const legacySkipped = new Set<string>();

async function emu(uid: Uid, msg: Extract<ToBackend, { type: 'emu' }>): Promise<void> {
  const reply = (r: { ok: boolean; data?: unknown; error?: string; status?: number }) => send({ type: 'emu_result', id: msg.id, ...r }, uid);
  try {
    if (msg.op === 'lease') {
      const id = String(msg.args[0] ?? '');
      const granted = !!id && !leasedGenerations.has(id);
      if (granted) {
        leasedGenerations.add(id);
        if (leasedGenerations.size > 200) leasedGenerations.delete(leasedGenerations.values().next().value as string);
      }
      reply({ ok: true, data: granted });
      return;
    }
    if (msg.op === 'lv.save') {
      // Our own settings, saved by the original form's one save button (src/host-emu/lv-form.ts). Answers only once they are stored.
      const arg = (msg.args[0] ?? {}) as { chatId?: string | null; settings?: unknown; asDefault?: boolean; connectionId?: string };
      const chatId = typeof arg.chatId === 'string' && arg.chatId ? arg.chatId : null;
      const store = await loadStore(uid);
      const settings = normalizeSettings(arg.settings, store.defaults, store.userBundles);
      const id = typeof arg.connectionId === 'string' ? arg.connectionId.trim() : settings.connectionId;
      settings.connectionId = id;
      if (chatId) store.chats[chatId] = settings;
      // A chat's 대사 지침 bookkeeping belongs to that chat's own scope of the original: it is not copied into the new-chat defaults.
      if (arg.asDefault && chatId) store.defaults = { ...settings, voiceFrom: '', voiceBackupSaved: false, voiceBackupPrompt: '', voiceBackupEnabled: false };
      else if (!chatId) store.defaults = settings;
      else store.defaults = { ...store.defaults, connectionId: id };
      await saveStore(uid, store);
      reply({ ok: true, data: true });
      await sendState(uid);
      return;
    }
    if (msg.op === 'storage.get') {
      await migrateGlossary(uid);
      reply({ ok: true, data: await readTtConfig(uid, true) });
      return;
    }
    if (msg.op === 'storage.patch') {
      const prev = await readTtConfig(uid, true);
      const next = { ...prev, ...((msg.args[0] ?? {}) as Record<string, unknown>) };
      // The original saves its whole in-memory config: a bundle edit made since it loaded must not be undone by it.
      const pending = voiceRebases.get(userKey(uid));
      if (pending?.length && next.config && next.config !== prev.config) voiceRebases.set(userKey(uid), applyRebases(next.config as never, pending));
      await spindle.userStorage.setJson(TT_CONFIG_PATH, next, { indent: 2, userId: uid });
      configCache.set(userKey(uid), { at: Date.now(), value: next as TtConfig });
      reply({ ok: true, data: next });
      // The glossary the memory extension reads is the original's: the chat on screen may just have changed it.
      const open = lastChat.get(userKey(uid));
      if (open) void publishGlossary(uid, open);
      return;
    }
    const bridge = createEmuBridge({
      host: spindle as unknown as EmuHost,
      uid,
      metadataPatch: hostCaps(spindle).metadataPatch,
      signalFor: (id) => emuAborts.get(id)?.signal,
      async chatSettings(chatId) {
        const store = await loadStore(uid);
        const settings = settingsFor(store, chatId);
        let connectionId = '';
        try {
          connectionId = (await resolveConnection(spindle as never, uid, effectiveConnectionId(store, chatId) || undefined, hintFor(uid, chatId))).id ?? '';
        } catch {
          // no connection at all: the original then shows its own "번역 연결을 지정해 주세요" message
        }
        return { connectionId, myLanguage: settings.myLanguage, autoTranslate: settings.autoTranslate, outgoingPrompt: settings.outgoingPrompt, incomingPrompt: settings.incomingPrompt };
      },
      wide: wideReads,
      keptTags: async () => keptTagNames((await readTtConfig(uid)).config?.paragraph?.keepTags),
      projection: (chatId) => projectionFor(uid, chatId),
      async legacy(chatId) {
        const store = await loadStore(uid);
        const cfg = (await readTtConfig(uid)).config;
        return { settings: settingsFor(store, chatId), kept: keptTagNames(cfg?.paragraph?.keepTags) };
      },
      onLegacySkipped: (id) => {
        if (!legacySkipped.has(id)) legacySkipped.add(id);
      },
    });
    if (msg.op === 'generateActive') {
      // The original asks before translating a missed reply: never translate a half-written one.
      reply({ ok: true, data: generationActive.has(String(msg.args[0])) });
      return;
    }
    const fn = (bridge as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[msg.op];
    if (typeof fn !== 'function') {
      reply({ ok: false, error: `unknown op ${msg.op}`, status: 404 });
      return;
    }
    const cancellable = msg.op === 'generateRaw' || msg.op === 'translate';
    if (cancellable) emuAborts.set(msg.id, new AbortController());
    try {
      reply({ ok: true, data: await fn(...(cancellable ? [msg.args[0], msg.id] : msg.args)) });
    } finally {
      emuAborts.delete(msg.id);
    }
  } catch (e) {
    reply({ ok: false, error: friendlyError(errorText(e)), status: (e as { status?: number })?.status });
  }
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
      if (msg.chatId) lastChat.set(userKey(uid), msg.chatId);
      if (msg.open && msg.chatId) void publishGlossary(uid, msg.chatId);
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
    case 'save_settings': {
      const store = await loadStore(uid);
      const settings = normalizeSettings(msg.settings, store.defaults, store.userBundles);
      if (msg.chatId) store.chats[msg.chatId] = settings;
      if (msg.asDefault || !msg.chatId) store.defaults = settings;
      await saveStore(uid, store);
      await sendState(uid);
      return;
    }
    case 'save_bundle': {
      const store = await loadStore(uid);
      const oldPrompt = store.userBundles.find((b) => b.id === msg.bundle.id)?.incomingVoicePrompt ?? null;
      const saved = saveBundle(store, msg.bundle);
      if (oldPrompt !== null && oldPrompt !== saved.incomingVoicePrompt) {
        // The rooms that use the bundle hold its 대사 지침 in the original's own scope (tt-config.json): change it there.
        const prev = await readTtConfig(uid, true);
        const tt = structuredClone(prev);
        const done = reapplyBundleVoice(store, tt as never, saved, oldPrompt);
        if (done.length) {
          await spindle.userStorage.setJson(TT_CONFIG_PATH, tt, { indent: 2, userId: uid });
          configCache.set(userKey(uid), { at: Date.now(), value: tt });
          voiceRebases.set(userKey(uid), [...(voiceRebases.get(userKey(uid)) ?? []), ...done]);
        }
      }
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
    case 'emu':
      await emu(uid, msg);
      return;
    case 'emu_cancel':
      emuAborts.get(msg.id)?.abort();
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

