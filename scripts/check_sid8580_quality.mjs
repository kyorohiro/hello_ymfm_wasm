#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {digest,probeReceipt,probeRoot} from './sid8580_probe_artifacts.mjs';
import {sid8580QualityFixtures,sid8580QualityValidationFixtures,qualityProtocol,QUALITY_CLOCK} from '../test/helpers/sid8580_quality_fixtures.mjs';
import {toneMeasurement,bandPassEstimate} from './sid8580_quality_metrics.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  if(['--validation','--calibrated-8580'].includes(args[i])){options[args[i]]=true;continue;}
  assert(['--work-dir','--out','--reference','--limit','--cache-dir'].includes(args[i])&&args[i+1]);
  options[args[i]]=args[i]==='--limit'?Number(args[++i]):resolve(args[++i]);
}
const work=options['--work-dir']??resolve(probeRoot,'build/sid8580-probe'),receipt=await probeReceipt(work,{check:true});
const {instance}=await WebAssembly.instantiate(await readFile(resolve(work,'sid8580-probe.wasm')),{}),a=instance.exports;
let scenes=options['--validation']?sid8580QualityValidationFixtures():sid8580QualityFixtures();if(options['--limit']){assert(Number.isInteger(options['--limit'])&&options['--limit']>0);scenes=scenes.slice(0,options['--limit']);}
const report={format:'tetorica-sid8580-controlled-quality',version:1,passed:false,productionAdopted:false,
  clockHz:QUALITY_CLOCK,wasm:receipt.outputs['sid8580-probe.wasm'],
  purpose:'Controlled capture and diagnostic transfer measurements, not automatic hardware-fidelity acceptance',
  conditions:{sampler:'Both engines clock at chip rate, then the same integer phase chooses exact completed sample ticks',
    initialization:'All voices TEST/TRI/Gate-off until ENV3=0 and OSC3=0; active voice3 TEST/Gate to target sustain; no private state injection',
    gain:'No PCM phase/gain/DC correction; transfer is each engine filtered harmonic amplitude divided by its own dry capture',
    samplePhase:'Retained through skip; exact chip ticks reconstructed from global sample indices',
    externalRc:'Unchanged; dry/filtered ratios reduce its contribution. RC/loading and nonlinear differences remain diagnostic.'},
  calibration:options['--calibrated-8580']?'8580-resonance-logfit-v1':'upstream',
  dataset:options['--validation']?'held-out FC256 RES2/6/10/14 at two levels; denser FC128 RES15 check':'initial characterization',
  cases:[],transfers:[],bandPass:[],checks:{},inputs:{},referenceCache:{hits:0,executions:0}};
for(const p of ['scripts/check_sid8580_quality.mjs','scripts/sid8580_quality_metrics.mjs','test/helpers/sid8580_quality_fixtures.mjs'])report.inputs[p]=digest(await readFile(resolve(probeRoot,p)));
const counter=(h,n)=>a[`sid8p_${n}_lo`](h)+a[`sid8p_${n}_hi`](h)*2**32;
function wasm(scene,chunk=32768){
  const h=a.sid8p_create(scene.rate,scene.model===8580?1:0);assert(h);
  if(options['--calibrated-8580']&&scene.model===8580)assert.equal(a.sid8p_set_8580_calibration(h,1),1);
  assert.equal(a.sid8p_calibration(h),options['--calibrated-8580']&&scene.model===8580?1:0);
  const pcm=[],reads=[],readEvents=[],captureRanges=[];let capturedFrames=0;
  try{
    for(const c of scene.commands){
      if(c[0]==='w')assert.equal(a.sid8p_write(h,c[1],c[2]),1);
      else if(c[0]==='r'){const value=a.sid8p_read(h,c[1]);assert(value<256);reads.push(value);readEvents.push({cycle:counter(h,'cycles'),register:c[1],value});}
      else{
        assert(['skip','c'].includes(c[0]));const startCycle=counter(h,'cycles'),startFrame=counter(h,'frames');
        for(let left=c[1];left>0;){const n=Math.min(left,chunk),frames=a.sid8p_run(h,n)>>>0;assert(frames<=4096);
          if(c[0]==='c')pcm.push(Buffer.from(new Uint8Array(a.memory.buffer,a.sid8p_output(h),frames*2)));left-=n;}
        const endCycle=counter(h,'cycles'),endFrame=counter(h,'frames'),frames=endFrame-startFrame;
        if(c[0]==='c'){
          captureRanges.push({startCycle,endCycle,startFrame,endFrame,captureOffset:capturedFrames,frames,
            firstSampleCycle:frames?Math.ceil((startFrame+1)*QUALITY_CLOCK/scene.rate):null,
            lastSampleCycle:frames?Math.ceil(endFrame*QUALITY_CLOCK/scene.rate):null});capturedFrames+=frames;
        }
      }
    }
    return {pcm:Buffer.concat(pcm),cycles:counter(h,'cycles'),generatedFrames:counter(h,'frames'),capturedFrames,reads,readEvents,captureRanges};
  }finally{a.sid8p_destroy(h);}
}
function native(exe,scene,flags=[]){
  const r=spawnSync(exe,flags,{input:qualityProtocol(scene),maxBuffer:8*1024*1024,timeout:30000});
  assert.equal(r.status,0,r.stderr.toString());return {pcm:r.stdout,meta:JSON.parse(r.stderr.toString())};
}
function verifyCapture(actual,expected,label){
  assert.equal(actual.meta.cycles,expected.cycles,label+' cycles');assert.equal(actual.meta.frames,expected.capturedFrames,label+' frames');
  assert.equal(actual.meta.generatedFrames,expected.generatedFrames,label+' all frames');
  assert.deepEqual(actual.meta.captureRanges,expected.captureRanges,label+' exact sample ticks');
  if(label==='candidate')assert.deepEqual(actual.meta.reads,expected.reads,label+' reads');
}
const refDigest=options['--reference']?digest(await readFile(options['--reference'])):null;
async function reference(scene){
  const protocol=qualityProtocol(scene),key=digest(Buffer.from(refDigest.sha256+'\n'+protocol)).sha256,cache=options['--cache-dir'];
  if(cache){
    await mkdir(cache,{recursive:true});
    try{
      const saved=JSON.parse(await readFile(resolve(cache,key+'.json'))),pcm=await readFile(resolve(cache,key+'.pcm'));
      assert.equal(saved.key,key);assert.deepEqual(saved.executable,refDigest);assert.deepEqual(saved.pcm,digest(pcm));
      assert.equal(saved.protocolSha256,digest(Buffer.from(protocol)).sha256);report.referenceCache.hits++;
      return {pcm,meta:saved.metadata};
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const result=native(options['--reference'],scene);report.referenceCache.executions++;
  if(cache){
    const saved={key,executable:refDigest,protocolSha256:digest(Buffer.from(protocol)).sha256,pcm:digest(result.pcm),metadata:result.meta};
    const base=resolve(cache,key),suffix='.tmp-'+process.pid;
    await writeFile(base+'.pcm'+suffix,result.pcm);await rename(base+'.pcm'+suffix,base+'.pcm');
    await writeFile(base+'.json'+suffix,JSON.stringify(saved));await rename(base+'.json'+suffix,base+'.json');
  }
  return result;
}
function measure(bytes,scene,ranges){
  const startFrame=ranges[0].startFrame;
  const measured=toneMeasurement(bytes,{rate:scene.rate,clock:QUALITY_CLOCK,baseHz:scene.actualHz,harmonic:scene.harmonic,startFrame});
  if(scene.kind==='dry'){
    const half=Math.floor(measured.frames/2),before=toneMeasurement(bytes.subarray(0,half*2),{rate:scene.rate,clock:QUALITY_CLOCK,baseHz:scene.actualHz,harmonic:scene.harmonic,startFrame});
    const after=toneMeasurement(bytes.subarray(half*2),{rate:scene.rate,clock:QUALITY_CLOCK,baseHz:scene.actualHz,harmonic:scene.harmonic,startFrame:startFrame+half});
    measured.halfWindowRelativeAmplitudeChange=Math.abs(after.amplitude-before.amplitude)/Math.max(measured.amplitude,1e-12);
    measured.dryGuard=measured.amplitude>=8/32768&&measured.clipped===0&&measured.halfWindowRelativeAmplitudeChange<.1;
  }
  return measured;
}
for(const scene of scenes){
  const flags=options['--calibrated-8580']&&scene.model===8580?['--8580-calibration']:[];
  const x=wasm(scene),split=wasm(scene,997),n=native(resolve(work,'sid8580-quality'),scene,flags);
  assert.equal(n.meta.calibrationEnabled,flags.length>0,scene.name+' explicit profile');
  assert.equal(n.meta.calibrationEffective,flags.length>0&&scene.model===8580,scene.name+' effective profile');
  assert.equal(n.meta.calibrationProfile,flags.length?'8580-resonance-logfit-v1':'upstream',scene.name+' profile label');
  assert.deepEqual(split,x,scene.name+' chunk');assert.deepEqual(n.pcm,x.pcm,scene.name+' Native/WASM');verifyCapture(n,x,'candidate');
  assert.deepEqual(x.reads.slice(0,scene.setupReads.length),scene.setupReads,scene.name+' candidate setup');
  const measured=measure(x.pcm,scene,x.captureRanges),row={name:scene.name,kind:scene.kind,rate:scene.rate,model:scene.model,reg:scene.reg,actualHz:scene.actualHz,
    analysisHz:scene.analysisHz,harmonic:scene.harmonic,sustain:scene.sustain,wave:scene.wave,mode:scene.mode,fc:scene.fc,res:scene.res,dryKey:scene.dryKey,
    setupExpected:scene.setupReads,cycles:x.cycles,frames:x.capturedFrames,generatedFrames:x.generatedFrames,
    captureRanges:x.captureRanges,candidate:{pcm:digest(x.pcm),reads:x.reads,readEvents:x.readEvents,measurement:measured},nativeWasm:true,chunked:true};
  if(options['--reference']){
    const ref=await reference(scene);verifyCapture(ref,x,'reference');
    assert.deepEqual(ref.meta.reads.slice(0,scene.setupReads.length),scene.setupReads,scene.name+' reference setup');
    row.reference={pcm:digest(ref.pcm),reads:ref.meta.reads,readEvents:ref.meta.readEvents,measurement:measure(ref.pcm,scene,x.captureRanges)};
  }
  report.cases.push(row);if(report.cases.length%20===0)console.log(`Controlled quality ${report.cases.length}/${scenes.length}`);
}
for(const c of report.cases.filter(c=>c.kind==='transfer')){
  const dry=report.cases.find(d=>d.kind==='dry'&&d.dryKey===c.dryKey&&d.harmonic===c.harmonic);assert(dry,'Missing same-core dry capture');
  const transfer={name:c.name,rate:c.rate,model:c.model,fc:c.fc,res:c.res,mode:c.mode,sustain:c.sustain,harmonic:c.harmonic,hz:c.analysisHz};
  for(const engine of ['candidate','reference'])if(c[engine]){
    const f=c[engine].measurement,d=dry[engine].measurement;
    transfer[engine]={magnitude:f.amplitude/d.amplitude,phase:f.phase-d.phase,
      valid:d.dryGuard&&f.clipped===0,filteredAmplitude:f.amplitude,dryAmplitude:d.amplitude,dryStable:d.halfWindowRelativeAmplitudeChange};
  }
  report.transfers.push(transfer);
}
const groups=new Map();
for(const t of report.transfers.filter(t=>t.mode===0x20&&t.harmonic===1)){
  const key=`${t.model}:${t.rate}:${t.fc}:${t.res}:${t.sustain}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);
}
for(const rows of groups.values()){
  const {model,rate,fc,res,sustain}=rows[0],r={model,rate,fc,res,sustain};
  for(const engine of ['candidate','reference'])if(rows[0][engine])r[engine]=bandPassEstimate(rows.filter(t=>t[engine].valid).map(t=>({hz:t.hz,magnitude:t[engine].magnitude})));
  report.bandPass.push(r);
}
report.checks={nativeWasmAndChunkCases:report.cases.length,matchedObservableSetup:true,commonExactSampleTicks:true,
  allGlobalFramesAccounted:true,noPcmGainOrPhaseCorrection:true,transferCases:report.transfers.length,
  validCandidateTransferCases:report.transfers.filter(t=>t.candidate.valid).length,
  validReferenceTransferCases:report.transfers.filter(t=>t.reference?.valid).length};
if(options['--reference'])report.referenceExecutable={path:options['--reference'],...refDigest};
report.passed=true;
if(options['--out']){await mkdir(dirname(options['--out']),{recursive:true});await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:true,cases:report.cases.length,checks:report.checks,bandPass:report.bandPass,out:options['--out']},null,2));
