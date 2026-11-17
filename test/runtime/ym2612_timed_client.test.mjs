import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,MessageChannel} from 'node:worker_threads';
import {createPlaygroundRuntime} from '../../tetorica_src/runtime/playground_runtime.js';
import {GameboySynth} from '../../tetorica_src/runtime/gameboysynth.js';
import {MegaSynth} from '../../tetorica_src/runtime/megasynth.js';
import {YM2612Synth} from '../../tetorica_src/runtime/ym2612synth.js';
import {createOpnClient} from '../../tetorica_src/runtime/playground_opn.js';
import {createWorkerChip} from '../../tetorica_src/runtime/playground_worker_chip.js';
import {createFmProxy} from '../../tetorica_src/runtime/playground_sync.js';
import {attachYm2612TimedClient} from '../../tetorica_src/runtime/ym2612_timed_client.js';
import {createYm2612OperationResetState} from '../../tetorica_src/runtime/ym2612_operations.js';
import {createYm2612TimedSnapshot} from '../../tetorica_src/runtime/ym2612_timed_state.js';
import {createPerformanceSender} from '../../tetorica_src/runtime/playground_performance_sender.js';
import {createAyTimedLifecycle} from '../../tetorica_src/runtime/playground_ay_timed_lifecycle.js';

function fixture({defer=false,native=false,events=false,bare=false,clientOptions={}}={}) {
  const sent=[],deferred=[],listeners=new Set(),state=createYm2612OperationResetState();
  state.registers[0][0x30]=0x72;
  const remote={state,instanceId:'one',clock:7670454,engine:'ymfm',frame:128,sampleRate:48000};
  let closed=0;
  const emit=data=>{port.onmessage?.({data});for(const listener of [...listeners])listener({data});};
  const port={start(){},close(){closed++;},postMessage(data){
    sent.push(data);
    if(data.id===undefined)return;
    const value=data.method==='ym2612Timed'&&data.args[0].action==='capture'?
      structuredClone(createYm2612TimedSnapshot(remote.state,remote)):{accepted:true,action:data.args?.[0]?.action};
    const answer=()=>emit({id:data.id,value});
    if(defer)deferred.push(answer);else queueMicrotask(answer);
  }};
  if(events){port.addEventListener=(_type,listener)=>listeners.add(listener);port.removeEventListener=(_type,listener)=>listeners.delete(listener);}
  const client=bare?attachYm2612TimedClient(new YM2612Synth({transport:{write(){},reset(){}}}),{native,...clientOptions},port):
    createOpnClient('ym2612',port,{native,...clientOptions});
  sent.length=0;
  return {client,remote,sent,deferred,emit,port,closed:()=>closed,listeners:()=>listeners.size,timed:()=>sent.filter(row=>row.method==='ym2612Timed')};
}
const bytes=rows=>rows.map(({port,register,value})=>[port,register,value]);

test('additive build records once, copies arguments and sends no request',async()=>{
  const f=fixture();try{
    const state=f.client.getState(),params={multi:3};let calls=0;
    const plan=f.client.build(b=>{calls++;b.atSample(100).setOperator(0,0,params);b.keyOn(0);});params.multi=7;
    assert.equal(calls,1);assert.equal(f.sent.length,0);assert.deepEqual(f.client.getState(),state);
    assert.deepEqual(bytes(await f.client.compile(plan,{initialState:'reset'})),[[0,0x30,3],[0,0x28,0xf0]]);
    assert.equal(f.sent.length,0);
  }finally{f.client.dispose();}
});

test('current/client/reset baselines stay distinct and leave live state unchanged',async()=>{
  const f=fixture();try{
    f.client.write(0,0x30,0x52);const before=f.client._getTimedState(),count=f.sent.length;
    const plan=f.client.build(b=>b.setOperator(0,0,{multi:3}));
    assert.deepEqual(bytes(await f.client.compile(plan)),[[0,0x30,0x73]]);
    assert.deepEqual(bytes(await f.client.compile(plan,{initialState:'client'})),[[0,0x30,0x53]]);
    assert.deepEqual(bytes(await f.client.compile(plan,{initialState:'reset'})),[[0,0x30,3]]);
    assert.equal(f.sent.length,count+1);assert.equal(f.timed().length,1);
    assert.deepEqual(f.client._getTimedState(),before);
  }finally{f.client.dispose();}
});

test('captured snapshots are frozen, reusable, compatible and do not communicate on reuse',async()=>{
  const f=fixture();try{
    const snapshot=await f.client.captureState(),saved=structuredClone(snapshot);
    assert(Object.isFrozen(snapshot));assert(Object.isFrozen(snapshot.registers[0]));
    const a=f.client.build(b=>b.setOperator(0,0,{multi:3})),b=f.client.build(b=>b.setOperator(0,0,{dt:1}));
    f.remote.state.registers[0][0x30]=0x11;f.client.setOperator(0,0,{dt:2});
    assert.deepEqual(bytes(await f.client.compile(a,{initialState:snapshot})),[[0,0x30,0x73]]);
    assert.deepEqual(bytes(await f.client.compile(b,{initialState:snapshot})),[[0,0x30,0x12]]);
    assert.deepEqual(snapshot,saved);assert.equal(f.timed().length,1);
    for(const change of [{instanceId:'other'},{engine:'nuked'},{clock:4000000},{version:2},{keyMasks:[]}])
      await assert.rejects(f.client.compile(a,{initialState:{...snapshot,...change}}));
    assert.equal(f.timed().length,1);
  }finally{f.client.dispose();}
});

test('unknown snapshot provenance and incomplete client state reject without fallback requests',async()=>{
  const f=fixture();try{
    const snapshot=createYm2612TimedSnapshot(f.remote.state,f.remote),plan=f.client.build(b=>b.keyOn(0));
    await assert.rejects(f.client.compile(plan,{initialState:snapshot}),/identity is unknown/);
    f.client._invalidateTimedState();await assert.rejects(f.client.compile(plan,{initialState:'client'}),/Incomplete/);
    assert.equal(f.sent.length,0);assert.equal((await f.client.compile(plan,{initialState:'reset'}))[0].value,240);
  }finally{f.client.dispose();}
});

test('compilation copies authored data before asynchronous capture and takes client state before yielding',async()=>{
  const f=fixture({defer:true});try{
    const plan=f.client.build(b=>b.setOperator(0,0,{multi:3})),result=f.client.compile(plan);
    plan.operations[0].args[2].multi=9;assert.equal(f.deferred.length,1);f.deferred.shift()();
    assert.equal((await result)[0].value,0x73);
    const local=f.client.compile(plan,{initialState:'client'});f.client.write(0,0x30,0x50);
    assert.equal((await local)[0].value,9);assert.equal(f.deferred.length,0);
  }finally{f.client.dispose();}
});

test('schedule/clear/staging copy arguments and preserve the private lifecycle protocol',async()=>{
  const f=fixture();try{
    const plan=f.client.build(b=>b.setOperator(0,0,{tl:30})),settings={name:'tone',repeatSeconds:0.01},cap=f.client._timedOperations;
    const receipt=f.client.schedule(plan,settings);plan.operations[0].args[2].tl=50;settings.repeatSeconds=2;await receipt;
    assert.equal(f.timed()[0].args[0].operations.operations[0].args[2].tl,30);
    assert.equal(f.timed()[0].args[0].options.repeatSeconds,0.01);
    await cap.stage('txn','owner','schedule',[plan,{name:'tone'}]);await cap.stage('txn','owner','clearSchedule',['other']);
    await cap.commit('txn','owner');await cap.abort('txn','owner');await cap.cancelOwner('owner');await cap.releaseOwner('owner');await f.client.clearSchedule('tone');
    assert.deepEqual(f.timed().map(row=>row.args[0].action),['schedule','stage','stage','commit','abort','cancelOwner','releaseOwner','clear']);
    const before=f.sent.length;
    for(const invalid of [{name:''},{name:'x',repeatSeconds:0},{name:'x',extra:true}])await assert.rejects(f.client.schedule(plan,invalid));
    await assert.rejects(f.client.compile(plan,{initialState:'invalid'}));await assert.rejects(f.client.compile(plan,{extra:true}));
    assert.equal(f.sent.length,before);
  }finally{f.client.dispose();}
});

for(const bare of [false,true])test(`disposal fences pending and later work (${bare?'explicit transport helper':'OPN port client'})`,async()=>{
  const f=fixture({defer:true,bare}),plan=f.client.build(b=>b.keyOn(0));
  const pending=f.client.captureState(),rejected=assert.rejects(pending,/disposed/);f.client.dispose();await rejected;
  const before=f.sent.length;assert.throws(()=>f.client.build(()=>{}),/disposed/);await assert.rejects(f.client.compile(plan,{initialState:'reset'}),/disposed/);
  await assert.rejects(f.client.schedule(plan,{name:'x'}),/disposed/);assert.equal(f.sent.length,before);
  if(!bare)assert.equal(f.closed(),1);
});

test('Native declines authoritative capture and scheduling explicitly; local inspection remains usable',async()=>{
  const f=fixture({native:true});try{
    f.client.reset();const plan=f.client.build(b=>b.setOperator(0,0,{tl:5})),count=f.sent.length;
    assert.equal((await f.client.compile(plan,{initialState:'client'}))[0].value,5);
    assert.equal((await f.client.compile(plan,{initialState:'reset'}))[0].value,5);
    for(const action of [()=>f.client.captureState(),()=>f.client.compile(plan),()=>f.client.schedule(plan,{name:'x'}),()=>f.client.clearSchedule('x')])await assert.rejects(action(),/Native is not supported/);
    assert.equal(await f.client._timedOperations.cancelOwner('owner'),false);assert.equal(f.sent.length,count);
  }finally{f.client.dispose();}
});

for(const events of [false,true])test(`nonfatal diagnostics detach and observer errors remain isolated (${events})`,()=>{
  const f=fixture({events}),received=[];try{
    f.client._timedOperations.onError(value=>received.push(value));
    f.emit({type:'ym2612-timed-error',message:'admission error',owner:'loop',session:1});
    assert.equal(received.length,1);assert(Object.isFrozen(received[0]));assert.equal(received[0].owner,'loop');
    f.client.dispose();f.emit({type:'ym2612-timed-error',message:'after dispose'});assert.equal(received.length,1);
    if(events)assert.equal(f.listeners(),0);
  }finally{f.client.dispose();}
});

test('Worker primary and Main facade expose detached timed data instead of cloning callbacks through observers',async()=>{
  const sent=[],observed=[],state=createYm2612OperationResetState(),seed=new YM2612Synth({transport:{write(){},reset(){}}});
  const port={postMessage:data=>sent.push(data),start(){},close(){}};
  const worker=createWorkerChip({port,capabilities:{chip:'ym2612'},state:{...seed.getState(),clock:7670454,timedState:state},observe:event=>observed.push(event)});
  const plan=worker.fm.build(b=>b.setOperator(0,0,{multi:3}));
  assert.deepEqual(bytes(await worker.fm.compile(plan,{initialState:'client'})),[[0,0x30,3]]);
  assert.equal(sent.length,0);assert.equal(observed.length,0);assert.equal(worker.fm._timedOperations,worker.raw._timedOperations);
  const main=createFmProxy(worker.raw);assert.equal(main._timedOperations,worker.raw._timedOperations);
  assert.deepEqual(main.build(b=>b.keyOn(0)).operations[0].method,'keyOn');
  worker.adoptState({...seed.getState(),clock:7670454});await assert.rejects(worker.fm.compile(plan,{initialState:'client'}),/Incomplete/);
  worker.raw.dispose();
});

test('YM RPC retains one performance timestamp and existing lifecycle stages and cancels its owner',async()=>{
  const f=fixture(),sent=[];let loop=null;
  const sender=createPerformanceSender({getLoop:()=>loop,now:()=>1000});sender.configure({session:3,audioSeconds:2,performanceEpochMs:1000,lookaheadSeconds:.15});
  const port=sender.port({postMessage:data=>sent.push(data)},'chip');
  port.postMessage({id:1,method:'ym2612Timed',args:[{action:'schedule'}]});
  assert.equal(sent[0].performance,undefined);assert.deepEqual(sent[0].timedPerformance,{session:3,owner:'script',time:2.15});
  const lifecycle=createAyTimedLifecycle({getLoop:()=>loop,setLoop:value=>{loop=value;},entryOwner:'script',loopOwner:value=>value.performanceOwner});
  try{
    const api=lifecycle.wrap(f.client),plan=api.build; // scope is checked on invocation, not property access.
    const transaction=lifecycle.begin();const operations=plan(b=>b.keyOn(0));await api.schedule(operations,{name:'entry'});await lifecycle.commit(transaction);
    assert.equal(f.timed().at(-1).args[0].action,'commit');assert.equal(f.timed().at(-1).args[0].owner,'script');
    loop={performanceOwner:'melody:1'};await api.schedule(operations,{name:'loop'});lifecycle.cancelLoop(loop);await Promise.resolve();
    assert.equal(f.timed().at(-1).args[0].action,'releaseOwner');assert.equal(f.timed().at(-1).args[0].owner,'melody:1');
  }finally{lifecycle.stop();f.client.dispose();}
});


async function until(predicate,label='asynchronous boundary') {
  for(let n=0;n<1000;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}
  assert.fail(`Did not reach ${label}`);
}

test('production Main Playground stages YM entry updates, preserves failed Apply and cancels on Stop',async(t)=>{
  const f=fixture(),previousWindow=globalThis.window,media=()=>({stop(){},stopAll(){},pause(){},list:()=>[],unload(){}});
  globalThis.window={addEventListener(){},removeEventListener(){},setTimeout};
  const megaDrive={capabilities:{chip:'ym2612',fmChannels:6,dac:false,psg:false},state:'idle',audioContext:{currentTime:0},
    fm:f.client,psg:{},sample:media(),stream:media(),clearFXChain:()=>[],
    async start(){this.state='ready';},async resume(){},async close(){}};
  const runtime=createPlaygroundRuntime({megaDrive,guardExecution:false});
  t.after(()=>{runtime.stop();f.client.dispose();globalThis.window=previousWindow;});
  const source=value=>`const fm=await useSoundChip("ym2612");await fm.schedule(fm.build(b=>b.setOperator(0,0,{tl:${value}})),{name:"entry"});`;
  await runtime.playSource(source(10));assert.deepEqual(f.timed().map(row=>row.args[0].action),['stage','commit']);
  assert.equal(runtime.getState().playback,'running');const previous=f.timed().length;
  await assert.rejects(runtime.playSource(source(20)+'throw Error("failed Apply");'),/failed Apply/);
  assert(f.timed().slice(previous).some(row=>row.args[0].action==='abort'));
  assert(!f.timed().slice(previous).some(row=>row.args[0].action==='commit'));
  assert.equal(runtime.getState().playback,'running');runtime.stop();await until(()=>f.timed().some(row=>row.args[0].action==='cancelOwner'));
});

test('production Worker primary preserves YM sample plans and owner metadata through Run and Apply',async(t)=>{
  const messages=[],commands=[],channel=new MessageChannel(),seed=new YM2612Synth({transport:{write(){},reset(){}}});
  const workerUrl=new URL('../../tetorica_src/runtime/playground_logic_worker.js',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});
  t.after(async()=>{channel.port1.close();channel.port2.close();await worker.terminate();});
  worker.on('message',message=>messages.push(message));worker.on('error',error=>messages.push({error:String(error.stack)}));
  channel.port1.on('message',data=>{
    commands.push(data);
    if(data.type?.startsWith('performance-')){channel.port1.postMessage({type:'performance-result',id:data.id,session:data.session});return;}
    if(data.id!==undefined)channel.port1.postMessage({id:data.id,value:{accepted:true}});
  });
  await until(()=>messages.some(message=>message.readyForTest),'worker import');
  worker.postMessage({type:'chip-port',state:{...seed.getState(),clock:7670454,timedState:seed._getTimedState()},port:channel.port2},[channel.port2]);
  const run=async sourceCode=>{
    const start=messages.length;
    worker.postMessage({type:'run',sourceCode,capabilities:{chip:'ym2612',fmChannels:6,dac:false,psg:false},performance:{session:1,audioSeconds:0,performanceEpochMs:performance.timeOrigin+performance.now(),lookaheadSeconds:.1}});
    await until(()=>messages.slice(start).some(message=>['complete','execution-error'].includes(message.type)||message.error),'worker evaluation');
    return messages.slice(start).find(message=>['complete','execution-error'].includes(message.type)||message.error);
  };
  const source='const fm=await useSoundChip("ym2612");const ops=fm.build(b=>{b.setOperator(0,0,{multi:3});b.atSample(10).keyOn(0);});await fm.schedule(ops,{name:"worker",repeatSeconds:.01});';
  const result=await run(source);assert.equal(result.type,'complete',JSON.stringify(result));assert.equal(result.scheduledReservationCount,1);
  const timed=commands.filter(command=>command.method==='ym2612Timed');assert.deepEqual(timed.map(row=>row.args[0].action),['stage','commit']);
  assert(timed.every(command=>command.timedPerformance.owner==='script'));assert.equal(timed[0].args[0].args[0].operations[1].time.value,10);
  const before=commands.length,failed=await run(source+'throw Error("failed Worker Apply");');assert.equal(failed.type,'execution-error');assert.equal(failed.scheduledReservationCount,1);
  assert(!commands.slice(before).some(command=>command.method==='ym2612Timed'&&command.args[0].action==='commit'));
  worker.postMessage({type:'stop'});await until(()=>messages.some(message=>message.type==='stopped'),'worker stop');
  assert(commands.some(command=>command.type==='performance-stop'));
});


test('known primary Nuked processors and explicit engine options preserve compilation identity without opening audio',async()=>{
  for(const workletUrl of ['./ym2612-worklet-nuked.js?v=test','https://example.test/synth_fm_worklet_nuked.js?v=test'])
    assert.equal(new MegaSynth({workletUrl}).engine,'nuked');
  assert.equal(new MegaSynth({workletUrl:'./custom.js',engine:'nuked'}).engine,'nuked');
  assert.equal(new MegaSynth({workletUrl:'./custom-nuked.js'}).engine,'ymfm','Arbitrary custom filenames do not infer an engine');
  assert.throws(()=>new MegaSynth({engine:'invalid'}),/engine/);
  const seed=new YM2612Synth({transport:{write(){},reset(){}}}),listeners=new Set();
  const port={start(){},postMessage(data){if(!data.id)return;const value=createYm2612TimedSnapshot(seed._getTimedState(),{clock:7670454,instanceId:'primary-nuked',engine:'nuked',frame:128,sampleRate:48000});queueMicrotask(()=>{port.onmessage?.({data:{id:data.id,value}});for(const listener of listeners)listener({data:{id:data.id,value}});});},addEventListener(_type,fn){listeners.add(fn);},removeEventListener(_type,fn){listeners.delete(fn);}};
  const worker=createWorkerChip({port,capabilities:{chip:'ym2612',engine:'nuked'},state:{...seed.getState(),clock:7670454,timedState:seed._getTimedState()}});
  try{assert.equal((await worker.fm.captureState()).engine,'nuked');}finally{worker.raw.dispose();}
});


test('production non-FM Game Boy Worker still starts and performs with a primary chip port',async(t)=>{
  const messages=[],commands=[],channel=new MessageChannel();
  const seed=new GameboySynth({transport:{writeRegister(){},reset(){}}});seed.initialize();
  const workerUrl=new URL('../../tetorica_src/runtime/playground_logic_worker.js',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(m,t)=>parentPort.postMessage(m,t);import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});
  t.after(async()=>{channel.port1.close();channel.port2.close();await worker.terminate();});
  worker.on('message',message=>messages.push(message));worker.on('error',error=>messages.push({error:String(error.stack)}));
  channel.port1.on('message',data=>{
    commands.push(data);
    if(data.type?.startsWith('performance-'))channel.port1.postMessage({type:'performance-result',id:data.id,session:data.session});
  });
  await until(()=>messages.some(message=>message.readyForTest),'Game Boy worker import');
  worker.postMessage({type:'chip-port',state:seed._getState(),port:channel.port2},[channel.port2]);
  worker.postMessage({type:'run',sourceCode:'const dmg=await useSoundChip("gameboy");dmg.pulse.setVoice(0,{duty:0.5});dmg.noteOn(0,"C4");dmg.keyOff(0);',capabilities:{chip:'gameboy',fmChannels:0,dac:false,psg:false},performance:{session:1,audioSeconds:0,performanceEpochMs:performance.timeOrigin+performance.now(),lookaheadSeconds:.1}});
  await until(()=>messages.some(message=>['complete','execution-error'].includes(message.type)||message.error),'Game Boy evaluation');
  const result=messages.find(message=>['complete','execution-error'].includes(message.type)||message.error);
  assert.equal(result.type,'complete',JSON.stringify(result));
  assert(commands.some(command=>command.performance&&command.commands.some(row=>row.method==='writeRegister')),'Game Boy still emits its ordinary register performance commands');
  worker.postMessage({type:'stop'});await until(()=>messages.some(message=>message.type==='stopped'),'Game Boy worker stop');
});
