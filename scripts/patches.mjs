// Build-only anchors: pinned vendor files are never written.
export const UUID_PATCHES = ['note', 'custom'].map((prefix) => ({
  id: `uuid-${prefix}`,
  before: 'return `' + prefix + '-${crypto.randomUUID()}`;',
  after: 'return `' + prefix + '-${marinara.newId()}`;',
}));

export const LEGACY_UUID_PATCHES = [{
  id: 'uuid-legacy-note',
  before: UUID_PATCHES[0].before,
  after: 'return `note-${newId(host)}`;',
}];

export function applyAnchors(source, patches) {
  for (const { id, before, after } of patches) {
    if (source.split(before).length !== 2) throw new Error(`Expected exactly one anchor: ${id}`);
    source = source.replace(before, after);
  }
  return source;
}

export const patchOriginal = (source) => applyAnchors(source, UUID_PATCHES);
export const patchLegacyAssembly = (source) => "import { newId } from '../../uuid';\n" + applyAnchors(source, LEGACY_UUID_PATCHES);

export const originalUUIDPlugin = {
  name: 'original-uuid-compat',
  setup(build) {
    build.onLoad({ filter: /[/\\]tt-1\.8\.0[/\\]assembly\.ts$/ }, async ({ path }) => ({
      contents: patchLegacyAssembly(await Bun.file(path).text()),
      loader: 'ts',
    }));
    build.onLoad({ filter: /[/\\]tt-1\.10\.0[/\\]personal-extension[/\\]extension\.js$/ }, async ({ path }) => ({
      contents: `export default ${JSON.stringify(patchOriginal(await Bun.file(path).text()))};`,
      loader: 'js',
    }));
  },
};
