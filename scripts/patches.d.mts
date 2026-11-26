import type { BunPlugin } from 'bun';
export const UUID_PATCHES: Array<{ id: string; before: string; after: string }>;
export function patchOriginal(source: string): string;
export const originalUUIDPlugin: BunPlugin;
export const LEGACY_UUID_PATCHES: typeof UUID_PATCHES;
export function patchLegacyAssembly(source: string): string;
export function applyAnchors(source: string, patches: typeof UUID_PATCHES): string;
