import { describe, expect, test } from 'bun:test';
import { createApiFetch, type HostBridge } from '../src/host-emu/api';
import { GenerationDriver, GenerationHub } from '../src/host-emu/generation';

const tick = () => new Promise((r) => setTimeout(r, 5));

/** The page side of the stand-in: the hub behind the /api/generate route, a fetch that records what the original would see. */
function setup() {
  const hub = new GenerationHub();
  const posts: Array<{ path: string; body: any }> = [];
  const events: any[] = [];
  const bridge = { openGeneration: (chatId: string) => hub.open(chatId) } as unknown as HostBridge;
  const api = createApiFetch(bridge, (() => Promise.reject(new Error('real fetch'))) as unknown as typeof fetch);
  // Stands in for the original's wrapper: reads the stream the way its pull-based wrapper does.
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    posts.push({ path, body: JSON.parse(String(init?.body)) });
    const res = await api(input, init);
    if (path === '/api/generate' && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return void events.push('EOF');
            for (const frame of decoder.decode(value).split('\n\n').filter(Boolean)) events.push(JSON.parse(frame.replace(/^data: /, '')));
          }
        } catch (e) {
          events.push(`ERR ${(e as Error).name}`);
        }
      })();
      return new Response(null, { status: 200 });
    }
    return res;
  }) as typeof fetch;
  const driver = new GenerationDriver(hub, () => fetchImpl);
  return { hub, driver, posts, events };
}

describe('Lumiverse generation events replayed into the original', () => {
  test('a finished reply is a message_saved then done on the stream the original is reading', async () => {
    const { driver, posts, events, hub } = setup();
    driver.started({ chatId: 'c', generationType: 'normal' });
    await tick();
    expect(posts[0]).toEqual({ path: '/api/generate', body: { chatId: 'c' } });
    expect(hub.has('c')).toBe(true);
    expect(driver.ended({ chatId: 'c', messageId: 'm1', content: 'Hello there.', generationType: 'normal' })).toBe(true);
    await tick();
    expect(events).toEqual([
      { type: 'message_saved', data: { id: 'm1', role: 'assistant', content: 'Hello there.', activeSwipeIndex: 0, extra: {} } },
      { type: 'done' },
      'EOF',
    ]);
    expect(hub.has('c')).toBe(false);
  });

  test('Stop tells the original first (its generate/abort), then breaks the stream without done', async () => {
    const { driver, posts, events } = setup();
    driver.started({ chatId: 'c' });
    await tick();
    driver.stopped('c');
    await tick();
    expect(posts.map((p) => p.path)).toEqual(['/api/generate', '/api/generate/abort']);
    expect(posts[1]!.body).toEqual({ chatId: 'c' });
    expect(events).toEqual(['ERR AbortError']);
  });

  test('regenerate and continue name the message, an impersonation is flagged and ends without events', async () => {
    const a = setup();
    a.driver.started({ chatId: 'c', generationType: 'swipe', targetMessageId: 'm9' });
    a.driver.started({ chatId: 'd', generationType: 'continue', targetMessageId: 'm8' });
    a.driver.started({ chatId: 'e', generationType: 'impersonate' });
    await tick();
    expect(a.posts.map((p) => p.body)).toEqual([{ chatId: 'c', regenerateMessageId: 'm9' }, { chatId: 'd', continueMessageId: 'm8' }, { chatId: 'e', impersonate: true }]);
    a.driver.ended({ chatId: 'e', messageId: 'x', content: 'draft', generationType: 'impersonate' });
    await tick();
    expect(a.events).toEqual(['EOF']);
  });

  test('an error ends with an error event; an ended generation nobody opened is not ours', async () => {
    const { driver, events } = setup();
    driver.started({ chatId: 'c' });
    await tick();
    driver.ended({ chatId: 'c', error: 'boom' });
    await tick();
    expect(events).toEqual([{ type: 'error', data: 'boom' }, 'EOF']);
    expect(driver.ended({ chatId: 'zzz', messageId: 'm', content: 'x' })).toBe(false);
    driver.stopped('zzz');
  });
});
