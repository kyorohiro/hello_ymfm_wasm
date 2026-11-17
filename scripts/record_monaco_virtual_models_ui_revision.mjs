/** Review-time provenance for the exact lazy non-script editor-model revision. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {diffLines} from 'diff';
import {
  MONACO_MODEL_REVISION_SOURCE_PATH as path,
  MONACO_MODEL_REVISION_BASE_COMMIT as baseCommit,
  MONACO_MODEL_REVISION_RECEIPT_PATH as destination,
  MONACO_MODEL_REVISION_REPORT_PATHS as reports,
} from './mixer_calibration_monaco_model_revision.mjs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH,MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256} from './mixer_calibration_measured_policy_revision.mjs';
import {restoreMixerCalibrationScspDspHelpersRevision} from './mixer_calibration_scsp_dsp_helpers_revision.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = bytes => ({bytes:bytes.length,sha256:sha(bytes)});
const historical = path => execFileSync('git',['show',baseCommit + ':' + path],{cwd:root,maxBuffer:4*1024*1024});

function reverseHunks(before,after) {
  const hunks = [];
  let offset = 0, pending;
  function flush() {
    if (!pending) return;
    hunks.push({afterOffset:pending.offset,afterBytes:Buffer.byteLength(pending.after),beforeText:pending.before});
    pending = undefined;
  }
  for (const part of diffLines(before.toString('utf8'),after.toString('utf8'))) {
    if (!part.added && !part.removed) {flush(); offset += Buffer.byteLength(part.value); continue;}
    pending ??= {offset,before:'',after:''};
    if (part.removed) pending.before += part.value;
    else {pending.after += part.value; offset += Buffer.byteLength(part.value);}
  }
  flush();
  const parts = [];
  let cursor = 0;
  for (const hunk of hunks) {
    parts.push(after.subarray(cursor,hunk.afterOffset),Buffer.from(hunk.beforeText));
    cursor = hunk.afterOffset + hunk.afterBytes;
  }
  parts.push(after.subarray(cursor));
  assert.deepEqual(Buffer.concat(parts),before,'The complete source must reconstruct its measured predecessor');
  return hunks;
}

export async function createMonacoVirtualModelsUiReceipt() {
  const before = historical('docs/' + path);
  const after = restoreMixerCalibrationScspDspHelpersRevision('docs/' + path, await readFile(resolve(root,'docs/' + path)));
  assert(!before.equals(after),'Expected the reviewed editor-model lifecycle change');
  assert(Buffer.from(after.toString('utf8')).equals(after),'Expected UTF-8 JavaScript');
  const measurements = JSON.parse(await readFile(resolve(root,MEASURED_POLICY_REVISION_RECEIPT_PATH),'utf8'));
  assert.equal(sha(JSON.stringify(measurements)),MEASURED_POLICY_REVISION_RECEIPT_OBJECT_SHA256);
  const reportRecords = {};
  for (const name of reports) {
    const bytes = await readFile(resolve(root,name)), report = JSON.parse(bytes);
    assert.deepEqual(bytes,historical(name),'Original measurement must match the reviewed base commit');
    assert.deepEqual(record(bytes),measurements.reports[name],'Measurement must match its independent existing receipt');
    assert.deepEqual(report.sources[path],record(before),'The complete predecessor must match every measured source');
    reportRecords[name] = record(bytes);
  }
  return {schemaVersion:1,scope:'monaco-passive-virtual-model-lifecycle',path,baseCommit,
    review:'Reviewed editor-model lifecycle changes. Script models remain available for completion and definitions. Preset JSON and other text models are created when opened and released after detachment. Initial models use the file language. The exact complete source reconstructs the measured predecessor.',
    before:record(before),after:record(after),reports:reportRecords,reverseHunks:reverseHunks(before,after)};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--write','--check'].includes(args[0])) throw Error('Usage: node scripts/record_monaco_virtual_models_ui_revision.mjs --write | --check');
  const receipt = await createMonacoVirtualModelsUiReceipt(), text = JSON.stringify(receipt,null,2) + '\n';
  if (args[0] === '--write') await writeFile(resolve(root,destination),text);
  else assert.equal(await readFile(resolve(root,destination),'utf8'),text,'Monaco model receipt differs');
  console.log('Monaco virtual-model receipt object SHA256 ' + sha(JSON.stringify(receipt)));
}
