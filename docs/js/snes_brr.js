/** Browser / Worker / Node: bounded SNES BRR extraction and raw sample decoding.
 * This is sample data, not an instrument preset: DSP envelopes, Gaussian
 * interpolation, pitch modulation, noise and echo are not applied to raw PCM.
 * Arithmetic follows the S-DSP's signed shifts, clamp and 15-bit wrap, checked
 * against the accurate snes_spc SPC_DSP decoder (third_party/snes-spc).
 */
import { encodeWav } from './wav.js';
import { SPC_SAMPLE_RATE } from './spc_file.js?v=chip-tabs-2';
export const BRR_BLOCK_BYTES = 9;
export const BRR_BLOCK_SAMPLES = 16;
const RAM_SIZE = 65536, MAX_BLOCKS = Math.floor(RAM_SIZE / BRR_BLOCK_BYTES);
function bytes(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('BRR data must be an ArrayBuffer or typed array');
}
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
/** Decode complete 9-byte blocks until the first END, with zero initial BRR
 * history unless supplied as [most recent, previous] signed16 samples.
 * PCM is before DSP interpolation/envelopes and uses a nominal 32,000-Hz
 * sample rate (PITCH=0x1000). A sample's musical root note is not in BRR.
 * Missing END is reported; extraction rejects such candidates by default.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {{history?:number[],maxBlocks?:number}} [options]
 */
export function decodeBrr(input, {history = [0, 0], maxBlocks = MAX_BLOCKS} = {}) {
  const data = bytes(input);
  integer(maxBlocks, 1, MAX_BLOCKS, 'maxBlocks');
  if (!data.length || data.length % BRR_BLOCK_BYTES) throw new RangeError('BRR requires nonempty complete 9-byte blocks');
  if (data.length / BRR_BLOCK_BYTES > maxBlocks) throw new RangeError('BRR exceeds the block limit');
  if (!Array.isArray(history) || history.length !== 2) throw new TypeError('BRR history must contain two signed16 samples');
  let p1 = integer(history[0], -32768, 32767, 'history[0]'), p2 = integer(history[1], -32768, 32767, 'history[1]');
  const output = new Int16Array(data.length / 9 * 16);
  let count = 0, blockCount = 0, endReached = false, loop = false;
  for (let block = 0; block < data.length; block += 9) {
    const header = data[block], shift = header >> 4, filter = (header >> 2) & 3;
    for (let n = 0; n < 16; n++) {
      const byte = data[block + 1 + (n >> 1)];
      let value = n & 1 ? byte & 15 : byte >> 4;
      if (value >= 8) value -= 16;
      value = shift <= 12 ? (value << shift) >> 1 : value < 0 ? -2048 : 0;
      const halfP2 = p2 >> 1;
      if (filter >= 2) {
        value += p1 - halfP2;
        if (filter === 2) value += (halfP2 >> 4) + ((p1 * -3) >> 6);
        else value += ((p1 * -13) >> 7) + ((halfP2 * 3) >> 4);
      } else if (filter === 1) value += (p1 >> 1) + ((-p1) >> 5);
      value = Math.max(-32768, Math.min(32767, value));
      value = (value * 2 << 16) >> 16;
      output[count++] = value;
      p2 = p1; p1 = value;
    }
    blockCount++;
    if (header & 1) {endReached = true; loop = !!(header & 2); break;}
  }
  const pcm16 = output.slice(0, count), pcm = Float32Array.from(pcm16, value => value / 32768);
  return {pcm, pcm16, sampleRate:SPC_SAMPLE_RATE, blockCount, endReached, loop, finalHistory:[p1,p2]};
}
function hashBytes(data) {
  // FNV-1a 64: a content/version identifier, not an authentication hash.
  let value = 0xcbf29ce484222325n;
  for (const byte of data) value = BigInt.asUintN(64, (value ^ BigInt(byte)) * 0x100000001b3n);
  return 'fnv1a64:' + value.toString(16).padStart(16, '0');
}
function snapshotData(snapshot) {
  const ram = bytes(snapshot?.ram), dsp = bytes(snapshot?.dsp);
  if (ram.length !== RAM_SIZE || dsp.length !== 128) throw new RangeError('SNES snapshot requires 65,536 RAM and 128 DSP bytes');
  return {ram,dsp};
}
/** Snapshot-only voice parameters. active is a display heuristic from ENVX or
 * OUTX, not a reconstruction of key-on history or internal envelope state.
 */
export function readSnesVoices(snapshot) {
  const {dsp} = snapshotData(snapshot);
  return Array.from({length:8}, (_, index) => {
    const base = index << 4, adsr1 = dsp[base + 5], adsr2 = dsp[base + 6], gain = dsp[base + 7];
    const bit = 1 << index;
    return {
      index, sourceNumber:dsp[base + 4], active:!!(dsp[base + 8] || dsp[base + 9]),
      pitch:dsp[base + 2] | (dsp[base + 3] & 0x3f) << 8,
      volumeLeft:dsp[base] << 24 >> 24, volumeRight:dsp[base + 1] << 24 >> 24,
      adsr1, adsr2, gain, envelopeMode:adsr1 & 0x80 ? 'adsr' : 'gain',
      attack:adsr1 & 15, decay:(adsr1 >> 4) & 7, sustainLevel:adsr2 >> 5, sustainRate:adsr2 & 31,
      gainMode:gain & 0x80 ? ['linear-decrease','exponential-decrease','linear-increase','bent-increase'][(gain >> 5) & 3] : 'direct',
      gainValue:gain & (gain & 0x80 ? 31 : 127), envx:dsp[base + 8], outx:dsp[base + 9] << 24 >> 24,
      noise:!!(dsp[0x3d] & bit), pitchModulation:!!(index && dsp[0x2d] & bit), echo:!!(dsp[0x4d] & bit),
      keyOnRegister:!!(dsp[0x4c] & bit), keyOffRegister:!!(dsp[0x5c] & bit), endx:!!(dsp[0x7c] & bit),
    };
  });
}
/** Extract only selected SRCNs, or currently audible voice SRCNs by default.
 * Directory is a DSP DIR byte (0..255), not a byte address. Reads wrap at the
 * hardware 16-bit RAM boundary, but each candidate is bounded to one RAM's
 * worth of complete blocks and must reach END. Invalid candidates are
 * reported in rejected; unused directory slots are never scanned implicitly.
 * Loops outside/aligned differently from the extracted segment retain their
 * raw addresses but have no invented PCM loop marker.
 * @param {{ram:Uint8Array,dsp:Uint8Array,nativeFrames?:number}} snapshot
 * Total decoding defaults to at most eight RAM images, even when callers
 * explicitly request all SRCNs. Increase maxTotalBlocks explicitly if needed.
 * @param {{directory?:number,sourceNumbers?:number[],maxBlocks?:number,maxTotalBlocks?:number}} [options]
 */
export function extractBrrSamples(snapshot, {directory, sourceNumbers, maxBlocks = MAX_BLOCKS, maxTotalBlocks = MAX_BLOCKS * 8} = {}) {
  const {ram,dsp} = snapshotData(snapshot), voices = readSnesVoices(snapshot);
  const dir = integer(directory ?? dsp[0x5d], 0, 255, 'directory');
  integer(maxBlocks, 1, MAX_BLOCKS, 'maxBlocks');
  integer(maxTotalBlocks, 1, MAX_BLOCKS * 256, 'maxTotalBlocks');
  if (sourceNumbers !== undefined && (!Array.isArray(sourceNumbers) || sourceNumbers.length > 256)) throw new TypeError('sourceNumbers must be an array with at most 256 SRCNs');
  const selected = [...new Set(sourceNumbers === undefined ? voices.filter(voice => voice.active).map(voice => voice.sourceNumber) : Array.from(sourceNumbers, srcn => integer(srcn,0,255,'sourceNumber')))];
  const samples = [], rejected = [], warnings = [];
  let totalBlocks = 0;
  const word = offset => ram[offset & 65535] | ram[(offset + 1) & 65535] << 8;
  for (const sourceNumber of selected) {
    const address = ((dir << 8) + sourceNumber * 4) & 65535;
    const startAddress = word(address), loopAddress = word(address + 2);
    const data = [], sampleWarnings = [];
    let terminated = false, wrapped = false;
    for (let block = 0; block < maxBlocks && totalBlocks < maxTotalBlocks; block++, totalBlocks++) {
      const blockAddress = startAddress + block * 9;
      for (let i = 0; i < 9; i++) data.push(ram[(blockAddress + i) & 65535]);
      if (blockAddress + 8 > 65535) wrapped = true;
      if (ram[blockAddress & 65535] & 1) {terminated = true; totalBlocks++; break;}
    }
    if (!terminated) {rejected.push({sourceNumber,startAddress,loopAddress,reason:totalBlocks >= maxTotalBlocks ? 'BRR extraction block budget exhausted' : 'No BRR END flag within the bounded sample region'}); continue;}
    const brr = new Uint8Array(data), decoded = decodeBrr(brr, {maxBlocks});
    const loopOffset = (loopAddress - startAddress + RAM_SIZE) & 65535;
    const loopResolved = decoded.loop && loopOffset < brr.length && loopOffset % 9 === 0;
    if (decoded.loop && !loopResolved) sampleWarnings.push('Loop target is outside or unaligned to the extracted segment; raw address preserved.');
    if (wrapped) sampleWarnings.push('BRR data wraps at the 16-bit RAM boundary.');
    if (brr.some((value,index) => index % 9 === 0 && value >> 4 > 12)) sampleWarnings.push('BRR shift 13..15 uses the hardware special case.');
    const hash = hashBytes(brr), loopStartSamples = loopResolved ? loopOffset / 9 * 16 : null;
    samples.push({sourceNumber,directory:dir,directoryEntryAddress:address,startAddress,loopAddress,
      brr,...decoded,loopResolved,loopStartSamples,loopEndSamples:loopResolved ? decoded.pcm.length : null,
      hash,hashAlgorithm:'fnv1a64',version:`1:${dir}:${sourceNumber}:${startAddress}:${loopAddress}:${hash}`,
      nativeFrames:snapshot.nativeFrames ?? null,voices:voices.filter(voice => voice.sourceNumber === sourceNumber),warnings:sampleWarnings});
  }
  if (!selected.length) warnings.push('No voice has nonzero ENVX/OUTX. Select a SRCN explicitly to inspect silent samples.');
  if (rejected.some(entry => entry.reason.includes('budget'))) warnings.push('Extraction stopped at maxTotalBlocks; select fewer SRCNs or increase the explicit budget.');
  return {directory:dir,directoryAddress:dir << 8,nativeFrames:snapshot.nativeFrames ?? null,samples,rejected,warnings};
}
/** WAV has raw mono sample PCM only. The JSON-compatible sidecar retains DSP
 * parameters and loop markers; it deliberately does not claim to be a full
 * instrument preset. rootNote is optional MIDI 0..127 supplied by the caller.
 * Exported loops describe source samples, not a reconstructed DSP voice.
 * @param {ReturnType<typeof extractBrrSamples>['samples'][number]} sample
 * @param {{rootNote?:number}} [options]
 */
export function exportBrrSample(sample, {rootNote} = {}) {
  if (rootNote !== undefined) integer(rootNote,0,127,'rootNote');
  if (!(sample?.pcm instanceof Float32Array) || sample.sampleRate !== SPC_SAMPLE_RATE || !(sample.brr instanceof Uint8Array)) throw new TypeError('Expected an extracted BRR sample');
  const wav = encodeWav({sampleRate:sample.sampleRate,channels:[sample.pcm]});
  const metadata = {
    format:'tetorica-snes-brr',schemaVersion:1,sampleRate:sample.sampleRate,channels:1,
    pcmFrames:sample.pcm.length,rootNote:rootNote ?? null,
    sourceNumber:sample.sourceNumber,directory:sample.directory,startAddress:sample.startAddress,loopAddress:sample.loopAddress,
    loop:sample.loop,loopResolved:sample.loopResolved,loopStartSamples:sample.loopStartSamples,loopEndSamples:sample.loopEndSamples,
    hash:sample.hash,hashAlgorithm:sample.hashAlgorithm,version:sample.version,nativeFrames:sample.nativeFrames,
    voices:sample.voices.map(voice => ({...voice})),warnings:[...sample.warnings],
    rendering:'Raw BRR PCM before S-DSP Gaussian interpolation, pitch, envelopes, noise, echo and mixing. A root note cannot be inferred from BRR.',
  };
  return {wav,metadata};
}
