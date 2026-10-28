/** Synthetic report construction for generator/validator rejection tests only.
 * This file is not measurement evidence and must never be used as calibration.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {buildPs1CalibrationReference} from '../../scripts/soundchip_calibration_ps1.mjs';
import {buildFmCalibrationReference} from '../../scripts/soundchip_calibration_fm.mjs';
import {PS1_CALIBRATION_BASELINE_PATH,PS1_CALIBRATION_BASELINE_SHA256,PS1_CALIBRATION_REQUIRED_SCRIPTS,PS1_CALIBRATION_REQUIRED_SOURCES} from '../../scripts/ps1_mixer_calibration.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=new URL('../../',import.meta.url);
function capture(rate,amplitude,frequencyHz,{stopped=false}={}){
  const frames=Math.ceil(rate*(stopped ? .15 : 1)/128)*128,warmupFrames=Math.ceil(rate*(stopped ? .25 : 1)/128)*128,total=frames+warmupFrames;
  return {sampleRate:rate,frames,warmupFrames,capturedFrames:total,inputFrames:total,
    pilot:{continuous:true,period:2**24,expectedFrames:total,frames:total,receivedFrames:total,complete:true,nonFinite:0,invalidSamples:0,sampleGapCount:0,sampleGaps:[],zeroSamples:0,firstSample:1/2**24,lastSample:total/2**24},
    clock:{continuous:true,measurementValid:true,rowCount:total/128,firstFrame:0,lastFrame:total-128,frames:total,gapCount:0,gaps:[],unstableReadCount:0,unstableReads:[],malformedRowCount:0,malformedRows:[]},
    channels:[0,1].map(()=>({minimum:-amplitude,maximum:amplitude,halfPeakToPeak:amplitude,peak:amplitude,dc:0,rms:amplitude/Math.sqrt(2),acRms:amplitude/Math.sqrt(2),nonfinite:0,nonzero:stopped?0:frames-1,overrange:0,
      estimatedFrequencyHz:stopped?0:frequencyHz,sha256:sha(Buffer.alloc(frames*4))})),
    tap:'audio.masterInputNode (after source Mixer, before FX/master/listening)',physicalOutputMuted:true,processorErrors:[]};
}
export async function createPs1MixerCalibrationFixture(){
  const historical=JSON.parse(await readFile(new URL(PS1_CALIBRATION_BASELINE_PATH,root),'utf8'));
  const ps1Report={schemaVersion:1,passed:true,verify:false,gainUnits:'source',referenceFrequencyHz:440,engines:['chromium','webkit'],sampleRates:[44100,48000],executions:['main','worker'],roles:['primary','extra'],frequencies:[220,440,880],rows:[],anchors:[],
    baseline:{path:PS1_CALIBRATION_BASELINE_PATH,sha256:PS1_CALIBRATION_BASELINE_SHA256,rows:153,referenceAmplitude:historical.calibration.referenceAmplitude,targetAmplitude:historical.calibration.targetAmplitude},scripts:{},sources:{},
    physicalOutputMuted:true,listeningPerformed:false,continuityOracle:'independent-24-bit-pilot-PCM',completeCoverage:true,pcmContinuous:true,clockAnomalies:[],sourceHashExclusions:['playground/playground_mixer_defaults.js','js/soundchip_mixer_presets.js']};
  for(const path of PS1_CALIBRATION_REQUIRED_SCRIPTS)ps1Report.scripts[path]=sha(await readFile(new URL(path,root)));
  for(const path of PS1_CALIBRATION_REQUIRED_SOURCES){const bytes=await readFile(new URL('docs/'+path,root));ps1Report.sources[path]={bytes:bytes.length,sha256:sha(bytes)};}
  for(const engine of ps1Report.engines)for(const rate of ps1Report.sampleRates)for(const execution of ps1Report.executions)for(const kind of ['ps1','ym2612'])for(const role of kind==='ps1'?ps1Report.roles:['primary'])for(const frequencyHz of kind==='ps1'?ps1Report.frequencies:[440]){
    const reference=kind==='ps1'?buildPs1CalibrationReference(frequencyHz,{role}):buildFmCalibrationReference('ym2612',440);
    const mode=kind==='ps1'&&role==='primary'?'ps1':'genesis',sourceId=kind==='ym2612'?'ym2612':reference.sourceId;
    const setup=kind==='ps1'?reference.setup:reference.setup.replace(/createSoundChip\(\s*(['"])ym2612\1\s*,\s*\{id:\s*'calibration-source'\}\s*\)/,"useSoundChip('ym2612')");
    const program=setup+`\nawait mixer.set(${JSON.stringify(sourceId)},{pan:0,muted:false,solo:true,volume:1});\nlog('PS1_CALIBRATION_READY');`;
    const measuredAmplitude=kind==='ps1'?.8749008178710938:.166015625,referencePeak=kind==='ps1'?.875:1,amplitude=measuredAmplitude/referencePeak;
    const expectedFrequencyHz=reference.effectiveFrequencyHz??frequencyHz;
    const row={engine,browserVersion:'synthetic-fixture-only',requestedSampleRate:rate,actualSampleRate:rate,execution,role,mode,kind,frequencyHz,expectedFrequencyHz,sourceId,sourceSha256:sha(program),waveform:'sine',referencePeak,decodedReference:reference.decodedReference??null,
      mixer:{id:sourceId,entry:{id:sourceId,connected:true},settings:{volume:1,pan:0,muted:false,solo:true}},
      pcm:capture(rate,measuredAmplitude,expectedFrequencyHz),stopped:capture(rate,0,0,{stopped:true}),measuredAmplitude,amplitude};
    ps1Report[kind==='ps1'?'rows':'anchors'].push(row);
  }
  ps1Report.calibration={referenceAmplitude:historical.calibration.referenceAmplitude,targetAmplitude:historical.calibration.targetAmplitude,maxGain:2,targetChanged:false,
    routes:ps1Report.roles.map(role=>{const row=ps1Report.rows.find(row=>row.role===role&&row.engine==='chromium'&&row.requestedSampleRate===48000&&row.execution==='main'&&row.frequencyHz===440);
      return {kind:'ps1',role,mode:role==='primary'?'ps1':'genesis',name:role==='primary'?'ps1':'calibration-source',amplitude:row.amplitude,volume:Number((historical.calibration.targetAmplitude/row.amplitude).toFixed(6)),reference:{engine:'chromium',sampleRate:48000,execution:'main',frequencyHz:440}};})};
  return {historical,ps1Report};
}
