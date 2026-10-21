import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createNesClient} from './playground_nes.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {NesApu,NES_APU_CLOCK} from './nesapu.js';
import {NesVoiceInspector} from './playground_native_voice_inspector.js';

const ticks=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture(){
  let session=0,frame=0,clock=NES_APU_CLOCK,failNext=false,deferNext=false;
  const chip=new NesApu({fds:true,sampleRate:48000}),applied=new NesVoiceInspector(chip),calls=[],errors=[],scheduled=[],auditions=new Map();
  const status=()=>({session,frame,sampleRate:48000,running:true});
  const snapshot=()=>({frame,clock,registers:Array.from(applied.registers),enabled:chip.enableMask,fdsGain:applied.fdsGain,fdsMaster:applied.fdsMaster,
    modulation:Array.from(applied.modTable),memoryRanges:applied.memoryRanges.map(range=>({...range})),dmcActive:!!chip.engine.apu.dmc.getLengthStatus(),fdsActive:chip.engine.fds.enabled});
  const channel=message=>message.method==='enable'?message.channel:message.method==='write'?
    message.address>=0x4023?5:message.address<=0x4013?(message.address-0x4000)>>2:'all':null;
  function run(message,bypass=false){
    if(message.method==='batch'){
      const held=auditions.get(message.channel);
      if(message.audition&&message.action==='off'&&held!==message.voice)return;
      if(!message.audition&&held!==undefined)return;
      if(message.audition&&message.action==='on')auditions.set(message.channel,message.voice);
      for(const command of message.commands)run(command,true);
      if(message.fdsGain!==undefined)applied.fdsGain=message.fdsGain;if(message.fdsMaster!==undefined)applied.fdsMaster=message.fdsMaster;
      if(message.audition&&message.action==='off')auditions.delete(message.channel);
      return;
    }
    const target=channel(message);if(!bypass&&Number.isInteger(target)&&auditions.has(target))return;
    if(message.method==='write'){
      let value=message.value;if(message.address===0x4015&&!bypass){for(const ch of auditions.keys())if(ch<5)value=(value&~(1<<ch))|(chip.enableMask&(1<<ch));}
      chip.writeRegister(message.address,value);
    }else if(message.method==='enable')chip.setChannelEnabled(message.channel,message.enabled);
    else if(message.method==='load-memory')chip.loadMemory(new Uint8Array(message.data),message.address);
    else if(message.method==='clock')clock=message.hz;
    else if(message.method==='reset'){auditions.clear();chip.reset();}
    else if(message.method==='stop-voices'){auditions.clear();applied.stopVoices();}
  }
  const invoke=async(command,args)=>{
    calls.push({command,args});
    if(command==='native_genesis_start'){session++;return status();}
    if(command==='native_genesis_status')return status();
    if(command==='native_genesis_nes_status'){
      if(args.after!==undefined){
        // A device callback applies admitted immediate UI writes before the
        // optional control barrier resolves. Future Worker writes remain due.
        for(let index=0;index<scheduled.length;){const entry=scheduled[index];if(entry.message.id!==undefined&&entry.message.id<=args.after){scheduled.splice(index,1);run(entry.message);}else index++;}
      }
      return snapshot();
    }
    if(command==='native_genesis_stop'){scheduled.length=0;run({method:'stop-voices'});return status();}
    if(command==='native_genesis_commands'){
      if(failNext){failNext=false;throw new Error('NES command rejected');}
      for(const command of args.commands)if(command.type==='nes'){
        if(command.message.method==='stop-voices'&&command.performance!==undefined)continue;
        if(deferNext)scheduled.push({...command,frame:frame+128});else if(command.frame>frame)scheduled.push(command);else run(command.message);
      }
      deferNext=false;
    }
  };
  const synth=new NativeGenesisSynth({invoke,now:()=>frame/48,mode:'nes',onError:error=>errors.push(error)});
  return {synth,calls,errors,chip,snapshot,failNext(){failNext=true;},deferNext(){deferNext=true;},commands:()=>calls.filter(call=>call.command==='native_genesis_commands').flatMap(call=>call.args.commands),
    advance(value){frame=value;for(const command of scheduled.splice(0).sort((a,b)=>a.frame-b.frame)){if(command.frame<=frame)run(command.message);else scheduled.push(command);}}};
}

test('Native NES + FDS reuses its high-level register generator and exposes no hidden Genesis graph',async()=>{
  const f=fixture();assert.deepEqual(f.calls,[]);assert.equal(f.synth.fm,null);assert.equal(f.synth.psg,null);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  await f.synth.start();assert.deepEqual(f.calls[0],{command:'native_genesis_start',args:{mode:'nes'}});
  assert.equal(f.synth.capabilities.chip,'nes');assert.equal(f.synth.capabilities.fmChannels,0);assert.equal(f.synth.capabilities.psg,false);assert.equal(f.synth.capabilities.dac,false);
  assert.deepEqual(f.synth.primaryEndpoints,[{name:'nes',globalName:'nes',client:f.synth.nes}]);
  assert.deepEqual(f.synth.chipInspector.list().map(entry=>entry.id),['nes']);assert(f.synth.nes.fdsEnabled);
  f.synth.nes.pulse.setVoice(0,{volume:11,duty:.25});f.synth.nes.pulse.noteOn(0,'A4');await f.synth.flush();
  const state=await f.synth.chipInspector.read('nes');assert.equal(state.channels[0].volume,11);assert.equal(state.channels[0].period,253);assert.equal(state.channels[0].enabled,true);
  assert.equal(state.fds.wave.length,64);assert(state.fds.wave.some(value=>value>32));
  assert.deepEqual(f.synth.mixer.list().map(entry=>entry.id),['nes']);
  f.synth.mixer.set('nes',{volume:.5,pan:1,muted:true});await f.synth.flush();assert.deepEqual(f.commands().at(-1).message,{method:'mix',volume:0,pan:1});
  await assert.rejects(f.synth.dispatchNativeCommand({type:'write'}),/OPN\/PSG/);await f.synth.close();assert.equal(f.errors.length,0);
});

test('DMC uploads copy source bytes, await admission, and preserve sample metadata and RAM through Stop',async()=>{
  const f=fixture();await f.synth.start();const bytes=new Uint8Array([0x55,0xaa]);
  const loading=f.synth.nes.dmc.loadSample(bytes);bytes.fill(0);assert.deepEqual(await loading,{address:0xc000,length:17});
  const upload=f.commands().find(command=>command.message?.method==='load-memory');assert.equal(upload.message.data[0],0x55);assert.equal(upload.message.data[1],0xaa);assert.equal(upload.message.data.length,17);
  f.synth.nes.dmc.play({rate:12,loop:true});await f.synth.flush();assert.equal((await f.synth.chipInspector.read('nes')).dmc.loaded,true);
  await f.synth.stopNativeAudio();assert.equal(f.chip.engine.memory[0xc000],0x55);assert.deepEqual(f.synth.nes._getState().sample,{address:0xc000,length:17});
  f.synth.nes.dmc.play({rate:8});await f.synth.flush();assert.equal(f.snapshot().enabled&16,16);
  const count=f.commands().length;assert.throws(()=>f.synth.nes.loadMemory(new Uint8Array(2),65535),/RAM range/);assert.equal(f.commands().length,count);
  await f.synth.close();
});

test('future Worker changes stay absent from applied inspector data and share frame/owner scheduling',async()=>{
  const f=fixture();await f.synth.start();
  await f.synth.dispatchNativeNesCommand({method:'writeRegister',args:[0x4000,0x3f],id:4},{time:1,performance:2,owner:3});
  const command=f.commands().at(-1);assert.equal(command.frame,48000);assert.equal(command.performance,2);assert.equal(command.owner,3);
  assert.equal((await f.synth.chipInspector.read('nes')).channels[0].volume,8);
  f.advance(48000);assert.equal((await f.synth.chipInspector.read('nes')).channels[0].volume,15);
  await f.synth.close();
});

test('applied inspector reads and another channel\'s UI edits preserve projected future client state',async()=>{
  const f=fixture();await f.synth.start();const events=[];f.synth.addListener(event=>events.push(event));
  const projected=f.synth.nes._getState();projected.registers[4]=0x3d;projected.registers[6]=200;projected.enabled|=2;projected.registers[0x15]=2;projected.clock=Math.floor(NES_APU_CLOCK/2);
  f.synth.nes._adoptState(projected);
  const applied=await f.synth.chipInspector.read('nes');assert.equal(applied.channels[1].volume,8);assert.equal(applied.clock,NES_APU_CLOCK);
  assert.equal(f.synth.nes._getState().registers[4],0x3d);assert.equal(f.synth.nes.clock,projected.clock);
  await f.synth.chipInspector.invoke('nes','setPulseVoice',[0,{volume:12}]);
  const updated=f.synth.nes._getState();assert.equal(updated.registers[0]&15,12);assert.equal(updated.registers[4],0x3d);assert.equal(updated.registers[6],200);assert.equal(updated.enabled&2,2);assert.equal(updated.clock,projected.clock);
  assert.equal(events.filter(event=>event.type==='native-state').length,0,'inspection must not overwrite the Worker logical state');
  await f.synth.close();
});

test('one-off UI apply barriers preserve consecutive partial edits while callbacks are delayed',async()=>{
  const f=fixture();await f.synth.start();f.deferNext();
  const first=f.synth.chipInspector.invoke('nes','setPulseVoice',[0,{volume:14}]);
  const second=f.synth.chipInspector.invoke('nes','setPulseVoice',[0,{frequency:440}]);
  await first;await second;
  const applied=await f.synth.chipInspector.read('nes');assert.equal(applied.channels[0].volume,14);assert.equal(applied.channels[0].period,253);
  assert.equal(f.synth.nes._getState().registers[0]&15,14);
  assert(f.calls.some(call=>call.command==='native_genesis_nes_status'&&call.args.after>0));
  await f.synth.close();
});

test('Keyboard auditions use atomic native leases and protect held channels from earlier future work',async()=>{
  const f=fixture();await f.synth.start();const inspector=f.synth.chipInspector;
  await f.synth.dispatchNativeNesCommand({method:'writeRegister',args:[0x4000,0x31]},{time:1,performance:1,owner:1});
  await inspector.invoke('nes','auditionOn',[0,69,'old']);const first=f.commands().at(-1).message;
  assert.equal(first.method,'batch');assert.equal(first.action,'on');assert.equal(first.channel,0);assert(first.voice);assert(first.commands.length>=4);
  await inspector.invoke('nes','auditionOn',[0,72,'new']);const next=f.commands().at(-1).message;assert.notEqual(next.voice,first.voice);
  assert.equal(await inspector.invoke('nes','auditionOff',[0,'old']),false);
  f.advance(48000);assert.equal((await inspector.read('nes')).channels[0].volume,8,'future script edit cannot change the held manual voice');
  await inspector.invoke('nes','setPulseVoice',[0,{volume:13}]);assert.equal((await inspector.read('nes')).channels[0].volume,13);
  await inspector.invoke('nes','auditionOff',[0,'new']);assert.equal((await inspector.read('nes')).channels[0].enabled,false);
  await inspector.invoke('nes','auditionOn',[5,60,'fds']);await inspector.invoke('nes','auditionAllOff');assert.equal((await inspector.read('nes')).fds.active,false);
  await f.synth.close();
});

test('Native Stop preserves configured FDS waves, modulation and clock for subsequent keyboard audition',async()=>{
  const f=fixture();await f.synth.start();const nes=f.synth.nes,wave=Array.from({length:64},(_,index)=>index),table=Array.from({length:32},(_,index)=>index%8);
  nes.fds.setWave(wave);nes.fds.setModulation({table,rate:100,depth:8});nes.fds.noteOn('C4');await nes.setClock(NES_APU_CLOCK*2);
  await f.synth.stopNativeAudio();const state=await f.synth.chipInspector.read('nes');
  assert.equal(state.clock,NES_APU_CLOCK*2);assert.deepEqual(state.fds.wave,wave);assert.deepEqual(state.fds.modulation.table,table);assert.equal(state.fds.active,false);
  await f.synth.chipInspector.invoke('nes','auditionOn',[5,60,'again']);assert.equal((await f.synth.chipInspector.read('nes')).fds.active,true);
  await f.synth.close();
});

test('FDS volume edits retain their configured gain while the oscillator is stopped',async()=>{
  const f=fixture();await f.synth.start();
  await f.synth.chipInspector.invoke('nes','setFdsVolume',[{gain:19,master:2}]);
  const batch=f.commands().at(-1).message;assert.equal(batch.fdsGain,19);assert.equal(batch.fdsMaster,2);
  assert.equal(batch.commands.find(command=>command.address===0x4080).value,128,'the stopped oscillator keeps its zero-gain register');
  const state=await f.synth.chipInspector.read('nes');assert.equal(state.fds.gain,19);assert.equal(state.fds.master,2);assert.equal(state.fds.active,false);
  await f.synth.stopNativeAudio();assert.equal((await f.synth.chipInspector.read('nes')).fds.gain,19);
  await f.synth.close();
});

test('Main FDS volume configured while inactive survives Native Stop and keyboard re-audition',async()=>{
  const f=fixture();await f.synth.start();f.synth.nes.fds.setVolume(19,2);await f.synth.flush();
  assert.equal(f.snapshot().registers[0x80],128);assert.equal(f.snapshot().fdsGain,19);
  await f.synth.stopNativeAudio();assert.equal(f.synth.nes._getState().fdsGain,19);assert.equal(f.synth.nes._getState().fdsMaster,2);
  await f.synth.chipInspector.invoke('nes','auditionOn',[5,60,'configured']);
  assert.equal(f.snapshot().registers[0x80]&63,19);assert.equal(f.snapshot().fdsActive,true);await f.synth.close();
});

test('a scoped Worker stop preserves manual leases while an unowned stop retires every keyboard gate',async()=>{
  const f=fixture();await f.synth.start();const inspector=f.synth.chipInspector;
  await inspector.invoke('nes','auditionOn',[0,69,'manual']);
  await f.synth.dispatchNativeNesCommand({method:'stopVoices',id:1},{performance:1,owner:1});
  assert.equal((await inspector.read('nes')).channels[0].enabled,true);
  assert.equal(await inspector.invoke('nes','auditionOff',[0,'manual']),true,'the matching JS lease survives scoped cleanup');
  await inspector.invoke('nes','auditionOn',[5,60,'fds']);await f.synth.nes._stopVoices();
  assert.equal((await inspector.read('nes')).fds.active,false);assert.equal(await inspector.invoke('nes','auditionOff',[5,'fds']),false);
  await f.synth.close();
});

test('existing NES client runs Main-equivalent commands and DMC RPC through real Native Worker ports',async()=>{
  const f=fixture();await f.synth.start();const errors=[],bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:error=>errors.push(error)});
  const host=createPerformanceHost({getContext:()=>f.synth.clock});await host.start([bridge.port],.1);
  const nes=createNesClient(bridge.nesPort,{clock:f.synth.nes.clock,fdsEnabled:true,state:f.synth.nes._getState(),native:true});
  try{
    const lowerClock=Math.floor(NES_APU_CLOCK/2);nes.pulse.noteOn(1,'E4');await nes.setClock(lowerClock);assert.equal(nes.clock,lowerClock);
    await nes.dmc.loadSample(new Uint8Array([0x55,0xaa]));nes.dmc.play();await nes._requestControl('stopVoices');
    assert.equal((await f.synth.chipInspector.read('nes')).channels[1].enabled,false);
    await assert.rejects(nes._requestControl('invalid'),/Unsupported Native NES/);assert.equal(errors.length,0);
  }finally{nes.dispose();host.stop();await bridge.dispose();await f.synth.close();}
});

test('Native Worker FDS volume configured while inactive survives Stop and later keyboard audition',async()=>{
  const f=fixture();await f.synth.start();const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel});
  const host=createPerformanceHost({getContext:()=>f.synth.clock});await host.start([bridge.port],.1);
  const nes=createNesClient(bridge.nesPort,{clock:f.synth.nes.clock,fdsEnabled:true,state:f.synth.nes._getState(),native:true});
  try{
    nes.fds.setVolume(19,2);await nes.setClock(NES_APU_CLOCK);
    assert.equal(f.snapshot().registers[0x80],128);assert.equal(f.snapshot().fdsGain,19);
    await f.synth.stopNativeAudio();assert.equal(f.synth.nes._getState().fdsGain,19);assert.equal(f.synth.nes._getState().fdsMaster,2);
    await f.synth.chipInspector.invoke('nes','auditionOn',[5,60,'worker-configured']);assert.equal(f.snapshot().registers[0x80]&63,19);
  }finally{nes.dispose();host.stop();await bridge.dispose();await f.synth.close();}
});

test('Native NES inspector transport failures reject their UI operation',async()=>{
  const f=fixture();await f.synth.start();f.failNext();
  await assert.rejects(f.synth.chipInspector.invoke('nes','setPulseVoice',[0,{volume:9}]),/NES command rejected/);
  await ticks();assert.equal(f.synth.state,'error');assert.equal(f.errors.length,1);await f.synth.close();
});

test('clearing NES auditions during an outstanding Stop rejects asynchronously so repeated lifecycle Stop can finish',async()=>{
  const f=fixture();await f.synth.start();
  await f.synth.chipInspector.invoke('nes','auditionOn',[0,60,'before-stop']);
  const stopping=f.synth.stopNativeAudio();
  assert.doesNotThrow(()=>f.synth.clearAuditions());
  await stopping;await ticks();
  assert.equal(f.errors.length,0);await f.synth.close();
});
