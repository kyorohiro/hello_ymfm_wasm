// Shared-APU Code tests render only to arrays; no sound device is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';
import {NesInstrument} from './instrument.js';
import {createDemoDpcm} from './preset.js';
import {createNesCodeClient,validateNesCodeCall} from './code_endpoint.js';
import {resolveNesCodeNoteTarget} from './code_audio.js';

const wasmBinary=await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
async function fixture(t){
  const core=await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate:48000,fds:true});
  const instrument=new NesInstrument(core);t.after(()=>instrument.dispose());return instrument;
}
const audible=pcm=>{assert(pcm.left.every(Number.isFinite));assert(pcm.left.some(value=>Math.abs(value)>.0001));};

test('Code and keyboard share physical channels; stale releases and session cleanup preserve the latest owner',async t=>{
  const i=await fixture(t),session=i.beginCode().session;
  i.code(session,'noteOn',[0,'C4']);i.noteOn('keyboard',64,0);
  const before=i.read();assert.equal(i.code(session,'noteOff',[0]),false);assert.deepEqual(i.read(),before);
  i.code(session,'noteOn',[1,'G4']);i.code(session,'noteOn',[0,'D4']);assert.equal(i.noteOff('keyboard'),false);
  i.noteOn('newer',67,0);i.endCode(session);
  assert.equal(i.read().owners[0].kind,'keyboard');assert.equal(i.read().owners[1],null);audible(i.generateStereo(4096));
  const next=i.beginCode().session;i.code(next,'noteOn',[1,'C5']);assert.equal(i.endCode(session),false);
  assert.throws(()=>i.code(session,'keyOff',[1]),{name:'AbortError'});
  i.releaseKeyboard();assert.equal(i.read().owners[0],null);assert.equal(i.read().owners[1].kind,'code');
  i.noteOn('explicit',60,0);i.code(next,'keyOff',[0]);assert.equal(i.noteOff('explicit'),false);
});

test('Code uses authored envelopes, lengths, DPCM and FDS on the same six-channel APU',async t=>{
  const i=await fixture(t),preset=i.read().preset;
  preset.pulse.envelope={enabled:true,loop:false,period:4};preset.pulse.lengthIndex=3;
  preset.noise.envelope={enabled:true,loop:true,period:7};preset.noise.lengthIndex=4;
  preset.fds.envelope={enabled:true,increase:false,period:4,initialGain:27};
  preset.fds.modulation.envelope={enabled:true,increase:true,period:6,initialGain:12};
  preset.fds.envelopeClock={masterSpeed:40,halt:false};
  preset.dmc.data=createDemoDpcm();preset.dmc.rate=9;preset.dmc.loop=true;preset.dmc.level=48;
  i.loadPreset(preset);const session=i.beginCode().session;
  for(const [channel,note] of [[0,'C4'],[1,'E4'],[2,'G3'],[3,60],[4,60],[5,'C4']])i.code(session,'noteOn',[channel,note]);
  const state=i.read(),r=state.registers;
  assert.equal(r[0]&31,4);assert.equal(r[3]>>3,3);assert.equal(r[0xc]&63,39);assert.equal(r[0xf]>>3,4);
  assert.equal(r[0x10],64|9);assert.equal(r[0x11],48);assert.equal(r[0x80],4);assert.equal(r[0x84],64|6);assert.equal(r[0x8a],40);
  assert.deepEqual(state.dmcSample.data,preset.dmc.data);assert.equal(state.owners.filter(Boolean).length,6);audible(i.generateStereo(4096));
  i.code(session,'fds.noteOff',[]);i.code(session,'fds.setVolume',[25]);i.code(session,'fds.noteOn',['A3']);
  assert.equal(i.read().registers[0x80],128|25,'explicit Code volume survives the next attack');
  i.code(session,'pulse.setVoice',[0,{duty:.125,volume:3}]);i.code(session,'pulse.noteOn',[0,'D4']);
  assert.equal(i.read().registers[0]&255,0x30|3);
  i.code(session,'dmc.stop',[]);i.code(session,'dmc.play',[{rate:3,loop:false,level:37}]);
  assert.equal(i.read().registers[0x10],3);assert.equal(i.read().registers[0x11],37);
});

test('preset/source/wave edits retain the Code session and fixed channels keep separate authored settings',async t=>{
  const i=await fixture(t),session=i.beginCode().session;
  i.code(session,'noteOn',[0,'C4']);
  const next=i.read().preset;next.source='fds';next.fds.wave=next.fds.wave.map(v=>63-v);next.pulse.volume=4;
  i.loadPreset(next);assert.equal(i.read().codeSession,session);assert.equal(i.read().owners[0].kind,'code');
  i.code(session,'noteOn',[5,'C4']);i.code(session,'noteOn',[0,'E4']);assert.equal(i.read().registers[0]&15,4);
  const selected=i.read().channelPresets[1];selected.pulse.volume=11;selected.pulse.duty=.125;i.applyPhysicalPreset(1,selected);
  i.code(session,'noteOn',[1,'G4']);assert.equal(i.read().registers[4]&15,11);assert.equal(i.read().registers[0]&15,4);
  i.noteOn('fixed',60,1);assert.equal(i.read().registers[4]&15,11);
  i.endCode(session);assert.equal(i.read().owners[1].kind,'keyboard');
});

test('async DMC API memory and malformed or expired Code calls are fenced before gates mutate',async t=>{
  const i=await fixture(t),session=i.beginCode().session;
  await i.code(session,'dmc.loadSample',[new Uint8Array([0xff,0,0xaa]),{address:0xc040}]);
  i.code(session,'dmc.play',[{rate:12,loop:true,level:40}]);
  assert.equal(i.read().dmcSample.address,0xc040);assert.equal(i.read().dmcSample.length,17);assert.deepEqual(i.read().dmcSample.data.slice(0,3),[255,0,170]);
  const before=i.read();
  for(const [method,args] of [['noteOn',[-1,60]],['noteOn',[0,'C0']],['setFrequency',[2,8000]],['pulse.setVoice',[2,{}]],['constructor',[]],['fds.setWave',[[1,2]]],['dmc.loadSample',[new Uint8Array(0)]],['dmc.loadSample',[new Uint8Array([1]),{address:0xc001}]]]){
    assert.throws(()=>i.code(session,method,args));assert.deepEqual(i.read(),before);
  }
  i.endCode(session);const next=i.beginCode().session;i.code(next,'noteOn',[1,60]);
  assert.throws(()=>i.code(session,'reset',[]),{name:'AbortError'});assert.equal(i.read().owners[1].session,next);
});

test('awaitable facade canonicalizes nested note aliases and rejects retired client calls',async()=>{
  let current=true;const calls=[],metadata={session:1,channels:6,clock:1789772.7272727273};
  const client=createNesCodeClient({metadata,isCurrent:()=>current,invoke:(...args)=>{calls.push(args);return true;},dispose:()=>{current=false;}});
  await client.noteOn(0,'C4');await client.fds.noteOn('A3');
  assert.deepEqual(calls,[['noteOn',[0,'C4']],['fds.noteOn',['A3']]]);
  assert.deepEqual(resolveNesCodeNoteTarget(client,client.fds,'noteOn',['A3']),{target:client,channel:5});
  assert.deepEqual(resolveNesCodeNoteTarget(client,client.noise,'noteOff',[]),{target:client,channel:3});
  assert.throws(()=>validateNesCodeCall('getState',[1]),/arguments/);
  await client.dispose();assert.throws(()=>client.noteOn(0,60),{name:'AbortError'});
});

test('ending Code restores authored sample/wave memory while a newer manual Gate remains owned',async t=>{
  const i=await fixture(t),preset=i.read().preset;preset.dmc.data=createDemoDpcm();i.loadPreset(preset);
  const session=i.beginCode().session,otherWave=Array(64).fill(20);
  i.code(session,'fds.setWave',[otherWave]);i.code(session,'fds.noteOn',['C4']);
  assert.deepEqual(i.read().registers.slice(0x40,0x80),otherWave);
  i.noteOn('manual',64,5);assert.deepEqual(i.read().registers.slice(0x40,0x80),preset.fds.wave);
  await i.code(session,'dmc.loadSample',[new Uint8Array([0xff,0xff,0])]);i.code(session,'dmc.play',[]);
  i.endCode(session);assert.equal(i.read().owners[5].kind,'keyboard');
  i.noteOn('dmc',60,4);assert.deepEqual(i.read().dmcSample.data,preset.dmc.data);assert.equal(i.noteOff('manual'),true);
});
