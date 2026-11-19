// 번역 고치기: the paragraph pairs a user can correct by hand, and the record that results.
// Keys follow Translation Tools 1.8.0 (blockKey = FNV-1a base36 of the normalized paragraph), which is what
// its syncSourceToEdits works with, and the shape the memory contract publishes (pub.paras).

import type { ChatSettings, TranslationRecord } from '../shared';
import { pairParagraphs } from '../display/paragraph-view';
import { blockKey } from '../vendor/tt-1.8.0/helpers';
import { hasNoText, splitParagraphs } from './paragraphs';

export interface EditPair {
  index: number;
  source: string;
  translation: string;
  edited: boolean;
  key: string;
}

/**
 * The pairs of a finished translation, or null when the record cannot be corrected paragraph by paragraph
 * (not finished, an untranslated paragraph, or whole-message output that does not line up with the source).
 */
export function editablePairs(content: string, record: TranslationRecord, settings: ChatSettings): EditPair[] | null {
  if (record.status !== 'done') return null;
  const pairing = pairParagraphs(content, record, settings);
  if (pairing.kind === 'whole') return null;
  const edited = new Set(record.edited ?? []);
  const pairs: EditPair[] = [];
  for (const [index, pair] of pairing.pairs.entries()) {
    if (pair.translation === null || !pair.translation.trim()) return null;
    pairs.push({ index, source: pair.source, translation: pair.translation, edited: edited.has(index), key: blockKey(pair.source) });
  }
  return pairs.length ? pairs : null;
}

/** A correction has no blank lines inside, so the paragraphs of the translation still line up with the source. */
export function cleanEdit(text: string): string {
  return String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]*\n+/g, '\n').trim();
}

/**
 * The record of `content` built from a key → translation map (upstream paraTranslate.map). Paragraphs are the
 * visible text, so there are no protected pieces. `editedKeys` marks the hand-corrected paragraphs.
 */
export function recordFromMap(content: string, map: Record<string, string>, editedKeys: Iterable<string>): TranslationRecord {
  const sources = splitParagraphs(content);
  const edited = new Set(editedKeys);
  const parts: string[] = [];
  const marked: number[] = [];
  let missing = 0;
  sources.forEach((source, i) => {
    const key = blockKey(source);
    const text = map[key];
    if (text !== undefined && text.trim()) parts.push(text);
    else if (hasNoText(source)) parts.push(source);
    else {
      parts.push('');
      missing++;
    }
    if (edited.has(key)) marked.push(i);
  });
  return {
    parts,
    pieces: [],
    unit: 'paragraph',
    total: sources.length,
    ...(marked.length ? { edited: marked } : {}),
    truncatedPart: -1,
    status: missing ? 'partial' : 'done',
    updatedAt: Date.now(),
  };
}
