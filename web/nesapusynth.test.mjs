import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundChip} from './soundchip.js';
import {NesApuSynth,NesApuDirectTransport,NesApuWorkletTransport} from './nesapusynth.js';

for(const channel of [0,1,2,5])test(`NES/FDS tone ${channel}: A4, off/on, owned PCM`,async()=>{
 const chip=await createSoundChip('nes',{fds:true});const synth=new NesApuSynth({transport:new NesApuDirectTransport(chip)});
 try{
  for(let cycle=0;cycle<2;cycle++){
   synth.noteOn(channel,'A4');chip.generateStereo(4410);const pcm=chip.generateStereo(44100);
   let crossings=0;for(let i=1;i<pcm.left.length;i++)if(pcm.left[i-1]<0&&pcm.left[i]>=0)crossings++;
   assert.ok(Math.abs(crossings-440)<3,`frequency ${crossings}`);assert.ok(pcm.left.some(v=>Math.abs(v)>.01));assert.deepEqual(pcm.left,pcm.right);
   const saved=pcm.left.slice();synth.noteOff(channel);chip.generateStereo(44100);assert.deepEqual(pcm.left,saved);
   assert.ok(chip.generateStereo(1024).left.every(v=>Math.abs(v)<.001));
  }
 }finally{chip.dispose();}assert.throws(()=>chip.generateStereo(1),/disposed/);
});
test('noise modes, FDS custom wave/modulation and channel isolation',async()=>{
 const chip=await createSoundChip('nes',{fds:true});const synth=new NesApuSynth({transport:new NesApuDirectTransport(chip)});
 try{
  for(const shortMode of [false,true]){synth.reset();synth.noise.setVoice({volume:10,period:5,shortMode});synth.noise.noteOn();assert.ok(chip.generateStereo(10000).left.some(v=>Math.abs(v)>.01));synth.noise.noteOff();}
  const wave=Uint8Array.from({length:64},(_,i)=>i);synth.fds.setWave(wave);assert.deepEqual(chip.engine.fds.wave,wave);
  const mod=Array.from({length:32},(_,i)=>i%8);synth.fds.setModulation({table:mod,rate:120,depth:8,bias:-3});assert.deepEqual([...chip.engine.fds.modulation],mod);
  synth.fds.noteOn('C4');assert.ok(chip.generateStereo(10000).left.some(v=>Math.abs(v)>.01));
  synth.pulse.noteOn(0,'C4');synth.pulse.noteOn(1,'E4');synth.pulse.noteOff(0);assert.equal(chip.enableMask&3,2);
 }finally{chip.dispose();}
});
test('DMC owns padded bytes and does not restart completed samples when a pulse starts',async()=>{
 const chip=await createSoundChip('nes');const synth=new NesApuSynth({transport:new NesApuDirectTransport(chip)});
 try{
  const input=new Uint8Array(32).fill(0xff);const sample=await synth.dmc.loadSample(input);assert.deepEqual(sample,{address:0xc000,length:33});input.fill(0);
  assert.equal(chip.engine.memory[0xc000],255);assert.equal(chip.engine.memory[0xc020],0xaa);
  synth.dmc.play({rate:15});const pcm=chip.generateStereo(5000);assert.ok(pcm.left.some(v=>Math.abs(v)>.001));assert.equal(chip.engine.apu.dmc.playLengthCounter,0);
  synth.pulse.noteOn(0,'C4');assert.equal(chip.enableMask&16,0);assert.equal(chip.engine.apu.dmc.playLengthCounter,0);
  synth.dmc.play({rate:8,loop:true});chip.generateStereo(5000);assert.ok(chip.engine.apu.dmc.playLengthCounter>0);synth.dmc.stop();assert.equal(chip.enableMask&16,0);
 }finally{chip.dispose();}
});
test('invalid NES/FDS parameters fail before writes, and FDS is explicitly enabled',()=>{
 const writes=[];const synth=new NesApuSynth({transport:{writeRegister:(...args)=>writes.push(args)}});writes.length=0;
 for(const fn of [()=>synth.noteOn(0,'C0'),()=>synth.noteOn(3,'C4'),()=>synth.pulse.setVoice(0,{duty:.3}),()=>synth.pulse.setVoice(0,{volume:20}),()=>synth.noise.setVoice({period:16}),()=>synth.fds.setWave(new Uint8Array(64)),()=>synth.writeRegister(0x4030,2)])assert.throws(fn);
 assert.equal(writes.length,0);
 const fds=new NesApuSynth({fds:true,transport:{writeRegister:(...args)=>writes.push(args)}});writes.length=0;
 assert.throws(()=>fds.fds.setWave(Array(64).fill(64)));assert.throws(()=>fds.fds.setModulation({table:Array(32).fill(8)}));assert.equal(writes.length,0);
});
test('memory uploads complete before DMC play and reset invalidates pending descriptors',async()=>{
 let ready;const synth=new NesApuSynth({transport:{writeRegister(){},loadMemory:()=>new Promise(resolve=>ready=resolve)}});
 const pending=synth.dmc.loadSample(new Uint8Array(1));assert.throws(()=>synth.dmc.play(),/Load/);synth.reset();ready();await assert.rejects(pending,/reset/);
});
test('Worklet transport sends register commands and capability metadata',async()=>{
 const messages=[];const endpoint={execution:'worklet',clock:1789773,fdsEnabled:true,port:{postMessage:m=>messages.push(m)},request:async(method,args)=>messages.push({method,args})};
 const transport=new NesApuWorkletTransport(endpoint);const synth=new NesApuSynth({transport});assert.equal(synth.fdsEnabled,true);messages.length=0;
 synth.noteOn(0,'A4');assert.ok(messages.some(m=>m.method==='setChannelEnabled'));await synth.dmc.loadSample(new Uint8Array(1));assert.ok(messages.some(m=>m.method==='loadMemory'));
});
