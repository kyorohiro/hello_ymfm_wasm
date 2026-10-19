// Select Mode: PC Engine. Two waveforms with independent stereo balance.
setBpm(110);
pce.setWaveform(0, Array.from({length:32}, (_, index) => index < 16 ? 31 : 0));
pce.setWaveform(1, Array.from({length:32}, (_, index) => index));
pce.setVolume(0, 22); pce.setPan(0, 15, 5);
pce.setVolume(1, 22); pce.setPan(1, 5, 15);

liveLoop('pce-stereo-duet', async () => {
  const leadLine = ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'D4'];
  const bassLine = ['C3', 'C3', 'C3', 'C3', 'G2', 'G2', 'G2', 'G2'];
  for (let step = 0; step < leadLine.length; step++) {
    pce.noteOn(0, leadLine[step]); pce.noteOn(1, bassLine[step]);
    await beat(0.4);
    pce.keyOff(0); pce.keyOff(1);
    await beat(0.1);
  }
});
