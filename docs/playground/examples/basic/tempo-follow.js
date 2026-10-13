// All liveLoops share BPM. Changing it preserves the current beat position.
// Beat-length notes and tweens follow changes; seconds and samples stay fixed.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);

liveLoop('melody', async () => {
  await play(cycle(['C4', 'E4', 'G4', 'B4']), {beats: 1, channel: CH1});
});

liveLoop('tempo', async () => {
  await beat(3.5); // Change tempo partway through melody's fourth note.
  setBpm(60);
  console.log('BPM: 60');
  await beat(4);
  setBpm(120);
  console.log('BPM: 120');
});

liveLoop('animation', async () => {
  await tween({beats: 4}, progress => {
    setMasterVolume(0.25 + 0.5 * progress);
  });
  await tween({seconds: 1}, progress => {
    setMasterVolume(0.75 - 0.5 * progress);
  });
});
