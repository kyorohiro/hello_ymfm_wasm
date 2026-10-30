// Saturn SCSP: 32 PCM slots, 512 KiB RAM, fixed 44.1 kHz core.
// Web Audio. Original PCM only; no SSF, BIOS or game files are needed.
const saturn = await useSoundChip('scsp');
setBpm(110);

// Prepare audio also assigns an original sine to all Keyboard slots.
// A raw PCM upload example is in examples/scsp/scsp-stereo-pcm.js.
liveLoop('saturn-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    saturn.noteOn(0, note);
    await beat(0.4);
    saturn.keyOff(0);
    await beat(0.1);
  }
});
