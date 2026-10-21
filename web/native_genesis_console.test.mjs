import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisConsole} from './native_genesis_console.js';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {borrowNativeApi} from './playground_native_primary.js';
import {createKeyboardApiGuard} from './playground_keyboard.js';
import {GameboyVoiceInspector} from './playground_native_voice_inspector.js';
import {Huc6280VoiceInspector} from './playground_huc6280_inspector.js';

function fixture(kind){
  const gameboy=kind==='gameboy',base=gameboy?4194304:3579545,calls=[],commands=[],events=[],future=[],manual=new Map();
  let frame=0,clock=base,defer=false,fail=false,snapshotOverride;
  const chip={writeRegister(){},reset(){}},applied=gameboy?new GameboyVoiceInspector(chip):new Huc6280VoiceInspector({});
  const target=message=>message.method==='write'?gameboy?(message.address<=19?Math.floor(message.address/5):message.address>=32?2:null):message.register>=2&&message.register<=7?(message.channel??applied.selected):null:message.channel;
  function run(message,bypass=false){
    if(message.method==='batch'){
      const held=manual.get(message.channel);
      if(message.audition&&message.action==='off'&&held!==message.voice)return;
      if(!message.audition&&held!==undefined)return;
      if(message.audition&&message.action==='on')manual.set(message.channel,message.voice);
      for(const op of message.commands)run(op,true);
      if(message.audition&&message.action==='off')manual.delete(message.channel);
      return;
    }
    const channel=target(message);if(!bypass&&Number.isInteger(channel)&&manual.has(channel))return;
    if(message.method==='write'){
      if(gameboy){let value=message.value;
        if(message.address===20&&manual.size&&!bypass)return;
        if(message.address===22&&!(value&128)&&manual.size&&!bypass)return;
        if(message.address===21&&!bypass)for(const ch of manual.keys()){const mask=(1<<ch)|(16<<ch);value=(value&~mask)|(applied.registers[21]&mask);}
        applied.observeWrite(message.address,value);
      }else{
        const previous=applied.selected,explicit=message.channel!==undefined&&message.register>=2&&message.register<=7;
        if(explicit)applied.observeWrite(0,message.channel);applied.observeWrite(message.register,message.value);if(explicit)applied.observeWrite(0,previous);
      }
    }else if(message.method==='waveform'){
      const ch=message.channel,control=applied.registers[ch][4],previous=applied.selected;applied.observeWrite(0,ch);applied.observeWrite(4,(control&63)|64);applied.observeWrite(4,control&63);for(const sample of message.samples)applied.observeWrite(6,sample);applied.observeWrite(4,control);applied.observeWrite(0,previous);
    }else if(message.method==='key-off')applied.registers[message.channel][4]&=127;
    else if(message.method==='clock')clock=message.hz;
    else if(message.method==='reset'){if(!manual.size)applied.reset();}
    else if(message.method==='stop-voices'){manual.clear();applied.resetAuditions();if(gameboy)applied.gates.fill(false);else for(const row of applied.registers)row[4]&=127;}
  }
  function snapshot(){if(snapshotOverride)return snapshotOverride;return gameboy?{clock,registers:Array.from(applied.registers),voice:Array.from(applied.voice),gates:applied.gates.slice()}:
    {clock,selectedChannel:applied.selected,globals:Array.from(applied.globals),registers:applied.registers.map(r=>Array.from(r)),waveforms:applied.waveforms.map(w=>Array.from(w)),indices:Array.from(applied.indices),pointerKnown:Array.from(applied.pointerKnown,Boolean),waveformKnown:Array.from(applied.waveformKnown,Boolean),knownSamples:Array.from(applied.knownSamples),ddaValues:Array.from(applied.ddaValues),initialized:true};}
  const synth={session:1,generation:1,clock:{sampleRate:48000},stopping:null,closing:false,isReady:()=>true,frameAt:time=>Math.round(time*48000),emit:event=>events.push(event),
    enqueue(command){commands.push(command);if(command.frame>frame||defer)future.push(command);else run(command.message);},enqueueMany(list){for(const command of list)this.enqueue(command);},
    async flush(){if(fail){fail=false;throw new Error('Native console transport rejected');}defer=false;},
    async nativeRequest(command,args){calls.push({command,args});if(args.after!==undefined)for(let index=0;index<future.length;){const entry=future[index];if(entry.message.id!==undefined&&entry.message.id<=args.after){future.splice(index,1);run(entry.message);}else index++;}return snapshot();},
  };
  const adapter=createNativeGenesisConsole(synth,kind);
  return {adapter,synth,commands,calls,events,applied,snapshot,async nativeInvoke(command,args={}){calls.push({command,args});if(command==='native_genesis_start'||command==='native_genesis_status')return {session:1,frame,sampleRate:48000,running:true};if(command==='native_genesis_commands'){for(const entry of args.commands)synth.enqueue(entry);await synth.flush();return;}if(command===`native_genesis_${kind}_status`)return synth.nativeRequest(command,args);if(command==='native_genesis_stop'){run({method:'stop-voices'});future.length=0;return {session:1,frame,sampleRate:48000,running:true};}return {};},async start(){adapter.initialize();await synth.flush();},advance(to){frame=to;for(let i=0;i<future.length;){if(future[i].frame<=frame){run(future.splice(i,1)[0].message);}else i++;}},defer(){defer=true;},fail(){fail=true;},malformed(value){snapshotOverride=value;},stop(){run({method:'stop-voices'});return adapter.adoptStopped(snapshot());}};
}
for(const kind of ['gameboy','huc6280']){
  const gameboy=kind==='gameboy';
  test(`Native ${kind} reuses its synchronous authoring API with no hidden audio graph`,async()=>{
    const f=fixture(kind);assert.equal(f.commands.length,0);await f.start();assert.equal(f.adapter.client.id,kind);assert.equal(f.adapter.client._getState().initialized,true);
    if(gameboy)f.adapter.client.pulse.noteOn(0,'A4');else f.adapter.client.noteOn(0,'A4');await f.synth.flush();const state=await f.adapter.read();assert.equal(state.kind,kind);assert.equal(state.channels[0].active,true);assert(f.commands.every(c=>c.type===kind));
    await f.adapter.mix(.5,-1);assert.deepEqual(f.commands.at(-1).message,{method:'mix',volume:.5,pan:-1});
    assert.equal(await f.adapter.dispatch({method:'dispose',id:3}).then(v=>v.value),true);assert.equal(f.adapter.client._getState().initialized,true);
  });
  test(`Native ${kind} applied reads preserve projected future state and frame ownership`,async()=>{
    const f=fixture(kind);await f.start();const client=f.adapter.client,state=client._getState();
    if(gameboy){state.registers[7]=0xf0;state.voice[7]=0xf0;}else state.registers[1][5]=0x12;
    state.clock=Math.floor(client.clock/2);client._adoptState(state);const before=structuredClone(client._getState());
    const register=gameboy?7:5;await f.adapter.dispatch({method:'writeRegister',args:[register,gameboy?0xf0:0x12],...(gameboy?{}:{channel:1})},{time:1,performance:2,owner:4});
    const command=f.commands.at(-1);assert.equal(command.frame,48000);assert.equal(command.performance,2);assert.equal(command.owner,4);await f.adapter.read();assert.deepEqual(client._getState(),before);assert.equal(f.events.length,0);
    await f.adapter.invoke('setVoice',[0,gameboy?{volume:12}:{volume:21}]);const after=client._getState();assert.equal(after.clock,before.clock);
    if(gameboy){assert.equal(after.voice[7],0xf0);assert.equal(after.voice[2]>>4,12);}else{assert.equal(after.registers[1][5],0x12);assert.equal(after.registers[0][4]&31,21);}assert.equal(f.events.length,0);
  });
  test(`Native ${kind} serial UI barriers preserve consecutive partial edits`,async()=>{
    const f=fixture(kind);await f.start();f.defer();const a=f.adapter.invoke('setVoice',[0,gameboy?{volume:13}:{volume:22}]),b=f.adapter.invoke('setVoice',[0,{frequency:440}]);await a;await b;
    const state=await f.adapter.read();assert.equal(state.channels[0].volume,gameboy?13:22);assert(f.calls.some(c=>c.args.after>0));
  });
  test(`Native ${kind} manual audition leases survive script work and reject stale releases`,async()=>{
    const f=fixture(kind);await f.start();await f.adapter.dispatch({method:'writeRegister',args:gameboy?[2,0]:[4,0],...(gameboy?{}:{channel:0})},{time:1,performance:1,owner:1});
    await f.adapter.invoke('auditionOn',[0,69,'old']);const first=f.commands.at(-1).message;assert(first.audition);assert.equal(first.action,'on');
    await f.adapter.invoke('auditionOn',[0,72,'new']);assert.notEqual(f.commands.at(-1).message.voice,first.voice);assert.equal(await f.adapter.invoke('auditionOff',[0,'old']),false);
    f.advance(48000);assert.equal((await f.adapter.read()).channels[0].active,true);await f.adapter.dispatch({method:'stopVoices'},{performance:1,owner:1});
    // A scoped stop retains JS audition identities; real callback scopes by owner.
    assert.equal(await f.adapter.invoke('auditionOff',[0,'new']),true);assert.equal((await f.adapter.read()).channels[0].active,false);
  });
  test(`Native ${kind} Stop adoption retains waveforms clock and configured voices`,async()=>{
    const f=fixture(kind);await f.start();await f.adapter.client.setClock((gameboy?4194304:3579545)*2);
    if(gameboy){f.adapter.client.pulse.setVoice(0,{volume:14});f.adapter.client.wave.setWaveform(Array.from({length:32},(_,i)=>i%16));f.adapter.client.pulse.noteOn(0,'A4');}
    else{f.adapter.client.setVolume(0,27);f.adapter.client.setWaveform(0,Array.from({length:32},(_,i)=>i));f.adapter.client.noteOn(0,'A4');}
    await f.synth.flush();f.stop();const client=f.adapter.client._getState(),state=await f.adapter.read();assert.equal(state.channels[0].active,false);assert.equal(client.clock,(gameboy?4194304:3579545)*2);
    if(gameboy){assert.equal(client.voice[2]>>4,14);assert.equal(client.registers[32],1);}else{assert.equal(client.registers[0][4]&31,27);assert.deepEqual(client.waveforms[0],Array.from({length:32},(_,i)=>i));}
    await f.adapter.invoke('auditionOn',[0,60,'again']);assert.equal((await f.adapter.read()).channels[0].active,true);
  });
  test(`Native ${kind} cancelled lifecycle operations reject asynchronously`,async()=>{
    const f=fixture(kind);await f.start();f.synth.stopping=Promise.resolve();let operation;assert.doesNotThrow(()=>{operation=f.adapter.invoke('auditionAllOff');});await assert.rejects(operation,/cancelled/);f.synth.stopping=null;f.fail();await assert.rejects(f.adapter.invoke('setVoice',[0,{volume:9}]),/transport rejected/);
  });
}
test('Native Game Boy explicit UI power-off ends manual notes and preserves authored other-channel pan bits',async()=>{
  const f=fixture('gameboy');await f.start();const state=f.adapter.client._getState();state.registers[21]=0x22;state.voice[21]=0x22;f.adapter.client._adoptState(state);
  await f.adapter.invoke('setVoice',[0,{pan:{left:true,right:false}}]);assert.equal(f.adapter.client._getState().registers[21],0x32);
  await f.adapter.invoke('auditionOn',[0,69,'held']);await f.adapter.invoke('setPower',[false]);assert.equal((await f.adapter.read()).powered,false);assert.equal(f.adapter.client._getState().initialized,false);
});
test('Native HuC6280 raw channel metadata and waveform/DDA inspector operations use exact IPC',async()=>{
  const f=fixture('huc6280');await f.start();f.adapter.client.writeRegister(0,7);f.adapter.client.writeRegister(5,0x12);await f.synth.flush();assert.equal(f.commands.at(-1).message.channel,7);assert.equal((await f.adapter.read()).selectedChannel,7);
  const waveform=Array.from({length:32},(_,i)=>31-i);await f.adapter.invoke('setWaveform',[2,waveform]);assert.deepEqual((await f.adapter.read()).channels[2].waveform,waveform);
  await f.adapter.invoke('auditionOn',[2,60,'before-dda']);await f.adapter.invoke('setVoice',[2,{dda:true,ddaValue:23}]);assert.equal(f.commands.at(-1).message.action,'off','DDA edit must retire its native audition lease');assert.equal((await f.adapter.read()).channels[2].dda,true);assert.equal((await f.adapter.read()).channels[2].ddaValue,23);await assert.rejects(f.adapter.invoke('auditionOn',[2,60,'dda']),/DDA/);
});
test('Native console rejects malformed applied snapshots',async()=>{
  for(const kind of ['gameboy','huc6280']){const f=fixture(kind);await f.start();const state=f.snapshot();if(kind==='gameboy')state.gates=[true];else state.waveforms[3]=[99];f.malformed(state);await assert.rejects(f.adapter.read(),/invalid/);}
});

test('Native Game Boy nested voices pass through the real runtime ownership and Keyboard guards',async()=>{
  const f=fixture('gameboy');await f.start();
  const keyboard=createKeyboardApiGuard(()=>null,()=>{}),api=keyboard(borrowNativeApi(f.adapter.client,'gameboy'));
  api.pulse.setVoice(0,{volume:11});api.pulse.noteOn(0,'A4');api.wave.setLevel(.5);api.noise.setVoice({volume:5});await f.synth.flush();
  assert.equal((await f.adapter.read()).channels[0].active,true);api.pulse.keyOff(0);await f.synth.flush();assert.equal((await f.adapter.read()).channels[0].active,false);
});

for(const kind of ['gameboy','huc6280'])test(`NativeSynth ${kind} integrates its actual endpoint inspector mixer and Stop lifecycle`,async()=>{
  const f=fixture(kind),errors=[],mode=kind==='huc6280'?'pc-engine':kind;
  const synth=new NativeGenesisSynth({invoke:(...args)=>f.nativeInvoke(...args),mode,now:()=>0,onError:error=>errors.push(error)});
  assert.equal(synth.fm,null);assert.equal(synth.psg,null);assert.equal(synth.audioContext,null);assert.equal(synth.node,null);await synth.start();
  const endpoint=synth.primaryEndpoints[0];assert.equal(endpoint.name,kind);assert.equal(endpoint.globalName,kind==='gameboy'?'gameboy':'pce');assert.equal(endpoint.client,synth[kind]);assert.deepEqual(synth.mixer.list().map(e=>e.id),[kind]);assert.equal(synth.chipInspector.list()[0].id,kind);
  await synth.chipInspector.invoke(kind,'auditionOn',[0,69,'key']);assert.equal((await synth.chipInspector.read(kind)).channels[0].active,true);
  await synth.stopNativeAudio();assert.equal((await synth.chipInspector.read(kind)).channels[0].active,false);await synth.chipInspector.invoke(kind,'auditionOn',[0,72,'again']);assert.equal((await synth.chipInspector.read(kind)).channels[0].active,true);
  const stopping=synth.stopNativeAudio();assert.doesNotThrow(()=>synth.clearAuditions());await stopping;await synth.close();assert.equal(synth.state,'closed');assert.deepEqual(errors,[]);assert.equal(f.calls.filter(c=>c.command==='native_genesis_start').length,1);
});
