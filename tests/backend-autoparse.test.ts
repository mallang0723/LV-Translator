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
