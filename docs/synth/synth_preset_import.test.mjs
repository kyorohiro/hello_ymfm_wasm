import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { readPresetFile } from './synth_preset_import.js';
import { createTfiFromPreset } from '../js/tfi.js';
import { createVgiFromPreset } from '../js/vgi.js';

const patch = { algorithm: 4, feedback: 2, operators: { 1: { ar: 23, tl: 12 } } };
test('TFI and VGI retain instrument parameters, including renamed files', async () => {
  for (const bytes of [createTfiFromPreset(patch), createVgiFromPreset(patch)]) {
    const [entry] = await readPresetFile(bytes, 'test.tfi');
    assert.equal(entry.preset.algorithm, 4);
    assert.equal(entry.preset.operators[1].ar, 23);
    assert.equal(entry.preset.operators[1].tl, 12);
  }
});

test('VGM key-on snapshots become named presets; malformed files reject', async () => {
  const data = new Uint8Array(0x100 + 10);
  data.set([0x56, 0x67, 0x6d, 0x20]);
  const view = new DataView(data.buffer);
  view.setUint32(4, data.length - 4, true);
  view.setUint32(8, 0x171, true);
  view.setUint32(0x34, 0xcc, true);
  data.set([0x52, 0xb0, 4, 0x52, 0x28, 0xf0, 0x52, 0x28, 0xf0, 0x66], 0x100);
  const entries = await readPresetFile(data, 'song.vgm');
  assert.deepEqual(await readPresetFile(gzipSync(data), 'song.vgz'), entries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'ym2612_ch1_001');
  assert.equal(entries[0].preset.algorithm, 4);
  await assert.rejects(() => readPresetFile(new Uint8Array(3), 'bad.vgm'));
  await assert.rejects(() => readPresetFile(new Uint8Array(3), 'bad.tfi'));
});

async function loader() {
  const source = await readFile(new URL('./synth.js', import.meta.url), 'utf8');
  let change;
  const input = { value: 'selected', disabled: false, blur() {}, addEventListener(_, fn) { change = fn; } };
  const defaultOption = { value: "default" };
  const groups = [defaultOption];
  const listeners = {};
  const importError = { hidden: true, textContent: "" };
  const applied = [];
  const statuses = [];
  const context = vm.createContext({
    Array, Uint8Array, readPresetFile,
    tfiFileInput: input,
    importedPresets: new Map(), importedPresetSerial: 0,
    presetSelect: { get firstChild() { return groups[0]; }, insertBefore(group, before) { groups.splice(groups.indexOf(before), 0, group); } },
    document: { getElementById() { return importError; }, addEventListener(type, fn) { listeners[type] = fn; }, createElement() { return { children: [], remove() { groups.splice(groups.indexOf(this), 1); }, appendChild(child) { this.children.push(child); } }; } },
    tfiSummary: {}, updateTfiSummary() {}, stopAllNotes() {},
    applyPresetState(id) { applied.push(id); }, setStatus(text) { statuses.push(text); },
  });
  vm.runInContext(source.slice(source.indexOf('function buildTfiLoader()'), source.indexOf('function buildTfiExporter()')), context);
  context.buildTfiLoader();
  return { context, input, groups, applied, statuses, change, listeners, defaultOption, importError };
}
const file = (name, bytes) => ({ name, async arrayBuffer() { return bytes.buffer; } });

test('new selection replaces imports, keeps defaults below them, and isolates failed files', async () => {
  const ui = await loader();
  const valid = file('tone.tfi', createTfiFromPreset(patch));
  await ui.change({ target: { files: [valid] } });
  await ui.change({ target: { files: [file('bad.tfi', new Uint8Array(2)), valid, valid] } });
  assert.equal(ui.context.importedPresets.size, 2);
  assert.equal(ui.context.importedPresets.has('imported-1'), false);
  assert.equal(ui.groups.length, 3);
  assert.equal(ui.groups.at(-1), ui.defaultOption);
  assert.deepEqual(ui.applied, ['imported-1', 'imported-2']);
  assert.match(ui.statuses.at(-1), /Failed: bad.tfi/);
  assert.equal(ui.input.value, '');
});

test('dropping files loads a replacement; invalid or empty selections preserve current presets', async () => {
  const ui = await loader();
  let prevented = false;
  await ui.listeners.drop({ preventDefault() { prevented = true; }, dataTransfer: {
    files: [file('drop.tfi', createTfiFromPreset(patch))],
  } });
  assert.equal(prevented, true);
  assert.equal(ui.groups[0].label, 'drop.tfi');
  assert.equal(ui.importError.hidden, true);
  await ui.change({ target: { files: [file('bad.tfi', new Uint8Array(2))] } });
  await ui.change({ target: { files: [] } });
  assert.equal(ui.context.importedPresets.size, 1);
  assert.equal(ui.importError.hidden, false);
  assert.match(ui.importError.textContent, /bad.tfi.*Invalid TFI/);
  assert.deepEqual(ui.applied, ['imported-1']);
});

test('a slow previous selection cannot overwrite the newest drop', async () => {
  const ui = await loader();
  let resolve;
  const slow = ui.change({ target: { files: [{ name: 'old.tfi', arrayBuffer: () => new Promise(r => { resolve = r; }) }] } });
  await ui.listeners.drop({ preventDefault() {}, dataTransfer: {
    files: [file('new.tfi', createTfiFromPreset(patch))],
  } });
  resolve(createTfiFromPreset(patch).buffer);
  await slow;
  assert.equal(ui.groups[0].label, 'new.tfi');
  assert.equal(ui.applied.length, 1);
});

test('file drags are accepted without intercepting text drags', async () => {
  const ui = await loader();
  let prevented = 0;
  const event = { preventDefault() { prevented++; }, dataTransfer: { types: ['Files'] } };
  ui.listeners.dragover(event);
  assert.equal(event.dataTransfer.dropEffect, 'copy');
  ui.listeners.dragover({ ...event, dataTransfer: { types: ['text/plain'] } });
  assert.equal(prevented, 1);
});

 test('unsupported formats and corrupt gzip have actionable errors', async () => {
  await assert.rejects(readPresetFile(new Uint8Array(42), 'image.png'), /Unsupported file format/);
  await assert.rejects(readPresetFile(new Uint8Array([0x1f, 0x8b, 0]), 'broken.vgz'), /Could not decompress VGZ/);
  await assert.rejects(readPresetFile(gzipSync(new Uint8Array(42)), 'not-vgm.vgz'), /VGM header not found/);
 });

test('imported file groups are sorted naturally by name above defaults', async () => {
  const ui = await loader();
  await ui.change({ target: { files: ['tone10.tfi', 'z.tfi', 'Tone2.tfi'].map(name => file(name, createTfiFromPreset(patch))) } });
  assert.deepEqual(ui.groups.slice(0, -1).map(group => group.label), ['Tone2.tfi', 'tone10.tfi', 'z.tfi']);
  assert.equal(ui.groups.at(-1), ui.defaultOption);
});
