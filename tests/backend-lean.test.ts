import { expect, test } from 'bun:test';
import { makeMessage, withHost } from './helpers/fake-host';
import { METADATA_KEY } from '../src/shared';

const LEAN = { 'chat-lean-messages-v1': 1, 'chat-metadata-patch-v1': 1 };

async function translateLatest(caps: Record<string, number>, run: (h: any) => void) {
  await withHost({ caps }, async (h) => {
    h.messages.push(makeMessage('u1', 'Hi.', 'user', 0), makeMessage('a1', 'Hello there.', 'assistant', 1));
    // the first read of a chat is a full read in every host
    await h.send({ type: 'chat', chatId: h.chatId });
    const before = { ...h.counts };
    h.messages.push(makeMessage('a2', 'Second reply.', 'assistant', 2));
    await h.emit({ messageId: 'a2', content: 'Second reply.', generationType: 'normal' });
    run({ h, before });
  });
}

test('lean host: the job-entry refresh is one tail read, not a whole-chat read, and the write is ownMetadata', async () => {
  await translateLatest(LEAN, ({ h, before }) => {
    expect(h.counts.fullReads - before.fullReads).toBe(0);
    expect(h.counts.tailReads - before.tailReads).toBe(1);
    expect(h.readOptions.at(-1)).toEqual({ tail: 12 });
    expect(h.record(h.messages[2])?.status).toBe('done');
    const writes = h.updates.filter((u: any) => u.ownMetadata);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((u: any) => u.metadata === undefined && u.ownMetadata.v === 1)).toBe(true);
  });
});

test('old host (no capabilities): falls back to the whole-chat refresh and metadata rewrite, other keys kept', async () => {
  await withHost({ caps: {} }, async (h) => {
    const a1 = makeMessage('a1', 'Hello there.', 'assistant', 0);
    a1.metadata = { other: { kept: true } };
    h.messages.push(a1);
    await h.send({ type: 'chat', chatId: h.chatId });
    const before = h.counts.fullReads;
    await h.emit({ messageId: 'a1', content: 'Hello there.', generationType: 'normal' });
    expect(h.counts.fullReads - before).toBe(1);
    expect(h.counts.tailReads).toBe(0);
    expect(h.updates.every((u) => u.ownMetadata === undefined && u.metadata)).toBe(true);
    expect(h.messages[0]!.metadata?.other).toEqual({ kept: true });
    expect(h.record(h.messages[0]!)?.status).toBe('done');
  });
});

test('lean host: a message outside the tail still gets the full refresh', async () => {
  await withHost({ caps: LEAN }, async (h) => {
    for (let i = 0; i < 20; i++) h.messages.push(makeMessage(`m${i}`, `Old ${i}.`, i % 2 ? 'assistant' : 'user', i));
    await h.send({ type: 'chat', chatId: h.chatId });
    const before = h.counts.fullReads;
    await h.emit({ messageId: 'm1', content: 'Old 1.', generationType: 'swipe' });
    expect(h.counts.fullReads - before).toBe(1);
    expect(h.messages[1]!.metadata?.[METADATA_KEY]).toBeDefined();
  });
});
