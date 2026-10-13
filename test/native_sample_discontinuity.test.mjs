import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSampleProcessor} from '../web/native_sample_processor.js';
import {createNativeSampleController} from '../web/native_sample.js';
import {TetoricaAudioRuntime} from '../web/tetorica_audio_runtime.js';

const module = await WebAssembly.compile(readFileSync(new URL('../web/native_audio_effect.wasm', import.meta.url)));

function harness(rate = 48000) {
  const api = new WebAssembly.Instance(module, {env: {emscripten_notify_memory_growth() {}}}).exports;
  api._initialize?.();
  const processor = createSampleProcessor(api, rate);
  let player;
  player = createNativeSampleController(message => {
    try {
      const value = processor.command(message);
      if (message.id) player.accept({op: 'sample-response', id: message.id, value});
    } catch (error) {
      if (message.id) player.accept({op: 'sample-response', id: message.id, error: error.message});
      else throw error;
    }
  });
  const render = (frames, block = 128) => {
    const output = new Float32Array(frames);
    const cap = api.gain_capacity();
    const input = new Float32Array(api.memory.buffer, api.gain_input(), cap * 2);
    for (let position = 0; position < frames; position += block) {
      const count = Math.min(block, frames - position);
      input.fill(0);
      api.sample_mix(count);
      output.set(input.subarray(0, count), position);
    }
    return output;
  };
  return {api, player, rate, render};
}

function maxJump(pcm) {
  let jump = 0;
  for (let i = 1; i < pcm.length; i++) jump = Math.max(jump, Math.abs(pcm[i] - pcm[i - 1]));
  return jump;
}

for (const rate of [44100, 48000, 96000]) {
  test(`requested fadeOut prevents a nonzero natural sample end from clicking at ${rate} Hz`, async () => {
    const h = harness(rate);
    const frames = Math.round(rate * .02);
    await h.player.load('dc', {sampleRate: rate, channels: [new Float32Array(frames).fill(.75)]});
    await h.player.play('dc', {pan: -1, fadeIn: .002, fadeOut: .004});
    const pcm = h.render(frames + 2);
    assert.equal(pcm[0], 0);
    assert.ok(pcm[Math.round(frames / 2)] > .74);
    assert.equal(pcm[frames], 0);
    assert.ok(pcm[frames - 1] <= .75 / (rate * .004) + 1e-6);
    assert.ok(maxJump(pcm) < .01, 'attack and natural release have no abrupt boundary');

    await h.player.play('dc', {pan: -1});
    const raw = h.render(frames + 2);
    assert.equal(raw[frames - 1], .75, 'unspecified fades preserve raw PCM playback');
    assert.equal(raw[frames], 0);
  });
}

for (const playbackRate of [.25, .5, 1, 2, -.5, -2]) {
  for (const loop of [false, true]) {
    test(`source duration and offset keep fadeOut in output seconds: rate ${playbackRate}, loop ${loop}`, async () => {
      const h = harness();
      await h.player.load('dc', {sampleRate: 48000, channels: [new Float32Array(4800).fill(.5)]});
      await h.player.play('dc', {pan: -1, playbackRate, offset: .01, duration: .02, loop, fadeOut: .003});
      const frames = Math.ceil(960 / Math.abs(playbackRate));
      const pcm = h.render(frames + 2);
      const releaseFrames = .003 * 48000;
      assert.ok(Math.abs(pcm[frames - 72] - .25) < 1e-6, 'release length does not scale with playbackRate');
      assert.ok(pcm[frames - 1] <= .5 / releaseFrames + 1e-6);
      assert.equal(pcm[frames], 0, 'duration is source seconds');
      assert.ok(maxJump(pcm.subarray(frames - 145)) < .004);
    });
  }
}

test('stop during a natural release never raises the current sample gain', async () => {
  const h = harness();
  await h.player.load('dc', {sampleRate: 48000, channels: [new Float32Array(960).fill(.75)]});
  const voice = await h.player.play('dc', {pan: -1, fadeOut: .01});
  const before = h.render(800);
  voice.stop();
  const after = h.render(200);
  assert.ok(after[0] <= before.at(-1));
  assert.ok(Math.abs(after[0] - .25) < 1e-6);
  assert.equal(after[160], 0);
  assert.ok(maxJump(after) < .002, 'natural end remains faded even when an explicit stop overlaps it');
});

test('fractional playback positions and different source/output rates keep a smooth natural release', async () => {
  const h = harness(48000);
  await h.player.load('resampled', {sampleRate: 44100, channels: [new Float32Array(4410).fill(.5)]});
  await h.player.play('resampled', {pan: -1, playbackRate: -.6, offset: .004, duration: .0123, fadeOut: .003});
  const frames = Math.ceil(.0123 * 48000 / .6);
  const pcm = h.render(frames + 3);
  assert.ok(pcm[frames - 2] < .012);
  assert.equal(pcm[frames + 1], 0);
  assert.ok(maxJump(pcm.subarray(frames - 145)) < .004);
});

test('overlapping attack/release and reverse playback remain block-size independent', async () => {
  const a = harness(), b = harness();
  for (const h of [a, b]) {
    await h.player.load('short', {sampleRate: 48000, channels: [new Float32Array(240).fill(.5)]});
    await h.player.play('short', {pan: -1, playbackRate: -1, fadeIn: .01, fadeOut: .01});
  }
  const pcm = a.render(242), split = b.render(242, 37);
  assert.deepEqual(pcm, split);
  assert.equal(pcm[0], 0);
  assert.ok(Math.abs(pcm[120] - .125) < 1e-6, 'short samples meet at the attack/release intersection');
  assert.equal(pcm[240], 0);
  assert.ok(maxJump(pcm) < .002);
});

test('an unbounded loop keeps its requested level until stopped', async () => {
  const h = harness();
  await h.player.load('loop', {sampleRate: 48000, channels: [new Float32Array(16).fill(.5)]});
  const voice = await h.player.play('loop', {pan: -1, loop: true, fadeOut: .002});
  assert.ok(h.render(1000).every(value => value === .5));
  voice.stop();
  const pcm = h.render(100);
  assert.equal(pcm[0], .5);
  assert.equal(pcm[96], 0);
  assert.ok(maxJump(pcm) < .006);
});

test('an overflowing derived playback step is rejected before it can trap the mixer', async () => {
  const h = harness();
  await h.player.load('huge-rate', {sampleRate: Number.MAX_VALUE, channels: [Float32Array.of(.5)]});
  await assert.rejects(h.player.play('huge-rate', {playbackRate: Number.MAX_VALUE, loop: true}), /Invalid sample playback/);
  assert.ok(h.render(128).every(value => value === 0));
});

function fallbackHarness() {
  const events = [], stops = [];
  const node = () => ({connect() {}, disconnect() {}});
  const gain = {...node(), gain: {
    value: 1,
    cancelScheduledValues: time => events.push(['cancel', time]),
    setValueAtTime: (value, time) => events.push(['set', value, time]),
    linearRampToValueAtTime: (value, time) => events.push(['ramp', value, time]),
  }};
  const source = {...node(), playbackRate: {value: 1}, addEventListener() {}, start() {}, stop: time => stops.push(time)};
  const context = {currentTime: 10, destination: node(), createBufferSource: () => source, createGain: () => gain};
  const audio = new TetoricaAudioRuntime({audioContext: context});
  audio.storeSample('dc', {duration: .1});
  return {audio, context, events, stops};
}

test('BufferSource fallback schedules natural output-second release and preserves the current envelope on stop', () => {
  const h = fallbackHarness();
  const voice = h.audio.playSample('dc', {playbackRate: .5, offset: .01, duration: .02, gain: .75, fadeIn: .002, fadeOut: .01});
  const releaseStart = h.events.find(event => event[0] === 'set' && event[2] > 10);
  assert.ok(Math.abs(releaseStart[2] - 10.03) < 1e-9);
  assert.ok(Math.abs(h.events.at(-1)[2] - 10.04) < 1e-9);
  h.context.currentTime = 10.035;
  voice.stop();
  assert.ok(Math.abs(h.events.at(-2)[1] - .375) < 1e-9, 'stop does not restore full gain during natural release');
  assert.ok(Math.abs(h.stops[0] - 10.04) < 1e-9, 'stop cannot extend the sample beyond its source duration');
});

test('BufferSource fallback intersects short attack/release ramps without a gain jump', () => {
  const h = fallbackHarness();
  h.audio.playSample('dc', {duration: .005, gain: .5, fadeIn: .01, fadeOut: .01});
  const ramps = h.events.filter(event => event[0] === 'ramp');
  assert.equal(ramps.length, 2);
  assert.ok(Math.abs(ramps[0][1] - .125) < 1e-9);
  assert.ok(Math.abs(ramps[0][2] - 10.0025) < 1e-9);
  assert.equal(ramps[1][1], 0);
  assert.ok(Math.abs(ramps[1][2] - 10.005) < 1e-9);
});
