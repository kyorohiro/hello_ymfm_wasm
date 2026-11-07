#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Exact port checks and explicitly diagnostic cross-core comparisons.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {cpus,arch,platform} from 'node:os';
import {digest,probeReceipt,probeRoot} from './sid8580_probe_artifacts.mjs';
import {sid8580ProbeFixtures,probeProtocol,PROBE_CLOCK} from '../test/helpers/sid8580_probe_fixtures.mjs';
import {measurePcm,comparePcm} from '../tetorica_src/cli/sid_reference_metrics.mjs';
const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++){
  assert(['--work-dir','--out','--reference','--baseline'].includes(args[i])&&args[i+1],`Unknown/missing option ${args[i]}`);
  assert(!options[args[i]]);options[args[i]]=resolve(args[++i]);
}
const work=options['--work-dir']??resolve(probeRoot,'build/sid8580-probe');
const receipt=await probeReceipt(work,{check:true});
const wasm=await readFile(resolve(work,'sid8580-probe.wasm'));
const before=performance.now(), {instance}=await WebAssembly.instantiate(wasm,{}), api=instance.exports;
const instantiateMs=performance.now()-before;
const fixtures=sid8580ProbeFixtures(), rates=[44100,48000,96000], models=[6581,8580];
const pcmFloat=b=>Float32Array.from({length:b.length/2},(_,i)=>b.readInt16LE(i*2)/32768);
function native(fixture,rate,model,chunk,executable=resolve(work,'sid8580-probe')){
  const result=spawnSync(executable,[],{input:probeProtocol(fixture,rate,model,chunk),maxBuffer:4*1024*1024,timeout:30000});
  if(result.error)throw result.error;
  assert.equal(result.status,0,result.stderr.toString());
  return {pcm:result.stdout,state:JSON.parse(result.stderr.toString().trim().split('\n').at(-1))};
}
const counter=(h,name)=>api[`sid8p_${name}_lo`](h)+api[`sid8p_${name}_hi`](h)*2**32;
function render(fixture,rate,model,chunk=32768){
  const h=api.sid8p_create(rate,model===8580?1:0);assert(h,'Probe allocation failed');
  const output=[], reads=[];
  try{
    for(const cmd of fixture.commands){
      if(cmd[0]==='w') assert.equal(api.sid8p_write(h,cmd[1],cmd[2]),1);
      else if(cmd[0]==='r'){const value=api.sid8p_read(h,cmd[1]);assert(value<256);reads.push(value);}
      else if(cmd[0]==='c') for(let n=cmd[1];n>0;){
        const cycles=Math.min(n,chunk), frames=api.sid8p_run(h,cycles)>>>0;assert(frames<=4096);
        output.push(Buffer.from(new Uint8Array(api.memory.buffer,api.sid8p_output(h),frames*2)));n-=cycles;
      } else throw Error(`Unknown fixture command ${cmd[0]}`);
    }
    return {pcm:Buffer.concat(output),state:{reads,cycles:counter(h,'cycles'),frames:counter(h,'frames')}};
  }finally{assert.equal(api.sid8p_destroy(h),1);}
}
const report={format:'tetorica-sid8580-prototype-verification',version:2,
  candidate:'sidera 1.1.1 + cycle-access patch and independent bounded bus wrapper',productionAdopted:false,
  wasm:receipt.outputs['sid8580-probe.wasm'],compiler:receipt.compiler,
  timing:'w/r do not clock; c advances exact completed chip cycles; integer sample phase starts at zero',
  musicOrFirmwareUsed:false,physicalAudioOpened:false,listeningPerformed:false,
  host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version},
  cases:[],externalReference:[],benchmarks:[],checks:{},verificationInputs:{},
  limitations:['No production player, Synth or SDK integration.',
    'Bus decay is a model-specific bounded approximation; POT reads are explicitly unsupported.',
    'Combined waves, analogue filter/offsets and pipeline behavior are approximations.',
    'Cross-core comparisons are diagnostics, not an assertion of hardware fidelity.']};
for(const path of ['scripts/check_sid8580_probe.mjs','test/helpers/sid8580_probe_fixtures.mjs',
  'tetorica_src/cli/sid_reference_metrics.mjs'])report.verificationInputs[path]=digest(await readFile(resolve(probeRoot,path)));
report.buildReceipt=digest(await readFile(resolve(work,'sid8580-probe-build.json')));
const rendered=new Map();
for(const rate of rates)for(const model of models)for(const fixture of fixtures){
  const a=render(fixture,rate,model),b=native(fixture,rate,model),split=render(fixture,rate,model,997);
  assert.deepEqual(a.pcm,b.pcm,`${fixture.name}: Native/WASM PCM`);
  assert.deepEqual(a.state.reads,b.state.reads,`${fixture.name}: Native/WASM reads`);
  assert.equal(a.state.cycles,fixture.cycles);assert.equal(a.state.frames,Math.floor(fixture.cycles*rate/PROBE_CLOCK));
  assert.equal(a.pcm.length,a.state.frames*2);
  assert.deepEqual(a.pcm,split.pcm,`${fixture.name}: split PCM`);assert.deepEqual(a.state,split.state);
  fixture.expectedReads.forEach((expected,i)=>{if(expected!==null)assert.equal(a.state.reads[i],expected,`${fixture.name} read ${i}`);});
  const measured=measurePcm(pcmFloat(a.pcm),rate);
  if(['triangle','saw','pulse','noise','filter-sweep'].includes(fixture.name))assert(measured.acRms>0,`${fixture.name} has no AC output`);
  rendered.set(`${rate}:${model}:${fixture.name}`,a);
  report.cases.push({name:fixture.name,rate,model,cycles:a.state.cycles,reads:a.state.reads,
    exactNativeWasm:true,exactChunked:true,pcm:digest(a.pcm),measurement:measured});
}
for(const rate of rates)for(const model of models){
  for(const [off,on] of [['sync-off','sync-on'],['ring-off','ring-on']])
    assert(!rendered.get(`${rate}:${model}:${off}`).pcm.equals(rendered.get(`${rate}:${model}:${on}`).pcm),`${on} had no effect`);
}
assert(!rendered.get('48000:6581:filter-sweep').pcm.equals(rendered.get('48000:8580:filter-sweep').pcm),'Models did not differ');
report.checks.nativeWasmAndReadParity=report.cases.length;
report.checks.exactCycleFrameAccounting=true;report.checks.splitRendering=true;
report.checks.oscillatorMathAndEnvelopeSteps=true;report.checks.testAndGateRelease=true;
report.checks.syncAndRingChangeOutput=true;report.checks.modelChangesOutput=true;
// Check caller mistakes before any cycles advance, plus generation ownership.
assert.equal(api.sid8p_create(0,1),0);assert.equal(api.sid8p_create(48000,2),0);
const h=api.sid8p_create(48000,1);assert(h);
assert.equal(api.sid8p_write(h,32,1),0);assert.equal(api.sid8p_write(h,0,256),0);
assert.equal(api.sid8p_read(h,32),256);assert.equal(api.sid8p_run(h,0xffffffff)>>>0,0xffffffff);
assert.equal(counter(h,'cycles'),0);
const validFrames=api.sid8p_run(h,10000)>>>0;assert(validFrames>0&&validFrames<4096);assert.equal(api.sid8p_stop(h),1);
const stopped=counter(h,'cycles');assert.equal(api.sid8p_run(h,10000),0);assert.equal(counter(h,'cycles'),stopped);
assert.equal(api.sid8p_reset(h),1);assert.equal(counter(h,'cycles'),0);assert(api.sid8p_run(h,1000)>0);
assert.equal(api.sid8p_destroy(h),1);assert.equal(api.sid8p_read(h,27),256);
const replacement=api.sid8p_create(48000,1);assert(replacement&&replacement!==h);assert.equal(api.sid8p_destroy(replacement),1);
const leases=[];for(let n=0;n<16;n++){const v=api.sid8p_create(48000,1);assert(v);leases.push(v);}
assert.equal(api.sid8p_create(48000,1),0);leases.forEach(v=>assert.equal(api.sid8p_destroy(v),1));
report.checks.invalidInputsDoNotClock=true;report.checks.stopResetAndStaleHandles=true;report.checks.boundedInstances=true;
const malformed=spawnSync(resolve(work,'sid8580-probe'),[],{input:'SID8PROBE 1 48000 8580\nw 0 1\nc 1000\nw 32 1\n'});
assert.notEqual(malformed.status,0);assert.equal(malformed.stdout.length,0);
report.checks.nativeValidatesBeforeOutput=true;
if(options['--baseline']){
  const baseline=JSON.parse(await readFile(options['--baseline']));assert(baseline.passed);
  for(const c of report.cases){
    const old=baseline.cases.find(p=>p.name===c.name&&p.rate===c.rate&&p.model===c.model);assert(old);
    assert.deepEqual(c.pcm,old.pcm,`Prior PCM changed: ${c.name}/${c.model}/${c.rate}`);
    if(c.name!=='write-only-bus')assert.deepEqual(c.reads,old.reads,`Prior oscillator/envelope read changed: ${c.name}`);
  }
  report.baseline={path:options['--baseline'],...digest(await readFile(options['--baseline'])),exactPcmCases:report.cases.length};
}
if(options['--reference']){
  for(const model of models)for(const fixture of fixtures){
    const actual=rendered.get(`48000:${model}:${fixture.name}`),ref=native(fixture,48000,model,null,options['--reference']);
    report.externalReference.push({name:fixture.name,rate:48000,model,reads:{candidate:actual.state.reads,reference:ref.state.reads},
      sameReads:JSON.stringify(actual.state.reads)===JSON.stringify(ref.state.reads),
      referencePcm:digest(ref.pcm),referenceMeasurement:measurePcm(pcmFloat(ref.pcm),48000),
      comparison:comparePcm(pcmFloat(ref.pcm),pcmFloat(actual.pcm))});
  }
  report.referenceBinary={path:options['--reference'],...digest(await readFile(options['--reference']))};
  report.referenceBuildReceipt=digest(await readFile(resolve(dirname(options['--reference']),'sid8580-reference-build.json')));
}
// One large batch sequence: JS crosses the WASM boundary per bounded block,
// not per chip cycle. These are core-throughput diagnostics, not Worklet tests.
for(const model of models){
  const source=fixtures.find(f=>f.name==='filter-sweep');
  const fixture={commands:[...source.commands,['c',PROBE_CLOCK*3]],cycles:source.cycles+PROBE_CLOCK*3};
  const start=performance.now();const result=render(fixture,48000,model);
  const ms=performance.now()-start;
  const startNative=performance.now();native(fixture,48000,model);const nativeMs=performance.now()-startNative;
  report.benchmarks.push({model,rate:48000,cycles:fixture.cycles,frames:result.state.frames,wasmMs:ms,
    wasmRealtimeMultiple:fixture.cycles/PROBE_CLOCK/(ms/1000),nativeProcessMs:nativeMs,
    nativeRealtimeMultipleIncludingProcessStart:fixture.cycles/PROBE_CLOCK/(nativeMs/1000)});
}
report.memory={instantiateMs,linearBytes:api.memory.buffer.byteLength};
report.passed=true;
if(options['--out']){await mkdir(dirname(options['--out']),{recursive:true});await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:true,cases:report.cases.length,referenceCases:report.externalReference.length,checks:report.checks,
  benchmarks:report.benchmarks,memory:report.memory,out:options['--out']??null},null,2));
