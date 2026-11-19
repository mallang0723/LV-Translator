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
 * Lumiverse draws HTML in a message (status windows, cards, `<details>` blocks) in an "HTML island": an empty `<div data-lumiverse-html-island>`
 * whose content lives in an open SHADOW ROOT (MessageContent.tsx IsolatedHtml). The original shows a translation as `cloneNode(true)` of the
 * message content, and a clone does not carry shadow roots: every island came out empty, so those blocks were gone from the translated view.
 * They are not translatable text, so they must show as they were, in place: each empty island of a translated view gets a copy of the
 * shadow content of the island it was cloned from (the n-th island of the hidden real content). Native `<details>` keeps working.
 */
function restoreIslands(view: HTMLElement & { _ptxFor?: HTMLElement }): void {
  const host = view._ptxFor;
  if (!host?.isConnected) return;
  const from = host.querySelectorAll<HTMLElement>('[data-lumiverse-html-island]');
  const to = view.querySelectorAll<HTMLElement>('[data-lumiverse-html-island]');
  if (!to.length || from.length !== to.length) return;
  to.forEach((target, i) => {
    const source = from[i]!.shadowRoot;
    if (!source || target.shadowRoot) return;
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
