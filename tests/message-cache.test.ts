import { describe, expect, test } from 'bun:test';
import type { MessageRow } from '../src/host-emu/api';
import { MessageCache } from '../src/host-emu/message-cache';

const row = (id: string, content = `text ${id}`, extra: Record<string, unknown> = {}, swipe = 0, at = '2026-01-01T00:00:00.000Z'): MessageRow =>
  ({ id, chatId: 'c', role: 'assistant', content, characterId: null, createdAt: at, extra, activeSwipeIndex: swipe });

function watched(cache: MessageCache) {
  const events: string[] = [];
  cache.client().getQueryCache().subscribe((e) => events.push(JSON.stringify(e.query.queryKey)));
  return events;
}

describe('message cache (the cache the original takes for the app\'s)', () => {
  test('a chat nobody has read is unknown (undefined), so the original reads it itself', () => {
    expect(new MessageCache().client().getQueryData(['chats', 'messages', 'c'])).toBeUndefined();
  });

  test('rows read for the original are served in the shape the original reads: pages of rows, oldest first', () => {
    const cache = new MessageCache();
    cache.seed('c', [row('b', 'B', {}, 0, '2026-01-02T00:00:00.000Z'), row('a', 'A')]);
    const data = cache.client().getQueryData(['chats', 'messages', 'c'])!;
    expect(data.pages).toHaveLength(1);
    expect(data.pages[0]!.map((r) => r.id)).toEqual(['a', 'b']);
  });

  test('an update event is sent only when a row really changed; an unchanged row keeps its object', () => {
    const cache = new MessageCache();
    const events = watched(cache);
    const a = row('a');
    cache.seed('c', [a]);
    expect(events).toHaveLength(1);
    cache.seed('c', [row('a')]); // same content, a new object: nothing changed
    expect(events).toHaveLength(1);
    expect(cache.row('c', 'a')).toBe(a);
    cache.upsert('c', row('a', 'edited'));
    expect(events).toHaveLength(2);
    expect(cache.row('c', 'a')).not.toBe(a);
    expect(events[1]).toBe('["chats","messages","c"]');
  });

  test('a message event for a chat that was never read is dropped (one row would look like the whole list)', () => {
    const cache = new MessageCache();
    cache.upsert('other', row('a'));
    expect(cache.client().getQueryData(['chats', 'messages', 'other'])).toBeUndefined();
  });

  test('a read that started before a message event does not overwrite the newer row', () => {
    const cache = new MessageCache();
    cache.seed('c', [row('a', 'old')]);
    const since = cache.mark();
    cache.upsert('c', row('a', 'edited while the read was running'));
    cache.seed('c', [row('a', 'old'), row('b')], since);
    expect(cache.row('c', 'a')!.content).toBe('edited while the read was running');
    expect(cache.has('c', 'b')).toBe(true);
  });

  test("the original's own cache writes (setQueryData with an updater) change only the rows it changed", () => {
    const cache = new MessageCache();
    cache.seed('c', [row('a'), row('b')]);
    const before = cache.row('c', 'b');
    const events = watched(cache);
    cache.client().setQueryData(['chats', 'messages', 'c'], (old: any) => ({ ...old, pages: old.pages.map((p: MessageRow[]) => p.map((m) => (m.id === 'a' ? { ...m, content: 'rewritten' } : m))) }));
    expect(cache.row('c', 'a')!.content).toBe('rewritten');
    expect(cache.row('c', 'b')).toBe(before);
    expect(events).toHaveLength(1);
  });

  test('a deleted message leaves the list; the oldest chats are dropped beyond four', () => {
    const cache = new MessageCache();
    cache.seed('c', [row('a'), row('b')]);
    cache.remove('c', 'a');
    expect(cache.has('c', 'a')).toBe(false);
    for (const id of ['c1', 'c2', 'c3', 'c4']) cache.seed(id, [row('x')]);
    expect(cache.has('c', 'b')).toBe(false);
    expect(cache.has('c4', 'x')).toBe(true);
  });
});
