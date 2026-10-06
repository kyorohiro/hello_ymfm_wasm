import test from 'node:test';
import assert from 'node:assert/strict';
import {MegaSynthNode} from '../node/megasynth.mjs';
import {FM_PRESETS} from '../web/megasynth-fm-presets.js';
const outputModule = new URL('./fixtures/megasynth_output.mjs', import.meta.url).href;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const create = options => new MegaSynthNode({outputModule, ...options});

test('Worker owns continuous PCM/FX/output even when Main is busy; stop/resume/close drain and restart', async () => {
  const synth = create();
  try {
    assert.equal(synth.start(), synth.start()); await synth.start();
    const oldFX = synth.fx;
    synth.fx.setChain([synth.fx.delay({time: .01, mix: .25}), synth.fx.reverb({mix: .15})]);
    await synth.fm.setPreset(0, FM_PRESETS.sine); await synth.fm.noteOn(0, 4, 553); await synth.flush();
    const before = await synth.getState();
    const until = performance.now() + 100;
    while (performance.now() < until) {} // The Worker must keep feeding output.
    const after = await synth.getState();
    assert.ok(after.output.consumedFrames > before.output.consumedFrames);
    assert.ok(after.peak > .01); assert.ok(after.output.peak > .01);
    assert.ok(after.output.queuedFrames <= 512 * 4);
    await synth.stop();
    const stopped = await synth.getState();
    assert.equal(stopped.state, 'stopped'); assert.equal(stopped.output.queuedFrames, 0);
    assert.ok(stopped.maxQueuedFrames <= 512 * 6); // Queue + 20 ms fade.
    await wait(30); assert.equal((await synth.getState()).currentFrame, stopped.currentFrame);
    await synth.resume(); await synth.fm.noteOn(0, 4, 553); await wait(40);
    assert.ok((await synth.getState()).currentFrame > stopped.currentFrame);
    assert.equal(synth.close(), synth.close()); await synth.close();
    await assert.rejects(synth.fm.noteOn(0, 4, 553), /not ready/);
    await synth.start();
    assert.throws(() => oldFX.gain(), /earlier Worker/);
    await synth.stop();
  } finally {await synth.close();}
  assert.equal(synth.state, 'closed');
});

test('invalid commands reject without killing the Worker; FX flush reports async errors', async () => {
  const synth = create();
  try {
    await synth.start();
    await assert.rejects(synth.fm.noteOn(8, 4, 553), /channel/);
    await assert.rejects(synth.flush(), /channel/);
    await synth.fm.setPreset(0, FM_PRESETS.sine);
    await synth.fm.noteOn(0, 4, 553); await synth.flush();
    const state = await synth.getState();
    await synth.schedule(state.currentFrame + 48000, {target: 'fm', method: 'noteOff', args: [0]});
    await assert.rejects(synth.schedule(0, {target: 'fm', method: 'reset', args: []}), /before/);
    await synth.stop();
  } finally {await synth.close();}
});

test('closing during startup cancels readiness and permits a fresh Worker', async () => {
  const synth = create({outputOptions: {initDelay: 80}});
  const starting = synth.start();
  const rejected = assert.rejects(starting, {name: 'AbortError'});
  await synth.close(); await rejected;
  await synth.start(); await synth.close();
});

test('missing output and failed writes reject startup and close native resources', async () => {
  for (const outputOptions of [{failOpen: true}, {failWrite: true}]) {
    const synth = create({outputOptions});
    await assert.rejects(synth.start(), /Test/); await synth.close();
    assert.equal(synth.state, 'closed');
  }
});

test('an output failure during playback is reported and shuts down the owned Worker', async () => {
  const synth = create({outputOptions: {failWrite: 12}});
  const errors = []; synth.on('error', error => errors.push(error.message));
  try {
    await synth.start();
    const deadline = performance.now() + 3000;
    while (synth.state !== 'closed' && performance.now() < deadline) await wait(10);
    assert.equal(synth.state, 'closed');
    assert.ok(errors.some(message => message.includes('Test write failed')));
    assert.match(synth.lastError.message, /Test write failed/);
  } finally {await synth.close();}
});
