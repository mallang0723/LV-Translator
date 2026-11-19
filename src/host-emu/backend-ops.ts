// Backend half of the host stand-in: answers the original's `/api` calls (see api.ts) from Lumiverse's spindle API.
// Reads are bounded (`tail`), never the whole chat. The original's per-message record (`extra.paraTranslate`) is kept per
// swipe under its own metadata key, separate from the 0.4.0 `st_translator` records.

import type { ChatRow, MessageRow } from './api';
import { buildPubFromTt, convertLegacyRecord, translationText } from '../adapter/pub';
import { type ChatSettings, METADATA_KEY, type MessageTranslations } from '../shared';
import { recordFor } from '../message-ui';

export const TT_KEY = 'st_translator_tt';
export const PT_KEY = 'paraTranslate';
const MAX_TAIL = 1000;
/** The original's own background reads (after a generation, for the reply context) are about one screen: never the whole chat. */
export const AUTO_TAIL = 16;
/** Saving a record usually concerns one of the newest messages: look at the end first, widen only when it is not there. */
const FIND_TAILS = [AUTO_TAIL, 60] as const;
/** Messages on screen that are older than the opening read (80): looked up in a window this big, then once in a bigger one. */
export const OLD_TAILS = [200, 500] as const;

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
  /** The chat's own translation prompts (what 0.4.0 stored per chat); '' = none, the original then uses its default prompt. */
  outgoingPrompt?: string;
  incomingPrompt?: string;
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
  /** The original's kept tags: needed to find a paragraph's key the way the original does when a record is turned into `extra.translation`. */
  keptTags?(): Promise<ReadonlySet<string>>;
  /** Wide reads shared across calls (one bridge is made per call in the backend); a bridge made without it keeps its own. */
  wide?: WideReads;
}

/**
 * The last wide read of a chat, for a few seconds. Saving the records of many old messages ("모두 번역") finds each message in it
 * instead of reading up to 1000 rows again for every save. Kept current from the host's message events (`update`).
 */
export class WideReads {
  private reads = new Map<string, { at: number; n: number; rows: Msg[] }>();
  constructor(private readonly ttlMs = 15_000) {}

  get(chatId: string, n: number): Msg[] | null {
    const hit = this.reads.get(chatId);
    return hit && hit.n >= n && Date.now() - hit.at < this.ttlMs ? hit.rows : null;
  }

  set(chatId: string, n: number, rows: Msg[]): void {
    this.reads.set(chatId, { at: Date.now(), n, rows });
    while (this.reads.size > 3) this.reads.delete(this.reads.keys().next().value as string);
  }

  /** A message event: the row held for it becomes the event's (a stale row would make the next whole-bag write drop what another extension just wrote). */
  update(chatId: string, raw: Msg): void {
    const rows = this.reads.get(chatId)?.rows;
    const i = rows?.findIndex((m) => m.id === raw.id) ?? -1;
    if (rows && i >= 0) rows[i] = raw;
  }

  drop(chatId: string): void {
    this.reads.delete(chatId);
  }

  private served = new Map<string, string>();

  /** The content of a message as the original last saw it (a row it read through our API, or what it wrote; never a backend message event, which the original may not have received). */
  see(chatId: string, id: string, content: string): void {
    this.served.set(`${chatId}:${id}`, content);
    if (this.served.size > 2000) this.served.delete(this.served.keys().next().value as string);
  }

  seen(chatId: string, id: string): string | undefined {
    return this.served.get(`${chatId}:${id}`);
  }
}

const PARAGRAPHS = /(\n[ \t]*\n)/; // the split the original's syncSourceToEdits uses

/**
 * The original rewrites paragraphs of the content it holds (`base`) and sends the whole result (`next`). If the message changed
 * since (an edit elsewhere, another swipe), `next` would overwrite that. Applies only the paragraphs the original changed onto the
 * current content; null when they cannot be lined up (a paragraph it changed was changed meanwhile, or the paragraph count differs).
 */
export function mergeParagraphEdit(base: string, next: string, current: string): string | null {
  if (current === base) return next;
  const b = base.split(PARAGRAPHS), n = next.split(PARAGRAPHS), c = current.split(PARAGRAPHS);
  if (b.length !== n.length || b.length !== c.length) return null;
  const out = [...c];
  for (let i = 0; i < b.length; i++) {
    if (n[i] === b[i]) continue;
    if (c[i] === n[i]) continue; // the original already holds the current text of this paragraph
    if (c[i] !== b[i]) return null;
    out[i] = n[i]!;
  }
  return out.join('');
}

const ms = (n: unknown): number => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v < 1e12 ? v * 1000 : v;
};

export function messageRow(chatId: string, m: Msg, characterId: string | null, kept: ReadonlySet<string> = new Set()): MessageRow {
  const swipe = Number.isInteger(m.swipe_id) ? (m.swipe_id as number) : 0;
  const { spindle_metadata: _drop, ...extra } = (m.extra ?? {}) as Record<string, unknown>;
  const tt = (m.metadata?.[TT_KEY] ?? null) as Record<string, unknown> | null;
  const rec = tt && typeof tt === 'object' ? tt[String(swipe)] : undefined;
  if (rec) {
    extra[PT_KEY] = rec;
    // Marinara keeps a message's translation in `extra.translation` (+ `translationSource`, the text it was made from); the original
    // reads that for "문맥 > 번역문 포함" of the my-message translation. Here it is made from the swipe's record.
    const text = translationText(String(m.content ?? ''), rec, kept);
    if (text) {
      extra.translation = text;
      extra.translationSource = String(m.content ?? '');
    }
  }
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

/** A host message event's message (`extra.spindle_metadata` holds the metadata) as the row the original reads. */
export function eventMsg(raw: Record<string, any>): Msg {
  const extra = isRecord(raw.extra) ? raw.extra : {};
  const metadata = isRecord(raw.metadata) ? raw.metadata : isRecord(extra.spindle_metadata) ? (extra.spindle_metadata as Record<string, unknown>) : undefined;
  const { spindle_metadata: _drop, ...rest } = extra;
  return { ...(raw as Msg), role: raw.role ?? (raw.is_user ? 'user' : 'assistant'), extra: rest, ...(metadata ? { metadata } : {}) };
}

export function eventRow(chatId: string, raw: Record<string, any>, characterId: string | null | Speakers, kept?: ReadonlySet<string>): MessageRow {
  const m = eventMsg(raw);
  return messageRow(chatId, m, characterId && typeof characterId === 'object' ? speakerOf(m, characterId) : characterId, kept);
}

export interface Speakers {
  /** The chat's main character (what every reply used to be attributed to). */
  main: string | null;
  /** Group chat members (`chat.metadata.group` + `character_ids`), in order. A solo chat has just the main character. */
  members: string[];
  /** Exact member name -> character id. */
  byName: Map<string, string>;
}

const speakerCache = new Map<string, { at: number; value: Speakers }>();

/**
 * Who can speak in a chat. A Lumiverse group chat keeps its members in chat metadata (`group: true`, `character_ids`); each message
 * carries the speaker's display name (`name`). A message is attributed to the member whose name matches exactly; no other guessing.
 */
export async function resolveSpeakers(host: Pick<EmuHost, 'chats' | 'characters'>, uid: string | undefined, chatId: string): Promise<Speakers> {
  const hit = speakerCache.get(chatId);
  if (hit && Date.now() - hit.at < 10_000) return hit.value;
  const chat = await host.chats.get(chatId, uid);
  const main = chat?.character_id ?? null;
  const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
  const group = meta.group === true || meta.group === 1;
  const listed = group && Array.isArray(meta.character_ids) ? (meta.character_ids as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) : [];
  const members = [...new Set(listed.length ? listed : main ? [main] : [])];
  const byName = new Map<string, string>();
  if (listed.length) {
    for (const id of members.slice(0, 12)) {
      try {
        const name = (await host.characters.get(id, uid))?.name;
        if (typeof name === 'string' && name && !byName.has(name)) byName.set(name, id);
      } catch {
        // a member whose card cannot be read is simply not matched
      }
    }
  }
  const value = { main, members, byName };
  speakerCache.set(chatId, { at: Date.now(), value });
  if (speakerCache.size > 20) speakerCache.delete(speakerCache.keys().next().value as string);
  return value;
}

/** The character id for one message: the member whose name equals the message's `name`, else the main character. */
export const speakerOf = (m: { name?: string }, sp: Speakers): string | null => (m.name ? sp.byName.get(m.name) : undefined) ?? sp.main;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function createEmuBridge(d: EmuDeps) {
  const { host, uid } = d;
  const wide = d.wide ?? new WideReads();

  async function tail(chatId: string, n: number): Promise<Msg[]> {
    const rows = (await host.chat.getMessages(chatId, { tail: Math.min(Math.max(1, n), MAX_TAIL) })) as Msg[];
    return Array.isArray(rows) ? rows.slice(-n) : [];
  }

  const speakers = (chatId: string) => resolveSpeakers(host, uid, chatId);

  async function findMessage(chatId: string, messageId: string): Promise<Msg> {
    for (const n of FIND_TAILS) {
      const hit = (await tail(chatId, n)).find((m) => m.id === messageId);
      if (hit) return hit;
    }
    // Older than the end of the chat: one wide read, shared by the saves that follow (a bulk run saves many old messages).
    let rows = wide.get(chatId, MAX_TAIL);
    if (!rows) {
      rows = await tail(chatId, MAX_TAIL);
      wide.set(chatId, MAX_TAIL, rows);
    }
    const hit = rows.find((m) => m.id === messageId);
    if (hit) return hit;
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
        characterIds: (await speakers(chatId)).members,
        personaId,
        metadata: {
          ...meta,
          // Marinara keeps these in its chat settings; here they come from our own settings.
          translationProvider: 'ai',
          // "채팅 설정 유지" (the original's preset that means: use the chat's own prompt). Absent keys keep the original's default prompt.
          ...(s.outgoingPrompt || s.incomingPrompt ? { translationPrompt: s.outgoingPrompt ?? '', translationOutputPrompt: s.incomingPrompt ?? '' } : {}),
          translationConnectionId: s.connectionId,
          translationTargetLang: s.myLanguage,
          autoTranslate: s.autoTranslate,
          activeLorebookIds: [...new Set([...(Array.isArray(meta.activeLorebookIds) ? (meta.activeLorebookIds as string[]) : []), ...attached])],
        },
      };
    },
    /** `n` 0 and `auto`: the original's own background read asked for the whole chat; it gets the end of it (AUTO_TAIL). `n` 0 alone is the user's 모두 번역. */
    async listMessages(chatId: string, n: number, auto = false): Promise<MessageRow[]> {
      const want = n > 0 ? n : auto ? AUTO_TAIL : MAX_TAIL;
      const sp = await speakers(chatId);
      const rows = await tail(chatId, want);
      await convertLegacy(chatId, rows, want <= SCREEN_READ_MAX);
      const kept = await d.keptTags?.();
      for (const m of rows) wide.see(chatId, m.id, String(m.content ?? ''));
      return rows.map((m) => messageRow(chatId, m, speakerOf(m, sp), kept));
    },
    /** Messages on screen that the opening read did not reach: those among the end of the chat (OLD_TAILS), by id. Older ones are absent. */
    async messagesFor(chatId: string, ids: string[]): Promise<MessageRow[]> {
      const want = new Set(ids.slice(0, 80));
      if (!want.size) return [];
      let found: Msg[] = [];
      for (const n of OLD_TAILS) {
        let rows = wide.get(chatId, n);
        if (!rows) {
          rows = await tail(chatId, n);
          wide.set(chatId, n, rows);
        }
        found = rows.filter((m) => want.has(m.id));
        if (found.length >= want.size || rows.length < n) break;
      }
      await convertLegacy(chatId, found, found.length <= SCREEN_READ_MAX);
      const [sp, kept] = [await speakers(chatId), await d.keptTags?.()];
      for (const m of found) wide.see(chatId, m.id, String(m.content ?? ''));
      return found.map((m) => messageRow(chatId, m, speakerOf(m, sp), kept));
    },
    async getMessage(chatId: string, messageId: string): Promise<MessageRow> {
      const row = await findMessage(chatId, messageId);
      await convertLegacy(chatId, [row], true);
      wide.see(chatId, row.id, String(row.content ?? ''));
      return messageRow(chatId, row, speakerOf(row, await speakers(chatId)), await d.keptTags?.());
    },
    async patchExtra(chatId: string, messageId: string, patch: Record<string, unknown>, swipeIndex?: number): Promise<void> {
      if (!(PT_KEY in patch)) return; // the original only ever writes its own record
      const m = await findMessage(chatId, messageId);
      const swipe = swipeIndex ?? (Number.isInteger(m.swipe_id) ? (m.swipe_id as number) : 0);
      await writeTt(chatId, m, swipe, patch[PT_KEY]);
    },
    async updateContent(chatId: string, messageId: string, content: string): Promise<void> {
      // Double safety (the page's cache normally keeps the original's copy current): write onto the message as it is now.
      const base = wide.seen(chatId, messageId);
      let final = content;
      if (base !== undefined) {
        wide.drop(chatId);
        const current = String((await findMessage(chatId, messageId)).content ?? '');
        const merged = mergeParagraphEdit(base, content, current);
        if (merged === null) throw Object.assign(new Error('그 사이 메시지 내용이 바뀌어 영어 원문을 고치지 못했습니다.'), { status: 409 });
        final = merged;
      }
      await host.chat.updateMessage(chatId, messageId, { content: final });
      wide.see(chatId, messageId, final);
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
