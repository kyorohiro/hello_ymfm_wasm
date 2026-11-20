// SPDX-License-Identifier: BSD-3-Clause
// Sample-clock demonstrations, independent of beat()/BPM. All use the same APU.
export const DMG_TIMED_EXAMPLES=Object.freeze({
  '/examples/timed-pulse.js':`const gb = await useSoundChip("gameboy");

// Record once. No sound or register state changes during build().
const phrase = gb.build(b => {
  b.atSample(0).pulse.setEnvelope(CH1, {volume: 10, direction: "down", period: 2});
  b.pulse.setDuty(CH1, 0.5);
  b.pulse.noteOn(CH1, "E3");
  b.atSeconds(0.125).pulse.setDuty(CH1, 0.25);
  b.atSeconds(0.25).pulse.noteOn(CH1, "G3");
  b.atSeconds(0.375).pulse.keyOff(CH1);
});

// A detached, coherent renderer snapshot; audio keeps running.
const snapshot = await gb.captureState();
console.table(await gb.compile(phrase, {initialState: snapshot}));
await gb.schedule(phrase, {name: "pulse-phrase", repeatSeconds: 0.5});
// Apply replaces this named reservation atomically. Stop restores the Synth.
// await gb.clearSchedule("pulse-phrase");
`,
  '/examples/timed-noise.js':`const gb = await useSoundChip("gameboy");

// CH4 has no note pitch. Divisor/shift/width change its noise clock/sequence.
const noise = gb.build(b => {
  b.atSample(0).noise.setEnvelope({volume: 9, direction: "down", period: 1});
  b.noise.setParameters({divisor: 3, shift: 4, width: 15});
  b.noise.keyOn();
  b.atSample(4410).noise.setParameters({shift: 2, width: 7});
  b.atSample(6615).noise.keyOff();
});
console.table(await gb.compile(noise));
await gb.schedule(noise, {name: "noise-clock", repeatSeconds: 0.25});
// atSample uses 44100 Hz reference time even on a 48000 Hz device.
`,
  '/examples/timed-wave.js':`const gb = await useSoundChip("gameboy");
const triangle = Array.from({length: 32}, (_, i) => i < 16 ? i : 31 - i);
const square = Array.from({length: 32}, (_, i) => i < 16 ? 12 : 3);

const wave = gb.build(b => {
  // Wave RAM is exactly 32 four-bit samples. Upload stops CH3's DAC.
  // Same-time order matters: upload first, then explicitly retrigger it.
  b.atSample(0).wave.stopAndSetWaveform(triangle);
  b.wave.setLevel(0.5);
  b.wave.noteOn("C4");
  b.atSeconds(0.25).wave.stopAndSetWaveform(square);
  b.wave.noteOn("G4");
  b.atSeconds(0.5).wave.keyOff();
});
const snapshot = await gb.captureState();
console.table(await gb.compile(wave, {initialState: snapshot}));
await gb.schedule(wave, {name: "wave-ram", repeatSeconds: 0.75});
// This hardware DAC stop is deliberate; no software crossfade is added.
`,
});
