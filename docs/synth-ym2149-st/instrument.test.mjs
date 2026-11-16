import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AY8910Synth} from '../../tetorica_src/runtime/ay8910synth.js';
import {Ay8910} from '../../tetorica_src/runtime/ay8910.js';
import factory from '../generated/ay8910_wasm.js';
import {createInstrument, YM2149_ST_CLOCK} from './instrument.js';
import {createDefaultPreset} from './preset.js';

function fixture(preset = createDefaultPreset()) {
  const writes = [], observations = [];
  const client = new AY8910Synth({clock: YM2149_ST_CLOCK, transport: {
    writeRegister: (register, value) => writes.push([register, value]), reset() {},
  }});
  client.initialize();
  const instrument = createInstrument({client, preset, onChange: state => observations.push(state)});
  writes.length = 0;
  return {client, instrument, writes, observations};
}

test('starts silent; selection and Auto preserve independent physical settings', () => {
  const preset = createDefaultPreset();
  preset.voices[1] = {...preset.voices[1], volume: 5, noise: true};
  preset.voices[2] = {...preset.voices[2], volume: 3, tone: false, noise: true};
  const {instrument, writes} = fixture(preset);
  assert.deepEqual(instrument.read().activeChannels, []);
  assert.deepEqual(instrument.getPreset(), preset);
  instrument.selectChannel(1); instrument.selectChannel(null);
  assert.equal(writes.length, 0);
  assert.deepEqual(instrument.getPreset(), preset);
  assert.deepEqual([instrument.noteOn('a', 60), instrument.noteOn('b', 64), instrument.noteOn('c', 67)], [0, 1, 2]);
  assert.deepEqual(instrument.getPreset().voices.map(({tone, noise, volume}) => ({tone, noise, volume})),
    preset.voices.map(({tone, noise, volume}) => ({tone, noise, volume})));
});

test('old keyboard release cannot silence a stolen channel', () => {
  const {instrument, client} = fixture();
  instrument.selectChannel(0);
  instrument.noteOn('old', 60);
  instrument.noteOn('new', 64);
  assert.equal(instrument.noteOff('old'), false);
  assert.equal(client.getRegisterSnapshot()[8], 9);
  assert.equal(instrument.noteOff('new'), true);
  assert.equal(client.getRegisterSnapshot()[8], 0);
  assert.equal(instrument.getPreset().voices[0].volume, 9);
});

test('renaming a held instrument does not retrigger its shared envelope or alter gates', () => {
  const {instrument,writes}=fixture();
  instrument.selectChannel(0);instrument.noteOn('held',60);writes.length=0;
  instrument.setName('New name');
  assert.equal(instrument.getPreset().name,'New name');
  assert.deepEqual(instrument.read().activeChannels,[0]);
  assert.deepEqual(writes,[]);
});

test('Auto rotates released notes and protects a newer note after a full-chip steal', () => {
  const {instrument, client} = fixture();
  const channels = [];
  for (let i = 0; i < 4; i++) {
    const id = `successive-${i}`;
    channels.push(instrument.noteOn(id, 60 + i));
    instrument.noteOff(id);
  }
  assert.deepEqual(channels, [0, 1, 2, 0]);
  assert.deepEqual([instrument.noteOn('a', 60), instrument.noteOn('b', 64), instrument.noteOn('c', 67)], [1, 2, 0]);
  assert.equal(instrument.noteOn('replacement', 72), 1);
  assert.equal(instrument.noteOff('a'), false);
  assert.equal(client.getRegisterSnapshot()[9], 9);
  assert.equal(instrument.noteOff('replacement'), true);
  assert.equal(client.getRegisterSnapshot()[9], 0);
});

test('Code replaces manual ownership; stale Code releases spare a newer key', () => {
  const {instrument, client, observations} = fixture();
  instrument.selectChannel(0); instrument.noteOn('manual-old', 60);
  client.noteOn(0, 67);
  assert.equal(instrument.noteOff('manual-old'), false);
  instrument.noteOn('manual-new', 64);
  client.noteOff(0); client.keyOff(0);
  assert.equal(client.getRegisterSnapshot()[8], 9);
  assert.equal(instrument.noteOff('manual-new'), true);
  client.setVolume(0, 6, true); client.keyOff(0);
  const last = observations.at(-1);
  assert.deepEqual(last.activeChannels, []);
  assert.equal(last.preset.voices[0].volume, 6);
  assert.equal(last.preset.voices[0].envelope, true);
});

test('raw Code writes mirror hardware and unconditionally take over their channel', () => {
  const {instrument, client} = fixture();
  instrument.selectChannel(1); instrument.noteOn('manual', 60);
  client.writeRegister(9, 7);
  assert.equal(instrument.noteOff('manual'), false);
  assert.equal(instrument.getPreset().voices[1].volume, 7);
  client.writeRegister(7, 0x3f);
  assert.equal(instrument.getPreset().voices.every(voice => !voice.tone && !voice.noise), true);
});

test('edits write only changed voice fields without waking silent voices or resetting Code', () => {
  const {instrument, client, writes} = fixture();
  instrument.selectChannel(1);
  instrument.setVoice({volume: 5});
  assert.deepEqual(writes.map(([register]) => register), [9, 9]);
  assert.deepEqual(instrument.read().activeChannels, []);
  writes.length = 0;
  instrument.selectChannel(null);
  instrument.setVoice({noise: true});
  assert.deepEqual(writes.map(([register]) => register), [7, 7, 7]);
  assert.deepEqual(instrument.getPreset().voices.map(voice => voice.volume), [9, 5, 9]);
  client.noteOn(2, 67);
  const patch = instrument.getPreset(); patch.voices[2].volume = 4;
  writes.length = 0;
  instrument.applyPreset(patch);
  assert.ok(!writes.some(([register]) => register === 8 || register === 9));
  assert.equal(client.getRegisterSnapshot()[10], 4);
  assert.ok(instrument.read().activeChannels.includes(2));
});

test('one shared Shape write retriggers all envelope voices; period edits do not', () => {
  const {instrument, writes} = fixture();
  instrument.setVoice({envelope: true});
  writes.length = 0;
  instrument.setEnvelope({period: 1200});
  assert.deepEqual(writes.map(([register]) => register), [11, 12]);
  writes.length = 0;
  instrument.setEnvelope({shape: 10});
  assert.deepEqual(writes, [[13, 10]]);
  assert.equal(instrument.getPreset().voices.every(voice => voice.envelope), true);
  instrument.setNoisePeriod(31);
  assert.equal(instrument.getPreset().noisePeriod, 31);
});

test('validation is atomic and low notes clamp to the chip limit', () => {
  const {instrument, writes} = fixture();
  assert.throws(() => instrument.setVoice({volume: 3, period: 9000}));
  assert.throws(() => instrument.setEnvelope({period: 300, shape: 16}));
  assert.equal(writes.length, 0);
  assert.equal(instrument.noteOn('low', 0), 0);
  assert.equal(instrument.getPreset().voices[0].period, 4095);
  instrument.setPitch(-48);
  assert.equal(instrument.getPreset().voices[0].period, 4095);
  instrument.stop();
  assert.deepEqual(instrument.read().activeChannels, []);
  assert.equal(instrument.noteOff('low'), false);
});

test('actual YM2149 WASM produces three voices and returns to constant silence', async () => {
  const wasmBinary = await readFile(new URL('../generated/ay8910_wasm.wasm', import.meta.url));
  const chip = await Ay8910.create({moduleFactory: factory, moduleOptions: {wasmBinary}, clock: YM2149_ST_CLOCK, type: 0x10, flags: 1, sampleRate: 48000});
  const client = new AY8910Synth({clock: YM2149_ST_CLOCK, transport: {writeRegister: (r, v) => chip.writeRegister(r, v), reset: () => chip.reset()}});
  client.initialize();
  const instrument = createInstrument({client});
  const acPower = samples => {
    const mean = samples.reduce((sum, n) => sum + n, 0) / samples.length;
    return samples.reduce((sum, n) => sum + (n - mean) ** 2, 0) / samples.length;
  };
  try {
    assert.equal(acPower(chip.generateStereo(4096).left), 0);
    instrument.noteOn('root', 60); instrument.noteOn('third', 64); instrument.noteOn('fifth', 67);
    assert.deepEqual(instrument.read().activeChannels, [0, 1, 2]);
    const pcm = chip.generateStereo(8192);
    assert.ok(pcm.left.every(Number.isFinite));
    assert.ok(acPower(pcm.left) > 1e-5);
    assert.deepEqual(pcm.left, pcm.right);
    instrument.stop();
    assert.equal(acPower(chip.generateStereo(4096).left), 0);
  } finally { instrument.dispose(); chip.dispose(); }
});
