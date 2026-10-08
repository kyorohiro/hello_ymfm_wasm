// FDS: a custom 64-entry waveform, then the same melody with modulation.
const nes = await createSoundChip('nes', {fds: true});
try {
  await mixer.set(nes.id, {volume: 0.5});
  nes.fds.setWave(Array.from({length: 64}, (_, i) =>
    Math.round(31.5 + 23 * Math.sin(i * Math.PI / 32) + 8 * Math.sin(i * Math.PI / 16))));
  nes.fds.setVolume(24);
  for (const enabled of [false, true]) {
    nes.fds.setModulation({
      table: Array.from({length: 32}, (_, i) => i < 16 ? 1 : 7),
      rate: 80, depth: 10, bias: 0, enabled,
    });
    for (const note of ['C4', 'E4', 'G4', 'C5']) {
      nes.fds.noteOn(note);
      await sleep(0.3);
      nes.fds.noteOff();
      await sleep(0.05);
    }
  }
} finally { nes.dispose(); }
