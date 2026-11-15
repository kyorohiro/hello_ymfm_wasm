/** Review-time record of one passive insertion after complete remeasurement. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {FM2608_NAVIGATION_REVISION_PATH as path,FM2608_NAVIGATION_REVISION_RECEIPT_PATH as destination} from './mixer_calibration_fm2608_navigation_revision.mjs';
import {MEASURED_POLICY_REVISION_RECEIPT_PATH} from './mixer_calibration_measured_policy_revision.mjs';
import {restoreMixerCalibrationNesNavigationRevision} from './mixer_calibration_nes_navigation_revision.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)});
const before=execFileSync('git',['show','a04e3ff87ccc25dcceb27d56d842ad45514669ac:docs/' + path],{cwd:root});
const after=restoreMixerCalibrationNesNavigationRevision(path,await readFile(new URL('../docs/' + path,import.meta.url)));
const removedText="    if(['setTimerA','setCsm','setChannel3Mode','getChannel3State'].includes(symbol))\n"+
  "      return {file:'synth-fm2608/sound_state.js',symbol:symbol==='setCsm'?'installChannel3Controls':symbol};\n"+
  "    if(symbol==='capturePreset')return {file:'synth-fm2608/audio.js',symbol};\n";
const offset=after.indexOf(removedText);
assert(offset>=0 && after.indexOf(removedText,offset+1)===-1,'One exact passive insertion is required');
assert.deepEqual(Buffer.concat([after.subarray(0,offset),after.subarray(offset+Buffer.byteLength(removedText))]),before,'Only the reviewed source-navigation lines may change');
const measurements=JSON.parse(await readFile(new URL('../' + MEASURED_POLICY_REVISION_RECEIPT_PATH,import.meta.url),'utf8'));
for (const name of Object.keys(measurements.reports)) {
  const report=JSON.parse(await readFile(new URL('../' + name,import.meta.url),'utf8'));
  assert.deepEqual(report.sources[path],record(before),'The intermediate bytes must match every measurement');
}
const receipt={schemaVersion:1,scope:'fm2608-passive-hardware-source-navigation',path,
  before:record(before),after:record(after),reports:measurements.reports,afterOffset:offset,removedText};
const output=JSON.stringify(receipt,null,2)+'\n';
if(process.argv.length!==3||!['--write','--check'].includes(process.argv[2]))throw Error('Usage: node scripts/record_fm2608_hardware_navigation_ui_revision.mjs --write | --check');
if(process.argv[2]==='--write')await writeFile(new URL('../' + destination,import.meta.url),output);
else assert.equal(await readFile(new URL('../' + destination,import.meta.url),'utf8'),output,'FM2608 navigation receipt differs');
console.log('FM2608 hardware-navigation receipt object SHA256 ' + sha(JSON.stringify(receipt)));
