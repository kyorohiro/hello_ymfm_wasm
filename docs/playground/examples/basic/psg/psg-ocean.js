// A deliberately coarse, slow "ocean" using the PSG's single noise channel.
// Periodic PSG noise is a narrow pulse train, so this uses white noise only.
setBpm(24);
psg.reset();

liveCleanup(["psg-ocean"], () => {
  psg.noiseOff();
});

liveLoop("psg-ocean", async () => {
  psg.noise({ type: "white", rate: "low", volume: 0.06 });

  // ---- The wave slowly approaches. ----
  for (const volume of [0.06, 0.14, 0.2, 0.27, 0.34, 0.42]) {
    psg.noiseVolume(volume);
    await beat(0.22);
  }

  // ---- A soft crest. ----
  for (const volume of [0.34, 0.48, 0.62, 0.5, 0.38]) {
    psg.noiseVolume(volume);
    await beat(0.14);
  }

  // ---- The water recedes, with a small returning ripple. ----
  for (const volume of [0.3, 0.22, 0.15, 0.1, 0.05, 0.1]) {
    psg.noiseVolume(volume);
    await beat(0.12);
  }

  await beat(choose([0.5, 0.75, 1, 1.25]));
});
