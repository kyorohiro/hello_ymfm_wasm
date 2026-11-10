import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js';
import factory from '../generated/segapsg_wasm.js';
import {createSegaPsgApi} from '../js/segapsg_api.js';
import {SYNTH_PSG_ENVELOPE_DEFAULTS,normalizeSynthPsgEnvelope,createSynthPsgEnvelope} from './synth_psg_envelope.js';

const envelope=overrides=>({...SYNTH_PSG_ENVELOPE_DEFAULTS,enabled:true,...overrides});
const render=(engine,count,block=count)=>{
  const left=new Float32Array(count),right=new Float32Array(count);
  for(let start=0;start<count;start+=block)engine.render(left.subarray(start,Math.min(count,start+block)),right.subarray(start,Math.min(count,start+block)),(l,r)=>{l.fill(0);r.fill(0);});
};
function fixture(rate=1000) {
  const writes=[],engine=createSynthPsgEnvelope({sampleRate:rate,setAttenuation:(channel,value)=>writes.push({frame:engine.snapshot().frame,channel,value})});
  return {engine,writes};
}

test('software envelope settings default Off, detach values and strictly reject unsupported controls',()=>{
  assert(Object.isFrozen(SYNTH_PSG_ENVELOPE_DEFAULTS));assert.equal(SYNTH_PSG_ENVELOPE_DEFAULTS.enabled,false);
  const value=normalizeSynthPsgEnvelope();assert.deepEqual(value,SYNTH_PSG_ENVELOPE_DEFAULTS);value.enabled=true;assert.equal(SYNTH_PSG_ENVELOPE_DEFAULTS.enabled,false);
  for(const bad of [null,[],1,{extra:1},{enabled:1},{attackMs:-1},{decayMs:5001},{releaseMs:NaN},{sustain:101},{sustain:'70'},{attackMs:1.5}])assert.throws(()=>normalizeSynthPsgEnvelope(bad));
  assert.deepEqual(normalizeSynthPsgEnvelope({attackMs:0,decayMs:5000,sustain:0,releaseMs:0}),{...SYNTH_PSG_ENVELOPE_DEFAULTS,attackMs:0,decayMs:5000,sustain:0,releaseMs:0});
});

test('ADSR runs on rendered samples and quantizes linear levels to actual hardware attenuation',()=>{
  const {engine,writes}=fixture();engine.noteOn(0,envelope({attackMs:20,decayMs:20,sustain:25,releaseMs:20}),0);
  assert.deepEqual(writes,[{frame:0,channel:0,value:15}]);
  render(engine,10);assert.equal(engine.snapshot().voices[0].level,.5);assert.equal(writes.at(-1).value,3);
  render(engine,11);assert.equal(writes.at(-1).value,0);assert.equal(engine.snapshot().voices[0].level,.9625);
  render(engine,19);assert.equal(engine.snapshot().voices[0].level,.25);
  render(engine,1);assert.equal(writes.at(-1).value,6,'25% amplitude quantizes to -12 dB');
  const count=writes.length;render(engine,99);assert.equal(writes.length,count,'held sustain has no repeated register traffic');
  assert.equal(engine.noteOff(0),true);assert.equal(engine.noteOff(0),false,'repeated Note Off does not restart release');
  render(engine,10);assert.equal(engine.snapshot().voices[0].level,.125);assert.equal(writes.at(-1).value,9);
  render(engine,11);assert.equal(engine.snapshot().voices.length,0);assert.equal(writes.at(-1).value,15);
  assert.equal(engine.noteOff(0),false);
});

test('release begins at the current attack/decay level, zero times work and channels retain independent snapshots',()=>{
  const {engine,writes}=fixture();const settings=envelope({attackMs:100,decayMs:0,sustain:100,releaseMs:40});
  engine.noteOn(0,settings,1);settings.attackMs=0;
  render(engine,20);assert.equal(engine.snapshot().voices[0].level,.2);
  engine.noteOff(0);render(engine,20);assert.equal(engine.snapshot().voices[0].level,.1);
  engine.noteOn(1,envelope({attackMs:0,decayMs:0,sustain:100,releaseMs:0}),2);
  assert.equal(writes.at(-1).value,2);assert.equal(engine.snapshot().voices.find(voice=>voice.channel===0).released,true);
  assert.equal(engine.snapshot().voices.find(voice=>voice.channel===1).level,1);
  engine.noteOff(1);assert.equal(writes.at(-1).value,15);assert(!engine.snapshot().voices.some(voice=>voice.channel===1));
  render(engine,21);assert.equal(engine.snapshot().voices.length,0);
  engine.noteOn(2,envelope({attackMs:0,decayMs:0,sustain:0,releaseMs:0}),0);assert.equal(writes.at(-1).value,15);
  engine.noteOff(2);assert.equal(engine.snapshot().voices.length,0);
});

test('base attenuation edits include release tails; retrigger replaces one envelope and stop cancels every future write',()=>{
  const {engine,writes}=fixture();const value=envelope({attackMs:0,decayMs:0,sustain:100,releaseMs:100});
  engine.noteOn(0,value,0);engine.noteOn(3,value,1);engine.noteOff(0);render(engine,50);
  engine.setAttenuation(4);assert.equal(writes.at(-1).channel,3);assert.equal(writes.at(-1).value,4);
  assert.equal(engine.snapshot().voices.find(voice=>voice.channel===0).attenuation,7);
  engine.noteOn(0,envelope({attackMs:50,decayMs:0,sustain:100}),4);assert.equal(writes.at(-1).value,15);
  assert.equal(engine.snapshot().voices.find(voice=>voice.channel===0).released,false);
  assert.equal(engine.snapshot().voices.find(voice=>voice.channel===3).level,1);
  engine.stop();assert.equal(engine.snapshot().voices.length,0);const count=writes.length;render(engine,1000);assert.equal(writes.length,count);
  for(const bad of [-1,4,.5])assert.throws(()=>engine.noteOn(bad,value,0));
  assert.throws(()=>engine.noteOn(0,value,16));assert.throws(()=>engine.setAttenuation(-1));
  assert.equal(engine.snapshot().voices.length,0,'invalid commands cannot allocate voices');
});

const wasmBinary=await readFile(new URL('../generated/segapsg_wasm.wasm',import.meta.url));
async function real(rate=48000) {
  const chip=await SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:rate,clock:SEGAPSG_CLOCK});
  const api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>chip.write(value)});api.allNotesOff();
  const engine=createSynthPsgEnvelope({sampleRate:rate,setAttenuation:(ch,value)=>api.setAttenuation(ch,value)});
  const generate=(count,blocks=128)=>{
    const left=new Float32Array(count),right=new Float32Array(count);
    for(let start=0;start<count;start+=blocks)engine.render(left.subarray(start,Math.min(count,start+blocks)),right.subarray(start,Math.min(count,start+blocks)),(l,r)=>{
      const pcm=chip.generateStereoView(l.length);l.set(pcm.left.subarray(0,l.length));r.set(pcm.right.subarray(0,r.length));
    });return {left,right};
  };
  return {chip,api,engine,generate};
}
const rms=values=>{const mean=values.reduce((sum,value)=>sum+value,0)/values.length;return Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length);};

test('real WASM Envelope Off stays byte-identical and adds no segmentation or attenuation writes',async()=>{
  const a=await real(),b=await real();
  try {
    for(const host of [a,b]){host.api.tone(0,{frequency:440,attenuation:6});host.api.noise({type:'white',rate:'medium',attenuation:9});}
    const actual=a.generate(12000,128),expected=b.chip.generateStereo(12000);
    assert.deepEqual(actual,expected);
    assert.equal(a.engine.snapshot().voices.length,0);
  } finally {a.chip.dispose();b.chip.dispose();}
});

test('real WASM Tone/Noise ADSR changes PCM over time, ends silent and is independent of render block boundaries',async()=>{
  for(const noise of [false,true]) {
    const a=await real(),b=await real();
    try {
      for(const host of [a,b]) {
        if(noise)host.api.setNoise({type:'white',rate:'medium'});else host.api.setFrequency(0,440);
        host.engine.noteOn(noise?3:0,envelope({attackMs:40,decayMs:40,sustain:25,releaseMs:40}),0);
      }
      const actual=a.generate(12000,128),expected=b.generate(12000,127);
      assert.deepEqual(actual,expected,'changing the render split cannot change a single PCM frame');
      assert(rms(actual.left.subarray(600,1000))<rms(actual.left.subarray(1800,2200))*.7,'attack grows');
      assert(rms(actual.left.subarray(5000,7000))<rms(actual.left.subarray(1800,2200))*.4,'decay settles at quieter sustain');
      for(const host of [a,b])host.engine.noteOff(noise?3:0);
      const tail=a.generate(4000),tail2=b.generate(4000,71);assert.deepEqual(tail,tail2);
      assert(rms(tail.left.subarray(0,500))>rms(tail.left.subarray(1100,1600))*1.5);
      assert(tail.left.subarray(2500).every(value=>value===0));assert(tail.right.subarray(2500).every(value=>value===0));
      assert.equal(a.engine.snapshot().voices.length,0);
      a.engine.noteOn(noise?3:0,envelope({attackMs:0,decayMs:0,sustain:100,releaseMs:1000}),0);assert(rms(a.generate(1000).left)>.001);
      a.engine.noteOff(noise?3:0);a.engine.stop();assert(a.generate(2000).left.every(value=>value===0),'stop cancels long release tails immediately');
    } finally {a.chip.dispose();b.chip.dispose();}
  }
});
