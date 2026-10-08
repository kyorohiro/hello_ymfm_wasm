/**
 * @file opn_fm_synth.js
 * 実行環境: Browser / Node.js
 * 依存: 注入されたレジスタ transport。DirectTransport は Node.js でも使用可能。
 * WorkletTransport はブラウザーの AudioWorkletNode（port）を受け取る。
 */
/**
 * Shared high-level FM register helpers for Yamaha OPN-family chips.
 *
 * The chip-specific modules configure channel/port counts and expose a
 * named public class. Keeping the register math here avoids drifting
 * YM2203 and YM2608 APIs as they grow.
 */

/** @typedef {import('./ym2612synth.js').YM2612Transport} OPNTransport */

const OPERATOR_COUNT = 4;
const KEY_OPERATOR_BITS = [0x10, 0x20, 0x40, 0x80];
const OPERATOR_SLOT_OFFSETS = [0x00, 0x08, 0x04, 0x0c];
const KEY_CHANNEL_CODES = [0x00, 0x01, 0x02, 0x04, 0x05, 0x06];
const CHANNEL_3_SPECIAL_FREQUENCY_REGISTERS = [
  { low: 0xa9, high: 0xad },
  { low: 0xaa, high: 0xae },
  { low: 0xa8, high: 0xac },
  { low: 0xa2, high: 0xa6 },
];

const DEFAULT_OPERATOR_STATE = Object.freeze({
  dt: 0,
  multi: 1,
  tl: 0x7f,
  rs: 0,
  ar: 0,
  am: false,
  d1r: 0,
  d2r: 0,
  sl: 0,
  rr: 15,
  ssg: 0,
});

/**
 * Direct bus transport for `Ym2203` and `Ym2608` wrappers.
 * Their WASM API uses address/data offsets rather than a packed register
 * method, while the synth API consistently uses `write(port, reg, value)`.
 */
/** @template {{write(offset:number,value:number):void}} Chip */
export class OPNDirectTransport {
  /** @param {Chip} chip
   * @param {{chipName:string, portCount:number}} config */
  constructor(chip, { chipName, portCount }) {
    if (!chip || typeof chip.write !== "function") {
      throw new Error(`${chipName}DirectTransport requires a chip with write(offset, data)`);
    }
    this.chip = chip;
    this.chipName = chipName;
    this.portCount = portCount;
  }

  reset() {
    this.chip.reset?.();
  }

  /** @param {number} port
   * @param {number} register
   * @param {number} value */
  write(port, register, value) {
    assertRange("port", port, 0, this.portCount - 1);
    this.chip.write(port * 2, register);
    this.chip.write((port * 2) + 1, value);
  }

  /** @param {number} offset
   * @returns {number} Register value; zero when native reads are unavailable. */
  read(offset) {
    if (typeof this.chip.read !== "function") {
      throw new Error(`${this.chipName}DirectTransport chip does not support read(offset)`);
    }
    return this.chip.read(offset);
  }

  /** @returns {number} */
  readStatus() {
    return typeof this.chip.readStatus === "function"
      ? this.chip.readStatus()
      : this.read(0);
  }

  /** @returns {boolean} */
  getIrq() {
    return typeof this.chip.getIrq === "function" && this.chip.getIrq();
  }
}

/**
 * Worklet transport shared by browser-hosted OPN chips. The worklet protocol
 * uses the same port/register/value shape as the high-level FM API.
 */
export class OPNWorkletTransport {
  /** @param {Uint8Array} bytes */
  loadRhythmRom(bytes) {
    if (this.chipName !== 'YM2608') throw new Error('Rhythm ROM loading requires YM2608');
    if (!(bytes instanceof Uint8Array) || bytes.length !== 8192) throw new RangeError('Expected 8192-byte rhythm ROM');
    this.node.port.postMessage({type: 'loadRhythmRom', bytes});
  }
  /** @param {AudioWorkletNode|MessagePort|import('./soundchip_worklet.js').WorkletSoundChip} node
   * @param {{portCount:number,chipName:string}} config */
  constructor(node, { portCount, chipName }) {
    /** @type {import('./soundchip_worklet.js').WorkletSoundChip|null} */
    this.endpoint = node?.execution === 'worklet' ? node : null;
    if (!node?.port && node?.postMessage) node = {port: node};
    if (!node?.port?.postMessage) {
      throw new Error(`${chipName}WorkletTransport requires an AudioWorkletNode`);
    }
    this.node = node;
    this.portCount = portCount;
    this.chipName = chipName;
    this.memorySequence = 0;
    this.memoryRequests = new Map();
    this.disposed = false;
    this.onMemoryMessage = ({data}) => {
      if (data?.type !== 'adpcm-memory-loaded') return;
      const request = this.memoryRequests.get(data.id);
      if (!request) return;
      this.memoryRequests.delete(data.id);
      data.error ? request.reject(new Error(data.error)) : request.resolve();
    };
    this.node.port.addEventListener?.('message', this.onMemoryMessage);
    this.node.port.start?.();
  }

  start() {
    if (!this.endpoint) return Promise.reject(new Error('start() requires a createSoundChip worklet endpoint'));
    return this.endpoint.start();
  }
  stop() {return this.endpoint?.stop() ?? Promise.resolve();}
  async close() {this.dispose(); await this.endpoint?.dispose();}
  flush() {return this.endpoint?.request('barrier') ?? Promise.resolve();}

  /** @param {Uint8Array} bytes
   * @param {number} [address] */
  loadAdpcmMemory(bytes, address = 0) {
    if (this.disposed) return Promise.reject(new Error('ADPCM transport disposed'));
    if (this.chipName !== 'YM2608') return Promise.reject(new Error('ADPCM memory upload requires YM2608'));
    if (!(bytes instanceof Uint8Array) || !Number.isInteger(address) || address < 0 || address + bytes.length > 0x200000) return Promise.reject(new RangeError('Invalid ADPCM memory upload'));
    const id = ++this.memorySequence;
    return new Promise((resolve, reject) => {
      this.memoryRequests.set(id, {resolve, reject});
      try { this.node.port.postMessage({type: 'loadAdpcmMemory', id, bytes, address}); }
      catch (error) { this.memoryRequests.delete(id); reject(error); }
    });
  }

  dispose() {
    this.disposed = true;
    this.node.port.removeEventListener?.('message', this.onMemoryMessage);
    for (const request of this.memoryRequests.values()) request.reject(new Error('ADPCM transport disposed'));
    this.memoryRequests.clear();
  }

  reset() {
    this.node.port.postMessage({ type: "reset" });
  }

  /** @param {number} port
   * @param {number} register
   * @param {number} value */
  write(port, register, value) {
    assertRange("port", port, 0, this.portCount - 1);
    this.node.port.postMessage({
      type: "write",
      port,
      register,
      value,
    });
  }
}

export class OPNFMSynth {
  /** @param {{transport:OPNTransport,chipName:string,channelCount:number,portCount:number,supportsPan?:boolean,supportsLfo?:boolean}} options */
  constructor({
    transport,
    chipName,
    channelCount,
    portCount,
    supportsPan = false,
    supportsLfo = false,
  }) {
    if (!transport || typeof transport.write !== "function") {
      throw new Error(`${chipName}Synth requires a transport with write(port, register, value)`);
    }

    this.transport = transport;
    this.chipName = chipName;
    this.channelCount = channelCount;
    this.portCount = portCount;
    this.supportsPan = supportsPan;
    this.supportsLfo = supportsLfo;
    this.hooks = { onWrite: undefined, onRead: undefined, onIrq: undefined };
    this._lastIrqState = undefined;
    this.reset();
  }

  reset() {
    this.transport.reset?.();
    this._pendingAddressPort = undefined;
    this._pendingAddressRegister = undefined;
    this._modeRegister = 0;
    this.lfo = { enabled: false, frequency: 0 };
    this.channels = Array.from(
      { length: this.channelCount },
      () => createDefaultChannelState(this.supportsPan)
    );
    this._syncIrq();
  }

  /** @param {number} channel
   * @param {import('./ym2612synth.js').YM2612Preset} preset */
  setPreset(channel, preset) {
    this._assertChannel(channel);
    if (!preset || typeof preset !== "object") {
      throw new Error("preset must be an object");
    }

    const current = this.channels[channel];
    if (preset.algorithm !== undefined || preset.feedback !== undefined) {
      this.setAlgo(
        channel,
        preset.algorithm ?? current.algorithm,
        preset.feedback ?? current.feedback
      );
    }
    if (preset.ams !== undefined || preset.pms !== undefined) {
      this.setModulation(channel, preset.ams ?? current.ams, preset.pms ?? current.pms);
    }
    if (preset.pan) {
      if (!this.supportsPan) {
        throw new Error(`${this.chipName} does not support stereo pan`);
      }
      this.setPan(
        channel,
        preset.pan.left ?? current.left,
        preset.pan.right ?? current.right,
        preset.ams ?? current.ams,
        preset.pms ?? current.pms
      );
    }
    if (Array.isArray(preset.operators)) {
      preset.operators.forEach((params, operator) => {
        if (params) {
          this.setOperator(channel, operator, params);
        }
      });
    }
  }

  /**
   * Apply partial operator settings in order, retaining repeated entries.
   * Validate the entire batch before changing state or writing registers.
   * @param {number} channel
   * @param {Array<[number, import('./ym2612synth.js').YM2612OperatorParams]>} entries
   */
  setOperators(channel, entries) {
    this._assertChannel(channel);
    if (!Array.isArray(entries)) throw new Error("entries must be an array");
    const validated = Array.from(entries, entry => {
      if (!Array.isArray(entry) || entry.length !== 2) throw new Error("entry must be [operator, params]");
      const [operator, params] = entry;
      assertRange("operator", operator, 0, OPERATOR_COUNT - 1);
      return [operator, validateOperatorParams(params)];
    });
    for (const [operator, params] of validated) this.setOperator(channel, operator, params);
  }

  /** @param {number} channel
   * @param {number} operator
   * @param {import('./ym2612synth.js').YM2612OperatorParams} params */
  setOperator(channel, operator, params) {
    this._assertChannel(channel);
    assertRange("operator", operator, 0, OPERATOR_COUNT - 1);
    if (!params || typeof params !== "object") {
      throw new Error("params must be an object");
    }

    const state = this.channels[channel].operators[operator];
    const { port, channelOffset } = this._splitChannel(channel);
    const slotOffset = OPERATOR_SLOT_OFFSETS[operator];
    const write = (base, value) => this._write(port, base + channelOffset + slotOffset, value);

    if (params.dt !== undefined || params.multi !== undefined) {
      state.dt = params.dt === undefined ? state.dt : assertRange("dt", params.dt, 0, 7);
      state.multi = params.multi === undefined ? state.multi : assertRange("multi", params.multi, 0, 15);
      write(0x30, (state.dt << 4) | state.multi);
    }
    if (params.tl !== undefined) {
      state.tl = assertRange("tl", params.tl, 0, 127);
      write(0x40, state.tl);
    }
    if (params.rs !== undefined || params.ar !== undefined) {
      state.rs = params.rs === undefined ? state.rs : assertRange("rs", params.rs, 0, 3);
      state.ar = params.ar === undefined ? state.ar : assertRange("ar", params.ar, 0, 31);
      write(0x50, (state.rs << 6) | state.ar);
    }
    if (params.am !== undefined || params.d1r !== undefined) {
      state.am = params.am === undefined ? state.am : assertBoolean("am", params.am);
      state.d1r = params.d1r === undefined ? state.d1r : assertRange("d1r", params.d1r, 0, 31);
      write(0x60, (state.am ? 0x80 : 0) | state.d1r);
    }
    if (params.sr !== undefined || params.d2r !== undefined) {
      state.d2r = assertRange("d2r", params.sr ?? params.d2r, 0, 31);
      write(0x70, state.d2r);
    }
    if (params.sl !== undefined || params.rr !== undefined) {
      state.sl = params.sl === undefined ? state.sl : assertRange("sl", params.sl, 0, 15);
      state.rr = params.rr === undefined ? state.rr : assertRange("rr", params.rr, 0, 15);
      write(0x80, (state.sl << 4) | state.rr);
    }
    if (params.ssg !== undefined) {
      state.ssg = assertRange("ssg", params.ssg, 0, 15);
      write(0x90, state.ssg);
    }
  }

  /** @param {number} channel
   * @param {number} algorithm
   * @param {number} [feedback] */
  setAlgo(channel, algorithm, feedback = 0) {
    this._assertChannel(channel);
    const state = this.channels[channel];
    state.algorithm = assertRange("algorithm", algorithm, 0, 7);
    state.feedback = assertRange("feedback", feedback, 0, 7);
    const { port, channelOffset } = this._splitChannel(channel);
    this._write(port, 0xb0 + channelOffset, (state.feedback << 3) | state.algorithm);
  }

  /** @param {number} channel
   * @param {number} ams
   * @param {number} pms */
  setModulation(channel, ams, pms) {
    this._assertChannel(channel);
    if (!this.supportsLfo) {
      throw new Error(`${this.chipName} does not support FM LFO modulation`);
    }
    const state = this.channels[channel];
    state.ams = assertRange("ams", ams, 0, 3);
    state.pms = assertRange("pms", pms, 0, 7);
    this._writeChannelPanAndModulation(channel);
  }

  /** @param {number} channel
   * @param {number} [ams]
   * @param {number} [pms] */
  /** @param {boolean} left
   * @param {boolean} right */
  setPan(channel, left, right, ams = undefined, pms = undefined) {
    this._assertChannel(channel);
    if (!this.supportsPan) {
      throw new Error(`${this.chipName} does not support stereo pan`);
    }
    const state = this.channels[channel];
    state.left = assertBoolean("left", left);
    state.right = assertBoolean("right", right);
    state.ams = assertRange("ams", ams ?? state.ams, 0, 3);
    state.pms = assertRange("pms", pms ?? state.pms, 0, 7);
    this._writeChannelPanAndModulation(channel);
  }

  /** @param {number} frequency */
  /** @param {boolean} enabled */
  setLfo(enabled, frequency) {
    if (!this.supportsLfo) {
      throw new Error(`${this.chipName} does not support FM LFO`);
    }
    this.lfo.enabled = assertBoolean("enabled", enabled);
    this.lfo.frequency = assertRange("frequency", frequency, 0, 7);
    this._write(0, 0x22, (this.lfo.enabled ? 0x08 : 0) | this.lfo.frequency);
  }

  /** @param {boolean} enabled */
  setChannel3SpecialMode(enabled) {
    const value = assertBoolean("enabled", enabled);
    this._modeRegister = value ? this._modeRegister | 0x40 : this._modeRegister & ~0x40;
    this._write(0, 0x27, this._modeRegister);
  }

  /** @param {number} operator
   * @param {number} block
   * @param {number} fnum */
  setChannel3SpecialFrequency(operator, block, fnum) {
    assertRange("operator", operator, 0, OPERATOR_COUNT - 1);
    const validBlock = assertRange("block", block, 0, 7);
    const validFnum = assertRange("fnum", fnum, 0, 0x7ff);
    const registers = CHANNEL_3_SPECIAL_FREQUENCY_REGISTERS[operator];
    this.channels[2].specialFrequencies[operator] = { block: validBlock, fnum: validFnum };
    this._write(0, registers.high, (validBlock << 3) | ((validFnum >> 8) & 0x07));
    this._write(0, registers.low, validFnum & 0xff);
  }

  /** @param {number} channel
   * @param {number} block
   * @param {number} fnum */
  setFrequency(channel, block, fnum) {
    this._assertChannel(channel);
    const validBlock = assertRange("block", block, 0, 7);
    const validFnum = assertRange("fnum", fnum, 0, 0x7ff);
    const state = this.channels[channel];
    state.block = validBlock;
    state.fnum = validFnum;
    const { port, channelOffset } = this._splitChannel(channel);
    this._write(port, 0xa4 + channelOffset, (validBlock << 3) | ((validFnum >> 8) & 0x07));
    this._write(port, 0xa0 + channelOffset, validFnum & 0xff);
  }

  /** @param {number} channel
   * @param {number[]} [operators] */
  keyOn(channel, operators = undefined) {
    this._assertChannel(channel);
    this._write(0, 0x28, buildKeyOperatorMask(operators) | KEY_CHANNEL_CODES[channel]);
  }

  /** @param {number} channel */
  keyOff(channel) {
    this._assertChannel(channel);
    this._write(0, 0x28, KEY_CHANNEL_CODES[channel]);
  }

  /** @param {number} channel
   * @param {number} block
   * @param {number} fnum */
  noteOn(channel, block, fnum) {
    this.setFrequency(channel, block, fnum);
    this.keyOn(channel);
  }

  /** @param {number} channel */
  noteOff(channel) {
    this.keyOff(channel);
  }

  /** @param {number} port
   * @param {number} register
   * @param {number} value */
  write(port, register, value) {
    this._write(
      assertRange("port", port, 0, this.portCount - 1),
      assertRange("register", register, 0, 0xff),
      assertRange("value", value, 0, 0xff)
    );
  }

  /** @param {number} port
   * @param {number} register
   * @param {number} value */
  rawWrite(port, register, value) {
    this.write(port, register, value);
  }

  /** @param {number} port
   * @param {number} register */
  writeAddress(port, register) {
    this._pendingAddressPort = assertRange("port", port, 0, this.portCount - 1);
    this._pendingAddressRegister = assertRange("register", register, 0, 0xff);
  }

  /** @param {number} value */
  writeData(value) {
    if (this._pendingAddressPort === undefined) {
      throw new Error("writeData(value) requires a previous writeAddress(port, register)");
    }
    this._write(this._pendingAddressPort, this._pendingAddressRegister, assertRange("value", value, 0, 0xff));
  }

  /** @param {number} offset
   * @returns {number} Register value; zero when native reads are unavailable. */
  read(offset) {
    if (typeof this.transport.read !== "function") {
      throw new Error(`${this.chipName} transport does not support read(offset)`);
    }
    const validOffset = assertRange("offset", offset, 0, (this.portCount * 2) - 1);
    const value = this.transport.read(validOffset);
    this.hooks.onRead?.({ offset: validOffset, value });
    this._syncIrq();
    return value;
  }

  /** @returns {number} */
  readStatus() {
    const value = typeof this.transport.readStatus === "function"
      ? this.transport.readStatus()
      : this.read(0);
    this.hooks.onRead?.({ offset: 0, value });
    this._syncIrq();
    return value;
  }

  /** @param {import("./ym2612.js").Ym2612Hooks} [hooks] */
  setHooks({ onWrite, onRead, onIrq } = {}) {
    assertHook("onWrite", onWrite);
    assertHook("onRead", onRead);
    assertHook("onIrq", onIrq);
    this.hooks = { onWrite, onRead, onIrq };
    this._lastIrqState = undefined;
    this._syncIrq();
  }

  getState() {
    return clone({ modeRegister: this._modeRegister, lfo: this.lfo, channels: this.channels });
  }

  /** @param {number} channel */
  _writeChannelPanAndModulation(channel) {
    const state = this.channels[channel];
    const { port, channelOffset } = this._splitChannel(channel);
    const pan = this.supportsPan
      ? (state.left ? 0x80 : 0) | (state.right ? 0x40 : 0)
      : 0;
    this._write(port, 0xb4 + channelOffset, pan | (state.ams << 4) | state.pms);
  }

  /** @param {number} channel */
  _splitChannel(channel) {
    return channel < 3
      ? { port: 0, channelOffset: channel }
      : { port: 1, channelOffset: channel - 3 };
  }

  /** @param {number} channel */
  _assertChannel(channel) {
    assertRange("channel", channel, 0, this.channelCount - 1);
  }

  /** @param {number} port
   * @param {number} register */
  _write(port, register, value) {
    const command = { port, register, value };
    if (this.transport.write.length >= 3) {
      this.transport.write(port, register, value);
    } else {
      this.transport.write(command);
    }
    this.hooks.onWrite?.(command);
    this._syncIrq();
  }

  _syncIrq() {
    if (typeof this.transport.getIrq !== "function" || typeof this.hooks.onIrq !== "function") {
      return;
    }
    const asserted = Boolean(this.transport.getIrq());
    if (asserted !== this._lastIrqState) {
      this._lastIrqState = asserted;
      this.hooks.onIrq(asserted);
    }
  }
}

function createDefaultChannelState(supportsPan) {
  return {
    algorithm: 7,
    feedback: 0,
    ams: 0,
    pms: 0,
    left: supportsPan,
    right: supportsPan,
    block: 4,
    fnum: 0,
    specialFrequencies: Array.from({ length: 4 }, () => ({ block: 4, fnum: 0 })),
    operators: Array.from({ length: 4 }, () => ({ ...DEFAULT_OPERATOR_STATE })),
  };
}

function buildKeyOperatorMask(operators) {
  if (operators === undefined) {
    return 0xf0;
  }
  if (!Array.isArray(operators) || operators.length === 0) {
    throw new Error("operators must be a non-empty array when provided");
  }
  return operators.reduce((mask, operator) => mask | KEY_OPERATOR_BITS[assertRange("operator", operator, 0, 3)], 0);
}

function assertRange(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in range ${min}..${max}, got ${value}`);
  }
  return value;
}

function assertBoolean(name, value) {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean, got ${value}`);
  }
  return value;
}

function assertHook(name, value) {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`${name} must be a function when provided`);
  }
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

// Snapshot validated fields so later entries cannot cause partial batch writes.
function validateOperatorParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("params must be an object");
  const result = {};
  const ranges = {dt: 7, multi: 15, tl: 127, rs: 3, ar: 31, d1r: 31, sr: 31, d2r: 31, sl: 15, rr: 15, ssg: 15};
  for (const [name, max] of Object.entries(ranges)) {
    const value = params[name];
    if (value !== undefined) result[name] = assertRange(name, value, 0, max);
  }
  const am = params.am;
  if (am !== undefined) result.am = assertBoolean("am", am);
  return result;
}
