import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {encodeBrr} from './snes_brr_encoder.js';
import {decodeBrr} from './snes_brr.js';
import {SnesDspCore} from './spc.js';
import {SnesSynth,prepareSnesBRR} from './snessynth.js';

// Entirely authored signals; no recording, ROM, game audio or third-party asset.
function fixtures() {
  let seed=0x47ae13d2;
  const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
  return {
    sine:Float32Array.from({length:1024},(_,i)=>.65*Math.sin(2*Math.PI*i/64)),
    voice:Float32Array.from({length:1024},(_,i)=>{
      const phase=2*Math.PI*i/97,envelope=Math.min(1,i/48)*Math.min(1,(1024-i)/96);
      return envelope*(.44*Math.sin(phase)+.19*Math.sin(2*phase)+.10*Math.sin(3*phase)+.05*Math.sin(5*phase));
    }),
    drum:Float32Array.from({length:1024},(_,i)=>Math.exp(-i/190)*(.6*Math.sin(2*Math.PI*(i/45-i*i/320000))+.27*noise())),
  };
}
function measure(source,decoded) {
  let error=0,signal=0,maxError=0;
  for(let i=0;i<source.length;i++) {
    const difference=source[i]-decoded[i];
    error+=difference*difference;signal+=source[i]*source[i];maxError=Math.max(maxError,Math.abs(difference));
  }
  return {mse:error/source.length,rmsError:Math.sqrt(error/source.length),maxError,
    signalRms:Math.sqrt(signal/source.length),snrDb:error===0||signal===0?null:10*Math.log10(signal/error),exact:error===0};
}
function assertMetrics(encoded,source,decoded) {
  const expected=measure(source,decoded),actual=encoded.metrics;
  for(const key of ['rmsError','maxError','signalRms'])assert.ok(Math.abs(actual[key]-expected[key])<1e-12,`${key} measures the decoded original frames`);
  if(expected.snrDb===null)assert.equal(actual.snrDb,null);
  else assert.ok(Number.isFinite(actual.snrDb)&&Math.abs(actual.snrDb-expected.snrDb)<1e-10);
  assert.equal(actual.exact,expected.exact);assert.equal(actual.errorFrames,source.length);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),actual,'metrics are JSON safe');
  return expected;
}
function assertHeaders(encoded,{loop=false,loopStartSamples=null}={}) {
  assert.ok(encoded.brr instanceof Uint8Array);assert.equal(encoded.brr.length,encoded.blockCount*9);
  assert.equal(encoded.frames,encoded.blockCount*16);
  for(let block=0;block<encoded.blockCount;block++) {
    const header=encoded.brr[block*9];assert.ok(header>>4<=12,'encoder emits the regular hardware ranges 0..12');
    assert.equal(header&3,block===encoded.blockCount-1?(loop?3:1):0,'only the final block has END/LOOP');
    if(block===0||block*16===loopStartSamples)assert.equal((header>>2)&3,0,'entry blocks reset predictor dependence');
  }
  const decoded=decodeBrr(encoded.brr);
  assert.equal(decoded.blockCount,encoded.blockCount);assert.equal(decoded.endReached,true);assert.equal(decoded.loop,loop);
  assert.equal(decoded.pcm.length,encoded.frames);assert.ok(decoded.pcm.every(n=>Number.isFinite(n)&&n>=-1&&n<=1));
  return decoded;
}

test('BRR encoder emits hardware header bits and high/low signed nibbles in sample order',()=>{
  const silence=encodeBrr(new Float32Array(16));
  assert.deepEqual(silence.brr,new Uint8Array([1,0,0,0,0,0,0,0,0]));
  const alternating=Float32Array.from({length:16},(_,i)=>i&1?-.25:.25),encoded=encodeBrr(alternating);
  // Filter 0, range 11: signed nibble 4 -> 8192, nibble C -> -8192.
  assert.deepEqual(encoded.brr,new Uint8Array([0xb1,...Array(8).fill(0x4c)]));
  assert.deepEqual(decodeBrr(encoded.brr).pcm,alternating);
  assert.equal(encoded.sourceFrames,16);assert.equal(encoded.paddingFrames,0);
  assertMetrics(silence,new Float32Array(16),decodeBrr(silence.brr).pcm);
  assertMetrics(encoded,alternating,decodeBrr(encoded.brr).pcm);
});

test('BRR encoder zero-pads one-shots explicitly and measures only source frames',()=>{
  const source=Float32Array.from({length:19},(_,i)=>.53*Math.sin(i*.21)),copy=source.slice();
  const encoded=encodeBrr(source),padded=new Float32Array(32);padded.set(source);
  assert.equal(encoded.sourceFrames,19);assert.equal(encoded.frames,32);assert.equal(encoded.paddingFrames,13);assert.equal(encoded.loopStartSamples,null);
  assert.deepEqual(encoded.brr,encodeBrr(padded).brr,'padding is zero PCM, not a repeated tail');
  assert.deepEqual(source,copy);assertMetrics(encoded,source,assertHeaders(encoded).pcm);
  const prepared=prepareSnesBRR(encoded.brr,{rootNote:69});assert.equal(prepared.frames,32);assert.equal(prepared.loop,false);
  for(const frames of [1,15,16,17,31,32,33]) {
    const result=encodeBrr(new Float32Array(frames));assert.equal(result.sourceFrames,frames);
    assert.equal(result.frames,Math.ceil(frames/16)*16);assert.equal(result.paddingFrames,result.frames-frames);assertHeaders(result);
  }
});

test('BRR encoder reports lossy raw-PCM quality on sine, voice-like and drum signals',t=>{
  // Broad regression bounds in normalized full-scale units, not universal
  // perceptual claims: transients/noise are intentionally allowed more error.
  const limits={sine:{rms:.015,snr:29},voice:{rms:.008,snr:30},drum:{rms:.025,snr:14}};
  for(const [name,source] of Object.entries(fixtures())) {
    const encoded=encodeBrr(source),decoded=assertHeaders(encoded),quality=assertMetrics(encoded,source,decoded.pcm);
    assert.ok(quality.mse>0,`${name} is a lossy conversion`);
    assert.ok(quality.rmsError<limits[name].rms,`${name} RMS error ${quality.rmsError}`);
    assert.ok(quality.snrDb>limits[name].snr,`${name} SNR ${quality.snrDb} dB`);
    assert.ok(quality.maxError<.125,`${name} has no large raw PCM spike`);
    assert.deepEqual(encoded,encodeBrr(source),`${name} encoding is deterministic, including metrics`);
    assert.ok(Array.from({length:encoded.blockCount-1},(_,i)=>(encoded.brr[(i+1)*9]>>2)&3).some(Boolean),'predictor filters are exercised');
    t.diagnostic(`${name}: raw RMS=${quality.rmsError.toFixed(6)}, max=${quality.maxError.toFixed(6)}, SNR=${quality.snrDb.toFixed(2)} dB`);
  }
});

test('BRR loops preserve exact boundaries and reconstruct identically on every lap',()=>{
  for(const loopStartSamples of [0,16,128]) {
    const source=Float32Array.from({length:256},(_,i)=>.63*Math.sin(2*Math.PI*i/64)),encoded=encodeBrr(source,{loopStartSamples});
    assert.equal(encoded.sourceFrames,256);assert.equal(encoded.paddingFrames,0);assert.equal(encoded.loopStartSamples,loopStartSamples);
    const first=assertHeaders(encoded,{loop:true,loopStartSamples}),body=encoded.brr.subarray(loopStartSamples/16*9);
    const second=decodeBrr(body,{history:first.finalHistory}),third=decodeBrr(body,{history:second.finalHistory});
    const expected=first.pcm16.subarray(loopStartSamples);
    assert.deepEqual(second.pcm16,expected);assert.deepEqual(third.pcm16,expected);
    assert.deepEqual(decodeBrr(body,{history:[32767,-32768]}).pcm16,expected,'loop entry ignores foreign predictor history');
    assert.deepEqual(decodeBrr(encoded.brr,{history:[-32768,32767]}).pcm16,first.pcm16,'sample entry ignores foreign predictor history');
    const prepared=prepareSnesBRR(encoded.brr,{rootNote:69,loopStartSamples});assert.equal(prepared.loopStartSamples,loopStartSamples);
  }
});

test('BRR encoder validates mono PCM and aligned loops without mutating caller memory',()=>{
  for(const value of [undefined,null,{},[],[0],new Float64Array(16),new Int16Array(16),new ArrayBuffer(64),new DataView(new ArrayBuffer(64))])assert.throws(()=>encodeBrr(value),TypeError);
  assert.throws(()=>encodeBrr(new Float32Array()),RangeError);
  for(const value of [NaN,Infinity,-Infinity,1.01,-1.01]) {
    const source=new Float32Array(32);source[31]=value;const before=new Uint8Array(source.buffer).slice();
    assert.throws(()=>encodeBrr(source),RangeError);assert.deepEqual(new Uint8Array(source.buffer),before);
  }
  const backing=new Float32Array(36).fill(NaN),source=backing.subarray(2,34);source.set(fixtures().sine.subarray(0,32));
  const original=new Uint8Array(backing.buffer).slice(),result=encodeBrr(source);
  assert.deepEqual(result.brr,encodeBrr(source.slice()).brr,'only the requested view is read');assert.deepEqual(new Uint8Array(backing.buffer),original);
  result.brr.fill(255);assert.deepEqual(new Uint8Array(backing.buffer),original,'BRR output does not alias PCM');
  const aligned=new Float32Array(32);
  for(const loopStartSamples of [-1,1,15,17,32,48,1.5,NaN,Infinity,'0'])assert.throws(()=>encodeBrr(aligned,{loopStartSamples}),RangeError);
  assert.throws(()=>encodeBrr(new Float32Array(17),{loopStartSamples:0}),RangeError,'looping length is never silently padded');
  for(const options of [null,[],42,'x'])assert.throws(()=>encodeBrr(aligned,options),TypeError);
  assert.throws(()=>encodeBrr(aligned,{sampleRate:44100}),TypeError,'unsupported resampling options are not silently accepted');
  assert.deepEqual(encodeBrr(aligned,{loopStartSamples:undefined}),encodeBrr(aligned));
  const extremes=Float32Array.from({length:32},(_,i)=>i&1?1:-1);assertHeaders(encodeBrr(extremes));
});

test('BRR encoder honors byte budgets before conversion and fits empty SnesSynth RAM by default',()=>{
  for(const maxBytes of [0,8,8.5,-1,65537,Infinity,NaN,'18'])assert.throws(()=>encodeBrr(new Float32Array(16),{maxBytes}),RangeError);
  assert.equal(encodeBrr(new Float32Array(16),{maxBytes:9}).brr.length,9);
  assert.equal(encodeBrr(new Float32Array(32),{maxBytes:18}).brr.length,18);
  assert.throws(()=>encodeBrr(new Float32Array(17),{maxBytes:17}),RangeError);
  assert.throws(()=>encodeBrr(new Float32Array(33),{maxBytes:18}),RangeError);
  const maxFrames=64512/9*16,largest=encodeBrr(new Float32Array(maxFrames));
  assert.equal(largest.brr.length,64512);assert.equal(largest.sourceFrames,maxFrames);
  assert.throws(()=>encodeBrr(new Float32Array(maxFrames+1)),RangeError,'default budget reserves the 1 KiB sample directory');
  assert.equal(encodeBrr(new Float32Array(maxFrames+1),{maxBytes:65536}).brr.length,64521,'explicit raw-RAM budget may exceed the synth allocator');
});

const root=fileURLToPath(new URL('../',import.meta.url));
async function nativeReferences(t) {
  const compiler=process.env.CXX||'c++',probe=spawnSync(compiler,['--version'],{encoding:'utf8'});
  if(probe.error?.code==='ENOENT'){t.skip('C++ compiler unavailable; native S-DSP reference not run');return null;}
  assert.equal(probe.status,0,probe.stderr);
  const temp=await mkdtemp(join(tmpdir(),'tetorica-brr-encoder-'));t.after(()=>rm(temp,{recursive:true,force:true}));
  const include=join(root,'third_party/snes-spc/snes_spc'),raw=join(temp,'raw'),audio=join(temp,'audio'),audioSource=join(temp,'audio.cpp');
  // This driver only transports reset/RAM/register/render commands to the
  // actual vendored DSP. It contains no BRR decoding or audio arithmetic.
  await writeFile(audioSource,`#include "SPC_DSP.h"
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
static unsigned read_le(unsigned count) {
  unsigned value=0;for(unsigned i=0;i<count;i++){int c=std::getchar();if(c==EOF)std::exit(2);value|=unsigned(c)<<(8*i);}return value;
}
int main() {
  unsigned char ram[65536]={};SPC_DSP dsp;dsp.init(ram);short pcm[2048];
  unsigned commands=read_le(4);
  while(commands--) {
    unsigned op=read_le(1);
    if(op==0){std::memset(ram,0,sizeof ram);dsp.reset();}
    else if(op==1){unsigned at=read_le(4),size=read_le(4);if(at+size>65536)return 2;for(unsigned i=0;i<size;i++)ram[at+i]=read_le(1);}
    else if(op==2){unsigned reg=read_le(1),value=read_le(1);dsp.write(reg,value);}
    else if(op==3){unsigned frames=read_le(4);while(frames){unsigned count=std::min(frames,1024u);std::memset(pcm,0,sizeof pcm);dsp.set_output(pcm,count*2);dsp.run(count*32);for(unsigned i=0;i<count*2;i++){unsigned value=(unsigned short)pcm[i];std::putchar(value&255);std::putchar(value>>8);}frames-=count;}}
    else return 2;
  }
  return std::ferror(stdout)?4:0;
}
`);
  for(const [source,binary,extra] of [[join(root,'test/helpers/snes_brr_reference.cpp'),raw,[]],[audioSource,audio,[join(include,'SPC_DSP.cpp')]]]) {
    const build=spawnSync(compiler,['-std=c++11','-O2','-fwrapv','-I'+include,source,...extra,'-o',binary],{encoding:'utf8'});
    assert.equal(build.status,0,build.stderr);
  }
  return {raw,audio};
}
const u32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
const pcm16Buffer=pcm=>{const b=Buffer.alloc(pcm.length*2);pcm.forEach((value,i)=>b.writeInt16LE(value,i*2));return b;};
let wasmAssets;
async function createModule() {
  const [factory,wasmBinary]=await (wasmAssets??=Promise.all([import('../docs/generated/spc_wasm.js').then(m=>m.default),readFile(new URL('../docs/generated/spc_wasm.wasm',import.meta.url))]));
  return factory({wasmBinary});
}
function render(synth,frames,partitions=[frames]) {
  const left=new Float32Array(frames),right=new Float32Array(frames);let offset=0,p=0;
  while(offset<frames){const count=Math.min(partitions[p++%partitions.length],frames-offset);synth.renderInto(left,right,count,offset);offset+=count;}
  assert.ok(left.every(n=>Number.isFinite(n)&&n>=-1&&n<=1));assert.ok(right.every(n=>Number.isFinite(n)&&n>=-1&&n<=1));
  return {left,right};
}
const peak=pcm=>pcm.reduce((max,n)=>Math.max(max,Math.abs(n)),0);

test('encoded BRR matches actual native S-DSP raw decoding and post-Gaussian WASM playback',async t=>{
  const binaries=await nativeReferences(t);if(!binaries)return;
  const sources=Object.values(fixtures());sources.push(Float32Array.from({length:19},(_,i)=>i&1?.25:-.25));
  const cases=sources.map(source=>encodeBrr(source));cases.push(encodeBrr(fixtures().sine,{loopStartSamples:128}));
  const inputs=[u32(cases.length)],expected=[];
  for(const encoded of cases) {
    const history=Buffer.alloc(4);history.writeInt16LE(32767,0);history.writeInt16LE(-32768,2);
    inputs.push(u32(encoded.blockCount),history,encoded.brr);
    expected.push(pcm16Buffer(decodeBrr(encoded.brr,{history:[32767,-32768]}).pcm16));
  }
  const raw=spawnSync(binaries.raw,[],{input:Buffer.concat(inputs),maxBuffer:1024*1024});assert.equal(raw.status,0,raw.stderr?.toString());
  assert.deepEqual(raw.stdout,Buffer.concat(expected),'bit-exact pre-Gaussian PCM from actual SPC_DSP::decode_brr');

  const module=await createModule(),core=await SnesDspCore.create({moduleFactory:async()=>module});t.after(()=>core.dispose());
  const commands=[],stereo=[];
  const recorded={get nativeFrames(){return core.nativeFrames;},
    reset(){commands.push(Buffer.from([0]));core.reset();},
    loadRam(bytes,address=0){commands.push(Buffer.concat([Buffer.from([1]),u32(address),u32(bytes.length),bytes]));core.loadRam(bytes,address);},
    writeDsp(reg,value){commands.push(Buffer.from([2,reg,value]));core.writeDsp(reg,value);},
    renderInto(left,right,frames,offset=0){commands.push(Buffer.concat([Buffer.from([3]),u32(frames)]));core.renderInto(left,right,frames,offset);for(let i=offset;i<offset+frames;i++)stereo.push(left[i]*32768,right[i]*32768);},
  };
  const synth=new SnesSynth({core:recorded});
  for(const encoded of cases) {
    synth.reset();const options={rootNote:69,...(encoded.loopStartSamples===null?{}:{loopStartSamples:encoded.loopStartSamples})};
    const sample=synth.loadBRR(encoded.brr,options);synth.setPreset(0,{sample,volumeLeft:100,volumeRight:-73});synth.noteOn(0,69);
    const sounding=render(synth,4096,[1,127,53,1024]);assert.ok(peak(sounding.left)>.01);assert.notDeepEqual(sounding.left,sounding.right);
    synth.keyOff(0);render(synth,2048,[17,128]);assert.equal(peak(render(synth,64).left),0,'hardware KOFF reaches silence');
  }
  const audio=spawnSync(binaries.audio,[],{input:Buffer.concat([u32(commands.length),...commands]),maxBuffer:1024*1024});assert.equal(audio.status,0,audio.stderr?.toString());
  assert.deepEqual(audio.stdout,pcm16Buffer(stereo),'encoded one-shots/loop, KON, KOFF and resets produce exactly the same actual native/WASM stereo');
});

test('encoding leaves live S-DSP instances unchanged; encoded samples survive reset and dispose is isolated',async t=>{
  const module=await createModule(),a=await SnesDspCore.create({moduleFactory:async()=>module}),b=await SnesDspCore.create({moduleFactory:async()=>module});
  t.after(()=>{a.dispose();b.dispose();});const sa=new SnesSynth({core:a}),sb=new SnesSynth({core:b});
  const source=fixtures().sine,encoded=encodeBrr(source,{loopStartSamples:0});
  const load=synth=>{const sample=synth.loadBRR(encoded.brr,{rootNote:69,loopStartSamples:0});synth.setPreset(0,{sample});synth.noteOn(0,69);return sample;};
  const sample=load(sa);load(sb);const onset=render(sa,1024,[1,127]);assert.deepEqual(onset,render(sb,1024));assert.ok(peak(onset.left)>.01);
  const before=a.snapshot(),state=sa.getState();encodeBrr(fixtures().drum);assert.deepEqual(a.snapshot(),before);assert.deepEqual(sa.getState(),state);
  assert.deepEqual(render(sa,1024),render(sb,1024,[17,53,128]),'pure conversion neither advances nor replaces the sounding DSP');
  sa.keyOff(0);render(sa,2048);assert.equal(peak(render(sa,64).left),0);assert.ok(peak(render(sb,64).left)>.01,'KOFF releases only its instance');
  sa.reset();assert.equal(a.nativeFrames,0);assert.equal(sa.getState().samples.length,1);assert.equal(sa.getPreset(0).sample,null);
  assert.deepEqual(a.snapshot().ram.subarray(sample.startAddress,sample.startAddress+encoded.brr.length),encoded.brr);
  sa.setPreset(0,{sample});sa.noteOn(0,69);assert.deepEqual(render(sa,1024),onset,'reset and reassign reproduce the same accurate-core onset');
  a.dispose();a.dispose();assert.throws(()=>render(sa,1),/disposed/);assert.ok(peak(render(sb,1024).left)>.01,'disposing a handle leaves another core playing');
});
