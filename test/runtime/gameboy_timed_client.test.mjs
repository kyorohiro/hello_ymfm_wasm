import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameboyClient,createPrimaryGameboyApi} from '../../tetorica_src/runtime/playground_gameboy.js';
import {attachGameboyTimedClient} from '../../tetorica_src/runtime/gameboy_timed_client.js';
import {GameboySynth} from '../../tetorica_src/runtime/gameboysynth.js';
import {createGameboyTimedSnapshot} from '../../tetorica_src/runtime/gameboy_timed_state.js';
import {compileGameboyOperations} from '../../tetorica_src/runtime/gameboy_operations.js';

function fixture({native=false,listeners=false}={}){
  const sent=[],pending=[],handlers=new Set();let held=false,closed=false,instanceId='apu:one';
  const renderer=new GameboySynth({transport:{writeRegister(){},reset(){}}});renderer.initialize();
  const port={onmessage:null,start(){},close(){closed=true;},
    ...(listeners?{addEventListener(_type,fn){handlers.add(fn);},removeEventListener(_type,fn){handlers.delete(fn);}}:{}),
    postMessage(message){
      sent.push(structuredClone(message));
      if(message.method!=='gameboyTimed')return;
      const payload=message.args[0];let value,error;
      try{
        if(payload.action==='capture')value=createGameboyTimedSnapshot(renderer._getState(),{instanceId,frame:128,sampleRate:48000});
        else if(payload.action==='schedule'){
          compileGameboyOperations(payload.operations,renderer._getState());
          value={name:payload.options.name,entries:payload.operations.operations.length,sampleRate:48000,startFrame:256};
        }else value=true;
      }catch(reason){error=reason.message;}
      const reply={id:message.id,...(error?{error}:{value})};if(held)pending.push(reply);else deliver(reply);
    }};
  function deliver(data){if(listeners)for(const fn of [...handlers])fn({data});else port.onmessage?.({data});}
  const api=createGameboyClient(port,{native});
  return {api,port,sent,renderer,deliver,get closed(){return closed;},hold(){held=true;},flush(){held=false;for(const value of pending.splice(0).reverse())deliver(value);},setInstance(value){instanceId=value;}};
}
const writes=program=>program.operations.map(operation=>operation.method);

test('Game Boy recorder is local, nested calls return root, and Wave payloads detach',()=>{
  const f=fixture(),wave=new Uint8Array(32).fill(5);let calls=0;
  const plan=f.api.build(b=>{calls++;b.atSample(0).pulse.setDuty(0,.25).atSeconds(.01).wave.setWaveform(wave).noise.keyOn();});
  assert.equal(calls,1);assert.equal(f.sent.length,0);assert.deepEqual(writes(plan),['pulse.setDuty','wave.setWaveform','noise.keyOn']);
  wave.fill(0);assert.deepEqual(plan.operations[1].args[0],Array(32).fill(5));assert.deepEqual(structuredClone(plan),plan);
  assert.throws(()=>f.api.build(async b=>b.keyOn(0)),/synchronous/);f.api.dispose();
});

test('client/reset compilation is request-free and keeps configured release metadata',async()=>{
  const f=fixture();f.api.initialize();f.api.pulse.setVoice(0,{volume:7});f.api.pulse.keyOff(0);
  const state=f.api._getState(),count=f.sent.length,plan=f.api.build(b=>b.pulse.keyOn(0));
  const rows=await f.api.compile(plan,{initialState:'client'});
  assert(rows.some(row=>row.register===2&&row.value===112),'configured Envelope survives keyOff');
  assert.equal(f.sent.length,count);assert.deepEqual(f.api._getState(),state);
  const raw=f.api.build(b=>b.writeRegister(22,128).atSample(10).writeRegister(21,0xf3));
  const reset=await f.api.compile(raw,{initialState:'reset'});assert.equal(reset.length,2);assert.equal(f.sent.length,count);
  await assert.rejects(f.api.compile(plan,{initialState:'reset'}),/initialize/);f.api.dispose();
});

for(const listeners of [false,true])test(`current capture waits for ACK and reusable snapshots stay immutable (${listeners?'Worker':'Main'} port)`,async()=>{
  const f=fixture({listeners});f.api.initialize();const local=f.api._getState(),plan=f.api.build(b=>b.pulse.setVoice(0,{duty:.25}));
  f.hold();let settled=false;
  const waiting=f.api.compile(plan).then(value=>{settled=true;return value;});await Promise.resolve();assert.equal(settled,false);
  assert(f.sent.at(-1).id);f.flush();await waiting;
  const snapshot=await f.api.captureState(),before=structuredClone(snapshot),count=f.sent.length;
  const a=await f.api.compile(plan,{initialState:snapshot});f.renderer.pulse.setVoice(0,{volume:4});
  const b=await f.api.compile(plan,{initialState:snapshot});assert.deepEqual(a,b);assert.deepEqual(snapshot,before);assert.equal(f.sent.length,count);
  assert.deepEqual(f.api._getState(),local);assert(Object.isFrozen(snapshot.state.voice));
  await assert.rejects(f.api.compile(plan,{initialState:{...snapshot,instanceId:'foreign'}}),/Incompatible/);
  await assert.rejects(f.api.compile(plan,{initialState:{...snapshot,format:'tetorica-opll-state'}}),/format/);
  f.api.dispose();assert(f.closed);
});

test('public writes carry sent/configured metadata and Gate intent without changing immediate returns',()=>{
  const f=fixture();assert.equal(f.api.initialize(),undefined);assert.equal(f.api.pulse.setDuty(0,.25),undefined);
  f.api.pulse.keyOn(0);const trigger=f.sent.at(-1);assert.equal(trigger.keyIntent,true);assert(trigger.args[1]&128);
  assert.equal(trigger.gameboyState.voiceValue&128,0);
  f.api.pulse.keyOff(0);const off=f.sent.at(-1);assert.equal(off.args[1],0);assert.equal(off.gameboyState.voiceValue,160);assert.equal(off.keyIntent,true);
  f.api.pulse.setFrequency(0,440);assert.equal(f.sent.at(-1).keyIntent,false);
  f.api.reset();f.api.writeRegister(22,128);assert.equal(f.api._getState().initialized,false);f.api.adoptRegisterState();
  assert.deepEqual(f.sent.at(-1),{method:'adoptRegisterState',args:[]});assert.equal(f.api._getState().initialized,true);f.api.dispose();
});

test('schedules and ownership transactions use the acknowledged control capability',async()=>{
  const f=fixture();f.api.initialize();const plan=f.api.build(b=>b.pulse.noteOn(0,'C4').atSample(100).pulse.keyOff(0));
  const receipt=await f.api.schedule(plan,{name:'notes',repeatSeconds:.1});assert.equal(receipt.startFrame,256);
  const cap=f.api._timedOperations;
  await cap.stage('tx','loop:one','schedule',[plan,{name:'notes',repeatSeconds:.1}]);
  await cap.stage('tx','loop:one','clearSchedule',['old']);await cap.commit('tx','loop:one');await cap.abort('tx','loop:one');
  await cap.cancelOwner('loop:one');await cap.releaseOwner('loop:one');await f.api.clearSchedule('notes');
  const requests=f.sent.filter(row=>row.method==='gameboyTimed');assert.equal(new Set(requests.map(row=>row.id)).size,requests.length);
  assert.deepEqual(requests.map(row=>row.args[0].action),['schedule','stage','stage','commit','abort','cancelOwner','releaseOwner','clear']);
  assert(requests.slice(1,-1).every(row=>row.args[0].owner==='loop:one'));
  const count=f.sent.length;
  await assert.rejects(f.api.schedule(plan,{name:'notes',repeatSeconds:0}),/repeatSeconds/);
  await assert.rejects(f.api.schedule(plan,{name:'notes',extra:1}),/field/);
  await assert.rejects(cap.stage('tx','loop','not-a-method',[]),/Unsupported/);assert.equal(f.sent.length,count);
  f.api.dispose();assert.throws(()=>f.api.build(()=>{}),{name:'AbortError'});
});

test('Native rejects timing/capture explicitly while local educational compilation remains available',async()=>{
  const f=fixture({native:true});f.api.initialize();const plan=f.api.build(b=>b.pulse.keyOn(0)),count=f.sent.length;
  assert((await f.api.compile(plan,{initialState:'client'})).length>0);assert.equal(f.sent.length,count);
  await assert.rejects(f.api.captureState(),/Native is not supported/);
  await assert.rejects(f.api.schedule(plan,{name:'native'}),/Native is not supported/);
  assert.equal(await f.api._timedOperations.cancelOwner('loop'),false);assert.equal(f.sent.length,count);f.api.dispose();
});

test('borrowed facade without a complete client state rejects client compilation and supports explicit complete state injection',async()=>{
  let live=true;const f=fixture(),facade=attachGameboyTimedClient({clock:4194304,isCurrent:()=>live,dispose(){}},{instanceId:'facade'});
  const plan=facade.build(b=>b.writeRegister(22,128));await assert.rejects(facade.compile(plan,{initialState:'client'}),/Incomplete/);
  const local=attachGameboyTimedClient({clock:4194304,dispose(){}},{getClientState:()=>f.renderer._getState()});
  assert((await local.compile(plan,{initialState:'client'})).length>0);live=false;assert.throws(()=>facade.build(()=>{}),{name:'AbortError'});f.api.dispose();local.dispose();facade.dispose();
});

test('primary facade retains timed methods without exposing device disposal and diagnostics unsubscribe',async()=>{
  const f=fixture({listeners:true}),primary=createPrimaryGameboyApi(f.api);assert.equal(primary.dispose,undefined);
  assert.equal(primary._timedOperations,f.api._timedOperations);assert.equal(typeof primary.build,'function');
  const events=[],unsubscribe=primary._timedOperations.onError(event=>events.push(event));
  f.deliver({type:'gameboy-timed-error',message:'bad reservation',owner:'loop',session:1});assert.equal(events.length,1);assert(Object.isFrozen(events[0]));
  unsubscribe();f.deliver({type:'not-gameboy',message:'ignored'});assert.equal(events.length,1);
  f.api.initialize();await primary.captureState();const plan=primary.build(b=>b.pulse.keyOn(0));assert((await primary.compile(plan,{initialState:'client'})).length>0);f.api.dispose();
});

test('retiring a borrowed timed facade detaches diagnostics without disposing its shared chip',()=>{
  const handlers=new Set(),events=[];let disposed=0;
  const port={addEventListener(_type,fn){handlers.add(fn);},removeEventListener(_type,fn){handlers.delete(fn);},start(){}};
  for(let run=0;run<4;run++){
    const api=attachGameboyTimedClient({clock:4194304,dispose(){disposed++;}},{instanceId:'borrowed:'+run},port);
    assert.equal(handlers.size,1);api._timedOperations.onError(event=>events.push(event));
    const old=[...handlers][0];assert.equal(api._timedOperations.detach(),true);assert.equal(api._timedOperations.detach(),false);
    assert.equal(handlers.size,0);assert.equal(disposed,0);
    old({data:{type:'gameboy-timed-error',message:'late error from old run'}});assert.equal(events.length,0);
    assert.throws(()=>api.build(()=>{}),{name:'AbortError'});
  }
});
