import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {generateSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = join(root, 'dist/fm2612');
// Keep the opt-in npm policy in sync with the complete measured Playground baseline.
await generateSoundChipMixerPresets({
  reportPath:join(root, 'docs/issues/playground_chip_levels_01.json'),
  ps1ReportPath:join(root, 'docs/issues/ps1_long_audio_chip_levels_01.json'),
  wonderswanReportPath:join(root, 'docs/issues/wonderswan_chip_levels_deferred_release_01.json'),
  pokeyReportPath:join(root, 'docs/issues/pokey_chip_levels_deferred_release_01.json'),
  outPath:join(root, 'web/soundchip_mixer_presets.js'),check:true,
});
// Only this generated package directory is replaced; the CLI distribution stays intact.
await rm(stage, {recursive: true, force: true});
await mkdir(stage, {recursive: true});
execFileSync(process.execPath, [join(root, 'scripts/copy_full_web_runtime.mjs'), stage], {cwd: root, stdio: 'inherit'});
for (const name of ['package.json', 'README.md', 'package_assets.js']) {
  await cp(join(root, 'packages/fm2612', name), join(stage, name));
}
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'));
await mkdir(join(stage, 'node'), {recursive: true});
for (const name of (await readdir(join(root, 'node'))).filter(name => name.endsWith('.mjs'))) {
  const source = await readFile(join(root, 'node', name), 'utf8');
  await writeFile(join(stage, 'node', name), source.replaceAll("'../web/", "'../").replaceAll('"../web/', '"../'));
}
await cp(join(root, 'node/README.md'), join(stage, 'node/README.md'));

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

// copy_full_web_runtime includes standalone source bundles and component notices.
const sdkPin = JSON.parse(await readFile(join(root, 'third_party/soundchip-sdk.json'), 'utf8'));
const sdkInventory = JSON.parse(await readFile(join(root, 'third_party/tetorica-soundchip-native/catalog/source_inventory.json'), 'utf8'));
const sdkSources = `Fixed SDK ${sdkPin.version}, source commit ${sdkPin.sourceCommit}. The SDK provides ${sdkInventory.artifacts.length} chip WASM recipes and ${sdkInventory.applicationAudio.length} separate application-audio recipes and ${sdkInventory.instruments.length} standalone instrument recipes. Source receipts retain the archive and manifest hashes${sdkPin.localCandidate ? ' and unpublished local-candidate provenance' : ' from the published SDK release'}.\n\n`;
await writeFile(join(stage, 'sources/README.md'), '# Sound-chip source bundles\n\n' + sdkSources + 'See [SegaPSG.md](SegaPSG.md) for the original Tetorica Sega PSG core, BSD notice, hardware-documentation credit and standalone rebuild recipe. Rebuild from this directory with `sh scripts/build_segapsg_wasm.sh ../generated`.\n\nSee [Nuked-OPN2.md](Nuked-OPN2.md) for the fixed SDK sources, provenance and license. Rebuild with `sh scripts/build_nuked_opn2_wasm.sh ../generated`. Emscripten is required; no SDK checkout or Python importer is needed.\n\n[POKEY.md](POKEY.md) describes the BSD POKEY adaptation and original upstream source, with a standalone Emscripten recipe and fixed SDK provenance.\n\n[CDDA.md](CDDA.md) and [MSM5205.md](MSM5205.md) describe the fixed SDK application-audio C/WASM sources, BSD attribution, source receipts and standalone rebuild recipes. These modules are cataloged separately from generic sound-chip IDs. Their recipes also rebuild without an SDK checkout or importer.\n\n[NES-FDS.md](NES-FDS.md), [PWM32X.md](PWM32X.md) and [SNES-SPC.md](SNES-SPC.md) describe the other included source bundles and their respective licenses.\n\n[PS1-SPU.md](PS1-SPU.md) describes the experimental PlayStation SPU port from the fixed SDK, complete BSD source, pristine upstream files and standalone rebuild recipe. This instrument is cataloged separately from the generic sound-chip factory.\n');

// Fail early for missing relative JS dependencies, including Worker/Worklet imports.
for (const name of (await readdir(stage)).filter(n => n.endsWith('.js'))) {
  const source = await readFile(join(stage, name), 'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+\.js(?:\?[^'"]*)?)\1/g)) {
    await readFile(new URL(match[2].split('?')[0], pathToFileURL(join(stage, name))));
  }
}
execFileSync(process.execPath, [join(root, 'scripts/build_fm2612_types.mjs')], {cwd: root, stdio: 'inherit'});
console.log(`Built ${stage}`);
