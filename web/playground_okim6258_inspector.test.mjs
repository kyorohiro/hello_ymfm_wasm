import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Oki6258VoiceInspector} from './playground_okim6258_inspector.js';
import {Oki6258AudioEngine} from './okim6258audioengine.js';
import {Oki6258Stream,OKIM6258_CLOCK,encodeOki6258,summarizeOki6258} from './okim6258synth.js';
import {validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {createOki6258Client} from './playground_okim6258.js';
import {NativeRuntimeSynth} from './native_runtime_synth.js';
import {createNativeWorkerApis} from './playground_native_primary.js';
import factory from '../docs/generated/okim6258_wasm.js';

const RATE=48000,peak=values=>values.reduce((p,v)=>Math.max(p,Math.abs(v)),0);
async function setup(){
  let Processor,frame=0,resolveReady;const messages=[],ready=new Promise(resolve=>resolveReady=resolve),port={postMessage:data=>{messages.push(data);if(data.ready||data.error)resolveReady(data);}};
  const source=(await readFile(new URL('./playground_okim6258_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{Oki6258VoiceInspector,Oki6258AudioEngine,Oki6258Stream,OKIM6258_CLOCK,validateChipClock,receiveChipInspector,factory,sampleRate:RATE,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:RATE,nowFrame:()=>frame}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Value)=>Processor=Value});
  const processor=new Processor({processorOptions:{clock:OKIM6258_CLOCK,wasmBinary:await readFile(new URL('../docs/generated/okim6258_wasm.wasm',import.meta.url))}});
  assert.equal((await ready).ready,true,JSON.stringify(messages));
  const clientPort={start(){},close(){},postMessage:data=>processor.receive(data,{postMessage:reply=>clientPort.onmessage?.({data:reply})})},client=createOki6258Client(clientPort);
  return {processor,port,client,clientPort,messages,
    receive(data){processor.receive(data,port);},
    request(action,method,args=[]){processor.receive({type:'chip-inspector',id:'inspect',action,method,args},port);const reply=messages.at(-1);if(reply.error)throw new Error(reply.error);return reply.value;},
    read(){return this.request('read');},invoke(method,args=[]){return this.request('invoke',method,args);},
    render(frames){const out=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[out]);frame+=frames;return out;},
    dispose(){processor.dispose();},
  };
}
function encoded(frames=15625){return encodeOki6258({channels:[Float32Array.from({length:frames},(_,i)=>Math.sin(2*Math.PI*440*i/15625)*.4)],sampleRate:15625},15625);}
async function load(p,frames){const sample=encoded(frames);await p.client.loadMemory(sample.bytes);return sample;}

test('OKI snapshots include applied divider/pan/rate and client-side decoded waveform; reads neither write nor render',async()=>{
  const p=await setup();try{
    assert.equal(p.read().sample,null);await load(p);const state=p.read();assert.equal(state.sample.bytes,7813);assert.equal(state.sample.frames,15626);assert.equal(state.sample.waveform.length,512);assert.equal(state.sample.source,'raw');assert(state.sample.waveform.some(v=>Math.abs(v)>.2));
    p.invoke('setVoice',[{divider:768,pan:{left:false},repeat:true}]);let s=p.read();assert.equal(s.divider,768);assert.equal(s.playbackRate,8000000/768);assert.deepEqual(s.pan,{left:false,right:true});assert.equal(s.repeat,true);
    p.invoke('setVoice',[{pan:{right:false}}]);assert.deepEqual(p.read().pan,{left:false,right:false});p.invoke('setClock',[4000000]);assert.equal(p.read().clock,4000000);p.invoke('setPlaybackRate',[3900]);assert.equal(p.read().divider,1024);
    let writes=0,renders=0;const write=p.processor.engine.writeOki6258.bind(p.processor.engine),render=p.processor.engine.processFrames.bind(p.processor.engine);p.processor.engine.writeOki6258=(...a)=>{writes++;return write(...a);};p.processor.engine.processFrames=(...a)=>{renders++;return render(...a);};
    s=p.read();const invalid=()=>p.invoke('setVoice',[{divider:512,pan:{left:'yes'}}]);assert.throws(invalid,/boolean/);assert.deepEqual(p.read(),s);assert.equal(writes,0);assert.equal(renders,0);
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future',time:.01},commands:[{method:'writeRegister',args:[12,2]}]});assert.deepEqual(p.read(),s);assert.equal(writes,0);assert.equal(renders,0);assert.equal(p.processor.performance.getStats().queuedCommands,1);
    p.render(481);assert.equal(p.read().divider,512);
  }finally{p.dispose();}
});

test('OKI Stop RPC waits for applied silence and lease retirement while keeping sample and playback settings',async()=>{
  const p=await setup();try{
    await load(p);p.invoke('setVoice',[{repeat:true,divider:768,pan:{left:false,right:true}}]);p.invoke('auditionOn',[0,60,'old']);
    const before=p.read();p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future',time:5},commands:[{method:'play',args:[{repeat:true}]}]});
    let release,done=false;const post=p.clientPort.postMessage;
    p.clientPort.postMessage=data=>{if(data.method==='stopVoices')release=()=>post(data);else post(data);};
    const stopped=p.client._stopVoices().then(()=>done=true);p.client._cancelClockRequests('Run stopped');
    await Promise.resolve();assert.equal(done,false);assert.equal(p.read().playing,true);
    release();await stopped;const after=p.read();assert.equal(after.playing,false);assert.equal(after.clock,before.clock);
    assert.equal(after.divider,before.divider);assert.equal(after.repeat,before.repeat);assert.deepEqual(after.pan,before.pan);assert.deepEqual(after.sample,before.sample);
    assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.invoke('auditionOff',[0,'old']),false);
    p.invoke('auditionOn',[0,72,'new']);assert(peak(p.render(4096)[1])>.1);assert.equal(p.read().playing,true);
    p.receive({performance:{session:1,owner:'cleanup',time:5},commands:[{method:'stopVoices',id:'stop-ack'}]});
    assert(p.messages.some(reply=>reply.id==='stop-ack'&&!reply.error));assert.equal(p.read().playing,false);
    assert.equal(p.invoke('auditionOff',[0,'new']),false);assert.equal(p.processor.performance.getStats().queuedCommands,0);
    const pending=p.client._stopVoices();p.client.dispose();await assert.rejects(pending,/disposed/i);
  }finally{p.dispose();}
});

test('OKI admin loading validates all metadata before stopping a current stream and owns immutable waveform data',async()=>{
  const p=await setup();try{
    const sample=await load(p);p.invoke('setVoice',[{repeat:true}]);p.invoke('auditionOn',[0,60,'held']);const before=p.read();
    assert.throws(()=>p.request('loadSample',undefined,[sample.bytes,{name:'invalid',frames:7}]),/frame count/);assert.equal(p.read().playing,true);assert.deepEqual(p.read().sample,before.sample);assert(peak(p.render(4800)[0])>.1);
    const next=encoded(2001),waveform=summarizeOki6258(next.bytes).waveform;
    p.request('loadSample',undefined,[next.bytes,{name:'new.wav',frames:2001,sampleRate:15625,waveform,source:'sample'}]);waveform.fill(0);
    const state=p.read();assert.equal(state.playing,false);assert.equal(state.sample.name,'new.wav');assert.equal(state.sample.frames,2002);assert(state.sample.waveform.some(v=>Math.abs(v)>.1));assert.equal(p.invoke('auditionOff',[0,'held']),false);assert.equal(state.memoryRevision,before.memoryRevision+1);
    assert.throws(()=>p.request('loadSample',undefined,[next.bytes,{waveform:[NaN]}]),/waveform/);assert.equal(p.read().sample.name,'new.wav');
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`OKI ${path}: mono manual preview blocks competing code, retains settings, and rejects stale IDs`,async()=>{
  const p=await setup();try{
    await load(p);p.invoke('setVoice',[{repeat:true,pan:{left:true,right:false},divider:768}]);p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[0,60,'first']);const before=p.read();
    const commands=[{method:'play',args:[{repeat:false}]},{method:'stop',args:[]},{method:'writeRegister',args:[2,2]},{method:'writeRegister',args:[12,0]},{method:'reset',args:[]},{method:'clock',id:'held-clock',args:[4000000]},{method:'loadMemory',id:'held-memory',args:[Uint8Array.of(0)]}];
    if(path==='Main')for(const command of commands)p.receive(command);else p.receive({performance:{session:1,owner:'code',time:.01},commands});
    const out=p.render(4800);assert(peak(out[0])>.1);assert.equal(peak(out[1]),0);let state=p.read();assert.equal(state.divider,before.divider);assert.equal(state.clock,before.clock);assert.equal(state.repeat,true);assert.deepEqual(state.sample,before.sample);
    for(const id of ['held-clock','held-memory'])assert(p.messages.some(m=>m.id===id&&/held/.test(m.error)),'held resource/clock RPCs reject instead of acknowledging a shadow update');
    await assert.rejects(p.client.loadMemory(Uint8Array.of(0)),/held/);await assert.rejects(p.client.setClock(4000000),/held/);assert.equal(p.client.clock,8000000);
    p.invoke('setVoice',[{pan:{left:false,right:true}}]);const right=p.render(4800);assert.equal(peak(right[0]),0);assert(peak(right[1])>.1,'the manual owner can edit live parameters');
    const rate=p.read().playbackRate;p.invoke('auditionOn',[0,84,'replacement']);assert.equal(p.read().playbackRate,rate,'all Guitar MIDI keys use the same hardware sample rate');assert.equal(p.read().positionFrames,0,'replacement restarts the predictor/sample');
    assert.equal(p.invoke('auditionOff',[0,'first']),false);assert.equal(p.read().playing,true);p.invoke('auditionOff',[0,'replacement']);assert.equal(peak(p.render(128)[1]),0);
    p.client.play({repeat:true});assert(peak(p.render(4800)[1])>.1,'code can play after the manual lease is released');
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`OKI ${path}: runtime Stop retains memory/config and clears manual ownership and future notes`,async()=>{
  const p=await setup();try{
    await load(p);p.invoke('setVoice',[{repeat:true,divider:1024,pan:{left:false,right:true}}]);p.invoke('setClock',[4000000]);p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[0,60,'stop']);assert(peak(p.render(4800)[1])>.1);const before=p.read();
    p.receive({performance:{session:1,owner:'future',time:4},commands:[{method:'play',args:[{repeat:true}]}]});
    if(path==='Main'){const runtime=new NativeRuntimeSynth({chip:'x68000'});runtime.primaryApis.adpcm=p.client;runtime.stopAllNative();}
    else{const worker=createNativeWorkerApis([{name:'okim6258',globalName:'adpcm',port:{start(){},postMessage:d=>p.receive(d)},state:p.client._getState()}],{port:p=>p},()=>{});worker.stop();}
    const after=p.read();assert.equal(after.playing,false);assert.equal(after.clock,before.clock);assert.equal(after.divider,before.divider);assert.deepEqual(after.pan,before.pan);assert.equal(after.repeat,before.repeat);assert.deepEqual(after.sample,before.sample);assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.invoke('auditionOff',[0,'stop']),false);assert.equal(peak(p.render(RATE)[1]),0);
    p.receive({type:'performance-start',session:2});p.invoke('auditionOn',[0,60,'next']);p.receive({type:'performance-stop',session:1});assert.equal(p.read().playing,true);assert(peak(p.render(4800)[1])>.1);
    const snapshot=p.read();assert.throws(()=>p.invoke('auditionOn',[1,60,'bad']),/one channel/);assert.throws(()=>p.invoke('auditionOn',[0,128,'bad']),/MIDI/);assert.equal(p.read().playing,snapshot.playing);assert.equal(p.invoke('auditionOff',[0,'next']),true);
  }finally{p.dispose();}
});

test('OKI natural EOF releases the manual lease; one-shot preview and replay produce finite PCM without end DC',async()=>{
  const p=await setup();try{
    await load(p,1000);p.invoke('play');let out=p.render(4800);assert(peak(out[0])>.1);assert(out.every(c=>c.every(v=>Number.isFinite(v)&&Math.abs(v)<1)));assert.equal(peak(out[0].subarray(4000)),0);assert.equal(p.read().playing,false);assert.equal(p.processor.inspector.held(),false);
    p.client.play({repeat:true});assert(peak(p.render(4800)[0])>.1);p.client.stop();assert.equal(peak(p.render(128)[0]),0);
  }finally{p.dispose();}
});
