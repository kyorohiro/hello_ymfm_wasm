// SPDX-License-Identifier: BSD-3-Clause
/** Software preparation only: no SPU RAM, audio device, normalization or pitch detection. */
import {readSamplePCM} from './adpcm_b_sample.js';
import {renderSampleEdit} from './playground_sample_edit.js?v=audio-numeric-bindings-1';
import {noteToHz} from './soundchip_pitch.js';
export async function readScspAudio(source,{decodeAudio,signal}={}) {
  signal?.throwIfAborted();
  if(typeof Blob!=='undefined'&&source instanceof Blob){
    if(source.size>64*1024*1024)throw new RangeError('Audio file exceeds 64 MiB');
    source=await source.arrayBuffer();
  }
  if(source?.byteLength>64*1024*1024)throw new RangeError('Audio file exceeds 64 MiB');
  try{return await readSamplePCM(source,{decodeAudio,signal});}
  catch(error){
    signal?.throwIfAborted();
    if(!decodeAudio||!(source instanceof ArrayBuffer)||source.byteLength<12||new DataView(source).getUint32(0,false)!==0x52494646)throw error;
    // Browser codecs also accept WAV variants outside the small PCM parser.
    return readSamplePCM(await decodeAudio(source),{signal});
  }
}
/** Explicit selection; reject oversize output before resampling or allocating it.
 * Long recordings remain in host memory. Only this mono selection enters SCSP RAM.
 */
export function prepareScspPCM(audio,{startSeconds=0,endSeconds,sourceSampleRate=44100,rootNote=69,bits=16}={}) {
  if(!audio?.channels?.length||!Number.isInteger(audio.sampleRate)||audio.sampleRate<1)throw new TypeError('Invalid decoded audio');
  const duration=audio.channels[0].length/audio.sampleRate;
  if(!Number.isFinite(startSeconds)||!Number.isFinite(endSeconds)||startSeconds<0||endSeconds<=startSeconds||endSeconds>duration)throw new RangeError('Choose a valid start/end inside the recording');
  if(!Number.isInteger(sourceSampleRate)||sourceSampleRate<1||sourceSampleRate>768000)throw new RangeError('Invalid sample rate');
  if(bits!==8&&bits!==16)throw new RangeError('PCM format must be 8 or 16 bits');
  const baseFrequencyHz=noteToHz(rootNote),startFrame=Math.round(startSeconds*audio.sampleRate),endFrame=Math.round(endSeconds*audio.sampleRate);
  const frames=Math.round((endFrame-startFrame)*sourceSampleRate/audio.sampleRate);
  if(frames<2||frames>65535)throw new RangeError(`Selection needs ${frames} samples; SCSP allows 2..65535. Shorten the selection or lower its sample rate.`);
  const rendered=renderSampleEdit(audio,{startFrame,endFrame},{sampleRate:sourceSampleRate,mono:true,maxFrames:65535}),Type=bits===8?Int8Array:Int16Array,scale=bits===8?128:32768;
  const pcm=Type.from(rendered.channels[0],v=>Math.round(v*(v<0?scale:scale-1)));
  return {pcm,sample:{bits,rootFrequencyHz:baseFrequencyHz,sourceSampleRate,loopStartSamples:null},sourceStartFrame:startFrame,sourceEndFrame:endFrame};
}
