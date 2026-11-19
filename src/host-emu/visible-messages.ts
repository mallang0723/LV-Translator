// Messages on screen that the original has not been given. The original takes its message list from the app's cache of the chat
// (Marinara loads it page by page as the user scrolls); here the opening read covers the end of the chat (80). A message older than
// that is shown by Lumiverse but unknown to the original, so its stored translation is not drawn and its translate button does
// nothing. This asks, for the message elements on screen that the cache lacks, in one small batch, and the answer goes to the cache.
// Nothing is read for a whole chat: the backend answers from a window at the end of the chat (backend-ops.ts OLD_TAILS).

export interface VisibleWatchOptions {
  /** The chat on screen, or null. */
  chat(): string | null;
  known(chatId: string, messageId: string): boolean;
  /** Asks the backend for these messages and puts the answer in the cache. */
  lookup(chatId: string, ids: string[]): Promise<void>;
  log?(text: string, error?: unknown): void;
}

/** A message appended at the end of the list is new, not old: the last ones are left to the events. */
const NEWEST_SKIPPED = 2;
const BATCH = 60;
const DEBOUNCE_MS = 400;

export function watchVisibleMessages(o: VisibleWatchOptions): { scan(): void; reset(): void; destroy(): void } {
  const asked = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  function scan(): void {
    if (destroyed) return;
    const chatId = o.chat();
    if (!chatId) return;
    const ids = Array.from(document.querySelectorAll('[data-message-id]'), (e) => e.getAttribute('data-message-id') ?? '').filter(Boolean);
    const seen = asked.get(chatId) ?? new Set<string>();
    asked.set(chatId, seen);
    const missing = ids.slice(0, Math.max(0, ids.length - NEWEST_SKIPPED)).filter((id) => !seen.has(id) && !o.known(chatId, id)).slice(0, BATCH);
    if (!missing.length) return;
    for (const id of missing) seen.add(id);
    o.lookup(chatId, missing).catch((e) => o.log?.('visible messages', e));
  }

  const queue = (delay = DEBOUNCE_MS) => {
    if (timer || destroyed) return;
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, delay);
  };
  const observer = new MutationObserver((list) => {
    for (const r of list) {
      for (const n of Array.from(r.addedNodes)) {
        if (n instanceof Element && (n.hasAttribute('data-message-id') || n.querySelector('[data-message-id]'))) return queue();
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  queue(1500); // the original's opening read comes first

  return {
    scan: () => queue(),
    reset() {
      asked.clear();
      queue(1500);
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      observer.disconnect();
    },
  };
}
