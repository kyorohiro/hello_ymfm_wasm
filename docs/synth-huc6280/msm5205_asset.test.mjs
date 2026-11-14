// Actual shared WASM decode into inert arrays; no AudioContext or speaker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createMSM5205PCM} from '../js/msm5205_pcm.js';
import {prepareMSM5205Sample} from '../js/msm5205_sample.js';
import {prepareMsm5205Asset,MSM5205_ASSET_WAVE_SAMPLE_RATE,MSM5205_ASSET_WAVE_BINS,
  MSM5205_ASSET_MAX_WAVE_FRAMES} from './msm5205_asset.js';

const wasmBinary=await readFile(new URL('../generated/msm5205_wasm.wasm',import.meta.url));
const options={wasmBinary,yieldTask:async()=>{}};
function wav(channels,sampleRate=8000) {
  const frames=channels[0].length,count=channels.length,bytes=new Uint8Array(44+frames*count*2),view=new DataView(bytes.buffer);
  for(const [offset,text]of[[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])bytes.set(new TextEncoder().encode(text),offset);
  view.setUint32(4,bytes.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,count,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*count*2,true);view.setUint16(32,count*2,true);view.setUint16(34,16,true);view.setUint32(40,frames*count*2,true);
  for(let i=0;i<frames;i++)for(let ch=0;ch<count;ch++)view.setInt16(44+(i*count+ch)*2,Math.round(Math.max(-1,Math.min(32767/32768,channels[ch][i]))*32768),true);
  return bytes;
}

test('packed high-first ADPCM retains source bytes and its actual decoded points, without any AudioContext',async()=>{
  const previous=globalThis.AudioContext;let audioConstructions=0;
  globalThis.AudioContext=class{constructor(){audioConstructions++;throw Error('Unexpected audio device');}};
  try {
    const wrapped=Uint8Array.of(255,0x70,0x8f,255),source=wrapped.subarray(1,3),original=source.slice();
    const asset=await prepareMsm5205Asset(source,{...options,format:'adpcm',rate:15,name:'raw\n sample',path:'/audio/source.adpcm'});
    assert.deepEqual(asset.data,original);assert.notEqual(asset.data.buffer,wrapped.buffer);assert.deepEqual(source,original);
    assert.deepEqual(asset.info,{name:'raw  sample',path:'/audio/source.adpcm',format:'adpcm',bytes:2,frames:4,paddedFrames:4,rate:15,sampleRate:32000,duration:4/32000,paddedDuration:4/32000});
    assert.equal(asset.wave.sampleRate,32000);assert.equal(asset.wave.frames,4);assert.equal(asset.wave.bins.length,4);
    assert.equal(asset.wave.bins[0].min,30/2048,'the first encoded nibble is 7, not low nibble 0');
    const core=await createMSM5205PCM({sampleRate:32000,wasmBinary});
    try {
      core.prepare(original);core.play({rate:15});const left=new Float32Array(4),right=new Float32Array(4);core.render(left,right);
      assert.deepEqual(asset.wave.bins,left.map(value=>value).reduce((bins,value)=>[...bins,{min:value,max:value}],[]));
      assert.equal(asset.wave.peak,Math.max(...left.map(Math.abs)));assert.deepEqual(left,right);
    }finally{core.dispose();}
    source.fill(0);assert.deepEqual(asset.data,original,'later caller edits cannot change the prepared source');
    assert(Object.isFrozen(asset));assert(Object.isFrozen(asset.info));assert(Object.isFrozen(asset.wave));assert(Object.isFrozen(asset.wave.bins));assert(asset.wave.bins.every(Object.isFrozen));
    assert.equal(audioConstructions,0);
  }finally{if(previous===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=previous;}
});

test('WAV and decoded PCM reuse shared encoding, distinguish odd padding and display only the played source frames',async()=>{
  const input=wav([[.25,.5,-.5,0,.125],[-.25,.5,-.5,0,-.125]]),before=input.slice();
  const expected=await prepareMSM5205Sample(input,{rate:12});
  const asset=await prepareMsm5205Asset(input,{...options,format:'wav',rate:12,name:'five frames'});
  assert.deepEqual(input,before);assert.deepEqual(asset.data,expected.data);
  assert.equal(asset.info.frames,5);assert.equal(asset.info.paddedFrames,6);assert.equal(asset.info.bytes,3);
  assert.equal(asset.info.duration,5/8000);assert.equal(asset.info.paddedDuration,6/8000);assert.equal(asset.wave.frames,20);
  assert.equal(asset.wave.bins.length,20);
  const pcm={channels:[Float32Array.of(.1,.2,-.3)],sampleRate:8000};
  const fromPCM=await prepareMsm5205Asset(pcm,{...options,rate:12});
  assert.deepEqual(fromPCM.data,(await prepareMSM5205Sample(pcm)).data);assert.equal(fromPCM.info.frames,3);assert.equal(fromPCM.info.paddedFrames,4);
  const raw=await prepareMsm5205Asset(asset.data,{...options,format:'adpcm',rate:12});
  assert.equal(raw.info.frames,6);assert.equal(raw.wave.frames,24,'raw files have no separate odd-frame metadata');
});

test('quiet and loud WAVs show the actual encoded dynamics, and compact bins retain every extremum',async()=>{
  const tone=amplitude=>({channels:[Float32Array.from({length:4000},(_,i)=>amplitude*Math.sin(i*Math.PI/19))],sampleRate:8000});
  const quiet=await prepareMsm5205Asset(tone(.02),options),loud=await prepareMsm5205Asset(tone(.65),options);
  assert(quiet.wave.peak<.04);assert(loud.wave.peak>.5);assert(loud.wave.peak>quiet.wave.peak*10);
  assert.equal(loud.wave.bins.length,MSM5205_ASSET_WAVE_BINS);
  const core=await createMSM5205PCM({sampleRate:32000,wasmBinary});
  try {
    core.prepare(loud.data);core.play({length:loud.info.frames,rate:12});
    const left=new Float32Array(loud.wave.frames),right=new Float32Array(left.length);core.render(left,right);
    const expected=Array.from({length:512},()=>({min:Infinity,max:-Infinity}));
    for(let i=0;i<left.length;i++){const bin=expected[Math.floor(i*expected.length/left.length)];bin.min=Math.min(bin.min,left[i]);bin.max=Math.max(bin.max,left[i]);}
    assert.deepEqual(loud.wave.bins,expected);assert.equal(loud.wave.peak,Math.max(...expected.map(bin=>Math.max(Math.abs(bin.min),Math.abs(bin.max)))));
  }finally{core.dispose();}
});

test('all sixteen hardware rates use exact Hz, duration and complete decoding intervals',async()=>{
  for(let rate=0;rate<16;rate++) {
    const asset=await prepareMsm5205Asset(Uint8Array.of(0x78),{...options,format:'adpcm',rate});
    assert.equal(asset.info.sampleRate,32000/(16-rate));assert(Math.abs(asset.info.duration-2*(16-rate)/32000)<1e-16);
    assert.equal(asset.wave.frames,2*(16-rate));assert.equal(asset.wave.sampleRate,MSM5205_ASSET_WAVE_SAMPLE_RATE);
    assert.equal(asset.wave.bins[0].min,30/2048);assert.equal(asset.wave.bins.at(-1).max,asset.wave.bins.at(-1).min);
  }
});

test('64 KiB packed data produces only bounded waveform bins even at the slowest rate',async()=>{
  const source=new Uint8Array(65536).fill(0x78),asset=await prepareMsm5205Asset(source,{...options,format:'adpcm',rate:0});
  assert.equal(asset.data.length,65536);assert.equal(asset.info.frames,131072);assert.equal(asset.info.duration,65.536);
  assert.equal(asset.wave.frames,MSM5205_ASSET_MAX_WAVE_FRAMES);assert.equal(asset.wave.frames,2097152);
  assert.equal(asset.wave.bins.length,512);assert(asset.wave.bins.every(bin=>Number.isFinite(bin.min)&&Number.isFinite(bin.max)&&bin.min<=bin.max));
  assert(asset.wave.peak<=1);assert.deepEqual(source,asset.data);
});

test('format, rate, source shape and size errors never reinterpret malformed WAV as packed ADPCM',async()=>{
  for(const data of [new Uint8Array(),new Uint8Array(65537)])await assert.rejects(prepareMsm5205Asset(data,{...options,format:'adpcm'}),/1\.\.65536/);
  for(const data of [[],{channels:[[0]],sampleRate:8000},'/audio/test.adpcm'])await assert.rejects(prepareMsm5205Asset(data,{...options,format:'adpcm'}),/ADPCM/);
  for(const rate of [-1,16,1.5,NaN])await assert.rejects(prepareMsm5205Asset(Uint8Array.of(0),{...options,format:'adpcm',rate}),/rate/);
  await assert.rejects(prepareMsm5205Asset(Uint8Array.of(0x78),{...options,format:'wav'}),/RIFF WAV|decodeAudio/);
  await assert.rejects(prepareMsm5205Asset(wav([[0,.1]]).subarray(0,45),options),/Truncated WAV/);
  const bad=wav([[0]]);new DataView(bad.buffer).setUint16(20,6,true);
  await assert.rejects(prepareMsm5205Asset(bad,options),/Supported WAV/);
  await assert.rejects(prepareMsm5205Asset({channels:[new Float32Array(131073)],sampleRate:8000},options),/64 KiB/);
  await assert.rejects(prepareMsm5205Asset({channels:[[0,NaN]],sampleRate:8000},options),/Nonfinite/);
  await assert.rejects(prepareMsm5205Asset(Uint8Array.of(0),{...options,format:'auto'}),/format/);
});

test('cancellation before work, before conversion and during bounded actual decode discards the candidate',async()=>{
  const early=new AbortController();early.abort();
  await assert.rejects(prepareMsm5205Asset(Uint8Array.of(0),{...options,format:'adpcm',signal:early.signal}),{name:'AbortError'});
  const beforeConvert=new AbortController();let starts=0;
  await assert.rejects(prepareMsm5205Asset(wav([[0,.1]]),{...options,signal:beforeConvert.signal,yieldTask:async()=>{starts++;beforeConvert.abort();}}),{name:'AbortError'});assert.equal(starts,1);
  const during=new AbortController(),source=new Uint8Array(4096).fill(0x78),original=source.slice();let yields=0;
  await assert.rejects(prepareMsm5205Asset(source,{...options,format:'adpcm',rate:0,signal:during.signal,yieldTask:async()=>{if(++yields===2)during.abort();}}),{name:'AbortError'});
  assert.equal(yields,2);assert.deepEqual(source,original);
  const next=await prepareMsm5205Asset(Uint8Array.of(0x70),{...options,format:'adpcm',rate:15});
  assert.equal(next.wave.bins[0].min,30/2048,'a cancelled decode leaves no shared decoder state behind');
});

test('Code may explicitly supply its existing decoder, while the asset helper itself constructs no audio device',async()=>{
  const source=Uint8Array.of(1,2,3),pcm={channels:[Float32Array.of(.1,-.2,.3)],sampleRate:8000};let decodes=0;
  const result=await prepareMsm5205Asset(source,{...options,decodeAudio:async bytes=>{assert.deepEqual(new Uint8Array(bytes),source);decodes++;return pcm;}});
  assert.equal(decodes,1);assert.equal(result.info.frames,3);assert.deepEqual(result.data,(await prepareMSM5205Sample(pcm)).data);
  const controller=new AbortController();
  await assert.rejects(prepareMsm5205Asset(source,{...options,signal:controller.signal,decodeAudio:async()=>{controller.abort();return pcm;}}),{name:'AbortError'});
});

test('trusted fixed decoder fetch survives Code network guards without accepting arbitrary source URLs',async()=>{
  const previous=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),signal:init?.signal});return {ok:true,arrayBuffer:async()=>wasmBinary.buffer.slice(wasmBinary.byteOffset,wasmBinary.byteOffset+wasmBinary.byteLength)};};
  try {
    const {prepareMsm5205Asset:trusted}=await import('./msm5205_asset.js?trusted-fetch-regression');
    globalThis.fetch=()=>{throw Error('User Code network disabled');};
    const controller=new AbortController();
    const result=await trusted(Uint8Array.of(0x70),{format:'adpcm',rate:15,signal:controller.signal,yieldTask:async()=>{}});
    assert.equal(result.wave.bins[0].min,30/2048);assert.equal(requests.length,1);
    assert(requests[0].url.endsWith('/generated/msm5205_wasm.wasm'));assert.equal(requests[0].signal,controller.signal);
    await assert.rejects(trusted('https://example.test/sample.adpcm',{format:'adpcm'}),/ADPCM/);
    assert.equal(requests.length,1,'source metadata never becomes a fetch URL');
  }finally{globalThis.fetch=previous;}
});
