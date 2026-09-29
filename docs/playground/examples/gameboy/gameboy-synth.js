// Independent Game Boy. Pulse channels are 0/1; wave and noise have one channel each.
const gb = await createSoundChip('gameboy');
try {
  gb.initialize();
  gb.pulse.setVoice(0, {duty: 0.5, volume: 10,
    envelope: {direction: 'down', period: 2}});
  for (const note of ['C4', 'E4', 'G4', 'C5']) {
    gb.pulse.setNote(0, note);
    gb.pulse.keyOn(0);
    await sleep(0.25);
    gb.pulse.keyOff(0);
  }
  gb.wave.setNote('C3'); // Default triangle, half level.
  gb.wave.keyOn();
  gb.noise.setVoice({envelope: {period: 2}, width: 15});
  gb.noise.keyOn();
  await sleep(0.5);
  gb.wave.keyOff();
  gb.noise.keyOff();
} finally {
  gb.dispose();
}
