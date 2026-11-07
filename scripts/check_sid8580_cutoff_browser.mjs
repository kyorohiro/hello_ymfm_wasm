#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Actual browser WASM parity only; does not open physical audio or a Worklet.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {digest,probeReceipt,probeRoot} from './sid8580_probe_artifacts.mjs';
import {sid8580CutoffFixtures} from '../test/helpers/sid8580_cutoff_fixtures.mjs';
import {QUALITY_CLOCK} from '../test/helpers/sid8580_quality_fixtures.mjs';
const options={},argv=process.argv.slice(2);
for(let i=0;i<argv.length;i++){assert(['--work-dir','--report','--out'].includes(argv[i])&&argv[i+1]);options[argv[i]]=resolve(argv[++i]);}
assert(options['--report'],'A current cutoff Native/WASM report is required');
const work=options['--work-dir']??resolve(probeRoot,'build/sid8580-probe'),receipt=await probeReceipt(work,{check:true});
const wasm=await readFile(resolve(work,'sid8580-probe.wasm')),native=JSON.parse(await readFile(options['--report']));
assert(native.passed);assert.equal(native.dataset,'holdout');assert.deepEqual(native.wasm,receipt.outputs['sid8580-probe.wasm']);
assert.deepEqual(native.profiles,{resonance:true,cutoff:true},'This browser check requires both explicit profiles');
assert.equal(native.curves.length,10,'A complete ten-curve holdout report is required');
assert.equal(native.cases.length,270,'A complete 270-capture report is required');
assert.equal(native.checks.nativeWasmAndChunkCases,270);
const all=sid8580CutoffFixtures({validation:true}),selected=new Map();
for(const curve of native.curves){
  const pair=all.filter(f=>f.curveKey===curve.key&&f.frequencyIndex===4);assert.equal(pair.length,2);
  for(const f of pair)selected.set(f.name,f);
  const f=pair[0],dry=all.find(d=>d.kind==='dry'&&d.dryKey===f.dryKey&&d.harmonic===f.harmonic);assert(dry);selected.set(dry.name,dry);
}
assert.equal(selected.size,native.curves.length*3);
assert.equal(selected.size,30);
assert.deepEqual([...new Set([...selected.values()].map(f=>f.rate))].sort((a,b)=>a-b),[44100,48000,96000]);
const report={format:'tetorica-sid8580-cutoff-browser',version:1,passed:false,productionAdopted:false,
  wasm:digest(wasm),nativeReport:digest(await readFile(options['--report'])),
  inputs:{checker:digest(await readFile(new URL(import.meta.url))),fixtures:digest(await readFile(resolve(probeRoot,'test/helpers/sid8580_cutoff_fixtures.mjs')))},
  profiles:native.profiles,physicalAudioOpened:false,workletTested:false,results:[]};
const server=createServer((req,res)=>{
  if(req.url==='/probe.wasm'){res.writeHead(200,{'Content-Type':'application/wasm'});res.end(wasm);}
  else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Isolated cutoff browser check</title>');}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
try{
  for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
    const browser=await type.launch({headless:true});
    try{
      const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const cases=await page.evaluate(async({scenes,profiles,clock})=>{
        const {instance}=await WebAssembly.instantiateStreaming(fetch('/probe.wasm'),{}),a=instance.exports;
        const count=(h,n)=>(a[`sid8p_${n}_lo`](h)>>>0)+(a[`sid8p_${n}_hi`](h)>>>0)*2**32;
        const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
        const results=[];
        for(const f of scenes){
          const h=a.sid8p_create(f.rate,1);if(!h)throw Error('allocation');
          try{
            if(a.sid8p_calibration(h)!==0||a.sid8p_cutoff_calibration(h)!==0)throw Error('default profiles must be off');
            if(a.sid8p_set_8580_calibration(h,Number(profiles.resonance))!==1
              ||a.sid8p_set_8580_cutoff_calibration(h,Number(profiles.cutoff))!==1)throw Error('explicit profiles');
            const chunks=[],reads=[],readEvents=[],captureRanges=[];let length=0,captured=0;
            for(const c of f.commands){
              if(c[0]==='w'){if(a.sid8p_write(h,c[1],c[2])!==1)throw Error('write');}
              else if(c[0]==='r'){const value=a.sid8p_read(h,c[1]);if(value>255)throw Error('read');reads.push(value);readEvents.push({cycle:count(h,'cycles'),register:c[1],value});}
              else{
                const startCycle=count(h,'cycles'),startFrame=count(h,'frames');
                for(let left=c[1];left>0;){const n=Math.min(left,997),frames=a.sid8p_run(h,n)>>>0;if(frames>4096)throw Error('render');
                  if(c[0]==='c'){const b=new Uint8Array(a.memory.buffer,a.sid8p_output(h),frames*2).slice();chunks.push(b);length+=b.length;}left-=n;}
                const endCycle=count(h,'cycles'),endFrame=count(h,'frames'),frames=endFrame-startFrame;
                if(c[0]==='c'){captureRanges.push({startCycle,endCycle,startFrame,endFrame,captureOffset:captured,frames,
                  firstSampleCycle:frames?Math.ceil((startFrame+1)*clock/f.rate):null,lastSampleCycle:frames?Math.ceil(endFrame*clock/f.rate):null});captured+=frames;}
              }
            }
            const b=new Uint8Array(length);let at=0;for(const c of chunks){b.set(c,at);at+=c.length;}
            results.push({name:f.name,rate:f.rate,reads,readEvents,captureRanges,cycles:count(h,'cycles'),frames:captured,generatedFrames:count(h,'frames'),pcm:{bytes:b.length,sha256:await hash(b)}});
            for(const operation of ['stop','reset']){
              if(a[`sid8p_${operation}`](h)!==1||a.sid8p_calibration(h)!==Number(profiles.resonance)
                ||a.sid8p_cutoff_calibration(h)!==Number(profiles.cutoff))throw Error('profile preservation');
            }
          }finally{a.sid8p_destroy(h);}
        }
        return results;
      },{scenes:[...selected.values()],profiles:native.profiles,clock:QUALITY_CLOCK});
      for(const c of cases){const expected=native.cases.find(n=>n.name===c.name);assert(expected);
        for(const k of ['pcm','reads','readEvents'])assert.deepEqual(c[k],expected.candidate[k],`${engine} ${c.name} ${k}`);
        for(const k of ['captureRanges','cycles','frames','generatedFrames','rate'])assert.deepEqual(c[k],expected[k],`${engine} ${c.name} ${k}`);}
      assert.deepEqual(errors,[]);report.results.push({engine,version:browser.version(),cases,errors,resetStopPreserveBothProfiles:true});
      console.log(`${engine}: ${cases.length} LP/HP/dry Native matches at three rates`);
    }finally{await browser.close();}
  }
  report.passed=true;
  if(options['--out']){await mkdir(dirname(options['--out']),{recursive:true});await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');}
}finally{await new Promise(resolve=>server.close(resolve));}
