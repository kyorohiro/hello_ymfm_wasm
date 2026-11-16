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
	'/examples/README.md': `# YM2149 timed sound examples

Select sync-buzzer.js in Files, switch to Code if needed, and press Run.
Waveform / Spectrum use the existing output monitor. Console shows the compiled
R13 write and the current retrigger rate. Selecting or adding files never runs
them. Startup supplies missing examples without overwriting files or index.js.

## What to try

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
