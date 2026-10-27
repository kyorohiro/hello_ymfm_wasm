import {readSamplePCM} from './adpcm_b_sample.js';
import {validateChipClock} from './playground_chip_clock.js?v=wonderswan-pcm-timeline-1';

export const OKIM6258_CLOCK = 8000000;
export const OKIM6258_DIVIDERS = Object.freeze([1024, 768, 512]);
const INDEX_SHIFT = [-1, -1, -1, -1, 2, 4, 6, 8];
const STEPS = Array.from({length:49}, (_, i) => Math.floor(16 * (11 / 10) ** i));

/** @typedef {{frames:number,waveform:number[],sampleRate?:number,source?:'raw'|'sample',name?:string}} Oki6258SampleMetadata
 * @typedef {{writeRegister:(register:number,value:number)=>void,
 * loadMemory:(bytes:Uint8Array,metadata?:Oki6258SampleMetadata)=>void|Promise<void>,
 * play:(options:{repeat:boolean})=>void,stop:()=>void,reset:()=>void,dispose?:()=>void}} Oki6258Transport
 */

/** Choose an actual VCLK rate; the chip has three clock dividers, not a pitch register.
 * @param {number} clock @param {number} hz */
export function oki6258Rate(clock, hz) {
  validateChipClock(clock);
  if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('Invalid OKIM6258 playback rate');
  const divider = OKIM6258_DIVIDERS.reduce((best, next) =>
    Math.abs(clock / next - hz) < Math.abs(clock / best - hz) ? next : best);
  return {divider, sampleRate:clock / divider};
}

/** Encode MAME-compatible OKI ADPCM4: low nibble first, initial predictor -2,
 * 12-bit output and the 49-entry OKI step table. Stereo PCM is averaged.
 * The final byte always contains two samples, with silence padding if needed.
 * @param {import('./wav.js').ChannelPCM} pcm
 * @param {number} outputRate
 * @param {number} [maxBytes]
 */
export function encodeOki6258({channels, sampleRate}, outputRate, maxBytes = 0x1000000) {
  if (!Array.isArray(channels) || !channels.length || channels.length > 32 ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) throw new TypeError('Invalid PCM');
  const length = channels[0]?.length;
  if (!Number.isSafeInteger(length) || length < 1 || channels.some(channel => channel.length !== length)) throw new RangeError('Invalid PCM channel lengths');
  const frames = Math.max(1, Math.round(length * outputRate / sampleRate));
  const byteLength = Math.ceil(frames / 2);
  if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes) throw new RangeError('OKIM6258 sample exceeds 16 MiB');
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) for (const channel of channels) {
    if (!Number.isFinite(channel[i])) throw new TypeError('Nonfinite PCM');
    mono[i] += Math.max(-1, Math.min(1, channel[i])) / channels.length;
  }
  const bytes = new Uint8Array(byteLength);
  let predictor = -2, stepIndex = 0;
  for (let i = 0; i < byteLength * 2; i++) {
    let value = 0;
    if (i < frames) {
      const position = Math.min(length - 1, i * sampleRate / outputRate), first = Math.floor(position), fraction = position - first;
      value = mono[first] * (1 - fraction) + mono[Math.min(first + 1, length - 1)] * fraction;
    }
    const target = Math.round(value * (value < 0 ? 2048 : 2047)), step = STEPS[stepIndex];
    let best = 0, bestValue = 0, bestError = Infinity;
    for (let code = 0; code < 16; code++) {
      const difference = Math.floor(step / 8) + (code & 1 ? Math.floor(step / 4) : 0) +
        (code & 2 ? Math.floor(step / 2) : 0) + (code & 4 ? step : 0);
      const decoded = Math.max(-2048, Math.min(2047, predictor + (code & 8 ? -difference : difference)));
      if (Math.abs(decoded - target) < bestError) { best = code; bestValue = decoded; bestError = Math.abs(decoded - target); }
    }
    bytes[i >> 1] |= best << ((i & 1) * 4);
    predictor = bestValue;
    stepIndex = Math.max(0, Math.min(48, stepIndex + INDEX_SHIFT[best & 7]));
  }
  return {bytes, frames, paddedFrames:byteLength * 2, sampleRate:outputRate, durationSeconds:byteLength * 2 / outputRate};
}

/** Decode a bounded peak preview outside the audio render thread. No PCM-sized allocation.
 * @param {Uint8Array|ArrayBuffer} input @param {{bins?:number}} [options] */
export function summarizeOki6258(input,{bins=512}={}) {
  const bytes=input instanceof ArrayBuffer?new Uint8Array(input):input;
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>0x1000000)throw new RangeError('Expected 1 byte to 16 MiB of OKI ADPCM');
  if(!Number.isInteger(bins)||bins<1||bins>512)throw new RangeError('Preview bins must be 1..512');
  const frames=bytes.length*2,count=Math.min(bins,frames),waveform=new Array(count).fill(0);
  let predictor=-2,stepIndex=0;
  for(let frame=0;frame<frames;frame++){
    const code=bytes[frame>>1]>>((frame&1)*4)&15,step=STEPS[stepIndex];
    const difference=Math.floor(step/8)+(code&1?Math.floor(step/4):0)+(code&2?Math.floor(step/2):0)+(code&4?step:0);
    predictor=Math.max(-2048,Math.min(2047,predictor+(code&8?-difference:difference)));
    stepIndex=Math.max(0,Math.min(48,stepIndex+INDEX_SHIFT[code&7]));
    const bin=Math.min(count-1,Math.floor(frame*count/frames)),value=predictor/2048;
    if(Math.abs(value)>Math.abs(waveform[bin]))waveform[bin]=value;
  }
  return {frames,waveform};
}

/** Portable control surface. Transport memory is acknowledged before playback. */
export class Oki6258Synth {
  /** @param {{transport:Oki6258Transport,clock?:number}} options */
  constructor({transport, clock = OKIM6258_CLOCK}) {
    this.transport = transport;
    this._clock = validateChipClock(clock);
    this.divider = 512;
    this.pan = 0;
    this.sample = null;
    this.disposed = false;
  }
  get clock() { return this._clock; }
  get playbackRate() { return this._clock / this.divider; }
  _assertLive() { if (this.disposed) throw new Error('OKIM6258 disposed'); }
  _adoptHardwareClock(hz) { this._clock = validateChipClock(hz); }
  _getState() { return {clock:this._clock, divider:this.divider, pan:this.pan, sample:this.sample ? {...this.sample} : null}; }
  _adoptState(state) {
    if (!state || !OKIM6258_DIVIDERS.includes(state.divider) || !Number.isInteger(state.pan) || state.pan < 0 || state.pan > 3) throw new TypeError('Invalid OKIM6258 state');
    validateChipClock(state.clock);
    const sample = state.sample;
    if (sample !== null && (!sample || !Number.isInteger(sample.bytes) || sample.bytes < 1 || sample.bytes > 0x1000000 ||
        sample.frames !== sample.bytes * 2 || !Number.isFinite(sample.sampleRate) || sample.sampleRate <= 0 ||
        !Number.isFinite(sample.durationSeconds) || sample.durationSeconds <= 0)) throw new TypeError('Invalid OKIM6258 sample state');
    this._clock = state.clock; this.divider = state.divider; this.pan = state.pan; this.sample = sample ? {...sample} : null;
    this._adoptClock?.(state.clock);
  }
  /** @param {number} divider */
  setDivider(divider) {
    this._assertLive();
    if (!OKIM6258_DIVIDERS.includes(divider)) throw new RangeError('OKIM6258 divider must be 1024, 768 or 512');
    this.divider = divider;
    this.transport.writeRegister(12, OKIM6258_DIVIDERS.indexOf(divider));
    return this.playbackRate;
  }
  /** @param {number} hz */
  setPlaybackRate(hz) { return this.setDivider(oki6258Rate(this._clock, hz).divider); }
  setPan(left = true, right = true) {
    this._assertLive();
    if (typeof left !== 'boolean' || typeof right !== 'boolean') throw new TypeError('Pan requires left/right booleans');
    this.pan = (left ? 0 : 2) | (right ? 0 : 1);
    this.transport.writeRegister(2, this.pan);
  }
  /** Load encoded 4-bit OKI bytes, low nibble first. PCM/WAV belongs in loadSample().
   * @param {Uint8Array|ArrayBuffer} input
   * @param {{sampleRate?:number}} [options]
   * @returns {Promise<void>}
   */
  async loadMemory(input, {sampleRate} = {}) {
    this._assertLive();
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    if (!(bytes instanceof Uint8Array)) throw new TypeError('OKIM6258 memory requires Uint8Array or ArrayBuffer');
    if (!bytes.length || bytes.length > 0x1000000) throw new RangeError('Expected 1 byte to 16 MiB of OKI ADPCM');
    if (sampleRate !== undefined) this.setPlaybackRate(sampleRate);
    const preview=summarizeOki6258(bytes);
    await this.transport.loadMemory(bytes.slice(),{...preview,sampleRate:this.playbackRate,source:'raw'});
    this.sample = {bytes:bytes.length, frames:bytes.length * 2, sampleRate:this.playbackRate, durationSeconds:bytes.length * 2 / this.playbackRate};
  }
  /** PCM objects, AudioBuffer, WAV bytes, Blob and URL/path are accepted.
   * @param {unknown} source
   * @param {{sampleRate?:number,signal?:AbortSignal,decodeAudio?:(bytes:ArrayBuffer)=>Promise<AudioBuffer|import('./wav.js').ChannelPCM>}} [options]
   */
  async loadSample(source, {sampleRate = this.playbackRate, signal, decodeAudio} = {}) {
    this._assertLive();
    const pcm = await readSamplePCM(source, {signal, decodeAudio});
    this._assertLive();
    const rate = oki6258Rate(this._clock, sampleRate);
    const encoded = encodeOki6258(pcm, rate.sampleRate);
    signal?.throwIfAborted();
    this.setDivider(rate.divider);
    await this.loadMemory(encoded.bytes);
    signal?.throwIfAborted();
    return {...encoded, bytes:encoded.bytes.length};
  }
  play({repeat = false} = {}) {
    this._assertLive();
    if (typeof repeat !== 'boolean') throw new TypeError('repeat must be boolean');
    if (!this.sample) throw new Error('Load an OKIM6258 sample before play()');
    this.transport.play({repeat});
  }
  stop() { this._assertLive(); this.transport.stop(); }
  keyOff() { this.stop(); }
  allNotesOff() { this.stop(); }
  reset() { this._assertLive(); this.transport.reset(); this.divider = 512; this.pan = 0; }
  /** @param {number} register @param {number} value */
  writeRegister(register, value) {
    this._assertLive();
    if (!Number.isInteger(register) || register < 0 || register > 12 || !Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Invalid OKIM6258 register/value');
    if (register === 12) this.divider = [1024, 768, 512, 512][value & 3];
    if (register === 2) this.pan = value & 3;
    this.transport.writeRegister(register, value);
  }
  dispose() { if (this.disposed) return; this.transport.dispose?.(); this.disposed = true; }
}

/** Feed the native chip's eight-byte FIFO without overruns or end-of-sample DC.
 * Every output frame advances the same fractional VCLK phase as the core.
 * A bounded segment never needs more than eight queued bytes. Repeats restart
 * the ADPCM predictor, so repeated phrases do not accumulate decoder drift.
 */
export class Oki6258Stream {
  constructor(engine, {clock = OKIM6258_CLOCK} = {}) {
    this.engine = engine;
    this.clock = validateChipClock(clock);
    this.divider = 512;
    this.pan = 0;
    this.bytes = new Uint8Array();
    this.playing = false;
    this.streaming = false;
    this.phase = 0;
    this.position = 0;
    this.fedBytes = 0;
    this._configure();
  }
  _configure() {
    for (let i = 0; i < 4; i++) this.engine.writeOki6258(8 + i, (this.clock >>> (8 * i)) & 255);
    this.engine.writeOki6258(12, OKIM6258_DIVIDERS.indexOf(this.divider));
    this.engine.writeOki6258(2, this.pan);
    this.clockBuffer = this.clock;
  }
  _validateRate(clock, divider) {
    if (clock / divider / this.engine.sampleRate() > 14) throw new RangeError('OKIM6258 VCLK exceeds the output stream rate');
  }
  setClock(clock) { validateChipClock(clock); this._validateRate(clock, this.divider); this.clock = clock; this._configure(); }
  writeRegister(register, value) {
    if (!Number.isInteger(register) || register < 0 || register > 12 || !Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Invalid OKIM6258 register/value');
    if (register === 12) {
      const divider = [1024, 768, 512, 512][value & 3]; this._validateRate(this.clock, divider); this.divider = divider;
    }
    if (register === 2) this.pan = value & 3;
    if (register >= 8 && register <= 11) {
      const shift = (register - 8) * 8;
      this.clockBuffer = ((this.clockBuffer & ~(255 << shift)) | (value << shift)) >>> 0;
      if (register === 11) { const clock = this.clockBuffer & 0x3fffffff; this._validateRate(clock, this.divider); this.clock = clock; }
    }
    if (register === 0) { this.streaming = false; this.playing = !!(value & 2) && !(value & 1); }
    this.engine.writeOki6258(register, value);
  }
  loadMemory(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 0x1000000) throw new RangeError('Expected 1 byte to 16 MiB of OKI ADPCM');
    this.stop(); this.bytes = bytes.slice();
  }
  play({repeat = false} = {}) {
    if (!this.bytes.length) throw new Error('No OKIM6258 sample loaded');
    if (typeof repeat !== 'boolean') throw new TypeError('repeat must be boolean');
    this.repeat = repeat;
    this._restart();
  }
  _restart() {
    this.engine.reset(); this._configure();
    this.engine.writeOki6258(0, 2);
    this.phase = this.position = this.fedBytes = 0;
    this.playing = this.streaming = true;
  }
  stop() { this.engine.writeOki6258(0, 1); this.playing = this.streaming = false; }
  reset() { this.stop(); this.engine.reset(); this.divider = 512; this.pan = 0; this.phase = 0; this._configure(); }
  process(left, right) {
    if (!this.streaming) {
      const pcm = this.engine.processFrames(left.length); left.set(pcm.left); right.set(pcm.right); return;
    }
    let offset = 0;
    const ratio = this.clock / this.divider / this.engine.sampleRate();
    if (ratio > 14) throw new RangeError('OKIM6258 VCLK exceeds the output stream rate');
    while (offset < left.length) {
      if (this.position >= this.bytes.length * 2) {
        if (this.repeat) this._restart();
        else { this.stop(); left.fill(0, offset); right.fill(0, offset); return; }
      }
      // Keep at most seven bytes ahead, leaving one byte for an odd nibble.
      const remaining = this.bytes.length * 2 - this.position;
      let count = Math.max(1, Math.min(left.length - offset, Math.floor((Math.min(14, remaining) - this.phase) / ratio)));
      let nextPhase = this.phase, ticks = 0;
      for (let i = 0; i < count; i++) { nextPhase += ratio; const n = Math.floor(nextPhase); nextPhase -= n; ticks += n; }
      const required = Math.min(this.bytes.length, Math.ceil((this.position + ticks) / 2));
      while (this.fedBytes < required) this.engine.writeOki6258(1, this.bytes[this.fedBytes++]);
      const pcm = this.engine.processFrames(count);
      left.set(pcm.left, offset); right.set(pcm.right, offset);
      this.phase = nextPhase; this.position += ticks; offset += count;
    }
    if (this.position >= this.bytes.length * 2 && !this.repeat) this.stop();
  }
}
