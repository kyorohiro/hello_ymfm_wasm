/** Record genuine complete baseline and verification inputs for one policy. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {renderSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH as destination,
  MEASURED_POLICY_REVISION_SOURCE_PATH as source,
  MEASURED_POLICY_REVISION_REPORT_PATHS as paths} from './mixer_calibration_measured_policy_revision.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = bytes => ({bytes:bytes.length,sha256:sha(bytes)});
const read = path => readFile(new URL('../' + path,import.meta.url));
const reports = {}, baselines = [];
for (const path of paths) {
  const bytes = await read(path), report = JSON.parse(bytes), verify = path.includes('_verify_');
  assert(report.passed && report.completeCoverage && report.pcmContinuous, 'Complete successful PCM measurements are required: ' + path);
  assert(report.physicalOutputMuted && !report.listeningPerformed, 'Silent standard calibration is required: ' + path);
  assert.equal(report.verify,verify,path);
  reports[path] = record(bytes);
  if (!verify) baselines.push(report);
}
const historical = JSON.parse(await read('docs/issues/playground_chip_levels_01.json'));
const psg = JSON.parse(await read('docs/issues/soundchip_psg_levels_05.json'));
const after = await read(source);
assert.equal(after.toString(),renderSoundChipMixerPresets(historical,psg,...baselines),'Current policy must be derived from all new measurements');
const before = execFileSync('git',['show','a04e3ff87ccc25dcceb27d56d842ad45514669ac:' + source],{cwd:root,maxBuffer:1024*1024});
assert(!after.equals(before),'The new measured policy must differ');
const receipt = {schemaVersion:1,scope:'complete-spc-voice-edit-mixer-remeasurement',path:source,
  before:record(before),after:record(after),reports,beforeText:before.toString()};
const output = JSON.stringify(receipt,null,2) + '\n';
if (process.argv.length !== 3 || !['--write','--check'].includes(process.argv[2])) throw Error('Usage: node scripts/record_measured_mixer_policy_revision.mjs --write | --check');
if (process.argv[2] === '--write') await writeFile(new URL('../' + destination,import.meta.url),output);
else assert.equal(await read(destination).then(bytes=>bytes.toString()),output,'Measured policy receipt differs');
console.log('Measured policy receipt object SHA256 ' + sha(JSON.stringify(receipt)));
