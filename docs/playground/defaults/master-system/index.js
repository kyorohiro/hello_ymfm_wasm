// Select Mode: Master System. Three PSG tones and one noise voice, in mono.
setBpm(120);

liveLoop('sms-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    psg.tone(PSG1, {note, attenuation: 9});
    await beat(0.4);
    psg.off(PSG1);
    await beat(0.1);
  }
});

liveLoop('sms-rhythm', async () => {
  psg.noise({type: 'white', rate: 'high', attenuation: 12});
  await beat(0.1);
  psg.noiseOff();
  await beat(0.9);
});
