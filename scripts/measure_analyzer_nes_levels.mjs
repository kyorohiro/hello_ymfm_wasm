// Measure the Analyzer's actual JSNES/PAPU output, before Mixer/master/FX.
// Original synthetic single-pulse program; no browser or audio device needed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {NesApuAudioEngine} from '../docs/js/nesapuaudioengine.js';
import {NesApuSynth} from '../web/nesapusynth.js';
import {probeAmplitude} from './soundchip_calibration_metrics.mjs';

const root = new URL('../', import.meta.url);
const baselinePath = 'docs/issues/playground_chip_levels_01.json';
const frequencies = [220, 440, 880];
const clock = 1789773;

function statistics({left, right}) {
  const result = {frames: left.length, nonfinite: 0, minimum: [], maximum: [], dc: [], rms: [], acRms: []};
  for (const channel of [left, right]) {
    let minimum = Infinity, maximum = -Infinity, sum = 0, squares = 0;
    for (const value of channel) {
      if (!Number.isFinite(value)) result.nonfinite++;
      minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
      sum += value; squares += value * value;
    }
    const dc = sum / channel.length, meanSquare = squares / channel.length;
    result.minimum.push(minimum); result.maximum.push(maximum); result.dc.push(dc);
    result.rms.push(Math.sqrt(meanSquare)); result.acRms.push(Math.sqrt(Math.max(0, meanSquare - dc * dc)));
  }
  return result;
}

export function measureAnalyzerNesReference({frequencyHz = 440, sampleRate = 44100, fds = false} = {}) {
  if (!frequencies.includes(frequencyHz) || ![44100, 48000].includes(sampleRate) || typeof fds !== 'boolean') {
    throw new RangeError('Use reference220/440/880Hz, output44,100/48,000Hz and a boolean FDS flag');
  }
  const engine = new NesApuAudioEngine({clock, outputSampleRate: sampleRate, masterVolume: 1, fds});
  const writes = [];
  const transport = {
    clock, fdsEnabled: false, reset: () => engine.reset(),
    writeRegister(address, value) {writes.push({address, value}); engine.writeNesApu(address - 0x4000, value);},
  };
  try {
    // Match buildPcmCalibrationReference('nes'): one pulse, 50% duty, fixed15,
    // sweep disabled, length halt; all other APU/FDS channels remain silent.
    const synth = new NesApuSynth({transport});
    synth.pulse.setVoice(0, {duty: 0.5, volume: 15, sweep: {enabled: false, period: 0, shift: 0, negate: false}});
    const timer = synth.pulse.setFrequency(0, frequencyHz);
    synth.pulse.keyOn(0);
    engine.processFrames(Math.round(sampleRate * 0.2));
    const pcm = engine.processFrames(sampleRate);
    assert.deepEqual(pcm.left, pcm.right);
    const capture = statistics(pcm);
    return {id: 'nesApu', frequencyHz, sampleRate, fds, clock, timer,
      actualFrequencyHz: clock / (16 * (timer + 1)), referencePeak: 1,
      warmupSeconds: 0.2, captureSeconds: 1, writes, pcm: capture, amplitude: probeAmplitude(capture)};
  } finally {engine.dispose();}
}

export async function measureAnalyzerNesLevels() {
  const baseline = JSON.parse(await readFile(new URL(baselinePath, root), 'utf8'));
  assert.equal(baseline.passed, true);
  const targetAmplitude = baseline.calibration.targetAmplitude;
  const rows = [];
  for (const sampleRate of [44100, 48000]) for (const fds of [false, true]) for (const frequencyHz of frequencies) {
    const row = measureAnalyzerNesReference({sampleRate, fds, frequencyHz});
    rows.push({...row, derivedGain: targetAmplitude / row.amplitude});
  }
  const reference = rows.find(row => row.sampleRate === 44100 && !row.fds && row.frequencyHz === 440);
  const gain = Number(reference.derivedGain.toFixed(6));
  assert.ok(gain > 0 && gain <= 2, 'Measured reference must fit the existing Mixer gain range');
  for (const row of rows.filter(row => !row.fds)) {
    assert.deepEqual(row.pcm, rows.find(other => other.sampleRate === row.sampleRate && other.frequencyHz === row.frequencyHz && other.fds).pcm,
      'Enabling a silent FDS expansion must not change this APU reference');
  }
  const wasm = baseline.rows.find(row => row.kind === 'nes' && row.role === 'extra' && row.frequencyHz === 440);
  const names = ['docs/js/nesapuaudioengine.js', 'docs/js/fds_audio.js', 'web/nesapusynth.js',
    'scripts/measure_analyzer_nes_levels.mjs', baselinePath,
    ...(await readdir(new URL('docs/js/nes_apu_vendor/', root))).filter(name => name.endsWith('.js')).map(name => 'docs/js/nes_apu_vendor/' + name)];
  const sources = await Promise.all(names.sort().map(async path => {
    const bytes = await readFile(new URL(path, root));
    return {path, sha256: createHash('sha256').update(bytes).digest('hex')};
  }));
  return {schemaVersion: 1, passed: true, engine: 'Analyzer JavaScript NesApuAudioEngine / JSNES PAPU + optional FDS',
    method: 'Stereo maximum half peak-to-peak, matching the canonical output-unit metric; RMS/DC/AC-RMS also recorded',
    targetAmplitude, maxGain: 2, referenceFrequencyHz: 440, referenceSampleRate: 44100,
    defaults: {nesApu: gain}, sources, rows,
    comparison: {wasmAmplitude: wasm.amplitude, wasmGain: baseline.calibration.routes.find(row => row.kind === 'nes' && row.role === 'extra').volume,
      javascriptToWasmAmplitude: reference.amplitude / wasm.amplitude},
    limitations: [
      'One synthetic pulse at fixed maximum volume; not perceived loudness, polyphony or content normalization.',
      'The canonical Analyzer reference uses its actual default44,100Hz;48,000Hz captures are comparisons only. Runtime sample rates are unchanged.',
      'Pulse frequency quantization, nonlinear APU mixing and analog filtering remain audible; no independent FDS/DMC gain is inferred.',
      'No output Mixer, master-volume trim, FX or AudioContext is used. FDS-enabled rows leave expansion registers silent.',
    ]};
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(argument => !argument.startsWith('--out='))) throw new Error('Usage: node scripts/measure_analyzer_nes_levels.mjs [--out=report.json]');
  const report = await measureAnalyzerNesLevels();
  if (args[0]) {
    const output = resolve(args[0].slice('--out='.length));
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS: Analyzer NES JS gain ${report.defaults.nesApu}; ${report.rows.length} captures; ${output}`);
  } else console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {console.error(error); process.exitCode = 1;});
}
