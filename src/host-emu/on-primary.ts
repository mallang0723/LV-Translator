// The original draws its save button as `bg-[var(--primary)] text-[var(--primary-foreground)]`. Lumiverse has no "text on the
// primary colour" variable that always fits: `--lumiverse-primary-text` is a light tint meant for text on the DARK page (it is
// nearly the primary colour itself), and `--lumiverse-primary-contrast` is only set by some themes. With a light primary the
// label came out light on light, which is a button with no label.
// So the text colour is picked from the primary colour actually in use: the darker or the lighter of two, whichever reads better.
// It is published as `--lvtr-on-primary` on <html> (shim-css.ts reads it after `--lumiverse-primary-contrast`).

const VAR = '--lvtr-on-primary';

type Rgb = [number, number, number];

function toRgb(css: string): { rgb: Rgb; a: number } | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const c = canvas.getContext('2d', { willReadFrequently: true });
    if (!c) return null;
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = '#000';
    c.fillStyle = css;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
    return { rgb: [r!, g!, b!], a: (a ?? 255) / 255 };
  } catch {
    return null;
  }
}

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrastRatio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** The label colour that reads best on `bg` (primary composited over the page background when it is translucent). */
export function pickOnColor(bg: Rgb): string {
  return contrastRatio(bg, [255, 255, 255]) >= contrastRatio(bg, [17, 17, 20]) ? '#ffffff' : '#111114';
}

function resolved(property: string, fallback: string): { rgb: Rgb; a: number } | null {
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;background-color:var(${property}, ${fallback})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return toRgb(value);
}

export function updateOnPrimary(): string | null {
  const primary = resolved('--lumiverse-primary', '#7c6cf0');
  if (!primary) return null;
  let bg = primary.rgb;
  if (primary.a < 1) {
    const page = resolved('--lumiverse-bg', '#1b1b22')?.rgb ?? [27, 27, 34];
    bg = [0, 1, 2].map((i) => Math.round(primary.rgb[i]! * primary.a + page[i]! * (1 - primary.a))) as Rgb;
  }
  const color = pickOnColor(bg);
  document.documentElement.style.setProperty(VAR, color);
  return color;
}

/** Keeps the colour current while the theme changes. Returns the stop function. */
export function watchOnPrimary(): () => void {
  if (typeof document === 'undefined' || !document.body) return () => {};
  let queued = false;
  const run = () => {
    queued = false;
    updateOnPrimary();
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    setTimeout(run, 50);
  };
  run();
  const observer = new MutationObserver(queue);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-glass'] });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', queue);
  const timer = setInterval(run, 5000);
  return () => {
    observer.disconnect();
    media?.removeEventListener?.('change', queue);
    clearInterval(timer);
    document.documentElement.style.removeProperty(VAR);
  };
}
