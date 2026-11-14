// SPDX-License-Identifier: BSD-3-Clause
// Actual media players and WASM renderers into inert nodes, never a device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHuc6280Cdrom2Audio} from './cdrom2_audio.js';
import {createMSM5205PCM} from '../js/msm5205_pcm.js';
import {createCDDAPCM} from '../js/cdda_pcm.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';

const msmWasm=await readFile(new URL('../generated/msm5205_wasm.wasm',import.meta.url));
const cddaWasm=await readFile(new URL('../generated/cdda_wasm.wasm',import.meta.url));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const peak=values=>values.reduce((value,sample)=>Math.max(value,Math.abs(sample)),0);
function node(context){return{context,edges:new Set(),connect(input){this.edges.add(input);},disconnect(){this.edges.clear();}};}
function wav(){
  const count=4096,bytes=new Uint8Array(44+count*4),v=new DataView(bytes.buffer);
  const tag=(offset,text)=>bytes.set(new TextEncoder().encode(text),offset);
  tag(0,'RIFF');v.setUint32(4,bytes.length-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);
  v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,44100,true);v.setUint32(28,176400,true);v.setUint16(32,4,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,count*4,true);
  for(let i=0;i<count;i++){v.setInt16(44+i*4,Math.round(4000*Math.sin(i*2*Math.PI*440/44100)),true);v.setInt16(46+i*4,Math.round(3000*Math.sin(i*2*Math.PI*660/44100)),true);}return bytes;
}
function fixture(options={}){
  const context={state:'running',sampleRate:48000},inputs={msm5205:node(context),cdda:node(context)},adapters=[],reads=[];
  const engine={context,getChipInputNode:id=>inputs[id],getChipMix:id=>({volume:id==='msm5205'?.5:.75,pan:0,muted:false})};
  let current=true;
  async function create(name,ctx,{signal}){
    const core=name==='msm5205'?await createMSM5205PCM({wasmBinary:msmWasm,sampleRate:ctx.sampleRate}):await createCDDAPCM({wasmBinary:cddaWasm,sampleRate:ctx.sampleRate});
    const adapter={name,core,node:node(ctx),disposals:0,prepares:0,
      async prepare(bytes){signal.throwIfAborted();this.prepares++;core.prepare(bytes);},
      async command(action){signal.throwIfAborted();if(action.type==='state')return core.readState?.()??core.status();
        if(action.type==='play'){core.play(action);if(name==='cdda'&&action.sourceFrame)core.seek(action.sourceFrame);}
        else if(action.type==='write-register')core.writeRegister(action.register,action.value);
        else if(action.type==='seek')core.seek(action.sourceFrame);else core[action.type]();return core.readState?.()??core.status();},
      dispose(){if(this.disposals)return;this.disposals++;this.node.disconnect();core.dispose();},
      render(frames=512){const left=new Float32Array(frames),right=new Float32Array(frames);core.render(left,right);return{left,right};}};
    signal.addEventListener('abort',()=>adapter.dispose(),{once:true});adapters.push(adapter);return adapter;
  }
  const host=createHuc6280Cdrom2Audio({engine,isCurrent:()=>current,
    readFile:async path=>{reads.push(path);if(path==='/track.wav')return wav();return Uint8Array.from([0x77,0x77,0xff,0xff,0x11,0x22]);},
    createMsmAudio:(...args)=>create('msm5205',...args),createCddaAdapter:(...args)=>create('cdda',...args),...options});
  return{host,engine,context,inputs,adapters,reads,retire(){current=false;host.dispose();}};
}

test('Code media is lazy, shares the Synth clock and renders existing ADPCM/CD-DA APIs with real WASM',async()=>{
  const f=fixture();assert.equal(f.adapters.length,0);
  try{
    const adpcm=await f.host.useSoundChip('msm5205');assert.equal(adpcm,await f.host.useSoundChip('msm5205'));
    const info=await adpcm.loadSample({sampleRate:8000,channels:[Float32Array.from({length:800},(_,i)=>.3*Math.sin(i*2*Math.PI*220/8000))]},{rate:12});
    assert(info.bytes>0&&info.bytes<=65536);await adpcm.play({loop:true});
    assert(peak(f.adapters[0].render().left)>.01);assert.equal((await adpcm.getState()).volume,.5);
    const cd=await f.host.useSoundChip('cdda');await cd.load('/track.wav');await cd.play();
    const stereo=f.adapters[1].render();assert(peak(stereo.left)>.01&&peak(stereo.right)>.01);assert.notDeepEqual(stereo.left,stereo.right);
    await cd.pause();const paused=await cd.getState();assert.equal(paused.state,'paused');assert.equal(peak(f.adapters[1].render().left),0);
    assert.equal((await cd.getState()).positionFrames,paused.positionFrames);await cd.resume();assert(peak(f.adapters[1].render().left)>.01);
    await cd.seek(0);assert.equal((await cd.getState()).positionFrames,0);assert.equal((await cd.list()).length,1);
    assert.deepEqual(f.reads,['/track.wav']);
    assert.deepEqual([...f.adapters[0].node.edges],[f.inputs.msm5205]);assert.deepEqual([...f.adapters[1].node.edges],[f.inputs.cdda]);
    assert(f.adapters.every(adapter=>adapter.node.context===f.context));
  }finally{f.host.dispose();assert(f.adapters.every(adapter=>adapter.disposals===1&&adapter.node.edges.size===0));assert.equal(f.context.state,'running');}
});

test('media Stop/dispose fences delayed Files reads and never uploads into a retired player',async()=>{
  const gate=deferred(),f=fixture({readFile:async()=>gate.promise});
  const adpcm=await f.host.useSoundChip('msm5205'),loading=adpcm.loadMemory('/late.adpcm'),rejected=assert.rejects(loading,{name:'AbortError'});
  await turn();f.retire();gate.resolve(Uint8Array.from([0x12,0x34]));await rejected;
  assert.equal(f.adapters[0].prepares,0);await assert.rejects(adpcm.play(),{name:'AbortError'});assert.equal(f.adapters[0].disposals,1);
});

test('an old lazy endpoint finishing after session retirement is disposed before it can connect',async()=>{
  const gate=deferred(),context={state:'running'},input=node(context);let current=true,disposals=0;
  const adapter={node:node(context),dispose(){disposals++;}};
  const host=createHuc6280Cdrom2Audio({engine:{context,getChipInputNode:()=>input},isCurrent:()=>current,createMsmAudio:()=>gate.promise});
  const pending=host.useSoundChip('msm5205'),rejected=assert.rejects(pending,{name:'AbortError'});
  current=false;host.dispose();gate.resolve(adapter);await rejected;
  assert.equal(disposals,1);assert.equal(adapter.node.edges.size,0);
});

test('disposing one Code media source leaves its sibling and allows a fresh source on the same clock',async()=>{
  const f=fixture();try{
    const m=await f.host.useSoundChip('msm5205'),cd=await f.host.useSoundChip('cdda');await cd.load(wav());await cd.play();
    await m.dispose();await assert.rejects(m.getState(),{name:'AbortError'});assert.equal((await cd.getState()).state,'playing');
    const next=await f.host.useSoundChip('msm5205');assert.notEqual(next,m);await next.loadMemory(Uint8Array.from([0x77,0xff]));await next.play();
    assert.equal(f.adapters.length,3);assert.equal(f.context.state,'running');
  }finally{f.host.dispose();assert(f.adapters.every(adapter=>adapter.disposals===1));}
});

test('an alien-context media endpoint rejects before connection and cannot become the shared Code source',async()=>{
  const context={state:'running'},adapter={node:node({state:'running'}),disposals:0,dispose(){this.disposals++;}};
  const host=createHuc6280Cdrom2Audio({engine:{context,getChipInputNode:()=>node(context)},createCddaAdapter:async()=>adapter});
  await assert.rejects(host.useSoundChip('cdda'),/AudioContext/);assert.equal(adapter.node.edges.size,0);assert.equal(adapter.disposals,1);host.dispose();
});

test('the real guarded Code runtime can wrap both media clients, preserve Apply and fence Stop',async()=>{
  let current;const sessions=[];
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>performance.now()/1000,
    supportedSoundChips:['msm5205','cdda'],guardExecution:true,createTaskChannel:()=>null,
    useSoundChip:async name=>{
      if(!current){current=fixture();sessions.push(current);}return current.host.useSoundChip(name);
    },stopSoundChips:async()=>{current?.retire();current=null;}});
  try{
    await runtime.run(`
const adpcm=await useSoundChip('msm5205');
context.adpcm=adpcm;
context.encoded=await adpcm.loadSample({sampleRate:8000,channels:[Float32Array.from({length:800},(_,i)=>.3*Math.sin(i*2*Math.PI*220/8000))]},{rate:12});
await adpcm.play({loop:true});
context.msmState=await adpcm.getState();
const cd=await useSoundChip('cdda');
context.cd=cd;
await cd.load('/track.wav');await cd.play();
context.cdState=await cd.getState();
context.loaded=true;
`);
    const context=runtime.getContext(),f=current;
    assert.equal(runtime.getState().state,'running');assert.equal(context.loaded,true);
    assert(context.encoded.bytes>0);assert.equal(context.msmState.state,'playing');assert.equal(context.cdState.state,'playing');
    assert(peak(f.adapters[0].render().left)>.01);assert(peak(f.adapters[1].render().left)>.01);
    const position=(await context.cd.getState()).positionFrames;assert(position>0);
    await runtime.apply(`
const adpcm=await useSoundChip('msm5205'),cd=await useSoundChip('cdda');
context.applied=adpcm.id===context.adpcm.id&&cd.id===context.cd.id;
context.sameEvaluation=adpcm===await useSoundChip('msm5205')&&cd===await useSoundChip('cdda');
await adpcm.play({loop:true});
await cd.pause();context.paused=(await cd.getState()).state;
await cd.resume();context.resumed=(await cd.getState()).positionFrames;
`);
    assert.equal(runtime.getContext(),context);assert.equal(context.applied,true);assert.equal(context.sameEvaluation,true);
    assert.equal(context.paused,'paused');assert.equal(context.resumed,position);assert.equal(sessions.length,1);
    const oldAdpcm=context.adpcm,oldCd=context.cd;
    await runtime.stop();assert(f.adapters.every(adapter=>adapter.disposals===1));
    await assert.rejects(async()=>oldAdpcm.play(),{name:'AbortError'});
    await assert.rejects(async()=>oldCd.getState(),{name:'AbortError'});
  }finally{await runtime.stop();}
});
