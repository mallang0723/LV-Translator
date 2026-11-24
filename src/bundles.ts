import type { ChatSettings, Store, UserBundle } from './shared';
import { parseGlossary } from './translate/glossary';

export type GuideLibrary = Pick<Store, 'userBundles'>;
export type Guides = Pick<ChatSettings, 'glossary' | 'freeContext' | 'incomingVoicePrompt'>;

/** Resolve links at request time without changing the saved room additions or enable toggles. */
export function effectiveGuides(store: GuideLibrary, settings: ChatSettings): Guides {
  const bundle = store.userBundles.find((b) => b.id === settings.bundleId);
  if (!bundle) return { glossary: settings.glossary, freeContext: settings.freeContext, incomingVoicePrompt: settings.incomingVoicePrompt };
  const roomTerms = new Set(parseGlossary(settings.glossary).map((p) => p.left));
  const glossary = [
    ...parseGlossary(bundle.glossary).filter((p) => !roomTerms.has(p.left)),
    ...parseGlossary(settings.glossary),
  ].map((p) => `${p.left} = ${p.right}`).join('\n');
  const join = (base: string, room: string) => [base.trim(), room.trim()].filter(Boolean).join('\n\n');
  return {
    glossary,
    freeContext: join(bundle.freeContext, settings.freeContext),
    incomingVoicePrompt: join(bundle.incomingVoicePrompt, settings.incomingVoicePrompt),
  };
}

/** randomUUID is secure-context-only; getRandomValues also works on plain HTTP. */
export function newBundleId(cryptoApi: Partial<Pick<Crypto, 'randomUUID' | 'getRandomValues'>> | undefined = globalThis.crypto): string {
  if (typeof cryptoApi?.randomUUID === 'function') return `bundle-${cryptoApi.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `bundle-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Update the shared library, keeping references linked to the same id. */
export function saveBundle(store: Store, value: UserBundle): UserBundle {
  if (!value || typeof value.name !== 'string' || !value.name.trim()) throw new Error('묶음 이름을 입력해 주세요.');
  const existing = store.userBundles.findIndex((b) => b.id === value.id);
  let id = existing >= 0 ? store.userBundles[existing]!.id : newBundleId();
  while (existing < 0 && store.userBundles.some((b) => b.id === id)) id = newBundleId();
  const bundle: UserBundle = {
    id, name: value.name.trim(),
    glossary: typeof value.glossary === 'string' ? value.glossary : '',
    freeContext: typeof value.freeContext === 'string' ? value.freeContext : '',
    incomingVoicePrompt: typeof value.incomingVoicePrompt === 'string' ? value.incomingVoicePrompt : '',
  };
  if (existing >= 0) store.userBundles[existing] = bundle;
  else store.userBundles.push(bundle);
  return bundle;
}

/** The room-scope fields of the original's own settings (`tt-config.json` → `config.chats[id]`) that the 대사 지침 lives in. */
export interface TtVoiceScope {
  incomingVoicePrompt?: string;
  incomingVoiceEnabled?: boolean;
  [key: string]: unknown;
}
export interface TtVoiceConfig {
  config?: { chats?: Record<string, TtVoiceScope>; [key: string]: unknown };
  [key: string]: unknown;
}
/** A change made to one room's value in the original's scope. While an open original form may still hold `from`, a later save of it is corrected to `prompt`. */
export interface VoiceRebase {
  chatId: string;
  from: string;
  prompt: string;
  enabled: boolean;
}

/**
 * The bundle's 대사 지침 was edited (`oldPrompt` -> `bundle.incomingVoicePrompt`). The room's real 「대사 지침」 is the original's own
 * (`config.chats[id]` in `tt-config.json`, which response translation reads); our `store.chats[id]` only keeps the bookkeeping (`voiceFrom`, `voiceBackup*`).
 * Every room with the bundle applied (`voiceFrom`) is changed in `tt` (mutated in place) as follows:
 * - the room's value still is the old bundle text (a hand edit is kept): it becomes the new text and the switch is turned on; the saved original value stays;
 * - nothing was saved yet (the bundle had no 대사 지침 when applied or it was emptied before): the room's current value is saved first, then the new text goes in;
 * - the new prompt is empty: the saved original value is put back into the original's scope, and only then is the saved copy dropped.
 *   If the room's value was hand edited, nothing is touched and the saved copy stays, so 「없음」 still restores it.
 * Returns what changed, so a stale form of the original can be corrected when it saves (`applyRebases`).
 */
export function reapplyBundleVoice(store: Store, tt: TtVoiceConfig, bundle: UserBundle, oldPrompt: string): VoiceRebase[] {
  const out: VoiceRebase[] = [];
  const chats = tt.config?.chats;
  if (!chats) return out;
  const next = bundle.incomingVoicePrompt;
  for (const [chatId, room] of Object.entries(store.chats)) {
    if (room.voiceFrom !== bundle.id) continue;
    const scope = chats[chatId];
    if (!scope) continue;
    const value = typeof scope.incomingVoicePrompt === 'string' ? scope.incomingVoicePrompt : '';
    const enabled = scope.incomingVoiceEnabled === true;
    if (next.trim()) {
      if (!room.voiceBackupSaved) {
        room.voiceBackupSaved = true;
        room.voiceBackupPrompt = value;
        room.voiceBackupEnabled = enabled;
      } else if (value !== oldPrompt) continue;
      scope.incomingVoicePrompt = next;
      scope.incomingVoiceEnabled = true;
      out.push({ chatId, from: value, prompt: next, enabled: true });
    } else if (room.voiceBackupSaved && value === oldPrompt) {
      scope.incomingVoicePrompt = room.voiceBackupPrompt;
      scope.incomingVoiceEnabled = room.voiceBackupEnabled;
      out.push({ chatId, from: value, prompt: room.voiceBackupPrompt, enabled: room.voiceBackupEnabled });
      room.voiceBackupSaved = false;
      room.voiceBackupPrompt = '';
      room.voiceBackupEnabled = false;
    }
  }
  return out;
}

/** A save from an original form that still held the pre-edit text: where the room's value still is `from`, it becomes the edited one. */
export function applyRebases(config: TtVoiceConfig['config'] | undefined, rebases: readonly VoiceRebase[]): VoiceRebase[] {
  const left: VoiceRebase[] = [];
  for (const r of rebases) {
    const scope = config?.chats?.[r.chatId];
    if (!scope) {
      left.push(r);
      continue;
    }
    if (scope.incomingVoicePrompt === r.from) {
      scope.incomingVoicePrompt = r.prompt;
      scope.incomingVoiceEnabled = r.enabled;
    }
  }
  return left;
}

export function deleteBundle(store: Store, id: string): void {
  store.userBundles = store.userBundles.filter((b) => b.id !== id);
  for (const settings of [store.defaults, ...Object.values(store.chats)]) {
    if (settings.bundleId === id) settings.bundleId = '';
  }
}

/** What a bundle adds to the system prompt of "내 메시지 번역": its glossary and additional guidance (each only when it has content). The 대사 지침 is not here: the original uses it for response translation only, so it goes to the room's own 「대사 지침」 (`planRoomVoice`). */
export function outgoingBundleBlocks(bundle: Pick<UserBundle, 'glossary' | 'freeContext'>): string[] {
  const pairs = parseGlossary(bundle.glossary);
  return [
    pairs.length ? `## Glossary (apply in both directions)\n${pairs.map((p) => `${p.left} = ${p.right}`).join('\n')}` : '',
    bundle.freeContext.trim() ? `## Additional guidance\n${bundle.freeContext.trim()}` : '',
  ].filter(Boolean);
}

/** The room's 「대사 지침」 bookkeeping: which bundle wrote it, and what was there before. */
export interface RoomVoice {
  from: string;
  backupSaved: boolean;
  backupPrompt: string;
  backupEnabled: boolean;
}

export interface RoomVoicePlan {
  /** The room's 대사 지침 text and switch after the save. */
  prompt: string;
  enabled: boolean;
  voice: RoomVoice;
  /** What happened, for the message to the user. */
  restored: boolean;
  applied: boolean;
  /** The room had its own non-empty 대사 지침 that the bundle's now stands in for. */
  replaced: boolean;
}

/**
 * 관리자 결정 2026-11-25: a bundle's 대사 지침 is written into the room's own 「대사 지침」 (what the original's response translation reads) while the
 * bundle is applied. When the room's bundle changes (another bundle, 없음, a deleted bundle): the previous value is put back first (only if the bundle had
 * overwritten it), then the new bundle's voice prompt (when it has one) replaces the room's text and the switch is turned on, and the text it replaced is
 * kept for the next change. A bundle with no 대사 지침 leaves the room's own alone. While the bundle stays the same nothing is touched (the room's text
 * may be edited by hand).
 */
export function planRoomVoice(
  bundleId: string,
  bundles: ReadonlyArray<Pick<UserBundle, 'id' | 'incomingVoicePrompt'>>,
  room: { prompt: string; enabled: boolean },
  voice: RoomVoice,
): RoomVoicePlan {
  const known = bundles.find((b) => b.id === bundleId);
  const target = known ? bundleId : '';
  if (target === voice.from) return { ...room, voice, restored: false, applied: false, replaced: false };
  let { prompt, enabled } = room;
  let restored = false;
  if (voice.from && voice.backupSaved) {
    prompt = voice.backupPrompt;
    enabled = voice.backupEnabled;
    restored = true;
  }
  let next: RoomVoice = { from: target, backupSaved: false, backupPrompt: '', backupEnabled: false };
  let applied = false;
  let replaced = false;
  if (known && known.incomingVoicePrompt.trim()) {
    next = { from: target, backupSaved: true, backupPrompt: prompt, backupEnabled: enabled };
    replaced = prompt.trim() !== '';
    prompt = known.incomingVoicePrompt;
    enabled = true;
    applied = true;
  }
  return { prompt, enabled, voice: next, restored, applied, replaced };
}
