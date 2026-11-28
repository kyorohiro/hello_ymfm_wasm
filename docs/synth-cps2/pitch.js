// SPDX-License-Identifier: BSD-3-Clause
// Estimate one local period using YIN's cumulative normalized difference.
function periodOf(samples,hz){
  const window=Math.min(1024,Math.floor(samples.length/2));
  const limit=Math.min(window,Math.floor(hz/35));
  if(limit<8)return null;
  let sum=0,squares=0;
  for(let i=0;i<window;i++){sum+=samples[i];squares+=samples[i]**2;}
  if(squares/window-(sum/window)**2<4)return null;
  const diff=new Float64Array(limit+1);
  let total=0;
  for(let lag=1;lag<=limit;lag++){
    let delta=0;
    for(let i=0;i<window;i++)delta+=(samples[i]-samples[i+lag])**2;
    total+=delta;
    diff[lag]=total?delta*lag/total:1;
    const mid=lag-1;
    if(mid<Math.max(3,hz/3500) || diff[mid]>=0.12 || diff[mid]>=diff[mid-1] || diff[mid]>diff[lag])continue;
    const offset=(diff[mid-1]-diff[lag])/(2*(diff[mid-1]-2*diff[mid]+diff[lag]));
    return mid+offset;
  }
  return null;
}

export function presetPitches(bytes,p,tickRate){
  const rate=p.rate||4096;
  function measure(start,length,loop){
    if(!length)return null;
    const samples=new Int8Array(loop?2048:Math.min(2048,length));
    for(let i=0;i<samples.length;i++){
      const address=(start+i%length)&65535;
      if(address>=bytes.length)return null;
      samples[i]=bytes[address];
    }
    const period=periodOf(samples,tickRate);
    if(!period)return null;
    const hz=tickRate*rate/(4096*period);
    const midi=Math.round(69+12*Math.log2(hz/440));
    const name=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][(midi%12+12)%12]+(Math.floor(midi/12)-1);
    const c4Rate=Math.round(4096*period*261.625565/tickRate);
    return {hz,name,c4Rate};
  }
  const length=(p.end-p.start)&65535;
  return {onset:measure(p.start,length,false),loop:p.loop>0 && p.loop<32768?measure(p.end-p.loop,p.loop,true):null};
}
