#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Held-out scalar comparisons only. Never changes the frozen training fit.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cutoffCrossing} from './sid8580_cutoff_metrics.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const PROFILES={before:{resonance:false,cutoff:false},resonance:{resonance:true,cutoff:false},
  cutoff:{resonance:false,cutoff:true},both:{resonance:true,cutoff:true}};
const digest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const finiteRatio=(a,b)=>Number.isFinite(a/b)?a/b:null;
const db=(a,b)=>20*(Math.log10(a)-Math.log10(b));
function stats(values){
  assert(values.every(Number.isFinite));
  return values.length?{count:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,
    meanAbsolute:values.reduce((a,b)=>a+Math.abs(b),0)/values.length,
    rms:Math.sqrt(values.reduce((a,b)=>a+b*b,0)/values.length),maximumAbsolute:Math.max(...values.map(Math.abs))}
    :{count:0,mean:null,meanAbsolute:null,rms:null,maximumAbsolute:null};
}
function difference(before,after,tolerance=1e-9){
  const gain=Math.abs(before)-Math.abs(after);
  return gain>tolerance?'improved':gain< -tolerance?'worsened':'unchanged';
}
function validateReport(report,plan,profile){
  assert.equal(report.format,'tetorica-sid8580-cutoff-crossover');assert.equal(report.version,1);
  assert.equal(report.dataset,'holdout');assert.equal(report.passed,true);assert.equal(report.productionAdopted,false);
  assert.equal(report.clockHz,985248);assert.deepEqual(report.profiles,profile);
  assert.deepEqual(report.matrix,plan.matrix);assert.deepEqual(report.guards,
    {minimumAmplitude:8/32768,maximumHalfWindowRelativeAmplitudeChange:.1,clippedSamples:0});
  assert.deepEqual(report.inputs[plan.fixture.path],{bytes:plan.fixture.bytes,sha256:plan.fixture.sha256});
  assert.equal(report.cases.length,plan.holdout.length);assert.equal(report.cases.length,270);
  assert.equal(report.checks.nativeWasmAndChunkCases,report.cases.length);
  for(const key of ['matchedObservableSetup','commonExactSampleTicks','noPcmGainOrPhaseCorrection'])assert.equal(report.checks[key],true);
  assert.match(report.referenceExecutable?.sha256??'',/^[a-f0-9]{64}$/);
  const cases=new Map();
  for(const row of report.cases){
    assert(!cases.has(row.name),'Duplicate capture name');cases.set(row.name,row);
    assert.equal(row.nativeWasm,true);assert.equal(row.chunked,true);
    assert(row.reference&&row.candidate);assert(Number.isInteger(row.reg)&&row.reg>=1&&row.reg<=65535);
    assert(Number.isInteger(row.harmonic)&&row.harmonic>=1&&row.harmonic<=7);
    assert.equal(row.actualHz,row.reg*report.clockHz/2**24);assert.equal(row.analysisHz,row.actualHz*row.harmonic);
    for(const engine of ['candidate','reference']){
      const m=row[engine].measurement;assert(Number.isFinite(m.amplitude)&&m.amplitude>=0);
      assert(Number.isSafeInteger(m.clipped)&&m.clipped>=0);
      assert(Number.isFinite(m.halfWindowRelativeAmplitudeChange)&&m.halfWindowRelativeAmplitudeChange>=0);
      assert.equal(m.valid,m.amplitude>=report.guards.minimumAmplitude&&m.clipped===0&&m.halfWindowRelativeAmplitudeChange<.1);
      assert(Number.isSafeInteger(m.frames)&&m.frames===row.frames);
      assert.match(row[engine].pcm.sha256,/^[a-f0-9]{64}$/);
      assert.equal(row[engine].pcm.bytes,row.frames*2);
    }
  }
  for(const declared of plan.holdout){
    const row=cases.get(declared.name);assert(row,`Missing planned holdout capture: ${declared.name}`);
    for(const [key,value]of Object.entries(declared))assert.deepEqual(row[key],value,`Holdout differs from plan: ${declared.name}/${key}`);
  }
  assert.equal(report.curves.length,10);assert.equal(report.checks.curves,10);
  const curves=new Map();
  for(const curve of report.curves){
    assert(!curves.has(curve.key),'Duplicate curve key');curves.set(curve.key,curve);
    assert.equal(curve.points.length,plan.matrix.factors.length);
    assert(['holdout-fc','holdout-interaction'].includes(curve.group));
    const captures=report.cases.filter(row=>row.curveKey===curve.key);
    assert.equal(captures.length,curve.points.length*2);
    const seen=new Set();
    for(const p of curve.points){
      const i=p.frequencyIndex;assert(Number.isInteger(i)&&i>=0&&i<curve.points.length&&!seen.has(i));seen.add(i);
      const lp=captures.find(row=>row.frequencyIndex===i&&row.mode===0x10),hp=captures.find(row=>row.frequencyIndex===i&&row.mode===0x40);
      assert(lp&&hp&&lp.name.endsWith(':lp')&&hp.name.endsWith(':hp'));
      for(const key of ['fc','res','rate','sustain','volume','group','reg','actualHz','analysisHz','harmonic','dryKey'])assert.deepEqual(lp[key],hp[key]);
      for(const key of ['fc','res','rate','sustain','volume','group'])assert.deepEqual(lp[key],curve[key]);
      assert.equal(p.hz,lp.analysisHz);assert.equal(p.harmonic,lp.harmonic);
      const dry=report.cases.find(row=>row.kind==='dry'&&row.dryKey===lp.dryKey&&row.harmonic===lp.harmonic);assert(dry);
      for(const key of ['reg','actualHz','analysisHz','harmonic','rate','sustain','volume'])assert.deepEqual(dry[key],lp[key]);
      for(const engine of ['candidate','reference']){
        const l=lp[engine].measurement,h=hp[engine].measurement,d=dry[engine].measurement;
        const expected={lp:l.amplitude,hp:h.amplitude,valid:l.valid&&h.valid&&d.valid,
          lpMagnitude:finiteRatio(l.amplitude,d.amplitude),hpMagnitude:finiteRatio(h.amplitude,d.amplitude),
          lpClipped:l.clipped,hpClipped:h.clipped,dryClipped:d.clipped,
          lpStability:l.halfWindowRelativeAmplitudeChange,hpStability:h.halfWindowRelativeAmplitudeChange,dryStability:d.halfWindowRelativeAmplitudeChange};
        assert.deepEqual(p[engine],expected,'Curve point does not reproduce its actual LP/HP/dry captures');
      }
    }
    for(const engine of ['candidate','reference'])assert.deepEqual(curve[engine],cutoffCrossing(curve.points.map(p=>({hz:p.hz,...p[engine]}))));
  }
  assert.equal(report.checks.validCandidateCrossings,[...curves.values()].filter(c=>c.candidate.estimatedHz!==null).length);
  assert.equal(report.checks.validReferenceCrossings,[...curves.values()].filter(c=>c.reference.estimatedHz!==null).length);
  assert.equal([...curves.values()].filter(c=>c.group==='holdout-fc').length,6);
  assert.equal([...curves.values()].filter(c=>c.group==='holdout-interaction').length,4);
  return {cases,curves};
}
function pointErrors(curve){
  const rows=[];
  for(const p of curve.points){
    if(!p.candidate.valid||!p.reference.valid)continue;
    for(const mode of ['lp','hp']){
      const c=p.candidate[mode+'Magnitude'],r=p.reference[mode+'Magnitude'];
      assert(Number.isFinite(c)&&c>0&&Number.isFinite(r)&&r>0);
      rows.push({frequencyIndex:p.frequencyIndex,hz:p.hz,harmonic:p.harmonic,mode,errorDb:db(c,r)});
    }
  }
  return rows;
}
function crossoverError(curve){
  const c=curve.candidate.estimatedHz,r=curve.reference.estimatedHz;
  return c===null||r===null?null:100*(c/r-1);
}
export function analyzeCutoffValidation(reports,plan){
  assert.equal(plan.format,'tetorica-sid8580-cutoff-predeclared-plan');assert.equal(plan.version,1);
  assert.equal(plan.retuningFromHoldout,false);assert.deepEqual(plan.matrix.holdoutFc,[96,192,384,768,1280,1792]);
  const indexed={};
  for(const [key,profile]of Object.entries(PROFILES))indexed[key]=validateReport(reports[key],plan,profile);
  const baseline=reports.before,baseIndex=indexed.before;
  let dryCases=0;
  for(const [key,report]of Object.entries(reports)){
    assert(PROFILES[key],'Unknown comparison profile');assert.deepEqual(report.wasm,baseline.wasm,'Reports must use the same frozen candidate build');
    assert.deepEqual(report.inputs,baseline.inputs);assert.deepEqual(report.referenceExecutable,baseline.referenceExecutable);
    for(const [name,base]of baseIndex.cases){
      const row=indexed[key].cases.get(name);assert(row);
      const {candidate:ignoredA,...baseConditions}=base,{candidate:ignoredB,...conditions}=row;
      assert.deepEqual(conditions,baseConditions,'Reference PCM, metadata or capture conditions changed across flag groups');
      assert.deepEqual(row.candidate.readEvents,base.candidate.readEvents,'Filter options must not change register reads');
      assert.deepEqual(row.candidate.reads,base.candidate.reads);
      if(base.kind==='dry')assert.deepEqual(row.candidate,base.candidate,'Dry candidate PCM/measurement changed across flags');
    }
    for(const [curveKey,curve]of baseIndex.curves)assert.deepEqual(indexed[key].curves.get(curveKey).reference,curve.reference);
  }
  dryCases=[...baseIndex.cases.values()].filter(c=>c.kind==='dry').length;
  const curves=[];
  for(const [key,base]of baseIndex.curves){
    const row={key,group:base.group,fc:base.fc,rate:base.rate,res:base.res,sustain:base.sustain,volume:base.volume,
      referenceCrossoverHz:base.reference.estimatedHz,profiles:{}};
    for(const name of Object.keys(PROFILES)){
      const curve=indexed[name].curves.get(key),errors=pointErrors(curve);
      row.profiles[name]={crossoverHz:curve.candidate.estimatedHz,crossoverReason:curve.candidate.reason,
        crossoverErrorPercent:crossoverError(curve),candidateBracketHz:curve.candidate.bracketHz,
        excludedCandidatePoints:curve.candidate.excludedPoints,validTransferPoints:errors.length,
        wholeCurveErrorDb:stats(errors.map(p=>p.errorDb))};
    }
    curves.push(row);
  }
  const comparisons=[];
  for(const [before,after,purpose]of [['before','cutoff','Cutoff alone versus neither profile'],
    ['resonance','both','Independent cutoff benefit with resonance already enabled'],
    ['before','resonance','Resonance alone versus neither profile'],['before','both','Both profiles versus neither profile']]){
    const curveRows=[],allPoints=[];
    for(const c of curves){
      const b=indexed[before].curves.get(c.key),a=indexed[after].curves.get(c.key),
        bm=new Map(pointErrors(b).map(p=>[p.frequencyIndex+':'+p.mode,p]));
      const points=pointErrors(a).flatMap(p=>{
        const old=bm.get(p.frequencyIndex+':'+p.mode);return old?[{...p,beforeErrorDb:old.errorDb,afterErrorDb:p.errorDb,
          outcome:difference(old.errorDb,p.errorDb)}]:[];
      });
      const be=crossoverError(b),ae=crossoverError(a);
      curveRows.push({key:c.key,fc:c.fc,group:c.group,rate:c.rate,res:c.res,sustain:c.sustain,
        beforeCrossoverErrorPercent:be,afterCrossoverErrorPercent:ae,
        crossoverOutcome:be===null||ae===null?'not-comparable':difference(be,ae),
        beforeErrorDb:stats(points.map(p=>p.beforeErrorDb)),afterErrorDb:stats(points.map(p=>p.afterErrorDb)),
        pointsImproved:points.filter(p=>p.outcome==='improved').length,pointsWorsened:points.filter(p=>p.outcome==='worsened').length,
        pointsUnchanged:points.filter(p=>p.outcome==='unchanged').length});
      allPoints.push(...points.map(p=>({...p,key:c.key,fc:c.fc,group:c.group,rate:c.rate,res:c.res,sustain:c.sustain})));
    }
    const groups={};
    for(const group of ['all','holdout-fc','holdout-interaction']){
      const cs=group==='all'?curveRows:curveRows.filter(c=>c.group===group),ps=group==='all'?allPoints:allPoints.filter(p=>p.group===group);
      groups[group]={curves:cs.length,crossoversImproved:cs.filter(c=>c.crossoverOutcome==='improved').length,
        crossoversWorsened:cs.filter(c=>c.crossoverOutcome==='worsened').length,crossoversUnchanged:cs.filter(c=>c.crossoverOutcome==='unchanged').length,
        crossoversNotComparable:cs.filter(c=>c.crossoverOutcome==='not-comparable').length,
        beforeCrossoverErrorPercent:stats(cs.map(c=>c.beforeCrossoverErrorPercent).filter(x=>x!==null)),
        afterCrossoverErrorPercent:stats(cs.map(c=>c.afterCrossoverErrorPercent).filter(x=>x!==null)),
        beforeErrorDb:stats(ps.map(p=>p.beforeErrorDb)),afterErrorDb:stats(ps.map(p=>p.afterErrorDb)),
        pointsImproved:ps.filter(p=>p.outcome==='improved').length,pointsWorsened:ps.filter(p=>p.outcome==='worsened').length,
        pointsUnchanged:ps.filter(p=>p.outcome==='unchanged').length,
        byMode:Object.fromEntries(['lp','hp'].map(mode=>{const ms=ps.filter(p=>p.mode===mode);return [mode,{
          beforeErrorDb:stats(ms.map(p=>p.beforeErrorDb)),afterErrorDb:stats(ms.map(p=>p.afterErrorDb)),
          pointsImproved:ms.filter(p=>p.outcome==='improved').length,pointsWorsened:ms.filter(p=>p.outcome==='worsened').length,
          pointsUnchanged:ms.filter(p=>p.outcome==='unchanged').length}];}))};
    }
    comparisons.push({before,after,purpose,commonValidPointsOnly:true,groups,curves:curveRows,
      largestRegressions:allPoints.filter(p=>p.outcome==='worsened').sort((a,b)=>(Math.abs(b.afterErrorDb)-Math.abs(b.beforeErrorDb))-(Math.abs(a.afterErrorDb)-Math.abs(a.beforeErrorDb))).slice(0,8)});
  }
  return {checks:{fourFlagGroups:true,sameFrozenWasm:true,sameReferenceExecutable:true,
    unchangedReferencePcmAndMetadataCases:baseIndex.cases.size,unchangedDryCandidateCases:dryCases,
    matchingReadEventsAllCases:true,curvesLinkedToActualCaptures:true,recomputedCrossovers:true,
    sixUntrainedFcCurves:true,fourHeldOutInteractions:true,noRetuning:true},curves,comparisons};
}

async function main(){
  const options={},args=process.argv.slice(2);let check=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--check'){assert(!check);check=true;continue;}
    assert(['--before','--resonance','--cutoff','--both','--plan','--fit','--out'].includes(args[i])&&args[i+1],`Unknown/missing option ${args[i]}`);
    assert(!options[args[i]],`Duplicate option ${args[i]}`);options[args[i]]=resolve(args[++i]);
  }
  const provenance={},reports={};
  const read=async key=>{assert(options['--'+key],`Missing --${key}`);const path=options['--'+key],bytes=await readFile(path);
    provenance[key]={path:relative(ROOT,path).split('\\').join('/'),...digest(bytes)};return JSON.parse(bytes);};
  for(const key of Object.keys(PROFILES))reports[key]=await read(key);
  const plan=await read('plan'),fit=await read('fit');
  assert.equal(fit.profile,'8580-cutoff-crossover-v1');assert.equal(fit.defaultEnabled,false);assert.equal(fit.hardwareCalibration,false);
  assert.equal(fit.predeclaredPlan.sha256,provenance.plan.sha256);assert.equal(fit.predeclaredPlan.bytes,provenance.plan.bytes);
  const metricBytes=await readFile(new URL('./sid8580_cutoff_metrics.mjs',import.meta.url)),metric=digest(metricBytes);
  assert.deepEqual(fit.analyzer.metric,{path:'scripts/sid8580_cutoff_metrics.mjs',...metric});
  for(const report of Object.values(reports))assert.deepEqual(report.inputs['scripts/sid8580_cutoff_metrics.mjs'],metric);
  const result=analyzeCutoffValidation(reports,plan),self=await readFile(new URL(import.meta.url));
  const analysis={format:'tetorica-sid8580-cutoff-heldout-analysis',version:1,productionAdopted:false,
    retunedOnHoldout:false,profile:fit.profile,knots:fit.knots,provenance,
    analyzer:{path:relative(ROOT,fileURLToPath(import.meta.url)).split('\\').join('/'),...digest(self),metric},
    wasm:reports.before.wasm,referenceExecutable:reports.before.referenceExecutable,
    method:'Operational LP=HP harmonic crossover and same-core filtered/dry amplitude ratios. Scalar diagnostics only; no PCM gain, DC, phase, frequency or time correction.',
    interpretation:['All six FC values are held out from the seven-point fit; the four rate/sustain/resonance interactions are separately summarized.',
      'Both profiles are opt-in research flags. A crossover is not an arbitrary-Q -3dB cutoff or hardware pole.',
      'Curve-error comparisons use the intersection of valid LP/HP/dry measurements for each pair, with excluded crossover points kept explicit.',
      'Nine predeclared frequencies provide deterministic bracket/interpolation estimates, not statistical confidence intervals or a proof of sub-percent physical accuracy.',
      'FC0 remains an unmeasured unchanged 30-Hz anchor. No listening, hardware, broadband fidelity or Player adoption claim follows from these scalar errors.'],
    recommendation:{retainAsOptInResearch:true,productionPlayerAdoption:false,defaultEnabled:false,
      rationale:'The independent cutoff contrasts improve all held-out crossover errors and reduce aggregate same-core LP/HP transfer error. Individual frequency bins still worsen; retain explicit flags and all original defaults.',
      unresolved:['FC96 is the largest residual crossover error and largest remaining single-bin amplitude error in this matrix; it was not used to retune the frozen fit.',
        'A better operational crossover does not ensure a better complete transfer curve: cutoff-only high-resonance/high-input bins may move away from the reference.',
        'No fresh oscillator/noise, ADSR, combined-wave, 6581, CPU, external-output loading or physical-chip calibration was inferred from these crossover captures.']},
    ...result};
  const out=options['--out']??resolve(ROOT,'docs/issues/sid8580_cutoff_validation_analysis_01.json');
  if(check)assert.deepEqual(JSON.parse(await readFile(out)),analysis,'Held-out analysis does not reproduce');
  else{await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(analysis,null,2)+'\n',{flag:'wx'});}
  console.log(JSON.stringify({passed:true,check,out,checks:result.checks,
    comparisons:result.comparisons.map(({before,after,groups})=>({before,after,groups}))},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
