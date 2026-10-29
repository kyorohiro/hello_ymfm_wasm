import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPs1MixerCalibrationFixture} from '../test/helpers/ps1_mixer_calibration_fixture.mjs';
import {PS1_CALIBRATION_REQUIRED_SOURCES,PS1_CALIBRATION_REQUIRED_SCRIPTS,validatePs1MixerCalibration,validatePs1MixerCalibrationSources} from './ps1_mixer_calibration.mjs';

const fixture=await createPs1MixerCalibrationFixture();
const copy=()=>structuredClone(fixture);
const zeroSha='0'.repeat(64);
test('complete PS1 extension derives the canonical source gains without mutating history',()=>{
  const {historical,ps1Report}=copy(),before=JSON.stringify({historical,ps1Report});
  const result=validatePs1MixerCalibration(historical,ps1Report);
  assert.equal(result.primaryVolume,.128832);assert.equal(result.extraVolume,.128832);
  assert.equal(result.metadata.measuredPs1Captures,48);assert.equal(result.metadata.measuredAnchorCaptures,8);
  assert.equal(result.metadata.codecHeadroom,.875);assert.equal(result.metadata.targetAmplitude,historical.calibration.targetAmplitude);
  assert.equal(JSON.stringify({historical,ps1Report}),before,'validation has no mutation side effects');
});
test('primary and extra use separate Chromium48000/main440Hz captures, independent of row order',()=>{
  const {historical,ps1Report}=copy();
  const primary=ps1Report.rows.find(row=>row.engine==='chromium'&&row.actualSampleRate===48000&&row.execution==='main'&&row.frequencyHz===440&&row.role==='primary');
  const scale=.8;primary.amplitude*=scale;primary.measuredAmplitude*=scale;
  for(const channel of primary.pcm.channels)for(const name of ['minimum','maximum','halfPeakToPeak','peak','dc','rms','acRms'])channel[name]*=scale;
  const route=ps1Report.calibration.routes.find(row=>row.role==='primary');route.amplitude=primary.amplitude;route.volume=Number((historical.calibration.targetAmplitude/primary.amplitude).toFixed(6));
  ps1Report.rows.reverse();ps1Report.anchors.reverse();ps1Report.calibration.routes.reverse();
  const result=validatePs1MixerCalibration(historical,ps1Report);
  assert.equal(result.primaryVolume,route.volume);assert.equal(result.extraVolume,.128832);assert.notEqual(result.primaryVolume,result.extraVolume);
});

const negatives=[
  ['edited historical row',({historical})=>historical.rows[0].amplitude*=2],
  ['incomplete historical baseline',({historical})=>historical.rows.pop()],
  ['historical target changed',({historical})=>historical.calibration.targetAmplitude=.2],
  ['unsuccessful report',({ps1Report:r})=>r.passed=false],
  ['verification report as baseline',({ps1Report:r})=>r.verify=true],
  ['unknown schema',({ps1Report:r})=>r.schemaVersion=2],
  ['wrong gain units',({ps1Report:r})=>r.gainUnits='legacy'],
  ['partial coverage declared',({ps1Report:r})=>r.completeCoverage=false],
  ['missing PS1 row',({ps1Report:r})=>r.rows.pop()],
  ['duplicate PS1 row',({ps1Report:r})=>r.rows[1]=structuredClone(r.rows[0])],
  ['missing FM anchor',({ps1Report:r})=>r.anchors.pop()],
  ['duplicate FM anchor',({ps1Report:r})=>r.anchors[1]=structuredClone(r.anchors[0])],
  ['FM anchor mixed into PS1 inventory',({ps1Report:r})=>{const x=r.rows[0];r.rows[0]=r.anchors[0];r.anchors[0]=x;}],
  ['duplicate engine matrix',({ps1Report:r})=>r.engines=['chromium','chromium']],
  ['partial sample-rate matrix',({ps1Report:r})=>r.sampleRates=[48000]],
  ['wrong actual rate',({ps1Report:r})=>r.rows[0].actualSampleRate=48000],
  ['wrong mode',({ps1Report:r})=>r.rows[0].mode='genesis'],
  ['wrong source ID',({ps1Report:r})=>r.rows[0].sourceId='other'],
  ['wrong reference frequency',({ps1Report:r})=>r.referenceFrequencyHz=220],
  ['wrong codec headroom',({ps1Report:r})=>r.rows[0].referencePeak=1],
  ['wrong decoded reference',({ps1Report:r})=>r.rows[0].decodedReference.shift=4],
  ['wrong expected pitch',({ps1Report:r})=>r.rows[0].expectedFrequencyHz=100],
  ['wrong executed source',({ps1Report:r})=>r.rows[0].sourceSha256=zeroSha],
  ['source gain not unity',({ps1Report:r})=>r.rows[0].mixer.settings.volume=.5],
  ['source pan not centered',({ps1Report:r})=>r.rows[0].mixer.settings.pan=.1],
  ['source muted',({ps1Report:r})=>r.rows[0].mixer.settings.muted=true],
  ['source not solo',({ps1Report:r})=>r.rows[0].mixer.settings.solo=false],
  ['source disconnected',({ps1Report:r})=>r.rows[0].mixer.entry.connected=false],
  ['input PCM missing frames',({ps1Report:r})=>r.rows[0].pcm.inputFrames--],
  ['capture missing warmup',({ps1Report:r})=>r.rows[0].pcm.warmupFrames=0],
  ['partial capture duration',({ps1Report:r})=>r.rows[0].pcm.frames=1024],
  ['pilot reported missing',({ps1Report:r})=>r.rows[0].pcm.pilot=null],
  ['pilot discontinuity',({ps1Report:r})=>r.rows[0].pcm.pilot.continuous=false],
  ['pilot count incomplete',({ps1Report:r})=>r.rows[0].pcm.pilot.receivedFrames--],
  ['pilot invalid samples',({ps1Report:r})=>r.rows[0].pcm.pilot.invalidSamples=1],
  ['pilot gap hidden by boolean',({ps1Report:r})=>r.rows[0].pcm.pilot.sampleGapCount=1],
  ['pilot endpoint impossible',({ps1Report:r})=>r.rows[0].pcm.pilot.lastSample=.5],
  ['pilot zero count impossible',({ps1Report:r})=>r.rows[0].pcm.pilot.zeroSamples=100],
  ['clock unaccounted frame',({ps1Report:r})=>r.rows[0].pcm.clock.frames--],
  ['clock malformed callbacks',({ps1Report:r})=>r.rows[0].pcm.clock.malformedRowCount=1],
  ['clock diagnostics silently discarded',({ps1Report:r})=>{r.rows[0].pcm.clock.continuous=false;r.rows[0].pcm.clock.gapCount=1;r.rows[0].pcm.clock.gaps=[{}];}],
  ['nonfinite PCM',({ps1Report:r})=>r.rows[0].pcm.channels[0].rms=NaN],
  ['nonfinite PCM counter',({ps1Report:r})=>r.rows[0].pcm.channels[0].nonfinite=1],
  ['overrange PCM',({ps1Report:r})=>r.rows[0].pcm.channels[0].overrange=1],
  ['inconsistent measured peak',({ps1Report:r})=>r.rows[0].pcm.channels[0].halfPeakToPeak*=.9],
  ['inconsistent RMS/DC',({ps1Report:r})=>r.rows[0].pcm.channels[0].rms*=.9],
  ['missing stereo channel',({ps1Report:r})=>r.rows[0].pcm.channels.pop()],
  ['mistuned audible PCM',({ps1Report:r})=>r.rows[0].pcm.channels[0].estimatedFrequencyHz=110],
  ['silent audible PCM',({ps1Report:r})=>r.rows[0].pcm.channels[0].nonzero=0],
  ['PS1 partial onset with coherent low RMS and unchanged peak',({ps1Report:r})=>{
    const channel=r.rows[0].pcm.channels[0];channel.rms=channel.acRms=.52;
  }],
  ['PS1 scheduling silence with unchanged peak',({ps1Report:r})=>r.rows[0].pcm.channels[0].nonzero=Math.floor(r.rows[0].pcm.frames*.7)],
  ['PS1 square-like waveform with coherent RMS and unchanged peak',({ps1Report:r})=>{
    const channel=r.rows[0].pcm.channels[0];channel.rms=channel.acRms=.8;
  }],
  ['PS1 excessive DC despite internally coherent RMS',({ps1Report:r})=>{
    const channel=r.rows[0].pcm.channels[0];channel.dc=.1;channel.rms=Math.hypot(channel.acRms,channel.dc);
  }],
  ['codec normalized twice',({ps1Report:r})=>r.rows[0].amplitude/=.875],
  ['measured amplitude detached from PCM',({ps1Report:r})=>r.rows[0].measuredAmplitude*=.9],
  ['FM unit changed despite coherent PCM statistics',({ps1Report:r})=>{
    const row=r.anchors[0];row.amplitude*=2;row.measuredAmplitude*=2;
    for(const channel of row.pcm.channels)for(const name of ['minimum','maximum','halfPeakToPeak','peak','dc','rms','acRms'])channel[name]*=2;
  }],
  ['Stop still audible',({ps1Report:r})=>r.rows[0].stopped.channels[0].nonzero=1],
  ['Stop zero hash inconsistent',({ps1Report:r})=>r.rows[0].stopped.channels[0].sha256=zeroSha],
  ['physical output not muted',({ps1Report:r})=>r.physicalOutputMuted=false],
  ['capture output not muted',({ps1Report:r})=>r.rows[0].pcm.physicalOutputMuted=false],
  ['processor error',({ps1Report:r})=>r.rows[0].stopped.processorErrors=['error']],
  ['shared target changed',({ps1Report:r})=>r.calibration.targetAmplitude=.2],
  ['target change admitted',({ps1Report:r})=>r.calibration.targetChanged=true],
  ['reference target changed',({ps1Report:r})=>r.calibration.referenceAmplitude=.2],
  ['baseline SHA wrong',({ps1Report:r})=>r.baseline.sha256=zeroSha],
  ['baseline count wrong',({ps1Report:r})=>r.baseline.rows=152],
  ['missing calibrated role',({ps1Report:r})=>r.calibration.routes.pop()],
  ['duplicate calibrated role',({ps1Report:r})=>r.calibration.routes[1]=structuredClone(r.calibration.routes[0])],
  ['per-route gain clamped',({ps1Report:r})=>r.calibration.routes[0].volume=.1],
  ['negative gain',({ps1Report:r})=>r.calibration.routes[0].volume=-1],
  ['excessive gain',({ps1Report:r})=>r.calibration.routes[0].volume=3],
  ['canonical source changed',({ps1Report:r})=>r.calibration.routes[0].reference.engine='webkit'],
  ['missing source provenance',({ps1Report:r})=>r.sources={}],
  ['single fake source provenance',({ps1Report:r})=>r.sources={'fake.js':{bytes:1,sha256:zeroSha}}],
  ['missing required WASM provenance',({ps1Report:r})=>delete r.sources['generated/ps1_spu_wasm.wasm']],
  ['missing runner provenance',({ps1Report:r})=>delete r.scripts['scripts/calibrate_ps1_levels.cjs']],
  ['source traversal',({ps1Report:r})=>r.sources['../fake.js']={bytes:1,sha256:zeroSha}],
  ['source byte count invalid',({ps1Report:r})=>r.sources[PS1_CALIBRATION_REQUIRED_SOURCES[0]].bytes=0],
  ['source SHA invalid',({ps1Report:r})=>r.sources[PS1_CALIBRATION_REQUIRED_SOURCES[0]].sha256='not-a-digest'],
  ['generated defaults hash cycle',({ps1Report:r})=>r.sources['playground/playground_mixer_defaults.js']={bytes:1,sha256:zeroSha}],
  ['generated defaults exclusion absent',({ps1Report:r})=>r.sourceHashExclusions.pop()],
];
for(const [name,mutate]of negatives)test('rejects '+name,()=>{
  const f=copy();mutate(f);assert.throws(()=>validatePs1MixerCalibration(f.historical,f.ps1Report),/Invalid PS1 Mixer calibration/);
});

test('clock-only anomaly remains accepted when fully accounted and retained',()=>{
  const {historical,ps1Report:r}=copy(),row=r.rows[0],clock=row.pcm.clock;
  clock.continuous=false;clock.gapCount=1;clock.gaps=[{index:2,frame:128,expectedFrame:256,offset:256,quantum:128,ordinal:2}];
  r.clockAnomalies.push({engine:row.engine,sampleRate:row.actualSampleRate,execution:row.execution,role:row.role,kind:row.kind,frequencyHz:row.frequencyHz,capture:'pcm',clock:structuredClone(clock)});
  assert.equal(validatePs1MixerCalibration(historical,r).primaryVolume,.128832);
});
test('all required raw sources match, and corrupted provenance is rejected before writes',async t=>{
  await validatePs1MixerCalibrationSources({reportPath:'docs/issues/playground_chip_levels_01.json',ps1Report:fixture.ps1Report});
  for(const path of ['generated/ps1_spu_wasm.wasm','js/playground_ps1_worklet.js'])await t.test('changed '+path,async()=>{
    const {ps1Report}=copy();ps1Report.sources[path].sha256=zeroSha;
    await assert.rejects(validatePs1MixerCalibrationSources({reportPath:'docs/issues/playground_chip_levels_01.json',ps1Report}),/served DSP\/WASM source changed/);
  });
  for(const path of ['scripts/audio_clock_audit.cjs','scripts/soundchip_calibration_ps1.mjs'])await t.test('changed '+path,async()=>{
    const {ps1Report}=copy();ps1Report.scripts[path]=zeroSha;
    await assert.rejects(validatePs1MixerCalibrationSources({reportPath:'docs/issues/playground_chip_levels_01.json',ps1Report}),/script source changed/);
  });
  await t.test('changed source byte count',async()=>{
    const {ps1Report}=copy();ps1Report.sources['generated/ps1_spu_wasm.wasm'].bytes++;
    await assert.rejects(validatePs1MixerCalibrationSources({reportPath:'docs/issues/playground_chip_levels_01.json',ps1Report}),/served DSP\/WASM source changed/);
  });
  await t.test('historical file formatting changed',async t=>{
    const temp=await mkdtemp(join(tmpdir(),'ps1-baseline-guard-'));t.after(()=>rm(temp,{recursive:true,force:true}));
    const reportPath=join(temp,'baseline.json');await writeFile(reportPath,await readFile('docs/issues/playground_chip_levels_01.json','utf8')+'\n');
    await assert.rejects(validatePs1MixerCalibrationSources({reportPath,ps1Report:fixture.ps1Report}),/raw SHA changed/);
  });
  assert.equal(PS1_CALIBRATION_REQUIRED_SCRIPTS.length,5);assert.ok(PS1_CALIBRATION_REQUIRED_SOURCES.length>=18);
});

test('original complete PS1 measurements remain immutable and are stale after the live DSP revision',async()=>{
  const path='docs/issues/ps1_chip_levels_01.json',before=await readFile(path,'utf8'),report=JSON.parse(before);
  const originalSources=structuredClone(report.sources);
  assert.equal(validatePs1MixerCalibration(fixture.historical,report).primaryVolume,.128832);
  await assert.rejects(validatePs1MixerCalibrationSources({reportPath:'docs/issues/playground_chip_levels_01.json',ps1Report:report}),/served DSP\/WASM source changed|source receipt/);
  assert.deepEqual(report.sources,originalSources,'all 293 historical raw hashes remain original evidence');
  assert.equal(Object.keys(report.sources).length,293);
  assert.equal(await readFile(path,'utf8'),before,'freshness checks do not rewrite measurement evidence');
});
