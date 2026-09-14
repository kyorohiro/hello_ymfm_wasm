import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Y8950AudioEngine} from './y8950audioengine.js';
import {Ymf278bAudioEngine} from './ymf278baudioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import opl2Factory from '../docs/generated/y8950_wasm.js';
import opl3Factory from '../docs/generated/ymf278b_wasm.js';
const configs=[['y8950',Y8950AudioEngine,opl2Factory,3579545,0x58,0x5c],['ymf278b',Ymf278bAudioEngine,opl3Factory,33868800,0x60,0xd0]];
function options(chip,factory){return {[`${chip}ModuleFactory`]:factory,[`${chip}ModuleOptions`]:{wasmBinary:readFileSync(new URL(`../docs/generated/${chip}_wasm.wasm`,import.meta.url))}};}
function voice(port=0,channel=0,pan=0x30){
 const base=[0,1,2,8,9,10,16,17,18][channel];const regs=[];
 for(const slot of [base,base+3])for(const [r,v] of [[0x20,1],[0x40,16],[0x60,0xf0],[0x80,0x0f],[0xe0,0]])regs.push([port,r+slot,v]);
 return [...regs,[port,0xc0+channel,pan|1],[port,0xa0+channel,0x98],[port,0xb0+channel,0x31]];
}
function data(config,registers){const [chip,,,clock,offset,command]=config;
 const writes=registers??(chip==='ymf278b'?[[1,5,1],...voice(1)]:voice());
 const cmds=[...writes.flatMap(([p,r,v])=>chip === 'ymf278b' ? [command,p,r,v] : [command,r,v]),0x61,0x3a,0x11,0x66];
 const bytes=new Uint8Array(0x100+cmds.length),view=new DataView(bytes.buffer);
 bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x151,true);view.setUint32(0x34,0xcc,true);view.setUint32(offset,clock,true);view.setUint32(0x18,4410,true);bytes.set(cmds,0x100);return bytes;
}
function write(engine,chip,regs){for(const [p,r,v] of regs)chip==='ymf278b'?engine.writeYmf278b(p,r,v):engine.writeY8950(r,v);}
for(const config of configs){const [chip,Engine,factory]=config;
 for(const Parser of [Ym2612VGM,DocsVGM])test(`${chip} import scans and port delivery (${Parser===DocsVGM?'docs':'web'})`,()=>{
  const regs=chip==='ymf278b'?[[1,5,1],...voice(0),...voice(1)]:voice();
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
  const e=await Engine.create(options(chip,factory));try{if(chip==='ymf278b')e[chip].readStatus();write(e,chip,[[0,2,255],[0,4,1]]);e.processFrames(500);assert(e[chip].readStatus()&0x40);assert(e[chip].getIrq());e.reset();assert.equal(e[chip].getIrq(),false);}finally{e.dispose();}
 });
 test(`${chip} rhythm mode generates finite output`,async()=>{
  const e=await Engine.create(options(chip,factory));try{if(chip==='ymf278b')e.writeYmf278b(1,5,1);write(e,chip,[...voice(0,6),...voice(0,7),...voice(0,8),[0,0xbd,0x3f]]);const a=e.processFrames(2048);assert(a.left.some(x=>Math.abs(x)>.001));assert(a.left.every(Number.isFinite));}finally{e.dispose();}
 });
}
function withBlock(config, type, memory, regs, offset=0, memorySize=memory.length) {
 const base=data(config,regs), block=new Uint8Array(15+memory.length), view=new DataView(block.buffer);
 block.set([0x67,0x66,type]);view.setUint32(3,8+memory.length,true);view.setUint32(7,memorySize,true);view.setUint32(11,offset,true);block.set(memory,15);
 const bytes=new Uint8Array(base.length+block.length);bytes.set(base.subarray(0,0x100));bytes.set(block,0x100);bytes.set(base.subarray(0x100),0x100+block.length);
 new DataView(bytes.buffer).setUint32(4,bytes.length-4,true);return bytes;
}
for (const config of configs) {
 const [chip,Engine,factory]=config;
 test(`${chip} embedded samples render, seek, reset and clear on next file`,async()=>{
  let memory,regs,type;
  if(chip==='y8950') {
   memory=new Uint8Array(256).fill(0x17);type=0x88;
   regs=[[8,1],[9,0],[10,0],[11,7],[12,0],[16,255],[17,255],[18,255],[7,0xb0]].map(([r,v])=>[0,r,v]);
  }else{
   memory=new Uint8Array(512);memory.set([0,1,0,0,0,255,0,0,0xf0,0,0x0f,0]);
   for(let i=256;i<512;i++)memory[i]=Math.round(Math.sin(i*Math.PI/16)*100)&255;
   type=0x84;regs=[[1,5,3],[2,8,0],[2,0x20,0],[2,0x38,0],[2,0x50,1],[2,0x68,0x80]];
  }
  const e=await Engine.create(options(chip,factory));try{
   const p=new VgmPlayer(e);p.load(withBlock(config,type,memory,regs));p.play();
   const full=new Float32Array(4410);p.process(full,new Float32Array(4410),4410);
   assert(full.some(x=>Math.abs(x)>.001));assert(full.every(Number.isFinite));
   p.reset();p.play();const repeat=new Float32Array(4410);p.process(repeat,new Float32Array(4410),4410);assert.deepEqual(repeat,full);
   await seekPlayback(p,1000);p.resume();const part=new Float32Array(500);p.process(part,new Float32Array(500),500);assert.deepEqual(part,full.slice(1000,1500));
   p.load(data(config,regs));p.reset();p.play();const silent=new Float32Array(4410);p.process(silent,new Float32Array(4410),4410);assert.equal(e[chip].sampleMemory.length,0);
   const fresh=await Engine.create(options(chip,factory));try{
    const fp=new VgmPlayer(fresh);fp.load(data(config,regs));fp.reset();fp.play();const expected=new Float32Array(4410);fp.process(expected,new Float32Array(4410),4410);assert.deepEqual(silent,expected);
   }finally{fresh.dispose();}
  }finally{e.dispose();}
 });
 test(`${chip} sample block bounds and second-chip rejection`,()=>{
  const type=chip==='y8950'?0x88:0x87;
  const valid=withBlock(config,type,new Uint8Array([1,2]),[],2,4);
  const seen=[];new Ym2612VGM(valid).playStep({[chip]:{loadSampleMemory:(...args)=>seen.push(args)}});
  assert.deepEqual(seen,[[new Uint8Array([1,2]),2,4]]);
  const invalid=valid.slice();new DataView(invalid.buffer).setUint32(0x10b,4,true);assert.throws(()=>new Ym2612VGM(invalid).step(),RangeError);
  const second=valid.slice();second[0x106]|=0x80;assert.throws(()=>new Ym2612VGM(second).playStep({}),/Second OPL/);
  const truncated=valid.slice(0,0x109);assert.throws(()=>new Ym2612VGM(truncated).step());
 });
}

test('external Moonsound ROM survives file loads, reset and seeking',async()=>{
 const config=configs[1], [chip,Engine,factory]=config;
 // Original synthetic wave ROM, independent of the proprietary YRW801 data.
 const rom=new Uint8Array(0x200000);
 rom.set([0,1,0,0,0,255,0,0,0xf0,0,0x0f,0]);
 for(let i=256;i<512;i++)rom[i]=Math.round(Math.sin(i*Math.PI/16)*100)&255;
 const regs=[[1,5,3],[2,8,0],[2,0x20,0],[2,0x38,0],[2,0x50,1],[2,0x68,0x80]];
 const song=data(config,regs),e=await Engine.create(options(chip,factory));
 try{
  assert.throws(()=>e.loadWaveRom(new Uint8Array(512)),/2097152/);
  const player=new VgmPlayer(e);
  const render=()=>{player.reset();player.play();const l=new Float32Array(4410);player.process(l,new Float32Array(4410),4410);return l;};
  player.load(song);assert(render().every(x=>x===0));
  e.loadWaveRom(rom);player.load(song);const full=render();assert(full.some(x=>Math.abs(x)>.001));
  assert.deepEqual(render(),full);
  await seekPlayback(player,1000);player.resume();const part=new Float32Array(500);player.process(part,new Float32Array(500),500);assert.deepEqual(part,full.slice(1000,1500));
  // Per-song samples override the base ROM, and disappear when changing tracks.
  player.load(withBlock(config,0x84,new Uint8Array(rom.length),regs));assert(render().every(x=>x===0));
  player.load(song);assert.deepEqual(render(),full);
 }finally{e.dispose();}
});
for(const Parser of [Ym2612VGM,DocsVGM]) test(`missing wave ROM detection (${Parser===DocsVGM?'docs':'web'})`,()=>{
 const config=configs[1];
 const parser=new Parser(data(config,[[1,5,3],[2,0x68,0x80]]));
 const position=parser.position;
 assert.equal(parser.requiresYmf278bWaveRom(),true);assert.equal(parser.position,position);
 assert.equal(new Parser(data(config)).requiresYmf278bWaveRom(),false); // FM only
 assert.equal(new Parser(withBlock(config,0x84,new Uint8Array(512),[[2,0x68,0x80]])).requiresYmf278bWaveRom(),false);
 assert.equal(new Parser(data(configs[0])).requiresYmf278bWaveRom(),false);
});
