// Translate / delete-translation buttons in the host's per-message action row.
//
// Lumiverse offers two ways to put something in that row:
//  1. The `message_actions` mount point, rendered through ctx.ui.registerDomDecorator(). The host
//     owns the lifecycle (it re-creates the anchor when a virtualized message remounts). It exists
//     only in the bubble layout (BubbleActions.tsx).
//  2. Nothing, in the minimal/immersive layouts (MessageActions.tsx has no mount, and it is the
//     host's default layout). There the row is found next to the `message_footer` mount, which is
//     a documented, stable anchor, and the buttons are added by hand (idempotent, MutationObserver).
// `registerMessageAction` is declared in lumiverse-spindle-types but the host does not implement it.

import { DELETE_TRANSLATION_LABEL, messageIdFromScope, toolbarState } from './message-ui';
import type { MessageView } from './shared';

/** Material "translate" glyph pair (lucide "languages"); same 24px grid and stroke as the host's icons. */
export const ICON_TRANSLATE =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';

/** The same glyph, smaller, with a cross in the corner: "remove the translation". */
export const ICON_TRANSLATE_DELETE =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<g transform="translate(0.5 0.5) scale(0.72)"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></g>' +
  '<path d="m15.5 15.5 6 6" stroke-width="2.6"/><path d="m21.5 15.5-6 6" stroke-width="2.6"/></svg>';

const BUBBLE_ROW = '[data-component="BubbleActions"]';
const SLOT_ATTR = 'data-stt-tb';

/**
 * The action row of a message element, or null. Both layouts render the row right after the
 * element that holds the `message_footer` mount (the message card): BubbleActions is that
 * sibling in the bubble layout, a wrapper around MessageActions in the minimal layout.
 * Edit and select modes render no row, so nothing is found and nothing is injected.
 */
export function findActionRow(messageEl: Element): HTMLElement | null {
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

export interface DecoratorSpec {
  mount: string;
  render: (root: HTMLElement, ctx: { scope: string }) => void | (() => void);
  update?: (root: HTMLElement, ctx: { scope: string }) => void;
}

export interface ToolbarOptions {
  /** ctx.ui.registerDomDecorator, when the host has it. */
  registerDecorator: ((spec: DecoratorSpec) => unknown) | null;
  listMessageElements: () => Array<{ messageId: string; element: Element }>;
  getView: (messageId: string) => MessageView | undefined;
  onTranslate: (messageId: string, force: boolean) => void;
  onCancel: (messageId: string) => void;
  onDelete: (messageId: string) => void;
}

export interface ToolbarHandle {
  /** Re-renders every button (view changed) and looks for messages that lost theirs. */
  refresh(): void;
  destroy(): void;
  /** For diagnostics: number of live button groups and whether the host mount is in use. */
  stats(): { slots: number; hostMount: boolean };
}

export function mountToolbars(opts: ToolbarOptions): ToolbarHandle {
  const slots = new Map<HTMLElement, { id: string; own: boolean }>();
  let hostUnregister: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  type Look = { kind: 'pill' } | { kind: 'host'; className: string } | { kind: 'own' };

  function button(cls: string, label: string, icon: string, onClick: () => void, look: Look): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `stt-tb ${cls} ${look.kind === 'host' ? look.className : ''}`.trim();
    if (look.kind === 'own') b.setAttribute('data-stt-own', '');
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('data-stt-btn', '');
    b.innerHTML = icon;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  /**
   * How the buttons get the host's look (size, color, hover, touch size): bare buttons inside the
   * bubble pill are styled by the host's `.pill button` rule; in the minimal row the host's own
   * button classes are copied; our own rule is the last resort.
   */
  function lookOf(slot: HTMLElement): Look {
    if (slot.closest(BUBBLE_ROW)) return { kind: 'pill' };
    const ref = slot.parentElement?.querySelector(':scope > button:not([data-stt-btn])');
    return ref?.className ? { kind: 'host', className: ref.className } : { kind: 'own' };
  }

  function render(slot: HTMLElement): void {
    const meta = slots.get(slot);
    if (!meta) return;
    const view = opts.getView(meta.id);
    const state = toolbarState(view ?? null);
    const show = !!view && view.role !== 'system';
    const look = show ? lookOf(slot) : ({ kind: 'own' } as Look);
    const sig = show ? `${state.label}|${state.busy}|${state.canDelete}|${look.kind === 'host' ? look.className : look.kind}` : '';
    if (slot.getAttribute('data-stt-sig') === sig) return;
    slot.setAttribute('data-stt-sig', sig);
    if (!show) {
      slot.replaceChildren();
      return;
    }
    const children: HTMLElement[] = [
      button(
        `stt-tb-translate${state.busy ? ' stt-tb-busy' : ''}`,
        state.label,
        ICON_TRANSLATE,
        () => (state.action === 'cancel' ? opts.onCancel(meta.id) : opts.onTranslate(meta.id, state.force)),
        look,
      ),
    ];
    if (state.canDelete) children.push(button('stt-tb-del', DELETE_TRANSLATION_LABEL, ICON_TRANSLATE_DELETE, () => opts.onDelete(meta.id), look));
    slot.replaceChildren(...children);
  }

  function attach(slot: HTMLElement, id: string, own: boolean): void {
    slot.setAttribute(SLOT_ATTR, id);
    slot.style.display = 'contents';
    slots.set(slot, { id, own });
    render(slot);
  }

  // 1. host mount (bubble layout)
  if (opts.registerDecorator) {
    try {
      const handle = opts.registerDecorator({
        mount: 'message_actions',
        render(root, ctx) {
          const id = messageIdFromScope(ctx.scope);
          if (!id) return;
          attach(root, id, false);
          return () => {
            slots.delete(root);
          };
        },
        update(root, ctx) {
          const id = messageIdFromScope(ctx.scope);
          if (!id) return;
          if (!slots.has(root)) slots.set(root, { id, own: false });
          render(root);
        },
      });
      if (typeof handle === 'function') hostUnregister = handle as () => void;
      else if (handle && typeof (handle as { destroy?: unknown }).destroy === 'function') hostUnregister = () => (handle as { destroy(): void }).destroy();
      else hostUnregister = () => {};
    } catch {
      hostUnregister = null;
    }
  }

  // 2. minimal / immersive layout: no host mount, add to the row ourselves
  function scan(): void {
    if (destroyed) return;
    for (const [slot, meta] of slots) if (meta.own && !slot.isConnected) slots.delete(slot);
    for (const { messageId, element } of opts.listMessageElements()) {
      if (element.querySelector(`[${SLOT_ATTR}]`)) continue;
      const row = findActionRow(element);
      if (!row) continue;
      // The host mount handles BubbleActions when it is available.
      if (hostUnregister && row.matches(BUBBLE_ROW)) continue;
      const slot = document.createElement('span');
      row.appendChild(slot);
      attach(slot, messageId, true);
    }
  }

  const queueScan = () => {
    if (timer || destroyed) return;
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
      for (const slot of slots.keys()) render(slot);
      queueScan();
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      observer.disconnect();
      try {
        hostUnregister?.();
      } catch {
        // already gone
      }
      for (const [slot, meta] of slots) {
        if (meta.own) slot.remove();
        else slot.replaceChildren();
      }
      slots.clear();
    },
    stats: () => ({ slots: slots.size, hostMount: hostUnregister !== null }),
  };
}
