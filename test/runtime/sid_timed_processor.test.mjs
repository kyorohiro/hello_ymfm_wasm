// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {SidCore} from '../../tetorica_src/runtime/sid.js';
import {Sid8580Core} from '../../tetorica_src/runtime/sid8580.js';
import {SidSynth,validateSidClock,SID_PAL_CLOCK} from '../../tetorica_src/runtime/sidsynth.js';
import {SidVoiceInspector,receiveSidInspector} from '../../tetorica_src/runtime/playground_sid_inspector.js';
import {createSidClient} from '../../tetorica_src/runtime/playground_sid.js';
import {createSidTimedProcessor,sidTimedCommandCost} from '../../tetorica_src/runtime/sid_timed_processor.js';
import {createProcessorPerformance,performanceNoteRelease} from '../../tetorica_src/runtime/playground_performance_processor.js';
const source=(await readFile(new URL('../../tetorica_src/runtime/playground_sid_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
const binaries={
  '6581':await readFile(new URL('../../tetorica_src/runtime/generated/sid/sid.wasm',import.meta.url)),
  '8580':await readFile(new URL('../../docs/generated/sid8580-machine/sid8580-endpoint.wasm',import.meta.url)),
};
async function setup(t,rate=48000,model='6581'){
  let Processor,frame=0,resolveReady;const messages=[],writes=[];
  const ready=new Promise(resolve=>resolveReady=resolve),port={postMessage:message=>{messages.push(message);if(message.ready||message.error)resolveReady(message);}};
  const scope={SidCore,Sid8580Core,SidSynth,validateSidClock,SID_PAL_CLOCK,SidVoiceInspector,receiveSidInspector,
    createSidTimedProcessor,sidTimedCommandCost,sampleRate:rate,performanceNoteRelease,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate,nowFrame:()=>frame}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor(_name,Type){Processor=Type;}};
  Object.defineProperty(scope,'currentFrame',{get:()=>frame});vm.runInNewContext(source,scope);
  const processor=new Processor({processorOptions:{model,wasmBinary:binaries[model]}});assert.equal((await ready).ready,true);
  let applying=false,activeFrame=null;const apply=processor.timed.apply.bind(processor.timed),write=processor.synth.writeRegister.bind(processor.synth);
  processor.timed.apply=(...args)=>{applying=true;activeFrame=args[2];try{return apply(...args);}finally{applying=false;}};
  processor.synth.writeRegister=(register,value)=>{const result=write(register,value);if(applying)writes.push({frame:activeFrame,register,value});return result;};
  const link=()=>{const clientPort={start(){},close(){},postMessage(data){processor.receive(data,{postMessage:value=>clientPort.onmessage?.({data:value})});}};return clientPort;};
  const client=createSidClient(link(),{model});client.initialize();
  t.after(()=>{client.dispose();processor.dispose();});
  return {client,processor,messages,writes,link,rate,model,frame:()=>frame,
    render(count){assert(count>=0);const left=new Float32Array(count),right=left.slice();for(let i=0;i<count;){const n=Math.min(128,count-i);assert.equal(processor.process([],[[left.subarray(i,i+n),right.subarray(i,i+n)]]),true);frame+=n;i+=n;}assert(left.every(Number.isFinite));assert.deepEqual(left,right);return left;}};
}
for(const rate of [44100,48000])for(const model of ['6581','8580'])test(`SID ${model} ${rate}: actual core timed writes match compile and sample offsets`,async t=>{
  const f=await setup(t,rate,model),api=f.client;
  const plan=api.build(b=>{
    b.setVoice(0,{waveform:'pulse',pulseWidth:1700,attack:0,decay:2,sustain:12,release:4});
    b.noteOn(0,'C4');b.atSample(441).keyOn(0);b.keyOn(0);
    b.atSample(600).setVoice(0,{sync:true,ring:true});
    b.atSeconds(.08).noteOff(0);
  });
  const expected=await api.compile(plan),receipt=await api.schedule(plan,{name:'test'});f.writes.length=0;
  const pcm=f.render(receipt.startFrame+Math.round(rate*.08)+1);
  assert(pcm.some(value=>Math.abs(value)>1e-5));
  assert.deepEqual(f.writes.map(({register,value})=>({register,value})),expected.map(({register,value})=>({register,value})));
  assert.equal(f.writes.filter(row=>row.register===4&&(row.value&1)&&row.frame===receipt.startFrame+Math.round(rate*.01)).length,2,'same-value Gate writes are kept');
  assert(f.writes.some(row=>row.frame===receipt.startFrame+Math.round(rate*600/44100)));
  assert.equal(f.processor.synth.getRegisterSnapshot()[4]&1,0);
});
test('SID partial ADSR/control/filter updates resolve on current bytes, not the recorded client state',async t=>{
  const f=await setup(t),api=f.client;
  const plan=api.build(b=>{b.setVoice(0,{attack:12,sync:true});b.setFilter({resonance:11,mode:'lowpass'});});
  const receipt=await api.schedule(plan,{name:'partials'});
  api.setVoice(0,{decay:9,waveform:'triangle',ring:true});api.setFilter({routing:5,volume:13,voice3off:true});
  f.render(receipt.startFrame+1);const r=f.processor.synth.getRegisterSnapshot();
  assert.equal(r[5],0xc9);assert.equal(r[4],0x16);assert.equal(r[23],0xb5);assert.equal(r[24],0x9d);
});
test('SID current/client/reset/snapshot compilation is detached and captures do not clock the core',async t=>{
  const f=await setup(t),api=f.client,plan=api.build(b=>b.setVoice(0,{sync:true}));
  const before=f.processor.core.getState?.().cycles,snapshot=await api.captureState();
  assert.equal(f.processor.core.getState?.().cycles,before);
  f.processor.synth.setVoice(0,{ring:true});
  assert.equal((await api.compile(plan)).find(row=>row.register===4).value,0x26);
  assert.equal((await api.compile(plan,{initialState:'client'})).find(row=>row.register===4).value,0x22);
  assert.equal((await api.compile(plan,{initialState:snapshot})).find(row=>row.register===4).value,0x22);
  assert.equal(snapshot.state.registers[4],0x20);
  await assert.rejects(api.compile(plan,{initialState:'reset'}),/initialize/);
  const raw=api.build(b=>{b.writeRegister(4,0x21);b.writeRegister(4,0x21);});
  assert.equal((await api.compile(raw,{initialState:'reset'})).length,2);
});
test('SID invalid named replacement and staged changes leave prior compact reservations intact',async t=>{
  const f=await setup(t),api=f.client,plan=api.build(b=>b.noteOn(0,'C4'));
  await api.schedule(plan,{name:'old',repeatSeconds:.1});
  const bad=structuredClone(plan);bad.operations[0].args[1]='invalid';
  await assert.rejects(api.schedule(bad,{name:'old'}));assert.equal(f.processor.performance.getStats().patternCount,1);
  const cap=api._timedOperations;
  await cap.stage(1,'loop:1','schedule',[plan,{name:'staged',repeatSeconds:.2}]);
  assert.equal(f.processor.performance.getStats().patternCount,1);await cap.abort(1,'loop:1');
  assert.equal(f.processor.performance.getStats().patternCount,1);
  await cap.stage(2,'loop:1','schedule',[plan,{name:'staged',repeatSeconds:.2}]);await cap.commit(2,'loop:1');
  assert.equal(f.processor.performance.getStats().patternCount,2);await cap.cancelOwner('loop:1');
  assert.equal(f.processor.performance.getStats().patternCount,1);await api.clearSchedule('old');
});
test('SID a later manual Gate survives old noteOff, raw Gate-off and allNotesOff',async t=>{
  const f=await setup(t),api=f.client,later=createSidClient(f.link());later._adoptState(api._getState());t.after(()=>later.dispose());
  const plan=api.build(b=>{b.noteOn(0,'C4');b.noteOn(1,'D4');b.atSample(441).noteOff(0);b.writeRegister(4,0x20);b.allNotesOff();});
  const receipt=await api.schedule(plan,{name:'old'});f.render(receipt.startFrame+1);
  later.noteOn(0,'E4');f.render(600);
  assert.equal(f.processor.synth.getRegisterSnapshot()[4]&1,1);assert.equal(f.processor.synth.getRegisterSnapshot()[11]&1,0);
  await api.clearSchedule('old');assert.equal(f.processor.synth.getRegisterSnapshot()[4]&1,1);
});
test('SID repeated baseline Gate-off writes execute exactly as compiled without requiring a prior timed On',async t=>{
  const f=await setup(t),api=f.client;
  const plan=api.build(b=>{b.writeRegister(4,0x20);b.writeRegister(4,0x20);b.keyOff(1);b.allNotesOff();});
  const expected=await api.compile(plan),receipt=await api.schedule(plan,{name:'off-trace'});f.writes.length=0;
  f.render(receipt.startFrame+1);
  assert.deepEqual(f.writes.map(({register,value})=>({register,value})),expected.map(({register,value})=>({register,value})));
  assert.equal(f.writes.filter(row=>row.register===4&&row.value===0x20).length,3);
});
test('SID explicit Off may release an older manual Gate, but not a Gate acquired after admission',async t=>{
  const f=await setup(t),api=f.client;api.noteOn(0,'C4');api.noteOn(1,'D4');
  const plan=api.build(b=>{b.noteOff(0);b.noteOff(1);});
  const receipt=await api.schedule(plan,{name:'older-off'});api.noteOn(1,'E4');f.render(receipt.startFrame+1);
  const state=f.processor.synth.getRegisterSnapshot();assert.equal(state[4]&1,0);assert.equal(state[11]&1,1);
});
test('SID parameter writes retain a scheduled Gate and its cancel ownership despite a stale client shadow',async t=>{
  const f=await setup(t),api=f.client;
  const receipt=await api.schedule(api.build(b=>b.noteOn(0,'C4')),{name:'held'});f.render(receipt.startFrame+1);
  assert.equal(api._getState().registers[4]&1,0,'schedule does not overwrite authored client state');
  api.setVoice(0,{sync:true});const registers=f.processor.synth.getRegisterSnapshot();assert.equal(registers[4]&3,3);
  await api.clearSchedule('held');assert.equal(f.processor.synth.getRegisterSnapshot()[4]&1,0);
});
test('SID timed parameter edits are allowed during an audition; the older Off keeps the newer manual Gate',async t=>{
  const f=await setup(t),api=f.client;
  const receipt=await api.schedule(api.build(b=>{b.noteOn(0,'C4');b.atSample(441).setVoice(0,{sync:true});b.atSample(882).noteOff(0);}),{name:'manual'});
  f.render(receipt.startFrame+1);f.processor.performance.beginAudition(0,'manual');
  f.processor.performance.applyImmediate({method:'writeRegister',args:[4,0x21]},f.processor.port,{owner:'manual'});
  f.render(1100);assert.equal(f.processor.synth.getRegisterSnapshot()[4],0x23);
  await api.clearSchedule('manual');assert.equal(f.processor.synth.getRegisterSnapshot()[4]&1,1);
  f.processor.performance.endAudition(0,'manual');
});
for(const rate of [44100,48000])test(`SID compact repeat ${rate} rounds every cycle without accumulated drift`,async t=>{
  const f=await setup(t,rate),period=1/110;
  const receipt=await f.client.schedule(f.client.build(b=>b.keyOn(0)),{name:'buzzer',repeatSeconds:period});f.writes.length=0;
  f.render(receipt.startFrame+Math.round(rate*period*30)+1);
  const triggers=f.writes.filter(row=>row.register===4&&(row.value&1));assert.equal(triggers.length,31);
  assert.deepEqual(triggers.map(row=>row.frame),Array.from({length:31},(_,cycle)=>receipt.startFrame+Math.round(cycle*period*rate)));
  assert.equal(f.processor.performance.getStats().patternCount,1);await f.client.clearSchedule('buzzer');
});
test('SID reset, Stop and disposal cancel patterns, held Gates and staged changes',async t=>{
  const f=await setup(t),api=f.client,plan=api.build(b=>b.noteOn(0,'C4'));
  const receipt=await api.schedule(plan,{name:'loop',repeatSeconds:.1});f.render(receipt.startFrame+1);
  f.processor.receive({type:'performance-stop',session:f.processor.performance.getStats().activeSession});f.render(6000);
  assert.equal(f.processor.performance.getStats().patternCount,0);assert.equal(f.processor.synth.getRegisterSnapshot()[4]&1,0);
  api.initialize();await api.schedule(plan,{name:'next',repeatSeconds:.1});api.reset();f.render(6000);
  assert.equal(f.processor.performance.getStats().patternCount,0);assert.equal(f.processor.synth._getState().initialized,false);
});
test('SID recoverable admission/runtime errors preserve the audio engine and closed reply ports cannot escape',async t=>{
  const f=await setup(t),api=f.client,errors=[];api._timedOperations.onError(error=>errors.push(error));
  const receipt=await api.schedule(api.build(b=>b.setVoice(0,{sync:true})),{name:'unsafe',repeatSeconds:.1});
  // Simulate an externally reset core after admission, without clearing this reservation.
  f.processor.synth.reset();f.render(receipt.startFrame+1);
  assert.equal(errors.length,1);assert.match(errors[0].message,/initialize/);assert.equal(f.processor.dead,false);
  assert.equal(f.processor.performance.getStats().patternCount,0);
  assert.doesNotThrow(()=>f.processor.timed.receive({id:1,method:'sidTimed',args:[{action:'invalid'}]},{postMessage(){throw Error('closed');}}));
});
test('SID fatal native render failure clears reservations and reports the original failure once',async t=>{
  const f=await setup(t),api=f.client;await api.schedule(api.build(b=>b.noteOn(0,'C4')),{name:'future',repeatSeconds:.1});
  f.processor.core.renderInto=()=>{throw Error('original native render failure');};
  const left=new Float32Array(128).fill(1),right=left.slice();assert.equal(f.processor.process([],[[left,right]]),false);
  assert(left.every(value=>value===0));assert(right.every(value=>value===0));assert.equal(f.processor.dead,true);
  assert.equal(f.processor.performance.getStats().patternCount,0);
  assert.deepEqual(f.messages.filter(row=>row.fatal).map(row=>row.error),['original native render failure']);
});
