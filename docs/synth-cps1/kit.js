// Original synthesized percussion encoded at the OKI playback rate.
export const samples = ['Kick', 'Snare', 'Closed hat'];
export function createKit() {
  const rom = new Uint8Array(0x400 + 3 * 1024);
  let seed = 21;
  for (let id = 0; id < samples.length; id++) {
    const start = 0x400 + id * 1024;
    const length = [900, 740, 310][id];
    const end = start + length - 1;
    rom.set([start >> 16, start >> 8, start, end >> 16, end >> 8, end], id * 8);
    let phase = 0, predictor = 0, stepIndex = 0, previousNoise = 0;
    for (let n = 0; n < length * 2; n++) {
      const t = n / (length * 2);
      phase += (70 + 150 * Math.exp(-12*t)) / (1000000 / 132);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 0x80000000 - 1;
      const tone = Math.sin(2*Math.PI*phase);
      const sample = [tone, .75*noise + .25*tone, .5*(noise-previousNoise)][id];
      previousNoise = noise;
      const target = 1800 * sample * Math.exp(-6*t);
      const step = Math.floor(16 * 1.1**stepIndex);
      let distance = Math.abs(target-predictor), delta = step>>3, magnitude = 0;
      for (const bit of [4,2,1]) {
        const weight = bit === 4 ? step : bit === 2 ? step>>1 : step>>2;
        if (distance >= weight) {distance -= weight; delta += weight; magnitude |= bit;}
      }
      const negative = target < predictor;
      const nibble = (negative ? 8 : 0) | magnitude;
      predictor = Math.min(2047,Math.max(-2048,predictor + (negative ? -delta : delta)));
      stepIndex = Math.min(48,Math.max(0,stepIndex + [-1,-1,-1,-1,2,4,6,8][magnitude]));
      rom[start + (n >> 1)] |= nibble << (n % 2 ? 0 : 4);
    }
  }
  return rom;
}
