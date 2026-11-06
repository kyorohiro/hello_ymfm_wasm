// Hardware cutoff codes are 0..2047, not Hz. This is a 6581 approximation.
// The live loop is software automation of the chip's one shared filter.
setBpm(100);
const voices = /** @type {const} */ ([0, 1, 2]);
for (const voice of voices) {
  sid.setVoice(voice, {waveform:'saw', attack:2, decay:6, sustain:12, release:5});
}
sid.setFilter({mode:'lowpass', cutoff:240, resonance:9, routing:7, volume:8});

liveLoop('sid-filter-sweep', async () => {
  const notes = ['C3','G3','C4'];
  voices.forEach(voice => sid.noteOn(voice, notes[voice]));
  for (let step = 0; step < 48; step++) {
    // Only cutoff changes; envelope and oscillator phase continue.
    const amount = step < 24 ? step / 23 : (47 - step) / 23;
    sid.setFilter({cutoff:Math.round(240 + amount * 1560)});
    await beat(1 / 12);
  }
  sid.allNotesOff();
  await beat(0.5);
});
