import { expect, test } from 'bun:test';
import { makeMessage, withHost } from './helpers/fake-host';
import { stripReasoning } from '../src/message-ui';

// Lumiverse Auto-parse ON hands the render processor the stored text with <think> blocks cut out and trim()med.

test('stripReasoning mirrors the host parser', () => {
  expect(stripReasoning('<think>plan</think>\n\nHello.')).toBe('Hello.');
  expect(stripReasoning('Hello.\n')).toBe('Hello.');
  expect(stripReasoning('Hello <think>cut off')).toBe('Hello');
});

test('Auto-parse ON: a message without <think> but with surrounding whitespace still shows its translation', async () => {
  await withHost({ caps: {} }, async (h) => {
    const reply = makeMessage('r1', '\nHello there.\n');
    h.messages.push(reply);
    h.setComplete(async () => ({ content: '안녕하세요.', finish_reason: 'stop' }));
    await h.emit({ messageId: reply.id, content: reply.content });
    expect(h.record(reply)?.status).toBe('done');
    const rendered = await h.render(reply, 'Hello there.');
    expect(rendered?.content).toContain('안녕하세요.');
    expect(rendered?.content).toContain('Hello there.');
  });
});

test('Auto-parse ON: a message with <think> shows its translation (stored under the full-text key), without the thought', async () => {
  await withHost({ caps: {} }, async (h) => {
    const full = '<think>He is hiding something.</think>\n\nHello there.';
    const reply = makeMessage('r2', full);
    h.messages.push(reply);
    h.setComplete(async () => ({ content: '⟦1⟧그는 뭔가 숨긴다.⟦2⟧\n\n안녕하세요.', finish_reason: 'stop' }));
    await h.emit({ messageId: reply.id, content: full });
    expect(h.record(reply)?.status).toBe('done');
    const rendered = await h.render(reply, 'Hello there.');
    expect(rendered?.content).toContain('안녕하세요.');
    expect(rendered?.content).toContain('Hello there.');
    expect(rendered?.content).not.toContain('think');
    expect(rendered?.content).not.toContain('숨긴다');
    // Auto-parse OFF: the full stored text keeps working as before.
    const off = await h.render(reply);
    expect(off?.content).toContain('안녕하세요.');
  });
});

test('a displayed text that matches no stored text stays untranslated', async () => {
  await withHost({ caps: {} }, async (h) => {
    const reply = makeMessage('r3', 'Hello there.');
    h.messages.push(reply);
    await h.emit({ messageId: reply.id, content: reply.content });
    expect(await h.render(reply, 'Something else.')).toBeUndefined();
  });
});

// ---- 0.4.2: reasoning is stripped from the translation side only, never from the combined output ----

import { DISPLAY_MODES, normalizeStore, type DisplayMode } from '../src/shared';

async function renderIn(mode: DisplayMode, unit: 'whole' | 'paragraph', full: string, display: string, translated: string): Promise<string> {
  let out = '';
  await withHost({ caps: {} }, async (h) => {
    const reply = makeMessage(`m-${mode}-${unit}`, full);
    h.messages.push(reply);
    const settings = { ...normalizeStore(null).defaults, displayMode: mode, translationUnit: unit };
    await h.send({ type: 'save_settings', chatId: h.chatId, settings, asDefault: false });
    if (unit === 'whole') h.setComplete(async () => ({ content: translated, finish_reason: 'stop' }));
    else {
      // one request per paragraph: answer with the matching paragraph of the whole translation (marker paragraphs map to themselves)
      const src = full.split('\n\n').map((p) => p.replace(/<\/?think>/g, '')), dst = translated.split('\n\n');
      h.setComplete(async (input) => {
        const last = JSON.stringify(input.messages).split('[Text to Translate]').at(-1) ?? '';
        const i = src.findIndex((p) => last.includes(JSON.stringify(p).slice(1, -1)));
        return { content: dst[i] ?? '', finish_reason: 'stop' };
      });
    }
    await h.send({ type: 'translate', chatId: h.chatId, messageId: reply.id, force: false });
    expect(h.record(reply)?.error ?? h.record(reply)?.status).toBe('done');
    out = (await h.render(reply, display))?.content ?? '';
  });
  return out;
}

const FULL = '<think>He is hiding something.</think>\n\n*He smiles.* Hello there.\n\nBye now.';
const SHOWN = '*He smiles.* Hello there.\n\nBye now.';
const TR = '⟦1⟧그는 뭔가 숨긴다.⟦2⟧\n\n*그가 웃는다.* 안녕하세요.\n\n잘 가요.';

for (const unit of ['whole', 'paragraph'] as const) {
  for (const mode of DISPLAY_MODES) {
    test(`Auto-parse + leading <think> [${mode}/${unit}]: blank lines kept, no thought, host text used as source`, async () => {
      const out = await renderIn(mode, unit, FULL, SHOWN, TR);
      expect(out).not.toMatch(/think|숨긴다|hiding/);
      if (mode !== 'only') { expect(out).toContain('*He smiles.* Hello there.'); expect(out).toContain('Bye now.'); }
      expect(out).toContain('*그가 웃는다.* 안녕하세요.');
      expect(out).toContain('잘 가요.');
      if (mode === 'below' || mode === 'above') expect(out).toMatch(/<hr class="stt-separator">\n\n\S/);
      if (mode === 'collapsed-source') expect(out).toContain('<summary>원문</summary>\n\n*He smiles.*');
      if (mode === 'collapsed') expect(out).toContain('<summary>번역</summary>\n\n*그가');
      if (mode === 'paragraph') {
        // source paragraph count = translation paragraph count (2 + 2), reasoning-only pair gone, <div>s balanced
        expect(out.match(/stt-pr-src/g)?.length).toBe(2);
        expect(out.match(/stt-pr-tgt/g)?.length).toBe(2);
        expect(out.match(/<div/g)?.length).toBe(out.match(/<\/div>/g)?.length);
        expect(out).toContain('원문 1');
        expect(out).not.toContain('원문 3');
      }
    });

    test(`Auto-parse + unclosed trailing <think> [${mode}/${unit}]: translation kept, markup closed`, async () => {
      const full = 'Hello there.\n\nBye now.\n\n<think>cut off';
      const out = await renderIn(mode, unit, full, 'Hello there.\n\nBye now.', '안녕하세요.\n\n잘 가요.\n\n⟦1⟧잘렸다');
      expect(out).not.toMatch(/think|잘렸다|cut off/);
      expect(out).toContain('안녕하세요.');
      expect(out).toContain('잘 가요.');
      if (mode !== 'only') expect(out).toContain('Hello there.');
      expect(out.match(/<div/g)?.length ?? 0).toBe(out.match(/<\/div>/g)?.length ?? 0);
      expect(out.match(/<details/g)?.length ?? 0).toBe(out.match(/<\/details>/g)?.length ?? 0);
    });
  }
}
