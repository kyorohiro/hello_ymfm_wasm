import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Huc6280Synth} from '../../tetorica_src/runtime/huc6280synth.js';
import {buildHuc6280Operations as build,compileHuc6280Operations as compile,createHuc6280OperationResetState as reset,createHuc6280OperationResolver as resolver,validateHuc6280Operations as validate} from '../../tetorica_src/runtime/huc6280_operations.js';

test('recorder runs once without evaluating chip methods or capturing live state',()=>{
 let calls=0,retained;const plan=build(b=>{calls++;retained=b;b.atSample(0).setVolume(0,12);b.atSeconds(.1).keyOn(0);});
 assert.equal(calls,1);assert.deepEqual(structuredClone(plan),plan);assert.throws(()=>retained.keyOff(0),/no longer active/);
 assert.throws(()=>build(async()=>{}),/synchronous/);assert.throws(()=>build(b=>b.setWaveform(0,[])),TypeError);
});
test('register math reuses the actual chip API while compilation changes no baseline state',()=>{
 const writes=[],chip=new Huc6280Synth({transport:{writeRegister:(register,value)=>writes.push({register,value}),reset(){}}});chip.initialize();writes.length=0;
 const state=chip._getState(),before=structuredClone(state);
 const plan=build(b=>{b.setVolume(4,9).setPan(4,7,12).setNoise(4,{enabled:true,frequency:13});b.atSample(100).setNote(0,'C4').keyOn(0).keyOff(0);});
 const trace=compile(plan,state);assert.deepEqual(state,before);assert.deepEqual(chip._getState(),before);assert.equal(writes.length,0);
 chip.setVolume(4,9);chip.setPan(4,7,12);chip.setNoise(4,{enabled:true,frequency:13});chip.setNote(0,'C4');chip.keyOn(0);chip.keyOff(0);
 assert.deepEqual(trace.map(({register,value})=>({register,value})),writes);
 assert.equal(trace.at(-1).offsetSeconds,100/44100);
});
test('partial updates use each supplied state and retain DDA/gate bits, selection and Wave RAM cursor',()=>{
 const state=reset();state.registers[5][4]=0xc0|31;state.selectedChannel=3;
 const operation=build(b=>b.setVolume(5,8)).operations[0],a=resolver().resolve(operation,state);
 assert.deepEqual(a.writes,[{register:0,value:5},{register:4,value:0xc8}]);assert.equal(a.state.selectedChannel,5);
 const changed=structuredClone(state);changed.registers[5][4]=0x80|31;
 assert.equal(resolver().resolve(operation,changed).writes.at(-1).value,0x88);
 const data=build(b=>b.writeRegister(0,7).writeRegister(6,23).writeRegister(6,11));const rows=compile(data,state);
 assert.deepEqual(rows.map(r=>r.value),[7,23,11]);assert.equal(state.indices[7],0);
});
test('same-time LFO resets and repeated hardware writes are preserved in exact order',()=>{
 const plan=build(b=>b.setLfo({frequency:4,depth:2,reset:true}).setLfo({frequency:4,depth:2,reset:true}).setLfo({frequency:4,depth:2,reset:false}));
 assert.deepEqual(compile(plan,reset()).map(r=>[r.register,r.value]),[[8,4],[9,130],[8,4],[9,130],[8,4],[9,2]]);
});
test('seconds and reference samples share absolute offsets and validation rejects whole malformed programs',()=>{
 const plan=build(b=>{b.atSeconds(.1).keyOn(0);b.atSample(4800).keyOff(0);},{referenceSampleRate:48000});
 assert(compile(plan,reset()).every(row=>row.offsetSeconds===.1));
 assert.throws(()=>build(b=>b.atSeconds(1).atSample(0)),/nondecreasing/);
 assert.throws(()=>validate(build(b=>b.setVolume(0,32))),RangeError);
 assert.throws(()=>compile(plan,{...reset(),indices:[]}),/Incomplete/);
 assert.throws(()=>compile(plan,{...reset(),clock:4000000}),/Incompatible/);
 const malformed=structuredClone(plan);malformed.operations[1].order=0;assert.throws(()=>compile(malformed,reset()),/order/);
});
test('browser mirror is byte-identical to the canonical operation compiler',async()=>{
 assert.deepEqual(await readFile(new URL('../../docs/js/huc6280_operations.js',import.meta.url)),await readFile(new URL('../../tetorica_src/runtime/huc6280_operations.js',import.meta.url)));
});
