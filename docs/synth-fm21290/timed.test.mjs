// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOperations,timedFormat} from './timed.js';
import {createInstrument} from './instrument.js';
import {presetToVoice,voiceToPreset} from '../js/msfa_dx7/src/preset.js';
import {EVENT} from './chip.js';

const preset=voiceToPreset(presetToVoice({}));
test('scheduled key helpers compile to the immediate register bytes in order',()=>{
  const actual=[];
  const immediate=createInstrument((register,value)=>actual.push([register,value]));
  immediate.setPatch(preset);actual.length=0;
  immediate.keyOn(3,64,80);immediate.keyOff(3);
  const plan=buildOperations(preset,b=>b.keyOn(3,64,80).atSample(12).keyOff(3));
  assert.deepEqual(plan.writes.map(({register,value})=>[register,value]),actual);
  assert.deepEqual(plan.writes.at(-1),{register:EVENT,value:14,offsetSeconds:12/48000});
  assert.throws(()=>buildOperations(preset,b=>b.atSeconds(1).atSeconds(0)));
  assert.throws(()=>timedFormat.validateOperations({...plan,writes:[{register:0x302f,value:0,offsetSeconds:0}]}));
});

test('the audio worklet fires within a block and a cancelled pattern releases only its own gates',async()=>{
  let Processor;
  globalThis.sampleRate=48000;
  globalThis.AudioWorkletProcessor=class{port={postMessage(){}};};
  globalThis.registerProcessor=(_,type)=>{Processor=type;};
  await import('./worklet.js');
  const processor=new Processor();
  const plan=buildOperations(preset,b=>b.atSample(17).writeRegister(EVENT,1).writeRegister(EVENT,5));
  processor.port.onmessage({data:{record:true}});
  processor.timed.request({action:'schedule',owner:'test',plan,options:{name:'gate'}});
  processor.process([],[[new Float32Array(256)]]);
  assert.deepEqual(processor.recording.events.filter(e=>e[1]===EVENT),[[145,EVENT,1],[145,EVENT,5]]);
  processor.port.onmessage({data:{writes:[[EVENT,2],{keyOff:0}]}});
  assert.equal(processor.chip.voices[0].held,true);
  processor.port.onmessage({data:{writes:[[EVENT,1]]}});
  processor.timed.request({action:'cancelOwner',owner:'test'});
  assert.equal(processor.chip.voices[0].held,true);
  assert.equal(processor.chip.voices[1].held,false);
});
