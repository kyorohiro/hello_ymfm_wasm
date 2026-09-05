import test from "node:test";
import assert from "node:assert/strict";

import { createPlaygroundClock } from "../js/playground_clock.js";

function sharedClockFixture() {
  let now = 0;
  let current = null;
  let serial = 0;
  const timers = new Map();
  const tasks = [];
  const clock = createPlaygroundClock({
    runtime: { sampleClockStartTime: 0 },
    getAudioContext: () => ({ currentTime: now }),
    getCurrentRunToken: () => 1,
    getCurrentLoopContext: () => current,
    setCurrentLoopContext: (value) => { current = value; },
    setTimer(fn, ms) { const id = ++serial; timers.set(id, { fn, at: now + ms / 1000 }); return id; },
    clearTimer(id) { timers.delete(id); },
    createTaskChannel() {
      const port1 = { onmessage: null, close() {} };
      return { port1, port2: { postMessage() { tasks.push(() => port1.onmessage()); }, close() {} } };
    },
  });
  return {
    clock, timers, tasks,
    setLoop(value) { current = value; },
    getLoop() { return current; },
    async fire(late = 0) {
      const [id, timer] = [...timers][0];
      timers.delete(id); now = Math.max(now, timer.at) + late;
      timer.fn();
      // A task boundary drains the entire async/await chain, not just one microtask.
      await new Promise((resolve) => setImmediate(resolve));
    },
    async dispatch() {
      tasks.shift()();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test("one timer serves simultaneous loops without mixing their await contexts", async () => {
  const f = sharedClockFixture();
  const loops = Array.from({ length: 6 }, (_, name) => ({ name, runToken: 1, stopped: false }));
  const resumed = [];
  const waits = loops.map((loop) => {
    f.setLoop(loop);
    return (async () => {
      await f.clock.sleepSamples(3);
      resumed.push(f.getLoop().name);
      await f.clock.sleepSamples(3);
      resumed.push(f.getLoop().name);
    })();
  });
  assert.equal(f.timers.size, 1);
  await f.fire(0.01);
  while (f.tasks.length || f.timers.size) {
    assert.ok(f.timers.size <= 1);
    if (f.tasks.length) await f.dispatch(); else await f.fire();
  }
  await Promise.all(waits);
  assert.deepEqual(resumed, [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
  for (const loop of loops) assert.equal(loop.sampleCursorSeconds, 6 / 44100);
});

test("an earlier deadline replaces the timer and cancellation wakes only its owner", async () => {
  const f = sharedClockFixture();
  const slow = { runToken: 1, stopped: false };
  const fast = { runToken: 1, stopped: false };
  f.setLoop(slow);
  const a = f.clock.sleep(60).catch((error) => error.message);
  f.setLoop(fast);
  let done = false;
  const b = f.clock.sleep(1).then(() => { done = true; });
  assert.equal(f.timers.size, 1);
  await f.fire(); await b;
  assert.equal(done, true);
  slow.stopped = true; slow.runToken++;
  f.clock.cancelWaits(slow);
  await f.fire();
  assert.equal(await a, "Run stopped");
  assert.equal(f.timers.size, 0);
});

test(
  "sleepSamples catches up after a late timer instead of accumulating drift",
  async () => {
    let now = 0;
    const scheduledDelays = [];
    const loopState = {
      runToken: 1,
      stopped: false,
    };
    const runtime = {
      sampleClockStartTime: null,
    };
    const clock = createPlaygroundClock({
      runtime,
      getAudioContext: () => ({ currentTime: now }),
      getCurrentRunToken: () => 1,
      getCurrentLoopContext: () => loopState,
      setCurrentLoopContext() {},
      setTimer(fn, delayMs) {
        scheduledDelays.push(delayMs);
        now += delayMs / 1000 + 0.004;
        fn();
      },
    });

    await clock.sleepSamples(735);
    await clock.sleepSamples(735);

    assert.equal(scheduledDelays.length, 2);
    assert.ok(scheduledDelays[0] > 16);
    assert.ok(scheduledDelays[1] < 13);
  }
);
