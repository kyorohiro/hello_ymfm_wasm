// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createFm2608GuardAudio} from '../../test/helpers/fm2608_adpcm_guard_audio.mjs';
import {encodeAdpcmB} from '../js/adpcm_b_sample.js';
import {waveShape,encodeBase64} from './preset.js';

function floatWav(samples,sampleRate) {
  const bytes=new Uint8Array(44+samples.length*4),view=new DataView(bytes.buffer);
  const text=(at,value)=>{for(let i=0;i<value.length;i++)bytes[at+i]=value.charCodeAt(i);};
  text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,3,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*4,true);
  view.setUint16(32,4,true);view.setUint16(34,32,true);text(36,'data');view.setUint32(40,samples.length*4,true);
  for(let i=0;i<samples.length;i++)view.setFloat32(44+i*4,samples[i],true);
  return bytes;
}

// Keep the intended amplitude and DC in the error. Only phase is fitted;
// normalizing amplitude could hide repeat-state overshoot or attenuation.
function fit(output,source,rate,hz) {
  const step=hz*source.length/rate,gain=192/256/2;
  const error=phase=>{
    let sum=0;
    for(let i=0;i<output.length;i++) {
      const position=(i*step+phase+source.length)%source.length,first=Math.floor(position),fraction=position-first;
      const expected=(source[first]*(1-fraction)+source[(first+1)%source.length]*fraction)*gain;
      sum+=(output[i]-expected)**2;
    }
    return sum/output.length;
  };
  let best=Infinity,phase=0;
  for(let p=0;p<source.length;p+=.25){const value=error(p);if(value<best){best=value;phase=p;}}
  const coarse=phase;
  for(let p=coarse-.25;p<=coarse+.25;p+=.015625){const value=error(p);if(value<best){best=value;phase=p;}}
  return {error:Math.sqrt(best),peak:output.reduce((max,value)=>Math.max(max,Math.abs(value)),0),
    mean:output.reduce((sum,value)=>sum+value,0)/output.length};
}

async function render(rate,preset,source) {
  const f=await createFm2608GuardAudio(rate);
  try {
    await f.audio.applyPreset(preset);await f.audio.noteOn('adpcm',0,60);
    const delta=f.chip.adpcm.registers[9]|f.chip.adpcm.registers[10]<<8;
    // Repeat resets the fractional position at the final nibble, so the
    // actual period is an integer number of chip clocks.
    const hz=(f.chip.clock/144)/Math.ceil(source.length*65536/delta),output=f.render(Math.round(rate*.2)).left;
    return {hz,fresh:fit(output.subarray(0,Math.ceil(rate/hz)),source,rate,hz),
      repeat:fit(output.subarray(Math.round(rate*.1),Math.round(rate*.15)),source,rate,hz)};
  }finally{await f.dispose();}
}

for(const rate of [44100,48000])for(const shape of ['saw','square'])
test(`actual OPNA ${rate}Hz ${shape} waveform and WAV keep amplitude while improving Repeat fidelity`,async()=>{
  const f=await createFm2608GuardAudio(rate),source=Float32Array.from(waveShape(shape)),sampleRate=33488;
  let app;
  try {
    const drawn=await f.audio.setWave(source,{rootNote:60,sampleRate});
    app=await f.audio.loadAudio(floatWav(source,sampleRate),{rootNote:60,sampleRate});
    assert.deepEqual(app.adpcm,drawn.adpcm,'WAV bytes and drawn PCM use the same app encoder and metadata');
  }finally{await f.dispose();}
  const old=structuredClone(app),encoded=encodeAdpcmB({channels:[source],sampleRate},app.adpcm.sampleRate);
  old.adpcm.data=encodeBase64(encoded.bytes);old.adpcm.end=encoded.bytes.length;
  for(const key of ['rootNote','sampleRate','address','start','end','volume','left','right','repeat'])
    assert.equal(app.adpcm[key],old.adpcm[key],key+' cannot compensate for a changed waveform');
  const before=await render(rate,old,source),after=await render(rate,app,source);
  assert.equal(after.hz,before.hz);
  assert(after.fresh.error<=before.fresh.error*1.003,'fresh native fidelity is retained within the sub-frame seam tolerance');
  assert(after.repeat.error<before.repeat.error*(shape==='saw'?.9:.83),'Repeat is closer to the unchanged intended PCM');
  assert(after.repeat.peak<(shape==='saw'?.225:.235),'no new peak overshoot may hide behind lower RMS error');
  assert(Math.abs(after.repeat.mean)<.006,'the improvement does not create a DC offset');
});
