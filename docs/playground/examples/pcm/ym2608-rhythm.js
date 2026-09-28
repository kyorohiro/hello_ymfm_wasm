// Select YM2608 in the Playground chip selector before running.
// Uses the bundled BSD-3-Clause Tetorica synthetic rhythm sounds.
// These sounds differ from Yamaha's original ROM.
fm.reset();
function rhythmWrite(register, value) {
  fm.writeAddress(0, register);
  fm.writeData(value);
}
rhythmWrite(0x11, 48); // Total rhythm level.
for (let voice = 0; voice < 6; voice++) {
  rhythmWrite(0x18 + voice, 0xc0 | 24); // Both speakers, voice level.
  rhythmWrite(0x10, 1 << voice);
  await sleep(0.75);
}
for (let step = 0; step < 8; step++) {
  rhythmWrite(0x10, (step % 2 ? 2 : 1) | 8); // Kick/snare + hi-hat.
  await sleep(0.25);
}
rhythmWrite(0x10, 0xbf); // Stop all rhythm voices.
