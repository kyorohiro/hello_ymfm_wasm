import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createWorkerChip} from './playground_worker_chip.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';
import {createPlaygroundKeyboardRouting} from '../docs/playground/playground_mode_keyboard.js';

const HELD_CLOCK_ERROR='Release the manually held YM2203 voices before changing the clock';
async function until(predicate){const deadline=Date.now()+1000;while(!predicate()){if(Date.now()>deadline)throw new Error('YM2203 task did not start');await new Promise(resolve=>setTimeout(resolve,1));}}
function fixture(){
  const calls=[],commands=[],errors=[],held=new Map(),registers=[Array(256).fill(0)],keyMasks=[0,0,0],ssgLevels=[0,0,0],ssgGates=[false,false,false];let clock=4000000,prescaler=6;
  const status=()=>({session:1,mode:'pc98-26',sampleRate:48000,frame:0,ymClock:clock,ym2203Clock:clock,psgClock:0,running:true});
  const snapshot=()=>({...status(),clock,registers:structuredClone(registers),keyMasks:[...keyMasks],ssgLevels:[...ssgLevels],ssgGates:[...ssgGates],prescaler,status:0,irq:false,sourceMuteMask:0,channelMuteMask:0,held:[...held.keys()],pendingCommands:[],revision:commands.length});
  function off(ch){if(ch<3)keyMasks[ch]=0;else{registers[0][8+ch-3]=0;ssgGates[ch-3]=false;}}
  function apply(m){
    if(m.method==='batch'){if(m.action==='off'&&held.get(m.channel)!==m.voice)return;if(m.action==='on')held.set(m.channel,m.voice);for(const c of m.commands)apply(c);if(m.action==='off')held.delete(m.channel);return;}
    if(m.method==='write'){registers[0][m.register]=m.value;if(m.register===0x28&&(m.value&3)<3)keyMasks[m.value&3]=m.value>>4;if(m.register>=8&&m.register<=10){ssgGates[m.register-8]=!!(m.value&31);if(m.value&31)ssgLevels[m.register-8]=m.value&31;}if(m.register>=0x2d&&m.register<=0x2f)prescaler=[6,3,2][m.register-0x2d];}
    else if(m.method==='set-retained-level')ssgLevels[m.channel]=m.level;
    else if(m.method==='key-off')off(m.channel);
    else if(m.method==='clock')clock=m.hz;
    else if(m.method==='reset'){registers[0].fill(0);keyMasks.fill(0);ssgLevels.fill(0);ssgGates.fill(false);held.clear();prescaler=6;}
    else if(m.method==='stop-voices'){for(let ch=0;ch<6;ch++)off(ch);held.clear();}
  }
  const invoke=async(command,args)=>{calls.push({command,args});
    if(command==='native_genesis_commands'){
      if(held.size&&args.commands.some(c=>c.type==='ym2203'&&c.message.method==='clock'))throw new Error(HELD_CLOCK_ERROR);
      for(const c of args.commands){commands.push(c);assert(!['write','psg-write','psg-stereo','reset','ym2608','ym2610b','master-system','msx','opl','x68000'].includes(c.type),'YM2203 must not create hidden sound chips');if(c.type==='ym2203')apply(c.message);}
    }
    if(command==='native_genesis_stop'){for(let ch=0;ch<6;ch++)off(ch);held.clear();}
    if(command==='native_genesis_ym2203_status')return snapshot();
    return status();
  };
  return {synth:new NativeGenesisSynth({mode:'pc98-26',invoke,now:()=>performance.now(),onError:e=>errors.push(e)}),calls,commands,errors,held,registers,keyMasks,ssgLevels,ssgGates,snapshot};
}

test('Native PC-98 YM2203 Main shares FM/SSG/play with the three-channel clock and preserves Stop settings',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,clearTimeout};const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.ym2203NativeResult;});
  await runtime.playSource(`
    if(await useSoundChip('ym2203')!==fm||fm.ssg!==ssg)throw Error('YM2203 primary was not shared');
    fm.setPreset(CH1,FM_PRESETS['one-op-basic']);await play('A4',{channel:CH1,beats:0.01});
    fm.setPreset(CH3,FM_PRESETS['one-op-basic']);fm.setAlgo(CH3,7,3);fm.setChannel3SpecialMode(true);for(let op=0;op<4;op++)fm.setChannel3SpecialFrequency(op,3+op%2,700+op*80);fm.keyOn(CH3);
    ssg.tone(0,{frequency:440,volume:7});ssg.noise(1,{period:13,volume:9,envelope:true});ssg.setEnvelope({period:333,shape:10});ssg.setVolume(2,0);ssg.keyOff(0);ssg.keyOn(0);
    await fm.setClock(3000000);await mixer.set(fm.id,{volume:.6,pan:.1});
    globalThis.ym2203NativeResult={clock:fm.clock,ssgClock:ssg.clock,psgNull:psg===null,rhythmType:typeof rhythm,adpcmType:typeof adpcm};
  `);
  await f.synth.flush();assert.deepEqual(globalThis.ym2203NativeResult,{clock:3000000,ssgClock:1500000,psgNull:true,rhythmType:'undefined',adpcmType:'undefined'});
  assert.equal(f.synth.capabilities.fmChannels,3);assert.equal(f.synth.capabilities.dac,false);assert.equal(f.synth.psg,null);assert.equal(f.synth.pcm,null);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),['ym2203']);assert.equal(f.registers[0][0xa9],700&255);assert.equal(f.registers[0][0x27]&64,64);assert.equal(f.registers[0][6],13);assert.equal(f.registers[0][9],16);assert.deepEqual(f.ssgLevels,[7,16,0]);
  assert(f.commands.some(c=>c.type==='ym2203'&&c.message.register===0x28&&(c.message.value&0xf0)));await runtime.stopWithFade();assert.deepEqual(f.keyMasks,[0,0,0]);assert.deepEqual(f.ssgGates,[false,false,false]);assert.equal(f.registers[0][6],13);assert.deepEqual(f.registers[0].slice(11,14),[77,1,10]);assert.deepEqual(f.synth.fm.ssg._getState().levels,[7,16,0]);assert.equal(f.synth.fm.clock,3000000);assert.deepEqual(f.errors,[]);
});

test('Native YM2203 real Worker preserves SSG retained zero metadata, CH3 special, owner timing and observer no-echo',async()=>{
  const f=fixture();await f.synth.start();f.commands.length=0;const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);
    const observed=[],worker=createWorkerChip({port:sender.port(bridge.chipPort,'chip'),capabilities:f.synth.capabilities,state:f.synth.fm._getState(),observe:event=>{observed.push(event);const core=f.synth.fm,transport=core.transport;core.transport={write(){},reset(){}};try{if(event.method==='ssgState')core.ssg._adoptState(event.args[0]);else if(event.method==='setClock')core._adoptClock(event.args[0]);else core[event.method]?.(...event.args);}finally{core.transport=transport;}}});
    worker.fm.setAlgo(2,7,3);worker.fm.setChannel3SpecialMode(true);worker.fm.setChannel3SpecialFrequency(1,4,777);worker.fm.noteOn(2,'A4');worker.ssg.setVolume(0,7);worker.ssg.keyOff(0);worker.ssg.keyOn(0);worker.ssg.setVolume(1,0);worker.ssg.setVolume(2,9);worker.fm.write(0,10,0);worker.ssg.noise(1,{period:13,volume:9,envelope:true});worker.ssg.setEnvelope({period:333,shape:10});await worker.fm.setClock(3000000);
    assert.equal(worker.fm.clock,3000000);assert.equal(worker.raw.ssg.clock,1500000);assert.equal(f.synth.fm.clock,3000000);assert.deepEqual(f.ssgLevels,[7,16,0]);assert.equal(f.registers[0][8],7);assert.equal(f.registers[0][10],0);assert.equal(f.registers[0][0xaa],777&255);assert.equal(f.registers[0][0x27]&64,64);assert.equal(f.keyMasks[2],15);
    const writes=f.commands.filter(c=>c.type==='ym2203'&&['write','set-retained-level'].includes(c.message.method));assert(writes.length>0);assert(writes.every(c=>c.frame===12000&&c.performance===clock.session&&c.owner>0),'observer copies must not echo unowned writes');assert(writes.some(c=>c.message.method==='set-retained-level'&&c.message.channel===2&&c.message.level===0));assert(observed.some(e=>e.method==='ssgState'));worker.stop();await until(()=>f.keyMasks.every(v=>v===0)&&f.ssgGates.every(v=>!v));await f.synth.flush();assert.deepEqual(f.ssgLevels,[7,16,0]);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});

test('Native YM2203 Keyboard/editor routing plays all six FM and SSG voices without changing silent SSG retention',async()=>{
  const f=fixture();await f.synth.start();const routing=createPlaygroundKeyboardRouting({getInspector:()=>f.synth.chipInspector,primaryChips:[{id:'ym2203',kind:'ym2203',label:'YM2203'}]});
  try{
    const chip=routing.getState().chips[0];assert.equal(chip.channels.length,7);
    for(const voice of ['fm:0','fm:1','fm:2','ssg:0','ssg:1','ssg:2']){
      const target=routing.getEditorTarget('ym2203',voice);assert(target);await target.noteOn({id:'pc:KeyZ',midi:48,velocity:100});assert.equal((await f.synth.chipInspector.read('ym2203')).held.includes(voice),true);await target.noteOff({id:'pc:KeyZ',midi:48});await target.noteOn({id:'guitar:string0:fret7',midi:64,velocity:100});await target.allNotesOff();
    }
    assert.deepEqual(f.keyMasks,[0,0,0]);assert.deepEqual(f.ssgLevels,[0,0,0]);assert.deepEqual(f.ssgGates,[false,false,false]);assert.deepEqual(f.errors,[]);
  }finally{routing.dispose();await f.synth.close();}
});

test('Native YM2203 Main SSG loop cancellation preserves a replacement voice and releases only its owned channels',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,clearTimeout};const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});t.after(async()=>{await runtime.finalize();globalThis.window=previous;});
  await runtime.playSource(`ssg.setVolume(0,7);ssg.setVolume(1,9);liveLoop('old',async()=>{ssg.noteOn(0,'A4');await sleep(60);});liveLoop('second',async()=>{fm.ssg.noteOn(1,'E4');await sleep(60);});`);
  await until(()=>f.synth.fm.ssg.registers[8]===7&&f.synth.fm.ssg.registers[9]===9);await f.synth.flush();const before=f.commands.length;
  await runtime.playSource(`ssg.noteOn(0,'C5');stopLoop('old');stopLoop('second');`);await f.synth.flush();assert.equal(f.registers[0][8],7);assert.equal(f.registers[0][9],0);assert(!f.commands.slice(before).some(c=>c.type==='ym2203'&&c.message.method==='write'&&c.message.register===8&&c.message.value===0));assert(f.commands.slice(before).some(c=>c.type==='ym2203'&&c.message.register===9&&c.message.value===0));assert.deepEqual(f.errors,[]);
});

test('Native YM2203 Main raw FM SSG writes retain explicit zero after Stop',async t=>{
  const previous=globalThis.window;globalThis.window={setTimeout,clearTimeout};const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});t.after(async()=>{await runtime.finalize();globalThis.window=previous;});
  await runtime.playSource(`ssg.setVolume(0,7);ssg.keyOff(0);ssg.keyOn(0);fm.write(0,8,0);ssg.keyOn(0);`);await f.synth.flush();assert.equal(f.registers[0][8],0);assert.equal(f.ssgLevels[0],0);await runtime.stopWithFade();assert.equal(f.synth.fm.ssg._getState().levels[0],0);assert.deepEqual(f.errors,[]);
});

test('Native YM2203 Main/Worker clock rejection while a six-voice lease is held remains recoverable',async()=>{
  const f=fixture();await f.synth.start();await f.synth.nativeYm2203.invoke('auditionOn',['ssg:0',69,'held']);f.synth.fm.ssg.setVolume(1,7);await assert.rejects(f.synth.fm.setClock(3000000),/held/);assert.equal(f.synth.isReady(),true);assert.equal(f.synth.fm.clock,4000000);
  const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);const worker=createWorkerChip({port:sender.port(bridge.chipPort,'chip'),capabilities:f.synth.capabilities,state:f.synth.fm._getState()});await assert.rejects(worker.fm.setClock(3000000),/held/);assert.equal(worker.fm.clock,4000000);assert.equal(f.synth.isReady(),true);await f.synth.nativeYm2203.invoke('auditionOff',['ssg:0','held']);await worker.fm.setClock(3000000);assert.equal(worker.fm.clock,3000000);assert.equal(f.synth.fm.clock,3000000);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});

for(const scenario of [
  {name:'non-clock',methods:['write'],error:HELD_CLOCK_ERROR},
  {name:'mixed clock/note',methods:['clock','write'],error:HELD_CLOCK_ERROR},
  {name:'unrelated clock error',methods:['clock'],error:'Native audio device disconnected'},
])test(`Native YM2203 keeps ${scenario.name} rejection fatal`,async t=>{
  const f=fixture();await f.synth.start();t.after(()=>f.synth.close());const invoke=f.synth.invoke;f.synth.invoke=(command,args)=>command==='native_genesis_commands'?Promise.reject(new Error(scenario.error)):invoke(command,args);f.synth.enqueueMany(scenario.methods.map(method=>({type:'ym2203',frame:0,message:{method,...(method==='clock'?{hz:3000000}:{port:0,register:0x28,value:0xf0})}})));await assert.rejects(f.synth.flush(),error=>error.message===scenario.error&&error.code!=='YM2203_CLOCK_HELD');assert.equal(f.synth.state,'error');assert.equal(f.errors.length,1);
});

test('Native YM2203 recovers exact Tauri string clock rejection without dropping pending SSG patch writes',async t=>{
  const f=fixture();await f.synth.start();t.after(()=>f.synth.close());const invoke=f.synth.invoke;let refused=false;f.synth.invoke=(command,args)=>{if(!refused&&command==='native_genesis_commands'&&args.commands.every(c=>c.type==='ym2203'&&c.message.method==='clock')){refused=true;return Promise.reject(HELD_CLOCK_ERROR);}return invoke(command,args);};f.synth.fm.ssg.setVolume(1,7);await assert.rejects(f.synth.fm.setClock(3000000),error=>error.code==='YM2203_CLOCK_HELD');assert.equal(f.synth.isReady(),true);assert.equal(f.ssgLevels[1],7);assert.equal(f.synth.fm.clock,4000000);await f.synth.fm.setClock(3000000);assert.equal(f.synth.fm.clock,3000000);assert.deepEqual(f.errors,[]);
});
