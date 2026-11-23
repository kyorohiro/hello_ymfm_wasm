// SPDX-License-Identifier: BSD-3-Clause
export const VSU_TIMED_MODULATION_NOISE = `const vsu = await useSoundChip("vsu");

const phrase = vsu.build(b => {
  const start = b.atSample(0);
  const triangle = Array.from({ length: 32 }, (_, i) => Math.min(i, 31 - i) * 4);
  start.setWave(4, triangle).setWaveBank(CH5, 4).setVolume(CH5, 13, 8);
  for (let i = 0; i < 32; i++) {
    const offset = Math.round(52 * Math.sin(2 * Math.PI * i / 32));
    start.write(0x280 + i * 4, offset & 0xff);
  }
  // CH5 EV0, EV1 and SWP. Repeat the Modulation RAM at 0.96 ms per step.
  start.write(0x510, 0xf0).write(0x514, 0x70).write(0x51c, 0x10);
  start.noteOn(CH5, "E4");

  // CH6 shifts at 31.25 kHz (S6FQ = 0x7f0). Gate with the hardware timer.
  start.setVolume(CH6, 6, 14).write(0x548, 0xf0).write(0x54c, 0x07);
  start.write(0x550, 0xf0).write(0x554, 0x01).write(0x540, 0xa5);
  b.atSeconds(0.18).noteOff(CH5);
  b.atSample(11025).write(0x554, 0x51).write(0x540, 0xa2);
  b.atSeconds(0.5).noteOn(CH5, "G4").write(0x554, 0x01).write(0x540, 0xa5);
  b.atSeconds(0.68).noteOff(CH5);
  b.atSeconds(0.75).write(0x554, 0x51).write(0x540, 0xa2);
});

console.table(await vsu.compile(phrase));
await vsu.schedule(phrase, { name: "modulation-noise", repeatSeconds: 1 });
// Use the Mixer to hear CH5 and CH6 separately. Stop ends the pattern.
// await vsu.clearSchedule("modulation-noise");
`;
