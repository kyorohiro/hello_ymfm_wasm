import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/spc_wasm.js';
import {parseSpcFile} from '../../web/spc_file.js';
import {extractBrrSamples, readSnesVoices} from '../../web/snes_brr.js';
import {createSyntheticSpc} from '../../web/spc_test_fixture.mjs';
import {renderSpcBrrVoicePreview} from './spc_brr_preview.js';

const wasmBinary = await readFile(new URL('../generated/spc_wasm.wasm', import.meta.url));
const module = await factory({wasmBinary});
const moduleFactory = async () => module;
function fixture() {
  const snapshot = parseSpcFile(createSyntheticSpc());
  const entry = extractBrrSamples(snapshot, {sourceNumbers: [0]}).samples[0];
  return {snapshot, entry, voice: readSnesVoices(snapshot)[0]};
}
const render = (f, patch = {}, options = {}) => renderSpcBrrVoicePreview(f.entry,
  {...f.voice, ...patch}, {snapshot: f.snapshot, moduleFactory, ...options});
function rms(data, start, end) {
  let sum = 0;
  for (let i = start; i < end; i++) sum += data[i] ** 2;
  return Math.sqrt(sum / (end - start));
}
function crossings(data, start = 1000, end = 10000) {
  let count = 0;
  for (let i = start + 1; i < end; i++) if (data[i - 1] <= 0 && data[i] > 0) count++;
  return count;
}
function instrumentModule({onRender} = {}) {
  const calls = {created: 0, destroyed: 0, rendered: 0};
  const instrumented = Object.create(module);
  instrumented._spc_create = mode => {calls.created++; return module._spc_create(mode);};
  instrumented._spc_destroy = handle => {calls.destroyed++; return module._spc_destroy(handle);};
  instrumented._spc_render = (handle, frames) => {
    calls.rendered++;
    const result = module._spc_render(handle, frames);
    onRender?.();
    return result;
  };
  return {calls, instrumented};
}

test('voice preview renders native stereo through DSP and releases after the one-second hold', async () => {
  const f = fixture(), before = f.snapshot.ram.slice();
  const preview = await render(f);
  assert.equal(preview.sampleRate, 32000);
  assert.equal(preview.holdSeconds, 1);
  assert.equal(preview.durationSeconds, 2);
  assert.equal(preview.channels.length, 2);
  const [left, right] = preview.channels;
  for (const channel of preview.channels) {
    assert.equal(channel.length, 64000);
    assert.ok(channel.every(value => Number.isFinite(value) && value >= -1 && value <= 1));
    assert.ok(rms(channel, 1000, 10000) > 0.01);
    assert.ok(channel.subarray(40000).every(value => value === 0), 'key-off finishes the hardware release');
  }
  assert.ok(Math.abs(rms(left, 1000, 10000) / rms(right, 1000, 10000) - 4 / 3) < 0.01);
  const rawRepeated = Float32Array.from({length: 128}, (_, i) => f.entry.pcm[i % f.entry.pcm.length]);
  assert.notDeepEqual(left.slice(0, 128), rawRepeated, 'voice preview includes Gaussian interpolation, gain and the key-on pipeline');
  assert.deepEqual(f.snapshot.ram, before, 'audition never changes captured sample RAM');
});

test('raw PITCH changes playback frequency without inventing a musical root note', async () => {
  const f = fixture();
  const normal = await render(f), half = await render(f, {pitch: 0x0800});
  const normalCrossings = crossings(normal.channels[0]), halfCrossings = crossings(half.channels[0]);
  assert.ok(Math.abs(normalCrossings / halfCrossings - 2) < 0.03);
  const frequencyHz = normalCrossings * 32000 / 9000;
  assert.ok(Math.abs(frequencyHz - 2000) < 10, 'the authored 16-sample loop plays at its native 2000 Hz');
});

test('captured ADSR and direct GAIN affect amplitude while stereo signed volumes are preserved', async () => {
  const f = fixture();
  const attack = await render(f, {adsr1: 0x84, adsr2: 0xe0});
  assert.ok(rms(attack.channels[0], 20000, 25000) > rms(attack.channels[0], 500, 2500) * 3);
  const silent = await render(f, {adsr1: 0, gain: 0});
  assert.ok(silent.channels.every(channel => channel.every(value => value === 0)));
  const pan = await render(f, {volumeLeft: 64, volumeRight: -32});
  assert.ok(Math.abs(rms(pan.channels[0], 1000, 10000) / rms(pan.channels[1], 1000, 10000) - 2) < 0.02);
  let correlation = 0;
  for (let i = 1000; i < 10000; i++) correlation += pan.channels[0][i] * pan.channels[1][i];
  assert.ok(correlation < 0, 'negative hardware volume keeps its inverted phase');
  const leftOnly = await render(f, {volumeRight: 0});
  assert.ok(leftOnly.channels[1].every(value => value === 0));
});

test('directory aliases use the selected voice SRCN and original wrapped BRR memory', async () => {
  const original = fixture(), reference = await render(original);
  const f = fixture(), {ram, dsp} = f.snapshot;
  dsp[4] = 7;
  const start = 0xfffc, address = 0x1000 + 7 * 4;
  ram.set([start & 255, start >> 8, start & 255, start >> 8], address);
  for (let i = 0; i < f.entry.brr.length; i++) ram[(start + i) & 65535] = f.entry.brr[i];
  f.entry = {...f.entry, sourceNumbers: [0, 7], startAddress: start, loopAddress: start};
  f.voice = {...f.voice, sourceNumber: 7};
  const wrapped = await render(f);
  assert.equal(wrapped.sourceNumber, 7);
  assert.deepEqual(wrapped.channels, reference.channels);
  assert.equal(f.entry.brr.length, 9, 'no repacked RAM or fabricated tuning is needed');
});

test('voice preview rejects mismatched sample directory mappings and unrelated SRCNs', async () => {
  const f = fixture();
  await assert.rejects(render(f, {sourceNumber: 1}), /does not reference/);
  f.snapshot.ram[0x1000]++;
  await assert.rejects(render(f), /differs from the captured RAM/);
  const other = fixture(); other.snapshot.dsp[0x5d]++;
  await assert.rejects(render(other), /differs from the captured DSP/);
  await assert.rejects(render(fixture(), {pitch: NaN}), /PITCH/);
});

test('aborting before initialization performs no native allocation', async () => {
  const f = fixture(), controller = new AbortController(), {calls, instrumented} = instrumentModule();
  const pending = render(f, {}, {signal: controller.signal, moduleFactory: async () => instrumented});
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(calls.created, 0); assert.equal(calls.destroyed, 0);
});

test('aborting during rendering disposes the DSP handle instead of returning partial PCM', async () => {
  const f = fixture(), controller = new AbortController();
  const {calls, instrumented} = instrumentModule({onRender: () => controller.abort()});
  await assert.rejects(render(f, {}, {signal: controller.signal, moduleFactory: async () => instrumented}), {name: 'AbortError'});
  assert.equal(calls.created, 1); assert.equal(calls.rendered, 1); assert.equal(calls.destroyed, 1);
});

test('an initialization completed after cancellation still disposes its allocated DSP handle', async () => {
  const f = fixture(), controller = new AbortController(), {calls, instrumented} = instrumentModule();
  let started, finish;
  const startedPromise = new Promise(resolve => {started = resolve;});
  const factoryResult = new Promise(resolve => {finish = resolve;});
  const pending = render(f, {}, {signal: controller.signal, moduleFactory: () => {started(); return factoryResult;}});
  await startedPromise;
  controller.abort(); finish(instrumented);
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(calls.created, 1); assert.equal(calls.destroyed, 1); assert.equal(calls.rendered, 0);
});
