import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSynthPsgRecordingPlayer} from './synth_psg_recording_player.js';
import {createSynthPsgVoice,normalizeSynthPsgSettings} from './synth_psg.js';
import {createSynthPsgEnvelope} from './synth_psg_envelope.js';
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js';
import factory from '../generated/segapsg_wasm.js';
import {createSegaPsgApi} from '../js/segapsg_api.js';

const settings=normalizeSynthPsgSettings({attenuation:2,envelope:{enabled:true,attackMs:5,decayMs:10,sustain:70,releaseMs:70}});
const recording=(commands,durationSeconds=.15,initial=settings)=>({format:'tetorica-sega-psg-recording-v1',version:1,
  durationSeconds,initialState:{settings:structuredClone(initial),pitchClock:7670454},commands});
const note=(time,channel=0)=>({type:'noteOn',time,channel,block:4,fnum:1083});
const off=(time,channel=0)=>({type:'noteOff',time,channel});
const wasmBinary=await readFile(new URL('../generated/segapsg_wasm.wasm',import.meta.url));
const RATE=48000;
async function host() {
  const chip=await SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:RATE,clock:SEGAPSG_CLOCK});
  let envelope=createSynthPsgEnvelope({sampleRate:RATE,setAttenuation:()=>{}}),resets=0;
  const ended=[];
  const player=createSynthPsgRecordingPlayer({sampleRate:RATE,onEnded:session=>ended.push(session),beginCycle:(initial,pitchClock)=>{
    resets++;chip.reset();
    const api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:byte=>chip.write(byte)});
    envelope=createSynthPsgEnvelope({sampleRate:RATE,setAttenuation:(channel,value)=>api.setAttenuation(channel,value)});
    api.envelopeNoteOn=(...args)=>envelope.noteOn(...args);api.envelopeNoteOff=ch=>envelope.noteOff(ch);
    api.stopEnvelopes=()=>envelope.stop();api.setEnvelopeAttenuation=value=>envelope.setAttenuation(value);api.allNotesOff();
    return createSynthPsgVoice({getPsg:()=>api,getPitchClock:()=>pitchClock,settings:initial});
  }});
  const render=(left,right)=>envelope.render(left,right,(l,r)=>{
    const pcm=chip.generateStereoView(l.length);l.set(pcm.left.subarray(0,l.length));r.set(pcm.right.subarray(0,r.length));
  });
  function generate(count,block=128) {
    const left=new Float32Array(count),right=new Float32Array(count);
    for(let i=0;i<count;i+=block)player.render(left.subarray(i,Math.min(count,i+block)),right.subarray(i,Math.min(count,i+block)),render);
    return {left,right};
  }
  return {chip,player,generate,ended,get resets(){return resets;},dispose(){player.stop();chip.dispose();}};
}
const rms=values=>Math.sqrt(values.reduce((sum,x)=>sum+x*x,0)/values.length);

test('sample-clock PSG event playback reproduces exact Tone/Noise PCM across render boundaries and preserves release',async()=>{
  const a=await host(),b=await host();
  try {
    const noise=normalizeSynthPsgSettings({source:'noise',attenuation:3,noiseType:'periodic',noiseRate:'tone3',envelope:{enabled:true,attackMs:0,decayMs:0,sustain:100,releaseMs:40}});
    const doc=recording([note(0),{time:.021,type:'setFrequency',channel:0,block:5,fnum:1083},off(.030),
      {time:.105,type:'setSettings',settings:noise},note(.105,3),off(.125,3)],.2);
    const original=structuredClone(doc);
    a.player.play(doc,{session:1});b.player.play(doc,{session:1});
    const actual=a.generate(12000,128),expected=b.generate(12000,71);
    assert.deepEqual(actual,expected);assert.deepEqual(doc,original,'recorded objects remain detached');
    assert(rms(actual.left.subarray(1000,1400))>.005);
    assert(rms(actual.left.subarray(1600,2000))>0,'the note release continues after Note Off');
    assert(rms(actual.left.subarray(5050,5900))>.001,'the later noise patch produces actual PCM');
    assert(actual.left.subarray(10090).every(x=>x===0));assert.deepEqual(a.ended,[1]);assert(!a.player.snapshot().playing);
  } finally {a.dispose();b.dispose();}
});

test('loop cycles reset phase and software envelope exactly; zero-duration streams remain bounded and stop never revives',async()=>{
  const h=await host();
  try {
    h.player.play(recording([note(0),off(.03)],.15),{session:2,loop:true});
    const cycle=h.player.snapshot().cycleFrames,pcm=h.generate(cycle*2).left;
    assert.deepEqual(pcm.subarray(0,cycle),pcm.subarray(cycle));assert.equal(h.resets,2);assert.deepEqual(h.ended,[]);
    h.player.stop(3);assert(h.generate(2000).left.every(x=>x===0));
    assert.equal(h.player.play(recording([note(0),off(.02)]),{session:2}),false,'a stale play cannot defeat a newer stop');
    h.player.play(recording([note(0)],0),{session:4,loop:true});h.generate(3000,127);assert(h.player.snapshot().cycle>1);
    h.player.stop(5);assert.equal(h.player.stop(4),false);assert(h.generate(1000).left.every(x=>x===0));
  } finally {h.dispose();}
});

test('Use current sound maps polyphonic Tone to one Noise voice without stale releases or patch writes',async()=>{
  const h=await host();
  try {
    const current=normalizeSynthPsgSettings({source:'noise',attenuation:3,noiseType:'white',noiseRate:'medium'});
    const doc=recording([note(0,0),note(.01,1),off(.02,0),{time:.025,type:'setSettings',settings:normalizeSynthPsgSettings({attenuation:15})},off(.04,1)],.07);
    h.player.play(doc,{session:1,ignorePatch:true,settings:current,pitchClock:7670454});
    const pcm=h.generate(5000).left;
    assert(rms(pcm.subarray(1300,1800))>.001,'an old Tone0 release and recorded mute cannot silence the mapped Tone1-owned Noise');
    assert(pcm.subarray(2100).every(x=>x===0));
    assert.equal(current.source,'noise');assert.equal(current.attenuation,3);
  } finally {h.dispose();}
});

test('invalid recording or playback options preserve the active timeline and private chip until explicitly cancelled',async()=>{
  const h=await host();
  try {
    const doc=recording([note(0),off(.1)],.2);h.player.play(doc,{session:1,loop:true});h.generate(700);
    const before=h.player.snapshot(),resets=h.resets;
    for(const bad of [{...doc,format:'megasynth-recording-v1'},{...doc,durationSeconds:-1},recording([{...note(0),fnum:0}]),recording([{time:0,type:'arbitrary'}])])assert.throws(()=>h.player.play(bad,{session:2}));
    assert.throws(()=>h.player.play(doc,{session:2,loop:'yes'}));assert.throws(()=>h.player.play(doc,{session:2,ignorePatch:true,settings:{source:'bad'},pitchClock:7670454}));
    assert.deepEqual(h.player.snapshot(),before);assert.equal(h.resets,resets);assert(rms(h.generate(1000).left)>.001);
  } finally {h.dispose();}
});
