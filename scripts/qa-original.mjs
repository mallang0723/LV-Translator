// Browser check of the original Translation Tools 1.10.0 screens running whole inside a Lumiverse-shaped DOM, with a fake
// host bridge and a fake model (no network, no live LLM, no server). Needs Playwright and Chromium:
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.js CHROMIUM_BIN=/usr/bin/chromium node scripts/qa-original.mjs
// Screenshots go to QA_SHOT_DIR (default os tmpdir/lv-translator-qa).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'lv-tt-qa-'));
const shots = process.env.QA_SHOT_DIR || join(tmpdir(), 'lv-translator-qa');
mkdirSync(shots, { recursive: true });
writeFileSync(join(work, 'entry.ts'), `import { startOriginal, createSettingsHost } from '${root}src/host-emu/boot';\n(window as any).LVEmu = { startOriginal, createSettingsHost };\n`);
execFileSync('bun', ['build', join(work, 'entry.ts'), '--outfile', join(work, 'emu.js'), '--target', 'browser'], { stdio: 'inherit' });
const emu = readFileSync(join(work, 'emu.js'), 'utf8');

const pwm = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const pw = pwm.chromium ? pwm : pwm.default;
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_BIN || undefined });
const failures = [];
const check = (label, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); if (!ok) failures.push(label); };

const HTML = `<!doctype html><meta charset=utf-8><style>:root{--lumiverse-bg:#1b1b22;--lumiverse-text:#ddd;--lumiverse-text-muted:#9a9aa6;--lumiverse-border:#3a3a46;--lumiverse-primary:#7c6cf0;--lumiverse-fill-subtle:#2a2a33}</style><body style="font:14px sans-serif;background:#1b1b22;color:#ddd">
<div id="chat" style="width:520px">
 <div data-component="BubbleMessage" data-message-id="m1" style="border:1px solid #444;padding:8px;margin:8px 0">
  <div><div data-component="MessageContent"><p>The lamp was still burning.</p><p>"Come in," she said.</p></div><span data-spindle-mount="message_footer"></span></div>
  <div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>
 </div>
</div>
<div id="settings" style="width:420px"></div>`;

const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setContent(HTML);
await page.addScriptTag({ content: emu });
await page.evaluate(() => {
  const db = {
    chat: { id: 'c1', name: 'QA', mode: 'roleplay', characterIds: [], personaId: null, metadata: { translationProvider: 'ai', translationConnectionId: 'conn1', translationTargetLang: 'ko', autoTranslate: false } },
    messages: [{ id: 'm1', chatId: 'c1', role: 'assistant', content: 'The lamp was still burning.\n\n"Come in," she said.', createdAt: new Date().toISOString(), extra: {}, activeSwipeIndex: 0, characterId: 'ch1' }],
    raw: [],
  };
  window.__db = db;
  const bridge = {
    getChat: async () => db.chat,
    listMessages: async () => db.messages,
    getMessage: async (c, id) => db.messages.find((m) => m.id === id),
    patchExtra: async (c, id, patch) => { const m = db.messages.find((x) => x.id === id); for (const [k, v] of Object.entries(patch)) { if (v === null) delete m.extra[k]; else m.extra[k] = v; } },
    generateRaw: async (req) => { db.raw.push(req); const user = req.messages.find((m) => m.role === 'user')?.content ?? ''; const ids = [...user.matchAll(/<segment id="(\d+)">/g)].map((m) => m[1]); return { content: ids.map((i) => `<segment id="${i}">번역 ${i}</segment>`).join('\n') }; },
    generateActive: async () => false,
    connections: async () => [{ id: 'conn1', name: 'Fake', model: 'none' }],
    character: async () => ({ data: JSON.stringify({ name: 'Mina' }) }),
    persona: async () => ({ name: 'Ethan' }),
    lorebooks: async () => [],
    lorebookEntries: async () => [],
  };
  let stored = null;
  const storage = { get: async () => ({ config: stored }), patch: async (p) => { if (p.config) stored = p.config; return { config: stored }; } };
  document.querySelector('#settings').append(LVEmu.createSettingsHost());
  window.__emu = LVEmu.startOriginal({
    bridge, storage, activeChatId: () => 'c1',
    addStyle: (css) => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); return () => s.remove(); },
  });
});
await page.waitForTimeout(1500);

check('settings form is injected by the original', (await page.locator('.tpg-form').count()) === 1);
check('original settings text 번역 프롬프트 present', (await page.locator('.tpg-form h5', { hasText: '번역 프롬프트' }).count()) >= 1);
for (const [sel, label] of [['[data-tpg-scan="speech"]', '말투 자동 정리'], ['[data-tpg-world]', '세계관 자동 정리'], ['[data-tpg-lore]', '로어북 항목 선택'], ['[data-tpg-bulk]', 'bulk translate button'], ['[data-tpg-export]', 'backup export'], ['[data-tpg-import]', 'backup import']]) {
  check(`settings control ${label}`, (await page.locator(sel).count()) >= 1);
}
check('host translate button added to the action row', (await page.locator('.mari-message-actions svg.lucide-languages').count()) === 1);
await page.screenshot({ path: join(shots, '01-settings.png'), fullPage: true });

await page.locator('.mari-message-actions button:has(svg.lucide-languages)').click();
await page.waitForSelector('.ptx-view', { timeout: 8000 }).catch(() => {});
check('translation view (.ptx-view) rendered after the button', (await page.locator('.ptx-view').count()) >= 1);
check('record saved as the original writes it (extra.paraTranslate)', await page.evaluate(() => !!window.__db.messages[0].extra.paraTranslate));
check('model was called through generate/raw', await page.evaluate(() => window.__db.raw.length >= 1));
await page.screenshot({ path: join(shots, '02-translated.png'), fullPage: true });

const barCompare = page.locator('.ptx-bar [data-ptx-act="compare"]');
check('bar has 대조 button', (await barCompare.count()) === 1);
if (await barCompare.count()) {
  await barCompare.click();
  await page.waitForSelector('.ptx-compare', { timeout: 3000 }).catch(() => {});
  check('compare window opens', (await page.locator('.ptx-compare').count()) === 1);
  check('compare window has per-paragraph 다시 번역 buttons', (await page.locator('.ptx-compare [data-act="row"]').count()) >= 1);
  check('compare window has 전체 다시 번역 and 저장', (await page.locator('.ptx-compare [data-act="all"]').count()) === 1 && (await page.locator('.ptx-compare [data-act="save"]').count()) === 1);
  await page.screenshot({ path: join(shots, '03-compare.png'), fullPage: true });
}

// ---- integrated: the built frontend (src/frontend.ts) with a fake Lumiverse context; the backend half is the real
// createEmuBridge on a fake spindle host. Same original, same screens, now through the RPC the extension really uses. ----
writeFileSync(join(work, 'entry2.ts'), `
import { setup } from '${root}src/frontend';
import * as backendOps from '${root}src/host-emu/backend-ops';
import { normalizeStore, sourceHash } from '${root}src/shared';
import { blockKey } from '${root}src/adapter/keys';
// eventRow: how the backend turns a host message event into the row the page's message cache takes (absent before 0.5.2).
(window as any).LVInt = { setup, createEmuBridge: backendOps.createEmuBridge, eventRow: (backendOps as any).eventRow, blockKey, normalizeStore, sourceHash };
(window as any).__LVSetup = setup;
`);
execFileSync('bun', ['build', join(work, 'entry2.ts'), '--outfile', join(work, 'int.js'), '--target', 'browser'], { stdio: 'inherit' });
const intJs = readFileSync(join(work, 'int.js'), 'utf8');
const page2 = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors2 = [];
if (process.env.QA_DEBUG) page2.on('console', (m) => console.log('console2', m.type(), m.text().slice(0, 300)));
page2.on('pageerror', (e) => errors2.push(String(e)));
await page2.route('http://qa.test/**', (route) => route.fulfill({ contentType: 'text/html', body: HTML.replace('<div id="settings" style="width:420px"></div>', '') }));
await page2.goto('http://qa.test/chat/c1');
await page2.addScriptTag({ content: intJs });
await page2.evaluate(() => {
  const messages = [{ id: 'm1', role: 'assistant', content: 'The lamp was still burning.\n\n"Come in," she said.', swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] }];
  window.__writes = [];
  const host = {
    chats: { get: async (id) => ({ id, name: 'QA', character_id: 'ch1', metadata: {} }) },
    chat: { getMessages: async (_c, o) => { (window.__reads ||= []).push(o?.tail ?? null); return o?.tail ? messages.slice(-o.tail) : messages; }, updateMessage: async (c, id, patch) => { window.__writes.push(patch); const m = messages.find((x) => x.id === id); if (patch.metadata_patch) m.metadata = { ...m.metadata, ...patch.metadata_patch }; if (patch.metadata) m.metadata = patch.metadata; if (patch.content) { m.content = patch.content; m.swipes[m.swipe_id] = patch.content; } } },
    characters: { get: async () => ({ name: 'Mina', world_book_ids: [] }) }, personas: { get: async () => ({ name: 'Ethan' }), getActive: async () => null },
    world_books: { list: async () => ({ data: [] }), entries: { list: async () => ({ data: [] }) } },
    generate: { quiet: async (i) => {
      (window.__quiet ||= []).push(i);
      const user = i.messages.find((m) => m.role === 'user')?.content ?? '';
      const ids = [...user.matchAll(/<segment id="(\d+)">/g)].map((m) => m[1]);
      if (ids.length) return { content: ids.map((n) => `<segment id="${n}">번역 ${n}</segment>`).join('\n') };
      if (/^\[Original English\]/.test(user)) return { content: 'Alpha one revised.' }; // 영어 원문도 같이 고치기
      if (/^Translate the following text to /.test(user)) return { content: 'EN: ' + user.split('\n\n').slice(1).join('\n\n') };
      return { content: '{"characters":[],"terms":[]}' };
    } },
    connections: { list: async () => [{ id: 'conn1', name: 'Fake', model: 'none' }] },
  };
  const ops = LVInt.createEmuBridge({ host, uid: 'u', metadataPatch: true,
    legacy: async () => ({ settings: LVInt.normalizeStore(null).defaults, kept: new Set() }), chatSettings: async () => ({ connectionId: 'conn1', myLanguage: 'ko', autoTranslate: window.__auto === true }) });
  let storage = null; const handlers = [];
  const reply = (m) => { if (window.__dbg) console.log('reply', m.type, m.ok, m.error || ''); handlers.forEach((h) => h(m)); };
  const tabRoot = document.createElement('div'); tabRoot.id = 'tab'; document.body.append(tabRoot);
  const noop = () => {};
  const ctx = {
    dom: { addStyle: (css) => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); return () => s.remove(); }, cleanup: noop, listMessageElements: () => [], findMessageElement: () => null, inject: noop, uninject: noop },
    ui: { mount: () => document.createElement('span'), registerDrawerTab: () => ({ root: tabRoot, activate: noop, destroy: noop, setBadge: noop }), registerInputBarAction: () => ({ onClick: () => noop, destroy: noop }), showModal: noop, showConfirm: async () => ({ confirmed: true }) },
    events: { on: (name, h) => { (window.__handlers ||= {})[name] = [...((window.__handlers || {})[name] || []), h]; return () => { window.__handlers[name] = window.__handlers[name].filter((x) => x !== h); }; } }, connections: { getActive: () => ({ activeProfileId: 'conn1' }) }, chats: { get: async () => ({ metadata: {} }) },
    onBackendMessage: (h) => { handlers.push(h); return noop; },
    sendToBackend: async (msg) => {
      if (window.__dbg) console.log('send', msg.type, msg.op);
      if (msg.type === 'hello') return reply({ type: 'state', store: LVInt.normalizeStore({ defaults: { translateMyMessages: true, modelLanguage: 'English' } }), connections: [{ id: 'conn1', name: 'Fake', model: 'none', isDefault: true }], link: 'none' });
      if (msg.type !== 'emu') return;
      await new Promise((r) => setTimeout(r, 0)); // a real backend answers later
      try {
        let data;
        if (msg.op === 'lease') data = !(window.__leased ||= new Set()).has(msg.args[0]) && !!window.__leased.add(msg.args[0]);
        else if (msg.op === 'storage.get') data = storage; else if (msg.op === 'storage.patch') data = storage = { ...storage, ...msg.args[0] };
        else data = await ops[msg.op](...(msg.op === 'generateRaw' || msg.op === 'translate' ? [msg.args[0], msg.id] : msg.args));
        reply({ type: 'emu_result', id: msg.id, ok: true, data });
      } catch (e) { reply({ type: 'emu_result', id: msg.id, ok: false, error: String(e.message || e) }); }
    },
  };
  localStorage.setItem('translation-presets-glossary-debug', '1'); window.__ops = ops; window.__reply = reply; window.__ctx = ctx; window.__dbg = true; window.__setStorage = (v) => { storage = v; }; window.__emit = (name, p) => (window.__handlers?.[name] || []).forEach((h) => h(p)); window.__messages = messages; window.__cleanup = LVInt.setup(ctx);
});
await page2.waitForTimeout(2500);
if (process.env.QA_DEBUG) console.log(await page2.evaluate(() => JSON.stringify({ tab: document.querySelector('#tab')?.innerHTML.slice(0, 400), ls: [...document.querySelectorAll('.mari-message-actions')].length, sec: document.querySelectorAll('[data-chat-settings-section]').length, w: window.__writes })));
check('integrated: original settings screen shows inside the extension tab', (await page2.locator('#tab .tpg-form').count()) === 1);
check('integrated: our own settings (연결·언어) are still there', (await page2.locator('#tab .stt-panel h3', { hasText: '기본 번역' }).count()) === 1);
check('integrated: old per-message toolbar/bar/pencil UI is gone', (await page2.locator('.stt-tb, .stt-bar, .stt-edit-row').count()) === 0);
await page2.locator('.mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForTimeout(800);
if (process.env.QA_DEBUG) console.log('rows:', JSON.stringify(await page2.evaluate(() => window.__ops.listMessages('c1', 60))));
if (process.env.QA_DEBUG) console.log('dom:', JSON.stringify(await page2.evaluate(() => document.querySelector('[data-message-id]').outerHTML.slice(0, 1200))));
if (process.env.QA_DEBUG) console.log('toast0:', await page2.evaluate(() => document.querySelector('.ptx-toasts')?.outerHTML.slice(0, 600) ?? 'no toasts'));
await page2.waitForSelector('.ptx-view', { timeout: 8000 }).catch(() => {});
if (process.env.QA_DEBUG) console.log('toast:', await page2.evaluate(() => [...document.querySelectorAll('.ptx-toast')].map((t) => t.textContent).join(' / ')));
check('integrated: translating shows the original view', (await page2.locator('.ptx-view').count()) >= 1);
check('integrated: record saved under its own metadata key via metadata_patch', await page2.evaluate(() => window.__writes.some((w) => w.metadata_patch && w.metadata_patch.st_translator_tt)));
await page2.screenshot({ path: join(shots, '04-integrated.png'), fullPage: true });
await page2.evaluate(() => window.__cleanup());
check('integrated: cleanup removes the original view and anchors', (await page2.locator('.ptx-view, .tpg-form').count()) === 0);
await page2.evaluate(() => { window.__cleanup = window.__LVSetup(window.__ctx); });
await page2.waitForSelector('.ptx-view', { timeout: 8000 }).catch(() => {});
check('integrated: after a restart the stored translation is shown again (no model call)', (await page2.locator('.ptx-view').count()) >= 1);

// ---- generation replay (N1/N5): Lumiverse events -> the original's own /api/generate handling ----
await page2.evaluate(() => {
  window.__cleanup();
  // N8: a message translated by 0.4.0 (paragraph by paragraph), on screen; the original must show it with no model call
  const legacyContent = 'Rain fell on the roof.\n\nShe waited.';
  window.__messages.push({ id: 'm3', role: 'assistant', content: legacyContent, swipes: ['x'], swipe_id: 0, extra: {}, send_date: Math.floor(Date.now() / 1000) - 7200, swipe_dates: [Math.floor(Date.now() / 1000) - 7200],
    metadata: { st_translator: { v: 1, entries: { [LVInt.sourceHash(legacyContent)]: { parts: ['빗방울이 지붕에 떨어졌다.', '그녀는 기다렸다.'], pieces: [], unit: 'paragraph', total: 2, truncatedPart: -1, status: 'done', updatedAt: 1 } } } } });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm3');
  row.innerHTML = '<div><div data-component="MessageContent"><p>Rain fell on the roof.</p><p>She waited.</p></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  document.querySelector('#chat').append(row);
  window.__setStorage({ config: { defaults: { autoCollectEnabled: true, autoCollectEvery: 1, glossary: 'Mina = 미나' }, chats: { c1: { outgoingPresetId: 'custom-qa1', autoCollectEnabled: true, autoCollectEvery: 1, glossary: 'Mina = 미나' } }, presets: [{ id: 'custom-qa1', name: 'QA prompt', prompt: 'CUSTOM-OUT-PROMPT for {{targetLanguage}}.' }] } });
  window.__auto = true;
  window.__quiet = [];
  window.__writes.length = 0;
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForTimeout(4500); // the original's own start-up catch-up (3 s) runs first and finds nothing to do
const quiet0 = await page2.evaluate(() => window.__quiet.length);
check('N8: a 0.4.0 translation is shown by the original (view on screen) with no model call', (await page2.locator('[data-message-id="m3"] .ptx-view').count()) >= 1 && quiet0 === 0, `views=${await page2.locator('[data-message-id="m3"] .ptx-view').count()} calls=${quiet0}`);
check('N8: the converted record was saved beside the 0.4.0 one (which is kept)', await page2.evaluate(() => { const m = window.__messages.find((x) => x.id === 'm3'); return !!m.metadata.st_translator_tt?.['0']?.map && Object.keys(m.metadata.st_translator.entries).length === 1; }));
await page2.evaluate(() => { window.__reads = []; window.__emit('GENERATION_STARTED', { generationId: 'g1', chatId: 'c1', generationType: 'normal' }); });
await page2.waitForTimeout(400);
await page2.evaluate(() => {
  window.__messages.push({ id: 'm2', role: 'assistant', content: 'A second reply, quiet and slow.', swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] });
  window.__emit('GENERATION_ENDED', { generationId: 'g1', chatId: 'c1', messageId: 'm2', content: 'A second reply, quiet and slow.', generationType: 'normal' });
});
await page2.waitForFunction(() => window.__messages.find((x) => x.id === 'm2')?.metadata?.st_translator_tt?.['0'], null, { timeout: 8000 }).catch(() => {});
check('generation replay: the reply is translated by the original (record written for m2)', await page2.evaluate(() => (() => { const m = window.__messages.find((x) => x.id === 'm2'); return !!m.metadata?.st_translator_tt?.['0']?.map && Object.keys(m.metadata.st_translator_tt['0'].map).length >= 1; })()));
check('generation replay: the original translated with the segment prompt', await page2.evaluate((n) => window.__quiet.slice(n).some((c) => c.messages.some((m) => /<segment id="1">/.test(m.content))), quiet0));
await page2.waitForTimeout(4500); // NPC auto collect waits 3 s after the generation
const collectCalls = await page2.evaluate((n) => window.__quiet.slice(n).filter((c) => !c.messages.some((m) => /<segment id=/.test(m.content))).length, quiet0);
if (process.env.QA_DEBUG) console.log('quiet calls:', JSON.stringify(await page2.evaluate((n) => window.__quiet.slice(n).map((c) => [c.messages.map((m) => m.role + ':' + m.content.slice(0, 70))]), quiet0)));
check('N1: onGenerated ran the NPC auto collect (말투·단어장 scans) after the generation', collectCalls >= 2, `scan calls=${collectCalls}`);
const genReads = await page2.evaluate(() => window.__reads.slice());
console.log(`READS per generation (host getMessages tail sizes, in order): ${JSON.stringify(genReads)}  count=${genReads.length} rows=${genReads.reduce((a, b) => a + (b ?? 0), 0)}`);
check('0.5.2 cond 3: no read of a whole chat after a generation (every read is screen-sized, at most 60 rows)', genReads.length > 0 && genReads.every((n) => n !== null && n <= 60), JSON.stringify(genReads));
// Stop: the original must neither translate nor collect
const quiet1 = await page2.evaluate(() => window.__quiet.length);
await page2.evaluate(() => window.__emit('GENERATION_STARTED', { generationId: 'g2', chatId: 'c1', generationType: 'normal' }));
await page2.waitForTimeout(300);
await page2.evaluate(() => window.__emit('GENERATION_STOPPED', { generationId: 'g2', chatId: 'c1', content: 'half a repl' }));
await page2.waitForTimeout(6500);
check('N1: after the user pressed Stop nothing is translated and nothing is collected', (await page2.evaluate(() => window.__quiet.length)) === quiet1);
// a second open page does not replay the same generation
await page2.evaluate(() => { window.__emit('GENERATION_STARTED', { generationId: 'g1', chatId: 'c1', generationType: 'normal' }); });
await page2.waitForTimeout(300);
check('lease: a generation already taken (by another page) is not replayed again', await page2.evaluate(() => window.__quiet.length) === quiet1);

// ---- 0.5.2 condition 1: a message changed after the chat was opened must reach the original's own cache path ----
// (hand-made message elements below; the original learns them when it starts, as it does when a chat is opened)
const paras = (id, list) => page2.evaluate(([id, list]) => {
  let row = document.querySelector(`[data-message-id="${id}"]`);
  if (!row) {
    row = document.createElement('div');
    row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', id);
    row.innerHTML = '<div><div data-component="MessageContent"></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
    document.querySelector('#chat').append(row);
  }
  row.querySelector('[data-component="MessageContent"]').innerHTML = list.map((t) => `<p>${t}</p>`).join('');
}, [id, list]);
const old = Math.floor(Date.now() / 1000) - 9000;
const S0 = 'Swipe zero one.\n\nSwipe zero two.', S1 = 'Swipe one first.\n\nSwipe one second.';
const C0 = 'Alpha one.\n\nBeta two.\n\nGamma three.', C1 = 'Alpha one.\n\nBeta two.\n\nGamma three EDITED.';
await page2.evaluate(([S0, S1, C0, old]) => {
  window.__cleanup();
  window.__auto = false;
  window.__setStorage({ config: { defaults: { translateMyMessages: false }, chats: {}, presets: [] } });
  const mk = (id, swipes) => ({ id, role: 'assistant', content: swipes[0], swipes, swipe_id: 0, extra: {}, metadata: {}, send_date: old, swipe_dates: swipes.map(() => old) });
  window.__messages.push(mk('m6', [C0]), mk('m7', [S0, S1]));
  window.__wire = (m) => { const { metadata, ...rest } = JSON.parse(JSON.stringify(m)); return { ...rest, extra: { ...rest.extra, spindle_metadata: metadata } }; };
  window.__feed = (id) => { const m = window.__messages.find((x) => x.id === id); if (LVInt.eventRow) window.__reply({ type: 'msg_event', chatId: 'c1', kind: 'upsert', row: LVInt.eventRow('c1', window.__wire(m), 'ch1') }); };
}, [S0, S1, C0, old]);
await paras('m6', C0.split('\n\n')); await paras('m7', S0.split('\n\n'));
await page2.evaluate(() => { window.__cleanup = window.__LVSetup(window.__ctx); });
await page2.waitForTimeout(800);
const tt = (id) => page2.evaluate((id) => window.__messages.find((x) => x.id === id).metadata?.st_translator_tt ?? null, id);

// (1) opened -> edited elsewhere -> 영어 원문도 같이 고치기 keeps the edit
await page2.locator('[data-message-id="m6"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForFunction(() => window.__messages.find((x) => x.id === 'm6').metadata?.st_translator_tt?.['0'], null, { timeout: 8000 }).catch(() => {});
await page2.evaluate((C1) => { const m = window.__messages.find((x) => x.id === 'm6'); m.content = C1; m.swipes[0] = C1; window.__feed('m6'); }, C1);
await paras('m6', C1.split('\n\n'));
await page2.waitForTimeout(2600); // the original translates only the new paragraph (scheduleRefill, 1.2 s)
await page2.locator('[data-message-id="m6"] .ptx-bar [data-ptx-act="compare"]').click({ timeout: 4000 }).catch(() => {});
await page2.waitForSelector('.ptx-compare', { timeout: 3000 }).catch(() => {});
await page2.locator('.ptx-compare .ptx-cmp-dst textarea').first().fill('수정한 첫 문단').catch(() => {});
await page2.locator('.ptx-compare [data-sync-src]').check().catch(() => {});
await page2.locator('.ptx-compare [data-act="save"]').click().catch(() => {});
await page2.waitForTimeout(1500);
const m6 = await page2.evaluate(() => window.__messages.find((x) => x.id === 'm6').content);
check('0.5.2 cond 1: after open -> edit elsewhere -> 영어 원문도 같이 고치기, the edit is kept', /Gamma three EDITED\./.test(m6) && /Alpha one revised\./.test(m6), JSON.stringify(m6));
check('0.5.2 cond 1: the paragraph added by the edit was translated by the original (scheduleRefill)', await page2.evaluate(() => Object.keys(window.__messages.find((x) => x.id === 'm6').metadata?.st_translator_tt?.['0']?.map ?? {}).length >= 3));
await page2.locator('.ptx-compare [data-act="cancel"]').click({ timeout: 500 }).catch(() => {});

// (2) opened -> swiped -> translate: the swipe's record holds only that swipe's paragraphs, the other swipe's record is untouched
await page2.locator('[data-message-id="m7"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForFunction(() => window.__messages.find((x) => x.id === 'm7').metadata?.st_translator_tt?.['0'], null, { timeout: 8000 }).catch(() => {});
const rec0 = JSON.stringify((await tt('m7'))?.['0']?.map ?? null);
await page2.evaluate(() => { const m = window.__messages.find((x) => x.id === 'm7'); m.swipe_id = 1; m.content = m.swipes[1]; window.__feed('m7'); });
await paras('m7', S1.split('\n\n'));
await page2.waitForTimeout(700);
await page2.locator('[data-message-id="m7"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForFunction(() => window.__messages.find((x) => x.id === 'm7').metadata?.st_translator_tt?.['1'], null, { timeout: 6000 }).catch(() => {});
await page2.waitForTimeout(500);
const t7b = await tt('m7');
const keys1 = Object.keys(t7b?.['1']?.map ?? {});
check('0.5.2 cond 1: after a swipe, translating saves a record for that swipe with only its own 2 paragraphs', keys1.length === 2, `swipe1 keys=${keys1.length} swipe0 keys=${Object.keys(t7b?.['0']?.map ?? {}).length}`);
check("0.5.2 cond 1: the other swipe's record is kept as it was", JSON.stringify(t7b?.['0']?.map ?? null) === rec0 && rec0 !== 'null');
await page2.waitForTimeout(300);
// (3) a message older than the opening read (80) that is on screen: its stored translation is drawn, and no whole-chat read is made
await page2.evaluate(() => {
  window.__cleanup();
  const k = LVInt.blockKey;
  const rec = { v: 1, map: { [k('Old one.')]: '옛 하나', [k('Old two.')]: '옛 둘' }, edited: {}, view: '', at: 1 };
  const t = Math.floor(Date.now() / 1000) - 99999;
  window.__messages.unshift({ id: 'm8', role: 'assistant', content: 'Old one.\n\nOld two.', swipes: ['x'], swipe_id: 0, extra: {}, metadata: { st_translator_tt: { 0: rec } }, send_date: t, swipe_dates: [t] });
  for (let i = 0; i < 90; i++) window.__messages.push({ id: `f${i}`, role: 'user', content: `Filler ${i}.`, swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: t + 1 + i, swipe_dates: [t + 1 + i] });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm8');
  row.innerHTML = '<div><div data-component="MessageContent"><p>Old one.</p><p>Old two.</p></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  document.querySelector('#chat').prepend(row);
  window.__reads = [];
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForSelector('[data-message-id="m8"] .ptx-view', { timeout: 7000 }).catch(() => {});
const oldReads = await page2.evaluate(() => window.__reads.slice());
check('0.5.2 e: a message older than the opening read shows its stored translation (looked up on screen, small read)', (await page2.locator('[data-message-id="m8"] .ptx-view').count()) >= 1 && oldReads.every((n) => n !== null && n <= 500), JSON.stringify(oldReads));
// 모두 번역 (the user's own button) still reads up to 1000, and nothing is translated when the user cancels
await page2.evaluate(() => { window.__reads = []; });
await page2.locator('#tab .tpg-form [data-tpg-bulk]').click();
await page2.waitForSelector('.ptx-modal [data-no]', { timeout: 4000 }).catch(() => {});
const bulkReads = await page2.evaluate(() => window.__reads.slice());
check('0.5.2 cond 3: 모두 번역 (the user\'s button) keeps its read of up to 1000 rows', bulkReads.includes(1000), JSON.stringify(bulkReads));
await page2.locator('.ptx-modal [data-no]').click({ timeout: 1000 }).catch(() => {});
check('0.5.2 N2: the 후처리 후 번역 switch is not drawn (its input stays in the form)', (await page2.locator('#tab .tpg-form input[name="translateAfterPostProcessing"]').count()) === 1 && !(await page2.locator('#tab .tpg-form input[name="translateAfterPostProcessing"]').isVisible()));
const presetBefore = await page2.evaluate(() => [...document.querySelectorAll('#tab .tpg-form select[name$="PresetId"]')].map((s) => s.value));
check('0.5.2 a: "채팅 설정 유지" (the chat\'s own prompt) is still offered and selectable as the original has it', await page2.evaluate(() => [...document.querySelectorAll('#tab .tpg-form select[name="incomingPresetId"] option')].some((o) => o.value === 'builtin-inherit')), JSON.stringify(presetBefore));
await page2.evaluate(() => {
  window.__cleanup();
  for (let i = window.__messages.length - 1; i >= 0; i--) if (window.__messages[i].id === 'm8' || /^f\d+$/.test(window.__messages[i].id)) window.__messages.splice(i, 1);
  document.querySelector('[data-message-id="m8"]')?.remove();
});
await page2.evaluate(() => {
  // back to the settings the N6 checks below were written for
  window.__cleanup();
  window.__setStorage({ config: { defaults: { autoCollectEnabled: true, autoCollectEvery: 1, glossary: 'Mina = 미나' }, chats: { c1: { outgoingPresetId: 'custom-qa1', autoCollectEnabled: true, autoCollectEvery: 1, glossary: 'Mina = 미나' } }, presets: [{ id: 'custom-qa1', name: 'QA prompt', prompt: 'CUSTOM-OUT-PROMPT for {{targetLanguage}}.' }] } });
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForTimeout(500);

// ---- N6: "내 메시지 번역" through the original's own /api/translate handling ----
await page2.evaluate(() => {
  window.__posted = [];
  const real = window.fetch;
  window.__realFetch = real;
});
let sentBody = null;
page2.on('request', (r) => { if (r.method() === 'POST' && /\/api\/v1\/chats\/c1\/messages$/.test(r.url())) sentBody = r.postData(); });
const quiet2 = await page2.evaluate(() => window.__quiet.length);
await page2.evaluate(() => fetch('/api/v1/chats/c1/messages', { method: 'POST', body: JSON.stringify({ is_user: true, content: '안녕, Mina 씨.' }) }).catch(() => {}));
await page2.waitForTimeout(1500);
const outgoingCall = await page2.evaluate((n) => window.__quiet.slice(n).find((c) => c.messages.some((m) => /^Translate the following text to English/.test(m.content))), quiet2);
check('N6: my message is translated by the original request handling (target language, glossary from the original config)', !!outgoingCall && outgoingCall.messages.some((m) => m.content.includes('Mina') && m.content.includes('미나')), JSON.stringify(outgoingCall?.messages?.map((m) => m.content.slice(0, 80))));
check('N6: the translated text is what is sent to the chat', !!sentBody && JSON.parse(sentBody).content.startsWith('EN: '), String(sentBody).slice(0, 120));

// the chat's own prompt must not follow the user into another chat that keeps the default
check('N6: the 유저 입력 번역 프롬프트 chosen for this chat (a preset) is the one used', !!outgoingCall && outgoingCall.messages.some((m) => m.role === 'system' && m.content.includes('CUSTOM-OUT-PROMPT for English')), JSON.stringify(outgoingCall?.messages?.map((m) => m.content.slice(0, 60))));
await page2.evaluate(() => history.pushState({}, '', '/chat/c2'));
await page2.waitForTimeout(2500);
const quiet3 = await page2.evaluate(() => window.__quiet.length);
await page2.evaluate(() => fetch('/api/v1/chats/c2/messages', { method: 'POST', body: JSON.stringify({ is_user: true, content: '안녕하세요.' }) }).catch(() => {}));
await page2.waitForTimeout(1500);
const secondChatCall = await page2.evaluate((n) => window.__quiet.slice(n).find((c) => c.messages.some((m) => /^Translate the following text to English/.test(m.content))), quiet3);
check('N6: in another chat that keeps the default prompt, the first chat\'s preset is gone', !!secondChatCall && !secondChatCall.messages.some((m) => m.content.includes('CUSTOM-OUT-PROMPT')), JSON.stringify(secondChatCall?.messages?.map((m) => m.content.slice(0, 60))));
check('integrated: no page errors', errors2.length === 0, errors2.slice(0, 3).join(' | '));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`${failures.length ? 'FAILED' : 'OK'} (${failures.length} failing); screenshots in ${shots}`);
process.exit(failures.length ? 1 : 0);
