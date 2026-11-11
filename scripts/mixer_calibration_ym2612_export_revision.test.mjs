import {restoreMixerCalibrationPs1ImportRevision} from './mixer_calibration_ps1_import_revision.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {assertMixerCalibrationSourceFreshness,restoreMixerCalibrationYm2612ExportRevision,restoreMixerCalibrationSynthDefinitionViewerRevision,restoreMixerCalibrationSynthCodeUiRevision} from './mixer_calibration_sources.mjs';
import {restoreMixerCalibrationSidRevision} from './mixer_calibration_sid_revision.mjs';
import {restoreMixerCalibrationRf5c164NoteRevision} from './mixer_calibration_rf5c164_note_revision.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const records={
  'js/ym2612-worklet.js':{bytes:25394,sha256:'697fc19d6885b746cbfc122a60d841befc8999bfaf10b858c724355a8617126c'},
  'js/ym2612-worklet-nuked.js':{bytes:24595,sha256:'7b9a91544c84fea385f9830371f7d49541be9e70649b656932ad99258e8793c7'},
};
async function exportRevisionFixture(path) {
  const current=await readFile(new URL('../docs/'+path,import.meta.url));
  const bytes=restoreMixerCalibrationRf5c164NoteRevision(path,current);
  if(path!=='js/ym2612-worklet-nuked.js'||sha(bytes)==='5ebfd1097447fcf69e182aa06f95e6f98cc742b7c4bc7c8778c6dfdc238b9c8a')return bytes;
  // Nuked is outside the four active source inventories. Keep this older
  // export-only unit fixture independent of its later cache-token rollout;
  // production freshness must continue rejecting that unlisted revision.
  assert.equal(sha(current),'1866417d09e95101207671b4ef00c8fd130d60e5e46ef2ca2a12ee976ea86983');
  assert.equal(restoreMixerCalibrationYm2612ExportRevision(path,current),current);
  const previous=Buffer.from(current.toString().replace("playground_chip_inspector_state.js?v=rf5c164-notes-1","playground_chip_inspector_state.js?v=pokey-prepare-1"));
  assert.equal(sha(previous),'5ebfd1097447fcf69e182aa06f95e6f98cc742b7c4bc7c8778c6dfdc238b9c8a');return previous;
}

test('only the named class export reconstructs both complete original measured worklet digests',async()=>{
  for(const [path,record]of Object.entries(records)) {
    const bytes=await exportRevisionFixture(path);
    const original=restoreMixerCalibrationYm2612ExportRevision(path,bytes);
    assert.notEqual(original,bytes);assert.equal(original.length,record.bytes);assert.equal(sha(original),record.sha256);
    assert.equal(bytes.toString(),original.toString().replace(/^class YM2612Processor extends AudioWorkletProcessor \{$/m,'export class YM2612Processor extends AudioWorkletProcessor {'));
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record}),'ym2612-class-export');
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:original,record}),'raw');
  }
});

test('changed DSP, imports, extra bytes, other class exports, records or paths still require remeasurement',async()=>{
  for(const [path,record]of Object.entries(records)) {
    const bytes=await exportRevisionFixture(path),source=bytes.toString();
    for(const changed of [
      Buffer.from(source.replace('const YM_GAIN = 0.9;','const YM_GAIN = 0.8;')),
      Buffer.from(source.replace('export class YM2612Processor','export class AnotherProcessor')),
      Buffer.from(source.replace('export class YM2612Processor','class YM2612Processor').replace('function clampSample','export function clampSample')),
      Buffer.from(source.replace('./ym2612_dac.js','./another_dac.js')),
      Buffer.concat([bytes,Buffer.from('\n')]),
    ]) {
      if(changed.equals(bytes))continue;
      assert.equal(restoreMixerCalibrationYm2612ExportRevision(path,changed),changed);
      assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record}),/remeasure/);
    }
    for(const other of ['js/another-worklet.js','synth/ym2612-worklet.js','docs/'+path]) {
      assert.equal(restoreMixerCalibrationYm2612ExportRevision(other,bytes),bytes);
      assert.throws(()=>assertMixerCalibrationSourceFreshness({path:other,bytes,record}),/remeasure/);
    }
    assert.equal(restoreMixerCalibrationYm2612ExportRevision('__proto__',bytes),bytes);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record:{...record,sha256:'0'.repeat(64)}}),/remeasure/);
  }
});

test('the exact read-only Synth viewer revision chains to pinned SID bytes and the original measured digest',async()=>{
  const path='playground/playground_monaco_definitions.js',bytes=await readFile(new URL('../docs/'+path,import.meta.url));
  const report=JSON.parse(await readFile(new URL('../docs/issues/ps1_state_restore_chip_levels_01.json',import.meta.url)));
  const receipt=JSON.parse(await readFile(new URL('../docs/issues/sid_playground_source_revision_02.json',import.meta.url)));
  const original=restoreMixerCalibrationSynthDefinitionViewerRevision(path,restoreMixerCalibrationPs1ImportRevision(path,bytes)),sid=receipt.sources[path];
  assert.notEqual(original,bytes);assert.equal(original.length,sid.after.bytes);assert.equal(sha(original),sid.after.sha256);
  const measured=restoreMixerCalibrationSidRevision(path,original);
  assert.equal(measured.length,report.sources[path].bytes);assert.equal(sha(measured),report.sources[path].sha256);
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record:report.sources[path]}),'ui-synth-definition-viewer');
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record:sid.after}),'ui-synth-definition-viewer');
  assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:original,record:report.sources[path]}),'sid-playground-routing');
  for(const changed of [Buffer.concat([bytes,Buffer.from('\n')]),
    Buffer.from(bytes.toString().replace("occurrencesHighlight:'off'","occurrencesHighlight:'all'")),
    Buffer.from(bytes.toString().replace('playground_music.js','another_runtime.js')),
    Buffer.from(bytes.toString().replace('options.runtimeFile','options.anotherFile'))]) {
    assert.equal(restoreMixerCalibrationSynthDefinitionViewerRevision(path,changed),changed);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record:report.sources[path]}),/remeasure/);
  }
  for(const other of ['playground/other.js','js/ym2612-worklet.js']) {
    assert.equal(restoreMixerCalibrationSynthDefinitionViewerRevision(other,bytes),bytes);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path:other,bytes,record:report.sources[path]}),/remeasure/);
  }
  assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record:{...report.sources[path],sha256:'0'.repeat(64)}}),/remeasure/);
});

test('exact Monaco host and virtual-files import revisions reconstruct measured bytes, while every next edit is stale',async()=>{
  const report=JSON.parse(await readFile(new URL('../docs/issues/ps1_state_restore_chip_levels_01.json',import.meta.url)));
  for(const path of ['playground/playground_monaco.js','playground/playground_virtual_files.js']) {
    const bytes=await readFile(new URL('../docs/'+path,import.meta.url)),original=restoreMixerCalibrationSynthCodeUiRevision(path,restoreMixerCalibrationPs1ImportRevision(path,bytes)),record=report.sources[path];
    assert.notEqual(original,bytes);assert.equal(original.length,record.bytes);assert.equal(sha(original),record.sha256);
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes,record}),'ui-synth-code');
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:original,record}),'raw');
    const changedByte=Buffer.from(bytes);changedByte[Math.floor(changedByte.length/2)]^=1;
    for(const changed of [changedByte,Buffer.concat([bytes,Buffer.from('\n')]),Buffer.from(bytes.toString().replace('import {','import  {'))]) {
      assert.equal(restoreMixerCalibrationSynthCodeUiRevision(path,changed),changed);
      assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:changed,record}),/remeasure/);
    }
    assert.equal(restoreMixerCalibrationSynthCodeUiRevision('playground/other.js',bytes),bytes);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record:{...record,sha256:'0'.repeat(64)}}),/remeasure/);
  }
});
