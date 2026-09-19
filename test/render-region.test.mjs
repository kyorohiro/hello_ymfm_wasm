import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
const fixture=n=>new URL('./fixtures/'+n+'.vgz',import.meta.url);
test('Region PCM equals a slice of full rendering across block boundaries',async()=>{
 for(const name of ['opm-audible','pwm-all','ym2610-adpcm-a']){
  const source=await readSource(fixture(name)),full=await renderSource(source,{maxSeconds:.4});
  const rate=new DataView(full.bytes.buffer).getUint32(24,true);
  for(const start of [.011,.19]){
   const region=await renderSource(source,{startSeconds:start,maxSeconds:.01});
   const from=Math.round(start*rate),count=Math.round(.01*rate);
   assert.deepEqual(region.bytes.slice(44),full.bytes.slice(44+from*4,44+(from+count)*4),name);
  }
 }
});
test('Region rejects invalid limits and starts beyond the rendered end',async()=>{
 const source=await readSource(fixture('psg-tone'));
 for(const startSeconds of [-1,NaN,Infinity,600])await assert.rejects(renderSource(source,{startSeconds,maxSeconds:1}),/startSeconds/);
 await assert.rejects(renderSource(source,{startSeconds:2,maxSeconds:1}),/track end/);
});
