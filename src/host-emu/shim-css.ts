// Style stand-in for the host the original was written for. The original relies on Marinara's theme variables and its
// compiled Tailwind utility classes (class names such as `px-3`, `bg-[var(--secondary)]`); Lumiverse has neither.
// This maps the variables to Lumiverse's and defines exactly the utility classes the original's markup uses.
// Nothing here changes the original's markup, wording or layout; it only lets the same markup render.

const SCOPE = '[data-translation-presets-glossary], .tpg-form, .tpg-limit-notice, .ptx-view, .ptx-bar, .ptx-menu, .ptx-toasts, .ptx-modal-root, .ptx-bulk';

const VARS = `
${SCOPE} {
  --border: var(--lumiverse-border, rgba(127,127,127,0.3));
  --foreground: var(--lumiverse-text, inherit);
  --background: var(--lumiverse-bg, Canvas);
  --primary: var(--lumiverse-primary, #7c6cf0);
  --primary-foreground: var(--lumiverse-primary-text, #fff);
  --secondary: var(--lumiverse-fill-subtle, color-mix(in srgb, currentColor 10%, transparent));
  --accent: var(--lumiverse-fill-hover, color-mix(in srgb, currentColor 16%, transparent));
  --muted-foreground: var(--lumiverse-text-muted, color-mix(in srgb, currentColor 65%, transparent));
  --destructive: var(--lumiverse-danger, #ef4444);
  --ring: var(--lumiverse-primary, #7c6cf0);
  --marinara-chat-chrome-panel-bg: var(--background);
  --marinara-chat-chrome-panel-text: var(--foreground);
  --marinara-chat-chrome-panel-border: var(--border);
  --marinara-chat-chrome-panel-divider: var(--border);
  --marinara-chat-chrome-panel-title: var(--foreground);
  --marinara-chat-chrome-panel-muted: var(--muted-foreground);
  --marinara-chat-chrome-highlight-bg-hover: var(--accent);
  --marinara-chat-chrome-highlight-text: var(--foreground);
}`;

/** [class, declarations]; selectors are scoped and escaped below. */
const UTILS: Array<[string, string]> = [
  ['flex', 'display:flex'], ['inline-flex', 'display:inline-flex'], ['block', 'display:block'],
  ['flex-1', 'flex:1 1 0%'], ['shrink-0', 'flex-shrink:0'], ['items-center', 'align-items:center'],
  ['justify-between', 'justify-content:space-between'], ['justify-center', 'justify-content:center'],
  ['gap-1', 'gap:.25rem'], ['gap-1.5', 'gap:.375rem'], ['gap-2', 'gap:.5rem'], ['gap-3', 'gap:.75rem'],
  ['min-w-0', 'min-width:0'], ['w-full', 'width:100%'], ['w-4', 'width:1rem'], ['w-9', 'width:2.25rem'], ['h-4', 'height:1rem'], ['h-5', 'height:1.25rem'],
  ['mt-0.5', 'margin-top:.125rem'], ['mt-2', 'margin-top:.5rem'], ['pt-2', 'padding-top:.5rem'],
  ['p-0.5', 'padding:.125rem'], ['p-1.5', 'padding:.375rem'], ['p-2', 'padding:.5rem'],
  ['px-2', 'padding-left:.5rem;padding-right:.5rem'], ['px-3', 'padding-left:.75rem;padding-right:.75rem'],
  ['py-0.5', 'padding-top:.125rem;padding-bottom:.125rem'], ['py-1.5', 'padding-top:.375rem;padding-bottom:.375rem'],
  ['py-2', 'padding-top:.5rem;padding-bottom:.5rem'], ['py-2.5', 'padding-top:.625rem;padding-bottom:.625rem'],
  ['rounded-md', 'border-radius:.375rem'], ['rounded-lg', 'border-radius:.5rem'], ['rounded-full', 'border-radius:9999px'], ['!rounded-md', 'border-radius:.375rem !important'],
  ['text-xs', 'font-size:.75rem;line-height:1rem'], ['text-[0.625rem]', 'font-size:.625rem'], ['text-[0.6875rem]', 'font-size:.6875rem'], ['text-[0.75rem]', 'font-size:.75rem'],
  ['font-medium', 'font-weight:500'], ['font-semibold', 'font-weight:600'], ['italic', 'font-style:italic'],
  ['leading-relaxed', 'line-height:1.625'], ['text-left', 'text-align:left'], ['truncate', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'],
  ['bg-[var(--secondary)]', 'background-color:var(--secondary)'], ['bg-[var(--border)]', 'background-color:var(--border)'],
  ['bg-[var(--primary)]', 'background-color:var(--primary)'], ['bg-[var(--primary)]/10', 'background-color:color-mix(in srgb,var(--primary) 10%,transparent)'],
  ['bg-[var(--primary)]/70', 'background-color:color-mix(in srgb,var(--primary) 70%,transparent)'], ['bg-[var(--background)]', 'background-color:var(--background)'],
  ['text-[var(--foreground)]', 'color:var(--foreground)'], ['text-[var(--muted-foreground)]', 'color:var(--muted-foreground)'],
  ['text-[var(--primary-foreground)]', 'color:var(--primary-foreground)'], ['text-[var(--marinara-chat-chrome-panel-muted)]', 'color:var(--marinara-chat-chrome-panel-muted)'],
  ['border-t', 'border-top-width:1px;border-top-style:solid'], ['border-[var(--border)]', 'border-color:var(--border)'],
  ['ring-1', 'box-shadow:0 0 0 1px var(--ring-color,var(--border))'], ['ring-transparent', '--ring-color:transparent'], ['ring-[var(--border)]', '--ring-color:var(--border)'],
  ['ring-[var(--primary)]/30', '--ring-color:color-mix(in srgb,var(--primary) 30%,transparent)'],
  ['outline-none', 'outline:none'], ['resize-y', 'resize:vertical'], ['cursor-pointer', 'cursor:pointer'], ['relative', 'position:relative'],
  ['pointer-events-none', 'pointer-events:none'], ['scroll-mt-3', 'scroll-margin-top:.75rem'], ['shadow-sm', 'box-shadow:0 1px 2px rgba(0,0,0,.2)'],
  ['transition-colors', 'transition:background-color .15s,color .15s'], ['transition-opacity', 'transition:opacity .15s'], ['transition-shadow', 'transition:box-shadow .15s'],
  ['transition-transform', 'transition:transform .15s'], ['translate-x-4', 'transform:translateX(1rem)'],
  ['sr-only', 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'],
];

const esc = (c: string) => c.replace(/[!.[\]()/:%]/g, (m) => `\\${m}`);

function utilities(): string {
  const scoped = (sel: string) => SCOPE.split(',').map((s) => `${s.trim()} ${sel}`).join(',');
  const rules = UTILS.map(([c, d]) => `${scoped(`.${esc(c)}`)}{${d}}`);
  const states = [
    scoped('.hover\\:bg-\\[var\\(--accent\\)\\]:hover') + '{background-color:var(--accent)}',
    scoped('.hover\\:text-\\[var\\(--foreground\\)\\]:hover') + '{color:var(--foreground)}',
    scoped('.hover\\:opacity-90:hover') + '{opacity:.9}',
    scoped('.hover\\:bg-\\[var\\(--destructive\\)\\]\\/10:hover') + '{background-color:color-mix(in srgb,var(--destructive) 10%,transparent)}',
    scoped('.hover\\:text-\\[var\\(--destructive\\)\\]:hover') + '{color:var(--destructive)}',
    scoped('.focus\\:ring-\\[var\\(--primary\\)\\]\\/40:focus') + '{box-shadow:0 0 0 1px color-mix(in srgb,var(--primary) 40%,transparent)}',
    scoped('.peer:focus-visible~.peer-focus-visible\\:ring-2') + '{box-shadow:0 0 0 2px var(--ring)}',
    scoped('.mari-chrome-field') + '{background:var(--secondary);border:1px solid var(--border);color:var(--foreground);outline:none}',
    scoped('.mari-accent-animated') + '{}',
    scoped('select, input[type=text], input[type=number], textarea') + '{font:inherit;color:var(--foreground);box-sizing:border-box}',
    scoped('button') + '{font:inherit}',
  ];
  return [...rules, ...states].join('\n');
}

/**
 * Controls of the original that cannot do anything in Lumiverse are hidden (관리자 결정 11-19: 못 쓰는 버튼은 뺀다). The original's markup is
 * not changed: the input stays in its form (it reads as off), only its row is not drawn.
 *   - "후처리 후 번역" (N2): Marinara's post-processing step (`postProcessingPending`) does not exist in Lumiverse.
 */
const HIDDEN = `
.tpg-form [data-tpg-switch]:has(input[name="translateAfterPostProcessing"]) { display: none !important; }`;

export const SHIM_CSS = `${VARS}\n${utilities()}\n${HIDDEN}`;
