import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createOpnAuditionGuard, receiveOpnAuditionCommand} from './playground_audition_guard.js';
import {createChipPortReceiver} from './playground_chip_port.js';
import {YM2612DacPlayer, receiveDacCommand} from './ym2612_dac.js';

function chip(registerApi = true) {
  const writes = [], addresses = [0, 0];
  const value = {
    writes, resets: 0,
    write(offset, value) {
      const port = offset >> 1;
      if (offset & 1) writes.push([addresses[port], value, port]);
      else addresses[port] = value;
    },
    reset() { this.resets++; return 'reset result'; },
    sampleRate: () => 48000,
    generateStereoView(frames) { return this.generateStereo(frames); },
    generateStereo(frames) { return {left: new Float32Array(frames), right: new Float32Array(frames)}; },
  };
  if (registerApi) value.writeRegister = (register, data, port = 0) => { writes.push([register, data, port]); return 'write result'; };
  return value;
}
const on = (channel, token, block = 4, fnum = 553) => ({type: 'audition-note-on', channel, token, block, fnum});
const off = (channel, token) => ({type: 'audition-note-off', channel, token});

for (const registerApi of [true, false]) {
  test(`shared OPN audition: ${registerApi ? 'register' : 'bus-pair'} transport filters held-channel pitch/keys only`, () => {
    const core = chip(registerApi), guard = createOpnAuditionGuard(core);
    core.writeRegister(0xa0, 10); // No held keys: ordinary script path.
    assert.deepEqual(core.writes, [[0xa0, 10, 0]]);
    guard.handle(on(3, 100, 5, 0x345));
    assert.deepEqual(core.writes.slice(1), [[0x28, 4, 0], [0xa4, 0x2b, 1], [0xa0, 0x45, 1], [0x28, 0xf4, 0]]);
    core.writes.length = 0;
    for (const [register, value, port] of [[0xa0, 0, 1], [0xa4, 0, 1], [0x28, 4, 0], [0x28, 0xf4, 0]]) {
      core.writeRegister(register, value, port);
    }
    assert.equal(core.writes.length, 0);
    for (const args of [[0xa1, 2, 1], [0xa5, 3, 1], [0x28, 5, 0], [0x40, 9, 1], [0xb0, 7, 1], [0x22, 8, 0], [0x2b, 0x80, 0]]) {
      core.writeRegister(...args);
    }
    assert.equal(core.writes.length, 7, 'other channels, operators, algorithm, LFO and DAC remain script controlled');
    core.writes.length = 0;
    guard.handle(off(3, 100));
    assert.deepEqual(core.writes, [[0x28, 4, 0]], 'release writes key off through the bypass');
    core.writeRegister(0xa0, 22, 1);
    core.writeRegister(0x28, 0xf4, 0);
    assert.equal(core.writes.length, 3, 'next program note proceeds after release');
  });
}

test('a replacement manual key ignores stale releases and leaves other held channels alone', () => {
  const core = chip(), guard = createOpnAuditionGuard(core);
  guard.handle(on(0, 1)); guard.handle(on(1, 2)); guard.handle(on(0, 3));
  core.writes.length = 0;
  guard.handle(off(0, 1));
  core.writeRegister(0xa0, 7, 0); core.writeRegister(0xa1, 7, 0);
  assert.equal(core.writes.length, 0);
  guard.handle(off(0, 3));
  core.writeRegister(0xa0, 8, 0); core.writeRegister(0xa1, 8, 0);
  assert.deepEqual(core.writes, [[0x28, 0, 0], [0xa0, 8, 0]]);
  guard.handle(off(1, 2));
  core.writeRegister(0xa1, 9, 0);
  assert.deepEqual(core.writes.at(-1), [0xa1, 9, 0]);
});

test('holding physical CH3 filters its special-mode frequencies and all key masks', () => {
  const core = chip(), guard = createOpnAuditionGuard(core);
  guard.handle(on(2, 1)); core.writes.length = 0;
  for (const register of [0xa2, 0xa6, 0xa8, 0xa9, 0xaa, 0xac, 0xad, 0xae]) core.writeRegister(register, 23, 0);
  for (const value of [2, 0x12, 0x52, 0xf2]) core.writeRegister(0x28, value, 0);
  assert.equal(core.writes.length, 0);
  core.writeRegister(0xa8, 23, 1); core.writeRegister(0xa1, 23, 0);
  core.writeRegister(0x28, 3, 0); // Invalid hardware key code is still passed through.
  assert.equal(core.writes.length, 3);
  guard.handle(off(2, 1));
  core.writeRegister(0xa9, 24, 0);
  assert.deepEqual(core.writes.at(-1), [0xa9, 24, 0]);
});

test('clear and global reset cancel ownership without replaying stale program notes', () => {
  const core = chip(), guard = createOpnAuditionGuard(core);
  guard.handle(on(0, 1)); core.writes.length = 0;
  core.writeRegister(0x28, 0, 0); // Worker Stop may reach its port before clear.
  assert.equal(core.writes.length, 0);
  guard.handle({type: 'clear-auditions'});
  assert.deepEqual(core.writes, [[0x28, 0, 0]], 'clear bypasses the filter and releases the claimed voice itself');
  core.writeRegister(0x28, 0, 0);
  guard.handle(off(0, 1));
  assert.equal(core.writes.length, 2, 'late release cannot affect unclaimed program channel');
  guard.handle(on(0, 2)); core.writes.length = 0;
  assert.equal(core.reset(), 'reset result');
  assert.equal(core.resets, 1);
  guard.handle(off(0, 2)); core.writeRegister(0xa0, 9, 0);
  assert.deepEqual(core.writes, [[0xa0, 9, 0]]);
});

test('audition validation is atomic, rejects nonfinite data, and reports errors without crashing the processor', () => {
  const core = chip(), guard = createOpnAuditionGuard(core, 3), messages = [];
  guard.handle(on(0, 1)); core.writes.length = 0;
  for (const field of ['channel', 'token', 'block', 'fnum']) {
    const invalid = {channel: [-1, 3, 0.1, NaN, Infinity, '0'], token: [0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'], block: [-1, 8, 0.1, NaN, Infinity], fnum: [-1, 2048, 0.1, NaN, Infinity]};
    for (const value of invalid[field]) assert.throws(() => guard.handle({...on(0, 2), [field]: value}), RangeError);
  }
  assert.equal(core.writes.length, 0);
  guard.handle(off(0, 2)); core.writeRegister(0x28, 0, 0);
  assert.equal(core.writes.length, 0, 'invalid press did not replace the held token');
  assert.equal(receiveOpnAuditionCommand(guard, on(3, 3), message => messages.push(message)), true);
  assert.equal(messages[0].type, 'audition-error');
  assert.match(messages[0].message, /channel/);
  assert.equal(receiveOpnAuditionCommand(null, on(0, 1), message => messages.push(message)), true);
  assert.match(messages[1].message, /not ready/);
  assert.equal(receiveOpnAuditionCommand(guard, {type: 'write'}, () => assert.fail()), false);
  guard.handle(off(0, 1));
});

function processor(file, imports = {}) {
  let Type;
  const messages = [];
  const scope = {createOpnAuditionGuard, receiveOpnAuditionCommand, YM2612DacPlayer, receiveDacCommand,
    createChipPortReceiver: apply => createChipPortReceiver(apply, () => 0),
    sampleRate: 48000, currentFrame: 0, Float32Array, Uint8Array, Error, ...imports,
    AudioWorkletProcessor: class {constructor() {this.port = {postMessage: message => messages.push(message)};}},
    registerProcessor(_name, value) {Type = value;},
  };
  vm.runInNewContext(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), scope);
  return {p: new Type(), messages, scope};
}

for (const file of ['ym2612-worklet.js', 'ym2612-worklet-nuked.js']) {
  test(`${file}: Main, Worker port and scheduled writes share keyboard ownership`, () => {
    const {p} = processor(file), core = chip();
    p.ym2612 = core; p.auditions = createOpnAuditionGuard(core);
    p.applyCommand(on(0, 1)); core.writes.length = 0;
    p.applyCommand({type: 'write', port: 0, register: 0x28, value: 0});
    const port = {start() {}, close() {}};
    p.port.onmessage({data: {type: 'attach-chip-port', port}});
    port.onmessage({data: [{type: 'write', port: 0, register: 0xa0, value: 0}, {type: 'write', port: 0, register: 0x28, value: 0xf0}]});
    p.applyCommand({type: 'schedule-writes', entries: [{time: 0, port: 0, register: 0xa4, value: 0}, {time: 0, port: 0, register: 0x28, value: 0}]});
    p.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(core.writes.length, 0);
    port.onmessage({data: [{type: 'write', port: 0, register: 0x28, value: 0xf1}]});
    assert.deepEqual(core.writes, [[0x28, 0xf1, 0]]);
    p.applyCommand(off(0, 1));
    p.applyCommand({type: 'write', port: 0, register: 0x28, value: 0xf0});
    assert.deepEqual(core.writes.slice(-2), [[0x28, 0, 0], [0x28, 0xf0, 0]]);
  });
}

for (const [name, Type, count] of [['ym2203', 'Ym2203', 3], ['ym2608', 'Ym2608', 6], ['ym2610b', 'Ym2610B', 6]]) {
  test(`${name}: initialized bus-pair chip filters both Main and Worker writes`, async () => {
    const core = chip(false);
    const {p, messages} = processor(`${name}-worklet.js`, {
      [Type]: {create: async () => core}, [`${name}ModuleFactory`]: () => {}, [`${name.toUpperCase()}_CLOCK`]: 8000000,
    });
    await p.initialize(new ArrayBuffer(0));
    assert.equal(messages[0].type, 'ready');
    const channel = count - 1;
    p.port.onmessage({data: on(channel, 1)}); core.writes.length = 0;
    const port = {start() {}, close() {}};
    p.port.onmessage({data: {type: 'attach-chip-port', port}});
    const bank = channel < 3 ? 0 : 1, key = channel < 3 ? channel : channel + 1;
    const pitch = {type: 'write', port: bank, register: 0xa0 + channel % 3, value: 22};
    p.port.onmessage({data: pitch});
    port.onmessage({data: [{type: 'write', port: 0, register: 0x28, value: key}]});
    assert.equal(core.writes.length, 0);
    p.port.onmessage({data: off(channel, 1)});
    p.port.onmessage({data: pitch});
    assert.deepEqual(core.writes, [[0x28, key, 0], [pitch.register, 22, bank]]);
    p.port.onmessage({data: on(count, 2)});
    assert.equal(messages.at(-1).type, 'audition-error');
  });
}
