// SPDX-License-Identifier: BSD-3-Clause
// Return Steps: the same four notes, first dry, then with a three-operator loop.
// Run in OPS / EGS. setPreset supplies the sound for this performance.
const chip = await useSoundChip('fm21290');
await chip.setPreset({
  name: 'RETURNSTEP', algorithm: 3, feedback: 0, oscillatorSync: true,
  operators: {
    1: {outputLevel: 0},
    4: {outputLevel: 78, coarse: 1},
    5: {outputLevel: 78, coarse: 1},
    6: {outputLevel: 78, coarse: 2},
  },
});

// Select CH2's OPS A register and set algorithm 4, feedback 7 on that voice.
chip.writeRegister(0x2804, CH2);
chip.writeRegister(0x2805, (3 << 3) | 7);
chip.writeRegister(0x2804, 0x30);
setBpm(112);
liveLoop('returnSteps', async () => {
  for (const ch of [CH1, CH2]) {
    for (const note of [57, 64, 67, 62]) {
      chip.keyOn(ch, note, 100);
      await beat(0.4);
      chip.keyOff(ch);
      await beat(0.1);
    }
  }
});
