import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceQueue, createPerformanceChipOwnership} from './playground_performance_queue.js';

function fixture(options = {}) {
  const applied = [], replies = [];
  let frame = 0;
  const queue = createPerformanceQueue({apply: (command, _reply, at) => applied.push([command, at]),
    nowFrame: () => frame, sampleRate: 48000, ...options});
  const receive = data => queue.receive(data, reply => replies.push(reply));
  receive({type: 'performance-start', session: 1, id: 100});
  return {queue, receive, applied, replies, setFrame: value => {frame = value;}};
}
const batch = (time, commands, owner = 'loop:1', session = 1) => ({performance: {session, owner, time}, commands});
const command = value => ({type: 'write', value});

for (const rate of [44100, 48000, 96000]) {
  test(`absolute ${rate} Hz frame boundaries preserve full ordered command batches`, () => {
    const f = fixture({sampleRate: rate});
    f.receive(batch(73 / rate, [command('high'), command('low'), command('keyOn')]));
    f.receive(batch(73 / rate, [command('next')]));
    f.receive(batch(31 / rate, [command('earlier')]));
    f.queue.advance(30); assert.equal(f.applied.length, 0);
    f.queue.advance(31); assert.deepEqual(f.applied, [[command('earlier'), 31]]);
    f.queue.advance(72); assert.equal(f.applied.length, 1);
    f.queue.advance(73);
    assert.deepEqual(f.applied.slice(1), ['high', 'low', 'keyOn', 'next'].map(value => [command(value), 73]));
    assert.equal(f.queue.nextFrame(), Infinity);
    assert.equal(f.queue.getStats().queuedCommands, 0);
  });
}

test('stop rejects late old traffic and stale start/stop cannot disturb the next session', () => {
  const f = fixture();
  f.receive(batch(1, [command(1)]));
  f.receive({type: 'performance-stop', session: 1});
  f.receive(batch(1, [command(2)]));
  f.receive({type: 'performance-start', session: 1});
  assert.match(f.replies.at(-1).error, /expired/);
  f.receive({type: 'performance-start', session: 2});
  f.receive(batch(1, [command(3)], 'loop:2', 2));
  f.receive({type: 'performance-stop', session: 1});
  f.receive(batch(1, [command(4)], 'loop:1', 1));
  f.queue.advance(48000);
  assert.deepEqual(f.applied, [[command(3), 48000]]);
  assert.equal(f.queue.getStats().activeSession, 2);
});

test('canceling a loop discards only its future events and rejects its late batches', () => {
  const discarded = [];
  const f = fixture({onDiscard: (c, p) => discarded.push([c.value, p.owner])});
  f.receive(batch(1, [command(1)], 'old'));
  f.receive(batch(1, [command(2)], 'retained'));
  f.receive({type: 'performance-cancel-owner', session: 1, owner: 'old'});
  f.receive(batch(1, [command(3)], 'old'));
  f.queue.advance(48000);
  assert.deepEqual(f.applied, [[command(2), 48000]]);
  assert.deepEqual(discarded, [[1, 'old']]);
});

test('all validation and capacity checks finish before preparation can reserve or acknowledge anything', () => {
  const prepared = [];
  const f = fixture({maxCommands: 2, validate: c => {if (c.value === 'bad') throw new Error('invalid register');},
    prepare: c => {prepared.push(c.value); return c;}});
  f.receive(batch(1, [command(1), command('bad')]));
  assert.deepEqual(prepared, []);
  f.receive(batch(1, [command(1), command(2), command(3)]));
  assert.deepEqual(prepared, []);
  f.receive(batch(1, [command(1), command(2)]));
  f.receive(batch(1, [command(3)]));
  assert.deepEqual(prepared, [1, 2]);
  assert.equal(f.queue.getStats().queuedCommands, 2);
});

test('preparation acknowledges accepted RPCs immediately and defers their transformed command', () => {
  const discarded = [];
  const f = fixture({prepare: (c, reply) => {reply({id: c.id}); return {...c, id: undefined};},
    onDiscard: c => discarded.push(c.value)});
  f.receive(batch(1, [{method: 'setPreset', args: [], id: 3, value: 'preset'}]));
  assert.deepEqual(f.replies.at(-1), {id: 3});
  assert.equal(f.applied.length, 0);
  f.queue.advance(48000);
  assert.equal(f.applied[0][0].id, undefined);
  f.receive(batch(2, [{op: 'sample', id: 4, value: 'reserved voice'}]));
  f.queue.clear();
  assert.deepEqual(discarded, ['reserved voice']);
});

test('stale or canceled envelopes cannot reserve resources or produce success acknowledgements', () => {
  let count = 0;
  const f = fixture({prepare: c => {count++; return c;}});
  f.receive(batch(1, [command(1)], 'wrong session', 2));
  f.queue.cancelOwner('canceled');
  f.receive(batch(1, [command(2)], 'canceled'));
  assert.equal(count, 0);
  assert.equal(f.queue.getStats().queuedCommands, 0);
});

test('invalid numeric timestamps and malformed envelopes are handled without partial execution', () => {
  const f = fixture();
  for (const data of [
    batch(NaN, [command(1)]), batch(Infinity, [command(1)]), batch(-1, [command(1)]),
    batch(Number.MAX_VALUE, [command(1)]), batch(1, []), batch(1, [null]),
    batch(1, [{}]), batch(1, [command(1)], ''), batch(1, [command(1)], 'owner', 1.2),
    batch(1, [{type: 'performance-stop', session: 1}]),
  ]) assert.equal(f.receive(data), true);
  assert.equal(f.queue.nextFrame(), Infinity);
  assert.equal(f.applied.length, 0);
  assert.equal(f.receive({type: 'ordinary'}), false);
  assert.equal(f.receive([command(1)]), false);
  assert.equal(f.receive(null), false);
});

test('late batches retain insertion order and report actual lateness without changing deadlines', () => {
  const f = fixture();
  f.receive(batch(10 / 48000, [command('on')]));
  f.receive(batch(11 / 48000, [command('off')]));
  f.setFrame(20); f.queue.advance();
  assert.deepEqual(f.applied, [[command('on'), 20], [command('off'), 20]]);
  assert.equal(f.queue.getStats().lateCommands, 2);
  assert.equal(f.queue.getStats().maxLateFrames, 10);
});

test('bad command execution cannot crash rendering or prevent a subsequent key off', () => {
  const applied = [];
  const f = fixture({apply: c => {if (c.value === 'bad') throw new Error('bad command'); applied.push(c.value);}});
  f.receive(batch(0, [command('bad'), command('off')]));
  assert.doesNotThrow(() => f.queue.advance(0));
  assert.deepEqual(applied, ['off']);
  assert.match(f.replies.at(-1).error, /bad command/);
});

test('failed preparation discards earlier reserved commands and never inserts a partial batch', () => {
  const discarded = [];
  const f = fixture({prepare: c => {if (c.value === 'bad') throw new Error('reserve failed'); return c;},
    onDiscard: c => discarded.push(c.value)});
  f.receive(batch(1, [command('reserved'), command('bad')]));
  assert.deepEqual(discarded, ['reserved']);
  assert.equal(f.queue.nextFrame(), Infinity);
});

test('large out-of-order streams remain stable and bounded when owners are removed', () => {
  const f = fixture();
  for (let n = 1000; n >= 1; n--) f.receive(batch(n / 48000, [command(n)], n % 2 ? 'odd' : 'even'));
  f.queue.cancelOwner('odd'); f.queue.advance(1000);
  assert.deepEqual(f.applied.map(([c]) => c.value), Array.from({length: 500}, (_, n) => (n + 1) * 2));
  assert.equal(f.queue.getStats().discardedCommands, 500);
});

test('owner cancellation hook sees its session once after future reservations are discarded', () => {
  const events = [];
  const f = fixture({onDiscard: c => events.push(['discard', c.value]),
    onCancelOwner: (owner, session) => events.push(['cancel', owner, session])});
  f.receive(batch(1, [command(1)], 'old'));
  f.receive({type: 'performance-cancel-owner', session: 1, owner: 'old'});
  f.receive({type: 'performance-cancel-owner', session: 1, owner: 'old'});
  f.receive({type: 'performance-cancel-owner', session: 2, owner: 'other'});
  assert.deepEqual(events, [['discard', 1], ['cancel', 'old', 1]]);
});

test('stale RPCs reject immediately instead of hanging a stopped client promise', () => {
  const f = fixture();
  f.receive(batch(1, [{method: 'setPreset', id: 7}], 'stale', 2));
  assert.match(f.replies.at(-1).error, /no longer active/);
  assert.equal(f.replies.at(-1).type, 'performance-error');
});

test('primary voice ownership releases FM/PSG still owned by a removed loop, preserving replacements', () => {
  const fm = [], psg = [];
  const ownership = createPerformanceChipOwnership({writeFm: (...args) => fm.push(args), writePsg: value => psg.push(value)});
  ownership.observe({type: 'write', port: 0, register: 0x28, value: 0xf0}, {owner: 'old'});
  ownership.observe({type: 'write', port: 0, register: 0x28, value: 0xf1}, {owner: 'old'});
  ownership.observe({type: 'write', port: 0, register: 0x28, value: 0xf1}, {owner: 'new'});
  ownership.observe({type: 'psg-write', value: 0x90}, {owner: 'old'});
  ownership.observe({type: 'psg-write', value: 0x81}, {owner: 'pitch modulation'});
  ownership.observe({type: 'psg-write', value: 0x20}, {owner: 'pitch modulation'});
  ownership.observe({type: 'psg-write', value: 0xb0}, {owner: 'new'});
  ownership.cancel('old');
  assert.deepEqual(fm, [[0x28, 0, 0]]);
  assert.deepEqual(psg, [0x9f]);
  ownership.cancel('old'); assert.equal(fm.length, 1);
  ownership.observe({type: 'reset'});
  ownership.cancel('new'); assert.equal(fm.length, 1); assert.equal(psg.length, 1);
});
