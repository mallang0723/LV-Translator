// Looks up the 0.4.0 translation record of the swipe that is showing (read once by the original-record conversion, N8).
// No DOM and no host access, so it can be tested directly.

import { replaceIllustrations } from './illustrations';
import { restore } from './translate/protect';
import { type MessageTranslations, rawSourceHash, sourceHash, type TranslationRecord } from './shared';

/**
 * The translation of the swipe that is showing. Translations are keyed by sourceHash(content), and
 * the message's `content` is always the active swipe's text, so switching swipes switches the key.
 */
export function recordFor(mt: Pick<MessageTranslations, 'entries'> | null | undefined, content: string): TranslationRecord | null {
  const key = recordKeyFor(mt, content);
  return key ? mt?.entries?.[key] ?? null : null;
}

/** Return the actual stored key so legacy entries can also be deleted from the UI. */
export function recordKeyFor(mt: Pick<MessageTranslations, 'entries'> | null | undefined, content: string): string | null {
  for (const key of [sourceHash(content), rawSourceHash(content)]) {
    if (mt?.entries?.[key]) return key;
  }
  // Old records have no original source field. Recover only when their retained
  // markup lets us reconstruct a source whose raw hash EXACTLY matches the key.
  // This avoids selecting an unrelated swipe/edited passage by recency or count.
  const current: string[] = [];
  replaceIllustrations(content, (piece) => { current.push(piece); return piece; });
  if (current.length) {
    const entries = Object.entries(mt?.entries ?? {}).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    for (const [key, record] of entries) {
      const original: string[] = [];
      replaceIllustrations(restore(record.parts.join('\n\n'), record.pieces), (piece) => {
        original.push(piece);
        return piece;
      });
      if (original.length !== current.length) continue;
      const candidate = replaceIllustrations(content, (_piece, index) => original[index]!);
      if (rawSourceHash(candidate) === key) return key;
    }
  }
  return null;
}
