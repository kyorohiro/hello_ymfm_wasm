// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Build a small, self-contained itch.io distribution without changing docs/.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, version as esbuildVersion} from 'esbuild';
import {checkPs1SourceBundle} from './check_ps1_source_bundle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const slash = value => value.split(sep).join('/');
const clean = value => value.replace(/[?#].*$/, '');
const hash = value => createHash('sha256').update(value).digest('hex');
const record = bytes => ({bytes:bytes.length, sha256:hash(bytes)});
const safe = name => typeof name === 'string' && !isAbsolute(name) && !name.split('/').some(value => value === '..' || value === '') && /^[\w./+-]+$/.test(name);

async function copy(source, target) {await mkdir(dirname(target), {recursive:true}); await copyFile(source, target);}
async function filesIn(base, prefix = '') {
  const files = [];
  for (const item of await readdir(join(base, prefix), {withFileTypes:true})) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink()) throw new Error(`Package cannot contain a symlink: ${name}`);
    if (item.isDirectory()) files.push(...await filesIn(base, name));
    else if (item.isFile()) files.push(name);
    else throw new Error(`Unsupported package entry: ${name}`);
  }
  return files.sort();
}
const zipWriter = String.raw`
import json,sys,zipfile
from pathlib import Path
root=Path(sys.argv[1]); names=json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for name in names:
  info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16
  archive.writestr(info,(root/name).read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
with zipfile.ZipFile(sys.argv[2]) as archive:
 if archive.testzip() is not None:raise RuntimeError("ZIP CRC verification failed")
`;
function writeZip(base, output, files) {execFileSync('python3', ['-c', zipWriter, base, output], {input:JSON.stringify(files)});}

export function validateSpuSynthVersion(version) {
  if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version)) throw new Error('Version must contain only letters, numbers, dots, underscores, + or - and start with a letter or number.');
  return version;
}

/** Both root index.html and synth-spu/index.html start the same instrument.
 * The Emscripten factory stays byte-identical and local to generated/. This
 * preserves its browser/Node branches instead of patching generated code. */
export async function packageSpuSynth({version = 'dev', releaseDir = join(root, 'release')} = {}) {
  validateSpuSynthVersion(version);
  releaseDir = resolve(releaseDir);
  await mkdir(releaseDir, {recursive:true});
  const stage = await mkdtemp(join(releaseDir, `itch_spu_synth_${version}-`));
  const archive = join(releaseDir, `tetorica_spu_synth_${version}_itch.zip`);
  const inputs = new Set();
  const bundles = [];
  const entries = ['synth.js', 'spu_synth_worklet.js', 'spu_synth_prepare_worker.js'];
  const generatedFactory = resolve(root, 'docs/generated/ps1_spu_wasm.js');
  for (const name of entries) {
    const outfile = join(stage, 'synth-spu', name);
    const result = await build({absWorkingDir:root, entryPoints:[`docs/synth-spu/${name}`], outfile,
      bundle:true, format:'esm', platform:'browser', target:'es2022', minify:true, keepNames:true,
      legalComments:'linked', metafile:true, write:false, logLevel:'silent', plugins:[{
        name:'preserve-original-local-spu-factory', setup(builder) {
          builder.onResolve({filter:/ps1_spu_wasm\.js(?:[?#]|$)/}, args => {
            const path = resolve(args.resolveDir, clean(args.path));
            assert.equal(path, generatedFactory, 'Only the original local PS1 factory is external');
            return {path:`../generated/ps1_spu_wasm.js${args.path.slice(clean(args.path).length)}`, external:true};
          });
        },
      }]});
    for (const name of Object.keys(result.metafile.inputs)) {assert(safe(clean(name)), `Unsafe bundle input: ${name}`); inputs.add(clean(name));}
    for (const file of result.outputFiles) {
      const name = slash(relative(stage, file.path)); assert(safe(name));
      await mkdir(dirname(file.path), {recursive:true}); await writeFile(file.path, file.contents);
    }
    const output = result.outputFiles.find(file => file.path === outfile); assert(output);
    const outputMetadata = result.metafile.outputs[slash(relative(root, outfile))]; assert(outputMetadata);
    for (const edge of outputMetadata.imports) assert(edge.external && edge.path.startsWith('../generated/ps1_spu_wasm.js'), 'Bundle may only import the local unchanged SPU factory');
    bundles.push({path:`synth-spu/${name}`, ...record(output.contents), inputs:Object.keys(result.metafile.inputs).map(clean).sort(), localImports:outputMetadata.imports.map(edge => edge.path)});
  }

  let html = await readFile(join(root, 'docs/synth-spu/index.html'), 'utf8');
  // These navigation destinations belong to the complete website, not this ZIP.
  html = html.replace('href="../index.html"', 'href="https://kyorohiro.github.io/hello_ymfm_wasm/"')
    .replace('href="../synth/index.html"', 'href="https://kyorohiro.github.io/hello_ymfm_wasm/synth/"')
    .replace('href="../playground/index.html?mode=ps1"', 'href="https://kyorohiro.github.io/hello_ymfm_wasm/playground/?mode=ps1"');
  await writeFile(join(stage, 'synth-spu/index.html'), html);
  await writeFile(join(stage, 'index.html'), html.replace(/\b(href|src)="\.\/(synth\.css|synth\.js|icon\.png)"/g,
    (_, attribute, name) => `${attribute}="./synth-spu/${name}"`));
  for (const name of ['synth.css', 'icon.png']) await copy(join(root, 'docs/synth-spu', name), join(stage, 'synth-spu', name));
  await copy(join(root, 'docs/synth-spu/README.md'), join(stage, 'synth-spu/README.md'));
  inputs.add('docs/synth-spu/README.md');
  await copy(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  for (const name of ['ps1_spu_wasm.js', 'ps1_spu_wasm.wasm', 'ps1_spu_build.json']) await copy(join(root, 'docs/generated', name), join(stage, 'generated', name));

  const receipt = JSON.parse(await readFile(join(root, 'docs/sources/PS1-SPU.json'), 'utf8'));
  for (const file of receipt.files) {
    assert(safe(file.path), `Unsafe source-bundle path: ${file.path}`);
    await copy(join(root, 'docs/sources', file.path), join(stage, 'sources', file.path));
  }
  await copy(join(root, 'docs/sources/PS1-SPU.json'), join(stage, 'sources/PS1-SPU.json'));
  for (const name of ['LICENSE', 'README.md']) await copy(join(root, 'docs/licenses/mame-ps1-spu', name), join(stage, 'licenses/mame-ps1-spu', name));
  const sourceCheck = await checkPs1SourceBundle(stage);

  for (const name of ['docs/synth-spu/index.html', 'docs/synth-spu/synth.css', 'docs/synth-spu/icon.png', 'docs/generated/ps1_spu_wasm.js', 'LICENSE', 'scripts/package_itch_spu_synth.sh', 'scripts/package_itch_spu_synth.mjs']) inputs.add(name);
  const sourceArchive = join(stage, 'sources/spu-synth-browser-inputs.zip');
  const sourceNames = [...inputs].sort();
  writeZip(root, sourceArchive, sourceNames);
  const inputRecords = await Promise.all(sourceNames.map(async path => ({path, ...record(await readFile(join(root, path)))})));
  const packageReceipt = {schemaVersion:1, product:'Tetorica SPU Synth', version,
    builder:{name:'esbuild', version:esbuildVersion, format:'esm', platform:'browser', target:'es2022', minify:true, keepNames:true, legalComments:'linked'},
    bundles, originalInputs:inputRecords, sourceArchive:{path:'sources/spu-synth-browser-inputs.zip', files:sourceNames.length, ...record(await readFile(sourceArchive))},
    unchangedFactory:{path:'generated/ps1_spu_wasm.js', ...record(await readFile(generatedFactory))},
    wasm:{path:'generated/ps1_spu_wasm.wasm', ...record(await readFile(join(stage, 'generated/ps1_spu_wasm.wasm')))},
    sdk:receipt.sdk, sourceCheck};
  await writeFile(join(stage, 'sources/spu-synth-browser.json'), JSON.stringify(packageReceipt, null, 2) + '\n');
  await writeFile(join(stage, 'README.md'), `# Tetorica SPU Synth\n\nPlayStation 1 SPU synthesizer / emulator\n\nServe this directory over HTTPS or localhost and open index.html. AudioWorklet requires a secure context; opening files directly is unsupported. For itch.io, upload the ZIP as an HTML project and select index.html. Enable audio and use the keyboard. All 24 round-robin voices share one instrument. An optional wide software accumulator provides 12 dB mixing headroom, with compensating output gain. Voice registers retain their original precision; compensated dry single-note PCM matches the legacy mixer without the extra rounding noise of reducing voice volume registers. Extreme sums can still reach the original SPU saturation limit. Use the PCM, ADSR, FX and Audio tabs to draw a short waveform, edit its envelope, add reverb or load a recording. Audio accepts up to 32 MiB and 30 minutes. Recordings beyond free SPU RAM automatically use Software audio: shared signed mono PCM in host memory, with SPU Gaussian interpolation, pitch, ADSR, PMON and reverb. This is a software extension beyond PS1 hardware RAM. Long audio is included in version 2 presets. FX also includes Pitch Modulation: a silent Sine, Triangle, Saw or Square source per note, Ratio, Depth and approximate Decay (zero holds). PMON uses 12 pairs of voices; switching On or Off stops current notes. The PCM tab also offers SPU Noise with a shared clock and per-note ADSR; keys trigger envelopes rather than noise pitch. Noise and PMON switch each other off. Changing the sound source stops current notes and keeps the original PCM/audio sample. Software morph in the PCM tab blends two 112-sample cycles (shapes or captured current PCM) with a live A/B slider. This is a Tetorica software feature, not a built-in PS1 SPU effect: the software writes a blended ADPCM cycle into SPU sample memory without retriggering notes. When enabled, Wave A, Wave B and the blended result overlay one canvas in distinct colors. Select A or B to draw that endpoint directly on the same canvas or edit its numeric samples. Disabling keeps the last blend; loading audio disables Morph. Settings are included in presets. The upper Envelope, Waveform and Spectrum views display live output, with Pitch and a second synchronized Morph slider beside the display. Morph holds its value when released; enable it in the PCM tab. This ZIP contains no BIOS, games, or recordings.\n\nThe page, audio worklet, and sample-preparation worker are separately bundled and minified. The original Emscripten factory remains unchanged under generated/. All runtime dependencies are local. Navigation links open the full Tetorica website.\n\nOriginal JavaScript bundle inputs and their hashes are included in sources/spu-synth-browser-inputs.zip and sources/spu-synth-browser.json. SPU C++ source, upstream attribution, licenses, checksums, and a standalone rebuild recipe are included under sources/; see sources/PS1-SPU.md. See LICENSE and licenses/mame-ps1-spu/LICENSE for the respective BSD-3-Clause licenses.\n`);
  const names = await filesIn(stage);
  assert(names.length <= 1000, `itch.io file limit exceeded: ${names.length} > 1000`);
  const temporaryArchive = `${stage}.zip`;
  try {writeZip(stage, temporaryArchive, names); await rename(temporaryArchive, archive);}
  catch (error) {await rm(temporaryArchive, {force:true}); throw error;}
  return {passed:true, stage, archive, files:names.length, bundles:bundles.length, archiveRecord:record(await readFile(archive)), sourceCheck};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/package_itch_spu_synth.mjs [VERSION]');
  console.log(JSON.stringify(await packageSpuSynth({version:process.argv[2] ?? 'dev'}), null, 2));
}
