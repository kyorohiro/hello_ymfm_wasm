import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioScheduler } from '../../web/playground_audio_scheduler.js';

test('shared lookahead preserves absolute time, ordering, and cancels pending work', () => {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const sent = [];
  const queue = createAudioScheduler({
    now: () => now,
    send: entries => sent.push(...entries),
    setTimer: fn => { const id = ++nextId; timers.set(id, fn); return id; },
    clearTimer: id => timers.delete(id),
  });
  queue.enqueue([{ time: 1, value: 1 }, { time: 2, value: 3 }]);
  queue.enqueue([{ time: 1, value: 2 }]);
  assert.equal(timers.size, 1);
  assert.equal(sent.length, 0);
  now = 0.8;
  [...timers.values()][0]();
  assert.deepEqual(sent, [{ time: 1, value: 1 }, { time: 1, value: 2 }]);
  assert.equal(timers.size, 1);
  queue.clear();
  assert.equal(timers.size, 0);
  assert.equal(sent.length, 2);
});

test('timing changes refill horizon and invalid settings are atomic', () => {
  const sent = [];
  const queue = createAudioScheduler({ now: () => 0, send: e => sent.push(...e), setTimer: () => 1, clearTimer: () => {} });
  queue.enqueue([{ time: 0.4 }]);
  queue.setTiming({ lookaheadSeconds: 0.5, schedulerIntervalMs: 20 });
  assert.deepEqual(sent, [{ time: 0.4 }]);
  assert.throws(() => queue.setTiming({ lookaheadSeconds: NaN }));
  assert.throws(() => queue.setTiming({ schedulerIntervalMs: 600 }));
  assert.deepEqual(queue.getTiming(), { lookaheadSeconds: 0.5, schedulerIntervalMs: 20 });
});
