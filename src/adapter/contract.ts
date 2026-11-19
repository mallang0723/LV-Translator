// The translator side of the "LV-TX v1" contract with the memory extension (docs/translation-tools-1.8.0-map.md §4.2).
//
//   handshake  rpcPool endpoint `st_translator.contract` (value below); the peer's is `anon_memory_lv.contract`
//   message    metadata.st_translator.pub = { v:1, h, lang, text, paras?, edited?, at }       (src/adapter/pub.ts: buildPubFromTt)
//   chat       chat.metadata.st_translator = { v:1, glossary:{ text, hash, at } }              (this module: planGlossary)
//
// `h` is FNV-1a 32 of message.content exactly as stored (the original's hashText), not LV's sourceHash.
// Since 0.5.1 both are made from the original Translation Tools 1.10.0 records (the chat glossary is the original's own).

import { parseGlossary } from '../translate/glossary';
import { hashText } from './keys';

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
