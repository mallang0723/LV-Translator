import { describe, expect, test } from 'bun:test';
import { keptTagNames } from '../src/adapter/pub';
import { hideThinkTags, saveKeepTags, thinkAwareStorage, withThinkTags } from '../src/adapter/think-tags';

describe('thinking tags are always excluded (0.5.10, port decision)', () => {
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
