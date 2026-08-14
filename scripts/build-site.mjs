import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
await cp('client/public', 'dist', { recursive: true });

console.log('Building client bundle...');
const clientBuild = await build({
  entryPoints: ['client/src/main.tsx'],
  bundle: true,
  splitting: true,
  format: 'esm',
  outdir: 'dist/assets',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  loader: {
    '.png': 'file',
    '.jpg': 'file',
    '.jpeg': 'file',
    '.svg': 'file',
  },
  metafile: true,
  entryNames: 'app',
  assetNames: 'asset-[hash]',
});

console.log('Writing site shell...');
const cssEntry = Object.keys(clientBuild.metafile.outputs).find((file) => file.endsWith('.css'));
const html = await readFile('client/index.html', 'utf8');
const siteHtml = html
  .replace(/<script type="module" src="\/src\/main\.tsx"><\/script>/, '<script type="module" src="/assets/app.js"></script>')
  .replace('</head>', `${cssEntry ? `  <link rel="stylesheet" href="/${cssEntry.replace(/^dist\//, '')}">\n` : ''}</head>`);
await writeFile('dist/index.html', siteHtml);
await mkdir('dist/server', { recursive: true });

console.log('Building Sites worker...');
await build({
  entryPoints: ['site/worker.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['worker', 'browser', 'import', 'default'],
  banner: {
    js: 'const process = { env: {} };',
  },
});
console.log('Site build complete.');
