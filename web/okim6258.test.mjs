import test from 'node:test';
import assert from 'node:assert/strict';
import factory from '../docs/generated/okim6258_wasm.js';
import {Oki6258AudioEngine,attachOki6258,validateOki6258Header} from './okim6258audioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsParser} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {VgmPlayer as DocsPlayer} from '../docs/js/vgmplayer.js';
import {MockSoundEngine,drainPlayer} from './test-support/vgm-engine-mock.js';
const u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
const wait=n=>[0x61,n&255,n>>>8];
function vgm(commands){const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(0x90,8192000,true);b[0x94]=4;b.set(commands,256);return b;}
const stream=[0x67,0x66,4,...u32(3),0x12,0x34,0x56,0x90,0,0x17,0,1,0x91,0,4,1,0,0x92,0,...u32(22050),0x95,0,0,0,0];
for(const [name,Parser,Player] of [['web',Ym2612VGM,VgmPlayer],['docs',DocsParser,DocsPlayer]]){
 test(`${name}: direct and stream writes reach OKI with exact times; no FM misdelivery`,()=>{
  const bytes=vgm([0xb7,0,2,...stream,...wait(6),0xb7,0,1,0x66]);
  const parser=new Parser(bytes);assert.equal(parser.header.okim6258Clock,8192000);assert.equal(parser.header.okim6258Flags,4);
  for(const split of [1,7,128]){const engine=new MockSoundEngine();const log=[];engine.writeOki6258=(r,v)=>log.push([engine.frames,r,v]);const p=new Player(engine);p.load(bytes);p.play();drainPlayer(p,split);assert.deepEqual(log,[[0,0,2],[0,1,0x12],[2,1,0x34],[4,1,0x56],[6,0,1]]);assert.equal(engine.trace.length,0);}
 });
 test(`${name}: unsupported second chip and missing target warn without misdelivery`,()=>{
  const warnings=[],p=new Parser(vgm([0xb7,0x81,0xff,0xb7,1,0x33,0x66]),{logger:{warn:s=>warnings.push(s)}});while(p.playStep({}).type!=='end'){}assert.equal(warnings.length,2);
  const b=vgm([0xb7,1]);assert.throws(()=>new Parser(b).step());
 });
}
test('MAME decoder gives explicit low/high nibble vector, stop, pan and deterministic reset',async()=>{
 const e=await Oki6258AudioEngine.create({moduleFactory:factory,clock:8192000,flags:12,outputSampleRate:8000});
 // A single written byte holds two nibbles; once both are clocked out the
 // decoder holds its last output (underrun) rather than re-decoding stale
 // data, so frames 3-4 repeat frame 2's value instead of drifting further.
 try{for(let run=0;run<2;run++){e.reset();e.writeOki6258(0,2);e.writeOki6258(1,0x10);const pcm=e.processFrames(4);assert.deepEqual([...pcm.left],[0,6/2048,6/2048,6/2048]);assert.deepEqual(pcm.left,pcm.right);}
 e.writeOki6258(2,1);assert.ok(e.processFrames(1).right.every(v=>v===0));e.writeOki6258(2,2);assert.ok(e.processFrames(1).left.every(v=>v===0));e.writeOki6258(0,1);assert.ok(e.processFrames(4).left.every(v=>v===0));
 }finally{e.dispose();}
});
test('partitioning and clock/divider updates keep decoder time consistent',async()=>{
 const e=await Oki6258AudioEngine.create({moduleFactory:factory,clock:4000000,flags:4});
 try{const run=sizes=>{e.reset();e.writeOki6258(0,2);e.writeOki6258(1,0x71);let out=[];for(const n of sizes)out.push(...e.processFrames(n).left);return out;};assert.deepEqual(run([1000]),run([1,2,7,90,300,600]));
 e.reset();e.writeOki6258(0,2);e.writeOki6258(1,0x10);[0,0,0,0].forEach((v,i)=>e.writeOki6258(8+i,v));assert.ok(e.processFrames(10).left.every(v=>v===0));
 }finally{e.dispose();}
 assert.throws(()=>validateOki6258Header({okim6258Clock:4000000,okim6258Flags:0}),/3-bit/);
 assert.throws(()=>validateOki6258Header({okim6258Clock:0x40000001,okim6258Flags:4}),/Dual/);
});
test('setOkiMuted gates chip output to silence without resetting decoder state',async()=>{
 const e=await Oki6258AudioEngine.create({moduleFactory:factory,clock:8192000,flags:12,outputSampleRate:8000});
 try{
  e.writeOki6258(0,2);e.writeOki6258(1,0x77);
  assert.ok(e.processFrames(4).left.some(v=>v!==0));
  e.setOkiMuted(true);
  assert.ok(e.processFrames(4).left.every(v=>v===0));
  assert.ok(e.processFrames(4).right.every(v=>v===0));
  e.setOkiMuted(false);
  assert.ok(e.processFrames(4).left.some(v=>v!==0));
 }finally{e.dispose();}
});
test('attachOki6258 exposes setOkiMuted on the base engine to mute the mixed-in chip',()=>{
 const base={sampleRate:()=>44100,getMasterVolume:()=>1,processFrames:n=>({left:new Float32Array(n),right:new Float32Array(n)}),reset(){},dispose(){}};
 let muted=false;
 const oki={muted:false,processFrames(n){return {left:new Float32Array(n).fill(muted?0:0.5),right:new Float32Array(n).fill(muted?0:0.5)};},setOkiMuted(v){muted=Boolean(v);},writeOki6258(){},reset(){},dispose(){}};
 attachOki6258(base,oki);
 assert.ok(base.processFrames(2).left.every(v=>v===0.5));
 base.setOkiMuted(true);
 assert.ok(base.processFrames(2).left.every(v=>v===0));
});
test('mixing preserves primary engine, volume, writes, reset and disposal',()=>{
 let reset=0,disposed=0;const writes=[];
 const base={sampleRate:()=>44100,getMasterVolume:()=>0.5,processFrames:n=>({left:new Float32Array(n).fill(0.2),right:new Float32Array(n).fill(0.3)}),reset(){reset++;},dispose(){disposed++;}};
 const oki={processFrames:n=>({left:new Float32Array(n).fill(0.4),right:new Float32Array(n).fill(0.2)}),writeOki6258:(...args)=>writes.push(args),reset(){reset++;},dispose(){disposed++;}};
 assert.equal(attachOki6258(base,oki),base);base.writeOki6258(1,5);assert.deepEqual(writes,[[1,5]]);const p=base.processFrames(1);assert.ok(Math.abs(p.left[0]-0.4)<1e-6);assert.ok(Math.abs(p.right[0]-0.4)<1e-6);base.reset();base.dispose();assert.equal(reset,2);assert.equal(disposed,2);
});
test('divider, clock and output precision affect generated PCM',async()=>{
 const make=flags=>Oki6258AudioEngine.create({moduleFactory:factory,clock:8192000,flags,outputSampleRate:8000});
 const a=await make(12),b=await make(4);
 try{
  a.writeOki6258(0,2);a.writeOki6258(1,0x10);a.writeOki6258(12,2);assert.equal(a.processFrames(1).left[0],6/2048);
  a.reset();a.writeOki6258(0,2);a.writeOki6258(1,0x10);u32(16384000).forEach((v,i)=>a.writeOki6258(8+i,v));assert.equal(a.processFrames(1).left[0],6/2048);
  // Feed a fresh 0x77 byte every 2 ticks (its two nibbles) so the step size
  // keeps climbing toward the clamp, matching how a real byte stream behaves
  // instead of relying on stale-data replay during underrun.
  let aLast,bLast;
  for(const [e,setLast] of [[a,v=>aLast=v],[b,v=>bLast=v]]){e.reset();e.writeOki6258(0,2);for(let i=0;i<60;i++){e.writeOki6258(1,0x77);setLast(e.processFrames(2).left.at(-1));}}
  assert.equal(aLast,2047/2048);assert.equal(bLast,511/2048);
 }finally{a.dispose();b.dispose();}
});
test('real YM2151 plus OKIM6258 Player output repeats after reset and buffer splitting',async()=>{
 const {createYm2151AudioEngine}=await import('./ym2151audioengine.js');const {default:fmFactory}=await import('../docs/generated/ym2151_wasm.js');
 const base=await createYm2151AudioEngine({ym2151ModuleFactory:fmFactory});
 const oki=await Oki6258AudioEngine.create({moduleFactory:factory,clock:8192000,flags:12});attachOki6258(base,oki);
 const fm=[0x54,0x20,0xc7,0x54,0x28,0x4a];for(let i=0;i<4;i++)fm.push(0x54,0x40+8*i,1,0x54,0x60+8*i,32,0x54,0x80+8*i,31);
 const bytes=vgm([...fm,0x54,8,0x78,0xb7,0,2,0xb7,1,0x17,...wait(441),0xb7,0,1,0x54,8,0,...wait(441),0x66]);new DataView(bytes.buffer).setUint32(0x30,3579545,true);
 try{const run=split=>{const p=new VgmPlayer(base);p.load(bytes);p.reset();p.play();const out=[];for(let n=0;n<882;n+=split){const count=Math.min(split,882-n),l=new Float32Array(count);p.process(l,new Float32Array(count),count);out.push(...l);}return out;};const whole=run(882);assert.ok(whole.some(v=>Math.abs(v)>0.001));assert.ok(whole.every(Number.isFinite));assert.deepEqual(run(7),whole);}finally{base.dispose();}
});
