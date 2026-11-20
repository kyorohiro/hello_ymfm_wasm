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

export const SMSGEAR_PSG_TIMED_EXAMPLE = `const psg = await useSoundChip("segapsg");
setBpm(120);
// Software scheduling; every operation becomes real PSG command bytes.
// Offsets are absolute, based on 44,100 reference samples, not the output rate.
const pulse = psg.build(b => {
  b.atSample(0).setAttenuation(CH1, 3).noteOn(CH1, "E3");
  b.atSample(2205).setAttenuation(CH1, 9);
  b.atSample(4410).off(CH1);
  b.atSample(6615).noise({type: "white", rate: "high", attenuation: 8});
  b.atSample(8820).noiseOff();
});
// Inspect bytes without modifying the live chip. No reset is sent to hardware.
console.table(await psg.compile(pulse, {initialState: "reset"}));
// A detached capture can also be reused for comparing two compilations:
// const snapshot = await psg.captureState();
// console.table(await psg.compile(pulse, {initialState: snapshot}));
liveLoop("psg-pattern", async () => {
  // Re-evaluating this loop replaces its named reservation atomically.
  await psg.schedule(pulse, {name: "psg-pulse"});
  await beat(1);
});
// Apply preserves named loop ownership. Stop / stopLoop("psg-pattern")
// cancels its reservations and releases only notes it still owns.
`;
