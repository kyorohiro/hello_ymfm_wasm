// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import factory from '../generated/ym2608_wasm.js';
import {Ym2608,YM2608_CLOCK,normalizeYm2608OutputGains,normalizeYm2608SourceGains} from '../js/ym2608.js';
import {createPerformanceQueue,createPerformanceChipOwnership} from '../js/playground_performance_queue.js';
import {createChipPortReceiver} from '../js/playground_chip_port.js';
import {validateChipClock} from '../js/playground_chip_clock.js';
import {createOpnAuditionGuard} from '../js/playground_audition_guard.js';
import {createYm2608AdpcmRelease} from './adpcm_audio_receiver.js';

const wasmBinary=await readFile(new URL('../generated/ym2608_wasm.wasm',import.meta.url));
let module;
const moduleFactory=async() => module??=await factory({wasmBinary});
async function fixture(file,rate) {
  let Processor;
  const messages=[],writes=[],scope={sampleRate:rate,currentFrame:0,YM2608_CLOCK,normalizeYm2608OutputGains,normalizeYm2608SourceGains,validateChipClock,
    createPerformanceQueue,createPerformanceChipOwnership,createYm2608AdpcmRelease,
    receiveOpnAuditionCommand:() => false,receiveChipInspector:() => false,
    AudioWorkletProcessor:class {constructor(){this.port={postMessage:message => messages.push(message)};}},
    registerProcessor(_name,Type){Processor=Type;}};
  scope.createChipPortReceiver=(apply,_now,options) => createChipPortReceiver(apply,() => scope.currentFrame/rate,options);
  const source=await readFile(new URL(file,import.meta.url),'utf8');
  vm.runInNewContext(source.replace(/^import .*;\n/gm,''),scope);
  const processor=new Processor(),chip=await Ym2608.create({moduleFactory});
  processor.auditions=createOpnAuditionGuard(chip,6);
  const physical=chip.writeRegister.bind(chip);
  chip.writeRegister=(register,value,port) => {writes.push([port??0,register,value]);return physical(register,value,port);};
  processor.chip=chip;processor.chipRate=chip.sampleRate(YM2608_CLOCK);
  const send=data => processor.port.onmessage({data});
  return {processor,chip,scope,messages,writes,send};
}

function program(f,rate) {
  f.send({type:'loadAdpcmMemory',id:1,address:0,bytes:Uint8Array.from({length:64},(_,i) => i*73&255)});
  const write=(port,register,value) => ({type:'write',port,register,value});
  const fm=[write(0,0xb0,7),write(0,0xb4,0xc0)];
  for(const offset of [0,4,8,12])fm.push(write(0,0x30+offset,1),write(0,0x40+offset,offset===12?24:127),write(0,0x50+offset,31),write(0,0x80+offset,15));
  f.send([...fm,write(0,0xa4,0x22),write(0,0xa0,0x69),write(0,0x28,0xf0),
    write(0,0,90),write(0,1,0),write(0,7,0x3e),write(0,8,8),
    ...[[1,194],[2,0],[3,0],[4,1],[5,0],[9,80],[10,154],[11,192],[0,176]].map(([r,v]) => write(1,r,v))]);
  f.send({type:'performance-start',session:1});
  for(const [frame,commands] of [
    [37,[write(1,11,99)]],[129,[write(1,0,1)]],[205,[write(1,0,176)]],
    [299,[write(1,4,1)]],[350,[{type:'chip-clock',id:2,clock:100000}]],
    [560,[{type:'chip-clock',id:3,clock:16000000}]],[702,[write(1,11,32)]],
    [780,[{type:'reset'}]],[850,[write(0,0,70),write(0,7,0x3e),write(0,8,10)]],
  ])f.send({performance:{session:1,owner:'raw-regression',time:frame/rate},commands});
}

for(const rate of [44100,48000,96000])test(`standalone OPNA renderer is sample-identical to shared raw Worklet at ${rate}Hz`,async t => {
  const app=await fixture('./audio_worklet.js',rate),shared=await fixture('../js/ym2608-worklet.js',rate);
  t.after(() => {app.chip.dispose();shared.chip.dispose();});
  program(app,rate);program(shared,rate);
  let peak=0;
  for(const frames of [1,37,64,26,128,19,128,128,128,128,128,1024]) {
    const render=f => {const left=new Float32Array(frames),right=new Float32Array(frames);f.processor.process([],[[left,right]]);f.scope.currentFrame+=frames;return {left,right};};
    const actual=render(app),expected=render(shared);
    assert.deepEqual(actual,expected,'raw writes, scheduled writes and rate changes retain exact PCM ordering');
    assert.equal(app.processor.remainder,shared.processor.remainder);
    assert.deepEqual(app.writes,shared.writes,'no unsolicited physical release or level writes appear');
    assert.deepEqual(structuredClone(app.messages),structuredClone(shared.messages));
    for(const value of actual.left)peak=Math.max(peak,Math.abs(value));
  }
  assert(peak>.01,'comparison exercises audible native ADPCM/SSG rather than two silent fixtures');
});
