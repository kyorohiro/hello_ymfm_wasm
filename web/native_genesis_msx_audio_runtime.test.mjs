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

const HELD_CLOCK_ERROR='Release the manually held OPL voices before changing the clock';
async function until(predicate){const deadline=Date.now()+1000;while(!predicate()){if(Date.now()>deadline)throw new Error('MSX Audio loop did not start');await new Promise(resolve=>setTimeout(resolve,1));}}
function fixture(){
  const calls=[],commands=[],errors=[];
  const y8950={chip:'y8950',clock:3579545,registers:Array(256).fill(0),held:[],pendingCommands:[],status:0,irq:false,sourceMuteMask:0,sampleRate:48000};
  const ym2413={clock:3579545,registers:Array(64).fill(0),held:[],pendingCommands:[],status:0,irq:false,sourceMuteMask:0,sampleRate:48000};
  const ay8910={clock:1789773,registers:Array(16).fill(0),levels:[9,9,9],gates:[false,false,false],held:[],pendingCommands:[],sourceMuteMask:7,sampleRate:48000};
  const states={y8950,ym2413,ay8910};
  const status=()=>({session:1,mode:'msx-audio',sampleRate:48000,frame:0,ymClock:y8950.clock,psgClock:ay8910.clock,running:true});
  const snapshot=()=>({...structuredClone(states),sampleRate:48000,frame:0,revision:commands.length});
  function off(chip,ch){const state=states[chip];if(chip==='ay8910'){state.registers[8+ch]=0;state.gates[ch]=false;}else if(chip==='ym2413'){if(ch<9)state.registers[0x20+ch]&=239;else state.registers[14]&=~(16>>(ch-9));}else if(ch<9)state.registers[0xb0+ch]&=223;else state.registers[0xbd]&=~(16>>(ch-18));}
  function stop(chip){const state=states[chip];for(let ch=0;ch<(chip==='ay8910'?3:9);ch++)off(chip,ch);if(chip==='ym2413')state.registers[14]&=224;if(chip==='y8950')state.registers[0xbd]&=224;state.held.length=0;}
  function apply(m){const state=states[m.chip];
    if(m.method==='batch'){if(m.action==='on'&&!state.held.includes(m.channel))state.held.push(m.channel);for(const c of m.commands)apply({...c,chip:m.chip});if(m.action==='off')state.held=state.held.filter(ch=>ch!==m.channel);return;}
    if(m.method==='write'){state.registers[m.register]=m.value;if(m.chip==='ay8910'&&m.register>=8&&m.register<=10){state.gates[m.register-8]=!!(m.value&31);if(m.value&31)state.levels[m.register-8]=m.value&31;}}
    else if(m.method==='set-retained-level')state.levels[m.channel]=m.level;
    else if(m.method==='clock')state.clock=m.hz;
    else if(m.method==='key-off')off(m.chip,m.channel);
    else if(m.method==='audition-key-on'){if(m.chip==='y8950')state.registers[0xb0+m.channel]|=32;else if(m.channel<9)state.registers[0x20+m.channel]|=16;else state.registers[14]|=16>>(m.channel-9);}
    else if(m.method==='mix')state.mix={volume:m.volume,pan:m.pan};
    else if(m.method==='reset'){state.registers.fill(0);state.held.length=0;if(m.chip==='ay8910'){state.levels.fill(9);state.gates.fill(false);}}
    else if(m.method==='stop-voices')stop(m.chip);
  }
  const invoke=async(command,args)=>{calls.push({command,args});
    if(command==='native_genesis_commands'){
      if(y8950.held.length&&args.commands.some(c=>c.type==='opl'&&c.message.method==='clock'))throw new Error(HELD_CLOCK_ERROR);
      for(const c of args.commands){commands.push(c);assert(!['write','psg-write','psg-stereo','reset','master-system','x68000','ym2608','ym2610b'].includes(c.type),'MSX Audio must not create unrelated chips');if(c.type==='opl'){assert.equal(c.message.chip,'y8950');apply(c.message);}else if(c.type==='msx'){assert(['ym2413','ay8910'].includes(c.message.chip));apply(c.message);}}
    }
    if(command==='native_genesis_stop')for(const chip of Object.keys(states))stop(chip);
    if(command==='native_genesis_msx_audio_status')return snapshot();
    if(command==='native_genesis_opl_status'){const s=snapshot();return {y8950:s.y8950,frame:s.frame,sampleRate:s.sampleRate,revision:s.revision};}
    if(command==='native_genesis_msx_status'){const s=snapshot();return {ym2413:s.ym2413,ay8910:s.ay8910,frame:s.frame,sampleRate:s.sampleRate,revision:s.revision};}
    return status();
  };
  return {synth:new NativeGenesisSynth({mode:'msx-audio',invoke,now:()=>0,onError:e=>errors.push(e)}),calls,commands,errors,...states,snapshot};
}
function connections(f,bridge){return [
  {name:'y8950',globalName:'opl',port:bridge.y8950Port,state:f.synth.opl._getState()},
  {name:'ym2413',globalName:'opll',port:bridge.ym2413Port,state:f.synth.opll._getState()},
  {name:'ay8910',globalName:'ay',port:bridge.ay8910Port,state:f.synth.ay._getState()},
];}

test('Native MSX Audio Main borrows all three Web globals with independent mixes and retained Stop state',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,clearTimeout};const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.msxAudioNativeResult;});
  await runtime.playSource(`
    if(await useSoundChip('y8950')!==opl||await useSoundChip('ym2413')!==opll||await useSoundChip('ay8910')!==ay)throw Error('Primary was not reused');
    const prepared=await livePrepare('three',({opl,opll,ay})=>({opl,opll,ay}));if(prepared.opl!==opl||prepared.opll!==opll||prepared.ay!==ay)throw Error('Missing prepared primary');
    opl.setPreset(0,OPL_PRESETS.bell);opl.setOperator(0,1,{mul:3,tl:26});opl.noteOn(0,'A4');opl.setRhythm({enabled:true,snare:true,hiHat:true});
    opll.setPreset(0,{userPatch:{feedback:3,operators:[{mul:2,tl:24},{mul:1}]},attenuation:6});opll.noteOn(0,'E4');
    ay.noise(1,{period:13,volume:7,envelope:true});ay.setVolume(2,0);ay.setEnvelope({period:333,shape:10});
    await opl.setClock(4000000);await opll.setClock(4000001);await ay.setClock(2000000);
    await mixer.set(opl.id,{volume:.3,pan:-.2});await mixer.set(opll.id,{volume:.5,pan:.1});await mixer.set(ay.id,{volume:.7,pan:.2});
    globalThis.msxAudioNativeResult={oplId:opl.id,opllId:opll.id,ayId:ay.id,fmType:typeof fm,psgType:typeof psg,adpcmType:typeof opl.loadSample};
  `);
  await f.synth.flush();assert.deepEqual(globalThis.msxAudioNativeResult,{oplId:'y8950',opllId:'ym2413',ayId:'ay8910',fmType:'undefined',psgType:'undefined',adpcmType:'undefined'});
  assert.equal(f.y8950.registers[0x23]&15,3);assert.equal(f.y8950.registers[0x43]&63,26);assert.equal(f.y8950.registers[0xbd]&63,41);assert.equal(f.ym2413.registers[0]&15,2);assert.equal(f.ay8910.registers[6],13);assert.equal(f.ay8910.registers[9],23);
  assert.deepEqual(f.y8950.mix,{volume:.3,pan:-.2});assert.deepEqual(f.ym2413.mix,{volume:.5,pan:.1});assert.deepEqual(f.ay8910.mix,{volume:.7,pan:.2});
  assert.equal(f.synth.opl,f.synth.y8950);assert.equal(f.synth.opll,f.synth.ym2413);assert.equal(f.synth.ay,f.synth.ay8910);assert.equal(f.synth.fm,null);assert.equal(f.synth.psg,null);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),['y8950','ym2413','ay8910']);assert.deepEqual(f.synth.chipInspector.list().map(c=>c.id),['y8950','ym2413','ay8910']);
  await runtime.stopWithFade();assert.equal(f.y8950.registers[0xb0]&32,0);assert.equal(f.y8950.registers[0xbd]&63,32);assert.equal(f.y8950.registers[0x43]&63,26);assert.equal(f.ym2413.registers[0x20]&16,0);assert.equal(f.ym2413.registers[0]&15,2);assert.deepEqual(f.ay8910.registers.slice(8,11),[0,0,0]);assert.deepEqual(f.synth.ay._getState().levels,[9,23,0]);assert.deepEqual([f.synth.opl.clock,f.synth.opll.clock,f.synth.ay.clock],[4000000,4000001,2000000]);
  assert(f.calls.some(c=>c.command==='native_genesis_msx_audio_status'));assert.deepEqual(f.errors,[]);
});

test('Native MSX Audio real Worker ports preserve all three states, performance timing and Stop',async()=>{
  const f=fixture();await f.synth.start();f.commands.length=0;const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);assert(bridge.y8950Port);assert(bridge.ym2413Port);assert(bridge.ay8910Port);assert.equal(bridge.segapsgPort,null);
    const observed=[],worker=createNativeWorkerApis(connections(f,bridge),sender,(name,state)=>{observed.push({name,state});f.synth[name]._adoptState(state);});
    worker.apis.opl.setOperator(8,1,{mul:3,tl:7});worker.apis.opl.noteOn(0,'A4');worker.apis.opl.setRhythm({enabled:true,bassDrum:true});
    worker.apis.opll.setVoice(8,{instrument:7,attenuation:4});worker.apis.opll.noteOn(8,'E4');worker.apis.ay.noise(0,{period:12,volume:7,envelope:true});worker.apis.ay.setEnvelope({period:100,shape:10});worker.apis.ay.setVolume(1,0);
    await worker.apis.opl.setClock(4000000);await worker.apis.opll.setClock(4000001);await worker.apis.ay.setClock(2000000);
    assert.equal(f.y8950.registers[0x35]&15,3);assert.equal(f.y8950.registers[0x55]&63,7);assert(f.y8950.registers[0xb0]&32);assert.equal(f.ym2413.registers[0x38],0x74);assert(f.ym2413.registers[0x28]&16);assert.equal(f.ay8910.registers[6],12);assert.equal(f.ay8910.levels[1],0);
    const writes=f.commands.filter(c=>['msx','opl'].includes(c.type)&&['write','set-retained-level'].includes(c.message.method));assert(writes.length>0);assert(writes.every(c=>c.frame===12000&&c.performance===clock.session&&c.owner>0));assert.deepEqual([...new Set(observed.map(e=>e.name))].sort(),['ay','opl','opll']);
    await worker.stop();assert.equal(f.y8950.registers[0xb0]&32,0);assert.equal(f.y8950.registers[0xbd]&63,32);assert.equal(f.ym2413.registers[0x28]&16,0);assert.deepEqual(f.ay8910.registers.slice(8,11),[0,0,0]);assert.equal(f.y8950.registers[0x55]&63,7);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});

test('Native MSX Audio Keyboard/editor routing independently auditions all three chips',async()=>{
  const f=fixture();await f.synth.start();const routing=createPlaygroundKeyboardRouting({getInspector:()=>f.synth.chipInspector,primaryChips:[{id:'y8950',kind:'y8950',label:'Y8950'},{id:'ym2413',kind:'ym2413',label:'YM2413'},{id:'ay8910',kind:'ay8910',label:'AY'}]});
  try{
    assert.deepEqual(routing.getState().chips.map(c=>c.endpointId),['y8950','ym2413','ay8910']);
    await f.synth.chipInspector.invoke('y8950','setOperator',[0,1,{tl:5}]);await f.synth.chipInspector.invoke('ym2413','setInstrument',[0,3,5]);await f.synth.chipInspector.invoke('ay8910','setVoice',[0,{volume:7,tone:true,noise:false}]);
    const targets=['y8950','ym2413','ay8910'].map(chip=>routing.getEditorTarget(chip,'0'));for(const target of targets){assert(target);await target.noteOn({id:'pc:KeyZ',midi:48,velocity:100});}
    assert(f.y8950.registers[0xb0]&32);assert(f.ym2413.registers[0x20]&16);assert.equal(f.ay8910.registers[8],7);
    await targets[0].noteOff({id:'pc:KeyZ',midi:48});assert.equal(f.y8950.registers[0xb0]&32,0);assert(f.ym2413.registers[0x20]&16);assert.equal(f.ay8910.registers[8],7);
    for(let index=1;index<3;index++)await targets[index].allNotesOff();
    for(const target of targets){await target.noteOn({id:'guitar:string0:fret7',midi:64,velocity:100});await target.allNotesOff();}
    assert.equal(f.y8950.registers[0xb0]&32,0);assert.equal(f.ym2413.registers[0x20]&16,0);assert.equal(f.ay8910.registers[8],0);assert.deepEqual(f.errors,[]);
  }finally{routing.dispose();await f.synth.close();}
});

test('Native MSX Audio Main loop owners release three melodies and only their Y8950 drum bits',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,clearTimeout};const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});t.after(async()=>{await runtime.finalize();globalThis.window=previous;});
  await runtime.playSource(`opl.setRhythm({enabled:true});liveLoop('three',async()=>{opl.noteOn(0,'A4');opll.noteOn(0,'E4');ay.noteOn(0,'C3');await sleep(60);});liveLoop('drums',async()=>{opl.setRhythm({snare:true,hiHat:true});await sleep(60);});`);
  await until(()=>f.synth.opl.getRegisterSnapshot()[0xbd]&8);await f.synth.flush();const before=f.commands.length;
  await runtime.playSource(`opl.setRhythm({bassDrum:true});stopLoop('three');stopLoop('drums');`);await f.synth.flush();
  assert.equal(f.y8950.registers[0xb0]&32,0);assert.equal(f.ym2413.registers[0x20]&16,0);assert.equal(f.ay8910.registers[8],0);assert.equal(f.y8950.registers[0xbd]&63,48);
  const off=f.commands.slice(before).filter(c=>c.message?.method==='key-off');assert(off.some(c=>c.message.chip==='y8950'&&c.message.channel===0));assert(off.some(c=>c.message.chip==='ym2413'&&c.message.channel===0));assert(off.some(c=>c.message.chip==='ay8910'&&c.message.channel===0));assert.deepEqual(off.filter(c=>c.message.chip==='y8950'&&c.message.channel>=18).map(c=>c.message.channel).sort((a,b)=>a-b),[19,22]);assert.deepEqual(f.errors,[]);
});

test('Native MSX Audio Y8950 held clock rejection leaves all chips usable and held AY/OPLL do not block it',async()=>{
  const f=fixture();await f.synth.start();await f.synth.nativeMsxAudio.y8950.invoke('auditionOn',[0,69,'held']);f.synth.opll.setVoice(0,{instrument:4,attenuation:3});f.synth.ay.tone(1,{note:'A4',volume:6});
  await assert.rejects(f.synth.opl.setClock(4000000),/held/);assert.equal(f.synth.isReady(),true);assert.equal(f.synth.opl.clock,3579545);assert.equal(f.ym2413.registers[0x30],0x43);assert.equal(f.ay8910.registers[9],6);
  const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);const worker=createNativeWorkerApis(connections(f,bridge),sender,()=>{});
    await assert.rejects(worker.apis.opl.setClock(4000000),/held/);assert.equal(worker.apis.opl.clock,3579545);assert.equal(f.synth.isReady(),true);
    await f.synth.nativeMsxAudio.y8950.invoke('auditionOff',[0,'held']);await f.synth.nativeMsxAudio.ym2413.invoke('auditionOn',[0,69,'opll']);await f.synth.nativeMsxAudio.ay8910.invoke('auditionOn',[0,69,'ay']);
    await worker.apis.opl.setClock(4000000);assert.equal(worker.apis.opl.clock,4000000);assert.equal(f.synth.opl.clock,4000000);assert.deepEqual(f.ym2413.held,[0]);assert.deepEqual(f.ay8910.held,[0]);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});

for(const scenario of [
  {name:'non-clock',methods:['write'],error:HELD_CLOCK_ERROR},
  {name:'mixed clock/note',methods:['clock','write'],error:HELD_CLOCK_ERROR},
  {name:'unrelated clock error',methods:['clock'],error:'Native audio device disconnected'},
])test(`Native MSX Audio keeps ${scenario.name} rejection fatal`,async t=>{
  const f=fixture();await f.synth.start();t.after(()=>f.synth.close());const invoke=f.synth.invoke;f.synth.invoke=(command,args)=>command==='native_genesis_commands'?Promise.reject(new Error(scenario.error)):invoke(command,args);
  f.synth.enqueueMany(scenario.methods.map(method=>({type:'opl',frame:0,message:{chip:'y8950',method,...(method==='clock'?{hz:4000000}:{register:0xb0,value:32})}})));
  await assert.rejects(f.synth.flush(),error=>error.message===scenario.error&&error.code!=='OPL_CLOCK_HELD');assert.equal(f.synth.state,'error');assert.equal(f.errors.length,1);
});

test('Native MSX Audio recovers an exact Tauri string clock rejection without dropping other chip state',async t=>{
  const f=fixture();await f.synth.start();t.after(()=>f.synth.close());const invoke=f.synth.invoke;let refused=false;f.synth.invoke=(command,args)=>{if(!refused&&command==='native_genesis_commands'&&args.commands.every(c=>c.type==='opl'&&c.message.chip==='y8950'&&c.message.method==='clock')){refused=true;return Promise.reject(HELD_CLOCK_ERROR);}return invoke(command,args);};
  f.synth.opll.setVoice(0,{instrument:4,attenuation:3});f.synth.ay.setVolume(1,7);await assert.rejects(f.synth.opl.setClock(4000000),error=>error.code==='OPL_CLOCK_HELD');assert.equal(f.synth.isReady(),true);assert.equal(f.synth.opl.clock,3579545);assert.equal(f.ym2413.registers[0x30],0x43);assert.equal(f.ay8910.registers[9],7);await f.synth.opl.setClock(4000000);assert.equal(f.synth.opl.clock,4000000);assert.deepEqual(f.errors,[]);
});
