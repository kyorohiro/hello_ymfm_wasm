// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFm2608GuardAudio} from '../../test/helpers/fm2608_adpcm_guard_audio.mjs';
import {waveShape,decodeAdpcm,decodeBase64,encodeBase64,encodeGeneratedSine} from './preset.js';
import {encodeAdpcmB} from '../js/adpcm_b_sample.js';

const legacyTriangle=() => Array.from({length:128},(_,i) => .6*(1-4*Math.abs(i/128-.5)));
const maxStep=samples => samples.slice(1).reduce((max,value,index) => Math.max(max,Math.abs(value-samples[index])),0);
const rms=samples => Math.sqrt(samples.reduce((sum,value) => sum+value*value,0)/samples.length);
function period(samples,rate) {
  const hz=440*2**((60-69)/12);let best=-Infinity,lag=0;
  for(let offset=Math.floor(rate/(hz+10));offset<=Math.ceil(rate/(hz-10));offset++) {
    let correlation=0;
    for(let i=offset;i<samples.length;i++)correlation+=samples[i]*samples[i-offset];
    correlation/=samples.length-offset;
    if(correlation>best){best=correlation;lag=offset;}
  }
  return lag;
}
async function render(rate,source) {
  const f=await createFm2608GuardAudio(rate);
  try {
    const preset=await f.audio.setWave(source,{rootNote:60});
    await f.audio.noteOn('adpcm',0,60);
    return {preset,decoded:decodeAdpcm(decodeBase64(preset.adpcm.data)),pcm:f.render(Math.round(rate*.3)).left};
  } finally {await f.dispose();}
}

for(const rate of [44100,48000])test(`actual OPNA ${rate}Hz repeated Triangle no longer contains the reset plunge`,async() => {
  const before=await render(rate,legacyTriangle()),after=await render(rate,waveShape('triangle'));
  assert.equal(decodeBase64(after.preset.adpcm.data).length,64);
  for(const key of ['rootNote','sampleRate','address','start','end','volume','left','right','repeat'])
    assert.equal(after.preset.adpcm[key],before.preset.adpcm[key],key+' remains unchanged');
  assert(maxStep(after.pcm)<maxStep(before.pcm)*.12,'native repeated discontinuity drops by at least88%');
  assert(rms(after.pcm)>.1&&rms(after.pcm)>rms(before.pcm)*.95,'the waveform is not hidden by attenuation');
  assert.equal(period(after.pcm,rate),period(before.pcm,rate),'actual repeated period is unchanged');
  assert(Math.max(...after.decoded.slice(0,8))<.15&&Math.min(...after.decoded.slice(0,8))>=0);
});

function sineFit(samples,rate,hz) {
  let ss=0,cc=0,sc=0,s=0,c=0,y=0,sy=0,cy=0;
  for(let index=0;index<samples.length;index++) {
    const phase=index*2*Math.PI*hz/rate,si=Math.sin(phase),co=Math.cos(phase),value=samples[index];
    ss+=si*si;cc+=co*co;sc+=si*co;s+=si;c+=co;y+=value;sy+=si*value;cy+=co*value;
  }
  const n=samples.length,det=(ss-s*s/n)*(cc-c*c/n)-(sc-s*c/n)**2;
  const a=((sy-s*y/n)*(cc-c*c/n)-(cy-c*y/n)*(sc-s*c/n))/det;
  const b=((cy-c*y/n)*(ss-s*s/n)-(sy-s*y/n)*(sc-s*c/n))/det;
  const amplitude=Math.hypot(a,b),dc=(y-a*s-b*c)/n;
  // Compare the actual native output to the intended amplitude, retaining DC
  // error. Only phase is aligned; no gain normalization can hide bad encoding.
  const intended=.6*192/256/2;
  let error=0;
  for(let index=0;index<n;index++) {
    const phase=index*2*Math.PI*hz/rate;
    error+=(samples[index]-intended*(a*Math.sin(phase)+b*Math.cos(phase))/amplitude)**2;
  }
  return {amplitude,dc,error:Math.sqrt(error/n)};
}

async function renderSine(rate,root,generated) {
  const f=await createFm2608GuardAudio(rate);
  try {
    const sampleRate=440*2**((root-69)/12)*128;
    const delta=Math.round(sampleRate*144*65536/8000000),actualRate=delta*8000000/(144*65536);
    const pcm={channels:[Float32Array.from(waveShape('sine'))],sampleRate};
    const encoded=generated?encodeGeneratedSine(pcm,actualRate):encodeAdpcmB(pcm,actualRate);
    const preset=f.audio.getPreset();
    Object.assign(preset.adpcm,{data:encodeBase64(encoded.bytes),sampleRate:actualRate,rootNote:root});
    await f.audio.applyPreset(preset);
    await f.audio.noteOn('adpcm',0,root);
    const output=f.render(Math.round(rate*.5)).left.subarray(Math.round(rate*.1));
    // Repeat resets fractional ADPCM position at the last nibble; its cycle is
    // an integer count of chip clocks, rather than the unrounded target rate.
    const hz=(8000000/144)/Math.ceil(128*65536/delta);
    return {preset,output,fit:sineFit(output,rate,hz)};
  } finally {await f.dispose();}
}

for(const rate of [44100,48000])for(const root of [36,60,68])
test(`actual OPNA ${rate}Hz generated Sine keeps repeat fidelity at root${root}`,async() => {
  const before=await renderSine(rate,root,false),after=await renderSine(rate,root,true);
  for(const key of ['rootNote','sampleRate','address','start','end','volume','left','right','repeat'])
    assert.equal(after.preset.adpcm[key],before.preset.adpcm[key],key+' remains unchanged');
  assert(Math.abs(after.fit.amplitude-.225)<.004,'the repeated Sine retains its intended native amplitude');
  assert(Math.abs(after.fit.dc)<.003,'Repeat does not exchange onset error for a DC bias');
  assert(after.fit.error<before.fit.error*.55,'native output is closer to the intended Sine, not only a prettier preview');
  assert(maxStep(after.output)<maxStep(before.output)*1.08,'Repeat discontinuities do not grow materially');
});
