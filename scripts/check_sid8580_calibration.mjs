#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Reproducible policy checks against the research WASM, never an audio device.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {digest, probeReceipt, probeRoot} from './sid8580_probe_artifacts.mjs';
import {sid8580ProbeFixtures} from '../test/helpers/sid8580_probe_fixtures.mjs';

const argv = process.argv.slice(2), options = {};
for (let i = 0; i < argv.length; i++) {
  const name = argv[i];
  assert(['--work-dir', '--out'].includes(name) && argv[i + 1], `Unknown/missing option ${name}`);
  assert(!options[name], `Duplicate option ${name}`);
  options[name] = resolve(argv[++i]);
}
const work = options['--work-dir'] ?? resolve(probeRoot, 'build/sid8580-probe');
const receipt = await probeReceipt(work, {check: true});
const wasm = await readFile(resolve(work, 'sid8580-probe.wasm'));
const {instance} = await WebAssembly.instantiate(wasm, {}), api = instance.exports;
for (const name of ['create', 'destroy', 'write', 'read', 'run', 'output', 'output_frames',
  'set_8580_calibration', 'calibration', 'error', 'reset', 'stop', 'stopped',
  'bus_value', 'bus_remaining', 'rate', 'model', 'written',
  'cycles_lo', 'cycles_hi', 'frames_lo', 'frames_hi']) {
  assert.equal(typeof api[`sid8p_${name}`], 'function', `Missing sid8p_${name}`);
}

const counter = (handle, name) => (api[`sid8p_${name}_lo`](handle) >>> 0)
  + (api[`sid8p_${name}_hi`](handle) >>> 0) * 2 ** 32;
function pcm(handle) {
  const frames = api.sid8p_output_frames(handle) >>> 0;
  assert(frames <= 4096);
  return Buffer.from(new Uint8Array(api.memory.buffer, api.sid8p_output(handle), frames * 2));
}
function snapshot(handle) {
  return {
    cycles: counter(handle, 'cycles'), frames: counter(handle, 'frames'),
    busValue: api.sid8p_bus_value(handle), busRemaining: api.sid8p_bus_remaining(handle),
    stopped: api.sid8p_stopped(handle), rate: api.sid8p_rate(handle), model: api.sid8p_model(handle),
    calibration: api.sid8p_calibration(handle), outputFrames: api.sid8p_output_frames(handle),
    registers: Array.from({length: 32}, (_, register) => api.sid8p_written(handle, register)),
    pcm: pcm(handle),
  };
}
function exceptCalibration(state) {
  const {calibration, ...remaining} = state;
  return remaining;
}
function create(rate, model) {
  const handle = api.sid8p_create(rate, model);
  assert(handle, 'Probe allocation failed');
  assert.equal(api.sid8p_calibration(handle), 0, 'New instances must default to uncalibrated');
  return handle;
}
function withChip(rate, model, action) {
  const handle = create(rate, model);
  try { return action(handle); }
  finally { assert.equal(api.sid8p_destroy(handle), 1); }
}
function write(handle, register, value) {
  assert.equal(api.sid8p_write(handle, register, value), 1);
}
function run(handle, cycles) {
  const frames = api.sid8p_run(handle, cycles) >>> 0;
  assert(frames <= 4096, `run(${cycles}) failed with ${api.sid8p_error(handle)}`);
  assert.equal(frames, api.sid8p_output_frames(handle));
  return pcm(handle);
}
function setupFilter(handle) {
  for (const [register, value] of [[0, 0xb6], [1, 8], [4, 0x21], [5, 0], [6, 0xf0],
    [21, 0], [22, 32], [23, 0xf1], [24, 0x1f], [31, 0xa5]]) write(handle, register, value);
}
function render(fixture, rate, model, enabled) {
  return withChip(rate, model, handle => {
    assert.equal(api.sid8p_set_8580_calibration(handle, Number(enabled)), 1);
    const blocks = [], reads = [];
    for (const command of fixture.commands) {
      if (command[0] === 'w') write(handle, command[1], command[2]);
      else if (command[0] === 'r') reads.push(api.sid8p_read(handle, command[1]));
      else if (command[0] === 'c') {
        for (let remaining = command[1]; remaining > 0;) {
          const count = Math.min(remaining, 32768);
          blocks.push(run(handle, count)); remaining -= count;
        }
      } else throw Error(`Unsupported fixture command ${command[0]}`);
    }
    return {pcm: Buffer.concat(blocks), reads, cycles: counter(handle, 'cycles'), frames: counter(handle, 'frames')};
  });
}

const report = {
  format: 'tetorica-sid8580-calibration-policy', version: 1, productionAdopted: false,
  wasm: receipt.outputs['sid8580-probe.wasm'], compiler: receipt.compiler,
  inputs: {
    checker: digest(await readFile(new URL(import.meta.url))),
    fixtures: digest(await readFile(new URL('../test/helpers/sid8580_probe_fixtures.mjs', import.meta.url))),
  },
  physicalAudioOpened: false, musicOrFirmwareUsed: false, listeningPerformed: false,
  policyCases: [], unchanged6581: [], effective8580: [], instanceIsolation: [], checks: {},
};
const rates = [44100, 48000, 96000];
for (const rate of rates) for (const model of [0, 1]) {
  let retired;
  withChip(rate, model, handle => {
    retired = handle;
    setupFilter(handle); run(handle, 1000);
    const before = snapshot(handle);
    assert(before.busValue !== 0 && before.busRemaining > 0, 'Use a live bus latch for atomicity checks');
    assert.equal(api.sid8p_set_8580_calibration(handle, 1), 1);
    assert.equal(api.sid8p_calibration(handle), 1);
    assert.equal(api.sid8p_error(handle), 0);
    assert.deepEqual(exceptCalibration(snapshot(handle)), exceptCalibration(before), 'Enabling must not clock/reset/mutate bus or output');
    for (const invalid of [2, 0xffffffff]) {
      const enabled = snapshot(handle);
      assert.equal(api.sid8p_set_8580_calibration(handle, invalid), 0);
      assert.equal(api.sid8p_error(handle), 2);
      assert.deepEqual(snapshot(handle), enabled, 'Invalid enable value must preserve all chip state');
    }
    const enabled = snapshot(handle);
    assert.equal(api.sid8p_set_8580_calibration(handle, 0), 1);
    assert.equal(api.sid8p_error(handle), 0, 'A valid setter must clear a stale caller error');
    assert.equal(api.sid8p_calibration(handle), 0);
    assert.deepEqual(exceptCalibration(snapshot(handle)), exceptCalibration(enabled));
    assert.equal(api.sid8p_read(handle, 25), 256);
    assert.equal(api.sid8p_error(handle), 5);
    const potError = snapshot(handle);
    assert.equal(api.sid8p_set_8580_calibration(handle, 1), 1);
    assert.equal(api.sid8p_error(handle), 0, 'A valid setter must clear an unsupported-read error');
    assert.deepEqual(exceptCalibration(snapshot(handle)), exceptCalibration(potError));
    assert.equal(api.sid8p_reset(handle), 1);
    assert.equal(api.sid8p_calibration(handle), 1);
    assert.equal(counter(handle, 'cycles'), 0);
    assert.equal(counter(handle, 'frames'), 0);
    assert.equal(api.sid8p_bus_value(handle), 0);
    assert.equal(api.sid8p_bus_remaining(handle), 0);
    assert.equal(api.sid8p_stop(handle), 1);
    assert.equal(api.sid8p_calibration(handle), 1);
    const stopped = snapshot(handle);
    assert.equal(api.sid8p_set_8580_calibration(handle, 0), 1);
    assert.equal(api.sid8p_set_8580_calibration(handle, 1), 1);
    assert.deepEqual(snapshot(handle), stopped, 'Profile changes must not resume a stopped chip');
    assert.equal(api.sid8p_run(handle, 1000), 0);
    assert.equal(counter(handle, 'cycles'), 0);
    assert.equal(api.sid8p_calibration(handle), 1);
    report.policyCases.push({rate, model: model ? 8580 : 6581, defaultFalse: true,
      validZeroOne: true, invalidTwoAndUintMaxAtomic: true, validSetterClearsError: true,
      resetStopPreserve: true, stoppedSetterDoesNotResume: true});
  });
  withChip(rate, model, fresh => {
    assert.notEqual(fresh, retired, 'Destroyed generation must not be reused');
    const state = snapshot(fresh);
    assert.equal(api.sid8p_set_8580_calibration(retired, 1), 0);
    assert.deepEqual(snapshot(fresh), state, 'Stale handles must not alter replacement instances');
  });
}

const fixtures = sid8580ProbeFixtures();
for (const rate of rates) for (const fixture of fixtures) {
  const ordinary = render(fixture, rate, 0, false), opted = render(fixture, rate, 0, true);
  assert.deepEqual(opted, ordinary, `6581 opt-in changed ${fixture.name}/${rate}`);
  report.unchanged6581.push({name: fixture.name, rate, exactPcmAndReads: true, pcm: digest(ordinary.pcm)});
}
for (const rate of rates) {
  const fixture = fixtures.find(scene => scene.name === 'filter-sweep');
  const ordinary = render(fixture, rate, 1, false), opted = render(fixture, rate, 1, true);
  assert(!ordinary.pcm.equals(opted.pcm), 'The explicit 8580 profile must affect a resonant filter scene');
  assert.deepEqual(ordinary.reads, opted.reads, 'Analogue damping must not alter OSC3/ENV3');
  assert.equal(ordinary.cycles, opted.cycles); assert.equal(ordinary.frames, opted.frames);
  report.effective8580.push({rate, changesFilterPcmOnly: true, ordinaryPcm: digest(ordinary.pcm), calibratedPcm: digest(opted.pcm)});
}

for (const rate of rates) for (const peerModel of [0, 1]) {
  const peer = create(rate, peerModel), observed = create(rate, 1), control = create(rate, 1);
  try {
    for (const handle of [peer, observed, control]) setupFilter(handle);
    const blocks = [];
    for (let step = 0; step < 20; step++) {
      assert.equal(api.sid8p_set_8580_calibration(peer, step % 2), 1);
      write(peer, 23, ((step % 16) << 4) | 1); run(peer, 1000);
      const actual = run(observed, 997), expected = run(control, 997);
      assert.deepEqual(actual, expected, 'Another instance changed uncalibrated 8580 PCM');
      assert.deepEqual(snapshot(observed), snapshot(control));
      assert.equal(api.sid8p_calibration(observed), 0); blocks.push(actual);
    }
    report.instanceIsolation.push({rate, peerModel: peerModel ? 8580 : 6581,
      independent8580PcmAndState: true, pcm: digest(Buffer.concat(blocks))});
  } finally {
    for (const handle of [peer, observed, control]) assert.equal(api.sid8p_destroy(handle), 1);
  }
}
report.checks = {
  defaultFalseConfigurations: report.policyCases.length,
  validAndInvalidSetterAtomicity: true, validSetterClearsStaleErrors: true,
  resetStopPreserveExplicitProfile: true, staleHandlesCannotChangeReplacement: true,
  unchanged6581Scenes: report.unchanged6581.length,
  effective8580Controls: report.effective8580.length,
  independentInstanceCases: report.instanceIsolation.length,
};
report.passed = true;
if (options['--out']) {
  await mkdir(dirname(options['--out']), {recursive: true});
  await writeFile(options['--out'], JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({passed: true, checks: report.checks, out: options['--out'] ?? null}, null, 2));
