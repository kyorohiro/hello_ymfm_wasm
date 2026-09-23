import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {createPlaybackEngine,createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {createMsxNoteMonitor,describeMsxNotes,observeMsxNotes,extractMsxNotes} from '../docs/vgm_analyzer/msx_notes.js';

test('MSX live monitor sees actual player targets, survives mute/reset and matches exported pitches',async()=>{
 const bytes=await readSource(new URL('./fixtures/msx-ay-opll-audio-scc.vgz',import.meta.url));
 const header=new Ym2612VGM(bytes).header;
 const engine=await createPlaybackEngine(new Ym2612VGM(bytes),{getFactory:getNodePlaybackFactory});
 let monitor=createMsxNoteMonitor(header),writes=0,resets=0;
 observeMsxNotes(engine,()=>monitor,()=>writes++,()=>{monitor=createMsxNoteMonitor(header);resets++;});
 try{
  const player=createPlaybackPlayer(engine,bytes),score=extractMsxNotes(bytes);
  for(let run=0;run<2;run++){
   if(run){engine.setSccMuted(true);engine.setSccChannelMuted(0,true);player.reset();assert(describeMsxNotes(monitor).every(n=>!n.keyOn));}
   player.play();player.process(new Float32Array(1024),new Float32Array(1024),1024);
   const notes=describeMsxNotes(monitor);
   assert.equal(notes.filter(n=>n.keyOn).length,4);
   assert.deepEqual(notes.map(n=>n.name),score.channels.map(c=>c.name));
   notes.forEach((n,i)=>{if(n.keyOn)assert.equal(n.midi,score.channels[i].notes[0].midi);});
  }
  const before=describeMsxNotes(monitor);
  await seekPlayback(player,512,{yieldTask:async()=>{}});
  assert.deepEqual(describeMsxNotes(monitor),before);
  assert(writes>0);assert(resets>0);
 }finally{engine.dispose();}
});
