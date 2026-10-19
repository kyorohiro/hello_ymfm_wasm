import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {CHIP_CLOCKS, validateChipClock, attachChipClock, ChipClockResampler} from './playground_chip_clock.js';
import {GameboyApu} from './gameboyapu.js';
import {createGameboyClient} from './playground_gameboy.js';
import factory from '../docs/generated/gameboy_apu_wasm.js';
import {createWorkerChip} from './playground_worker_chip.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {GameboyVoiceInspector} from './playground_native_voice_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';

test('clock requests are ordered, reject invalid values, coexist with RPC and reject on disposal', async () => {
 const sent=[];let previous=0,closed=0;
 const port={postMessage:data=>sent.push(data),onmessage:()=>previous++,close(){},start(){}};
 const client=attachChipClock({dispose(){closed++;}},port,4000000);
 for(const invalid of [NaN,Infinity,-1,0,99999,100000001,123456.5]) await assert.rejects(client.setClock(invalid),/Chip clock/);
 assert.equal(sent.length,0);
 const a=client.setClock(2000000),b=client.setClock(8000000);
 assert.equal(client.clock,4000000);
 port.onmessage({data:{id:123}});assert.equal(previous,1);
 port.onmessage({data:{id:sent[0].id}});await a;assert.equal(client.clock,2000000);
 port.onmessage({data:{id:sent[1].id,error:'Rejected by processor'}});await assert.rejects(b,/Rejected/);assert.equal(client.clock,2000000);
 const pending=client.setClock(4000000);const rejected=assert.rejects(pending,/disposed/);
 client.dispose();await rejected;client.dispose();assert.equal(closed,1);
 await assert.rejects(client.setClock(4000000),/disposed/);
});

test('fixed-rate clock adapter preserves phase through changes and output partitioning', () => {
 function setup(){let frame=0;return {adapter:new ChipClockResampler(),chip:{generateStereo(n){const left=Float32Array.from({length:n},()=>++frame);return {left,right:left};}},get frames(){return frame;}};}
 function render(x,n){const left=new Float32Array(n),right=new Float32Array(n);x.adapter.render(x.chip,left,right);assert.deepEqual(left,right);return left;}
 const a=setup(),b=setup();
 a.adapter.setClock(2000000,4000000);b.adapter.setClock(2000000,4000000);
 assert.deepEqual(render(a,10),Float32Array.from([...render(b,3),...render(b,7)]));assert.equal(a.frames,5);
 a.adapter.setClock(8000000,4000000);assert.deepEqual(render(a,2),Float32Array.from([6.5,8.5]));assert.equal(a.frames,9);
});

test('real Game Boy: clock shifts a held tone without reset; new setFrequency uses updated clock', async () => {
 let Processor,readyResolve;const ready=new Promise(r=>readyResolve=r);
 const source=(await readFile(new URL('./playground_gameboy_worklet.js',import.meta.url),'utf8')).replace(/^import .*;$/gm,'');
 vm.runInNewContext(source,{GameboyVoiceInspector,receiveChipInspector,GameboyApu,factory,CHIP_CLOCKS,ChipClockResampler,sampleRate:48000,
  createProcessorPerformance:options=>createProcessorPerformance({...options,rate:48000,nowFrame:()=>0}),
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:readyResolve};}},registerProcessor:(_,p)=>Processor=p});
 const processor=new Processor({processorOptions:{wasmBinary:await readFile(new URL('../docs/generated/gameboy_apu_wasm.wasm',import.meta.url))}});await ready;
 const port={start(){},close(){},postMessage:data=>processor.receive(data,{postMessage:reply=>port.onmessage({data:reply})})};
 const chip=createGameboyClient(port);
 function frequency(){const left=new Float32Array(48000),right=new Float32Array(48000);for(let offset=0;offset<left.length;offset+=128)processor.process([],[[left.subarray(offset,offset+128),right.subarray(offset,offset+128)]]);let crossings=0;for(let i=1;i<left.length;i++)if(left[i-1]<=0&&left[i]>0)crossings++;return crossings;}
 try{
  chip.initialize();chip.pulse.setVoice(0,{duty:.5,volume:12});chip.pulse.setFrequency(0,440);chip.pulse.keyOn(0);
  const base=frequency();assert.ok(Math.abs(base-440)<3,base);
  await chip.setClock(CHIP_CLOCKS.gameboy/2);const half=frequency();assert.ok(Math.abs(half-220)<3,half);
  chip.pulse.setFrequency(0,440);const retuned=frequency();assert.ok(Math.abs(retuned-440)<3,retuned);
  await chip.setClock(CHIP_CLOCKS.gameboy);assert.ok(Math.abs(frequency()-880)<5);
 }finally{chip.dispose();processor.dispose();}
});

test('selected Worker FM clock uses ordered direct batches, mirrors only after acknowledgement and keeps register state', async () => {
 const commands=[],events=[];
 const port={start(){},postMessage:data=>commands.push(data)};
 const chip=createWorkerChip({port,capabilities:{chip:'ym2612',fmChannels:6},observe:e=>events.push(e)});
 chip.fm.setFrequency(0,4,600);const before=structuredClone(chip.raw.channels);
 const request=chip.fm.setClock(4000000);
 const command=commands.at(-1)[0];assert.equal(command.type,'chip-clock');assert.equal(chip.fm.clock,CHIP_CLOCKS.ym2612);
 assert.ok(!events.some(e=>e.method==='setClock'));
 port.onmessage({data:{type:'chip-clock-result',id:command.id}});await request;
 assert.equal(chip.fm.clock,4000000);assert.deepEqual(chip.raw.channels,before);assert.equal(events.at(-1).method,'setClock');
});

test('Stop cancels a pending selected-clock acknowledgement; a new Run can change it', async () => {
 const commands=[];const port={start(){},postMessage:data=>commands.push(data)};
 const chip=createWorkerChip({port,capabilities:{chip:'ym2612',fmChannels:6}});
 const pending=chip.fm.setClock(4000000);const rejection=assert.rejects(pending,/Run stopped/);
 const stale=commands.at(-1)[0];chip.stop();await rejection;
 port.onmessage({data:{id:stale.id,type:'chip-clock-result'}});assert.equal(chip.fm.clock,CHIP_CLOCKS.ym2612);
 chip.resume();const next=chip.fm.setClock(8000000);const command=commands.at(-1)[0];
 port.onmessage({data:{id:command.id,type:'chip-clock-result'}});await next;assert.equal(chip.fm.clock,8000000);
});
