// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {encodeBrr} from '../js/snes_brr_encoder.js';
import {prepareSnesBRR} from '../js/snessynth.js';
import {encodeBase64, MAX_BRR_BYTES, MAX_PCM_FRAMES} from './sample.js';

export const MAX_AUDIO_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_DECODED_SECONDS = 30 * 60;
const WORK_QUANTUM = 65536;
const abort = signal => {if (signal?.aborted) throw new DOMException('Sample import cancelled', 'AbortError');};
const pause = async signal => {abort(signal);await new Promise(resolve => setTimeout(resolve, 0));abort(signal);};
const cleanName = name => (typeof name === 'string' ? name : 'Audio sample').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim().slice(0,120) || 'Audio sample';
function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${label} must be an integer ${minimum}–${maximum}`);
}
async function readFile(file, maximum, label, signal) {
  abort(signal);
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size < 1) throw new TypeError(`Choose a nonempty ${label} file`);
  if (file.size > maximum) throw new RangeError(`${label} file exceeds ${maximum.toLocaleString('en-US')} bytes`);
  const bytes = await file.arrayBuffer();abort(signal);
  if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > maximum) throw new RangeError(`${label} file must contain at most ${maximum.toLocaleString('en-US')} bytes`);
  return bytes;
}

/** Equal-channel mono mixing with area-average downsampling and linear
 * upsampling. Only the final mono result is clamped to BRR's normalized -1..1
 * range; inputs are not clipped before averaging and gain is never normalized.
 * Caller-owned channels are borrowed until the promise resolves and must not
 * be changed during conversion. */
export async function resampleMono(channels, sourceRate, targetRate, {signal} = {}) {
  abort(signal);integer(sourceRate,8000,384000,'Source rate');integer(targetRate,8000,32000,'Conversion rate');
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 32 || channels.some(channel => !(channel instanceof Float32Array))) throw new TypeError('Audio needs 1–32 Float32Array channels');
  const frames = channels[0].length;
  if (!frames || channels.some(channel => channel.length !== frames)) throw new RangeError('Audio channels must have the same nonzero length');
  if (frames / sourceRate > MAX_DECODED_SECONDS) throw new RangeError('Decoded audio exceeds 30 minutes');
  const length = Math.ceil(frames * targetRate / sourceRate);
  if (length > MAX_PCM_FRAMES) throw new RangeError('Audio exceeds SNES sample RAM; choose a shorter recording or lower conversion rate');
  let budget = WORK_QUANTUM;
  for (const channel of channels) for (const value of channel) {
    if (!Number.isFinite(value)) throw new RangeError('Decoded PCM samples must be finite');
    if (--budget === 0) {await pause(signal);budget=WORK_QUANTUM;}
  }
  const output = new Float32Array(length), ratio = sourceRate / targetRate;
  const mono = frame => {
    let sum = 0;
    for (const channel of channels) {
      const value = channel[frame];
      if (!Number.isFinite(value)) throw new RangeError('Decoded PCM samples must be finite');
      sum += value;
    }
    return sum / channels.length;
  };
  budget = WORK_QUANTUM;
  for (let index = 0; index < length; index++) {
    let value;
    if (targetRate >= sourceRate) {
      const position = Math.min(frames-1,index*ratio), first = Math.floor(position), fraction=position-first;
      value = mono(first)*(1-fraction) + mono(Math.min(frames-1,first+1))*fraction;
      budget -= channels.length*2;
    } else {
      const first=index*ratio,end=Math.min(frames,(index+1)*ratio);let sum=0;
      for(let frame=Math.floor(first);frame<Math.ceil(end);frame++) {
        const weight=Math.min(end,frame+1)-Math.max(first,frame);
        if(weight>0) sum+=mono(frame)*weight;
        budget-=channels.length;
      }
      value=sum/(end-first);
    }
    output[index]=Math.max(-1,Math.min(1,value));
    if(budget<=0){await pause(signal);budget=WORK_QUANTUM;}
  }
  abort(signal);return output;
}

/** Keep browser BRR encoding off the UI thread so Cancel can stop it. This
 * readable module worker imports the same bounded encoder as the fallback;
 * it adds no alternate codec or generated DSP code. */
async function encodePrepared(pcm, loop, signal) {
  await pause(signal);
  const options={maxBytes:MAX_BRR_BYTES,loopStartSamples:loop?0:null};
  if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') {
    const result=encodeBrr(pcm,options);await pause(signal);return result.brr;
  }
  const source=`import {encodeBrr} from ${JSON.stringify(new URL('../js/snes_brr_encoder.js',import.meta.url).href)};
onmessage=({data})=>{
  try {
    const result=encodeBrr(new Float32Array(data.pcm),data.options);
    postMessage({brr:result.brr.buffer},[result.brr.buffer]);
  } catch(error) {postMessage({error:error.message,name:error.name});}
};`;
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  let worker,cancelled;
  try {
    worker=new Worker(url,{type:'module'});
    return await new Promise((resolve,reject)=>{
      cancelled=()=>reject(new DOMException('Sample import cancelled','AbortError'));
      signal?.addEventListener('abort',cancelled,{once:true});
      const finish=callback=>value=>{signal?.removeEventListener('abort',cancelled);callback(value);};
      worker.onmessage=({data})=>{
        if(data?.error) {const error=new Error(data.error);error.name=data.name??'Error';finish(reject)(error);}
        else if(data?.brr instanceof ArrayBuffer) finish(resolve)(new Uint8Array(data.brr));
        else finish(reject)(new Error('BRR worker returned an invalid result'));
      };
      worker.onerror=event=>{event.preventDefault?.();finish(reject)(new Error(event.message||'BRR conversion worker failed'));};
      if(signal?.aborted){cancelled();return;}
      worker.postMessage({pcm:pcm.buffer,options},[pcm.buffer]);
    });
  } finally {if(cancelled)signal?.removeEventListener('abort',cancelled);worker?.terminate();URL.revokeObjectURL(url);}
}

/** Prepare a bounded, independently tuned BRR sample with no speaker device.
 * Other formats depend on browser codecs; WAV is the portable input. The
 * offline decoder itself is not cancellable, so cancelled results are dropped.
 * One-shots and optional whole-sample loops are padded with zeros to 16 frames.
 * BRR has no stored rate: basePitch declares the chosen conversion rate at C4
 * (or the caller's rootNote), rather than guessing a musical fundamental. */
export async function prepareAudio(file,{sampleRate=16000,signal,rootNote=60,loop=false}={}) {
  abort(signal);integer(sampleRate,8000,32000,'Conversion rate');integer(rootNote,0,127,'Root MIDI note');
  if(typeof loop!=='boolean')throw new TypeError('Loop must be boolean');
  const bytes=await readFile(file,MAX_AUDIO_FILE_BYTES,'Audio',signal);
  const Context=globalThis.OfflineAudioContext??globalThis.webkitOfflineAudioContext;
  if(typeof Context!=='function')throw new Error('This browser does not support offline audio decoding');
  let buffer;
  try {buffer=await new Context(1,1,32000).decodeAudioData(bytes);}
  catch(error){abort(signal);throw new Error('This audio could not be decoded. Try WAV; other formats depend on the browser codec.',{cause:error});}
  abort(signal);
  if(!buffer||!Number.isInteger(buffer.sampleRate)||buffer.sampleRate<8000||buffer.sampleRate>384000||
      !Number.isSafeInteger(buffer.length)||buffer.length<1||!Number.isInteger(buffer.numberOfChannels)||buffer.numberOfChannels<1||buffer.numberOfChannels>32||typeof buffer.getChannelData!=='function') throw new TypeError('Decoded audio has an invalid channel layout');
  if(buffer.length/buffer.sampleRate>MAX_DECODED_SECONDS)throw new RangeError('Decoded audio exceeds 30 minutes');
  if(Math.ceil(buffer.length*sampleRate/buffer.sampleRate)>MAX_PCM_FRAMES)throw new RangeError('Audio exceeds SNES sample RAM; choose a shorter recording or lower conversion rate');
  const channels=Array.from({length:buffer.numberOfChannels},(_,index)=>buffer.getChannelData(index));
  let pcm=await resampleMono(channels,buffer.sampleRate,sampleRate,{signal});
  if(loop&&pcm.length%16){const padded=new Float32Array(Math.ceil(pcm.length/16)*16);padded.set(pcm);pcm=padded;}
  const brr=await encodePrepared(pcm,loop,signal);abort(signal);
  const basePitch=Math.round(4096*sampleRate/32000),loopStartSamples=loop?0:null;
  prepareSnesBRR(brr,{rootNote,basePitch,...(loop?{loopStartSamples:0}:{})});
  return {name:cleanName(file.name),data:encodeBase64(brr),rootNote,basePitch,loopStartSamples};
}

/** Read raw, headerless BRR. Musical tuning is explicitly supplied by the user.
 * A LOOP flag supplies no address: omitted loopStartSamples deliberately uses
 * zero as an editable starting choice, not as a recovered original loop point. */
export async function prepareBrrFile(file,{signal,rootNote=60,basePitch=4096,loopStartSamples}={}) {
  abort(signal);integer(rootNote,0,127,'Root MIDI note');integer(basePitch,1,16383,'Base PITCH');
  if(loopStartSamples!==undefined&&loopStartSamples!==null)integer(loopStartSamples,0,MAX_PCM_FRAMES-1,'Loop start');
  const bytes=new Uint8Array(await readFile(file,MAX_BRR_BYTES,'BRR',signal));
  const loop=bytes.length>=9&&Boolean(bytes[bytes.length-9]&2);
  const position=loopStartSamples===undefined?(loop?0:null):loopStartSamples;
  if(loop&&position===null)throw new TypeError('Looped BRR requires an explicit loop start; raw files do not store it');
  prepareSnesBRR(bytes,{rootNote,basePitch,...(position!==null?{loopStartSamples:position}:{})});
  await pause(signal);
  return {name:cleanName(file.name),data:encodeBase64(bytes),rootNote,basePitch,loopStartSamples:position};
}
