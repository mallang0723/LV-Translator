// Hands the original Translation Tools 1.10.0 the one thing it listens to that Lumiverse does not have: Marinara's
// generation stream (`POST /api/generate`, server-sent events). The original wraps that request: it tracks "a generation
// is running", translates the reply when the stream ends (`translateGenerated`), then runs the NPC auto collect
// (`onGenerated`), and it skips all of that when the user pressed Stop (`POST /api/generate/abort`) or the run was an
// impersonation. Here Lumiverse's generation events are replayed into that same request, so the original's own code
// makes every decision (nothing in the vendor file is changed or duplicated).

export class GenerationHub {
  private streams = new Map<string, { controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean }>();
  private readonly encoder = new TextEncoder();

  /** The response body of `POST /api/generate` for this chat. A second request for the same chat replaces the first. */
  open(chatId: string): ReadableStream<Uint8Array> {
    this.abort(chatId); // an older stream of this chat did not finish: the original must not count it as a finished generation
    let entry!: { controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean };
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        entry = { controller, closed: false };
        this.streams.set(chatId, entry);
      },
      cancel: () => {
        entry.closed = true;
        if (this.streams.get(chatId) === entry) this.streams.delete(chatId);
      },
    });
    return stream;
  }

  has(chatId: string): boolean {
    return this.streams.has(chatId);
  }

  private send(chatId: string, event: Record<string, unknown>): boolean {
    const entry = this.streams.get(chatId);
    if (!entry || entry.closed) return false;
    try {
      entry.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      return true;
    } catch {
      return false;
    }
  }

  /** Ends the stream without any event (the original treats a stream that just stops as "not finished"). */
  cut(chatId: string): void {
    const entry = this.streams.get(chatId);
    if (!entry) return;
    this.streams.delete(chatId);
    if (entry.closed) return;
    entry.closed = true;
    try {
      entry.controller.close();
    } catch {
      // already closed by the reader
    }
  }

  /** The stream breaks (what a browser does when the user aborts the request): the original sees a cut, not an end. */
  abort(chatId: string): void {
    const entry = this.streams.get(chatId);
    if (!entry) return;
    this.streams.delete(chatId);
    if (entry.closed) return;
    entry.closed = true;
    try {
      entry.controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    } catch {
      // already closed by the reader
    }
  }

  /** A saved assistant message followed by `done`: the original translates it and then runs its after-generation work. */
  finish(chatId: string, message: { id: string; content: string; swipe: number }): void {
    this.send(chatId, { type: 'message_saved', data: { id: message.id, role: 'assistant', content: message.content, activeSwipeIndex: message.swipe, extra: {} } });
    this.send(chatId, { type: 'done' });
    this.cut(chatId);
  }

  fail(chatId: string, error: string): void {
    this.send(chatId, { type: 'error', data: error });
    this.cut(chatId);
  }
}

export interface GenerationStarted {
  chatId: string;
  generationType?: string;
  targetMessageId?: string;
}
export interface GenerationEnded {
  chatId: string;
  messageId?: string;
  content?: string;
  error?: string;
  generationType?: string;
}

/**
 * Replays Lumiverse generation events into the original through its own (installed) `fetch`.
 * `fetchImpl` is the `window.fetch` the original installed; it is null until the original has started.
 */
export class GenerationDriver {
  constructor(
    private readonly hub: GenerationHub,
    private readonly fetchImpl: () => typeof fetch | null,
    private readonly log: (text: string, error?: unknown) => void = () => {},
  ) {}

  private post(path: string, body: Record<string, unknown>): Promise<Response> | null {
    const f = this.fetchImpl();
    if (!f) return null;
    return f(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Marinara-CSRF': '1' }, body: JSON.stringify(body) });
  }

  /** `GENERATION_STARTED`: opens the stream and reads it to the end (the original's wrappers only run while it is read). */
  started(p: GenerationStarted): void {
    if (!p.chatId) return;
    const type = p.generationType;
    const body: Record<string, unknown> = { chatId: p.chatId };
    if (type === 'impersonate') body.impersonate = true;
    if ((type === 'regenerate' || type === 'swipe') && p.targetMessageId) body.regenerateMessageId = p.targetMessageId;
    if (type === 'continue' && p.targetMessageId) body.continueMessageId = p.targetMessageId;
    const pending = this.post('/api/generate', body);
    if (!pending) return;
    void pending
      .then(async (res) => {
        if (!res.body) return;
        const reader = res.body.getReader();
        while (!(await reader.read()).done) {
          // events are for the original's wrappers only
        }
      })
      .catch((e) => {
        if ((e as Error)?.name !== 'AbortError') this.log('generation stream', e);
      });
  }

  /** `GENERATION_ENDED`: whether the original had an open stream for it. */
  ended(p: GenerationEnded, swipe = 0): boolean {
    if (!this.hub.has(p.chatId)) return false;
    if (p.generationType === 'impersonate') this.hub.cut(p.chatId);
    else if (p.error) this.hub.fail(p.chatId, p.error);
    else if (p.messageId && typeof p.content === 'string') this.hub.finish(p.chatId, { id: p.messageId, content: p.content, swipe });
    else this.hub.abort(p.chatId);
    return true;
  }

  /** `GENERATION_STOPPED` (the user pressed Stop): the original is told first, then the stream ends without `done`. */
  stopped(chatId: string): void {
    if (!this.hub.has(chatId)) return;
    const abort = this.post('/api/generate/abort', { chatId });
    void abort?.catch((e) => this.log('generation abort', e));
    this.hub.abort(chatId);
  }
}
