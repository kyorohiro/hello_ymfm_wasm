import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Ym2203AudioEngine} from './ym2203audioengine.js';
import {Ym2608AudioEngine} from './ym2608audioengine.js';
import {Ym2610BAudioEngine} from './ym2610baudioengine.js';
import {VgmPlayer} from './vgmplayer.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import ym2203 from '../docs/generated/ym2203_wasm.js';
import ym2608 from '../docs/generated/ym2608_wasm.js';
import ym2610b from '../docs/generated/ym2610b_wasm.js';
const rom=Uint8Array.from({length:8192},(_,i)=>i%2?0x99:0x11); // Authored synthetic rhythm pattern.
async function make(kind,rate=48000){
 const name=kind==='ym2610'?'ym2610b':kind;
 const moduleOptions={wasmBinary:readFileSync(new URL(`../docs/generated/${name}_wasm.wasm`,import.meta.url))};
 if(kind==='ym2203')return Ym2203AudioEngine.create({ym2203ModuleFactory:ym2203,ym2203ModuleOptions:moduleOptions,outputSampleRate:rate});
 if(kind==='ym2608') {const e=await Ym2608AudioEngine.create({ym2608ModuleFactory:ym2608,ym2608ModuleOptions:moduleOptions,outputSampleRate:rate});e.loadAdpcmARom(rom);return e;}
 return Ym2610BAudioEngine.create({moduleFactory:ym2610b,moduleOptions,variant:kind==='ym2610b',outputSampleRate:rate});
}
const chip=e=>e.ym2203??e.ym2608??e.chip;
const fixture=(kind,voice)=>readFileSync(new URL(`../test/fixtures/${kind}-${voice}.vgm`,import.meta.url));
const render=(p,n)=>{const left=new Float32Array(n),right=new Float32Array(n);p.process(left,right,n);return {left,right};};
function player(e,bytes){const p=new VgmPlayer(e);p.load(bytes);p.setPrefetchFactor(1);p.play();return p;}
function prepare(e, bytes) {
 const parser=new Ym2612VGM(bytes);
 const targets={
  ym2203:{writeRegister:(r,v)=>e.writeYm2203(r,v)},
  ym2608:{writeRegister:(r,v,p)=>e.writeYm2608(p,r,v),loadAdpcmBMemory:(...a)=>e.loadAdpcmBMemory(...a)},
  ym2610:{writeRegister:(r,v,p)=>e.writeYm2610B(p,r,v),loadAdpcmRom:(...a)=>e.loadAdpcmRom(...a)},
 };
 while(true){const event=parser.playStep(targets);if(event.type==='wait')return parser;if(event.type==='end')throw new Error('No wait');}
}
function shortWaitSong(bytes) {
 const parser=new Ym2612VGM(bytes);let offset;
 while(true){offset=parser.position;const event=parser.step();if(event.type==='wait')break;if(event.type==='end')throw new Error('No wait');}
 const commands=[];for(let i=0;i<50;i++)commands.push(0x61,0xb9,1);commands.push(0x66);
 const out=new Uint8Array(offset+commands.length);out.set(bytes.subarray(0,offset));out.set(commands,offset);return out;
}
const voices={ym2203:['fm','ssg','mix'],ym2608:['fm','ssg','rhythm','adpcm'],ym2610:['fm','ssg','adpcm-a','adpcm-b','mix'],ym2610b:['fm','ssg','adpcm-a','adpcm-b','mix','extra-fm','extra-fm4']};
for(const kind of Object.keys(voices))test(`${kind}: snapshots preserve audible sources and resampling; saving does not change output`,async()=>{
 for(const voice of voices[kind]){
  const e=await make(kind),ref=await make(kind);try{
   const bytes=fixture(kind,voice);prepare(e,bytes);prepare(ref,bytes);
   e.processFrames(11);ref.processFrames(11);
   const saved=e.saveState(),expected=ref.processFrames(2711);
   assert(expected.left.some(v=>v!==0),`${kind} ${voice} must be audible`);
   assert.deepEqual(e.processFrames(2711),expected,`${voice}: save must not alter sound`);
   e.reset();e.processFrames(43);
   if(kind==='ym2608') {e.loadAdpcmBMemory(new Uint8Array(1234).fill(0x77));chip(e).loadAdpcmARom(new Uint8Array(8192));}
   if(kind.startsWith('ym2610'))e.loadAdpcmRom(0,new Uint8Array(77).fill(0x22),0,1024);
   e.loadState(saved);assert.deepEqual(e.processFrames(2711),expected,`${voice}: reset/memory mutation then restore`);
   e.loadState(saved);assert.deepEqual(e.processFrames(2711),expected,`${voice}: reusable immutable state`);

  }finally{e.dispose();ref.dispose();}
 }
});
for(const kind of ['ym2203','ym2608'])test(`${kind}: native restore rebuilds prescaler, timers, SSG noise/envelope and port latch`,async()=>{
 const e=await make(kind);try{
  const c=chip(e),write=(r,v)=>{c.write(0,r);c.write(1,v);};
  for(const [r,v] of [[0,19],[1,0],[6,9],[7,0x30],[8,16],[9,11],[11,23],[12,0],[13,10],[0x24,0xff],[0x25,3],[0x27,5]])write(r,v);
  for(const prescale of [0x2f,0x2d,0x2e]){
   write(prescale,0);c.generateStereo(131);c.write(0,8);const saved=c.saveState();
   c.write(1,15);const expected=c.generateStereo(711),status=c.readStatus();
   c.reset();write(0x2d,0);c.generateStereo(37);c.loadState(saved);c.write(1,15);
   assert.deepEqual(c.generateStereo(711),expected);assert.equal(c.readStatus(),status);
  }
 }finally{e.dispose();}
});
for(const kind of ['ym2203','ym2608','ym2610','ym2610b'])test(`${kind}: engine restores held samples during upsampling and validates settings`,async()=>{
 const e=await make(kind,1500000);try{
  const c=chip(e);for(const [r,v] of [[0,19],[7,0x3e],[8,15]]){c.write(0,r);c.write(1,v);}
  e.processFrames(137);const s=e.saveState(),expected=e.processFrames(311);
  e.reset();e.loadState(s);assert.deepEqual(e.processFrames(311),expected);
  e.setSsgMuted(true);assert.throws(()=>e.loadState(s),/Incompatible/);e.setSsgMuted(false);
  e.setMasterVolume(.5);assert.throws(()=>e.loadState(s),/Incompatible/);e.setMasterVolume(1);
  const other=await make(kind);try{assert.throws(()=>other.loadState(s),/Incompatible/);assert.throws(()=>chip(other).loadState(c.saveState()),/foreign/);}finally{other.dispose();}
  e.writeOki6258=()=>{};assert.equal(e.supportsState(),false);
 }finally{e.dispose();}
});
for(const kind of ['ym2203','ym2608','ym2610','ym2610b'])test(`${kind}: cached seek matches baseline while processing only the remainder`,async()=>{
 const e=await make(kind),ref=await make(kind);try{
  const bytes=shortWaitSong(fixture(kind,kind==='ym2608'?'ssg':'mix')),p=player(e,bytes),q=player(ref,bytes);
  p.checkpointIntervalSeconds=.05;
  for(let i=0;i<20;i++)render(p,600);
  assert(p.checkpointStats().count>0);
  let work=0;const process=e.processFrames.bind(e);e.processFrames=n=>{work+=n;return process(n);};
  await seekPlayback(p,.175*44100);const cachedWork=work;await seekPlayback(q,.175*44100);
  p.play();q.play();assert.deepEqual(render(p,999),render(q,999));
  // A fixture can encode a long wait; pending audio is retained in the checkpoint.
  assert(cachedWork<e.sampleRate()*.1,`replayed ${cachedWork} frames`);
  assert(p.checkpointStats().bytes<=p.checkpointMaxBytes);
 }finally{e.dispose();ref.dispose();}
});
test('YM2608 external rhythm replacement invalidates old engine/checkpoint states',async()=>{
 const e=await make('ym2608');try{
  const p=player(e,fixture('ym2608','rhythm'));p.checkpointIntervalSeconds=.001;render(p,120);
  assert(p.checkpointStats().count);const saved=p.saveState();
  e.loadAdpcmARom(new Uint8Array(8192).fill(0x44));
  assert.throws(()=>p.loadState(saved),/Incompatible/);assert.equal(p.restoreCheckpoint(1000),0);assert.equal(p.checkpointStats().count,0);
 }finally{e.dispose();}
});

test('native OPN loaders reject truncated/oversized memory states without changing audio',async()=>{
 for(const kind of ['ym2203','ym2608','ym2610b']){
  const e=await make(kind);try{
   prepare(e,fixture(kind,kind==='ym2608'?'adpcm':'mix'));e.processFrames(11);
   const c=chip(e),m=c.module,save=m[`_${kind}_save_state`],load=m[`_${kind}_load_state`];
   const size=save(c.handle,0),ptr=m._malloc(size),s=e.saveState();
   try{
    save(c.handle,ptr);const expected=e.processFrames(300);e.loadState(s);
    assert.equal(load(c.handle,ptr,size-1),0);
    assert.deepEqual(e.processFrames(300),expected);
    if(kind!=='ym2203'){
     e.loadState(s);save(c.handle,ptr);
     // Fixed known authored memories: OPNA has 8 KiB + 2 MiB; OPNB fixture has two 256-byte ROMs.
     const prefix=size-(kind==='ym2608'?8192+0x200000:512)-8;
     new DataView(m.HEAPF32.buffer).setUint32(ptr+prefix,0xffffffff,true);
     assert.equal(load(c.handle,ptr,size),0);assert.deepEqual(e.processFrames(300),expected);
    }
   }finally{m._free(ptr);}
  }finally{e.dispose();}
 }
});

test('YM2610 variants recover variable ROM sizes and repeated mid-song blocks on backwards seek',async()=>{
 for(const kind of ['ym2610','ym2610b']){
  const e=await make(kind),ref=await make(kind);try{
   const initial=shortWaitSong(fixture(kind,'mix'));
   // After 0.5s, replace a region in a larger ADPCM-A ROM. Seeking backwards must restore its earlier contents and length.
   const tail=[0x67,0x66,0x82,12,0,0,0,0,4,0,0,0,0,0,0,0x77,0x77,0x77,0x77];
   for(let i=0;i<25;i++)tail.push(0x61,0xb9,1);tail.push(0x66);
   const bytes=new Uint8Array(initial.length-1+tail.length);bytes.set(initial.subarray(0,-1));bytes.set(tail,initial.length-1);
   const p=player(e,bytes),q=player(ref,bytes);p.checkpointIntervalSeconds=.05;
   for(let i=0;i<52;i++)render(p,600);
   await seekPlayback(p,.425*44100);await seekPlayback(q,.425*44100);p.play();q.play();
   assert.deepEqual(render(p,12000),render(q,12000));
  }finally{e.dispose();ref.dispose();}
 }
});

test('Analyzer enables OPN checkpoints, retains same-song cache and restores FM/SSG monitors',async()=>{
 const {default:vm}=await import('node:vm');
 const source=readFileSync(new URL('../docs/vgm_analyzer/vgm_analyzer.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function ensurePlaybackReady('),source.indexOf('\nfunction isPlaybackReady('));
 for(const kind of ['ym2203','ym2608','ym2610','ym2610b']){
  const e=await make(kind);try{
   const selected=kind==='ym2610b'?'ym2610':kind,bytes=shortWaitSong(fixture(kind,'ssg'));
   const c=vm.createContext({engine:e,engineClockKey:'',currentChipKind:selected,player:null,VgmPlayer,
    vgm:new Ym2612VGM(bytes),currentBuffer:bytes,structuredClone,selectPlaybackConfiguration:()=>({kind:selected}),CHANNEL_MUTE_CHIPS:[],
    channelMonitor:[{muted:false,fnum:123}],monitorFrequencyHigh:[1,2],psgMonitor:{latchedRegister:6},pcmMonitor:{ramBank:3},lastYm2612DacEnable:0,
    requestChannelMonitorRender(){},applySourceMutes(){},sourceChipKind:()=>selected,effectiveSourceMutes:()=>({}),hasOkiSource:()=>false,
    applyMasterVolume(){},prefetchFactorSelect:{value:'2'},loopCheckbox:{checked:false},
    audioContext:{sampleRate:e.sampleRate(),state:'running'},reportPlaybackWarning(){},noteishHeader:{}});
   const key=body.match(/const nextClockKey = ([\s\S]*?);/)[1].replace('nextChipKind',JSON.stringify(selected));
   vm.runInContext(`engineClockKey = ${key};\n${body}`,c);
   await c.ensurePlaybackReady(c.vgm);assert.equal(c.player.checkpointIntervalSeconds,5);
   c.player.checkpointIntervalSeconds=.05;const parser=c.player.parser;c.player.play();for(let i=0;i<20;i++)render(c.player,600);
   assert(c.player.checkpointStats().count>0);await c.ensurePlaybackReady(c.vgm);assert.equal(c.player.parser,parser);
   c.channelMonitor[0].fnum=999;await seekPlayback(c.player,.175*44100);assert.equal(c.channelMonitor[0].fnum,123);assert.equal(c.psgMonitor.latchedRegister,6);
   c.currentBuffer=bytes.slice();await c.ensurePlaybackReady(c.vgm);assert.equal(c.player.checkpointStats().count,0);
  }finally{e.dispose();}
 }
});

test('OPN wrappers gracefully report missing state exports in old WASM',async()=>{
 const classes=[(await import('./ym2203.js')).Ym2203,(await import('./ym2608.js')).Ym2608,(await import('./ym2610b.js')).Ym2610B];
 for(const Chip of classes){const c=new Chip({},1,{});assert.equal(c.supportsState(),false);assert.throws(()=>c.saveState(),/unavailable/);}
});
