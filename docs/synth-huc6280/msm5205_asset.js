// SPDX-License-Identifier: BSD-3-Clause
// Passive sample preparation and actual shared-core waveform observation.
// No AudioContext, AudioBuffer allocation, clock, worklet or speaker route.
import {prepareMSM5205Sample,MSM5205_MAX_SAMPLE_BYTES} from '../js/msm5205_sample.js';
import {createMSM5205PCM,MSM5205_PCM_DEFAULT_CLOCK} from '../js/msm5205_pcm.js';
import {MSM5205_WASM_URL} from '../generated/msm5205_wasm.js';

export const MSM5205_ASSET_WAVE_SAMPLE_RATE=32000;
export const MSM5205_ASSET_WAVE_BINS=512;
export const MSM5205_ASSET_MAX_WAVE_FRAMES=MSM5205_MAX_SAMPLE_BYTES*2*16;
const CHUNK=4096;
// This trusted host fetch is limited to the shipped decoder, so Code's user
// network guard cannot block its own implementation assets. No URL is accepted
// from source metadata. Cancellation belongs to this operation, not a shared
// fetch promise that could poison a newer load.
const nativeFetch=globalThis.fetch?.bind(globalThis);
const nativeSetTimeout=globalThis.setTimeout.bind(globalThis);
const yieldToHost=()=>new Promise(resolve=>nativeSetTimeout(resolve,0));
const cleanName=value=>value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g,' ').trim().slice(0,120)||'MSM5205 sample';

async function rawBytes(source,signal) {
  if(typeof Blob!=='undefined'&&source instanceof Blob) {
    if(source.size<1||source.size>MSM5205_MAX_SAMPLE_BYTES)throw new RangeError('MSM5205 requires 1..65536 bytes of packed ADPCM');
    source=await source.arrayBuffer();signal?.throwIfAborted();
  }
  if(!(source instanceof ArrayBuffer)&&!(source instanceof Uint8Array))throw new TypeError('Packed MSM5205 ADPCM must be ArrayBuffer, Uint8Array or Blob bytes');
  if(source.byteLength<1||source.byteLength>MSM5205_MAX_SAMPLE_BYTES)throw new RangeError('MSM5205 requires 1..65536 bytes of packed ADPCM');
  return source instanceof Uint8Array?new Uint8Array(source):new Uint8Array(source.slice(0));
}

/** Observe every decoded nibble with the same C/WASM renderer as live playback.
 * At 32 kHz, the fixed 1.536 MHz PCE clock makes each nibble last exactly
 * (16-rate) output samples. Thus even rate 15 retains every decoded point.
 * Bins cover only source frames: an encoder's odd padding nibble is excluded.
 */
async function waveform(data,frames,rate,{signal,wasmBinary,yieldTask}) {
  const outputFrames=frames*(16-rate);
  if(!Number.isSafeInteger(outputFrames)||outputFrames<1||outputFrames>MSM5205_ASSET_MAX_WAVE_FRAMES)throw new RangeError('MSM5205 waveform exceeds its bounded sample count');
  const bins=Array.from({length:Math.min(MSM5205_ASSET_WAVE_BINS,outputFrames)},()=>({min:Infinity,max:-Infinity}));
  const left=new Float32Array(Math.min(CHUNK,outputFrames)),right=new Float32Array(left.length);
  let core,peak=0;
  try {
    if(!wasmBinary) {
      if(!nativeFetch)throw new Error('MSM5205 decoder assets require fetch or wasmBinary');
      const response=await nativeFetch(MSM5205_WASM_URL,{signal});
      if(!response.ok)throw new Error(`MSM5205 WASM failed to load (${response.status})`);
      wasmBinary=await response.arrayBuffer();signal?.throwIfAborted();
    }
    core=await createMSM5205PCM({sampleRate:MSM5205_ASSET_WAVE_SAMPLE_RATE,clock:MSM5205_PCM_DEFAULT_CLOCK,wasmBinary});
    signal?.throwIfAborted();core.prepare(data);core.play({offset:0,length:frames,loop:false,rate});
    for(let offset=0,blocks=0;offset<outputFrames;offset+=left.length,blocks++) {
      signal?.throwIfAborted();const count=Math.min(left.length,outputFrames-offset);
      core.render(left,right,count);
      for(let i=0;i<count;i++) {
        const value=left[i];
        if(!Number.isFinite(value)||value<-1||value>1)throw new Error('MSM5205 decoder returned an invalid sample');
        const bin=bins[Math.floor((offset+i)*bins.length/outputFrames)];
        if(value<bin.min)bin.min=value;if(value>bin.max)bin.max=value;
        peak=Math.max(peak,Math.abs(value));
      }
      if((blocks&7)===7&&offset+count<outputFrames){await yieldTask();signal?.throwIfAborted();}
    }
    const state=core.readState();
    if(state.state!=='ended'||state.positionNibbles!==frames)throw new Error('MSM5205 waveform did not reach the requested sample end');
    return Object.freeze({sampleRate:MSM5205_ASSET_WAVE_SAMPLE_RATE,frames:outputFrames,
      bins:Object.freeze(bins.map(bin=>Object.freeze(bin))),peak});
  } finally {core?.dispose();}
}

/** Prepare one UI/Code-owned sample without starting any audio hardware.
 * WAV/PCM uses the existing bounded encoder. Packed ADPCM is copied verbatim
 * and interpreted high nibble first by the existing shared offline renderer.
 * Caller bytes are never retained; metadata and compact waveform are frozen.
 * `yieldTask` is an inert scheduling seam for cancellation tests.
 * @param {unknown} source WAV/PCM or raw packed ADPCM, according to format.
 * @param {{format?:'wav'|'adpcm',rate?:number,name?:string,path?:string|null,
 * signal?:AbortSignal,wasmBinary?:ArrayBuffer|Uint8Array,decodeAudio?:(bytes:ArrayBuffer)=>Promise<unknown>,yieldTask?:()=>Promise<unknown>}} [options]
 */
export async function prepareMsm5205Asset(source,{format='wav',rate=12,name='MSM5205 sample',path=null,signal,wasmBinary,decodeAudio,yieldTask=yieldToHost}={}) {
  signal?.throwIfAborted();
  if(format!=='wav'&&format!=='adpcm')throw new TypeError('MSM5205 format must be wav or adpcm');
  if(!Number.isInteger(rate)||rate<0||rate>15)throw new RangeError('MSM5205 rate must be 0..15');
  if(typeof name!=='string'||path!==null&&typeof path!=='string'||typeof yieldTask!=='function')throw new TypeError('Invalid MSM5205 asset metadata or scheduler');
  let prepared;
  if(format==='adpcm') {
    const data=await rawBytes(source,signal),frames=data.length*2;
    prepared={data,rate,frames,paddedFrames:frames,sampleRate:MSM5205_PCM_DEFAULT_CLOCK/(48*(16-rate))};
  } else {
    // UI supplies no decoder: malformed or unsupported bytes remain WAV
    // errors. Code may explicitly inject its existing offline decoder.
    await yieldTask();signal?.throwIfAborted();
    prepared=await prepareMSM5205Sample(source,{rate,clock:MSM5205_PCM_DEFAULT_CLOCK,signal,decodeAudio});
  }
  signal?.throwIfAborted();
  const data=new Uint8Array(prepared.data),{frames,paddedFrames,sampleRate}=prepared;
  const info=Object.freeze({name:cleanName(name),path,format,bytes:data.length,frames,paddedFrames,rate,sampleRate,
    duration:frames/sampleRate,paddedDuration:paddedFrames/sampleRate});
  await yieldTask();signal?.throwIfAborted();
  const wave=await waveform(data,frames,rate,{signal,wasmBinary,yieldTask});signal?.throwIfAborted();
  return Object.freeze({data,info,wave});
}
