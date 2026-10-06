import test from 'node:test';
import assert from 'node:assert/strict';
import {createMegaSynthSession} from './megasynth_session.js';
import {FM_PRESETS} from './megasynth-fm-presets.js';

test('recording stores frame-clock timestamps and JSON playback restores notes without recording itself', async () => {
  const session = await createMegaSynthSession();
  try {
    session.fm.setPreset(0, FM_PRESETS.sine);
    session.recording.start();
    session.schedule(0, {target: 'fm', method: 'noteOn', args: [0, 4, 553]});
    session.schedule(128, {target: 'fm', method: 'noteOff', args: [0]});
    const expected = await session.render(256);
    const recording = session.recording.stop();
    assert.deepEqual(recording.commands.map(x => [x.type, Math.round(x.time * 48000)]), [['noteOn', 0], ['noteOff', 128]]);
    assert.equal(Math.round(recording.durationSeconds * 48000), 256);
    session.recording.import(JSON.parse(JSON.stringify(recording)));
    session.recording.play();
    const actual = await session.render(256);
    assert.deepEqual(actual.left.slice(0, 128), expected.left.slice(0, 128));
    assert.deepEqual(actual.right.slice(0, 128), expected.right.slice(0, 128));
    // JSON restores musical state, not the chip's internal envelope clock.
    assert.ok(Math.max(...actual.left.map((value, i) => Math.abs(value - expected.left[i]))) < .008);
    assert.equal(session.recording.getState().playing, false);
    assert.equal(session.recording.export().commands.length, 2);
    assert.equal(session.pendingTimers, 0);
  } finally {await session.close();}
});

test('recording loops have no wall-clock padding or accumulated drift and stop cancels callbacks', async () => {
  const session = await createMegaSynthSession();
  try {
    session.fm.setPreset(0, FM_PRESETS.sine); session.recording.start();
    session.fm.noteOn(0, 4, 553); await session.render(93); session.fm.noteOff(0); await session.render(35);
    const recording = session.recording.stop();
    session.recording.play(recording, {loop: true});
    const starts = [];
    const original = session.fm.transport.write.bind(session.fm.transport);
    session.fm.transport.write = (port, register, value) => {
      if (register === 0x28 && value === 0xf0) starts.push(session.currentFrame);
      original(port, register, value);
    };
    await session.render(128 * 20);
    assert.equal(starts.length, 21); // Includes the next cycle's frame-zero event at the endpoint.
    assert.ok(starts.every((frame, index) => frame === 128 + index * 128));
    assert.ok(session.pendingTimers <= 3);
    session.recording.stopPlayback();
    await session.render(256); assert.equal(starts.length, 21); assert.equal(session.pendingTimers, 0);
  } finally {await session.close();}
});

test('looper records notes, repeats on exact sample boundaries, auto-finishes overdubs and undo clears timers', async () => {
  const session = await createMegaSynthSession();
  try {
    session.fm.setPreset(0, FM_PRESETS.sine);
    await session.looper.start(); await session.looper.startRecording();
    session.schedule(0, {target: 'looper', method: 'noteOn', args: [0, 4, 553]});
    session.schedule(128, {target: 'looper', method: 'noteOff', args: [0]});
    const original = await session.render(256);
    assert.ok(Math.max(...original.left) > .05);
    const starts = [];
    const write = session.fm.transport.write.bind(session.fm.transport);
    session.fm.transport.write = (port, register, value) => {
      if (register === 0x28 && value === 0xf0) starts.push(session.currentFrame);
      write(port, register, value);
    };
    const unit = await session.looper.finishRecording();
    assert.equal(unit.events.length, 2);
    assert.equal(Math.round(session.looper.getState().loopLength * 48000), 256);
    const repeated = await session.render(256 * 4);
    for (let cycle = 0; cycle < 4; cycle++) {
      const pcm = repeated.left.slice(cycle * 256, (cycle + 1) * 256);
      assert.ok(pcm.every(Number.isFinite)); assert.ok(Math.max(...pcm) > .05);
    }
    assert.deepEqual(starts, [256, 512, 768, 1024, 1280]);
    assert.ok(session.pendingTimers <= 3);
    await session.looper.startRecording();
    session.looper.noteOn(1, 4, 696); await session.render(128); session.looper.noteOff(1);
    await session.render(128);
    assert.equal(session.looper.getState().recording, false);
    assert.equal(session.looper.getState().unitCount, 2);
    await session.looper.undo(); await session.looper.undo(); await session.looper.stop();
    assert.equal(session.looper.getState().unitCount, 0);
    assert.equal(session.pendingTimers, 0);
  } finally {await session.close();}
});

test('malformed recordings fail before changing the chip; close cancels loops and is idempotent', async () => {
  const session = await createMegaSynthSession();
  session.fm.setPreset(0, FM_PRESETS.sine);
  const before = session.fm.getState();
  const recording = {format: 'megasynth-recording-v1', durationSeconds: .1, commands: [{time: 0, type: 'noteOn', channel: 8, block: 4, fnum: 553}]};
  assert.throws(() => session.recording.import(recording), /channel/);
  assert.deepEqual(session.fm.getState(), before);
  assert.throws(() => session.recording.play({format: 'megasynth-recording-v1', durationSeconds: 0, commands: []}, {loop: true}), /one frame/);
  session.recording.start(); session.fm.noteOn(0, 4, 553); await session.render(256);
  session.recording.play(session.recording.stop(), {loop: true});
  assert.equal(session.close(), session.close()); await session.close();
  assert.equal(session.pendingTimers, 0);
  await assert.rejects(session.render(128), /closed/);
});
