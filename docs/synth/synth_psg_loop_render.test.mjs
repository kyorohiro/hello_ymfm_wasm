import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderSynthPsgLoop,SYNTH_PSG_LOOP_MAX_PCM_BYTES} from './synth_psg_loop_render.js';
import {normalizeSynthPsgSettings,createSynthPsgVoice} from './synth_psg.js?v=psg-event-rec-1';
import {createSynthPsgEnvelope} from './synth_psg_envelope.js?v=psg-envelope-1';
import {createSynthPsgRecordingPlayer} from './synth_psg_recording_player.js?v=psg-event-rec-1';
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js?v=audio-numeric-bindings-1';
import {createSegaPsgApi} from '../js/segapsg_api.js?v=audio-numeric-bindings-1';
import factory from '../generated/segapsg_wasm.js?v=audio-numeric-bindings-1';

const RATE=48000;
const wasmBinary=await readFile(new URL('../generated/segapsg_wasm.wasm',import.meta.url));
const tone=normalizeSynthPsgSettings({attenuation:3,envelope:{enabled:true,attackMs:20,decayMs:40,sustain:50,releaseMs:200}});
const doc=(commands,durationSeconds=.3,settings=tone)=>({format:'tetorica-sega-psg-recording-v1',version:1,
  initialState:{settings:structuredClone(settings),pitchClock:7670454},durationSeconds,commands});
const on=(time,channel=0)=>({type:'noteOn',time,channel,block:4,fnum:1083});
const off=(time,channel=0)=>({type:'noteOff',time,channel});
const options={sampleRate:RATE,moduleOptions:{wasmBinary},yieldControl:async()=>{}};
const rms=values=>Math.sqrt(values.reduce((sum,x)=>sum+x*x,0)/values.length);

async function reference(recording,block=71) {
  const chip=await SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:RATE,clock:SEGAPSG_CLOCK});
  let envelope;
  const player=createSynthPsgRecordingPlayer({sampleRate:RATE,beginCycle:(settings,pitchClock)=>{
    chip.reset();const api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>chip.write(value)});
    envelope=createSynthPsgEnvelope({sampleRate:RATE,setAttenuation:(channel,value)=>api.setAttenuation(channel,value)});
    api.envelopeNoteOn=(...args)=>envelope.noteOn(...args);api.envelopeNoteOff=channel=>envelope.noteOff(channel);
    api.stopEnvelopes=()=>envelope.stop();api.setEnvelopeAttenuation=value=>envelope.setAttenuation(value);api.allNotesOff();
    return createSynthPsgVoice({getPsg:()=>api,getPitchClock:()=>pitchClock,settings});
  }});
  const body=Math.max(1,Math.ceil(recording.durationSeconds*RATE)),tail=Math.ceil(RATE/1000);
  const left=new Float32Array(body+tail),right=new Float32Array(body+tail);
  const native=(l,r)=>{const pcm=chip.generateStereoView(l.length);l.set(pcm.left.subarray(0,l.length));r.set(pcm.right.subarray(0,r.length));};
  const render=(l,r)=>envelope.render(l,r,native);
  try {
    player.play(recording,{session:1,loop:false});
    for(let i=0;i<body;i+=block)player.render(left.subarray(i,Math.min(body,i+block)),right.subarray(i,Math.min(body,i+block)),render);
    player.stop();render(left.subarray(body),right.subarray(body));return{left,right};
  } finally {player.stop();chip.dispose();}
}

test('silent offline Tone rendering retains the complete release beyond the loop base and keeps raw gain',async()=>{
  const recording=doc([on(0),off(.1)]),before=structuredClone(recording);
  const result=await renderSynthPsgLoop(recording,options);
  assert.equal(result.sampleRate,RATE);assert.equal(result.left.length,14448);
  assert.equal(result.durationSeconds,.301);assert.equal(result.byteLength,result.left.byteLength+result.right.byteLength);
  assert(rms(result.left.subarray(1700,2300))>.005);
  assert(rms(result.left.subarray(6000,7500))>.001,'the release is audible in samples beyond the .1s base period');
  assert(result.left.subarray(14400).every(x=>x===0),'only a silent safety quantum follows the recorded duration');
  assert.deepEqual(recording,before,'rendering does not change the recorded commands or nested settings');
  const expected=await reference(recording,127);assert.deepEqual(result.left,expected.left);assert.deepEqual(result.right,expected.right);
  const chip=await SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:RATE,clock:SEGAPSG_CLOCK});
  try {
    const raw=normalizeSynthPsgSettings({attenuation:6});
    const unshaped=await renderSynthPsgLoop(doc([on(0),off(.1)],.1,raw),options);
    const api=createSegaPsgApi({clock:SEGAPSG_CLOCK,write:value=>chip.write(value)});api.allNotesOff();
    createSynthPsgVoice({getPsg:()=>api,settings:raw}).noteOn(0,4,1083);
    assert.deepEqual(unshaped.left.subarray(0,4800),chip.generateStereo(4800).left,'no Master or System PSG correction is baked into PCM');
  } finally {chip.dispose();}
});

test('Tone, pitch, Noise and software-envelope settings render byte-identically across arbitrary source chunk boundaries',async()=>{
  const noise=normalizeSynthPsgSettings({source:'noise',attenuation:4,noiseType:'periodic',noiseRate:'tone3',envelope:{enabled:true,attackMs:0,decayMs:0,sustain:100,releaseMs:70}});
  const recording=doc([on(0),{time:.033,type:'setFrequency',channel:0,block:5,fnum:1083},off(.060),
    {time:.29,type:'setSettings',settings:noise},on(.3,3),{time:.321,type:'setFrequency',channel:3,block:5,fnum:1083},off(.36,3)],.44);
  const result=await renderSynthPsgLoop(recording,options),expected=await reference(recording,71);
  assert.deepEqual(result.left,expected.left);assert.deepEqual(result.right,expected.right);
  assert(rms(result.left.subarray(14500,17000))>.001,'recorded Tone 3 noise produces PCM');
  assert(result.left.subarray(21120).every(x=>x===0));
});

test('rendering yields cooperatively and aborts with independent native-chip cleanup, without creating audio devices',async()=>{
  const controller=new AbortController(),oldDispose=SegaPSG.prototype.dispose;
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
  let disposed=0,devices=0,yields=0;
  SegaPSG.prototype.dispose=function(){disposed++;return oldDispose.call(this);};
  globalThis.AudioContext=function(){devices++;throw Error('No playback device is allowed');};
  try {
    await assert.rejects(renderSynthPsgLoop(doc([on(0),off(.9)],1.2),{...options,signal:controller.signal,
      yieldControl:async()=>{yields++;controller.abort();}}),{name:'AbortError'});
    assert.equal(yields,1);assert.equal(disposed,1);assert.equal(devices,0);
    const pre=new AbortController();pre.abort();
    await assert.rejects(renderSynthPsgLoop(doc([on(0),off(.1)]),{...options,signal:pre.signal}),{name:'AbortError'});
    assert.equal(disposed,1,'an already-aborted render never creates a native chip');
    const failed=Error('Host stopped rendering');
    await assert.rejects(renderSynthPsgLoop(doc([on(0),off(.9)],1.2),{...options,yieldControl:async()=>{throw failed;}}),error=>error===failed);
    assert.equal(disposed,2,'host scheduling failures also dispose the chip');
  } finally {
    SegaPSG.prototype.dispose=oldDispose;
    descriptor?Object.defineProperty(globalThis,'AudioContext',descriptor):delete globalThis.AudioContext;
  }
});

test('invalid or oversized loop data reject before allocating a chip, and supplied module options stay unchanged',async()=>{
  const originalCreate=SegaPSG.create;let creates=0;
  SegaPSG.create=async(...args)=>{creates++;return originalCreate.apply(SegaPSG,args);};
  const valid=doc([on(0),off(.1)]);
  try {
    for(const invalid of [{...valid,format:'megasynth-recording-v1'},{...valid,durationSeconds:126},doc([]),doc([{...on(0),fnum:0}])]) {
      await assert.rejects(renderSynthPsgLoop(invalid,options));assert.equal(creates,0);
    }
    for(const extra of [{sampleRate:7999},{sampleRate:192001},{sampleRate:44100.5},{signal:{}},{yieldControl:null},{moduleOptions:null}]) {
      await assert.rejects(renderSynthPsgLoop(valid,{...options,...extra}));assert.equal(creates,0);
    }
    assert(125*192000*8>SYNTH_PSG_LOOP_MAX_PCM_BYTES);
    await assert.rejects(renderSynthPsgLoop(doc([on(0),off(120)],125),{...options,sampleRate:192000}),/128 MiB/);assert.equal(creates,0);
    const moduleOptions={wasmBinary};const keys=Reflect.ownKeys(moduleOptions);
    await renderSynthPsgLoop(valid,{...options,moduleOptions});assert.equal(creates,1);assert.deepEqual(Reflect.ownKeys(moduleOptions),keys);
    assert.equal(moduleOptions.wasmBinary,wasmBinary);
  } finally {SegaPSG.create=originalCreate;}
});
