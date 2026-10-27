// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMSM5205PCM} from './msm5205_pcm.js';
import {createCddaOffline} from './cdda_offline.js';
import {createCDDAPCM} from './cdda_pcm.js';
import {parseCddaWav} from './cdda_source.js';
import {encodeWav} from './wav.js';
import hucFactory from '../docs/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from './huc6280audioengine.js';
import {Huc6280Synth,Huc6280DirectTransport,HUC6280_CLOCK} from './huc6280synth.js';

const [wasmBinary,adpcmBinary]=await Promise.all([
  readFile(new URL('./generated/cdda_wasm.wasm',import.meta.url)),
  readFile(new URL('./generated/msm5205_wasm.wasm',import.meta.url)),
]);
function fixture(frames=1000){
  const left=new Float32Array(frames),right=new Float32Array(frames);
  for(let i=0;i<frames;++i){left[i]=Math.sin(i*0.07)*0.1;right[i]=Math.sin(i*0.13)*0.09;}
  return encodeWav({left,right,sampleRate:44100});
}
async function devices(sampleRate){
  const psg=await Huc6280AudioEngine.create({moduleFactory:hucFactory,clock:HUC6280_CLOCK,
    outputSampleRate:sampleRate,masterVolume:1});
  const synth=new Huc6280Synth({transport:new Huc6280DirectTransport(psg),clock:HUC6280_CLOCK});
  synth.initialize();synth.setWaveform(0,Array.from({length:32},(_,i)=>i<16?31:0));
  synth.setVolume(0,12);synth.noteOn(0,'C4');
  const adpcm=await createMSM5205PCM({sampleRate,wasmBinary:adpcmBinary});
  adpcm.prepare(Uint8Array.from({length:137},(_,i)=>(i*73+0x37)&255));
  adpcm.setGain(0.7);
  const adpcmSource={sampleRate,mix:{volume:0.6,pan:-0.25,mute:false},
    processFrames(n){const left=new Float32Array(n),right=new Float32Array(n);adpcm.render(left,right);return{left,right};}};
  return{psg,synth,adpcm,adpcmSource,dispose(){synth.dispose();psg.dispose();adpcm.dispose();}};
}
function control(d,frame){
  if(frame===31)d.synth.noteOn(0,'E4');
  if(frame===73)d.adpcm.play({offset:1,length:91,rate:12,loop:true});
  if(frame===137)d.adpcmSource.mix.mute=true;
  if(frame===199)d.adpcmSource.mix.mute=false;
  if(frame===221)d.adpcm.play({offset:5,length:100,rate:13,loop:true});
  if(frame===289)d.adpcm.stop();
}

for(const sampleRate of [44100,48000])test(`actual HuC6280 + MSM5205 + CD-DA offline sum and exact timeline @${sampleRate}`,async()=>{
  const a=await devices(sampleRate),b=await devices(sampleRate),wav=fixture();
  const sources=[{engine:a.psg,volume:0.5,pan:0.25},a.adpcmSource];
  const offline=await createCddaOffline({sampleRate,wasmBinary,sources});
  const cd=await createCDDAPCM({sampleRate,wasmBinary});
  try{
    await offline.cdda.load(wav);await offline.cdda.play();cd.prepare(parseCddaWav(wav).pcm);cd.play();
    for(const frame of [31,73,137,199,221,289])offline.schedule(frame,()=>control(a,frame));
    offline.schedule(361,{type:'stop'});
    const output=offline.render(511),l=new Float32Array(1),r=new Float32Array(1);
    let adpcmAudible=false;
    for(let frame=0;frame<511;++frame){
      control(b,frame);if(frame===361)cd.stop();cd.render(l,r);
      const psg=b.psg.processFrames(1),adpcm=b.adpcmSource.processFrames(1);
      const gain=b.adpcmSource.mix.mute?0:0.6;
      const expectedL=Math.fround(Math.fround(l[0]+psg.left[0]*0.5*0.75)+adpcm.left[0]*gain);
      const expectedR=Math.fround(Math.fround(r[0]+psg.right[0]*0.5)+adpcm.right[0]*gain*0.75);
      assert.equal(output.left[frame],expectedL,`left frame ${frame}`);
      assert.equal(output.right[frame],expectedR,`right frame ${frame}`);
      if(frame>=73&&frame<137&&Math.abs(adpcm.left[0])>0.001)adpcmAudible=true;
      if(frame>=289)assert.equal(adpcm.left[0],0,'ADPCM Stop is strictly silent');
    }
    assert(adpcmAudible);assert(output.left.every(Number.isFinite));assert(output.left.some(v=>Math.abs(v)>0.01));
    assert.equal(a.psg.getMasterVolume(),1);assert.equal(a.adpcm.readState().gain,0.7);
    assert.equal(a.adpcm.readState().outputFrames,511);assert.deepEqual(a.adpcm.readState(),b.adpcm.readState());
    const bytes=encodeWav(output),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    assert.equal(view.getUint32(24,true),sampleRate);assert.equal(view.getUint32(40,true),511*4);
  }finally{offline.dispose();cd.dispose();a.dispose();b.dispose();}
});

test('three actual cores preserve playback under different offline render partitions',async()=>{
  const sampleRate=48000,a=await devices(sampleRate),b=await devices(sampleRate),wav=fixture();
  const x=await createCddaOffline({sampleRate,wasmBinary,sources:[a.psg,a.adpcmSource]});
  const y=await createCddaOffline({sampleRate,wasmBinary,sources:[b.psg,b.adpcmSource]});
  try{
    for(const [offline,d]of[[x,a],[y,b]]){
      await offline.cdda.load(wav);await offline.cdda.play();
      for(const frame of [31,73,137,199,221,289])offline.schedule(frame,()=>control(d,frame));
      offline.schedule(361,{type:'stop'});
    }
    const expected=x.render(511),left=[],right=[];
    for(const n of [1,17,128,3,129,233]){const block=y.render(n);left.push(...block.left);right.push(...block.right);}
    assert.deepEqual(left,[...expected.left]);assert.deepEqual(right,[...expected.right]);
    assert.deepEqual(a.adpcm.readState(),b.adpcm.readState());
    assert.deepEqual(await x.cdda.getState(),await y.cdda.getState());
  }finally{x.dispose();y.dispose();a.dispose();b.dispose();}
});
