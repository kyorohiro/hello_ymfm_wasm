import {extractBrrSamples, readSnesVoices} from '../js/snes_brr.js';

const RAM_SIZE = 65536;
const MAX_BLOCKS = Math.floor(RAM_SIZE / 9);
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('BRR scan cancelled', 'AbortError');
}

/** Inspect one captured RAM/DSP snapshot, not the whole song's sample history.
 * Identical directory start/loop mappings are decoded once and retain every
 * SRCN alias. Voice-referenced mappings are processed first; unused directory
 * slots can contain arbitrary data, so even a successfully decoded candidate
 * is not proof that the game uses it as an instrument.
 */
export async function scanSpcBrrCandidates(snapshot, {
  signal,
  maxBlocks = MAX_BLOCKS,
  maxTotalBlocks = MAX_BLOCKS * 8,
  yieldEvery = 8,
  onProgress,
} = {}) {
  checkAbort(signal);
  integer(maxBlocks, 1, MAX_BLOCKS, 'maxBlocks');
  integer(maxTotalBlocks, 1, MAX_BLOCKS * 256, 'maxTotalBlocks');
  integer(yieldEvery, 1, 256, 'yieldEvery');
  if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');
  const voices = readSnesVoices(snapshot); // Also validate RAM/DSP dimensions.
  const ramValue = snapshot.ram;
  const ram = ramValue instanceof ArrayBuffer ? new Uint8Array(ramValue)
    : new Uint8Array(ramValue.buffer, ramValue.byteOffset, ramValue.byteLength);
  const dspValue = snapshot.dsp;
  const dsp = dspValue instanceof ArrayBuffer ? new Uint8Array(dspValue)
    : new Uint8Array(dspValue.buffer, dspValue.byteOffset, dspValue.byteLength);
  const directory = dsp[0x5d], directoryAddress = directory << 8;
  const referenced = new Set(voices.map(voice => voice.sourceNumber));

  // Let the UI paint its scanning status before any sample decoding starts.
  await yieldToBrowser();
  checkAbort(signal);
  const word = address => ram[address & 65535] | ram[(address + 1) & 65535] << 8;
  const mappings = new Map();
  for (let sourceNumber = 0; sourceNumber < 256; sourceNumber++) {
    const directoryEntryAddress = (directoryAddress + sourceNumber * 4) & 65535;
    const startAddress = word(directoryEntryAddress), loopAddress = word(directoryEntryAddress + 2);
    const key = `${startAddress}:${loopAddress}`;
    if (!mappings.has(key)) mappings.set(key, {entries: [], referenced: false});
    const group = mappings.get(key);
    group.entries.push({sourceNumber, directory, directoryEntryAddress, startAddress, loopAddress});
    group.referenced ||= referenced.has(sourceNumber);
  }
  const groups = [...mappings.values()].sort((a, b) => Number(b.referenced) - Number(a.referenced)
    || a.entries[0].sourceNumber - b.entries[0].sourceNumber);
  const samples = [], rejected = [], warnings = [];
  const summary = {
    scannedSourceNumbers: 256,
    uniqueMappings: groups.length,
    decodedGroups: 0,
    aliasEntries: 256 - groups.length,
    invalidEntries: 0,
    budgetSkippedEntries: 0,
    blocksDecoded: 0,
  };
  for (let index = 0; index < groups.length; index++) {
    checkAbort(signal);
    const group = groups[index], representative = group.entries[0];
    const remaining = maxTotalBlocks - summary.blocksDecoded;
    let failure;
    if (remaining <= 0) {
      failure = {kind: 'budget', reason: 'BRR extraction block budget exhausted'};
    } else {
      const result = extractBrrSamples(snapshot, {
        directory,
        sourceNumbers: [representative.sourceNumber],
        maxBlocks,
        maxTotalBlocks: remaining,
      });
      const sample = result.samples[0];
      if (sample) {
        summary.blocksDecoded += sample.blockCount;
        const sourceNumbers = group.entries.map(entry => entry.sourceNumber);
        const aliases = new Set(sourceNumbers);
        samples.push({...sample, sourceNumbers, sourceEntries: group.entries,
          voices: voices.filter(voice => aliases.has(voice.sourceNumber))});
        summary.decodedGroups++;
      } else {
        summary.blocksDecoded += Math.min(maxBlocks, remaining);
        failure = remaining < maxBlocks
          ? {kind: 'budget', reason: 'BRR extraction block budget exhausted before END'}
          : {kind: 'invalid', reason: 'No BRR END flag within the bounded sample region'};
      }
    }
    if (failure) {
      rejected.push(...group.entries.map(entry => ({...entry, ...failure})));
      if (failure.kind === 'budget') summary.budgetSkippedEntries += group.entries.length;
      else summary.invalidEntries += group.entries.length;
    }
    onProgress?.({...summary, processedMappings: index + 1});
    checkAbort(signal);
    if ((index + 1) % yieldEvery === 0 && index + 1 < groups.length) {
      await yieldToBrowser();
      checkAbort(signal);
    }
  }
  if (summary.budgetSkippedEntries) {
    warnings.push(`Incomplete scan: ${summary.budgetSkippedEntries} SRCN entries were not decoded within the block budget.`);
  }
  return {directory, directoryAddress, nativeFrames: snapshot.nativeFrames ?? null,
    samples, rejected, warnings, summary};
}
