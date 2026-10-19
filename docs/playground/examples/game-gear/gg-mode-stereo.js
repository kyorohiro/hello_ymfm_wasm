// Select Mode: Game Gear. Route PSG1 left, then right, one note at a time.
// Bits 4..7 enable the left speaker; bits 0..3 enable the right speaker.
setBpm(120);
psg.setStereo(0xff);

liveLoop('gg-stereo-melody', async () => {
  const notes = ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'D4'];
  for (let step = 0; step < notes.length; step++) {
    psg.setStereo(step % 2 ? 0xef : 0xfe); // PSG1 right only / left only.
    psg.tone(PSG1, {note: notes[step], attenuation: 9});
    await beat(0.4);
    psg.off(PSG1);
    await beat(0.1);
  }
  psg.setStereo(0xff);
});
