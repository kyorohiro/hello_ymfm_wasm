// SPDX-License-Identifier: BSD-3-Clause
import {Oki6295AudioEngine} from '../js/okim6295audioengine.js';

// Track the bytes actually supplied by ROM blocks, including partial uploads.
export class SongSampleMemory {
  ranges=[];
  size=0;
  observe(offset,length,size) {
    if (size!==this.size) this.ranges=[];
    this.size=size;
    const sorted=[...this.ranges,[offset,offset+length]].sort((a,b)=>a[0]-b[0]);
    this.ranges=[];
    for (const range of sorted) {
      const last=this.ranges.at(-1);
      if (last && last[1]>=range[0]) last[1]=Math.max(last[1],range[1]);
      else this.ranges.push(range);
    }
  }
  sampleBytes(chip,start,length) {
    const bytes=new Uint8Array(length);
    for (let copied=0;copied<length;) {
      const address=start+copied, offset=chip.romOffset(address);
      // NMK can map the table and each 64 KiB window independently.
      const span=Math.min(length-copied,0x100-(address&255));
      if (!this.ranges.some(([a,b])=>a<=offset && offset+span<=b)) return null;
      bytes.set(chip.rom.subarray(offset,offset+span),copied);
      copied+=span;
    }
    return bytes;
  }
  snapshot(chip,includeBytes=true) {
    return {rate:chip.clock/(chip.pin7?132:165),voices:chip.voices.map(v=>({
      busy:v.playing,sample:v.sample,attenuation:v.attenuation,
      requestedSample:v.requestedSample,requestedAttenuation:v.requestedAttenuation,
      bytes:includeBytes && v.count ? this.sampleBytes(chip,v.start,v.count/2) : null
    }))};
  }
}

export function decodeSongSample(voice,columns) {
  const chip=new Oki6295AudioEngine({clock:1000000});
  chip.loadOki6295Rom(voice.bytes);
  chip.startVoice(0,0,voice.bytes.length-1,voice.attenuation);
  const pcm=new Float32Array(voice.bytes.length*2);
  const min=new Float32Array(Math.min(columns,pcm.length)),max=new Float32Array(min.length);
  for (let i=0;i<pcm.length;i++) {
    chip.tick();
    const value=pcm[i]=chip.voices[0].output, bin=Math.floor(i*min.length/pcm.length);
    min[bin]=Math.min(min[bin],value);max[bin]=Math.max(max[bin],value);
  }
  return {pcm,min,max};
}
