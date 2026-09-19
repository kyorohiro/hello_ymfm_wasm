import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,exportNodeSamples,exportSourceSamples} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {extractSamples} from '../docs/vgm_analyzer/sample_core.js';
import {configureSamplePreview,renderSamplePreview} from '../docs/vgm_analyzer/sample_render.js';
import {Ym2610B} from '../docs/js/ym2610b.js';
import {pwmCaptureWav} from '../docs/vgm_analyzer/pwm_samples.js';
import {encodeStereoWav} from '../docs/vgm_analyzer/vgm_wav.js';
const fixture=n=>new URL('./fixtures/'+n+'.vgz',import.meta.url);
test('ADPCM sample WAV matches previous Browser construction and disposes copied PCM safely',async()=>{
 for(const name of ['ym2610-adpcm-a','ym2610-adpcm-b']){
  const source=await readSource(fixture(name)),r=await extractSamples(source),s=r.samples[0],e=r.events[0];
  const chip=await Ym2610B.create({moduleFactory:await getNodePlaybackFactory('ym2610b')});
  let expected;
  try{
   configureSamplePreview(chip,s,e);
   const rate=chip.sampleRate(e.clock),frames=Math.min(Math.ceil(rate*10),Math.ceil(s.size*2/e.rate*rate)+1024);
   const pcm=chip.generateStereo(frames);
   expected=encodeStereoWav(pcm.left,pcm.right,Math.round(rate));
  }finally{chip.dispose();}
  const wav=await exportNodeSamples(source,{id:s.id,format:'wav'});
  assert.deepEqual(wav.bytes,expected);
  const view=new DataView(wav.bytes.buffer);
  assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(24,true),wav.sampleRate);
  assert(wav.seconds<=10.001);
 }
});
test('PWM sample WAV is identical to Browser save and invalid selections fail',async()=>{
 const source=await readSource(fixture('pwm-direct')),r=await extractSamples(source);
 const wav=await exportNodeSamples(source,{id:1,format:'wav'});
 assert.deepEqual(wav.bytes,pwmCaptureWav(r.samples[0]));
 for(const options of [{all:true,format:'wav'},{id:1,format:'wav',occurrence:999},{id:1,format:'wav',occurrence:0},{id:1,format:'bad'}])
  await assert.rejects(exportNodeSamples(source,options));
 const adpcm=await readSource(fixture('ym2610-adpcm-a'));
 await assert.rejects(exportSourceSamples(adpcm,{id:1,format:'wav'}),/factory/);
});
test('Shared sample rendering releases chip when configuration fails',async()=>{
 let disposed=false;
 const original=Ym2610B.create;
 Ym2610B.create=async()=>({loadAdpcmRom(){throw new Error('bad memory');},dispose(){disposed=true;}});
 try{
  await assert.rejects(renderSamplePreview({chip:'ym2610',data:new Uint8Array(1)}, {rate:1},{getFactory:async()=>()=>{}}),/bad memory/);
  assert(disposed);
 }finally{Ym2610B.create=original;}
});
