import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Ay8910} from './ay8910.js';
import factory from '../docs/generated/ay8910_wasm.js';
import {createAy8910Client} from './playground_ay8910.js';
import {Ay8910VoiceInspector} from './playground_ay8910_inspector.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {validateChipClock,ChipClockResampler} from './playground_chip_clock.js';
const RATE=48000,peak=values=>values.reduce((result,value)=>Math.max(result,Math.abs(value)),0);
async function setup(options={}){
  let Processor,frame=0,ready;const messages=[],port={postMessage:message=>{messages.push(message);if(message.ready||message.error)ready(message);}},started=new Promise(resolve=>ready=resolve);
  const source=(await readFile(new URL('./playground_ay8910_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{Ay8910,factory,Ay8910VoiceInspector,receiveChipInspector,validateChipClock,ChipClockResampler,sampleRate:RATE,createProcessorPerformance:options=>createProcessorPerformance({...options,rate:RATE,nowFrame:()=>frame}),AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Type)=>Processor=Type});
  const processor=new Processor({processorOptions:{...options,wasmBinary:await readFile(new URL('../docs/generated/ay8910_wasm.wasm',import.meta.url))}});assert.equal((await started).ready,true,JSON.stringify(messages));
  const clientPort={start(){},close(){},postMessage:data=>processor.receive(data,{postMessage:reply=>clientPort.onmessage?.({data:reply})})},client=createAy8910Client(clientPort,{clock:options.clock});client.initialize();
  return {processor,client,messages,port,receive:data=>processor.receive(data,port),read:()=>processor.inspector.read(),invoke:(method,args=[])=>processor.inspector.invoke(method,args),render(frames){const output=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[output]);frame+=frames;return output;},close(){client.dispose();processor.dispose();}};
}
test('AY inspection exposes exactly three tone/noise mixes and shared envelope without writes or PCM advancement',async()=>{
  const p=await setup();try{
    p.client.setVoice(2,{tone:true,noise:true,volume:7,envelope:true,note:'A4'});p.client.setNoisePeriod(19);p.client.setEnvelope({period:1234,shape:10});p.client.keyOff(2);
    const state=p.read();assert.equal(state.channels.length,3);assert.equal(state.keyboardChannels.length,3);assert.equal(state.channels[2].toneEnabled,true);assert.equal(state.channels[2].noiseEnabled,true);assert.equal(state.channels[2].volume,0);assert.equal(state.channels[2].configuredVolume,7);assert.equal(state.channels[2].configuredEnvelope,true);assert.equal(state.noise.period,19);assert.equal(state.envelope.period,1234);assert.equal(state.envelope.shape,10);
    const before=state.registers;assert.throws(()=>p.invoke('setVoice',[1,{volume:4,period:99999}]));assert.deepEqual(p.read().registers,before);
    let writes=0,renders=0;const write=p.processor.chip.writeRegister.bind(p.processor.chip),render=p.processor.chip.generateStereo.bind(p.processor.chip);p.processor.chip.writeRegister=(...args)=>{writes++;return write(...args);};p.processor.chip.generateStereo=(...args)=>{renders++;return render(...args);};assert.deepEqual(p.read(),state);assert.equal(writes,0);assert.equal(renders,0);
  }finally{p.close();}
});

test('YM2149 Worklet generates actual YM PCM, with fixed profile through reset and clock changes',async()=>{
  const profile={clock:2000000,type:0x10,flags:1};
  const p=await setup(profile),options={moduleFactory:factory,moduleOptions:{wasmBinary:await readFile(new URL('../docs/generated/ay8910_wasm.wasm',import.meta.url))},sampleRate:RATE,...profile};
  const expected=await Ay8910.create(options),ay=await Ay8910.create({...options,type:0});
  const retimed=new ChipClockResampler();
  const sync=chip=>{chip.reset();for(const [register,value]of p.client._getState().registers.entries())chip.writeRegister(register,value);chip.setMuteMask(6);};
  const render=frames=>{const [left,right]=p.render(frames),l=new Float32Array(frames),r=new Float32Array(frames);retimed.render(expected,l,r);assert.deepEqual(left,l);assert.deepEqual(right,r);return left;};
  try{
    p.client.setVoice(0,{tone:true,noise:false,volume:9,envelope:false,note:'A4'});sync(expected);sync(ay);
    const initial=render(4096);assert(peak(initial)>.01);assert.notDeepEqual(initial,ay.generateStereo(4096).left,'YM2149 DAC response must not silently use AY-3-8910');
    p.receive({type:'chip-inspector',id:'profile',action:'read'});const inspection=p.messages.find(message=>message.id==='profile');
    assert.equal(inspection.value.type,0x10);assert.equal(inspection.value.flags,1);assert.equal(inspection.value.clock,2000000);
    await p.client.setClock(3000000);retimed.setClock(3000000,2000000);render(1703);
    p.client.reset();p.client.setVoice(0,{tone:true,noise:false,volume:9,envelope:false,note:'A4'});sync(expected);retimed.resetPhase();render(2048);
    assert.equal(p.processor.type,0x10);assert.equal(p.processor.flags,1);assert.equal(p.processor.baseClock,2000000);assert.equal(p.client.clock,3000000);
  }finally{p.close();expected.dispose();ay.dispose();}
});

for(const execution of ['Main','Worker'])test(`YM2149 ${execution} Stop silences held resampler output and cancels queued notes without changing the profile`,async()=>{
  const p=await setup({clock:2000000,type:0x10,flags:1});
  try{
    await p.client.setClock(400000);p.client.setVoice(0,{tone:true,noise:false,volume:9,envelope:false,note:'A4'});
    p.render(5);assert(peak(p.render(1)[0])>.01,'a source sample is being held between chip frames');
    if(execution==='Main')await p.client._stopVoices();
    else{
      p.receive({type:'performance-start',session:1});
      p.receive({performance:{session:1,owner:'future',time:.05},commands:[{method:'writeRegister',args:[8,15]}]});
      p.receive({type:'performance-stop',session:1});
    }
    assert.equal(peak(p.render(4096)[0]),0);assert.equal(p.processor.type,0x10);assert.equal(p.processor.flags,1);assert.equal(p.client.clock,400000);
    p.client.keyOn(0);assert(peak(p.render(2048)[0])>.01,'the retained patch remains playable after Stop');
  }finally{p.close();}
});
test('AY manual A4 is audible and Stop preserves tone/noise/envelope configuration while muting all voices',async()=>{
  const p=await setup();try{
    p.invoke('setVoice',[0,{tone:true,noise:false,volume:9,envelope:false}]);p.invoke('auditionOn',[0,69,'first']);const before=p.read(),[left,right]=p.render(RATE/2);assert(peak(left)>.01);assert(left.every(Number.isFinite));assert.deepEqual(left,right);
    const threshold=left.reduce((sum,value)=>sum+value,0)/left.length;let crossings=0;for(let i=2401;i<left.length;i++)if(left[i-1]<=threshold&&left[i]>threshold)crossings++;assert(Math.abs(crossings/((left.length-2400)/RATE)-440)<5);
    await p.client._stopVoices();assert.equal(peak(p.render(512)[0]),0);const after=p.read();assert.deepEqual(after.registers.slice(0,8),before.registers.slice(0,8));assert.equal(after.channels[0].configuredVolume,9);assert.equal(p.invoke('auditionOff',[0,'first']),false);
    p.invoke('auditionOn',[0,72,'second']);assert(peak(p.render(2048)[0])>.01);p.invoke('auditionOff',[0,'second']);assert.equal(peak(p.render(512)[0]),0);
  }finally{p.close();}
});
for(const execution of ['Main','Worker'])test(`AY ${execution}: manual leases protect only held mixer bits and shared sources, with stale owner cleanup harmless`,async()=>{
  const p=await setup();try{
    p.client.noise(1,{period:17,volume:8});p.receive({type:'performance-start',session:1});p.invoke('auditionOn',[1,69,'noise']);const before=p.read();
    const commands=[{method:'writeRegister',args:[7,0x38]},{method:'writeRegister',args:[6,3]},{method:'writeRegister',args:[13,15]},{method:'writeRegister',args:[9,0]},{method:'writeRegister',args:[10,8]}];
    if(execution==='Main')for(const command of commands)p.receive(command);else p.receive({performance:{session:1,owner:'code',time:.01},commands});p.render(1024);const after=p.read();
    assert.equal(after.channels[1].noiseEnabled,true);assert.equal(after.channels[1].toneEnabled,false);assert.equal(after.noise.period,before.noise.period);assert.equal(after.envelope.shape,before.envelope.shape);assert.equal(after.channels[1].active,true);assert.equal(after.channels[2].active,true);
    p.receive({type:'performance-cancel-owner',session:1,owner:'code'});assert.equal(p.read().channels[1].active,true);p.invoke('auditionOn',[1,72,'replacement']);assert.equal(p.invoke('auditionOff',[1,'noise']),false);p.invoke('auditionOff',[1,'replacement']);assert.equal(p.read().channels[1].active,false);
  }finally{p.close();}
});
test('AY applied snapshots retain silent configured levels and Main/Worker adoption performs no writes',async()=>{
  const p=await setup();try{
    p.client.setVoice(1,{tone:false,noise:true,volume:5,envelope:true});p.client.keyOff(1);const state=p.client._getState(),sent=[],worker=createAy8910Client({start(){},close(){},postMessage:message=>sent.push(message)});worker._adoptState(state);assert.deepEqual(sent,[]);assert.deepEqual(worker._getState(),state);worker.keyOn(1);assert.equal(sent.at(-1).args[1]&31,21);worker.dispose();
    p.invoke('setVoice',[1,{volume:0,envelope:false}]);assert.equal(p.read().channels[1].configuredVolume,0);assert.equal(p.read().channels[1].configuredEnvelope,false);
    p.client.setVolume(2,5,true);p.client.keyOff(2);assert.equal(p.read().channels[2].configuredVolume,5);assert.equal(p.read().channels[2].configuredEnvelope,true);
    p.client.setVolume(2,0,false);assert.equal(p.read().channels[2].configuredVolume,0);assert.equal(p.read().channels[2].configuredEnvelope,false);p.invoke('auditionOn',[2,69,'silent']);assert.equal(peak(p.render(128)[0]),0);
  }finally{p.close();}
});
test('AY fixed-rate core clock changes preserve controls and pending writes remain unapplied until their audio frame',async()=>{
  const p=await setup();try{
    p.invoke('auditionOn',[0,69,'held']);await assert.rejects(p.client.setClock(2000000),/manual audition/);assert.equal(p.client.clock,1789773);p.invoke('auditionOff',[0,'held']);await p.client.setClock(2000000);assert.equal(p.read().clock,2000000);p.client.noteOn(0,69);assert(Math.abs(p.read().channels[0].frequency-440)<2);
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future',time:480/RATE},commands:[{method:'writeRegister',args:[6,29]}]});assert.notEqual(p.read().noise.period,29);p.render(480);assert.notEqual(p.read().noise.period,29);p.render(1);assert.equal(p.read().noise.period,29);
    await p.client._stopVoices();assert.equal(peak(p.render(256)[0]),0);
  }finally{p.close();}
});
test('AY retained-level metadata follows the same reserved frame and cannot overwrite a manual lease',async()=>{
  const p=await setup();try{
    p.client.setVolume(0,8,true);p.client.keyOff(0);p.receive({type:'performance-start',session:1});
    p.receive({performance:{session:1,owner:'future',time:240/RATE},commands:[{method:'writeRegister',args:[8,0]},{method:'setRetainedLevel',args:[0,0]}]});
    assert.equal(p.read().channels[0].configuredVolume,8);assert.equal(p.read().channels[0].configuredEnvelope,true);p.render(240);assert.equal(p.read().channels[0].configuredVolume,8);p.render(1);assert.equal(p.read().channels[0].configuredVolume,0);assert.equal(p.read().channels[0].configuredEnvelope,false);
    p.invoke('setVoice',[0,{volume:7,envelope:false}]);p.invoke('auditionOn',[0,69,'held']);p.receive({method:'setRetainedLevel',args:[0,0]});assert.equal(p.read().channels[0].configuredVolume,7);
  }finally{p.close();}
});
