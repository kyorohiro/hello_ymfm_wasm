import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';

const tick = () => new Promise(resolve=>setTimeout(resolve,1));
async function until(predicate) {
  const deadline=Date.now()+3000;
  while(!predicate()) { if(Date.now()>deadline) throw new Error('Additional PSG test timed out'); await tick(); }
}
function deferred() {let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function state() {return {clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,stereo:255,held:[],pendingCommands:[],sourceMuteMask:0};}
function installWorkers(t) {
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class {constructor(){throw new Error('Native extra PSG attempted Web Audio');}};
  const workers=[],url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class {
    constructor() {
      this.messages=[];this.pending=[];this.ready=false;workers.push(this);
      this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});
      this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}this.messages.push(data);this.onmessage?.({data});});
      this.worker.on('error',error=>this.onerror?.({message:error.message}));
    }
    postMessage(message,transfer) {if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    terminate() {return this.terminated??=this.worker.terminate();}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});
  return workers;
}
function fixture(t,{finalize=true,mode='genesis'}={}) {
  const calls=[],errors=[],logs=[],rack=new Map(),leases=new Map();let createGate;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:0,ymClock:7670454,psgClock:3579545,running:true});
  const snapshot=instance=>{const value=rack.get(instance);if(!value)throw Error('Additional PSG is not connected');return {segapsg:structuredClone(value),sampleRate:48000,frame:0,revision:calls.length};};
  function apply(s,m) {
    if(m.method==='batch') {for(const c of m.commands)apply(s,c);if(m.action==='on'){leases.get(s).set(m.channel,m.voice);}if(m.action==='off'&&leases.get(s).get(m.channel)===m.voice)leases.get(s).delete(m.channel);s.held=[...leases.get(s).keys()];return;}
    if(m.method==='write') {const v=m.value,r=v&128?v>>4&7:m.psgRegister??s.latched,ch=r>>1;s.latched=r;if(r&1){s.attenuations[ch]=v&15;if((v&15)!==15)s.lastVolumes[ch]=v&15;}else if(r===6)s.mode=v&7;else s.periods[ch]=v&128?(s.periods[ch]&1008)|(v&15):(s.periods[ch]&15)|((v&63)<<4);}
    else if(m.method==='clock') {if(s.held.length)throw Error('Release the manually held additional PSG voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='stereo')s.stereo=m.mask;
    else if(m.method==='key-off')s.attenuations[m.channel]=15;
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){Object.assign(s,state());leases.get(s).clear();}
    else if(m.method==='stop-voices'){s.attenuations.fill(15);s.held=[];leases.get(s).clear();}
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});
    if(command==='native_genesis_opl_status')return {ym3812:{chip:'ym3812',clock:3579545,registers:Array(256).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000},sampleRate:48000,frame:0,revision:0};
    if(command==='native_genesis_extra_psg_create') {if(createGate)await createGate.promise;if(rack.has(args.instance))throw Error('Duplicate PSG');const s=state();rack.set(args.instance,s);leases.set(s,new Map());return snapshot(args.instance);}
    if(command==='native_genesis_extra_psg_dispose'){rack.delete(args.instance);return true;}
    if(command==='native_genesis_extra_psg_status')return snapshot(args.instance);
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown')rack.clear();
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-psg'){const s=rack.get(c.instance);if(!s)throw Error('Additional PSG is not connected');apply(s,c.message);}
    return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,onError:error=>errors.push(error)});
  const runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  if(finalize)t.after(()=>runtime.finalize());
  return {synth,runtime,calls,errors,logs,rack,snapshot,gate:gate=>{createGate=gate;},commands:()=>calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[])};
}

test('Native Main owns two independent PSGs, stereo/clock/Mixer/Inspector and exact same-ID replacement',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`context.api={createSoundChip,useSoundChip};`);
  const {createSoundChip,useSoundChip}=f.runtime.context.api,first=await createSoundChip('segapsg',{id:'lead'}),second=await createSoundChip('segapsg',{id:'bass'});
  const primary=await useSoundChip('segapsg');assert.equal(primary.id,'segapsg');assert.notEqual(primary,first,'borrowed primary stays separate');
  assert.notEqual(first,second);assert.equal(f.synth.extraPsgDevices.size,2);
  const oldToken=f.synth.chipInspector.getConnectionToken('lead');
  const primaryStates=[];const unlisten=f.synth.addListener(event=>{if(event.type==='native-state')primaryStates.push(event);});
  first.tone(0,{period:345,attenuation:5});first.noise({type:'white',rate:'tone3',attenuation:8});first.setStereo(0x81);await first.setClock(4000000);
  second.tone(1,{period:678,attenuation:9});await f.synth.flush();
  let view=await f.synth.chipInspector.read('lead');assert.equal(view.clock,4000000);assert.equal(view.periods[0],345);assert.equal(view.mode,7);assert.equal(view.stereo,0x81);
  assert.deepEqual(primaryStates,[],'extra state cannot be published as primary PSG authoring state');unlisten();
  assert.equal((await f.synth.chipInspector.read('bass')).periods[1],678);
  assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]},'creating audio does not save project settings');
  f.synth.mixer.set('lead',{volume:.4,pan:-.3,solo:true});await f.synth.flush();
  assert.equal(f.rack.get(oldToken).volume,.4);assert.equal(f.rack.get(oldToken).pan,-.3);
  await f.synth.chipInspector.invoke('lead','auditionOn',[0,69,'held']);await assert.rejects(first.setClock(3000000),/manually held/);assert.equal(f.synth.state,'ready');
  await f.synth.chipInspector.invoke('lead','auditionOff',[0,'held']);await first.setClock(3000000);
  first.dispose();first.dispose();assert.throws(()=>first.tone(0,{note:'A4'}),/not ready|disposed/);
  const replacement=await createSoundChip('segapsg',{id:'lead'});assert.notEqual(f.synth.chipInspector.getConnectionToken('lead'),oldToken);replacement.tone(2,{note:'C4'});await f.synth.flush();
  assert.equal(f.synth.extraPsgDevices.size,2);assert.equal((await f.synth.chipInspector.read('bass')).periods[1],678);
  assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_psg_dispose'&&c.args.instance===oldToken).length,1);
  await assert.rejects(createSoundChip('segapsg',{id:'bass'}),/already/);
  await assert.rejects(createSoundChip('ym2610b',{id:'extra-fm'}),/Only additional .*chips are supported.*Select Web Audio/);
  await f.runtime.stopWithFade();assert.equal(f.rack.size,0);assert.equal(f.synth.extraPsgDevices.size,0);
  assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),['ym2612','segapsg']);
  assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.deepEqual(f.errors,[]);
});

test('Native source creation/disposal/repeated Run does not create persisted Mixer adjustments',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);
  for(const execution of ['main','worker','main','worker']) {
    await f.runtime.playSource(`const a=await createSoundChip('segapsg',{id:'lead'});const b=await createSoundChip('segapsg');a.tone(0,{note:'A4'});b.noise({type:'white',rate:'medium'});await a.setClock(4000000);a.dispose();const c=await createSoundChip('segapsg',{id:'lead'});c.tone(1,{note:'C4'});await c.setClock(3500000);`,{execution});
    await until(()=>f.commands().some(c=>c.type==='extra-psg'&&c.message.method==='clock'&&c.message.hz===3500000));
    assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});
    assert.equal(f.synth.extraPsgDevices.size,2);await f.runtime.stopWithFade();assert.equal(f.rack.size,0);assert.equal(f.synth.extraPsgDevices.size,0);
    assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});
  }
  const created=f.calls.filter(c=>c.command==='native_genesis_extra_psg_create').map(c=>c.args.instance);assert.equal(new Set(created).size,created.length);assert.equal(created.length,12);assert.deepEqual(f.errors,[]);
});

test('Native pending creation cancelled by Stop cannot leak a source, reserved ID or old handle',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip};`);
  const gate=deferred();f.gate(gate);const create=f.runtime.context.api.createSoundChip('segapsg',{id:'pending'});const rejected=assert.rejects(create,/cancelled|stopped|disposed/);
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_psg_create'));
  const stop=f.runtime.stopWithFade();gate.resolve();await rejected;await stop;
  assert.equal(f.rack.size,0);assert.equal(f.synth.extraPsgDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);
  f.gate(null);await f.runtime.playSource(`context.next=await createSoundChip('segapsg',{id:'pending'});`);assert.equal(f.runtime.context.next.id,'pending');assert.deepEqual(f.errors,[]);
});

test('Native DOS PC Main and actual Worker cache an added shared PSG and evict it on disposal',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{mode:'ym3812'});
  for(const execution of ['main','worker']) {
    const previous=f.calls.filter(c=>c.command==='native_genesis_extra_psg_create').length;
    await f.runtime.playSource(`const first=await useSoundChip('segapsg');if(first.id!=='segapsg:shared'||first!==await useSoundChip('segapsg'))throw Error('Shared added PSG was not cached');first.tone(0,{note:'A4'});await first.setClock(4000000);first.dispose();const replacement=await useSoundChip('segapsg');if(replacement===first||replacement.id!==first.id||replacement!==await useSoundChip('segapsg'))throw Error('Shared added PSG was not evicted');replacement.tone(1,{note:'C4'});await replacement.setClock(3500000);`,{execution});
    assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_psg_create').length-previous,2);
    assert.equal(f.synth.psg,null);assert.equal(f.rack.size,1);assert.equal(f.synth.extraPsgDevices.size,1);
    assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),['ym3812','segapsg:shared']);
    await f.runtime.stopWithFade();assert.equal(f.rack.size,0);
  }
  assert.deepEqual(f.errors,[]);
});

test('Actual Native Worker liveLoop cancellation retains the other additional PSG and its performance owner',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`context.a=await createSoundChip('segapsg',{id:'lead'});context.b=await createSoundChip('segapsg',{id:'bass'});liveLoop('owned-a',async()=>{context.a.tone(0,{period:333,attenuation:4});await beat(100);});liveLoop('owned-b',async()=>{context.b.tone(1,{period:555,attenuation:6});await beat(100);});keyboard.bind('cancel one',{async noteOn(){stopLoop('owned-a');context.b.setAttenuation(1,5);await context.b.setClock(4000000);log('cancelled-a');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>new Set(f.commands().filter(c=>c.type==='extra-psg'&&c.performance&&c.message.method==='write').map(c=>c.instance)).size===2);
  const ids=Object.fromEntries([...f.synth.extraPsgDevices.values()].map(device=>[device.client.id,device.nativeInstance]));
  const owner=id=>f.commands().find(c=>c.type==='extra-psg'&&c.performance&&c.instance===ids[id]&&c.message.method==='write').owner;
  const leadOwner=owner('lead'),bassOwner=owner('bass');assert.notEqual(leadOwner,bassOwner);
  await until(()=>f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel-a',midi:60});await until(()=>f.logs.includes('cancelled-a'));
  await until(()=>f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'&&c.args.owner===leadOwner));
  assert(!f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'&&c.args.owner===bassOwner));
  assert.equal(f.rack.size,2);assert.equal(f.rack.get(ids.bass).clock,4000000);assert.equal(f.rack.get(ids.bass).attenuations[1],5);assert.deepEqual(f.errors,[]);
});

test('Native extra admission is bounded and invalid IDs never allocate Native resources',async t=>{
  installWorkers(t);const f=fixture(t);await f.synth.start();
  for(const id of ['', 'x'.repeat(257),5])await assert.rejects(f.synth.createExtraSegaPsg({id}),/Mixer id/);
  const devices=await Promise.all(Array.from({length:16},(_,i)=>f.synth.createExtraSegaPsg({id:`extra-${i}`})));
  await assert.rejects(f.synth.createExtraSegaPsg({id:'overflow'}),/at most 16/);assert.equal(f.rack.size,16);
  devices[0].dispose();await f.synth.createExtraSegaPsg({id:'replacement'});assert.equal(f.rack.size,16);assert.deepEqual(f.errors,[]);
});

test('Native joined extra ports share primary owner IDs, never restart or stop the global performance',async t=>{
  installWorkers(t);const f=fixture(t,{finalize:false});await f.synth.start();const bridge=createNativeGenesisWorkerBridge({synth:f.synth}),host=createPerformanceHost({getContext:()=>f.synth.clock});
  t.after(async()=>{host.stop();await bridge.dispose();await f.runtime.finalize();});
  const clock=await host.start([bridge.port],.5),a=await f.synth.createExtraSegaPsg({id:'a',bridge}),b=await f.synth.createExtraSegaPsg({id:'b',bridge});
  await host.attach(a.node.port);await host.attach(b.node.port);
  assert.equal(f.calls.filter(c=>c.command==='native_genesis_performance'&&c.args.op==='start').length,1);
  const first={session:clock.session,owner:'loop-a',time:1};
  a.port.postMessage({performance:first,commands:[{method:'write',args:[0x95]}]});bridge.chipPort.postMessage({performance:first,commands:[{type:'psg-write',value:0x96}]});
  b.port.postMessage({performance:{...first,owner:'loop-b'},commands:[{method:'write',args:[0xb7]}]});
  await until(()=>f.commands().some(c=>c.type==='extra-psg'&&c.instance===a.nativeInstance&&c.performance)&&f.commands().some(c=>c.type==='psg-write'&&c.performance)&&f.commands().some(c=>c.type==='extra-psg'&&c.instance===b.nativeInstance&&c.performance));
  const commands=f.commands(),extra=commands.find(c=>c.type==='extra-psg'&&c.instance===a.nativeInstance&&c.performance),primary=commands.find(c=>c.type==='psg-write'&&c.performance),other=commands.find(c=>c.type==='extra-psg'&&c.instance===b.nativeInstance&&c.performance);
  assert.equal(extra.owner,primary.owner);assert.notEqual(extra.owner,other.owner);assert.equal(extra.frame,48000);
  a.node.port.postMessage({type:'performance-stop',session:clock.session});await tick();a.dispose();
  assert(!f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='stop'));
  b.port.postMessage({performance:{...first,owner:'loop-b'},commands:[{method:'write',args:[0xb6]}]});
  await until(()=>f.rack.get(b.nativeInstance).attenuations[1]===6);
  host.cancelOwner({session:clock.session,owner:'loop-a'});await until(()=>f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'));
  b.port.postMessage({performance:{...first,owner:'loop-b'},commands:[{method:'write',args:[0xb5]}]});await until(()=>f.rack.get(b.nativeInstance).attenuations[1]===5);
  assert.deepEqual(f.errors,[]);
});
