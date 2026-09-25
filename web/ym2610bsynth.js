/**
 * @file ym2610bsynth.js
 * 実行環境: Browser / Node.js（クラスにより異なる）
 * 依存: 低レベル Synth / DirectTransport は注入したチップで動作し、Node.js でも使用可能。
 * RuntimeSynth 系の実再生は OPNRuntimeSynth 経由で AudioContext / AudioWorkletNode / fetch を使う。
 */
import { OPNDirectTransport, OPNFMSynth } from "./opn_fm_synth.js";
import { OPNRuntimeSynth } from "./opn_runtime_synth.js";

import { SSGSynth } from "./ssgsynth.js";
import { YM2610B_CLOCK } from "./ym2610b.js";

const NEO_GEO_FM_CHANNELS = [1, 2, 4, 5];

export class YM2610BDirectTransport extends OPNDirectTransport {
  constructor(chip) { super(chip, { chipName: "YM2610B", portCount: 2 }); }
  /** Transfer encoded A/B data. Keep the full address space so later loads never truncate earlier samples. */
  loadAdpcmMemory(type, bytes, address) { return this.chip.loadAdpcmRom(type, bytes, address, 0x1000000); }
}

const adpcmInteger = (name, value, max) => {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid ADPCM ${name}`);
  return value;
};

/** YM2610B ADPCM-B external-memory playback, using ROM addressing (256-byte units).
 * Browser / Worker / Node.js: no file decoding, audio output or memory ownership here.
 */
export class YM2610BAdpcmBSynth {
  /** @param {{write: function(number, number): void, loadMemory: function(Uint8Array, number): void}} transport
   * @param {number} clock Master clock in Hz; rate conversion assumes standard FM prescaling.
   */
  constructor(transport, clock = YM2610B_CLOCK) {
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
  /** Track normalized ADPCM-B writes through the parent Synth. */
  observeWrite(register, value) {
    if (register >= 0 && register < 12) this.registers[register] = value;
  }
  _write(register, value) {
    this.transport.write(register, value);
    this.observeWrite(register, value);
  }
  /** Transfer encoded ADPCM-B, not WAV, PCM or rhythm ADPCM-A.
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {number} [address=0] Byte offset in the 16 MiB memory.
   */
  loadMemory(bytes, address = 0) {
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    if (!(bytes instanceof Uint8Array)) throw new TypeError("ADPCM-B memory requires Uint8Array or ArrayBuffer");
    adpcmInteger("address", address, 0x1000000);
    if (bytes.length > 0x1000000 - address) throw new RangeError("ADPCM-B memory exceeds 16 MiB");
    return this.transport.loadMemory(bytes, address);
  }
  /** Configure a byte range [start, end). Both boundaries must be 256-byte aligned.
   * Call while stopped. The chip uses fixed ROM addressing.
   * @param {{start: number, end: number}} range End is exclusive, unlike the hardware register.
   */
  setSample({start, end}) {
    adpcmInteger("start", start, 0xffffff);
    adpcmInteger("end", end, 0x1000000);
    if (end <= start || start % 256 || end % 256) throw new RangeError("ADPCM-B range must be nonempty and 256-byte aligned");
    this._write(1, this.registers[1] & 0xc0);
    const first = start / 256, last = end / 256 - 1;
    this._write(2, first & 255); this._write(3, first >> 8);
    this._write(4, last & 255); this._write(5, last >> 8);

  }
  /** Set raw Delta-N 1..65535. Can change while playing. */
  setDeltaN(value) {
    adpcmInteger("Delta-N", value, 65535);
    if (!value) throw new RangeError("ADPCM-B Delta-N must be positive");
    this._write(9, value & 255); this._write(10, value >> 8);
  }
  /** Set decoded PCM samples/second, not byte rate. Returns the quantized actual rate.
   * A byte contains two samples; changing this rate changes both speed and pitch.
   */
  setPlaybackRate(rate) {
    if (!Number.isFinite(rate) || rate <= 0) throw new RangeError("Invalid ADPCM-B playback rate");
    const delta = Math.round(rate * 144 * 65536 / this.clock);
    this.setDeltaN(delta);
    return delta * this.clock / (144 * 65536);
  }
  /** Linear level 0..255 (0=silence). */
  setVolume(volume) { this._write(11, adpcmInteger("volume", volume, 255)); }
  /** Stereo gates; preserves memory-mode bits from raw register writes. */
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
    for (let r = 1; r < 12; r++) {
      if (r === 8) continue; // CPU data register has memory-transfer side effects.
      this._write(r, r === 12 || r === 13 ? 255 : 0);
    }
  }
}

/** Six independent ADPCM-A ROM voices. Fixed decoded rate clock/432; no hardware repeat or pitch control. */
export class YM2610BAdpcmASynth {
  /** @param {{write: function(number, number): void, loadMemory: function(Uint8Array, number): void}} transport */
  constructor(transport) { this.transport = transport; this.resetState(); }
  /** Reset only the register shadow after a whole-chip reset. */
  resetState() { this.levels = new Uint8Array(6); }
  /** Track normalized port-1 register writes. */
  observeWrite(reg, value) { if (reg >= 8 && reg < 14) this.levels[reg-8] = value; }
  /** Transfer ADPCM-A bytes (not ADPCM-B or WAV) into the 16 MiB ROM address space. */
  loadMemory(bytes, address = 0) {
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    if (!(bytes instanceof Uint8Array)) throw new TypeError("ADPCM-A expects binary bytes");
    adpcmInteger("address", address, 0x1000000);
    if (bytes.length > 0x1000000-address) throw new RangeError("ADPCM-A ROM range exceeded");
    return this.transport.loadMemory(bytes, address);
  }
  /** Select [start,end) byte addresses on a voice 0..5, both aligned to 256 bytes.
   * Limit each range to less than 1 MiB: the core compares only the low 20 address bits at the end.
   */
  setSample(ch, {start, end}) {
    adpcmInteger("voice", ch, 5);
    adpcmInteger("start", start, 0xffffff); adpcmInteger("end", end, 0x1000000);
    if (start % 256 || end % 256 || end <= start || end-start >= 0x100000) throw new RangeError("ADPCM-A range must be aligned, nonempty and shorter than 1 MiB");
    const first=start/256, last=end/256-1;
    for (const [reg,value] of [[0x10,first&255],[0x18,first>>8],[0x20,last&255],[0x28,last>>8]]) this.transport.write(reg+ch,value);
  }
  /** Global hardware level 0..63, increasing loudness. */
  setVolume(volume) { this.transport.write(1, adpcmInteger("volume", volume, 63)); }
  /** Individual level 0..31 and stereo gates; omitted values are retained. */
  setVoice(ch, {volume, left, right} = {}) {
    adpcmInteger("voice", ch, 5);
    let value=this.levels[ch];
    if (volume !== undefined) value=(value&0xe0)|adpcmInteger("voice volume",volume,31);
    for (const [flag,mask] of [[left,128],[right,64]]) {
      if (flag === undefined) continue;
      if (typeof flag !== "boolean") throw new TypeError("Pan gates must be boolean");
      value=flag ? value|mask : value&~mask;
    }
    this.transport.write(8+ch,value); this.levels[ch]=value;
  }
  /** Trigger a voice or array of voices, restarting each from its selected start. */
  keyOn(voices) { this._key(voices,false); }
  /** Stop a voice or array of voices. */
  keyOff(voices) { this._key(voices,true); }
  _key(voices,off) {
    const list=Array.isArray(voices)?voices:[voices];
    if (!list.length) return;
    const mask=list.reduce((m,ch)=>m|(1<<adpcmInteger("voice",ch,5)),0);
    this.transport.write(0,(off?128:0)|mask);
  }
  /** Stop/reset A controls and ranges, preserving ROM and other sound sources. */
  reset() {
    this.keyOff([0,1,2,3,4,5]); this.setVolume(0);
    for (let ch=0;ch<6;ch++) {
      this.setVoice(ch,{volume:0,left:false,right:false});
      this.setSample(ch,{start:0,end:256});
    }
  }
}

/** Six-channel FM, CH3 special, SSG, and separate ADPCM-A/B ROM playback. */
export class YM2610BSynth extends OPNFMSynth {
  /** @param {{transport: OPNDirectTransport, clock?: number}} options Master clock in Hz, default 8 MHz. */
  constructor({ transport, clock = YM2610B_CLOCK } = {}) {
    super({ transport, chipName: "YM2610B", channelCount: 6, portCount: 2, supportsPan: true, supportsLfo: true });
    const load = type => (bytes,address) => {
      if (typeof transport.loadAdpcmMemory !== "function") throw new Error("Transport does not support ADPCM ROM loading");
      return transport.loadAdpcmMemory(type,bytes,address);
    };
    this.ssg = new SSGSynth({transport:{write:(r,v)=>this.write(0,r,v)}, clock:clock/4});
    this.adpcmA = new YM2610BAdpcmASynth({write:(r,v)=>this.write(1,r,v),loadMemory:load(0)});
    this.adpcmB = new YM2610BAdpcmBSynth({write:(r,v)=>this.write(0,0x10+r,v),loadMemory:load(1)},clock);
    this.adpcm = this.adpcmB; // Same single ADPCM-B interface as YM2608.
  }
  /** Reset the chip, retaining ROM contents. */
  reset() {
    super.reset(); this.ssg?.resetState(); this.adpcmA?.resetState(); this.adpcmB?.resetState();
  }
  _write(port,register,value) {
    super._write(port,register,value);
    if (port === 0 && register < 14) this.ssg?.observeWrite(register,value);
    if (port === 0 && register >= 0x10 && register < 0x1c) this.adpcmB?.observeWrite(register-0x10,value);
    if (port === 1) this.adpcmA?.observeWrite(register,value);
  }
}

/** Browser-hosted full YM2610B core. */
export class YM2610BRuntimeSynth extends OPNRuntimeSynth {
  constructor(options = {}) {
    super(options, {
      chip: "ym2610b", chipName: "YM2610B", fmChannels: 6, portCount: 2,
      processorName: "ym2610b-processor", workletUrl: "./ym2610b-worklet.js",
      wasmUrl: "./generated/ym2610b_wasm.wasm", FMSynth: YM2610BSynth,
    });
  }
}

/**
 * Neo Geo exposes four YM2610 FM channels. They are not the first four OPN
 * channels, so this facade maps compact logical channels to hardware ones.
 */
export class NeoGeoFMSynth {
  constructor(fm) { this.fm = fm; this.channelCount = 4; }
  reset() { this.fm.reset(); }
  write(...args) { return this.fm.write(...args); }
  read(...args) { return this.fm.read?.(...args); }
  readStatus(...args) { return this.fm.readStatus?.(...args); }
  getIrq(...args) { return this.fm.getIrq?.(...args); }
  setLfo(...args) { return this.fm.setLfo(...args); }
  setChannel3SpecialMode(...args) { return this.fm.setChannel3SpecialMode(...args); }
  setChannel3SpecialFrequency(...args) { return this.fm.setChannel3SpecialFrequency(...args); }
  setPreset(channel, ...args) { return this.fm.setPreset(this.#channel(channel), ...args); }
  setOperator(channel, ...args) { return this.fm.setOperator(this.#channel(channel), ...args); }
  setAlgo(channel, ...args) { return this.fm.setAlgo(this.#channel(channel), ...args); }
  setPan(channel, ...args) { return this.fm.setPan(this.#channel(channel), ...args); }
  setModulation(channel, ...args) { return this.fm.setModulation(this.#channel(channel), ...args); }
  setFrequency(channel, ...args) { return this.fm.setFrequency(this.#channel(channel), ...args); }
  keyOn(channel, ...args) { return this.fm.keyOn(this.#channel(channel), ...args); }
  keyOff(channel, ...args) { return this.fm.keyOff(this.#channel(channel), ...args); }
  noteOn(channel, ...args) { return this.fm.noteOn(this.#channel(channel), ...args); }
  noteOff(channel, ...args) { return this.fm.noteOff(this.#channel(channel), ...args); }
  #channel(channel) {
    const physical = NEO_GEO_FM_CHANNELS[Number(channel)];
    if (physical === undefined) throw new Error("Neo Geo FM channel must be 0..3");
    return physical;
  }
}

/** Neo Geo YM2610 profile built on the YM2610B core. */
export class NeoGeoSynth extends YM2610BRuntimeSynth {
  constructor(options = {}) {
    super(options);
    this.chip = "ym2610";
    this.capabilities = Object.freeze({ chip: "ym2610", fmChannels: 4, psg: false, dac: false, recorder: false });
    this.rawFm = null;
  }

  async start() {
    await super.start();
    if (!(this.fm instanceof NeoGeoFMSynth)) {
      this.rawFm = this.fm;
      this.fm = new NeoGeoFMSynth(this.rawFm);
    }
    return this;
  }
}
