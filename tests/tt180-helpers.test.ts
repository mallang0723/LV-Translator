import { describe, expect, test } from 'bun:test';
import { blockKey, hashText, isPairedDialogue, normalizeForKey } from '../src/vendor/tt-1.8.0/helpers';
import { createAssembly } from '../src/vendor/tt-1.8.0/assembly';
import { DEFAULT_SETTINGS } from '../src/shared';
import { buildTranslationRequest } from '../src/translate/prompt';
import { promptPresets } from '../src/presets';
import { skipsRequest } from '../src/translate/engine';

// Cases of upstream tests/test.js "unitKind" (the DOM wrappers <x1> are kept in the first one).
describe('isPairedDialogue (upstream 1.8.0)', () => {
  test('dialogue already paired with its Korean is final text', () => {
    expect(isPairedDialogue('빅터 | <x1>"Did you rehearse that line on the train, chérie?"</x1> (기차에서 연습이라도 했어, 자기?)', 'Korean')).toBe(true);
    expect(isPairedDialogue('<speaker="세라">세라 | "Alors cherchez mieux, même à Lyon."</speaker> (그럼 더 똑바로 찾아.)', 'Korean')).toBe(true);
  });
  test('foreign line without a translation, narration around a paired line, and non-Korean targets are still sent', () => {
    expect(isPairedDialogue('마르코 | "¿Qué ha dicho? ¿Inglés?"', 'Korean')).toBe(false);
    expect(isPairedDialogue('He smiled. "Come here." (이리 와.)', 'Korean')).toBe(false);
    expect(isPairedDialogue('빅터 | "Come here." (이리 와.)', 'Japanese')).toBe(false);
  });
  test('the engine skips such a paragraph only in paragraph mode', () => {
    const s = { ...DEFAULT_SETTINGS, translationUnit: 'paragraph' as const };
    expect(skipsRequest('빅터 | "Salut." (안녕.)', s, 'Korean')).toBe(true);
    expect(skipsRequest('빅터 | "Salut." (안녕.)', { ...s, translationUnit: 'whole' }, 'Korean')).toBe(false);
  });
});

describe('contract keys', () => {
  // Test vectors for the memory side (FNV-1a 32 bit, base 36), including Korean and emoji (UTF-16 code units).
  test('hashText vectors (computed independently in Python over UTF-16 code units)', () => {
    const vectors: Array<[string, string]> = [["", "ztntfp"], ["a", "1r9wi7g"], ["The lamp was still burning.", "1sdhh2c"], ["등불은 아직 타고 있었다.", "1log4n5"], ["Hi 👋", "aa3t2"]];
    for (const [input, out] of vectors) expect(hashText(input)).toBe(out);
  });
  test('blockKey ignores markdown marks, quote style and spacing', () => {
    expect(normalizeForKey('*“Hi,”  he   said.*')).toBe('"Hi," he said.');
    expect(blockKey('*“Hi,”  he   said.*')).toBe(blockKey('"Hi," he said.'));
  });
});

const normalizeNotes = createAssembly({ currentScope: () => ({}), storedConfig: { presets: [] }, paragraph: {} }).normalizeNotes;

describe('notes (upstream normalizeNotes)', () => {
  test('keeps valid notes, drops duplicates and bad ids, caps length', () => {
    const notes = normalizeNotes([
      { id: 'note-1', name: ' A ', text: ' x ' },
      { id: 'note-1', name: 'B', text: 'y' },
      { id: 'note-2', name: 'A', text: 'z' },
      { id: 'bad', name: 'C', text: 'c' },
      { id: 'note-3', name: 'D', text: '' },
      { id: 'note-4', name: 'E', text: 'e'.repeat(13000) },
      null,
    ]);
    expect(notes.map((n: any) => n.id)).toEqual(['note-1', 'note-4']);
    expect(notes[1]!.text.length).toBe(12000);
  });
});

describe('prompt assembly (upstream buildSystemPrompt)', () => {
  const req = (settings: Record<string, unknown>, persona = '') =>
    buildTranslationRequest({ direction: 'incoming', text: 'Alice said "Hey".', settings: { ...DEFAULT_SETTINGS, ...settings } as any, presets: promptPresets([]), previous: [], hasMarkers: false, persona });

  test('the three live presets take 기타 지침 as a style instruction, other presets as reference', () => {
    const live = req({ incomingPresetId: 'builtin-korean-style-foreign-dialogue', freeContextEnabled: true, freeContext: 'RULE <x>' }).system;
    expect(live).toContain('# User Translation Style Instructions\nFollow these instructions');
    expect(live).toContain('RULE <x>');
    const plain = req({ incomingPresetId: 'builtin-english-korean', freeContextEnabled: true, freeContext: 'RULE <x>' }).system;
    expect(plain).not.toContain('# User Translation Style Instructions');
    expect(plain).toContain('RULE &lt;x&gt;');
  });

  test('persona text is sent for the live presets only, after the voice', () => {
    const persona = '# User Persona\nThe user\'s persona is named "Mina".';
    expect(req({ incomingPresetId: 'builtin-korean-style-foreign-dialogue-generate' }, persona).system).toContain(persona);
    expect(req({ incomingPresetId: 'builtin-english-korean' }, '').system).not.toContain('# User Persona');
  });

  test('glossary with {{vocab}} goes into the system prompt; a prompt without it keeps the old placement', () => {
    const withVocab = req({ incomingPresetId: 'builtin-english-korean', glossary: 'Alice = 앨리스' });
    expect(withVocab.system).toContain('"Alice" → "앨리스"');
    expect(withVocab.user).not.toContain('[Reference Glossary');
    const custom = buildTranslationRequest({ direction: 'incoming', text: 'Alice says hi', settings: { ...DEFAULT_SETTINGS, incomingPresetId: 'custom-x', glossary: 'Alice = 앨리스' }, presets: [{ id: 'custom-x', prompt: 'Translate to {{targetLanguage}}.', replace: true }], previous: [], hasMarkers: false });
    expect(custom.user).toContain('[Reference Glossary');
    expect(custom.user).toContain('[Text to Translate]\nAlice says hi\n[End Text]');
    expect(custom.system).toContain('Translate only [Text to Translate].');
  });

  test('voice goes to {{voice}} when the prompt has it, at the end when not', () => {
    const inPlace = req({ incomingPresetId: 'builtin-english-korean', incomingVoiceEnabled: true, incomingVoicePrompt: 'VOICE-NOTES' }).system;
    expect(inPlace).toContain('# Character Voice Instructions\nVOICE-NOTES');
    expect(inPlace).not.toContain('{{voice}}');
    const custom = buildTranslationRequest({ direction: 'incoming', text: 'x', settings: { ...DEFAULT_SETTINGS, incomingPresetId: 'custom-x', incomingVoiceEnabled: true, incomingVoicePrompt: 'VOICE-NOTES' }, presets: [{ id: 'custom-x', prompt: 'Translate.', replace: true }], previous: [], hasMarkers: false });
    expect(custom.system.endsWith('# Character Voice Instructions\nVOICE-NOTES')).toBe(true);
  });

  test('the assembly factory has no hidden state between calls', () => {
    const a = createAssembly({ currentScope: () => ({ incomingPresetId: 'x' }), storedConfig: { presets: [] }, paragraph: {} });
    const b = createAssembly({ currentScope: () => ({ incomingPresetId: 'y' }), storedConfig: { presets: [] }, paragraph: {} });
    expect(a.fillPromptMacros('A {{voice}}', 'V', '').text).toBe('A V');
    expect(b.fillPromptMacros('A\n{{voice}}\nB', '', '').text).toBe('A\nB');
  });
});
