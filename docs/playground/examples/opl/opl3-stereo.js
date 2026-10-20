// OPL3 channel outputs are routed left / right, rather than a continuous pan.
setBpm(120);
opl.setPreset(0, OPL_PRESETS.bell);
opl.setPreset(9, OPL_PRESETS.bell);
opl.setPan(0, true, false);
opl.setPan(9, false, true);

liveLoop('opl3-stereo', async () => {
  for (const [channel, note] of [[0, 'C4'], [9, 'E4'], [0, 'G4'], [9, 'C5']]) {
    opl.noteOn(channel, note);
    await beat(0.6);
    opl.keyOff(channel);
    await beat(0.4);
  }
});
