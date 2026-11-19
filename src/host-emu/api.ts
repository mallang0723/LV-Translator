// The Marinara REST routes the original Translation Tools 1.10.0 extension calls (`/api/...`), answered from the
// Lumiverse side. The original code is run unmodified (src/vendor/tt-1.10.0/); this file is its "entrance".
// Exactly the routes found in the original: chats, messages (+extra), generate/raw, generate/status, connections,
// characters, personas, lorebooks (+entries). Anything else is 404 (nothing in the original needs it outside
// Marinara's own native translation flow, which Lumiverse does not have).

export interface ChatRow {
  id: string;
  name?: string;
  mode?: string;
  characterIds?: string[];
  personaId?: string | null;
  metadata?: Record<string, unknown>;
}
export interface MessageRow {
  id: string;
  chatId: string;
  role: string;
  content: string;
  characterId?: string | null;
  createdAt?: string;
  extra?: Record<string, unknown>;
  activeSwipeIndex?: number | null;
}

/** What the host side must provide. Every read is bounded: `listMessages` takes a tail count (never the whole chat). */
export interface HostBridge {
  getChat(chatId: string): Promise<ChatRow>;
  /** The last `tail` messages in chat order (oldest first). `tail` 0 means the host's own bounded window. `auto`: the original's own background read (no limit asked, not the user's 모두 번역). */
  listMessages(chatId: string, tail: number, auto?: boolean): Promise<MessageRow[]>;
  getMessage(chatId: string, messageId: string): Promise<MessageRow>;
  /** Merge `patch` into the message's extra (a `null` value deletes the key). `swipeIndex` pins a non-visible swipe. */
  /** Replace the message text (the active swipe), as the original's 영어 원문도 같이 고치기 does. */
  updateContent(chatId: string, messageId: string, content: string): Promise<void>;
  patchExtra(chatId: string, messageId: string, patch: Record<string, unknown>, swipeIndex?: number): Promise<void>;
  generateRaw(
    req: { connectionId: string; messages: Array<{ role: string; content: string }>; parameters?: { maxTokens?: number; temperature?: number } },
    signal?: AbortSignal,
  ): Promise<{ content?: string; aborted?: boolean }>;
  generateActive(chatId: string): Promise<boolean>;
  /** The body of the original's `POST /api/generate` (a stream of server-sent events). Absent where no stream is replayed. */
  openGeneration?(chatId: string): ReadableStream<Uint8Array>;
  /** The original's `POST /api/translate` (the Marinara translate endpoint it intercepts): the model's reply to the system prompt + text. */
  translate?(req: { text: string; targetLanguage: string; systemPrompt?: string; connectionId?: string; chatId?: string }, signal?: AbortSignal): Promise<{ translatedText: string }>;
  connections(): Promise<Array<{ id: string; name: string; model?: string }>>;
  character(id: string): Promise<Record<string, unknown>>;
  persona(id: string): Promise<Record<string, unknown>>;
  lorebooks(): Promise<Array<Record<string, unknown>>>;
  lorebookEntries(bookId: string): Promise<Array<Record<string, unknown>>>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** What the route handler is told about the request beyond its url and body. */
export interface RouteMeta {
  /**
   * A message list read with no limit that is NOT the user's own "번역 안 된 메시지 모두 번역": the original's automatic
   * translation module (`messageRows`, `messagesUrl`) asks for the whole chat after every generation. The user's own bulk run
   * goes through the original's `api()` helper, which always sends `credentials: 'same-origin'`; the automatic module's `request()` never does.
   */
  auto: boolean;
}

type Route = { re: RegExp; method: string; run: (m: RegExpExecArray, q: URLSearchParams, body: any, signal?: AbortSignal, meta?: RouteMeta) => Promise<unknown> };

export function createRoutes(b: HostBridge): Route[] {
  const id = (s: string) => decodeURIComponent(s);
  return [
    { method: 'GET', re: /^\/chats\/([^/]+)$/, run: async (m) => b.getChat(id(m[1]!)) },
    {
      method: 'GET',
      re: /^\/chats\/([^/]+)\/messages$/,
      run: async (m, q, _body, _signal, meta) => {
        const limit = Math.max(0, Number(q.get('limit')) || 0);
        return b.listMessages(id(m[1]!), limit, limit === 0 && meta?.auto === true);
      },
    },
    { method: 'GET', re: /^\/chats\/([^/]+)\/messages\/([^/]+)$/, run: async (m) => b.getMessage(id(m[1]!), id(m[2]!)) },
    {
      method: 'PATCH',
      re: /^\/chats\/([^/]+)\/messages\/([^/]+)$/,
      run: async (m, _q, body) => {
        if (typeof body?.content !== 'string') throw new ApiError(400, 'content required');
        await b.updateContent(id(m[1]!), id(m[2]!), body.content);
        return null;
      },
    },
    {
      method: 'PATCH',
      re: /^\/chats\/([^/]+)\/messages\/([^/]+)\/extra$/,
      run: async (m, q, body) => {
        const swipe = q.get('swipeIndex');
        await b.patchExtra(id(m[1]!), id(m[2]!), body ?? {}, swipe === null ? undefined : Number(swipe));
        return null;
      },
    },
    {
      // Acknowledged only: the original turns the chat's native auto-translate off while it translates and back on after.
      // Lumiverse has no native translation, so nothing is stored (the setting lives in the LV panel).
      method: 'PATCH',
      re: /^\/chats\/([^/]+)\/metadata$/,
      run: async () => ({}),
    },
    {
      method: 'POST',
      re: /^\/generate$/,
      run: async (_m, _q, body) => {
        if (!b.openGeneration || typeof body?.chatId !== 'string') throw new ApiError(404, 'no generation stream');
        return new Response(b.openGeneration(body.chatId), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      },
    },
    { method: 'POST', re: /^\/generate\/abort$/, run: async () => ({}) },
    {
      method: 'POST',
      re: /^\/translate$/,
      run: async (_m, _q, body, signal) => {
        if (!b.translate) throw new ApiError(404, 'no translate');
        if (typeof body?.text !== 'string' || typeof body?.targetLanguage !== 'string') throw new ApiError(400, 'text and targetLanguage required');
        return b.translate(body, signal);
      },
    },
    { method: 'POST', re: /^\/generate\/raw$/, run: async (_m, _q, body, signal) => b.generateRaw(body, signal) },
    { method: 'GET', re: /^\/generate\/status\/([^/]+)$/, run: async (m) => ({ active: await b.generateActive(id(m[1]!)) }) },
    { method: 'GET', re: /^\/connections$/, run: async () => b.connections() },
    { method: 'GET', re: /^\/characters\/personas\/([^/]+)$/, run: async (m) => b.persona(id(m[1]!)) },
    { method: 'GET', re: /^\/characters\/([^/]+)$/, run: async (m) => b.character(id(m[1]!)) },
    { method: 'GET', re: /^\/lorebooks$/, run: async () => b.lorebooks() },
    { method: 'GET', re: /^\/lorebooks\/([^/]+)\/entries$/, run: async (m) => b.lorebookEntries(id(m[1]!)) },
  ];
}

/** `fetch` replacement: `/api/...` goes to the bridge, everything else to the real fetch. */
export function createApiFetch(bridge: HostBridge, realFetch: typeof fetch): typeof fetch {
  const routes = createRoutes(bridge);
  const json = (status: number, data: unknown) =>
    status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    let url: URL;
    try {
      url = new URL(raw, 'http://host.invalid');
    } catch {
      return realFetch(input as RequestInfo, init);
    }
    const isApi = /^\/api\//.test(url.pathname) && (raw.startsWith('/') || url.origin === location.origin);
    if (!isApi) return realFetch(input as RequestInfo, init);
    const path = url.pathname.slice(4);
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const route = routes.find((r) => r.method === method && r.re.test(path));
    if (!route) return json(404, { error: `no route ${method} ${path}` });
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      return json(400, { error: 'bad json' });
    }
    try {
      const data = await route.run(route.re.exec(path)!, url.searchParams, body, init?.signal ?? undefined, { auto: init?.credentials !== 'same-origin' });
      if (data instanceof Response) return data;
      return json(200, data ?? null);
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, { message: e.message });
      if ((e as Error)?.name === 'AbortError') throw e;
      return json(500, { message: (e as Error)?.message ?? String(e) });
    }
  }) as typeof fetch;
}
