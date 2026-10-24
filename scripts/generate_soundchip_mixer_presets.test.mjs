import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateSoundChipMixerPresets,renderSoundChipMixerPresets} from './generate_soundchip_mixer_presets.mjs';

const baselineUrl = new URL('../docs/issues/playground_chip_levels_01.json',import.meta.url);

test('the npm preset reproduces from the shared measured baseline; checks reject edited output without overwriting it',async t=>{
  const directory = await mkdtemp(join(tmpdir(),'soundchip-presets-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath = join(directory,'baseline.json'), outPath = join(directory,'nested/presets.js');
  const source = await readFile(baselineUrl,'utf8');
  await writeFile(reportPath,source);
  await generateSoundChipMixerPresets({reportPath,outPath});
  const generated = await readFile(outPath,'utf8');
  assert.equal(generated,await readFile(new URL('../web/soundchip_mixer_presets.js',import.meta.url),'utf8'));
  await generateSoundChipMixerPresets({reportPath,outPath,check:true});
  const changed = generated.replace('"volume": 0.280286','"volume": 0.56');
  assert.notEqual(changed,generated,'fixture changes the measured RF5C164 fallback');
  await writeFile(outPath,changed);
  await assert.rejects(generateSoundChipMixerPresets({reportPath,outPath,check:true}),/stale/);
  assert.equal(await readFile(outPath,'utf8'),changed,'check never repairs an unreviewed change');
  const script = fileURLToPath(new URL('./generate_soundchip_mixer_presets.mjs',import.meta.url));
  const result = spawnSync(process.execPath,[script,`--report=${reportPath}`,`--out=${outPath}`,'--check'],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/stale/);
  assert.equal(await readFile(outPath,'utf8'),changed);
});

test('partial or verification-only reports cannot replace the public preset',async t=>{
  const directory = await mkdtemp(join(tmpdir(),'soundchip-presets-invalid-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const reportPath = join(directory,'baseline.json'), outPath = join(directory,'presets.js');
  const baseline = JSON.parse(await readFile(baselineUrl,'utf8'));
  const valid = renderSoundChipMixerPresets(baseline);
  await writeFile(outPath,valid);
  for(const change of [report=>{report.verify=true;}, report=>{report.rows.pop();},
    report=>{report.calibration.routes.find(route=>route.role==='extra'&&route.kind==='rf5c164').volume*=2;}]) {
    const report = structuredClone(baseline);change(report);
    await writeFile(reportPath,JSON.stringify(report));
    await assert.rejects(generateSoundChipMixerPresets({reportPath,outPath}),/Invalid Playground Mixer calibration/);
    assert.equal(await readFile(outPath,'utf8'),valid);
  }
});
