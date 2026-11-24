// SPDX-License-Identifier: BSD-3-Clause

const ADDRESS_UNIT = 256;
const MAX_ROM_BYTES = 0x1000000;
const ROM_PAGE_BYTES = 0x10000;
const A_END_MASK = 0xfffff;
const A_VOICES = 6;
// A retained view shares its current pages until a later upload edits one.
const sharedRomPages = new WeakSet();

/** Start is a byte address, end is the exclusive conversion of the
 * programmed inclusive register. OPNB compares only the low 20 end bits. */
export function normalizeFm2610AdpcmAWindow({start, end} = {}) {
  if (!Number.isInteger(start) || start < 0 || start >= MAX_ROM_BYTES || start % ADDRESS_UNIT ||
      !Number.isInteger(end) || end < ADDRESS_UNIT || end > MAX_ROM_BYTES || end % ADDRESS_UNIT) {
    throw new RangeError('ADPCM-A ROM addresses must be aligned to 256 bytes.');
  }
  const playbackEnd = start + ((end - start) & A_END_MASK);
  return {start, end, playbackEnd, rangeValid: playbackEnd > start && playbackEnd <= MAX_ROM_BYTES};
}

export function isFm2610SongAdpcmRegister(port, register) {
  if (!Number.isInteger(register)) return false;
  if (port === 0) return (register >= 0x10 && register <= 0x15) || (register >= 0x19 && register <= 0x1c);
  return port === 1 && (register === 0 || register === 1 ||
    (register >= 0x08 && register <= 0x2d && (register & 7) < A_VOICES));
}

function createRomBank(share) {
  // Track recorded coverage separately from the core's zero-filled ROM size.
  // Own only populated pages. A block near the top of a large bank does not
  // allocate memory for the ROM addresses before it.
  let rom = Object.freeze(share?.rom ?? {size: 0, revision: 0});
  const ranges = share?.ranges.slice() ?? [];
  const pages = new Map(share?.pages);
  for (const page of pages.values()) sharedRomPages.add(page);

  function clear() {
    ranges.length = 0;
    pages.clear();
    rom = Object.freeze({size: 0, revision: rom.revision + 1});
  }

  function load(data, offset, size) {
    if (!(data instanceof Uint8Array) || !Number.isInteger(size) || size < 0 || size > MAX_ROM_BYTES ||
        !Number.isInteger(offset) || offset < 0 || offset > size || data.length > size - offset) {
      throw new RangeError('Invalid YM2610 ADPCM ROM block.');
    }
    if (size < rom.size) {
      while (ranges.length && ranges.at(-1).start >= size) ranges.pop();
      if (ranges.length && ranges.at(-1).end > size) {
        ranges[ranges.length - 1] = {start: ranges.at(-1).start, end: size};
      }
      for (const index of pages.keys()) {
        if (index * ROM_PAGE_BYTES >= size) pages.delete(index);
      }
    }
    let start = offset, end = offset + data.length;
    if (data.length) {
      for (let copied = 0; copied < data.length;) {
        const address = offset + copied;
        const index = Math.floor(address / ROM_PAGE_BYTES), at = address % ROM_PAGE_BYTES;
        const count = Math.min(ROM_PAGE_BYTES - at, data.length - copied);
        let page = pages.get(index);
        if (!page || sharedRomPages.has(page)) {
          page = page ? page.slice() : new Uint8Array(ROM_PAGE_BYTES);
          pages.set(index, page);
        }
        page.set(data.subarray(copied, copied + count), at);
        copied += count;
      }
      // Merge adjacent fragments as well as overlaps. Later blocks replace
      // the bytes they cover, whether or not the nominal ROM size changes.
      let first = 0;
      while (first < ranges.length && ranges[first].end < start) first++;
      let last = first;
      while (last < ranges.length && ranges[last].start <= end) {
        start = Math.min(start, ranges[last].start);
        end = Math.max(end, ranges[last].end);
        last++;
      }
      ranges.splice(first, last - first, {start, end});
    }
    rom = Object.freeze({size, revision: rom.revision + 1});
  }

  function covers(start, end) {
    return end > start && end <= rom.size && ranges.some(range => range.start <= start && end <= range.end);
  }

  function saveState() {
    for (const page of pages.values()) sharedRomPages.add(page);
    return {rom, ranges: ranges.slice(), pages: new Map(pages)};
  }

  return {
    load, clear, covers,
    get descriptor() { return rom; },
    coveredRange(start, end) {
      return ranges.find(range => range.start <= start && end <= range.end);
    },
    saveState,
    fork: () => createRomBank(saveState()),
    read(start, end) {
      if (!covers(start, end)) return null;
      const result = new Uint8Array(end - start);
      for (let address = start; address < end;) {
        const index = Math.floor(address / ROM_PAGE_BYTES), at = address % ROM_PAGE_BYTES;
        const count = Math.min(ROM_PAGE_BYTES - at, end - address);
        result.set(pages.get(index).subarray(at, at + count), address - start);
        address += count;
      }
      return result;
    },
  };
}

/** Observe OPNB register writes and embedded ROM transfers at the song playhead.
 * `keyed` follows the last recorded trigger/reset request. The song log cannot
 * report live EOS or the decoder's current position.
 */
export function createFm2610SongAdpcmState(options = {}) {
  return createAdpcmState(options);
}

function createAdpcmState({clock = 8000000, outputSampleRate = 44100}, sharedBanks) {
  if (!Number.isFinite(clock) || clock <= 0) throw new RangeError('YM2610 clock must be positive.');
  if (!Number.isFinite(outputSampleRate) || outputSampleRate <= 0) throw new RangeError('Output sample rate must be positive.');
  const a = new Uint8Array(0x30), b = new Uint8Array(0x0c);
  let banks = sharedBanks ?? [createRomBank(), createRomBank()];
  const lastTrigger = new Uint32Array(A_VOICES);
  const triggerFrames = Array(A_VOICES).fill(null);
  let aKeyed = 0, aProgrammed = 0, aLevelWritten = false;
  let triggerOrder = 0, eosMask = 0, revision = 0, cached = null;

  function invalidate() {
    revision++;
    cached = null;
  }

  function clearRom() {
    for (const bank of banks) bank.clear();
    invalidate();
  }

  function resetRegisters() {
    a.fill(0);
    // The OPNB core resets all six A voices to maximum level and stereo.
    a.fill(0xdf, 0x08, 0x0e);
    b.fill(0);
    aKeyed = 0;
    aProgrammed = 0;
    aLevelWritten = false;
    triggerOrder = 0;
    lastTrigger.fill(0);
    triggerFrames.fill(null);
    eosMask = 0;
    invalidate();
  }

  function reset() {
    resetRegisters();
    clearRom();
  }

  function loadRom(type, data, offset, size) {
    if (type !== 0 && type !== 1) throw new RangeError('Expected ADPCM-A or ADPCM-B ROM.');
    banks[type].load(data, offset, size);
    invalidate();
  }

  function write(port, register, value, frame = 0) {
    if (!isFm2610SongAdpcmRegister(port, register)) return false;
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Expected an 8-bit YM2610 register value.');
    if (port === 1 && register === 0) {
      const mask = value & 0x3f;
      const off = Boolean(value & 0x80);
      const next = off ? aKeyed & ~mask : aKeyed | mask;
      const triggered = !off && mask !== 0;
      if (triggered) {
        if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('Invalid ADPCM-A trigger frame.');
        aProgrammed |= mask;
        triggerOrder++;
        for (let channel = 0; channel < A_VOICES; channel++) {
          if (mask & (1 << channel)) {
            lastTrigger[channel] = triggerOrder;
            triggerFrames[channel] = frame;
          }
        }
      }
      if (triggered || next !== aKeyed) {
        aKeyed = next;
        invalidate();
      }
    } else if (port === 0 && register === 0x1c) {
      const next = value & 0xbf;
      if (eosMask !== next) {
        eosMask = next;
        invalidate();
      }
    } else {
      const registers = port === 1 ? a : b;
      const index = port === 1 ? register : register - 0x10;
      // YM2610 forces external ADPCM-B mode and disables recording on 0x10.
      const next = port === 0 && register === 0x10 ? (value | 0x20) & ~0x40 : value;
      const before = aProgrammed, levelWritten = aLevelWritten;
      if (port === 1 && register === 1) aLevelWritten = true;
      if (port === 1 && register >= 0x08) aProgrammed |= 1 << (register & 7);
      if (registers[index] !== next || aProgrammed !== before || aLevelWritten !== levelWritten) {
        registers[index] = next;
        invalidate();
      }
    }
    return true;
  }

  function snapshot() {
    if (cached) {
      if (cached.adpcmA.rom === banks[0].descriptor && cached.adpcmB.rom === banks[1].descriptor) return cached;
      invalidate();
    }
    const voices = Array.from({length: A_VOICES}, (_, channel) => {
      const start = (a[0x10 + channel] | a[0x18 + channel] << 8) * ADDRESS_UNIT;
      const end = ((a[0x20 + channel] | a[0x28 + channel] << 8) + 1) * ADDRESS_UNIT;
      const window = normalizeFm2610AdpcmAWindow({start, end});
      const pan = a[0x08 + channel], mask = 1 << channel;
      const lastTriggerFrame = triggerFrames[channel];
      return Object.freeze({
        channel, ...window,
        available: banks[0].covers(start, window.playbackEnd),
        programmed: Boolean(aProgrammed & mask),
        keyed: Boolean(aKeyed & mask), lastTrigger: lastTrigger[channel], eosFlagEnabled: !(eosMask & mask),
        lastTriggerFrame, lastTriggerTime: lastTriggerFrame === null ? null : lastTriggerFrame / outputSampleRate,
        volume: pan & 31, left: Boolean(pan & 128), right: Boolean(pan & 64),
      });
    });
    const start = (b[2] | b[3] << 8) * ADDRESS_UNIT;
    const end = ((b[4] | b[5] << 8) + 1) * ADDRESS_UNIT;
    const deltaN = b[9] | b[10] << 8;
    const adpcmA = Object.freeze({volume: a[1] & 63, levelWritten: aLevelWritten, sampleRate: clock / 432,
      rom: banks[0].descriptor, voices: Object.freeze(voices)});
    const adpcmB = Object.freeze({
      start, end, rangeValid: end > start, available: banks[1].covers(start, end),
      deltaN, sampleRate: deltaN * clock / (144 * 65536),
      rom: banks[1].descriptor, volume: b[11], repeat: Boolean(b[0] & 0x10),
      left: Boolean(b[1] & 128), right: Boolean(b[1] & 64),
      keyed: (b[0] & 0x81) === 0x80, eosFlagEnabled: !(eosMask & 0x80),
    });
    cached = Object.freeze({revision, adpcmA, adpcmB});
    return cached;
  }

  function getAdpcmAWindow(channel, expected, customWindow) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= A_VOICES) return null;
    const {adpcmA} = snapshot();
    const voice = adpcmA.voices[channel];
    if (expected) {
      const previous = expected.voices?.[channel];
      if (expected.rom !== adpcmA.rom || previous?.start !== voice.start ||
          previous?.playbackEnd !== voice.playbackEnd) return null;
    }
    if (customWindow === undefined) {
      const {start, end, playbackEnd, rangeValid, available} = voice;
      return {start, end, playbackEnd, rangeValid, available};
    }
    const window = normalizeFm2610AdpcmAWindow(customWindow);
    return {...window, available: banks[0].covers(window.start, window.playbackEnd)};
  }

  function readAdpcmABytes(channel, expected, customWindow) {
    const window = getAdpcmAWindow(channel, expected, customWindow);
    return window?.available ? banks[0].read(window.start, window.playbackEnd) : null;
  }

  function readAdpcmBBytes(expected) {
    const {adpcmB: sample} = snapshot();
    if (expected && (expected.rom !== sample.rom || expected.start !== sample.start || expected.end !== sample.end)) return null;
    return banks[1].read(sample.start, sample.end);
  }

  function retainAdpcmARom(expected) {
    if (expected?.rom !== banks[0].descriptor) return null;
    const bank = banks[0].fork();
    return Object.freeze({
      coveredRange(start, end) {
        const range = bank.coveredRange(start, end);
        return range && {
          start: Math.ceil(range.start / ADDRESS_UNIT) * ADDRESS_UNIT,
          end: Math.floor(range.end / ADDRESS_UNIT) * ADDRESS_UNIT,
        };
      },
      read: bank.read,
    });
  }

  function saveState() {
    return {a: a.slice(), b: b.slice(), lastTrigger: lastTrigger.slice(), triggerFrames: [...triggerFrames],
      aKeyed, aProgrammed, aLevelWritten, triggerOrder, eosMask, revision, banks: banks.map(bank => bank.saveState())};
  }

  function loadState(state) {
    a.set(state.a);
    b.set(state.b);
    lastTrigger.set(state.lastTrigger);
    state.triggerFrames.forEach((frame, index) => { triggerFrames[index] = frame; });
    ({aKeyed, aProgrammed, aLevelWritten, triggerOrder, eosMask, revision} = state);
    banks = state.banks.map(createRomBank);
    cached = null;
  }

  if (sharedBanks) resetRegisters();
  else reset();
  return {write, loadRom, clearRom, reset, resetRegisters, snapshot, getAdpcmAWindow, readAdpcmABytes, readAdpcmBBytes, retainAdpcmARom,
    saveState, loadState,
    // Code runs get fresh register shadows over the same physical ROM.
    observeSharedRom() { return createAdpcmState({clock, outputSampleRate}, banks); },
    freezeSharedRom() { banks = banks.map(bank => bank.fork()); },
  };
}
