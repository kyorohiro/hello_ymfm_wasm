import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {encodeWav} from './wav.js';

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function wav(frames){
  return encodeWav({sampleRate:44100,left:Float32Array.from({length:frames},(_,i)=>Math.sin(i*0.2)*0.1),
    right:Float32Array.from({length:frames},(_,i)=>Math.cos(i*0.3)*0.15)});
}
function fixture(t,{mode='pc-engine-cd'}={}){
  const previous=Object.fromEntries(['window','AudioContext','AudioWorkletNode'].map(name=>[name,{own:Object.hasOwn(globalThis,name),value:globalThis[name]}]));
  let audioConstructions=0,session=0,nextUpload=0;
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=globalThis.AudioWorkletNode=class{constructor(){audioConstructions++;throw new Error('Native system-audio inspection must not create Web Audio');}};
  const calls=[],errors=[],reads=[],uploads=new Map(),gates=new Map(),pendingStates=new Set();
  const files=new Map([['/disc.wav',wav(64)],['/replacement.wav',wav(31)],
    ['/voice.adpcm',Uint8Array.of(0x37,0xf1,0x80)],['/replacement.adpcm',Uint8Array.of(0x17,0x28,0x39,0x40,0x51)]]);
  const states={msm5205:{state:'ready',sourceBytes:0,positionNibbles:0,offset:0,length:0,rate:15,clock:1536000,signal:0,step:0,phase:0,outputFrames:0},
    cdda:{state:'ready',positionFrames:0,durationFrames:0,phase:0,outputFrames:0}};
  const opnRegisters=[Array(256).fill(0),Array(256).fill(0)];let opnRomLoaded=false,opnMemoryBytes=0;
  const applyOpn=message=>{
    if(message.method==='write')opnRegisters[message.port][message.register]=message.value;
    if(message.method==='rom')opnRomLoaded=true;
    if(message.method==='memory')opnMemoryBytes=Math.max(opnMemoryBytes,message.offset+message.data.length);
    if(message.method==='batch')message.commands.forEach(applyOpn);
  };
  const status=()=>({session,mode,sampleRate:48000,frame:0,ymClock:8000000,huc6280Clock:3579545,running:true});
  const synth=new NativeGenesisSynth({mode,now:()=>0,fetcher:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(8192).buffer}),
    onError:error=>errors.push(error),invoke:async(command,args={},options)=>{
      calls.push({command,args,options});
      if(command==='native_genesis_start'){session++;return status();}
      if(command==='native_genesis_commands')for(const item of args.commands)if(item.type==='ym2608')applyOpn(item.message);
      if(command==='native_genesis_ym2608_status')return{...status(),clock:8000000,
        registers:structuredClone(opnRegisters),held:[],pendingCommands:[],romLoaded:opnRomLoaded,
        adpcmMemoryBytes:opnMemoryBytes,status:0,statusHi:0,irq:false,revision:calls.length};
      if(command==='native_genesis_huc6280_status')return{
        clock:3579545,selectedChannel:0,globals:Array(10).fill(0),
        registers:Array.from({length:8},()=>Array(8).fill(0)),
        waveforms:Array.from({length:8},()=>Array(32).fill(0)),indices:Array(8).fill(0),ddaValues:Array(8).fill(0),
        pointerKnown:Array(8).fill(true),waveformKnown:Array(8).fill(true),knownSamples:Array(8).fill(0xffffffff),held:[],pendingCommands:[],
      };
      const match=/^native_genesis_(msm5205|cdda)_(load_begin|load_chunk|load_finalize|load_abort|action|state)$/.exec(command);
      if(!match)return status();
      const [,kind,operation]=match,state=states[kind];
      if(operation==='load_begin'){
        const upload=++nextUpload;uploads.set(upload,{kind,data:new Uint8Array(args.bytes),written:0});
        return{upload,maxChunkBytes:16384};
      }
      if(operation==='load_chunk'){
        assert(args instanceof Uint8Array,'the existing upload transports actual bytes');
        const id=Number(options.headers[`x-${kind}-upload`]),offset=Number(options.headers[`x-${kind}-offset`]);
        const upload=uploads.get(id);assert(upload);assert.equal(offset,upload.written);
        upload.data.set(args,offset);upload.written+=args.length;return;
      }
      if(operation==='load_finalize'){
        const upload=uploads.get(args.upload);assert(upload);assert.equal(upload.written,upload.data.length);
        state.state='ready';if(kind==='msm5205'){state.sourceBytes=upload.data.length;state.length=upload.data.length*2;}
        else state.durationFrames=upload.data.length/4;
        return structuredClone(state);
      }
      if(operation==='load_abort'){uploads.delete(args.upload);return;}
      if(operation==='state'){
        const gate=gates.get(kind);if(gate){gates.delete(kind);gate.started.resolve();return gate.finished.promise.finally(()=>pendingStates.delete(gate));}
        return structuredClone(state);
      }
      const action=args.action;
      if(action.type==='play'){
        state.state='playing';if(kind==='msm5205')Object.assign(state,{offset:action.offset,length:action.length,rate:action.rate,loop:action.loop,positionNibbles:action.offset});
        else state.positionFrames=action.sourceFrame??0;
      }
      if(action.type==='pause')state.state='paused';if(action.type==='resume')state.state='playing';
      if(action.type==='stop')state.state='ready';
      return structuredClone(state);
    }});
  const runtime=createPlaygroundRuntime({synth,guardExecution:false,readCddaFile:async path=>{
    reads.push(path);assert(files.has(path),'unexpected source read: '+path);return files.get(path);
  }});
  t.after(async()=>{
    for(const gate of pendingStates)gate.finished.resolve({state:'ready'});
    try{await runtime.finalize();}finally{
      for(const [name,old]of Object.entries(previous))if(old.own)globalThis[name]=old.value;else delete globalThis[name];
    }
  });
  return{synth,runtime,calls,errors,reads,files,uploads,states,audioConstructions:()=>audioConstructions,
    deferState(kind){const gate={started:deferred(),finished:deferred()};gates.set(kind,gate);pendingStates.add(gate);return gate;},
    async prepare(kind,replacement=false){
      const path=kind==='msm5205'?(replacement?'/replacement.adpcm':'/voice.adpcm'):(replacement?'/replacement.wav':'/disc.wav');
      await runtime.playSource(kind==='msm5205'?`await adpcm.loadMemory(${JSON.stringify(path)});`
        :`await cdda.load(${JSON.stringify(path)}); await cdda.play(); await cdda.pause();`);
      await synth.flush();
    }};
}
const stateCommand=kind=>`native_genesis_${kind}_state`;

test('opening system-audio inspectors on an idle runtime performs no audio setup, IPC or source reads',async t=>{
  const f=fixture(t);
  for(let i=0;i<3;++i)assert.deepEqual(await Promise.all(['msm5205','cdda'].map(kind=>f.runtime.getSystemAudioState(kind))),[null,null]);
  for(const kind of ['',null,undefined,'huc6280','adpcm','ym2608'])await assert.rejects(f.runtime.getSystemAudioState(kind),RangeError);
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.reads,[]);assert.equal(f.synth.state,'idle');
  assert.equal(f.runtime.getState().audio,'idle');assert.equal(f.synth.audioContext,null);assert.equal(f.audioConstructions(),0);
});

for(const kind of ['msm5205','cdda']){
  test(`${kind} inspector reads only its already prepared source and retains playback and Mixer state`,async t=>{
    const f=fixture(t);await f.prepare(kind);
    f.synth.mixer.set(kind,{volume:0.7,pan:-0.25,muted:true});await f.synth.flush();
    const previousState=structuredClone(f.states),sourceReads=[...f.reads],connections=f.synth.mixer.list().map(s=>[s.id,s.connected]);
    f.calls.length=0;
    const state=await f.runtime.getSystemAudioState(kind);
    assert.deepEqual(f.calls.map(call=>call.command),[stateCommand(kind)]);
    assert.deepEqual(f.states,previousState);assert.deepEqual(f.reads,sourceReads);
    assert.deepEqual(f.synth.mixer.list().map(s=>[s.id,s.connected]),connections);
    assert.equal(state.volume,0.7);assert.equal(state.pan,-0.25);assert.equal(state.mute,true);
    assert.equal(state.sampleRate,48000);
    if(kind==='msm5205'){
      assert.equal(state.state,'ready');assert.equal(state.sourceBytes,3);assert.equal(state.sample.bytes,3);assert.equal(state.sample.frames,6);
      assert.deepEqual([...f.uploads.values()].find(upload=>upload.kind===kind).data,f.files.get('/voice.adpcm'));
    }else{
      assert.equal(state.state,'paused');assert.equal(state.durationFrames,64);assert.equal(state.track,1);assert.equal(state.tracks.length,1);
      assert.equal([...f.uploads.values()].find(upload=>upload.kind===kind).data.length,64*4);
    }
    f.calls.length=0;
    assert.equal(await f.runtime.getSystemAudioState(kind==='msm5205'?'cdda':'msm5205'),null);
    assert.deepEqual(f.calls,[],'inspecting the other absent source must not attach it');
    assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.equal(f.audioConstructions(),0);assert.deepEqual(f.errors,[]);
  });

  test(`${kind} inspector drops an in-flight successful snapshot after Stop without recreating its source`,async t=>{
    const f=fixture(t);await f.prepare(kind);const gate=f.deferState(kind);
    const pending=f.runtime.getSystemAudioState(kind);await gate.started.promise;
    const stopping=f.runtime.stopWithFade();
    const before=f.calls.length;assert.equal(await f.runtime.getSystemAudioState(kind),null);assert.equal(f.calls.length,before);
    gate.finished.resolve(structuredClone(f.states[kind]));
    assert.equal(await pending,null);await stopping;
    f.calls.length=0;assert.equal(await f.runtime.getSystemAudioState(kind),null);assert.deepEqual(f.calls,[]);
    assert.equal(f.audioConstructions(),0);assert.deepEqual(f.errors,[]);
  });

  test(`${kind} inspector drops a late failed snapshot after Stop and permits the next source`,async t=>{
    const f=fixture(t);await f.prepare(kind);const gate=f.deferState(kind);
    const pending=f.runtime.getSystemAudioState(kind);await gate.started.promise;
    const stopping=f.runtime.stopWithFade();gate.finished.reject(new DOMException('Old native observer cancelled','AbortError'));
    assert.equal(await pending,null);await stopping;
    await f.prepare(kind,true);const current=await f.runtime.getSystemAudioState(kind);
    assert.equal(kind==='msm5205'?current.sample.bytes:current.durationFrames,kind==='msm5205'?5:31);
    assert.deepEqual(f.errors,[]);
  });

  test(`${kind} inspector cannot publish an old snapshot into a replacement Run`,async t=>{
    const f=fixture(t);await f.prepare(kind);const gate=f.deferState(kind);
    const pending=f.runtime.getSystemAudioState(kind);await gate.started.promise;
    const replacing=f.prepare(kind,true);
    // playSource changes the Run identity synchronously, before awaiting its
    // cleanup/command barriers. The delayed read belongs to the previous Run.
    await Promise.resolve();gate.finished.resolve(structuredClone(f.states[kind]));
    assert.equal(await pending,null);await replacing;
    const current=await f.runtime.getSystemAudioState(kind);
    assert.equal(kind==='msm5205'?current.sample.bytes:current.durationFrames,kind==='msm5205'?5:31);
    assert.deepEqual(f.errors,[]);assert.equal(f.audioConstructions(),0);
  });

  test(`${kind} inspector propagates a real error from the current source rather than reporting an absent device`,async t=>{
    const f=fixture(t);await f.prepare(kind);
    for(const error of [new Error('Native read failed'),new DOMException('Active observer cancelled','AbortError')]){
      const gate=f.deferState(kind),pending=f.runtime.getSystemAudioState(kind);
      const rejected=assert.rejects(pending,actual=>actual===error);await gate.started.promise;gate.finished.reject(error);await rejected;
    }
    assert.notEqual(await f.runtime.getSystemAudioState(kind),null,'a transient read failure does not prepare or destroy the source');
    assert.deepEqual(f.errors,[]);
  });
}

test('PC-98 adpcm remains YM2608 ADPCM while system-source inspection leaves MSM5205 disconnected',async t=>{
  const f=fixture(t,{mode:'pc98'});
  await f.runtime.playSource(`
    context.opnAdpcm=adpcm;
    await adpcm.loadMemory(Uint8Array.of(0x12,0x34),8);
    adpcm.setVolume(177);adpcm.keyOn();
  `);
  await f.synth.flush();
  const commands=f.calls.filter(call=>call.command==='native_genesis_commands').flatMap(call=>call.args.commands);
  assert(commands.some(command=>command.type==='ym2608'&&command.message.method==='memory'));
  assert.equal(typeof f.runtime.context.opnAdpcm.keyOn,'function');assert.equal(typeof f.runtime.context.opnAdpcm.setDeltaN,'function');
  assert(!f.calls.some(call=>/^native_genesis_msm5205_/.test(call.command)));
  f.calls.length=0;
  assert.equal(await f.runtime.getSystemAudioState('msm5205'),null);assert.equal(await f.runtime.getSystemAudioState('cdda'),null);
  assert.deepEqual(f.calls,[]);assert.deepEqual(f.reads,[]);assert.equal(f.audioConstructions(),0);
  assert.equal(f.synth.state,'ready');assert.deepEqual(f.errors,[]);
});
