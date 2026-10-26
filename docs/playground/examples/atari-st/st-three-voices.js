// Atari ST YM2149: a melody, harmony and bass on the three physical voices.
setBpm(120);
ay.setVoice(0, {tone: true, noise: false, volume: 9, envelope: false});
ay.setVoice(1, {tone: true, noise: false, volume: 6, envelope: false});
ay.setVoice(2, {tone: true, noise: false, volume: 5, envelope: false});

liveLoop('st-three-voices', async () => {
  const melody = ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4'];
  for (let step = 0; step < melody.length; step++) {
    ay.noteOn(0, melody[step]);
    ay.noteOn(1, step < 4 ? 'E3' : 'D3');
    ay.noteOn(2, step < 4 ? 'C3' : 'G2');
    await beat(0.4);
    ay.allNotesOff();
    await beat(0.1);
  }
});
