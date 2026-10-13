import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {noteToHz,opnPitchFromHz} from './soundchip_pitch.js';
import {YM2612Synth,YM2612DirectTransport} from './ym2612synth.js';
import {YM2203Synth,YM2203DirectTransport} from './ym2203synth.js';
import {YM2608Synth,YM2608DirectTransport} from './ym2608synth.js';
import {YM2610BSynth,YM2610BDirectTransport,NeoGeoFMSynth} from './ym2610bsynth.js';
import {Ym2612} from './ym2612.js';
import {Ym2203} from './ym2203.js';
import {Ym2608} from './ym2608.js';
import {Ym2610B} from './ym2610b.js';
import {SegaPSGSynth} from './segapsgsynth.js';
import {SSGSynth} from './ssgsynth.js';
import {createWorkerChip} from './playground_worker_chip.js';

function countFrequency(pcm,rate){const center=pcm.reduce((sum,x)=>sum+x,0)/pcm.length;let count=0;for(let i=1;i<pcm.length;i++)if(pcm[i-1]<center&&pcm[i]>=center)count++;return count*rate/pcm.length;}
for(const [name,Chip,Synth,Transport] of [['ym2612',Ym2612,YM2612Synth,YM2612DirectTransport],['ym2203',Ym2203,YM2203Synth,YM2203DirectTransport],['ym2608',Ym2608,YM2608Synth,YM2608DirectTransport],['ym2610b',Ym2610B,YM2610BSynth,YM2610BDirectTransport]]){
 test(`${name}: Hz and MIDI/name note setters render the same A4; raw overloads remain exact`,async()=>{
  const {default:moduleFactory}=await import(`../docs/generated/${name}_wasm.js`);
  const chip=await Chip.create({moduleFactory,moduleOptions:{wasmBinary:await readFile(new URL(`../docs/generated/${name}_wasm.wasm`,import.meta.url))}});
  const synth=new Synth({transport:new Transport(chip)});
  try{
   synth.setAlgo(0,7);if(name!=='ym2203')synth.setPan(0,true,true);
   synth.setOperator(0,3,{multi:1,tl:0,ar:31,d1r:0,d2r:0,sl:0,rr:15});
   for(const start of [()=>{synth.setFrequency(0,440);synth.keyOn(0);},()=>synth.noteOn(0,'A4'),()=>synth.noteOn(0,69)]){
    start();const rate=chip.sampleRate();chip.generateStereo(Math.ceil(rate*.05));
    const hz=countFrequency(chip.generateStereo(Math.ceil(rate*.5)).left,rate);
    assert.ok(Math.abs(hz-440)<5,`${name}: ${hz} Hz`);synth.keyOff(0);
   }
   synth.setNote(0,'C#4');const sharp=structuredClone(synth.channels[0]);synth.setNote(0,'Db4');assert.equal(synth.channels[0].fnum,sharp.fnum);
   synth.setBlockFnum(0,4,600);assert.equal(synth.channels[0].fnum,600);
   synth.setFrequency(0,3,700);assert.equal(synth.channels[0].block,3);assert.equal(synth.channels[0].fnum,700);
   synth.noteOnRaw(0,2,800);assert.equal(synth.channels[0].fnum,800);
   synth.noteOn(0,5,900);assert.equal(synth.channels[0].fnum,900);
   const before=structuredClone(synth.channels);
   for(const bad of [NaN,Infinity,0,-1])assert.throws(()=>synth.setFrequency(0,bad));
   for(const bad of [undefined,440,69.5,'wrong'])assert.throws(()=>synth.noteOn(0,bad));
   assert.deepEqual(synth.channels,before);
  }finally{chip.dispose();}
 });
}

test('PSG restores raw-configured attenuation after keyOff and keeps tone pitch unchanged',()=>{
 const writes=[];const psg=new SegaPSGSynth({transport:{write:v=>writes.push(v)}});
 psg.write(0x95);psg.setFrequency(0,440);writes.length=0;
 psg.keyOff(0);psg.keyOff(0);psg.keyOn(0);assert.deepEqual(writes,[0x9f,0x9f,0x95]);
 psg.setNote(1,69);const a=writes.slice(-2);psg.setNote(1,'A4');assert.deepEqual(writes.slice(-2),a);
 const count=writes.length;assert.throws(()=>psg.setFrequency(0,NaN));assert.throws(()=>psg.noteOn(0,440));assert.equal(writes.length,count);
});

test('SSG tone gates preserve volume, noise gates, other channels and I/O',()=>{
 const writes=[];const ssg=new SSGSynth({clock:2000000,transport:{write:(...args)=>writes.push(args)}});
 ssg.write(7,0xff);ssg.setVolume(0,12);ssg.setNote(0,69);const period=[ssg.registers[0],ssg.registers[1]];
 ssg.keyOn(0);assert.equal(ssg.registers[7],0xfe);ssg.keyOff(0);assert.equal(ssg.registers[7],0xfe);assert.equal(ssg.registers[8],0);ssg.keyOn(0);
 assert.equal(ssg.registers[8],12);assert.deepEqual([ssg.registers[0],ssg.registers[1]],period);
 ssg.noteOn(1,'E4');assert.equal(ssg.registers[7],0xfc);
 const count=writes.length;assert.throws(()=>ssg.noteOn(3,'A4'));assert.throws(()=>ssg.setNote(0,440));assert.equal(writes.length,count);
});

test('Neo Geo and Worker map all new pitch operations to the physical channels',()=>{
 const full=new YM2610BSynth({transport:{write(){},reset(){}}}),neo=new NeoGeoFMSynth(full);
 neo.setNote(3,'A4');assert.ok(full.channels[5].fnum>0);neo.setBlockFnum(3,4,600);assert.equal(full.channels[5].fnum,600);
 const commands=[];const chip=createWorkerChip({port:{start(){},postMessage:data=>commands.push(data)},capabilities:{chip:'ym2610',fmChannels:4}});
 chip.fm.noteOn(3,69);const expected=opnPitchFromHz(noteToHz(69),8000000);
 assert.equal(chip.raw.channels[5].fnum,expected.fnum);assert.ok(commands.flat().some(c=>c.register===0x28&&c.value===0xf6));
 chip.fm.setBlockFnum(3,4,700);assert.equal(chip.raw.channels[5].fnum,700);
 chip.fm.noteOnRaw(3,4,800);assert.equal(chip.raw.channels[5].fnum,800);
});

test('Game Boy common and grouped noteOn sound at the specified pitch and require initialization',async()=>{
 const {GameboyApu}=await import('./gameboyapu.js');const {GameboySynth,GameboyDirectTransport}=await import('./gameboysynth.js');
 const {default:moduleFactory}=await import('../docs/generated/gameboy_apu_wasm.js');
 const chip=await GameboyApu.create({sampleRate:48000,moduleFactory,moduleOptions:{wasmBinary:await readFile(new URL('../docs/generated/gameboy_apu_wasm.wasm',import.meta.url))}});
 const synth=new GameboySynth({transport:new GameboyDirectTransport(chip)});
 try{
  assert.throws(()=>synth.noteOn(0,'A4'),/initialize/);synth.initialize();
  synth.pulse.setVoice(0,{duty:.5,volume:12});synth.pulse.setVoice(1,{duty:.5,volume:12});
  synth.wave.setWaveform(Uint8Array.from({length:32},(_,i)=>Math.round(7.5+7.5*Math.sin(i*2*Math.PI/32))));
  for(const ch of [0,1,2]){
   synth.noteOn(ch,69);chip.generateStereo(4800);
   assert.ok(Math.abs(countFrequency(chip.generateStereo(12000).left,48000)-440)<5);
   synth.keyOff(ch);chip.generateStereo(4800);
  }
  synth.pulse.noteOn(0,'A4');chip.generateStereo(4800);assert.ok(Math.abs(countFrequency(chip.generateStereo(12000).left,48000)-440)<5);synth.pulse.keyOff(0);
  synth.wave.noteOn('A4');chip.generateStereo(4800);assert.ok(Math.abs(countFrequency(chip.generateStereo(12000).left,48000)-440)<5);synth.wave.keyOff();
  assert.throws(()=>synth.setNote(3,69));assert.throws(()=>synth.noteOn(0,440));
 }finally{synth.dispose();chip.dispose();}
});

test('NES triangle/FDS grouped setters use Hz, preserve pitch on retrigger and reject missing FDS',async()=>{
 const {NesApu}=await import('./nesapu.js');const {NesApuSynth,NesApuDirectTransport}=await import('./nesapusynth.js');
 const chip=new NesApu({fds:true});const synth=new NesApuSynth({transport:new NesApuDirectTransport(chip)});
 try{
  for(const part of [synth.triangle,synth.fds]){
   part.setFrequency(437);part.keyOn();chip.generateStereo(4410);
   assert.ok(Math.abs(countFrequency(chip.generateStereo(22050).left,44100)-437)<5);
   part.keyOff();chip.generateStereo(4410);part.keyOn();chip.generateStereo(4410);
   assert.ok(Math.abs(countFrequency(chip.generateStereo(22050).left,44100)-437)<5);
   part.keyOff();chip.generateStereo(4410);part.noteOn(69);chip.generateStereo(4410);
   assert.ok(Math.abs(countFrequency(chip.generateStereo(22050).left,44100)-440)<5);part.keyOff();
  }
 }finally{chip.dispose();}
 const noFds=new NesApuSynth({transport:{writeRegister(){}}});assert.throws(()=>noFds.fds.keyOn(),/FDS/);assert.throws(()=>noFds.fds.setFrequency(440),/FDS/);
});

test('note validation is shared by NES and Game Boy: lowercase, enharmonics and MIDI',async()=>{
 const {GameboySynth}=await import('./gameboysynth.js');const {NesApuSynth}=await import('./nesapusynth.js');
 const gb=new GameboySynth({transport:{writeRegister(){},reset(){}}});gb.initialize();
 const nes=new NesApuSynth({transport:{writeRegister(){}}});
 for(const synth of [gb,nes]) {
  assert.equal(synth.setNote(0,'c#4'),synth.setNote(0,'Db4'));
  assert.equal(synth.setNote(0,'a4'),synth.setNote(0,69));
  for(const note of [undefined,NaN,69.5,440,'invalid']) assert.throws(()=>synth.setNote(0,note),/Note|note/);
 }
 gb.dispose();
});
