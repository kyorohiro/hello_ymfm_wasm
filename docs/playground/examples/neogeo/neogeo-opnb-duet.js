// Select Mode: Neo Geo (YM2610) or Neo Geo (YM2610B).
// FM and SSG use the standard chip; ADPCM sections are available separately.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
ssg.setMixer(0, {tone: true, noise: false});
ssg.setVolume(0, 8);

liveLoop('opnb-duet', async () => {
  const lead = ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4'];
  for (let step = 0; step < lead.length; step++) {
    ssg.noteOn(0, step < 4 ? 'C3' : 'G2');
    await play(lead[step], {channel: CH1, beats: 0.4});
    ssg.keyOff(0);
    await beat(0.1);
  }
});
