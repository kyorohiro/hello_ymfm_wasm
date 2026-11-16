// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupYmSongPanel} from './song_panel.js';
import {createYmSongPlayer} from './song_player.js';
import {createYmCodeProject} from './code_project.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
  children=[];listeners=new Map();dataset={};value='';
  get options(){return this.children;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
  removeEventListener(type,listener){this.listeners.get(type)?.delete(listener);}
}
function setup(t) {
  const originalDocument=globalThis.document,nodes=new Map(),gate=deferred(),signals=[];
  globalThis.document={
    getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},
    createElement:()=>new Element(),
  };
  const project=createYmCodeProject();
  project.importFiles([
    {path:'/music/Original.ym',type:'binary',data:Uint8Array.of(1)},
    {path:'/music/Pending.ym',type:'binary',data:Uint8Array.of(2)},
  ]);
  let panel;
  const player=createYmSongPlayer({
    getAudio:()=>{throw Error('Selecting a source must stay passive');},
    createEngine:()=>{throw Error('Selecting a source must not create an engine');},
    prepareSource:async(bytes,{signal})=>{
      signals.push(signal);
      if(bytes[0]===2)await gate.promise;
      return {format:'ym',bytes,clock:2000000,metadata:{title:`Source ${bytes[0]}`},durationFrames:44100,subsongCount:1,defaultSubsong:1};
    },
    onState:state=>panel?.update(state),
  });
  panel=setupYmSongPanel({project,files:{ready:Promise.resolve()},player});
  t.after(()=>{panel.dispose();player.dispose();globalThis.document=originalDocument;});
  return {panel,player,project,gate,signals,nodes};
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
