#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Authenticate historical C64 results before deriving corrected phase baselines.
// No original historical JSON is rewritten and no game music/ROM is required.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join, dirname, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {RsidPlayerCore} from '../docs/sid-player/rsid_core.js';
import {validateBrowserPsid} from '../docs/js/sid_psid.js';
import {validateBrowserRsid} from '../docs/js/sid_rsid.js';
import {createPsidCiaFixture} from '../test/helpers/psid_cia_fixtures.mjs';
import {createRsidFixture} from '../test/helpers/rsid_fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = 'test/fixtures/sid-player/';
const helper = 'test/helpers/sid_waveoff_c64_reference.cpp', nativeRoot = 'tetorica_src/wasm/';
const wasmPath = 'tetorica_src/runtime/generated/sid-rsid/sid-rsid.wasm';
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => ({bytes: value.length, sha256: sha(value)});
export const SID_C64_WAVEOFF_BASELINES = Object.freeze([
  {old: 'psid_cia_baseline_004.json', corrected: 'psid_cia_waveoff_baseline_01.json', type: 'psid-cia',
    sha256: '412852e0d74a801ad1b380fe1236ff1eaaf4f1a6df99dfa4e6a219d7ff81347e', wasmSha256: '188bfbf25383233ca6cf820fa1fb753016969c1e76220ab06b3ed7a5c929fe00'},
  {old: 'rsid_baseline_003.json', corrected: 'rsid_waveoff_baseline_01.json', type: 'rsid',
    sha256: '55624da353a718ff5566cb27cc4956469209c53a82defe6b4b3f7c6a8fc4a45d', wasmSha256: '496f32f4bbdf2d788f42124c385da033861852b738147f59b61a338580b91a18'},
  {old: 'cia_relocated_baseline_006.json', corrected: 'cia_relocated_waveoff_baseline_01.json', type: 'psid-cia',
    sha256: 'bd7bd958bae8fd39fd9497417bb9441678c434424f16e1baf16faa97b29177b6', wasmSha256: 'ef6ae771513cea3ec2f6bd6af90c2074c96ac733c5466fdc165a0b5c3480dc4e'},
]);
const pick = (state, reference) => Object.fromEntries(Object.keys(reference).map(key => [key, state[key]]));
const nonPhase = state => ({...state, voices: state.voices.map(({phase, ...voice}) => voice)});
const floatBytes = output => {const bytes = Buffer.alloc(output.length * 4);for (let i = 0; i < output.length; i++) bytes.writeFloatLE(output[i], i * 4);return bytes;};
function compile(directory, work, label) {
  const machine = join(work, label + '-machine.o'), executable = join(work, label + '-c64');
  execFileSync(process.env.CC || 'clang', ['-std=c11', '-O2', '-DNDEBUG', '-ffp-contract=off', '-c', join(directory, nativeRoot + 'sid_rsid_machine.c'), '-o', machine], {stdio: 'pipe'});
  execFileSync(process.env.CXX || 'clang++', ['-std=c++17', '-O2', '-DNDEBUG', '-ffp-contract=off',
    '-DSID_WAVEOFF_C64_HEADER=' + JSON.stringify(join(directory, nativeRoot + 'sid_rsid_core.h')),
    join(root, helper), join(directory, nativeRoot + 'sid_rsid_chip.cpp'), machine, '-o', executable], {stdio: 'pipe'});
  return executable;
}
function startupIntervals(trace) {
  const registers = Array(32).fill(0), start = new Map(), intervals = [];
  for (const {cycle, register, value} of trace.writes) {
    if (register >= 21) continue;const voice = Math.floor(register / 7), base = voice * 7;registers[register] = value;
    const frequency = registers[base] | registers[base + 1] << 8, control = registers[base + 4];
    if (frequency && !(control & 0xf8) && !start.has(voice)) start.set(voice, {voice, firstNonzeroFrequencyCycle: cycle, frequency});
    if ((control & 0xf0) && start.has(voice)) {intervals.push({...start.get(voice), waveformSelectedCycle: cycle, clocks: cycle - start.get(voice).firstNonzeroFrequencyCycle});start.delete(voice);}
  }
  return intervals;
}
async function wasmCapture(bytes, fixture, item, type, addresses) {
  const core = await RsidPlayerCore.create({sampleRate: item.sampleRate, wasmBinary: bytes});
  try {
    core.load(fixture.bytes, type === 'rsid' ? {} : {subtune: 2});
    const output = new Float32Array(item.frames);
    for (let at = 0; at < output.length; at += 128) core.renderInto(output.subarray(at, Math.min(output.length, at + 128)));
    return {pcm: floatBytes(output), state: core.getState(), trace: core.readTrace(), ram: addresses.map(address => [address, core.readRam(address)])};
  } finally {core.dispose();}
}
function nativeCapture(executable, payload, fixture, parsed, item, type, addresses) {
  const args = [payload, item.sampleRate, type === 'rsid' ? 0 : 1, parsed.loadAddress, parsed.initAddress,
    parsed.playAddress ?? 0, parsed.subtune - 1, parsed.driverPage ?? 0, item.frames, 128, ...addresses].map(String);
  const result = spawnSync(executable, args, {maxBuffer: 8 * 1024 * 1024});assert.equal(result.status, 0, result.stderr.toString());
  const observed = JSON.parse(result.stderr);assert.equal(result.stdout.length, item.frames * 4);return {pcm: result.stdout, ...observed};
}
function compareNative(native, wasm, label) {
  assert(native.pcm.equals(wasm.pcm), label + ': Native/WASM Float32 PCM differs');
  assert.deepEqual(native.state, pick(wasm.state, native.state), label + ': Native/WASM machine state differs');
  assert.deepEqual(native.trace, wasm.trace, label + ': Native/WASM trace differs');assert.deepEqual(native.ram, wasm.ram, label + ': Native/WASM RAM differs');
}
function assertHistorical(result, item, fixture, label) {
  assert.equal(sha(result.pcm), item.pcmSha256, label + ': immutable pre-change PCM no longer matches historical record');
  assert.equal(sha(JSON.stringify(result.trace)), item.traceSha256, label + ': historical trace differs');assert.deepEqual(pick(result.state, item.state), item.state, label + ': historical state differs');
  const ram = new Map(result.ram);if (Object.hasOwn(item, 'counter')) assert.equal(ram.get(fixture.counterAddress), item.counter);
  for (const [address, expected] of item.sentinels ?? []) assert.equal(ram.get(address), expected);
}

export async function checkSidWaveoffC64({baselineRoot, workDir, write = false, out} = {}) {
  assert(!write || baselineRoot, 'Corrected baselines can only be written after authenticating an immutable pre-change checkpoint');
  const temporary = !workDir;workDir ??= await mkdtemp(join(tmpdir(), 'tetorica-c64-waveoff-'));await mkdir(workDir, {recursive: true});
  const report = {schemaVersion: 1, passed: false, physicalOutputOpened: false, historicalFilesKept: true, cases: [], baseline: baselineRoot ? resolve(baselineRoot) : null};
  const outputs = [];
  try {
    const native = compile(root, workDir, 'current'), wasm = await readFile(join(root, wasmPath));report.currentWasm = digest(wasm);
    report.nativeCompiler = execFileSync(process.env.CXX || 'clang++', ['--version'], {encoding: 'utf8'}).split('\n')[0];
    report.sources = Object.fromEntries(await Promise.all(['scripts/check_sid_waveoff_c64.mjs', helper,
      nativeRoot + 'sid_rsid_core.h', nativeRoot + 'sid_rsid_machine.c', nativeRoot + 'sid_rsid_chip.cpp',
      'third_party/chips-m6581/m6581.h', 'test/helpers/psid_cia_fixtures.mjs', 'test/helpers/rsid_fixtures.mjs'].map(async file => [file, digest(await readFile(join(root, file)))])));
    let beforeNative, beforeWasm;
    if (baselineRoot) {
      baselineRoot = resolve(baselineRoot);beforeNative = compile(baselineRoot, workDir, 'before');beforeWasm = await readFile(join(baselineRoot, wasmPath));report.beforeWasm = digest(beforeWasm);
      const manifest = JSON.parse(await readFile(join(root, 'docs/issues/sid_waveoff_baseline_01.json')));
      assert.deepEqual(report.beforeWasm, manifest.files[wasmPath], 'Pre-change C64 checkpoint differs from the authenticated capture');
    }
    for (const group of SID_C64_WAVEOFF_BASELINES) {
      const oldPath = fixtureRoot + group.old, oldBytes = await readFile(join(root, oldPath)), old = JSON.parse(oldBytes);
      assert.equal(sha(oldBytes), group.sha256, 'Never rewrite the historical C64 baseline: ' + group.old);assert.equal(old.wasmSha256, group.wasmSha256);
      const expected = write ? null : JSON.parse(await readFile(join(root, fixtureRoot + group.corrected)));
      if (expected) {assert.equal(expected.historicalBaseline.sha256, group.sha256);assert.equal(expected.wasmSha256, sha(wasm));}
      const corrected = {...old, format: 'tetorica-c64-waveoff-corrected-baseline', version: 1, wasmSha256: sha(wasm),
        source: 'Current Native C64 host and checked WASM after the no-wave phase fix; the unmodified earlier record is identified below.',
        historicalBaseline: {path: oldPath, sha256: group.sha256, wasmSha256: group.wasmSha256},
        change: 'No-wave oscillator phase now advances during frequency-before-wave startup; historical CPU trace, envelope and all non-phase state are unchanged.',
        nativeProof: 'docs/issues/sid_waveoff_c64_01.json', cases: []};
      for (let index = 0; index < old.cases.length; index++) {
        const item = old.cases[index], label = group.old + '/' + index, fixture = group.type === 'rsid' ? createRsidFixture(item.profile) : createPsidCiaFixture(item.options);
        assert.equal(sha(fixture.bytes), item.fixtureSha256, label + ': authored input changed');
        const load = group.type === 'rsid' ? {} : {subtune: 2, vbiBackend: 'c64'}, parsed = group.type === 'rsid' ? validateBrowserRsid(fixture.bytes, load) : validateBrowserPsid(fixture.bytes, load);
        const addresses = [...new Set([fixture.counterAddress, ...(fixture.sentinels ?? []).map(([address]) => address), ...(item.sentinels ?? []).map(([address]) => address)])].sort((a, b) => a - b);
        const payload = join(workDir, 'payload.bin');await writeFile(payload, parsed.program);
        const current = await wasmCapture(wasm, fixture, item, group.type, addresses), currentNative = nativeCapture(native, payload, fixture, parsed, item, group.type, addresses);
        compareNative(currentNative, current, label);
        assert.equal(sha(JSON.stringify(current.trace)), item.traceSha256, label + ': phase fix changed historical CPU writes');
        const exact = pick(current.state, item.state);assert.deepEqual(nonPhase(exact), nonPhase(item.state), label + ': phase fix changed a non-phase state field');
        const currentRam = new Map(current.ram);if (Object.hasOwn(item, 'counter')) assert.equal(currentRam.get(fixture.counterAddress), item.counter);
        for (const [address, value] of item.sentinels ?? []) assert.equal(currentRam.get(address), value);
        for (const [address, value] of fixture.sentinels ?? []) assert.equal(currentRam.get(address), value);
        const value = {...item, pcmSha256: sha(currentNative.pcm), state: exact};corrected.cases.push(value);
        if (expected) assert.deepEqual(value, expected.cases[index], label + ': corrected Native/WASM baseline differs');
        const intervals = startupIntervals(current.trace);assert(intervals.length > 0, label + ': affected phase needs a real frequency-before-wave write sequence');
        const row = {historicalFile: oldPath, case: index, sampleRate: item.sampleRate, frames: item.frames, fixtureSha256: item.fixtureSha256,
          historicalPcmSha256: item.pcmSha256, currentPcmSha256: value.pcmSha256, pcmChanged: value.pcmSha256 !== item.pcmSha256,
          historicalPhase: item.state.voices.map(v => v.phase), currentPhase: exact.voices.map(v => v.phase),
          traceSha256: item.traceSha256, cpuTraceUnchanged: true, nonPhaseStateUnchanged: true, ram: current.ram, startupIntervals: intervals, nativeWasmExact: true};
        if (baselineRoot) {
          const before = await wasmCapture(beforeWasm, fixture, item, group.type, addresses), beforeNativeResult = nativeCapture(beforeNative, payload, fixture, parsed, item, group.type, addresses);
          compareNative(beforeNativeResult, before, label + ': before checkpoint');assertHistorical(before, item, fixture, label);
          assert.deepEqual(current.ram, before.ram, label + ': RAM changed');assert.deepEqual(current.trace, before.trace, label + ': complete CPU trace changed');
          row.preChangeCheckpointMatchesHistorical = true;row.preChangeNativeWasmExact = true;
        }
        report.cases.push(row);
      }
      if (expected) assert.deepEqual(expected, corrected, 'Corrected C64 provenance or case inventory differs: ' + group.corrected);
      outputs.push({path: fixtureRoot + group.corrected, bytes: Buffer.from(JSON.stringify(corrected, null, 2) + '\n')});
      assert.equal(sha(await readFile(join(root, oldPath))), group.sha256);
    }
    if (write) for (const output of outputs) await writeFile(join(root, output.path), output.bytes);
    report.correctedBaselines = outputs.map(output => ({path: output.path, ...digest(output.bytes)}));report.passed = true;
    if (out) {await mkdir(dirname(out), {recursive: true});await writeFile(out, JSON.stringify(report, null, 2) + '\n');}
    return report;
  } finally {if (temporary) await rm(workDir, {recursive: true, force: true});}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const key = process.argv[index];if (key === '--write') {options.write = true;continue;}if (key === '--check') continue;
    assert(['--baseline-root', '--work-dir', '--out'].includes(key), 'Unknown C64 waveoff option ' + key);
    const value = process.argv[++index];assert(value && !value.startsWith('--'), 'Missing ' + key);
    options[{'--baseline-root': 'baselineRoot', '--work-dir': 'workDir', '--out': 'out'}[key]] = resolve(value);
  }
  const report = await checkSidWaveoffC64(options);console.log(JSON.stringify({passed: report.passed, cases: report.cases.length,
    preChangeCasesAuthenticated: report.cases.filter(row => row.preChangeCheckpointMatchesHistorical).length, correctedBaselines: report.correctedBaselines.length}));
}
