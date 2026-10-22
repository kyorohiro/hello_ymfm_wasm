import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisX68000} from './native_genesis_x68000.js';
import {createYm2151Client} from './playground_ym2151.js';
import {Oki6258Synth,encodeOki6258} from './okim6258synth.js';

function fixture(){
  const commands=[],requests=[],events=[],future=[],held=[new Map(),new Map()],regs=Array(256).fill(0),keyMasks=Array(8).fill(0);let frame=0,flushHook=null,statusHook=null,stage=null;
  const fm={clock:4000000,registers:regs,keyMasks,amDepth:0,pmDepth:0,status:0,irq:false},oki={clock:8000000,divider:512,pan:0,playing:false,streaming:false,repeat:false,positionFrames:0,fedBytes:0,memoryRevision:0,sample:null,sampleId:0,status:0};let memory=new Uint8Array();
  function apply(m,bypass=false){
    const state=m.chip==='ym2151'?fm:oki,map=held[m.chip==='ym2151'?0:1];
    if(m.method==='batch'){
      if(m.action==='off'&&map.get(m.channel)!==m.voice)return;
      if(m.action==='on')map.set(m.channel,m.voice);
      for(const c of m.commands)apply({...c,chip:m.chip},true);
      if(m.action==='off')map.delete(m.channel);return;
    }
    if(m.method==='write'){
      if(state===fm){let channel=m.register===8?m.value&7:m.register>=0x20?m.register&7:null;if(!bypass&&map.has(channel))return;regs[m.register]=m.value;if(m.register===8)keyMasks[m.value&7]=(m.value>>3)&15;if(m.register===0x19)fm[m.value&128?'pmDepth':'amDepth']=m.value&127;}
      else{if(!bypass&&map.size)return;if(m.register===12)oki.divider=[1024,768,512,512][m.value&3];if(m.register===2)oki.pan=m.value&3;}
    }else if(m.method==='key-off'){if(state===fm)keyMasks[m.channel]=0;else oki.playing=oki.streaming=false;}
    else if(m.method==='clock')state.clock=m.hz;
    else if(m.method==='reset'){map.clear();if(state===fm){regs.fill(0);keyMasks.fill(0);fm.amDepth=fm.pmDepth=0;}else{oki.divider=512;oki.pan=0;oki.playing=oki.streaming=false;}}
    else if(m.method==='stop-voices'){map.clear();if(state===fm)keyMasks.fill(0);else oki.playing=oki.streaming=false;}
    else if(m.method==='memory-begin')stage={id:m.sampleId,bytes:new Uint8Array(m.byteLength),metadata:m.metadata};
    else if(m.method==='memory-chunk'){assert.equal(stage.id,m.sampleId);stage.bytes.set(m.data,m.offset);}
    else if(m.method==='memory-commit'){assert.equal(stage.id,m.sampleId);if(map.size&&!m.audition)return;memory=stage.bytes;oki.sample={...stage.metadata,bytes:memory.length,frames:memory.length*2,durationSeconds:memory.length*2/stage.metadata.sampleRate};stage=null;oki.memoryRevision++;oki.sampleId=m.sampleId;oki.playing=oki.streaming=false;map.clear();}
    else if(m.method==='play'){if(!bypass&&map.size)return;oki.playing=oki.streaming=true;oki.repeat=m.repeat;}
    else if(m.method==='stop'){if(!bypass&&map.size)return;oki.playing=oki.streaming=false;}
    else if(m.method==='set-repeat')oki.repeat=m.repeat;
  }
  function snapshot(){const pending=chip=>future.flatMap(c=>c.message.chip===chip&&c.message.id?[c.message.id]:[]);return {sampleRate:48000,frame,revision:commands.length,ym2151:{...structuredClone(fm),held:[...held[0].keys()],pendingCommands:pending('ym2151')},okim6258:{...structuredClone(oki),held:[...held[1].keys()],pendingCommands:pending('okim6258')}};}
  const synth={session:1,generation:1,clock:{sampleRate:48000},stopping:null,closing:false,isReady:()=>true,frameAt:time=>Math.round(time*48000),emit:event=>events.push(event),enqueue(command){commands.push(command);if(command.frame>frame)future.push(command);else apply(command.message);},enqueueMany(list){for(const c of list)this.enqueue(c);},async flush(){if(flushHook)await flushHook();},async nativeRequest(command,args){requests.push({command,args});return statusHook?statusHook():snapshot();}};
  const endpoints=createNativeGenesisX68000(synth,{fetcher:()=>{throw new Error('Unexpected fetch');}});
  return {synth,...endpoints,commands,requests,events,fm,oki,held,snapshot,get memory(){return memory;},get stage(){return stage;},setFlushHook(h){flushHook=h;},setStatusHook(h){statusHook=h;},async start(){await endpoints.ym2151.initialize();await endpoints.okim6258.initialize();commands.length=0;},advance(to){frame=to;for(let i=0;i<future.length;){if(future[i].frame<=frame)apply(future.splice(i,1)[0].message);else i++;}},stop(){apply({chip:'ym2151',method:'stop-voices'});apply({chip:'okim6258',method:'stop-voices'});for(const [kind,endpoint]of Object.entries(endpoints))endpoint.adoptStopped(snapshot()[kind]);}};
}

test('Native X68000 construction creates controls without an audio graph and initializes each chip once',async()=>{
  const f=fixture();assert.equal(f.commands.length,0);assert.equal(f.ym2151.client.clock,4000000);assert.equal(f.okim6258.client.clock,8000000);assert(f.okim6258.client instanceof Oki6258Synth);
  await f.start();await f.ym2151.initialize();await f.okim6258.initialize();assert.equal(f.commands.length,0);assert.equal((await f.ym2151.read()).kind,'ym2151');assert.equal((await f.okim6258.read()).kind,'okim6258');
});

test('Native OPM matches Playground register-order operators, key masks and clock-aware pitch',async()=>{
  const f=fixture();await f.start();const expected=[],reference=createYm2151Client({postMessage:m=>expected.push(m),close(){}});reference._adoptClock(4000000);
  function program(client){for(let ch=0;ch<8;ch++){client.setAlgo(ch,ch,7-ch);client.setPan(ch,ch%2===0,true);for(let op=0;op<4;op++)client.setOperator(ch,op,{dt1:op,mul:2+op,tl:20+op,ks:3,ar:31,am:1,d1r:12,dt2:1,d2r:5,d1l:2,rr:9});client.noteOn(ch,'A4');client.keyOn(ch,5);client.keyOff(ch);}client.setNoise(true,13);}
  program(reference);program(f.ym2151.client);assert.deepEqual(f.commands.map(c=>c.message),expected.map(m=>({chip:'ym2151',method:'write',register:m.args[0],value:m.args[1]})));
  assert.equal(f.fm.registers[0x48],0x13);assert.equal(f.fm.registers[0x50],0x24);
  const before=f.commands.length;assert.throws(()=>f.ym2151.client.setOperator(0,0,{tl:1,nope:2}),/Unknown/);assert.equal(f.commands.length,before);
});

test('Native OKI controls preserve shared divider, pan and raw sample encoding contracts',async()=>{
  const f=fixture();await f.start();const events=[],reference=new Oki6258Synth({transport:{writeRegister:(register,value)=>events.push({method:'write',register,value}),async loadMemory(){},play:options=>events.push({method:'play',repeat:options.repeat}),stop:()=>events.push({method:'stop'}),reset:()=>events.push({method:'reset'})}});
  for(const client of [reference,f.okim6258.client]){client.setDivider(768);client.setPan(true,false);client.writeRegister(12,0);await client.loadMemory(new Uint8Array([0x12,0x34]));client.play({repeat:true});client.stop();}
  assert.deepEqual(f.commands.filter(c=>!c.message.method.startsWith('memory-')).map(c=>{const {chip,...m}=c.message;return m;}),events);assert.equal(f.okim6258.client.sample.bytes,2);assert.equal(f.oki.divider,1024);assert.equal(f.oki.pan,1);
});

test('Native X68000 Worker dispatch retains timing and replies to acknowledged controls',async()=>{
  const f=fixture();await f.start();assert.deepEqual(await f.ym2151.dispatch({method:'writeRegister',args:[0x20,0xc7],id:1},{time:1,performance:9,owner:3}),{id:1});
  assert.deepEqual(f.commands[0],{type:'x68000',frame:48000,performance:9,owner:3,message:{chip:'ym2151',method:'write',register:0x20,value:0xc7}});assert.equal(f.fm.registers[0x20],0);f.advance(48000);assert.equal(f.fm.registers[0x20],0xc7);
  await f.ym2151.dispatch({method:'clock',args:[3600000],id:'clock:1'});await f.okim6258.dispatch({method:'clock',args:[6000000],id:'clock:2'});assert.equal(f.ym2151.client.clock,3600000);assert.equal(f.okim6258.client.clock,6000000);
  assert.deepEqual(await f.okim6258.dispatch({method:'loadMemory',args:[new Uint8Array([12,34]),{sampleRate:8000}],id:2},{time:4,performance:10,owner:6}),{id:2});assert(f.commands.filter(c=>c.message.method.startsWith('memory-')).every(c=>c.frame===0&&c.performance===10&&c.owner===6));
  const n=f.commands.length;await assert.rejects(f.ym2151.dispatch({method:'writeRegister',args:[300,1]}),/Register/);await assert.rejects(f.okim6258.dispatch({method:'play',args:[{repeat:1}]}),/Repeat/);assert.equal(f.commands.length,n);
});

test('Native OKI bounded chunk upload owns bytes and commits a replacement atomically',async()=>{
  const f=fixture();await f.start();await f.okim6258.client.loadMemory(new Uint8Array([88]));const original=f.memory;f.commands.length=0;const input=new Uint8Array(131073).fill(0x87);let flushes=0;
  f.setFlushHook(()=>{if(++flushes<5)assert.equal(f.memory,original);});const pending=f.okim6258.client.loadMemory(input);input.fill(0);await pending;
  assert.deepEqual(f.commands.map(c=>c.message.method),['memory-begin','memory-chunk','memory-chunk','memory-chunk','memory-commit']);assert.deepEqual(f.commands.filter(c=>c.message.method==='memory-chunk').map(c=>c.message.data.length),[65536,65536,1]);assert.equal(f.memory[131072],0x87);assert.equal(f.oki.memoryRevision,2);
});

for(const cancellation of ['session','generation','owner'])test(`Native OKI upload fences each chunk against ${cancellation} cancellation`,async()=>{
  const f=fixture();await f.start();await f.okim6258.client.loadMemory(new Uint8Array([99]));f.commands.length=0;let count=0,cancelled=false;
  f.setFlushHook(()=>{if(++count===2){if(cancellation==='owner')cancelled=true;else f.synth[cancellation]++;}});
  await assert.rejects(f.okim6258.dispatch({method:'loadMemory',args:[new Uint8Array(131073)]},{performance:5,owner:2,checkCurrent(){if(cancelled)throw new DOMException('Retired','AbortError');}}),{name:'AbortError'});
  assert.deepEqual(f.commands.map(c=>c.message.method),['memory-begin','memory-chunk']);assert.equal(f.memory[0],99);assert.equal(f.oki.memoryRevision,1);
});

test('Native OKI validates all metadata before any mutation',async()=>{
  const f=fixture();await f.start();for(const metadata of [{name:'a'.repeat(257)},{frames:1},{sampleRate:NaN},{waveform:[NaN]},{waveform:Array(513).fill(0)},{source:'other'},{unknown:1}])await assert.rejects(f.okim6258.dispatch({method:'loadMemory',args:[new Uint8Array([1,2]),metadata]}));assert.equal(f.commands.length,0);
  await assert.rejects(f.okim6258.dispatch({method:'loadMemory',args:[new Uint8Array()]}),/16 MiB/);assert.equal(f.commands.length,0);
});

test('Native OKI sample loading reuses exact low-nibble-first encoder and bounded waveform',async()=>{
  const f=fixture();await f.start();const pcm={sampleRate:8000,channels:[Float32Array.from({length:103},(_,i)=>Math.sin(i/5)*.5)]};const expected=encodeOki6258(pcm,8000000/1024);const result=await f.okim6258.loadSample(pcm,{sampleRate:8000,name:'voice'});
  assert.deepEqual(f.memory,expected.bytes);assert.equal(result.frames,expected.frames);assert.equal(f.oki.divider,1024);assert.equal((await f.okim6258.read()).sample.name,'voice');assert((await f.okim6258.read()).sample.waveform.length<=512);assert.equal(f.commands[0].message.method,'memory-begin');
});

test('Native OKI asynchronous decode cannot change a newer session or an aborted signal',async()=>{
  const f=fixture();await f.start();let resolveDecode;const pending=f.okim6258.loadSample(new Uint8Array([1,2]),{decodeAudio:()=>new Promise(resolve=>{resolveDecode=resolve;})});while(!resolveDecode)await Promise.resolve();f.synth.generation++;resolveDecode({sampleRate:8000,channels:[new Float32Array([0,.5])]});await assert.rejects(pending,{name:'AbortError'});assert.equal(f.commands.length,0);
  const controller=new AbortController();controller.abort();await assert.rejects(f.okim6258.loadSample({sampleRate:8000,channels:[new Float32Array([0]) ]},{signal:controller.signal}),{name:'AbortError'});assert.equal(f.commands.length,0);
});

test('Native OPM snapshots are observational and expose actual status, IRQ and applied operator order',async()=>{
  const f=fixture();await f.start();f.ym2151.client.setAlgo(1,7,2);const state=f.ym2151.client._getState();await f.ym2151.dispatch({method:'writeRegister',args:[0x21,1]},{time:1});
  assert.equal((await f.ym2151.read()).channels[1].algorithm,7);f.advance(48000);assert.equal((await f.ym2151.read()).channels[1].algorithm,1);assert.deepEqual(f.ym2151.client._getState(),state);
  f.setStatusHook(()=>{const snap=f.snapshot();snap.ym2151.status=5;snap.ym2151.irq=true;return snap;});assert.equal(await f.ym2151.client.readStatus(),5);assert.equal(await f.ym2151.client.getIrq(),true);assert(f.requests.every(r=>r.command==='native_genesis_x68000_status'));
});

for(let ch=0;ch<8;ch++)test(`Native OPM channel ${ch} auditions acquire independent leases and stale release is ignored`,async()=>{
  const f=fixture();await f.start();await f.ym2151.invoke('auditionOn',[ch,69,'old']);const first=f.held[0].get(ch);assert.equal(f.fm.keyMasks[ch],15);
  await f.ym2151.invoke('auditionOn',[ch,72,'new']);assert.notEqual(f.held[0].get(ch),first);const n=f.commands.length;assert.equal(await f.ym2151.invoke('auditionOff',[ch,'old']),false);assert.equal(f.commands.length,n);
  f.ym2151.client.keyOff(ch);assert.equal(f.fm.keyMasks[ch],15);await f.ym2151.invoke('auditionOff',[ch,'new']);assert.equal(f.fm.keyMasks[ch],0);assert.equal(f.held[0].size,0);
});

test('Native OPM Operators edits use logical M1 M2 C1 C2 mapping and synchronize Worker state',async()=>{
  const f=fixture();await f.start();await f.ym2151.invoke('setVoice',[3,{algorithm:6,feedback:2,pan:{left:true,right:false},operators:[{mul:1},{mul:2},{mul:3},{mul:4}]}]);
  assert.deepEqual([0x43,0x53,0x4b,0x5b].map(r=>f.fm.registers[r]&15),[1,2,3,4]);assert.equal(f.ym2151.client._getState().registers[0x53],2);assert(f.events.some(e=>e.name==='opm'));
  await f.ym2151.invoke('setLFO',[{amDepth:12,pmDepth:34}]);const info=await f.ym2151.read();assert.equal(info.lfo.amDepth,12);assert.equal(info.lfo.pmDepth,34);const n=f.commands.length;await assert.rejects(f.ym2151.invoke('setVoice',[0,{algorithm:7,operators:[{mul:30}]}]));assert.equal(f.commands.length,n);
});

test('Native OPM all-off releases all eight manual leases separately',async()=>{
  const f=fixture();await f.start();for(let ch=0;ch<8;ch++)await f.ym2151.invoke('auditionOn',[ch,60,'key'+ch]);f.commands.length=0;await f.ym2151.invoke('auditionAllOff');assert.equal(f.held[0].size,0);assert.deepEqual(f.commands.map(c=>c.message.channel),[0,1,2,3,4,5,6,7]);assert(f.fm.keyMasks.every(v=>v===0));
});

test('Native OKI manual preview requires a sample, supports edits and ignores stale release',async()=>{
  const f=fixture();await f.start();await assert.rejects(f.okim6258.invoke('auditionOn',[0,60,'empty']),/Load/);await f.okim6258.client.loadMemory(new Uint8Array([0x12,0x34]));await f.okim6258.invoke('auditionOn',[0,60,'old']);assert.equal(f.oki.playing,true);
  await f.okim6258.invoke('auditionOn',[0,65,'new']);const n=f.commands.length;assert.equal(await f.okim6258.invoke('auditionOff',[0,'old']),false);assert.equal(f.commands.length,n);f.okim6258.client.stop();assert.equal(f.oki.playing,true);
  await f.okim6258.invoke('setVoice',[{divider:768,pan:{left:false,right:true},repeat:true}]);assert.equal(f.oki.divider,768);assert.equal(f.oki.pan,2);assert.equal(f.oki.repeat,true);assert.equal(f.okim6258.client.divider,768);await f.okim6258.invoke('auditionOff',[0,'new']);assert.equal(f.oki.playing,false);
});

test('Native X68000 Stop preserves authored FM and OKI sample, clock, pan and divider',async()=>{
  const f=fixture();await f.start();f.ym2151.client.setAlgo(7,6,4);await f.ym2151.client.setClock(3500000);await f.okim6258.client.setClock(6000000);f.okim6258.client.setDivider(768);f.okim6258.client.setPan(false,true);await f.okim6258.client.loadMemory(new Uint8Array([11,22]));await f.ym2151.invoke('auditionOn',[7,69,'fm']);await f.okim6258.invoke('auditionOn',[0,60,'oki']);f.stop();
  assert.equal(f.ym2151.client._getState().registers[0x27]&7,6);assert.equal(f.ym2151.client.clock,3500000);assert.equal(f.okim6258.client.clock,6000000);assert.equal(f.okim6258.client.divider,768);assert.equal(f.okim6258.client.pan,2);assert.equal(f.okim6258.client.sample.bytes,2);assert.deepEqual([...f.memory],[11,22]);assert.equal(f.held[0].size+f.held[1].size,0);
  await f.okim6258.invoke('play');assert.equal(f.oki.playing,true);await f.okim6258.invoke('stop');assert.equal(f.oki.playing,false);
});

test('Native X68000 snapshot validation and reset remain device free',async()=>{
  const f=fixture();await f.start();f.setStatusHook(()=>{const s=f.snapshot();s.ym2151.keyMasks=[16];return s;});await assert.rejects(f.ym2151.read(),/snapshot/);f.setStatusHook(()=>{const s=f.snapshot();s.okim6258.sample={bytes:2,frames:7,sampleRate:1,durationSeconds:1};return s;});await assert.rejects(f.okim6258.read(),/metadata/);f.setStatusHook(null);
  f.synth.stopping=Promise.resolve();await assert.rejects(f.ym2151.invoke('auditionAllOff'),{name:'AbortError'});f.synth.stopping=null;const n=f.commands.length;f.ym2151.reset();f.okim6258.reset();assert.equal(f.commands.length,n);assert.equal(f.okim6258.client.sample,null);assert.equal(f.ym2151.client.clock,4000000);
});


test('Native OKI raw metadata normalizes nullable previews and padded frame counts to the Rust contract',async()=>{
  const f=fixture();await f.start();await f.okim6258.dispatch({method:'loadMemory',args:[new Uint8Array([0x12,0x34]),{frames:3,waveform:null}]});
  const metadata=f.commands.find(c=>c.message.method==='memory-begin').message.metadata;assert.equal(metadata.frames,4);assert.deepEqual(metadata.waveform,[]);
  assert.equal((await f.okim6258.read()).sample.frames,4);f.stop();assert.equal(f.okim6258.client.sample.frames,4);
  const count=f.commands.length;await assert.rejects(f.okim6258.dispatch({method:'loadMemory',args:[new Uint8Array([1]),{sampleRate:1000001}]}),/sample rate/);assert.equal(f.commands.length,count);
});

test('Native OPM forced release uses immediate chip key-off while regular keyOff preserves release envelopes',async()=>{
  const f=fixture();await f.start();f.ym2151.client.keyOff(2);f.ym2151.client._forceKeyOff(2);await f.ym2151.dispatch({method:'forceKeyOff',args:[3]});
  assert.deepEqual(f.commands.map(c=>c.message),[{chip:'ym2151',method:'write',register:8,value:2},{chip:'ym2151',method:'key-off',channel:2},{chip:'ym2151',method:'key-off',channel:3}]);
  await f.ym2151.invoke('auditionOn',[7,69,'held']);assert.equal(f.commands.at(-1).message.commands[0].method,'key-off');await f.ym2151.invoke('auditionOff',[7,'held']);assert.deepEqual(f.commands.at(-1).message.commands,[{method:'key-off',channel:7}]);
});


test('Native OKI script replacement reports a held preview while UI replacement commits and releases it',async()=>{
  const f=fixture();await f.start();await f.okim6258.client.loadMemory(new Uint8Array([0x12,0x34]));await f.okim6258.invoke('auditionOn',[0,60,'held']);const previous=f.okim6258.client._getState();
  await assert.rejects(f.okim6258.client.loadMemory(new Uint8Array([0x56,0x78,0x12])),/manual audition/);assert.deepEqual([...f.memory],[0x12,0x34]);assert.deepEqual(f.okim6258.client._getState(),previous);assert.equal(f.held[1].size,1);
  const loaded=await f.okim6258.loadSample({sampleRate:8000,channels:[new Float32Array([0,.3,-.3,.1]) ]},{name:'replacement'});assert.equal(f.oki.sample.name,'replacement');assert.equal(f.held[1].size,0);assert.equal(f.oki.sample.bytes,loaded.bytes);
  const commit=f.commands.filter(c=>c.message.method==='memory-commit').at(-1);assert.equal(commit.message.audition,true);assert(f.requests.some(r=>r.args.after===commit.message.id));assert.equal((await f.okim6258.read()).sample.name,'replacement');
});
