// Select Mode: NES + FDS. Triangle bass and short/long noise percussion.
setBpm(120);

liveLoop('nes-rhythm', async () => {
  const bassLine = ['C3', 'C3', 'G2', 'C3', 'F2', 'F2', 'G2', 'G2'];
  for (let step = 0; step < bassLine.length; step++) {
    nes.triangle.noteOn(bassLine[step]);
    nes.noise.setVoice({volume:step % 2 ? 5 : 8, period:step % 2 ? 5 : 10, shortMode:false});
    nes.noise.noteOn();
    await beat(0.12);
    nes.noise.noteOff();
    await beat(0.28);
    nes.triangle.noteOff();
    await beat(0.1);
  }
});
