// Master System: built-in YM2413 instruments. No patch or sample upload needed.
setBpm(120);
opll.setVoice(0, {attenuation: 5, sustain: false});

liveLoop('sms-opll-instruments', async () => {
  for (const instrument of [1, 2, 3, 4, 8, 12, 14, 15]) {
    opll.setInstrument(0, instrument);
    log(instrument, OPLL_INSTRUMENTS[instrument]);
    for (const note of ['C4', 'E4', 'G4', 'C5']) {
      opll.noteOn(0, note);
      await beat(0.35);
      opll.keyOff(0);
      await beat(0.15);
    }
  }
});

// Instrument 0 is the one shared User patch; instruments 1..15 are fixed ROM.
