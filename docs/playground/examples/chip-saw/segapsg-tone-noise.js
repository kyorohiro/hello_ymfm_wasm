// Independent Sega PSG: works with any selected Playground chip.
const chip = await useSoundChip('segapsg');
try {
  for (const note of ['C4', 'E4', 'G4', 'C5']) {
    chip.tone(0, {note, attenuation: 4});
    await sleep(0.2);
  }
  chip.off(0);
  chip.noise({type: 'white', rate: 'medium', attenuation: 8});
  await sleep(0.2);
  chip.noiseOff();
} finally { chip.dispose(); }
