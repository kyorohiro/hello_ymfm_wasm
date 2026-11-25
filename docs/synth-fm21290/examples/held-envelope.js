// SPDX-License-Identifier: BSD-3-Clause
// OPS / EGS: one held fifth, one carrier per note. Listen for loud → soft → loud.
const chip = await useSoundChip('fm21290');
await chip.setPreset({
  name: 'HELD FIFTH', algorithm: 0,
  operators: {1: {outputLevel: 90, envelope: {rates: [99, 99, 99, 0], levels: [99, 99, 99, 0]}}},
});

const op1Rate3 = 0x3056;
const op1Level3 = 0x3076;
const op1Rate4 = 0x3057;
setBpm(96);
chip.keyOn(CH1, 60, 100);
chip.keyOn(CH2, 67, 100);
await beat(2);

// These OP1 registers are shared by both physical voices. Larger level bytes
// mean more attenuation. Try 8 or 24 in place of 16, then run it again.
chip.writeRegister(op1Rate3, 48);
chip.writeRegister(op1Level3, 16);
await beat(2);
chip.writeRegister(op1Level3, 0);
await beat(2);

// Release both keys slowly, then speed up the tail while it is sounding.
chip.keyOff(CH1);
chip.keyOff(CH2);
await beat(1);
chip.writeRegister(op1Rate4, 63);
await beat(1);
