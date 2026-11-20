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
export const SMSGEAR_FM_EXAMPLE = `const opll = await useSoundChip("ym2413");
setBpm(120);
// Existing controls and this Code share the same YM2413.
liveLoop("melody", async () => {
  opll.noteOn(CH1, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.5);
  opll.noteOff(CH1);
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

export const SMSGEAR_FM_TIMED_EXAMPLE = `const opll = await useSoundChip("ym2413");
setBpm(120);
// All instrument-0 channels share this one hardware User patch.
opll.setRhythm({enabled: false});
opll.setUserPatch({feedback: 2, operators: [
  {multi: 2, tl: 20, ar: 15, dr: 6, sl: 7, rr: 6, egt: true},
  {multi: 1, ar: 15, dr: 5, sl: 6, rr: 7, egt: true},
]});
opll.setVoice(CH1, {instrument: 0, attenuation: 4, sustain: false});

// Timbre motion: sample-clocked hardware writes repeat every two seconds.
// Changing OP1's TL changes modulation depth, not just channel volume.
const timbre = opll.build(b => {
  for (let step = 0; step < 16; step++) {
    const wave = (1 - Math.cos(step / 16 * Math.PI * 2)) / 2;
    b.atSeconds(step / 8).setUserOperator(OP1, {
      tl: Math.round(24 - 20 * wave),
    });
  }
});
console.table(await opll.compile(timbre));
await opll.schedule(timbre, {name: "opll-timbre", repeatSeconds: 2});

// Melody: independently paced by beat(), so setBpm changes its speed.
liveLoop("opll-melody", async () => {
  const note = choose(scale("E3", "minorPentatonic", 2));
  const pulse = opll.build(b => {
    b.atSample(0).noteOn(CH1, note);
    b.atSeconds(0.18).noteOff(CH1);
  });
  await opll.schedule(pulse, {name: "opll-note"});
  await beat(0.5);
});
// Apply stages entry reservations; failed Apply keeps the last performance.
// Stop cancels both cycles; stopLoop("opll-melody") stops only the melody.
`;
