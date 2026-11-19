// Runs Translation Tools' syncSourceToEdits (vendored verbatim) against an in-memory record, so the caller can
// save the rewritten English and the corrected translation in one updateMessage call. The upstream function
// PATCHes the content and then saves the record; here api() only remembers the new content and saveRecord()
// only remembers the new record.

import { blockKey, stripMarks } from '../vendor/tt-1.8.0/helpers';
import { createSyncSource } from '../vendor/tt-1.8.0/sync-source';

export interface UpstreamRecord {
  v: 1;
  map: Record<string, string>;
  edited: Record<string, number>;
  view: string;
  at: number;
}

export interface SyncResult {
  /** Paragraphs whose English was rewritten. */
  count: number;
  /** The new message content, or null when nothing was rewritten. */
  content: string | null;
  /** Upstream-shaped record after the keys moved to the rewritten paragraphs. */
  record: UpstreamRecord;
}

/**
 * `record` is the upstream-shaped state with the corrections already applied (map[key] = corrected,
 * edited[key] = 1); `oldTranslations` is the map before the corrections; `edits` the corrected paragraphs by key.
 */
export async function syncSourceFromEdits(input: {
  content: string;
  record: UpstreamRecord;
  edits: Record<string, string>;
  oldTranslations: Record<string, string>;
  llm(system: string, user: string): Promise<string>;
}): Promise<SyncResult> {
  let content: string | null = null;
  let record = input.record;
  const { syncSourceToEdits } = createSyncSource({
    currentMessage: () => ({ id: 'message', content: input.content }),
    messageCache: new Map(),
    blockKey,
    stripMarks,
    llm: (system: string, user: string) => input.llm(system, user),
    api: async (_path: string, options: { body?: { content?: string } }) => {
      content = options.body?.content ?? null;
      return {};
    },
    setCachedContent: () => {},
    getRecord: () => record,
    saveRecord: async (_chatId: string, _messageId: string, next: UpstreamRecord) => {
      record = next;
    },
  });
  const count = await syncSourceToEdits('chat', 'message', input.edits, input.oldTranslations);
  return { count, content, record };
}
