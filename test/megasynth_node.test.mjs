import test from 'node:test';
import assert from 'node:assert/strict';
import {MegaSynthNode} from '../node/megasynth.mjs';
import {FM_PRESETS} from '../web/megasynth-fm-presets.js';
const outputModule = new URL('./fixtures/megasynth_output.mjs', import.meta.url).href;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const create = options => new MegaSynthNode({outputModule, ...options});

test('PCM looper stays in Worker and only exports PCM on explicit request', async () => {
  const synth = create({engineOptions: {looperMode: 'pcm'}});
  try {
    await synth.start(); await synth.fm.setPreset(0, FM_PRESETS.sine);
    await synth.looper.start(); await synth.looper.startRecording();
    await synth.looper.noteOn(0, 4, 553); await wait(35); await synth.looper.noteOff(0); await wait(15);
    const unit = await synth.looper.finishRecording();
    assert.ok(unit.audio.frames > 0); assert.equal(unit.audio.channels, undefined);
    const units = await synth.looper.getUnits(); assert.equal(units[0].audio.channels, undefined);
    const pcm = await synth.looper.exportAudio(unit.id);
    assert.equal(pcm.channels[0].length, unit.audio.frames);
    assert.ok(pcm.channels[0].some(value => Math.abs(value) > .01));
    await synth.fm.reset(); await wait(80);
    assert.ok((await synth.getState()).peak > .001);
    await synth.stop(); assert.equal((await synth.getState()).pendingTimers, 0);
    await synth.looper.clear();
    await assert.rejects(synth.looper.exportAudio(unit.id), /No PCM/);
  } finally {await synth.close();}
});

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

test('recording and looper RPCs run inside the Worker and Stop cancels their sample timers', async () => {
  const synth = create();
  try {
    await synth.start(); await synth.fm.setPreset(0, FM_PRESETS.sine);
    await synth.recording.start();
    await synth.fm.noteOn(0, 4, 553); await wait(60); await synth.fm.noteOff(0);
    const recording = await synth.recording.stop();
    assert.equal(recording.format, 'megasynth-recording-v1');
    assert.equal(recording.commands.filter(command => command.type === 'noteOn').length, 1);
    assert.ok(recording.durationSeconds >= .03);
    assert.ok(recording.commands.every(command => Math.abs(command.time * 48000 - Math.round(command.time * 48000)) < 1e-6));
    await synth.recording.import(JSON.parse(JSON.stringify(recording)));
    await synth.recording.play(null, {loop: true}); await wait(80);
    assert.equal((await synth.recording.getState()).playing, true);
    assert.ok((await synth.getState()).pendingTimers > 0);
    await synth.recording.stopPlayback();
    assert.equal((await synth.getState()).pendingTimers, 0);
    await synth.looper.start(); await synth.looper.startRecording();
    await synth.looper.noteOn(0, 4, 696); await wait(50); await synth.looper.noteOff(0);
    const unit = await synth.looper.finishRecording();
    assert.equal(unit.events.length, 2); await wait(50);
    const loopState = await synth.looper.getState();
    assert.equal(loopState.unitCount, 1); assert.equal(loopState.running, true);
    assert.equal((await synth.looper.getUnits()).length, 1);
    await synth.stop();
    const stopped = await synth.getState();
    assert.equal(stopped.pendingTimers, 0); assert.equal(stopped.looper.running, false);
    assert.equal(stopped.recording.playing, false);
    await synth.resume();
    const resumed = await synth.getState();
    assert.equal(resumed.pendingTimers, 0); assert.equal(resumed.looper.unitCount, 1);
    await synth.looper.undo(); assert.equal((await synth.looper.getState()).unitCount, 0);
  } finally {await synth.close();}
});

test('invalid imported recording rejects through RPC and leaves the Worker usable', async () => {
  const synth = create();
  try {
    await synth.start();
    await assert.rejects(synth.recording.import({format: 'wrong'}), /Invalid recording/);
    await assert.rejects(synth.flush(), /Invalid recording/);
    await synth.fm.setPreset(0, FM_PRESETS.sine); await synth.fm.noteOn(0, 4, 553);
    await synth.flush(); await synth.stop();
  } finally {await synth.close();}
});
