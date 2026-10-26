import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import factory from '../docs/generated/wonderswan_wasm.js';
import {WonderSwan,WONDERSWAN_CLOCK} from './wonderswan.js';
import {WonderSwanAudioEngine} from './wonderswanaudioengine.js';
import {VgmPlayer} from './vgmplayer.js';
import {WonderSwanVoiceInspector} from './playground_wonderswan_inspector.js';
import {ChipClockResampler,validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {vgmBytes} from './test-support/vgm-mock.js';

const binary=await readFile(new URL('../docs/generated/wonderswan_wasm.wasm',import.meta.url));
const module=await factory({wasmBinary:binary});
const create=(rate=44100,clock=3072000,volume=1)=>WonderSwanAudioEngine.create({moduleFactory:async()=>module,clock,outputSampleRate:rate,masterVolume:volume});
const workletSource=(await readFile(new URL('./playground_wonderswan_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
async function processor(rate,clock){
  let Type,readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);
  const port={postMessage:value=>{if(value.ready||value.error)readyResolve(value);}};
  vm.runInNewContext(workletSource,{WonderSwan,WONDERSWAN_CLOCK,factory:async()=>module,WonderSwanVoiceInspector,
    ChipClockResampler,validateChipClock,receiveChipInspector,sampleRate:rate,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>0}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(name,ctor)=>Type=ctor});
  const p=new Type({processorOptions:{clock,wasmBinary:binary}});assert.equal((await ready).ready,true);return p;
}
function setup(write,memory,mode='wave'){
  write(0x11,8);
  for(let ch=0;ch<4;ch++){
    for(let i=0;i<16;i++)memory(ch*16+i,((i*2+ch*3)&15)|(((i*2+1+ch*3)&15)<<4));
    const f=1737+ch*69;write(ch*2,f&255);write(ch*2+1,f>>8);write(8+ch,[0xf1,0x2e,0xb5,0x79][ch]);
  }
  write(0x10,mode==='pcm'?0x22:mode==='noise'?0x88:mode==='sweep'?0x44:15);
  if(mode==='noise')write(14,0x1f);
  if(mode==='sweep'){write(12,0xff);write(13,0);}
  if(mode==='pcm'){write(20,15);write(9,0xe3);}
}
test('WonderSwan Analyzer engine equals actual Playground Worklet speaker PCM at 3 rates and 2 clocks',async()=>{
  let compared=0;
  for(const rate of [44100,48000,96000])for(const clock of [3072000,3579545])for(const mode of ['wave','noise','sweep','pcm']){
    const engine=await create(rate,clock),p=await processor(rate,clock);
    const write=(r,v)=>{engine.writeWonderSwan(r,v);p.receive({method:'writeRegister',args:[0x80+r,v]});};
    const memory=(a,v)=>{engine.writeWonderSwanMemory(a,v);p.receive({method:'writeMemory',args:[a,v]});};
    try{
      setup(write,memory,mode);
      for(let block=0;block<30;block++){
        if(block===3)memory(3,255);
        if(block===7)write(8,0x0f);
        if(block===10)write(0x11,0);
        if(block===13)write(0x11,8);
        if(block===17){engine.reset();p.receive({method:'reset'});setup(write,memory,mode);}
        if(block===24)write(0x10,0);
        const n=[1,7,113,257,128][block%5],actual=engine.processFrames(n),left=new Float32Array(n),right=new Float32Array(n);
        p.process([],[[left,right]]);
        assert.deepEqual(actual.left,left,`${rate}/${clock}/${mode} block${block} left`);
        assert.deepEqual(actual.right,right,`${rate}/${clock}/${mode} block${block} right`);compared+=n;
      }
    }finally{engine.dispose();p.dispose();}
  }
  assert.equal(compared,72864);
});
test('WonderSwan speaker mute is immediate, phase-preserving, retained across reset, and gain applies once',async()=>{
  const engine=await create(48000),reference=await create(48000),scaled=await create(48000,3072000,.5);
  try{
    for(const e of [engine,reference,scaled])setup(e.writeWonderSwan.bind(e),e.writeWonderSwanMemory.bind(e));
    const first=reference.processFrames(333),actual=engine.processFrames(333),half=scaled.processFrames(333);
    assert.deepEqual(actual,first);assert.deepEqual(half.left,Float32Array.from(first.left,x=>x*.5));
    assert.ok(first.left.some(x=>x!==0));
    for(let ch=0;ch<4;ch++)engine.setChannelMuted(ch,true);
    for(const n of [1,7,128,901]){assert.ok(engine.processFrames(n).left.every(x=>x===0));reference.processFrames(n);}
    for(let ch=0;ch<4;ch++)engine.setChannelMuted(ch,false);
    assert.deepEqual(engine.processFrames(512),reference.processFrames(512));
    engine.setChannelMuted(0,true);engine.reset();setup(engine.writeWonderSwan.bind(engine),engine.writeWonderSwanMemory.bind(engine));
    engine.writeWonderSwan(16,1);assert.ok(engine.processFrames(512).left.every(x=>x===0));
    engine.setChannelMuted(0,false);assert.ok(engine.processFrames(512).left.some(x=>x!==0));
  }finally{engine.dispose();reference.dispose();scaled.dispose();}
});
test('WonderSwan real VGM renders stereo, resets identically, and restart-and-render seeking matches uninterrupted PCM',async()=>{
  const bytes=await readFile(new URL('../test/fixtures/wonderswan-tone.vgm',import.meta.url));
  const engine=await create(48000),player=new VgmPlayer(engine);
  function render(frames,size){const left=new Float32Array(frames),right=new Float32Array(frames);for(let at=0;at<frames;){const n=Math.min(size,frames-at);player.process(left.subarray(at,at+n),right.subarray(at,at+n),n);at+=n;}return {left,right};}
  try{
    player.load(bytes);player.play();const reference=render(24000,257);
    assert.ok(reference.left.some(x=>x>0)&&reference.left.some(x=>x<0));
    assert.notDeepEqual(reference.left,reference.right);assert.equal(player.supportsState(),false);
    player.stop();player.play();assert.deepEqual(render(24000,113),reference);
    player.reset();player.play();render(12001,127);const sought=render(11999,31);
    assert.deepEqual(sought.left,reference.left.slice(12001));assert.deepEqual(sought.right,reference.right.slice(12001));
    const retained=reference.left.slice();engine.processFrames(4096);engine.dispose();assert.deepEqual(reference.left,retained);
    assert.throws(()=>engine.processFrames(0),/disposed/);
  }finally{engine.dispose();}
});
test('WonderSwan engine validates complete writes and uses cold-wave fence rather than an artificial DC edge',async()=>{
  const engine=await create();
  try{
    assert.throws(()=>engine.writeWonderSwan(32,1),/register/);
    assert.throws(()=>engine.writeWonderSwan(0,256),/byte/);
    assert.throws(()=>engine.loadWonderSwanMemory(new Uint8Array(2),0x3fff),/16 KiB/);
    assert.equal(engine.memory[0x3fff],0);
    engine.loadWonderSwanMemory(new Uint8Array(16).fill(0x88));
    engine.writeWonderSwan(8,0xff);engine.writeWonderSwan(17,8);engine.writeWonderSwan(16,1);
    assert.ok(engine.processFrames(4096).left.every(x=>x===0),'constant wave is silent even on first fetch');
    for(const frames of [-1,.5,NaN,Infinity,0x1000001])assert.throws(()=>engine.processFrames(frames),RangeError);
    assert.equal(engine.processFrames(0).left.length,0);
  }finally{engine.dispose();}
});
test('WonderSwan streamed PCM equals equivalent timed direct writes through real WASM',async()=>{
  const values=Array.from({length:64},(_,i)=>(i*37)&255),setup=[0xbc,17,8,0xbc,20,15,0xbc,16,0x22];
  const direct=[...setup];for(const value of values)direct.push(0xbc,9,value,0x71);direct.push(0xbc,16,0,0x66);
  const stream=[...setup,0x67,0x66,0x0a,64,0,0,0,...values,0x90,0,0x21,0,9,
    0x91,0,0x0a,1,0,0x92,0,0x22,0x56,0,0,0x95,0,0,0,0,0x61,128,0,0xbc,16,0,0x66];
  const a=await create(48000),b=await create(48000);
  try{
    const outputs=[];
    for(const [engine,commands]of [[a,direct],[b,stream]]){
      const player=new VgmPlayer(engine);player.load(vgmBytes(commands));player.play();
      const left=new Float32Array(139),right=new Float32Array(139);
      for(let at=0;at<139;at+=7)player.process(left.subarray(at,Math.min(at+7,139)),right.subarray(at,Math.min(at+7,139)),Math.min(7,139-at));
      outputs.push({left,right});
    }
    assert.deepEqual(outputs[0],outputs[1]);assert.ok(outputs[0].left.some(value=>value!==0));
  }finally{a.dispose();b.dispose();}
});
