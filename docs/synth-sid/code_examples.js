// SPDX-License-Identifier: BSD-3-Clause
// Audio-sample time, independent of BPM. These use the editor's existing SID.
export const SID_TIMED_EXAMPLES=Object.freeze({
  '/examples/timed-voice.js':`const sid = await useSoundChip("sid");

// Record once; build neither sounds the chip nor copies its live state.
const phrase = sid.build(b => {
  b.atSample(0).setVoice(CH1, {waveform: "saw", attack: 2, release: 5});
  b.noteOn(CH1, "E3");
  b.atSeconds(0.125).noteOff(CH1);
  b.atSeconds(0.25).noteOn(CH1, "G3");
  b.atSeconds(0.375).noteOff(CH1);
});

// A detached resolver snapshot, not a complete SID/C64 save state.
const snapshot = await sid.captureState();
console.table(await sid.compile(phrase, {initialState: snapshot}));
await sid.schedule(phrase, {name: "voice-phrase", repeatSeconds: 0.5});
// Apply replaces this name atomically; Stop restores your edited sound.
// await sid.clearSchedule("voice-phrase");
`,
  '/examples/timed-filter.js':`const sid = await useSoundChip("sid");

const motion = sid.build(b => {
  b.atSample(0).setVoice(CH1, {waveform: "pulse", pulseWidth: 1024});
  b.setFilter({mode: "lowpass", routing: 1, cutoff: 150, resonance: 6});
  b.noteOn(CH1, "E2");
  b.atSample(4410).setFilter({cutoff: 650});
  b.atSample(8820).setVoice(CH1, {pulseWidth: 3072});
  b.atSample(13230).setFilter({cutoff: 150});
  b.atSample(17640).noteOff(CH1);
});

// Partial filter/voice edits use register values at their actual execution.
// atSample defaults to a 44100 Hz reference, even on a 48000 Hz device.
console.table(await sid.compile(motion));
await sid.schedule(motion, {name: "filter-motion", repeatSeconds: 0.5});
`,
  '/examples/compare-register-writes.js':`const sid = await useSoundChip("sid");
const snapshot = await sid.captureState();

const sync = sid.build(b => b.setVoice(CH1, {sync: true}));
const ring = sid.build(b => b.setVoice(CH1, {ring: true}));
// Both resolve from exactly the same detached state; neither changes audio.
console.table(await sid.compile(sync, {initialState: snapshot}));
console.table(await sid.compile(ring, {initialState: snapshot}));

// Reset is uninitialized hardware state, so use raw writes for this comparison.
const gates = sid.build(b => {
  b.writeRegister(4, 0x21); // Saw + Gate
  b.writeRegister(4, 0x21); // Repeated writes are kept
  b.atSample(100).writeRegister(4, 0x20);
});
console.table(await sid.compile(gates, {initialState: "reset"}));
// Snapshot/client/reset compilation does not request state from the Worklet.
// The borrowed Synth has no complete client shadow; use captureState instead.
`,
});
