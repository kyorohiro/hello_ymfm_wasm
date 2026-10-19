import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/rf5c164_wasm.js';
import {Rf5c164} from './rf5c164.js';
import {createRf5c164Client, createRf5c164Control} from './playground_rf5c164.js';

const sampleRate = 48000, clock = 12500000;
const wasmBinary = await readFile(new URL('../docs/generated/rf5c164_wasm.wasm', import.meta.url));
const source = await readFile(new URL('../docs/playground/defaults/mega-cd/index.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;

function maxJump(samples) {
  let maximum = 0;
  for (let i = 1; i < samples.length; i++) maximum = Math.max(maximum, Math.abs(samples[i] - samples[i - 1]));
  return maximum;
}

function sineResidualDb(samples, frequency) {
  let ss = 0, cc = 0, sc = 0, ys = 0, yc = 0;
  for (let i = 0; i < samples.length; i++) {
    const phase = 2 * Math.PI * frequency * i / sampleRate, s = Math.sin(phase), c = Math.cos(phase);
    ss += s * s; cc += c * c; sc += s * c; ys += samples[i] * s; yc += samples[i] * c;
  }
  const determinant = ss * cc - sc * sc;
  const a = (ys * cc - yc * sc) / determinant, b = (yc * ss - ys * sc) / determinant;
  let error = 0, power = 0;
  for (let i = 0; i < samples.length; i++) {
    const phase = 2 * Math.PI * frequency * i / sampleRate;
    error += (samples[i] - a * Math.sin(phase) - b * Math.cos(phase)) ** 2;
    power += samples[i] ** 2;
  }
  return 10 * Math.log10(error / power);
}

test('Mega CD starter renders four tuned PCM notes with silent gates instead of abrupt waveform cuts', async () => {
  const chip = await Rf5c164.create({moduleFactory:factory, moduleOptions:{wasmBinary}, sampleRate, clock});
  const control = createRf5c164Control(chip); control.reset();
  const events = [], parts = [], melody = [];
  let position = 0, loop;
  const port = {start() {}, close() {}, postMessage({id, method, args = []}) {
    const value = control[method](...args);
    if (id !== undefined) queueMicrotask(() => port.onmessage({data:{id, value}}));
  }};
  const client = createRf5c164Client(port, () => {throw new Error('Starter should supply decoded PCM');});
  const pcm = new Proxy(client, {get(target, property) {
    const value = target[property];
    return typeof value !== 'function' ? value : (...args) => {
      events.push({method:property, args, frame:position}); return value.apply(target, args);
    };
  }});
  const advance = seconds => {
    const count = Math.round(seconds * sampleRate); parts.push(chip.generateStereo(count).left); position += count;
  };
  try {
    await new AsyncFunction('useSoundChip', 'fm', 'FM_PRESETS', 'CH1', 'setBpm', 'liveLoop', 'play', 'beat', source)(
      async name => {assert.equal(name, 'rf5c164'); return pcm;},
      {setPreset(channel, preset) {assert.equal(channel, 0); assert.equal(preset, 'existing-preset');}},
      {'one-op-basic':'existing-preset'}, 0, bpm => assert.equal(bpm, 120),
      (_, callback) => {loop = callback;},
      async (note, options) => {melody.push([note, options]); advance(options.beats * 0.5);},
      async beats => advance(beats * 0.5),
    );
    await loop();
    assert.deepEqual(melody, ['C4', 'E4', 'G4', 'B4'].map(note => [note, {channel:0, beats:0.8}]));
    const output = new Float32Array(position); let offset = 0;
    for (const part of parts) {output.set(part, offset); offset += part.length;}
    assert(output.every(value => Number.isFinite(value) && Math.abs(value) < 0.15), 'all four notes retain headroom');
    const sourcePCM = events.find(event => event.method === 'loadSample').args[0];
    assert.equal(sourcePCM.sampleRate, 16000); assert.equal(sourcePCM.channels[0].length, 5600);
    assert(sourcePCM.channels[0][0] === 0); assert(sourcePCM.channels[0].at(-1) === 0);
    const pitches = events.filter(event => event.method === 'setPitch');
    const gates = events.filter(event => event.method === 'keyOff');
    const midiNotes = [48, 52, 55, 59];
    for (let i = 0; i < 4; i++) {
      const start = i * sampleRate / 2, end = gates[i].frame;
      assert.equal(end - start, sampleRate * 0.4);
      assert(output.slice(end - 0.04 * sampleRate, start + sampleRate / 2).every(value => value === 0), 'natural sample tail is silent before and after keyOff');
      assert.equal(maxJump(output.slice(end - 8, end + 8)), 0, 'the gate cannot cut a nonzero sample');
      const targetHz = 440 * 2 ** ((midiNotes[i] - 69) / 12);
      const rootHz = 440 * 2 ** ((48 - 69) / 12);
      const actualHz = rootHz * (clock / 384 / 2048) * pitches[i].args[1] / 16000;
      assert(Math.abs(1200 * Math.log2(actualHz / targetHz)) < 1.5, 'PCM pitch remains within 1.5 cents');
      const steady = output.slice(start + 0.02 * sampleRate, start + 0.14 * sampleRate);
      assert(sineResidualDb(steady, actualHz) < -28, 'actual RF output follows the expected note frequency');
    }
    assert(maxJump(output) < 0.01, 'attack and release do not introduce large edges');

    // Previous starter: the same gate cut a looping, full-volume sine mid-cycle.
    control.reset();
    const previous = new Uint8Array(129);
    for (let i = 0; i < 128; i++) {const value = Math.sin(2 * Math.PI * i / 128); previous[i] = Math.round(Math.abs(value) * 100) | (value >= 0 ? 128 : 0);}
    previous[128] = 255; control.loadMemory(previous);
    control.setChannel(0, {start:0, loopStart:0, volume:100, pan:{left:15, right:15}, step:1053}); control.keyOn(0);
    const before = chip.generateStereo(sampleRate * 0.4).left; control.keyOff(0);
    const after = chip.generateStereo(8).left;
    assert(maxJump(new Float32Array([...before.slice(-8), ...after])) > 0.1, 'negative control reproduces the old loud release click');
  } finally {chip.dispose();}
});
