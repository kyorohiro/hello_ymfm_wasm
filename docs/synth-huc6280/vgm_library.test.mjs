// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createVgmLibrary} from './vgm_library.js';
import {createDefaultPreset} from './preset.js';
import {MAX_VGM_BYTES} from './vgm_import.js';

class Element{
  constructor(){this.listeners=new Map();this.dataset={};this.children=[];this.textContent='';this.value='';this.checked=true;this.clicks=0;}
  addEventListener(type,fn,{signal}={}){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);signal?.addEventListener('abort',()=>this.listeners.get(type).delete(fn),{once:true});}
  async fire(type){for(const fn of this.listeners.get(type)??[])await fn({});}
  append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(key,value){this[key]=value;}
  blur(){}click(){this.clicks++;}
}
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const voice=()=>({id:1,kind:'wave',channel:1,firstTime:0,occurrences:1,preset:createDefaultPreset()});
function vgm(commands){
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);view.setUint32(0xa4,3579545,true);bytes.set(commands,256);return bytes;
}
function fixture(t,options={}){
  const ids=['vgmStatus','vgmLibrary','vgmKeepLoudestPcm','vgmWarnings','vgmFileName','vgmPage','vgmPrevious','vgmNext','vgmVoices','loadVgm','vgmFileInput','cancelVgm','closeVgm'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()])),doc={createElement:()=>new Element()},root={ownerDocument:doc,querySelector:id=>nodes[id.slice(1)],querySelectorAll:()=>[]};
  const library=createVgmLibrary({root,onSelect:()=>assert.fail('Import does not select a sound'),extract:async()=>({voices:[voice()],warnings:[]}),...options});
  t.after(()=>library.dispose());
  return{nodes,library,async read(name,bytes,overrides={}){nodes.vgmFileInput.files=[{name,size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer,...overrides}];await nodes.vgmFileInput.fire('change');}};
}

test('validated VGM source callback keeps exact original bytes and never applies the extracted instrument',async t=>{
  const raw=Uint8Array.of(31,139,8,255),events=[];
  const f=fixture(t,{extract:async(bytes,options)=>{assert.deepEqual(new Uint8Array(bytes),raw);assert.equal(options.allowEmpty,true);events.push('extract');return{voices:[voice()],warnings:[]};},
    onSource:async(source,{isCurrent,signal})=>{assert.deepEqual(source,{name:'original.vgz',bytes:raw});assert(isCurrent());assert(!signal.aborted);events.push('source');return'/vgm/original.vgz';}});
  await f.read('original.vgz',raw);assert.deepEqual(events,['extract','source']);
  assert.match(f.nodes.vgmStatus.textContent,/1 sounds found.*saved to \/vgm\/original.vgz.*Current instrument kept/);
  assert.equal(f.nodes.vgmStatus.dataset.error,'false');assert.equal(f.nodes.vgmVoices.children.length,1);
});

test('source copy failure reports independent Files failure and preserves selectable extracted sounds',async t=>{
  let selected=0;const f=fixture(t,{onSource:async()=>{throw Error('16 MiB cassette limit');},onSelect:async()=>{selected++;}});
  await f.read('large.vgm',Uint8Array.of(1));
  assert.match(f.nodes.vgmStatus.textContent,/1 sounds found.*Extracted sounds remain available.*not saved to Files.*16 MiB/);
  assert.doesNotMatch(f.nodes.vgmStatus.textContent,/VGM import failed/);assert.equal(f.nodes.vgmStatus.dataset.error,'true');
  await f.nodes.vgmVoices.children[0].fire('click');assert.equal(selected,1);
});

test('voice selection waits for host acknowledgement even when the native preset is already visible',async t=>{
  const acknowledgement=deferred();let nativePreset=null;
  const f=fixture(t,{onSelect:async preset=>{nativePreset=preset;await acknowledgement.promise;}});
  await f.read('voice.vgm',Uint8Array.of(1));
  const button=f.nodes.vgmVoices.children[0],selecting=button.fire('click');
  await turn();
  assert.deepEqual(nativePreset,voice().preset,'the engine can publish its preset before the host completes');
  assert.equal(button['aria-pressed'],'false','the selection remains pending until the full host operation is acknowledged');
  acknowledgement.resolve();await selecting;
  assert.equal(f.nodes.vgmVoices.children[0]['aria-pressed'],'true');
  assert.match(f.nodes.vgmStatus.textContent,/loaded/);
});

test('a valid timed VGM with unknown Wave RAM is retained without extractable static voices',async t=>{
  const bytes=vgm([0xb9,0,0,0xb9,1,255,0xb9,5,255,0xb9,4,0x9f,0x61,100,0,0x66]);
  let copied=0;const f=fixture(t,{extract:undefined,onSource:async source=>{copied++;assert.deepEqual(source.bytes,bytes);return'/vgm/silent.vgm';}});
  await f.read('silent.vgm',bytes);assert.equal(copied,1);assert.equal(f.nodes.vgmVoices.children.length,0);
  assert.match(f.nodes.vgmStatus.textContent,/0 sounds found.*Reference song saved/);assert.equal(f.nodes.vgmStatus.dataset.error,'false');
});

test('an unusable zero-static missing-bank source keeps the prior library and never copies or applies',async t=>{
  const copies=[];let selected=0;
  const f=fixture(t,{extract:undefined,onSource:async source=>{copies.push(source.name);return'/vgm/'+source.name;},onSelect:async()=>selected++});
  const good=vgm([0xb9,1,255,0xb9,0,4,0xb9,5,255,0xb9,7,0x90,0xb9,4,0x9f,0x61,100,0,0x66]);
  await f.read('previous.vgm',good);assert.equal(f.nodes.vgmVoices.children.length,1);await f.nodes.vgmVoices.children[0].fire('click');assert.equal(selected,1);
  const previous=f.nodes.vgmVoices.children[0];
  const bad=vgm([0x90,0,0x1b,0,6,0x91,0,5,1,0,0x92,0,0x44,0xac,0,0,0x95,0,0,0,0,0x61,100,0,0x66]);
  await f.read('missing-bank.vgm',bad);
  assert.match(f.nodes.vgmStatus.textContent,/VGM import failed:.*missing data block.*Current sound kept/);
  assert.equal(f.nodes.vgmFileName.textContent,'previous.vgm');assert.equal(f.nodes.vgmVoices.children[0],previous);
  assert.deepEqual(copies,['previous.vgm']);assert.equal(selected,1,'No new instrument request or gate change occurs');
});

test('cancelled zero-static validation cannot publish a library or copy a late source',async t=>{
  const gate=deferred();let sourceCalls=0,signal;
  const f=fixture(t,{extract:async()=>({voices:[],warnings:[]}),prepareSong:async(_,{signal:received})=>{signal=received;await gate.promise;},onSource:async()=>{sourceCalls++;return'/vgm/late.vgm';}});
  const loading=f.read('late.vgm',Uint8Array.of(1));await turn();await f.nodes.cancelVgm.fire('click');assert(signal.aborted);gate.resolve();await loading;
  assert.equal(sourceCalls,0);assert.equal(f.nodes.vgmFileName.textContent,'');assert.match(f.nodes.vgmStatus.textContent,/cancelled/);
});

test('invalid or oversized input never reaches source storage',async t=>{
  let copies=0,reads=0;const f=fixture(t,{extract:undefined,onSource:async()=>copies++});
  await f.read('invalid.vgm',Uint8Array.of(1,2));assert.equal(copies,0);assert.match(f.nodes.vgmStatus.textContent,/VGM import failed/);
  await f.read('oversize.vgm',Uint8Array.of(1),{size:MAX_VGM_BYTES+1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(1);}});assert.equal(reads,0);
  await f.read('wrong-size.vgm',Uint8Array.of(1),{size:1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(MAX_VGM_BYTES+1);}});assert.equal(reads,1);assert.equal(copies,0);
});

test('newer selections and Cancel invalidate source callbacks and preserve their latest status',async t=>{
  const slow=deferred(),copied=[];let oldGuard;
  const f=fixture(t,{onSource:async(source,{isCurrent})=>{if(source.name==='slow.vgm'){oldGuard=isCurrent;await slow.promise;}if(isCurrent())copied.push(source.name);return'/vgm/'+source.name;}});
  const old=f.read('slow.vgm',Uint8Array.of(1));await turn();assert(oldGuard());
  await f.read('fast.vgm',Uint8Array.of(2));assert(!oldGuard());const latest=f.nodes.vgmStatus.textContent;slow.resolve();await old;
  assert.deepEqual(copied,['fast.vgm']);assert.equal(f.nodes.vgmStatus.textContent,latest);
  const gate=deferred();let guard;const cancelled=fixture(t,{onSource:async(_,{isCurrent})=>{guard=isCurrent;await gate.promise;return'/vgm/cancel.vgm';}});
  const waiting=cancelled.read('cancel.vgm',Uint8Array.of(3));await turn();await cancelled.nodes.cancelVgm.fire('click');assert(!guard());gate.resolve();await waiting;
  assert.match(cancelled.nodes.vgmStatus.textContent,/cancelled.*Current sound kept/);
});
