// Pure text: importing or restoring a project never starts audio.
export const FM2608_TIMED_EXAMPLE = `const opna = await useSoundChip("ym2608");
const bpm = 120;
setBpm(bpm);

// Use the current FM patch. One reservation shares the FM and SSG clock.
opna.ssg.setMixer(CH1, { tone: true, noise: false });
opna.ssg.setVolume(CH1, 10);
const phrase = opna.build(b => {
  b.atSample(0).noteOn(CH1, "E3");
  b.ssg.noteOn(CH1, "E4");
  b.atSeconds(0.15).setOperator(CH1, OP4, { tl: 30 });
  b.atSeconds(0.20).noteOff(CH1);
  b.ssg.keyOff(CH1);
});

// Inspection never writes to the chip. current captures applied audio state;
// client uses the optimistic JS shadow, reset uses hardware defaults.
const snapshot = await opna.captureState();
console.table(await opna.compile(phrase, { initialState: snapshot }));

// BPM sets the musical repeat interval when Run/Apply evaluates this script.
// AudioWorklet executes offsets precisely, with no setTimeout audio loop.
await opna.schedule(phrase, { name: "fm-ssg", repeatSeconds: 60 / bpm });
// Stop cancels Code reservations; Apply replaces this name atomically.
// await opna.clearSchedule("fm-ssg");
`;

export const FM2608_RHYTHM_EXAMPLE = `const opna = await useSoundChip("ym2608");
const bpm = 120;
setBpm(bpm);
const step = 60 / bpm / 2;

// The standard Synth ROM is already loaded. These are physical drum voices,
// independent of FM CH1..CH6 and SSG CH1..CH3, with one shared Rhythm level.
const drums = opna.build(b => {
  b.rhythm.setVolume(48);
  b.rhythm.setVoice("bassDrum", { volume: 24, left: true, right: true });
  b.rhythm.setVoice("snare", { volume: 24, left: true, right: true });
  b.rhythm.setVoice("hiHat", { volume: 20, left: true, right: false });
  b.atSeconds(0).rhythm.keyOn(["bassDrum", "hiHat"]);
  b.atSeconds(step).rhythm.keyOn("hiHat");
  b.atSeconds(step * 2).rhythm.keyOn(["snare", "hiHat"]);
  b.atSeconds(step * 3).rhythm.keyOn("hiHat");
  b.atSeconds(step * 3.9).rhythm.keyOff(["bassDrum", "snare", "hiHat"]);
});
console.table(await opna.compile(drums));
await opna.schedule(drums, { name: "rhythm", repeatSeconds: step * 4 });
// You can add FM and SSG operations to the very same builder/time cursor.
// Apply atomically replaces this pattern. Stop cancels it and releases its drums.
`;

export const FM2608_ADPCM_EXAMPLE = `const opna = await useSoundChip("ym2608");
const bpm = 120;
setBpm(bpm);
const step = 60 / bpm;

// Uses the ADPCM-B sample already loaded by this Synth. No transfer is recorded.
// Speed changes both pitch and duration; this is one physical sample voice.
const snapshot = await opna.captureState();
const r = snapshot.adpcmRegisters;
const delta = (r[9] | r[10] << 8) || 18000;
const sample = opna.build(b => {
  b.adpcm.setVolume(160);
  b.adpcm.setPan(true, true);
  b.adpcm.setDeltaN(delta);
  b.adpcm.keyOn({ repeat: true });
  b.atSeconds(step / 2).adpcm.setDeltaN(Math.min(65535, Math.round(delta * 1.5)));
  // Software fade expressed as timed level writes, followed by raw hardware Off.
  // keyOff itself is immediate; the keyboard's musical release is separate.
  for (let i = 1; i <= 8; i++) {
    b.atSeconds(step - 0.020 + i * 0.0015).adpcm.setVolume(Math.round(160 * (1 - i / 8)));
  }
  b.adpcm.keyOff();
});
console.table(await opna.compile(sample, { initialState: snapshot }));
await opna.schedule(sample, { name: "sample", repeatSeconds: step });
// Apply replaces this name atomically; Stop releases only its owned playback.
`;
