import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional YM2203 test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native YM2203 attempted Web Audio');}};
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
const ymState=()=>({clock:4000000,registers:[Array(256).fill(0)],keyMasks:[0,0,0],ssgLevels:[0,0,0],ssgGates:[false,false,false],prescaler:6,status:1,irq:true,held:[],pendingCommands:[],sourceMuteMask:0,channelMuteMask:0,schedule:{token:0,playing:false,ended:false,cancelled:false,pending:false}});
const otherState=kind=>kind==='ym2612'?{clock:7670454,registers:[Array(256).fill(0),Array(256).fill(0)],keyMasks:Array(6).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,channelMuteMask:0}:{clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,stereo:255,held:[],pendingCommands:[],sourceMuteMask:0};
function fixture(t,{mode='genesis'}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),leases=new Map(),groups=new Map(),schedules=new Map();let gate=null,offset=0;const started=Date.now(),now=()=>Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  const snapshot=(kind,instance)=>{const source=rack.get(instance);if(!source||source.kind!==kind)throw Error('Additional sound chip is not connected');return {[kind]:structuredClone(source.state),sampleRate:48000,frame:status().frame,revision:calls.length};};
  function cancelSchedule(s){const entry=schedules.get(s);if(entry){for(const timer of entry.timers)clearTimeout(timer);schedules.delete(s);s.schedule={...s.schedule,playing:false,pending:false,cancelled:true};}}
  function apply(kind,s,m,audition=false,owner,group=m.group){
    const held=leases.get(s),owned=groups.get(s);
    if(m.method==='batch'){
      if(m.action==='off'&&held.get(m.channel)!==m.voice)return;
      for(const command of m.commands)apply(kind,s,command,true,owner,group);
      if(m.action==='on'){held.set(m.channel,m.voice);owned.delete(m.channel);}else if(m.action==='off')held.delete(m.channel);s.held=[...held.keys()];return;
    }
    if(m.method==='clock'){if(held.size)throw Error('Release the manually held additional YM2203 voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){
      if(kind==='ym2203')cancelSchedule(s);if(!held.size||audition){const clock=s.clock;Object.assign(s,kind==='ym2203'?ymState():otherState(kind),{clock});held.clear();owned.clear();}
    }else if(m.method==='schedule'){
      if(schedules.has(s))throw Error('Native YM2203 schedule already playing or pending');const entry={owner,group,timers:[]};schedules.set(s,entry);s.schedule={token:m.token,playing:true,pending:false,ended:false,cancelled:false};
      for(const [sample,register,value]of m.entries)entry.timers.push(setTimeout(()=>{if(schedules.get(s)===entry)apply(kind,s,{method:'write',port:0,register,value},false,owner,group);},sample/44.1));
      entry.timers.push(setTimeout(()=>{if(schedules.get(s)!==entry)return;schedules.delete(s);s.schedule={...s.schedule,playing:false,ended:true};},m.durationSamples/44.1));
    }else if(m.method==='cancel-schedule'){if(s.schedule.token===m.token)cancelSchedule(s);}
    else if(m.method==='cancel-main-owner'){
      if(schedules.get(s)?.group===m.targetGroup)cancelSchedule(s);
      for(const [ch,g]of [...owned])if(g===m.targetGroup){owned.delete(ch);if(ch==='csm'){if(!held.has(2))s.registers[0][0x27]&=~0x81;}else apply(kind,s,{method:'key-off',channel:ch},false,owner,undefined);}
    }
    else if(m.method==='set-retained-level')s.ssgLevels[m.channel]=m.level;
    else if(m.method==='cancel-csm'){if(!held.has(2)||audition){s.registers[0][0x27]&=~0x81;owned.delete('csm');}}
    else if(m.method==='key-off'){
      if(!held.has(m.channel)||audition){if(m.channel<3){s.keyMasks[m.channel]=0;if(m.channel===2&&!owned.has('csm'))s.registers[0][0x27]&=~0x81;}else{s.registers[0][8+m.channel-3]=0;s.ssgGates[m.channel-3]=false;}owned.delete(m.channel);}
    }else if(m.method==='write'&&kind==='ym2203'){
      const {register:r,value:v}=m,ch=r<=5?3+(r>>1):r>=8&&r<=10?3+r-8:r===0x28?v&3:r>=0x24&&r<=0x27?2:r>=0xa0&&r<=0xa6?r&3:null;
      if(ch!==null&&held.has(ch)&&!audition)return;
      const target=r===0x28?v&3:r>=8&&r<=10?3+r-8:r===0x27?'csm':null,on=r===0x28?!!(v&240):r===0x27?(v&0x81)===0x81:!!(v&31);
      if(target!==null&&!on&&group!==undefined&&owned.has(target)&&owned.get(target)!==group)return;
      s.registers[0][r]=v;if(r===0x28&&(v&3)<3)s.keyMasks[v&3]=v>>4;
      if(target!==null){if(on)owned.set(target,group);else owned.delete(target);}
      if(r>=8&&r<=10){if(v&31)s.ssgLevels[r-8]=v&31;s.ssgGates[r-8]=!!(v&31);}
      if(r===0x2d)s.prescaler=6;else if(r===0x2e&&s.prescaler===6)s.prescaler=3;else if(r===0x2f)s.prescaler=2;
    }else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else if(m.method==='channel-mute')s.channelMuteMask=m.mask;
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});
    if(command==='native_genesis_opl_status')return {ym3812:{chip:'ym3812',clock:3579545,registers:Array(256).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000},sampleRate:48000,frame:status().frame,revision:0};
    const match=/^native_genesis_extra_(psg|ym2612|ym2203)_(create|dispose|status)$/.exec(command);
    if(match){const kind=match[1]==='psg'?'segapsg':match[1],op=match[2];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');if(rack.has(args.instance))throw Error('Duplicate instance');const state=kind==='ym2203'?ymState():otherState(kind);rack.set(args.instance,{kind,state});leases.set(state,new Map());groups.set(state,new Map());}if(op==='dispose'){const state=rack.get(args.instance)?.state;if(state)cancelSchedule(state);rack.delete(args.instance);return true;}return snapshot(kind,args.instance);}
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){for(const {state}of rack.values())cancelSchedule(state);rack.clear();}
    if(command==='native_genesis_performance'&&args.op==='cancel-owner')for(const [s,schedule]of schedules)if(schedule.owner===args.owner)cancelSchedule(s);
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type.startsWith('extra-')){const source=rack.get(c.instance);if(!source)throw Error('Additional sound chip is not connected');apply(source.kind,source.state,c.message,false,c.owner);}
    return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());
  return {synth,runtime,calls,errors,logs,rack,gate:value=>{gate=value;},advance:ms=>{offset+=ms;},commands:()=>calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[])};
}

test('Native additional YM2203 Main owns FM/SSG, shared noise/envelope, retained zero, prescaler and isolated Mixer',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip,useSoundChip};`);const api=f.runtime.context.api;
  const a=await api.createSoundChip('ym2203',{id:'lead'}),b=await api.createSoundChip('ym2203',{id:'bass'});await api.createSoundChip('segapsg',{id:'tone'});await api.createSoundChip('ym2612',{id:'fm6'});
  assert.deepEqual([...f.synth.extraDevices.keys()],[1,2,3,4]);assert.equal((await api.useSoundChip('ym2612')).id,'ym2612');
  a.setAlgo(2,4,3);a.setOperator(2,1,{tl:7,ar:31,multi:3});a.setNote(2,'A4');a.keyOn(2);a.ssg.tone(0,{period:333,volume:9});a.ssg.keyOff(0);
  b.ssg.noise(1,{period:13,volume:11,envelope:true});b.ssg.setEnvelope({period:12345,shape:10});await a.setClock(5000000);await f.synth.flush();
  let view=await f.synth.chipInspector.read('lead');assert.equal(view.kind,'ym2203');assert.equal(view.fmState.channels.length,3);assert.equal(view.fmState.channels[2].operators[1].tl,7);assert.equal(view.ssgLevels[0],9);assert.equal(view.registers[0][8],0);assert.equal(a.clock,5000000);assert.equal(a.ssg.clock,2500000);
  a.ssg.keyOn(0);await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).registers[0][8],9);
  a.ssg.setVolume(0,0);await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).ssgLevels[0],0);a.ssg.keyOn(0);await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).registers[0][8],0);
  const other=await f.synth.chipInspector.read('bass');assert.equal(other.registers[0][6],13);assert.equal(other.ssgLevels[1],16);assert.equal(other.registers[0][13],10);assert.equal(other.registers[0][11]|other.registers[0][12]<<8,12345);
  a.write(0,0x2f,0);await f.synth.flush();view=await f.synth.chipInspector.read('lead');assert.equal(view.prescaler,2);const authored=a._getState();await f.synth.chipInspector.read('lead');assert.deepEqual(a._getState(),authored);
  assert.equal(await a.readStatus(),1);assert.equal(await a.getIrq(),true);assert.equal(a.clearScheduledWrites,undefined);assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});f.synth.mixer.set('lead',{volume:.4,pan:-.5});await f.synth.flush();assert.equal(f.rack.get(1).state.volume,.4);assert.equal(f.rack.get(2).state.volume,1);assert.equal(f.synth.audioContext,null);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 FM/SSG editor edits preserve separate snapshots and manual leases',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2203',{id:'lead'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  a.ssg.setVolume(0,9);a.ssg.keyOff(0);await f.synth.flush();await i.invoke('lead','auditionOn',['fm:2',69,'fm']);await i.invoke('lead','auditionOn',['ssg:0',72,'ssg']);await assert.rejects(a.setClock(4500000),/manually held/);assert.equal(f.synth.state,'ready');
  await i.invoke('lead','setOperator',[2,1,{tl:11}]);await i.invoke('lead','ssg.setTonePeriod',[0,555]);await i.invoke('lead','ssg.setMixer',[0,{tone:true,noise:true}]);await i.invoke('lead','ssg.setVolume',[0,7,true]);await i.invoke('lead','ssg.write',[6,17]);await i.invoke('lead','ssg.setEnvelope',[{period:1234,shape:9}]);
  const snapshot=await i.read('lead');assert.equal(snapshot.fmState.channels[2].operators[1].tl,11);assert.equal(snapshot.registers[0][0]|snapshot.registers[0][1]<<8,555);assert.equal(snapshot.ssgLevels[0],16);assert.equal(snapshot.registers[0][6],17);assert.equal(snapshot.registers[0][13],9);assert.deepEqual(snapshot.held,['fm:2','ssg:0']);assert.equal(a._getState().ssg.levels[0],16);
  const before=f.commands().length;await assert.rejects(i.invoke('lead','ssg.setVolume',[0,100]),/volume/);assert.equal(f.commands().length,before);
  await i.invoke('lead','auditionAllOff');assert.deepEqual((await i.read('lead')).held,[]);await a.setClock(4500000);assert.equal(a.clock,4500000);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 Main schedule resolves on completion, reset cancels and validates before upload',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2203',{id:'lead'});`);const a=f.runtime.context.a;
  const start=Date.now();await a.scheduleRegisters([[0,8,9],[882,8,0]],882);assert(Date.now()-start>=15);assert((await f.synth.chipInspector.read('lead')).schedule.ended);
  const before=f.commands().length;for(const entries of [[[4,8,9],[3,8,0]],[[0,300,0]],[[0,8,300]]])await assert.rejects(a.scheduleRegisters(entries,10));assert.equal(f.commands().length,before);
  await assert.rejects(a.scheduleRegisters(Array.from({length:257},()=>[0,8,9]),882),/256 writes in 128 output frames/);
  await assert.rejects(a.scheduleRegisters([...Array.from({length:256},()=>[0,8,9]),[116,8,9]],882),/256 writes in 128 output frames/);
  await assert.rejects(a.scheduleRegisters(Array.from({length:131073},()=>[0,8,9]),882),/131072/);
  assert.equal(f.commands().length,before,'schedule workload validation finishes before uploading any Native data');
  await a.scheduleRegisters([...Array.from({length:256},()=>[0,8,9]),[117,8,9]],882);
  const playing=a.scheduleRegisters([[0,8,10],[44100,8,0]],44100),rejected=assert.rejects(playing,/cancel/);await until(()=>f.commands().some(c=>c.message?.method==='schedule'&&c.message.durationSamples===44100));await assert.rejects(a.scheduleRegisters([],441),/already playing/);a.reset();await rejected;
  await a.scheduleRegisters([[0,8,6],[441,8,0]],441);assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 Main raw CSM cancellation preserves another FM owner and cannot resurrect cached Timer A',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2203',{id:'lead'});liveLoop('csm',async()=>{a.writeAddress(0,0x27);a.writeData(0x85);a.keyOff(2);await beat(100);});liveLoop('normal',async()=>{a.keyOn(2);await beat(100);});context.cancel=name=>stopLoop(name);context.editMode=()=>a.setChannel3SpecialMode(true);context.a=a;`);
  await until(()=>f.commands().some(c=>c.type==='extra-ym2203'&&c.message.method==='write'&&c.message.register===0x28&&c.message.value===0xf2));
  f.runtime.context.cancel('csm');await f.synth.flush();let view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x27]&0x81,0);assert.equal(view.keyMasks[2],15);assert.equal(f.runtime.context.a._getState().modeRegister&0x81,0);
  f.runtime.context.editMode();await f.synth.flush();view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x27]&0x81,0);
  f.runtime.context.cancel('normal');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).keyMasks[2],0);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 Main stopLoop releases its SSG and schedule without stopping sibling/manual voices',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2203',{id:'lead'}),b=await createSoundChip('ym2203',{id:'bass'});liveLoop('ssg',async()=>{a.ssg.tone(0,{period:333,volume:9});a.ssg.tone(1,{period:444,volume:8});await beat(100);});liveLoop('schedule',async()=>{await b.scheduleRegisters([[0,8,10],[44100,8,0]],44100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.commands().some(c=>c.type==='extra-ym2203'&&c.message.method==='schedule'));
  await f.synth.chipInspector.invoke('lead','auditionOn',['ssg:0',69,'manual']);f.runtime.context.cancel('ssg');await f.synth.flush();let s=await f.synth.chipInspector.read('lead');assert.equal(s.registers[0][8],9);assert.equal(s.registers[0][9],0);assert.deepEqual(s.held,['ssg:0']);assert((await f.synth.chipInspector.read('bass')).schedule.playing);
  f.runtime.context.cancel('schedule');await f.synth.flush();assert((await f.synth.chipInspector.read('bass')).schedule.cancelled);assert.equal(f.rack.size,2);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 creation Stop race and mixed 16-chip admission use unique identities',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip};`);const gate=deferred();f.gate(gate);const promise=f.runtime.context.api.createSoundChip('ym2203',{id:'pending'}),rejected=assert.rejects(promise,/cancelled|stopped|disposed/);await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2203_create'));const stop=f.runtime.stopWithFade();gate.resolve();await rejected;await stop;assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);
  f.gate(null);await f.runtime.playSource(`context.api={createSoundChip};`);for(let index=0;index<16;index++)await f.runtime.context.api.createSoundChip(['ym2203','ym2612','segapsg'][index%3],{id:`chip-${index}`});await assert.rejects(f.runtime.context.api.createSoundChip('ym2203'),/at most 16/);const ids=f.calls.filter(c=>c.command.endsWith('_create')).map(c=>c.args.instance);assert.equal(new Set(ids).size,ids.length);assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 Main owner groups preserve raw/scheduled replacements and completed voices across repeated timelines',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2203',{id:'lead'});liveLoop('raw-a',async()=>{a.keyOn(0);await beat(100);});liveLoop('scheduled-b',async()=>{await a.scheduleRegisters([[0,0x28,0xf0]],441);log('b-complete');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.logs.includes('b-complete'));f.runtime.context.cancel('raw-a');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).keyMasks[0],15);f.runtime.context.cancel('scheduled-b');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).keyMasks[0],0);
  await f.runtime.stopWithFade();await f.runtime.playSource(`const a=await createSoundChip('ym2203',{id:'lead'});liveLoop('scheduled-a',async()=>{await a.scheduleRegisters([[0,0x28,0xf0]],441);log('a-complete');await beat(100);});liveLoop('raw-b',async()=>{await sleep(.03);a.keyOn(0);log('raw-b-started');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.logs.includes('raw-b-started'));f.runtime.context.cancel('scheduled-a');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).keyMasks[0],15);f.runtime.context.cancel('raw-b');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).keyMasks[0],0);
  await f.runtime.stopWithFade();const start=f.commands().length;
  await f.runtime.playSource(`const a=await createSoundChip('ym2203',{id:'lead'});liveLoop('several',async()=>{for(let i=0;i<10;i++)await a.scheduleRegisters([[0,0x28,0xf0],[0,9,8]],441);log('several-complete');await beat(100);});liveLoop('bad',async()=>{await sleep(.2);try{await a.scheduleRegisters([[0,999,0]],441);}catch{log('bad-rejected');}await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.logs.includes('several-complete')&&f.logs.includes('bad-rejected'));const schedules=f.commands().slice(start).filter(c=>c.type==='extra-ym2203'&&c.message.method==='schedule');assert.equal(schedules.length,10);assert.equal(new Set(schedules.map(c=>c.message.group)).size,1,'repeated timelines use one stable per-loop group');assert(Number.isSafeInteger(schedules[0].message.group));
  f.runtime.context.cancel('bad');await f.synth.flush();let view=await f.synth.chipInspector.read('lead');assert.equal(view.keyMasks[0],15);assert.equal(view.registers[0][9],8);f.runtime.context.cancel('several');await f.synth.flush();view=await f.synth.chipInspector.read('lead');assert.equal(view.keyMasks[0],0);assert.equal(view.registers[0][9],0);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 a rejected busy Main schedule cannot claim or cancel the successful owner',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2203',{id:'lead'});liveLoop('good',async()=>{await a.scheduleRegisters([[0,8,9]],44100);});liveLoop('bad',async()=>{await sleep(.02);try{await a.scheduleRegisters([[0,9,8]],44100);}catch{log('busy-rejected');}await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.logs.includes('busy-rejected'));f.runtime.context.cancel('bad');await f.synth.flush();assert((await f.synth.chipInspector.read('lead')).schedule.playing);f.runtime.context.cancel('good');await f.synth.flush();const view=await f.synth.chipInspector.read('lead');assert(view.schedule.cancelled);assert.equal(view.registers[0][8],0);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 concurrent Main lookups retain each caller’s loop owner',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`liveLoop('a',async()=>{const chip=await useSoundChip('ym2203');chip.keyOn(0);log('lookup-a');await beat(100);});liveLoop('b',async()=>{const chip=await useSoundChip('ym2203');chip.keyOn(1);log('lookup-b');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.logs.includes('lookup-a')&&f.logs.includes('lookup-b'));f.runtime.context.cancel('a');await f.synth.flush();let view=await f.synth.chipInspector.read('ym2203:shared');assert.equal(view.keyMasks[0],0);assert.equal(view.keyMasks[1],15);f.runtime.context.cancel('b');await f.synth.flush();view=await f.synth.chipInspector.read('ym2203:shared');assert.equal(view.keyMasks[1],0);assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 stopped independent Main creation releases its source and reserved ID',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);
  await f.runtime.playSource(`liveLoop('creating',async()=>{const chip=await createSoundChip('ym2203',{id:'pending'});chip.keyOn(0);await beat(100);});context.cancel=()=>stopLoop('creating');`);
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2203_create'));f.runtime.context.cancel();gate.resolve();await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2203_dispose')&&!f.rack.size);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-ym2203'&&c.message.method==='write'&&c.message.register===0x28));assert.deepEqual(f.errors,[]);
});

test('Native additional YM2203 cancelling one pending shared lookup keeps the other caller’s Run-owned source',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);
  await f.runtime.playSource(`liveLoop('a',async()=>{const chip=await useSoundChip('ym2203');chip.keyOn(0);await beat(100);});liveLoop('b',async()=>{const chip=await useSoundChip('ym2203');chip.keyOn(1);log('shared-b-ready');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2203_create'));f.runtime.context.cancel('a');gate.resolve();await until(()=>f.logs.includes('shared-b-ready'));const view=await f.synth.chipInspector.read('ym2203:shared');assert.equal(view.keyMasks[0],0);assert.equal(view.keyMasks[1],15);assert.equal(f.rack.size,1);assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_ym2203_create').length,1);f.runtime.context.cancel('b');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('ym2203:shared')).keyMasks[1],0);assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2203 Worker uses SSG metadata, editor state, schedules and disposed shared-cache replacement',{timeout:15000},async t=>{
  installWorkers(t);const f=fixture(t,{mode:'ym3812'});
  await f.runtime.playSource(`const a=await useSoundChip('ym2203');if(a!==await useSoundChip('ym2203'))throw Error('Not cached');a.setPreset(0,{algorithm:7,operators:[{tl:12,multi:1,ar:31}]});a.setNote(0,'A4');a.keyOn(0);a.ssg.setVolume(0,9);a.ssg.keyOff(0);a.ssg.setVolume(1,0);await a.setClock(4500000);if(a.clock!==4500000||a.ssg.clock!==2250000||await a.readStatus()!==1)throw Error('Control acknowledgement lost');await a.scheduleRegisters([[0,9,8],[441,9,0]],441);log('schedule-ended');keyboard.bind('editor state',{async noteOn(){if(a._getState().ssg.levels[0]!==16||a.getState().channels[0].operators[0].tl!==17)throw Error('Wrong editor state');log('worker-state-ok');a.dispose();const next=await useSoundChip('ym2203');if(next===a)throw Error('Cache not evicted');next.ssg.tone(2,{period:666,volume:7});await next.setClock(4000000);log('worker-replaced');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.logs.includes('schedule-ended')&&f.runtime.getKeyboardTarget());const id='ym2203:shared',old=f.synth.chipInspector.getConnectionToken(id);assert.equal((await f.synth.chipInspector.read(id)).ssgLevels[0],9);
  await f.synth.chipInspector.invoke(id,'setOperator',[0,0,{tl:17}]);await f.synth.chipInspector.invoke(id,'ssg.setVolume',[0,5,true]);await tick();f.runtime.getKeyboardTarget().noteOn({id:'state',midi:60});await until(()=>f.logs.includes('worker-state-ok'));f.advance(2000);await until(()=>f.logs.includes('worker-replaced'));
  assert.notEqual(f.synth.chipInspector.getConnectionToken(id),old);assert.equal((await f.synth.chipInspector.read(id)).registers[0][4]|(await f.synth.chipInspector.read(id)).registers[0][5]<<8,666);assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2203 Worker schedule completion frees FIFO for reset and owner cancellation',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2203',{id:'lead'}),b=await createSoundChip('ym2203',{id:'bass'});liveLoop('scheduled',async()=>{await a.scheduleRegisters([[0,8,9],[44100,8,0]],44100);});liveLoop('sibling',async()=>{b.ssg.tone(1,{period:444,volume:8});await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('scheduled');b.ssg.setVolume(1,7);log('cancel-schedule');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.commands().some(c=>c.type==='extra-ym2203'&&c.message.method==='schedule'&&c.performance)&&f.runtime.getKeyboardTarget());const schedule=f.commands().find(c=>c.message?.method==='schedule'),source=[...f.synth.extraDevices.values()].find(d=>d.client.id==='lead');f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'&&c.args.owner===schedule.owner));assert((await f.synth.chipInspector.read(source.client.id)).schedule.cancelled);assert.equal(f.rack.size,2);assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2203 Worker cancellation rejects a one-hour completion immediately and accepts a replacement schedule',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2203',{id:'lead'});liveLoop('long',async()=>{await a.scheduleRegisters([[0,8,9]],44100*3600);});keyboard.bind('replace',{async noteOn(){stopLoop('long');await a.scheduleRegisters([[0,8,5],[441,8,0]],441);log('short-replacement-complete');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.commands().some(c=>c.type==='extra-ym2203'&&c.message.method==='schedule'&&c.message.durationSamples===44100*3600)&&f.runtime.getKeyboardTarget());const started=Date.now();f.runtime.getKeyboardTarget().noteOn({id:'replace',midi:60});await until(()=>f.logs.includes('short-replacement-complete'));assert(Date.now()-started<2000);assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_ym2203_create').length,1,'replacement reuses the same Native chip');assert.equal(f.commands().filter(c=>c.type==='extra-ym2203'&&c.message.method==='schedule').length,2);assert.deepEqual(f.errors,[]);
});
