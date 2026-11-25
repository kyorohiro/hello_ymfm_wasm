// SPDX-License-Identifier: BSD-3-Clause
// OPS / EGS: prepare one physical voice, then play A4 twice through the gate register.
const chip = await useSoundChip('fm21290');
await chip.setPreset({
  name: 'RAW GATE', algorithm: 0,
  operators: {1: {coarse: 1, envelope: {rates: [99, 99, 99, 90], levels: [99, 99, 99, 0]}}},
});

setBpm(96);
// CH1 pitch word 0x5aa8 = A4. Write the high byte first.
chip.writeRegister(0x3000, 0x5a);
chip.writeRegister(0x3001, 0xa8);
// Per-voice output attenuation, OP6 through OP2 muted, OP1 audible.
for (let slot = 0; slot < 5; slot++) chip.writeRegister(0x3080 + 16 * slot, 0xff);
chip.writeRegister(0x30d0, 33);

// EVENT = (zero-based physical channel << 2) | gate. Gate 1 = on, 2 = off.
// Same pitch and output settings: only the timing of the gate changes.
for (const duration of [0.5, 2]) {
  chip.writeRegister(0x30f1, (CH1 << 2) | 1);
  await beat(duration);
  chip.writeRegister(0x30f1, (CH1 << 2) | 2);
  await beat(0.5);
}
