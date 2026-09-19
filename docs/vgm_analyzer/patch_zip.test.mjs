import {exportSource} from './analyzer_core.js';
import {createStoredZipBytes} from './stored_zip.js';
import * as tfiExtract from './tfi_extract.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { Ym2612VGM } from '../js/ym2612vgm.js';
import { createTfiFromPreset, parseTfi } from '../js/tfi.js';
import { createVgiFromPreset, parseVgi } from '../js/vgi.js';
const source = readFileSync(new URL('./vgm_analyzer.js', import.meta.url), 'utf8');
function setup() {
  const context = vm.createContext({ ...tfiExtract, Ym2612VGM, createTfiFromPreset, createVgiFromPreset });
  for (const [start, end] of [
    ['function downloadAllTfiZip()', 'function buildSnapshotData('],
  ]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  return context;
}
for (const [chip, command, clockOffset, clock, ports] of [
  ['ym2610', 0x58, 0x4c, 8000000, 2],
  ['ym2610b', 0x58, 0x4c, 0x80000000 + 8000000, 2],
  ['ym2612', 0x52, 0x2c, 7670454, 2],
  ['ym2608', 0x56, 0x48, 8000000, 2],
  ['ym2203', 0x55, 0x44, 4000000, 1],
]) test(`${chip} keyed tones populate both ZIP exports`, () => {
  const commands = [];
  for (let port = 0; port < ports; port++) {
    const write = (reg, value) => commands.push(command + port, reg, value);
    write(0xb1, 0x1d);
    if (chip !== 'ym2203') write(0xb5, 0xd6);
    for (const slot of [0, 8, 4, 12]) {
      write(0x31 + slot, 0x23); write(0x41 + slot, 17 + port);
      write(0x51 + slot, 0x9f); write(0x61 + slot, 12);
      write(0x71 + slot, 7); write(0x81 + slot, 0x45);
    }
    // CH2 / CH5 exist on both variants. Repeated key-ons deduplicate.
    commands.push(command, 0x28, port ? 0xf5 : 0xf1, command, 0x28, port ? 0xf5 : 0xf1);
  }
  commands.push(0x66);
  const bytes = new Uint8Array(256 + commands.length);
  bytes.set([86, 103, 109, 32]); bytes.set(commands, 256);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 0x171, true); view.setUint32(0x34, 0xcc, true);
  view.setUint32(clockOffset, clock, true);
  const c = setup();
  const patches = c.extractTfiPatchesFromVgm(bytes);
  assert.deepEqual(Array.from(patches, p => p.channel), ports === 1 ? [1] : [1, 4]);
  const archives = [], downloads = [];
  Object.assign(c, {
    currentChipKind: chip === 'ym2610b' ? 'ym2610' : chip, extractedTfiPatches: patches,
    createStoredZip(files) { archives.push(files); return {}; },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { createElement: () => ({ click() { downloads.push(this.download); } }) },
    setStatus() {},
  });
  c.downloadAllTfiZip(); c.downloadAllVgiZip();
  assert.deepEqual(downloads, ['all_tfi_patches.zip', 'all_vgi_patches.zip']);
  // Compare the actual Browser download entries with the public Core archive,
  // including repeated key-ons, both ports and non-default pan/modulation.
  assert.deepEqual(exportSource(bytes,{format:'vgi-zip'}).bytes,createStoredZipBytes(archives[1]));
  for (const [i, parse] of [parseTfi, parseVgi].entries()) {
    assert.equal(archives[i].length, ports);
    for (const [port, file] of archives[i].entries()) {
      const preset = parse(file.data);
      assert.equal(preset.algorithm, 5); assert.equal(preset.feedback, 3);
      assert.equal(preset.operators[1].tl, 17 + port);
      assert.equal(preset.operators[1].multi, 3);
      if (i === 1) assert.equal(preset.b4, chip === 'ym2203' ? 0 : 0xd6);
    }
  }
});
