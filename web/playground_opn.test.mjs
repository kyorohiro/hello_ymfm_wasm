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
async function setup(name, overrides={}) {
 let Processor, ready;
 const promise=new Promise(resolve=>{ready=resolve;});
 vm.runInNewContext(source,{OpnKeyboardInspector,receiveChipInspector,createOpnAuditionGuard,validateChipClock,Ym2612,Ym2203,Ym2610B,ym2612Factory,ym2203Factory,ym2610Factory,sampleRate:48000,
  createProcessorPerformance:options=>createProcessorPerformance({...options,rate:48000,nowFrame:()=>0}),
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:ready};}},registerProcessor:(_,cls)=>{Processor=cls;},...overrides});
 const wasmBinary=await readFile(new URL(`../docs/generated/${name==='ym2610'?'ym2610b':name}_wasm.wasm`,import.meta.url));
 const processor=new Processor({processorOptions:{name,wasmBinary}});
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
