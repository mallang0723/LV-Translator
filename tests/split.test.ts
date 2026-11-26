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

import { readFileSync } from 'node:fs';
import { extractSegments, withPrefill } from '../src/host-emu/split';

/** The original's own functions, taken from the vendored file itself (so a change there shows up here). */
const vendor = (() => {
  const src = readFileSync(new URL('../src/vendor/tt-1.10.0/personal-extension/extension.js', import.meta.url), 'utf8');
  const a = src.indexOf('  function stripThinking(text) {');
  const b = src.indexOf('  function parseJsonLoose(text) {');
  return new Function(`${src.slice(a, b)}\nreturn { extractSegments, stripThinking };`)() as { extractSegments(s: string): { map: Map<number, string>; rest: string } };
})();

describe('reading replies like the original (0.5.3)', () => {
  const replies = [
    '<segment id="1">\n하나\n</segment>\n<segment id="2">\n둘\n</segment>',
    '<segment id="1">\n하나\n<segment id="2">\n둘\n', // closing tags missing (loose)
    '<think>생각 <segment id="9">x</segment></think>\n<segment id="1">\n하나\n</segment>',
    '앞말 </think>\n<segment id=\'1\'>하나</segment> <segment id = 2 >둘</segment>',
    '<translate>\n<segment id="1">하나\n<segment id="2">둘</translate>',
    '그냥 번역문만',
    '',
  ];
  test('our extractSegments gives exactly the vendor function\'s result on every reply shape', () => {
    for (const r of replies) {
      const ours = extractSegments(r);
      const theirs = vendor.extractSegments(r);
      expect([...ours.map]).toEqual([...theirs.map]);
      expect(ours.rest).toBe(theirs.rest);
    }
  });

  test('the prefill is put in front of the reply as the original does', () => {
    expect(withPrefill('번역', '알겠습니다:')).toBe('알겠습니다:번역');
    expect(withPrefill('알겠습니다:번역', '알겠습니다:')).toBe('알겠습니다:번역');
    expect(withPrefill('번역', '')).toBe('번역');
  });

  /** A model that leaves out the closing tags, thinks first, and starts after a prefill. */
  const sloppy = () => async (req: any) => {
    const b = parseBatch(req.messages.find((m: any) => m.role === 'user').content)!;
    return { content: `<think>잠깐</think>${b.segments.map((s) => `<segment id="${s.id}">\n번역 ${s.text[0]}`).join('\n')}` };
  };
  const withPre = (r: ReturnType<typeof request>) => ({ ...r, messages: [...r.messages, { role: 'assistant', content: '알겠습니다:' }] });

  test('review repro: no closing tags, <think>, prefill, limit set: the result read by the original equals the no-limit result', async () => {
    const req = withPre(request([800, 800, 800, 800, 800]));
    const plain = await withBatchLimit(sloppy(), () => 0)(req);
    const limited = await withBatchLimit(sloppy(), () => 1700)(req);
    // what the original makes of each (prefill in front, then its own reading)
    const read = (c: string | undefined) => [...extractSegments(withPrefill(c ?? '', '알겠습니다:')).map];
    expect(read(limited.content)).toEqual(read(plain.content));
    expect(read(limited.content).map(([k, v]) => `${k}:${v}`)).toEqual(['1:번역 A', '2:번역 B', '3:번역 C', '4:번역 D', '5:번역 E']);
  });

  test('a bare reply to a one-paragraph part is taken (as the original does), and a prefill that is a segment tag is not split', async () => {
    const bare = async () => ({ content: '맨 번역' });
    const out = await withBatchLimit(bare, () => 500)(request([400, 400]));
    expect(out.content).toContain('<segment id="1">\n맨 번역\n</segment>');
    let calls = 0;
    await withBatchLimit(async () => { calls++; return { content: 'x' }; }, () => 500)({ ...request([400, 400]), messages: [...request([400, 400]).messages, { role: 'assistant', content: '<segment id="1">' }] });
    expect(calls).toBe(1);
  });
});
