/** Physical S-DSP voices. Upload BRR / reserve Echo before recording. */
export const SNES_TIMED_EXAMPLE = `const snes = await useSoundChip("snes");
setBpm(120);
const step = 60 / 120;

// Unlike the immediate Synth allocator, these are physical DSP channels.
// Use the currently loaded sample and its declared tuning.
const phrase = snes.build(b => {
  b.setChannel(CH1, {adsr1: 0, gain: 100, volumeLeft: 90, volumeRight: 90});
  b.noteOn(CH1, "C4");
  b.atSeconds(step * 0.5).setNote(CH1, "E4");
  b.atSeconds(step * 0.9).noteOff(CH1);
});
const snapshot = await snes.captureState();
console.table(await snes.compile(phrase, {initialState: snapshot}));
await snes.schedule(phrase, {name: "sdsp", repeatSeconds: step});
`;
