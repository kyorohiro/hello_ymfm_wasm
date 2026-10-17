import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {decodeBrr,extractBrrSamples,exportBrrSample,readSnesVoices} from './snes_brr.js';
import {readSamplePCM} from './adpcm_b_sample.js';
function snapshot() {return {ram:new Uint8Array(65536),dsp:new Uint8Array(128),nativeFrames:12345};}
function putSample(s, {dir=0x20,srcn=3,start=0x3000,loop=start,blocks=[0x13,...Array(8).fill(0x78)]}={}) {
  s.dsp[0x5d]=dir;const at=((dir<<8)+srcn*4)&65535;
  s.ram[at]=start&255;s.ram[(at+1)&65535]=start>>8;s.ram[(at+2)&65535]=loop&255;s.ram[(at+3)&65535]=loop>>8;
  blocks.forEach((value,i)=>s.ram[(start+i)&65535]=value);
  s.dsp[4]=srcn;s.dsp[8]=0x40;
  return s;
}
test('BRR signed nibbles, high shifts and END stop use exact hardware values',()=>{
  const block=new Uint8Array([0x11,0x78,0x10,0xfe,0xdc,0xba,0x98,0x76,0x54]);
  assert.deepEqual([...decodeBrr(block).pcm16],[14,-16,2,0,-2,-4,-6,-8,-10,-12,-14,-16,14,12,10,8]);
  for(const range of [13,14,15]) {
    const b=block.slice();b[0]=(range<<4)|1;
    assert.deepEqual([...decodeBrr(b).pcm16].slice(0,4),[0,-4096,0,0]);
  }
  const doubled=new Uint8Array(18);doubled.set(block);doubled.set(block,9);
  const d=decodeBrr(doubled);assert.equal(d.blockCount,1);assert.equal(d.pcm.length,16);assert.equal(d.endReached,true);assert.equal(d.loop,false);
});
test('BRR validates finite integer history, complete blocks and resource bounds',()=>{
  for(const value of [null,{},'x']) assert.throws(()=>decodeBrr(value),TypeError);
  for(const size of [0,1,8,10]) assert.throws(()=>decodeBrr(new Uint8Array(size)),RangeError);
  for(const value of [0,-1,1.1,Infinity,7282]) assert.throws(()=>decodeBrr(new Uint8Array(9),{maxBlocks:value}),RangeError);
  assert.throws(()=>decodeBrr(new Uint8Array(18),{maxBlocks:1}),RangeError);
  for(const history of [[NaN,0],[0,Infinity],[32768,0],[-32769,0],[1.1,0]]) assert.throws(()=>decodeBrr(new Uint8Array(9),{history}),RangeError);
  assert.throws(()=>decodeBrr(new Uint8Array(9),{history:[]}),TypeError);
  const noEnd=decodeBrr(new Uint8Array(9));assert.equal(noEnd.endReached,false);assert.equal(noEnd.pcm.length,16);
});
test('BRR chunked decoding carries predictor history without changing PCM',()=>{
  const b=new Uint8Array(9*40);for(let i=0;i<b.length;i++) b[i]=(i*73+17)&255;
  for(let i=0;i<40;i++) b[i*9]&=0xfc;b[b.length-9]|=1;
  const full=decodeBrr(b),left=decodeBrr(b.subarray(0,9*17));
  const right=decodeBrr(b.subarray(9*17),{history:left.finalHistory});
  assert.deepEqual([...left.pcm16,...right.pcm16],[...full.pcm16]);
  assert.ok(full.pcm.every(n=>Number.isFinite(n)&&n>=-1&&n<=1));
});
test('BRR default extraction uses active voices, not all 256 directory entries',()=>{
  const s=putSample(snapshot());s.dsp[0x14]=3;s.dsp[0x18]=20;
  const x=extractBrrSamples(s);assert.equal(x.samples.length,1);assert.equal(x.rejected.length,0);
  const p=x.samples[0];assert.equal(p.sourceNumber,3);assert.equal(p.startAddress,0x3000);assert.equal(p.directory,0x20);assert.equal(p.brr.length,9);
  assert.equal(p.loop,true);assert.equal(p.loopResolved,true);assert.equal(p.loopStartSamples,0);assert.equal(p.loopEndSamples,16);
  assert.equal(p.sampleRate,32000);assert.equal(p.nativeFrames,12345);assert.deepEqual(p.voices.map(v=>v.index),[0,1]);
  s.dsp[8]=0;s.dsp[0x18]=0;assert.equal(extractBrrSamples(s).samples.length,0);
  assert.equal(extractBrrSamples(s,{sourceNumbers:[3]}).samples.length,1);
});
test('BRR directory override, loop offset and snapshot ownership preserve raw data',()=>{
  const blocks=[0x10,...Array(8).fill(0x12),0x13,...Array(8).fill(0x34)];
  const s=putSample(snapshot(),{dir:0xff,srcn:255,start:0x3001,loop:0x300a,blocks});
  s.dsp[0x5d]=0;
  const p=extractBrrSamples(s,{directory:255,sourceNumbers:[255]}).samples[0];
  assert.equal(p.directoryEntryAddress,0x2fc);assert.equal(p.loopStartSamples,16);assert.equal(p.loopEndSamples,32);
  const original=p.brr.slice(),hash=p.hash;s.ram.fill(0);s.dsp.fill(0);assert.deepEqual(p.brr,original);assert.equal(p.hash,hash);
});
test('BRR hardware RAM wrap and invalid loop addresses are bounded and explicit',()=>{
  const s=putSample(snapshot(),{start:0xfffc,loop:0x22,blocks:[0x13,...Array(8).fill(0x87)]});
  const p=extractBrrSamples(s).samples[0];assert.equal(p.brr.length,9);assert.equal(p.loopResolved,false);
  assert.equal(p.loopStartSamples,null);assert.equal(p.loopAddress,0x22);assert.ok(p.warnings.some(s=>s.includes('wraps')));assert.ok(p.warnings.some(s=>s.includes('Loop')));
  s.ram.fill(0);s.ram[0x200c]=0;s.ram[0x200d]=0x30;
  const x=extractBrrSamples(s,{maxBlocks:2});assert.equal(x.samples.length,0);assert.equal(x.rejected.length,1);assert.ok(x.rejected[0].reason.includes('END'));
});
test('BRR content hash/version changes on RAM overwrite and loop metadata changes',()=>{
  const s=putSample(snapshot()),a=extractBrrSamples(s).samples[0];
  s.ram[0x3001]^=1;const b=extractBrrSamples(s).samples[0];assert.notEqual(a.hash,b.hash);assert.notEqual(a.version,b.version);
  s.ram[0x200e]=1;const c=extractBrrSamples(s).samples[0];assert.equal(b.hash,c.hash);assert.notEqual(b.version,c.version);
});
test('DSP snapshot metadata retains signed volumes, ADSR/GAIN, pitch and flags without MIDI inference',()=>{
  const s=putSample(snapshot());s.dsp.set([0x80,0x7f,0x34,0xff,3,0xe9,0xab,0xd2,0x40,0xfe],0);
  s.dsp[0x3d]=1;s.dsp[0x2d]=1;s.dsp[0x4d]=1;
  const v=readSnesVoices(s)[0];assert.equal(v.volumeLeft,-128);assert.equal(v.volumeRight,127);assert.equal(v.pitch,0x3f34);
  assert.equal(v.attack,9);assert.equal(v.decay,6);assert.equal(v.sustainLevel,5);assert.equal(v.sustainRate,11);
  assert.equal(v.gainMode,'linear-increase');assert.equal(v.gainValue,18);assert.equal(v.outx,-2);assert.equal(v.noise,true);assert.equal(v.echo,true);
  assert.equal(v.pitchModulation,false);assert.equal(v.note,undefined);
});
test('WAV export preserves source-rate loop/envelope metadata in serializable sidecar without invented root',async()=>{
  const sample=extractBrrSamples(putSample(snapshot())).samples[0];
  const output=exportBrrSample(sample),pcm=await readSamplePCM(output.wav);
  assert.equal(pcm.sampleRate,32000);assert.equal(pcm.channels.length,1);assert.equal(pcm.channels[0].length,16);
  assert.equal(output.metadata.rootNote,null);assert.equal(output.metadata.loopStartSamples,0);assert.equal(output.metadata.loopEndSamples,16);
  assert.equal(output.metadata.voices[0].adsr1,0);assert.equal(JSON.parse(JSON.stringify(output.metadata)).sourceNumber,3);
  assert.equal(exportBrrSample(sample,{rootNote:60}).metadata.rootNote,60);
  for(const value of [-1,128,NaN,'C4']) assert.throws(()=>exportBrrSample(sample,{rootNote:value}),RangeError);
});
test('BRR snapshot API rejects wrong sizes, invalid DIR/SRCN and unsafe limits',()=>{
  assert.throws(()=>extractBrrSamples({ram:new Uint8Array(1),dsp:new Uint8Array(128)}),RangeError);
  const s=snapshot();for(const directory of [-1,256,NaN,1.1]) assert.throws(()=>extractBrrSamples(s,{directory}),RangeError);
  for(const sourceNumbers of ['x',Array(257).fill(0)]) assert.throws(()=>extractBrrSamples(s,{sourceNumbers}),TypeError);
  for(const sourceNumbers of [[-1],[256],[NaN],Array(1)]) assert.throws(()=>extractBrrSamples(s,{sourceNumbers}),RangeError);
});
test('raw BRR decoder matches actual accurate upstream S-DSP for all filters/ranges, histories and random chains',async t=>{
  const compiler=process.env.CXX||'c++', probe=spawnSync(compiler,['--version'],{encoding:'utf8'});
  if(probe.error?.code==='ENOENT') {t.skip('C++ compiler unavailable; native S-DSP comparison not run');return;}
  assert.equal(probe.status,0,probe.stderr);
  const temp=await mkdtemp(join(tmpdir(),'tetorica-brr-reference-'));
  try {
    const root=resolve(fileURLToPath(new URL('..',import.meta.url))),binary=join(temp,'reference');
    const build=spawnSync(compiler,['-std=c++11','-O2','-fwrapv','-I'+join(root,'third_party/snes-spc/snes_spc'),join(root,'test/helpers/snes_brr_reference.cpp'),'-o',binary],{encoding:'utf8'});
    assert.equal(build.status,0,build.stderr);
    let seed=0x582361ab;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
    const cases=[];
    for(let range=0;range<16;range++) for(let filter=0;filter<4;filter++) for(const history of [[0,0],[32767,-32768],[-32768,32767],[1001,-213]]) {
      const b=new Uint8Array(9);b[0]=(range<<4)|(filter<<2)|1;
      for(let i=1;i<9;i++) b[i]=random()>>>24;
      cases.push({b,history});
    }
    for(let i=0;i<8;i++) {
      const b=new Uint8Array(9*128);
      for(let j=0;j<b.length;j++) b[j]=random()>>>24;
      for(let j=0;j<128;j++) b[j*9]&=0xfc;b[b.length-9]|=1;
      cases.push({b,history:[(random()&65535)-32768,(random()&65535)-32768]});
    }
    const header=Buffer.alloc(4);header.writeUInt32LE(cases.length);
    const input=[header],expected=[];
    for(const {b,history} of cases) {
      const h=Buffer.alloc(8);h.writeUInt32LE(b.length/9);h.writeInt16LE(history[0],4);h.writeInt16LE(history[1],6);input.push(h,b);
      const result=decodeBrr(b,{history}).pcm16,part=Buffer.alloc(result.length*2);result.forEach((n,i)=>part.writeInt16LE(n,i*2));expected.push(part);
    }
    const run=spawnSync(binary,[],{input:Buffer.concat(input),maxBuffer:4*1024*1024});assert.equal(run.status,0,run.stderr?.toString());
    assert.deepEqual(run.stdout,Buffer.concat(expected),'bit-exact pre-Gaussian PCM from the actual vendored S-DSP');
  } finally {await rm(temp,{recursive:true,force:true});}
});
test('BRR extraction caps total allocation/work across explicitly selected directory entries',()=>{
  const s=putSample(snapshot());
  for(let srcn=4;srcn<20;srcn++) {
    const at=0x2000+srcn*4;s.ram[at]=0;s.ram[at+1]=0x30;
  }
  const result=extractBrrSamples(s,{sourceNumbers:[3,4,5,6],maxTotalBlocks:2});
  assert.equal(result.samples.length,2);assert.equal(result.rejected.length,2);assert.ok(result.warnings.some(s=>s.includes('maxTotalBlocks')));
});
test('original synthetic SPC fixture extracts a looped raw sample without game data',async()=>{
  const {createSyntheticSpc}=await import('./spc_test_fixture.mjs');
  const {parseSpcFile}=await import('./spc_file.js');
  const parsed=parseSpcFile(createSyntheticSpc());
  const sourceNumbers=[...new Set(readSnesVoices(parsed).map(v=>v.sourceNumber))];
  const result=extractBrrSamples(parsed,{sourceNumbers});
  assert.ok(result.samples.length>=1);const sample=result.samples.find(s=>s.startAddress===0x2000);
  assert.ok(sample);assert.equal(sample.loop,true);assert.ok(sample.pcm.some(value=>value!==0));
});
