import {attachYm2608TimedClient} from './ym2608_timed_client.js';
import {createYm2608OperationResetState,validateYm2608OperationState,observeYm2608OperationWrite} from './ym2608_operation_state.js';
import {trackSsgRetainedLevels} from './opn_ssg_retained.js';
/**
 * @file ym2608synth.js
 * 実行環境: Browser / Node.js（クラスにより異なる）
 * 依存: 低レベル Synth / DirectTransport は注入したチップで動作し、Node.js でも使用可能。
 * RuntimeSynth 系の実再生は OPNRuntimeSynth 経由で AudioContext / AudioWorkletNode / fetch を使う。
 */
import { OPNDirectTransport, OPNWorkletTransport, OPNFMSynth } from "./opn_fm_synth.js";
import { OPNRuntimeSynth } from "./opn_runtime_synth.js";
import { SSGSynth } from "./ssgsynth.js?v=ssg-period-1";
import { YM2608_CLOCK, normalizeYm2608OutputGains, normalizeYm2608SourceGains } from "./ym2608.js";
import {readSamplePCM, encodeAdpcmB} from './adpcm_b_sample.js';

/** Direct transport for YM2608 register operations. */
/** @extends {OPNDirectTransport<import('./ym2608.js').Ym2608>} */
export class YM2608DirectTransport extends OPNDirectTransport {
  /** @param {import('./ym2608.js').Ym2608} chip */
  constructor(chip) {
    super(chip, { chipName: "YM2608", portCount: 2 });
  }
  /** Transfer caller-provided rhythm ROM to the core. @param {Uint8Array} bytes */
  loadRhythmRom(bytes) { return this.chip.loadAdpcmARom(bytes); }
  /** Transfer already encoded ADPCM-B bytes to external sample memory. @param {Uint8Array} bytes @param {number} offset */
  loadAdpcmMemory(bytes, offset) { return this.chip.loadAdpcmBMemory(bytes, offset); }
}

export class YM2608WorkletTransport extends OPNWorkletTransport {
  /** @param {AudioWorkletNode|MessagePort|import('./soundchip_worklet.js').WorkletSoundChip} endpoint */
  constructor(endpoint) {super(endpoint, {chipName: 'YM2608', portCount: 2});}
}

/** YM2608's six fixed rhythm voices. Names follow the ROM's hardware order. */
export const YM2608_RHYTHM_VOICES = Object.freeze({
  bassDrum: 0, snare: 1, cymbal: 2, hiHat: 3, tom: 4, rimShot: 5,
});

const rhythmInteger = (name, value, max) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid rhythm ${name}`);
  return value;
};
const rhythmVoice = voice => {
  const index = typeof voice === "string" && Object.prototype.hasOwnProperty.call(YM2608_RHYTHM_VOICES, voice)
    ? YM2608_RHYTHM_VOICES[voice] : voice;
  return rhythmInteger("voice", index, 5);
};

/** Register control for the fixed rhythm ROM; does not decode WAV or allocate PCM voices. */
export class YM2608RhythmSynth {
  /** @param {{write: (register: number, value: number) => void, loadRom: (bytes: Uint8Array) => void}} transport */
  constructor(transport) {
    this.transport = transport;
    this.resetState();
  }
  /** Clear the register shadow after a whole-chip reset, without bus writes. */
  resetState() { this.levels = new Uint8Array(6); }
   /** Track raw port-0 writes made through the parent Synth. @param {number} register  @param {number} value */
  observeWrite(register, value) {
    if (register >= 0x18 && register <= 0x1d) this.levels[register - 0x18] = value;
  }
  /** Load the complete 8 KiB rhythm ROM supplied by the caller. No ROM is bundled here.
   * @param {Uint8Array} bytes Encoded ADPCM-A ROM, not WAV or ADPCM-B.
   */
  loadRom(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length !== 8192) throw new RangeError("Rhythm ROM must be an 8192-byte Uint8Array");
    return this.transport.loadRom(bytes);
  }
  /** Set global hardware level 0..63; larger values are louder. @param {number} volume */
  setVolume(volume) { this.transport.write(0x11, rhythmInteger("volume", volume, 63)); }
  /** Set one voice's hardware level 0..31 and/or stereo gates; omitted settings are preserved.
   * @param {number|string} voice 0..5 or a key of YM2608_RHYTHM_VOICES.
   * @param {{volume?: number, left?: boolean, right?: boolean}} options
   */
  setVoice(voice, {volume, left, right} = {}) {
    const ch = rhythmVoice(voice);
    let value = this.levels[ch];
    if (volume !== undefined) value = (value & 0xe0) | rhythmInteger("voice volume", volume, 31);
    for (const [flag, mask] of [[left, 0x80], [right, 0x40]]) {
      if (flag === undefined) continue;
      if (typeof flag !== "boolean") throw new TypeError("Rhythm pan gates must be boolean");
      value = flag ? value | mask : value & ~mask;
    }
    this.transport.write(0x18 + ch, value);
    this.levels[ch] = value;
  }
  /** Trigger one voice or an array simultaneously. Repeated calls retrigger from its fixed ROM start. */
  keyOn(voices) { this._key(voices, false); }
  /** Stop one voice or an array immediately; this is not an FM envelope release. */
  keyOff(voices) { this._key(voices, true); }
  _key(voices, off) {
    const list = Array.isArray(voices) ? voices : [voices];
    if (!list.length) return;
    const mask = list.reduce((mask, voice) => mask | (1 << rhythmVoice(voice)), 0);
    this.transport.write(0x10, (off ? 0x80 : 0) | mask);
  }
  /** Stop all rhythm voices and clear their controls; preserve ROM, FM, SSG and ADPCM-B. */
  reset() {
    this.keyOff([0, 1, 2, 3, 4, 5]);
    this.setVolume(0);
    for (let ch = 0; ch < 6; ch++) this.setVoice(ch, {volume: 0, left: false, right: false});
  }
}

const adpcmInteger = (name, value, max) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid ADPCM-B ${name}`);
  return value;
};

/** YM2608 ADPCM-B external-memory playback, using 8-bit DRAM addressing (32-byte units).
 * Browser / Worker / Node.js. loadSample decodes PCM WAV without an audio device.
 */
export class YM2608AdpcmSynth {
  /** @param {{write: (register: number, value: number) => void, loadMemory: (bytes: Uint8Array, address: number) => void}} transport
   * @param {number} clock Master clock in Hz; rate conversion assumes standard FM prescaling.
   */
  constructor(transport, clock = YM2608_CLOCK) {
    if (!Number.isFinite(clock) || clock <= 0) throw new RangeError("Invalid ADPCM-B clock");
    this.transport = transport;
    this.clock = clock;
    this.resetState();
  }
  /** Clear the register shadow after the parent chip resets. Memory is preserved. */
  resetState() {
    this.registers = new Uint8Array(16);
    this.registers[12] = this.registers[13] = 255;
  }
   /** Track raw port-1 writes through the parent Synth. @param {number} register  @param {number} value */
  observeWrite(register, value) {
    if (register >= 0 && register < 16) this.registers[register] = value;
  }
   /** @param {number} register  @param {number} value */
  _write(register, value) {
    this.transport.write(register, value);
    this.observeWrite(register, value);
  }
  /** Transfer encoded ADPCM-B, not WAV, PCM or rhythm ADPCM-A.
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {number} [address=0] Byte offset in the 2 MiB memory.
   */
  loadMemory(bytes, address = 0) {
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    if (!(bytes instanceof Uint8Array)) throw new TypeError("ADPCM-B memory requires Uint8Array or ArrayBuffer");
    adpcmInteger("address", address, 0x200000);
    if (bytes.length > 0x200000 - address) throw new RangeError("ADPCM-B memory exceeds 2 MiB");
    return this.transport.loadMemory(bytes, address);
  }
  /** Decode PCM/AudioBuffer/WAV, mix to mono, encode ADPCM-B and select it.
   * Does not start playback. The caller owns memory allocation: repeated calls
   * at the same address replace the data. Range padding may add up to 63 frames.
   * @param {*} source Decoded {channels, sampleRate}, AudioBuffer, WAV bytes, Blob or path/URL.
   * @param {{address?: number, sampleRate?: number, signal?: AbortSignal, decodeAudio?: Function}} options
   * @returns {Promise<{start:number,end:number,frames:number,paddedFrames:number,sampleRate:number,deltaN:number,duration:number}>}
   */
  async loadSample(source, {address = 0, sampleRate, signal, decodeAudio} = {}) {
    adpcmInteger('address', address, 0x1fffff);
    if (address % 32) throw new RangeError('ADPCM-B address must be 32-byte aligned');
    const pcm = await readSamplePCM(source, {signal, decodeAudio});
    const requested = sampleRate ?? Math.min(pcm.sampleRate, Math.floor(this.clock / 144));
    if (!Number.isFinite(requested) || requested <= 0) throw new RangeError('Invalid ADPCM-B sample rate');
    const deltaN = Math.round(requested * 144 * 65536 / this.clock);
    if (deltaN < 1 || deltaN > 65535) throw new RangeError('ADPCM-B sample rate is outside the chip range');
    const actualRate = deltaN * this.clock / (144 * 65536);
    const encoded = encodeAdpcmB(pcm, actualRate, 0x200000 - address);
    signal?.throwIfAborted();
    this.keyOff();
    await this.loadMemory(encoded.bytes, address);
    signal?.throwIfAborted();
    this.setSample({start: address, end: address + encoded.bytes.length});
    this.setDeltaN(deltaN);
    return {start: address, end: address + encoded.bytes.length, frames: encoded.frames,
      paddedFrames: encoded.paddedFrames, sampleRate: actualRate, deltaN,
      duration: encoded.paddedFrames / actualRate};
  }
  /** Configure a byte range [start, end). Both boundaries must be 32-byte aligned.
   * Selects 8-bit DRAM mode and the full 2 MiB address limit; call while stopped.
   * @param {{start: number, end: number}} range End is exclusive, unlike the hardware register.
   */
  setSample({start, end}) {
    adpcmInteger("start", start, 0x1fffff);
    adpcmInteger("end", end, 0x200000);
    if (end <= start || start % 32 || end % 32) throw new RangeError("ADPCM-B range must be nonempty and 32-byte aligned");
    this._write(1, (this.registers[1] & 0xc0) | 2);
    const first = start / 32, last = end / 32 - 1;
    this._write(2, first & 255); this._write(3, first >> 8);
    this._write(4, last & 255); this._write(5, last >> 8);
    this._write(12, 255); this._write(13, 255);
  }
  /** Set raw Delta-N 1..65535. Can change while playing. */
  setDeltaN(value) {
    adpcmInteger("Delta-N", value, 65535);
    if (!value) throw new RangeError("ADPCM-B Delta-N must be positive");
    this._write(9, value & 255); this._write(10, value >> 8);
  }
  /** Set decoded PCM samples/second, not byte rate. Returns the quantized actual rate.
   * A byte contains two samples; changing this rate changes both speed and pitch.
   * @param {number} rate
   */
  setPlaybackRate(rate) {
    if (!Number.isFinite(rate) || rate <= 0) throw new RangeError("Invalid ADPCM-B playback rate");
    const delta = Math.round(rate * 144 * 65536 / this.clock);
    this.setDeltaN(delta);
    return delta * this.clock / (144 * 65536);
  }
  /** Linear level 0..255 (0=silence). @param {number} volume */
  setVolume(volume) { this._write(11, adpcmInteger("volume", volume, 255)); }
   /** Stereo gates; preserves memory-mode bits from raw register writes.  @param {boolean} right  @param {boolean} left */
  setPan(left, right) {
    if (typeof left !== "boolean" || typeof right !== "boolean") throw new TypeError("ADPCM-B pan expects booleans");
    this._write(1, (this.registers[1] & 0x3f) | (left ? 128 : 0) | (right ? 64 : 0));
  }
  /** Start/retrigger the selected range. Repeat loops the entire range, not a separate loop point. */
  keyOn({repeat = false} = {}) {
    if (typeof repeat !== "boolean") throw new TypeError("ADPCM-B repeat must be boolean");
    this._write(0, repeat ? 0xb0 : 0xa0);
  }
  /** Stop and clear decoder history on the next synthesis update. */
  keyOff() { this._write(0, 1); }
  /** Reset ADPCM-B controls only, retaining sample memory and all other sound sources. */
  reset() {
    this.keyOff();
    for (let r = 1; r < 16; r++) {
      if (r === 8) continue; // CPU data register has memory-transfer side effects.
      this._write(r, r === 12 || r === 13 ? 255 : 0);
    }
  }
}

/** Six-channel FM (including CH3 special), three-channel SSG, fixed-ROM rhythm and ADPCM-B playback. */
export class YM2608Synth extends OPNFMSynth {
  /** @param {{transport: import('./opn_fm_synth.js').OPNTransport, clock?: number}} options
   * clock is the master clock in Hz. SSG frequency helpers assume standard prescaling.
   */
  constructor({ transport, clock = YM2608_CLOCK } = {}) {
    if (!transport || typeof transport.write !== 'function') throw new TypeError('YM2608 requires a write transport');
    let timedState = createYm2608OperationResetState(), timedComplete = true;
    const originalTransport = transport;
    const observe = (port, register, value) => {
      observeYm2608OperationWrite(timedState, port, register, value);
      if (port === 0 && [0x2d, 0x2e, 0x2f].includes(register)) {
        timedState.prescaler = register === 0x2d ? 6 : register === 0x2e ? 3 : 2;
      }
    };
    transport = Object.create(originalTransport);
    transport.write = (port, register, value) => {
      const result = originalTransport.write(port, register, value);
      observe(port, register, value);
      return result;
    };
    transport.reset = () => {
      const result = originalTransport.reset?.();
      timedState = createYm2608OperationResetState(); timedComplete = true;
      return result;
    };
    if (originalTransport.writeBatch) transport.writeBatch = writes => {
      const result = originalTransport.writeBatch(writes);
      for (const {port, register, value} of writes) observe(port, register, value);
      return result;
    };
    super({
      transport,
      clock,
      chipName: "YM2608",
      channelCount: 6,
      portCount: 2,
      supportsPan: true,
      supportsLfo: true,
    });
    this.adpcm = new YM2608AdpcmSynth({
      write: (register, value) => this.write(1, register, value),
      loadMemory: (bytes, address) => {
        if (typeof this.transport.loadAdpcmMemory !== "function") throw new Error("Transport does not support ADPCM-B memory loading");
        return this.transport.loadAdpcmMemory(bytes, address);
      },
    }, clock);
    this.rhythm = new YM2608RhythmSynth({
      write: (register, value) => this.write(0, register, value),
      loadRom: bytes => {
        if (typeof this.transport.loadRhythmRom !== "function") throw new Error("Transport does not support rhythm ROM loading");
        return this.transport.loadRhythmRom(bytes);
      },
    });
    // YM2608's effective SSG clock is master / 4 at the standard prescaler.
    // After raw prescaler changes, update ssg.clock or use explicit periods.
    this.ssg = new SSGSynth({
      transport: { write: (register, value) => this.write(0, register, value) },
      clock: clock / 4,
    });
    Object.defineProperties(this,{
      _timedClientStateComplete:{get:()=>timedComplete},
      _invalidateTimedState:{value:()=>{timedComplete=false;}},
      _adoptTimedState:{value:state=>{timedState=validateYm2608OperationState(state);this.rhythm.levels.set(timedState.rhythmLevels);this.adpcm.registers.set(timedState.adpcmRegisters);timedComplete=true;}},
      _getTimedState:{value:()=>({...structuredClone(timedState),ssgLevels:this.ssg._getState().levels.map(v=>v&31),rhythmLevels:Array.from(this.rhythm.levels),adpcmRegisters:Array.from(this.adpcm.registers)})},
    });
  }

  /** Reset the chip and enable all six FM channels, preserving default IRQ enables. */
  reset() {
    super.reset();
    this.ssg?.resetState();
    this.rhythm?.resetState();
    this.adpcm?.resetState();
    this.write(0, 0x29, 0x9f);
  }

  /** @param {number} port
   * @param {number} value
   * @param {number} register */
  _write(port, register, value) {
    super._write(port, register, value);
    if (port === 0) {
      this.ssg?.observeWrite(register, value);
      this.rhythm?.observeWrite(register, value);
    } else if (port === 1) this.adpcm?.observeWrite(register, value);
  }
}

/** Browser-hosted YM2608 FM synth with shared Tetorica audio services. */
export class YM2608RuntimeSynth extends OPNRuntimeSynth {
  /** @param {import('./opn_runtime_synth.js').OPNRuntimeSynthOptions & {outputGains?:import('./ym2608.js').Ym2608OutputGainPatch,sourceGains?:import('./ym2608.js').Ym2608SourceGainPatch}} [options] */
  constructor(options = {}) {
    const outputGains = normalizeYm2608OutputGains(options.outputGains ?? {});
    const sourceGains = normalizeYm2608SourceGains(options.sourceGains ?? {});
    super(options, {
      chip: "ym2608",
      chipName: "YM2608",
      fmChannels: 6,
      portCount: 2,
      processorName: "ym2608-processor",
      workletUrl: "./ym2608-worklet.js",
      wasmUrl: "./generated/ym2608_wasm.wasm",
      FMSynth: YM2608Synth,
      rhythmRomUrl: new URL('./tetorica_ym2608_adpcm_rom.bin', import.meta.url),
    });
    this.outputGains = outputGains;
    this.sourceGains = sourceGains;
  }

  async start() {
    await super.start();
    if(!this.fm._timedOperations){
      const port=this.node.port;
      trackSsgRetainedLevels(this.fm,(channel,level)=>port.postMessage({method:'ym2608Retained',args:[channel,level]}));
      attachYm2608TimedClient(this.fm,{engine:'ymfm'},port);
    }
    this.node.port.postMessage({type:'output-gains',gains:this.getOutputGains()});
    if (Object.values(this.sourceGains).some(value => value !== 1)) this.node.port.postMessage({type:'source-gains',gains:this.getSourceGains()});
    return this;
  }

  close() { this.fm?.dispose?.(); return super.close(); }

  /** Configure host software gains before the native outputs are combined.
   * FM includes Rhythm and ADPCM-B. Settings survive close/restart and reset.
   * @param {import('./ym2608.js').Ym2608OutputGainPatch} gains Partial linear gains, each 0..1024.
   * @returns {import('./ym2608.js').Ym2608OutputGains} Accepted gains.
   */
  setOutputGains(gains) {
    this.outputGains = normalizeYm2608OutputGains(gains,this.outputGains);
    if (this.isReady()) this.node.port.postMessage({type:'output-gains',gains:this.getOutputGains()});
    return this.getOutputGains();
  }

  /** @returns {import('./ym2608.js').Ym2608OutputGains} Detached linear gains. */
  getOutputGains() { return {...this.outputGains}; }

  /** Configure independent host gains without changing chip registers.
   * @param {import('./ym2608.js').Ym2608SourceGainPatch} gains Partial linear gains, each 0..1024.
   * @returns {import('./ym2608.js').Ym2608SourceGains} Accepted gains.
   */
  setSourceGains(gains) {
    this.sourceGains = normalizeYm2608SourceGains(gains,this.sourceGains);
    if (this.isReady()) this.node.port.postMessage({type:'source-gains',gains:this.getSourceGains()});
    return this.getSourceGains();
  }

  /** @returns {import('./ym2608.js').Ym2608SourceGains} Detached independent source gains. */
  getSourceGains() { return {...this.sourceGains}; }
}
