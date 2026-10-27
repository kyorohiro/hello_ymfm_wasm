import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createCddaOffline} from './cdda_offline.js';
import {encodeWav} from './wav.js';
import {parseCddaWav} from './cdda_source.js';
import {createCDDAPCM} from './cdda_pcm.js';
import hucFactory from '../docs/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from './huc6280audioengine.js';
import {Huc6280Synth, Huc6280DirectTransport, HUC6280_CLOCK} from './huc6280synth.js';

const wasmBinary = await readFile(new URL('./generated/cdda_wasm.wasm', import.meta.url));
function fixture(frames = 1000) {
  const bytes = new Uint8Array(44 + frames * 4), view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((c, i) => { bytes[offset + i] = c.charCodeAt(0); });
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, 44100, true); view.setUint32(28, 176400, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 4, i % 32 * 101 - 1500, true);
    view.setInt16(46 + i * 4, 2200 - i % 32 * 137, true);
  }
  return bytes;
}

for (const sampleRate of [44100, 48000]) {
  test(`offline lifecycle controls execute on exact output frames @${sampleRate}`, async () => {
    const offline = await createCddaOffline({sampleRate, wasmBinary});
    try {
      const wav = fixture(); const pcm = parseCddaWav(wav).pcm;
      await offline.cdda.load(wav); await offline.cdda.play();
      await offline.cdda.pause({at: 17 / sampleRate});
      await offline.cdda.resume({at: 31 / sampleRate});
      await offline.cdda.seek(100 / 44100, {at: 47 / sampleRate});
      await offline.cdda.stop({at: 61 / sampleRate});
      const output = offline.render(80);
      const reference = await createCDDAPCM({sampleRate, wasmBinary}); reference.prepare(pcm); reference.play();
      const expectedL = [], expectedR = [];
      for (let frame = 0; frame < 80; frame++) {
        if (frame === 17) reference.pause(); if (frame === 31) reference.resume();
        if (frame === 47) reference.seek(100); if (frame === 61) reference.stop();
        const left = new Float32Array(1), right = new Float32Array(1); reference.render(left, right);
        expectedL.push(left[0]); expectedR.push(right[0]);
      }
      assert.deepEqual([...output.left], expectedL); assert.deepEqual([...output.right], expectedR);
      assert(output.left.slice(17, 31).every(v => v === 0)); assert(output.left.slice(61).every(v => v === 0));
      const state = await offline.cdda.getState();
      assert.equal(state.state, 'ready'); assert.equal(state.positionFrames, 0); assert.equal(state.outputFrame, 80);
      assert.equal(offline.currentFrame, 80); assert.equal(offline.currentTime, 80 / sampleRate);
      const bytes = encodeWav(output), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      assert.equal(view.getUint32(24, true), sampleRate); assert.equal(view.getUint32(40, true), 80 * 4);
      await offline.cdda.play(); offline.render(Math.ceil(1000 * sampleRate / 44100) + 1);
      assert.equal((await offline.cdda.getState()).state, 'ended');
      await offline.cdda.play(undefined, {offset: 100 / 44100});
      assert.equal((await offline.cdda.getState()).positionFrames, 100);
      await offline.mix({volume: .5, mute: true, pan: -1});
      assert(offline.render(128).left.every(v => v === 0));
      assert((await offline.cdda.getState()).positionFrames > 100, 'muting preserves timeline progression');
      await offline.mix({mute: false});
      const mono = offline.render(10); assert(mono.left.some(v => v !== 0)); assert(mono.right.every(v => v === 0));
    } finally { offline.dispose(); }
    assert.throws(() => offline.render(1), /disposed/);
    await assert.rejects(offline.cdda.play(), /Abort|cancel|disposed/i);
  });
}

async function huc(sampleRate) {
  const engine = await Huc6280AudioEngine.create({moduleFactory: hucFactory, clock: HUC6280_CLOCK,
    outputSampleRate: sampleRate, masterVolume: 1});
  const synth = new Huc6280Synth({transport: new Huc6280DirectTransport(engine), clock: HUC6280_CLOCK});
  synth.initialize(); synth.setWaveform(0, Array.from({length: 32}, (_, i) => i < 16 ? 31 : 0));
  synth.setVolume(0, 12); synth.noteOn(0, 'C4');
  return {engine, synth, dispose() { synth.dispose(); engine.dispose(); }};
}

test('offline mixes actual HuC6280 WASM and CD-DA on one clock without changing device gains', async () => {
  const sampleRate = 48000, a = await huc(sampleRate), b = await huc(sampleRate);
  const counts = [];
  const source = {sampleRate, mix: {volume: .7, pan: .25, mute: false},
    processFrames(count) { counts.push(count); return a.engine.processFrames(count); }};
  const offline = await createCddaOffline({sampleRate, wasmBinary, sources: [source]});
  try {
    const wav = fixture(); await offline.cdda.load(wav); await offline.cdda.play();
    const commands = [];
    offline.schedule(53, ({frame}) => { commands.push(frame); a.synth.noteOn(0, 'E4'); });
    offline.schedule(177, ({frame}) => { commands.push(frame); source.mix.mute = true; });
    const output = offline.render(256);
    assert.deepEqual(commands, [53, 177]); assert.equal(counts.reduce((a, b) => a + b, 0), 256);
    assert.deepEqual(counts, [53, 124, 79]);
    const cd = await createCDDAPCM({sampleRate, wasmBinary}); cd.prepare(parseCddaWav(wav).pcm); cd.play();
    const cdL = new Float32Array(256), cdR = new Float32Array(256); cd.render(cdL, cdR);
    let offset = 0;
    for (const count of counts) {
      if (offset === 53) b.synth.noteOn(0, 'E4');
      const rendered = b.engine.processFrames(count);
      for (let i = 0; i < count; i++) {
        const volume = offset >= 177 ? 0 : .7;
        assert.equal(output.left[offset + i], Math.fround(cdL[offset + i] + rendered.left[i] * volume * .75));
        assert.equal(output.right[offset + i], Math.fround(cdR[offset + i] + rendered.right[i] * volume));
      }
      offset += count;
    }
    assert.equal(a.engine.getMasterVolume(), 1); assert.equal(b.engine.getMasterVolume(), 1);
  } finally { offline.dispose(); a.dispose(); b.dispose(); }
});

test('bare source engine master gain is retained once, separate descriptors apply only explicit mix', async () => {
  const a = await huc(44100), b = await huc(44100);
  a.engine.setMasterVolume(.5); b.engine.setMasterVolume(.5);
  const offline = await createCddaOffline({wasmBinary, sources: [a.engine]});
  try {
    const mixed = offline.render(64), expected = b.engine.processFrames(64);
    assert.deepEqual(mixed.left, expected.left); assert.deepEqual(mixed.right, expected.right);
  } finally { offline.dispose(); a.dispose(); b.dispose(); }
  // The caller retains source ownership even after renderer disposal.
  const engine = {sampleRate: 44100, volume: .25,
    processFrames(n) { return {left: new Float32Array(n).fill(.25), right: new Float32Array(n).fill(.5)}; }};
  const explicit = await createCddaOffline({wasmBinary, sources: [{engine, volume: .5, pan: -1}]});
  const result = explicit.render(2); assert.deepEqual([...result.left], [.125, .125]); assert.deepEqual([...result.right], [0, 0]);
  explicit.dispose(); assert.equal(engine.processFrames(1).left[0], .25);
});

test('shared CD-DA and actual PSG timeline is invariant under caller block partitioning', async () => {
  const deviceA = await huc(48000), deviceB = await huc(48000);
  const a = await createCddaOffline({sampleRate: 48000, wasmBinary, sources: [deviceA.engine]});
  const b = await createCddaOffline({sampleRate: 48000, wasmBinary, sources: [deviceB.engine]});
  try {
    for (const [offline, device] of [[a, deviceA], [b, deviceB]]) {
      await offline.cdda.load(fixture()); await offline.cdda.play();
      offline.schedule(27, {type: 'pause'}); offline.schedule(39, {type: 'resume'});
      offline.schedule(103, () => device.synth.noteOn(0, 'G4'));
      offline.schedule(209, {type: 'seek', sourceFrame: 150});
      offline.schedule(273, {type: 'mix', volume: .4, pan: .2});
    }
    const whole = a.render(511), left = [], right = [];
    for (const count of [1, 17, 128, 3, 129, 233]) {
      const block = b.render(count); left.push(...block.left); right.push(...block.right);
    }
    assert.deepEqual(left, [...whole.left]); assert.deepEqual(right, [...whole.right]);
    assert.deepEqual(await b.cdda.getState(), await a.cdda.getState());
  } finally { a.dispose(); b.dispose(); deviceA.dispose(); deviceB.dispose(); }
});

test('offline replacement, ordering, Stop cancellation, validation and abort retain bounded ownership', async () => {
  const controller = new AbortController();
  const wav = fixture(1000);
  const offline = await createCddaOffline({wasmBinary, signal: controller.signal,
    readFile: async () => wav});
  await offline.cdda.load({tracks: [{number: 2, file: '/song.wav', startFrame: 0, endFrame: 100},
    {number: 4, file: '/song.wav', startFrame: 100, endFrame: 500}]});
  await offline.cdda.play(2); assert.equal((await offline.cdda.getState()).durationFrames, 100);
  await offline.cdda.play(4); assert.equal((await offline.cdda.getState()).durationFrames, 400);
  const before = await offline.cdda.getState();
  await assert.rejects(offline.adapter.prepare(new Uint8Array(3), 'bad'));
  assert.deepEqual(await offline.cdda.getState(), before);
  const order = []; offline.schedule(5, () => order.push(1)); offline.schedule(5, () => order.push(2));
  offline.render(5); assert.deepEqual(order, [1, 2]);
  offline.schedule(7, () => order.push(3)); await offline.cdda.stop(); offline.render(10);
  assert.deepEqual(order, [1, 2]);
  assert.throws(() => offline.schedule(0, {type: 'play'}), /before currentFrame/);
  assert.throws(() => offline.schedule(100, {type: 'invalid'}));
  assert.throws(() => offline.schedule(100, {type: 'mix', volume: NaN}));
  assert.throws(() => offline.schedule(100, {type: 'mix', pan: 2}));
  for (const value of [-1, .1, Infinity, 10000001]) assert.throws(() => offline.render(value));
  await assert.rejects(offline.adapter.command({type: 'seek', sourceFrame: -1}));
  await assert.rejects(offline.adapter.command({type: 'play'}, {at: -1}));
  controller.abort(); assert.throws(() => offline.render(1), /abort/i);
  offline.dispose(); offline.dispose();
  await assert.rejects(createCddaOffline({sampleRate: 48000, sources: [{sampleRate: 44100, processFrames() {}}]}));
  await assert.rejects(createCddaOffline({sources: [{}]}));
});
