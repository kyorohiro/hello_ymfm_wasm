// Author four PSX ADPCM packets directly: 112 decoded frames of a triangle.
// This is an original filter-0 fixture, not a general PCM encoder.
const packets = new Uint8Array(64);
for (let block = 0; block < 4; block++) {
  const at = block * 16;
  packets[at] = 4; // Predictor 0, shift 4.
  packets[at + 1] = block === 0 ? 6 : block === 3 ? 3 : 2;
  for (let i = 0; i < 28; i++) {
    const phase = (block * 28 + i) / 112;
    const value = Math.round(7 * (1 - 4 * Math.abs(phase - 0.5)));
    packets[at + 2 + (i >> 1)] |= (value & 15) << ((i & 1) * 4);
  }
}
const triangle = await spu.loadADPCM(packets, {baseFrequencyHz:44100 / 112, loopStartSamples:0});
spu.setPreset(1, {sample:triangle, volumeLeft:0.7, volumeRight:0.7, adsr2:8});
setBpm(120);
liveLoop('ps1-triangle', async () => {
  for (const note of ['C4', 'E4', 'G4', 'C5']) {
    spu.noteOn(1, note); await beat(0.8);
    spu.keyOff(1); await beat(0.2);
  }
});
