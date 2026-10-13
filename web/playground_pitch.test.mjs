import test from 'node:test';
import assert from 'node:assert/strict';
import {midiToOpnPitch,opnPitchFromHz} from './soundchip_pitch.js';
import {createPlaygroundMusic} from './playground_music.js';
import {createMidiRack,createMidiApi} from './playground_midi.js';
import {createPitchFromMidi} from './pitch.js';
import {FM_PRESETS} from './megasynth-fm-presets.js';
import {Ym2612} from './ym2612.js';
import {YM2612Synth,YM2612DirectTransport} from './ym2612synth.js';
import factory from '../docs/generated/ym2612_wasm.js';
import {readFile} from 'node:fs/promises';
const clock=7670454;
const hz=p=>p.fnum*clock*2**(p.block-1)/(144*2**20);
function measured(chip){const rate=chip.sampleRate();chip.generateStereo(Math.ceil(rate*.05));const pcm=chip.generateStereo(Math.ceil(rate*.5)).left;const center=pcm.reduce((a,b)=>a+b,0)/pcm.length;let count=0;for(let i=1;i<pcm.length;i++)if(pcm[i-1]<center&&pcm[i]>=center)count++;return count*rate/pcm.length;}

test('MIDI pitch converter matches MIDI Playground native rounding, fractional bends and saturation',()=>{
 // Independent transcription of synth_core.rs::tune; MIDI API and clamping are unchanged.
 function native(midi,inputClock){let best=[Infinity,0,1];const frequency=440*2**((midi-69)/12);for(let block=0;block<8;block++){const unit=inputClock*2**(block-1)/(144*1048576);const fnum=Math.max(1,Math.min(2047,Math.round(frequency/unit)));const error=Math.abs(fnum*unit-frequency);if(error<best[0])best=[error,block,fnum];}return {block:best[1],fnum:best[2]};}
 for(const inputClock of [clock,Math.round(clock/2)])for(const note of [0,60,69,69.25,69.5,71,127,-96,223])assert.deepEqual(midiToOpnPitch(note,inputClock),native(note,inputClock));
 assert.ok(Math.abs(hz(midiToOpnPitch(69))-440)<.3);
 assert.ok(Math.abs(hz(midiToOpnPitch(69.5))-440*2**(.5/12))<.3);
 for(const invalid of [NaN,Infinity,-Infinity])assert.throws(()=>midiToOpnPitch(invalid));
});

test('calibrated music helpers and real play agree with setNote; custom helper references still work',async()=>{
 const chip=await Ym2612.create({moduleFactory:factory,moduleOptions:{wasmBinary:await readFile(new URL('../docs/generated/ym2612_wasm.wasm',import.meta.url))}});
 const synth=new YM2612Synth({transport:new YM2612DirectTransport(chip)});
 let actual;
 const options={noteToSemitone:{A:9,C:0},scaleIntervals:{},createPitchFromMidi,pitchReference:{referenceMidi:62,referenceBlock:4,referenceFnum:553},synth:()=>synth,presets:{},activeNotes:new Set(),sleep:async()=>{actual=measured(chip);}};
 const api=createPlaygroundMusic({...options,getPitch:midi=>midiToOpnPitch(midi,synth.clock),getFrequencyPitch:(frequency,inputClock)=>opnPitchFromHz(frequency,inputClock??synth.clock,144,{clamp:true})});
 try{
  synth.setPreset(0,FM_PRESETS['one-op-basic']);await api.play('A4',{seconds:.5});assert.ok(Math.abs(actual-440)<5,actual);
  synth.setNote(0,'A4');assert.deepEqual(api.noteToBlockFnum('A4'),{block:synth.channels[0].block,fnum:synth.channels[0].fnum});
  assert.deepEqual(api.noteLerp('A4','A5',.5),midiToOpnPitch(75));
  synth.clock=clock/2;assert.deepEqual(api.noteToBlockFnum(69),midiToOpnPitch(69,clock/2));assert.deepEqual(api.hzToBlockFnum(440),api.noteToBlockFnum(69));
  const custom=createPlaygroundMusic(options);assert.deepEqual(custom.noteToBlockFnum('A4'),createPitchFromMidi(69,options.pitchReference));
 }finally{chip.dispose();}
});

test('MIDI output keeps play duration/channel interface while real A4 and bend use standard Hz',async()=>{
 const chip=await Ym2612.create({moduleFactory:factory,moduleOptions:{wasmBinary:await readFile(new URL('../docs/generated/ym2612_wasm.wasm',import.meta.url))}});
 let inputClock=clock;const writes=[];
 const rack=createMidiRack({preset:FM_PRESETS['one-op-basic'],getClockScale:()=>clock/inputClock,write:e=>{writes.push(e);chip.writeRegister(e.register,e.value,e.port);},writePsg(){}});
 const waits=[];let actual;
 const api=createMidiApi((method,args)=>method==='release'?rack.noteOff(args[0],args[1],args[2],undefined,args[3]):rack[method](...args),{bpm:()=>120,sleep:async seconds=>{waits.push(seconds);actual=measured(chip);}});
 try{
  const out=api.output('tetorica-ym2612',{channel:15});await out.play('A4',{duration:1});assert.deepEqual(waits,[.5]);assert.ok(Math.abs(actual-440)<5,actual);
  await out.noteOn(69);await out.pitchBend(1);assert.ok(Math.abs(measured(chip)-440*2**(2/12))<5);await out.noteOff(69);
  await out.pitchBend(0);inputClock=clock/2;writes.length=0;await out.noteOn(69);
  const high=writes.find(e=>e.register===0xa4).value,low=writes.find(e=>e.register===0xa0).value;
  assert.deepEqual({block:(high>>3)&7,fnum:((high&7)<<8)|low},midiToOpnPitch(69,inputClock));
 }finally{rack.stop();chip.dispose();}
});
