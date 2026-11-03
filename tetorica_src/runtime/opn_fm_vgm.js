/**
 * @file opn_fm_vgm.js
 * 実行環境: Browser / Node.js
 * 依存: JavaScript のデータ処理。DOM・Web Audio への依存なし。
 */
const YM2612_VGM_CLOCK = 7670454;

/**
 * Test whether a write belongs to the supported YM2608 FM register subset.
 * @param {number} port Register port (0 or 1).
 * @param {number} register Register address.
 * @returns {boolean} Whether the FM translator should forward this write.
 */
export function isYm2608FmRegister(port, register) {
  if (port === 0 && (register === 0x22 || register === 0x27 || register === 0x28)) {
    return true;
  }
  return register >= 0x30 && register <= 0xb6;
}

/**
 * Test whether a write belongs to the supported YM2610 FM register subset.
 * @param {number} port Register port (0 or 1).
 * @param {number} register Register address.
 * @returns {boolean} Whether the FM translator should forward this write.
 */
export function isYm2610FmRegister(port, register) {
  return isYm2608FmRegister(port, register);
}

/**
 * Test whether a write belongs to the supported YM2203 FM register subset.
 * @param {number} port Register port (0 or 1).
 * @param {number} register Register address.
 * @returns {boolean} Whether the FM translator should forward this write.
 */
export function isYm2203FmRegister(port, register) {
  if (port !== 0) return false;
  if (register === 0x27 || register === 0x28) return true;
  return register >= 0x30 && register <= 0xb2;
}

/**
 * Translate OPN FM frequency writes to the YM2612 VGM reference clock.
 * High-byte writes update shared latches; low-byte writes commit the converted pair.
 * @param {number} sourceClock VGM source clock in Hz, including optional variant bits.
 * @param {(register: number, value: number, port: number) => void} writeRegister Target register writer.
 * @param {(port: number, register: number) => boolean} isFmRegister Supported-register predicate.
 * @returns {(register: number, value: number, port?: number) => void} Ordered, stateful write translator.
 */
export function createOpnFmWriteTranslator(sourceClock, writeRegister, isFmRegister) {
  const normalizedSourceClock =
    (Number(sourceClock) & 0x3fffffff) || YM2612_VGM_CLOCK;
  // OPN has shared high latches for normal and CH3-special frequencies,
  // not a separate live high byte for each channel. Only a low write commits.
  const highLatches = [0, 0];

  return (register, value, port = 0) => {
    if (!isFmRegister(port, register)) return;

    const frequency = getOpnFrequencyRegister(port, register);
    if (!frequency) {
      writeRegister(register, value, port);
      return;
    }

    const latch = (register & 8) ? 1 : 0;
    if (frequency.part === 'high') {
      highLatches[latch] = value & 0x3f;
      return;
    }
    const scaled = scaleOpnFrequency(value, highLatches[latch], normalizedSourceClock);

    // Keep the target FNUM pair coherent after clock conversion.
    writeRegister(frequency.highRegister, scaled.high, frequency.port);
    writeRegister(frequency.lowRegister, scaled.low, frequency.port);
  };
}

function getOpnFrequencyRegister(port, register) {
  if (register >= 0xa0 && register <= 0xa2) {
    return { index: port * 3 + register - 0xa0, part: "low", port, lowRegister: register, highRegister: register + 4 };
  }
  if (register >= 0xa4 && register <= 0xa6) {
    return { index: port * 3 + register - 0xa4, part: "high", port, lowRegister: register - 4, highRegister: register };
  }
  if (port === 0 && register >= 0xa8 && register <= 0xaa) {
    return { index: 6 + register - 0xa8, part: "low", port, lowRegister: register, highRegister: register + 4 };
  }
  if (port === 0 && register >= 0xac && register <= 0xae) {
    return { index: 6 + register - 0xac, part: "high", port, lowRegister: register - 4, highRegister: register };
  }
  return null;
}

function scaleOpnFrequency(low, high, sourceClock) {
  let block = (high >> 3) & 0x07;
  let fnum = Math.round((((high & 0x07) << 8) | low) * sourceClock / YM2612_VGM_CLOCK);
  while (fnum > 0x7ff && block < 7) {
    fnum = Math.round(fnum / 2);
    block += 1;
  }
  fnum = Math.min(0x7ff, fnum);
  return { low: fnum & 0xff, high: (high & 0xc0) | (block << 3) | ((fnum >> 8) & 0x07) };
}
