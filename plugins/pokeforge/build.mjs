import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
const app = await build({ entryPoints: ['app.mjs'], bundle: true, format: 'esm', write: false, minify: true, metafile: true });
const template = await readFile('index.html', 'utf8');
const css = await readFile('style.css', 'utf8');
await writeFile('dist/index.html', template.replace('/* STYLE */', () => css).replace('/* APP */', () => app.outputFiles[0].text));
const server = await build({ entryPoints: ['server.mjs', 'serve.mjs'], bundle: true, minify: true, platform: 'node', format: 'esm', outdir: 'dist', outExtension: { '.js': '.mjs' }, metafile: true });
// Preserve the licenses of the actual bundled dependencies in the distributable.
const packages = new Set([...Object.keys(app.metafile.inputs), ...Object.keys(server.metafile.inputs)]
  .map(path => path.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean));
const notices = [];
for (const path of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(`${path}/package.json`, 'utf8'));
  const licenses = (await readdir(path)).filter(name => /^(license|licence|copying)(\.|$)/i.test(name)).sort();
  const license = licenses.length ? (await Promise.all(licenses.map(name => readFile(`${path}/${name}`, 'utf8')))).join('\n')
    : await readFile(`licenses/${pkg.name.replace(/^@/, '').replaceAll('/', '-')}.txt`, 'utf8');
  if (!license.trim()) throw new Error(`Empty license: ${pkg.name}`);
  notices.push(`${pkg.name} ${pkg.version}\n${license}`);
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n---\n\n'));
