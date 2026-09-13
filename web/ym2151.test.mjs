import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ym2151AudioEngine} from './ym2151audioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import factory from '../docs/generated/ym2151_wasm.js';
const options={ym2151ModuleFactory:factory,ym2151ModuleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/ym2151_wasm.wasm',import.meta.url))}};
function writes(channel=0,pan=0xc0){
  const list=[[0x20+channel,pan|7],[0x28+channel,0x4a],[0x30+channel,0]];
  for(const slot of [0,8,16,24])for(const [base,value] of [[0x40,1],[0x60,0x20],[0x80,31],[0xa0,0],[0xc0,0],[0xe0,15]])list.push([base+slot+channel,value]);
  list.push([8,0x78|channel]);return list;
}
function vgm(pan=0xc0){const commands=[...writes(0,pan).flatMap(([r,v])=>[0x54,r,v]),0x61,0x3a,0x11,0x66];
 const b=new Uint8Array(0x40+commands.length);b.set([86,103,109,32]);const v=new DataView(b.buffer);v.setUint32(4,b.length-4,true);v.setUint32(8,0x150,true);v.setUint32(0x30,3579545,true);v.setUint32(0x18,4410,true);b.set(commands,0x40);return b;}
for(const Parser of [Ym2612VGM,DocsVGM])test(`YM2151 import scans and dispatch (${Parser===DocsVGM?'docs':'web'})`,()=>{
 const p=new Parser(vgm());assert.equal(p.header.ym2151Clock,3579545);assert.equal(p.analyzeCommandUsage().get('0x54'),writes().length);
 assert.deepEqual(p.dataBlockSummary(),[]);assert.deepEqual(p.pcmRamWriteSummary(),[]);assert.doesNotThrow(()=>p.analyzeSpecialCommands());assert.doesNotThrow(()=>p.analyzeCommandContext(0x92));
 assert.match(p.analyzeCommandContext(0x54).join('\n'),/ym2151 register/);
 const events=[];for(let i=0;i<writes().length;i++)p.playStep({ym2151:{writeRegister:(...a)=>events.push(a)}});assert.deepEqual(events,writes());
 assert.deepEqual(p.step(),{type:'wait',samples:4410});
 const short=vgm().slice(0,0x42);assert.throws(()=>new Parser(short).step());
});
test('YM2151 stereo routing on all eight channels',async()=>{
 const e=await Ym2151AudioEngine.create(options);
 try{for(let channel=0;channel<8;channel++)for(const pan of [0x40,0x80,0xc0]){
  e.reset();for(const [r,v] of writes(channel,pan))e.writeYm2151(r,v);
  const pcm=e.processFrames(1500);
  assert.equal(pcm.left.some(x=>Math.abs(x)>0.001),Boolean(pan&0x40));
  assert.equal(pcm.right.some(x=>Math.abs(x)>0.001),Boolean(pan&0x80));
  assert(pcm.left.every(Number.isFinite));
 }}finally{e.dispose();}
});
test('YM2151 VGM replay, seek and generation partitions agree',async()=>{
 const e=await Ym2151AudioEngine.create(options);
 try{
  const p=new VgmPlayer(e);p.load(vgm());p.play();const full=new Float32Array(4410);p.process(full,new Float32Array(4410),4410);
  p.reset();p.play();const again=new Float32Array(4410);p.process(again,new Float32Array(4410),4410);assert.deepEqual(again,full);
  await seekPlayback(p,1000);p.resume();const part=new Float32Array(500);p.process(part,new Float32Array(500),500);assert.deepEqual(part,full.slice(1000,1500));
  p.reset();p.play();const chunks=[512,2048,1850].flatMap(n=>{const a=new Float32Array(n);p.process(a,new Float32Array(n),n);return [...a];});assert.deepEqual(Float32Array.from(chunks),full);
 }finally{e.dispose();}
});
test('YM2151 timers advance and reset clears IRQ state',async()=>{
 const e=await Ym2151AudioEngine.create(options);
 try{e.writeYm2151(0x10,255);e.writeYm2151(0x11,3);e.writeYm2151(0x14,5);e.processFrames(100);
 assert(e.ym2151.readStatus()&1);assert.equal(e.ym2151.getIrq(),true);e.reset();assert.equal(e.ym2151.getIrq(),false);
 }finally{e.dispose();}
});
