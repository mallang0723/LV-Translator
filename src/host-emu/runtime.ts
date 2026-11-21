// Runs the original Translation Tools 1.10.0 `extension.js` whole and unmodified inside Lumiverse.
// The original is a Marinara "personal extension": a script body that expects a `marinara` object, the page's
// `window.fetch` (it wraps it) and the active chat id in localStorage. Those are provided here as shadows.
// Nothing in the original is edited; see scripts/verify-original.mjs.

import { createApiFetch, type HostBridge } from './api';
import { guardStorage, STORAGE_TIMEOUT_MS } from './guard';
import { watchOnPrimary } from './on-primary';

export const ACTIVE_CHAT_KEY = 'marinara-active-chat-id';
export const EXTENSION_ID = 'translation-presets-glossary';

export interface MarinaraStorage {
  get(): Promise<{ config?: unknown; [k: string]: unknown } | null>;
  patch(p: Record<string, unknown>): Promise<{ config?: unknown } | null>;
}

export interface EmuOptions {
  /** The text of the original `extension.js`. */
  source: string;
  bridge: HostBridge;
  storage: MarinaraStorage;
  /** Chat id of the chat on screen (Lumiverse route), or null. */
  activeChatId: () => string | null;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
  /** How long a storage call may stay unanswered before the original gets an error instead (default 20 s). */
  storageTimeoutMs?: number;
}

export interface EmuHandle {
  /** The shadowed `window.fetch` the original installed (null if it did not). */
  installedFetch(): typeof fetch | null;
  cleanup(): void;
}

const MESSAGE_BY_ID = /^\[data-message-id="((?:[^"\\]|\\.)*)"\]$/;

/**
 * Lumiverse puts `data-message-id` on TWO nested elements of a message: the list's row wrapper (MessageList.tsx, the virtual row) and the message
 * card inside it (BubbleMessageDefault / MinimalMessageDefault). The original asks `document.querySelector('[data-message-id="<id>"]')` for "the
 * message element" (extension.js `messageUnits`, the one place it does) and then takes the content hosts whose nearest `[data-message-id]` IS that
 * element. `querySelector` answers with the first match in document order, the OUTER row, whose hosts all belong to the inner card, so the original
 * found no host and split the message from its source text (`fallbackRoot`) instead of reading the cells on screen: a translation keyed by source
 * paragraphs, which the view (keyed by its cells) does not match. This `document` answers that one query with the element that owns the content.
 * Every other call, property and event is the real document's. Marinara has one element per message, so nothing else in the original is affected.
 */
export function shadowDocument(real: Document = document): Document {
  const own = (el: Element): boolean => Array.from(el.getElementsByClassName('mari-message-content')).some((h) => h.closest('[data-message-id]') === el);
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'querySelector') {
        return (selector: string) => {
          if (typeof selector === 'string' && MESSAGE_BY_ID.test(selector)) {
            const all = Array.from(target.querySelectorAll(selector));
            return all.find(own) ?? all[0] ?? null;
          }
          return target.querySelector(selector);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
}

/** window: everything passes through, except `fetch` (the original wraps and replaces it; that must not touch the host's). */
function shadowWindow(apiFetch: typeof fetch, doc: Document) {
  let fetchImpl: typeof fetch = apiFetch;
  const proxy: Window = new Proxy(window, {
    get(target, prop) {
      if (prop === 'fetch') return fetchImpl;
      if (prop === 'document') return doc;
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' && !/^[A-Z]/.test(String(prop)) ? v.bind(target) : v;
    },
    set(target, prop, value) {
      if (prop === 'fetch') {
        fetchImpl = value;
        return true;
      }
      return Reflect.set(target, prop, value, target);
    },
  });
  return { proxy, current: () => fetchImpl };
}

function shadowStorage(activeChatId: () => string | null): Storage {
  const real = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  return {
    get length() {
      return real?.length ?? 0;
    },
    key: (i) => real?.key(i) ?? null,
    getItem: (k) => (k === ACTIVE_CHAT_KEY ? activeChatId() : real?.getItem(k) ?? null),
    setItem: (k, v) => {
      if (k !== ACTIVE_CHAT_KEY) real?.setItem(k, v);
    },
    removeItem: (k) => {
      if (k !== ACTIVE_CHAT_KEY) real?.removeItem(k);
    },
    clear: () => {},
  } as Storage;
}

export function runOriginal(opts: EmuOptions): EmuHandle {
  const log = opts.log ?? console;
  const api = createApiFetch(opts.bridge, window.fetch.bind(window));
  const doc = shadowDocument();
  const win = shadowWindow(api, doc);
  const cleanups: Array<() => unknown> = [watchOnPrimary()];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const marinara = {
    extension: { id: EXTENSION_ID },
    storage: guardStorage(opts.storage, opts.storageTimeoutMs ?? STORAGE_TIMEOUT_MS),
    log: { info: (...a: unknown[]) => log.info(...a), warn: (...a: unknown[]) => log.warn(...a), error: (...a: unknown[]) => log.error(...a) },
    setTimeout: (fn: () => void, ms?: number) => {
      const t = setTimeout(fn, ms);
      timers.add(t);
      return t;
    },
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
    setInterval: (fn: () => void, ms?: number) => {
      const t = setInterval(fn, ms) as unknown as ReturnType<typeof setTimeout>;
      timers.add(t);
      return t;
    },
    clearInterval: (t: ReturnType<typeof setTimeout>) => clearInterval(t as unknown as number),
    onCleanup: (fn: () => unknown) => {
      cleanups.push(fn);
    },
  };
  // The original is a script body whose free names are exactly these.
  const run = new Function('marinara', 'window', 'document', 'localStorage', 'history', 'CSS', opts.source);
  // `CSS` is passed on purpose: a host bundle may declare its own top-level `CSS` constant that would hide the platform's.
  run(marinara, win.proxy, doc, shadowStorage(opts.activeChatId), window.history, window.CSS);
  return {
    installedFetch: () => win.current(),
    cleanup() {
      for (const t of timers) {
        clearTimeout(t);
        clearInterval(t as unknown as number);
      }
      for (const fn of cleanups.splice(0).reverse()) {
        try {
          fn();
        } catch (e) {
          log.warn('cleanup', e);
        }
      }
    },
  };
}
