// Verify the installed tarball in an isolated project, not repository imports.
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'tetorica-fm2612-check-'));
try {
  execFileSync(process.execPath, [join(root, 'scripts/build_fm2612_package.mjs')], {cwd: root, stdio: 'inherit'});
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], {
    cwd: join(root, 'dist/fm2612'), encoding: 'utf8',
  }))[0];
  const consumer = join(scratch, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(scratch, packed.filename)], {
    cwd: consumer, stdio: 'inherit',
  });
  const installed = join(consumer, 'node_modules/tetorica-fm2612');
  execFileSync(process.execPath, ['--experimental-vm-modules', join(root, 'scripts/check_synth_package.mjs'), installed], {cwd: consumer, stdio: 'inherit'});
  execFileSync(process.execPath, [join(root, 'scripts/check_web_runtime.mjs'), installed], {cwd: consumer, stdio: 'inherit'});
  await writeFile(join(consumer, 'check.mjs'), `
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {createSoundChip} from 'tetorica-fm2612';
import {YM2612Synth, YM2612DirectTransport} from 'tetorica-fm2612/ym2612synth';
import {YM2151Synth, YM2151DirectTransport} from 'tetorica-fm2612/ym2151synth';
import {NesApuSynth, NesApuDirectTransport} from 'tetorica-fm2612/nesapusynth';
import {Ym2612} from 'tetorica-fm2612/ym2612.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
const chip = await createSoundChip('ym2612');
try {
  assert.ok(chip instanceof Ym2612);
  const transport = new YM2612DirectTransport(chip);
  const synth = new YM2612Synth({transport});
  synth.setPreset(0, FM_PRESETS.sine);
  synth.noteOn(0, 4, 553);
  const {left, right} = transport.generateStereo(4096);
  assert.equal(left.length, 4096);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  assert.ok(left.some(x => Math.abs(x) > 0.001), 'Synth must produce audible PCM');
} finally { chip.dispose(); }
const opmChip = await createSoundChip('ym2151');
try {
  const transport = new YM2151DirectTransport(opmChip);
  const synth = new YM2151Synth({transport});
  synth.setPreset(7, FM_PRESETS.sine);
  synth.noteOn(7, 'A4');
  const pcm = transport.generateStereo(4096);
  assert.ok(pcm.left.every(Number.isFinite) && pcm.left.some(x => Math.abs(x) > .001));
  synth.noteOff(7);
} finally {opmChip.dispose();}
const nesChip = await createSoundChip('nes', {fds: true});
try {
  const synth = new NesApuSynth({transport: new NesApuDirectTransport(nesChip)});
  synth.fds.noteOn('A4');
  const pcm = nesChip.generateStereo(4096);
  assert.ok(pcm.left.every(Number.isFinite) && pcm.left.some(v => Math.abs(v) > .001));
} finally {nesChip.dispose();}
assert.equal(typeof globalThis.AudioContext, 'undefined');
const {MegaSynthNode} = await import('tetorica-fm2612/node');
const nodeSynth = new MegaSynthNode();
assert.equal(nodeSynth.state, 'idle');
await nodeSynth.start();
assert.equal(nodeSynth.state, 'ready');
assert.equal((await nodeSynth.getState()).output, null);
await nodeSynth.fm.setPreset(0, FM_PRESETS.sine);
await nodeSynth.fm.noteOn(0, 4, 553);
const offlineNodePCM = await nodeSynth.render(512);
assert.ok(offlineNodePCM.left.some(value => Math.abs(value) > .001));
await nodeSynth.close();
assert.equal(nodeSynth.state, 'closed');
const {MegaSynth} = await import('tetorica-fm2612/megasynth');
const mega = new MegaSynth();
assert.equal(mega.audioContext, null);
await access(new URL(mega.workletUrl));
await access(new URL(mega.ym2612WasmUrl));
const cd = new MegaSynth({megaCD: true});
assert.equal(cd.pcm, null);
assert.equal(cd.audioContext, null);
await access(new URL(cd.rf5c164WorkletUrl));
await access(new URL(cd.rf5c164WasmUrl));
await access(new URL(cd.segaPsgWasmUrl));
const {createTetoricaSynth} = await import('tetorica-fm2612/tetorica_synth');
assert.equal(createTetoricaSynth({megaCD: true}).capabilities.pcmChannels, 8);
for (const name of ['ym2203synth', 'ym2608synth', 'ym2610bsynth', 'playground_runtime', 'tetorica_audio_runtime', 'vgm_runtime']) {
  await import('tetorica-fm2612/' + name);
}
for (const path of ['ym2612-worklet.js', 'playground_logic_worker.js', 'generated/segapsg_wasm.wasm', 'native_audio_effect.wasm', 'tetorica_ym2608_adpcm_rom.bin']) {
  await access(runtimeAssetUrl(path));
}
await import('tetorica-fm2612/generated/ym2612_wasm.js');
assert.equal(runtimeAssetUrl('ym2612-worklet.js', 'https://example.test/vendor/').href, 'https://example.test/vendor/ym2612-worklet.js');
assert.throws(() => runtimeAssetUrl('../outside.js'), TypeError);
console.log('Installed package verified: module exports, audible Synth PCM, browser entry imports and asset URLs.');
`);
  execFileSync(process.execPath, [join(consumer, 'check.mjs')], {cwd: consumer, stdio: 'inherit'});
  execFileSync(process.execPath, [join(root, 'scripts/check_fm2612_types.mjs'), installed], {cwd: consumer, stdio: 'inherit'});
  console.log(`Tarball: ${packed.size} bytes compressed, ${packed.unpackedSize} bytes unpacked, ${packed.files.length} files.`);
} finally {
  await rm(scratch, {recursive: true, force: true});
}
