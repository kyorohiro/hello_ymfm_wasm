// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {SynthInstrument} from './instrument.js';
import {createScspCodeClient} from './code_endpoint.js';
import {createScspCodeProject} from './code_project.js';
import {SCSP_CYCLE2_CODE} from './code_examples.js';

test('Cycle source is readable, byte-exact in fresh Files and preserves saved user files without autoplay',async()=>{
  const source=await readFile(new URL('./examples/cycle2.js',import.meta.url),'utf8');
  assert.equal(SCSP_CYCLE2_CODE,source);
  const fresh=createScspCodeProject({getStarterCode:()=> '// same starter'});
  assert.equal(fresh.fs.get('/index.js').data,'// same starter');
  assert.equal(fresh.fs.get('/examples/cycle2.js').data,source);
  fresh.fs.writeText('/examples/cycle2.js','// my edited Cycle');
  const copy=createScspCodeProject({snapshot:fresh.snapshot(),getStarterCode:()=>assert.fail('No reseed')});
  assert.equal(copy.fs.get('/examples/cycle2.js').data,'// my edited Cycle');
  const old=createScspCodeProject();
  const restored=createScspCodeProject({snapshot:old.snapshot(),getStarterCode:()=>assert.fail('No reseed')});
  assert(!restored.fs.has('/examples/cycle2.js'),'existing snapshots remain user-owned');
});

test('actual Cycle example uses the borrowed Code client and real WASM; Apply keeps knob edits and beat intervals',async t=>{
  const module=await factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const owner=new SynthInstrument(await Scsp.create({moduleFactory:()=>module}));
  t.after(()=>owner.dispose());
  const metadata=owner.beginCode(),calls=[],prepared=new Map(),loops=new Map(),beats=[];
  let peak=0;
  const client=createScspCodeClient({metadata,isCurrent:()=>owner.codeActive,
    invoke:async(method,args)=>{calls.push(method);return owner.code(metadata.session,method,args);},
    dispose:()=>owner.endCode(metadata.session)});
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const evaluate=()=>new AsyncFunction('useSoundChip','setBpm','livePrepare','scale','liveLoop','choose','beat','CH1',SCSP_CYCLE2_CODE)(
    async name=>{assert.equal(name,'scsp');return client;},
    bpm=>assert.equal(bpm,120),
    async(key,prepare)=>{if(!prepared.has(key))prepared.set(key,await prepare());return prepared.get(key);},
    (root,kind,octaves)=>{assert.deepEqual([root,kind,octaves],['E3','minorPentatonic',1]);return ['E3','G3'];},
    (name,callback)=>loops.set(name,callback),notes=>notes[0],async value=>{
      beats.push(value);
      if(value===0.5){
        const output=owner.synth.generateStereo(512);
        for(const sample of [...output.left,...output.right]){assert(Number.isFinite(sample));peak=Math.max(peak,Math.abs(sample));}
      }
    },0,
  );
  const samples=owner.read().slots.slice(0,2).map(voice=>voice.sample.id);
  await evaluate();
  assert.equal(owner.read().config.fm.algorithm,'cycle2');
  assert.deepEqual(owner.read().config.fm.cycle2.outputs,[1]);
  assert.deepEqual(owner.read().slots.slice(0,2).map(voice=>voice.sample.id),samples,'current PCM is reused');
  await loops.get('cycle2-melody')();
  assert.deepEqual(beats,[0.5,0.25]);assert(peak>0&&peak<1,'example has finite nonzero output before release');
  const group=owner.read().voiceGroups[0];assert.deepEqual(group.operatorSlots,[6,7]);assert.equal(group.held,false);
  owner.setConfig({fm:{depths:[0,6,9,9,9,9]}});
  const setupCalls=calls.filter(name=>name==='setConfig'||name==='setMix').length;
  await evaluate();
  assert.equal(prepared.size,1);assert.equal(loops.size,1);
  assert.equal(calls.filter(name=>name==='setConfig'||name==='setMix').length,setupCalls);
  assert.equal(owner.read().config.fm.depths[0],0,'Apply does not overwrite the live Depth edit');
  assert.equal(owner.exportPatch().version,11);
  await client.dispose();assert.equal(owner.read().codeActive,false);assert.equal(owner.read().voiceGroups.length,0);
});
