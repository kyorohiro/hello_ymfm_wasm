import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createPlaygroundKeyboardRouting} from '../docs/playground/playground_mode_keyboard.js';

const deferred = () => {let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
const ticks = async () => {for(let i=0;i<20;i++)await Promise.resolve();};
function fixture(options={}) {
  let milliseconds=0,session=0;
  const calls=[],errors=[];
  const status=()=>({session,sampleRate:48000,frame:Math.round(milliseconds*48),ymClock:7670454,psgClock:3579545,running:true});
  const invoke=async(command,args)=>{
    calls.push({command,args});
    if(options.invoke){const result=options.invoke(command,args,status);if(result!==undefined)return await result;}
    if(command==='native_genesis_start'){session++;return status();}
    if(['native_genesis_stop','native_genesis_status'].includes(command))return status();
  };
  const synth=new NativeGenesisSynth({invoke,now:()=>milliseconds,onError:error=>errors.push(error)});
  return {synth,calls,errors,status,advance:ms=>{milliseconds+=ms;},commands:()=>calls.filter(call=>call.command==='native_genesis_commands').flatMap(call=>call.args.commands)};
}

test('native construction opens no device and uses shared YM2612/PSG register APIs without Web Audio',async()=>{
  const f=fixture();assert.deepEqual(f.calls,[]);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  assert.equal(f.synth.clock.state,'suspended');await f.synth.start();
  assert.equal(f.synth.state,'ready');assert.equal(f.synth.clock.sampleRate,48000);assert.equal(f.synth.clock.currentTime,0);
  f.advance(250);assert.equal(f.synth.clock.currentTime,.25);
  f.synth.fm.setPreset(0,{algorithm:7,operators:[{multi:1,tl:20,ar:31,rr:15}]});
  f.synth.fm.noteOn(0,4,1234);f.synth.psg.tone(0,{note:'A4',attenuation:8});await f.synth.flush();
  const commands=f.commands();assert.ok(commands.some(c=>c.type==='write'&&c.register===0x28&&c.value===0xf0));
  assert.ok(commands.some(c=>c.type==='psg-write'&&c.value===0x98));
  assert.ok(commands.every(c=>c.frame===0));
  await f.synth.close();assert.equal(f.calls.at(-1).command,'native_genesis_shutdown');
});

test('preset and later note batches remain ordered across delayed native acknowledgements',async()=>{
  let gate=null;const f=fixture({invoke:(command)=>command==='native_genesis_commands'&&gate?gate.promise:undefined});await f.synth.start();f.calls.length=0;
  gate=deferred();f.synth.fm.setAlgo(0,4,2);const first=f.synth.flush();await ticks();
  f.synth.fm.noteOn(0,4,1000);const second=f.synth.flush();await ticks();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.commands[0].register,0xb0);
  gate.resolve();gate=null;await first;await second;
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].args.commands.at(-1).register,0x28);await f.synth.close();
});
test('read-only OPLL layout observers validate progress identities and never block writes or session Stop',async()=>{
  const gate=deferred(),f=fixture({invoke:command=>command==='native_genesis_extra_ym2413_status'?gate.promise:undefined});await f.synth.start();f.calls.length=0;
  await assert.rejects(f.synth.observeNativeSnapshot('native_genesis_shutdown',{instance:1,afterLayoutRevision:0}),/Unsupported/);
  for(const args of [{instance:1,afterLayoutRevision:-1},{instance:0,afterLayoutRevision:0},{instance:1,afterLayoutRevision:1.5},{instance:1,afterLayoutRevision:0,after:9}])await assert.rejects(f.synth.observeNativeSnapshot('native_genesis_extra_ym2413_status',args),/Invalid Native layout/);
  assert.equal(f.calls.length,0);const pending=f.synth.observeNativeSnapshot('native_genesis_extra_ym2413_status',{instance:1,afterLayoutRevision:0}),cancelled=assert.rejects(pending,{name:'AbortError'});await ticks();assert.equal(f.synth.acceptedRequests,1);
  f.synth.fm.write(0,0x22,8);await f.synth.flush();assert.equal(f.commands().at(-1).register,0x22);await f.synth.close();assert.equal(f.calls.at(-1).command,'native_genesis_shutdown');gate.resolve({ym2413:{layoutRevision:1,layoutPending:false}});await cancelled;assert.equal(f.synth.acceptedRequests,0);assert.deepEqual(f.errors,[]);
});

test('Stop discards pending old writes, fences queued batches, and awaits the native reset acknowledgement',async()=>{
  let gate=null;const f=fixture({invoke:(command)=>command==='native_genesis_commands'&&gate?gate.promise:undefined});await f.synth.start();f.calls.length=0;
  gate=deferred();f.synth.fm.noteOn(0,4,1000);const sent=f.synth.flush();await ticks();
  f.synth.fm.noteOn(1,4,1100);const queued=f.synth.flush();const rejected=assert.rejects(queued,{name:'AbortError'});
  f.synth.fm.noteOn(2,4,1200);const stopped=f.synth.stopNativeAudio();await ticks();
  assert.equal(f.calls.length,1,'native stop waits for the first batch acknowledgement');
  assert.throws(()=>f.synth.fm.noteOn(3,4,1300),{name:'AbortError'});
  gate.resolve();gate=null;await sent;await rejected;await stopped;
  assert.deepEqual(f.calls.map(c=>c.command),['native_genesis_commands','native_genesis_stop']);
  f.advance(100);f.synth.fm.noteOn(0,4,1400);await f.synth.flush();assert.equal(f.synth.clock.currentTime,.1);
  assert.equal(f.calls.at(-1).command,'native_genesis_commands');assert.equal(f.errors.length,0);await f.synth.close();
});

test('scheduled seconds map to device frames and invalid groups never partially send',async()=>{
  const f=fixture();await f.synth.start();f.calls.length=0;
  f.synth.fm.scheduleWrites([{time:.25,port:1,register:0xa4,value:32},{time:.25,port:1,register:0xa0,value:64},{time:.5,type:'psg-write',value:0x9f}]);
  await f.synth.flush();assert.deepEqual(f.commands().map(c=>c.frame),[12000,12000,24000]);
  assert.throws(()=>f.synth.fm.scheduleWrites([{time:1,register:0x22,value:8},{time:NaN,register:0x22,value:0}]),/Schedule time/);
  await f.synth.flush();assert.equal(f.commands().length,3);
  f.synth.fm.write(0,0x2b,128);f.synth.fm.write(0,0x2a,128);await f.synth.flush();
  assert.deepEqual(f.commands().slice(-2).map(command=>command.register),[0x2b,0x2a]);
  await assert.rejects(f.synth.sample.play('a'),/Unknown sample/);assert.throws(()=>f.synth.noise.create({seed:-1}),/seed/);
  await f.synth.close();
});

test('native batch size is bounded and mixer and listening volume keep their separate controls',async()=>{
  const f=fixture();await f.synth.start();f.calls.length=0;
  f.synth.fm.scheduleWrites(Array.from({length:9000},()=>({time:1,register:0x22,value:0})));
  await f.synth.flush();assert.deepEqual(f.calls.map(c=>c.args.commands.length),[4096,4096,808]);
  f.calls.length=0;f.synth.setMasterVolume(2);f.synth.setListeningVolume(.25);
  f.synth.mixer.set('ym2612',{volume:.5,pan:1});await f.synth.flush();
  const mix=f.commands().at(-1);assert.equal(mix.master,.5);assert.equal(mix.fmLeft,0);assert.equal(mix.fmRight,.5);
  assert.equal(f.synth.getMasterVolume(),2);await f.synth.close();assert.equal(f.synth.mixer.list().length,0);
});

test('pending plus serialized and in-flight native commands share one bounded admission count',async()=>{
  let gate=null;const f=fixture({invoke:command=>command==='native_genesis_commands'&&gate?gate.promise:undefined});
  await f.synth.start();f.calls.length=0;gate=deferred();const batches=[];
  const writes=Array.from({length:8192},()=>({time:1,register:0x22,value:0}));
  for(let i=0;i<8;i++){f.synth.fm.scheduleWrites(writes);batches.push(f.synth.flush().catch(error=>error));}
  await ticks();assert.equal(f.calls.length,1);assert.equal(f.synth.acceptedCommands,65536);
  assert.throws(()=>f.synth.fm.write(0,0x22,0),/queue is full/);
  const stopped=f.synth.stopNativeAudio();gate.resolve();gate=null;
  await Promise.all(batches);await stopped;assert.equal(f.synth.acceptedCommands,0);
  assert.equal(f.calls.filter(call=>call.command==='native_genesis_commands').length,1,'the cancelled remainder cannot drain after Stop');
  f.synth.fm.noteOn(0,4,1000);await f.synth.flush();assert.equal(f.synth.acceptedCommands,0);await f.synth.close();
});

test('failed startup is truthful and cancelled initialization shuts down the returned native session',async()=>{
  const f=fixture({invoke:command=>command==='native_genesis_start'?Promise.reject(new Error('No device')):undefined});
  await assert.rejects(f.synth.start(),/No device/);assert.equal(f.synth.state,'error');assert.equal(f.synth.session,null);
  const gate=deferred(),g=fixture({invoke:command=>command==='native_genesis_start'?gate.promise:undefined});
  const started=g.synth.start(),rejected=assert.rejects(started,{name:'AbortError'});const closed=g.synth.close();
  gate.resolve({session:42,sampleRate:48000,frame:0});await rejected;await closed;
  assert.deepEqual(g.calls.map(c=>c.command),['native_genesis_start','native_genesis_shutdown']);
  assert.equal(g.synth.state,'closed');await g.synth.close();assert.equal(g.calls.length,2);
});

test('a failed command stops the native stream and reports the error instead of falling back silently',async()=>{
  let fail=false;const f=fixture({invoke:command=>command==='native_genesis_commands'&&fail?Promise.reject(new Error('Queue full')):undefined});
  await f.synth.start();fail=true;f.synth.fm.noteOn(0,4,1000);await assert.rejects(f.synth.flush(),/Queue full/);await ticks();
  assert.equal(f.synth.state,'error');assert.equal(f.errors.length,1);assert.ok(f.calls.some(c=>c.command==='native_genesis_stop'));
  await f.synth.close();assert.equal(f.calls.at(-1).command,'native_genesis_shutdown');
});

test('status reanchor cannot move the running clock backwards and startup delay does not become audio lead',async()=>{
  const gate=deferred(),f=fixture({invoke:command=>command==='native_genesis_start'?gate.promise:undefined});const started=f.synth.start();
  f.advance(1000);gate.resolve({session:1,sampleRate:48000,frame:0});await started;assert.equal(f.synth.clock.currentTime,0);
  f.advance(100);assert.equal(f.synth.clock.currentTime,.1);await f.synth.resume();assert.ok(f.synth.clock.currentTime>=.1);await f.synth.close();
});

test('native inspector exposes real primary endpoints for the shared Keyboard without a port or hidden audio graph',async()=>{
  const f=fixture(),updates=[],inspector=f.synth.chipInspector;
  const unsubscribe=inspector.subscribe(entries=>updates.push(entries));assert.deepEqual(inspector.list(),[]);
  const routing=createPlaygroundKeyboardRouting({getInspector:()=>inspector,primaryChips:[
    {id:'ym2612',kind:'ym2612',label:'YM2612'},{id:'segapsg',kind:'segapsg',label:'Sega PSG'},
  ]});
  await f.synth.start();assert.deepEqual(inspector.list().map(entry=>entry.id),['ym2612','segapsg']);
  assert.equal(f.synth.node,null);assert.equal(updates.at(-1).length,2);const connection=inspector.getConnectionToken('ym2612');
  assert.equal((await inspector.read('ym2612')).keyboardChannels.length,6);
  await assert.rejects(inspector.read('segapsg'),/Applied PSG voice snapshots/);
  f.calls.length=0;routing.selectChannel('fm:5');const fmTarget=routing.getTarget();
  await fmTarget.noteOn({id:'key',midi:69,velocity:100});
  assert.ok(f.commands().some(command=>command.type==='write'&&command.register===0x28&&command.value===0xf6));
  await fmTarget.noteOff({id:'key'});assert.equal(f.commands().at(-1).value,6);
  routing.selectChip('chip:segapsg');routing.selectChannel('2');f.calls.length=0;
  await routing.getTarget().noteOn({id:'psg',midi:69});assert.ok(f.commands().some(command=>command.type==='psg-write'&&command.value===0xd6));
  await routing.getTarget().noteOff({id:'psg'});assert.equal(f.commands().at(-1).value,0xdf);
  await inspector.invoke('segapsg','auditionOn',[3,60,'noise']);assert.equal(f.commands().at(-1).value,0xf6);
  await inspector.invoke('segapsg','auditionOff',[3,'noise']);assert.equal(f.commands().at(-1).value,0xff);
  await f.synth.close();assert.deepEqual(inspector.list(),[]);assert.deepEqual(updates.at(-1),[]);
  await f.synth.start();assert.notEqual(inspector.getConnectionToken('ym2612'),connection);
  routing.dispose();unsubscribe();await f.synth.close();
});

test('native inspector audition identities fence stale FM and PSG key releases',async()=>{
  const f=fixture();await f.synth.start();const inspector=f.synth.chipInspector;
  for(const [id,channel]of [['ym2612','fm:0'],['segapsg',0]]) {
    await inspector.invoke(id,'auditionOn',[channel,60,'old']);await inspector.invoke(id,'auditionOn',[channel,67,'new']);
    f.calls.length=0;await inspector.invoke(id,'auditionOff',[channel,'old']);assert.deepEqual(f.commands(),[]);
    await inspector.invoke(id,'auditionOff',[channel,'new']);assert.equal(f.commands().length,1);
  }
  f.calls.length=0;await assert.rejects(inspector.invoke('ym2612','auditionOn',['fm:6',60,'bad']),/channel/);
  await assert.rejects(inspector.invoke('segapsg','auditionOn',[0,128,'bad']),/MIDI note/);assert.deepEqual(f.commands(),[]);
  await f.synth.close();
});

test('real Playground Main APIs run on the explicit native clock, borrow primary PSG, and reject unsupported paths',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,addEventListener(){},removeEventListener(){}};
  const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.nativeRuntimeResult;});
  await runtime.playSource(`
    fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
    globalThis.nativeRuntimeResult = {clock:fm.clock, psg:await useSoundChip('segapsg') === psg};
    psg.tone(PSG1,{note:'A4',attenuation:10});
    await play('E3',{channel:CH1,duration:0});
  `);
  assert.deepEqual(globalThis.nativeRuntimeResult,{clock:7670454,psg:true});
  assert.ok(f.commands().some(c=>c.type==='write'&&c.register===0x28&&c.value===0xf0));
  assert.ok(f.commands().some(c=>c.type==='psg-write'));
  await assert.rejects(runtime.playSource('await useSoundChip("dx7");'),/Only additional Sega PSG/);
  await runtime.playSource('fx.setChain([fx.gain({gain:0.5})]);');
  assert.ok(f.calls.some(call=>call.command==='native_genesis_fx'&&call.args.message.op==='chain'));
  assert.equal(f.synth.capabilities.worker,true);assert.equal(f.synth.capabilities.dynamicSoundChips,false);assert.equal(f.synth.capabilities.noise,true);
  await runtime.stopWithFade();assert.equal(f.calls.at(-1).command,'native_genesis_stop');
});

test('runtime stopWithFade waits for native Stop before finalize drops the session',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,addEventListener(){},removeEventListener(){}};
  const gate=deferred();let hold=false;
  const f=fixture({invoke:(command,args,status)=>command==='native_genesis_stop'&&hold?gate.promise.then(status):undefined});
  const runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(()=>{globalThis.window=previous;});await runtime.initialize();hold=true;
  let stopped=false;const stopping=runtime.stopWithFade().then(()=>{stopped=true;});await ticks();assert.equal(stopped,false);
  gate.resolve();await stopping;hold=false;await runtime.finalize();assert.equal(f.calls.at(-1).command,'native_genesis_shutdown');
});

test('repeated Native Main Runs retire FX slots and old parameter controls at Stop',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,addEventListener(){},removeEventListener(){}};
  const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.nativeFxUnit;});
  for(let run=0;run<10;run++) {
    await runtime.playSource('globalThis.nativeFxUnit=fx.gain({gain:0.5});fx.setChain([globalThis.nativeFxUnit]);');
    const old=globalThis.nativeFxUnit;await runtime.stopWithFade();
    assert.throws(()=>old.gain.set(.75),/disposed/);
  }
  const creates=f.calls.filter(call=>call.command==='native_genesis_fx'&&call.args.message.op==='create');
  assert.equal(creates.length,10);assert.ok(creates.every(call=>call.args.message.unit.slot===0));
  assert.equal(f.errors.length,0);
});

test('Native Main reevaluation disposes replaced FX units and retains a prepared chain',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,addEventListener(){},removeEventListener(){}};
  const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.nativePreparedFx;});
  for(let run=0;run<10;run++)await runtime.playSource('fx.setChain([fx.gain({gain:0.5})]);');
  assert.equal(f.synth.getFXChain().length,1);
  const source="const prepared=await livePrepare('fx',()=>fx.gain({gain:0.25}));globalThis.nativePreparedFx=prepared;fx.setChain([prepared]);";
  await runtime.playSource(source);const prepared=globalThis.nativePreparedFx;
  await runtime.playSource(source);assert.equal(globalThis.nativePreparedFx,prepared);
  assert.equal(f.synth.getFXChain()[0],prepared);assert.equal(f.errors.length,0);
});

test('Main native noise commands coalesce with FM writes and retain the public controls',async t=>{
  const f=fixture();await f.synth.start();t.after(()=>f.synth.close());f.calls.length=0;
  const voice=f.synth.noise.create({type:'brown',seed:0xffffffff,gain:.2,release:.3});
  voice.filter.set('lowpass',1000,.7);voice.gain.rampTo(.5,.1);f.synth.fm.write(0,0x22,0);
  await f.synth.flush();assert.equal(f.calls.length,1);
  const noise=f.commands().filter(command=>command.type==='noise');assert.ok(noise.length>5);
  assert.ok(noise.every(command=>command.frame===0&&command.message.namespace===0));
  assert.equal(noise[0].message.type,2);assert.equal(noise[0].message.seed,0xffffffff);
  assert.equal(voice.gain.get(),.5);assert.equal(voice.release.get(),.3);assert.equal(f.synth.audioContext,null);
  await f.synth.stopNativeAudio();assert.throws(()=>voice.start(),/disposed/);
});

test('Worker native noise has trusted namespaces, sample-clock timing and no collision with Main voices',async t=>{
  const f=fixture();await f.synth.start();t.after(()=>f.synth.close());f.calls.length=0;
  f.synth.noise.create({seed:1});await f.synth.flush();
  const namespace=f.synth.allocateNoiseNamespace(),next=f.synth.allocateNoiseNamespace();
  const message={op:'noise',action:'create',namespace:999,slot:0,token:1,type:1,seed:2};
  await f.synth.dispatchNativeFxCommand(message,{noiseNamespace:namespace,performance:3,owner:4,time:.5});
  await f.synth.dispatchNativeFxCommand({...message,seed:3},{noiseNamespace:next,performance:3,owner:5});
  const creates=f.commands().filter(command=>command.type==='noise'&&command.message.action==='create');
  assert.deepEqual(creates.map(command=>command.message.namespace),[0,namespace,next]);
  assert.deepEqual([creates[1].frame,creates[1].performance,creates[1].owner],[24000,3,4]);assert.equal(creates[2].frame,0);
  await assert.rejects(f.synth.dispatchNativeFxCommand(message,{noiseNamespace:99}),/namespace/);
});

test('native liveFx Main and Worker use ordered IPC, portable contexts and source-frame ownership',async()=>{
  const f=fixture();await f.synth.start();f.calls.length=0;
  f.synth.fm.noteOn(0,4,1000);
  const fx=f.synth.createFXApi();
  fx.liveFx('gain',{context:{gain:.5,buffer:new Float32Array([.1,.2])},process(input,output,state,context){output[0].set(input[0]);}});
  await f.synth.serial;
  const calls=f.calls.filter(call=>['native_genesis_commands','native_genesis_live_fx'].includes(call.command));
  assert.deepEqual(calls.map(call=>call.command),['native_genesis_commands','native_genesis_live_fx']);
  assert.equal(calls[1].args.message.context,undefined);assert(calls[1].args.message.contextGraph);
  await f.synth.dispatchNativeFxCommand({op:'live-fx',action:'context',name:'gain',context:{gain:.25}}, {time:.75,performance:5,owner:3});
  const update=f.calls.findLast(call=>call.command==='native_genesis_live_fx');
  assert.equal(update.args.frame,36000);assert.equal(update.args.performance,5);assert.equal(update.args.owner,3);
  assert.equal(f.synth.audioContext,null);assert.equal(f.synth.audio,null);
  await f.synth.close();
});

test('Native Main liveLoop cancellation retires only its noise and prepared voices remain reusable',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,addEventListener(){},removeEventListener(){}};
  const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.nativeLoopNoise;delete globalThis.nativePreparedNoise;});
  await runtime.playSource(`liveLoop('owned-noise',async()=>{globalThis.nativeLoopNoise=noise.create({seed:1,release:.2});await sleep(60);});`);
  await ticks();assert.ok(globalThis.nativeLoopNoise);await f.synth.flush();f.calls.length=0;
  await runtime.playSource(`stopLoop('owned-noise');`);await f.synth.flush();
  const retire=f.commands().find(command=>command.type==='noise'&&command.message.action==='retire');assert.ok(retire);
  assert.throws(()=>globalThis.nativeLoopNoise.start(),/disposed/);
  await runtime.playSource(`
    globalThis.nativePreparedNoise=await livePrepare('noise',()=>noise.create({seed:2,autoStart:false}));
    liveLoop('prepared-noise',async()=>{globalThis.nativePreparedNoise.start();await sleep(60);});
  `);await ticks();await f.synth.flush();f.calls.length=0;
  await runtime.playSource(`stopLoop('prepared-noise');`);await f.synth.flush();
  assert.ok(f.commands().some(command=>command.type==='noise'&&command.message.action==='stop'));
  assert.ok(!f.commands().some(command=>command.type==='noise'&&command.message.action==='retire'));
  await runtime.playSource(`globalThis.nativePreparedNoise.start();control(globalThis.nativePreparedNoise,{gain:.1,pan:-.25,cutoff:800,q:.8,slide:.2});`);
  await f.synth.flush();assert.equal(globalThis.nativePreparedNoise.gain.get(),.1);
  assert.ok(f.commands().some(command=>command.type==='noise'&&command.message.action==='parameter'&&command.message.seconds===.2));
});

test('more than 32 Main Stop and Run cycles reuse noise slots and old handles cannot mute the next Run',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,addEventListener(){},removeEventListener(){}};
  const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});let old;
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.nativeRepeatedNoise;});
  for(let run=0;run<35;run++) {
    await runtime.playSource(`globalThis.nativeRepeatedNoise=noise.create({seed:${run}});`);await f.synth.flush();
    if(old){const before=f.commands().length;assert.throws(()=>old.stop(),/disposed/);old.dispose();assert.equal(f.commands().length,before);}
    old=globalThis.nativeRepeatedNoise;await runtime.stopWithFade();
  }
  const creates=f.commands().filter(command=>command.type==='noise'&&command.message.action==='create');
  assert.equal(creates.length,35);assert.ok(creates.every(command=>command.message.slot===0));assert.equal(f.errors.length,0);
});


test('aggregate additional-chip budget rejection preserves the engine across all kinds and mixed primary batches',async()=>{
  const kinds=['extra-psg','extra-ym2612','extra-ym2203','extra-ym2608','extra-ym2610','extra-ym2151','extra-ym2413','extra-ay8910'];
  for(const types of [...kinds.map(kind=>[kind]),[...kinds,'write']]){
    for(const asString of [false,true]){
      let reject=false;
      const text='Additional Native sound-chip memory budget exceeded (67108864 bytes)';
      const f=fixture({invoke:command=>command==='native_genesis_commands'&&reject?Promise.reject(asString?text:new Error(text)):undefined});
      await f.synth.start();f.calls.length=0;reject=true;
      f.synth.enqueueMany(types.map((type,index)=>type==='write'?{type,frame:0,port:0,register:0x22,value:0}:{type,frame:0,instance:index+1,message:{method:'barrier'}}));
      await assert.rejects(f.synth.flush(),{code:'EXTRA_CHIP_MEMORY_LIMIT',message:text});await ticks();
      assert.equal(f.synth.state,'ready');assert.equal(f.errors.length,0);assert.equal(f.synth.acceptedCommands,0);
      assert(!f.calls.some(c=>c.command==='native_genesis_stop'));
      reject=false;f.synth.fm.noteOn(0,4,1000);await f.synth.flush();
      assert.equal(f.commands().at(-1).register,0x28);await f.synth.close();
    }
  }
});


test('automatic register flushing reports additional-chip memory rejection once without shutting down',async()=>{
  let reject=false;
  const f=fixture({invoke:command=>command==='native_genesis_commands'&&reject?Promise.reject('Additional Native sound-chip memory budget exceeded (67108864 bytes)'):undefined});
  await f.synth.start();f.calls.length=0;reject=true;
  f.synth.enqueue({type:'extra-ym2203',frame:0,instance:1,message:{method:'write',port:0,register:8,value:7}});
  await ticks();assert.equal(f.synth.state,'ready');assert.equal(f.errors.length,1);assert.equal(f.errors[0].code,'EXTRA_CHIP_MEMORY_LIMIT');
  assert(!f.calls.some(c=>c.command==='native_genesis_stop'));
  reject=false;f.synth.psg.off(0);await f.synth.flush();await f.synth.close();
});
