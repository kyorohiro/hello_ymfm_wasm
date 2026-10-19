import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createPerformanceQueue, createPerformanceChipOwnership} from './playground_performance_queue.js';
import {createChipPortReceiver} from './playground_chip_port.js';
import {createOpnAuditionGuard, receiveOpnAuditionCommand} from './playground_audition_guard.js';
import {YM2612DacPlayer, receiveDacCommand} from './ym2612_dac.js';
import {validateChipClock} from './playground_chip_clock.js';

const names = ['ym2612-worklet', 'ym2612-worklet-nuked', 'ym2203-worklet', 'ym2608-worklet', 'ym2610b-worklet'];
test('served primary worklets resolve their real static module imports, including generated WASM loaders', () => {
  for (const name of names) {
    const tree = 'docs/js';
    const sourceUrl = new URL(`../${tree}/${name}.js`, import.meta.url);
    const source = fs.readFileSync(sourceUrl, 'utf8');
    for (const [, path] of source.matchAll(/^import .* from ["']([^"']+)["'];/gm)) {
      const resolved = new URL(path, sourceUrl); resolved.search = '';
      assert.ok(fs.existsSync(resolved), `${tree}/${name}.js cannot load ${path}`);
    }
    const webSource = fs.readFileSync(new URL(`./${name}.js`, import.meta.url), 'utf8');
    const withoutImportVersions = text => text.replace(/^(import .* from ["'][^"']+\.js)\?v=[^"']+(["'];)$/gm, '$1$2');
    assert.equal(withoutImportVersions(source), withoutImportVersions(webSource.replaceAll('"./generated/', '"../generated/')));
  }
});
function processor(tree, name, rate = 48000) {
  let Type;
  const replies = [], portReplies = [], writes = [];
  const scope = {
    currentFrame: 0, sampleRate: rate, Float32Array, Uint8Array, Error,
    createPerformanceQueue, createPerformanceChipOwnership, createChipPortReceiver, createOpnAuditionGuard, receiveOpnAuditionCommand,
    YM2612DacPlayer, receiveDacCommand, validateChipClock,
    AudioWorkletProcessor: class {constructor() {this.port = {postMessage: data => replies.push(data)};}},
    registerProcessor(_name, value) {Type = value;},
  };
  vm.runInNewContext(fs.readFileSync(new URL(`../${tree}/${name}.js`, import.meta.url), 'utf8').replace(/^import .*;\n/gm, ''), scope);
  const p = new Type();
  const chip = {
    value: 0, reservations: [], generatedFrames: 0, sampleRate: () => rate, reset() {this.value = 0;},
    writeRegister(register, value, port = 0) {writes.push([register, value, port]); this.value = value;},
    reserveStereoFrames(frames) {this.reservations.push(frames);},
    generateStereo(frames) {this.generatedFrames += frames; return {left: new Float32Array(frames).fill(this.value), right: new Float32Array(frames).fill(this.value)};},
    generateStereoView(frames) {return this.generateStereo(frames);},
  };
  if (name.startsWith('ym2612')) p.ym2612 = chip;
  else {p.chip = chip; p.chipRate = rate;}
  p.auditions = createOpnAuditionGuard(chip, name === 'ym2203-worklet' ? 3 : 6);
  const send = data => p.port.onmessage({data});
  const port = {start() {}, close() {}, postMessage: data => {replies.push(data); portReplies.push(data);}};
  send({type: 'attach-chip-port', port});
  send({type: 'performance-start', session: 1, id: 1});
  const batch = (frame, commands, owner = 'loop:1', session = 1) => port.onmessage({data: {
    performance: {session, owner, time: frame / rate}, commands,
  }});
  const render = (count = 128) => {
    const left = new Float32Array(count), right = new Float32Array(count);
    p.process([], [[left, right]]); scope.currentFrame += count; return left;
  };
  return {p, chip, scope, replies, portReplies, writes, send, batch, render, port};
}

for (const tree of ['web', 'docs/js']) for (const name of names) {
  test(`${tree} ${name}: Worker batches apply at exact device frames and canceled loops never sound`, () => {
    const f = processor(tree, name);
    f.batch(37, [{type: 'write', register: 0x40, port: 0, value: 1}]);
    f.batch(70, [{type: 'write', register: 0x40, port: 0, value: 2}], 'removed');
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'removed'});
    const pcm = f.render();
    assert.ok(pcm.slice(0, 37).every(value => value === 0));
    assert.ok(pcm.slice(37).every(value => value === 1));
    assert.deepEqual(f.writes, [[0x40, 1, 0]]);
  });

  test(`${tree} ${name}: stop blocks late old notes; new session and immediate keyboard remain usable`, () => {
    const f = processor(tree, name);
    f.batch(50, [{type: 'write', register: 0x40, port: 0, value: 5}]);
    f.send({type: 'performance-stop', session: 1});
    f.batch(50, [{type: 'write', register: 0x40, port: 0, value: 6}]);
    assert.ok(f.render().every(value => value === 0));
    f.send({type: 'performance-start', session: 2});
    f.batch(160, [{type: 'write', register: 0x40, port: 0, value: 7}], 'new', 2);
    f.send({type: 'performance-stop', session: 1});
    f.send({type: 'audition-note-on', channel: 0, token: 1, block: 4, fnum: 553});
    assert.deepEqual(f.writes.slice(-4), [[0x28, 0, 0], [0xa4, 34, 0], [0xa0, 41, 0], [0x28, 240, 0]]);
    assert.equal(f.p.performanceQueue.getStats().queuedCommands, 1);
    const pcm = f.render();
    assert.ok(pcm.slice(0, 32).every(value => value === 240));
    assert.ok(pcm.slice(32).every(value => value === 7));
  });

  test(`${tree} ${name}: removing a loop releases its applied voice while preserving newer owners and manual keys`, () => {
    const f = processor(tree, name);
    f.batch(0, [{type: 'write', port: 0, register: 0x28, value: 0xf0}], 'old');
    f.batch(0, [{type: 'write', port: 0, register: 0x28, value: 0xf1}], 'old');
    f.render(1);
    f.batch(1, [{type: 'write', port: 0, register: 0x28, value: 0xf1}], 'new');
    f.render(1);
    f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'old'});
    assert.deepEqual(f.writes, [[0x28, 0, 0]]);
    f.send({type: 'audition-note-on', channel: 1, token: 1, block: 4, fnum: 553});
    f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'new'});
    assert.deepEqual(f.writes, [], 'audition guard protects held manual voice from canceled script ownership');
  });
}

for (const name of ['ym2612-worklet', 'ym2612-worklet-nuked']) {
  test(`${name}: clock and DAC playback acknowledge reservation before the future frame`, () => {
    const f = processor('web', name);
    f.batch(64, [{type: 'chip-clock', clock: 4000000, id: 10}]);
    assert.ok(f.replies.some(reply => reply.type === 'chip-clock-result' && reply.id === 10));
    assert.notEqual(f.p.clock, 4000000);
    f.send({type: 'pcm-dac', id: 11, command: {action: 'load', name: 'hit', data: new Uint8Array([129, 130]), sampleRate: 24000}});
    f.batch(80, [{type: 'pcm-dac', id: 12, command: {action: 'play', name: 'hit'}}]);
    assert.ok(f.replies.some(reply => reply.type === 'pcm-dac-result' && reply.id === 12));
    assert.equal(f.p.pcmDac.queue.length, 0);
    assert.equal(f.p.pcmDac.active, null);
    f.render();
    assert.equal(f.p.clock, 4000000);
    assert.equal(f.replies.filter(reply => reply.type === 'chip-clock-result' && reply.id === 10).length, 1);
    assert.equal(f.replies.filter(reply => reply.type === 'pcm-dac-result' && reply.id === 12).length, 1);
    assert.ok(f.writes.some(([register, value]) => register === 0x2a && value === 129));
  });
}

for (const tree of ['web', 'docs/js']) {
  test(`${tree} primary YM2203: canceling a loop releases its SSG tone/noise/envelope voices only`, () => {
    const f = processor(tree, 'ym2203-worklet');
    f.batch(0, [{type: 'write', port: 0, register: 8, value: 12},
      {type: 'write', port: 0, register: 9, value: 16},
      {type: 'write', port: 0, register: 10, value: 9}], 'old');
    f.render(1);
    f.batch(1, [{type: 'write', port: 0, register: 9, value: 10}], 'new');
    f.render(1);
    f.send({type: 'write', port: 0, register: 10, value: 6}); f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'old'});
    assert.deepEqual(f.writes, [[8, 0, 0]], 'newer loop and immediate manual voice keep sounding');
    f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'new'});
    assert.deepEqual(f.writes, [[9, 0, 0]]);
    f.batch(2, [{type: 'write', port: 0, register: 8, value: 16}], 'envelope'); f.render(1);
    f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'envelope'});
    assert.deepEqual(f.writes, [[8, 0, 0]], 'envelope-only level 16 also belongs to its loop');
  });

  test(`${tree} primary YM2608: memory/ROM prep replies on its direct port before future performance frames`, () => {
    const f = processor(tree, 'ym2608-worklet'), loaded = [];
    f.chip.loadAdpcmARom = bytes => loaded.push(['rom', bytes.length]);
    f.chip.loadAdpcmBMemory = (bytes, address) => {if (address === 1) throw Error('Memory rejected'); loaded.push(['memory', address, bytes.length]);};
    f.batch(400, [{type: 'loadRhythmRom', id: 21, bytes: new Uint8Array(8192)},
      {type: 'loadAdpcmMemory', id: 22, bytes: new Uint8Array(32), address: 64}]);
    assert.deepEqual(loaded, [['rom', 8192], ['memory', 64, 32]]);
    for (const [type, id] of [['rhythm-rom-loaded', 21], ['adpcm-memory-loaded', 22]]) {
      assert.ok(f.portReplies.some(reply => reply.type === type && reply.id === id && !reply.error));
    }
    assert.equal(f.p.performanceQueue.getStats().queuedCommands, 0);
    f.port.onmessage({data: [{type: 'loadAdpcmMemory', id: 23, bytes: new Uint8Array(32), address: 1}]});
    assert.ok(f.portReplies.some(reply => reply.id === 23 && reply.error === 'Memory rejected'));
    f.p.chip = null;
    f.port.onmessage({data: [{type: 'loadRhythmRom', id: 24, bytes: new Uint8Array(8192)}]});
    assert.ok(f.portReplies.some(reply => reply.id === 24 && /not ready/.test(reply.error)));
  });

  test(`${tree} primary YM2608: canceled loops release SSG/rhythm/ADPCM without silencing replacement voices`, () => {
    const f = processor(tree, 'ym2608-worklet');
    f.batch(0, [{type: 'write', port: 0, register: 8, value: 12},
      {type: 'write', port: 0, register: 9, value: 13},
      {type: 'write', port: 0, register: 0x10, value: 3},
      {type: 'write', port: 1, register: 0, value: 0xa0}], 'old');
    f.render(1);
    f.batch(1, [{type: 'write', port: 0, register: 9, value: 10},
      {type: 'write', port: 0, register: 0x10, value: 2}], 'new');
    f.render(1); f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'old'});
    assert.deepEqual(f.writes, [[8, 0, 0], [0x10, 0x81, 0], [0, 1, 1]]);
    f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'new'});
    assert.deepEqual(f.writes, [[9, 0, 0], [0x10, 0x82, 0]]);
  });

  test(`${tree} primary YM2610/B: A/B ROM prep acknowledges before future frames and retains full memory size`, () => {
    const f = processor(tree, 'ym2610b-worklet'), loaded = [];
    f.chip.loadAdpcmRom = (type, bytes, address, size) => {
      if (![0, 1].includes(type)) throw Error('Invalid ADPCM type');
      loaded.push([type, address, bytes.length, size]);
    };
    f.batch(400, [{type: 'loadAdpcmMemory', memoryType: 0, id: 31, bytes: new Uint8Array(256), address: 512},
      {type: 'loadAdpcmMemory', memoryType: 1, id: 32, bytes: new Uint8Array(512), address: 1024}]);
    assert.deepEqual(loaded, [[0, 512, 256, 0x1000000], [1, 1024, 512, 0x1000000]]);
    for (const id of [31, 32]) assert.ok(f.portReplies.some(reply => reply.type === 'adpcm-memory-loaded' && reply.id === id && !reply.error));
    assert.equal(f.p.performanceQueue.getStats().queuedCommands, 0);
    f.port.onmessage({data: [{type: 'loadAdpcmMemory', memoryType: 2, id: 33, bytes: new Uint8Array(256)}]});
    assert.ok(f.portReplies.some(reply => reply.id === 33 && reply.error === 'Invalid ADPCM type'));
    f.p.chip = null;
    f.port.onmessage({data: [{type: 'loadAdpcmMemory', memoryType: 0, id: 34, bytes: new Uint8Array(256)}]});
    assert.ok(f.portReplies.some(reply => reply.id === 34 && /not ready/.test(reply.error)));
  });

  test(`${tree} primary YM2610/B: initialization selects the actual four-channel or six-channel core variant`, async () => {
    const f = processor(tree, 'ym2610b-worklet'), variants = [];
    f.scope.ym2610bModuleFactory = {};
    f.scope.YM2610B_CLOCK = 8000000;
    f.scope.Ym2610B = {create: async options => {variants.push(options.variant); return f.chip;}};
    await f.p.initialize(new ArrayBuffer(1), false);
    await f.p.initialize(new ArrayBuffer(1), true);
    await f.p.initialize(new ArrayBuffer(1));
    assert.deepEqual(variants, [false, true, true]);
    assert.deepEqual(f.chip.reservations, [128, 128, 128]);
    assert.equal(f.chip.generatedFrames, 0, 'all variants reserve capacity without advancing synthesis');
  });

  test(`${tree} primary YM2610/B: canceled loops release SSG and both ADPCM sections while preserving newer owners`, () => {
    const f = processor(tree, 'ym2610b-worklet');
    f.batch(0, [{type: 'write', port: 0, register: 8, value: 12},
      {type: 'write', port: 0, register: 9, value: 13},
      {type: 'write', port: 1, register: 0, value: 3},
      {type: 'write', port: 0, register: 0x10, value: 0xb0}], 'old');
    f.render(1);
    f.batch(1, [{type: 'write', port: 0, register: 9, value: 10},
      {type: 'write', port: 1, register: 0, value: 2}], 'new');
    f.render(1); f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'old'});
    assert.deepEqual(f.writes, [[8, 0, 0], [0, 0x81, 1], [0x10, 1, 0]]);
    f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'new'});
    assert.deepEqual(f.writes, [[9, 0, 0], [0, 0x82, 1]]);
    f.batch(2, [{type: 'write', port: 0, register: 0x10, value: 0xa0}], 'b-old'); f.render(1);
    f.batch(3, [{type: 'write', port: 0, register: 0x10, value: 0xa0}], 'b-new'); f.render(1); f.writes.length = 0;
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'b-old'});
    assert.deepEqual(f.writes, [], 'a replacement ADPCM-B sample owns its ongoing decoder');
    f.send({type: 'performance-cancel-owner', session: 1, owner: 'b-new'});
    assert.deepEqual(f.writes, [[0x10, 1, 0]]);
  });
}
