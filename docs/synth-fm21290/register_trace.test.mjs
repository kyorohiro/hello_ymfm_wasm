// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrace,validateTrace,TracePlayer} from './register_trace.js';
import {createInstrument} from './instrument.js';
import {voiceToPreset,presetToVoice} from '../js/msfa_dx7/src/preset.js';

test('reject invalid register events, incompatible clocks and out-of-order timestamps',()=>{
  const trace=createTrace(48000);
  trace.frames=12;
  for(const events of [[[13]],[[4],[1]],[[0,0x302f,0]],[[0,0x2805,256]],[[1,2]]])
    assert.throws(()=>validateTrace({...trace,events}));
  assert.throws(()=>new TracePlayer(trace,44100));
});

test('worklet capture and JSON replay reproduce PCM across CPU ticks and resets',async()=>{
  let Processor;
  globalThis.sampleRate=48000;
  globalThis.AudioWorkletProcessor=class{port={messages:[],postMessage(v){this.messages.push(v);}};};
  globalThis.registerProcessor=(_,type)=>{Processor=type;};
  await import('./worklet.js');
  const processor=new Processor(), send=data=>processor.port.onmessage({data});
  const patch=voiceToPreset(presetToVoice({pitchEnvelope:{rates:[99,99,99,99],levels:[82,82,82,50]},
    lfo:{pitchModDepth:60,pitchModSensitivity:6,speed:85}}));
  const keys=createInstrument((a,v)=>send({writes:[[a,v]]}),
    (keyOn,basePitch)=>send({writes:[{keyOn,basePitch}]}),keyOff=>send({writes:[{keyOff}]}));
  function startNote(){
    send({lfo:patch.lfo,pitchEnvelope:patch.pitchEnvelope});
    keys.setPatch(patch);keys.keyOn(15,69);
  }
  function render(n){
    const pcm=new Float32Array(n);
    processor.process([],[[pcm]]);
    return pcm;
  }
  send({record:true});startNote();
  const first=render(2048);
  send({reset:true});const silence=render(129);startNote();
  const second=render(3200);keys.keyOff(15);const tail=render(427);
  send({endRecord:true});
  const {recorded}=processor.port.messages.at(-1);
  assert.deepEqual(recorded.events.filter(e=>e.length===1),[[2048]]);
  assert.ok(recorded.events.some(([t,a])=>t>0 && t<2048 && a===0x30f2));
  assert.ok(recorded.events.some(([t,a])=>t>0 && t<2048 && a===0x301e));
  assert.ok(first.some(v=>Math.abs(v)>0.001));
  const expected=Float32Array.from([...first,...silence,...second,...tail]);
  assert.equal(recorded.frames,expected.length);
  send({replay:JSON.parse(JSON.stringify(recorded))});
  const replay=[];
  while(replay.length<expected.length)replay.push(...render(97));
  assert.deepEqual(Float32Array.from(replay.slice(0,expected.length)),expected);
  assert.ok(replay.slice(expected.length).every(v=>v===0));
  assert.ok(processor.port.messages.some(m=>m.replayDone));
});
