// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPceMediaOutput,readMediaReleaseSeconds} from './media_output.js';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(){
  const events=[],context={currentTime:0,state:'running',createGain(){return{gain:{value:1,cancelScheduledValues:at=>events.push(['cancel',at]),setValueAtTime:(v,at)=>events.push(['set',v,at]),linearRampToValueAtTime:(v,at)=>events.push(['ramp',v,at])},connect(){},disconnect(){}};}};
  const source={connect(){}},input={},output=createPceMediaOutput(context,source,input);return{events,context,output};
}
test('software release waits for the audio clock rather than wall time',async()=>{
  const f=fixture();let done=false;const pending=f.output.fadeOut(.005).then(()=>{done=true;});
  await delay(12);assert.equal(done,false);assert.deepEqual(f.events.at(-1),['ramp',0,.005]);
  f.context.currentTime=.005;await pending;assert(done);f.output.dispose();
});
test('suspended output silences immediately, and an interrupted fade completes without future audible output',async()=>{
  const f=fixture();f.context.state='suspended';await f.output.fadeOut(.008);assert.deepEqual(f.events.at(-1),['set',0,0]);
  f.context.state='running';f.output.open(0);const pending=f.output.fadeOut(.008);f.context.state='interrupted';await pending;assert.deepEqual(f.events.at(-1),['set',0,0]);f.output.dispose();
});
test('cancelled fades unblock and opening preserves a partial ramp value before rising',async()=>{
  const f=fixture(),controller=new AbortController(),pending=f.output.fadeOut(.008,{signal:controller.signal});
  f.context.currentTime=.004;controller.abort(new DOMException('Cancelled','AbortError'));await assert.rejects(pending,{name:'AbortError'});
  f.output.open(.004);assert.deepEqual(f.events.slice(-3),[['cancel',.004],['set',.5,.004],['ramp',1,.008]]);f.output.dispose();
});
test('disposing an endpoint unblocks its fade and release options reject invalid values without touching audio',async()=>{
  const f=fixture(),pending=f.output.fadeOut(.008);f.output.dispose();await assert.rejects(pending,{name:'AbortError'});
  for(const options of [null,[],{releaseSeconds:-1},{releaseSeconds:Infinity},{releaseSeconds:.051},{other:true}])assert.throws(()=>readMediaReleaseSeconds(options));
  assert.equal(readMediaReleaseSeconds(),0);assert.equal(readMediaReleaseSeconds({releaseSeconds:.008}),.008);
});
