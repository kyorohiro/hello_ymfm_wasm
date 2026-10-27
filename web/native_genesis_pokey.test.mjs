import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {SoundChipMixer} from './soundchip_mixer.js';

function fixture(t,mode='pokey-dual'){
  const calls=[],rack=new Map(),errors=[];let revision=0,frame=0;
  const status=()=>({session:1,mode,sampleRate:48000,frame:frame+=128,running:true});
  const image=item=>({...status(),revision:++revision,pokey:structuredClone(item)});
  const invoke=async(command,args={})=>{
    calls.push({command,args});
    if(command==='native_genesis_extra_pokey_create'){assert(!rack.has(args.instance));const p={clock:args.clock??1789790,registers:Array(16).fill(0),readRegisters:Array(16).fill(255),levels:[8,8,8,8],sourceMuteMask:0,held:[],pendingCommands:[]};rack.set(args.instance,p);return image(p);}
    if(command==='native_genesis_extra_pokey_dispose'){rack.delete(args.instance);return true;}
    if(command==='native_genesis_extra_pokey_status'){assert(rack.has(args.instance));return image(rack.get(args.instance));}
    if(command==='native_genesis_commands')for(const c of args.commands){if(c.type!=='extra-pokey')continue;const p=rack.get(c.instance);assert(p,`expired instance ${c.instance}`);const apply=m=>{
      if(m.method==='reset'){p.registers.fill(0);p.levels.fill(8);p.held=[];p.sourceMuteMask=0;}
      if(m.method==='write'){p.registers[m.register]=m.value;if(m.register<8&&(m.register&1)&&(m.value&15))p.levels[m.register>>1]=m.value&15;}
      if(m.method==='set-retained-level')p.levels[m.channel]=m.level;
      if(m.method==='channel-mute')p.sourceMuteMask=m.muted?p.sourceMuteMask|(1<<m.channel):p.sourceMuteMask&~(1<<m.channel);
      if(m.method==='key-off')p.registers[m.channel*2+1]&=240;
      if(m.method==='stop-voices')for(let ch=0;ch<4;ch++)p.registers[ch*2+1]&=240;
      if(m.method==='batch'){if(m.action==='off'&&p.leases?.[m.channel]!==m.voice)return;for(const op of m.commands)apply(op);p.leases??={};if(m.action==='on'){p.leases[m.channel]=m.voice;if(!p.held.includes(m.channel))p.held.push(m.channel);}if(m.action==='off'){delete p.leases[m.channel];p.held=p.held.filter(ch=>ch!==m.channel);}}
    };apply(c.message);}
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown')rack.clear();
    return status();
  };
  const mixer=new SoundChipMixer(),synth=new NativeGenesisSynth({invoke,mode,mixer,onError:e=>errors.push(e)});
  t.after(async()=>{await synth.close();assert.deepEqual(errors,[]);});
  return{synth,mixer,calls,rack,errors,commands:()=>calls.filter(c=>c.command==='native_genesis_commands').flatMap(c=>c.args.commands)};
}

test('Native dual POKEY exposes two stable four-channel clients and separate mode clocks',async t=>{
 const f=fixture(t);assert.equal(f.synth.fm,null);assert.equal(f.synth.psg,null);assert.equal(f.synth.capabilities.chip,'pokey');assert.equal(f.synth.capabilities.fmChannels,0);assert.deepEqual(f.synth.primaryEndpoints.map(p=>[p.id,p.name,p.globalName]),[['pokey','pokey','pokey'],['pokey:2','pokey','pokey2']]);await f.synth.start();assert.equal(f.calls[0].args.mode,'pokey-dual');assert.equal(f.rack.size,2);assert([...f.rack.values()].every(p=>p.clock===1789773));assert(f.synth.pokey._getState().initialized);assert(f.synth.pokey2._getState().initialized);
 f.synth.pokey.noteOn(0,'A4');await f.synth.flush();assert.equal(f.rack.get(1).registers[1],0xa8);assert.equal(f.rack.get(2).registers[1],0xa0);f.synth.pokey2.noteOn(2,'C5');await f.synth.flush();assert.equal(f.rack.get(2).registers[5],0xa8);assert.equal(f.rack.get(1).registers[5],0xa0);
});

test('Native single POKEY uses 1789790 Hz and additional cores keep independent mixer IDs',async t=>{
 const f=fixture(t,'pokey');await f.synth.start();assert.equal(f.synth.pokey2,null);assert.equal(f.rack.get(1).clock,1789790);const d=await f.synth.createExtraPokey({id:'third',clock:1789773});d.client.initialize();d.client.setVolume(0,12);d.client.keyOn(0);await f.synth.flush();assert.equal(f.rack.get(2).clock,1789773);assert.equal(f.rack.get(2).registers[1],0xac);assert.equal(f.rack.get(1).registers[1],0xa0);d.dispose();await f.synth.serial;assert.equal(f.rack.size,1);assert.equal(f.synth.extraPokeyDevices.size,0);
});

test('Native primary Stop recreates silent cores with fresh identities and retained authoring levels',async t=>{
 const f=fixture(t);await f.synth.start();const clients=[f.synth.pokey,f.synth.pokey2];clients[0].setVolume(0,13);clients[0].noteOn(0,'A4');clients[1].noteOn(1,'E4');await f.synth.flush();await f.synth.stopNativeAudio();assert.equal(f.synth.state,'ready');assert.deepEqual([...f.rack.keys()],[3,4]);assert.equal(f.synth.pokey,clients[0]);assert.equal(f.synth.pokey2,clients[1]);assert([...f.rack.values()].every(p=>[1,3,5,7].every(reg=>(p.registers[reg]&15)===0)));clients[0].keyOn(0);await f.synth.flush();assert.equal(f.rack.get(3).registers[1],0xad);assert.equal(f.rack.get(4).registers[1],0xa0);await f.synth.stopNativeAudio();assert.deepEqual([...f.rack.keys()],[5,6]);
});

test('Native POKEY readback and monitor mute use acknowledged controls; clock stays fixed',async t=>{
 const f=fixture(t,'pokey');await f.synth.start();assert.equal(await f.synth.pokey.readRegister(10),255);await f.synth.pokey.setChannelMuted(2,true);assert.equal(f.rack.get(1).sourceMuteMask,4);await f.synth.pokey.setClock(1789790);await assert.rejects(f.synth.pokey.setClock(2000000),/Create a new POKEY/);assert.equal(f.synth.pokey.clock,1789790);
});

test('Native POKEY inspector uses separate per-chip manual audition leases',async t=>{
 const f=fixture(t);await f.synth.start();const i=f.synth.chipInspector;assert.deepEqual(i.list().map(p=>p.id),['pokey','pokey:2']);await i.invoke('pokey','auditionOn',[0,69,'a']);await i.invoke('pokey:2','auditionOn',[1,72,'b']);assert.deepEqual((await i.read('pokey')).held,[0]);assert.deepEqual((await i.read('pokey:2')).held,[1]);assert.equal(await i.invoke('pokey','auditionOff',[0,'stale']),false);assert.deepEqual((await i.read('pokey')).held,[0]);await i.invoke('pokey','auditionOff',[0,'a']);assert.deepEqual((await i.read('pokey')).held,[]);assert.deepEqual((await i.read('pokey:2')).held,[1]);await i.invoke('pokey:2','auditionAllOff');assert.deepEqual((await i.read('pokey:2')).held,[]);
});

test('Native dual POKEY Worker bridge routes same-kind primaries over distinct real MessagePorts',async t=>{
 const {MessageChannel}=await import('node:worker_threads');const {createNativeGenesisWorkerBridge}=await import('./native_genesis_worker.js');const {createPokeyClient}=await import('./playground_pokey.js');const {createPerformanceHost}=await import('./playground_performance_host.js');
 const f=fixture(t);await f.synth.start();const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:error=>f.errors.push(error)});t.after(()=>bridge.dispose());
 const host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});await host.start([bridge.port],.1);t.after(()=>host.stop());
 assert.notEqual(bridge.primaryPorts.pokey,bridge.primaryPorts.pokey2);
 const a=createPokeyClient(bridge.primaryPorts.pokey,{clock:1789773,state:f.synth.pokey._getState()}),b=createPokeyClient(bridge.primaryPorts.pokey2,{clock:1789773,state:f.synth.pokey2._getState()});
 a.noteOn(0,'A4');b.noteOn(2,'E4');assert.equal(await a.readRegister(10),255);assert.equal(await b.readRegister(10),255);assert.equal(f.rack.get(1).registers[1],0xa8);assert.equal(f.rack.get(1).registers[5],0xa0);assert.equal(f.rack.get(2).registers[1],0xa0);assert.equal(f.rack.get(2).registers[5],0xa8);
 await a.setChannelMuted(0,true);assert.equal(f.rack.get(1).sourceMuteMask,1);assert.equal(f.rack.get(2).sourceMuteMask,0);await a._stopVoices();assert.equal(f.rack.get(1).registers[1],0xa0);assert.equal(f.rack.get(2).registers[5],0xa8);a.dispose();b.dispose();await bridge.dispose();
});

test('Native primary POKEY restores visible Mixer gain and pan after global Stop',async t=>{
 const f=fixture(t,'pokey');await f.synth.start();await f.synth.primaryPokey[0].mix(.4,-.5);await f.synth.stopNativeAudio();const mixes=f.commands().filter(c=>c.type==='extra-pokey'&&c.instance===2&&c.message.method==='mix');assert.equal(mixes.length,1);assert.equal(mixes[0].message.volume,.4);assert.equal(mixes[0].message.pan,-.5);
});
