/**
 * Shared high-level FM register helpers for Yamaha OPN-family chips.
 *
 * The chip-specific modules configure channel/port counts and expose a
 * named public class. Keeping the register math here avoids drifting
 * YM2203 and YM2608 APIs as they grow.
 */

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
export class OPNDirectTransport {
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

  write(port, register, value) {
    assertRange("port", port, 0, this.portCount - 1);
    this.chip.write(port * 2, register);
    this.chip.write((port * 2) + 1, value);
  }

  read(offset) {
    if (typeof this.chip.read !== "function") {
      throw new Error(`${this.chipName}DirectTransport chip does not support read(offset)`);
    }
    return this.chip.read(offset);
  }

  readStatus() {
    return typeof this.chip.readStatus === "function"
      ? this.chip.readStatus()
      : this.read(0);
  }

  getIrq() {
    return typeof this.chip.getIrq === "function" && this.chip.getIrq();
  }
}

export class OPNFMSynth {
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

  setAlgo(channel, algorithm, feedback = 0) {
    this._assertChannel(channel);
    const state = this.channels[channel];
    state.algorithm = assertRange("algorithm", algorithm, 0, 7);
    state.feedback = assertRange("feedback", feedback, 0, 7);
    const { port, channelOffset } = this._splitChannel(channel);
    this._write(port, 0xb0 + channelOffset, (state.feedback << 3) | state.algorithm);
  }

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

  setLfo(enabled, frequency) {
    if (!this.supportsLfo) {
      throw new Error(`${this.chipName} does not support FM LFO`);
    }
    this.lfo.enabled = assertBoolean("enabled", enabled);
    this.lfo.frequency = assertRange("frequency", frequency, 0, 7);
    this._write(0, 0x22, (this.lfo.enabled ? 0x08 : 0) | this.lfo.frequency);
  }

  setChannel3SpecialMode(enabled) {
    const value = assertBoolean("enabled", enabled);
    this._modeRegister = value ? this._modeRegister | 0x40 : this._modeRegister & ~0x40;
    this._write(0, 0x27, this._modeRegister);
  }

  setChannel3SpecialFrequency(operator, block, fnum) {
    assertRange("operator", operator, 0, OPERATOR_COUNT - 1);
    const validBlock = assertRange("block", block, 0, 7);
    const validFnum = assertRange("fnum", fnum, 0, 0x7ff);
    const registers = CHANNEL_3_SPECIAL_FREQUENCY_REGISTERS[operator];
    this.channels[2].specialFrequencies[operator] = { block: validBlock, fnum: validFnum };
    this._write(0, registers.high, (validBlock << 3) | ((validFnum >> 8) & 0x07));
    this._write(0, registers.low, validFnum & 0xff);
  }

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

  keyOn(channel, operators = undefined) {
    this._assertChannel(channel);
    this._write(0, 0x28, buildKeyOperatorMask(operators) | KEY_CHANNEL_CODES[channel]);
  }

  keyOff(channel) {
    this._assertChannel(channel);
    this._write(0, 0x28, KEY_CHANNEL_CODES[channel]);
  }

  noteOn(channel, block, fnum) {
    this.setFrequency(channel, block, fnum);
    this.keyOn(channel);
  }

  noteOff(channel) {
    this.keyOff(channel);
  }

  write(port, register, value) {
    this._write(
      assertRange("port", port, 0, this.portCount - 1),
      assertRange("register", register, 0, 0xff),
      assertRange("value", value, 0, 0xff)
    );
  }

  rawWrite(port, register, value) {
    this.write(port, register, value);
  }

  writeAddress(port, register) {
    this._pendingAddressPort = assertRange("port", port, 0, this.portCount - 1);
    this._pendingAddressRegister = assertRange("register", register, 0, 0xff);
  }

  writeData(value) {
    if (this._pendingAddressPort === undefined) {
      throw new Error("writeData(value) requires a previous writeAddress(port, register)");
    }
    this._write(this._pendingAddressPort, this._pendingAddressRegister, assertRange("value", value, 0, 0xff));
  }

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

  readStatus() {
    const value = typeof this.transport.readStatus === "function"
      ? this.transport.readStatus()
      : this.read(0);
    this.hooks.onRead?.({ offset: 0, value });
    this._syncIrq();
    return value;
  }

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

  _writeChannelPanAndModulation(channel) {
    const state = this.channels[channel];
    const { port, channelOffset } = this._splitChannel(channel);
    const pan = this.supportsPan
      ? (state.left ? 0x80 : 0) | (state.right ? 0x40 : 0)
      : 0;
    this._write(port, 0xb4 + channelOffset, pan | (state.ams << 4) | state.pms);
  }

  _splitChannel(channel) {
    return channel < 3
      ? { port: 0, channelOffset: channel }
      : { port: 1, channelOffset: channel - 3 };
  }

  _assertChannel(channel) {
    assertRange("channel", channel, 0, this.channelCount - 1);
  }

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
