// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Ym2612VGM} from '../js/ym2612vgm.js';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_SAMPLES = 44100 * 3600;
const task = () => new Promise(resolve => globalThis.setTimeout(resolve,0));
const check = signal => {if(signal?.aborted)throw new DOMException('OPN compatibility conversion cancelled','AbortError');};

/** VGM 1.70 extra tables end the ordinary chip-clock header. Offsets are
 * relative to their own fields. See the official VGMPlay vgmspec171.txt,
 * Extra Header, and libvgm's ParseHeader/ReadRelOfs implementation.
 * Only first-YM2203 FM/paired-SSG volume metadata is accepted here. */
export function readYm2203CompatibilityExtraHeader(bytes,header) {
  if (header.dataOffset < 0xc0 || bytes.length < 0xc0) return null;
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const relative = view.getUint32(0xbc,true);
  if (!relative) return null;
  if (header.version < 0x170) throw new Error('VGM extra headers require version 1.70 or newer');
  const offset = 0xbc + relative, end = Math.min(header.dataOffset,bytes.length);
  if (offset < 0xc0 || offset + 4 > end) throw new Error('Invalid VGM extra header offset');
  const size = view.getUint32(offset,true);
  if (size < 4 || size > end - offset) throw new Error('Invalid VGM extra header size');
  if (!header.ym2203Clock || header.ym2608Clock) throw new Error('OPNA reference playback does not support VGM extra clock/volume headers');
  const table = (field,stride,label) => {
    const relativeOffset = view.getUint32(field,true);
    if (!relativeOffset) return null;
    const position = field + relativeOffset;
    if (position < offset + size || position >= end) throw new Error(`Invalid VGM extra ${label} table offset`);
    const count = bytes[position];
    if (1 + count * stride > end - position) throw new Error(`Truncated VGM extra ${label} table`);
    return {position,count};
  };
  const clockTable = size >= 8 ? table(offset+4,5,'clock') : null;
  // These entries describe additional clocks for second chip instances.
  if (clockTable?.count) throw new Error('YM2203 compatibility playback does not support second-chip clocks in VGM extra headers');
  const volumeTable = size >= 12 ? table(offset+8,4,'volume') : null;
  const volumeEntries = [];
  for (let index=0; index<(volumeTable?.count ?? 0); index++) {
    const position = volumeTable.position + 1 + index*4;
    const chipId = bytes[position], flags = bytes[position+1], value = view.getUint16(position+2,true);
    if (flags & ~1) throw new Error('Unsupported reserved flags in VGM extra volume entry');
    if (flags & 1) throw new Error('YM2203 compatibility playback does not support second-chip volume entries');
    if (chipId !== 6 && chipId !== 0x86) throw new Error(`YM2203 compatibility playback does not support extra volume chip 0x${chipId.toString(16).padStart(2,'0')}`);
    const relativeVolume = Boolean(value & 0x8000);
    volumeEntries.push({chipId,chip:'ym2203',paired:Boolean(chipId & 0x80),section:chipId & 0x80 ? 'ssg' : 'fm',
      flags,chipIndex:0,value,relative:relativeVolume,multiplier:relativeVolume ? (value & 0x7fff)/256 : null,
      absolute:relativeVolume ? null : value,applied:false});
  }
  return {offset,size,mainHeaderEnd:offset,clockEntries:[],volumeEntries,volumeAdjustmentsApplied:false};
}

/** Match the fields consumed by opn_registers_base<false> in ymfm_opn.h/cpp.
 * YM2203 has three mono FM channels. Its writes to OPNA-only Rhythm, LFO,
 * stereo/AMS/PMS and IRQ-enable registers cannot become OPNA controls.
 * The target's mono-to-stereo pan is established once in the prologue. */
export function mapYm2203Register(register,value) {
  if (!Number.isInteger(register) || register<0 || register>255 || !Number.isInteger(value) || value<0 || value>255) throw new RangeError('YM2203 register and value must be bytes');
  if (register < 16 || register === 0x21 || [0x24,0x26,0x27,0x2d,0x2e,0x2f].includes(register)) return {register,value};
  if (register === 0x25) return {register,value:value & 3};
  if (register === 0x28) return (value & 3) === 3 ? null : {register,value:value & 0xf3};
  if (register >= 0x30 && register <= 0x9e && (register & 3) < 3) {
    const mask = {0x30:0x7f,0x40:0x7f,0x50:0xdf,0x60:0x1f,0x70:0x1f,0x80:0xff,0x90:0x0f}[register & 0xf0];
    return {register,value:value & mask};
  }
  if (register >= 0xa0 && register <= 0xae && (register & 3) < 3) return {register,value:register & 4 ? value & 0x3f : value};
  if (register >= 0xb0 && register <= 0xb2) return {register,value:value & 0x3f};
  return null;
}

/** Convert an already single-chip-validated YM2203 VGM into a private playback
 * buffer. Clock doubling preserves FM/SSG, prescaler and Timer periods. The
 * OPNA FM DAC and its FM/SSG output balance remain those of the target core.
 * Original wait bytes, GD3 payload and header fields are retained. Command
 * offsets are rebuilt so skipped writes cannot corrupt the loop or GD3. */
export async function convertYm2203VgmToYm2608(source,{signal,yieldTask=task} = {}) {
  check(signal);
  if (!(source instanceof Uint8Array) || source.length > MAX_BYTES) throw new RangeError('YM2203 compatibility source must be VGM bytes within 64 MiB');
  const parser = new Ym2612VGM(source,{logger:{warn:message=>{throw new Error(message);}}});
  const header = parser.header, sourceClock = header.ym2203Clock;
  if (!sourceClock || sourceClock & 0xc0000000 || header.ym2608Clock) throw new Error('Compatibility playback requires one YM2203 with no YM2608');
  const targetClock = sourceClock * 2;
  if (targetClock > 24000000) throw new RangeError('Doubled YM2203 clock exceeds the 24 MHz OPNA render budget');
  const dataOffset = Math.max(header.dataOffset,0x4c);
  const extraHeader = readYm2203CompatibilityExtraHeader(source,header);
  // Keep the native OPNA default IRQ mask and three-channel mode. YM2203's
  // upper Key On selector bit is discarded separately from the operator mask.
  const commands = [0x56,0x29,0x1f,0x56,0x22,0,0x56,0xb4,0xc0,0x56,0xb5,0xc0,0x56,0xb6,0xc0];
  let count=0, burst=0, totalSamples=0, ended=false, loopPosition=null, ignoredWrites=0, maskedWrites=0;
  while (parser.position < source.length && !parser.ended) {
    check(signal);
    const position = parser.position, command = source[position];
    if (position === header.loopOffset) loopPosition = dataOffset + commands.length;
    if (++count > 4000000) throw new RangeError('Song exceeds four million commands');
    if (++burst > 65536) throw new RangeError('Song exceeds 65536 commands without positive time progress');
    if (![0x55,0x61,0x62,0x63,0x66].includes(command) && !(command>=0x70 && command<=0x7f)) throw new Error(`YM2203 compatibility playback does not support VGM command 0x${command.toString(16).padStart(2,'0')}`);
    const event = parser.step();
    if (event.type === 'ym2203-write') {
      const mapped = mapYm2203Register(event.register,event.value);
      if (mapped) {commands.push(0x56,mapped.register,mapped.value);if(mapped.value!==event.value)maskedWrites++;}
      else ignoredWrites++;
    } else {
      for (let offset=position; offset<parser.position; offset++) commands.push(source[offset]);
      if (event.type === 'wait') {
        totalSamples += event.samples;
        if(event.samples>0)burst=0;
        if(totalSamples>MAX_SAMPLES)throw new RangeError('Reference song exceeds one hour');
      } else if (event.type === 'end') ended=true;
    }
    if (count % 4096 === 0) await yieldTask();
  }
  check(signal);
  if (!ended) throw new Error('Song command stream has no end command');
  if (header.loopOffset && loopPosition === null) throw new Error('YM2203 loop offset must point to a command boundary');
  const sourceEnd = parser.position, targetEnd = dataOffset + commands.length;
  const original = new DataView(source.buffer,source.byteOffset,source.byteLength);
  const gd3Relative = original.getUint32(0x14,true), gd3 = gd3Relative ? gd3Relative + 0x14 : 0;
  let movedTag = null;
  if (extraHeader && gd3 >= extraHeader.offset && gd3 < header.dataOffset) {
    if (gd3 + 12 > header.dataOffset || original.getUint32(gd3,true) !== 0x20336447) throw new Error('Invalid GD3 metadata inside the VGM extra-header region');
    const length = original.getUint32(gd3+8,true);
    if (length > header.dataOffset-gd3-12) throw new Error('Truncated GD3 metadata inside the VGM extra-header region');
    movedTag = source.slice(gd3,gd3+12+length);
  }
  const copiedEnd = targetEnd + source.length - sourceEnd;
  const length = copiedEnd + (movedTag?.length ?? 0);
  if (length > MAX_BYTES) throw new RangeError('Converted OPNA playback buffer exceeds 64 MiB');
  const bytes = new Uint8Array(length);
  bytes.set(source.subarray(0,extraHeader?.offset ?? header.dataOffset)); bytes.set(commands,dataOffset); bytes.set(source.subarray(sourceEnd),targetEnd);
  if (movedTag) bytes.set(movedTag,copiedEnd);
  const view = new DataView(bytes.buffer);
  view.setUint32(4,length-4,true);view.setUint32(0x34,dataOffset-0x34,true);
  view.setUint32(0x44,0,true);view.setUint32(0x48,targetClock,true);
  // The Synth Mixer consumes volume metadata outside the chip timeline.
  // Zero padding in the private playback header keeps
  // all original command offsets relative to the same data start and stops
  // the shared parser from interpreting extra-table payload as chip clocks.
  if (extraHeader) view.setUint32(0xbc,0,true);
  view.setUint32(0x1c,loopPosition === null ? 0 : loopPosition-0x1c,true);
  if (gd3Relative) {
    if (gd3 >= source.length || gd3 >= header.dataOffset && gd3 < sourceEnd) throw new Error('YM2203 GD3 metadata offset must lie outside the command stream');
    const mapped = movedTag ? copiedEnd : gd3 < header.dataOffset ? gd3 : targetEnd + gd3 - sourceEnd;
    view.setUint32(0x14,mapped-0x14,true);
  }
  return {bytes,extraHeader,compatibility:{kind:'ym2203-to-ym2608',label:'YM2203 → YM2608',sourceChip:'ym2203',targetChip:'ym2608',
    sourceClock,targetClock,fmChannels:3,ssgChannels:3,ignoredWrites,maskedWrites,
    extraVolumeEntries:extraHeader?.volumeEntries ?? [],volumeAdjustmentsApplied:false,
    extraVolumeWarning:extraHeader?.volumeEntries.length ? 'VGM extra-header FM/SSG volume adjustments are applied with Mixer YM2203 mode.' : '',
    warning:'YM2203 → YM2608 compatible playback. FM DAC character can differ from the original YM2203. Mixer YM2203 mode adjusts the FM/SSG balance.'}};
}
