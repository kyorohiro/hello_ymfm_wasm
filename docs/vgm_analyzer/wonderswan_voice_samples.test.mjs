import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWonderSwanVoiceSamples, wonderswanVoiceSampleJson} from './wonderswan_voice_samples.js';

const state = options => createWonderSwanVoiceSamples(3072000, options);
const write = (capture, register, value, time = 0) => capture.write(register, value, time);
const pairs = sample => [...sample.times].map((time,index) => [time,sample.registers[index],sample.values[index]]);

test('Voice PCM requires both CH2 gate and Voice mode; preceding DAC writes become held initial values', () => {
  const capture = state();
  write(capture,9,170); write(capture,17,8); write(capture,20,15);
  write(capture,16,32,1); write(capture,9,180,2); capture.advance(3);
  assert.equal(capture.samples.length,0);
  write(capture,16,34,3); write(capture,9,190,4); write(capture,16,32,8);
  const sample=capture.samples[0];
  assert.equal(sample.kind,'voice-pcm'); assert.equal(sample.representation,'timed-voice-pcm');
  assert.equal(sample.sourceStartSample,3); assert.equal(sample.durationSamples,5); assert.equal(sample.duration,5);
  assert.equal(sample.initial.registers[9],180); assert.equal(sample.initial.heldRegisters[9],170);
  assert.equal(sample.initial.pcmValueKnown,true);
  assert.deepEqual([...sample.data],[190]);
  assert.deepEqual(pairs(sample),[[0,16,34],[1,9,190],[5,16,32]]);
  assert.equal(sample.boundary,'CH2 key-off'); assert.equal(sample.startBoundary,'CH2 key-on');
  assert.deepEqual(capture.events.map(e=>[e.channel,e.startTime,e.endTime]),[[2,3,8]]);
});

test('routing/output and original shared control bytes remain exact, including identical same-time PCM writes', () => {
  const capture=state(); write(capture,16,0x2f); write(capture,9,0); write(capture,9,0);
  write(capture,17,9,3); write(capture,20,5,4); write(capture,30,2,5); write(capture,16,0x2a,5);
  write(capture,0,255,6); write(capture,16,0x0a,8);
  assert.deepEqual(pairs(capture.samples[0]),[[0,16,0x2f],[0,9,0],[0,9,0],[3,17,9],[4,20,5],[5,30,2],[5,16,0x2a],[8,16,0x0a]]);
  assert.equal(capture.samples[0].boundary,'Voice PCM disable');
  assert.equal(capture.samples[0].writeCount,8); assert.deepEqual([...capture.samples[0].data],[0,0]);
});

test('last native-tick registers differ from subsequent written values, preserving nonzero source phase', () => {
  const capture=state();
  write(capture,9,20); write(capture,16,34); write(capture,9,40,1);
  capture.advance(2); // floor(2*24000/44100) == 1: latch 40.
  write(capture,9,60,2); write(capture,16,32,3); // No later tick yet.
  write(capture,9,80,3); write(capture,16,34,3);
  capture.advance(4); write(capture,9,90,4); capture.finish(10);
  const sample=capture.samples[1];
  assert.equal(sample.initial.registers[9],80); assert.equal(sample.initial.heldRegisters[9],40);
  assert.equal(sample.initial.registers[16],32); assert.equal(sample.initial.heldRegisters[16],34);
  assert.equal(sample.phase.sourceStartSample,3); assert.equal(sample.phase.nativeTickRate,24000);
  assert.equal(sample.phase.periodSamples,147); assert.equal(sample.phase.timebase,44100);
  assert.equal(sample.initial.heldPcmValueKnown,true);
  assert.equal(sample.initial.heldRegisters[9],40,'later writes cannot change a prior initial snapshot');
});

test('ten-second display windows preserve initial held values and put boundary writes at new relative time zero', () => {
  const capture=state(); write(capture,9,64); write(capture,16,34,1); write(capture,9,65,2);
  capture.advance(441001); write(capture,9,66,441001);
  capture.advance(882001); capture.finish(882101);
  assert.equal(capture.samples.length,3);
  assert.deepEqual(capture.samples.map(s=>[s.sourceStartSample,s.durationSamples,s.boundary]),[[1,441000,'10-second window'],[441001,441000,'10-second window'],[882001,100,'end']]);
  assert.deepEqual([...capture.samples[0].data],[65]); assert.deepEqual([...capture.samples[1].data],[66]);
  assert.equal(capture.samples[1].times[0],0); assert.equal(capture.samples[1].registers[0],9);
  assert.equal(capture.samples[1].initial.registers[9],65); assert.equal(capture.samples[1].initial.heldRegisters[9],65);
  assert.equal(capture.samples[2].data.length,0,'a held tail remains a valid output capture without fresh PCM bytes');
  assert.equal(capture.samples[2].initial.registers[9],66);
});

test('a disable or EOF exactly on a previously advanced window boundary retains its original endpoint writes', () => {
  const capture=state(); write(capture,16,34); write(capture,9,128);
  capture.advance(441000); write(capture,17,9,441000); write(capture,16,2,441000); capture.finish(441000);
  assert.equal(capture.samples.length,1);
  assert.deepEqual(pairs(capture.samples[0]).slice(-2),[[441000,17,9],[441000,16,2]]);
  assert.equal(capture.samples[0].boundary,'Voice PCM disable');
  assert.equal(capture.events[0].endReason,'Voice PCM disable');
  const end=state(); write(end,16,34); write(end,9,128); end.advance(441000); end.finish(441000);
  assert.equal(end.samples.length,1); assert.equal(end.samples[0].boundary,'end');
});

test('constant held output is included, while intervals with no known/written PCM and zero-duration gates are omitted', () => {
  const held=state(); write(held,9,250); write(held,16,34); held.finish(441);
  assert.equal(held.samples.length,1); assert.equal(held.samples[0].data.length,0);
  assert.equal(held.samples[0].initial.registers[9],250);
  const unknown=state(); write(unknown,16,34); unknown.advance(441001); unknown.finish(441010);
  assert.equal(unknown.samples.length,0);
  const zero=state(); write(zero,16,34); write(zero,9,100); write(zero,16,32); zero.finish(1);
  assert.equal(zero.samples.length,0);
});

test('the capture payload/work budget includes chunk storage and its final typed-array copy peak', () => {
  const chunkWork=4096*7+512, metadataWork=1024;
  const beforeChunk=state({limits:{maxPayloadBytes:metadataWork+chunkWork-1}});
  assert.throws(()=>write(beforeChunk,16,34),/payload\/work limit/);
  const beforeCopy=state({limits:{maxPayloadBytes:metadataWork+chunkWork+13-1}});
  write(beforeCopy,16,34); write(beforeCopy,9,100);
  assert.throws(()=>beforeCopy.finish(1),/payload\/work limit/); // 2*(u32+u8+u8) + one PCM byte.
  assert.equal(beforeCopy.samples.length,0);
  const fits=state({limits:{maxPayloadBytes:metadataWork+chunkWork+13}});
  write(fits,16,34); write(fits,9,100); fits.finish(1);
  assert.equal(fits.stats().retainedBytes,metadataWork+13); assert.equal(fits.stats().stagingBytes,0);
});

test('interval/event budgets bound sparse captures as well as PCM-heavy streams', () => {
  const zero=state({limits:{maxEvents:0}}); assert.throws(()=>write(zero,16,34),/interval\/event/);
  const one=state({limits:{maxSamples:1}}); write(one,16,34); write(one,9,100); write(one,16,32,1);
  assert.throws(()=>write(one,16,34,2),/interval\/event/);
  const sparse=state({limits:{maxEvents:2}}); write(sparse,16,34);
  assert.throws(()=>sparse.advance(441000*3),/interval\/event/);
});

test('more than one million Voice PCM writes remain bounded typed data and retain every byte and timestamp', () => {
  const capture=state(), count=1151160, expected=createHash('sha256');
  write(capture,16,34);
  const block=new Uint8Array(4096);
  for(let i=0;i<count;i++) {
    const value=(i*17+29)&255; write(capture,9,value,i*3); block[i%block.length]=value;
    if(i%block.length===block.length-1)expected.update(block);
  }
  if(count%block.length)expected.update(block.subarray(0,count%block.length));
  capture.finish(count*3);
  assert.equal(capture.samples.length,8); assert.equal(capture.samples.reduce((n,s)=>n+s.data.length,0),count);
  assert.equal(capture.stats().pcmWriteCount,count); assert(capture.stats().retainedBytes<10*1024*1024);
  const actual=createHash('sha256'); for(const sample of capture.samples){assert(sample.times instanceof Uint32Array); actual.update(sample.data);}
  assert.equal(actual.digest('hex'),expected.digest('hex'));
  for(const sample of capture.samples)for(let i=0;i<sample.times.length;i++)if(sample.registers[i]===9)assert.equal((sample.sourceStartSample+sample.times[i])%3,0);
});

test('capture JSON contains original register values, exact timing and both initial register images', () => {
  const capture=state(); write(capture,9,150); write(capture,16,47,1096); write(capture,9,151,1098); capture.finish(1100,'source end');
  const sample=capture.samples[0], json=JSON.parse(wonderswanVoiceSampleJson(sample,capture.events));
  assert.equal(json.format,'tetorica-wonderswan-voice-pcm'); assert.equal(json.timebase,44100);
  assert.equal(json.sourceStartSample,1096); assert.equal(json.durationSamples,4);
  assert.deepEqual(json.registers,[16,9]); assert.deepEqual(json.values,[47,151]);
  assert.equal(json.initial.registers.length,32); assert.equal(json.initial.heldRegisters.length,32);
  assert.deepEqual(json.pcmBytes,[151]); assert.deepEqual(json.observations,capture.events);
  assert.deepEqual(JSON.parse(wonderswanVoiceSampleJson(sample,capture.events[0])).observations,capture.events);
});

test('invalid ranges, ordering and writes after finish cannot alias registers or rewind phase', () => {
  assert.throws(()=>createWonderSwanVoiceSamples(0),/clock/);
  assert.throws(()=>state({limits:{maxEvents:-1}}),/budget/);
  const capture=state(); assert.throws(()=>write(capture,32,1),/relative register/);
  assert.throws(()=>write(capture,9,256),/byte/); assert.throws(()=>capture.advance(-1),/source time/);
  capture.advance(4); assert.throws(()=>write(capture,9,1,3),/backwards/);
  capture.finish(4); assert.throws(()=>write(capture,9,1,4),/already finished/);
  assert.throws(()=>capture.finish(4),/already finished/);
});

test('large exact source positions retain modulo-phase provenance without unsafe clock multiplication', () => {
  const capture=state(), source=2**52;
  write(capture,9,120,source); write(capture,16,34,source); write(capture,9,121,source+1); capture.finish(source+3);
  assert.equal(capture.samples[0].sourceStartSample,source); assert.equal(capture.samples[0].phase.sourceStartSample,source);
  assert.deepEqual(pairs(capture.samples[0]),[[0,16,34],[1,9,121]]);
});
