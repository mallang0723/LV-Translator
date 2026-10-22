// Pure logic behind the per-message toolbar buttons and the panel's target message.
// No DOM and no host access, so it can be tested directly.

import type { MessageTranslations, MessageView, TranslationRecord, TranslationStatus } from './shared';

// ---- target message ----

/**
 * The message the panel's per-message controls act on.
 *   1. the one the user picked (translate button or a click on its translation), while it still exists;
 *   2. otherwise the message translated most recently;
 *   3. otherwise the latest assistant message;
 *   4. otherwise the latest message that is not a system message.
 */
export function pickTarget(views: readonly MessageView[], explicitId: string | null): MessageView | null {
  const usable = views.filter((v) => v.role !== 'system');
  if (explicitId) {
    const picked = usable.find((v) => v.messageId === explicitId);
    if (picked) return picked;
  }
  let recent: MessageView | null = null;
  for (const v of usable) {
    if (v.updatedAt === null) continue;
    if (!recent || v.updatedAt > (recent.updatedAt ?? 0) || (v.updatedAt === (recent.updatedAt ?? 0) && v.index > recent.index)) recent = v;
  }
  if (recent) return recent;
  const latest = (list: MessageView[]) => list.reduce<MessageView | null>((best, v) => (!best || v.index > best.index ? v : best), null);
  return latest(usable.filter((v) => v.role === 'assistant')) ?? latest(usable);
}

/** "#225 name" (just "#225" when the message has no name). */
export function targetLabel(view: Pick<MessageView, 'index' | 'name'>): string {
  const name = view.name.trim();
  return name ? `#${view.index} ${name}` : `#${view.index}`;
}

// ---- toolbar buttons ----

export interface ToolbarState {
  /** What the translate button does when pressed. */
  action: 'translate' | 'cancel';
  /** A translation is replaced: the host asks the backend to translate even if one is saved. */
  force: boolean;
  label: string;
  /** The delete-translation button is only offered while a translation exists and nothing is running. */
  canDelete: boolean;
  busy: boolean;
}

export function toolbarState(view: Pick<MessageView, 'busy' | 'text' | 'status'> | null): ToolbarState {
  if (!view) return { action: 'translate', force: false, label: '번역', canDelete: false, busy: false };
  if (view.busy) return { action: 'cancel', force: false, label: '번역 중단 (번역 중입니다)', canDelete: false, busy: true };
  const exists = view.text !== null || view.status !== null;
  return {
    action: 'translate',
    force: exists,
    label: exists ? '다시 번역 (저장된 번역을 새로 만듭니다)' : '번역',
    canDelete: view.text !== null,
    busy: false,
  };
}

export const DELETE_TRANSLATION_LABEL = '번역 삭제 (이 메시지에 저장된 번역문만 지웁니다. 메시지는 그대로입니다)';

/** Message id from a decorator scope such as `message:<id>:actions`. */
export function messageIdFromScope(scope: string): string | null {
  const m = /^message:(.+):actions$/.exec(scope);
  return m ? m[1]! : null;
}

// ---- backend decisions ----

/** A plain "translate" of a message that already has a finished translation does nothing unless forced. */
export function skipFresh(mode: 'fresh' | 'continue', existing: Pick<TranslationRecord, 'status'> | undefined, force: boolean): boolean {
  const status: TranslationStatus | undefined = existing?.status;
  return mode === 'fresh' && status === 'done' && !force;
}

/** Deletes every stored translation of the message (all swipes) and un-hides it. Edits the given object. */
export function clearTranslations(mt: MessageTranslations): void {
  mt.entries = {};
  mt.hidden = false;
}
