// SPDX-License-Identifier: BSD-3-Clause
// Original, editable examples. Adding them to Files never opens audio or runs Code.
export const YM_CODE_EXAMPLES = Object.freeze({
	'/examples/sync-buzzer.js': `const ym = await useSoundChip("ay8910");
setBpm(120);

// Software schedules the writes; the shared YM2149 envelope makes the sound.
// This example uses CH1. R11 / R12 / R13 affect every envelope-enabled CH.
ym.keyOff(CH2);
ym.keyOff(CH3);
ym.setVoice(CH1, { tone: true, noise: false, volume: 9, envelope: true });
ym.setEnvelope({ period: 100, shape: 8 });

// Writing the same R13 value again still restarts the envelope's shape.
const retrigger = ym.build(b => {
  b.atSample(0).setEnvelope({ shape: 8 });
});
console.table(await ym.compile(retrigger, { initialState: "client" }));

// Melody and buzzer motion have independent periods. Edit these, then Apply.
const notes = scale("E3", "minorPentatonic", 2);
const retriggerHz = [100, 125, 160, 200];
let noteIndex = 0;
let motionIndex = 0;

liveLoop("melody", async () => {
  ym.noteOn(CH1, notes[noteIndex++ % notes.length]);
  await beat(0.4);
  ym.noteOff(CH1);
  await beat(0.1);
});

liveLoop("buzzer-motion", async () => {
  const hz = retriggerHz[motionIndex++ % retriggerHz.length];
  // One compact repeat on the Worklet, not one JavaScript timer per write.
  // Each rate step deliberately replaces/restarts this named reservation.
  await ym.schedule(retrigger, { name: "sync-buzzer", repeatSeconds: 1 / hz });
  console.log("R13 Shape 8: " + hz + " retriggers/s");
  await beat(2);
});

// Stop cancels both loops and their reservation. Removing buzzer-motion on
// Apply also cancels it; removing only its schedule() call does not.
// For an isolated envelope waveform: select CH1, turn Tone off, keep Noise
// off, then hold a key. Try retriggerHz = [100]; see examples/README.md.
// See examples/README.md for natural envelope rate and timing limitations.
`,
	'/examples/volume-modulation.js': `const ym = await useSoundChip("ay8910");
setBpm(120);

// Software schedules fixed-volume writes. The YM2149 supplies the tone and
// its 16 nonlinear volume levels; this does not use the hardware envelope.
ym.keyOff(CH2);
ym.keyOff(CH3);
ym.setVoice(CH1, { tone: true, noise: false, volume: 0, envelope: false });

const notes = scale("E3", "minorPentatonic", 2);
const levels = [0, 2, 4, 6, 8, 10, 12, 14, 15, 14, 12, 10, 8, 6, 4, 2];
const modulationHz = [25, 50, 100];
let noteIndex = 0;
let motionIndex = 0;

function volumePattern(hz) {
  return ym.build(b => {
    levels.forEach((level, index) => {
      b.atSeconds(index / (hz * levels.length)).setVolume(CH1, level, false);
    });
  });
}
console.table(await ym.compile(volumePattern(modulationHz[0]), { initialState: "client" }));

// Continuous melody: pitch changes do not fight the independent R8 writes.
// noteOff writes volume 0, but the next scheduled volume would sound again.
liveLoop("melody", async () => {
  ym.setNote(CH1, notes[noteIndex++ % notes.length]);
  await beat(0.5);
});

liveLoop("volume-motion", async () => {
  const hz = modulationHz[motionIndex++ % modulationHz.length];
  await ym.schedule(volumePattern(hz), { name: "volume-modulation", repeatSeconds: 1 / hz });
  console.log("R8 fixed volume: " + hz + " cycles/s; " + (hz * levels.length) + " nominal writes/s");
  await beat(2);
});

// Cancellation stops future writes; explicitly silence the last level too.
// This cleanup follows volume-motion, even if melody remains on Apply.
liveCleanup(["volume-motion"], () => ym.keyOff(CH1));

// Edit levels, modulationHz or beat() values, then Apply. BPM changes the
// melody / rate-step timing, not modulationHz. Replacing the name restarts
// the modulation phase. Stop cancels the loops and silences this Code run.
// Select CH1 and turn Tone off (leave Noise off) to see volume-only output.
`,
	'/examples/volume-sample.js': `const ym = await useSoundChip("ay8910");
setBpm(120);

// Software-generated percussion -> YM2149 volume codes. No game sample.
// Both generators are disabled so R8 directly controls CH1's output level.
ym.keyOff(CH2);
ym.keyOff(CH3);
ym.setVoice(CH1, { tone: false, noise: false, volume: 0, envelope: false });

const sampleRate = 8000;
const durationSeconds = 0.08;
const samples = new Float32Array(Math.round(sampleRate * durationSeconds));
for (let i = 0; i < samples.length; i++) {
  const t = i / sampleRate;
  const remaining = (samples.length - 1 - i) / sampleRate;
  const attack = (1 - Math.cos(Math.PI * Math.min(1, t / 0.001))) / 2;
  const tail = (1 - Math.cos(Math.PI * Math.min(1, remaining / 0.005))) / 2;
  const envelope = attack * Math.exp(-t / 0.022) * tail;
  const phase = 2 * Math.PI * (45 * t + 125 * 0.014 * (1 - Math.exp(-t / 0.014))) - Math.PI / 2;
  // Positive-lobe waveform: it intentionally has an envelope bias. It is not
  // general signed PCM conversion; silence is zero, not a mid-volume code.
  samples[i] = envelope * (1 + Math.sin(phase)) / 2;
}
samples[0] = samples[samples.length - 1] = 0;

// Gain curve of the included MAME YM2149 model (fixed levels, 1k-ohm load).
// See third_party/mame-ay8910/ay8910.cpp: ym2149_param / build_single_table.
const resistors = [73770, 37586, 27458, 21451, 15864, 12371, 8922, 6796,
  4763, 3521, 2403, 1737, 1123, 762, 438, 251];
const raw = resistors.map(r => (1 / r + 1 / 630) / (1 / r + 1 / 630 + 1 / 801 + 1 / 1000));
const gains = raw.map(value => (value - raw[0]) / (raw[15] - raw[0]));
function volumeCode(value) {
  const target = Math.max(0, Math.min(1, value));
  let best = 0;
  for (let code = 1; code < gains.length; code++) {
    if (Math.abs(gains[code] - target) < Math.abs(gains[best] - target)) best = code;
  }
  return best;
}
const codes = Array.from(samples, volumeCode);
const sample = ym.build(b => {
  codes.forEach((code, index) => b.atSample(index).setVolume(CH1, code, false));
  b.atSample(codes.length).setVolume(CH1, 0, false); // Explicit 80 ms end.
}, { referenceSampleRate: sampleRate });

const writes = await ym.compile(sample, { initialState: "client" });
console.log("Volume sample: " + codes.length + " frames at " + sampleRate + " Hz; " + writes.length + " writes. Showing first 24.");
console.table(writes.slice(0, 24)); // The complete writes array is still available.

liveLoop("drums", async () => {
  // One shot: this Promise means accepted, not that all samples have played.
  // Reusing the name retriggers CH1 and replaces any unfinished future writes.
  await ym.schedule(sample, { name: "volume-sample" });
  await beat(1);
});
liveCleanup(["drums"], () => ym.keyOff(CH1));

// BPM changes hit spacing; 8 kHz sample timing and 80 ms duration stay fixed.
// At short beat intervals, the next hit cuts the old one rather than layering.
// Stop / loop removal cancel future writes, then silence the final volume.
// Keep CH1 Tone / Noise / Envelope off for this sample; use CH2/CH3 for keys.
`,
	'/examples/README.md': `# YM2149 timed sound examples

Select sync-buzzer.js, volume-modulation.js or volume-sample.js in Files and Run
from Code. Waveform / Spectrum use the existing output monitor. Console shows
compiled register writes and timing information. Selecting or adding files never runs
them. Startup supplies missing examples without overwriting files or index.js.

## Sync-buzzer: what to try

1. Start with the supplied melody. Edit notes / beat() to change the melody.
2. Edit retriggerHz or the motion loop's beat(2), then Apply. The melody repeats
   every half beat; a rate step lasts two beats. setBpm() changes those musical
   periods; it does not multiply retrigger rates expressed in Hz.
3. Select CH1 and change the shared Envelope period in the controls while it runs. This changes
   the descent speed between R13 writes. Shape is deliberately rewritten as 8.
4. For a clean envelope trace, set retriggerHz = [100], Apply, select CH1, then
   turn Tone off and leave Noise off. Hold a key to hear the envelope alone.
   The melody loop still sends Note Off; remove that loop on Apply if you want
   an uninterrupted held-key experiment. The manual key must be released again.

The YM2149 envelope has 32 levels. With the Synth's 2 MHz clock, period 100 and
Shape 8, the natural repeating descent is 78.125 Hz (12.8 ms). Writing R13 every
10 ms forces it to start its shape again sooner, making a 100 Hz repetition.
R13 restarts the envelope shape even when its value is unchanged; do not infer
that every internal clock divider is reset. The chip's Tone and shared envelope
interact in the normal example, so its spectrum also contains the melody.

## Scheduling and editing

Only the slow motion loop replaces the reservation. Individual R13 writes run
on the AudioWorklet sample clock. Replacing the name restarts its repeat phase;
this example intentionally does that at each rate step, not on every note.
Removing the entire buzzer-motion loop on Apply cancels its reservation. Keeping
the loop but deleting just its schedule() line does not cancel existing work;
use await ym.clearSchedule("sync-buzzer") within that loop to cancel explicitly.
Stop cancels Code's loops and reservations. Cancellation does not restore old
register values. The normal controls / keyboard remain usable, and writes to
the same shared envelope take effect in actual application order.

compile(..., { initialState: "client" }) predicts the write from local state;
it is not a recording of interleaved live writes. For comparisons from one
applied state, capture once with await ym.captureState() and reuse that snapshot
as initialState in multiple compile() calls. Neither operation pauses audio.

This is a host-scheduled Sync-buzzer experiment, not an Atari ST CPU / MFP timer
emulator or proof of exact playback of every historical buzzer technique.
Events are rounded to output samples. At 100 Hz, 44.1 / 48 kHz use exactly
441 / 480 frames per period; arbitrary rates need alternating frame intervals.
Native timed execution is not supported yet. No game music or samples are used.

Hardware references:
- Yamaha YM2149 datasheet: https://ftpmirror.your.org/pub/misc/bitsavers/components/yamaha/YM2149_199209.pdf
- Core implementation: ../js/ay8910synth.js and the included MAME AY sources.

## Fixed-volume modulation

volume-modulation.js writes CH1's R8 fixed-volume codes, 0 through 15, with
Envelope mode explicitly off. Its 16-step pattern runs at 25 / 50 / 100 Hz:
400 / 800 / 1600 nominal register writes per second. One compact reservation
handles each rate; JavaScript changes the rate only once every two beats.
The melody changes pitch every half beat with setNote(), independently.

Edit levels or modulationHz, then Apply. Register codes are not linear PCM
amplitudes: the hardware's volume table is nonlinear. This is separate from
the shared 32-level hardware envelope in sync-buzzer.js. The timing pattern
is software; the stepped gain and the resulting tone come from the chip.
With CH1 selected, turn Tone off and leave Noise off for volume-only output.
Waveform / Spectrum show the output; Console shows the predicted 16 R8 writes.

This melody is continuous. A noteOff() would write 0, but the next scheduled
setVolume() could turn output back on. Stop the volume reservation before
expecting manual note release to keep CH1 silent. Other CHs remain usable.
Removing volume-motion on Apply runs liveCleanup() to silence its last level;
keeping that loop but removing only schedule() retains the old reservation.
For an explicit stop inside volume-motion, use:
await ym.clearSchedule("volume-modulation");
ym.keyOff(CH1);
await beat(2);
Stop ends both loops. Removing only melody leaves the last pitch modulating.
No game assets or PCM import are used by this modulation example.

## Volume-register sample playback

volume-sample.js generates an original 80 ms kick-like waveform at 8 kHz and
converts it to CH1 fixed-volume codes. The included resistor-model gain curve
is inverted by choosing the nearest level, not by rounding sample * 15.
The positive-lobe input intentionally has an envelope bias and zero endpoints;
this is not a general signed WAV / PCM decoder or a physical-chip calibration.

The pattern has 640 data writes and an explicit R8=0 at reference sample 640.
Each hit schedules one pass; await schedule() means accepted, not finished.
One hit per beat follows BPM; sample duration remains 80 ms. Reusing the name
replaces unfinished future writes, so fast retriggers cut tails instead of
layering voices. Console shows only the first 24 of the full 641 compiled rows.

Stop or removing drums on Apply cancels future writes and runs the keyOff
cleanup. Keep CH1 Tone / Noise / Envelope off for the generated waveform.
Manual volume writes on CH1 compete with playback; CH2 / CH3 remain available.
Changing the output device from 44.1 to 48 kHz does not change reference timing.
No audio file, game asset, dedicated PCM unit or new runtime API is added.
`,
});

/** Add missing files atomically; keep saved source, selected path and input mode. */
export function addYmCodeExamples(project) {
	const fold = path => path.normalize('NFC').toLowerCase();
	const occupied = new Set([
		...project.fs.list().map(file => file.path),
		...project.fs.listDirectories(),
	].map(fold));
	const entries = Object.entries(YM_CODE_EXAMPLES)
		.filter(([path]) => !occupied.has(fold(path)))
		.map(([path, data]) => ({ path, type: 'text', data }));
	if (entries.length) project.importFiles(entries);
	return entries.map(entry => entry.path);
}
