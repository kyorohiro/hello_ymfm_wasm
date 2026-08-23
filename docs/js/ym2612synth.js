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
  d1r: 0,
  d2r: 0,
  sl: 0,
  rr: 15,
  ssg: 0,
});

const DEFAULT_CHANNEL_STATE = Object.freeze({
  algorithm: 7,
  feedback: 0,
  left: true,
  right: true,
  block: 4,
  fnum: 0,
});

/**
 * Direct transport for the current `web/ym2612.js` implementation.
 *
 * This keeps the synth layer from depending on `Ym2612` method names directly.
 * A future AudioWorklet transport can implement the same `write` / `reset` shape.
 */
export class YM2612DirectTransport {
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
}

export class YM2612WorkletTransport {
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
   * @param {{
   *   transport?: {
   *     write: ((port: number, register: number, value: number) => void) |
   *            ((command: { port: number, register: number, value: number }) => void),
   *     reset?: () => void
   *   }
   * }} [options]
   */
  constructor(options = {}) {
    const { transport } = options;
    if (!transport || typeof transport.write !== "function") {
      throw new Error("YM2612Synth requires a transport with a write(...) function");
    }

    this.transport = transport;
    this.channels = [];
    this.reset();
  }

  reset() {
    if (typeof this.transport.reset === "function") {
      this.transport.reset();
    }

    this.channels = [];
    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      this.channels.push(createDefaultChannelState());
    }
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
   * @param {object} preset
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

    if (preset.pan || preset.left !== undefined || preset.right !== undefined) {
      const pan = preset.pan || {};
      const current = this.channels[channel];
      this.setPan(
        channel,
        pan.left !== undefined ? pan.left : (preset.left !== undefined ? preset.left : current.left),
        pan.right !== undefined ? pan.right : (preset.right !== undefined ? preset.right : current.right)
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
   * @param {{
   *   dt?: number,
   *   multi?: number,
   *   tl?: number,
   *   rs?: number,
   *   ar?: number,
   *   d1r?: number,
   *   sr?: number,
   *   d2r?: number,
   *   sl?: number,
   *   rr?: number,
   *   ssg?: number,
   * }} params
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

    if (params.d1r !== undefined) {
      state.d1r = validateRange("d1r", params.d1r, 0, 31);

      // First Decay Rate
      // base 0x60
      this._write(port, 0x60 + channelOffset + slotOffset, state.d1r);
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
   * Set left/right output enable for one channel.
   *
   * @param {number} channel
   * @param {boolean} left
   * @param {boolean} right
   * @returns {void}
   */
  setPan(channel, left, right) {
    assertChannel(channel);
    if (typeof left !== "boolean" || typeof right !== "boolean") {
      throw new Error("left and right must be boolean");
    }

    const state = this.channels[channel];
    state.left = left;
    state.right = right;

    const { port, channelOffset } = splitChannel(channel);
    let value = 0;
    if (left) {
      value |= 0x80;
    }
    if (right) {
      value |= 0x40;
    }

    // Left / Right output enable
    // base 0xb4
    // AMS / FMS bits are left at 0 in this first synth layer
    this._write(port, 0xb4 + channelOffset, value);
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
   * Raw YM2612 register write escape hatch.
   *
   * This is intentionally narrower than exposing `transport` directly.
   * It keeps the caller at the YM2612 register level:
   *
   *   rawWrite(port, register, value)
   *
   * without leaking transport details such as:
   *
   * - direct vs AudioWorklet transport
   * - future scheduling-aware transports
   * - recorder insertion points
   *
   * Important:
   *
   * - this does not currently synchronize `this.channels` state
   * - it should be treated as an escape hatch for advanced/manual register work
   * - higher-level helpers like `setOperator()` / `setAlgo()` / `noteOn()` remain preferred
   *
   * @param {number} port
   * @param {number} register
   * @param {number} value
   * @returns {void}
   */
  rawWrite(port, register, value) {
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
  }

  getState() {
    return structuredCloneCompat({
      channels: this.channels,
    });
  }
}

function createDefaultChannelState() {
  return {
    algorithm: DEFAULT_CHANNEL_STATE.algorithm,
    feedback: DEFAULT_CHANNEL_STATE.feedback,
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

function structuredCloneCompat(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}
