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
import {readPmon, pmonAdsr, pmonPcm} from './spu_synth_pmon.js';
import {readNoise} from './spu_synth_noise.js';
import {readMorph, morphPcm} from './spu_synth_morph.js';
import {SPU_SYNTH_MIX_HEADROOM,spuSynthVoiceVolume} from './spu_synth_levels.js';

const source = await readFile(new URL('./spu_synth_worklet.js', import.meta.url), 'utf8');
const wasmBinary = await readFile(new URL('../generated/ps1_spu_wasm.wasm', import.meta.url));
const sine = () => preparePs1Waveform(Array.from({length:112}, (_, i) => .65 * Math.sin(2 * Math.PI * i / 112)));
const peak = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);

test('main thread encodes one instrument wave once and sends no per-key sample uploads', async t => {
  const audioSource = await readFile(new URL('./spu_synth_audio.js', import.meta.url), 'utf8');
  const requests = [],gainParameters=[];
  let encodes = 0, createAudio;
  class Context {
    constructor() {this.currentTime=0;this.state = 'suspended'; this.audioWorklet = {addModule:async () => {}};}
    addEventListener() {}
    removeEventListener() {}
    createGain() {const gain={value:1,cancelAndHoldAtTime(){},linearRampToValueAtTime(value){this.value=value;}};gainParameters.push(gain);return {gain,connect(){},disconnect(){}};}
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
    readPmon, pmonPcm, readMorph, morphPcm, SPU_SYNTH_MIX_HEADROOM, AudioContext:Context, AudioWorkletNode:WorkletNode,
    preparePs1Waveform:pcm => {encodes++; return preparePs1Waveform(pcm);},
    SOUNDCHIP_MIXER_PRESETS:{calibrated:{factoryDefaults:{kinds:[{name:'ps1', volume:.128832}]}}},
    URL, fetch:async () => ({ok:true, arrayBuffer:async () => wasmBinary.buffer}),
    setTimeout, clearTimeout, provide:value => {createAudio = value;},
  });
  const audio = await createAudio(); t.after(() => audio.dispose());
  assert.equal(gainParameters[0].value,.128832*SPU_SYNTH_MIX_HEADROOM,'post-chip gain compensates fixed voice attenuation');
  audio.setVolume(.7);assert.equal(gainParameters[0].value,.7*.128832*SPU_SYNTH_MIX_HEADROOM,'Master ramps retain compensation');
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
  const encodedBefore=encodes, config=readMorph({enabled:true,amount:.5});
  await audio.command('setInstrumentMorph',[config]);
  assert.equal(encodes,encodedBefore+1,'one morph edit encodes once for all voices on the main thread');
  assert.deepEqual(requests.at(-1).args[1].pcm,morphPcm(config));
  await audio.command('setInstrumentMorph',[{...config,enabled:false}]);
  assert.equal(encodes,encodedBefore+1,'turning morph Off does not encode or upload');
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
    import {readPmon, pmonAdsr} from ${url('./spu_synth_pmon.js')};
    import {readNoise} from ${url('./spu_synth_noise.js')};
    import {readMorph, morphPcm} from ${url('./spu_synth_morph.js')};
    import {spuSynthVoiceVolume} from ${url('./spu_synth_levels.js')};
    const source = await readFile(new URL(${url('./spu_synth_worklet.js')}), 'utf8');
    const wasmBinary = await readFile(new URL(${url('../generated/ps1_spu_wasm.wasm')}));
    const initialWaveform = preparePs1Waveform(Array.from({length:112}, (_,i)=>.65*Math.sin(2*Math.PI*i/112)));
    let Processor;
    const messages = [];
    vm.runInNewContext(source.replace(/^import .*;\\n/gm,'').replace('export class SpuSynthProcessor','class SpuSynthProcessor'), {
      factory, Ps1Spu, Ps1Synth, Ps1Resampler, Ps1VoiceInspector, patchPs1Envelope, SpuRoundRobinVoices, readPmon, pmonAdsr, readNoise, readMorph, morphPcm, spuSynthVoiceVolume, sampleRate:48000,
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
    factory, Ps1Spu, Ps1Synth, Ps1Resampler, Ps1VoiceInspector, patchPs1Envelope, SpuRoundRobinVoices, readPmon, pmonAdsr, readNoise, readMorph, morphPcm, spuSynthVoiceVolume, sampleRate:rate,
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
  for (let ch = 0; ch < 24; ch++) {const sample = synth._setWaveformPrepared(ch, sine()); synth.setPreset(ch, {sample,volumeLeft:.75/SPU_SYNTH_MIX_HEADROOM,volumeRight:.75/SPU_SYNTH_MIX_HEADROOM});}
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

function pmonSettings(p, values) {
  const settings=readPmon({...p.processor.pmon,...values});
  return p.command('setInstrumentPmon',[settings,settings.enabled ? preparePs1Waveform(pmonPcm(settings.depth,settings.waveform)) : undefined]);
}

test('PMON pairs all 24 physical voices into 12 identity-safe notes and keeps modulators silent',async t=>{
  const p=await setup(44100);t.after(()=>p.processor.dispose());
  p.command('instrumentNoteOn',[60,'old']);p.render(512);
  pmonSettings(p,{enabled:true,decayMs:0});
  assert.equal(p.command('inspect').auditions.length,0,'topology switch stops earlier notes');
  assert.equal(p.command('inspect').polyphony,12);
  const core=p.processor.synth.core,base=p.processor.synth.nextAddress;
  assert.equal(core.read(0x190),0xaaaa);assert.equal(core.read(0x192),0xaa);
  for(let slot=0;slot<12;slot++) {
    const note=p.command('instrumentNoteOn',[48+slot,`pair-${slot}`]);
    assert.equal(note.channel,slot*2+1);
    assert.equal(core.read(slot*32),0);assert.equal(core.read(slot*32+2),0,'source has no direct L/R output');
  }
  assert.equal(p.processor.synth.nextAddress,base,'Note On allocates no sample memory');
  assert.equal(p.command('inspect').auditions.length,12);
  assert(peak(p.render(4096).left)>.001);
  const replacement=p.command('instrumentNoteOn',[70,'replacement']);
  assert.equal(replacement.channel,1);assert.equal(replacement.stolenId,'pair-0');
  assert.equal(p.command('instrumentNoteOff',['pair-0']),false,'stolen release cannot stop the new pair');
  assert.equal(p.command('instrumentNoteOff',['old']),false,'pre-switch release cannot reach a pair');
  assert.equal(p.command('instrumentNoteOff',['replacement']),true);
  p.command('instrumentAllNotesOff');p.render(4096);
  assert.equal(peak(p.render(256).left),0);
  pmonSettings(p,{enabled:false});
  assert.equal(core.read(0x190),0);assert.equal(core.read(0x192),0);assert.equal(p.command('inspect').polyphony,24);
  assert.equal(p.command('instrumentNoteOn',[60,'single']).channel,0,'normal round robin is restored');
});

test('PMON has real audible modulation, independent decay, reusable depth packets and coherent bend/tails',async t=>{
  const dry=await setup(44100),wet=await setup(44100);t.after(()=>{dry.processor.dispose();wet.processor.dispose();});
  pmonSettings(dry,{enabled:true,depth:0,decayMs:0});
  pmonSettings(wet,{enabled:true,depth:.8,ratio:2,decayMs:500});
  for(const p of [dry,wet])p.command('instrumentNoteOn',[60,'note']);
  const a=dry.render(4096).left,b=wet.render(4096).left;
  assert(a.some((value,i)=>Math.abs(value-b[i])>.01),'hardware PMON changes rendered PCM');
  const core=wet.processor.synth.core,ramEnd=wet.processor.synth.nextAddress;
  const keyWrites=[],write=core.write;
  core.write=function(address,value){if([0x188,0x18a].includes(address))keyWrites.push([address,value]);return write.call(this,address,value);};
  let uploads=0;const loadRam=core.loadRam;
  core.loadRam=function(...args){uploads++;return loadRam.apply(this,args);};
  pmonSettings(wet,{ratio:3});pmonSettings(wet,{ratio:2,decayMs:740});
  assert.equal(uploads,0,'Ratio and Decay edits do not invalidate sample RAM');
  wet.command('setInstrumentPitchBend',[2]);
  assert.equal(core.read(4),Math.round(4096*440*2**((60-69+2)/12)*2/(44100/112)));
  assert.equal(keyWrites.length,0,'bend updates both pitches without KON');
  for(let i=0;i<10;i++)pmonSettings(wet,{depth:i/10,ratio:1+i/10});
  assert.equal(wet.processor.synth.nextAddress,ramEnd,'depth replaces a single reserved 64-byte Sine slot');
  wet.render(44100);
  assert.equal(core.read(12),0,'only the modulator has decayed');assert(core.read(28)>0,'carrier remains held');
  assert(peak(wet.render(2048).left)>.001);
  wet.command('instrumentNoteOff',['note']);wet.command('setInstrumentPitchBend',[-2]);
  assert.equal(keyWrites.length,0,'release-tail bend never starts another note');
  wet.command('stop');assert.equal(core.read(0x190),0xaaaa,'Stop retains PMON settings');
  assert.equal(peak(wet.render(4096).left),0,'Stop resets carrier, source and resampler tails');
  assert.equal(wet.command('instrumentNoteOn',[60,'again']).channel,1);
  assert(peak(wet.render(2048).left)>.001,'PMON works again after Stop');
});

test('PMON keeps the authored instrument separate from its source, validates atomically and saves portable settings',async t=>{
  const p=await setup(44100);t.after(()=>p.processor.dispose());
  pmonSettings(p,{enabled:true,ratio:.5,depth:.7,decayMs:1200});p.command('instrumentNoteOn',[60,'held']);p.render(2048);
  const core=p.processor.synth.core,sourceAddress=core.read(6);
  p.command('setInstrumentPreset',[{volumeLeft:.4,volumeRight:.6,adsr1:0x100f},{live:true}]);
  p.command('setInstrumentEnvelope',[{sustainRate:127},{live:true}]);
  p.command('setInstrumentWaveform',[preparePs1Waveform(Array.from({length:112},(_,i)=>i<56?.4:-.4)),{retrigger:true}]);
  assert.equal(core.read(0),0);assert.equal(core.read(2),0);assert.equal(core.read(6),sourceAddress);
  assert.equal(core.read(8),15,'carrier ADSR edits do not alter the source Attack');
  assert.equal(core.read(16),spuSynthVoiceVolume(.4));
  const saved=p.command('getInstrument',[0]);
  assert.equal(saved.preset.volumeLeft,.4);assert.equal(saved.preset.adsr1,0x100f);
  assert.equal(saved.sample.adpcm.length,64);assert.equal(saved.waveform[0],Math.fround(.4),'save exports the carrier waveform');
  assert.equal(saved.pmon.ratio,.5);assert.equal(saved.pmon.decayMs,1200);
  const before=core.readRam(),owners=JSON.stringify(p.command('inspect').auditions);
  for(const invalid of [{enabled:'yes'},{ratio:0},{ratio:Infinity},{depth:1.1},{decayMs:-1},{unknown:1}]) {
    assert.throws(()=>p.command('setInstrumentPmon',[invalid]),/PMON|Modulation/);
    assert.deepEqual(core.readRam(),before);assert.equal(JSON.stringify(p.command('inspect').auditions),owners);
  }
  assert.throws(()=>p.command('setInstrumentPmon',[readPmon({enabled:true}),{pcm:Array(112).fill(0),adpcm:new Uint8Array(64)}]),/looping/);
  assert.equal(JSON.stringify(p.command('inspect').auditions),owners,'bad packets do not stop a held pair');
});

test('reverb preset selection atomically enables all carriers, Off disables, and manual bypass retains settings',async t=>{
  const p=await setup();t.after(()=>p.processor.dispose());
  p.command('instrumentNoteOn',[60,'reverb-held']);p.render(1024);
  const owners=JSON.stringify(p.command('inspect').auditions);
  p.command('setReverb',[{volumeLeft:.3,volumeRight:.4}]);
  p.command('setInstrumentReverbPreset',[{preset:'room'}]);
  let state=p.command('inspect');
  assert(state.channels.every(ch=>ch.reverb));assert.equal(state.reverb.preset,'room');
  assert.equal(state.reverb.volumeLeft,.3);assert.equal(state.reverb.volumeRight,.4);
  assert.equal(JSON.stringify(state.auditions),owners);
  p.command('setInstrumentPreset',[{reverb:false}]);
  const bypassed=p.command('inspect');assert(bypassed.channels.every(ch=>!ch.reverb));
  assert.deepEqual(bypassed.reverb,state.reverb);
  p.command('setInstrumentPreset',[{reverb:true}]);
  assert.deepEqual(p.command('inspect').reverb,state.reverb);
  assert.throws(()=>p.command('setInstrumentReverbPreset',[{preset:'missing'}]),/preset/);
  assert(p.command('inspect').channels.every(ch=>ch.reverb));
  p.command('setInstrumentReverbPreset',[{preset:'off'}]);
  state=p.command('inspect');assert.equal(state.reverb.preset,'off');assert(state.channels.every(ch=>!ch.reverb));
  assert.equal(JSON.stringify(state.auditions),owners,'selection never restarts or releases a held note');
  pmonSettings(p,{enabled:true});p.command('instrumentNoteOn',[60,'pair']);
  p.command('setInstrumentReverbPreset',[{preset:'hall'}]);
  assert(p.command('inspect').channels.every(ch=>ch.reverb));
  assert.equal(p.processor.synth.core.read(0),0,'silent PMON source remains silent');
  assert(peak(p.render(4096).left)>.001);
});

test('all four PMON waveforms change held-note PCM without KON or allocating another sample',async t=>{
  const p=await setup(44100);t.after(()=>p.processor.dispose());
  pmonSettings(p,{enabled:true,depth:.8,ratio:2,decayMs:0});p.command('instrumentNoteOn',[60,'shape']);p.render(2048);
  const ramEnd=p.processor.synth.nextAddress,owners=JSON.stringify(p.command('inspect').auditions),core=p.processor.synth.core;
  const writes=[],write=core.write;core.write=function(at,value){if([0x188,0x18a].includes(at))writes.push(at);return write.call(this,at,value);};
  const signals=[];
  for(const waveform of ['sine','triangle','saw','square']) {
    pmonSettings(p,{waveform});p.render(2048);const pcm=p.render(4096).left;
    assert(peak(pcm)>.001);signals.push(pcm);
    assert.equal(JSON.stringify(p.command('inspect').auditions),owners);
    assert.equal(p.processor.synth.nextAddress,ramEnd);assert.equal(p.command('getInstrument',[0]).pmon.waveform,waveform);
  }
  for(let i=0;i<signals.length;i++)for(let j=0;j<i;j++)assert(signals[i].some((v,k)=>Math.abs(v-signals[j][k])>.001));
  assert.equal(writes.length,0,'wave changes retain source/carrier envelope and phase');
  assert.throws(()=>pmonSettings(p,{waveform:'invalid'}),/waveform/);
});

test('Noise is actual shared-clock SPU output, independent of Note/bend, with live clock and ADSR release',async t=>{
  const a=await setup(44100),b=await setup(44100);t.after(()=>{a.processor.dispose();b.processor.dispose();});
  for(const p of [a,b])p.command('setInstrumentNoise',[{enabled:true,clock:48}]);
  a.command('instrumentNoteOn',[0,'low']);b.command('instrumentNoteOn',[127,'high']);
  assert.deepEqual(a.render(8192),b.render(8192),'Noise does not follow musical pitch');
  const core=a.processor.synth.core;
  assert.equal(core.read(0x194),0xffff);assert.equal(core.read(0x196),0xff);assert.equal(core.read(0x190),0);
  a.command('setInstrumentPitchBend',[2]);assert.deepEqual(a.render(4096),b.render(4096),'Noise ignores sample Pitch bend');
  const keys=[],write=core.write;core.write=function(at,v){if([0x188,0x18a].includes(at))keys.push(at);return write.call(this,at,v);};
  const ramEnd=a.processor.synth.nextAddress,owners=JSON.stringify(a.command('inspect').auditions);
  a.command('setInstrumentNoise',[{enabled:true,clock:63}]);
  assert.equal(JSON.stringify(a.command('inspect').auditions),owners);assert.equal(keys.length,0);
  assert.equal(core.read(0x1aa)>>8&63,63);assert.equal(a.processor.synth.nextAddress,ramEnd);
  const fast=a.render(4096).left,slow=b.render(4096).left;
  assert(peak(fast)>.001);assert(fast.some((v,i)=>Math.abs(v-slow[i])>.001),'Noise clock changes actual output');
  a.command('instrumentNoteOff',['low']);a.render(2048);assert.equal(peak(a.render(256).left),0);
  assert(peak(b.render(2048).left)>.001,'the foreign instance is unaffected');
  a.command('stop');assert.equal(peak(a.render(1024).left),0);assert.equal(core.read(0x194),0xffff,'Stop retains Noise mode');
  a.command('instrumentNoteOn',[60,'again']);assert(peak(a.render(2048).left)>.001);
});

test('Noise holds independently of one-shot imported audio, preserves samples, switches PMON safely and validates atomically',async t=>{
  const p=await setup(44100);t.after(()=>p.processor.dispose());
  const one=sine().adpcm.slice();one[1]=0;one[49]=1;
  const sample=p.command('loadADPCM',[one,{baseFrequencyHz:10}]);p.command('setInstrumentPreset',[{sample}]);
  const ramEnd=p.processor.synth.nextAddress;
  p.command('setInstrumentNoise',[{enabled:true,clock:60}]);p.command('instrumentNoteOn',[127,'noise']);p.render(44100);
  assert(peak(p.render(2048).left)>.001,'one-shot END and extreme sample tuning do not stop Noise');
  const saved=p.command('getInstrument',[0]);assert.deepEqual(saved.sample.adpcm,one);assert.equal(saved.noise.enabled,true);
  assert.equal(p.processor.synth.nextAddress,ramEnd,'Noise reuses reserved private loop slots');
  const owners=JSON.stringify(p.command('inspect').auditions),control=p.processor.synth.core.read(0x1aa);
  for(const value of [{enabled:1},{clock:64},{clock:-1},{clock:1.5},{clock:NaN},{extra:1}]) {
    assert.throws(()=>p.command('setInstrumentNoise',[value]),/Noise/);
    assert.equal(p.processor.synth.core.read(0x1aa),control);assert.equal(JSON.stringify(p.command('inspect').auditions),owners);
  }
  // Restore a normally tuned carrier, then switch from Noise to paired PMON.
  p.command('setInstrumentWaveform',[sine()]);
  pmonSettings(p,{enabled:true,waveform:'square'});
  let state=p.command('inspect');assert.equal(state.noise.enabled,false);assert.equal(state.polyphony,12);assert.equal(state.auditions.length,0);
  assert.equal(p.processor.synth.core.read(0x194),0);assert.equal(p.command('instrumentNoteOff',['noise']),false);
  p.command('instrumentNoteOn',[60,'pair']);
  p.command('setInstrumentNoise',[{enabled:false,clock:42}]);assert.equal(p.command('inspect').auditions.length,1,'editing stored Noise clock does not disable PMON');
  p.command('setInstrumentNoise',[{enabled:true,clock:42}]);state=p.command('inspect');
  assert.equal(state.pmon.enabled,false);assert.equal(state.pmon.waveform,'square');assert.equal(state.polyphony,24);assert.equal(state.auditions.length,0);
  assert.equal(p.processor.synth.core.read(0x190),0);assert.equal(p.command('instrumentNoteOff',['pair']),false);
  p.command('setInstrumentNoise',[{enabled:false,clock:42}]);assert.equal(p.processor.synth.core.read(0x194),0);
  p.command('instrumentNoteOn',[60,'sample']);assert(peak(p.render(2048).left)>.001,'Sample playback is restored');
});

test('Software morph overwrites reserved PCM slots while held, without KON, envelope reset or RAM growth',async t=>{
  const p=await setup(44100);t.after(()=>p.close());
  p.command('instrumentNoteOn',[60,'morph']);p.render(2048);
  const before=p.command('inspect'),core=p.processor.synth.core,writes=[],write=core.write;
  core.write=function(at,value){if([0x188,0x18a].includes(at))writes.push(at);return write.call(this,at,value);};
  const signals=[];
  for(const amount of [0,.5,1,0]) {
    const config=readMorph({enabled:true,amount});
    p.command('setInstrumentMorph',[config,preparePs1Waveform(morphPcm(config))]);
    const state=p.command('inspect');
    assert.equal(JSON.stringify(state.auditions),JSON.stringify(before.auditions));
    assert.equal(state.nextAddress,before.nextAddress);assert.equal(state.samples.length,before.samples.length);
    assert(state.channels.every(ch=>JSON.stringify(ch.waveform.pcm)===JSON.stringify(morphPcm(config))));
    p.render(2048);signals.push(p.render(4096).left);
    assert.deepEqual(p.command('getInstrument',[0]).morph,config);
  }
  assert.equal(writes.length,0);assert(peak(signals[1])>.001);
  assert(signals[0].some((x,i)=>Math.abs(x-signals[1][i])>.001));
  assert(signals[1].some((x,i)=>Math.abs(x-signals[2][i])>.001));
  const state=JSON.stringify(p.command('inspect'));
  assert.throws(()=>p.command('setInstrumentMorph',[{enabled:true,amount:2}]),/Morph/);
  assert.throws(()=>p.command('setInstrumentMorph',[{enabled:true,amount:1},sine()]),/matching/);
  assert.equal(JSON.stringify(p.command('inspect')),state,'invalid morph does not touch RAM or voices');
  p.command('setInstrumentWaveform',[sine()]);assert(!p.command('inspect').morph.enabled);
});

test('Software morph keeps PMON pairs and Noise independent, Stop retains its settings',async t=>{
  const p=await setup();t.after(()=>p.close());
  pmonSettings(p,{enabled:true,decayMs:0});p.command('instrumentNoteOn',[60,'pair']);p.render(1024);
  const config=readMorph({enabled:true,amount:.65});
  p.command('setInstrumentMorph',[config,preparePs1Waveform(morphPcm(config))]);
  assert.equal(p.command('inspect').auditions[0].channel,1);assert(p.command('inspect').pmon.enabled);
  assert.equal(p.processor.synth.core.read(0),0,'PMON source stays silent');assert(peak(p.render(4096).left)>.001);
  p.command('stop');assert.deepEqual(p.command('inspect').morph,config);
  p.command('setInstrumentNoise',[{enabled:true}]);p.command('instrumentNoteOn',[60,'noise']);
  p.command('setInstrumentMorph',[config,preparePs1Waveform(morphPcm(config))]);
  assert(p.command('inspect').noise.enabled);assert(peak(p.render(4096).left)>.001);
  p.command('setInstrumentMorph',[{...config,enabled:false}]);
  assert.deepEqual(p.command('getInstrument',[0]).waveform,morphPcm(config),'Off freezes the last blend');
});

test('Sine C/E/G stays linear with PMON Off; fixed headroom preserves the sum of separately played notes',async t=>{
  async function signal(notes,patch={}) {
    const p=await setup(44100);t.after(()=>p.close());
    if(Object.keys(patch).length)p.command('setInstrumentPreset',[patch]);
    for(const [i,note] of notes.entries())p.command('instrumentNoteOn',[note,`note-${i}`]);
    p.render(4096);return {p,pcm:p.render(65536).left};
  }
  const single=await Promise.all([60,64,67].map(note=>signal([note])));
  for(const indices of [[0,1],[1,2],[0,1,2]]) {
    const {p,pcm}=await signal(indices.map(i=>[60,64,67][i]));
    let maximumError=0,squaredError=0,saturated=0;
    for(let i=0;i<pcm.length;i++) {
      const expected=indices.reduce((sum,ch)=>sum+single[ch].pcm[i],0),error=pcm[i]-expected;
      maximumError=Math.max(maximumError,Math.abs(error));squaredError+=error*error;
      if(Math.abs(pcm[i])>.9998)saturated++;
    }
    assert.equal(saturated,0);assert(maximumError<.0002,`chord adds linearly: ${maximumError}`);
    assert(Math.sqrt(squaredError/pcm.length)<.0001);
    assert.equal(p.processor.synth.core.read(0x190),0);assert.equal(p.processor.synth.core.read(0x192),0);
    assert(p.command('inspect').channels.every(ch=>ch.volumeLeft===.75&&ch.volumeRight===.75));
    assert.equal(p.processor.synth.core.read(0),spuSynthVoiceVolume(.75));
    assert(peak(pcm)*SPU_SYNTH_MIX_HEADROOM*.129331<1,'compensated calibrated output is below full scale');
  }
  const {pcm:eight}=await signal(Array(8).fill(60));
  assert(peak(eight)<.99,'even eight phase-aligned default Sines fit the SPU accumulator');
  let maximum=0;for(let i=0;i<eight.length;i++)maximum=Math.max(maximum,Math.abs(eight[i]-8*single[0].pcm[i]));
  assert(maximum<.001,'fixed headroom has no voice-count pumping');
});

test('headroom protects full-amplitude three-note samples and keeps signed authored volumes portable',async t=>{
  const p=await setup(44100);t.after(()=>p.close());
  const wave=preparePs1Waveform(Array.from({length:112},(_,i)=>i<56?1:-1));
  p.command('setInstrumentWaveform',[wave]);
  p.command('setInstrumentPreset',[{volumeLeft:-1,volumeRight:1}]);
  for(const [i,note] of [60,64,67].entries())p.command('instrumentNoteOn',[note,`full-${i}`]);
  p.render(4096);const {left,right}=p.render(65536);
  assert(peak(left)<.76&&peak(right)<.76,'three full-volume, full-amplitude sources have input headroom');
  const saved=p.command('getInstrument',[0]);assert.equal(saved.preset.volumeLeft,-1);assert.equal(saved.preset.volumeRight,1);
  assert.deepEqual(saved.waveform,wave.pcm);assert.deepEqual(saved.sample.adpcm,wave.adpcm);
  assert.equal(p.processor.synth.core.read(0),spuSynthVoiceVolume(-1));assert.equal(p.processor.synth.core.read(2),spuSynthVoiceVolume(1));
  p.command('stop');p.command('instrumentNoteOn',[60,'replay']);
  assert.equal(p.processor.synth.core.read(0),spuSynthVoiceVolume(-1),'Stop and replay retain physical attenuation');
});
