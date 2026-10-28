// How a translated message is shown for each display mode. Pure, so it can be tested directly.

import type { ChatSettings, TranslationRecord, ViewSettings } from '../shared';
import { recordToText } from '../translate/engine';
import { buildParagraphView } from './paragraph-view';

export function renderMessage(content: string, record: TranslationRecord, settings: ChatSettings, view: ViewSettings): string {
  if (settings.displayMode === 'paragraph') return buildParagraphView(content, record, settings, view.paragraphView, view.paragraphOrder);
  const text = recordToText(record);
  switch (settings.displayMode) {
    case 'above':
      return `${text}\n\n<hr class="stt-separator">\n\n${content}`;
    case 'only':
      return text;
    case 'collapsed':
      return `${content}\n\n<details class="stt-translation"><summary>번역</summary>\n\n${text}\n\n</details>`;
    default:
      return `${content}\n\n<hr class="stt-separator">\n\n${text}`;
  }
}
