import { describe, expect, test } from 'bun:test';
import { clearTranslations, DELETE_TRANSLATION_LABEL, messageIdFromScope, pickTarget, skipFresh, targetLabel, toolbarState } from '../src/message-ui';
import { type MessageTranslations, type MessageView, sourceHash } from '../src/shared';

function view(over: Partial<MessageView> & { messageId: string }): MessageView {
  return {
    role: 'assistant',
    text: null,
    status: null,
    hasMore: false,
    progress: null,
    error: null,
    hidden: false,
    busy: false,
    requestsNeeded: 1,
    index: 0,
    name: '',
    updatedAt: null,
    ...over,
  };
}

const translated = (id: string, index: number, updatedAt: number, over: Partial<MessageView> = {}) =>
  view({ messageId: id, index, updatedAt, text: 'ok', status: 'done', ...over });

describe('target message', () => {
  const list = [
    view({ messageId: 'm0', index: 0, role: 'user', name: 'Me' }),
    translated('m1', 1, 100),
    view({ messageId: 'm2', index: 2 }),
    translated('m3', 3, 300),
    view({ messageId: 'm4', index: 4 }),
  ];

  test('a picked message wins while it still exists', () => {
    expect(pickTarget(list, 'm2')?.messageId).toBe('m2');
    expect(pickTarget(list, 'm0')?.messageId).toBe('m0');
  });

  test('a picked message that is gone falls back to the default', () => {
    expect(pickTarget(list, 'deleted')?.messageId).toBe('m3');
  });

  test('default: the message translated most recently, not the newest message', () => {
    expect(pickTarget(list, null)?.messageId).toBe('m3');
    expect(pickTarget([translated('a', 1, 500), translated('b', 5, 200)], null)?.messageId).toBe('a');
  });

  test('equal timestamps prefer the later message', () => {
    expect(pickTarget([translated('a', 1, 500), translated('b', 5, 500)], null)?.messageId).toBe('b');
  });

  test('with no translation yet: the latest assistant message', () => {
    const none = [view({ messageId: 'u', index: 3, role: 'user' }), view({ messageId: 'a1', index: 1 }), view({ messageId: 'a2', index: 2 })];
    expect(pickTarget(none, null)?.messageId).toBe('a2');
  });

  test('with no assistant message: the latest user message; system messages are never a target', () => {
    const only = [view({ messageId: 's', index: 9, role: 'system' }), view({ messageId: 'u1', index: 1, role: 'user' }), view({ messageId: 'u2', index: 2, role: 'user' })];
    expect(pickTarget(only, null)?.messageId).toBe('u2');
    expect(pickTarget(only, 's')?.messageId).toBe('u2');
  });

  test('empty chat has no target', () => {
    expect(pickTarget([], null)).toBeNull();
    expect(pickTarget([view({ messageId: 's', role: 'system' })], null)).toBeNull();
  });

  test('label is "#index name"', () => {
    expect(targetLabel({ index: 225, name: '정수빈' })).toBe('#225 정수빈');
    expect(targetLabel({ index: 3, name: '  ' })).toBe('#3');
  });
});

describe('toolbar state', () => {
  test('no translation: plain translate, nothing to delete', () => {
    const s = toolbarState(view({ messageId: 'a' }));
    expect(s).toMatchObject({ action: 'translate', force: false, label: '번역', canDelete: false, busy: false });
  });

  test('a saved translation: the same button re-translates (forced) and the delete button appears', () => {
    const s = toolbarState(translated('a', 1, 1));
    expect(s.action).toBe('translate');
    expect(s.force).toBe(true);
    expect(s.label).toContain('다시 번역');
    expect(s.canDelete).toBe(true);
  });

  test('partial translation: re-translate and delete are both offered', () => {
    const s = toolbarState(translated('a', 1, 1, { status: 'partial', hasMore: true }));
    expect(s).toMatchObject({ force: true, canDelete: true });
  });

  test('error without any text: retry (forced), nothing to delete', () => {
    const s = toolbarState(view({ messageId: 'a', status: 'error', error: 'x' }));
    expect(s).toMatchObject({ force: true, canDelete: false });
  });

  test('while running the button cancels, and delete is hidden', () => {
    const s = toolbarState(translated('a', 1, 1, { busy: true }));
    expect(s).toMatchObject({ action: 'cancel', canDelete: false, busy: true });
  });

  test('before the views arrive', () => {
    expect(toolbarState(null)).toMatchObject({ action: 'translate', canDelete: false });
  });

  test('the delete button cannot be mistaken for the host\'s delete-message button', () => {
    expect(DELETE_TRANSLATION_LABEL).toContain('번역');
    expect(DELETE_TRANSLATION_LABEL).toContain('메시지는 그대로');
  });
});

describe('scope', () => {
  test('message id is read from the host decorator scope', () => {
    expect(messageIdFromScope('message:fe0300af-3402:actions')).toBe('fe0300af-3402');
    expect(messageIdFromScope('message:abc:minimal:footer')).toBeNull();
    expect(messageIdFromScope('chat:x:actions')).toBeNull();
  });
});

describe('translate / re-translate decision', () => {
  test('a finished translation is only redone when forced', () => {
    expect(skipFresh('fresh', { status: 'done' }, false)).toBe(true);
    expect(skipFresh('fresh', { status: 'done' }, true)).toBe(false);
  });

  test('missing, partial and failed translations always run', () => {
    expect(skipFresh('fresh', undefined, false)).toBe(false);
    expect(skipFresh('fresh', { status: 'partial' }, false)).toBe(false);
    expect(skipFresh('fresh', { status: 'error' }, false)).toBe(false);
  });

  test('"continue" is never skipped', () => {
    expect(skipFresh('continue', { status: 'done' }, false)).toBe(false);
  });
});

describe('delete translation', () => {
  const record = (text: string) => ({ parts: [text], pieces: [], total: 1, truncatedPart: -1, status: 'done' as const, updatedAt: 1 });

  test('removes every stored translation of the message and un-hides it; the message itself is not touched', () => {
    const mt: MessageTranslations = { v: 1, entries: { [sourceHash('a')]: record('A'), [sourceHash('b')]: record('B') }, hidden: true };
    clearTranslations(mt);
    expect(mt).toEqual({ v: 1, entries: {}, hidden: false });
  });

  test('stored format stays the 0.1.1 shape', () => {
    const mt: MessageTranslations = { v: 1, entries: { [sourceHash('a')]: record('A') } };
    clearTranslations(mt);
    expect(Object.keys(mt).sort()).toEqual(['entries', 'hidden', 'v']);
  });
});
