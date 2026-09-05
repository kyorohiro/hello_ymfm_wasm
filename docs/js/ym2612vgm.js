import {
  createOpnFmWriteTranslator,
  isYm2203FmRegister,
  isYm2610FmRegister,
  isYm2608FmRegister,
} from "./opn_fm_vgm.js";

/**
 * @typedef {Object} Ym2612VgmHeader
 * @property {string} ident
 * @property {number} version
 * @property {number} ym2612Clock
 * @property {number} ym2203Clock
 * @property {number} ym2608Clock
 * @property {number} ym2610Clock
 * @property {number} totalSamples
 * @property {number} loopOffset
 * @property {number} loopSamples
 * @property {number} dataOffset
 */

/**
 * @typedef {Object} Ym2612WriteEvent
 * @property {"ym2612-write"} type
 * @property {0|1} port
 * @property {number} register
 * @property {number} value
 */

/**
 * @typedef {Object} Ym2203WriteEvent
 * @property {"ym2203-write"} type
 * @property {number} register
 * @property {number} value
 */

/**
 * @typedef {Object} Ym2608WriteEvent
 * @property {"ym2608-write"} type
 * @property {0|1} port
 * @property {number} register
 * @property {number} value
 */

/** @typedef {{ type: "ym2610-write", port: 0|1, register: number, value: number }} Ym2610WriteEvent */

/**
 * @typedef {Object} SegaPsgWriteEvent
 * @property {"psg-write"} type
 * @property {number} value
 */

/**
 * @typedef {Object} Ym2612WaitEvent
 * @property {"wait"} type
 * @property {number} samples
 */

/**
 * @typedef {Object} Ym2612EndEvent
 * @property {"end"} type
 */

/**
 * @typedef {Ym2612WriteEvent | Ym2203WriteEvent | Ym2608WriteEvent | Ym2610WriteEvent | SegaPsgWriteEvent | Ym2612WaitEvent | Ym2612EndEvent} Ym2612VgmEvent
 */

/**
 * @typedef {Object} Ym2612PcmRamWriteInfo
 * @property {number} type
 * @property {number} readOffset
 * @property {number} writeOffset
 * @property {number} size
 * @property {number} commandOffset
 */

/**
 * @param {DataView} view
 * @param {number} offset
 * @returns {number}
 */
function readUint32LE(view, offset) {
  return view.getUint32(offset, true);
}

/**
 * @param {DataView} view
 * @param {number} offset
 * @returns {number}
 */
function readUint16LE(view, offset) {
  return view.getUint16(offset, true);
}

/**
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} length
 * @returns {string}
 */
function decodeAscii(bytes, start, length) {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(bytes[start + index]);
  }
  return result;
}

const YM2612_CHANNEL_NAMES = [
  "CH0",
  "CH1",
  "CH2",
  "CH3",
  "CH4",
  "CH5",
];

const YM2612_KEY_CODE_TO_CHANNEL = new Map([
  [0x00, 0],
  [0x01, 1],
  [0x02, 2],
  [0x04, 3],
  [0x05, 4],
  [0x06, 5],
]);

const YM2612_SLOT_TO_OPERATOR = new Map([
  [0x00, 1],
  [0x04, 3],
  [0x08, 2],
  [0x0c, 4],
]);

const YM2612_CH3_SPECIAL_LOW_TO_OPERATOR = new Map([
  [0xa8, 3],
  [0xa9, 1],
  [0xaa, 2],
]);

const YM2612_CH3_SPECIAL_HIGH_TO_OPERATOR = new Map([
  [0xac, 3],
  [0xad, 1],
  [0xae, 2],
]);

const YM2612_VGM_CLOCK = 7670454;

export class Ym2612VGM {
  /**
   * @param {ArrayBuffer | ArrayBufferView} source
   * @param {{ logger?: Pick<Console, "warn"> | null }} [options]
   */
  constructor(source, options = {}) {
    if (source instanceof ArrayBuffer) {
      /** @type {Uint8Array} */
      this.bytes = new Uint8Array(source);
    } else if (ArrayBuffer.isView(source)) {
      /** @type {Uint8Array} */
      this.bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    } else {
      throw new Error("Ym2612VGM expects an ArrayBuffer or typed array");
    }

    /** @type {DataView} */
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    /** @type {Ym2612VgmHeader} */
    this.header = this.parseHeader();
    /** @type {number} */
    this.position = this.header.dataOffset;
    /** @type {boolean} */
    this.ended = false;
    /** @type {Pick<Console, "warn"> | null} */
    this.logger = options.logger === undefined ? console : options.logger;
    /** @type {Map<number, Uint8Array>} */
    this.dataBanks = new Map();
    /** @type {Uint8Array[]} */
    this.dataBlocks = [];
    /** @type {Array<{ type: number, size: number, preview: string }>} */
    this.dataBlockInfo = [];
    /** @type {Map<number, {
     *   chipType: number,
     *   port: number,
     *   register: number,
     *   dataBankId: number,
     *   stepSize: number,
     *   stepBase: number,
     *   frequency: number,
     *   active: boolean,
     *   loop: boolean,
     *   data: Uint8Array | null,
     *   dataOffset: number,
     *   dataLength: number,
     *   cursor: number,
     *   sampleRemainder: number
     * }>} */
    this.streams = new Map();
    /** @type {number} */
    this.dataBankCursor = 0;
    /** @type {{ port: number, value: number } | null} */
    this.pendingYm2612DataBankWrite = null;
    /** @type {Ym2612PcmRamWriteInfo[]} */
    this.pcmRamWrites = [];
  }

  /**
   * @returns {Ym2612VgmHeader}
   */
  parseHeader() {
    const ident = decodeAscii(this.bytes, 0x00, 4);
    if (ident !== "Vgm ") {
      throw new Error(`Invalid VGM identifier: ${JSON.stringify(ident)}`);
    }

    const version = readUint32LE(this.view, 0x08);
    const ym2612Clock = readUint32LE(this.view, 0x2c);
    const ym2203Clock = readUint32LE(this.view, 0x44);
    const ym2608Clock = readUint32LE(this.view, 0x48);
    const ym2610Clock = readUint32LE(this.view, 0x4c);
    const totalSamples = readUint32LE(this.view, 0x18);
    const loopOffsetRaw = readUint32LE(this.view, 0x1c);
    const loopSamples = readUint32LE(this.view, 0x20);
    const dataOffsetRaw = readUint32LE(this.view, 0x34);

    const dataOffset = version >= 0x00000150
      ? (dataOffsetRaw === 0 ? 0x40 : 0x34 + dataOffsetRaw)
      : 0x40;

    const loopOffset = loopOffsetRaw === 0 ? 0 : 0x1c + loopOffsetRaw;

    return {
      ident,
      version,
      ym2612Clock,
      ym2203Clock,
      ym2608Clock,
      ym2610Clock,
      totalSamples,
      loopOffset,
      loopSamples,
      dataOffset,
    };
  }

  /**
   * @returns {void}
   */
  reset() {
    this.position = this.header.dataOffset;
    this.ended = false;
    this.dataBankCursor = 0;
    this.pendingYm2612DataBankWrite = null;
    for (const stream of this.streams.values()) {
      stream.active = false;
      stream.loop = false;
      stream.data = null;
      stream.dataOffset = 0;
      stream.dataLength = 0;
      stream.cursor = 0;
      stream.sampleRemainder = 0;
    }
  }

  /**
   * @returns {boolean}
   */
  hasLoop() {
    return this.header.loopOffset !== 0;
  }

  /**
   * @returns {Array<{ type: number, size: number, preview: string, index: number }>}
   */
  dataBlockSummary() {
    /** @type {Array<{ type: number, size: number, preview: string, index: number, offset: number }>} */
    const blocks = [];
    this.#scanRawCommands((command, position) => {
      if (command !== 0x67) {
        return;
      }
      const dataType = this.bytes[position + 2];
      const size = readUint32LE(this.view, position + 3);
      const dataStart = position + 7;
      const data = this.bytes.slice(dataStart, dataStart + size);
      blocks.push({
        type: dataType,
        size,
        preview: Array.from(data.subarray(0, Math.min(8, data.length)))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(" "),
        index: blocks.length,
        offset: position,
      });
    });
    return blocks;
  }

  /**
   * @returns {Map<string, number>}
   */
  analyzeCommandUsage() {
    const counts = new Map();
    this.#scanRawCommands((command) => {
      const key = `0x${command.toString(16).padStart(2, "0")}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  /**
   * @returns {Array<string>}
   */
  analyzeSpecialCommands() {
    /** @type {Array<string>} */
    const lines = [];
    this.#scanRawCommands((command, position, index) => {
      if (command === 0x67) {
        const dataType = this.bytes[position + 2];
        const size = readUint32LE(this.view, position + 3);
        lines.push(
          `${String(index).padStart(4, " ")} @${formatOffset(position)} cmd=0x67 type=0x${dataType.toString(16).padStart(2, "0")} size=${size}`,
        );
      } else if (command === 0x68) {
        const dataType = this.bytes[position + 2];
        const readOffset = readUint24LE(this.bytes, position + 3);
        const writeOffset = readUint24LE(this.bytes, position + 6);
        const size = readUint24LE(this.bytes, position + 9);
        lines.push(
          `${String(index).padStart(4, " ")} @${formatOffset(position)} cmd=0x68 type=0x${dataType.toString(16).padStart(2, "0")} readOffset=${formatHexNumber(readOffset, 6)} writeOffset=${formatHexNumber(writeOffset, 6)} size=${size}`,
        );
      } else if (command >= 0x90 && command <= 0x95) {
        lines.push(this.#describeDacStreamCommand(position, index));
      } else if (command === 0xe0) {
        const seek = readUint32LE(this.view, position + 1);
        lines.push(
          `${String(index).padStart(4, " ")} @${formatOffset(position)} cmd=0xe0 seek=${formatHexNumber(seek, 8)}`,
        );
      }
    });

    if (lines.length === 0) {
      lines.push("No 0x68 / 0x90-0x95 / 0xE0 details were found.");
    }
    return lines;
  }

  /**
   * @returns {Ym2612PcmRamWriteInfo[]}
   */
  pcmRamWriteSummary() {
    return this.pcmRamWrites.slice();
  }

  /**
   * @param {number} targetCommand
   * @param {number} [contextRadius]
   * @returns {Array<string>}
   */
  analyzeCommandContext(targetCommand, contextRadius = 2) {
    /** @type {Array<{ index: number, position: number, command: number, detail: string }>} */
    const entries = [];
    this.#scanRawCommands((command, position, index) => {
      entries.push({
        index,
        position,
        command,
        detail: this.#describeRawCommand(command, position),
      });
    });

    /** @type {Array<string>} */
    const lines = [];
    for (let i = 0; i < entries.length; i += 1) {
      if (entries[i].command !== targetCommand) {
        continue;
      }
      lines.push(`target 0x${targetCommand.toString(16).padStart(2, "0")} around event ${entries[i].index}`);
      const start = Math.max(0, i - contextRadius);
      const end = Math.min(entries.length - 1, i + contextRadius);
      for (let j = start; j <= end; j += 1) {
        const marker = j === i ? ">" : " ";
        const entry = entries[j];
        lines.push(`${marker} ${String(entry.index).padStart(4, " ")} @${formatOffset(entry.position)} ${entry.detail}`);
      }
      lines.push("");
    }

    if (lines.length === 0) {
      lines.push(`No 0x${targetCommand.toString(16).padStart(2, "0")} commands were found.`);
    }
    return lines;
  }

  /**
   * @returns {Ym2612VgmEvent}
   */
  step() {
    if (this.ended) {
      return { type: "end" };
    }
    if (this.position >= this.bytes.length) {
      throw new Error("Unexpected end of VGM data");
    }

    const command = this.bytes[this.position];
    switch (command) {
      case 0x50: {
        this.#ensureAvailable(2);
        const value = this.bytes[this.position + 1];
        this.position += 2;
        return { type: "psg-write", value };
      }
      case 0x52: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym2612-write", port: 0, register, value };
      }
      case 0x53: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym2612-write", port: 1, register, value };
      }
      case 0x55: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym2203-write", register, value };
      }
      case 0x56: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym2608-write", port: 0, register, value };
      }
      case 0x57: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym2608-write", port: 1, register, value };
      }
      case 0x58:
      case 0x59: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym2610-write", port: command - 0x58, register, value };
      }
      case 0x67: {
        this.#ensureAvailable(7);
        if (this.bytes[this.position + 1] !== 0x66) {
          throw new Error("Invalid VGM data block header");
        }
        const dataType = this.bytes[this.position + 2];
        const size = readUint32LE(this.view, this.position + 3);
        this.#ensureAvailable(7 + size);
        this.#storeDataBlock(dataType, this.position + 7, size);
        this.position += 7 + size;
        return this.step();
      }
      case 0x61: {
        this.#ensureAvailable(3);
        const samples = readUint16LE(this.view, this.position + 1);
        this.position += 3;
        return { type: "wait", samples };
      }
      case 0x62:
        this.position += 1;
        return { type: "wait", samples: 735 };
      case 0x63:
        this.position += 1;
        return { type: "wait", samples: 882 };
      case 0x66:
        this.position += 1;
        this.ended = true;
        return { type: "end" };
      default:
        break;
    }

    if (command === 0x68) {
      this.#ensureAvailable(12);
      this.#storePcmRamWrite(this.position);
      this.position += 12;
      return this.step();
    }

    if (command >= 0x70 && command <= 0x7f) {
      this.position += 1;
      return { type: "wait", samples: (command & 0x0f) + 1 };
    }

    if (command >= 0x80 && command <= 0x8f) {
      this.position += 1;
      this.#writeYm2612DataBankByte(0);
      return { type: "wait", samples: command & 0x0f };
    }

    if (command >= 0x90 && command <= 0x95) {
      this.#handleDacStreamCommand(command);
      return this.step();
    }

    if (command === 0xe0) {
      this.#ensureAvailable(5);
      this.dataBankCursor = readUint32LE(this.view, this.position + 1);
      this.position += 5;
      return this.step();
    }

    const ignoredLength = ignoredCommandLength(command);
    if (ignoredLength !== null) {
      this.#ensureAvailable(ignoredLength);
      this.#warn(`Skipping known unsupported VGM command ${formatHexNumber(command)} (${ignoredLength} bytes)`);
      this.position += ignoredLength;
      return this.step();
    }

    throw new Error(`Unsupported VGM command 0x${command.toString(16).padStart(2, "0")}`);
  }

  /**
   * @param {{
   *   ym2612?: { writeRegister(register: number, value: number, port?: number): void },
   *   ym2203?: { writeRegister(register: number, value: number): void },
   *   ym2608?: { writeRegister(register: number, value: number, port?: number): void },
   *   psg?: { write(data: number): void },
   *   writeRegister?: (register: number, value: number, port?: number) => void
   * }} targets
   * @returns {Ym2612VgmEvent}
   */
  playStep(targets) {
    const event = this.step();
    if (this.pendingYm2612DataBankWrite) {
      const ym2612 = targets.ym2612 || targets;
      if (ym2612 && typeof ym2612.writeRegister === "function") {
        ym2612.writeRegister(0x2a, this.pendingYm2612DataBankWrite.value, this.pendingYm2612DataBankWrite.port);
      }
      this.pendingYm2612DataBankWrite = null;
    }
    if (event.type === "ym2612-write") {
      const ym2612 = targets.ym2612 || targets;
      if (ym2612 && typeof ym2612.writeRegister === "function") {
        ym2612.writeRegister(event.register, event.value, event.port);
      }
    }
    if (event.type === "ym2203-write") {
      const ym2203 = targets.ym2203;
      if (ym2203 && typeof ym2203.writeRegister === "function") {
        ym2203.writeRegister(event.register, event.value);
      }
    }
    if (event.type === "ym2608-write") {
      const ym2608 = targets.ym2608;
      if (ym2608 && typeof ym2608.writeRegister === "function") {
        ym2608.writeRegister(event.register, event.value, event.port);
      }
    }
    if (event.type === "ym2610-write") {
      const ym2610 = targets.ym2610;
      if (ym2610 && typeof ym2610.writeRegister === "function") {
        ym2610.writeRegister(event.register, event.value, event.port);
      }
    }
    if (event.type === "psg-write") {
      const psg = targets.psg;
      if (psg && typeof psg.write === "function") {
        psg.write(event.value);
      }
    }
    return event;
  }

  /**
   * @param {{
   *   ym2612?: { writeRegister(register: number, value: number, port?: number): void },
   *   psg?: { write(data: number): void },
   *   writeRegister?: (register: number, value: number, port?: number) => void
   * }} targets
   * @param {number} vgmSamples
   * @param {(segmentSamples: number) => void} onSegment
   * @returns {void}
   */
  consumeWait(targets, vgmSamples, onSegment) {
    let remaining = vgmSamples;
    while (remaining > 0) {
      const distance = this.#nextStreamWriteDistance();
      const segment = distance === null ? remaining : Math.min(remaining, distance);
      if (segment > 0) {
        onSegment(segment);
        this.#advanceStreams(segment);
        remaining -= segment;
      } else {
        this.#flushDueStreamWrites(targets);
      }
    }
    this.#flushDueStreamWrites(targets);
  }

  /**
   * Export YM2612 writes as Tetorica Playground JavaScript.
   *
   * @param {{
   *   includeHeaderComment?: boolean,
   *   totalLoopSamples?: number | null,
   * }} [options]
   * @returns {string}
   */
  exportPlaygroundJavaScript(options = {}) {
    return exportYm2612VgmToPlaygroundJavaScript(this, options);
  }

  /**
   * @param {number} length
   * @returns {void}
   */
  #ensureAvailable(length) {
    if (this.position + length > this.bytes.length) {
      throw new Error("Unexpected end of VGM command stream");
    }
  }

  /**
   * @param {string} message
   * @returns {void}
   */
  #warn(message) {
    if (this.logger && typeof this.logger.warn === "function") {
      this.logger.warn(message);
    }
  }

  /**
   * @param {number} position
   * @param {number} index
   * @returns {string}
   */
  #describeDacStreamCommand(position, index) {
    const command = this.bytes[position];
    const prefix = `${String(index).padStart(4, " ")} @${formatOffset(position)} cmd=0x${command.toString(16).padStart(2, "0")}`;

    if (command === 0x90) {
      return `${prefix} stream=${formatHexNumber(this.bytes[position + 1])} chipType=${formatHexNumber(this.bytes[position + 2])} port=${this.bytes[position + 3]} register=${formatHexNumber(this.bytes[position + 4])}`;
    }
    if (command === 0x91) {
      return `${prefix} stream=${formatHexNumber(this.bytes[position + 1])} dataBank=${formatHexNumber(this.bytes[position + 2])} stepSize=${this.bytes[position + 3]} stepBase=${this.bytes[position + 4]}`;
    }
    if (command === 0x92) {
      const frequency = readUint32LE(this.view, position + 2);
      return `${prefix} stream=${formatHexNumber(this.bytes[position + 1])} frequency=${frequency}`;
    }
    if (command === 0x93) {
      const start = readUint32LE(this.view, position + 2);
      const mode = this.bytes[position + 6];
      const length = readUint32LE(this.view, position + 7);
      return `${prefix} stream=${formatHexNumber(this.bytes[position + 1])} start=${formatHexNumber(start, 8)} mode=${formatHexNumber(mode)} length=${length}`;
    }
    if (command === 0x94) {
      return `${prefix} stream=${formatHexNumber(this.bytes[position + 1])} stop`;
    }
    const blockId = readUint16LE(this.view, position + 2);
    const flags = this.bytes[position + 4];
    return `${prefix} stream=${formatHexNumber(this.bytes[position + 1])} blockId=${formatHexNumber(blockId, 4)} flags=${formatHexNumber(flags)}`;
  }

  /**
   * @param {number} command
   * @param {number} position
   * @returns {string}
   */
  #describeRawCommand(command, position) {
    if (command === 0x50) {
      return `cmd=0x50 psg value=${formatHexNumber(this.bytes[position + 1])}`;
    }
    if (command === 0x52 || command === 0x53) {
      return `cmd=0x${command.toString(16)} ym2612 port=${command === 0x52 ? 0 : 1} register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x55) {
      return `cmd=0x55 ym2203 register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x56 || command === 0x57) {
      return `cmd=0x${command.toString(16)} ym2608 port=${command === 0x56 ? 0 : 1} register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x61) {
      return `cmd=0x61 wait=${readUint16LE(this.view, position + 1)}`;
    }
    if (command === 0x62 || command === 0x63 || command === 0x66) {
      return `cmd=0x${command.toString(16)}`;
    }
    if (command === 0x67) {
      return `cmd=0x67 type=${formatHexNumber(this.bytes[position + 2])} size=${readUint32LE(this.view, position + 3)}`;
    }
    if (command === 0x68) {
      return `cmd=0x68 type=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command >= 0x70 && command <= 0x7f) {
      return `cmd=0x${command.toString(16)} wait=${(command & 0x0f) + 1}`;
    }
    if (command >= 0x80 && command <= 0x8f) {
      return `cmd=0x${command.toString(16)} dac+wait=${command & 0x0f}`;
    }
    if (command >= 0x90 && command <= 0x95) {
      return this.#describeDacStreamCommand(position, 0).replace(/^0+\s*@?[0-9a-f]*\s*/, "").replace(/^@\S+\s*/, "");
    }
    if (command === 0xe0) {
      return `cmd=0xe0 seek=${formatHexNumber(readUint32LE(this.view, position + 1), 8)}`;
    }
    return `cmd=0x${command.toString(16)}`;
  }

  /**
   * @param {(command: number, position: number, index: number) => void} visitor
   * @returns {void}
   */
  #scanRawCommands(visitor) {
    let position = this.header.dataOffset;
    let index = 0;
    while (position < this.bytes.length) {
      const command = this.bytes[position];
      visitor(command, position, index);
      if (command === 0x66) {
        return;
      }
      position += rawCommandLength(this.bytes, this.view, position);
      index += 1;
    }
  }

  /**
   * @param {number} streamId
   * @returns {{
   *   chipType: number,
   *   port: number,
   *   register: number,
   *   dataBankId: number,
   *   stepSize: number,
   *   stepBase: number,
   *   frequency: number,
   *   active: boolean,
   *   loop: boolean,
   *   data: Uint8Array | null,
   *   dataOffset: number,
   *   dataLength: number,
   *   cursor: number,
   *   sampleRemainder: number
   * }}
   */
  #streamState(streamId) {
    if (!this.streams.has(streamId)) {
      this.streams.set(streamId, {
        chipType: 0,
        port: 0,
        register: 0x2a,
        dataBankId: 0,
        stepSize: 1,
        stepBase: 0,
        frequency: 0,
        active: false,
        loop: false,
        data: null,
        dataOffset: 0,
        dataLength: 0,
        cursor: 0,
        sampleRemainder: 0,
      });
    }
    return this.streams.get(streamId);
  }

  /**
   * @param {number} command
   * @returns {void}
   */
  #handleDacStreamCommand(command) {
    if (command === 0x90) {
      this.#ensureAvailable(5);
      const stream = this.#streamState(this.bytes[this.position + 1]);
      stream.chipType = this.bytes[this.position + 2];
      stream.port = this.bytes[this.position + 3];
      stream.register = this.bytes[this.position + 4];
      this.position += 5;
      return;
    }
    if (command === 0x91) {
      this.#ensureAvailable(5);
      const stream = this.#streamState(this.bytes[this.position + 1]);
      stream.dataBankId = this.bytes[this.position + 2];
      stream.stepSize = Math.max(1, this.bytes[this.position + 3]);
      stream.stepBase = this.bytes[this.position + 4];
      this.position += 5;
      return;
    }
    if (command === 0x92) {
      this.#ensureAvailable(6);
      const stream = this.#streamState(this.bytes[this.position + 1]);
      stream.frequency = readUint32LE(this.view, this.position + 2);
      this.position += 6;
      return;
    }
    if (command === 0x93) {
      this.#ensureAvailable(11);
      const stream = this.#streamState(this.bytes[this.position + 1]);
      const start = readUint32LE(this.view, this.position + 2);
      const mode = this.bytes[this.position + 6];
      const length = readUint32LE(this.view, this.position + 7);
      const bank = this.dataBanks.get(stream.dataBankId) || null;
      this.#startStream(stream, bank, start, mode, length);
      this.position += 11;
      return;
    }
    if (command === 0x94) {
      this.#ensureAvailable(2);
      const stream = this.#streamState(this.bytes[this.position + 1]);
      stream.active = false;
      this.position += 2;
      return;
    }
    if (command === 0x95) {
      this.#ensureAvailable(5);
      const stream = this.#streamState(this.bytes[this.position + 1]);
      const blockId = readUint16LE(this.view, this.position + 2);
      const flags = this.bytes[this.position + 4];
      const block = this.dataBlocks[blockId] || null;
      this.#startStream(stream, block, 0, flags, block ? block.length : 0);
      this.position += 5;
      return;
    }
  }

  /**
   * @param {{
   *   chipType: number,
   *   port: number,
   *   register: number,
   *   dataBankId: number,
   *   stepSize: number,
   *   stepBase: number,
   *   frequency: number,
   *   active: boolean,
   *   loop: boolean,
   *   data: Uint8Array | null,
   *   dataOffset: number,
   *   dataLength: number,
   *   cursor: number,
   *   sampleRemainder: number
   * }} stream
   * @param {Uint8Array | null} data
   * @param {number} start
   * @param {number} mode
   * @param {number} length
   * @returns {void}
   */
  #startStream(stream, data, start, mode, length) {
    if (!data || start >= data.length) {
      stream.active = false;
      this.#warn("Skipping DAC stream start because no matching data block was loaded");
      return;
    }
    const requestedLength = length === 0 ? data.length - start : length;
    const availableLength = Math.max(0, Math.min(requestedLength, data.length - start));
    stream.data = data;
    stream.dataOffset = start;
    stream.dataLength = availableLength;
    stream.cursor = 0;
    stream.sampleRemainder = 0;
    stream.loop = (mode & 0x80) !== 0;
    stream.active = availableLength > 0 && stream.frequency > 0;
    if (stream.frequency <= 0) {
      this.#warn("Skipping DAC stream start because frequency was not configured");
    }
  }

  /**
   * @returns {number | null}
   */
  #nextStreamWriteDistance() {
    let distance = null;
    for (const stream of this.streams.values()) {
      if (!stream.active || !stream.data || stream.frequency <= 0) {
        continue;
      }
      const remaining = Math.max(0, 44100 - stream.sampleRemainder);
      const next = Math.max(0, Math.ceil(remaining / stream.frequency));
      if (distance === null || next < distance) {
        distance = next;
      }
    }
    return distance;
  }

  /**
   * @param {number} vgmSamples
   * @returns {void}
   */
  #advanceStreams(vgmSamples) {
    for (const stream of this.streams.values()) {
      if (!stream.active || !stream.data || stream.frequency <= 0) {
        continue;
      }
      stream.sampleRemainder += vgmSamples * stream.frequency;
    }
  }

  /**
   * @param {{
   *   ym2612?: { writeRegister(register: number, value: number, port?: number): void },
   *   psg?: { write(data: number): void },
   *   writeRegister?: (register: number, value: number, port?: number) => void
   * }} targets
   * @returns {void}
   */
  #flushDueStreamWrites(targets) {
    while (true) {
      let flushed = false;
      for (const stream of this.streams.values()) {
        while (stream.active && stream.data && stream.frequency > 0 && stream.sampleRemainder >= 44100) {
          stream.sampleRemainder -= 44100;
          this.#performStreamWrite(stream, targets);
          flushed = true;
        }
      }
      if (!flushed) {
        return;
      }
    }
  }

  /**
   * @param {{
   *   chipType: number,
   *   port: number,
   *   register: number,
   *   dataBankId: number,
   *   stepSize: number,
   *   stepBase: number,
   *   frequency: number,
   *   active: boolean,
   *   loop: boolean,
   *   data: Uint8Array | null,
   *   dataOffset: number,
   *   dataLength: number,
   *   cursor: number,
   *   sampleRemainder: number
   * }} stream
   * @param {{
   *   ym2612?: { writeRegister(register: number, value: number, port?: number): void },
   *   psg?: { write(data: number): void },
   *   writeRegister?: (register: number, value: number, port?: number) => void
   * }} targets
   * @returns {void}
   */
  #performStreamWrite(stream, targets) {
    if (!stream.data || !stream.active) {
      return;
    }
    if (stream.cursor >= stream.dataLength) {
      if (stream.loop) {
        stream.cursor = 0;
      } else {
        stream.active = false;
        return;
      }
    }
    const dataIndex = stream.dataOffset + stream.cursor;
    const value = stream.data[dataIndex];
    const ym2612 = targets.ym2612 || targets;
    if (ym2612 && typeof ym2612.writeRegister === "function") {
      ym2612.writeRegister(stream.register, value, stream.port);
    }
    stream.cursor += stream.stepSize;
    if (stream.cursor >= stream.dataLength && !stream.loop) {
      stream.active = false;
    }
  }

  /**
   * @param {number} port
   * @returns {void}
   */
  #writeYm2612DataBankByte(port) {
    const bank = this.dataBanks.get(0);
    if (!bank || this.dataBankCursor >= bank.length) {
      this.#warn("Skipping YM2612 DAC write because data bank 0 is not available");
      return;
    }
    this.pendingYm2612DataBankWrite = {
      port,
      value: bank[this.dataBankCursor],
    };
    this.dataBankCursor += 1;
  }

  /**
   * @param {number} position
   * @returns {void}
   */
  #storePcmRamWrite(position) {
    const dataType = this.bytes[position + 2];
    const readOffset = readUint24LE(this.bytes, position + 3);
    const writeOffset = readUint24LE(this.bytes, position + 6);
    const size = readUint24LE(this.bytes, position + 9);
    this.pcmRamWrites.push({
      type: dataType,
      readOffset,
      writeOffset,
      size,
      commandOffset: position,
    });
    this.#warn(
      `Parsed VGM PCM RAM write 0x68 (type=${formatHexNumber(dataType)}, readOffset=${formatHexNumber(readOffset, 6)}, writeOffset=${formatHexNumber(writeOffset, 6)}, size=${size}) but playback is not implemented yet`,
    );
  }

  /**
   * @param {number} dataType
   * @param {number} dataOffset
   * @param {number} size
   * @returns {void}
   */
  #storeDataBlock(dataType, dataOffset, size) {
    const data = this.bytes.slice(dataOffset, dataOffset + size);
    if (dataType <= 0x3f) {
      this.dataBanks.set(dataType, data);
      this.dataBlocks.push(data);
      this.dataBlockInfo.push({
        type: dataType,
        size,
        preview: Array.from(data.subarray(0, Math.min(8, data.length)))
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(" "),
      });
      return;
    }
    this.#warn(
      `Skipping unsupported VGM data block 0x${dataType.toString(16).padStart(2, "0")} (size=${size})`,
    );
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {number}
 */
function readUint24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

/**
 * @param {number} value
 * @param {number} [width]
 * @returns {string}
 */
function formatHexNumber(value, width = 2) {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatOffset(value) {
  return value.toString(16).padStart(8, "0");
}

/**
 * @param {ArrayBuffer | ArrayBufferView | Ym2612VGM} source
 * @param {{
 *   includeHeaderComment?: boolean,
 *   includeDac?: boolean,
 *   dacBase64?: boolean,
 *   scheduled?: boolean,
 *   totalLoopSamples?: number | null,
 * }} [options]
 * @returns {string}
 */
export function exportYm2612VgmToPlaygroundJavaScript(source, options = {}) {
  return exportOpnFmVgmToPlaygroundJavaScript(
    source,
    options,
    "ym2612"
  );
}

/**
 * Export only the YM2608 FM register set as YM2612-compatible Playground
 * writes. SSG, Rhythm, and ADPCM-B registers are intentionally omitted.
 *
 * @param {ArrayBuffer | ArrayBufferView | Ym2612VGM} source
 * @param {{
 *   includeHeaderComment?: boolean,
 *   scheduled?: boolean,
 *   totalLoopSamples?: number | null,
 * }} [options]
 * @returns {string}
 */
export function exportYm2608FmVgmToPlaygroundJavaScript(source, options = {}) {
  return exportOpnFmVgmToPlaygroundJavaScript(
    source,
    options,
    "ym2608",
    "ym2612"
  );
}

/**
 * Export only the YM2203 FM register set as YM2612-compatible Playground
 * writes. The YM2203 SSG section is intentionally omitted.
 *
 * @param {ArrayBuffer | ArrayBufferView | Ym2612VGM} source
 * @param {{
 *   includeHeaderComment?: boolean,
 *   scheduled?: boolean,
 *   totalLoopSamples?: number | null,
 * }} [options]
 * @returns {string}
 */
export function exportYm2203FmVgmToPlaygroundJavaScript(source, options = {}) {
  return exportOpnFmVgmToPlaygroundJavaScript(
    source,
    options,
    "ym2203",
    "ym2612"
  );
}

/**
 * Export YM2203 FM writes for a native YM2203 target without changing FNUM.
 */
export function exportYm2203VgmToPlaygroundJavaScript(source, options = {}) {
  return exportOpnFmVgmToPlaygroundJavaScript(source, options, "ym2203", "ym2203");
}

/**
 * Export YM2608 FM writes for a native YM2608 target without changing FNUM.
 */
export function exportYm2608VgmToPlaygroundJavaScript(source, options = {}) {
  return exportOpnFmVgmToPlaygroundJavaScript(source, options, "ym2608", "ym2608");
}

/** Export YM2610B FM writes while omitting SSG and ADPCM registers. */
export function exportYm2610BVgmToPlaygroundJavaScript(source, options = {}) {
  return exportOpnFmVgmToPlaygroundJavaScript(source, options, "ym2610", "ym2610");
}

function exportOpnFmVgmToPlaygroundJavaScript(source, options, chipKind, targetChip) {
  const parser = source instanceof Ym2612VGM
    ? new Ym2612VGM(source.bytes, { logger: null })
    : new Ym2612VGM(source, { logger: null });
  /** @type {Array<{ name: string, events: Array<{ timeSamples: number, port: 0 | 1, register: number, value: number, comment: string | null }>, currentTime: number }>} */
  const tracks = [
    { name: "global", events: [], currentTime: 0 },
    { name: "ch0", events: [], currentTime: 0 },
    { name: "ch1", events: [], currentTime: 0 },
    { name: "ch2", events: [], currentTime: 0 },
    { name: "ch3", events: [], currentTime: 0 },
    { name: "ch4", events: [], currentTime: 0 },
    { name: "ch5", events: [], currentTime: 0 },
  ];
  let timeSamples = 0;
  const orderedEvents = [];
  const includeDac =
    chipKind === "ym2612" &&
    options.includeDac !== false;
  const recordWrite = (register, value, port = 0) => {
    if (
      !includeDac &&
      port === 0 &&
      (register === 0x2a || register === 0x2b)
    ) {
      return;
    }
    const target = getYm2612WriteTarget(port, register, value);
    const trackIndex = target.scope === "channel" ? target.channel + 1 : 0;
    const recordedEvent = {
      timeSamples,
      port,
      register,
      value,
      comment: describeYm2612Write(port, register, value),
    };
    tracks[trackIndex].events.push(recordedEvent);
    orderedEvents.push(recordedEvent);
  };
  const convertFrequency = targetChip === "ym2612";
  const writeRegister = chipKind === "ym2608" && convertFrequency
    ? createOpnFmWriteTranslator(
      parser.header.ym2608Clock,
      recordWrite,
      isYm2608FmRegister
    )
    : chipKind === "ym2203" && convertFrequency
      ? createOpnFmWriteTranslator(
        parser.header.ym2203Clock,
        recordWrite,
        isYm2203FmRegister
      )
      : chipKind === "ym2610" && convertFrequency
        ? createOpnFmWriteTranslator(parser.header.ym2610Clock, recordWrite, isYm2610FmRegister)
      : chipKind === "ym2612"
        ? recordWrite
      : (register, value, port = 0) => {
        const isFmRegister = chipKind === "ym2608"
          ? isYm2608FmRegister
          : chipKind === "ym2610" ? isYm2610FmRegister : isYm2203FmRegister;
        if (isFmRegister(port, register)) {
          recordWrite(register, value, port);
        }
      };
  const targets = chipKind === "ym2608"
    ? { ym2608: { writeRegister } }
    : chipKind === "ym2203"
      ? { ym2203: { writeRegister } }
      : chipKind === "ym2610"
        ? { ym2610: { writeRegister } }
      : { writeRegister };

  while (true) {
    const event = parser.playStep(targets);
    if (event.type === "wait") {
      parser.consumeWait(targets, event.samples, (segment) => {
        timeSamples += segment;
      });
      continue;
    }
    if (event.type === "end") {
      break;
    }
  }

  if (chipKind === "ym2203" && targetChip === "ym2612") {
    for (let channel = 0; channel < 3; channel += 1) {
      tracks[channel + 1].events.unshift({
        timeSamples: 0,
        port: 0,
        register: 0xb4 + channel,
        value: 0xc0,
        comment: `CH${channel}: PAN L+R (YM2203 mono)`,
      });
    }
  }

  const totalLoopSamples = options.totalLoopSamples == null
    ? timeSamples
    : Math.max(0, Math.floor(options.totalLoopSamples));
  if (options.high === true && chipKind === "ym2612") {
    return renderHighPlaygroundEvents(orderedEvents, totalLoopSamples, options);
  }
  /** @type {string[]} */
  const lines = [];
  if (options.includeHeaderComment !== false) {
    lines.push(
      chipKind === "ym2608"
        ? targetChip === "ym2612"
          ? "// Generated from YM2608 VGM FM registers only (SSG, Rhythm, and ADPCM-B omitted; FNUM converted for YM2612)."
          : "// Generated from YM2608 VGM FM registers only (SSG, Rhythm, and ADPCM-B omitted)."
        : chipKind === "ym2203"
          ? targetChip === "ym2612"
            ? "// Generated from YM2203 VGM FM registers only (SSG omitted; FNUM converted and YM2612 pan initialized to L+R)."
            : "// Generated from YM2203 VGM FM registers only (SSG omitted)."
          : "// Generated by the Tetorica FM2612 VGM Analyzer."
    );
    lines.push(options.scheduled ? "// Register writes are scheduled at VGM sample positions (44100 Hz)." : "// Timing uses VGM sample units at 44100 Hz via sleepSamples().");
    lines.push("");
  }
  const dacEvents = tracks[0].events.filter((event) => event.port === 0 && event.register === 0x2a);
  const useDacBase64 =
    chipKind === "ym2612" &&
    options.dacBase64 !== false;
  if (useDacBase64 && dacEvents.length > 0) {
    const dacBytes = encodeDacScheduleBytes(dacEvents);
    const dacPath = options.writeDacFile?.(dacBytes);
    const encodedDac = dacPath ? null : JSON.stringify(encodeDacSchedule(dacEvents));
    lines.push('livePrepare("vgm-dac", async () => {');
    lines.push(dacPath
      ? `  await dac.load("vgm-dac", await file(${JSON.stringify(dacPath)}, { type: "arrayBuffer" }));`
      : `  await dac.loadBase64("vgm-dac", ${encodedDac});`);
    lines.push("});");
    lines.push("");
  }

  const chipTracks = chipKind === "ym2203"
    ? tracks.slice(0, 4)
    : tracks;
  const renderOrder = chipTracks[0].events.length > 0
    ? chipTracks
    : chipTracks.slice(1);
  for (let index = 0; index < renderOrder.length; index += 1) {
    const track = renderOrder[index];
    const trackLines = renderPlaygroundTrack(
      track,
      totalLoopSamples,
      options.scheduled === true,
      useDacBase64
    );
    for (const line of trackLines) {
      lines.push(line);
    }
    if (index < renderOrder.length - 1) {
      lines.push("");
    }
  }
  return lines.join("\n");
}

/**
 * @param {{ name: string, events: Array<{ timeSamples: number, port: 0 | 1, register: number, value: number, comment: string | null }>, currentTime?: number }} track
 * @param {number} totalLoopSamples
 * @returns {string[]}
 */
function decodeHighOperator(event) {
  const { register, value, port } = event;
  const family = register & 0xf0;
  const offset = register & 3;
  if (family < 0x30 || family > 0x90 || offset === 3) return null;
  const masks = { 0x30: 0x7f, 0x40: 0x7f, 0x50: 0xdf, 0x60: 0x9f, 0x70: 0x1f, 0x80: 0xff, 0x90: 0x0f };
  if ((value & masks[family]) !== value) return null;
  const params = family === 0x30 ? { dt: value >> 4, multi: value & 15 }
    : family === 0x40 ? { tl: value }
    : family === 0x50 ? { rs: value >> 6, ar: value & 31 }
    : family === 0x60 ? { am: Boolean(value & 0x80), d1r: value & 31 }
    : family === 0x70 ? { d2r: value }
    : family === 0x80 ? { sl: value >> 4, rr: value & 15 }
    : { ssg: value };
  const operator = [1, 3, 2, 4][(register >> 2) & 3];
  const literal = `{ ${Object.entries(params).map(([name, v]) => `${name}: ${v}`).join(", ")} }`;
  return { channel: port * 3 + offset + 1, operator, literal };
}

function collectHighOperatorGroups(events) {
  const groups = new Map();
  const settings = new Map();
  for (let i = 0; i < events.length; i++) {
    const first = decodeHighOperator(events[i]);
    if (!first) continue;
    const entries = [first];
    let end = i + 1;
    while (end < events.length && events[end].timeSamples === events[i].timeSamples) {
      const next = decodeHighOperator(events[end]);
      if (!next || next.channel !== first.channel) break;
      entries.push(next);
      end++;
    }
    const literal = `[${entries.map((entry) => `[OP${entry.operator}, ${entry.literal}]`).join(", ")}]`;
    const setting = settings.get(literal) ?? { literal, entries, count: 0, name: null, entryCount: entries.length };
    setting.count++;
    settings.set(literal, setting);
    groups.set(i, { entries, end, setting });
    i = end - 1;
  }
  let serial = 0;
  for (const setting of settings.values()) {
    // Include declaration overhead when deciding whether sharing saves space.
    const name = `operators${String(serial + 1).padStart(3, "0")}`;
    if (setting.entryCount > 4 && setting.count > 1 && (setting.literal.length - name.length) * setting.count >
        setting.literal.length + name.length + 10) {
      setting.name = name;
      serial++;
    }
  }
  return { groups, settings };
}

function renderHighPlaygroundEvents(events, totalLoopSamples, options) {
  const { groups, settings } = collectHighOperatorGroups(events);
  const dacEvents = options.dacBase64 !== false
    ? events.filter((event) => event.port === 0 && event.register === 0x2a)
    : [];
  const lines = [
    "// High import: FM register values preserved; timing in 44100 Hz samples.",
  ];
  for (const setting of settings.values()) {
    if (setting.name) {
      lines.push("/** @type {Array<[YM2612Operator, YM2612OperatorParams]>} */");
      lines.push(`const ${setting.name} = [`);
      for (const entry of setting.entries) lines.push(`  [OP${entry.operator}, ${entry.literal}],`);
      lines.push("];");
    }
  }
  if (dacEvents.length > 0) {
    const path = options.writeDacFile?.(encodeDacScheduleBytes(dacEvents));
    lines.push('await livePrepare("vgm-dac", async () => {');
    lines.push(path
      ? `  await dac.load("vgm-dac", await file(${JSON.stringify(path)}, { type: "arrayBuffer" }));`
      : `  await dac.loadBase64("vgm-dac", ${JSON.stringify(encodeDacSchedule(dacEvents))});`);
    lines.push('});', '');
  }
  lines.push('liveLoop("vgm", async () => {');
  if (dacEvents.length > 0) {
    lines.push('  const dacStart = beginSampleSchedule();');
    lines.push('  dac.playStream("vgm-dac", { atSamples: dacStart });');
  }
  let cursor = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const { port, register, value } = event;
    if (dacEvents.length > 0 && port === 0 && register === 0x2a) continue;
    if (event.timeSamples > cursor) {
      lines.push(`  await sleepSamples(${event.timeSamples - cursor});`);
    }
    cursor = event.timeSamples;
    const offset = register - 0xa4;
    const next = events[index + 1];
    const group = groups.get(index);
    if (group) {
      const first = group.entries[0];
      if (group.entries.length === 1) {
        lines.push(`  fm.setOperator(CH${first.channel}, OP${first.operator}, ${first.literal});`);
      } else if (group.entries.length > 4 && !group.setting.name) {
        lines.push(`  fm.setOperators(CH${first.channel}, [`);
        for (const entry of group.entries) lines.push(`    [OP${entry.operator}, ${entry.literal}],`);
        lines.push("  ]);");
      } else {
        lines.push(`  fm.setOperators(CH${first.channel}, ${group.setting.name ?? group.setting.literal});`);
      }
      index = group.end - 1;
    } else if (register >= 0xb0 && register <= 0xb2 && value <= 0x3f) {
      lines.push(`  fm.setAlgo(CH${port * 3 + register - 0xb0 + 1}, ${value & 7}, ${value >> 3});`);
    } else if (register >= 0xb4 && register <= 0xb6 && (value & 8) === 0) {
      lines.push(`  fm.setPan(CH${port * 3 + register - 0xb4 + 1}, ${Boolean(value & 0x80)}, ${Boolean(value & 0x40)}, ${(value >> 4) & 3}, ${value & 7});`);
    } else if (port === 0 && register === 0x22 && value <= 15) {
      lines.push(`  fm.setLfo(${Boolean(value & 8)}, ${value & 7});`);
    } else if (port === 0 && register === 0x2b && (value === 0 || value === 0x80)) {
      lines.push(`  fm.setDacEnabled(${value === 0x80});`);
    } else if (offset >= 0 && offset < 3 && value <= 0x3f &&
        next?.port === port && next.register === 0xa0 + offset &&
        next.timeSamples === event.timeSamples) {
      lines.push(`  fm.setFrequency(CH${port * 3 + offset + 1}, ${value >> 3}, ${((value & 7) << 8) | next.value});`);
      index += 1;
    } else if (port === 0 && register === 0x28 && (value & 8) === 0 &&
        [0, 1, 2, 4, 5, 6].includes(value & 7)) {
      const code = value & 7;
      const channel = code < 3 ? code + 1 : code;
      const mask = value >> 4;
      const operators = [0, 1, 2, 3].filter((op) => mask & (1 << op));
      lines.push(mask === 0
        ? `  fm.keyOff(CH${channel});`
        : `  fm.keyOn(CH${channel}${mask === 15 ? "" : `, [${operators.map((op) => `OP${op + 1}`).join(", ")}]`});`);
    } else {
      if (event.comment) lines.push(`  // ${event.comment}`);
      lines.push(`  ${formatPlaygroundWrite(port, register, value)};`);
    }
  }
  const tail = Math.max(0, totalLoopSamples - cursor);
  if (tail > 0 || events.length === 0) lines.push(`  await sleepSamples(${Math.max(1, tail)});`);
  lines.push("});");
  return lines.join("\n");
}

function renderPlaygroundTrack(track, totalLoopSamples, scheduled, useDacBase64) {
  /** @type {string[]} */
  const lines = [`liveLoop(${JSON.stringify(track.name)}, async () => {`];
  const dacEvents = useDacBase64 && track.name === "global"
    ? track.events.filter((event) => event.port === 0 && event.register === 0x2a)
    : [];
  if (scheduled) {
    lines.push("  const cycleStart = beginSampleSchedule();");
    if (dacEvents.length > 0) {
      lines.push('  dac.playStream("vgm-dac", { atSamples: cycleStart });');
    }
    lines.push("  scheduleWritesSamples(cycleStart, [");
  } else if (dacEvents.length > 0) {
    lines.push("  const dacStart = beginSampleSchedule();");
    lines.push('  dac.playStream("vgm-dac", { atSamples: dacStart });');
  }
  let cursor = 0;
  for (const event of track.events) {
    if (useDacBase64 && event.port === 0 && event.register === 0x2a) continue;
    if (event.comment) {
      lines.push(`  ${scheduled ? "  " : ""}// ${event.comment}`);
    }
    if (scheduled) lines.push(`    [${event.timeSamples}, ${event.port}, ${formatHexNumber(event.register)}, ${formatHexNumber(event.value)}],`);
    else {
      const delta = event.timeSamples - cursor;
      if (delta > 0) lines.push(`  await sleepSamples(${delta});`);
      lines.push(`  ${formatPlaygroundWrite(event.port, event.register, event.value)};`);
      cursor = event.timeSamples;
    }
  }
  if (scheduled) {
    lines.push("  ]);");
    lines.push(`  await sleepSamples(${Math.max(1, totalLoopSamples)});`);
  } else {
    const tail = Math.max(0, totalLoopSamples - cursor);
    if (tail > 0 || track.events.length === 0) lines.push(`  await sleepSamples(${Math.max(1, tail)});`);
  }
  lines.push("});");
  return lines;
}

function encodeDacScheduleBytes(events) {
  const bytes = new Uint8Array(events.length * 5);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const offset = index * 5;
    view.setUint32(offset, event.timeSamples, true);
    bytes[offset + 4] = event.value;
  }
  return bytes;
}

function encodeDacSchedule(events) {
  const bytes = encodeDacScheduleBytes(events);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * @param {0|1} port
 * @param {number} register
 * @param {number} value
 * @returns {string}
 */
function formatPlaygroundWrite(port, register, value) {
  if (port === 0) {
    return `write(${formatHexNumber(register)}, ${formatHexNumber(value)})`;
  }
  return `write(${port}, ${formatHexNumber(register)}, ${formatHexNumber(value)})`;
}

/**
 * @param {0|1} port
 * @param {number} register
 * @param {number} value
 * @returns {{ scope: "global" } | { scope: "channel", channel: number }}
 */
export function getYm2612WriteTarget(port, register, value) {
  if (register === 0x28) {
    const channel = YM2612_KEY_CODE_TO_CHANNEL.get(value & 0x07);
    return Number.isInteger(channel)
      ? { scope: "channel", channel }
      : { scope: "global" };
  }

  if (
    register === 0x22 ||
    register === 0x27 ||
    register === 0x2a ||
    register === 0x2b
  ) {
    return { scope: "global" };
  }

  const channel = getYm2612RegisterChannel(port, register);
  return Number.isInteger(channel)
    ? { scope: "channel", channel }
    : { scope: "global" };
}

/**
 * @param {0|1} port
 * @param {number} register
 * @param {number} value
 * @returns {string | null}
 */
export function describeYm2612Write(port, register, value) {
  if (register === 0x22) {
    return (value & 0x08) !== 0
      ? `Enable LFO FREQ=${value & 0x07}`
      : "Disable LFO";
  }
  if (register === 0x27) {
    return `Mode / timer control: CH3 special=${bitLabel((value & 0x40) !== 0)}, CSM=${bitLabel((value & 0x80) !== 0)}, TimerA load=${bitLabel((value & 0x01) !== 0)}, TimerB load=${bitLabel((value & 0x02) !== 0)}, TimerA enable=${bitLabel((value & 0x04) !== 0)}, TimerB enable=${bitLabel((value & 0x08) !== 0)}`;
  }
  if (register === 0x28) {
    return describeYm2612KeyWrite(value);
  }
  if (register === 0x2a) {
    return `DAC data=${formatHexNumber(value)}`;
  }
  if (register === 0x2b) {
    return (value & 0x80) !== 0
      ? "Enable DAC"
      : "Disable DAC";
  }

  const channel = getYm2612RegisterChannel(port, register);
  if (!Number.isInteger(channel)) {
    return null;
  }
  const channelName = YM2612_CHANNEL_NAMES[channel];

  if (register >= 0x30 && register <= 0x3f) {
    const operator = getYm2612OperatorFromRegister(register);
    return operator === null
      ? null
      : `${channelName} OP${operator}: DT=${(value >> 4) & 0x07}, MULTI=${value & 0x0f}`;
  }
  if (register >= 0x40 && register <= 0x4f) {
    const operator = getYm2612OperatorFromRegister(register);
    return operator === null
      ? null
      : `${channelName} OP${operator}: TL=${value & 0x7f}`;
  }
  if (register >= 0x50 && register <= 0x5f) {
    const operator = getYm2612OperatorFromRegister(register);
    return operator === null
      ? null
      : `${channelName} OP${operator}: RS=${(value >> 6) & 0x03}, AR=${value & 0x1f}`;
  }
  if (register >= 0x60 && register <= 0x6f) {
    const operator = getYm2612OperatorFromRegister(register);
    return operator === null
      ? null
      : `${channelName} OP${operator}: AM=${(value >> 7) & 0x01}, D1R=${value & 0x1f}`;
  }
  if (register >= 0x70 && register <= 0x7f) {
    const operator = getYm2612OperatorFromRegister(register);
    return operator === null
      ? null
      : `${channelName} OP${operator}: D2R=${value & 0x1f}`;
  }
  if (register >= 0x80 && register <= 0x8f) {
    const operator = getYm2612OperatorFromRegister(register);
    return operator === null
      ? null
      : `${channelName} OP${operator}: SL=${(value >> 4) & 0x0f}, RR=${value & 0x0f}`;
  }
  if (register >= 0x90 && register <= 0x9f) {
    const operator = getYm2612OperatorFromRegister(register);
    return operator === null
      ? null
      : `${channelName} OP${operator}: SSG-EG=${formatHexNumber(value & 0x0f)}`;
  }
  if ((register >= 0xa0 && register <= 0xa2) || (register >= 0xa4 && register <= 0xa6)) {
    if (register >= 0xa4) {
      return `${channelName}: BLOCK=${(value >> 3) & 0x07}, FNUM high=${formatHexNumber(value & 0x07)}`;
    }
    return `${channelName}: FNUM low=${formatHexNumber(value)}`;
  }
  if ((register >= 0xa8 && register <= 0xaa) || (register >= 0xac && register <= 0xae)) {
    const operator = getYm2612Channel3SpecialOperator(register);
    if (operator === null) {
      return null;
    }
    if (register >= 0xac) {
      return `${channelName} OP${operator} special: BLOCK=${(value >> 3) & 0x07}, FNUM high=${formatHexNumber(value & 0x07)}`;
    }
    return `${channelName} OP${operator} special: FNUM low=${formatHexNumber(value)}`;
  }
  if (register >= 0xb0 && register <= 0xb2) {
    return `${channelName}: ALG=${value & 0x07}, FB=${(value >> 3) & 0x07}`;
  }
  if (register >= 0xb4 && register <= 0xb6) {
    return `${channelName}: L=${(value >> 7) & 0x01}, R=${(value >> 6) & 0x01}, AMS=${(value >> 4) & 0x03}, FMS=${value & 0x07}`;
  }

  return null;
}

/**
 * @param {0|1} port
 * @param {number} register
 * @returns {number | null}
 */
function getYm2612RegisterChannel(port, register) {
  if (register >= 0x30 && register <= 0x9f) {
    const channelOffset = register & 0x03;
    if (channelOffset > 2) {
      return null;
    }
    return (port === 0 ? 0 : 3) + channelOffset;
  }
  if (
    (register >= 0xa0 && register <= 0xa2) ||
    (register >= 0xa4 && register <= 0xa6) ||
    (register >= 0xb0 && register <= 0xb2) ||
    (register >= 0xb4 && register <= 0xb6)
  ) {
    return (port === 0 ? 0 : 3) + (register & 0x03);
  }
  if (
    port === 0 &&
    ((register >= 0xa8 && register <= 0xaa) ||
      (register >= 0xac && register <= 0xae))
  ) {
    return 2;
  }
  return null;
}

/**
 * @param {number} register
 * @returns {number | null}
 */
function getYm2612OperatorFromRegister(register) {
  const slotOffset = register & 0x0c;
  return YM2612_SLOT_TO_OPERATOR.get(slotOffset) ?? null;
}

/**
 * @param {number} register
 * @returns {number | null}
 */
function getYm2612Channel3SpecialOperator(register) {
  if (register >= 0xa8 && register <= 0xaa) {
    return YM2612_CH3_SPECIAL_LOW_TO_OPERATOR.get(register) ?? null;
  }
  if (register >= 0xac && register <= 0xae) {
    return YM2612_CH3_SPECIAL_HIGH_TO_OPERATOR.get(register) ?? null;
  }
  return null;
}

/**
 * @param {number} value
 * @returns {string}
 */
function describeYm2612KeyWrite(value) {
  const channel = YM2612_KEY_CODE_TO_CHANNEL.get(value & 0x07);
  const channelName = Number.isInteger(channel)
    ? YM2612_CHANNEL_NAMES[channel]
    : `KEY code ${formatHexNumber(value & 0x07)}`;
  const operators = [];
  if ((value & 0x10) !== 0) {
    operators.push("OP1");
  }
  if ((value & 0x20) !== 0) {
    operators.push("OP2");
  }
  if ((value & 0x40) !== 0) {
    operators.push("OP3");
  }
  if ((value & 0x80) !== 0) {
    operators.push("OP4");
  }
  if (operators.length === 0) {
    return `${channelName}: KEY OFF`;
  }
  const operatorText = operators.length === 4
    ? "OP1-4"
    : operators.join(", ");
  return `${channelName}: KEY ON ${operatorText}`;
}

/**
 * @param {boolean} value
 * @returns {"on" | "off"}
 */
function bitLabel(value) {
  return value ? "on" : "off";
}

/**
 * @param {Uint8Array} bytes
 * @param {DataView} view
 * @param {number} position
 * @returns {number}
 */
function rawCommandLength(bytes, view, position) {
  const command = bytes[position];
  if (command === 0x50) {
    return 2;
  }
  if (command === 0x52 || command === 0x53) {
    return 3;
  }
  if (command === 0x55) {
    return 3;
  }
  if (command === 0x56 || command === 0x57) {
    return 3;
  }
  if (command === 0x61) {
    return 3;
  }
  if (command === 0x62 || command === 0x63 || command === 0x66) {
    return 1;
  }
  if (command === 0x67) {
    return 7 + readUint32LE(view, position + 3);
  }
  if (command === 0x68) {
    return 12;
  }
  if (command >= 0x70 && command <= 0x7f) {
    return 1;
  }
  if (command >= 0x80 && command <= 0x8f) {
    return 1;
  }
  if (command === 0x90 || command === 0x91) {
    return 5;
  }
  if (command === 0x92) {
    return 6;
  }
  if (command === 0x93) {
    return 11;
  }
  if (command === 0x94) {
    return 2;
  }
  if (command === 0x95) {
    return 5;
  }
  if (command === 0xe0) {
    return 5;
  }
  const ignoredLength = ignoredCommandLength(command);
  if (ignoredLength !== null) {
    return ignoredLength;
  }
  throw new Error(`Unsupported raw VGM command 0x${command.toString(16).padStart(2, "0")}`);
}

/**
 * @param {number} command
 * @returns {number | null}
 */
function ignoredCommandLength(command) {
  if ((command >= 0x30 && command <= 0x3f) || command === 0x4f) {
    return 2;
  }
  if ((command >= 0x40 && command <= 0x4e) || command === 0x5d || (command >= 0xb0 && command <= 0xbf)) {
    return 3;
  }
  if ((command >= 0xc0 && command <= 0xcf) || (command >= 0xd0 && command <= 0xdf)) {
    return 4;
  }
  if ((command >= 0xe1 && command <= 0xff)) {
    return 5;
  }
  return null;
}
