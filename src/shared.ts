// Types, defaults and messages shared by the backend and frontend.

import { normalizeIllustrations } from './illustrations';

/** Maximum per-message views in a chat/window response. */
export const VIEW_WINDOW = 30;
import { lenientTags } from './translate/protect';
import { createAssembly } from './vendor/tt-1.8.0/assembly';
import { FREE_CONTEXT_MAX } from './vendor/tt-1.8.0/catalog';

const notesTools = createAssembly({ currentScope: () => ({}), storedConfig: { presets: [] }, paragraph: {} });

/** Limits inherited from Translation Tools 1.8.0: 100 notes, names up to 60 characters, text up to 12,000. */
export const NOTE_LIMITS = { count: notesTools.NOTES_MAX as number, name: notesTools.NOTE_NAME_MAX as number, text: FREE_CONTEXT_MAX };
export const newNoteId = (): string => notesTools.newNoteId();

/**
 * below: original, then translation. above: translation, then original. only: translation alone.
 * collapsed: original with a folded translation. collapsed-source: translation with a folded original.
 * paragraph: paragraph-by-paragraph comparison.
 */
export type DisplayMode = 'below' | 'above' | 'only' | 'collapsed' | 'collapsed-source' | 'paragraph';
export const DISPLAY_MODES: readonly DisplayMode[] = ['below', 'above', 'only', 'collapsed', 'collapsed-source', 'paragraph'];
/** Paragraph view, interleaved: which of the pair comes first. */
export type ParagraphOrder = 'source-first' | 'translation-first';
/** 'whole': one request per message. 'paragraph': one request per paragraph (exact pairs). */
export type TranslationUnit = 'whole' | 'paragraph';
/** Paragraph view: original and translation interleaved, or translation with the original on tap. */
export type ParagraphView = 'interleave' | 'tap';

/** Per-chat translation settings: Marinara's chat translation section plus Translation Tools 1.5.4. */
export interface ChatSettings {
  /** Lumiverse connection used for translation. '' = the user's active connection. */
  connectionId: string;
  /** "Model Language": outgoing messages are translated into this language. */
  modelLanguage: string;
  /** "My Language": incoming responses are translated into this language. */
  myLanguage: string;
  outgoingPresetId: string;
  incomingPresetId: string;
  /** Chat prompts used when the preset is "채팅 설정 유지" (builtin-inherit). Empty = the default translation prompt (BASE_PROMPT). */
  outgoingPrompt: string;
  incomingPrompt: string;
  /** Translate my messages into the model language before sending (stored translated, like Marinara). */
  translateMyMessages: boolean;
  /** Translate button beside the chat input. */
  showDraftButton: boolean;
  /** Translate AI responses after generation. */
  autoTranslate: boolean;
  displayMode: DisplayMode;
  translationUnit: TranslationUnit;
  /** Continue automatically when a translation stops early. */
  autoContinue: boolean;
  /** Sources at least this long are translated paragraph group by group. 0 = never split. */
  longSplitChars: number;
  /** Max characters of paragraphs in ONE request of the original's paragraph translation (0 = the original's own 6000 as it is). */
  batchChars: number;
  /** Keep HTML tags, attributes, <style>/<script> and comments; translate only the text between tags. */
  protectHtml: boolean;
  /** Keep fenced code blocks untranslated. */
  protectCode: boolean;
  /**
   * Parts that are never translated, one rule per line:
   *   <status>          the whole <status ...>...</status> element
   *   /regex/flags      every match
   *   start ... end     from "start" through the next "end"
   */
  excludeRules: string;
  /** Tag names (comma separated) whose whole element is never sent for translation. <style>/<script> are always kept. */
  excludeTags: string;
  /** Shared translation guide bundle. '' = none; the following text fields are room additions. */
  bundleId: string;
  // Translation Tools 1.5.4 per-chat scope
  glossary: string;
  freeContextEnabled: boolean;
  freeContext: string;
  incomingVoiceEnabled: boolean;
  incomingVoicePrompt: string;
  contextEnabled: boolean;
  contextIncludeOriginal: boolean;
  contextIncludeTranslation: boolean;
  contextIncludeUserInput: boolean;
  contextMessageCount: number;
}

export interface UserPreset {
  id: string;
  name: string;
  prompt: string;
}

export interface UserBundle {
  id: string;
  name: string;
  glossary: string;
  freeContext: string;
  incomingVoicePrompt: string;
}

/** Paragraph view settings, shared by every chat (like Paragraph Reader). */
export interface ViewSettings {
  paragraphView: ParagraphView;
  /** Order inside each interleaved pair. */
  paragraphOrder: ParagraphOrder;
  sourceFontSize: number;
  translationFontSize: number;
}

export const FONT_MIN = 12;
export const FONT_MAX = 32;
export const DEFAULT_VIEW: ViewSettings = { paragraphView: 'interleave', paragraphOrder: 'source-first', sourceFontSize: 16, translationFontSize: 18 };

export function fontSize(value: unknown, fallback: number): number {
  const n = Number(value);
  return value === null || value === '' || !Number.isFinite(n) ? fallback : Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
}

export function normalizeView(value: unknown): ViewSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<ViewSettings>;
  return {
    paragraphView: v.paragraphView === 'tap' ? 'tap' : 'interleave',
    paragraphOrder: v.paragraphOrder === 'translation-first' ? 'translation-first' : 'source-first',
    sourceFontSize: fontSize(v.sourceFontSize, DEFAULT_VIEW.sourceFontSize),
    translationFontSize: fontSize(v.translationFontSize, DEFAULT_VIEW.translationFontSize),
  };
}

/** A saved 기타 지침 (Translation Tools 1.8.0 "기타 지침 저장"): loading one copies its text into a chat. */
export interface Note {
  id: string;
  name: string;
  text: string;
}

export interface Store {
  version: 1;
  view: ViewSettings;
  userPresets: UserPreset[];
  userBundles: UserBundle[];
  /** Saved 기타 지침, shared by every chat. Copied (not linked) into a chat when loaded. */
  notes: Note[];
  /** Settings for chats that have none of their own yet. */
  defaults: ChatSettings;
  chats: Record<string, ChatSettings>;
}

export const CONTEXT_MESSAGE_COUNT_MIN = 1;
export const CONTEXT_MESSAGE_COUNT_MAX = 10;
export const LONG_SPLIT_DEFAULT = 7000;
export const INHERIT_PRESET_ID = 'builtin-inherit';

export const DEFAULT_SETTINGS: ChatSettings = {
  connectionId: '',
  modelLanguage: 'English',
  myLanguage: 'Korean',
  outgoingPresetId: INHERIT_PRESET_ID,
  incomingPresetId: INHERIT_PRESET_ID,
  outgoingPrompt: '',
  incomingPrompt: '',
  translateMyMessages: false,
  showDraftButton: false,
  autoTranslate: false,
  displayMode: 'below',
  translationUnit: 'whole',
  autoContinue: true,
  longSplitChars: LONG_SPLIT_DEFAULT,
  batchChars: 0,
  protectHtml: true,
  protectCode: true,
  excludeRules: '',
  excludeTags: '',
  bundleId: '',
  glossary: '',
  freeContextEnabled: false,
  freeContext: '',
  incomingVoiceEnabled: false,
  incomingVoicePrompt: '',
  contextEnabled: false,
  contextIncludeOriginal: true,
  contextIncludeTranslation: true,
  contextIncludeUserInput: false,
  contextMessageCount: 3,
};

const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export function normalizeSettings(value: unknown, base: ChatSettings = DEFAULT_SETTINGS, bundles: readonly UserBundle[] = []): ChatSettings {
  const s = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const count = Number.parseInt(String(s.contextMessageCount ?? ''), 10);
  const split = Number.parseInt(String(s.longSplitChars ?? ''), 10);
  const batch = Number.parseInt(String(s.batchChars ?? ''), 10);
  const mode = s.displayMode;
  return {
    connectionId: str(s.connectionId, base.connectionId).trim(),
    modelLanguage: str(s.modelLanguage, base.modelLanguage).trim() || base.modelLanguage || DEFAULT_SETTINGS.modelLanguage,
    myLanguage: str(s.myLanguage, base.myLanguage).trim() || base.myLanguage || DEFAULT_SETTINGS.myLanguage,
    outgoingPresetId: str(s.outgoingPresetId, base.outgoingPresetId) || INHERIT_PRESET_ID,
    incomingPresetId: str(s.incomingPresetId, base.incomingPresetId) || INHERIT_PRESET_ID,
    outgoingPrompt: str(s.outgoingPrompt, base.outgoingPrompt),
    incomingPrompt: str(s.incomingPrompt, base.incomingPrompt),
    translateMyMessages: bool(s.translateMyMessages, base.translateMyMessages),
    showDraftButton: bool(s.showDraftButton, base.showDraftButton),
    autoTranslate: bool(s.autoTranslate, base.autoTranslate),
    displayMode: DISPLAY_MODES.includes(mode as DisplayMode) ? (mode as DisplayMode) : base.displayMode,
    translationUnit: s.translationUnit === 'paragraph' ? 'paragraph' : s.translationUnit === 'whole' ? 'whole' : base.translationUnit,
    autoContinue: bool(s.autoContinue, base.autoContinue),
    longSplitChars: Number.isFinite(split) ? Math.max(0, Math.min(200_000, split)) : base.longSplitChars,
    // 0.4.0's "split size" (longSplitChars) is the same setting as 0.5.3's 한 번에 번역할 최대 글자수 (batchChars): when the new one was never
    // saved and the 0.4.0 value is one the user chose (not the 7000 default), it carries over. Once saved, batchChars is written and wins.
    batchChars: Number.isFinite(batch)
      ? (batch > 0 ? batch : 0)
      : Object.hasOwn(s, 'batchChars') ? base.batchChars
      : Number.isFinite(split) && split > 0 && split !== LONG_SPLIT_DEFAULT ? split : base.batchChars,
    protectHtml: bool(s.protectHtml, base.protectHtml),
    protectCode: bool(s.protectCode, base.protectCode),
    excludeRules: str(s.excludeRules, base.excludeRules),
    excludeTags: lenientTags(str(s.excludeTags, base.excludeTags)).join(', '),
    bundleId: typeof s.bundleId === 'string' && bundles.some((b) => b.id === s.bundleId) ? s.bundleId : '',
    glossary: str(s.glossary, base.glossary),
    freeContextEnabled: bool(s.freeContextEnabled, base.freeContextEnabled),
    freeContext: str(s.freeContext, base.freeContext),
    incomingVoiceEnabled: bool(s.incomingVoiceEnabled, base.incomingVoiceEnabled),
    incomingVoicePrompt: str(s.incomingVoicePrompt, base.incomingVoicePrompt),
    contextEnabled: bool(s.contextEnabled, base.contextEnabled),
    contextIncludeOriginal: bool(s.contextIncludeOriginal, base.contextIncludeOriginal),
    contextIncludeTranslation: bool(s.contextIncludeTranslation, base.contextIncludeTranslation),
    contextIncludeUserInput: bool(s.contextIncludeUserInput, base.contextIncludeUserInput),
    contextMessageCount: Number.isFinite(count)
      ? Math.min(CONTEXT_MESSAGE_COUNT_MAX, Math.max(CONTEXT_MESSAGE_COUNT_MIN, count))
      : base.contextMessageCount,
  };
}

export function normalizeStore(value: unknown): Store {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Store>;
  const userBundles: UserBundle[] = [];
  const bundleIds = new Set<string>();
  for (const b of Array.isArray(raw.userBundles) ? raw.userBundles : []) {
    if (!b || typeof b !== 'object') continue;
    const id = str(b.id, '').trim();
    const name = str(b.name, '').trim();
    if (!id || !name || bundleIds.has(id)) continue;
    bundleIds.add(id);
    userBundles.push({ id, name, glossary: str(b.glossary, ''), freeContext: str(b.freeContext, ''), incomingVoicePrompt: str(b.incomingVoicePrompt, '') });
  }
  const defaults = normalizeSettings(raw.defaults, DEFAULT_SETTINGS, userBundles);
  const chats: Record<string, ChatSettings> = {};
  if (raw.chats && typeof raw.chats === 'object') {
    for (const [chatId, s] of Object.entries(raw.chats)) if (chatId) chats[chatId] = normalizeSettings(s, defaults, userBundles);
  }
  const userPresets: UserPreset[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(raw.userPresets) ? raw.userPresets : []) {
    if (!p || typeof p !== 'object') continue;
    const id = str(p.id, '').trim();
    const name = str(p.name, '').trim();
    const prompt = str(p.prompt, '');
    if (!id || !name || !prompt.trim() || seen.has(id) || !id.startsWith('custom-')) continue;
    seen.add(id);
    userPresets.push({ id, name, prompt });
  }
  return { version: 1, view: normalizeView(raw.view), userPresets, userBundles, notes: notesTools.normalizeNotes(raw.notes) as Note[], defaults, chats };
}

export function settingsFor(store: Store, chatId: string | null): ChatSettings {
  return chatId && store.chats[chatId] ? store.chats[chatId] : store.defaults;
}

/**
 * The connection a chat translates on. A chat that never chose one ('') follows the default
 * settings, so picking a connection once is enough.
 */
export function effectiveConnectionId(store: Store, chatId: string | null): string {
  return settingsFor(store, chatId).connectionId || store.defaults.connectionId;
}

/** Stable across LV-Illust tag/image/status changes; ordinary prose edits keep separate records. */
export function sourceHash(text: string): string {
  return rawSourceHash(normalizeIllustrations(text));
}

/** Pre-0.3.4 key, retained for reading existing message metadata. */
export function rawSourceHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}-${text.length.toString(36)}`;
}

// ---- translation records (stored in message metadata) ----

export type TranslationStatus = 'done' | 'partial' | 'error';

export interface TranslationRecord {
  /** Translation of each source part, in order, with protected pieces still as ⟦n⟧ markers. */
  parts: string[];
  /** Protected pieces (markup, excluded parts) that the ⟦n⟧ markers stand for. */
  pieces: string[];
  /** How the source was split: 'paragraph' = parts[i] is the translation of paragraph i. */
  unit?: TranslationUnit;
  /** Number of source parts. */
  total: number;
  /** Paragraph indexes the user corrected by hand (번역 고치기); parts[i] is then the user's text. */
  edited?: number[];
  /** Index of a part that stopped early (output limit), or -1. */
  truncatedPart: number;
  status: TranslationStatus;
  error?: string;
  updatedAt: number;
}

export interface MessageTranslations {
  v: 1;
  /** Keyed by sourceHash(content); illustration replacements share a key, prose edits do not. */
  entries: Record<string, TranslationRecord>;
  /** Translation hidden for this message (show the original). */
  hidden?: boolean;
  /**
   * Public projection of the visible swipe's finished translation for the memory extension (LV-TX v1,
   * src/adapter/contract.ts). Written only while that extension is present; its `h` is the FNV-1a of the content.
   */
  pub?: { v: 1; h: string; lang: string; text: string; paras?: Record<string, string>; edited?: Record<string, 1>; at: number };
}

export const METADATA_KEY = 'st_translator';

export function recordText(r: TranslationRecord): string {
  return r.parts.filter((p) => p.trim()).join('\n\n');
}

/** Whether the translation can be continued: a part stopped early or parts are missing. */
export function recordHasMore(r: TranslationRecord): boolean {
  return r.truncatedPart >= 0 || r.parts.length < r.total;
}

/** What the frontend shows for one message. */
export interface MessageView {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  /** Translation of the current content (the visible swipe), if any. */
  text: string | null;
  /** The visible swipe's actual storage key (normalized, or a legacy raw hash). */
  sourceKey: string;
  status: TranslationStatus | null;
  hasMore: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  hidden: boolean;
  busy: boolean;
  /** Position in the chat (index_in_chat), for the "#225 name" label. */
  index: number;
  /** Speaker name of the message. */
  name: string;
}

export interface PresetSummary {
  id: string;
  name: string;
  prompt: string;
  builtin: boolean;
}

export interface ConnectionSummary {
  id: string;
  name: string;
  model: string;
  provider: string;
  isDefault?: boolean;
}

// frontend -> backend
export type ToBackend =
  | { type: 'hello' }
  /** `open`: the chat was just opened or came back on screen (its glossary is published for the memory extension then). */
  | { type: 'hint'; chatId: string | null; activeId?: string; chatConnectionId?: string; open?: boolean }
  | { type: 'save_connection'; chatId: string | null; connectionId: string }
  | { type: 'save_settings'; chatId: string | null; settings: ChatSettings; asDefault: boolean }
  | { type: 'save_bundle'; bundle: UserBundle }
  | { type: 'delete_bundle'; id: string }
  | { type: 'notify'; kind: 'info' | 'warning' | 'error'; text: string }
  /** Host stand-in for the original Translation Tools screens (src/host-emu): one call of the original's `/api`. */
  | { type: 'emu'; id: string; op: string; args: unknown[] }
  | { type: 'emu_cancel'; id: string };

// backend -> frontend
export type ToFrontend =
  | { type: 'state'; store: Store; connections: ConnectionSummary[]; /** Link with the memory extension: not installed, working, or a contract version we do not share. */ link?: 'none' | 'ok' | 'incompatible' }
  | { type: 'emu_result'; id: string; ok: boolean; data?: unknown; error?: string; status?: number }
  /** A message changed (edit, swipe, new, deleted) after the page read it: the page's message cache (src/host-emu/message-cache.ts) follows. `row` is the original's message row (src/host-emu/backend-ops.ts eventRow). */
  | { type: 'msg_event'; chatId: string; kind: 'upsert'; row: unknown }
  | { type: 'msg_event'; chatId: string; kind: 'delete'; messageId: string };
