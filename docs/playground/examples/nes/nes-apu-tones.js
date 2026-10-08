// NES APU: two pulse voices, triangle bass, and noise percussion.
const nes = await useSoundChip('nes');
try {
  await mixer.set(nes.id, {volume: 0.6});
  nes.pulse.setVoice(0, {duty: 0.25, volume: 8});
  nes.pulse.setVoice(1, {duty: 0.5, volume: 5});
  nes.noise.setVoice({volume: 4, period: 6});
  const melody = ['C4', 'E4', 'G4', 'B4', 'A4', 'G4', 'E4', 'D4'];
  for (const note of melody) {
    nes.pulse.noteOn(0, note);
    nes.pulse.noteOn(1, 'G3');
    nes.triangle.noteOn('C3'); // Triangle has a fixed hardware volume.
    nes.noise.noteOn();
    await sleep(0.04);
    nes.noise.noteOff();
    await sleep(0.16);
    nes.pulse.noteOff(0); nes.pulse.noteOff(1); nes.triangle.noteOff();
    await sleep(0.04);
  }
} finally { nes.dispose(); }
