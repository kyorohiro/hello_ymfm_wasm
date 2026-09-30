import test from 'node:test';
import assert from 'node:assert/strict';
import {Ym2608Timeline} from './playground_ym2608_timeline.js';
test('timeline applies memory and both ports in order at 48k output frames, and repeats',()=>{
 let frame=0;const calls=[],replies=[];
 const engine={ym2608:{reset(){calls.push([frame,'reset']);}},writeYm2608(...args){calls.push([frame,'write',...args]);},loadAdpcmBMemory(b,offset){calls.push([frame,'memory',offset,...b]);},process(l,r,n){frame+=n;l.fill(0);r.fill(0);}};
 const t=new Ym2608Timeline(engine,48000);const block=Uint8Array.of(12,34);
 t.prepare([[0,0,8,15],[441,2,0,8],[441,1,0,160],[882,0,8,0]],[block],882);block[0]=99;
 t.play(error=>replies.push(error));t.process(new Float32Array(961),new Float32Array(961));
 assert.deepEqual(calls,[[0,'reset'],[0,'write',0,8,15],[480,'memory',8,12,34],[480,'write',1,0,160],[960,'write',0,8,0]]);assert.deepEqual(replies,[undefined]);
 t.play(error=>replies.push(error));assert.throws(()=>t.prepare([],[],1),/playing/);t.cancel();assert.equal(replies[1],'Timeline cancelled');
 assert.throws(()=>t.prepare([[0,2,0,0]],[],10),/ADPCM range/);t.dispose();assert.throws(()=>t.play(()=>{}),/unavailable/);
});
