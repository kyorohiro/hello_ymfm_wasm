import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = join(root, 'dist/fm2612');
// Only this generated package directory is replaced; the CLI distribution stays intact.
await rm(stage, {recursive: true, force: true});
await mkdir(stage, {recursive: true});
execFileSync(process.execPath, [join(root, 'scripts/copy_full_web_runtime.mjs'), stage], {cwd: root, stdio: 'inherit'});
for (const name of ['package.json', 'README.md', 'package_assets.js']) {
  await cp(join(root, 'packages/fm2612', name), join(stage, name));
}
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'));

// These existing defaults are document-relative in the website. In the npm payload,
// resolve them beside their module so embedding pages can live at any URL depth.
const defaults = {
  'megasynth.js': ['./ym2612-worklet.js', './generated/ym2612_wasm.wasm'],
  'playground_runtime.js': ['./ym2610b-worklet.js', './ym2612-worklet.js',
    ...['ym2612', 'ym2203', 'ym2608', 'ym2610b', 'segapsg'].map(n => `./generated/${n}_wasm.wasm`)],
  'ym2203synth.js': ['./ym2203-worklet.js', './generated/ym2203_wasm.wasm'],
  'ym2608synth.js': ['./ym2608-worklet.js', './generated/ym2608_wasm.wasm'],
  'ym2610bsynth.js': ['./ym2610b-worklet.js', './generated/ym2610b_wasm.wasm'],
  'vgm_runtime.js': ['./vgm-output-worklet.js'],
};
for (const [name, paths] of Object.entries(defaults)) {
  let source = await readFile(join(stage, name), 'utf8');
  for (const path of paths) {
    const literal = JSON.stringify(path);
    if (!source.includes(literal)) throw new Error(`Missing expected URL default: ${name}: ${path}`);
    source = source.replaceAll(literal, `new URL(${literal}, import.meta.url).href`);
  }
  await writeFile(join(stage, name), source);
}

// Include the vendored Nuked core, wrapper and build script beside its LGPL notice.
for (const name of ['third_party/nuked-opn2', 'wasm/nuked_opn2_wasm.c', 'scripts/build_nuked_opn2_wasm.sh']) {
  const target = join(stage, 'sources', name);
  await mkdir(join(target, '..'), {recursive: true});
  await cp(join(root, name), target, {recursive: true});
}
await writeFile(join(stage, 'sources/README.md'), '# Nuked-OPN2 source\n\nFrom this directory, run `sh scripts/build_nuked_opn2_wasm.sh` with Emscripten installed. The wrapper and vendored core are included; see third_party/nuked-opn2/README.md for provenance and LICENSE for terms.\n');

// Fail early for missing relative JS dependencies, including Worker/Worklet imports.
for (const name of (await readdir(stage)).filter(n => n.endsWith('.js'))) {
  const source = await readFile(join(stage, name), 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+\.js(?:\?[^'"]*)?)\1/g)) {
    await readFile(new URL(match[2].split('?')[0], pathToFileURL(join(stage, name))));
  }
}
console.log(`Built ${stage}`);
