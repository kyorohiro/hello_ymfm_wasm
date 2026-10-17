import test from 'node:test';
import assert from 'node:assert/strict';
import {scanSpcBrrCandidates} from './spc_brr_candidates.js';

function fixture({aliases = false, end = true} = {}) {
  const ram = new Uint8Array(65536), dsp = new Uint8Array(128);
  const word = (address, value) => {ram[address] = value & 255; ram[address + 1] = value >> 8;};
  const entry = (sourceNumber, startAddress, loopAddress = startAddress) => {
    word(sourceNumber * 4, startAddress); word(sourceNumber * 4 + 2, loopAddress);
  };
  for (let sourceNumber = 0; sourceNumber < 256; sourceNumber++) {
    const address = 0x2000 + (aliases ? 0 : sourceNumber) * 9;
    entry(sourceNumber, address);
    ram[address] = end ? 3 : 0;
  }
  for (let voice = 0; voice < 8; voice++) dsp[voice * 16 + 4] = voice;
  return {ram, dsp, nativeFrames: 32000, entry};
}

test('all 256 SRCNs are directory candidates with per-entry origin metadata', async () => {
  const snapshot = fixture();
  const result = await scanSpcBrrCandidates(snapshot);
  assert.equal(result.samples.length, 256);
  assert.equal(result.summary.scannedSourceNumbers, 256);
  assert.equal(result.summary.uniqueMappings, 256);
  assert.equal(result.summary.blocksDecoded, 256);
  assert.equal(result.summary.decodedGroups, 256);
  assert.equal(result.summary.invalidEntries, 0);
  assert.equal(result.summary.budgetSkippedEntries, 0);
  assert.equal(result.nativeFrames, 32000);
  const last = result.samples.at(-1);
  assert.deepEqual(last.sourceNumbers, [255]);
  assert.deepEqual(last.sourceEntries, [{sourceNumber: 255, directory: 0,
    directoryEntryAddress: 1020, startAddress: 0x2000 + 255 * 9, loopAddress: 0x2000 + 255 * 9}]);
  assert.equal(last.pcm.length, 16);
});

test('exact directory aliases decode once and retain every source number and voice', async () => {
  const result = await scanSpcBrrCandidates(fixture({aliases: true}));
  assert.equal(result.samples.length, 1);
  assert.equal(result.summary.aliasEntries, 255);
  assert.equal(result.summary.blocksDecoded, 1);
  const sample = result.samples[0];
  assert.deepEqual(sample.sourceNumbers, Array.from({length: 256}, (_, i) => i));
  assert.equal(sample.sourceEntries.length, 256);
  assert.deepEqual(sample.voices.map(voice => voice.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(sample.voices.map(voice => voice.sourceNumber), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(sample.sourceNumber, 0, 'existing exports retain a representative SRCN');
});

test('the same BRR start with a different loop address remains a separate candidate', async () => {
  const snapshot = fixture({aliases: true});
  for (let sourceNumber = 128; sourceNumber < 256; sourceNumber++) snapshot.entry(sourceNumber, 0x2000, 0x2009);
  const result = await scanSpcBrrCandidates(snapshot);
  assert.equal(result.samples.length, 2);
  assert.equal(result.summary.blocksDecoded, 2);
  assert.equal(result.samples[0].sourceNumbers.length, 128);
  assert.equal(result.samples[1].sourceNumbers.length, 128);
  assert.equal(result.samples[0].loopResolved, true);
  assert.equal(result.samples[1].loopResolved, false);
  assert.equal(result.samples[1].sourceEntries[0].loopAddress, 0x2009);
});

test('voice-referenced mappings get the bounded decoding budget before unused entries', async () => {
  const snapshot = fixture();
  for (let voice = 0; voice < 8; voice++) snapshot.dsp[voice * 16 + 4] = voice % 2 ? 251 : 250;
  const result = await scanSpcBrrCandidates(snapshot, {maxBlocks: 1, maxTotalBlocks: 2});
  assert.deepEqual(result.samples.map(sample => sample.sourceNumber), [250, 251]);
  assert.equal(result.summary.blocksDecoded, 2);
  assert.equal(result.summary.budgetSkippedEntries, 254);
  assert.equal(result.summary.invalidEntries, 0);
  assert.equal(result.rejected.length, 254);
  assert.ok(result.rejected.every(entry => entry.kind === 'budget'));
  assert.match(result.warnings[0], /Incomplete scan/);
});

test('invalid mappings are distinguished from candidates skipped when the budget runs out', async () => {
  const snapshot = fixture({end: false});
  const result = await scanSpcBrrCandidates(snapshot, {maxBlocks: 1, maxTotalBlocks: 2});
  assert.equal(result.samples.length, 0);
  assert.equal(result.summary.blocksDecoded, 2);
  assert.equal(result.summary.invalidEntries, 2);
  assert.equal(result.summary.budgetSkippedEntries, 254);
  assert.equal(result.rejected.filter(entry => entry.kind === 'invalid').length, 2);
  assert.equal(result.rejected.filter(entry => entry.kind === 'budget').length, 254);
});

test('an incomplete candidate cannot decode beyond the remaining total block budget', async () => {
  const snapshot = fixture({aliases: true, end: false});
  snapshot.ram[0x2000 + 9] = 3;
  const result = await scanSpcBrrCandidates(snapshot, {maxBlocks: 2, maxTotalBlocks: 1});
  assert.equal(result.samples.length, 0);
  assert.equal(result.summary.blocksDecoded, 1);
  assert.equal(result.summary.invalidEntries, 0);
  assert.equal(result.summary.budgetSkippedEntries, 256);
});

test('scan yields before decoding and cancellation returns no partial result', async () => {
  const controller = new AbortController();
  let progressCalls = 0;
  const pending = scanSpcBrrCandidates(fixture(), {signal: controller.signal, onProgress() {progressCalls++;}});
  assert.equal(progressCalls, 0, 'the caller can paint Scanning before heavy work');
  controller.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(progressCalls, 0);
});

test('cancellation between candidate batches stops work at a deterministic bound', async () => {
  const controller = new AbortController();
  const progress = [];
  await assert.rejects(scanSpcBrrCandidates(fixture(), {
    signal: controller.signal,
    yieldEvery: 8,
    onProgress(update) {
      progress.push(update);
      if (update.processedMappings === 8) controller.abort();
    },
  }), {name: 'AbortError'});
  assert.equal(progress.length, 8);
  assert.equal(progress.at(-1).blocksDecoded, 8);
});

test('nonzero directory pages wrap directory entries at the SNES RAM boundary', async () => {
  const snapshot = fixture({aliases: true});
  snapshot.dsp[0x5d] = 255;
  for (let sourceNumber = 0; sourceNumber < 256; sourceNumber++) {
    const address = (0xff00 + sourceNumber * 4) & 65535;
    snapshot.ram[address] = 0; snapshot.ram[address + 1] = 0x20;
    snapshot.ram[address + 2] = 0; snapshot.ram[address + 3] = 0x20;
  }
  const result = await scanSpcBrrCandidates(snapshot);
  assert.equal(result.directory, 255);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].sourceEntries[64].directoryEntryAddress, 0);
});
