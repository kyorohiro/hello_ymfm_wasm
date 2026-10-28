import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPokeyMixerCalibrationFixture} from '../test/helpers/pokey_mixer_calibration_fixture.mjs';
import {POKEY_CALIBRATION_REQUIRED_SCRIPTS,POKEY_CALIBRATION_REQUIRED_SOURCES,validatePokeyMixerCalibration,validatePokeyMixerCalibrationSources} from './pokey_mixer_calibration.mjs';

const fixture=await createPokeyMixerCalibrationFixture(),copy=()=>structuredClone(fixture),zeroSha='0'.repeat(64);
const historicalPath='docs/issues/playground_chip_levels_01.json';
function scale(row,factor){
  for(const key of ['amplitude','measuredAmplitude','acRms'])row[key]*=factor;
  for(const ch of row.pcm.channels)for(const key of ['minimum','maximum','halfPeakToPeak','peak','dc','rms','acRms','firstHalfAcRms','secondHalfAcRms'])ch[key]*=factor;
}
async function rejectsMutations(t,mutations){
  for(const [name,mutate]of mutations)await t.test(name,()=>{
    const {historical,pokeyReport}=copy();mutate(pokeyReport,historical);
    assert.throws(()=>validatePokeyMixerCalibration(historical,pokeyReport),/Invalid POKEY Mixer calibration/);
  });
}
test('complete POKEY extension derives four distinct source gains from the live square-family RMS anchor',()=>{
  const {historical,pokeyReport}=copy(),before=JSON.stringify({historical,pokeyReport});
  const result=validatePokeyMixerCalibration(historical,pokeyReport);
  assert.equal(result.primaryVolume,.413785);assert.equal(result.extraVolume,.411308);
  assert.equal(result.dualFirstVolume,.412956);assert.equal(result.dualSecondVolume,.41213);
  assert.equal(result.metadata.measurementMetric,'acRms');assert.equal(result.metadata.waveform,'square');assert.equal(result.metadata.targetAcRms,.199*.35);
  assert.equal(result.metadata.targetAmplitude,historical.calibration.targetAmplitude);assert.equal(result.metadata.measuredPokeyCaptures,96);
  assert.equal(result.metadata.measuredAnchorCaptures,8);assert.equal(result.metadata.measuredPsgCaptures,8);assert.equal(result.metadata.measuredDualCases,8);assert.equal(result.metadata.measuredDualCaptures,16);
  assert.equal(JSON.stringify({historical,pokeyReport}),before,'derivation does not mutate report or history');
});
test('each role selects its own canonical source regardless of inventory order',()=>{
  const {historical,pokeyReport:r}=copy();
  const row=r.rows.find(row=>row.engine==='chromium'&&row.actualSampleRate===48000&&row.execution==='main'&&row.role==='primary'&&row.frequencyHz===440);
  scale(row,.999);const route=r.calibration.routes.find(route=>route.role==='primary');route.amplitude=row.amplitude;route.rawAcRms=row.acRms;route.volume=Number((r.calibration.targetAcRms/row.acRms).toFixed(6));
  r.rows.reverse();r.anchors.reverse();r.psgAnchors.reverse();r.dualChecks.reverse();r.calibration.routes.reverse();
  const result=validatePokeyMixerCalibration(historical,r);
  assert.equal(result.primaryVolume,route.volume);assert.equal(result.extraVolume,.411308);assert.equal(result.dualFirstVolume,.412956);assert.equal(result.dualSecondVolume,.41213);
});
test('complete history, all source identities and the full host matrix are required',async t=>rejectsMutations(t,[
  ['edited historical source',(_r,h)=>h.rows[0].amplitude*=2],
  ['edited historical target',(_r,h)=>h.calibration.targetAmplitude=.2],
  ['failed report',r=>r.passed=false],['verification result',r=>r.verify=true],['partial coverage',r=>r.completeCoverage=false],
  ['missing source capture',r=>r.rows.pop()],['duplicate source',r=>r.rows[1]=structuredClone(r.rows[0])],
  ['missing FM anchor',r=>r.anchors.pop()],['missing live PSG anchor',r=>r.psgAnchors.pop()],['missing dual case',r=>r.dualChecks.pop()],
  ['duplicate dual case',r=>r.dualChecks[1]=structuredClone(r.dualChecks[0])],
  ['partial rate matrix',r=>r.sampleRates=[48000]],['duplicate engine matrix',r=>r.engines=['chromium','chromium']],
  ['partial role matrix',r=>r.roles.pop()],['host rate differs',r=>r.rows[0].actualSampleRate=48000],
  ['dual source identity swapped',r=>r.rows.find(row=>row.role==='dual-second').sourceId='pokey'],
  ['dual source put in single mode',r=>r.rows.find(row=>row.role==='dual-first').mode='pokey'],
  ['additional source borrowed',r=>r.rows.find(row=>row.role==='extra').sourceId='pokey'],
  ['source unit is legacy',r=>r.gainUnits='legacy'],['disconnected source',r=>r.rows[0].mixer.entry.connected=false],
  ['pre-attenuated source',r=>r.rows[0].mixer.settings.volume=.5],['source panned',r=>r.rows[0].mixer.settings.pan=.25],
  ['non-solo source',r=>r.rows[0].mixer.settings.solo=false],['muted source',r=>r.rows[0].mixer.settings.muted=true],
]));
test('null or missing report cannot be treated as a unity calibration',()=>{
  for(const report of [null,undefined,{},false])assert.throws(()=>validatePokeyMixerCalibration(fixture.historical,report),/Invalid POKEY Mixer calibration/);
});
test('square shape, raw output units, steady state and exact source code are binding',async t=>rejectsMutations(t,[
  ['sine claimed for square',r=>r.rows[0].waveform='sine'],['codec correction added',r=>r.rows[0].referencePeak=.875],
  ['distortion substituted',r=>r.rows[0].decodedReference.distortion=7],['wrong clock metadata',r=>r.rows[0].expectedFrequencyHz*=1.01],
  ['wrong setup hash',r=>r.rows[0].sourceSha256=zeroSha],['source text edited',r=>r.rows[0].source+='\n'],
  ['mistuned actual PCM',r=>r.rows[0].pcm.channels[0].estimatedFrequencyHz=110],
  ['partial onset',r=>r.rows[0].pcm.channels[0].nonzero=Math.floor(r.rows[0].pcm.frames*.7)],
  ['unsteady first half',r=>r.rows[0].pcm.channels[0].firstHalfAcRms*=.8],
  ['unsteady second half',r=>r.rows[0].pcm.channels[0].secondHalfAcRms*=.8],
  ['sine RMS substituted',r=>{for(const ch of r.rows[0].pcm.channels)ch.rms=ch.acRms=ch.halfPeakToPeak*Math.SQRT1_2;}],
  ['coherent offset',r=>{const ch=r.rows[0].pcm.channels[0];ch.dc=ch.peak*.1;ch.rms=Math.hypot(ch.acRms,ch.dc);}],
  ['coherent doubled core units',r=>scale(r.rows[0],2)],['changed FM source unit',r=>scale(r.anchors[0],2)],
  ['amplitude detached',r=>r.rows[0].amplitude*=.5],['measured peak detached',r=>r.rows[0].measuredAmplitude*=.5],
  ['RMS detached',r=>r.rows[0].acRms*=.5],['centered mono sides diverge',r=>r.rows[0].pcm.channels[1].sha256=zeroSha],
  ['nonfinite sample',r=>r.rows[0].pcm.channels[0].nonfinite=1],['clipped sample',r=>r.rows[0].pcm.channels[0].overrange=1],
]));
test('PSG listening policy, canonical target and gains cannot be silently retargeted',async t=>rejectsMutations(t,[
  ['original System value changed',r=>r.psgAnchors[0].listeningReference.originalMixerSettings.volume=1],
  ['original System source muted',r=>r.psgAnchors[0].listeningReference.originalMixerSettings.muted=true],
  ['unrecorded actual original Mixer',r=>delete r.psgAnchors[0].listeningReference.originalMixerSettings],
  ['listening gain guessed',r=>r.psgAnchors[0].listeningReference.gain=.5],
  ['listening source not unity',r=>r.psgAnchors[0].mixer.settings.volume=.35],
  ['listening RMS inconsistent',r=>r.psgAnchors[0].listeningReference.acRms*=.5],
  ['coherent doubled PSG source units',r=>{scale(r.psgAnchors[0],2);r.psgAnchors[0].listeningReference.acRms*=2;}],
  ['listening policy applied to raw anchor twice',r=>{scale(r.psgAnchors[0],.35);r.psgAnchors[0].listeningReference.acRms*=.35;}],
  ['historical sine target substituted for square RMS',r=>r.calibration.targetAcRms=r.calibration.targetAmplitude],
  ['sine target changed',r=>r.calibration.targetAmplitude=.2],
  ['metric changed to peak',r=>r.calibration.measurementMetric='halfPeakToPeak'],
  ['different canonical engine',r=>r.calibration.listeningReference.reference.engine='webkit'],
  ['different canonical anchor',r=>r.calibration.listeningReference.rawAcRms*=2],
  ['square-family listening gain changed',r=>r.calibration.listeningReference.gain=.5],
  ['gain applies twice',r=>r.calibration.routes[0].volume**=2],
  ['gain clamped to Mixer maximum',r=>r.calibration.routes[0].volume=2],
  ['gain negative',r=>r.calibration.routes[0].volume=-1],
  ['gain rounded to three decimals',r=>r.calibration.routes[0].volume=Number(r.calibration.routes[0].volume.toFixed(3))],
  ['gain uses peak instead of RMS',r=>r.calibration.routes[0].volume=Number((r.calibration.targetAcRms/r.calibration.routes[0].amplitude).toFixed(6))],
  ['role calibration duplicated',r=>r.calibration.routes[1]=structuredClone(r.calibration.routes[0])],
  ['second dual chip points at first',r=>r.calibration.routes.find(route=>route.role==='dual-second').name='pokey'],
]));
test('dual combination checks require independent routed sources and an unnormalized centered sum',async t=>rejectsMutations(t,[
  ['second chip same ID',r=>r.dualChecks[0].sources[1].id='pokey'],
  ['second chip same frequency',r=>r.dualChecks[0].sources[1].frequencyHz=440],
  ['wrong dual source code',r=>r.dualChecks[0].split.source+='\n'],
  ['wrong dual source hash',r=>r.dualChecks[0].sum.sourceSha256=zeroSha],
  ['left split pan centered',r=>r.dualChecks[0].split.mixers[0].settings.pan=0],
  ['right split pan swapped',r=>r.dualChecks[0].split.mixers[1].settings.pan=-1],
  ['sum additionally attenuated',r=>r.dualChecks[0].sum.mixers[0].settings.volume=.5],
  ['dual expected RMS guessed',r=>r.dualChecks[0].sum.expectedRms[0]*=.5],
  ['dual errors hidden',r=>r.dualChecks[0].sum.rmsRelativeErrors[0]=.001],
  ['split frequency swapped',r=>r.dualChecks[0].split.pcm.channels[1].estimatedFrequencyHz=440],
  ['sum sides diverge',r=>r.dualChecks[0].sum.pcm.channels[1].sha256=zeroSha],
  ['dual stopped remains nonzero',r=>r.dualChecks[0].stopped.channels[0].nonzero=1],
]));
test('every actual PCM frame, pilot sample, Stop zero and diagnostic stays accountable',async t=>rejectsMutations(t,[
  ['missing warmup',r=>r.rows[0].pcm.warmupFrames=0],['missing input',r=>r.rows[0].pcm.inputFrames--],
  ['incomplete pilot',r=>r.rows[0].pcm.pilot.receivedFrames--],['pilot endpoint inconsistent',r=>r.rows[0].pcm.pilot.lastSample=.5],
  ['pilot gap hidden',r=>r.rows[0].pcm.pilot.sampleGapCount=1],['clock frame missing',r=>r.rows[0].pcm.clock.frames--],
  ['clock anomaly discarded',r=>{const c=r.rows[0].pcm.clock;c.continuous=false;c.gapCount=1;c.gaps=[{}];}],
  ['inconsistent peak',r=>r.rows[0].pcm.channels[0].halfPeakToPeak*=.9],['inconsistent RMS',r=>r.rows[0].pcm.channels[0].rms=NaN],
  ['Stop nonzero',r=>r.rows[0].stopped.channels[0].nonzero=1],['Stop sample hash differs',r=>r.rows[0].stopped.channels[0].sha256=zeroSha],
  ['physical output not muted',r=>r.rows[0].pcm.physicalOutputMuted=false],['processor error',r=>r.rows[0].pcm.processorErrors=['error']],
  ['dual capture input gap',r=>r.dualChecks[0].split.pcm.inputFrames--],['dual pilot damaged',r=>r.dualChecks[0].sum.pcm.pilot.continuous=false],
]));
test('clock-only anomalies remain acceptable only when diagnostic evidence is retained exactly',()=>{
  const {historical,pokeyReport:r}=copy(),row=r.dualChecks[0],clock=row.sum.pcm.clock;
  clock.continuous=false;clock.gapCount=1;clock.gaps=[{index:2,frame:128,expectedFrame:256,offset:256,quantum:128,ordinal:2}];
  r.clockAnomalies.push({engine:row.engine,sampleRate:row.actualSampleRate,execution:row.execution,role:row.role,kind:row.kind,frequencyHz:row.frequencyHz,capture:'sum',clock:structuredClone(clock)});
  assert.equal(validatePokeyMixerCalibration(historical,r).primaryVolume,.413785);
});
test('required raw core, WASM, transport and reference provenance cannot be omitted',async t=>rejectsMutations(t,[
  ['all source inventory missing',r=>r.sources={}],['POKEY WASM missing',r=>delete r.sources['generated/pokey_wasm.wasm']],
  ['PSG WASM missing',r=>delete r.sources['generated/segapsg_wasm.wasm']],['Worker transport missing',r=>delete r.sources['js/playground_worker_chip.js']],
  ['reference missing',r=>delete r.scripts['scripts/soundchip_calibration_pokey.mjs']],
  ['baseline SHA incorrect',r=>r.baseline.sha256=zeroSha],['source traversal',r=>r.sources['../fake.js']={bytes:1,sha256:zeroSha}],
  ['script traversal',r=>r.scripts['../fake.js']=zeroSha],['invalid byte count',r=>r.sources[POKEY_CALIBRATION_REQUIRED_SOURCES[0]].bytes=0],
  ['generated policy hash cycle',r=>r.sources['playground/playground_mixer_defaults.js']={bytes:1,sha256:zeroSha}],
  ['extra hash exclusion',r=>r.sourceHashExclusions.push('js/pokeyaudioengine.js')],
]));
test('all script/runtime/WASM hashes are fresh before generators can write',async t=>{
  await validatePokeyMixerCalibrationSources({reportPath:historicalPath,pokeyReport:fixture.pokeyReport});
  for(const path of ['generated/pokey_wasm.wasm','generated/segapsg_wasm.wasm','js/pokeyaudioengine.js','playground/playground.js'])await t.test('changed '+path,async()=>{
    const {pokeyReport}=copy();pokeyReport.sources[path].sha256=zeroSha;
    await assert.rejects(validatePokeyMixerCalibrationSources({reportPath:historicalPath,pokeyReport}),/served DSP\/WASM source changed|source receipt/);
  });
  for(const path of ['scripts/audio_clock_audit.cjs','scripts/soundchip_calibration_pokey.mjs'])await t.test('changed '+path,async()=>{
    const {pokeyReport}=copy();pokeyReport.scripts[path]=zeroSha;
    await assert.rejects(validatePokeyMixerCalibrationSources({reportPath:historicalPath,pokeyReport}),/script source changed/);
  });
  await t.test('source size changed',async()=>{
    const {pokeyReport}=copy();pokeyReport.sources['generated/pokey_wasm.wasm'].bytes++;
    await assert.rejects(validatePokeyMixerCalibrationSources({reportPath:historicalPath,pokeyReport}),/served DSP\/WASM source changed/);
  });
  await t.test('historical raw formatting changed',async t=>{
    const directory=await mkdtemp(join(tmpdir(),'pokey-baseline-guard-'));t.after(()=>rm(directory,{recursive:true,force:true}));
    const reportPath=join(directory,'baseline.json');await writeFile(reportPath,await readFile(historicalPath,'utf8')+'\n');
    await assert.rejects(validatePokeyMixerCalibrationSources({reportPath,pokeyReport:fixture.pokeyReport}),/raw SHA changed/);
  });
  assert.equal(POKEY_CALIBRATION_REQUIRED_SCRIPTS.length,5);assert.ok(POKEY_CALIBRATION_REQUIRED_SOURCES.length>=28);
});
