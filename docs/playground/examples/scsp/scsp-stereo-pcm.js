// Original signed PCM16. 64 samples at 44100 Hz have a root of 44100 / 64 Hz.
// This example also works as an additional SCSP in other Web Audio modes.
const saturn = await useSoundChip('scsp');
saturn.reset({clearRam:true});
const pcm = Int16Array.from({length:64}, (_,i) => Math.round(8192 * Math.sin(2 * Math.PI * i / 64)));
const wave = await saturn.loadPCM(pcm, {baseFrequencyHz:44100 / 64, loopStartSamples:0});
saturn.setPreset(0, {sample:wave, totalLevel:12, pan:31, envelope:{attackRate:31, releaseRate:24}});
saturn.setPreset(1, {sample:wave, totalLevel:12, pan:15, envelope:{attackRate:31, releaseRate:24}});
setBpm(120);
liveLoop('saturn-stereo', async () => {
  for (const note of ['C4', 'E4', 'G4', 'C5']) {
    saturn.noteOn(0, note);
    saturn.noteOn(1, 'C3');
    await beat(0.4);
    saturn.keyOff(0);
    saturn.keyOff(1);
    await beat(0.1);
  }
});
