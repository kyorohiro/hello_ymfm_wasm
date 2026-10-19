// Select Mode: Game Gear. The fourth PSG voice supplies short noise percussion.
setBpm(120);
psg.setStereo(0xff);

liveLoop('gg-noise-drums', async () => {
  for (let step = 0; step < 8; step++) {
    psg.noise({
      type: 'white',
      rate: step % 2 ? 'high' : 'low',
      attenuation: step % 2 ? 13 : 10,
    });
    await beat(0.1);
    psg.noiseOff();
    await beat(0.4);
  }
});
