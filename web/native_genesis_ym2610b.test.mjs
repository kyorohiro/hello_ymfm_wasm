import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisYm2610B} from './native_genesis_ym2610b.js';
import {YM2610BSynth, YM2610BAdpcmBSynth, NeoGeoFMSynth} from './ym2610bsynth.js';
import {encodeAdpcmB} from './adpcm_b_sample.js';

function fixture({variant=true}={}){
  const commands=[],requests=[],future=[],registers=[Array(256).fill(0),Array(256).fill(0)],manual=new Map(),memory=[new Map(),new Map()],loaded=[0,0];
  let frame=0,clock=8000000,flushHook=null,statusHook=null;
  function apply(message,bypass=false){
    if(message.method==='batch'){
      if(message.action==='off'&&manual.get(message.channel)!==message.voice)return;
      if(message.action==='on')manual.set(message.channel,message.voice);
      for(const command of message.commands)apply(command,true);
      if(message.action==='off')manual.delete(message.channel);
    }else if(message.method==='write'){
      let {port,register,value}=message;
      if(!bypass){
        if(port===0&&register===0x28){const code=value&7,ch=(code&3)+(code&4?3:0);if(manual.has(ch))return;}
        if(((register>=0xa0&&register<=0xa2)||(register>=0xa4&&register<=0xa6))&&manual.has(port*3+(register&3)))return;
        if(port===0&&register<6&&manual.has(6+(register>>1)))return;
        if(port===0&&register===7)for(let ch=0;ch<3;ch++)if(manual.has(6+ch)){const mask=(1<<ch)|(8<<ch);value=(value&~mask)|(registers[0][7]&mask);}
        if(port===0&&register>=8&&register<=10&&manual.has(register-2)&&!(value&31))return;
        if(port===1&&register===0)for(let ch=0;ch<6;ch++)if(manual.has(9+ch))value&=~(1<<ch);
        if(port===0&&[0x10,0x19,0x1a].includes(register)&&manual.has(15))return;
      }
      registers[port][register]=value;
    }else if(message.method==='memory'){
      memory[message.kind].set(message.offset,Uint8Array.from(message.data));loaded[message.kind]=Math.max(loaded[message.kind],message.offset+message.data.length);
    }else if(message.method==='clear-memory'){
      for(const kind of message.kind===undefined?[0,1]:[message.kind]){memory[kind].clear();loaded[kind]=0;}
    }else if(message.method==='clock')clock=message.hz;
    else if(message.method==='reset'){if(!manual.size)for(const row of registers)row.fill(0);}
    else if(message.method==='stop-voices'){manual.clear();for(let ch=0;ch<3;ch++)registers[0][8+ch]=0;registers[1][0]=0xbf;registers[0][0x10]=1;}
  }
  function snapshot(){return {registers:structuredClone(registers),clock,sampleRate:48000,variant:variant?'ym2610b':'ym2610',pendingCommands:future.flatMap(c=>c.message.id===undefined?[]:[c.message.id]),held:[...manual.keys()],adpcmARomBytes:loaded[0],adpcmBRomBytes:loaded[1],status:0,statusHi:0,irq:false,frame,revision:commands.length};}
  const synth={session:1,generation:1,clock:{sampleRate:48000},stopping:null,closing:false,isReady:()=>true,frameAt:time=>Math.round(time*48000),
    enqueue(command){commands.push(command);if(command.frame>frame)future.push(command);else apply(command.message);},
    enqueueMany(list){for(const command of list)this.enqueue(command);},
    async flush(){if(flushHook)await flushHook();},
    async nativeRequest(command,args){requests.push({command,args});if(statusHook)return statusHook();return snapshot();},
  };
  const adapter=createNativeGenesisYm2610B(synth,{variant,fetcher:()=>{throw new Error('Unexpected ROM fetch');}});
  return {adapter,synth,commands,requests,registers,memory,manual,snapshot,
    async start(){await adapter.initialize();commands.length=0;},advance(to){frame=to;for(let index=0;index<future.length;){if(future[index].frame<=frame)apply(future.splice(index,1)[0].message);else index++;}},
    setFlushHook(fn){flushHook=fn;},setStatusHook(fn){statusHook=fn;},stop(){apply({method:'stop-voices'});future.length=0;adapter.adoptStopped(snapshot());},
  };
}

for(const variant of [false,true])test(`Native ${variant?'YM2610B':'YM2610'} constructs without audio, uses shared helpers and initializes only once`,async()=>{
  const f=fixture({variant}),client=f.adapter.client;
  assert.equal(f.commands.length,0);assert.equal(client.id,variant?'ym2610b':'ym2610');assert.equal(client.channelCount,variant?6:4);
  assert(variant?client instanceof YM2610BSynth:client instanceof NeoGeoFMSynth);assert.equal(client.adpcm,client.adpcmB);
  await f.adapter.initialize();assert.deepEqual(f.commands.map(c=>c.message),[{method:'reset'}]);
  await f.adapter.initialize();assert.equal(f.commands.length,1);assert.equal((await f.adapter.read()).kind,client.id);
});

for(const variant of [false,true])test(`Native ${variant?'YM2610B':'YM2610'} FM SSG ADPCM-A and ADPCM-B match shared register helpers`,async()=>{
  const f=fixture({variant});await f.start();const expected=[];
  const raw=new YM2610BSynth({transport:{write:(port,register,value)=>expected.push({method:'write',port,register,value}),reset(){}}}),reference=variant?raw:new NeoGeoFMSynth(raw);
  if(!variant)Object.assign(reference,{ssg:raw.ssg,adpcmA:raw.adpcmA,adpcmB:raw.adpcmB});expected.length=0;
  function program(chip){
    const ch=variant?5:3;chip.setPreset(ch,{algorithm:4,feedback:3,operators:[{multi:2,ar:31,tl:15}],pan:{left:true,right:false}});chip.noteOn(ch,'A4');
    chip.ssg.tone(2,{frequency:440,volume:10});chip.ssg.setEnvelope({period:200,shape:9});
    chip.adpcmA.setVolume(50);chip.adpcmA.setVoice(5,{volume:24,left:true,right:true});chip.adpcmA.setSample(5,{start:0x123400,end:0x123800});chip.adpcmA.keyOn([2,5]);
    chip.adpcmB.setSample({start:0x234500,end:0x234800});chip.adpcmB.setPlaybackRate(16000);chip.adpcmB.setVolume(180);chip.adpcmB.setPan(true,false);chip.adpcmB.keyOn({repeat:true});
  }
  program(reference);program(f.adapter.client);await f.synth.flush();assert.deepEqual(f.commands.map(c=>c.message),expected);
  assert(f.commands.every(command=>command.type==='ym2610b'));
});

test('Native YM2610 compact FM maps all four channels onto physical 1 2 4 5',async()=>{
  const f=fixture({variant:false});await f.start();
  for(let ch=0;ch<4;ch++)f.adapter.client.noteOn(ch,'A4');
  assert.deepEqual(f.commands.filter(c=>c.message.register===0x28).map(c=>c.message.value),[0xf1,0xf2,0xf5,0xf6]);
  assert.throws(()=>f.adapter.client.noteOn(4,'A4'),/0\.\.3/);
  assert.equal(f.adapter.client._getState().channels.length,6);assert.equal(f.adapter.client.fm._getState().channels.length,6);
  await f.adapter.client.setClock(6000000);assert.equal(f.adapter.client.fm.clock,6000000);assert.equal(f.adapter.client.ssg.clock,1500000);assert.equal(f.adapter.client.adpcmB.clock,6000000);
});

test('Native YM2610/B raw Worker methods validate whole batches, retain timing and acknowledge memory and clock',async()=>{
  const f=fixture();await f.start();
  await f.adapter.dispatch([{type:'write',port:0,register:0xa4,value:0x22},{type:'write',port:0,register:0xa0,value:0x34}],{time:1,performance:7,owner:2});
  assert(f.commands.every(c=>c.frame===48000&&c.performance===7&&c.owner===2));const count=f.commands.length;
  await assert.rejects(f.adapter.dispatch([{type:'write',port:0,register:1,value:2},{type:'write',port:3,register:1,value:2}]),/port/);assert.equal(f.commands.length,count);
  assert.deepEqual(await f.adapter.dispatch({method:'memory',args:[0,new Uint8Array([11,22]),64],id:10},{time:2,performance:8,owner:3}),{id:10});
  assert.deepEqual(f.commands.at(-1),{type:'ym2610b',frame:0,performance:8,owner:3,message:{method:'memory',kind:0,offset:64,data:[11,22]}});
  assert.deepEqual(await f.adapter.dispatch({type:'loadAdpcmMemory',memoryType:1,bytes:new Uint8Array([33,44]),address:64,id:11}),{type:'adpcm-memory-loaded',id:11});
  assert.deepEqual(await f.adapter.dispatch({type:'chip-clock',clock:4000000,id:'clock:1'}),{type:'chip-clock-result',id:'clock:1',clock:4000000});
  await f.adapter.dispatch({method:'source-mute',args:[7]});assert.deepEqual(f.commands.at(-1).message,{method:'source-mute',mask:7});
  assert.equal(f.adapter.client.clock,4000000);assert.equal(f.adapter.client.ssg.clock,1000000);assert.equal(f.adapter.client.adpcmB.clock,4000000);
});

test('Native YM2610/B independent 16 MiB A/B banks use owned 64 KiB chunks and validate all bounds',async()=>{
  const f=fixture();await f.start();const bytes=new Uint8Array(131073).fill(0x87),pending=f.adapter.client.adpcmA.loadMemory(bytes,32);bytes.fill(0);await pending;
  assert.deepEqual(f.commands.map(c=>c.message.data.length),[65536,65536,1]);assert.deepEqual(f.commands.map(c=>c.message.offset),[32,65568,131104]);assert(f.commands.every(c=>c.message.kind===0));assert.equal(f.memory[0].get(131104)[0],0x87);
  await f.adapter.client.adpcmB.loadMemory(new Uint8Array([1,2]),32);assert.deepEqual([...f.memory[0].get(32).slice(0,2)],[0x87,0x87]);assert.deepEqual([...f.memory[1].get(32)],[1,2]);
  await f.adapter.client.adpcmA.loadMemory(new Uint8Array([3]),0xffffff);await f.adapter.client.adpcmB.loadMemory(new Uint8Array([4]),0xffffff);assert.equal(f.memory[0].get(0xffffff)[0],3);assert.equal(f.memory[1].get(0xffffff)[0],4);
  const count=f.commands.length;
  assert.throws(()=>f.adapter.client.adpcmA.loadMemory(new Uint8Array(2),0xffffff),/range/);assert.throws(()=>f.adapter.client.adpcmB.loadMemory(new Uint8Array(2),0xffffff),/exceeds/);
  await assert.rejects(f.adapter.dispatch({method:'memory',args:[2,new Uint8Array([1]),0]}),/kind/);await assert.rejects(f.adapter.dispatch({type:'loadAdpcmMemory',bytes:new Uint8Array([1]),memoryType:0,address:-1}),/address/);assert.equal(f.commands.length,count);
  await f.adapter.dispatch({method:'clear-memory',args:[0]});assert.equal(f.memory[0].size,0);assert.equal(f.memory[1].size,2);
});

test('Native YM2610/B applied snapshots do not replace future helper state; read/status/IRQ cross IPC',async()=>{
  const f=fixture();await f.start();f.adapter.client.setAlgo(4,6,3);const state=f.adapter.client._getState();state.ssg.registers[4]=123;f.adapter.client._adoptState(state);
  await f.adapter.dispatch({method:'write',args:[1,0xb1,1]},{time:1});const before=structuredClone(f.adapter.client._getState());
  assert.equal((await f.adapter.read()).fmState.channels[4].algorithm,6);assert.deepEqual(f.adapter.client._getState(),before);
  f.advance(48000);assert.equal((await f.adapter.read()).fmState.channels[4].algorithm,1);assert.deepEqual(f.adapter.client._getState(),before);
  f.setStatusHook(()=>({...f.snapshot(),status:5,statusHi:130,irq:true}));assert.equal(await f.adapter.client.readStatus(),5);assert.equal(await f.adapter.client.read(2),130);assert.equal(await f.adapter.client.getIrq(),true);
  assert(f.requests.every(request=>request.command==='native_genesis_ym2610b_status'));await assert.rejects(f.adapter.client.read(1),/offsets/);
});

test('Native YM2610/B sample loading reuses shared B encoder, ROM ranges and continuous silence padding',async()=>{
  const f=fixture();await f.start();const pcm={sampleRate:15625,channels:[Float32Array.from({length:130},(_,i)=>Math.sin(i/8)*.5)]};
  const sample=await f.adapter.loadSample(pcm,{address:256,name:'voice'});assert.equal(sample.name,'voice');assert.equal(sample.frames,130);assert.equal(sample.paddedFrames,512);assert.equal(sample.end,512);
  const padded=new Float32Array(512);padded.set(pcm.channels[0]);const encoded=encodeAdpcmB({channels:[padded],sampleRate:15625},15625,0x1000000-256),expected=[];
  const reference=new YM2610BAdpcmBSynth({write:(register,value)=>expected.push({method:'write',port:0,register:0x10+register,value}),loadMemory(){}},8000000);
  reference.keyOff();expected.push({method:'memory',kind:1,offset:256,data:Array.from(encoded.bytes)});reference.setSample({start:256,end:512});reference.setPlaybackRate(15625);
  assert.deepEqual(f.commands.map(c=>c.message),expected);assert.notEqual(encoded.bytes.at(-1),0);
  const count=f.commands.length;await assert.rejects(f.adapter.client.adpcmB.loadSample(pcm,{address:32}),/256-byte/);await assert.rejects(f.adapter.loadSample(pcm,{kind:0}),/ADPCM-A/);assert.equal(f.commands.length,count);
});

test('Native YM2610/B asynchronous decode cannot mutate a newer session or cancelled signal',async()=>{
  const f=fixture();await f.start();let resolveDecode;
  const pending=f.adapter.client.adpcmB.loadSample(new Uint8Array([1,2]),{decodeAudio:()=>new Promise(resolve=>{resolveDecode=resolve;})});
  while(!resolveDecode)await Promise.resolve();f.synth.generation++;resolveDecode({sampleRate:8000,channels:[new Float32Array([0,.2,-.2])]});await assert.rejects(pending,{name:'AbortError'});assert.equal(f.commands.length,0);
  const controller=new AbortController();controller.abort();await assert.rejects(f.adapter.client.adpcmB.loadSample({sampleRate:8000,channels:[new Float32Array([0]) ]},{signal:controller.signal}),{name:'AbortError'});assert.equal(f.commands.length,0);
});

test('Native YM2610/B sample cancellation stops between memory chunks without selecting a partial sample',async()=>{
  const f=fixture();await f.start();const controller=new AbortController();
  f.setFlushHook(()=>controller.abort());
  await assert.rejects(f.adapter.client.adpcmB.loadSample({sampleRate:15625,channels:[new Float32Array(262144)]},{signal:controller.signal}),{name:'AbortError'});
  assert.deepEqual(f.commands.map(c=>c.message.method),['write','memory']);
  assert.equal(f.commands[0].message.register,0x10);assert.equal(f.commands[1].message.data.length,65536);
  assert.equal(f.registers[0][0x12],0);assert.equal(f.registers[0][0x14],0);
});

test('Native YM2610/B malformed sample ranges and nonfinite rates reject before any chip write',async()=>{
  const f=fixture();await f.start();const pcm={sampleRate:8000,channels:[new Float32Array([0,.5,-.5])]};
  for(const options of [{sampleRate:NaN},{sampleRate:1e9},{address:0xffff00,sampleRate:15625}]){
    const source=options.address?{sampleRate:15625,channels:[new Float32Array(1025)]}:pcm;
    await assert.rejects(f.adapter.client.adpcmB.loadSample(source,options),/range|memory/);
  }
  assert.equal(f.commands.length,0);
});

for(const kind of [0,1])test(`Native YM2610/B bank ${kind} uploads fence each chunk against session changes`,async()=>{
  const f=fixture();await f.start();let count=0;f.setFlushHook(()=>{if(++count===1)f.synth.session++;});
  await assert.rejects((kind===0?f.adapter.client.adpcmA:f.adapter.client.adpcmB).loadMemory(new Uint8Array(131072)),{name:'AbortError'});assert.equal(f.commands.length,1);
});

for(const variant of [false,true])for(const [target,physical]of [['fm:3',variant?3:5],['ssg:1',7],['adpcm-a:2',11],['adpcm-b:0',15]])test(`Native ${variant?'YM2610B':'YM2610'} ${target} manual leases map physical voices and ignore stale release`,async()=>{
  const f=fixture({variant});await f.start();await f.adapter.invoke('auditionOn',[target,69,'old']);const first=f.commands.at(-1).message;assert.equal(first.channel,physical);assert.equal(first.action,'on');assert.equal(f.manual.get(physical),first.voice);
  assert.deepEqual((await f.adapter.read()).held,[target]);await f.adapter.invoke('auditionOn',[target,72,'new']);const second=f.commands.at(-1).message;assert.notEqual(first.voice,second.voice);
  const count=f.commands.length;await f.adapter.invoke('auditionOff',[target,'old']);assert.equal(f.commands.length,count);assert.equal(f.manual.get(physical),second.voice);
  await f.adapter.invoke('auditionOff',[target,'new']);assert.equal(f.manual.has(physical),false);assert(f.requests.some(request=>request.args.after>0));
});

test('Native YM2610 physical FM auditions use raw pitch and key codes; four-channel variant rejects absent voices',async()=>{
  const f=fixture({variant:false});await f.start();await f.adapter.auditionNoteOn(4,5,0x345,101);const batch=f.commands.at(-1).message;
  assert.equal(batch.channel,4);assert.deepEqual(batch.commands,[{method:'write',port:0,register:0x28,value:5},{method:'write',port:1,register:0xa5,value:0x2b},{method:'write',port:1,register:0xa1,value:0x45},{method:'write',port:0,register:0x28,value:0xf5}]);
  await f.adapter.auditionNoteOn(4,4,0x678,102);await f.adapter.auditionNoteOff(4,101);assert.equal(f.manual.get(4),102);await f.adapter.auditionNoteOff(4,102);assert.equal(f.manual.has(4),false);
  await assert.rejects(f.adapter.auditionNoteOn(0,4,0x678,103),/Unavailable/);await assert.rejects(f.adapter.invoke('auditionOn',['fm:4',69,'invalid']),/Unavailable/);
});

test('Native YM2610/B clear auditions releases each section independently',async()=>{
  const f=fixture({variant:false});await f.start();for(const target of ['fm:0','ssg:1','adpcm-a:2','adpcm-b:0'])await f.adapter.invoke('auditionOn',[target,69,target]);
  f.commands.length=0;await f.adapter.invoke('auditionAllOff');assert.equal(f.manual.size,0);assert.deepEqual(f.commands.map(c=>c.message.channel),[1,7,11,15]);assert(f.commands.every(c=>c.message.action==='off'&&c.message.commands.length>0));
});

test('Native YM2610/B Stop retains banks ranges clock patches and remembered SSG volume/envelope',async()=>{
  const f=fixture();await f.start();await f.adapter.client.setClock(6000000);f.adapter.client.setAlgo(0,7,2);
  f.adapter.client.ssg.tone(0,{frequency:440,volume:11});f.adapter.client.ssg.tone(1,{frequency:220,envelope:true});f.adapter.client.ssg.keyOff(0);
  await f.adapter.client.adpcmA.loadMemory(new Uint8Array([12,34]),0x120000);await f.adapter.client.adpcmB.loadMemory(new Uint8Array([56,78]),0x230000);
  f.adapter.client.adpcmA.setSample(2,{start:0x120000,end:0x120100});f.adapter.client.adpcmA.setVoice(2,{volume:21,left:true,right:false});f.adapter.client.adpcmB.setSample({start:0x230000,end:0x230100});f.adapter.client.adpcmB.keyOn({repeat:true});
  await f.adapter.invoke('auditionOn',['fm:0',69,'held']);f.stop();assert.equal(f.adapter.client.clock,6000000);assert.equal(f.adapter.client.getState().channels[0].algorithm,7);assert.equal(f.manual.size,0);
  assert.equal(f.memory[0].get(0x120000)[0],12);assert.equal(f.memory[1].get(0x230000)[0],56);assert.equal(f.adapter.client.adpcmA.levels[2],149);assert.equal(f.adapter.client.adpcmB.registers[3],0x23);
  f.adapter.client.ssg.keyOn(0);f.adapter.client.ssg.keyOn(1);assert.equal(f.registers[0][8],11);assert.equal(f.registers[0][9],16);
  await f.adapter.invoke('auditionOn',['adpcm-b:0',69,'again']);assert.equal(f.registers[0][0x10],0xb0);
});

test('Native YM2610/B validates snapshots and cancels queued inspectors; reset is device-free',async()=>{
  const f=fixture();await f.start();f.setStatusHook(()=>({...f.snapshot(),registers:[[0],Array(256).fill(0)]}));await assert.rejects(f.adapter.read(),/invalid snapshot/);
  f.setStatusHook(()=>({...f.snapshot(),variant:'ym2610'}));await assert.rejects(f.adapter.read(),/invalid variant/);f.setStatusHook(()=>({...f.snapshot(),held:[16]}));await assert.rejects(f.adapter.read(),/held voice/);
  f.setStatusHook(null);f.synth.stopping=Promise.resolve();await assert.rejects(f.adapter.invoke('auditionAllOff'),{name:'AbortError'});f.synth.stopping=null;
  const count=f.commands.length;f.adapter.reset();assert.equal(f.commands.length,count);assert.equal(f.adapter.client.clock,8000000);assert.deepEqual(f.adapter.client.ssg._getState().levels,[0,0,0]);
});
