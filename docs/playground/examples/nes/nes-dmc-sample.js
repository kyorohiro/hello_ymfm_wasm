// DMC plays 1-bit DPCM bytes, not ordinary PCM. No cartridge or ROM needed.
const nes = await createSoundChip('nes');
try {
  await mixer.set(nes.id, {volume: 0.6});
  // Alternating runs of increasing/decreasing DAC steps form a repeating wave.
  const dpcm = Uint8Array.from({length: 257}, (_, i) => i % 8 < 4 ? 0xff : 0x00);
  await nes.dmc.loadSample(dpcm); // Wait until sample RAM is ready in the Worklet.
  for (const rate of [8, 12, 15]) {
    nes.dmc.play({rate, loop: true, level: 64});
    await sleep(0.5);
    nes.dmc.stop();
    await sleep(0.1);
  }
} finally { nes.dispose(); }
