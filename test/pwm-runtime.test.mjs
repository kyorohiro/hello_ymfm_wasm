import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PWM32XPlayback, PWM_METHODS} from '../web/pwm32x_playback.js';
import {createMegaSynthOffline} from '../web/megasynth_offline.js';
import {MegaSynthNode} from '../node/megasynth.mjs';
import {createSoundChip} from '../web/soundchip.js';
import {PWM32XDirectTransport} from '../web/pwm32x_transport.js';

// Stereo impulse changes at exact output frames. Pulse widths straddle neutral.
const entries = [{frame: 0, register: 0, value: 5}, {frame: 0, register: 1, value: 1047}];
for (let frame = 32; frame < 1024; frame += 4) {
  entries.push({frame, register: 2, value: frame < 512 ? 700 : 350},
    {frame, register: 3, value: frame < 512 ? 350 : 700});
}

test('PWM scheduling preserves FIFO timing across arbitrary render partitions and rejects a batch atomically', () => {
  const a = new PWM32XPlayback(), b = new PWM32XPlayback();
  try {
    a.scheduleWrites(entries); b.scheduleWrites(entries);
    const before = b.getState().queuedWrites;
    assert.throws(() => b.scheduleWrites([{frame: 0, register: 2, value: 500}, {frame: -1, register: 2, value: 500}]), /Invalid/);
    assert.equal(b.getState().queuedWrites, before);
    const expected = a.generateStereo(1024), left = new Float32Array(1024), right = new Float32Array(1024);
    let offset = 0;
    for (const count of [1, 31, 97, 383, 512]) {
      const pcm = b.generateStereo(count); left.set(pcm.left, offset); right.set(pcm.right, offset); offset += count;
    }
    assert.deepEqual(left, expected.left); assert.deepEqual(right, expected.right);
    assert.ok(left.slice(0, 32).every(x => x === 0));
    assert.ok(left[100] > 0 && right[100] < 0 && left[700] < 0 && right[700] > 0);
    b.reset(); assert.equal(b.getState().queuedWrites, 0); assert.ok(b.generateStereo(128).left.every(x => x === 0));
  } finally {a.dispose(); b.dispose();}
});

test('Node Worker, offline MegaSynth and browser PWM processor render identical stereo PCM', async () => {
  const reference = new PWM32XPlayback(); reference.scheduleWrites(entries);
  const expected = reference.generateStereo(1024); reference.dispose();
  const offline = await createMegaSynthOffline({mega32X: true, masterVolume: 1});
  const node = new MegaSynthNode({mega32X: true, outputModule: null, masterVolume: 1});
  try {
    offline.pwm.scheduleWrites(entries);
    assert.deepEqual(offline.render(1024).left, expected.left);
    await node.start(); await node.pwm.scheduleWrites(entries);
    const pcm = await node.render(1024);
    assert.deepEqual(pcm.left, expected.left); assert.deepEqual(pcm.right, expected.right);
    assert.equal((await node.pwm.getState()).model, 'mame');
    await node.stop(); assert.ok((await node.render(128)).left.every(x => x === 0));
    let Processor;
    const scope = {PWM32XPlayback, PWM_METHODS, sampleRate: 48000,
      AudioWorkletProcessor: class {constructor() {this.port = {postMessage() {}};}},
      registerProcessor(_name, Type) {Processor = Type;}};
    vm.runInNewContext(fs.readFileSync(new URL('../web/playground_pwm_worklet.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), scope);
    const processor = new Processor({processorOptions: {}});
    processor.receive({method: 'scheduleWrites', args: [entries]}, {postMessage() {}});
    const left = new Float32Array(1024), right = new Float32Array(1024);
    for (let offset = 0; offset < 1024; offset += 128) processor.process([], [[left.subarray(offset, offset + 128), right.subarray(offset, offset + 128)]]);
    assert.deepEqual(left, expected.left); assert.deepEqual(right, expected.right);
    processor.receive({method: 'dispose'}, {postMessage() {}});
    assert.equal(processor.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
  } finally {offline.close(); await node.close();}
});

test('direct transport wraps the factory chip; a disconnected Node output can reconnect with MAME PWM', async () => {
  const chip = await createSoundChip('pwm', {outputMode: 'duty', gain: 1});
  try {
    const transport = new PWM32XDirectTransport(chip); transport.scheduleWrites(entries);
    assert.ok(transport.generateStereo(128).left.some(x => x > .1));
  } finally {chip.dispose();}
  const node = new MegaSynthNode({mega32X: true, outputModule: null});
  try {
    await node.start(); await node.pwm.scheduleWrites(entries);
    const state = await node.connectOutput({outputModule: new URL('./fixtures/megasynth_output.mjs', import.meta.url).href});
    assert.ok(state.peak > .01);
    await node.disconnectOutput(); await node.stop();
    assert.ok((await node.render(128)).left.every(x => x === 0));
  } finally {await node.close();}
});
