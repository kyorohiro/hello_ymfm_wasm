// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
// Build a small, self-contained itch.io distribution without changing docs/.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {version as esbuildVersion} from 'esbuild';
import {copyReadableModules} from './copy_readable_modules.mjs';
import {checkPs1SourceBundle} from './check_ps1_source_bundle.mjs';
import {copyPs1Sources} from './copy_ps1_sources.mjs';
import {checkRuntimeArtifacts} from './runtime_artifacts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const record = bytes => ({bytes:bytes.length, sha256:hash(bytes)});

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
  await checkRuntimeArtifacts({root,ids:['ps1_spu','native_audio_effect'],mirrors:true});
  releaseDir = resolve(releaseDir);
  await mkdir(releaseDir, {recursive:true});
  const stage = await mkdtemp(join(releaseDir, `itch_spu_synth_${version}-`));
  const archive = join(releaseDir, `tetorica_spu_synth_${version}_itch.zip`);
  const readable = await copyReadableModules({root, stage,
    entries:['docs/synth-spu/synth.js', 'docs/synth-spu/spu_synth_worklet.js', 'docs/synth-spu/spu_synth_prepare_worker.js', 'docs/synth-spu/synth.css', 'docs/js/native-fx-worklet.js'],
    factories:['docs/generated/ps1_spu_wasm.js','docs/generated/psf-player/psf_player.js']});
  const inputs = new Set(readable.inputs);
  // Retain the three legacy entry records; modules describes the full graph.
  const bundles = readable.entries.slice(0, 3);

  // Monaco fetches declarations by name. The software FX rack also loads its
  // WASM by URL instead of a static import; retain both explicit dependencies.
  for (const name of ['tetorica-playground-globals.d.ts','tetorica-playground-ps1.d.ts','tetorica-shell.d.ts']) {
    const source='docs/playground/'+name;
    await copy(join(root,source),join(stage,'playground',name));inputs.add(source);
  }
  for (const [source,destination] of [['docs/playground/vendor/fflate-LICENSE','playground/vendor/fflate-LICENSE'],['packages/virtual-files/LICENSE','licenses/tetorica-virtual-files/LICENSE']]) {
    await copy(join(root,source),join(stage,destination));inputs.add(source);
  }
  const effectSource='tetorica_src/runtime/generated/effects/gain.wasm',effectPath='js/native_audio_effect.wasm';
  await copy(join(root,effectSource),join(stage,effectPath));inputs.add(effectSource);
  const effectKit='sources/code-effects';
  await mkdir(join(stage,effectKit,'scripts'),{recursive:true});
  await mkdir(join(stage,effectKit,'tetorica_src/native'),{recursive:true});
  await cp(join(root,'tetorica_src/native/audio_effect'),join(stage,effectKit,'tetorica_src/native/audio_effect'),{recursive:true});
  await copy(join(root,'scripts/build_native_audio_effect.sh'),join(stage,effectKit,'scripts/build_native_audio_effect.sh'));
  await copy(join(root,'LICENSE'),join(stage,effectKit,'LICENSE'));
  for (const name of await filesIn(join(root,'tetorica_src/native/audio_effect'))) inputs.add('tetorica_src/native/audio_effect/'+name);
  inputs.add('scripts/build_native_audio_effect.sh');
  await writeFile(join(stage,effectKit,'README.md'),`# Code software effects\n\nThis original Tetorica C effect rack is BSD-3-Clause; see LICENSE. It runs in host software after the SPU, separately from the chip's shared reverb. The editable host is js/native_fx_rack.js and the served WASM is js/native_audio_effect.wasm.\n\nWith Emscripten installed, run from this directory:\n\n\`\`\`sh\nsh scripts/build_native_audio_effect.sh /tmp/tetorica-spu-code-effects\ncp /tmp/tetorica-spu-code-effects/gain.wasm ../../js/native_audio_effect.wasm\n\`\`\`\n\nAn explicit output directory keeps this standalone rebuild independent of repository artifact-sync tools.\n`);

  let html = await readFile(join(root, 'docs/synth-spu/index.html'), 'utf8');
  // These navigation destinations belong to the complete website, not this ZIP.
  html = html.replace('href="../index.html"', 'href="https://kyorohiro.github.io/hello_ymfm_wasm/"')
    .replace('href="../synth/index.html"', 'href="https://kyorohiro.github.io/hello_ymfm_wasm/synth/"')
    .replace('href="../playground/index.html?mode=ps1"', 'href="https://kyorohiro.github.io/hello_ymfm_wasm/playground/?mode=ps1"');
  await writeFile(join(stage, 'synth-spu/index.html'), html);
  await writeFile(join(stage, 'index.html'), html.replace(/\b(href|src)="\.\/((?:synth\.css|synth\.js|icon\.png)(?:\?[^"#]*)?(?:#[^"]*)?)"/g,
    (_, attribute, name) => `${attribute}="./synth-spu/${name}"`));
  await copy(join(root, 'docs/synth-spu/icon.png'), join(stage, 'synth-spu/icon.png'));
  await copy(join(root, 'docs/synth-spu/README.md'), join(stage, 'synth-spu/README.md'));
  inputs.add('docs/synth-spu/README.md');
  await copy(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  const psfKit='sources/psf-player',psfWasm='generated/psf-player/psf_player.wasm';
  await copy(join(root,'docs',psfWasm),join(stage,psfWasm));inputs.add('docs/'+psfWasm);
  await copy(join(root,'docs/generated/psf-player/psf_player.js'),join(stage,'generated/psf-player/psf_player.js'));inputs.add('docs/generated/psf-player/psf_player.js');
  await copy(join(root,'docs/generated/psf-player/NOTICE.txt'),join(stage,'generated/psf-player/NOTICE.txt'));inputs.add('docs/generated/psf-player/NOTICE.txt');
  for(const directory of ['third_party/play-psf','tetorica_src/wasm/psf_player','third_party/tetorica-soundchip-native/vendor/mame-ps1-spu']) {
    await cp(join(root,directory),join(stage,psfKit,directory),{recursive:true});
    for(const name of await filesIn(join(root,directory)))inputs.add(directory+'/'+name);
  }
  await copy(join(root,'scripts/build_psf_player.mjs'),join(stage,psfKit,'scripts/build_psf_player.mjs'));inputs.add('scripts/build_psf_player.mjs');
  await copy(join(root,'LICENSE'),join(stage,psfKit,'LICENSE'));
  await copy(join(root,'third_party/play-psf/License.txt'),join(stage,'licenses/play-psf/License.txt'));
  await copy(join(root,'third_party/play-psf/deps/Framework/License.txt'),join(stage,'licenses/play-psf/Framework-License.txt'));
  await copy(join(root,'third_party/play-psf/deps/CodeGen/License.txt'),join(stage,'licenses/play-psf/CodeGen-License.txt'));
  await writeFile(join(stage,psfKit,'README.md'),`# PSF1 song preview source\n\nThe song machine uses Play!, Framework and CodeGen for PSF1 CPU/HLE under BSD-2-Clause. Their notices, pinned revisions, original hashes and local changes are under third_party/play-psf/. Its active SPU bus and audio use the same fixed MAME-derived DSP sources as the keyboard Synth, under BSD-3-Clause, at third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/. The original DSP files are unchanged. No Sony BIOS or game assets are included. Song rendering uses hardware mixing without the keyboard software headroom or click guard. HLE CPU timing is not cycle-exact; unsupported volume sweeps, 8-byte-only voice addresses and transfer modes fail explicitly.\n\nWith Emscripten installed, run from this directory:\n\n\`\`\`sh\nnode scripts/build_psf_player.mjs --out-dir=/tmp/tetorica-psf-player\ncp /tmp/tetorica-psf-player/psf_player.js ../../generated/psf-player/\ncp /tmp/tetorica-psf-player/psf_player.wasm ../../generated/psf-player/\n\`\`\`\n\nThe editable browser loader and transport are ../../synth-spu/psf_playback_core.js and ../../synth-spu/psf_song_preview.js. Reload the served page after changing JavaScript; rebuild WASM after changing C++.\n`);
  await copyPs1Sources(stage);
  const receipt = JSON.parse(await readFile(join(stage, 'sources/PS1-SPU.json'), 'utf8'));
  const sourceCheck = await checkPs1SourceBundle(stage);

  for (const name of ['docs/synth-spu/index.html', 'docs/synth-spu/synth.css', 'docs/synth-spu/icon.png', 'tetorica_src/runtime/generated/ps1_spu_wasm.js', 'LICENSE', 'scripts/package_itch_spu_synth.sh', 'scripts/package_itch_spu_synth.mjs', 'scripts/copy_readable_modules.mjs', 'scripts/copy_ps1_sources.mjs', 'scripts/runtime_artifacts.mjs', 'scripts/wasm_sdk_inventory.mjs']) inputs.add(name);
  const sourceArchive = join(stage, 'sources/spu-synth-browser-inputs.zip');
  const sourceNames = [...inputs].sort();
  writeZip(root, sourceArchive, sourceNames);
  const inputRecords = await Promise.all(sourceNames.map(async path => ({path, ...record(await readFile(join(root, path)))})));
  const packageReceipt = {schemaVersion:1, product:'Tetorica SPU Synth', version,
    builder:{name:'source-copy', minify:false, bundle:false, dependencyAnalyzer:{name:'esbuild', version:esbuildVersion}},
    bundles, modules:readable.modules, originalInputs:inputRecords, sourceArchive:{path:'sources/spu-synth-browser-inputs.zip', files:sourceNames.length, ...record(await readFile(sourceArchive))},
    unchangedFactory:{path:'generated/ps1_spu_wasm.js', ...record(await readFile(join(stage,'generated/ps1_spu_wasm.js')))},
    wasm:{path:'generated/ps1_spu_wasm.wasm', ...record(await readFile(join(stage, 'generated/ps1_spu_wasm.wasm')))},
    codeEffects:{artifact:{path:effectPath,...record(await readFile(join(stage,effectPath)))},sourceRoot:effectKit,recipe:effectKit+'/scripts/build_native_audio_effect.sh'},
    psfPlayer:{engine:'Play! PSF1 HLE + MAME PS1 SPU',abi:2,spu:{sourceRoot:psfKit+'/third_party/tetorica-soundchip-native/vendor/mame-ps1-spu',license:'BSD-3-Clause',sdkVersion:receipt.sdk.version,files:await Promise.all(['spu.cpp','spu.h','spu_tables.cpp','spureverb.cpp','spureverb.h','standalone_support.h','LICENSE'].map(async name=>({path:name,...record(await readFile(join(root,'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu',name)))})))},artifact:{path:psfWasm,...record(await readFile(join(stage,psfWasm)))},sourceRoot:psfKit,recipe:psfKit+'/scripts/build_psf_player.mjs',provenance:JSON.parse(await readFile(join(root,'third_party/play-psf/provenance.json'),'utf8'))},
    sdk:receipt.sdk, sourceCheck};
  await writeFile(join(stage, 'sources/spu-synth-browser.json'), JSON.stringify(packageReceipt, null, 2) + '\n');
  await writeFile(join(stage, 'README.md'), `# Tetorica SPU Synth\n\nPlayStation 1 SPU synthesizer / emulator\n\nServe this directory over HTTPS or localhost and open index.html. AudioWorklet requires a secure context; opening files directly is unsupported. For itch.io, upload the ZIP as an HTML project and select index.html. Enable audio and use the keyboard. All 24 round-robin voices share one instrument. An optional wide software accumulator provides 12 dB mixing headroom, with compensating output gain. Voice registers retain their original precision; compensated dry single-note PCM matches the legacy mixer without the extra rounding noise of reducing voice volume registers. Extreme sums can still reach the original SPU saturation limit. Use the PCM, ADSR, FX, Audio and PSF / VAB tabs to draw a short waveform, edit its envelope, add reverb or load a recording. The PSF / VAB tab opens standard Sony VAB v6/v7 or matching VH + VB files, and statically extracts contiguous VAB banks and uniquely matched separated VH / VB from PSF1/MiniPSF sets with their PSFLib dependencies. Split bodies require full coverage and exact sample / END boundaries; ambiguous candidates are rejected. Split pairing is inferred from sample structure rather than original driver transfers; the bank label shows matched VB and the instrument should be compared with its source song. After opening a PSF folder or file set, the PSF song list and playback controls appear above Envelope / Waveform / Spectrum, showing the folder and relative song paths. Related PSFLib files remain dependencies. Choose a song above the monitor and Extract VAB beside Play / Pause / Stop; this opens the PSF / VAB Bank / Tone list. Select a bank and Tone, Load selected Tone, then Save to presets to keep that sound in Files. Library-only sets are labelled Library and support extraction with song playback disabled. Extract ZIP archives first. Unavailable Tones show a reason, an available count and an expandable reason list. A single loop-start marker in a one-shot sample is accepted without rewriting its ADPCM bytes; the END Repeat flag controls looping. The selected PSF1 / MiniPSF can also Play song, Pause / Resume and Stop song using a separate Play! CPU / HLE machine with the same fixed MAME-derived SPU DSP as the Synth. No external BIOS is needed. Song ADPCM, Gaussian interpolation, ADSR, Noise, PMON, main / reverb output volumes and shared reverb use that DSP, with hardware mixing and no keyboard software click guard. CPU execution remains HLE with basic-block timing, not cycle-exact PS1 emulation. Unsupported volume sweeps, 8-byte-only voice addresses and transfer modes fail explicitly. The existing keyboard SPU is unchanged. Your edited instrument is kept. Keyboard, Code or instrument edits stop the song; Master and monitor share the editor audio bus. Song CH Live / Capture, seeking, PSF2, ambiguous or padded split VH / VB layouts, custom and runtime-packed banks are unsupported. Audio accepts up to 32 MiB and 30 minutes. Recordings beyond free SPU RAM automatically use Software audio: shared signed mono PCM in host memory, with SPU Gaussian interpolation, pitch, ADSR, PMON and reverb. This is a software extension beyond PS1 hardware RAM. Long audio is included in version 2 presets. FX also includes Pitch Modulation: a silent Sine, Triangle, Saw or Square source per note, Ratio, Depth and approximate Decay (zero holds). PMON uses 12 pairs of voices; switching On or Off stops current notes. The PCM tab also offers SPU Noise with a shared clock and per-note ADSR; keys trigger envelopes rather than noise pitch. Noise and PMON switch each other off. Changing the sound source stops current notes and keeps the original PCM/audio sample. Software morph in the PCM tab blends two 112-sample cycles (shapes or captured current PCM) with a live A/B slider. This is a Tetorica software feature, not a built-in PS1 SPU effect: the software writes a blended ADPCM cycle into SPU sample memory without retriggering notes. When enabled, Wave A, Wave B and the blended result overlay one canvas in distinct colors. Select A or B to draw that endpoint directly on the same canvas or edit its numeric samples. Disabling keeps the last blend; loading audio disables Morph. Settings are included in presets. The upper Envelope, Waveform and Spectrum views display live output, with Pitch and a second synchronized Morph slider beside the display. Morph holds its value when released; enable it in the PCM tab. The Keyboard / Code tabs share this same SPU and current instrument. Code uses await useSoundChip("ps1") with explicit physical channels, liveLoop, livePrepare, tween and host software liveFx. Save to presets beside Instrument name and Save sound in Files add /presets/<instrument name>.spu.json, including the sample and settings. Existing files are kept with a numbered suffix for duplicate names. Saving opens Files; select a saved sound JSON to restore it. Opening or extracting a bank does not automatically save all Tones. Files retains code, modules, opaque data and portable SPU sound presets; importing or restoring a project never runs code or starts audio. The Code Live view observes the selected channel without replacing the authored instrument. Stop restores its samples and settings. This ZIP contains no BIOS, games, or recordings.\n\nThe live JavaScript and CSS are copied byte-for-byte from the authored modules, preserving comments, names and relative imports. They are not bundled or minified: edit the files in synth-spu/, js/, synth/ or playground/ and reload the served page without a JavaScript build step. The same frontend tree can be imported into a Tauri application; rebuild that application after changing its packaged assets. The original Emscripten factory and WASM remain unchanged under generated/; the native-generated loader may retain its compact upstream formatting. Audio runtime dependencies are local. Monaco uses its pinned public CDN and falls back to the local textarea if unavailable. Navigation links open the full Tetorica website.\n\nOriginal browser inputs and the packaging recipe are included in sources/spu-synth-browser-inputs.zip. sources/spu-synth-browser.json records each live module, its original source path, hash and local imports. SPU C++ source, upstream attribution, licenses, checksums, and a standalone rebuild recipe are included under sources/; see sources/PS1-SPU.md. See LICENSE and licenses/mame-ps1-spu/LICENSE for the respective BSD-3-Clause licenses. The separate PSF1 player includes readable Play!, Framework and CodeGen sources under sources/psf-player/ with BSD-2-Clause notices and provenance, together with the unchanged MAME SPU DSP sources under BSD-3-Clause and a standalone Emscripten rebuild recipe. See licenses/play-psf/ and licenses/mame-ps1-spu/LICENSE.\n`);
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
