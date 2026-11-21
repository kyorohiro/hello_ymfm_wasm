// Pulse/Triangle/Noise hardware operations; no sample uploads or implicit play.
export const NES_TIMED_EXAMPLE = `const nes = await useSoundChip("nes");
const bpm = 120;
setBpm(bpm);
const beatSeconds = 60 / bpm;
const phrase = nes.build(b => {
  b.pulse.setVoice(CH1, { duty: 0.5, volume: 8 });
  b.atSeconds(0).noteOn(CH1, "E3");
  b.atSeconds(beatSeconds * 0.4).noteOff(CH1);
  b.atSeconds(beatSeconds * 0.5).noise.setVoice({ volume: 4, period: 6 });
  b.noise.noteOn();
  b.atSeconds(beatSeconds * 0.7).noise.noteOff();
});
// compile predicts writes from this detached state; it does not play anything.
const snapshot = await nes.captureState();
console.table(await nes.compile(phrase, { initialState: snapshot }));
await nes.schedule(phrase, { name: "apu", repeatSeconds: beatSeconds });
// Apply replaces this name atomically. Stop cancels only this Code's notes.
// DMC/FDS and their memory transfers are outside this first timed slice.
`;
