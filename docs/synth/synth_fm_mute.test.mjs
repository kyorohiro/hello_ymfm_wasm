// Native PCM arrays and a stubbed WorkletGlobalScope only; no audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ymFactory from '../generated/ym2612_wasm.js';
import nukedFactory from '../generated/nuked_opn2_wasm.js';
import {Ym2612} from '../js/ym2612.js';
import {YM2612Synth,YM2612DirectTransport} from '../js/ym2612synth.js';
import {FM_PRESETS} from '../js/megasynth-fm-presets.js';
import {OpnKeyboardInspector} from '../js/playground_opn_inspector.js';
import {PsgInspectorState,receiveChipInspector} from '../js/playground_chip_inspector_state.js';
import {createPerformanceQueue,createPerformanceChipOwnership} from '../js/playground_performance_queue.js';
import {createOpnAuditionGuard,receiveOpnAuditionCommand,createPsgAuditionGuard} from '../js/playground_audition_guard.js';
import {createChipPortReceiver} from '../js/playground_chip_port.js';
import {YM2612DacPlayer,receiveDacCommand} from '../js/ym2612_dac.js';
import {installSynthFmChannelMute,decorateSynthFmProcessor} from './synth_fm_mute.js';

const RATE=48000;
const variants=[['ym2612-worklet.js','ym2612',ymFactory],['ym2612-worklet-nuked.js','nuked_opn2',nukedFactory]];
const wasm=Object.fromEntries(await Promise.all(variants.map(async([,id])=>[id,await readFile(new URL(`../generated/${id}_wasm.wasm`,import.meta.url))])));
const createChip=([,id,moduleFactory])=>Ym2612.create({moduleFactory,moduleOptions:{wasmBinary:wasm[id]}});
const rms=samples=>{
  const mean=samples.reduce((sum,value)=>sum+value,0)/samples.length;
  return Math.sqrt(samples.reduce((sum,value)=>sum+(value-mean)**2,0)/samples.length);
};
function fakeChip({bus=true}={}) {
  const writes=[],addresses=[0,0],registers=[new Uint8Array(256),new Uint8Array(256)];
  const chip={writes,registers,resets:0,setHooks(){},sampleRate:()=>RATE,reserveStereoFrames(){},
    reset(){chip.resets++;registers.forEach(values=>values.fill(0));return 'reset';},
    writeRegister(register,value,port=0){
      if(bus){chip.write(port?2:0,register);chip.write(port?3:1,value);}
      else {writes.push([register,value,port]);registers[port][register]=value;}
      return 'write';
    },
    generateStereoView:count=>({left:new Float32Array(count),right:new Float32Array(count)}),
  };
  if(bus)chip.write=(offset,value)=>{
    const port=offset>>1;
    if(offset&1){registers[port][addresses[port]]=value;writes.push([addresses[port],value,port]);}
    else addresses[port]=value;
  };
  return chip;
}
async function processor(file,chip=null) {
  let Type;const messages=[];
  const scope={sampleRate:RATE,currentFrame:0,Float32Array,Uint8Array,Error,
    OpnKeyboardInspector,PsgInspectorState,receiveChipInspector,YM2612DacPlayer,receiveDacCommand,
    createPerformanceQueue,createPerformanceChipOwnership,createOpnAuditionGuard,receiveOpnAuditionCommand,createPsgAuditionGuard,
    createChipPortReceiver:(apply,_now,options)=>createChipPortReceiver(apply,()=>scope.currentFrame/RATE,options),
    createYm2612:async()=>chip,ym2612ModuleFactory:()=>{},
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:message=>messages.push(message)};}},
    registerProcessor:(name,Registered)=>{assert.equal(name,'ym2612-processor');Type=Registered;},
  };
  const source=await readFile(new URL(`../js/${file}`,import.meta.url),'utf8');
  vm.runInNewContext(source.replace(/^import .*;\n/gm,'').replace(/^export /gm,''),scope);
  decorateSynthFmProcessor(Type);assert.equal(decorateSynthFmProcessor(Type),Type);
  const p=new Type();let frame=0;
  return {p,messages,scope,render(count){
    const left=new Float32Array(count),right=new Float32Array(count);
    for(let offset=0;offset<count;offset+=128){
      const end=Math.min(offset+128,count);scope.currentFrame=frame+offset;
      assert.equal(p.process([],[[left.subarray(offset,end),right.subarray(offset,end)]]),true);
    }
    frame+=count;return {left,right};
  },get frame(){return frame;}};
}

for(const bus of [true,false])test(`native ${bus?'bus':'register'} mute preserves the newest pan/AMS/PMS and resets only authored register state`,()=>{
  const chip=fakeChip({bus}),oldRegister=chip.writeRegister.bind(chip),mute=installSynthFmChannelMute(chip);
  assert.equal(installSynthFmChannelMute(chip),mute);
  chip.writeRegister(0xb4,0xc7);chip.writeRegister(0xb6,0xd5,1);
  assert.equal(mute.setMuted(0,true),true);assert.deepEqual(chip.writes.at(-1),[0xb4,7,0]);
  chip.writeRegister(0xb4,0xa6);assert.deepEqual(chip.writes.at(-1),[0xb4,0x26,0]);
  if(bus){oldRegister(0xb4,0xdb);assert.deepEqual(chip.writes.at(-1),[0xb4,0x1b,0]);}
  chip.writeRegister(0x28,0xf0);assert.deepEqual(chip.writes.at(-1),[0x28,0xf0,0]);
  const lastPan=bus?0xdb:0xa6;mute.setMuted(0,false);assert.deepEqual(chip.writes.at(-1),[0xb4,lastPan,0]);
  mute.setMuted(5,true);assert.deepEqual(chip.writes.at(-1),[0xb6,0x15,1]);
  assert.equal(chip.reset(),'reset');assert.equal(mute.getState().muted[5],true);assert(mute.getState().pan.every(value=>value===0));
  chip.writeRegister(0xb6,0xf3,1);assert.deepEqual(chip.writes.at(-1),[0xb6,0x33,1]);
  mute.setMuted(5,false);assert.deepEqual(chip.writes.at(-1),[0xb6,0xf3,1]);
  const state=mute.getState(),count=chip.writes.length;
  for(const args of [[-1,true],[6,true],[1,1],[NaN,false]])assert.throws(()=>mute.setMuted(...args));
  assert.deepEqual(mute.getState(),state);assert.equal(chip.writes.length,count);
});

for(const variant of variants)test(`${variant[1]} mute leaves native oscillator phase and authored Synth state unchanged`,async()=>{
  const chip=await createChip(variant),reference=await createChip(variant),mute=installSynthFmChannelMute(chip);
  try {
    const synths=[chip,reference].map(native=>new YM2612Synth({transport:new YM2612DirectTransport(native)}));
    for(const synth of synths){synth.setPreset(0,FM_PRESETS.sine);synth.noteOn(0,4,1088);}
    assert(rms(chip.generateStereo(1500).left)>.001);reference.generateStereo(1500);
    const authored=structuredClone(synths[0].getState());mute.setMuted(0,true);
    assert.deepEqual(synths[0].getState(),authored,'a host mute never rewrites the author-facing Synth');
    for(const synth of synths)synth.setPan(0,true,false,2,3);
    // Nuked retains the physical chip's idle DAC noise at zero pan. Compare
    // against the same real native routing, rather than expecting digital0.
    reference.writeRegister(0xb4,0x23);
    const quiet=chip.generateStereo(3179),zeroPan=reference.generateStereo(3179);
    for(const side of ['left','right'])assert.deepEqual(quiet[side].subarray(32),zeroPan[side].subarray(32));
    synths[1].setPan(0,true,false,2,3);
    const changed=structuredClone(synths[0].getState());mute.setMuted(0,false);
    assert.deepEqual(synths[0].getState(),changed);
    const actual=chip.generateStereo(2021),expected=reference.generateStereo(2021);
    for(const side of ['left','right'])assert.deepEqual(actual[side].subarray(32),expected[side].subarray(32),'unmute restores the running phase and newest authored pan');
  } finally {chip.dispose();reference.dispose();}
});

for(const [file]of variants)test(`${file} private prototype is installed before pending commands and the first ready delivery`,async()=>{
  const chip=fakeChip(),{p,messages}=await processor(file,chip);
  p.port.onmessage({data:{type:'synth-channel-mute',channel:0,muted:true}});
  p.port.onmessage({data:{type:'write',port:0,register:0xb4,value:0xc7}});
  p.port.onmessage({data:{type:'synth-channel-mute',channel:5,muted:true}});
  p.port.onmessage({data:{type:'write',port:1,register:0xb6,value:0xf3}});
  await p.init(new Uint8Array());assert(messages.some(message=>message.type==='ready'));
  assert.equal(chip.registers[0][0xb4],7);assert.equal(chip.registers[1][0xb6],0x33);
  assert.equal(p.opnInspector.registers[0][0xb4],0xc7,'the inspector retains authored pan');
  p.opnInspector.direct(0xb4,0xd5);assert.equal(chip.registers[0][0xb4],0x15,'captured inspector writers cannot bypass the native mute edge');
  p.port.onmessage({data:{type:'synth-channel-mute',channel:0,muted:false}});assert.equal(chip.registers[0][0xb4],0xd5);
  p.applyCommand({type:'reset'});assert.equal(p.synthChannelMuted[5],true);
  p.applyCommand({type:'write',port:1,register:0xb6,value:0xca});assert.equal(chip.registers[1][0xb6],10);
  assert.throws(()=>p.applyCommand({type:'synth-channel-mute',channel:6,muted:true}),/0\.\.5/);
});

for(const variant of variants)test(`${variant[1]} scheduled register and DAC streams stay muted at the actual native boundary`,async()=>{
  const chips=await Promise.all([createChip(variant),createChip(variant)]),hosts=await Promise.all(chips.map(()=>processor(variant[0])));
  try {
    for(let index=0;index<hosts.length;index++) {
      const p=hosts[index].p;p.ym2612=chips[index];
      const synth=new YM2612Synth({transport:{write:(port,register,value)=>p.applyCommand({type:'write',port,register,value}),reset:()=>p.applyCommand({type:'reset'})}});
      synth.setPreset(0,FM_PRESETS.sine);synth.noteOn(0,4,1088);
    }
    for(const host of hosts)assert(rms(host.render(1200).left)>.001);
    hosts[0].p.applyCommand({type:'synth-channel-mute',channel:0,muted:true});
    hosts[1].p.applyCommand({type:'write',port:0,register:0xb4,value:0});
    for(const [index,host]of hosts.entries())host.p.applyCommand({type:'schedule-writes',entries:[{time:(host.frame+64)/RATE,port:0,register:0xb4,value:index?0x13:0x93}]});
    const quiet=hosts[0].render(1347),zeroPan=hosts[1].render(1347);
    for(const side of ['left','right'])assert.deepEqual(quiet[side].subarray(32),zeroPan[side].subarray(32));
    assert.equal(installSynthFmChannelMute(chips[0]).getState().pan[0],0x93,'scheduled pan is retained as authored data');
    hosts[0].p.applyCommand({type:'synth-channel-mute',channel:0,muted:false});
    hosts[1].p.applyCommand({type:'write',port:0,register:0xb4,value:0x93});
    const actual=hosts[0].render(2031),expected=hosts[1].render(2031);
    for(const side of ['left','right'])assert.deepEqual(actual[side].subarray(32),expected[side].subarray(32));
    const p=hosts[0].p;p.applyCommand({type:'reset'});p.applyCommand({type:'synth-channel-mute',channel:5,muted:true});
    p.applyCommand({type:'write',port:1,register:0xb6,value:0xc0});
    const data=Uint8Array.from({length:4096},(_,i)=>128+Math.round(60*Math.sin(2*Math.PI*i/64)));
    p.applyCommand({type:'pcm-dac',id:1,command:{action:'load',name:'cycle',data,sampleRate:RATE}});
    p.applyCommand({type:'pcm-dac',id:2,command:{action:'play',name:'cycle',when:hosts[0].frame/RATE}});
    const dacQuiet=hosts[0].render(1000);
    p.applyCommand({type:'synth-channel-mute',channel:5,muted:false});const dacOn=hosts[0].render(1000);
    assert(rms(dacOn.left)>.001,'unmute reveals the ongoing DAC reservation without restarting it');
    for(const side of ['left','right'])assert(rms(dacQuiet[side].subarray(32))<rms(dacOn[side])*.08,'DAC data and its internal pan write cannot bypass mute');
  } finally {chips.forEach(chip=>chip.dispose());}
});

for(const file of ['synth_fm_worklet.js','synth_fm_worklet_nuked.js'])test(`${file} decorates the normally registered processor before its first real module instance`,async()=>{
  const keys=['AudioWorkletProcessor','registerProcessor','sampleRate','currentFrame'];
  const descriptors=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const registrations=[];
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage(){}};}};
  globalThis.registerProcessor=(name,Type)=>registrations.push({name,Type});
  globalThis.sampleRate=RATE;globalThis.currentFrame=0;
  try {
    await import(new URL(file,import.meta.url));
    assert.equal(registrations.length,1);assert.equal(registrations[0].name,'ym2612-processor');
    const processor=new registrations[0].Type(),chip=fakeChip();processor.ym2612=chip;
    processor.applyCommand({type:'synth-channel-mute',channel:3,muted:true});
    processor.applyCommand({type:'write',port:1,register:0xb4,value:0xe7});assert.equal(chip.registers[1][0xb4],0x27);
    processor.applyCommand({type:'synth-channel-mute',channel:3,muted:false});assert.equal(chip.registers[1][0xb4],0xe7);
  } finally {
    for(const [key,descriptor]of descriptors)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  }
});

test('both shared processor bodies export the same class while retaining their source/served import mappings',async()=>{
  for(const [file]of variants){
    const source=await readFile(new URL(`../js/${file}`,import.meta.url),'utf8');
    assert.match(source,/export class YM2612Processor extends AudioWorkletProcessor/);
    const canonical=await readFile(new URL(`../../tetorica_src/runtime/${file}`,import.meta.url),'utf8');
    const body=text=>text.replace(/^import .*;\n/gm,'');
    assert.equal(body(source),body(canonical));
    assert.match(canonical,/from "\.\/generated\//);assert.match(source,/from "\.\.\/generated\//);
  }
  for(const file of ['synth_fm_worklet.js','synth_fm_worklet_nuked.js']) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');assert(!source.includes('registerProcessor'));
    assert.match(source,/decorateSynthFmProcessor\(YM2612Processor\)/);
  }
});
