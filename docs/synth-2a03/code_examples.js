// Pulse/Triangle/Noise hardware operations; no sample uploads or implicit play.
export const NES_TIMED_EXAMPLE = `const nes = await useSoundChip("nes");
const bpm = 120;
setBpm(bpm);
const beatSeconds = 60 / 120;
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
// Prepared DMC playback is also available; FDS and memory transfers are separate.
`;

export const NES_DMC_TIMED_EXAMPLE = `const nes = await useSoundChip("nes");
const bpm = 120;
setBpm(bpm);
const step = 60 / 120;

// Prepare RAM outside build. Reuse your loaded sample when available.
// This self-authored demo is alternating DPCM bits, not PCM conversion.
if (!(await nes.captureState()).sample) {
  await nes.dmc.loadSample(new Uint8Array(257).fill(0x55));
}
const snapshot = await nes.captureState();
const phrase = nes.build(b => {
  b.dmc.play({ rate: 15, loop: true, level: 64 });
  // Raw rate/loop changes while playing, without uploading or retriggering.
  b.atSeconds(step * 0.4).writeRegister(0x4010, 0x40 | 10);
  b.atSeconds(step * 0.8).dmc.stop();
});
console.table(await nes.compile(phrase, { initialState: snapshot }));
await nes.schedule(phrase, { name: "dmc", repeatSeconds: step });
// Sample selection resolves when executed. RAM is not part of the snapshot.
// Standalone software click guard is optional; shared raw playback stays raw.
`;

/** Timed controls use the currently loaded FDS Wave/modulation tables. */
export const NES_FDS_TIMED_EXAMPLE = `const nes = await useSoundChip("nes");
setBpm(120);
const step = 60 / 120;
const phrase = nes.build(b => {
  b.fds.setVolume(24);
  b.fds.noteOn("E3");
  b.atSeconds(step * 0.5).fds.setNote("G3");
  b.atSeconds(step * 0.9).fds.noteOff();
});
console.table(await nes.compile(phrase));
await nes.schedule(phrase, {name: "fds", repeatSeconds: step});
`;
