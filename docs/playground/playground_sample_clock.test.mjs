import test from "node:test";
import assert from "node:assert/strict";

import { createPlaygroundClock } from "../js/playground_clock.js";
import { createPlaygroundLive } from "../js/playground_live.js";

function sharedClockFixture({ origin = 0, start = 0 } = {}) {
  let now = start;
  let current = null;
  let serial = 0;
  const timers = new Map();
  const tasks = [];
  const runtime = { bpm: 120, clockStartTime: null, sampleClockStartTime: origin,
    livePrepared: new Map(), liveLoops: new Map(), liveCleanupHooks: new Map() };
  const clock = createPlaygroundClock({
    runtime,
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
    clock, runtime, timers, tasks,
    now: () => now,
    setTime(value) { now = value; },
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

function liveClockFixture(options) {
  const f = sharedClockFixture(options);
  const errors = [];
  const live = createPlaygroundLive({
    runtime: f.runtime,
    megaDrive: { clearFXChain: () => [] },
    preparedFxUnits: new WeakSet(),
    currentBeat: f.clock.currentBeat,
    currentSampleCursor: f.clock.currentSampleCursor,
    getCurrentLoopContext: f.getLoop,
    setCurrentLoopContext: f.setLoop,
    cancelWaits: f.clock.cancelWaits,
    logLine: line => errors.push(line),
    setStatus() {},
  });
  return { ...f, live, errors };
}

test("Main sample loops resume at fresh deadlines after another file replaces them", async () => {
  const f = liveClockFixture({ origin: null, start: 10 });
  const events = [];
  f.live.commitLiveLoops(new Map([["vgm", async () => {
    await f.clock.sleepSamples(441);
    events.push(["old", f.now()]);
    await f.clock.sleepSamples(441000);
    events.push(["cancelled", f.now()]);
  }]]));
  await f.fire();
  assert.deepEqual(events, [["old", 10.01]]);
  f.live.commitLiveLoops(new Map([["other-file", async () => f.clock.sleep(60)]]));
  while (f.tasks.length) await f.dispatch();
  f.setTime(20);
  f.live.commitLiveLoops(new Map([["vgm", async () => {
    for (let i = 0; i < 4; i++) {
      await f.clock.sleepSamples(441);
      events.push(["new", f.now()]);
    }
    f.live.stopLoop("vgm");
  }]]));
  // Only cancellations are immediately runnable. New VGM events must not be
  // compressed into catch-up tasks against the old 10-second origin.
  while (f.tasks.length) await f.dispatch();
  assert.deepEqual(events, [["old", 10.01]]);
  assert.equal(f.runtime.sampleClockStartTime, 10);
  for (let i = 1; i <= 4; i++) {
    await f.fire();
    assert.equal(events.length, i + 1);
    assert.ok(Math.abs(events.at(-1)[1] - (20 + i * .01)) < 1e-10);
  }
  assert.deepEqual(events.map(event => event[0]), ["old", "new", "new", "new", "new"]);
  assert.deepEqual(f.errors, []);
});

test("Main sibling sample loops share one commit position despite setup work", async () => {
  const f = liveClockFixture({ origin: 10, start: 20 });
  const events = [];
  f.live.commitLiveLoops(new Map(["first", "second"].map(name => [name, async () => {
    const wait = f.clock.sleepSamples(441);
    if (name === "first") f.setTime(20.003); // Synchronous setup before its sibling starts.
    await wait;
    events.push([name, f.now()]);
    f.live.stopLoop(name);
  }])));
  assert.equal(f.tasks.length, 0);
  assert.equal(f.timers.size, 1);
  await f.fire();
  while (f.tasks.length) await f.dispatch();
  assert.deepEqual(events.map(event => event[0]), ["first", "second"]);
  for (const [, at] of events) assert.ok(Math.abs(at - 20.01) < 1e-10);
  assert.deepEqual(f.errors, []);
});

test("Main same-name replacement retains its sample cursor and completes the old iteration", async () => {
  const f = liveClockFixture({ origin: 10, start: 20 });
  const events = [];
  f.live.commitLiveLoops(new Map([["vgm", async () => {
    events.push(["old-start", f.now()]);
    await f.clock.sleepSamples(4410);
    events.push(["old-middle", f.now()]);
    await f.clock.sleepSamples(4410);
    events.push(["old-end", f.now()]);
  }]]));
  const oldState = f.runtime.liveLoops.get("vgm");
  f.setTime(20.025);
  f.live.commitLiveLoops(new Map([["vgm", async () => {
    events.push(["new-start", f.now()]);
    await f.clock.sleepSamples(441);
    events.push(["new-end", f.now()]);
    f.live.stopLoop("vgm");
  }]]));
  assert.equal(f.runtime.liveLoops.get("vgm"), oldState);
  assert.ok(Math.abs(oldState.sampleCursorSeconds - 10.1) < 1e-10);
  assert.deepEqual(events.map(event => event[0]), ["old-start"]);
  await f.fire();
  assert.deepEqual(events.map(event => event[0]), ["old-start", "old-middle"]);
  await f.fire();
  assert.deepEqual(events.map(event => event[0]), ["old-start", "old-middle", "old-end", "new-start"]);
  await f.fire();
  assert.ok(Math.abs(events.at(-1)[1] - 20.21) < 1e-10);
  assert.deepEqual(f.errors, []);
});

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
  assert.equal(f.timers.size, 0);
  await f.dispatch();
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
