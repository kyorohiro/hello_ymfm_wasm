import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ym3526AudioEngine} from './ym3526audioengine.js';
import oplFactory from '../docs/generated/ym3526_wasm.js';
import {Ym3812AudioEngine} from './ym3812audioengine.js';
import {Ymf262AudioEngine} from './ymf262audioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import opl2Factory from '../docs/generated/ym3812_wasm.js';
import opl3Factory from '../docs/generated/ymf262_wasm.js';
const configs=[['ym3526',Ym3526AudioEngine,oplFactory,3579545,0x54,0x5b],['ym3812',Ym3812AudioEngine,opl2Factory,3579545,0x50,0x5a],['ymf262',Ymf262AudioEngine,opl3Factory,14318180,0x5c,0x5e]];
function options(chip,factory){return {[`${chip}ModuleFactory`]:factory,[`${chip}ModuleOptions`]:{wasmBinary:readFileSync(new URL(`../docs/generated/${chip}_wasm.wasm`,import.meta.url))}};}
function voice(port=0,channel=0,pan=0x30){
 const base=[0,1,2,8,9,10,16,17,18][channel];const regs=[];
 for(const slot of [base,base+3])for(const [r,v] of [[0x20,1],[0x40,16],[0x60,0xf0],[0x80,0x0f],[0xe0,0]])regs.push([port,r+slot,v]);
 return [...regs,[port,0xc0+channel,pan|1],[port,0xa0+channel,0x98],[port,0xb0+channel,0x31]];
}
function data(config,registers){const [chip,,,clock,offset,command]=config;
 const writes=registers??(chip==='ymf262'?[[1,5,1],...voice(1)]:voice());
 const cmds=[...writes.flatMap(([p,r,v])=>[command+p,r,v]),0x61,0x3a,0x11,0x66];
 const bytes=new Uint8Array(0x100+cmds.length),view=new DataView(bytes.buffer);
 bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x151,true);view.setUint32(0x34,0xcc,true);view.setUint32(offset,clock,true);view.setUint32(0x18,4410,true);bytes.set(cmds,0x100);return bytes;
}
function write(engine,chip,regs){for(const [p,r,v] of regs)chip==='ymf262'?engine.writeYmf262(p,r,v):chip==='ym3526'?engine.writeYm3526(r,v):engine.writeYm3812(r,v);}
for(const config of configs){const [chip,Engine,factory]=config;
 for(const Parser of [Ym2612VGM,DocsVGM])test(`${chip} import scans and port delivery (${Parser===DocsVGM?'docs':'web'})`,()=>{
  const regs=chip==='ymf262'?[[1,5,1],...voice(0),...voice(1)]:voice();
  const p=new Parser(data(config,regs));assert.equal(p.header[`${chip}Clock`],config[3]);assert.equal([...p.analyzeCommandUsage().values()].reduce((a,b)=>a+b),regs.length+2);
  assert.deepEqual(p.dataBlockSummary(),[]);assert.deepEqual(p.pcmRamWriteSummary(),[]);assert.doesNotThrow(()=>p.analyzeSpecialCommands());assert.doesNotThrow(()=>p.analyzeCommandContext(0x92));
  assert.match(p.analyzeCommandContext(config[5]).join('\n'),new RegExp(chip));
  const seen=[];const targets={[chip]:{writeRegister:(r,v,port=0)=>seen.push([port,r,v])}};
  for(let i=0;i<regs.length;i++)p.playStep(targets);assert.deepEqual(seen,regs);assert.deepEqual(p.step(),{type:'wait',samples:4410});
  const short=data(config).slice(0,0x102);assert.throws(()=>new Parser(short).step());
  const old=data(config);new DataView(old.buffer).setUint32(0x34,12,true);old[0x40]=0x66;assert.equal(new Parser(old).header[`${chip}Clock`],0);
 });
 test(`${chip} VGM audio, reset, seek and partitions`,async()=>{
  const e=await Engine.create(options(chip,factory));try{
   const p=new VgmPlayer(e);p.load(data(config));p.play();const full=new Float32Array(4410),right=new Float32Array(4410);p.process(full,right,4410);
   assert(full.some(x=>Math.abs(x)>.001));assert(full.every(Number.isFinite));assert.deepEqual(full,right);
   p.reset();p.play();const repeat=new Float32Array(4410);p.process(repeat,right,4410);assert.deepEqual(repeat,full);
   await seekPlayback(p,1000);p.resume();const part=new Float32Array(500);p.process(part,new Float32Array(500),500);assert.deepEqual(part,full.slice(1000,1500));
   p.reset();p.play();const chunks=[512,2048,1850].flatMap(n=>{const a=new Float32Array(n);p.process(a,new Float32Array(n),n);return [...a];});assert.deepEqual(Float32Array.from(chunks),full);
  }finally{e.dispose();}
 });
 test(`${chip} timers advance and reset`,async()=>{
  const e=await Engine.create(options(chip,factory));try{write(e,chip,[[0,2,255],[0,4,1]]);e.processFrames(500);assert(e[chip].readStatus()&0x40);assert(e[chip].getIrq());e.reset();assert.equal(e[chip].getIrq(),false);}finally{e.dispose();}
 });
 test(`${chip} rhythm mode generates finite output`,async()=>{
  const e=await Engine.create(options(chip,factory));try{if(chip==='ymf262')e.writeYmf262(1,5,1);write(e,chip,[...voice(0,6),...voice(0,7),...voice(0,8),[0,0xbd,0x3f]]);const a=e.processFrames(2048);assert(a.left.some(x=>Math.abs(x)>.001));assert(a.left.every(Number.isFinite));}finally{e.dispose();}
 });
}
test('OPL3 stereo output buses and both banks',async()=>{
 const e=await Ymf262AudioEngine.create(options('ymf262',opl3Factory));try{
 for(const port of [0,1])for(let channel=0;channel<9;channel++)for(const pan of [0x10,0x20,0x40,0x80]){
  e.reset();e.writeYmf262(1,5,1);write(e,'ymf262',voice(port,channel,pan));const a=e.processFrames(600);
  assert.equal(a.left.some(x=>Math.abs(x)>.001),Boolean(pan&0x50));assert.equal(a.right.some(x=>Math.abs(x)>.001),Boolean(pan&0xa0));
 }
 }finally{e.dispose();}
});
test('OPL3 four-operator mode generates output',async()=>{
 const e=await Ymf262AudioEngine.create(options('ymf262',opl3Factory));try{
  e.writeYmf262(1,5,1);e.writeYmf262(1,4,1);write(e,'ymf262',[...voice(0,3),...voice(0,0)]);
  const a=e.processFrames(2048);assert(a.left.some(x=>Math.abs(x)>.001));assert(a.left.every(Number.isFinite));
 }finally{e.dispose();}
});

test('YM3526 keeps its sine waveform when OPL2 waveform registers are written', async()=>{
 const e=await Ym3526AudioEngine.create(options('ym3526',oplFactory));
 try {
  const render=wave=>{e.reset();write(e,'ym3526',[[0,1,0x20],...voice(),[0,0xe0,wave],[0,0xe3,wave]]);return e.processFrames(2048).left;};
  const sine=render(0);assert(sine.some(x=>Math.abs(x)>.001));
  for(const wave of [1,2,3])assert.deepEqual(render(wave),sine);
 }finally{e.dispose();}
});
for(const Parser of [Ym2612VGM,DocsVGM])test(`YM3526 rejects second-chip playback and DAC streams (${Parser===DocsVGM?'docs':'web'})`,()=>{
 const second=data(configs[0]);second[0x100]=0xab;
 const p=new Parser(second);assert.equal(p.step().chipIndex,1);p.reset();assert.throws(()=>p.playStep({}),/Second YM3526/);
 const stream=data(configs[0]);stream.set([0x90,0,0x0a,0,0],0x100);assert.throws(()=>new Parser(stream).step(),/OPL DAC streams/);
 const older=data(configs[0]);new DataView(older.buffer).setUint32(8,0x150,true);assert.equal(new Parser(older).header.ym3526Clock,0);
});
