// Select Mode: Genesis, Mega CD, 32X, or 32X Nuked.
// The built-in FM and PSG play together; no extra chip is needed.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);

liveLoop('fm-and-psg', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    psg.tone(PSG1, {note, attenuation: 10});
    await play(note, {channel: CH1, beats: 0.4});
    psg.off(PSG1);
    await beat(0.1);
  }
});
