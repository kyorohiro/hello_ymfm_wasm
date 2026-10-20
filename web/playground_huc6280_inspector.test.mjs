import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Huc6280VoiceInspector} from './playground_huc6280_inspector.js';
import {Huc6280AudioEngine} from './huc6280audioengine.js';
import {HUC6280_CLOCK} from './huc6280synth.js';
import {createHuc6280Client} from './playground_huc6280.js';
import {ChipClockResampler,validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {NativeRuntimeSynth} from './native_runtime_synth.js';
import {createNativeWorkerApis} from './playground_native_primary.js';
import factory from '../docs/generated/huc6280_wasm.js';

const RATE=48000,peak=values=>values.reduce((p,v)=>Math.max(p,Math.abs(v)),0);
async function setup(){
  let Processor,frame=0,resolveReady;const messages=[],ready=new Promise(resolve=>resolveReady=resolve),port={postMessage:data=>{messages.push(data);if(data.ready||data.error)resolveReady(data);}};
  const source=(await readFile(new URL('./playground_huc6280_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{Huc6280VoiceInspector,Huc6280AudioEngine,HUC6280_CLOCK,ChipClockResampler,validateChipClock,receiveChipInspector,factory,sampleRate:RATE,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:RATE,nowFrame:()=>frame}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Value)=>Processor=Value});
  const processor=new Processor({processorOptions:{clock:HUC6280_CLOCK,wasmBinary:await readFile(new URL('../docs/generated/huc6280_wasm.wasm',import.meta.url))}});assert.equal((await ready).ready,true,JSON.stringify(messages));
  const clientPort={start(){},close(){},postMessage:data=>processor.receive(data,{postMessage:reply=>clientPort.onmessage?.({data:reply})})},client=createHuc6280Client(clientPort);client.initialize();
  return {processor,client,clientPort,messages,port,
    receive(data){processor.receive(data,port);},
    read(){processor.receive({type:'chip-inspector',id:'read',action:'read'},port);const reply=messages.at(-1);if(reply.error)throw new Error(reply.error);return reply.value;},
    invoke(method,args=[]){processor.receive({type:'chip-inspector',id:'invoke',action:'invoke',method,args},port);const reply=messages.at(-1);if(reply.error)throw new Error(reply.error);return reply.value;},
    render(frames){const out=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[out]);frame+=frames;return out;},dispose(){processor.dispose();},
  };
}
const wave=Array.from({length:32},(_,i)=>i<16?31:0);
const stripGate=state=>({...state,channels:state.channels.map(ch=>({...ch,active:false,enabled:false,registers:ch.registers.map((v,r)=>r===4?v&127:v),waveformPointer:null}))});

test('PCE all six channels expose applied waveform/volume/pan/pitch/noise and atomic edits never issue read writes',async()=>{
  const p=await setup();try{
    for(let ch=0;ch<6;ch++){
      p.invoke('setVoice',[ch,{volume:17+ch,pan:{left:12,right:ch},frequency:440,waveform:wave}]);const voice=p.read().channels[ch];assert.equal(voice.volume,17+ch);assert.deepEqual(voice.pan,{left:12,right:ch});assert(Math.abs(voice.frequency-440)<2);assert.deepEqual(voice.waveform,wave);assert.equal(voice.waveformKnown,true);assert.equal(voice.active,false);
      if(ch>=4){p.invoke('setVoice',[ch,{noise:{enabled:true,frequency:27}}]);p.invoke('setVoice',[ch,{noise:{frequency:15}}]);assert.deepEqual(p.read().channels[ch].noise,{enabled:true,frequency:15});}
      const before=p.read();let writes=0,rendered=0;const write=p.processor.chip.writeHuc6280.bind(p.processor.chip),render=p.processor.chip.processFrames.bind(p.processor.chip);p.processor.chip.writeHuc6280=(...a)=>{writes++;return write(...a);};p.processor.chip.processFrames=(...a)=>{rendered++;return render(...a);};
      p.read();assert.throws(()=>p.invoke('setVoice',[ch,{volume:5,pan:{left:16}}]),/balance/);assert.deepEqual(p.read(),before);assert.equal(writes,0);assert.equal(rendered,0);p.processor.chip.writeHuc6280=write;p.processor.chip.processFrames=render;
    }
    p.invoke('setMasterVolume',[{left:9}]);assert.deepEqual(p.read().masterVolume,{left:9,right:15});p.invoke('setLfo',[{frequency:23,depth:2,reset:true}]);p.invoke('setLfo',[{depth:1}]);assert.deepEqual(p.read().lfo,{frequency:23,depth:1,reset:true});
    p.invoke('setVoice',[0,{period:0}]);assert.equal(p.read().channels[0].frequency,HUC6280_CLOCK/(32*4096));
    const before=p.read();assert.throws(()=>p.invoke('setVoice',[0,{volume:12,noise:{enabled:true}}]),/Noise/);assert.deepEqual(p.read(),before);
  }finally{p.dispose();}
});

test('PCE Stop RPC waits for applied gates and lease retirement before a new admin audition',async()=>{
  const p=await setup();try{
    p.invoke('setVoice',[0,{volume:23,pan:{left:15,right:11},frequency:440,waveform:wave}]);p.invoke('auditionOn',[0,69,'old']);
    const before=p.read();p.receive({type:'performance-start',session:1});
    p.receive({performance:{session:1,owner:'future',time:5},commands:[{method:'writeRegister',args:[4,255],channel:0}]});
    let release,done=false;const post=p.clientPort.postMessage;
    p.clientPort.postMessage=data=>{if(data.method==='stopVoices')release=()=>post(data);else post(data);};
    const stopped=p.client._stopVoices().then(()=>done=true);p.client._cancelClockRequests('Run stopped');
    await Promise.resolve();assert.equal(done,false);assert.equal(p.read().channels[0].active,true);
    release();await stopped;const after=p.read().channels[0],old=before.channels[0];
    assert.equal(after.active,false);assert.deepEqual(after.waveform,old.waveform);assert.equal(after.period,old.period);
    assert.equal(after.volume,old.volume);assert.deepEqual(after.pan,old.pan);assert.equal(p.read().clock,before.clock);
    assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.invoke('auditionOff',[0,'old']),false);
    p.invoke('auditionOn',[0,72,'new']);assert(peak(p.render(4096)[0])>.01);assert.equal(p.read().channels[0].active,true);
    p.receive({performance:{session:1,owner:'cleanup',time:5},commands:[{method:'stopVoices',id:'stop-ack'}]});
    assert(p.messages.some(reply=>reply.id==='stop-ack'&&!reply.error));assert.equal(p.read().channels[0].active,false);
    assert.equal(p.invoke('auditionOff',[0,'new']),false);assert.equal(p.processor.performance.getStats().queuedCommands,0);
    const pending=p.client._stopVoices();p.client.dispose();await assert.rejects(pending,/disposed/i);
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`PCE ${path}: selected-channel metadata targets registers independently of another writer’s hardware latch`,async()=>{
  const p=await setup();try{
    p.receive({type:'performance-start',session:1});p.client.writeRegister(0,5);const before=p.read();
    const commands=[{method:'writeRegister',args:[0,2],channel:5},{method:'writeRegister',args:[2,123],channel:0},{method:'writeRegister',args:[3,4],channel:0},{method:'writeRegister',args:[5,0xa3],channel:1}];
    if(path==='Main')commands.forEach(c=>p.receive(c));else {p.receive({performance:{session:1,owner:'writer',time:0},commands});p.render(1);}
    const state=p.read();assert.equal(state.selectedChannel,2,'register 0 uses its value, not old channel metadata');assert.equal(state.channels[0].period,0x47b);assert.deepEqual(state.channels[1].pan,{left:10,right:3});assert.deepEqual(state.channels[2].registers,before.channels[2].registers);assert.deepEqual(state.channels[5].registers,before.channels[5].registers);
    p.invoke('setVoice',[4,{volume:22,pan:{left:3,right:6}}]);assert.equal(p.read().selectedChannel,2,'an editor edit restores the previous hardware selector');
    // Raw batches without metadata resolve their selection only when applied.
    p.receive({performance:{session:1,owner:'raw',time:.01},commands:[{method:'writeRegister',args:[0,3],channel:1},{method:'writeRegister',args:[5,0x95]}]});p.render(481);assert.deepEqual(p.read().channels[3].pan,{left:9,right:5});
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`PCE ${path}: UI waveform/volume edits preserve code note ownership and the selected latch`,async()=>{
  const p=await setup();try{
    p.receive({type:'performance-start',session:1});const commands=[{method:'writeRegister',args:[4,152],channel:0}],send=(owner,commands,time=0)=>p.receive({performance:{session:1,owner,time},commands});
    send('melody',commands);p.render(128);p.client.writeRegister(0,5);assert(p.read().channels[0].active);
    p.invoke('setVoice',[0,{volume:25}]);p.invoke('setWaveform',[0,wave]);assert.equal(p.read().selectedChannel,5);assert.equal(p.read().channels[0].active,true);assert.deepEqual(p.read().channels[0].waveform,wave);assert(peak(p.render(4800)[0])>.01);
    if(path==='Main')send('melody',[{method:'keyOff',args:[0]}]);else p.receive({type:'performance-cancel-owner',session:1,owner:'melody'});
    p.render(128);assert.equal(p.read().channels[0].active,false);assert.equal(peak(p.render(128)[0]),0,'the old code owner must still be able to release its edited voice');
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`PCE ${path}: manual lease protects only its channel, globals and raw fallback; other channel writes continue`,async()=>{
  const p=await setup();try{
    p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[0,69,'held']);const before=p.read();
    const commands=[{method:'writeRegister',args:[0,0],channel:5},{method:'writeRegister',args:[4,0]},{method:'writeRegister',args:[2,20],channel:0},{method:'writeRegister',args:[5,0],channel:0},{method:'writeRegister',args:[1,0]},{method:'writeRegister',args:[9,3]},{method:'writeRegister',args:[4,143],channel:1},{method:'writeRegister',args:[5,0x8f],channel:1}];
    if(path==='Main')commands.forEach(c=>p.receive(c));else p.receive({performance:{session:1,owner:'code',time:.01},commands});
    p.render(1024);const state=p.read();assert.equal(state.channels[0].active,true);assert.equal(state.channels[0].frequency,before.channels[0].frequency);assert.deepEqual(state.channels[0].pan,before.channels[0].pan);assert.deepEqual(state.masterVolume,before.masterVolume);assert.deepEqual(state.lfo,before.lfo);assert.equal(state.channels[1].active,true);assert.deepEqual(state.channels[1].pan,{left:8,right:15});
    await assert.rejects(p.client.setClock(4000000),/held/);assert.equal(p.read().clock,HUC6280_CLOCK);
    p.invoke('setWaveform',[0,wave]);assert.equal(p.read().channels[0].active,true);assert.deepEqual(p.read().channels[0].waveform,wave);assert.equal(p.read().channels[0].waveformKnown,true);
    p.invoke('auditionOn',[0,72,'replacement']);assert.equal(p.invoke('auditionOff',[0,'held']),false);assert(p.read().channels[0].active);p.invoke('auditionOff',[0,'replacement']);assert.equal(p.read().channels[0].active,false);assert.equal(p.read().channels[1].active,true);
  }finally{p.dispose();}
});

test('PCE DDA editing disables its gate, note audition rejects DC mode, and raw unknown wave-pointer edits are reported honestly',async()=>{
  const p=await setup();try{
    p.invoke('auditionOn',[0,69,'held']);p.invoke('setVoice',[0,{dda:true,ddaValue:23}]);let voice=p.read().channels[0];assert.equal(voice.active,false);assert.equal(voice.dda,true);assert.equal(voice.ddaValue,23);assert.equal(p.invoke('auditionOff',[0,'held']),false);assert.throws(()=>p.invoke('auditionOn',[0,60,'dc']),/DDA/);assert.equal(peak(p.render(128)[0]),0);
    p.invoke('setWaveform',[0,wave]);voice=p.read().channels[0];assert.deepEqual(voice.waveform,wave);assert.equal(voice.dda,true);assert.equal(voice.ddaValue,23);
    p.invoke('setVoice',[0,{dda:false}]);p.client.keyOn(0);p.render(128);assert.equal(p.read().channels[0].waveformKnown,true,'playback changes its pointer, not known RAM');
    p.receive({method:'writeRegister',args:[6,7],channel:0});assert.equal(p.read().channels[0].waveformKnown,false,'raw writes at a core-owned playback index cannot pretend to update a known RAM position');p.invoke('setWaveform',[0,wave]);assert.equal(p.read().channels[0].waveformKnown,true);assert(p.read().channels[0].active);
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`PCE ${path}: Stop clears current/future/manual gates while preserving applied waveform, volume, DDA, noise, LFO, pan and pitch`,async()=>{
  const p=await setup();try{
    p.receive({type:'performance-start',session:1});p.invoke('setVoice',[3,{dda:true,ddaValue:22,volume:13}]);p.invoke('setVoice',[4,{noise:{enabled:true,frequency:19}}]);p.invoke('setLfo',[{frequency:3,depth:1,reset:true}]);p.invoke('auditionOn',[0,69,'stop']);p.render(4800);const before=p.read();
    p.receive({performance:{session:1,owner:'future',time:4},commands:[{method:'writeRegister',args:[4,152],channel:0}]});
    if(path==='Main'){const runtime=new NativeRuntimeSynth({chip:'huc6280'});runtime.primaryApis.pce=p.client;runtime.stopAllNative();}
    else {const worker=createNativeWorkerApis([{name:'huc6280',globalName:'pce',port:{start(){},postMessage:d=>p.receive(d)},state:p.client._getState()}],{port:p=>p},()=>{});worker.stop();}
    const after=p.read();assert(after.channels.every(c=>!c.active));assert.deepEqual(stripGate(after),stripGate(before));assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.invoke('auditionOff',[0,'stop']),false);assert.equal(peak(p.render(RATE)[0]),0);
    p.receive({type:'performance-start',session:2});p.invoke('auditionOn',[0,72,'next']);p.receive({type:'performance-stop',session:1});assert.equal(p.read().channels[0].active,true);assert(peak(p.render(4800)[0])>.01);
  }finally{p.dispose();}
});

test('PCE all six wavetable channels and both noise channels audition finite real-core PCM with matching base pitch',async()=>{
  const p=await setup();try{
    for(let ch=0;ch<6;ch++){
      p.invoke('setVoice',[ch,{waveform:wave,volume:24,pan:{left:15,right:0}}]);p.invoke('auditionOn',[ch,69,`ch-${ch}`]);const pcm=p.render(RATE)[0];assert(peak(pcm)>.01);assert(pcm.every(v=>Number.isFinite(v)&&Math.abs(v)<1));let rises=0;for(let i=1;i<pcm.length;i++)if(pcm[i-1]<0&&pcm[i]>=0)rises++;assert(Math.abs(rises-p.read().channels[ch].frequency)<3);p.invoke('auditionOff',[ch,`ch-${ch}`]);
      if(ch>=4){p.invoke('setVoice',[ch,{noise:{enabled:true,frequency:20}}]);const period=p.read().channels[ch].period;p.invoke('auditionOn',[ch,0,`noise-${ch}`]);assert.equal(p.read().channels[ch].period,period,'noise audition ignores note pitch');assert(peak(p.render(4800)[0])>.01);p.invoke('auditionOff',[ch,`noise-${ch}`]);}
    }
  }finally{p.dispose();}
});
