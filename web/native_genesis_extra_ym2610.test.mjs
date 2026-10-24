import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional YM2610 test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native YM2610 attempted Web Audio');}};
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
const ymState=(variant='ym2610')=>({clock:8000000,registers:[Array(256).fill(0),Array(256).fill(0)],keyMasks:Array(6).fill(0),ssgLevels:[0,0,0],ssgGates:[false,false,false],variant,romBytes:[0,0],romAllocatedBytes:[0,0],status:1,statusHi:8,irq:true,held:[],pendingCommands:[],sourceMuteMask:0,channelMuteMask:0});
const otherState=kind=>kind==='ym2612'?{clock:7670454,registers:[Array(256).fill(0),Array(256).fill(0)],keyMasks:Array(6).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,channelMuteMask:0}:{clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,stereo:255,held:[],pendingCommands:[],sourceMuteMask:0};
function fixture(t,{mode='genesis'}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),leases=new Map(),groups=new Map();let gate=null,offset=0,rejectBudget=false;const started=Date.now(),now=()=>Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  const snapshot=(kind,instance)=>{const source=rack.get(instance);if(!source||source.kind!==kind)throw Error('Additional sound chip is not connected');const {banks,pages,...state}=source.state;return {[kind]:structuredClone(state),sampleRate:48000,frame:status().frame,revision:calls.length};};
  function apply(kind,s,m,audition=false,owner,group=m.group){
    const held=leases.get(s),owned=groups.get(s);if(group===undefined&&owner!==undefined)group=`worker:${owner}`;
    if(m.method==='batch'){
      if(m.action==='off'&&held.get(m.channel)!==m.voice)return;
      for(const command of m.commands)apply(kind,s,command,true,owner,group);
      if(m.action==='on'){held.set(m.channel,m.voice);owned.delete(m.channel);}else if(m.action==='off')held.delete(m.channel);s.held=[...held.keys()];return;
    }
    if(m.method==='clock'){if(held.size)throw Error(`Release the manually held additional ${kind==='ym2610b'?'YM2610B':'YM2610'} voices before changing the clock`);s.clock=m.hz;}
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){
      if(!held.size||audition){const {clock,banks,pages,romBytes,romAllocatedBytes}=s;Object.assign(s,['ym2610','ym2610b'].includes(kind)?ymState(kind):otherState(kind),{clock,banks,pages,romBytes,romAllocatedBytes});held.clear();owned.clear();}
    }    else if(m.method==='cancel-main-owner'){
      for(const [ch,g]of [...owned])if(g===m.targetGroup){owned.delete(ch);if(ch==='csm'){if(!held.has(2))s.registers[0][0x27]&=~0x81;}else apply(kind,s,{method:'key-off',channel:ch},false,owner,undefined);}
    }
    else if(m.method==='memory'){const type=m.romType,data=new Uint8Array(m.data);s.banks[type].push({offset:m.offset,data});s.romBytes[type]=Math.max(s.romBytes[type],m.offset+data.length);for(let page=Math.floor(m.offset/65536);data.length&&page<=Math.floor((m.offset+data.length-1)/65536);page++)s.pages[type].add(page);s.romAllocatedBytes[type]=s.pages[type].size*65536;}
    else if(m.method==='set-retained-level')s.ssgLevels[m.channel]=m.level;
    else if(m.method==='cancel-csm'){if(!held.has(2)||audition){s.registers[0][0x27]&=~0x81;owned.delete('csm');}}
    else if(m.method==='key-off'){
      if(!held.has(m.channel)||audition){if(m.channel<6){s.keyMasks[m.channel]=0;if(m.channel===2&&!owned.has('csm'))s.registers[0][0x27]&=~0x81;}else if(m.channel<9){s.registers[0][8+m.channel-6]=0;s.ssgGates[m.channel-6]=false;}else if(m.channel<15){s.rhythmKeys&=~(1<<(m.channel-9));}else s.registers[0][0x10]=1;owned.delete(m.channel);}
    }else if(m.method==='write'&&['ym2610','ym2610b'].includes(kind)){
      const {port:p,register:r,value:v}=m,ch=p===0&&r>=0x10&&r<=0x1b?15:p===0&&r<=5?6+(r>>1):p===0&&r>=8&&r<=10?6+r-8:r===0x28?(v&3)+(v&4?3:0):r>=0x24&&r<=0x27?2:r>=0xa0&&r<=0xa6?(r&3)+p*3:null;
      if(ch!==null&&held.has(ch)&&!audition)return;
      const target=p===0&&r===0x28?(v&3)+(v&4?3:0):p===0&&r>=8&&r<=10?6+r-8:p===0&&r===0x27?'csm':p===0&&r===0x10?15:null,on=r===0x28?!!(v&240):r===0x27?(v&0x81)===0x81:p===0&&r===0x10?!!(v&128):!!(v&31);
      if(target!==null&&!on&&group!==undefined&&owned.has(target)&&owned.get(target)!==group)return;
      s.registers[p][r]=v;if(p===0&&r===0x28&&(v&3)<3)s.keyMasks[(v&3)+(v&4?3:0)]=v>>4;
      if(target!==null){if(on)owned.set(target,group);else owned.delete(target);}
      if(p===0&&r>=8&&r<=10){if(v&31)s.ssgLevels[r-8]=v&31;s.ssgGates[r-8]=!!(v&31);}
      if(p===1&&r===0)for(let voice=0;voice<6;voice++)if(v&(1<<voice)){if(!audition&&held.has(9+voice))continue;if(v&128){if(group!==undefined&&owned.has(9+voice)&&owned.get(9+voice)!==group)continue;s.rhythmKeys&=~(1<<voice);owned.delete(9+voice);}else{s.rhythmKeys|=1<<voice;owned.set(9+voice,group);}}
      if(r===0x2d)s.prescaler=6;else if(r===0x2e&&s.prescaler===6)s.prescaler=3;else if(r===0x2f)s.prescaler=2;
    }else if(m.method==='source-mute')s.sourceMuteMask=m.mask;
    else if(m.method==='channel-mute')s.channelMuteMask=m.mask;
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});
    if(command==='native_genesis_opl_status')return {ym3812:{chip:'ym3812',clock:3579545,registers:Array(256).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000},sampleRate:48000,frame:status().frame,revision:0};
    const match=/^native_genesis_extra_(psg|ym2612|ym2203|ym2608|ym2610|ym2610b)_(create|dispose|status)$/.exec(command);
    if(match){const kind=match[1]==='psg'?'segapsg':match[1],op=match[2];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');if(rack.has(args.instance))throw Error('Duplicate instance');const state=['ym2610','ym2610b'].includes(kind)?ymState(kind):otherState(kind);if(['ym2610','ym2610b'].includes(kind)){state.banks=[[],[]];state.pages=[new Set(),new Set()];state.rhythmKeys=0;}rack.set(args.instance,{kind,state});leases.set(state,new Map());groups.set(state,new Map());}if(op==='dispose'){const state=rack.get(args.instance)?.state;rack.delete(args.instance);return true;}return snapshot(kind,args.instance);}
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown')rack.clear();
    if(command==='native_genesis_performance'&&args.op==='cancel-owner')for(const {kind,state}of rack.values())if(['ym2610','ym2610b'].includes(kind))for(const [ch,group]of [...groups.get(state)])if(group===`worker:${args.owner}`){groups.get(state).delete(ch);if(ch==='csm')state.registers[0][0x27]&=~0x81;else apply(kind,state,{method:'key-off',channel:ch});}
    if(command==='native_genesis_commands'&&rejectBudget&&args.commands.some(c=>['extra-ym2610','extra-ym2610b'].includes(c.type)&&c.message.method==='memory'))throw Error('Additional Native sound-chip memory budget exceeded (67108864 bytes)');
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type.startsWith('extra-')){const source=rack.get(c.instance);if(!source)throw Error('Additional sound chip is not connected');apply(source.kind,source.state,c.message,false,c.owner);}
    return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());
  return {synth,runtime,calls,errors,logs,rack,budget:value=>{rejectBudget=value;},byte:(instance,type,address)=>{const ranges=rack.get(instance).state.banks[type];for(let i=ranges.length-1;i>=0;i--){const r=ranges[i];if(address>=r.offset&&address<r.offset+r.data.length)return r.data[address-r.offset];}return 0;},gate:value=>{gate=value;},advance:ms=>{offset+=ms;},commands:()=>calls.flatMap(c=>c.command==='native_genesis_commands'?c.args.commands:[])};
}

test('Native additional YM2610 exposes exact Browser mapped FM4/SSG/ADPCM-A/B API and independent Mixer',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip,useSoundChip};`);const a=await f.runtime.context.api.createSoundChip('ym2610',{id:'a'}),b=await f.runtime.context.api.createSoundChip('ym2610',{id:'b'});await f.runtime.context.api.createSoundChip('segapsg',{id:'psg'});await f.runtime.context.api.createSoundChip('ym2612',{id:'fm'});
  assert.equal(a.adpcm,a.adpcmB);assert.equal(a.channelCount,4);assert.equal(a.fm.channelCount,6);assert.equal(a.adpcmA.loadSample,undefined);assert.equal(a.adpcmB.loadSample,undefined);assert.equal(a.prepareTimeline,undefined);assert.equal(a.scheduleRegisters,undefined);assert.throws(()=>a.read(0),/does not support read/);assert.equal(a.getState,undefined);
  for(let ch=0;ch<4;ch++){a.setOperator(ch,0,{tl:11+ch});a.setPan(ch,true,false);a.keyOn(ch);}a.ssg.tone(2,{period:555,volume:7});a.ssg.keyOff(2);a.adpcmA.setSample(5,{start:0x123400,end:0x123600});a.adpcmA.setVolume(55);a.adpcmA.setVoice(5,{volume:19,left:true,right:false});a.adpcmA.keyOn(5);a.adpcmB.setSample({start:256,end:768});a.adpcmB.setVolume(177);a.adpcmB.setPan(true,true);a.adpcmB.setDeltaN(12345);a.adpcmB.keyOn({repeat:true});await a.setClock(9000000);await f.synth.flush();
  const view=await f.synth.chipInspector.read(a.id);assert.equal(view.variant,'ym2610');assert.equal(view.fmState.channels.length,4);assert.deepEqual(view.fmState.channels.map(c=>c.operators[0].tl),[11,12,13,14]);assert.deepEqual(view.keyMasks,[0,15,15,0,15,15]);assert.equal(view.keyboardChannels.length,14);assert.equal(view.registers[1][0x15],0x34);assert.equal(view.registers[1][0x1d],0x12);assert.equal(view.registers[1][13],147);assert.equal(view.registers[0][0x10],0xb0);assert.equal(a.ssg.clock,2250000);assert.equal(a.adpcmB.clock,9000000);assert.equal(a.fm.clock,9000000);assert.equal(view.ssgLevels[2],7);assert.equal(view.registers[0][10],0);assert.throws(()=>a.keyOn(4),/0..3/);const authored=a._getState();await f.synth.chipInspector.read(a.id);assert.deepEqual(a._getState(),authored);
  assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});f.synth.mixer.set(a.id,{volume:.3,pan:.5});await f.synth.flush();assert.equal(f.rack.get(1).state.volume,.3);assert.equal(f.rack.get(2).state.volume,1);assert.equal((await f.synth.chipInspector.read(b.id)).registers[1][13],0);assert.equal(f.synth.audioContext,null);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610 atomic ROM uploads retain bank and instance isolation, sparse high ranges and recoverable limits',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2610',{id:'rom'});context.b=await createSoundChip('ym2610',{id:'other'});`);const {a,b}=f.runtime.context;
  await a.adpcmA.loadMemory(new Uint8Array([1,2,3]),0x123400);await a.adpcmB.loadMemory(new Uint8Array([4,5]),0x123400);await a.adpcmA.loadMemory(new Uint8Array([7,8]),0xfffffe);await b.adpcmA.loadMemory(new Uint8Array([9]),0x123400);assert.equal(f.byte(1,0,0x123400),1);assert.equal(f.byte(1,1,0x123400),4);assert.equal(f.byte(1,0,0xffffff),8);assert.equal(f.byte(2,0,0x123400),9);let view=await f.synth.chipInspector.read(a.id);assert.deepEqual(view.romBytes,[0x1000000,0x123402]);assert.deepEqual(view.romAllocatedBytes,[131072,65536]);
  const before=f.commands().length;await assert.rejects(async()=>a.adpcmA.loadMemory(new Uint8Array(2),0xffffff),/range/);await assert.rejects(async()=>a.adpcmB.loadMemory(new Uint8Array(2),0xffffff),/16 MiB/);assert.equal(f.commands().length,before);f.budget(true);await assert.rejects(a.adpcmA.loadMemory(new Uint8Array([11]),0),/memory budget/);assert.equal(f.synth.state,'ready');assert.equal(f.byte(1,0,0),0);f.budget(false);
  const bytes=new Uint8Array(0x1000000);bytes[0]=33;bytes[0xffffff]=44;await a.adpcmB.loadMemory(bytes);view=await f.synth.chipInspector.read(a.id);assert.equal(f.byte(1,1,0),33);assert.equal(f.byte(1,1,0xffffff),44);assert.equal(view.romBytes[1],0x1000000);assert.equal(f.commands().filter(c=>['extra-ym2610','extra-ym2610b'].includes(c.type)&&c.message.method==='memory'&&c.message.data.length===0x1000000).length,1);a.reset();await f.synth.flush();assert.equal(f.byte(1,0,0xffffff),8);assert.equal(f.byte(1,1,0xffffff),44);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610 Inspector maps FM4 and all fourteen Keyboard leases while editing separate applied state',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2610',{id:'editor'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  await i.invoke(a.id,'setOperator',[3,0,{tl:27}]);await i.invoke(a.id,'setLfo',[true,4]);await i.invoke(a.id,'ssg.setVolume',[2,11]);await i.invoke(a.id,'adpcmA.setSample',[5,{start:256,end:768}]);await i.invoke(a.id,'adpcmA.setVoice',[5,{volume:21,left:true,right:true}]);await i.invoke(a.id,'adpcmB.setSample',[{start:1024,end:1536}]);await i.invoke(a.id,'adpcmB.setVolume',[177]);await i.invoke(a.id,'adpcm.setPan',[true,false]);
  let view=await i.read(a.id);assert.equal(view.fmState.channels[3].operators[0].tl,27);assert.equal(view.registers[1][0x42],27);assert.equal(view.registers[1][13],213);assert.equal(view.registers[0][0x1b],177);assert.equal(a.fm.getState().channels[5].operators[0].tl,27);assert.equal(a.adpcmB.registers[11],177);assert.equal(a.adpcmA.levels[5],213);
  for(const ch of view.keyboardChannels)await i.invoke(a.id,'auditionOn',[ch.id,60,ch.id]);view=await i.read(a.id);assert.equal(view.held.length,14);assert(!view.held.includes('fm:-1'));await assert.rejects(a.setClock(7000000),/manually held additional YM2610/);await i.invoke(a.id,'auditionOff',['adpcm-a:5','stale']);assert((await i.read(a.id)).held.includes('adpcm-a:5'));await i.invoke(a.id,'auditionAllOff');assert.deepEqual((await i.read(a.id)).held,[]);await a.setClock(7000000);assert.equal(a.clock,7000000);await assert.rejects(i.invoke(a.id,'adpcmA.setSample',[0,{start:0,end:0x100000}]),/shorter than 1 MiB/);await assert.rejects(i.invoke(a.id,'adpcmB.setSample',[{start:1,end:256}]),/aligned/);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610 Main groups own mapped FM/raw FM/SSG/A/B and preserve replacement/manual leases',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('ym2610',{id:'voices'});liveLoop('a',async()=>{a.keyOn(0);a.fm.keyOn(2);a.ssg.tone(0,{period:444,volume:9});a.adpcmA.keyOn(5);a.adpcmB.keyOn({repeat:true});await beat(100);});liveLoop('b',async()=>{await sleep(.02);a.fm.keyOn(1);a.adpcmA.keyOn(5);a.adpcm.keyOn();log('b-ready');await beat(100);});context.cancel=name=>stopLoop(name);`);await until(()=>f.logs.includes('b-ready'));await f.synth.chipInspector.invoke('voices','auditionOn',['ssg:0',60,'manual']);f.runtime.context.cancel('a');await f.synth.flush();let view=await f.synth.chipInspector.read('voices');assert.equal(view.keyMasks[1],15);assert.equal(view.keyMasks[2],0);assert.equal(view.registers[0][0x10],0xa0);assert.equal(f.rack.get(1).state.rhythmKeys&32,32);assert.equal(view.registers[0][8],9);f.runtime.context.cancel('b');await f.synth.flush();view=await f.synth.chipInspector.read('voices');assert.equal(view.keyMasks[1],0);assert.equal(view.registers[0][0x10],1);assert.equal(f.rack.get(1).state.rhythmKeys&32,0);assert.equal(view.registers[0][8],9);assert.deepEqual(f.errors,[]);
});
test('Native additional YM2610 concurrent Main lookups retain each caller’s loop owner',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`liveLoop('a',async()=>{const chip=await useSoundChip('ym2610');chip.keyOn(0);log('lookup-a');await beat(100);});liveLoop('b',async()=>{const chip=await useSoundChip('ym2610');chip.keyOn(1);log('lookup-b');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.logs.includes('lookup-a')&&f.logs.includes('lookup-b'));f.runtime.context.cancel('a');await f.synth.flush();let view=await f.synth.chipInspector.read('ym2610:shared');assert.equal(view.keyMasks[1],0);assert.equal(view.keyMasks[2],15);f.runtime.context.cancel('b');await f.synth.flush();view=await f.synth.chipInspector.read('ym2610:shared');assert.equal(view.keyMasks[2],0);assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610 stopped independent Main creation releases its source and reserved ID',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);
  await f.runtime.playSource(`liveLoop('creating',async()=>{const chip=await createSoundChip('ym2610',{id:'pending'});chip.keyOn(0);await beat(100);});context.cancel=()=>stopLoop('creating');`);
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2610_create'));f.runtime.context.cancel();gate.resolve();await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2610_dispose')&&!f.rack.size);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-ym2610'&&c.message.method==='write'&&c.message.register===0x28));assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610 cancelling one pending shared lookup keeps the other caller’s Run-owned source',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);
  await f.runtime.playSource(`liveLoop('a',async()=>{const chip=await useSoundChip('ym2610');chip.keyOn(0);await beat(100);});liveLoop('b',async()=>{const chip=await useSoundChip('ym2610');chip.keyOn(1);log('shared-b-ready');await beat(100);});context.cancel=name=>stopLoop(name);`);
  await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2610_create'));f.runtime.context.cancel('a');gate.resolve();await until(()=>f.logs.includes('shared-b-ready'));const view=await f.synth.chipInspector.read('ym2610:shared');assert.equal(view.keyMasks[1],0);assert.equal(view.keyMasks[2],15);assert.equal(f.rack.size,1);assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_ym2610_create').length,1);f.runtime.context.cancel('b');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('ym2610:shared')).keyMasks[2],0);assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610 Main raw CSM cancellation preserves another FM owner and cannot resurrect cached Timer A',async t=>{
  installWorkers(t);const f=fixture(t);
  await f.runtime.playSource(`const a=await createSoundChip('ym2610',{id:'lead'});liveLoop('csm',async()=>{a.fm.writeAddress(0,0x27);a.fm.writeData(0x85);a.keyOff(1);await beat(100);});liveLoop('normal',async()=>{a.keyOn(1);await beat(100);});context.cancel=name=>stopLoop(name);context.editMode=()=>a.setChannel3SpecialMode(true);context.a=a;`);
  await until(()=>f.commands().some(c=>c.type==='extra-ym2610'&&c.message.method==='write'&&c.message.register===0x28&&c.message.value===0xf2));
  f.runtime.context.cancel('csm');await f.synth.flush();let view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x27]&0x81,0);assert.equal(view.keyMasks[2],15);assert.equal(f.runtime.context.a._getState().modeRegister&0x81,0);
  f.runtime.context.editMode();await f.synth.flush();view=await f.synth.chipInspector.read('lead');assert.equal(view.registers[0][0x27]&0x81,0);
  f.runtime.context.cancel('normal');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('lead')).keyMasks[2],0);assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2610 Worker uses exact A/B state, clock, applied uploads and same-ID cache replacement',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{mode:'ym3812'});await f.runtime.playSource(`const a=await useSoundChip('ym2610');if(a!==await useSoundChip('ym2610')||a.adpcm!==a.adpcmB)throw Error('Alias/cache lost');a.setOperator(3,0,{tl:12});a.ssg.setVolume(2,9);a.ssg.keyOff(2);await a.adpcmA.loadMemory(new Uint8Array([2,3]),0x123400);await a.adpcmB.loadMemory(new Uint8Array([4,5]),0x234500);a.adpcmA.setSample(5,{start:0x123400,end:0x123600});a.adpcmB.setSample({start:0x234500,end:0x234700});await a.setClock(9000000);if(a.fm.clock!==9000000||a.ssg.clock!==2250000||a.adpcmB.clock!==9000000)throw Error('Clock lost');log('worker-ready');keyboard.bind('edited',{async noteOn(){if(a.fm.getState().channels[5].operators[0].tl!==27||a.adpcmA.levels[5]!==213||a.adpcmB.registers[11]!==177)throw Error('Editor state lost');log('worker-state-ok');a.dispose();const next=await useSoundChip('ym2610');if(next===a)throw Error('Not evicted');next.ssg.tone(1,{period:444,volume:8});await next.adpcmA.loadMemory(new Uint8Array([8]),0x456700);log('worker-replaced');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.logs.includes('worker-ready')&&f.runtime.getKeyboardTarget());const i=f.synth.chipInspector,id='ym2610:shared',old=i.getConnectionToken(id);assert.equal(f.byte(1,0,0x123400),2);assert.equal(f.byte(1,1,0x234500),4);assert.equal((await i.read(id)).ssgLevels[2],9);await i.invoke(id,'setOperator',[3,0,{tl:27}]);await i.invoke(id,'adpcmA.setVoice',[5,{volume:21,left:true,right:true}]);await i.invoke(id,'adpcmB.setVolume',[177]);await tick();f.runtime.getKeyboardTarget().noteOn({id:'state',midi:60});await until(()=>f.logs.includes('worker-state-ok'));f.advance(2000);await until(()=>f.logs.includes('worker-replaced'));assert.notEqual(i.getConnectionToken(id),old);assert.equal((await i.read(id)).registers[0][2]|(await i.read(id)).registers[0][3]<<8,444);const uploads=f.commands().filter(c=>['extra-ym2610','extra-ym2610b'].includes(c.type)&&c.message.method==='memory');assert(uploads.every(c=>f.calls.some(call=>call.command==='native_genesis_extra_ym2610_status'&&call.args.after===c.message.id)));assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2610 Worker coalesced lookups and asynchronous ROM/clock acknowledgements retain distinct owners',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`liveLoop('a',async()=>{const a=await useSoundChip('ym2610');await a.adpcmA.loadMemory(new Uint8Array([1]),0);await a.setClock(8000000);a.keyOn(0);a.adpcmA.keyOn(0);log('owner-a-ready');await beat(100);});liveLoop('b',async()=>{const a=await useSoundChip('ym2610');await a.adpcmB.loadMemory(new Uint8Array([2]),0);await a.setClock(8000000);a.keyOn(1);a.adpcmB.keyOn({repeat:true});log('owner-b-ready');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('a');log('owner-a-cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.logs.includes('owner-a-ready')&&f.logs.includes('owner-b-ready')&&f.runtime.getKeyboardTarget());const writes=f.commands().filter(c=>c.type==='extra-ym2610'&&c.message.method==='write'&&c.message.port===0&&c.message.register===0x28&&c.message.value&240);assert.equal(new Set(writes.map(c=>c.owner)).size,2);f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('owner-a-cancelled')&&f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'));let view=await f.synth.chipInspector.read('ym2610:shared');assert.equal(view.keyMasks[1],0);assert.equal(view.keyMasks[2],15);assert.equal(view.registers[0][0x10],0xb0);assert.equal(f.rack.get(1).state.rhythmKeys&1,0);assert.deepEqual(f.errors,[]);
});
test('Native additional YM2610 participates in one mixed five-kind sixteen-slot rack and releases cached IDs on Stop',async t=>{
  installWorkers(t);const f=fixture(t);const create=f.synth.createExtraYm2608.bind(f.synth);f.synth.createExtraYm2608=options=>create({...options,fetcher:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(8192).buffer})});await f.runtime.playSource(`context.api={createSoundChip};`);for(let index=0;index<16;index++)await f.runtime.context.api.createSoundChip(['ym2610','ym2612','segapsg','ym2203','ym2608'][index%5],{id:`mixed-${index}`});assert.equal(f.synth.extraDevices.size,16);assert.equal(f.synth.extraYm2610Devices.size,4);await assert.rejects(f.runtime.context.api.createSoundChip('ym2610'),/at most 16/);assert.equal(new Set(f.calls.filter(c=>c.command.endsWith('_create')).map(c=>c.args.instance)).size,16);assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});await f.runtime.stopWithFade();assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert.deepEqual(f.errors,[]);
});


test('Native additional YM2610B exposes six physical FM channels beside independent mapped YM2610 and Mixer',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2610b',{id:'six'});context.b=await createSoundChip('ym2610',{id:'four'});`);const {a,b}=f.runtime.context;
  assert.equal(a.channelCount,6);assert.equal(a.fm,undefined);assert.equal(a.adpcm,a.adpcmB);assert.equal(a.getState().channels.length,6);assert.throws(()=>a.read(0),/does not support read/);
  for(let ch=0;ch<6;ch++){a.setOperator(ch,0,{tl:20+ch});a.setPan(ch,true,false);a.keyOn(ch);}
  b.keyOn(0);await f.synth.flush();let view=await f.synth.chipInspector.read(a.id);
  assert.equal(view.kind,'ym2610b');assert.equal(view.variant,'ym2610b');assert.equal(view.fmState.channels.length,6);assert.deepEqual(view.fmState.channels.map(ch=>ch.operators[0].tl),[20,21,22,23,24,25]);assert.deepEqual(view.keyMasks,Array(6).fill(15));assert.equal(view.keyboardChannels.length,16);
  assert.deepEqual((await f.synth.chipInspector.read(b.id)).keyMasks,[0,15,0,0,0,0]);assert.equal(f.synth.extraYm2610BDevices.size,1);assert.equal(f.synth.extraYm2610Devices.size,1);assert.throws(()=>a.keyOn(6),/0..5/);assert.throws(()=>b.keyOn(4),/0..3/);
  f.synth.mixer.set(a.id,{volume:.42,pan:-.25});await f.synth.flush();assert.equal(f.rack.get(1).state.volume,.42);assert.equal(f.rack.get(2).state.volume,1);assert(f.synth.capabilities.dynamicSoundChipKinds.includes('ym2610b'));
  const authored=a._getState();await f.synth.chipInspector.read(a.id);assert.deepEqual(a._getState(),authored);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610B keeps both ROM banks and SSG state isolated and acknowledges large atomic transfers',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2610b',{id:'a'});context.b=await createSoundChip('ym2610b',{id:'b'});`);const {a,b}=f.runtime.context;
  const bytes=new Uint8Array(128*1024);bytes[0]=3;bytes[bytes.length-1]=7;
  await a.adpcmA.loadMemory(bytes,0x80000);await a.adpcmB.loadMemory(new Uint8Array([4,5]),0x80000);await b.adpcmA.loadMemory(new Uint8Array([9]),0x80000);
  a.ssg.tone(2,{period:555,volume:11});a.ssg.keyOff(2);a.adpcmA.setSample(5,{start:0x80000,end:0xa0000});a.adpcmA.setVoice(5,{volume:19,left:true,right:false});a.adpcmB.setSample({start:0x80000,end:0x80100});a.adpcmB.setDeltaN(12345);a.adpcmB.setVolume(177);a.adpcmB.keyOn({repeat:true});await f.synth.flush();
  let view=await f.synth.chipInspector.read(a.id);assert.equal(f.byte(1,0,0x80000),3);assert.equal(f.byte(1,0,0x9ffff),7);assert.equal(f.byte(1,1,0x80000),4);assert.equal(f.byte(2,0,0x80000),9);assert.equal(view.ssgLevels[2],11);assert.equal(view.registers[0][10],0);assert.equal(view.registers[1][13],147);assert.equal(view.registers[0][0x1b],177);assert.equal(view.registers[0][0x10],0xb0);
  const upload=f.commands().find(c=>c.type==='extra-ym2610b'&&c.message.method==='memory');assert.equal(upload.message.data.length,bytes.length);assert(f.calls.some(c=>c.command==='native_genesis_extra_ym2610b_status'&&c.args.after===upload.message.id));assert.equal(f.synth.acceptedPcmBytes,0);
  f.budget(true);await assert.rejects(a.adpcmA.loadMemory(new Uint8Array([99]),0x80000),/memory budget/);f.budget(false);assert.equal(f.synth.state,'ready');assert.equal(f.byte(1,0,0x80000),3);a.keyOn(0);await f.synth.flush();assert.equal((await f.synth.chipInspector.read(a.id)).keyMasks[0],15);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610B Inspector edits all six FM voices, sixteen Keyboard leases and clock domains',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2610b',{id:'edit'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  for(let ch=0;ch<6;ch++)await i.invoke(a.id,'setOperator',[ch,0,{tl:31+ch}]);await i.invoke(a.id,'ssg.setVolume',[1,9]);await i.invoke(a.id,'adpcmA.setVoice',[5,{volume:21,left:true,right:true}]);await i.invoke(a.id,'adpcmB.setVolume',[177]);
  let view=await i.read(a.id);assert.deepEqual(view.fmState.channels.map(ch=>ch.operators[0].tl),[31,32,33,34,35,36]);assert.deepEqual(a.getState().channels.map(ch=>ch.operators[0].tl),[31,32,33,34,35,36]);assert.equal(a.adpcmA.levels[5],213);assert.equal(a.adpcmB.registers[11],177);
  for(const ch of view.keyboardChannels)await i.invoke(a.id,'auditionOn',[ch.id,69,ch.id]);view=await i.read(a.id);assert.equal(view.held.length,16);assert(view.held.includes('fm:0'));assert(view.held.includes('fm:3'));assert(!view.held.includes('fm:-1'));
  await assert.rejects(a.setClock(7000000),/manually held additional YM2610B/);assert.equal(a.clock,8000000);assert.equal(f.synth.state,'ready');await i.invoke(a.id,'auditionOff',['fm:3','stale']);assert((await i.read(a.id)).held.includes('fm:3'));await i.invoke(a.id,'auditionAllOff');assert.deepEqual((await i.read(a.id)).held,[]);
  await a.setClock(7000000);assert.equal(a.clock,7000000);assert.equal(a.ssg.clock,1750000);assert.equal(a.adpcmB.clock,7000000);await assert.rejects(i.invoke(a.id,'setOperator',[6,0,{tl:9}]),/0..5/);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610B immutable variant rejects a misrouted status snapshot',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2610b',{id:'six'});`);f.rack.get(1).state.variant='ym2610';await assert.rejects(f.synth.chipInspector.read('six'),/variant/);assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610B Main owners cancel physical FM0/FM3 without touching replacement or manual leases',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('ym2610b',{id:'voices'});liveLoop('a',async()=>{a.keyOn(0);a.keyOn(3);a.keyOn(2);a.ssg.tone(0,{period:444,volume:9});a.adpcmA.keyOn(5);a.adpcmB.keyOn({repeat:true});await beat(100);});liveLoop('b',async()=>{await sleep(.02);a.keyOn(3);a.adpcmA.keyOn(5);a.adpcmB.keyOn();log('b-ready');await beat(100);});context.cancel=name=>stopLoop(name);`);await until(()=>f.logs.includes('b-ready'));
  await f.synth.chipInspector.invoke('voices','auditionOn',['fm:0',69,'manual']);f.runtime.context.cancel('a');await f.synth.flush();let view=await f.synth.chipInspector.read('voices');assert.equal(view.keyMasks[0],15);assert.equal(view.keyMasks[2],0);assert.equal(view.keyMasks[3],15);assert.equal(view.registers[0][0x10],0xa0);assert.equal(f.rack.get(1).state.rhythmKeys&32,32);assert.equal(view.registers[0][8],0);
  f.runtime.context.cancel('b');await f.synth.flush();view=await f.synth.chipInspector.read('voices');assert.equal(view.keyMasks[0],15);assert.equal(view.keyMasks[3],0);assert.equal(view.registers[0][0x10],1);assert.equal(f.rack.get(1).state.rhythmKeys&32,0);await f.synth.chipInspector.invoke('voices','auditionAllOff');assert.deepEqual((await f.synth.chipInspector.read('voices')).keyMasks,Array(6).fill(0));assert.deepEqual(f.errors,[]);
});

test('Native additional YM2610B late Main creation releases its native instance, family entry and reserved ID',async t=>{
  installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);await f.runtime.playSource(`liveLoop('creating',async()=>{const a=await createSoundChip('ym2610b',{id:'pending'});a.keyOn(0);await beat(100);});context.cancel=()=>stopLoop('creating');`);await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2610b_create'));f.runtime.context.cancel();gate.resolve();await until(()=>f.calls.some(c=>c.command==='native_genesis_extra_ym2610b_dispose')&&!f.rack.size);
  assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.extraYm2610BDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert(!f.commands().some(c=>c.type==='extra-ym2610b'&&c.message.method==='write'&&c.message.register===0x28));assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2610B Worker retains full six-channel author edits, memory/clock acknowledgements and same-ID replacement',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{mode:'ym3812'});await f.runtime.playSource(`const a=await useSoundChip('ym2610b');if(a!==await useSoundChip('ym2610b')||a.channelCount!==6||a.adpcm!==a.adpcmB)throw Error('Variant/cache lost');a.setOperator(0,0,{tl:11});a.setOperator(3,0,{tl:22});await a.adpcmA.loadMemory(new Uint8Array([2]),0x123400);await a.adpcmB.loadMemory(new Uint8Array([4]),0x234500);await a.setClock(9000000);if(a.clock!==9000000||a.ssg.clock!==2250000||a.adpcmB.clock!==9000000)throw Error('Clock lost');log('worker-b-ready');keyboard.bind('edited',{async noteOn(){if(a.getState().channels[0].operators[0].tl!==27||a.getState().channels[3].operators[0].tl!==28)throw Error('Editor state lost');log('worker-b-state-ok');a.dispose();const next=await useSoundChip('ym2610b');if(next===a)throw Error('Not evicted');next.keyOn(3);await next.adpcmA.loadMemory(new Uint8Array([8]),0x456700);log('worker-b-replaced');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});
  await until(()=>f.logs.includes('worker-b-ready')&&f.runtime.getKeyboardTarget());const i=f.synth.chipInspector,id='ym2610b:shared',old=i.getConnectionToken(id);assert.equal(f.byte(1,0,0x123400),2);assert.equal(f.byte(1,1,0x234500),4);await i.invoke(id,'setOperator',[0,0,{tl:27}]);await i.invoke(id,'setOperator',[3,0,{tl:28}]);await tick();f.runtime.getKeyboardTarget().noteOn({id:'state',midi:60});await until(()=>f.logs.includes('worker-b-state-ok'));f.advance(2000);await until(()=>f.logs.includes('worker-b-replaced'));assert.notEqual(i.getConnectionToken(id),old);assert.equal((await i.read(id)).keyMasks[3],15);
  const uploads=f.commands().filter(c=>c.type==='extra-ym2610b'&&c.message.method==='memory');assert(uploads.every(c=>f.calls.some(call=>call.command==='native_genesis_extra_ym2610b_status'&&call.args.after===c.message.id)));await f.runtime.stopWithFade();assert.equal(f.synth.extraYm2610BDevices.size,0);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.rack.size,0);assert.deepEqual(f.errors,[]);
});

test('Actual Native YM2610B Worker coalesced lookups keep distinct physical FM0/FM3 loop owners',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`liveLoop('a',async()=>{const a=await useSoundChip('ym2610b');await a.adpcmA.loadMemory(new Uint8Array([1]),0);await a.setClock(8000000);a.keyOn(0);a.adpcmA.keyOn(0);log('owner-b-a-ready');await beat(100);});liveLoop('b',async()=>{const a=await useSoundChip('ym2610b');await a.adpcmB.loadMemory(new Uint8Array([2]),0);await a.setClock(8000000);a.keyOn(3);a.adpcmB.keyOn({repeat:true});log('owner-b-b-ready');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('a');log('owner-b-a-cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.logs.includes('owner-b-a-ready')&&f.logs.includes('owner-b-b-ready')&&f.runtime.getKeyboardTarget());
  assert.equal(f.calls.filter(c=>c.command==='native_genesis_extra_ym2610b_create').length,1);const writes=f.commands().filter(c=>c.type==='extra-ym2610b'&&c.message.method==='write'&&c.message.port===0&&c.message.register===0x28&&c.message.value&240);assert.equal(new Set(writes.map(c=>c.owner)).size,2);f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('owner-b-a-cancelled')&&f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'));const view=await f.synth.chipInspector.read('ym2610b:shared');assert.equal(view.keyMasks[0],0);assert.equal(view.keyMasks[3],15);assert.equal(view.registers[0][0x10],0xb0);assert.equal(f.rack.get(1).state.rhythmKeys&1,0);assert.deepEqual(f.errors,[]);
});
