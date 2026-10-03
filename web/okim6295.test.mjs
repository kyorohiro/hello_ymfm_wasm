import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Oki6295AudioEngine} from './okim6295audioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {createPlaybackEngine,selectPlaybackConfiguration,applyPlaybackMutes} from '../docs/vgm_analyzer/playback_core.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {readSource,renderSource} from '../cli/index.js';
import {sourcesForChip,applySourceMutes} from '../docs/vgm_analyzer/source_mutes.js';
const u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
const clock=132*8000;
function rom(){const r=new Uint8Array(0x800);r.set([0,4,0,0,7,255]);r.fill(0x17,0x400);return r;}
function file(commands,{oki=clock,fm=0}={}){
 const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);
 b.set([86,103,109,32]);v.setUint32(4,b.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(0x98,oki>>>0,true);v.setUint32(0x30,fm,true);b.set(commands,256);return b;
}
const block=(r=rom(),size=r.length,offset=0)=>[0x67,0x66,0x8b,...u32(r.length+8),...u32(size),...u32(offset),...r];
const commands=()=>[...block(),0xb8,0,0x80,0xb8,0,0x10,0x61,0x44,0xac,0x66];
function engine(){const e=new Oki6295AudioEngine({clock:(clock|0x80000000)>>>0,outputSampleRate:8000});e.loadOki6295Rom(rom());return e;}
const start=e=>{e.writeOki6295(0,0x80);e.writeOki6295(0,0x10);};
test('ADPCM high nibble first, busy voice, stop and all four voices',()=>{
 const e=engine();start(e);
 assert.deepEqual([...e.processFrames(4).left],[6/2048,36/2048,48/2048,104/2048]);
 assert.equal(e.readStatus(),0xf1);
 start(e); // busy voice cannot restart
 assert.equal(e.processFrames(1).left[0],128/2048); // step 15 = 66: +8 +16
 e.writeOki6295(0,0x78);assert.equal(e.readStatus(),0xf0);assert.equal(e.processFrames(1).left[0],0);
 e.reset();e.writeOki6295(0,0x80);e.writeOki6295(0,0xf0);assert.equal(e.readStatus(),0xff);assert.equal(e.processFrames(1).left[0],24/2048);
});
test('ROM boundary inclusive, volume silence and muted voices still advance',()=>{
 const e=engine(),r=rom();r.set([0,4,0,0,4,1]);e.loadOki6295Rom(r);start(e);
 e.processFrames(3);assert.equal(e.readStatus(),0xf1);e.processFrames(1);assert.equal(e.readStatus(),0xf0);assert.equal(e.processFrames(1).left[0],0);
 e.reset();e.setOki6295Muted(true);start(e);assert.ok(e.processFrames(4).left.every(v=>v===0));assert.equal(e.readStatus(),0xf0);
 e.reset();e.setOki6295Muted(false);e.writeOki6295(0,0x80);e.writeOki6295(0,0x19);assert.ok(e.processFrames(4).left.every(v=>v===0));
});
test('bank and NMK sample-table mapping, reset, pin7 and clock changes',()=>{
 const e=engine(),r=new Uint8Array(0x80000);r.set(rom(),0x40000);e.loadOki6295Rom(r);start(e);assert.equal(e.readStatus(),0xf0);
 e.writeOki6295(15,1);start(e);assert.equal(e.processFrames(1).left[0],6/2048);
 e.reset();assert.equal(e.bank,0);e.writeOki6295(14,0x80);e.writeOki6295(16,4);start(e);assert.equal(e.processFrames(1).left[0],6/2048);
 e.reset();e.loadOki6295Rom(rom());e.writeOki6295(12,0);start(e);assert.equal(e.processFrames(1).left[0],0);assert.equal(e.processFrames(1).left[0],6/2048);
 e.reset();u32(clock*2).forEach((v,i)=>e.writeOki6295(i+8,v));start(e);assert.equal(e.processFrames(1).left[0],36/2048);
 assert.throws(()=>e.loadOki6295Rom(new Uint8Array(2),4,5),/range/);
});
test('fractional divider partitioning and reset replay are deterministic',()=>{
 const e=new Oki6295AudioEngine({clock:1000000});e.loadOki6295Rom(rom());
 const run=sizes=>{e.reset();start(e);return sizes.flatMap(n=>[...e.processFrames(n).left]);};
 assert.deepEqual(run([1000]),run([1,2,7,90,300,600]));
});
test('parser rejects truncated/oversized ROM and second chip, delivers exact ROM/write events',()=>{
 const p=new Ym2612VGM(file(commands()));assert.equal(p.header.okim6295Clock,clock);
 assert.equal(p.step().type,'okim6295-rom-data');assert.deepEqual(p.step(),{type:'okim6295-write',register:0,value:128,chipIndex:0});
 assert.throws(()=>new Ym2612VGM(file(block(rom(),8))).step(),/range/);
 assert.throws(()=>new Ym2612VGM(file([0xb8,0])).step());
 assert.throws(()=>new Ym2612VGM(file([0xb8,128,1])).playStep({}),/Second/);
 assert.throws(()=>selectPlaybackConfiguration(new Ym2612VGM(file([0x66],{oki:clock|0x40000000}))),/Dual/);
 assert.equal(selectPlaybackConfiguration(new Ym2612VGM(file([0x66],{oki:clock|0x80000000}))).kind,'okim6295');
 const old=file([0x66]);new DataView(old.buffer).setUint32(8,0x150,true);assert.equal(new Ym2612VGM(old).header.okim6295Clock,0);
});
async function pcm(bytes,mute=false){
 const vgm=new Ym2612VGM(bytes),e=await createPlaybackEngine(vgm,{getFactory:getNodePlaybackFactory});
 try{
  assert.equal(e.supportsState(),false);
  if(mute)applyPlaybackMutes(e,selectPlaybackConfiguration(vgm),['okim6295']);
  const p=new VgmPlayer(e);p.load(bytes);p.play();const l=new Float32Array(1000),r=new Float32Array(1000);p.process(l,r,1000);return [l,r];
 }finally{e.dispose();}
}
test('real YM2151 and OKIM6295 mix equal independent outputs; CLI WAV and mute work',async()=>{
 const fm=await readSource(new URL('../test/fixtures/opm-audible.vgz',import.meta.url));
 const mixed=file([...commands().slice(0,-4),...fm.subarray(256)],{fm:new DataView(fm.buffer,fm.byteOffset).getUint32(0x30,true)});
 // Use mute to obtain the same real OPM output without ADPCM.
 const [oki,mix,muted]=await Promise.all([pcm(file(commands())),pcm(mixed),pcm(mixed,true)]);
 assert(oki[0].some(v=>v!==0));assert(muted[0].some(v=>v!==0));
 for(let ch=0;ch<2;ch++)for(let i=0;i<1000;i++)assert.equal(mix[ch][i],Math.fround(oki[ch][i]+muted[ch][i]));
 const wav=await renderSource(file(commands()),{maxSeconds:.02});assert.deepEqual(wav.warnings,[]);assert(wav.bytes.subarray(44).some(v=>v!==0));
});
test('UI source controls and shipped modules match',()=>{
 assert(sourcesForChip('ym2151',false,true).some(s=>s.key==='oki6295'));
 let muted=false;applySourceMutes({setOki6295Muted:v=>{muted=v;}},'okim6295',{oki6295:true});assert.equal(muted,true);
 for(const f of ['ym2612vgm.js','vgmplayer.js','okim6295audioengine.js'])assert.equal(readFileSync(new URL(f,import.meta.url),'utf8'),readFileSync(new URL('../docs/js/'+f,import.meta.url),'utf8'));
});

test('player reset replays identical PCM; loading another track clears sample ROM',async()=>{
 const bytes=file(commands()),e=await createPlaybackEngine(new Ym2612VGM(bytes));
 try{
  const p=new VgmPlayer(e);p.load(bytes);
  const render=()=>{p.play();const l=new Float32Array(1000),r=new Float32Array(1000);p.process(l,r,1000);return l;};
  const first=render();p.reset();assert.deepEqual(render(),first);
  p.stop();p.load(file([0xb8,0,128,0xb8,0,16,0x61,255,255,0x66]));assert(render().every(v=>v===0));
 }finally{e.dispose();}
});

test('YM3812 3.58 MHz + OKIM6295 1.32 MHz: independent mix, mutes and replay',async()=>{
 const fm=await readSource(new URL('../test/fixtures/ym3812-tone.vgz',import.meta.url));
 const dataOffset=new DataView(fm.buffer,fm.byteOffset).getUint32(0x34,true)+0x34;
 const mixed=file([...commands().slice(0,-4),...fm.subarray(dataOffset)],{oki:1320000});
 new DataView(mixed.buffer).setUint32(0x50,3580000,true);
 const okiOnly=file(commands(),{oki:1320000});
 const fmOnly=file([...fm.subarray(dataOffset)],{oki:0});
 new DataView(fmOnly.buffer).setUint32(0x50,3580000,true);
 async function render(bytes,mutes=[],sizes=[1000],replay=false){
  const vgm=new Ym2612VGM(bytes),config=selectPlaybackConfiguration(vgm);
  const e=await createPlaybackEngine(vgm,{getFactory:getNodePlaybackFactory});
  try{
   applyPlaybackMutes(e,config,mutes);
   const p=new VgmPlayer(e);p.load(bytes);
   const pass=()=>{p.play();return sizes.flatMap(n=>{const l=new Float32Array(n),r=new Float32Array(n);p.process(l,r,n);assert.deepEqual(l,r);return [...l];});};
   const output=pass();if(replay){p.reset();assert.deepEqual(pass(),output);}return output;
  }finally{e.dispose();}
 }
 const config=selectPlaybackConfiguration(new Ym2612VGM(mixed));
 assert.equal(config.kind,'ym3812');
 assert.deepEqual(config.chips.map(c=>c.id).sort(),['okim6295','ym3812']);
 const [oki,opl,mix]=await Promise.all([render(okiOnly),render(fmOnly),render(mixed,[],[1000],true)]);
 assert(oki.some(v=>v!==0));assert(opl.some(v=>v!==0));
 assert.deepEqual(mix,oki.map((v,i)=>Math.fround(v+opl[i])));
 assert.deepEqual(await render(mixed,['okim6295']),opl);
 assert.deepEqual(await render(mixed,Array.from({length:9},(_,i)=>`ym3812-ch-${i+1}`)),oki);
 assert.deepEqual(await render(mixed,[],[1,2,7,90,300,600]),mix);
 assert(sourcesForChip('ym3812',false,true).some(s=>s.key==='oki6295'));
 const wav=await renderSource(mixed,{maxSeconds:.02});assert.deepEqual(wav.warnings,[]);assert(wav.bytes.subarray(44).some(v=>v!==0));
 const dual=mixed.slice();new DataView(dual.buffer).setUint32(0x98,1320000|0x40000000,true);
 assert.throws(()=>selectPlaybackConfiguration(new Ym2612VGM(dual)),/Dual/);
});
