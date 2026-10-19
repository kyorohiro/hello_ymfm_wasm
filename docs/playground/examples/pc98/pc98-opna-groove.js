// Select Mode: PC-98 (YM2608 / OPNA).
// Built-in FM, SSG and rhythm; bundled synthetic drums need no ROM upload.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
ssg.setMixer(0, {tone: true, noise: false});
ssg.setVolume(0, 8);
rhythm.setVolume(48);
for (const voice of ['bassDrum', 'snare', 'hiHat']) {
  rhythm.setVoice(voice, {volume: 24, left: true, right: true});
}

liveLoop('opna-groove', async () => {
  const lead = ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4'];
  for (let step = 0; step < lead.length; step++) {
    rhythm.keyOn([step % 2 ? 'snare' : 'bassDrum', 'hiHat']);
    ssg.noteOn(0, step < 4 ? 'C3' : 'G2');
    await play(lead[step], {channel: CH1, beats: 0.4});
    ssg.keyOff(0);
    await beat(0.1);
  }
});
