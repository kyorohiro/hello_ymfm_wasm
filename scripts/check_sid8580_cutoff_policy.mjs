#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Independent cutoff/resonance policy and immutable pre-cutoff PCM baselines.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {spawnSync, execFileSync} from 'node:child_process';
import {resolve, dirname, join} from 'node:path';
import {tmpdir} from 'node:os';
import {digest, probeReceipt, probeRoot} from './sid8580_probe_artifacts.mjs';
import {sid8580ProbeFixtures} from '../test/helpers/sid8580_probe_fixtures.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  assert(['--work-dir', '--out'].includes(name) && args[i + 1], `Unknown/missing option ${name}`);
  assert(!options[name], `Duplicate option ${name}`); options[name] = resolve(args[++i]);
}
const work = options['--work-dir'] ?? resolve(probeRoot, 'build/sid8580-probe');
const receipt = await probeReceipt(work, {check: true});
const baselinePath = resolve(probeRoot, 'test/fixtures/sid8580_cutoff_baseline.json');
const baselineBytes = await readFile(baselinePath), baseline = JSON.parse(baselineBytes);
assert.equal(baseline.format, 'tetorica-sid8580-pre-cutoff-baseline');
assert.equal(baseline.version, 1); assert.equal(baseline.cutoffCalibration, false);
assert.deepEqual(digest(await readFile(resolve(probeRoot, baseline.fixtures.path))),
  {bytes: baseline.fixtures.bytes, sha256: baseline.fixtures.sha256}, 'Original authored fixtures changed');
assert.deepEqual(baseline.cases.map(row => row.sampleRate), [44100, 48000, 96000]);
const {instance} = await WebAssembly.instantiate(await readFile(resolve(work, 'sid8580-probe.wasm')), {});
const a = instance.exports;
for (const name of ['create', 'destroy', 'write', 'read', 'run', 'output', 'output_frames',
  'set_8580_calibration', 'calibration', 'set_8580_cutoff_calibration', 'cutoff_calibration',
  'error', 'reset', 'stop', 'stopped', 'bus_value', 'bus_remaining', 'rate', 'model',
  'written', 'cycles_lo', 'cycles_hi', 'frames_lo', 'frames_hi']) {
  assert.equal(typeof a[`sid8p_${name}`], 'function', `Missing sid8p_${name}`);
}
const rates = [44100, 48000, 96000], combinations = [[0, 0], [1, 0], [0, 1], [1, 1]];
const counter = (h, name) => (a[`sid8p_${name}_lo`](h) >>> 0) + (a[`sid8p_${name}_hi`](h) >>> 0) * 2 ** 32;
function pcm(h) {
  const frames = a.sid8p_output_frames(h) >>> 0; assert(frames <= 4096);
  return Buffer.from(new Uint8Array(a.memory.buffer, a.sid8p_output(h), frames * 2));
}
function snapshot(h) {
  return {cycles: counter(h, 'cycles'), frames: counter(h, 'frames'), rate: a.sid8p_rate(h),
    model: a.sid8p_model(h), stopped: a.sid8p_stopped(h), resonance: a.sid8p_calibration(h),
    cutoff: a.sid8p_cutoff_calibration(h), busValue: a.sid8p_bus_value(h), busRemaining: a.sid8p_bus_remaining(h),
    registers: Array.from({length: 32}, (_, r) => a.sid8p_written(h, r)), outputFrames: a.sid8p_output_frames(h), pcm: pcm(h)};
}
function physical(state) {
  const {resonance, cutoff, ...rest} = state; return rest;
}
function assertFlags(h, resonance, cutoff) {
  assert.equal(a.sid8p_calibration(h), resonance); assert.equal(a.sid8p_cutoff_calibration(h), cutoff);
}
function create(rate, model) {
  const h = a.sid8p_create(rate, model); assert(h); assertFlags(h, 0, 0); return h;
}
function withChip(rate, model, action) {
  const h = create(rate, model);
  try { return action(h); } finally { assert.equal(a.sid8p_destroy(h), 1); }
}
function write(h, reg, value) { assert.equal(a.sid8p_write(h, reg, value), 1); }
function run(h, cycles) {
  const frames = a.sid8p_run(h, cycles) >>> 0; assert(frames <= 4096); assert.equal(frames, a.sid8p_output_frames(h)); return pcm(h);
}
function setProfile(h, resonance, cutoff) {
  assert.equal(a.sid8p_set_8580_calibration(h, resonance), 1);
  assert.equal(a.sid8p_set_8580_cutoff_calibration(h, cutoff), 1); assertFlags(h, resonance, cutoff);
}
function setup(h) {
  for (const [r, v] of [[0, 182], [1, 8], [4, 0x21], [5, 0], [6, 0xf0],
    [21, 0], [22, 32], [23, 0xf1], [24, 0x1f], [31, 0xa5]]) write(h, r, v);
}
const report = {format: 'tetorica-sid8580-cutoff-policy', version: 1, productionAdopted: false,
  wasm: receipt.outputs['sid8580-probe.wasm'], compiler: receipt.compiler,
  profiles: {resonance: '8580-resonance-logfit-v1', cutoff: '8580-cutoff-crossover-v1'},
  inputs: {checker: digest(await readFile(new URL(import.meta.url))), baseline: digest(baselineBytes), fixtures: baseline.fixtures},
  historicalBaseline: {report: baseline.sourceReport, wasm: baseline.sourceWasm},
  physicalAudioOpened: false, musicOrFirmwareUsed: false, listeningPerformed: false,
  policyCases: [], unchanged6581: [], filterMatrix: [], integratorRoundTrips: [], instanceIsolation: [], nativeQualityCases: []};

for (const rate of rates) for (const model of [0, 1]) {
  let retired;
  withChip(rate, model, h => {
    retired = h; setup(h); run(h, 1000);
    assert(a.sid8p_bus_value(h) !== 0 && a.sid8p_bus_remaining(h) > 0);
    for (const [resonance, cutoff] of combinations) {
      const before = snapshot(h), oldCutoff = before.cutoff;
      assert.equal(a.sid8p_set_8580_calibration(h, resonance), 1); assertFlags(h, resonance, oldCutoff);
      assert.deepEqual(physical(snapshot(h)), physical(before), 'Resonance setter changed physical state');
      const intermediate = snapshot(h);
      assert.equal(a.sid8p_set_8580_cutoff_calibration(h, cutoff), 1); assertFlags(h, resonance, cutoff);
      assert.deepEqual(physical(snapshot(h)), physical(intermediate), 'Cutoff setter changed physical state');
      for (const setter of [a.sid8p_set_8580_calibration, a.sid8p_set_8580_cutoff_calibration]) {
        for (const value of [2, 0xffffffff]) {
          const valid = snapshot(h); assert.equal(setter(h, value), 0); assert.equal(a.sid8p_error(h), 2);
          assert.deepEqual(snapshot(h), valid, 'Invalid setter changed either profile/chip state');
        }
        const valid = snapshot(h), value = setter === a.sid8p_set_8580_calibration ? resonance : cutoff;
        assert.equal(setter(h, value), 1); assert.equal(a.sid8p_error(h), 0);
        assert.deepEqual(snapshot(h), valid, 'Recovery setter changed state');
      }
    }
    for (const [resonance, cutoff] of combinations) {
      setProfile(h, resonance, cutoff); assert.equal(a.sid8p_reset(h), 1); assertFlags(h, resonance, cutoff);
      assert.equal(counter(h, 'cycles'), 0); assert.equal(a.sid8p_bus_value(h), 0); assert.equal(a.sid8p_bus_remaining(h), 0);
      write(h, 31, 0xa5); run(h, 1000); assert.equal(a.sid8p_stop(h), 1); assertFlags(h, resonance, cutoff);
      const stopped = snapshot(h); setProfile(h, 1 - resonance, 1 - cutoff); setProfile(h, resonance, cutoff);
      assert.deepEqual(snapshot(h), stopped, 'Stopped configuration change resumed/reset chip');
      assert.equal(a.sid8p_run(h, 1000), 0); assert.equal(counter(h, 'cycles'), stopped.cycles);
      assert.equal(a.sid8p_reset(h), 1); assertFlags(h, resonance, cutoff);
    }
    report.policyCases.push({rate, model: model ? 8580 : 6581, defaultsFalse: true,
      fourIndependentProfiles: true, invalidValuesAtomic: true, recoveryClearsError: true, resetStopPreserveAllFour: true});
  });
  withChip(rate, model, h => {
    assert.notEqual(h, retired); const before = snapshot(h);
    assert.equal(a.sid8p_set_8580_calibration(retired, 1), 0);
    assert.equal(a.sid8p_set_8580_cutoff_calibration(retired, 1), 0);
    assert.deepEqual(snapshot(h), before, 'Stale handle changed replacement');
  });
}

const cache = new Map(), fixtures = sid8580ProbeFixtures();
function render(fixture, rate, model, resonance, cutoff) {
  const key = `${fixture.name}:${rate}:${model}:${resonance}:${cutoff}`;
  if (cache.has(key)) return cache.get(key);
  const result = withChip(rate, model, h => {
    setProfile(h, resonance, cutoff); const blocks = [], reads = [];
    for (const cmd of fixture.commands) {
      if (cmd[0] === 'w') write(h, cmd[1], cmd[2]);
      else if (cmd[0] === 'r') reads.push(a.sid8p_read(h, cmd[1]));
      else if (cmd[0] === 'c') for (let left = cmd[1]; left > 0;) {
        const n = Math.min(left, 32768); blocks.push(run(h, n)); left -= n;
      } else throw Error(`Unexpected fixture command ${cmd[0]}`);
    }
    assertFlags(h, resonance, cutoff);
    return {pcm: Buffer.concat(blocks), reads, cycles: counter(h, 'cycles'), frames: counter(h, 'frames')};
  }); cache.set(key, result); return result;
}
for (const rate of rates) for (const fixture of fixtures) {
  const normal = render(fixture, rate, 0, 0, 0);
  for (const [resonance, cutoff] of combinations) {
    assert.deepEqual(render(fixture, rate, 0, resonance, cutoff), normal, 'Either 8580 flag affected 6581');
  }
  report.unchanged6581.push({name: fixture.name, rate, allFourProfilesExact: true, pcm: digest(normal.pcm)});
}
const filter = fixtures.find(f => f.name === baseline.fixture); assert(filter);
for (const row of baseline.cases) {
  const rate = row.sampleRate, ordinary = render(filter, rate, 1, 0, 0), resonanceOnly = render(filter, rate, 1, 1, 0);
  assert.deepEqual(digest(render(filter, rate, 0, 0, 0).pcm), row.model6581, 'Old 6581 filter baseline changed');
  assert.deepEqual(digest(ordinary.pcm), row.model8580Default, 'Old default 8580 baseline changed');
  assert.deepEqual(digest(resonanceOnly.pcm), row.model8580ResonanceOnly, 'Old resonance-only baseline changed');
  const cutoffOnly = render(filter, rate, 1, 0, 1), both = render(filter, rate, 1, 1, 1);
  assert(!cutoffOnly.pcm.equals(ordinary.pcm), 'Cutoff flag has no effect');
  assert(!both.pcm.equals(resonanceOnly.pcm), 'Cutoff flag lost when resonance enabled');
  assert(!both.pcm.equals(cutoffOnly.pcm), 'Resonance flag lost when cutoff enabled');
  for (const actual of [resonanceOnly, cutoffOnly, both]) {
    assert.deepEqual(actual.reads, ordinary.reads); assert.equal(actual.cycles, ordinary.cycles); assert.equal(actual.frames, ordinary.frames);
  }
  report.filterMatrix.push({rate, old6581Exact: true, oldDefaultExact: true, oldResonanceOnlyExact: true,
    ordinary: digest(ordinary.pcm), resonanceOnly: digest(resonanceOnly.pcm), cutoffOnly: digest(cutoffOnly.pcm), both: digest(both.pcm)});
}

for (const rate of rates) for (const model of [0, 1]) {
  const h = create(rate, model), control = create(rate, model);
  try {
    setup(h); setup(control); assert.deepEqual(run(h, 20000), run(control, 20000));
    for (const [resonance, cutoff] of combinations) setProfile(h, resonance, cutoff);
    setProfile(h, 0, 0);
    const actual = run(h, 997), expected = run(control, 997);
    assert(expected.some(byte => byte !== 0)); assert.deepEqual(actual, expected, 'A no-clock profile round trip reset filter integrators');
    assert.deepEqual(snapshot(h), snapshot(control));
    report.integratorRoundTrips.push({rate, model: model ? 8580 : 6581, exactAfterNoClockRoundTrip: true});
  } finally { for (const id of [h, control]) assert.equal(a.sid8p_destroy(id), 1); }
}
for (const rate of rates) for (const peerModel of [0, 1]) {
  const peer = create(rate, peerModel), observed = create(rate, 1), control = create(rate, 1);
  try {
    for (const h of [peer, observed, control]) setup(h);
    for (let step = 0; step < 20; step++) {
      setProfile(peer, (step >> 1) & 1, step & 1); write(peer, 23, ((step % 16) << 4) | 1); run(peer, 1000);
      assert.deepEqual(run(observed, 997), run(control, 997), 'Peer changed default 8580 PCM');
      assert.deepEqual(snapshot(observed), snapshot(control)); assertFlags(observed, 0, 0);
    }
    report.instanceIsolation.push({rate, peerModel: peerModel ? 8580 : 6581, bothFlagsIndependent: true});
  } finally { for (const h of [peer, observed, control]) assert.equal(a.sid8p_destroy(h), 1); }
}

for (const rate of rates) for (const model of [0, 1]) for (const [resonance, cutoff] of combinations) {
  const flags = [...(resonance ? ['--8580-calibration'] : []), ...(cutoff ? ['--8580-cutoff-calibration'] : [])];
  const protocol = `SID8QUALITY 1 ${rate} ${model ? 8580 : 6581}\n${filter.commands.map(c => c.join(' ')).join('\n')}\n`;
  const result = spawnSync(resolve(work, 'sid8580-quality'), flags, {input: protocol, maxBuffer: 4 * 1024 * 1024, timeout: 30000});
  assert.equal(result.status, 0, result.stderr.toString()); const state = JSON.parse(result.stderr);
  const wasm = render(filter, rate, model, resonance, cutoff);
  assert.deepEqual(result.stdout, wasm.pcm); assert.deepEqual(state.reads, wasm.reads);
  assert.equal(state.calibrationEnabled, Boolean(resonance)); assert.equal(state.calibrationEffective, Boolean(resonance && model));
  assert.equal(state.cutoffCalibrationEnabled, Boolean(cutoff)); assert.equal(state.cutoffCalibrationEffective, Boolean(cutoff && model));
  assert.equal(state.calibrationProfile, resonance ? report.profiles.resonance : 'upstream');
  assert.equal(state.cutoffCalibrationProfile, cutoff ? report.profiles.cutoff : 'upstream');
  report.nativeQualityCases.push({rate, model: model ? 8580 : 6581, resonance, cutoff, exactNativeWasm: true});
  if (rate === 48000 && model === 1 && resonance && cutoff) {
    const reverse = spawnSync(resolve(work, 'sid8580-quality'), [...flags].reverse(), {input: protocol});
    assert.equal(reverse.status, 0); assert.deepEqual(reverse.stdout, result.stdout); assert.deepEqual(JSON.parse(reverse.stderr), state);
    const duplicate = spawnSync(resolve(work, 'sid8580-quality'), ['--8580-cutoff-calibration', '--8580-cutoff-calibration'], {input: protocol});
    assert.notEqual(duplicate.status, 0); assert.equal(duplicate.stdout.length, 0);
  }
}

// CABI models are immutable. Exercise public Rust model transitions separately
// using the same source closure verified by the build receipt above.
const modelTest = String.raw`
use sidera::{ChipModel, Sid};
fn setup(s: &mut Sid) {
    for (r,v) in [(0,182),(1,8),(4,33),(5,0),(6,240),(21,0),(22,32),(23,241),(24,31)] { s.write_register(r,v); }
}
fn main() {
    let mut cases = 0;
    for rate in [44100,48000,96000] {
        for target in [ChipModel::Mos6581,ChipModel::Mos8580] {
            for resonance in [false,true] { for cutoff in [false,true] {
                let mut transitioned = Sid::new(rate);
                assert!(!transitioned.resonance_calibration_8580()); assert!(!transitioned.cutoff_calibration_8580());
                transitioned.set_model(ChipModel::Mos8580);
                transitioned.set_8580_resonance_calibration(resonance); transitioned.set_8580_cutoff_calibration(cutoff); setup(&mut transitioned);
                transitioned.set_model(ChipModel::Mos6581); transitioned.set_model(ChipModel::Mos8580); transitioned.set_model(target);
                let mut direct = Sid::new(rate); direct.set_model(target);
                direct.set_8580_cutoff_calibration(cutoff); direct.set_8580_resonance_calibration(resonance); setup(&mut direct);
                for frame in 0..2048 {
                    if frame % 2 == 0 { assert_eq!(transitioned.clock(),direct.clock()); }
                    else { assert_eq!(transitioned.clock_with_voices(),direct.clock_with_voices()); }
                }
                for s in [&mut transitioned,&mut direct] {
                    s.reset(); assert_eq!(s.resonance_calibration_8580(),resonance); assert_eq!(s.cutoff_calibration_8580(),cutoff); setup(s);
                }
                for _ in 0..128 { assert_eq!(transitioned.tick_cycle(),direct.tick_cycle()); }
                cases += 1;
            }}
        }
    }
    println!("{{\"passed\":true,\"cases\":{},\"publicModelTransitions\":true,\"resetPreservesBothFlags\":true}}",cases);
}
`;
const scratch = await mkdtemp(join(tmpdir(), 'tetorica-cutoff-model-'));
try {
  const source = resolve(scratch, 'model_policy.rs'), library = resolve(scratch, 'libsidera.rlib');
  const binary = resolve(scratch, process.platform === 'win32' ? 'model_policy.exe' : 'model_policy');
  await writeFile(source, modelTest);
  const rustc = process.env.RUSTC || 'rustc';
  execFileSync(rustc, ['--edition=2021', '-C', 'opt-level=3', '-C', 'panic=abort', '--crate-name', 'sidera', '--crate-type', 'rlib',
    resolve(probeRoot, 'third_party/sidera/adapted/src/lib.rs'), '-o', library], {stdio: ['ignore', 'pipe', 'pipe']});
  execFileSync(rustc, ['--edition=2021', '-C', 'opt-level=3', '-C', 'panic=abort', '--crate-name', 'cutoff_model_policy',
    source, '--extern', `sidera=${library}`, '-o', binary], {stdio: ['ignore', 'pipe', 'pipe']});
  report.nativeModelPolicy = JSON.parse(execFileSync(binary, [], {encoding: 'utf8'}));
  assert.equal(report.nativeModelPolicy.passed, true); assert.equal(report.nativeModelPolicy.cases, 24);
  report.nativeModelPolicy.testSource = digest(Buffer.from(modelTest));
} finally { await rm(scratch, {recursive: true, force: true}); }

report.checks = {defaultFalseConfigurations: report.policyCases.length, allFourIndependentProfiles: true,
  invalidSettersAtomic: true, resetStopPreservesFourProfiles: true, staleHandleSafe: true,
  unchanged6581Scenes: report.unchanged6581.length, historicalFilterBaselines: report.filterMatrix.length * 3,
  effective8580Matrices: report.filterMatrix.length, noClockIntegratorRoundTrips: report.integratorRoundTrips.length,
  perInstanceCases: report.instanceIsolation.length, nativeQualityFourProfileCases: report.nativeQualityCases.length,
  publicRustModelTransitionCases: report.nativeModelPolicy.cases};
report.passed = true;
if (options['--out']) {
  await mkdir(dirname(options['--out']), {recursive: true}); await writeFile(options['--out'], JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({passed: true, checks: report.checks, out: options['--out'] ?? null}, null, 2));
