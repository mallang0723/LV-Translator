// Projections from the original Translation Tools 1.10.0 records (kept per swipe under `st_translator_tt`, in the
// original's own shape `{ v:1, map:{ blockKey: translation }, edited:{ blockKey: 1 }, view, at }`) to the two things
// the rest of the world reads:
//   - the LV-TX v1 `pub` of the memory extension (`metadata.st_translator.pub`, src/adapter/contract.ts), and
//   - the same record made from a 0.4.0 record (`metadata.st_translator.entries`), once, for old chats (N8).
// The original keys a paragraph by `blockKey(text)`; `hashText`, `normalizeForKey`, `blockKey` below are the original's
// own three functions (tests/pub.test.ts compares them with the vendored file). Paragraphs are found the way the
// original finds them for a message that is not on screen (`fallbackRoot`): tags are dropped (except the kept ones),
// then the text is cut at blank lines.

import type { ChatSettings, TranslationRecord } from '../shared';
import { pairParagraphs } from '../display/paragraph-view';
import type { Pub } from './contract';
import { langCode, PUB_PARAS_MAX } from './contract';
import { blockKey, hashText, normalizeForKey } from './keys';

export { blockKey, hashText, normalizeForKey };

/** The original's record of one swipe. */
export interface TtRecord {
  v: 1;
  map: Record<string, string>;
  edited: Record<string, number>;
  view: string;
  at: number;
}

const isRecord = (v: unknown): v is TtRecord => !!v && typeof v === 'object' && typeof (v as TtRecord).map === 'object' && (v as TtRecord).map !== null;

/** Tag names the original keeps (its 문단 번역 "번역에서 제외할 태그"), as `keptTagNames` reads them. */
export function keptTagNames(raw: unknown): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(/[\s,;]+/)
      .map((part) => {
        const m = /^(?:<([a-z][\w:-]*)>|([a-z][\w:-]*))$/i.exec(part);
        return m ? (m[1] || m[2] || '').toLowerCase() : '';
      })
      .filter(Boolean),
  );
}

/** The paragraphs of a message as the original's `fallbackRoot` + `collectUnits` see them (units with letters only). */
export function contentUnits(content: string, kept: ReadonlySet<string> = new Set()): string[] {
  const source = String(content ?? '').replace(/\r\n?/g, '\n').replace(/<[^>]*>/g, (tag) => {
    const name = /^<\/?\s*([a-z][\w:-]*)/i.exec(tag)?.[1]?.toLowerCase();
    return name && kept.has(name) ? tag : '';
  });
  return source
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter((block) => block && /\p{L}/u.test(block));
}

/**
 * The memory extension's public projection of one swipe, or null when nothing in the record belongs to this content.
 * `text` follows the content's order (untranslated paragraphs stay as they are); `paras` keeps the last PUB_PARAS_MAX.
 */
export function buildPubFromTt(content: string, record: unknown, language: string, kept: ReadonlySet<string>, now: number): Pub | null {
  if (!isRecord(record)) return null;
  const units = contentUnits(content, kept);
  const rows: Array<{ key: string; source: string; translation: string | null }> = [];
  const seen = new Set<string>();
  for (const source of units) {
    const key = blockKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    const t = record.map[key];
    rows.push({ key, source, translation: typeof t === 'string' && t.trim() ? t : null });
  }
  const translated = rows.filter((r) => r.translation !== null);
  if (!translated.length) return null;
  const pub: Pub = {
    v: 1,
    h: hashText(content),
    lang: langCode(language),
    text: rows.map((r) => r.translation ?? r.source).join('\n\n'),
    at: now,
  };
  const kept400 = translated.slice(-PUB_PARAS_MAX);
  pub.paras = Object.fromEntries(kept400.map((r) => [r.key, r.translation!]));
  const marks = kept400.filter((r) => record.edited?.[r.key]).map((r) => [r.key, 1] as const);
  if (marks.length) pub.edited = Object.fromEntries(marks) as Record<string, 1>;
  return pub;
}

/**
 * A 0.4.0 record made into the original's, only where the pairing was exact (paragraph by paragraph, finished).
 * Anything else (a whole-message translation, a partial one, a count that no longer matches) is skipped: null.
 */
export function convertLegacyRecord(content: string, legacy: TranslationRecord | undefined, settings: ChatSettings, kept: ReadonlySet<string>, now: number): TtRecord | null {
  if (!legacy || legacy.status !== 'done' || legacy.unit !== 'paragraph') return null;
  let pairing;
  try {
    pairing = pairParagraphs(content, legacy, settings);
  } catch {
    return null;
  }
  if (pairing.kind !== 'paragraph') return null;
  const edited = new Set(legacy.edited ?? []);
  const map: Record<string, string> = {};
  const marks: Record<string, number> = {};
  const units = new Set(contentUnits(content, kept).map(blockKey));
  pairing.pairs.forEach((pair, i) => {
    if (pair.translation === null || !pair.translation.trim()) return;
    const key = blockKey(pair.source);
    if (!units.has(key)) return; // the original would not treat this paragraph as a unit: leave it to the original
    map[key] = pair.translation.trim();
    if (edited.has(i)) marks[key] = 1;
  });
  if (!Object.keys(map).length) return null;
  return { v: 1, map, edited: marks, view: '', at: legacy.updatedAt || now };
}
