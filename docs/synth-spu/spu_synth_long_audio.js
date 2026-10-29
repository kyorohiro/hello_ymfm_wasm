// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
export const MAX_AUDIO_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_HOST_FRAMES = 44100 * 60 * 30;
export const MAX_HOST_PRESET_BYTES = 224 * 1024 * 1024;

/** Host-memory extension: retain the whole recording as signed mono PCM.
 * The native SPU still supplies interpolation, envelope, PMON and reverb. */
export function prepareHostAudio(buffer) {
  if (buffer.sampleRate !== 44100 || !Number.isSafeInteger(buffer.length) || buffer.length < 1 || buffer.length > MAX_HOST_FRAMES || !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1) throw new RangeError('Audio must be at most 30 minutes at 44,100 Hz');
  const channels = Array.from({length:buffer.numberOfChannels}, (_, ch) => buffer.getChannelData(ch));
  const pcm = new Int16Array(buffer.length);
  for (let i=0;i<pcm.length;i++) {
    let value=0;
    for (const channel of channels) {
      if (!Number.isFinite(channel[i])) throw new TypeError('Audio contains a non-finite sample');
      value+=channel[i]/channels.length;
    }
    pcm[i]=Math.max(-32768,Math.min(32767,Math.round(value*32768)));
  }
  return pcm;
}

export function validateHostPcm(pcm) {
  if (!(pcm instanceof Int16Array) || !pcm.length || pcm.length > MAX_HOST_FRAMES) throw new RangeError('Software audio requires 1 sample to 30 minutes of signed mono PCM');
  return pcm;
}

export function encodeHostPcm(pcm) {
  validateHostPcm(pcm);
  const parts=[];
  // 12,288 samples => a multiple of three bytes; chunks join as base64.
  for (let at=0;at<pcm.length;at+=12288) {
    let bytes='';
    for (let i=at;i<Math.min(at+12288,pcm.length);i++) bytes+=String.fromCharCode(pcm[i]&255,(pcm[i]>>8)&255);
    parts.push(btoa(bytes));
  }
  return parts.join('');
}

export function decodeHostPcm(value) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(MAX_HOST_FRAMES*2/3)*4 || value.length%4 || (/[^A-Za-z0-9+/=]/.test(value) || !/^[^=]*={0,2}$/.test(value))) throw new TypeError('Invalid software PCM base64');
  const byteLength=value.length/4*3-(value.endsWith('==')?2:value.endsWith('=')?1:0);
  if (byteLength%2 || byteLength/2 > MAX_HOST_FRAMES) throw new RangeError('Invalid software PCM length');
  const pcm=new Int16Array(byteLength/2);
  for (let at=0,frame=0;at<value.length;at+=32768) {
    const bytes=atob(value.slice(at,at+32768));
    for (let i=0;i<bytes.length;i+=2) pcm[frame++]=bytes.charCodeAt(i)|(bytes.charCodeAt(i+1)<<8);
  }
  return validateHostPcm(pcm);
}
