import nukedFactory from '../docs/generated/nuked_opn2_wasm.js';
import {validateYm2612Engine} from './playground_soundchip_options.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {createOpnAuditionGuard} from './playground_audition_guard.js';
import {OpnKeyboardInspector} from './playground_opn_inspector.js';
import {validateChipClock} from './playground_chip_clock.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Ym2612} from './ym2612.js';
import {Ym2203} from './ym2203.js';
import {Ym2610B} from './ym2610b.js';
import ym2612Factory from '../docs/generated/ym2612_wasm.js';
import ym2203Factory from '../docs/generated/ym2203_wasm.js';
import ym2610Factory from '../docs/generated/ym2610b_wasm.js';
import {createOpnClient} from './playground_opn.js';
import {encodeAdpcmA} from '../assets/opna-rhythm/generate.mjs';
import {encodeAdpcmB} from './adpcm_b_sample.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
const source=(await readFile(new URL('./playground_opn_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
async function setup(name, overrides={}, engine='ymfm') {
 let Processor, ready;
 const promise=new Promise(resolve=>{ready=resolve;});
 vm.runInNewContext(source,{validateYm2612Engine,OpnKeyboardInspector,receiveChipInspector,createOpnAuditionGuard,validateChipClock,Ym2612,Ym2203,Ym2610B,ym2612Factory,nukedFactory,ym2203Factory,ym2610Factory,sampleRate:48000,
  createProcessorPerformance:options=>createProcessorPerformance({...options,rate:48000,nowFrame:()=>0}),
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:ready};}},registerProcessor:(_,cls)=>{Processor=cls;},...overrides});
 const wasmBinary=await readFile(new URL(`../docs/generated/${engine==='nuked'?'nuked_opn2':name==='ym2610'?'ym2610b':name}_wasm.wasm`,import.meta.url));
 const processor=new Processor({processorOptions:{name,wasmBinary,engine}});
 return {processor,promise};
}
const render=p=>{const output=[new Float32Array(4096),new Float32Array(4096)];p.process([],[output]);return output[0];};
for(const name of ['ym2612','ym2203','ym2610','ym2610b']) test(`${name}: two real WASM processors are independent and render FM`,async()=>{
 const a=await setup(name), b=await setup(name), control=await setup(name);
 assert.equal((await a.promise).ready,true);assert.equal((await b.promise).ready,true);assert.equal((await control.promise).ready,true);
 const port={start(){},close(){},postMessage(data){a.processor.receive(data,{postMessage:reply=>port.onmessage({data:reply})});}};
 const client=createOpnClient(name,port);
 try{
  client.reset();client.setAlgo(0,7,0);
  if(name!=='ym2203')client.setPan(0,true,true);
  client.setOperator(0,3,{multi:1,tl:0,ar:31,d1r:0,d2r:0,sl:0,rr:15});client.noteOn(0,4,600);
  assert.ok(render(a.processor).some(x=>Math.abs(x)>.001));
  const clock=client.clock;await client.setClock(Math.round(clock/2));
  assert.ok(render(a.processor).some(x=>Math.abs(x)>.001));
  await client.setClock(clock);
  assert.deepEqual(render(b.processor),render(control.processor));
  if(name!=='ym2612'){client.reset();client.ssg.tone(0,{frequency:440,volume:12});assert.ok(render(a.processor).some(x=>Math.abs(x)>.001));}
  if(['ym2610','ym2610b'].includes(name)) await client.adpcmA.loadMemory(new Uint8Array(256));
  client.dispose();client.dispose();assert.equal(a.processor.process([],[]),false);
  assert.deepEqual(render(b.processor),render(control.processor));
  assert.throws(()=>client.noteOn(0,4,600),/disposed/);
 }finally{a.processor.dispose();b.processor.dispose();control.processor.dispose();}
});
test('late OPN initialization is disposed after Stop',async()=>{
 let complete,disposed=0;
 const {processor}=await setup('ym2612',{Ym2612:{create:()=>new Promise(resolve=>{complete=resolve;})}});
 processor.dispose();complete({dispose(){disposed++;}});await Promise.resolve();
 assert.equal(disposed,1);assert.equal(processor.process([],[]),false);
});

test('YM2203 schedules ordered FM/SSG writes at output frames and cancels on reset', async()=>{
 let frame=0;const writes=[],replies=[];
 const fake={sampleRate:clock=>clock??48000,write:(address,value)=>writes.push([frame,address,value]),reset(){},dispose(){},reserveStereoFrames(){},generateStereoView:n=>({left:new Float32Array(n),right:new Float32Array(n)})};
 const {processor,promise}=await setup('ym2203',{Ym2203:{create:async()=>fake}});
 await promise;
 const port={postMessage:m=>replies.push(m)};
 processor.receive({id:1,method:'clock',args:[4000000]},port);assert.equal(processor.rate,4000000);
 processor.receive({id:2,method:'schedule',args:[[[0,0,12],[0,8,15],[441,0xa0,99],[882,8,0]],882]},port);
 assert.equal(replies.length,1);
 // Clock changes must not move VGM sample reservations to different output frames.
 processor.receive({id:99,method:'clock',args:[8000000]},port);
 assert.equal(processor.rate,8000000);assert.ok(processor.schedule);
 for(frame=0;frame<=960;frame++)processor.process([],[[new Float32Array(1),new Float32Array(1)]]);
 assert.deepEqual(writes,[[0,0,0],[0,1,12],[0,0,8],[0,1,15],[480,0,0xa0],[480,1,99],[960,0,8],[960,1,0]]);
 assert.equal(replies.at(-1).id,2);assert.equal(replies.at(-1).error,undefined);
 processor.receive({id:3,method:'schedule',args:[[[20,0,12],[10,0,12]],30]},port);
 assert.match(replies.at(-1).error,/Invalid/);assert.equal(processor.schedule,null);
 processor.receive({id:4,method:'schedule',args:[[[0,8,0]],4410]},port);
 processor.receive({method:'reset'},port);
 assert.equal(replies.at(-1).id,4);assert.match(replies.at(-1).error,/cancelled/);assert.equal(processor.schedule,null);
 processor.dispose();
});

for(const name of ['ym2610','ym2610b'])test(`${name}: logical channels, addressed writes and A/B ROMs retain the real chip variant`,async t=>{
 const {processor,promise}=await setup(name);assert.equal((await promise).ready,true);t.after(()=>processor.dispose());
 const commands=[],port={start(){},close(){},postMessage(data){commands.push(data);processor.receive(data,{postMessage:reply=>port.onmessage({data:reply})});}};
 const client=createOpnClient(name,port),count=name==='ym2610'?4:6;
 assert.equal(client.channelCount,count);assert.equal(client.adpcm,client.adpcmB);
 const physical=name==='ym2610'?[1,2,4,5]:[0,1,2,3,4,5];
 for(let ch=0;ch<count;ch++){
  client.reset();client.setAlgo(ch,7,0);client.setPan(ch,true,true);
  client.setOperator(ch,3,{multi:1,tl:0,ar:31,d1r:0,d2r:0,sl:0,rr:15});
  client.setFrequency(ch,440);client.keyOn(ch);
  assert.equal(commands.at(-1).args[2],0xf0|[0,1,2,4,5,6][physical[ch]]);
  assert.ok(render(processor).some(x=>Math.abs(x)>.001),`FM${ch+1} must actually render`);
 }
 assert.throws(()=>client.keyOn(count),/channel/i);
 const raw=client.fm??client;raw.writeAddress(1,0xb2);raw.writeData(0x07);
 assert.deepEqual(commands.at(-1).args,[1,0xb2,7]);
 client.reset();
 const sine=Float32Array.from({length:512},(_,i)=>Math.sin(i*2*Math.PI/64)*.5);
 await client.adpcmA.loadMemory(encodeAdpcmA(Array.from(sine,x=>Math.round(x*2047))),0);
 await client.adpcmB.loadMemory(encodeAdpcmB({channels:[sine],sampleRate:8000},8000).bytes,0);
 client.adpcmA.setVolume(63);client.adpcmA.setVoice(5,{volume:31,left:true,right:true});
 client.adpcmA.setSample(5,{start:0,end:256});client.adpcmA.keyOn(5);
 assert.ok(render(processor).some(x=>Math.abs(x)>.001),'ADPCM-A must render its own ROM');
 client.reset(); // Hardware reset preserves both uploaded ROM address spaces.
 client.adpcmB.setSample({start:0,end:256});client.adpcmB.setVolume(255);client.adpcmB.setPan(true,true);client.adpcmB.setPlaybackRate(8000);client.adpcmB.keyOn({repeat:true});
 assert.ok(render(processor).some(x=>Math.abs(x)>.001),'ADPCM-B must render independently after reset');
 client.dispose();
});

test('YM2610B disposal rejects pending clock and ROM requests exactly once',async()=>{
 const sent=[];let closes=0;
 const client=createOpnClient('ym2610b',{start(){},postMessage:message=>sent.push(message),close(){closes++;}});
 const clock=assert.rejects(client.setClock(8100000),/disposed/i);
 const memory=assert.rejects(client.adpcmB.loadMemory(new Uint8Array(256)),/disposed/i);
 client.dispose();client.dispose();await Promise.all([clock,memory]);
 assert.equal(closes,1);assert.equal(sent.filter(command=>command.method==='dispose').length,1);
});

const output=(processor,frames=4096)=>{const pcm=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[pcm]);return pcm;};
const energy=pcm=>{let lo=Infinity,hi=-Infinity;for(const value of pcm){assert(Number.isFinite(value));lo=Math.min(lo,value);hi=Math.max(hi,value);}return hi-lo;};
const link=(processor,options={})=>{
 const port={start(){},close(){},postMessage(data){processor.receive(data,{postMessage:reply=>port.onmessage({data:reply})});}};
 return createOpnClient('ym2612',port,options);
};
for(const engine of ['ymfm','nuked'])test(`additional ${engine} YM2612 renders all six physical FM channels, DAC, CSM and reset with an immutable engine`,async t=>{
 const {processor,promise}=await setup('ym2612',{},engine);assert.equal((await promise).ready,true);t.after(()=>processor.dispose());
 const client=link(processor,{engine});assert.equal(client.engine,engine);assert.throws(()=>{client.engine='other';},TypeError);
 for(let channel=0;channel<6;channel++){
  client.reset();client.setAlgo(channel,7,0);client.setPan(channel,true,true);
  client.setOperator(channel,3,{multi:1,tl:0,ar:31,d1r:0,d2r:0,sl:0,rr:15});client.setFrequency(channel,440);client.keyOn(channel);
  const [left,right]=output(processor);assert(energy(left)>.01,`FM${channel+1} must produce AC PCM`);assert.deepEqual(left,right);
 }
 client.reset();client.setPan(5,true,true);client.write(0,0x2b,0x80);
 const dac=new Float32Array(4096);
 for(let i=0;i<16;i++){client.write(0,0x2a,(i*37)&255);dac.set(output(processor,256)[0],i*256);}
 assert(energy(dac)>.1,'unsigned DAC steps must reach actual PCM');
 client.reset();client.setAlgo(2,7,0);client.setPan(2,true,true);client.setOperator(2,3,{multi:1,tl:0,ar:31,d1r:0,d2r:0,sl:0,rr:15});client.setFrequency(2,440);
 client.write(0,0x24,255);client.write(0,0x25,3);client.write(0,0x27,0x85);
 assert(energy(output(processor)[0])>.01,'CSM timer keys CH3 without a register 28 key-on');
 const clock=client.clock;await client.setClock(4000000);assert.equal(processor.rate,Math.floor(4000000/144));
 client.reset();assert.equal(client.clock,4000000);assert.equal(processor.rate,Math.floor(4000000/144));assert.equal(processor.remainder,0);
 await client.setClock(clock);
 client.dispose();client.dispose();assert.equal(processor.process([],[]),false);
});

test('Nuked instances stay independent of each other and the ymfm instance through writes, clock, reset and disposal',async t=>{
 const instances=await Promise.all(['nuked','nuked','nuked','ymfm','ymfm'].map(engine=>setup('ym2612',{},engine)));
 await Promise.all(instances.map(async fixture=>assert.equal((await fixture.promise).ready,true)));t.after(()=>instances.forEach(({processor})=>processor.dispose()));
 const [changed,sibling,siblingControl,ymfm,ymfmControl]=instances.map(fixture=>fixture.processor),client=link(changed,{engine:'nuked'});
 client.setAlgo(5,7,0);client.setPan(5,true,true);client.setOperator(5,3,{multi:1,tl:0,ar:31,d1r:0,d2r:0,sl:0,rr:15});client.setFrequency(5,440);client.keyOn(5);
 assert(energy(output(changed)[0])>.01);await client.setClock(100000000);output(changed);client.reset();client.dispose();
 assert.deepEqual(output(sibling),output(siblingControl));assert.deepEqual(output(ymfm),output(ymfmControl));
});

test('Nuked asynchronous initialization completed after Stop retires its real core once',async()=>{
 let complete,disposed=0;
 const {processor}=await setup('ym2612',{Ym2612:{create:()=>new Promise(resolve=>{complete=resolve;})}},'nuked');
 processor.dispose();processor.dispose();complete({dispose(){disposed++;}});await Promise.resolve();
 assert.equal(disposed,1);assert.equal(processor.engine,'nuked');assert.equal(processor.process([],[]),false);
});

test('Native Worker OPN state cannot replace a selected physical engine or partially adopt a mismatched clock',()=>{
 let messages=0;const port={start(){},close(){},postMessage(){messages++;}};
 assert.throws(()=>createOpnClient('ym2612',port,{native:true,engine:'nuked',state:{engine:'ymfm',clock:4000000}}),/engine.*physical instance/);
 assert.equal(messages,0,'a mismatched initial snapshot cannot send a constructor reset');
 const client=createOpnClient('ym2612',port,{native:true,engine:'nuked',state:{engine:'nuked',clock:7670454}});
 assert.equal(client._getState().engine,'nuked');
 assert.throws(()=>client._adoptState({engine:'ymfm',clock:4000000}),/engine.*physical instance/);assert.equal(client.clock,7670454);
 client._adoptState({engine:'nuked',clock:4000000});assert.equal(client.clock,4000000);assert.equal(client.engine,'nuked');client.dispose();
});
