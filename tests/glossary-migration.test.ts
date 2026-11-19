import { describe, expect, test } from 'bun:test';
import { planGlossary } from '../src/adapter/contract';
import { planGlossaryMigration } from '../src/adapter/migrate';
import { normalizeStore } from '../src/shared';
import { hashText } from '../src/adapter/keys';

const store = (defaults: Record<string, unknown>, chats: Record<string, Record<string, unknown>> = {}, userBundles: unknown[] = []) =>
  normalizeStore({ defaults, chats, userBundles });
const at = '2026-11-19T00:00:00.000Z';

describe('0.4.0 glossary -> the original settings (once)', () => {
  test('the default and each chat glossary are copied; a chat with no scope of its own gets one made from the original defaults', () => {
    const s = store({ glossary: 'Mina = 미나' }, { c1: { glossary: 'Mina = 미나\nLamp = 등불' } });
    const out = planGlossaryMigration({ config: { defaults: { incomingPresetId: 'builtin-roleplay', autoCollectEnabled: true } } }, s, at)!;
    const config = out.config as any;
    expect(config.defaults.glossary).toBe('Mina = 미나');
    expect(config.defaults.autoCollectEnabled).toBe(true);
    // the chat's own words differ from the default's, but the original already has a default glossary now: not replaced
    expect(config.chats).toBeUndefined();
    expect((out.lvMigrations as any).glossary052).toBe(at);
  });

  test('with no original config at all, a chat glossary becomes that chat\'s scope', () => {
    const out = planGlossaryMigration({}, store({}, { c1: { glossary: 'Mina = 미나' } }), at)!;
    expect((out.config as any).chats.c1.glossary).toBe('Mina = 미나');
    expect((out.config as any).defaults).toBeUndefined();
  });

  test('a chat scope copied from the original defaults keeps the defaults\' other settings (a scope does not inherit)', () => {
    const out = planGlossaryMigration({ config: { defaults: { incomingPresetId: 'builtin-roleplay', glossary: '' } } }, store({}, { c1: { glossary: 'A = B' } }), at)!;
    expect((out.config as any).chats.c1).toEqual({ incomingPresetId: 'builtin-roleplay', glossary: 'A = B' });
  });

  test('a glossary the original already has is never replaced', () => {
    const file = { config: { defaults: { glossary: 'X = Y' }, chats: { c1: { glossary: 'Own = 자기' }, c2: { glossary: '' } } } };
    const out = planGlossaryMigration(file, store({ glossary: 'A = B' }, { c1: { glossary: 'Old = 옛' }, c2: { glossary: 'Two = 둘' } }), at)!;
    const config = out.config as any;
    expect(config.defaults.glossary).toBe('X = Y');
    expect(config.chats.c1.glossary).toBe('Own = 자기');
    expect(config.chats.c2.glossary).toBe('Two = 둘');
  });

  test('the bundle\'s words are merged in as 0.4.0 published them', () => {
    const s = store({}, { c1: { glossary: 'Room = 방', bundleId: 'b1' } }, [{ id: 'b1', name: 'B', glossary: 'Bundle = 묶음', freeContext: '', incomingVoicePrompt: '' }]);
    expect(((planGlossaryMigration({}, s, at)!.config as any).chats.c1.glossary)).toBe('Bundle = 묶음\nRoom = 방');
  });

  test('done once: the marker (outside config) stops a second run, and without anything to carry over only the marker is written', () => {
    const first = planGlossaryMigration({ keep: 1 }, store({}), at)!;
    expect(first).toEqual({ keep: 1, lvMigrations: { glossary052: at } });
    expect(planGlossaryMigration(first, store({ glossary: 'A = B' }), at)).toBeNull();
  });
});

describe('publishing the glossary', () => {
  const published = { st_translator: { v: 1, glossary: { text: 'Mina = 미나', hash: hashText('Mina = 미나'), at: 1 } } };
  test('an empty original glossary never clears a glossary that is already published', () => {
    expect(planGlossary(published, '', 2)).toBeNull();
  });
  test('a non-empty one still replaces it, and nothing is published when nothing was before', () => {
    expect(planGlossary(published, 'Lamp = 등불', 2)?.metadata.st_translator).toMatchObject({ glossary: { text: 'Lamp = 등불' } });
    expect(planGlossary({}, '', 2)).toBeNull();
  });
});
