// SPDX-License-Identifier: BSD-3-Clause
export const duetSamplePath='/samples/cabinet-pluck.wav';

// 32 cycles at C4. The harmonics brighten after the first four cycles.
function monoWav(frames,rate,sample){
  const bytes=new Uint8Array(44+frames),d=new DataView(bytes.buffer);
  const text=(i,s)=>bytes.set(new TextEncoder().encode(s),i);
  text(0,'RIFF');d.setUint32(4,bytes.length-8,true);text(8,'WAVEfmt ');
  d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
  d.setUint32(24,rate,true);d.setUint32(28,rate,true);d.setUint16(32,1,true);
  d.setUint16(34,8,true);text(36,'data');d.setUint32(40,frames,true);
  for(let i=0;i<frames;i++)bytes[44+i]=128+Math.round(126*sample(i));
  return bytes;
}
export function cabinetPluck(){
  const period=64;
  return monoWav(period*32,16744,i=>{
    const phase=i*2*Math.PI/period,body=.58*Math.sin(phase);
    const t=Math.max(0,i/period-4);
    const color=(1-Math.exp(-2*t))*Math.exp(-t/7);
    return body+color*(.26*Math.sin(3*phase)+.14*Math.sin(5*phase));
  });
}
export const drumPath='/samples/cabinet-snare.wav';
export function cabinetSnare(){
  let seed=1329;
  return monoWav(4000,16000,i=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const t=i/16000,noise=2*seed/4294967296-1;
    return .68*noise*Math.exp(-32*t)+.3*Math.sin(2*Math.PI*(180*t+1-Math.exp(-25*t)))*Math.exp(-40*t);
  });
}

export const sampleDuet=`// One WAV, two voices. Open ROM and select the sample bank to compare CH1 and CH2.
const path = '/samples/cabinet-pluck.wav';
qsound.assignSample(1, path, { length: 256, loop: 64 });
qsound.assignSample(2, path);
setBpm(108);

liveLoop('bass', async () => {
  for (const note of [36, 43, 39, 41]) {
    qsound.noteOn(1, note);
    await beat(0.75);
    qsound.noteOff(1);
    await beat(0.25);
  }
});

liveLoop('pluck', async () => {
  for (const note of [60, 67, 63, 70, 67, 65, 63, 62]) {
    qsound.noteOn(2, note);
    await beat(0.375);
    qsound.noteOff(2);
    await beat(0.125);
  }
});
`;
