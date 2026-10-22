import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisYm2203} from './native_genesis_ym2203.js';
import {YM2203Synth} from './ym2203synth.js';

const HELD_CLOCK_ERROR='Release the manually held YM2203 voices before changing the clock';
async function until(predicate){const deadline=Date.now()+1000;while(!predicate()){if(Date.now()>deadline)throw new Error('YM2203 command did not start');await new Promise(resolve=>setTimeout(resolve,1));}}
function fixture(){
  const commands=[],requests=[],events=[],future=[],held=new Map(),refused=new Set();let frame=0,flushHook,statusHook;
  const state={clock:4000000,registers:[Array(256).fill(0)],keyMasks:[0,0,0],ssgLevels:[0,0,0],ssgGates:[false,false,false],prescaler:6,status:0,irq:false,sourceMuteMask:0,channelMuteMask:0};
  const off=ch=>{if(ch<3)state.keyMasks[ch]=0;else{state.registers[0][8+ch-3]=0;state.ssgGates[ch-3]=false;}};
  function apply(m,bypass=false){const r=state.registers[0];
    if(m.method==='batch'){if(m.action==='off'&&held.get(m.channel)!==m.voice)return;if(m.action==='on')held.set(m.channel,m.voice);for(const c of m.commands)apply(c,true);if(m.action==='off')held.delete(m.channel);return;}
    if(m.method==='write'){
      const ch=m.register===0x28?m.value&3:m.register<6?3+(m.register>>1):m.register>=8&&m.register<=10?3+m.register-8:m.register>=0x30&&m.register<=0xb6&&(m.register&3)<3?m.register&3:null;
      if(!bypass&&ch!==null&&held.has(ch))return;
      r[m.register]=m.value;
      if(m.register===0x28&&(m.value&3)<3)state.keyMasks[m.value&3]=m.value>>4;
      if(m.register>=8&&m.register<=10){state.ssgGates[m.register-8]=!!(m.value&31);if(m.value&31)state.ssgLevels[m.register-8]=m.value&31;}
      if(m.register>=0x2d&&m.register<=0x2f)state.prescaler=[6,3,2][m.register-0x2d];
    }else if(m.method==='set-retained-level'){if(bypass||!held.has(3+m.channel))state.ssgLevels[m.channel]=m.level;}
    else if(m.method==='key-off'){if(bypass||!held.has(m.channel))off(m.channel);}
    else if(m.method==='clock'){if(held.size)refused.add(m.id);else state.clock=m.hz;}
    else if(m.method==='reset'){held.clear();r.fill(0);state.keyMasks.fill(0);state.ssgLevels.fill(0);state.ssgGates.fill(false);state.prescaler=6;}
    else if(m.method==='stop-voices'){held.clear();for(let ch=0;ch<6;ch++)off(ch);}
  }
  const snapshot=()=>({...structuredClone(state),held:[...held.keys()],pendingCommands:future.flatMap(c=>c.message.id?[c.message.id]:[]),frame,sampleRate:48000,revision:commands.length});
  const synth={session:1,generation:1,clock:{sampleRate:48000},stopping:null,closing:false,isReady:()=>true,frameAt:t=>Math.round(t*48000),enqueue(c){assert.equal(c.type,'ym2203');if(c.message.method==='clock'&&held.size)throw new Error(HELD_CLOCK_ERROR);commands.push(c);if(c.frame>frame)future.push(c);else apply(c.message);},async flush(){if(flushHook)await flushHook();},async nativeRequest(command,args){requests.push({command,args});if(args?.after)while(future.some(c=>c.message.id===args.after))await new Promise(resolve=>setTimeout(resolve,1));if(refused.has(args?.after))throw new Error(HELD_CLOCK_ERROR);return statusHook?statusHook():snapshot();},emit:e=>events.push(e)};
  const adapter=createNativeGenesisYm2203(synth);return {adapter,client:adapter.client,synth,state,held,commands,requests,events,snapshot,setFlushHook:h=>{flushHook=h;},setStatusHook:h=>{statusHook=h;},async start(){await adapter.initialize();commands.length=0;},advance(to){frame=to;for(let i=0;i<future.length;)if(future[i].frame<=frame)apply(future.splice(i,1)[0].message);else i++;},stop(){future.length=0;apply({method:'stop-voices'});adapter.adoptStopped(snapshot());}};
}

test('Native YM2203 constructs only three FM and three SSG voices with mono capabilities',async()=>{
  const f=fixture();assert.equal(f.commands.length,0);assert.equal(f.client.id,'ym2203');assert.equal(f.client.channelCount,3);assert.equal(f.client.portCount,1);assert.equal(f.client.ssg.clock,2000000);assert.equal(f.client.supportsPan,false);assert.equal(f.client.supportsLfo,false);assert.equal(f.client.rhythm,undefined);assert.equal(f.client.adpcm,undefined);
  assert.throws(()=>f.client.setPan(0,true,false),/stereo pan/);assert.throws(()=>f.client.setLfo(true,1),/LFO/);assert.throws(()=>f.client.noteOn(3,'A4'));assert.throws(()=>{f.client.clock=3000000;},TypeError);await f.start();await f.adapter.initialize();assert.equal(f.commands.length,0);
});

test('Native YM2203 bus authoring matches Web FM/SSG and CH3-special writes',async()=>{
  const f=fixture();await f.start();const writes=[],web=new YM2203Synth({transport:{write:(port,register,value)=>writes.push({method:'write',port,register,value}),reset:()=>writes.push({method:'reset'})}});writes.length=0;
  function program(api){for(let ch=0;ch<3;ch++){api.setAlgo(ch,7,ch);api.setOperator(ch,1,{multi:3,tl:19,ar:31,rr:9});api.noteOn(ch,'A4');api.keyOff(ch);}api.setChannel3SpecialMode(true);for(let op=0;op<4;op++)api.setChannel3SpecialFrequency(op,4,400+op);api.ssg.tone(0,{frequency:440,volume:7});api.ssg.keyOff(0);api.ssg.keyOn(0);api.ssg.noise(1,{period:13,volume:9,envelope:true});api.ssg.setEnvelope({period:333,shape:10});api.write(0,0x2e,0);}
  program(web);program(f.client);assert.deepEqual(f.commands.filter(c=>c.message.method==='write').map(c=>c.message),writes);assert.deepEqual(f.client.getState(),web.getState());assert.deepEqual(f.client.ssg._getState(),web.ssg._getState());assert.equal(f.state.prescaler,3);
});

test('Native YM2203 retained SSG metadata distinguishes keyOff, explicit zero and raw zero',async()=>{
  const f=fixture();await f.start();f.client.ssg.setVolume(0,9);f.client.ssg.keyOff(0);assert.equal(f.state.ssgLevels[0],9);assert.equal(f.client.ssg._getState().levels[0],9);f.client.ssg.keyOn(0);assert.equal(f.state.registers[0][8],9);
  f.client.ssg.setVolume(0,0);assert.equal(f.state.ssgLevels[0],0);f.client.ssg.keyOn(0);assert.equal(f.state.registers[0][8],0);f.client.ssg.setVolume(0,7);f.client.write(0,8,0);assert.equal(f.state.ssgLevels[0],0);f.client.ssg.keyOn(0);assert.equal(f.state.registers[0][8],0);
  const levels=f.commands.filter(c=>c.message.method==='set-retained-level').map(c=>c.message.level);assert.deepEqual(levels,[9,0,7,0]);
});

test('Native YM2203 validates complete mixed Worker batches before any writes',async()=>{
  const f=fixture();await f.start();await assert.rejects(f.adapter.dispatch([{type:'write',port:0,register:0xa0,value:77},{type:'write',port:1,register:0xa0,value:88}]));assert.equal(f.commands.length,0);
  await f.adapter.dispatch([{type:'write',port:0,register:8,value:0},{type:'ssg-retained-level',channel:0,level:0}],{time:1,performance:7,owner:4});assert(f.commands.every(c=>c.frame===48000&&c.performance===7&&c.owner===4));
  const before=f.commands.length;await assert.rejects(f.adapter.dispatch({type:'ssg-retained-level',channel:3,level:0}));assert.equal(f.commands.length,before);
});

test('Native YM2203 passive snapshots cannot roll back authored FM/SSG state',async()=>{
  const f=fixture();await f.start();f.client.setAlgo(2,7,3);f.client.ssg.setVolume(2,9);const author=f.client._getState();await f.adapter.dispatch({type:'write',port:0,register:0xb2,value:1},{time:1});assert.equal((await f.adapter.read()).fmState.channels[2].algorithm,7);f.advance(48000);assert.equal((await f.adapter.read()).fmState.channels[2].algorithm,1);assert.deepEqual(f.client._getState(),author);
});

for(const name of ['fm:0','fm:1','fm:2','ssg:0','ssg:1','ssg:2'])test(`Native YM2203 ${name} manual lease replacement rejects stale release`,async()=>{
  const f=fixture();await f.start();const channel=name.startsWith('fm')?Number(name.slice(3)):3+Number(name.slice(4));if(channel>=3)f.client.ssg.setVolume(channel-3,7);
  await f.adapter.invoke('auditionOn',[name,69,'old']);const old=f.held.get(channel);await f.adapter.invoke('auditionOn',[name,72,'new']);assert.notEqual(f.held.get(channel),old);const before=f.commands.length;await f.adapter.invoke('auditionOff',[name,'old']);assert.equal(f.commands.length,before);await f.adapter.invoke('auditionOff',[name,'new']);assert.equal(f.held.size,0);if(channel<3)assert.equal(f.state.keyMasks[channel],0);else assert.equal(f.state.ssgGates[channel-3],false);
});

test('Native YM2203 read advertises six Keyboard voices, raw data and async status without bus replay',async()=>{
  const f=fixture();await f.start();f.state.status=3;f.state.irq=true;assert.equal(await f.client.readStatus(),3);assert.equal(await f.client.getIrq(),true);assert.equal((await f.adapter.read()).keyboardChannels.length,6);assert.equal(f.commands.length,0);await assert.rejects(f.client.read(1),/status/);assert(f.requests.every(r=>r.command==='native_genesis_ym2203_status'));
});

test('Native YM2203 Stop retains SSG routing, envelope, explicit zero, clock and FM patches',async()=>{
  const f=fixture();await f.start();f.client.ssg.noise(0,{period:13,volume:7,envelope:true});f.client.ssg.setEnvelope({period:333,shape:10});f.client.ssg.setVolume(1,0);f.client.ssg.keyOff(0);f.client.setAlgo(2,5,3);await f.client.setClock(3000000);f.stop();assert.equal(f.state.registers[0][6],13);assert.deepEqual(f.state.registers[0].slice(11,14),[77,1,10]);assert.deepEqual(f.client.ssg._getState().levels,[16,0,0]);assert.equal(f.client.clock,3000000);assert.equal(f.client.ssg.clock,1500000);assert.equal(f.client.getState().channels[2].algorithm,5);f.client.ssg.keyOn(0);assert.equal(f.state.registers[0][8],16);f.client.ssg.keyOn(1);assert.equal(f.state.registers[0][9],0);
});

test('Native YM2203 SSG preview fallback does not change an authored silent level',async()=>{
  const f=fixture();await f.start();f.client.ssg.setVolume(0,0);await f.adapter.invoke('auditionOn',['ssg:0',69,'preview']);assert.equal(f.state.registers[0][8],12);assert.equal(f.state.ssgLevels[0],0);await f.adapter.invoke('auditionOff',['ssg:0','preview']);f.stop();assert.equal(f.client.ssg._getState().levels[0],0);f.client.ssg.keyOn(0);assert.equal(f.state.registers[0][8],0);
});

test('Native YM2203 observer-only transport adoption cannot echo retained-level commands',async()=>{
  const f=fixture();await f.start();f.client.ssg.setVolume(0,7);const count=f.commands.length,transport=f.client.transport;f.client.transport={write(){},reset(){}};try{f.client.write(0,8,0);f.client.ssg.setVolume(1,9);f.client.reset();}finally{f.client.transport=transport;}assert.equal(f.commands.length,count);f.client.ssg.setVolume(0,5);assert(f.commands.some(c=>c.message.method==='set-retained-level'&&c.message.level===5));
});

test('Native YM2203 applied-clock barriers keep authoring unchanged before their scheduled frame',async()=>{
  const f=fixture();await f.start();const pending=f.adapter.dispatch({type:'chip-clock',clock:3000000,id:'clock'},{time:1,owner:4,performance:7});await until(()=>f.commands.some(c=>c.message.method==='clock'));assert.equal(f.client.clock,4000000);assert.equal(f.client.ssg.clock,2000000);f.advance(48000);assert.deepEqual(await pending,{type:'chip-clock-result',id:'clock',clock:3000000});assert.equal(f.client.clock,3000000);assert.equal(f.client.ssg.clock,1500000);
});

for(const name of ['fm:0','ssg:0'])test(`Native YM2203 clock rejects while ${name} is held without losing author state`,async()=>{
  const f=fixture();await f.start();await f.adapter.invoke('auditionOn',[name,69,'held']);await assert.rejects(f.client.setClock(3000000),/held/);assert.equal(f.client.clock,4000000);await f.adapter.invoke('auditionOff',[name,'held']);await f.client.setClock(3000000);assert.equal(f.client.clock,3000000);
});

test('Native YM2203 initialization, reset and Stop never replay stale audition writes',async()=>{
  const f=fixture();await f.start();await f.adapter.invoke('auditionOn',['fm:0',69,'held']);const before=f.commands.length;f.adapter.stopped();f.adapter.reset();assert.equal(f.commands.length,before);assert.equal(f.client.clock,4000000);assert.deepEqual(f.client.ssg._getState().levels,[0,0,0]);
});

test('Native YM2203 all-off releases six independent audition identities in separate batches',async()=>{
  const f=fixture();await f.start();for(const name of ['fm:0','fm:1','fm:2','ssg:0','ssg:1','ssg:2'])await f.adapter.invoke('auditionOn',[name,69,'same-id']);assert.equal(f.held.size,6);const before=f.commands.length;await f.adapter.invoke('auditionAllOff');assert.equal(f.held.size,0);assert.deepEqual(f.state.keyMasks,[0,0,0]);assert.deepEqual(f.state.ssgGates,[false,false,false]);const groups=f.commands.slice(before).map(c=>c.message);assert.equal(groups.length,6);assert(groups.every(m=>m.action==='off'&&m.voice>0));assert.equal(new Set(groups.map(m=>m.id)).size,6);
});

for(const hz of [4000000,3000000])test(`Native YM2203 scheduled clock ${hz} reports a manual hold acquired after admission`,async()=>{
  const f=fixture();await f.start();const pending=f.adapter.dispatch({type:'chip-clock',clock:hz},{time:1}),rejected=assert.rejects(pending,/held/);await until(()=>f.commands.some(c=>c.message.method==='clock'));await f.adapter.invoke('auditionOn',['fm:0',69,'late']);f.advance(48000);await rejected;assert.equal(f.client.clock,4000000);assert.equal(f.client.ssg.clock,2000000);
});

for(const cancellation of ['generation','session','owner'])test(`Native YM2203 asynchronous clock fences ${cancellation} cancellation`,async()=>{
  const f=fixture();await f.start();let retired=false;f.setFlushHook(()=>{if(cancellation==='owner')retired=true;else f.synth[cancellation]++;});await assert.rejects(f.adapter.dispatch({type:'chip-clock',clock:3000000},{checkCurrent(){if(retired)throw new DOMException('Retired','AbortError');}}),{name:'AbortError'});assert.equal(f.client.clock,4000000);
});
