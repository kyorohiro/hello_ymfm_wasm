// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeSample,allocateSample,sampleLibrary,maxRom} from './samples.js';
import {bankHash,presetRom} from './preset.js';
import {QSoundPcm,QSOUND_PCM_RATE} from '../js/qsoundpcm.js';
import {noteWrites} from './demo.js';

function wave(samples){
  const b=Buffer.alloc(44+samples.length);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);
  b.writeUInt32LE(16000,28);b.writeUInt16LE(1,32);b.writeUInt16LE(8,34);
  b.write('data',36);b.writeUInt32LE(samples.length,40);b.set(samples,44);
  return b;
}
test('imported PCM plays the original waveform and pitch on the assigned channel',()=>{
  const bytes=wave([128,255,128,0]),{pcm,rate}=decodeSample(bytes);
  assert.deepEqual([...pcm],[0,127,0,128]);
  assert.ok(Math.abs(rate*QSOUND_PCM_RATE/4096-16000)<3);
  const {rom}=sampleLibrary([{path:'/samples/a.wav',data:bytes}],{'/samples/a.wav':65540});
  const chip=new QSoundPcm(rom,QSOUND_PCM_RATE);
  for(const [reg,value] of noteWrites(1,60,0,0,16384,4096,8,4,1,4))chip.writeRegister(reg,value);
  const output=Array.from({length:8},()=>{chip.tick();return chip.left;});
  assert.ok(output[1]>0 && output[3]<0);
  assert.deepEqual(output.slice(0,4),output.slice(4));
});
test('imported clips retain a signed end and loop within one bank',()=>{
  assert.equal(allocateSample([],32767),65536);
  assert.equal(allocateSample([{offset:65536,length:32767}],2),98304);
  assert.equal(decodeSample(wave(new Uint8Array(40000))).pcm.length,32767);
  assert.throws(()=>allocateSample([{offset:65536,length:maxRom-65536}],2),/16 MiB/);
  assert.throws(()=>decodeSample(wave([128,128]).subarray(0,44)),/Truncated/);
});
test('a project preset survives additional samples in the same bank',async()=>{
  const bytes=wave([255,128]),path='/samples/a.wav',files=[{path,data:bytes}];
  const preset={source:null,clock:4000000,bank:1,projectRange:[0,2],bankHash:await bankHash(decodeSample(bytes).pcm)};
  const {rom}=sampleLibrary([...files,{path:'/samples/b.wav',data:bytes}],{[path]:65536,'/samples/b.wav':65538});
  assert.equal(await presetRom(preset,null,rom),rom);
  rom[65536]=12;
  await assert.rejects(presetRom(preset,null,rom),/differs/);
});

test('WAV pad preserves one-shot duration and signal through the QSound decoder',async()=>{
  const {cabinetSnare,drumPath}=await import('./sample-duet.js');
  const {advanceAdpcm}=await import('../js/qsoundpcm.js');
  const bytes=cabinetSnare(),decoded=decodeSample(bytes,true),start=12000;
  const lib=sampleLibrary([{path:drumPath,data:bytes}],{[drumPath]:65536},{[drumPath]:65536+start});
  const item=lib.padItems.get(drumPath);
  assert.equal(item.length,Math.ceil(decoded.seconds*QSOUND_PCM_RATE/6));
  const voice={bank:1,start,end:start+item.length,trigger:true,volume:32767};
  let cross=0,sourcePower=0,outputPower=0;
  for(let i=0;i<item.length*2;i++){
    advanceAdpcm(voice,lib.rom,i%2);
    const source=(decoded.pcm[i]<<24)>>24;
    cross+=source*voice.output;sourcePower+=source*source;outputPower+=voice.output**2;
  }
  assert.ok(cross/Math.sqrt(sourcePower*outputPower)>.8);
  advanceAdpcm(voice,lib.rom,false);
  assert.equal(voice.gain,0);
  assert.throws(()=>sampleLibrary([{path:drumPath,data:bytes}],{[drumPath]:65536},{[drumPath]:65540}),/Overlapping/);
});
