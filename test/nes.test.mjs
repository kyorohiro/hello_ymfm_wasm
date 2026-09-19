import test from 'node:test';
import assert from 'node:assert/strict';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {createPlaybackEngine,createPlaybackPlayer,selectPlaybackConfiguration,applyPlaybackMutes} from '../docs/vgm_analyzer/playback_core.js';
import {renderSource} from '../cli/render.js';
import {exportSource,listSourceScoreChannels} from '../docs/vgm_analyzer/analyzer_core.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
function vgm(commands,clock=1789773){const b=new Uint8Array(256+commands.length+1),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(4,b.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x34,256-0x34,true);v.setUint32(0x84,clock,true);b.set(commands,256);b[b.length-1]=0x66;return b;}
const w=(r,v)=>[0xb4,r,v],wait=[0x61,0x22,0x56];
const pulse=vgm([...w(0x15,1),...w(0,0xbf),...w(2,253),...w(3,0x08),...wait]);
test('NES B4 registers, C2 RAM blocks and secondary chips are parsed explicitly',()=>{
 const p=new Ym2612VGM(vgm([0x67,0x66,0xc2,3,0,0,0,0,0xc0,0xaa,...w(0x11,64)]));
 assert.equal(p.header.nesApuClock,1789773);const memory=p.step();assert.equal(memory.offset,0xc000);assert.deepEqual([...memory.data],[0xaa]);assert.equal(p.step().type,'nes-apu-write');
 assert.throws(()=>selectPlaybackConfiguration(new Ym2612VGM(vgm([],0x401b4f4d))),/Dual/);
 assert.throws(()=>new Ym2612VGM(vgm(w(0x80,1))).playStep({}),/Second NES/);
});
test('NES shared Browser engine and Node WAV agree; pulse pitch and selected score export work',async()=>{
 const engine=await createPlaybackEngine(new Ym2612VGM(pulse));
 try {const player=createPlaybackPlayer(engine,pulse);player.play();const browser=await renderVgmToWav(player,{maxSeconds:.1});const node=await renderSource(pulse,{maxSeconds:.1});assert.deepEqual(node.bytes,browser.bytes);assert(node.bytes.subarray(44).some(x=>x!==0));}finally{engine.dispose();}
 assert.equal(listSourceScoreChannels(pulse).channels[0].id,'nes-ch1');
 for(const format of ['musicxml','lilypond','midi']){const result=exportSource(pulse,{format,bpm:120});assert((result.bytes?.length??result.text?.length)>0);}
 const xml=exportSource(pulse,{format:'musicxml',channels:['nes-ch1']}).text;assert.match(xml,/NES CH1/);assert.doesNotMatch(xml,/NES CH2/);
});
test('NES DMC consumes embedded sample RAM; output mute and region rendering preserve state',async()=>{
 const dmc=value=>vgm([0x67,0x66,0xc2,19,0,0,0,0,0xc0,...Array(17).fill(value),...w(0x10,0x4f),...w(0x11,64),...w(0x12,0),...w(0x13,1),...w(0x15,16),...wait]);
 const a=await renderSource(dmc(0xaa),{maxSeconds:.1}),b=await renderSource(dmc(0xff),{maxSeconds:.1});assert.notDeepEqual(a.bytes,b.bytes);
 const muted=await renderSource(dmc(0xaa),{maxSeconds:.1,mute:['nes-ch-5']});assert.notDeepEqual(a.bytes,muted.bytes);
 const region=await renderSource(pulse,{startSeconds:.02,maxSeconds:.03}),full=await renderSource(pulse,{maxSeconds:.1});assert.deepEqual(region.bytes.subarray(44),full.bytes.subarray(44+882*4,44+2205*4));
 await assert.rejects(renderSource(vgm([],1662607)),/NTSC/);
 await assert.rejects(renderSource(vgm(w(0x20,1))),/FDS/);
});

test('NES pulse 2, triangle and noise produce distinct sustained output',async()=>{
 const sources=[vgm([...w(0x15,2),...w(4,0xbf),...w(6,253),...w(7,8),...wait]),
   vgm([...w(0x15,4),...w(8,0xff),...w(10,126),...w(11,8),...w(0x17,0x80),...wait]),
   vgm([...w(0x15,8),...w(0x0c,0x3f),...w(0x0e,4),...w(0x0f,8),...wait])];
 for(let i=0;i<sources.length;i++){
   const a=await renderSource(sources[i],{maxSeconds:.1});
   const b=await renderSource(sources[i],{maxSeconds:.1,mute:[`nes-ch-${i+2}`]});
   assert.notDeepEqual(a.bytes.subarray(44+10000),b.bytes.subarray(44+10000));
 }
});

test('NES mute leaves channel state running and reset reproduces the same PCM',async()=>{
 const a=await createPlaybackEngine(new Ym2612VGM(pulse)),b=await createPlaybackEngine(new Ym2612VGM(pulse));
 try {
  for(const e of [a,b]){e.writeNesApu(0x15,1);e.writeNesApu(0,0xbf);e.writeNesApu(2,253);e.writeNesApu(3,8);}
  a.setChannelMuted(0,true);a.processFrames(1000);b.processFrames(1000);a.setChannelMuted(0,false);
  assert.equal(a.apu.square1.progTimerCount,b.apu.square1.progTimerCount);
  assert.equal(a.apu.square1.squareCounter,b.apu.square1.squareCounter);
  const first=b.processFrames(100).left;b.reset();b.writeNesApu(0x15,1);b.writeNesApu(0,0xbf);b.writeNesApu(2,253);b.writeNesApu(3,8);b.processFrames(1000);
  assert.deepEqual(b.processFrames(100).left,first);
 }finally{a.dispose();b.dispose();}
});
