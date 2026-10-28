// Select Mode: Neo Geo (YM2610) or Neo Geo (YM2610B).
// Six original mono drums → ADPCM-A ROM. No external samples or extra chips.
// ADPCM-A has six one-shot voices at clock/432, without pitch or loop controls.
await livePrepare(`neogeo-adpcm-a-drums-${fm.clock}`, async () => {
  const rate = fm.clock / 432;
  const lengths = [0.25, 0.16, 0.07, 0.21, 0.1, 0.11];
  let noiseState = 0x12345678;
  function makeDrum(voice) {
    const pcm = new Float32Array(Math.ceil(rate * lengths[voice]));
    let phase = 0, previousNoise = 0;
    for (let i = 0; i < pcm.length; i++) {
      const time = i / rate;
      noiseState ^= noiseState << 13; noiseState ^= noiseState >>> 17; noiseState ^= noiseState << 5;
      const noise = (noiseState >>> 0) / 0x80000000 - 1;
      const highNoise = (noise - previousNoise) * 0.5;
      previousNoise = noise;
      let value;
      if (voice === 0) { // Kick: descending oscillator, not a recorded sample.
        phase += 2 * Math.PI * (48 + 115 * Math.exp(-time * 35)) / rate;
        value = 0.6 * Math.sin(phase) * Math.exp(-time * 18);
      } else if (voice === 1) { // Snare: noise and a short drum head.
        value = (0.32 * noise + 0.15 * Math.sin(2 * Math.PI * 185 * time)) * Math.exp(-time * 30);
      } else if (voice === 2) { // Closed hat.
        value = 0.3 * highNoise * Math.exp(-time * 70);
      } else if (voice === 3) { // Tom.
        phase += 2 * Math.PI * (100 + 45 * Math.exp(-time * 25)) / rate;
        value = 0.48 * Math.sin(phase) * Math.exp(-time * 22);
      } else if (voice === 4) { // Wood block.
        value = 0.2 * (Math.sin(2 * Math.PI * 720 * time) +
          0.5 * Math.sin(2 * Math.PI * 1040 * time)) * Math.exp(-time * 55);
      } else { // Shaker.
        value = 0.28 * highNoise * Math.exp(-time * 35) *
          (0.65 + 0.35 * Math.sin(2 * Math.PI * 70 * time));
      }
      // Start at zero; end at zero before the encoder pads to a ROM boundary.
      const fade = Math.min(1, i / (rate * 0.001), (pcm.length - 1 - i) / (rate * 0.008));
      pcm[i] = value * fade;
    }
    return encodeAdpcmA(pcm);
  }
  const encoded = lengths.map((_, voice) => makeDrum(voice));
  const rom = new Uint8Array(encoded.reduce((size, entry) => size + entry.bytes.length, 0));
  let address = 0;
  const ranges = encoded.map(entry => {
    const start = address;
    rom.set(entry.bytes, start);
    address += entry.bytes.length;
    return {start, end:address}; // Exclusive end; both ends are 256-byte aligned.
  });
  adpcmA.keyOff([0, 1, 2, 3, 4, 5]);
  await adpcmA.loadMemory(rom);
  ranges.forEach((range, voice) => adpcmA.setSample(voice, range));
  log(`Six ADPCM-A drums: ${rom.length} ROM bytes at ${rate.toFixed(2)} Hz`);
});
// These are chip voice levels, independent of your Mixer preset.
adpcmA.setVolume(56);
for (let voice = 0; voice < 6; voice++) {
  adpcmA.setVoice(voice, {volume:27, left:true, right:true});
}
setBpm(120);
const steps = [
  [0, 2], [5], [2], [5], [1, 2], [5], [3, 2], [5],
  [0, 2], [5], [0, 2], [5], [1, 2, 4], [5], [3, 2], [4, 5],
];
liveLoop('neogeo-six-drum-voices', async () => {
  for (const voices of steps) {
    adpcmA.keyOn(voices); // Re-trigger selected voices; each stops at its own ROM end.
    await beat(0.25);
  }
});
