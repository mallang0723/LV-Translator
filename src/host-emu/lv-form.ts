// The settings this extension adds on top of the original Translation Tools 1.10.0 (connection, languages, my-message
// translation, exclusion rules, guide bundles) live INSIDE the original's own settings form, as sections that use the
// original's markup (its `tpg-group` sections, `UI.*` classes and switch rows), above its save bar. There is one screen and one
// save button: this file hooks the form's `submit` from outside, saves our values first, and then lets the original's own
// submit handler run unchanged (its button text, its status line, its own save). An error of ours is shown in the
// original's status line. The original's code is never edited (scripts/verify-original.mjs); the form is only added to.
import { hideThinkInField, USER_KEEP_TAGS_MAX } from '../adapter/think-tags';
import { planRoomVoice, type RoomVoice, type RoomVoicePlan } from '../bundles';

export interface LvState {
  ready: boolean;
  /** Chat on screen ('' = none: the new-chat defaults are edited). A change refills the fields. */
  chatKey: string;
  hasChat: boolean;
  values: Omit<LvValues, 'asDefault'>;
  connections: Array<[string, string]>;
  connectionNote: { text: string; kind: '' | 'warn' | 'err' };
  linkNote: string;
  bundles: Array<{ id: string; name: string; glossary: string; freeContext: string; incomingVoicePrompt: string }>;
}

export interface LvValues {
  connectionId: string;
  modelLanguage: string;
  myLanguage: string;
  /** Max characters per request of the original's paragraph translation; 0 = the original's own (6000). */
  batchChars: number;
  autoTranslate: boolean;
  translateMyMessages: boolean;
  showDraftButton: boolean;
  /** Continue once a message translated off screen when it reaches the screen with untranslated cells (one more model call). */
  healOffscreen: boolean;
  /** Per-user, shared by all chats; applied on save without a reload. */
  excludeThinking: boolean;
  protectHtml: boolean;
  protectCode: boolean;
  excludeRules: string;
  bundleId: string;
  /** Which bundle's 대사 지침 the room's own 「대사 지침」 holds, and what was there before (see `planRoomVoice`). */
  voice: RoomVoice;
  asDefault: boolean;
}

/** The three texts a guide bundle holds, in the original's stored format (glossary `A = B` lines, 기타 지침, 대사 지침 `[이름]` blocks). */
export interface BundleSeed {
  glossary: string;
  freeContext: string;
  incomingVoicePrompt: string;
}

export interface LvHost {
  state(): LvState;
  /** Saves our values. Rejects with the message to show in the original's status line. */
  save(values: LvValues): Promise<void>;
  /** `id` null = a new bundle, filled from `seed`: what the settings form holds right now (saved or not). */
  editBundle(id: string | null, seed?: BundleSeed): void;
  deleteBundle(id: string): void;
}

// The original's own class strings (extension.js `UI`, `SWITCH_ROW`, `SWITCH_OFF`), used only when the form to copy them from
// is not there. They are read from the form first so the two never drift apart.
const FALLBACK = {
  label: 'text-[0.6875rem] font-medium text-[var(--muted-foreground)]',
  select: 'mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40',
  input: 'mari-chrome-field mt-0.5 w-full !rounded-md px-3 py-2 text-xs',
  textarea: 'mt-0.5 w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40',
  help: 'text-[0.625rem] leading-relaxed text-[var(--marinara-chat-chrome-panel-muted)]',
  title: 'text-xs font-semibold text-[var(--foreground)]',
  button: 'flex shrink-0 items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]',
  row: 'flex scroll-mt-3 items-center gap-3 p-2 transition-colors justify-between rounded-lg px-3 py-2.5 text-left bg-[var(--secondary)] hover:bg-[var(--accent)]',
};
type Classes = typeof FALLBACK;

function classesFrom(form: HTMLElement): Classes {
  const pick = (sel: string, fallback: string) => (form.querySelector(sel) as HTMLElement | null)?.getAttribute('class')?.trim() || fallback;
  return {
    label: pick('.tpg-group > div > label', FALLBACK.label),
    select: pick('select[name="outgoingPresetId"]', FALLBACK.select),
    input: pick('input[name="paraKeepTags"]', FALLBACK.input),
    textarea: pick('textarea[name="freeContext"]', FALLBACK.textarea),
    help: pick('.tpg-group > div > p, .tpg-group p', FALLBACK.help),
    title: pick('.tpg-group > h5', FALLBACK.title),
    button: pick('[data-tpg-add]', FALLBACK.button),
    row: FALLBACK.row,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let seq = 0;

/** The same markup as the original's `switchRow()` (extension.js ~6392); `paintSwitches` paints it on every form `change`. */
function switchRow(cls: Classes, name: string, title: string, description = ''): string {
  const id = `lv-switch-${++seq}`;
  return `<div class="${cls.row}" data-tpg-switch data-lv-switch="${name}">
      <span class="min-w-0 text-[0.6875rem] font-medium"><span class="inline-flex min-w-0 items-center gap-1.5"><label for="${id}" class="min-w-0 cursor-pointer">${esc(title)}</label></span>${description ? `<label for="${id}" class="mt-0.5 block text-[0.625rem] leading-relaxed text-[var(--marinara-chat-chrome-panel-muted)] cursor-pointer">${esc(description)}</label>` : ''}</span>
      <span class="inline-flex shrink-0 items-center gap-1.5"><label for="${id}" class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer"><input id="${id}" type="checkbox" name="lv:${name}" class="peer sr-only"><span aria-hidden="true" data-settings-switch-track="true" class="inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors bg-[var(--border)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)]"><span data-settings-switch-thumb="true" class="pointer-events-none block h-4 w-4 shrink-0 rounded-full bg-[var(--background)] shadow-sm ring-1 ring-[var(--border)] transition-transform"></span></span></label></span>
    </div>`;
}

function build(cls: Classes, hasChat: boolean): string {
  const field = (label: string, control: string) => `<div><label class="${cls.label}">${esc(label)}</label>${control}</div>`;
  const input = (name: string, extra = '') => `<input name="lv:${name}" class="${cls.input}" autocomplete="off" spellcheck="false" ${extra}>`;
  return `
      <section class="tpg-group" data-lv-section="basic">
        <h5 class="${cls.title}">번역 연결·언어</h5>
        ${field('번역에 쓸 AI 연결', `<select name="lv:connectionId" class="${cls.select}" aria-label="번역에 쓸 AI 연결"></select>`)}
        <p class="${cls.help}" data-lv-connection-note></p>
        <p class="${cls.help}" data-lv-link-note hidden></p>
        ${field('모델 언어 (내 메시지를 이 언어로)', input('modelLanguage'))}
        ${field('내 언어 (응답을 이 언어로)', input('myLanguage'))}
        ${field('한 번에 번역할 최대 글자수 (긴 메시지를 나눌 때)', input('batchChars', 'inputmode="numeric" placeholder="비워 두면 원작 기본값(6000자)"'))}
        <p class="${cls.help}">문단 번역은 문단을 묶어 한 번에 보냅니다. 숫자를 적으면 한 번에 보내는 문단의 글자 합이 그 수를 넘지 않게 나눠 번역합니다(문단 하나가 그보다 길면 그 문단만 따로 보냅니다). 비워 두면 원작이 하던 대로 합니다.</p>
        ${switchRow(cls, 'autoTranslate', 'AI 응답 자동 번역')}
        ${switchRow(cls, 'translateMyMessages', '내 메시지를 보내기 전에 번역', '채팅에는 번역문이 남습니다.')}
        ${switchRow(cls, 'showDraftButton', '입력창 옆에 번역 버튼 표시')}
        ${switchRow(cls, 'healOffscreen', '화면에 나타날 때 빠진 칸 자동 보충 번역 (모델 호출 1회 추가)', '화면 밖에서 번역된 메시지가 화면에 나타났을 때 번역이 빠진 칸이 있으면 한 번 자동으로 이어서 번역합니다. 끄면 빠진 칸은 「이어서 번역」 버튼으로 채웁니다.')}
      </section>
      <section class="tpg-group" data-lv-section="exclude">
        <h5 class="${cls.title}">번역하지 않을 부분</h5>
        ${switchRow(cls, 'excludeThinking', '생각 블록 번역 제외', '기본 켜짐. think·thinking·reasoning 블록을 번역 요청에서 빼고 원문으로 둡니다. 끄면 원작처럼 별도로 제외하지 않습니다. 사용자별 모든 채팅에 적용되며 저장 즉시 반영됩니다.')}
        ${switchRow(cls, 'protectHtml', 'HTML 태그·속성, <style>, <script> 는 그대로 두고 글자만 번역')}
        ${switchRow(cls, 'protectCode', '코드 블록(```) 은 번역하지 않음')}
        <p class="${cls.help}">태그 이름으로 빼는 것은 위 「문단 번역」의 「번역에서 제외할 태그」에 적으세요(원작 기능: 번역 요청에 보내지 않고 번역 화면에 원문 그대로 둡니다). 아래 제외 규칙은 글자 규칙만 받습니다. &lt;태그&gt; 줄을 적고 저장하면 그 태그는 「번역에서 제외할 태그」로 옮겨집니다. 생각 블록 번역 제외를 켜면 think·thinking·reasoning을 목록에 적지 않아도 됩니다. 끈 경우에도 목록에 직접 적은 태그는 원작처럼 제외됩니다.</p>
        ${field('제외 규칙 (한 줄에 하나)', `<textarea name="lv:excludeRules" class="${cls.textarea}" rows="3" spellcheck="false" placeholder="/HP: \\d+\\/\\d+/\n[상태창] ... [/상태창]"></textarea>`)}
        <p class="${cls.help}" data-lv-tag-moved hidden></p>
        <p class="${cls.help}">/정규식/ 은 일치하는 부분, 시작 ... 끝 은 그 사이 전체를 번역에 보내지 않고 번역 화면에 원문 그대로 둡니다(여러 문단에 걸쳐도 됩니다). {{매크로}} 는 항상 그대로 둡니다.</p>
      </section>
      <section class="tpg-group" data-lv-section="bundle">
        <h5 class="${cls.title}">번역 지침 묶음</h5>
        ${field('이 방의 묶음', `<select name="lv:bundleId" class="${cls.select}" aria-label="이 방의 묶음"></select>`)}
        <div class="tpg-inline-actions">
          <button type="button" class="${cls.button}" data-lv-bundle-new>새 묶음 만들기</button>
          <button type="button" class="${cls.button}" data-lv-bundle-edit>묶음 편집</button>
          <button type="button" class="${cls.button}" data-lv-bundle-delete>삭제</button>
        </div>
        <p class="${cls.help}">묶음의 단어집·추가 지침은 내 메시지 번역에 더해집니다(응답 번역의 단어장·기타 지침은 위의 원작 설정에서 합니다). 묶음의 대사 지침은 묶음을 고르고 저장할 때 이 방의 위 「대사 지침」에 적혀 켜지고(응답 번역에 쓰입니다), 그동안 방에 있던 대사 지침은 묶음을 바꾸거나 「없음」으로 하면 되돌아옵니다. 「새 묶음 만들기」는 위 원작 설정에 지금 적힌 내용(저장 전이어도)을 가져옵니다. 선택은 아래 저장 버튼으로 적용합니다.</p>
        <p class="${cls.help}" data-lv-voice-note hidden></p>
        <details data-lv-bundle-preview hidden><summary class="${cls.help}"></summary>
          <label class="${cls.label}">단어집</label><textarea readonly class="${cls.textarea}" rows="2" data-lv-preview="glossary" placeholder="내용 없음"></textarea>
          <label class="${cls.label}">추가 지침</label><textarea readonly class="${cls.textarea}" rows="2" data-lv-preview="freeContext" placeholder="내용 없음"></textarea>
          <label class="${cls.label}">대사 지침</label><textarea readonly class="${cls.textarea}" rows="2" data-lv-preview="incomingVoicePrompt" placeholder="내용 없음"></textarea>
        </details>
        ${hasChat ? switchRow(cls, 'asDefault', '새 채팅의 기본값으로도 저장', '위 설정을 앞으로 만드는 채팅의 기본값으로도 저장합니다.') : ''}
      </section>`;
}

const TAG_LINE = /^\s*<\s*([A-Za-z][\w:.-]*)\s*\/?>\s*$/;

/** `names` added to the 「번역에서 제외할 태그」 text (names it already lists are not repeated); returns the new text. */
export function mergeKeepTags(have: string, names: string[]): string {
  const known = new Set(have.split(/[\s,;]+/).map((t) => t.replace(/^<|>$/g, '').toLowerCase()).filter(Boolean));
  const add = names.filter((n) => !known.has(n));
  return add.length ? [have.trim(), ...add].filter(Boolean).join(' ') : have;
}

const MOVED_NOTICE = '태그는 위 「번역에서 제외할 태그」로 옮겼습니다.';
/**
 * The original keeps at most 500 characters of 「번역에서 제외할 태그」 (extension.js `normalizeParagraph`: `keepTags.slice(0, 500)`); the rest is cut off when it saves.
 * With thinking exclusion ON, injected tags reserve 25 characters. OFF uses the original 500-character limit.
 */
export const KEEP_TAGS_MAX = USER_KEEP_TAGS_MAX;

export interface TagMove {
  /** The exclusion rules without the lines that moved (the lines that did not fit stay, in their place). */
  rest: string;
  /** The new text of 「번역에서 제외할 태그」. */
  keep: string;
  moved: string[];
  stayed: string[];
}

/**
 * Plans the move of `<tag>` lines out of the exclusion rules into 「번역에서 제외할 태그」. A tag the list already has just leaves the rules. A tag
 * that would make the list longer than the original keeps (475 characters of the user's own list; it would be cut off silently on save) is NOT moved: its line stays in
 * the rules, where it keeps working.
 */
export function planTagMove(rules: string, keepText: string, max = KEEP_TAGS_MAX): TagMove {
  const lines = rules.split(/\r?\n/);
  let keep = keepText;
  const moved: string[] = [];
  const stayed: string[] = [];
  const out: string[] = [];
  for (const line of lines) {
    const m = TAG_LINE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const name = m[1]!.toLowerCase();
    if (moved.includes(name)) continue;
    const next = mergeKeepTags(keep, [name]);
    if (next.length > max && next !== keep) {
      if (!stayed.includes(name)) stayed.push(name);
      out.push(line);
      continue;
    }
    keep = next;
    moved.push(name);
  }
  return { rest: moved.length ? out.join('\n').replace(/^\s*\n+|\n+\s*$/g, '') : rules, keep, moved, stayed };
}

const stayedNotice = (names: string[], max = KEEP_TAGS_MAX) => `${names.map((t) => `<${t}>`).join(' ')}: 「번역에서 제외할 태그」가 길이 한도(${max}자)를 넘어 옮기지 못했습니다. 제외 규칙에 그대로 두었고 그대로 동작합니다.`;

/** Waits for the original's own save to write its result in the status line. */
function savedResult(form: HTMLFormElement): Promise<'success' | 'error' | 'timeout'> {
  const status = form.querySelector<HTMLElement>('[data-tpg-status]');
  return new Promise((resolve) => {
    if (!status) return resolve('timeout');
    let o: MutationObserver | null = null;
    const finish = (r: 'success' | 'error' | 'timeout') => {
      o?.disconnect();
      resolve(r);
    };
    const check = () => {
      if (status.dataset.kind === 'success') finish('success');
      else if (status.dataset.kind === 'error') finish('error');
    };
    o = new MutationObserver(check);
    o.observe(status, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-kind'] });
    setTimeout(() => finish('timeout'), 8000);
    check();
  });
}

/** Adds `text` to the original's status line (after its own "저장했습니다."). */
function appendStatus(form: HTMLFormElement, text: string): void {
  const status = form.querySelector<HTMLElement>('[data-tpg-status]');
  if (status && !status.textContent?.includes(text)) status.textContent = `${status.textContent ?? ''} ${text}`.trim();
}

/** What the original's form holds now (its hidden fields follow every edit of a glossary row, a voice row and the 기타 지침 box), saved or not. */
function formGuides(form: HTMLFormElement): BundleSeed {
  const text = (name: string) => (form.elements.namedItem(name) as HTMLTextAreaElement | null)?.value ?? '';
  return { glossary: text('glossary'), freeContext: text('freeContext'), incomingVoicePrompt: text('incomingVoicePrompt') };
}

const voiceFields = (form: HTMLFormElement) => ({
  text: form.elements.namedItem('incomingVoicePrompt') as HTMLTextAreaElement | null,
  on: form.elements.namedItem('incomingVoiceEnabled') as HTMLInputElement | null,
});

function describeVoice(plan: RoomVoicePlan, bundleName: string, saved: boolean): string {
  const parts: string[] = [];
  if (plan.restored) parts.push(saved ? '이 방의 「대사 지침」을 묶음 적용 전 값으로 되돌렸습니다.' : '저장하면 이 방의 「대사 지침」이 묶음 적용 전 값으로 되돌아옵니다.');
  if (plan.applied) {
    parts.push(saved ? `묶음 「${bundleName}」의 대사 지침을 이 방의 「대사 지침」에 적고 켰습니다(응답 번역에 쓰입니다).` : `저장하면 묶음 「${bundleName}」의 대사 지침이 이 방의 「대사 지침」에 적히고 켜집니다(응답 번역에 쓰입니다).`);
    if (plan.replaced) parts.push('이 방에 있던 대사 지침은 묶음을 바꾸거나 「없음」으로 하면 되돌아옵니다.');
  }
  return parts.join(' ');
}

/** When another bundle is picked: says what saving will do to the room's own 「대사 지침」. */
function previewVoice(form: HTMLFormElement): void {
  const note = form.querySelector<HTMLElement>('[data-lv-voice-note]');
  if (!note) return;
  const f = voiceFields(form);
  const st = hostRef?.state();
  if (!f.text || !f.on || !st?.ready) return;
  const id = (form.querySelector('[name="lv:bundleId"]') as HTMLSelectElement).value;
  const plan = planRoomVoice(id, st.bundles, { prompt: f.text.value, enabled: f.on.checked }, st.values.voice);
  const text = describeVoice(plan, st.bundles.find((b) => b.id === id)?.name ?? '', false);
  note.textContent = text;
  note.hidden = !text;
}
let hostRef: LvHost | null = null;

const q = <T extends HTMLElement>(form: HTMLElement, name: string) => form.querySelector<T>(`[name="lv:${name}"]`)!;

export interface LvForm {
  /** State changed (chat, saved settings, bundle list): refill what the user has not edited. */
  refresh(): void;
  stop(): void;
}

export function mountLvForm(root: HTMLElement, host: LvHost): LvForm {
  hostRef = host;
  const bound = new WeakSet<HTMLFormElement>();
  const dirty = new WeakMap<HTMLFormElement, boolean>();
  const chatOf = new WeakMap<HTMLFormElement, string>();
  const bypass = new WeakSet<HTMLFormElement>();
  let stopped = false;

  function setStatus(form: HTMLFormElement, message: string, kind: 'info' | 'error' | 'success' = 'info') {
    const status = form.querySelector<HTMLElement>('[data-tpg-status]');
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function fill(form: HTMLFormElement, force: boolean) {
    const s = host.state();
    const section = form.querySelector('[data-lv-sections]');
    if (!section || !s.ready) return;
    const chatChanged = chatOf.get(form) !== s.chatKey;
    chatOf.set(form, s.chatKey);
    if (chatChanged || force) dirty.set(form, false);
    if (dirty.get(form)) {
      // The user is editing: only the lists that depend on the host are redrawn.
      fillLists(form, s);
      return;
    }
    fillLists(form, s);
    q<HTMLInputElement>(form, 'modelLanguage').value = s.values.modelLanguage;
    q<HTMLInputElement>(form, 'myLanguage').value = s.values.myLanguage;
    q<HTMLInputElement>(form, 'batchChars').value = s.values.batchChars > 0 ? String(s.values.batchChars) : '';
    q<HTMLTextAreaElement>(form, 'excludeRules').value = s.values.excludeRules;
    for (const k of ['autoTranslate', 'translateMyMessages', 'showDraftButton', 'healOffscreen', 'excludeThinking', 'protectHtml', 'protectCode'] as const) q<HTMLInputElement>(form, k).checked = s.values[k];
    const asDefault = form.querySelector<HTMLInputElement>('[name="lv:asDefault"]');
    if (asDefault) asDefault.checked = false;
    // The original paints its switch rows on every form `change`.
    form.dispatchEvent(new Event('change'));
  }

  function fillLists(form: HTMLFormElement, s: LvState) {
    const conn = q<HTMLSelectElement>(form, 'connectionId');
    const wantConn = dirty.get(form) ? conn.value : s.values.connectionId;
    conn.replaceChildren(...s.connections.map(([v, l]) => new Option(l, v)));
    conn.value = wantConn;
    const note = form.querySelector<HTMLElement>('[data-lv-connection-note]')!;
    note.textContent = s.connectionNote.text;
    note.style.color = s.connectionNote.kind === 'err' ? 'var(--destructive)' : '';
    const link = form.querySelector<HTMLElement>('[data-lv-link-note]')!;
    link.hidden = !s.linkNote;
    link.textContent = s.linkNote;
    const bundle = q<HTMLSelectElement>(form, 'bundleId');
    const wantBundle = dirty.get(form) ? bundle.value : s.values.bundleId;
    bundle.replaceChildren(new Option('없음', ''), ...s.bundles.map((b) => new Option(b.name, b.id)));
    bundle.value = s.bundles.some((b) => b.id === wantBundle) ? wantBundle : '';
    syncBundle(form, s);
  }

  function syncBundle(form: HTMLFormElement, s = host.state()) {
    const id = q<HTMLSelectElement>(form, 'bundleId').value;
    const picked = s.bundles.find((b) => b.id === id);
    form.querySelector<HTMLButtonElement>('[data-lv-bundle-edit]')!.disabled = !picked;
    form.querySelector<HTMLButtonElement>('[data-lv-bundle-delete]')!.disabled = !picked;
    const details = form.querySelector<HTMLElement>('[data-lv-bundle-preview]')!;
    details.hidden = !picked;
    if (picked) {
      details.querySelector('summary')!.textContent = `${picked.name} · 내용 보기 (읽기 전용)`;
      details.querySelector<HTMLTextAreaElement>('[data-lv-preview="glossary"]')!.value = picked.glossary;
      details.querySelector<HTMLTextAreaElement>('[data-lv-preview="freeContext"]')!.value = picked.freeContext;
      details.querySelector<HTMLTextAreaElement>('[data-lv-preview="incomingVoicePrompt"]')!.value = picked.incomingVoicePrompt;
    }
  }

  function read(form: HTMLFormElement): LvValues {
    const checked = (n: string) => q<HTMLInputElement>(form, n).checked;
    return {
      connectionId: q<HTMLSelectElement>(form, 'connectionId').value,
      modelLanguage: q<HTMLInputElement>(form, 'modelLanguage').value,
      myLanguage: q<HTMLInputElement>(form, 'myLanguage').value,
      batchChars: Math.max(0, Number.parseInt(q<HTMLInputElement>(form, 'batchChars').value, 10) || 0),
      autoTranslate: checked('autoTranslate'),
      translateMyMessages: checked('translateMyMessages'),
      showDraftButton: checked('showDraftButton'),
      healOffscreen: checked('healOffscreen'),
      excludeThinking: checked('excludeThinking'),
      protectHtml: checked('protectHtml'),
      protectCode: checked('protectCode'),
      excludeRules: q<HTMLTextAreaElement>(form, 'excludeRules').value,
      bundleId: q<HTMLSelectElement>(form, 'bundleId').value,
      voice: host.state().values.voice,
      asDefault: form.querySelector<HTMLInputElement>('[name="lv:asDefault"]')?.checked === true,
    };
  }

  function inject(form: HTMLFormElement) {
    const keepField = form.elements.namedItem('paraKeepTags') as HTMLInputElement | null;
    if (keepField) hideThinkInField(keepField, () => host.state().values.excludeThinking !== false);
    if (form.querySelector('[data-lv-sections]')) return;
    const bar = form.querySelector('.tpg-savebar');
    if (!bar) return; // the original has not finished drawing the form
    const wrap = document.createElement('div');
    wrap.setAttribute('data-lv-sections', '');
    wrap.style.display = 'contents';
    wrap.innerHTML = build(classesFrom(form), host.state().hasChat);
    bar.before(wrap);
    if (!bound.has(form)) {
      bound.add(form);
      form.addEventListener('input', (e) => { if ((e.target as HTMLElement | null)?.closest?.('[data-lv-sections]')) dirty.set(form, true); });
      form.addEventListener('change', (e) => {
        const t = e.target as HTMLElement | null;
        if (!t?.closest?.('[data-lv-sections]')) return;
        dirty.set(form, true);
        if ((t as HTMLInputElement).name === 'lv:bundleId') {
          syncBundle(form);
          previewVoice(form);
        }
      });
      form.addEventListener('click', (e) => {
        const t = (e.target as HTMLElement | null)?.closest?.('button') as HTMLButtonElement | null;
        if (!t || !t.closest('[data-lv-sections]')) return;
        const id = q<HTMLSelectElement>(form, 'bundleId').value;
        if (t.hasAttribute('data-lv-bundle-new')) host.editBundle(null, formGuides(form));
        else if (t.hasAttribute('data-lv-bundle-edit') && id) host.editBundle(id);
        else if (t.hasAttribute('data-lv-bundle-delete') && id) host.deleteBundle(id);
      });
      // Capture phase: before the original's own handler on the same form.
      form.addEventListener('submit', (event) => {
        if (bypass.has(form) || stopped) return;
        const s = host.state();
        if (!s.ready || !form.querySelector('[data-lv-sections]')) return; // nothing of ours to save: the original runs alone
        event.preventDefault();
        event.stopImmediatePropagation();
        void (async () => {
          let plan: TagMove = { rest: '', keep: '', moved: [], stayed: [] };
          let values!: LvValues;
          let voicePlan: RoomVoicePlan | null = null;
          let voiceBefore: { prompt: string; enabled: boolean; voice: RoomVoice } | null = null;
          const keepField = form.elements.namedItem('paraKeepTags') as HTMLInputElement | null;
          const keepBefore = keepField?.value ?? '';
          const button = form.querySelector<HTMLButtonElement>('.tpg-save');
          if (button) {
            button.disabled = true;
            button.textContent = '저장 중';
          }
          setStatus(form, '설정을 저장하고 있습니다.');
          try {
            values = read(form);
            plan = planTagMove(values.excludeRules, keepBefore, values.excludeThinking ? KEEP_TAGS_MAX : 500);
            // 관리자 결정 2026-11-25: the bundle's 대사 지침 goes into the room's own 「대사 지침」 (written by the original's own save, below).
            const vf = voiceFields(form);
            voiceBefore = { prompt: vf.text?.value ?? '', enabled: vf.on?.checked ?? false, voice: values.voice };
            if (vf.text && vf.on) {
              voicePlan = planRoomVoice(values.bundleId, s.bundles, { prompt: vf.text.value, enabled: vf.on.checked }, values.voice);
              values = { ...values, voice: voicePlan.voice };
            }
            // The `<태그>` lines stay in the saved rules for now (they keep working); they leave only after the original has saved the tag list.
            await host.save(values);
          } catch (e) {
            setStatus(form, e instanceof Error && e.message ? e.message : '설정을 저장하지 못했습니다.', 'error');
            if (button) {
              button.disabled = false;
              button.textContent = '저장';
            }
            return;
          }
          const note = form.querySelector<HTMLElement>('[data-lv-tag-moved]');
          const say = (text: string) => {
            if (!note) return;
            note.textContent = text;
            note.hidden = !text;
          };
          say('');
          if (keepField && plan.moved.length) keepField.value = plan.keep;
          const voiceChanged = !!voicePlan && (voicePlan.applied || voicePlan.restored);
          if (voicePlan && voiceChanged) {
            const vf = voiceFields(form);
            if (vf.text && vf.on) {
              vf.text.value = voicePlan.prompt;
              vf.on.checked = voicePlan.enabled;
              vf.on.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          dirty.set(form, false);
          const asDefault = form.querySelector<HTMLInputElement>('[name="lv:asDefault"]');
          if (asDefault) asDefault.checked = false;
          if (button) {
            button.disabled = false;
            button.textContent = '저장';
          }
          // Now the original's own save, unchanged: its button text, its status line, its error handling.
          bypass.add(form);
          try {
            form.requestSubmit();
          } finally {
            bypass.delete(form);
          }
          if (!plan.moved.length && !plan.stayed.length && !voiceChanged) return;
          const result = await savedResult(form);
          if (stopped || !form.isConnected) return;
          if (result !== 'success') {
            // The original did not save: nothing leaves the rules, the fields go back, the bookkeeping of ours is put back, and the form counts as edited again.
            if (keepField && plan.moved.length) keepField.value = keepBefore;
            if (voiceChanged && voiceBefore) {
              const vf = voiceFields(form);
              if (vf.text && vf.on) {
                vf.text.value = voiceBefore.prompt;
                vf.on.checked = voiceBefore.enabled;
                vf.on.dispatchEvent(new Event('change', { bubbles: true }));
              }
              await host.save({ ...values, voice: voiceBefore.voice, asDefault: false }).catch(() => {});
            }
            dirty.set(form, true);
            return;
          }
          if (voicePlan && voiceChanged) {
            const vn = form.querySelector<HTMLElement>('[data-lv-voice-note]');
            const msg = describeVoice(voicePlan, s.bundles.find((b) => b.id === values.bundleId)?.name ?? '', true);
            if (vn) {
              vn.textContent = msg;
              vn.hidden = !msg;
            }
            appendStatus(form, msg);
          }
          const texts: string[] = [];
          if (plan.moved.length) {
            q<HTMLTextAreaElement>(form, 'excludeRules').value = plan.rest;
            texts.push(`${MOVED_NOTICE} (${plan.moved.map((t) => `<${t}>`).join(' ')})`);
            // The tags are saved in the original's list; drop their lines from the saved rules too.
            await host.save({ ...values, excludeRules: plan.rest, asDefault: false }).catch(() => {});
          }
          if (plan.stayed.length) texts.push(stayedNotice(plan.stayed, values.excludeThinking ? KEEP_TAGS_MAX : 500));
          say(texts.join(' '));
          if (plan.moved.length) appendStatus(form, MOVED_NOTICE);
          if (plan.stayed.length) appendStatus(form, stayedNotice(plan.stayed, values.excludeThinking ? KEEP_TAGS_MAX : 500));
        })();
      }, true);
    }
    fill(form, true);
  }

  function scan() {
    if (stopped) return;
    for (const form of Array.from(root.querySelectorAll<HTMLFormElement>('form.tpg-form'))) inject(form);
  }

  const observer = new MutationObserver(() => scan());
  observer.observe(root, { childList: true, subtree: true });
  scan();

  return {
    refresh() {
      for (const form of Array.from(root.querySelectorAll<HTMLFormElement>('form.tpg-form'))) {
        if (form.querySelector('[data-lv-sections]')) fill(form, false);
        else inject(form);
      }
    },
    stop() {
      stopped = true;
      hostRef = null;
      observer.disconnect();
      for (const el of Array.from(root.querySelectorAll('[data-lv-sections]'))) el.remove();
    },
  };
}
