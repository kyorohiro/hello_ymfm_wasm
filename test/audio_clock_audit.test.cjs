'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const {
  PILOT_PERIOD, PROCESSOR_NAMES, processorSource,
  analyzePilotPcm, analyzeClockRows, hashFloat32Pcm,
} = require('../scripts/audio_clock_audit.cjs');
const {parseArguments} = require('../scripts/check_audio_clock_browser.cjs');

const ramp = (start, length) => Float32Array.from({length}, (_, index) =>
  ((start + index) % PILOT_PERIOD) / PILOT_PERIOD);
const concat = (...parts) => Float32Array.from(parts.flatMap(part => Array.from(part)));
const rows = (count, first = 48000) => Array.from({length: count}, (_, index) => ({
  frame: first + index * 128, frameAgain: first + index * 128,
  endFrame: first + index * 128, endFrameAgain: first + index * 128,
  offset: index * 128, quantum: 128, ordinal: index + 20,
}));

test('sample-counted pilot is exact across the full Float32 counter wrap', () => {
  assert.equal(PILOT_PERIOD, 2 ** 24);
  const values = ramp(PILOT_PERIOD - 256, 1024);
  const result = analyzePilotPcm(values, {expectedFrames: 1024, pilotInputFrames: 1024});
  assert.equal(result.continuous, true);
  assert.equal(result.sampleGapCount, 0);
  assert.equal(result.zeroSamples, 1);
});

test('dropped 128-sample quantum is detected independently of clock rows', () => {
  const values = concat(ramp(1000, 256), ramp(1384, 512));
  const result = analyzePilotPcm(values, {expectedFrames: values.length});
  assert.equal(result.continuous, false);
  assert.equal(result.sampleGapCount, 1);
  assert.equal(result.sampleGaps[0].delta, 129);
});

test('duplicated 128-sample quantum is detected', () => {
  const values = concat(ramp(1000, 256), ramp(1128, 128), ramp(1256, 256));
  const result = analyzePilotPcm(values);
  assert.equal(result.continuous, false);
  assert.equal(result.sampleGapCount, 1);
  assert.equal(result.sampleGaps[0].delta, PILOT_PERIOD - 127);
});

test('inserted zero quantum and an entirely missing signal are both rejected', () => {
  const values = concat(ramp(1000, 256), new Float32Array(128), ramp(1256, 256));
  assert.equal(analyzePilotPcm(values).continuous, false);
  const zero = analyzePilotPcm(new Float32Array(1024));
  assert.equal(zero.continuous, false);
  assert.equal(zero.sampleGapCount, 1023);
});

test('short capture and missing input cannot pass using a valid ramp prefix', () => {
  const values = ramp(1000, 512);
  assert.equal(analyzePilotPcm(values, {expectedFrames: 640}).continuous, false);
  assert.equal(analyzePilotPcm(values, {pilotInputFrames: 0}).continuous, false);
  assert.equal(analyzePilotPcm(values, {pilotInputFrames: 511}).continuous, false);
  assert.equal(analyzePilotPcm(new Float32Array()).continuous, false);
  assert.equal(analyzePilotPcm(ramp(0, 1)).continuous, false);
});

test('nonfinite, out-of-range and non-grid pilot samples are rejected', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, 1, 0.1]) {
    const values = Array.from(ramp(1000, 512));
    values[100] = value;
    const result = analyzePilotPcm(values);
    assert.equal(result.continuous, false, String(value));
    assert(result.nonFinite || result.invalidSamples);
  }
});

test('skipping a quantum across the counter wrap is still rejected', () => {
  const values = concat(ramp(PILOT_PERIOD - 256, 128), ramp(0, 512));
  const result = analyzePilotPcm(values);
  assert.equal(result.continuous, false);
  assert.equal(result.sampleGaps[0].delta, 129);
});

test('a 65536-frame skip cannot alias as continuous with the longer pilot', () => {
  const values = concat(ramp(1000, 128), ramp(1000 + 128 + 65536, 128));
  const result = analyzePilotPcm(values);
  assert.equal(result.continuous, false);
  assert.equal(result.sampleGaps[0].delta, 65537);
});

test('global -128 then +256 frame transitions do not corrupt independent PCM', () => {
  const trace = rows(8);
  for (const key of ['frame', 'frameAgain', 'endFrame', 'endFrameAgain']) trace[3][key] -= 128;
  const clock = analyzeClockRows(trace);
  assert.equal(clock.continuous, false);
  assert.equal(clock.measurementValid, true);
  assert.equal(clock.gapCount, 1);
  assert.equal(clock.gaps[0].frame - clock.gaps[0].expectedFrame, -128);
  assert.equal(analyzePilotPcm(ramp(1000, 1024)).continuous, true);
});

test('unchanged clock rows are continuous; unstable global reads are diagnostics', () => {
  const trace = rows(8);
  assert.equal(analyzeClockRows(trace).continuous, true);
  trace[3].endFrame += 128;
  const clock = analyzeClockRows(trace);
  assert.equal(clock.continuous, false);
  assert.equal(clock.measurementValid, true);
  assert.equal(clock.unstableReadCount, 1);
  assert.equal(clock.gapCount, 0);
});

test('clock audit also rejects malformed measurement offsets and ordinals', () => {
  for (const change of [row => { row.offset++; }, row => { row.ordinal++; },
    row => { row.quantum = 0; }]) {
    const trace = rows(8);
    change(trace[3]);
    assert.equal(analyzeClockRows(trace).measurementValid, false);
  }
  assert.equal(analyzeClockRows([]).measurementValid, false);
});

test('both analysis functions execute without module globals', () => {
  const analyzePcm = vm.runInNewContext('(' + analyzePilotPcm.toString() + ')');
  const analyzeClock = vm.runInNewContext('(' + analyzeClockRows.toString() + ')');
  assert.equal(analyzePcm(ramp(1000, 1024), {expectedFrames: 1024}).continuous, true);
  assert.equal(analyzeClock(rows(8)).continuous, true);
});

test('PCM hashing respects typed-array offsets and preserves signal changes', () => {
  const values = ramp(1000, 1024);
  assert.equal(hashFloat32Pcm(values.subarray(128, 256)), hashFloat32Pcm(values.slice(128, 256)));
  assert.notEqual(hashFloat32Pcm(values), hashFloat32Pcm(ramp(1001, 1024)));
});

function processors() {
  const registered = new Map();
  let frame = 0;
  class AudioWorkletProcessor {
    constructor() {
      this.port = {messages: [], postMessage(value) { this.messages.push(value); }};
    }
  }
  const scope = {
    AudioWorkletProcessor,
    registerProcessor(name, constructor) { registered.set(name, constructor); },
    Float32Array,
    get currentFrame() { return frame; },
    get currentTime() { return frame / 48000; },
  };
  vm.runInNewContext(processorSource, scope);
  return {registered, setFrame(value) { frame = value; }};
}

test('actual capture processor keeps audio and independent pilot inputs separate', () => {
  const fixture = processors();
  const Capture = fixture.registered.get(PROCESSOR_NAMES.capture);
  const capture = new Capture({processorOptions: {pilotInput: 1}});
  capture.port.onmessage({data: {id: 1, frames: 256}});
  for (let block = 0; block < 2; block++) {
    // Deliberately repeat currentFrame on block2. Pilot PCM must remain intact.
    fixture.setFrame(48000);
    const audio = [new Float32Array(128).fill(0.25), new Float32Array(128).fill(-0.25)];
    const outputs = [[new Float32Array(128).fill(1), new Float32Array(128).fill(1)]];
    assert.equal(capture.process([audio, [ramp(1000 + block * 128, 128)]], outputs), true);
    assert(outputs[0].every(channel => channel.every(value => value === 0)));
  }
  const data = capture.port.messages[0];
  assert.equal(data.id, 1);
  assert.equal(data.pilotInputFrames, 256);
  assert.equal(data.inputFrames, 256);
  assert(data.left.every(value => value === 0.25));
  assert(data.right.every(value => value === -0.25));
  assert.equal(data.frameGaps, 1);
  assert.equal(analyzeClockRows(data.rows).continuous, false);
  assert.equal(analyzePilotPcm(data.pilot, {expectedFrames: 256,
    pilotInputFrames: data.pilotInputFrames}).continuous, true);
});

test('capture processor records missing pilot input without substituting valid silence', () => {
  const fixture = processors();
  const Capture = fixture.registered.get(PROCESSOR_NAMES.capture);
  const capture = new Capture({processorOptions: {pilotInput: 1}});
  capture.port.onmessage({data: {id: 1, frames: 128}});
  capture.process([[ramp(0, 128)], []], [[new Float32Array(128), new Float32Array(128)]]);
  const data = capture.port.messages[0];
  assert.equal(data.pilotInputFrames, 0);
  const analysis = analyzePilotPcm(data.pilot, {expectedFrames: 128,
    pilotInputFrames: data.pilotInputFrames});
  assert.equal(analysis.continuous, false);
  assert.equal(analysis.nonFinite, 128);
});

test('pilot processor counts generated samples independently of currentFrame', () => {
  const fixture = processors();
  const Pilot = fixture.registered.get(PROCESSOR_NAMES.pilot);
  const pilot = new Pilot();
  const samples = [];
  pilot.frames = PILOT_PERIOD - 128;
  for (let block = 0; block < 3; block++) {
    fixture.setFrame(block === 1 ? 0 : block * 128);
    const outputs = [[new Float32Array(128)]];
    pilot.process([], outputs);
    samples.push(outputs[0][0]);
  }
  assert.equal(analyzePilotPcm(concat(...samples)).continuous, true);
  assert.equal(pilot.clockGapCount, 2);
});

test('capture processor rejects concurrent or unbounded capture requests', () => {
  const {registered} = processors();
  const Capture = registered.get(PROCESSOR_NAMES.capture);
  for (const frames of [0, 1, -1, 1.5, 16777216, 16777217, Infinity]) {
    const capture = new Capture();
    assert.throws(() => capture.port.onmessage({data: {id: 1, frames}}), /Invalid/);
  }
  const capture = new Capture();
  capture.port.onmessage({data: {id: 1, frames: 128}});
  assert.throws(() => capture.port.onmessage({data: {id: 2, frames: 128}}), /Concurrent/);
});

test('focused runner arguments remain portable and bounded', () => {
  assert.equal(parseArguments([]).repeats, 1);
  assert.deepEqual(parseArguments(['--webkit-only']).engines, ['webkit']);
  assert.deepEqual(parseArguments(['--chromium-only']).engines, ['chromium']);
  assert.equal(parseArguments(['--repeats=3']).repeats, 3);
  assert.equal(parseArguments(['--help']).help, true);
  for (const args of [['--repeats', '0'], ['--repeats', '101'], ['--repeats', '1.5'],
    ['--out'], ['--unknown'], ['--chromium-only', '--webkit-only']]) {
    assert.throws(() => parseArguments(args));
  }
});
