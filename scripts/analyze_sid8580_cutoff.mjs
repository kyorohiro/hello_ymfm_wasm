#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Training-only scalar fit. No SID/reference implementation or PCM is read.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cutoffCrossing} from './sid8580_cutoff_metrics.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const TRAINING_FC=[64,128,256,512,1024,1536,2047];
// Parameters from the pinned MIT sidera1.1.1 original, not an oracle table.
export const ORIGINAL_8580_CUTOFF_POINTS=Object.freeze([[0,30],[256,1600],[512,3300],[1024,6500],[1536,9800],[2047,12500]].map(Object.freeze));
const digest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
function originalHz(fc){
  let i=0;while(i+1<ORIGINAL_8580_CUTOFF_POINTS.length&&ORIGINAL_8580_CUTOFF_POINTS[i+1][0]<=fc)i++;
  if(i+1===ORIGINAL_8580_CUTOFF_POINTS.length)return ORIGINAL_8580_CUTOFF_POINTS[i][1];
  const [a,x]=ORIGINAL_8580_CUTOFF_POINTS[i],[b,y]=ORIGINAL_8580_CUTOFF_POINTS[i+1];
  return x+Math.floor((y-x)*(fc-a)/(b-a));
}
export function deriveCutoffFit(report,plan){
  assert.equal(plan.format,'tetorica-sid8580-cutoff-predeclared-plan');assert.equal(plan.version,1);
  assert.deepEqual(plan.matrix.trainingFc,TRAINING_FC,'Only the declared seven training FCs may be fitted');
  assert.equal(plan.retuningFromHoldout,false);
  assert.equal(report.format,'tetorica-sid8580-cutoff-crossover');assert.equal(report.version,1);
  assert.equal(report.dataset,'training','A holdout report cannot be fitted');assert.equal(report.passed,true);
  assert.equal(report.productionAdopted,false);assert.equal(report.clockHz,985248);
  assert.deepEqual(report.profiles,{resonance:false,cutoff:false},'Fit only the unmodified default baseline');
  assert.deepEqual(report.matrix,plan.matrix,'Measured matrix differs from predeclared plan');
  assert.deepEqual(report.matrix.training,{rate:48000,sustain:4,res:0});assert.equal(report.matrix.volume,12);
  assert.deepEqual(report.guards,{minimumAmplitude:8/32768,maximumHalfWindowRelativeAmplitudeChange:.1,clippedSamples:0},'Measurement guards differ from the declared method');
  assert.deepEqual(report.inputs[plan.fixture.path],{bytes:plan.fixture.bytes,sha256:plan.fixture.sha256},'Fixture provenance differs from plan');
  assert.equal(report.cases.length,plan.training.length,'Missing or additional training captures');
  assert.equal(report.checks.nativeWasmAndChunkCases,plan.training.length);
  for(const flag of ['matchedObservableSetup','commonExactSampleTicks','noPcmGainOrPhaseCorrection'])assert.equal(report.checks[flag],true);
  assert(report.referenceExecutable?.sha256?.match(/^[a-f0-9]{64}$/),'A pinned external reference is required');
  const cases=new Map();
  for(const row of report.cases){assert(!cases.has(row.name),'Duplicate capture name');cases.set(row.name,row);}
  for(const declared of plan.training){
    const measured=cases.get(declared.name);assert(measured,`Missing declared capture: ${declared.name}`);
    for(const [key,value]of Object.entries(declared))assert.deepEqual(measured[key],value,`Capture differs from plan: ${declared.name}/${key}`);
    assert(measured.reference&&measured.candidate);assert.equal(measured.nativeWasm,true);assert.equal(measured.chunked,true);
  }
  assert.equal(report.curves.length,TRAINING_FC.length);assert.equal(report.checks.validCandidateCrossings,TRAINING_FC.length);
  assert.equal(report.checks.validReferenceCrossings,TRAINING_FC.length);
  const seen=new Set(),training=[];
  for(const [curveIndex,curve]of report.curves.entries()){
    assert(TRAINING_FC.includes(curve.fc)&&!seen.has(curve.fc),'Unexpected or duplicated training curve');seen.add(curve.fc);
    assert.equal(curve.group,'training');assert.equal(curve.rate,48000);assert.equal(curve.sustain,4);assert.equal(curve.res,0);assert.equal(curve.volume,12);
    assert.equal(curve.points.length,plan.matrix.factors.length,'Missing frequency points');
    const captures=report.cases.filter(row=>row.curveKey===curve.key);
    assert.equal(captures.length,plan.matrix.factors.length*2,'Missing or additional LP/HP captures for curve');
    const seenFrequencies=new Set();
    for(const point of curve.points){
      const i=point.frequencyIndex;
      assert(Number.isInteger(i)&&i>=0&&i<plan.matrix.factors.length&&!seenFrequencies.has(i),'Invalid or duplicate point index');seenFrequencies.add(i);
      const lp=captures.find(row=>row.frequencyIndex===i&&row.mode===0x10),hp=captures.find(row=>row.frequencyIndex===i&&row.mode===0x40);
      assert(lp&&hp&&lp.name.endsWith(':lp')&&hp.name.endsWith(':hp'),'Missing or mislabeled LP/HP pair');
      for(const key of ['fc','res','rate','sustain','volume','group','reg','actualHz','analysisHz','harmonic','dryKey'])assert.deepEqual(lp[key],hp[key],`LP/HP capture conditions differ: ${key}`);
      for(const key of ['fc','res','rate','sustain','volume','group'])assert.deepEqual(lp[key],curve[key],`Capture/curve condition differs: ${key}`);
      assert(Number.isInteger(lp.reg)&&lp.reg>=1&&lp.reg<=65535);assert(Number.isInteger(lp.harmonic)&&lp.harmonic>=1&&lp.harmonic<=7);
      assert.equal(lp.actualHz,lp.reg*report.clockHz/2**24);assert.equal(lp.analysisHz,lp.actualHz*lp.harmonic);
      assert.equal(point.hz,lp.analysisHz,'Curve frequency differs from actual capture');assert.equal(point.harmonic,lp.harmonic,'Curve harmonic differs from actual capture');
      const dry=report.cases.find(row=>row.kind==='dry'&&row.dryKey===lp.dryKey&&row.harmonic===lp.harmonic);assert(dry,'Missing paired dry capture');
      for(const key of ['reg','actualHz','analysisHz','harmonic','rate','sustain','volume'])assert.deepEqual(dry[key],lp[key],`Dry conditions differ: ${key}`);
      for(const engine of ['candidate','reference']){
        const l=lp[engine].measurement,h=hp[engine].measurement,d=dry[engine].measurement;
        for(const m of [l,h,d]){
          assert(Number.isFinite(m.amplitude)&&m.amplitude>=0);assert(Number.isSafeInteger(m.clipped)&&m.clipped>=0);
          assert(Number.isFinite(m.halfWindowRelativeAmplitudeChange)&&m.halfWindowRelativeAmplitudeChange>=0);
          assert.equal(m.valid,m.amplitude>=report.guards.minimumAmplitude&&m.clipped===0&&m.halfWindowRelativeAmplitudeChange<report.guards.maximumHalfWindowRelativeAmplitudeChange,'Stored capture guard does not reproduce');
        }
        const p=point[engine];assert(p);
        assert.equal(p.lp,l.amplitude,'Curve LP amplitude differs from actual capture');assert.equal(p.hp,h.amplitude,'Curve HP amplitude differs from actual capture');
        assert.equal(p.valid,l.valid&&h.valid&&d.valid,'Curve validity differs from actual captures');
        for(const [key,value]of Object.entries({lpClipped:l.clipped,hpClipped:h.clipped,dryClipped:d.clipped,
          lpStability:l.halfWindowRelativeAmplitudeChange,hpStability:h.halfWindowRelativeAmplitudeChange,dryStability:d.halfWindowRelativeAmplitudeChange}))assert.deepEqual(p[key],value,`Curve capture guard differs: ${key}`);
        const finiteRatio=(a,b)=>Number.isFinite(a/b)?a/b:null;
        assert.equal(p.lpMagnitude,finiteRatio(l.amplitude,d.amplitude));assert.equal(p.hpMagnitude,finiteRatio(h.amplitude,d.amplitude));
      }
    }
    for(const engine of ['candidate','reference']){
      const recomputed=cutoffCrossing(curve.points.map(point=>({hz:point.hz,...point[engine]})));
      assert.deepEqual(recomputed,curve[engine],`Stored crossover does not reproduce: FC${curve.fc}/${engine}`);
      assert(Number.isFinite(recomputed.estimatedHz)&&recomputed.estimatedHz>0,`No valid crossover: FC${curve.fc}/${engine}: ${recomputed.reason}`);
    }
    const originalCoefficientHz=originalHz(curve.fc),candidateCrossoverHz=curve.candidate.estimatedHz,
      referenceCrossoverHz=curve.reference.estimatedHz,scale=referenceCrossoverHz/candidateCrossoverHz,
      unroundedCoefficientHz=originalCoefficientHz*scale,coefficientHz=Math.round(unroundedCoefficientHz);
    assert(Number.isFinite(scale)&&scale>0);assert(Number.isSafeInteger(coefficientHz)&&coefficientHz>0&&coefficientHz<16000,'Invalid coefficient or stability-ceiling collision');
    training.push({curveIndex,fc:curve.fc,originalCoefficientHz,candidateCrossoverHz,referenceCrossoverHz,scale,unroundedCoefficientHz,coefficientHz,
      candidateBracketHz:curve.candidate.bracketHz,referenceBracketHz:curve.reference.bracketHz,
      excludedCandidatePoints:curve.candidate.excludedPoints.length,excludedReferencePoints:curve.reference.excludedPoints.length});
  }
  training.sort((a,b)=>a.fc-b.fc);assert.deepEqual(training.map(row=>row.fc),TRAINING_FC);
  const knots=[[0,30],...training.map(row=>[row.fc,row.coefficientHz])];
  for(let i=1;i<knots.length;i++)assert(knots[i][0]>knots[i-1][0]&&knots[i][1]>knots[i-1][1],'Fit knots must be strictly increasing; no silent smoothing');
  return {knots,training,originalCurve:ORIGINAL_8580_CUTOFF_POINTS};
}

async function main(){
  const args=process.argv.slice(2),options={};let check=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--check'){assert(!check);check=true;continue;}
    assert(['--fit','--plan','--out'].includes(args[i])&&args[i+1],`Unknown/missing option: ${args[i]}`);
    assert(!options[args[i]],`Duplicate option: ${args[i]}`);options[args[i]]=resolve(args[++i]);
  }
  assert(options['--fit']&&options['--plan'],'Expected --fit TRAINING.json --plan PLAN.json [--out CALIBRATION.json] [--check]');
  const trainingBytes=await readFile(options['--fit']),planBytes=await readFile(options['--plan']);
  const report=JSON.parse(trainingBytes),plan=JSON.parse(planBytes),fit=deriveCutoffFit(report,plan);
  const metricPath=resolve(ROOT,'scripts/sid8580_cutoff_metrics.mjs');
  const metric=digest(await readFile(metricPath));
  assert.deepEqual(report.inputs['scripts/sid8580_cutoff_metrics.mjs'],metric,'Crossover metric changed since capture');
  const evidence=(path,bytes)=>({path:relative(ROOT,path).split('\\').join('/'),...digest(bytes)});
  const calibration={format:'tetorica-sid8580-experimental-cutoff-calibration',version:1,profile:'8580-cutoff-crossover-v1',
    defaultEnabled:false,model:'8580 only; original6581 and upstream/default APIs unchanged',hardwareCalibration:false,
    derivation:'Training-only black-box output measurements; no reference-engine implementation or tables copied',
    rule:'Original pinned MIT integer coefficientHz * reference operational LP/HP crossover / candidate operational crossover; round nearest integer; piecewise interpolation between knots.',
    trainingReport:{...evidence(options['--fit'],trainingBytes),wasm:report.wasm,referenceExecutable:report.referenceExecutable,checks:report.checks},
    predeclaredPlan:evidence(options['--plan'],planBytes),
    analyzer:{...evidence(fileURLToPath(import.meta.url),await readFile(new URL(import.meta.url))),metric:{path:'scripts/sid8580_cutoff_metrics.mjs',...metric}},
    trainingSelection:{fc:TRAINING_FC,rate:48000,sustain:4,res:0,volume:12,holdoutRead:false,retuningFromHoldout:false},
    unmeasuredAnchor:{fc:0,coefficientHz:30,source:'Unchanged original sidera1.1.1 value; not measured or calibrated against hardware.'},
    stabilityCeilingHz:16000,knots:fit.knots,training:fit.training,originalCoefficientCurve:fit.originalCurve,
    limitations:['This is an explicitly opt-in operational crossover fit, not a physical pole or a -3dB hardware cutoff calibration.',
      'Mode gain, nonlinearities, quantization, harmonic changes and output loading can bias a crossover.',
      'FC0 is untested. All seven measured training FCs, including2047, were required to have valid two-sided crossings; no missing values were filled or silently clamped.',
      'Resonance damping, output gain/RC, waveform/noise, ADSR, CPU and read pipelines are unchanged.',
      'Untrained FCs, sustain/rate/resonance interactions and the original default regressions must be tested before retaining this research profile.']};
  const out=options['--out']??resolve(ROOT,'third_party/sidera/8580-cutoff-calibration.json');
  if(check)assert.deepEqual(JSON.parse(await readFile(out)),calibration,'Fit does not reproduce the frozen calibration');
  else{await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(calibration,null,2)+'\n',{flag:'wx'});}
  console.log(JSON.stringify({passed:true,check,path:out,knots:fit.knots,training:fit.training},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
