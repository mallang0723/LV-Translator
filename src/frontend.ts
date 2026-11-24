// Frontend: settings tab, per-message translation controls, outgoing message translation
// (the message create request is translated before it leaves the browser, like Marinara),
// and the draft translate button beside the chat input.

import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import {
  type ChatSettings,
  type ConnectionSummary,
  DEFAULT_SETTINGS,
  settingsFor,
  type Store,
  type ToBackend,
  type ToFrontend,
  type UserBundle,
  effectiveConnectionId,
} from './shared';
import { checkMarkers, ExcludeRuleError, lenientTags, MARKER_INSTRUCTION, parseExcludeRules, protect, restore } from './translate/protect';
import { BUNDLE_EDIT_NOTE, outgoingBundleBlocks } from './bundles';
import { type ConnectionHint, friendlyError, pickConnection, SOURCE_LABELS } from './connection';
import { MARINARA_TRANSLATION_GENERAL_PROMPTS } from './vendor/tt-1.8.0/prompts';
import type { HostBridge, MessageRow } from './host-emu/api';
import { MessageCache } from './host-emu/message-cache';
import { watchVisibleMessages } from './host-emu/visible-messages';
import { createSettingsHost, nativePrompts, startOriginal, whenMessageSettled } from './host-emu/boot';
import { GenerationDriver, GenerationHub } from './host-emu/generation';
import type { MarinaraStorage } from './host-emu/runtime';
import { withBatchLimit } from './host-emu/split';
import { withExclusions } from './host-emu/exclude';
import { type BundleSeed, type LvForm, type LvState, type LvValues, mountLvForm } from './host-emu/lv-form';

const PANEL_CSS = `
.stt-btn { font: inherit; cursor: pointer; padding: 2px 8px; border-radius: var(--lumiverse-radius-sm, 6px);
  color: var(--lumiverse-text, inherit); background: var(--lumiverse-fill-subtle, color-mix(in srgb, currentColor 10%, transparent));
  border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)); }
.stt-btn:hover:not(:disabled) { border-color: var(--lumiverse-primary, currentColor); }
.stt-btn:disabled { opacity: 0.5; cursor: default; }
.stt-btn.stt-primary { background: var(--lumiverse-primary-015, color-mix(in srgb, var(--lumiverse-primary, currentColor) 15%, transparent)); border-color: var(--lumiverse-primary, currentColor); }
.stt-btn.stt-danger { color: var(--lumiverse-danger, #d55); border-color: var(--lumiverse-danger, #d55); }
.stt-note { color: var(--lumiverse-text-muted, inherit); opacity: 0.85; }
.stt-note.stt-warn { color: var(--lumiverse-warning, #c90); opacity: 1; }
.stt-note.stt-err { color: var(--lumiverse-danger, #d55); opacity: 1; }
/* Paragraph Reader view (message content) */
/* Message action row buttons (bubble pill and minimal row; the host's own classes are reused where possible) */
.stt-panel { display: flex; flex-direction: column; gap: 12px; padding: 10px; color: var(--lumiverse-text, inherit); font-size: 0.92em; }
.stt-section { display: flex; flex-direction: column; gap: 7px; border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)); border-radius: var(--lumiverse-radius, 8px); padding: 9px; }
.stt-section > h3 { margin: 0; font-size: 1em; }
.stt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.stt-field { display: flex; flex-direction: column; gap: 3px; }
.stt-field > span { color: var(--lumiverse-text-muted, inherit); font-size: 0.9em; }
.stt-panel input[type=text], .stt-panel input[type=number], .stt-panel select, .stt-panel textarea, .stt-modal input, .stt-modal textarea {
  font: inherit; color: inherit; background: var(--lumiverse-input-bg, var(--lumiverse-fill-subtle, color-mix(in srgb, currentColor 8%, transparent)));
  border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)); border-radius: 5px; padding: 5px 7px; box-sizing: border-box; width: 100%; }
.stt-panel textarea, .stt-modal textarea { min-height: 70px; resize: vertical; }
.stt-panel textarea.stt-prompt { min-height: 110px; font-size: 0.85em; }
.stt-panel textarea[readonly] { opacity: 0.75; }
.stt-check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.stt-sub { padding-left: 22px; display: flex; flex-direction: column; gap: 6px; }
.stt-sticky { position: sticky; bottom: 0; background: color-mix(in srgb, var(--lumiverse-bg, Canvas) 94%, transparent); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); padding: 8px 0; }
.stt-modal { display: flex; flex-direction: column; gap: 10px; padding: 4px; }
.stt-modal textarea { min-height: 280px; font-size: 0.85em; }
.stt-badge { font-size: 0.75em; opacity: 0.75; }
.stt-panel, .stt-section, .stt-field, .stt-modal { min-width: 0; overflow-wrap: anywhere; }
.stt-row > .stt-field { flex: 1 1 130px; }
.stt-panel select { min-width: 0; max-width: 100%; }
.stt-bundle-preview { min-width: 0; }
.stt-bundle-preview > summary { cursor: pointer; color: var(--lumiverse-text-muted, inherit); }
.stt-bundle-preview .stt-field { margin-top: 7px; }
.stt-bundle-editor textarea { min-height: 90px; }
.stt-sticky.stt-unsaved { border-top: 2px solid var(--lumiverse-warning, #c90); background: color-mix(in srgb, var(--lumiverse-warning, #c90) 22%, color-mix(in srgb, var(--lumiverse-bg, Canvas) 94%, transparent)); padding: 8px; border-radius: 8px; }
.stt-unsaved-note { flex: 1 1 100%; font-weight: 700; color: var(--lumiverse-warning, #c90); }
.stt-unsaved-note[hidden] { display: none; }
/* Phones and touch screens: readable text (15px+) and tap targets of 44px+. */
@media (max-width: 768px), (pointer: coarse) {
  .stt-panel, .stt-modal, .stt-note { font-size: 15px; }
  .stt-panel textarea.stt-prompt, .stt-modal textarea { font-size: 15px; }
  .stt-field > span, .stt-section > h3 { font-size: 15px; }
  .stt-btn { min-height: 44px !important; min-width: 44px; padding: 8px 14px !important; }
  .stt-panel input[type=text], .stt-panel input[type=number], .stt-panel select, .stt-modal input { min-height: 44px; font-size: 16px; }
  .stt-check { min-height: 44px; }
  .stt-bundle-preview > summary { min-height: 44px; display: flex; align-items: center; }
  .stt-check input { width: 22px; height: 22px; flex: none; }
}
`;

type Children = Array<Node | string | null | false | undefined>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, children: Children = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in node) (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

const button = (label: string, onClick: () => void, cls = '', title?: string) =>
  el('button', { type: 'button', class: `stt-btn ${cls}`.trim(), title: title ?? label, 'aria-label': title ?? label, onClick }, [label]);

const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';

export function setup(ctx: SpindleFrontendContext) {
  let store: Store | null = null;
  let connections: ConnectionSummary[] = [];
  let link: 'none' | 'ok' | 'incompatible' = 'none';
  let chatId: string | null = null;
  let lastDraftTranslation: string | null = null;

  const toBackend = (msg: ToBackend) => ctx.sendToBackend(msg);
  const notify = (kind: 'info' | 'warning' | 'error', text: string) => toBackend({ type: 'notify', kind, text });
  const current = (): ChatSettings => (store ? settingsFor(store, chatId) : DEFAULT_SETTINGS);
  const removeStyle = ctx.dom.addStyle(PANEL_CSS);

  function chatIdFromLocation(): string | null {
    const m = /^\/chat\/([^/?#]+)/.exec(location.pathname);
    return m ? decodeURIComponent(m[1]!) : null;
  }

  /** Ids only this side can see: the profile Lumiverse has active, and the one pinned to the chat. */
  let hint: ConnectionHint = {};
  async function sendHint(forChat: string | null = chatId, open = false): Promise<void> {
    const next: ConnectionHint = {};
    try {
      const id = ctx.connections?.getActive?.()?.activeProfileId;
      if (typeof id === 'string' && id) next.activeId = id;
    } catch {
      // not available on this host
    }
    try {
      const chat = forChat ? ((await ctx.chats.get?.(forChat)) as { metadata?: Record<string, unknown> } | null | undefined) : null;
      const pinned = chat?.metadata?.connection_profile_id;
      if (typeof pinned === 'string' && pinned.trim()) next.chatId = pinned.trim();
    } catch {
      // not available on this host
    }
    hint = next;
    toBackend({ type: 'hint', chatId: forChat, activeId: next.activeId, chatConnectionId: next.chatId, ...(open ? { open: true } : {}) });
  }

  // ---- the original Translation Tools 1.10.0 screens (src/host-emu) ----
  // The message view, the bar, the 대조·수정 window, the per-paragraph 다시 번역, the scans and the settings screen are the
  // original's own code, run whole. Here only the entrance is provided: the host calls it asks for go to the backend.

  const rpc = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let rpcCounter = 0;
  // Lumiverse hands every backend reply to every open page of the user, so a bare counter ("e1", "e2"...) collides between two tabs
  // (or a reloaded page) and a reply meant for one page settles another page's call. The id carries a per-page random part.
  const rpcPage = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const call = <T,>(op: string, args: unknown[], signal?: AbortSignal): Promise<T> => {
    const id = `e${rpcPage}.${++rpcCounter}`;
    return new Promise<T>((resolve, reject) => {
      rpc.set(id, { resolve: resolve as (v: unknown) => void, reject });
      toBackend({ type: 'emu', id, op, args });
      signal?.addEventListener('abort', () => {
        rpc.delete(id);
        toBackend({ type: 'emu_cancel', id });
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
  };
  const CONTEXT_READ_TAIL = 40;
  let outgoingInFlight = 0;
  const hub = new GenerationHub();
  /** The message list the original takes from "the app's cache": rows read for it, kept current by the backend's message events. */
  const cache = new MessageCache();
  const bridge: HostBridge = {
    getChat: (c) => call('getChat', [c]),
    // `n` 0 is a read with no limit: the original's "모두 번역" (the whole chat, at most 1000) or its own background read after a
    // generation (`auto`: the backend answers with the end of the chat). While my message is being translated only the end is read.
    listMessages: async (c, n, auto) => {
      const since = cache.mark();
      const rows = await call<MessageRow[]>('listMessages', [c, n || (outgoingInFlight > 0 ? CONTEXT_READ_TAIL : 0), auto === true]);
      cache.seed(c, rows, since);
      return rows;
    },
    getMessage: async (c, m) => {
      const since = cache.mark();
      const row = await call<MessageRow>('getMessage', [c, m]);
      cache.seed(c, [row], since);
      return row;
    },
    updateContent: (c, m, content) => call('updateContent', [c, m, content]),
    patchExtra: (c, m, patch, swipe) => call('patchExtra', [c, m, patch, swipe]),
    // The original's request grouping has a fixed 6000-character limit; a smaller one from the settings is applied here (split.ts).
    generateRaw: withExclusions(withBatchLimit((req, signal) => call('generateRaw', [req], signal), () => (store ? current().batchChars : 0)), () => (store ? current().excludeRules : '')),
    generateActive: (c) => call('generateActive', [c]),
    connections: () => call('connections', []),
    character: (id) => call('character', [id]),
    persona: (id) => call('persona', [id]),
    lorebooks: () => call('lorebooks', []),
    lorebookEntries: (b) => call('lorebookEntries', [b]),
    openGeneration: (c) => hub.open(c),
    translate: (req, signal) => call('translate', [req], signal),
  };
  const emuStorage: MarinaraStorage = {
    get: () => call('storage.get', []),
    patch: (p) => call('storage.patch', [p]),
  };
  const original = startOriginal({
    bridge,
    cache,
    storage: emuStorage,
    activeChatId: () => chatId,
    addStyle: (css) => ctx.dom.addStyle(css),
    healOffscreen: () => (store ? current().healOffscreen : true),
  });
  const visible = watchVisibleMessages({
    chat: () => chatId,
    known: (c, id) => cache.has(c, id),
    lookup: async (c, ids) => {
      const since = cache.mark();
      cache.seed(c, await call<MessageRow[]>('messagesFor', [c, ids]), since);
    },
    log: (text, error) => console.warn(`[translator] ${text}`, error),
  });
  const settingsElement = createSettingsHost();
  const settingsHost = { element: settingsElement, ...nativePrompts(settingsElement) };
  const driver = new GenerationDriver(hub, () => original.emu.installedFetch(), (text, error) => console.warn(`[translator] ${text}`, error));

  /** Lumiverse sends every generation event to every open page; one page takes each generation and replays it into the original. */
  const leased = new Set<string>();
  /** A generation end held back until its message is drawn (one per chat: the original keeps one stream per chat). */
  const heldEnds = new Map<string, { ended: Parameters<GenerationDriver['ended']>[0]; abort: AbortController }>();
  /** Replays the chat's held end now (the wait is over, or the next generation of the same chat is about to start). */
  const flushHeldEnd = (forChat: string): void => {
    const held = heldEnds.get(forChat);
    if (!held) return;
    heldEnds.delete(forChat);
    held.abort.abort();
    driver.ended(held.ended);
  };
  const offEvents = [
    ctx.events.on('GENERATION_STARTED', (payload) => {
      const p = payload as { generationId?: string; chatId?: string; generationType?: string; targetMessageId?: string } | null;
      if (!p?.chatId || !p.generationId) return;
      const { generationId, chatId: forChat } = p;
      // The held end of the previous reply goes first: the original's stream for this chat must close before the next generation opens its own.
      flushHeldEnd(forChat);
      void call<boolean>('lease', [generationId])
        .then((granted) => {
          if (!granted) return;
          leased.add(generationId);
          driver.started({ chatId: forChat, generationType: p.generationType, targetMessageId: p.targetMessageId });
        })
        .catch(() => {});
    }),
    ctx.events.on('GENERATION_ENDED', (payload) => {
      const p = payload as { generationId?: string; chatId?: string; messageId?: string; content?: string; error?: string; generationType?: string } | null;
      if (!p?.chatId || !p.generationId || !leased.delete(p.generationId)) return;
      const ended = { chatId: p.chatId, messageId: p.messageId, content: p.content, error: p.error, generationType: p.generationType };
      // The original reads a message's cells from the screen when it can (an off-screen message is split from its source text, which does not
      // match the cells the view keys). The reply is on screen now or a moment from now: give it up to a few seconds to draw before replaying the end.
      flushHeldEnd(p.chatId);
      if (p.messageId && typeof p.content === 'string' && !p.error && p.generationType !== 'impersonate') {
        const held = { ended, abort: new AbortController() };
        heldEnds.set(p.chatId, held);
        void whenMessageSettled(p.messageId, 6000, held.abort.signal).then(() => {
          if (heldEnds.get(ended.chatId) === held) flushHeldEnd(ended.chatId);
        });
      } else driver.ended(ended);
    }),
    ctx.events.on('GENERATION_STOPPED', (payload) => {
      const p = payload as { generationId?: string; chatId?: string } | null;
      if (!p?.chatId || !p.generationId || !leased.delete(p.generationId)) return;
      driver.stopped(p.chatId);
    }),
  ];

  /** "내 메시지 번역": the original's own /api/translate handling (its 유저 입력 번역 프롬프트, 단어장, 기타 지침, 이전 대화), with the LV exclude rules on top. */
  async function translateText(text: string, forChat: string): Promise<string> {
    await sendHint(forChat);
    const fetchOriginal = original.emu.installedFetch();
    if (!fetchOriginal) throw new Error('번역 도구가 아직 시작되지 않았습니다.');
    const settings = store ? settingsFor(store, forChat) : DEFAULT_SETTINGS;
    const row = await bridge.getChat(forChat);
    const connectionId = String(row.metadata?.translationConnectionId ?? '');
    // The chat's own prompts (0.4.0 kept them per chat): the original's "채팅 설정 유지" preset means these.
    settingsHost.setPrompts(String(row.metadata?.translationPrompt ?? ''), String(row.metadata?.translationOutputPrompt ?? ''));
    // The tags the original's 「번역에서 제외할 태그」 holds are excluded from my messages too. It is the only tag list now (the 0.4.0 one was moved into it once), so removing a tag there removes it here.
    const keep = await emuStorage.get().then((f) => String((f?.config as { paragraph?: { keepTags?: string } } | undefined)?.paragraph?.keepTags ?? '')).catch(() => '');
    const held = protect(text, { ...settings, excludeTags: lenientTags(keep.replace(/;/g, ',')).join(', ') });
    // The prompt lives in the original's field (a hidden one here; in Marinara it is the 유저 입력 번역 프롬프트 field).
    let systemPrompt = settingsHost.prompts().outgoing.trim();
    // LV additions on top of the original's prompt: the shared bundle's glossary / guidance (the bundle's own fields only) and the protection marker rule.
    const bundle = store?.userBundles.find((b) => b.id === settings.bundleId);
    const extras = [...(bundle ? outgoingBundleBlocks(bundle) : []), held.pieces.length ? MARKER_INSTRUCTION : ''].filter(Boolean);
    if (extras.length) systemPrompt = [systemPrompt || MARINARA_TRANSLATION_GENERAL_PROMPTS.base.replace(/\n*\{\{(?:voice|vocab)\}\}/g, '').trim(), ...extras].join('\n\n');
    let res: Response;
    outgoingInFlight++;
    try {
      res = await fetchOriginal('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: held.text, provider: 'ai', targetLanguage: settings.modelLanguage, connectionId, systemPrompt, chatId: forChat }),
      });
    } finally {
      outgoingInFlight--;
    }
    const data = (await res.json().catch(() => null)) as { translatedText?: string; error?: string; message?: string } | null;
    if (!res.ok) throw new Error(friendlyError(data?.error || data?.message || `번역 요청 실패 (${res.status})`));
    const translated = String(data?.translatedText ?? '').trim();
    if (!translated) throw new Error('번역 결과가 비어 있습니다.');
    const problem = held.pieces.length ? checkMarkers(held.text, translated) : null;
    if (problem) throw new Error(problem);
    return restore(translated, held.pieces).trim();
  }

  function resetChat(next: string | null): void {
    // Before the original sees the new chat id (it reads it from here): the old chat's prompt must not stay in its fields.
    if (next !== chatId) {
      settingsHost.reset();
      visible.reset();
    }
    chatId = next;
    renderDraftButton();
    renderPanel();
    if (next) void sendHint(next, true);
  }

  // Back on screen: a reply that finished while the page was away may still be untranslated.
  let lastVisibleHint = 0;
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || !chatId || Date.now() - lastVisibleHint < 10_000) return;
    lastVisibleHint = Date.now();
    void sendHint(chatId, true);
  };
  document.addEventListener('visibilitychange', onVisible);

  const routeTimer = setInterval(() => {
    const next = chatIdFromLocation();
    if (next !== chatId) resetChat(next);
  }, 700);

  // ---- outgoing message translation (Marinara "Translate My Messages") ----

  const originalFetch = window.fetch;
  const translatingFetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    try {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const m = /\/api\/v1\/chats\/([^/?#]+)\/messages(?:[?#]|$)/.exec(new URL(url, location.href).pathname + '');
      if (method === 'POST' && m && typeof init?.body === 'string' && store) {
        const target = decodeURIComponent(m[1]!);
        const settings = settingsFor(store, target);
        const body = JSON.parse(init.body) as { is_user?: unknown; content?: unknown };
        const content = typeof body.content === 'string' ? body.content : '';
        if (settings.translateMyMessages && body.is_user === true && content.trim() && content !== '(attached)' && content !== lastDraftTranslation) {
          try {
            const translated = await translateText(content, target);
            init = { ...init, body: JSON.stringify({ ...body, content: translated }) };
          } catch (e) {
            // Marinara sends the original when translation fails.
            notify('error', `내 메시지 번역에 실패해 원문을 보냈습니다: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        lastDraftTranslation = null;
      }
    } catch {
      // never block a request because of this hook
    }
    return originalFetch.call(this ?? window, input, init);
  };
  window.fetch = Object.assign(translatingFetch, { preconnect: originalFetch.preconnect }) as typeof fetch;

  // ---- draft translate button beside the input ----

  const draftRoot = ctx.ui.mount('chat_input_tools_right');
  let draftBusy = false;

  function renderDraftButton(): void {
    draftRoot.replaceChildren();
    if (!chatId || !current().showDraftButton) return;
    const b = button(draftBusy ? '번역 중…' : '번역', () => void translateDraft(), '', `입력한 글을 ${current().modelLanguage}로 번역합니다`);
    b.disabled = draftBusy;
    draftRoot.append(b);
  }

  async function translateDraft(): Promise<void> {
    const ta = document.querySelector<HTMLTextAreaElement>('textarea[name="chat-message"]');
    if (!ta || !chatId || !ta.value.trim()) return;
    draftBusy = true;
    renderDraftButton();
    try {
      const translated = await translateText(ta.value, chatId);
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(ta, translated);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus();
      lastDraftTranslation = translated.trim();
    } catch (e) {
      notify('error', `번역 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      draftBusy = false;
      renderDraftButton();
    }
  }

  // ---- settings tab ----

  const tab = ctx.ui.registerDrawerTab({
    id: 'translator',
    title: '양방향 번역',
    shortName: '번역',
    description: '양방향 번역: 문단 번역 보기·대조·수정, 프리셋, 단어장, 응답·내 메시지 번역(원작 Translation Tools 1.10.0)',
    keywords: ['translate', 'translation', 'glossary', '번역', '단어장'],
    headerTitle: '양방향 번역',
    iconSvg: ICON,
  });
  // One screen: the original's settings form (its own code) is the whole tab. Our own settings are sections inside that form
  // (src/host-emu/lv-form.ts) and are saved by the form's one save button.
  tab.root.replaceChildren(el('div', { class: 'stt-panel' }, [settingsHost.element]));

  function editBundle(existing: UserBundle | null, seed?: BundleSeed): void {
    const modal = ctx.ui.showModal({ title: existing ? '묶음 편집' : '새 묶음으로 저장', width: Math.min(680, window.innerWidth - 32), maxHeight: 820, persistent: true });
    // A new bundle starts from what the settings form holds right now (rows added and not yet saved included), not from the saved room settings.
    const source: BundleSeed = existing ?? seed ?? { glossary: '', freeContext: '', incomingVoicePrompt: '' };
    const name = el('input', { type: 'text', value: existing?.name ?? '', placeholder: '묶음 이름' });
    const glossary = el('textarea', { value: source.glossary, spellcheck: false, placeholder: '내 언어 용어 = 모델 언어 용어' });
    const freeContext = el('textarea', { value: source.freeContext, spellcheck: false });
    const voice = el('textarea', { value: source.incomingVoicePrompt, spellcheck: false, placeholder: '[인물 이름]\n말투 지시 (이름 없이 적으면 모든 인물)' });
    modal.root.replaceChildren(el('div', { class: 'stt-modal stt-bundle-editor' }, [
      el('div', { class: 'stt-note' }, [existing
        ? BUNDLE_EDIT_NOTE
        : '설정 화면에 지금 적힌 내용(저장 전이어도)의 단어장·기타 번역 지침·대사 지침을 복사합니다. 저장 후 목록에서 선택해 주세요. 묶음은 내 메시지 번역에 더해집니다.']),
      el('label', { class: 'stt-field' }, [el('span', {}, ['이름']), name]),
      el('label', { class: 'stt-field' }, [el('span', {}, ['단어집']), glossary]),
      el('label', { class: 'stt-field' }, [el('span', {}, ['추가 지침']), freeContext]),
      el('label', { class: 'stt-field' }, [el('span', {}, ['대사 지침']), voice]),
      el('div', { class: 'stt-row' }, [
        button('저장', () => {
          if (!name.value.trim()) return notify('warning', '묶음 이름을 입력해 주세요.');
          toBackend({ type: 'save_bundle', bundle: {
            id: existing?.id ?? '', name: name.value, glossary: glossary.value,
            freeContext: freeContext.value, incomingVoicePrompt: voice.value,
          } });
          modal.dismiss();
        }, 'stt-primary'),
        button('취소', () => modal.dismiss()),
      ]),
    ]));
  }

  function lvState(): LvState {
    if (!store) {
      return { ready: false, chatKey: chatId ?? '', hasChat: !!chatId, values: { connectionId: '', modelLanguage: '', myLanguage: '', batchChars: 0, autoTranslate: false, translateMyMessages: false, showDraftButton: false, healOffscreen: true, protectHtml: false, protectCode: false, excludeRules: '', bundleId: '', voice: { from: '', backupSaved: false, backupPrompt: '', backupEnabled: false } }, connections: [], connectionNote: { text: '', kind: '' }, linkNote: '', bundles: [] };
    }
    const s = current();
    let bundleId = s.bundleId;
    if (bundleId && !store.userBundles.some((b) => b.id === bundleId)) bundleId = '';
    const connectionId = effectiveConnectionId(store, chatId);
    const options: Array<[string, string]> = [['', '자동 (채팅에 지정된 연결 → 지금 쓰는 연결 → 기본 연결)'], ...connections.map((c): [string, string] => [c.id, `${c.name} · ${c.model}${c.isDefault ? ' (기본)' : ''}`])];
    if (connectionId && !connections.some((c) => c.id === connectionId)) options.push([connectionId, '(삭제된 연결)']);
    const picked = pickConnection(connections.map((c) => ({ id: c.id, name: c.name, is_default: c.isDefault })), connectionId || undefined, hint);
    const pickedName = picked ? (connections.find((c) => c.id === picked.id)?.name ?? picked.id) : '';
    const note: LvState['connectionNote'] = !connections.length
      ? { text: 'Lumiverse에 AI 연결이 없습니다. Lumiverse 설정의 연결에서 연결을 하나 만들어 주세요.', kind: 'err' }
      : picked?.staleId
        ? { text: `고른 연결이 삭제돼 대신 "${pickedName}" (${SOURCE_LABELS[picked.source]})으로 번역합니다. 다시 골라 주세요.`, kind: 'warn' }
        : { text: `번역에 쓰일 연결: ${pickedName} (${SOURCE_LABELS[picked?.source ?? 'host']}). 아래 저장 버튼으로 적용합니다.`, kind: '' };
    return {
      ready: true,
      chatKey: chatId ?? '',
      hasChat: !!chatId,
      values: { connectionId, modelLanguage: s.modelLanguage, myLanguage: s.myLanguage, batchChars: s.batchChars, autoTranslate: s.autoTranslate, translateMyMessages: s.translateMyMessages, showDraftButton: s.showDraftButton, healOffscreen: s.healOffscreen, protectHtml: s.protectHtml, protectCode: s.protectCode, excludeRules: s.excludeRules, bundleId, voice: { from: s.voiceFrom, backupSaved: s.voiceBackupSaved, backupPrompt: s.voiceBackupPrompt, backupEnabled: s.voiceBackupEnabled } },
      connections: options,
      connectionNote: note,
      linkNote: link === 'none' ? '' : link === 'ok' ? '기억 서재와 연동 중: 번역 결과와 이 방의 단어장을 기억 서재에 공개합니다.' : '기억 서재와 연동 규격 버전이 달라 연동을 쓰지 않습니다. 두 확장을 모두 최신으로 올려 주세요.',
      bundles: store.userBundles.map((b) => ({ id: b.id, name: b.name, glossary: b.glossary, freeContext: b.freeContext, incomingVoicePrompt: b.incomingVoicePrompt })),
    };
  }

  const lvForm: LvForm = mountLvForm(settingsHost.element, {
    state: lvState,
    editBundle: (id, seed) => editBundle(id ? (store?.userBundles.find((b) => b.id === id) ?? null) : null, seed),
    deleteBundle: async (id) => {
      const selected = store?.userBundles.find((b) => b.id === id);
      if (!selected) return;
      const { confirmed } = await ctx.ui.showConfirm({
        title: '묶음 삭제',
        message: `"${selected.name}" 묶음을 삭제할까요? 이 묶음을 쓰는 모든 방과 새 채팅 기본값의 선택이 "없음"으로 바뀝니다. 각 방에 추가한 내용은 남습니다.`,
        variant: 'danger', confirmLabel: '삭제',
      });
      if (confirmed) toBackend({ type: 'delete_bundle', id: selected.id });
    },
    async save(v: LvValues) {
      try {
        parseExcludeRules(v.excludeRules);
      } catch (e) {
        throw new Error(e instanceof ExcludeRuleError ? e.message : '제외 규칙을 확인해 주세요.');
      }
      const settings: ChatSettings = {
        ...current(),
        modelLanguage: v.modelLanguage, myLanguage: v.myLanguage, batchChars: v.batchChars, autoTranslate: v.autoTranslate, translateMyMessages: v.translateMyMessages,
        showDraftButton: v.showDraftButton, healOffscreen: v.healOffscreen, protectHtml: v.protectHtml, protectCode: v.protectCode, excludeRules: v.excludeRules,
        bundleId: v.bundleId, connectionId: v.connectionId,
        voiceFrom: v.voice.from, voiceBackupSaved: v.voice.backupSaved, voiceBackupPrompt: v.voice.backupPrompt, voiceBackupEnabled: v.voice.backupEnabled,
      };
      await call('lv.save', [{ chatId, settings, asDefault: v.asDefault, connectionId: v.connectionId }]);
    },
  });
  const renderPanel = () => lvForm.refresh();

  const action = ctx.ui.registerInputBarAction({ id: 'open-translator', label: '번역 설정' });
  const offAction = action.onClick(() => tab.activate());

  // ---- backend messages ----

  const offBackend = ctx.onBackendMessage((raw) => {
    const msg = raw as ToFrontend;
    switch (msg?.type) {
      case 'state': {
        store = msg.store;
        connections = msg.connections;
        link = msg.link ?? 'none';
        renderPanel();
        renderDraftButton();
        return;
      }
      case 'msg_event': {
        if (msg.kind === 'upsert') cache.upsert(msg.chatId, msg.row as MessageRow);
        else cache.remove(msg.chatId, msg.messageId);
        return;
      }
      case 'emu_result': {
        const waiter = rpc.get(msg.id);
        if (!waiter) return;
        rpc.delete(msg.id);
        if (msg.ok) waiter.resolve(msg.data);
        else waiter.reject(Object.assign(new Error(msg.error || '요청 실패'), { status: msg.status }));
        return;
      }
    }
  });

  renderPanel();
  toBackend({ type: 'hello' });
  void sendHint();
  resetChat(chatIdFromLocation());

  return () => {
    clearInterval(routeTimer);
    document.removeEventListener('visibilitychange', onVisible);
    lvForm.stop();
    visible.destroy();
    original.stop();
    offEvents.forEach((off) => off());
    for (const held of heldEnds.values()) held.abort.abort();
    heldEnds.clear();
    offBackend();
    offAction();
    action.destroy();
    tab.destroy();
    if ((window.fetch as unknown) === translatingFetch) window.fetch = originalFetch;
    for (const p of rpc.values()) p.reject(new Error('확장이 종료되었습니다.'));
    removeStyle();
    ctx.dom.cleanup();
  };
}
