/** Record exact dormant API dependencies and the full native unity-gain proof. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {YM2608_OUTPUT_GAIN_REVISION_RECEIPT_PATH as destination,YM2608_OUTPUT_GAIN_DEFAULT_PCM_PATH as proofPath,
  YM2608_OUTPUT_GAIN_REVISION_SOURCE_PATHS as paths,YM2608_OUTPUT_GAIN_REVISION_RELATED_PATHS as related,
  YM2608_OUTPUT_GAIN_REVISION_REPORT_PATHS as reports} from './mixer_calibration_ym2608_output_gain_revision.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const baseCommit='dede8a0ae6e66798ac755771e65e11b6af3b0ae3';
const sha=bytes => createHash('sha256').update(bytes).digest('hex');
const record=bytes => ({bytes:bytes.length,sha256:sha(bytes)});
const read=name => readFile(new URL('../'+name,import.meta.url));
const sources={},relatedSources={},measured={};
for(const name of paths) {
  const before=execFileSync('git',['show',baseCommit+':docs/'+name],{cwd:root});
  const after=await read('docs/'+name);
  assert(!before.equals(after),'A genuine reviewed source revision is required');
  sources[name]={before:record(before),after:record(after),beforeText:before.toString()};
}
for(const name of related)relatedSources[name]=record(await read(name));
for(const name of reports) {
  const bytes=await read(name),report=JSON.parse(bytes);
  assert(report.passed&&report.completeCoverage&&report.physicalOutputMuted,'A complete silent measurement is required');
  for(const path of paths)assert.deepEqual(report.sources[path],sources[path].before,'Each report must identify the exact dormant predecessor');
  assert([...report.rows,...report.anchors].every(row => row.kind!=='ym2608'),'This review excludes measured YM2608 profiles');
  measured[name]={...record(bytes),objectSha256:sha(JSON.stringify(report))};
}
const proofBytes=await read(proofPath),proof=JSON.parse(proofBytes);
assert(proof.passed&&proof.maximumDifference===0&&proof.cases.length===586&&proof.totalOutputStereoFrames===7264744,'Full exact unity-gain native comparison is required');
const receipt={schemaVersion:1,scope:'dormant-ym2608-output-gain-api',baseCommit,sources,relatedSources,reports:measured,
  nativeProof:{path:proofPath,...record(proofBytes)},
  limits:['The eight original non-YM2608 calibration reports remain byte-identical.',
    'This restores two complete dormant dependency bodies for those exact reports only.',
    'New YM2608 measurements and any unknown source or output change require fresh evidence.']};
const output=JSON.stringify(receipt,null,2)+'\n';
if(process.argv.length!==3||!['--write','--check'].includes(process.argv[2]))throw Error('Usage: node scripts/record_ym2608_output_gain_revision.mjs --write | --check');
if(process.argv[2]==='--write')await writeFile(new URL('../'+destination,import.meta.url),output);
else assert.equal(await read(destination).then(bytes => bytes.toString()),output,'Reviewed output-gain receipt differs');
console.log('YM2608 output-gain receipt object SHA256 '+sha(JSON.stringify(receipt)));
