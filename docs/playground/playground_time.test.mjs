import test from "node:test";
import assert from "node:assert/strict";

import { createPitchFromMidi } from "../synth/synth_keyboard.js";
import {
  createPlaygroundMusic,
  lerp,
} from "./playground_music.js";
import { createPlaygroundClock } from "./playground_clock.js";
import {
  createCompressorFX,
  createDistortionFX,
  createGateFX,
  createSlicerFX,
} from "../js/megasynth_fx.js";

const NOTE_TO_SEMITONE = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const SCALE_INTERVALS = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

function createMusicApi() {
  return createPlaygroundMusic({
    noteToSemitone: NOTE_TO_SEMITONE,
    scaleIntervals: SCALE_INTERVALS,
    createPitchFromMidi,
    pitchReference: {
      referenceMidi: 62,
      referenceBlock: 4,
      referenceFnum: 553,
    },
    synth: () => ({
      setPreset() {},
      noteOn() {},
      noteOff() {},
    }),
    presets: {},
    activeNotes: new Set(),
    sleep: async () => {},
    getCurrentLoopContext: () => null,
  });
}

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
  }

  setValueAtTime(value) {
    this.value = value;
  }

  linearRampToValueAtTime(value) {
    this.value = value;
  }

  cancelScheduledValues() {}
}

class FakeAudioNode {
  constructor() {
    this.connections = [];
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeGainNode extends FakeAudioNode {
  constructor() {
    super();
    this.gain = new FakeAudioParam(1);
  }
}

class FakeOscillatorNode extends FakeAudioNode {
  constructor() {
    super();
    this.frequency = new FakeAudioParam(0);
    this.type = "sine";
    this.started = false;
    this.stopped = false;
  }

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
  }
}

class FakeAudioBuffer {
  constructor(channelCount, length) {
    this.channels = Array.from(
      { length: channelCount },
      () => new Float32Array(length)
    );
  }

  getChannelData(channel) {
    return this.channels[channel];
  }
}

class FakeConvolverNode extends FakeAudioNode {
  constructor() {
    super();
    this.buffer = null;
  }
}

class FakeWaveShaperNode extends FakeAudioNode {
  constructor() {
    super();
    this.curve = null;
    this.oversample = "none";
  }
}

class FakeBiquadFilterNode extends FakeAudioNode {
  constructor() {
    super();
    this.type = "lowpass";
    this.frequency = new FakeAudioParam(0);
    this.gain = new FakeAudioParam(0);
    this.Q = new FakeAudioParam(0);
  }
}

class FakeDelayNode extends FakeAudioNode {
  constructor() {
    super();
    this.delayTime = new FakeAudioParam(0);
  }
}

class FakeDynamicsCompressorNode extends FakeAudioNode {
  constructor() {
    super();
    this.threshold = new FakeAudioParam(0);
    this.knee = new FakeAudioParam(0);
    this.ratio = new FakeAudioParam(1);
    this.attack = new FakeAudioParam(0);
    this.release = new FakeAudioParam(0);
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.lastOscillator = null;
  }

  createGain() {
    return new FakeGainNode();
  }

  createOscillator() {
    this.lastOscillator =
      new FakeOscillatorNode();
    return this.lastOscillator;
  }

  createConvolver() {
    return new FakeConvolverNode();
  }

  createWaveShaper() {
    return new FakeWaveShaperNode();
  }

  createBiquadFilter() {
    return new FakeBiquadFilterNode();
  }

  createDelay() {
    return new FakeDelayNode();
  }

  createDynamicsCompressor() {
    return new FakeDynamicsCompressorNode();
  }

  createBuffer(channelCount, length) {
    return new FakeAudioBuffer(
      channelCount,
      length
    );
  }
}

test("chord builds a minor triad", () => {
  const music = createMusicApi();
  assert.deepEqual(
    music.chord("B2", "minor"),
    ["B2", "D3", "F#3"]
  );
});

test("lerp interpolates linearly", () => {
  assert.equal(lerp(10, 20, 0), 10);
  assert.equal(lerp(10, 20, 0.5), 15);
  assert.equal(lerp(10, 20, 1), 20);
});

test("noteLerp crosses a YM2612 block boundary through midi space", () => {
  const music = createMusicApi();
  const from = music.noteToBlockFnum("B2");
  const to = music.noteToBlockFnum("C#3");
  const mid = music.noteLerp("B2", "C#3", 0.5);
  const expected = createPitchFromMidi(48, {
    referenceMidi: 62,
    referenceBlock: 4,
    referenceFnum: 553,
  });

  assert.notEqual(from.block, to.block);
  assert.deepEqual(mid, expected);
});

test("tween reaches 0 and 1 and completes", async () => {
  let currentTime = 0;
  const runtime = {
    bpm: 120,
    clockStartTime: null,
  };
  const clock = createPlaygroundClock({
    runtime,
    getAudioContext: () => ({
      currentTime,
    }),
    getCurrentRunToken: () => 1,
    getCurrentLoopContext: () => null,
    setCurrentLoopContext() {},
    setTimer(fn, delayMs) {
      currentTime += delayMs / 1000;
      fn();
      return 0;
    },
  });

  const values = [];
  await clock.tween(0.2, (t) => {
    values.push(t);
  });

  assert.equal(values[0], 0);
  assert.equal(values.at(-1), 1);
  assert.ok(values.length >= 2);
});

test("slicer constructs, updates BPM-derived timing, and disposes cleanly", () => {
  const audioContext =
    new FakeAudioContext();
  const intervalCallbacks =
    new Map();
  let nextIntervalId = 1;
  const originalWindow =
    globalThis.window;
  let beatSeconds = 0.5;

  globalThis.window = {
    setInterval(fn) {
      const id =
        nextIntervalId++;
      intervalCallbacks.set(
        id,
        fn
      );
      return id;
    },
    clearInterval(id) {
      intervalCallbacks.delete(id);
    },
  };

  try {
    const slicer =
      createSlicerFX(
        audioContext,
        {
          phase: 0.25,
          mix: 1,
          getBeatSeconds: () =>
            beatSeconds,
        }
      );

    assert.equal(
      slicer.type,
      "slicer"
    );
    assert.equal(
      slicer.phase.get(),
      0.25
    );
    assert.equal(
      slicer.mix.get(),
      1
    );

    const target =
      new FakeGainNode();
    assert.equal(
      slicer.connect(target),
      target
    );

    assert.equal(
      audioContext.lastOscillator.frequency.value,
      8
    );

    beatSeconds = 1;
    for (const callback of intervalCallbacks.values()) {
      callback();
    }

    assert.equal(
      audioContext.lastOscillator.frequency.value,
      4
    );

    slicer.phase.set(0.125);
    assert.equal(
      slicer.phase.get(),
      0.125
    );
    assert.equal(
      audioContext.lastOscillator.frequency.value,
      8
    );

    slicer.dispose();
    assert.equal(
      intervalCallbacks.size,
      0
    );
  } finally {
    globalThis.window =
      originalWindow;
  }
});

test("distortion, compressor, and gate construct with readable controls", () => {
  const audioContext =
    new FakeAudioContext();

  const distortion =
    createDistortionFX(
      audioContext,
      {
        drive: 2.4,
        mix: 0.8,
        output: 0.9,
      }
    );
  const compressor =
    createCompressorFX(
      audioContext,
      {
        threshold: -24,
        ratio: 8,
        output: 1.1,
      }
    );
  const gate = createGateFX(
    audioContext,
    {
      threshold: 0.05,
      floor: 0.02,
      mix: 1,
    }
  );

  assert.equal(
    distortion.type,
    "distortion"
  );
  assert.equal(
    compressor.type,
    "compressor"
  );
  assert.equal(gate.type, "gate");

  assert.equal(
    distortion.drive.get(),
    2.4
  );
  assert.equal(
    distortion.mix.get(),
    0.8
  );
  assert.equal(
    compressor.threshold.get(),
    -24
  );
  assert.equal(
    compressor.ratio.get(),
    8
  );
  assert.equal(
    gate.threshold.get(),
    0.05
  );
  assert.equal(
    gate.floor.get(),
    0.02
  );
});
