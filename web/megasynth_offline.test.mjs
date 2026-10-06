import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createMegaSynthOffline} from './megasynth_offline.js';
import {NativeFXEngine} from './native_fx_engine.js';
import {createNativeFXController} from './native_fx.js';
import {FM_PRESETS} from './megasynth-fm-presets.js';
import {createYm2612} from './ym2612.js';
import {YM2612Synth, YM2612WorkletTransport} from './ym2612synth.js';
import {YM2612DacPlayer, receiveDacCommand} from './ym2612_dac.js';
import {createChipPortReceiver} from './playground_chip_port.js';
import factory from '../docs/generated/ym2612_wasm.js';

const fxModule = await WebAssembly.compile(fs.readFileSync(new URL('./native_audio_effect.wasm', import.meta.url)));
const create = options => createMegaSynthOffline({fxModule, ...options});

test('offline FM and native FX advance on the sample clock without browser globals', async () => {
  assert.equal(typeof globalThis.AudioContext, 'undefined');
  assert.equal(typeof globalThis.AudioWorkletNode, 'undefined');
  const synth = await createMegaSynthOffline();
  try {
    assert.ok(synth.render(512).left.every(x => x === 0));
    synth.fm.setPreset(0, FM_PRESETS.sine);
    const fx = synth.fx;
    fx.setChain([fx.delay({time: .01, mix: .5}), fx.reverb({mix: .15})]);
    synth.schedule(600, {target: 'fm', method: 'noteOn', args: [0, 4, 553]});
    synth.schedule(1200, {target: 'fm', method: 'noteOff', args: [0]});
    const pcm = synth.render(4096);
    assert.ok(pcm.left.slice(0, 88).every(x => x === 0));
    assert.ok(Math.max(...pcm.left) - Math.min(...pcm.left) > .05);
    assert.ok(pcm.left.every(Number.isFinite));
    assert.equal(synth.currentFrame, 4608);
    assert.equal(synth.currentTime, 4608 / 48000);
  } finally { synth.close(); }
  synth.close();
  assert.throws(() => synth.render(1), /closed/);
  assert.throws(() => synth.fm.noteOn(0, 4, 553), /closed/);
  assert.throws(() => synth.fx.gain(), /closed/);
});

test('scheduled events preserve sample position and same-frame insertion order across render calls', async () => {
  const a = await create(), b = await create();
  try {
    for (const synth of [a, b]) {
      synth.schedule(93, {target: 'fm', method: 'setPreset', args: [0, FM_PRESETS.sine]});
      synth.schedule(93, {target: 'fm', method: 'noteOn', args: [0, 4, 553]});
      synth.schedule(701, {target: 'fm', method: 'noteOff', args: [0]});
    }
    const expected = a.render(1200);
    const left = new Float32Array(1200), right = new Float32Array(1200);
    let offset = 0;
    for (const count of [7, 86, 1, 303, 304, 499]) {
      const pcm = b.render(count); left.set(pcm.left, offset); right.set(pcm.right, offset); offset += count;
    }
    assert.deepEqual(left, expected.left); assert.deepEqual(right, expected.right);
    assert.ok(left.slice(0, 93).every(x => x === 0));
    assert.throws(() => b.schedule(0, {target: 'fm', method: 'reset', args: []}), /before/);
    assert.throws(() => b.schedule(1200, {target: 'fm', method: 'constructor', args: []}), /Expected/);
    assert.throws(() => b.render(-1), /frames/);
  } finally { a.close(); b.close(); }
});

test('offline stereo FM + native delay/reverb exactly match the AudioWorklet processors', async () => {
  let Processor;
  const scope = {sampleRate: 48000, currentFrame: 0, Float32Array, Uint8Array, Error,
    YM2612DacPlayer, receiveDacCommand, createChipPortReceiver, createYm2612, ym2612ModuleFactory: factory,
    AudioWorkletProcessor: class {constructor() {this.port = {postMessage() {}};}},
    registerProcessor: (_name, Type) => {Processor = Type;}};
  vm.runInNewContext(fs.readFileSync(new URL('./ym2612-worklet.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), scope);
  const p = new Processor();
  await p.init(fs.readFileSync(new URL('../docs/generated/ym2612_wasm.wasm', import.meta.url)));
  assert.ok(p.ym2612);
  const fm = new YM2612Synth({transport: new YM2612WorkletTransport({port: {postMessage: command => p.applyCommand(command)}})});
  const dsp = new NativeFXEngine(fxModule, 48000);
  const fx = createNativeFXController(command => dsp.command(structuredClone(command)));
  const synth = await create();
  try {
    for (const controller of [fx, synth.fx]) controller.setChain([
      controller.delay({time: .01, mix: .25}), controller.reverb({mix: .15}), controller.gain({gain: .5}),
    ]);
    fm.setPreset(0, FM_PRESETS.sine); synth.fm.setPreset(0, FM_PRESETS.sine);
    fm.noteOn(0, 4, 553); synth.fm.noteOn(0, 4, 553);
    for (let i = 0; i < 20; i++) {
      const input = [new Float32Array(128), new Float32Array(128)];
      p.process([], [input]); scope.currentFrame += 128;
      const output = [new Float32Array(128), new Float32Array(128)]; dsp.process(input, output);
      const actual = synth.render(128);
      assert.deepEqual(actual.left, output[0]); assert.deepEqual(actual.right, output[1]);
    }
  } finally { synth.close(); p.ym2612.dispose(); }
});

test('invalid options and pre-aborted construction fail before opening a device', async () => {
  await assert.rejects(create({sampleRate: 1}), /sampleRate/);
  await assert.rejects(create({masterVolume: NaN}), /masterVolume/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(create({signal: controller.signal}), {name: 'AbortError'});
});

test('reset clears held resampling output without resetting the absolute event clock', async () => {
  const synth = await create({sampleRate: 96000});
  try {
    synth.fm.setPreset(0, FM_PRESETS.sine); synth.fm.noteOn(0, 4, 553);
    assert.ok(synth.render(255).left.some(x => Math.abs(x) > .01));
    synth.fm.reset();
    assert.ok(synth.render(128).left.every(x => x === 0));
    assert.equal(synth.currentFrame, 383);
  } finally { synth.close(); }
});
