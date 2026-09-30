import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {exportRf5c164Vgm as exportLiveRf5c164Vgm, detectVgmImport, prepareVgmImport} from './playground_vgm_import.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {Rf5c164} from '../../web/rf5c164.js';
import factory from '../generated/rf5c164_wasm.js';
import {RF5C164Synth} from '../../web/rf5c164synth.js';
const exportRf5c164Vgm=(input,options={})=>exportLiveRf5c164Vgm(input,{loop:false,...options});
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function vgm(commands) {
 const bytes=new Uint8Array(256+commands.length),v=new DataView(bytes.buffer);
 bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x161,true);
 v.setUint32(0x34,0xcc,true);v.setUint32(0x6c,12500000,true);bytes.set(commands,256);return bytes;
}
const block=(type,data)=>[0x67,0x66,type,data.length&255,data.length>>8,0,0,...data];
const run=(code,rf,sleep=async()=>{},write=()=>{},psg={write(){}},file=()=>{})=>{
 let samples=0;
 return new AsyncFunction('createSoundChip','sleepSamples','write','psg','file','performance',code)(
  async()=>rf,async(n,rate)=>{samples+=n;await sleep(n,rate);},write,psg,file,{now:()=>samples/44.1});
};
test('RAM bank, channel selection, transfer and mixed-chip order survive generated JavaScript',async()=>{
 const input=vgm([0xb1,7,0x82,...block(0xc1,[4,0,10,20]),0xb1,7,0xc3,0xc2,5,0,30,0x61,100,0,
 ...block(2,[40,50,60]),0x68,0x66,2,1,0,0,6,0,0,2,0,0,0x52,0x2a,100,0x52,0x28,0xf0,0x50,0x90,0x70,0x66]);
 const trace=[],files=new Map();let time=0;
 const code=exportRf5c164Vgm(input,{writeMemoryFile(bytes){const path=`/ram${files.size}.dat`;files.set(path,bytes);return path;}});
 await run(code,{writeRegister(r,v){trace.push([time,'r',r,v]);},loadMemory(data,address){trace.push([time,'m',address,...data]);},dispose(){trace.push([time,'dispose']);}},async n=>{time+=n;},(...args)=>trace.push([time,'fm',...args]),{write:v=>trace.push([time,'psg',v])},async path=>files.get(path));
 assert.deepEqual(trace,[[0,'r',7,130],[0,'m',8196,10,20],[0,'r',7,195],[0,'m',8197,30],[100,'m',8198,50,60],[100,'fm',0,42,100],[100,'fm',0,40,240],[100,'psg',144],[101,'dispose']]);
 assert.equal(files.size,2);
 const muted=exportRf5c164Vgm(input,{includeDac:false,includePsg:false});assert.doesNotMatch(muted,/write\(0, 42|psg.write/);assert.match(muted,/write\(0, 40/);
});
test('generated RF code produces identical audible core PCM, including timed RAM replacement',async()=>{
 const wasmBinary=await readFile(new URL('../generated/rf5c164_wasm.wasm',import.meta.url));
 const make=()=>Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:44100});
 const actualCore=await make(),reference=await make();
 const wave=Array.from({length:256},(_,i)=>i%128|128);
 const input=vgm([0xb1,7,0x80,...block(0xc1,[0,0,...wave,255]),0xb1,7,0xc0,0xb1,0,255,0xb1,1,255,0xb1,2,0,0xb1,3,8,0xb1,4,0,0xb1,5,0,0xb1,6,0,0xb1,8,254,0x61,0,8,0xc2,0,0,50,0x61,0,8,0x66]);
 const actual=[],expected=[];const append=(to,core,n)=>{const out=core.generateStereo(n);to.push(...out.left,...out.right);};
 try {
  const synth=new RF5C164Synth({transport:{write:(...a)=>actualCore.writeRegister(...a),loadMemory:(...a)=>actualCore.loadMemory(...a),reset:()=>actualCore.reset()}});
  synth.dispose=()=>{};
  await run(exportRf5c164Vgm(input,{mode:'high'}),synth,async n=>append(actual,actualCore,n));
  const parser=new Ym2612VGM(input,{logger:null}),targets={rf5c164:reference};
  for(;;){const e=parser.playStep(targets);if(e.type==='end')break;if(e.type==='wait')parser.consumeWait(targets,e.samples,n=>append(expected,reference,n));}
  assert.deepEqual(actual,expected);assert.ok(actual.some(x=>Math.abs(x)>.001));
 }finally{actualCore.dispose();reference.dispose();}
});
test('unsupported modes, clocks, dual chips and RAM overflow fail before creating assets',()=>{
 const input=vgm([0xb1,7,0x8f,...block(0xc1,[255,255,1,2]),0x66]);
 for(const mode of ['unknown'])assert.throws(()=>exportRf5c164Vgm(input,{mode}),/Schedule, Write or High/);
 assert.throws(()=>exportRf5c164Vgm(input),/range|64 KiB/i);
 const dual=vgm([0xb1,7,128,0x66]);new DataView(dual.buffer).setUint32(0x6c,12500000|0x40000000,true);assert.throws(()=>exportRf5c164Vgm(dual),/single/);
});
test('standalone detection and interrupted playback cleanup',async()=>{
 const input=vgm([0xb1,7,128,0x70,0x66]);
 assert.equal(detectVgmImport({rf5c164Clock:12500000}).family,'rf5c164');
 assert.equal((await prepareVgmImport({arrayBuffer:async()=>input})).detection.supported,true);
 let disposed=false;
 await assert.rejects(run(exportRf5c164Vgm(input),{writeRegister(){throw Error('disconnected');},dispose(){disposed=true;}}),/disconnected/);assert.equal(disposed,true);
});

test('slow acknowledgements do not serialize same-timestamp writes or RAM transfers',async()=>{
 const input=vgm([0xb1,7,128,...block(0xc1,[0,0,1,2]),...Array.from({length:100},()=>[0xb1,0,200]).flat(),0x61,0x44,0xac,0x66]);
 const acknowledgements=[];let sent=0,disposed=false,reachWait;
 const atWait=new Promise(resolve=>{reachWait=resolve;});
 const send=()=>{sent++;return new Promise(resolve=>acknowledgements.push(resolve));};
 const playback=run(exportRf5c164Vgm(input),{writeRegister:send,loadMemory:send,dispose(){disposed=true;}},async()=>reachWait());
 // Creation resumes in a microtask. All commands must be posted before any ACK.
 await Promise.resolve();await Promise.resolve();
 try {assert.equal(sent,102);await atWait;assert.equal(disposed,false);}
 finally {for(const ack of acknowledgements)ack();}
 await playback;assert.equal(disposed,true);
});
test('absolute deadlines compensate timer overshoot across dense DAC and RF writes',async()=>{
 const commands=[];
 for(let i=0;i<1000;i++)commands.push(0xb1,0,i%256,0x52,0x2a,i%256,0x70);
 commands.push(0x66);
 let samples=0,waits=0,writes=0;
 await new AsyncFunction('createSoundChip','sleepSamples','write','psg','file','performance',exportRf5c164Vgm(vgm(commands)))(
  async()=>({writeRegister(){},dispose(){}}),
  async n=>{samples+=n+44.1;waits++;},()=>{writes++;},{},()=>{},{now:()=>samples/44.1});
 assert.equal(writes,1000);assert.ok(samples>=1000 && samples<1045.2,`elapsed samples: ${samples}`);
 assert.ok(waits<30,`timer waits: ${waits}`);
});
test('asynchronous RPC failure rejects playback and disposes without an unhandled rejection',async()=>{
 let disposed=false;
 await assert.rejects(run(exportRf5c164Vgm(vgm([0xb1,7,128,0x70,0x66])),{
  writeRegister:()=>Promise.reject(new Error('RPC failed')),dispose(){disposed=true;}
 }),/RPC failed/);
 assert.equal(disposed,true);
});


test('High emits exact Synth register sequences and preserves unsafe writes as raw',async()=>{
 const commands=[];
 const r=(address,value)=>commands.push(0xb1,address,value);
 r(7,0x80); // Bank selection stays raw.
 r(7,0xc2);r(0,220);
 r(7,0xc2);r(1,0xa3);
 r(7,0xc2);r(6,0x10);
 r(7,0xc2);r(4,0x34);r(5,0x12);
 r(7,0xc2);r(2,0x56);r(3,0x23);
 r(7,0xc2);r(8,255);r(8,251); // Exact retrigger sequence.
 r(8,255); // Single channel off.
 r(7,0x42);r(0,100); // Disabled selection must not turn on chip.
 r(7,0xc2);r(2,0x22);commands.push(0x70);r(3,0x33); // Timed pair stays raw.
 r(7,0xc2);commands.push(0x52,0x22,8);r(0,120); // Cannot merge across FM.
 r(8,0);r(8,255); // Multiple mask changes stay raw.
 r(7,0xc2);r(8,251); // No extra key-off allowed.
 commands.push(0x70,0x66);
 const input=vgm(commands),traces=[];
 for(const mode of ['write','high']) {
  const trace=[];let time=0;
  const synth=new RF5C164Synth({transport:{write:(r,v)=>trace.push([time,r,v]),loadMemory(){},reset(){}}});
  synth.dispose=()=>{};
  const code=exportRf5c164Vgm(input,{mode});
  await run(code,synth,async n=>{time+=n;},(...args)=>trace.push([time,'fm',...args]));
  traces.push(trace);
  if(mode==='high') {
   for(const text of ['volume: 220','left: 3, right: 10','start: 4096','loopStart: 4660','rf.setPitch(2, 9046)','rf.keyOn(2)','rf.keyOff(2)'])assert.ok(code.includes(text),text);
   for(const text of ['rf.writeRegister(7, 66)','rf.writeRegister(2, 34)','rf.writeRegister(8, 0)','rf.writeRegister(8, 251)'])assert.ok(code.includes(text),text);
  }
 }
 assert.deepEqual(traces[1],traces[0]);
});

test('RF liveLoop restores existing FM channel split, High, PSG and DAC options',async()=>{
 const input=vgm([0xb1,7,0xc0,0xb1,0,200,0x52,0x30,1,0x52,0x31,2,0x52,0x2a,128,0x50,0x90,0x61,100,0,0x66]);
 const header=new DataView(input.buffer);header.setUint32(0x2c,7670454,true);header.setUint32(0x0c,3579545,true);
 for(const mode of ['schedule','write','high'])for(const splitChannels of [false,true]) {
  const paths=[];
  const options={mode,splitChannels,includeDac:true,includePsg:true,dacBase64:true,writeDacFile:bytes=>{paths.push(bytes);return '/dac.dat';}};
  const source=exportLiveRf5c164Vgm(input,options);
  const expected=new Ym2612VGM(input,{logger:null}).exportPlaygroundJavaScript({...options,high:mode==='high',scheduled:mode==='schedule'});
  assert.ok(source.endsWith(expected));assert.ok(paths.length>=1);
  const loops=new Map(),cleanups=[];let elapsed=0,disposed=0,resets=0;
  const trace=[];
  const synth=new RF5C164Synth({transport:{write:(r,v)=>trace.push([r,v]),loadMemory(){},reset(){resets++;}}});
  synth.dispose=()=>{disposed++;};
  await new AsyncFunction('createSoundChip','sleepSamples','liveLoop','liveCleanup','livePrepare',source)(
   async()=>synth,async n=>{elapsed+=n;},(name,fn)=>loops.set(name,fn),(names,fn)=>cleanups.push(fn),async()=>{});
  assert.ok(loops.has('vgm-rf5c164'));
  assert.ok(loops.has(splitChannels?'ch1':'vgm'));
  if(splitChannels)assert.ok(loops.has('ch2'));
  await loops.get('vgm-rf5c164')();const first=trace.slice();
  await loops.get('vgm-rf5c164')();assert.deepEqual(trace.slice(first.length),first);
  assert.equal(elapsed,200);assert.equal(resets,2);assert.equal(disposed,0);
  await cleanups[0]();assert.equal(disposed,1);
 }
});

test('zero-duration RF liveLoop yields and async failure disposes',async()=>{
 let fn,disposed=0,waits=0;
 const source=exportLiveRf5c164Vgm(vgm([0xb1,7,0x80,0x66]));
 await new AsyncFunction('createSoundChip','sleepSamples','liveLoop','liveCleanup',source)(
  async()=>({reset(){},writeRegister:()=>Promise.reject(Error('port failed')),dispose(){disposed++;}}),
  async n=>{assert.equal(n,1);waits++;},(name,callback)=>{fn=callback;},()=>{});
 await assert.rejects(fn(),/port failed/);assert.equal(waits,1);assert.equal(disposed,1);
});
