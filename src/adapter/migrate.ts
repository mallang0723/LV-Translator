// One-time carry-over of 0.4.0 data into the original Translation Tools' own settings file (`tt-config.json`, A9).
// Pure: the backend reads the file and the 0.4.0 store, asks for a plan, and writes the result.

import { effectiveGuides } from '../bundles';
import { settingsFor, type Store } from '../shared';
import { lenientTags } from '../translate/protect';
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

export const SCOPE_MARK = 'scope053';
/** The tag part has its own marker: a file that already ran the scope part (an earlier 0.5.3 build) still gets the tags once. */
export const TAGS_MARK = 'tags053';

type Fields = Record<string, unknown>;
interface Group { name: string; keys: string[]; filled(old: Fields): boolean; empty(original: Fields): boolean }

/**
 * The 0.4.0 settings that have a counterpart (same name, same meaning) in the original's chat scope. Each group moves as a unit and only
 * where the original's value is empty:
 *   기타 지침      freeContext + freeContextEnabled           (original empty = no text)
 *   대사 지침      incomingVoicePrompt + incomingVoiceEnabled (original empty = no text)
 *   이전 대화 참고  contextEnabled, contextIncludeOriginal, contextIncludeTranslation, contextIncludeUserInput, contextMessageCount
 *                                                            (original empty = not switched on)
 * 단어장 (glossary) was moved by 0.5.2 (GLOSSARY_MARK) and is not touched here.
 * Left unmapped on purpose (no counterpart, or the 0.4.0 engine that used them is gone): outgoingPrompt/incomingPrompt (still read by the
 * backend for "채팅 설정 유지"), outgoingPresetId/incomingPresetId (preset ids of the original's catalogue are not the same ids),
 * translationUnit, displayMode, autoContinue, longSplitChars, bundleId (the extension's own, still applied to my messages), and the
 * extension's own fields (languages, switches, exclusions, connection), which stay in translator.json.
 */
const GROUPS: Group[] = [
  { name: 'free', keys: ['freeContext', 'freeContextEnabled'], filled: (o) => filled(o.freeContext), empty: (c) => !filled(c.freeContext) },
  { name: 'voice', keys: ['incomingVoicePrompt', 'incomingVoiceEnabled'], filled: (o) => filled(o.incomingVoicePrompt), empty: (c) => !filled(c.incomingVoicePrompt) },
  {
    name: 'context',
    keys: ['contextEnabled', 'contextIncludeOriginal', 'contextIncludeTranslation', 'contextIncludeUserInput', 'contextMessageCount'],
    filled: (o) => o.contextEnabled === true,
    empty: (c) => c.contextEnabled !== true,
  },
];

const pick = (from: Fields, keys: string[]): Fields => Object.fromEntries(keys.filter((k) => k in from).map((k) => [k, from[k]]));

/**
 * One-time carry-over of the rest of the 0.4.0 settings into the original's own file (see GROUPS). Its own marker (`scope053`), so a file
 * 0.5.2 already migrated for the glossary still gets these once. Returns the whole new file, or null when the marker says it was done.
 */
export function planScopeMigration(file: Record<string, unknown>, store: Store, at: string): Record<string, unknown> | null {
  const marks = isObject(file[MIGRATIONS_KEY]) ? (file[MIGRATIONS_KEY] as Record<string, unknown>) : {};
  const doScope = !marks[SCOPE_MARK];
  const doTags = !marks[TAGS_MARK];
  if (!doScope && !doTags) return null;
  const config: Record<string, any> = isObject(file.config) ? structuredClone(file.config) : {};
  let changed = false;

  const oldDefault = settingsFor(store, null) as unknown as Fields;
  for (const g of doScope ? GROUPS : []) {
    if (!g.filled(oldDefault)) continue;
    const have = isObject(config.defaults) ? (config.defaults as Fields) : {};
    if (!g.empty(have)) continue;
    config.defaults = { ...have, ...pick(oldDefault, g.keys) };
    changed = true;
  }
  for (const chatId of doScope ? Object.keys(store.chats) : []) {
    const old = settingsFor(store, chatId) as unknown as Fields;
    for (const g of GROUPS) {
      if (!g.filled(old)) continue;
      const scope = isObject(config.chats) && isObject(config.chats[chatId]) ? (config.chats[chatId] as Fields) : null;
      if (scope) {
        if (!g.empty(scope)) continue;
        config.chats = { ...config.chats, [chatId]: { ...scope, ...pick(old, g.keys) } };
        changed = true;
      } else {
        const base = isObject(config.defaults) ? (config.defaults as Fields) : {};
        // A chat with no scope of its own uses the original's defaults. It only needs a scope when its own words differ from them.
        if (!g.empty(base) && JSON.stringify(pick(base, g.keys)) === JSON.stringify(pick(old, g.keys))) continue;
        config.chats = { ...(isObject(config.chats) ? config.chats : {}), [chatId]: { ...base, ...pick(old, g.keys) } };
        changed = true;
      }
    }
  }
  // 0.4.0's 「제외할 HTML 태그」 (and `<tag>` lines of its exclusion rules) is the original's 「번역에서 제외할 태그」 (paragraph.keepTags, global). The settings form
  // does the same for a `<tag>` line typed now (lv-form.ts `splitTagRules`: moved on save, so the exclusion rules hold text rules only):
  // the names are added to it (nothing the original already lists is removed or reordered).
  const names = new Set<string>();
  const addAll = (text: string) => {
    for (const t of lenientTags(text)) names.add(t);
  };
  const scopes = [store.defaults, ...Object.values(store.chats)];
  for (const sc of scopes) {
    addAll(sc.excludeTags);
    for (const line of sc.excludeRules.split(/\r?\n/)) {
      const m = /^\s*<\s*([A-Za-z][\w:.-]*)\s*\/?>\s*$/.exec(line);
      if (m) names.add(m[1]!.toLowerCase());
    }
  }
  if (doTags && names.size) {
    const para = isObject(config.paragraph) ? (config.paragraph as Fields) : {};
    const have = typeof para.keepTags === 'string' ? para.keepTags : '';
    const haveNames = new Set(have.split(/[\s,;]+/).map((t) => t.replace(/^<|>$/g, '').toLowerCase()).filter(Boolean));
    const add = [...names].filter((n) => !haveNames.has(n));
    if (add.length) {
      config.paragraph = { ...para, keepTags: [have.trim(), ...add].filter(Boolean).join(' ') };
      changed = true;
    }
  }
  return { ...file, ...(changed ? { config } : {}), [MIGRATIONS_KEY]: { ...marks, [SCOPE_MARK]: marks[SCOPE_MARK] ?? at, [TAGS_MARK]: marks[TAGS_MARK] ?? at } };
}
