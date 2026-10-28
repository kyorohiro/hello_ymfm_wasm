/** POKEY-only extension: match one held square to the live Sega PSG square
 * at its unchanged System gain. Preserve the153 original sine measurements,
 * their target, every other chip gain, and the existing raw/speaker DSP.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPokeyCalibrationReference,buildPokeyPsgBalanceReference} from './soundchip_calibration_pokey.mjs';
import {buildFmCalibrationReference} from './soundchip_calibration_fm.mjs';
import {assertMixerCalibrationSourceFreshness,assertMixerCalibrationPs1AdsrUiFreshness,readMixerCalibrationPs1AdsrUiReceipt,MIXER_CALIBRATION_UI_CACHE_PATHS,MIXER_CALIBRATION_PS1_ADSR_UI_PATHS} from './mixer_calibration_sources.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const POKEY_CALIBRATION_BASELINE_PATH='docs/issues/playground_chip_levels_01.json';
export const POKEY_CALIBRATION_BASELINE_SHA256='9c5129ad176aa4895ff14da345dc0f3ac49588f5255062fa76329b21f28ea234';
export const POKEY_CALIBRATION_UI_RECEIPT_OBJECT_SHA256='945187a8c493ead6553f6873584d0ca02f11ca4c62e94f412990b38d27d2cd2d';
const BASELINE_OBJECT_SHA256='50eff6f2cdcd77ab4d41fa43b0afe4a9e4a5d02f5dee06dc67467e3bbeb17c48';
const TARGET=0.12881777435541153,REFERENCE=0.1494140625,PSG_GAIN=.35;
const ENGINES=['chromium','webkit'],RATES=[44100,48000],EXECUTIONS=['main','worker'],ROLES=['primary','dual-first','dual-second','extra'],FREQUENCIES=[220,440,880];
const CANONICAL={engine:'chromium',sampleRate:48000,execution:'main',frequencyHz:440};
export const POKEY_CALIBRATION_REQUIRED_SCRIPTS=Object.freeze([
  'scripts/calibrate_pokey_levels.cjs','scripts/soundchip_calibration_pokey.mjs',
  'scripts/soundchip_calibration_fm.mjs','scripts/audio_clock_audit.cjs',POKEY_CALIBRATION_BASELINE_PATH,
]);
export const POKEY_CALIBRATION_REQUIRED_SOURCES=Object.freeze([
  'playground/index.html','playground/playground.js',
  'js/playground_runtime.js','js/soundchip_mixer.js','js/chip_worklet_transport.js',
  'js/playground_pokey_audio.js','js/playground_pokey_worklet.js','js/playground_pokey.js',
  'js/pokey.js','js/pokeysynth.js','js/pokeyaudioengine.js','js/playground_pokey_inspector.js',
  'js/playground_logic_worker.js','js/playground_worker_chip.js','js/playground_chip_clock.js',
  'js/playground_performance_sender.js','js/playground_performance_processor.js','js/playground_performance_queue.js',
  'generated/pokey_wasm.js','generated/pokey_wasm.wasm',
  'js/ym2612.js','js/ym2612-worklet.js','js/ym2612synth.js','generated/ym2612_wasm.js','generated/ym2612_wasm.wasm',
  'js/segapsg.js','js/segapsgsynth.js','generated/segapsg_wasm.js','generated/segapsg_wasm.wasm',
]);
const EXCLUSIONS=['playground/playground_mixer_defaults.js','js/soundchip_mixer_presets.js'];
const fail=message=>{throw new Error('Invalid POKEY Mixer calibration: '+message);};
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

function provenance(report){
  if(!report.scripts||typeof report.scripts!=='object'||Array.isArray(report.scripts)||POKEY_CALIBRATION_REQUIRED_SCRIPTS.some(path=>!digest(report.scripts[path])))fail('missing required runner/reference/pilot/baseline provenance');
  if(report.scripts[POKEY_CALIBRATION_BASELINE_PATH]!==POKEY_CALIBRATION_BASELINE_SHA256)fail('historical baseline SHA does not match');
  for(const [path,hash]of Object.entries(report.scripts))if(!pathSafe(path)||!digest(hash))fail('invalid script hash or path');
  if(!report.sources||typeof report.sources!=='object'||Array.isArray(report.sources)||POKEY_CALIBRATION_REQUIRED_SOURCES.some(path=>!report.sources[path]))fail('missing required POKEY, FM, PSG, Worker or WASM source provenance');
  for(const [path,record]of Object.entries(report.sources))if(!pathSafe(path)||!record||!Number.isSafeInteger(record.bytes)||record.bytes<=0||!digest(record.sha256))fail('invalid served source hash, bytes or path');
  if(!sameSet(report.sourceHashExclusions,EXCLUSIONS)||EXCLUSIONS.some(path=>Object.hasOwn(report.sources,path)))fail('generated policy hashes must be excluded to avoid a calibration cycle');
}
function settings(mixer,id,pan=0){
  const s=mixer?.settings;
  if(mixer?.id!==id||mixer.entry?.id!==id||mixer.entry.connected!==true||s?.volume!==1||s.pan!==pan||s.muted!==false||s.solo!==true)fail('connected source-unity Mixer with explicit pan, mute and solo is required: '+id);
}
function capture(pcm,row,{stopped=false,pitches=[row.expectedFrequencyHz,row.expectedFrequencyHz],square=false}={}){
  const label=key(row)+(stopped?'/Stop':'/PCM'),rate=row.actualSampleRate;
  const frames=Math.ceil(rate*(stopped?.15:1)/128)*128,warmupFrames=Math.ceil(rate*(stopped?.25:1)/128)*128,total=frames+warmupFrames;
  if(!pcm||pcm.sampleRate!==rate||pcm.frames!==frames||pcm.warmupFrames!==warmupFrames||pcm.capturedFrames!==total||pcm.inputFrames!==total)fail('missing or unaccounted captured PCM: '+label);
  if(pcm.physicalOutputMuted!==true||!Array.isArray(pcm.processorErrors)||pcm.processorErrors.length||pcm.tap!=='audio.masterInputNode (after source Mixer, before FX/master/listening)')fail('wrong, unmuted or failed processor tap: '+label);
  const p=pcm.pilot;
  if(!p||p.continuous!==true||p.complete!==true||p.period!==2**24||p.frames!==total||p.expectedFrames!==total||p.receivedFrames!==total||p.nonFinite!==0||p.invalidSamples!==0||p.sampleGapCount!==0||!Array.isArray(p.sampleGaps)||p.sampleGaps.length)fail('incomplete or damaged independent pilot: '+label);
  const first=p.firstSample*p.period,last=p.lastSample*p.period;
  if(!integer(first)||first>=p.period||!integer(last)||last>=p.period||last!==(first+total-1)%p.period||p.zeroSamples!==Number(first===0||first+total>p.period))fail('pilot endpoints do not account for every frame: '+label);
  const c=pcm.clock;
  if(!c||c.measurementValid!==true||c.frames!==total||c.rowCount!==total/128||!integer(c.firstFrame)||!integer(c.lastFrame)||c.malformedRowCount!==0||!Array.isArray(c.malformedRows)||c.malformedRows.length||
    !integer(c.gapCount)||c.gapCount>=c.rowCount||!integer(c.unstableReadCount)||c.unstableReadCount>c.rowCount||!Array.isArray(c.gaps)||c.gaps.length!==Math.min(32,c.gapCount)||
    !Array.isArray(c.unstableReads)||c.unstableReads.length!==Math.min(32,c.unstableReadCount)||c.continuous!==(c.gapCount===0&&c.unstableReadCount===0)||(c.continuous&&c.lastFrame!==c.firstFrame+total-128))fail('invalid clock accounting or hidden diagnostic anomaly: '+label);
  if(!Array.isArray(pcm.channels)||pcm.channels.length!==2)fail('two PCM channel statistics required: '+label);
  for(const [index,ch]of pcm.channels.entries()){
    if(!ch||!['minimum','maximum','halfPeakToPeak','peak','dc','rms','acRms','estimatedFrequencyHz','firstHalfAcRms','secondHalfAcRms'].every(name=>finite(ch[name]))||ch.minimum>ch.maximum||ch.minimum< -1||ch.maximum>1||ch.rms<0||ch.acRms<0||ch.firstHalfAcRms<0||ch.secondHalfAcRms<0||
      ch.nonfinite!==0||ch.overrange!==0||!integer(ch.nonzero)||ch.nonzero>frames||!digest(ch.sha256))fail('invalid or clipped PCM: '+label);
    if(!close(ch.halfPeakToPeak,(ch.maximum-ch.minimum)/2)||!close(ch.peak,Math.max(Math.abs(ch.minimum),Math.abs(ch.maximum)))||!close(ch.acRms**2,Math.max(0,ch.rms**2-ch.dc**2))||ch.dc<ch.minimum||ch.dc>ch.maximum||ch.rms>ch.peak+1e-10)fail('inconsistent PCM metrics: '+label);
    if(stopped){
      if(['minimum','maximum','halfPeakToPeak','peak','dc','rms','acRms','nonzero','estimatedFrequencyHz','firstHalfAcRms','secondHalfAcRms'].some(name=>ch[name]!==0)||ch.sha256!==sha(Buffer.alloc(frames*4)))fail('Stop did not yield exact zero PCM: '+label);
    }else{
      if(ch.minimum>=0||ch.maximum<=0||!positive(ch.halfPeakToPeak)||!positive(ch.acRms)||ch.nonzero<frames*.9||Math.abs(ch.dc)>=ch.peak*.02||!positive(ch.firstHalfAcRms)||!positive(ch.secondHalfAcRms)||Math.abs(ch.firstHalfAcRms/ch.secondHalfAcRms-1)>=.01)fail('silent, DC-offset or unsteady held reference: '+label);
      if(pitches[index]!==null&&Math.abs(ch.estimatedFrequencyHz-pitches[index])>=Math.max(2,pitches[index]*.015))fail('mistuned reference PCM: '+label);
      if(square&&(ch.nonzero<=frames*.99||ch.acRms/ch.halfPeakToPeak<=.90||ch.acRms/ch.halfPeakToPeak>=1.01))fail('held square shape was replaced or only partially scheduled: '+label);
    }
  }
}
function unityProgram(reference){
  const before=reference.kind==='segapsg'?`\ncontext.calibrationPsgListeningSettings=await mixer.get('segapsg');\nif(context.calibrationPsgListeningSettings.volume!==${PSG_GAIN})throw Error('Sega PSG System listening gain changed');`:'';
  return reference.setup+before+`\nawait mixer.set(${JSON.stringify(reference.sourceId)},{pan:0,muted:false,solo:true,volume:1});\nlog('POKEY_CALIBRATION_READY');`;
}
function dualProgram(references,phase){
  return references.map((reference,index)=>`{\n${reference.setup}\n}\nawait mixer.set(${JSON.stringify(reference.sourceId)},{pan:${phase==='split'?[-1,1][index]:0},muted:false,solo:true,volume:1});`).join('\n')+"\nlog('POKEY_DUAL_CALIBRATION_READY');";
}

export function validatePokeyMixerCalibration(historical,report){
  if(!historical||historical.schemaVersion!==1||historical.passed!==true||historical.verify!==false||historical.rows?.length!==153||historical.calibration?.targetAmplitude!==TARGET||historical.calibration?.referenceAmplitude!==REFERENCE||sha(JSON.stringify(historical))!==BASELINE_OBJECT_SHA256)fail('the original complete153-capture historical baseline is required');
  if(!report||report.schemaVersion!==1||report.passed!==true||report.verify!==false||report.completeCoverage!==true||report.gainUnits!=='source'||report.referenceFrequencyHz!==440||report.physicalOutputMuted!==true||report.listeningPerformed!==false||report.pcmContinuous!==true||report.continuityOracle!=='independent-24-bit-pilot-PCM')fail('successful complete non-verification source-unit report required');
  if(!sameSet(report.engines,ENGINES)||!sameSet(report.sampleRates,RATES)||!sameSet(report.executions,EXECUTIONS)||!sameSet(report.roles,ROLES)||!sameSet(report.frequencies,FREQUENCIES))fail('the full engine/rate/execution/role/frequency matrix is required');
  if(report.baseline?.path!==POKEY_CALIBRATION_BASELINE_PATH||report.baseline.sha256!==POKEY_CALIBRATION_BASELINE_SHA256||report.baseline.rows!==153||report.baseline.targetAmplitude!==TARGET||report.baseline.referenceAmplitude!==REFERENCE)fail('historical baseline identity or unchanged target mismatch');
  provenance(report);
  if(!Array.isArray(report.rows)||report.rows.length!==96||!Array.isArray(report.anchors)||report.anchors.length!==8||!Array.isArray(report.psgAnchors)||report.psgAnchors.length!==8||!Array.isArray(report.dualChecks)||report.dualChecks.length!==8)fail('exactly96 POKEY, eight FM, eight live PSG and eight dual combination cases are required');
  const captures=new Map(),anomalies=[];
  const recordAnomalies=(row,list)=>{for(const [label,pcm]of list)if(!pcm.clock.continuous)anomalies.push({engine:row.engine,sampleRate:row.actualSampleRate,execution:row.execution,role:row.role,kind:row.kind,frequencyHz:row.frequencyHz,capture:label,clock:pcm.clock});};
  for(const [inventory,kind]of [[report.rows,'pokey'],[report.anchors,'ym2612'],[report.psgAnchors,'segapsg']])for(const row of inventory){
    const pokey=kind==='pokey',psg=kind==='segapsg';
    if(!row||row.kind!==kind||!ENGINES.includes(row.engine)||!RATES.includes(row.requestedSampleRate)||row.actualSampleRate!==row.requestedSampleRate||!EXECUTIONS.includes(row.execution)||!(pokey?ROLES.includes(row.role)&&FREQUENCIES.includes(row.frequencyHz):row.role==='primary'&&row.frequencyHz===440)||typeof row.browserVersion!=='string'||!row.browserVersion||captures.has(key(row)))fail('unknown, duplicate or incorrectly inventoried source capture');
    let reference;
    if(pokey)reference=buildPokeyCalibrationReference(row.frequencyHz,{role:row.role});
    else if(psg)reference=buildPokeyPsgBalanceReference();
    else {const fm=buildFmCalibrationReference('ym2612',440);reference={...fm,mode:'genesis',sourceId:'ym2612',waveform:'sine',setup:fm.setup.replace(/createSoundChip\(\s*(['"])ym2612\1\s*,\s*\{id:\s*'calibration-source'\}\s*\)/,"useSoundChip('ym2612')")};}
    if(row.mode!==reference.mode||row.sourceId!==reference.sourceId||row.waveform!==reference.waveform||row.referencePeak!==1||!same(row.decodedReference,reference.decodedReference??null)||!close(row.expectedFrequencyHz,reference.effectiveFrequencyHz??440))fail('reference clock, role, waveform, routing or headroom mismatch: '+key(row));
    const source=unityProgram(reference);if(row.source!==source||row.sourceSha256!==sha(source))fail('executed source does not match the original unity reference: '+key(row));
    settings(row.mixer,row.sourceId);capture(row.pcm,row,{square:pokey||psg});capture(row.stopped,row,{stopped:true});
    const amplitude=Math.max(...row.pcm.channels.map(ch=>ch.halfPeakToPeak)),acRms=Math.max(...row.pcm.channels.map(ch=>ch.acRms));
    if(!close(row.measuredAmplitude,amplitude)||!close(row.amplitude,amplitude)||!close(row.acRms,acRms))fail('amplitude or square AC RMS detached from measured PCM: '+key(row));
    if(!same(row.pcm.channels[0],row.pcm.channels[1]))fail('one centered mono reference must have identical left/right PCM and metrics: '+key(row));
    if(pokey){
      const nominal=reference.decodedReference.nominalCenteredAmplitude;
      if(acRms/nominal<.95||acRms/nominal>1.02||amplitude/nominal<.99||amplitude/nominal>1.12)fail('POKEY output differs from its unchanged raw DAC and10Hz speaker units: '+key(row));
    }else if(psg){
      const listening=row.listeningReference,original=listening?.originalMixerSettings;
      if(listening?.gain!==PSG_GAIN||listening.measurementMetric!=='acRms'||!close(listening.acRms,acRms*PSG_GAIN)||original?.volume!==PSG_GAIN||original.pan!==0||original.muted!==false||original.solo!==false)fail('live PSG anchor must record the actual unchanged System setting before unity capture: '+key(row));
      // The unchanged Genesis PSG source at attenuation0 spans +/-0.2.
      // Resampling slightly lowers square AC RMS; it cannot justify an
      // arbitrary anchor scale or a hidden second application of0.35.
      if(Math.abs(amplitude/.2-1)>=.025||Math.abs(acRms/.2-1)>=.025)fail('live PSG anchor differs from its unchanged source-unity square output unit: '+key(row));
    }else if(Math.abs(amplitude/(REFERENCE/.9)-1)>=.025)fail('FM anchor differs from the historical YM2612 source output unit: '+key(row));
    captures.set(key(row),row);recordAnomalies(row,[['pcm',row.pcm],['stopped',row.stopped]]);
  }
  const dualKeys=new Set();
  for(const row of report.dualChecks){
    const routeKey=`${row?.engine}/${row?.requestedSampleRate}/${row?.execution}`;
    if(!row||!ENGINES.includes(row.engine)||!RATES.includes(row.requestedSampleRate)||row.actualSampleRate!==row.requestedSampleRate||!EXECUTIONS.includes(row.execution)||row.role!=='dual-pair'||row.mode!=='pokey-dual'||row.kind!=='pokey'||typeof row.browserVersion!=='string'||!row.browserVersion||dualKeys.has(routeKey))fail('unknown or duplicate dual combination case');
    dualKeys.add(routeKey);
    const references=[buildPokeyCalibrationReference(440,{role:'dual-first'}),buildPokeyCalibrationReference(880,{role:'dual-second'})];
    if(!same(row.sources,references.map(ref=>({role:ref.role,id:ref.sourceId,frequencyHz:ref.frequencyHz,expectedFrequencyHz:ref.effectiveFrequencyHz}))))fail('dual sources must remain distinct physical chip identities and frequencies');
    const isolated=references.map(ref=>captures.get(key({engine:row.engine,requestedSampleRate:row.requestedSampleRate,execution:row.execution,role:ref.role,kind:'pokey',frequencyHz:ref.frequencyHz})));
    if(isolated.some(ref=>!ref))fail('missing isolated dual source reference');
    for(const phase of ['split','sum']){
      const part=row[phase],source=dualProgram(references,phase);
      if(!part||part.source!==source||part.sourceSha256!==sha(source)||!Array.isArray(part.mixers)||part.mixers.length!==2)fail('dual executed source, Mixer inventory or source hash mismatch');
      for(let index=0;index<2;index++)settings(part.mixers[index],references[index].sourceId,phase==='split'?[-1,1][index]:0);
      capture(part.pcm,row,{pitches:phase==='split'?references.map(ref=>ref.effectiveFrequencyHz):[null,null],square:phase==='split'});
      const expected=phase==='split'?isolated.map((ref,index)=>ref.pcm.channels[index].acRms):[0,1].map(index=>Math.hypot(...isolated.map(ref=>ref.pcm.channels[index].acRms)));
      if(!Array.isArray(part.expectedRms)||part.expectedRms.length!==2||!Array.isArray(part.rmsRelativeErrors)||part.rmsRelativeErrors.length!==2)fail('dual per-channel expected RMS and errors are required');
      for(let index=0;index<2;index++){
        const error=Math.abs(part.pcm.channels[index].acRms/expected[index]-1);
        if(!close(part.expectedRms[index],expected[index])||!close(part.rmsRelativeErrors[index],error)||error>=.025)fail('dual sum/split must preserve each independent source without normalization');
      }
      if(phase==='sum'&&!same(part.pcm.channels[0],part.pcm.channels[1]))fail('centered dual sum must have identical stereo PCM and metrics');
    }
    capture(row.stopped,row,{stopped:true});recordAnomalies(row,[['split',row.split.pcm],['sum',row.sum.pcm],['stopped',row.stopped]]);
  }
  if(!Array.isArray(report.clockAnomalies)||!same(report.clockAnomalies,anomalies))fail('clock diagnostic anomalies must be retained exactly');
  for(const engine of ENGINES)for(const requestedSampleRate of RATES)for(const execution of EXECUTIONS){
    if(!dualKeys.has(`${engine}/${requestedSampleRate}/${execution}`))fail('missing dual combination matrix route');
    for(const kind of ['ym2612','segapsg'])if(!captures.has(key({engine,requestedSampleRate,execution,role:'primary',kind,frequencyHz:440})))fail('missing FM/PSG anchor matrix route');
    for(const role of ROLES)for(const frequencyHz of FREQUENCIES)if(!captures.has(key({engine,requestedSampleRate,execution,role,kind:'pokey',frequencyHz})))fail('missing POKEY source matrix route');
  }
  const canonical=role=>captures.get(key({engine:CANONICAL.engine,requestedSampleRate:CANONICAL.sampleRate,execution:CANONICAL.execution,role,kind:'pokey',frequencyHz:440}));
  const anchor=captures.get(key({engine:CANONICAL.engine,requestedSampleRate:CANONICAL.sampleRate,execution:CANONICAL.execution,role:'primary',kind:'segapsg',frequencyHz:440}));
  for(const row of report.psgAnchors)if(Math.abs(row.acRms/anchor.acRms-1)>=.025)fail('live PSG anchors disagree across engine, host rate or execution mode');
  const targetAcRms=anchor.acRms*PSG_GAIN,c=report.calibration,listen=c?.listeningReference;
  if(!c||c.referenceAmplitude!==REFERENCE||c.targetAmplitude!==TARGET||c.measurementMetric!=='acRms'||!positive(targetAcRms)||!close(c.targetAcRms,targetAcRms)||c.maxGain!==2||c.targetChanged!==false||!Array.isArray(c.routes)||c.routes.length!==4)fail('unchanged historical target and four square-family AC RMS gains are required');
  if(listen?.kind!=='segapsg'||listen.mode!=='genesis'||listen.name!=='segapsg'||listen.gain!==PSG_GAIN||!close(listen.rawAcRms,anchor.acRms)||!close(listen.targetAcRms,targetAcRms)||!same(listen.reference,CANONICAL))fail('square target must come from the canonical live PSG anchor and unchanged System gain');
  const volumes={},seen=new Set();
  for(const route of c.routes){
    const role=route?.role;if(!ROLES.includes(role)||seen.has(role))fail('unknown or duplicated calibrated POKEY role');seen.add(role);
    const row=canonical(role),expected=Number((targetAcRms/row.acRms).toFixed(6));
    if(route.kind!=='pokey'||route.mode!==row.mode||route.name!==row.sourceId||route.measurementMetric!=='acRms'||!close(route.rawAcRms,row.acRms)||!close(route.amplitude,row.amplitude)||!same(route.reference,CANONICAL)||!positive(route.volume)||route.volume>2||expected>2||route.volume!==expected)fail('gain must be the unclamped six-decimal canonical live-square AC RMS ratio: '+role);
    volumes[role]=route.volume;
  }
  return {primaryVolume:volumes.primary,extraVolume:volumes.extra,dualFirstVolume:volumes['dual-first'],dualSecondVolume:volumes['dual-second'],metadata:{version:1,gainUnits:'source',referenceFrequencyHz:440,measurementMetric:'acRms',waveform:'square',targetAcRms,
    targetAmplitude:TARGET,referenceAmplitude:REFERENCE,codecHeadroom:1,measuredPokeyCaptures:96,measuredAnchorCaptures:8,measuredPsgCaptures:8,measuredDualCases:8,measuredDualCaptures:16,
    listeningReference:{kind:'segapsg',gain:PSG_GAIN,rawAcRms:anchor.acRms},canonical:{engine:'chromium',sampleRate:48000,execution:'main'},baselineSha256:POKEY_CALIBRATION_BASELINE_SHA256}};
}

/** Every DSP/WASM and runner/reference hash must still match before a generator
 * writes policy. The two UI files permit only their exact receipt-pinned cache
 * tokens to change, or the separate exact PS1 ADSR UI revision audit.
 * Original measurement hashes and evidence stay immutable.
 */
export async function validatePokeyMixerCalibrationSources({reportPath,pokeyReport}){
  const bytes=await readFile(reportPath);
  if(sha(bytes)!==POKEY_CALIBRATION_BASELINE_SHA256||pokeyReport?.baseline?.sha256!==sha(bytes))fail('historical baseline raw SHA changed; do not regenerate from edited history');
  const result=validatePokeyMixerCalibration(JSON.parse(bytes),pokeyReport);
  for(const [path,hash]of Object.entries(pokeyReport.scripts)){
    const absolute=resolve(root,path);if(!absolute.startsWith(resolve(root)+sep))fail('script path escapes repository');
    if(sha(await readFile(absolute))!==hash)fail('script source changed; remeasure: '+path);
  }
  let uiReceipt,measuredReportSha256,uiRevision;
  for(const [path,record]of Object.entries(pokeyReport.sources)){
    const bytes=await readFile(resolve(root,'docs',path));
    if((bytes.length!==record.bytes||sha(bytes)!==record.sha256)&&MIXER_CALIBRATION_PS1_ADSR_UI_PATHS.includes(path)){
      uiRevision??=await readMixerCalibrationPs1AdsrUiReceipt(root);
      measuredReportSha256??=sha(await readFile(resolve(root,'docs/issues/pokey_chip_levels_01.json')));
      assertMixerCalibrationPs1AdsrUiFreshness({path,bytes,record,report:pokeyReport,reportSha256:measuredReportSha256,...uiRevision});
      continue;
    }
    if((bytes.length!==record.bytes||sha(bytes)!==record.sha256)&&MIXER_CALIBRATION_UI_CACHE_PATHS.includes(path)&&uiReceipt===undefined){
      uiReceipt=JSON.parse(await readFile(resolve(root,'docs/issues/pokey_chip_levels_ui_receipt_01.json'),'utf8'));
      measuredReportSha256=sha(await readFile(resolve(root,'docs/issues/pokey_chip_levels_01.json')));
    }
    assertMixerCalibrationSourceFreshness({path,bytes,record,report:pokeyReport,reportSha256:measuredReportSha256,
      receipt:uiReceipt,receiptObjectSha256:POKEY_CALIBRATION_UI_RECEIPT_OBJECT_SHA256});
  }
  return result;
}
