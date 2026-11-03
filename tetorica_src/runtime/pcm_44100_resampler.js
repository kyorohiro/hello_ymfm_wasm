// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
const PCM_NATIVE_RATE=44100;
/** Streaming linear conversion from fixed 44.1-kHz PCM to a host rate.
 * Phase survives output quanta. Native batches contain only the frames needed
 * by the current output segment, bounding look-ahead to its interpolation
 * endpoint; 44.1-kHz output delegates directly
 * without look-ahead. Call reset() after the source is stopped/reset, so held
 * interpolation frames cannot leak into the next transport run.
 */
export class Pcm44100Resampler {
  /** @param {{renderInto:Function,nativeFrames?:number,sampleRate?:number}} core
   * @param {number} outputRate @param {{sourceFrames?:number}} [options] */
  constructor(core,outputRate,{sourceFrames=128}={}) {
    if(!core||typeof core.renderInto!=='function')throw new TypeError('PCM resampler requires a stereo PCM source');
    if(core.sampleRate!==undefined&&core.sampleRate!==PCM_NATIVE_RATE)throw new RangeError('PCM source rate must be 44100 Hz');
    if(!Number.isSafeInteger(outputRate)||outputRate<1||outputRate>768000)throw new RangeError('Invalid PCM output sample rate');
    if(!Number.isSafeInteger(sourceFrames)||sourceFrames<1||sourceFrames>16384)throw new RangeError('Invalid PCM source block size');
    this.core=core;this.outputRate=outputRate;this.sourceFrames=sourceFrames;
    this.left=new Float32Array(sourceFrames);this.right=new Float32Array(sourceFrames);
    this.reset();
  }
  /** @param {number} [nativeFrames] */
  reset(nativeFrames=this.core.nativeFrames??0) {
    if(!Number.isSafeInteger(nativeFrames)||nativeFrames<0)throw new RangeError('Invalid PCM native frame position');
    this.offset=0;this.availableFrames=0;this.remainingPulls=0;this.primed=false;this.phase=0;this.outputFrames=0;
    this.baseNativeFrames=nativeFrames;this.renderedNativeFrames=nativeFrames;
  }
  _pull() {
    if(this.offset===this.availableFrames){const count=Math.min(this.sourceFrames,this.remainingPulls);this.core.renderInto(this.left,this.right,count);this.renderedNativeFrames+=count;this.availableFrames=count;this.offset=0;}
    this.pulledLeft=this.left[this.offset];this.pulledRight=this.right[this.offset++];this.remainingPulls--;
  }
  get playbackNativeFrames(){return this.baseNativeFrames+this.outputFrames*PCM_NATIVE_RATE/this.outputRate;}
  /** Render without allocating per output quantum. Destinations must be separate
   * Float32 ranges; validation precedes any source advancement.
   * @param {Float32Array} left @param {Float32Array} right
   * @param {number} [frames] @param {number} [offset] */
  render(left,right,frames=Math.min(left?.length??0,right?.length??0),offset=0) {
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array))throw new TypeError('PCM output must be Float32Array');
    if(!Number.isSafeInteger(frames)||frames<0||!Number.isSafeInteger(offset)||offset<0||frames>left.length-offset||frames>right.length-offset)throw new RangeError('Invalid PCM output frame range');
    if(left.buffer===right.buffer&&frames>0){const a=left.byteOffset+offset*4,b=right.byteOffset+offset*4;if(a<b+frames*4&&b<a+frames*4)throw new RangeError('PCM stereo destinations must not overlap');}
    if(!frames)return;
    if(this.outputRate===PCM_NATIVE_RATE){this.core.renderInto(left,right,frames,offset);this.outputFrames+=frames;this.renderedNativeFrames+=frames;return;}
    this.remainingPulls=(this.primed?0:2)+Math.floor((this.phase+frames*PCM_NATIVE_RATE)/this.outputRate);
    if(!this.primed){this._pull();this.previousLeft=this.pulledLeft;this.previousRight=this.pulledRight;this._pull();this.nextLeft=this.pulledLeft;this.nextRight=this.pulledRight;this.primed=true;}
    for(let i=offset;i<offset+frames;i++) {
      const fraction=this.phase/this.outputRate;
      left[i]=this.previousLeft+(this.nextLeft-this.previousLeft)*fraction;
      right[i]=this.previousRight+(this.nextRight-this.previousRight)*fraction;
      this.phase+=PCM_NATIVE_RATE;
      while(this.phase>=this.outputRate){this.phase-=this.outputRate;this.previousLeft=this.nextLeft;this.previousRight=this.nextRight;this._pull();this.nextLeft=this.pulledLeft;this.nextRight=this.pulledRight;}
    }
    this.outputFrames+=frames;
  }
}
