#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Real pinned m6502 clocks the candidate SID; actual reads feed CPU branches.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {digest,probeReceipt,probeRoot} from './sid8580_probe_artifacts.mjs';
import {sid8580CpuFixtures,sid8580CpuExpected,sid8580CpuProtocol,SID8580_CPU_CLOCK} from '../test/helpers/sid8580_cpu_fixtures.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){assert(['--work-dir','--out'].includes(args[i])&&args[i+1]);options[args[i]]=resolve(args[++i]);}
const work=options['--work-dir']??resolve(probeRoot,'build/sid8580-probe'),receipt=await probeReceipt(work,{check:true});
const {instance}=await WebAssembly.instantiate(await readFile(resolve(work,'sid8580-cpu.wasm')),{}),a=instance.exports;
const count=(h,n)=>a[`sid8cpu_${n}_lo`](h)+a[`sid8cpu_${n}_hi`](h)*2**32;
function snapshot(h){
  return {cycles:count(h,'cycles'),frames:count(h,'frames'),state:Array.from({length:15},(_,i)=>a.sid8cpu_state(h,i)>>>0),
    signature:Array.from({length:16},(_,i)=>a.sid8cpu_signature(h,i)),registers:Array.from({length:32},(_,i)=>a.sid8cpu_written(h,i)),
    program:[...new Uint8Array(a.memory.buffer,a.sid8cpu_program(h),a.sid8cpu_program_len(h))],
    reads:Array.from({length:a.sid8cpu_read_count(h)},(_,i)=>({cycle:(a.sid8cpu_read_event(h,i,0)>>>0)+(a.sid8cpu_read_event(h,i,1)>>>0)*2**32,
      address:a.sid8cpu_read_event(h,i,2),value:a.sid8cpu_read_event(h,i,3),error:a.sid8cpu_read_event(h,i,4)})),
    writeCount:a.sid8cpu_write_count(h),writeHash:a.sid8cpu_write_hash(h)>>>0};
}
function advance(h,cycles,chunk=32768){
  const pcm=[];
  for(let left=cycles;left>0;){const n=Math.min(left,chunk),frames=a.sid8cpu_run(h,n)>>>0;assert(frames<=4096);
    pcm.push(Buffer.from(new Uint8Array(a.memory.buffer,a.sid8cpu_output(h),frames*2)));left-=n;}
  return Buffer.concat(pcm);
}
function render(f,rate,model,chunk){
  const h=a.sid8cpu_create(rate,model===8580?1:0,f.id);assert(h);
  try{const pcm=advance(h,f.cycles,chunk);return {pcm,...snapshot(h)};}finally{assert.equal(a.sid8cpu_destroy(h),1);}
}
function native(f,rate,model,chunk){
  const n=spawnSync(resolve(work,'sid8580-cpu'),[],{input:sid8580CpuProtocol(f,rate,model,{chunk}),maxBuffer:4*1024*1024,timeout:30000});
  assert.equal(n.status,0,n.stderr.toString());const j=JSON.parse(n.stderr.toString());
  const {cycles,frames,state,signature,registers,program,reads,writeCount,writeHash}=j;
  return {pcm:n.stdout,cycles,frames,state,signature,registers,program,reads,writeCount,writeHash};
}
function checkExpected(x,f,model,rate){
  const e=sid8580CpuExpected(f,model);
  assert.equal(x.state[0],e.error);assert.equal(x.state[11],Number(e.done));assert.equal(x.state[13],0,'Read trace overflow');
  if(e.faultAddress!==undefined)assert.equal(x.state[12],e.faultAddress);
  for(const [i,value] of Object.entries(e.signature))assert.equal(x.signature[i],value,`${f.name} signature ${i}`);
  for(const i of e.nonzeroSignature??[])assert(x.signature[i]>0);
  for(const [r,value] of Object.entries(e.finalSid??{}))assert.equal(x.registers[r],value);
  for(const [r,i] of Object.entries(e.finalSidFromSignature??{}))assert.equal(x.registers[r],x.signature[i]);
  assert.equal(x.reads.length,e.reads.length);
  e.reads.forEach((r,i)=>{const real=x.reads[i];assert.equal(real.address,r.address);assert.equal(real.error,r.error);
    if(r.value!==undefined)assert.equal(real.value,r.value);if(r.nonzero)assert(real.value>0&&real.value<256);
    if(r.signature!==undefined)assert.equal(real.value,x.signature[r.signature]);assert(real.cycle>0&&real.cycle<=x.cycles);});
  assert.equal(x.frames,Math.floor(x.cycles*rate/SID8580_CPU_CLOCK));assert.equal(x.pcm.length,x.frames*2);
  if(e.error===0){assert.equal(x.cycles,f.cycles);assert(x.writeCount>0);assert(x.pcm.some(b=>b!==0),`${f.name} has no output`);}
  else {assert(x.cycles<f.cycles);assert.equal(x.state[1],1);assert.equal(x.signature[15],0);}
}
const report={format:'tetorica-sid8580-cpu-closed-loop',version:1,passed:false,wasm:receipt.outputs['sid8580-cpu.wasm'],
  cpu:'Unmodified pinned chips/m6502',clock:SID8580_CPU_CLOCK,
  timing:'CPU tick -> SID completed tick/sample -> actual mapped SID read/write -> CPU next tick',
  environment:'Self-authored RAM programs only; no C64 banking, CIA, VIC, original firmware or game data',
  hardwareFidelityProven:false,productionPlayerIntegrated:false,cases:[],benchmarks:[],checks:{},inputs:{}};
for(const p of ['scripts/check_sid8580_cpu.mjs','test/helpers/sid8580_cpu_fixtures.mjs'])report.inputs[p]=digest(await readFile(resolve(probeRoot,p)));
const map=new Map();
for(const rate of [44100,48000,96000])for(const model of [6581,8580])for(const f of sid8580CpuFixtures()){
  const x=render(f,rate,model,32768),split=render(f,rate,model,997),n=native(f,rate,model,32768);
  checkExpected(x,f,model,rate);assert.deepEqual(split,x,`${f.name}: split CPU differs`);assert.deepEqual(n,x,`${f.name}: Native CPU differs`);
  const {pcm,program,...state}=x;map.set(`${rate}:${model}:${f.id}`,x);
  report.cases.push({fixture:f.name,id:f.id,rate,model,...state,program:digest(Buffer.from(program)),pcm:digest(pcm),nativeWasm:true,chunked:true});
}
for(const rate of [44100,48000,96000]){
  const x=map.get(`${rate}:6581:1`),y=map.get(`${rate}:8580:1`);
  assert.deepEqual(x.program,y.program,'Model must not rewrite CPU program');
  assert.notEqual(x.reads[0].value,y.reads[0].value);assert.notEqual(x.signature[1],y.signature[1]);assert.notEqual(x.registers[0],y.registers[0]);
}
report.checks.actualReadChangesCpuBranchAndSidWrite=true;
const f=sid8580CpuFixtures()[1],h=a.sid8cpu_create(48000,1,f.id);assert(h);
assert.equal(a.sid8cpu_run(h,32769)>>>0,0xffffffff);assert.equal(count(h,'cycles'),0);
advance(h,120000);const accepted=snapshot(h);a.sid8cpu_stop(h);const stopped=snapshot(h);
assert.equal(a.sid8cpu_run(h,1000),0);assert.equal(count(h,'cycles'),stopped.cycles);assert.equal(a.sid8cpu_output_frames(h),0);
a.sid8cpu_reset(h);assert.equal(count(h,'cycles'),0);assert.equal(a.sid8cpu_read_count(h),0);
assert.deepEqual(advance(h,120000),map.get('48000:8580:1').pcm);assert.deepEqual(snapshot(h),accepted);
assert.equal(a.sid8cpu_read_event(h,999,0)>>>0,0xffffffff);assert.equal(a.sid8cpu_signature(h,16),256);
a.sid8cpu_destroy(h);assert.equal(a.sid8cpu_run(h,1)>>>0,0xffffffff);
assert.equal(a.sid8cpu_create(0,1,0),0);assert.equal(a.sid8cpu_create(48000,2,0),0);assert.equal(a.sid8cpu_create(48000,1,99),0);
const leases=[];for(let i=0;i<4;i++){const v=a.sid8cpu_create(48000,i&1,1);assert(v);leases.push(v);}
assert.equal(a.sid8cpu_create(48000,1,1),0);
for(let left=120000;left>0;){const n=Math.min(997,left);for(const v of leases)advance(v,n);left-=n;}
leases.forEach((v,i)=>{assert.deepEqual(snapshot(v),((({pcm,...s})=>s)(map.get(`48000:${i&1?8580:6581}:1`))));a.sid8cpu_destroy(v);});
const replacement=a.sid8cpu_create(48000,1,0);assert(replacement&&replacement!==h);a.sid8cpu_destroy(replacement);
for(const input of ['SID8CPU 1 48000 8580 99\n','SID8CPU 1 48000 8580 0\nc 10000\nbad\n','SID8CPU 1 48000 8580 0\nc 999999999\n']){
  const n=spawnSync(resolve(work,'sid8580-cpu'),[],{input});assert.notEqual(n.status,0);assert.equal(n.stdout.length,0);}
report.checks={...report.checks,nativeWasmCases:report.cases.length,splitInvariant:true,
  actualOscEnvReadDataFlow:true,unsupportedPotAndRomAndJamStop:true,stopResetStaleAndInvalid:true,instanceIsolation:true,validatesNativeBeforePcm:true};
for(const model of [6581,8580]){
  const fixture={...f,cycles:SID8580_CPU_CLOCK*3},t=performance.now(),x=render(fixture,48000,model),ms=performance.now()-t;
  report.benchmarks.push({model,cycles:x.cycles,frames:x.frames,ms,realtimeMultiple:3/(ms/1000),scope:'m6502+SID in one WASM; no JS per chip cycle; no Worklet or full C64'});
}
report.memoryBytes=a.memory.buffer.byteLength;report.passed=true;
if(options['--out']){await mkdir(dirname(options['--out']),{recursive:true});await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:true,cases:report.cases.length,checks:report.checks,benchmarks:report.benchmarks,out:options['--out']},null,2));
