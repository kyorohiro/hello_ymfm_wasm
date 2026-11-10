import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSoundChip} from '../../tetorica_src/runtime/soundchip.js';
import {SidCore, SID_PAL_CLOCK, SID_NTSC_CLOCK} from '../../tetorica_src/runtime/sid.js';
import {Sid8580Core} from '../../tetorica_src/runtime/sid8580.js';
import {SidSynth} from '../../tetorica_src/runtime/sidsynth.js';

const assets = new URL('../../docs/generated/', import.meta.url);
const binary = async model => readFile(new URL(model === '8580' ? 'sid8580-machine/sid8580-endpoint.wasm' : 'sid/sid.wasm', assets));
const writes = [[0,0x58],[1,0x1d],[5,0x01],[6,0xf0],[4,0x21],[24,15]];
const write = core => {for(const [register,value] of writes) core.writeRegister(register,value);};

for (const model of ['6581','8580']) {
  test(`SID ${model}: factory returns the unchanged low-level core, independent IDs and identical PCM`, async () => {
    const wasmBinary = await binary(model), Type = model === '8580' ? Sid8580Core : SidCore;
    const core = await createSoundChip('sid', {model, sampleRate:44100, moduleOptions:{wasmBinary}});
    const reference = await Type.create({sampleRate:44100, wasmBinary});
    const other = await createSoundChip('sid', {model, assetBaseUrl:assets});
    try {
      assert(core instanceof Type);
      assert.match(core.id,/^sid:\d+$/); assert.notEqual(core.id,other.id);
      assert.throws(() => {core.id='other';},TypeError);
      assert.equal(core.model,model); assert.equal(core.sampleRate,44100);
      assert(core.registers.every(value=>value===0),'factory does not initialize or play a patch');
      write(core); write(reference);
      let audible = false;
      for (const frames of [0,1,127,128,257,1024]) {
        const actual = core.render(frames);
        assert.deepEqual(actual,reference.render(frames));
        assert(actual.every(Number.isFinite)); audible ||= actual.some(value=>Math.abs(value)>.001);
      }
      assert(audible,'real raw SID PCM was generated without an audio device');
      assert(other.registers.every(value=>value===0),'another factory call has independent registers');
      const synth = new SidSynth({core}); synth.initialize(); synth.setVoice(0,{waveform:'triangle'}); synth.noteOn(0,'C4');
      assert.equal(synth._getState().channels[0].gate,true,'existing high-level SidSynth can borrow the returned core');
      synth.dispose();
    } finally {core.dispose(); reference.dispose(); other.dispose();}
    assert.throws(()=>core.render(1),/disposed/);
  });
}

test('SID factory maps clock and explicit URL/bytes, retaining raw numeric sampleRate and manual ID', async () => {
  const core = await createSoundChip('sid', {clock:SID_NTSC_CLOCK,sampleRate:32000,id:'sid-lead',wasmUrl:new URL('sid/sid.wasm',assets)});
  try {assert.equal(core.clockHz,SID_NTSC_CLOCK); assert.equal(core.sampleRate,32000); assert.equal(core.id,'sid-lead');}
  finally {core.dispose();}
  const bytes = await binary('8580');
  const preview = await createSoundChip('sid', {model:'8580',wasmBinary:bytes,wasmUrl:'https://unused.invalid/no-fetch.wasm'});
  try {assert.equal(preview.clockHz,SID_PAL_CLOCK); assert.equal(preview.model,'8580');}
  finally {preview.dispose();}
});

test('invalid SID settings and aborted requests allocate no browser context', async () => {
  const original = globalThis.AudioContext; let allocated = 0;
  globalThis.AudioContext = class {constructor(){allocated++; throw Error('must not allocate');}};
  try {
    for (const execution of ['direct','worklet']) {
      for (const options of [{model:'8581'},{model:'8580',clock:SID_NTSC_CLOCK},{clock:0},{sampleRate:7999},{sampleRate:96001},{wasmBinary:'bad'},{moduleFactory:()=>{}}]) {
        await assert.rejects(createSoundChip('sid',{execution,...options}),/SID/);
      }
      const controller = new AbortController(); controller.abort();
      await assert.rejects(createSoundChip('sid',{execution,signal:controller.signal}),/abort/i);
    }
    await assert.rejects(createSoundChip('sid',{execution:'worklet',audioContext:{sampleRate:192000}}),/sampleRate/);
    assert.equal(allocated,0);
  } finally {if(original===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=original;}
});

test('SID cancellation during loading or after core creation cannot return a live late core', async () => {
  const bytes = await binary('6581'), originalFetch=globalThis.fetch, originalCreate=SidCore.create;
  let created=0, late;
  SidCore.create=async function(...args){created++; return originalCreate.apply(this,args);};
  try {
    const loading = new AbortController();
    globalThis.fetch=async(_url,options)=>{assert.equal(options.signal,loading.signal);loading.abort();return new Response(bytes);};
    await assert.rejects(createSoundChip('sid',{wasmUrl:'https://sid.invalid/core.wasm',signal:loading.signal}),/abort/i);
    assert.equal(created,0,'a cancelled fetch never instantiates WASM');
    const allocating = new AbortController();
    SidCore.create=async function(...args){late=await originalCreate.apply(this,args);allocating.abort();return late;};
    await assert.rejects(createSoundChip('sid',{wasmBinary:bytes,signal:allocating.signal}),/abort/i);
    assert.equal(late.handle,0,'factory disposes a core created after cancellation');
  } finally {globalThis.fetch=originalFetch;SidCore.create=originalCreate;late?.dispose();}
});

test('generic SID processor matches direct core PCM, readback and scheduled writes for both models', async () => {
  const previous = Object.fromEntries(['sampleRate','currentFrame','AudioWorkletProcessor','registerProcessor'].map(key=>[key,globalThis[key]]));
  let Processor, receive;
  globalThis.sampleRate=44100; globalThis.currentFrame=0;
  globalThis.AudioWorkletProcessor=class {constructor(){this.port={postMessage:message=>receive(message)};}};
  globalThis.registerProcessor=(name,Type)=>{assert.equal(name,'tetorica-soundchip');Processor=Type;};
  try {
    await import('../../tetorica_src/runtime/soundchip-output-worklet.js');
    for (const model of ['6581','8580']) {
      const wasmBinary=await binary(model), messages=[];
      let readyResolve,readyReject;
      const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
      receive=message=>{messages.push(message);if(message.type==='ready')readyResolve(message);else if(message.error)readyReject(Error(message.error));};
      const processor=new Processor({processorOptions:{name:'sid',chipOptions:{model,sampleRate:48000},wasmBinary}});
      const metadata=await ready, reference=await createSoundChip('sid',{model,sampleRate:44100,wasmBinary});
      try {
        assert.equal(metadata.sampleRate,44100,'processor uses AudioContext rate');
        assert.equal(processor.chip.model,model); assert.equal(processor.chip.sampleRate,44100);
        for (const [register,value] of writes) processor.receive({method:'writeRegister',args:[register,value]});
        write(reference); processor.receive({method:'start'});
        const render=frames=>{const left=new Float32Array(frames),right=new Float32Array(frames);processor.process([],[[left,right]]);return {left,right};};
        for (const frames of [1,127,128,257]) {
          const actual=render(frames),expected=reference.render(frames);
          assert.deepEqual(actual.left,expected); assert.deepEqual(actual.right,expected,'mono is copied unchanged to stereo');
        }
        processor.receive({method:'getState',id:'state'});
        assert.deepEqual(messages.find(message=>message.id==='state').value,reference.getState());
        processor.receive({method:'readRegister',args:[27],id:'read'});
        assert.equal(messages.find(message=>message.id==='read').value,reference.readRegister(27));
        processor.receive({method:'schedule-writes',args:[[{time:16/44100,register:4,value:0x20}]]});
        const actual=render(32),expected=new Float32Array(32);
        expected.set(reference.render(16));reference.writeRegister(4,0x20);expected.set(reference.render(16),16);
        assert.deepEqual(actual.left,expected,'raw register writes remain scheduled at the exact output frame');
        processor.receive({method:'stop'});assert(render(128).left.every(value=>value===0));
      } finally {processor.receive({method:'dispose'});reference.dispose();}
      assert.equal(processor.dead,true); assert.equal(processor.chip,null);
    }
  } finally {
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  }
});
