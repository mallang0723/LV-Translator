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
  if (real && real !== copy) real.click();
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

export function startDomBridge(root: ParentNode = document): DomBridge {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  const added = new Set<Element>();
  const shadowObservers = new Map<ShadowRoot, MutationObserver>();

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
    for (const island of Array.from(root.querySelectorAll<HTMLElement>('.mari-message-content [data-lumiverse-html-island]'))) {
      if (!island.closest('.ptx-view')) syncMirror(island, queue, shadowObservers);
    }
    for (const v of Array.from(root.querySelectorAll<HTMLElement>('.ptx-view'))) {
      restoreIslands(v);
      syncContinueButton(v);
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
  document.addEventListener('click', forwardLongMessageToggle, true);
  document.addEventListener('click', onContinueClick, true);
  return {
    scan,
    destroy() {
      destroyed = true;
      document.removeEventListener('click', forwardLongMessageToggle, true);
      document.removeEventListener('click', onContinueClick, true);
      for (const b of Array.from(document.querySelectorAll('[data-lv-act="continue"]'))) b.remove();
      if (timer) clearTimeout(timer);
      observer.disconnect();
      for (const o of shadowObservers.values()) o.disconnect();
      shadowObservers.clear();
      for (const m of Array.from(document.querySelectorAll(`[${MIRROR}]`))) m.remove();
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
