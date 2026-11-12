// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {setupGameboyVgmImport} from './vgm_library.js';
import {MAX_VGM_BYTES} from './vgm_import.js';
import {createDmgSongFixture} from '../../test/helpers/dmg_synth_song_fixture.mjs';

class Element {
  constructor(){this.listeners=new Map();this.dataset={};this.textContent='';this.value='';this.clicks=0;this.blurs=0;}
  addEventListener(type,fn,{signal}={}){
    if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);
    signal?.addEventListener('abort',()=>this.listeners.get(type).delete(fn),{once:true});
  }
  async fire(type){for(const fn of this.listeners.get(type)??[])await fn({});}
  blur(){this.blurs++;}click(){this.clicks++;}
}
const result={voices:[{id:1,kind:'wave',channel:3,firstTime:0,occurrences:1,preset:{name:'Wave'}}],warnings:[]};
const saved={paths:['/presets/song/Wave.json'],directory:'/presets/song'};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,options={}){
  const ids=['vgmStatus','loadVgm','vgmFileInput','cancelVgm'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const root={dataset:{},querySelector:id=>nodes[id.slice(1)]},statuses=[];
  const importer=setupGameboyVgmImport({root,onSource:async()=>'/vgm/song.vgm',onSounds:async()=>saved,
    extract:async()=>result,onStatus:value=>statuses.push(value),...options});
  t.after(()=>importer.dispose());
  return{nodes,root,importer,statuses,
    async read(name,bytes,overrides={}){
      nodes.vgmFileInput.files=[{name,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),...overrides}];
      await nodes.vgmFileInput.fire('change');
    }};
}

test('VGM import stores exact original compressed bytes and one sound batch without applying, opening Code or requesting audio',async t=>{
  const calls=[],raw=Uint8Array.of(0,31,139,8,255,0).subarray(1,5);
  const f=fixture(t,{extract:async bytes=>{assert.deepEqual(bytes,raw);calls.push('extract');return{...result,warnings:['A source warning.']};},
    onSource:async(source,{isCurrent})=>{assert(isCurrent());assert.deepEqual(source,{name:'song.vgz',bytes:raw});calls.push('source');return'/vgm/song.vgz';},
    onSounds:async(sounds,{isCurrent})=>{assert(isCurrent());assert.deepEqual(sounds,{name:'song.vgz',voices:result.voices});calls.push('sounds');return saved;},
    onSelect:()=>assert.fail('No instrument application is part of import')});
  assert.deepEqual(Object.keys(f.importer).sort(),['cancel','dispose']);
  await f.nodes.loadVgm.fire('click');assert.equal(f.nodes.vgmFileInput.clicks,1);
  await f.read('song.vgz',raw);assert.deepEqual(calls,['extract','source','sounds']);
  assert.match(f.nodes.vgmStatus.textContent,/saved to \/vgm\/song.vgz.*1 sound saved to \/presets\/song.*Choose a preset in Files.*source warning.*Current instrument kept/);
  assert.equal(f.nodes.vgmStatus.dataset.error,'false');assert.equal(f.root.dataset.loading,'false');assert.equal(f.nodes.cancelVgm.hidden,true);
  assert.equal(f.nodes.vgmFileInput.value,'');assert.equal(f.statuses.at(-1),f.nodes.vgmStatus.textContent);
});

test('real static extraction saves all source voices as one passive batch',async t=>{
  const source=createDmgSongFixture();let sounds;
  const f=fixture(t,{extract:undefined,onSounds:async value=>{sounds=value;return{paths:value.voices.map((_,i)=>`/presets/original/${i}.json`),directory:'/presets/original'};}});
  await f.read('original.vgm',source.bytes);assert.equal(sounds.name,'original.vgm');assert.equal(sounds.voices.length,6);
  assert.deepEqual(new Set(sounds.voices.map(voice=>voice.kind)),new Set(['pulse','wave','noise']));
  assert.match(f.nodes.vgmStatus.textContent,/6 sounds saved/);
});

test('raw storage failure still attempts the independent sound batch and reports both outcomes',async t=>{
  let batches=0;
  const f=fixture(t,{onSource:async()=>{throw Error('16 MiB source limit');},onSounds:async()=>{batches++;return saved;}});
  await f.read('song.vgm',Uint8Array.of(1));assert.equal(batches,1);
  assert.match(f.nodes.vgmStatus.textContent,/source not saved.*16 MiB source limit.*1 sound saved.*Current instrument kept/);
  assert.equal(f.nodes.vgmStatus.dataset.error,'true');
});

test('sound-batch capacity failure preserves the saved source and reports no fake saved sounds',async t=>{
  const sources=[];
  const f=fixture(t,{onSource:async source=>{sources.push(source);return'/vgm/song.vgm';},onSounds:async()=>{throw Error('16 MiB cassette limit');}});
  await f.read('song.vgm',Uint8Array.of(1,2));assert.equal(sources.length,1);
  assert.match(f.nodes.vgmStatus.textContent,/source saved.*Extracted sounds not saved.*16 MiB cassette limit.*Current instrument kept/);
  assert.doesNotMatch(f.nodes.vgmStatus.textContent,/1 sound saved/);assert.equal(f.nodes.vgmStatus.dataset.error,'true');
});

test('zero voices or extraction errors still retain the exact raw file and never invoke sound persistence',async t=>{
  let sources=0,fail=false;
  const f=fixture(t,{extract:async()=>{if(fail)throw Error('No complete, audible Game Boy voices found');return{voices:[],warnings:[]};},
    onSource:async()=>{sources++;return'/vgm/raw.vgz';},onSounds:()=>assert.fail('No sounds can be saved')});
  await f.read('raw.vgz',Uint8Array.of(31,139));assert.equal(sources,1);
  assert.match(f.nodes.vgmStatus.textContent,/source saved.*No static sounds found.*Current instrument kept/);
  assert.equal(f.nodes.vgmStatus.dataset.error,'false');
  fail=true;await f.read('raw.vgz',Uint8Array.of(31,139));assert.equal(sources,2);
  assert.match(f.nodes.vgmStatus.textContent,/source saved.*Sound extraction failed.*No complete.*Current instrument kept/);
  assert.equal(f.nodes.vgmStatus.dataset.error,'true');
});

test('declared and actual 64 MiB limits are checked before extraction or any storage',async t=>{
  let reads=0;const f=fixture(t,{extract:()=>assert.fail('Oversize extraction'),onSource:()=>assert.fail('Oversize source storage'),onSounds:()=>assert.fail('Oversize sound storage')});
  await f.read('oversize.vgm',Uint8Array.of(1),{size:MAX_VGM_BYTES+1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(1);}});
  assert.equal(reads,0);assert.match(f.nodes.vgmStatus.textContent,/at most 64 MiB.*Current instrument kept/);
  await f.read('wrong-size.vgm',Uint8Array.of(1),{size:1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(MAX_VGM_BYTES+1);}});
  assert.equal(reads,1);assert.match(f.nodes.vgmStatus.textContent,/at most 64 MiB/);
  assert.equal(f.root.dataset.loading,'false');assert(f.nodes.cancelVgm.hidden);
});

test('Cancel during file reading or extraction prevents every late storage callback',async t=>{
  for(const phase of ['read','extract']){
    const gate=deferred();let extractCalls=0,sources=0,sounds=0,signal;
    const f=fixture(t,{extract:async(_,{signal:received})=>{extractCalls++;signal=received;if(phase==='extract')await gate.promise;return result;},
      onSource:async()=>{sources++;return'/vgm/song.vgm';},onSounds:async()=>{sounds++;return saved;}});
    const reading=f.read('slow.vgm',Uint8Array.of(1),phase==='read'?{arrayBuffer:()=>gate.promise}:{});
    await turn();assert.equal(f.root.dataset.loading,'true');assert.equal(f.nodes.cancelVgm.hidden,false);
    await f.nodes.cancelVgm.fire('click');gate.resolve(new ArrayBuffer(1));await reading;
    assert.equal(extractCalls,phase==='read'?0:1);if(signal)assert(signal.aborted);
    assert.equal(sources,0);assert.equal(sounds,0);assert.match(f.nodes.vgmStatus.textContent,/cancelled.*Current instrument kept/);
    assert.equal(f.root.dataset.loading,'false');assert(f.nodes.cancelVgm.hidden);
  }
});

test('Cancel after extraction gates pending source and sound commits and cannot replace its status with late success',async t=>{
  for(const phase of ['source','sounds']){
    const gate=deferred(),commits=[];let lateGuard,soundCalls=0;
    const f=fixture(t,{onSource:async(_,{isCurrent})=>{if(phase==='source'){lateGuard=isCurrent;await gate.promise;}if(isCurrent())commits.push('source');return'/vgm/song.vgm';},
      onSounds:async(_,{isCurrent})=>{soundCalls++;lateGuard=isCurrent;await gate.promise;if(isCurrent())commits.push('sounds');return saved;}});
    const reading=f.read('slow.vgm',Uint8Array.of(1));await turn();assert(lateGuard());
    f.importer.cancel();assert(!lateGuard());const cancelled=f.nodes.vgmStatus.textContent;gate.resolve();await reading;
    assert.equal(soundCalls,phase==='source'?0:1);assert.deepEqual(commits,phase==='source'?[]:['source']);
    assert.equal(f.nodes.vgmStatus.textContent,cancelled);assert.match(cancelled,/cancelled/);
  }
});

test('latest selected file wins across delayed reads and extraction without old busy/status cleanup',async t=>{
  const first=deferred(),second=deferred(),sources=[],sounds=[];
  const f=fixture(t,{extract:async bytes=>{if(bytes[0]===1)await first.promise;if(bytes[0]===2)await second.promise;return result;},
    onSource:async source=>{sources.push(source.name);return`/vgm/${source.name}`;},onSounds:async value=>{sounds.push(value.name);return saved;}});
  const old=f.read('old.vgm',Uint8Array.of(1));await turn();
  const current=f.read('new.vgm',Uint8Array.of(2));await turn();first.resolve();await old;
  assert.equal(f.root.dataset.loading,'true');assert.equal(f.nodes.cancelVgm.hidden,false);
  assert.match(f.nodes.vgmStatus.textContent,/Reading new.vgm/);assert.deepEqual(sources,[]);
  second.resolve();await current;assert.deepEqual(sources,['new.vgm']);assert.deepEqual(sounds,['new.vgm']);
  assert.match(f.nodes.vgmStatus.textContent,/\/vgm\/new.vgm/);assert.equal(f.root.dataset.loading,'false');
});

test('dispose invalidates pending callbacks, removes controls listeners and never publishes a late status',async t=>{
  const gate=deferred(),f=fixture(t,{extract:async()=>{await gate.promise;return result;},onSource:()=>assert.fail('Disposed source write'),onSounds:()=>assert.fail('Disposed sound write')});
  const reading=f.read('old.vgm',Uint8Array.of(1));await turn();const statuses=f.statuses.length;
  f.importer.dispose();gate.resolve();await reading;
  assert.equal(f.statuses.length,statuses);assert.equal(f.root.dataset.loading,'false');assert(f.nodes.cancelVgm.hidden);
  await f.nodes.loadVgm.fire('click');assert.equal(f.nodes.vgmFileInput.clicks,0);
});
