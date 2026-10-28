import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderGameboySampleComparison, renderGameboySamplePreview} from './playground_sample_gameboy_preview.js';
import {renderGameboyWave, renderSampleEdit} from './playground_sample_edit.js';
import {createSampleInstrument} from './playground_sample_instrument.js';
import {GameboyApu} from './gameboyapu.js';
import {GameboyDirectTransport, GameboySynth} from './gameboysynth.js';
import {SOUNDCHIP_MIXER_LISTENING_LEVELS} from './soundchip_mixer_presets.js';
import moduleFactory from '../docs/generated/gameboy_apu_wasm.js';

const moduleOptions = {wasmBinary: readFileSync(new URL('../docs/generated/gameboy_apu_wasm.wasm', import.meta.url))};
const coreOptions = {moduleFactory, moduleOptions};
const cycle = (frames = 128) => ({channels: [Float32Array.from({length: frames}, (_, i) => .8 * Math.sin(2 * Math.PI * i / frames))], sampleRate: 32000});
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

test('comparison uses the existing converter and a bounded copy of the exact edited mono selection', () => {
  const audio = cycle(5000);
  audio.channels.push(Float32Array.from(audio.channels[0], value => value * .5));
  const original = structuredClone(audio);
  const settings = {startFrame: 105, endFrame: 4800, gainDb: 6, fadeInSeconds: .005,
    fadeOutSeconds: .01, rootMidi: 69, tuneCents: 35,
    drawStrokes: [[[500, -.8], [1000, .7]], [[2200, .25], [2400, -.5]]]};
  const edited = renderSampleEdit(audio, settings);
  const result = renderGameboySampleComparison(audio, settings);
  assert.deepEqual(result.waveform, renderGameboyWave(audio, settings));
  assert.equal(result.waveform.length, 32);
  assert.ok(result.waveform.every(value => Number.isInteger(value) && value >= 0 && value <= 15));
  assert.equal(result.source.length, 256);
  result.source.forEach((value, i) => assert.equal(value,
    edited.channels[0][Math.round(i * (edited.channels[0].length - 1) / 255)]));
  assert.deepEqual([result.rootMidi, result.tuneCents, result.sourceStartFrame, result.sourceEndFrame], [69, 35, 105, 4800]);
  assert.equal(result.peakBeforeClip, edited.peakBeforeClip);
  assert.equal(result.clippedSamples, edited.clippedSamples);
  assert.ok(result.clippedSamples > 0, 'conversion status retains real source clipping');
  result.source[0] = .9;
  result.waveform[0] = 0;
  assert.deepEqual(audio, original);
  for (const frames of [1, 2, 32, 256]) {
    const short = cycle(frames), result = renderGameboySampleComparison(short, {});
    assert.deepEqual(result.source, short.channels[0]);
    assert.notEqual(result.source, short.channels[0]);
  }
});

test('converted preview matches the real wave RAM instrument core at the root MIDI note, including tune metadata semantics', async () => {
  const audio = cycle(), settings = {rootMidi: 69, tuneCents: 53, gainDb: -2,
    drawPoints: [[10, .2], [15, -.4]]};
  let destroyed = 0;
  const trackedFactory = async options => {
    const module = await moduleFactory(options), cwrap = module.cwrap;
    module.cwrap = (name, ...args) => {
      const native = cwrap(name, ...args);
      return name === 'gameboy_apu_destroy' ? (...values) => {destroyed++; return native(...values);} : native;
    };
    return module;
  };
  const result = await renderGameboySamplePreview(audio, settings, {...coreOptions, moduleFactory: trackedFactory});
  assert.equal(destroyed, 1, 'successful rendering releases its native handle');
  assert.equal(result.channels.length, 2);
  assert.equal(result.sampleRate, 44100);
  assert.equal(result.channels[0].length, Math.round(.85 * result.sampleRate));
  assert.equal(result.loopEnabled, false);
  assert.deepEqual([result.rootMidi, result.tuneCents], [69, 53]);
  assert.deepEqual(result.waveform, renderGameboyWave(audio, settings));
  assert.equal(result.outputGain, SOUNDCHIP_MIXER_LISTENING_LEVELS.gameboy);
  assert.ok(rms(result.channels[0]) > .01);
  assert.ok(Math.abs(result.frequencyHz - 440) < 2);
  for (const channel of result.channels) {
    assert.ok(channel.every(value => Number.isFinite(value) && Math.abs(value) <= 1));
    assert.equal(channel[0], 0); assert.equal(channel.at(-1), 0);
  }
  const chip = await GameboyApu.create({...coreOptions, sampleRate: result.sampleRate});
  const gameboy = new GameboySynth({transport: new GameboyDirectTransport(chip)});
  try {
    gameboy.initialize();
    const instrument = await createSampleInstrument({pg: {gameboy}, chip: 'gameboy',
      audio: {...renderSampleEdit(audio, settings), waveform: result.waveform, target: 'gameboy-wave'}});
    await instrument.noteOn({id: 'preview', midi: settings.rootMidi, velocity: 100});
    const expected = chip.generateStereo(result.channels[0].length);
    // Compare the un-faded interior against the actual existing instrument, not a synthetic oscillator.
    for (const [index, native] of [expected.left, expected.right].entries()) {
      for (let i = 256; i < native.length - 256; i++) {
        assert.equal(result.channels[index][i], Math.fround(native[i] * result.outputGain));
      }
    }
    await instrument.allNotesOff();
  } finally {gameboy.dispose(); chip.dispose();}
  const untuned = await renderGameboySamplePreview(audio, {...settings, tuneCents: 0}, coreOptions);
  assert.deepEqual(result.channels, untuned.channels, 'wave RAM pitch follows MIDI, matching the current instrument');
});

test('private preview generation leaves an independently playing native chip unchanged', async () => {
  const chip = await GameboyApu.create({...coreOptions, sampleRate: 44100});
  const synth = new GameboySynth({transport: new GameboyDirectTransport(chip)});
  try {
    synth.initialize(); synth.wave.setNote(72); synth.wave.keyOn();
    chip.generateStereo(1024);
    const state = chip.saveState();
    const expected = chip.generateStereo(4096);
    chip.loadState(state);
    await renderGameboySamplePreview(cycle(), {rootMidi: 81}, coreOptions);
    assert.deepEqual(chip.generateStereo(4096), expected);
  } finally {synth.dispose(); chip.dispose();}
});

test('preview rejects non-finite source and unrepresentable notes before allocating native state', async () => {
  let created = false;
  const options = {moduleFactory: async () => {created = true; throw Error('must not allocate');}};
  await assert.rejects(renderGameboySamplePreview({channels: [new Float32Array([NaN])], sampleRate: 8000}, {}, options), /finite/);
  await assert.rejects(renderGameboySamplePreview(cycle(), {rootMidi: 23}, options), /MIDI 24/);
  assert.equal(created, false);
});

for (const mode of ['throw', 'nonfinite']) test(`a native ${mode} generation failure still releases private state`, async () => {
  let destroyed = 0;
  const failingFactory = async options => {
    const module = await moduleFactory(options), cwrap = module.cwrap;
    module.cwrap = (name, ...args) => {
      const native = cwrap(name, ...args);
      if (name === 'gameboy_apu_generate') return (...values) => {
        if (mode === 'throw') throw Error('generation failed');
        native(...values);
        module.HEAPF32[values[1] / 4] = NaN;
      };
      return name === 'gameboy_apu_destroy' ? (...values) => {destroyed++; return native(...values);} : native;
    };
    return module;
  };
  await assert.rejects(renderGameboySamplePreview(cycle(), {}, {...coreOptions, moduleFactory: failingFactory}),
    mode === 'throw' ? /generation failed/ : /non-finite PCM/);
  assert.equal(destroyed, 1);
});

test('deployed Worker transfers comparison and native preview buffers and preserves the final conversion', async () => {
  const previousSelf = globalThis.self, messages = [];
  const worker = {postMessage(message, transfers) {messages.push({message, transfers});}};
  globalThis.self = worker;
  try {
    await import('../docs/playground/playground_sample_editor_worker.js');
    let id = 0;
    const job = async (command, data = {}) => {
      await worker.onmessage({data: {id: ++id, command, ...data}});
      const result = messages.at(-1);
      assert.equal(result.message.id, id);
      assert.equal(result.message.error, undefined, result.message.error);
      return result;
    };
    const audio = cycle(1000), settings = {startFrame: 100, endFrame: 900, rootMidi: 72, gainDb: -4,
      drawStrokes: [[[300, -.6], [400, .8]]]};
    await job('source', {audio});
    const comparison = await job('gameboy-wave', {settings});
    assert.equal(comparison.message.value.source.length, 256);
    assert.ok(comparison.transfers.includes(comparison.message.value.source.buffer));
    const preview = await job('gameboy-preview', {settings});
    const final = await job('render', {settings, options: {target: 'gameboy-wave', sampleRate: 16000}});
    assert.deepEqual(preview.message.value.waveform, comparison.message.value.waveform);
    assert.deepEqual(final.message.value.waveform, comparison.message.value.waveform);
    assert.ok(preview.message.value.channels.every(channel => preview.transfers.includes(channel.buffer)));
    assert.ok(preview.transfers.includes(preview.message.value.waveform.buffer));
    assert.ok(rms(preview.message.value.channels[0]) > .01);
    const snapshotId = ++id;
    const inFlight = worker.onmessage({data: {id: snapshotId, command: 'gameboy-preview', settings}});
    const replacement = cycle(2000);
    replacement.channels[0].fill(-.2);
    await worker.onmessage({data: {id: ++id, command: 'source', audio: replacement}});
    await inFlight;
    const snapshotted = messages.find(result => result.message.id === snapshotId).message;
    assert.equal(snapshotted.error, undefined);
    assert.deepEqual(snapshotted.value.waveform, comparison.message.value.waveform,
      'a source replacement during the async module import cannot change an in-flight conversion');
  } finally {
    if (previousSelf === undefined) delete globalThis.self;
    else globalThis.self = previousSelf;
  }
});
