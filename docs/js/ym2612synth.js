/**
 * Thin YM2612 synth layer for browser/game usage.
 *
 * The goal of this file is not to hide the YM2612 too much.
 * It should stay readable enough that someone can look at the code and see:
 *
 * - which YM2612 feature is being used
 * - which register is written
 * - how channel/operator numbers map to register addresses
 *
 * Public API channel numbers are 0..5.
 * Public API operator numbers are 1..4.
 */

/**
 * @typedef {{
 *   write(port: number, register: number, value: number): void,
 *   reset?: () => void,
 *   read?: (offset: number) => number,
 *   readStatus?: () => number,
 *   getIrq?: () => boolean,
 * }} YM2612Transport
 */

/**
 * @typedef {{
 *   dt?: number,
 *   multi?: number,
 *   tl?: number,
 *   rs?: number,
 *   ar?: number,
 *   am?: boolean,
 *   d1r?: number,
 *   sr?: number,
 *   d2r?: number,
 *   sl?: number,
 *   rr?: number,
 *   ssg?: number,
 * }} YM2612OperatorParams
 */

/**
 * @typedef {{
 *   left?: boolean,
 *   right?: boolean,
 * }} YM2612PanParams
 */

/**
 * @typedef {{
 *   algorithm?: number,
 *   feedback?: number,
 *   ams?: number,
 *   pms?: number,
 *   pan?: YM2612PanParams,
 *   left?: boolean,
 *   right?: boolean,
 *   operators?: {
 *     1?: YM2612OperatorParams,
 *     2?: YM2612OperatorParams,
 *     3?: YM2612OperatorParams,
 *     4?: YM2612OperatorParams,
 *   },
 * }} YM2612Preset
 */

/**
 * @typedef {{
 *   transport: YM2612Transport,
 * }} YM2612SynthOptions
 */

const CHANNEL_COUNT = 6;
const OPERATOR_COUNT = 4;

// YM2612 packs channel numbers for key on/off a little differently.
// Public channels:
//   0 -> ch1
//   1 -> ch2
//   2 -> ch3
//   3 -> ch4
//   4 -> ch5
//   5 -> ch6
//
// Key on/off register 0x28 uses:
//   ch1=0x00 ch2=0x01 ch3=0x02 ch4=0x04 ch5=0x05 ch6=0x06
const KEY_CHANNEL_CODES = [0x00, 0x01, 0x02, 0x04, 0x05, 0x06];

// Public operator numbers follow the logical YM2612 algorithm order:
//   O1, O2, O3, O4
//
// YM2612 register slots are laid out in a different physical order:
//   0x30 -> O1
//   0x34 -> O3
//   0x38 -> O2
//   0x3c -> O4
//
// The synth API hides that physical slot order so callers and preset data can
// stay in logical operator order.
const OPERATOR_SLOT_OFFSETS = {
  1: 0x00,
  2: 0x08,
  3: 0x04,
  4: 0x0c,
};

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

const DEFAULT_CHANNEL_STATE = Object.freeze({
  algorithm: 7,
  feedback: 0,
  ams: 0,
  pms: 0,
  left: true,
  right: true,
  block: 4,
  fnum: 0,
});

const DEFAULT_LFO_STATE = Object.freeze({
  enabled: false,
  frequency: 0,
});

/**
 * Direct transport for the current `web/ym2612.js` implementation.
 *
 * This keeps the synth layer from depending on `Ym2612` method names directly.
 * A future AudioWorklet transport can implement the same `write` / `reset` shape.
 */
export class YM2612DirectTransport {
  /**
   * @param {{
   *   writeRegister(register: number, value: number, port?: number): void,
   *   reset?: () => void,
   *   read?: (offset: number) => number,
   *   readStatus?: () => number,
   *   getIrq?: () => boolean,
   * }} chip
   */
  constructor(chip) {
    if (!chip || typeof chip.writeRegister !== "function") {
      throw new Error("YM2612DirectTransport requires a chip with writeRegister(register, value, port)");
    }
    this.chip = chip;
  }

  reset() {
    if (typeof this.chip.reset === "function") {
      this.chip.reset();
    }
  }

  write(port, register, value) {
    this.chip.writeRegister(register, value, port);
  }

  read(offset) {
    if (typeof this.chip.read !== "function") {
      throw new Error("YM2612DirectTransport chip does not support read(offset)");
    }
    return this.chip.read(offset);
  }

  readStatus() {
    if (typeof this.chip.readStatus === "function") {
      return this.chip.readStatus();
    }
    return this.read(0);
  }

  getIrq() {
    if (typeof this.chip.getIrq !== "function") {
      return false;
    }
    return this.chip.getIrq();
  }
}

export class YM2612WorkletTransport {
  /**
   * @param {AudioWorkletNode} node
   */
  constructor(node) {
    this.node = node;
  }

  reset() {
    this.node.port.postMessage({
      type: "reset",
    });
  }

  write(port, register, value) {
    this.node.port.postMessage({
      type: "write",
      port,
      register,
      value,
    });
  }
}

export class YM2612Synth {
  /**
   * @param {YM2612SynthOptions} options
   */
  constructor(options = {}) {
    const { transport } = options;
    if (!transport || typeof transport.write !== "function") {
      throw new Error("YM2612Synth requires a transport with a write(...) function");
    }

    this.transport = transport;
    this.hooks = {
      onWrite: undefined,
      onRead: undefined,
      onIrq: undefined,
    };
    this._lastIrqState = undefined;
    this.channels = [];
    this.reset();
  }

  reset() {
    if (typeof this.transport.reset === "function") {
      this.transport.reset();
    }

    this._pendingAddressPort = undefined;
    this._pendingAddressRegister = undefined;
    this.lfo = {
      enabled: DEFAULT_LFO_STATE.enabled,
      frequency: DEFAULT_LFO_STATE.frequency,
    };
    this.channels = [];
    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      this.channels.push(createDefaultChannelState());
    }

    this._syncIrq();
  }

  /**
   * Apply a preset to one channel.
   *
   * Preset data should live outside this file.
   * This method only knows how to apply the preset shape.
   *
   * Supported shape:
   * {
   *   algorithm?: number,
   *   feedback?: number,
   *   pan?: { left?: boolean, right?: boolean },
   *   left?: boolean,
   *   right?: boolean,
   *   operators?: {
   *     1?: {...},
   *     2?: {...},
   *     3?: {...},
   *     4?: {...}
   *   }
   * }
   *
   * @param {number} channel
   * @param {YM2612Preset} preset
   * @returns {void}
   */
  setPreset(channel, preset) {
    assertChannel(channel);
    if (!preset || typeof preset !== "object") {
      throw new Error("preset must be an object");
    }

    if (preset.algorithm !== undefined || preset.feedback !== undefined) {
      const current = this.channels[channel];
      this.setAlgo(
        channel,
        preset.algorithm !== undefined ? preset.algorithm : current.algorithm,
        preset.feedback !== undefined ? preset.feedback : current.feedback
      );
    }

    if (
      preset.pan ||
      preset.left !== undefined ||
      preset.right !== undefined ||
      preset.ams !== undefined ||
      preset.pms !== undefined
    ) {
      const pan = preset.pan || {};
      const current = this.channels[channel];
      this.setPan(
        channel,
        pan.left !== undefined ? pan.left : (preset.left !== undefined ? preset.left : current.left),
        pan.right !== undefined ? pan.right : (preset.right !== undefined ? preset.right : current.right),
        preset.ams !== undefined ? preset.ams : current.ams,
        preset.pms !== undefined ? preset.pms : current.pms
      );
    }

    if (preset.operators && typeof preset.operators === "object") {
      for (let operator = 1; operator <= OPERATOR_COUNT; operator += 1) {
        const params = preset.operators[operator];
        if (params) {
          this.setOperator(channel, operator, params);
        }
      }
    }
  }

  /**
   * Partial operator update.
   *
   * Public operators use 1..4 because that is easier to compare against YM2612 docs/examples.
   *
   * @param {number} channel
   * @param {number} operator
   * @param {YM2612OperatorParams} params
   * @returns {void}
   */
  setOperator(channel, operator, params) {
    assertChannel(channel);
    assertOperator(operator);
    if (!params || typeof params !== "object") {
      throw new Error("params must be an object");
    }

    const state = this.channels[channel].operators[operator - 1];
    const { port, channelOffset } = splitChannel(channel);
    const slotOffset = OPERATOR_SLOT_OFFSETS[operator];

    if (params.dt !== undefined || params.multi !== undefined) {
      const dt = params.dt !== undefined ? validateRange("dt", params.dt, 0, 7) : state.dt;
      const multi = params.multi !== undefined ? validateRange("multi", params.multi, 0, 15) : state.multi;
      state.dt = dt;
      state.multi = multi;

      // DT / MULTI
      // base 0x30, plus channel number within the port, plus operator slot spacing
      this._write(port, 0x30 + channelOffset + slotOffset, (dt << 4) | multi);
    }

    if (params.tl !== undefined) {
      state.tl = validateRange("tl", params.tl, 0, 127);

      // Total Level
      // base 0x40
      this._write(port, 0x40 + channelOffset + slotOffset, state.tl);
    }

    if (params.rs !== undefined || params.ar !== undefined) {
      const rs = params.rs !== undefined ? validateRange("rs", params.rs, 0, 3) : state.rs;
      const ar = params.ar !== undefined ? validateRange("ar", params.ar, 0, 31) : state.ar;
      state.rs = rs;
      state.ar = ar;

      // Rate Scaling / Attack Rate
      // base 0x50
      this._write(port, 0x50 + channelOffset + slotOffset, (rs << 6) | ar);
    }

    if (params.am !== undefined || params.d1r !== undefined) {
      const am =
        params.am !== undefined
          ? validateBoolean("am", params.am)
          : state.am;
      const d1r =
        params.d1r !== undefined
          ? validateRange("d1r", params.d1r, 0, 31)
          : state.d1r;
      state.am = am;
      state.d1r = d1r;

      // AM enable / First Decay Rate
      // base 0x60
      this._write(
        port,
        0x60 + channelOffset + slotOffset,
        (am ? 0x80 : 0x00) | d1r
      );
    }

    if (params.sr !== undefined || params.d2r !== undefined) {
      const sustainRate =
        params.sr !== undefined
          ? validateRange("sr", params.sr, 0, 31)
          : validateRange("d2r", params.d2r, 0, 31);
      state.d2r = sustainRate;

      // Sustain Rate / "D2R"
      // YM2612 register 0x70 is the sustain rate register.
      // This synth keeps `d2r` for the current learning/demo naming,
      // but also accepts `sr` so TFI import can map to the same place.
      this._write(port, 0x70 + channelOffset + slotOffset, state.d2r);
    }

    if (params.sl !== undefined || params.rr !== undefined) {
      const sl = params.sl !== undefined ? validateRange("sl", params.sl, 0, 15) : state.sl;
      const rr = params.rr !== undefined ? validateRange("rr", params.rr, 0, 15) : state.rr;
      state.sl = sl;
      state.rr = rr;

      // Sustain Level / Release Rate
      // base 0x80
      this._write(port, 0x80 + channelOffset + slotOffset, (sl << 4) | rr);
    }

    if (params.ssg !== undefined) {
      state.ssg = validateRange("ssg", params.ssg, 0, 15);

      // SSG-EG
      // base 0x90
      this._write(port, 0x90 + channelOffset + slotOffset, state.ssg);
    }
  }

  /**
   * Set channel algorithm and feedback.
   *
   * @param {number} channel
   * @param {number} algorithm
   * @param {number} [feedback=0]
   * @returns {void}
   */
  setAlgo(channel, algorithm, feedback = 0) {
    assertChannel(channel);
    const validAlgorithm = validateRange("algorithm", algorithm, 0, 7);
    const validFeedback = validateRange("feedback", feedback, 0, 7);

    const state = this.channels[channel];
    state.algorithm = validAlgorithm;
    state.feedback = validFeedback;

    const { port, channelOffset } = splitChannel(channel);

    // Algorithm / Feedback
    // base 0xb0
    this._write(port, 0xb0 + channelOffset, (validFeedback << 3) | validAlgorithm);
  }

  /**
   * Set left/right output enable, AM sensitivity, and PM sensitivity for one channel.
   *
   * @param {number} channel
   * @param {boolean} left
   * @param {boolean} right
   * @param {number} [ams]
   * @param {number} [pms]
   * @returns {void}
   */
  setPan(channel, left, right, ams = undefined, pms = undefined) {
    assertChannel(channel);
    if (typeof left !== "boolean" || typeof right !== "boolean") {
      throw new Error("left and right must be boolean");
    }

    const state = this.channels[channel];
    const validAms = validateRange(
      "ams",
      ams !== undefined ? ams : state.ams,
      0,
      3
    );
    const validPms = validateRange(
      "pms",
      pms !== undefined ? pms : state.pms,
      0,
      7
    );
    state.left = left;
    state.right = right;
    state.ams = validAms;
    state.pms = validPms;

    const { port, channelOffset } = splitChannel(channel);
    let value = 0;
    if (left) {
      value |= 0x80;
    }
    if (right) {
      value |= 0x40;
    }
    value |= validAms << 4;
    value |= validPms;

    // Left / Right output enable + AMS + PMS
    // base 0xb4
    this._write(port, 0xb4 + channelOffset, value);
  }

  /**
   * Set YM2612 chip-global LFO state.
   *
   * Register 0x22:
   * - bit 3 = LFO enable
   * - bits 2-0 = LFO frequency
   *
   * @param {boolean} enabled
   * @param {number} frequency
   * @returns {void}
   */
  setLfo(enabled, frequency) {
    const validEnabled = validateBoolean("enabled", enabled);
    const validFrequency = validateRange(
      "frequency",
      frequency,
      0,
      7
    );

    this.lfo.enabled = validEnabled;
    this.lfo.frequency = validFrequency;

    // LFO enable / frequency
    // chip-global register 0x22 on port 0
    this._write(
      0,
      0x22,
      (validEnabled ? 0x08 : 0x00) |
        validFrequency
    );
  }

  /**
   * Write BLOCK/FNUM and trigger Key On for all operators on one channel.
   *
   * @param {number} channel
   * @param {number} block
   * @param {number} fnum
   * @returns {void}
   */
  noteOn(channel, block, fnum) {
    assertChannel(channel);
    const validBlock = validateRange("block", block, 0, 7);
    const validFnum = validateRange("fnum", fnum, 0, 0x7ff);

    const state = this.channels[channel];
    state.block = validBlock;
    state.fnum = validFnum;

    const { port, channelOffset } = splitChannel(channel);
    const fnumHigh = (validFnum >> 8) & 0x07;
    const fnumLow = validFnum & 0xff;

    // BLOCK / F-NUM high
    // base 0xa4
    this._write(port, 0xa4 + channelOffset, (validBlock << 3) | fnumHigh);

    // F-NUM low
    // base 0xa0
    this._write(port, 0xa0 + channelOffset, fnumLow);

    // Key On / Key Off register
    // register 0x28 uses upper nibble as operator mask
    // 0xf0 means key on all four operators for this channel
    this._write(0, 0x28, 0xf0 | KEY_CHANNEL_CODES[channel]);
  }

  /**
   * Trigger Key Off for all operators on one channel.
   *
   * @param {number} channel
   * @returns {void}
   */
  noteOff(channel) {
    assertChannel(channel);

    // Key On / Key Off register
    // operator mask 0x00 means key off
    this._write(0, 0x28, KEY_CHANNEL_CODES[channel]);
  }

  /**
   * Write one YM2612 register.
   *
   * This is the compact form:
   *
   *   write(port, register, value)
   *
   * which corresponds to:
   *
   * - write register number to the address port
   * - write value to the data port
   *
   * This does not currently synchronize `this.channels` state.
   * It is mainly for low-level/manual YM2612 register work.
   *
   * @param {number} port
   * @param {number} register
   * @param {number} value
   * @returns {void}
   */
  write(port, register, value) {
    const validPort = validateRange("port", port, 0, 1);
    const validRegister = validateRange("register", register, 0, 0xff);
    const validValue = validateRange("value", value, 0, 0xff);

    this._write(
      validPort,
      validRegister,
      validValue
    );
  }

  /**
   * Write one YM2612 register number to the address port.
   *
   * Port mapping:
   * - port 0 = A1=0, A0=0
   * - port 1 = A1=1, A0=0
   *
   * Use this together with `writeData()`.
   *
   * @param {number} port
   * @param {number} register
   * @returns {void}
   */
  writeAddress(port, register) {
    const validPort = validateRange("port", port, 0, 1);
    const validRegister = validateRange("register", register, 0, 0xff);

    this._pendingAddressPort = validPort;
    this._pendingAddressRegister = validRegister;
  }

  /**
   * Write one YM2612 value to the data port after `writeAddress()`.
   *
   * Port mapping:
   * - port 0 = A1=0, A0=1
   * - port 1 = A1=1, A0=1
   *
   * @param {number} value
   * @returns {void}
   */
  writeData(value) {
    const validValue = validateRange("value", value, 0, 0xff);

    if (this._pendingAddressPort === undefined || this._pendingAddressRegister === undefined) {
      throw new Error("writeData(value) requires a previous writeAddress(port, register)");
    }

    this._write(
      this._pendingAddressPort,
      this._pendingAddressRegister,
      validValue
    );
  }

  /**
   * Read one raw YM2612 bus offset.
   *
   * Offset mapping:
   * - 0 = status port
   * - 1 = data port
   * - 2 = upper status port
   * - 3 = upper data port
   *
   * @param {number} offset
   * @returns {number}
   */
  read(offset) {
    const validOffset = validateRange("offset", offset, 0, 3);
    if (typeof this.transport.read !== "function") {
      throw new Error("This YM2612 transport does not support read(offset)");
    }

    const value = this.transport.read(validOffset);
    this._notifyRead(validOffset, value);
    this._syncIrq();
    return value;
  }

  /**
   * Read the YM2612 status register.
   *
   * This is a convenience alias for low-level status reads.
   *
   * @returns {number}
   */
  readStatus() {
    const value =
      typeof this.transport.readStatus === "function"
        ? this.transport.readStatus()
        : this.read(0);

    if (typeof this.transport.readStatus === "function") {
      this._notifyRead(0, value);
      this._syncIrq();
    }

    return value;
  }

  /**
   * Attach low-level hooks for register traffic and IRQ changes.
   *
   * @param {{
   *   onWrite?: ((command: { port: number, register: number, value: number }) => void),
   *   onRead?: ((event: { offset: number, value: number }) => void),
   *   onIrq?: ((asserted: boolean) => void),
   * }} hooks
   * @returns {void}
   */
  setHooks(hooks = {}) {
    const { onWrite, onRead, onIrq } = hooks;
    assertHook("onWrite", onWrite);
    assertHook("onRead", onRead);
    assertHook("onIrq", onIrq);
    this.hooks = { onWrite, onRead, onIrq };
    this._lastIrqState = undefined;
    this._syncIrq();
  }

  /**
   * Backward-compatible alias for older playground/demo code.
   *
   * @param {number} port
   * @param {number} register
   * @param {number} value
   * @returns {void}
   */
  rawWrite(port, register, value) {
    this.write(port, register, value);
  }

  /**
   * Central write exit.
   *
   * This is intentionally one place so that later we can:
   * - swap the transport to AudioWorklet
   * - insert a recorder
   * - attach sample-timed command scheduling
   *
   * @param {number} port
   * @param {number} register
   * @param {number} value
   * @returns {void}
   */
  _write(port, register, value) {
    const command = { port, register, value };

    // Current transports may prefer either:
    //   transport.write(port, register, value)
    // or:
    //   transport.write(command)
    if (this.transport.write.length >= 3) {
      this.transport.write(port, register, value);
    } else {
      this.transport.write(command);
    }

    if (typeof this.hooks.onWrite === "function") {
      this.hooks.onWrite(command);
    }
    this._syncIrq();
  }

  getState() {
    return structuredCloneCompat({
      lfo: this.lfo,
      channels: this.channels,
    });
  }

  _notifyRead(offset, value) {
    if (typeof this.hooks.onRead === "function") {
      this.hooks.onRead({ offset, value });
    }
  }

  _syncIrq() {
    if (typeof this.transport.getIrq !== "function" || typeof this.hooks.onIrq !== "function") {
      return;
    }

    const asserted = this.transport.getIrq();
    if (this._lastIrqState === asserted) {
      return;
    }

    this._lastIrqState = asserted;
    this.hooks.onIrq(asserted);
  }
}

function createDefaultChannelState() {
  return {
    algorithm: DEFAULT_CHANNEL_STATE.algorithm,
    feedback: DEFAULT_CHANNEL_STATE.feedback,
    ams: DEFAULT_CHANNEL_STATE.ams,
    pms: DEFAULT_CHANNEL_STATE.pms,
    left: DEFAULT_CHANNEL_STATE.left,
    right: DEFAULT_CHANNEL_STATE.right,
    block: DEFAULT_CHANNEL_STATE.block,
    fnum: DEFAULT_CHANNEL_STATE.fnum,
    operators: [
      { ...DEFAULT_OPERATOR_STATE },
      { ...DEFAULT_OPERATOR_STATE },
      { ...DEFAULT_OPERATOR_STATE },
      { ...DEFAULT_OPERATOR_STATE },
    ],
  };
}

function splitChannel(channel) {
  if (channel < 3) {
    return { port: 0, channelOffset: channel };
  }
  return { port: 1, channelOffset: channel - 3 };
}

function assertChannel(channel) {
  if (!Number.isInteger(channel) || channel < 0 || channel >= CHANNEL_COUNT) {
    throw new Error(`channel must be an integer in range 0..5, got ${channel}`);
  }
}

function assertOperator(operator) {
  if (!Number.isInteger(operator) || operator < 1 || operator > OPERATOR_COUNT) {
    throw new Error(`operator must be an integer in range 1..4, got ${operator}`);
  }
}

function validateRange(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in range ${min}..${max}, got ${value}`);
  }
  return value;
}

function validateBoolean(name, value) {
  if (typeof value !== "boolean") {
    throw new Error(
      `${name} must be a boolean, got ${value}`
    );
  }
  return value;
}

function assertHook(name, value) {
  if (value !== undefined && typeof value !== "function") {
    throw new Error(`${name} must be a function when provided`);
  }
}

function structuredCloneCompat(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}
