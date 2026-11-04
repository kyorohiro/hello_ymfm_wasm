// SPDX-License-Identifier: BSD-3-Clause

// The reader only needs arithmetic byte/bit timing to recognize real restart
// requests. It does not decode a song or render PCM while analyzing a file.
const NTSC = [428,380,340,320,286,254,226,214,190,160,142,128,106,84,72,54];
const PAL = [398,354,316,298,276,236,210,198,176,148,132,118,98,78,66,50];

export function createDmcCapture({clock, onVoice, onWarning, onVoiceWarning}) {
  const memory = new Uint8Array(65536), known = new Uint8Array(65536), registers = Array(4).fill(null);
  const periods = clock < 1700000 ? PAL : NTSC;
  let enabled = false, remaining = 0, hasSample = false, bitsLeft = 8, cyclesLeft = 0;
  let timingKnown = true, phaseApproximate = false, levelApproximate = false, streamActive = false;
  let activeVoice = null, activeStart = 0, activeLength = 0;
  let transferred = 0;
  const period = () => registers[0] === null ? null : periods[registers[0] & 15];
  const loop = () => registers[0] !== null && Boolean(registers[0] & 64);
  const playing = () => enabled && (remaining > 0 || hasSample || loop());
  const note = message => {
    onWarning(message);
    if (activeVoice) onVoiceWarning(activeVoice, message);
  };
  function intersects(start, length) {
    if (!activeLength || !length) return false;
    // The reader wraps $FFFF to $8000, not to zero.
    const end = activeStart + activeLength, overlaps = (low, high) => start < high && start + length > low;
    return overlaps(activeStart, Math.min(65536, end)) || end > 65536 && overlaps(0x8000, 0x8000 + end - 65536);
  }
  function changedRam(start, length) {
    if (enabled && (remaining > 0 || loop()) && intersects(start, length)) {
      note('DMC RAM changed during playback; this instrument keeps only the bytes captured at its trigger.');
    }
  }
  function begin() {
    activeVoice = null; activeLength = 0;
    if (streamActive) {
      onWarning('DMC triggers while an unsupported NES DAC stream is active are omitted.');
      timingKnown = false; remaining = Infinity; hasSample = true; return;
    }
    if (registers[0] === null || registers[2] === null || registers[3] === null) {
      onWarning('DMC triggers with unknown rate, sample address or length are omitted.');
      timingKnown = false; remaining = Infinity; hasSample = true; return;
    }
    const start = 0xc000 + registers[2] * 64, length = registers[3] * 16 + 1;
    const data = []; let address = start, complete = true;
    for (let index = 0; index < length; index++) {
      if (!known[address]) complete = false;
      data.push(memory[address]); address = address === 0xffff ? 0x8000 : address + 1;
    }
    const notes = ['Original DMC output-byte phase / DMA timing and later register changes are not reproduced for keyboard audition.'];
    if (registers[1] === null) notes.push('DMC initial DAC level was not recorded; imported playback starts at level 64.');
    else if (levelApproximate) notes.push('DMC initial level uses the last recorded direct DAC write; playback progress since that write is not reconstructed.');
    if (phaseApproximate || !timingKnown) notes.push('Earlier DMC output-byte progress was unknown; restart timing is approximated.');
    if (complete) {
      activeVoice = onVoice({data, rate:registers[0] & 15, loop:loop(), level:registers[1] === null ? 64 : registers[1] & 127}, notes);
      activeStart = start; activeLength = length;
    } else onWarning('DMC triggers whose sample RAM is incomplete or unrecorded are omitted; missing bytes are never filled with silence or a demo.');
    // A fresh output unit fetches its first byte immediately. A prior partial
    // byte survives off/on, so the new reader can wait for its boundary.
    remaining = length;
    if (!hasSample) {
      remaining--; hasSample = true; bitsLeft = 8; cyclesLeft = period();
    } else if (!timingKnown) {
      bitsLeft = 8; cyclesLeft = period(); phaseApproximate = true;
    }
    timingKnown = true;
  }
  return {
    write(register, value) {
      if (register >= 0x10 && register <= 0x13) {
        const previous = registers[register - 0x10];
        if (register === 0x11) {
          onWarning('Direct DAC writes supply DMC starting levels; timed direct-DAC PCM playback is not reconstructed.');
          if (playing()) note('Direct DAC writes after this DMC trigger are not replayed by the imported instrument.');
          registers[1] = value & 127; levelApproximate = false;
        } else {
          if (playing() && previous !== value) note(register === 0x10
            ? 'DMC rate / loop changes after the trigger are not replayed by the imported instrument.'
            : 'DMC address / length changes after the trigger, including later loop reloads, are not replayed.');
          registers[register - 0x10] = value;
        }
      } else if (register === 0x15) {
        enabled = Boolean(value & 16);
        if (!enabled) {remaining = 0; activeVoice = null; activeLength = 0;}
        else if (remaining === 0) begin();
      }
    },
    advance(samples) {
      if (!samples || !enabled || !timingKnown || period() === null || streamActive) return;
      const elapsed = samples * clock / 44100, currentPeriod = period();
      if (cyclesLeft > elapsed) {cyclesLeft -= elapsed; return;}
      const ticks = Math.floor((elapsed - cyclesLeft) / currentPeriod) + 1;
      cyclesLeft += ticks * currentPeriod - elapsed;
      if (playing()) levelApproximate = true;
      if (ticks < bitsLeft) {bitsLeft -= ticks; return;}
      const boundaries = 1 + Math.floor((ticks - bitsLeft) / 8);
      bitsLeft = 8 - ((ticks - bitsLeft) % 8);
      if (boundaries <= remaining) {remaining -= boundaries; hasSample = true;}
      else if (loop()) {
        const length = registers[3] * 16 + 1, after = boundaries - remaining;
        remaining = (length - after % length) % length; hasSample = true;
      } else {remaining = 0; hasSample = false;}
    },
    loadRam(address, bytes) {
      transferred += bytes.length;
      if (transferred > 128 * 1024 * 1024) throw new Error('VGM import exceeds 128 MiB of NES RAM transfers');
      let changed = false;
      for (let index = 0; index < bytes.length; index++) {
        if (!known[address + index] || memory[address + index] !== bytes[index]) {changed = true; break;}
      }
      if (changed) changedRam(address, bytes.length);
      memory.set(bytes, address); known.fill(1, address, address + bytes.length);
    },
    invalidateRam(address, length) {
      transferred += length;
      if (transferred > 128 * 1024 * 1024) throw new Error('VGM import exceeds 128 MiB of NES RAM transfers');
      changedRam(address, length); known.fill(0, address, address + length);
    },
    setStreamActive(value) {
      // Streams may write any selected NES register at times this static
      // scanner does not execute. Never reuse stale direct-write settings.
      streamActive = value; registers.fill(null); remaining = Infinity;
      hasSample = true; timingKnown = false; phaseApproximate = true; levelApproximate = true;
      activeVoice = null; activeLength = 0;
      onWarning('NES DAC streams are not reconstructed; DMC needs newly recorded settings and an explicit off / on trigger afterward.');
    },
  };
}
