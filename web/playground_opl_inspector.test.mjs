import {copyY8950AdpcmMemory} from './y8950_adpcm.js';
import {validateY8950AdpcmPreview} from './y8950_adpcm_preview.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {Ym3526} from './ym3526.js';
import {Ym3812} from './ym3812.js';
import {Y8950} from './y8950.js';
import {Ymf262} from './ymf262.js';
import ym3526Factory from '../docs/generated/ym3526_wasm.js';
import ym3812Factory from '../docs/generated/ym3812_wasm.js';
import y8950Factory from '../docs/generated/y8950_wasm.js';
import ymf262Factory from '../docs/generated/ymf262_wasm.js';
import {OplVoiceInspector} from './playground_opl_inspector.js';
import {createOplClient} from './playground_opl.js';
import {OPL_PRESETS} from './opl_synth.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';
import {validateChipClock} from './playground_chip_clock.js';
const RATE=48000,peak=values=>values.reduce((result,value)=>Math.max(result,Math.abs(value)),0);
async function setup(chip='ym3812'){
  let Processor,frame=0,ready;const messages=[],port={postMessage:message=>{messages.push(message);if(message.ready||message.error)ready(message);}},started=new Promise(resolve=>ready=resolve);
  const source=(await readFile(new URL('./playground_opl_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
  vm.runInNewContext(source,{copyY8950AdpcmMemory,validateY8950AdpcmPreview,Ym3526,Ym3812,Y8950,Ymf262,ym3526Factory,ym3812Factory,y8950Factory,ymf262Factory,OplVoiceInspector,receiveChipInspector,validateChipClock,sampleRate:RATE,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:RATE,nowFrame:()=>frame}),AudioWorkletProcessor:class{constructor(){this.port=port;}},registerProcessor:(_name,Type)=>Processor=Type});
  const processor=new Processor({processorOptions:{chip,wasmBinary:await readFile(new URL(`../docs/generated/${chip}_wasm.wasm`,import.meta.url))}});assert.equal((await started).ready,true,JSON.stringify(messages));
  const clientPort={start(){},close(){},postMessage:data=>processor.receive(data,{postMessage:reply=>clientPort.onmessage?.({data:reply})})},client=createOplClient(clientPort,{chip});client.initialize();
  return {processor,client,clientPort,messages,port,receive:data=>processor.receive(data,port),read:()=>processor.inspector.read(),invoke:(method,args=[])=>processor.inspector.invoke(method,args),
    render(frames){const output=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[output]);frame+=frames;return output;},close(){client.dispose();processor.dispose();}};
}
for(const chip of ['ym3526','ym3812','y8950','ymf262'])test(`${chip}: applied snapshot, A4, silent Stop, patch retention and retrigger`,async()=>{
  const p=await setup(chip);try{
    p.client.setPreset(0,OPL_PRESETS.sine);p.client.setOperator(0,1,{rr:0});p.client.noteOn(0,69);
    const before=p.read(),audio=p.render(RATE/2)[0];assert(Math.abs(before.channels[0].frequency-440)<.5);assert(peak(audio)>.01);assert(audio.every(Number.isFinite));
    let rising=0;for(let i=2401;i<audio.length;i++)if(audio[i-1]<=0&&audio[i]>0)rising++;
    assert(Math.abs(rising/((audio.length-2400)/RATE)-440)<4,'native oscillator stays at A4 through output-rate conversion');
    let writes=0;const write=p.processor.chip.write.bind(p.processor.chip);p.processor.chip.write=(...args)=>{writes++;write(...args);};
    assert.deepEqual(p.read(),before);assert.equal(writes,0,'read is side effect free');
    p.receive({type:'performance-start',session:1});p.receive({performance:{session:1,owner:'future',time:5},commands:[{method:'writeRegister',args:[0xb0,0x32,0]}]});
    await p.client._stopVoices();assert.equal(p.processor.performance.getStats().queuedCommands,0);assert.equal(p.read().channels[0].active,false);assert.deepEqual(p.read().channels[0].operators,before.channels[0].operators);assert.equal(peak(p.render(500)[0]),0,'RR=0 release cannot survive Stop');
    p.invoke('auditionOn',[0,72,'manual']);assert.equal(p.read().channels[0].active,false,'commands do not advance native frames');assert(peak(p.render(4096)[0])>.01);assert.equal(p.read().channels[0].active,true);
    p.invoke('auditionOn',[0,69,'new']);p.render(128);assert.equal(p.invoke('auditionOff',[0,'manual']),false);assert.equal(p.read().channels[0].active,true);p.invoke('auditionOff',[0,'new']);assert.equal(peak(p.render(512)[0]),0);
  }finally{p.close();}
});
test('OPL3: banked four-op voice, dynamic Keyboard channels, leased pair, stereo and atomic validation',async()=>{
  const p=await setup('ymf262');try{
    p.client.setPreset(9,OPL_PRESETS['four-op-bell']);p.client.setPan(9,true,false);
    const state=p.read();assert.equal(state.channels[9].fourOp,true);assert.equal(state.channels[12].available,false);assert.equal(state.channels[9].operators.length,4);assert(!state.keyboardChannels.some(row=>row.id==='12'));
    p.invoke('setAlgo',[9,3,4]);assert.equal(p.read().channels[9].algorithm,3);assert.equal(p.read().channels[9].feedback,4);
    const registers=p.read().registers;assert.throws(()=>p.invoke('setOperator',[9,2,{tl:12,ar:16}]),/ar/);assert.deepEqual(p.read().registers,registers);
    assert.throws(()=>p.invoke('auditionOn',[12,69,'secondary']),/four-operator/);assert.equal(p.read().held.length,0);
    p.invoke('auditionOn',[9,69,'held']);p.render(128);const before=p.read().channels[9];
    p.receive({method:'writeRegister',args:[0x50,0,1]});p.receive({method:'writeRegister',args:[0xb0,0,1]});p.receive({method:'writeRegister',args:[0x4b,0,1]});
    assert.deepEqual(p.read().channels[9].operators,before.operators);assert.equal(p.read().channels[9].active,true);
    const [left,right]=p.render(4800);assert(peak(left)>.001);assert.equal(peak(right),0,'OPL3 hardware pan is preserved through paired operators');
    p.invoke('auditionOff',[9,'held']);assert.equal(peak(p.render(480)[0]),0);
    p.invoke('setRhythm',[{enabled:true}]);assert.deepEqual(p.read().keyboardChannels.filter(row=>['6','7','8'].includes(row.id)),[]);assert.throws(()=>p.invoke('auditionOn',[6,69,'rhythm']),/Rhythm/);
  }finally{p.close();}
});
test('OPL client shadow adoption is silent, sparse edits retain raw bits, and Stop ACK is a cross-port fence',async()=>{
  const p=await setup();try{
    p.client.setPreset(0,OPL_PRESETS.sine);p.client.writeRegister(0x40,0xc7);p.client.setOperator(0,0,{tl:21});assert.equal(p.read().registers[0x40],0xd5);
    const snapshot=p.client._getState(),sent=[],port={start(){},close(){},postMessage:command=>sent.push(command)},worker=createOplClient(port);worker._adoptState(snapshot);assert.equal(sent.length,0);assert.deepEqual(worker._getState(),snapshot);worker.dispose();
    p.client.noteOn(0,69);p.render(1024);let delayed,done=false;const original=p.clientPort.postMessage;p.clientPort.postMessage=command=>{if(command.method==='stopVoices')delayed=()=>original(command);else original(command);};
    const pending=p.client._stopVoices().then(()=>done=true);await Promise.resolve();assert.equal(done,false);assert.equal(p.read().channels[0].active,true);delayed();await pending;assert.equal(p.read().channels[0].active,false);assert.equal(peak(p.render(512)[0]),0);
  }finally{p.close();}
});

test('OPL manual replacement lets a real native frame consume keyOff before its decayed envelope retriggers',async()=>{
  const p=await setup();try{
    p.client.setPreset(0,OPL_PRESETS.sine);p.client.setOperator(0,1,{tl:4,ar:15,egt:false,dr:15,sl:15,rr:15});
    p.invoke('auditionOn',[0,69,'decayed']);const audio=p.render(RATE)[0];assert(peak(audio.subarray(0,2400))>.01);assert(peak(audio.subarray(RATE-2400))<.001);
    const writes=[],write=p.processor.chip.write.bind(p.processor.chip),generate=p.processor.chip.generateStereo.bind(p.processor.chip);let register=0,nativeFrames=0;
    p.processor.chip.write=(offset,value)=>{if(offset===0)register=value;else if(offset===1&&register===0xb0)writes.push([value,nativeFrames]);return write(offset,value);};
    p.processor.chip.generateStereo=frames=>{nativeFrames+=frames;return generate(frames);};
    p.invoke('auditionOn',[0,72,'replacement']);assert(writes.length>=1);assert(writes.every(([value])=>!(value&32)),'pitch preparation cannot repeat the previous physical gate');assert.equal(nativeFrames,0,'editing never generates or discards PCM');
    assert(peak(p.render(2400)[0])>.01,'the same decayed patch attacks on a replacement key');const on=writes.find(([value])=>value&32);assert(on&&on[1]>0,'key-on follows an ordinary rendered native interval');
  }finally{p.close();}
});
