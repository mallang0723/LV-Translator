import { expect, test } from 'bun:test';
import { ViewRequests, visibleMessageIds } from '../src/view-requests';

test('visible window requests deduplicate repeated DOM mutations and split at 30 ids', () => {
  const requests = new ViewRequests();
  const ids = Array.from({ length: 65 }, (_, i) => `m${i}`);
  expect(requests.take(ids).map((batch) => batch.length)).toEqual([30, 30, 5]);
  expect(requests.take(ids)).toEqual([]);
  expect(requests.take(['m0', 'older', 'older'])).toEqual([['older']]);
});

test('event refresh and chat switch request previously seen untranslated rows again', () => {
  const requests = new ViewRequests();
  expect(requests.take(['same'])).toEqual([['same']]);
  expect(requests.take(['same'], true)).toEqual([['same']]);
  requests.reset();
  expect(requests.take(['same'])).toEqual([['same']]);
});

test('an edited offscreen message is requested on its next appearance without refreshing other rows', () => {
  const requests = new ViewRequests();
  requests.take(['first', 'second']);
  requests.invalidate(['first']);
  expect(requests.take(['second'])).toEqual([]);
  expect(requests.take(['first', 'second'])).toEqual([['first']]);
});


test('500 mounted messages only request rows near the viewport, then older rows on scroll', () => {
  let scrollTop = 48_000;
  const messages = Array.from({ length: 500 }, (_, i) => ({
    messageId: `m${i}`,
    element: { getBoundingClientRect: () => ({ top: i * 100 - scrollTop, bottom: i * 100 - scrollTop + 100, height: 100 } as DOMRect) },
  }));
  const requests = new ViewRequests();
  const first = visibleMessageIds(messages, 900);
  expect(first.length).toBeLessThanOrEqual(30);
  expect(first).toContain('m480');
  expect(first).not.toContain('m0');
  expect(requests.take(first)).toEqual([first]);
  scrollTop = 0;
  const older = visibleMessageIds(messages, 900);
  expect(older).toContain('m0');
  expect(older).not.toContain('m480');
  expect(requests.take(older)).toEqual([older]);
});
