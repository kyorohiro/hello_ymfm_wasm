/** Actual Analyzer engines: four original single-voice VGM references, no audio device. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getNodePlaybackFactory} from '../cli/render.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {opnPitchFromHz} from '../docs/js/soundchip_pitch.js';
import {encodeRf5c164} from '../docs/js/rf5c164_pcm.js';
import {createPlaybackEngine, createPlaybackPlayer, selectPlaybackConfiguration} from '../docs/vgm_analyzer/playback_core.js';
import {mixerDefaults} from '../docs/vgm_analyzer/playback_mixer.js';
import {encodeStereoWav, renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
import {SOUNDCHIP_MIXER_PRESETS} from '../docs/js/soundchip_mixer_presets.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const referenceHz = 440, warmupSeconds = .2, captureSeconds = .4, blockFrames = 4096;
const baseline = JSON.parse(await readFile(new URL('../docs/issues/playground_chip_levels_01.json', import.meta.url)));
const targetAmplitude = baseline.calibration.targetAmplitude;
const measured = new Map(SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.map(({name, volume}) => [name, volume]));
const u32 = value => [value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255];

function vgm(commands, clocks) {
  const data = [...commands, 0x61, 0x44, 0xac, 0x66]; // One second on the VGM timeline.
  const bytes = new Uint8Array(256 + data.length), view = new DataView(bytes.buffer);
  bytes.set([86, 103, 109, 32]);
  for (const [offset, value] of [[4, bytes.length - 4], [8, 0x171], [0x18, 44100], [0x34, 0xcc], ...clocks]) view.setUint32(offset, value, true);
  bytes.set(data, 256);
  return bytes;
}

// Same full-level OP4-only reference as soundchip_calibration_fm.mjs.
function fmReference() {
  const commands = [], write = (register, value) => commands.push(0x52, register, value);
  for (const [register, value] of [[0x27, 0], [0x22, 0], [0x2b, 0], [0xb0, 7], [0xb4, 0xc0]]) write(register, value);
  for (const channel of [0, 1, 2, 4, 5, 6]) write(0x28, channel);
  for (const slot of [0, 8, 4, 12]) {
    for (const [register, value] of [[0x30, 1], [0x40, slot === 12 ? 0 : 127], [0x50, 31], [0x60, 0], [0x70, 0], [0x80, 15], [0x90, 0]]) write(register + slot, value);
  }
  const {block, fnum} = opnPitchFromHz(referenceHz, 7670454);
  write(0xa4, block << 3 | fnum >> 8); write(0xa0, fnum & 255); write(0x28, 0x80);
  return commands;
}
function psgReference() {
  const period = Math.round(3579545 / (32 * referenceHz));
  return [0x9f, 0xbf, 0xdf, 0xff, 0x80 | period & 15, period >> 4, 0x90].flatMap(value => [0x50, value]);
}
function rfReference() {
  const wave = encodeRf5c164({sampleRate: referenceHz * 256, channels: [Float32Array.from({length: 256}, (_, i) => Math.sin(2 * Math.PI * i / 256))]});
  return [0x67, 0x66, 0xc1, ...u32(wave.bytes.length + 2), 0, 0, ...wave.bytes,
    ...[[7, 0xc0], [0, 255], [1, 255], [2, wave.step & 255], [3, wave.step >> 8], [4, 0], [5, 0], [6, 0], [8, 0xfe]].flatMap(([register, value]) => [0xb1, register, value])];
}
const genesisClocks = [[0x2c, 7670454], [0x0c, 3579545]];
const routes = [
  {id: 'genesis-fm', source: 'ym2612', kind: 'ym2612', trim: .9, bytes: vgm(fmReference(), genesisClocks)},
  {id: 'genesis-psg', source: 'psg', kind: 'segapsg', trim: .35, bytes: vgm(psgReference(), genesisClocks)},
  {id: 'genesis-rf5c164', source: 'rf5c164', kind: 'rf5c164', trim: 1, bytes: vgm(rfReference(), [...genesisClocks, [0x6c, 12500000]])},
  {id: 'y8950-psg', source: 'psg', kind: 'segapsg', trim: 1, bytes: vgm(psgReference(), [[0x58, 3579545], [0x0c, 3579545]])},
];

function pull(player, frames) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  for (let offset = 0; offset < frames; offset += blockFrames) {
    const count = Math.min(blockFrames, frames - offset);
    player.process(left.subarray(offset, offset + count), right.subarray(offset, offset + count), count);
  }
  return {left, right};
}
function amplitude(pcm, start = 0) {
  return Math.max(...['left', 'right'].map(side => {
    let lo = Infinity, hi = -Infinity;
    for (const value of pcm[side].subarray(start)) {assert(Number.isFinite(value), 'Non-finite PCM'); lo = Math.min(lo, value); hi = Math.max(hi, value);}
    return (hi - lo) / 2;
  }));
}
async function render(route, unity = false) {
  const engine = await createPlaybackEngine(new Ym2612VGM(route.bytes), {getFactory: getNodePlaybackFactory});
  try {
    const configuration = selectPlaybackConfiguration(new Ym2612VGM(route.bytes));
    assert.equal(Boolean(engine.ym2612), route.id.startsWith('genesis-'), `${route.id}: actual source owner`);
    const defaults = engine.playbackMixer.get(route.source);
    assert.deepEqual(defaults, mixerDefaults(route.source, configuration, route.trim));
    assert.equal(defaults.gain, Number((measured.get(route.kind) / route.trim).toFixed(6)));
    for (const id of engine.playbackMixer.strips.keys()) engine.playbackMixer.set(id, {muted: id !== route.source});
    if (unity) engine.playbackMixer.set(route.source, {gain: 1});
    const player = createPlaybackPlayer(engine, route.bytes), rate = player.sampleRate();
    const frames = Math.round((warmupSeconds + captureSeconds) * rate);
    player.stop(); player.play();
    const pcm = pull(player, frames);
    assert(amplitude(pcm) > .005, `${route.id}: source must have audible AC output`);
    player.stop(); player.play();
    assert.deepEqual(pull(player, frames), pcm, `${route.id}: restart/reset must preserve gain exactly`);
    player.stop(); player.play();
    const wav = await renderVgmToWav(player, {maxSeconds: frames / rate, blockFrames});
    assert.deepEqual(wav.bytes, encodeStereoWav(pcm.left, pcm.right, rate), `${route.id}: WAV and live pulls must use the same Mixer once`);
    return {pcm, rate, frames, gain: unity ? 1 : defaults.gain, wavFrames: (wav.bytes.length - 44) / 4};
  } finally {engine.dispose();}
}

const rows = [];
for (const route of routes) {
  const unity = await render(route, true), calibrated = await render(route);
  let error = 0, dot = 0, power = 0;
  for (const side of ['left', 'right']) for (let i = 0; i < unity.frames; i++) {
    const raw = unity.pcm[side][i], sample = calibrated.pcm[side][i];
    error = Math.max(error, Math.abs(sample - raw * calibrated.gain)); dot += sample * raw; power += raw * raw;
  }
  assert(error < 2e-7, `${route.id}: double/applied gain mismatch ${error}`);
  const gainRatio = dot / power;
  assert(Math.abs(gainRatio - calibrated.gain) < 1e-6, `${route.id}: measured gain ratio`);
  const start = Math.round(warmupSeconds * calibrated.rate), outputAmplitude = amplitude(calibrated.pcm, start);
  const relativeTargetError = Math.abs(outputAmplitude / targetAmplitude - 1);
  assert(relativeTargetError < .025, `${route.id}: full reference misses common target by ${relativeTargetError}`);
  rows.push({route: route.id, source: route.source, kind: route.kind, downstreamTrim: route.trim,
    sampleRate: calibrated.rate, frames: calibrated.frames, defaultGain: calibrated.gain, measuredGainRatio: gainRatio,
    maxGainError: error, unityAmplitude: amplitude(unity.pcm, start), calibratedAmplitude: outputAmplitude,
    targetAmplitude, relativeTargetError, restart: 'exact', wav: 'exact', wavFrames: calibrated.wavFrames,
    referenceSha256: createHash('sha256').update(route.bytes).digest('hex')});
}
const paths = ['docs/vgm_analyzer/playback_mixer.js', 'docs/vgm_analyzer/playback_core.js', 'docs/vgm_analyzer/mixer_defaults.js',
  'docs/vgm_analyzer/mixer_calibration_data.js', 'docs/js/soundchip_mixer.js', 'docs/js/soundchip_mixer_presets.js',
  'docs/js/genesisaudioengine.js', 'docs/js/y8950audioengine.js', 'docs/js/vgmplayer.js',
  ...['ym2612', 'segapsg', 'rf5c164', 'y8950'].map(name => `docs/generated/${name}_wasm.wasm`)];
const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')])));
const report = {schemaVersion: 1, passed: true, referenceHz, warmupSeconds, captureSeconds,
  method: 'Original single-voice VGM programs through actual Analyzer engines; fresh-core unity/default PCM ratio, full-level target, exact reset/restart and PCM16 WAV comparisons.',
  limits: 'Four representative ymfm/PSG/RF routes only; no physical output device, perceived-loudness normalization, arbitrary music or polyphony claim. Other chip references are validated separately.',
  sources, rows};
if (process.argv.length > 2) {
  assert.equal(process.argv.length, 4, 'Usage: node scripts/check_analyzer_mixer_levels.mjs [--out report.json]');
  assert.equal(process.argv[2], '--out');
  await writeFile(resolve(process.argv[3]), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(`PASS: ${rows.length} actual Analyzer routes, unity/default PCM ratios, common target, exact restart and WAV; max gain error ${Math.max(...rows.map(row => row.maxGainError))}.`);
