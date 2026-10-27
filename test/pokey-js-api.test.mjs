import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../docs/generated/pokey_wasm.js';
import {Pokey,POKEY_CLOCK} from '../web/pokey.js';
import {PokeySynth,PokeyDirectTransport} from '../web/pokeysynth.js';
import {PokeyAudioEngine} from '../web/pokeyaudioengine.js';
import {createSoundChip,SoundChipMixer} from '../web/soundchip.js';

const binary=await readFile(new URL('../docs/generated/pokey_wasm.wasm',import.meta.url));
const module=await factory({wasmBinary:binary});
const create=options=>Pokey.create({moduleFactory:async()=>module,...options});
function configure(chip,ch=0,value=0xa8){chip.writeRegister(15,3);chip.writeRegister(ch*2,72);chip.writeRegister(ch*2+1,value);chip.writeRegister(9,0);}

test('POKEY same WASM module owns independent handles, buffers, registers and lifetimes',async()=>{
  const first=await create(),second=await create();
  try{
    configure(first);const pcm=first.generateStereo(4096);assert(pcm.left.some(x=>x>0));assert.deepEqual(pcm.left,pcm.right);assert(pcm.left.every(x=>x>=0),'direct PCM remains raw unipolar');
    assert(second.generateStereo(4096).left.every(x=>x===0),'first writes do not start second');
    configure(second,2,0xaf);const retained=second.generateStereo(1024),snapshot=retained.left.slice();
    first.setChannelMuted(0,true);assert(first.generateStereo(128).left.every(x=>x===0));assert(second.generateStereo(128).left.some(x=>x>0));
    first.reset();first.dispose();assert(second.generateStereo(128).left.some(x=>x>0));assert.deepEqual(retained.left,snapshot,'owned copies survive other renders/disposal');
    second.writeRegister(0,0x55);assert.notEqual(second.readRegister(0),0x55,'hardware POT read map does not echo write-only AUDF');
    assert.equal(second.clock,POKEY_CLOCK);assert.equal(second.sampleRate(),44100);
  }finally{first.dispose();second.dispose();}
});

test('POKEY real factory allocates distinct stable IDs and validates strict raw bounds',async()=>{
  const [first,second]=await Promise.all([createSoundChip('pokey'),createSoundChip('pokey',{clock:1789773,sampleRate:48000})]);
  try{
    assert.notEqual(first.id,second.id);assert.equal(second.clock,1789773);assert.equal(second.sampleRate(),48000);
    for(const run of [()=>first.writeRegister(16,0),()=>first.writeRegister(0,256),()=>first.readRegister(-1),()=>first.setChannelMuted(4,true),()=>first.setChannelMuted(0,1),()=>first.generateStereo(-1),()=>first.reserveFrames(1.5)])assert.throws(run);
    const same=new Float32Array(32);assert.throws(()=>first.generateStereoInto(same,same));
    const short=new Float32Array(1);assert.throws(()=>first.generateStereoInto(short,short,2));
    first.reserveFrames(128);assert.equal(first.generateStereoView(128),first.generateStereoView(128));
    for(const frames of [1,3,4,127,128])assert.equal(first.generateStereoView(frames),first.generateStereoView(frames));
  }finally{first.dispose();second.dispose();}
  await assert.rejects(createSoundChip('pokey',{mixer:new SoundChipMixer()}),/worklet/);
  await assert.rejects(create({clock:0}),/clock/);await assert.rejects(create({sampleRate:1}),/sample rate/);
});

test('POKEY Synth tunes real 4CH tones and explicit high-clock joined pairs',async()=>{
  const chip=await create(),synth=new PokeySynth({transport:new PokeyDirectTransport(chip)});
  try{
    assert.throws(()=>synth.keyOn(0),/initialize/);synth.initialize();assert(chip.generateStereo(512).left.every(x=>x===0));
    for(let ch=0;ch<4;ch++){
      const actual=synth.setNote(ch,'A4');assert.equal(actual,POKEY_CLOCK/(2*28*73));synth.keyOn(ch);
      const pcm=chip.generateStereo(44100).left;let edges=0;for(let i=1;i<pcm.length;i++)if(pcm[i-1]===0&&pcm[i]>0)edges++;
      assert(Math.abs(edges-actual)<2,`channel ${ch}: ${edges} edges vs ${actual} Hz`);synth.keyOff(ch);assert(chip.generateStereo(512).left.every(x=>x===0));
    }
    synth.setJoined(0,true);synth.setHighClock(0,true);assert.throws(()=>synth.keyOn(0),/helper/);assert.throws(()=>synth.setFrequency(0,440),/upper/);
    const actual=synth.setFrequency(1,440);assert(Math.abs(actual-440)<.2);synth.keyOn(1);assert(chip.generateStereo(1024).left.some(x=>x>0));
    const state=synth._getState();assert(state.registers[8]&0x50);synth.allNotesOff();synth._adoptState(state);assert.deepEqual(synth._getState(),state);
    for(const run of [()=>synth.setVolume(0,16),()=>synth.setDistortion(0,8),()=>synth.setFrequency(1,0),()=>synth.setHighClock(1,true),()=>synth.setJoined(2,true),()=>synth.setPoly9(1),()=>synth.setBaseClock('unknown'),()=>synth._adoptState({...state,levels:[8,8,8,99]})])assert.throws(run);
    assert.deepEqual(synth._getState(),state,'invalid author state does not partially mutate');
  }finally{synth.dispose();chip.dispose();}
});

test('POKEY speaker removes DC at unity, preserves block boundaries and gates to exact silence',async()=>{
  const [one,two]=await Promise.all([create({sampleRate:48000}),create({sampleRate:48000})]);
  const a=new PokeyAudioEngine(one),b=new PokeyAudioEngine(two);
  try{
    for(const engine of [a,b])for(const [reg,value]of [[15,3],[0,72],[1,0xa8],[9,0]])engine.writeRegister(reg,value);
    const whole=a.processFrames(4096),left=new Float32Array(4096),right=new Float32Array(4096);let index=0;
    for(const frames of [1,3,124,128,997,1024,1819]){const part=b.generateStereoView(frames);left.set(part.left,index);right.set(part.right,index);index+=frames;}
    assert.equal(index,4096);assert.deepEqual(whole,{left,right});assert(whole.left.some(x=>x<0));assert(whole.left.some(x=>x>0));
    b.setChannelMuted(0,true);assert(b.processFrames(128).left.every(x=>x===0));b.setChannelMuted(0,false);assert(b.processFrames(128).left.some(x=>x!==0));
    b.writeRegister(1,0xa0);assert(b.processFrames(128).left.every(x=>x===0));assert.equal(b.previousOutput,0);
    b.writeRegister(1,0x18);b.processFrames(48000);const dc=b.processFrames(128).left;assert(Math.max(...dc.map(Math.abs))<1e-12,'volume-only constant loses only DC');
    b.reset();assert(b.processFrames(128).left.every(x=>x===0));
  }finally{a.dispose();b.dispose();}
});
