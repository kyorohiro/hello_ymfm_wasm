// Stage a dependency closure, not a second implementation of the analyzer.
import { readFile, writeFile, mkdir, cp, rm, chmod, stat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyOpnaRhythm } from './copy_opna_rhythm.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/vgm');
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
  let source = await readFile(file,'utf8');
  const entryPoint = file === resolve(root, 'cli/main.js');
  if (entryPoint) {
    // Source uses its own package manifest; the installed CLI reads the staged root manifest.
    const versionSource = "new URL('../packages/vgm/package.json', import.meta.url)";
    if (!source.includes(versionSource)) throw new Error('CLI package version reference changed; update the staging rewrite');
    source = source.replace(versionSource, "new URL('../package.json', import.meta.url)");
    await writeFile(resolve(out, rel), source);
  }
  for (const match of source.matchAll(/\b(?:from\s*|import\s*\(?\s*|new\s+URL\s*\(\s*)["']([^"']+)["']/g)) {
    const spec = match[1].split(/[?#]/)[0];
    if (entryPoint && spec === '../package.json') continue;
    if (spec.endsWith('/')) { await mkdir(resolve(out, relative(root, resolve(dirname(file),spec))), {recursive:true}); continue; }
    if (spec.startsWith('.')) await copy(resolve(dirname(file),spec));
  }
  if (file.endsWith('_wasm.js')) await copy(file.replace(/\.js$/, '.wasm'));
}
await copy(resolve(root,'cli/main.js'));
await copyOpnaRhythm(out, 'web');
// CLI --version works identically in the source tree and staged package.
const pkg = JSON.parse(await readFile(resolve(root,'packages/vgm/package.json'),'utf8'));
await writeFile(resolve(out,'package.json'), JSON.stringify(pkg,null,2)+'\n');
await cp(resolve(root,'packages/vgm/README.md'),resolve(out,'README.md'));
for (const name of ['CLI.md','LICENSE']) await cp(resolve(root,name),resolve(out,name));
await mkdir(resolve(out,'licenses'),{recursive:true});
for (const name of ['mame-huc6280','mame-okim6258','mame-okim6295','mame-gameboy','mame-ay8910','mame-rf5c164','mame-segapcm','mame-32x-pwm','mame-k051649']) {
  await cp(resolve(root,`third_party/${name}/LICENSE`),resolve(out,`licenses/${name}.txt`));
}
await cp(resolve(root,'third_party/jsnes'),resolve(out,'licenses/jsnes'),{recursive:true});
await chmod(resolve(out,'cli/main.js'),0o755);
console.error(`Staged ${seen.size} dependency files in dist/vgm/`);

await cp(resolve(root,'third_party/fixnes-fds'),resolve(out,'licenses/fixnes-fds'),{recursive:true});
