// Gives the original (written against Marinara's DOM) the anchors it looks for, on Lumiverse's DOM:
//   [data-message-id]                  already on every Lumiverse message                    (no change needed)
//   .mari-message-content              the rendered message body  = Lumiverse [data-component="MessageContent"]
//   .mari-message-actions              the message action row, holding the host's translate button
//   button > svg.lucide-languages      "the host's translate button": Lumiverse has none, so one is added to the row
//   [data-chat-settings-section="translation"] > .mari-drawer__body    where the original puts its settings screen
// The original then does everything else itself (view, bar, compare window, menus, settings form).

const BUBBLE_ROW = '[data-component="BubbleActions"]';

/**
 * The action row of a message element, or null. Both layouts render the row right after the
 * element that holds the `message_footer` mount (the message card): BubbleActions is that
 * sibling in the bubble layout, a wrapper around MessageActions in the minimal layout.
 * Edit and select modes render no row, so nothing is found and nothing is injected.
 */
function findActionRow(messageEl: Element): HTMLElement | null {
  const footer = messageEl.querySelector('[data-spindle-mount="message_footer"]');
  const next = footer?.parentElement?.nextElementSibling;
  if (!next) return null;
  if (next.matches(BUBBLE_ROW)) return next as HTMLElement;
  const candidates = [next, next.firstElementChild];
  for (const c of candidates) {
    if (!(c instanceof HTMLElement)) continue;
    const buttons = Array.from(c.children).filter((x) => x.tagName === 'BUTTON');
    if (buttons.length >= 3) return c;
  }
  return null;
}


const TRANSLATE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-languages" aria-hidden="true">' +
  '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';

/**
 * Lumiverse folds a long message behind a "더보기" button (MessageContent.tsx `data-long-message-toggle`, a React button inside the
 * message content). The original shows a translation as a CLONE of that whole content next to the (hidden) real one, so the clone
 * carries a copy of the button that React knows nothing about: clicking it does nothing. The click is passed on to the real button
 * in the hidden content; React then redraws the real content and the original rebuilds its clone from it (same open/closed state).
 * (The real button also has to stay laid out for its overflow measurement: see HIDDEN in shim-css.ts.)
 */
function forwardLongMessageToggle(e: MouseEvent): void {
  const target = e.target as Element | null;
  const copy = target?.closest?.('[data-long-message-toggle]') as HTMLElement | null;
  const view = copy?.closest('.ptx-view') as (HTMLElement & { _ptxFor?: HTMLElement }) | null;
  if (!copy || !view) return;
  const host = view._ptxFor ?? (view.previousElementSibling as HTMLElement | null);
  const real = host?.querySelector<HTMLElement>('[data-long-message-toggle]');
  e.preventDefault();
  e.stopPropagation();
  if (real && real !== copy) {
    real.click();
    // The original rebuilds a translated view only when something is added or removed inside the message (its MutationObserver watches childList
    // only). The real button's click changes the hidden content's classes, height limit and label (attributes and text), which it never sees, so
    // the copy stayed folded. An element added and removed at once inside the message wakes it; the redraw comes after React has redrawn.
    const message = copy!.closest('[data-message-id]');
    for (const ms of [80, 300, 800]) {
      setTimeout(() => {
        if (!message?.isConnected) return;
        message.append(document.createComment('lv-nudge'));
        const c = message.lastChild;
        if (c && c.nodeType === 8) c.remove();
      }, ms);
    }
  }
}

/**
 * Regex action buttons (`data-lumiverse-regex-action`: a preset's choice rows, branch icons) are answered by a listener Lumiverse puts on the
 * MessageContent element itself (MessageContent.tsx, click/keydown/contextmenu, target found through `composedPath()`). A translated view is a
 * sibling of that element, and its islands are new shadow roots, so a press on the copy never reaches it. The same press is sent to the real
 * button in the hidden content (modifier keys kept: they pick "queue" or "send").
 *
 * Which real button: the view is a clone of the content, so the pair is found by position: the same scope (the message's own light DOM, or the
 * n-th HTML island's shadow root) and the same ordinal among the action elements of that scope. The attribute value is only a check (it names
 * the script, action and instance, but two buttons may still carry the same one); when the structures do not line up the first real button with
 * that value in the same scope is used. A copy inside an opened original text (`.ptx-o`) has no ordinal of its own and is found by value.
 *
 * Listened for on `window` in the capture phase, so the original's paragraph toggle (a capture listener on `document`) never sees a press on a
 * button; a press anywhere else on the view still reaches it. The event sent to the real button has no `.ptx-view` in its path, so it is not
 * forwarded a second time.
 */
const REGEX_ACTION = 'data-lumiverse-regex-action';
const ISLAND = '[data-lumiverse-html-island]';
/** What Lumiverse writes on a button to show its state (MessageContent.tsx, a layout effect): copied to the view's button after a press. */
const ACTION_STATE_ATTRS = ['aria-disabled', 'aria-pressed', 'tabindex'];
const ACTION_STATE_STYLE = ['cursor', 'opacity', 'filter', 'outline', 'outline-offset'];
const ACTION_FLAGS = ['used', 'selected', 'superseded', 'budget-blocked', 'state-blocked'].map((k) => `${REGEX_ACTION}-${k}`);

type View = HTMLElement & { _ptxFor?: HTMLElement };
interface ActionScope { island: HTMLElement | null; actions: HTMLElement[] }

/** The scopes of a message content or view, in order: its light DOM and the shadow root of each island. Mirrors and opened originals are left out. */
function actionScopes(box: HTMLElement): ActionScope[] {
  const skip = (el: Element) => !!el.closest(`[${MIRROR}], .ptx-o`);
  const pick = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>(`[${REGEX_ACTION}]`)).filter((el) => !skip(el));
  const out: ActionScope[] = [{ island: null, actions: pick(box) }];
  for (const island of Array.from(box.querySelectorAll<HTMLElement>(ISLAND))) {
    if (!skip(island)) out.push({ island, actions: island.shadowRoot ? pick(island.shadowRoot) : [] });
  }
  return out;
}

/** The real button for a button of the view, or null. */
function realActionFor(view: View, host: HTMLElement, copy: HTMLElement): HTMLElement | null {
  const value = copy.getAttribute(REGEX_ACTION);
  const mine = actionScopes(view);
  const real = actionScopes(host);
  const root = copy.getRootNode();
  const at = mine.findIndex((s) => (s.island ? s.island.shadowRoot === root : !(root instanceof ShadowRoot)));
  const byValue = (list: HTMLElement[]) => list.find((el) => el.getAttribute(REGEX_ACTION) === value) ?? null;
  if (at >= 0 && mine.length === real.length) {
    const nth = mine[at]!.actions.indexOf(copy);
    const paired = nth >= 0 ? real[at]!.actions[nth] : undefined;
    if (paired && paired.getAttribute(REGEX_ACTION) === value) return paired;
    return byValue(real[at]!.actions);
  }
  for (const scope of real) {
    const hit = byValue(scope.actions);
    if (hit) return hit;
  }
  return null;
}

/** Copies the state Lumiverse shows on the real buttons to their copies in the view (same pairing as the press). */
function syncActionState(view: View, host: HTMLElement): void {
  const mine = actionScopes(view);
  const real = actionScopes(host);
  if (mine.length !== real.length) return;
  mine.forEach((scope, i) => {
    scope.actions.forEach((copy, n) => {
      const from = real[i]!.actions[n];
      if (!from || from.getAttribute(REGEX_ACTION) !== copy.getAttribute(REGEX_ACTION)) return;
      for (const k of [...ACTION_STATE_ATTRS, ...ACTION_FLAGS]) {
        const v = from.getAttribute(k);
        if (v === null) copy.removeAttribute(k);
        else if (copy.getAttribute(k) !== v) copy.setAttribute(k, v);
      }
      for (const k of ACTION_STATE_STYLE) {
        const v = from.style.getPropertyValue(k);
        if (v) copy.style.setProperty(k, v);
        else copy.style.removeProperty(k);
      }
    });
  });
}

/**
 * The state of a pressed button comes back through Lumiverse's own redraw of the real button, some time after the press (it waits for the
 * server). Inside an island the mirror's observer carries it over to the view; a button in the light DOM is changed in place with no node
 * added or removed, which the original never notices, so its state is copied here, for a few seconds after a press.
 */
function watchActionState(view: View, host: HTMLElement, watchers: Map<View, () => void>): void {
  watchers.get(view)?.();
  const sync = () => {
    if (view.isConnected && host.isConnected) syncActionState(view, host);
  };
  const nodes: Node[] = [host, ...actionScopes(host).flatMap((s) => (s.island?.shadowRoot ? [s.island.shadowRoot] : []))];
  const observers = nodes.map((node) => {
    const o = new MutationObserver(sync);
    o.observe(node, { attributes: true, subtree: true, attributeFilter: [...ACTION_STATE_ATTRS, ...ACTION_FLAGS, 'style'] });
    return o;
  });
  const timer = setTimeout(() => stop(), 8000);
  const stop = () => {
    clearTimeout(timer);
    for (const o of observers) o.disconnect();
    if (watchers.get(view) === stop) watchers.delete(view);
  };
  watchers.set(view, stop);
  sync();
}

/**
 * A touch long-press on a button reaches Lumiverse's own listener as `contextmenu` (which it treats like a right-click: queue instead of send), and
 * the host's long-press controller (pointer events on the MessageContent element, which a press on the copy never reaches) would have swallowed
 * the click that can follow the release. Without that controller here, the click that follows a touch `contextmenu` on the same button is not
 * forwarded, so one hold is one activation (as in the host). A mouse right-click is not affected.
 */
const HOLD_CLICK_MS = 1200;

function makeRegexActionForwarder(watchers: Map<View, () => void>) {
  let lastPointer = 'mouse';
  let held: { el: HTMLElement; until: number } | null = null;
  const onPointer = (e: Event) => { lastPointer = (e as PointerEvent).pointerType || 'mouse'; };
  window.addEventListener('pointerdown', onPointer, true);
  const forward = function forwardRegexAction(e: Event): void {
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
    const path = e.composedPath();
    const copy = path.find((n): n is HTMLElement => n instanceof HTMLElement && n.hasAttribute(REGEX_ACTION));
    if (!copy) return;
    const view = path.find((n) => n instanceof HTMLElement && n.classList.contains('ptx-view')) as View | undefined;
    const host = view?._ptxFor;
    if (!view || !host?.isConnected) return;
    const real = realActionFor(view, host, copy);
    if (!real) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'click' && held && held.el === copy && Date.now() < held.until) {
      held = null;
      return;
    }
    held = e.type === 'contextmenu' && lastPointer !== 'mouse' ? { el: copy, until: Date.now() + HOLD_CLICK_MS } : null;
    const init = { bubbles: true, composed: true, cancelable: true };
    const again = e instanceof KeyboardEvent
      ? new KeyboardEvent(e.type, { ...init, key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey })
      : new MouseEvent(e.type, { ...init, ctrlKey: (e as MouseEvent).ctrlKey, metaKey: (e as MouseEvent).metaKey, shiftKey: (e as MouseEvent).shiftKey, altKey: (e as MouseEvent).altKey, button: (e as MouseEvent).button, clientX: (e as MouseEvent).clientX, clientY: (e as MouseEvent).clientY });
    real.dispatchEvent(again);
    watchActionState(view, host, watchers);
  };
  return Object.assign(forward, { dispose: () => window.removeEventListener('pointerdown', onPointer, true) });
}

/**
 * The original's glossary row shows the example of the host it was written for in its empty fields (extension.js ~5923: `원문 (예: Marinara)` /
 * `번역 (예: 마리나라)`). Here the example is this host's name. Only those two exact texts are replaced; the original is not edited.
 */
const EXAMPLES: Record<string, string> = { '원문 (예: Marinara)': '원문 (예: Lumiverse)', '번역 (예: 마리나라)': '번역 (예: 루미버스)' };

function swapExamples(root: ParentNode, swapped: Map<HTMLInputElement, string>): void {
  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input[data-pair="a"], input[data-pair="b"]'))) {
    const next = EXAMPLES[input.getAttribute('placeholder') ?? ''];
    if (!next) continue;
    swapped.set(input, input.placeholder);
    input.placeholder = next;
  }
}

/**
 * The original answers the translate button in one of three ways: it translates, it toggles the original/translation, or - when the message has nothing to
 * translate - it shows a toast, but only for a message with no translation record (extension.js translateMessage: `!getRecord(id)`). A message that already
 * has a record (even an empty one) and no translatable cell takes the toggle path instead, which draws nothing: the button does nothing at all. This
 * watches a press of the host's translate button and, when a few seconds later the message shows no translated cell (not even the "번역 중…" pill), nothing was
 * hidden by this press (it showed no cell before either), and no toast came up, shows the original's own toast text so the press is never silent.
 */
const NO_UNITS_TOAST = '이 메시지에는 번역할 문단이 없습니다.';
const NO_UNITS_AFTER_MS = 3000;
const INFO_ICON = '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>';

function showOriginalToast(text: string): void {
  let wrap = document.querySelector<HTMLElement>('.ptx-toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'ptx-toasts';
    wrap.setAttribute('aria-live', 'polite');
    document.body.append(wrap);
  }
  const toast = document.createElement('div');
  toast.className = 'ptx-toast is-info';
  toast.innerHTML = `<svg class="ptx-ico" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${INFO_ICON}</svg><span></span>`;
  toast.querySelector('span')!.textContent = text;
  wrap.append(toast);
  setTimeout(() => toast.classList.add('is-out'), 4000);
  setTimeout(() => toast.remove(), 4500);
}

/** A view that shows something: translated cells (also inside an HTML island's shadow root) or the "번역 중…" pill. An empty view (a record with no cell) shows nothing. */
const shows = (message: Element) => !!message.querySelector('.ptx-view .ptx-u, .ptx-view .ptx-pill, .ptx-view [data-lumiverse-html-island]');

function noticeSilentTranslate(e: MouseEvent, timers: Map<string, ReturnType<typeof setTimeout>>): void {
  const button = (e.target as Element | null)?.closest?.('button');
  if (!button || !button.querySelector('svg.lucide-languages') || button.closest('.ptx-view')) return;
  const message = button.closest<HTMLElement>('[data-message-id]');
  const id = message?.getAttribute('data-message-id');
  if (!message || !id) return;
  // A newer press on the same message decides instead of this one (translate then hide again within the wait is not a silent press).
  clearTimeout(timers.get(id));
  const hadCells = shows(message);
  const toastsBefore = new Set(Array.from(document.querySelectorAll('.ptx-toast')));
  const timer = setTimeout(() => {
    timers.delete(id);
    const again = document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    if (!again || !again.isConnected || hadCells || shows(again)) return;
    if (Array.from(document.querySelectorAll('.ptx-toast')).some((t) => !toastsBefore.has(t))) return;
    showOriginalToast(NO_UNITS_TOAST);
  }, NO_UNITS_AFTER_MS);
  timers.set(id, timer);
}

/**
 * Lumiverse draws HTML in a message (status windows, cards, `<details>` blocks, action hints) in an "HTML island": an empty
 * `<div data-lumiverse-html-island>` whose content lives in an open SHADOW ROOT (MessageContent.tsx IsolatedHtml). The original works on the
 * message's light DOM only (`cloneNode(true)`, `querySelectorAll`): it cannot see into a shadow root, so a translation was never made for the
 * text in an island, one made elsewhere (from the message source, split on blank lines) used keys that the island's own blocks (a header and
 * a `<prose>` dialogue, `</pass>` and `<fail>`, a `<summary>` and its body) never match, and the clone showed the island empty.
 *
 * So each island on screen gets a hidden light-DOM MIRROR of its shadow content (`[data-lv-mirror]`, kept current while the island changes).
 * The original then sees those blocks like any other: it translates them, keys them the same way the view does (one derivation, so the compare
 * window and the reading view agree), and puts the translation into the clone of the mirror (inline wrappers such as the colour `<span>` are
 * kept by the original). Where a translated view is drawn, the mirror clone becomes the island's shadow content (`restoreIslands`).
 * An island without a mirror (it appeared a moment ago) is copied from the real one, as before.
 * The message text is never touched: nothing here is ever written back to the message.
 */
const mirrored = new WeakMap<Element, string>();
const MIRROR = 'data-lv-mirror';
const DECOR = 'data-lv-decor';
/**
 * Elements that act on the WHOLE document once they sit in the light DOM (a shadow root scopes them; the mirror does not). The mirror
 * never carries them: a `<style>` in it would apply Lumiverse's island CSS (`p`, `img`, `*`...) and a card's own rules to the entire app,
 * even with `display:none` on the mirror. The translated shadow gets the real island's `<style>` elements back (`restoreIslands`).
 */
const DOCUMENT_WIDE = 'style, link, meta, base, title, script, template';

/** The island's shadow content as the mirror should hold it: serialised, without anything that acts document-wide. */
function mirrorHtml(shadow: ShadowRoot): string {
  const box = document.createElement('div');
  for (const node of Array.from(shadow.childNodes)) box.append(node.cloneNode(true));
  for (const el of Array.from(box.querySelectorAll(DOCUMENT_WIDE))) el.remove();
  // Decoration a card hides from readers (`aria-hidden="true"`: board file letters A-H, icons' labels) is not text to translate. The original
  // skips `translate="no"` elements; without it a row of one-letter labels is one unit whose translation joins them ("ABCDEFGH").
  for (const el of Array.from(box.querySelectorAll('[aria-hidden="true"]'))) el.setAttribute('translate', 'no');
  return box.innerHTML;
}

function syncMirror(island: HTMLElement, onChange: () => void, observers: Map<ShadowRoot, MutationObserver>): void {
  const shadow = island.shadowRoot;
  if (!shadow) return;
  if (!observers.has(shadow)) {
    const o = new MutationObserver(onChange);
    o.observe(shadow, { childList: true, subtree: true, characterData: true, attributes: true });
    observers.set(shadow, o);
  }
  const html = mirrorHtml(shadow);
  let mirror = island.querySelector<HTMLElement>(`:scope > [${MIRROR}]`);
  if (mirror && mirrored.get(mirror) === html) return;
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.setAttribute(MIRROR, '');
    island.append(mirror);
  }
  mirror.innerHTML = html;
  mirrored.set(mirror, html);
}

/** The original's rules for a translated paragraph (`.ptx-u`), which live in the page's stylesheet and so do not reach into a shadow root. */
const VIEW_CSS = `
.ptx-u > .ptx-o { display: none; }
.ptx-u.is-open > .ptx-t::after { content: "\\A"; white-space: pre; }
.ptx-u.is-open > .ptx-o { display: inline-block; box-sizing: border-box; width: 100%; vertical-align: top; padding-left: .7em; border-left: 2px solid color-mix(in srgb, currentColor 25%, transparent); opacity: .62; font-size: .92em; }
.ptx-u.is-flat, .ptx-u.is-flat > .ptx-t { display: contents; cursor: inherit; }
.ptx-u.is-flat > .ptx-o { display: none !important; }
.ptx-u[data-k] { cursor: pointer; }
.ptx-u.is-missing { text-decoration: underline dashed color-mix(in srgb, currentColor 30%, transparent); text-underline-offset: .25em; }`;

/**
 * A model often answers with the markdown it saw (`**name|**`) where the host draws such a block from HTML, and nothing renders it there.
 * In the translated text of an island, `**strong**` and `*em*` become <strong>/<em> elements, built from text nodes only (no HTML is parsed).
 */
const INLINE_MD = /\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*/g;
export function renderInlineMarkdown(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const n = walker.currentNode as Text;
    const parent = n.parentElement;
    if (!parent?.closest('.ptx-t') || parent.closest('code, pre, script, style, textarea') || !n.nodeValue?.includes('*')) continue;
    nodes.push(n);
  }
  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    INLINE_MD.lastIndex = 0;
    if (!INLINE_MD.test(text)) continue;
    INLINE_MD.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(INLINE_MD)) {
      if (m.index! > last) frag.append(text.slice(last, m.index));
      const el = document.createElement(m[1] !== undefined ? 'strong' : 'em');
      el.textContent = m[1] ?? m[2] ?? '';
      frag.append(el);
      last = m.index! + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

/**
 * The original makes a translated paragraph layout-transparent (`is-flat`, no tap toggle) when its parent is a flex or grid container, so a
 * card laid out by CSS (a `<summary>` row, a choice pane) keeps the children it was laid out for (markFlat in the original). It reads the
 * parent's computed display in the LIGHT DOM mirror, where the island's CSS is not applied (see DOCUMENT_WIDE), so for an island it never
 * sees a flex/grid parent and the unit's wrapper becomes the container's only child: icons grow, titles drop, labels wrap letter by letter.
 * Once the translated clone is in the island's shadow root with the card's own CSS, the same rule is applied there.
 */
function flattenInShadow(shadow: ShadowRoot): void {
  for (const unit of Array.from(shadow.querySelectorAll<HTMLElement>('.ptx-u[data-k]:not(.is-flat)'))) {
    const parent = unit.parentElement;
    if (!parent || !/flex|grid/.test(getComputedStyle(parent).display)) continue;
    unit.classList.add('is-flat');
    unit.classList.remove('is-open');
    for (const attr of ['role', 'tabindex', 'aria-expanded']) unit.removeAttribute(attr);
  }
}

function restoreIslands(view: HTMLElement & { _ptxFor?: HTMLElement }): void {
  const host = view._ptxFor;
  if (!host?.isConnected) return;
  const to = view.querySelectorAll<HTMLElement>('[data-lumiverse-html-island]');
  if (!to.length) return;
  const from = host.querySelectorAll<HTMLElement>('[data-lumiverse-html-island]');
  to.forEach((target, i) => {
    if (target.shadowRoot) return;
    const mirror = target.querySelector<HTMLElement>(`:scope > [${MIRROR}]`);
    if (mirror) {
      // The translated mirror clone becomes what the island shows.
      const shadow = target.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = VIEW_CSS;
      // The island's own `<style>` elements (Lumiverse's base CSS and the card's) come from the real island, not from the mirror.
      const real = from.length === to.length ? from[i]!.shadowRoot : null;
      const styles = real ? Array.from(real.querySelectorAll('style')).map((st) => st.cloneNode(true)) : [];
      shadow.append(...styles, style, ...Array.from(mirror.childNodes));
      mirror.remove();
      renderInlineMarkdown(shadow);
      flattenInShadow(shadow);
      // Tap a translated paragraph to see the original (the page-level handler cannot see through the shadow root).
      shadow.addEventListener('click', (e) => {
        const t = e.target as Element | null;
        const u = t?.closest?.('.ptx-u[data-k]:not(.is-flat)');
        if (!u || t?.closest?.('a, img, summary, button, input, textarea')) return;
        if (String(window.getSelection?.() ?? '').trim()) return;
        u.classList.toggle('is-open');
      });
      return;
    }
    const source = from.length === to.length ? from[i]!.shadowRoot : null;
    if (!source) return;
    const shadow = target.attachShadow({ mode: 'open' });
    for (const node of Array.from(source.childNodes)) shadow.append(node.cloneNode(true));
  });
}

const PLAY_ICON = '<polygon points="6 3 20 12 6 21 6 3"/>';

/**
 * "이어서 번역": a button in the original's own bar (대조·수정 / 재번역 / 지우기) that appears only while the message has translated AND untranslated
 * paragraphs. It does nothing of its own: it presses the host's translate button, which the original answers (primaryAction) by translating
 * just the paragraphs that have no translation yet, through its own per-paragraph path.
 */
function syncContinueButton(view: HTMLElement): void {
  const bar = view.querySelector<HTMLElement>('.ptx-bar');
  if (!bar) return;
  const want = !!view.querySelector('.ptx-u.is-missing') && !!view.querySelector('.ptx-u[data-k]');
  const have = bar.querySelector<HTMLElement>('[data-lv-act="continue"]');
  if (!want) {
    have?.remove();
    return;
  }
  if (have) return;
  const base = bar.querySelector<HTMLElement>('[data-ptx-act="retranslate"]') ?? bar.querySelector<HTMLElement>('button');
  if (!base) return;
  const button = base.cloneNode(true) as HTMLElement;
  button.removeAttribute('data-ptx-act');
  button.setAttribute('data-lv-act', 'continue');
  button.setAttribute('title', '번역이 없는 문단만 이어서 번역');
  const svg = button.querySelector('svg');
  if (svg) svg.innerHTML = PLAY_ICON;
  const label = button.querySelector('span');
  if (label) label.textContent = '이어서 번역';
  bar.prepend(button);
}

/**
 * The original splits a message it cannot see on screen (translated at the end of a generation, by "번역 안 된 메시지 모두 번역", or before an
 * HTML island has its mirror) from its SOURCE text: blank lines only, tags stripped. The reading view keys the RENDERED cells. A block tag that
 * touches text with no blank line (`[ header ]\n<prose>…`, `</pass>\n<fail>…`) is one source unit but two cells, so no key matches and the whole
 * message (the sentences above and below included) shows its English. Cells that have no translation are exactly what the original's own
 * "continue" path (its translate button on a translated message) translates, now from the rendered cells, so the keys match and inline wrappers
 * (colour spans, bold) are kept. This runs that path once for each distinct set of missing cells of a message that is on screen.
 */
const AUTO_DELAY_MS = 900;
const missingCells = (view: HTMLElement): string[] => {
  const roots: ParentNode[] = [view, ...Array.from(view.querySelectorAll<HTMLElement>('[data-lumiverse-html-island]')).map((e) => e.shadowRoot).filter((r): r is ShadowRoot => !!r)];
  return roots.flatMap((r) => Array.from(r.querySelectorAll('.ptx-u.is-missing')).map((c) => c.textContent ?? ''));
};

/** Resolves when the message is on screen with its HTML islands mirrored (the original can then read what the view will key), or after `timeoutMs`. */
export function whenMessageSettled(messageId: string, timeoutMs = 6000, signal?: AbortSignal): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(true);
  const started = Date.now();
  let stableSince = 0;
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(false); }, { once: true });
    const tick = () => {
      if (signal?.aborted) return;
      const el = Array.from(document.querySelectorAll('[data-message-id]')).find((e) => e.getAttribute('data-message-id') === messageId);
      const host = el?.querySelector('.mari-message-content');
      const islands = host ? Array.from(host.querySelectorAll<HTMLElement>('[data-lumiverse-html-island]')) : [];
      const ready = !!host && islands.every((i) => !!i.shadowRoot && !!i.querySelector(`:scope > [${MIRROR}]`));
      if (ready) stableSince ||= Date.now();
      else stableSince = 0;
      if (ready && Date.now() - stableSince >= 300) return resolve(true);
      if (Date.now() - started >= timeoutMs) return resolve(false);
      timer = setTimeout(tick, 100);
    };
    tick();
  });
}

function onContinueClick(e: MouseEvent): void {
  const button = (e.target as Element | null)?.closest?.('[data-lv-act="continue"]');
  if (!button) return;
  e.preventDefault();
  e.stopPropagation();
  const message = button.closest('[data-message-id]');
  const native = message?.querySelector<HTMLElement>('.mari-message-actions button:has(svg.lucide-languages)');
  native?.click();
}

export interface DomBridge {
  /** Re-tags messages now (also runs on DOM changes). */
  scan(): void;
  destroy(): void;
}

export interface DomBridgeOptions {
  /** The heal is on (default) unless this answers false; asked each time, so the setting takes effect without a reload. */
  healEnabled?: () => boolean;
  /**
   * Whether the stored translation of a message holds keys that none of the cells now on screen uses (a translation made from the message
   * source while it was off screen). Only then is a message with untranslated cells continued by itself; without this, never.
   */
  hasUnusedKeys?: (messageId: string, usedKeys: Set<string>) => boolean;
}

export function startDomBridge(root: ParentNode = document, options: DomBridgeOptions = {}): DomBridge {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  const added = new Set<Element>();
  const shadowObservers = new Map<ShadowRoot, MutationObserver>();
  const swapped = new Map<HTMLInputElement, string>();
  const autoTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const autoTried = new Map<string, string>();

  /** Presses the original's translate button once for a message whose view has cells without a translation (see AUTO_DELAY_MS above). */
  function autoContinue(view: HTMLElement): void {
    const message = view.closest('[data-message-id]');
    const id = message?.getAttribute('data-message-id');
    if (options.healEnabled && !options.healEnabled()) return;
    if (!message || !id || autoTimers.has(id) || view.querySelector('.ptx-pill')) return;
    const signature = missingCells(view).join('\u0001');
    if (!signature || autoTried.get(id) === signature) return;
    const roots: ParentNode[] = [view, ...Array.from(view.querySelectorAll<HTMLElement>('[data-lumiverse-html-island]')).map((e) => e.shadowRoot).filter((r): r is ShadowRoot => !!r)];
    const used = new Set(roots.flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>('.ptx-u[data-k]')).map((c) => c.dataset.k ?? '')));
    if (!options.hasUnusedKeys?.(id, used)) return;
    autoTimers.set(id, setTimeout(() => {
      autoTimers.delete(id);
      if (destroyed || !view.isConnected || view.querySelector('.ptx-pill')) return;
      if (options.healEnabled && !options.healEnabled()) return;
      const now = missingCells(view).join('\u0001');
      if (!now || now !== signature) return;
      autoTried.set(id, signature);
      message.querySelector<HTMLElement>('.mari-message-actions button:has(svg.lucide-languages)')?.click();
    }, AUTO_DELAY_MS));
  }

  function tag(message: Element): void {
    for (const body of Array.from(message.querySelectorAll('[data-component="MessageContent"]'))) {
      if (body.closest('[data-message-id]') === message && !body.classList.contains('mari-message-content')) {
        body.classList.add('mari-message-content');
        added.add(body);
      }
    }
    const row = findActionRow(message);
    if (!row) return;
    if (!row.classList.contains('mari-message-actions')) {
      row.classList.add('mari-message-actions');
      added.add(row);
    }
    if (!row.querySelector('svg.lucide-languages')) {
      const ref = row.querySelector(':scope > button');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = ref?.className ?? '';
      b.setAttribute('data-ptx-host-button', '');
      b.setAttribute('aria-label', '문단 번역');
      b.innerHTML = TRANSLATE_SVG;
      row.append(b);
      added.add(b);
    }
  }

  function scan(): void {
    if (destroyed) return;
    for (const m of Array.from(root.querySelectorAll('[data-message-id]'))) tag(m);
    swapExamples(root, swapped);
    // Same rule as in an island's mirror (mirrorHtml): decoration hidden from readers is not text to translate, in a plain message too.
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('.mari-message-content [aria-hidden="true"]:not([translate])'))) {
      if (el.closest('.ptx-view')) continue;
      el.setAttribute('translate', 'no');
      el.setAttribute(DECOR, '');
    }
    for (const island of Array.from(root.querySelectorAll<HTMLElement>('.mari-message-content [data-lumiverse-html-island]'))) {
      if (!island.closest('.ptx-view')) syncMirror(island, queue, shadowObservers);
    }
    for (const v of Array.from(root.querySelectorAll<HTMLElement>('.ptx-view'))) {
      restoreIslands(v);
      syncContinueButton(v);
      autoContinue(v);
    }
  }
  const queue = () => {
    if (timer || destroyed) return;
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, 60);
  };
  const observer = new MutationObserver(queue);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  scan();
  const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const onTranslatePress = (e: MouseEvent) => noticeSilentTranslate(e, noticeTimers);
  const actionWatchers = new Map<View, () => void>();
  const forwardRegexAction = makeRegexActionForwarder(actionWatchers);
  document.addEventListener('click', forwardLongMessageToggle, true);
  for (const type of ['click', 'keydown', 'contextmenu']) window.addEventListener(type, forwardRegexAction, true);
  document.addEventListener('click', onContinueClick, true);
  document.addEventListener('click', onTranslatePress, true);
  return {
    scan,
    destroy() {
      destroyed = true;
      document.removeEventListener('click', forwardLongMessageToggle, true);
      for (const type of ['click', 'keydown', 'contextmenu']) window.removeEventListener(type, forwardRegexAction, true);
      for (const stop of Array.from(actionWatchers.values())) stop();
      forwardRegexAction.dispose();
      document.removeEventListener('click', onContinueClick, true);
      document.removeEventListener('click', onTranslatePress, true);
      for (const t of noticeTimers.values()) clearTimeout(t);
      noticeTimers.clear();
      for (const b of Array.from(document.querySelectorAll('[data-lv-act="continue"]'))) b.remove();
      if (timer) clearTimeout(timer);
      for (const t of autoTimers.values()) clearTimeout(t);
      autoTimers.clear();
      observer.disconnect();
      for (const o of shadowObservers.values()) o.disconnect();
      shadowObservers.clear();
      for (const m of Array.from(document.querySelectorAll(`[${MIRROR}]`))) m.remove();
      for (const [input, was] of swapped) input.placeholder = was;
      swapped.clear();
      for (const d of Array.from(document.querySelectorAll(`[${DECOR}]`))) {
        d.removeAttribute('translate');
        d.removeAttribute(DECOR);
      }
      for (const el of added) {
        if (el.hasAttribute('data-ptx-host-button')) el.remove();
        else el.classList.remove('mari-message-content', 'mari-message-actions');
      }
      added.clear();
    },
  };
}

/**
 * The container structure the original's `injectPanels` looks for. Returns the element to put in a Lumiverse panel.
 * Marinara keeps the two translation prompts ("유저 입력 번역 프롬프트", "캐릭터 응답 번역 프롬프트") in native text fields of the
 * same drawer; the original reads and writes them (a chosen preset is copied into them) and Marinara sends the first one
 * with every "translate my message" request. Lumiverse has no such fields, so the same two exist here, hidden.
 */
export function createSettingsHost(): HTMLElement {
  const section = document.createElement('div');
  section.setAttribute('data-chat-settings-section', 'translation');
  const body = document.createElement('div');
  body.className = 'mari-drawer__body';
  for (const which of ['outgoing', 'incoming']) {
    const field = document.createElement('textarea');
    field.hidden = true;
    field.style.display = 'none';
    field.setAttribute('data-ptx-native-prompt', which);
    // Once the original writes a preset into it, our own initial value must not overwrite that.
    field.addEventListener('input', () => field.setAttribute('data-ptx-touched', ''));
    body.append(field);
  }
  section.append(body);
  return section;
}

export interface NativePrompts {
  /** Current text of the two fields. */
  prompts(): { outgoing: string; incoming: string };
  /** Initial values (the chat's own prompts); fields the original already wrote are left alone. */
  setPrompts(outgoing: string, incoming: string): void;
  /** A different chat is on screen: the fields go back to empty (the original writes the new chat's preset itself). */
  reset(): void;
}

export function nativePrompts(host: HTMLElement): NativePrompts {
  const field = (which: string) => host.querySelector<HTMLTextAreaElement>(`textarea[data-ptx-native-prompt="${which}"]`);
  return {
    prompts: () => ({ outgoing: field('outgoing')?.value ?? '', incoming: field('incoming')?.value ?? '' }),
    setPrompts(outgoing, incoming) {
      for (const [which, value] of [['outgoing', outgoing], ['incoming', incoming]] as const) {
        const f = field(which);
        if (f && !f.hasAttribute('data-ptx-touched')) f.value = value;
      }
    },
    reset() {
      for (const which of ['outgoing', 'incoming']) {
        const f = field(which);
        if (!f) continue;
        f.value = '';
        f.removeAttribute('data-ptx-touched');
      }
    },
  };
}
