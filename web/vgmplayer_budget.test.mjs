import test from 'node:test';
import assert from 'node:assert/strict';
import {VgmPlayer} from './vgmplayer.js';
import {VgmPlayer as DocsPlayer} from '../docs/js/vgmplayer.js';
import {vgmBytes} from './test-support/vgm-mock.js';
import {MockSoundEngine} from './test-support/vgm-engine-mock.js';

function drain(player, options) {
  const output = [];
  for (let calls = 0; player.isPlaying() || player.queuedFrames; calls++) {
    assert(calls < 10000);
    const left = new Float32Array(2048), right = new Float32Array(2048);
    const copied = player.process(left, right, 2048, options);
    output.push(...left.subarray(0, copied));
  }
  return output;
}

for (const Player of [VgmPlayer, DocsPlayer]) {
  test(`${Player === VgmPlayer ? 'web' : 'docs'}: budgeted waits preserve PCM, DAC stream timing and fractional output`, t => {
    let clock = 0;
    t.mock.method(performance, 'now', () => clock);
    class Engine extends MockSoundEngine {
      sizes = [];
      processFrames(n) {
        this.sizes.push(n);
        const left = Float32Array.from({length: n}, (_, i) => ((this.frames + i) % 127) / 128);
        const right = left.slice();
        this.frames += n; clock += n / 32;
        return {left, right};
      }
    }
    // DAC stream events must retain their positions within a split wait.
    const commands = [0x67,0x66,0,4,0,0,0, 1,2,3,4,
      0x90,0,2,0,0x2a, 0x91,0,0,1,0, 0x92,0,0x44,0xac,0,0,
      0x93,0,0,0,0,0,1,4,0,0,0,
      0x61,0xff,0xff, 0x52,0x2a,99, 0x70,0x66];
    for (const rate of [44100,48000]) {
      const referenceEngine = new Engine(rate), reference = new Player(referenceEngine);
      reference.load(vgmBytes(commands)); reference.play();
      const expected = drain(reference);
      const engine = new Engine(rate), player = new Player(engine);
      player.load(vgmBytes(commands)); player.play();
      const left = new Float32Array(2048), right = left.slice();
      const before = clock;
      const copied = player.process(left, right, 2048, {budgetMs: 8});
      assert(clock - before <= 9);
      assert(copied > 0 && copied < 2048);
      assert(player.pendingWaitSamples > 0);
      player.pause();
      assert.equal(player.process(left.slice(), right.slice(), 2048, {budgetMs: 8}), 0);
      player.resume();
      const actual = [...left.subarray(0, copied), ...drain(player, {budgetMs: 8})];
      assert.deepEqual(actual, expected);
      assert.deepEqual(engine.trace, referenceEngine.trace);
      assert(engine.sizes.every(n => n <= 279));
      assert.equal(player.pendingWaitSamples, 0);
      player.reset(); player.play(); player.process(left, right, 2048, {budgetMs: 8});
      assert(player.pendingWaitSamples > 0);
      player.stop(); assert.equal(player.pendingWaitSamples, 0);
      player.load(vgmBytes([0x70,0x66])); player.play();
      assert.equal(drain(player, {budgetMs: 8}).length, Math.floor(rate / 44100));
    }
  });

  test(`${Player === VgmPlayer ? 'web' : 'docs'}: dense writes yield without inserting silence or losing writes`, t => {
    let clock = 0;
    t.mock.method(performance, 'now', () => clock);
    const engine = new MockSoundEngine();
    const write = engine.writeYm2612.bind(engine);
    engine.writeYm2612 = (...args) => {clock += 4; write(...args);};
    const player = new Player(engine);
    player.load(vgmBytes([...Array.from({length: 50}, (_, i) => [0x52,0x2a,i]).flat(), 0x70,0x66]));
    player.play();
    assert.equal(player.process(new Float32Array(2048), new Float32Array(2048), 2048, {budgetMs: 8}), 0);
    assert.equal(engine.trace.length, 2);
    assert.equal(drain(player, {budgetMs: 8}).length, 1);
    assert.equal(engine.trace.length, 50);
    assert(engine.trace.every(event => event.frame === 0));
  });

  test(`${Player === VgmPlayer ? 'web' : 'docs'}: checkpoints retain partially rendered waits`, t => {
    let clock = 0;
    t.mock.method(performance, 'now', () => clock);
    const engine = new MockSoundEngine();
    engine.supportsState = () => true;
    engine.saveState = () => ({byteLength: 4, frames: engine.frames});
    engine.validateState = () => {};
    engine.loadState = state => {engine.frames = state.frames;};
    engine.processFrames = n => {
      const left = Float32Array.from({length: n}, (_, i) => ((engine.frames + i) % 127) / 128);
      engine.frames += n; clock += n / 32;
      return {left, right: left.slice()};
    };
    const player = new Player(engine);
    player.load(vgmBytes([0x61,0xff,0xff,0x66])); player.play();
    player.process(new Float32Array(2048), new Float32Array(2048), 2048, {budgetMs: 8});
    const pending = player.pendingWaitSamples;
    assert(pending > 0);
    const state = player.saveState();
    const expected = drain(player, {budgetMs: 8});
    player.loadState(state);
    assert.equal(player.pendingWaitSamples, pending);
    assert.deepEqual(drain(player, {budgetMs: 8}), expected);
  });
}
