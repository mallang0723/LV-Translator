import { describe, expect, test } from 'bun:test';
import cases from './fixtures/upstream-requests-1.8.0.json';
import { promptPresets } from '../src/presets';
import { BASE_PROMPT, HANGUL_ONLY_RULE } from '../src/presets/catalog';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared';
import { buildTranslationRequest, type ContextMessage, type Direction, SYSTEM_PROMPT_MAX, TRANSLATION_TEXT_MAX, TranslationLimitError } from '../src/translate/prompt';
import { MARKER_INSTRUCTION } from '../src/translate/protect';

// Fixture: final AI requests recorded from Marinara-Translation-Tools 1.5.4 running in a vm (with Marinara
// Engine's {{targetLanguage}} resolution and "Translate the following text to" wrapper). For 1.8.0 the cases
// that change carry both the 1.5.4 text (expected154) and the 1.8.0 text (expected). Every change must be
// content-preserving: only the placement of the glossary and character voice ({{vocab}}/{{voice}} in the
// presets) and the Hangul-only line differ.
type Case = { direction: Direction; text: string; settings: Record<string, unknown>; previous: ContextMessage[]; expected: { system: string; user: string }; expected154?: { system: string; user: string } };
const lineBag = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l && l !== '{{voice}}' && l !== '{{vocab}}').sort();

describe('translation requests follow Translation Tools 1.8.0', () => {
  (cases as Case[]).forEach((c, i) => {
    test(`case ${i + 1} (${c.direction})`, () => {
      const req = buildTranslationRequest({
        direction: c.direction,
        text: c.text,
        settings: normalizeSettings(c.settings),
        presets: promptPresets([]),
        previous: c.previous,
        hasMarkers: false,
      });
      expect(req.system).toBe(c.expected.system);
      expect(req.user).toBe(c.expected.user);
    });

    if (!c.expected154) return;
    test(`case ${i + 1} changed only by macro placement or the Hangul-only line`, () => {
      const s = normalizeSettings(c.settings);
      // 1.5.4 bug that 1.8.0 fixes ({{voice}} sits in the base prompt): with "채팅 설정 유지", an empty chat
      // prompt and the character voice on, 1.5.4 sent the voice section without any translation instruction.
      const dropsBase =
        c.direction === 'incoming' && s.incomingPresetId === 'builtin-inherit' && !s.incomingPrompt.trim() && s.incomingVoiceEnabled && s.incomingVoicePrompt.trim() !== '';
      const old154 = dropsBase ? `${BASE_PROMPT.replace(/\n*\{\{(?:voice|vocab)\}\}/g, '').replaceAll('{{targetLanguage}}', s.myLanguage)}\n\n${c.expected154!.system}` : c.expected154!.system;
      const hangul = HANGUL_ONLY_RULE.trim();
      const removeHangul = (t: string) => t.split('\n').filter((l) => l.trim() !== hangul).join('\n');
      // The glossary rule loses its closing sentence when the prompt places the glossary itself.
      const sentence = ' Translate only [Text to Translate].';
      const newAll = removeHangul(`${c.expected.system}\n${c.expected.user}`).replaceAll(sentence, '').replace('[Text to Translate]\n', '').replace('[End Text]', '');
      const oldAll = `${old154}\n${c.expected154!.user}`.replaceAll(sentence, '').replace('[Text to Translate]\n', '').replace('[End Text]', '');
      expect(lineBag(newAll)).toEqual(lineBag(oldAll));
    });
  });
});

describe('limits and markers', () => {
  const settings = { ...DEFAULT_SETTINGS };
  test('system prompt over 200,000 characters stops instead of cutting', () => {
    const s = { ...settings, freeContextEnabled: true, freeContext: 'x'.repeat(SYSTEM_PROMPT_MAX) };
    expect(() => buildTranslationRequest({ direction: 'incoming', text: 'a', settings: s, presets: promptPresets([]), previous: [], hasMarkers: false })).toThrow(TranslationLimitError);
  });
  test('text over 50,000 characters stops', () => {
    expect(() => buildTranslationRequest({ direction: 'incoming', text: 'a'.repeat(TRANSLATION_TEXT_MAX + 1), settings, presets: promptPresets([]), previous: [], hasMarkers: false })).toThrow(TranslationLimitError);
  });
  test('marker instruction is added only when markers exist', () => {
    const base = { direction: 'incoming' as const, text: 'a ⟦1⟧', settings, presets: promptPresets([]), previous: [] };
    expect(buildTranslationRequest({ ...base, hasMarkers: true }).system.endsWith(MARKER_INSTRUCTION)).toBe(true);
    expect(buildTranslationRequest({ ...base, hasMarkers: false }).system.includes(MARKER_INSTRUCTION)).toBe(false);
  });
  test('user presets replace the prompt; unknown preset falls back to the chat prompt', () => {
    const presets = promptPresets([{ id: 'custom-1', name: 'Mine', prompt: 'MINE into {{targetLanguage}}' }]);
    expect(buildTranslationRequest({ direction: 'incoming', text: 'a', settings: { ...settings, incomingPresetId: 'custom-1' }, presets, previous: [], hasMarkers: false }).system).toBe('MINE into Korean');
    expect(buildTranslationRequest({ direction: 'incoming', text: 'a', settings: { ...settings, incomingPresetId: 'gone', incomingPrompt: 'OWN' }, presets, previous: [], hasMarkers: false }).system).toBe('OWN');
  });
});

describe('incoming prompt reaches the translation request', () => {
  test('a changed chat prompt (and a changed preset) is what the model receives, after the store round-trip', async () => {
    const { normalizeStore, settingsFor } = await import('../src/shared');
    const { translate } = await import('../src/translate/engine');
    const stored = JSON.parse(JSON.stringify(normalizeStore({ chats: { c1: { incomingPrompt: 'MY OWN PROMPT into {{targetLanguage}}' } } })));
    const chat = settingsFor(normalizeStore(stored), 'c1');
    const seen: string[] = [];
    const complete = async (req: { system: string }) => (seen.push(req.system), { text: 'ok', finishReason: 'stop' });
    const run = (s: typeof chat) => translate({ direction: 'incoming', source: 'Hello', settings: s, presets: promptPresets([]), previous: [] }, { complete: complete as never });
    await run(chat);
    expect(seen.at(-1)).toBe('MY OWN PROMPT into Korean');
    await run({ ...chat, incomingPrompt: 'CHANGED' });
    expect(seen.at(-1)).toBe('CHANGED');
    await run({ ...chat, incomingPresetId: 'builtin-roleplay' });
    expect(seen.at(-1)).not.toContain('CHANGED');
    expect(seen.at(-1)).toContain('Korean');
  });
});
