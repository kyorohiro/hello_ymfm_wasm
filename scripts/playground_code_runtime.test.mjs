// No AudioContext or device is created. The shared runtime is exercised against
// an explicit audio clock, deterministic deadline timers and fake chip ports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,readdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createPlaygroundCodeRuntime,CODE_SOUND_CHIPS} from '../tetorica_src/runtime/playground_code_runtime.js';
import {createNativeFXController} from '../tetorica_src/runtime/native_fx.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turns=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
function fixture(options={}) {
  let time=0,id=0;const timers=new Map(),writes=[],logs=[],states=[],requests=[],effects=new Map();
  const fm={clock:7670454,noteOn:(...args)=>writes.push(['on',...args]),noteOff:channel=>writes.push(['off',channel]),
    setPreset:(...args)=>writes.push(['preset',...args]),getState:()=>({channels:6})};
  const endpoints=new Map(CODE_SOUND_CHIPS.map(name=>[name,name==='ym2612'?fm:{write:(...args)=>writes.push([name,...args])}]));
  const fx={liveFx(name,options){effects.set(name,options);return {name,dispose:()=>effects.delete(name)};},removeLiveFx:name=>effects.delete(name)};
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>time,useSoundChip:async name=>{requests.push(name);return endpoints.get(name);},
    getFm:()=>fm,fx,stopSoundChips:async()=>{writes.push(['stop']);effects.clear();},onLog:line=>logs.push(line),onState:state=>states.push(state),
    setTimer:(fn,ms)=>{const handle=++id;timers.set(handle,{fn,at:time+ms/1000});return handle;},clearTimer:handle=>timers.delete(handle),createTaskChannel:()=>null,
    realm:{},...options});
  async function advance(seconds) {
    time+=seconds;
    for(let n=0;n<200;n++) {
      await turns();const next=[...timers].sort(([,a],[,b])=>a.at-b.at).find(([,timer])=>timer.at<=time);
      if(!next)return;timers.delete(next[0]);next[1].fn();
    }
    throw Error('Unbounded fake deadline dispatch');
  }
  return {runtime,fm,writes,logs,states,requests,effects,endpoints,timers,advance};
}

test('Run starts a fresh context, Apply retains prepared values and chip handles, Stop invalidates them',async()=>{
  const f=fixture();
  const source=`context.count=(context.count??0)+1;context.fm=await useSoundChip('ym2612');
    context.ready=await livePrepare('once',()=>({value:context.count}));`;
  await f.runtime.run(source);const first=f.runtime.getContext(),client=first.fm;
  assert.equal(first.count,1);assert.equal(first.ready.value,1);
  await f.runtime.apply(source+`context.fm.setPreset(0,FM_PRESETS.sine);`);
  assert.equal(f.runtime.getContext(),first);assert.equal(first.count,2);assert.equal(first.ready.value,1);
  assert.deepEqual(f.requests,['ym2612']);assert.equal(f.writes.filter(([op])=>op==='preset').length,1);
  await f.runtime.run(source);assert.notEqual(f.runtime.getContext(),first);assert.equal(f.runtime.getContext().count,1);
  assert.throws(()=>client.noteOn(0,4,644),{name:'AbortError'});
  const fresh=f.runtime.getContext().fm;await f.runtime.stop();assert.deepEqual(f.runtime.getContext(),{});
  assert.throws(()=>fresh.noteOn(0,4,644),{name:'AbortError'});assert.equal(f.runtime.getState().running,false);
});

test('four public chip IDs share one provider request per Run; invalid IDs never reach the provider',async()=>{
  const f=fixture();await f.runtime.run(`
    context.ids=[];
    for(const name of ['ym2612','segapsg','rf5c164','pwm']) {
      const one=await useSoundChip(name),two=await useSoundChip(name);context.ids.push(one===two);
    }`);
  assert.deepEqual(f.runtime.getContext().ids,[true,true,true,true]);assert.deepEqual(f.requests,CODE_SOUND_CHIPS);
  await assert.rejects(f.runtime.apply(`await useSoundChip('ps1')`),/Unsupported Code sound chip/);
  assert.equal(f.requests.length,4);assert.equal(f.runtime.getState().state,'error');await f.runtime.stop();
});

test('a SID-only host snapshots its configured chip IDs and never acquires an unsupported provider',async()=>{
  const supported=['sid'],requests=[],sid={noteOn(){},noteOff(){},setNote:()=>123};
  const f=fixture({supportedSoundChips:supported,getFm:()=>null,useSoundChip:async name=>{requests.push(name);return sid;}});
  supported.push('ym2612');
  try {
    await f.runtime.run(`context.one=await useSoundChip('sid');context.two=await pg.useSoundChip('sid');
      context.same=context.one===context.two;context.step=context.one.setNote(CH1,'C4');`);
    assert.equal(f.runtime.getContext().same,true);assert.equal(f.runtime.getContext().step,123);assert.deepEqual(requests,['sid']);
    await assert.rejects(f.runtime.apply(`await useSoundChip('ym2612');`),/Unsupported Code sound chip: ym2612/);
    assert.deepEqual(requests,['sid']);assert.deepEqual(CODE_SOUND_CHIPS,['ym2612','segapsg','rf5c164','pwm']);
  } finally {await f.runtime.stop();}
  for(const supportedSoundChips of [null,'sid',[],new Array(1),[undefined],['sid','sid'],['SID'],[' sid'],['sid',''],[{},'sid'],[42]]) {
    assert.throws(()=>fixture({supportedSoundChips}),/unique supported sound chip IDs/);
  }
});

test('SID RPC notes retain loop ownership across Apply and a retired finally cannot mute its replacement',async()=>{
  const writes=[],sid={async noteOn(channel,note){writes.push(['on',channel,note]);},async noteOff(channel){writes.push(['off',channel]);}};
  const f=fixture({supportedSoundChips:['sid'],getFm:()=>null,useSoundChip:async()=>sid});
  try {
    await f.runtime.run(`const sid=await useSoundChip('sid');context.sid=sid;
      liveLoop('held',async()=>{await sid.noteOn(CH1,'C4');try{await sleep(60);}finally{await sid.noteOff(CH1);}});`);
    await turns();assert.deepEqual(writes,[['on',0,'C4']]);
    await f.runtime.apply(`const sid=await useSoundChip('sid');await sid.noteOn(CH1,'D4');stopLoop('held');`);
    await f.advance(0);assert.deepEqual(writes,[['on',0,'C4'],['on',0,'D4']]);
    assert.deepEqual(f.runtime.getState().loopNames,[]);
    const saved=f.runtime.getContext().sid;await f.runtime.stop();
    assert.deepEqual(writes,[['on',0,'C4'],['on',0,'D4'],['off',0]]);
    assert.throws(()=>saved.noteOn(0,'E4'),{name:'AbortError'});
  } finally {await f.runtime.stop();}
});

test('asynchronous SID note releases cannot reject unobserved or delay physical Stop',async()=>{
  const pending=deferred(),releases=[];
  const sid={noteOn(){},noteOff(channel){releases.push(channel);return pending.promise;}};
  const f=fixture({supportedSoundChips:['sid'],getFm:()=>null,useSoundChip:async()=>sid});
  await f.runtime.run(`const sid=await useSoundChip('sid');await sid.noteOn(CH1,'A4');`);
  await f.runtime.stop();assert.deepEqual(releases,[0]);assert.equal(f.writes.at(-1)[0],'stop','a pending release never holds physical Stop');
  pending.reject(new DOMException('SID Code session cancelled','AbortError'));
  await turns();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.logs,[]);
});

test('stopLoop observes a rejected SID release and retains later physical cleanup',async()=>{
  const writes=[],sid={noteOn:ch=>writes.push(ch),noteOff:()=>Promise.reject(Error('SID endpoint unavailable'))};
  const f=fixture({supportedSoundChips:['sid'],getFm:()=>null,useSoundChip:async()=>sid});
  try {
    await f.runtime.run(`const sid=await useSoundChip('sid');liveLoop('held',async()=>{await sid.noteOn(CH2,'C4');await sleep(60);});`);
    await turns();assert.deepEqual(writes,[1]);await f.runtime.apply(`stopLoop('held');`);await turns();
    assert(f.logs.some(line=>line.includes('SID endpoint unavailable')));await f.runtime.stop();assert.equal(f.writes.at(-1)[0],'stop');
  } finally {await f.runtime.stop();}
});

test('existing music helpers, Files bridge and entry paths are exposed without a second implementation',async()=>{
  const prepared=[],reads=[];
  const f=fixture({prepareSource:(source,options)=>{prepared.push(options);return `{${source}}`;},
    readFile:async(path,options,entry)=>{reads.push({path,options,entry});return 'hello';}});
  await f.runtime.run(`context.text=await file('./a.txt',{type:'text'});context.notes=scale('C4','majorPentatonic');
    context.chord=chord('C4','minor');context.sequence=[cycle([1,2]),cycle([1,2]),cycle([1,2])];console.log('ready',context.text);`,{path:'/code/demo.js'});
  assert.deepEqual(prepared,[{path:'/code/demo.js'}]);assert.deepEqual(reads,[{path:'./a.txt',options:{type:'text'},entry:{path:'/code/demo.js'}}]);
  const context=f.runtime.getContext();assert.equal(context.text,'hello');assert.deepEqual(context.notes,['C4','D4','E4','G4','A4']);
  assert.deepEqual(context.chord,['C4','D#4','G4']);assert.deepEqual(context.sequence,[1,2,1]);assert(f.logs.includes('ready hello'));await f.runtime.stop();
});

test('named loops use the shared beat clock, change on Apply boundaries and release owned notes on removal',async()=>{
  const f=fixture();
  await f.runtime.run(`const lead=await useSoundChip('ym2612');context.hits=[];setBpm(120);liveLoop('lead',async()=>{
    context.hits.push('A');lead.noteOn(CH1,'C4');await sleep(.25);lead.noteOff(CH1);await beat(.5);
  });`);await turns();assert.deepEqual(f.runtime.getContext().hits,['A']);assert(f.writes.some(([op])=>op==='on'));
  await f.runtime.apply(`const lead=await useSoundChip('ym2612');liveLoop('lead',async()=>{context.hits.push('B');lead.noteOn(CH1,'C4');await beat(1);});`);
  assert.deepEqual(f.runtime.getContext().hits,['A']);await f.advance(.25);await f.advance(.25);
  assert.deepEqual(f.runtime.getContext().hits,['A','B']);const before=f.writes.length;
  await f.runtime.apply(`context.removed=true;`);await f.advance(0);
  assert(f.writes.slice(before).some(([op,ch])=>op==='off'&&ch===0));assert.deepEqual(f.runtime.getState().loopNames,[]);
  const count=f.writes.length;await f.advance(5);assert.equal(f.writes.length,count);await f.runtime.stop();
});

test('Synth Code requires an explicit chip and exposes no implicit play helper',async()=>{
  const f=fixture();await f.runtime.run(`
    context.barePlay=typeof play;context.pgHasPlay='play' in pg;
    context.prepareHasPlay=await livePrepare('scope',api=>'play' in api);
    const lead=await useSoundChip('ym2612');lead.noteOn(CH1,'C4');lead.noteOff(CH1);
  `);
  assert.equal(f.runtime.getContext().barePlay,'undefined');assert.equal(f.runtime.getContext().pgHasPlay,false);
  assert.equal(f.runtime.getContext().prepareHasPlay,false);
  assert(f.writes.some(command=>command[0]==='on'&&command[1]===0&&command[2]==='C4'));
  assert(f.writes.some(command=>command[0]==='off'&&command[1]===0));await f.runtime.stop();
});

test('tempo changes retime beat waits and tween cancellation never forces its final callback',async()=>{
  const f=fixture();await f.runtime.run(`context.positions=[];liveLoop('motion',async()=>{
    await tween({beats:1},p=>context.positions.push(p));await beat(1);
  });`);await turns();assert.deepEqual(f.runtime.getContext().positions,[0]);
  await f.advance(.1);await f.runtime.apply(`setBpm(60);liveLoop('motion',async()=>{await beat(1);});`);
  await f.advance(.1);const values=[...f.runtime.getContext().positions];assert(values.length>1);assert(values.at(-1)<1);
  const context=f.runtime.getContext();await f.runtime.stop();await f.advance(2);assert.deepEqual(context.positions,values);assert(!context.positions.includes(1));assert.equal(f.runtime.getState().bpm,60);
});

test('failed fresh Run stops its notes; failed Apply cancels new handles while the previous loop remains live',async()=>{
  let saved;const f=fixture({onLog:()=>{if(f.runtime.getContext().client)saved=f.runtime.getContext().client;}});
  await assert.rejects(f.runtime.run(`context.client=await useSoundChip('ym2612');log('saved');fm.noteOn(0,4,644);throw Error('bad run');`),/bad run/);
  assert.equal(f.runtime.getState().running,false);assert.deepEqual(f.runtime.getContext(),{});assert.equal(f.writes.at(-1)[0],'stop');
  assert.throws(()=>saved.noteOn(0,4,644),{name:'AbortError'});
  await f.runtime.run(`context.hits=0;liveLoop('safe',async()=>{context.hits++;await beat(.5);});`);await turns();
  const context=f.runtime.getContext();assert.equal(context.hits,1);
  await assert.rejects(f.runtime.apply(`context.client=await useSoundChip('ym2612');log('saved');fm.noteOn(1,4,644);throw Error('bad apply');`),/bad apply/);
  assert.equal(f.runtime.getState().running,true);assert.deepEqual(f.runtime.getState().loopNames,['safe']);
  assert.deepEqual(f.writes.at(-1),['off',1]);assert.throws(()=>saved.noteOn(1,4,644),{name:'AbortError'});
  await f.advance(.25);assert.equal(context.hits,2);await f.runtime.stop();await f.advance(0);
  await assert.rejects(f.runtime.run(`fm.noteOn(0,4,644);throw new DOMException('provider abort','AbortError');`),/provider abort/);
  assert.equal(f.runtime.getState().state,'error');assert.equal(f.runtime.getState().running,false);assert.equal(f.writes.at(-1)[0],'stop');
});

test('stopping a pending Run prevents user code and a superseded chip lookup cannot erase the new cache',async()=>{
  const first=deferred();let count=0;
  const f=fixture({ensureReady:()=>++count===1?first.promise:Promise.resolve()});
  const old=f.runtime.run(`context.started=true;fm.noteOn(0,4,644);`);await turns();
  await f.runtime.stop();first.resolve();await assert.rejects(old,{name:'AbortError'});assert(!f.writes.some(([op])=>op==='on'));
  await f.runtime.run(`context.started=true;`);assert.equal(f.runtime.getContext().started,true);await f.runtime.stop();

  const pending=deferred(),endpoint={write(){}};let lookups=0;
  const g=fixture({useSoundChip:()=>++lookups===1?pending.promise:Promise.resolve(endpoint)});
  const loading=g.runtime.run(`context.chip=await useSoundChip('pwm');`);await turns();
  await g.runtime.stop();await assert.rejects(loading,{name:'AbortError'});
  await g.runtime.run(`context.chip=await useSoundChip('pwm');`);pending.resolve(endpoint);await turns();
  await g.runtime.apply(`await useSoundChip('pwm');`);assert.equal(lookups,2);await g.runtime.stop();
});

test('FX definitions are retained by livePrepare across Apply, removed when absent, and cleared on Stop',async()=>{
  const f=fixture();await f.runtime.run(`await livePrepare('fx',()=>{liveFx('drive',{context:{gain:2},process(i,o){}});return {ready:true};});`);
  assert(f.effects.has('drive'));await f.runtime.apply(`await livePrepare('fx',()=>({ready:false}));`);assert(f.effects.has('drive'));
  await f.runtime.apply(`context.noFx=true;`);assert(!f.effects.has('drive'));
  await f.runtime.apply(`liveFx('new',{context:{gain:1},process(i,o){}});`);assert(f.effects.has('new'));
  await f.runtime.stop();assert.equal(f.effects.size,0);
});

test('plain context data, stored process functions and prepared native FX units retain real API identities',async()=>{
  const commands=[],receivedContexts=[],chains=[];
  const native=createNativeFXController(command=>commands.push(command));
  const fx=new Proxy(native,{get(target,key){
    if(!['liveFx','updateContext','setChain'].includes(key))return target[key];
    return (...args)=>{if(key==='setChain')chains.push(args[0]);else receivedContexts.push(key==='liveFx'?args[1].context:args[1]);return target[key](...args);};
  }});
  const f=fixture({fx,stopSoundChips:async()=>{native.clear({dispose:true});}});
  function gainProcess(input,output,state,params){output[0][0]=input[0][0]*params.gain;}
  f.fm.getProcess=()=>({process:gainProcess});
  const source=`context.params??={gain:.5};context.saved??=fm.getProcess();context.process??=context.saved.process;
    context.options??={context:context.params,process:context.process};context.options.self=context.options;
    context.unit=await livePrepare('filter',()=>fx.filter({cutoff:1200}));
    context.branch=fx.branch(context.unit);context.chainInput=[context.branch];fx.setChain(context.chainInput);liveFx('gain',context.options);
    context.update=fx.updateContext;`;
  await f.runtime.run(source);
  const context=f.runtime.getContext(),unit=context.unit,update=context.update;
  assert.deepEqual(structuredClone(context.params),{gain:.5});assert.equal(receivedContexts.at(-1),context.params);
  assert.equal(context.options.context,context.params);assert.equal(context.options.process,context.process);
  assert.equal(context.options.self,context.options,'argument unwrapping does not mutate cyclic options');
  const registration=commands.find(command=>command.op==='live-fx'&&command.action==='register');
  assert.equal(registration.source,gainProcess.toString(),'the original user function is serialized, not a guard wrapper');
  assert.deepEqual(registration.context,{gain:.5});
  assert.equal(context.chainInput[0],context.branch,'argument unwrapping leaves the caller’s chain intact');
  assert.equal(native.getChain()[0].children[0].type,'filter');
  assert.equal(native.getChain()[0].owner,native);assert.equal(native.getChain()[0].children[0].owner,native);
  const optionsObject=context.options;await f.runtime.apply(source+`context.unit.cutoff.set(900);fx.updateContext('gain',context.params);`);
  assert.equal(f.runtime.getContext(),context);assert.equal(context.options,optionsObject);assert.equal(receivedContexts.at(-1),context.params);
  assert.equal(commands.filter(command=>command.op==='create'&&command.unit.type==='filter').length,1,'livePrepare retains the same native unit');
  assert(commands.some(command=>command.op==='parameter'&&command.value===900));
  await f.runtime.stop();assert.throws(()=>unit.cutoff.set(700),{name:'AbortError'});
  assert.throws(()=>update('gain',{gain:1}),{name:'AbortError'});
  context.params.gain=3;assert.deepEqual(f.runtime.getContext(),{},'an old raw context is detached when stopped');
  await f.runtime.run(`context.fresh=true;`);f.runtime.getContext().oldUnit=unit;
  const beforeStaleArgument=chains.length;
  await assert.rejects(f.runtime.apply(`fx.setChain([context.oldUnit]);`),{name:'AbortError'});
  assert.equal(chains.length,beforeStaleArgument,'a stale capability is rejected before it is unwrapped into a new call');
  await f.runtime.stop();
});

test('Stop restores execution guards even when a file request remains pending',async()=>{
  const waiting=deferred(),fetch=()=>{};const realm={fetch};
  const f=fixture({realm,readFile:()=>waiting.promise});const running=f.runtime.run(`await file('wait');fm.noteOn(0,4,644);`);await turns();
  assert.notEqual(realm.fetch,fetch);await f.runtime.stop();await assert.rejects(running,{name:'AbortError'});await turns();
  assert.equal(realm.fetch,fetch);waiting.resolve('late');await turns();assert(!f.writes.some(([op])=>op==='on'));
});

test('Stop aborts user work immediately but waits for the host fade before notes, cleanups and effects retire',async()=>{
  const fade=deferred();let fading=false;
  const f=fixture({beforeStopSoundChips:()=>fading?fade.promise:undefined});
  await f.runtime.run(`const lead=await useSoundChip('ym2612');context.lead=lead;context.retired=[];
    liveFx('gain',{process(i,o){}});
    await livePrepare('resource',()=>({input:{},output:{},dispose(){context.retired.push('dispose');}}));
    liveLoop('held',async()=>{lead.noteOn(CH1,'C4');await new Promise(()=>{});});
    liveCleanup(['held'],async()=>{context.retired.push('cleanup');lead.noteOff(CH1);await new Promise(()=>{});});`);
  await turns();const context=f.runtime.getContext(),before=f.writes.length;fading=true;
  const stopping=f.runtime.stop();
  assert.equal(f.runtime.getState().running,false);assert.equal(f.runtime.getState().stopping,true);assert.equal(f.runtime.getState().busy,true);
  assert.throws(()=>context.lead.noteOn(0,'D4'),{name:'AbortError'});
  await turns();assert.deepEqual(f.writes.slice(before),[]);assert.deepEqual(context.retired,[]);assert(f.effects.has('gain'));
  fade.resolve();await stopping;
  assert.deepEqual(context.retired,['cleanup','dispose']);assert(f.writes.slice(before).some(([op])=>op==='off'));
  assert.equal(f.writes.at(-1)[0],'stop');assert.equal(f.effects.size,0);assert.equal(f.runtime.getState().stopping,false);
  assert.equal(f.runtime.getState().busy,false);assert.equal(f.states.at(-1).stopping,false);
  const retiredWrites=f.writes.length;await f.advance(10);assert.equal(f.writes.length,retiredWrites);
});

test('a pending file promise releases execution guards during the fade and cannot revive a stopped client',async()=>{
  const fade=deferred(),file=deferred(),fetch=()=>{},realm={fetch};let fading=false;
  const f=fixture({realm,beforeStopSoundChips:()=>fading?fade.promise:undefined,readFile:()=>file.promise});
  const running=f.runtime.run(`context.lead=await useSoundChip('ym2612');await file('wait');context.lead.noteOn(0,'C4');`);
  const aborted=assert.rejects(running,{name:'AbortError'});await turns();assert.notEqual(realm.fetch,fetch);
  const old=f.runtime.getContext().lead;fading=true;const stopping=f.runtime.stop();await turns();await aborted;
  assert.equal(realm.fetch,fetch);assert.equal(f.runtime.getState().stopping,true);assert.throws(()=>old.noteOn(0,'C4'),{name:'AbortError'});
  file.resolve('late');await turns();assert(!f.writes.some(([op])=>op==='on'));
  fade.resolve();await stopping;assert.equal(f.runtime.getState().stopping,false);
});

test('rapid Stop then Run keeps the next provider and note behind both serialized fade fences',async()=>{
  const gates=[deferred(),deferred()],trace=[];let fading=false,nextFade=0;
  const f=fixture({ensureReady:async()=>{trace.push(['ready']);},
    beforeStopSoundChips:()=>{if(!fading)return;trace.push(['fade',nextFade]);return gates[nextFade++].promise;},
    stopSoundChips:async()=>{trace.push(['physical-stop']);}});
  f.fm.noteOn=(...args)=>trace.push(['on',...args]);f.fm.noteOff=(...args)=>trace.push(['off',...args]);
  await f.runtime.run(`context.lead=await useSoundChip('ym2612');context.lead.noteOn(0,'C4');`);
  const old=f.runtime.getContext().lead;trace.length=0;fading=true;
  const stop=f.runtime.stop(),run=f.runtime.run(`fm.noteOn(1,'D4');context.fresh=true;`);await turns();
  assert.deepEqual(trace,[['fade',0]]);assert.equal(f.runtime.getState().stopping,true);assert.throws(()=>old.noteOn(0,'E4'),{name:'AbortError'});
  gates[0].resolve();await turns();assert.deepEqual(trace,[['fade',0],['off',0],['physical-stop'],['fade',1]]);
  assert.equal(f.runtime.getState().stopping,true);gates[1].resolve();await Promise.all([stop,run]);
  assert.deepEqual(trace,[['fade',0],['off',0],['physical-stop'],['fade',1],['physical-stop'],['ready'],['on',1,'D4']]);
  assert.equal(f.runtime.getState().stopping,false);assert.equal(f.runtime.getContext().fresh,true);
  fading=false;await f.runtime.stop();
});

test('failed Run retirement also waits for the fade; a failed fade still reaches physical Stop',async()=>{
  const fade=deferred();let phases=0;
  const f=fixture({beforeStopSoundChips:()=>++phases===2?fade.promise:undefined});
  const running=f.runtime.run(`fm.noteOn(0,'C4');throw Error('failed after note');`),failed=assert.rejects(running,/failed after note/);
  await turns();assert(f.writes.some(([op])=>op==='on'));assert(!f.writes.some(([op])=>op==='off'));
  assert.equal(f.runtime.getState().running,false);assert.equal(f.runtime.getState().stopping,true);
  fade.resolve();await failed;assert(f.writes.some(([op])=>op==='off'));assert.equal(f.writes.at(-1)[0],'stop');
  assert.equal(f.runtime.getState().stopping,false);
  let rejectFade=false;const g=fixture({beforeStopSoundChips:()=>{if(rejectFade)throw Error('fade endpoint closed');}});
  await g.runtime.run(`fm.noteOn(0,'C4');`);rejectFade=true;const before=g.writes.length;await g.runtime.stop();
  assert(g.logs.some(line=>line.includes('fade endpoint closed')));assert.deepEqual(g.writes.slice(before),[['off',0],['stop']]);
  assert.equal(g.runtime.getState().stopping,false);
});

test('throwing prepared disposals and FX removal never bypass physical Stop or poison the next Run',async()=>{
  const removed=[];let physicalStops=0;
  const f=fixture({fx:{liveFx(){},removeLiveFx(name){removed.push(name);throw Error('FX endpoint closed');}},
    stopSoundChips:async()=>{physicalStops++;}});
  await f.runtime.run(`fm.noteOn(0,4,644);liveFx('drive',{process(i,o){}});
    context.resource=await livePrepare('resource',()=>({input:{},output:{},dispose(){throw Error('user dispose failed');}}));`);
  const before=physicalStops;await f.runtime.stop();
  assert.equal(physicalStops,before+1);assert.equal(f.runtime.getState().running,false);assert.deepEqual(f.runtime.getContext(),{});
  assert(f.logs.some(line=>line.includes('user dispose failed')));assert(f.logs.some(line=>line.includes('FX endpoint closed')));
  await f.runtime.run(`context.resource=await livePrepare('resource',()=>({fresh:true}));`);
  assert.equal(f.runtime.getContext().resource.fresh,true);assert.deepEqual(removed,['drive']);
  await f.runtime.stop();
  const stoppedBeforeError=physicalStops;
  await assert.rejects(f.runtime.run(`fm.noteOn(0,4,644);liveFx('broken',{process(i,o){}});throw Error('failed source');`),/failed source/);
  assert(physicalStops>=stoppedBeforeError+2,'fresh start cleanup and failed evaluation both reach physical Stop');
  assert.equal(f.runtime.getState().running,false);assert.deepEqual(f.runtime.getContext(),{});
});

test('runtime source and served mirror are byte-identical and do not pull the all-chip host',async()=>{
  const source=await readFile(new URL('../tetorica_src/runtime/playground_code_runtime.js',import.meta.url),'utf8');
  assert.equal(source,await readFile(new URL('../docs/js/playground_code_runtime.js',import.meta.url),'utf8'));
  assert(!/from\s+['"]\.\/playground_runtime\.js/.test(source));
});

test('published declaration keeps required host callbacks and the optional task channel, and type-checks standalone',async()=>{
  const work=await mkdtemp(join(tmpdir(),'tetorica-code-runtime-types-'));
  const compiler=fileURLToPath(new URL('../node_modules/typescript/bin/tsc',import.meta.url));
  const source=fileURLToPath(new URL('../tetorica_src/runtime/playground_code_runtime.js',import.meta.url));
  try {
    execFileSync(process.execPath,[compiler,'--allowJs','--declaration','--emitDeclarationOnly','--skipLibCheck',
      '--module','ESNext','--target','ES2022','--outDir',work,source],{stdio:'pipe'});
    const emitted=(await readdir(work,{recursive:true})).find(path=>path.endsWith('playground_code_runtime.d.ts'));
    assert(emitted,'the host declaration was emitted');
    const declaration=join(work,emitted),text=await readFile(declaration,'utf8');
    for(const name of ['ensureReady','now','useSoundChip','createTaskChannel'])assert(text.includes(name));
    const fixture=join(dirname(declaration),'runtime-options.test.mts');
    await writeFile(fixture,`import {createPlaygroundCodeRuntime,type PlaygroundCodeRuntimeOptions} from './playground_code_runtime.js';
const options:PlaygroundCodeRuntimeOptions={
  ensureReady:async()=>{},now:()=>0,useSoundChip:async name=>({name}),
  createTaskChannel:()=>null,
  onState:state=>{const running:boolean=state.running;const stopping:boolean=state.stopping;void running;void stopping;},
  setTimer:(callback,delay)=>setTimeout(callback,delay),clearTimer:handle=>clearTimeout(handle),
};
createPlaygroundCodeRuntime(options);
createPlaygroundCodeRuntime({...options,createTaskChannel:()=>new MessageChannel()});
const sidOptions:PlaygroundCodeRuntimeOptions<'sid'>={
  ensureReady:async()=>{},now:()=>0,supportedSoundChips:['sid'],useSoundChip:async(name:'sid')=>({name}),
};
createPlaygroundCodeRuntime(sidOptions);
createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>0,supportedSoundChips:['sid'],useSoundChip:async(name:'sid')=>({name})});
// @ts-expect-error the declared SID host cannot expose a different named chip
const wrongSidOptions:PlaygroundCodeRuntimeOptions<'sid'>={...sidOptions,supportedSoundChips:['ym2612']};
// @ts-expect-error the provider callback must handle each selected host chip
const wrongProvider:PlaygroundCodeRuntimeOptions<'sid'>={...sidOptions,useSoundChip:async(name:'ym2612')=>({name})};
// @ts-expect-error the audio preparation callback is required
createPlaygroundCodeRuntime({now:()=>0,useSoundChip:async()=>({})});
// @ts-expect-error the injected clock must return seconds as a number
createPlaygroundCodeRuntime({...options,now:()=>''});
// @ts-expect-error a task channel factory must return a channel or null
createPlaygroundCodeRuntime({...options,createTaskChannel:()=>0});
`);
    execFileSync(process.execPath,[compiler,'--noEmit','--strict','--skipLibCheck','false',
      '--module','ESNext','--target','ES2022',fixture],{stdio:'pipe'});
  } finally {await rm(work,{recursive:true,force:true});}
});
