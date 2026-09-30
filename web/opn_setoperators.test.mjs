import test from 'node:test';
import assert from 'node:assert/strict';
import {YM2203Synth} from './ym2203synth.js';
import {YM2608Synth} from './ym2608synth.js';
import {YM2610BSynth, NeoGeoFMSynth} from './ym2610bsynth.js';
import {createOpnClient} from './playground_opn.js';
import {createYm2608Client} from './playground_ym2608.js';

for (const [name, make, last] of [
 ['ym2203', t=>new YM2203Synth({transport:t}),2],
 ['ym2608', t=>new YM2608Synth({transport:t}),5],
 ['ym2610b', t=>new YM2610BSynth({transport:t}),5],
 ['ym2610', t=>new NeoGeoFMSynth(new YM2610BSynth({transport:t})),3],
]) {
 const setup=()=>{const writes=[];const chip=make({write(port,register,value){writes.push([port,register,value]);},reset(){}});writes.length=0;return {chip,writes};};
 test(`${name} batch preserves register order, repeated operators and partial fields`,()=>{
  const a=setup(),b=setup();
  const entries=[[0,{dt:3,multi:2,tl:12,ar:31}],[2,{am:true,d1r:4,sr:5,sl:3,rr:2,ssg:8}],[0,{multi:7}]];
  a.chip.setOperators(last,entries);
  for(const [op,params]of entries)b.chip.setOperator(last,op,params);
  assert.deepEqual(a.writes,b.writes);
  if(name==='ym2610')assert.deepEqual(a.writes[0],[1,0x32,0x32]);
 });
 test(`${name} rejects invalid batches without writes or partial shadow state`,()=>{
  for(const entries of [null,[[0,{tl:5}],[4,{}]],[[0,{dt:3}],[1,{ar:32}]],[[0,{tl:5}],[1,[]]],[[0,{tl:5}],[1,{am:1}]],[[0,{tl:5}],[1,{sr:2,d2r:32}]],[[0,{tl:5}],null]]){
   const a=setup(),b=setup();
   assert.throws(()=>a.chip.setOperators(last,entries));assert.deepEqual(a.writes,[]);
   a.chip.setOperator(last,0,{multi:1});b.chip.setOperator(last,0,{multi:1});assert.deepEqual(a.writes,b.writes);
  }
  const {chip,writes}=setup();assert.throws(()=>chip.setOperators(last+1,[]));chip.setOperators(last,[]);assert.deepEqual(writes,[]);
 });
}
for(const name of ['ym2203','ym2608','ym2610'])test(`${name} additional client forwards ordered batch`,()=>{
 const messages=[];const port={start(){},close(){},postMessage:m=>messages.push(m)};
 const chip=name==='ym2608'?createYm2608Client(port):createOpnClient(name,port);
 messages.length=0;
 chip.setOperators(0,[[0,{tl:9}],[0,{tl:11}]]);
 assert.deepEqual(messages.map(m=>m.args.at(-1)),[9,11]);chip.dispose();
});

import {createWorkerChip} from './playground_worker_chip.js';
for(const name of ['ym2203','ym2608','ym2610','ym2610b'])test(`${name} Worker batch uses correct channel and rejects atomically`,()=>{
 const commands=[];
 const chip=createWorkerChip({port:{postMessage:batch=>commands.push(...batch)},capabilities:{chip:name}});
 chip.fm.setOperators(0,[[0,{tl:9}],[0,{tl:11}]]);
 assert.deepEqual(commands.map(c=>[c.port,c.register,c.value]),[[0,name==='ym2610'?0x41:0x40,9],[0,name==='ym2610'?0x41:0x40,11]]);
 commands.length=0;
 assert.throws(()=>chip.fm.setOperators(0,[[0,{tl:5}],[1,{ar:32}]]));
 assert.deepEqual(commands,[]);
});
