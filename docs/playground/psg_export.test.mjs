import test from 'node:test';
import {createSegaPsgApi} from '../../web/segapsg_api.js';
import assert from 'node:assert/strict';
import {Ym2612VGM} from '../../web/ym2612vgm.js';
import {vgmBytes} from '../../web/test-support/vgm-mock.js';
const make=commands=>{const b=vgmBytes(commands);new DataView(b.buffer,b.byteOffset,b.byteLength).setUint32(12,3579545,true);return b;};
async function execute(source) {
 const loops=[],events=[];let time=0;
 const fmWrite=(port,r,v)=>events.push([time,'fm',port,r,v]);
 const names=['liveLoop','sleepSamples','write','psg','fm','beginSampleSchedule','scheduleWritesSamples'];
 const args=[(name,fn)=>loops.push([name,fn]),async n=>{time+=n;},(...a)=>fmWrite(...(a.length===2?[0,...a]:a)),createSegaPsgApi({write:v=>events.push([time,'psg',v])}),{setLfo:(enabled,speed)=>fmWrite(0,0x22,(enabled?8:0)|speed)},()=>0,(_,entries)=>{for(const e of entries)events.push(e[1]==='psg'?[e[0],'psg',e[2]]:[e[0],'fm',...e.slice(1)]);}];
 await new (Object.getPrototypeOf(async function(){}).constructor)(...names,source)(...args);
 const durations=[];for(const [,fn] of loops){time=0;await fn();durations.push(time);}
 return {events,loops:loops.map(x=>x[0]),durations};
}
test('PSG latch/data, tone, volume and noise retain their sample times in all three modes',async()=>{
 const bytes=make([0x52,0x22,8,0x50,0x85,0x50,0x12,0x50,0x90,0x61,10,0,0x50,0xe7,0x50,0xf4,0x52,0x22,0,0x50,0x9f,0x61,7,0,0x66]);
 const expected=[[0,'fm',0,0x22,8],[0,'psg',0x85],[0,'psg',0x12],[0,'psg',0x90],[10,'psg',0xe7],[10,'psg',0xf4],[10,'fm',0,0x22,0],[10,'psg',0x9f]];
 for(const mode of [{},{scheduled:true},{high:true}])for(const splitChannels of [false,true]){
  const source=new Ym2612VGM(bytes,{logger:null}).exportPlaygroundJavaScript({...mode,splitChannels,dacBase64:false});
  const result=await execute(source);
  if(!splitChannels)assert.deepEqual(result.events,expected);
  else for(const kind of ['fm','psg'])assert.deepEqual(result.events.filter(e=>e[1]===kind),expected.filter(e=>e[1]===kind));
  assert.ok(result.durations.every(n=>n===17));
  if(splitChannels)assert.equal(result.loops.filter(n=>n==='psg').length,1);
  const without=await execute(new Ym2612VGM(bytes,{logger:null}).exportPlaygroundJavaScript({...mode,splitChannels,includePsg:false}));
  assert.ok(without.events.every(e=>e[1]==='fm'));
 }
});
test('PSG DAC streams expand during waits and coexist with YM2612 DAC',async()=>{
 const bytes=make([0x67,0x66,0,2,0,0,0,0x1f,0x08,0x90,0,0,0,0x90,0x91,0,0,1,0,0x92,0,0x22,0x56,0,0,0x95,0,0,0,0,0x52,0x2a,128,0x61,5,0,0x66]);
 for(const mode of [{},{scheduled:true},{high:true}]){
  const result=await execute(new Ym2612VGM(bytes,{logger:null}).exportPlaygroundJavaScript({...mode,splitChannels:false,dacBase64:false}));
  assert.deepEqual(result.events.filter(e=>e[1]==='psg'),[[0,'psg',0x9f],[2,'psg',0x98]]);
  assert.deepEqual(result.events.filter(e=>e[1]==='fm'),[[0,'fm',0,42,128]]);
 }
});

test('High emits named PSG setters while partial, interleaved and noncanonical writes remain raw',async()=>{
 const bytes=make([0x50,0x80,0x50,0,0x50,0xaf,0x50,0x3f,0x50,0xe3,0x50,0xe3,0x50,0xf2,
  0x50,0x85,0x70,0x50,0x12,0x50,0xc5,0x52,0x22,8,0x50,0x12,0x50,0x83,0x50,0x7f,0x50,0xe8,0x50,0x03,0x66]);
 for(const splitChannels of [false,true]) {
  const parser=new Ym2612VGM(bytes,{logger:null});
  const raw=parser.exportPlaygroundJavaScript({splitChannels,dacBase64:false});
  const high=parser.exportPlaygroundJavaScript({splitChannels,dacBase64:false,high:true});
  assert.match(high,/psg.setPeriod\(0, 0\)/);assert.match(high,/psg.setPeriod\(1, 1023\)/);
  assert.equal((high.match(/psg.setNoise/g)??[]).length,2);
  assert.match(high,/psg.setAttenuation\(3, 2\)/);
  for(const byte of ['85','c5','83','7f','e8','03']) assert.ok(high.includes(`psg.write(0x${byte})`),byte);
  assert.deepEqual((await execute(high)).events,(await execute(raw)).events);
 }
});
