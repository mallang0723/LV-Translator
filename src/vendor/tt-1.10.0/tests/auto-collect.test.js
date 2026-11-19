// Node-only checks for NPC 자동 수집 (no browser). The functions are cut out of extension.js and run with fake dependencies:
// 1) only people and terms the chat does not have yet are picked (names and terms compared ignoring case; existing entries are never changed)
// 2) applying them keeps existing text, adds the new blocks/lines, and turns the 대사 지침 on only when a person was added
// 3) the counter fires every Nth generation, only when the switch is on, never twice at once, and reports what it added
// 4) autoCollectEvery is clamped to 1..50 and falls back to 5
// Run: node tests/auto-collect.test.js personal-extension/extension.js
const fs = require("fs");
const file = process.argv[2];
const code = fs.readFileSync(file, "utf8");

const cut = (from, to) => {
  const a = code.indexOf(from);
  const b = code.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`source markers not found: ${from} … ${to}`);
  return code.slice(a, b);
};

(async () => {
  let failed = 0;
  const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !extra ? "" : ` — ${extra}`}`); if (!ok) failed++; };

  // ---- 1-2. pick + apply ----
  const helpers = new Function("deps", `
    const { queueConfigWrite, currentScope } = deps;
${cut("  function parseGlossary(", "  function glossarySection(")}
${cut("  function glossaryIndex(", "  /* ---------- item editors for the glossary and voice notes")}
    return { selectNewCollected, applyAutoCollected, parseVoice, parseGlossary };`);

  let stored = {
    chats: {
      c1: {
        glossary: "Hogwarts = 호그와트\nMinerva McGonagall = 미네르바 맥고나걸",
        incomingVoicePrompt: "[Mina]\n- 반말, 짧게",
        incomingVoiceEnabled: false,
      },
    },
    defaults: { glossary: "", incomingVoicePrompt: "", incomingVoiceEnabled: false },
  };
  const currentScope = (config, chatId) => ({ ...(config.chats[chatId] ?? config.defaults) });
  const queueConfigWrite = async (build) => { stored = build(stored); return stored; };
  const { selectNewCollected, applyAutoCollected, parseVoice, parseGlossary } = helpers({ queueConfigWrite, currentScope });

  const found = {
    speech: [
      { name: "mina", style: "- 존댓말로 바꿈" },
      { name: "Pierre", style: "- 존댓말" },
      { name: "Pierre", style: "- 두 번째 Pierre" },
      { name: "Empty", style: "  " },
    ],
    glossary: [
      { src: "hogwarts", dst: "호그와트 학교" },
      { src: "호그와트", dst: "Hogwarts" },
      { src: "Albus Dumbledore", dst: "알버스 덤블도어" },
      { src: "Albus Dumbledore", dst: "알버스 덤블도어" },
      { src: "", dst: "빈 항목" },
    ],
  };
  const picked = selectNewCollected(stored.chats.c1, found);
  check("existing person is skipped even when the case differs", !picked.voice.some((e) => e.name.toLowerCase() === "mina"));
  check("new person is picked once, empty style is dropped", picked.voice.length === 1 && picked.voice[0].name === "Pierre" && picked.voice[0].style === "- 존댓말");
  check("existing term is skipped from either side, duplicates and blanks dropped",
    picked.glossary.length === 1 && picked.glossary[0].left === "Albus Dumbledore" && picked.glossary[0].right === "알버스 덤블도어");

  const before = JSON.stringify(stored.chats.c1);
  const added = await applyAutoCollected("c1", found);
  const after = stored.chats.c1;
  check("apply reports counts", added.voice === 1 && added.glossary === 1);
  check("existing voice block and glossary lines are untouched",
    parseVoice(after.incomingVoicePrompt).blocks.find((b) => b.name === "Mina")?.style === "- 반말, 짧게"
    && parseGlossary(after.glossary).some((p) => p.left === "Hogwarts" && p.right === "호그와트"));
  check("new items are added", parseVoice(after.incomingVoicePrompt).blocks.some((b) => b.name === "Pierre") && parseGlossary(after.glossary).some((p) => p.left === "Albus Dumbledore"));
  check("대사 지침 is turned on when a person was added", after.incomingVoiceEnabled === true);

  const again = await applyAutoCollected("c1", found);
  check("running the same results again adds nothing and changes nothing", again.voice === 0 && again.glossary === 0 && JSON.stringify(stored.chats.c1) !== before && JSON.stringify(stored.chats.c1) === JSON.stringify(after));

  stored.chats.c2 = { glossary: "", incomingVoicePrompt: "", incomingVoiceEnabled: false };
  await applyAutoCollected("c2", { speech: [], glossary: [{ src: "Quidditch", dst: "퀴디치" }] });
  check("only terms added: 대사 지침 stays off", stored.chats.c2.incomingVoiceEnabled === false && stored.chats.c2.glossary === "Quidditch = 퀴디치");

  // ---- 3. counter ----
  const timers = [];
  const scans = [];
  const notices = [];
  let scope = { autoCollectEnabled: true, autoCollectEvery: 3 };
  let applyResult = { voice: 2, glossary: 1 };
  const makeTick = new Function("deps", `
    const { scopeFor, collectApply, scanChat, notify, marinara, setTimeout } = deps;
    let disposed = false;
${cut("  const autoCollectCounts = new Map();", "  /* ---------- toast ----------")}
    return { autoCollectTick, dispose: () => { disposed = true; } };`);
  const t = makeTick({
    scopeFor: () => scope,
    collectApply: async () => applyResult,
    scanChat: async (chatId, kind) => { scans.push(`${chatId}:${kind}`); return []; },
    notify: (text) => notices.push(text),
    marinara: { log: { warn: () => {} } },
    setTimeout: (fn) => { timers.push(fn); },
  });
  const flush = async () => { while (timers.length) await timers.shift()(); };

  t.autoCollectTick("c1"); t.autoCollectTick("c1");
  check("nothing runs before the Nth generation", timers.length === 0);
  t.autoCollectTick("c1");
  check("the Nth generation schedules one run", timers.length === 1);
  t.autoCollectTick("c1"); t.autoCollectTick("c1"); t.autoCollectTick("c1");
  check("a run already waiting is not duplicated", timers.length === 1);
  await flush();
  check("a run scans speech then glossary, then reports", scans.join() === "c1:speech,c1:glossary" && notices.length === 1 && notices[0].includes("인물 2명") && notices[0].includes("단어 1개"));
  t.autoCollectTick("c2"); t.autoCollectTick("c2"); t.autoCollectTick("c2");
  check("each chat counts on its own", timers.length === 1);
  await flush();
  scope = { autoCollectEnabled: false, autoCollectEvery: 1 };
  t.autoCollectTick("c1"); t.autoCollectTick("c1");
  check("switch off: never runs", timers.length === 0);
  scope = { autoCollectEnabled: true, autoCollectEvery: 1 };
  applyResult = { voice: 0, glossary: 0 };
  notices.length = 0;
  t.autoCollectTick("c1");
  await flush();
  check("every=1 runs each time; nothing new means no notice", notices.length === 0 && scans.length === 6);

  // ---- 4. normalizeScope ----
  const norm = new Function(`
    const CONTEXT_MESSAGE_COUNT_DEFAULT = 3, CONTEXT_MESSAGE_COUNT_MIN = 1, CONTEXT_MESSAGE_COUNT_MAX = 10;
${cut("  const AUTO_COLLECT_EVERY_DEFAULT", "  const DEFAULT_SCOPE")}
    function normalizeLoreEntries(v) { return Array.isArray(v) ? v : []; }
${cut("  function normalizeScope(", "  function normalizeParagraph(")}
    return normalizeScope;`)();
  check("default is off and every 5", norm({}).autoCollectEnabled === false && norm({}).autoCollectEvery === 5);
  check("only true switches it on", norm({ autoCollectEnabled: "yes" }).autoCollectEnabled === false && norm({ autoCollectEnabled: true }).autoCollectEnabled === true);
  check("interval is clamped to 1..50", norm({ autoCollectEvery: 0 }).autoCollectEvery === 1 && norm({ autoCollectEvery: "999" }).autoCollectEvery === 50 && norm({ autoCollectEvery: "abc" }).autoCollectEvery === 5 && norm({ autoCollectEvery: "7" }).autoCollectEvery === 7);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
