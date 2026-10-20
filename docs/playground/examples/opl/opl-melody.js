// Works in all OPL modes: OPL, OPL2, Y8950 FM and OPL3.
setBpm(112);
opl.setPreset(0, OPL_PRESETS.bell);
opl.setPreset(1, OPL_PRESETS.organ);

liveLoop('opl-duet', async () => {
  for (const [lead, bass] of [['C4', 'C3'], ['E4', 'C3'], ['G4', 'G2'], ['B4', 'G2']]) {
    opl.noteOn(0, lead);
    opl.noteOn(1, bass);
    await beat(0.7);
    opl.keyOff(0);
    opl.keyOff(1);
    await beat(0.3);
  }
});
