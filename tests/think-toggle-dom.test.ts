import { expect, test } from 'bun:test';
import { originalUUIDPlugin } from '../scripts/patches.mjs';

// Required DOM regression: use installed jsdom or point DOM_MODULE at a local installation.
test('thinking toggle: live ON/OFF, original parity, and zero empty translation cells', async () => {
  const { JSDOM } = await import(process.env.DOM_MODULE || 'jsdom').catch(() => {
    throw new Error('DOM regression requires local jsdom. Run DOM_MODULE=/path/to/jsdom/lib/api.js bun run test; see README 검증.');
  });
  const build = await Bun.build({ entrypoints: ['tests/fixtures/think-toggle.ts'], target: 'browser', plugins: [originalUUIDPlugin] });
  expect(build.success).toBe(true);
  const script = await build.outputs[0]!.text();
  const windows: any[] = [];
  const errors: string[] = [];
  const until = async (check: () => unknown) => {
    for (let i = 0; i < 150; i++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('DOM update timed out');
  };
  const setup = async (baseline: boolean, initial = true, keep = '', parsed = false) => {
    const dom = new JSDOM('<!doctype html><body>', { url: 'https://local.invalid/chat/chat', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    windows.push(w);
    // Browser layout/host APIs unused by paragraph translation in this DOM fixture.
    w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
    w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    w.CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c: string) => `\\${c}`) };
    w.fetch = async () => { throw new Error('Unexpected network request'); };
    w.Request = Request; w.Response = Response; w.Headers = Headers;
    w.AbortController = AbortController;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.addEventListener('error', (e: any) => errors.push(e.message));
    w.eval(script);
    w.setupThinkTest(baseline, initial, keep, parsed);
    await until(() => w.document.querySelector('.tpg-form'));
    return w;
  };
  const translate = async (w: any, id: string) => {
    w.document.querySelector(`[data-message-id="${id}"] .mari-message-actions button:has(svg.lucide-languages)`).click();
    await until(() => w.document.querySelector(`[data-message-id="${id}"] .ptx-view .ptx-t`));
    const view = w.document.querySelector(`[data-message-id="${id}"] .ptx-view`) as HTMLElement;
    return {
      translated: Array.from(view.querySelectorAll('.ptx-t')).map((n) => n.textContent),
      sources: Array.from(view.querySelectorAll('.ptx-o')).map((n) => n.textContent),
      missing: view.querySelectorAll('.is-missing').length,
      empty: Array.from(view.querySelectorAll('.ptx-t')).filter((n) => !n.textContent?.trim()).length,
      thoughts: ['think', 'thinking', 'reasoning'].map((tag) => view.querySelector(tag)?.textContent),
    };
  };
  const toggle = async (w: any, on: boolean) => {
    const field = w.document.querySelector('[name="lv:excludeThinking"]');
    field.checked = on;
    field.dispatchEvent(new w.Event('change', { bubbles: true }));
    w.document.querySelector('.tpg-save').click();
    await until(() => w.document.querySelector('[data-tpg-status][data-kind="success"]'));
  };
  try {
    const original = await setup(true);
    const expected = await translate(original, 'off');
    expect(expected.translated.length).toBe(5);
    const w = await setup(false);
    expect(w.document.querySelector('[name="lv:excludeThinking"]').checked).toBe(true);
    const on = await translate(w, 'on');
    expect(on.translated.length).toBe(2);
    expect(w.thinkTestRequests.join('\n')).not.toContain('Private plan');
    expect(on.thoughts).toEqual(['Private plan 0.', 'Private plan 1.', 'Private plan 2.']);
    await toggle(w, false);
    const beforeOff = w.thinkTestRequests.length;
    const off = await translate(w, 'off');
    expect(w.thinkTestRequests.slice(beforeOff)).toEqual(original.thinkTestRequests);
    expect(off).toEqual(expected);
    expect(off.missing).toBe(0);
    expect(off.empty).toBe(0);
    await toggle(w, true);
    expect(await translate(w, 'again')).toEqual(on);
    const persisted = await setup(false, false);
    expect(persisted.document.querySelector('[name="lv:excludeThinking"]').checked).toBe(false);
    expect(await translate(persisted, 'off')).toEqual(expected);
    const parsedOriginal = await setup(true, false, '', true);
    const parsedPort = await setup(false, false, '', true);
    const parsed = await translate(parsedPort, 'off');
    expect(parsed).toEqual(await translate(parsedOriginal, 'off'));
    expect(parsed.translated.length).toBe(2);
    expect(parsed.missing + parsed.empty).toBe(0);
    const explicit = await setup(false, false, '<think>');
    expect(explicit.document.querySelector('[name="paraKeepTags"]').value).toBe('<think>');
    await toggle(explicit, false);
    expect((await translate(explicit, 'off')).translated.length).toBe(4);
    // Real original form: OFF accepts 487 chars, ON repopulates only 475,
    // then saving the untouched form must preserve all 487 stored characters.
    const longTags = Array.from({ length: 61 }, (_, i) => `tag${String(i).padStart(4, '0')}`).join(' ');
    expect(longTags.length).toBe(487);
    const long = await setup(false, false, longTags);
    expect(long.document.querySelector('[name="paraKeepTags"]').value).toBe(longTags);
    await toggle(long, true);
    expect(long.thinkTestKeepTags()).toBe(longTags);
    expect(long.document.querySelector('[name="paraKeepTags"]').value.length).toBe(475);
    await toggle(long, true);
    expect(long.thinkTestKeepTags()).toBe(longTags);
    expect(long.thinkTestKeepTags().length).toBe(487);
    await toggle(long, false);
    expect(long.thinkTestKeepTags()).toBe(longTags);
    expect(long.document.querySelector('[name="paraKeepTags"]').value).toBe(longTags);
    // The preservation guard must not undo deliberate shorter edits or clearing.
    await toggle(long, true);
    long.document.querySelector('[name="paraKeepTags"]').value = longTags.slice(0, 100);
    await toggle(long, true);
    expect(long.thinkTestKeepTags()).toBe(longTags.slice(0, 100));
    long.document.querySelector('[name="paraKeepTags"]').value = '';
    await toggle(long, true);
    expect(long.thinkTestKeepTags()).toBe('');
    expect(errors).toEqual([]);
  } finally {
    for (const w of windows) w.close();
  }
}, 60000);
