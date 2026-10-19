import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from './huc6280audioengine.js';
import {Huc6280Synth, Huc6280DirectTransport, HUC6280_CLOCK} from './huc6280synth.js';

const sampleRate = 48000;
const square = Array.from({length:32}, (_, i) => i < 16 ? 31 : 0);
const peak = data => data.reduce((value, sample) => Math.max(value, Math.abs(sample)), 0);
async function setup(clock = HUC6280_CLOCK) {
  const engine = await Huc6280AudioEngine.create({moduleFactory:factory, clock, outputSampleRate:sampleRate});
  const synth = new Huc6280Synth({transport:new Huc6280DirectTransport(engine), clock});
  synth.initialize();
  return {engine, synth, dispose() { synth.dispose(); engine.dispose(); }};
}

test('HuC6280 six channels render pitched five-bit waves, preserve voices across stop and reset', async () => {
  const device = await setup(); const {engine, synth} = device;
  try {
    assert.equal(peak(engine.processFrames(128).left), 0, 'initialization stays silent');
    for (let channel = 0; channel < 6; channel++) {
      synth.setWaveform(channel, square); synth.setVolume(channel, 31);
      const actual = synth.setNote(channel, 'A4'); synth.keyOn(channel);
      const audio = engine.processFrames(sampleRate);
      assert.deepEqual(audio.left, audio.right);
      assert(audio.left.every(Number.isFinite)); assert(peak(audio.left) > .1);
      let rises = 0;
      for (let index = 1; index < audio.left.length; index++) if (audio.left[index - 1] < 0 && audio.left[index] >= 0) rises++;
      assert(Math.abs(rises - actual) <= 2, `ch ${channel} expected ${actual}Hz, got ${rises}`);
      synth.keyOff(channel); assert.equal(peak(engine.processFrames(128).left), 0);
      synth.keyOn(channel); assert(peak(engine.processFrames(128).left) > .1, 'voice survives keyOff');
      synth.allNotesOff(); assert.equal(peak(engine.processFrames(128).left), 0);
    }
    synth.reset(); assert.equal(peak(engine.processFrames(128).left), 0);
    assert.throws(() => synth.noteOn(0, 'C4'), /initialize/);
    synth.initialize(); synth.noteOn(0, 'C4'); assert(peak(engine.processFrames(1024).left) > .01);
    synth.dispose(); assert.doesNotThrow(() => engine.processFrames(32), 'direct transport borrows engine');
  } finally { device.dispose(); }
});

test('HuC6280 channel and master balance are independent; waveform upload stops and resets the write pointer', async () => {
  const device = await setup(); const {engine, synth} = device;
  try {
    synth.setWaveform(2, square); synth.setVolume(2, 31); synth.setPan(2, 15, 0); synth.noteOn(2, 'C5');
    let audio = engine.processFrames(1024); assert(peak(audio.left) > .1); assert.equal(peak(audio.right), 0);
    synth.setPan(2, 0, 15); audio = engine.processFrames(1024); assert.equal(peak(audio.left), 0); assert(peak(audio.right) > .1);
    synth.setPan(2, 15); synth.setMasterVolume(0, 15); audio = engine.processFrames(1024); assert.equal(peak(audio.left), 0); assert(peak(audio.right) > .1);
    synth.setMasterVolume(15);
    synth.setWaveform(2, new Uint8Array(32).fill(16));
    assert.equal(peak(engine.processFrames(128).right), 0, 'upload stops channel');
    synth.keyOn(2); assert.equal(peak(engine.processFrames(1024).right), 0, 'every waveform position replaced after arbitrary playback phase');
    synth.setWaveform(2, square); synth.keyOn(2); assert(peak(engine.processFrames(1024).left) > .1);
  } finally { device.dispose(); }
});

test('HuC6280 DDA and noise use physical channel restrictions, and LFO config remains reproducible', async () => {
  const device = await setup(); const {engine, synth} = device;
  try {
    synth.setVolume(3, 31); synth.setDda(3, true); synth.writeDda(3, 31); synth.keyOn(3);
    let audio = engine.processFrames(128);
    assert(audio.left.every(sample => sample === audio.left[0] && sample > .1));
    synth.writeDda(3, 16); assert.equal(peak(engine.processFrames(128).left), 0);
    synth.setDda(3, false); assert.throws(() => synth.writeDda(3, 1), /Enable DDA/); synth.keyOff(3);
    for (const channel of [4,5]) {
      synth.setVolume(channel, 31); synth.setNoise(channel, {enabled:true, frequency:25}); synth.keyOn(channel);
      audio = engine.processFrames(4800); assert(peak(audio.left) > .1);
      assert(audio.left.some(sample => sample > 0) && audio.left.some(sample => sample < 0));
      synth.keyOff(channel); assert.equal(peak(engine.processFrames(128).left), 0);
    }
    const render = depth => {
      synth.initialize(); synth.setVolume(0, 31); synth.setVolume(1, 0);
      synth.setNote(0, 'C4'); synth.setNote(1, 'C3'); synth.setLfo({frequency:2, depth});
      synth.keyOn(0); return [...engine.processFrames(2400).left];
    };
    const plain = render(0), vibrato = render(2);
    assert.notDeepEqual(vibrato, plain); assert.deepEqual(render(2), vibrato);
  } finally { device.dispose(); }
});

test('HuC6280 frequency uses configured Hz clock and 0 period means 4096', () => {
  const writes = []; const synth = new Huc6280Synth({clock:4000000, transport:{writeRegister:(...args) => writes.push(args), reset() {}}});
  synth.initialize();
  assert.equal(synth.setFrequency(0, 4000000 / (32 * 4096)), 4000000 / (32 * 4096));
  assert.deepEqual(writes.slice(-2).map(write => write.slice(0,2)), [[2,0], [3,0]]);
  const actual = synth.setNote(5, 69); assert.equal(actual, 4000000 / (32 * Math.round(4000000 / (32 * 440))));
  synth.dispose();
});

test('HuC6280 validates full calls before writing; handoff does not replay hardware triggers', () => {
  const writes = []; const transport = {writeRegister:(...args) => writes.push(args), reset() {}};
  const synth = new Huc6280Synth({transport}); synth.initialize();
  const invalid = [
    () => synth.setWaveform(0, [...square.slice(0,31),32]),
    () => synth.setWaveform(0, new Uint8Array(31)),
    () => synth.setVolume(6, 24), () => synth.setVolume(0, 32),
    () => synth.setPan(0, 15, 16), () => synth.setMasterVolume(15, -1),
    () => synth.setFrequency(0, 1), () => synth.setFrequency(0, Infinity), () => synth.setNote(0, 'A440'),
    () => synth.setNoise(3, {enabled:true}), () => synth.setNoise(4, {enabled:1}),
    () => synth.setNoise(4, {enabled:true, frequency:32}), () => synth.setNoise(4, {enabled:true, hz:440}),
    () => synth.setDda(0, 1), () => synth.writeDda(0, 16),
    () => synth.setLfo({frequency:1, depth:4}), () => synth.setLfo({frequency:1, depth:1, reset:1}),
    () => synth.writeRegister(10, 0), () => synth.writeRegister(0, 256),
  ];
  const count = writes.length;
  for (const call of invalid) { assert.throws(call); assert.equal(writes.length, count); }
  synth.noteOn(2, 'E4'); const state = synth._getState();
  const other = new Huc6280Synth({transport}); const before = writes.length; other._adoptState(state);
  assert.equal(writes.length, before); assert.deepEqual(other._getState(), state);
  other.setVolume(2, 19); assert.equal(writes.at(-1)[1], 128 | 19, 'adopted control keeps key state');
  synth._beforeWrite = register => register !== 4;
  const events = []; synth._observe = command => events.push(command); synth.keyOff(2);
  assert.equal(events.length, 0, 'suppressed release is neither emitted nor adopted');
  assert(synth._getState().registers[2][4] & 128);
  synth.dispose(); other.dispose(); assert.throws(() => synth.keyOn(0), /disposed/);
});

test('HuC6280 web and distributed modules match', async () => {
  for (const file of ['huc6280synth.js','playground_huc6280.js','playground_huc6280_audio.js','playground_huc6280_worklet.js']) {
    const normalize = source => source.replace(/(\.js)\?v=[^'"\s]+/g,'$1').replaceAll('../generated/','./generated/');
    assert.equal(normalize(await readFile(new URL(`./${file}`, import.meta.url), 'utf8')), normalize(await readFile(new URL(`../docs/js/${file}`, import.meta.url), 'utf8')), file);
  }
});
