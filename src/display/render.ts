// How a translated message is shown for each display mode. Pure, so it can be tested directly.

import type { ChatSettings, TranslationRecord, ViewSettings } from '../shared';
import { recordToText } from '../translate/engine';
import { cleanReply } from '../translate/clean-reply';
import { stripReasoning } from '../message-ui';
import { buildParagraphView } from './paragraph-view';

/**
 * `stored` (Auto-parse only): the full stored text the record is keyed by, when `content` is the host's think-stripped
 * display text. `content` is then used verbatim as the source side and reasoning is cut out of the translation side only.
 */
export function renderMessage(content: string, record: TranslationRecord | null | undefined, settings: ChatSettings, view: ViewSettings, stored?: string): string {
  // Keep the original visible until translated text exists, as in the backend render processor.
  if (!record || !record.parts.some((p) => cleanReply(p).trim())) return content;
  if (settings.displayMode === 'paragraph') return buildParagraphView(content, record, settings, view.paragraphView, view.paragraphOrder, stored);
  const text = stored === undefined ? recordToText(record, content) : stripReasoning(recordToText(record, stored));
  if (!text.trim()) return content;
  switch (settings.displayMode) {
    case 'above':
      return `${text}\n\n<hr class="stt-separator">\n\n${content}`;
    case 'only':
      return text;
    case 'collapsed':
      return `${content}\n\n<details class="stt-translation"><summary>번역</summary>\n\n${text}\n\n</details>`;
    case 'collapsed-source':
      return `${text}\n\n<details class="stt-translation"><summary>원문</summary>\n\n${content}\n\n</details>`;
    default:
      return `${content}\n\n<hr class="stt-separator">\n\n${text}`;
  }
}
