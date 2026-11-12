import test from 'node:test';
import assert from 'node:assert/strict';
import {createVgmLibrary} from './vgm_library.js';
class Element {
  constructor(){this.listeners={};this.dataset={};this.children=[];this.textContent='';}
  addEventListener(type,fn){this.listeners[type]=fn;} async fire(type){await this.listeners[type]?.({});}
  replaceChildren(...nodes){this.children=nodes;}append(...nodes){this.children.push(...nodes);}setAttribute(){}blur(){}click(){}
}
function fixture(t,options){
  const ids=['vgmStatus','vgmLibrary','vgmFileName','vgmPage','vgmPrevious','vgmNext','vgmVoices','vgmWarnings','loadVgm','vgmFileInput','cancelVgm','closeVgm'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const doc=globalThis.document;globalThis.document={createElement:()=>new Element()};t.after(()=>{globalThis.document=doc;});
  const root={querySelector:id=>nodes[id.slice(1)],querySelectorAll:()=>[]};
  const library=createVgmLibrary({root,onSelect:()=>assert.fail('Import never applies a sound'),...options});t.after(()=>library.dispose());
  return {nodes,async read(name,bytes){nodes.vgmFileInput.files=[{name,size:bytes.length,arrayBuffer:async()=>bytes.buffer}];await nodes.vgmFileInput.fire('change');},library};
}
const result={voices:[{id:0,kind:'wave',channel:3,firstTime:0,occurrences:1,preset:{name:'Wave'}}],warnings:[]};

test('DMG VGM raw storage is independent of zero static voices and keeps exact compressed bytes',async t=>{
  const sources=[];const f=fixture(t,{extract:async()=>{throw Error('No complete, audible Game Boy voices found');},onSource:async(source,{isCurrent})=>{assert(isCurrent());sources.push(source);return '/vgm/song.vgz';}});
  const bytes=Uint8Array.of(31,139,8,255);await f.read('song.vgz',bytes);
  assert.equal(sources.length,1);assert.deepEqual(sources[0],{name:'song.vgz',bytes});
  assert.match(f.nodes.vgmStatus.textContent,/sound list kept.*saved to \/vgm\/song.vgz/);
});

test('DMG VGM extraction continues when the project is full; invalid input keeps the previous sound list',async t=>{
  let valid=true;const f=fixture(t,{extract:async()=>{if(!valid)throw Error('Invalid VGM');return result;},onSource:async()=>{throw Error('16 MiB cassette limit');}});
  await f.read('good.vgm',Uint8Array.of(1));assert.equal(f.nodes.vgmFileName.textContent,'good.vgm');
  assert.match(f.nodes.vgmStatus.textContent,/1 sounds found.*not saved to Files.*16 MiB/);
  valid=false;await f.read('bad.vgm',Uint8Array.of(0));assert.equal(f.nodes.vgmFileName.textContent,'good.vgm');assert.match(f.nodes.vgmStatus.textContent,/Invalid VGM.*kept/);
});

test('cancelled DMG VGM analysis never stores a late raw source or replaces the old library',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve),saved=[];
  const f=fixture(t,{extract:async()=>{await gate;return result;},onSource:async source=>saved.push(source)});
  const reading=f.read('slow.vgm',Uint8Array.of(1));await Promise.resolve();await f.nodes.cancelVgm.fire('click');release();await reading;
  assert.deepEqual(saved,[]);assert.match(f.nodes.vgmStatus.textContent,/cancelled/);
});
