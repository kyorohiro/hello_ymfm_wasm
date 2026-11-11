// SPDX-License-Identifier: BSD-3-Clause
// Exact review fingerprints and offline PCM only; no AudioContext or output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {restoreMixerCalibrationPs1ImportRevision as restore,PS1_IMPORT_REVISION_BASE_COMMIT as commit,
  PS1_IMPORT_REVISION_RECEIPT_PATH as receiptPath,PS1_IMPORT_REVISION_RECEIPT_OBJECT_SHA256 as pin,
  PS1_IMPORT_REVISION_SOURCE_PATHS as paths,PS1_IMPORT_REVISION_REPORT_PATHS as reports} from './mixer_calibration_ps1_import_revision.mjs';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
import {measurePs1ImportRevisionPcm} from './check_ps1_import_revision_pcm.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=JSON.parse(await read(receiptPath));
const prior=path=>receipt.priorPassiveRevisions.psfStartupMetadata.sources[path]??receipt.priorPassiveRevisions.spuCodeDefinitionViewer.sources[path];
const finalBefore=path=>(prior(path)??receipt.sources[path]).before;

test('exact current import sources and separately named prior passive sources reconstruct complete predecessors',async()=>{
  assert.equal(sha(JSON.stringify(receipt)),pin);assert.equal(receipt.baseCommit,commit);assert.equal(paths.length,9);
  assert.deepEqual(Object.keys(receipt.priorPassiveRevisions).sort(),['psfStartupMetadata','spuCodeDefinitionViewer']);
  for(const path of paths) {
    const current=await read('docs/'+path),entry=receipt.sources[path]??prior(path),before=restore(path,current);
    assert.equal(current.length,entry.after.bytes,path);assert.equal(sha(current),entry.after.sha256,path);
    assert.notEqual(before,current,path);assert.equal(before.length,finalBefore(path).bytes,path);assert.equal(sha(before),finalBefore(path).sha256,path);
    assert.equal(restore(path,before),before,'already restored bytes remain unchanged');
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:current,record:finalBefore(path)}),'ps1-import-compatibility',path);
    assert.equal(assertMixerCalibrationSourceFreshness({path,bytes:current,record:entry.after}),'raw','a later exact measurement needs no historical exception');
  }
  for(const path of reports) {
    const bytes=await read(path),report=JSON.parse(bytes);assert.equal(bytes.length,receipt.reports[path].bytes,path);assert.equal(sha(bytes),receipt.reports[path].sha256,path);
    for(const [source,record]of Object.entries(report.sources)) {
      const current=await read('docs/'+source);assert.doesNotThrow(()=>assertMixerCalibrationSourceFreshness({path:source,bytes:current,record,report}),source);
    }
    assert.deepEqual(await read(path),bytes,'the raw original measurements are never rewritten');
  }
});

test('future body/cache/DSP changes and another path or measurement cannot borrow the exact review',async()=>{
  for(const path of paths) {
    const current=await read('docs/'+path),byteEdit=Buffer.from(current);byteEdit[Math.floor(byteEdit.length/2)]^=1;
    const changes=[byteEdit,Buffer.concat([current,Buffer.from('\n')]),Buffer.from("import './different-dsp.js';\n"+current)];
    const cache=Buffer.from(current.toString().replace('ps1-oneshot-marker-1','ps1-oneshot-marker-2'));if(!cache.equals(current))changes.push(cache);
    for(const bytes of changes) {
      assert.equal(restore(path,bytes),bytes,path);
      assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes,record:finalBefore(path)}),/remeasure/,path);
    }
    for(const record of [undefined,{}, {...finalBefore(path),bytes:1},{...finalBefore(path),sha256:'0'.repeat(64)}])assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:current,record}));
  }
  const current=await read('docs/js/ps1synth.js'),record=finalBefore('js/ps1synth.js');
  for(const path of ['__proto__','js/other.js','docs/js/ps1synth.js','generated/ps1_spu_wasm.wasm','js/soundchip_mixer_presets.js']) {
    assert.equal(restore(path,current),current);assert.throws(()=>assertMixerCalibrationSourceFreshness({path,bytes:current,record}));
  }
});

test('the receipt, original reports and numeric proof dependencies require their independent exact fingerprints',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ps1-import-review-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const modulePath=join(directory,'scripts/mixer_calibration_ps1_import_revision.mjs');
  const files=['scripts/mixer_calibration_ps1_import_revision.mjs',receiptPath,...reports,'docs/generated/ps1_spu_wasm.wasm','scripts/soundchip_calibration_ps1.mjs'];
  for(const path of files){await mkdir(dirname(join(directory,path)),{recursive:true});await writeFile(join(directory,path),await read(path));}
  let serial=0;
  const load=()=>import(pathToFileURL(modulePath).href+'?audit='+serial++);
  const path='js/ps1synth.js',current=await read('docs/'+path);
  assert.equal(sha((await load()).restoreMixerCalibrationPs1ImportRevision(path,current)),finalBefore(path).sha256);
  for(const target of [receiptPath,reports[0],'docs/generated/ps1_spu_wasm.wasm','scripts/soundchip_calibration_ps1.mjs']) {
    const bytes=await read(target),changedBytes=target===receiptPath?Buffer.from(JSON.stringify({...receipt,feature:'unreviewed change'})):Buffer.concat([bytes,Buffer.from('\n')]);
    await writeFile(join(directory,target),changedBytes);
    const changed=await load();assert.throws(()=>changed.restoreMixerCalibrationPs1ImportRevision(path,current),/remeasure|independently pinned SHA/,target);
    await writeFile(join(directory,target),bytes);
  }
});

test('all twelve existing PS1 calibration reference routes retain exact held and KeyOff PCM, RAM and hardware traces',async()=>{
  const current=await read('docs/js/ps1synth.js'),before=restore('js/ps1synth.js',current);
  const proof=await measurePs1ImportRevisionPcm({beforeSource:before,afterSource:current});
  assert.deepEqual(proof,receipt.pcmProof);assert.equal(proof.routes.length,12);
  assert(proof.routes.every(route=>route.maximumDifference===0&&route.keyOffSilence));
  assert.equal(proof.audioContextCreated,false);assert.equal(proof.physicalAudio,false);
});

test('the prior PS1 definition mapping preserves existing read-only lookups and adds only the reviewed source target',async()=>{
  const path='playground/playground_monaco_definitions.js',current=await read('docs/'+path),before=restore(path,current);
  const modules=await Promise.all([before,current].map(bytes=>import('data:text/javascript;base64,'+bytes.toString('base64'))));
  for(const code of ['const fm=await useSoundChip("ym2612"); fm.noteOn(CH1,"C4");','const notes=scale("C4","minor",2);','const sid=await useSoundChip("sid"); sid.setFilter({cutoff:440});']) {
    for(let column=1;column<=code.length;column++)assert.deepEqual(modules[1].definitionSource(code,{lineNumber:1,column}),modules[0].definitionSource(code,{lineNumber:1,column}));
  }
  const code='interface SpuCodeClient {\n  noteOn(): Promise<void>;\n}';
  const target=modules[1].definitionSource(code,{lineNumber:2,column:3},'ps1');
  assert.equal(target?.file,'ps1synth.js');
});
