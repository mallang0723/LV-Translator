// src/shared.ts
var FONT_MIN = 12;
var FONT_MAX = 32;
var DEFAULT_VIEW = { paragraphView: "interleave", sourceFontSize: 16, translationFontSize: 18 };
function fontSize(value, fallback) {
  const n = Number(value);
  return value === null || value === "" || !Number.isFinite(n) ? fallback : Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
}
function normalizeView(value) {
  const v = value && typeof value === "object" ? value : {};
  return {
    paragraphView: v.paragraphView === "tap" ? "tap" : "interleave",
    sourceFontSize: fontSize(v.sourceFontSize, DEFAULT_VIEW.sourceFontSize),
    translationFontSize: fontSize(v.translationFontSize, DEFAULT_VIEW.translationFontSize)
  };
}
var LONG_SPLIT_DEFAULT = 7000;
var INHERIT_PRESET_ID = "builtin-inherit";
var DEFAULT_SETTINGS = {
  connectionId: "",
  modelLanguage: "English",
  myLanguage: "Korean",
  outgoingPresetId: INHERIT_PRESET_ID,
  incomingPresetId: INHERIT_PRESET_ID,
  outgoingPrompt: "",
  incomingPrompt: "",
  translateMyMessages: false,
  showDraftButton: false,
  autoTranslate: false,
  displayMode: "below",
  translationUnit: "whole",
  autoContinue: true,
  longSplitChars: LONG_SPLIT_DEFAULT,
  protectHtml: true,
  protectCode: true,
  excludeRules: "",
  glossary: "",
  freeContextEnabled: false,
  freeContext: "",
  incomingVoiceEnabled: false,
  incomingVoicePrompt: "",
  contextEnabled: false,
  contextIncludeOriginal: true,
  contextIncludeTranslation: true,
  contextIncludeUserInput: false,
  contextMessageCount: 3
};
function settingsFor(store, chatId) {
  return chatId && store.chats[chatId] ? store.chats[chatId] : store.defaults;
}
function effectiveConnectionId(store, chatId) {
  return settingsFor(store, chatId).connectionId || store.defaults.connectionId;
}

// src/connection.ts
var CONNECTION_HINT = "AI 연결을 찾지 못했습니다. 번역 설정에서 연결을 골랐는지, 그리고 저장했는지 확인해 주세요(저장하지 않으면 적용되지 않습니다). Lumiverse에 기본 연결이 있는지도 확인해 보세요.";
function pickConnection(list, chosen, hint = {}) {
  const has = (id) => id ? list.some((c) => c.id === id) : false;
  const staleId = chosen && !has(chosen) ? chosen : undefined;
  const found = (id, source) => staleId ? { id, source, staleId } : { id, source };
  if (chosen && has(chosen))
    return { id: chosen, source: "chosen" };
  if (has(hint.chatId))
    return found(hint.chatId, "chat");
  if (has(hint.activeId))
    return found(hint.activeId, "active");
  const def = list.find((c) => c.is_default);
  if (def)
    return found(def.id, "default");
  const first = list[0];
  return first ? found(first.id, "first") : null;
}
var SOURCE_LABELS = {
  chosen: "설정에서 고른 연결",
  chat: "이 채팅에 지정된 연결",
  active: "지금 쓰는(활성) 연결",
  default: "기본 연결",
  first: "첫 번째 연결",
  host: "Lumiverse가 정하는 연결"
};
function friendlyError(message) {
  if (/No connection profile found/i.test(message))
    return CONNECTION_HINT;
  if (/userId is required/i.test(message))
    return "이 확장은 사용자 정보를 받지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.";
  return message;
}

// src/message-ui.ts
function pickTarget(views, explicitId) {
  const usable = views.filter((v) => v.role !== "system");
  if (explicitId) {
    const picked = usable.find((v) => v.messageId === explicitId);
    if (picked)
      return picked;
  }
  let recent = null;
  for (const v of usable) {
    if (v.updatedAt === null)
      continue;
    if (!recent || v.updatedAt > (recent.updatedAt ?? 0) || v.updatedAt === (recent.updatedAt ?? 0) && v.index > recent.index)
      recent = v;
  }
  if (recent)
    return recent;
  const latest = (list) => list.reduce((best, v) => !best || v.index > best.index ? v : best, null);
  return latest(usable.filter((v) => v.role === "assistant")) ?? latest(usable);
}
function targetLabel(view) {
  const name = view.name.trim();
  return name ? `#${view.index} ${name}` : `#${view.index}`;
}
function toolbarState(view) {
  if (!view)
    return { action: "translate", force: false, label: "번역", canDelete: false, busy: false };
  if (view.busy)
    return { action: "cancel", force: false, label: "번역 중단 (번역 중입니다)", canDelete: false, busy: true };
  const exists = view.text !== null || view.status !== null;
  return {
    action: "translate",
    force: exists,
    label: exists ? "다시 번역 (저장된 번역을 새로 만듭니다)" : "번역",
    canDelete: view.text !== null,
    busy: false
  };
}
var DELETE_TRANSLATION_LABEL = "번역 삭제 (이 메시지에 저장된 번역문만 지웁니다. 메시지는 그대로입니다)";
function messageIdFromScope(scope) {
  const m = /^message:(.+):actions$/.exec(scope);
  return m ? m[1] : null;
}

// src/toolbar.ts
var ICON_TRANSLATE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
var ICON_TRANSLATE_DELETE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + '<g transform="translate(0.5 0.5) scale(0.72)"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></g>' + '<path d="m15.5 15.5 6 6" stroke-width="2.6"/><path d="m21.5 15.5-6 6" stroke-width="2.6"/></svg>';
var BUBBLE_ROW = '[data-component="BubbleActions"]';
var SLOT_ATTR = "data-stt-tb";
function findActionRow(messageEl) {
  const footer = messageEl.querySelector('[data-spindle-mount="message_footer"]');
  const next = footer?.parentElement?.nextElementSibling;
  if (!next)
    return null;
  if (next.matches(BUBBLE_ROW))
    return next;
  const candidates = [next, next.firstElementChild];
  for (const c of candidates) {
    if (!(c instanceof HTMLElement))
      continue;
    const buttons = Array.from(c.children).filter((x) => x.tagName === "BUTTON");
    if (buttons.length >= 3)
      return c;
  }
  return null;
}
function mountToolbars(opts) {
  const slots = new Map;
  let hostUnregister = null;
  let timer = null;
  let destroyed = false;
  function button(cls, label, icon, onClick, look) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `stt-tb ${cls} ${look.kind === "host" ? look.className : ""}`.trim();
    if (look.kind === "own")
      b.setAttribute("data-stt-own", "");
    b.title = label;
    b.setAttribute("aria-label", label);
    b.setAttribute("data-stt-btn", "");
    b.innerHTML = icon;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }
  function lookOf(slot) {
    if (slot.closest(BUBBLE_ROW))
      return { kind: "pill" };
    const ref = slot.parentElement?.querySelector(":scope > button:not([data-stt-btn])");
    return ref?.className ? { kind: "host", className: ref.className } : { kind: "own" };
  }
  function render(slot) {
    const meta = slots.get(slot);
    if (!meta)
      return;
    const view = opts.getView(meta.id);
    const state = toolbarState(view ?? null);
    const show = !!view && view.role !== "system";
    const look = show ? lookOf(slot) : { kind: "own" };
    const sig = show ? `${state.label}|${state.busy}|${state.canDelete}|${look.kind === "host" ? look.className : look.kind}` : "";
    if (slot.getAttribute("data-stt-sig") === sig)
      return;
    slot.setAttribute("data-stt-sig", sig);
    if (!show) {
      slot.replaceChildren();
      return;
    }
    const children = [
      button(`stt-tb-translate${state.busy ? " stt-tb-busy" : ""}`, state.label, ICON_TRANSLATE, () => state.action === "cancel" ? opts.onCancel(meta.id) : opts.onTranslate(meta.id, state.force), look)
    ];
    if (state.canDelete)
      children.push(button("stt-tb-del", DELETE_TRANSLATION_LABEL, ICON_TRANSLATE_DELETE, () => opts.onDelete(meta.id), look));
    slot.replaceChildren(...children);
  }
  function attach(slot, id, own) {
    slot.setAttribute(SLOT_ATTR, id);
    slot.style.display = "contents";
    slots.set(slot, { id, own });
    render(slot);
  }
  if (opts.registerDecorator) {
    try {
      const handle = opts.registerDecorator({
        mount: "message_actions",
        render(root, ctx) {
          const id = messageIdFromScope(ctx.scope);
          if (!id)
            return;
          attach(root, id, false);
          return () => {
            slots.delete(root);
          };
        },
        update(root, ctx) {
          const id = messageIdFromScope(ctx.scope);
          if (!id)
            return;
          if (!slots.has(root))
            slots.set(root, { id, own: false });
          render(root);
        }
      });
      if (typeof handle === "function")
        hostUnregister = handle;
      else if (handle && typeof handle.destroy === "function")
        hostUnregister = () => handle.destroy();
      else
        hostUnregister = () => {};
    } catch {
      hostUnregister = null;
    }
  }
  function scan() {
    if (destroyed)
      return;
    for (const [slot, meta] of slots)
      if (meta.own && !slot.isConnected)
        slots.delete(slot);
    for (const { messageId, element } of opts.listMessageElements()) {
      if (element.querySelector(`[${SLOT_ATTR}]`))
        continue;
      const row = findActionRow(element);
      if (!row)
        continue;
      if (hostUnregister && row.matches(BUBBLE_ROW))
        continue;
      const slot = document.createElement("span");
      row.appendChild(slot);
      attach(slot, messageId, true);
    }
  }
  const queueScan = () => {
    if (timer || destroyed)
      return;
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, 120);
  };
  const observer = new MutationObserver(queueScan);
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
  return {
    refresh() {
      for (const slot of slots.keys())
        render(slot);
      queueScan();
    },
    destroy() {
      destroyed = true;
      if (timer)
        clearTimeout(timer);
      observer.disconnect();
      try {
        hostUnregister?.();
      } catch {}
      for (const [slot, meta] of slots) {
        if (meta.own)
          slot.remove();
        else
          slot.replaceChildren();
      }
      slots.clear();
    },
    stats: () => ({ slots: slots.size, hostMount: hostUnregister !== null })
  };
}

// src/frontend.ts
var CSS = `
.stt-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; font-size: 0.78em; }
.stt-btn { font: inherit; cursor: pointer; padding: 2px 8px; border-radius: var(--lumiverse-radius-sm, 6px);
  color: var(--lumiverse-text, inherit); background: var(--lumiverse-fill-subtle, rgba(127,127,127,0.12));
  border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)); }
.stt-btn:hover:not(:disabled) { border-color: var(--lumiverse-primary, currentColor); }
.stt-btn:disabled { opacity: 0.5; cursor: default; }
.stt-btn.stt-primary { background: var(--lumiverse-primary-015, rgba(100,140,255,0.15)); border-color: var(--lumiverse-primary, currentColor); }
.stt-btn.stt-danger { color: var(--lumiverse-danger, #d55); border-color: var(--lumiverse-danger, #d55); }
.stt-note { color: var(--lumiverse-text-muted, inherit); opacity: 0.85; }
.stt-note.stt-warn { color: var(--lumiverse-warning, #c90); opacity: 1; }
.stt-note.stt-err { color: var(--lumiverse-danger, #d55); opacity: 1; }
hr.stt-separator { border: 0; border-top: 1px dashed var(--lumiverse-border, rgba(127,127,127,0.4)); margin: 0.8em 0; }
details.stt-translation > summary { cursor: pointer; color: var(--lumiverse-text-muted, inherit); }
/* Paragraph Reader view (message content) */
.stt-pr { --stt-accent: var(--lumiverse-primary, #6753cf); min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.stt-pr-note { font-size: 12px; color: var(--lumiverse-text-muted, inherit); margin-bottom: 12px; white-space: pre-wrap; }
.stt-pr-pair { margin: 0 0 18px; }
.stt-pr-pair:last-child { margin-bottom: 0; }
.stt-pr-label { display: block; margin-bottom: 4px; font-size: 10px; letter-spacing: .06em; color: var(--lumiverse-text-muted, inherit); font-weight: 700; }
.stt-pr-src { color: var(--lumiverse-text-muted, inherit); font-size: var(--stt-src-size, 16px); line-height: 1.75; }
.stt-pr-tgt { font-size: var(--stt-tgt-size, 18px); line-height: 1.75; border-left: 3px solid var(--stt-accent); padding-left: 12px; margin-top: 8px; }
.stt-pr-src > :first-child, .stt-pr-tgt > :first-child { margin-top: 0; }
.stt-pr-src p, .stt-pr-tgt p { margin: 0 0 .4em; }
.stt-pr-same { font-size: var(--stt-src-size, 16px); }
.stt-pr-pending { color: var(--lumiverse-text-muted, inherit); font-style: italic; }
.stt-pr-tap .stt-pr-tgt { margin-top: 0; }
.stt-pr-orig { border-bottom: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)); padding: 6px 0 12px 15px; }
.stt-pr-orig > summary { cursor: pointer; font-size: 11px; color: var(--lumiverse-text-muted, inherit); }
.stt-pr-orig[open] > summary { color: var(--stt-accent); }
.stt-pr-orig { color: var(--lumiverse-text-muted, inherit); font-size: var(--stt-src-size, 16px); line-height: 1.75; }
/* Message action row buttons (bubble pill and minimal row; the host's own classes are reused where possible) */
.stt-tb { display: inline-flex; align-items: center; justify-content: center; flex: none; padding: 0; cursor: pointer; }
.stt-tb svg { display: block; pointer-events: none; flex: none; }
.stt-tb[data-stt-own] { width: 28px; height: 28px; border: none; border-radius: 6px; background: transparent; color: var(--lumiverse-text-dim, inherit); }
.stt-tb[data-stt-own]:hover { background: var(--lumiverse-fill-subtle, rgba(127,127,127,0.15)); color: var(--lumiverse-text, inherit); }
.stt-tb.stt-tb-del:hover { color: var(--lumiverse-danger, #ef4444); background: var(--lumiverse-danger-015, rgba(239,68,68,0.15)); }
.stt-tb.stt-tb-busy { color: var(--lumiverse-primary, #8b7bff); animation: stt-pulse 1.1s ease-in-out infinite; }
@keyframes stt-pulse { 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .stt-tb.stt-tb-busy { animation: none; } }
/* Target message (panel) */
.stt-target-label { font-weight: 700; word-break: break-word; }
.stt-target-label .stt-note { font-weight: 400; }
.stt-status { white-space: pre-wrap; color: var(--lumiverse-text-muted, inherit); }
.stt-status.stt-err { color: var(--lumiverse-danger, #d55); }
.stt-font-row { display: flex; align-items: center; gap: 7px; }
.stt-font-label { display: flex; align-items: center; flex: 1; gap: 9px; min-width: 0; }
.stt-font-label > span { flex: none; min-width: 2.2em; }
.stt-font-label input[type=range] { flex: 1; min-width: 0; accent-color: var(--lumiverse-primary, #6753cf); }
.stt-font-row .stt-btn { width: 34px; min-width: 34px; padding: 0; font-size: 18px; }
.stt-font-row output { min-width: 3em; text-align: center; font-variant-numeric: tabular-nums; }
.stt-panel { display: flex; flex-direction: column; gap: 12px; padding: 10px; color: var(--lumiverse-text, inherit); font-size: 0.92em; }
.stt-section { display: flex; flex-direction: column; gap: 7px; border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)); border-radius: var(--lumiverse-radius, 8px); padding: 9px; }
.stt-section > h3 { margin: 0; font-size: 1em; }
.stt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.stt-field { display: flex; flex-direction: column; gap: 3px; }
.stt-field > span { color: var(--lumiverse-text-muted, inherit); font-size: 0.9em; }
.stt-panel input[type=text], .stt-panel input[type=number], .stt-panel select, .stt-panel textarea, .stt-modal input, .stt-modal textarea {
  font: inherit; color: inherit; background: var(--lumiverse-fill-subtle, rgba(127,127,127,0.08));
  border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.3)); border-radius: 5px; padding: 5px 7px; box-sizing: border-box; width: 100%; }
.stt-panel textarea, .stt-modal textarea { min-height: 70px; resize: vertical; }
.stt-panel textarea.stt-prompt { min-height: 110px; font-size: 0.85em; }
.stt-panel textarea[readonly] { opacity: 0.75; }
.stt-check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.stt-sub { padding-left: 22px; display: flex; flex-direction: column; gap: 6px; }
.stt-sticky { position: sticky; bottom: 0; background: var(--lumiverse-bg-deep-080, rgba(20,20,24,0.9)); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); padding: 8px 0; }
.stt-modal { display: flex; flex-direction: column; gap: 10px; padding: 4px; }
.stt-modal textarea { min-height: 280px; font-size: 0.85em; }
.stt-sticky.stt-unsaved { border-top: 2px solid var(--lumiverse-warning, #c90); background: color-mix(in srgb, var(--lumiverse-warning, #c90) 22%, var(--lumiverse-bg-deep-080, rgba(20,20,24,0.9))); padding: 8px; border-radius: 8px; }
.stt-unsaved-note { flex: 1 1 100%; font-weight: 700; color: var(--lumiverse-warning, #c90); }
.stt-unsaved-note[hidden] { display: none; }
/* Phones and touch screens: readable text (15px+) and tap targets of 44px+. */
@media (max-width: 768px), (pointer: coarse) {
  .stt-bar, .stt-pr-note, .stt-panel, .stt-modal, .stt-note { font-size: 15px; }
  .stt-pr-label, .stt-pr-orig > summary { font-size: 15px !important; }
  .stt-panel textarea.stt-prompt, .stt-modal textarea { font-size: 15px; }
  .stt-field > span, .stt-section > h3 { font-size: 15px; }
  .stt-btn { min-height: 44px !important; min-width: 44px; padding: 8px 14px !important; }
  .stt-panel input[type=text], .stt-panel input[type=number], .stt-panel select, .stt-modal input { min-height: 44px; font-size: 16px; }
  .stt-check { min-height: 44px; }
  .stt-check input { width: 22px; height: 22px; flex: none; }
  .stt-font-label input[type=range] { min-height: 44px; }
  .stt-pr-orig > summary, details.stt-translation > summary { min-height: 44px; display: flex; align-items: center; }
  .stt-font-row .stt-btn { width: 44px; min-width: 44px; }
  /* .stt-tb is deliberately not enlarged: it follows the host's own action row buttons. */
}
`;
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false)
      continue;
    if (k === "class")
      node.className = String(v);
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node)
      node[k] = v;
    else
      node.setAttribute(k, String(v));
  }
  for (const c of children)
    if (c !== null && c !== undefined && c !== false)
      node.append(c);
  return node;
}
var button = (label, onClick, cls = "", title) => el("button", { type: "button", class: `stt-btn ${cls}`.trim(), title: title ?? label, "aria-label": title ?? label, onClick }, [label]);
var ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
var DISPLAY_LABELS = {
  below: "원문 아래에 번역문",
  only: "번역문만 (원문 숨김)",
  collapsed: "원문 + 접힌 번역문",
  paragraph: "문단 대조 (Paragraph Reader)"
};
function setup(ctx) {
  let store = null;
  let presets = [];
  let connections = [];
  let chatId = null;
  const views = new Map;
  const bars = new Map;
  const pending = new Map;
  let reqCounter = 0;
  let lastDraftTranslation = null;
  let dirty = false;
  let markDirtyUi = null;
  const toBackend = (msg) => ctx.sendToBackend(msg);
  const notify = (kind, text2) => toBackend({ type: "notify", kind, text: text2 });
  const current = () => store ? settingsFor(store, chatId) : DEFAULT_SETTINGS;
  const removeStyle = ctx.dom.addStyle(CSS);
  function chatIdFromLocation() {
    const m = /^\/chat\/([^/?#]+)/.exec(location.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  }
  let hint = {};
  async function sendHint(forChat = chatId) {
    const next = {};
    try {
      const id = ctx.connections?.getActive?.()?.activeProfileId;
      if (typeof id === "string" && id)
        next.activeId = id;
    } catch {}
    try {
      const chat = forChat ? await ctx.chats.get?.(forChat) : null;
      const pinned = chat?.metadata?.connection_profile_id;
      if (typeof pinned === "string" && pinned.trim())
        next.chatId = pinned.trim();
    } catch {}
    hint = next;
    toBackend({ type: "hint", chatId: forChat, activeId: next.activeId, chatConnectionId: next.chatId });
  }
  async function translateText(text2, forChat) {
    await sendHint(forChat);
    const reqId = `t${++reqCounter}`;
    return new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
      toBackend({ type: "translate_text", reqId, chatId: forChat, text: text2 });
    });
  }
  const act = (id, type, force = false) => () => {
    const forChat = chatId;
    if (!forChat)
      return;
    const run = async () => {
      await sendHint(forChat);
      if (type === "translate")
        toBackend({ type, chatId: forChat, messageId: id, force });
      else
        toBackend({ type, chatId: forChat, messageId: id });
    };
    if (!dirty) {
      run();
      return;
    }
    ctx.ui.showConfirm({ title: "저장하지 않은 변경이 있어요", message: `번역 설정을 바꾼 뒤 저장하지 않았습니다. 저장하지 않은 내용은 번역에 반영되지 않습니다.
지금 저장하고 번역할까요?`, variant: "warning", confirmLabel: "저장하고 번역" }).then(({ confirmed }) => {
      if (!confirmed)
        return;
      save(false);
      return run();
    });
  };
  let explicitTarget = null;
  const currentTarget = () => pickTarget([...views.values()], explicitTarget);
  function setTarget(id) {
    if (explicitTarget === id)
      return;
    explicitTarget = id;
    renderTarget();
  }
  const needsBar = (v) => v.role !== "system" && (v.busy || v.status !== null);
  const wantsBar = (v) => current().displayMode !== "paragraph" && needsBar(v);
  function renderBar(bar, view) {
    const id = view.messageId;
    const items = [];
    if (view.busy) {
      items.push(el("span", { class: "stt-note" }, [view.progress ? `번역 중… ${view.progress.done}/${view.progress.total}` : "번역 중…"]));
      items.push(button("취소", () => chatId && toBackend({ type: "cancel", chatId, messageId: id }), "stt-danger"));
    } else {
      if (view.status === "error")
        items.push(el("span", { class: "stt-note stt-err", title: friendlyError(view.error ?? "") }, [`번역 오류: ${friendlyError(view.error ?? "").slice(0, 260)}`]));
      if (view.status === "partial") {
        const progress = view.progress && view.progress.done < view.progress.total ? ` (${view.progress.done}/${view.progress.total})` : "";
        items.push(el("span", { class: "stt-note stt-warn" }, [`번역이 중간에 끊겼습니다${progress}`]));
      }
      if (view.hasMore)
        items.push(button("이어서 번역", act(id, "continue"), "stt-primary", "끊긴 곳부터 이어서 번역합니다"));
      if (view.text) {
        items.push(button(view.hidden ? "번역 보기" : "번역 숨기기", () => chatId && toBackend({ type: "set_hidden", chatId, messageId: id, hidden: !view.hidden })));
      }
    }
    bar.replaceChildren(...items.filter((c) => !!c));
  }
  const confirmFresh = new Set;
  const confirmDelete = new Set;
  let fontStatusText = "모든 채팅에 적용 · 자동 저장";
  let viewSaveTimer = null;
  let localView = { ...DEFAULT_VIEW };
  let removeFontStyle = null;
  let targetHost = null;
  let fontHost = null;
  function applyFontStyle() {
    removeFontStyle?.();
    removeFontStyle = ctx.dom.addStyle(`:root { --stt-src-size: ${localView.sourceFontSize}px; --stt-tgt-size: ${localView.translationFontSize}px; }`);
  }
  function changeFonts(values) {
    localView = normalizeView({ ...localView, ...values });
    applyFontStyle();
    fontStatusText = "크기 저장 중…";
    renderFonts();
    if (viewSaveTimer)
      clearTimeout(viewSaveTimer);
    viewSaveTimer = setTimeout(() => {
      viewSaveTimer = null;
      toBackend({ type: "save_view", view: localView });
      fontStatusText = "크기를 저장했습니다.";
      renderFonts();
    }, 300);
  }
  function renderFonts() {
    if (!fontHost)
      return;
    const rows = [["sourceFontSize", "원문"], ["translationFontSize", "번역"]].map(([key, label]) => {
      const value = localView[key];
      const range = el("input", { type: "range", min: FONT_MIN, max: FONT_MAX, step: 1, value, "aria-label": `${label} 글자 크기` });
      range.addEventListener("change", () => changeFonts({ [key]: Number(range.value) }));
      const minus = button("−", () => changeFonts({ [key]: value - 1 }), "", `${label} 글자 크기 줄이기`);
      const plus = button("+", () => changeFonts({ [key]: value + 1 }), "", `${label} 글자 크기 키우기`);
      minus.disabled = value <= FONT_MIN;
      plus.disabled = value >= FONT_MAX;
      return el("div", { class: "stt-font-row" }, [el("label", { class: "stt-font-label" }, [el("span", {}, [label]), range]), minus, el("output", {}, [`${value}px`]), plus]);
    });
    fontHost.replaceChildren(el("span", {}, [`글자 크기 · 원문 ${localView.sourceFontSize} / 번역 ${localView.translationFontSize}`]), ...rows, el("div", { class: "stt-row" }, [
      button("기본 크기", () => changeFonts({ sourceFontSize: DEFAULT_VIEW.sourceFontSize, translationFontSize: DEFAULT_VIEW.translationFontSize })),
      el("span", { class: "stt-note" }, [fontStatusText])
    ]));
  }
  function renderTarget() {
    if (!targetHost)
      return;
    if (!chatId) {
      targetHost.replaceChildren(el("div", { class: "stt-note" }, ["채팅을 열면 번역할 메시지를 고를 수 있습니다."]));
      return;
    }
    const view = currentTarget();
    if (!view) {
      targetHost.replaceChildren(el("div", { class: "stt-note" }, ["번역할 메시지가 아직 없습니다."]));
      return;
    }
    const id = view.messageId;
    const settings = current();
    const translated = !!view.text;
    const chosenId = store ? effectiveConnectionId(store, chatId) : settings.connectionId;
    const connection = chosenId ? connections.find((c) => c.id === chosenId)?.name ?? "삭제된 연결" : "자동 선택";
    const unit = settings.translationUnit === "paragraph" ? "문단별 요청" : "메시지 통째로 1회 요청";
    let status2 = "";
    let error = false;
    if (view.busy)
      status2 = view.progress ? `번역 중 · ${view.progress.done}/${view.progress.total}` : "번역 중…";
    else if (view.status === "error") {
      status2 = view.error ? friendlyError(view.error) : "번역 오류";
      error = true;
    } else if (view.status === "partial")
      status2 = '완료한 부분까지 저장했습니다. 남은 부분은 "이어서 번역"으로 이어 갑니다.';
    else if (view.status === "done")
      status2 = view.hidden ? "저장된 번역이 있습니다. 지금은 숨겨져 있습니다." : "저장된 번역입니다. 표시 방식을 바꾸거나 보기를 전환해도 다시 번역하지 않습니다.";
    else
      status2 = settings.autoTranslate ? "응답 자동 번역이 켜져 있습니다. 아래 버튼으로 바로 번역할 수도 있습니다." : "아직 번역하지 않았습니다. 새 번역은 버튼을 눌렀을 때만 요청합니다.";
    const actions = [];
    if (view.busy) {
      actions.push(button("중단", () => toBackend({ type: "cancel", chatId, messageId: id })));
    } else if (!translated) {
      const label = settings.translationUnit === "paragraph" ? "문단 번역" : "번역";
      actions.push(button(view.requestsNeeded > 0 ? `${label} · ${view.requestsNeeded}회 요청` : label, act(id, "translate", true), "stt-primary"));
    } else if (view.hasMore) {
      actions.push(button(view.requestsNeeded > 0 ? `이어서 번역 · ${view.requestsNeeded}회 요청` : "이어서 번역", act(id, "continue"), "stt-primary"));
    } else {
      const fresh = confirmFresh.has(id);
      actions.push(button(fresh ? "확인: 새로 번역 요청" : "새로 번역", () => {
        if (!fresh) {
          confirmFresh.add(id);
          renderTarget();
          return;
        }
        confirmFresh.delete(id);
        act(id, "translate", true)();
      }, "stt-primary"));
      actions.push(button("이어서 번역", act(id, "continue"), "", "끊긴 것 같으면 한 번 더 이어 붙여 봅니다"));
    }
    if (translated && !view.busy) {
      actions.push(button(view.hidden ? "번역 보기" : "번역 숨기기", () => toBackend({ type: "set_hidden", chatId, messageId: id, hidden: !view.hidden })));
      const sure = confirmDelete.has(id);
      actions.push(button(sure ? "확인: 저장 번역 삭제" : "이 메시지 저장 삭제", () => {
        if (!sure) {
          confirmDelete.add(id);
          renderTarget();
          return;
        }
        confirmDelete.delete(id);
        toBackend({ type: "delete_translation", chatId, messageId: id });
      }, "stt-danger"));
    }
    targetHost.replaceChildren(el("div", { class: "stt-target-label" }, [`대상 메시지: ${targetLabel(view)}`, el("span", { class: "stt-note" }, [explicitTarget === id ? "" : " (자동 선택)"])]), el("div", { class: "stt-note" }, ["메시지의 번역 버튼이나 번역문을 누르면 그 메시지가 대상이 됩니다."]), el("div", { class: "stt-note" }, [`번역: ${connection} · ${settings.myLanguage} · ${unit}`]), el("div", { class: `stt-status${error ? " stt-err" : ""}`, role: "status" }, [status2]), el("div", { class: "stt-row" }, actions));
  }
  const registerDecorator = ctx.ui.registerDomDecorator;
  const toolbars = mountToolbars({
    registerDecorator: typeof registerDecorator === "function" ? (spec) => registerDecorator.call(ctx.ui, spec) : null,
    listMessageElements: () => ctx.dom.listMessageElements(),
    getView: (id) => views.get(id),
    onTranslate: (id, force) => {
      setTarget(id);
      act(id, "translate", force)();
    },
    onCancel: (id) => {
      setTarget(id);
      if (chatId)
        toBackend({ type: "cancel", chatId, messageId: id });
    },
    onDelete: (id) => {
      setTarget(id);
      const forChat = chatId;
      const view = views.get(id);
      if (!forChat || !view)
        return;
      ctx.ui.showConfirm({ title: "번역 삭제", message: `${targetLabel(view)} 메시지에 저장된 번역문을 지울까요?
메시지 원문은 그대로 남습니다.`, variant: "danger", confirmLabel: "번역 삭제" }).then(({ confirmed }) => {
        if (confirmed)
          toBackend({ type: "delete_translation", chatId: forChat, messageId: id });
      });
    }
  });
  const onDocClick = (e) => {
    const t = e.target;
    if (!(t instanceof Element) || t.closest("[data-stt-tb]"))
      return;
    const id = ctx.dom.getMessageId(t);
    if (id && views.get(id)?.text)
      setTarget(id);
  };
  document.addEventListener("click", onDocClick, true);
  function decorate() {
    if (!chatId)
      return;
    for (const view of views.values()) {
      let bar = bars.get(view.messageId);
      if (!wantsBar(view)) {
        if (bar) {
          ctx.dom.uninject(bar);
          bars.delete(view.messageId);
        }
        continue;
      }
      if (!bar) {
        const bubble = ctx.dom.findMessageElement(view.messageId);
        if (!bubble)
          continue;
        const slot = bubble.querySelector('[data-spindle-mount="message_footer"]') ?? bubble;
        bar = ctx.dom.inject(slot, "<div></div>", "beforeend");
        bar.classList.add("stt-bar");
        bars.set(view.messageId, bar);
      }
      renderBar(bar, view);
    }
    toolbars.refresh();
    renderTarget();
  }
  let decorateQueued = false;
  const queueDecorate = () => {
    if (decorateQueued)
      return;
    decorateQueued = true;
    setTimeout(() => {
      decorateQueued = false;
      decorate();
    }, 150);
  };
  const missingBar = () => [...views.values()].some((v) => wantsBar(v) && !bars.has(v.messageId) && ctx.dom.findMessageElement(v.messageId));
  const observer = new MutationObserver(() => {
    if (chatId && missingBar())
      queueDecorate();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  function resetChat(next) {
    for (const bar of bars.values())
      ctx.dom.uninject(bar);
    bars.clear();
    views.clear();
    explicitTarget = null;
    confirmFresh.clear();
    confirmDelete.clear();
    chatId = next;
    renderDraftButton();
    renderPanel();
    if (next) {
      sendHint(next);
      toBackend({ type: "chat", chatId: next });
    }
  }
  const routeTimer = setInterval(() => {
    const next = chatIdFromLocation();
    if (next !== chatId)
      resetChat(next);
  }, 700);
  const refreshViews = () => chatId && toBackend({ type: "chat", chatId });
  let refreshTimer = null;
  const queueRefresh = () => {
    if (refreshTimer)
      clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshViews, 400);
  };
  const offEvents = ["MESSAGE_SENT", "MESSAGE_EDITED", "MESSAGE_SWIPED", "MESSAGE_DELETED", "GENERATION_ENDED"].map((name) => ctx.events.on(name, (payload) => {
    const p = payload;
    if (!p?.chatId || p.chatId === chatId)
      queueRefresh();
  }));
  const originalFetch = window.fetch;
  const translatingFetch = async function(input, init) {
    try {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const m = /\/api\/v1\/chats\/([^/?#]+)\/messages(?:[?#]|$)/.exec(new URL(url, location.href).pathname + "");
      if (method === "POST" && m && typeof init?.body === "string" && store) {
        const target = decodeURIComponent(m[1]);
        const settings = settingsFor(store, target);
        const body = JSON.parse(init.body);
        const content = typeof body.content === "string" ? body.content : "";
        if (settings.translateMyMessages && body.is_user === true && content.trim() && content !== "(attached)" && content !== lastDraftTranslation) {
          try {
            const translated = await translateText(content, target);
            init = { ...init, body: JSON.stringify({ ...body, content: translated }) };
          } catch (e) {
            notify("error", `내 메시지 번역에 실패해 원문을 보냈습니다: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        lastDraftTranslation = null;
      }
    } catch {}
    return originalFetch.call(this ?? window, input, init);
  };
  window.fetch = Object.assign(translatingFetch, { preconnect: originalFetch.preconnect });
  const draftRoot = ctx.ui.mount("chat_input_tools_right");
  let draftBusy = false;
  function renderDraftButton() {
    draftRoot.replaceChildren();
    if (!chatId || !current().showDraftButton)
      return;
    const b = button(draftBusy ? "번역 중…" : "번역", () => void translateDraft(), "", `입력한 글을 ${current().modelLanguage}로 번역합니다`);
    b.disabled = draftBusy;
    draftRoot.append(b);
  }
  async function translateDraft() {
    const ta = document.querySelector('textarea[name="chat-message"]');
    if (!ta || !chatId || !ta.value.trim())
      return;
    draftBusy = true;
    renderDraftButton();
    try {
      const translated = await translateText(ta.value, chatId);
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, translated);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
      lastDraftTranslation = translated.trim();
    } catch (e) {
      notify("error", `번역 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      draftBusy = false;
      renderDraftButton();
    }
  }
  const tab = ctx.ui.registerDrawerTab({
    id: "translator",
    title: "양방향 번역",
    shortName: "번역",
    description: "양방향 번역: 프리셋, 단어장, 자동 번역, 이어서 번역",
    keywords: ["translate", "translation", "glossary", "번역", "단어장"],
    headerTitle: "양방향 번역",
    iconSvg: ICON
  });
  const panel = el("div", { class: "stt-panel" });
  tab.root.replaceChildren(panel);
  let draft = { ...DEFAULT_SETTINGS };
  let status = "";
  function check(label, key, onChange) {
    const input = el("input", { type: "checkbox", checked: draft[key] === true });
    input.addEventListener("change", () => {
      draft[key] = input.checked;
      markDirty();
      onChange?.();
    });
    return el("label", { class: "stt-check" }, [input, label]);
  }
  function text(label, key, opts = {}) {
    const input = opts.multiline ? el("textarea", { value: String(draft[key] ?? ""), placeholder: opts.placeholder ?? "", class: opts.cls ?? "", spellcheck: false }) : el("input", { type: "text", value: String(draft[key] ?? ""), placeholder: opts.placeholder ?? "" });
    input.setAttribute("data-stt-field", key);
    input.addEventListener("input", () => {
      draft[key] = input.value;
      panel.querySelectorAll(`[data-stt-field="${key}"]`).forEach((other) => {
        if (other !== input)
          other.value = input.value;
      });
      markDirty();
    });
    return el("label", { class: "stt-field" }, [el("span", {}, [label]), input]);
  }
  function select(label, value, options, onChange, unsaved = true, rerender = false) {
    const s = el("select", {}, options.map(([v, l]) => el("option", { value: v, selected: v === value }, [l])));
    s.addEventListener("change", () => {
      onChange(s.value);
      if (unsaved)
        markDirty();
      if (rerender)
        renderPanel();
    });
    return el("label", { class: "stt-field" }, [el("span", {}, [label]), s]);
  }
  function promptSection(direction) {
    const presetKey = direction === "incoming" ? "incomingPresetId" : "outgoingPresetId";
    const promptKey = direction === "incoming" ? "incomingPrompt" : "outgoingPrompt";
    const presetId = draft[presetKey];
    const preset = presets.find((p) => p.id === presetId);
    const inherit = !preset || presetId === INHERIT_PRESET_ID;
    const box = el("div", { class: "stt-field" });
    const options = presets.map((p) => [p.id, p.builtin ? p.name : `${p.name} (내 프리셋)`]);
    box.append(select(direction === "incoming" ? "응답 번역 프롬프트 (Incoming)" : "내 메시지 번역 프롬프트 (Outgoing)", presetId, options, (v) => {
      draft[presetKey] = v;
      renderPanel();
    }));
    if (inherit) {
      box.append(text("이 채팅의 프롬프트 (비워 두면 Marinara 기본 프롬프트, {{targetLanguage}} 사용 가능)", promptKey, { multiline: true, cls: "stt-prompt" }));
    } else {
      box.append(el("textarea", { class: "stt-prompt", readOnly: true, value: preset.prompt }));
    }
    return box;
  }
  function editPreset(existing) {
    const modal = ctx.ui.showModal({ title: existing ? "프리셋 수정" : "새 프리셋", width: 680, maxHeight: 820, persistent: true });
    const name = el("input", { type: "text", value: existing?.name ?? "", placeholder: "프리셋 이름" });
    const prompt = el("textarea", { value: existing?.prompt ?? "", placeholder: "번역 시스템 프롬프트. {{targetLanguage}} 는 대상 언어로 바뀝니다.", spellcheck: false });
    modal.root.replaceChildren(el("div", { class: "stt-modal" }, [
      el("label", { class: "stt-field" }, [el("span", {}, ["이름"]), name]),
      el("label", { class: "stt-field" }, [el("span", {}, ["프롬프트 전문"]), prompt]),
      el("div", { class: "stt-row" }, [
        button("저장", () => {
          if (!name.value.trim() || !prompt.value.trim())
            return notify("warning", "이름과 프롬프트를 입력해 주세요.");
          toBackend({ type: "save_preset", preset: { id: existing?.id ?? "", name: name.value, prompt: prompt.value } });
          modal.dismiss();
        }, "stt-primary"),
        button("취소", () => modal.dismiss())
      ])
    ]));
  }
  function presetManager() {
    const mine = presets.filter((p) => !p.builtin);
    const row = el("div", { class: "stt-row" }, [
      button("+ 새 프리셋", () => editPreset(null)),
      button("기본 프리셋 복사해서 새로 만들기", () => {
        const base = presets.find((p) => p.id === draft.incomingPresetId && p.prompt);
        editPreset(base ? { ...base, id: "", name: `${base.name} 사본`, builtin: false } : null);
      }, "", "응답 번역에 선택된 프리셋을 복사합니다")
    ]);
    const list = mine.map((p) => el("div", { class: "stt-row" }, [
      el("span", { style: "flex:1" }, [p.name]),
      button("수정", () => editPreset(p)),
      button("삭제", async () => {
        const { confirmed } = await ctx.ui.showConfirm({ title: "프리셋 삭제", message: `"${p.name}" 프리셋을 삭제할까요? 이 프리셋을 쓰던 채팅은 "채팅 설정 유지"로 돌아갑니다.`, variant: "danger", confirmLabel: "삭제" });
        if (confirmed)
          toBackend({ type: "delete_preset", id: p.id });
      }, "stt-danger")
    ]));
    return el("div", { class: "stt-field" }, [row, ...list.length ? list : [el("span", { class: "stt-note" }, ["내 프리셋이 없습니다. 기본 프리셋은 읽기 전용입니다."])]]);
  }
  function markDirty() {
    dirty = true;
    status = "";
    tab.setBadge("!");
    markDirtyUi?.();
  }
  function clearDirty() {
    dirty = false;
    tab.setBadge(null);
    markDirtyUi?.();
  }
  function save(asDefault) {
    toBackend({ type: "save_settings", chatId, settings: draft, asDefault });
    clearDirty();
    status = asDefault ? "저장했습니다. 새 채팅의 기본값으로도 저장했습니다." : "저장했습니다.";
  }
  function renderPanel() {
    if (!store) {
      panel.replaceChildren(el("div", { class: "stt-note" }, ["불러오는 중…"]));
      return;
    }
    if (!dirty) {
      draft = { ...current() };
      draft.connectionId = effectiveConnectionId(store, chatId);
    }
    const connectionOptions = [["", "자동 (채팅에 지정된 연결 → 지금 쓰는 연결 → 기본 연결)"], ...connections.map((c) => [c.id, `${c.name} · ${c.model}${c.isDefault ? " (기본)" : ""}`])];
    if (draft.connectionId && !connections.some((c) => c.id === draft.connectionId))
      connectionOptions.push([draft.connectionId, "(삭제된 연결)"]);
    const picked = pickConnection(connections.map((c) => ({ id: c.id, name: c.name, is_default: c.isDefault })), draft.connectionId || undefined, hint);
    const pickedName = picked ? connections.find((c) => c.id === picked.id)?.name ?? picked.id : "";
    const connectionNote = !connections.length ? el("div", { class: "stt-note stt-err" }, ["Lumiverse에 AI 연결이 없습니다. Lumiverse 설정의 연결에서 연결을 하나 만들어 주세요."]) : el("div", { class: `stt-note${picked?.staleId ? " stt-warn" : ""}` }, [
      picked?.staleId ? `고른 연결이 삭제돼 대신 "${pickedName}" (${SOURCE_LABELS[picked.source]})으로 번역합니다. 다시 골라 주세요.` : `번역에 쓰일 연결: ${pickedName} (${SOURCE_LABELS[picked?.source ?? "host"]}). 연결은 고르는 즉시 저장됩니다.`
    ]);
    const saveNotice = el("span", { class: "stt-unsaved-note", role: "status" }, ["저장하지 않은 변경이 있어요. 저장 버튼을 눌러야 적용됩니다."]);
    const saveRow = el("div", { class: "stt-row stt-sticky" }, [
      saveNotice,
      button("저장", () => save(false), "stt-primary"),
      chatId ? button("저장 + 새 채팅 기본값으로", () => save(true)) : null,
      button("되돌리기", () => {
        clearDirty();
        renderPanel();
      }),
      status ? el("span", { class: "stt-note" }, [status]) : null
    ]);
    markDirtyUi = () => {
      saveRow.classList.toggle("stt-unsaved", dirty);
      saveNotice.hidden = !dirty;
    };
    markDirtyUi();
    const contextSub = el("div", { class: "stt-sub" }, [
      el("div", { class: "stt-row" }, [check("원문 포함", "contextIncludeOriginal"), check("번역문 포함", "contextIncludeTranslation"), check("내 메시지 번역에도 포함", "contextIncludeUserInput")]),
      (() => {
        const n = el("input", { type: "number", min: 1, max: 10, value: draft.contextMessageCount });
        n.addEventListener("input", () => {
          draft.contextMessageCount = Number(n.value) || 3;
          markDirty();
        });
        return el("label", { class: "stt-field" }, [el("span", {}, ["최근 메시지 수 (1~10)"]), n]);
      })()
    ]);
    const split = el("input", { type: "number", min: 0, step: 500, value: draft.longSplitChars });
    split.addEventListener("input", () => {
      draft.longSplitChars = Math.max(0, Number(split.value) || 0);
      markDirty();
    });
    targetHost = el("div", { class: "stt-field" });
    fontHost = el("div", { class: "stt-field" });
    const paragraphMode = draft.displayMode === "paragraph";
    const paragraphSection = () => el("div", { class: "stt-section" }, [
      el("h3", {}, ["문단 대조 (Paragraph Reader)"]),
      select("보기", localView.paragraphView, [["interleave", "원문·번역 교차"], ["tap", "눌러서 원문 (번역만 보이고, 문단마다 눌러서 원문을 펼침)"]], (v) => {
        localView = { ...localView, paragraphView: v === "tap" ? "tap" : "interleave" };
        toBackend({ type: "save_view", view: localView });
      }, false),
      text('도착 언어 (응답을 번역할 언어, "내 언어"와 같은 설정)', "myLanguage"),
      fontHost,
      el("div", { class: "stt-note" }, ["보기와 글자 크기는 바로 적용되고 저장됩니다. 도착 언어는 아래 저장 버튼으로 저장합니다."]),
      el("h3", {}, ["선택한 메시지"]),
      targetHost
    ]);
    const targetSection = () => el("div", { class: "stt-section" }, [el("h3", {}, ["메시지 번역"]), targetHost]);
    panel.replaceChildren(el("div", { class: "stt-note" }, [chatId ? "지금 열린 채팅의 번역 설정입니다." : "열린 채팅이 없어 새 채팅의 기본값을 편집합니다."]), el("div", { class: "stt-section" }, [
      el("h3", {}, ["기본 번역"]),
      select("번역에 쓸 AI 연결", draft.connectionId, connectionOptions, (v) => {
        draft.connectionId = v;
        toBackend({ type: "save_connection", chatId, connectionId: v });
        status = "연결을 저장했습니다.";
      }, false),
      connectionNote,
      el("div", { class: "stt-row" }, [text("모델 언어 (내 메시지를 이 언어로)", "modelLanguage"), text("내 언어 (응답을 이 언어로)", "myLanguage")]),
      check("AI 응답 자동 번역", "autoTranslate"),
      check("번역이 끊기면 자동으로 이어서 번역", "autoContinue"),
      select("번역문 표시 방식", draft.displayMode, Object.entries(DISPLAY_LABELS), (v) => draft.displayMode = v, true, true),
      select("번역 단위", draft.translationUnit, [
        ["whole", "메시지 통째로 (1회 요청, 문단 수가 같으면 문단별로 맞춰 보여 줌)"],
        ["paragraph", "문단별 (문단마다 1회 요청, 문단 대조가 정확히 맞음)"]
      ], (v) => draft.translationUnit = v === "paragraph" ? "paragraph" : "whole"),
      check("내 메시지를 보내기 전에 번역 (채팅에는 번역문이 남습니다)", "translateMyMessages"),
      check("입력창 옆에 번역 버튼 표시", "showDraftButton")
    ]), paragraphMode ? paragraphSection() : targetSection(), el("div", { class: "stt-section" }, [el("h3", {}, ["프롬프트 프리셋"]), promptSection("incoming"), promptSection("outgoing"), presetManager()]), el("div", { class: "stt-section" }, [
      el("h3", {}, ["단어장"]),
      text("한 줄에 한 쌍: 내 언어 용어 = 모델 언어 용어 (양방향 적용)", "glossary", { multiline: true, placeholder: `마리나라 = Marinara
로어북 = lorebook` })
    ]), el("div", { class: "stt-section" }, [
      el("h3", {}, ["참고 정보"]),
      check("기타 지침 추가 (장르·시대·지역·배경 등)", "freeContextEnabled", renderPanel),
      draft.freeContextEnabled ? el("div", { class: "stt-sub" }, [text("기타 지침", "freeContext", { multiline: true })]) : null,
      check("대사 지침 추가 (응답 번역에만)", "incomingVoiceEnabled", renderPanel),
      draft.incomingVoiceEnabled ? el("div", { class: "stt-sub" }, [text("대사 지침 (# Character Voice Instructions)", "incomingVoicePrompt", { multiline: true })]) : null,
      check("이전 대화를 번역 참고로 포함", "contextEnabled", renderPanel),
      draft.contextEnabled ? contextSub : null
    ]), el("div", { class: "stt-section" }, [
      el("h3", {}, ["번역하지 않을 부분"]),
      check("HTML 태그·속성, <style>, <script> 는 그대로 두고 글자만 번역", "protectHtml"),
      check("코드 블록(```) 은 번역하지 않음", "protectCode"),
      text("제외 규칙 (한 줄에 하나)", "excludeRules", { multiline: true, placeholder: `<status>
/HP: \\d+\\/\\d+/
[상태창] ... [/상태창]` }),
      el("div", { class: "stt-note" }, ["<태그> 는 그 요소 전체, /정규식/ 은 일치하는 부분, 시작 ... 끝 은 그 사이 전체를 원문 그대로 둡니다. {{매크로}} 는 항상 그대로 둡니다."])
    ]), el("div", { class: "stt-section" }, [
      el("h3", {}, ["긴 지문"]),
      el("label", { class: "stt-field" }, [el("span", {}, ["이 글자 수 이상이면 문단별로 나눠 번역 (0 = 나누지 않음)"]), split])
    ]), saveRow);
    renderFonts();
    renderTarget();
  }
  const onBeforeUnload = (e) => {
    if (!dirty)
      return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  const action = ctx.ui.registerInputBarAction({ id: "open-translator", label: "번역 설정" });
  const offAction = action.onClick(() => tab.activate());
  const offBackend = ctx.onBackendMessage((raw) => {
    const msg = raw;
    switch (msg?.type) {
      case "state": {
        const shape = (st) => JSON.stringify([st.chats, st.defaults, st.view.paragraphView]);
        const before = store ? shape(store) : null;
        store = msg.store;
        presets = msg.presets;
        connections = msg.connections;
        if (!viewSaveTimer) {
          localView = { ...store.view };
          applyFontStyle();
        }
        if (before !== null && before !== shape(store))
          ctx.display?.invalidate?.(["*"]);
        decorate();
        renderPanel();
        renderDraftButton();
        return;
      }
      case "views":
        if (msg.chatId !== chatId)
          return;
        if (msg.replace) {
          const keep = new Set(msg.views.map((v) => v.messageId));
          for (const [id, bar] of bars)
            if (!keep.has(id)) {
              ctx.dom.uninject(bar);
              bars.delete(id);
            }
          views.clear();
        }
        for (const v of msg.views)
          views.set(v.messageId, v);
        decorate();
        return;
      case "text_result": {
        const p = pending.get(msg.reqId);
        if (!p)
          return;
        pending.delete(msg.reqId);
        if (msg.ok && typeof msg.text === "string")
          p.resolve(msg.text);
        else
          p.reject(new Error(msg.error || "번역 실패"));
        return;
      }
    }
  });
  renderPanel();
  toBackend({ type: "hello" });
  sendHint();
  resetChat(chatIdFromLocation());
  return () => {
    clearInterval(routeTimer);
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (viewSaveTimer)
      clearTimeout(viewSaveTimer);
    removeFontStyle?.();
    observer.disconnect();
    toolbars.destroy();
    document.removeEventListener("click", onDocClick, true);
    offEvents.forEach((off) => off());
    offBackend();
    offAction();
    action.destroy();
    tab.destroy();
    if (window.fetch === translatingFetch)
      window.fetch = originalFetch;
    for (const p of pending.values())
      p.reject(new Error("확장이 종료되었습니다."));
    removeStyle();
    ctx.dom.cleanup();
  };
}
export {
  setup
};
