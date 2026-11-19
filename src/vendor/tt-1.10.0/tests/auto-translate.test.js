// Automatic translation when the generation stream ends without a "done" event.
// Runs createMarinaraAutomaticTranslation in Node against a fake Marinara server:
//   node tests/auto-translate.test.js personal-extension/extension.js
const fs = require("fs");
const code = fs.readFileSync(process.argv[2], "utf8");
const start = code.indexOf("function createMarinaraAutomaticTranslation(");
const tail = /\r?\n\}\r?\n/g;
tail.lastIndex = start;
const m = tail.exec(code);
const end = m.index + m[0].length;
global.window = { location: { href: "http://marinara.test/" } };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const create = new Function(`${code.slice(start, end)}; return createMarinaraAutomaticTranslation;`)();

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failed++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (v) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
const frame = (event) => `data: ${JSON.stringify(event)}\n\n`;
const saved = { type: "message_saved", data: { id: "m1", role: "assistant", content: "Hi.", activeSwipeIndex: 0, extra: {} } };

/** One generation. ending: "cut" (stream left open, then the reader cancels), "done", or "error". */
async function scenario(ending, { stop = false, active = false } = {}) {
  const generated = [];
  let source;
  const server = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, "http://marinara.test/");
    const method = (init.method || "GET").toUpperCase();
    if (url.pathname === "/api/chats/c1" && method === "GET") return json({ id: "c1", mode: "roleplay", metadata: { autoTranslate: true } });
    if (url.pathname === "/api/chats/c1/metadata") return json({ id: "c1", metadata: {} });
    if (url.pathname === "/api/chats/c1/messages") return json([]);
    if (url.pathname.startsWith("/api/generate/status/")) return json({ active });
    if (url.pathname === "/api/generate/abort") return json({ ok: true });
    if (url.pathname === "/api/generate") {
      const body = new ReadableStream({
        start(c) {
          source = c;
          c.enqueue(new TextEncoder().encode(frame(saved)));
          if (ending === "done") { c.enqueue(new TextEncoder().encode(frame({ type: "done" }))); c.close(); }
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    return json({});
  };
  const ctrl = create({
    marinara: {
      extension: { id: "test" },
      storage: { patch: async () => ({}) },
      log: { warn() {}, info() {} },
      setTimeout: (f, t) => setTimeout(f, t), clearTimeout: (t) => clearTimeout(t),
    },
    fetch: server,
    headersFor: () => new Headers(),
    scopeFor: () => ({ translateAfterPostProcessing: false }),
    translate: async () => ({ translatedText: "안녕." }),
    gameSource: (m) => m.content,
    paragraph: { handlesRow: () => true, translateGenerated: (chatId, ids) => generated.push([chatId, ids]) },
  });
  await ctrl.start({});
  const res = await ctrl.fetch("/api/generate", { method: "POST", body: JSON.stringify({ chatId: "c1" }) }, server);
  const reader = res.body.getReader();
  await reader.read(); // message_saved
  if (ending === "done") {
    while (!(await reader.read()).done);
  } else if (ending === "error") {
    source.error(new DOMException("aborted", "AbortError"));
    await reader.read().catch(() => {});
  } else {
    const cancelled = reader.cancel("watchdog");
    // Marinara's Stop aborts the request first, then posts /generate/abort.
    if (stop) await ctrl.fetch("/api/generate/abort", { method: "POST", body: JSON.stringify({ chatId: "c1" }) }, server);
    await cancelled;
  }
  await wait(1500);
  return generated;
}

(async () => {
  const cut = await scenario("cut");
  check("stream cut without done, generation over: still translated", cut.length === 1 && cut[0][1][0] === "m1");
  check("user pressed Stop: not translated", (await scenario("cut", { stop: true })).length === 0);
  check("stream cut while the server still generates: not translated", (await scenario("cut", { active: true })).length === 0);
  check("normal done event: translated once", (await scenario("done")).length === 1);
  check("read error without done, generation over: still translated", (await scenario("error")).length === 1);
  process.exit(failed ? 1 : 0);
})();
