import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/segapsg_wasm.js';
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js';
import {createSegaPsgApi,psgPeriodFromFrequency} from '../js/segapsg_api.js';
import {createPsgPreset} from './synth_psg_preset.js';
import {describeSynthPsgSongVoice,createSynthPsgSongVoice,createSynthPsgSongCopyPreset} from './synth_song_psg_voice.js';

function snapshot() {
  return {kind:'segapsg',clockHz:SEGAPSG_CLOCK,revision:7,frame:100,channels:Array.from({length:4},(_,channel)=>({
    channel,source:channel===3?'noise':'tone',period:channel===3?32:254,attenuation:channel===1?15:7,lastAttenuation:5,
    constantOutput:false,preset:createPsgPreset({source:channel===3?'noise':'tone',attenuation:7,noiseType:'white',noiseRate:'medium',
      envelope:{enabled:true,attackMs:999}}).settings,
  }))};
}
function endpoint() {
  const writes=[],api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>writes.push(value)});
  return {writes,api};
}
const pitchHz=(block,fnum)=>fnum*7670454*2**(block-1)/(144*2**20);

test('PSG Copy detaches hardware settings, uses last audible attenuation and explicitly disables software ADSR',()=>{
  const source=snapshot(),before=structuredClone(source);
  const description=describeSynthPsgSongVoice(source,1);
  assert.deepEqual(description,{playable:true,reason:'',channel:1,source:'tone',attenuation:5});
  const copy=createSynthPsgSongCopyPreset(source,1);
  assert.equal(copy.version,2);assert.equal(copy.kind,'tetorica-sega-psg');assert.equal(copy.settings.attenuation,5);
  assert.deepEqual(copy.settings.envelope,{enabled:false,attackMs:10,decayMs:180,sustain:70,releaseMs:180});
  copy.settings.noiseRate='low';copy.settings.envelope.attackMs=0;
  assert.deepEqual(source,before);
  assert.equal(createSynthPsgSongCopyPreset(source,0).settings.attenuation,7);
});

test('missing, silent, DC and unsupported clock snapshots reject before any keyboard register writes',()=>{
  const a=endpoint(),cases=[null,{},snapshot(),snapshot(),snapshot(),snapshot(),snapshot(),snapshot()];
  cases[2].channels[0].lastAttenuation=15;cases[2].channels[0].attenuation=15;
  cases[3].channels[0].period=0;cases[4].channels[0].period=1;
  cases[5].channels[0].preset.noiseRate='unknown';cases[6].clockHz=0;cases[7].channels[0].source='noise';
  for(const source of cases) {
    assert.equal(describeSynthPsgSongVoice(source,0).playable,false);
    assert.throws(()=>createSynthPsgSongCopyPreset(source,0));
    assert.throws(()=>createSynthPsgSongVoice(a.api,source,0));
  }
  for(const channel of [-1,4,.5])assert.equal(describeSynthPsgSongVoice(snapshot(),channel).playable,false);
  const fixed=snapshot();fixed.clockHz=4000000;
  assert.match(describeSynthPsgSongVoice(fixed,3).reason,/clock differs/);
  assert.throws(()=>createSynthPsgSongVoice(a.api,fixed,3));
  assert.deepEqual(a.writes,[]);
});

test('selected tone stays monophonic on its physical channel and does not mutate the snapshot or an edited preset',()=>{
  const source=snapshot(),before=structuredClone(source),editor=createPsgPreset({source:'noise',attenuation:3}),editorBefore=structuredClone(editor);
  const a=endpoint(),voice=createSynthPsgSongVoice(a.api,source,1);
  assert.equal(voice.channel,1);assert.deepEqual(voice.getChannels(),[1]);
  assert.deepEqual(a.writes,[0x9f,0xbf,0xdf,0xff]);a.writes.length=0;
  const first=voice.noteOn(0,4,1083),period=psgPeriodFromFrequency(pitchHz(4,1083),SEGAPSG_CLOCK);
  assert.equal(first.period,period);
  assert.deepEqual(a.writes,[0xbf,0xa0|(period&15),period>>4,0xb5]);
  const second=voice.noteOn(2,5,1083);assert(second.period<first.period);
  assert.equal(a.writes.at(-1),0xb5);assert(voice.noteOff(0));assert.equal(a.writes.at(-1),0xbf);
  assert.equal(voice.noteOff(0),false);
  const count=a.writes.length;assert.throws(()=>voice.noteOn(0,4,0));assert.throws(()=>voice.setFrequency(0,8,1000));
  assert.equal(a.writes.length,count);assert.deepEqual(source,before);assert.deepEqual(editor,editorBefore);
});

const wasmBinary=await readFile(new URL('../generated/segapsg_wasm.wasm',import.meta.url));
async function real(source=snapshot(),channel=0) {
  const chip=await SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000,clock:SEGAPSG_CLOCK});
  const writes=[],api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>{writes.push(value);chip.write(value);}});
  return {chip,writes,voice:createSynthPsgSongVoice(api,source,channel)};
}
const rms=values=>Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
function frequency(values) {
  const edges=[];for(let i=1;i<values.length;i++)if(values[i-1]<=0&&values[i]>0)edges.push(i);
  return 48000*(edges.length-1)/(edges.at(-1)-edges[0]);
}

test('real WASM paused tone auditions the selected physical PSG channel at keyboard pitch and keys off to silence',async()=>{
  const a=await real(snapshot(),2);
  try {
    assert(a.chip.generateStereo(512).left.every(value=>value===0));
    const note=a.voice.noteOn(0,4,1083),pcm=a.chip.generateStereo(48000);
    assert(rms(pcm.left)>.001);assert(Math.abs(frequency(pcm.left)-SEGAPSG_CLOCK/(32*note.period))<1);
    const high=a.voice.noteOn(0,5,1083),higher=a.chip.generateStereo(48000);
    assert(Math.abs(frequency(higher.left)-SEGAPSG_CLOCK/(32*high.period))<1);
    a.voice.noteOff(0);assert(a.chip.generateStereo(512).left.every(value=>value===0));
  } finally {a.chip.dispose();}
});

test('real WASM fixed Noise keeps its recorded clock across keyboard pitches and never starts other tone voices',async()=>{
  const first=await real(snapshot(),3),second=await real(snapshot(),3);
  try {
    first.voice.noteOn(0,4,1083);second.voice.noteOn(0,5,1364);
    assert.deepEqual(first.chip.generateStereo(4096),second.chip.generateStereo(4096));
    first.voice.setFrequency(0,6,1083);assert.deepEqual(first.chip.generateStereo(4096),second.chip.generateStereo(4096));
    assert(rms(first.chip.generateStereo(4096).left)>.001);
    first.voice.noteOff();assert(first.chip.generateStereo(512).left.every(value=>value===0));
    assert(first.writes.filter(value=>(value&0x90)===0x90&&(value>>5&3)<3).every(value=>(value&15)===15));
  } finally {first.chip.dispose();second.chip.dispose();}
});

test('real WASM Tone 3 periodic Noise follows keys while its square-wave clock channel remains muted',async()=>{
  const source=snapshot();source.channels[3].preset.noiseType='periodic';source.channels[3].preset.noiseRate='tone3';source.channels[3].period=254;
  const a=await real(source,3);
  try {
    a.voice.noteOn(0,4,1083);const low=a.chip.generateStereo(48000),lowHz=frequency(low.left);
    a.voice.noteOn(0,5,1083);const high=a.chip.generateStereo(48000),highHz=frequency(high.left);
    assert(rms(low.left)>.001);assert(highHz>lowHz*1.8&&highHz<lowHz*2.2);
    assert(lowHz<100&&highHz<150,'the audible output is the noise rotation rather than Tone 3 square wave');
    assert(a.writes.filter(value=>(value&0xf0)===0xd0).every(value=>(value&15)===15));
    a.voice.noteOff();assert(a.chip.generateStereo(512).left.every(value=>value===0));
  } finally {a.chip.dispose();}
});
