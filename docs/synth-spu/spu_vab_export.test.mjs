// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readVab,prepareVabTone,exportVab} from './spu_synth_vab.js';
import {createVabFixture} from '../../test/helpers/spu_vab_fixture.mjs';
import {readPsfFileSet,extractPsfVabs} from '../playground/playground_ps1_psf.js';
import {createPsfFixture,psfFile} from '../../test/helpers/spu_psf_fixture.mjs';

function detailedFixture() {
  const {vh,vb}=createVabFixture(),view=new DataView(vh.buffer);
  view.setUint32(4,6,true);view.setUint32(8,0x12345678,true);
  vh[0x18]=109;vh[0x19]=47;vh[0x1a]=0xa1;vh[0x1b]=0xb2;
  for(const program of [3,11]) {
    const at=0x20+program*16;
    for(let index=2;index<16;index++)if(index!==4)vh[at+index]=index*13+program;
    vh[at+1]=91;vh[at+4]=33;
  }
  for(const at of [0x820,0x840,0xa20]) {
    vh[at]=0xab;vh[at+1]=4;vh[at+2]=73;vh[at+3]=91;
    for(let index=8;index<16;index++)vh[at+index]=index*7;
    for(let index=24;index<32;index++)vh[at+index]=index*5;
    view.setUint16(at+16,0x9234,true);view.setUint16(at+18,0xa6e8,true);
  }
  vb.fill(0x5c,0,16);vb.fill(0xf9,80,96);vb.fill(0xe7,112,128);
  vb[17]&=~4;vb[33]|=4; // The loop starts at the second decoded packet.
  const vab=new Uint8Array(vh.length+vb.length);vab.set(vh);vab.set(vb,vh.length);
  return {vh,vb,vab};
}

test('whole VAB export preserves exact combined source bytes, including unsupported attributes and padding',()=>{
  const fixture=detailedFixture(),bank=readVab(fixture.vab),before=structuredClone(bank);
  const output=exportVab(bank);
  assert.deepEqual(output,fixture.vab);assert.deepEqual(readVab(output),bank);
  assert.deepEqual(bank,before);assert.deepEqual(Object.keys(bank),['version','id','masterVolume','masterPan','programs','tones','samples'],'raw source storage does not alter enumerable parser results');
  output.fill(0);assert.deepEqual(exportVab(bank),fixture.vab,'each export owns its returned bytes');
});

test('split VH/VB inputs retain owned original bytes and export the same combined VAB',()=>{
  const fixture=detailedFixture(),expected=fixture.vab.slice(),bank=readVab(fixture.vh,fixture.vb);
  fixture.vh.fill(0);fixture.vb.fill(0);
  assert.deepEqual(exportVab(bank),expected,'later input-buffer edits cannot change the retained source');
  const second=exportVab(bank);assert.notEqual(second.buffer,exportVab(bank).buffer);
  assert.equal(prepareVabTone(readVab(second),1).options.loopStartSamples,28);
});

test('selected Tone VAB retains its sparse Program number, complete sample, tuning and all raw Tone/program attributes',()=>{
  const fixture=detailedFixture(),bank=readVab(fixture.vab),before=structuredClone(bank);
  for(const [toneNumber,programIndex,originalToneAt,sampleAt,sampleLength]of [[1,3,0x840,16,80],[2,11,0xa20,96,32]]) {
    const output=exportVab(bank,{toneNumber}),selected=readVab(output),view=new DataView(output.buffer);
    assert.equal(selected.version,bank.version);assert.equal(selected.id,bank.id);
    assert.equal(selected.masterVolume,bank.masterVolume);assert.equal(selected.masterPan,bank.masterPan);
    assert.equal(selected.programs.length,1);assert.equal(selected.programs[0].index,programIndex);
    assert.equal(selected.tones.length,1);assert.equal(selected.tones[0].index,0);assert.equal(selected.tones[0].sample,1);
    assert.deepEqual(selected.tones[0],{...bank.tones[toneNumber],index:0,sample:1});
    assert.equal(selected.samples.length,1);assert.deepEqual(selected.samples[0].bytes,fixture.vb.slice(sampleAt,sampleAt+sampleLength));
    assert.equal(view.getUint16(0xa20,true),2,'the original 16-byte VB prefix remains reserved');
    assert.equal(view.getUint16(0xa22,true),sampleLength/8);
    assert.deepEqual(output.slice(0xc20,0xc30),fixture.vb.slice(0,16));
    const expectedProgram=fixture.vh.slice(0x20+programIndex*16,0x20+(programIndex+1)*16);expectedProgram[0]=1;
    assert.deepEqual(output.slice(0x20+programIndex*16,0x20+(programIndex+1)*16),expectedProgram);
    const expectedTone=fixture.vh.slice(originalToneAt,originalToneAt+32);new DataView(expectedTone.buffer).setUint16(22,1,true);
    assert.deepEqual(output.slice(0x820,0x840),expectedTone,'unmodeled priority, flags, vibrato, bend and reserved Tone bytes remain exact');
    for(let index=0;index<128;index++)if(index!==programIndex)assert.equal(output[0x20+index*16],0);
    const original=prepareVabTone(bank,toneNumber),actual=prepareVabTone(selected,0);
    assert.deepEqual(actual.adpcm,original.adpcm);assert.deepEqual(actual.options,original.options);assert.deepEqual(actual.preset,original.preset);
    assert.equal(actual.trimmedBytes,original.trimmedBytes,'bytes after END remain inside the original sample-size boundary');
  }
  assert.deepEqual(bank,before);
});

test('whole bank preserves unavailable Tones while selected unsupported Tones fail without changing their source',()=>{
  for(const kind of ['none','noise','bad-packet']) {
    const fixture=createVabFixture(),view=new DataView(fixture.vab.buffer);
    if(kind==='none')view.setUint16(0x840+22,0,true);
    else if(kind==='noise')view.setUint16(0x840+22,255,true);
    else fixture.vab[fixture.vh.length+16]=0xff;
    const bank=readVab(fixture.vab),before=structuredClone(bank);
    assert.deepEqual(exportVab(bank),fixture.vab);
    assert.throws(()=>exportVab(bank,{toneNumber:1}),kind==='none'?/no assigned sample/:kind==='noise'?/Noise/:/predictor/);
    assert.deepEqual(bank,before);assert.deepEqual(exportVab(bank),fixture.vab);
  }
});

test('mutated metadata or ADPCM and foreign parsed-bank copies cannot silently masquerade as original exports',()=>{
  const fixture=createVabFixture(),bank=readVab(fixture.vab);
  bank.masterVolume--;
  assert.throws(()=>exportVab(bank),/source bank changed/);assert.throws(()=>exportVab(bank,{toneNumber:0}),/source bank changed/);
  bank.masterVolume++;
  bank.tones[0].adsr1^=1;assert.throws(()=>exportVab(bank),/source bank changed/);bank.tones[0].adsr1^=1;
  bank.samples[0].bytes[2]^=1;assert.throws(()=>exportVab(bank),/source bank changed/);bank.samples[0].bytes[2]^=1;
  assert.deepEqual(exportVab(bank),fixture.vab);
  assert.throws(()=>exportVab(structuredClone(bank)),/original bank returned by readVab/);
  for(const options of [null,[],{unknown:true}])assert.throws(()=>exportVab(bank,options),/options/);
  for(const toneNumber of [-1,3,1.5,null,NaN])assert.throws(()=>exportVab(bank,{toneNumber}),/choose a tone/);
});

test('PSF-extracted banks use the same source-retaining parser instance as standalone exports',async()=>{
  const {standalone}=createPsfFixture(),set=await readPsfFileSet([psfFile('export.psf',standalone)]);
  const result=await extractPsfVabs(set,'export.psf');assert(result.banks.length>0);
  for(const {bank}of result.banks) {
    assert.deepEqual(readVab(exportVab(bank)),bank);
    assert.deepEqual(prepareVabTone(readVab(exportVab(bank,{toneNumber:1})),0).adpcm,prepareVabTone(bank,1).adpcm);
  }
});
