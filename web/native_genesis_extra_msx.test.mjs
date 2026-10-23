import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createYm2413Client} from './playground_ym2413.js';
import {createAy8910Client} from './playground_ay8910.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(predicate){const deadline=Date.now()+5000;while(!predicate()){if(Date.now()>deadline)throw new Error('Additional OPLL/AY test timed out');await tick();}}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function installWorkers(t){
  const previous={window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,AudioWorkletNode:globalThis.AudioWorkletNode};
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){throw new Error('Native OPLL/AY attempted Web Audio');}};
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
const PHYSICAL=[0,1,2,3,4,5,6,7,8,6,7,8,8,7],KINDS=['ym2413','ay8910','ym2151','ym2610','ym2612','segapsg','ym2203','ym2608'];
const state=kind=>({clock:kind==='ay8910'?1789773:3579545,registers:Array(kind==='ay8910'?16:64).fill(0),levels:[9,9,9],gates:[false,false,false],status:0,irq:false,held:[],pendingCommands:[],layoutRevision:0,layoutPending:false});
function fixture(t,{mode='genesis',future=false}={}){
  const calls=[],errors=[],logs=[],rack=new Map(),manual=new Map(),owners=new Map(),progress=new Map(),queue=[],waiters=[];let gate=null,offset=0;const started=Date.now(),now=()=>future?offset:Date.now()-started+offset;
  const status=()=>({session:1,mode,engine:'ymfm',sampleRate:48000,frame:Math.floor(now()*48),ymClock:7670454,psgClock:3579545,running:true});
  const layoutCommand=message=>message.method==='reset'||message.method==='write'&&message.register===14||message.method==='batch'&&message.commands.some(layoutCommand);
  const layoutPending=instance=>queue.some(c=>c.instance===instance&&layoutCommand(c.message));
  function snapshot(kind,instance){const source=rack.get(instance);if(!source||source.kind!==kind)throw Error('Additional sound chip is not connected');return {[kind]:{...structuredClone(source.state),layoutPending:layoutPending(instance),pendingCommands:queue.filter(c=>c.instance===instance&&c.message.id).map(c=>c.message.id)},sampleRate:48000,frame:status().frame,revision:calls.length};}
  function settle(){for(let index=waiters.length-1;index>=0;index--){const w=waiters[index],s=rack.get(w.instance)?.state;if(!s){waiters.splice(index,1);w.reject(new DOMException('Disposed','AbortError'));}else if(w.afterLayoutRevision!==undefined?(s.layoutRevision!==w.afterLayoutRevision||progress.get(s)!==w.progress||!layoutPending(w.instance)):!queue.some(c=>c.instance===w.instance&&c.message.id===w.after)){waiters.splice(index,1);w.resolve(snapshot(w.kind,w.instance));}}}
  function apply(kind,s,m,{audition=false,owner,group=m.group,channel}={}){
    const before=s.registers[14]&32,revision=s.layoutRevision;
    applyCommand(kind,s,m,{audition,owner,group,channel});
    if(kind==='ym2413'&&(m.method==='reset'||m.method==='write'&&m.register===14)){s.layoutRevision=revision+Number(before!==(s.registers[14]&32));progress.set(s,(progress.get(s)??0)+1);}
  }
  function applyCommand(kind,s,m,{audition=false,owner,group=m.group,channel}={}){
    const held=manual.get(s),owned=owners.get(s),physical=ch=>kind==='ym2413'?PHYSICAL[ch]:ch;
    if(group===undefined&&owner!==undefined)group=`worker:${owner}`;
    const manualAt=ch=>[...held.keys()].some(key=>physical(key)===physical(ch)),allowed=ch=>audition||!manualAt(ch),offAllowed=ch=>allowed(ch)&&(audition||group===undefined||!owned.has(ch)||owned.get(ch)===group);
    function off(ch){if(!offAllowed(ch))return;if(kind==='ay8910'){s.registers[8+ch]=0;s.gates[ch]=false;}else if(ch<9)s.registers[32+ch]&=~16;else s.registers[14]&=~(16>>(ch-9));owned.delete(ch);}
    if(m.method==='batch'){
      if(m.action==='off'&&held.get(m.channel)!==m.voice)return;
      for(const command of m.commands)apply(kind,s,command,{audition:true,owner,group,channel:m.channel});
      if(m.action==='on'){for(const key of [...held.keys()])if(physical(key)===physical(m.channel))held.delete(key);held.set(m.channel,m.voice);for(const key of [...owned.keys()])if(physical(key)===physical(m.channel))owned.delete(key);}else if(m.action==='off')held.delete(m.channel);s.held=[...held.keys()];return;
    }
    if(m.method==='clock'){if(held.size)throw Error(`Release the manually held additional ${kind.toUpperCase()} voices before changing the clock`);s.clock=m.hz;}
    else if(m.method==='mix'){s.volume=m.volume;s.pan=m.pan;}
    else if(m.method==='reset'){if(!held.size||audition){const clock=s.clock;Object.assign(s,state(kind),{clock});owned.clear();}}
    else if(m.method==='cancel-main-owner'){for(let i=queue.length-1;i>=0;i--)if(rack.get(queue[i].instance)?.state===s&&queue[i].message.group===m.targetGroup)queue.splice(i,1);for(const [ch,g]of [...owned])if(g===m.targetGroup)off(ch);}
    else if(m.method==='all-notes-off'||m.method==='stop-voices')for(let ch=0;ch<(kind==='ym2413'?14:3);ch++)off(ch);
    else if(m.method==='key-off')off(m.channel);
    else if(m.method==='audition-key-on'){if(m.channel<9)s.registers[32+m.channel]|=16;else s.registers[14]|=16>>(m.channel-9);}
    else if(m.method==='set-retained-level'){if(allowed(m.channel))s.levels[m.channel]=m.level;}
    else if(m.method==='write'){
      const r=m.register,v=m.value;
      if(kind==='ay8910'){
        if(r>=8&&r<=10){const ch=r-8;if(!allowed(ch)||!(v&31)&&!offAllowed(ch))return;s.registers[r]=v;s.gates[ch]=!!(v&31);if(v&31){s.levels[ch]=v&31;owned.set(ch,group);}else owned.delete(ch);}
        else if(r===7){let value=s.registers[r];for(let ch=0;ch<3;ch++)if(allowed(ch))value=(value&~(9<<ch))|(v&(9<<ch));s.registers[r]=value;}
        else if(r<=5){if(allowed(r>>1))s.registers[r]=v;}else if(!held.size||audition)s.registers[r]=v;
      }else if(kind==='ym2413'){
        if(r>=32&&r<=40){const ch=r-32;if(!allowed(ch)||!(v&16)&&!offAllowed(ch))return;s.registers[r]=v;if(v&16)owned.set(ch,group);else owned.delete(ch);}
        else if(r===14){let value=s.registers[14];if(!held.size||audition)value=(value&31)|(v&224);for(let drum=0;drum<5;drum++){const ch=9+drum,bit=16>>drum;if(!allowed(ch)||!(v&bit)&&!offAllowed(ch))continue;if(v&bit){if(!(value&bit)||m.intentMask&bit)owned.set(ch,group);value|=bit;}else{value&=~bit;owned.delete(ch);}}s.registers[r]=value;}
        else if(r>=16&&r<=24){if(allowed(r-16))s.registers[r]=v;}
        else if(r>=48&&r<=56){if(allowed(r-48))s.registers[r]=v;}
        else if(!held.size||audition)s.registers[r]=v;
      }
    }
  }
  function advance(ms){offset+=ms;for(let i=0;i<queue.length;){const entry=queue[i];if(entry.frame<=status().frame){queue.splice(i,1);const source=rack.get(entry.instance);if(source)apply(source.kind,source.state,entry.message,{owner:entry.owner});}else i++;}settle();}
  const invoke=async(command,args={})=>{
    calls.push({command,args});if(command==='native_genesis_opl_status')return {ym3812:{chip:'ym3812',clock:3579545,registers:Array(256).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000},sampleRate:48000,frame:status().frame,revision:0};
    const match=/^native_genesis_extra_(psg|ym2612|ym2203|ym2608|ym2610|ym2151|ym2413|ay8910)_(create|dispose|status)$/.exec(command);
    if(match){const kind=match[1]==='psg'?'segapsg':match[1],op=match[2];if(op==='create'){if(gate)await gate.promise;if(rack.size>=16)throw Error('Native audio supports at most 16 additional sound chips');const s=state(kind);rack.set(args.instance,{kind,state:s});manual.set(s,new Map());owners.set(s,new Map());progress.set(s,0);}if(op==='dispose'){rack.delete(args.instance);settle();return true;}if(args.after&&queue.some(c=>c.instance===args.instance&&c.message.id===args.after))return new Promise((resolve,reject)=>waiters.push({kind,instance:args.instance,after:args.after,resolve,reject}));if(args.afterLayoutRevision!==undefined&&rack.get(args.instance).state.layoutRevision===args.afterLayoutRevision&&layoutPending(args.instance))return new Promise((resolve,reject)=>waiters.push({kind,instance:args.instance,afterLayoutRevision:args.afterLayoutRevision,progress:progress.get(rack.get(args.instance).state),resolve,reject}));return snapshot(kind,args.instance);}
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();queue.length=0;settle();}
    if(command==='native_genesis_performance'&&args.op==='cancel-owner'){for(let i=queue.length-1;i>=0;i--)if(queue[i].owner===args.owner)queue.splice(i,1);for(const {kind,state:s}of rack.values())for(const [ch,g]of [...owners.get(s)])if(g===`worker:${args.owner}`)apply(kind,s,{method:'key-off',channel:ch},{group:g});settle();}
    if(command==='native_genesis_commands')for(const entry of args.commands)if(entry.type.startsWith('extra-')){const source=rack.get(entry.instance);if(!source)throw Error('Additional sound chip is not connected');if(future&&entry.frame>status().frame)queue.push(entry);else apply(source.kind,source.state,entry.message,{owner:entry.owner});}settle();return status();
  };
  const synth=new NativeGenesisSynth({mode,invoke,now,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());return {synth,runtime,calls,errors,logs,rack,queue,waiters,gate:value=>{gate=value;},advance,commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[])};
}
test('Native additional OPLL and AY preserve the exact Browser authoring API, initialization and independent Mixer',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.api={createSoundChip};`);
  for(const [kind,create,exercise]of [
    ['ym2413',createYm2413Client,api=>{api.setUserPatch({feedback:5,operators:[{multi:3,tl:11},{ar:12,rr:5}]});api.setVoice(0,{instrument:0,attenuation:4,sustain:true});api.noteOn(0,'A4');api.setRhythm({enabled:true,bassDrum:true,snare:true});api.setRhythmLevels({hiHat:3,snare:5,tom:7,cymbal:9});api.setRhythm({snare:false});}],
    ['ay8910',createAy8910Client,api=>{api.tone(0,{note:'A4',volume:11});api.noise(1,{period:7,volume:6});api.setEnvelope({period:123,shape:9});api.setVolume(2,7,true);api.keyOff(0);api.keyOn(0);api.setVolume(2,0);api.setEnvelope({period:321});}],
  ]){
    const native=await f.runtime.context.api.createSoundChip(kind,{id:kind}),publicCommands=[],web=create({postMessage:message=>publicCommands.push(message),close(){},start(){}},{});web.initialize();exercise(web);const before=f.commands().length;exercise(native);await f.synth.flush();
    assert.deepEqual(native._getState(),web._getState());const ordinary=publicCommands.filter(c=>c.method==='writeRegister').map(c=>c.args),actual=f.commands().slice(before).filter(c=>c.type===`extra-${kind}`&&c.message.method==='write').map(c=>[c.message.register,c.message.value]);assert.deepEqual(actual,ordinary.slice(ordinary.length-actual.length));
    assert.equal(native.read,undefined);assert.equal(native.prepareTimeline,undefined);assert.equal(native.generateStereo,undefined);assert.equal(native.readStatus,undefined);assert.equal(native.clock,kind==='ym2413'?3579545:1789773);assert(f.synth.chipInspector.list().find(entry=>entry.id===kind).additional);
    f.synth.mixer.set(kind,{volume:.25,pan:.4});await f.synth.flush();assert.equal([...f.rack.values()].find(entry=>entry.kind===kind).state.volume,.25);assert.equal(f.synth.audioContext,null);
  }
  assert.equal(f.synth.mixer.exportState().entries.length,2);assert.deepEqual(f.errors,[]);
});

test('Native additional OPLL Inspector stages shared patch edits and manual physical drum lease handoff independently of author pitch',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ym2413',{id:'a'});context.b=await createSoundChip('ym2413',{id:'b'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;
  a.setVoice(0,{instrument:0,attenuation:4,sustain:true});await f.synth.flush();f.rack.get(1).state.registers[48]=1;await i.invoke('a','setAttenuation',[0,6]);assert.equal(a._getState().registers[48],6);await i.invoke('a','setUserOperator',[0,{multi:7,tl:12}]);assert.equal((await i.read('a')).userPatch.operators[0].mul,7);assert.notEqual((await i.read('b')).userPatch.operators[0].mul,7);
  const authored=a._getState();for(let ch=0;ch<9;ch++)await i.invoke('a','auditionOn',[ch,60+ch,`fm${ch}`]);assert.deepEqual((await i.read('a')).held,[0,1,2,3,4,5,6,7,8]);assert.deepEqual(a._getState(),authored);await assert.rejects(a.setClock(4000000),/manually held additional YM2413/);assert.equal(f.synth.state,'ready');
  await i.invoke('a','setRhythm',[{enabled:true}]);assert.deepEqual((await i.read('a')).held,[]);assert.equal(i.list().find(x=>x.id==='a').rhythmEnabled,true);const before=f.commands().length;await i.invoke('a','auditionOn',['rhythm:1',60,'snare']);await i.invoke('a','auditionOn',['rhythm:4',61,'hat']);assert.deepEqual((await i.read('a')).held,['rhythm:4']);const packets=f.commands().slice(before).filter(c=>c.message?.method==='batch');assert(packets.some(c=>c.message.channel===10&&c.message.action==='off'));assert(packets.some(c=>c.message.channel===13&&c.message.action==='on'));await i.invoke('a','auditionOff',['rhythm:4','stale']);assert.deepEqual((await i.read('a')).held,['rhythm:4']);await i.invoke('a','auditionAllOff');await a.setClock(4000000);assert.equal(a.clock,4000000);await i.invoke('a','setRhythm',[{enabled:false}]);assert.equal(i.list().find(x=>x.id==='a').rhythmEnabled,false);assert.deepEqual(f.errors,[]);
});

test('Native additional AY retains explicit volume zero, preserves keyOff level and applies Inspector edits without rewriting author pitch',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`context.a=await createSoundChip('ay8910',{id:'ay'});`);const a=f.runtime.context.a,i=f.synth.chipInspector;a.tone(0,{note:'C4',volume:12});a.keyOff(0);a.setVolume(1,0);await f.synth.flush();let view=await i.read('ay');assert.equal(view.channels[0].configuredVolume,12);assert.equal(view.channels[0].active,false);assert.equal(view.channels[1].volume,0);
  await i.invoke('ay','setVolume',[1,0]);await i.invoke('ay','setEnvelope',[{period:567,shape:11}]);const count=f.commands().filter(c=>c.message?.method==='batch'&&c.message.commands.some(op=>op.register===13)).length;await i.invoke('ay','setEnvelope',[{period:321}]);assert.equal(f.commands().filter(c=>c.message?.method==='batch'&&c.message.commands.some(op=>op.register===13)).length,count,'period adjustment does not retrigger shape');
  const authored=a._getState();for(let ch=0;ch<3;ch++)await i.invoke('ay','auditionOn',[ch,69+ch,`key${ch}`]);view=await i.read('ay');assert.deepEqual(view.held,[0,1,2]);assert.deepEqual(a._getState(),authored);await assert.rejects(a.setClock(2000000),/manually held additional AY8910/);assert.equal(f.synth.state,'ready');await i.invoke('ay','auditionAllOff');a.keyOn(1);await f.synth.flush();assert.equal((await i.read('ay')).channels[1].volume,0);await a.setClock(2000000);assert.equal(a.clock,2000000);assert.deepEqual(f.errors,[]);
});

for(const kind of ['ym2413','ay8910']){
  test(`Native additional ${kind} concurrent Main cached lookups and scoped all-off retain the other owner and manual leases`,async t=>{
    installWorkers(t);const f=fixture(t),start=kind==='ym2413'?`chip.setAttenuation(CH,3);chip.noteOn(CH,'A4');`:`chip.tone(CH,{note:'A4',volume:11});`;
    await f.runtime.playSource(`liveLoop('a',async()=>{const chip=await useSoundChip('${kind}');${start.replaceAll('CH','0')}log('a-ready');await beat(100);});liveLoop('b',async()=>{const chip=await useSoundChip('${kind}');${start.replaceAll('CH','1')}log('b-ready');await beat(100);});context.cancel=name=>stopLoop(name);`);await until(()=>f.logs.includes('a-ready')&&f.logs.includes('b-ready'));const i=f.synth.chipInspector,id=`${kind}:shared`;await i.invoke(id,'auditionOn',[2,69,'manual']);f.runtime.context.cancel('a');await f.synth.flush();let view=await i.read(id);assert.equal(view.channels[0].active,false);assert.equal(view.channels[1].active,true);assert.deepEqual(view.held,[2]);f.runtime.context.cancel('b');await f.synth.flush();view=await i.read(id);assert.equal(view.channels[1].active,false);assert.deepEqual(view.held,[2]);assert.equal(f.rack.size,1);assert.deepEqual(f.errors,[]);
  });
  test(`Native additional ${kind} stopped independent creation releases reservation while shared cancellation preserves another caller`,async t=>{
    installWorkers(t);const f=fixture(t),gate=deferred();f.gate(gate);await f.runtime.playSource(`liveLoop('creating',async()=>{const chip=await createSoundChip('${kind}',{id:'pending'});chip.noteOn(0,'A4');await beat(100);});context.cancel=()=>stopLoop('creating');`);await until(()=>f.calls.some(c=>c.command===`native_genesis_extra_${kind}_create`));assert(!f.synth.chipInspector.list().some(x=>x.id==='pending'));f.runtime.context.cancel();gate.resolve();await until(()=>!f.rack.size&&f.calls.some(c=>c.command===`native_genesis_extra_${kind}_dispose`));assert.equal(f.synth.mixer.reservedIds.size,0);assert.equal(f.synth.extraDevices.size,0);assert.deepEqual(f.errors,[]);
  });
  test(`Actual Native ${kind} Worker clock awaits, exact-instance Inspector edits and shared replacement retain author state`,{timeout:10000},async t=>{
    installWorkers(t);const f=fixture(t,{mode:'ym3812'}),edit=kind==='ym2413'?`a.setAttenuation(0,4);`:`a.setVolume(0,11);`,check=kind==='ym2413'?`(a._getState().registers[48]&15)!==7`:`a._getState().levels[0]!==7`;
    await f.runtime.playSource(`const a=await useSoundChip('${kind}');if(a!==await useSoundChip('${kind}'))throw Error('cache');${edit}await a.setClock(2000000);a.noteOn(0,'A4');log('worker-ready');keyboard.bind('edit',{async noteOn(){if(${check}||a.clock!==2000000)throw Error('Editor state lost');log('worker-state-ok');a.dispose();const b=await useSoundChip('${kind}');if(b===a)throw Error('Stale source');await b.setClock(2100000);b.noteOn(1,'C4');log('worker-replaced');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.logs.includes('worker-ready')&&f.runtime.getKeyboardTarget());const i=f.synth.chipInspector,id=`${kind}:shared`,old=i.getConnectionToken(id);await i.invoke(id,kind==='ym2413'?'setAttenuation':'setVolume',[0,7]);await tick();f.runtime.getKeyboardTarget().noteOn({id:'state',midi:60});await until(()=>f.logs.includes('worker-state-ok'));f.advance(2000);await until(()=>f.logs.includes('worker-replaced'));assert.notEqual(i.getConnectionToken(id),old);assert.equal((await i.read(id)).clock,2100000);assert.deepEqual(f.errors,[]);
  });
  test(`Actual Native ${kind} Worker coalesced cached lookups and clock continuations retain distinct source owners`,{timeout:10000},async t=>{
    installWorkers(t);const f=fixture(t),start=kind==='ym2413'?`a.setAttenuation(CH,3);a.noteOn(CH,'A4');`:`a.tone(CH,{note:'A4',volume:11});`;
    await f.runtime.playSource(`liveLoop('a',async()=>{const a=await useSoundChip('${kind}');await a.setClock(2000000);${start.replaceAll('CH','0')}log('a-ready');await beat(100);});liveLoop('b',async()=>{const a=await useSoundChip('${kind}');await a.setClock(2000000);${start.replaceAll('CH','1')}log('b-ready');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('a');log('a-cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.logs.includes('a-ready')&&f.logs.includes('b-ready')&&f.runtime.getKeyboardTarget());f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('a-cancelled')&&f.calls.some(c=>c.command==='native_genesis_performance'&&c.args.op==='cancel-owner'));const view=await f.synth.chipInspector.read(`${kind}:shared`);assert.equal(view.channels[0].active,false);assert.equal(view.channels[1].active,true);assert.deepEqual(f.errors,[]);
  });
}

test('Native OPLL explicit rhythm intent replaces only requested gates while raw preserved bits retain their owner',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const chip=await createSoundChip('ym2413',{id:'drums'});chip.setRhythm({enabled:true});liveLoop('a',async()=>{chip.setRhythm({snare:true});await beat(100);});liveLoop('b',async()=>{chip.setRhythm({hiHat:true});await beat(100);});context.cancel=name=>stopLoop(name);context.replace=()=>chip.setRhythm({snare:true});`);await until(()=>f.commands().some(c=>c.message?.intentMask===1));f.runtime.context.cancel('a');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('drums')).registers[14]&31,1);assert(f.commands().some(c=>c.message?.intentMask===8));assert.deepEqual(f.errors,[]);
});
test('Native OPLL repeated explicit drum key-on transfers its lease while a raw preserved sibling gate does not',async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const chip=await createSoundChip('ym2413',{id:'drums'});chip.setRhythm({enabled:true});liveLoop('old',async()=>{chip.setRhythm({snare:true});await beat(100);});liveLoop('new',async()=>{chip.setRhythm({snare:true});await beat(100);});liveLoop('raw',async()=>{chip.writeRegister(14,41);await beat(100);});context.cancel=name=>stopLoop(name);`);await until(()=>f.commands().filter(c=>c.message?.intentMask===8).length===2&&f.commands().some(c=>c.message?.register===14&&c.message.value===41&&c.message.intentMask===undefined));f.runtime.context.cancel('old');f.runtime.context.cancel('raw');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('drums')).registers[14]&31,8);f.runtime.context.cancel('new');await f.synth.flush();assert.equal((await f.synth.chipInspector.read('drums')).registers[14]&31,0);assert.deepEqual(f.errors,[]);
});

test('Actual Native OPLL Worker layout metadata waits for applied mode and cancels future transitions with one bounded observer',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`const a=await createSoundChip('ym2413',{id:'layout'});liveLoop('mode',async()=>{await beat(1);a.writeRegister(14,32);log('mode-queued');await beat(100);});keyboard.bind('cancel',{noteOn(){stopLoop('mode');log('mode-cancelled');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.logs.includes('mode-queued')&&f.waiters.length===1&&f.queue.some(c=>c.message.register===14&&c.message.value===32&&c.frame>0)&&f.runtime.getKeyboardTarget());const i=f.synth.chipInspector;assert.notEqual(i.list().find(x=>x.id==='layout').rhythmEnabled,true);assert.equal((await i.read('layout')).keyboardChannels.length,9);assert.equal(f.waiters.length,1);f.runtime.getKeyboardTarget().noteOn({id:'cancel',midi:60});await until(()=>f.logs.includes('mode-cancelled')&&!f.queue.some(c=>c.message.register===14));assert.notEqual(i.list().find(x=>x.id==='layout').rhythmEnabled,true);assert.equal(f.waiters.length,0);assert.deepEqual(f.errors,[]);
});
test('Actual Native OPLL Worker publishes coalesced rhythm layout only after its future hardware frame applies',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`const a=await createSoundChip('ym2413',{id:'layout'});liveLoop('mode',async()=>{await beat(1);a.writeRegister(14,32);for(let i=0;i<40;i++)a.writeRegister(14,32|(i&31));log('mode-queued');await beat(100);});`,{execution:'worker'});await until(()=>f.logs.includes('mode-queued')&&f.waiters.length===1&&f.queue.filter(c=>c.message.register===14&&c.frame>0).length===41);const i=f.synth.chipInspector;assert.notEqual(i.list().find(x=>x.id==='layout').rhythmEnabled,true);assert.equal(f.waiters.length,1);const observations=f.calls.filter(c=>c.command==='native_genesis_extra_ym2413_status').length;assert(observations<=2,'rapid authoring creates one active completion fence');f.advance(2000);await until(()=>i.list().find(x=>x.id==='layout')?.rhythmEnabled===true);assert.equal((await i.read('layout')).keyboardChannels.length,11);assert.equal(f.waiters.length,0);assert.deepEqual(f.errors,[]);
});
test('Actual Native OPLL Worker layout follows future loop OFF and earlier immediate Keyboard ON from distinct owners',{timeout:10000},async t=>{
  installWorkers(t);const f=fixture(t,{future:true});await f.runtime.playSource(`const a=await createSoundChip('ym2413',{id:'layout'});liveLoop('far',async()=>{a.writeRegister(14,0);log('far-off-queued');await beat(100);});keyboard.bind('near',{noteOn(){a.writeRegister(14,32);log('near-on-applied');},noteOff(){},allNotesOff(){}});`,{execution:'worker'});await until(()=>f.logs.includes('far-off-queued')&&f.queue.some(c=>c.message.register===14&&c.message.value===0&&c.frame>0)&&f.runtime.getKeyboardTarget());const far=f.queue.find(c=>c.message.register===14);assert(far);const i=f.synth.chipInspector;assert.notEqual(i.list().find(x=>x.id==='layout').rhythmEnabled,true);f.runtime.getKeyboardTarget().noteOn({id:'near',midi:60});await until(()=>f.logs.includes('near-on-applied')&&i.list().find(x=>x.id==='layout')?.rhythmEnabled===true);const near=f.commands().find(c=>c.type==='extra-ym2413'&&c.message.register===14&&c.message.value===32);assert(near.frame<far.frame);assert.notEqual(near.owner,far.owner);assert.equal((await i.read('layout')).keyboardChannels.length,11);assert(f.waiters.length<=1);f.advance(1000);await until(()=>i.list().find(x=>x.id==='layout')?.rhythmEnabled===false);assert.equal((await i.read('layout')).keyboardChannels.length,9);assert.equal(f.waiters.length,0);assert.deepEqual(f.errors,[]);
});

for(const kind of ['ym2413','ay8910'])test(`Native additional ${kind} cancelled Main clock does not enter the serialized control lane or steal another loop`,async t=>{
  installWorkers(t);const f=fixture(t);await f.runtime.playSource(`const a=await createSoundChip('${kind}',{id:'clock'});liveLoop('a',async()=>{const pending=a.setClock(2100000);stopLoop('a');await pending;a.noteOn(0,'A4');});liveLoop('b',async()=>{await a.setClock(2200000);${kind==='ym2413'?"a.setAttenuation(1,3);a.noteOn(1,'A4');":"a.tone(1,{note:'A4',volume:11});"}log('clock-b-ready');await beat(100);});context.cancel=()=>stopLoop('b');`);await until(()=>f.logs.includes('clock-b-ready'));assert(!f.commands().some(c=>c.type===`extra-${kind}`&&c.message.method==='clock'&&c.message.hz===2100000));assert.equal((await f.synth.chipInspector.read('clock')).channels[1].active,true);f.runtime.context.cancel();await f.synth.flush();assert.equal((await f.synth.chipInspector.read('clock')).channels[1].active,false);assert.deepEqual(f.errors,[]);
});
for(const mode of ['msx','master-system'])test(`Native ${mode} still borrows its primary OPLL and AY endpoints independently of additional creation`,async t=>{
  installWorkers(t);const f=fixture(t,{mode});await f.runtime.playSource(`context.opll=await useSoundChip('ym2413');${mode==='msx'?"context.ay=await useSoundChip('ay8910');context.ay.tone(0,{note:'A4',volume:9});":""}context.opll.noteOn(0,'A4');`);assert.equal(f.synth.extraDevices.size,0);assert(!f.calls.some(c=>c.command.endsWith('_create')));assert.equal(f.runtime.context.opll.id,'ym2413');assert.equal(f.runtime.context.opll.dispose,undefined);if(mode==='msx')assert.equal(f.runtime.context.ay.id,'ay8910');assert.deepEqual(f.errors,[]);
});

test('Additional OPLL and AY share eight-kind sixteen-slot admission and cleanup with no authored Mixer state',async t=>{
  installWorkers(t);const f=fixture(t),create=f.synth.createExtraYm2608.bind(f.synth);f.synth.createExtraYm2608=options=>create({...options,fetcher:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(8192).buffer})});await f.runtime.playSource(`context.api={createSoundChip};`);for(let n=0;n<16;n++)await f.runtime.context.api.createSoundChip(KINDS[n%8],{id:`mixed-${n}`});assert.equal(f.synth.extraDevices.size,16);assert.equal(f.synth.extraYm2413Devices.size,2);assert.equal(f.synth.extraAy8910Devices.size,2);assert.equal(new Set(f.calls.filter(c=>c.command.endsWith('_create')).map(c=>c.args.instance)).size,16);await assert.rejects(f.runtime.context.api.createSoundChip('ym2413'),/at most 16/);assert.deepEqual(f.synth.mixer.exportState(),{version:1,entries:[]});await f.runtime.stopWithFade();assert.equal(f.rack.size,0);assert.equal(f.synth.extraDevices.size,0);assert.equal(f.synth.mixer.reservedIds.size,0);assert.deepEqual(f.errors,[]);
});
