import test from 'node:test';
import assert from 'node:assert/strict';
import {VgmPlayer} from './vgmplayer.js';
import {VgmPlayer as DocsPlayer} from '../docs/js/vgmplayer.js';
import {vgmBytes} from './test-support/vgm-mock.js';
import {MockSoundEngine,drainPlayer} from './test-support/vgm-engine-mock.js';
const block=(type,data)=>[0x67,0x66,type,data.length,0,0,0,...data];
// VGM 1.71 compressed blocks: literal MSB-first packed bits and expected values.
const cases=[
 ['copy',[],[0,2,0,0,0,8,4,0,0x80,0,0x12],[0x81,0x82]],
 ['shift',[],[0,2,0,0,0,8,4,1,0,0,0x12],[0x10,0x20]],
 ['table',[0,2,8,1,2,0,0x81,0x82],[0,2,0,0,0,8,1,2,99,0,0x40],[0x81,0x82]],
 ['DPCM wrap',[1,0,8,1,2,0,1,255],[1,3,0,0,0,8,1,0,255,0,0x20],[0,1,0]],
];
for(const [label,Player] of [['web',VgmPlayer],['docs',DocsPlayer]]) {
 for(const [name,table,data,values] of cases) test(`${label}: MD ${name} compressed and plain banks agree`,()=>{
   for(const compressed of [true,false]) {
     const engine=new MockSoundEngine(),player=new Player(engine);
     player.load(vgmBytes([...(table.length?block(0x7f,table):[]),
       ...block(compressed?0x40:0,compressed?data:values),
       0x90,0,2,0,0x2a,0x91,0,0,1,0,0x92,0,0x22,0x56,0,0,0x95,0,0,0,0,
       0x61,8,0,0x66]));player.play();drainPlayer(player,1);
     assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[2]]),values.map((v,i)=>[i*2,v]));
     player.reset();player.play();drainPlayer(player,3);
     assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[2]]),values.map((v,i)=>[i*2,v]));
   }
 });
 test(`${label}: 32X 16-bit table PWM and compressed MD DAC coexist with PSG`,()=>{
   const engine=new MockSoundEngine(),player=new Player(engine);
   player.load(vgmBytes([...block(0x7f,[0,2,16,1,2,0,0x23,1,0x56,4]),
     ...block(0x43,[0,4,0,0,0,16,1,2,0,0,0x40]),...block(0x40,cases[0][2]),
     0x90,0,0x11,0,2,0x91,0,3,1,0,0x92,0,0x22,0x56,0,0,0x95,0,0,0,0,
     0x90,1,2,0,0x2a,0x91,1,0,1,0,0x92,1,0x22,0x56,0,0,0x95,1,0,0,0,
     0x50,0x9f,0x61,5,0,0x66]));player.play();drainPlayer(player,1);
   assert.deepEqual(engine.trace.map(e=>[e.frame,e.chip,e.args]),[
     [0,'psg',[0x9f]],[0,'pwm',[0,2,0x123]],[0,'ym2612',[0,0x2a,0x81]],
     [2,'pwm',[0,2,0x456]],[2,'ym2612',[0,0x2a,0x82]]]);
 });
 test(`${label}: missing/mismatched tables and truncated compressed input fail before writes`,()=>{
   for(const commands of [block(0x40,cases[2][2]),
     [...block(0x7f,[0,2,16,1,2,0,1,0,2,0]),...block(0x40,cases[2][2])],
     block(0x40,cases[0][2].slice(0,-1)),block(0x7f,[0,2,8,1,2,0,10])]) {
     const engine=new MockSoundEngine(),player=new Player(engine);player.load(vgmBytes([...commands,0x66]));player.play();
     assert.throws(()=>drainPlayer(player),/compressed|table/i);assert.deepEqual(engine.trace,[]);
   }
 });
}
const {seekPlayback}=await import('../docs/vgm_analyzer/seek_playback.js');
for(const [label,path] of [['web','./ym2612vgm.js'],['docs','../docs/js/ym2612vgm.js']]) {
 const {decodePwmBlock}=await import(path);
 test(`${label}: 16-bit copy/shift/DPCM and packed byte boundaries`,()=>{
   assert.deepEqual([...decodePwmBlock(new Uint8Array([0,6,0,0,0,16,3,0,0,0,0x2b,0x80]))],[1,0,2,0,7,0]);
   assert.deepEqual([...decodePwmBlock(new Uint8Array([0,4,0,0,0,16,4,1,0,0,0x12]))],[0,0x10,0,0x20]);
   assert.deepEqual([...decodePwmBlock(new Uint8Array([1,6,0,0,0,16,1,0,255,255,0x20]),
     new Map([['1:0',{bits:16,packed:1,values:[1,65535]}]]))],[0,0,1,0,0,0]);
   assert.throws(()=>decodePwmBlock(new Uint8Array([0,1,0,0,0,8,1,2,0,0,0x80]),
     new Map([['0:2',{bits:8,packed:1,values:[1]}]])),/index/);
   assert.throws(()=>decodePwmBlock(new Uint8Array([0,0,0,0,5,8,1,0,0,0])),/oversized/);
 });
}
for(const [label,Player] of [['web',VgmPlayer],['docs',DocsPlayer]]) {
 test(`${label}: mixed banks, table replacement, reset and 48k seek`,async()=>{
   const bytes=vgmBytes([...block(0,[99]),...block(0x7f,[0,2,8,1,2,0,10,20]),
     ...block(0x40,[0,2,0,0,0,8,1,2,0,0,0x40]),
     ...block(0x7f,[0,2,8,1,2,0,30,40]),...block(0x40,[0,2,0,0,0,8,1,2,0,0,0x40]),
     0x90,0,2,0,0x2a,0x91,0,0,1,0,0x92,0,0x22,0x56,0,0,
     0x95,0,1,0,0,0x61,5,0,0x95,0,2,0,0,0x61,5,0,0x66]);
   for(const rate of [44100,48000]) {
     const engine=new MockSoundEngine(rate),player=new Player(engine);player.load(bytes);
     await seekPlayback(player,3);player.resume();drainPlayer(player,1);
     assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[2]]),[[0,10],[2,20],[5,30],[7,40]]);
     player.reset();player.play();drainPlayer(player,128);
     assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[2]]),[[0,10],[2,20],[5,30],[7,40]]);
   }
 });
 test(`${label}: 32X compressed interleaved left/right reverse loop and stop`,()=>{
   const bytes=vgmBytes([...block(0x43,[0,8,0,0,0,16,4,0,0,0,0x12,0x34]),
     0x90,0,0x11,0,2,0x91,0,3,2,0,0x92,0,0x22,0x56,0,0,0x95,0,0,0,0x11,
     0x90,1,0x11,0,3,0x91,1,3,2,1,0x92,1,0x22,0x56,0,0,0x95,1,0,0,0x11,
     0x61,5,0,0x94,255,0x61,5,0,0x66]);
   for(const size of [1,3,128]) {
     const engine=new MockSoundEngine(),player=new Player(engine);player.load(bytes);player.play();drainPlayer(player,size);
     assert.deepEqual(engine.trace.map(e=>[e.frame,e.args[1],e.args[2]]),[[0,2,3],[0,3,4],[2,2,1],[2,3,2],[4,2,3],[4,3,4]]);
   }
 });
}
