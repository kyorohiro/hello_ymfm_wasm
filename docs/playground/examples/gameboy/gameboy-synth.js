// Game Boy: change duty and noise while notes are held, without retriggering.
const gb = await createSoundChip('gameboy');
try {
  gb.initialize();
  gb.pulse.setDuty(0, 0.25);
  // Initial volume and hardware envelope; keyOn explicitly starts the envelope.
  gb.pulse.setEnvelope(0, {volume: 10, direction: 'down', period: 0});
  gb.pulse.setNote(0, 'C4');
  gb.pulse.keyOn(0);
  for (const duty of /** @type {const} */ ([0.125, 0.25, 0.5, 0.75])) {
    gb.pulse.setDuty(0, duty); // Live NR11 update, no keyOn.
    await sleep(0.2);
  }
  gb.pulse.keyOff(0);
  gb.wave.stopAndSetWaveform(Array.from({length: 32}, (_, i) => i < 16 ? i : 31 - i));
  gb.wave.setNote('C3');
  gb.wave.keyOn(); // Wave upload stopped the DAC; restart explicitly.
  await sleep(0.25);
  gb.wave.keyOff();
  gb.noise.setEnvelope({volume: 8, direction: 'down', period: 0});
  gb.noise.setParameters({divisor: 3, shift: 4, width: 15});
  gb.noise.keyOn();
  await sleep(0.2);
  gb.noise.setParameters({width: 7, shift: 3}); // Live NR43 update.
  await sleep(0.2);
  gb.noise.keyOff();
} finally {
  gb.dispose();
}
