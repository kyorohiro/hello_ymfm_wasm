// Select Mode: PC-98 (YM2203 / OPN).
// FM and SSG share one mono YM2203, sent equally to left and right.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
ssg.setMixer(0, {tone: true, noise: false});
ssg.setVolume(0, 8);

liveLoop('opn-melody', async () => {
  const lead = ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4'];
  const bass = ['C3', 'C3', 'G2', 'G2', 'A2', 'A2', 'G2', 'G2'];
  for (let step = 0; step < lead.length; step++) {
    ssg.noteOn(0, bass[step]);
    await play(lead[step], {channel: CH1, beats: 0.4});
    ssg.keyOff(0);
    await beat(0.1);
  }
});
