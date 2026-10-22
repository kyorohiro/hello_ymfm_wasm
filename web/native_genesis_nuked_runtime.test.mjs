import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createWorkerChip} from './playground_worker_chip.js';
import {createNativeWorkerApis} from './playground_native_primary.js';
import {createRf5c164Client} from './playground_rf5c164.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';
import {PWM32XPlayback} from './pwm32x_playback.js';
import {RfInspectorState} from './playground_chip_inspector_state.js';
import {createPlaygroundKeyboardRouting} from '../docs/playground/playground_mode_keyboard.js';

function fixture(mode,{startOverride,commandHook}={}){
  const calls=[],commands=[],errors=[],memory=new Uint8Array(65536),pwm=new PWM32XPlayback({sampleRate:48000});
  const pcm=new RfInspectorState({writeRegister(){},loadMemory(){},reset(){}},{sampleRate:48000});let session=0;
  const status=()=>({session,mode,engine:mode.includes('nuked')?'nuked':'ymfm',frame:0,sampleRate:48000,ymClock:7670454,psgClock:3579545,rf5c164Clock:12500000,pwmClock:23011361,running:true});
  const invoke=async(command,args={})=>{calls.push({command,args});
    if(command==='native_genesis_start'){session++;return {...status(),...startOverride};}
    if(command==='native_genesis_commands'){
      await commandHook?.(args.commands);
      for(const c of args.commands){commands.push(c);
        if(c.type==='rf5c164-write')pcm.write(c.register,c.value);
        else if(c.type==='rf5c164-load-memory'){memory.set(c.data,c.offset);pcm.memoryWrite(c.offset,c.data.length);}
        else if(c.type==='rf5c164-key-on')pcm.mask&=~(1<<c.channel);
        else if(c.type==='rf5c164-key-off')pcm.mask|=1<<c.channel;
        else if(c.type==='pwm'){const m=c.message;if(m.method==='write')pwm.write(m.register,m.value);else if(m.method==='clock')pwm.setClock(m.hz);else if(m.method==='reset')pwm.reset();else if(m.method==='clear-schedule'||m.method==='stop-voices')pwm.clearSchedule();}
      }
    }
    if(command==='native_genesis_rf5c164_status'){const s=pcm.read();return {...s,mask:pcm.mask,selected:pcm.selected,channels:s.channels.map(c=>({...c,configuredStep:pcm.configuredSteps[c.channel]}))};}
    if(command==='native_genesis_pwm_status')return {...pwm.getState(),registers:Array.from({length:5},(_,i)=>pwm.read(i)),lastSchedule:null};
    if(command==='native_genesis_stop'){pcm.mask=255;pwm.clearSchedule();}
    return status();
  };
  return {synth:new NativeGenesisSynth({mode,invoke,now:()=>0,onError:e=>errors.push(e)}),calls,commands,errors,memory,pcm,pwm,status};
}

for(const mode of ['genesis-full-nuked','genesis-nuked'])test(`Native ${mode} selects an explicit Nuked core with correct attached chips`,async t=>{
  const f=fixture(mode);t.after(()=>f.synth.close());assert.equal(f.calls.length,0);assert.equal(f.synth.engine,'nuked');assert.equal(f.synth.capabilities.engine,'nuked');assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  await f.synth.start();assert.deepEqual(f.calls.find(c=>c.command==='native_genesis_start').args,{mode});assert.equal(f.synth.fm.id,'ym2612');assert.equal(f.synth.fm.getState().channels.length,6);assert.equal(f.synth.capabilities.pcm,mode==='genesis-full-nuked');assert.equal(f.synth.capabilities.pwm,mode==='genesis-full-nuked');
  assert.deepEqual(f.synth.chipInspector.list().map(c=>c.id).sort(),mode==='genesis-full-nuked'?['pwm','rf5c164','segapsg','ym2612']:['segapsg','ym2612']);assert.equal((await f.synth.chipInspector.read('ym2612')).engine,'nuked');
});

for(const mode of ['genesis','mega-cd','genesis-full'])test(`Native ${mode} preserves the standard ymfm engine`,async t=>{
  const f=fixture(mode==='genesis-full'?'32x':mode);t.after(()=>f.synth.close());assert.equal(f.synth.engine,'ymfm');await f.synth.start();assert.equal(f.synth.engine,'ymfm');assert.equal(f.synth.nukedMode,false);
});

for(const override of [{engine:'ymfm'},{engine:undefined},{mode:'32x'},{mode:'genesis-nuked'}])test(`Native Nuked rejects a mismatched startup status ${JSON.stringify(override)}`,async()=>{
  const f=fixture('genesis-full-nuked',{startOverride:override});await assert.rejects(f.synth.start(),/incompatible sound engine/);assert.equal(f.synth.state,'error');assert.equal(f.synth.session,null);assert(f.calls.some(c=>c.command==='native_genesis_shutdown'));assert(!f.calls.some(c=>c.command==='native_genesis_commands'));await f.synth.close();
});

test('Native rejects unknown mode construction before opening any device',()=>{
  assert.throws(()=>new NativeGenesisSynth({mode:'unknown-machine',invoke(){throw Error('Unexpected invoke');}}),/Unsupported Native mode/);
});

for(const mode of ['genesis-full-nuked','genesis-nuked'])test(`Native ${mode} Main reuses FM/PSG and optional RF/PWM without Web Audio`,async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,clearTimeout};const f=fixture(mode),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});t.after(async()=>{await runtime.finalize();globalThis.window=previous;});
  const full=mode==='genesis-full-nuked';
  await runtime.playSource(`
    if(await useSoundChip('ym2612')!==fm||await useSoundChip('segapsg')!==psg)throw Error('Genesis primaries were not reused');
    fm.setPreset(CH1,FM_PRESETS['one-op-basic']);psg.tone(PSG1,{note:'C4',attenuation:8});await play('A4',{channel:CH1,duration:0});
    ${full?`const pcm=await useSoundChip('rf5c164');await pcm.loadMemory(new Uint8Array([0x81,0x91,0xa1,0xff]));await pcm.setChannel(0,{start:0,loopStart:0,volume:80,pan:{left:15,right:15},pitch:2048});await pcm.keyOn(0);await pwm.write(0,5);await pwm.write(1,767);await pwm.write(4,384);`:''}
  `);
  await f.synth.flush();assert(f.commands.some(c=>c.type==='write'&&c.register===0x28&&(c.value&0xf0)));assert(f.commands.some(c=>c.type==='psg-write'));
  if(full){assert.equal(f.memory[1],0x91);assert.equal(f.pcm.mask&1,0);assert.equal(f.pwm.read(1),767);}else assert(!f.commands.some(c=>c.type.startsWith('rf5c164')||c.type==='pwm'));
  const patch=f.synth.fm.getState().channels[0];await runtime.stopWithFade();assert.deepEqual(f.synth.fm.getState().channels[0],patch);if(full){assert.equal(f.memory[1],0x91);assert.equal(f.pwm.read(1),767);assert.equal(f.pcm.mask,255);}assert.equal(f.synth.engine,'nuked');assert.equal(f.synth.audioContext,null);assert.deepEqual(f.errors,[]);
});

test('Native 32X Nuked actual Worker ports carry FM/PSG/RF/PWM on one performance clock',async()=>{
  const f=fixture('genesis-full-nuked');await f.synth.start();f.commands.length=0;const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);
    const worker=createWorkerChip({port:sender.port(bridge.chipPort,'chip'),capabilities:f.synth.capabilities,state:f.synth.fm.getState()}),native=createNativeWorkerApis([{name:'pwm',globalName:'pwm',port:bridge.pwmPort,clock:f.synth.pwm.clock}],sender,()=>{}),pcm=createRf5c164Client(sender.port(bridge.pcmPort,'independent'));
    worker.fm.setAlgo(5,7,3);worker.fm.noteOn(5,'A4');worker.psg.tone(2,{note:'E4',attenuation:7});await pcm.loadMemory(new Uint8Array([0x81,0x91,0xff]));await pcm.setChannel(0,{start:0,loopStart:0,volume:80,pan:{left:15,right:15},pitch:2048});await pcm.keyOn(0);await native.apis.pwm.write(0,5);await native.apis.pwm.write(1,767);await native.apis.pwm.write(4,384);await native.apis.pwm.getState();
    for(const type of ['write','psg-write','rf5c164-key-on','pwm'])assert(f.commands.some(c=>c.type===type&&c.performance===clock.session&&c.owner>0),type);
    assert(f.commands.filter(c=>['write','psg-write','rf5c164-key-on'].includes(c.type)).every(c=>c.frame===12000));assert.equal(f.synth.engine,'nuked');assert.equal(f.synth.audioContext,null);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});

test('Native Nuked Keyboard and Operators keep physical FM/PSG routing and stale-release protection',async()=>{
  const f=fixture('genesis-nuked');await f.synth.start();const routing=createPlaygroundKeyboardRouting({getInspector:()=>f.synth.chipInspector,primaryChips:[{id:'ym2612',kind:'ym2612',label:'Nuked YM2612'},{id:'segapsg',kind:'segapsg',label:'Sega PSG'}]});
  try{
    for(const [chip,voice]of [['ym2612','fm:5'],['segapsg','2']]){const target=routing.getEditorTarget(chip,voice);assert(target);await target.noteOn({id:'pc:KeyZ',midi:69,velocity:100});await target.noteOff({id:'pc:KeyZ'});await target.noteOn({id:'guitar:string0:fret7',midi:64,velocity:100});await target.allNotesOff();}
    await f.synth.chipInspector.invoke('ym2612','auditionOn',['fm:0',60,'old']);await f.synth.chipInspector.invoke('ym2612','auditionOn',['fm:0',67,'new']);const before=f.commands.length;await f.synth.chipInspector.invoke('ym2612','auditionOff',['fm:0','old']);assert.equal(f.commands.length,before);await f.synth.chipInspector.invoke('ym2612','auditionOff',['fm:0','new']);assert.equal(f.commands.at(-1).value,0);assert.deepEqual(f.errors,[]);
  }finally{routing.dispose();await f.synth.close();}
});

test('Native Nuked startup cancellation shuts down its delayed selected core',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;}),calls=[];const synth=new NativeGenesisSynth({mode:'genesis-full-nuked',invoke:async(command,args)=>{calls.push({command,args});if(command==='native_genesis_start')return gate;}});const started=synth.start(),rejected=assert.rejects(started,{name:'AbortError'}),closed=synth.close();release({session:9,mode:'genesis-full-nuked',engine:'nuked',sampleRate:48000,frame:0});await rejected;await closed;assert.equal(synth.state,'closed');assert.deepEqual(calls.map(c=>c.command),['native_genesis_start','native_genesis_shutdown']);
});

for(const mode of ['genesis-full-nuked','genesis-nuked'])test(`Native ${mode} fences queued notes at Stop and reports transport failures without a fallback`,async()=>{
  let gate,entered,fail=false;
  const f=fixture(mode,{commandHook:async()=>{entered?.();if(gate)await gate;if(fail)throw Error('Selected Nuked core unavailable');}});await f.synth.start();f.commands.length=0;
  let release;gate=new Promise(resolve=>{release=resolve;});const firstEntered=new Promise(resolve=>{entered=resolve;});
  f.synth.fm.noteOn(0,'A4');const first=f.synth.flush();await firstEntered;
  f.synth.fm.noteOn(1,'C5');const queued=f.synth.flush(),cancelled=assert.rejects(queued,{name:'AbortError'}),stopping=f.synth.stopNativeAudio();release();gate=null;await first;await cancelled;await stopping;
  assert(!f.commands.some(c=>c.type==='write'&&c.register===0x28&&(c.value&0xf0)&&(c.value&7)===1),'A queued previous Run cannot gate a voice after Stop');
  fail=true;f.synth.fm.noteOn(2,'E5');await assert.rejects(f.synth.flush(),/Selected Nuked core unavailable/);await Promise.resolve();assert.equal(f.synth.state,'error');assert.equal(f.errors.length,1);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.equal(f.synth.engine,'nuked');await f.synth.close();
});
