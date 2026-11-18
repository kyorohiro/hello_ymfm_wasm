// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/scsp_wasm.js';
import {Scsp} from '../js/scsp.js';
import {SynthInstrument} from './instrument.js';
import {settings,readPatch} from './patch.js';
import {cycle2Routing,customRouting} from './routing.js';

let module;
async function create(t){
  module??=factory({wasmBinary:await readFile(new URL('../generated/scsp_wasm.wasm',import.meta.url))});
  const owner=new SynthInstrument(await Scsp.create({moduleFactory:()=>module}));
  t.after(()=>owner.dispose());return owner;
}
const cycle={mode:'fm2',fm:{algorithm:'cycle2'}};

test('Cycle metadata is bounded, owned and strict while Custom still rejects mutual cycles',()=>{
  assert.deepEqual(cycle2Routing(),{outputs:[1]});
  const source={outputs:[1,0]},normalized=cycle2Routing(source);
  assert.deepEqual(normalized,{outputs:[0,1]});assert.deepEqual(source,{outputs:[1,0]});
  source.outputs[0]=0;assert.deepEqual(normalized,{outputs:[0,1]});
  for(const value of [null,undefined,{},[],{outputs:null},{outputs:[2]},{outputs:[0,0]},
    {outputs:Array(1)},{outputs:[true]},{outputs:[1],order:[0,1]},{outputs:[1],[Symbol('key')]:0}])assert.throws(()=>cycle2Routing(value));
  assert.throws(()=>customRouting({inputs:[[1],[0]],outputs:[1]}),/acyclic/);
});

test('Cycle selection rejects incompatible or malformed requests without retiring owners or native writes',async t=>{
  const owner=await create(t);owner.setConfig(cycle);owner.noteOn('held',69);
  const before=owner.read(),ram=owner.core.readRam(),write=owner.core.write.bind(owner.core);let writes=0;
  owner.core.write=(...args)=>{writes++;return write(...args);};
  for(const patch of [{mode:'pcm'},{mode:'fm4'},{mode:'fm6'},
    ...[null,undefined,{}, {outputs:[2]},{outputs:[0,0]},{outputs:Array(1)}].map(cycle2=>({fm:{cycle2}}))]){
    assert.throws(()=>owner.setConfig(patch));assert.deepEqual(owner.read(),before);
  }
  assert.equal(writes,0);assert.deepEqual(owner.core.readRam(),ram);
  const plain=owner.read().config;
  assert.deepEqual(settings({...plain,fm:{...plain.fm,cycle2:{outputs:[1,0]}}}).fm.cycle2,{outputs:[0,1]});
});

test('Cycle and Custom retain separate dormant settings and combined target-size Custom entry uses Chain',async t=>{
  const owner=await create(t),saved={inputs:[[],[0]],outputs:[1]};
  owner.setConfig({mode:'fm2',fm:{algorithm:'custom',custom:saved}});
  owner.setConfig({...cycle,fm:{algorithm:'cycle2',cycle2:{outputs:[0,1]}}});
  assert.deepEqual(owner.read().config.fm.custom,saved);
  owner.setConfig({fm:{algorithm:'custom'}});assert.deepEqual(owner.read().config.fm.custom,saved);
  owner.setConfig({fm:{algorithm:'cycle2'}});assert.deepEqual(owner.read().config.fm.cycle2,{outputs:[0,1]});
  owner.setConfig({mode:'fm4',fm:{algorithm:'chain'}});
  assert.deepEqual(owner.read().config.fm.cycle2,{outputs:[0,1]});
  owner.setConfig(cycle);assert.deepEqual(owner.read().config.fm.cycle2,{outputs:[0,1]});
  for(const mode of ['fm2','fm4','fm6']){
    const fresh=await create(t);fresh.setConfig(cycle);fresh.setConfig({mode,fm:{algorithm:'custom'}});
    const count=Number(mode.slice(2));
    assert.deepEqual(fresh.read().config.fm.custom,{inputs:Array.from({length:count},(_,i)=>i+1<count?[i+1]:[]),outputs:[0]});
  }
});

test('Cycle exports explicit v11 rather than aliasing an old format; inactive metadata exports no new format',async t=>{
  const owner=await create(t),original=owner.exportPatch();
  owner.setConfig(cycle);assert.equal(owner.exportPatch().version,11);
  for(let version=1;version<=10;version++){
    assert.throws(()=>readPatch({...original,version,fm:{...original.fm,algorithm:'cycle2',cycle2:{outputs:[1]}}}),/version 11/);
    assert.throws(()=>readPatch({...original,version,fm:{...original.fm,cycle2:{outputs:[1]}}}),/version 11/);
  }
  owner.setConfig({mode:'pcm',fm:{algorithm:'chain'}});
  assert.deepEqual(owner.exportPatch(),original);
});
