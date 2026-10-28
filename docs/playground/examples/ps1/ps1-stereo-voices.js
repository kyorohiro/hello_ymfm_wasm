// Two physical SPU voices share the original sample, with independent stereo gains.
setBpm(120);
spu.setPreset(0, {sample:0, volumeLeft:0.9, volumeRight:0.25, adsr2:9});
spu.setPreset(23, {sample:0, volumeLeft:0.25, volumeRight:0.9, adsr2:9});
liveLoop('ps1-stereo', async () => {
  for (const note of ['C4', 'E4', 'G4', 'C5']) {
    spu.noteOn(0, note);
    spu.noteOn(23, 'C3');
    await beat(0.8);
    spu.keyOff(0); spu.keyOff(23);
    await beat(0.2);
  }
});
