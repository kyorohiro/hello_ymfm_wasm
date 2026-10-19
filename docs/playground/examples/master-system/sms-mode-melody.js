// Select Mode: Master System. A square-wave melody with a separate bass voice.
setBpm(120);

liveLoop('sms-two-tone', async () => {
  const melody = ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'D4'];
  const bass = ['C3', 'C3', 'C3', 'C3', 'G3', 'G3', 'G3', 'G3'];
  for (let step = 0; step < melody.length; step++) {
    psg.tone(PSG1, {note: melody[step], attenuation: 9});
    psg.tone(PSG2, {note: bass[step], attenuation: 12});
    await beat(0.4);
    psg.off(PSG1);
    psg.off(PSG2);
    await beat(0.1);
  }
});
