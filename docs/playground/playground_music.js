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
  } = options;

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
    const duration =
      options.duration ?? 0.2;
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
    activeNotes.add(channel);

    await sleep(duration);

    currentSynth.noteOff(channel);
    activeNotes.delete(channel);
  }

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

  function rand() {
    return Math.random();
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

  return {
    parseNoteName,
    toPitch,
    play,
    midiToNoteName,
    scale,
    choose,
    rand,
    randInt,
  };
}
