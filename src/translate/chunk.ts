// Splitting long sources and joining continued translations.
// splitForTranslation is ported from Translation Polisher 0.2.3 (long-passage split translation);
// it additionally never cuts through a ⟦n⟧ marker.

export const TRANSLATION_CHUNK_CHARS = 3200;

/** Moves a hard cut position so it does not fall inside a ⟦n⟧ marker. */
function safeCut(text: string, at: number): number {
  const open = text.lastIndexOf('⟦', at - 1);
  if (open < 0) return at;
  const close = text.indexOf('⟧', open);
  return close >= at ? close + 1 : at;
}

export function splitForTranslation(text: string, limit = TRANSLATION_CHUNK_CHARS): string[] {
  const paragraphs = String(text).replace(/\r\n/g, '\n').split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  const push = (value: string) => {
    const part = value.trim();
    if (!part) return;
    if (!current) current = part;
    else if (current.length + part.length + 2 <= limit) current += `\n\n${part}`;
    else {
      chunks.push(current);
      current = part;
    }
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length <= limit) {
      push(paragraph);
      continue;
    }
    const sentences = paragraph.match(/[^.!?。！？\n]+(?:[.!?。！？]+[”’"']?|$)|\n+/g) || [paragraph];
    let piece = '';
    for (const sentence of sentences) {
      if (sentence.length > limit) {
        if (piece.trim()) {
          push(piece);
          piece = '';
        }
        for (let i = 0; i < sentence.length; ) {
          const end = Math.min(sentence.length, safeCut(sentence, i + limit));
          push(sentence.slice(i, end));
          i = end;
        }
      } else if (!piece || piece.length + sentence.length <= limit) piece += sentence;
      else {
        push(piece);
        piece = sentence;
      }
    }
    push(piece);
  }
  if (current) chunks.push(current);
  return chunks;
}

const SENTENCE_END = /[.!?。！？…"”’'」』)\]]$/;

/** Joins a translation that stopped early with its continuation. */
export function joinContinuation(partial: string, continuation: string): string {
  let cont = continuation.replace(/^\s*\n/, '\n');
  if (!cont.trim()) return partial;
  // Drop a repeated tail (the model restating the last words it already wrote).
  const tail = partial.slice(-200);
  for (let k = Math.min(tail.length, cont.length); k >= 8; k--) {
    if (tail.endsWith(cont.slice(0, k))) {
      cont = cont.slice(k);
      break;
    }
  }
  if (!cont.trim()) return partial;
  if (/\s$/.test(partial) || /^\s/.test(cont)) return partial + cont;
  // A sentence ended right at the cut: separate with a space. Otherwise the cut was mid-word.
  return SENTENCE_END.test(partial) ? `${partial} ${cont}` : partial + cont;
}

/** Whether a provider finish reason means the output limit cut the text. */
export function isTruncatedFinish(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  const r = reason.toLowerCase();
  return r === 'length' || r.includes('max_tokens') || r.includes('max_output') || r === 'max_tokens';
}
