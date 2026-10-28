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
import {registerKeyboardScope, createMusicalKeyboard, keyboardBinding} from './playground_keyboard.js';
import {renderPs1Sample} from './playground_sample_ps1.js';
import {Ps1Spu} from './ps1_spu.js';
import {Ps1Synth, preparePs1ADPCM, createPs1InitSample} from './ps1synth.js';

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

let ps1Module;
async function ps1Fixture({primary = true, native = false, overrides = {}} = {}) {
  const commands = [], loads = [], samples = [], presets = new Map(), requests = [], reads = [];
  const ram = new Uint8Array(524288);
  let synth = null, core = null;
  if (native) {
    ps1Module ??= Promise.all([import('../docs/generated/ps1_spu_wasm.js'), readFile(new URL('../docs/generated/ps1_spu_wasm.wasm', import.meta.url))])
      .then(([{default: factory}, wasmBinary]) => factory({wasmBinary}));
    core = await Ps1Spu.create({moduleFactory: () => ps1Module});
    synth = new Ps1Synth({core});
  }
  const spu = {
    async loadADPCM(bytes, options) {
      const prepared = preparePs1ADPCM(bytes, options);
      loads.push({bytes: bytes.slice(), options: {...options}});
      const startAddress = 0x1000 + samples.reduce((sum, sample) => sum + sample.byteLength, 0);
      const sample = synth ? synth.loadADPCM(bytes, options) : {
        id: samples.length, startAddress, repeatAddress: startAddress + (prepared.loopStartSamples ?? 0) / 28 * 16,
        byteLength: bytes.length, decodedFrames: prepared.decodedFrames,
        basePitch: 4096, rootFrequencyHz: prepared.rootFrequencyHz,
        loop: prepared.loop, loopStartSamples: prepared.loopStartSamples,
      };
      ram.set(bytes, startAddress);
      samples.push(sample);
      return sample;
    },
    async getState() {reads.push('state'); return synth ? synth.getState() : {samples: samples.map(sample => ({...sample}))};},
    async snapshot() {reads.push('snapshot'); return synth ? synth.snapshot() : {samples: samples.map(sample => ({...sample})), ram: ram.slice()};},
    async setPreset(channel, preset) {
      commands.push(['preset', channel, {...preset}]);
      presets.set(channel, {...presets.get(channel), ...preset});
      synth?.setPreset(channel, preset);
    },
    async setFrequency(channel, frequency) {
      const preset = presets.get(channel), sample = samples.find(sample => sample.id === preset.sample) ?? synth?.samples[preset.sample];
      const pitch = Math.round(4096 * frequency / sample.rootFrequencyHz);
      commands.push(['frequency', channel, frequency, pitch]);
      synth?.setFrequency(channel, frequency);
    },
    async keyOn(channel) {commands.push(['on', channel]); synth?.keyOn(channel);},
    async keyOff(channel) {commands.push(['off', channel]); synth?.keyOff(channel);},
    async reset() {throw new Error('Sample instruments must not reset shared SPU RAM or voices');},
    async stopVoices() {throw new Error('Sample instruments must not stop unrelated SPU voices');},
    async allNotesOff() {throw new Error('Sample instruments must not release the whole SPU');},
    ...overrides,
  };
  const pg = {...(primary ? {spu} : {}), async useSoundChip(name) {requests.push(name); assert.equal(name, 'ps1'); return spu;}};
  return {pg, spu, commands, loads, presets, requests, reads, samples, ram, synth, core};
}
const ps1Edited = input => renderPs1Sample(input, {rootMidi: input.rootMidi, tuneCents: input.tuneCents,
  loopEnabled: input.loopEnabled, loopStartFrame: input.loopStartFrame, loopEndFrame: input.loopEndFrame});

test('PS1 auto target appends canonical mono ADPCM with explicit loop/tuning and never alters the borrowed chip on construction', async () => {
  const f = await ps1Fixture();
  const input = audio({frames: 1000, sampleRate: 22050, rootMidi: 67, tuneCents: 31,
    loopEnabled: true, loopStartFrame: 115, loopEndFrame: 700});
  input.channels.push(Float32Array.from(input.channels[0], value => value * .25));
  input.adpcm = Uint8Array.of(255); // A stale encoded payload must never bypass conversion.
  input.gainDb = 12; input.fadeInSeconds = .1; input.startFrame = 300;
  const original = input.channels.map(channel => channel.slice()), expected = ps1Edited(input);
  const instrument = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  assert.match(instrument.name, /PS1.*24 voices/);
  assert.deepEqual(f.requests, [], 'PS1 mode reuses its primary API');
  assert.deepEqual(f.loads, [{bytes: expected.adpcm, options: {
    baseFrequencyHz: expected.baseFrequencyHz, loopStartSamples: expected.loopStartFrame,
  }}]);
  assert.equal(f.loads[0].options.loopStartSamples % 28, 0);
  assert.deepEqual(input.channels, original, 'PCM ownership stays with the caller');
  assert.deepEqual(f.commands, [], 'upload does not stop or reprogram existing voices');
  await instrument.allNotesOff();
  assert.deepEqual(f.commands, [], 'an unused instrument owns no voice to release');
});

test('PS1 explicit target borrows an independent chip outside PS1 mode and preserves one-shot padding', async () => {
  const f = await ps1Fixture({primary: false}), input = audio({frames: 153, sampleRate: 44100});
  await createSampleInstrument({pg: f.pg, audio: input, chip: 'ym2612', target: 'ps1'});
  assert.deepEqual(f.requests, ['ps1']);
  assert.deepEqual(f.loads[0].bytes, ps1Edited(input).adpcm);
  assert.deepEqual(f.loads[0].options, {baseFrequencyHz: 440});
  assert.equal(f.loads[0].bytes.length, Math.ceil(153 / 28) * 16);
  assert.equal(f.loads[0].bytes.at(-15), 1, 'one-shot ends without enabling repeat');
  assert.deepEqual(f.commands, []);
});

test('PS1 default volume matches preview while explicit 0..255 volume and velocity become normalized voice levels', async () => {
  const f = await ps1Fixture(), input = audio({tuneCents: 23});
  const defaults = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  await defaults.noteOn(event('a', 69));
  assert.deepEqual(f.commands.map(command => command[0]), ['off', 'preset', 'frequency', 'on']);
  assert.deepEqual(f.commands[1], ['preset', 0, {sample: 0, volumeLeft: .75, volumeRight: .75, adsr1: 15, adsr2: 8}]);
  assert.deepEqual(f.commands[2], ['frequency', 0, 440, Math.round(4096 * 2 ** (-23 / 1200))]);
  await defaults.allNotesOff(); f.commands.length = 0;
  const scaled = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1', volume: 128});
  await scaled.noteOn(event('b', 81, 64));
  const preset = f.commands.find(command => command[0] === 'preset')[2];
  assert.equal(preset.sample, 0, 'identical PCM/tuning reuses its verified RAM allocation');
  assert.equal(preset.volumeLeft, 128 / 255 * 64 / 127);
  assert.equal(preset.volumeRight, preset.volumeLeft);
  assert.deepEqual(f.commands.find(command => command[0] === 'frequency'), ['frequency', 0, 880, Math.round(4096 * 2 ** ((1200 - 23) / 1200))]);
  await scaled.noteOn(event('b', 81, 0));
  assert.deepEqual(f.commands.at(-1), ['off', 0], 'zero velocity releases its held note');
});

test('PS1 allocates all 24 physical voices, steals the oldest, and ignores duplicate or stale note releases', async () => {
  const f = await ps1Fixture(), instrument = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  for (let i = 0; i < 25; i++) await instrument.noteOn(event(String(i), 60 + i));
  assert.deepEqual(f.commands.filter(command => command[0] === 'on').map(command => command[1]), [...Array(24).keys(), 0]);
  const count = f.commands.length;
  await instrument.noteOn(event('24', 84));
  await instrument.noteOff({id: '0'});
  assert.equal(f.commands.length, count);
  await instrument.noteOff({id: '24'});
  assert.deepEqual(f.commands.at(-1), ['off', 0]);
  f.commands.length = 0;
  await instrument.allNotesOff();
  assert.deepEqual(f.commands.map(command => command[1]), Array.from({length: 23}, (_, index) => index + 1));
  const retired = f.commands.length;
  await instrument.noteOff({id: '1'}); await instrument.allNotesOff();
  assert.equal(f.commands.length, retired, 'retired leases cannot touch unrelated channel state');
});

test('PS1 sample instruments sharing a chip allocate free voices and only release their own leases', async () => {
  const f = await ps1Fixture();
  const a = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  const b = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  await a.noteOn(event('same-id', 69)); await b.noteOn(event('same-id', 72));
  assert.deepEqual(f.commands.filter(command => command[0] === 'on').map(command => command[1]), [0, 1]);
  f.commands.length = 0;
  await a.allNotesOff();
  assert.deepEqual(f.commands, [['off', 0]]);
  await a.noteOff({id: 'same-id'});
  assert.deepEqual(f.commands, [['off', 0]]);
  await b.noteOff({id: 'same-id'});
  assert.deepEqual(f.commands.at(-1), ['off', 1]);
});

test('PS1 cross-instrument stealing invalidates old note-off and cleanup without muting the replacement', async () => {
  const f = await ps1Fixture();
  const a = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  const b = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  for (let i = 0; i < 24; i++) await a.noteOn(event(`a${i}`));
  await b.noteOn(event('replacement'));
  assert.deepEqual(f.commands.at(-1), ['on', 0]);
  f.commands.length = 0;
  await a.noteOff({id: 'a0'}); await a.allNotesOff();
  assert.deepEqual(f.commands, Array.from({length: 23}, (_, i) => ['off', i + 1]));
  await b.noteOff({id: 'replacement'});
  assert.deepEqual(f.commands.at(-1), ['off', 0]);
});

test('retiring PS1 input drops queued pitch/trigger/release before a new instrument reuses the same voice', async () => {
  let enter, release, calls = 0;
  const entered = new Promise(resolve => {enter = resolve;}), pending = new Promise(resolve => {release = resolve;});
  const f = await ps1Fixture({overrides: {async setPreset(channel, preset) {
    f.commands.push(['preset', channel, preset]); f.presets.set(channel, preset);
    if (++calls === 1) {enter(); await pending;}
  }}});
  const a = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  const first = a.noteOn(event('old'));
  await entered;
  const oldOff = a.noteOff({id: 'old'});
  await a.allNotesOff();
  const b = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  await b.noteOn(event('new'));
  assert.deepEqual(f.commands.at(-1), ['on', 0]);
  const count = f.commands.length;
  release(); await Promise.all([first, oldOff]);
  assert.equal(f.commands.length, count, 'the retired FIFO issues no late sound-changing command');
  await a.allNotesOff();
  assert.equal(f.commands.length, count, 'old cleanup owns no replacement lease');
  await b.noteOff({id: 'new'});
  assert.deepEqual(f.commands.at(-1), ['off', 0]);
});

test('PS1 setters and triggers retain the captured musical-input lease across asynchronous commands', async () => {
  let context = null;
  const calls = [], f = await ps1Fixture();
  for (const method of ['keyOff', 'setPreset', 'setFrequency', 'keyOn']) {
    const original = f.spu[method];
    f.spu[method] = (...args) => {calls.push([method, context]); return original(...args);};
  }
  registerKeyboardScope(f.pg, () => context, next => {context = next;});
  const instrument = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  const lease = {keyboard: true, id: 'press'}, background = {id: 'background-loop'};
  context = lease;
  const press = instrument.noteOn(event('a'));
  context = background; await press;
  assert.deepEqual(calls.map(([method]) => method), ['keyOff', 'setPreset', 'setFrequency', 'keyOn']);
  assert.ok(calls.every(([, actual]) => actual === lease));
  assert.equal(context, background);
  calls.length = 0;
  context = lease;
  const off = instrument.noteOff({id: 'a'});
  context = background; await off;
  assert.deepEqual(calls, [['keyOff', lease]]);
  assert.equal(context, background);
});

test('Keyboard Run/blur cleanup releases PS1 leases and suppresses stale queued note-ons', async () => {
  let context = null, enter, release, calls = 0;
  const entered = new Promise(resolve => {enter = resolve;}), pending = new Promise(resolve => {release = resolve;});
  const f = await ps1Fixture({overrides: {async setPreset(channel, preset) {
    f.commands.push(['preset', channel, preset]); f.presets.set(channel, preset);
    if (++calls === 1) {enter(); await pending;}
  }}});
  registerKeyboardScope(f.pg, () => context, next => {context = next;});
  const keyboard = createMusicalKeyboard({getContext: () => context, setContext: value => {context = value;}});
  const a = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  await keyboard.commit(keyboardBinding('first', a));
  const oldTarget = keyboard.target, press = oldTarget.noteOn(event('key'));
  await entered;
  await keyboard.clear();
  const b = await createSampleInstrument({pg: f.pg, audio: audio(), chip: 'ps1'});
  await keyboard.commit(keyboardBinding('second', b));
  await keyboard.target.noteOn(event('key'));
  const count = f.commands.length;
  release(); await press; await oldTarget.noteOff(event('key'));
  assert.equal(f.commands.length, count, 'retired Run callbacks cannot release the new target');
  await keyboard.target.allNotesOff(); // Browser blur calls this same public release path.
  assert.deepEqual(f.commands.at(-1), ['off', 0]);
  await keyboard.target.noteOn(event('next'));
  assert.deepEqual(f.commands.at(-1), ['on', 0]);
  await keyboard.clear();
  assert.deepEqual(f.commands.at(-1), ['off', 0]);
  assert.equal(context, null);
});

test('invalid PS1 source or tuning fails before touching an existing sample bank', async () => {
  const f = await ps1Fixture();
  for (const input of [audio({rootMidi: -1}), audio({tuneCents: NaN}), {channels: [], sampleRate: 44100}]) {
    await assert.rejects(createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'}));
  }
  assert.deepEqual(f.loads, []); assert.deepEqual(f.commands, []);
});

test('repeated PS1 instrument preparation verifies and reuses exact RAM bytes across fresh API facades', async () => {
  const f = await ps1Fixture(), input = audio({frames: 112, sampleRate: 44100,
    loopEnabled: true, loopStartFrame: 0, loopEndFrame: 112});
  for (let run = 0; run < 6; run++) {
    // A fresh logic Worker/client has no previous JavaScript cache identity.
    const pg = {spu: {...f.spu}};
    const instrument = await createSampleInstrument({pg, audio: input, chip: 'ps1'});
    await instrument.noteOn(event(`run${run}`));
    await instrument.allNotesOff();
  }
  assert.equal(f.loads.length, 1, 'Run/Stop repetitions do not grow the retained sample bank');
  assert.equal(f.samples.length, 1);
  assert.equal(f.reads.filter(read => read === 'state').length, 6);
  assert.equal(f.reads.filter(read => read === 'snapshot').length, 5, 'RAM is read only when metadata identifies a possible reuse');
  assert.ok(f.commands.filter(command => command[0] === 'preset').every(command => command[2].sample === 0));
  const reads = f.reads.length;
  const instrument = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  const preparedReads = f.reads.length;
  assert.ok(preparedReads > reads);
  await instrument.noteOn(event('live')); await instrument.noteOff({id: 'live'});
  assert.equal(f.reads.length, preparedReads, 'notes and releases never poll or snapshot RAM');
});

test('PS1 polyphonic instruments never reuse a channel-owned editor slot even when its RAM and tuning match', async () => {
  const f = await ps1Fixture(), input = audio({frames:112, sampleRate:44100,
    loopEnabled:true, loopStartFrame:0, loopEndFrame:112}), selected = ps1Edited(input);
  await f.spu.loadADPCM(selected.adpcm, {baseFrequencyHz:selected.baseFrequencyHz, loopStartSamples:0});
  f.samples[0].editorChannel = 23;
  const original = f.ram.slice(0x1000, 0x1000 + selected.adpcm.length);
  const first = await createSampleInstrument({pg:f.pg, audio:input, chip:'ps1'});
  await first.noteOn(event('first'));
  assert.equal(f.commands.find(command => command[0] === 'preset')[2].sample, 1);
  assert.equal(f.samples.length, 2, 'a shareable upload is created beside the private editor slot');
  assert.deepEqual(f.ram.slice(0x1000, 0x1000 + original.length), original);
  await first.allNotesOff();
  await createSampleInstrument({pg:f.pg, audio:input, chip:'ps1'});
  assert.equal(f.samples.length, 2, 'subsequent preparations reuse the shareable upload');
});

test('PS1 preparation appends changed PCM and never trusts equal metadata or a previous sample ID', async () => {
  const f = await ps1Fixture(), input = audio({frames: 112, sampleRate: 44100});
  const first = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  const changed = {...input, channels: [Float32Array.from(input.channels[0], value => -value)]};
  const second = await createSampleInstrument({pg: f.pg, audio: changed, chip: 'ps1'});
  assert.equal(f.loads.length, 2);
  assert.notDeepEqual(f.loads[0].bytes, f.loads[1].bytes);
  const third = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  assert.equal(f.loads.length, 2, 'matching an earlier allocation does not require re-uploading it');
  await first.allNotesOff(); await second.allNotesOff();
  await third.noteOn(event('returned'));
  assert.equal(f.commands.findLast(command => command[0] === 'preset')[2].sample, 0);
});

test('PS1 tuning and loop descriptors must match before a RAM-identical instrument can be reused', async () => {
  const f = await ps1Fixture(), input = audio({frames: 112, sampleRate: 44100,
    loopEnabled: true, loopStartFrame: 0, loopEndFrame: 112});
  await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  await createSampleInstrument({pg: f.pg, audio: {...input, tuneCents: 23}, chip: 'ps1'});
  assert.deepEqual(f.loads[0].bytes, f.loads[1].bytes, 'fine tuning is metadata rather than destructive PCM resampling');
  assert.notEqual(f.loads[0].options.baseFrequencyHz, f.loads[1].options.baseFrequencyHz);
  await createSampleInstrument({pg: f.pg, audio: {...input, loopStartFrame: 28}, chip: 'ps1'});
  assert.equal(f.loads.length, 3);
  assert.deepEqual(f.loads.map(load => load.options.loopStartSamples), [0, 0, 28]);
  assert.equal(f.reads.filter(read => read === 'snapshot').length, 0, 'different metadata does not trigger a full RAM read');
  await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  assert.equal(f.loads.length, 3);
  assert.equal(f.reads.filter(read => read === 'snapshot').length, 1);
});

test('a PS1 bank reset and reused sample ID with different RAM bytes cannot masquerade as the former upload', async () => {
  const f = await ps1Fixture(), input = audio({frames: 112, sampleRate: 44100});
  await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  const replacement = ps1Edited({...input, channels: [new Float32Array(112).fill(-.7)]});
  f.samples.length = 0; f.ram.fill(0); // External reset({clearRam:true}).
  await f.spu.loadADPCM(replacement.adpcm, {baseFrequencyHz: replacement.baseFrequencyHz});
  assert.equal(f.samples[0].id, 0);
  const instrument = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  assert.equal(f.samples.length, 2);
  assert.deepEqual(f.ram.subarray(0x1000, 0x1000 + replacement.adpcm.length), replacement.adpcm, 'the replacement bank is preserved');
  await instrument.noteOn(event('after-reset'));
  assert.equal(f.commands.findLast(command => command[0] === 'preset')[2].sample, 1);
});

test('PS1 reuse uses the current snapshot descriptor when the bank changes after the metadata read', async () => {
  const f = await ps1Fixture(), input = audio({frames: 112, sampleRate: 44100});
  await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  const replacement = ps1Edited({...input, channels: [new Float32Array(112).fill(.7)]});
  const snapshot = f.spu.snapshot;
  f.spu.snapshot = async () => {
    f.samples.length = 0; f.ram.fill(0);
    await f.spu.loadADPCM(replacement.adpcm, {baseFrequencyHz: replacement.baseFrequencyHz});
    return snapshot();
  };
  const instrument = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
  assert.equal(f.samples.length, 2);
  await instrument.noteOn(event('after-snapshot'));
  assert.equal(f.commands.findLast(command => command[0] === 'preset')[2].sample, 1);
});

test('external PS1 APIs without readback retain append-only preparation without cache assumptions', async () => {
  const f = await ps1Fixture();
  delete f.spu.getState; delete f.spu.snapshot;
  for (let run = 0; run < 2; run++) await createSampleInstrument({pg: f.pg, audio: audio({frames: 112}), chip: 'ps1'});
  assert.equal(f.loads.length, 2);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.reads, []);
});

test('real PS1 retained RAM stays flat across Run/Stop and verifies reused IDs after a clear-RAM reset', async () => {
  const f = await ps1Fixture({native: true});
  try {
    const input = audio({frames: 112, sampleRate: 44100, loopEnabled: true, loopStartFrame: 0, loopEndFrame: 112});
    let nextAddress;
    for (let run = 0; run < 6; run++) {
      const instrument = await createSampleInstrument({pg: {spu: {...f.spu}}, audio: input, chip: 'ps1'});
      nextAddress ??= f.synth.nextAddress;
      assert.equal(f.synth.nextAddress, nextAddress);
      assert.equal(f.synth.samples.length, 1);
      await instrument.noteOn(event(`native${run}`));
      f.synth.renderInto(new Float32Array(256), new Float32Array(256));
      await instrument.allNotesOff(); f.synth.stopVoices();
    }
    assert.equal(f.loads.length, 1);
    const replacement = ps1Edited({...input, channels: [new Float32Array(112).fill(-.5)]});
    f.synth.reset({clearRam: true});
    const other = f.synth.loadADPCM(replacement.adpcm, {baseFrequencyHz: replacement.baseFrequencyHz, loopStartSamples: 0});
    assert.equal(other.id, 0);
    const instrument = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
    assert.equal(f.synth.samples.length, 2);
    assert.deepEqual(f.core.readRam(other.startAddress, other.byteLength), replacement.adpcm);
    await instrument.noteOn(event('bank2'));
    assert.equal(f.synth.getPreset(0).sample, 1);
    const retained = f.synth.nextAddress;
    await instrument.allNotesOff(); f.synth.stopVoices();
    await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
    assert.equal(f.synth.samples.length, 2); assert.equal(f.synth.nextAddress, retained);
  } finally {f.synth.dispose();}
});

test('real PS1 SPU appends the canonical sample, tunes root+cents, and releases only acquired voices', async () => {
  const f = await ps1Fixture({native: true});
  try {
    const {adpcm, ...options} = createPs1InitSample(), existing = f.synth.loadADPCM(adpcm, options);
    f.synth.setPreset(23, {sample: existing.id, volumeLeft: 0, volumeRight: 0});
    f.synth.keyOn(23);
    const previousPreset = f.synth.getPreset(23), oldRam = f.core.readRam(existing.startAddress, existing.byteLength);
    const baseHz = 44100 / 112, rootHz = 440 * 2 ** ((67 - 69) / 12);
    const input = audio({frames: 112, sampleRate: 44100, hz: baseHz, rootMidi: 67,
      tuneCents: 1200 * Math.log2(baseHz / rootHz), loopEnabled: true, loopStartFrame: 0, loopEndFrame: 112});
    const instrument = await createSampleInstrument({pg: f.pg, audio: input, chip: 'ps1'});
    assert.equal(f.synth.samples.length, 2);
    assert.deepEqual(f.synth.getPreset(23), previousPreset);
    assert.equal(f.synth.getState().channels[23].gate, true);
    assert.deepEqual(f.core.readRam(existing.startAddress, existing.byteLength), oldRam);
    const uploaded = f.synth.samples[1];
    assert.ok(uploaded.startAddress >= existing.startAddress + existing.byteLength);
    assert.deepEqual(f.core.readRam(uploaded.startAddress, uploaded.byteLength), ps1Edited(input).adpcm);
    await instrument.noteOn(event('a', 69));
    assert.equal(f.core.read(4), Math.round(4096 * 440 / baseHz));
    const left = new Float32Array(16384), right = new Float32Array(left.length);
    f.synth.renderInto(left, right);
    assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
    assert.ok(peak(left) > .01);
    let first = -1, last = -1, edges = 0;
    for (let at = 1024; at < left.length; at++) if (left[at - 1] <= 0 && left[at] > 0) {
      if (first < 0) first = at; last = at; edges++;
    }
    assert.ok(Math.abs((edges - 1) * 44100 / (last - first) - 440) < .3, 'actual SPU renders the requested note after fine-tuning');
    await instrument.allNotesOff();
    f.synth.renderInto(left, right);
    f.synth.renderInto(left, right);
    assert.equal(peak(left), 0);
    assert.equal(f.synth.getState().channels[23].gate, true, 'unrelated voice remains keyed');
    assert.deepEqual(f.synth.getPreset(23), previousPreset);
    assert.deepEqual(f.core.readRam(existing.startAddress, existing.byteLength), oldRam);
    assert.ok(f.core.nativeFrames > 0, 'no core reset was used to stop sampler voices');
  } finally {f.synth.dispose();}
});
