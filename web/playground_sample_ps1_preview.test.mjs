import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderPs1SamplePreview} from './playground_sample_ps1_preview.js';
import {renderPs1Sample} from './playground_sample_ps1.js';
import {Ps1Spu} from './ps1_spu.js';
import {Ps1Synth} from './ps1synth.js';
import moduleFactory from '../docs/generated/ps1_spu_wasm.js';

const moduleOptions = {wasmBinary: readFileSync(new URL('../docs/generated/ps1_spu_wasm.wasm', import.meta.url))};
const coreOptions = {moduleFactory, moduleOptions};
const sine = (frames = 112) => ({sampleRate: 44100,
  channels: [Float32Array.from({length: frames}, (_, i) => .7 * Math.sin(2 * Math.PI * i / 112))]});
const peak = pcm => pcm.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

test('isolated SPU preview equals actual Synth Keyboard-root playback with one unity gain and endpoint fades', async () => {
  const audio = sine(224), settings = {rootMidi: 69, tuneCents: 53, loopEnabled: true, loopStartFrame: 28, loopEndFrame: 224};
  let destroyed = 0;
  const trackedFactory = async options => {
    const module = await moduleFactory(options), wrap = module.cwrap;
    module.cwrap = (name, ...args) => {
      const native = wrap(name, ...args);
      return name === 'ps1_spu_destroy' ? (...values) => {destroyed++; return native(...values);} : native;
    };
    return module;
  };
  const result = await renderPs1SamplePreview(audio, settings, {...coreOptions, moduleFactory: trackedFactory});
  assert.equal(destroyed, 1);
  assert.equal(result.channels.length, 2); assert.equal(result.sampleRate, 44100);
  assert.equal(result.channels[0].length, Math.round(.85 * 44100));
  assert.equal(result.durationSeconds, .85); assert.equal(result.outputGain, 1);
  assert.equal(result.rootMidi, 69); assert.equal(result.tuneCents, 53);
  assert.equal(result.frequencyHz, 440);
  assert.equal(result.sourceFrequencyHz, 440 * 2 ** (.53 / 12));
  assert.equal(result.pitch, Math.round(4096 * 440 / result.sourceFrequencyHz));
  assert.equal(result.loopEnabled, false); assert.equal(result.sampleLoopEnabled, true);
  assert.equal(result.sampleLoopStartFrame, 28); assert.equal(result.sampleLoopEndFrame, 224);
  assert.ok(Math.abs(result.peakBeforeClip - .7) < 1e-6);
  for (const pcm of result.channels) {
    assert.ok(pcm.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
    assert.ok(pcm[0] === 0); assert.ok(pcm.at(-1) === 0); assert.ok(peak(pcm) > .1);
  }
  const converted = renderPs1Sample(audio, settings), core = await Ps1Spu.create({...coreOptions, moduleOptions: {...moduleOptions}});
  const synth = new Ps1Synth({core});
  try {
    const sample = synth.loadADPCM(converted.adpcm, {baseFrequencyHz: converted.baseFrequencyHz, loopStartSamples: converted.loopStartFrame});
    synth.setPreset(0, {sample, volumeLeft: .75, volumeRight: .75, adsr1: 0x000f, adsr2: 0});
    synth.noteOn(0, settings.rootMidi);
    const expected = core.generateStereo(result.channels[0].length), fade = Math.round(.005 * 44100);
    for (const [index, pcm] of [expected.left, expected.right].entries()) for (let i = 0; i < pcm.length; i++) {
      const edge = Math.min(1, i / fade, (pcm.length - 1 - i) / fade);
      assert.equal(result.channels[index][i], Math.fround(Math.max(-1, Math.min(1, pcm[i])) * edge));
    }
    assert.deepEqual(result.adpcm, converted.adpcm); assert.deepEqual(result.metrics, converted.metrics);
  } finally {synth.dispose();}
  const untuned = await renderPs1SamplePreview(audio, {...settings, tuneCents: 0}, coreOptions);
  assert.equal(untuned.pitch, 4096);
  assert.notDeepEqual(untuned.channels, result.channels, 'cents correction follows the actual instrument pitch, not a synthetic oscillator');
});

test('one-shot preview respects sample END and leaves original edits unchanged', async () => {
  const audio = sine(57), original = structuredClone(audio), settings = {gainDb: -3, fadeInSeconds: .0002};
  const result = await renderPs1SamplePreview(audio, settings, coreOptions);
  assert.equal(result.paddingFrames, 27); assert.equal(result.sourceFrames, 57);
  assert.ok(peak(result.channels[0]) > .05);
  assert.equal(peak(result.channels[0].subarray(1024)), 0);
  assert.equal(peak(result.channels[1].subarray(1024)), 0);
  assert.deepEqual(audio, original);
});

test('preview never changes an independently playing SPU or its PCM continuation', async () => {
  const core = await Ps1Spu.create({...coreOptions, moduleOptions: {...moduleOptions}});
  const baseline = await Ps1Spu.create({...coreOptions, moduleOptions: {...moduleOptions}});
  const synth = new Ps1Synth({core}), other = new Ps1Synth({core: baseline});
  try {
    const converted = renderPs1Sample(sine(), {loopEnabled: true});
    for (const instance of [synth, other]) {
      const sample = instance.loadADPCM(converted.adpcm, {baseFrequencyHz: converted.baseFrequencyHz, loopStartSamples: 0});
      instance.setPreset(23, {sample, volumeLeft: .5, volumeRight: -.3}); instance.noteOn(23, 74);
      const left = new Float32Array(1024), right = new Float32Array(1024); instance.renderInto(left, right);
    }
    const before = synth.snapshot();
    const optionKeys = Reflect.ownKeys(moduleOptions);
    await renderPs1SamplePreview(sine(1000), {rootMidi: 81, tuneCents: -72, gainDb: 4}, coreOptions);
    assert.deepEqual(Reflect.ownKeys(moduleOptions), optionKeys, 'Emscripten may not replace the caller configuration with module state');
    assert.deepEqual(synth.snapshot(), before, 'offline rendering never reads or writes live-core state');
    await renderPs1SamplePreview(sine(700), {rootMidi: 48, tuneCents: 34}, {moduleFactory: async () => core.module});
    assert.deepEqual(synth.snapshot(), before, 'even a factory sharing one WASM module allocates a different SPU handle');
    assert.deepEqual(core.generateStereo(4097), baseline.generateStereo(4097));
  } finally {synth.dispose(); other.dispose();}
});

test('invalid edits, empty packet loops and exhausted RAM fail before native allocation', async () => {
  let allocated = false;
  const options = {moduleFactory: async () => {allocated = true; throw Error('unexpected allocation');}};
  for (const [audio, settings, extra, pattern] of [
    [{sampleRate: 8000, channels: [Float32Array.of(NaN)]}, {}, {}, /finite/],
    [sine(), {loopEnabled: true, loopStartFrame: 1, loopEndFrame: 28}, {}, /28-frame/],
    [sine(), {}, {maxBytes: 16}, /Shorten the selection/],
  ]) await assert.rejects(renderPs1SamplePreview(audio, settings, {...options, ...extra}), pattern);
  assert.equal(allocated, false);
});

for (const failure of ['throw', 'nonfinite']) test(`native ${failure} rendering failure still destroys the private instance`, async () => {
  let destroyed = 0;
  const failingFactory = async options => {
    const module = await moduleFactory(options), wrap = module.cwrap;
    module.cwrap = (name, ...args) => {
      const native = wrap(name, ...args);
      if (name === 'ps1_spu_render') return (...values) => {
        if (failure === 'throw') throw Error('rendering failed');
        const ok = native(...values); module.HEAPF32[values[1] / 4] = NaN; return ok;
      };
      return name === 'ps1_spu_destroy' ? (...values) => {destroyed++; return native(...values);} : native;
    };
    return module;
  };
  await assert.rejects(renderPs1SamplePreview(sine(), {}, {...coreOptions, moduleFactory: failingFactory}),
    failure === 'throw' ? /rendering failed/ : /non-finite PCM/);
  assert.equal(destroyed, 1);
});
