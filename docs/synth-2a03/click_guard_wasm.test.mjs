// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';
import {createDemoDpcm, waveShape} from './preset.js';
import {OutputClickGuard} from './click_guard.js';

const wasmBinary = await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
const rms = values => Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
const peak = values => values.reduce((result,value)=>Math.max(result,Math.abs(value)),0);
const maximumStep = (values,previous) => {
  let maximum=0;
  for(const value of values) {maximum=Math.max(maximum,Math.abs(value-previous));previous=value;}
  return maximum;
};
const close = (actual,expected,message) => assert(Math.abs(actual-expected)<1e-7,`${message}: ${actual} / ${expected}`);

async function fixture(t,rate,source,configure=()=>{}) {
  const core=await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:rate,fds:true});
  const instrument=new NesInstrument(core), guard=new OutputClickGuard({sampleRate:rate});
  t.after(()=>instrument.dispose());
  const preset=instrument.read().preset;preset.source=source;
  if(source==='dmc') {preset.dmc.data=createDemoDpcm();preset.dmc.loop=true;}
  configure(preset);instrument.loadPreset(preset);
  let last=0;
  function render(frames) {
    const raw={left:new Float32Array(frames),right:new Float32Array(frames)};
    const output={left:new Float32Array(frames),right:new Float32Array(frames)};
    for(let offset=0;offset<frames;offset+=128) {
      const count=Math.min(128,frames-offset),pcm=instrument.generateStereo(count);
      raw.left.set(pcm.left,offset);raw.right.set(pcm.right,offset);
      const state=instrument.read();
      guard.process(pcm);
      assert.deepEqual(instrument.read(),state,'processing output cannot change registers, counters, gains or owners');
      output.left.set(pcm.left,offset);output.right.set(pcm.right,offset);
    }
    assert(output.left.every(Number.isFinite)&&output.right.every(Number.isFinite));
    if(frames)last=output.left.at(-1);
    return {raw,output};
  }
  render(Math.round(rate*.3));
  return {core,instrument,guard,render,seconds:seconds=>render(Math.round(rate*seconds)),last:()=>last,duration:guard.read().durationFrames};
}

test('DMC attack guard removes the initial DAC edge while settled held PCM remains exactly the real core output',async t=>{
  for(const rate of [44100,48000])for(const level of [0,64,65,127]) {
    const f=await fixture(t,rate,'dmc',preset=>{preset.dmc.level=level;});
    const previous=f.last();f.guard.attack();f.instrument.noteOn('held',60);
    const {raw,output}=f.seconds(.035);
    close(output.left[0],previous,'the first guarded frame continues the previous output');
    assert.deepEqual(output.left.slice(f.duration),raw.left.slice(f.duration),'the guard does not recolor the sustained DPCM');
    assert.deepEqual(output.right.slice(f.duration),raw.right.slice(f.duration));
    assert.equal(f.guard.read().phase,'bypass');
    assert.equal(f.instrument.read().voices[0].id,'held');
    if(level>=64) {
      assert(Math.abs(raw.left[0]-previous)>.25,'the raw DAC seed makes the measured initial edge');
      const window=Math.round(rate*.01);
      assert(maximumStep(output.left.slice(0,window),previous)<maximumStep(raw.left.slice(0,window),previous)/10,
        'a short software attack suppresses the abrupt edge without claiming to remove the entire DC/filter transient');
    }
  }
});

test('finished DMC one-shots no longer produce the Synth DAC-clear pop when the silent held key is released',async t=>{
  for(const rate of [44100,48000])for(const level of [64,65]) {
    const f=await fixture(t,rate,'dmc',preset=>{preset.dmc.level=level;preset.dmc.loop=false;});
    f.guard.attack();f.instrument.noteOn('one-shot',60);f.seconds(.241);
    assert.equal(f.core.getState().dmcRemaining,0);
    const previous=f.last();assert(Math.abs(previous)<.00001,'the completed sample has already settled before release');
    f.guard.release();assert.equal(f.instrument.noteOff('one-shot'),true);
    assert.equal(f.core.getState().dmcOutput,0,'the existing chip-register release policy remains intact');
    assert.deepEqual(f.instrument.read().voices,[]);
    const {raw,output}=f.seconds(.04);
    assert(Math.abs(raw.left[0]-previous)>.25,'the unchanged core still shows the DAC-clear transient');
    assert(rms(raw.left.slice(0,Math.round(rate*.02)))>.1);
    close(output.left[0],previous,'release begins at the last emitted frame');
    assert(rms(output.left)<.00001,'the previously silent key cannot add a large release pulse');
    assert(output.left.slice(f.duration).every(value=>value===0));
    assert(output.right.slice(f.duration).every(value=>value===0));
    assert.equal(f.guard.read().phase,'muted');
  }
});

test('DMC loop release decays from the actual last output instead of passing the hard DAC-clear edge or filter tail',async t=>{
  for(const rate of [44100,48000])for(const hold of [.01,.037,.241]) {
    const f=await fixture(t,rate,'dmc');f.guard.attack();f.instrument.noteOn('loop',60);f.seconds(hold);
    assert(f.core.getState().dmcRemaining>0);const previous=f.last();
    f.guard.release();f.instrument.noteOff('loop');const {raw,output}=f.seconds(.03);
    close(output.left[0],previous,'release continuity');
    assert(output.left.every(value=>Math.abs(value)<=Math.abs(previous)+1e-7),'the short release tail cannot overshoot the old output');
    assert(output.left.slice(f.duration-1).every(value=>value===0),'the terminal frame and the subsequent muted output are zero');
    const rawStep=maximumStep(raw.left.slice(0,Math.round(rate*.01)),previous);
    assert(rawStep>.15,'each release phase contains a substantial unguarded DAC step');
    assert(maximumStep(output.left,previous)<rawStep/20);
    assert.equal(f.core.getState().dmcOutput,0);assert.equal(f.core.getState().enableMask&16,0);
  }
});

test('FDS fixed waves and hardware envelopes retain exact settled PCM, gains, phase and owners through the software attack',async t=>{
  const cases=[
    preset=>{preset.fds.wave=waveShape('sine');},
    preset=>{preset.fds.wave=waveShape('square');preset.fds.volume=32;},
    preset=>{preset.fds.wave=waveShape('saw');},
    preset=>{preset.fds.envelope={enabled:true,increase:true,period:8,initialGain:0};},
    preset=>{preset.fds.envelope={enabled:true,increase:false,period:8,initialGain:32};},
    preset=>{preset.fds.modulation.enabled=true;preset.fds.modulation.envelope={enabled:true,increase:true,period:8,initialGain:0};},
  ];
  for(const rate of [44100,48000])for(const configure of cases) {
    const f=await fixture(t,rate,'fds',configure),previous=f.last();
    f.guard.attack();f.instrument.noteOn('wave',60);const {raw,output}=f.seconds(.045);
    close(output.left[0],previous,'FDS attack continuity');
    assert.deepEqual(output.left.slice(f.duration),raw.left.slice(f.duration),'hardware Envelope / modulation waveform is unchanged after the short edge');
    assert.deepEqual(output.right.slice(f.duration),raw.right.slice(f.duration));
    assert.equal(f.guard.read().phase,'bypass');assert.equal(f.instrument.read().voices[0].id,'wave');
    const state=f.core.getState();assert.equal(state.fdsActive,true);
    assert.equal(state.registers[0x80]&128,f.instrument.read().preset.fds.envelope.enabled?0:128);
  }
});

test('FDS release is continuous at different wave phases and suppresses a constant-wave gain-clear transient',async t=>{
  for(const rate of [44100,48000])for(const hold of [.031,.032,.033,.034,.035]) {
    const f=await fixture(t,rate,'fds');f.guard.attack();f.instrument.noteOn('phase',60);f.seconds(hold);
    const previous=f.last();f.guard.release();f.instrument.noteOff('phase');
    const {output}=f.seconds(.03);
    close(output.left[0],previous,'FDS release phase continuity');
    assert(output.left.every(value=>Math.abs(value)<=Math.abs(previous)+1e-7));
    assert(output.left.slice(f.duration-1).every(value=>value===0));
    assert.equal(f.core.getState().fdsGain,0);assert.equal(f.core.getState().fdsActive,false);
    assert.deepEqual(f.instrument.read().voices,[]);
  }
  for(const rate of [44100,48000]) {
    const f=await fixture(t,rate,'fds',preset=>{preset.fds.wave=Array(64).fill(63);preset.fds.volume=32;});
    f.guard.attack();f.instrument.noteOn('constant',60);f.seconds(.3);
    const previous=f.last();assert(Math.abs(previous)<.00001);
    f.guard.release();f.instrument.noteOff('constant');const {raw,output}=f.seconds(.04);
    assert(peak(raw.left)>.1,'cutting fixed gain on a constant wave produces a filtered DC pulse');
    assert(rms(output.left)<.00001,'the output tail does not introduce that pulse after a settled constant wave');
  }
});

test('rapid FDS and DMC attacks and releases bridge the last emitted sample without changing mono ownership or chip progression',async t=>{
  for(const rate of [44100,48000])for(const source of ['fds','dmc']) {
    const f=await fixture(t,rate,source);
    let owner='first';f.guard.attack();f.instrument.noteOn(owner,60);f.seconds(.002);
    for(const [index,seconds] of [.001,.002,.003,.007].entries()) {
      const previous=f.last(),old=owner;owner=`next-${index}`;
      f.guard.attack();const result=f.instrument.noteOn(owner,64+index);
      assert.equal(result.stolenId,old);
      const attack=f.seconds(seconds);close(attack.output.left[0],previous,'rapid retrigger continuity');
      assert.equal(f.instrument.noteOff(old),false,'a stale key release cannot stop the new chip owner');
      assert.equal(f.instrument.read().voices[0].id,owner);
    }
    const previous=f.last();f.guard.release();f.instrument.noteOff(owner);const release=f.seconds(.001);
    close(release.output.left[0],previous,'release during an attack remains continuous');
    const tail=f.last();f.guard.attack();f.instrument.noteOn('after-tail',60);const next=f.seconds(.025);
    close(next.output.left[0],tail,'an attack during the release tail continues the rendered output');
    assert.deepEqual(next.output.left.slice(f.duration),next.raw.left.slice(f.duration));
    assert.equal(f.instrument.read().voices[0].id,'after-tail');
  }
});
