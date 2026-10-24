// Compare independent YM2612 cores: ymfm first, then Nuked, with the same six-note melody.
// Mixer → Preset: System を選んで Run。各音は FM1–6 を順番に使います。
// Select Mixer → Preset: System before Run to compare calibrated defaults.
// Saved Mixer settings remain authoritative; this example never changes its strips.
// Web Audio / Native and Main / Worker use the same code. The mode's primary chip stays idle.
// Stop cancels the current wait; finally disposes its chip without starting the next one.
const timing = await getTiming();
const GAP_SECONDS = Math.max(0.35, timing.workerLookaheadSeconds + 0.1);
const NOTE_SECONDS = 0.3;
const RELEASE_SECONDS = 0.08;
const melody = ['C4', 'E4', 'G4', 'B4', 'C5', 'G4'];
const engines = ['ymfm', 'nuked'];

await fx.setChain([]);
for (const [index, engine] of engines.entries()) {
  // Automatic IDs keep a previously saved ID-specific strip out of this comparison.
  const chip = await createSoundChip('ym2612', {engine});
  try {
    await chip.reset();
    for (let channel = 0; channel < 6; channel++) {
      await chip.setPreset(channel, FM_PRESETS['one-op-basic']);
      await chip.setPan(channel, true, true);
    }
    log(`YM2612 engine comparison ${index + 1}/2: ${engine} · FM1–6`);
    for (const [channel, note] of melody.entries()) {
      await chip.noteOn(channel, note);
      await sleep(NOTE_SECONDS);
      await chip.keyOff(channel);
      await sleep(RELEASE_SECONDS);
    }
  } finally {
    await chip.dispose();
  }
  // Worker disposal follows its audio lookahead. Include the last chip in this wait.
  await sleep(GAP_SECONDS);
}
log('YM2612 engine comparison complete: 2/2');
