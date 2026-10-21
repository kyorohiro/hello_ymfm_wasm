import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {GameboyVoiceInspector,NesVoiceInspector} from './playground_native_voice_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {CHIP_CLOCKS,ChipClockResampler,validateChipClock} from './playground_chip_clock.js';
import {GameboyApu} from './gameboyapu.js';
import {GameboySynth} from './gameboysynth.js';
import {NesApuWasm} from './nesapu_wasm.js';
import {NesApuSynth} from './nesapusynth.js';
import {createNesClient} from './playground_nes.js';
import {createNativeWorkerApis} from './playground_native_primary.js';
import {NativeRuntimeSynth} from './native_runtime_synth.js';
import factory from '../docs/generated/gameboy_apu_wasm.js';
import nesFactory from '../docs/generated/nesapu_wasm.js';

const RATE=48000,peak=values=>values.reduce((p,v)=>Math.max(p,Math.abs(v)),0);
async function setup(kind){
  let Processor,frame=0;const messages=[];
  const port={postMessage:m=>messages.push(m)};
  const source=(await readFile(new URL(`./playground_${kind}_worklet.js`,import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{GameboyVoiceInspector,NesVoiceInspector,receiveChipInspector,CHIP_CLOCKS,ChipClockResampler,validateChipClock,GameboyApu,NesApuWasm,factory:kind==='nes'?nesFactory:factory,sampleRate:RATE,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:RATE,nowFrame:()=>frame}),
    AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Value)=>Processor=Value});
  const processor=new Processor({processorOptions:{fds:true,wasmBinary:await readFile(new URL(`../docs/generated/${kind==='nes'?'nesapu':'gameboy_apu'}_wasm.wasm`,import.meta.url))}});
  for(let i=0;i<100&&!messages.some(m=>m.ready||m.error);i++)await new Promise(r=>setTimeout(r,1));
  assert(messages.some(m=>m.ready),JSON.stringify(messages));
  const transport={clock:CHIP_CLOCKS[kind],fdsEnabled:true,writeRegister:(...args)=>processor.receive({method:'writeRegister',args},port),setChannelEnabled:(...args)=>processor.receive({method:'setChannelEnabled',args},port),reset:()=>processor.receive({method:'reset',args:[]},port),loadMemory:(...args)=>processor.receive({method:'loadMemory',args},port)};
  const synth=kind==='gameboy'?new GameboySynth({transport}):new NesApuSynth({transport});if(kind==='gameboy')synth.initialize();
  return {processor,synth,messages,port,
    read(){processor.receive({type:'chip-inspector',id:'read',action:'read'},port);const result=messages.at(-1);if(result.error)throw new Error(result.error);return result.value;},
    invoke(method,args=[]){processor.receive({type:'chip-inspector',id:'invoke',action:'invoke',method,args},port);const result=messages.at(-1);if(result.error)throw new Error(result.error);return result.value;},
    receive(data){processor.receive(data,port);},
    render(frames){const output=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[output]);frame+=frames;return output;},
    dispose(){processor.dispose();},
  };
}

test('Game Boy applied snapshots preserve pulse/noise voices on keyOff and expose editable Wave RAM',async()=>{
  const p=await setup('gameboy');try{
    p.synth.pulse.setVoice(0,{duty:.25,volume:9,envelope:{period:3,direction:'up'}});p.synth.pulse.setSweep({period:4,direction:'down',shift:2});
    p.synth.setPan(0,false,true);p.synth.pulse.noteOn(0,69);p.synth.pulse.keyOff(0);
    const before=p.read(),ch=before.channels[0];assert.equal(ch.volume,9);assert.equal(ch.envelope.period,3);assert.equal(ch.envelope.direction,'up');assert.equal(ch.active,false);assert.deepEqual(ch.pan,{left:false,right:true});assert.equal(ch.duty,.25);assert.equal(ch.sweep.shift,2);
    p.invoke('setVoice',[3,{divisor:3,shift:4}]);assert.equal(p.read().channels[3].frequency,CHIP_CLOCKS.gameboy/(48*16));
    p.invoke('setVoice',[3,{divisor:0,shift:0}]);assert.equal(p.read().channels[3].frequency,524288);
    const wave=Array.from({length:32},(_,i)=>i%16);p.invoke('setVoice',[2,{waveform:wave,level:.25,pan:{left:true,right:false},frequency:220}]);
    const selected=p.read().channels[2];assert.deepEqual(selected.waveform,wave);assert.equal(selected.active,false);assert.equal(selected.level,.25);assert(Math.abs(selected.frequency-220)<1);
    const registers=p.read().registers;p.read();assert.deepEqual(p.read().registers,registers,'read leaves the applied chip unchanged');
    assert.throws(()=>p.invoke('setVoice',[0,{volume:12,duty:.3}]),/Expected one of/);assert.deepEqual(p.read().registers,registers,'invalid whole patch sends no partial writes');
    assert.throws(()=>p.invoke('setVoice',[3,{volume:12,frequency:440}]),/Unknown voice/);
  }finally{p.dispose();}
});

test('NES applied snapshots track native pulse/triangle/noise and preserve disabled FDS wave/modulation data',async()=>{
  const p=await setup('nes');try{
    p.invoke('setPulseVoice',[0,{duty:.125,envelope:{period:7,loop:true},sweep:{enabled:true,period:2,negate:true,shift:3},lengthIndex:12,frequency:440}]);
    p.invoke('setTriangleVoice',[{linearReload:43,lengthHalt:true,lengthIndex:15}]);p.invoke('setNoiseVoice',[{envelope:{period:4,loop:false},period:9,shortMode:true,lengthIndex:20}]);
    const wave=Array.from({length:64},(_,i)=>i),table=Array.from({length:32},(_,i)=>i%8);
    p.invoke('setFdsWave',[wave]);p.invoke('setFdsVolume',[23,2]);p.invoke('setFdsModulation',[{table,rate:1550,depth:22,bias:-14,enabled:false}]);
    const state=p.read();assert.equal(state.channels[0].duty,.125);assert.equal(state.channels[0].lengthIndex,12);assert.deepEqual(state.channels[0].envelope,{period:7,loop:true});assert.equal(state.channels[0].sweep.shift,3);assert.equal(state.channels[2].linearReload,43);assert.equal(state.channels[2].lengthHalt,true);assert.equal(state.channels[3].shortMode,true);assert.equal(state.channels[3].lengthIndex,20);
    assert.deepEqual(state.fds.wave,wave);assert.equal(state.fds.gain,23);assert.equal(state.fds.master,2);assert.deepEqual(state.fds.modulation,{table,rate:1550,depth:22,bias:-14,enabled:false});
    assert.equal(state.dmc.loaded,false);assert.throws(()=>p.invoke('auditionOn',[4,69,'dmc-empty']),/Load a DMC sample/);
    p.synth.transport.loadMemory(new Uint8Array(17).fill(0xaa),0xc000);p.synth.writeRegister(0x4012,0);p.synth.writeRegister(0x4013,1);assert.equal(p.read().dmc.loaded,true);p.invoke('auditionOn',[4,69,'dmc']);p.invoke('auditionOff',[4,'dmc']);
    const before=p.read().registers;assert.throws(()=>p.invoke('setNoiseVoice',[{volume:5,period:99}]),/Noise period/);assert.deepEqual(p.read().registers,before,'invalid whole patch sends no partial writes');
    p.invoke('setPulseVoice',[0,{lengthIndex:12,lengthHalt:false}]);p.invoke('setPulseVoice',[0,{frequency:330,volume:5}]);assert.equal(p.read().channels[0].lengthIndex,12);assert.equal(p.read().channels[0].lengthHalt,false);
    p.invoke('setTriangleVoice',[{lengthIndex:15}]);p.invoke('setTriangleVoice',[{frequency:330}]);assert.equal(p.read().channels[2].lengthIndex,15);
    p.invoke('setFrequency',[0,220]);p.invoke('setFrequency',[2,220]);assert.equal(p.read().channels[0].lengthIndex,12);assert.equal(p.read().channels[2].lengthIndex,15);
    p.invoke('setNoiseVoice',[{lengthHalt:false}]);p.invoke('setNoiseVoice',[{volume:11}]);assert.equal(p.read().channels[3].lengthHalt,false);
    p.invoke('setPulseVoice',[0,{sweep:{period:5}}]);p.invoke('setPulseVoice',[0,{sweep:{enabled:false}}]);assert.equal(p.read().channels[0].sweep.period,5);assert.equal(p.read().channels[0].sweep.shift,3);assert.equal(p.read().channels[0].sweep.enabled,false);
    p.invoke('setFdsVolume',[{gain:17}]);p.invoke('setFdsVolume',[{master:3}]);assert.equal(p.read().fds.gain,17);assert.equal(p.read().fds.master,3);
    const writes=[],write=p.processor.chip.writeRegister.bind(p.processor.chip);p.processor.chip.writeRegister=(address,value)=>{writes.push(address);return write(address,value);};
    p.invoke('setFdsModulation',[{depth:12}]);assert.deepEqual(writes,[0x4084],'a live depth edit must not reset/reupload the modulation table');assert.deepEqual(p.read().fds.modulation.table,table);
    writes.length=0;p.invoke('setFdsModulation',[{rate:1400}]);assert.deepEqual(writes,[0x4086,0x4087]);assert.equal(p.read().fds.modulation.depth,12);
  }finally{p.dispose();}
});

for(const ratio of [.5,2])test(`NES inspector edits support an outer ${ratio}x clock without changing the core clock`,async()=>{
  const p=await setup('nes');try{
    const clock=Math.floor(CHIP_CLOCKS.nes*ratio),before=p.read();
    p.receive({method:'clock',id:'clock',args:[clock]});
    p.invoke('setPulseVoice',[0,{frequency:440,volume:12}]);p.invoke('setFrequency',[5,440]);
    const state=p.read();assert.equal(state.clock,clock);assert.equal(p.processor.chip.clock,CHIP_CLOCKS.nes);
    assert(Math.abs(state.channels[0].frequency-440)<4);assert(Math.abs(state.fds.frequency-440)<1);
    assert.equal(state.channels[0].volume,12);assert.equal(state.channels[1].period,before.channels[1].period);assert.deepEqual(state.fds.wave,before.fds.wave);
  }finally{p.dispose();}
});

test('Game Boy explicit power edits preserve Wave RAM and require power before audition',async()=>{
  const p=await setup('gameboy');try{
    const wave=p.read().channels[2].waveform;p.invoke('setPower',[false]);assert.equal(p.read().powered,false);assert.throws(()=>p.invoke('auditionOn',[0,69,'off']),/initialize/);
    p.invoke('setPower',[true]);assert.equal(p.read().powered,true);assert.deepEqual(p.read().channels[2].waveform,wave);p.invoke('setVoice',[0,{volume:9,duty:.5}]);p.invoke('auditionOn',[0,69,'on']);assert.equal(p.read().channels[0].active,true);
    p.invoke('setPower',[false]);assert.equal(p.invoke('auditionOff',[0,'on']),false,'power OFF retires the manual lease without a later keyOff error');
    p.receive({method:'writeRegister',args:[22,128]});p.receive({method:'writeRegister',args:[1,192]});assert.equal(p.read().channels[0].duty,.75,'code can immediately write after an explicit power OFF');
  }finally{p.dispose();}
});

for(const kind of ['gameboy','nes'])for(const path of ['Main','Worker'])test(`${kind} ${path}: held audition wins over old code, stale releases and Stop cannot resurrect queued notes`,async()=>{
  const p=await setup(kind);try{
    p.receive({type:'performance-start',session:1});
    const writesFor=(midi)=>{
      const commands=[],transport={clock:CHIP_CLOCKS[kind],writeRegister:(...args)=>commands.push({method:'writeRegister',args}),setChannelEnabled:(...args)=>commands.push({method:'setChannelEnabled',args}),reset(){}};
      if(kind==='gameboy'){const synth=new GameboySynth({transport});synth._adoptState({initialized:true,clock:CHIP_CLOCKS.gameboy,registers:p.read().registers,voice:p.read().registers});synth.noteOn(0,midi);}
      else {const synth=new NesApuSynth({transport,initialize:false});synth._adoptState({clock:CHIP_CLOCKS.nes,registers:p.read().registers,enabled:0});synth.noteOn(0,midi);}
      return commands;
    };
    const competing=writesFor(57),sendCode=()=>path==='Main'?competing.forEach(command=>p.receive(command)):p.receive({performance:{session:1,owner:'code',time:.01},commands:competing});
    p.invoke('auditionOn',[0,69,'held-old']);const period=p.read().channels[0].period;sendCode();p.render(1024);assert.equal(p.read().channels[0].period,period,'code cannot retune a held editor key');
    const output=p.render(24000);assert(peak(output[0])>.01);assert(output.every(c=>c.every(x=>Number.isFinite(x)&&Math.abs(x)<1)));
    p.invoke(kind==='gameboy'?'setVoice':'setPulseVoice',[0,{duty:.25,volume:6}]);assert.equal(p.read().channels[0].duty,.25,'UI parameter changes are audible during held audition');
    p.invoke('auditionOn',[0,72,'held-new']);assert.equal(p.invoke('auditionOff',[0,'held-old']),false);assert.equal(p.read().channels[0].active,true);
    p.invoke('auditionOff',[0,'held-new']);assert.equal(p.read().channels[0].active,false);
    // Code resumes at its next future note; past notes were discarded rather than replayed.
    competing.forEach(command=>p.receive(command));assert.equal(p.read().channels[0].active,true);assert.notEqual(p.read().channels[0].period,period);
    p.invoke('auditionOn',[0,69,'held-stop']);p.receive({performance:{session:1,owner:'code',time:5},commands:competing});
    p.receive({type:'performance-stop',session:1});assert.equal(p.read().channels[0].active,false);assert.equal(p.processor.performance.getStats().queuedCommands,0);
    const tail=p.render(48000)[0];assert(peak(tail.subarray(tail.length-1024))<.001,'Stop silences real PCM without a later reserved re-trigger');
    p.receive({type:'performance-start',session:2});p.invoke('auditionOn',[0,69,'next-session']);p.receive({type:'performance-stop',session:1});assert.equal(p.read().channels[0].active,true,'an expired Stop cannot silence the replacement runtime');
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`NES ${path}: raw $4015 changes other channels while retaining only the audition bit`,async()=>{
  const p=await setup('nes');try{
    p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[0,69,'manual']);
    const write=value=>{const command={method:'writeRegister',args:[0x4015,value]};if(path==='Main')p.receive(command);else{p.receive({performance:{session:1,owner:'raw-code',time:0},commands:[command]});p.render(1);}};
    write(2);assert.equal(p.read().channels[0].active,true);assert.equal(p.read().channels[1].active,true);
    write(0);assert.equal(p.read().channels[0].active,true);assert.equal(p.read().channels[1].active,false);
    p.invoke('auditionOff',[0,'manual']);assert.equal(p.read().channels[0].active,false);
  }finally{p.dispose();}
});

for(const [kind,channels]of [['gameboy',[0,1,2,3]],['nes',[0,1,2,3,5]]])test(`${kind}: every melodic/noise/wave audition produces finite real-core PCM`,async()=>{
  const p=await setup(kind);try{
    for(const channel of channels){p.invoke('auditionOn',[channel,69,`channel-${channel}`]);const output=p.render(4800);assert(Math.max(...output.map(peak))>.001,`${kind} channel ${channel} is silent`);assert(output.every(c=>c.every(x=>Number.isFinite(x)&&Math.abs(x)<1)));p.invoke('auditionOff',[channel,`channel-${channel}`]);p.render(24000);}
  }finally{p.dispose();}
});

test('NES DMC: uploaded DPCM metadata, looping audition, Off and Stop use the real native PCM path',async()=>{
  const p=await setup('nes');try{
    p.receive({type:'performance-start',session:1});
    assert.equal(p.read().dmc.loaded,false);
    const bytes=Uint8Array.from({length:17},(_,i)=>i%2?0:255),address=0xc400;
    p.receive({method:'loadMemory',args:[bytes,address],id:'upload-dpcm'});
    assert(p.messages.some(message=>message.id==='upload-dpcm'&&message.value===true));
    p.receive({method:'writeRegister',args:[0x4012,(address-0xc000)/64]});
    p.receive({method:'writeRegister',args:[0x4013,(bytes.length-1)/16]});
    p.invoke('setDmcVoice',[{rate:15,loop:true,level:64}]);
    assert.deepEqual({...p.read().dmc},{channel:4,type:'dmc',rate:15,loop:true,level:64,address,length:17,loaded:true,active:false,enabled:false});
    p.invoke('auditionOn',[4,69,'dpcm-off']);assert.equal(p.read().dmc.active,true);
    const output=p.render(4800);assert(output.every(channel=>channel.every(value=>Number.isFinite(value)&&Math.abs(value)<1)));
    const stable=output[0].subarray(2400);let min=Infinity,max=-Infinity;for(const value of stable){min=Math.min(min,value);max=Math.max(max,value);}
    assert(max-min>.005,'the uploaded DPCM must remain audible after the initial DAC transient');
    p.invoke('auditionOff',[4,'dpcm-off']);assert.equal(p.read().dmc.active,false);
    let tail=p.render(48000)[0];assert(peak(tail.subarray(tail.length-1024))<.001,'Off lets the DMC DAC/DC filter settle to silence');
    p.invoke('auditionOn',[4,69,'dpcm-stop']);assert(peak(p.render(2400)[0])>.001);
    p.receive({type:'performance-stop',session:1});assert.equal(p.read().dmc.active,false);
    tail=p.render(48000)[0];assert(peak(tail.subarray(tail.length-1024))<.001,'Stop cannot leave a looping sample active');
    assert.equal(p.read().dmc.loaded,true,'Off and Stop preserve the uploaded sample for further audition');
  }finally{p.dispose();}
});

for(const path of ['Main','Worker'])test(`NES ${path}: Stop uses applied FDS pitch instead of an obsolete client shadow`,async()=>{
  const p=await setup('nes');try{
    p.receive({type:'performance-start',session:1});
    const oldState=p.synth._getState(),port={start(){},postMessage:message=>p.receive(message)};
    const client=path==='Main'?createNesClient(port,{fdsEnabled:true,state:oldState}):null;
    const worker=path==='Worker'?createNativeWorkerApis([{name:'nes',globalName:'nes',port,fdsEnabled:true,state:oldState}],{port:value=>value},()=>{}):null;
    p.invoke('setFdsModulation',[{rate:300,depth:5,enabled:false}]);p.invoke('auditionOn',[5,69,'fds-applied']);
    const before=p.read().fds;assert(Math.abs(before.frequency-440)<1);assert(peak(p.render(2400)[0])>.001);
    // A stale delayed note must not survive the immediate shutdown command.
    p.receive({performance:{session:1,owner:'future',time:5},commands:[{method:'writeRegister',args:[0x4083,0]}]});
    if(path==='Main'){const runtime=new NativeRuntimeSynth({chip:'nes'});runtime.primaryApis.nes=client;runtime.stopAllNative();}
    else worker.stop();
    const after=p.read().fds;assert.equal(after.period,before.period);assert.equal(after.frequency,before.frequency);assert.deepEqual(after.wave,before.wave);assert.deepEqual(after.modulation,before.modulation);assert.equal(after.active,false);assert.equal(p.processor.performance.getStats().queuedCommands,0);
    const tail=p.render(48000)[0];assert(peak(tail.subarray(tail.length-1024))<.001);
    assert.equal(p.invoke('auditionOff',[5,'fds-applied']),false,'shutdown retires the old editor key identity');
    p.invoke('auditionOn',[5,69,'fds-again']);assert.equal(p.read().fds.period,before.period);assert(peak(p.render(2400)[0])>.001);
  }finally{p.dispose();}
});

test('NES Stop RPC waits for applied FDS silence and lease retirement before a new admin audition',async()=>{
  const p=await setup('nes');try{
    const state=p.synth._getState();let release,done=false;
    const port={start(){},close(){},postMessage:data=>{
      const apply=()=>p.processor.receive(data,{postMessage:reply=>port.onmessage?.({data:reply})});
      if(data.method==='stopVoices')release=apply;else apply();
    }},client=createNesClient(port,{fdsEnabled:true,state});
    p.invoke('setFdsWave',[Array.from({length:64},(_,i)=>i)]);p.invoke('setFdsVolume',[25]);p.invoke('auditionOn',[5,69,'old']);const before=p.read().fds;
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future',time:5},commands:[{method:'writeRegister',args:[0x4083,0]}]});
    const stopped=client._stopVoices().then(()=>done=true);client._cancelClockRequests('Run stopped');
    await Promise.resolve();assert.equal(done,false);assert.equal(p.read().fds.active,true);
    release();await stopped;const after=p.read().fds;assert.equal(after.active,false);assert.equal(after.period,before.period);
    assert.deepEqual(after.wave,before.wave);assert.equal(after.gain,before.gain);assert.deepEqual(after.modulation,before.modulation);
    assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.invoke('auditionOff',[5,'old']),false);
    p.invoke('auditionOn',[5,72,'new']);assert(peak(p.render(4096)[0])>.001);assert.equal(p.read().fds.active,true);
    p.receive({performance:{session:1,owner:'cleanup',time:5},commands:[{method:'stopVoices',id:'stop-ack'}]});
    assert(p.messages.some(reply=>reply.id==='stop-ack'&&!reply.error));assert.equal(p.read().fds.active,false);
    assert.equal(p.invoke('auditionOff',[5,'new']),false);assert.equal(p.processor.performance.getStats().queuedCommands,0);
    const pending=client._stopVoices();client.dispose();await assert.rejects(pending,/disposed/i);
  }finally{p.dispose();}
});

test('NES Worker owner cancellation halts FDS without clearing its frequency high nibble',async()=>{
  const p=await setup('nes');try{
    p.receive({type:'performance-start',session:1});
    p.receive({performance:{session:1,owner:'fds-loop',time:0},commands:[{method:'writeRegister',args:[0x4082,7]},{method:'writeRegister',args:[0x4083,0x44]}]});p.render(128);
    const before=p.read().fds;assert.equal(before.period,1031);assert.equal(before.active,true);
    p.receive({type:'performance-cancel-owner',session:1,owner:'fds-loop'});const after=p.read().fds;assert.equal(after.period,before.period);assert.equal(after.active,false);
    p.receive({method:'stopVoices',args:[]});assert.equal(p.read().fds.period,before.period);
  }finally{p.dispose();}
});

for(const kind of ['gameboy','nes'])test(`${kind}: independent channel audition and applied state do not drain lookahead`,async()=>{
  const p=await setup(kind);try{
    p.receive({type:'performance-start',session:1});
    const command={method:'writeRegister',args:kind==='gameboy'?[1,0xc0]:[0x4000,0xff]};
    const before=p.read().registers;p.receive({performance:{session:1,owner:'loop',time:.02},commands:[command]});assert.deepEqual(p.read().registers,before);assert.equal(p.processor.performance.getStats().queuedCommands,1);
    p.invoke('auditionOn',[1,69,'second']);p.render(1100);assert.notDeepEqual(p.read().registers,before);assert.equal(p.read().channels[1].active,true);assert.equal(p.processor.performance.getStats().queuedCommands,0);
    p.invoke('auditionAllOff');assert.equal(p.read().channels[1].active,false);
  }finally{p.dispose();}
});
