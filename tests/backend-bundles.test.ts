import { expect, test } from 'bun:test';
import { normalizeStore, type Store, type ToBackend, type ToFrontend } from '../src/shared';

test('backend bundle messages persist the library, broadcast it, and reset every deleted reference', async () => {
  const previousSpindle = Reflect.get(globalThis, 'spindle');
  const disk = new Map<string, Store>();
  let receive!: (payload: ToBackend, userId: string) => void;
  let respond!: (value: ToFrontend) => void;
  let fail!: (error: Error) => void;
  let responseUser = '';
  const host = {
    registerMessageContentProcessor() {},
    on() {},
    onFrontendMessage(fn: typeof receive) { receive = fn; },
    connections: { async list() { return []; } },
    userStorage: {
      async getJson(_path: string, { userId }: { userId: string }) { return disk.get(userId) ?? null; },
      async setJson(_path: string, value: Store, { userId }: { userId: string }) { disk.set(userId, structuredClone(value)); },
    },
    sendToFrontend(payload: ToFrontend, userId: string) {
      responseUser = userId;
      respond(structuredClone(payload));
    },
    log: { error(message: string) { fail(new Error(message)); } },
    toast: { error(message: string) { fail(new Error(message)); } },
  };
  const send = async (msg: ToBackend, uid = 'bundle-owner'): Promise<Store> => {
    const response = await new Promise<ToFrontend>((resolve, reject) => {
      respond = resolve;
      fail = reject;
      receive(msg, uid);
    });
    expect(responseUser).toBe(uid);
    if (response.type !== 'state') throw new Error('Expected updated state');
    expect(response.store).toEqual(disk.get(uid) ?? normalizeStore(null));
    return response.store;
  };
  try {
    Reflect.set(globalThis, 'spindle', host);
    await import('../src/backend');
    const created = await send({ type: 'save_bundle', bundle: { id: '', name: ' Shared ', glossary: 'a = b', freeContext: 'setting', incomingVoicePrompt: 'voice' } });
    expect(created.userBundles).toHaveLength(1);
    const bundle = created.userBundles[0]!;
    expect(bundle.id).toStartWith('bundle-');
    expect(bundle.name).toBe('Shared');
    const settings = { ...created.defaults, bundleId: bundle.id, freeContext: 'room addition' };
    await send({ type: 'save_settings', chatId: 'first', settings, asDefault: true });
    await send({ type: 'save_settings', chatId: 'second', settings, asDefault: false });
    const updated = await send({ type: 'save_bundle', bundle: { ...bundle, freeContext: 'updated' } });
    expect(updated.userBundles).toEqual([{ ...bundle, freeContext: 'updated' }]);
    expect(updated.defaults.bundleId).toBe(bundle.id);
    expect(updated.chats.first?.bundleId).toBe(bundle.id);
    expect(updated.chats.second?.bundleId).toBe(bundle.id);
    expect((await send({ type: 'hello' }, 'another-owner')).userBundles).toEqual([]);
    const deleted = await send({ type: 'delete_bundle', id: bundle.id });
    expect(deleted.userBundles).toEqual([]);
    for (const s of [deleted.defaults, ...Object.values(deleted.chats)]) expect(s).toEqual({ ...settings, bundleId: '' });
    const staleSave = await send({ type: 'save_settings', chatId: 'first', settings, asDefault: false });
    expect(staleSave.chats.first?.bundleId).toBe('');
    expect(staleSave.chats.first?.freeContext).toBe('room addition');
  } finally {
    if (previousSpindle === undefined) Reflect.deleteProperty(globalThis, 'spindle');
    else Reflect.set(globalThis, 'spindle', previousSpindle);
  }
});
