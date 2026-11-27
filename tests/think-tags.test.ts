import { describe, expect, test } from 'bun:test';
import { keptTagNames } from '../src/adapter/pub';
import { hideThinkTags, saveKeepTags, thinkAwareStorage, withThinkTags } from '../src/adapter/think-tags';

describe('thinking tags are excluded by default', () => {
  test('the list the original reads has think / thinking / reasoning first; the user\'s list follows', () => {
    expect(withThinkTags('')).toBe('think thinking reasoning');
    expect(withThinkTags('tracker <cyoa>')).toBe('think thinking reasoning tracker <cyoa>');
    expect([...keptTagNames('tracker')].sort()).toEqual(['reasoning', 'think', 'thinking', 'tracker']);
    expect([...keptTagNames(undefined)].sort()).toEqual(['reasoning', 'think', 'thinking']);
  });

  test('the user sees and saves their own list only', () => {
    expect(hideThinkTags(withThinkTags('tracker cyoa'))).toBe('tracker cyoa');
    expect(hideThinkTags(withThinkTags(''))).toBe('');
    expect(saveKeepTags(withThinkTags('tracker cyoa'), 'tracker cyoa')).toBe('tracker cyoa');
    expect(saveKeepTags('tracker', '')).toBe('tracker');
    // a think entry the user had saved stays saved
    expect(saveKeepTags(withThinkTags('tracker <think>'), 'tracker <think>')).toBe('tracker <think>');
    expect(saveKeepTags('tracker, status', 'tracker, status')).toBe('tracker, status');
  });

  test('a list at the original\'s 500-character limit is saved as it was', () => {
    const long = Array.from({ length: 62 }, (_, i) => `tag${String(i).padStart(2, '0')}`).join(' ').slice(0, 495);
    const cut = withThinkTags(long).slice(0, 500);
    expect(saveKeepTags(cut, long)).toBe(long);
  });

  test('storage: reads carry the thinking tags, writes and the stored file do not', async () => {
    let file: { config?: unknown } | null = { config: { paragraph: { keepTags: 'tracker', viewMode: 'tr' }, notes: [] } };
    const s = thinkAwareStorage({
      get: async () => file,
      patch: async (p: Record<string, unknown>) => (file = { ...file, ...p }),
    });
    const read = (await s.get())?.config as { paragraph: { keepTags: string } };
    expect(read.paragraph.keepTags).toBe('think thinking reasoning tracker');
    // the original saves back what it read (any config write does)
    const saved = (await s.patch({ config: { ...read, notes: ['n'] } }))?.config as { paragraph: { keepTags: string }; notes: string[] };
    expect((file?.config as { paragraph: { keepTags: string } }).paragraph.keepTags).toBe('tracker');
    expect(saved.paragraph.keepTags).toBe('think thinking reasoning tracker');
    expect(saved.notes).toEqual(['n']);
    // a patch with no config (automaticTranslationRecovery) passes through
    await s.patch({ automaticTranslationRecovery: { a: 1 } });
    expect((file as { automaticTranslationRecovery?: unknown }).automaticTranslationRecovery).toEqual({ a: 1 });
    // nothing stored yet
    file = null;
    expect(((await s.get())?.config as { paragraph: { keepTags: string } }).paragraph.keepTags).toBe('think thinking reasoning');
    file = { lvMigrations: {} } as { config?: unknown };
    expect(((await s.get())?.config as { paragraph: { keepTags: string } }).paragraph.keepTags).toBe('think thinking reasoning');
  });
});

describe('thinking exclusion setting', () => {
  test('OFF leaves the original tag list and storage payload unchanged', async () => {
    const tags = '  <think>; TRACKER, thinking  ';
    expect(withThinkTags(tags, false)).toBe(tags);
    expect([...keptTagNames('tracker', false)]).toEqual(['tracker']);
    expect([...keptTagNames(tags, false)].sort()).toEqual(['think', 'thinking', 'tracker']);
    let file: any = { lvExcludeThinking: false, config: { paragraph: { keepTags: tags }, notes: ['note'] } };
    let written: unknown;
    const s = thinkAwareStorage({ get: async () => file, patch: async (p: Record<string, unknown>) => { written = p; return file = { ...file, ...p }; } });
    expect(await s.get()).toBe(file);
    const patch = { config: { paragraph: { keepTags: tags }, notes: ['updated'] } };
    expect(await s.patch(patch)).toBe(file);
    expect(written).toBe(patch);
  });

  test('ON → OFF → ON uses the new policy in each save response without leaking injected tags', async () => {
    let enabled = true;
    let file: any = { config: { paragraph: { keepTags: '<think> tracker' } } };
    const s = thinkAwareStorage({
      get: async () => ({ ...file, lvExcludeThinking: enabled }),
      patch: async (p: Record<string, unknown>) => { file = { ...file, ...p }; return { ...file, lvExcludeThinking: enabled }; },
    });
    const on: any = await s.get();
    enabled = false;
    const off: any = await s.patch({ config: on.config });
    expect(off.config.paragraph.keepTags).toBe('<think> tracker');
    expect(file.config.paragraph.keepTags).toBe('<think> tracker');
    // Explicit edits while OFF have the exact original meaning.
    const edited: any = await s.patch({ config: { paragraph: { keepTags: 'reasoning status' } } });
    expect(edited.config.paragraph.keepTags).toBe('reasoning status');
    enabled = true;
    const again: any = await s.patch({ config: edited.config });
    expect(again.config.paragraph.keepTags).toBe('think thinking reasoning reasoning status');
    expect(file.config.paragraph.keepTags).toBe('reasoning status');
  });

  test('ON preserves explicit thinking tags entered in the form and long lists on background saves', async () => {
    let file: any = { config: { paragraph: { keepTags: 'tracker' } } };
    const s = thinkAwareStorage({ get: async () => file, patch: async (p: Record<string, unknown>) => file = { ...file, ...p } });
    await s.get();
    await s.patch({ config: { paragraph: { keepTags: '<think> tracker' } } });
    expect(file.config.paragraph.keepTags).toBe('<think> tracker');
    file = { config: { paragraph: { keepTags: Array.from({ length: 80 }, (_, i) => `tag${i}`).join(' ').padEnd(500, ' ') } } };
    const raw = file.config.paragraph.keepTags;
    const loaded: any = await s.get();
    await s.patch({ config: { paragraph: { keepTags: loaded.config.paragraph.keepTags.slice(0, 500) } } });
    expect(file.config.paragraph.keepTags).toBe(raw);
  });
});


describe('long keep-tags survive setting switches', () => {
  test.each([476, 487, 500])('%i characters survive OFF → ON → form save → OFF', async (length) => {
    const tags = Array.from({ length: 70 }, (_, i) => `tag${String(i).padStart(4, '0')}`).join(' ').slice(0, length);
    let enabled = false;
    let file: any = { config: { paragraph: { keepTags: tags } } };
    const storage = thinkAwareStorage({
      get: async () => ({ ...file, lvExcludeThinking: enabled }),
      patch: async (p: Record<string, unknown>) => { file = { ...file, ...p }; return { ...file, lvExcludeThinking: enabled }; },
    });
    const off: any = await storage.get();
    enabled = true;
    const on: any = await storage.patch({ config: off.config });
    expect(file.config.paragraph.keepTags).toBe(tags);
    // normalizeParagraph cuts at 500, then the field hides the injected prefix.
    const visible = on.config.paragraph.keepTags.slice(0, 500).slice('think thinking reasoning '.length);
    expect(visible.length).toBe(475);
    await storage.patch({ config: { paragraph: { keepTags: visible } } });
    expect(file.config.paragraph.keepTags).toBe(tags);
    enabled = false;
    const restored: any = await storage.patch({ config: { paragraph: { keepTags: visible } } });
    expect(restored.config.paragraph.keepTags).toBe(tags);
    // An explicit edit while OFF must still use the original behavior.
    await storage.patch({ config: { paragraph: { keepTags: 'tracker' } } });
    expect(file.config.paragraph.keepTags).toBe('tracker');
  });
});
