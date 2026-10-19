import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSampleInstrument} from './playground_sample_instrument.js';
import {encodeRf5c164} from './rf5c164_pcm.js';
import {encodeAdpcmB} from './adpcm_b_sample.js';
import {Rf5c164} from './rf5c164.js';
import {createRf5c164Control} from './playground_rf5c164.js';
import rfFactory from '../docs/generated/rf5c164_wasm.js';
import {Ym2608} from './ym2608.js';
import {YM2608Synth, YM2608DirectTransport} from './ym2608synth.js';
import {Ym2610B} from './ym2610b.js';
import {YM2610BSynth, YM2610BDirectTransport} from './ym2610bsynth.js';
import {GameboyApu} from './gameboyapu.js';
import {GameboySynth, GameboyDirectTransport} from './gameboysynth.js';
import gbFactory from '../docs/generated/gameboy_apu_wasm.js';
import {registerKeyboardScope} from './playground_keyboard.js';

const audio = ({frames = 4096, sampleRate = 16000, hz = 440, rootMidi = 69, ...metadata} = {}) => ({
  channels: [Float32Array.from({length: frames}, (_, i) => .6 * Math.sin(2 * Math.PI * hz * i / sampleRate))],
  sampleRate, rootMidi, ...metadata,
});
const event = (id, midi = 69, velocity = 127) => ({id, midi, velocity});
const peak = values => values.reduce((result, value) => Math.max(result, Math.abs(value)), 0);
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

async function rfFixture({native = false, overrides = {}} = {}) {
  const commands = [], loads = [];
  const chip = native ? await Rf5c164.create({moduleFactory: rfFactory, sampleRate: 48000,
    moduleOptions: {wasmBinary: await readFile(new URL('../docs/generated/rf5c164_wasm.wasm', import.meta.url))}}) : null;
  const control = chip ? createRf5c164Control(chip) : null;
  const pcm = {
    async loadSample(pcmAudio, options = {}) {
      const encoded = encodeRf5c164(pcmAudio);
      if (options.endGuardBytes) {
        const bytes=new Uint8Array(encoded.frames+Math.max(3,options.endGuardBytes));
        bytes.set(encoded.bytes.subarray(0,encoded.frames));bytes.fill(255,encoded.frames);encoded.bytes=bytes;
      }
      loads.push({pcmAudio, options, encoded});
      control?.loadMemory(encoded.bytes, 0);
      return {start: 0, loopStart: options.loopStart ?? encoded.frames + 1, step: encoded.step};
    },
    async loadMemory(bytes, address) { commands.push(['memory', address, bytes]); control?.loadMemory(bytes, address); },
    async keyOff(channel) { commands.push(['off', channel]); control?.keyOff(channel); },
    async keyOn(channel) { commands.push(['on', channel]); control?.keyOn(channel); },
    async setChannel(channel, options) { commands.push(['channel', channel, options]); control?.setChannel(channel, options); },
    ...overrides,
  };
  const pg = {async useSoundChip(name) { assert.equal(name, 'rf5c164'); return pcm; }};
  return {pg, pcm, commands, loads, chip};
}

test('RF sampler loads silently, tunes raw pitch in cents and scales MIDI velocity with stereo voices', async () => {
  const f = await rfFixture(), input = audio({tuneCents: 23});
  const original = input.channels[0].slice();
  const instrument = await createSampleInstrument({pg: f.pg, audio: input});
  assert.equal(f.commands.filter(command => command[0] === 'on').length, 0);
  assert.equal(f.loads[0].options.endGuardBytes,32);
  assert.equal(f.commands.filter(command=>command[0]==='memory').length,0,'sample and end guards load together');
  assert.deepEqual(input.channels[0], original);
  f.commands.length = 0;
  await instrument.noteOn(event('a', 69));
  await instrument.noteOn(event('b', 81, 64));
  const changes = f.commands.filter(command => command[0] === 'channel');
  const base = f.loads[0].encoded.step;
  assert.equal(changes[0][2].step, Math.round(base * 2 ** (-23 / 1200)));
  assert.equal(changes[1][2].step, Math.round(base * 2 ** ((1200 - 23) / 1200)));
  assert.equal(changes[0][2].volume, 72); assert.equal(changes[1][2].volume, Math.round(72 * 64 / 127));
  assert.deepEqual(changes[0][2].pan, {left: 15, right: 11});
  assert.deepEqual(changes[1][2].pan, {left: 11, right: 15});
});

test('RF eight-voice allocation ignores duplicate IDs and a stolen note cannot mute its replacement', async () => {
  const f = await rfFixture(), instrument = await createSampleInstrument({pg: f.pg, audio: audio()});
  f.commands.length = 0;
  for (let i = 0; i < 9; i++) await instrument.noteOn(event(String(i), 60 + i));
  assert.deepEqual(f.commands.filter(command => command[0] === 'on').map(command => command[1]), [0, 1, 2, 3, 4, 5, 6, 7, 0]);
  const length = f.commands.length;
  await instrument.noteOn(event('8', 68)); await instrument.noteOff({id: '0'});
  assert.equal(f.commands.length, length);
  await instrument.noteOff({id: '8'});
  assert.deepEqual(f.commands.at(-1), ['off', 0]);
});

test('retiring an RF instrument invalidates delayed on/off jobs before posting immediate silence', async () => {
  let enter, release;
  const entered = new Promise(resolve => {enter = resolve;});
  const pending = new Promise(resolve => {release = resolve;});
  let calls = 0;
  const f = await rfFixture({overrides: {async setChannel(channel, settings) {
    f.commands.push(['channel', channel, settings]);
    if (++calls === 1) {enter(); await pending;}
  }}});
  const instrument = await createSampleInstrument({pg: f.pg, audio: audio()});
  const first = instrument.noteOn(event('old'));
  await entered;
  const off = instrument.noteOff({id: 'old'});
  await instrument.allNotesOff();
  await instrument.noteOn(event('new'));
  assert.deepEqual(f.commands.at(-1), ['on', 0]);
  const length = f.commands.length;
  release();
  await Promise.all([first, off]);
  assert.equal(f.commands.length, length, 'retired callbacks never touch the new voice');
  await instrument.noteOff({id: 'new'});
  assert.deepEqual(f.commands.at(-1), ['off', 0]);
});

test('RF native eight-voice full-scale output has headroom and releasing every key produces silence', async () => {
  const f = await rfFixture({native: true});
  try {
    const input = audio(); input.channels[0].fill(1);
    const instrument = await createSampleInstrument({pg: f.pg, audio: input});
    for (let i = 0; i < 8; i++) await instrument.noteOn(event(String(i), 69 + i));
    const output = f.chip.generateStereo(2048);
    assert.ok(peak(output.left) > .8 && peak(output.left) < .99);
    assert.ok(output.left.every(Number.isFinite) && output.right.every(Number.isFinite));
    await instrument.allNotesOff();
    f.chip.generateStereo(128);
    assert.equal(peak(f.chip.generateStereo(128).left), 0);
  } finally { f.chip.dispose(); }
});

test('RF high pitches hit end guards: one-shots stop and selected loops sustain within loaded RAM', async () => {
  for (const looping of [false, true]) {
    const f = await rfFixture({native: true});
    try {
      const input = audio({frames: 256, rootMidi: 0, loopEnabled: looping, loopStartFrame: 32, loopEndFrame: 192});
      const instrument = await createSampleInstrument({pg: f.pg, audio: input});
      await instrument.noteOn(event('high', 127)); // Saturates the actual 16-bit RF step.
      let audible = 0;
      for (let i = 0; i < 100; i++) {
        const output = f.chip.generateStereo(960);
        const address = f.chip.read(0) | f.chip.read(1) << 8;
        assert.ok(address < (looping ? 224 : 288), `sample address ${address} stayed in waveform/guard RAM`);
        if (rms(output.left) > .01) audible++;
      }
      assert.equal(audible, looping ? 100 : 0, looping ? 'the chosen loop keeps playing' : 'the one-shot stays silent after its short initial samples');
      assert.equal(f.loads[0].pcmAudio.channels[0].length, looping ? 192 : 256);
    } finally { f.chip.dispose(); }
  }
});

test('RF memory overflow is explicit and never silently truncates source audio', async () => {
  const f = await rfFixture();
  await assert.rejects(createSampleInstrument({pg: f.pg, audio: audio({frames: 65505})}), /65504/);
  assert.equal(f.loads.length, 0);
  const exact = await createSampleInstrument({pg: f.pg, audio: audio({frames: 65504})});
  assert.match(exact.name, /RF5C164/);
});

test('every synchronous Game Boy command retains its musical-input lease across FIFO awaits', async () => {
  let context = null;
  const calls = [];
  const command = name => () => {calls.push([name, context]);};
  const gameboy = {setPan: command('pan'), wave: {
    keyOff: command('off'), stopAndSetWaveform: command('upload'), setNote: command('note'),
    setLevel: command('level'), keyOn: command('on'),
  }};
  const pg = {gameboy};
  registerKeyboardScope(pg, () => context, next => {context = next;});
  const instrument = await createSampleInstrument({pg, audio: audio({waveform: new Uint8Array(32).fill(8)}), chip: 'gameboy'});
  calls.length = 0;
  const lease = {keyboard: true, id: 'press'}, background = {id: 'background-loop'};
  context = lease;
  const press = instrument.noteOn(event('a'));
  context = background;
  await press;
  assert.deepEqual(calls.map(([name]) => name), ['off', 'note', 'level', 'on']);
  assert.ok(calls.every(([, actual]) => actual === lease), 'each synchronous setter runs in the captured press lease');
  assert.equal(context, background);
  calls.length = 0;
  context = lease;
  const release = instrument.noteOff({id: 'a'});
  context = background;
  await release;
  assert.deepEqual(calls, [['off', lease]]);
  assert.equal(context, background);
});

for (const chipName of ['ym2608', 'ym2610b']) test(`${chipName} real ADPCM-B uses aligned encoded silence and plays pitched source audio`, async () => {
  const neo = chipName === 'ym2610b';
  const {default: moduleFactory} = await import(`../docs/generated/${chipName}_wasm.js`);
  const options = {moduleFactory, moduleOptions: {wasmBinary: await readFile(new URL(`../docs/generated/${chipName}_wasm.wasm`, import.meta.url))}};
  const chip = await (neo ? Ym2610B : Ym2608).create(options);
  const synth = neo ? new YM2610BSynth({transport: new YM2610BDirectTransport(chip)}) : new YM2608Synth({transport: new YM2608DirectTransport(chip)});
  const section = neo ? synth.adpcmB : synth.adpcm;
  const loads = [], ranges = [], rates = [];
  const api = Object.fromEntries(['keyOff','setPan','setVolume','keyOn'].map(name => [name, section[name].bind(section)]));
  api.loadMemory = (bytes, address) => {loads.push(bytes.slice()); return section.loadMemory(bytes, address);};
  api.setSample = range => {ranges.push(range); return section.setSample(range);};
  api.setPlaybackRate = rate => {rates.push(rate); return section.setPlaybackRate(rate);};
  try {
    const input = audio({frames: 513, sampleRate: 8000, hz: 440});
    const instrument = await createSampleInstrument({pg: neo ? {adpcmB: api} : {adpcm: api}, audio: input, chip: chipName});
    assert.equal(loads[0].length % (neo ? 256 : 32), 0);
    assert.deepEqual(ranges[0], {start: 0, end: loads[0].length});
    const padded = new Float32Array(neo ? 1024 : 576); padded.set(input.channels[0]);
    assert.deepEqual(loads[0], encodeAdpcmB({channels: [padded], sampleRate: 8000}, 8000).bytes, 'padding is PCM silence encoded with continuous decoder history');
    assert.ok(loads[0].slice(-32).some(byte => byte !== 0), 'zero encoded bytes were never appended as fake silence');
    await instrument.noteOn(event('a', 69));
    assert.equal(rates.at(-1), 8000);
    const rate = chip.sampleRate(), first = chip.generateStereo(Math.round(rate * .03));
    assert.ok(peak(first.left) > .01);
    chip.generateStereo(Math.round(rate * .055));
    assert.ok(rms(chip.generateStereo(Math.round(rate * .02)).left) < .004, 'aligned padding converges to silence');
    await instrument.noteOn(event('b', 81));
    assert.equal(rates.at(-1), 16000);
    await instrument.noteOff({id: 'a'});
    assert.ok(peak(chip.generateStereo(Math.round(rate * .01)).left) > .01, 'old note-off leaves its replacement sounding');
    await instrument.allNotesOff(); chip.generateStereo(512);
    assert.equal(peak(chip.generateStereo(512).left), 0);
    const repeating = await createSampleInstrument({pg: neo ? {adpcmB: api} : {adpcm: api},
      audio: {...input, loopEnabled: true, loopStartFrame: 0, loopEndFrame: 513}, chip: chipName});
    await repeating.noteOn(event('repeat', 69));
    chip.generateStereo(Math.round(rate * .25));
    let audible = 0;
    for (let i = 0; i < 20; i++) if (peak(chip.generateStereo(Math.round(rate * .02)).left) > .01) audible++;
    assert.ok(audible > 3, 'whole-range repeat keeps sounding beyond the one-shot duration');
    await repeating.allNotesOff();
    await assert.rejects(createSampleInstrument({pg: neo ? {adpcmB: api} : {adpcm: api}, audio: {...input, loopEnabled: true, loopStartFrame: 1}, chip: chipName}), /whole sample/);
  } finally { chip.dispose(); }
});

for (const primary of [true, false]) test(`Game Boy ${primary ? 'primary' : 'independent'} wave RAM uses the edited cycle and ignores a stolen key release`, async () => {
  const chip = await GameboyApu.create({moduleFactory: gbFactory, sampleRate: 48000,
    moduleOptions: {wasmBinary: await readFile(new URL('../docs/generated/gameboy_apu_wasm.wasm', import.meta.url))}});
  const gameboy = new GameboySynth({transport: new GameboyDirectTransport(chip)});
  if (primary) gameboy.initialize();
  try {
    const input = audio({frames: 128, sampleRate: 32000, hz: 250});
    const pg = primary ? {gameboy} : {async useSoundChip(name) {assert.equal(name, 'gameboy'); return gameboy;}};
    const instrument = await createSampleInstrument({pg, audio: input, chip: 'gameboy'});
    assert.equal(peak(chip.generateStereo(512).left), 0, 'wave upload never auto-plays');
    await instrument.noteOn(event('a', 69));
    assert.ok(rms(chip.generateStereo(2048).left) > .01);
    await instrument.noteOn(event('b', 81));
    await instrument.noteOff({id: 'a'});
    assert.ok(rms(chip.generateStereo(2048).left) > .01);
    await instrument.noteOff({id: 'b'});
    chip.generateStereo(8192);
    assert.ok(peak(chip.generateStereo(512).left) < .001);
  } finally { chip.dispose(); }
});
