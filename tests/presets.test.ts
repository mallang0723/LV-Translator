import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import hashes154 from './fixtures/tt154-prompt-hashes.json';
import * as catalog from '../src/presets/catalog';
import { presetSummaries, promptPresets } from '../src/presets';
import { MARINARA_TRANSLATION_REFERENCE_PROMPTS } from '../src/vendor/tt-1.8.0/prompts';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const all = [...catalog.BUILTIN_PRESETS, ...catalog.V2_PRESETS, ...catalog.ADDITIONAL_BUILTIN_PRESETS];

describe('presets of Translation Tools 1.8.0', () => {
  test('every 1.5.4 preset differs only by the {{voice}}/{{vocab}} macros and the Hangul-only line', () => {
    for (const [id, expected] of Object.entries(hashes154)) {
      const preset = all.find((p) => p.id === id);
      expect(preset).toBeDefined();
      let prompt = preset!.prompt.replace(/\n\n\{\{voice\}\}/, '').replace(/\n\n\{\{vocab\}\}/, '');
      prompt = prompt.replace(`\n${catalog.HANGUL_ONLY_RULE}`, '');
      expect(sha(prompt)).toBe(expected);
    }
  });

  test('the new presets exist; Korean defaults carry the Hangul-only line, general and input presets do not', () => {
    const ids = new Set(all.map((p) => p.id));
    for (const id of ['builtin-korean-style-foreign-dialogue', 'builtin-korean-style-foreign-dialogue-generate', 'builtin-korean-style-keep-model-dialogue']) expect(ids.has(id)).toBe(true);
    const byId = (id: string) => all.find((p) => p.id === id)!.prompt;
    for (const id of ['builtin-english-korean', 'builtin-chinese-korean-v2', 'builtin-bilingual-dialogue-korean', 'builtin-english-paraphrase-korean', 'builtin-korean-style-keep-model-dialogue']) {
      expect(byId(id)).toContain('Write the Korean in Hangul only.');
    }
    for (const id of ['builtin-roleplay', 'builtin-literary-roleplay', 'builtin-literary-roleplay-input', 'builtin-literary-roleplay-input-bilingual-dialogue']) {
      expect(byId(id)).not.toContain('Write the Korean in Hangul only.');
    }
  });

  test('the picker lists the two foreign-dialogue presets right after "채팅 설정 유지"', () => {
    const list = presetSummaries([]);
    expect(list.slice(0, 3).map((p) => p.id)).toEqual(['builtin-inherit', 'builtin-korean-style-foreign-dialogue', 'builtin-korean-style-foreign-dialogue-generate']);
    expect(promptPresets([]).length).toBe(list.length);
  });

  test('reference prompts are the 1.8.0 text', () => {
    expect(MARINARA_TRANSLATION_REFERENCE_PROMPTS.glossary).toContain('[Text to Translate]');
  });
});
