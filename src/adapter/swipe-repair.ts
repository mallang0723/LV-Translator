// Keeps the original's per-swipe translation records (`spindle_metadata.st_translator_tt`, keyed by swipe number) in step with the
// swipes when Lumiverse deletes one. Lumiverse renumbers the swipes and its own swipe-scoped data but not another extension's
// metadata, so without this a deleted swipe's translation ends up on the next swipe and keys are left past the end.
//
// Two tools, both pure:
//  - shiftAfterDelete: the delete event says which number went; that record is dropped and the higher keys move down by one.
//    Not repeatable by itself, so the caller remembers (`del` marker, DELETE_MARKS) which deletes it has already applied.
//  - reconcileTt: looks at the content. A record whose paragraph keys are none of its own swipe's but are all in exactly one other
//    swipe's paragraphs goes to that swipe. Repeatable by nature (a settled record is left alone), so it also repairs deletes that
//    happened before this fix or whose event was missed, and it never moves a record it is not sure of.
import { blockKey, hashText } from './keys';
import { buildPubFromTt, contentUnits } from './pub';
import { METADATA_KEY } from '../shared';

type Tt = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const slotOf = (key: string): number | null => (/^(0|[1-9]\d*)$/.test(key) ? Number(key) : null);

/** Drops the deleted swipe's record and moves the higher ones down by one. Null when no record is at or past that number. */
export function shiftAfterDelete(tt: Tt, deleted: number): Tt | null {
  if (!Number.isInteger(deleted) || deleted < 0) return null;
  let moved = false;
  const out: Tt = {};
  for (const [key, value] of Object.entries(tt)) {
    const slot = slotOf(key);
    if (slot === null || slot < deleted) out[key] = value;
    else moved = true;
  }
  for (const [key, value] of Object.entries(tt)) {
    const slot = slotOf(key);
    if (slot !== null && slot > deleted) out[String(slot - 1)] = value;
  }
  return moved ? out : null;
}

const mapKeys = (record: unknown): string[] => (isObject(record) && isObject(record.map) ? Object.keys(record.map) : []);

/**
 * Puts records on the swipe they were made for, judged by content. Only a record with no paragraph key in its own swipe
 * moves, and only to the one swipe that holds all its keys, when that swipe's own record has none of its keys either.
 * Null when nothing moves. `swipes` must be all the message's swipes as text.
 */
export function reconcileTt(tt: Tt, swipes: readonly string[], kept: ReadonlySet<string> = new Set()): Tt | null {
  const units = swipes.map((text) => new Set(contentUnits(String(text ?? ''), kept).map(blockKey)));
  const overlap = (record: unknown, slot: number) => (slot < units.length ? mapKeys(record).filter((k) => units[slot]!.has(k)).length : 0);
  const stale = (slot: number) => {
    const keys = mapKeys(tt[String(slot)]).length;
    return keys > 0 && overlap(tt[String(slot)], slot) === 0;
  };
  const intents = new Map<number, number>(); // from slot -> to swipe
  for (const key of Object.keys(tt)) {
    const from = slotOf(key);
    if (from === null || !stale(from)) continue;
    const keys = mapKeys(tt[key]);
    const to = units.map((_, j) => j).filter((j) => j !== from && overlap(tt[key], j) === keys.length);
    if (to.length !== 1) continue;
    const occupant = tt[String(to[0])];
    if (occupant !== undefined && !stale(to[0]!)) continue; // the swipe already has a record that fits it
    intents.set(from, to[0]!);
  }
  const claims = [...intents.values()];
  for (const [from, to] of [...intents]) if (claims.filter((c) => c === to).length > 1) intents.delete(from);
  if (!intents.size) return null;
  const targets = new Set(intents.values());
  const out: Tt = {};
  for (const [key, value] of Object.entries(tt)) {
    const slot = slotOf(key);
    if (slot === null) out[key] = value;
    else if (!intents.has(slot) && !targets.has(slot)) out[key] = value;
    // a moved record leaves its place; a record in a place a verified record takes is the stale one it replaces
  }
  for (const [from, to] of intents) out[String(to)] = tt[String(from)];
  return out;
}

/** Marker of a delete already applied: the deleted number and the swipes that were left (their count and text hash). */
export function deleteMark(deleted: number, swipes: readonly string[]): string {
  return `${deleted}:${swipes.length}:${hashText(swipes.map((s) => String(s ?? '')).join('\u0000'))}`;
}
const DELETE_MARKS = 6;

export interface PubWish {
  publish: boolean;
  language: string;
  kept: ReadonlySet<string>;
}

/**
 * The metadata keys to write for a corrected `tt`: the record itself, and our own key when the memory extension's `pub`
 * (the visible swipe's record) changed or a delete mark is to be kept. One write, nothing of another extension's touched.
 */
export function repairedKeys(
  ttKey: string,
  next: Tt,
  meta: Record<string, unknown> | undefined,
  view: { content: string; swipeId: number },
  proj: PubWish | undefined,
  mark?: string,
  now = Date.now(),
): Record<string, unknown> {
  const out: Record<string, unknown> = { [ttKey]: next };
  const st = isObject(meta?.[METADATA_KEY]) ? (meta![METADATA_KEY] as Record<string, unknown>) : {};
  const merged = { v: 1, entries: {}, ...st } as Record<string, unknown>;
  let dirty = false;
  if (proj) {
    const want = proj.publish ? buildPubFromTt(view.content, next[String(view.swipeId)], proj.language, proj.kept, now) : null;
    const have = isObject(st.pub) ? (st.pub as { h?: string }) : null;
    if (want && have?.h !== want.h) {
      merged.pub = want;
      dirty = true;
    } else if (!want && have) {
      delete merged.pub;
      dirty = true;
    }
  }
  if (mark) {
    const marks = Array.isArray(st.del) ? (st.del as unknown[]).filter((m): m is string => typeof m === 'string') : [];
    merged.del = [...marks.filter((m) => m !== mark), mark].slice(-DELETE_MARKS);
    dirty = true;
  }
  if (dirty) out[METADATA_KEY] = merged;
  return out;
}

export const deleteSeen = (meta: Record<string, unknown> | undefined, mark: string): boolean => {
  const st = meta?.[METADATA_KEY];
  return isObject(st) && Array.isArray(st.del) && (st.del as unknown[]).includes(mark);
};
