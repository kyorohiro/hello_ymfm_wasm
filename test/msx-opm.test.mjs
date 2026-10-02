import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,exportSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {createPlaybackEngine,createPlaybackPlayer,selectPlaybackConfiguration,applyPlaybackMutes} from '../docs/vgm_analyzer/playback_core.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {extractMsxNotes,createMsxNoteMonitor,observeMsxNotes,describeMsxNotes} from '../docs/vgm_analyzer/msx_notes.js';
import {msxMuteControls,applyMsxMute} from '../docs/vgm_analyzer/msx_mutes.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
const names=['ay','opll','audio','scc'];
const registers=[[0x20,0xc7],[0x28,0x4a],[0x30,0]];
for(const slot of [0,8,16,24])for(const [base,value] of [[0x40,1],[0x60,0x20],[0x80,31],[0xa0,0],[0xc0,0],[0xe0,15]])registers.push([base+slot,value]);
registers.push([8,0x78]);
const commands=Uint8Array.from(registers.flatMap(([r,v])=>[0x54,r,v]));
function addOpm(source,opp){
 const offset=0x34+new DataView(source.buffer,source.byteOffset).getUint32(0x34,true);
 const result=new Uint8Array(source.length+commands.length);result.set(source.subarray(0,offset));result.set(commands,offset);result.set(source.subarray(offset),offset+commands.length);
 const h=new DataView(result.buffer);h.setUint32(4,result.length-4,true);h.setUint32(0x30,3579545+(opp?0x80000000:0),true);return result;
}
const pcm=(p,n=1024)=>{const left=new Float32Array(n),right=new Float32Array(n);p.process(left,right,n);return {left,right};};
test('OPM/OPP plus all 15 MSX subsets retain audio, notes, exports, mute routing and seek',async()=>{
 for(const opp of [false,true])for(let mask=1;mask<16;mask++){
  const parts=names.filter((_,i)=>mask&(1<<i));
  const base=await readSource(new URL(`./fixtures/msx-${parts.join('-')}.vgz`,import.meta.url));
  const source=addOpm(base,opp),vgm=new Ym2612VGM(source),config=selectPlaybackConfiguration(vgm);
  assert.equal(config.kind,'msx');
  const notes=extractMsxNotes(source),original=extractMsxNotes(base);
  assert.deepEqual(notes.channels.slice(0,-8),original.channels);
  assert.equal(notes.channels.at(-8).name,`${opp?'YM2164':'YM2151'} CH1`);
  assert(notes.channels.at(-8).notes.length>0);
  for(const format of ['midi','musicxml','lilypond'])assert.equal(exportSource(source,{format,bpm:120}).noteCount,notes.channels.reduce((sum,ch)=>sum+ch.notes.length,0),format);
  const engine=await createPlaybackEngine(vgm,{getFactory:getNodePlaybackFactory});
  const reference=await createPlaybackEngine(new Ym2612VGM(base),{getFactory:getNodePlaybackFactory});
  try{
   let monitor=createMsxNoteMonitor(vgm.header);
   observeMsxNotes(engine,()=>monitor,()=>{},()=>{monitor=createMsxNoteMonitor(vgm.header);});
   const p=createPlaybackPlayer(engine,source),r=createPlaybackPlayer(reference,base);p.play();r.play();
   const full=pcm(p),baseline=pcm(r);
   assert(full.left.some(x=>x!==0));assert.notDeepEqual(full.left,baseline.left);
   assert(describeMsxNotes(monitor).at(-8).keyOn);
   await seekPlayback(p,256);p.resume();assert.deepEqual(pcm(p,256).left,full.left.slice(256,512));
   p.reset();applyPlaybackMutes(engine,config,['ym2151']);p.play();assert.deepEqual(pcm(p).left,baseline.left);
   applyPlaybackMutes(engine,config,[]);
   const controls=msxMuteControls('msx',vgm.header).filter(c=>c.chip==='ym2151');assert.equal(controls.length,9);
   p.reset();applyMsxMute(engine,'msx',controls[1],true);p.play();assert.deepEqual(pcm(p).left,baseline.left);
   applyMsxMute(engine,'msx',controls[1],false);
  }finally{engine.dispose();reference.dispose();}
  const dual=source.slice();new DataView(dual.buffer).setUint32(0x30,3579545+0xc0000000,true);
  assert.throws(()=>selectPlaybackConfiguration(new Ym2612VGM(dual)),/Dual/);
  assert.throws(()=>extractMsxNotes(dual),/dual/);
 }
});
