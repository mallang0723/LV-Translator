// "한 번에 번역할 글자수": the original groups the paragraphs of a message into requests of at most 6000 characters (BATCH_CHARS in
// extension.js, a constant of its own with no setting). A smaller limit is applied here, at the one place every request of the original
// passes (its `/api/generate/raw`): a request whose segments add up to more than the limit is sent as several requests, each at or
// under the limit (a single paragraph longer than the limit goes alone), and the answers are put back together under the original ids,
// so the original sees one reply as before. With no limit set (0) nothing here runs and the original works exactly as it did.

interface Msg { role: string; content: string }
export interface RawRequest { connectionId?: string; messages: Msg[]; parameters?: unknown; [k: string]: unknown }
export type RawGenerate = (req: any, signal?: AbortSignal) => Promise<{ content?: string; aborted?: boolean }>;

const SEGMENT = /<segment id="(\d+)">\n([\s\S]*?)\n<\/segment>/g;

/** The user message the original builds for a batch: `${context}<translate>\n<segment id="1">\n…\n</segment>…\n</translate>`. */
export function parseBatch(content: string): { before: string; after: string; segments: Array<{ id: number; text: string }> } | null {
  const open = content.indexOf('<translate>\n');
  const close = content.lastIndexOf('\n</translate>');
  if (open < 0 || close < open) return null;
  const body = content.slice(open + '<translate>\n'.length, close);
  const segments: Array<{ id: number; text: string }> = [];
  let rebuilt = '';
  for (const m of body.matchAll(SEGMENT)) {
    segments.push({ id: Number(m[1]), text: m[2]! });
    rebuilt += m[0] + '\n';
  }
  // Only a body that is nothing but segments is split; anything else goes as it is.
  if (segments.length < 1 || rebuilt.slice(0, -1) !== body) return null;
  return { before: content.slice(0, open), after: content.slice(close + '\n</translate>'.length), segments };
}

export function groupSegments<T extends { text: string }>(segments: T[], limit: number): T[][] {
  const groups: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const s of segments) {
    if (cur.length && size + s.text.length > limit) { groups.push(cur); cur = []; size = 0; }
    cur.push(s);
    size += s.text.length;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const REPLY = /<segment\s+id\s*=\s*["']?(\d+)["']?\s*>([\s\S]*?)<\/segment\s*>/gi;

export function withBatchLimit(generate: RawGenerate, limit: () => number): RawGenerate {
  return async (req, signal) => {
    const max = limit();
    if (!(max > 0)) return generate(req, signal);
    const userIndex = req.messages.map((m: Msg) => m.role).lastIndexOf('user');
    const parsed = userIndex >= 0 ? parseBatch(req.messages[userIndex]!.content) : null;
    if (!parsed) return generate(req, signal);
    const groups = groupSegments(parsed.segments, max);
    if (groups.length < 2) return generate(req, signal);
    const parts: string[] = [];
    for (const group of groups) {
      const body = group.map((s, i) => `<segment id="${i + 1}">\n${s.text}\n</segment>`).join('\n');
      const messages = req.messages.map((m: Msg, i: number) => (i === userIndex ? { ...m, content: `${parsed.before}<translate>\n${body}\n</translate>${parsed.after}` } : m));
      const reply = await generate({ ...req, messages }, signal);
      if (reply.aborted) return reply;
      const text = reply.content ?? '';
      const found = new Map<number, string>();
      for (const m of text.matchAll(REPLY)) found.set(Number(m[1]), m[2]!.replace(/^\n+|\n+$/g, ''));
      // A one-paragraph request may be answered with the bare translation (the original accepts that too).
      if (!found.size && group.length === 1 && text.trim() && !/<segment/i.test(text)) found.set(1, text.trim());
      group.forEach((s, i) => {
        const got = found.get(i + 1);
        if (got !== undefined) parts.push(`<segment id="${s.id}">\n${got}\n</segment>`);
      });
    }
    return { content: parts.join('\n') };
  };
}
