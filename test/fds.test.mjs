import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FdsAudio,fdsAddress} from '../docs/js/fds_audio.js';
import {NesApuAudioEngine} from '../docs/js/nesapuaudioengine.js';
import {renderSource} from '../cli/render.js';
import {exportSource,listSourceScoreChannels,inspectSourceSupport} from '../docs/vgm_analyzer/analyzer_core.js';
import {extractNesNotes,createNesMonitor,applyNesWrite,describeNesNotes} from '../docs/vgm_analyzer/nes_notes.js';
const source=new Uint8Array(readFileSync(new URL('./fixtures/fds-tone.vgm',import.meta.url)));
const writes=[];for(let i=256;source[i]===0xb4;i+=3)writes.push([source[i+1],source[i+2]]);
function program(chip){for(const [r,v] of writes)chip.write(r,v);}
test('FDS header, playback, six mutes, exports and live base pitch',async()=>{
 const score=extractNesNotes(source);assert.equal(score.channels.length,4);assert.equal(score.channels[3].name,'FDS');
 assert.equal(score.channels[3].notes.length,1);assert(Math.abs(score.channels[3].notes[0].midi-69)<.02);
 const monitor=createNesMonitor(true);for(const [r,v] of writes)applyNesWrite(monitor,r,v);
 assert.equal(describeNesNotes(monitor)[3].midi,score.channels[3].notes[0].midi);
 applyNesWrite(monitor,0x20,0x80);assert.equal(describeNesNotes(monitor)[3].keyOn,false);
 const result=await renderSource(source,{maxSeconds:.1});assert(result.bytes.subarray(44).some(v=>v!==0));
 const muted=await renderSource(source,{maxSeconds:.1,mute:['nes-ch-6']});const silent=source.slice();silent.set([0x61,0x22,0x56,0x66],256);
 const baseline=await renderSource(silent,{maxSeconds:.1});assert.deepEqual(muted.bytes,baseline.bytes);assert.notDeepEqual(result.bytes,muted.bytes);
 assert.equal(listSourceScoreChannels(source).channels[3].id,'fds');
 for(const format of ['midi','musicxml','lilypond'])assert.equal(exportSource(source,{format,bpm:120}).noteCount,1);
 assert.match(exportSource(source,{format:'musicxml',channels:['fds'],bpm:120}).text,/FDS/);
 const support=await inspectSourceSupport(source);assert.equal(support.exports.midi.status,'available');
});
test('fixNES FDS port handles wave protection, modulation force, envelope timing and reset',()=>{
 assert.equal(fdsAddress(0x3f),0x4023);assert.equal(fdsAddress(0x20),0x4080);assert.equal(fdsAddress(0x7f),0x407f);
 const f=new FdsAudio();f.write(0x40,63);assert.equal(f.wave[0],0);
 f.write(0x29,128);f.write(0x40,63);assert.equal(f.wave[0],63);
 f.write(0x3f,0);f.write(0x40,1);assert.equal(f.wave[0],63);f.write(0x3f,2);
 for(let i=0;i<32;i++)f.write(0x28,3);
 f.write(0x27,0x40);f.write(0x28,7);assert.equal(f.modulation[0],3);
 f.write(0x23,0);f.tick();assert.equal(f.modCounter,4,'force clocks modulation with zero mod frequency');
 f.write(0x2a,1);f.write(0x20,0x40);f.tick(16);assert.equal(f.volGain,0);f.tick();assert.equal(f.volGain,1);
 f.write(0x20,0);f.tick(17);assert.equal(f.volGain,0);
 f.write(0x2a,0);f.write(0x20,0x40);f.tick(1000);assert.equal(f.volGain,0);
 f.reset();program(f);f.tick();assert.equal(f.accumulator,1031*64);
 f.reset();program(f);f.write(0x25,16);f.write(0x24,0x90);f.tick();assert.equal(f.accumulator,1031*80);
 f.write(0x23,0x84);f.tick(20);assert.equal(f.accumulator,0);
 f.reset();assert.equal(f.freq,0);assert(f.wave.every(x=>!x));assert.equal(f.sample(),0);
});
test('FDS mute advances state; reset is deterministic and CLI seek matches full output',async()=>{
 const a=new NesApuAudioEngine({fds:true}),b=new NesApuAudioEngine({fds:true});
 try{
  for(const e of [a,b])for(const [r,v] of writes)e.writeNesApu(r,v);
  a.setChannelMuted(5,true);a.processFrames(2000);b.processFrames(2000);a.setChannelMuted(5,false);
  assert.deepEqual(a.processFrames(100),b.processFrames(100));
  a.reset();for(const [r,v] of writes)a.writeNesApu(r,v);const first=a.processFrames(200);
  a.reset();for(const [r,v] of writes)a.writeNesApu(r,v);assert.deepEqual(first,a.processFrames(200));
 }finally{a.dispose();b.dispose();}
 const full=await renderSource(source,{maxSeconds:.1}),part=await renderSource(source,{startSeconds:.02,maxSeconds:.03});
 assert.deepEqual(part.bytes.subarray(44),full.bytes.subarray(44+882*4,44+2205*4));
 const dual=source.slice();new DataView(dual.buffer,dual.byteOffset,dual.byteLength).setUint32(0x84,0xc01b4f4d,true);
 await assert.rejects(renderSource(dual),/Dual/);assert.throws(()=>extractNesNotes(dual),/dual/);
});
