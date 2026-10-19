// Select Mode: Game Boy. Shape percussion with the built-in noise channel.
setBpm(120);

liveLoop('noise-drums', async () => {
  for (let step = 0; step < 8; step++) {
    gameboy.noise.setVoice({
      volume: step % 2 ? 7 : 10,
      envelope: {direction: 'down', period: 1},
      divisor: step % 2 ? 1 : 4,
      shift: step % 2 ? 2 : 5,
      width: 15,
    });
    gameboy.noise.keyOn();
    await beat(0.2);
    gameboy.noise.keyOff();
    await beat(0.3);
  }
});
