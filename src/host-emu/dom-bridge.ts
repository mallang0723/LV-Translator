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
  return {
    scan,
    destroy() {
      destroyed = true;
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
  };
}
