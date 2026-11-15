// Builds the translation request the way Translation Tools 1.8.0 does (and Marinara Engine's
// translate endpoint wraps it):
//   system = preset prompt with {{voice}} / {{vocab}} filled, glossary rule, 기타 지침 (a style
//            instruction for the live presets), character voice, persona, previous-context rule,
//            with {{targetLanguage}} resolved; at most 200,000 characters
//   user   = "Translate the following text to <language>:\n\n" + glossary block (unless the prompt
//            places the glossary itself with {{vocab}}) + previous context block + [Text to Translate]
//            ... [End Text]; the reference text at most 50,000
// The assembly itself is upstream code (src/vendor/tt-1.8.0/assembly.ts, generated verbatim from
// tlsiddl/marinara-translation-tools 807d6a3). The user message wording follows Marinara Engine
// (AGPL-3.0); see THIRD_PARTY_NOTICES.md.

import { normalizeIllustrations } from '../illustrations';

import { BASE_PROMPT } from '../presets/catalog';
import { effectiveGuides, type GuideLibrary } from '../bundles';
import { type ChatSettings, INHERIT_PRESET_ID } from '../shared';
import { createAssembly } from '../vendor/tt-1.8.0/assembly';
import { MARKER_INSTRUCTION } from './protect';
import { parseGlossary } from './glossary';
export { parseGlossary } from './glossary';

export const SYSTEM_PROMPT_MAX = 200000;
export const TRANSLATION_TEXT_MAX = 50000;

export type Direction = 'incoming' | 'outgoing';

export class TranslationLimitError extends Error {
  constructor(public readonly field: 'systemPrompt' | 'text', public readonly length: number, public readonly limit: number) {
    const label = field === 'systemPrompt' ? '시스템 프롬프트' : '번역 본문과 참고 블록';
    super(`${label} ${length.toLocaleString('en-US')}자가 ${limit.toLocaleString('en-US')}자 제한을 초과하여 번역을 중단했습니다. 지침이나 참고 정보의 길이를 줄여 주세요. 내용은 잘라내지 않았습니다.`);
    this.name = 'TranslationLimitError';
  }
}

export interface PromptPreset {
  id: string;
  prompt: string;
  /** false for "채팅 설정 유지": the chat's own prompt is used instead. */
  replace: boolean;
}

export interface ContextMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Saved translation of exactly this content, if any. */
  translation: string | null;
}

export interface TranslationRequest {
  system: string;
  user: string;
  hasContext: boolean;
}

const pure = createAssembly({ currentScope: () => ({}), storedConfig: { presets: [] }, paragraph: {} });

export const glossarySection = pure.glossarySection as (raw: string, sourceText: string, targetLanguage: string) => string;
export const escapeContextValue = pure.escapeContextValue as (value: string) => string;
export const LIVE_PROMPT_PRESET_IDS = pure.LIVE_PROMPT_PRESET_IDS as ReadonlySet<string>;

/** The base prompt for one direction: the preset's text, or the chat's own prompt for "채팅 설정 유지". */
export function directionPrompt(settings: ChatSettings, direction: Direction, presets: PromptPreset[]): string {
  const presetId = direction === 'incoming' ? settings.incomingPresetId : settings.outgoingPresetId;
  const preset = presets.find((p) => p.id === presetId) ?? presets.find((p) => p.id === INHERIT_PRESET_ID);
  const own = (direction === 'incoming' ? settings.incomingPrompt : settings.outgoingPrompt).trim();
  if (preset?.replace) return preset.prompt.trim();
  return own || BASE_PROMPT;
}

function formatContextMessage(message: ContextMessage, settings: ChatSettings): string {
  const parts: string[] = [];
  if (settings.contextIncludeOriginal && message.content) parts.push(`<original>${escapeContextValue(normalizeIllustrations(message.content))}</original>`);
  if (settings.contextIncludeTranslation && message.translation) parts.push(`<translation>${escapeContextValue(normalizeIllustrations(message.translation))}</translation>`);
  if (!parts.length) return '';
  return `<message role="${message.role}">\n${parts.join('\n')}\n</message>`;
}

export interface BuildInput {
  direction: Direction;
  /** Text to translate (already protected: markup replaced by ⟦n⟧ markers). */
  text: string;
  settings: ChatSettings;
  /** Shared guides; omitted by callers that only use room text. */
  store?: GuideLibrary;
  presets: PromptPreset[];
  /** Messages before the text, oldest first. Only the last contextMessageCount are used. */
  previous: ContextMessage[];
  /** Whether the text contains ⟦n⟧ markers. */
  hasMarkers: boolean;
  /** The "# User Persona" section (upstream personaSection), resolved by the caller; '' = none. */
  persona?: string;
}

/** Upstream's "scope": the chat settings with the shared guide bundle already applied. */
function scopeOf(settings: ChatSettings, direction: Direction, guides: ReturnType<typeof effectiveGuides>): ChatSettings {
  return {
    ...settings,
    glossary: guides.glossary,
    freeContext: guides.freeContext,
    incomingVoicePrompt: guides.incomingVoicePrompt,
    // Upstream checks the incoming preset id for every request; an outgoing request answers to its own preset.
    incomingPresetId: direction === 'incoming' ? settings.incomingPresetId : settings.outgoingPresetId,
  };
}

/** The upstream prompt assembly bound to one request's settings and preset list. */
export function assemblyFor(settings: ChatSettings, direction: Direction, presets: PromptPreset[], guides: ReturnType<typeof effectiveGuides>, persona?: { getChat(id: string): Promise<{ personaId?: string }>; getPersona(id: string): Promise<{ name?: string } | null> }) {
  const scope = scopeOf(settings, direction, guides);
  return {
    scope,
    ...createAssembly({ currentScope: () => scope, storedConfig: { presets }, paragraph: persona ?? { getChat: async () => ({}), getPersona: async () => null } }),
  };
}

// TODO(tt-1.8.0 scan): upstream's 말투·단어 자동 수집 (SCAN_GLOSSARY / SCAN_SPEECH / SCAN_WORLD, scanChat, extension.js
// L3030-L3300 at 807d6a3) is not ported: it needs the characters, personas and world_books permissions. Until then the user
// writes the '- 사용 언어: 영어' line in 대사 지침 by hand; the presets read it from there.

/** The "# User Persona" section for a persona name (upstream wording), for the live presets only. */
export async function personaSectionFor(settings: ChatSettings, presets: PromptPreset[], name: string): Promise<string> {
  const guides = effectiveGuides({ userBundles: [] }, settings);
  const a = assemblyFor(settings, 'incoming', presets, guides, { getChat: async () => ({ personaId: 'persona' }), getPersona: async () => ({ name }) });
  return a.personaSection(a.scope, 'chat');
}

export function buildTranslationRequest(input: BuildInput): TranslationRequest {
  const { direction, text, settings } = input;
  const guides = effectiveGuides(input.store ?? { userBundles: [] }, settings);
  const targetLanguage = direction === 'incoming' ? settings.myLanguage : settings.modelLanguage;
  const assembly = assemblyFor(settings, direction, input.presets, guides);
  const incoming = direction === 'incoming';
  const glossary = assembly.glossarySection(guides.glossary, text, targetLanguage);
  // With {{vocab}} in the prompt the glossary goes into the system prompt instead of in front of the text.
  const systemPrompt = directionPrompt(settings, direction, input.presets);
  const usesVocab = assembly.VOCAB_MACRO_TEST.test((incoming && assembly.livePresetPrompt(assembly.scope)) || systemPrompt);
  const glossaryPrefix = glossary && !usesVocab ? `${glossary}\n\n` : '';
  const referenceText = glossaryPrefix ? `${glossaryPrefix}[Text to Translate]\n${text}\n[End Text]` : text;
  if (referenceText.length > TRANSLATION_TEXT_MAX) throw new TranslationLimitError('text', referenceText.length, TRANSLATION_TEXT_MAX);

  let body = referenceText;
  let hasContext = false;
  const wantsContext =
    settings.contextEnabled &&
    (settings.contextIncludeOriginal || settings.contextIncludeTranslation) &&
    (direction === 'incoming' || settings.contextIncludeUserInput);
  if (wantsContext) {
    const previous = input.previous.slice(-settings.contextMessageCount);
    const prefix = `${glossaryPrefix}[Previous Context — Reference Only]\n\n`;
    const suffix = `\n\n[Text to Translate]\n${text}\n[End Text]`;
    let remaining = TRANSLATION_TEXT_MAX - prefix.length - suffix.length;
    const formatted: string[] = [];
    for (let index = previous.length - 1; index >= 0; index--) {
      const block = formatContextMessage(previous[index]!, settings);
      if (!block) continue;
      const cost = block.length + (formatted.length ? 2 : 0);
      if (cost > remaining) continue;
      formatted.unshift(block);
      remaining -= cost;
    }
    if (formatted.length) {
      body = `${prefix}${formatted.join('\n\n')}${suffix}`;
      hasContext = true;
    }
  }

  // Upstream buildSystemPrompt: the one place that decides the order and the macro placement.
  let system = assembly.buildSystemPrompt({ systemPrompt }, hasContext, assembly.scope, glossary, incoming, '', incoming ? input.persona ?? '' : '');
  if (input.hasMarkers) system = [system, MARKER_INSTRUCTION].filter(Boolean).join('\n\n');
  system = system.replaceAll('{{targetLanguage}}', targetLanguage.trim());
  if (system.length > SYSTEM_PROMPT_MAX) throw new TranslationLimitError('systemPrompt', system.length, SYSTEM_PROMPT_MAX);

  return { system, user: `Translate the following text to ${targetLanguage}:\n\n${body}`, hasContext };
}

/** Request that continues a translation that stopped early. */
export function buildContinuationRequest(base: TranslationRequest, partial: string, targetLanguage: string): TranslationRequest {
  const system =
    `${base.system}\n\nThe earlier translation of this text into ${targetLanguage} stopped before the end. ` +
    'Continue it: output only the remaining translation, starting exactly where [Translation So Far] stops. ' +
    'If it stops in the middle of a word, start with the rest of that word. ' +
    'Do not repeat anything already translated and do not add any commentary. ' +
    'If nothing remains to be translated, output nothing.';
  const user = `${base.user}\n\n[Translation So Far]\n${partial}\n[End Translation So Far]`;
  return { system, user, hasContext: base.hasContext };
}
