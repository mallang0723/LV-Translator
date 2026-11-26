import { originalUUIDPlugin } from './patches.mjs';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
for (const [entry, target] of [['backend', 'bun'], ['frontend', 'browser']]) {
  const result = await Bun.build({
    entrypoints: [`src/${entry}.ts`],
    outdir: 'dist',
    target,
    banner: `// st_translator ${version}`,
    plugins: entry === 'frontend' ? [originalUUIDPlugin] : [],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  console.log(`Built dist/${entry}.js (${version})`);
}
