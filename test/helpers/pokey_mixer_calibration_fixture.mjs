/** Synthetic rejection-test fixture only. This is not measurement evidence
 * and must never be used as a release calibration report.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {buildPokeyCalibrationReference,buildPokeyPsgBalanceReference} from '../../scripts/soundchip_calibration_pokey.mjs';
import {buildFmCalibrationReference} from '../../scripts/soundchip_calibration_fm.mjs';
import {POKEY_CALIBRATION_BASELINE_PATH,POKEY_CALIBRATION_BASELINE_SHA256,POKEY_CALIBRATION_REQUIRED_SCRIPTS,POKEY_CALIBRATION_REQUIRED_SOURCES} from '../../scripts/pokey_mixer_calibration.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),root=new URL('../../',import.meta.url);
const roles=['primary','dual-first','dual-second','extra'];
const roleScales={'primary':.996,'dual-first':.998,'dual-second':1,'extra':1.002};
function capture(rate,amplitudes,rmsValues,frequencies,{stopped=false}={}){
  const frames=Math.ceil(rate*(stopped ? .15 : 1)/128)*128,warmupFrames=Math.ceil(rate*(stopped ? .25 : 1)/128)*128,total=frames+warmupFrames;
  return {sampleRate:rate,frames,warmupFrames,capturedFrames:total,inputFrames:total,
    pilot:{continuous:true,period:2**24,expectedFrames:total,frames:total,receivedFrames:total,complete:true,nonFinite:0,invalidSamples:0,sampleGapCount:0,sampleGaps:[],zeroSamples:0,firstSample:1/2**24,lastSample:total/2**24},
    clock:{continuous:true,measurementValid:true,rowCount:total/128,firstFrame:0,lastFrame:total-128,frames:total,gapCount:0,gaps:[],unstableReadCount:0,unstableReads:[],malformedRowCount:0,malformedRows:[]},
    channels:[0,1].map(index=>({minimum:-amplitudes[index],maximum:amplitudes[index],halfPeakToPeak:amplitudes[index],peak:amplitudes[index],dc:0,rms:rmsValues[index],acRms:rmsValues[index],firstHalfAcRms:rmsValues[index],secondHalfAcRms:rmsValues[index],nonfinite:0,nonzero:stopped?0:frames-1,overrange:0,
      estimatedFrequencyHz:stopped?0:frequencies[index],sha256:sha(Buffer.alloc(frames*4))})),
    tap:'audio.masterInputNode (after source Mixer, before FX/master/listening)',physicalOutputMuted:true,processorErrors:[]};
}
const mixer=(id,pan=0)=>({id,entry:{id,connected:true},settings:{volume:1,pan,muted:false,solo:true}});
const silence=rate=>capture(rate,[0,0],[0,0],[0,0],{stopped:true});
export async function createPokeyMixerCalibrationFixture(){
  const historical=JSON.parse(await readFile(new URL(POKEY_CALIBRATION_BASELINE_PATH,root),'utf8'));
  const pokeyReport={schemaVersion:1,passed:true,verify:false,gainUnits:'source',referenceFrequencyHz:440,engines:['chromium','webkit'],sampleRates:[44100,48000],executions:['main','worker'],roles,frequencies:[220,440,880],rows:[],anchors:[],psgAnchors:[],dualChecks:[],
    baseline:{path:POKEY_CALIBRATION_BASELINE_PATH,sha256:POKEY_CALIBRATION_BASELINE_SHA256,rows:153,referenceAmplitude:historical.calibration.referenceAmplitude,targetAmplitude:historical.calibration.targetAmplitude},scripts:{},sources:{},
    physicalOutputMuted:true,listeningPerformed:false,continuityOracle:'independent-24-bit-pilot-PCM',completeCoverage:true,pcmContinuous:true,clockAnomalies:[],sourceHashExclusions:['playground/playground_mixer_defaults.js','js/soundchip_mixer_presets.js']};
  for(const path of POKEY_CALIBRATION_REQUIRED_SCRIPTS)pokeyReport.scripts[path]=sha(await readFile(new URL(path,root)));
  for(const path of POKEY_CALIBRATION_REQUIRED_SOURCES){const bytes=await readFile(new URL('docs/'+path,root));pokeyReport.sources[path]={bytes:bytes.length,sha256:sha(bytes)};}
  for(const engine of pokeyReport.engines)for(const rate of pokeyReport.sampleRates)for(const execution of pokeyReport.executions)for(const kind of ['pokey','ym2612','segapsg'])for(const role of kind==='pokey'?roles:['primary'])for(const frequencyHz of kind==='pokey'?pokeyReport.frequencies:[440]){
    let reference;
    if(kind==='pokey')reference=buildPokeyCalibrationReference(frequencyHz,{role});
    else if(kind==='segapsg')reference=buildPokeyPsgBalanceReference();
    else{const fm=buildFmCalibrationReference('ym2612',440);reference={...fm,mode:'genesis',sourceId:'ym2612',waveform:'sine',setup:fm.setup.replace(/createSoundChip\(\s*(['"])ym2612\1\s*,\s*\{id:\s*'calibration-source'\}\s*\)/,"useSoundChip('ym2612')")};}
    const before=kind==='segapsg'?"\ncontext.calibrationPsgListeningSettings=await mixer.get('segapsg');\nif(context.calibrationPsgListeningSettings.volume!==0.35)throw Error('Sega PSG System listening gain changed');":'';
    const source=reference.setup+before+`\nawait mixer.set(${JSON.stringify(reference.sourceId)},{pan:0,muted:false,solo:true,volume:1});\nlog('POKEY_CALIBRATION_READY');`;
    const measuredAmplitude=kind==='pokey'?({220:.182,440:.176,880:.173}[frequencyHz])*roleScales[role]:kind==='segapsg'?.2:.166015625;
    const acRms=kind==='pokey'?.169*roleScales[role]:kind==='segapsg'?.199:measuredAmplitude*Math.SQRT1_2;
    const expectedFrequencyHz=reference.effectiveFrequencyHz??440;
    const row={engine,browserVersion:'synthetic-fixture-only',requestedSampleRate:rate,actualSampleRate:rate,execution,role,mode:reference.mode,kind,frequencyHz,expectedFrequencyHz,sourceId:reference.sourceId,source,sourceSha256:sha(source),waveform:reference.waveform??'sine',referencePeak:1,decodedReference:reference.decodedReference??null,
      mixer:mixer(reference.sourceId),pcm:capture(rate,[measuredAmplitude,measuredAmplitude],[acRms,acRms],[expectedFrequencyHz,expectedFrequencyHz]),stopped:silence(rate),measuredAmplitude,amplitude:measuredAmplitude,acRms};
    if(kind==='segapsg')row.listeningReference={gain:.35,originalMixerSettings:{volume:.35,pan:0,muted:false,solo:false},policy:'Existing System Sega PSG listening gain',measurementMetric:'acRms',acRms:acRms*.35};
    pokeyReport[kind==='pokey'?'rows':kind==='segapsg'?'psgAnchors':'anchors'].push(row);
  }
  for(const engine of pokeyReport.engines)for(const rate of pokeyReport.sampleRates)for(const execution of pokeyReport.executions){
    const references=[buildPokeyCalibrationReference(440,{role:'dual-first'}),buildPokeyCalibrationReference(880,{role:'dual-second'})];
    const isolated=references.map(ref=>pokeyReport.rows.find(row=>row.engine===engine&&row.requestedSampleRate===rate&&row.execution===execution&&row.role===ref.role&&row.frequencyHz===ref.frequencyHz));
    const row={engine,browserVersion:'synthetic-fixture-only',requestedSampleRate:rate,actualSampleRate:rate,execution,role:'dual-pair',mode:'pokey-dual',kind:'pokey',sources:references.map(ref=>({role:ref.role,id:ref.sourceId,frequencyHz:ref.frequencyHz,expectedFrequencyHz:ref.effectiveFrequencyHz}))};
    for(const phase of ['split','sum']){
      const pans=phase==='split'?[-1,1]:[0,0];
      const source=references.map((ref,index)=>`{\n${ref.setup}\n}\nawait mixer.set(${JSON.stringify(ref.sourceId)},{pan:${pans[index]},muted:false,solo:true,volume:1});`).join('\n')+"\nlog('POKEY_DUAL_CALIBRATION_READY');";
      const expectedRms=phase==='split'?isolated.map(ref=>ref.acRms):[Math.hypot(...isolated.map(ref=>ref.acRms)),Math.hypot(...isolated.map(ref=>ref.acRms))];
      const amplitudes=phase==='split'?isolated.map(ref=>ref.amplitude):[isolated.reduce((sum,ref)=>sum+ref.amplitude,0),isolated.reduce((sum,ref)=>sum+ref.amplitude,0)];
      row[phase]={source,sourceSha256:sha(source),mixers:references.map((ref,index)=>mixer(ref.sourceId,pans[index])),pcm:capture(rate,amplitudes,expectedRms,references.map(ref=>ref.effectiveFrequencyHz)),expectedRms,rmsRelativeErrors:[0,0]};
      if(phase==='sum')row[phase].pcm.channels[1]=structuredClone(row[phase].pcm.channels[0]);
    }
    row.stopped=silence(rate);pokeyReport.dualChecks.push(row);
  }
  const targetAcRms=.199*.35;
  pokeyReport.calibration={referenceAmplitude:historical.calibration.referenceAmplitude,targetAmplitude:historical.calibration.targetAmplitude,measurementMetric:'acRms',targetAcRms,
    listeningReference:{kind:'segapsg',mode:'genesis',name:'segapsg',gain:.35,rawAcRms:.199,targetAcRms,reference:{engine:'chromium',sampleRate:48000,execution:'main',frequencyHz:440}},maxGain:2,targetChanged:false,
    routes:roles.map(role=>{const row=pokeyReport.rows.find(row=>row.engine==='chromium'&&row.requestedSampleRate===48000&&row.execution==='main'&&row.role===role&&row.frequencyHz===440);return{
      kind:'pokey',role,mode:row.mode,name:row.sourceId,measurementMetric:'acRms',rawAcRms:row.acRms,amplitude:row.amplitude,volume:Number((targetAcRms/row.acRms).toFixed(6)),reference:{engine:'chromium',sampleRate:48000,execution:'main',frequencyHz:440}};})};
  return {historical,pokeyReport};
}
