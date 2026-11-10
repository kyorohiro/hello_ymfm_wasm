// Arrays and a stubbed WorkletGlobalScope only; no audio device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createSynthPcmLoopPlayer,prepareSynthPcmLoopUnit,normalizeSynthPcmLoopUnit} from './synth_pcm_loop_player.js';
const RATE=8000,LENGTH=.05,FRAMES=400;
const raw=(id,left=1,right=0,offsetSeconds=0,length=400)=>({id,left:new Float32Array(length).fill(left),right:new Float32Array(length).fill(right),offsetSeconds});
function generate(player,frames,start=0,block=128){const left=new Float32Array(frames),right=new Float32Array(frames);for(let i=0;i<frames;i+=block)player.render(left.subarray(i,Math.min(i+block,frames)),right.subarray(i,Math.min(i+block,frames)),start+i);return{left,right};}

test('PCM software layers mix exact raw stereo, preserve phase and remove only the selected layer',async()=>{
  const a=createSynthPcmLoopPlayer({sampleRate:RATE}),b=createSynthPcmLoopPlayer({sampleRate:RATE});
  const source=raw('a',.25,-.5,0,600),prepared=await prepareSynthPcmLoopUnit(source,{sampleRate:RATE,loopLength:LENGTH});
  for(const p of[a,b]){p.start({loopLength:LENGTH,startTime:.1},{session:1});p.addPrepared(1,structuredClone(prepared));}
  assert.deepEqual(generate(a,1250),generate(b,1250,0,71));
  const second=await prepareSynthPcmLoopUnit(raw('b',.125,.25,.0125),{sampleRate:RATE,loopLength:LENGTH});
  for(const p of[a,b])p.addPrepared(1,structuredClone(second),{currentFrame:1250});
  assert.equal(a.snapshot().units[1].firstStartFrame,1300);
  const before=generate(a,900,1250),other=generate(b,900,1250,59);assert.deepEqual(before,other);
  assert.equal(before.left[1300-1250],.625);assert.equal(before.right[1300-1250],-.75);
  a.remove(1,'b');b.remove(1,'b');assert.deepEqual(generate(a,1300,2150),generate(b,1300,2150,97));
  assert(source.left.every(value=>value===.25));a.stop(2);assert(generate(a,800,3450).left.every(value=>value===0));
  assert.equal(a.start({loopLength:LENGTH,startTime:0},{session:1}),false);
  const bad=raw('bad');bad.left[30]=NaN;assert.throws(()=>normalizeSynthPcmLoopUnit(bad,{sampleRate:RATE,loopLength:LENGTH}),/PCM loop sample/);
});

let importSequence=0;
async function processor() {
  const saved=new Map(['AudioWorkletProcessor','registerProcessor','sampleRate','currentFrame'].map(key=>[key,globalThis[key]]));
  globalThis.sampleRate=RATE;globalThis.currentFrame=0;
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={sent:[],postMessage(value){this.sent.push(value);}};}};
  let Registered;globalThis.registerProcessor=(name,Type)=>{assert.equal(name,'tetorica-synth-pcm-looper');Registered=Type;};
  await import('./synth_pcm_loop_worklet.js?test=pcm-loop-'+(++importSequence));
  const p=new Registered();let serial=0;
  const receive=(method,args)=>{const id=++serial;p.receive({id,method,args});return p.port.sent.find(item=>item.id===id);};
  const render=(frames,start=0)=>{const left=new Float32Array(frames),right=new Float32Array(frames);for(let i=0;i<frames;i+=128){globalThis.currentFrame=start+i;assert.equal(p.process([],[[left.subarray(i,Math.min(i+128,frames)),right.subarray(i,Math.min(i+128,frames))]]),true);}return{left,right};};
  return{p,receive,render,restore(){p.dispose();for(const[key,value]of saved)if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('real private Worklet accepts inert uploads before atomic start, then phase-correct add/remove and stop barriers',async()=>{
  const first=await prepareSynthPcmLoopUnit(raw('first',.5,0),{sampleRate:RATE,loopLength:LENGTH});
  const second=await prepareSynthPcmLoopUnit(raw('second',0,.25,.0125),{sampleRate:RATE,loopLength:LENGTH});
  const h=await processor();
  try {
    assert(h.receive('prepareLooperUnit',[1,{loopLength:LENGTH,unit:first}]).value);
    assert(h.receive('prepareLooperUnit',[2,{loopLength:LENGTH,unit:second}]).value);
    assert(h.render(600).left.every(value=>value===0),'uploads are inert until the scheduled start');
    globalThis.currentFrame=600;
    assert(h.receive('startLooper',[1,{loopLength:LENGTH,startTime:.1},[1,2]]).value);
    assert.equal(h.p.preparedBytes,0);assert.equal(h.p.player.snapshot().units.length,2);
    const output=h.render(1800,600);assert(output.left.subarray(0,200).every(x=>x===0));assert(output.left.subarray(200).every(x=>x===.5));
    assert(output.right.subarray(0,300).every(x=>x===0));assert(output.right.subarray(300).every(x=>x===.25));
    const before=h.p.player.snapshot();assert(h.receive('startLooper',[2,{loopLength:LENGTH,startTime:0},[99]]).error);assert.deepEqual(h.p.player.snapshot(),before);
    assert(h.receive('removeLooperUnit',[1,'first']).value);assert(h.render(500,2400).left.every(x=>x===0));
    assert(h.receive('stopLooper',[3]).value);assert.equal(h.p.prepared.size,0);assert.equal(h.receive('startLooper',[2,{loopLength:LENGTH,startTime:0},[]]).value,false);
    assert(h.render(800,2900).right.every(x=>x===0));
  }finally{h.restore();}
});

test('Worklet staging shares the 16-layer limit with active layers and failed batches preserve the active program',async()=>{
  const packet=await prepareSynthPcmLoopUnit(raw('one',.125,0),{sampleRate:RATE,loopLength:LENGTH});const h=await processor();
  try {
    for(let i=1;i<=16;i++)assert(h.receive('prepareLooperUnit',[i,{loopLength:LENGTH,unit:{...packet,id:'unit-'+i,left:packet.left.slice(),right:packet.right.slice()}}]).value);
    assert.match(h.receive('prepareLooperUnit',[17,{loopLength:LENGTH,unit:{...packet,id:'extra'}}]).error,/storage limit/);
    assert(h.receive('startLooper',[1,{loopLength:LENGTH,startTime:0},Array.from({length:16},(_,i)=>i+1)]).value);
    assert(h.render(800).left.every(x=>x===2),'no calibration or implicit gain is applied by the raw mixer');
    assert(h.receive('stopLooper',[2]).value);assert.equal(h.p.preparedBytes,0);assert(h.receive('startLooper',[3,{loopLength:LENGTH,startTime:0},[1]]).error);
  }finally{h.restore();}
});

test('private mixer Worklet imports without DOM, decoder or abort globals',async()=>{
  const url=new URL('./synth_pcm_loop_worklet.js',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');for(const key of ['TextEncoder','TextDecoder','AbortController','btoa','atob'])delete globalThis[key];globalThis.AudioWorkletProcessor=class{};globalThis.registerProcessor=(name)=>parentPort.postMessage(name);import(${JSON.stringify(url)}).catch(error=>{throw error;});`,{eval:true});
  try{const name=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});assert.equal(name,'tetorica-synth-pcm-looper');}finally{await worker.terminate();}
});
