// PlayStation SPU: 24 ADPCM voices, 512 KiB RAM, 44,100 Hz native audio.
// An original looping sample is ready on every voice; Keyboard also works before Run.
// Open SPU to inspect the sample and edit a physical voice.
setBpm(120);
spu.setPreset(0, {sample:0, volumeLeft:0.8, volumeRight:0.6, adsr2:8});
liveLoop('ps1-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    spu.noteOn(0, note);
    await beat(0.8);
    spu.keyOff(0);
    await beat(0.2);
  }
});
