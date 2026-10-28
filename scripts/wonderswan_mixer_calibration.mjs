/** Strict, shared validation of the WonderSwan extension to the immutable historical
 * Mixer measurements. Digital output units only; never clamp a gain or change
 * the historical target to make an incomplete measurement acceptable.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildWonderSwanCalibrationReference} from './soundchip_calibration_wonderswan.mjs';
import {buildFmCalibrationReference} from './soundchip_calibration_fm.mjs';
import {assertMixerCalibrationSourceFreshness,MIXER_CALIBRATION_UI_CACHE_PATHS} from './mixer_calibration_sources.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const WONDERSWAN_CALIBRATION_BASELINE_PATH='docs/issues/playground_chip_levels_01.json';
export const WONDERSWAN_CALIBRATION_BASELINE_SHA256='9c5129ad176aa4895ff14da345dc0f3ac49588f5255062fa76329b21f28ea234';
export const WONDERSWAN_CALIBRATION_REPORT_SHA256='71d86d014e359c01f4158beefa06301036c5c9eda39215e5b907d569381fdcd0';
export const WONDERSWAN_CALIBRATION_UI_RECEIPT_OBJECT_SHA256='36a53856f68755a2ba0c5c0a548f0bd412b5ac828be71eee0d2ce74e38ed32b5';
const BASELINE_OBJECT_SHA256='50eff6f2cdcd77ab4d41fa43b0afe4a9e4a5d02f5dee06dc67467e3bbeb17c48';
const TARGET=0.12881777435541153,REFERENCE=0.1494140625,HEADROOM=1;
const ENGINES=['chromium','webkit'],RATES=[44100,48000],EXECUTIONS=['main','worker'],ROLES=['primary','extra'],FREQUENCIES=[220,440,880];
export const WONDERSWAN_CALIBRATION_REQUIRED_SCRIPTS=Object.freeze([
  'scripts/calibrate_wonderswan_levels.cjs','scripts/soundchip_calibration_wonderswan.mjs',
  'scripts/soundchip_calibration_fm.mjs','scripts/audio_clock_audit.cjs',WONDERSWAN_CALIBRATION_BASELINE_PATH,
]);
export const WONDERSWAN_CALIBRATION_REQUIRED_SOURCES=Object.freeze([
  'playground/index.html','playground/playground.js',
  'js/playground_runtime.js','js/soundchip_mixer.js','js/chip_worklet_transport.js',
  'js/playground_wonderswan_audio.js','js/playground_wonderswan_worklet.js','js/playground_wonderswan.js',
  'js/wonderswan.js','js/wonderswansynth.js','js/playground_wonderswan_inspector.js',
  'js/playground_chip_clock.js','js/playground_logic_worker.js','js/playground_worker_chip.js',
  'js/playground_performance_sender.js','js/playground_performance_processor.js','js/playground_performance_queue.js',
  'generated/wonderswan_wasm.js','generated/wonderswan_wasm.wasm',
  'js/ym2612.js','js/ym2612-worklet.js','js/ym2612synth.js',
  'generated/ym2612_wasm.js','generated/ym2612_wasm.wasm',
]);
const EXCLUSIONS=['playground/playground_mixer_defaults.js','js/soundchip_mixer_presets.js'];
const fail=message=>{throw new Error('Invalid WonderSwan Mixer calibration: '+message);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const positive=value=>finite(value)&&value>1e-6;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const close=(a,b,tolerance=1e-10)=>finite(a)&&finite(b)&&Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(a),Math.abs(b));
const sameSet=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&expected.every(value=>actual.filter(item=>item===value).length===1);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const key=row=>`${row.engine}/${row.requestedSampleRate}/${row.execution}/${row.role}/${row.kind}/${row.frequencyHz}`;
const pathSafe=path=>typeof path==='string'&&path.length>0&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(part=>part==='..'||part==='.'||part==='');

function validateProvenance(report){
  if(!report.scripts||typeof report.scripts!=='object'||Array.isArray(report.scripts))fail('missing script provenance');
  if(WONDERSWAN_CALIBRATION_REQUIRED_SCRIPTS.some(path=>!digest(report.scripts[path])))fail('missing required runner/reference/pilot/baseline provenance');
  if(report.scripts[WONDERSWAN_CALIBRATION_BASELINE_PATH]!==WONDERSWAN_CALIBRATION_BASELINE_SHA256)fail('historical baseline SHA does not match');
  for(const [path,hash]of Object.entries(report.scripts))if(!pathSafe(path)||!digest(hash))fail('invalid script hash or path');
  if(!report.sources||typeof report.sources!=='object'||Array.isArray(report.sources))fail('missing served DSP/WASM provenance');
  if(WONDERSWAN_CALIBRATION_REQUIRED_SOURCES.some(path=>!report.sources[path]))fail('missing required WonderSwan/FM DSP, transport or WASM provenance');
  for(const [path,record]of Object.entries(report.sources))if(!pathSafe(path)||!record||!Number.isSafeInteger(record.bytes)||record.bytes<=0||!digest(record.sha256))fail('invalid served source hash, bytes or path');
  if(!sameSet(report.sourceHashExclusions,EXCLUSIONS)||EXCLUSIONS.some(path=>Object.hasOwn(report.sources,path)))fail('generated policy hashes must be excluded to avoid a calibration cycle');
}

function validateCapture(pcm,row,stopped){
  const label=key(row)+(stopped?'/Stop':'/PCM'),rate=row.actualSampleRate;
  const frames=Math.ceil(rate*(stopped ? .15 : 1)/128)*128,warmupFrames=Math.ceil(rate*(stopped ? .25 : 1)/128)*128,total=frames+warmupFrames;
  if(!pcm||pcm.sampleRate!==rate||pcm.frames!==frames||pcm.warmupFrames!==warmupFrames||pcm.capturedFrames!==total||pcm.inputFrames!==total)fail('missing or unaccounted captured PCM: '+label);
  if(pcm.physicalOutputMuted!==true||!Array.isArray(pcm.processorErrors)||pcm.processorErrors.length)fail('unmuted or failed processor capture: '+label);
  if(pcm.tap!=='audio.masterInputNode (after source Mixer, before FX/master/listening)')fail('unexpected measurement tap: '+label);
  const pilot=pcm.pilot;
  if(!pilot||pilot.continuous!==true||pilot.complete!==true||pilot.period!==2**24||pilot.frames!==total||pilot.expectedFrames!==total||pilot.receivedFrames!==total||
    pilot.nonFinite!==0||pilot.invalidSamples!==0||pilot.sampleGapCount!==0||!Array.isArray(pilot.sampleGaps)||pilot.sampleGaps.length)fail('incomplete or damaged independent pilot: '+label);
  const first=pilot.firstSample*pilot.period,last=pilot.lastSample*pilot.period;
  if(!integer(first)||first>=pilot.period||!integer(last)||last>=pilot.period||last!==(first+total-1)%pilot.period||
    pilot.zeroSamples!==Number(first===0||first+total>pilot.period))fail('pilot endpoints do not account for every frame: '+label);
  const clock=pcm.clock;
  if(!clock||clock.measurementValid!==true||clock.frames!==total||clock.rowCount!==total/128||!integer(clock.firstFrame)||!integer(clock.lastFrame)||
    clock.malformedRowCount!==0||!Array.isArray(clock.malformedRows)||clock.malformedRows.length||
    !integer(clock.gapCount)||clock.gapCount>=clock.rowCount||!integer(clock.unstableReadCount)||clock.unstableReadCount>clock.rowCount||!Array.isArray(clock.gaps)||clock.gaps.length!==Math.min(32,clock.gapCount)||
    !Array.isArray(clock.unstableReads)||clock.unstableReads.length!==Math.min(32,clock.unstableReadCount)||
    clock.continuous!==(clock.gapCount===0&&clock.unstableReadCount===0)||
    (clock.continuous&&clock.lastFrame!==clock.firstFrame+total-128))fail('invalid clock accounting or hidden diagnostic anomaly: '+label);
  if(!Array.isArray(pcm.channels)||pcm.channels.length!==2)fail('stereo PCM statistics required: '+label);
  for(const channel of pcm.channels){
    if(!channel||!['minimum','maximum','halfPeakToPeak','peak','dc','rms','acRms','estimatedFrequencyHz'].every(name=>finite(channel[name]))||
      channel.minimum>channel.maximum||channel.minimum< -1||channel.maximum>1||channel.rms<0||channel.acRms<0||
      channel.nonfinite!==0||channel.overrange!==0||!integer(channel.nonzero)||channel.nonzero>frames||!digest(channel.sha256))fail('invalid or clipped PCM: '+label);
    if(!close(channel.halfPeakToPeak,(channel.maximum-channel.minimum)/2)||!close(channel.peak,Math.max(Math.abs(channel.minimum),Math.abs(channel.maximum)))||
      !close(channel.acRms**2,Math.max(0,channel.rms**2-channel.dc**2))||channel.dc<channel.minimum||channel.dc>channel.maximum||channel.rms>channel.peak+1e-10)fail('inconsistent PCM metrics: '+label);
    if(stopped){
      if(['minimum','maximum','halfPeakToPeak','peak','dc','rms','acRms','nonzero','estimatedFrequencyHz'].some(name=>channel[name]!==0)||channel.sha256!==sha(Buffer.alloc(frames*4)))fail('Stop did not yield exact zero PCM: '+label);
    }else{
      if(channel.minimum>=0||channel.maximum<=0||!positive(channel.halfPeakToPeak)||!positive(channel.acRms)||channel.nonzero<frames/2||
        Math.abs(channel.estimatedFrequencyHz-row.expectedFrequencyHz)>=Math.max(2,row.expectedFrequencyHz*.015))fail('silent, DC-only or mistuned reference PCM: '+label);
      if(row.kind==='wonderswan'&&(channel.nonzero<=frames*.9||Math.abs(channel.acRms/channel.halfPeakToPeak/row.decodedReference.decodedRms-1)>=.03||
        Math.abs(channel.dc)>=channel.peak*.01))fail('WonderSwan reference is not a speaker-centered steady held sine after scheduling warmup: '+label);
    }
  }
}

/** Pure derivation. The historical report remains byte-identical on disk and
 * object-identical here. Exactly one canonical measured gain is used per role.
 */
export function validateWonderSwanMixerCalibration(historical,report){
  if(!historical||historical.schemaVersion!==1||historical.passed!==true||historical.verify!==false||historical.rows?.length!==153||
    historical.calibration?.targetAmplitude!==TARGET||historical.calibration?.referenceAmplitude!==REFERENCE||sha(JSON.stringify(historical))!==BASELINE_OBJECT_SHA256)fail('the original complete 153-capture historical baseline is required');
  if(!report||report.schemaVersion!==1||report.passed!==true||report.verify!==false||report.completeCoverage!==true||report.gainUnits!=='source'||report.referenceFrequencyHz!==440||
    report.physicalOutputMuted!==true||report.listeningPerformed!==false||report.pcmContinuous!==true||report.continuityOracle!=='independent-24-bit-pilot-PCM')fail('successful complete non-verification source-unit report required');
  if(!sameSet(report.engines,ENGINES)||!sameSet(report.sampleRates,RATES)||!sameSet(report.executions,EXECUTIONS)||!sameSet(report.roles,ROLES)||!sameSet(report.frequencies,FREQUENCIES))fail('the full engine/rate/execution/role/frequency matrix is required');
  if(report.baseline?.path!==WONDERSWAN_CALIBRATION_BASELINE_PATH||report.baseline.sha256!==WONDERSWAN_CALIBRATION_BASELINE_SHA256||report.baseline.rows!==153||
    report.baseline.targetAmplitude!==TARGET||report.baseline.referenceAmplitude!==REFERENCE)fail('historical baseline identity or unchanged target mismatch');
  validateProvenance(report);
  if(!Array.isArray(report.rows)||report.rows.length!==48||!Array.isArray(report.anchors)||report.anchors.length!==8)fail('exactly 48 WonderSwan and eight FM anchor captures are required');
  const captures=new Map(),anomalies=[];
  for(const row of [...report.rows,...report.anchors]){
    const wonderswan=row?.kind==='wonderswan',role=wonderswan?row.role:'primary',mode=wonderswan&&role==='primary'?'wonderswan':'genesis',sourceId=wonderswan&&role==='primary'?'wonderswan':wonderswan?'calibration-source':'ym2612';
    if(!row||!ENGINES.includes(row.engine)||!RATES.includes(row.requestedSampleRate)||row.actualSampleRate!==row.requestedSampleRate||!EXECUTIONS.includes(row.execution)||
      !(wonderswan?ROLES.includes(role)&&FREQUENCIES.includes(row.frequencyHz):row.kind==='ym2612'&&row.role==='primary'&&row.frequencyHz===440)||row.mode!==mode||row.sourceId!==sourceId||
      row.waveform!=='sine'||typeof row.browserVersion!=='string'||!row.browserVersion||!digest(row.sourceSha256)||captures.has(key(row)))fail('unknown, duplicate or incorrectly named capture route');
    if(wonderswan!==report.rows.includes(row))fail('WonderSwan and FM anchor capture inventories are mixed');
    const reference=wonderswan?buildWonderSwanCalibrationReference(row.frequencyHz,{role}):null;
    if(!finite(row.expectedFrequencyHz)||!close(row.expectedFrequencyHz,reference?.effectiveFrequencyHz??440)||row.referencePeak!==(wonderswan?HEADROOM:1)||
      (wonderswan?!same(row.decodedReference,reference.decodedReference):row.decodedReference!==null))fail('reference tuning or codec headroom mismatch: '+key(row));
    const setup=reference?.setup??buildFmCalibrationReference('ym2612',440).setup.replace(/createSoundChip\(\s*(['"])ym2612\1\s*,\s*\{id:\s*'calibration-source'\}\s*\)/,"useSoundChip('ym2612')");
    const program=setup+`\nawait mixer.set(${JSON.stringify(sourceId)},{pan:0,muted:false,solo:true,volume:1});\nlog('WONDERSWAN_CALIBRATION_READY');`;
    if(row.sourceSha256!==sha(program))fail('executed source does not match the original unity reference program: '+key(row));
    const settings=row.mixer?.settings;
    if(row.mixer?.id!==sourceId||row.mixer.entry?.id!==sourceId||row.mixer.entry.connected!==true||settings?.volume!==1||settings.pan!==0||settings.muted!==false||settings.solo!==true)fail('unity centered unmuted solo connected Mixer source required: '+key(row));
    validateCapture(row.pcm,row,false);validateCapture(row.stopped,row,true);
    const amplitude=Math.max(...row.pcm.channels.map(channel=>channel.halfPeakToPeak));
    if(!positive(row.measuredAmplitude)||!positive(row.amplitude)||!close(row.measuredAmplitude,amplitude)||!close(row.amplitude,amplitude/row.referencePeak))fail('reference peak must normalize the measured PCM exactly once: '+key(row));
    // Historical Genesis measured the old internal0.9 trim. Source-unit
    // captures expose that exact output before the trim, so retain the anchor
    // as an independent unit check without changing the shared target.
    if(wonderswan&&Math.abs(row.amplitude/reference.decodedReference.expectedSpeakerAmplitude-1)>=.025)fail('WonderSwan reference differs from the full-scale centered DAC output unit: '+key(row));
    if(!wonderswan&&Math.abs(row.amplitude/(REFERENCE/.9)-1)>=.025)fail('FM anchor differs from the historical YM2612 source output unit: '+key(row));
    captures.set(key(row),row);
    for(const label of ['pcm','stopped'])if(!row[label].clock.continuous)anomalies.push({engine:row.engine,sampleRate:row.actualSampleRate,execution:row.execution,role:row.role,kind:row.kind,frequencyHz:row.frequencyHz,capture:label,clock:row[label].clock});
  }
  if(!Array.isArray(report.clockAnomalies)||!same(report.clockAnomalies,anomalies))fail('clock diagnostic anomalies must be retained exactly');
  for(const engine of ENGINES)for(const requestedSampleRate of RATES)for(const execution of EXECUTIONS){
    if(!captures.has(key({engine,requestedSampleRate,execution,role:'primary',kind:'ym2612',frequencyHz:440})))fail('missing FM anchor matrix route');
    for(const role of ROLES)for(const frequencyHz of FREQUENCIES)if(!captures.has(key({engine,requestedSampleRate,execution,role,kind:'wonderswan',frequencyHz})))fail('missing WonderSwan matrix route');
  }
  const calibration=report.calibration;
  if(!calibration||calibration.referenceAmplitude!==REFERENCE||calibration.targetAmplitude!==TARGET||calibration.maxGain!==2||calibration.targetChanged!==false||
    !Array.isArray(calibration.routes)||calibration.routes.length!==2)fail('unchanged common target and two explicit WonderSwan gains required');
  const volumes={},seen=new Set();
  for(const route of calibration.routes){
    const role=route?.role;if(!ROLES.includes(role)||seen.has(role))fail('unknown or duplicate calibrated WonderSwan role');seen.add(role);
    const reference=captures.get(key({engine:'chromium',requestedSampleRate:48000,execution:'main',role,kind:'wonderswan',frequencyHz:440}));
    const expected=Number((TARGET/reference.amplitude).toFixed(6));
    if(route.kind!=='wonderswan'||route.mode!==(role==='primary'?'wonderswan':'genesis')||route.name!==(role==='primary'?'wonderswan':'calibration-source')||
      !close(route.amplitude,reference.amplitude)||!same(route.reference,{engine:'chromium',sampleRate:48000,execution:'main',frequencyHz:440})||
      !positive(route.volume)||route.volume>2||expected>2||route.volume!==expected)fail('gain must be the unclamped six-decimal canonical 440Hz ratio: '+role);
    volumes[role]=route.volume;
  }
  return {primaryVolume:volumes.primary,extraVolume:volumes.extra,metadata:{version:1,gainUnits:'source',referenceFrequencyHz:440,targetAmplitude:TARGET,referenceAmplitude:REFERENCE,codecHeadroom:HEADROOM,
    measuredWonderSwanCaptures:48,measuredAnchorCaptures:8,canonical:{engine:'chromium',sampleRate:48000,execution:'main'},baselineSha256:WONDERSWAN_CALIBRATION_BASELINE_SHA256}};
}

/** Check every raw script/runtime/WASM hash before a generator writes output.
 * The untouched report retains all original raw hashes. Only two exact UI
 * import version values may use the independently pinned cache-token receipt;
 * executable changes and every DSP/transport/WASM source still require capture.
 */
export async function validateWonderSwanMixerCalibrationSources({reportPath,wsReport}){
  const bytes=await readFile(reportPath);
  if(sha(bytes)!==WONDERSWAN_CALIBRATION_BASELINE_SHA256||wsReport?.baseline?.sha256!==sha(bytes))fail('historical baseline raw SHA changed; do not regenerate from edited history');
  const result=validateWonderSwanMixerCalibration(JSON.parse(bytes),wsReport);
  for(const [path,hash]of Object.entries(wsReport.scripts)){
    const absolute=resolve(root,path);if(!absolute.startsWith(resolve(root)+sep))fail('script path escapes repository');
    if(sha(await readFile(absolute))!==hash)fail('script source changed; remeasure: '+path);
  }
  let uiReceipt,measuredReportSha256;
  for(const [path,record]of Object.entries(wsReport.sources)){
    const bytes=await readFile(resolve(root,'docs',path));
    if((bytes.length!==record.bytes||sha(bytes)!==record.sha256)&&MIXER_CALIBRATION_UI_CACHE_PATHS.includes(path)&&uiReceipt===undefined){
      uiReceipt=JSON.parse(await readFile(resolve(root,'docs/issues/wonderswan_chip_levels_ui_receipt_01.json'),'utf8'));
      measuredReportSha256=sha(await readFile(resolve(root,'docs/issues/wonderswan_chip_levels_01.json')));
      if(measuredReportSha256!==WONDERSWAN_CALIBRATION_REPORT_SHA256)fail('original WonderSwan report raw SHA changed; do not rewrite measurement evidence');
    }
    assertMixerCalibrationSourceFreshness({path,bytes,record,report:wsReport,reportSha256:measuredReportSha256,
      receipt:uiReceipt,receiptObjectSha256:WONDERSWAN_CALIBRATION_UI_RECEIPT_OBJECT_SHA256});
  }
  return result;
}
