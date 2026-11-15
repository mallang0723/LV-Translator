import { expect, test } from 'bun:test';
import { makeMessage, settle, withHost } from './helpers/fake-host';
import { METADATA_KEY, sourceHash } from '../src/shared';

const eventWith = (h: any, mt: unknown) => {
  const { metadata: _metadata, ...rest } = structuredClone(h.messages[0]);
  h.event('MESSAGE_EDITED', { chatId: h.chatId, message: { ...rest, extra: { spindle_metadata: { [METADATA_KEY]: mt } } } });
};
const lastView = (h: any) => h.sent.filter((p: any) => p.type === 'views').at(-1)?.views[0];

test('a late progress event after the final write does not turn the bar back to partial', async () => {
  await withHost({ caps: {} }, async (h) => {
    h.messages.push(makeMessage('a1', 'Hello there.', 'assistant', 0));
    await h.send({ type: 'chat', chatId: h.chatId });
    await h.emit({ messageId: 'a1', content: 'Hello there.', generationType: 'normal' });
    expect(lastView(h).status).toBe('done');
    // an older progress copy (partial, earlier updatedAt) arrives after the final write
    const key = sourceHash('Hello there.');
    const done = (h.messages[0]!.metadata as any)[METADATA_KEY];
    const stale = structuredClone(done);
    stale.entries[key] = { ...stale.entries[key], status: 'partial', updatedAt: done.entries[key].updatedAt - 500 };
    eventWith(h, stale);
    await settle();
    await h.send({ type: 'chat', chatId: h.chatId });
    expect(lastView(h).status).toBe('done');
  });
});

test('final view uses the job result even if the row was overwritten by an older event during the final write', async () => {
  await withHost({ caps: {} }, async (h) => {
    h.messages.push(makeMessage('a1', 'Hello there.', 'assistant', 0));
    await h.send({ type: 'chat', chatId: h.chatId });
    const key = sourceHash('Hello there.');
    const update = h.api.chat.updateMessage;
    let writes = 0;
    h.api.chat.updateMessage = async (id: string, mid: string, patch: any) => {
      await update(id, mid, patch);
      if (++writes >= 1) {
        // an old partial event lands right after the write
        const mt = structuredClone(patch.metadata[METADATA_KEY]);
        mt.entries[key] = { ...mt.entries[key], status: 'partial', updatedAt: 1 };
        eventWith(h, mt);
      }
    };
    await h.emit({ messageId: 'a1', content: 'Hello there.', generationType: 'normal' });
    expect(lastView(h).status).toBe('done');
  });
});

test('a genuinely partial job still shows partial', async () => {
  await withHost({ caps: {} }, async (h) => {
    h.messages.push(makeMessage('a1', 'Hello there.', 'assistant', 0));
    h.setComplete(async () => ({ content: '번역', finish_reason: 'length' }));
    await h.send({ type: 'chat', chatId: h.chatId });
    await h.emit({ messageId: 'a1', content: 'Hello there.', generationType: 'normal' });
    const status = h.record(h.messages[0]!)?.status;
    expect(status).not.toBe('done');
    expect(lastView(h).status).toBe(status as any);
  });
});
