// SPDX-License-Identifier: BSD-3-Clause
// Original register fixtures and real APU PCM. The host records scheduling;
// no AudioContext, audio device, game data or network request is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/gameboy_apu_wasm.js';
import {GameboyApuAudioEngine} from '../js/gameboyapuaudioengine.js';
import {createGameboySongPreview} from './song_preview.js';
import {createDmgSongFixture,DMG_SONG_END_FRAME} from '../../test/helpers/dmg_synth_song_fixture.mjs';

const RATE=44100,wasmBinary=await readFile(new URL('../generated/gameboy_apu_wasm.wasm',import.meta.url));
const nativeOptions={moduleFactory:factory,moduleOptions:{wasmBinary},outputSampleRate:RATE,masterVolume:1};
const stereo=frames=>({left:new Float32Array(frames),right:new Float32Array(frames)});
function host(){
  const starts=[],timers=new Map();let id=0;
  const context={currentTime:0,state:'running',async resume(){},
    createGain(){return{context,gain:{value:1},connect(){},disconnect(){}};},
    createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return{
      length,sampleRate,copyToChannel(value,ch){data[ch].set(value);},getChannelData(ch){return data[ch];}};},
    createBufferSource(){return{buffer:null,connect(){},disconnect(){},start(at,offset=0){this.at=at;this.offset=offset;starts.push(this);},stop(){this.stopped=true;}};},
  };
  return{context,starts,getAudio:()=>({context,songInputNode:{context}}),
    schedule(fn,ms){const key=++id;timers.set(key,{fn,at:context.currentTime+ms/1000});return key;},cancel(key){timers.delete(key);},
    advance(seconds){const end=context.currentTime+seconds;let count=0;
      for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;
        assert(++count<10000);timers.delete(next[0]);context.currentTime=next[1].at;next[1].fn();}
      context.currentTime=end;},
  };
}
async function setup(t){
  const f=host(),records=[],updates=[];
  // One stable host bus is needed for Resume identity checks.
  const output={context:f.context};
  const preview=createGameboySongPreview({getAudio:()=>({context:f.context,songInputNode:output}),beforePlay:async()=>{},
    schedule:f.schedule,cancel:f.cancel,nowMs:()=>0,yieldTask:async()=>{},onState:state=>updates.push({at:f.context.currentTime,state}),
    createEngine:async()=>{
      const engine=await GameboyApuAudioEngine.create(nativeOptions),record={engine,frames:0,writes:[],resets:0,disposed:0};records.push(record);
      const process=engine.processFrames.bind(engine),write=engine.writeGameboyApu.bind(engine),reset=engine.reset.bind(engine),dispose=engine.dispose.bind(engine);
      engine.processFrames=frames=>{const result=process(frames);record.frames+=frames;return result;};
      engine.writeGameboyApu=(register,value)=>{record.writes.push({frame:record.frames,register,value});return write(register,value);};
      engine.reset=()=>{record.frames=0;record.writes=[];record.resets++;return reset();};
      engine.dispose=()=>{record.disposed++;return dispose();};return engine;
    }});
  t.after(()=>preview.dispose());return{...f,preview,records,updates};
}
function scheduled(nodes,frames){
  const output=stereo(frames);let offset=0;
  for(const node of nodes){
    const first=Math.round(node.offset*RATE),length=Math.min(frames-offset,node.buffer.length-first);if(length<=0)continue;
    output.left.set(node.buffer.getChannelData(0).subarray(first,first+length),offset);
    output.right.set(node.buffer.getChannelData(1).subarray(first,first+length),offset);offset+=length;
  }
  assert.equal(offset,frames);return output;
}
async function direct(t,events,frames){
  const engine=await GameboyApuAudioEngine.create(nativeOptions);t.after(()=>engine.dispose());engine.reset();
  const output=stereo(frames);let offset=0;
  for(const event of events){
    if(event.frame>frames)break;
    if(event.frame>offset){const pcm=engine.processFrames(event.frame-offset);output.left.set(pcm.left,offset);output.right.set(pcm.right,offset);offset=event.frame;}
    engine.writeGameboyApu(event.register,event.value);
  }
  if(offset<frames){const pcm=engine.processFrames(frames-offset);output.left.set(pcm.left,offset);output.right.set(pcm.right,offset);}
  return output;
}
function originalEvents(fixture){return fixture.events.flatMap(event=>Array.from({length:event.writes.length/3},(_,i)=>({frame:event.frame,register:event.writes[i*3+1],value:event.writes[i*3+2]})));}

test('real APU direct interventions preserve all queued samples, stay below 60 ms and match the exact combined register timeline',async t=>{
  const source=createDmgSongFixture(),f=await setup(t);await f.preview.load(source.bytes);assert(await f.preview.play());
  f.advance(.12);const record=f.records[0],before=record.frames,snapshot=f.preview.read().liveState;
  const retained=f.starts.map(node=>({node,left:node.buffer.getChannelData(0).slice()}));
  f.preview.applyEdit({channel:0,changes:{'pulse.duty':.125,'pan.right':false}});
  assert.equal(record.frames,before,'changing a sound must not synthesize or skip frames');
  assert.equal(f.preview.read().interaction.registers[1]>>6,0);assert.equal(f.preview.read().interaction.registers[21]&1,0);
  const displayed=f.preview.read().liveState;
  assert.equal(displayed.positionFrames,snapshot.positionFrames);assert.equal(displayed.registers[1]>>6,0);assert.equal(displayed.registers[21]&1,0);
  for(let i=0;i<48;i++)if(i!==1&&i!==21)assert.equal(displayed.registers[i],snapshot.registers[i],'only deliberately edited fields may precede the audible position');
  for(const {node,left}of retained){assert(!node.stopped);assert.deepEqual(node.buffer.getChannelData(0),left);}
  f.preview.noteOn('manual-pulse',69,{channel:1});
  const frequency=Math.round(2048-4194304/(32*440)),head=f.preview.read().interaction;
  assert.equal(head.registers[8],frequency&255);assert.equal(head.registers[9]&7,frequency>>8);
  f.advance(.14);assert(f.preview.noteOff('manual-pulse'));
  f.preview.applyEdit({channel:2,changes:{'wave.samples':Array.from({length:32},(_,i)=>i%2?15:0)}});
  const nativeAfterEdit=record.frames;
  for(let i=0;i<1900&&f.preview.read().playing;i++){
    f.advance(.001);const state=f.preview.read();
    assert(record.frames-state.positionFrames<=.06*RATE,'including the internal player queue, latency remains bounded');
  }
  assert.equal(f.preview.read().playback,'ended');assert.equal(f.preview.read().positionFrames,DMG_SONG_END_FRAME);
  assert.equal(record.frames,DMG_SONG_END_FRAME);assert(record.frames>nativeAfterEdit);assert.equal(record.disposed,1);assert.equal(f.records.length,1);
  const actual=scheduled(f.starts,DMG_SONG_END_FRAME),expected=await direct(t,record.writes,DMG_SONG_END_FRAME);
  assert.deepEqual(actual,expected,'manual writes and every original VGM sample share one unbroken real-APU render');
  assert(actual.left.every(Number.isFinite)&&actual.right.every(Number.isFinite));assert(actual.left.some(value=>Math.abs(value)>.001));
  const nativeOriginal=await direct(t,originalEvents(source),DMG_SONG_END_FRAME);assert.notDeepEqual(actual,nativeOriginal,'the real PCM changed rather than only the UI metadata');
  const periodic=f.updates.filter(({at,state})=>at>.27&&at<1.5&&state.playing);
  for(let i=1;i<periodic.length;i++)assert(periodic[i].at-periodic[i-1].at>=.05-1e-9,'refill frequency does not increase DOM publication frequency');
});

test('real manual Pause/Resume preserves its exact heard prefix, while a successful seek rebuilds the original song and retires input identities',async t=>{
  const source=createDmgSongFixture(),f=await setup(t);await f.preview.load(source.bytes);await f.preview.play();f.advance(.1);
  f.preview.applyEdit({channel:0,changes:{'pulse.duty':.75}});f.preview.noteOn('paused-owner',64,{channel:2});f.advance(.03);
  assert(f.preview.pause());const paused=f.preview.read(),old=f.records[0],native=old.frames,mark=f.starts.length;
  assert.deepEqual(paused.interaction.voices,[]);assert.equal(f.preview.noteOff('paused-owner'),false);
  f.advance(1);assert.equal(old.frames,native);assert.equal(f.starts.length,mark);assert.deepEqual(f.preview.read().liveState,paused.liveState);
  assert(await f.preview.resume());
  const resumed=f.starts.slice(mark),first=resumed[0],frame=paused.positionFrames;
  assert.equal(first.at,f.context.currentTime+.01);assert.equal(first.offset*RATE%1,0);
  const count=Math.min(512,old.frames-frame),continued=scheduled(resumed,count),linear=await direct(t,old.writes,old.frames);
  assert.deepEqual(continued.left,linear.left.slice(frame,frame+count));assert.deepEqual(continued.right,linear.right.slice(frame,frame+count));
  assert(await f.preview.seek(.25));const destination=f.preview.read();assert(destination.playing);assert(destination.interaction.runId>paused.interaction.runId);
  assert.deepEqual(destination.interaction.voices,[]);assert.equal(destination.liveState.registers[1]>>6,1,'seek has original VGM settings, not the manual Duty override');
  const newMark=f.starts.length;f.advance(.08);
  const afterSeek=f.starts.slice(newMark);assert(afterSeek.length>0);
  const startFrame=Math.round((afterSeek[0].at-(f.context.currentTime-.08+.01))*RATE)+destination.positionFrames;
  const pcm=scheduled(afterSeek,afterSeek[0].buffer.length),original=await direct(t,originalEvents(source),startFrame+pcm.left.length);
  assert.deepEqual(pcm.left,original.left.slice(startFrame,startFrame+pcm.left.length));assert.deepEqual(pcm.right,original.right.slice(startFrame,startFrame+pcm.right.length));
});
