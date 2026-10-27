import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {WonderSwanVoiceInspector} from './playground_wonderswan_inspector.js';
import {installCreationEnvironment,until} from './native_genesis_extra_creation_fixture.mjs';
import {WONDERSWAN_CLOCK_HELD_ERROR} from './native_genesis_wonderswan.js';

// RPC transport model only: actual rendering and callback ownership are checked
// by Tauri's C++/Rust tests. This model exposes every command sent by production
// Main/Worker clients and keeps applied snapshots distinct from authored state.
function fixture(t,{mode='wonderswan',clock=3072000}={}) {
  const calls=[],errors=[],logs=[],rack=new Map();let frame=0;
  const source=hz=>({clock:hz,inspector:new WonderSwanVoiceInspector({clock:()=>hz}),held:new Map(),initialized:false,timeline:null});
  const primary=source(clock),status=()=>({session:1,mode,sampleRate:48000,frame:++frame,ymClock:7670454,psgClock:3579545,wonderswanClock:primary.clock,running:true});
  const image=s=>({clock:s.clock,initialized:s.initialized,registers:Array.from(s.inspector.registers),authoredRegisters:Array.from(s.inspector.registers),memory:Array.from(s.inspector.memory),held:[...s.held.keys()],pendingCommands:[],pendingClocks:s.pendingClocks??0,pendingTimelines:0,timeline:s.timeline??{loaded:false,playing:false,ended:false,cancelled:false,positionSamples:0,durationSamples:0,token:0},sampleRate:48000,frame,revision:calls.length});
  function apply(s,m,bypass=false) {
    const r=s.inspector.registers;
    if(m.method==='batch'){
      if(m.action==='off'&&s.held.get(m.channel)!==m.voice)return;
      for(const command of m.commands)apply(s,command,true);
      if(m.action==='on')s.held.set(m.channel,m.voice);else if(m.action==='off')s.held.delete(m.channel);
    }else if(m.method==='reset'){if(!s.held.size||bypass){s.inspector.reset();s.initialized=false;}}
    else if(m.method==='write'){
      if(m.address===0x90){let mask=m.controlMask??255;if(!bypass)for(const ch of s.held.keys())mask&=~((1<<ch)|([0,32,64,128][ch]));s.inspector.observeWrite(m.address,(r[16]&~mask)|(m.value&mask));}
      else if(bypass||m.channel===undefined||!s.held.has(m.channel))s.inspector.observeWrite(m.address,m.value);
      s.initialized=true;
    }else if(m.method==='memory'){if(bypass||!s.held.has(m.channel))s.inspector.observeMemory(m.address,m.value);}
    else if(m.method==='key-off'){if(bypass||!s.held.has(m.channel))r[16]&=~(1<<m.channel);}
    else if(m.method==='clock'){if(s.held.size)throw Error(WONDERSWAN_CLOCK_HELD_ERROR);s.clock=m.hz;}
    else if(m.method==='prepare-timeline'){s.trace=m.trace;s.timeline={loaded:true,playing:false,ended:false,cancelled:false,durationSamples:m.trace.durationSamples,positionSamples:0,token:0};}
    else if(m.method==='play-timeline'){
      s.clock=s.trace.clock;s.initialized=true;s.timeline={...s.timeline,playing:true,ended:false,cancelled:false,token:m.token,positionSamples:0,group:m.group};
      const playing=s.timeline;if(playing.durationSamples<=44100)setTimeout(()=>{if(s.timeline===playing&&playing.playing){playing.playing=false;playing.ended=true;playing.positionSamples=playing.durationSamples;}},5);
    }else if(m.method==='stop-timeline'){s.timeline={...s.timeline,playing:false,cancelled:true};}
    else if(m.method==='cancel-main-owner'&&s.timeline?.group===m.targetGroup){s.timeline={...s.timeline,playing:false,cancelled:true};}
    else if(m.method==='mix'){s.mix={volume:m.volume,pan:m.pan};}
    else if(m.method==='stop-voices'){for(let ch=0;ch<4;ch++)if(!s.held.has(ch))r[16]&=~(1<<ch);}
  }
  const invoke=async(command,args={})=>{
    calls.push({command,args});const match=/^native_genesis_extra_wonderswan_(create|dispose|status)$/.exec(command);
    if(match){const op=match[1];if(op==='create')rack.set(args.instance,source(args.clock));if(op==='dispose'){rack.delete(args.instance);return true;}return {wonderswan:image(rack.get(args.instance)),...status()};}
    if(command==='native_genesis_wonderswan_status')return image(primary);
    if(command==='native_genesis_commands'){
      for(const entry of args.commands)if(['wonderswan','extra-wonderswan'].includes(entry.type)){const s=entry.type==='wonderswan'?primary:rack.get(entry.instance);if(entry.message.method==='clock'&&s.held.size)throw Error(WONDERSWAN_CLOCK_HELD_ERROR);}
      for(const entry of args.commands)if(entry.type==='wonderswan')apply(primary,entry.message);else if(entry.type==='extra-wonderswan')apply(rack.get(entry.instance),entry.message);
    }
    if(command==='native_genesis_stop'||command==='native_genesis_shutdown'){rack.clear();primary.held.clear();primary.inspector.registers[16]&=240;}
    return status();
  };
  const synth=new NativeGenesisSynth({mode,clock,invoke,onError:error=>errors.push(error)}),runtime=createPlaygroundRuntime({synth,guardExecution:false,onLog:line=>logs.push(line)});
  t.after(()=>runtime.finalize());
  return {synth,runtime,calls,errors,logs,primary,rack,commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[])};
}

const compactTrace=()=>({version:1,clock:3072000,durationSamples:2205,events:[[0,0,0x91,8],[0,0,0x94,15],[0,0,0x90,34],[0,2,0,6,3,4],[4,0,0x89,99]],pcmData:new Uint8Array([0,10,2,20,2,30])});
for(const mode of ['wonderswan','genesis'])for(const execution of ['main','worker'])test(`Native WonderSwan ${mode} ${execution} prepares compact PCM once and awaits acknowledged playback`,{timeout:15000},async t=>{
  installCreationEnvironment(t);const f=fixture(t,{mode});
  const trace=compactTrace();
  await f.runtime.playSource(`const a=await useSoundChip('wonderswan');await a.prepareTimeline({version:1,clock:3072000,durationSamples:2205,events:${JSON.stringify(trace.events)},pcmData:new Uint8Array(${JSON.stringify([...trace.pcmData])})});await a.playTimeline();log('timeline-finished');`,{execution});
  await until(()=>f.logs.includes('timeline-finished'),'Native compact timeline completed');
  const kind=mode==='genesis'?'extra-wonderswan':'wonderswan',sent=f.commands().filter(c=>c.type===kind);
  const prepare=sent.filter(c=>c.message.method==='prepare-timeline'),play=sent.filter(c=>c.message.method==='play-timeline');
  assert.equal(prepare.length,1);assert.equal(play.length,1);assert.deepEqual(prepare[0].message.trace.pcmData,[...trace.pcmData]);
  assert(!sent.some(c=>c.message.address===0x89&&[10,20,30].includes(c.message.value)),'PCM bytes must stay in the compact payload');
  if(execution==='worker')assert(play[0].performance>0&&play[0].owner>0);else assert.equal(play[0].message.group,prepare[0].message.group);
  assert.deepEqual(f.errors,[]);
});

test('Native WonderSwan stops an acknowledged compact playback and cancels its completion promise',async t=>{
  installCreationEnvironment(t);const f=fixture(t);await f.runtime.initialize();
  await f.synth.ws.prepareTimeline({...compactTrace(),durationSamples:441000});
  const playing=f.synth.ws.playTimeline(),stopped=assert.rejects(playing,{name:'AbortError'});
  await until(()=>f.commands().some(c=>c.message?.method==='play-timeline'),'Native play admitted');
  await f.synth.ws.stopTimeline();await stopped;
  assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});

test('Native WonderSwan admits the song-sized packed payload as one bounded upload and validates before IPC',async t=>{
  installCreationEnvironment(t);const f=fixture(t);await f.runtime.initialize();
  const count=1151160,pcmData=new Uint8Array(count*2);for(let i=0;i<count;i++){pcmData[i*2]=i?3:0;pcmData[i*2+1]=i&255;}
  const trace={version:1,clock:3072000,durationSamples:count*3,events:[[0,0,0x90,34],[0,2,0,pcmData.length,count,(count-1)*3]],pcmData};
  await f.synth.ws.prepareTimeline(trace);
  const sent=f.commands().filter(c=>c.message?.method==='prepare-timeline');assert.equal(sent.length,1);assert.equal(sent[0].message.trace.pcmData.length,2302320);
  const before=f.commands().length;pcmData[0]=1;await assert.rejects(f.synth.ws.prepareTimeline(trace),/first PCM delta/);assert.equal(f.commands().length,before);
  assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});

for(const mode of ['wonderswan','genesis'])test(`Native WonderSwan ${mode} retains liveLoop ownership through prepare and long playback acknowledgement`,async t=>{
  installCreationEnvironment(t);const f=fixture(t,{mode}),trace=compactTrace();
  await f.runtime.playSource(`const a=await useSoundChip('wonderswan');liveLoop('compact',async()=>{await a.prepareTimeline({version:1,clock:3072000,durationSamples:2205,events:${JSON.stringify(trace.events)},pcmData:new Uint8Array(${JSON.stringify([...trace.pcmData])})});await a.playTimeline();log('loop-complete');await beat(4);});`);
  await until(()=>f.logs.includes('loop-complete'),'Native loop compact playback completed');
  const sent=f.commands().filter(c=>['prepare-timeline','play-timeline'].includes(c.message?.method));assert(sent[0].message.group>0);assert.equal(sent[0].message.group,sent[1].message.group);assert.deepEqual(f.errors,[]);
});

test('Native primary WonderSwan Main stopLoop cancels callback-owned PCM without waiting for song completion',async t=>{
  installCreationEnvironment(t);const f=fixture(t),trace=compactTrace();
  await f.runtime.playSource(`const a=await useSoundChip('wonderswan');await a.prepareTimeline({version:1,clock:3072000,durationSamples:441000,events:${JSON.stringify(trace.events)},pcmData:new Uint8Array(${JSON.stringify([...trace.pcmData])})});liveLoop('voice-pcm',async()=>{await a.playTimeline();context.bad=true;await beat(100);});context.cancel=()=>stopLoop('voice-pcm');`);
  await until(()=>f.commands().some(c=>c.message?.method==='play-timeline'),'Native primary PCM started');
  const play=f.commands().find(c=>c.message?.method==='play-timeline');assert(play.message.group>0);
  f.runtime.context.cancel();await f.synth.flush();
  assert(f.commands().some(c=>c.message?.method==='cancel-main-owner'&&c.message.targetGroup===play.message.group));
  assert.equal(f.primary.timeline.playing,false);assert.equal(f.runtime.context.bad,undefined);assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});

test('Native WonderSwan starts the selected clock with four primary voices and no hidden FM/audio graph',async t=>{
  installCreationEnvironment(t);const f=fixture(t,{clock:3200001});await f.runtime.initialize();
  assert.deepEqual(f.calls.find(call=>call.command==='native_genesis_start').args,{mode:'wonderswan',clock:3200001});
  assert.equal(f.synth.capabilities.chip,'wonderswan');assert.equal(f.synth.capabilities.fmChannels,0);assert.equal(f.synth.fm,null);assert.equal(f.synth.psg,null);
  assert.equal(f.synth.ws,f.synth.wonderswan);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  assert.deepEqual(f.synth.chipInspector.list().map(row=>[row.id,row.kind]),[['wonderswan','wonderswan']]);
  f.synth.ws.setPan(0,15,2);f.synth.ws.noteOn(0,'C4');f.synth.ws.setSweep({enabled:true,step:-2,time:4});f.synth.ws.setNoise({enabled:true,type:5,reset:true});f.synth.ws.setVoiceMode(true);f.synth.ws.writeVoice(128);await f.synth.flush();
  const commands=f.commands();assert(commands.every(c=>['wonderswan','mix'].includes(c.type)));
  assert(commands.some(c=>c.type==='wonderswan'&&c.message.address===0x90&&c.message.controlMask===1&&c.message.channel===0));
  assert(commands.some(c=>c.type==='wonderswan'&&c.message.address===0x90&&c.message.controlMask===64&&c.message.channel===2));
  const view=await f.synth.chipInspector.read('wonderswan');assert.equal(view.channels.length,4);assert.deepEqual(view.channels[0].pan,{left:15,right:2});assert.equal(view.voiceMode,true);assert.equal(view.sweep.step,-2);assert.equal(view.noise.type,5);assert.deepEqual(f.errors,[]);
});

test('Native additional WonderSwan keeps independent clock/RAM, explicit initialize and Mixer identity',async t=>{
  installCreationEnvironment(t);const f=fixture(t,{mode:'genesis'});
  await f.runtime.playSource(`context.a=await createSoundChip('wonderswan',{id:'a'});context.b=await createSoundChip('wonderswan',{id:'b'});`);
  const {a,b}=f.runtime.context;assert.throws(()=>a.noteOn(0,'C4'),/initialize/);a.initialize();b.initialize();a.setWaveform(0,Array(32).fill(3));b.setWaveform(0,Array(32).fill(12));a.noteOn(0,'C4');b.noteOn(2,'E4');await f.synth.flush();
  assert.equal(f.synth.extraWonderSwanDevices.size,2);const i=f.synth.chipInspector;
  await a.setClock(4000001);assert.equal((await i.read('a')).clock,4000001);assert.equal((await i.read('b')).clock,3072000);assert.deepEqual((await i.read('a')).channels[0].waveform,Array(32).fill(3));assert.deepEqual((await i.read('b')).channels[0].waveform,Array(32).fill(12));
  f.synth.mixer.set('a',{volume:.4,pan:-.25});await f.synth.flush();assert.deepEqual([...f.rack.values()][0].mix,{volume:.4,pan:-.25});
  assert.equal(f.synth.chipInspector.list().filter(row=>row.kind==='wonderswan').length,2);a.dispose();await f.synth.flush();assert.equal(f.synth.extraWonderSwanDevices.size,1);assert.deepEqual(f.errors,[]);
});

for(const extra of [false,true])test(`Native WonderSwan ${extra?'additional':'primary'} applied reads and editor patches preserve future author projections`,async t=>{
  installCreationEnvironment(t);const f=fixture(t,{mode:extra?'genesis':'wonderswan'});await f.runtime.playSource(extra?`context.a=await createSoundChip('wonderswan',{id:'a'});context.a.initialize();`:`context.a=ws;`);
  const a=f.runtime.context.a,id=extra?'a':'wonderswan',source=extra?[...f.rack.values()][0]:f.primary,raw=extra?[...f.synth.extraWonderSwanDevices.values()][0].client:f.synth.ws,i=f.synth.chipInspector;
  a.setPan(0,7,12);a.setNoise({enabled:true,type:6});await f.synth.flush();source.inspector.registers[8]=0x13;source.inspector.registers[14]=17;
  const before=raw._getState();await i.read(id);assert.deepEqual(raw._getState(),before);
  await i.invoke(id,'setVoice',[0,{pan:{left:2}}]);await i.invoke(id,'setNoise',[{enabled:false}]);
  assert.equal(raw._getState().registers[8],0x2c);assert.equal(raw._getState().registers[14]&7,6);assert.equal((await i.read(id)).channels[0].pan.right,3);assert.equal((await i.read(id)).noise.type,1);
  await i.invoke(id,'setWaveform',[2,Array(32).fill(9)]);assert.deepEqual((await i.read(id)).channels[2].waveform,Array(32).fill(9));assert.deepEqual(raw._getState().memory.slice(32,48),Array(16).fill(0x99));
  const sent=f.commands().filter(c=>c.type===(extra?'extra-wonderswan':'wonderswan'));assert(sent.some(c=>c.message.method==='batch'&&c.message.commands.some(command=>command.method==='memory'&&command.channel===2)));
  assert.deepEqual(f.errors,[]);
});

for(const extra of [false,true])test(`Native WonderSwan ${extra?'additional':'primary'} audition masks, stale releases and recoverable clock rejection`,async t=>{
  installCreationEnvironment(t);const f=fixture(t,{mode:extra?'genesis':'wonderswan'});await f.runtime.playSource(extra?`context.a=await createSoundChip('wonderswan',{id:'a'});context.a.initialize();`:`context.a=ws;`);
  const a=f.runtime.context.a,id=extra?'a':'wonderswan',i=f.synth.chipInspector;
  await i.invoke(id,'auditionOn',[0,60,'old']);await i.invoke(id,'auditionOn',[1,64,'sibling']);await i.invoke(id,'auditionOn',[0,67,'new']);await i.invoke(id,'auditionOff',[0,'old']);assert.deepEqual((await i.read(id)).held,[0,1]);
  a.allNotesOff();await f.synth.flush();assert.deepEqual((await i.read(id)).channels.slice(0,2).map(ch=>ch.active),[true,true]);
  await assert.rejects(a.setClock(4000000),/manually held WonderSwan/);assert.equal(f.synth.state,'ready');assert.equal(a.clock,3072000);
  await i.invoke(id,'setSweep',[{enabled:true,step:-1,time:7}]);assert.equal((await i.read(id)).channels[1].active,true);
  await i.invoke(id,'auditionAllOff');await a.setClock(4000000);assert.equal(a.clock,4000000);
  const source=extra?[...f.rack.values()][0]:f.primary;source.pendingClocks=1;await assert.rejects(i.invoke(id,'auditionOn',[0,60,'pending']),/clock change is scheduled/);assert.deepEqual((await i.read(id)).held,[]);source.pendingClocks=0;
  const before=f.commands().length;assert.throws(()=>a.writeMemory(16384,1));assert.throws(()=>a.setWaveform(0,Array(32).fill(16)));assert.throws(()=>a.writeRegister(0x7f,0));assert.equal(f.commands().length,before);assert.deepEqual(f.errors,[]);
});

for(const mode of ['genesis','wonderswan'])for(const execution of ['main','worker'])test(`Native WonderSwan ${mode} ${execution} routes primary and additional Keyboard/clock commands`,{timeout:15000},async t=>{
  installCreationEnvironment(t);const f=fixture(t,{mode});
  await f.runtime.playSource(`const a=await useSoundChip('wonderswan');${mode==='genesis'?'a.initialize();':''}await a.setClock(3200000);a.setWaveform(2,Array(32).fill(7));a.noteOn(2,'E4');keyboard.bind('test',{noteOn(){a.noteOn(3,'G4');log('keyboard-on');},noteOff(){a.keyOff(3);},allNotesOff(){a.allNotesOff();}});log('ready');`,{execution});
  await until(()=>f.logs.includes('ready')&&f.runtime.getKeyboardTarget(),'Native WS client ready');f.runtime.getKeyboardTarget().noteOn({id:'key',midi:60});await until(()=>f.logs.includes('keyboard-on'),'Keyboard reached Native WS');await f.synth.flush();
  const commands=f.commands().filter(c=>c.type===(mode==='genesis'?'extra-wonderswan':'wonderswan'));
  assert(commands.some(c=>c.message.method==='clock'&&c.message.hz===3200000));assert(commands.some(c=>c.message.method==='memory'&&c.message.channel===2));assert(commands.some(c=>c.message.method==='write'&&c.message.address===0x90&&c.message.channel===3&&c.message.controlMask===8));
  if(execution==='worker')assert(commands.some(c=>c.performance>0&&c.owner>0));
  if(mode==='genesis'&&execution==='main')assert(commands.some(c=>c.message.group>0));
  await f.runtime.stopWithFade();assert.equal(f.synth.extraDevices.size,0);if(mode==='wonderswan'){assert.equal((await f.synth.chipInspector.read('wonderswan')).channels.some(ch=>ch.active),false);assert.equal(f.synth.ws.clock,3200000);assert.equal(f.synth.ws._getState().memory[32],0x77);}
  assert.deepEqual(f.errors,[]);
});
