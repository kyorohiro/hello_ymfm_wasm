import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readSamplePCM, encodeAdpcmB} from './adpcm_b_sample.js';
import {YM2608Synth, YM2608DirectTransport} from './ym2608synth.js';
import {Ym2608} from './ym2608.js';
import {OPNWorkletTransport} from './opn_fm_synth.js';

function wav(type, bits, samples = [-0.5, 0, 0.5]) {
  const bytes = new Uint8Array(44 + samples.length * bits / 8), v = new DataView(bytes.buffer);
  for (const [offset, text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']]) bytes.set([...text].map(c => c.charCodeAt(0)), offset);
  v.setUint32(4, bytes.length - 8, true); v.setUint32(16, 16, true);
  v.setUint16(20,type,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);
  v.setUint32(28,8000*bits/8,true);v.setUint16(32,bits/8,true);v.setUint16(34,bits,true);v.setUint32(40,bytes.length-44,true);
  samples.forEach((x,i) => {
    const offset = 44+i*bits/8;
    if(type===3) bits===32?v.setFloat32(offset,x,true):v.setFloat64(offset,x,true);
    else if(bits===8)v.setUint8(offset,Math.round(x*128+128));
    else if(bits===16)v.setInt16(offset,x*32768,true);
    else if(bits===32)v.setInt32(offset,x*2147483648,true);
    else { const n=x*8388608;bytes[offset]=n;bytes[offset+1]=n>>8;bytes[offset+2]=n>>16; }
  });
  return bytes;
}

for(const [type,bits] of [[1,8],[1,16],[1,24],[1,32],[3,32],[3,64]])test(`WAV ${type}/${bits}: decode samples and offset views`,async()=>{
  const bytes=wav(type,bits),wrapped=new Uint8Array(bytes.length+10);wrapped.set(bytes,5);
  const pcm=await readSamplePCM(wrapped.subarray(5,5+bytes.length));
  assert.equal(pcm.sampleRate,8000);assert.deepEqual([...pcm.channels[0]],[-.5,0,.5]);
});
test('WAV: path, file URL, Blob, URL response and injected decoder',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'adpcm-sample-'));
  try {
    const file=join(folder,'voice.wav');await writeFile(file,wav(1,16));
    for(const source of [file,new URL('file://'+file),new Blob([wav(1,16)]),
      'data:audio/wav;base64,'+Buffer.from(wav(1,16)).toString('base64')]) {
      const pcm=await readSamplePCM(source);assert.deepEqual([...pcm.channels[0]],[-.5,0,.5]);
    }
    const pcm=await readSamplePCM(new Uint8Array([1]),{decodeAudio:async()=>({channels:[[.2]],sampleRate:8000})});
    assert.equal(pcm.channels[0][0],.2);
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('encoder: silence, stereo cancellation, resampling and alignment',()=>{
  const a=encodeAdpcmB({channels:[new Float32Array(100)],sampleRate:8000},16000);
  assert.equal(a.frames,200);assert.equal(a.paddedFrames,256);assert.equal(a.bytes.length,128);
  const b=encodeAdpcmB({channels:[[.5,.5],[-.5,-.5]],sampleRate:8000},8000);
  assert.deepEqual(b.bytes,encodeAdpcmB({channels:[[0,0]],sampleRate:8000},8000).bytes);
  assert.throws(()=>encodeAdpcmB({channels:[[NaN]],sampleRate:8000},8000),/Nonfinite/);
});
test('loadSample: validates before writes, awaits transfer and selects without playing',async()=>{
  const writes=[],order=[];let bytes;
  const synth=new YM2608Synth({transport:{write:(port,register,value)=>writes.push([port,register,value]),
    async loadAdpcmMemory(value,address){await Promise.resolve();bytes=value;order.push(address);}}});
  writes.length=0;
  for(const options of [{address:1},{sampleRate:100000},{address:0x1fffe0}]) {
    await assert.rejects(synth.adpcm.loadSample({channels:[new Float32Array(128)],sampleRate:8000},options));
    assert.equal(writes.length,0);
  }
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(synth.adpcm.loadSample(wav(1,16),{signal:cancelled.signal}));assert.equal(writes.length,0);
  const sample=await synth.adpcm.loadSample({channels:[new Float32Array(65)],sampleRate:8000},{address:32});
  assert.deepEqual(order,[32]);assert.equal(sample.start,32);assert.equal(sample.end,96);
  assert.equal(bytes.length,64);assert.equal(sample.paddedFrames,128);
  assert.ok(writes.every(([port,reg,value])=>port===1&&(reg!==0||value===1)),'must not key on');
  const audioBuffer={numberOfChannels:1,sampleRate:8000,getChannelData:()=>new Float32Array(64)};
  await synth.adpcm.loadSample(audioBuffer);
});
test('WAV rejects truncated chunks, missing format and nonfinite float PCM',async()=>{
  await assert.rejects(readSamplePCM(wav(1,16).subarray(0,45)),/Truncated/);
  const missing=wav(1,16);missing.set([74,85,78,75],12);
  await assert.rejects(readSamplePCM(missing),/requires/);
  const pcm=await readSamplePCM(wav(3,32,[NaN]));
  assert.throws(()=>encodeAdpcmB(pcm,8000),/Nonfinite/);
});
test('Worklet memory: await matching acknowledgement, propagate error and reject on dispose',async()=>{
  let receiver;const messages=[];
  const port={postMessage:value=>messages.push(value),addEventListener:(_type,fn)=>{receiver=fn;},removeEventListener(){}};
  const transport=new OPNWorkletTransport({port},{chipName:'YM2608',portCount:2});
  const first=transport.loadAdpcmMemory(new Uint8Array(32),64);
  receiver({data:{type:'adpcm-memory-loaded',id:999}});
  assert.equal(transport.memoryRequests.size,1);
  receiver({data:{type:'adpcm-memory-loaded',id:messages[0].id}});await first;
  const second=transport.loadAdpcmMemory(new Uint8Array(32),64);
  receiver({data:{type:'adpcm-memory-loaded',id:messages[1].id,error:'upload failed'}});
  await assert.rejects(second,/upload failed/);
  const third=transport.loadAdpcmMemory(new Uint8Array(32),64);transport.dispose();
  await assert.rejects(third,/disposed/);
  await assert.rejects(transport.loadAdpcmMemory(new Uint8Array(32)),/disposed/);
  assert.equal(transport.memoryRequests.size,0);
});
test('real YM2608: encoded sine reproduces frequency and stops after the padded range',async()=>{
  const {default:moduleFactory}=await import('../docs/generated/ym2608_wasm.js');
  const chip=await Ym2608.create({moduleFactory,moduleOptions:{wasmBinary:await readFile(new URL('../docs/generated/ym2608_wasm.wasm',import.meta.url))}});
  try {
    const synth=new YM2608Synth({transport:new YM2608DirectTransport(chip)});
    const input=Float32Array.from({length:1600},(_,i)=>.6*Math.sin(i*2*Math.PI*440/8000));
    const sample=await synth.adpcm.loadSample({channels:[input],sampleRate:8000},{address:64});
    assert.equal(sample.frames,1600);assert.ok(Math.abs(sample.sampleRate-8000)<1);
    synth.adpcm.setPan(true,false);synth.adpcm.setVolume(255);synth.adpcm.keyOn();
    const rate=chip.sampleRate(),pcm=chip.generateStereo(Math.round(rate*.15));
    assert.ok(pcm.left.some(x=>Math.abs(x)>.01));assert.ok(pcm.right.every(x=>x===0));
    let best=0;
    for(let phase=0;phase<20;phase++) {
      let dot=0,energy=0,reference=0;
      for(let i=10000;i<pcm.left.length;i+=25){const x=pcm.left[i],y=Math.sin(i*2*Math.PI*440*sample.sampleRate/8000/rate+phase*Math.PI/10);dot+=x*y;energy+=x*x;reference+=y*y;}
      best=Math.max(best,Math.abs(dot)/Math.sqrt(energy*reference));
    }
    assert.ok(best>.95,`sine correlation ${best}`);
    chip.generateStereo(Math.round(rate*.1));
    assert.ok(chip.generateStereo(1000).left.every(x=>x===0));
  }finally{chip.dispose();}
});
