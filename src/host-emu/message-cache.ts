// The message cache the original Translation Tools 1.10.0 looks for. In Marinara the original finds the app's React Query
// client (a React fiber with `memoizedProps.client`), reads the chat's message list from it (`cachedMessages`), writes edits
// into it (`setCachedExtra`/`setCachedContent`) and listens to its updates (`onCacheEvent` -> `rememberMessage`, `scheduleRefill`).
// Lumiverse has no such client, so without one the original never hears that a message was edited or swiped after the chat was
// opened, and works from the snapshot it took then. This is the same small surface, kept by the host stand-in:
//   - rows the stand-in has read (the original's own list reads) and rows the backend reports changed (message events);
//   - the original's own cache writes;
//   - one `updated` event whenever a row really changed (a changed row is a new object, an unchanged one stays the same object).
// Nothing in the original is edited; the original discovers this client the way it discovers Marinara's.

import type { MessageRow } from './api';

export const MESSAGES_KEY = ['chats', 'messages'] as const;
/** Chats kept at once (the oldest touched is dropped first). */
const MAX_CHATS = 4;

export interface CacheEvent {
  type: 'updated';
  query: { queryKey: unknown[] };
}

type Data = { pages: MessageRow[][]; pageParams: unknown[] };

const fingerprint = (r: MessageRow): string => JSON.stringify([r.content, r.activeSwipeIndex ?? null, r.extra ?? null, r.role, r.createdAt ?? '', r.characterId ?? null]);

export class MessageCache {
  private chats = new Map<string, Map<string, MessageRow>>();
  private prints = new WeakMap<MessageRow, string>();
  private subscribers = new Set<(event: CacheEvent) => void>();
  /** Counts every change; a read that started before a change must not overwrite it (see `seed`). */
  private clock = 0;
  private touchedAt = new Map<string, number>();

  /** Mark "now" before starting a read; pass the mark to `seed` with its result. */
  mark(): number {
    return this.clock;
  }

  has(chatId: string, id: string): boolean {
    return !!this.chats.get(chatId)?.has(id);
  }

  row(chatId: string, id: string): MessageRow | undefined {
    return this.chats.get(chatId)?.get(id);
  }

  size(chatId: string): number {
    return this.chats.get(chatId)?.size ?? 0;
  }

  private bucket(chatId: string): Map<string, MessageRow> {
    let b = this.chats.get(chatId);
    if (b) {
      // most recently used last
      this.chats.delete(chatId);
    } else {
      b = new Map();
    }
    this.chats.set(chatId, b);
    while (this.chats.size > MAX_CHATS) {
      const oldest = this.chats.keys().next().value as string;
      this.chats.delete(oldest);
    }
    return b;
  }

  /** Puts one row in. Returns whether anything changed. The caller emits. */
  private put(b: Map<string, MessageRow>, row: MessageRow): boolean {
    const have = b.get(row.id);
    const print = fingerprint(row);
    if (have && (this.prints.get(have) ?? fingerprint(have)) === print) return false;
    this.prints.set(row, print);
    b.set(row.id, row);
    return true;
  }

  /** Rows the backend read for the original. `since` is the `mark()` taken before that read started: a row an event changed since then is newer. */
  seed(chatId: string, rows: MessageRow[], since: number = this.clock): void {
    const b = this.bucket(chatId);
    let changed = false;
    for (const row of rows) {
      if (!row?.id) continue;
      if ((this.touchedAt.get(`${chatId}:${row.id}`) ?? 0) > since) continue;
      if (this.put(b, row)) changed = true;
    }
    if (changed) this.emit(chatId);
  }

  /**
   * A message event: this row is the newest truth for that message. Only for a chat the original has read: a chat with just
   * one row would look like a whole message list to it.
   */
  upsert(chatId: string, row: MessageRow): void {
    if (!row?.id || !this.chats.has(chatId)) return;
    const b = this.bucket(chatId);
    this.touchedAt.set(`${chatId}:${row.id}`, ++this.clock);
    if (this.put(b, row)) this.emit(chatId);
  }

  remove(chatId: string, id: string): void {
    const b = this.chats.get(chatId);
    if (!b) return;
    this.touchedAt.set(`${chatId}:${id}`, ++this.clock);
    if (b?.delete(id)) this.emit(chatId);
  }

  private data(chatId: string): Data | undefined {
    const b = this.chats.get(chatId);
    if (!b || !b.size) return undefined;
    const rows = [...b.values()].sort((x, y) => String(x.createdAt ?? '').localeCompare(String(y.createdAt ?? '')));
    return { pages: [rows], pageParams: [undefined] };
  }

  private emit(chatId: string): void {
    const event: CacheEvent = { type: 'updated', query: { queryKey: [...MESSAGES_KEY, chatId] } };
    for (const fn of [...this.subscribers]) {
      try {
        fn(event);
      } catch {
        // a subscriber failing must not break the cache
      }
    }
  }

  /** The slice of a React Query client the original uses (`getQueryCache().subscribe`, `getQueryData`, `setQueryData`). */
  client() {
    const chatOf = (key: unknown): string | null =>
      Array.isArray(key) && key[0] === MESSAGES_KEY[0] && key[1] === MESSAGES_KEY[1] && typeof key[2] === 'string' ? key[2] : null;
    return {
      getQueryCache: () => ({
        subscribe: (fn: (event: CacheEvent) => void) => {
          this.subscribers.add(fn);
          return () => this.subscribers.delete(fn);
        },
      }),
      getQueryData: (key: unknown): Data | undefined => {
        const chatId = chatOf(key);
        return chatId ? this.data(chatId) : undefined;
      },
      /** The original's own writes (`setCachedExtra`, `setCachedContent`): `next` is the data with the changed rows as new objects. */
      setQueryData: (key: unknown, updater: unknown): unknown => {
        const chatId = chatOf(key);
        if (!chatId) return undefined;
        const old = this.data(chatId);
        const next = typeof updater === 'function' ? (updater as (o: Data | undefined) => Data | undefined)(old) : (updater as Data | undefined);
        if (!next || next === old || !Array.isArray(next.pages)) return next;
        const b = this.bucket(chatId);
        let changed = false;
        for (const page of next.pages) for (const row of Array.isArray(page) ? page : []) if (row?.id && this.put(b, row)) changed = true;
        if (changed) this.emit(chatId);
        return next;
      },
    };
  }
}

/**
 * Makes the cache findable the way the original looks for Marinara's client: an element under `document.body` that carries a
 * `__reactContainer$…` property whose fiber has `memoizedProps.client`. Returns the remover.
 */
export function installQueryClient(cache: MessageCache): () => void {
  const holder = document.createElement('div');
  holder.hidden = true;
  holder.style.display = 'none';
  holder.setAttribute('data-lv-translator-cache', '');
  (holder as unknown as Record<string, unknown>)['__reactContainer$lvtranslator'] = { memoizedProps: { client: cache.client() } };
  document.body.append(holder);
  return () => holder.remove();
}
