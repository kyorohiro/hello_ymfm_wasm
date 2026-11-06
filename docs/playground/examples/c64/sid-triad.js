// Three SID voices make a triad; all voices share one filter and volume.
setBpm(92);
const voices = /** @type {const} */ ([0, 1, 2]);
for (const voice of voices) {
  sid.setVoice(voice, {waveform:'pulse', pulseWidth:1536,
    attack:3, decay:7, sustain:10, release:6});
}
sid.setFilter({mode:'lowpass', cutoff:1500, resonance:3, routing:7, volume:8});

liveLoop('sid-triad', async () => {
  for (const notes of [['C4','E4','G4'], ['A3','C4','E4'], ['F3','A3','C4'], ['G3','B3','D4']]) {
    voices.forEach(voice => sid.noteOn(voice, notes[voice]));
    await beat(1.6);
    sid.allNotesOff();
    await beat(0.4);
  }
});
