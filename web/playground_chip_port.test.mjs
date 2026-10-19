import test from 'node:test';
import assert from 'node:assert/strict';
import {createChipPortReceiver} from './playground_chip_port.js';
import {createWorkerChip} from './playground_worker_chip.js';
import {YM2612Synth} from './ym2612synth.js';
import {YM2608Synth} from './ym2608synth.js';
import {OPNWorkletTransport} from './opn_fm_synth.js';
import {createPerformanceQueue} from './playground_performance_queue.js';

test('replacing a performance port retires its session and removes already reserved commands', () => {
  const applied = [];
  const queue = createPerformanceQueue({apply: c => applied.push(c), nowFrame: () => 0, sampleRate: 48000});
  const receive = createChipPortReceiver(c => applied.push(c), () => 0, {performanceQueue: queue});
  const port = () => ({start() {}, close() {}, postMessage() {}});
  const first = port(), second = port();
  const packet = session => ({performance: {session, owner: 'loop:1', time: 1}, commands: [{type: 'write', value: session}]});
  receive({type: 'attach-chip-port', port: first});
  queue.receive({type: 'performance-start', session: 1});
  first.onmessage({data: packet(1)});
  receive({type: 'attach-chip-port', port: second});
  assert.equal(queue.getStats().activeSession, 0);
  first.onmessage({data: packet(1)});
  second.onmessage({data: packet(1)});
  queue.receive({type: 'performance-start', session: 2});
  second.onmessage({data: packet(2)});
  queue.advance(48000);
  assert.deepEqual(applied, [{type: 'write', value: 2}]);
  second.onmessage({data: {...packet(2), performance: {session: 2, owner: 'loop:1', time: 2}}});
  receive({type: 'detach-chip-port'});
  queue.advance(96000);
  assert.equal(applied.length, 1);
});

test('Replacing or detaching a chip port rejects stale queued commands', () => {
  const received = [];
  const receive = createChipPortReceiver(c => received.push(c));
  const port = () => ({start() {}, close() {this.closed = true;}});
  const first = port(), second = port();
  receive({type: 'attach-chip-port', port: first});
  first.onmessage({data: [{type: 'write', value: 1}]});
  receive({type: 'attach-chip-port', port: second});
  first.onmessage({data: [{type: 'write', value: 2}]});
  second.onmessage({data: [{type: 'write', value: 3}]});
  receive({type: 'detach-chip-port'});
  second.onmessage({data: [{type: 'write', value: 4}]});
  assert.deepEqual(received.map(c => c.value), [1, 3]);
  assert.ok(first.closed && second.closed);
});

test('Worker encoder preserves seeded parameters and matches ordinary synth registers', () => {
  const expected = [], actual = [], notifications = [];
  const synth = new YM2612Synth({transport: {write(port, register, value) {expected.push({type: 'write', port, register, value});}}});
  synth.setAlgo(0, 4, 3);
  const worker = createWorkerChip({port: {postMessage: batch => actual.push(...batch)}, capabilities: {chip: 'ym2612', fmChannels: 6}, state: synth.getState(), observe: e => notifications.push(e)});
  assert.equal(actual.length, 0, 'attaching must not reset the running chip');
  expected.length = 0;
  for (const [method, args] of [['setOperator', [0, 0, {tl: 30}]], ['setPreset', [0, {feedback: 2}]], ['noteOn', [0, 4, 553]], ['noteOff', [0]]]) {
    synth[method](...args);
    worker.fm[method](...args);
  }
  assert.deepEqual(actual, expected);
  assert.equal(notifications.length, 4);
});

test('Stop mutes all operators directly and next note restores its patch', () => {
  const commands = [];
  const worker = createWorkerChip({port: {postMessage: batch => commands.push(...batch)}, capabilities: {chip: 'ym2612', fmChannels: 6}});
  worker.fm.setOperator(0, 0, {tl: 22});
  worker.stop();
  assert.equal(commands.filter(c => c.type === 'write' && c.register >= 0x40 && c.register <= 0x4e && c.value === 127).length, 24);
  commands.length = 0;
  worker.fm.noteOn(0, 4, 553);
  assert.ok(commands.some(c => c.register === 0x40 && c.value === 22));
});

test('selected YM2608 exposes full sections and preserves seeded register shadows and raw reset', () => {
  const commands = [], events = [];
  const synth = new YM2608Synth({transport: {write() {}}});
  synth.write(0, 7, 0xc1); synth.write(0, 8, 11); synth.write(0, 0x18, 0xc5); synth.write(1, 1, 0xc2);
  const state = {...synth.getState(), clock: 7987200, ssg: {registers: synth.ssg.registers},
    rhythm: {levels: synth.rhythm.levels}, adpcm: {registers: synth.adpcm.registers}};
  const worker = createWorkerChip({port: {postMessage: batch => commands.push(...batch)},
    capabilities: {chip: 'ym2608', fmChannels: 6}, state, observe: event => events.push(event)});
  assert.equal(commands.length, 0, 'attaching preserves the running chip');
  assert.equal(worker.raw.ssg.clock, state.clock / 4); assert.equal(worker.raw.adpcm.clock, state.clock);
  worker.ssg.setMixer(1, {tone: true, noise: false});
  worker.ssg.keyOn(0);
  worker.rhythm.setVoice('bassDrum', {volume: 9});
  worker.adpcm.setPan(true, false);
  assert.deepEqual(commands, [
    {type: 'write', port: 0, register: 7, value: 0xd1},
    {type: 'write', port: 0, register: 7, value: 0xd0},
    {type: 'write', port: 0, register: 8, value: 11},
    {type: 'write', port: 0, register: 0x18, value: 0xc9},
    {type: 'write', port: 1, register: 1, value: 0x82},
  ]);
  assert.deepEqual(events.filter(event => event.method === 'write').map(event => event.args), commands.map(({port, register, value}) => [port, register, value]));
  worker.fm.reset();
  assert.equal(worker.raw.ssg.registers[7], 0); assert.equal(worker.raw.rhythm.levels[0], 0);
  assert.equal(worker.raw.adpcm.registers[1], 0); assert.equal(worker.raw.adpcm.registers[12], 255);
  assert.deepEqual(commands.at(-1), {type: 'write', port: 0, register: 0x29, value: 0x9f});
});

test('YM2608 memory/ROM uploads use typed acknowledgements and Stop rejects both outstanding requests', async () => {
  const commands = [], observations = [];
  const port = {postMessage: batch => commands.push(...batch)};
  const worker = createWorkerChip({port, capabilities: {chip: 'ym2608', fmChannels: 6}, observe: event => observations.push(event)});
  const memory = worker.adpcm.loadMemory(new Uint8Array(32), 64), memoryCommand = commands.at(-1);
  port.onmessage({data: {type: 'rhythm-rom-loaded', id: memoryCommand.id, error: 'wrong response type'}});
  port.onmessage({data: {type: 'adpcm-memory-loaded', id: memoryCommand.id}}); await memory;
  assert.equal(memoryCommand.type, 'loadAdpcmMemory'); assert.equal(memoryCommand.address, 64);
  const rom = worker.rhythm.loadRom(new ArrayBuffer(8192)), romCommand = commands.at(-1);
  assert.ok(romCommand.bytes instanceof Uint8Array);
  port.onmessage({data: {type: 'rhythm-rom-loaded', id: romCommand.id, error: 'ROM rejected'}});
  await assert.rejects(rom, /ROM rejected/);
  assert.equal(observations.length, 0, 'sample payloads never pass through Main observers');
  const pendingMemory = assert.rejects(worker.adpcm.loadMemory(new Uint8Array(32)), /Run stopped/);
  const pendingRom = assert.rejects(worker.rhythm.loadRom(new Uint8Array(8192)), /Run stopped/);
  worker.ssg.setVolume(0, 12); worker.rhythm.keyOn('snare'); worker.adpcm.keyOn();
  commands.length = 0; worker.stop(); await Promise.all([pendingMemory, pendingRom]);
  for (let register = 8; register <= 10; register++) assert.ok(commands.some(c => c.port === 0 && c.register === register && c.value === 0));
  assert.ok(commands.some(c => c.port === 0 && c.register === 0x10 && c.value === 0xbf));
  assert.ok(commands.some(c => c.port === 1 && c.register === 0 && c.value === 1));
  await assert.rejects(worker.adpcm.loadMemory(new Uint8Array(32)), /Run stopped/);
  worker.resume();
  const next = worker.adpcm.loadMemory(new Uint8Array(32)), nextCommand = commands.at(-1);
  port.onmessage({data: {type: 'adpcm-memory-loaded', id: nextCommand.id}}); await next;
});

test('selected YM2608 clock acknowledgements update both SSG pitch and ADPCM playback rates', async () => {
  const commands = [], port = {postMessage: batch => commands.push(...batch)};
  const worker = createWorkerChip({port, capabilities: {chip: 'ym2608', fmChannels: 6}});
  const pending = worker.fm.setClock(4000000), command = commands.at(-1);
  assert.equal(worker.raw.ssg.clock, 2000000);
  port.onmessage({data: {type: 'chip-clock-result', id: command.id}}); await pending;
  assert.equal(worker.raw.ssg.clock, 1000000); assert.equal(worker.raw.adpcm.clock, 4000000);
  worker.ssg.setFrequency(0, 440);
  const period = commands.at(-2).value | commands.at(-1).value << 8;
  assert.equal(period, Math.round(1000000 / (16 * 440)));
  worker.adpcm.setPlaybackRate(8000);
  assert.equal(worker.raw.adpcm.registers[9] | worker.raw.adpcm.registers[10] << 8, Math.round(8000 * 144 * 65536 / 4000000));
});

test('primary OPNA transport acknowledges ROM uploads and cancels pending loads without closing the reusable port', async () => {
  let receive;
  const commands = [], port = {postMessage: command => commands.push(command),
    addEventListener(_type, listener) {receive = listener;}, removeEventListener() {}};
  const transport = new OPNWorkletTransport(port, {chipName: 'YM2608', portCount: 2});
  const first = transport.loadRhythmRom(new Uint8Array(8192)), command = commands.at(-1);
  receive({data: {type: 'adpcm-memory-loaded', id: command.id, error: 'wrong response type'}});
  assert.equal(transport.memoryRequests.size, 1);
  receive({data: {type: 'rhythm-rom-loaded', id: command.id}}); await first;
  const memory = assert.rejects(transport.loadAdpcmMemory(new Uint8Array(32)), /Run stopped/);
  const rom = assert.rejects(transport.loadRhythmRom(new Uint8Array(8192)), /Run stopped/);
  transport.cancelPending(); await Promise.all([memory, rom]);
  assert.equal(transport.disposed, false);
  const next = transport.loadRhythmRom(new Uint8Array(8192)), last = commands.at(-1);
  receive({data: {type: 'rhythm-rom-loaded', id: last.id}}); await next;
  transport.dispose();
});

test('selected OPNA Stop aborts delayed sample decoding through resume before any late register or memory write', async () => {
  const commands = [], port = {postMessage: batch => commands.push(...batch)};
  const worker = createWorkerChip({port, capabilities: {chip: 'ym2608', fmChannels: 6}});
  let complete;
  const pending = worker.adpcm.loadSample(new ArrayBuffer(1), {decodeAudio: () => new Promise(resolve => {complete = resolve;})});
  const rejected = assert.rejects(pending, error => error.name === 'AbortError' && /Run stopped/.test(error.message));
  worker.stop(); worker.resume(); commands.length = 0;
  complete({channels: [new Float32Array(64)], sampleRate: 8000}); await rejected;
  assert.deepEqual(commands, [], 'a prior Run cannot configure or upload samples into the resumed chip');
  const abort = new AbortController();
  const callerCanceled = worker.adpcm.loadSample(new ArrayBuffer(1), {signal: abort.signal, decodeAudio: () => new Promise(resolve => {complete = resolve;})});
  const callerRejected = assert.rejects(callerCanceled, /caller canceled/);
  abort.abort(new Error('caller canceled'));
  complete({channels: [new Float32Array(64)], sampleRate: 8000}); await callerRejected;
  assert.deepEqual(commands, []);
});

test('selected OPNA prep port errors reject returned promises and release their pending entries', async () => {
  const worker = createWorkerChip({port: {postMessage() {throw Error('port closed');}}, capabilities: {chip: 'ym2608', fmChannels: 6}});
  await assert.rejects(worker.adpcm.loadMemory(new Uint8Array(32)), /port closed/);
  await assert.rejects(worker.rhythm.loadRom(new Uint8Array(8192)), /port closed/);
});

test('selected OPNA preserves remembered SSG levels across Main snapshots, Stop and explicit raw volume changes', () => {
  const commands = [], main = new YM2608Synth({transport: {write() {}}});
  main.ssg.setVolume(0, 12);
  const snapshot = () => ({...main.getState(), ssg: main.ssg._getState()});
  const worker = createWorkerChip({port: {postMessage: batch => commands.push(...batch)},
    capabilities: {chip: 'ym2608', fmChannels: 6}, state: snapshot(), observe: ({method, args}) => {
      if (method === 'write') main.write(...args);
      if (method === 'ssgState') main.ssg._adoptState(args[0]);
      if (method === 'reset') main.reset();
    }});
  assert.equal(worker.ssg._getState, undefined, 'internal state helpers stay out of script facades');
  worker.ssg.keyOff(0);
  assert.equal(main.ssg.registers[8], 0); assert.equal(main.ssg._getState().levels[0], 12);
  worker.adoptState(snapshot()); worker.ssg.keyOn(0);
  assert.deepEqual(commands.at(-1), {type: 'write', port: 0, register: 8, value: 12});
  worker.stop();
  assert.equal(main.ssg._getState().levels[0], 12, 'Stop silence keeps the configured SSG patch');
  worker.resume(); worker.adoptState(snapshot()); worker.ssg.keyOn(0);
  assert.equal(commands.at(-1).value, 12);
  worker.fm.write(0, 8, 3); worker.ssg.keyOff(0); worker.adoptState(snapshot()); worker.ssg.keyOn(0);
  assert.equal(commands.at(-1).value, 3, 'an explicit raw volume write replaces the remembered level');
  worker.fm.reset(); worker.adoptState(snapshot()); worker.ssg.keyOn(0);
  assert.equal(commands.at(-1).value, 0, 'whole-chip reset still clears the SSG patch');
});
