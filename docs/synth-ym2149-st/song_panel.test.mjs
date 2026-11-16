// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupYmSongPanel} from './song_panel.js';
import {createYmSongPlayer} from './song_player.js';
import {createYmCodeProject} from './code_project.js';
import {ymMusicEntries} from './music_files.js';
import {fakeAudio} from '../synth-huc6280/song_test_helpers.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
  children=[];listeners=new Map();dataset={};value='';
  get options(){return this.children;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
  removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
  dispatch(type){for(const listener of this.listeners.get(type)??[])listener({target:this});}
  blur(){}
}
function setup(t,{playback=false}={}) {
  const originalDocument=globalThis.document,nodes=new Map(),gate=deferred(),signals=[],graph=fakeAudio(),engines=[],imports=[];
  globalThis.document={
    getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},
    createElement:()=>new Element(),
  };
  const project=createYmCodeProject();
  project.importFiles([
    {path:'/music/Original.ym',type:'binary',data:Uint8Array.of(1)},
    {path:'/music/Pending.ym',type:'binary',data:Uint8Array.of(2)},
  ]);
  let panel,audioRequests=0;
  const player=createYmSongPlayer({
    getAudio:()=>{audioRequests++;if(!playback)throw Error('Selecting a source must stay passive');return graph.audio;},
    createEngine:()=>{
      if(!playback)throw Error('Selecting a source must not create an engine');
      const engine={disposed:false,sampleRate:()=>44100,
        processFrames:count=>({left:new Float32Array(count),right:new Float32Array(count)}),
        snapshot:()=>({registers:new Uint8Array(16)}),dispose(){this.disposed=true;}};
      engines.push(engine);return engine;
    },
    prepareSource:async(bytes,{signal})=>{
      signals.push(signal);
      if(bytes[0]===2)await gate.promise;
      return {format:'ym',bytes,clock:2000000,metadata:{title:`Source ${bytes[0]}`},durationFrames:44100,subsongCount:1,defaultSubsong:1};
    },
    schedule:graph.schedule,cancel:graph.cancel,
    onState:state=>panel?.update(state),
  });
  panel=setupYmSongPanel({project,files:{ready:Promise.resolve(),async importMusicSources(sources,{isCurrent}) {
    if(!isCurrent())return [];
    imports.push(sources);
    const entries=ymMusicEntries(project,sources);project.importFiles(entries);return entries.map(entry=>entry.path);
  }},player});
  t.after(()=>{panel.dispose();player.dispose();globalThis.document=originalDocument;});
  return {panel,player,project,gate,signals,nodes,graph,engines,imports,audioRequests:()=>audioRequests};
}

test('deleting a source during preparation cancels that selection and keeps the previous song',async t=>{
  const f=setup(t);await f.panel.ready;
  await f.panel.select('/music/Original.ym');
  const selecting=f.panel.select('/music/Pending.ym');
  const cancelled=assert.rejects(selecting,{name:'AbortError'});
  f.project.fs.remove('/music/Pending.ym');
  f.gate.resolve();await cancelled;
  assert.equal(f.signals.at(-1).aborted,true);
  assert.equal(f.panel.selectedPath,'/music/Original.ym');
  assert.equal(f.nodes.get('ymSongSelect').value,'/music/Original.ym');
  assert.equal(f.player.read().name,'Original.ym');
  assert.equal(f.player.read().metadata.title,'Source 1');
  assert.equal(f.player.read().busy,false);
});

test('replacing a pending source cancels old bytes and allows selecting the new revision',async t=>{
  const f=setup(t);await f.panel.ready;
  await f.panel.select('/music/Original.ym');
  const selecting=f.panel.select('/music/Pending.ym');
  const cancelled=assert.rejects(selecting,{name:'AbortError'});
  f.project.importFiles([{path:'/music/Pending.ym',type:'binary',data:Uint8Array.of(3)}]);
  assert.equal(f.signals.at(-1).aborted,true);
  await cancelled;
  assert.equal(f.player.read().metadata.title,'Source 1');
  await f.panel.select('/music/Pending.ym');
  assert.equal(f.player.read().metadata.title,'Source 3');
  f.gate.resolve();await flush();
  assert.equal(f.panel.selectedPath,'/music/Pending.ym');
  assert.equal(f.player.read().metadata.title,'Source 3');
});

test('disposing the panel cancels preparation before it can replace the previous song',async t=>{
  const f=setup(t);await f.panel.ready;
  await f.panel.select('/music/Original.ym');
  const selecting=f.panel.select('/music/Pending.ym');
  const cancelled=assert.rejects(selecting,{name:'AbortError'});
  f.panel.dispose();f.gate.resolve();await cancelled;
  assert.equal(f.player.read().metadata.title,'Source 1');
  assert.equal(f.player.read().busy,false);
});

test('reset unloads a paused song and clears selection, seeking and sticky errors without changing the device',async t=>{
  const f=setup(t,{playback:true});await f.panel.ready;
  await f.panel.select('/music/Original.ym');await f.player.play();f.graph.tick(0.03);f.player.pause();
  assert.equal(f.player.read().paused,true);
  const seek=f.nodes.get('ymSongSeek');seek.dispatch('pointerdown');seek.value='0.5';
  const select=f.nodes.get('ymSongSelect');select.value='/music/Missing.ym';select.dispatch('change');await flush();
  assert.match(f.nodes.get('ymSongStatus').textContent,/Choose a binary music file/);
  f.nodes.get('ymMusicInput').value='previous-file.ym';
  const oldFiles=f.project.snapshot().filesystem;

  assert.equal(f.panel.reset(),true);
  const state=f.player.read();
  assert.equal(state.loaded,false);assert.equal(state.paused,false);assert.equal(state.busy,false);
  assert.equal(state.name,'');assert.equal(state.metadata,null);assert.equal(state.liveState,null);assert.equal(state.positionFrames,0);
  assert.equal(f.panel.selectedPath,'');assert.equal(select.value,'');assert.equal(seek.value,'0');
  assert.equal(f.nodes.get('ymMusicInput').value,'');
  assert.equal(f.nodes.get('ymSongPanel').dataset.error,'false');
  assert.equal(f.nodes.get('ymSongStatus').textContent,'Import music from Menu…');
  assert.equal(f.nodes.get('ymSongPlay').disabled,true);assert.equal(f.nodes.get('ymSongSeek').disabled,true);
  assert.deepEqual(f.project.snapshot().filesystem,oldFiles);
  assert.equal(f.engines[0].disposed,true);assert.equal(f.graph.timers.size,0);
  assert.equal(f.graph.context.state,'running');assert.equal(f.graph.context.closes,0);
  assert.equal(f.graph.audio.master.gain.value,0.7);assert.equal(f.audioRequests(),1);

  f.project.restore(createYmCodeProject().snapshot());f.panel.update();
  assert.equal(select.options.length,1);assert.equal(select.options[0].textContent,'Import music from Menu…');
  assert.equal(select.value,'');assert.equal(f.panel.selectedPath,'');
  assert.equal(f.nodes.get('ymSongPanel').dataset.error,'false');
  f.panel.dispose();assert.equal(f.panel.reset(),false);
});

test('reset cancels a late song preparation before it can own the new workspace',async t=>{
  const f=setup(t);await f.panel.ready;
  await f.panel.select('/music/Original.ym');
  const selecting=f.panel.select('/music/Pending.ym'),cancelled=assert.rejects(selecting,{name:'AbortError'});
  f.panel.reset();f.project.restore(createYmCodeProject().snapshot());
  assert.equal(f.signals.at(-1).aborted,true);
  f.gate.resolve();await cancelled;await flush();
  assert.equal(f.panel.selectedPath,'');assert.equal(f.nodes.get('ymSongSelect').value,'');
  assert.equal(f.player.read().loaded,false);assert.equal(f.player.read().busy,false);
  assert.equal(f.project.listEntries().length,0);assert.equal(f.audioRequests(),0);
  assert.equal(f.nodes.get('ymSongPanel').dataset.error,'false');
});

test('reset fences an old file read and still permits the next passive music import',async t=>{
  const f=setup(t);await f.panel.ready;
  const reading=deferred(),input=f.nodes.get('ymMusicInput');
  input.files=[{name:'Old.ym',size:1,arrayBuffer:()=>reading.promise}];input.dispatch('change');
  f.panel.reset();f.project.restore(createYmCodeProject().snapshot());
  reading.resolve(Uint8Array.of(3).buffer);await flush();
  assert.equal(f.imports.length,0);assert.equal(f.project.listEntries().length,0);
  assert.equal(f.player.read().loaded,false);assert.equal(f.panel.selectedPath,'');

  input.files=[{name:'New.ym',size:1,arrayBuffer:async()=>Uint8Array.of(3).buffer}];input.dispatch('change');await flush();
  assert.equal(f.imports.length,1);assert.equal(f.project.fs.get('/music/New.ym').data[0],3);
  assert.equal(f.panel.selectedPath,'/music/New.ym');assert.equal(f.player.read().name,'New.ym');
  assert.equal(f.player.read().metadata.title,'Source 3');assert.equal(f.audioRequests(),0);
});

test('a failed old file read cannot restore its error after reset',async t=>{
  const f=setup(t);await f.panel.ready;
  const reading=deferred(),input=f.nodes.get('ymMusicInput');
  input.files=[{name:'Old.ym',size:1,arrayBuffer:()=>reading.promise}];input.dispatch('change');
  f.panel.reset();reading.reject(new Error('Old read failed'));await flush();f.panel.update();
  assert.equal(f.nodes.get('ymSongPanel').dataset.error,'false');
  assert.equal(f.nodes.get('ymSongStatus').textContent,'Import music from Menu…');
  assert.equal(f.imports.length,0);assert.equal(f.player.read().loaded,false);
});
