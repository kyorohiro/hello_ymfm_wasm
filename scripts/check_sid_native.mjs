#!/usr/bin/env node
/** Compare the actual SID Native host and standalone WASM. No device or game data.
 * node scripts/check_sid_native.mjs --work-dir /tmp/sid-check
 * Optional: --fixture EXECUTABLE --wasm FILE --out REPORT.json --wav-dir DIR
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {SidCore, sidFrequency, SID_PAL_CLOCK, SID_NTSC_CLOCK} from '../tetorica_src/runtime/sid.js';

const checker = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(checker), '..');
const options = {};
for (let i = 2; i < process.argv.length; ++i) {
  const [name, ...rest] = process.argv[i].split('=');
  assert(['--work-dir', '--fixture', '--wasm', '--out', '--wav-dir'].includes(name), `Unknown option ${name}`);
  const value = rest.length ? rest.join('=') : process.argv[++i];
  assert(value && !value.startsWith('--'), `${name} requires a value`);
  assert(!Object.hasOwn(options, name), `Duplicate option ${name}`); options[name] = path.resolve(value);
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceNames = [path.relative(root, checker), 'test/helpers/sid_reference.cpp', 'tetorica_src/wasm/sid_core.h',
  'tetorica_src/wasm/sid_wasm.cpp', 'tetorica_src/runtime/sid.js', 'scripts/prepare_sid_core.py',
  'third_party/chips-m6581/m6581.h', 'third_party/chips-m6581/upstream/m6581.h',
  'third_party/chips-m6581/PATCHES.md', 'third_party/chips-m6581/LICENSE'];
const report = {schemaVersion: 1, checker: path.relative(root, checker), deviceOpened: false,
  reference: 'Pinned chips/m6581 with marked Tetorica adaptations and the same SidCore host in Native/WASM.',
  limits: 'Self-authored register sequences; this verifies the port, not 6581 hardware fidelity or .sid playback. WAV is PCM16 export of mono core output, including its software 12 Hz DC blocker.',
  tolerance: 1e-6, rates: [44100, 48000, 96000], clocks: {PAL: SID_PAL_CLOCK, NTSC: SID_NTSC_CLOCK},
  cases: [], totalMonoFrames: 0, maximumDifference: 0, wav: []};

function scenes(rate, clock) {
  const result = [];
  function scene(name, build, expectedReads) {
    const commands = [], w = (reg, value) => commands.push(['w', reg, value]);
    const a = reg => commands.push(['a', reg]);
    const r = frames => { assert(Number.isInteger(frames) && frames >= 0); commands.push(['r', frames]); };
    const voice = (index, hz, control, sustainRelease = 0xc6) => {
      const base = index * 7, frequency = sidFrequency(hz, clock);
      w(base, frequency & 255); w(base + 1, frequency >> 8);
      w(base + 2, 0x34); w(base + 3, 0x08); w(base + 5, 0x05); w(base + 6, sustainRelease); w(base + 4, control);
    };
    const cutoff = value => { w(21, value & 7); w(22, value >> 3); };
    build({w, a, r, voice, cutoff, reset: () => commands.push(['reset'])});
    result.push({name, commands, expectedReads, frames: commands.filter(c => c[0] === 'r').reduce((sum, c) => sum + c[1], 0)});
  }
  scene('waveforms-sync-ring', ({w, a, r, voice}) => {
    w(24, 15); voice(0, 220, 0x11);
    for (const wave of [0x11, 0x21, 0x41, 0x81, 0x71]) { w(4, wave); a(27); a(28); r(rate / 4); }
    voice(2, 89, 0x11); w(24, 0x8f); w(4, 0x23); r(rate / 4);
    w(4, 0x15); r(rate / 4);
    w(4, 0x14); w(18, 0x10); r(rate / 4);
    w(31, 0xa5); a(0); a(28);
  });
  scene('cutoff-resonance-routing', ({w, a, r, voice, cutoff}) => {
    voice(0, 130.81278265, 0x21); voice(1, 164.81377846, 0x21); voice(2, 195.99771799, 0x21);
    w(23, 0xf7);
    const sweepFrames = rate * 7 / 4;
    for (let step = 0; step < 64; ++step) {
      const mode = step < 24 ? 0x10 : step < 44 ? 0x20 : 0x40;
      w(24, mode | 15);
      cutoff(Math.round((step < 32 ? step / 31 : (63 - step) / 31) * 2047));
      if (step === 24) w(23, 0x87);
      if (step === 44) w(23, 0xf5);
      r(Math.floor((step + 1) * sweepFrames / 64) - Math.floor(step * sweepFrames / 64));
    }
    for (let voice = 0; voice < 3; ++voice) w(voice * 7 + 4, 0x20);
    r(rate / 4); a(27); a(28);
  });
  scene('retrigger-reset', ({w, a, r, voice, reset}) => {
    w(24, 15); voice(2, 220, 0x21, 0xff); w(19, 0);
    r(rate / 2); a(28);
    w(18, 0x20); w(18, 0x21); r(rate / 10); a(28);
    w(18, 0x20); w(18, 0x21); r(rate * 3 / 20); a(28);
    reset(); r(rate / 10);
    w(24, 15); voice(0, 330, 0x11); r(rate * 3 / 20);
  }, [255, 0, 255]);
  return result;
}
function runNative(fixture, args, input, maxBuffer = 1024 * 1024) {
  const result = spawnSync(fixture, args, {input, maxBuffer});
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Native fixture failed: ${result.stderr.toString()}`);
  return {pcm: result.stdout, metadata: result.stderr.toString()};
}
function fromFloatBytes(bytes) {
  assert.equal(bytes.length % 4, 0);
  const samples = new Float32Array(bytes.length / 4);
  for (let i = 0; i < samples.length; ++i) samples[i] = bytes.readFloatLE(i * 4);
  return samples;
}
function floatBytes(samples) {
  const bytes = Buffer.alloc(samples.length * 4);
  for (let i = 0; i < samples.length; ++i) bytes.writeFloatLE(samples[i], i * 4);
  return bytes;
}
async function writeWave(file, samples, rate) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  let clippedFrames = 0;
  for (let i = 0; i < samples.length; ++i) {
    if (Math.abs(samples[i]) > 1) ++clippedFrames;
    const value = Math.max(-1, Math.min(1, samples[i]));
    bytes.writeInt16LE(Math.round(value * (value < 0 ? 32768 : 32767)), 44 + i * 2);
  }
  await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, bytes);
  return {file, sha256: sha256(bytes), rate, channels: 1, bitsPerSample: 16, frames: samples.length, clippedFrames};
}

let temporary;
try {
  const work = options['--work-dir'] ?? (temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tetorica-sid-native-')));
  await fs.mkdir(work, {recursive: true});
  const fixture = options['--fixture'] ?? path.join(work, process.platform === 'win32' ? 'sid-reference.exe' : 'sid-reference');
  const wasmFile = options['--wasm'] ?? path.join(root, 'tetorica_src/runtime/generated/sid/sid.wasm');
  report.sources = await Promise.all(sourceNames.map(async file => ({file, sha256: sha256(await fs.readFile(path.join(root, file)))})));
  if (!options['--fixture']) {
    const compiler = process.env.CXX || 'clang++';
    report.nativeCompiler = execFileSync(compiler, ['--version'], {encoding: 'utf8'}).split('\n')[0];
    report.nativeFlags = ['-std=c++17', '-O2', '-ffp-contract=off'];
    execFileSync(compiler, [...report.nativeFlags, path.join(root, 'test/helpers/sid_reference.cpp'), '-o', fixture], {stdio: 'pipe'});
  } else report.nativeFixture = {file: fixture, sha256: sha256(await fs.readFile(fixture))};
  report.nativeSelfTest = runNative(fixture, ['--self-test']).metadata.trim();
  assert(report.nativeSelfTest.includes('SID self-test passed'));
  const wasmBinary = await fs.readFile(wasmFile);
  report.wasm = {file: wasmFile, sha256: sha256(wasmBinary)};
  const wavDirectory = options['--wav-dir'] ?? (options['--work-dir'] ? path.join(work, 'wav') : null);
  for (const rate of report.rates) for (const [region, clock] of Object.entries(report.clocks)) {
    for (const scene of scenes(rate, clock)) {
      const commands = scene.commands.map(command => command.join(' ')).join('\n') + '\n';
      const name = `${scene.name}-${region.toLowerCase()}-${rate}`;
      if (options['--work-dir']) await fs.writeFile(path.join(work, `${name}.commands.txt`), commands);
      const result = runNative(fixture, [String(rate), String(clock)], commands, scene.frames * 4 + 1048576);
      assert.equal(result.pcm.length, scene.frames * 4, `${name}: Native PCM byte count`);
      const native = fromFloatBytes(result.pcm), actual = new Float32Array(scene.frames);
      const nativeState = JSON.parse(result.metadata), reads = [];
      const core = await SidCore.create({sampleRate: rate, clockHz: clock, wasmBinary});
      let offset = 0, state;
      try {
        for (const [operation, first, second] of scene.commands) {
          if (operation === 'w') core.writeRegister(first, second);
          else if (operation === 'a') reads.push(core.readRegister(first));
          else if (operation === 'reset') core.reset();
          else if (operation === 'r') { core.renderInto(actual.subarray(offset, offset + first)); offset += first; }
        }
        state = core.getState();
      } finally { core.dispose(); }
      assert.equal(offset, scene.frames); assert.equal(nativeState.frames, scene.frames);
      assert.deepEqual({cycles: nativeState.cycles, registers: nativeState.registers, voices: nativeState.voices, reads: nativeState.reads},
        {cycles: state.cycles, registers: state.registers, voices: state.voices, reads}, `${name}: chip state or bus reads differ`);
      if (scene.expectedReads) assert.deepEqual(reads, scene.expectedReads, `${name}: envelope regression`);
      let maximumDifference = 0, peak = 0, squared = 0;
      for (let frame = 0; frame < scene.frames; ++frame) {
        assert(Number.isFinite(native[frame]) && Number.isFinite(actual[frame]), `${name}: nonfinite PCM at ${frame}`);
        const difference = Math.abs(native[frame] - actual[frame]);
        maximumDifference = Math.max(maximumDifference, difference); peak = Math.max(peak, Math.abs(native[frame])); squared += native[frame] ** 2;
        assert(difference <= report.tolerance, `${name}: PCM differs at frame ${frame}: Native ${native[frame]}, WASM ${actual[frame]}`);
      }
      assert(peak > 0.01, `${name}: fixture must produce sound`);
      report.cases.push({name: scene.name, region, clockHz: clock, rate, monoFrames: scene.frames, commandsSha256: sha256(commands),
        nativePcmSha256: sha256(result.pcm), wasmPcmSha256: sha256(floatBytes(actual)), maximumDifference, peak, rms: Math.sqrt(squared / scene.frames), finalState: nativeState});
      report.totalMonoFrames += scene.frames; report.maximumDifference = Math.max(report.maximumDifference, maximumDifference);
      if (wavDirectory && rate === 48000 && region === 'PAL' && scene.name !== 'retrigger-reset')
        report.wav.push(await writeWave(path.join(wavDirectory, `${scene.name}.wav`), native, rate));
    }
  }
  const output = options['--out'] ?? (options['--work-dir'] ? path.join(work, 'sid-native-comparison.json') : null);
  if (output) { await fs.mkdir(path.dirname(output), {recursive: true}); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); }
  console.log(`Native SID: ${report.cases.length} cases, ${report.totalMonoFrames} mono frames, maximum PCM difference ${report.maximumDifference} (tolerance ${report.tolerance}); self-tests passed; no device opened.`);
  if (output) console.log(`Report: ${output}`);
  if (report.wav.length) console.log(`WAV: ${report.wav.map(item => item.file).join(', ')}`);
} finally { if (temporary) await fs.rm(temporary, {recursive: true, force: true}); }
