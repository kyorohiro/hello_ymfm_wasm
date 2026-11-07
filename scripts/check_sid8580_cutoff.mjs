#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Independent LP/HP crossover captures; never modifies a product or raw PCM.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {digest,probeReceipt,probeRoot} from './sid8580_probe_artifacts.mjs';
import {qualityProtocol,QUALITY_CLOCK} from '../test/helpers/sid8580_quality_fixtures.mjs';
import {sid8580CutoffFixtures,CUTOFF_MATRIX} from '../test/helpers/sid8580_cutoff_fixtures.mjs';
import {toneMeasurement} from './sid8580_quality_metrics.mjs';
import {cutoffCrossing} from './sid8580_cutoff_metrics.mjs';

const options={},argv=process.argv.slice(2);
for(let i=0;i<argv.length;i++){
  if(['--validation','--cutoff-calibrated','--resonance-calibrated'].includes(argv[i])){options[argv[i]]=true;continue;}
  assert(['--work-dir','--out','--reference','--cache-dir','--limit'].includes(argv[i])&&argv[i+1]);
  const name=argv[i],value=argv[++i];options[name]=name==='--limit'?Number(value):resolve(value);
}
const work=options['--work-dir']??resolve(probeRoot,'build/sid8580-probe'),receipt=await probeReceipt(work,{check:true});
const {instance}=await WebAssembly.instantiate(await readFile(resolve(work,'sid8580-probe.wasm')),{}),api=instance.exports;
let scenes=sid8580CutoffFixtures({validation:!!options['--validation']});
if(options['--limit']){assert(Number.isInteger(options['--limit'])&&options['--limit']>0);scenes=scenes.slice(0,options['--limit']);}
const resonance=!!options['--resonance-calibrated'],cutoff=!!options['--cutoff-calibrated'];
const report={format:'tetorica-sid8580-cutoff-crossover',version:1,passed:false,productionAdopted:false,
  dataset:options['--validation']?'holdout':'training',matrix:CUTOFF_MATRIX,clockHz:QUALITY_CLOCK,
  profiles:{resonance,cutoff},wasm:receipt.outputs['sid8580-probe.wasm'],inputs:{},
  interpretation:'Operational LP=HP harmonic crossover, not a hardware pole or a -3dB cutoff. No PCM gain/DC/phase correction.',
  guards:{minimumAmplitude:8/32768,maximumHalfWindowRelativeAmplitudeChange:.1,clippedSamples:0},
  cases:[],curves:[],checks:{},referenceCache:{hits:0,executions:0}};
for(const p of ['scripts/check_sid8580_cutoff.mjs','scripts/sid8580_cutoff_metrics.mjs','scripts/sid8580_quality_metrics.mjs',
  'test/helpers/sid8580_cutoff_fixtures.mjs','test/helpers/sid8580_quality_fixtures.mjs'])report.inputs[p]=digest(await readFile(resolve(probeRoot,p)));
const counter=(h,n)=>(api[`sid8p_${n}_lo`](h)>>>0)+(api[`sid8p_${n}_hi`](h)>>>0)*2**32;
function wasm(scene,chunk){
  const h=api.sid8p_create(scene.rate,1);assert(h);
  const blocks=[],reads=[],readEvents=[],captureRanges=[];let capturedFrames=0;
  try{
    if(resonance)assert.equal(api.sid8p_set_8580_calibration(h,1),1);
    assert.equal(api.sid8p_calibration(h),Number(resonance));
    if(cutoff)assert.equal(api.sid8p_set_8580_cutoff_calibration(h,1),1);
    if(api.sid8p_cutoff_calibration)assert.equal(api.sid8p_cutoff_calibration(h),Number(cutoff));
    for(const c of scene.commands){
      if(c[0]==='w')assert.equal(api.sid8p_write(h,c[1],c[2]),1);
      else if(c[0]==='r'){const value=api.sid8p_read(h,c[1]);assert(value<256);reads.push(value);readEvents.push({cycle:counter(h,'cycles'),register:c[1],value});}
      else{
        assert(['c','skip'].includes(c[0]));const startCycle=counter(h,'cycles'),startFrame=counter(h,'frames');
        for(let left=c[1];left>0;){const n=Math.min(left,chunk),frames=api.sid8p_run(h,n)>>>0;assert(frames<=4096);
          if(c[0]==='c')blocks.push(Buffer.from(new Uint8Array(api.memory.buffer,api.sid8p_output(h),frames*2)));left-=n;}
        const endCycle=counter(h,'cycles'),endFrame=counter(h,'frames'),frames=endFrame-startFrame;
        if(c[0]==='c'){captureRanges.push({startCycle,endCycle,startFrame,endFrame,captureOffset:capturedFrames,frames,
          firstSampleCycle:frames?Math.ceil((startFrame+1)*QUALITY_CLOCK/scene.rate):null,
          lastSampleCycle:frames?Math.ceil(endFrame*QUALITY_CLOCK/scene.rate):null});capturedFrames+=frames;}
      }
    }
    return {pcm:Buffer.concat(blocks),reads,readEvents,captureRanges,capturedFrames,cycles:counter(h,'cycles'),generatedFrames:counter(h,'frames')};
  }finally{api.sid8p_destroy(h);}
}
function native(executable,scene,flags=[]){
  const r=spawnSync(executable,flags,{input:qualityProtocol(scene),maxBuffer:8*1024*1024,timeout:30000});
  assert.equal(r.status,0,r.stderr.toString());return {pcm:r.stdout,meta:JSON.parse(r.stderr.toString())};
}
const referenceDigest=options['--reference']?digest(await readFile(options['--reference'])):null;
async function reference(scene){
  const protocol=qualityProtocol(scene),key=digest(Buffer.from(referenceDigest.sha256+'\n'+protocol)).sha256,cache=options['--cache-dir'];
  if(cache){
    await mkdir(cache,{recursive:true});
    try{
      const saved=JSON.parse(await readFile(resolve(cache,key+'.json'))),pcm=await readFile(resolve(cache,key+'.pcm'));
      assert.equal(saved.key,key);assert.deepEqual(saved.executable,referenceDigest);assert.deepEqual(saved.pcm,digest(pcm));
      assert.equal(saved.protocolSha256,digest(Buffer.from(protocol)).sha256);report.referenceCache.hits++;return {pcm,meta:saved.metadata};
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const r=native(options['--reference'],scene);report.referenceCache.executions++;
  if(cache){const base=resolve(cache,key),suffix='.tmp-'+process.pid,saved={key,executable:referenceDigest,pcm:digest(r.pcm),protocolSha256:digest(Buffer.from(protocol)).sha256,metadata:r.meta};
    await writeFile(base+'.pcm'+suffix,r.pcm);await rename(base+'.pcm'+suffix,base+'.pcm');
    await writeFile(base+'.json'+suffix,JSON.stringify(saved));await rename(base+'.json'+suffix,base+'.json');}
  return r;
}
function verify(actual,expected,{candidate=false}={}){
  for(const [a,b] of [['cycles','cycles'],['generatedFrames','generatedFrames'],['frames','capturedFrames']])assert.equal(actual.meta[a],expected[b]);
  assert.deepEqual(actual.meta.captureRanges,expected.captureRanges);
  if(candidate){assert.deepEqual(actual.meta.reads,expected.reads);assert.deepEqual(actual.pcm,expected.pcm);
    assert.equal(actual.meta.calibrationEnabled,resonance);
    assert.equal(actual.meta.cutoffCalibrationEnabled??false,cutoff);}
}
function measure(pcm,scene,ranges){
  const startFrame=ranges[0].startFrame,settings={rate:scene.rate,clock:QUALITY_CLOCK,baseHz:scene.actualHz,harmonic:scene.harmonic,startFrame};
  const m=toneMeasurement(pcm,settings),half=Math.floor(m.frames/2),left=toneMeasurement(pcm.subarray(0,half*2),settings),
    right=toneMeasurement(pcm.subarray(half*2),{...settings,startFrame:startFrame+half});
  m.halfWindowRelativeAmplitudeChange=Math.abs(left.amplitude-right.amplitude)/Math.max(m.amplitude,1e-12);
  m.valid=m.amplitude>=report.guards.minimumAmplitude&&m.clipped===0&&m.halfWindowRelativeAmplitudeChange<.1;
  return m;
}
for(const scene of scenes){
  const x=wasm(scene,32768);assert.deepEqual(wasm(scene,997),x,scene.name+' chunk parity');
  const flags=[...(resonance?['--8580-calibration']:[]),...(cutoff?['--8580-cutoff-calibration']:[])];
  verify(native(resolve(work,'sid8580-quality'),scene,flags),x,{candidate:true});
  assert.deepEqual(x.reads.slice(0,scene.setupReads.length),scene.setupReads);
  const row={name:scene.name,kind:scene.kind,curveKey:scene.curveKey,group:scene.group,frequencyIndex:scene.frequencyIndex,
    rate:scene.rate,fc:scene.fc,res:scene.res,sustain:scene.sustain,volume:scene.volume,mode:scene.mode,
    reg:scene.reg,actualHz:scene.actualHz,analysisHz:scene.analysisHz,harmonic:scene.harmonic,dryKey:scene.dryKey,
    cycles:x.cycles,frames:x.capturedFrames,generatedFrames:x.generatedFrames,captureRanges:x.captureRanges,
    candidate:{pcm:digest(x.pcm),reads:x.reads,readEvents:x.readEvents,measurement:measure(x.pcm,scene,x.captureRanges)},nativeWasm:true,chunked:true};
  if(options['--reference']){const ref=await reference(scene);verify(ref,x);assert.deepEqual(ref.meta.reads.slice(0,scene.setupReads.length),scene.setupReads);
    row.reference={pcm:digest(ref.pcm),reads:ref.meta.reads,readEvents:ref.meta.readEvents,measurement:measure(ref.pcm,scene,x.captureRanges)};}
  report.cases.push(row);if(report.cases.length%30===0)console.log(`Cutoff ${report.cases.length}/${scenes.length}`);
}
const groups=new Map();
for(const c of report.cases.filter(c=>c.curveKey)){if(!groups.has(c.curveKey))groups.set(c.curveKey,[]);groups.get(c.curveKey).push(c);}
for(const [key,rows] of groups){
  const {fc,res,rate,sustain,volume,group}=rows[0],curve={key,fc,res,rate,sustain,volume,group,points:[]};
  for(const lp of rows.filter(c=>c.mode===0x10)){
    const hp=rows.find(c=>c.mode===0x40&&c.frequencyIndex===lp.frequencyIndex);assert(hp,'Missing paired HP');
    const dry=report.cases.find(c=>c.kind==='dry'&&c.dryKey===lp.dryKey&&c.harmonic===lp.harmonic);assert(dry);
    const p={hz:lp.analysisHz,harmonic:lp.harmonic,frequencyIndex:lp.frequencyIndex};
    for(const engine of ['candidate','reference'])if(lp[engine]){
      const l=lp[engine].measurement,h=hp[engine].measurement,d=dry[engine].measurement;
      p[engine]={lp:l.amplitude,hp:h.amplitude,valid:l.valid&&h.valid&&d.valid,
        lpMagnitude:l.amplitude/d.amplitude,hpMagnitude:h.amplitude/d.amplitude,
        lpClipped:l.clipped,hpClipped:h.clipped,dryClipped:d.clipped,
        lpStability:l.halfWindowRelativeAmplitudeChange,hpStability:h.halfWindowRelativeAmplitudeChange,dryStability:d.halfWindowRelativeAmplitudeChange};
    }
    curve.points.push(p);
  }
  for(const engine of ['candidate','reference'])if(curve.points[0]?.[engine])curve[engine]=cutoffCrossing(curve.points.map(p=>({hz:p.hz,...p[engine]})));
  report.curves.push(curve);
}
report.checks={nativeWasmAndChunkCases:report.cases.length,matchedObservableSetup:true,commonExactSampleTicks:true,
  curves:report.curves.length,validCandidateCrossings:report.curves.filter(c=>c.candidate.estimatedHz!==null).length,
  validReferenceCrossings:report.curves.filter(c=>c.reference?.estimatedHz!=null).length,noPcmGainOrPhaseCorrection:true};
if(referenceDigest)report.referenceExecutable={path:options['--reference'],...referenceDigest};
report.passed=true;
if(options['--out']){await mkdir(dirname(options['--out']),{recursive:true});await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:true,profiles:report.profiles,checks:report.checks,
  crossovers:report.curves.map(({fc,res,rate,sustain,candidate,reference})=>({fc,res,rate,sustain,candidateHz:candidate.estimatedHz,referenceHz:reference?.estimatedHz})),out:options['--out']},null,2));
