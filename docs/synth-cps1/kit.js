// Original synthesized percussion encoded at the OKI playback rate.
export const samples = ['Kick', 'Snare', 'Closed hat', 'Arcade hit'];
export function createKit() {
  const rom = new Uint8Array(0x400 + samples.length * 1024);
  let seed = 21;
  for (let id = 0; id < samples.length; id++) {
    const start = 0x400 + id * 1024;
    const length = [900, 740, 310, 960][id];
    const end = start + length - 1;
    rom.set([start >> 16, start >> 8, start, end >> 16, end >> 8, end], id * 8);
    const pcm = new Float64Array(length * 2);
    let phase = 0, previousNoise = 0;
    for (let n = 0; n < length * 2; n++) {
      const t = n / (length * 2);
      phase += (70 + 150 * Math.exp(-12*t)) / (1000000 / 132);
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 0x80000000 - 1;
      const tone = Math.sin(2*Math.PI*phase);
      const impact = .55*Math.sin(phase*3) + .45*noise;
      const sample = [tone, .75*noise + .25*tone, .5*(noise-previousNoise), impact][id];
      previousNoise = noise;
      const target = 1800 * sample * Math.exp(-6*t);
      pcm[n] = target;
    }
    rom.set(encodeSample(pcm),start);
  }
  return rom;
}

// Signed 12-bit PCM, packed high nibble first for the MSM6295.
export function encodeSample(pcm) {
  const bytes = new Uint8Array(Math.max(2, Math.ceil(pcm.length / 2)));
  let predictor = 0, stepIndex = 0;
  for (let n = 0; n < bytes.length * 2; n++) {
    const target = pcm[n] ?? 0;
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
    bytes[n >> 1] |= nibble << (n % 2 ? 0 : 4);
  }
  return bytes;
}

// Four original cues for comparing the four fixed-rate PCM voices.
export function createSampleBank() {
  const names=['','Coin','Spring','Bell','Power down'];
  const rate=1000000/132;
  const clips=[0.18,0.35,0.5,0.42].map((duration,i)=>{
    const pcm=new Float32Array(Math.ceil(duration*rate));
    let phase=0;
    for(let n=0;n<pcm.length;n++){
      const t=n/rate;
      const hz=[t<0.065?880:1320,420+130*Math.sin(28*t),550,620-480*t/duration][i];
      phase+=2*Math.PI*hz/rate;
      const wave=i===2?(Math.sin(phase)+0.4*Math.sin(2.73*phase))/1.4:Math.sin(phase);
      pcm[n]=1750*wave*Math.min(1,t*500)*Math.exp(-5*t/duration);
    }
    return encodeSample(pcm);
  });
  const bytes=new Uint8Array(0x400+clips.reduce((n,c)=>n+c.length,0));
  let start=0x400;
  clips.forEach((clip,i)=>{
    const end=start+clip.length-1;
    bytes.set([start>>16,start>>8,start,end>>16,end>>8,end],8*(i+1));
    bytes.set(clip,start);start=end+1;
  });
  return {kind:'bank',name:'1_sample.rom',names,bytes,voiceSamples:[1,2,3,4]};
}
