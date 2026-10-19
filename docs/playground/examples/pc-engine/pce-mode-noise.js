// Select Mode: PC Engine. Physical channels 4 and 5 support noise.
setBpm(120);
pce.setVolume(4, 24); pce.setPan(4, 15, 10);
pce.setVolume(5, 20); pce.setPan(5, 10, 15);
pce.setNoise(4, {enabled:true, frequency:18});
pce.setNoise(5, {enabled:true, frequency:28}); // Frequency is a hardware code 0..31.

liveLoop('pce-noise-drums', async () => {
  for (let step = 0; step < 8; step++) {
    const channel = step % 2 ? 5 : 4;
    pce.keyOn(channel);
    await beat(step % 2 ? 0.12 : 0.2);
    pce.keyOff(channel);
    await beat(step % 2 ? 0.38 : 0.3);
  }
});
