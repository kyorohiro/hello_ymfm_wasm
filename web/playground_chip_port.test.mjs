import test from 'node:test';
import assert from 'node:assert/strict';
import {createChipPortReceiver} from './playground_chip_port.js';
import {createWorkerChip} from './playground_worker_chip.js';
import {YM2612Synth} from './ym2612synth.js';
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
