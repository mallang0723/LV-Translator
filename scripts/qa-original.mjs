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
page.setDefaultTimeout(6000);
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
  window.__patchMode = 'ok'; window.__stored = () => stored;
  const storage = { get: async () => ({ config: stored }), patch: async (p) => {
    // 'lost': the write happens but the answer never comes back; 'hang': neither (0.5.3: the original's save must still end)
    if (window.__patchMode === 'hang') return new Promise(() => {});
    if (p.config) stored = p.config;
    if (window.__patchMode === 'lost') return new Promise(() => {});
    return { config: stored };
  } };
  document.querySelector('#settings').append(LVEmu.createSettingsHost());
  window.__emu = LVEmu.startOriginal({
    bridge, storage, storageTimeoutMs: 600, activeChatId: () => 'c1',
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


// ---- 0.5.3: the save button always ends, and its label can be read ----

// ---- 0.5.3 (2): every button of the original shows its label: walk the settings form, the bar, the compare window and the confirm dialog in 4 themes ----
const THEMES = [
  ['dark / purple primary', { '--lumiverse-bg': '#1b1b22', '--lumiverse-text': '#dddddd', '--lumiverse-text-muted': '#9a9aa6', '--lumiverse-border': '#3a3a46', '--lumiverse-fill-subtle': '#2a2a33', '--lumiverse-primary': 'rgba(147,112,219,.9)', '--lumiverse-primary-text': 'rgba(186,135,255,.95)' }, '#1b1b22', '#dddddd'],
  ['dark / light-blue primary', { '--lumiverse-bg': '#1b1b22', '--lumiverse-text': '#dddddd', '--lumiverse-text-muted': '#9a9aa6', '--lumiverse-border': '#3a3a46', '--lumiverse-fill-subtle': '#2a2a33', '--lumiverse-primary': '#a8d4f0', '--lumiverse-primary-text': '#bcdcf5' }, '#1b1b22', '#dddddd'],
  ['light / light-blue primary', { '--lumiverse-bg': '#ffffff', '--lumiverse-text': '#222222', '--lumiverse-text-muted': '#666666', '--lumiverse-border': '#cccccc', '--lumiverse-fill-subtle': '#eeeeee', '--lumiverse-primary': '#a8d4f0', '--lumiverse-primary-text': '#2a6fb0' }, '#ffffff', '#222222'],
  ['light / navy primary', { '--lumiverse-bg': '#ffffff', '--lumiverse-text': '#222222', '--lumiverse-text-muted': '#666666', '--lumiverse-border': '#cccccc', '--lumiverse-fill-subtle': '#eeeeee', '--lumiverse-primary': '#1d2f6f', '--lumiverse-primary-text': '#1d2f6f' }, '#ffffff', '#222222'],
];
const setTheme = async ([, vars, bg, fg]) => { await page.evaluate(([v, b, f]) => { for (const [k, val] of Object.entries(v)) document.documentElement.style.setProperty(k, val); document.body.style.background = b; document.body.style.color = f; }, [vars, bg, fg]); await page.waitForTimeout(450); };
const lowContrastButtons = () => page.evaluate(() => {
  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (css) => { canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = '#000'; canvas.fillStyle = css; canvas.fillRect(0, 0, 1, 1); const d = canvas.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat([1]);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const bad = []; let seen = 0;
  const sel = '.ptx-modal-root button, .tpg-form button, .ptx-bar button, .ptx-toasts button, .ptx-menu button, .ptx-view button';
  for (const b of document.querySelectorAll(sel)) {
    const label = b.textContent.trim();
    if (!label || !b.getClientRects().length || getComputedStyle(b).visibility === 'hidden') continue;
    seen++;
    let bg = rgba(getComputedStyle(document.body).backgroundColor); if (bg[3] === 0) bg = [255, 255, 255, 1];
    const chain = []; for (let e = b; e; e = e.parentElement) chain.unshift(e);
    for (const e of chain) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) bg = over(c, bg); }
    const fg = over(rgba(getComputedStyle(b).color), bg);
    const [hi, lo] = [L(fg), L(bg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < 3) bad.push(`${label.slice(0, 14)} ${ratio.toFixed(1)}:1 (${getComputedStyle(b).color} on ${getComputedStyle(b).backgroundColor})`);
  }
  return { seen, bad };
});
for (const theme of THEMES) {
  await setTheme(theme);
  const r = await lowContrastButtons();
  check(`0.5.3 (2): all ${r.seen} buttons of the original (form, bar, compare window) have a readable label: ${theme[0]}`, r.seen >= 8 && r.bad.length === 0, r.bad.join(' | '));
}
await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.ptx-modal-root').forEach((e) => e.remove()));
await page.locator('.ptx-bar [data-ptx-act="clear"]').click().catch(() => {});
await page.waitForSelector('.ptx-modal [data-yes]', { timeout: 3000 }).catch(() => {});
check('0.5.3 (2): the confirm dialog ("이 메시지의 문단 번역을 지울까요?") opened for the check', (await page.locator('.ptx-modal [data-yes]').count()) === 1);
for (const theme of THEMES) {
  await setTheme(theme);
  const r = await lowContrastButtons();
  const yes = await page.locator('.ptx-modal [data-yes]').textContent();
  check(`0.5.3 (2): the confirm dialog's primary button label is readable ("${yes.trim()}"): ${theme[0]}`, r.bad.length === 0 && yes.trim().length > 0, r.bad.join(' | '));
}
await page.locator('.ptx-modal [data-no]').click().catch(() => {});
await page.evaluate(() => { for (const k of ['--lumiverse-bg', '--lumiverse-text', '--lumiverse-text-muted', '--lumiverse-border', '--lumiverse-fill-subtle', '--lumiverse-primary', '--lumiverse-primary-text']) document.documentElement.style.removeProperty(k); document.body.style.background = '#1b1b22'; document.body.style.color = '#ddd'; });

await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.ptx-modal-root .ptx-scrim').forEach((e) => e.click()));
await page.evaluate(() => document.querySelectorAll('.ptx-modal-root').forEach((e) => e.remove()));
const savePage = async () => { await page.locator('.tpg-save').click(); };
const statusText = () => page.locator('.tpg-form [data-tpg-status]').first().textContent();
const btnText = () => page.locator('.tpg-save').textContent();
await page.locator('.tpg-form textarea[name="freeContext"]').evaluate((e) => { e.value = '현대 한국 배경'; });
await page.locator('.tpg-form input[name="freeContextEnabled"]').evaluate((e) => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
await savePage();
await page.waitForFunction(() => /저장했습니다|응답이 없습니다/.test(document.querySelector('.tpg-form [data-tpg-status]')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
check('0.5.3 (1): a normal save ends with "저장했습니다." and the button is "저장" again', (await statusText()) === '저장했습니다.' && (await btnText()) === '저장' && !(await page.locator('.tpg-save').isDisabled()));
await page.evaluate(() => { window.__patchMode = 'lost'; });
await page.locator('.tpg-form textarea[name="freeContext"]').evaluate((e) => { e.value = '중세 판타지 배경'; });
await savePage();
await page.waitForFunction(() => /저장했습니다|응답이 없습니다/.test(document.querySelector('.tpg-form [data-tpg-status]')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
check('0.5.3 (1): the answer to the save is lost on the way but the data was written: the save still ends "저장했습니다." (read back)', (await statusText()) === '저장했습니다.' && (await btnText()) === '저장' && !(await page.locator('.tpg-save').isDisabled()), `${await statusText()} / ${await btnText()}`);
await page.evaluate(() => { window.__patchMode = 'ok'; });
await page.locator('.tpg-form textarea[name="freeContext"]').evaluate((e) => { e.value = '세 번째 기타 지침'; });
await savePage();
await page.waitForFunction(() => window.__stored()?.defaults?.freeContext === '세 번째 기타 지침' || window.__stored()?.chats?.c1?.freeContext === '세 번째 기타 지침', null, { timeout: 4000 }).catch(() => {});
check('0.5.3 (3): the 기타 지침 saved after a save whose answer was lost is written too (the write queue is not stuck behind it)', await page.evaluate(() => { const c = window.__stored(); return c?.chats?.c1?.freeContext === '세 번째 기타 지침'; }), JSON.stringify(await page.evaluate(() => window.__stored()?.chats?.c1?.freeContext)));
await page.evaluate(() => { window.__patchMode = 'hang'; });
await page.locator('.tpg-form textarea[name="freeContext"]').evaluate((e) => { e.value = '저장되지 않을 네 번째 지침'; });
await savePage();
await page.waitForFunction(() => /응답이 없습니다|저장했습니다/.test(document.querySelector('.tpg-form [data-tpg-status]')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
check('0.5.3 (1): a save nobody answers ends with the original\'s error line, and the button is "저장" and enabled again', /응답이 없습니다/.test(await statusText()) && (await page.locator('.tpg-form [data-tpg-status]').first().getAttribute('data-kind')) === 'error' && (await btnText()) === '저장' && !(await page.locator('.tpg-save').isDisabled()), `${await statusText()} / ${await btnText()}`);
await page.evaluate(() => { window.__patchMode = 'ok'; });
await savePage();
await page.waitForFunction(() => /저장했습니다/.test(document.querySelector('.tpg-form [data-tpg-status]')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
check('0.5.3 (1): and the next save works again', (await statusText()) === '저장했습니다.');

const contrast = () => page.evaluate(() => {
  const b = document.querySelector('.tpg-save');
  const probe = (css) => { const c = document.createElement('canvas').getContext('2d'); c.clearRect(0, 0, 1, 1); c.fillStyle = css; c.fillRect(0, 0, 1, 1); const [r, g, bl, a] = c.getImageData(0, 0, 1, 1).data; return [r, g, bl, a]; };
  const cs = getComputedStyle(b);
  const page = probe(getComputedStyle(document.body).backgroundColor);
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * (fg[3] / 255) + bg[i] * (1 - fg[3] / 255));
  const bg = over(probe(cs.backgroundColor), page); const fg = over(probe(cs.color), bg);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const [hi, lo] = [L(fg), L(bg)].sort((x, y) => y - x);
  return { ratio: (hi + 0.05) / (lo + 0.05), color: cs.color, bg: cs.backgroundColor, text: b.textContent };
});
for (const [name, vars, pageBg] of [
  ['dark theme, light-blue primary (the user\'s screenshot)', { '--lumiverse-primary': '#a8d4f0', '--lumiverse-primary-text': 'rgba(186,215,255,.95)', '--lumiverse-bg': '#1b1b22' }, '#1b1b22'],
  ['dark theme, purple primary', { '--lumiverse-primary': 'rgba(147,112,219,.9)', '--lumiverse-primary-text': 'rgba(186,135,255,.95)', '--lumiverse-bg': '#1b1b22' }, '#1b1b22'],
  ['light theme, light-blue primary', { '--lumiverse-primary': '#a8d4f0', '--lumiverse-primary-text': '#2a6fb0', '--lumiverse-bg': '#ffffff' }, '#ffffff'],
  ['light theme, dark navy primary', { '--lumiverse-primary': '#1d2f6f', '--lumiverse-primary-text': '#1d2f6f', '--lumiverse-bg': '#ffffff' }, '#ffffff'],
]) {
  await page.evaluate(([v, bgc]) => { for (const [k, val] of Object.entries(v)) document.documentElement.style.setProperty(k, val); document.body.style.background = bgc; }, [vars, pageBg]);
  await page.waitForTimeout(400);
  const on = await contrast();
  await page.locator('.tpg-save').evaluate((b) => { b.disabled = true; });
  const off = await contrast();
  await page.locator('.tpg-save').evaluate((b) => { b.disabled = false; });
  check(`0.5.3 (2): the save label is readable: ${name} (enabled ${on.ratio.toFixed(1)}:1, disabled ${off.ratio.toFixed(1)}:1)`, on.text === '저장' && on.ratio >= 4 && off.ratio >= 4, JSON.stringify(on));
}
await page.evaluate(() => { for (const k of ['--lumiverse-primary', '--lumiverse-primary-text', '--lumiverse-bg']) document.documentElement.style.removeProperty(k); document.body.style.background = '#1b1b22'; });

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
page2.setDefaultTimeout(6000);
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
      // keeps every ⟦n⟧ protection marker it was given (the 제외 규칙 mask)
      if (ids.length) return { content: [...user.matchAll(/<segment id="(\d+)">\n?([\s\S]*?)\n?<\/segment>/g)].map((m) => `<segment id="${m[1]}">번역 ${m[1]}${/(?:Farseer|Scout|Scribe)\|/.test(m[2]) ? ' **번역|** "번역"' : /<x\d+>/.test(m[2]) ? ' ' + m[2].replace(/(<\/?x\d+>)|(⟪\d+⟫)|([^<⟪]+)/g, (a, t, at, tx) => (tx ? (/\S/.test(tx) ? tx.replace(/[A-Za-z][^"“”|]*/g, '번역') : tx) : a)) : ''}${(m[2].match(/⟦\d+⟧/g) || []).map((k) => ' ' + k).join('')}</segment>`).join('\n') };
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
      if (msg.type === 'hello') return reply({ type: 'state', store: window.__lvStore ||= LVInt.normalizeStore({ defaults: { translateMyMessages: true, modelLanguage: 'English' } }), connections: [{ id: 'conn1', name: 'Fake', model: 'none', isDefault: true }], link: 'none' });
      if (msg.type !== 'emu') return;
      await new Promise((r) => setTimeout(r, 0)); // a real backend answers later
      try {
        let data;
        if (msg.op === 'lease') data = !(window.__leased ||= new Set()).has(msg.args[0]) && !!window.__leased.add(msg.args[0]);
        else if (msg.op === 'lv.save') {
          if (window.__lvFail) throw new Error('연결 설정을 저장하지 못했습니다.');
          const a = msg.args[0]; (window.__lvSaves ||= []).push(a);
          const base = window.__lvStore || LVInt.normalizeStore(null);
          window.__lvStore = LVInt.normalizeStore({ ...base, defaults: a.asDefault || !a.chatId ? a.settings : base.defaults, chats: a.chatId ? { ...base.chats, [a.chatId]: a.settings } : base.chats });
          data = true;
          setTimeout(() => reply({ type: 'state', store: window.__lvStore, connections: [{ id: 'conn1', name: 'Fake', model: 'none', isDefault: true }], link: 'none' }), 0);
        }
        else if (msg.op === 'storage.get') data = storage; else if (msg.op === 'storage.patch') data = storage = { ...storage, ...msg.args[0] };
        else data = await ops[msg.op](...(msg.op === 'generateRaw' || msg.op === 'translate' ? [msg.args[0], msg.id] : msg.args));
        reply({ type: 'emu_result', id: msg.id, ok: true, data });
      } catch (e) { reply({ type: 'emu_result', id: msg.id, ok: false, error: String(e.message || e) }); }
    },
  };
  localStorage.setItem('translation-presets-glossary-debug', '1'); window.__ops = ops; window.__reply = reply; window.__ctx = ctx; window.__dbg = true; window.__setStorage = (v) => { storage = v; }; window.__getStorage = () => storage; window.__emit = (name, p) => (window.__handlers?.[name] || []).forEach((h) => h(p)); window.__messages = messages; window.__cleanup = LVInt.setup(ctx);
});
await page2.waitForTimeout(2500);
if (process.env.QA_DEBUG) console.log(await page2.evaluate(() => JSON.stringify({ tab: document.querySelector('#tab')?.innerHTML.slice(0, 400), ls: [...document.querySelectorAll('.mari-message-actions')].length, sec: document.querySelectorAll('[data-chat-settings-section]').length, w: window.__writes })));
check('integrated: original settings screen shows inside the extension tab', (await page2.locator('#tab .tpg-form').count()) === 1);
// ---- 0.5.3: one settings panel. Our own settings are sections inside the original's form, with one save button ----
check('0.5.3 merge: one panel only (no separate LV panel: no stt-section, no second save row)', (await page2.locator('#tab .stt-section, #tab .stt-row, #tab h3').count()) === 0 && (await page2.locator('#tab form.tpg-form').count()) === 1 && (await page2.locator('#tab .tpg-save').count()) === 1);
check('0.5.3 merge: the LV sections (연결·언어, 번역하지 않을 부분, 지침 묶음) are inside the original form, above its save bar', await page2.evaluate(() => {
  const f = document.querySelector('#tab form.tpg-form'); const secs = [...f.querySelectorAll('[data-lv-section]')]; const bar = f.querySelector('.tpg-savebar');
  return secs.length === 3 && secs.every((x) => x.classList.contains('tpg-group') && x.querySelector('h5') && !!(x.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING));
}));
check('0.5.3 merge: the LV fields show the saved values (모델 언어 English, 내 메시지 번역 on)', (await page2.locator('#tab [name="lv:modelLanguage"]').inputValue()) === 'English' && (await page2.locator('#tab [name="lv:translateMyMessages"]').isChecked()));
check('0.5.3 merge: the LV switches are drawn with the original\'s switch markup and are painted by it', await page2.evaluate(() => { const r = document.querySelector('#tab [data-lv-switch="translateMyMessages"]'); return r.hasAttribute('data-tpg-switch') && r.classList.contains('bg-[var(--primary)]/10') && !!r.querySelector('[data-settings-switch-track]'); }));
await page2.screenshot({ path: join(shots, '05-merged-settings-mobile.png'), fullPage: true });
await page2.evaluate(() => { const r = document.documentElement.style; r.setProperty('--lumiverse-bg', '#ffffff'); r.setProperty('--lumiverse-text', '#222'); r.setProperty('--lumiverse-text-muted', '#666'); r.setProperty('--lumiverse-border', '#ccc'); r.setProperty('--lumiverse-fill-subtle', '#eee'); r.setProperty('--lumiverse-primary', '#a8d4f0'); document.body.style.background = '#fff'; document.body.style.color = '#222'; });
await page2.waitForTimeout(400);
await page2.screenshot({ path: join(shots, '06-merged-settings-light.png'), fullPage: true });
await page2.evaluate(() => { const r = document.documentElement.style; for (const k of ['--lumiverse-bg', '--lumiverse-text', '--lumiverse-text-muted', '--lumiverse-border', '--lumiverse-fill-subtle', '--lumiverse-primary']) r.removeProperty(k); document.body.style.background = '#1b1b22'; document.body.style.color = '#ddd'; });
// one click saves both: an LV field and the original's own 기타 지침
await page2.locator('#tab [name="lv:modelLanguage"]').fill('Japanese');
await page2.locator('#tab [data-lv-switch="autoTranslate"] label').first().click();
await page2.locator('#tab .tpg-form textarea[name="freeContext"]').evaluate((e) => { e.value = '현대 한국 배경'; });
await page2.locator('#tab .tpg-form input[name="freeContextEnabled"]').evaluate((e) => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
await page2.locator('#tab .tpg-save').click();
await page2.waitForFunction(() => document.querySelector('#tab [data-tpg-status]')?.textContent === '저장했습니다.', null, { timeout: 5000 }).catch(() => {});
const savedLv = await page2.evaluate(() => window.__lvSaves?.at(-1));
const savedTt = await page2.evaluate(() => window.__getStorage()?.config);
check('0.5.3 merge: one click saves our values (via lv.save)', savedLv?.settings?.modelLanguage === 'Japanese' && savedLv?.settings?.autoTranslate === true, JSON.stringify(savedLv?.settings?.modelLanguage));
check('0.5.3 merge: and the original\'s own values in the same click (기타 지침 in the original\'s file)', JSON.stringify(savedTt || {}).includes('현대 한국 배경'));
check('0.5.3 merge: the status line and button are the original\'s ("저장했습니다.", "저장")', (await page2.locator('#tab [data-tpg-status]').textContent()) === '저장했습니다.' && (await page2.locator('#tab .tpg-save').textContent()) === '저장');
await page2.evaluate(() => { window.__cleanup(); window.__cleanup = LVInt.setup(window.__ctx); });
await page2.waitForSelector('#tab .tpg-form [data-lv-section]', { timeout: 6000 }).catch(() => {});
await page2.waitForTimeout(800);
check('0.5.3 merge: after a reload both are still there (LV 모델 언어, original 기타 지침, 자동 번역 switch)', (await page2.locator('#tab [name="lv:modelLanguage"]').inputValue()) === 'Japanese' && (await page2.locator('#tab .tpg-form textarea[name="freeContext"]').inputValue()) === '현대 한국 배경' && (await page2.locator('#tab [name="lv:autoTranslate"]').isChecked()), `${await page2.locator('#tab [name="lv:modelLanguage"]').inputValue()} / ${await page2.locator('#tab .tpg-form textarea[name="freeContext"]').inputValue()}`);
check('0.5.3 merge: the form is not drawn twice after a re-render (one set of LV sections)', (await page2.locator('#tab [data-lv-section]').count()) === 3);
// an LV save error is shown by the original's status line; the button comes back; the original's own save is not run
await page2.evaluate(() => { window.__lvFail = true; });
await page2.locator('#tab [name="lv:modelLanguage"]').fill('Korean');
const patchesBefore = JSON.stringify(await page2.evaluate(() => window.__getStorage()?.config?.defaults?.freeContext));
await page2.locator('#tab .tpg-save').click();
await page2.waitForFunction(() => /저장하지 못했습니다/.test(document.querySelector('#tab [data-tpg-status]')?.textContent || ''), null, { timeout: 4000 }).catch(() => {});
check('0.5.3 merge: an LV save error appears in the original status line (error), the button is "저장" and enabled', (await page2.locator('#tab [data-tpg-status]').getAttribute('data-kind')) === 'error' && (await page2.locator('#tab .tpg-save').textContent()) === '저장' && !(await page2.locator('#tab .tpg-save').isDisabled()), await page2.locator('#tab [data-tpg-status]').textContent());
await page2.evaluate(() => { window.__lvFail = false; window.__lvStore = null; });

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

// ---- 0.5.3 (4): a Lumiverse long message ("더보기") keeps opening after the original shows a fresh translation ----
// Host-like markup and behaviour from Lumiverse's MessageContent.tsx: a viewport with a max height and overflow hidden around the body;
// a React-owned toggle button after it that exists only while the BODY measures taller than the max height (measure on mount and on
// every re-render, e.g. when the message is updated), and flips an expanded state when clicked.
await page2.evaluate(() => history.pushState({}, '', '/chat/c1'));
await page2.waitForTimeout(1500);
await page2.evaluate(() => {
  window.__cleanup();
  const paras = Array.from({ length: 14 }, (_, i) => `Long reply line number ${i + 1} of the scene.`);
  const t = Math.floor(Date.now() / 1000);
  window.__messages.push({ id: 'm9', role: 'assistant', content: paras.join('\n\n'), swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: t + 500, swipe_dates: [t + 500] });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm9');
  row.innerHTML = '<div><div data-component="MessageContent" id="mc9"><div class="lm-viewport" style="position:relative;overflow:hidden;max-height:90px"><div class="lm-body" style="display:flow-root">' + paras.map((x) => `<p>${x}</p>`).join('') + '<details class="lm-details"><summary>상태창</summary><div>HP 10</div></details></div></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  document.querySelector('#chat').append(row);
  const root = row.querySelector('[data-component="MessageContent"]');
  const state = { expanded: false };
  window.__lm = state;
  // the host's own measurement + toggle, as React does it (it always works on the REAL content node)
  window.__lmMeasure = () => {
    const vp = root.querySelector('.lm-viewport'); const body = root.querySelector('.lm-body');
    const over = !state.expanded ? Math.max(body.scrollHeight, body.offsetHeight) > 90 : root.querySelector('[data-long-message-toggle]') !== null;
    vp.style.maxHeight = state.expanded ? '' : '90px';
    let tg = root.querySelector(':scope > [data-long-message-toggle]');
    if (over && !tg) {
      tg = document.createElement('button'); tg.type = 'button'; tg.setAttribute('data-long-message-toggle', 'true');
      // React attaches handlers through its own bookkeeping on the node: a cloned copy of this button has none
      tg.__react = true;
      tg.addEventListener('click', (e) => { if (!e.currentTarget.__react) return; state.expanded = !state.expanded; window.__lmMeasure(); });
      root.append(tg);
    } else if (!over && tg) tg.remove();
    if (tg) tg.textContent = state.expanded ? '접기' : '더보기';
  };
  window.__lmMeasure();
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForTimeout(2000);
const lmToggleCount = () => page2.evaluate(() => document.querySelectorAll('[data-message-id="m9"] [data-long-message-toggle]').length);
const lmVisible = () => page2.evaluate(() => {
  // what the user can click: the toggle that is not inside display:none / visibility:hidden
  return [...document.querySelectorAll('[data-message-id="m9"] [data-long-message-toggle]')].filter((b) => { const r = b.getBoundingClientRect(); return b.checkVisibility?.({ visibilityProperty: true }) !== false && r.width > 0 && r.height > 0; }).map((b) => ({ text: b.textContent, inView: !!b.closest('.ptx-view') }));
});
check('0.5.3 (4) setup: before translating, the long message has its 더보기 button', (await lmVisible()).length === 1 && (await lmVisible())[0].text === '더보기', JSON.stringify(await lmVisible()));
await page2.locator('[data-message-id="m9"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForSelector('[data-message-id="m9"] .ptx-view', { timeout: 8000 }).catch(() => {});
await page2.waitForTimeout(600);
// the host re-renders the message after the translation is saved (message updated): it measures again
await page2.evaluate(() => window.__lmMeasure());
await page2.waitForTimeout(600);
let vis = await lmVisible();
check('0.5.3 (4): after a fresh translation, a 더보기 button is on screen (in the translated view)', vis.length === 1 && vis[0].text === '더보기' && vis[0].inView, JSON.stringify(vis));
await page2.screenshot({ path: join(shots, '07-long-message-translated.png'), fullPage: true });
const viewHeight = () => page2.evaluate(() => document.querySelector('[data-message-id="m9"] .ptx-view .lm-viewport')?.getBoundingClientRect().height ?? -1);
const h0 = await viewHeight();
await page2.locator('[data-message-id="m9"] .ptx-view [data-long-message-toggle]').click({ timeout: 2000 }).catch(() => {});
await page2.waitForTimeout(700);
const h1 = await viewHeight();
vis = await lmVisible();
check('0.5.3 (4): 더보기 opens the translated message (taller) and the button turns into 접기', h1 > h0 + 40 && vis.length === 1 && vis[0].text === '접기', `${h0} -> ${h1} ${JSON.stringify(vis)}`);
await page2.locator('[data-message-id="m9"] .ptx-view [data-long-message-toggle]').click({ timeout: 2000 }).catch(() => {});
await page2.waitForTimeout(700);
const h2 = await viewHeight();
check('0.5.3 (4): 접기 closes it again', h2 < h1 - 40 && (await lmVisible())[0]?.text === '더보기', `${h1} -> ${h2}`);
// the original's <details> inside the translated view still toggles
await page2.locator('[data-message-id="m9"] .ptx-view details summary').click({ timeout: 2000 }).catch(() => {});
const d1 = await page2.evaluate(() => document.querySelector('[data-message-id="m9"] .ptx-view details')?.open);
await page2.locator('[data-message-id="m9"] .ptx-view details summary').click({ timeout: 2000 }).catch(() => {});
const d2 = await page2.evaluate(() => document.querySelector('[data-message-id="m9"] .ptx-view details')?.open);
check('0.5.3 (4) guard: a <details> block in the translated message still opens and closes', d1 === true && d2 === false, `${d1}/${d2}`);
// show original -> show translation: the native translate button toggles the view
const nativeBtn = page2.locator('[data-message-id="m9"] .mari-message-actions button:has(svg.lucide-languages)');
await nativeBtn.click();
await page2.waitForTimeout(700);
await page2.evaluate(() => window.__lmMeasure());
vis = await lmVisible();
check('0.5.3 (4): showing the original, the host\'s own 더보기 is back and works', (await page2.locator('[data-message-id="m9"] .ptx-view').count()) === 0 && vis.length === 1 && !vis[0].inView, JSON.stringify(vis));
await page2.locator('[data-message-id="m9"] [data-long-message-toggle]').click({ timeout: 2000 }).catch(() => {});
await page2.waitForTimeout(400);
check('0.5.3 (4): the original opens with it (접기)', (await lmVisible())[0]?.text === '접기');
await page2.locator('[data-message-id="m9"] [data-long-message-toggle]').click({ timeout: 2000 }).catch(() => {});
await nativeBtn.click();
await page2.waitForSelector('[data-message-id="m9"] .ptx-view', { timeout: 5000 }).catch(() => {});
await page2.waitForTimeout(600);
await page2.evaluate(() => window.__lmMeasure());
await page2.waitForTimeout(400);
vis = await lmVisible();
await page2.locator('[data-message-id="m9"] .ptx-view [data-long-message-toggle]').click({ timeout: 2000 }).catch(() => {});
await page2.waitForTimeout(700);
check('0.5.3 (4): back to the translation, 더보기 still opens it', vis.length === 1 && vis[0].inView && (await lmVisible())[0]?.text === '접기', JSON.stringify(vis));
// a message that is not collapsed is unaffected
check('0.5.3 (4): a short (not collapsed) message has no toggle and still translates (m1 view present or none)', (await page2.locator('[data-message-id="m1"] [data-long-message-toggle]').count()) === 0);
await page2.evaluate(() => { document.querySelector('[data-message-id="m9"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm9'), 1); });

// ---- 0.5.3 (7): HTML islands (status windows, cards, <details>) stay in the translated view, in place, and still open ----
await page2.evaluate(() => {
  window.__cleanup();
  const t = Math.floor(Date.now() / 1000);
  const parts = [
    { p: 'The first paragraph of the scene.' },
    { island: '<details class="st"><summary>상태창 A</summary><div class="body">HP 10 / MP 5</div></details>' },
    { p: 'The second paragraph, between two windows.' },
    { island: '<details class="st"><summary>상태창 B</summary><div>Gold 30</div></details><div class="card" style="border:1px solid #888;padding:4px">CARD: Mina, Lv 3</div>' },
    { p: 'The third paragraph closes the scene.' },
    { island: '<details class="st"><summary>상태창 C</summary><div>Day 4</div></details>' },
  ];
  const content = parts.map((x) => x.p ?? x.island).join('\n\n');
  window.__messages.push({ id: 'm11', role: 'assistant', content, swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: t + 700, swipe_dates: [t + 700] });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm11');
  row.innerHTML = '<div><div data-component="MessageContent"><div class="body11"></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  const body = row.querySelector('.body11');
  for (const x of parts) {
    if (x.p) { const p = document.createElement('p'); p.textContent = x.p; body.append(p); }
    else { const d = document.createElement('div'); d.setAttribute('data-lumiverse-html-island', ''); d.attachShadow({ mode: 'open' }).innerHTML = x.island; body.append(d); }
  }
  document.querySelector('#chat').append(row);
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForTimeout(1500);
const islandInfo = (scope) => page2.evaluate((sc) => [...document.querySelectorAll(`[data-message-id="m11"] ${sc} [data-lumiverse-html-island]`)].map((e) => ({ has: !!e.shadowRoot, html: e.shadowRoot?.innerHTML ?? '', open: [...(e.shadowRoot?.querySelectorAll('details') ?? [])].map((d) => d.open) })), scope);
await page2.locator('[data-message-id="m11"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForSelector('[data-message-id="m11"] .ptx-view', { timeout: 8000 }).catch(() => {});
await page2.waitForTimeout(900);
const vi = await islandInfo('.ptx-view');
const hi = await islandInfo('.mari-message-content:not(.ptx-view)');
check('0.5.3 (7): the translated view shows all 3 status/card blocks (before, between and after the prose) with the same <details> as the original', vi.length === 3 && vi.every((x, i) => x.has && x.html.length > 20 && (x.html.match(/<details/g) || []).length === (hi[i]?.html.match(/<details/g) || []).length), JSON.stringify(vi.map((x) => x.has && x.html.length)));
check('0.5.3 (7): the card block is kept (still a div.card, translated, in place after the 2nd paragraph)', /class="card"/.test(vi[1]?.html ?? '') && vi[1].html.includes('번역'));
const m11units = await page2.evaluate(() => document.querySelectorAll('[data-message-id="m11"] .ptx-view .ptx-u[data-k]').length);
check('0.5.3 (7): the prose around the blocks is translated (3 paragraphs)', m11units === 3, `${m11units} ` + await page2.evaluate(() => JSON.stringify([...document.querySelectorAll('[data-message-id="m11"] .ptx-view .ptx-u[data-k]')].map((u) => (u.closest('[data-lv-mirror]') ? 'M:' : u.parentElement.tagName + ':') + u.textContent.slice(0, 18)))));
check('0.5.3 (7): the blocks sit between the paragraphs in the original order', await page2.evaluate(() => { const kids = [...document.querySelector('[data-message-id="m11"] .ptx-view .body11').children].map((e) => e.hasAttribute('data-lumiverse-html-island') ? 'I' : 'P'); return kids.join('') === 'PIPIPI' || kids.join('') === 'SISISI' || kids.join('').replace(/[^IPS]/g, '').replace(/[PS]/g, 'P') === 'PIPIPI'; }));
await page2.screenshot({ path: join(shots, '08-islands-translated.png'), fullPage: true });
const toggled = await page2.evaluate(() => {
  const res = [];
  for (const isl of document.querySelectorAll('[data-message-id="m11"] .ptx-view [data-lumiverse-html-island]')) for (const d of isl.shadowRoot.querySelectorAll('details')) { const a = d.open; d.querySelector('summary').click(); const b = d.open; d.querySelector('summary').click(); res.push([a, b, d.open]); }
  return res;
});
check('0.5.3 (7): every <details> in the translated view opens and closes again', toggled.length === 3 && toggled.every(([a, b, c]) => a === false && b === true && c === false), JSON.stringify(toggled));
await page2.locator('[data-message-id="m11"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForTimeout(900);
const orig1 = await islandInfo('.mari-message-content');
check('0.5.3 (7): showing the original, the real blocks are intact', (await page2.locator('[data-message-id="m11"] .ptx-view').count()) === 0 && orig1.length === 3 && orig1.every((x) => x.has && x.html.length > 20));
await page2.locator('[data-message-id="m11"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForSelector('[data-message-id="m11"] .ptx-view', { timeout: 5000 }).catch(() => {});
await page2.waitForTimeout(900);
const vi2 = await islandInfo('.ptx-view');
check('0.5.3 (7): back to the translation, the blocks are there again and still toggle', vi2.length === 3 && vi2.every((x) => x.has && x.html.length > 20) && await page2.evaluate(() => { const d = document.querySelector('[data-message-id="m11"] .ptx-view [data-lumiverse-html-island]').shadowRoot.querySelector('details'); d.querySelector('summary').click(); const o = d.open; d.querySelector('summary').click(); return o && !d.open; }));
await page2.evaluate(() => { document.querySelector('[data-message-id="m11"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm11'), 1); });

// ---- 0.5.3 (6): "이어서 번역" ----
await page2.evaluate(() => {
  window.__cleanup();
  const k = LVInt.blockKey;
  const paras = ['Alpha was already done.', 'Beta was already done.', 'Gamma was never translated.'];
  const rec = { v: 1, map: { [k(paras[0])]: '알파는 이미 됨', [k(paras[1])]: '베타는 이미 됨' }, edited: {}, view: '', at: 1 };
  const t = Math.floor(Date.now() / 1000);
  window.__messages.push({ id: 'm12', role: 'assistant', content: paras.join('\n\n'), swipes: ['x'], swipe_id: 0, extra: {}, metadata: { st_translator_tt: { 0: rec } }, send_date: t + 800, swipe_dates: [t + 800] });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm12');
  row.innerHTML = '<div><div data-component="MessageContent">' + paras.map((x) => `<p>${x}</p>`).join('') + '</div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  document.querySelector('#chat').append(row);
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForSelector('[data-message-id="m12"] .ptx-view', { timeout: 7000 }).catch(() => {});
await page2.waitForTimeout(900);
check('0.5.3 (6): a half-translated message shows the 이어서 번역 button in the original bar (with the original\'s 3 buttons)', (await page2.locator('[data-message-id="m12"] .ptx-bar [data-lv-act="continue"]').count()) === 1 && (await page2.locator('[data-message-id="m12"] .ptx-bar [data-ptx-act]').count()) === 3 && (await page2.locator('[data-message-id="m12"] .ptx-u.is-missing').count()) === 1);
check('0.5.3 (6): it is drawn like the original buttons (same classes as the 재번역 button)', await page2.evaluate(() => { const bar = document.querySelector('[data-message-id="m12"] .ptx-bar'); return bar.querySelector('[data-lv-act]').className === bar.querySelector('[data-ptx-act="retranslate"]').className; }));
check('0.5.3 (6): a fully translated message has no such button (m9-like complete messages)', (await page2.locator('[data-message-id="m1"] [data-lv-act="continue"]').count()) === 0);
const q0 = await page2.evaluate(() => window.__quiet.length);
await page2.locator('[data-message-id="m12"] [data-lv-act="continue"]').click();
await page2.waitForFunction(() => window.__messages.find((x) => x.id === 'm12').metadata?.st_translator_tt?.['0']?.map && Object.keys(window.__messages.find((x) => x.id === 'm12').metadata.st_translator_tt['0'].map).length >= 3, null, { timeout: 8000 }).catch(() => {});
await page2.waitForTimeout(800);
const sent = await page2.evaluate((n) => window.__quiet.slice(n).map((c) => c.messages.find((m) => m.role === 'user').content), q0);
check('0.5.3 (6): it translates only the missing paragraph, through the original\'s own request path', sent.length >= 1 && sent.every((u) => u.includes('Gamma was never translated.') && !u.includes('Alpha was already') && !u.includes('Beta was already')), JSON.stringify(sent).slice(0, 300));
check('0.5.3 (6): afterwards all 3 paragraphs have a translation and the button is gone', (await page2.locator('[data-message-id="m12"] .ptx-u.is-missing').count()) === 0 && (await page2.locator('[data-message-id="m12"] [data-lv-act="continue"]').count()) === 0 && (await page2.locator('[data-message-id="m12"] .ptx-u[data-k]').count()) === 3);
await page2.evaluate(() => { document.querySelector('[data-message-id="m12"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm12'), 1); });

// ---- 0.5.3 (8): 한 번에 번역할 글자수 ----
await page2.locator('#tab [name="lv:batchChars"]').fill('700');
await page2.locator('#tab .tpg-save').click();
await page2.waitForFunction(() => document.querySelector('#tab [data-tpg-status]')?.textContent === '저장했습니다.', null, { timeout: 5000 }).catch(() => {});
check('0.5.3 (8): the limit is saved with the one save button', (await page2.evaluate(() => window.__lvSaves?.at(-1)?.settings?.batchChars)) === 700);
await page2.evaluate(() => {
  window.__cleanup();
  const paras = Array.from({ length: 6 }, (_, i) => `Segment ${i + 1} ` + 'word '.repeat(60));
  const t = Math.floor(Date.now() / 1000);
  window.__messages.push({ id: 'm13', role: 'assistant', content: paras.join('\n\n'), swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: t + 900, swipe_dates: [t + 900] });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm13');
  row.innerHTML = '<div><div data-component="MessageContent">' + paras.map((x) => `<p>${x}</p>`).join('') + '</div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  document.querySelector('#chat').append(row);
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForTimeout(1500);
const q1 = await page2.evaluate(() => window.__quiet.length);
await page2.locator('[data-message-id="m13"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForFunction(() => Object.keys(window.__messages.find((x) => x.id === 'm13').metadata?.st_translator_tt?.['0']?.map || {}).length >= 6, null, { timeout: 10000 }).catch(() => {});
const calls13 = await page2.evaluate((n) => window.__quiet.slice(n).map((c) => c.messages.find((m) => m.role === 'user').content).filter((u) => /<segment id=/.test(u)).map((u) => [...u.matchAll(/<segment id="\d+">\n([\s\S]*?)\n<\/segment>/g)].reduce((a, m) => a + m[1].length, 0)), q1);
check('0.5.3 (8): a long message with the limit 700 is sent as several requests, each at or under 700 characters', calls13.length >= 3 && calls13.every((c) => c <= 700), JSON.stringify(calls13));
check('0.5.3 (8): and the result is the same as one request: all 6 paragraphs translated', Object.keys(await page2.evaluate(() => window.__messages.find((x) => x.id === 'm13').metadata?.st_translator_tt?.['0']?.map || {})).length === 6);
await page2.evaluate(() => { document.querySelector('[data-message-id="m13"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm13'), 1); });

// ---- 0.5.3 (9): excluded tags / rules are not sent and stay as the original text, in place, in every view mode ----
const EXCL_RULES = '/HP: \\d+\\/\\d+/\n[상태창] ... [/상태창]';
const setupExcl = async (viewMode) => {
  await page2.evaluate(([vm, rules]) => {
    window.__cleanup();
    const m14 = window.__messages.find((x) => x.id === 'm14'); if (m14) { m14.metadata = {}; m14.extra = {}; }
    window.__setStorage({ config: { paragraph: { keepTags: 'scene_plan my_card', viewMode: vm } } });
    window.__lvStore = LVInt.normalizeStore({ defaults: { translateMyMessages: true, modelLanguage: 'English', excludeRules: rules } });
    window.__cleanup = window.__LVSetup(window.__ctx);
  }, [viewMode, EXCL_RULES]);
  await page2.waitForTimeout(1800);
};
await page2.evaluate(() => {
  window.__cleanup();
  const lines = ['Intro paragraph of the scene.', 'Plan item A.', 'Plan item B.', 'Now HP: 10/20 remains in the body.', '[상태창] HP bar', 'MP bar [/상태창]', 'Card text here.', 'Closing paragraph here.'];
  const t = Math.floor(Date.now() / 1000);
  window.__messages.push({ id: 'm14', role: 'assistant', content: 'Intro paragraph of the scene.\n\n<scene_plan>\nPlan item A.\n\nPlan item B.\n</scene_plan>\n\nNow HP: 10/20 remains in the body.\n\n[상태창] HP bar\n\nMP bar [/상태창]\n\n<my_card>Card text here.</my_card>\n\nClosing paragraph here.', swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: t + 1000, swipe_dates: [t + 1000] });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm14');
  row.innerHTML = '<div><div data-component="MessageContent"><div class="b14">' + lines.map((x) => `<p>${x}</p>`).join('') + '</div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  document.querySelector('#chat').append(row);
  window.__cleanup = window.__LVSetup(window.__ctx);
});
const viewParas = () => page2.evaluate(() => [...document.querySelectorAll('[data-message-id="m14"] .ptx-view .b14 > p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()));
const sentSince = (n) => page2.evaluate((k) => window.__quiet.slice(k).map((c) => c.messages.find((m) => m.role === 'user').content).filter((u) => /<segment id=/.test(u)).join('\n'), n);
const NOT_SENT = ['Plan item', 'Card text here', 'HP bar', 'MP bar', 'HP: 10/20'];
for (const mode of ['tr', 'both']) {
  await setupExcl(mode);
  const q = await page2.evaluate(() => window.__quiet.length);
  await page2.locator('[data-message-id="m14"] .mari-message-actions button:has(svg.lucide-languages)').click();
  await page2.waitForSelector('[data-message-id="m14"] .ptx-view', { timeout: 8000 }).catch(() => {});
  await page2.waitForTimeout(1000);
  const sent = await sentSince(q);
  check(`0.5.3 (9) [${mode}]: excluded tags (scene_plan, my_card), the 상태창 range and the HP regex are not sent to the model`, sent.length > 0 && NOT_SENT.every((x) => !sent.includes(x)) && sent.includes('Intro paragraph') && sent.includes('Closing paragraph') && sent.includes('⟦1⟧'), sent.slice(0, 260));
  const paras = await viewParas();
  const has = (i, text) => (paras[i] ?? '').includes(text);
  const once = (text) => paras.filter((x) => x.includes(text)).length;
  check(`0.5.3 (9) [${mode}]: every excluded block is in the translated view as the original text, in its place and order (before, between and after prose)`, paras.length === 8 && has(0, '번역') && paras[1].startsWith('Plan item A.') && paras[2].startsWith('Plan item B.') && has(3, 'HP: 10/20') && has(3, '번역') && paras[4].startsWith('[상태창] HP bar') && paras[5].startsWith('MP bar [/상태창]') && paras[6].startsWith('Card text here.') && has(7, '번역'), JSON.stringify(paras));
  check(`0.5.3 (9) [${mode}]: no block is drawn twice (one copy of each excluded text)`, ['Plan item A.', 'Plan item B.', 'Card text here.'].every((t) => once(t) === 1), JSON.stringify(paras.map((x) => x.slice(0, 20))));
  if (mode === 'tr') await page2.screenshot({ path: join(shots, '09-excluded-in-place.png'), fullPage: true });
  // original / translation toggle cycle
  await page2.locator('[data-message-id="m14"] .mari-message-actions button:has(svg.lucide-languages)').click();
  await page2.waitForTimeout(700);
  const origOnly = await page2.evaluate(() => [...document.querySelectorAll('[data-message-id="m14"] .b14 > p')].filter((p) => !p.closest('.ptx-view')).map((p) => p.textContent.trim()));
  check(`0.5.3 (9) [${mode}]: showing the original, every paragraph is the original text`, (await page2.locator('[data-message-id="m14"] .ptx-view').count()) === 0 && origOnly.length === 8 && origOnly[1] === 'Plan item A.' && origOnly[7] === 'Closing paragraph here.');
  await page2.locator('[data-message-id="m14"] .mari-message-actions button:has(svg.lucide-languages)').click();
  await page2.waitForSelector('[data-message-id="m14"] .ptx-view', { timeout: 5000 }).catch(() => {});
  await page2.waitForTimeout(700);
  const again = await viewParas();
  check(`0.5.3 (9) [${mode}]: back to the translation, the excluded blocks are still there in the same places`, again.length === 8 && again[1].startsWith('Plan item A.') && again[4].startsWith('[상태창] HP bar') && again[6].startsWith('Card text here.'), JSON.stringify(again));
}
// 전체 다시 번역 (재번역): the blocks stay and are still not sent
{
  const q = await page2.evaluate(() => window.__quiet.length);
  await page2.locator('[data-message-id="m14"] .ptx-bar [data-ptx-act="retranslate"]').click({ timeout: 3000 }).catch(() => {});
  await page2.waitForTimeout(1800);
  const sent = await sentSince(q);
  const paras = await viewParas();
  check('0.5.3 (9): 재번역 keeps the excluded blocks in place and does not send them', sent.length > 0 && NOT_SENT.every((x) => !sent.includes(x)) && paras.length === 8 && paras[1].startsWith('Plan item A.') && paras[4].startsWith('[상태창] HP bar') && paras[6].startsWith('Card text here.'), JSON.stringify(paras));
}
await page2.evaluate(() => { document.querySelector('[data-message-id="m14"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm14'), 1); window.__cleanup(); window.__lvStore = null; window.__setStorage(null); window.__cleanup = window.__LVSetup(window.__ctx); });

// ---- 0.5.10: a thinking block that only MENTIONS a listed tag must not break the excluded ranges (think / thinking / reasoning are always excluded) ----
// Without it the original's keptRanges starts a range at the `<tracker>` named inside <think> and ends it never (or at a far close tag): the whole message is "unresolved" and gets 0 cells.
await page2.evaluate(() => {
  window.__cleanup();
  window.__setStorage({ config: { paragraph: { keepTags: 'tracker', viewMode: 'tr' } } });
  window.__lvStore = LVInt.normalizeStore({ defaults: { translateMyMessages: true, modelLanguage: 'English' } });
  const t = Math.floor(Date.now() / 1000);
  const lines = ['Plan: write the `<tracker>` block first, then the <prose> block.', 'Time: 09:00 AM', 'The scout sets down her pack and studies the field.', 'She says wait here and keep the lamp low.'];
  window.__messages.push({ id: 'm40', role: 'assistant', content: '<think>\nPlan: write the `<tracker>` block first, then the <prose> block.\n</think>\n<tracker>\nTime: 09:00 AM\n</tracker>\n\nThe scout sets down her pack and studies the field.\n\nShe says wait here and keep the lamp low.', metadata: {}, extra: {}, createdAt: t, created_at: t, activeSwipeIndex: 0 });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm40');
  row.innerHTML = '<div><div data-component="MessageContent"><div class="b40"><p>' + lines[0] + '</p><tracker><p>' + lines[1] + '</p></tracker><p>' + lines[2] + '</p><p>' + lines[3] + '</p></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  document.querySelector('#chat').append(row);
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForTimeout(1800);
check('0.5.10 think: the settings field shows only the user\'s own list (no think/thinking/reasoning added)', (await page2.locator('#tab input[name="paraKeepTags"]').inputValue()) === 'tracker');
const q40 = await page2.evaluate(() => window.__quiet.length);
await page2.locator('[data-message-id="m40"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForSelector('[data-message-id="m40"] .ptx-view', { timeout: 8000 }).catch(() => {});
await page2.waitForTimeout(1000);
const sent40 = await sentSince(q40);
const cells40 = await page2.evaluate(() => [...document.querySelectorAll('[data-message-id="m40"] .ptx-view .b40 > p, [data-message-id="m40"] .ptx-view .b40 > tracker > p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()));
check('0.5.10 think: the message gets cells (the translate button works) and the prose is sent', (await page2.locator('[data-message-id="m40"] .ptx-view').count()) === 1 && sent40.includes('The scout sets down') && sent40.includes('keep the lamp low'), JSON.stringify({ sent40: sent40.slice(0, 200), cells40 }));
check('0.5.10 think: the thinking text and the tracker block are not sent to the model, and stay as the original text in the view', !sent40.includes('Plan: write') && !sent40.includes('Time: 09:00') && cells40.length === 4 && cells40[0].startsWith('Plan: write') && cells40[1].startsWith('Time: 09:00'), JSON.stringify({ sent40: sent40.slice(0, 200), cells40 }));
await page2.locator('#tab .tpg-form').evaluate((f) => f.requestSubmit());
await page2.waitForFunction(() => /저장했습니다/.test(document.querySelector('#tab .tpg-form [data-tpg-status]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
check('0.5.10 think: saving the settings keeps the user\'s list as it was (the always-excluded names are not written)', (await page2.evaluate(() => window.__getStorage()?.config?.paragraph?.keepTags)) === 'tracker', await page2.evaluate(() => JSON.stringify(window.__getStorage()?.config?.paragraph)));
await page2.evaluate(() => { window.__cleanup(); document.querySelector('[data-message-id="m40"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm40'), 1); window.__cleanup = window.__LVSetup(window.__ctx); });
await page2.waitForTimeout(800);

// ---- 0.5.10: the translate button of a message with nothing to translate is never silent ----
// The original toasts "이 메시지에는 번역할 문단이 없습니다." only when the message has no record; with a record (even empty) it takes the toggle path and draws nothing.
for (const [id, record] of [['m41', true], ['m42', false]]) {
  await page2.evaluate(([mid, rec]) => {
    window.__cleanup();
    window.__setStorage({ config: { paragraph: { keepTags: 'tracker', viewMode: 'tr' } } });
    const t = Math.floor(Date.now() / 1000);
    window.__messages.push({ id: mid, role: 'assistant', content: '<tracker>\nTime: 09:00 AM\nPlace: Old Road\n</tracker>', metadata: rec ? { st_translator_tt: { 0: { v: 1, map: {}, edited: {}, view: '', at: 1 } } } : {}, extra: {}, createdAt: t, created_at: t, activeSwipeIndex: 0 });
    const row = document.createElement('div');
    row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', mid);
    row.innerHTML = '<div><div data-component="MessageContent"><div class="bx"><tracker><p>Time: 09:00 AM</p><p>Place: Old Road</p></tracker></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
    document.querySelector('#chat').append(row);
    window.__cleanup = window.__LVSetup(window.__ctx);
  }, [id, record]);
  await page2.waitForTimeout(1500);
  await page2.evaluate(() => document.querySelectorAll('.ptx-toast').forEach((t) => t.remove()));
  await page2.locator(`[data-message-id="${id}"] .mari-message-actions button:has(svg.lucide-languages)`).click();
  await page2.waitForFunction(() => document.querySelector('.ptx-toast'), null, { timeout: 5500 }).catch(() => {});
  await page2.waitForTimeout(800);
  const toasts = await page2.evaluate(() => [...document.querySelectorAll('.ptx-toast')].map((t) => t.textContent.trim()));
  check(`0.5.10 no-cells toast [${record ? 'with a record' : 'no record'}]: pressing translate on a message with nothing to translate says so, once`, toasts.length === 1 && toasts[0] === '이 메시지에는 번역할 문단이 없습니다.', JSON.stringify({ toasts, dbg: await page2.evaluate((mid) => document.querySelector(`[data-message-id="${mid}"]`)?.innerHTML.slice(0, 500), id) }));
  await page2.evaluate((mid) => { window.__cleanup(); document.querySelectorAll('.ptx-toast').forEach((t) => t.remove()); document.querySelector(`[data-message-id="${mid}"]`)?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === mid), 1); }, id);
}
// a press that only hides the translation, or one that translates, makes no extra toast
{
  await page2.evaluate(() => {
    window.__cleanup();
    window.__setStorage({ config: { paragraph: { keepTags: '', viewMode: 'tr' } } });
    window.__messages.push({ id: 'm43', role: 'assistant', content: 'The lamp was still burning.\n\nCome in, she said.', metadata: {}, extra: {}, createdAt: 1, created_at: 1, activeSwipeIndex: 0 });
    const row = document.createElement('div');
    row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm43');
    row.innerHTML = '<div><div data-component="MessageContent"><div class="bx"><p>The lamp was still burning.</p><p>Come in, she said.</p></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
    document.querySelector('#chat').append(row);
    window.__cleanup = window.__LVSetup(window.__ctx);
  });
  await page2.waitForTimeout(1500);
  const btn = page2.locator('[data-message-id="m43"] .mari-message-actions button:has(svg.lucide-languages)');
  await btn.click();
  await page2.waitForSelector('[data-message-id="m43"] .ptx-view .ptx-u', { timeout: 8000 }).catch(() => {});
  await page2.waitForTimeout(500);
  await btn.click();
  await page2.waitForTimeout(4000);
  const extra = await page2.evaluate(() => [...document.querySelectorAll('.ptx-toast')].map((t) => t.textContent.trim()).filter((t) => /번역할 문단이 없습니다/.test(t)));
  check('0.5.10 no-cells toast: translating and then hiding the translation of a normal message never shows it', extra.length === 0 && (await page2.locator('[data-message-id="m43"] .ptx-view').count()) === 0, JSON.stringify(extra));
  await page2.evaluate(() => { window.__cleanup(); document.querySelector('[data-message-id="m43"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm43'), 1); window.__cleanup = window.__LVSetup(window.__ctx); });
}

// ---- 0.5.10: 「긴 메시지 접기」: the "더 보기" button of a translated message opens and folds the translation ----
// Lumiverse's real button (in the hidden content) changes only classes, the height limit and the label; the original rebuilds its translated view only on added/removed nodes,
// so the folded copy stayed folded. The press is passed on to the real button and the original is woken to rebuild the copy from it.
{
  await page2.evaluate(() => {
    window.__cleanup();
    window.__setStorage({ config: { paragraph: { keepTags: '', viewMode: 'tr' } } });
    window.__messages.push({ id: 'm44', role: 'assistant', content: 'The lamp was still burning.\n\nCome in, she said.', metadata: {}, extra: {}, createdAt: 1, created_at: 1, activeSwipeIndex: 0 });
    const row = document.createElement('div');
    row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm44');
    row.innerHTML = '<div><div data-component="MessageContent"><div class="vp folded" style="max-height:60px;overflow:hidden"><div class="body"><p>The lamp was still burning.</p><p>Come in, she said.</p></div></div><button type="button" data-long-message-toggle="true" aria-expanded="false"><span>Read more</span></button></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
    // what Lumiverse's React does on the click: classes, style and label change; nothing is added or removed
    row.querySelector('[data-long-message-toggle]').addEventListener('click', (ev) => {
      const b = ev.currentTarget, vp = row.querySelector('.vp'); const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open)); b.firstElementChild.firstChild.nodeValue = open ? 'Show less' : 'Read more';
      vp.classList.toggle('folded', !open); vp.style.maxHeight = open ? '' : '60px';
    });
    document.querySelector('#chat').append(row);
    window.__cleanup = window.__LVSetup(window.__ctx);
  });
  await page2.waitForTimeout(1500);
  await page2.locator('[data-message-id="m44"] .mari-message-actions button:has(svg.lucide-languages)').click();
  await page2.waitForSelector('[data-message-id="m44"] .ptx-view .ptx-u', { timeout: 8000 }).catch(() => {});
  await page2.waitForTimeout(800);
  const state = () => page2.evaluate(() => { const v = document.querySelector('[data-message-id="m44"] .ptx-view'); return { max: v?.querySelector('.vp')?.style.maxHeight ?? null, label: v?.querySelector('[data-long-message-toggle]')?.textContent?.trim() ?? null }; });
  const folded = await state();
  await page2.locator('[data-message-id="m44"] .ptx-view [data-long-message-toggle]').click();
  await page2.waitForTimeout(1500);
  const opened = await state();
  await page2.locator('[data-message-id="m44"] .ptx-view [data-long-message-toggle]').click();
  await page2.waitForTimeout(1500);
  const back = await state();
  check('0.5.10 long-message fold: the translated copy opens on "더 보기" and folds again (round trip)', folded.max === '60px' && folded.label === 'Read more' && opened.max === '' && opened.label === 'Show less' && back.max === '60px' && back.label === 'Read more', JSON.stringify({ folded, opened, back }));
  await page2.evaluate(() => { window.__cleanup(); document.querySelector('[data-message-id="m44"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm44'), 1); window.__cleanup = window.__LVSetup(window.__ctx); });
}

// ---- 0.5.4 (A5, A7, cyoa): blocks inside HTML islands are translated, keyed like the view, and shown in place ----
await page2.evaluate(() => {
  window.__cleanup();
  const t = Math.floor(Date.now() / 1000);
  const islands = [
    '<style data-lumi-island-base>*{box-sizing:border-box} img{max-height:240px} p{color:rgb(255,0,0)}</style><div class="hdr">[ The Farseer of the north ]<br>[ The Stargazer on the hill ]</div><div class="prose"><strong>The Stargazer|</strong> "<span style="color:#a8c6df">Head up and look at the sky.</span>"</div>',
    '<div class="pass">The ride was smooth, said Mira, a bumpy ride at worst.</div><div class="fail">Loose shale gives way under his boots.</div><div class="fail2"><strong>Farseer|</strong> "<span style="color:#a8c6df">Hold on to something solid.</span>"</div>',
    '<details class="cyoa"><summary>Action Hints for this scene</summary><div>1. Go left toward the light.<br>2. Go right into the dark.</div></details>',
  ];
  window.__messages.push({ id: 'm15', role: 'assistant', content: 'Opening prose of the scene.\n\n[ The Farseer of the north ]\n[ The Stargazer on the hill ]\n**The Stargazer|** "Head up and look at the sky."\n\nThe ride was smooth.\n</pass>\n<fail>Loose shale gives way under his boots.\n\nClosing prose of the scene.', swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: t + 1100, swipe_dates: [t + 1100] });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm15');
  row.innerHTML = '<div><div data-component="MessageContent"><div class="b15"></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  const body = row.querySelector('.b15');
  const mk = (text) => { const p = document.createElement('p'); p.textContent = text; return p; };
  const isl = (html) => { const d = document.createElement('div'); d.setAttribute('data-lumiverse-html-island', ''); d.attachShadow({ mode: 'open' }).innerHTML = html; return d; };
  body.append(mk('Opening prose of the scene.'), isl(islands[0]), isl(islands[1]), isl(islands[2]), mk('Closing prose of the scene.'));
  document.querySelector('#chat').append(row);
  const pg = document.createElement('p'); pg.id = 'pageui'; pg.textContent = 'page text outside any message'; document.body.append(pg);
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForTimeout(1500);
const leakState = () => page2.evaluate(() => ({ mirrors: document.querySelectorAll('[data-lv-mirror]').length, styleInMirror: document.querySelectorAll('[data-lv-mirror] style, [data-lv-mirror] link').length, lightStyles: document.querySelectorAll('[data-message-id="m15"] style').length, pageColor: getComputedStyle(document.querySelector('#pageui')).color }));
const leak0 = await leakState();
check('0.5.5 (CSS leak): islands have mirrors, but no <style>/<link> is in the light DOM and the page is not restyled by an island\'s CSS', leak0.mirrors === 3 && leak0.styleInMirror === 0 && leak0.lightStyles === 0 && leak0.pageColor !== 'rgb(255, 0, 0)', JSON.stringify(leak0));
const q15 = await page2.evaluate(() => window.__quiet.length);
await page2.locator('[data-message-id="m15"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForSelector('[data-message-id="m15"] .ptx-view', { timeout: 8000 }).catch(() => {});
await page2.waitForTimeout(1200);
const shadowBlocks = () => page2.evaluate(() => [...document.querySelectorAll('[data-message-id="m15"] .ptx-view [data-lumiverse-html-island]')].map((e) => ({ text: (e.shadowRoot?.textContent ?? '').replace(/\s+/g, ' '), blocks: [...(e.shadowRoot?.querySelectorAll('.hdr, .prose, .pass, .fail, .fail2, summary, details > div') ?? [])].map((b) => [...b.querySelectorAll('.ptx-t')].map((t) => t.textContent).join('').replace(/\s+/g, ' ').trim()) })));
const sb = await shadowBlocks();
const sent15 = await page2.evaluate((n) => window.__quiet.slice(n).map((c) => c.messages.find((m) => m.role === 'user').content).join('\n'), q15);
check('0.5.4 (A5/A7/cyoa): the text inside every island (header lines, dialogue, pass/fail, summary, hints) was sent as units', ['Farseer of the north', 'Head up and look', 'bumpy ride', 'Loose shale', 'Hold on to something', 'Action Hints', 'Go left'].every((x) => sent15.includes(x)), sent15.slice(0, 200));
check('0.5.4 (A5): every block of the header+dialogue island shows its translation (no English left)', sb[0]?.blocks.length === 2 && sb[0].blocks.every((b) => b.includes('번역')) && !sb[0].blocks.some((b) => /Farseer of the north|Head up|[a-z]{4}/.test(b.replace(/번역/g, ''))), JSON.stringify(sb[0]));
check('0.5.4 (A7): pass, fail and the dialogue after them each show a translation', sb[1]?.blocks.length === 3 && sb[1].blocks.every((b) => b.includes('번역')) && !sb[1].blocks.some((b) => /[a-z]{4}/.test(b)), JSON.stringify(sb[1]));
check('0.5.4 (cyoa): the <details> shows a translated summary title and body', sb[2]?.blocks.length >= 2 && sb[2].blocks.every((b) => b.includes('번역')) && !sb[2].blocks.some((b) => /[a-z]{4}/.test(b)), JSON.stringify(sb[2]));
check('0.5.4 (A7): a translation that came back as markdown (**name|**) is drawn as bold, not as literal asterisks', await page2.evaluate(() => { const sh = [...document.querySelectorAll('[data-message-id="m15"] .ptx-view [data-lumiverse-html-island]')][1].shadowRoot; return !!sh.querySelector('.ptx-t strong') && [...sh.querySelectorAll('.ptx-t strong')].some((x) => x.textContent === '번역|'); }));
check('0.5.4: no literal markdown (**) anywhere in the translated message', !(await page2.evaluate(() => document.querySelector('[data-message-id="m15"] .ptx-view').textContent + [...document.querySelectorAll('[data-message-id="m15"] .ptx-view [data-lumiverse-html-island]')].map((e) => e.shadowRoot?.textContent ?? '').join('')).then((t) => t.includes('**'))));
check('0.5.4: the dialogue colour span keeps its colour inside the translated island', await page2.evaluate(() => [...document.querySelectorAll('[data-message-id="m15"] .ptx-view [data-lumiverse-html-island]')].every((e, i) => i === 2 || [...e.shadowRoot.querySelectorAll('span')].some((sp) => getComputedStyle(sp).color === 'rgb(168, 198, 223)'))));
check('0.5.4 (cyoa): the translated <details> is still collapsible', await page2.evaluate(() => { const d = document.querySelector('[data-message-id="m15"] .ptx-view [data-lumiverse-html-island]:nth-of-type(3)')?.shadowRoot?.querySelector('details') ?? [...document.querySelectorAll('[data-message-id="m15"] .ptx-view [data-lumiverse-html-island]')][2].shadowRoot.querySelector('details'); const a = d.open; d.querySelector('summary').click(); const b = d.open; d.querySelector('summary').click(); return a === false && b === true && d.open === false; }));
const leak1 = await leakState();
const keptStyles = await page2.evaluate(() => [...document.querySelectorAll('[data-message-id="m15"] .ptx-view [data-lumiverse-html-island]')].map((e) => [...e.shadowRoot.querySelectorAll('style')].some((st) => st.textContent.includes('max-height:240px'))));
check('0.5.5 (CSS leak): while and after translating, still no <style> in the light DOM and the page is not restyled', leak1.styleInMirror === 0 && leak1.lightStyles === 0 && leak1.pageColor !== 'rgb(255, 0, 0)', JSON.stringify(leak1));
check('0.5.5 (CSS leak): the translated island keeps its own <style> (taken from the real island) inside its shadow root', keptStyles[0] === true, JSON.stringify(keptStyles));
await page2.screenshot({ path: join(shots, '10-islands-translated-units.png'), fullPage: true });
// the compare window and the reading view agree: one row per translated unit shown
const unitsShown = await page2.evaluate(() => document.querySelectorAll('[data-message-id="m15"] .ptx-view .ptx-u[data-k]').length + [...document.querySelectorAll('[data-message-id="m15"] .ptx-view [data-lumiverse-html-island]')].reduce((n, e) => n + e.shadowRoot.querySelectorAll('.ptx-u[data-k]').length, 0));
await page2.locator('[data-message-id="m15"] .ptx-bar [data-ptx-act="compare"]').click({ timeout: 3000 }).catch(() => {});
await page2.waitForSelector('.ptx-compare', { timeout: 4000 }).catch(() => {});
const rows15 = await page2.locator('.ptx-compare [data-act="row"]').count();
check('0.5.4: the compare window and the reading view agree (same number of units)', rows15 === unitsShown && rows15 >= 9, `${rows15} rows / ${unitsShown} shown`);
await page2.evaluate(() => document.querySelectorAll('.ptx-modal-root').forEach((e) => e.remove()));
// show original: the real islands are intact, the mirror stays hidden
await page2.locator('[data-message-id="m15"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForTimeout(700);
const origIsl = await page2.evaluate(() => [...document.querySelectorAll('[data-message-id="m15"] [data-lumiverse-html-island]')].map((e) => ({ inView: !!e.closest('.ptx-view'), latin: /[A-Za-z]{4}/.test(e.shadowRoot?.textContent ?? ''), ko: (e.shadowRoot?.textContent ?? '').includes('번역'), mirror: e.querySelector('[data-lv-mirror]') ? (e.querySelector('[data-lv-mirror]').getClientRects().length ? 'shown' : 'none') : 'none-absent' })));
check('0.5.4: showing the original, the islands are the original ones and the mirrors are hidden', origIsl.length === 3 && origIsl.every((x) => !x.inView && x.latin && !x.ko && (x.mirror === 'none' || x.mirror === 'none-absent')), JSON.stringify(origIsl));
// destroy(): every mirror is removed and every shadow observer is disconnected
{
  const r = await page2.evaluate(async () => {
    window.__cleanup();
    window.__cleanup = null;
    // observers watching an island's shadow root, recorded as the bridge starts
    const watching = [];
    const origObserve = MutationObserver.prototype.observe, origDisc = MutationObserver.prototype.disconnect;
    const state = new Map();
    MutationObserver.prototype.observe = function (t, o) { if (t instanceof ShadowRoot) { watching.push(this); state.set(this, false); } return origObserve.call(this, t, o); };
    MutationObserver.prototype.disconnect = function () { if (state.has(this)) state.set(this, true); return origDisc.call(this); };
    try {
      window.__cleanup = window.__LVSetup(window.__ctx);
      await new Promise((r) => setTimeout(r, 400));
      const before = document.querySelectorAll('[data-lv-mirror]').length;
      window.__cleanup();
      window.__cleanup = null;
      const after = document.querySelectorAll('[data-lv-mirror]').length;
      // a change in the real island after destroy must not bring a mirror back
      const isl = document.querySelector('[data-message-id="m15"] [data-lumiverse-html-island]');
      isl.shadowRoot.append(document.createElement('span'));
      await new Promise((r) => setTimeout(r, 300));
      return { before, after, later: document.querySelectorAll('[data-lv-mirror]').length, observers: watching.length, disconnected: [...state.values()].filter(Boolean).length };
    } finally { MutationObserver.prototype.observe = origObserve; MutationObserver.prototype.disconnect = origDisc; }
  });
  check('0.5.5 (destroy): all mirrors are removed, and stay gone', r.before === 3 && r.after === 0 && r.later === 0, JSON.stringify(r));
  check('0.5.5 (destroy): every shadow MutationObserver is disconnected', r.observers >= 3 && r.disconnected === r.observers, JSON.stringify(r));
  await page2.evaluate(() => { window.__cleanup = window.__LVSetup(window.__ctx); });
}
await page2.evaluate(() => { document.querySelector('#pageui')?.remove(); document.querySelector('[data-message-id="m15"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm15'), 1); });
// ---- 0.5.10: Sola V5 cards (Board / Easel), structure only. aria-hidden decoration is not text to translate; nested inline spans in a <summary> keep their title ----
const SOLA_CSS = process.env.QA_SOLA_CSS ? readFileSync(process.env.QA_SOLA_CSS, 'utf8') : ''; // local probe only: a preset's real CSS is not kept in this repository
await page2.evaluate((solaCss) => {
  window.__cleanup();
  const bs = (s) => s.split('').map((c) => `<b>${c}</b>`).join('');
  const board = `<style>.sb-files,.sb-ranks{display:grid;grid-template-columns:repeat(8,1fr)} .sb-files b{text-align:center}</style><details open class="sola-card-board"><summary class="sola-drawer-summary"><div class="sola-drawer-title"><span class="sb-tt"><span class="sola-board-heading">Sola’s Board <span class="sb-count" aria-label="pieces in play">12 / 32</span></span><span class="sola-board-sub">The world beyond the scene</span></span></div><span class="sola-drawer-chevron" aria-hidden="true"></span></summary><div class="sb-body"><p class="sb-cap">The world keeps moving, even when the scene looks elsewhere.</p><div class="sb-b" role="group"><div class="sb-ranks" aria-hidden="true">${bs('87654321')}</div><div class="sb-files" aria-hidden="true">${bs('ABCDEFGH')}</div></div></div></details>`;
  const easel = `<style>${solaCss}</style><details open class="sola-card-easel"><summary class="sola-drawer-summary"><span class="sola-drawer-title"><svg class="sola-ec-icon" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14"/></svg><span class="sola-ec-title"><span class="sola-ec-label-heading">Sola’s Easel</span><span class="sola-ec-label-sub">The Director’s Chart<span class="sola-ec-turn">12</span></span></span></span><span class="sola-ec-badge">DIRECTOR SPOILERS</span><span class="sola-drawer-chevron" aria-hidden="true"></span></summary><div class="sola-easel-body"><p>Private review outside story canon.</p></div></details><details open class="sola-card-mind"><summary class="sola-drawer-summary"><span class="sola-drawer-title"><span class="sola-ec-title">Sola’s Mind</span></span><span class="sola-drawer-chevron" aria-hidden="true"></span></summary><div><p>Quiet thoughts of the story.</p></div></details>`;
  const cxg = `<style>details.cxg>summary{display:flex;align-items:center;gap:13px;padding:9px 18px}.cxg-rows{display:grid;gap:6px}.cxg-pane{display:flex;flex-direction:column;gap:2px;padding:9px 14px}.cxg-lean::before{content:"The bold road"}.cxg-ico{width:20px;height:20px}</style><div class="cxg-wrap"><details class="cxg" open><summary><svg class="cxg-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg><span class="cxg-titles"><span class="cxg-title">Crossroads</span><span class="cxg-sub">Choose a road</span></span><span class="cxg-chev" aria-hidden="true"></span></summary><div class="cxg-body"><div class="cxg-rows"><span class="cxg-row"><span class="cxg-pane"><span class="cxg-lean"></span><span class="cxg-t">Follow the left road toward the old mill</span></span></span><span class="cxg-row"><span class="cxg-pane"><span class="cxg-lean"></span><span class="cxg-t">Wait quietly by the stone bridge</span></span></span></div></div></details></div>`;
  window.__messages.push({ id: 'm16', role: 'assistant', content: 'Opening prose of the scene.', swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm16');
  row.innerHTML = '<div><div data-component="MessageContent"><div class="b16"></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  const isl = (html) => { const d = document.createElement('div'); d.setAttribute('data-lumiverse-html-island', ''); d.attachShadow({ mode: 'open' }).innerHTML = html; return d; };
  const p = document.createElement('p'); p.textContent = 'Opening prose of the scene.';
  row.querySelector('.b16').append(p, isl(board), isl(easel), isl(cxg));
  document.querySelector('#chat').append(row);
  window.__cleanup = window.__LVSetup(window.__ctx);
}, SOLA_CSS);
await page2.waitForTimeout(1500);
await page2.locator('[data-message-id="m16"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForSelector('[data-message-id="m16"] .ptx-view', { timeout: 8000 }).catch(() => {});
await page2.waitForTimeout(1500);
const sola = await page2.evaluate(() => {
  const views = [...document.querySelectorAll('[data-message-id="m16"] .ptx-view [data-lumiverse-html-island]')].map((e) => e.shadowRoot);
  const [b, e, cx] = views;
  const shown = (r, sel) => [...(r?.querySelectorAll(sel) ?? [])].filter((x) => !x.closest('.ptx-o')); // the hidden original copy of a unit (.ptx-o) is not what is drawn
  const txt = (r, sel) => shown(r, sel).map((x) => (x.textContent ?? '').replace(/\s+/g, ' ').trim());
  const vis = (r, sel) => shown(r, sel).map((x) => { const q = x.getBoundingClientRect(); const cs = getComputedStyle(x); return q.width > 0 && q.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0; });
  const box = (r, sel) => shown(r, sel).map((x) => { const q = x.getBoundingClientRect(); const cs = getComputedStyle(x); return [Math.round(q.width), Math.round(q.height), cs.color, cs.fontSize]; });
  return {
    files: txt(b, '.sb-files b'), ranks: txt(b, '.sb-ranks b'), cap: txt(b, '.sb-cap'), boardTitle: txt(b, '.sb-tt'),
    heading: txt(e, '.sola-ec-label-heading'), sub: txt(e, '.sola-ec-label-sub'), turn: txt(e, '.sola-ec-turn'), badge: txt(e, '.sola-ec-badge'), mind: txt(e, '.sola-card-mind .sola-ec-title'),
    headingBox: box(e, '.sola-ec-label-heading'), headingVisible: vis(e, '.sola-ec-label-heading'), subVisible: vis(e, '.sola-ec-label-sub'), body: txt(e, '.sola-easel-body'),
    cxSummaryFlat: !!cx?.querySelector('details.cxg > summary > .ptx-u.is-flat'), cxSummaryChildren: [...(cx?.querySelectorAll('details.cxg > summary > *') ?? [])].filter((x) => !x.closest('.ptx-o')).map((x) => x.className),
    cxRowText: shown(cx, '.cxg-t').map((x) => [x.textContent, Math.round(x.getBoundingClientRect().width)]), cxIconBox: Math.round(cx?.querySelector('details.cxg > summary svg')?.getBoundingClientRect().width ?? -1),
    summaryHtml: e?.querySelector('.sola-card-easel summary')?.innerHTML.slice(0, 700),
  };
});
if (process.env.QA_DEBUG) console.log('DEBUG sola', JSON.stringify(sola));
check('0.5.10 (Sola board): the file letters stay eight separate labels, as written (aria-hidden decoration is not translated)', sola.files.join('') === 'ABCDEFGH' && sola.files.length === 8 && sola.ranks.length === 8, JSON.stringify(sola.files));
check('0.5.10 (Sola board): the caption and title are still translated', sola.cap.every((t) => t.includes('번역')) && sola.boardTitle.some((t) => t.includes('번역')), JSON.stringify([sola.cap, sola.boardTitle]));
check('0.5.10 (Sola easel): the nested title (heading + sub + turn) is still there and visible, translated, with its inline structure', sola.heading.length === 1 && sola.heading[0].length > 0 && sola.sub.length === 1 && sola.headingVisible[0] === true && sola.subVisible[0] === true && sola.turn.length === 1, JSON.stringify(sola));
check('0.5.10 (Sola easel): the one-level title (Mind) and the body keep their translation', sola.mind.every((t) => t.includes('번역')) && sola.body.every((t) => t.includes('번역')), JSON.stringify([sola.mind, sola.body]));
check('0.5.10 (flex/grid cards): the <summary> row of a flex card keeps its children (the translated unit is layout-transparent), the icon keeps its size', sola.cxSummaryFlat && sola.cxIconBox === 20, JSON.stringify([sola.cxSummaryFlat, sola.cxSummaryChildren, sola.cxIconBox]));
check('0.5.10 (flex/grid cards): choice text inside a flex pane is translated in place and not squeezed (wide, not wrapped letter by letter)', sola.cxRowText.length === 2 && sola.cxRowText.every(([tx, w]) => tx.includes('번역') && w > 150), JSON.stringify(sola.cxRowText));
// A plain (light DOM) message follows the same rule: aria-hidden decoration is not translated, the paragraphs are
await page2.evaluate(() => {
  window.__cleanup();
  window.__messages.push({ id: 'm16L', role: 'assistant', content: 'Plain prose of a normal message.', swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] });
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', 'm16L');
  row.innerHTML = '<div><div data-component="MessageContent"><div class="b17"><p>Plain prose of a normal message.</p><div class="lf" aria-hidden="true"><b>A</b><b>B</b><b>C</b><b>D</b><b>E</b><b>F</b><b>G</b><b>H</b></div><p>A second paragraph of the same message.</p></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  document.querySelector('#chat').append(row);
  window.__cleanup = window.__LVSetup(window.__ctx);
});
await page2.waitForTimeout(1500);
await page2.locator('[data-message-id="m16L"] .mari-message-actions button:has(svg.lucide-languages)').click();
await page2.waitForSelector('[data-message-id="m16L"] .ptx-view', { timeout: 8000 }).catch(() => {});
await page2.waitForTimeout(1500);
const lightDecor = await page2.evaluate(() => {
  const v = document.querySelector('[data-message-id="m16L"] .ptx-view');
  const shown = (sel) => [...(v?.querySelectorAll(sel) ?? [])].filter((x) => !x.closest('.ptx-o')).map((x) => (x.textContent ?? '').replace(/\s+/g, ' ').trim());
  return { letters: shown('.lf b'), paras: shown('.ptx-u').filter((t) => t.length > 8 && !/^[A-H]+$/.test(t)) };
});
check('0.5.10 (plain message): aria-hidden decoration (letters A-H) is kept as written, the paragraphs are translated', lightDecor.letters.join('') === 'ABCDEFGH' && lightDecor.letters.length === 8 && lightDecor.paras.length >= 2 && lightDecor.paras.every((t) => t.includes('번역')), JSON.stringify(lightDecor));
if (process.env.QA_STOP_AFTER_SOLA) { console.log(failures.length ? 'FAILING' : 'OK'); await browser.close(); process.exit(failures.length ? 1 : 0); }
await page2.evaluate(() => { window.__cleanup(); document.querySelector('[data-message-id="m16"]')?.remove(); window.__messages.splice(window.__messages.findIndex((x) => x.id === 'm16'), 1); window.__cleanup = window.__LVSetup(window.__ctx); });
// ---- 0.5.6: a message translated while NOT on screen (generation end, "translate all", catch-up) is later shown with the same cells ----
// The original splits an off-screen message from its SOURCE text (fallbackRoot: blank lines only, tags stripped) but the reading view keys the RENDERED
// cells, so a block tag that touches text with no blank line made one source unit and two cells: the key matched nothing and the English showed.
const OFFSCREEN = [
  { id: 'm16', name: 'A5 header + <prose> dialogue', above: 'Opening line directly above.', below: 'Closing line directly below.',
    src: '[ The Farseer of the north ]\n[ The Stargazer on the hill ]\n<prose>**The Stargazer|** "Head up and look at the sky."</prose>',
    island: '<div class="hdr">[ The Farseer of the north ]<br>[ The Stargazer on the hill ]</div><div class="prose"><strong>The Stargazer|</strong> "<span style="color:#a8c6df">Head up and look at the sky.</span>"</div>' },
  { id: 'm17', name: 'A7 pass/fail card', above: 'Before the roll, the dice rattled.', below: 'After the roll, silence returned.',
    src: 'The ride was smooth, said Mira, <span style="color:#a8c6df">"Bumpy ride."</span></pass>\n<fail>Loose shale gives way under his boots.\n**Farseer|** "Hold on to something solid."</fail>',
    island: '<div class="pass">The ride was smooth, said Mira, <span style="color:#a8c6df">"Bumpy ride."</span></div><div class="fail">Loose shale gives way under his boots.<br><strong>Farseer|</strong> "<span style="color:#a8c6df">Hold on to something solid.</span>"</div>' },
  { id: 'm18', name: '<details><summary> block', above: 'The door stood ajar above.', below: 'The hall ran on below.',
    src: '<details><summary>Action Hints for this scene</summary>\n1. Go left toward the light.\n2. Go right into the dark.</details>',
    island: '<details class="cyoa"><summary>Action Hints for this scene</summary><div>1. Go left toward the light.<br>2. Go right into the dark.</div></details>' },
  { id: 'm19', name: 'status window HTML, sentence above and below', above: 'She checked the glowing panel.', below: 'Then she looked up again.',
    src: '<div class="status"><b>Status Window</b>\n<span>Mood: calm and curious</span>\nLocation: the old lighthouse</div>',
    island: '<div class="status"><b>Status Window</b><div><span>Mood: calm and curious</span></div><div>Location: the old lighthouse</div></div>' },
];
for (const f of OFFSCREEN) {
  const content = `${f.above}\n${f.src}\n${f.below}`;
  await page2.evaluate(([f, content]) => {
    window.__cleanup();
    window.__auto = true;
    window.__messages.push({ id: f.id, role: 'assistant', content, swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] });
    window.__cleanup = window.__LVSetup(window.__ctx);
  }, [f, content]);
  await page2.waitForTimeout(500);
  await page2.evaluate(([f, content]) => { window.__emit('GENERATION_STARTED', { generationId: 'g-' + f.id, chatId: 'c1', generationType: 'normal' }); }, [f, content]);
  await page2.waitForTimeout(300);
  await page2.evaluate(([f, content]) => { window.__emit('GENERATION_ENDED', { generationId: 'g-' + f.id, chatId: 'c1', messageId: f.id, content, generationType: 'normal' }); }, [f, content]);
  await page2.waitForFunction((id) => Object.keys(window.__messages.find((x) => x.id === id)?.metadata?.st_translator_tt?.['0']?.map ?? {}).length >= 1, f.id, { timeout: 8000 }).catch(() => {});
  // now the message comes on screen (a rendered Lumiverse message: paragraphs and an HTML island)
  await page2.evaluate(([f]) => {
    const row = document.createElement('div');
    row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', f.id);
    row.innerHTML = '<div><div data-component="MessageContent"><div class="b"></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
    const body = row.querySelector('.b');
    const mk = (text) => { const p = document.createElement('p'); p.textContent = text; return p; };
    const d = document.createElement('div'); d.setAttribute('data-lumiverse-html-island', ''); d.attachShadow({ mode: 'open' }).innerHTML = f.island;
    body.append(mk(f.above), d, mk(f.below));
    document.querySelector('#chat').append(row);
  }, [f]);
  await page2.waitForSelector(`[data-message-id="${f.id}"] .ptx-view`, { timeout: 8000 }).catch(() => {});
  await page2.waitForTimeout(1500);
  const shown = await page2.evaluate((id) => {
    const view = document.querySelector(`[data-message-id="${id}"] .ptx-view`);
    if (!view) return null;
    const roots = [view, ...[...view.querySelectorAll('[data-lumiverse-html-island]')].map((e) => e.shadowRoot).filter(Boolean)];
    const text = roots.map((r) => { const c = document.createElement('div'); c.innerHTML = r === view ? '' : ''; const clone = r === view ? view.cloneNode(true) : (() => { const x = document.createElement('div'); for (const n of r.childNodes) x.append(n.cloneNode(true)); return x; })(); clone.querySelectorAll('.ptx-o, style, [data-lumiverse-html-island], .ptx-bar').forEach((e) => e.remove()); return clone.textContent; }).join(' ');
    const missing = roots.reduce((n, r) => n + r.querySelectorAll('.ptx-u.is-missing').length, 0);
    const spans = [...view.querySelectorAll('[data-lumiverse-html-island]')].flatMap((e) => [...(e.shadowRoot?.querySelectorAll('.ptx-t span') ?? [])]).filter((sp) => getComputedStyle(sp).color === 'rgb(168, 198, 223)').length;
    return { text: text.replace(/\s+/g, ' ').trim(), missing, spans };
  }, f.id);
  if (process.env.QA_DEBUG) console.log('DBG', f.id, JSON.stringify(await page2.evaluate((id) => ({ map: Object.keys(window.__messages.find((x) => x.id === id)?.metadata?.st_translator_tt?.['0']?.map ?? {}), sent: window.__quiet.filter((c) => c.messages.some((m) => m.content.includes('<segment'))).slice(-2).map((c) => c.messages.at(-1).content.slice(-400)) }), f.id)));
  check(`0.5.6 offscreen-then-shown [${f.name}]: a view is drawn`, !!shown);
  check(`0.5.6 offscreen-then-shown [${f.name}]: every unit shows its translation (no English cell, none missing)`, !!shown && shown.missing === 0 && !/[A-Za-z]{4}/.test(shown.text.replace(/번역/g, '')), JSON.stringify(shown));
  check(`0.5.6 offscreen-then-shown [${f.name}]: no literal ** markdown`, !!shown && !shown.text.includes('**'), JSON.stringify(shown));
  if (f.id === 'm16' || f.id === 'm17') check(`0.5.6 offscreen-then-shown [${f.name}]: the dialogue colour span is kept`, !!shown && shown.spans >= 1, JSON.stringify(shown));
  await page2.screenshot({ path: join(shots, `11-offscreen-${f.id}.png`), fullPage: true });
}
await page2.evaluate(() => { for (const id of ['m16', 'm17', 'm18', 'm19']) { document.querySelector(`[data-message-id="${id}"]`)?.remove(); const i = window.__messages.findIndex((x) => x.id === id); if (i >= 0) window.__messages.splice(i, 1); } });
// the usual case: the reply is on screen when the generation ends -> translated from the cells at once, in one pass, nothing left over to continue
{
  const f = OFFSCREEN[0]; const id = 'm20';
  const content = `${f.above}\n${f.src}\n${f.below}`;
  await page2.evaluate(([f, id, content]) => {
    window.__cleanup(); window.__auto = true;
    window.__messages.push({ id, role: 'assistant', content, swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] });
    const row = document.createElement('div');
    row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', id);
    row.innerHTML = '<div><div data-component="MessageContent"><div class="b"></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
    const mk = (text) => { const p = document.createElement('p'); p.textContent = text; return p; };
    const d = document.createElement('div'); d.setAttribute('data-lumiverse-html-island', ''); d.attachShadow({ mode: 'open' }).innerHTML = f.island;
    row.querySelector('.b').append(mk(f.above), d, mk(f.below));
    document.querySelector('#chat').append(row);
    window.__cleanup = window.__LVSetup(window.__ctx);
  }, [f, id, content]);
  await page2.waitForTimeout(800);
  const qn = await page2.evaluate(() => window.__quiet.length);
  await page2.evaluate(([id, content]) => { window.__emit('GENERATION_STARTED', { generationId: 'g-' + id, chatId: 'c1', generationType: 'normal' }); }, [id, content]);
  await page2.waitForTimeout(300);
  await page2.evaluate(([id, content]) => { window.__emit('GENERATION_ENDED', { generationId: 'g-' + id, chatId: 'c1', messageId: id, content, generationType: 'normal' }); }, [id, content]);
  await page2.waitForSelector(`[data-message-id="${id}"] .ptx-view`, { timeout: 8000 }).catch(() => {});
  await page2.waitForTimeout(3000);
  const sentSeg = await page2.evaluate((n) => window.__quiet.slice(n).map((c) => c.messages.find((m) => m.role === 'user').content).filter((u) => /<segment id=/.test(u)), qn);
  const view = await page2.evaluate((id) => { const v = document.querySelector(`[data-message-id="${id}"] .ptx-view`); const sh = [...(v?.querySelectorAll('[data-lumiverse-html-island]') ?? [])].map((e) => e.shadowRoot).filter(Boolean); return { missing: [v, ...sh].filter(Boolean).reduce((n, r) => n + r.querySelectorAll('.ptx-u.is-missing').length, 0), translated: [v, ...sh].filter(Boolean).reduce((n, r) => n + r.querySelectorAll('.ptx-u[data-k]').length, 0) }; }, id);
  check('0.5.6 on screen at the end of the generation: translated from the cells in one request, header and dialogue are separate units', sentSeg.length === 1 && (sentSeg[0].match(/<segment id=/g) ?? []).length === 4 && [...sentSeg[0].matchAll(/<segment id="\d+">\n([\s\S]*?)\n<\/segment>/g)].every((m) => !(/Farseer of the north/.test(m[1]) && /Head up/.test(m[1]))), JSON.stringify(sentSeg).slice(0, 400));
  check('0.5.6 on screen at the end of the generation: all 4 cells translated, none missing, no second pass', view.missing === 0 && view.translated === 4, JSON.stringify(view));
  await page2.evaluate((id) => { document.querySelector(`[data-message-id="${id}"]`)?.remove(); const i = window.__messages.findIndex((x) => x.id === id); if (i >= 0) window.__messages.splice(i, 1); }, id);
}
// ---- 0.5.9: Lumiverse puts data-message-id on TWO nested elements (the list's row wrapper AND the message card). Real-host captures (tests/fixtures/realhost) ----
// `document.querySelector('[data-message-id="<id>"]')` answered with the outer row, whose content hosts all belong to the inner card, so the original found
// no host and translated from the SOURCE text (units that merge a header with the first <prose> paragraph, pass with fail): the view then showed those cells empty.
{
  const fx = JSON.parse(readFileSync(join(root, 'tests/fixtures/realhost/v058-screen-ap-on.json'), 'utf8'));
  for (const key of ['A', 'B']) {
    const f = fx[key]; const id = 'rh-' + key;
    await page2.evaluate(() => { window.__cleanup(); window.__auto = false; });
    const qn = await page2.evaluate(([id, f]) => {
      window.__messages.push({ id, role: 'assistant', content: f.raw, swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] });
      // the real host's nesting: row wrapper [data-message-id] > message card [data-message-id] > content
      const outer = document.createElement('div'); outer.setAttribute('data-message-id', id); outer.setAttribute('data-virtual-index', '0');
      const row = document.createElement('div');
      row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', id);
      row.innerHTML = '<div><div data-component="MessageContent"></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
      const tmp = document.createElement('div'); tmp.innerHTML = f.hostHTML;
      const content = tmp.firstElementChild;
      for (const a of ['data-ptx-hidden', 'id']) content.removeAttribute(a);
      content.classList.remove('mari-message-content');
      let n = 0;
      for (const isl of content.querySelectorAll('[data-lumiverse-html-island]')) { isl.replaceChildren(); isl.attachShadow({ mode: 'open' }).innerHTML = f.hostIslands[n++] ?? ''; }
      content.setAttribute('data-component', 'MessageContent');
      row.querySelector('[data-component="MessageContent"]').replaceWith(content);
      outer.append(row);
      document.querySelector('#chat').append(outer);
      window.__cleanup = window.__LVSetup(window.__ctx);
      return window.__quiet.length;
    }, [id, f]);
    await page2.waitForTimeout(1500);
    await page2.evaluate((id) => document.querySelector(`[data-message-id="${id}"] .mari-message-actions button:has(svg.lucide-languages)`).click(), id);
    await page2.waitForSelector(`[data-message-id="${id}"] .ptx-view .ptx-u[data-k]`, { timeout: 8000 }).catch(() => {});
    await page2.waitForTimeout(2500);
    const got = await page2.evaluate(([id, qn]) => {
      const view = document.querySelector(`[data-message-id="${id}"] .ptx-view`);
      const roots = view ? [view, ...[...view.querySelectorAll('[data-lumiverse-html-island]')].map((e) => e.shadowRoot).filter(Boolean)] : [];
      const cells = roots.flatMap((r) => [...r.querySelectorAll('.ptx-u')]);
      const sent = window.__quiet.slice(qn).map((c) => c.messages.find((m) => m.role === 'user').content).filter((u) => /<segment id=/.test(u)).flatMap((u) => [...u.matchAll(/<segment id="\d+">\n([\s\S]*?)\n<\/segment>/g)].map((m) => m[1]));
      return { view: !!view, cells: cells.length, missing: cells.filter((c) => c.classList.contains('is-missing')).length, translated: cells.filter((c) => c.dataset.k).length, sent: sent.length, unused: Object.keys(window.__messages.find((x) => x.id === id)?.metadata?.st_translator_tt?.['0']?.map ?? {}).filter((k) => !cells.some((c) => c.dataset.k === k)).length };
    }, [id, qn]);
    check(`0.5.9 real-host ${key} (row wrapper + card both carry data-message-id): a view is drawn`, got.view, JSON.stringify(got));
    check(`0.5.9 real-host ${key}: translated from the cells on screen (every stored translation key is a key of a cell; none made from the message source)`, got.sent > 0 && got.unused === 0, JSON.stringify(got));
    check(`0.5.9 real-host ${key}: no cell is left without its translation (missing 0)`, got.cells > 0 && got.missing === 0 && got.translated === got.cells, JSON.stringify(got));
    await page2.screenshot({ path: join(shots, `12-realhost-${key}.png`), fullPage: true });
    await page2.evaluate((id) => { document.querySelector(`[data-message-id="${id}"]`)?.remove(); const i = window.__messages.findIndex((x) => x.id === id); if (i >= 0) window.__messages.splice(i, 1); }, id);
  }
}

// ---- 0.5.7 (A): the off-screen "heal" has a switch (our setting 화면에 나타날 때 빠진 칸 자동 보충 번역, default on) ----
// ---- 0.5.7 (B): Lumiverse's reasoning Auto-parse: the body the original reads is think-stripped and trimmed, the reasoning sits in a box outside the body ----
const setHeal = async (on) => {
  await page2.evaluate((on) => {
    window.__cleanup();
    const base = window.__lvStore;
    window.__lvStore = LVInt.normalizeStore({ ...base, chats: {}, defaults: { ...base.defaults, healOffscreen: on } }); // chats: {} - a chat's own saved setting would win over the default
    window.__cleanup = window.__LVSetup(window.__ctx);
  }, on);
  await page2.waitForTimeout(600);
};
const segCalls = (n) => page2.evaluate((k) => window.__quiet.slice(k).map((c) => c.messages.find((m) => m.role === 'user').content).filter((u) => /<segment id=/.test(u)), n);
const bodyUnits = (id) => page2.evaluate((id) => { const v = document.querySelector(`[data-message-id="${id}"] .ptx-view`); return v ? { missing: v.querySelectorAll('.ptx-u.is-missing').length, translated: v.querySelectorAll('.ptx-u[data-k]').length } : null; }, id);
/** Message on screen the way Lumiverse draws it with Auto-parse ON: the reasoning box is a sibling OUTSIDE the body; the body holds the think-stripped, trimmed text. */
const autoParseRow = (id, think, paras) => page2.evaluate(([id, think, paras]) => {
  const row = document.createElement('div');
  row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', id);
  row.innerHTML = '<div><div class="reasoning-box"></div><div data-component="MessageContent"><div class="b"></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
  row.querySelector('.reasoning-box').textContent = think;
  for (const t of paras) { const p = document.createElement('p'); p.textContent = t; row.querySelector('.b').append(p); }
  document.querySelector('#chat').append(row);
}, [id, think, paras]);
const dropMsg = (id) => page2.evaluate((id) => { document.querySelector(`[data-message-id="${id}"]`)?.remove(); const i = window.__messages.findIndex((x) => x.id === id); if (i >= 0) window.__messages.splice(i, 1); }, id);
const addMsg = (id, content) => page2.evaluate(([id, content]) => { window.__cleanup(); window.__auto = true; window.__messages.push({ id, role: 'assistant', content, swipes: [content], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] }); window.__cleanup = window.__LVSetup(window.__ctx); }, [id, content]);
const endGen = async (id, content) => {
  await page2.evaluate(([id]) => window.__emit('GENERATION_STARTED', { generationId: 'g-' + id, chatId: 'c1', generationType: 'normal' }), [id]);
  await page2.waitForTimeout(300);
  await page2.evaluate(([id, content]) => window.__emit('GENERATION_ENDED', { generationId: 'g-' + id, chatId: 'c1', messageId: id, content, generationType: 'normal' }), [id, content]);
  await page2.waitForFunction((id) => Object.keys(window.__messages.find((x) => x.id === id)?.metadata?.st_translator_tt?.['0']?.map ?? {}).length >= 1, id, { timeout: 8000 }).catch(() => {});
};
const THINK = 'secret plan: she will lie about the key';
// (A) off-screen translation, then the message appears with a cell the off-screen split could not key (a header touching the text)
for (const heal of [false, true]) {
  const id = heal ? 'm22' : 'm21';
  await setHeal(heal);
  const f = OFFSCREEN[0];
  const content = `${f.above}\n${f.src}\n${f.below}`;
  await addMsg(id, content);
  await page2.waitForTimeout(400);
  await endGen(id, content); // not on screen
  const n0 = await page2.evaluate(() => window.__quiet.length);
  await page2.evaluate(([f, id]) => {
    const row = document.createElement('div');
    row.setAttribute('data-component', 'BubbleMessage'); row.setAttribute('data-message-id', id);
    row.innerHTML = '<div><div data-component="MessageContent"><div class="b"></div></div><span data-spindle-mount="message_footer"></span></div><div data-component="BubbleActions"><button>a</button><button>b</button><button>c</button></div>';
    const mk = (text) => { const p = document.createElement('p'); p.textContent = text; return p; };
    const d = document.createElement('div'); d.setAttribute('data-lumiverse-html-island', ''); d.attachShadow({ mode: 'open' }).innerHTML = f.island;
    row.querySelector('.b').append(mk(f.above), d, mk(f.below));
    document.querySelector('#chat').append(row);
  }, [f, id]);
  await page2.waitForSelector(`[data-message-id="${id}"] .ptx-view`, { timeout: 8000 }).catch(() => {});
  await page2.waitForTimeout(3000);
  const calls = await segCalls(n0);
  const left = await page2.evaluate((id) => { const v = document.querySelector(`[data-message-id="${id}"] .ptx-view`); const sh = [...(v?.querySelectorAll('[data-lumiverse-html-island]') ?? [])].map((e) => e.shadowRoot).filter(Boolean); return [v, ...sh].filter(Boolean).reduce((n, r) => n + r.querySelectorAll('.ptx-u.is-missing').length, 0); }, id);
  if (heal) check('0.5.7 (A) heal ON (default): the message that reached the screen with missing cells is continued once (1 more call), nothing missing', calls.length === 1 && left === 0, JSON.stringify({ calls: calls.length, left }));
  else check('0.5.7 (A) heal OFF: no extra model call when the message reaches the screen; the missing cells stay for the 이어서 번역 button', calls.length === 0 && left > 0, JSON.stringify({ calls: calls.length, left }));
  await dropMsg(id);
}
await setHeal(true);
check('0.5.7 (A): the switch is in our section of the settings form, on by default', await page2.evaluate(() => { const sw = document.querySelector('#tab [name="lv:healOffscreen"]'); return !!sw && !!sw.closest('[data-lv-section]') && sw.checked === true && /빠진 칸 자동 보충 번역 \(모델 호출 1회 추가\)/.test(sw.closest('[data-lv-switch]').textContent); }));
await page2.locator('#tab [name="lv:healOffscreen"]').evaluate((e) => e.click());
await page2.locator('#tab .tpg-save').click();
await page2.waitForTimeout(800);
check('0.5.7 (A): turning it off and saving with the one save button writes healOffscreen=false', (await page2.evaluate(() => window.__lvSaves?.at(-1)?.settings?.healOffscreen)) === false);
await setHeal(true);
// (B) Auto-parse ON, the reply is on screen when the generation ends: reasoning box outside the body, body = think-stripped + trimmed
{
  const id = 'm23';
  const content = `<think>\n${THINK}\n</think>\n\nHead up and look at the sky.\n\nThe stars were out.\n`;
  await addMsg(id, content);
  await autoParseRow(id, THINK, ['Head up and look at the sky.', 'The stars were out.']);
  await page2.waitForTimeout(800);
  const n0 = await page2.evaluate(() => window.__quiet.length);
  await endGen(id, content);
  await page2.waitForSelector(`[data-message-id="${id}"] .ptx-view`, { timeout: 8000 }).catch(() => {});
  await page2.waitForTimeout(2500);
  const calls = await segCalls(n0);
  const u = await bodyUnits(id);
  const stored = await page2.evaluate((id) => window.__messages.find((x) => x.id === id).content, id);
  check('0.5.7 (B) Auto-parse: on-screen reply is translated from the body cells in one request; the think text is not sent', calls.length === 1 && !calls.join('').includes('secret plan') && (calls[0].match(/<segment id=/g) ?? []).length === 2, JSON.stringify(calls).slice(0, 300));
  check('0.5.7 (B) Auto-parse: the reading view shows both body cells translated (keys come from the cells), none missing, reasoning box untouched', !!u && u.translated === 2 && u.missing === 0 && (await page2.evaluate((id) => document.querySelector(`[data-message-id="${id}"] .reasoning-box`)?.textContent, id)) === THINK, JSON.stringify(u));
  check('0.5.7 (B) Auto-parse: the stored message text (think included) is not touched by showing/translating', stored === content);
  await dropMsg(id);
}
// (B2) Auto-parse ON and the reply was translated off screen (think text is part of the source the original splits there)
for (const heal of [true, false]) {
  const id = heal ? 'm25' : 'm24';
  await setHeal(heal);
  const content = `<think>${THINK}</think>\nHead up and look at the sky.\n\nThe stars were out.`;
  await addMsg(id, content);
  await page2.waitForTimeout(400);
  await endGen(id, content);
  const sentOff = await page2.evaluate(() => window.__quiet.filter((c) => c.messages.some((m) => /<segment id=/.test(m.content))).slice(-1)[0]?.messages.find((m) => m.role === 'user').content ?? '');
  const n0 = await page2.evaluate(() => window.__quiet.length);
  await autoParseRow(id, THINK, ['Head up and look at the sky.', 'The stars were out.']);
  await page2.waitForSelector(`[data-message-id="${id}"] .ptx-view`, { timeout: 8000 }).catch(() => {});
  await page2.waitForTimeout(3000);
  const calls = await segCalls(n0);
  const u = await bodyUnits(id);
  const stored = await page2.evaluate((id) => window.__messages.find((x) => x.id === id).content, id);
  if (heal) check('0.5.7 (B2) off-screen + Auto-parse, heal ON: the body is fully translated and the think text is not sent (0.5.10: the thinking block is excluded from the off-screen split, so no cell merges with its tail and no heal call is needed)', !!u && u.missing === 0 && calls.length === 0 && !calls.join('').includes('secret plan'), JSON.stringify({ u, calls: calls.length }));
  else check('0.5.7 (B2) off-screen + Auto-parse, heal OFF: no heal call (the cell that merged with the think tail stays missing; documented limit)', !!u && calls.length === 0, JSON.stringify({ u, calls: calls.length }));
  check(`0.5.7 (B2) heal ${heal ? 'ON' : 'OFF'}: the stored text (think included) is unchanged`, stored === content);
  console.log(`INFO heal=${heal}: the off-screen request included the think text: ${sentOff.includes('secret plan')}`);
  await dropMsg(id);
}
await setHeal(true);
// ---- 0.5.8: a generation end held back until its message is drawn must not swallow the next generation's auto-translation ----
// The end is replayed only once the reply is on screen (up to 6 s). When the same chat starts its next generation in that window, the held end went into the new
// generation's stream (one stream per chat) and the next reply was never auto-translated. Now the held end is replayed first, then the new generation starts.
{
  const A = 'm30', B = 'm31';
  const keyCount = (id) => page2.evaluate((id) => Object.keys(window.__messages.find((x) => x.id === id)?.metadata?.st_translator_tt?.['0']?.map ?? {}).length, id);
  await page2.evaluate(([A, B]) => {
    window.__cleanup(); window.__auto = true;
    for (const [id, text] of [[A, 'The first reply, drawn nowhere.\n\nIt has two paragraphs.'], [B, 'The second reply, also nowhere.\n\nIt too has two paragraphs.']]) {
      window.__messages.push({ id, role: 'assistant', content: text, swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] });
    }
    window.__cleanup = window.__LVSetup(window.__ctx);
  }, [A, B]);
  await page2.waitForTimeout(500);
  const q0 = await page2.evaluate(() => window.__quiet.length);
  const emit = (name, p) => page2.evaluate(([name, p]) => window.__emit(name, p), [name, p]);
  const contentOf = (id) => page2.evaluate((id) => window.__messages.find((x) => x.id === id).content, id);
  await emit('GENERATION_STARTED', { generationId: 'g-a', chatId: 'c1', generationType: 'normal' });
  await page2.waitForTimeout(300);
  await emit('GENERATION_ENDED', { generationId: 'g-a', chatId: 'c1', messageId: A, content: await contentOf(A), generationType: 'normal' });
  await page2.waitForTimeout(150);
  await emit('GENERATION_STARTED', { generationId: 'g-b', chatId: 'c1', generationType: 'normal' });
  await page2.waitForTimeout(1500);
  await emit('GENERATION_ENDED', { generationId: 'g-b', chatId: 'c1', messageId: B, content: await contentOf(B), generationType: 'normal' });
  await page2.waitForFunction(([A, B]) => [A, B].every((id) => Object.keys(window.__messages.find((x) => x.id === id)?.metadata?.st_translator_tt?.['0']?.map ?? {}).length >= 1), [A, B], { timeout: 12000 }).catch(() => {});
  await page2.waitForTimeout(1000);
  const a = await keyCount(A), b = await keyCount(B);
  const reqs = await page2.evaluate((n) => window.__quiet.slice(n).filter((c) => c.messages.some((m) => /<segment id=/.test(m.content))).length, q0);
  check('0.5.8 held end + next generation of the same chat (both replies off screen): BOTH replies get a translation record', a >= 1 && b >= 1, JSON.stringify({ a, b, reqs }));
  check('0.5.8 held end + next generation: one translation request per reply (2)', reqs === 2, JSON.stringify({ a, b, reqs }));
  // destroy() with a held end: nothing is replayed afterwards and no timer keeps running
  const C = 'm32';
  await page2.evaluate((C) => { window.__messages.push({ id: C, role: 'assistant', content: 'A third reply.\n\nTwo paragraphs again.', swipes: ['x'], swipe_id: 0, extra: {}, metadata: {}, send_date: Math.floor(Date.now() / 1000), swipe_dates: [Math.floor(Date.now() / 1000)] }); }, C);
  await emit('GENERATION_STARTED', { generationId: 'g-c', chatId: 'c1', generationType: 'normal' });
  await page2.waitForTimeout(300);
  await emit('GENERATION_ENDED', { generationId: 'g-c', chatId: 'c1', messageId: C, content: await contentOf(C), generationType: 'normal' });
  await page2.evaluate(() => window.__cleanup());
  await page2.waitForTimeout(7500);
  check('0.5.8 destroy() while an end is held: the held end is dropped (no translation after the extension is off)', (await keyCount(C)) === 0, JSON.stringify({ c: await keyCount(C) }));
  await page2.evaluate(([A, B, C]) => { for (const id of [A, B, C]) { const i = window.__messages.findIndex((x) => x.id === id); if (i >= 0) window.__messages.splice(i, 1); } window.__auto = false; window.__cleanup = window.__LVSetup(window.__ctx); }, [A, B, C]);
}
check('integrated: no page errors', errors2.length === 0, errors2.slice(0, 3).join(' | '));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`${failures.length ? 'FAILED' : 'OK'} (${failures.length} failing); screenshots in ${shots}`);
process.exit(failures.length ? 1 : 0);
