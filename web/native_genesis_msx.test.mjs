import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createNativeGenesisMsx} from './native_genesis_msx.js';
import {createAy8910Client} from './playground_ay8910.js';
import {createYm2413Client} from './playground_ym2413.js';

const physical=ch=>ch>=9?[6,7,8,8,7][ch-9]:ch;
function fixture(){
  const commands=[],requests=[],events=[],future=[],held={ym2413:new Map(),ay8910:new Map()};let frame=0,flushHook,statusHook;
  const opll={clock:3579545,registers:Array(64).fill(0),status:0,irq:false,sourceMuteMask:0};
  const ay={clock:1789773,registers:Array(16).fill(0),levels:[9,9,9],gates:[false,false,false],sourceMuteMask:7};
  function off(chip,ch){if(chip==='ay8910'){ay.registers[8+ch]=0;ay.gates[ch]=false;}else if(ch<9)opll.registers[0x20+ch]&=239;else opll.registers[14]&=~(16>>(ch-9));}
  function apply(m,bypass=false){const state=m.chip==='ay8910'?ay:opll,map=held[m.chip];
    if(m.method==='batch'){
      assert(m.commands.every(c=>['write','key-off','audition-key-on','set-retained-level','clock'].includes(c.method)));
      if(m.action==='off'&&map.get(m.channel)!==m.voice)return;
      if(m.action==='on'){for(const ch of [...map.keys()])if(m.chip==='ay8910'?ch===m.channel:physical(ch)===physical(m.channel)){off(m.chip,ch);map.delete(ch);}map.set(m.channel,m.voice);}
      for(const c of m.commands)apply({...c,chip:m.chip},true);if(m.action==='off')map.delete(m.channel);return;
    }
    if(m.method==='write'){
      const r=m.register,ch=state===ay?r<6?Math.floor(r/2):r>=8&&r<=10?r-8:null:r>=0x10&&r<=0x18?r-0x10:r>=0x20&&r<=0x28?r-0x20:r>=0x30&&r<=0x38?r-0x30:null;
      if(!bypass&&[...map.keys()].some(key=>state===ay?(ch===key||r===7||r===6&&!(ay.registers[7]&(8<<key))||r>=11&&r<=13&&!!(ay.registers[8+key]&16)):(r<8||r===14||physical(key)===ch)))return;
      state.registers[r]=m.value;
      if(state===ay&&r>=8&&r<=10){ay.gates[r-8]=!!(m.value&31);if(m.value&31)ay.levels[r-8]=m.value&31;}
    }else if(m.method==='set-retained-level'){if(bypass||!map.has(m.channel))ay.levels[m.channel]=m.level;}
    else if(m.method==='key-off'){if(bypass||!map.has(m.channel))off(m.chip,m.channel);}
    else if(m.method==='audition-key-on'){if(m.channel<9)opll.registers[0x20+m.channel]|=16;else opll.registers[14]|=16>>(m.channel-9);}
    else if(m.method==='clock')state.clock=m.hz;
    else if(m.method==='reset'){map.clear();state.registers.fill(0);if(state===ay){ay.levels.fill(9);ay.gates.fill(false);}}
    else if(m.method==='stop-voices'){map.clear();for(let ch=0;ch<(state===ay?3:9);ch++)off(m.chip,ch);if(state===opll)opll.registers[14]&=224;}
  }
  const snapshot=()=>({sampleRate:48000,frame,revision:commands.length,...Object.fromEntries([['ym2413',opll],['ay8910',ay]].map(([chip,state])=>[chip,{...structuredClone(state),held:[...held[chip].keys()],pendingCommands:future.flatMap(c=>c.message.chip===chip&&c.message.id?[c.message.id]:[])}]))});
  const synth={session:1,generation:1,clock:{sampleRate:48000},stopping:null,closing:false,isReady:()=>true,frameAt:t=>Math.round(t*48000),enqueue(c){commands.push(c);if(c.frame>frame)future.push(c);else apply(c.message);},async flush(){if(flushHook)await flushHook();},async nativeRequest(command,args){requests.push({command,args});return statusHook?statusHook():snapshot();},emit:e=>events.push(e)};
  const endpoints=createNativeGenesisMsx(synth);
  return {...endpoints,synth,commands,requests,events,opll,ay,held,snapshot,setFlushHook:h=>{flushHook=h;},setStatusHook:h=>{statusHook=h;},async start(){for(const e of Object.values(endpoints))await e.initialize();commands.length=0;},advance(to){frame=to;for(let i=0;i<future.length;)if(future[i].frame<=frame)apply(future.splice(i,1)[0].message);else i++;},stop(){future.length=0;for(const [chip,e]of Object.entries(endpoints)){apply({chip,method:'stop-voices'});e.adoptStopped(snapshot()[chip]);}}};
}

test('MSX creates precisely OPLL and AY authoring endpoints without opening audio',async()=>{
  const f=fixture();assert.equal(f.commands.length,0);assert.deepEqual([f.ym2413.client.id,f.ay8910.client.id],['ym2413','ay8910']);assert.equal(f.ym2413.client.clock,3579545);assert.equal(f.ay8910.client.clock,1789773);assert.throws(()=>{f.ay8910.client.clock=2000000;},TypeError);
  await f.start();await f.ay8910.initialize();await f.ym2413.initialize();assert.equal(f.commands.length,0);assert.equal(f.ay.registers[7],56);assert.deepEqual(f.ay.levels,[9,9,9]);assert.deepEqual(f.ay.gates,[false,false,false]);assert(f.opll.registers.slice(0x30,0x39).every(v=>v===31));
});

test('Native AY Main authoring exactly matches the Web client including retained-level metadata',async()=>{
  const f=fixture();await f.start();const writes=[],api=createAy8910Client({postMessage:m=>writes.push(m),close(){}});api.initialize();writes.length=0;
  function program(a){for(let ch=0;ch<3;ch++){a.tone(ch,{note:'A4',volume:ch+5});a.keyOff(ch);a.keyOn(ch);a.setVolume(ch,0);a.keyOn(ch);a.noise(ch,{period:ch+4,volume:ch+7,envelope:ch===2});}a.setMixer(0,{tone:true,noise:true});a.setEnvelope({period:100,shape:10});a.setEnvelope({shape:10});a.setVoice(1,{envelope:true,volume:4,note:'E4'});a.allNotesOff();}
  program(api);program(f.ay8910.client);
  assert.deepEqual(f.commands.map(c=>c.message),writes.map(m=>m.method==='writeRegister'?{chip:'ay8910',method:'write',register:m.args[0],value:m.args[1]}:{chip:'ay8910',method:'set-retained-level',channel:m.args[0],level:m.args[1]}));assert.deepEqual(f.ay8910.client._getState(),api._getState());assert.equal(f.commands.filter(c=>c.message.register===13).length,2);
});

test('MSX scheduled writes keep chip ownership, frame timing and applied snapshots separate',async()=>{
  const f=fixture();await f.start();const before=f.ay8910.client._getState();assert.deepEqual(await f.ay8910.dispatch({method:'writeRegister',args:[8,12],id:'ay'},{time:1,owner:4,performance:7}),{id:'ay'});
  assert.deepEqual(f.commands[0],{type:'msx',frame:48000,owner:4,performance:7,message:{chip:'ay8910',method:'write',register:8,value:12}});assert.equal((await f.ay8910.read()).channels[0].volume,0);f.advance(48000);assert.equal((await f.ay8910.read()).channels[0].volume,12);assert.deepEqual(f.ay8910.client._getState(),before);assert(f.requests.every(r=>r.command==='native_genesis_msx_status'));
});

for(let ch=0;ch<3;ch++)test(`MSX AY channel ${ch} supports manual audition replacement and stale release`,async()=>{
  const f=fixture();await f.start();await f.ay8910.invoke('setVoice',[ch,{volume:7,tone:true,noise:false}]);await f.ay8910.invoke('auditionOn',[ch,69,'old']);const old=f.held.ay8910.get(ch);assert.equal(f.ay.registers[8+ch],7);assert.equal((await f.ay8910.read()).channels[ch].active,true);
  await f.ay8910.invoke('auditionOn',[ch,72,'new']);assert.notEqual(f.held.ay8910.get(ch),old);const n=f.commands.length;assert.equal(await f.ay8910.invoke('auditionOff',[ch,'old']),false);assert.equal(f.commands.length,n);f.ay8910.client.keyOff(ch);assert.equal(f.ay.registers[8+ch],7);await f.ay8910.invoke('auditionOff',[ch,'new']);assert.equal(f.ay.registers[8+ch],0);assert.equal(f.ay.levels[ch],7);assert.equal(f.held.ay8910.size,0);
});

test('MSX explicit AY zero is retained through inspector edits, Stop and later keyOn',async()=>{
  const f=fixture();await f.start();await f.ay8910.invoke('setVolume',[0,0]);assert.equal(f.ay.levels[0],0);assert.equal(f.ay8910.client._getState().levels[0],0);await f.ay8910.invoke('auditionOn',[0,69,'zero']);assert.equal(f.ay.registers[8],0);f.stop();f.ay8910.client.keyOn(0);assert.equal(f.ay.registers[8],0);assert.equal(f.ay.levels[0],0);
});

test('MSX AY auditions retain noise-only routing and share the authored envelope',async()=>{
  const f=fixture();await f.start();f.ay8910.client.noise(1,{period:13,volume:9,envelope:true});f.ay8910.client.setEnvelope({period:333,shape:14});await f.ay8910.invoke('auditionOn',[1,69,'noise']);assert.equal(f.ay.registers[7]&(1<<1),2);assert.equal(f.ay.registers[7]&(8<<1),0);assert.equal(f.ay.registers[6],13);assert.equal(f.ay.registers[9],25);const view=await f.ay8910.read();assert.equal(view.channels[1].toneEnabled,false);assert.equal(view.channels[1].noiseEnabled,true);assert.equal(view.channels[1].configuredEnvelope,true);assert.equal(view.envelope.period,333);assert.equal(view.envelope.shape,14);
});

test('MSX AY clock edits are read-only authoring metadata until their native frame applies',async()=>{
  const f=fixture();await f.start();await f.ay8910.dispatch({method:'clock',args:[2000000]},{time:1});assert.equal(f.ay8910.client.clock,2000000);assert.equal((await f.ay8910.read()).clock,1789773);const expected=createAy8910Client({postMessage(){},close(){}});expected._adoptClock(2000000);expected.setNote(0,'A4');f.ay8910.client.setNote(0,'A4');assert.deepEqual(f.ay8910.client.getRegisterSnapshot().slice(0,2),expected.getRegisterSnapshot().slice(0,2));f.advance(48000);assert.equal((await f.ay8910.read()).clock,2000000);f.ay8910.reset();assert.equal(f.ay8910.client.clock,1789773);
});

test('MSX OPLL retains the shared User patch and rhythm physical-voice ownership',async()=>{
  const f=fixture();await f.start();await f.ym2413.invoke('setPreset',[0,{userPatch:{feedback:5,operators:[{mul:3,ar:14},{mul:1,ar:15}]},attenuation:4}]);await f.ym2413.invoke('setInstrument',[1,0,6]);await f.ym2413.invoke('setUserOperator',[0,{mul:7}]);assert.equal((await f.ym2413.read()).userPatch.operators[0].mul,7);assert.equal(f.ym2413.client.getRegisterSnapshot()[0]&15,7);
  await f.ym2413.invoke('setRhythm',[{enabled:true}]);await f.ym2413.invoke('auditionOn',['rhythm:1',60,'snare']);await f.ym2413.invoke('auditionOn',['rhythm:4',60,'hat']);assert.deepEqual([...f.held.ym2413.keys()],[13]);assert.equal(await f.ym2413.invoke('auditionOff',['rhythm:1','snare']),false);assert.equal((await f.ym2413.read()).keyboardChannels.length,11);await f.ym2413.invoke('setRhythm',[{enabled:false}]);assert.equal(f.held.ym2413.size,0);assert.equal((await f.ym2413.read()).keyboardChannels.length,9);
});

test('MSX OPLL layout notification follows mode changes and never ordinary drum gates',async()=>{
  const f=fixture();await f.start();f.events.length=0;f.ym2413.client.setRhythm({enabled:true});f.ym2413.client.setRhythm({bassDrum:true});await Promise.resolve();assert.equal(f.events.length,1);assert.equal(f.events[0].name,'opll');assert.equal(f.events[0].state.registers[14],48);f.events.length=0;f.ym2413.client.setRhythm({bassDrum:false});await Promise.resolve();assert.equal(f.events.length,0);
});

test('MSX Stop clears gates and leases while retaining clocks, mixer routing and configured levels',async()=>{
  const f=fixture();await f.start();f.ay8910.client.noise(0,{period:13,volume:7,envelope:true});f.ay8910.client.setEnvelope({period:333,shape:10});f.ay8910.client.setVolume(1,0);await f.ay8910.invoke('auditionOn',[0,69,'ay']);await f.ym2413.invoke('auditionOn',[0,69,'opll']);await f.ay8910.client.setClock(2000000);await f.ym2413.client.setClock(4000000);const mixer=f.ay.registers[7];f.stop();assert.deepEqual(f.ay.registers.slice(8,11),[0,0,0]);assert.equal(f.ay.registers[7],mixer);assert.equal(f.ay.registers[6],13);assert.deepEqual(f.ay.registers.slice(11,14),[77,1,10]);assert.deepEqual(f.ay8910.client._getState().levels,[23,0,9]);assert.equal(f.ay8910.client.clock,2000000);assert.equal(f.ym2413.client.clock,4000000);assert.equal(f.held.ay8910.size,0);assert.equal(f.held.ym2413.size,0);f.ay8910.client.keyOn(0);assert.equal(f.ay.registers[8],23);
});

test('MSX independent mix settings are delivered before either endpoint initializes',async()=>{
  const f=fixture();await f.ym2413.mix(.3,-.2);await f.ay8910.mix(.7,.4);assert.deepEqual(f.commands.map(c=>c.message),[{chip:'ym2413',method:'mix',volume:.3,pan:-.2},{chip:'ay8910',method:'mix',volume:.7,pan:.4}]);const n=f.commands.length;await assert.rejects(f.ay8910.mix(NaN));await assert.rejects(f.ym2413.mix(1,2));assert.equal(f.commands.length,n);
});

test('MSX malformed writes, invalid retained levels and snapshots are rejected without audio replay',async()=>{
  const f=fixture();await f.start();await assert.rejects(f.ay8910.dispatch({method:'writeRegister',args:[16,0]}),/Register/);await assert.rejects(f.ay8910.dispatch({method:'setRetainedLevel',args:[0,32]}),/Retained/);await assert.rejects(f.ym2413.dispatch({method:'writeRegister',args:[64,0]}),/Register/);assert.equal(f.commands.length,0);f.setStatusHook(()=>{const s=f.snapshot();s.ay8910.levels=[0,32,9];return s;});await assert.rejects(f.ay8910.read(),/snapshot/);f.setStatusHook(null);const n=f.commands.length;f.ay8910.reset();f.ym2413.reset();assert.equal(f.commands.length,n);assert.equal(f.ay8910.client._getState().initialized,false);
});

for(const cancellation of ['generation','session','owner'])test(`MSX asynchronous controls reject ${cancellation} cancellation`,async()=>{
  const f=fixture();await f.start();let retired=false;f.setFlushHook(()=>{if(cancellation==='owner')retired=true;else f.synth[cancellation]++;});await assert.rejects(f.ay8910.dispatch({method:'clock',args:[2000000]},{checkCurrent(){if(retired)throw new DOMException('Retired','AbortError');}}),{name:'AbortError'});assert.equal(f.ay8910.client.clock,1789773);
});

test('MSX real Worker MessagePorts preserve existing clients, ordered clocks and retained-level commands',async()=>{
  const f=fixture();await f.start();const ports=[],work=[];
  function connect(chip,create){const {port1,port2}=new MessageChannel();ports.push(port1,port2);port2.on('message',message=>{const p=f[chip].dispatch(message,{time:.5,performance:3,owner:9}).then(result=>{if(result)port2.postMessage(result);});work.push(p);});return create(port1);}
  const ay=connect('ay8910',createAy8910Client),opll=connect('ym2413',createYm2413Client);
  try{ay.noise(0,{period:12,volume:6});ay.keyOff(0);ay.setVolume(1,0);opll.setVoice(0,{instrument:4,attenuation:3});await Promise.all([ay.setClock(2000000),opll.setClock(4000000)]);await Promise.all(work);assert.equal(ay.clock,2000000);assert.equal(opll.clock,4000000);assert(f.commands.every(c=>c.type==='msx'&&c.frame===24000&&c.owner===9&&c.performance===3));assert(f.commands.some(c=>c.message.method==='set-retained-level'&&c.message.channel===1&&c.message.level===0));assert.equal(f.ay.clock,1789773);f.advance(24000);assert.equal(f.ay.clock,2000000);assert.equal(f.opll.clock,4000000);assert.equal(f.ay.levels[1],0);assert.equal(f.ay.registers[8],0);assert.equal(f.ay.registers[7]&1,1);assert.equal(f.ay.registers[7]&8,0);}finally{for(const p of ports)p.close();}
});
