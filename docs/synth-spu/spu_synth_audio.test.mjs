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
import {patchPs1Envelope} from '../../web/ps1_parameters.js';
import {SpuRoundRobinVoices} from './spu_synth_voices.js';

const source = await readFile(new URL('./spu_synth_worklet.js', import.meta.url), 'utf8');
const wasmBinary = await readFile(new URL('../generated/ps1_spu_wasm.wasm', import.meta.url));
const sine = () => preparePs1Waveform(Array.from({length:112}, (_, i) => .65 * Math.sin(2 * Math.PI * i / 112)));
const peak = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);

test('main thread encodes one instrument wave once and sends no per-key sample uploads', async t => {
  const audioSource = await readFile(new URL('./spu_synth_audio.js', import.meta.url), 'utf8');
  const requests = [];
  let encodes = 0, createAudio;
  class Context {
    constructor() {this.state = 'suspended'; this.audioWorklet = {addModule:async () => {}};}
    addEventListener() {}
    removeEventListener() {}
    createGain() {return {gain:{value:1}, connect() {}, disconnect() {}};}
    async close() {this.state = 'closed';}
  }
  class WorkletNode {
    constructor() {
      this.port = {
        postMessage:request => {
          requests.push(request);
          if (request.id !== undefined) queueMicrotask(() => this.port.onmessage?.({data:{id:request.id, value:true}}));
        },
        close() {},
      };
      queueMicrotask(() => this.port.onmessage?.({data:{ready:true, state:{channels:[]}}}));
    }
    connect() {}
    disconnect() {}
  }
  vm.runInNewContext(audioSource.replace(/^import .*;\n/gm, '').replaceAll('export ', '').replaceAll('import.meta.url', JSON.stringify(new URL('./spu_synth_audio.js', import.meta.url).href)) + '\nprovide(createSpuAudio);', {
    AudioContext:Context, AudioWorkletNode:WorkletNode,
    preparePs1Waveform:pcm => {encodes++; return preparePs1Waveform(pcm);},
    SOUNDCHIP_MIXER_PRESETS:{calibrated:{factoryDefaults:{kinds:[{name:'ps1', volume:.128832}]}}},
    URL, fetch:async () => ({ok:true, arrayBuffer:async () => wasmBinary.buffer}),
    setTimeout, clearTimeout, provide:value => {createAudio = value;},
  });
  const audio = await createAudio(); t.after(() => audio.dispose());
  assert.equal(encodes, 1, 'initial cycle is prepared once before Worklet creation');
  const pcm = Array.from({length:112}, (_, i) => .5 * Math.sin(2 * Math.PI * i / 112));
  await audio.command('setInstrumentWaveform', [pcm]);
  assert.equal(encodes, 2, 'one global wave edit runs the encoder exactly once');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'setInstrumentWaveform');
  assert.deepEqual(requests[0].args[0].pcm, preparePs1Waveform(pcm).pcm);
  assert.equal(requests[0].args[0].adpcm.length, 64);
  for (let ch = 0; ch < 24; ch++) await audio.command('auditionOn', [ch, 60, `key-${ch}`]);
  assert.equal(encodes, 2, 'playing any number of voices never encodes or uploads a sample');
  assert.equal(requests.filter(request => /Waveform|ADPCM/.test(request.method)).length, 1);
  const before = requests.length;
  await assert.rejects(audio.command('setInstrumentWaveform', [[NaN]]), /112 PCM/);
  assert.equal(requests.length, before, 'invalid PCM is rejected before posting to the audio thread');
});

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
    import {patchPs1Envelope} from ${url('../../web/ps1_parameters.js')};
    import {SpuRoundRobinVoices} from ${url('./spu_synth_voices.js')};
    const source = await readFile(new URL(${url('./spu_synth_worklet.js')}), 'utf8');
    const wasmBinary = await readFile(new URL(${url('../generated/ps1_spu_wasm.wasm')}));
    const initialWaveform = preparePs1Waveform(Array.from({length:112}, (_,i)=>.65*Math.sin(2*Math.PI*i/112)));
    let Processor;
    const messages = [];
    vm.runInNewContext(source.replace(/^import .*;\\n/gm,'').replace('export class SpuSynthProcessor','class SpuSynthProcessor'), {
      factory, Ps1Spu, Ps1Synth, Ps1Resampler, Ps1VoiceInspector, patchPs1Envelope, SpuRoundRobinVoices, sampleRate:48000,
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
    factory, Ps1Spu, Ps1Synth, Ps1Resampler, Ps1VoiceInspector, patchPs1Envelope, SpuRoundRobinVoices, sampleRate:rate,
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

test('one instrument waveform updates all 24 private slots without RAM growth or per-voice replies', async t => {
  const p = await setup(); t.after(() => p.close());
  const initial = p.command('inspect'), nextAddress = p.processor.synth.nextAddress;
  p.command('auditionOn', [0, 60, 'wave-low']);
  p.command('auditionOn', [23, 67, 'wave-high']); p.render(1024);
  const held = p.command('inspect');
  for (const multiplier of [.3, -.4, .75]) {
    const prepared = preparePs1Waveform(Array.from({length:112}, (_, i) => multiplier * Math.sin(2 * Math.PI * i / 112)));
    const sent = p.messages.length;
    const result = p.command('setInstrumentWaveform', [prepared]);
    assert.equal(p.messages.length, sent + 1, 'one global patch produces one response and snapshot');
    assert.equal(result.editorChannel, 0);
    const state = p.command('inspect');
    assert.equal(state.samples.length, 24);
    assert.equal(p.processor.synth.nextAddress, nextAddress);
    assert.deepEqual(state.samples, initial.samples, 'sample identities and private RAM addresses are reused');
    assert.deepEqual(state.auditions, held.auditions);
    assert.equal(state.channels[0].envelope, held.channels[0].envelope);
    assert.equal(state.channels[23].envelope, held.channels[23].envelope);
    for (let ch = 0; ch < 24; ch++) {
      assert.equal(state.channels[ch].sample, ch);
      assert.deepEqual(state.channels[ch].waveform.pcm, prepared.pcm);
      assert.deepEqual(p.processor.synth.sampleBytes[ch], prepared.adpcm);
      assert.equal(state.channels[ch].pitch, held.channels[ch].pitch);
    }
  }
  assert(peak(p.render(1024).left) > .001);
  const before = p.command('inspect');
  assert.throws(() => p.command('setInstrumentWaveform', [{pcm:[], adpcm:new Uint8Array(64)}]), /112 PCM/);
  assert.deepEqual(p.command('inspect'), before, 'invalid waveform cannot mutate an instrument');
});

test('global preset applies shared public samples and rejects private samples before writing any channel', async t => {
  const p = await setup(); t.after(() => p.close());
  const privateSample = p.command('getPreset', [0]).sample;
  const before = p.command('inspect');
  assert.throws(() => p.command('setInstrumentPreset', [{sample:privateSample, volumeLeft:.1}]), /another channel/);
  assert.deepEqual(p.command('inspect'), before);
  const uploaded = p.command('loadADPCM', [sine().adpcm, {baseFrequencyHz:44100 / 112, loopStartSamples:0}]);
  const sent = p.messages.length;
  p.command('setInstrumentPreset', [{sample:uploaded, volumeLeft:.4, volumeRight:.6, adsr1:0x000f, adsr2:0x1fc0, reverb:true}, {live:true}]);
  assert.equal(p.messages.length, sent + 1);
  const state = p.command('inspect');
  for (const channel of state.channels) {
    assert.equal(channel.sample, uploaded.id);
    assert.equal(channel.volumeLeft, .4); assert.equal(channel.volumeRight, .6);
    assert.equal(channel.adsr1, 0x000f); assert.equal(channel.adsr2, 0x1fc0);
    assert.equal(channel.reverb, true); assert.equal(channel.waveform, null);
  }
  p.command('setReverb', [{preset:'hall', volumeLeft:.1, volumeRight:.2}]);
  assert.equal(p.command('inspect').reverb.preset, 'hall');
  const assigned = p.command('inspect');
  assert.throws(() => p.command('setInstrumentPreset', [{volumeLeft:.7}, {live:'yes'}]), /boolean/);
  assert.throws(() => p.command('setInstrumentEnvelope', [{releaseRate:32}, {live:true}]), /releaseRate/);
  assert.deepEqual(p.command('inspect'), assigned, 'invalid global settings remain atomic');
  p.command('auditionOn', [0, 60, 'public-low']);
  p.command('auditionOn', [23, 67, 'public-high']);
  assert(peak(p.render(1024).left) > .001);
  assert.equal(p.command('inspect').samples.length, 25, 'playing allocates no samples');
});

test('global envelope edits preserve all note owners and apply live or deferred to held notes and release tails', async t => {
  const p = await setup(); t.after(() => p.close());
  p.command('setInstrumentEnvelope', [{releaseRate:31}, {live:false}]);
  for (let ch = 0; ch < 24; ch++) p.command('auditionOn', [ch, 48 + ch, `held-${ch}`]);
  p.render(1024);
  const held = p.command('inspect');
  p.command('setInstrumentEnvelope', [{releaseRate:0}, {live:false}]);
  const deferred = p.command('inspect');
  assert.deepEqual(deferred.auditions, held.auditions);
  assert.deepEqual(deferred.channels.map(ch => ch.envelope), held.channels.map(ch => ch.envelope));
  assert(deferred.channels.every(ch => ch.envelopeParameters.releaseRate === 0));
  p.command('auditionAllOff'); p.render(4096);
  assert(p.command('inspect').channels.every(ch => ch.envelope > 30000), 'all 24 release tails retain their latched RR31');
  const sent = p.messages.length;
  p.command('setInstrumentEnvelope', [{releaseRate:1}, {live:true}]);
  assert.equal(p.messages.length, sent + 1);
  p.render(4096);
  assert(p.command('inspect').channels.every(ch => ch.envelope === 0), 'live edit reaches release tails without a new note');
  assert.equal(p.command('inspect').auditions.length, 0);
  p.command('auditionOn', [0, 60, 'live-a']); p.command('auditionOn', [23, 67, 'live-b']); p.render(512);
  const current = p.command('inspect');
  p.command('setInstrumentEnvelope', [{sustainRate:126}, {live:true}]);
  const live = p.command('inspect');
  assert.deepEqual(live.auditions, current.auditions);
  assert.equal(live.channels[0].envelope, current.channels[0].envelope);
  assert.equal(live.channels[23].envelope, current.channels[23].envelope);
  assert(live.channels.every(ch => ch.envelopeParameters.sustainRate === 126));
});

test('instrument pitch bends all allocated notes and release tails atomically without owner changes or drift', async t => {
  const p = await setup(); t.after(() => p.close());
  p.command('setInstrumentEnvelope', [{releaseRate:31}, {live:false}]);
  p.command('setInstrumentPitchBend', [1]);
  const expected = (midi, bend, sample = p.processor.synth.samples[0]) => Math.round(sample.basePitch * 440 * 2 ** ((midi - 69 + bend) / 12) / sample.rootFrequencyHz);
  p.command('auditionOn', [0, 60, 'held']);
  assert.equal(p.command('inspect').channels[0].pitch, expected(60, 1), 'new note inherits the current instrument bend');
  p.command('auditionOn', [23, 67, 'tail']); p.render(1024);
  p.command('auditionOff', [23, 'tail']); p.render(256);
  const before = p.command('inspect');
  for (const bend of [-2, 2, 0, 2, 0]) {
    const sent = p.messages.length;
    p.command('setInstrumentPitchBend', [bend]);
    assert.equal(p.messages.length, sent + 1);
    const after = p.command('inspect');
    assert.equal(after.channels[0].pitch, expected(60, bend));
    assert.equal(after.channels[23].pitch, expected(67, bend));
    assert.deepEqual(after.auditions, before.auditions);
    assert.deepEqual(after.channels.map(ch => ch.envelope), before.channels.map(ch => ch.envelope));
    assert.deepEqual(after.channels.map(ch => ch.gate), before.channels.map(ch => ch.gate));
    assert.equal(after.channels[1].pitch, before.channels[1].pitch, 'never-used voices are untouched');
  }
  const stable = p.command('inspect');
  for (const bend of [NaN, -2.01, Infinity]) assert.throws(() => p.command('setInstrumentPitchBend', [bend]), /Pitch bend/);
  assert.deepEqual(p.command('inspect'), stable);
  const lowRoot = p.command('loadADPCM', [sine().adpcm, {baseFrequencyHz:80, loopStartSamples:0}]);
  p.command('setPreset', [23, {sample:lowRoot}]);
  const incompatible = p.command('inspect');
  assert.throws(() => p.command('setInstrumentPitchBend', [2]), /PITCH range/);
  assert.deepEqual(p.command('inspect'), incompatible, 'later invalid target cannot partially bend an earlier voice');
  assert.equal(p.processor.instrumentBend, 0);
  p.command('stop');
  const stopped = p.command('inspect');
  assert.deepEqual(Array.from(p.processor.lastMidi), Array(24).fill(null));
  p.command('setInstrumentPitchBend', [1]);
  assert.deepEqual(p.command('inspect').channels.map(ch => ch.pitch), stopped.channels.map(ch => ch.pitch), 'Stop removes stale bend targets');
  assert.equal(peak(p.render(8192).left), 0);
  p.command('auditionOn', [0, 64, 'again']);
  assert.equal(p.command('inspect').channels[0].pitch, expected(64, 1));
});

test('instrument round robin owns all 24 real voices and stale stolen releases cannot stop replacements', async t => {
  const p = await setup(); t.after(() => p.close());
  const initial = p.command('inspect'), nextAddress = p.processor.synth.nextAddress;
  const allocations = [];
  for (let note = 0; note < 26; note++) {
    const sent = p.messages.length;
    allocations.push(p.command('instrumentNoteOn', [48 + note, `round-${note}`]));
    assert.equal(p.messages.length, sent + 1);
  }
  assert.deepEqual(allocations.map(value => value.channel), [...Array(24).keys(), 0, 1]);
  assert.deepEqual(allocations.map(value => value.stolenId), [...Array(24).fill(null), 'round-0', 'round-1']);
  const held = p.command('inspect');
  assert.equal(held.auditions.length, 24);
  assert.equal(held.auditions.find(note => note.channel === 0).id, 'round-24');
  assert.equal(held.auditions.find(note => note.channel === 1).id, 'round-25');
  assert.equal(p.command('instrumentNoteOff', ['round-0']), false);
  assert.equal(p.command('instrumentNoteOff', ['round-1']), false);
  assert.deepEqual(p.command('inspect').auditions, held.auditions);
  assert(p.command('inspect').channels.every(voice => voice.gate));
  assert.equal(p.command('instrumentNoteOff', ['round-10']), true);
  const reused = p.command('instrumentNoteOn', [60, 'released-slot']);
  assert.equal(reused.channel, 10); assert.equal(reused.stolenId, null);
  assert.equal(p.processor.synth.nextAddress, nextAddress);
  assert.deepEqual(p.command('inspect').samples, initial.samples, 'round robin never allocates or copies sample resources per note');
  assert(peak(p.render(1024).left) > .001);
});

test('invalid instrument note is atomic for round robin, leases, pitch and envelope', async t => {
  const p = await setup(); t.after(() => p.close());
  p.command('instrumentNoteOn', [60, 'original']); p.render(1024);
  const before = p.command('inspect'), entries = p.processor.voices.entries(), next = p.processor.voices.peek();
  for (const args of [[128, 'invalid'], [60, ''], [60, 'original'], [60, 'bad-bend', NaN], [127, 'out-of-range', 2], [92, 'natural-out-of-range', -2]]) {
    assert.throws(() => p.command('instrumentNoteOn', args));
    assert.deepEqual(p.command('inspect'), before);
    assert.deepEqual(p.processor.voices.entries(), entries);
    assert.equal(p.processor.voices.peek(), next);
  }
  const valid = p.command('instrumentNoteOn', [64, 'next']);
  assert.equal(valid.channel, 1);
  const incompatible = p.command('loadADPCM', [sine().adpcm, {baseFrequencyHz:1, loopStartSamples:0}]);
  p.command('setPreset', [2, {sample:incompatible}]);
  const assigned = p.command('inspect');
  assert.throws(() => p.command('instrumentNoteOn', [60, 'bad-tuning']), /PITCH range/);
  assert.deepEqual(p.command('inspect'), assigned);
  assert.equal(p.processor.voices.peek(), 2, 'chosen voice is validated before allocator mutation');
});

test('instrument all-notes-off keeps Release tails bendable while Stop resets allocation and note targets', async t => {
  const p = await setup(); t.after(() => p.close());
  p.command('setInstrumentEnvelope', [{releaseRate:31}, {live:false}]);
  p.command('instrumentNoteOn', [60, 'chord-low']);
  p.command('instrumentNoteOn', [64, 'chord-mid']);
  p.command('instrumentNoteOn', [67, 'chord-high']); p.render(1024);
  p.command('instrumentAllNotesOff');
  const release = p.command('inspect');
  assert.equal(release.auditions.length, 0);
  assert.equal(p.processor.voices.entries().length, 0);
  assert(release.channels.slice(0, 3).every(voice => !voice.gate && voice.envelope > 30000));
  p.command('setInstrumentPitchBend', [2]);
  const bent = p.command('inspect');
  for (const [ch, midi] of [[0, 60], [1, 64], [2, 67]]) {
    const sample = p.processor.synth.samples[ch];
    assert.equal(bent.channels[ch].pitch, Math.round(sample.basePitch * 440 * 2 ** ((midi - 69 + 2) / 12) / sample.rootFrequencyHz));
    assert.equal(bent.channels[ch].envelope, release.channels[ch].envelope);
    assert.equal(bent.channels[ch].gate, false);
  }
  assert.equal(p.command('instrumentNoteOff', ['chord-low']), false);
  assert.equal(p.command('instrumentNoteOn', [65, 'after-all-off']).channel, 0);
  p.command('stop');
  assert.equal(p.processor.voices.entries().length, 0);
  assert.deepEqual(Array.from(p.processor.lastMidi), Array(24).fill(null));
  assert.equal(peak(p.render(8192).left), 0);
  assert.equal(p.command('instrumentNoteOff', ['after-all-off']), false);
  assert.equal(p.command('instrumentNoteOn', [69, 'after-stop']).channel, 0);
  assert(peak(p.render(1024).left) > .001);
});

test('imported audio to PCM cycle keeps every MIDI note and explicit bend without implicit KON', async t => {
  const p = await setup(); t.after(() => p.close());
  const uploaded = p.command('loadADPCM', [sine().adpcm, {baseFrequencyHz:440, loopStartSamples:0}]);
  p.command('setInstrumentPreset', [{sample:uploaded}]);
  p.command('setInstrumentEnvelope', [{releaseRate:31}, {live:false}]);
  const bends = Array.from({length:24}, (_, ch) => [-2, 0, 1][ch % 3]);
  for (let ch = 0; ch < 24; ch++) p.command('instrumentNoteOn', [48 + ch, `import-${ch}`, bends[ch]]);
  p.render(1024);
  p.command('instrumentNoteOff', ['import-23']); p.render(256);
  const before = p.command('inspect'), nextAddress = p.processor.synth.nextAddress;
  const transitions = [], core = p.processor.synth.core, audition = core.auditionKey.bind(core);
  core.auditionKey = (ch, on) => {transitions.push({ch, on}); return audition(ch, on);};
  const pcm = preparePs1Waveform(Array.from({length:112}, (_, i) => .4 * Math.sin(2 * Math.PI * i / 112)));
  p.command('setInstrumentWaveform', [pcm, {retrigger:false}]);
  const after = p.command('inspect');
  assert.deepEqual(transitions, [], 'changing the selected waveform does not implicitly restart notes');
  assert.deepEqual(after.auditions, before.auditions);
  assert.deepEqual(after.channels.map(ch => ch.envelope), before.channels.map(ch => ch.envelope));
  assert.deepEqual(after.channels.map(ch => ch.gate), before.channels.map(ch => ch.gate));
  assert.equal(p.processor.synth.nextAddress, nextAddress);
  for (let ch = 0; ch < 24; ch++) {
    assert.equal(after.channels[ch].sample, ch);
    assert.equal(after.channels[ch].pitch, Math.round(4096 * 440 * 2 ** ((48 + ch - 69 + bends[ch]) / 12) / (44100 / 112)));
    assert.deepEqual(after.channels[ch].waveform.pcm, pcm.pcm);
  }
  assert(peak(p.render(1024).left) > .001);
  p.command('setInstrumentWaveform', [sine(), {retrigger:true}]);
  assert.equal(transitions.length, 23, 'explicit retrigger applies only to held notes');
  assert(transitions.every(({ch, on}) => on && ch !== 23));
});

test('waveform tuning is validated before RAM changes while finished notes cannot block a new cycle', async t => {
  const p = await setup(); t.after(() => p.close());
  const uploaded = p.command('loadADPCM', [sine().adpcm, {baseFrequencyHz:882, loopStartSamples:0}]);
  p.command('setInstrumentPreset', [{sample:uploaded}]);
  p.command('instrumentNoteOn', [96, 'high-import']); p.render(1024);
  const before = p.command('inspect'), ram = p.processor.synth.sampleBytes.map(bytes => bytes.slice());
  const pcm = preparePs1Waveform(Array.from({length:112}, (_, i) => i < 56 ? .2 : -.2));
  assert.throws(() => p.command('setInstrumentWaveform', [pcm]), /PITCH range/);
  assert.deepEqual(p.command('inspect'), before);
  assert.deepEqual(p.processor.synth.sampleBytes, ram, 'out-of-range cycle pitch is rejected before any sample RAM copy');
  assert.equal(p.processor.lastMidi[0], 96);
  p.command('instrumentNoteOff', ['high-import']); p.render(4096);
  assert.equal(p.command('inspect').channels[0].envelope, 0);
  p.command('setInstrumentWaveform', [pcm]);
  assert.equal(p.command('inspect').channels[0].waveform.pcm[0], pcm.pcm[0]);
  assert.equal(p.processor.lastMidi[0], null, 'finished notes retire their old MIDI and bend targets');
  assert.equal(p.processor.lastBend[0], null);
  p.command('setInstrumentPitchBend', [2]);
  p.command('instrumentNoteOn', [69, 'cycle-note']);
  assert.equal(p.command('inspect').channels[1].pitch, Math.round(4096 * 440 * 2 ** (2 / 12) / (44100 / 112)));
  assert(peak(p.render(1024).left) > .001);
});
