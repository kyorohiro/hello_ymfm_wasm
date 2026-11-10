// Exact provenance and module identity only. No AudioContext/audio device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {restoreMixerCalibrationCompletionPresetImportRevision as restore,
  assertMixerCalibrationSourceFreshness as fresh} from './mixer_calibration_sources.mjs';
import {restoreMixerCalibrationRf5c164NoteRevision} from './mixer_calibration_rf5c164_note_revision.mjs';

const path='playground/playground_monaco_completion.js';
const read=name=>readFile(new URL('../'+name,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const beforeRecord={bytes:45040,sha256:'4af2caa8e4420caa111c3a22d73011875c213d4a7258ae7f0ae952abc556fa2d'};
const afterRecord={bytes:45033,sha256:'ca6c6bf3acb8d1a5fc4246fc0e598b5603d221610353f8c063e0ed43249f5f49'};

test('one exact data-only FM preset import reconstructs the existing RF receipt body and original measurements',async()=>{
  const current=await read('docs/'+path),rf=JSON.parse(await read('docs/issues/rf5c164_note_api_source_revision_01.json'));
  assert.equal(current.length,afterRecord.bytes);assert.equal(sha(current),afterRecord.sha256);
  const before=restore(path,current);assert.notEqual(before,current);
  assert.equal(before.length,beforeRecord.bytes);assert.equal(sha(before),beforeRecord.sha256);
  assert.deepEqual(rf.sources[path].after,beforeRecord,'the established RF receipt is retained verbatim');
  assert.equal(current.toString(),before.toString().replace(
    '} from "../js/megasynth.js?v=rf5c164-notes-1";',
    '} from "../js/megasynth-fm-presets.js";'));
  assert.equal(fresh({path,bytes:current,record:beforeRecord}),'ui-completion-preset-import');
  assert.equal(fresh({path,bytes:current,record:rf.sources[path].before}),'rf5c164-note-api');
  assert.equal(fresh({path,bytes:current,record:afterRecord}),'raw','a later exact measurement needs no exception');
  const earlier=restoreMixerCalibrationRf5c164NoteRevision(path,before);
  assert.equal(sha(earlier),rf.sources[path].before.sha256);
  for(const name of ['ps1','wonderswan','pokey','scsp']){
    const report=JSON.parse(await read(`docs/issues/${name}_state_restore_chip_levels_01.json`));
    assert.doesNotThrow(()=>fresh({path,bytes:current,record:report.sources[path],report}));
  }
});

test('next UI/code/cache/import edits, wrong paths and forged measurements remain stale',async()=>{
  const current=await read('docs/'+path),changedByte=Buffer.from(current);changedByte[Math.floor(changedByte.length/2)]^=1;
  for(const changed of [changedByte,Buffer.concat([current,Buffer.from('\n')]),
    Buffer.from(current.toString().replace('megasynth-fm-presets.js','another-fm-presets.js')),
    Buffer.from(current.toString().replace('megasynth-fm-presets.js','megasynth-fm-presets.js?v=2')),
    Buffer.from(current.toString().replace('const SCALE_NAMES','const OTHER_NAMES')),
    Buffer.from(current.toString().replace('FM_PRESETS,','OTHER_PRESETS,'))]){
    assert.equal(restore(path,changed),changed);
    assert.throws(()=>fresh({path,bytes:changed,record:beforeRecord}),/remeasure/);
  }
  for(const other of ['playground/other.js','js/playground_monaco_completion.js','docs/'+path,'js/megasynth-fm-presets.js']){
    assert.equal(restore(other,current),current);assert.throws(()=>fresh({path:other,bytes:current,record:beforeRecord}),/remeasure/);
  }
  assert.equal(restore('__proto__',current),current,'special object property names cannot select this one-path revision');
  assert.equal(restore(path,restore(path,current)).length,beforeRecord.bytes,'already restored bytes stay unchanged');
  assert.throws(()=>fresh({path,bytes:current,record:{...beforeRecord,sha256:'0'.repeat(64)}}),/remeasure/);
});

test('the direct completion data is the same FM_PRESETS object as the public MegaSynth export',async()=>{
  const {FM_PRESETS:direct}=await import('../docs/js/megasynth-fm-presets.js');
  const {FM_PRESETS:publicPresets}=await import('../docs/js/megasynth.js');
  assert.equal(direct,publicPresets,'the import removes an engine dependency without copying or changing its presets');
  assert(Object.keys(direct).length>10);assert(direct['two-op-bell']);
});
