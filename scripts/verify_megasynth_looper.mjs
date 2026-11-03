import { MegaSynthLooper } from "../tetorica_src/runtime/megasynth_looper.js";

function createFakeClock() {
  let currentTime = 0;
  let nextTimerId = 1;
  const timers = new Map();

  return {
    now() {
      return currentTime;
    },
    setTimer(fn, delayMs) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, {
        at: currentTime + delayMs / 1000,
        fn,
      });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(seconds) {
      currentTime += seconds;
      let ran = true;
      while (ran) {
        ran = false;
        const ready = [...timers.entries()]
          .filter(([, timer]) => timer.at <= currentTime)
          .sort((a, b) => a[1].at - b[1].at);
        for (const [id, timer] of ready) {
          timers.delete(id);
          timer.fn();
          ran = true;
        }
      }
    },
  };
}

function createFakeSynth(callLog) {
  return {
    async start() {
      callLog.push(["start"]);
    },
    fm: {
      noteOn(channel, block, fnum) {
        callLog.push(["noteOn", channel, block, fnum]);
      },
      noteOff(channel) {
        callLog.push(["noteOff", channel]);
      },
    },
  };
}

const callLog = [];
const liveLog = [];
const playbackLog = [];
const fakeClock = createFakeClock();
const synth = createFakeSynth(callLog);

const liveTarget = {
  noteOn(channel, block, fnum) {
    liveLog.push(["noteOn", channel, block, fnum]);
  },
  noteOff(channel) {
    liveLog.push(["noteOff", channel]);
  },
};

const playbackTarget = {
  noteOn(channel, block, fnum) {
    playbackLog.push(["noteOn", channel, block, fnum]);
  },
  noteOff(channel) {
    playbackLog.push(["noteOff", channel]);
  },
};

const stateChanges = [];

const looper = new MegaSynthLooper({
  synth,
  now: () => fakeClock.now(),
  setTimer: (fn, delayMs) => fakeClock.setTimer(fn, delayMs),
  clearTimer: (id) => fakeClock.clearTimer(id),
  liveTarget,
  playbackTarget,
  onStateChange(detail) {
    stateChanges.push(detail);
  },
});

await looper.start();
await looper.startRecording();
looper.noteOn(0, 4, 553);
fakeClock.advance(0.25);
looper.noteOff(0);
fakeClock.advance(0.75);
const unit1 =
  await looper.finishRecording();

if (!unit1 || unit1.events.length !== 2) {
  throw new Error("Expected first unit with two events");
}

if (Math.abs(looper.loopLength - 1.0) > 0.0001) {
  throw new Error(`Expected loop length near 1.0, got ${looper.loopLength}`);
}

fakeClock.advance(0.4);
await looper.startRecording();
looper.noteOn(0, 5, 660);
fakeClock.advance(0.1);
looper.noteOff(0);
const playbackCountBeforeAutoStop =
  playbackLog.length;
fakeClock.advance(0.5);
await Promise.resolve();

const autoStopEvent = stateChanges.find(
  (detail) =>
    detail.reason ===
      "record-finish" &&
    detail.auto === true
);

if (!autoStopEvent?.unit) {
  throw new Error(
    "Expected second unit to stop automatically at the loop end"
  );
}

const playbackCountAfterAutoStop =
  playbackLog.length;

if (
  playbackCountAfterAutoStop <=
  playbackCountBeforeAutoStop
) {
  throw new Error(
    "Expected second unit to start replaying before the next full loop cycle"
  );
}

const unit2 = autoStopEvent.unit;

if (!unit2 || unit2.events.length !== 2) {
  throw new Error("Expected second unit with two events");
}

const units = looper.getUnits();
if (units.length !== 2) {
  throw new Error(`Expected 2 units, got ${units.length}`);
}

const unit1Map = units[0].playbackChannelMap ?? {};
const unit2Map = units[1].playbackChannelMap ?? {};
if (unit1Map["0"] !== 0) {
  throw new Error(`Expected unit1 source channel 0 to stay on 0, got ${unit1Map["0"]}`);
}
if (unit2Map["0"] !== 1) {
  throw new Error(`Expected unit2 source channel 0 to move to 1, got ${unit2Map["0"]}`);
}

const initialPlaybackCalls =
  playbackLog.length;
fakeClock.advance(1.0);

if (
  playbackLog.length <=
  initialPlaybackCalls
) {
  throw new Error("Expected loop playback to replay events");
}

const replayNoteOns = playbackLog.filter(
  (entry) => entry[0] === "noteOn"
);
const replayChannels = replayNoteOns.map(
  (entry) => entry[1]
);

if (!replayChannels.includes(0) || !replayChannels.includes(1)) {
  throw new Error(
    `Expected playback noteOn on channels 0 and 1, got ${replayChannels.join(",")}`
  );
}

const undoneUnit =
  await looper.undo();

if (!undoneUnit || undoneUnit.id !== unit2.id) {
  throw new Error(
    "Expected undo() to remove the most recent unit"
  );
}

if (looper.getState().unitCount !== 1) {
  throw new Error(
    `Expected unit count to become 1 after undo, got ${looper.getState().unitCount}`
  );
}

console.log("ok: MegaSynthLooper basic record/playback flow");
