import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ymFactory from '../docs/generated/ym2612_wasm.js';
import psgFactory from '../docs/generated/segapsg_wasm.js';
import pcmFactory from '../docs/generated/rf5c164_wasm.js';
import {GenesisAudioEngine, SimplePwm} from './genesisaudioengine.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
const options=name=>({wasmBinary:readFileSync(new URL(`../docs/generated/${name}_wasm.wasm`,import.meta.url))});
async function make(pcm=true) {
 return GenesisAudioEngine.create({ym2612ModuleFactory:ymFactory,ym2612ModuleOptions:options('ym2612'),
  segaPsgModuleFactory:psgFactory,segaPsgModuleOptions:options('segapsg'),
  rf5c164Clock:pcm?12500000:0,rf5c164ModuleFactory:pcmFactory,rf5c164ModuleOptions:options('rf5c164')});
}
function fm(e) {
 for (const op of [0,4,8,12]) for(const [reg,val] of [[0x30,1],[0x40,16],[0x50,31],[0x60,7],[0x70,3],[0x80,0x36]]) e.writeYm2612(0,reg+op,val);
 for(const [reg,val] of [[0xb0,7],[0xb4,0xc0],[0xa4,0x22],[0xa0,0x69],[0x24,255],[0x25,3],[0x27,5],[0x28,0xf0]])e.writeYm2612(0,reg,val);
}
function psg(e) { for(const v of [0x84,0x10,0x90,0xe4,0xf2])e.writePsg(v); }
function pcm(e) {
 e.pcm.loadMemory(Uint8Array.from([0x91,0xb0,0x40,0x65,0xff]),0);
 for(const [r,v] of [[7,0xc0],[0,255],[1,0x8f],[2,0x71],[3,3],[4,0],[5,0],[6,0],[8,0xfe]])e.writeRf5c164(r,v);
}
const render=(p,n)=>{const l=new Float32Array(n),r=new Float32Array(n);p.process(l,r,n);return {left:l,right:r};};
function file(commands) {
 const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32(0x2c,7670454,true);b.set(commands,256);return b;
}
function song() {
 const cmd=[0x50,0x84,0x50,0x10,0x50,0x90,0x50,0xe4,0x50,0xf2,
  0x52,0x2b,0x80,0x53,0xb6,0xc0,
  0x67,0x66,0,4,0,0,0,32,128,200,80,
  0x90,0,2,0,0x2a,0x91,0,0,1,0,0x92,0,0xe8,3,0,0,0x95,0,0,0,1,
  0xb2,0x10,100,0xb2,0x40,75];
 for(let i=0;i<160;i++)cmd.push(0x61,0x3b,0x11,0xb2,0x40,25+(i%3)*25);
 cmd.push(0x66);return file(cmd);
}
test('real cores restore audible FM/timer, PSG noise/latch, RF5C164 RAM/fraction and PWM exactly',async()=>{
 const e=await make();try {
  fm(e);psg(e);pcm(e);e.writePwm(1,100);e.writePwm(2,75);
  e.processFrames(739);const state=e.saveState();const expected=e.processFrames(2001);
  assert(expected.left.some(v=>v!==0));
  e.reset();e.pcm.writeMemory(0,0x7f);e.writePwm(4,1);e.processFrames(123);
  e.loadState(state);assert.deepEqual(e.processFrames(2001),expected);
  e.loadState(state);assert.deepEqual(e.processFrames(2001),expected);
  assert.throws(()=>e.ym2612.loadState(e.psg.saveState()),/foreign/);
  e.setPwmMuted(true);assert.throws(()=>e.loadState(state),/Incompatible/);
 }finally{e.dispose();}
});
test('PWM preserves unwritten values and current mute; old WASM degrades to replay',()=>{
 const p=new SimplePwm(),s=p.saveState();p.writeRegister(4,12);p.muted=true;p.loadState(s);
 assert.equal(p.left,null);assert.equal(p.muted,true);assert.throws(()=>p.loadState({}),/Invalid/);
 const chip={reset(){}};assert.equal(Boolean(new GenesisAudioEngine(chip,chip,44100).supportsState()),false);
});
test('player restores DAC streams, fractional waits, queued audio and monitor state; rejects another track',async()=>{
 const e=await make(false);try {
  const p=new VgmPlayer(e);p.load(song());let ui={writes:4};p.captureSeekState=()=>structuredClone(ui);p.restoreSeekState=s=>ui=s;
  p.play();render(p,1234);const saved=p.saveState(),expected=render(p,7777);
  ui.writes=99;p.reset();p.loadState(saved);assert.deepEqual(ui,{writes:4});assert.deepEqual(render(p,7777),expected);
  p.load(song());assert.throws(()=>p.loadState(saved),/foreign/);
 }finally{e.dispose();}
});
test('cached backwards seek matches baseline and renders only the remaining interval; cache bounded/invalidation',async()=>{
 const e=await make(false),ref=await make(false);try {
  const p=new VgmPlayer(e),q=new VgmPlayer(ref),bytes=song();p.load(bytes);q.load(bytes);p.checkpointIntervalSeconds=5;p.play();
  let generated=0;const original=e.processFrames.bind(e);e.processFrames=n=>{generated+=n;return original(n);};
  for(let i=0;i<160;i++)render(p,4096);
  assert(p.checkpointStats().count>=2);
  generated=0;await seekPlayback(p,11*44100);const cachedWork=generated;
  await seekPlayback(q,11*44100);p.play();q.play();assert.deepEqual(render(p,2048),render(q,2048));
  assert(cachedWork<e.sampleRate()*2,`cached render ${cachedWork}`);
  assert(p.checkpointStats().bytes<=p.checkpointMaxBytes);
  p.clearQueuedAudio();assert.equal(p.checkpointStats().count,0);
  p.checkpointMaxBytes=1;render(p,8192);assert.equal(p.checkpointStats().count,0);
  p.load(bytes);assert.equal(p.checkpointStats().count,0);
 }finally{e.dispose();ref.dispose();}
});
test('seek abort before restore leaves player alone; unsupported extra chip disables checkpoints',async()=>{
 const e=await make(false);try {
  const p=new VgmPlayer(e);p.load(song());p.play();render(p,321);const before=p.parser.position;
  await assert.rejects(seekPlayback(p,999,{signal:AbortSignal.abort()}),{name:'AbortError'});assert.equal(p.parser.position,before);
  e.writeOki6258=()=>{};assert.equal(p.supportsState(),false);
 }finally{e.dispose();}
});

test('RF5C164 + DAC + PWM streaming survives RAM writes, bank switching and cached seek',async()=>{
 const e=await make(),ref=await make();try {
  const base=song(),cmd=[...base.subarray(256,base.length-1)];
  const setup=[0xc2,0,0,0x91,0xc2,1,0,0x70,0xc2,2,0,0xff];
  for(const [r,v] of [[7,0xc0],[0,255],[1,0x8f],[2,0x71],[3,3],[4,0],[5,0],[6,0],[8,0xfe]])setup.push(0xb1,r,v);
  // Continuous PWM stream with bank/stream aliasing and fractional write timing.
  setup.push(0x67,0x66,3,4,0,0,0,75,0,25,0,0xb2,0x10,100,
    0x90,1,0x11,0,4,0x91,1,3,1,0,0x92,1,0x21,3,0,0,0x95,1,0,0,1);
  const bytes=file([...setup,...cmd,0xc2,0,0,0x50,0xb1,7,0x81,0xc2,0,0,0x23,0x61,0xff,0xff,0x66]);
  const p=new VgmPlayer(e),q=new VgmPlayer(ref);p.load(bytes);q.load(bytes);p.checkpointIntervalSeconds=5;p.play();
  p.checkpointIntervalSeconds=1;p.checkpointMaxCount=3;
  for(let i=0;i<225;i++)render(p,4096);
  assert.equal(p.checkpointStats().count,3);
  assert.equal(e.pcm.readMemory(0),0x50);assert.equal(e.pcm.readMemory(4096),0x23);
  await seekPlayback(p,15.5*44100);await seekPlayback(q,15.5*44100);
  assert.equal(e.pcm.readMemory(0),0x91);assert.equal(e.pcm.readMemory(4096),0);
  p.play();q.play();assert.deepEqual(render(p,4096),render(q,4096));
  const saved=p.saveState();e.setPsgMuted(true);assert.throws(()=>p.loadState(saved),/Incompatible/);
  p.restoreCheckpoint(15.5*e.sampleRate());assert.equal(p.checkpointStats().count,0);
 }finally{e.dispose();ref.dispose();}
});

test('first-pass checkpoints remain correct after looping; near end/zero and cancellation work',async()=>{
 const e=await make(false),ref=await make(false);try {
  const bytes=song(),view=new DataView(bytes.buffer);view.setUint32(0x1c,256-0x1c,true);
  const p=new VgmPlayer(e),q=new VgmPlayer(ref);p.load(bytes);q.load(bytes);p.checkpointIntervalSeconds=5;p.setLoopEnabled(true);p.setPrefetchFactor(3);p.play();
  for(let i=0;i<240;i++)render(p,4096);
  assert(p.checkpointStats().count>0);
  await seekPlayback(p,6*44100);await seekPlayback(q,6*44100);
  assert.equal(p.loopEnabled,true);assert.equal(p.prefetchFactor,3);
  p.play();q.play();assert.deepEqual(render(p,1700),render(q,1700));
  await seekPlayback(p,0);await seekPlayback(q,0);p.play();q.play();assert.deepEqual(render(p,1700),render(q,1700));
  const abort=new AbortController();
  await assert.rejects(seekPlayback(p,1e9,{signal:abort.signal,onProgress(){abort.abort();}}),{name:'AbortError'});
  assert(p.isPaused());assert.equal(p.loopEnabled,true);
  p.setLoopEnabled(false);
  await seekPlayback(p,16*44100);await seekPlayback(q,16*44100);p.play();q.play();assert.deepEqual(render(p,1700),render(q,1700));
 }finally{e.dispose();ref.dispose();}
});

test('Analyzer preparation retains same-track checkpoints and restores monitor snapshots',async()=>{
 const {default:vm}=await import('node:vm');const {Ym2612VGM}=await import('./ym2612vgm.js');
 const source=readFileSync(new URL('../docs/vgm_analyzer/vgm_analyzer.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function ensurePlaybackReady('),source.indexOf('\nfunction isPlaybackReady('));
 const e=await make(false);try {
  let renders=0;const bytes=song();
  const c=vm.createContext({mixerUi:{attach(){}},engine:e,engineClockKey:'',currentChipKind:'ym2612',player:null,VgmPlayer,
    vgm:new Ym2612VGM(bytes),currentBuffer:bytes,structuredClone,
    selectPlaybackConfiguration:()=>({kind:'ym2612'}),CHANNEL_MUTE_CHIPS:[],
    channelMonitor:[{muted:false,fnum:123}],monitorFrequencyHigh:[1,2],psgMonitor:{latchedRegister:6},pcmMonitor:{ramBank:3},lastYm2612DacEnable:128,
    requestChannelMonitorRender:()=>renders++,applySourceMutes(){},sourceChipKind:()=> 'ym2612',effectiveSourceMutes:()=>({}),hasOkiSource:()=>false,
    applyMasterVolume(){},prefetchFactorSelect:{value:'2'},loopCheckbox:{checked:false},
    audioContext:{sampleRate:e.sampleRate(),state:'running'},reportPlaybackWarning(){},noteishHeader:{}});
  const key=body.match(/const nextClockKey = ([\s\S]*?);/)[1].replace('nextChipKind',"'ym2612'");
  vm.runInContext(`engineClockKey = ${key};\n${body}`,c);
  await c.ensurePlaybackReady(c.vgm);
  const parser=c.player.parser;c.player.play();for(let i=0;i<80;i++)render(c.player,4096);
  const count=c.player.checkpointStats().count;assert(count>0);
  await c.ensurePlaybackReady(c.vgm);assert.equal(c.player.parser,parser);assert.equal(c.player.checkpointStats().count,count);
  c.channelMonitor[0].fnum=999;c.psgMonitor.latchedRegister=1;
  await seekPlayback(c.player,5.5*44100);
  assert.equal(c.channelMonitor[0].fnum,123);assert.equal(c.psgMonitor.latchedRegister,6);assert(renders>0);
  c.currentBuffer=song();await c.ensurePlaybackReady(c.vgm);assert.notEqual(c.player.parser,parser);assert.equal(c.player.checkpointStats().count,0);
 }finally{e.dispose();}
});

test('oversized checkpoints are retried at the interval, not every audio callback',async()=>{
 const e=await make(false);try {
  const p=new VgmPlayer(e);p.load(song());p.checkpointIntervalSeconds=.1;p.checkpointMaxBytes=1;
  let attempts=0;const save=p.saveState.bind(p);p.saveState=()=>{attempts++;return save();};p.play();
  for(let i=0;i<100;i++)render(p,128);
  assert(attempts>0&&attempts<=3);assert.equal(p.checkpointStats().count,0);
 }finally{e.dispose();}
});
