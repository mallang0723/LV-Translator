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
/* Paragraph Reader panel (above the content) */
.stt-pr-widget { --stt-accent: var(--lumiverse-primary, #6753cf); font-size: 14px; line-height: 1.6; margin: 4px 0 10px; min-width: 0; max-width: 100%; text-align: left; }
.stt-pr-widget * { box-sizing: border-box; }
.stt-pr-widget button, .stt-pr-widget select, .stt-pr-widget input { font: inherit; color: inherit; }
.stt-pr-widget button { cursor: pointer; border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.35)); border-radius: 9px; background: transparent; padding: 5px 10px; min-height: 34px; line-height: 1.3; }
.stt-pr-widget button:hover:not(:disabled) { border-color: var(--stt-accent); }
.stt-pr-widget button:disabled { opacity: .5; cursor: default; }
.stt-pr-launch { color: var(--lumiverse-text-muted, inherit); font-size: 12px !important; padding: 4px 9px !important; min-height: 30px !important; }
.stt-pr-panel { border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.35)); border-radius: 14px; padding: 14px; margin-top: 7px; background: var(--lumiverse-fill-subtle, transparent); }
.stt-pr-head, .stt-pr-controls, .stt-pr-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.stt-pr-head { justify-content: space-between; margin-bottom: 12px; }
.stt-pr-title { font-size: 14px; font-weight: 700; }
.stt-pr-pill { color: var(--stt-accent); font-size: 11px; font-weight: 700; background: color-mix(in srgb, var(--stt-accent) 12%, transparent); border-radius: 20px; padding: 2px 8px; }
.stt-pr-controls { font-size: 12px; color: var(--lumiverse-text-muted, inherit); }
.stt-pr-controls label { display: inline-flex; align-items: center; gap: 5px; }
.stt-pr-controls input, .stt-pr-controls select { border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.35)); border-radius: 7px; background: transparent; padding: 5px 7px; min-height: 34px; }
.stt-pr-controls input { width: 90px; }
.stt-pr-font { margin-top: 12px; border: 1px solid var(--lumiverse-border, rgba(127,127,127,0.35)); border-radius: 10px; padding: 8px 10px; font-size: 12px; }
.stt-pr-font > summary { cursor: pointer; }
.stt-pr-font-row { display: flex; align-items: center; gap: 7px; margin: 8px 0; }
.stt-pr-font-label { display: flex; align-items: center; flex: 1; gap: 9px; min-width: 0; }
.stt-pr-font-label input[type=range] { flex: 1; min-width: 0; accent-color: var(--stt-accent); }
.stt-pr-font-row button { width: 34px; min-width: 34px; padding: 0 !important; font-size: 18px; }
.stt-pr-font-row output { min-width: 37px; text-align: center; font-variant-numeric: tabular-nums; }
.stt-pr-font-footer { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.stt-pr-provider, .stt-pr-status { font-size: 12px; color: var(--lumiverse-text-muted, inherit); margin-top: 9px; white-space: pre-wrap; }
.stt-pr-status.stt-err { color: var(--lumiverse-danger, #c23b45); }
.stt-pr-actions { margin-top: 10px; }
.stt-pr-actions button { font-size: 12px; }
.stt-pr-widget .stt-pr-primary { background: var(--stt-accent); color: #fff; border-color: transparent; font-weight: 600; }
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
.stt-sticky { position: sticky; bottom: 0; background: var(--lumiverse-bg-deep-080, rgba(20,20,24,0.9)); padding: 8px 0; }
.stt-modal { display: flex; flex-direction: column; gap: 10px; padding: 4px; }
.stt-modal textarea { min-height: 280px; font-size: 0.85em; }
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
  const toBackend = (msg) => ctx.sendToBackend(msg);
  const notify = (kind, text) => toBackend({ type: "notify", kind, text });
  const current = () => store ? settingsFor(store, chatId) : DEFAULT_SETTINGS;
  const removeStyle = ctx.dom.addStyle(CSS);
  function chatIdFromLocation() {
    const m = /^\/chat\/([^/?#]+)/.exec(location.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function translateText(text, forChat) {
    const reqId = `t${++reqCounter}`;
    return new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
      toBackend({ type: "translate_text", reqId, chatId: forChat, text });
    });
  }
  const act = (id, type, force = false) => () => {
    if (!chatId)
      return;
    if (type === "translate")
      toBackend({ type, chatId, messageId: id, force });
    else
      toBackend({ type, chatId, messageId: id });
  };
  function renderBar(bar, view) {
    const id = view.messageId;
    const items = [];
    if (view.busy) {
      items.push(el("span", { class: "stt-note" }, [view.progress ? `번역 중… ${view.progress.done}/${view.progress.total}` : "번역 중…"]));
      items.push(button("취소", () => chatId && toBackend({ type: "cancel", chatId, messageId: id }), "stt-danger"));
    } else if (!view.status) {
      items.push(button("번역", act(id, "translate"), "stt-primary"));
    } else {
      if (view.status === "error")
        items.push(el("span", { class: "stt-note stt-err", title: view.error ?? "" }, [`번역 오류: ${(view.error ?? "").slice(0, 120)}`]));
      if (view.status === "partial") {
        const progress = view.progress && view.progress.done < view.progress.total ? ` (${view.progress.done}/${view.progress.total})` : "";
        items.push(el("span", { class: "stt-note stt-warn" }, [`번역이 중간에 끊겼습니다${progress}`]));
      }
      items.push(button("이어서 번역", act(id, "continue"), view.hasMore ? "stt-primary" : "", "끊긴 곳부터 이어서 번역합니다"));
      items.push(button(view.status === "error" ? "다시 시도" : "다시 번역", act(id, "translate", true)));
      if (view.text) {
        items.push(button(view.hidden ? "번역 보기" : "번역 숨기기", () => chatId && toBackend({ type: "set_hidden", chatId, messageId: id, hidden: !view.hidden })));
      }
    }
    bar.replaceChildren(...items.filter((c) => !!c));
  }
  const panelOpen = new Map;
  const confirmFresh = new Set;
  const confirmDelete = new Set;
  let fontStatusText = "모든 문단 대조에 적용 · 자동 저장";
  let viewSaveTimer = null;
  let localView = { ...DEFAULT_VIEW };
  let removeFontStyle = null;
  function applyFontStyle() {
    removeFontStyle?.();
    removeFontStyle = ctx.dom.addStyle(`:root { --stt-src-size: ${localView.sourceFontSize}px; --stt-tgt-size: ${localView.translationFontSize}px; }`);
  }
  function changeFonts(values) {
    localView = normalizeView({ ...localView, ...values });
    applyFontStyle();
    fontStatusText = "크기 저장 중…";
    decorate();
    if (viewSaveTimer)
      clearTimeout(viewSaveTimer);
    viewSaveTimer = setTimeout(() => {
      toBackend({ type: "save_view", view: localView });
      fontStatusText = "크기를 저장했습니다.";
    }, 300);
  }
  function fontSettings() {
    const panel = el("details", { class: "stt-pr-font" });
    panel.append(el("summary", {}, [`글자 크기 · 원문 ${localView.sourceFontSize} / 번역 ${localView.translationFontSize}`]));
    for (const [key, label] of [["sourceFontSize", "원문"], ["translationFontSize", "번역"]]) {
      const value = localView[key];
      const range = el("input", { type: "range", min: FONT_MIN, max: FONT_MAX, step: 1, value, "aria-label": `${label} 글자 크기` });
      range.addEventListener("change", () => changeFonts({ [key]: Number(range.value) }));
      const minus = button("−", () => changeFonts({ [key]: value - 1 }), "", `${label} 글자 크기 줄이기`);
      const plus = button("+", () => changeFonts({ [key]: value + 1 }), "", `${label} 글자 크기 키우기`);
      minus.disabled = value <= FONT_MIN;
      plus.disabled = value >= FONT_MAX;
      panel.append(el("div", { class: "stt-pr-font-row" }, [el("label", { class: "stt-pr-font-label" }, [el("span", {}, [label]), range]), minus, el("output", {}, [`${value}px`]), plus]));
    }
    panel.append(el("div", { class: "stt-pr-font-footer" }, [
      button("기본 크기", () => changeFonts({ sourceFontSize: DEFAULT_VIEW.sourceFontSize, translationFontSize: DEFAULT_VIEW.translationFontSize })),
      el("span", { class: "stt-note" }, [fontStatusText])
    ]));
    panel.open = fontPanelOpen;
    panel.addEventListener("toggle", () => fontPanelOpen = panel.open);
    return panel;
  }
  let fontPanelOpen = false;
  function renderParagraphPanel(widget, view) {
    const id = view.messageId;
    const settings = current();
    const translated = !!view.text;
    const open = translated ? !view.hidden : panelOpen.get(id) === true;
    const launch = button(open ? "대조 접기" : "문단 대조", () => {
      confirmFresh.delete(id);
      confirmDelete.delete(id);
      if (translated && chatId)
        toBackend({ type: "set_hidden", chatId, messageId: id, hidden: open });
      else {
        panelOpen.set(id, !open);
        decorate();
      }
    }, "stt-pr-launch");
    launch.setAttribute("aria-expanded", String(open));
    if (!open) {
      widget.replaceChildren(launch);
      return;
    }
    const mode = el("select", {}, [
      el("option", { value: "interleave", selected: localView.paragraphView === "interleave" }, ["원문·번역 교차"]),
      el("option", { value: "tap", selected: localView.paragraphView === "tap" }, ["눌러서 원문"])
    ]);
    mode.addEventListener("change", () => {
      localView = { ...localView, paragraphView: mode.value === "tap" ? "tap" : "interleave" };
      toBackend({ type: "save_view", view: localView });
    });
    const target = el("input", { type: "text", value: settings.myLanguage, maxLength: 100, title: '응답을 번역할 언어 (이 채팅 설정의 "내 언어")' });
    target.addEventListener("change", () => {
      if (!chatId || !target.value.trim())
        return;
      toBackend({ type: "save_settings", chatId, settings: { ...current(), myLanguage: target.value.trim() }, asDefault: false });
    });
    const connection = settings.connectionId ? connections.find((c) => c.id === settings.connectionId)?.name ?? "삭제된 연결" : "현재 사용 중인 연결";
    const unit = settings.translationUnit === "paragraph" ? "문단별 요청" : "메시지 통째로 1회 요청";
    let status = "";
    let error = false;
    if (view.busy)
      status = view.progress ? `번역 중 · ${view.progress.done}/${view.progress.total}` : "번역 중…";
    else if (view.status === "error") {
      status = view.error ?? "번역 오류";
      error = true;
    } else if (view.status === "partial")
      status = '완료한 부분까지 저장했습니다. 남은 부분은 "이어서 번역"으로 이어 갑니다.';
    else if (view.status === "done")
      status = "저장된 번역입니다. 접기·보기 전환과 글자 크기 변경은 다시 번역하지 않습니다.";
    else
      status = settings.autoTranslate ? "응답 자동 번역이 켜져 있습니다. 아래 버튼으로 바로 번역할 수도 있습니다." : "새 번역은 아래 버튼을 눌렀을 때만 요청합니다. 접기·보기 전환은 재번역하지 않습니다.";
    const actions = [];
    if (view.busy) {
      actions.push(button("중단", () => chatId && toBackend({ type: "cancel", chatId, messageId: id })));
    } else if (!translated) {
      const label = settings.translationUnit === "paragraph" ? "문단 번역" : "번역";
      actions.push(button(view.requestsNeeded > 0 ? `${label} · ${view.requestsNeeded}회 요청` : label, act(id, "translate", true), "stt-pr-primary"));
    } else if (view.hasMore) {
      actions.push(button(view.requestsNeeded > 0 ? `이어서 번역 · ${view.requestsNeeded}회 요청` : "이어서 번역", act(id, "continue"), "stt-pr-primary"));
    } else {
      const fresh = confirmFresh.has(id);
      actions.push(button(fresh ? "확인: 새로 번역 요청" : "새로 번역", () => {
        if (!fresh) {
          confirmFresh.add(id);
          decorate();
          return;
        }
        confirmFresh.delete(id);
        act(id, "translate", true)();
      }, "stt-pr-primary"));
      actions.push(button("이어서 번역", act(id, "continue"), "", "끊긴 것 같으면 한 번 더 이어 붙여 봅니다"));
    }
    if (translated && !view.busy) {
      const sure = confirmDelete.has(id);
      actions.push(button(sure ? "확인: 저장 번역 삭제" : "이 메시지 저장 삭제", () => {
        if (!sure) {
          confirmDelete.add(id);
          decorate();
          return;
        }
        confirmDelete.delete(id);
        if (chatId)
          toBackend({ type: "delete_translation", chatId, messageId: id });
      }));
    }
    widget.replaceChildren(launch, el("div", { class: "stt-pr-panel" }, [
      el("div", { class: "stt-pr-head" }, [el("strong", { class: "stt-pr-title" }, ["문단 대조 번역"]), el("span", { class: "stt-pr-pill" }, ["PARAGRAPH READER"])]),
      el("div", { class: "stt-pr-controls" }, [el("label", {}, ["보기", mode]), el("label", {}, ["도착 언어", target])]),
      fontSettings(),
      el("div", { class: "stt-pr-provider" }, [`번역: ${connection} · ${settings.myLanguage} · ${unit}`]),
      el("div", { class: `stt-pr-status${error ? " stt-err" : ""}`, role: "status" }, [status]),
      el("div", { class: "stt-pr-actions" }, actions)
    ]));
  }
  function decorate() {
    if (!chatId)
      return;
    const paragraph = current().displayMode === "paragraph";
    for (const view of views.values()) {
      if (view.role === "system")
        continue;
      let bar = bars.get(view.messageId);
      if (bar && bar.dataset.sttMode !== String(paragraph)) {
        ctx.dom.uninject(bar);
        bars.delete(view.messageId);
        bar = undefined;
      }
      if (!bar) {
        const bubble = ctx.dom.findMessageElement(view.messageId);
        if (!bubble)
          continue;
        const slot = bubble.querySelector(paragraph ? '[data-spindle-mount="message_body_before"]' : '[data-spindle-mount="message_footer"]') ?? bubble;
        bar = ctx.dom.inject(slot, "<div></div>", "beforeend");
        bar.classList.add(paragraph ? "stt-pr-widget" : "stt-bar");
        bar.dataset.sttMode = String(paragraph);
        bars.set(view.messageId, bar);
      }
      if (paragraph)
        renderParagraphPanel(bar, view);
      else
        renderBar(bar, view);
    }
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
  const observer = new MutationObserver(() => {
    if (chatId && bars.size < [...views.values()].filter((v) => v.role !== "system").length)
      queueDecorate();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  function resetChat(next) {
    for (const bar of bars.values())
      ctx.dom.uninject(bar);
    bars.clear();
    views.clear();
    chatId = next;
    renderDraftButton();
    renderPanel();
    if (next)
      toBackend({ type: "chat", chatId: next });
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
    title: "번역",
    shortName: "번역",
    description: "AI 번역: 프리셋, 단어장, 자동 번역, 이어서 번역",
    keywords: ["translate", "translation", "glossary", "번역", "단어장"],
    headerTitle: "번역",
    iconSvg: ICON
  });
  const panel = el("div", { class: "stt-panel" });
  tab.root.replaceChildren(panel);
  let draft = { ...DEFAULT_SETTINGS };
  let dirty = false;
  let status = "";
  function check(label, key, onChange) {
    const input = el("input", { type: "checkbox", checked: draft[key] === true });
    input.addEventListener("change", () => {
      draft[key] = input.checked;
      dirty = true;
      onChange?.();
    });
    return el("label", { class: "stt-check" }, [input, label]);
  }
  function text(label, key, opts = {}) {
    const input = opts.multiline ? el("textarea", { value: String(draft[key] ?? ""), placeholder: opts.placeholder ?? "", class: opts.cls ?? "", spellcheck: false }) : el("input", { type: "text", value: String(draft[key] ?? ""), placeholder: opts.placeholder ?? "" });
    input.addEventListener("input", () => {
      draft[key] = input.value;
      dirty = true;
    });
    return el("label", { class: "stt-field" }, [el("span", {}, [label]), input]);
  }
  function select(label, value, options, onChange) {
    const s = el("select", {}, options.map(([v, l]) => el("option", { value: v, selected: v === value }, [l])));
    s.addEventListener("change", () => {
      onChange(s.value);
      dirty = true;
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
  function save(asDefault) {
    toBackend({ type: "save_settings", chatId, settings: draft, asDefault });
    dirty = false;
    status = asDefault ? "저장했습니다. 새 채팅의 기본값으로도 저장했습니다." : "저장했습니다.";
  }
  function renderPanel() {
    if (!store) {
      panel.replaceChildren(el("div", { class: "stt-note" }, ["불러오는 중…"]));
      return;
    }
    if (!dirty)
      draft = { ...current() };
    const connectionOptions = [["", "현재 사용 중인 연결"], ...connections.map((c) => [c.id, `${c.name} · ${c.model}`])];
    if (draft.connectionId && !connections.some((c) => c.id === draft.connectionId))
      connectionOptions.push([draft.connectionId, "(삭제된 연결)"]);
    const contextSub = el("div", { class: "stt-sub" }, [
      el("div", { class: "stt-row" }, [check("원문 포함", "contextIncludeOriginal"), check("번역문 포함", "contextIncludeTranslation"), check("내 메시지 번역에도 포함", "contextIncludeUserInput")]),
      (() => {
        const n = el("input", { type: "number", min: 1, max: 10, value: draft.contextMessageCount });
        n.addEventListener("input", () => {
          draft.contextMessageCount = Number(n.value) || 3;
          dirty = true;
        });
        return el("label", { class: "stt-field" }, [el("span", {}, ["최근 메시지 수 (1~10)"]), n]);
      })()
    ]);
    const split = el("input", { type: "number", min: 0, step: 500, value: draft.longSplitChars });
    split.addEventListener("input", () => {
      draft.longSplitChars = Math.max(0, Number(split.value) || 0);
      dirty = true;
    });
    panel.replaceChildren(el("div", { class: "stt-note" }, [chatId ? "지금 열린 채팅의 번역 설정입니다." : "열린 채팅이 없어 새 채팅의 기본값을 편집합니다."]), el("div", { class: "stt-section" }, [
      el("h3", {}, ["기본 번역"]),
      select("번역에 쓸 AI 연결", draft.connectionId, connectionOptions, (v) => draft.connectionId = v),
      el("div", { class: "stt-row" }, [text("모델 언어 (내 메시지를 이 언어로)", "modelLanguage"), text("내 언어 (응답을 이 언어로)", "myLanguage")]),
      check("AI 응답 자동 번역", "autoTranslate"),
      check("번역이 끊기면 자동으로 이어서 번역", "autoContinue"),
      select("번역문 표시 방식", draft.displayMode, Object.entries(DISPLAY_LABELS), (v) => draft.displayMode = v),
      select("번역 단위", draft.translationUnit, [
        ["whole", "메시지 통째로 (1회 요청, 문단 수가 같으면 문단별로 맞춰 보여 줌)"],
        ["paragraph", "문단별 (문단마다 1회 요청, 문단 대조가 정확히 맞음)"]
      ], (v) => draft.translationUnit = v === "paragraph" ? "paragraph" : "whole"),
      check("내 메시지를 보내기 전에 번역 (채팅에는 번역문이 남습니다)", "translateMyMessages"),
      check("입력창 옆에 번역 버튼 표시", "showDraftButton")
    ]), el("div", { class: "stt-section" }, [el("h3", {}, ["프롬프트 프리셋"]), promptSection("incoming"), promptSection("outgoing"), presetManager()]), el("div", { class: "stt-section" }, [
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
    ]), el("div", { class: "stt-row stt-sticky" }, [
      button("저장", () => save(false), "stt-primary"),
      chatId ? button("저장 + 새 채팅 기본값으로", () => save(true)) : null,
      status ? el("span", { class: "stt-note" }, [status]) : null
    ]));
  }
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
  resetChat(chatIdFromLocation());
  return () => {
    clearInterval(routeTimer);
    if (viewSaveTimer)
      clearTimeout(viewSaveTimer);
    removeFontStyle?.();
    observer.disconnect();
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
