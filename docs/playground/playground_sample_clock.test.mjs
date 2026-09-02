import test from "node:test";
import assert from "node:assert/strict";

import { createPlaygroundClock } from "../js/playground_clock.js";

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
