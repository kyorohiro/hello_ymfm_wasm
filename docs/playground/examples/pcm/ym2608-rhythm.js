// Independent YM2608; no need to change the Playground chip selector.
// Uses the bundled BSD-3-Clause Tetorica synthetic rhythm sounds.
// These sounds differ from Yamaha's original ROM.
const ym2608 = await createSoundChip('ym2608');
try {
  ym2608.reset();
  const rhythm = ym2608.rhythm;
  rhythm.setVolume(48);
  for (let voice = 0; voice < 6; voice++) {
    rhythm.setVoice(voice, {volume: 24, left: true, right: true});
    rhythm.keyOn(voice);
    await sleep(0.75);
  }
  for (let step = 0; step < 8; step++) {
    rhythm.keyOn([step % 2 ? 'snare' : 'bassDrum', 'hiHat']);
    await sleep(0.25);
  }
} finally {
  ym2608.dispose();
}
