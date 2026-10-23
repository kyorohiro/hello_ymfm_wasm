import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {executeWithPlaygroundGuards} from './playground_execution.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional YM2608 test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native YM2608 attempted Web Audio');}};
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
const ymState=()=>({clock:8000000,registers:[Array(256).fill(0),Array(256).fill(0)],keyMasks:Array(6).fill(0),ssgLevels:[0,0,0],ssgGates:[false,false,false],prescaler:6,status:1,statusHi:8,irq:true,held:[],pendingCommands:[],sourceMuteMask:0,channelMuteMask:0,timeline:{token:0,playing:false,ended:false,cancelled:false,pending:false,prepared:false,durationSamples:0}});
const otherState=kind=>kind==='ym2612'?{clock:7670454,registers:[Array(256).fill(0),Array(256).fill(0)],keyMasks:Array(6).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,channelMuteMask:0}:{clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,stereo:255,held:[],pendingCommands:[],sourceMuteMask:0};
function fixture(t,{mode='genesis',guardExecution=false,fetcher=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(8192).fill(0x37).buffer})}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),leases=new Map(),groups=new Map(),schedules=new Map();let gate=null,offset=0;const started=Date.now(),now=()=>Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  const snapshot=(kind,instance)=>{const source=rack.get(instance);if(!source||source.kind!==kind)throw Error('Additional sound chip is not connected');const {memory,rom,prepared,...state}=source.state;return {[kind]:structuredClone(state),sampleRate:48000,frame:status().frame,revision:calls.length};};
  function cancelSchedule(s){const entry=schedules.get(s);if(entry){for(const timer of entry.timers)clearTimeout(timer);schedules.delete(s);s.timeline={...s.timeline,playing:false,pending:false,cancelled:true};}}
  function apply(kind,s,m,audition=false,owner,group=m.group){
    const held=leases.get(s),owned=groups.get(s);
    if(m.method==='batch'){
      if(m.action==='off'&&held.get(m.channel)!==m.voice)return;
      for(const command of m.commands)apply(kind,s,command,true,owner,group);
      if(m.action==='on'){held.set(m.channel,m.voice);owned.delete(m.channel);}else if(m.action==='off')held.delete(m.channel);s.held=[...held.keys()];return;
    }
    if(m.method==='clock'){if(held.size)throw Error('Release the manually held additional YM2608 voices before changing the clock');s.clock=m.hz;}
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){
      if(kind==='ym2608')cancelSchedule(s);if(!held.size||audition){const {clock,rom,memory,prepared,timeline}=s;Object.assign(s,kind==='ym2608'?ymState():otherState(kind),{clock,rom,memory,prepared,timeline});held.clear();owned.clear();}
    }else if(m.method==='prepare-timeline'){s.prepared=structuredClone(m);s.timeline={...s.timeline,prepared:true,durationSamples:m.durationSamples};}
    else if(m.method==='play-timeline'){
      if(schedules.has(s))throw Error('Native YM2608 timeline already playing or pending');const entry={owner,group,timers:[]};schedules.set(s,entry);s.timeline={...s.timeline,token:m.token,playing:true,pending:false,ended:false,cancelled:false};
      const prepared=s.prepared;if(!prepared)throw Error("Timeline unavailable");
      for(const [sample,port,register,value]of prepared.events)entry.timers.push(setTimeout(()=>{if(schedules.get(s)===entry)port===2?s.memory.set(prepared.blocks[register],value):apply(kind,s,{method:'write',port,register,value},false,owner,group);},sample/44.1));
      entry.timers.push(setTimeout(()=>{if(schedules.get(s)!==entry)return;schedules.delete(s);s.timeline={...s.timeline,playing:false,ended:true};},prepared.durationSamples/44.1));
    }else if(m.method==='cancel-schedule'){if(s.timeline.token===m.token)cancelSchedule(s);}
    else if(m.method==='cancel-main-owner'){
      if(schedules.get(s)?.group===m.targetGroup)cancelSchedule(s);
      for(const [ch,g]of [...owned])if(g===m.targetGroup){owned.delete(ch);if(ch==='csm'){if(!held.has(2))s.registers[0][0x27]&=~0x81;}else apply(kind,s,{method:'key-off',channel:ch},false,owner,undefined);}
    }
    else if(m.method==='rom'){s.rom=new Uint8Array(m.data);}
    else if(m.method==='memory'){s.memory.set(m.data,m.offset);}
    else if(m.method==='set-retained-level')s.ssgLevels[m.channel]=m.level;
    else if(m.method==='cancel-csm'){if(!held.has(2)||audition){s.registers[0][0x27]&=~0x81;owned.delete('csm');}}
    else if(m.method==='key-off'){
      if(!held.has(m.channel)||audition){if(m.channel<6){s.keyMasks[m.channel]=0;if(m.channel===2&&!owned.has('csm'))s.registers[0][0x27]&=~0x81;}else if(m.channel<9){s.registers[0][8+m.channel-6]=0;s.ssgGates[m.channel-6]=false;}else if(m.channel<15){s.rhythmKeys&=~(1<<(m.channel-9));}else s.registers[1][0]=1;owned.delete(m.channel);}
    }else if(m.method==='write'&&kind==='ym2608'){
      const {port:p,register:r,value:v}=m,ch=p===1&&r<16?15:p===0&&r<=5?6+(r>>1):p===0&&r>=8&&r<=10?6+r-8:r===0x28?(v&3)+(v&4?3:0):r>=0x24&&r<=0x27?2:r>=0xa0&&r<=0xa6?(r&3)+p*3:null;
      if(ch!==null&&held.has(ch)&&!audition)return;
      const target=p===0&&r===0x28?(v&3)+(v&4?3:0):p===0&&r>=8&&r<=10?6+r-8:p===0&&r===0x27?'csm':p===1&&r===0?15:null,on=r===0x28?!!(v&240):r===0x27?(v&0x81)===0x81:p===1?r===0&&!!(v&128):!!(v&31);
      if(target!==null&&!on&&group!==undefined&&owned.has(target)&&owned.get(target)!==group)return;
      s.registers[p][r]=v;if(p===0&&r===0x28&&(v&3)<3)s.keyMasks[(v&3)+(v&4?3:0)]=v>>4;
      if(target!==null){if(on)owned.set(target,group);else owned.delete(target);}
      if(p===0&&r>=8&&r<=10){if(v&31)s.ssgLevels[r-8]=v&31;s.ssgGates[r-8]=!!(v&31);}
      if(p===0&&r===0x10)for(let voice=0;voice<6;voice++)if(v&(1<<voice)){if(!audition&&held.has(9+voice))continue;if(v&128){if(group!==undefined&&owned.has(9+voice)&&owned.get(9+voice)!==group)continue;s.rhythmKeys&=~(1<<voice);owned.delete(9+voice);}else{s.rhythmKeys|=1<<voice;owned.set(9+voice,group);}}
      if(r===0x2d)s.prescaler=6;else if(r===0x2e&&s.prescaler===6)s.prescaler=3;else if(r===0x2f)s.prescaler=2;
    }else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else if(m.method==='channel-mute')s.channelMuteMask=m.mask;
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});
    if(command==='native_genesis_opl_status')return {ym3812:{chip:'ym3812',clock:3579545,registers:Array(256).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000},sampleRate:48000,frame:status().frame,revision:0};
    const match=/^native_genesis_extra_(psg|ym2612|ym2608)_(create|dispose|status)$/.exec(command);
    if(match){const kind=match[1]==='psg'?'segapsg':match[1],op=match[2];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');if(rack.has(args.instance))throw Error('Duplicate instance');const state=kind==='ym2608'?ymState():otherState(kind);if(kind==='ym2608'){state.memory=new Uint8Array(0x200000);state.rhythmKeys=0;}rack.set(args.instance,{kind,state});leases.set(state,new Map());groups.set(state,new Map());}if(op==='dispose'){const state=rack.get(args.instance)?.state;if(state)cancelSchedule(state);rack.delete(args.instance);return true;}return snapshot(kind,args.instance);}
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){for(const {state}of rack.values())cancelSchedule(state);rack.clear();}
    if(command==='native_genesis_performance'&&args.op==='cancel-owner')for(const [s,schedule]of schedules)if(schedule.owner===args.owner)cancelSchedule(s);
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type.startsWith('extra-')){const source=rack.get(c.instance);if(!source)throw Error('Additional sound chip is not connected');apply(source.kind,source.state,c.message,false,c.owner);}
    return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution,onLog:line=>logs.push(line)});
  const create=synth.createExtraYm2608.bind(synth);synth.createExtraYm2608=options=>create({...options,fetcher});
  t.after(()=>runtime.finalize());
  return {synth,runtime,calls,errors,logs,rack,gate:value=>{gate=value;},advance:ms=>{offset+=ms;},commands:()=>calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[])};
}

test('Native additional YM2608 keeps FM6, SSG3, rhythm and ADPCM memory independent without Web Audio',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip,useSoundChip};`);const a=await f.runtime.context.api.createSoundChip('ym2608',{id:'opna-a'}),b=await f.runtime.context.api.createSoundChip('ym2608',{id:'opna-b'});await f.runtime.context.api.createSoundChip('segapsg',{id:'tone'});await f.runtime.context.api.createSoundChip('ym2612',{id:'fm'});
  assert.deepEqual([...f.synth.extraDevices.keys()],[1,2,3,4]);assert.equal(f.rack.get(1).state.rom.length,8192);a.setOperator(5,0,{tl:11});a.setPan(5,true,false);a.ssg.tone(2,{period:555,volume:7});a.ssg.keyOff(2);a.rhythm.setVolume(55);a.rhythm.setVoice('snare',{volume:19,left:true,right:false});a.rhythm.keyOn('snare');a.adpcm.setSample({start:0,end:64});a.adpcm.setVolume(200);a.adpcm.setPan(true,true);a.adpcm.setDeltaN(12345);a.adpcm.keyOn({repeat:true});await a.adpcm.loadMemory(new Uint8Array([1,2,3]),64);await b.adpcm.loadMemory(new Uint8Array([9]),64);await a.setClock(9000000);
  let view=await f.synth.chipInspector.read('opna-a');assert.equal(view.fmState.channels.length,6);assert.equal(view.fmState.channels[5].operators[0].tl,11);assert.equal(view.registers[1][0xb6],128);assert.equal(view.ssgLevels[2],7);assert.equal(view.registers[0][10],0);assert.equal(view.registers[0][0x19],147);assert.equal(view.registers[1][0],0xb0);assert.equal(a.ssg.clock,2250000);assert.equal(a.adpcm.clock,9000000);assert.equal(await a.read(2),8);assert.equal(await a.getIrq(),true);assert.deepEqual([...f.rack.get(1).state.memory.slice(64,67)],[1,2,3]);assert.equal(f.rack.get(2).state.memory[64],9);
  a.ssg.keyOn(2);a.ssg.setVolume(1,0);a.write(0,0x2f,0);await f.synth.flush();view=await f.synth.chipInspector.read(a.id);assert.equal(view.prescaler,2);assert.equal(view.registers[0][10],7);assert.equal(view.ssgLevels[1],0);assert.equal((await f.synth.chipInspector.read(b.id)).registers[0][0x19],0);assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});f.synth.mixer.set(a.id,{volume:.3,pan:.5});await f.synth.flush();assert.equal(f.rack.get(1).state.volume,.3);assert.equal(f.rack.get(2).state.volume,1);assert.equal(f.synth.audioContext,null);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2608 Inspector stages FM, SSG, rhythm and ADPCM edits with exact manual leases',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2608',{id:'opna'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  await i.invoke(a.id,'setOperator',[5,0,{tl:27}]);await i.invoke(a.id,'setLfo',[true,4]);await i.invoke(a.id,'ssg.setVolume',[2,11]);await i.invoke(a.id,'rhythm.setVoice',['bassDrum',{volume:14,left:true,right:true}]);await i.invoke(a.id,'adpcm.setSample',[{start:64,end:128}]);await i.invoke(a.id,'adpcm.setVolume',[177]);
  let view=await i.read(a.id);assert.equal(view.registers[1][0x42],27);assert.equal(view.registers[0][0x22],12);assert.equal(view.registers[0][0x18],206);assert.equal(view.registers[1][11],177);assert.equal(a.getState().channels[5].operators[0].tl,27);const authored=a._getState();await i.read(a.id);assert.deepEqual(a._getState(),authored);
  for(const [ch,id]of [['fm:5','f'],['ssg:2','s'],['rhythm:0','r'],['adpcm-b:0','a']])await i.invoke(a.id,'auditionOn',[ch,60,id]);view=await i.read(a.id);assert.deepEqual(view.held,['fm:5','ssg:2','rhythm:0','adpcm-b:0']);await assert.rejects(a.setClock(7000000),/manually held additional YM2608/);assert.equal(a.clock,8000000);await i.invoke(a.id,'auditionOff',['rhythm:0','stale']);assert((await i.read(a.id)).held.includes('rhythm:0'));await i.invoke(a.id,'auditionAllOff');assert.deepEqual((await i.read(a.id)).held,[]);await a.setClock(7000000);assert.equal(a.clock,7000000);await assert.rejects(i.invoke(a.id,'adpcm.setSample',[{start:1,end:64}]),/aligned/);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2608 timeline copies blocks at their original positions, completes, repeats and cancels on reset',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2608',{id:'trace'});`);const a=f.runtime.context.a,events=[[0,2,0,32],[0,0,8,9],[441,1,11,123],[441,0,8,0]],block=new Uint8Array([0x17,0x36]);await a.prepareTimeline(events,[block],882);events[0][3]=99;block.fill(0);await a.playTimeline();assert.deepEqual([...f.rack.get(1).state.memory.slice(32,34)],[0x17,0x36]);assert.equal(f.rack.get(1).state.registers[1][11],123);await a.playTimeline();assert.equal(f.commands().filter(c=>c.message?.method==='play-timeline').length,2);
  await a.prepareTimeline([[0,0,8,11]],[],44100);const pending=a.playTimeline(),rejected=assert.rejects(pending,/cancelled/);await until(()=>f.rack.get(1).state.timeline.playing);a.resetRegisters();await f.synth.flush();await rejected;assert(f.rack.get(1).state.prepared,'reset retains the prepared Browser trace');assert.equal(f.rack.get(1).state.rom.length,8192);assert.deepEqual([...f.rack.get(1).state.memory.slice(32,34)],[0x17,0x36]);
  const before=f.commands().length;await assert.rejects(a.prepareTimeline([[0,2,0,0x1fffff]],[new Uint8Array(2)],20),/range/);await assert.rejects(a.prepareTimeline(Array.from({length:257},()=>[0,0,8,1]),[],20),/256 writes/);await assert.rejects(a.prepareTimeline([[0,2,0,0],[0,2,0,0],[0,2,0,0]],[new Uint8Array(0x200000)],20),/4194304/);await assert.rejects(a.prepareTimeline([],Array.from({length:5},()=>new Uint8Array(0x200000)),20),/8 MiB/);assert.equal(f.commands().length,before);
  await a.prepareTimeline([[0,2,0,0]],[new Uint8Array(0x200000)],1);await a.playTimeline();assert.deepEqual(f.errors,[]);
});

test('Native additional YM2608 ROM initialization stays hidden and aborts cleanly on owner Stop',async t=>{
  installWorkers(t);const started=deferred();let aborted=false;const f=fixture(t,{fetcher:async(_url,{signal})=>{started.resolve();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));}});
  await f.runtime.playSource(`liveLoop('opening',async()=>{await createSoundChip('ym2608',{id:'pending-rom'});throw Error('Cancelled creation resumed');});context.cancel=()=>stopLoop('opening');`);await started.promise;assert.equal(f.synth.extraDevices.size,1);assert(!f.synth.chipInspector.list().some(e=>e.id==='pending-rom'));await assert.rejects(f.synth.chipInspector.read('pending-rom'),/not connected/);f.runtime.context.cancel();await until(()=>aborted&&!f.synth.extraDevices.size&&!f.rack.size);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.logs.some(line=>line.includes('Cancelled creation resumed')));assert.deepEqual(f.errors,[]);
});

test('Native additional YM2608 cancelled sample decoding does not reconfigure a replacement owner',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2608',{id:'sample'});context.start=()=>liveLoop('decode',async()=>{await context.a.adpcm.loadSample(new Uint8Array([1,2,3]),{decodeAudio:context.decoder});context.bad=true;});context.cancel=()=>stopLoop('decode');`);const gate=deferred();f.runtime.context.decoder=()=>gate.promise;f.runtime.context.start();await tick();f.runtime.context.cancel();const before=f.commands().length;gate.resolve({channels:[new Float32Array(128).fill(.25)],sampleRate:8000});await tick();await tick();await f.synth.flush();assert(!f.commands().slice(before).some(c=>c.message?.method==='memory'||c.message?.port===1));assert.equal(f.runtime.context.bad,undefined);const result=await f.runtime.context.a.adpcm.loadSample({channels:[new Float32Array(128).fill(.25)],sampleRate:8000});assert(result.end>result.start);assert.equal(f.commands().filter(c=>c.message?.method==='memory').length,1,'one complete sample upload is atomic');assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2608 Worker preserves exact edited state, clock, timeline completion and shared cache replacement',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{mode:'ym3812'});
  await f.runtime.playSource(`const a=await useSoundChip('ym2608');if(a!==await useSoundChip('ym2608'))throw Error('Not cached');a.ssg.setVolume(2,9);a.ssg.keyOff(2);a.rhythm.setVoice(1,{volume:13,left:true,right:true});await a.adpcm.loadMemory(new Uint8Array([2,3]),64);await a.setClock(9000000);if(a.ssg.clock!==2250000||a.adpcm.clock!==9000000||await a.read(2)!==8)throw Error('Clock/status lost');await a.prepareTimeline([[0,0,8,7],[441,0,8,0]],[],441);await a.playTimeline();log('timeline-ended');keyboard.bind('editor',{async noteOn(){if(a._getState().rhythm.levels[1]!==213||a.adpcm.registers[11]!==177||a.getState().channels[5].operators[0].tl!==27)throw Error('Editor state lost');log('worker-state-ok');a.dispose();const next=await useSoundChip('ym2608');next.ssg.tone(1,{period:444,volume:8});log('worker-replaced');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.logs.includes('timeline-ended')&&f.runtime.getKeyboardTarget());const i=f.synth.chipInspector,id='ym2608:shared',old=i.getConnectionToken(id);assert.equal((await i.read(id)).ssgLevels[2],9);await i.invoke(id,'setOperator',[5,0,{tl:27}]);await i.invoke(id,'rhythm.setVoice',[1,{volume:21,left:true,right:true}]);await i.invoke(id,'adpcm.setVolume',[177]);await tick();f.runtime.getKeyboardTarget().noteOn({id:'state',midi:60});await until(()=>f.logs.includes('worker-state-ok'));f.advance(2000);await until(()=>f.logs.includes('worker-replaced'));assert.notEqual(i.getConnectionToken(id),old);assert.equal((await i.read(id)).registers[0][2]|(await i.read(id)).registers[0][3]<<8,444);assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2608 Worker owner cancellation immediately frees a one-hour timeline for replay',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('ym2608',{id:'long'});await a.prepareTimeline([[0,0,8,9]],[],44100*3600);liveLoop('long',async()=>{await a.playTimeline();});keyboard.bind('replace',{async noteOn(){stopLoop('long');await a.prepareTimeline([[0,0,8,5],[441,0,8,0]],[],441);await a.playTimeline();log('short-ended');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.commands().some(c=>c.message?.method==='play-timeline')&&f.runtime.getKeyboardTarget());const started=Date.now();f.runtime.getKeyboardTarget().noteOn({id:'replace',midi:60});await until(()=>f.logs.includes('short-ended'));assert(Date.now()-started<2000);assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_ym2608_create').length,1);assert.deepEqual(f.errors,[]);
});
test('Native additional YM2608 concurrent Main lookups retain each caller’s loop owner',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`liveLoop('a',async()=>{const chip=await useSoundChip('ym2608');chip.keyOn(0);log('lookup-a');await beat(100);});liveLoop('b',async()=>{const chip=await useSoundChip('ym2608');chip.keyOn(1);log('lookup-b');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.logs.includes('lookup-a')&&f.logs.includes('lookup-b'));f.runtime.context.cancel('a');await f.synth.flush();let view=await f.synth.chipInspector.read('ym2608:shared');assert.equal(view.keyMasks[0],0);assert.equal(view.keyMasks[1],15);f.runtime.context.cancel('b');await f.synth.flush();view=await f.synth.chipInspector.read('ym2608:shared');assert.equal(view.keyMasks[1],0);assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2608 stopped independent Main creation releases its source and reserved ID',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);
  await f.runtime.playSource(`liveLoop('creating',async()=>{const chip=await createSoundChip('ym2608',{id:'pending'});chip.keyOn(0);await beat(100);});context.cancel=()=>stopLoop('creating');`);
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2608_create'));f.runtime.context.cancel();gate.resolve();await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2608_dispose')&&!f.rack.size);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-ym2608'&&c.message.method==='write'&&c.message.register===0x28));assert.deepEqual(f.errors,[]);
});

test('Native additional YM2608 cancelling one pending shared lookup keeps the other caller’s Run-owned source',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);
  await f.runtime.playSource(`liveLoop('a',async()=>{const chip=await useSoundChip('ym2608');chip.keyOn(0);await beat(100);});liveLoop('b',async()=>{const chip=await useSoundChip('ym2608');chip.keyOn(1);log('shared-b-ready');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2608_create'));f.runtime.context.cancel('a');gate.resolve();await until(()=>f.logs.includes('shared-b-ready'));const view=await f.synth.chipInspector.read('ym2608:shared');assert.equal(view.keyMasks[0],0);assert.equal(view.keyMasks[1],15);assert.equal(f.rack.size,1);assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_ym2608_create').length,1);f.runtime.context.cancel('b');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('ym2608:shared')).keyMasks[1],0);assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2608 Main raw CSM cancellation preserves another FM owner and cannot resurrect cached Timer A',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2608',{id:'lead'});liveLoop('csm',async()=>{a.writeAddress(0,0x27);a.writeData(0x85);a.keyOff(2);await beat(100);});liveLoop('normal',async()=>{a.keyOn(2);await beat(100);});context.cancel=name=>stopLoop(name);context.editMode=()=>a.setChannel3SpecialMode(true);context.a=a;`);
  await until(()=>f.commands().some(c=>c.type==='extra-ym2608'&&c.message.method==='write'&&c.message.register===0x28&&c.message.value===0xf2));
  f.runtime.context.cancel('csm');await f.synth.flush();let view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x27]&0x81,0);assert.equal(view.keyMasks[2],15);assert.equal(f.runtime.context.a._getState().modeRegister&0x81,0);
  f.runtime.context.editMode();await f.synth.flush();view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x27]&0x81,0);
  f.runtime.context.cancel('normal');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).keyMasks[2],0);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2608 Main groups release completed timelines and preserve replacement/manual voices',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('ym2608',{id:'mix'});liveLoop('a',async()=>{a.keyOn(0);a.ssg.tone(0,{period:444,volume:9});a.rhythm.keyOn(1);a.adpcm.keyOn({repeat:true});await beat(100);});liveLoop('b',async()=>{await sleep(.02);a.keyOn(0);a.rhythm.keyOn(1);a.adpcm.keyOn();log('b-ready');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.logs.includes('b-ready'));await f.synth.chipInspector.invoke('mix','auditionOn',['ssg:0',60,'manual']);f.runtime.context.cancel('a');await f.synth.flush();let view=await f.synth.chipInspector.read('mix');assert.equal(view.keyMasks[0],15);assert.equal(view.registers[1][0],0xa0);assert.equal(f.rack.get(1).state.rhythmKeys&2,2);assert.equal(view.registers[0][8],9);f.runtime.context.cancel('b');await f.synth.flush();view=await f.synth.chipInspector.read('mix');assert.equal(view.keyMasks[0],0);assert.equal(view.registers[1][0],1);assert.equal(f.rack.get(1).state.rhythmKeys&2,0);assert.equal(view.registers[0][8],9);
  await f.runtime.stopWithFade();const before=f.commands().length;await f.runtime.playSource(`const a=await createSoundChip('ym2608',{id:'trace'});liveLoop('completed',async()=>{for(let i=0;i<4;i++){await a.prepareTimeline([[0,0,0x28,0xf0],[0,0,9,8],[0,0,0x10,4],[0,1,0,0xb0]],[],441);await a.playTimeline();}log('all-complete');await beat(100);});context.cancel=()=>stopLoop('completed');`);await until(()=>f.logs.includes('all-complete'));const plays=f.commands().slice(before).filter(c=>c.message?.method==='play-timeline');assert.equal(plays.length,4);assert.equal(new Set(plays.map(c=>c.message.group)).size,1);f.runtime.context.cancel();await f.synth.flush();view=await f.synth.chipInspector.read('trace');assert.equal(view.keyMasks[0],0);assert.equal(view.registers[0][9],0);assert.equal(view.registers[1][0],1);assert.deepEqual(f.errors,[]);
});
test('Native additional YM2608 default ROM fetch uses the trusted host while Run network access stays guarded',async t=>{
  installWorkers(t);const previous=globalThis.fetch,requests=[];let module;
  try{globalThis.fetch=async(url)=>{requests.push(String(url));return {ok:true,arrayBuffer:async()=>new Uint8Array(8192).buffer};};module=await import('./native_genesis_extra_ym2608.js?host-fetch-guard-test');}finally{globalThis.fetch=previous;}
  const f=fixture(t);f.synth.createExtraYm2608=options=>module.createNativeGenesisExtraYm2608(f.synth,options);
  await executeWithPlaygroundGuards(()=>f.runtime.playSource(`context.chip=await createSoundChip('ym2608',{id:'guarded'});try{await fetch('https://invalid.example/user-network');}catch(error){context.networkDenied=error.message.includes('Network access is disabled');}`),globalThis);
  assert.equal(f.runtime.context.chip.id,'guarded');assert.equal(f.runtime.context.networkDenied,true);assert.equal(requests.length,1);assert(requests[0].endsWith('/tetorica_ym2608_adpcm_rom.bin'));assert.equal(f.rack.get(1).state.rom.length,8192);assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2608 Worker cancelled decoder commits no stale memory or playback setup',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2608',{id:'sample'});liveLoop('decode',async()=>{await a.adpcm.loadSample(new Uint8Array([1,2]),{decodeAudio:()=>new Promise(resolve=>{context.release=()=>resolve({channels:[new Float32Array(128).fill(.2)],sampleRate:8000});log('decoder-waiting');})});log('stale-decoder-complete');});keyboard.bind('cancel decoder',{async noteOn(){stopLoop('decode');context.release();await a.adpcm.loadSample({channels:[new Float32Array(128).fill(.3)],sampleRate:8000},{address:64});log('replacement-sample-complete');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.logs.includes('decoder-waiting')&&f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('replacement-sample-complete'));assert(!f.logs.includes('stale-decoder-complete'));const uploads=f.commands().filter(c=>c.type==='extra-ym2608'&&c.message.method==='memory');assert.equal(uploads.length,1);assert.equal(uploads[0].message.offset,64);assert.equal((await f.synth.chipInspector.read('sample')).registers[1][2],2);assert.deepEqual(f.errors,[]);
});
test('Native additional YM2608 Main replacement preparation waits for the cancelled timeline fence',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('ym2608',{id:'replace'});await a.prepareTimeline([[0,0,8,9]],[],44100*3600);liveLoop('long',async()=>{await a.playTimeline();});keyboard.bind('replace',{async noteOn(){stopLoop('long');await a.prepareTimeline([[0,0,8,5],[441,0,8,0]],[],441);await a.playTimeline();log('replacement-ended');},noteOff(){},allNotesOff(){}});`);await until(()=>f.commands().some(c=>c.message?.method==='play-timeline')&&f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'replace',midi:60});await until(()=>f.logs.includes('replacement-ended'));const cancellation=f.commands().find(c=>c.message?.method==='cancel-main-owner');assert(cancellation);assert(f.calls.some(c=>c.command==='native_genesis_extra_ym2608_status'&&c.args.after===cancellation.message.id));assert.equal(f.commands().filter(c=>c.message?.method==='prepare-timeline').length,2);assert.deepEqual(f.errors,[]);
});
