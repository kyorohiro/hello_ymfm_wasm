import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createNativeWorkerApis} from './playground_native_primary.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';
import {createPlaygroundKeyboardRouting} from '../docs/playground/playground_mode_keyboard.js';

const HELD_CLOCK_ERROR='Release the manually held Game Gear voices before changing the clock';
function fixture(){
  const calls=[],commands=[],errors=[];
  const psg={clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,stereo:255,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000};
  const status=()=>({session:1,mode:'game-gear',sampleRate:48000,frame:0,ymClock:0,psgClock:psg.clock,running:true});
  const snapshot=()=>({segapsg:structuredClone(psg),sampleRate:48000,frame:0,revision:commands.length});
  function stop(){psg.attenuations.fill(15);psg.held.length=0;}
  function apply(m){
    if(m.method==='batch'){if(m.action==='on'&&!psg.held.includes(m.channel))psg.held.push(m.channel);for(const c of m.commands)apply(c);if(m.action==='off')psg.held=psg.held.filter(ch=>ch!==m.channel);return;}
    if(m.method==='write'){const v=m.value,r=v&128?v>>4&7:m.psgRegister??psg.latched,ch=r>>1;psg.latched=r;if(r&1){psg.attenuations[ch]=v&15;if((v&15)!==15)psg.lastVolumes[ch]=v&15;}else if(r===6)psg.mode=v&7;else psg.periods[ch]=v&128?(psg.periods[ch]&1008)|(v&15):(psg.periods[ch]&15)|((v&63)<<4);}
    else if(m.method==='stereo')psg.stereo=m.mask;
    else if(m.method==='clock')psg.clock=m.hz;
    else if(m.method==='stop-voices')stop();
    else if(m.method==='key-off')psg.attenuations[m.channel]=15;
    else if(m.method==='reset'){stop();psg.periods.fill(0);psg.lastVolumes.fill(0);psg.latched=psg.mode=0;psg.stereo=255;}
  }
  const invoke=async(command,args)=>{
    calls.push({command,args});
    if(command==='native_genesis_commands'){
      if(psg.held.length&&args.commands.some(c=>c.type==='master-system'&&c.message.method==='clock'))throw new Error(HELD_CLOCK_ERROR);
      for(const c of args.commands){commands.push(c);assert(!['write','psg-write','psg-stereo','reset','ym2608','ym2610b','x68000','msx','opl'].includes(c.type),'Game Gear has no hidden FM/OPLL/other chips');if(c.type==='master-system'){assert.equal(c.message.chip,'segapsg');apply(c.message);}}
    }
    if(command==='native_genesis_stop')stop();
    if(command==='native_genesis_game_gear_status')return snapshot();
    return status();
  };
  return {synth:new NativeGenesisSynth({mode:'game-gear',invoke,now:()=>0,onError:e=>errors.push(e)}),calls,commands,errors,psg,snapshot};
}

test('Native Game Gear Main borrows stereo PSG only and Stop retains routing and periods',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,clearTimeout};const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.gameGearNativeResult;});
  await runtime.playSource(`
    if(await useSoundChip('segapsg')!==psg)throw Error('Game Gear primary was not reused');
    psg.setStereo(0xa5);psg.tone(PSG1,{note:'A4',attenuation:5});psg.tone(PSG3,{period:369,attenuation:7});psg.noise({type:'white',rate:'tone3',attenuation:9});
    await psg.setClock(3000000);await mixer.set(psg.id,{volume:.4,pan:-.2});
    globalThis.gameGearNativeResult={clock:psg.clock,stereoEnabled:psg.stereoEnabled,fmType:typeof fm,opllType:typeof opll};
  `);
  await f.synth.flush();assert.deepEqual(globalThis.gameGearNativeResult,{clock:3000000,stereoEnabled:true,fmType:'undefined',opllType:'undefined'});assert.equal(f.psg.stereo,0xa5);assert.equal(f.psg.periods[2],369);assert.equal(f.psg.mode,7);
  assert.equal(f.synth.fm,null);assert.equal(f.synth.opll,null);assert.equal(f.synth.ym2413,null);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.equal(f.synth.psg,f.synth.segapsg);
  assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),['segapsg']);assert.deepEqual(f.synth.chipInspector.list().map(c=>c.id),['segapsg']);
  await runtime.stopWithFade();assert.equal(f.psg.stereo,0xa5);assert.equal(f.synth.psg._getState().stereo,0xa5);assert.equal(f.psg.periods[2],369);assert.equal(f.psg.mode,7);assert(f.psg.attenuations.every(v=>v===15));assert.deepEqual(f.errors,[]);
});

test('Native Game Gear real Worker port carries stereo, PSG latch targets, clock timing and Stop',async()=>{
  const f=fixture();await f.synth.start();f.commands.length=0;const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);assert(bridge.segapsgPort);assert.equal(bridge.ym2413Port,null);assert.equal(bridge.ay8910Port,null);
    const observed=[],worker=createNativeWorkerApis([{name:'segapsg',globalName:'psg',port:bridge.segapsgPort,stereoEnabled:true,state:f.synth.psg._getState()}],sender,(name,state)=>{observed.push({name,state});f.synth.psg._adoptState(state);});
    worker.apis.psg.setStereo(0x18);worker.apis.psg.write(0x81);worker.apis.psg.write(0x25);worker.apis.psg.setAttenuation(0,6);worker.apis.psg.noise({type:'white',rate:'tone3',attenuation:8});await worker.apis.psg.setClock(3000000);
    assert.equal(f.psg.stereo,0x18);assert.equal(f.psg.periods[0],0x251);assert.equal(f.psg.mode,7);assert.equal(worker.apis.psg.clock,3000000);assert.equal(f.synth.psg.clock,3000000);
    const writes=f.commands.filter(c=>c.type==='master-system'&&['write','stereo','clock'].includes(c.message.method));assert(writes.every(c=>c.frame===12000&&c.performance===clock.session&&c.owner>0));assert(writes.some(c=>c.message.value===0x25&&c.message.psgRegister===0));assert(observed.some(e=>e.name==='psg'&&e.state.stereoEnabled===true&&e.state.stereo===0x18));
    await worker.stop();assert(f.psg.attenuations.every(v=>v===15));assert.equal(f.psg.stereo,0x18);assert.equal(f.psg.periods[0],0x251);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});

test('Native Game Gear Keyboard/editor routes audition PC and Guitar notes on all four voices',async()=>{
  const f=fixture();await f.synth.start();f.synth.psg.setStereo(0xa5);f.synth.psg.noise({type:'white',rate:'tone3',attenuation:7});f.synth.psg.tone(2,{period:369,attenuation:8});await f.synth.flush();
  const routing=createPlaygroundKeyboardRouting({getInspector:()=>f.synth.chipInspector,primaryChips:[{id:'segapsg',kind:'segapsg',label:'Game Gear PSG'}]});
  try{
    assert.deepEqual(routing.getState().chips.map(c=>c.endpointId),['segapsg']);
    for(let ch=0;ch<4;ch++){
      const target=routing.getEditorTarget('segapsg',String(ch));assert(target);await f.synth.chipInspector.invoke('segapsg','setAttenuation',[ch,5]);
      await target.noteOn({id:'pc:KeyZ',midi:48,velocity:100});assert.equal(f.psg.attenuations[ch],5);await target.noteOff({id:'pc:KeyZ',midi:48});assert.equal(f.psg.attenuations[ch],15);
      await target.noteOn({id:'guitar:string-0:fret-7',midi:64,velocity:100});assert.equal(f.psg.attenuations[ch],5);await target.allNotesOff();assert.equal(f.psg.attenuations[ch],15);
      const view=await f.synth.chipInspector.read('segapsg');assert.equal(view.stereo,0xa5);assert.equal(view.stereoEnabled,true);
    }
    assert.equal(f.psg.mode,7);assert.equal(f.psg.stereo,0xa5);await f.synth.chipInspector.invoke('segapsg','resetAll',[]);assert.equal(f.psg.stereo,255);assert.equal(f.synth.psg._getState().stereo,255);assert.deepEqual(f.errors,[]);
  }finally{routing.dispose();await f.synth.close();}
});

test('Native Game Gear Main/Worker held clocks reject without failing playback or changing author state',async()=>{
  const f=fixture();await f.synth.start();await f.synth.nativeGameGear.segapsg.invoke('auditionOn',[0,69,'held']);f.synth.psg.setAttenuation(1,7);
  await assert.rejects(f.synth.psg.setClock(3000000),/held/);assert.equal(f.synth.isReady(),true);assert.equal(f.synth.psg.clock,3579545);assert.equal(f.psg.attenuations[1],7);
  const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);const worker=createNativeWorkerApis([{name:'segapsg',globalName:'psg',port:bridge.segapsgPort,stereoEnabled:true,state:f.synth.psg._getState()}],sender,()=>{});
    await assert.rejects(worker.apis.psg.setClock(3000000),/held/);assert.equal(worker.apis.psg.clock,3579545);assert.equal(f.synth.isReady(),true);
    await f.synth.nativeGameGear.segapsg.invoke('auditionOff',[0,'held']);await worker.apis.psg.setClock(3000000);assert.equal(worker.apis.psg.clock,3000000);assert.equal(f.synth.psg.clock,3000000);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});

for(const scenario of [
  {name:'non-clock',methods:['write'],error:HELD_CLOCK_ERROR},
  {name:'mixed clock/note',methods:['clock','write'],error:HELD_CLOCK_ERROR},
  {name:'unrelated clock device error',methods:['clock'],error:'Native audio device disconnected'},
])test(`Native Game Gear keeps ${scenario.name} rejection fatal`,async t=>{
  const f=fixture();await f.synth.start();t.after(()=>f.synth.close());const invoke=f.synth.invoke;f.synth.invoke=(command,args)=>command==='native_genesis_commands'?Promise.reject(new Error(scenario.error)):invoke(command,args);
  f.synth.enqueueMany(scenario.methods.map(method=>({type:'master-system',frame:0,message:{chip:'segapsg',method,...(method==='clock'?{hz:3000000}:{register:0,value:0x90})}})));
  await assert.rejects(f.synth.flush(),error=>error.message===scenario.error&&error.code!=='GAME_GEAR_CLOCK_HELD');assert.equal(f.synth.state,'error');assert.equal(f.errors.length,1);
});

test('Native Game Gear recovers a Tauri string held-clock error and later accepts a clock',async t=>{
  const f=fixture();await f.synth.start();t.after(()=>f.synth.close());const invoke=f.synth.invoke;let rejected=false;
  f.synth.invoke=(command,args)=>{if(!rejected&&command==='native_genesis_commands'&&args.commands.every(c=>c.type==='master-system'&&c.message.chip==='segapsg'&&c.message.method==='clock')){rejected=true;return Promise.reject(HELD_CLOCK_ERROR);}return invoke(command,args);};
  await assert.rejects(f.synth.psg.setClock(3000000),error=>error.code==='GAME_GEAR_CLOCK_HELD');assert.equal(f.synth.isReady(),true);assert.equal(f.synth.psg.clock,3579545);await f.synth.psg.setClock(3000000);assert.equal(f.synth.psg.clock,3000000);assert.deepEqual(f.errors,[]);
});

test('Native Game Gear applied-clock refusal leaves Main and real Worker author clocks unchanged',async()=>{
  const f=fixture();await f.synth.start();const invoke=f.synth.invoke;let refuse=true,refusedId=null;
  f.synth.invoke=async(command,args)=>{
    if(command==='native_genesis_commands'&&refuse){const clock=args.commands.find(c=>c.type==='master-system'&&c.message.method==='clock');if(clock){const previous=f.psg.clock;const result=await invoke(command,args);f.psg.clock=previous;refusedId=clock.message.id;return result;}}
    if(command==='native_genesis_game_gear_status'&&args.after===refusedId&&refusedId!==null){refuse=false;refusedId=null;throw new Error(HELD_CLOCK_ERROR);}
    return invoke(command,args);
  };
  await assert.rejects(f.synth.psg.setClock(3000000),/held/);assert.equal(f.synth.psg.clock,3579545);assert.equal(f.synth.isReady(),true);refuse=true;
  const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);const worker=createNativeWorkerApis([{name:'segapsg',globalName:'psg',port:bridge.segapsgPort,stereoEnabled:true,state:f.synth.psg._getState()}],sender,()=>{});
    await assert.rejects(worker.apis.psg.setClock(3000000),/held/);assert.equal(worker.apis.psg.clock,3579545);assert.equal(f.synth.psg.clock,3579545);assert.equal(f.synth.isReady(),true);
    await worker.apis.psg.setClock(3000000);assert.equal(worker.apis.psg.clock,3000000);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});
