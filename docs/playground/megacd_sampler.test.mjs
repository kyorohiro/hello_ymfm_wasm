import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {encodeRf5c164} from '../../web/rf5c164_pcm.js';
import {Rf5c164} from '../../web/rf5c164.js';
import {createRf5c164Control} from '../../web/playground_rf5c164.js';
import factory from '../generated/rf5c164_wasm.js';

const source = await readFile(new URL('./examples/mega-cd/megacd-sampler.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tone = (frequency, sampleRate = 48000, seconds = 0.1) => ({
  name: 'tone.wav', source: 'file', sampleRate,
  channels: [Float32Array.from({length: Math.round(sampleRate * seconds)}, (_, i) => Math.sin(2 * Math.PI * frequency * i / sampleRate))],
});

async function runSampler(audio = tone(440), overrides = {}) {
  const commands = [], handlers = new Map(), logs = [], loaded = [], cleanups = [];
  const pcm = {
    async loadSample(data, options) {
      const encoded = encodeRf5c164(data);
      loaded.push({data, encoded, options});
      return {start: 0, loopStart: encoded.frames + 1, step: encoded.step};
    },
    async keyOff(channel) { commands.push(['off', channel]); },
    async keyOn(channel) { commands.push(['on', channel]); },
    async setChannel(channel, options) { commands.push(['channel', channel, options]); },
    ...overrides,
  };
  const api = {
    inputAudio: async options => { assert.equal(typeof options.title, 'string'); return audio; },
    useSoundChip: async name => { assert.equal(name, 'rf5c164'); return pcm; },
    onKeyboardPressKey: (name, callback) => handlers.set('down', callback),
    onKeyboardReleaseKey: (name, callback) => handlers.set('up', callback),
    liveCleanup: (names, callback) => { assert.deepEqual(names, ['megacd-sampler']); cleanups.push(callback); },
    log: message => logs.push(message),
  };
  const {prepareSample} = await new AsyncFunction(...Object.keys(api), `${source}\nreturn {prepareSample};`)(...Object.values(api));
  const down = (code, fields = {}) => handlers.get('down')({code, ...fields});
  const up = (code, fields = {}) => handlers.get('up')({code, ...fields});
  const cleanup = () => Promise.all(cleanups.map(callback => callback()));
  return {commands, handlers, logs, loaded, pcm, prepareSample, down, up, cleanup};
}

test('the sampler crops and downmixes recordings within actual RF5C164 memory limits', async () => {
  const {prepareSample} = await runSampler(null);
  const channels = [new Float32Array(48000 * 6).fill(0.8), new Float32Array(48000 * 6).fill(0.4)];
  const pcm = prepareSample({channels, sampleRate: 48000}, 0.25, 3, 16000);
  const encoded = encodeRf5c164(pcm);
  assert.equal(pcm.sampleRate, 16000);
  assert.equal(pcm.channels.length, 1);
  assert.equal(pcm.channels[0].length, 48000);
  assert.equal(encoded.bytes.length, 48003);
  assert.equal(encoded.step, 1007);
  assert.equal(pcm.channels[0][0], 0);
  assert.equal(pcm.channels[0].at(-1), 0);
  assert.ok(Math.abs(pcm.channels[0][1600] - 0.6) < 0.000001);
  assert.equal(channels[0][0], Math.fround(0.8), 'preparation does not modify the recording');
  const long = prepareSample({channels, sampleRate: 48000}, 0, 10, 48000);
  assert.equal(encodeRf5c164(long).bytes.length, 65536, 'edited settings still fit all RAM including loop/silence markers');
});

test('sample preparation preserves audible pitch and suppresses downsampling aliases', async () => {
  const {prepareSample} = await runSampler(null);
  const rms = pcm => {
    const values = pcm.channels[0].slice(160, -160);
    return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  };
  const low = prepareSample(tone(1000), 0, 3, 16000);
  const high = prepareSample(tone(12000), 0, 3, 16000);
  assert.ok(rms(low) > 0.69, 'a 1 kHz tone keeps its level at the original playback speed');
  assert.ok(rms(high) < 0.005, 'a 12 kHz source does not fold into a loud 4 kHz note');
  let crossings = 0;
  for (let i = 161; i < low.channels[0].length - 160; i++) {
    if (low.channels[0][i - 1] < 0 && low.channels[0][i] >= 0) crossings++;
  }
  assert.ok(crossings >= 79 && crossings <= 81, `1 kHz remains 1 kHz (${crossings} cycles / 80 ms)`);
});

test('loading a file or microphone recording prepares RAM silently; cancel installs no instrument', async () => {
  for (const inputSource of ['file', 'microphone']) {
    const sampler = await runSampler({...tone(440), source: inputSource});
    assert.equal(sampler.loaded.length, 1);
    assert.deepEqual(sampler.loaded[0].options, {address: 0});
    assert.deepEqual(sampler.commands, [], 'choosing a sample never starts a voice');
    assert.equal(sampler.handlers.size, 2);
    assert.match(sampler.logs[0], /1600 \/ 65533 sample bytes, 16000 Hz, 8 voices/);
  }
  const cancelled = await runSampler(null);
  assert.equal(cancelled.loaded.length, 0);
  assert.equal(cancelled.handlers.size, 0);
  assert.match(cancelled.logs[0], /No sample selected/);
});

test('keyboard chords use independent chip voices with chromatic pitch and channel panning', async () => {
  const sampler = await runSampler();
  await sampler.down('KeyA');
  await sampler.down('KeyK');
  const changes = sampler.commands.filter(command => command[0] === 'channel');
  assert.deepEqual(changes.map(command => command[1]), [0, 1]);
  assert.equal(changes[0][2].step, 1007, 'C4 plays the recording at its original speed');
  assert.equal(changes[1][2].step, 2014, 'C5 is exactly one octave higher');
  assert.deepEqual(changes[0][2].pan, {left: 15, right: 11});
  assert.deepEqual(changes[1][2].pan, {left: 11, right: 15});
  const length = sampler.commands.length;
  await sampler.down('KeyA');
  await sampler.down('KeyA', {repeat: true});
  await sampler.down('KeyQ');
  await sampler.down('KeyS', {metaKey: true});
  await sampler.down('KeyS', {editable: true});
  assert.equal(sampler.commands.length, length, 'held keys, typing, shortcuts and unmapped keys do not retrigger');
  await sampler.up('KeyA', {editable: true});
  assert.deepEqual(sampler.commands.at(-1), ['off', 0]);
  await sampler.up('KeyK');
  assert.deepEqual(sampler.commands.at(-1), ['off', 1]);
});

test('eight held notes steal only the oldest voice; releasing its old key keeps the new note', async () => {
  const sampler = await runSampler();
  for (const key of ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY']) await sampler.down(key);
  assert.deepEqual(sampler.commands.filter(command => command[0] === 'on').map(command => command[1]), [0, 1, 2, 3, 4, 5, 6, 7, 0]);
  const count = sampler.commands.length;
  await sampler.up('KeyA');
  assert.equal(sampler.commands.length, count, 'the stolen key no longer owns channel 0');
  await sampler.up('KeyY');
  assert.deepEqual(sampler.commands.at(-1), ['off', 0]);
});

test('the default eight-voice sampler stays below clipping in the actual RF5C164 core', async () => {
  const chip = await Rf5c164.create({moduleFactory: factory, moduleOptions: {
    wasmBinary: await readFile(new URL('../generated/rf5c164_wasm.wasm', import.meta.url)),
  }, sampleRate: 48000});
  const control = createRf5c164Control(chip);
  try {
    const audio = {name: 'full-scale.wav', source: 'file', sampleRate: 48000, channels: [new Float32Array(4800).fill(1)]};
    const sampler = await runSampler(audio, {
      async loadSample(data) {
        const encoded = encodeRf5c164(data);
        control.loadMemory(encoded.bytes, 0);
        return {start: 0, loopStart: encoded.frames + 1, step: encoded.step};
      },
      async keyOff(channel) { control.keyOff(channel); },
      async keyOn(channel) { control.keyOn(channel); },
      async setChannel(channel, options) { control.setChannel(channel, options); },
    });
    const keys = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG'];
    for (const key of keys) await sampler.down(key);
    const output = chip.generateStereo(2048);
    const peak = Math.max(...output.left, ...output.right);
    assert.ok(peak > 0.8 && peak < 0.99, `all eight full-scale voices stay in range (peak ${peak})`);
    assert.ok(output.left.every(Number.isFinite));
    assert.ok(output.right.every(Number.isFinite));
    for (const key of keys) await sampler.up(key);
    chip.generateStereo(128);
    assert.ok(chip.generateStereo(128).left.every(value => value === 0));
  } finally {
    chip.dispose();
  }
});

test('a key released during an asynchronous channel update cannot revive afterwards', async () => {
  let finishUpdate;
  const entered = new Promise(resolve => { finishUpdate = resolve; });
  let finishRpc;
  const delayed = new Promise(resolve => { finishRpc = resolve; });
  const sampler = await runSampler(tone(440), {async setChannel() { finishUpdate(); await delayed; }});
  const press = sampler.down('KeyA');
  await entered;
  const release = sampler.up('KeyA');
  finishRpc();
  await Promise.all([press, release]);
  assert.deepEqual(sampler.commands, [['off', 0], ['off', 0]], 'no delayed note-on follows key release');
});

test('stealing a voice while its channel update awaits keeps new pitch and release ownership', async () => {
  let finishUpdate, finishRpc;
  const entered = new Promise(resolve => { finishUpdate = resolve; });
  const delayed = new Promise(resolve => { finishRpc = resolve; });
  let calls = 0;
  const changes = [];
  const sampler = await runSampler(tone(440), {async setChannel(channel, options) {
    changes.push([channel, options.step]);
    if (++calls === 1) { finishUpdate(); await delayed; }
  }});
  const firstPress = sampler.down('KeyA');
  await entered;
  const presses = ['KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY'].map(key => sampler.down(key));
  await sampler.up('KeyA');
  finishRpc();
  await Promise.all([firstPress, ...presses]);
  assert.equal(sampler.commands.filter(command => command[0] === 'on' && command[1] === 0).length, 1, 'only the new owner starts channel 0');
  assert.deepEqual(changes.filter(change => change[0] === 0), [[0, 1007], [0, Math.round(1007 * 2 ** (8 / 12))]]);
  await sampler.up('KeyY');
  assert.deepEqual(sampler.commands.at(-1), ['off', 0]);
});

test('Stop silences all voices immediately without a late queued job muting the next Run', async () => {
  let finishUpdate, finishRpc;
  const entered = new Promise(resolve => { finishUpdate = resolve; });
  const delayed = new Promise(resolve => { finishRpc = resolve; });
  const sampler = await runSampler(tone(440), {async setChannel() { finishUpdate(); await delayed; }});
  const press = sampler.down('KeyA');
  await entered;
  const release = sampler.up('KeyA');
  await sampler.cleanup(); // Must finish before the old pending setter resolves.
  assert.deepEqual(sampler.commands.slice(-8), Array.from({length: 8}, (_, channel) => ['off', channel]));
  sampler.commands.push(['next-run-on', 0]);
  finishRpc();
  await Promise.all([press, release]);
  await sampler.down('KeyS');
  await sampler.up('KeyS');
  assert.deepEqual(sampler.commands.at(-1), ['next-run-on', 0], 'retired callbacks issue neither a late note-on nor a late note-off');
});
