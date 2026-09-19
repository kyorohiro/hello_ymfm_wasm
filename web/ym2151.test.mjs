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

test('YM2151 channel mute silences only selected output and preserves feedback/phase',async()=>{
 const a=await Ym2151AudioEngine.create(options),b=await Ym2151AudioEngine.create(options);
 try{
  for(let ch=0;ch<8;ch++){
   a.ym2151.setMuteMask(0);b.ym2151.setMuteMask(0);a.reset();b.reset();
   for(const e of [a,b]){
    for(const [r,v] of writes(ch,0x40))e.writeYm2151(r,v);
    e.writeYm2151(0x20+ch,0x40|0x38); // algorithm 0, strong feedback
    for(const [r,v] of writes((ch+1)%8,0x80))e.writeYm2151(r,v);
   }
   assert.deepEqual(a.processFrames(500),b.processFrames(500));
   b.setChannelMuted(ch,true);
   const normal=a.processFrames(1000),muted=b.processFrames(1000);
   assert(normal.left.some(x=>x!==0));assert(muted.left.every(x=>x===0));
   assert.deepEqual(muted.right,normal.right);
   // Writes during mute still affect the channel's next audible output.
   for(const e of [a,b])e.writeYm2151(0x28+ch,0x4c);
   a.processFrames(700);b.processFrames(700);
   b.setChannelMuted(ch,false);assert.deepEqual(b.processFrames(500),a.processFrames(500));
  }
  b.setChannelMuted(3,true);b.reset();assert.equal(b.ym2151.muteMask,8);
  assert.throws(()=>b.setChannelMuted(8,true),RangeError);
 }finally{a.dispose();b.dispose();}
});

test('YM2151 + Sega PCM mix matches independent chips and mutes/resets/seeks correctly',async()=>{
 const {default:segapcmFactory}=await import('../docs/generated/segapcm_wasm.js');
 const {SegaPcmAudioEngine}=await import('./segapcmaudioengine.js');
 const segaPcmModuleOptions={wasmBinary:readFileSync(new URL('../docs/generated/segapcm_wasm.wasm',import.meta.url))};
 const rom=new Uint8Array(256);for(let i=0;i<256;i++)rom[i]=i;
 const programPcm=e=>{
  e.loadSampleMemory(rom,0,rom.length);
  for(const [o,v] of [[0x02,0x7f],[0x03,0x7f],[0x04,0],[0x05,0],[0x06,0],[0x07,8],[0x84,0],[0x85,0],[0x86,0]])e.writeSegaPcm(o,v);
 };
 const opmOnly=await Ym2151AudioEngine.create(options);
 const mix=await Ym2151AudioEngine.create({...options,segaPcmModuleFactory:segapcmFactory,segaPcmModuleOptions,segaPcmClock:4000000});
 const pcmOnly=await SegaPcmAudioEngine.create({moduleFactory:segapcmFactory,moduleOptions:segaPcmModuleOptions,clock:4000000});
 try{
  for(const e of [opmOnly,mix])for(const [r,v] of writes(0))e.writeYm2151(r,v);
  for(const e of [pcmOnly,mix])programPcm(e);
  const x=opmOnly.processFrames(2000),y=pcmOnly.processFrames(2000),z=mix.processFrames(2000);
  assert(x.left.some(v=>v!==0),'OPM must sound');assert(y.left.some(v=>v!==0),'Sega PCM must sound');
  assert.deepEqual(z.left,Float32Array.from(x.left,(v,i)=>v+y.left[i]));
  mix.setSegaPcmMuted(true);assert.deepEqual(mix.processFrames(500).left,opmOnly.processFrames(500).left);
  mix.setSegaPcmMuted(false);
  mix.reset();for(const [r,v] of writes(0))mix.writeYm2151(r,v);programPcm(mix);
  assert.deepEqual(mix.processFrames(2000).left,z.left);
 }finally{opmOnly.dispose();mix.dispose();pcmOnly.dispose();}
});

test('YM2151 + Sega PCM VGM dispatches command 0xC0/ROM data through the player and is allowed without warning',async()=>{
 const vm=await import('node:vm');
 const {vgmBytes}=await import('./test-support/vgm-mock.js');
 const {default:segapcmFactory}=await import('../docs/generated/segapcm_wasm.js');
 const source=readFileSync(new URL('../docs/vgm_analyzer/vgm_analyzer.js',import.meta.url),'utf8');
 const panel={hidden:true,textContent:''},context=vm.createContext({document:{getElementById:()=>panel},status:{},console});
 vm.runInContext(source.slice(source.indexOf('const playbackWarnings ='),source.indexOf('function currentStatusSuffix')),context);
 vm.runInContext(source.slice(source.indexOf('function validateOpmPlayback('),source.indexOf('async function ensurePlaybackReady(')),context);
 const e=await Ym2151AudioEngine.create({...options,segaPcmModuleFactory:segapcmFactory,
  segaPcmModuleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/segapcm_wasm.wasm',import.meta.url))},segaPcmClock:4000000});
 try{
  const base=vgm(),mixed=vgmBytes([
   0x67,0x66,0x80,10,0,0,0,16,0,0,0,4,0,0,0,18,52,
   0xc0,2,0,0x7f,0xc0,3,0,0x7f,0xc0,6,0,0,0xc0,7,0,8,0xc0,0x86,0,0,
   ...base.slice(0x40)]);
  const header=new DataView(mixed.buffer);header.setUint32(0x30,3579545,true);header.setUint32(0x38,4000000,true);
  context.validateOpmPlayback(new Ym2612VGM(mixed).header);
  assert.equal(panel.hidden,true,'no warning for a now-supported combination');
  const p=new VgmPlayer(e);p.load(mixed,{logger:{warn:context.reportPlaybackWarning}});p.reset();p.play();
  const left=new Float32Array(4410),right=new Float32Array(4410);p.process(left,right,4410);
  assert(left.some(v=>v!==0));
 }finally{e.dispose();}
});
