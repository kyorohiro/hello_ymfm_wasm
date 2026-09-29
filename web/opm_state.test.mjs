import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPlaybackEngine} from '../docs/vgm_analyzer/playback_core.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import {createOpmState} from '../docs/vgm_analyzer/opm_monitor.js';
import {createOpmNoteTracker} from '../docs/vgm_analyzer/opm_notes.js';
const fixture=name=>readFileSync(new URL(`../test/fixtures/${name}.vgm`,import.meta.url));
const make=bytes=>createPlaybackEngine(new Ym2612VGM(bytes),{getFactory:getNodePlaybackFactory});
function prepare(e,bytes){
 const p=new Ym2612VGM(bytes),targets={
 ym2151:{writeRegister:(r,v)=>e.writeYm2151(r,v)},psg:{write:v=>e.writePsg(v)},
 segapcm:{writeRegister:(r,v)=>e.writeSegaPcm(r,v),loadSampleMemory:(...a)=>e.loadSampleMemory(...a)},
 okim6258:{writeRegister:(r,v)=>e.writeOki6258(r,v)}};
 while(true){const ev=p.playStep(targets);if(ev.type==='wait')return;if(ev.type==='end')throw Error('no wait');}
}
const render=(p,n)=>{const left=new Float32Array(n),right=new Float32Array(n);p.process(left,right,n);return {left,right};};
function player(e,bytes){const p=new VgmPlayer(e);p.load(bytes);p.setPrefetchFactor(1);p.play();return p;}
function shortSong(bytes){
 const p=new Ym2612VGM(bytes);let offset;while(true){offset=p.position;if(p.step().type==='wait')break;}
 const commands=[];for(let i=0;i<50;i++)commands.push(0x61,0xb9,1);commands.push(0x66);
 const out=new Uint8Array(offset+commands.length);out.set(bytes.subarray(0,offset));out.set(commands,offset);return out;
}
for(const name of ['opm-audible','segapcm-opm','segapcm-opm-psg','opm-oki-mix'])test(`${name}: native snapshots restore exact sound after reset and memory replacement`,async()=>{
 const bytes=fixture(name),e=await make(bytes),ref=await make(bytes);
 try{
  prepare(e,bytes);prepare(ref,bytes);e.processFrames(13);ref.processFrames(13);
  assert.equal(e.supportsState(),true);const s=e.saveState(),expected=ref.processFrames(713);
  assert(expected.left.some(v=>v!==0));assert.deepEqual(e.processFrames(713),expected);
  e.reset();e.clearSampleMemory?.();e.processFrames(71);e.loadState(s);
  assert.deepEqual(e.processFrames(713),expected);e.loadState(s);assert.deepEqual(e.processFrames(713),expected);
  assert.throws(()=>ref.loadState(s),/Incompatible/);
  e.setChannelMuted(0,true);assert.throws(()=>e.loadState(s),/Incompatible/);e.setChannelMuted(0,false);
  if(e.psg){e.setPsgMuted(true);assert.throws(()=>e.loadState(s),/Incompatible/);e.setPsgMuted(false);}
  if(e.segapcm){e.setSegaPcmChannelMuted(0,true);assert.throws(()=>e.loadState(s),/Incompatible/);e.setSegaPcmChannelMuted(0,false);}
  if(e.attachedOki6258){e.attachedOki6258.setOkiMuted(true);assert.throws(()=>e.loadState(s),/Incompatible/);e.attachedOki6258.setOkiMuted(false);}
 }finally{e.dispose();ref.dispose();}
});
for(const name of ['opm-audible','segapcm-opm','segapcm-opm-psg','opm-oki-mix'])test(`${name}: backward cached seek matches replay and reduces work`,async()=>{
 const bytes=name==='opm-oki-mix'?fixture(name):shortSong(fixture(name)),e=await make(bytes),ref=await make(bytes);
 try{
  const p=player(e,bytes),q=player(ref,bytes);p.checkpointIntervalSeconds=name==='opm-oki-mix'?.002:.05;
  for(let i=0;i<20;i++)render(p,name==='opm-oki-mix'?60:600);
  assert(p.checkpointStats().count>0);
  let work=0;const original=e.processFrames.bind(e);e.processFrames=n=>{work+=n;return original(n);};
  const target=name==='opm-oki-mix'?.015:.175;await seekPlayback(p,target*44100);await seekPlayback(q,target*44100);
  assert(work<e.sampleRate()*target/2,`replayed ${work} frames`);
  p.play();q.play();assert.deepEqual(render(p,999),render(q,999));
 }finally{e.dispose();ref.dispose();}
});
test('OKIM6258 restores partially consumed FIFO, decoder and output phase',async()=>{
 const e=await make(fixture('opm-oki-mix')),c=e.attachedOki6258;
 try{
  c.writeOki6258(0,2);for(const v of [0x17,0x28,0x39,0x4a,0x5b,0x6c])c.writeOki6258(1,v);
  c.processFrames(7);const s=c.saveState(),expected=c.processFrames(29);assert(expected.left.some(v=>v!==0));
  c.reset();c.writeOki6258(2,3);c.loadState(s);assert.deepEqual(c.processFrames(29),expected);
  const m=c.module;assert.equal(m._okim6258_load_state(c.handle,0,0),0);
 }finally{e.dispose();}
});
test('YM2151 preserves LFO, noise, timer and pending address latch',async()=>{
 const e=await make(fixture('opm-audible'));try{
  prepare(e,fixture('opm-audible'));const c=e.ym2151,w=(r,v)=>{c.write(0,r);c.write(1,v);};
  for(const [r,v] of [[0x18,0xff],[0x19,0x7f],[0x19,0xff],[0x1b,3],[0x38,0x73],[0x0f,0x9f],[0x10,0xff],[0x11,3],[0x14,5]])w(r,v);
  for(const r of [0x20,0x28,0x40,0x60,0x80,0xa0,0xc0,0xe0])w(r+7,r===0x20?0xc7:r===0x28?0x4a:r===0x80?31:1);
  w(8,0x7f);c.generateStereo(113);c.write(0,0x19);const s=c.saveState();
  c.write(1,0x41);const expected=c.generateStereo(1291),status=c.readStatus();c.reset();c.loadState(s);c.write(1,0x41);
  assert.deepEqual(c.generateStereo(1291),expected);assert.equal(c.readStatus(),status);
 }finally{e.dispose();}
});
test('OPM monitor and note tracker restore AMD/PMD, active notes and note IDs',()=>{
 const m=createOpmState(()=>100),n=createOpmNoteTracker(3579545,()=>{});
 const write=(r,v,t)=>{m.write(r,v);n.write(r,v,t);};
 write(0x19,41,0);write(0x19,0x80|53,0);write(0x28,0x4a,0);write(8,0x78,10);
 const ms=m.saveState(),ns=n.saveState(),expected=m.snapshot();
 write(8,0,30);write(0x19,0,30);m.loadState(ms);n.loadState(ns);
 assert.deepEqual(m.snapshot(),expected);assert.deepEqual(n.saveState(),ns);
 write(8,0,40);write(8,0x78,50);const continued=n.saveState();n.loadState(ns);n.write(8,0,40);n.write(8,0x78,50);assert.deepEqual(n.saveState(),continued);
});
test('Sega PCM rejects truncated ROM states before altering playback',async()=>{
 const bytes=fixture('segapcm-opm-psg'),e=await make(bytes);try{
  prepare(e,bytes);e.processFrames(17);const c=e.segapcm,m=c.module,s=c.saveState();
  const expected=c.generateStereo(319);c.loadState(s);
  const size=m._segapcm_save_state(c.handle,0),ptr=m._malloc(size);
  try{
   m._segapcm_save_state(c.handle,ptr);assert.equal(m._segapcm_load_state(c.handle,ptr,size-1),0);
   const prefix=size-4-c.sampleMemorySize;new DataView(m.HEAPF32.buffer).setUint32(ptr+prefix,0xffffffff,true);
   assert.equal(m._segapcm_load_state(c.handle,ptr,size),0);
   assert.deepEqual(c.generateStereo(319),expected);
   assert(expected.left.some(v=>v!==0));
  }finally{m._free(ptr);}
 }finally{e.dispose();}
});
test('Analyzer retains OPM checkpoints and restores OPM displays on backward seek',async()=>{
 const {default:vm}=await import('node:vm');
 const source=readFileSync(new URL('../docs/vgm_analyzer/vgm_analyzer.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function ensurePlaybackReady('),source.indexOf('\nfunction isPlaybackReady('));
 const bytes=shortSong(fixture('segapcm-opm-psg')),e=await make(bytes);
 try{
  const monitor=createOpmState(()=>0),tracker=createOpmNoteTracker(3579545,()=>{});
  monitor.write(0x19,41);tracker.write(0x28,0x4a,0);tracker.write(8,0x78,10);
  const c=vm.createContext({engine:e,engineClockKey:'',currentChipKind:'ym2151',player:null,VgmPlayer,
   vgm:new Ym2612VGM(bytes),currentBuffer:bytes,structuredClone,selectPlaybackConfiguration:()=>({kind:'ym2151'}),CHANNEL_MUTE_CHIPS:[],
   channelMonitor:[],monitorFrequencyHigh:[],psgMonitor:{latchedRegister:6},pcmMonitor:{},lastYm2612DacEnable:0,
   opmMonitor:monitor,opmNoteTracker:tracker,opmNoteChannels:structuredClone(tracker.channels),
   requestChannelMonitorRender(){},applySourceMutes(){},sourceChipKind:()=> 'ym2151',effectiveSourceMutes:()=>({}),hasOkiSource:()=>false,
   applyMasterVolume(){},prefetchFactorSelect:{value:'2'},loopCheckbox:{checked:false},
   audioContext:{sampleRate:e.sampleRate(),state:'running'},reportPlaybackWarning(){},noteishHeader:{}});
  const key=body.match(/const nextClockKey = ([\s\S]*?);/)[1].replace('nextChipKind',"'ym2151'");
  vm.runInContext(`engineClockKey = ${key};\n${body}`,c);
  await c.ensurePlaybackReady(c.vgm);assert.equal(c.player.checkpointIntervalSeconds,5);
  c.player.checkpointIntervalSeconds=.05;const parser=c.player.parser;c.player.play();for(let i=0;i<20;i++)render(c.player,600);
  assert(c.player.checkpointStats().count>0);await c.ensurePlaybackReady(c.vgm);assert.equal(c.player.parser,parser);
  const before=monitor.snapshot(),notes=tracker.saveState();monitor.write(0x19,0);tracker.write(8,0,100);
  await seekPlayback(c.player,.175*44100);assert.deepEqual(monitor.snapshot(),before);assert.deepEqual(tracker.saveState(),notes);
  c.currentBuffer=bytes.slice();await c.ensurePlaybackReady(c.vgm);assert.equal(c.player.checkpointStats().count,0);
 }finally{e.dispose();}
});
