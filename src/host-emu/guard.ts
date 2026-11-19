// The original saves through `marinara.storage.patch` and waits for the answer: its save button, its status line and its
// write queue (`configWriteQueue`, extension.js ~5416-5430) all sit behind that one promise. If the answer never comes back
// (a reply lost on the way from the backend, a stalled call) the button stays "저장 중", the status stays "설정을 저장하고 있습니다.",
// and every later save queues behind the stuck one and is never written.
// This wraps the storage the original is given so that promise always settles:
//   - a call that has no answer after `ms` is given up;
//   - a patch whose answer is lost is checked by reading the file back: when the file holds what was patched, the patch did
//     go through, and it is answered as done (the original then updates itself as after a normal save);
//   - otherwise it fails with a message the original shows in its own status line.

import type { MarinaraStorage } from './runtime';

export const STORAGE_TIMEOUT_MS = 20_000;

export class StorageTimeout extends Error {
  constructor(what: string, ms: number) {
    super(`${what}에 ${Math.round(ms / 1000)}초 안에 응답이 없습니다. 다시 시도해 주세요.`);
    this.name = 'StorageTimeout';
  }
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StorageTimeout(what, ms)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const same = (a: unknown, b: unknown): boolean => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

export function guardStorage(inner: MarinaraStorage, ms: number = STORAGE_TIMEOUT_MS): MarinaraStorage {
  return {
    get: () => within(inner.get(), ms, '설정 읽기'),
    async patch(p) {
      try {
        return await within(inner.patch(p), ms, '설정 저장');
      } catch (e) {
        if (!(e instanceof StorageTimeout)) throw e;
        // No answer: did the write happen anyway?
        let stored: { config?: unknown } | null = null;
        try {
          stored = await within(inner.get(), ms, '설정 확인');
        } catch {
          throw e;
        }
        if (stored && 'config' in p && same(stored.config, p.config)) return stored;
        throw e;
      }
    },
  };
}
