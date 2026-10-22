import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisMasterSystem} from './native_genesis_master_system.js';
import {createSegaPsgClient} from './playground_segapsg.js';
import {createYm2413Client} from './playground_ym2413.js';

const physical=channel=>channel<9?channel:[6,7,8,8,7][channel-9];
function fixture(){
  const commands=[],requests=[],events=[],future=[],held={segapsg:new Map(),ym2413:new Map()};let frame=0,flushHook=null,statusHook=null;
  const psg={clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,sourceMuteMask:0};
  const opll={clock:3579545,registers:Array(64).fill(0),status:0,irq:false,sourceMuteMask:0};
  function release(chip,ch){if(chip==='segapsg')psg.attenuations[ch]=15;else if(ch<9)opll.registers[0x20+ch]&=239;else opll.registers[14]&=~(16>>(ch-9));}
  function apply(message,bypass=false){const m=message,state=m.chip==='segapsg'?psg:opll,map=held[m.chip];
    if(m.method==='batch'){
      assert(m.commands.every(c=>['write','key-off','audition-key-on','clock'].includes(c.method)),'Batch operations must match the Rust Op enum');
      if(m.action==='off'&&map.get(m.channel)!==m.voice)return;
      if(m.action==='on'){for(const ch of [...map.keys()])if(m.chip==='segapsg'?ch===m.channel:physical(ch)===physical(m.channel)){release(m.chip,ch);map.delete(ch);}map.set(m.channel,m.voice);}
      for(const c of m.commands)apply({...c,chip:m.chip},true);if(m.action==='off')map.delete(m.channel);return;
    }
    if(m.method==='write'){
      if(state===psg){const v=m.value,r=v&128?v>>4&7:m.psgRegister??psg.latched,ch=r>>1;if(!bypass&&map.has(ch))return;psg.latched=r;if(r&1){psg.attenuations[ch]=v&15;if((v&15)!==15)psg.lastVolumes[ch]=v&15;}else if(r===6)psg.mode=v&7;else psg.periods[ch]=v&128?(psg.periods[ch]&1008)|(v&15):(psg.periods[ch]&15)|((v&63)<<4);}
      else{const r=m.register,ch=r>=0x10&&r<=0x18?r-0x10:r>=0x20&&r<=0x28?r-0x20:r>=0x30&&r<=0x38?r-0x30:null;if(!bypass&&[...map.keys()].some(key=>r<8||r===14||physical(key)===ch))return;opll.registers[r]=m.value;}
    }else if(m.method==='key-off')release(m.chip,m.channel);
    else if(m.method==='audition-key-on'){if(m.channel<9)opll.registers[0x20+m.channel]|=16;else opll.registers[14]|=16>>(m.channel-9);}
    else if(m.method==='clock')state.clock=m.hz;
    else if(m.method==='reset'){map.clear();if(state===psg){psg.periods.fill(0);psg.attenuations.fill(15);psg.lastVolumes.fill(0);psg.latched=psg.mode=0;}else opll.registers.fill(0);}
    else if(m.method==='stop-voices'){map.clear();if(state===psg)psg.attenuations.fill(15);else{for(let ch=0;ch<9;ch++)release('ym2413',ch);opll.registers[14]&=224;}}
  }
  const snapshot=()=>({sampleRate:48000,frame,revision:commands.length,...Object.fromEntries([['segapsg',psg],['ym2413',opll]].map(([chip,state])=>[chip,{...structuredClone(state),held:[...held[chip].keys()],pendingCommands:future.flatMap(c=>c.message.chip===chip&&c.message.id?[c.message.id]:[])}]))});
  const synth={session:1,generation:1,clock:{sampleRate:48000},stopping:null,closing:false,isReady:()=>true,frameAt:time=>Math.round(time*48000),enqueue(c){commands.push(c);if(c.frame>frame)future.push(c);else apply(c.message);},async flush(){if(flushHook)await flushHook();},async nativeRequest(command,args){requests.push({command,args});return statusHook?statusHook():snapshot();},emit:e=>events.push(e)};
  const endpoints=createNativeGenesisMasterSystem(synth);
  return {...endpoints,synth,commands,requests,events,psg,opll,held,snapshot,setFlushHook:h=>{flushHook=h;},setStatusHook:h=>{statusHook=h;},async start(){for(const e of Object.values(endpoints))await e.initialize();commands.length=0;},advance(to){frame=to;for(let i=0;i<future.length;)if(future[i].frame<=frame)apply(future.splice(i,1)[0].message);else i++;},stop(){future.length=0;for(const [chip,e]of Object.entries(endpoints)){apply({chip,method:'stop-voices'});e.adoptStopped(snapshot()[chip]);}}};
}

test('Master System creates exactly two mono controls without audio work and initializes once',async()=>{
  const f=fixture();assert.equal(f.commands.length,0);assert.equal(f.segapsg.client.id,'segapsg');assert.equal(f.ym2413.client.id,'ym2413');assert.equal(f.segapsg.client.stereoEnabled,false);assert.equal(f.segapsg.client.setStereo,undefined);
  assert.equal(f.segapsg.client.clock,3579545);assert.equal(f.ym2413.client.clock,3579545);await f.start();await f.segapsg.initialize();await f.ym2413.initialize();assert.equal(f.commands.length,0);assert(f.opll.registers.slice(0x30,0x39).every(v=>v===31));assert(f.opll.registers.slice(0x20,0x29).every(v=>v===0));
});

test('Native Master System preserves Web PSG bytes, continuation targets and OPLL register authoring',async()=>{
  const f=fixture();await f.start();const psgWrites=[],opllWrites=[],port=messages=>({postMessage:m=>messages.push(m),close(){}});
  const psg=createSegaPsgClient(port(psgWrites),{stereoEnabled:false}),opll=createYm2413Client(port(opllWrites));
  function programPsg(api){for(let ch=0;ch<3;ch++){api.tone(ch,{note:'A4',attenuation:ch+3});api.keyOff(ch);api.keyOn(ch);}api.noise({type:'white',rate:'tone3',attenuation:9});api.write(0x81);api.write(0x23);api.noiseOff();}
  function programOpll(api){api.initialize();for(let ch=0;ch<9;ch++){api.setVoice(ch,{instrument:ch+1,attenuation:ch,sustain:ch%2===1});api.noteOn(ch,'A4');api.keyOff(ch);}api.setPreset(0,{userPatch:{feedback:4,operators:[{mul:3,tl:27,ar:15},{mul:1,ar:14,rr:9}]},attenuation:5});api.setRhythm({enabled:true,bassDrum:true,hiHat:true});api.setRhythmLevels({bassDrum:1,snare:2,tom:3,cymbal:4,hiHat:5});}
  programPsg(psg);programPsg(f.segapsg.client);programOpll(opll);programOpll(f.ym2413.client);
  assert.deepEqual(f.commands.filter(c=>c.message.chip==='segapsg').map(c=>c.message),psgWrites.map(m=>({chip:'segapsg',method:'write',register:0,value:m.args[0],...(m.psgRegister===undefined?{}:{psgRegister:m.psgRegister})})));
  assert.deepEqual(f.commands.filter(c=>c.message.chip==='ym2413').map(c=>c.message),opllWrites.map(m=>m.method==='reset'?{chip:'ym2413',method:'reset'}:{chip:'ym2413',method:'write',register:m.args[0],value:m.args[1]}));
  assert.deepEqual(f.segapsg.client._getState(),psg._getState());assert.deepEqual(f.ym2413.client._getState().registers,opll._getState().registers);
});

test('Native Master System Worker dispatch keeps timing, ownership, latch metadata and acknowledgements',async()=>{
  const f=fixture();await f.start();assert.deepEqual(await f.segapsg.dispatch({method:'write',args:[0x25],psgRegister:4,id:1},{time:1,performance:7,owner:9}),{id:1});
  assert.deepEqual(f.commands[0],{type:'master-system',frame:48000,performance:7,owner:9,message:{chip:'segapsg',method:'write',register:0,value:0x25,psgRegister:4}});assert.equal(f.psg.periods[2],0);f.advance(48000);assert.equal(f.psg.periods[2],0x250);
  await f.segapsg.dispatch({method:'clock',args:[3000000],id:'c1'});await f.ym2413.dispatch({method:'clock',args:[4000000],id:'c2'});assert.equal(f.segapsg.client.clock,3000000);assert.equal(f.ym2413.client.clock,4000000);assert(f.events.some(e=>e.name==='psg'));assert(f.events.some(e=>e.name==='opll'));
  const n=f.commands.length;await assert.rejects(f.segapsg.dispatch({method:'setStereo',args:[255]}),/Unsupported/);await assert.rejects(f.segapsg.dispatch({method:'write',args:[300]}),/value/);await assert.rejects(f.ym2413.dispatch({method:'writeRegister',args:[64,0]}),/Register/);assert.equal(f.commands.length,n);
});

test('Master System passive reads expose applied state without replacing projected authoring state',async()=>{
  const f=fixture();await f.start();f.segapsg.client.tone(0,{note:'A4',attenuation:4});f.ym2413.client.setVoice(0,{instrument:4,attenuation:3});const psg=f.segapsg.client._getState(),opll=f.ym2413.client._getState();
  await f.segapsg.dispatch({method:'write',args:[0x9b]},{time:1});await f.ym2413.dispatch({method:'writeRegister',args:[0x30,0x78]},{time:1});assert.equal((await f.segapsg.read()).channels[0].attenuation,4);assert.equal((await f.ym2413.read()).channels[0].instrument,4);f.advance(48000);assert.equal((await f.segapsg.read()).channels[0].attenuation,11);assert.equal((await f.ym2413.read()).channels[0].instrument,7);
  assert.deepEqual(f.segapsg.client._getState(),psg);assert.deepEqual(f.ym2413.client._getState(),opll);assert(f.requests.every(r=>r.command==='native_genesis_master_system_status'));
});

for(let ch=0;ch<4;ch++)test(`Master System PSG channel ${ch} supports manual leases and stale key release`,async()=>{
  const f=fixture();await f.start();await f.segapsg.invoke('setAttenuation',[ch,7]);await f.segapsg.invoke('auditionOn',[ch,69,'old']);const old=f.held.segapsg.get(ch);assert.equal(f.psg.attenuations[ch],7);await f.segapsg.invoke('auditionOn',[ch,72,'new']);assert.notEqual(f.held.segapsg.get(ch),old);const n=f.commands.length;assert.equal(await f.segapsg.invoke('auditionOff',[ch,'old']),false);assert.equal(f.commands.length,n);
  f.segapsg.client._forceKeyOff(ch);await f.segapsg.invoke('auditionOff',[ch,'new']);assert.equal(f.psg.attenuations[ch],15);assert.equal(f.held.segapsg.size,0);assert.equal(f.segapsg.client._getState().attenuations[ch],7);
});

for(let ch=0;ch<9;ch++)test(`Master System OPLL channel ${ch} auditions request an immediate release and deferred key-on`,async()=>{
  const f=fixture();await f.start();await f.ym2413.invoke('setInstrument',[ch,3,6]);await f.ym2413.invoke('auditionOn',[ch,69,'old']);const group=f.commands.at(-1).message;assert.equal(group.action,'on');assert.equal(group.channel,ch);assert.equal(group.commands[0].method,'key-off');assert.equal(group.commands.at(-1).method,'audition-key-on');assert.equal(new Set(group.commands.map(c=>group.voice)).size,1);const old=f.held.ym2413.get(ch);
  await f.ym2413.invoke('auditionOn',[ch,72,'new']);assert.notEqual(f.held.ym2413.get(ch),old);assert.equal(await f.ym2413.invoke('auditionOff',[ch,'old']),false);f.ym2413.client.keyOff(ch);assert(f.opll.registers[0x20+ch]&16);await f.ym2413.invoke('auditionOff',[ch,'new']);assert.equal(f.opll.registers[0x20+ch]&16,0);assert.equal(f.held.ym2413.size,0);
});

test('Master System rhythm drums share physical leases and mode edits release all held drums first',async()=>{
  const f=fixture();await f.start();await assert.rejects(f.ym2413.invoke('auditionOn',['rhythm:0',60,'disabled']),/Enable/);await f.ym2413.invoke('setRhythm',[{enabled:true}]);await f.ym2413.invoke('setRhythmLevels',[{bassDrum:1,snare:2,tom:3,cymbal:4,hiHat:5}]);
  await f.ym2413.invoke('auditionOn',['rhythm:1',60,'snare']);await f.ym2413.invoke('auditionOn',['rhythm:4',60,'hat']);assert.deepEqual([...f.held.ym2413.keys()],[13]);assert.equal(await f.ym2413.invoke('auditionOff',['rhythm:1','snare']),false);
  await f.ym2413.invoke('auditionOn',['rhythm:2',60,'tom']);await f.ym2413.invoke('auditionOn',['rhythm:3',60,'cymbal']);await f.ym2413.invoke('auditionOn',['rhythm:0',60,'bass']);assert.deepEqual([...f.held.ym2413.keys()],[13,12,9]);
  assert.equal((await f.ym2413.read()).keyboardChannels.length,11);const n=f.commands.length;await f.ym2413.invoke('setRhythm',[{enabled:false}]);assert.equal(f.held.ym2413.size,0);assert.deepEqual(f.commands.slice(n, n+3).map(c=>c.message.action),['off','off','off']);assert.equal((await f.ym2413.read()).keyboardChannels.length,9);
});

test('Master System User patch edits remain shared, atomic and synchronize borrowed clients',async()=>{
  const f=fixture();await f.start();await f.ym2413.invoke('setPreset',[0,{userPatch:{feedback:4,operators:[{mul:3,tl:24,ar:14},{mul:2,ar:15}]},attenuation:7}]);await f.ym2413.invoke('setInstrument',[1,0,5]);await f.ym2413.invoke('setUserOperator',[0,{mul:6,waveform:1}]);const state=await f.ym2413.read();assert.equal(state.userPatch.shared,true);assert.equal(state.userPatch.operators[0].mul,6);assert.equal(state.channels[0].instrument,0);assert.equal(state.channels[1].instrument,0);assert.equal(f.ym2413.client.getRegisterSnapshot()[0]&15,6);
  const n=f.commands.length;await assert.rejects(f.ym2413.invoke('setPreset',[2,{userPatch:{operators:[{mul:3},{mul:20}]},attenuation:3}]));assert.equal(f.commands.length,n);
});

test('Master System audition identities are scoped to their channels and all-off releases each lease',async()=>{
  const f=fixture();await f.start();for(let ch=0;ch<4;ch++)await f.segapsg.invoke('auditionOn',[ch,69,'same-id']);for(let ch=0;ch<6;ch++)await f.ym2413.invoke('auditionOn',[ch,69,'same-id']);assert.equal(f.held.segapsg.size,4);assert.equal(f.held.ym2413.size,6);
  await f.segapsg.invoke('auditionAllOff');await f.ym2413.invoke('auditionAllOff');assert.equal(f.held.segapsg.size,0);assert.equal(f.held.ym2413.size,0);assert(f.psg.attenuations.every(v=>v===15));assert(f.opll.registers.slice(0x20,0x29).every(v=>!(v&16)));
});

test('Master System projected PSG clock remains authored while a passive snapshot observes an earlier frame',async()=>{
  const f=fixture();await f.start();await f.segapsg.dispatch({method:'clock',args:[3000000]},{time:1});assert.equal(f.segapsg.client.clock,3000000);assert.equal((await f.segapsg.read()).clock,3579545);assert.equal(f.segapsg.client.clock,3000000);f.advance(48000);assert.equal((await f.segapsg.read()).clock,3000000);
});

test('Master System OPLL clock is read-only and applied snapshots cannot change projected pitch authoring',async()=>{
  const f=fixture();await f.start();assert.throws(()=>{f.ym2413.client.clock=3000000;},TypeError);assert.equal(f.ym2413.client.clock,3579545);
  await f.ym2413.dispatch({method:'clock',args:[4000000]},{time:1});assert.equal(f.ym2413.client.clock,4000000);assert.equal((await f.ym2413.read()).clock,3579545);assert.equal(f.ym2413.client.clock,4000000);const reference=createYm2413Client({postMessage(){},close(){}});reference._adoptClock(4000000);reference.setNote(0,'A4');f.ym2413.client.setNote(0,'A4');assert.deepEqual(f.ym2413.client.getRegisterSnapshot().slice(0x10,0x21),reference.getRegisterSnapshot().slice(0x10,0x21));
  f.advance(48000);assert.equal((await f.ym2413.read()).clock,4000000);assert.equal(f.ym2413.client.clock,4000000);f.ym2413.reset();assert.equal(f.ym2413.client.clock,3579545);
});

for(const method of ['reset','resetAll'])test(`Master System PSG inspector ${method} uses a global reset and retires every held PSG voice`,async()=>{
  const f=fixture();await f.start();f.segapsg.client.tone(2,{period:369,attenuation:5});f.segapsg.client.setNoise({type:'white',rate:'tone3'});await f.ym2413.invoke('auditionOn',[0,69,'opll']);for(let ch=0;ch<4;ch++)await f.segapsg.invoke('auditionOn',[ch,69,'psg'+ch]);f.commands.length=0;
  await f.segapsg.invoke(method);assert.equal(f.commands.length,1);assert.equal(f.commands[0].message.method,'reset');assert.equal(f.commands[0].message.audition,true);assert(f.commands[0].message.id>0);assert.equal(f.held.segapsg.size,0);assert.equal(f.held.ym2413.size,1);assert.deepEqual(f.psg.periods,[0,0,0]);assert.equal(f.psg.mode,0);assert.deepEqual(f.segapsg.client._getState().attenuations,[0,0,0,0]);assert.equal(await f.segapsg.invoke('auditionOff',[0,'psg0']),false);
});

test('Master System OPLL rhythm mode notifications are coalesced and observe the updated authoring shadow',async()=>{
  const f=fixture();await f.start();f.events.length=0;f.ym2413.client.setRhythm({enabled:true});f.ym2413.client.setRhythm({bassDrum:true,hiHat:true});await Promise.resolve();assert.equal(f.events.length,1);assert.equal(f.events[0].name,'opll');assert.equal(f.events[0].state.registers[14],49);
  f.events.length=0;f.ym2413.client.setRhythm({bassDrum:false,hiHat:false});await Promise.resolve();assert.equal(f.events.length,0);
  const state=f.ym2413.client._getState();state.registers[14]=0;f.ym2413.client._adoptState(state);f.ym2413.client._adoptState(state);await Promise.resolve();assert.equal(f.events.length,1);assert.equal(f.events[0].state.registers[14],0);f.events.length=0;f.ym2413.client._adoptState(state);await Promise.resolve();assert.equal(f.events.length,0);
});

test('Master System late rhythm mode notifications cannot cross a stopped generation',async()=>{
  const f=fixture();await f.start();f.events.length=0;f.ym2413.client.setRhythm({enabled:true});f.synth.generation++;await Promise.resolve();assert.equal(f.events.length,0);
});

test('Master System Stop preserves PSG configuration and OPLL patch, rhythm levels and clocks',async()=>{
  const f=fixture();await f.start();f.segapsg.client.tone(2,{period:369,attenuation:5});f.segapsg.client.noise({type:'white',rate:'tone3',attenuation:8});f.ym2413.client.setPreset(0,{userPatch:{feedback:4,operators:[{mul:3}]},attenuation:6});f.ym2413.client.setRhythm({enabled:true,bassDrum:true});f.ym2413.client.setRhythmLevels({hiHat:3,snare:7,tom:4,cymbal:9});await f.segapsg.client.setClock(3000000);await f.ym2413.client.setClock(4000000);const bytes=f.ym2413.client.getRegisterSnapshot().slice(0,8);f.stop();
  assert.equal(f.psg.periods[2],369);assert.equal(f.psg.mode,7);assert.deepEqual(f.psg.attenuations,[15,15,15,15]);assert.equal(f.segapsg.client._getState().attenuations[2],5);assert.equal(f.segapsg.client._getState().attenuations[3],8);assert.equal(f.segapsg.client.clock,3000000);assert.equal(f.ym2413.client.clock,4000000);assert.deepEqual(f.ym2413.client.getRegisterSnapshot().slice(0,8),bytes);assert.equal(f.opll.registers[14],32);assert.equal(f.opll.registers[0x37],0x37);assert.equal(f.opll.registers[0x38],0x49);f.segapsg.client.keyOn(2);assert.equal(f.psg.attenuations[2],5);
});

test('Master System Stop retires cancelled future PSG attenuation from Worker authoring state',async()=>{
  const f=fixture();await f.start();f.segapsg.client.setAttenuation(0,5);await f.segapsg.dispatch({method:'write',args:[0x92]},{time:1});const projected=f.segapsg.client._getState();projected.attenuations[0]=2;f.segapsg.client._adoptState(projected);
  assert.equal((await f.segapsg.read()).channels[0].attenuation,5);assert.equal(f.segapsg.client._getState().attenuations[0],2);f.stop();assert.equal(f.psg.attenuations[0],15);assert.equal(f.segapsg.client._getState().attenuations[0],5);f.segapsg.client.keyOn(0);f.advance(48000);assert.equal(f.psg.attenuations[0],5);
});

test('Master System Native Stop remembers the last audible PSG level after an explicit silent attenuation',async()=>{
  const f=fixture();await f.start();f.segapsg.client.setAttenuation(0,5);f.segapsg.client.setAttenuation(0,15);assert.equal(f.segapsg.client._getState().attenuations[0],15);f.stop();assert.equal(f.psg.attenuations[0],15);assert.equal(f.segapsg.client._getState().attenuations[0],5);f.segapsg.client.keyOn(0);assert.equal(f.psg.attenuations[0],5);
});

test('Master System mixer settings reach Native before endpoint initialization',async()=>{
  const f=fixture();await f.segapsg.mix(.3,-.2);await f.ym2413.mix(.7,.4);assert.deepEqual(f.commands.map(c=>c.message),[{chip:'segapsg',method:'mix',volume:.3,pan:-.2},{chip:'ym2413',method:'mix',volume:.7,pan:.4}]);const n=f.commands.length;await assert.rejects(f.segapsg.mix(NaN));await assert.rejects(f.ym2413.mix(1,2));assert.equal(f.commands.length,n);
});

for(const cancellation of ['generation','session','owner'])test(`Master System asynchronous controls fence ${cancellation} cancellation`,async()=>{
  const f=fixture();await f.start();let retired=false;f.setFlushHook(()=>{if(cancellation==='owner')retired=true;else f.synth[cancellation]++;});await assert.rejects(f.segapsg.dispatch({method:'clock',args:[3000000]},{checkCurrent(){if(retired)throw new DOMException('Retired','AbortError');}}),{name:'AbortError'});assert.equal(f.segapsg.client.clock,3579545);
});

test('Master System validates observational snapshots and resets without replaying audio',async()=>{
  const f=fixture();await f.start();f.setStatusHook(()=>{const s=f.snapshot();s.segapsg.periods=[1024,0,0];return s;});await assert.rejects(f.segapsg.read(),/snapshot/);f.setStatusHook(()=>{const s=f.snapshot();s.ym2413.registers[0]=256;return s;});await assert.rejects(f.ym2413.read(),/snapshot/);f.setStatusHook(null);const n=f.commands.length;f.segapsg.reset();f.ym2413.reset();assert.equal(f.commands.length,n);assert.equal(f.ym2413.client._getState().initialized,false);assert.deepEqual(f.ym2413.client._getState().registers,Array(64).fill(0));
});
