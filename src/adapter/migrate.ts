// One-time carry-over of 0.4.0 data into the original Translation Tools' own settings file (`tt-config.json`, A9).
// Pure: the backend reads the file and the 0.4.0 store, asks for a plan, and writes the result.

import { effectiveGuides } from '../bundles';
import { settingsFor, type Store } from '../shared';
import { glossaryText } from './contract';

/** Marker key in `tt-config.json` (outside `config`, which the original rewrites as a whole). */
export const MIGRATIONS_KEY = 'lvMigrations';
export const GLOSSARY_MARK = 'glossary052';

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const filled = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * 0.4.0 kept a glossary per chat (and a default), and published it, with the picked bundle's words merged in, to the memory
 * extension. 0.5.x reads the glossary from the original's settings, where it starts empty, and publishing that empty value would
 * clear the one the memory extension already holds. So the 0.4.0 glossaries are copied there, once:
 *   - the default glossary into `defaults` when the original's default has none;
 *   - a chat's glossary into that chat's scope when the scope has none; a chat with no scope of its own gets one, made from the
 *     original's defaults (a scope is complete on its own: it does not inherit from `defaults`);
 *   - a glossary the original already has is never replaced.
 * Returns the whole new file, or null when the marker says it was done. translator.json is not touched.
 */
export function planGlossaryMigration(file: Record<string, unknown>, store: Store, at: string): Record<string, unknown> | null {
  const marks = isObject(file[MIGRATIONS_KEY]) ? (file[MIGRATIONS_KEY] as Record<string, unknown>) : {};
  if (marks[GLOSSARY_MARK]) return null;
  const config: Record<string, any> = isObject(file.config) ? structuredClone(file.config) : {};
  let changed = false;

  const oldDefault = glossaryText(effectiveGuides(store, settingsFor(store, null)).glossary);
  if (oldDefault && !filled(config.defaults?.glossary)) {
    config.defaults = { ...(isObject(config.defaults) ? config.defaults : {}), glossary: oldDefault };
    changed = true;
  }
  for (const chatId of Object.keys(store.chats)) {
    const text = glossaryText(effectiveGuides(store, settingsFor(store, chatId)).glossary);
    if (!text) continue;
    const scope = isObject(config.chats) && isObject(config.chats[chatId]) ? (config.chats[chatId] as Record<string, unknown>) : null;
    if (scope) {
      if (filled(scope.glossary)) continue;
      config.chats = { ...config.chats, [chatId]: { ...scope, glossary: text } };
      changed = true;
    } else if (!filled(config.defaults?.glossary)) {
      config.chats = { ...(isObject(config.chats) ? config.chats : {}), [chatId]: { ...(isObject(config.defaults) ? config.defaults : {}), glossary: text } };
      changed = true;
    }
    // else: the chat uses the original's default glossary, which is not empty: nothing to replace
  }
  return { ...file, ...(changed ? { config } : {}), [MIGRATIONS_KEY]: { ...marks, [GLOSSARY_MARK]: at } };
}
