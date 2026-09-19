// Stage a dependency closure, not a second implementation of the analyzer.
import { readFile, writeFile, mkdir, cp, rm, chmod, stat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
await rm(out, { recursive:true, force:true });
const seen = new Set();
async function copy(file) {
  file = resolve(file);
  if (seen.has(file)) return;
  const rel = relative(root, file);
  if (rel.startsWith('..')) throw new Error(`Dependency outside repository: ${file}`);
  if ((await stat(file)).isDirectory()) { await mkdir(resolve(out,rel),{recursive:true}); return; }
  seen.add(file);
  await mkdir(dirname(resolve(out, rel)), {recursive:true});
  await cp(file, resolve(out, rel));
  if (!/\.[cm]?js$/.test(file)) return;
  const source = await readFile(file,'utf8');
  for (const match of source.matchAll(/\b(?:from\s*|import\s*\(?\s*|new\s+URL\s*\(\s*)["']([^"']+)["']/g)) {
    const spec = match[1].split(/[?#]/)[0];
    if (spec.endsWith('/')) { await mkdir(resolve(out, relative(root, resolve(dirname(file),spec))), {recursive:true}); continue; }
    if (spec.startsWith('.')) await copy(resolve(dirname(file),spec));
  }
  if (file.endsWith('_wasm.js')) await copy(file.replace(/\.js$/, '.wasm'));
}
await copy(resolve(root,'cli/main.js'));
// CLI --version works identically in the source tree and staged package.
const pkg = JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
await writeFile(resolve(out,'package.json'), JSON.stringify({type:'module',version:pkg.version})+'\n');
await mkdir(resolve(out,'licenses'),{recursive:true});
for (const name of ['mame-gameboy','mame-ay8910','mame-rf5c164','mame-segapcm']) {
  await cp(resolve(root,`third_party/${name}/LICENSE`),resolve(out,`licenses/${name}.txt`));
}
await chmod(resolve(out,'cli/main.js'),0o755);
console.error(`Staged ${seen.size} dependency files in dist/`);
