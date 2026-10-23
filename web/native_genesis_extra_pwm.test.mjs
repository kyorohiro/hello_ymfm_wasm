import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker,MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {PWM32XPlayback,createPWM32XClient} from './pwm32x_playback.js';
import {EXTRA_PWM_ADMISSION_ERRORS,createNativeGenesisExtraPwmEndpoint} from './native_genesis_extra_pwm.js';

const rpc=async(endpoint,message,timing)=>{const result=await endpoint.dispatch(message,timing);return result?.deferred?await result.deferred:result;};
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional PWM test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t,{holdResponse=()=>false}={}){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native PWM attempted Web Audio');}};
  const workers=[],url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class{
    constructor(){this.pending=[];this.messages=[];this.heldResponses=[];this.ready=false;workers.push(this);this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}this.messages.push(data);this.onmessage?.({data});});this.worker.on('error',error=>this.onerror?.({message:error.message}));}
    postMessage(message,transfer){if(holdResponse(message)){this.heldResponses.push([message,transfer]);return;}if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    releaseResponses(){for(const [message,transfer]of this.heldResponses.splice(0))this.worker.postMessage(message,transfer);}
    terminate(){return this.terminated??=this.worker.terminate();}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});return workers;
}
function fixture(t,{mode='genesis',future=false}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),queue=[],waiters=[],primary=new PWM32XPlayback({sampleRate:48000});let gate=null,commandGate=null,observerGate=null,rejection=null,offset=0;const started=Date.now(),now=()=>future?offset:Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,pwmClock:23011361,running:true});
  const source=instance=>({instance,playback:new PWM32XPlayback({sampleRate:48000}),reservations:[],outcomes:new Map()});
  const snapshot=(instance,after)=>{const s=rack.get(instance);if(!s)throw new DOMException('Disposed','AbortError');return {pwm:{...s.playback.getState(),registers:Array.from({length:5},(_,index)=>s.playback.read(index)),lastSchedule:s.outcomes.get(after)??s.lastSchedule,pendingCommands:queue.filter(c=>c.instance===instance&&c.message.id).map(c=>c.message.id)},sampleRate:48000,frame:status().frame,revision:calls.length};};
  function settle(){for(let i=waiters.length-1;i>=0;i--){const w=waiters[i];if(!rack.has(w.instance)){waiters.splice(i,1);w.reject(new DOMException('Disposed','AbortError'));}else if(!queue.some(c=>c.instance===w.instance&&c.message.id===w.after)){waiters.splice(i,1);w.resolve(snapshot(w.instance,w.after));}}}
  function cancelWhere(predicate){for(let i=queue.length-1;i>=0;i--)if(predicate(queue[i]))queue.splice(i,1);for(const s of rack.values())s.reservations=s.reservations.filter(c=>!predicate(c));}
  function apply(s,m,c={}){
    const p=s.playback;
    if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;return;}
    if(m.method==='cancel-main-owner'){cancelWhere(c=>c.instance===s.instance&&c.message.group===m.targetGroup);return;}
    if(m.method==='write')p.write(m.register,m.value);
    else if(m.method==='clock')p.setClock(m.hz);
    else if(m.method==='reset'){p.reset();s.reservations=[];}
    else if(m.method==='clear-schedule')s.reservations=[];
    else if(m.method==='stop-voices'){s.reservations=s.reservations.filter(entry=>m.group!==undefined&&entry.message.group!==m.group);p.chip.left=p.chip.right=null;p.chip.leftFifo=[];p.chip.rightFifo=[];}
    else if(m.method==='schedule-writes'){
      const baseFrame=Math.max(p.frame,m.baseFrame??p.frame);s.lastSchedule={id:m.id,baseFrame};s.outcomes.set(m.id,s.lastSchedule);
      for(const entry of m.entries)s.reservations.push({...c,entry:{...entry,frame:entry.frame+baseFrame}});
    }
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});const match=/^native_genesis_extra_pwm_(create|dispose|status)$/.exec(command);
    if(match){const op=match[1];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');rack.set(args.instance,source(args.instance));}if(op==='dispose'){rack.delete(args.instance);settle();return true;}if(args.after&&queue.some(c=>c.instance===args.instance&&c.message.id===args.after))return new Promise((resolve,reject)=>waiters.push({instance:args.instance,after:args.after,resolve,reject})).then(async value=>{if(observerGate)await observerGate.promise;return value;},async error=>{if(observerGate)await observerGate.promise;throw error;});return snapshot(args.instance,args.after);}
    if(command==='native_genesis_pwm_status')return {...primary.getState(),registers:Array.from({length:5},(_,i)=>primary.read(i))};
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();queue.length=0;settle();}
    if(command==='native_genesis_performance'&&args.op==='cancel-owner'){cancelWhere(c=>c.performance===args.performance&&c.owner===args.owner);settle();}
    if(command==='native_genesis_commands'){
      if(commandGate&&args.commands.some(c=>c.type==='extra-pwm'))await commandGate.promise;
      if(rejection&&args.commands.some(c=>c.type==='extra-pwm')){const value=rejection;rejection=null;throw Error(value);}
      for(const c of args.commands)if(c.type==='extra-pwm'){const s=rack.get(c.instance);if(!s)throw new DOMException('Disposed','AbortError');if(future&&c.frame>status().frame)queue.push(c);else apply(s,c.message,c);}else if(c.type==='pwm')apply({playback:primary,reservations:[]},c.message,c);
    }
    settle();return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());return {synth,runtime,calls,errors,logs,rack,queue,waiters,gate:value=>{gate=value;},commandGate:value=>{commandGate=value;},observerGate:value=>{observerGate=value;},reject:value=>{rejection=value;},commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]),advance(frame){offset=frame/48;for(const c of queue.splice(0).sort((a,b)=>a.frame-b.frame)){if(c.frame<=frame)apply(rack.get(c.instance),c.message,c);else queue.push(c);}for(const s of rack.values()){s.playback.frame=frame;for(const c of s.reservations.splice(0)){if(c.entry.frame<=frame)s.playback.write(c.entry.register,c.entry.value);else s.reservations.push(c);}}settle();}};
}
test('Native additional PWM keeps independent raw FIFO, clock, default duty mode and Mixer without Web Audio',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('pwm',{id:'a'});context.b=await createSoundChip('pwm',{id:'b'});`);const {a,b}=f.runtime.context;
  assert.equal(a.initialize,undefined);assert.equal(a.noteOn,undefined);assert.equal(a.clock,23011361);await a.write(0,5);await a.writeRegister(1,1000);await a.write(2,-1);await b.write(1,600);await b.write(3,100);
  assert.equal(await a.read(0),5);assert.equal(await a.read(1),1000);assert.equal(await b.read(1),600);assert.equal(await a.read(99),65535);assert.equal(f.commands().find(c=>c.message?.register===2).message.value,65535);
  const view=await f.synth.chipInspector.read('a');assert.equal(view.kind,'pwm');assert.equal(view.outputMode,'duty');assert.deepEqual(view.routing,{left:1,right:1});assert.equal(view.fifo.left.empty,false);assert.equal(view.fifo.right.empty,true);await a.setClock(12000000);assert.equal(a.clock,12000000);assert.equal(b.clock,23011361);
  f.synth.mixer.set('a',{volume:.3,pan:-.5});await f.synth.flush();assert.equal([...f.rack.values()][0].volume,.3);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.deepEqual(f.errors,[]);
});
test('Native additional PWM copies and validates entire reservation before admission and preserves equal-frame order',async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`context.a=await createSoundChip('pwm',{id:'a'});`);const a=f.runtime.context.a;
  const entries=[{frame:20,register:1,value:1},{frame:20,register:2,value:100},{frame:20,register:2,value:200}],pending=a.scheduleWrites(entries);entries[1].value=999;assert.equal(await pending,0);f.advance(20);assert.deepEqual([...f.rack.values()][0].playback.chip.leftFifo,[100,200]);
  const before=f.commands().length;await assert.rejects(a.scheduleWrites([{frame:1,register:2,value:4},{frame:-1,register:3,value:5}]),/scheduled frame/);await assert.rejects(a.write(5,10),/register/);await assert.rejects(a.setClock(1),/clock/);assert.equal(f.commands().length,before);await assert.rejects(f.runtime.playSource(`await createSoundChip('pwm',{clock:10000000});`),/supports/);assert.deepEqual(f.errors,[]);
});
test('Native additional PWM reserves future Worker data immediately and keeps applied clock completion outside control FIFO',async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.synth.start();const d=await f.synth.createExtraPwm({id:'a'}),e=d.endpoint;
  assert.deepEqual(await rpc(e,{method:'scheduleWrites',args:[[{frame:2,register:2,value:100}]],id:55},{time:.3,performance:1,owner:7}),{id:55,value:14400});const command=f.commands().find(c=>c.type==='extra-pwm'&&c.message.method==='schedule-writes');assert.equal(command.frame,0);assert.equal(command.message.baseFrame,14400);assert.equal(command.owner,7);assert.equal([...f.rack.values()][0].reservations[0].entry.frame,14402);
  const clock=rpc(e,{method:'clock',args:[12000000],id:56},{time:2,performance:1,owner:7});await until(()=>f.waiters.length===1);assert.equal(d.client.clock,23011361);await e.invoke('write',[1,700]);assert.equal((await e.read()).cycle,700);f.advance(96000);await clock;assert.equal(d.client.clock,12000000);assert.deepEqual(f.errors,[]);
});
test('Native additional PWM owner cancellation settles a future applied clock without blocking another control port',async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.synth.start();const d=await f.synth.createExtraPwm({id:'a'}),e=d.endpoint;
  const pending=rpc(e,{method:'clock',args:[12000000],id:1},{time:2,performance:1,owner:7}),cancelled=assert.rejects(pending,error=>error.name==='AbortError');await until(()=>f.waiters.length===1);
  e.cancelOwner(1,7);await f.synth.nativeRequest('native_genesis_performance',{op:'cancel-owner',performance:1,owner:7});await cancelled;
  await e.invoke('write',[1,500]);assert.equal((await e.read()).cycle,500);assert.equal(d.client.clock,23011361);assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});
test('Native additional PWM real Worker bridge admits sibling commands and owner cancellation while a future clock waits', {timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true}),gate=deferred();f.observerGate(gate);await f.runtime.playSource(`const a=await useSoundChip('pwm');liveLoop('blocked',async()=>{await a.setClock(12000000);log('unexpected-clock');await beat(100);});liveLoop('sibling',async()=>{await beat(.05);await a.write(1,600);log('sibling-admitted');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('blocked');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.waiters.length===1&&f.runtime.getKeyboardTarget());const observerIndex=f.calls.findIndex(c=>c.command==='native_genesis_extra_pwm_status'&&c.args.after!==undefined);
  await until(()=>f.logs.includes('sibling-admitted'));assert(f.calls.slice(observerIndex+1).some(c=>c.command==='native_genesis_commands'&&c.args.commands.some(command=>command.type==='extra-pwm'&&command.message.register===1)));
  f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));await until(()=>f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'));await until(()=>f.waiters.length===0);assert(!f.queue.some(c=>c.type==='extra-pwm'&&c.message.method==='clock'));assert(!f.logs.includes('unexpected-clock'));assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);gate.resolve();
});
test('Native additional PWM real Worker bridge disposal releases the native instance before its observer replies', {timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true}),gate=deferred();f.observerGate(gate);await f.runtime.playSource(`const a=await createSoundChip('pwm',{id:'blocked'});liveLoop('blocked',async()=>{await a.setClock(12000000);await beat(100);});`,{execution:'worker'});
  await until(()=>f.waiters.length===1);const device=[...f.synth.extraDevices.values()][0];device.dispose();await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_pwm_dispose')&&f.rack.size===0);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.state,'ready');gate.resolve();await tick();assert.deepEqual(f.errors,[]);
});
test('Native additional PWM concurrent reservation completions retain their own base frame',async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.synth.start();const d=await f.synth.createExtraPwm({id:'a'}),e=d.endpoint;
  const [one,two]=await Promise.all([rpc(e,{method:'scheduleWrites',args:[[{frame:2,register:2,value:111}]],id:11},{time:.3,performance:1,owner:1}),rpc(e,{method:'scheduleWrites',args:[[{frame:3,register:3,value:222}]],id:12},{time:.4,performance:1,owner:2})]);assert.deepEqual(one,{id:11,value:14400});assert.deepEqual(two,{id:12,value:19200});assert.deepEqual(f.errors,[]);
});
test('Native additional PWM a late older applied snapshot does not regress its public clock',async()=>{
  const old=deferred();let revision=0,clock=23011361,reads=0;
  const value=()=>({sampleRate:48000,frame:0,revision,pwm:{model:'mame',outputMode:'duty',clock,sampleRate:48000,currentFrame:0,queuedWrites:0,registers:[0,0,16384,16384,16384]}});
  const endpoint=createNativeGenesisExtraPwmEndpoint({session:1,generation:1,clock:{sampleRate:48000},isReady:()=>true,stopping:null,closing:false,frameAt:time=>time*48000,
    enqueue(command){if(command.message.method==='clock'){clock=command.message.hz;revision++;}},async flush(){},async nativeRequest(){return value();},async observeNativeSnapshot(){const result=value();if(++reads===1){await old.promise;return result;}return result;}});
  await endpoint.initialize();const first=endpoint.client.setClock(8000000);await until(()=>reads===1);await endpoint.client.setClock(12000000);assert.equal(endpoint.client.clock,12000000);old.resolve();await first;assert.equal(endpoint.client.clock,12000000);
});
test('Native additional PWM Stop preserves routing cycle and clock while Reset keeps output frame',async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`context.a=await createSoundChip('pwm',{id:'a'});`);const a=f.runtime.context.a;
  await a.write(0,5);await a.write(1,1000);await a.setClock(12000000);await a.scheduleWrites([{frame:100,register:4,value:777}]);await a.stopVoices();const s=[...f.rack.values()][0];assert.equal(s.reservations.length,0);assert.equal(await a.read(0),5);assert.equal(await a.read(1),1000);assert.equal(a.clock,12000000);f.advance(20);await f.synth.chipInspector.invoke('a','reset');assert.equal((await a.getState()).currentFrame,20);assert.equal(await a.read(0),0);assert.deepEqual(f.errors,[]);
});
for(const execution of ['main','worker'])test(`Native additional PWM ${execution} async continuation and loop cancellation preserve another owner's reservations`,{timeout:15000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await useSoundChip('pwm');let ready=false;liveLoop('one',async()=>{const s=await useSoundChip('pwm');await s.getState();await s.scheduleWrites([{frame:1000000,register:2,value:111}]);ready=true;log('one-ready');await beat(100);});liveLoop('two',async()=>{while(!ready)await beat(.001);const s=await useSoundChip('pwm');await s.read(0);await s.scheduleWrites([{frame:1000000,register:3,value:222}]);log('two-ready');await beat(100);});${execution==='main'?"context.cancel=()=>stopLoop('one');":"keyboard.bind('cancel',{noteOn(){stopLoop('one');log('cancelled');},noteOff(){},allNotesOff(){}});"}`,{execution});
  await until(()=>f.logs.includes('one-ready')&&f.logs.includes('two-ready')&&(execution==='main'||f.runtime.getKeyboardTarget()));const commands=f.commands().filter(c=>c.type==='extra-pwm'&&c.message.method==='schedule-writes');assert.equal(new Set(commands.map(c=>execution==='worker'?c.owner:c.message.group)).size,2);if(execution==='main')f.runtime.context.cancel();else{f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));}await f.synth.flush();const s=[...f.rack.values()][0];await until(()=>s.reservations.length===1);assert.equal(s.reservations[0].entry.value,222);assert.deepEqual(f.errors,[]);
});
for(const late of [false,true])test(`Native additional PWM Worker cancellation disposes ${late?'late response':'pending creation'}`,{timeout:10000},async t=>{
  const workers=installWorkers(t,{holdResponse:message=>late&&message.type==='response'&&message.value?.id==='pending'}),f=fixture(t),gate=deferred();if(!late)f.gate(gate);
  await f.runtime.playSource(`liveLoop('make',async()=>{const a=await createSoundChip('pwm',{id:'pending'});await a.write(0,5);await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('make');log('cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>(late?workers[0].heldResponses.length===1:f.calls.some(c=>c.command==='native_genesis_extra_pwm_create'))&&f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('cancelled'));if(!late)await until(()=>f.synth.extraDevices.size===0);if(late)workers[0].releaseResponses();else gate.resolve();await until(()=>!f.rack.size&&f.calls.some(c=>c.command==='native_genesis_extra_pwm_dispose'));assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-pwm'&&c.message.method==='write'));assert.deepEqual(f.errors,[]);
});
test('Native additional PWM shares primary in 32X mode, evicts cache, fences same-ID replacement and sixteen slots',async t=>{
  installWorkers(t);const f=fixture(t,{mode:'32x'});await f.runtime.playSource(`context.p=await useSoundChip('pwm');context.a=await createSoundChip('pwm',{id:'side'});context.api={useSoundChip,createSoundChip};`);assert.equal(f.runtime.context.p.id,'pwm');assert.equal(f.runtime.context.p.dispose,undefined);const token=f.synth.chipInspector.getConnectionToken('side');f.runtime.context.a.dispose();await f.runtime.playSource(`context.a=await createSoundChip('pwm',{id:'side'});context.api={useSoundChip,createSoundChip};`);assert.notEqual(f.synth.chipInspector.getConnectionToken('side'),token);for(let n=0;n<15;n++)await f.runtime.context.api.createSoundChip('pwm',{id:`n${n}`});await assert.rejects(f.runtime.context.api.createSoundChip('pwm'),/at most 16/);await f.runtime.stopWithFade();assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.deepEqual(f.errors,[]);
});
test('Native additional PWM Main pending creation cancellation and shared cache eviction release every reservation',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);await f.runtime.playSource(`liveLoop('make',async()=>{const a=await createSoundChip('pwm',{id:'pending'});await a.write(0,5);await beat(100);});context.cancel=()=>stopLoop('make');`);await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_pwm_create'));f.runtime.context.cancel();await until(()=>f.synth.extraDevices.size===0);gate.resolve();await until(()=>f.rack.size===0&&f.calls.some(c=>c.command==='native_genesis_extra_pwm_dispose'));f.gate(null);await f.runtime.playSource(`context.a=await useSoundChip('pwm');context.a.dispose();context.b=await useSoundChip('pwm');`);assert.notEqual(f.runtime.context.a,f.runtime.context.b);assert.equal(f.runtime.context.b.id,'pwm:shared');assert.equal(f.synth.extraDevices.size,1);assert.equal(f.synth.mixer.reservedIds.size,0);assert.deepEqual(f.errors,[]);
});
test('Native additional PWM stale in-flight controls cancel without failing a replacement with the same Mixer ID',async t=>{
  installWorkers(t);const f=fixture(t);await f.synth.start();const old=await f.synth.createExtraPwm({id:'same'}),gate=deferred();f.commandGate(gate);const loading=old.client.write(1,777),rejected=assert.rejects(loading,error=>error.name==='AbortError');await until(()=>f.commands().some(c=>c.type==='extra-pwm'&&c.message.method==='write'));old.dispose();const replacement=f.synth.createExtraPwm({id:'same'});gate.resolve();await rejected;const next=await replacement;assert.notEqual(next.nativeInstance,old.nativeInstance);assert.equal(await next.client.read(1),0);assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});
test('Native PWM client restores asynchronous owner and disposal bypasses a stopped loop guard',async t=>{
  const channel=new MessageChannel(),messages=[];let context={name:'one'},stopped=false;channel.port2.on('message',message=>messages.push(message));const client=createPWM32XClient(channel.port1,{native:true},{captureContext:()=>context,restoreContext:value=>{context=value;},isStopped:()=>stopped});t.after(()=>{client.dispose();channel.port2.close();});const read=client.read(0);context={name:'two'};await until(()=>messages.length);channel.port2.postMessage({id:messages[0].id,value:5});assert.equal(await read,5);assert.equal(context.name,'one');const next=client.getState(),rejected=assert.rejects(next,/stopped|disposed/);await until(()=>messages.length===2);stopped=true;channel.port2.postMessage({id:messages[1].id,value:{}});await rejected;client.dispose();await until(()=>messages.some(m=>m.method==='dispose'));
});
test('Native additional PWM explicit applied reads do not publish another inspector refresh',async t=>{
  installWorkers(t);const f=fixture(t);await f.synth.start();const d=await f.synth.createExtraPwm({id:'quiet'});let updates=0;const detach=f.synth.chipInspector.subscribe(()=>updates++);const before=updates;for(let n=0;n<3;n++)await f.synth.chipInspector.read('quiet');assert.equal(updates,before);await d.client.write(1,700);assert(updates>before);detach();assert.deepEqual(f.errors,[]);
});
test('Native additional PWM bounded admission failures reject without shutting down the audio session',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('pwm',{id:'a'});`);for(const message of EXTRA_PWM_ADMISSION_ERRORS){f.reject(message);await assert.rejects(f.runtime.context.a.scheduleWrites([{frame:1,register:2,value:123}]),error=>error.message===message);assert.equal(f.synth.state,'ready');}await f.runtime.context.a.write(1,600);assert.equal(await f.runtime.context.a.read(1),600);assert.deepEqual(f.errors,[]);
});
