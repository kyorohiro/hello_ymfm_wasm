#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest,probeReceipt,probeRoot} from './sid8580_probe_artifacts.mjs';
import {sid8580BusFixtures,SID_BUS_TTL} from '../test/helpers/sid8580_bus_fixtures.mjs';
import {probeProtocol,PROBE_CLOCK} from '../test/helpers/sid8580_probe_fixtures.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){assert(['--work-dir','--out','--reference'].includes(args[i])&&args[i+1]);options[args[i]]=resolve(args[++i]);}
const work=options['--work-dir']??resolve(probeRoot,'build/sid8580-probe'),receipt=await probeReceipt(work,{check:true});
const {instance}=await WebAssembly.instantiate(await readFile(resolve(work,'sid8580-probe.wasm')),{}),a=instance.exports;
function run(fixture,model,rate,chunk){
  const h=a.sid8p_create(rate,model===8580?1:0),reads=[],pcm=[];assert(h);
  try{
    for(const c of fixture.commands){
      if(c[0]==='w')assert.equal(a.sid8p_write(h,c[1],c[2]),1);
      else if(c[0]==='r'){const v=a.sid8p_read(h,c[1]);assert(v<256);reads.push(v);}
      else for(let left=c[1];left>0;){const n=Math.min(left,chunk),frames=a.sid8p_run(h,n)>>>0;assert(frames<=4096);
        pcm.push(Buffer.from(new Uint8Array(a.memory.buffer,a.sid8p_output(h),frames*2)));left-=n;}
    }
    return {reads,pcm:Buffer.concat(pcm),cycles:a.sid8p_cycles_lo(h),frames:a.sid8p_frames_lo(h),
      busValue:a.sid8p_bus_value(h),busRemaining:a.sid8p_bus_remaining(h)};
  }finally{a.sid8p_destroy(h);}
}
const report={format:'tetorica-sid8580-bus-verification',version:1,passed:false,wasm:receipt.outputs['sid8580-probe.wasm'],
  hardwareTimingVerified:false,policy:'Reference-measured TTL; write/readable-read refresh; write-only read halves residual with minimum1; completed ticks expire it.',
  ttl:SID_BUS_TTL,cases:[],checks:{},reference:[],inputs:{}};
for(const p of ['scripts/check_sid8580_bus.mjs','test/helpers/sid8580_bus_fixtures.mjs','test/helpers/sid8580_probe_fixtures.mjs'])report.inputs[p]=digest(await readFile(resolve(probeRoot,p)));
for(const rate of [44100,48000,96000])for(const model of [6581,8580])for(const f of sid8580BusFixtures(model)){
  const x=run(f,model,rate,32768),split=run(f,model,rate,997);
  assert.deepEqual(x,split,`${f.name}: split rendering`);assert.deepEqual(x.reads,f.expectedReads,`${f.name}/${model}`);
  assert.equal(x.cycles,f.cycles);assert.equal(x.frames,Math.floor(f.cycles*rate/PROBE_CLOCK));
  const n=spawnSync(resolve(work,'sid8580-probe'),[],{input:probeProtocol(f,rate,model),maxBuffer:2*1024*1024});
  assert.equal(n.status,0,n.stderr.toString());assert.deepEqual(n.stdout,x.pcm);
  const state=JSON.parse(n.stderr.toString());assert.deepEqual(state.reads,x.reads);assert.equal(state.busValue,x.busValue);assert.equal(state.busRemaining,x.busRemaining);
  report.cases.push({name:f.name,rate,model,reads:x.reads,cycles:x.cycles,frames:x.frames,busValue:x.busValue,busRemaining:x.busRemaining,pcm:digest(x.pcm),nativeWasm:true,split:true});
  if(rate===48000&&options['--reference']){
    const r=spawnSync(options['--reference'],[],{input:probeProtocol(f,rate,model),maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stderr.toString());
    const reference=JSON.parse(r.stderr.toString()).reads,same=JSON.stringify(reference)===JSON.stringify(x.reads);
    if(f.referenceShouldMatch)assert(same,`Unexpected external bus difference ${model}/${f.name}`);
    report.reference.push({model,name:f.name,candidate:x.reads,reference,same,exactMatchRequired:f.referenceShouldMatch,
      difference:f.name==='oscillator-read-drives-bus'?'Different oscillator initial phase':f.referenceShouldMatch?null:'Intentionally bounded residual: reference latch remains at residual-zero edge'});
  }
}
const h=a.sid8p_create(48000,1),other=a.sid8p_create(48000,0);assert(h&&other);
a.sid8p_write(h,0,165);a.sid8p_write(other,0,60);
const before={v:a.sid8p_bus_value(h),ttl:a.sid8p_bus_remaining(h),cycles:a.sid8p_cycles_lo(h)};
assert.equal(a.sid8p_read(h,25),256);assert.equal(a.sid8p_error(h),5);
assert.equal(a.sid8p_read(h,26),256);assert.equal(a.sid8p_error(h),5);
assert.equal(a.sid8p_write(h,32,1),0);
assert.deepEqual({v:a.sid8p_bus_value(h),ttl:a.sid8p_bus_remaining(h),cycles:a.sid8p_cycles_lo(h)},before);
assert.equal(a.sid8p_bus_value(other),60);a.sid8p_run(other,10000);
assert.equal(a.sid8p_bus_value(other),0);assert.equal(a.sid8p_bus_value(h),165);
a.sid8p_stop(h);assert.equal(a.sid8p_bus_value(h),0);assert.equal(a.sid8p_bus_remaining(h),0);
a.sid8p_write(h,31,85);a.sid8p_reset(h);assert.equal(a.sid8p_bus_value(h),0);assert.equal(a.sid8p_bus_remaining(h),0);
a.sid8p_destroy(h);a.sid8p_destroy(other);
for(const reg of [25,26]){const r=spawnSync(resolve(work,'sid8580-probe'),[],{input:`SID8PROBE 1 48000 8580\nw 0 165\nc 10000\nr ${reg}\n`});assert.notEqual(r.status,0);assert.equal(r.stdout.length,0);}
report.checks={nativeWasmCases:report.cases.length,expiryBoundaries:true,readUpdatesAndSideEffects:true,
  noClockReads:true,noImmortalResidual:true,invalidAndPotPreserveBus:true,resetStopAndIsolation:true,potRejectedBeforePcm:true};
report.passed=true;
if(options['--out']){await mkdir(dirname(options['--out']),{recursive:true});await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:true,cases:report.cases.length,referenceCases:report.reference.length,checks:report.checks,out:options['--out']},null,2));
