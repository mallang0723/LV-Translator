import { expect, test } from 'bun:test';
import { withHost } from './helpers/fake-host';
import { normalizeStore } from '../src/shared';

const result = (h: any, id: string) => h.sent.findLast((m: any) => m.type === 'emu_result' && m.id === id);

test('lv.save (the original form\'s one save button): a chat\'s settings and the connection are stored, and the call is answered', async () => {
  await withHost({}, async (h) => {
    const base = normalizeStore(null).defaults;
    await h.send({ type: 'emu', id: 's', op: 'lv.save', args: [{ chatId: 'chat', settings: { ...base, modelLanguage: 'Japanese', autoTranslate: true, excludeTags: 'status' }, asDefault: false, connectionId: 'conn1' }] });
    expect(result(h, 's')).toMatchObject({ ok: true, data: true });
    const store = h.store();
    expect(store.chats.chat).toMatchObject({ modelLanguage: 'Japanese', autoTranslate: true, excludeTags: 'status', connectionId: 'conn1' });
    expect(store.defaults.connectionId).toBe('conn1');
    expect(store.defaults.modelLanguage).not.toBe('Japanese');
    expect(h.sent.some((m: any) => m.type === 'state')).toBe(true);
  });
});

test('lv.save with the default switch also stores the new-chat defaults; with no chat open it edits the defaults', async () => {
  await withHost({}, async (h) => {
    const base = normalizeStore(null).defaults;
    await h.send({ type: 'emu', id: 'a', op: 'lv.save', args: [{ chatId: 'chat', settings: { ...base, myLanguage: '영어' }, asDefault: true, connectionId: '' }] });
    expect(h.store().defaults.myLanguage).toBe('영어');
    await h.send({ type: 'emu', id: 'b', op: 'lv.save', args: [{ chatId: null, settings: { ...base, myLanguage: '일본어' }, asDefault: false, connectionId: '' }] });
    expect(h.store().defaults.myLanguage).toBe('일본어');
    expect(result(h, 'b').ok).toBe(true);
  });
});
