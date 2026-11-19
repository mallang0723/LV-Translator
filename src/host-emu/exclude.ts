// 제외 규칙 (the LV "제외 규칙" setting: /regex/ and "시작 ... 끝" lines) in the original's paragraph translation.
// An excluded part is not sent to the model and stays in the translated view as the original text, in place. The original has its own
// mechanism for TAGS (그 "번역에서 제외할 태그": kept ranges, never sent, shown as they were), which the tag settings use; text rules
// cannot be expressed there, so they are applied at the one place every request of the original passes (`/api/generate/raw`):
//   - the rules are matched on the batch's paragraph texts joined with blank lines, so a "시작 ... 끝" block that spans several paragraphs is found;
//   - the matched characters of each paragraph become ⟦n⟧ markers (the 0.4.0 protection), restored after the answer; a paragraph that is
//     excluded entirely is not sent at all and answered with its own text.
// The original then sees an ordinary answer; nothing in it is edited.

import { checkMarkers, MARKER_INSTRUCTION, parseExcludeRules, restore } from '../translate/protect';
import { extractSegments, parseBatch, type RawGenerate, withPrefill } from './split';

const MARK = (n: number) => `⟦${n}⟧`;

export function excludedRanges(joined: string, rules: RegExp[]): Array<[number, number]> {
  const all: Array<[number, number]> = [];
  for (const rule of rules) {
    const re = new RegExp(rule.source, rule.flags.includes('g') ? rule.flags : `${rule.flags}g`);
    for (const m of joined.matchAll(re)) if (m[0].length) all.push([m.index!, m.index! + m[0].length]);
  }
  all.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const r of all) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

export function withExclusions(generate: RawGenerate, rulesText: () => string): RawGenerate {
  return async (req, signal) => {
    const raw = rulesText();
    if (!raw.trim()) return generate(req, signal);
    let rules: RegExp[];
    try {
      rules = parseExcludeRules(raw);
    } catch {
      return generate(req, signal); // an invalid rule is reported when the setting is saved
    }
    const userIndex = req.messages.map((m: { role: string }) => m.role).lastIndexOf('user');
    const parsed = userIndex >= 0 ? parseBatch(req.messages[userIndex]!.content) : null;
    if (!parsed || !rules.length) return generate(req, signal);

    const SEP = '\n\n';
    const joined = parsed.segments.map((s) => s.text).join(SEP);
    const ranges = excludedRanges(joined, rules);
    if (!ranges.length) return generate(req, signal);

    interface Item { id: number; source: string; masked: string; pieces: string[]; full: boolean }
    const items: Item[] = [];
    let at = 0;
    for (const seg of parsed.segments) {
      const from = at;
      const to = at + seg.text.length;
      at = to + SEP.length;
      const pieces: string[] = [];
      let masked = '';
      let cursor = from;
      for (const [a, b] of ranges) {
        const lo = Math.max(a, from);
        const hi = Math.min(b, to);
        if (lo >= hi) continue;
        masked += joined.slice(cursor, lo) + MARK(pieces.push(joined.slice(lo, hi)));
        cursor = hi;
      }
      masked += joined.slice(cursor, to);
      const left = masked.replace(/⟦\d+⟧/g, '');
      items.push({ id: seg.id, source: seg.text, masked, pieces, full: pieces.length > 0 && !/[\p{L}\p{N}]/u.test(left) });
    }
    if (items.every((i) => !i.pieces.length)) return generate(req, signal);

    const send = items.filter((i) => !i.full);
    const done = new Map<number, string>();
    for (const i of items) if (i.full) done.set(i.id, i.source);
    if (send.length) {
      const body = send.map((s, j) => `<segment id="${j + 1}">\n${s.masked}\n</segment>`).join('\n');
      const anyMasked = send.some((s) => s.pieces.length);
      const messages = req.messages.map((m: { role: string; content: string }, i: number) => {
        if (i === userIndex) return { ...m, content: `${parsed.before}<translate>\n${body}\n</translate>${parsed.after}` };
        if (anyMasked && m.role === 'system') return { ...m, content: `${m.content}\n\n${MARKER_INSTRUCTION}` };
        return m;
      });
      const reply = await generate({ ...req, messages }, signal);
      if (reply.aborted) return reply;
      const last = req.messages[req.messages.length - 1]!;
      const { map, rest } = extractSegments(withPrefill(reply.content ?? '', last.role === 'assistant' ? last.content : ''));
      if (!map.size && send.length === 1 && rest && !/<segment/i.test(rest)) map.set(1, rest);
      send.forEach((s, j) => {
        const got = map.get(j + 1);
        if (got === undefined) return;
        if (s.pieces.length) {
          if (checkMarkers(s.masked, got)) return; // markers lost: left out, the original retries it
          done.set(s.id, restore(got, s.pieces));
        } else done.set(s.id, got);
      });
    }
    return { content: items.filter((i) => done.has(i.id)).map((i) => `<segment id="${i.id}">\n${done.get(i.id)}\n</segment>`).join('\n') };
  };
}
