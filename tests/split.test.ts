import { describe, expect, test } from 'bun:test';
import { groupSegments, parseBatch, withBatchLimit } from '../src/host-emu/split';

const request = (sizes: number[], context = '') => ({
  connectionId: 'c1',
  messages: [
    { role: 'system', content: 'You are a translator.' },
    { role: 'user', content: `${context}<translate>\n${sizes.map((n, i) => `<segment id="${i + 1}">\n${String.fromCharCode(65 + i).repeat(n)}\n</segment>`).join('\n')}\n</translate>` },
  ],
});

/** A fake model: answers every segment it is sent with `K<id>` and records what it was sent. */
const model = () => {
  const calls: Array<{ ids: number[]; chars: number; ctx: boolean }> = [];
  const generate = async (req: any) => {
    const user = req.messages.find((m: any) => m.role === 'user').content as string;
    const b = parseBatch(user)!;
    calls.push({ ids: b.segments.map((s) => s.id), chars: b.segments.reduce((n, s) => n + s.text.length, 0), ctx: b.before.startsWith('<context>') });
    return { content: b.segments.map((s) => `<segment id="${s.id}">\n번역 ${s.text[0]}\n</segment>`).join('\n') };
  };
  return { calls, generate };
};

describe('한 번에 번역할 글자수: a smaller limit splits the original\'s batch (0.5.3)', () => {
  test('no limit set: the request goes as it is, once', async () => {
    const m = model();
    const out = await withBatchLimit(m.generate, () => 0)(request([1000, 1000, 1000, 1000, 1000]));
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.ids).toEqual([1, 2, 3, 4, 5]);
    expect(out.content).toContain('번역 E');
  });

  test('a long message with a small limit makes several requests, each at or under the limit, and the answer is the same as one request', async () => {
    const whole = model();
    const split = model();
    const req = request([1000, 1000, 1000, 1000, 1000]);
    const one = await withBatchLimit(whole.generate, () => 0)(req);
    const many = await withBatchLimit(split.generate, () => 2500)(req);
    expect(split.calls.length).toBeGreaterThan(1);
    expect(split.calls.map((c) => c.ids.length)).toEqual([2, 2, 1]);
    for (const c of split.calls) expect(c.chars).toBeLessThanOrEqual(2500);
    // the original reads the merged answer under its own ids, exactly like the single reply
    const read = (t: string | undefined) => [...(t ?? '').matchAll(/<segment id="(\d+)">\n([\s\S]*?)\n<\/segment>/g)].map((x) => [x[1], x[2]]);
    expect(read(many.content)).toEqual(read(one.content));
  });

  test('a paragraph longer than the limit goes alone; the context stays in every request', async () => {
    const m = model();
    await withBatchLimit(m.generate, () => 500)(request([200, 900, 200, 200], '<context>\nearlier\n</context>\n\n'));
    expect(m.calls.map((c) => c.chars)).toEqual([200, 900, 400]);
    expect(m.calls.every((c) => c.ctx)).toBe(true);
  });

  test('a single segment, or a body that is not only segments, is passed through untouched', async () => {
    const m = model();
    await withBatchLimit(m.generate, () => 10)(request([800]));
    expect(m.calls).toHaveLength(1);
    const odd = { messages: [{ role: 'user', content: 'plain text, no translate block' }] };
    let seen = 0;
    await withBatchLimit(async () => { seen++; return { content: 'x' }; }, () => 10)(odd);
    expect(seen).toBe(1);
  });

  test('grouping is sequential and keeps order', () => {
    expect(groupSegments([{ text: 'aa' }, { text: 'bb' }, { text: 'cc' }], 4).map((g) => g.length)).toEqual([2, 1]);
  });
});
