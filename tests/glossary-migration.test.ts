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

import { planScopeMigration } from '../src/adapter/migrate';
import { withHost } from './helpers/fake-host';

describe('0.4.0 기타 지침·대사 지침·이전 대화 -> the original settings (once, 0.5.3)', () => {
  const old = { freeContext: '현대 한국 배경', freeContextEnabled: true, incomingVoicePrompt: '[Mina]\n반말', incomingVoiceEnabled: true, contextEnabled: true, contextIncludeUserInput: true, contextMessageCount: 4 };

  test('the default and each chat\'s own 기타 지침 / 대사 지침 / 이전 대화 are copied where the original has none', () => {
    const out = planScopeMigration({ config: { defaults: { glossary: 'A = B' } } }, store(old, { c1: { freeContext: '중세 판타지', freeContextEnabled: true } }), at)!;
    const config = out.config as any;
    expect(config.defaults).toMatchObject({ glossary: 'A = B', freeContext: '현대 한국 배경', freeContextEnabled: true, incomingVoicePrompt: '[Mina]\n반말', incomingVoiceEnabled: true, contextEnabled: true, contextIncludeUserInput: true, contextMessageCount: 4 });
    expect(config.chats.c1.freeContext).toBe('중세 판타지');
    expect(config.chats.c1.glossary).toBe('A = B'); // a scope made for the chat starts from the original defaults
    expect((out.lvMigrations as any).scope053).toBe(at);
  });

  test('a value the original already has is never overwritten', () => {
    const file = { config: { defaults: { freeContext: '원작에 있던 것', contextEnabled: true, contextMessageCount: 2 }, chats: { c1: { freeContext: '이 방 것' } } } };
    const out = planScopeMigration(file, store(old, { c1: { freeContext: '옛 방 것', freeContextEnabled: true } }), at)!;
    const config = out.config as any;
    expect(config.defaults.freeContext).toBe('원작에 있던 것');
    expect(config.defaults.contextMessageCount).toBe(2);
    expect(config.defaults.incomingVoicePrompt).toBe('[Mina]\n반말'); // the empty group is still filled
    expect(config.chats.c1.freeContext).toBe('이 방 것');
  });

  test('the 0.5.2 marker (glossary done) does not stop it, but its own marker does; translator.json (the store) is untouched', () => {
    const s = store(old);
    const before = JSON.stringify(s);
    const file = { config: { defaults: { glossary: 'A = B' } }, lvMigrations: { glossary052: 'earlier' } };
    const out = planScopeMigration(file, s, at)!;
    expect((out.config as any).defaults.freeContext).toBe('현대 한국 배경');
    expect((out.lvMigrations as any)).toEqual({ glossary052: 'earlier', scope053: at });
    expect(planScopeMigration(out, s, at)).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  test('nothing to carry: only the marker is written', () => {
    const out = planScopeMigration({ config: { defaults: { freeContext: 'x' } } }, store({}), at)!;
    expect(out.config).toEqual({ defaults: { freeContext: 'x' } });
    expect((out.lvMigrations as any).scope053).toBe(at);
  });

  test('backend: after the upgrade the original reads the 0.4.0 기타 지침 (storage.get), also when 0.5.2 had already moved the glossary', async () => {
    await withHost({ store: { defaults: { freeContext: '현대 한국 배경', freeContextEnabled: true } }, ttConfig: { config: { defaults: { glossary: 'A = B' } }, lvMigrations: { glossary052: 'x' } } }, async (h) => {
      await h.send({ type: 'emu', id: 's', op: 'storage.get', args: [] });
      const data = h.sent.findLast((m: any) => m.type === 'emu_result' && m.id === 's').data;
      expect(data.config.defaults).toMatchObject({ glossary: 'A = B', freeContext: '현대 한국 배경', freeContextEnabled: true });
      expect(data.lvMigrations.glossary052).toBe('x');
      expect(data.lvMigrations.scope053).toBeTruthy();
      expect(h.store().defaults.freeContext).toBe('현대 한국 배경'); // translator.json as it was
    });
  });
});

describe('0.4.0 제외할 태그 -> the original\'s 번역에서 제외할 태그 (0.5.3, bug 9)', () => {
  test('the default\'s and each chat\'s excluded tags and `<tag>` rules are added to paragraph.keepTags, keeping what the original lists', () => {
    const s = store({ excludeTags: 'scene_plan, status', excludeRules: '<my_card>\n/x/' }, { c1: { excludeTags: 'ui', excludeRules: '' } });
    const out = planScopeMigration({ config: { paragraph: { keepTags: 'tracker status' } } }, s, at)!;
    expect((out.config as any).paragraph.keepTags).toBe('tracker status scene_plan my_card ui');
  });
  test('nothing new: the original\'s list is not touched; empty original: the tags become the list', () => {
    const same = planScopeMigration({ config: { paragraph: { keepTags: '<scene_plan>' } } }, store({ excludeTags: 'scene_plan' }), at)!;
    expect((same.config as any).paragraph.keepTags).toBe('<scene_plan>');
    const fresh = planScopeMigration({}, store({ excludeTags: 'scene_plan' }), at)!;
    expect((fresh.config as any).paragraph.keepTags).toBe('scene_plan');
  });
});
