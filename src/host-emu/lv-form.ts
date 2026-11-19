// The settings this extension adds on top of the original Translation Tools 1.10.0 (connection, languages, my-message
// translation, exclusion rules, guide bundles) live INSIDE the original's own settings form, as sections that use the
// original's markup (its `tpg-group` sections, `UI.*` classes and switch rows), above its save bar. There is one screen and one
// save button: this file hooks the form's `submit` from outside, saves our values first, and then lets the original's own
// submit handler run unchanged (its button text, its status line, its own save). An error of ours is shown in the
// original's status line. The original's code is never edited (scripts/verify-original.mjs); the form is only added to.

export interface LvState {
  ready: boolean;
  /** Chat on screen ('' = none: the new-chat defaults are edited). A change refills the fields. */
  chatKey: string;
  hasChat: boolean;
  values: Omit<LvValues, 'asDefault'>;
  connections: Array<[string, string]>;
  connectionNote: { text: string; kind: '' | 'warn' | 'err' };
  linkNote: string;
  bundles: Array<{ id: string; name: string; glossary: string; freeContext: string }>;
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
  protectHtml: boolean;
  protectCode: boolean;
  excludeRules: string;
  bundleId: string;
  asDefault: boolean;
}

export interface LvHost {
  state(): LvState;
  /** Saves our values. Rejects with the message to show in the original's status line. */
  save(values: LvValues): Promise<void>;
  editBundle(id: string | null): void;
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
        ${switchRow(cls, 'protectHtml', 'HTML 태그·속성, <style>, <script> 는 그대로 두고 글자만 번역')}
        ${switchRow(cls, 'protectCode', '코드 블록(```) 은 번역하지 않음')}
        <p class="${cls.help}">태그 이름으로 빼는 것은 위 「문단 번역」의 「번역에서 제외할 태그」에 적으세요(원작 기능: 번역 요청에 보내지 않고 번역 화면에 원문 그대로 둡니다). 아래 제외 규칙에 &lt;태그&gt; 줄을 적어도 그 태그가 거기에 더해집니다.</p>
        ${field('제외 규칙 (한 줄에 하나)', `<textarea name="lv:excludeRules" class="${cls.textarea}" rows="3" spellcheck="false" placeholder="&lt;status&gt;\n/HP: \\d+\\/\\d+/\n[상태창] ... [/상태창]"></textarea>`)}
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
        <p class="${cls.help}">묶음의 단어집·추가 지침은 내 메시지 번역에 더해집니다(응답 번역의 단어장·기타 지침·말투는 위의 원작 설정에서 합니다). 선택은 아래 저장 버튼으로 적용합니다.</p>
        <details data-lv-bundle-preview hidden><summary class="${cls.help}"></summary>
          <label class="${cls.label}">단어집</label><textarea readonly class="${cls.textarea}" rows="2" data-lv-preview="glossary" placeholder="내용 없음"></textarea>
          <label class="${cls.label}">추가 지침</label><textarea readonly class="${cls.textarea}" rows="2" data-lv-preview="freeContext" placeholder="내용 없음"></textarea>
        </details>
        ${hasChat ? switchRow(cls, 'asDefault', '새 채팅의 기본값으로도 저장', '위 설정을 앞으로 만드는 채팅의 기본값으로도 저장합니다.') : ''}
      </section>`;
}

/** Tag names of the `<tag>` lines of an exclusion-rules text. */
export function tagRuleNames(rules: string): string[] {
  const out: string[] = [];
  for (const line of rules.split(/\r?\n/)) {
    const m = /^\s*<\s*([A-Za-z][\w:.-]*)\s*\/?>\s*$/.exec(line);
    if (m) out.push(m[1]!.toLowerCase());
  }
  return [...new Set(out)];
}

function addKeepTags(form: HTMLFormElement, names: string[]): void {
  const field = form.elements.namedItem('paraKeepTags') as HTMLInputElement | null;
  if (!field || !names.length) return;
  const have = new Set(field.value.split(/[\s,;]+/).map((t) => t.replace(/^<|>$/g, '').toLowerCase()).filter(Boolean));
  const add = names.filter((n) => !have.has(n));
  if (!add.length) return;
  field.value = [field.value.trim(), ...add].filter(Boolean).join(' ');
}

const q = <T extends HTMLElement>(form: HTMLElement, name: string) => form.querySelector<T>(`[name="lv:${name}"]`)!;

export interface LvForm {
  /** State changed (chat, saved settings, bundle list): refill what the user has not edited. */
  refresh(): void;
  stop(): void;
}

export function mountLvForm(root: HTMLElement, host: LvHost): LvForm {
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
    for (const k of ['autoTranslate', 'translateMyMessages', 'showDraftButton', 'healOffscreen', 'protectHtml', 'protectCode'] as const) q<HTMLInputElement>(form, k).checked = s.values[k];
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
      protectHtml: checked('protectHtml'),
      protectCode: checked('protectCode'),
      excludeRules: q<HTMLTextAreaElement>(form, 'excludeRules').value,
      bundleId: q<HTMLSelectElement>(form, 'bundleId').value,
      asDefault: form.querySelector<HTMLInputElement>('[name="lv:asDefault"]')?.checked === true,
    };
  }

  function inject(form: HTMLFormElement) {
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
        if ((t as HTMLInputElement).name === 'lv:bundleId') syncBundle(form);
      });
      form.addEventListener('click', (e) => {
        const t = (e.target as HTMLElement | null)?.closest?.('button') as HTMLButtonElement | null;
        if (!t || !t.closest('[data-lv-sections]')) return;
        const id = q<HTMLSelectElement>(form, 'bundleId').value;
        if (t.hasAttribute('data-lv-bundle-new')) host.editBundle(null);
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
          const button = form.querySelector<HTMLButtonElement>('.tpg-save');
          if (button) {
            button.disabled = true;
            button.textContent = '저장 중';
          }
          setStatus(form, '설정을 저장하고 있습니다.');
          try {
            await host.save(read(form));
          } catch (e) {
            setStatus(form, e instanceof Error && e.message ? e.message : '설정을 저장하지 못했습니다.', 'error');
            if (button) {
              button.disabled = false;
              button.textContent = '저장';
            }
            return;
          }
          // `<태그>` lines of the exclusion rules are tag exclusions: the original's own 「번역에서 제외할 태그」 does them.
          addKeepTags(form, tagRuleNames(q<HTMLTextAreaElement>(form, 'excludeRules').value));
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
      observer.disconnect();
      for (const el of Array.from(root.querySelectorAll('[data-lv-sections]'))) el.remove();
    },
  };
}
