// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import test from 'node:test';
import { NeoGeoFMSynth, YM2610BSynth } from '../js/ym2610bsynth.js';
import { createNativeFXController } from '../js/native_fx.js';
import { observeFm2610Writes } from './audio.js';
import { setupFm2610Code } from './code.js';
import { createFm2610CodeRoute } from './code_fx.js';

function audioFixture({loadAdpcmMemory = () => Promise.resolve()} = {}) {
  const writes = [];
  const context = {currentTime: 1, sampleRate: 48000};
  const transport = {
    write(port, register, value) { writes.push({port, register, value}); },
    writeBatch(batch) { writes.push(...batch); },
    reset() {},
    loadAdpcmMemory,
  };
  const rawFm = new YM2610BSynth({transport});
  const fm = new NeoGeoFMSynth(rawFm);
  const {ssg, adpcmA, adpcmB} = rawFm;
  const audio = {fm, ssg, adpcmA, adpcmB, context,
    ...observeFm2610Writes(transport, 'ym2610', rawFm.clock, context)};
  return {audio, writes};
}

function routeNode() {
  const outputs = new Set();
  return {outputs, connect: node => outputs.add(node), disconnect: node => {
    assert(outputs.delete(node), 'disconnect only an owned, connected route');
  }};
}

test('Code FX rewires only the OPNB mixer input', () => {
  const chip = routeNode(), analyser = routeNode(), mixer = routeNode(), wet = routeNode(), song = routeNode();
  chip.connect(analyser);
  song.connect(mixer);
  const route = createFm2610CodeRoute(chip, mixer);
  assert.deepEqual(chip.outputs, new Set([analyser, mixer]));
  route.setEffect(wet);
  assert.deepEqual(chip.outputs, new Set([analyser, wet]));
  assert.deepEqual(wet.outputs, new Set([mixer]));
  assert.deepEqual(song.outputs, new Set([mixer]));
  route.setEffect(null);
  assert.deepEqual(chip.outputs, new Set([analyser, mixer]));
  assert.deepEqual(wet.outputs, new Set());
  route.dispose();
  route.setEffect(wet);
  assert.deepEqual(chip.outputs, new Set([analyser]));
});

test('Code Run and Apply use the same native FX rack until Stop retires the route', async () => {
  const {audio} = audioFixture();
  const routes = [], messages = [], racks = [];
  audio.setCodeEffect = output => routes.push(output);
  const button = () => ({addEventListener() {}});
  const textarea = {value: `
    setBpm(96);
    context.gain = fx.gain({gain: .4});
    fx.setChain([context.gain]);
    liveFx('level', {process(input, output) { output[0].set(input[0]); }});
  `};
  const code = setupFm2610Code({
    textarea, runButton: button(), applyButton: button(), stopButton: button(), status: {}, output: {},
    sound: () => audio, getMode: () => 'ym2610', stopSound() {},
    createFxRack() {
      const rack = {node: {}, stopped: false, closed: false,
        stop() { this.stopped = true; }, dispose() { this.closed = true; }};
      rack.controller = createNativeFXController(message => messages.push(message),
        {getBeatSeconds: () => rack.getBeatSeconds()});
      racks.push(rack);
      return rack;
    },
  });
  await code.run();
  assert.equal(racks.length, 1);
  assert.strictEqual(routes.at(-1), racks[0].node);
  assert.equal(messages.find(message => message.op === 'chain').beatSeconds, .625);
  assert.equal(messages.find(message => message.op === 'live-fx').name, 'level');
  textarea.value = 'context.gain.gain.set(.2); fx.setChain([context.gain]);';
  await code.apply();
  assert.equal(racks.length, 1);
  assert(messages.some(message => message.op === 'parameter' && message.value === .2));
  assert(messages.some(message => message.op === 'live-fx' && message.action === 'remove'));
  assert.strictEqual(routes.at(-1), racks[0].node);
  await code.stop();
  assert.equal(routes.at(-1), null);
  assert.equal(racks[0].stopped, true);
  assert.equal(racks[0].closed, true);
});

test('stopping Code first retains the final FM, SSG and ADPCM settings and uploaded data', async () => {
  const {audio, writes} = audioFixture();
  const button = () => ({addEventListener() {}});
  const textarea = {value: `
    const chip = await useSoundChip("ym2610");
    chip.fm.setAlgo(CH1, 6, 3);
    chip.fm.noteOn(CH1, "C4");
    chip.ssg.tone(CH2, {period: 137, volume: 9});
    const sample = new Uint8Array(512).fill(0x23);
    const loaded = chip.adpcmA.loadMemory(sample, 0x400);
    sample.fill(0x80);
    await loaded;
    chip.adpcmA.setSample(2, {start: 0x400, end: 0x500});
    chip.adpcmA.setVoice(2, {volume: 11, left: true, right: false});
    chip.adpcmA.keyOn(2);
    await chip.adpcmB.loadMemory(sample, 0x800);
    chip.fm.write(0, 0x12, 8);
    chip.fm.write(0, 0x14, 9);
    chip.adpcmB.setPan(true, false);
    chip.adpcmB.setDeltaN(0x2345);
    chip.adpcmB.setVolume(90);
    chip.adpcmB.keyOn({repeat: true});
  `};

  const code = setupFm2610Code({
    textarea, runButton: button(), stopButton: button(), status: {}, output: {},
    sound: () => audio, getMode: () => 'ym2610',
    stopSound(endpoint) {
      endpoint.fm.noteOff(0);
      endpoint.fm.setAlgo(0, 0, 0);
      endpoint.ssg.keyOff(1);
      endpoint.adpcmA.keyOff([0, 1, 2, 3, 4, 5]);
      endpoint.adpcmB.keyOff();
    },
  });

  assert.equal((await code.run()).status, 'Code applied.');
  assert.equal(code.hasRetainedSnapshot(), false);
  const live = code.getSnapshot();
  assert.equal(live.channels[0].physicalChannel, 1);
  assert.equal(live.channels[0].preset.algorithm, 6);
  assert.equal(live.channels[0].codeGate, true);
  assert.equal(live.ssg.channels[1].period, 137);
  assert.equal(live.ssg.channels[1].level, 9);
  assert.deepEqual(live.adpcmSources, {a: true, b: true});
  assert.equal(live.adpcm.adpcmA.voices[2].volume, 11);
  assert.equal(live.adpcm.adpcmB.deltaN, 0x2345);
  assert.equal(live.adpcm.adpcmB.repeat, true);
  const custom = {start: 0x500, end: 0x600};
  assert.equal(code.readAdpcmABytes(live, 2, custom), null);

  await code.stop();
  assert.equal(code.hasRetainedSnapshot(), true);
  assert.strictEqual(code.getSnapshot(), live);
  assert.ok(writes.some(({port, register, value}) => port === 0 && register === 0x28 && value === 1));
  assert.deepEqual(writes.slice(-3), [
    {port: 0, register: 9, value: 0},
    {port: 1, register: 0, value: 0xbf},
    {port: 0, register: 0x10, value: 1},
  ]);
  assert.equal(code.readAdpcmABytes(live, 2, custom)?.[0], 0x23);
  assert.equal(code.readAdpcmBBytes(live)?.[511], 0x80);

  textarea.value = 'const chip = await useSoundChip("ym2610"); chip.fm.setAlgo(CH1, 1, 0);';
  await code.run();
  const next = code.getSnapshot();
  assert.equal(code.hasRetainedSnapshot(), false);
  assert.equal(next.ssg, null);
  assert.deepEqual(next.adpcmSources, {a: false, b: false});
  assert.equal(code.readAdpcmABytes(live, 2), null);
  await code.stop();
  code.clearSnapshot();
  assert.equal(code.getSnapshot(), null);
});

test('a late ADPCM upload reaches active chip memory and leaves the stopped snapshot unchanged', async () => {
  const {promise, resolve} = Promise.withResolvers();
  const {audio} = audioFixture({loadAdpcmMemory: () => promise});
  const first = audio.beginCodeObservation();
  const ready = audio.withCodeWrites(() => audio.adpcmA.loadMemory(new Uint8Array(256)));
  first.finish();
  const second = audio.beginCodeObservation();
  const pendingMemory = second.getSnapshot();
  resolve();
  await ready;
  assert.equal(first.getSnapshot().adpcm.adpcmA.voices[0].available, false);
  assert.equal(pendingMemory.adpcm.adpcmA.voices[0].available, false);
  assert.equal(second.getSnapshot().adpcm.adpcmA.voices[0].available, true);
  assert.deepEqual(second.getSnapshot().adpcmSources, {a: false, b: false});
});

test('Apply keeps the Code session, its context and the observed chip state', async () => {
  const {audio, writes} = audioFixture();
  const button = () => ({addEventListener() {}});
  const applyButton = button();
  const textarea = {value: `
    const chip = await useSoundChip("ym2610");
    context.level = 7;
    chip.ssg.tone(CH1, {period: 220, volume: context.level});
  `};
  let starts = 0, stops = 0;
  const code = setupFm2610Code({
    textarea, runButton: button(), applyButton, stopButton: button(), status: {}, output: {},
    sound: () => audio, getMode: () => 'ym2610',
    beforeRun() { starts++; },
    stopSound() { stops++; },
  });
  assert.equal(applyButton.disabled, true);
  await code.run();
  assert.equal(applyButton.disabled, false);
  textarea.value = `
    const chip = await useSoundChip("ym2610");
    chip.adpcmB.setVolume(++context.level);
  `;
  await code.apply();
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  assert.equal(code.getSnapshot().ssg.channels[0].level, 7);
  assert.equal(code.getSnapshot().adpcm.adpcmB.volume, 8);
  assert.ok(writes.some(({port, register, value}) => port === 0 && register === 0x1b && value === 8));
  await code.stop();
  assert.equal(stops, 1);
  assert.equal(applyButton.disabled, true);
  assert.equal(code.getSnapshot().adpcm.adpcmB.volume, 8);
});

test('later Code borrows existing ADPCM A/B ROM through reset and isolates overwritten pages', async () => {
  const {audio} = audioFixture();
  await audio.adpcmA.loadMemory(new Uint8Array(256).fill(0x22));
  await audio.adpcmB.loadMemory(new Uint8Array(256).fill(0x44));
  const first = audio.beginCodeObservation();
  audio.withCodeWrites(() => audio.fm.reset());
  first.finish();
  const previous = first.getSnapshot();

  const second = audio.beginCodeObservation();
  audio.withCodeWrites(() => {
    audio.adpcmA.keyOn([0]);
    audio.adpcmB.keyOn();
  });
  const inherited = second.getSnapshot();
  assert.deepEqual(inherited.adpcmSources, {a: true, b: true});
  assert.strictEqual(inherited.adpcm.adpcmA.rom, previous.adpcm.adpcmA.rom);
  assert.equal(second.readAdpcmABytes(0, inherited.adpcm.adpcmA)?.[0], 0x22);
  assert.equal(second.readAdpcmBBytes(inherited.adpcm.adpcmB)?.[0], 0x44);

  await audio.withCodeWrites(() => audio.adpcmA.loadMemory(new Uint8Array(256).fill(0x66)));
  const changed = second.getSnapshot();
  assert.notStrictEqual(changed.adpcm.adpcmA.rom, inherited.adpcm.adpcmA.rom);
  assert.strictEqual(changed.adpcm.adpcmB.rom, inherited.adpcm.adpcmB.rom);
  assert.equal(second.readAdpcmABytes(0, changed.adpcm.adpcmA)?.[0], 0x66);
  assert.strictEqual(first.getSnapshot(), previous);
  assert.equal(first.readAdpcmABytes(0, previous.adpcm.adpcmA)?.[0], 0x22);
  assert.equal(first.readAdpcmBBytes(previous.adpcm.adpcmB)?.[0], 0x44);
});
