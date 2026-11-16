/** Record current complete measurements and affected applied-gain verification.
 * Existing immutable PS1/WS verification is paired only with unchanged gains.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {renderSoundChipMixerPresets,generateSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';
import {AY_SINGLE_OUTPUT_POLICY_RECEIPT_PATH as destination,AY_SINGLE_OUTPUT_POLICY_SOURCE_PATH as source,AY_SINGLE_OUTPUT_POLICY_REPORT_PATHS as paths} from './mixer_calibration_ay_single_output_policy_revision.mjs';
const root=new URL('../',import.meta.url),read=path=>readFile(new URL(path,root)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const record=bytes=>({bytes:bytes.length,sha256:sha(bytes)}),json=async path=>JSON.parse(await read(path));
const reports={};for(const path of paths)reports[path]=record(await read(path));
const baseline=await json('docs/issues/playground_chip_levels_01.json'),psg=await json('docs/issues/soundchip_psg_levels_06.json');
const previousPsg=await json('docs/issues/soundchip_psg_levels_05.json');assert.equal(psg.passed,true);assert.equal(psg.rows.length,18);assert.deepEqual(psg.rows,previousPsg.rows);assert.deepEqual(psg.defaults,previousPsg.defaults);
const current=[],previous=[];
for(const kind of ['ps1','wonderswan','pokey','scsp']){
 const measured=await json(`docs/issues/${kind}_ay_single_output_chip_levels_01.json`),old=await json(`docs/issues/${kind}_spc_voice_edit_chip_levels_01.json`);
 assert(measured.passed&&measured.completeCoverage&&measured.pcmContinuous&&!measured.verify&&measured.physicalOutputMuted&&!measured.listeningPerformed,kind);
 const unchanged=['ps1','wonderswan'].includes(kind),verified=await json(`docs/issues/${kind}_${unchanged?'spc_voice_edit':'ay_single_output'}_chip_levels_verify_01.json`),verifiedBaseline=unchanged?old:measured;
 assert(verified.passed&&verified.verify&&verified.completeCoverage&&verified.pcmContinuous&&verified.physicalOutputMuted&&!verified.listeningPerformed,kind);
 assert.deepEqual(verified.sources,verifiedBaseline.sources);assert.deepEqual(verified.scripts,verifiedBaseline.scripts);assert.deepEqual(verified.calibration,verifiedBaseline.calibration);
 if(unchanged)assert.deepEqual(measured.calibration.routes.map(({role,volume})=>({role,volume})),old.calibration.routes.map(({role,volume})=>({role,volume})),'Earlier applied-gain evidence is used only when those exact gains remain unchanged');
 current.push(measured);previous.push(old);
}
await generateSoundChipMixerPresets({reportPath:new URL('docs/issues/playground_chip_levels_01.json',root),psgReportPath:new URL('docs/issues/soundchip_psg_levels_06.json',root),
 ps1ReportPath:new URL(paths[1],root),wonderswanReportPath:new URL(paths[2],root),pokeyReportPath:new URL(paths[3],root),scspReportPath:new URL(paths[4],root),outPath:new URL(source,root),check:true});
const after=await read(source),before=Buffer.from(renderSoundChipMixerPresets(baseline,previousPsg,...previous));
assert.equal(after.toString(),renderSoundChipMixerPresets(baseline,psg,...current));assert.notDeepEqual(after,before);
const predecessor=await json('docs/issues/spc_voice_edit_mixer_policy_revision_01.json');assert.deepEqual(record(before),predecessor.after);
const servedPath='docs/js/soundchip_mixer_presets.js',servedAfter=await read(servedPath);
const versioned=servedAfter.toString().match(/import\('\.\/soundchip_mixer\.js\?v=[^'\r\n]+'\)/g);assert.equal(versioned?.length,1);
const servedBefore=Buffer.from(before.toString().replace("import('./soundchip_mixer.js')",versioned[0]));
assert.equal(servedAfter.toString(),after.toString().replace("import('./soundchip_mixer.js')",versioned[0]));
const oldMirror=await json('docs/issues/scsp_loop_link_api_source_revision_01.json');assert.deepEqual(record(servedBefore),oldMirror.relatedSources[servedPath]);
const receipt={schemaVersion:1,scope:'complete-ay-single-output-mixer-remeasurement',path:source,before:record(before),after:record(after),reports,beforeText:before.toString(),served:{path:servedPath,before:record(servedBefore),after:record(servedAfter),beforeText:servedBefore.toString()}};
const output=JSON.stringify(receipt,null,2)+'\n',mode=process.argv[2];assert.equal(process.argv.length,3);assert(['--write','--check'].includes(mode),'Usage: node scripts/record_ay_single_output_mixer_policy_revision.mjs --write | --check');
if(mode==='--write')await writeFile(new URL(destination,root),output);else assert.equal((await read(destination)).toString(),output);
console.log('AY Single Output policy receipt object SHA256 '+sha(JSON.stringify(receipt)));
