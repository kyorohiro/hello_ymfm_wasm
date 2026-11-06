// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, writeFile, copyFile, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {version as esbuildVersion} from 'esbuild';
import {checkRuntimeArtifacts, copyRuntimeArtifacts} from './runtime_artifacts.mjs';
import {copySidSources} from './copy_sid_sources.mjs';
import {copyReadableModules} from './copy_readable_modules.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const record = bytes => ({bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex')});
async function filesIn(base, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(base, prefix), {withFileTypes:true})) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await filesIn(base, name + '/'));
    else { assert(entry.isFile(), `Unsupported archive entry: ${name}`); result.push(name); }
  }
  return result.sort();
}
function zip(base, target, names) {
  execFileSync('python3', ['-c', String.raw`
import json,sys,zipfile
from pathlib import Path
base=Path(sys.argv[1]); names=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in names:
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
  z.writestr(info,(base/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(sys.argv[2]) as z: assert z.testzip() is None
`, base, target], {input:JSON.stringify(names)});
}
export function validateSidSynthVersion(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(value)) throw new Error('Invalid package version');
  return value;
}
export async function packageSidSynth({version = 'dev', releaseDir = join(root, 'release')} = {}) {
  validateSidSynthVersion(version);
  await checkRuntimeArtifacts({root, ids:['sid'], mirrors:true});
  releaseDir = resolve(releaseDir); await mkdir(releaseDir, {recursive:true});
  const archive = join(releaseDir, `tetorica_sid_synth_${version}_itch.zip`);
  try { await readFile(archive); throw new Error(`Archive already exists: ${archive}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stage = await mkdtemp(join(releaseDir, `itch_sid_synth_${version}-`));
  const browser = await copyReadableModules({root, stage,
    entries:['docs/synth-sid/synth.js', 'docs/synth-sid/processor.js', 'docs/synth-sid/synth.css'], factories:[]});
  const inputs = new Set(browser.inputs), bundles = browser.entries;
  const home = 'https://kyorohiro.github.io/hello_ymfm_wasm/';
  let html = await readFile(join(root, 'docs/synth-sid/index.html'), 'utf8');
  html = html.replace(/\b(href|src)="(\.\.\/[^"#]+)"/g, (_match, attribute, path) => {
    if (path === '../tetorica_sid_synth.webp') return `${attribute}="${path}"`;
    if (attribute === 'href' && path === '../js/sidsynth.js') return 'href="https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/tetorica_src/runtime/sidsynth.js"';
    return `${attribute}="${new URL(path, home + 'synth-sid/').href}"`;
  });
  await writeFile(join(stage, 'synth-sid/index.html'), html);
  await writeFile(join(stage, 'index.html'), html
    .replace(/\b(href|src)="\.\.\/tetorica_sid_synth\.webp"/g, '$1="./tetorica_sid_synth.webp"')
    .replace(/\b(href|src)="\.\/(synth\.(?:css|js))"/g, '$1="./synth-sid/$2"'));
  await copyRuntimeArtifacts({root, destination:join(stage, 'generated'), ids:['sid'], includeMetadata:false});
  await copySidSources(stage);
  await copyFile(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  await copyFile(join(root, 'docs/tetorica_sid_synth.webp'), join(stage, 'tetorica_sid_synth.webp'));
  const guide = (await readFile(join(root, 'docs/synth-sid/README.md'), 'utf8')).replace(/\]\(([^)]+)\)/g, (match, target) => {
    if (/^(?:https?:|#)/.test(target) || target === 'index.html') return match;
    return `](${new URL(target, 'https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/synth-sid/').href})`;
  });
  await writeFile(join(stage, 'synth-sid/README.md'), guide);
  await writeFile(join(stage, 'README.md'), guide + '\n## Included sources\n\nSee [SID native sources and rebuilding](sources/SID.md), [browser build inputs](sources/sid-synth-browser-inputs.zip) and their [hash receipt](sources/sid-synth-browser.json). Runtime JavaScript and CSS retain their authored module layout and comments.\n');
  for (const path of ['docs/synth-sid/index.html', 'docs/synth-sid/README.md', 'docs/tetorica_sid_synth.webp',
    'docs/issues/tetorica_sid_icon_prompt_20261107.txt',
    'LICENSE', 'package.json', 'package-lock.json', 'scripts/package_itch_sid_synth.mjs',
    'scripts/package_itch_sid_synth.sh', 'scripts/copy_sid_sources.mjs', 'scripts/copy_readable_modules.mjs',
    'scripts/runtime_artifacts.mjs', 'scripts/sid_artifacts.mjs']) inputs.add(path);
  const names = [...inputs].sort(), sourceArchive = 'sources/sid-synth-browser-inputs.zip';
  zip(root, join(stage, sourceArchive), names);
  const receipt = {schemaVersion:1, product:'Tetorica SID Synth', productId:'tetorica-sid-synth', version,
    builder:{name:'source-copy', minify:false, bundle:false, dependencyAnalyzer:{name:'esbuild', version:esbuildVersion}},
    bundles, modules:browser.modules,
    originalInputs:await Promise.all(names.map(async path => ({path, ...record(await readFile(join(root, path)))}))),
    sourceArchive:{path:sourceArchive, ...record(await readFile(join(stage, sourceArchive)))}};
  await writeFile(join(stage, 'sources/sid-synth-browser.json'), JSON.stringify(receipt, null, 2) + '\n');
  const namesInStage = await filesIn(stage); assert(namesInStage.length <= 1000, 'itch.io file limit exceeded');
  const temporary = stage + '.zip';
  try { zip(stage, temporary, namesInStage); await copyFile(temporary, archive, constants.COPYFILE_EXCL); await rm(temporary); }
  catch (error) { await rm(temporary, {force:true}); throw error; }
  return {passed:true, stage, archive, files:namesInStage.length, bundles:bundles.length, archiveRecord:record(await readFile(archive))};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/package_itch_sid_synth.mjs [VERSION]');
  console.log(JSON.stringify(await packageSidSynth({version:process.argv[2] ?? 'dev'}), null, 2));
}
