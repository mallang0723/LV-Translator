// The original Translation Tools 1.10.0's own key functions (src/vendor/tt-1.10.0/personal-extension/extension.js: hashText,
// normalizeForKey, blockKey), written out here because the original keeps them inside its closure. tests/pub.test.ts compares
// them with the vendored file.

export function hashText(str: unknown): string {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function normalizeForKey(s: unknown): string {
  return String(s ?? '')
    .replace(/[“”„‟«»＂]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[*_~`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function blockKey(block: unknown): string {
  return hashText(normalizeForKey(block));
}
