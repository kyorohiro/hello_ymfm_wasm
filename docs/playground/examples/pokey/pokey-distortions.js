// POKEY: AUDC's eight distortion modes share timers and polynomial generators.
// Mode 5 is the pure tone; other modes can sound noisy or irregular.
setBpm(100);
pokey.setVolume(0, 6);
pokey.setNote(0, 'A4');
liveLoop('pokey-distortions', async () => {
  for (let distortion = 0; distortion < 8; distortion++) {
    pokey.setDistortion(0, distortion);
    pokey.keyOn(0);
    await beat(0.8);
    pokey.keyOff(0);
    await beat(0.2);
  }
});
