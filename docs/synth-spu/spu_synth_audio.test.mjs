// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import factory from '../generated/ps1_spu_wasm.js';
import {Ps1Spu} from '../../web/ps1_spu.js';
import {Ps1Synth} from '../../web/ps1synth.js';
import {Ps1Resampler} from '../../web/ps1_resampler.js';
import {Ps1VoiceInspector} from '../../web/playground_ps1_inspector.js';
import {preparePs1Waveform} from '../../web/ps1_waveform.js';

const source = await readFile(new URL('./spu_synth_worklet.js', import.meta.url), 'utf8');
const wasmBinary = await readFile(new URL('../generated/ps1_spu_wasm.wasm', import.meta.url));
const sine = () => preparePs1Waveform(Array.from({length:112}, (_, i) => .65 * Math.sin(2 * Math.PI * i / 112)));
const peak = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);

test('standalone actual WASM initializes and renders without URL or Node globals like AudioWorkletGlobalScope', () => {
  const url = path => JSON.stringify(new URL(path, import.meta.url).href);
  // Isolate the missing globals from the test runner and concurrent suites.
  // The generated factory is imported unchanged; only the production worklet
  // module's imports/export are bound to their real modules in this harness.
  const script = `
    import assert from 'node:assert/strict';
    import {readFile} from 'node:fs/promises';
    import vm from 'node:vm';
    import factory from ${url('../generated/ps1_spu_wasm.js')};
    import {Ps1Spu} from ${url('../../web/ps1_spu.js')};
    import {Ps1Synth} from ${url('../../web/ps1synth.js')};
    import {Ps1Resampler} from ${url('../../web/ps1_resampler.js')};
    import {Ps1VoiceInspector} from ${url('../../web/playground_ps1_inspector.js')};
    import {preparePs1Waveform} from ${url('../../web/ps1_waveform.js')};
    const source = await readFile(new URL(${url('./spu_synth_worklet.js')}), 'utf8');
    const wasmBinary = await readFile(new URL(${url('../generated/ps1_spu_wasm.wasm')}));
    const initialWaveform = preparePs1Waveform(Array.from({length:112}, (_,i)=>.65*Math.sin(2*Math.PI*i/112)));
    let Processor;
    const messages = [];
    vm.runInNewContext(source.replace(/^import .*;\\n/gm,'').replace('export class SpuSynthProcessor','class SpuSynthProcessor'), {
      factory, Ps1Spu, Ps1Synth, Ps1Resampler, Ps1VoiceInspector, sampleRate:48000,
      AudioWorkletProcessor:class {constructor(){this.port={postMessage:value=>messages.push(value)};}},
      registerProcessor(_name, Type){Processor=Type;},
    });
    const savedURL=globalThis.URL, savedProcess=globalThis.process;
    let processor, missingLocateFileError;
    try {
      globalThis.URL=undefined; globalThis.process=undefined;
      try {await factory({wasmBinary});} catch(error) {missingLocateFileError=error;}
      processor=new Processor({processorOptions:{wasmBinary,initialWaveform}});
      await processor.ready;
    } finally {globalThis.URL=savedURL;globalThis.process=savedProcess;}
    assert.match(missingLocateFileError?.message ?? '', /URL/, 'the unchanged factory reproduces the missing-global failure without locateFile');
    assert.equal(messages[0]?.ready,true,messages[0]?.error);
    processor.receive({id:1,method:'noteOn',args:[0,69]});
    assert.equal(messages.at(-1).error,undefined);
    const left=new Float32Array(128),right=new Float32Array(128);
    assert.equal(processor.process([],[[left,right]]),true);
    assert([...left,...right].every(Number.isFinite));
    assert(left.some(value=>value!==0));
    processor.dispose();
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {encoding:'utf8', timeout:15000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

async function setup(rate = 48000) {
  let Processor;
  const messages = [], port = {postMessage:value => messages.push(value)};
  vm.runInNewContext(source.replace(/^import .*;\n/gm, '').replace('export class SpuSynthProcessor', 'class SpuSynthProcessor'), {
    factory, Ps1Spu, Ps1Synth, Ps1Resampler, Ps1VoiceInspector, sampleRate:rate,
    AudioWorkletProcessor:class {constructor() {this.port = port;}},
    registerProcessor(name, Type) {assert.equal(name, 'tetorica-spu-synth'); Processor = Type;},
  });
  const processor = new Processor({processorOptions:{wasmBinary, initialWaveform:sine()}});
  await processor.ready;
  assert.equal(messages[0].ready, true);
  let sequence = 0;
  return {
    processor, messages,
    command(method, args = []) {
      const id = ++sequence; processor.receive({id, method, args});
      const response = messages.at(-1); assert.equal(response.id, id);
      if (response.error) throw new Error(response.error);
      return response.value;
    },
    render(frames) {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      const active = processor.process([], [[left, right]]);
      return {left, right, active};
    },
    close() {processor.dispose();},
  };
}

for (const rate of [44100, 48000]) test(`standalone SPU renders exact core PCM at ${rate} Hz without UI messages per block`, async t => {
  const p = await setup(rate); t.after(() => p.close());
  const core = await Ps1Spu.create({moduleFactory:factory, moduleOptions:{wasmBinary}}), synth = new Ps1Synth({core});
  t.after(() => synth.dispose());
  for (let ch = 0; ch < 24; ch++) {const sample = synth._setWaveformPrepared(ch, sine()); synth.setPreset(ch, {sample});}
  const direct = new Ps1Resampler(synth, rate), initial = p.command('inspect');
  assert.equal(initial.samples.length, 24);
  assert(initial.channels.every((voice, ch) => voice.sample === ch && voice.waveform.pcm.length === 112));
  for (const [channel, note] of [[0, 60], [23, 67]]) {p.command('noteOn', [channel, note]); synth.noteOn(channel, note);}
  const sent = p.messages.length;
  let maximum = 0;
  for (const frames of [1, 127, 53, 1024, 128]) {
    const result = p.render(frames), left = new Float32Array(frames), right = new Float32Array(frames);
    direct.render(left, right);
    assert.deepEqual(result.left, left); assert.deepEqual(result.right, right); assert.equal(result.active, true);
    maximum = Math.max(maximum, peak(left));
  }
  assert(maximum > .001);
  assert.equal(p.messages.length, sent, 'render never sends state or level messages');
  const frames = p.processor.synth.core.nativeFrames;
  for (let i = 0; i < 5; i++) p.command('inspect');
  assert.equal(p.processor.synth.core.nativeFrames, frames, 'inspection never generates PCM');
});

test('standalone manual leases ignore stale release, Stop retains instruments and clears all output', async t => {
  const p = await setup(); t.after(() => p.close());
  p.command('auditionOn', [0, 60, 'old']); p.render(1024);
  p.command('auditionOn', [0, 67, 'new']);
  assert.equal(p.command('auditionOff', [0, 'old']), false);
  assert.equal(p.command('inspect').channels[0].gate, true);
  assert(peak(p.render(1024).left) > .001);
  const instrument = p.command('getInstrument', [0]);
  assert.equal(instrument.sample.adpcm.length, 64);
  assert.equal(instrument.sample.baseFrequencyHz, 44100 / 112);
  assert.equal(instrument.sample.loopStartSamples, 0);
  assert.equal(instrument.waveform.length, 112);
  p.command('setReverb', [{preset:'hall', volumeLeft:.2, volumeRight:.2}]);
  p.command('setPreset', [0, {reverb:true}]); p.render(1024);
  const before = p.command('inspect'); p.command('stop'); const after = p.command('inspect');
  assert.deepEqual(after.samples, before.samples);
  assert.deepEqual(after.channels[0].waveform, before.channels[0].waveform);
  assert.equal(after.auditions.length, 0);
  assert.equal(p.command('auditionOff', [0, 'new']), false);
  assert.equal(peak(p.render(8192).left), 0, 'Stop clears decoder and shared reverb tails');
  p.command('auditionOn', [23, 64, 'after-stop']);
  assert(peak(p.render(1024).left) > .001, 'retained instrument plays again');
});

test('standalone edits retain shared live/deferred ADSR behavior and invalid commands remain recoverable', async t => {
  const p = await setup(); t.after(() => p.close());
  p.command('setEnvelope', [0, {releaseRate:31}, {live:false}]);
  p.command('auditionOn', [0, 69, 'held']); p.render(1024);
  p.command('setEnvelope', [0, {releaseRate:0}, {live:false}]);
  p.command('auditionOff', [0, 'held']); p.render(4096);
  assert(p.command('inspect').channels[0].envelope > 30000, 'deferred RR survives manual key-off');
  p.command('setEnvelope', [0, {releaseRate:1}, {live:true}]); p.render(4096);
  assert.equal(p.command('inspect').channels[0].envelope, 0, 'changed explicit live RR updates Release');
  assert.throws(() => p.command('setEnvelope', [0, {releaseRate:32}, {live:true}]), /releaseRate/);
  assert.throws(() => p.command('unrecognized'), /Unknown SPU/);
  assert.throws(() => p.command('getInstrument', [24]), /channel/);
  p.command('auditionOn', [0, 69, 'next']); assert(peak(p.render(1024).left) > .001);
  p.close(); assert.equal(p.render(128).active, false);
  assert.equal(peak(p.render(128).left), 0);
});

test('standalone pitch bend validates atomically, keeps note ownership and never retriggers', async t => {
  const p = await setup(); t.after(() => p.close());
  p.command('auditionOn', [0, 69, 'bent', 2]); p.render(1024);
  const bent = p.command('inspect'), expected = semitones => Math.round(4096 * 440 * 2 ** (semitones / 12) / (44100 / 112));
  assert.equal(bent.channels[0].pitch, expected(2));
  assert.equal(bent.auditions[0].id, 'bent');
  for (const args of [[0, 69, 2.01], [0, 69, NaN], [0, 128, 0], [24, 69, 0], [0, 127, 2]]) {
    assert.throws(() => p.command('setPitchBend', args));
    assert.equal(p.command('inspect').channels[0].pitch, expected(2));
  }
  assert.throws(() => p.command('auditionOn', [0, 127, 'invalid', 2]), /PITCH range/);
  assert.equal(p.command('inspect').auditions[0].id, 'bent', 'invalid pitch does not replace a held lease');
  const heldEnvelope = p.command('inspect').channels[0].envelope;
  p.command('setPitchBend', [0, 69, -2]);
  const down = p.command('inspect');
  assert.equal(down.channels[0].pitch, expected(-2));
  assert.equal(down.channels[0].envelope, heldEnvelope);
  assert.equal(down.auditions[0].id, 'bent');
  for (let i = 0; i < 5; i++) {p.command('setPitchBend', [0, 69, 2]); p.command('setPitchBend', [0, 69, 0]);}
  assert.equal(p.command('inspect').channels[0].pitch, expected(0), 'base note prevents bend drift');
  p.command('setEnvelope', [0, {releaseRate:31}, {live:true}]);
  p.command('auditionOff', [0, 'bent']); p.render(256);
  const release = p.command('inspect').channels[0];
  p.command('setPitchBend', [0, 69, 1]);
  const after = p.command('inspect');
  assert.equal(after.channels[0].gate, false); assert.equal(after.channels[0].envelope, release.envelope);
  assert.equal(after.channels[0].pitch, expected(1)); assert.equal(after.auditions.length, 0);
});
