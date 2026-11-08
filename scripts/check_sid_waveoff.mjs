#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Independent integer phase oracle + observation-only native probe + real
// Native/WASM PCM comparison. No reference-engine code or third-party music.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';
import {SidCore} from '../tetorica_src/runtime/sid.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const headerPath = 'third_party/chips-m6581/m6581.h';
const rawProbePath = 'test/helpers/sid_waveoff_reference.cpp';
const hostProbePath = 'test/helpers/sid_reference.cpp';
const wasmPath = 'tetorica_src/runtime/generated/sid/sid.wasm';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = bytes => ({bytes: bytes.length, sha256: sha(bytes)});
const integer = (value, max, label) => {if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(label);return value;};
const voices = () => Array.from({length: 3}, () => ({frequency: 0, phase: 0, control: 0, rising: false}));

/** Independently computed 24-bit accumulator step. Gate and waveform selection
 * do not occur in this arithmetic. TEST holds the accumulator. The simultaneous
 * source-edge snapshot prevents cascading resets in a three-oscillator chain.
 * Values are integer bus/register units; no chip output is read to make these
 * expected phases. See MOS6581 datasheet CONTROL descriptions, printed page4.
 */
export function advanceSidPhase(input) {
  const next = input.map(value => {
    const phase = value.control & 8 ? value.phase : (value.phase + value.frequency) % 0x1000000;
    return {...value, phase, rising: !(value.control & 8) && value.phase < 0x800000 && phase >= 0x800000};
  });
  return next.map((value, target) => {
    const source = (target + 2) % 3, sourceSource = (source + 2) % 3;
    const reset = (value.control & 2) && next[source].rising && !((next[source].control & 2) && next[sourceSource].rising);
    return {...value, phase: reset ? 0 : value.phase};
  });
}
function busWrite(state, register, value) {
  if (register >= 21) return;
  const voice = state[Math.floor(register / 7)], field = register % 7;
  if (field === 0) voice.frequency = (voice.frequency & 0xff00) | value;
  else if (field === 1) voice.frequency = value * 256 | (voice.frequency & 255);
  else if (field === 4) {
    if ((value & 8) && !(voice.control & 8)) voice.phase = 0;
    voice.control = value;
  }
}
const phaseView = (state, cycles) => ({cycles, phase: state.map(v => v.phase), rising: state.map(v => v.rising), control: state.map(v => v.control)});
function phaseSteps(state, count) {for (let i = 0; i < count; i++) state = advanceSidPhase(state);return state;}

export function rawPhaseScenarios() {
  const cases = [], add = (name, initial, operations, {ringVoice = null, decayVoice = null} = {}) => {
    cases.push({name, initial, operations, ringVoice, decayVoice});
  };
  const initial = () => voices().map((v, i) => ({...v, frequency: 0x123 + i * 73, phase: 0x110000 + i * 0x100000, control: 0x20, wave: 0}));
  for (let source = 0; source < 3; source++) for (const gate of [0, 1]) {
    const state = initial();state[source] = {...state[source], phase: 0x7ffff0, frequency: 0x531, control: gate, wave: 0xabc};
    add(`waveoff-phase-v${source + 1}-gate${gate}`, state, Array.from({length: 24}, () => ['tick', 1, 'observe']));
    const wrapping = initial();wrapping[source] = {...wrapping[source], phase: 0xffffe0, frequency: 0xfffd, control: gate};
    add(`waveoff-wrap-v${source + 1}-gate${gate}`, wrapping, Array.from({length: 24}, () => ['tick', 1, 'observe']));
    const paired = initial(), target = (source + 1) % 3;
    paired[source] = {...paired[source], phase: 0x7fffff, frequency: 1, control: gate};paired[target].control |= 2;
    add(`sync-from-waveoff-v${source + 1}-gate${gate}`, paired, [['tick', 1, 'observe'], ['tick', 1, 'observe'], ['tick', 61, 'observe']]);
    const held = initial();held[source] = {...held[source], phase: 0x7fffff, frequency: 1, control: gate};held[target].control |= 2;
    add(`test-edge-hold-release-v${source + 1}-gate${gate}`, held,
      [['write', source * 7 + 4, gate | 8, 'observe'], ['tick', 10, 'observe'], ['write', source * 7 + 4, gate, 'observe'], ['tick', 257, 'observe']]);
  }
  for (const control of [2, 3]) {
    add(`simultaneous-source-suppression-gate${control & 1}`, voices().map(v => ({...v, frequency: 1, phase: 0x7fffff, control, wave: 0})), [['tick', 1, 'observe'], ['tick', 17, 'observe']]);
  }
  for (let target = 0; target < 3; target++) {
    const state = initial(), source = (target + 2) % 3;
    state[source] = {...state[source], phase: 0x900000, frequency: 7, control: 0, wave: 0xabc};
    state[target] = {...state[target], phase: 0x110000, frequency: 31, control: 0x15};
    add(`triangle-ring-source-waveoff-v${target + 1}`, state, Array.from({length: 16}, () => ['tick', 1, 'observe']), {ringVoice: target});
    const decay = initial();decay[target] = {...decay[target], phase: 0x654321, frequency: 12345, control: 0, wave: 0xfff};
    add(`output-latch-decay-v${target + 1}`, decay, Array.from({length: 14}, () => ['tick', 1, 'observe']), {decayVoice: target});
  }
  return cases;
}
function rawCommands(scene) {
  const lines = scene.initial.map((v, i) => `seed ${i} ${v.frequency} ${v.phase} ${v.control} ${v.wave}`);
  for (const command of scene.operations) {
    const observe = command.at(-1) === 'observe', fields = observe ? command.slice(0, -1) : command;
    lines.push(fields.join(' '));if (observe) lines.push('observe');
  }
  return lines.join('\n') + '\n';
}
function rawExpected(scene) {
  let state = structuredClone(scene.initial), cycles = 0;const observations = [];
  for (const command of scene.operations) {
    if (command[0] === 'tick') {state = phaseSteps(state, command[1]);cycles += command[1];}
    else if (command[0] === 'write') {state = phaseSteps(state, 1);cycles++;busWrite(state, command[1], command[2]);}
    if (command.at(-1) === 'observe') observations.push(phaseView(state, cycles));
  }
  return observations;
}
function runRaw(executable, scene, rate, clock) {
  const result = spawnSync(executable, [String(rate), String(clock)], {input: rawCommands(scene), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function compile(source, executable, header) {
  const args = ['-std=c++17', '-O2', '-ffp-contract=off'];
  if (header) args.push('-DSID_WAVEOFF_HEADER=' + JSON.stringify(header));
  execFileSync(process.env.CXX || 'clang++', [...args, source, '-o', executable], {stdio: 'pipe'});
}
function floatBytes(samples) {
  const result = Buffer.alloc(samples.length * 4);for (let i = 0; i < samples.length; i++) result.writeFloatLE(samples[i], i * 4);return result;
}
function hostScenes() {
  const cases = [], configure = ({wave = 0x20, flags = 0, sourceWave = 0x10, mode = 0, frequencyFirst = false} = {}) => {
    const operations = [], w = (r, v) => operations.push(['w', r, v]);
    if (frequencyFirst) {w(0, 0x45);w(1, 0x1d);operations.push(['r', 37]);}
    for (let channel = 0; channel < 3; channel++) {
      w(channel * 7 + 4, channel === 0 ? wave | flags : channel === 2 ? sourceWave : 0x20);
      w(channel * 7 + 2, 0x34);w(channel * 7 + 3, 7);w(channel * 7 + 5, 0);w(channel * 7 + 6, channel === 0 ? 0xf5 : 0);
    }
    w(21, 5);w(22, 87);w(23, 0x60 | (mode ? 1 : 0));w(24, 0x80 | mode << 4 | 8);
    w(0, 0x45);w(1, 0x1d);w(14, flags ? 0x2a : 0);w(15, flags ? 0x2b : 0);w(4, wave | flags | 1);
    operations.push(['r', 2048]);return operations;
  };
  for (const wave of [0x10, 0x20, 0x40, 0x80, 0x30, 0x50, 0x60, 0x70]) cases.push({name: `ordinary-wave-${wave.toString(16)}`, classification: 'invariant-wave-first', operations: configure({wave})});
  for (let mode = 1; mode < 8; mode++) cases.push({name: `ordinary-filter-${mode}`, classification: 'invariant-wave-first', operations: configure({mode})});
  for (const flags of [2, 4, 6]) {
    cases.push({name: `ordinary-pair-triangle-${flags}`, classification: 'invariant-wave-first', operations: configure({wave: 0x10, flags, mode: 3})});
    cases.push({name: `affected-pair-no-wave-${flags}`, classification: 'affected-no-wave-source-phase', operations: configure({wave: 0x10, flags, sourceWave: 0, mode: 3})});
    for (const carrier of [1, 2]) for (const sourceWave of [0, 0x10]) {
      const operations = configure({wave: 0x10, flags, sourceWave, mode: 3}).map(([op, register, value]) => {
        if (op !== 'w') return [op, register];
        if (register < 21) return [op, ((Math.floor(register / 7) + carrier) % 3) * 7 + register % 7, value];
        if (register === 23) return [op, register, (value & 0xf0) | (1 << carrier)];
        return [op, register, value];
      });
      cases.push({name: `${sourceWave ? 'ordinary-pair-triangle' : 'affected-pair-no-wave'}-${flags}-carrier${carrier + 1}`,
        classification: sourceWave ? 'invariant-wave-first' : 'affected-no-wave-source-phase', operations});
    }
  }
  cases.push({name: 'affected-frequency-before-wave', classification: 'affected-wave-off-startup-phase', operations: configure({frequencyFirst: true})});
  const floating = configure({wave: 0x40});floating.push(['w', 4, 1], ['a', 27], ['r', 1024], ['a', 27]);
  cases.push({name: 'affected-wave-off-dac-history', classification: 'affected-no-wave-output-latch-and-phase', operations: floating});
  return cases;
}
function expectedHostPhase(operations, rate, clock) {
  let state = voices(), cycles = 0, consumed = 0;
  for (const [op, a, b] of operations) {
    if (op === 'reset') {state = voices();cycles = consumed = 0;continue;}
    const count = op === 'r' ? Math.max(0, Math.ceil((consumed + a) * clock / rate) - cycles) : 1;
    state = phaseSteps(state, count);cycles += count;
    if (op === 'r') consumed += a;
    else if (op === 'w') busWrite(state, a, b);
  }
  return {cycles, phase: state.map(v => v.phase)};
}
async function runHost(executable, wasm, scene, rate, clock) {
  const source = scene.operations.map(command => command.join(' ')).join('\n') + '\n';
  const native = spawnSync(executable, [String(rate), String(clock)], {input: source, maxBuffer: 4 * 1024 * 1024});
  assert.equal(native.status, 0, native.stderr.toString());const nativeState = JSON.parse(native.stderr), reads = [], blocks = [];
  const core = await SidCore.create({sampleRate: rate, clockHz: clock, wasmBinary: wasm});let state;
  try {
    for (const [op, a, b] of scene.operations) {
      if (op === 'w') core.writeRegister(a, b);else if (op === 'a') reads.push(core.readRegister(a));else if (op === 'r') blocks.push(floatBytes(core.render(a)));else if (op === 'reset') core.reset();
    }
    state = core.getState();
  } finally {core.dispose();}
  const bytes = Buffer.concat(blocks);assert(bytes.equals(native.stdout), `${scene.name}/${rate}/${clock}: Native/WASM PCM differs`);
  assert.deepEqual({cycles: state.cycles, registers: state.registers, voices: state.voices, reads},
    {cycles: nativeState.cycles, registers: nativeState.registers, voices: nativeState.voices, reads: nativeState.reads});
  const expected = expectedHostPhase(scene.operations, rate, clock);
  return {pcmSha256: sha(bytes), frames: bytes.length / 4, state: nativeState,
    phaseMatchesOracle: state.cycles === expected.cycles && state.voices.every((v, i) => v.phase === expected.phase[i])};
}

/** captureBefore records known failures rather than marking a broken baseline
 * as conformant. Normal execution requires every new phase oracle to pass.
 * A baselineRoot additionally proves ordinary wave-first PCM is unchanged and
 * records all startup/no-wave differences without normalizing their phases.
 */
export async function checkSidWaveoff({workDir, wasmFile = join(root, wasmPath), baselineRoot, beforeReport, captureBefore = false, out} = {}) {
  const temporary = !workDir;workDir ??= await mkdtemp(join(tmpdir(), 'tetorica-sid-waveoff-'));await mkdir(workDir, {recursive: true});
  const native = join(workDir, 'waveoff-probe'), host = join(workDir, 'waveoff-host'), beforeNative = join(workDir, 'before-waveoff-probe'), beforeHost = join(workDir, 'before-waveoff-host');
  const report = {schemaVersion: 1, purpose: captureBefore ? 'known-broken-before-capture' : 'phase-fix-validation', passed: false, physicalOutputOpened: false,
    rates: [32000, 44100, 48000, 96000], clocks: [985248, 1022727], raw: [], cases: [], baseline: baselineRoot ? resolve(baselineRoot) : null};
  try {
    report.nativeCompiler = execFileSync(process.env.CXX || 'clang++', ['--version'], {encoding: 'utf8'}).split('\n')[0];
    report.nativeFlags = ['-std=c++17', '-O2', '-ffp-contract=off'];
    report.dacPolicy = 'Simple 12-bit previous-output latch halving per deselected-wave cycle; not measured floating-DAC timing.';
    report.sources = Object.fromEntries(await Promise.all([
      'scripts/check_sid_waveoff.mjs', rawProbePath, hostProbePath, headerPath, 'third_party/chips-m6581/upstream/m6581.h',
      'scripts/prepare_sid_core.py', 'tetorica_src/wasm/sid_core.h', 'tetorica_src/runtime/sid.js',
    ].map(async file => [file, digest(await readFile(join(root, file)))])));
    compile(join(root, rawProbePath), native);compile(join(root, hostProbePath), host);
    const wasm = await readFile(wasmFile);report.wasm = {file: wasmFile, ...digest(wasm)};report.header = digest(await readFile(join(root, headerPath)));
    let beforeWasm;
    if (baselineRoot) {
      compile(join(root, rawProbePath), beforeNative, join(resolve(baselineRoot), headerPath));compile(join(resolve(baselineRoot), hostProbePath), beforeHost);
      beforeWasm = await readFile(join(resolve(baselineRoot), wasmPath));report.beforeHeader = digest(await readFile(join(resolve(baselineRoot), headerPath)));report.beforeWasm = digest(beforeWasm);
      report.outputHostUnchanged = (await readFile(join(root, 'tetorica_src/wasm/sid_core.h'))).equals(await readFile(join(resolve(baselineRoot), 'tetorica_src/wasm/sid_core.h')));
      assert(report.outputHostUnchanged, 'Review a host gain/filter/DC change separately from this phase patch');
    }
    for (const scene of rawPhaseScenarios()) {
      const expected = rawExpected(scene), current = runRaw(native, scene, 48000, 985248);
      const failures = expected.map((value, i) => JSON.stringify(value) !== JSON.stringify(phaseView(current[i].phase.map((phase, v) => ({phase, rising: current[i].rising[v], control: current[i].control[v]})), current[i].cycles)) ? i : -1).filter(i => i >= 0);
      const item = {name: scene.name, observations: current.length, phaseFailures: failures.length, expectedSha256: sha(JSON.stringify(expected)), actualSha256: sha(JSON.stringify(current)), first: current[0], last: current.at(-1)};
      if (!captureBefore) assert.equal(failures.length, 0, `${scene.name}: independent phase/MSB oracle differs at observations ${failures.join(',')}`);
      if (!captureBefore && scene.decayVoice !== null) {
        for (let i = 0; i < current.length; i++) assert.equal(current[i].wave[scene.decayVoice], Math.floor(4095 / 2 ** (i + 1)), 'declared simple output-latch decay');
      }
      if (!captureBefore && scene.ringVoice !== null) {
        const target = scene.ringVoice;
        for (let i = 0; i < current.length; i++) {
          const phase = expected[i].phase[target], sourceMsb = 0x800000;
          const folded = (phase ^ sourceMsb) & 0x800000 ? ~phase : phase;
          assert.equal(current[i].wave[target], folded >>> 11 & 4095, 'Triangle Ring reads the running source MSB');
        }
      }
      if (baselineRoot) {const previous = runRaw(beforeNative, scene, 48000, 985248);item.beforeSha256 = sha(JSON.stringify(previous));item.beforePhaseFailures = expected.filter((value, i) => !value.phase.every((phase, v) => phase === previous[i].phase[v])).length;}
      report.raw.push(item);
    }
    for (const rate of report.rates) for (const clock of report.clocks) for (const scene of hostScenes()) {
      const after = await runHost(host, wasm, scene, rate, clock), item = {name: scene.name, classification: scene.classification, rate, clock, ...after};
      if (!captureBefore) assert(after.phaseMatchesOracle, `${scene.name}/${rate}/${clock}: WASM phase oracle differs`);
      if (baselineRoot) {
        const before = await runHost(beforeHost, beforeWasm, scene, rate, clock);item.before = before;
        item.pcmUnchanged = after.pcmSha256 === before.pcmSha256;item.stateUnchanged = JSON.stringify(after.state) === JSON.stringify(before.state);
        if (scene.classification === 'invariant-wave-first') assert(item.pcmUnchanged && item.stateUnchanged, `${scene.name}/${rate}/${clock}: an ordinary wave-first case changed`);
      }
      report.cases.push(item);
    }
    report.phaseFailures = report.raw.reduce((sum, item) => sum + item.phaseFailures, 0);
    if (captureBefore) assert(report.phaseFailures > 0, 'the before capture must expose the original phase bug');
    if (beforeReport) {
      assert(baselineRoot, 'A captured before report requires its immutable baseline root');
      const bytes = await readFile(beforeReport), captured = JSON.parse(bytes);
      assert.equal(captured.capturedBeforePatch, true);assert.deepEqual(captured.header, report.beforeHeader);
      assert.deepEqual({bytes: captured.wasm.bytes, sha256: captured.wasm.sha256}, report.beforeWasm);
      for (const previous of captured.raw) assert.equal(report.raw.find(item => item.name === previous.name)?.beforeSha256, previous.actualSha256, 'Captured pre-patch raw observation differs from baseline replay: ' + previous.name);
      for (const previous of captured.cases) {
        const current = report.cases.find(item => item.name === previous.name && item.rate === previous.rate && item.clock === previous.clock);
        assert.equal(current?.before?.pcmSha256, previous.pcmSha256, 'Captured pre-patch PCM differs from baseline replay: ' + previous.name);
        assert.deepEqual(current.before.state, previous.state, 'Captured pre-patch state differs from baseline replay: ' + previous.name);
      }
      report.beforeCaptureProof = {file: beforeReport, ...digest(bytes), capturedRawCasesVerified: captured.raw.length, capturedNativeWasmCasesVerified: captured.cases.length};
    }
    report.passed = true;
    if (out) {await mkdir(dirname(out), {recursive: true});await writeFile(out, JSON.stringify(report, null, 2) + '\n');}
    return report;
  } finally {if (temporary) await rm(workDir, {recursive: true, force: true});}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === '--capture-before') {options.captureBefore = true;continue;}
    assert(['--work-dir', '--wasm', '--baseline-root', '--before-report', '--out'].includes(key), 'Unknown SID waveoff option: ' + key);
    const value = process.argv[++i];assert(value && !value.startsWith('--'), 'Missing ' + key);
    options[{'--work-dir': 'workDir', '--wasm': 'wasmFile', '--baseline-root': 'baselineRoot', '--before-report': 'beforeReport', '--out': 'out'}[key]] = resolve(value);
  }
  const report = await checkSidWaveoff(options);
  console.log(JSON.stringify({passed: report.passed, purpose: report.purpose, rawCases: report.raw.length, rawPhaseFailures: report.phaseFailures,
    nativeWasmCases: report.cases.length, invariantCases: report.cases.filter(item => item.classification === 'invariant-wave-first').length,
    intentionallyAffectedCases: report.cases.filter(item => item.classification !== 'invariant-wave-first').length}));
}
