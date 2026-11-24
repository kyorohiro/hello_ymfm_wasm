// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import factory from '../generated/ym2610b_wasm.js';
import { Ym2610B } from '../js/ym2610b.js';
import { YM2610BDirectTransport, YM2610BSynth } from '../js/ym2610bsynth.js';
import { encodeSampleWav } from '../js/playground_sample_edit.js';
import { readSamplePCM } from '../js/adpcm_b_sample.js';
import { decodeAdpcm } from '../synth-fm2608/preset.js';
import { FM2610_ADPCM_B_MAX_RATE, createFm2610AdpcmB } from './adpcm_b.js';

const wav = encodeSampleWav({
  sampleRate: 16000,
  channels: [Float32Array.from({length: 513}, (_, frame) => .8 * Math.sin(frame / 16))],
});

test('ADPCM-B sample imports align to hardware pages and replacement fences earlier decodes', async () => {
  const adapter = createFm2610AdpcmB({sound: () => assert.fail('Sample selection should not open audio.')});
  const builtin = adapter.getSample();
  let finish;
  class DelayedWav extends Blob {
    arrayBuffer() { return new Promise(resolve => { finish = resolve; }); }
  }
  const pending = adapter.loadSample(new DelayedWav([wav]), {name: 'Earlier.wav'});
  adapter.setSettings({rootNote: 60, volume: 21, repeat: true});
  const settings = await adapter.loadSample(wav, {name: 'Later.wav'});
  finish(wav.buffer);
  await assert.rejects(pending, {name: 'AbortError'});
  const deltaN = Math.round(16000 * 144 * 65536 / 8000000);
  assert.deepEqual(settings, {name: 'Later.wav', sampleRate: 16000, rootNote: 60, volume: 21, repeat: true, byteLength: 512,
    sampleStart: 0xc00000, sampleEnd: 0xc00200, start: 0xc00000, end: 0xc00200,
    deltaN, activeDeltaN: deltaN, playbackRate: deltaN * 8000000 / (144 * 65536), keyed: false});
  const sample = adapter.getSample();
  assert.throws(() => adapter.applySample({...sample, bytes: sample.bytes.subarray(1)}), /aligned/);
  assert.deepEqual(adapter.getSample(), sample);
  sample.bytes[0] ^= 255;
  assert.notEqual(adapter.getSample().bytes[0], sample.bytes[0]);

  const caller = new AbortController();
  const canceled = adapter.loadSample(new DelayedWav([wav]), {name: 'Canceled.wav', signal: caller.signal});
  caller.abort();
  finish(wav.buffer);
  await assert.rejects(canceled, {name: 'AbortError'});
  assert.equal(adapter.getSettings().name, 'Later.wav');
  adapter.applySample(null);
  assert.deepEqual(adapter.getSample(), builtin);
});

test('ADPCM-B waveform summarizes every decoded frame and survives sample restoration', async () => {
  const adapter = createFm2610AdpcmB({sound: () => assert.fail('A waveform preview should not open audio.')});
  const {signal} = new AbortController();
  const builtin = await adapter.getWaveform(signal);
  await adapter.loadSample(wav, {name: 'Sine.wav'});
  const sample = adapter.getSample();
  const frames = decodeAdpcm(sample.bytes);
  const peaks = await adapter.getWaveform(signal);
  const columns = peaks.length / 2;
  assert.equal(columns, 768);
  for (let column = 0; column < columns; column++) {
    const bucket = frames.subarray(Math.floor(column * frames.length / columns),
      Math.floor((column + 1) * frames.length / columns));
    assert.equal(peaks[2 * column], Math.min(...bucket));
    assert.equal(peaks[2 * column + 1], Math.max(...bucket));
  }
  assert.notDeepEqual(peaks, builtin);
  adapter.applySample(null);
  assert.deepEqual(await adapter.getWaveform(signal), builtin);
  adapter.applySample(sample);
  adapter.setSettings({sampleRate: 8000, volume: 0, repeat: true});
  adapter.setRange({start: adapter.getSettings().sampleStart + 256});
  assert.deepEqual(await adapter.getWaveform(signal), peaks);
});

test('drawing preserves ADPCM-B settings and the held ROM, and WAV exports the trimmed first pass', async () => {
  const events = [];
  const chip = {
    clock: 8000000,
    loadMemory(bytes, address) { events.push(['load', bytes.slice(), address]); },
    keyOff() { events.push(['off']); },
    keyOn({repeat}) { events.push(['on', repeat]); },
    setSample(range) { events.push(['range', range]); },
    setDeltaN() {},
    setVolume() {},
    setPan() {},
  };
  const adapter = createFm2610AdpcmB({sound: async () => ({adpcmB: chip})});
  await adapter.loadSample(wav, {name: 'Drawing.wav'});
  adapter.setSettings({rootNote: 66, volume: 127, repeat: true, left: false, right: true});
  adapter.setDeltaN(13553);
  adapter.setRange({start: 0xc00100});
  const before = adapter.getSample();
  await adapter.noteOn(66, 'held');
  const held = events.slice();
  const {signal} = new AbortController();
  assert(await adapter.drawWave([{position: .55, amplitude: .85}, {position: .9, amplitude: -.85}], signal));
  const after = adapter.getSample();
  assert.equal(after.bytes.length, before.bytes.length);
  assert.notDeepEqual(after.bytes, before.bytes);
  assert.deepEqual({...after, bytes: before.bytes}, before, 'a drawing changes only the encoded sample');
  assert.deepEqual(events, held, 'the held voice must keep its original differential stream');
  assert.equal(adapter.getSettings().keyed, true);
  assert.equal(await adapter.drawWave([], signal), false);

  const exported = await readSamplePCM(await adapter.exportWave(signal));
  const firstPass = decodeAdpcm(after.bytes.subarray(256));
  assert.equal(exported.sampleRate, Math.round(after.sampleRate));
  assert.equal(exported.channels.length, 1);
  assert.equal(exported.channels[0].length, firstPass.length);
  firstPass.forEach((value, frame) => assert.ok(Math.abs(exported.channels[0][frame] - value) <= 1 / 32768));

  adapter.noteOff('held');
  assert(await adapter.noteOn(66, 'edited'));
  assert.deepEqual(events.filter(([kind]) => kind === 'load').at(-1), ['load', after.bytes, 0xc00000]);
  assert.deepEqual(events.slice(-2), [['range', {start: 0xc00100, end: 0xc00200}], ['on', true]]);
});

test('ADPCM-B mono ownership cancels a pending ROM trigger on replacement or key-up', async () => {
  let finish;
  const calls = [];
  const chip = {
    clock: 8000000,
    loadMemory() { return new Promise(resolve => { finish = resolve; }); },
    keyOff() { calls.push('off'); },
    keyOn() { calls.push('on'); },
    setSample() {},
    setDeltaN() {},
    setVolume() {},
    setPan() {},
  };
  const adapter = createFm2610AdpcmB({sound: async () => ({adpcmB: chip})});
  const previous = adapter.noteOn(60, 'first');
  await Promise.resolve();
  const current = adapter.noteOn(63, 'latest');
  adapter.noteOff('first');
  finish();
  assert.equal(await previous, false);
  assert.equal(await current, true);
  assert.deepEqual(calls, ['off', 'on']);
  adapter.noteOff('latest');
  assert.equal(calls.at(-1), 'off');

  adapter.invalidate();
  const pending = adapter.noteOn(60, 'held');
  await Promise.resolve();
  adapter.noteOff('held');
  finish();
  assert.equal(await pending, false);
  assert.equal(calls.filter(call => call === 'on').length, 1);

  adapter.invalidate();
  const replaced = adapter.play();
  await Promise.resolve();
  adapter.applySample(null);
  finish();
  assert.equal(await replaced, false);
  assert.equal(calls.filter(call => call === 'on').length, 1);
});

test('a captured ADPCM-B sample retains its exact chip rate and editable working parameters', async () => {
  const calls = [];
  const gates = [];
  const clockHz = 16000000, deltaN = 50000;
  const address = 0x123400;
  const chip = {
    clock: clockHz,
    loadMemory(bytes, address) { calls.push(['load', bytes[0], address]); },
    setSample({start, end}) { calls.push(['range', start, end]); },
    setDeltaN(value) { calls.push(['rate', value]); },
    setVolume(value) { calls.push(['level', value]); },
    setPan(left, right) { calls.push(['pan', left, right]); },
    keyOn({repeat}) { calls.push(['on', repeat]); },
    keyOff() { calls.push(['off']); },
  };
  const endpoint = {adpcmB: null};
  const adapter = createFm2610AdpcmB({sound: async () => endpoint, getMode: () => 'ym2610',
    onKeyLatchChange: keyed => gates.push([keyed, adapter.getSettings().keyed]),
    referenceChip: {
      load(actual, profile) {
        assert.strictEqual(actual, endpoint);
        assert.deepEqual(profile, {variant: 'ym2610', clockHz});
        return {fm: {adpcmB: chip}};
      },
      close() {},
    }});
  const sampleRate = deltaN * clockHz / (144 * 65536);
  adapter.applySample({name: 'VGM sample', bytes: new Uint8Array(512).fill(0x31), address,
    rootNote: 60, volume: 88, sampleRate, clockHz, repeat: true, left: true, right: false});
  const initial = adapter.getSettings();
  assert.equal(initial.sampleStart, address);
  assert.equal(initial.sampleEnd, address + 512);
  await adapter.prepare();
  assert.equal(await adapter.noteOn(60, 'root'), true);
  assert.deepEqual(calls, [['off'], ['load', 0x31, 0], ['range', 0, 512],
    ['rate', deltaN], ['level', 88], ['pan', true, false], ['on', true]]);

  const callCount = calls.length;
  adapter.setRange({start: address + 256});
  assert.throws(() => adapter.setRange({end: address + 768}), /inside the loaded ROM sample/);
  assert.throws(() => adapter.setRange({start: address + 1}), /aligned/);
  assert.equal(adapter.getSettings().start, address + 256);
  assert.equal(adapter.getSample().bytes.length, 512);
  assert.equal(calls.length, callCount, 'range edits must wait until the next key on');

  adapter.setSettings({rootNote: 72, left: false, right: true, volume: 31});
  assert.deepEqual(calls.slice(-3), [['level', 31], ['pan', false, true], ['rate', deltaN / 2]]);
  assert.equal(adapter.getSettings().activeDeltaN, deltaN / 2);
  assert.equal(adapter.getSettings().playbackRate, sampleRate / 2);
  adapter.noteOff('root');
  assert.deepEqual(calls.at(-1), ['off']);
  assert.deepEqual(gates, [[true, true], [false, false]]);
  assert.equal(adapter.getSettings().activeDeltaN, deltaN);
  assert.equal(adapter.getSettings().playbackRate, sampleRate);
  assert.equal(adapter.getSample().sampleRate, sampleRate);
  assert.equal(await adapter.play(), true);
  assert.deepEqual(calls.filter(([kind]) => kind === 'range').at(-1), ['range', 256, 512]);
  assert.equal(calls.filter(([kind]) => kind === 'load').length, 1);

  await adapter.loadSample(wav, {name: 'Replacement.wav'});
  const replacement = adapter.getSample();
  assert.equal(replacement.clockHz, undefined);
  assert.equal(replacement.sampleRate, 16000);
  assert.equal(replacement.right, true);
  assert.equal(replacement.left, false);
  assert.equal(replacement.address, undefined);
  assert.equal(replacement.start, undefined);
  assert.equal(adapter.getSettings().start, 0xc00000);
});

test('raw Delta-N spans 1 to 65535 and retains an exact quantized base rate', () => {
  const adapter = createFm2610AdpcmB({sound: () => assert.fail('Rate edits should not open audio.')});
  assert.throws(() => adapter.setDeltaN(0), /Delta-N/);
  assert.throws(() => adapter.setDeltaN(65536), /Delta-N/);
  for (const deltaN of [1, 65535]) {
    const settings = adapter.setDeltaN(deltaN);
    const exactRate = deltaN * 8000000 / (144 * 65536);
    assert.equal(settings.deltaN, deltaN);
    assert.equal(settings.sampleRate, exactRate);
    assert.equal(settings.playbackRate, exactRate);
    assert.equal(adapter.getSample().deltaN, deltaN);
  }
  adapter.setSettings({sampleRate: 12000});
  assert.equal(adapter.getSample().deltaN, undefined);
  assert.equal(adapter.getSettings().deltaN, Math.round(12000 * 144 * 65536 / 8000000));
});

for (const variant of [false, true]) {
  test(`${variant ? 'YM2610B' : 'YM2610'} ADPCM-B plays and loops the reserved ROM with quantized keyboard pitch`, async () => {
    const wasmBinary = await readFile(new URL('../generated/ym2610b_wasm.wasm', import.meta.url));
    const core = await Ym2610B.create({moduleFactory: factory, moduleOptions: {wasmBinary}, variant});
    try {
      const transport = new YM2610BDirectTransport(core);
      const load = transport.loadAdpcmMemory.bind(transport);
      let uploads = 0;
      transport.loadAdpcmMemory = (type, ...args) => {
        assert.equal(type, 1);
        uploads++;
        return load(type, ...args);
      };
      const {adpcmB} = new YM2610BSynth({transport});
      const adapter = createFm2610AdpcmB({sound: async () => ({adpcmB})});
      await adapter.loadSample(wav, {name: 'Sine.wav'});
      adapter.setSettings({rootNote: 60, repeat: true});
      assert.equal(await adapter.noteOn(72, 'upper'), true);
      const deltaN = () => adpcmB.registers[9] | adpcmB.registers[10] << 8;
      assert.equal(deltaN(), Math.round(32000 * 144 * 65536 / 8000000));
      assert.equal(adpcmB.registers[0], 0xb0);
      assert.equal(adpcmB.registers[2] | adpcmB.registers[3] << 8, 0xc000);
      assert.equal(adpcmB.registers[4] | adpcmB.registers[5] << 8, 0xc001);
      adapter.setRange({start: 0xc00100});
      assert.equal(adpcmB.registers[2] | adpcmB.registers[3] << 8, 0xc000, 'range waits for a new key on');
      core.generateStereo(50000);
      assert.ok(core.generateStereo(1024).left.some(value => Math.abs(value) > .01), 'Repeat runs beyond the first pass');
      adapter.setSettings({volume: 42, sampleRate: FM2610_ADPCM_B_MAX_RATE});
      assert.equal(adpcmB.registers[11], 42);
      assert.equal(deltaN(), 65535);
      adapter.noteOff('wrong-owner');
      assert.equal(adpcmB.registers[0], 0xb0);
      adapter.noteOff('upper');
      assert.equal(adpcmB.registers[0], 1);
      adapter.setSettings({sampleRate: 1, rootNote: 127, repeat: false});
      assert.equal(await adapter.noteOn(0, 'lower'), true);
      assert.equal(deltaN(), 1);
      assert.equal(adpcmB.registers[0], 0xa0);
      assert.equal(adpcmB.registers[2] | adpcmB.registers[3] << 8, 0xc001);
      assert.equal(adpcmB.registers[4] | adpcmB.registers[5] << 8, 0xc001);
      assert.equal(uploads, 1, 'Metadata and note changes retain the loaded ROM');
      adapter.invalidate();
      assert.equal(await adapter.play(), true);
      assert.equal(uploads, 2);
      adapter.stop();
    } finally {
      core.dispose();
    }
  });
}
