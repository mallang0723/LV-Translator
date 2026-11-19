import { describe, expect, test } from 'bun:test';
import { excludedRanges, withExclusions } from '../src/host-emu/exclude';
import { parseBatch } from '../src/host-emu/split';
import { parseExcludeRules } from '../src/translate/protect';

const request = (texts: string[]) => ({
  messages: [
    { role: 'system', content: 'You are a translator.' },
    { role: 'user', content: `<translate>\n${texts.map((t, i) => `<segment id="${i + 1}">\n${t}\n</segment>`).join('\n')}\n</translate>` },
  ],
});
/** A model that translates by prefixing 'KO ' and keeps every ⟦n⟧ marker. */
const model = () => {
  const sent: string[][] = [];
  let system = '';
  const generate = async (req: any) => {
    system = req.messages[0].content;
    const b = parseBatch(req.messages.find((m: any) => m.role === 'user').content)!;
    sent.push(b.segments.map((s) => s.text));
    return { content: b.segments.map((s) => `<segment id="${s.id}">\nKO ${s.text}\n</segment>`).join('\n') };
  };
  return { sent, generate, system: () => system };
};
const read = (c?: string) => Object.fromEntries([...(c ?? '').matchAll(/<segment id="(\d+)">\n([\s\S]*?)\n<\/segment>/g)].map((m) => [m[1], m[2]]));

describe('제외 규칙 in the original\'s paragraph translation: not sent, shown as the original, in place (0.5.3, bug 9)', () => {
  test('a /regex/ inside a paragraph is masked, not sent, and put back; the paragraph is still translated', async () => {
    const m = model();
    const out = await withExclusions(m.generate, () => '/HP: \\d+\\/\\d+/')(request(['Hello there.', 'Now HP: 10/20 and more.', 'Bye.']));
    expect(m.sent.flat().join('|')).not.toContain('HP: 10/20');
    expect(m.sent[0]![1]).toBe('Now ⟦1⟧ and more.');
    expect(m.system()).toContain('placeholder tokens');
    expect(read(out.content)).toEqual({ '1': 'KO Hello there.', '2': 'KO Now HP: 10/20 and more.', '3': 'KO Bye.' });
  });

  test('a "시작 ... 끝" block spanning several paragraphs: the paragraphs inside are not sent and come back as the original, in order', async () => {
    const m = model();
    const out = await withExclusions(m.generate, () => '[상태창] ... [/상태창]')(request(['Before.', '[상태창] HP 10', 'MP 5', 'Gold 3 [/상태창]', 'After.']));
    expect(m.sent[0]).toEqual(['Before.', 'After.']);
    expect(read(out.content)).toEqual({ '1': 'KO Before.', '2': '[상태창] HP 10', '3': 'MP 5', '4': 'Gold 3 [/상태창]', '5': 'KO After.' });
  });

  test('before, between and after prose; several rules; nothing matched means the request goes untouched', async () => {
    const m = model();
    const texts = ['<<plan>> first', 'Prose one.', '<<plan>> second', 'Prose two.', '<<plan>> third'];
    const out = await withExclusions(m.generate, () => '/<<plan>> \\w+/\n/zzz/')(request(texts));
    expect(m.sent[0]).toEqual(['Prose one.', 'Prose two.']);
    expect(Object.values(read(out.content))).toEqual(['<<plan>> first', 'KO Prose one.', '<<plan>> second', 'KO Prose two.', '<<plan>> third']);
    const n = model();
    await withExclusions(n.generate, () => '/nomatch/')(request(['a b c', 'd e f']));
    expect(n.sent[0]).toEqual(['a b c', 'd e f']);
  });

  test('everything excluded: no model call at all; no rules or an invalid rule: untouched', async () => {
    const m = model();
    const out = await withExclusions(m.generate, () => '/.+/')(request(['One', 'Two']));
    expect(m.sent).toHaveLength(0);
    expect(read(out.content)).toEqual({ '1': 'One', '2': 'Two' });
    for (const rules of ['', '/(/']) {
      const k = model();
      await withExclusions(k.generate, () => rules)(request(['x y z']));
      expect(k.sent[0]).toEqual(['x y z']);
    }
  });

  test('a model that drops a marker: that paragraph is left out (the original retries it), the others are kept', async () => {
    const bad = async (req: any) => {
      const b = parseBatch(req.messages.find((m: any) => m.role === 'user').content)!;
      return { content: b.segments.map((s) => `<segment id="${s.id}">\n번역\n</segment>`).join('\n') };
    };
    const out = await withExclusions(bad, () => '/X\\d/')(request(['plain text', 'has X1 inside']));
    expect(Object.keys(read(out.content))).toEqual(['1']);
  });

  test('ranges: overlapping matches merge', () => {
    expect(excludedRanges('aa bb cc', parseExcludeRules('/aa bb/\n/bb cc/'))).toEqual([[0, 8]]);
  });
});
