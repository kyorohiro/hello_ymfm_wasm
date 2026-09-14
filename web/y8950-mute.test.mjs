import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import factory from '../docs/generated/y8950_wasm.js';
import {Y8950AudioEngine} from './y8950audioengine.js';
const options={y8950ModuleFactory:factory,y8950ModuleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/y8950_wasm.wasm',import.meta.url))}};
function voice(e,ch){
 const base=[0,1,2,8,9,10,16,17,18][ch];
 for(const slot of [base,base+3])for(const [r,v] of [[0x20,0x21],[0x40,16],[0x60,0xf0],[0x80,0x0f]])e.writeY8950(r+slot,v);
 for(const [r,v] of [[0xc0+ch,0x0e],[0xa0+ch,0x98],[0xb0+ch,0x31]])e.writeY8950(r,v);
}
function adpcm(e){
 e.loadSampleMemory(new Uint8Array(256).fill(0x17),0,256);
 for(const [r,v] of [[8,1],[9,0],[10,0],[11,7],[12,0],[16,255],[17,255],[18,255],[7,0xb0]])e.writeY8950(r,v);
}
for(const mode of ['fm','rhythm','adpcm'])test(`Y8950 ${mode} output mute preserves state and live writes`,async()=>{
 for(const ch of mode==='fm'?[0,1,2,3,4,5,6,7,8]:mode==='rhythm'?[6,7,8]:[9]){
  const a=await Y8950AudioEngine.create(options),b=await Y8950AudioEngine.create(options);
  const mute=(e,v)=>ch===9?e.setAdpcmMuted(v):e.setChannelMuted(ch,v);
  try{
   for(const e of [a,b]){if(ch===9)adpcm(e);else{voice(e,ch);if(mode==='rhythm')e.writeY8950(0xbd,0x20|[0x10,0x09,0x06][ch-6]);}}
   assert.deepEqual(a.processFrames(1024),b.processFrames(1024));mute(b,true);
   assert(a.processFrames(1024).left.some(v=>v!==0));assert(b.processFrames(1024).left.every(v=>v===0));
   for(const e of [a,b]){e.writeY8950(ch===9?16:0xa0+ch,0x85);e.processFrames(333);}
   mute(b,false);assert.deepEqual(a.processFrames(1024),b.processFrames(1024));
   mute(b,true);b.reset();if(ch===9)adpcm(b);else voice(b,ch);
   assert(b.processFrames(1024).left.every(v=>v===0));
  }finally{a.dispose();b.dispose();}
 }
});
test('Y8950 FM and ADPCM stay independent; full mute restores source masks',async()=>{
 const a=await Y8950AudioEngine.create(options),b=await Y8950AudioEngine.create(options);
 try{
  voice(a,0);voice(b,0);adpcm(b);b.setAdpcmMuted(true);
  assert.deepEqual(a.processFrames(2048),b.processFrames(2048));
  b.setY8950Muted(true);a.processFrames(512);assert(b.processFrames(512).left.every(v=>v===0));
  b.setY8950Muted(false);assert.deepEqual(a.processFrames(1024),b.processFrames(1024));
  a.reset();b.reset();adpcm(a);adpcm(b);voice(b,0);b.setAdpcmMuted(false);b.setChannelMuted(0,true);
  assert.deepEqual(a.processFrames(2048),b.processFrames(2048));
  assert.throws(()=>b.setChannelMuted(9,true),RangeError);
 }finally{a.dispose();b.dispose();}
});

test('MSX UI mute routing with real AY, OPLL and Y8950 engines',async()=>{
 const {MsxAudioEngine}=await import('./msxaudioengine.js');
 const {default:ayFactory}=await import('../docs/generated/ay8910_wasm.js');
 const {default:opllFactory}=await import('../docs/generated/ym2413_wasm.js');
 const {msxMuteControls,applyMsxMute}=await import('../docs/vgm_analyzer/msx_mutes.js');
 const config={...options,ayClock:1789773,ayModuleFactory:ayFactory,ym2413ModuleFactory:opllFactory};
 const a=await MsxAudioEngine.create(config),b=await MsxAudioEngine.create(config);
 try{
  for(const e of [a,b]){
   for(const [r,v] of [[0,64],[7,62],[8,15]])e.writeAy8910(r,v);
   for(const [r,v] of [[0x30,0x40],[0x10,0x80],[0x20,0x17]])e.writeYm2413(r,v);
   voice(e.entries.get('y8950:0').engine,0);adpcm(e.entries.get('y8950:0').engine);
  }
  assert.deepEqual(a.processFrames(1024),b.processFrames(1024));
  const controls=msxMuteControls('msx',{ay8910Clock:1,ym2413Clock:1,y8950Clock:1});
  for(const control of controls){
   applyMsxMute(b,'msx',control,true);
   // Apply the same setting directly to the reference engine, independently of UI routing.
   const target=a.entries.get(`${control.chip}:0`).engine;
   if(control.method==='setChipMuted')a.setOpllMuted(true);
   else if(control.channel===undefined)target[control.method](true);
   else target[control.method](control.channel,true);
   assert.deepEqual(a.processFrames(128),b.processFrames(128));
  }
  assert(b.processFrames(128).left.every(v=>v===0));a.processFrames(128);
  for(const control of controls)applyMsxMute(b,'msx',control,false);
  a.setOpllMuted(false);
  for(const {engine:e} of a.entries.values()){
   if(e.setAyMuted){e.setAyMuted(false);for(let ch=0;ch<3;ch++)e.setAyChannelMuted(ch,false);}
   else{for(let ch=0;ch<9;ch++)e.setChannelMuted(ch,false);e.setY8950Muted?.(false);e.setAdpcmMuted?.(false);}
  }
  assert.deepEqual(a.processFrames(1024),b.processFrames(1024));
 }finally{a.dispose();b.dispose();}
});
