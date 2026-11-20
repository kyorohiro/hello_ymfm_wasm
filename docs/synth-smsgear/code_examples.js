// SPDX-License-Identifier: BSD-3-Clause
export const SMSGEAR_PSG_EXAMPLE = `const psg = await useSoundChip("segapsg");
setBpm(120);
// Hardware square-wave tone. Attenuation 0 is loudest; 15 is silent.
liveLoop("melody", async () => {
  psg.noteOn(CH1, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.5);
  psg.off(CH1);
  await beat(0.125);
});
`;
export const SMSGEAR_FM_EXAMPLE = `const fm = await useSoundChip("ym2413");
setBpm(120);
// Existing controls and this Code share the same YM2413.
liveLoop("melody", async () => {
  fm.noteOn(CH1, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.5);
  fm.noteOff(CH1);
  await beat(0.125);
});
`;
