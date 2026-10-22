import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisYm2608} from './native_genesis_ym2608.js';
import {YM2608Synth, YM2608AdpcmSynth} from './ym2608synth.js';

const ROM=new Uint8Array(8192).fill(0x55);
function fixture(){
  const commands=[],requests=[],future=[],registers=[Array(256).fill(0),Array(256).fill(0)],manual=new Map(),memory=new Uint8Array(0x200000);
  let frame=0,clock=8000000,romLoaded=false,loaded=0,fetches=0,flushHook=null,statusHook=null;
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
        if(port===0&&register===0x10)for(let ch=0;ch<6;ch++)if(manual.has(9+ch))value&=~(1<<ch);
        if(port===1&&[0,9,10].includes(register)&&manual.has(15))return;
      }
      registers[port][register]=value;
    }else if(message.method==='rom')romLoaded=true;
    else if(message.method==='memory'){memory.set(message.data,message.offset);loaded=Math.max(loaded,message.offset+message.data.length);}
    else if(message.method==='clock')clock=message.hz;
    else if(message.method==='reset'){if(!manual.size)for(const row of registers)row.fill(0);}
    else if(message.method==='stop-voices'){manual.clear();for(let ch=0;ch<3;ch++)registers[0][8+ch]=0;registers[0][0x10]=0xbf;registers[1][0]=1;}
  }
  function snapshot(){return {registers:structuredClone(registers),clock,sampleRate:48000,pendingCommands:future.flatMap(c=>c.message.id===undefined?[]:[c.message.id]),held:[...manual.keys()],romLoaded,adpcmMemoryBytes:loaded,status:0,statusHi:0,irq:false,frame,revision:commands.length};}
  const synth={session:1,generation:1,clock:{sampleRate:48000},stopping:null,closing:false,isReady:()=>true,frameAt:time=>Math.round(time*48000),
    enqueue(command){commands.push(command);if(command.frame>frame)future.push(command);else apply(command.message);},
    enqueueMany(list){for(const command of list)this.enqueue(command);},
    async flush(){if(flushHook)await flushHook();},
    async nativeRequest(command,args){requests.push({command,args});if(statusHook)return statusHook();return snapshot();},
  };
  const adapter=createNativeGenesisYm2608(synth,{fetcher:async()=>{fetches++;return {ok:true,arrayBuffer:async()=>ROM.slice().buffer};}});
  return {adapter,synth,commands,requests,registers,memory,manual,snapshot,get fetches(){return fetches;},
    async start(){await adapter.initialize();commands.length=0;},advance(to){frame=to;for(let index=0;index<future.length;){if(future[index].frame<=frame)apply(future.splice(index,1)[0].message);else index++;}},
    setFlushHook(fn){flushHook=fn;},setStatusHook(fn){statusHook=fn;},stop(){apply({method:'stop-voices'});future.length=0;adapter.adoptStopped(snapshot());},
  };
}

test('Native YM2608 imports and constructs without audio or transport activity; initializes bundled rhythm once and six FM channels',async()=>{
  const f=fixture();assert.equal(f.commands.length,0);assert.equal(f.fetches,0);assert.equal(f.adapter.client.id,'ym2608');
  await f.adapter.initialize();assert.equal(f.commands[0].message.method,'rom');assert.equal(f.commands[0].message.data.length,8192);
  assert.equal(f.registers[0][0x29],0x9f);const count=f.commands.length;await f.adapter.initialize();assert.equal(f.commands.length,count);assert.equal(f.fetches,1);
  assert.equal((await f.adapter.read()).romLoaded,true);
});

test('Native YM2608 FM SSG rhythm and ADPCM helpers emit exactly the existing shared API register program',async()=>{
  const f=fixture();await f.start();const expected=[];
  const browser=new YM2608Synth({transport:{write:(port,register,value)=>expected.push({method:'write',port,register,value}),reset(){}}});expected.length=0;
  function program(chip){
    chip.setPreset(5,{algorithm:4,feedback:3,operators:[{multi:2,ar:31,tl:15}],pan:{left:true,right:false}});
    chip.noteOn(5,'A4');chip.ssg.tone(2,{frequency:440,volume:10});chip.ssg.setEnvelope({period:200,shape:9});
    chip.rhythm.setVolume(50);chip.rhythm.setVoice('snare',{volume:24,left:true,right:true});chip.rhythm.keyOn(['snare','hiHat']);
    chip.adpcm.setSample({start:32,end:96});chip.adpcm.setPlaybackRate(16000);chip.adpcm.setVolume(180);chip.adpcm.setPan(true,false);chip.adpcm.keyOn({repeat:true});
  }
  program(browser);program(f.adapter.client);await f.synth.flush();assert.deepEqual(f.commands.map(c=>c.message),expected);
});

test('Native YM2608 raw Worker protocol validates an entire batch, retains timing and replies to ROM/memory/clock requests',async()=>{
  const f=fixture();await f.start();
  await f.adapter.dispatch([{type:'write',port:0,register:0xa4,value:0x22},{type:'write',port:0,register:0xa0,value:0x34}],{time:1,performance:7,owner:2});
  assert(f.commands.every(c=>c.frame===48000&&c.performance===7&&c.owner===2));const count=f.commands.length;
  await assert.rejects(f.adapter.dispatch([{type:'write',port:0,register:1,value:2},{type:'write',port:3,register:1,value:2}]),/port/);assert.equal(f.commands.length,count);
  assert.deepEqual(await f.adapter.dispatch({type:'loadRhythmRom',bytes:ROM,id:9}),{type:'rhythm-rom-loaded',id:9});
  assert.deepEqual(await f.adapter.dispatch({type:'loadAdpcmMemory',bytes:new Uint8Array([1,2]),address:64,id:10}),{type:'adpcm-memory-loaded',id:10});
  assert.deepEqual(await f.adapter.dispatch({type:'chip-clock',clock:4000000,id:'chip-clock:1'}),{type:'chip-clock-result',id:'chip-clock:1',clock:4000000});
  assert.equal(f.adapter.client.clock,4000000);assert.equal(f.adapter.client.ssg.clock,1000000);assert.equal(f.adapter.client.adpcm.clock,4000000);
});

test('Native YM2608 applied reads do not replace projected future FM or section state',async()=>{
  const f=fixture();await f.start();f.adapter.client.setAlgo(4,6,3);const saved=f.adapter.client._getState();saved.ssg.registers[4]=123;f.adapter.client._adoptState(saved);
  await f.adapter.dispatch({type:'write',port:1,register:0xb1,value:1},{time:1});
  const before=structuredClone(f.adapter.client._getState()),data=await f.adapter.read();assert.equal(data.fmState.channels[4].algorithm,6);assert.deepEqual(f.adapter.client._getState(),before);
  f.advance(48000);const applied=await f.adapter.read();assert.equal(applied.fmState.channels[4].algorithm,1);assert.deepEqual(f.adapter.client._getState(),before);
});

test('Native YM2608 ADPCM memory uploads are bounded and use owned copies',async()=>{
  const f=fixture();await f.start();const bytes=new Uint8Array(131073).fill(0x87),upload=f.adapter.client.adpcm.loadMemory(bytes,32);bytes.fill(0);await upload;
  const chunks=f.commands.map(c=>c.message);assert.deepEqual(chunks.map(m=>m.data.length),[65536,65536,1]);assert.deepEqual(chunks.map(m=>m.offset),[32,65568,131104]);assert.equal(f.memory[131104],0x87);
  const count=f.commands.length;assert.throws(()=>f.adapter.client.adpcm.loadMemory(new Uint8Array(33),0x200000-32),/exceeds/);assert.equal(f.commands.length,count);
});

test('Native YM2608 samples reuse ADPCM-B encoding and setup at the current clock',async()=>{
  const f=fixture();await f.start();await f.adapter.client.setClock(4000000);f.commands.length=0;
  const pcm={sampleRate:16000,channels:[Float32Array.from({length:130},(_,i)=>Math.sin(i/8)*.5)]},expected=[],reference=new YM2608AdpcmSynth({write:(register,value)=>expected.push({method:'write',port:1,register,value}),loadMemory:(bytes,offset)=>expected.push({method:'memory',data:Array.from(bytes),offset})},4000000);
  const a=await reference.loadSample(pcm,{address:64}),b=await f.adapter.client.adpcm.loadSample(pcm,{address:64});assert.deepEqual(b,a);assert.deepEqual(f.commands.map(c=>c.message),expected);
});

test('Native YM2608 Stop retains remembered SSG volume and envelope for keyOn',async()=>{
  const f=fixture();await f.start();
  f.adapter.client.ssg.tone(0,{frequency:440,volume:11});
  f.adapter.client.ssg.tone(1,{frequency:220,envelope:true});
  f.adapter.client.ssg.keyOff(0);f.stop();
  assert.equal(f.registers[0][8],0);assert.equal(f.registers[0][9],0);
  f.adapter.client.ssg.keyOn(0);f.adapter.client.ssg.keyOn(1);
  assert.equal(f.registers[0][8],11);assert.equal(f.registers[0][9],16);
});

test('Native YM2608 cancellation after asynchronous decode cannot touch the next session',async()=>{
  const f=fixture();await f.start();let resolveDecode;
  const pending=f.adapter.client.adpcm.loadSample(new Uint8Array([1,2]),{decodeAudio:()=>new Promise(resolve=>{resolveDecode=resolve;})});
  while(!resolveDecode)await Promise.resolve();f.synth.generation++;resolveDecode({sampleRate:16000,channels:[new Float32Array([0,.2,-.2]) ]});
  await assert.rejects(pending,{name:'AbortError'});assert.equal(f.commands.length,0);
});

test('Native YM2608 cancellation fences every memory chunk before enqueue and after acknowledgement',async()=>{
  const f=fixture();await f.start();let count=0;f.setFlushHook(()=>{if(++count===1)f.synth.generation++;});
  await assert.rejects(f.adapter.client.adpcm.loadMemory(new Uint8Array(131072)),{name:'AbortError'});assert.equal(f.commands.length,1);
});

for(const [target,logical]of [['fm:4',4],['ssg:1',7],['rhythm:2',11],['adpcm-b:0',15]])test(`Native YM2608 ${target} manual lease protects its physical voice and rejects an old key release`,async()=>{
  const f=fixture();await f.start();await f.adapter.invoke('auditionOn',[target,69,'old']);const first=f.commands.at(-1).message;
  assert.equal(first.channel,logical);assert.equal(first.action,'on');assert.equal(f.manual.get(logical),first.voice);
  await f.adapter.invoke('auditionOn',[target,72,'new']);const second=f.commands.at(-1).message;assert.notEqual(first.voice,second.voice);
  const count=f.commands.length;await f.adapter.invoke('auditionOff',[target,'old']);assert.equal(f.commands.length,count);assert.equal(f.manual.get(logical),second.voice);
  await f.adapter.invoke('auditionOff',[target,'new']);assert.equal(f.manual.has(logical),false);assert(f.requests.some(request=>request.args.after>0));
});

test('Native YM2608 raw FM audition preserves raw pitch and the correct hardware key codes',async()=>{
  const f=fixture();await f.start();await f.adapter.auditionNoteOn(4,5,0x345,101);const batch=f.commands.at(-1).message;
  assert.equal(batch.channel,4);assert.deepEqual(batch.commands,[{method:'write',port:0,register:0x28,value:5},{method:'write',port:1,register:0xa5,value:0x2b},{method:'write',port:1,register:0xa1,value:0x45},{method:'write',port:0,register:0x28,value:0xf5}]);
  await f.adapter.auditionNoteOn(4,4,0x678,102);await f.adapter.auditionNoteOff(4,101);assert.equal(f.manual.get(4),102);await f.adapter.auditionNoteOff(4,102);assert.equal(f.manual.has(4),false);
});

test('Native YM2608 Stop adopts applied settings and preserves ROM RAM clock and auditionable patches',async()=>{
  const f=fixture();await f.start();await f.adapter.client.setClock(6000000);f.adapter.client.setAlgo(0,7,2);f.adapter.client.ssg.tone(0,{frequency:440,volume:11});await f.adapter.client.adpcm.loadMemory(new Uint8Array([12,34]),32);
  await f.adapter.invoke('auditionOn',['fm:0',69,'held']);f.stop();assert.equal(f.adapter.client.clock,6000000);assert.equal(f.adapter.client.getState().channels[0].algorithm,7);assert.equal((await f.adapter.read()).romLoaded,true);assert.equal(f.memory[32],12);assert.equal(f.manual.size,0);
  await f.adapter.invoke('auditionOn',['ssg:0',69,'again']);assert.equal(f.registers[0][8],11);assert.equal(f.manual.has(6),true);
});

test('Native YM2608 invalid snapshots and cancelled inspector work reject without hiding failures',async()=>{
  const f=fixture();await f.start();f.setStatusHook(()=>({...f.snapshot(),registers:[[0],Array(256).fill(0)]}));await assert.rejects(f.adapter.read(),/invalid snapshot/);
  f.setStatusHook(null);f.synth.stopping=Promise.resolve();await assert.rejects(f.adapter.invoke('auditionAllOff'),{name:'AbortError'});
});
