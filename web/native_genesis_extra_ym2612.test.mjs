import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createNativeGenesisExtraYm2612} from './native_genesis_extra_ym2612.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional YM2612 test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native YM2612 attempted Web Audio');}};
  const workers=[],url=new URL('./playground_logic_worker.js',import.meta.url).href;
  globalThis.Worker=class{
    constructor(){
      this.pending=[];this.messages=[];this.ready=false;workers.push(this);
      this.worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({readyForTest:true});});`,{eval:true});
      this.worker.on('message',data=>{if(data.readyForTest){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}this.messages.push(data);this.onmessage?.({data});});
      this.worker.on('error',error=>this.onerror?.({message:error.message}));
    }
    postMessage(message,transfer){if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    terminate(){return this.terminated??=this.worker.terminate();}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});return workers;
}
const ymState=(engine='ymfm')=>({engine,clock:7670454,registers:[Array(256).fill(0),Array(256).fill(0)],keyMasks:Array(6).fill(0),status:1,irq:true,held:[],pendingCommands:[],sourceMuteMask:0,channelMuteMask:0});
const psgState=()=>({clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,stereo:255,held:[],pendingCommands:[],sourceMuteMask:0});
function fixture(t,{mode='genesis'}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),leases=new Map();let gate=null,offset=0,engineResponse=null,statusGate=null;const started=Date.now(),now=()=>Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  const snapshot=(kind,instance)=>{const source=rack.get(instance);if(!source||source.kind!==kind)throw new Error('Additional sound chip is not connected');const state=structuredClone(source.state);if(kind==='ym2612'&&engineResponse)state.engine=engineResponse.value;return {[kind]:state,sampleRate:48000,frame:status().frame,revision:calls.length};};
  function apply(kind,s,m,audition=false){
    const held=leases.get(s);
    if(m.method==='batch'){
      if(m.action==='off'&&held.get(m.channel)!==m.voice)return;
      for(const command of m.commands)apply(kind,s,command,true);
      if(m.action==='on')held.set(m.channel,m.voice);else if(m.action==='off')held.delete(m.channel);
      s.held=[...held.keys()];return;
    }
    if(m.method==='clock'){if(held.size)throw new Error(`Release the manually held additional ${kind==='ym2612'?'YM2612':'PSG'} voices before changing the clock`);s.clock=m.hz;}
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){if(!held.size||audition){const clock=s.clock;Object.assign(s,kind==='ym2612'?ymState(s.engine):psgState(),{clock});held.clear();}}
    else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else if(m.method==='channel-mute')s.channelMuteMask=m.mask;
    else if(kind==='ym2612'){
      if(m.method==='write'){
        if(m.port===0&&m.register===0x28){const code=m.value&7,ch=(code&3)+(code&4?3:0);if((code&3)!==3&&(!held.has(ch)||audition))s.keyMasks[ch]=m.value>>4;}
        s.registers[m.port][m.register]=m.value;
      }else if(m.method==='key-off'){if(!held.has(m.channel)||audition){s.keyMasks[m.channel]=0;if(m.channel===2)s.registers[0][0x27]&=~0x81;if(m.channel===5)s.registers[0][0x2b]&=127;}}
      else if(m.method==='cancel-csm'){if(!held.has(2)||audition)s.registers[0][0x27]&=~0x81;}
      else if(m.method==='stop-voices')for(let ch=0;ch<6;ch++)if(!held.has(ch)||audition)s.keyMasks[ch]=0;
    }else if(m.method==='write'){
      const v=m.value,r=v&128?v>>4&7:m.psgRegister??s.latched,ch=r>>1;s.latched=r;
      if(r&1){s.attenuations[ch]=v&15;if((v&15)!==15)s.lastVolumes[ch]=v&15;}
      else if(r===6)s.mode=v&7;else s.periods[ch]=v&128?(s.periods[ch]&1008)|(v&15):(s.periods[ch]&15)|((v&63)<<4);
    }else if(m.method==='stereo')s.stereo=m.mask;
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});
    if(command==='native_genesis_opl_status')return {ym3812:{chip:'ym3812',clock:3579545,registers:Array(256).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000},sampleRate:48000,frame:status().frame,revision:0};
    const match=/^native_genesis_extra_(psg|ym2612)_(create|dispose|status)$/.exec(command);
    if(match){const kind=match[1]==='psg'?'segapsg':'ym2612',op=match[2];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');if(rack.has(args.instance))throw Error('Duplicate Native instance');const state=kind==='ym2612'?ymState(args.engine??'ymfm'):psgState();rack.set(args.instance,{kind,state});leases.set(state,new Map());}if(op==='dispose'){rack.delete(args.instance);return true;}const result=snapshot(kind,args.instance);if(op==='status'&&statusGate)await statusGate.promise;return result;}
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown')rack.clear();
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='extra-psg'||c.type==='extra-ym2612'){const source=rack.get(c.instance);if(!source)throw Error('Additional sound chip is not connected');apply(source.kind,source.state,c.message);}
    return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)});
  const runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());
  return {synth,runtime,calls,errors,logs,rack,gate:value=>{gate=value;},setEngineResponse:value=>{engineResponse=value;},setStatusGate:value=>{statusGate=value;},advance:ms=>{offset+=ms;},commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[])};
}

test('Native extra YM2612 Main has independent FM/DAC/timers, mixed PSG identities and read-only applied snapshots',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip,useSoundChip};`);
  const {createSoundChip,useSoundChip}=f.runtime.context.api,lead=await createSoundChip('ym2612',{id:'lead'}),psg=await createSoundChip('segapsg',{id:'pad'}),bass=await createSoundChip('ym2612',{id:'bass'});
  const primary=await useSoundChip('ym2612');assert.equal(primary.id,'ym2612');assert.notEqual(primary,lead);
  const devices=[...f.synth.extraDevices.values()];assert.deepEqual(devices.map(d=>d.nativeInstance),[1,2,3]);assert.equal(f.synth.extraYm2612Devices.size,2);assert.equal(f.synth.extraPsgDevices.size,1);
  const primaryEvents=[];const off=f.synth.addListener(event=>primaryEvents.push(event));
  lead.setAlgo(5,4,3);lead.setPan(5,true,false,2,5);lead.setOperator(5,1,{multi:3,tl:12,ar:31});lead.setNote(5,'A4');lead.keyOn(5);lead.setLfo(true,5);lead.setChannel3SpecialMode(true);lead.setChannel3SpecialFrequency(0,4,900);lead.setDacEnabled(true);lead.writeDac(192);lead.write(0,0x24,0x80);lead.write(0,0x27,0x85);
  bass.setNote(0,'C3');bass.keyOn(0);psg.tone(0,{period:350,attenuation:8});await lead.setClock(8000000);await f.synth.flush();
  const authored=lead._getState(),view=await f.synth.chipInspector.read('lead');assert.equal(view.kind,'ym2612');assert.equal(view.clock,8000000);assert.equal(view.fmState.channels[5].algorithm,4);assert.equal(view.fmState.channels[5].operators[1].tl,12);assert.equal(view.fmState.channels[5].left,true);assert.equal(view.fmState.channels[5].right,false);assert.equal(view.fmState.dac.enabled,true);assert.equal(view.fmState.dac.value,192);assert.equal(view.registers[0][0x24],0x80);assert.deepEqual(lead._getState(),authored,'applied reads cannot overwrite authored state');
  assert.equal(await lead.readStatus(),1);assert.equal(await lead.getIrq(),true);await assert.rejects(lead.read(1),/offset 0/);await assert.rejects(lead.dac.play(new Uint8Array([128]),{sampleRate:8000}),/additional Native YM2612/);
  assert.deepEqual(primaryEvents,[]);off();assert.equal((await f.synth.chipInspector.read('bass')).keyMasks[0],15);assert.equal((await f.synth.chipInspector.read('pad')).periods[0],350);
  assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});
  f.synth.mixer.set('lead',{volume:.4,pan:-.5,solo:true});await f.synth.flush();const applied=f.rack.get(devices[0].nativeInstance).state;assert.equal(applied.volume,.4);assert.equal(applied.pan,-.5);
  assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.deepEqual(f.errors,[]);
});

test('Native extra Nuked YM2612 Keyboard leases protect clock and stage operator edits without replacing another source',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.chip=await createSoundChip('ym2612',{id:'lead',engine:'nuked'});`);
  const chip=f.runtime.context.chip,inspector=f.synth.chipInspector;
  await inspector.invoke('lead','auditionOn',['fm:4',69,'old']);await inspector.invoke('lead','auditionOn',['fm:4',72,'new']);
  const before=f.commands().length;await inspector.invoke('lead','auditionOff',['fm:4','old']);assert.equal(f.commands().length,before);
  await assert.rejects(chip.setClock(8000000),/manually held/);assert.equal(chip.clock,7670454);assert.equal(f.synth.state,'ready');
  await inspector.invoke('lead','setOperator',[4,1,{tl:6,ar:25}]);assert.equal((await inspector.read('lead')).fmState.channels[4].operators[1].tl,6);assert.deepEqual((await inspector.read('lead')).held,['fm:4']);assert.equal(chip.channels[4].operators[1].tl,6);
  const badBefore=f.commands().length;await assert.rejects(inspector.invoke('lead','setOperator',[4,1,{tl:999}]),/tl/);assert.equal(f.commands().length,badBefore);
  await inspector.invoke('lead','auditionOff',['fm:4','new']);await chip.setClock(8000000);assert.equal(chip.clock,8000000);
  const old=inspector.getConnectionToken('lead');chip.dispose();await f.runtime.playSource(`context.next=await createSoundChip('ym2612',{id:'lead'});`);assert.notEqual(inspector.getConnectionToken('lead'),old);assert.throws(()=>chip.keyOn(0),/not ready|disposed/);assert.deepEqual(f.errors,[]);
});

test('Native extra YM2612 and PSG share one bounded rack; cancelled create releases IDs and shared cache',async t=>{
  installWorkers(t);const f=fixture(t,{mode:'ym3812'});await f.runtime.playSource(`context.api={createSoundChip,useSoundChip};`);const api=f.runtime.context.api;
  const gate=deferred();f.gate(gate);const creating=api.createSoundChip('ym2612',{id:'pending'}),rejected=assert.rejects(creating,/cancelled|stopped|disposed/);await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2612_create'));const stopping=f.runtime.stopWithFade();gate.resolve();await rejected;await stopping;assert.equal(f.rack.size,0);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);
  f.gate(null);await f.runtime.playSource(`context.api={createSoundChip,useSoundChip};`);const next=f.runtime.context.api,shared=await next.useSoundChip('ym2612');assert.equal(shared.id,'ym2612:shared');assert.equal(shared,await next.useSoundChip('ym2612'));shared.dispose();assert.notEqual(shared,await next.useSoundChip('ym2612'));
  for(let i=0;i<15;i++)await next.createSoundChip(i%2?'ym2612':'segapsg',{id:`chip-${i}`});assert.equal(f.synth.extraDevices.size,16);await assert.rejects(next.createSoundChip('ym2612'),/at most 16/);await assert.rejects(next.createSoundChip('segapsg'),/at most 16/);
  const created=f.calls.filter(c=>/^native_genesis_extra_(psg|ym2612)_create$/.test(c.command)).map(c=>c.args.instance);assert.equal(new Set(created).size,created.length);assert.deepEqual(f.errors,[]);
});

test('Native Main stopLoop releases only that additional FM and retains an inspector-held channel',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const lead=await createSoundChip('ym2612',{id:'lead'}),pad=await createSoundChip('segapsg',{id:'pad'});liveLoop('lead-loop',async()=>{lead.setNote(0,'A4');lead.keyOn(0);lead.setNote(1,'C5');lead.keyOn(1);await beat(100);});liveLoop('pad-loop',async()=>{pad.tone(0,{period:444,attenuation:6});await beat(100);});context.cancel=()=>stopLoop('lead-loop');`);
  await until(()=>f.commands().some(c=>c.type==='extra-ym2612'&&c.message.method==='write'&&c.message.register===0x28&&c.message.value===0xf1));
  await f.synth.chipInspector.invoke('lead','auditionOn',['fm:0',72,'manual']);f.runtime.context.cancel();await f.synth.flush();
  const view=await f.synth.chipInspector.read('lead');assert.equal(view.keyMasks[0],15);assert.equal(view.keyMasks[1],0);assert.deepEqual(view.held,['fm:0']);assert.equal((await f.synth.chipInspector.read('pad')).attenuations[0],6);assert.equal(f.rack.size,2);assert.deepEqual(f.errors,[]);
});

test('Native Main raw DAC/CSM ownership survives normal key-off and cancels without stopping another FM owner',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const chip=await createSoundChip('ym2612',{id:'lead'});liveLoop('csm',async()=>{chip.rawWrite(0,0x27,0x85);chip.keyOff(2);await beat(100);});liveLoop('dac',async()=>{chip.writeAddress(0,0x2b);chip.writeData(0x80);chip.write(0,0x2a,210);await beat(100);});liveLoop('normal',async()=>{chip.keyOn(2);chip.keyOn(5);await beat(100);});context.cancel=name=>stopLoop(name);context.editMode=()=>chip.setChannel3SpecialMode(true);context.chip=chip;`);
  await until(()=>f.commands().some(c=>c.type==='extra-ym2612'&&c.message.method==='write'&&c.message.register===0x28&&c.message.value===0xf6));
  f.runtime.context.cancel('csm');await f.synth.flush();let view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x27]&0x81,0);assert.equal(view.keyMasks[2],15,'CSM retirement preserves the other loop’s explicit CH3 key');assert(f.commands().some(c=>c.type==='extra-ym2612'&&c.message.method==='cancel-csm'));
  assert.equal(f.runtime.context.chip._getState().modeRegister&0x81,0);f.runtime.context.editMode();await f.synth.flush();view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x27]&0x81,0,'a later special-mode edit cannot resurrect retired CSM/Timer A');
  f.runtime.context.cancel('dac');await f.synth.flush();view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x2b]&128,0);assert.equal(view.keyMasks[5],15,'DAC retirement restores the other loop’s CH6 FM');
  f.runtime.context.cancel('normal');await f.synth.flush();view=await f.synth.chipInspector.read('lead');assert.equal(view.keyMasks[2],0);assert.equal(view.keyMasks[5],0);assert(f.commands().some(c=>c.type==='extra-ym2612'&&c.message.method==='key-off'&&c.message.channel===2));assert.deepEqual(f.errors,[]);
});

test('Native Main FM cancellation keeps other loops’ raw CSM and DAC sources active',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const chip=await createSoundChip('ym2612',{id:'lead'});liveLoop('normal',async()=>{chip.keyOn(2);chip.keyOn(5);await beat(100);});liveLoop('csm',async()=>{chip.writeAddress(0,0x27);chip.writeData(0x85);await beat(100);});liveLoop('dac',async()=>{chip.rawWrite(0,0x2b,0x80);chip.writeDac(210);await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.commands().some(c=>c.type==='extra-ym2612'&&c.message.method==='write'&&c.message.register===0x2a&&c.message.value===210));
  f.runtime.context.cancel('normal');await f.synth.flush();let view=await f.synth.chipInspector.read('lead');assert.equal(view.keyMasks[2],0);assert.equal(view.keyMasks[5],0);assert.equal(view.registers[0][0x27]&0x81,0x81);assert.equal(view.registers[0][0x2b]&128,128);
  f.runtime.context.cancel('csm');f.runtime.context.cancel('dac');await f.synth.flush();view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x27]&0x81,0);assert.equal(view.registers[0][0x2b]&128,0);assert.deepEqual(f.errors,[]);
});

test('Actual Native Worker extra YM2612 uses clock/status, mixed IDs, exact-instance edits and future disposal',{timeout:15000},async t=>{
  const workers=installWorkers(t),f=fixture(t,{mode:'ym3812'});
  await f.runtime.playSource(`const fm1=await useSoundChip('ym2612');const psg1=await createSoundChip('segapsg',{id:'pad'});const fm2=await createSoundChip('ym2612',{id:'bass'});fm1.setAlgo(0,7);fm1.setNote(0,'A4');fm1.keyOn(0);psg1.tone(0,{period:444,attenuation:6});fm2.setOperator(5,0,{tl:9});fm2.setDacEnabled(true);fm2.writeDac(170);await fm1.setClock(8000000);if(fm1.clock!==8000000||await fm1.readStatus()!==1||!await fm1.getIrq())throw Error('Native FM control acknowledgement lost');keyboard.bind('extra FM',{async noteOn(){if(fm1.getState().channels[0].operators[0].tl!==17)throw Error('Inspector author state not delivered');log('worker-state-ok');await beat(.2);fm1.dispose();const replacement=await useSoundChip('ym2612');if(replacement===fm1||replacement.id!==fm1.id)throw Error('Shared FM cache not evicted');replacement.setNote(1,'C4');await replacement.setClock(7500000);log('worker-replaced');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.runtime.getKeyboardTarget()&&f.commands().some(c=>c.type==='extra-ym2612'&&c.message.method==='clock'&&c.message.hz===8000000));
  const lead=[...f.synth.extraDevices.values()].find(d=>d.client.id==='ym2612:shared'),bass=[...f.synth.extraDevices.values()].find(d=>d.client.id==='bass');assert(lead&&bass);assert.notEqual(lead.nativeInstance,bass.nativeInstance);assert.equal(f.synth.extraDevices.size,3);
  const stateMessagesBefore=workers[0].messages.length;await f.synth.chipInspector.invoke('ym2612:shared','setOperator',[0,0,{tl:17}]);await tick();
  f.runtime.getKeyboardTarget().noteOn({id:'held',midi:60});await until(()=>f.logs.includes('worker-state-ok'));
  await until(()=>workers[0].messages.slice(stateMessagesBefore).some(m=>m.type==='command'&&m.command==='pcm.dispose'));
  assert(f.synth.extraDevices.has(lead.nativeInstance),'future Worker disposal retains the endpoint until audible time');
  f.advance(3000);await until(()=>f.logs.includes('worker-replaced'));assert(!f.synth.extraDevices.has(lead.nativeInstance));assert(f.synth.extraDevices.has(bass.nativeInstance));assert.equal(f.synth.extraDevices.size,3);
  assert(f.commands().some(c=>c.type==='extra-ym2612'&&c.performance&&c.frame>0));assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});
  await f.runtime.stopWithFade();assert.equal(f.rack.size,0);assert.equal(f.synth.extraDevices.size,0);assert.deepEqual(f.errors,[]);
});

test('Actual Native Worker cancellation addresses only the selected extra Nuked FM owner and preserves other chip leases',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2612',{id:'lead',engine:'nuked'}),b=await createSoundChip('segapsg',{id:'pad'});liveLoop('lead-loop',async()=>{a.setNote(0,'A4');a.keyOn(0);await beat(100);});liveLoop('pad-loop',async()=>{b.tone(1,{period:555,attenuation:5});await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('lead-loop');log('cancelled-lead');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>new Set(f.commands().filter(c=>c.performance&&['extra-ym2612','extra-psg'].includes(c.type)).map(c=>c.instance)).size===2);
  const lead=[...f.synth.extraDevices.values()].find(d=>d.client.id==='lead'),pad=[...f.synth.extraDevices.values()].find(d=>d.client.id==='pad'),leadOwner=f.commands().find(c=>c.instance===lead.nativeInstance&&c.performance&&c.message.method==='write'&&c.message.register===0x28).owner,padOwner=f.commands().find(c=>c.instance===pad.nativeInstance&&c.performance&&c.message.method==='write').owner;
  await f.synth.chipInspector.invoke('lead','auditionOn',['fm:0',72,'manual']);await until(()=>f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'&&c.args.owner===leadOwner));
  assert(!f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'&&c.args.owner===padOwner));assert.deepEqual((await f.synth.chipInspector.read('lead')).held,['fm:0']);assert.equal(f.rack.size,2);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2612 captures immutable engine selection and keeps mixed cores independent',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip,useSoundChip};`);
  const api=f.runtime.context.api,options={id:'nuked',engine:'nuked'},creating=api.createSoundChip('ym2612',options);options.engine='ymfm';
  const nuked=await creating,ymfm=await api.createSoundChip('ym2612',{id:'standard'});
  assert.equal(nuked.engine,'nuked');assert.equal(ymfm.engine,'ymfm');assert.equal(nuked._getState().engine,'nuked');
  assert.throws(()=>{nuked.engine='ymfm';},TypeError);assert.equal(Object.getOwnPropertyDescriptor([...f.synth.extraDevices.values()].find(device=>device.client.id==='nuked').client,'engine').configurable,false);
  assert.throws(()=>nuked._adoptState({...nuked._getState(),engine:'ymfm',clock:8000000}),/incompatible sound engine/);assert.equal(nuked.clock,7670454);
  const creates=f.calls.filter(c=>c.command==='native_genesis_extra_ym2612_create');assert.deepEqual(creates.map(c=>c.args.engine),['nuked','ymfm']);
  assert.equal(f.synth.extraYm2612Devices.size,2);assert.equal((await api.useSoundChip('ym2612')).id,'ym2612');
  nuked.setAlgo(5,7,2);nuked.noteOn(5,'A4');nuked.setDacEnabled(true);nuked.writeDac(187);ymfm.setAlgo(0,3,1);await f.synth.flush();
  const a=await f.synth.chipInspector.read('nuked'),b=await f.synth.chipInspector.read('standard');assert.equal(a.engine,'nuked');assert.equal(a.fmState.dac.value,187);assert.equal(b.engine,'ymfm');assert.equal(b.fmState.channels[0].algorithm,3);
  const listed=f.synth.chipInspector.list().find(entry=>entry.id==='nuked');assert.equal(listed.engine,'nuked');assert.match(listed.label,/Nuked/);
  nuked.reset();await f.synth.flush();assert.equal((await f.synth.chipInspector.read('nuked')).engine,'nuked');assert.deepEqual(f.errors,[]);
});

for(const engine of ['ymfm',undefined,'unknown'])test(`Native requested Nuked rejects ${String(engine)} snapshots before exposing a device`,async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip};`);f.setEngineResponse({value:engine});
  await assert.rejects(f.runtime.context.api.createSoundChip('ym2612',{id:'candidate',engine:'nuked'}),/incompatible sound engine/);
  await until(()=>!f.rack.size);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
  f.setEngineResponse(null);const next=await f.runtime.context.api.createSoundChip('ym2612',{id:'candidate',engine:'nuked'});assert.equal(next.engine,'nuked');
});

test('Native default ymfm supports legacy omitted engine but rejects explicit mismatched snapshots',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip};`);f.setEngineResponse({value:undefined});
  const chip=await f.runtime.context.api.createSoundChip('ym2612',{id:'legacy'});assert.equal((await f.synth.chipInspector.read('legacy')).engine,'ymfm');
  f.setEngineResponse({value:'nuked'});await assert.rejects(f.synth.chipInspector.read('legacy'),/incompatible sound engine/);assert.equal(chip.engine,'ymfm');assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});

test('Native invalid additional YM2612 engine is rejected before allocating an instance or making IPC',async t=>{
  installWorkers(t);const f=fixture(t);await f.synth.start();const before=f.calls.length,instance=f.synth.nextExtraChipInstance;
  for(const engine of [null,'YMFM','Nuked',false,0,{},[]])assert.throws(()=>createNativeGenesisExtraYm2612(f.synth,{id:'invalid',engine}),/engine/i);
  assert.equal(f.calls.length,before);assert.equal(f.synth.nextExtraChipInstance,instance);assert.equal(f.synth.extraDevices.size,0);
});

test('Native cancelled late Nuked create cannot dispose a same-ID ymfm replacement',async t=>{
  installWorkers(t);const f=fixture(t);await f.synth.start();const gate=deferred(),controller=new AbortController();f.gate(gate);
  const first=f.synth.createExtraYm2612({id:'same',engine:'nuked',signal:controller.signal}),rejected=assert.rejects(first,{name:'AbortError'});
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2612_create'));const old=[...f.synth.extraDevices.keys()][0];controller.abort();await rejected;
  f.gate(null);const replacing=f.synth.createExtraYm2612({id:'same',engine:'ymfm'});gate.resolve();const replacement=await replacing;
  await until(()=>!f.rack.has(old));assert.equal(f.rack.size,1);assert.equal(replacement.client.engine,'ymfm');assert.notEqual(replacement.nativeInstance,old);
  assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_ym2612_dispose'&&c.args.instance===old).length,1);assert(!f.calls.some(c=>c.command==='native_genesis_extra_ym2612_dispose'&&c.args.instance===replacement.nativeInstance));assert.deepEqual(f.errors,[]);
});

test('Native delayed Nuked snapshot is cancelled before it can adopt into a same-ID replacement',async t=>{
  installWorkers(t);const f=fixture(t);await f.synth.start();const previous=await f.synth.createExtraYm2612({id:'same',engine:'nuked'}),gate=deferred();f.setStatusGate(gate);
  const before=f.calls.length,reading=previous.endpoint.read(),rejected=assert.rejects(reading,{name:'AbortError'});await until(()=>f.calls.slice(before).some(c=>c.command==='native_genesis_extra_ym2612_status'));
  previous.dispose();f.setStatusGate(null);const replacing=f.synth.createExtraYm2612({id:'same',engine:'ymfm'});gate.resolve();await rejected;const replacement=await replacing;
  assert.equal(replacement.client.engine,'ymfm');assert.equal((await replacement.endpoint.read()).engine,'ymfm');assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
});

test('Actual Native Worker creates both YM2612 engines and reuses IDs across engine changes',{timeout:15000},async t=>{
  installWorkers(t);const f=fixture(t);
  for(const [aEngine,bEngine]of [['ymfm','nuked'],['nuked','ymfm']]){
    const start=f.calls.length;
    await f.runtime.playSource(`const a=await createSoundChip('ym2612',{id:'a',engine:'${aEngine}'}),b=await createSoundChip('ym2612',{id:'b',engine:'${bEngine}'});if(a.engine!=='${aEngine}'||b.engine!=='${bEngine}')throw Error('Worker engine mismatch');a.noteOn(0,'A4');b.noteOn(5,'C5');keyboard.bind('verify',{async noteOn(){if(a.getState().channels[0].operators[0].tl!==17||a.engine!=='${aEngine}'||b.engine!=='${bEngine}')throw Error('Worker engine or author state changed');log('engines-${aEngine}-${bEngine}');b.dispose();const replacement=await createSoundChip('ym2612',{id:'b',engine:'${aEngine}'});if(replacement.engine!=='${aEngine}'||b.engine!=='${bEngine}')throw Error('Worker engine identity mutated on replacement');replacement.noteOn(5,'G4');log('replacement-${aEngine}-${bEngine}');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
    await until(()=>f.runtime.getKeyboardTarget()&&f.synth.extraDevices.size===2);
    assert.deepEqual(f.calls.slice(start).filter(c=>c.command==='native_genesis_extra_ym2612_create').map(c=>c.args.engine),[aEngine,bEngine]);
    await f.synth.chipInspector.invoke('a','setOperator',[0,0,{tl:17}]);assert.equal((await f.synth.chipInspector.read('a')).engine,aEngine);assert.equal((await f.synth.chipInspector.read('b')).engine,bEngine);
    const old=[...f.synth.extraDevices.values()].find(device=>device.client.id==='b').nativeInstance;
    f.runtime.getKeyboardTarget().noteOn({id:'verify',midi:60});await until(()=>f.logs.includes(`engines-${aEngine}-${bEngine}`));f.advance(3000);await until(()=>f.logs.includes(`replacement-${aEngine}-${bEngine}`));
    assert.equal((await f.synth.chipInspector.read('b')).engine,aEngine);assert(!f.rack.has(old));assert.equal(f.synth.extraDevices.size,2);
    await f.runtime.stopWithFade();assert.equal(f.rack.size,0);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);
  }
  assert.deepEqual(f.errors,[]);
});
