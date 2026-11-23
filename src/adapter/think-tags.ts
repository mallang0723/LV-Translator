// 생각 블록 태그는 항상 번역 제외 (이식판 결정, 원작에는 없음).
// The original's `keptRanges` starts an excluded range at the first listed tag it meets and ends it at the matching close tag. A thinking block
// (`<think> ... </think>`) that merely MENTIONS a listed tag (`<tracker>`, `<prose>`) opens a range inside the thinking text that ends at the
// real `</tracker>` far below, the range's start is then looked up on screen, is not found, and the whole message is refused ("unresolved").
// The thinking tags are therefore handed to the original as always excluded: the thinking block is one excluded range (nested tags inside it
// are skipped), and it is neither translated nor sent to the model. The user's own saved list is never changed: the names are added to what
// the original READS (`withThinkTags`) and taken off again before anything is saved (`saveKeepTags`). Nothing in the original is edited.

export const THINK_TAGS: readonly string[] = ['think', 'thinking', 'reasoning'];

/** The original's own reading of one list entry (`keptTagNames`): `<tag>` or `tag`. */
const nameOf = (part: string): string => {
  const m = /^(?:<([a-z][\w:-]*)>|([a-z][\w:-]*))$/i.exec(part);
  return m ? (m[1] || m[2] || '').toLowerCase() : '';
};
const isThink = (part: string) => THINK_TAGS.includes(nameOf(part));
/** The original keeps at most this many characters of the list (`normalizeParagraph`). */
const LIMIT = 500;

/** The list the original is given: the thinking tags first, then the user's list. */
export function withThinkTags(raw: unknown): string {
  return [...THINK_TAGS, String(raw ?? '').trim()].filter(Boolean).join(' ');
}

/** The list as the user sees it: without the thinking tags. */
export function hideThinkTags(shown: unknown): string {
  return String(shown ?? '')
    .split(/([\s,;]+)/)
    .filter((part, i) => i % 2 === 1 || !isThink(part))
    .join('')
    .replace(/^[\s,;]+/, '')
    .replace(/[ \t]{2,}/g, ' ');
}

/** What is saved: what the form shows, with only the thinking entries the user had saved before put back (so the saved list stays as typed). */
export function saveKeepTags(shown: unknown, before: unknown): string {
  const prior = String(before ?? '');
  const own = prior.split(/[\s,;]+/).filter((p) => p && isThink(p));
  const base = hideThinkTags(shown);
  // A list so long that the added tags pushed its end past the original's limit came back cut: keep what was saved.
  if (prior.length > LIMIT - THINK_TAGS.join(' ').length - 1 && prior.startsWith(base)) return prior;
  return [base.trim(), ...own].filter(Boolean).join(' ');
}

type Cfg = { paragraph?: { keepTags?: unknown } } & Record<string, unknown>;
type Result = { config?: unknown; [k: string]: unknown } | null;

/** The original's storage with the thinking tags added to the list it reads and removed from the list it writes. */
export function thinkAwareStorage<S extends { get(): Promise<Result>; patch(p: Record<string, unknown>): Promise<Result> }>(inner: S): S {
  let saved = '';
  const seen = (r: Result): Result => {
    // Nothing saved yet (no file, or a file with no `config`) reads as the original's defaults plus the thinking tags.
    const c = (r?.config && typeof r.config === 'object' ? r.config : {}) as Cfg;
    const raw = c.paragraph?.keepTags;
    saved = typeof raw === 'string' ? raw : '';
    return { ...(r ?? {}), config: { ...c, paragraph: { ...(c.paragraph ?? {}), keepTags: withThinkTags(saved) } } };
  };
  return {
    ...inner,
    get: async () => seen(await inner.get()),
    patch: async (p) => {
      const c = p.config as Cfg | undefined;
      const out = c && typeof c === 'object' && c.paragraph && typeof c.paragraph === 'object' && typeof c.paragraph.keepTags === 'string'
        ? { ...p, config: { ...c, paragraph: { ...c.paragraph, keepTags: saveKeepTags(c.paragraph.keepTags, saved) } } }
        : p;
      return seen(await inner.patch(out));
    },
  };
}

/** Shows the user's list only in a settings field: what the original writes into it has the thinking tags taken off. */
export function hideThinkInField(field: HTMLInputElement): void {
  if (field.hasAttribute('data-lv-think-hidden')) return;
  field.setAttribute('data-lv-think-hidden', '');
  const own = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!own?.get || !own.set) return;
  const { get, set } = own;
  Object.defineProperty(field, 'value', {
    configurable: true,
    get() {
      return get.call(this);
    },
    set(v: string) {
      set.call(this, hideThinkTags(v));
    },
  });
  set.call(field, hideThinkTags(get.call(field)));
}
