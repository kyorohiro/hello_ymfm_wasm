import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Msm5205AudioEngine} from './msm5205audioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {createPlaybackEngine,selectPlaybackConfiguration,playbackMuteControls} from '../docs/vgm_analyzer/playback_core.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';

function file(commands,flags=4){
  const bytes=new Uint8Array(256+commands.length),v=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x172,true);v.setUint32(0x34,0xcc,true);
  v.setUint32(0xf0,1536000,true);v.setUint8(0xd7,flags);bytes.set(commands,256);return bytes;
}
const commands=[0x32,1,0x32,0,...Array.from({length:300},(_,i)=>[0x32,0x10|(i%16),0x72]).flat(),0x66];
const render=(p,n)=>{const left=new Float32Array(n),right=left.slice();p.process(left,right,n);return {left,right};};
function player(e,b){const p=new VgmPlayer(e);p.load(b);p.setPrefetchFactor(1);p.play();return p;}
test('MSM5205 literal ADPCM output, reset and external VCLK',()=>{
  const e=new Msm5205AudioEngine({clock:1536000,flags:4,outputSampleRate:16000});
  e.writeMsm5205(0,1);e.writeMsm5205(0,0);
  for(const n of [0,7,8])e.writeMsm5205(1,n);
  assert.deepEqual([...e.processFrames(3).left],[2/2048,31/2048,25/2048]);
  e.writeMsm5205(0,1);assert(e.processFrames(5).left.every(v=>v===0));
  e.writeMsm5205(0,0);e.writeMsm5205(4,3);e.writeMsm5205(1,7);
  assert(e.processFrames(3).left.every(v=>v===0));
  e.writeMsm5205(2,1);assert.equal(e.processFrames(1).left[0],30/2048);
  e.writeMsm5205(2,1);assert.equal(e.processFrames(1).left[0],30/2048);
});
test('MSM5205 FIFO, 3-bit mode, prescaler and output mute retain decoder progression',()=>{
  const a=new Msm5205AudioEngine({clock:1536000,flags:0,outputSampleRate:16000});
  a.writeMsm5205(0,1);a.writeMsm5205(0,0);a.writeMsm5205(1,3);
  assert.equal(a.processFrames(1).left[0],26/2048);
  for(let i=0;i<20;i++)a.writeMsm5205(1,i&15);assert.equal(a.fifo.length,7);
  a.writeMsm5205(4,2);a.processFrames(1);assert.equal(a.fifo.length,5);
  const b=new Msm5205AudioEngine({clock:1536000,flags:4});
  const c=new Msm5205AudioEngine({clock:1536000,flags:4});
  for(const e of [b,c])for(const n of [7,3,1,12])e.writeMsm5205(1,n);
  b.setMsm5205Muted(true);assert(b.processFrames(13).left.every(v=>v===0));c.processFrames(13);
  b.setMsm5205Muted(false);assert.deepEqual(b.processFrames(129),c.processFrames(129));
});
for(const Parser of [Ym2612VGM,DocsVGM])test(`MSM5205 header, packed writes and command descriptions (${Parser===DocsVGM?'docs':'web'})`,()=>{
  const bytes=file([0x32,0x1f,0x66],6),p=new Parser(bytes);
  assert.equal(p.header.msm5205Clock,1536000);assert.equal(p.header.msm5205Flags,6);
  assert.deepEqual(p.step(),{type:'msm5205-write',register:1,value:15,chipIndex:0});
  assert.match(p.describeCommandAt(256),/msm5205.*register=0x01.*value=0x0f/);
  new DataView(bytes.buffer).setUint32(8,0x171,true);assert.equal(new Parser(bytes).header.msm5205Clock,0);
  assert.throws(()=>new Parser(file([0x32])).step());
});
test('MSM5205 direct playback is partition-independent and normal seeking restores sound',async()=>{
  const bytes=file(commands,6),make=()=>createPlaybackEngine(new Ym2612VGM(bytes),{getFactory:getNodePlaybackFactory});
  const a=await make(),b=await make();
  try{
    const p=player(a,bytes),q=player(b,bytes),expected=render(p,900),left=[];
    for(let i=0;i<900;i++)left.push(render(q,1).left[0]);
    assert.deepEqual(left,[...expected.left]);assert(expected.left.some(v=>Math.abs(v)>.001));
    await seekPlayback(p,150);await seekPlayback(q,150);p.play();q.play();assert.deepEqual(render(p,311),render(q,311));
    const r=player(a,bytes);const wav=await renderVgmToWav(r,{maxSeconds:.01});
    assert.equal(new TextDecoder().decode(wav.bytes.subarray(0,4)),'RIFF');assert(wav.bytes.subarray(44).some(v=>v!==0));
  }finally{a.dispose();b.dispose();}
});
test('HuC6280 + MSM5205 preserves Note-ish configuration and independently mixes/mutes ADPCM',async()=>{
  const seed=readFileSync(new URL('../test/fixtures/huc6280-tone.vgm',import.meta.url));
  const parser=new Ym2612VGM(seed);let pos;while(true){pos=parser.position;if(parser.step().type==='wait')break;}
  const bytes=new Uint8Array(pos+commands.length);bytes.set(seed.subarray(0,pos));bytes.set(commands,pos);
  const v=new DataView(bytes.buffer);v.setUint32(8,0x172,true);v.setUint32(0xf0,1536000,true);v.setUint8(0xd7,6);
  const parsed=new Ym2612VGM(bytes),cfg=selectPlaybackConfiguration(parsed);
  assert.equal(cfg.kind,'huc6280');assert(playbackMuteControls(cfg).some(c=>c.id==='msm5205'));
  const make=()=>createPlaybackEngine(new Ym2612VGM(bytes),{getFactory:getNodePlaybackFactory});
  const full=await make(),huc=await make(),adpcm=await make();
  try{
    huc.setMsm5205Muted(true);for(let i=0;i<6;i++)adpcm.setChannelMuted(i,true);
    const f=render(player(full,bytes),900),h=render(player(huc,bytes),900),a=render(player(adpcm,bytes),900);
    assert(a.left.some(v=>Math.abs(v)>.001));assert(h.left.some(v=>v!==0));
    f.left.forEach((value,i)=>assert(Math.abs(value-h.left[i]-a.left[i])<1e-6));
    assert(full.playbackMixer.strips.has('huc6280'));assert(full.playbackMixer.strips.has('msm5205'));
    full.playbackMixer.set('msm5205',{gain:0});full.reset();
    assert.deepEqual(render(player(full,bytes),900),h);
  }finally{full.dispose();huc.dispose();adpcm.dispose();}
});
