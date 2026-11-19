// Starts the original Translation Tools 1.10.0 inside Lumiverse: styles, DOM anchors, then the original itself.
import ORIGINAL from '../vendor/tt-1.10.0/personal-extension/extension.js' with { type: 'text' };
import type { HostBridge } from './api';
import { startDomBridge } from './dom-bridge';
import { installQueryClient, type MessageCache } from './message-cache';
import { type EmuHandle, type MarinaraStorage, runOriginal } from './runtime';
import { SHIM_CSS } from './shim-css';

export interface StartOptions {
  bridge: HostBridge;
  storage: MarinaraStorage;
  activeChatId: () => string | null;
  /** Adds a stylesheet to the page and returns its remover (ctx.dom.addStyle in Lumiverse). */
  addStyle: (css: string) => () => void;
  /** The message cache the original finds as the app's (see message-cache.ts). */
  cache?: MessageCache;
  /** How long a storage call may stay unanswered before the original gets an error (default 20 s; see guard.ts). */
  storageTimeoutMs?: number;
  /** Whether a message translated off screen is continued once when it reaches the screen with untranslated cells (our setting 화면에 나타날 때 빠진 칸 자동 보충 번역; default on). */
  healOffscreen?: () => boolean;
  /** Test hook: the original's text (defaults to the embedded pinned copy). */
  source?: string;
}

export function startOriginal(opts: StartOptions): { stop(): void; emu: EmuHandle } {
  const removeStyle = opts.addStyle(SHIM_CSS);
  const dom = startDomBridge(document, {
    healEnabled: opts.healOffscreen,
    hasUnusedKeys: (id, used) => {
      const chat = opts.activeChatId();
      const map = chat ? ((opts.cache?.row(chat, id)?.extra as { paraTranslate?: { map?: Record<string, unknown> } } | undefined)?.paraTranslate?.map ?? null) : null;
      return !!map && Object.keys(map).some((k) => !used.has(k));
    },
  });
  // Before the original starts: it looks for the cache while it starts.
  const removeCache = opts.cache ? installQueryClient(opts.cache) : () => {};
  const emu = runOriginal({ source: opts.source ?? ORIGINAL, bridge: opts.bridge, storage: opts.storage, activeChatId: opts.activeChatId, storageTimeoutMs: opts.storageTimeoutMs });
  return {
    emu,
    stop() {
      emu.cleanup();
      dom.destroy();
      removeCache();
      removeStyle();
    },
  };
}

export { createSettingsHost, nativePrompts, whenMessageSettled } from './dom-bridge';
