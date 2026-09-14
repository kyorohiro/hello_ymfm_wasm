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
 * @property {number} ay8910Clock
 * @property {number} ay8910Type
 * @property {number} ay8910Flags
 * @property {number} ym3526Clock
 * @property {number} ym3812Clock
 * @property {number} y8950Clock
 * @property {number} ymf278bClock
 * @property {number} ymf262Clock
 * @property {number} ym2151Clock
 * @property {number} ym2413Clock
 * @property {number} ym2203Clock
 * @property {number} ym2608Clock
 * @property {number} rf5c164Clock
 * @property {number} psgClock
 * @property {number} ym2610Clock
 * @property {number} totalSamples
 * @property {number} loopOffset
 * @property {number} loopSamples
 * @property {number} dataOffset
 */

/**
 * @typedef {{type:"ym2151-write",register:number,value:number}} Ym2151WriteEvent
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

/** @typedef {{ type: "ym2413-write", register: number, value: number }} Ym2413WriteEvent */
/** @typedef {{ type: "ym2610-write", port: 0|1, register: number, value: number }} Ym2610WriteEvent */
/** @typedef {{ type: "rf5c164-write", register: number, value: number, chipIndex: number } | { type: "rf5c164-memory-write", offset: number, value: number, chipIndex: number } | { type: "rf5c164-data", offset: number, data: Uint8Array, chipIndex: number }} Rf5c164Event */
/** @typedef {{ type: "ym2608-adpcm-b-data", data: Uint8Array, offset: number, memorySize: number, chipIndex: number }} Ym2608AdpcmBDataEvent */

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
 * @typedef {{type:"ay8910-write",register:number,value:number,chipIndex:number} | {type:"ym3526-write",register:number,value:number,chipIndex:number} | {type:"ym3812-write",register:number,value:number} | {type:"ymf262-write",register:number,value:number,port:number} | Ym2151WriteEvent | Ym2413WriteEvent | Rf5c164Event | Ym2612WriteEvent | Ym2203WriteEvent | Ym2608WriteEvent | Ym2608AdpcmBDataEvent | Ym2610WriteEvent | SegaPsgWriteEvent | Ym2612WaitEvent | Ym2612EndEvent} Ym2612VgmEvent
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
    this.bankBlocks = new Map();
    this.decompressionTables = new Map();
    this.bankBlocksSeen = new Set();
    this.rf5c164BlocksSeen = new Set();
    this.pwmBlocks = [];
    this.pwmBlocksSeen = new Set();
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
    const ym2151Clock = readUint32LE(this.view, 0x30);
    const ym2413Clock = readUint32LE(this.view, 0x10);

    const totalSamples = readUint32LE(this.view, 0x18);
    const loopOffsetRaw = readUint32LE(this.view, 0x1c);
    const loopSamples = readUint32LE(this.view, 0x20);
    const dataOffsetRaw = readUint32LE(this.view, 0x34);

    const dataOffset = version >= 0x00000150
      ? (dataOffsetRaw === 0 ? 0x40 : 0x34 + dataOffsetRaw)
      : 0x40;

    const extendedClock = (offset) => offset + 4 <= dataOffset && offset + 4 <= this.bytes.length
      ? readUint32LE(this.view, offset) : 0;
    const ym2203Clock = extendedClock(0x44);
    const ym2608Clock = extendedClock(0x48);
    const ym2610Clock = extendedClock(0x4c);
    const rf5c164Clock = version >= 0x151 ? extendedClock(0x6c) : 0;
    const pwmClock = version >= 0x151 ? extendedClock(0x70) : 0;
    const ym3526Clock = version >= 0x151 ? extendedClock(0x54) : 0;
    const ym3812Clock = version >= 0x151 ? extendedClock(0x50) : 0;
    const ymf278bClock = version >= 0x151 ? extendedClock(0x60) : 0;
    const ymf262Clock = version >= 0x151 ? extendedClock(0x5c) : 0;
    const segaPcmClock = version >= 0x151 ? extendedClock(0x38) : 0;
    const ay8910Clock = version >= 0x151 ? extendedClock(0x74) : 0;
    const headerByte = offset => offset < dataOffset && offset < this.bytes.length ? this.bytes[offset] : 0;
    const ay8910Type = version >= 0x151 ? headerByte(0x78) : 0;
    const ay8910Flags = version >= 0x151 ? headerByte(0x79) : 0;
    const y8950Clock = version >= 0x151 ? extendedClock(0x58) : 0;
    const k051649Clock = version >= 0x161 ? extendedClock(0x9c) : 0;
    const psgClock = readUint32LE(this.view, 0x0c);
    const loopOffset = loopOffsetRaw === 0 ? 0 : 0x1c + loopOffsetRaw;

    return {
      ident,
      version,
      ym2612Clock,
      ym2413Clock, ym2151Clock, ym3526Clock, ym3812Clock, ymf262Clock, ymf278bClock, segaPcmClock,
      ay8910Clock, ay8910Type, ay8910Flags, y8950Clock, k051649Clock,
      ym2203Clock,
      ym2608Clock,
      ym2610Clock,
      rf5c164Clock,
      pwmClock,
      psgClock,
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
    this.dataBanks.clear();
    this.bankBlocks.clear();
    this.decompressionTables.clear();
    this.bankBlocksSeen.clear();
    this.dataBlocks = [];
    this.dataBlockInfo = [];
    this.pwmBlocks = [];
    this.pwmBlocksSeen.clear();
    this.rf5c164BlocksSeen.clear();
    this.dataBankCursor = 0;
    this.pendingYm2612DataBankWrite = null;
    this.streams.clear();
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
      const size = readUint32LE(this.view, position + 3) & 0x7fffffff;
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
        const size = readUint32LE(this.view, position + 3) & 0x7fffffff;
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
      case 0xa0: {
        this.#ensureAvailable(3);
        const address = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ay8910-write", register: address & 0x7f, value, chipIndex: address >>> 7 };
      }
      case 0x5c:
      case 0xac: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1], value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: 'y8950-write', register, value, chipIndex: command === 0xac ? 1 : 0 };
      }
      case 0xd0: {
        this.#ensureAvailable(4);
        const port = this.bytes[this.position + 1];
        if ((port & 0x7f) > 2) throw new RangeError('Invalid YMF278B port');
        const register = this.bytes[this.position + 2], value = this.bytes[this.position + 3];
        this.position += 4;
        return { type: 'ymf278b-write', port: port & 0x7f, register, value, chipIndex: port >>> 7 };
      }
      case 0x5b:
      case 0xab: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym3526-write", register, value, chipIndex: command === 0xab ? 1 : 0 };
      }
      case 0x5a: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1], value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym3812-write", register, value };
      }
      case 0x5e:
      case 0x5f: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1], value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ymf262-write", port: command - 0x5e, register, value };
      }
      case 0x54: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1], value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym2151-write", register, value };
      }
      case 0xa1:
      case 0x51: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "ym2413-write", register, value, ...(command === 0xa1 ? {chipIndex:1} : {}) };
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
      case 0xb2: {
        this.#ensureAvailable(3);
        const packed = this.bytes[this.position + 1];
        const value = ((packed & 15) << 8) | this.bytes[this.position + 2];
        this.position += 3;
        return { type: "pwm-write", register: packed >> 4, value };
      }
      case 0xb1: {
        this.#ensureAvailable(3);
        const register = this.bytes[this.position + 1];
        const value = this.bytes[this.position + 2];
        this.position += 3;
        return { type: "rf5c164-write", register: register & 0x7f, value, chipIndex: register >>> 7 };
      }
      case 0xc2: {
        this.#ensureAvailable(4);
        const offset = readUint16LE(this.view, this.position + 1);
        const value = this.bytes[this.position + 3];
        if (offset > 0xfff) throw new RangeError("RF5C164 memory window exceeds 4 KiB");
        this.position += 4;
        return { type: "rf5c164-memory-write", offset, value, chipIndex: 0 };
      }
      case 0x67: {
        this.#ensureAvailable(7);
        if (this.bytes[this.position + 1] !== 0x66) {
          throw new Error("Invalid VGM data block header");
        }
        const dataType = this.bytes[this.position + 2];
        const rawSize = readUint32LE(this.view, this.position + 3);
        const size = rawSize & 0x7fffffff;
        this.#ensureAvailable(7 + size);
        if (dataType === 0xc1) {
          if (size < 2) throw new Error("Invalid RF5C164 RAM block header");
          const offset = readUint16LE(this.view, this.position + 7);
          const data = this.bytes.slice(this.position + 9, this.position + 7 + size);
          if (data.length > 65536 - offset) throw new RangeError("RF5C164 RAM block range");
          this.position += 7 + size;
          return { type: "rf5c164-data", offset, data, chipIndex: rawSize >>> 31 };
        }
        if (dataType === 0x02 && rawSize >>> 31) {
          this.#warn("Skipping data for unsupported second RF5C164 chip");
          this.position += 7 + size;
          return this.step();
        }
        if ([0x84, 0x87, 0x88].includes(dataType)) {
          if (size < 8) throw new Error('Invalid OPL sample block header');
          const memorySize = readUint32LE(this.view, this.position + 7);
          const offset = readUint32LE(this.view, this.position + 11);
          const chip = dataType === 0x88 ? 'y8950' : 'ymf278b';
          if (memorySize > (chip === 'y8950' ? 0x200000 : 0x400000) || offset > memorySize || size - 8 > memorySize - offset)
            throw new RangeError('Invalid OPL sample memory range');
          const data = this.bytes.slice(this.position + 15, this.position + 7 + size);
          this.position += 7 + size;
          return { type: 'opl-sample-data', chip, data, offset, memorySize, chipIndex: rawSize >>> 31 };
        }
        if (dataType === 0x82 || dataType === 0x83) {
          if (size < 8) throw new Error('Invalid YM2610 ROM block header');
          const memorySize = readUint32LE(this.view, this.position + 7);
          const offset = readUint32LE(this.view, this.position + 11);
          if (memorySize > 0x1000000 || offset > memorySize || size-8 > memorySize-offset) throw new RangeError('Invalid YM2610 ROM range');
          const data = this.bytes.slice(this.position+15,this.position+7+size);
          this.position += 7+size;
          return { type:'ym2610-rom-data', romType:dataType-0x82, data, offset, memorySize, chipIndex:rawSize >>> 31 };
        }
        if (dataType === 0x81) {
          if (size < 8) throw new Error("Invalid YM2608 ADPCM-B data block: missing memory header");
          const memorySize = readUint32LE(this.view, this.position + 7);
          const offset = readUint32LE(this.view, this.position + 11);
          if (memorySize > 0x200000 || offset > memorySize || size - 8 > memorySize - offset) {
            throw new RangeError("Invalid YM2608 ADPCM-B data block: sample memory range");
          }
          const data = this.bytes.slice(this.position + 15, this.position + 7 + size);
          this.position += 7 + size;
          return { type: "ym2608-adpcm-b-data", data, offset, memorySize, chipIndex: rawSize >>> 31 };
        }
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
      if (this.bytes[this.position + 1] !== 0x66) throw new Error("Invalid PCM RAM write header");
      const dataType = this.bytes[this.position + 2];
      if ((dataType & 0x7f) === 2) {
        const offset = readUint24LE(this.bytes, this.position + 6);
        const readOffset = readUint24LE(this.bytes, this.position + 3);
        const size = readUint24LE(this.bytes, this.position + 9) || 0x1000000;
        const chipIndex = dataType >>> 7;
        const bank = this.dataBanks.get(2);
        if (!chipIndex && (!bank || readOffset > bank.length || size > bank.length - readOffset || offset > 65536 || size > 65536 - offset)) {
          throw new RangeError("RF5C164 PCM RAM transfer range");
        }
        this.position += 12;
        return { type: "rf5c164-data", offset, data: chipIndex ? new Uint8Array() : bank.slice(readOffset, readOffset + size), chipIndex };
      }
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
   *   resolveChip?: (type: string, index: number) => { writeRegister(register: number, value: number, port?: number): void, loadSampleMemory?(data: Uint8Array, offset: number, memorySize: number): void },
   *   ym2612?: { writeRegister(register: number, value: number, port?: number): void },
   *   ay8910?: { writeRegister(register: number, value: number): void },
 *   y8950?: { writeRegister(register: number, value: number): void, loadSampleMemory?(data: Uint8Array, offset: number, memorySize: number): void },
 *   ymf278b?: { writeRegister(register: number, value: number, port: number): void, loadSampleMemory?(data: Uint8Array, offset: number, memorySize: number): void },
 *   ym3526?: { writeRegister(register: number, value: number): void },
 *   ym3812?: { writeRegister(register: number, value: number): void },
 *   ymf262?: { writeRegister(register: number, value: number, port: number): void },
 *   ym2151?: { writeRegister(register: number, value: number): void },
 *   ym2413?: { writeRegister(register: number, value: number): void },
 *   ym2203?: { writeRegister(register: number, value: number): void },
   *   ym2608?: { writeRegister(register: number, value: number, port?: number): void, loadAdpcmBMemory?(data: Uint8Array, offset: number, memorySize: number): void },
   *   psg?: { write(data: number): void },
   *   writeRegister?: (register: number, value: number, port?: number) => void
   * }} targets
   * @returns {Ym2612VgmEvent}
   */
  playStep(targets) {
    const event = this.step();
    if (typeof targets.resolveChip === 'function') {
      const chip = event.type === 'opl-sample-data' ? event.chip :
        ({'ay8910-write':'ay8910', 'ym2413-write':'ym2413', 'y8950-write':'y8950'})[event.type];
      if (chip) {
        const target = targets.resolveChip(chip, event.chipIndex ?? 0);
        if (event.type === 'opl-sample-data') target.loadSampleMemory(event.data, event.offset, event.memorySize);
        else target.writeRegister(event.register, event.value, event.port ?? 0);
        return event;
      }
    }
    if (event.type === "pwm-write") {
      if (targets.pwm) targets.pwm.writeRegister(event.register, event.value);
      else this.#warn("PWM write requires a PWM playback target");
      return event;
    }
    if (event.type.startsWith("rf5c164-")) {
      if (event.chipIndex) {
        this.#warn("Skipping data for unsupported second RF5C164 chip");
      } else if (!targets.rf5c164) {
        this.#warn("RF5C164 event requires a PCM playback target");
      } else if (event.type === "rf5c164-write") {
        targets.rf5c164.writeRegister(event.register, event.value);
      } else if (event.type === "rf5c164-memory-write") {
        targets.rf5c164.writeMemory(event.offset, event.value);
      } else {
        targets.rf5c164.loadBankedMemory(event.data, event.offset);
      }
    }
    if (event.type === "ym2608-adpcm-b-data") {
      if (event.chipIndex !== 0) {
        this.#warn("Skipping ADPCM-B data for the unsupported second YM2608 chip");
      } else if (typeof targets.ym2608?.loadAdpcmBMemory === "function") {
        targets.ym2608.loadAdpcmBMemory(event.data, event.offset, event.memorySize);
      } else {
        this.#warn("YM2608 ADPCM-B data requires a playback target with sample memory support");
      }
    }
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
    if (event.type === "ay8910-write") {
      if (event.chipIndex) throw new Error('Second AY chip: Support coming soon.');
      targets.ay8910?.writeRegister(event.register, event.value);
      return event;
    }
    if (event.type === 'opl-sample-data') {
      if (event.chipIndex) throw new Error('Second OPL chip: Support coming soon.');
      targets[event.chip]?.loadSampleMemory?.(event.data, event.offset, event.memorySize);
      return event;
    }
    if (event.type === 'y8950-write' || event.type === 'ymf278b-write') {
      if (event.chipIndex) throw new Error('Second OPL chip: Support coming soon.');
      targets[event.type === 'y8950-write' ? 'y8950' : 'ymf278b']?.writeRegister(event.register, event.value, event.port ?? 0);
      return event;
    }
    if (event.type === "ym3526-write") {
      if (event.chipIndex) throw new Error('Second YM3526 chip: Support coming soon.');
      targets.ym3526?.writeRegister(event.register, event.value);
      return event;
    }
    if (event.type === "ym3812-write") {
      targets.ym3812?.writeRegister(event.register, event.value);
      return event;
    }
    if (event.type === "ymf262-write") {
      targets.ymf262?.writeRegister(event.register, event.value, event.port);
      return event;
    }
    if (event.type === "ym2151-write") {
      targets.ym2151?.writeRegister(event.register, event.value);
      return event;
    }
    if (event.type === "ym2413-write") {
      if (event.chipIndex) throw new Error("Second YM2413 chip: Support coming soon.");
      targets.ym2413?.writeRegister(event.register, event.value);
      return event;
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
    if (event.type === 'ym2610-rom-data') {
      if (event.chipIndex) this.#warn('Skipping second YM2610 ROM');
      else if (targets.ym2610?.loadAdpcmRom) targets.ym2610.loadAdpcmRom(event.romType,event.data,event.offset,event.memorySize);
      else this.#warn('YM2610 ROM requires an ADPCM playback target');
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
   *   resolveChip?: (type: string, index: number) => { writeRegister(register: number, value: number, port?: number): void, loadSampleMemory?(data: Uint8Array, offset: number, memorySize: number): void },
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

  // Detect PCM-only logs that omit all sample data (e.g. Moonsound's built-in ROM).
  // Embedded sample blocks may still require additional ROM; this is a conservative check.
  requiresYmf278bWaveRom() {
    if (!(this.header.ymf278bClock & 0x3fffffff)) return false;
    const scan = new Ym2612VGM(this.bytes);
    let pcmKeyOn = false;
    while (!scan.ended) {
      const event = scan.step();
      if (event.type === 'opl-sample-data' && event.chip === 'ymf278b' && !event.chipIndex && event.data.length)
        return false;
      if (event.type === 'ymf278b-write' && !event.chipIndex && event.port === 2 &&
          event.register >= 0x68 && event.register <= 0x7f && (event.value & 0x80)) pcmKeyOn = true;
    }
    return pcmKeyOn;
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
    if (command === 0xa0) {
      return `cmd=0xa0 ay8910 register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x5b || command === 0xab) {
      return `cmd=${formatHexNumber(command)} ym3526 chip=${command === 0xab ? 1 : 0} register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x5a || command === 0x5e || command === 0x5f) {
      return `cmd=${formatHexNumber(command)} ${command === 0x5a ? 'ym3812' : 'ymf262 port=' + (command - 0x5e)} register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x5c || command === 0xac) {
      return `cmd=${formatHexNumber(command)} y8950 register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0xd0) {
      return `cmd=0xd0 ymf278b port=${this.bytes[position + 1]} register=${formatHexNumber(this.bytes[position + 2])} value=${formatHexNumber(this.bytes[position + 3])}`;
    }
    if (command === 0x54) {
      return `cmd=0x54 ym2151 register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x51) {
      return `cmd=0x51 ym2413 register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x55) {
      return `cmd=0x55 ym2203 register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x56 || command === 0x57) {
      return `cmd=0x${command.toString(16)} ym2608 port=${command === 0x56 ? 0 : 1} register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
    }
    if (command === 0x58 || command === 0x59) {
      return `cmd=0x${command.toString(16)} ym2610 port=${command - 0x58} register=${formatHexNumber(this.bytes[position + 1])} value=${formatHexNumber(this.bytes[position + 2])}`;
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
        chipType: -1,
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
    const commandLength = {0x90:5,0x91:5,0x92:6,0x93:11,0x94:2,0x95:5}[command];
    this.#ensureAvailable(commandLength);
    // 0xff is reserved; only 0x94 uses it (stop all).
    if (this.bytes[this.position + 1] === 0xff && command !== 0x94) {
      this.position += commandLength;
      return;
    }
    if (command === 0x90) {
      this.#ensureAvailable(5);
      const stream = this.#streamState(this.bytes[this.position + 1]);
      stream.chipType = this.bytes[this.position + 2];
      // Only these first-instance destinations have a stream writer.
      stream.disabled = ![0x00, 0x02, 0x11].includes(stream.chipType);
      stream.active = false;
      if (stream.disabled) {
        const names = {0x00:'PSG',0x01:'YM2413',0x02:'YM2612',0x03:'YM2151',0x09:'YM3812',0x0a:'YM3526',0x0b:'Y8950',0x0c:'YMF262',0x0d:'YMF278B',0x10:'RF5C164',0x11:'PWM',0x12:'AY'};
        const type = stream.chipType & 0x7f;
        this.#warn(`Unsupported DAC stream skipped: ${names[type] ?? 'chip'} (${formatHexNumber(type)}), instance=${stream.chipType >>> 7}, stream=${this.bytes[this.position + 1]}. Playback continues without this stream.`);
      }
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
      if (this.bytes[this.position + 1] === 0xff) {
        for (const stream of this.streams.values()) stream.active = false;
        this.position += 2;
        return;
      }
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
      const blocks = this.bankBlocks.get(stream.dataBankId) || [];
      const block = blocks[blockId];
      const bank = this.dataBanks.get(stream.dataBankId) || null;
      const offset = blocks.slice(0, blockId).reduce((sum, data) => sum + data.length, 0);
      const width = stream.chipType === 0x11 || (stream.chipType === 0 && !(stream.register & 0x10)) ? 2 : 1;
      const count = block ? Math.max(0, Math.floor((block.length - stream.stepBase * width - width) / (stream.stepSize * width)) + 1) : 0;
      this.#startStream(stream, bank, offset, 1 | ((flags & 1) << 7) | (flags & 0x10), count);
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
    if (stream.disabled || ![0x00, 0x02, 0x11].includes(stream.chipType)) { stream.active = false; return; }
    if ((stream.chipType & 0x7f) === 0x11) {
      if (start === 0xffffffff) start = stream.pwmStart || 0;
      stream.pwmStart = start;
      const stride = stream.stepSize * 2;
      const offset = start + stream.stepBase * 2;
      const available = data ? Math.max(0, Math.floor((data.length - offset - 2) / stride) + 1) : 0;
      const kind = mode & 15;
      let count = available;
      if (kind === 1) count = Math.min(count, length);
      else if (kind === 2) count = Math.min(count, Math.floor(length * stream.frequency / 1000));
      else if (kind !== 0 && kind !== 3) {
        this.#warn("Unsupported PWM stream length mode"); count = 0;
      }
      stream.data = data;
      stream.dataOffset = offset;
      stream.pwmCount = kind === 0 && stream.pwmCount ? Math.min(count, stream.pwmCount) : count;
      stream.cursor = 0;
      // First write belongs to the start time, before the first wait segment.
      stream.sampleRemainder = 44100;
      stream.loop = Boolean(mode & 0x80);
      stream.pwmReverse = Boolean(mode & 0x10);
      stream.active = stream.chipType === 0x11 && stream.pwmCount > 0 && stream.frequency > 0;
      if (stream.chipType !== 0x11) this.#warn("Second PWM chip is unsupported");
      return;
    }
    // Length counts commands, while the start offset is measured in bytes.
    const width = stream.chipType === 0 && !(stream.register & 0x10) ? 2 : 1;
    const stride = stream.stepSize * width;
    const offset = start === 0xffffffff ? (stream.dataOffset || 0) : start + stream.stepBase * width;
    const available = data ? Math.max(0, Math.floor((data.length - offset - width) / stride) + 1) : 0;
    const kind = mode & 15;
    let count;
    if (kind === 0) count = stream.commandCount || 0;
    else if (kind === 1) count = length;
    else if (kind === 2) count = Math.floor(length * stream.frequency / 1000);
    else if (kind === 3) count = available;
    else { this.#warn('Unsupported DAC stream length mode'); count = 0; }
    stream.commandCount = count;
    stream.data = data;
    stream.dataOffset = offset;
    // Stop at the available data rather than reading outside the bank.
    stream.dataLength = Math.min(count, available);
    stream.cursor = 0;
    stream.sampleRemainder = 44100;
    stream.reverse = Boolean(mode & 0x10);
    stream.loop = Boolean(mode & 0x80);
    stream.active = stream.dataLength > 0 && stream.frequency > 0;
    if (!available) this.#warn('Skipping DAC stream start because no matching data block was loaded');
    if (stream.frequency <= 0) this.#warn('Skipping DAC stream start because frequency was not configured');
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
   *   resolveChip?: (type: string, index: number) => { writeRegister(register: number, value: number, port?: number): void, loadSampleMemory?(data: Uint8Array, offset: number, memorySize: number): void },
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
   *   resolveChip?: (type: string, index: number) => { writeRegister(register: number, value: number, port?: number): void, loadSampleMemory?(data: Uint8Array, offset: number, memorySize: number): void },
   *   ym2612?: { writeRegister(register: number, value: number, port?: number): void },
   *   psg?: { write(data: number): void },
   *   writeRegister?: (register: number, value: number, port?: number) => void
   * }} targets
   * @returns {void}
   */
  #performStreamWrite(stream, targets) {
    if (!stream.data || !stream.active || stream.disabled) {
      return;
    }
    if ((stream.chipType & 0x7f) === 0x11) {
      const index = stream.pwmReverse ? stream.pwmCount - 1 - stream.cursor : stream.cursor;
      const offset = stream.dataOffset + index * stream.stepSize * 2;
      const value = (stream.data[offset] | (stream.data[offset + 1] << 8)) & 0xfff;
      if (targets.pwm) targets.pwm.writeRegister(stream.register, value);
      else this.#warn("PWM stream requires a PWM playback target");
      stream.cursor++;
      if (stream.cursor >= stream.pwmCount) {
        if (stream.loop) stream.cursor = 0;
        else stream.active = false;
      }
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
    const index = stream.reverse ? stream.dataLength - 1 - stream.cursor : stream.cursor;
    const width = stream.chipType === 0 && !(stream.register & 0x10) ? 2 : 1;
    const dataIndex = stream.dataOffset + index * stream.stepSize * width;
    const value = stream.data[dataIndex];
    if (stream.chipType === 0) {
      if (typeof targets.psg?.write !== 'function') {
        stream.active = false;
        this.#warn('PSG stream requires a PSG playback target');
        return;
      }
      const command = stream.register & 0xf0;
      targets.psg.write(command | (value & 0x0f));
      if (width === 2) targets.psg.write(((stream.data[dataIndex + 1] & 3) << 4) | (value >> 4));
    } else {
      // Never route another chip's stream through YM2612.
      if (stream.chipType !== 0x02) { stream.active = false; return; }
      const ym2612 = targets.ym2612 || targets;
      if (ym2612 && typeof ym2612.writeRegister === 'function') {
        ym2612.writeRegister(stream.register, value, stream.port);
      }
    }
    stream.cursor++;
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
    let data = this.bytes.slice(dataOffset, dataOffset + size);
    if (dataType === 0x7f) {
      if (data.length < 6) throw new Error('Truncated decompression table');
      const [type, subtype, bits, packed] = data;
      const count = data[4] | (data[5] << 8), width = Math.ceil(bits / 8);
      if (type > 1 || (type === 0 ? subtype > 2 : subtype !== 0) || bits < 1 || bits > 16 || packed < 1 || packed > bits || data.length !== 6 + count * width)
        throw new Error('Invalid decompression table');
      const values = Array.from({length:count}, (_,i) => data[6+i*width] | (width === 2 ? data[7+i*width] << 8 : 0));
      this.decompressionTables.set(`${type}:${subtype}`, {bits,packed,values});
      return;
    }
    if (dataType <= 0x7e) {
      if (this.bankBlocksSeen.has(dataOffset)) return;
      if (dataType >= 0x40) data = decodePwmBlock(data, this.decompressionTables);
      const bankId = dataType & 0x3f;
      this.bankBlocksSeen.add(dataOffset);
      const blocks = this.bankBlocks.get(bankId) || [];
      blocks.push(data);
      this.bankBlocks.set(bankId, blocks);
      const old = this.dataBanks.get(bankId) || new Uint8Array();
      const joined = new Uint8Array(old.length + data.length);
      joined.set(old); joined.set(data, old.length);
      this.dataBanks.set(bankId, joined);
      // Streams retain their current bank when later blocks extend it.
      for (const stream of this.streams.values()) {
        if (stream.data === old) stream.data = joined;
      }
      if (bankId === 3) this.pwmBlocks = blocks;
      this.dataBlocks.push(data);
      this.dataBlockInfo.push({type: dataType, size,
        preview: Array.from(data.subarray(0, 8)).map(value => value.toString(16).padStart(2, '0')).join(' ')});
      return;
    }
    this.#warn(
      `Skipping unsupported VGM data block 0x${dataType.toString(16).padStart(2, "0")} (size=${size})`,
    );
  }
}

// Original decoder based on the VGM format specification, not emulator code.
// Shared recorded-bank decoder; export name retained for existing callers.
export function decodePwmBlock(data, tables = new Map()) {
  if (data.length < 10) throw new Error("Truncated compressed PWM header");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const size = view.getUint32(1, true), bits = data[5], packed = data[6], subtype = data[7];
  const type = data[0];
  if (type > 1 || (type === 0 ? subtype > 2 : subtype !== 0)) throw new Error('Unsupported compressed data format');
  const table = type === 1 || subtype === 2 ? tables.get(`${type}:${subtype}`) : null;
  if ((type === 1 || subtype === 2) && (!table || table.bits !== bits || table.packed !== packed))
    throw new Error('Missing or mismatched decompression table');
  if (bits < 1 || bits > 16 || packed < 1 || packed > bits) throw new Error("Invalid PWM compression bit width");
  const width = Math.ceil(bits / 8), count = size / width;
  if (size > 64 * 1024 * 1024 || !Number.isInteger(count) || count * packed > (data.length - 10) * 8)
    throw new Error("Invalid or oversized compressed PWM data");
  const output = new Uint8Array(size), add = view.getUint16(8, true);
  let bit = 80, state = add;
  for (let i = 0; i < count; i++) {
    let value = 0;
    for (let j = 0; j < packed; j++, bit++) value = (value << 1) | ((data[bit >> 3] >> (7 - (bit & 7))) & 1);
    if (table) {
      if (value >= table.values.length) throw new Error('Decompression table index out of range');
      value = table.values[value];
      if (type === 1) { state = (state + value) & ((1 << bits) - 1); value = state; }
    } else value = (subtype === 1 ? value << (bits - packed) : value) + add;
    value &= (1 << bits) - 1;
    output[i * width] = value & 255;
    if (width === 2) output[i * width + 1] = value >> 8;
  }
  return output;
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
 *   high?: boolean,
 *   noteish?: boolean,
 *   cleanNoteOnset?: boolean,
 *   compact?: boolean,
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

/** Export Neo Geo FM through the YM2612 compatibility target. */
export function exportYm2610FmVgmToPlaygroundJavaScript(source, options = {}) {
  return exportOpnFmVgmToPlaygroundJavaScript(source, options, "ym2610", "ym2612");
}

function exportOpnFmVgmToPlaygroundJavaScript(source, options, chipKind, targetChip) {
  const parser = source instanceof Ym2612VGM
    ? new Ym2612VGM(source.bytes, { logger: null })
    : new Ym2612VGM(source, { logger: null });
  /** @type {Array<{ name: string, events: Array<{ timeSamples: number, port: 0 | 1, register: number, value: number, comment: string | null }>, currentTime: number }>} */
  const tracks = [
    { name: "global", events: [], currentTime: 0 },
    { name: "ch1", events: [], currentTime: 0 },
    { name: "ch2", events: [], currentTime: 0 },
    { name: "ch3", events: [], currentTime: 0 },
    { name: "ch4", events: [], currentTime: 0 },
    { name: "ch5", events: [], currentTime: 0 },
    { name: "ch6", events: [], currentTime: 0 },
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
      sequence: orderedEvents.length,
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
      const panEvent = {
        timeSamples: 0,
        port: 0,
        register: 0xb4 + channel,
        value: 0xc0,
        comment: `CH${channel}: PAN L+R (YM2203 mono)`,
      };
      tracks[channel + 1].events.unshift(panEvent);
      orderedEvents.splice(channel, 0, panEvent);
    }
  }

  const totalLoopSamples = options.totalLoopSamples == null
    ? timeSamples
    : Math.max(0, Math.floor(options.totalLoopSamples));
  if ((options.high === true || options.compact === true)) {
    if (options.compact) options = { ...options, noteish: true };
    options = { ...options,
      nativeOpn: chipKind !== "ym2612" && targetChip !== "ym2612",
      noteClock: targetChip === "ym2612" ? YM2612_VGM_CLOCK :
        (parser.header[`${chipKind}Clock`] & 0x3fffffff) * (chipKind === "ym2203" ? 2 : 1),
      noteSpecial: orderedEvents.some(e => e.port === 0 && e.register === 0x27 && (e.value & 0xc0)),
      noteDac: orderedEvents.some(e => e.port === 0 && e.register === 0x2b && (e.value & 0x80)) };
    if (options.noteish) {
      const highLatches = [0, 0];
      // Annotate committed pitches before channel splitting or compaction so
      // cross-channel/port latch writes retain their original ordering.
      for (const e of orderedEvents) {
        if ((e.register & 0xf0) !== 0xa0 || (e.register & 3) === 3) continue;
        const latch = (e.register & 8) ? 1 : 0;
        if (e.register & 4) highLatches[latch] = e.value & 0x3f;
        else if (!latch) e.noteCommit = {
          channel: e.port * 3 + (e.register & 3) + 1,
          block: highLatches[0] >> 3,
          fnum: ((highLatches[0] & 7) << 8) | e.value,
        };
      }
    }
    if (options.compact && options.cleanNoteOnset === true) {
      const masks = Array(6).fill(0);
      const pending = Array(6).fill(null);
      for (const e of orderedEvents) {
        if (e.port === 0 && e.register === 0x28 && (e.value & 3) < 3) {
          const ch = (e.value & 3) + ((e.value & 4) ? 3 : 0);
          const mask = e.value >> 4;
          pending[ch] = masks[ch] === 0 && mask === 15 ? e : null;
          masks[ch] = mask;
        } else if (e.noteCommit) {
          const ch = e.noteCommit.channel - 1;
          const onset = pending[ch];
          pending[ch] = null;
          if (!onset || e.timeSamples - onset.timeSamples > 8 ||
              (ch === 2 && options.noteSpecial) || (ch === 5 && options.noteDac)) continue;
          // Emit the first committed pitch immediately before KEY ON.
          // Later high-only writes remain harmless latch writes.
          e.timeSamples = onset.timeSamples;
          e.sequence = onset.sequence - 0.5;
        }
      }
      const byTime = (a, b) => a.timeSamples - b.timeSamples || a.sequence - b.sequence;
      orderedEvents.sort(byTime);
      for (const track of tracks) track.events.sort(byTime);
    }
    const compactEvents = options.compact ? compactHighEvents(orderedEvents) : null;
    const retained = compactEvents ? new Set(compactEvents) : null;
    if (options.splitChannels === true) {
      return tracks.filter((track) => track.events.length > 0).map((track) =>
        `{\n${renderHighPlaygroundEvents(retained ? track.events.filter(e => retained.has(e)) : track.events, totalLoopSamples, options, track.name)}\n}`
      ).join("\n\n");
    }
    return renderHighPlaygroundEvents(compactEvents ?? orderedEvents, totalLoopSamples, options);
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
  const renderOrder = options.splitChannels === false
    ? [{ name: "vgm", events: orderedEvents }]
    : chipTracks[0].events.length > 0
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
    while (end < events.length && events[end].timeSamples === events[i].timeSamples &&
        events[end].sequence === events[end - 1].sequence + 1) {
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

/** Conservative per-export state tracking; first writes survive every loop iteration. */
function compactHighEvents(events) {
  const retained = [];
  const state = new Map();
  const pitches = new Map();
  // Removing a frequency pair is safe only when no later low write can consume its latch.
  let pairedFrequencyOnly = true;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.port === 0 && e.register === 0x27 && (e.value & 0xc0)) pairedFrequencyOnly = false;
    if (e.register >= 0xa0 && e.register <= 0xaf) {
      const next = events[i + 1];
      if (e.register >= 0xa4 && e.register <= 0xa6 && e.value <= 0x3f &&
          next?.register === e.register - 4 && next.port === e.port &&
          next.timeSamples === e.timeSamples && next.sequence === e.sequence + 1) i++;
      else pairedFrequencyOnly = false;
    }
  }
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const r = e.register;
    if (pairedFrequencyOnly && r >= 0xa4 && r <= 0xa6) {
      const low = events[++i];
      const key = `${e.port}/${r}`;
      const value = e.value * 256 + low.value;
      if (pitches.get(key) !== value) retained.push(e, low);
      pitches.set(key, value);
      continue;
    }
    // Plain operator parameters (not SSG-EG), algorithm/feedback and pan.
    const safe = (r & 3) < 3 && ((r >= 0x30 && r <= 0x8f) ||
      (r >= 0xb0 && r <= 0xb2) || (r >= 0xb4 && r <= 0xb6));
    const key = `${e.port}/${r}`;
    if (safe) {
      if (state.get(key) !== e.value) retained.push(e);
      state.set(key, e.value);
    } else {
      retained.push(e);
      // Frequency/latch writes cannot change operator parameters or pan/algorithm.
      // Retain the writes, but invalidate only pitch knowledge.
      if (r >= 0xa0 && r <= 0xaf) {
        pitches.clear();
      } else if (!(e.port === 0 && (r === 0x28 || r === 0x2a))) {
        state.clear();
        pitches.clear();
      }
    }
  }
  return retained;
}

function renderHighPlaygroundEvents(events, totalLoopSamples, options, loopName = "vgm") {
  const { groups, settings } = collectHighOperatorGroups(events);
  const notePitches = new Map();
  const dacEvents = options.dacBase64 !== false
    ? events.filter((event) => event.port === 0 && event.register === 0x2a)
    : [];
  const lines = [
    options.noteish ? "// Note-ish High: nearest semitone (A4=440 Hz); KEY, patch and timing preserved. CH3 special/DAC channels keep raw pitch." : "// High import: FM register values preserved; timing in 44100 Hz samples.",
  ];
  for (const setting of settings.values()) {
    if (setting.name && !options.nativeOpn) {
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
  lines.push(`liveLoop(${JSON.stringify(loopName)}, async () => {`);
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
      if (options.nativeOpn) {
        for (const entry of group.entries) lines.push(`  fm.setOperator(CH${entry.channel}, OP${entry.operator}, ${entry.literal});`);
      } else if (group.entries.length === 1) {
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
    } else if ((options.noteish && event.noteCommit) || (offset >= 0 && offset < 3 && value <= 0x3f &&
        next?.port === port && next.register === 0xa0 + offset &&
        next.timeSamples === event.timeSamples && next.sequence === event.sequence + 1)) {
      const commit = options.noteish ? event.noteCommit : null;
      const channel = commit?.channel ?? port * 3 + offset + 1;
      const block = commit?.block ?? (value >> 3);
      const fnum = commit?.fnum ?? (((value & 7) << 8) | next.value);
      const canNamePitch = options.noteClock > 0 && fnum > 0 &&
          !(channel === 3 && options.noteSpecial) && !(channel === 6 && options.noteDac);
      if (canNamePitch) {
        const hz = fnum * options.noteClock * 2 ** (block - 1) / (144 * 2 ** 20);
        const midiFloat = 69 + 12 * Math.log2(hz / 440);
        const midi = Math.round(midiFloat);
        const name = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
        if (!options.noteish) {
          lines.push(`  fm.setFrequency(CH${channel}, ${block}, ${fnum}); // ${name}`);
          index += commit ? 0 : 1;
          continue;
        }
        let targetBlock = block;
        let targetFnum = fnum * 2 ** ((midi - midiFloat) / 12);
        while (targetFnum > 2047 && targetBlock < 7) { targetFnum /= 2; targetBlock++; }
        if (Math.round(targetFnum) > 2047 || Math.round(targetFnum) < 1) {
          lines.push(`  fm.setFrequency(CH${channel}, ${block}, ${fnum}); // Note-ish out of range`);
        } else {
          const key = `${name}/${targetBlock}`;
          notePitches.set(key, [targetBlock, Math.round(targetFnum)]);
          lines.push(`  // ${name}: original BLOCK=${block} FNUM=${fnum}; rounding ${(100 * (midi - midiFloat)).toFixed(2)} cents`);
          lines.push(`  setNoteFrequency(CH${channel}, ${JSON.stringify(name)}, ${targetBlock});`);
        }
      } else lines.push(`  fm.setFrequency(CH${channel}, ${block}, ${fnum});`);
      index += commit ? 0 : 1;
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
  if (options.compact) {
    let used = false;
    for (let i = 0; i + 2 < lines.length; i++) {
      const on = /^  fm\.keyOn\((CH[1-6])\);$/.exec(lines[i]);
      const wait = /^  await sleepSamples\((\d+)\);$/.exec(lines[i + 1]);
      if (on && wait && lines[i + 2] === `  fm.keyOff(${on[1]});`) {
        lines.splice(i, 3, `  await keySamples(${on[1]}, ${wait[1]});`);
        used = true;
      }
    }
    if (used) lines.unshift(
      "/** @param {YM2612Channel} channel @param {number} samples */",
      "async function keySamples(channel, samples) {",
      "  fm.keyOn(channel);", "  await sleepSamples(samples);", "  fm.keyOff(channel);", "}", "");
    lines.unshift("// Compact Note-ish: repeated safe state writes removed; original sample positions retained.");
  }
  if (notePitches.size) lines.unshift(
    `// Note-ish pitch table calculated for VGM clock ${options.noteClock} Hz; independent of noteToBlockFnum().`,
    "/** @type {Record<string, [number, number]>} */",
    `const notePitches = ${JSON.stringify(Object.fromEntries(notePitches), null, 2)};`,
    "/** @param {YM2612Channel} channel @param {string} note @param {number} block */",
    "function setNoteFrequency(channel, note, block) {",
    '  const [pitchBlock, fnum] = notePitches[`${note}/${block}`];',
    "  fm.setFrequency(channel, pitchBlock, fnum);",
    "}", "");
  return lines.join("\n");
}

function renderPlaygroundTrack(track, totalLoopSamples, scheduled, useDacBase64) {
  /** @type {string[]} */
  const lines = [`liveLoop(${JSON.stringify(track.name)}, async () => {`];
  const dacEvents = useDacBase64
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
  if (command === 0xa1 || command === 0x5b || command === 0xab || command === 0x5c || command === 0xac || command === 0xa0 || command === 0x5a || command === 0x5e || command === 0x5f || command === 0x54 || command === 0x51 || command === 0x52 || command === 0x53) {
    return 3;
  }
  if (command === 0x55) {
    return 3;
  }
  if (command === 0x56 || command === 0x57 || command === 0x58 || command === 0x59) {
    return 3;
  }
  if (command === 0x61) {
    return 3;
  }
  if (command === 0x62 || command === 0x63 || command === 0x66) {
    return 1;
  }
  if (command === 0x67) {
    return 7 + (readUint32LE(view, position + 3) & 0x7fffffff);
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
