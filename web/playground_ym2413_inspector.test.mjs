import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Ym2413} from './ym2413.js';
import factory from '../docs/generated/ym2413_wasm.js';
import {YM2413_USER_PRESETS} from './ym2413synth.js';
import {createYm2413Client} from './playground_ym2413.js';
import {Ym2413VoiceInspector} from './playground_ym2413_inspector.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {validateChipClock} from './playground_chip_clock.js';
const RATE=48000,DRUMS=['bassDrum','snare','tom','cymbal','hiHat'],peak=values=>values.reduce((result,value)=>Math.max(result,Math.abs(value)),0);
async function setup(){
  let Processor,frame=0,ready;const messages=[],port={postMessage:message=>{messages.push(message);if(message.ready||message.error)ready(message);}},started=new Promise(resolve=>ready=resolve);
  const source=(await readFile(new URL('./playground_ym2413_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{Ym2413,factory,Ym2413VoiceInspector,receiveChipInspector,validateChipClock,sampleRate:RATE,createProcessorPerformance:options=>createProcessorPerformance({...options,rate:RATE,nowFrame:()=>frame}),AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Type)=>Processor=Type});
  const processor=new Processor({processorOptions:{wasmBinary:await readFile(new URL('../docs/generated/ym2413_wasm.wasm',import.meta.url))}});assert.equal((await started).ready,true,JSON.stringify(messages));
  const clientPort={start(){},close(){},postMessage:data=>processor.receive(data,{postMessage:reply=>clientPort.onmessage?.({data:reply})})},client=createYm2413Client(clientPort);client.initialize();
  return {processor,client,clientPort,messages,port,receive:data=>processor.receive(data,port),read:()=>processor.inspector.read(),invoke:(method,args=[])=>processor.inspector.invoke(method,args),render(frames){const output=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[output]);frame+=frames;return output;},close(){client.dispose();processor.dispose();}};
}
function sine(p,ch=0){p.client.setUserPatch(YM2413_USER_PRESETS.sine);p.client.setVoice(ch,{instrument:0,attenuation:3});}
function drums(p){p.client.setRhythmLevels({bassDrum:3,snare:4,tom:5,cymbal:6,hiHat:7});p.client.setNote(6,'C3');p.client.setNote(7,'G3');p.client.setNote(8,'D3');p.client.setRhythm({enabled:true});}

test('YM2413 applied read is silent, decodes shared user operators and preserves builtin voice state',async()=>{
  const p=await setup();try{
    sine(p);p.client.setVoice(1,{instrument:4,attenuation:6,sustain:true});p.client.setNote(1,'A4');
    p.client.writeRegister(3,0xc7);p.invoke('setUserOperator',[1,{waveform:1,ar:14}]);
    const state=p.read();assert.equal(state.channels[1].instrument,4);assert.equal(state.channels[1].attenuation,6);assert.equal(state.channels[1].sustain,true);assert(Math.abs(state.channels[1].frequency-440)<1);
    assert.equal(state.userPatch.feedback,7);assert.equal(state.userPatch.operators[1].waveform,1);assert.equal(state.userPatch.operators[1].ar,14);assert.equal(state.userPatch.shared,true);assert.equal(state.registers[3],0xd7);
    const before=state.registers;assert.throws(()=>p.invoke('setUserOperator',[1,{ar:12,tl:3}]),/tl|carrier/i);assert.deepEqual(p.read().registers,before);
    let writes=0;const write=p.processor.chip.write.bind(p.processor.chip);p.processor.chip.write=(...args)=>{writes++;return write(...args);};assert.deepEqual(p.read(),state);assert.equal(writes,0);
    assert.equal(p.read().keyboardChannels.length,9);
  }finally{p.close();}
});
test('YM2413 manual A4 renders in both mono sides and Stop preserves patch/voices while muting even RR0',async()=>{
  const p=await setup();try{
    sine(p);p.client.setUserOperator(1,{rr:0});p.invoke('auditionOn',[0,69,'key']);const before=p.read();const [left,right]=p.render(RATE/2);assert(peak(left)>.01);assert.deepEqual(left,right);
    let crossings=0;for(let i=2401;i<left.length;i++)if(left[i-1]<=0&&left[i]>0)crossings++;assert(Math.abs(crossings/((left.length-2400)/RATE)-440)<4);
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future',time:5},commands:[{method:'writeRegister',args:[0x20,0x18]}]});
    await p.client._stopVoices();assert.equal(peak(p.render(1024)[0]),0);assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.deepEqual(p.read().userPatch,before.userPatch);assert.equal(p.read().channels[0].attenuation,before.channels[0].attenuation);assert.equal(p.invoke('auditionOff',[0,'key']),false);
    p.invoke('auditionOn',[0,72,'next']);assert(peak(p.render(2048)[0])>.01);p.invoke('auditionOff',[0,'next']);assert.equal(peak(p.render(1024)[0]),0);
  }finally{p.close();}
});
test('YM2413 rhythm exposes six melody channels plus five independent drum choices, preserves nibbles and Stop levels',async()=>{
  const p=await setup();try{
    drums(p);const before=p.read();assert.equal(before.keyboardChannels.length,11);assert.deepEqual(before.keyboardChannels.slice(6).map(ch=>ch.id),DRUMS.map((_,i)=>`rhythm:${i}`));assert(before.channels.slice(6).every(ch=>!ch.available));assert.throws(()=>p.invoke('auditionOn',[6,69,'invalid']),/Rhythm|rhythm/);
    for(let index=0;index<5;index++){
      const id=`rhythm:${index}`;p.invoke('auditionOn',[id,69,`drum${index}`]);assert(peak(p.render(4800)[0])>.001,DRUMS[index]);assert.equal(p.read().rhythm[DRUMS[index]],true);p.invoke('auditionOff',[id,`drum${index}`]);assert.equal(p.read().rhythm[DRUMS[index]],false);assert.equal(peak(p.render(512)[0]),0,`manual ${DRUMS[index]} Off is silent`);
    }
    p.client.setRhythm({bassDrum:true,snare:true,hiHat:true});p.render(1024);await p.client._stopVoices();assert.equal(peak(p.render(1024)[0]),0);assert.equal(p.read().rhythm.enabled,true);assert.deepEqual(p.read().rhythm.levels,before.rhythm.levels);assert(DRUMS.every(name=>!p.read().rhythm[name]));
    p.invoke('auditionOn',['rhythm:4',69,'again']);assert(peak(p.render(2400)[0])>.001);
  }finally{p.close();}
});
for(const execution of ['Main','Worker'])test(`YM2413 ${execution}: manual drum leases its physical counterpart while other drums and melody continue`,async()=>{
  const p=await setup();try{
    sine(p);drums(p);p.receive({type:'performance-start',session:1});p.invoke('auditionOn',['rhythm:4',69,'hat']);p.render(256);
    const before=p.read(),commands=[{method:'writeRegister',args:[0x37,0]},{method:'writeRegister',args:[0x0e,0x20|16|8|4]},{method:'writeRegister',args:[0x20,0x18]}];
    if(execution==='Main')for(const command of commands)p.receive(command);else p.receive({performance:{session:1,owner:'code',time:.01},commands});p.render(1024);
    const after=p.read();assert.equal(after.rhythm.hiHat,true);assert.equal(after.rhythm.snare,false,'same physical channel is protected');assert.equal(after.rhythm.bassDrum,true);assert.equal(after.rhythm.tom,true);assert.equal(after.channels[0].active,true);assert.deepEqual(after.rhythm.levels,before.rhythm.levels);
    p.invoke('auditionOn',['rhythm:1',69,'snare']);assert.equal(p.invoke('auditionOff',['rhythm:4','hat']),false,'old physical counterpart lease retires');p.render(512);assert.equal(p.read().rhythm.snare,true);assert.equal(p.read().rhythm.hiHat,false);
    p.invoke('auditionOff',['rhythm:1','snare']);assert.equal(p.read().rhythm.bassDrum,true,'other physical drum keeps playing');
    p.invoke('setRhythm',[{enabled:false}]);assert.equal(p.read().held.length,0);assert.equal(p.read().keyboardChannels.length,9);
  }finally{p.close();}
});
test('YM2413 snapshot adoption does not replay writes, and native Stop acknowledgement fences manual reentry',async()=>{
  const p=await setup();try{
    sine(p);p.client.setVoice(2,{instrument:7,attenuation:4,sustain:true});const state=p.client._getState(),sent=[],worker=createYm2413Client({start(){},close(){},postMessage:message=>sent.push(message)});worker._adoptState(state);assert.equal(sent.length,0);assert.deepEqual(worker._getState(),state);worker.dispose();
    p.client.noteOn(0,69);p.render(256);let delayed,done=false;const post=p.clientPort.postMessage;p.clientPort.postMessage=data=>{if(data.method==='stopVoices')delayed=()=>post(data);else post(data);};const stopping=p.client._stopVoices().then(()=>done=true);await Promise.resolve();assert.equal(done,false);assert.equal(p.read().channels[0].active,true);delayed();await stopping;assert.equal(p.read().channels[0].active,false);assert.equal(peak(p.render(256)[0]),0);
  }finally{p.close();}
});

test('YM2413 clock changes reject during a manual lease without advancing authoring clock, then apply after release',async()=>{
  const p=await setup();try{
    sine(p);p.invoke('auditionOn',[0,69,'held']);await assert.rejects(p.client.setClock(4000000),/manual audition/);assert.equal(p.client.clock,3579545);assert.equal(p.read().clock,3579545);
    p.invoke('auditionOff',[0,'held']);await p.client.setClock(4000000);assert.equal(p.client.clock,4000000);assert.equal(p.read().clock,4000000);p.client.noteOn(0,69);assert(Math.abs(p.read().channels[0].frequency-440)<1);
  }finally{p.close();}
});

test('YM2413 taking a manual drum lease silences a previously sounding code-owned physical counterpart',async()=>{
  const p=await setup();try{
    drums(p);p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'code',time:0},commands:[{method:'writeRegister',args:[0x0e,0x20|16|8]}]});p.render(512);assert.equal(p.read().rhythm.snare,true);assert.equal(p.read().rhythm.bassDrum,true);
    p.invoke('auditionOn',['rhythm:4',69,'manual-hat']);assert.equal(p.read().rhythm.snare,false,'CH7 snare must stop before the manual hi-hat starts');assert.equal(p.read().rhythm.bassDrum,true,'the unrelated CH6 drum continues');p.render(512);assert.equal(p.read().rhythm.hiHat,true);
    p.receive({type:'performance-cancel-owner',session:1,owner:'code'});assert.equal(p.read().rhythm.hiHat,true,'late code cleanup cannot release the manual physical owner');assert.equal(p.read().rhythm.bassDrum,false);
  }finally{p.close();}
});

test('YM2413 layout events follow only the applied rhythm mode edge, after lookahead reaches its reserved frame',async()=>{
  const p=await setup();try{
    const events=()=>p.messages.filter(message=>message.type==='chip-layout');assert.equal(events().length,0);
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future-layout',time:480/RATE},commands:[{method:'writeRegister',args:[0x0e,32]}]});
    assert.equal(p.read().rhythm.enabled,false);assert.equal(events().length,0,'reserving a future command never changes metadata');p.render(480);assert.equal(events().length,0);assert.equal(p.read().rhythm.enabled,false);
    p.render(1);assert.equal(events().length,1);assert.equal(events()[0].kind,'ym2413');assert.equal(events()[0].rhythmEnabled,true);
    for(const value of [33,32,40,32])p.receive({method:'writeRegister',args:[0x0e,value]});p.client.noteOn(0,69);p.client.noteOff(0);assert.equal(events().length,1,'drum and melody gates do not notify the view');
    p.client.reset();assert.equal(events().length,2);assert.equal(events()[1].rhythmEnabled,false);p.client.reset();assert.equal(events().length,2,'reset of an already-melodic chip does not rebuild layout');
  }finally{p.close();}
});
