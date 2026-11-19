import { describe, expect, test } from 'bun:test';
import { guardStorage, StorageTimeout } from '../src/host-emu/guard';
import { pickOnColor, contrastRatio } from '../src/host-emu/on-primary';

const never = <T,>() => new Promise<T>(() => {});

describe('guardStorage: the original\'s save promise always settles (0.5.3)', () => {
  test('a normal call passes through', async () => {
    const g = guardStorage({ get: async () => ({ config: 1 }), patch: async (p) => ({ config: p.config }) }, 50);
    expect(await g.get()).toEqual({ config: 1 });
    expect(await g.patch({ config: 2 })).toEqual({ config: 2 });
  });

  test('a patch whose answer is lost but which was written is answered from the file', async () => {
    const file = { config: null as unknown };
    const g = guardStorage({ get: async () => ({ ...file }), patch: (p) => { file.config = p.config; return never(); } }, 30);
    expect(await g.patch({ config: { defaults: { freeContext: '현대 한국' } } })).toEqual({ config: { defaults: { freeContext: '현대 한국' } } });
  });

  test('a patch nobody answers and the file does not show fails with a message, instead of hanging', async () => {
    const g = guardStorage({ get: async () => ({ config: { old: true } }), patch: () => never() }, 30);
    const e = await g.patch({ config: { next: true } }).catch((x) => x);
    expect(e).toBeInstanceOf(StorageTimeout);
    expect(e.message).toContain('응답이 없습니다');
  });

  test('when the read-back hangs too, it still fails', async () => {
    const g = guardStorage({ get: () => never(), patch: () => never() }, 30);
    expect(await g.patch({ config: {} }).catch((x) => x)).toBeInstanceOf(StorageTimeout);
  });

  test('a real error is not turned into a timeout', async () => {
    const g = guardStorage({ get: async () => null, patch: async () => { throw new Error('디스크가 가득 찼습니다.'); } }, 30);
    expect((await g.patch({ config: {} }).catch((x) => x)).message).toBe('디스크가 가득 찼습니다.');
  });
});

describe('label colour on the primary colour', () => {
  test('light primary gets a dark label, dark primary a light one, and both read', () => {
    for (const bg of [[173, 216, 230], [255, 255, 255], [135, 206, 250]] as const) {
      const c = pickOnColor([...bg]);
      expect(c).toBe('#111114');
      expect(contrastRatio([...bg], [17, 17, 20])).toBeGreaterThan(4.5);
    }
    for (const bg of [[60, 40, 120], [20, 20, 30]] as const) expect(pickOnColor([...bg])).toBe('#ffffff');
  });
});
