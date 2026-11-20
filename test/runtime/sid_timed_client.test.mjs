import test from 'node:test';
import assert from 'node:assert/strict';
import {createSidClient} from '../../tetorica_src/runtime/playground_sid.js';
import {attachSidTimedClient} from '../../tetorica_src/runtime/sid_timed_client.js';
import {SidSynth,SID_PAL_CLOCK} from '../../tetorica_src/runtime/sidsynth.js';
import {createSidTimedSnapshot} from '../../tetorica_src/runtime/sid_timed_state.js';
import {compileSidOperations} from '../../tetorica_src/runtime/sid_operations.js';

function fixture({native=false,listeners=false,model='6581'}={}){
  const sent=[],pending=[],handlers=new Set();let held=false,closed=false,instanceId='sid:one';
  const renderer=new SidSynth({model,transport:{writeRegister(){},reset(){}}});renderer.initialize();
  const port={onmessage:null,start(){},close(){closed=true;},
    ...(listeners?{addEventListener(_type,fn){handlers.add(fn);},removeEventListener(_type,fn){handlers.delete(fn);}}:{}),
    postMessage(message){
      sent.push(structuredClone(message));
      if(message.method!=='sidTimed')return;
      const payload=message.args[0];let value,error;
      try{
        if(payload.action==='capture')value=createSidTimedSnapshot(renderer._getState(),{instanceId,frame:128,sampleRate:48000});
        else if(payload.action==='schedule'){
          compileSidOperations(payload.operations,renderer._getState());
          value={name:payload.options.name,entries:payload.operations.operations.length,sampleRate:48000,startFrame:256};
        }else value=true;
      }catch(reason){error=reason.message;}
      const reply={id:message.id,...(error?{error}:{value})};if(held)pending.push(reply);else deliver(reply);
    }};
  function deliver(data){if(listeners)for(const fn of [...handlers])fn({data});else port.onmessage?.({data});}
  const api=createSidClient(port,{native,model});
  return {api,port,sent,renderer,handlers,deliver,get closed(){return closed;},hold(){held=true;},flush(){held=false;for(const value of pending.splice(0).reverse())deliver(value);},setInstance(value){instanceId=value;}};
}

test('SID build records once without transport/state effects, and detaches voice patches',()=>{
  const f=fixture(),patch={waveform:'triangle+saw',sync:true};let calls=0;
  const before=f.api._getState();
  const plan=f.api.build(b=>{calls++;b.atSample(0).setVoice(0,patch).atSeconds(.01).keyOn(0).keyOn(0).atSample(882).keyOff(0);});
  assert.equal(calls,1);assert.equal(f.sent.length,0);assert.deepEqual(f.api._getState(),before);
  assert.deepEqual(plan.operations.map(op=>op.method),['setVoice','keyOn','keyOn','keyOff']);
  patch.sync=false;assert.equal(plan.operations[0].args[1].sync,true);assert.deepEqual(structuredClone(plan),plan);
  assert.throws(()=>f.api.build(async b=>b.keyOn(0)),/synchronous/);f.api.dispose();
});

for(const model of ['6581','8580'])test(`SID ${model} client/reset compilation is local and preserves packed settings`,async()=>{
  const f=fixture({model});f.api.initialize();f.api.setVoice(0,{attack:4,decay:7,sync:true});f.api.keyOn(0);
  const before=f.api._getState(),count=f.sent.length;
  const plan=f.api.build(b=>b.setVoice(0,{ring:true,attack:8}).setFilter({cutoff:777}).keyOff(0));
  const rows=await f.api.compile(plan,{initialState:'client'});
  assert.equal(rows.find(row=>row.register===5).value,0x87);
  assert.equal(rows.find(row=>row.register===4).value,0x27);
  assert.equal(rows.at(-1).value,0x26);assert.equal(f.sent.length,count);assert.deepEqual(f.api._getState(),before);
  const reset=f.api.build(b=>b.writeRegister(4,0x21).atSample(10).writeRegister(4,0x21));
  assert.equal((await f.api.compile(reset,{initialState:'reset'})).length,2);
  assert.equal(f.sent.length,count);await assert.rejects(f.api.compile(plan,{initialState:'reset'}),/initialize/);f.api.dispose();
});

for(const listeners of [false,true])test(`SID acknowledged capture and reusable snapshots (${listeners?'Worker':'Main'} port)`,async()=>{
  const f=fixture({listeners});f.api.initialize();const local=f.api._getState(),plan=f.api.build(b=>b.setVoice(0,{ring:true}));
  f.hold();let settled=false;
  const waiting=f.api.compile(plan).then(value=>{settled=true;return value;});await Promise.resolve();assert.equal(settled,false);
  assert(f.sent.at(-1).id);f.flush();await waiting;
  const snapshot=await f.api.captureState(),before=structuredClone(snapshot),count=f.sent.length;
  const a=await f.api.compile(plan,{initialState:snapshot});f.renderer.setVoice(0,{sync:true});
  const b=await f.api.compile(plan,{initialState:snapshot});assert.deepEqual(a,b);assert.deepEqual(snapshot,before);assert.equal(f.sent.length,count);
  assert.deepEqual(f.api._getState(),local);assert(Object.isFrozen(snapshot.state.registers));
  await assert.rejects(f.api.compile(plan,{initialState:{...snapshot,instanceId:'foreign'}}),/Incompatible/);
  await assert.rejects(f.api.compile(plan,{initialState:{...snapshot,state:{...snapshot.state,model:'8580'}}}),/model/);
  await assert.rejects(f.api.compile(plan,{initialState:{...snapshot,format:'tetorica-gameboy-state'}}),/format/);
  f.api.dispose();assert(f.closed);
});

test('SID immediate APIs preserve returns and annotate packed fields without making raw Gate writes partial',()=>{
  const f=fixture();assert.equal(f.api.initialize(),undefined);const count=f.sent.length;
  f.api.setVoice(0,{sync:true,attack:5,pulseWidth:1000});
  const rows=f.sent.slice(count);
  assert.deepEqual(rows.map(row=>[row.args[0],row.sidMask,row.preserveOwner]),[[2,255,true],[3,15,true],[5,240,true],[4,2,true]]);
  f.api.setFilter({volume:11,routing:3});assert.deepEqual(f.sent.slice(-2).map(row=>[row.args[0],row.sidMask]),[[23,7],[24,15]]);
  f.api.keyOn(0);assert.equal(f.sent.at(-1).sidMask,1);assert.equal(f.sent.at(-1).preserveOwner,undefined);
  f.api.writeRegister(4,0x21);assert.equal(f.sent.at(-1).sidMask,undefined);assert.equal(f.sent.at(-1).preserveOwner,undefined);
  const invalidCount=f.sent.length;assert.throws(()=>f.api.setVoice(0,{attack:2,waveform:'bad'}));assert.equal(f.sent.length,invalidCount);
  f.api.dispose();
});

test('SID schedule transactions are acknowledged, bounded and reject invalid local plans before sending',async()=>{
  const f=fixture();f.api.initialize();const plan=f.api.build(b=>b.noteOn(0,'C4').atSample(100).keyOff(0));
  const receipt=await f.api.schedule(plan,{name:'notes',repeatSeconds:.1});assert.equal(receipt.startFrame,256);
  const cap=f.api._timedOperations;
  await cap.stage('tx','loop:one','schedule',[plan,{name:'notes',repeatSeconds:.1}]);
  await cap.stage('tx','loop:one','clearSchedule',['old']);await cap.commit('tx','loop:one');await cap.abort('tx','loop:one');
  await cap.cancelOwner('loop:one');await cap.releaseOwner('loop:one');await f.api.clearSchedule('notes');
  const requests=f.sent.filter(row=>row.method==='sidTimed');assert.equal(new Set(requests.map(row=>row.id)).size,requests.length);
  assert.deepEqual(requests.map(row=>row.args[0].action),['schedule','stage','stage','commit','abort','cancelOwner','releaseOwner','clear']);
  assert(requests.slice(1,-1).every(row=>row.args[0].owner==='loop:one'));
  const count=f.sent.length;
  await assert.rejects(f.api.schedule(plan,{name:'notes',repeatSeconds:0}),/repeatSeconds/);
  await assert.rejects(f.api.schedule(plan,{name:'notes',extra:1}),/field/);
  await assert.rejects(cap.stage('tx','loop','not-a-method',[]),/Unsupported/);assert.equal(f.sent.length,count);
  f.api.dispose();assert.throws(()=>f.api.build(()=>{}),{name:'AbortError'});
});

test('SID Native timing and capture reject explicitly; complete local compilation needs no renderer',async()=>{
  const f=fixture({native:true});f.api.initialize();const plan=f.api.build(b=>b.keyOn(0)),count=f.sent.length;
  assert((await f.api.compile(plan,{initialState:'client'})).length>0);assert.equal(f.sent.length,count);
  await assert.rejects(f.api.captureState(),/Native is not supported/);await assert.rejects(f.api.schedule(plan,{name:'native'}),/Native is not supported/);
  assert.equal(await f.api._timedOperations.cancelOwner('loop'),false);assert.equal(f.sent.length,count);f.api.dispose();
});

test('borrowed SID facade rejects incomplete client shadows and model changes invalidate previous captures',async()=>{
  let model='6581',current=true;const f=fixture();
  const facade=attachSidTimedClient({get clock(){return SID_PAL_CLOCK;},get model(){return model;},isCurrent:()=>current,dispose(){}},
    {getConfig:()=>({clock:SID_PAL_CLOCK,model}),request:async(_method,[payload])=>{
      assert.equal(payload.action,'capture');return createSidTimedSnapshot({...f.renderer._getState(),model},{instanceId:'borrowed',frame:256,sampleRate:48000});
    }});
  const plan=facade.build(b=>b.setVoice(0,{sync:true}));
  await assert.rejects(facade.compile(plan,{initialState:'client'}),/Incomplete/);
  const snapshot=await facade.captureState();assert((await facade.compile(plan,{initialState:snapshot})).length>0);
  model='8580';await assert.rejects(facade.compile(plan,{initialState:snapshot}),/model/);
  assert.equal((await facade.captureState()).state.model,'8580');current=false;
  assert.throws(()=>facade.build(()=>{}),{name:'AbortError'});f.api.dispose();facade.dispose();
});

test('retiring borrowed SID diagnostics removes listeners without disposing the shared instrument',()=>{
  const handlers=new Set(),events=[];let disposed=0;
  const port={addEventListener(_type,fn){handlers.add(fn);},removeEventListener(_type,fn){handlers.delete(fn);},start(){}};
  for(let run=0;run<4;run++){
    const api=attachSidTimedClient({clock:SID_PAL_CLOCK,model:'6581',dispose(){disposed++;}},{instanceId:'borrowed:'+run},port);
    assert.equal(handlers.size,1);api._timedOperations.onError(event=>events.push(event));
    const old=[...handlers][0];assert.equal(api._timedOperations.detach(),true);assert.equal(api._timedOperations.detach(),false);
    assert.equal(handlers.size,0);assert.equal(disposed,0);
    old({data:{type:'sid-timed-error',message:'late error from old run'}});assert.equal(events.length,0);
    assert.throws(()=>api.build(()=>{}),{name:'AbortError'});
  }
});
