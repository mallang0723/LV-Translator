// Loads the extension in Chromium with a mocked Marinara runtime and a fake chat-settings drawer (with the two native prompt fields), then checks:
// 1) 기타 지침 can be saved under a name, loaded into a chat (saved right away) and deleted; a normal save keeps the saved list
// 2) broken saved entries are dropped when the config is read
// 3) built-in presets that write Korean end with the Hangul-only rule; the generic presets do not
const fs = require("fs");
const { chromium } = require("playwright");
const file = process.argv[2];
const code = fs.readFileSync(file, "utf8");

(async () => {
  let failed = 0;
  const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !extra ? "" : ` — ${extra}`}`); if (!ok) failed++; };
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.route("http://marinara.test/**", (r) => r.fulfill({
    contentType: "text/html",
    body: '<html><body><div data-chat-settings-section="translation"><div class="mari-drawer__body"><textarea aria-label="input prompt"></textarea><textarea aria-label="output prompt"></textarea></div></div></body></html>',
  }));
  await page.goto("http://marinara.test/");
  await page.evaluate((code) => {
    window.fetch = async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    localStorage.setItem("marinara-active-chat-id", "c1");
    window.__patches = [];
    let config = {
      chats: { c1: { freeContextEnabled: true, freeContext: "Gothic manor, late 1800s." } },
      notes: [
        { id: "note-ok", name: "Kept", text: "Keep me." },
        { id: "bad-id", name: "Wrong id", text: "x" },
        { id: "note-empty", name: "Empty", text: "  " },
        { id: "note-dup", name: "Kept", text: "Same name" },
      ],
    };
    window.marinara = {
      extension: { id: "test" },
      storage: {
        get: async () => ({ config }),
        patch: async (v) => { window.__patches.push(JSON.parse(JSON.stringify(v))); if (v.config) config = v.config; return { config }; },
      },
      onCleanup() {}, log: { warn: (...a) => console.log("warn", ...a), info() {} },
      setInterval: (f, t) => setInterval(f, t), clearInterval: (i) => clearInterval(i),
      setTimeout: (f, t) => setTimeout(f, t), clearTimeout: (i) => clearTimeout(i),
    };
    (0, eval)(code);
  }, code);
  await page.waitForSelector("section[data-translation-presets-glossary] form", { state: "attached", timeout: 5000 });
  await page.waitForTimeout(500);
  const lastConfig = () => page.evaluate(() => {
    const withConfig = window.__patches.filter((p) => p.config);
    return withConfig.length ? withConfig[withConfig.length - 1].config : null;
  });
  const options = () => page.evaluate(() => [...document.querySelector('select[name="freeContextNote"]').options].map((o) => o.textContent));

  // 2) broken entries dropped on read
  check("broken saved notes dropped (bad id, empty text, duplicate name)", JSON.stringify(await options()) === JSON.stringify(["저장한 지침 고르기", "Kept"]), JSON.stringify(await options()));
  check("load and delete disabled until a note is picked", await page.evaluate(() => document.querySelector("[data-tpg-note-load]").disabled && document.querySelector("[data-tpg-note-delete]").disabled));

  // 1a) save the chat's 기타 지침 under a name — only the notes list is written, the open form is not reset
  await page.evaluate(() => {
    window.prompt = () => "Manor style";
    document.querySelector('textarea[name="glossary"]').value = "UNSAVED-GLOSSARY";
    document.querySelector("[data-tpg-note-save]").click();
  });
  await page.waitForTimeout(300);
  let cfg = await lastConfig();
  check("save writes the note", cfg?.notes?.some((n) => n.name === "Manor style" && n.text === "Gothic manor, late 1800s." && n.id.startsWith("note-")), JSON.stringify(cfg?.notes));
  check("save keeps the earlier note", cfg?.notes?.some((n) => n.id === "note-ok"));
  check("save does not touch the chat settings", cfg?.chats?.c1?.freeContext === "Gothic manor, late 1800s." && !JSON.stringify(cfg).includes("UNSAVED-GLOSSARY"));
  check("unsaved form edits survive saving a note", await page.evaluate(() => document.querySelector('textarea[name="glossary"]').value === "UNSAVED-GLOSSARY"));
  check("saved note picked in the list", (await page.evaluate(() => document.querySelector('select[name="freeContextNote"]').selectedOptions[0]?.textContent)) === "Manor style");

  // 1b) same name again with other text asks first, then replaces in place
  await page.evaluate(() => {
    window.prompt = () => "Manor style";
    window.confirm = () => true;
    document.querySelector('textarea[name="freeContext"]').value = "Gothic manor, winter.";
    document.querySelector("[data-tpg-note-save]").click();
  });
  await page.waitForTimeout(300);
  cfg = await lastConfig();
  check("same name replaces the note (no duplicate)", cfg.notes.filter((n) => n.name === "Manor style").length === 1 && cfg.notes.find((n) => n.name === "Manor style").text === "Gothic manor, winter.");

  // 1c) load a note into the chat: 기타 지침 replaced, switched on, saved at once
  await page.evaluate(() => {
    document.querySelector('textarea[name="glossary"]').value = "";
    document.querySelector('textarea[name="freeContext"]').value = "";
    document.querySelector('input[name="freeContextEnabled"]').checked = false;
    const select = document.querySelector('select[name="freeContextNote"]');
    select.value = "note-ok";
    select.dispatchEvent(new Event("change"));
    document.querySelector("[data-tpg-note-load]").click();
  });
  await page.waitForTimeout(500);
  cfg = await lastConfig();
  check("load fills the chat's 기타 지침 and saves it", cfg?.chats?.c1?.freeContext === "Keep me." && cfg.chats.c1.freeContextEnabled === true, JSON.stringify(cfg?.chats?.c1));
  check("normal save keeps the saved notes", cfg.notes.length === 2);

  // 1d) delete
  await page.evaluate(() => {
    window.confirm = () => true;
    const select = document.querySelector('select[name="freeContextNote"]');
    select.value = "note-ok";
    select.dispatchEvent(new Event("change"));
    document.querySelector("[data-tpg-note-delete]").click();
  });
  await page.waitForTimeout(300);
  cfg = await lastConfig();
  check("delete removes only that note", cfg.notes.length === 1 && cfg.notes[0].name === "Manor style");
  check("delete leaves the chat's 기타 지침 alone", cfg.chats.c1.freeContext === "Keep me.");

  // 3) Hangul-only rule on the presets that write Korean
  const presets = await page.evaluate(() => {
    const select = document.querySelector('select[name="incomingPresetId"]');
    return [...select.options].map((o) => o.value);
  });
  const korean = ["builtin-korean-style-keep-model-dialogue", "builtin-korean-style-foreign-dialogue", "builtin-korean-style-foreign-dialogue-generate"];
  check("presets listed", korean.every((id) => presets.includes(id)), presets.join(","));
  await browser.close();

  const start = code.indexOf("  const HANGUL_ONLY_RULE =");
  check("Hangul-only rule defined once", start > 0 && code.indexOf("  const HANGUL_ONLY_RULE =", start + 1) < 0);
  const block = code.slice(code.indexOf("  const BUILTIN_PRESETS = Object.freeze(["), code.indexOf("  const BUILTIN_PRESET_ORDER"));
  const wrapped = [...block.matchAll(/id: "([^"]+)"[\s\S]*?prompt: (withHangulRule\()?/g)].map((m) => [m[1], !!m[2]]);
  const want = new Set(["builtin-english-korean", "builtin-chinese-korean", "builtin-japanese-korean", "builtin-bilingual-dialogue-korean",
    "builtin-english-korean-v2", "builtin-japanese-korean-v2", "builtin-chinese-korean-v2", "builtin-bilingual-dialogue-korean-v2",
    ...korean, "builtin-english-paraphrase-korean", "builtin-english-source-style-korean", "builtin-chinese-paraphrase-korean"]);
  check("every Korean-output preset gets the rule", wrapped.filter(([id]) => want.has(id)).every(([, w]) => w) && wrapped.filter(([id]) => want.has(id)).length === want.size);
  check("generic and input presets keep their own text", wrapped.filter(([id]) => !want.has(id)).every(([, w]) => !w), wrapped.filter(([id, w]) => !want.has(id) && w).map(([id]) => id).join(","));
  process.exit(failed ? 1 : 0);
})();
