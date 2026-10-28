import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWonderSwanMixerCalibrationFixture} from '../test/helpers/wonderswan_mixer_calibration_fixture.mjs';
import {WONDERSWAN_CALIBRATION_REQUIRED_SOURCES,WONDERSWAN_CALIBRATION_REQUIRED_SCRIPTS,WONDERSWAN_CALIBRATION_REPORT_SHA256,WONDERSWAN_CALIBRATION_UI_RECEIPT_OBJECT_SHA256,validateWonderSwanMixerCalibration,validateWonderSwanMixerCalibrationSources} from './wonderswan_mixer_calibration.mjs';
import {assertMixerCalibrationSourceFreshness,mixerCalibrationReceiptObjectSha256,MIXER_CALIBRATION_UI_CACHE_PATHS} from './mixer_calibration_sources.mjs';

const fixture=await createWonderSwanMixerCalibrationFixture();
const copy=()=>structuredClone(fixture),zeroSha='0'.repeat(64);
const historicalPath='docs/issues/playground_chip_levels_01.json';
function scalePcm(row,scale){
  row.amplitude*=scale;row.measuredAmplitude*=scale;
  for(const channel of row.pcm.channels)for(const field of ['minimum','maximum','halfPeakToPeak','peak','dc','rms','acRms'])channel[field]*=scale;
}
async function rejectsMutations(t,mutations){
  for(const [name,mutate]of mutations)await t.test(name,()=>{
    const f=copy();mutate(f.wsReport,f.historical);
    assert.throws(()=>validateWonderSwanMixerCalibration(f.historical,f.wsReport),/Invalid WonderSwan Mixer calibration/);
  });
}

test('complete WonderSwan extension uses full-range centered source units without mutating history',()=>{
  const {historical,wsReport}=copy(),before=JSON.stringify({historical,wsReport});
  const result=validateWonderSwanMixerCalibration(historical,wsReport);
  assert.equal(result.primaryVolume,1.172528);assert.equal(result.extraVolume,1.172528);
  assert.equal(result.metadata.measuredWonderSwanCaptures,48);assert.equal(result.metadata.measuredAnchorCaptures,8);
  assert.equal(result.metadata.codecHeadroom,1);assert.equal(result.metadata.targetAmplitude,historical.calibration.targetAmplitude);
  assert.equal(JSON.stringify({historical,wsReport}),before);
});
test('role gains use their own canonical capture, independent of report order',()=>{
  const {historical,wsReport}=copy();
  const primary=wsReport.rows.find(row=>row.engine==='chromium'&&row.actualSampleRate===48000&&row.execution==='main'&&row.frequencyHz===440&&row.role==='primary');
  scalePcm(primary,.99);
  const route=wsReport.calibration.routes.find(row=>row.role==='primary');route.amplitude=primary.amplitude;route.volume=Number((historical.calibration.targetAmplitude/primary.amplitude).toFixed(6));
  wsReport.rows.reverse();wsReport.anchors.reverse();wsReport.calibration.routes.reverse();
  const result=validateWonderSwanMixerCalibration(historical,wsReport);
  assert.equal(result.primaryVolume,route.volume);assert.equal(result.extraVolume,1.172528);assert.notEqual(result.primaryVolume,result.extraVolume);
});
test('historical identity, matrix coverage, and explicit source routing are required',async t=>rejectsMutations(t,[
  ['edited historical capture',(_r,h)=>h.rows[0].amplitude*=2],
  ['edited historical target',(_r,h)=>h.calibration.targetAmplitude=.2],
  ['verification result cannot be calibration input',r=>r.verify=true],
  ['declared partial coverage',r=>r.completeCoverage=false],
  ['missing source capture',r=>r.rows.pop()],
  ['duplicate source capture',r=>r.rows[1]=structuredClone(r.rows[0])],
  ['missing anchor',r=>r.anchors.pop()],
  ['mixed source and anchor inventories',r=>{const first=r.rows[0];r.rows[0]=r.anchors[0];r.anchors[0]=first;}],
  ['partial host rate matrix',r=>r.sampleRates=[48000]],
  ['duplicate engine matrix',r=>r.engines=['chromium','chromium']],
  ['host rate differs from request',r=>r.rows[0].actualSampleRate=48000],
  ['primary mode is incorrect',r=>r.rows[0].mode='genesis'],
  ['source ID is incorrect',r=>r.rows[0].sourceId='other'],
  ['gain units are legacy',r=>r.gainUnits='legacy'],
  ['source is disconnected',r=>r.rows[0].mixer.entry.connected=false],
  ['source was already attenuated',r=>r.rows[0].mixer.settings.volume=.5],
  ['source is panned',r=>r.rows[0].mixer.settings.pan=.25],
]));
test('wave codes, speaker centering, held sine shape, and canonical gain cannot be substituted',async t=>rejectsMutations(t,[
  ['headroom is divided again',r=>r.rows[0].referencePeak=.875],
  ['unsigned midpoint is treated as gain correction',r=>r.rows[0].decodedReference.codecHeadroom=.5],
  ['wave code differs',r=>r.rows[0].decodedReference.waveSamples[0]=0],
  ['wrong program source hash',r=>r.rows[0].sourceSha256=zeroSha],
  ['pitch differs despite valid PCM',r=>r.rows[0].pcm.channels[0].estimatedFrequencyHz=110],
  ['partial scheduling onset',r=>r.rows[0].pcm.channels[0].nonzero=Math.floor(r.rows[0].pcm.frames*.7)],
  ['coherent low RMS despite correct peak',r=>{const c=r.rows[0].pcm.channels[0];c.rms=c.acRms=c.peak*.5;}],
  ['coherent square-like waveform',r=>{const c=r.rows[0].pcm.channels[0];c.rms=c.acRms=c.peak*.95;}],
  ['coherent DC offset',r=>{const c=r.rows[0].pcm.channels[0];c.dc=c.peak*.1;c.rms=Math.hypot(c.acRms,c.dc);}],
  ['coherent doubled digital gain',r=>scalePcm(r.rows[0],2)],
  ['changed YM2612 source unit',r=>scalePcm(r.anchors[0],2)],
  ['measured amplitude detached from PCM',r=>r.rows[0].measuredAmplitude*=.5],
  ['derived amplitude detached from PCM',r=>r.rows[0].amplitude*=.5],
  ['changed common target',r=>r.calibration.targetAmplitude=.2],
  ['different canonical engine',r=>r.calibration.routes[0].reference.engine='webkit'],
  ['policy gain applied twice',r=>r.calibration.routes[0].volume**=2],
  ['policy gain clamped to Mixer maximum',r=>r.calibration.routes[0].volume=2],
  ['duplicated calibrated role',r=>r.calibration.routes[1]=structuredClone(r.calibration.routes[0])],
]));
test('every captured frame, independent pilot sample, Stop zero and diagnostics remain accountable',async t=>rejectsMutations(t,[
  ['missing warmup',r=>r.rows[0].pcm.warmupFrames=0],
  ['missing input sample',r=>r.rows[0].pcm.inputFrames--],
  ['damaged pilot',r=>r.rows[0].pcm.pilot.continuous=false],
  ['incomplete pilot count',r=>r.rows[0].pcm.pilot.receivedFrames--],
  ['pilot endpoint inconsistent with frame count',r=>r.rows[0].pcm.pilot.lastSample=.5],
  ['pilot gap hidden by boolean',r=>r.rows[0].pcm.pilot.sampleGapCount=1],
  ['clock frame missing',r=>r.rows[0].pcm.clock.frames--],
  ['clock diagnostic silently discarded',r=>{const c=r.rows[0].pcm.clock;c.continuous=false;c.gapCount=1;c.gaps=[{}];}],
  ['nonfinite PCM',r=>r.rows[0].pcm.channels[0].rms=NaN],
  ['clipped PCM counter',r=>r.rows[0].pcm.channels[0].overrange=1],
  ['inconsistent PCM statistics',r=>r.rows[0].pcm.channels[0].halfPeakToPeak*=.9],
  ['Stop remains audible',r=>r.rows[0].stopped.channels[0].nonzero=1],
  ['Stop zero hash differs',r=>r.rows[0].stopped.channels[0].sha256=zeroSha],
  ['physical output not muted',r=>r.rows[0].pcm.physicalOutputMuted=false],
  ['AudioWorklet processor error',r=>r.rows[0].pcm.processorErrors=['error']],
]));
test('clock-only anomaly is accepted only when its diagnostic is retained',()=>{
  const {historical,wsReport:r}=copy(),row=r.rows[0],clock=row.pcm.clock;
  clock.continuous=false;clock.gapCount=1;clock.gaps=[{index:2,frame:128,expectedFrame:256,offset:256,quantum:128,ordinal:2}];
  r.clockAnomalies.push({engine:row.engine,sampleRate:row.actualSampleRate,execution:row.execution,role:row.role,kind:row.kind,frequencyHz:row.frequencyHz,capture:'pcm',clock:structuredClone(clock)});
  assert.equal(validateWonderSwanMixerCalibration(historical,r).primaryVolume,1.172528);
});
test('provenance requires actual core, WASM, transport, reference and safe paths',async t=>rejectsMutations(t,[
  ['missing all sources',r=>r.sources={}],
  ['missing required WASM',r=>delete r.sources['generated/wonderswan_wasm.wasm']],
  ['missing Worker transport',r=>delete r.sources['js/playground_worker_chip.js']],
  ['missing runner',r=>delete r.scripts['scripts/calibrate_wonderswan_levels.cjs']],
  ['invalid baseline SHA',r=>r.baseline.sha256=zeroSha],
  ['source path traversal',r=>r.sources['../fake.js']={bytes:1,sha256:zeroSha}],
  ['source byte count invalid',r=>r.sources[WONDERSWAN_CALIBRATION_REQUIRED_SOURCES[0]].bytes=0],
  ['generated policy hash cycle',r=>r.sources['playground/playground_mixer_defaults.js']={bytes:1,sha256:zeroSha}],
  ['extra source exclusion would hide changes',r=>r.sourceHashExclusions.push('js/playground_wonderswan_worklet.js')],
]));
test('all raw source hashes are fresh, including all required provenance',async t=>{
  await validateWonderSwanMixerCalibrationSources({reportPath:historicalPath,wsReport:fixture.wsReport});
  for(const path of ['generated/wonderswan_wasm.wasm','js/playground_wonderswan_worklet.js','playground/playground.js'])await t.test('changed '+path,async()=>{
    const {wsReport}=copy();wsReport.sources[path].sha256=zeroSha;
    await assert.rejects(validateWonderSwanMixerCalibrationSources({reportPath:historicalPath,wsReport}),/served DSP\/WASM source changed|Invalid Mixer calibration source receipt/);
  });
  for(const path of ['scripts/audio_clock_audit.cjs','scripts/soundchip_calibration_wonderswan.mjs'])await t.test('changed '+path,async()=>{
    const {wsReport}=copy();wsReport.scripts[path]=zeroSha;
    await assert.rejects(validateWonderSwanMixerCalibrationSources({reportPath:historicalPath,wsReport}),/script source changed/);
  });
  await t.test('source byte count changed',async()=>{
    const {wsReport}=copy();wsReport.sources['generated/wonderswan_wasm.wasm'].bytes++;
    await assert.rejects(validateWonderSwanMixerCalibrationSources({reportPath:historicalPath,wsReport}),/served DSP\/WASM source changed/);
  });
  await t.test('historical raw file formatting changed',async t=>{
    const temp=await mkdtemp(join(tmpdir(),'wonderswan-baseline-guard-'));t.after(()=>rm(temp,{recursive:true,force:true}));
    const reportPath=join(temp,'baseline.json');await writeFile(reportPath,await readFile(historicalPath,'utf8')+'\n');
    await assert.rejects(validateWonderSwanMixerCalibrationSources({reportPath,wsReport:fixture.wsReport}),/raw SHA changed/);
  });
  assert.equal(WONDERSWAN_CALIBRATION_REQUIRED_SCRIPTS.length,5);assert.ok(WONDERSWAN_CALIBRATION_REQUIRED_SOURCES.length>=24);
});

test('original complete WonderSwan source inventory remains valid through pinned UI cache-only receipts',async()=>{
  const path='docs/issues/wonderswan_chip_levels_01.json',before=await readFile(path),report=JSON.parse(before);
  const originalSources=structuredClone(report.sources);
  assert.equal(createHash('sha256').update(before).digest('hex'),WONDERSWAN_CALIBRATION_REPORT_SHA256);
  await validateWonderSwanMixerCalibrationSources({reportPath:historicalPath,wsReport:report});
  assert.deepEqual(report.sources,originalSources,'all 292 historical raw hashes remain original evidence');
  assert.equal(Object.keys(report.sources).length,292);
  assert.deepEqual(await readFile(path),before,'freshness checks do not rewrite measurement evidence');
});

test('WonderSwan receipt authorizes only two known UI cache tokens under the pinned original report',async t=>{
  const report=JSON.parse(await readFile('docs/issues/wonderswan_chip_levels_01.json','utf8'));
  const receipt=JSON.parse(await readFile('docs/issues/wonderswan_chip_levels_ui_receipt_01.json','utf8'));
  assert.equal(mixerCalibrationReceiptObjectSha256(receipt),WONDERSWAN_CALIBRATION_UI_RECEIPT_OBJECT_SHA256);
  assert.equal(receipt.report.path,'docs/issues/wonderswan_chip_levels_01.json');
  assert.equal(receipt.report.sha256,WONDERSWAN_CALIBRATION_REPORT_SHA256);
  for(const path of MIXER_CALIBRATION_UI_CACHE_PATHS)await t.test(path,async()=>{
    const source=await readFile('docs/'+path,'utf8');
    const bytes=Buffer.from(source.replace(/(playground(?:_mixer_defaults)?\.js\?v=)[A-Za-z0-9._+-]+/,'$1receipt-freshness-test'));
    const options={path,bytes,record:report.sources[path],report,reportSha256:WONDERSWAN_CALIBRATION_REPORT_SHA256,
      receipt,receiptObjectSha256:WONDERSWAN_CALIBRATION_UI_RECEIPT_OBJECT_SHA256};
    assert.equal(assertMixerCalibrationSourceFreshness(options),'ui-cache-token');
    assert.throws(()=>assertMixerCalibrationSourceFreshness({...options,bytes:Buffer.concat([bytes,Buffer.from('\n')])}),/served DSP\/WASM source changed/);
    assert.throws(()=>assertMixerCalibrationSourceFreshness({...options,reportSha256:zeroSha}),/receipt report identity or scope mismatch/);
    const edited=structuredClone(receipt);edited.sources[path].canonicalSha256=zeroSha;
    assert.throws(()=>assertMixerCalibrationSourceFreshness({...options,receipt:edited}),/independently pinned SHA/);
    const editedReport=structuredClone(report);editedReport.sources[path].sha256=zeroSha;
    assert.throws(()=>assertMixerCalibrationSourceFreshness({...options,report:editedReport}),/receipt report identity or scope mismatch/);
  });
});
