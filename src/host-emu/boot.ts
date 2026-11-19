// Starts the original Translation Tools 1.10.0 inside Lumiverse: styles, DOM anchors, then the original itself.
import ORIGINAL from '../vendor/tt-1.10.0/personal-extension/extension.js' with { type: 'text' };
import type { HostBridge } from './api';
import { startDomBridge } from './dom-bridge';
import { type EmuHandle, type MarinaraStorage, runOriginal } from './runtime';
import { SHIM_CSS } from './shim-css';

export interface StartOptions {
  bridge: HostBridge;
  storage: MarinaraStorage;
  activeChatId: () => string | null;
  /** Adds a stylesheet to the page and returns its remover (ctx.dom.addStyle in Lumiverse). */
  addStyle: (css: string) => () => void;
  /** Test hook: the original's text (defaults to the embedded pinned copy). */
  source?: string;
}

export function startOriginal(opts: StartOptions): { stop(): void; emu: EmuHandle } {
  const removeStyle = opts.addStyle(SHIM_CSS);
  const dom = startDomBridge();
  const emu = runOriginal({ source: opts.source ?? ORIGINAL, bridge: opts.bridge, storage: opts.storage, activeChatId: opts.activeChatId });
  return {
    emu,
    stop() {
      emu.cleanup();
      dom.destroy();
      removeStyle();
    },
  };
}

export { createSettingsHost, nativePrompts } from './dom-bridge';
