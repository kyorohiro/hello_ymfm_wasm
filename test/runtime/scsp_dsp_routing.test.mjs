// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../../docs/generated/scsp_wasm.js';
import {Scsp} from '../../tetorica_src/runtime/scsp.js';
import {ScspSynth} from '../../tetorica_src/runtime/scspsynth.js';
import {ScspDspProgram} from '../../tetorica_src/runtime/scsp_dsp.js';
import {assembleScspDsp} from '../../tetorica_src/runtime/scsp_dsp_assembler.js';
import {validateScspDspDelayProgram,validateScspDspRegisterProgram} from '../../tetorica_src/runtime/scsp_dsp_program.js';

const source=`000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
002: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
003: XSEL=1 YSEL=1 IRA=33 BSEL=1 COEF=2
004: TWT=1 TWA=0 EWT=1 EWA=1 ZERO=1`;
const stereo=assembleScspDsp(source);
const mono=assembleScspDsp('000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0\n001: EWT=1 EWA=0 ZERO=1');
const binary=await readFile(new URL('../../docs/generated/scsp_wasm.wasm',import.meta.url));
const sat24=value=>Math.max(-0x800000,Math.min(0x7fffff,value));
const output=value=>Math.floor(value/256)/32768;
const history=core=>Array.from({length:256},(_,i)=>core.read(0xc00+i*2));
const program=core=>Array.from({length:512},(_,i)=>core.read(0x800+i*2));
let module;
async function instrument(t){
  module??=factory({wasmBinary:binary});
  const core=await Scsp.create({moduleFactory:()=>module}),synth=new ScspSynth(core),owner=new ScspDspProgram(core);
  t.after(()=>synth.dispose());
  const a=Int16Array.from({length:512},(_,i)=>(i*7919)%18001-9000);
  const b=Int16Array.from({length:512},(_,i)=>i<10?[0,0,8192,-4096,0,4096,0,-8192,0,0][i]:0);
  const samples=[a,b].map(pcm=>synth.loadPCM(pcm,{baseFrequencyHz:44100/pcm.length,loopStartSamples:0}));
  for(let i=0;i<2;i++){
    synth.setPreset(6+i,{sample:samples[i],frequencyHz:samples[i].rootFrequencyHz,directLevel:0});
    synth.keyOn(6+i);core.write((6+i)*32+12,0x100);core.write((6+i)*32+20,(i<<3)|7);
  }
  owner.applyProgram(stereo,{coefficients:{0:2048,1:3072,2:1024}});
  owner.setReturn(0,{level:7,pan:31});owner.setReturn(1,{level:7,pan:15});
  return {core,synth,owner,a,b,samples,frame:0,state:0};
}
function expected(owner,frames,{routeA=0,routeB=1,mutedSecond=false,swapped=false}={}){
  const codes=owner.owner.readCoefficients().codes,left=new Float32Array(frames),right=left.slice();
  for(let i=0;i<frames;i++){
    const at=owner.frame++%owner.a.length;
    const first=(routeA===0?owner.a[at]:0)+(routeB===0?owner.b[at]:0);
    const second=(routeA===1?owner.a[at]:0)+(routeB===1?owner.b[at]:0);
    const gain=output(sat24(Math.floor(first*256*codes[0]/4096)));
    owner.state=sat24(Math.floor(owner.state*codes[1]/4096)+Math.floor(second*256*codes[2]/4096));
    const iir=mutedSecond?0:output(owner.state);
    left[i]=swapped?iir:gain;right[i]=swapped?gain:iir;
  }
  return {left,right};
}
function state(owner){return {metadata:owner.owner.readProgram(),program:program(owner.core),
  returns:[owner.core.read(22),owner.core.read(54)],coefficients:[0x700,0x702,0x704].map(at=>owner.core.read(at)),
  history:history(owner.core),ram:owner.core.readRam(),frames:owner.core.nativeFrames,slots:owner.synth.getState().slots};}

test('RAM-free permits two effect outputs while the dedicated Synth validator remains mono',()=>{
  assert.deepEqual(validateScspDspRegisterProgram(stereo),stereo);
  assert.throws(()=>validateScspDspDelayProgram(stereo),/EWA must be 0/);
  assert.throws(()=>validateScspDspRegisterProgram(assembleScspDsp('000: EWT=1 EWA=2')),/EWA must be 0\.\.1/);
  for(const asm of ['001: MRD=1','001: MWT=1','000: TABLE=1','000: MASA=1','000: RAW0=0x8000'])assert.throws(()=>validateScspDspRegisterProgram(assembleScspDsp(asm)));
});

test('legacy return calls retain their snapshot shape and never touch output1',()=>{
  const registers=new Map(),writes=[],core={read:at=>registers.get(at)??0,write(at,value,mask=0xffff){writes.push([at,value,mask]);registers.set(at,((registers.get(at)??0)&~mask)|(value&mask));}};
  const owner=new ScspDspProgram(core);
  owner.applyProgram(mono,{coefficients:{0:2048,1:0,2:0}});owner.setReturn({level:7,pan:31});
  assert.deepEqual(Object.keys(owner.readProgram()),['profile','configured','words','revision','coefficients','return']);
  assert(!writes.some(([at])=>at===54));writes.length=0;owner.setReturn({level:7});assert.deepEqual(writes,[]);
  owner.setReturn(0,{pan:0});assert.deepEqual(owner.readProgram().returns,[{level:7,pan:0},{level:0,pan:0}]);
  assert(writes.some(([at,value,mask])=>at===54&&value===0&&mask===255));
  owner.setReturn(1,{level:6,pan:15});owner.setReturn({level:5});
  assert.deepEqual(owner.readProgram().return,{level:5,pan:0});
  assert.deepEqual(owner.readProgram().returns,[{level:5,pan:0},{level:6,pan:15}]);
});

test('two buses render independent Gain-left and IIR-right against integer references',async t=>{
  const owner=await instrument(t),ram=owner.core.readRam();
  assert.deepEqual(owner.synth.generateStereo(512),expected(owner,512));
  assert.deepEqual(owner.core.readRam(),ram);
  const before=state(owner);owner.owner.setCoefficients({0:1024});
  assert.deepEqual(history(owner.core),before.history);assert.deepEqual(owner.synth.getState().slots,before.slots);
  assert.deepEqual(owner.synth.generateStereo(277),expected(owner,277));
  owner.owner.setReturn(1,{level:0});
  assert.deepEqual(owner.synth.generateStereo(31),expected(owner,31,{mutedSecond:true}));
  owner.owner.setReturn(1,{level:7});
  assert.deepEqual(owner.synth.generateStereo(67),expected(owner,67));
});

test('return pan edits and physical bus rerouting preserve phase, history and direct slot fields',async t=>{
  const owner=await instrument(t);assert.deepEqual(owner.synth.generateStereo(29),expected(owner,29));
  const before=state(owner);owner.core.write(54,0xa500,0xff00);
  owner.owner.setReturn(0,{pan:15});owner.owner.setReturn(1,{pan:31});
  assert.equal(owner.core.read(54)&0xff00,0xa500);assert.deepEqual(history(owner.core),before.history);
  assert.equal(owner.core.nativeFrames,before.frames);
  assert.deepEqual(owner.synth.generateStereo(53),expected(owner,53,{swapped:true}));
  owner.owner.setReturn(0,{pan:31});owner.owner.setReturn(1,{pan:15});
  owner.core.write(6*32+20,(1<<3)|7);
  assert.deepEqual(owner.synth.generateStereo(79),expected(owner,79,{routeA:1}));
  owner.core.write(7*32+20,1<<3);
  assert.deepEqual(owner.synth.generateStereo(43),expected(owner,43,{routeA:1,routeB:-1}));
  assert(owner.synth.getState().slots[6].gate&&owner.synth.getState().slots[7].gate);
});

test('detached two-return snapshots adopt without writes and reject inconsistent metadata atomically',async t=>{
  const source=await instrument(t),writes=[],target=new ScspDspProgram({write:(...args)=>writes.push(args)});
  const snapshot=source.owner.readProgram();target.adoptState(snapshot);
  assert.deepEqual(writes,[]);assert.deepEqual(target.readProgram(),snapshot);
  snapshot.return.level=1;snapshot.returns[0].pan=15;snapshot.returns[1].level=0;
  assert.notDeepEqual(target.readProgram(),snapshot);
  const before=target.readProgram();
  for(const mutate of [s=>{s.returns[0].level=0;},s=>{s.returns.pop();},s=>{delete s.returns[1];},s=>{s.returns[1].pan=32;},s=>{s.returns[1].extra=true;}]){
    const invalid=structuredClone(before);mutate(invalid);assert.throws(()=>target.adoptState(invalid));assert.deepEqual(target.readProgram(),before);
  }
  const unconfigured=new ScspDspProgram({write(){}}).readProgram();unconfigured.returns=[{level:0,pan:0},{level:0,pan:0}];
  assert.throws(()=>target.adoptState(unconfigured),/Unconfigured/);
  for(const args of [[2,{}],[-1,{}],[.5,{}],[NaN,{}],[0],['1',{}],[1,{level:8}],[{},{}]])assert.throws(()=>target.setReturn(...args));
  assert.deepEqual(target.readProgram(),before);assert.deepEqual(writes,[]);
});

test('materialized return patches do not overwrite reentrant changes to the other output',()=>{
  const owner=new ScspDspProgram({write(){}});let reads=0;
  owner.setReturn(0,{get level(){reads++;owner.setReturn(1,{level:6,pan:15});return 7;},pan:31});
  assert.equal(reads,1);assert.deepEqual(owner.readProgram().returns,[{level:7,pan:31},{level:6,pan:15}]);
});

test('program and managed Delay transitions retain two returns and restore both after Stop/reset',async t=>{
  const owner=await instrument(t),returns=owner.owner.readProgram().returns;
  owner.synth.generateStereo(61);owner.owner.applyProgram(mono);
  assert.deepEqual(owner.owner.readProgram().returns,returns);
  assert(owner.synth.generateStereo(64).right.every(value=>value===0));
  owner.owner.setDelay({enabled:false,timeMs:20,feedback:.5},{address:8192,byteLength:65536});
  assert.deepEqual(owner.owner.readProgram().returns,returns);
  assert.equal(owner.core.read(22)&255,0);assert.equal(owner.core.read(54)&255,0);
  owner.owner.setReturn(1,{level:4});assert.equal(owner.core.read(54)&255,0);
  owner.owner.setDelay({enabled:true},{address:8192,byteLength:65536});
  assert.equal(owner.core.read(22)&255,(7<<5)|31);assert.equal(owner.core.read(54)&255,(4<<5)|15);
  const configured=owner.owner.readProgram();owner.core.reset();owner.owner.restore();
  assert.deepEqual(owner.owner.readProgram(),configured);
  assert.equal(owner.core.read(22)&255,(7<<5)|31);assert.equal(owner.core.read(54)&255,(4<<5)|15);
  assert(owner.synth.generateStereo(3000).left.every(value=>value===0));
  owner.owner.applyProgram(stereo);assert.deepEqual(owner.owner.readProgram().returns,configured.returns);
});

test('failed second-return edits and program replacements restore metadata, registers and exact live PCM',async t=>{
  for(const programFailure of [false,true]){
    const a=await instrument(t),b=await instrument(t);a.synth.generateStereo(37);b.synth.generateStereo(37);
    const before=state(a),write=a.core.write.bind(a.core);let armed=true;
    a.core.write=(at,value,...args)=>{write(at,value,...args);if(armed&&at===54&&(!programFailure||value!==0)){armed=false;throw new Error('Injected output1 write failure');}};
    if(programFailure)assert.throws(()=>a.owner.applyProgram(mono,{coefficients:{0:1024,1:0,2:0}}),/Injected output1/);
    else assert.throws(()=>a.owner.setReturn(1,{level:4}),/Injected output1/);
    assert.deepEqual(state(a),before);assert.deepEqual(a.synth.generateStereo(512),b.synth.generateStereo(512));
  }
});

test('a failed second-return rollback is fatal and never publishes the partial metadata',async t=>{
  const owner=await instrument(t),before=owner.owner.readProgram(),write=owner.core.write.bind(owner.core);
  owner.core.write=(at,...args)=>{write(at,...args);if(at===54)throw new Error('Output1 device failed');};
  assert.throws(()=>owner.owner.setReturn(1,{level:4}),error=>error.fatal===true&&error.name==='ScspDspRollbackError');
  assert.deepEqual(owner.owner.readProgram(),before);
});
