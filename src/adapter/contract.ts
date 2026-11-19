// The translator side of the "LV-TX v1" contract with the memory extension (docs/translation-tools-1.8.0-map.md §4.2).
//
//   handshake  rpcPool endpoint `st_translator.contract` (value below); the peer's is `anon_memory_lv.contract`
//   message    metadata.st_translator.pub = { v:1, h, lang, text, paras?, edited?, at }       (this module: buildPub)
//   chat       chat.metadata.st_translator = { v:1, glossary:{ text, hash, at } }              (this module: planGlossary)
//
// `h` is FNV-1a 32 of message.content exactly as stored (upstream hashText), not LV's sourceHash.

import type { ChatSettings, MessageTranslations, TranslationRecord } from '../shared';
import { pairParagraphs } from '../display/paragraph-view';
import { recordToText } from '../translate/engine';
import { parseGlossary } from '../translate/glossary';
import { blockKey, hashText } from '../vendor/tt-1.8.0/helpers';

/** Manifest identifier of the memory extension; the only place it is written. */
export const PEER_ID = 'anon_memory_lv';
export const SELF_ID = 'st_translator';
export const CONTRACT_NAME = 'lv-tx';
export const CONTRACT_VERSION = 1;
/** Most paragraphs published per message; the earliest ones are dropped first. */
export const PUB_PARAS_MAX = 400;

export const PROVIDES = ['pub-translation@1', 'glossary@1'] as const;

export function handshake(version: string, provides: readonly string[] = PROVIDES) {
  return { name: CONTRACT_NAME, v: CONTRACT_VERSION, ext: SELF_ID, version, provides: [...provides] };
}

export type PeerState = 'none' | 'ok' | 'incompatible';

/** What the peer's contract value means for us: a missing value is "not installed". */
export function classifyPeer(value: unknown): PeerState {
  if (!value || typeof value !== 'object') return 'none';
  const v = value as { name?: unknown; v?: unknown };
  if (v.name !== CONTRACT_NAME || typeof v.v !== 'number') return 'incompatible';
  return v.v === CONTRACT_VERSION ? 'ok' : 'incompatible';
}

export interface Pub {
  v: 1;
  h: string;
  lang: string;
  text: string;
  paras?: Record<string, string>;
  edited?: Record<string, 1>;
  at: number;
}

/** "Korean" / "한국어" -> "ko"; anything else keeps its own name, lowercased. */
export function langCode(language: string): string {
  const l = String(language ?? '').trim();
  if (/^(ko|kor|korean)$/i.test(l) || /한국|조선/.test(l)) return 'ko';
  if (/^(en|eng|english)$/i.test(l) || /영어/.test(l)) return 'en';
  if (/^(ja|jpn|japanese)$/i.test(l) || /일본|日本/.test(l)) return 'ja';
  if (/^(zh|chinese)$/i.test(l) || /중국|中文/.test(l)) return 'zh';
  return l.toLowerCase();
}

/**
 * The public projection of the translation of `content` (the visible swipe), or null when there is nothing
 * trustworthy to publish: no record for this content, or one that is not finished.
 */
export function buildPub(content: string, record: TranslationRecord | undefined, settings: ChatSettings, now: number): Pub | null {
  if (!record || record.status !== 'done' || !record.parts.some((p) => p.trim())) return null;
  const text = recordToText(record, content);
  if (!text.trim()) return null;
  const pub: Pub = { v: 1, h: hashText(content), lang: langCode(settings.myLanguage), text, at: now };
  if (record.unit === 'paragraph') {
    try {
      const pairing = pairParagraphs(content, record, settings);
      if (pairing.kind !== 'whole') {
        const edited = new Set(record.edited ?? []);
        const entries: Array<[string, string, boolean]> = [];
        pairing.pairs.forEach((pair, i) => {
          if (pair.translation === null || !pair.translation.trim()) return;
          entries.push([blockKey(pair.source), pair.translation, edited.has(i)]);
        });
        const kept = entries.slice(-PUB_PARAS_MAX);
        if (kept.length) {
          pub.paras = Object.fromEntries(kept.map(([key, translation]) => [key, translation]));
          const marks = kept.filter(([, , wasEdited]) => wasEdited).map(([key]) => [key, 1] as const);
          if (marks.length) pub.edited = Object.fromEntries(marks) as Record<string, 1>;
        }
      }
    } catch {
      // exclude rules that no longer parse: publish the whole text only
    }
  }
  return pub;
}

/**
 * Sets `pub` for the content it has now, or removes it. Whenever nothing is published (no peer, no finished
 * translation of this content) any earlier `pub` goes too: it could carry old text under a still valid hash.
 * Returns whether `pub` is set.
 */
export function projectPub(mt: MessageTranslations, content: string, key: string | null, settings: ChatSettings, publish: boolean, now: number): boolean {
  const record = key ? mt.entries[key] : undefined;
  const pub = publish ? buildPub(content, record, settings, now) : null;
  if (pub) {
    mt.pub = pub;
    return true;
  }
  delete mt.pub;
  return false;
}

export interface GlossaryEntry {
  text: string;
  hash: string;
  at: number;
}

/** The glossary as one `left = right` pair per line, the form the memory extension parses. */
export function glossaryText(raw: string): string {
  return parseGlossary(raw).map((p) => `${p.left} = ${p.right}`).join('\n');
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The compareAndSetMetadata input that publishes `text` in chat metadata, keeping every other key, or null when
 * the published glossary is already this one (or there is nothing to publish yet).
 */
export function planGlossary(meta: Record<string, unknown>, text: string, now: number): { expected_metadata: Record<string, unknown>; metadata: Record<string, unknown> } | null {
  const own = isObject(meta[SELF_ID]) ? (meta[SELF_ID] as Record<string, unknown>) : {};
  const published = isObject(own.glossary) ? (own.glossary as Partial<GlossaryEntry>) : null;
  const hash = hashText(text);
  if (!published && !text) return null;
  if (published?.hash === hash) return null;
  const entry: GlossaryEntry = { text, hash, at: now };
  return { expected_metadata: meta, metadata: { ...meta, [SELF_ID]: { ...own, v: 1, glossary: entry } } };
}
