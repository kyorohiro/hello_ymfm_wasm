import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ay8910,validateAy8910} from './ay8910.js';
import {Ay8910AudioEngine,validateAyPlaybackHeader} from './ay8910audioengine.js';
import {MsxAudioEngine} from './msxaudioengine.js';
import {Ym2413AudioEngine} from './ym2413audioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import factory from '../docs/generated/ay8910_wasm.js';
import opllFactory from '../docs/generated/ym2413_wasm.js';
const options={moduleFactory:factory,moduleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/ay8910_wasm.wasm',import.meta.url))}};
const opllOptions={ym2413ModuleFactory:opllFactory,ym2413ModuleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/ym2413_wasm.wasm',import.meta.url))}};
function vgm(commands,{type=0,flags=1,clock=1789773,opll=0,loop=false}={}){
  const bytes=new Uint8Array(0x100+commands.length),v=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);
  v.setUint32(0x74,clock,true);bytes[0x78]=type;bytes[0x79]=flags;v.setUint32(0x10,opll,true);v.setUint32(0x18,4410,true);
  if(loop){v.setUint32(0x1c,0x100-0x1c,true);v.setUint32(0x20,4410,true);}
  bytes.set(commands,0x100);return bytes;
}
const tune=[0xa0,0,64,0xa0,1,0,0xa0,7,0x3e,0xa0,8,15,0x61,0x3a,0x11,0x66];
function program(chip){chip.writeRegister(0,64);chip.writeRegister(7,0x3e);chip.writeRegister(8,15);}
for(const Parser of [Ym2612VGM,DocsVGM])test(`AY import and playback parser (${Parser===DocsVGM?'docs':'web'})`,()=>{
  const p=new Parser(vgm(tune,{type:16,flags:17}));
  assert.equal(p.header.ay8910Clock,1789773);assert.equal(p.header.ay8910Type,16);assert.equal(p.header.ay8910Flags,17);
  assert.deepEqual([...p.analyzeCommandUsage()],[['0xa0',4],['0x61',1],['0x66',1]]);
  assert.deepEqual(p.dataBlockSummary(),[]);assert.deepEqual(p.pcmRamWriteSummary(),[]);
  assert.doesNotThrow(()=>p.analyzeSpecialCommands());assert.match(p.analyzeCommandContext(0xa0).join('\n'),/ay8910 register/);
  const writes=[];const target={ay8910:{writeRegister:(...a)=>writes.push(a)}};
  for(let i=0;i<4;i++)p.playStep(target);
  assert.deepEqual(writes,[[0,64],[1,0],[7,62],[8,15]]);assert.deepEqual(p.playStep(target),{type:'wait',samples:4410});
  assert.throws(()=>new Parser(vgm([0xa0,0x80,1,0x66])).playStep(target),/Second AY/);
  assert.equal(writes.length,4);
  assert.throws(()=>new Parser(vgm([0xa0,0])).step());
  const short=vgm([0x66]);new DataView(short.buffer).setUint32(0x34,0x0c,true);short[0x40]=0x66;
  assert.equal(new Parser(short).header.ay8910Clock,0);assert.equal(new Parser(short).header.ay8910Type,0);
  assert.throws(()=>new Parser(vgm([0x90,0,0x12,0,8,0x66])).step(),/AY DAC streams/);
});
for(const type of [0,16])test(`AY type ${type}: PCM, partitioning, IO and mute phase`,async()=>{
  const a=await Ay8910.create({...options,type}),b=await Ay8910.create({...options,type});
  try{
    program(a);program(b);
    const full=a.generateStereo(4096);
    const parts=[512,2048,1,17,1518].map(n=>b.generateStereo(n).left);
    assert.deepEqual(Float32Array.from(parts.flatMap(x=>[...x])),full.left);
    assert.deepEqual(full.left,full.right);
    assert(Math.max(...full.left)-Math.min(...full.left)>.05);
    a.setMuteMask(7);assert(a.generateStereo(1000).left.every(x=>x===0));b.generateStereo(1000);
    a.setMuteMask(0);assert.deepEqual(a.generateStereo(500).left,b.generateStereo(500).left);
    a.writeRegister(14,0xab);a.writeRegister(15,0xcd);assert.equal(a.read(14),0xab);assert.equal(a.read(15),0xcd);
    a.reset();program(a);assert.deepEqual(a.generateStereo(4096).left,full.left);
    for(const n of [-1,NaN,0.5,0x1000001])assert.throws(()=>a.generateStereo(n),RangeError);
    assert.equal(a.generateStereo(0).left.length,0);
  }finally{a.dispose();b.dispose();}
  assert.throws(()=>a.generateStereo(1),/disposed/);a.dispose();
});
test('AY type, clock, flags and unsupported combinations reject explicitly',()=>{
  for(const type of [1,2,3,17,255])assert.throws(()=>validateAy8910({type}),/Support coming soon/);
  for(const flags of [2,4,8,32,128])assert.throws(()=>validateAy8910({flags}),/Support coming soon/);
  for(const clock of [0,-1,NaN,Infinity])assert.throws(()=>validateAy8910({clock}),RangeError);
  assert.throws(()=>validateAyPlaybackHeader({ay8910Clock:0x40000001}),/Multiple/);
  assert.throws(()=>validateAyPlaybackHeader({ay8910Clock:1789773,k051649Clock:1789773}),/k051649/);
});
test('AY VGM reset, pause, seek and loop preserve PCM and time',async()=>{
  const engine=await Ay8910AudioEngine.create(options);
  try{
    const p=new VgmPlayer(engine);p.load(vgm(tune,{loop:true}));p.play();
    const all=new Float32Array(4410);p.process(all,new Float32Array(4410),4410);
    await seekPlayback(p,1000);p.resume();
    const part=new Float32Array(400);p.process(part,new Float32Array(400),400);assert.deepEqual(part,all.slice(1000,1400));
    p.pause();const silent=new Float32Array(100);p.process(silent,silent,100);assert(silent.every(x=>x===0));
    p.reset();p.setLoopEnabled(true);p.play();p.process(new Float32Array(8820),new Float32Array(8820),8820);assert(p.isPlaying());
  }finally{engine.dispose();}
});
test('AY + OPLL mix matches independent chips and source mutes keep advancing',async()=>{
  const a=await Ay8910AudioEngine.create(options),b=await Ym2413AudioEngine.create(opllOptions);
  const mix=await MsxAudioEngine.create({ayModuleFactory:factory,ayModuleOptions:options.moduleOptions,ayClock:1789773,...opllOptions});
  try{
    for(const e of [a,mix]){e.writeAy8910(0,64);e.writeAy8910(7,62);e.writeAy8910(8,15);}
    for(const e of [b,mix]){e.writeYm2413(0x30,0x10);e.writeYm2413(0x10,0x80);e.writeYm2413(0x20,0x17);}
    const x=a.processFrames(1000),y=b.processFrames(1000),z=mix.processFrames(1000);
    assert.deepEqual(z.left,Float32Array.from(x.left,(v,i)=>v+y.left[i]));
    mix.setAyMuted(true);assert.deepEqual(mix.processFrames(300).left,b.processFrames(300).left);a.processFrames(300);
    mix.setAyMuted(false);mix.setOpllMuted(true);assert.deepEqual(mix.processFrames(300).left,a.processFrames(300).left);
    mix.setAyMuted(true);assert(mix.processFrames(300).left.every(x=>x===0));
  }finally{a.dispose();b.dispose();mix.dispose();}
});
test('AY + OPLL VGM dispatches both command types through the player and seeks',async()=>{
  const engine=await MsxAudioEngine.create({ayModuleFactory:factory,ayModuleOptions:options.moduleOptions,ayClock:1789773,...opllOptions});
  try{
    const commands=[...tune.slice(0,12),0x51,0x30,0x10,0x51,0x10,0x80,0x51,0x20,0x17,...tune.slice(12)];
    const p=new VgmPlayer(engine);p.load(vgm(commands,{opll:3579545}));p.play();
    const full=new Float32Array(4410);p.process(full,new Float32Array(4410),4410);
    assert(Math.max(...full)-Math.min(...full)>.05);
    await seekPlayback(p,1200);p.resume();const part=new Float32Array(500);p.process(part,new Float32Array(500),500);
    assert.deepEqual(part,full.slice(1200,1700));
  }finally{engine.dispose();}
});
test('YM2149 pin26 divider equals halving the input clock',async()=>{
  const a=await Ay8910.create({...options,type:16,flags:17,clock:2000000});
  const b=await Ay8910.create({...options,type:16,flags:1,clock:1000000});
  try{program(a);program(b);assert.deepEqual(a.generateStereo(4096).left,b.generateStereo(4096).left);}
  finally{a.dispose();b.dispose();}
});

test('MSX Y8950 + AY + OPLL mixes independent audio including ADPCM, resets and seeks',async()=>{
 const {Y8950AudioEngine}=await import('./y8950audioengine.js');
 const {default:yFactory}=await import('../docs/generated/y8950_wasm.js');
 const yOptions={y8950ModuleFactory:yFactory,y8950ModuleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/y8950_wasm.wasm',import.meta.url))},y8950Clock:3579545};
 const mix=await MsxAudioEngine.create({ayModuleFactory:factory,ayModuleOptions:options.moduleOptions,ayClock:1789773,...opllOptions,...yOptions});
 const a=await Ay8910AudioEngine.create({...options,clock:1789773}),b=await Ym2413AudioEngine.create(opllOptions),c=await Y8950AudioEngine.create(yOptions);
 try{
  const memory=new Uint8Array(256).fill(0x17);
  const ay=[[0,64],[7,62],[8,15]],opll=[[0x30,0x10],[0x10,0x80],[0x20,0x17]];
  const y=[[8,1],[9,0],[10,0],[11,7],[12,0],[16,255],[17,255],[18,255],[7,0xb0]];
  for(const [r,v] of ay)a.writeAy8910(r,v);
  for(const [r,v] of opll)b.writeYm2413(r,v);
  c.loadSampleMemory(memory,0,256);for(const [r,v] of y)c.writeY8950(r,v);
  const block=new Uint8Array(15+memory.length),dv=new DataView(block.buffer);
  block.set([0x67,0x66,0x88]);dv.setUint32(3,264,true);dv.setUint32(7,256,true);block.set(memory,15);
  const song=vgm([...block,...ay.flatMap(([r,v])=>[0xa0,r,v]),...opll.flatMap(([r,v])=>[0x51,r,v]),...y.flatMap(([r,v])=>[0x5c,r,v]),0x61,0x3a,0x11,0x66],{opll:3579545});
  new DataView(song.buffer).setUint32(0x58,3579545,true);
  const p=new VgmPlayer(mix);p.load(song);p.play();const full=new Float32Array(4410);p.process(full,new Float32Array(4410),4410);
  const x=a.processFrames(4410),z=b.processFrames(4410),w=c.processFrames(4410);
  for(const pcm of [x,z,w])assert(pcm.left.some(v=>Math.abs(v)>.001));
  assert.deepEqual(full,Float32Array.from(x.left,(v,i)=>v+z.left[i]+w.left[i]));
  p.reset();p.play();const repeat=new Float32Array(4410);p.process(repeat,new Float32Array(4410),4410);assert.deepEqual(repeat,full);
  await seekPlayback(p,1000);p.resume();const part=new Float32Array(500);p.process(part,new Float32Array(500),500);assert.deepEqual(part,full.slice(1000,1500));
  p.reset();mix.setChipMuted('y8950',0,true);p.play();const muted=new Float32Array(4410);p.process(muted,new Float32Array(4410),4410);assert.deepEqual(muted,Float32Array.from(x.left,(v,i)=>v+z.left[i]));
  p.load(vgm([0x66],{opll:3579545}));assert.equal(mix.entries.get('y8950:0').engine.y8950.sampleMemory.length,0);
 }finally{mix.dispose();a.dispose();b.dispose();c.dispose();}
});
