// MSX: YM2413 OPLL and Y8950 OPL are separate FM chips.
setBpm(120);
opll.setUserPatch(OPLL_USER_PRESETS.bell); // One shared User patch, not one per CH.
opll.setVoice(0, {instrument: 0, attenuation: 6, sustain: false});
opll.setVoice(1, {instrument: 4, attenuation: 7, sustain: false}); // ROM Flute.
opl.setPreset(0, OPL_PRESETS.organ);
opl.setOperator(0, 0, {tl: 30});
opl.setOperator(0, 1, {tl: 26});

liveLoop('msx-two-fm-chips', async () => {
  for (const notes of [['C4', 'E4', 'G3'], ['A3', 'C4', 'E3'], ['F3', 'A3', 'C3'], ['G3', 'B3', 'D3']]) {
    opll.noteOn(0, notes[0]);
    opll.noteOn(1, notes[1]);
    opl.noteOn(0, notes[2]);
    await beat(0.8);
    opll.keyOff(0);
    opll.keyOff(1);
    opl.keyOff(0);
    await beat(0.2);
  }
});

// Both FM chips have nine melodic channels (0..8); rhythm changes ownership.
// The OPLL User patch affects instrument-0 channels only; ROM Flute stays fixed.
