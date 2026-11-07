// SPDX-License-Identifier: BSD-3-Clause
// Tick-aware lock-in measurements. No phase/gain fit modifies either PCM stream.
export function pcm16(bytes){
  if(!(bytes instanceof Uint8Array))throw new TypeError('Expected PCM16 bytes');
  if(bytes.length%2)throw Error('Odd PCM16 length');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Float64Array.from({length:bytes.length/2},(_,i)=>view.getInt16(i*2,true)/32768);
}
function solve(matrix,rhs){
  const a=matrix.map((row,i)=>[...row,rhs[i]]),n=rhs.length;
  for(let i=0;i<n;i++){
    let p=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[p][i]))p=j;
    if(Math.abs(a[p][i])<1e-9)throw Error('Degenerate lock-in fit');
    [a[p],a[i]]=[a[i],a[p]];const d=a[i][i];for(let k=i;k<=n;k++)a[i][k]/=d;
    for(let j=0;j<n;j++)if(j!==i){const f=a[j][i];for(let k=i;k<=n;k++)a[j][k]-=f*a[i][k];}
  }
  return a.map(row=>row[n]);
}
export function toneMeasurement(bytes,{rate,clock,baseHz,harmonic=1,startFrame=0}){
  if(!Number.isSafeInteger(rate)||rate<=0||!Number.isSafeInteger(clock)||clock<=0
    ||!Number.isInteger(harmonic)||harmonic<1||harmonic>32||!Number.isFinite(baseHz)||baseHz<=0
    ||baseHz*harmonic>=rate/2||!Number.isSafeInteger(startFrame)||startFrame<0)
    throw new RangeError('Invalid lock-in rate/clock/frequency/harmonic/frame index');
  const pcm=pcm16(bytes),n=pcm.length,terms=1+harmonic*2;
  if(n<32)throw Error('Capture window too short');
  if(!Number.isSafeInteger((startFrame+n)*clock))throw new RangeError('Sample tick product exceeds exact integer range');
  const m=Array.from({length:terms},()=>Array(terms).fill(0)),rhs=Array(terms).fill(0);
  let sum=0,squares=0,peak=0,clipped=0;
  for(let i=0;i<n;i++){
    const y=pcm[i];sum+=y;squares+=y*y;peak=Math.max(peak,Math.abs(y));if(Math.abs(y)>=32767/32768)clipped++;
    const tick=Math.ceil((startFrame+i+1)*clock/rate),theta=2*Math.PI*baseHz*tick/clock;
    const x=[1];for(let h=1;h<=harmonic;h++)x.push(Math.cos(h*theta),Math.sin(h*theta));
    const w=.5-.5*Math.cos(2*Math.PI*i/(n-1));
    for(let j=0;j<terms;j++){rhs[j]+=w*x[j]*y;for(let k=0;k<=j;k++)m[j][k]+=w*x[j]*x[k];}
  }
  for(let j=0;j<terms;j++)for(let k=0;k<j;k++)m[k][j]=m[j][k];
  const c=solve(m,rhs),a=c[2*harmonic-1],b=c[2*harmonic],mean=sum/n;
  return {frames:n,mean,rms:Math.sqrt(squares/n),acRms:Math.sqrt(Math.max(0,squares/n-mean*mean)),peak,clipped,
    amplitude:Math.hypot(a,b),phase:Math.atan2(-b,a),dcFit:c[0],harmonic,
    method:'Hann-weighted simultaneous DC+sin/cos harmonics 1..N at exact emitted chip ticks'};
}
export function bandPassEstimate(rows){
  const sorted=rows.filter(r=>Number.isFinite(r.hz)&&r.hz>0&&Number.isFinite(r.magnitude)&&r.magnitude>0).sort((a,b)=>a.hz-b.hz);let index=0;
  if(sorted.length<3)return {estimatedQ:null,reason:'Insufficient valid frequency points'};
  if(sorted.some((r,i)=>i&&r.hz<=sorted[i-1].hz))return {estimatedQ:null,reason:'Frequency grid must be strictly increasing'};
  for(let i=1;i<sorted.length;i++)if(sorted[i].magnitude>sorted[index].magnitude)index=i;
  const top=sorted[index],threshold=top.magnitude/Math.SQRT2;
  function crossing(a,b){const t=(threshold-a.magnitude)/(b.magnitude-a.magnitude);return Math.exp(Math.log(a.hz)+t*(Math.log(b.hz)-Math.log(a.hz)));}
  let low=null,high=null;
  for(let i=index;i>0;i--)if(sorted[i-1].magnitude<=threshold){low=crossing(sorted[i-1],sorted[i]);break;}
  for(let i=index;i+1<sorted.length;i++)if(sorted[i+1].magnitude<=threshold){high=crossing(sorted[i],sorted[i+1]);break;}
  return {peakHz:top.hz,peakMagnitude:top.magnitude,low3dBHz:low,high3dBHz:high,
    estimatedQ:Number.isFinite(low)&&Number.isFinite(high)&&low>0&&high>low?top.hz/(high-low):null,
    frequencyGridHz:sorted.map(x=>x.hz),method:'Discrete BP peak and log-frequency interpolation of its own -3dB amplitude crossings; approximate'};
}
