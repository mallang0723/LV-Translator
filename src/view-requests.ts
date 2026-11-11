import { VIEW_WINDOW } from './shared';

/** Mounted history can be much larger than the viewport. Include a small scroll margin. */
export function visibleMessageIds(
  messages: Array<{ messageId: string; element: Pick<Element, 'getBoundingClientRect'> }>,
  viewportHeight: number,
): string[] {
  return messages.filter(({ element }) => {
    const rect = element.getBoundingClientRect();
    return rect.height > 0 && rect.bottom >= -300 && rect.top <= viewportHeight + 300;
  }).map(({ messageId }) => messageId);
}

/** Deduplicate DOM/scroll notifications, including rows with no saved translation. */
export class ViewRequests {
  private requested = new Set<string>();

  reset(): void {
    this.requested.clear();
  }

  invalidate(ids: string[]): void {
    ids.forEach((id) => this.requested.delete(id));
  }

  take(ids: string[], refresh = false): string[][] {
    const pending = [...new Set(ids)].filter((id) => refresh || !this.requested.has(id));
    const batches: string[][] = [];
    for (let i = 0; i < pending.length; i += VIEW_WINDOW) {
      const batch = pending.slice(i, i + VIEW_WINDOW);
      batch.forEach((id) => this.requested.add(id));
      batches.push(batch);
    }
    return batches;
  }
}
