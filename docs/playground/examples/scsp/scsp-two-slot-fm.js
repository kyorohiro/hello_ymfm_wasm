// Original 2-slot SCSP FM example. Runs in Main / Worker / updated Native hosts.
// This is hardware waveform-address modulation, not an LFO or a DSP effect.
// The fixed core has zero slot-write delay; physical SCSP timing is not claimed.
const saturn = await useSoundChip('scsp');
saturn.reset({clearRam:true});
const pcm = Int16Array.from({length:64}, (_,i) => Math.round(8192*Math.sin(2*Math.PI*i/64)));
// Periodically repeated guards isolate every modulated read from adjacent PCM.
const wave = await saturn.loadPCM(pcm, {
  baseFrequencyHz:44100/64, loopStartSamples:0, modulationDepth:12,
});
// Slot 1 (API slot 0) is a silent modulator. TL changes its FM strength.
saturn.setPreset(0, {sample:wave, directLevel:0, totalLevel:0});
// Slot 2 (API slot 1) is the carrier. Both X/Y receive the same modulator.
// With this core's zero write delay, offset 63 means the preceding slot's
// current frame. Offset 31 means its previous frame. These are not slot IDs.
saturn.setPreset(1, {sample:wave, totalLevel:16, modulation:{depth:9,xOffset:63,yOffset:63}});
setBpm(100);
liveLoop('saturn-two-slot-fm', async () => {
  for (const note of [60,64,67,72]) {
    saturn.noteOn(0,note+12);
    saturn.noteOn(1,note);
    await beat(.8);
    saturn.keyOff(0);
    saturn.keyOff(1);
    await beat(.2);
  }
});
// Select Slot 2 in the SCSP tab and change MDL (0..12) while listening.
// Each voice uses two physical slots. This example is a single linked voice.
