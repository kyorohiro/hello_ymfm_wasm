// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/ps1_spu_wasm.js';
import {Ps1Spu} from '../js/ps1_spu.js';
import {Ps1Synth} from '../js/ps1synth.js';
import {preparePs1Waveform} from '../js/ps1_waveform.js';
import {encodePs1Adpcm} from '../js/ps1_adpcm_encoder.js';
import {INSTRUMENT_SCHEMA, readSpuInstrument, writeSpuInstrument, prepareAudioPcm} from './spu_synth_instrument.js';

const wasmBinary = await readFile(new URL('../generated/ps1_spu_wasm.wasm', import.meta.url));
const wave = () => preparePs1Waveform(Array.from({length:112}, (_, i) => .65 * Math.sin(2 * Math.PI * i / 112)));
const clone = value => structuredClone(value);
const audioBuffer = (channels, rate = 44100) => ({sampleRate:rate, length:channels[0].length, numberOfChannels:channels.length, getChannelData:channel => channels[channel]});

async function instrumentFixture(t, {editable = true} = {}) {
  const core = await Ps1Spu.create({moduleFactory:factory, moduleOptions:{wasmBinary}}), synth = new Ps1Synth({core});
  t.after(() => synth.dispose());
  let sample;
  if (editable) sample = synth._setWaveformPrepared(23, wave());
  else {
    const encoded = encodePs1Adpcm(Float32Array.from({length:57}, (_, i) => .5 * Math.sin(2 * Math.PI * i / 57)));
    sample = synth.loadADPCM(encoded.adpcm, {baseFrequencyHz:123.5});
  }
  synth.setPreset(23, {sample, volumeLeft:-.2, volumeRight:.8, adsr1:0x8f4a, adsr2:0xe789, pitch:0x1234, reverb:true});
  synth.setReverb({preset:'studio-small', volumeLeft:.33, volumeRight:.27});
  const preset = synth.getPreset(23), sourceSample = synth.samples[preset.sample];
  const tuning = {adpcm:synth.sampleBytes[sourceSample.id].slice(), baseFrequencyHz:sourceSample.rootFrequencyHz};
  if (sourceSample.loop) tuning.loopStartSamples = sourceSample.loopStartSamples;
  // This is the audio worklet's getInstrument response, including its selected
  // sample payload rather than a full RAM dump or a transport-specific ID.
  const source = {preset, sample:tuning, reverb:{...synth.reverb}, waveform:editable ? synth.editorWaveforms[23].pcm.slice() : null};
  return {core, synth, source};
}

test('instrument JSON round-trip retains actual core ADSR reserved bits, signed volumes, PCM and tuning', async t => {
  const {core, synth, source} = await instrumentFixture(t);
  const file = writeSpuInstrument('  明るい Sine  ', source), originalBytes = source.sample.adpcm.slice();
  assert.equal(file.schema, INSTRUMENT_SCHEMA); assert.equal(file.version, 1); assert.equal(file.name, '明るい Sine');
  assert(Array.isArray(file.sample.adpcm)); assert.equal(Object.hasOwn(file.preset, 'sample'), false);
  const restored = readSpuInstrument(JSON.parse(JSON.stringify(file)));
  assert(restored.sample.adpcm instanceof Uint8Array);
  assert.deepEqual(restored.sample.adpcm, originalBytes);
  assert.equal(restored.sample.baseFrequencyHz, 44100 / 112); assert.equal(restored.sample.loopStartSamples, 0);
  assert.deepEqual(restored.waveform, source.waveform); assert.deepEqual(restored.reverb, source.reverb);
  assert.equal(restored.preset.adsr1, 0x8f4a); assert.equal(restored.preset.adsr2, 0xe789);
  assert.equal(restored.preset.adsr2 & 0x2000, 0x2000, 'raw reserved bit survives named/file helpers');
  assert.equal(restored.preset.volumeLeft, -.2); assert.equal(restored.preset.volumeRight, .8);
  const sample = synth._setWaveformPrepared(0, preparePs1Waveform(restored.waveform));
  synth.setPreset(0, {...restored.preset, sample});
  assert.equal(core.read(8), 0x8f4a); assert.equal(core.read(10), 0xe789);
  file.sample.adpcm[10] ^= 1; restored.sample.adpcm[11] ^= 1;
  assert.deepEqual(synth.sampleBytes[source.preset.sample], originalBytes, 'export and parse own their byte payloads');
});

test('one-shot instrument exports exact ADPCM and independent arbitrary tuning without loop or PCM metadata', async t => {
  const {source} = await instrumentFixture(t, {editable:false});
  const file = writeSpuInstrument('One shot', source), restored = readSpuInstrument(JSON.parse(JSON.stringify(file)));
  assert.equal(restored.sample.baseFrequencyHz, 123.5);
  assert.equal(Object.hasOwn(restored.sample, 'loopStartSamples'), false);
  assert.equal(restored.waveform, null); assert.deepEqual(restored.sample.adpcm, source.sample.adpcm);
  assert.equal(restored.sample.adpcm.length, 48, '57 source frames retain all three complete ADPCM packets');
});

test('PCM and ADPCM must describe the same cycle before an instrument is accepted', async t => {
  const {source} = await instrumentFixture(t), file = writeSpuInstrument('Sine', source);
  for (const change of [
    next => {next.waveform[17] = .9;},
    next => {next.sample.adpcm[63] ^= 1;},
    next => {next.sample.baseFrequencyHz = 440;},
    next => {next.waveform.pop();},
    next => {next.waveform[0] = Infinity;},
  ]) {
    const invalid = clone(file); change(invalid);
    assert.throws(() => readSpuInstrument(invalid));
  }
});

test('malformed instrument schemas, ranges and sample packets reject without touching a live core', async t => {
  const {core, synth, source} = await instrumentFixture(t), file = writeSpuInstrument('Sine', source);
  synth.noteOn(23, 69); synth.renderInto(new Float32Array(256), new Float32Array(256));
  const before = synth.snapshot();
  const changes = [
    next => {next.schema = 'other';}, next => {next.version = 2;}, next => {next.unrecognized = true;},
    next => {next.name = ' ';}, next => {next.name = 'x'.repeat(81);},
    next => {delete next.preset.volumeLeft;}, next => {next.preset.volumeRight = 1.01;},
    next => {next.preset.adsr1 = -1;}, next => {next.preset.adsr2 = 65536;}, next => {next.preset.adsr1 = .5;},
    next => {next.preset.pitch = 16384;}, next => {next.preset.reverb = 1;}, next => {next.preset.sample = 999;},
    next => {next.reverb.preset = 'unknown';}, next => {next.reverb.volumeLeft = NaN;},
    next => {next.sample.adpcm = [];}, next => {next.sample.adpcm[0] = 256;},
    next => {next.sample.adpcm[0] = 0xf0;}, next => {next.sample.adpcm[0] = 13;},
    next => {next.sample.adpcm.pop();}, next => {next.sample.adpcm[49] &= ~1;},
    next => {next.sample.loopStartSamples = 1;}, next => {next.sample.baseFrequencyHz = 0;},
    next => {next.sample.rootNote = 60;},
  ];
  for (const change of changes) {const invalid = clone(file); change(invalid); assert.throws(() => readSpuInstrument(invalid));}
  for (const value of [null, [], 7, 'instrument']) assert.throws(() => readSpuInstrument(value));
  assert.deepEqual(synth.snapshot(), before, 'pure validation neither writes registers/RAM nor advances the voice');
  assert.equal(core.nativeFrames, 256);
});

test('decoded PCM conversion averages stereo, preserves mono and clips only the converted copy', () => {
  const left = Float32Array.from([1, -1, .5, -.5]), right = Float32Array.from([-1, 1, .5, .5]);
  const originalLeft = left.slice(), originalRight = right.slice();
  const stereo = prepareAudioPcm(audioBuffer([left, right]), {maxBytes:16});
  assert.deepEqual(stereo.pcm, Float32Array.from([0, 0, .5, 0]));
  assert.equal(stereo.loopStartSamples, null); assert.equal(stereo.trimmedFrames, 0);
  assert.deepEqual(left, originalLeft); assert.deepEqual(right, originalRight);
  const mono = prepareAudioPcm(audioBuffer([Float32Array.from([2, -2, .25])]), {maxBytes:16});
  assert.deepEqual(mono.pcm, Float32Array.from([1, -1, .25]));
});

test('loops trim only to 28-frame boundaries and capacity includes one-shot packet padding', () => {
  const original = Float32Array.from({length:57}, (_, i) => i / 100);
  const loop = prepareAudioPcm(audioBuffer([original]), {loop:true, maxBytes:32});
  assert.equal(loop.pcm.length, 56); assert.equal(loop.trimmedFrames, 1); assert.equal(loop.loopStartSamples, 0);
  assert.deepEqual(loop.pcm, original.slice(0, 56));
  assert.throws(() => prepareAudioPcm(audioBuffer([original]), {maxBytes:32}), /free SPU sample RAM/);
  const oneShot = prepareAudioPcm(audioBuffer([original]), {maxBytes:48});
  assert.equal(oneShot.pcm.length, 57); assert.equal(oneShot.trimmedFrames, 0);
  assert.throws(() => prepareAudioPcm(audioBuffer([new Float32Array(27)]), {loop:true, maxBytes:16}), /too short/);
  assert.equal(prepareAudioPcm(audioBuffer([new Float32Array(28)]), {loop:true, maxBytes:16}).pcm.length, 28);
  assert.throws(() => prepareAudioPcm(audioBuffer([new Float32Array(1)]), {maxBytes:15}), /free SPU sample RAM/);
});

test('decoded PCM rejects invalid sample rates, samples and free-RAM budgets before conversion', () => {
  for (const maxBytes of [undefined, NaN, Infinity, -1, 1.5, 520193, '16']) {
    assert.throws(() => prepareAudioPcm(audioBuffer([new Float32Array(28)]), {maxBytes}), /free sample RAM/);
  }
  assert.throws(() => prepareAudioPcm(audioBuffer([new Float32Array(28)], 48000), {maxBytes:16}), /44,100/);
  assert.throws(() => prepareAudioPcm(audioBuffer([new Float32Array(0)]), {maxBytes:16}), /44,100/);
  assert.throws(() => prepareAudioPcm(audioBuffer([Float32Array.from([NaN])]), {maxBytes:16}), /non-finite/);
  assert.throws(() => prepareAudioPcm(audioBuffer([Float32Array.from([Infinity])]), {maxBytes:16}), /non-finite/);
  let reads = 0;
  const buffer = audioBuffer([new Float32Array(29)]); buffer.getChannelData = () => {reads++; throw new Error('should not read');};
  assert.throws(() => prepareAudioPcm(buffer, {maxBytes:16}), /free SPU sample RAM/);
  assert.equal(reads, 0, 'RAM validation precedes mono conversion');
});
