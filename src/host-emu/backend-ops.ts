// Backend half of the host stand-in: answers the original's `/api` calls (see api.ts) from Lumiverse's spindle API.
// Reads are bounded (`tail`), never the whole chat. The original's per-message record (`extra.paraTranslate`) is kept per
// swipe under its own metadata key, separate from the 0.4.0 `st_translator` records.

import type { ChatRow, MessageRow } from './api';
import { buildPubFromTt, convertLegacyRecord } from '../adapter/pub';
import { type ChatSettings, METADATA_KEY, type MessageTranslations } from '../shared';
import { recordFor } from '../message-ui';

export const TT_KEY = 'st_translator_tt';
export const PT_KEY = 'paraTranslate';
const MAX_TAIL = 1000;

export interface Msg {
  id: string;
  role?: string;
  is_user?: boolean;
  content?: string;
  name?: string;
  extra?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  swipes?: string[];
  swipe_id?: number;
  send_date?: number;
  created_at?: number;
  swipe_dates?: number[];
}

/** The slice of the spindle host the stand-in uses. */
export interface EmuHost {
  chats: { get(id: string, uid?: string): Promise<{ id: string; name?: string; character_id?: string; metadata?: Record<string, unknown> } | null> };
  chat: {
    getMessages(chatId: string, options?: { tail?: number }): Promise<unknown>;
    updateMessage(chatId: string, messageId: string, patch: Record<string, unknown>): Promise<unknown>;
  };
  characters: { get(id: string, uid?: string): Promise<Record<string, any> | null> };
  personas: { get(id: string, uid?: string): Promise<Record<string, any> | null>; getActive?(uid?: string): Promise<Record<string, any> | null> };
  world_books: {
    list(options?: { limit?: number; userId?: string }): Promise<{ data: Array<Record<string, any>> }>;
    entries: { list(bookId: string, options?: { limit?: number; userId?: string }): Promise<{ data: Array<Record<string, any>> }> };
  };
  generate: { quiet(input: Record<string, unknown>): Promise<unknown> };
  connections: { list(uid?: string): Promise<Array<{ id: string; name?: string; model?: string }>> };
}

export interface ChatTranslationSettings {
  /** Connection id the translation runs on ('' = let the host decide). */
  connectionId: string;
  /** Language incoming responses are translated into. */
  myLanguage: string;
  autoTranslate: boolean;
}

export interface EmuDeps {
  host: EmuHost;
  uid: string | undefined;
  /** Chat settings with the connection already resolved (chosen, chat, active, default). */
  chatSettings(chatId: string): Promise<ChatTranslationSettings>;
  /** Whether the host supports `metadata_patch` (chat-metadata-patch-v1). */
  metadataPatch: boolean;
  signalFor?(requestId: string): AbortSignal | undefined;
  /** The memory extension's side of the record (src/adapter/pub.ts): whether `pub` is wanted, its language, the original's kept tags. */
  projection?(chatId: string): Promise<{ publish: boolean; language: string; kept: ReadonlySet<string> }>;
  /** A 0.4.0 record is turned into the original's once, when its message is read (src/adapter/pub.ts convertLegacyRecord). */
  legacy?(chatId: string): Promise<{ settings: ChatSettings; kept: ReadonlySet<string> } | null>;
  /** Count of 0.4.0 records that could not be converted exactly (whole-message or partial translations). */
  onLegacySkipped?(messageId: string): void;
}

const ms = (n: unknown): number => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v < 1e12 ? v * 1000 : v;
};

export function messageRow(chatId: string, m: Msg, characterId: string | null): MessageRow {
  const swipe = Number.isInteger(m.swipe_id) ? (m.swipe_id as number) : 0;
  const { spindle_metadata: _drop, ...extra } = (m.extra ?? {}) as Record<string, unknown>;
  const tt = (m.metadata?.[TT_KEY] ?? null) as Record<string, unknown> | null;
  const rec = tt && typeof tt === 'object' ? tt[String(swipe)] : undefined;
  if (rec) extra[PT_KEY] = rec;
  if (extra.hidden === true) extra.hiddenFromUser = true;
  const when = ms(m.swipe_dates?.[swipe]) || ms(m.send_date) || ms(m.created_at);
  const role = m.role ?? (m.is_user ? 'user' : 'assistant');
  return {
    id: m.id,
    chatId,
    role,
    content: String(m.content ?? ''),
    characterId: role === 'assistant' ? characterId : null,
    createdAt: when ? new Date(when).toISOString() : '',
    extra,
    activeSwipeIndex: swipe,
  };
}

export function createEmuBridge(d: EmuDeps) {
  const { host, uid } = d;

  async function tail(chatId: string, n: number): Promise<Msg[]> {
    const rows = (await host.chat.getMessages(chatId, { tail: Math.min(Math.max(1, n), MAX_TAIL) })) as Msg[];
    return Array.isArray(rows) ? rows.slice(-n) : [];
  }

  async function characterOf(chatId: string): Promise<string | null> {
    return (await host.chats.get(chatId, uid))?.character_id ?? null;
  }

  async function findMessage(chatId: string, messageId: string): Promise<Msg> {
    for (const n of [60, MAX_TAIL]) {
      const hit = (await tail(chatId, n)).find((m) => m.id === messageId);
      if (hit) return hit;
    }
    throw Object.assign(new Error('메시지를 찾지 못했습니다.'), { status: 404 });
  }

  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

  async function writeTt(chatId: string, m: Msg, swipe: number, value: unknown): Promise<void> {
    const prev = (isObj(m.metadata?.[TT_KEY]) ? m.metadata![TT_KEY] : {}) as Record<string, unknown>;
    const next = { ...prev };
    if (value === null || value === undefined) delete next[String(swipe)];
    else next[String(swipe)] = value;
    const changed: Record<string, unknown> = { [TT_KEY]: next };
    // The memory extension's `pub` follows the visible swipe's record; it lives under the 0.4.0 key (`st_translator`).
    const visible = Number.isInteger(m.swipe_id) ? (m.swipe_id as number) : 0;
    const proj = swipe === visible ? await d.projection?.(chatId) : undefined;
    if (proj?.publish) {
      const st = isObj(m.metadata?.[METADATA_KEY]) ? (m.metadata![METADATA_KEY] as Record<string, unknown>) : {};
      const pub = buildPubFromTt(String(m.content ?? ''), next[String(swipe)], proj.language, proj.kept, Date.now());
      if (pub || st.pub !== undefined) {
        const merged = { v: 1, entries: {}, ...st } as Record<string, unknown>;
        if (pub) merged.pub = pub;
        else delete merged.pub;
        changed[METADATA_KEY] = merged;
      }
    }
    const patch: Record<string, unknown> = d.metadataPatch ? { metadata_patch: changed } : { metadata: { ...(m.metadata ?? {}), ...changed } };
    await host.chat.updateMessage(chatId, m.id, patch);
    m.metadata = { ...(m.metadata ?? {}), ...changed };
  }

  const converting = new Set<string>();

  /** N8: a message the original has no record for, but 0.4.0 translated paragraph by paragraph, shows that translation. */
  /** Reads this small are the messages on screen: only those are saved. A bigger read (the original's "모두 번역") is converted in memory only. */
  const SCREEN_READ_MAX = 60;

  async function convertLegacy(chatId: string, rows: Msg[], persist: boolean): Promise<void> {
    if (!d.legacy) return;
    let ctx: Awaited<ReturnType<NonNullable<EmuDeps['legacy']>>> | undefined;
    for (const m of rows) {
      const old = m.metadata?.[METADATA_KEY] as MessageTranslations | undefined;
      if (!old || !isObj(old.entries) || !Object.keys(old.entries).length) continue;
      const swipe = Number.isInteger(m.swipe_id) ? (m.swipe_id as number) : 0;
      const tt = isObj(m.metadata?.[TT_KEY]) ? (m.metadata![TT_KEY] as Record<string, unknown>) : {};
      if (tt[String(swipe)] !== undefined) continue;
      const legacy = recordFor(old, String(m.content ?? ''));
      if (!legacy) continue;
      ctx ??= await d.legacy(chatId);
      if (!ctx) return;
      const converted = convertLegacyRecord(String(m.content ?? ''), legacy, ctx.settings, ctx.kept, Date.now());
      if (!converted) {
        d.onLegacySkipped?.(m.id);
        continue;
      }
      const key = `${m.id}:${swipe}`;
      m.metadata = { ...(m.metadata ?? {}), [TT_KEY]: { ...tt, [swipe]: converted } };
      if (!persist || converting.has(key)) continue;
      converting.add(key);
      // Saved once, next to (never over) the 0.4.0 record, so the original's later saves start from it.
      void host.chat
        .updateMessage(chatId, m.id, d.metadataPatch ? { metadata_patch: { [TT_KEY]: { ...tt, [swipe]: converted } } } : { metadata: m.metadata })
        .catch(() => converting.delete(key));
    }
  }

  async function generateRaw(
    req: { connectionId: string; messages: Array<{ role: string; content: string }>; parameters?: { maxTokens?: number; temperature?: number } },
    requestId?: string,
  ): Promise<{ content?: string; aborted?: boolean }> {
    const signal = requestId ? d.signalFor?.(requestId) : undefined;
    const res = (await host.generate.quiet({
      type: 'quiet',
      messages: req.messages,
      ...(req.connectionId ? { connection_id: req.connectionId } : {}),
      parameters: { temperature: req.parameters?.temperature ?? 0.3, ...(req.parameters?.maxTokens ? { max_tokens: req.parameters.maxTokens } : {}) },
      userId: uid,
      signal,
    })) as { content?: unknown } | string | null;
    if (signal?.aborted) return { aborted: true };
    return { content: typeof res === 'string' ? res : typeof res?.content === 'string' ? res.content : '' };
  }

  return {
    async getChat(chatId: string): Promise<ChatRow> {
      const chat = await host.chats.get(chatId, uid);
      if (!chat) throw Object.assign(new Error('채팅을 찾지 못했습니다.'), { status: 404 });
      const s = await d.chatSettings(chatId);
      const meta = { ...(chat.metadata ?? {}) } as Record<string, unknown>;
      let personaId = typeof meta.persona_id === 'string' ? meta.persona_id : null;
      if (!personaId) personaId = ((await host.personas.getActive?.(uid).catch(() => null)) as { id?: string } | null)?.id ?? null;
      // The books Lumiverse attaches to the character and persona: the original ranks lore by these links.
      const attached = new Set<string>();
      try {
        const c = chat.character_id ? await host.characters.get(chat.character_id, uid) : null;
        for (const id of c?.world_book_ids ?? []) attached.add(String(id));
        const p = personaId ? await host.personas.get(personaId, uid) : null;
        if (p?.attached_world_book_id) attached.add(String(p.attached_world_book_id));
      } catch {
        // linkage is a nicety
      }
      return {
        id: chat.id,
        name: chat.name ?? '',
        mode: 'roleplay',
        characterIds: chat.character_id ? [chat.character_id] : [],
        personaId,
        metadata: {
          ...meta,
          // Marinara keeps these in its chat settings; here they come from our own settings.
          translationProvider: 'ai',
          translationConnectionId: s.connectionId,
          translationTargetLang: s.myLanguage,
          autoTranslate: s.autoTranslate,
          activeLorebookIds: [...new Set([...(Array.isArray(meta.activeLorebookIds) ? (meta.activeLorebookIds as string[]) : []), ...attached])],
        },
      };
    },
    async listMessages(chatId: string, n: number): Promise<MessageRow[]> {
      const character = await characterOf(chatId);
      const rows = await tail(chatId, n || MAX_TAIL);
      await convertLegacy(chatId, rows, n > 0 && n <= SCREEN_READ_MAX);
      return rows.map((m) => messageRow(chatId, m, character));
    },
    async getMessage(chatId: string, messageId: string): Promise<MessageRow> {
      const row = await findMessage(chatId, messageId);
      await convertLegacy(chatId, [row], true);
      return messageRow(chatId, row, await characterOf(chatId));
    },
    async patchExtra(chatId: string, messageId: string, patch: Record<string, unknown>, swipeIndex?: number): Promise<void> {
      if (!(PT_KEY in patch)) return; // the original only ever writes its own record
      const m = await findMessage(chatId, messageId);
      const swipe = swipeIndex ?? (Number.isInteger(m.swipe_id) ? (m.swipe_id as number) : 0);
      await writeTt(chatId, m, swipe, patch[PT_KEY]);
    },
    async updateContent(chatId: string, messageId: string, content: string): Promise<void> {
      await host.chat.updateMessage(chatId, messageId, { content });
    },
    generateRaw,
    /** The original's `POST /api/translate` after it has put the glossary, notes and context in (what Marinara's translate endpoint does with it). */
    async translate(
      req: { text: string; targetLanguage: string; systemPrompt?: string; connectionId?: string; chatId?: string },
      requestId?: string,
    ): Promise<{ translatedText: string }> {
      const lang = req.targetLanguage.trim();
      const system = String(req.systemPrompt ?? '').replaceAll('{{targetLanguage}}', lang);
      const connectionId = req.connectionId || (req.chatId ? (await d.chatSettings(req.chatId)).connectionId : '');
      const messages: Array<{ role: string; content: string }> = [];
      if (system.trim()) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: `Translate the following text to ${lang}:\n\n${req.text}` });
      const res = await generateRaw({ connectionId, messages, parameters: { temperature: 0.3, maxTokens: 8192 } }, requestId);
      const text = String(res.content ?? '').trim();
      if (!text) throw Object.assign(new Error('번역 결과가 비어 있습니다.'), { status: 502 });
      return { translatedText: text };
    },
    async connections() {
      return (await host.connections.list(uid)).map((c) => ({ id: c.id, name: c.name ?? c.id, model: c.model ?? '' }));
    },
    async character(id: string) {
      const c = await host.characters.get(id, uid);
      // The original reads Marinara's `data` blob (Tavern card fields).
      return { id, data: c ? { name: c.name, description: c.description, personality: c.personality, scenario: c.scenario, first_mes: c.first_mes, mes_example: c.mes_example } : {} };
    },
    async persona(id: string) {
      const p = await host.personas.get(id, uid);
      return { id, name: p?.name ?? '', description: p?.description ?? '', personality: '' };
    },
    async lorebooks() {
      const rows = (await host.world_books.list({ limit: 200, userId: uid })).data;
      return rows.map((b) => ({ id: b.id, name: b.name, enabled: true }));
    },
    async lorebookEntries(bookId: string) {
      const rows = (await host.world_books.entries.list(bookId, { limit: 500, userId: uid })).data;
      return rows.map((e) => ({ id: e.id, name: e.comment ?? '', keys: e.key ?? [], content: e.content ?? '', enabled: e.disabled !== true }));
    },
  };
}
