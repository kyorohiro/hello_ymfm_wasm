// CPU-free SID 6581 approximation. Three physical voices: 0..2.
// Run this code, then open SID to inspect the applied voice and shared filter.
setBpm(112);
sid.setVoice(0, {waveform:'saw', attack:2, decay:6, sustain:12, release:5});
sid.setFilter({mode:'off', routing:0, volume:8});

liveLoop('sid-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'G4', 'E4', 'D4', 'G3']) {
    sid.noteOn(0, note);
    await beat(0.7);
    sid.keyOff(0); // Gate off uses the hardware release envelope.
    await beat(0.3);
  }
});
