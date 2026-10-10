import {resolvePlaySeconds} from './playground_duration.js';
/**
 * @file playground_music.js
 * 実行環境: Browser / Node.js
 * 依存: 注入された runtime・音源操作・待機関数。実際の再生環境は渡すオブジェクトに依存する。
 */
import { hzToBlockFnum } from "./pitch.js";

// Shared across evaluations using the same active-note set.
const noteOwners = new WeakMap();

const CHORD_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10],
};

/**
 * Linear interpolation; t is not clamped, so values outside 0..1 extrapolate.
 * @param {number} a Starting value.
 * @param {number} b Ending value.
 * @param {number} t Interpolation fraction.
 * @returns {number}
 */
export function lerp(
  a,
  b,
  t
) {
  return (
    Number(a) +
    (Number(b) - Number(a)) *
      Number(t)
  );
}

/**
 * Create note/pitch, scale, chord and loop-local sequence helpers.
 * @param {{noteToSemitone: Record<string, number>, scaleIntervals: Record<string, number[]>,
 *   createPitchFromMidi: typeof import('./pitch.js').createPitchFromMidi,
 *   pitchReference: {referenceMidi: number, referenceBlock: number, referenceFnum: number},
 *   synth: () => import('./ym2612synth.js').YM2612Synth | null,
 *   presets: Record<string, import('./ym2612synth.js').YM2612Preset>, activeNotes: Set<number>,
 *   sleep: (seconds: number) => Promise<void>, getBpm?: () => number,
 *   getCurrentLoopContext?: () => {cycleState: Map<string, number>, cycleCallIndex: number} | null}} options Pitch reference, synth lookup, waits and sequence context.
 * @returns Music helpers; play waits for note duration and releases only the note it owns.
 */
export function createPlaygroundMusic(
  options
) {
  const {
    noteToSemitone,
    scaleIntervals,
    createPitchFromMidi,
    pitchReference,
    synth,
    presets,
    activeNotes,
    sleep,
    getCurrentLoopContext,
    getBpm = () => 120,
  } = options;
  const globalCycleState =
    new Map();

  /** @param {string} noteName Note such as C4, F#3 or Bb2.
   * @returns {number} MIDI note number. */
  function parseNoteName(noteName) {
    const match =
      /^([A-G](?:#|b)?)(-?\d+)$/.exec(
        String(noteName).trim()
      );

    if (!match) {
      throw new Error(
        `Unsupported note name: ${noteName}`
      );
    }

    const [, note, octaveText] =
      match;
    const semitone =
      noteToSemitone[note];

    if (semitone === undefined) {
      throw new Error(
        `Unsupported note: ${note}`
      );
    }

    const octave =
      Number(octaveText);
    return (octave + 1) * 12 + semitone;
  }

  /** @param {string | number} noteOrMidi Note name or MIDI number.
   * @returns {{block: number, fnum: number}} FM pitch at the configured reference. */
  function toPitch(noteOrMidi) {
    const midi =
      typeof noteOrMidi ===
      "number"
        ? noteOrMidi
        : parseNoteName(noteOrMidi);

    return createPitchFromMidi(midi, {
      referenceMidi:
        pitchReference.referenceMidi,
      referenceBlock:
        pitchReference.referenceBlock,
      referenceFnum:
        pitchReference.referenceFnum,
    });
  }

  /** @param {string | number} note Note name or MIDI number.
   * @returns {{block: number, fnum: number}} */
  function noteToBlockFnum(note) {
    const pitch = toPitch(note);
    return {
      block: pitch.block,
      fnum: pitch.fnum,
    };
  }

  /**
   * @param {string | number} note Note name or MIDI number.
   * @param {{channel?: number, preset?: string, beats?: number, seconds?: number, duration?: number}} [options={}] Duration defaults to 0.2 seconds; beats uses current BPM.
   * @returns {Promise<void>} Resolves after note release; rejected waits still release owned notes.
   */
  async function play(
    note,
    options = {}
  ) {
    const currentSynth =
      synth();

    if (!currentSynth) {
      throw new Error(
        "Audio is not ready yet"
      );
    }

    const channel =
      options.channel ?? 0;
    const duration = resolvePlaySeconds(options, getBpm());
    const presetName =
      options.preset ?? null;

    if (presetName) {
      const preset =
        presets[presetName];
      if (!preset) {
        throw new Error(
          `Unknown preset: ${presetName}`
        );
      }
      currentSynth.setPreset(
        channel,
        preset
      );
    }

    const pitch = toPitch(note);
    currentSynth.noteOn(
      channel,
      pitch.block,
      pitch.fnum
    );
    const voice = {};
    let owners = noteOwners.get(activeNotes);
    if (!owners) noteOwners.set(activeNotes, owners = new Map());
    owners.set(channel, voice);
    activeNotes.add(channel);
    try {
      await sleep(duration);
    } finally {
      // A cancelled/older note must not release a newer note on this channel.
      if (activeNotes.has(channel) && owners.get(channel) === voice) {
        currentSynth.noteOff(channel);
        activeNotes.delete(channel);
        owners.delete(channel);
      }
    }
  }

  /** @param {number} midi Integer MIDI note number.
   * @returns {string} Note name using sharps. */
  function midiToNoteName(midi) {
    const names = [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B",
    ];
    const note =
      names[
        ((midi % 12) + 12) % 12
      ];
    const octave =
      Math.floor(midi / 12) - 1;
    return `${note}${octave}`;
  }

  /** @param {string} root Root note including octave.
   * @param {string} name Scale key in scaleIntervals.
   * @param {number} [octaves=1] Octaves to expand.
   * @returns {string[]} Note names in ascending scale order. */
  function scale(
    root,
    name,
    octaves = 1
  ) {
    const intervals =
      scaleIntervals[name];

    if (!intervals) {
      throw new Error(
        `Unknown scale: ${name}`
      );
    }

    const rootMidi =
      parseNoteName(root);
    const notes = [];

    for (
      let octave = 0;
      octave < octaves;
      octave += 1
    ) {
      for (const interval of intervals) {
        notes.push(
          midiToNoteName(
            rootMidi +
              octave * 12 +
              interval
          )
        );
      }
    }

    return notes;
  }

  /** @param {string} root Root note including octave.
   * @param {'major' | 'minor' | 'major7' | 'minor7' | 'dominant7'} name Chord quality.
   * @returns {string[]} Chord note names. */
  function chord(
    root,
    name
  ) {
    const intervals =
      CHORD_INTERVALS[name];

    if (!intervals) {
      throw new Error(
        `Unsupported chord: ${name}`
      );
    }

    const rootMidi =
      parseNoteName(root);

    return intervals.map(
      (interval) =>
        midiToNoteName(
          rootMidi + interval
        )
    );
  }

  /** @template T
   * @param {T[]} values Nonempty array.
   * @returns {T} Random element. */
  function choose(values) {
    if (
      !Array.isArray(values) ||
      values.length === 0
    ) {
      throw new Error(
        "choose() requires a non-empty array"
      );
    }

    return values[
      Math.floor(
        Math.random() *
          values.length
      )
    ];
  }

  /** @template T
   * @param {string | T[]} keyOrValues Named sequence key or nonempty values.
   * @param {T[]} [maybeValues] Values when a key is supplied.
   * @returns {T} Next loop-local (or global) cyclic value. */
  function cycle(
    keyOrValues,
    maybeValues
  ) {
    const {
      key,
      values,
    } = normalizeCycleArgs(
      keyOrValues,
      maybeValues
    );
    const loopState =
      getCurrentLoopContext?.() ??
      null;
    const stateMap =
      loopState?.cycleState ??
      globalCycleState;
    const stateKey =
      key ??
      (
        loopState
          ? `slot:${loopState.cycleCallIndex++}`
          : `values:${createCycleSignature(values)}`
      );
    const nextIndex =
      stateMap.get(stateKey) ?? 0;
    const value =
      values[
        nextIndex % values.length
      ];

    stateMap.set(
      stateKey,
      (nextIndex + 1) %
        values.length
    );

    return value;
  }

  function rand() {
    return Math.random();
  }

  function rrange(min, max) {
    return (
      Number(min) +
      Math.random() *
        (Number(max) - Number(min))
    );
  }

  function randInt(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    return (
      Math.floor(
        Math.random() *
          (high - low + 1)
      ) + low
    );
  }

  /** @param {string} from Starting note name.
   * @param {string} to Ending note name.
   * @param {number} t Interpolation fraction in MIDI semitones.
   * @returns {{block: number, fnum: number}} */
  function noteLerp(
    from,
    to,
    t
  ) {
    const fromMidi =
      parseNoteName(from);
    const toMidi =
      parseNoteName(to);
    const midi = lerp(
      fromMidi,
      toMidi,
      t
    );
    return toPitch(midi);
  }

  return {
    parseNoteName,
    toPitch,
    noteToBlockFnum,
    noteLerp,
    play,
    hzToBlockFnum,
    midiToNoteName,
    scale,
    chord,
    lerp,
    choose,
    cycle,
    rand,
    rrange,
    randInt,
  };
}

function normalizeCycleArgs(
  keyOrValues,
  maybeValues
) {
  if (
    typeof keyOrValues ===
    "string"
  ) {
    validateCycleValues(
      maybeValues
    );
    return {
      key: keyOrValues,
      values: maybeValues,
    };
  }

  validateCycleValues(
    keyOrValues
  );
  return {
    key: null,
    values: keyOrValues,
  };
}

function validateCycleValues(values) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    throw new Error(
      "cycle() requires a non-empty array"
    );
  }
}

function createCycleSignature(
  values
) {
  return values
    .map((value) => {
      if (
        typeof value ===
          "string" ||
        typeof value ===
          "number" ||
        typeof value ===
          "boolean" ||
        value === null
      ) {
        return String(value);
      }

      try {
        return JSON.stringify(
          value
        );
      } catch {
        return Object.prototype.toString.call(
          value
        );
      }
    })
    .join("\u0001");
}
