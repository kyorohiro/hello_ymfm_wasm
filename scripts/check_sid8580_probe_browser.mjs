#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// WASM core only. No AudioContext, Worklet, physical output or product UI.
import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,dirname} from 'node:path';
import {probeRoot,digest,probeReceipt} from './sid8580_probe_artifacts.mjs';
import {sid8580ProbeFixtures,PROBE_CLOCK} from '../test/helpers/sid8580_probe_fixtures.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){assert(['--work-dir','--out','--native-report'].includes(args[i])&&args[i+1]);options[args[i]]=resolve(args[++i]);}
const work=options['--work-dir']??resolve(probeRoot,'build/sid8580-probe');
const receipt=await probeReceipt(work,{check:true}),wasm=await readFile(resolve(work,'sid8580-probe.wasm'));
assert(options['--native-report'],'--native-report is required to check actual PCM identity');
const native=JSON.parse(await readFile(options['--native-report']));assert(native.passed);
assert.deepEqual(native.wasm,receipt.outputs['sid8580-probe.wasm']);
const fixtures=sid8580ProbeFixtures(),report={format:'tetorica-sid8580-probe-browser',version:1,
  wasm:digest(wasm),passed:false,physicalAudioOpened:false,workletTested:false,
  checker:digest(await readFile(resolve(probeRoot,'scripts/check_sid8580_probe_browser.mjs'))),
  nativeReport:digest(await readFile(options['--native-report'])),
  interpretation:'Standalone WASM throughput and integer PCM/read parity, not full C64 or real-time audio scheduling.',results:[]};
const server=createServer((req,res)=>{
  if(req.url==='/probe.wasm'){res.writeHead(200,{'Content-Type':'application/wasm'});res.end(wasm);}
  else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Isolated SID8580 WASM check</title>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
try{
  for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
    const browser=await type.launch({headless:true});
    try{
      const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
      await page.goto(url);
      const result=await page.evaluate(async({fixtures,clock})=>{
        const started=performance.now(),{instance}=await WebAssembly.instantiateStreaming(fetch('/probe.wasm'),{}),api=instance.exports;
        const instantiateMs=performance.now()-started,cases=[],benchmarks=[];
        const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('');
        function render(fixture,model,rate=48000){
          const h=api.sid8p_create(rate,model===8580?1:0);if(!h)throw Error('allocation');
          const chunks=[],reads=[];let length=0;
          try{
            for(const a of fixture.commands){
              if(a[0]==='w'){if(!api.sid8p_write(h,a[1],a[2]))throw Error('write');}
              else if(a[0]==='r')reads.push(api.sid8p_read(h,a[1]));
              else for(let left=a[1];left>0;){const n=Math.min(left,32768),frames=api.sid8p_run(h,n)>>>0;if(frames>4096)throw Error('render');
                const b=new Uint8Array(api.memory.buffer,api.sid8p_output(h),frames*2).slice();chunks.push(b);length+=b.length;left-=n;}
            }
            const b=new Uint8Array(length);let at=0;for(const c of chunks){b.set(c,at);at+=c.length;}
            return {b,reads,cycles:api.sid8p_cycles_lo(h),frames:api.sid8p_frames_lo(h)};
          }finally{api.sid8p_destroy(h);}
        }
        for(const model of [6581,8580]){
          for(const f of fixtures){const r=render(f,model);cases.push({model,name:f.name,rate:48000,reads:r.reads,cycles:r.cycles,frames:r.frames,pcm:{bytes:r.b.length,sha256:await hash(r.b)}});}
          const f=fixtures.find(f=>f.name==='filter-sweep'),bench={commands:[...f.commands,['c',clock*3]]};
          const t=performance.now(),r=render(bench,model),ms=performance.now()-t;
          benchmarks.push({model,rate:48000,cycles:r.cycles,frames:r.frames,ms,realtimeMultiple:r.cycles/clock/(ms/1000)});
        }
        return {cases,benchmarks,memoryBytes:api.memory.buffer.byteLength,instantiateMs};
      },{fixtures,clock:PROBE_CLOCK});
      assert.equal(errors.length,0,errors.join('\n'));
      for(const c of result.cases){const expected=native.cases.find(n=>n.name===c.name&&n.model===c.model&&n.rate===c.rate);
        assert(expected);assert.deepEqual(c.pcm,expected.pcm);assert.deepEqual(c.reads,expected.reads);assert.equal(c.cycles,expected.cycles);assert.equal(c.frames,expected.measurement.frames);}
      report.results.push({engine,version:browser.version(),passed:true,...result,errors});
      console.log(`${engine}: ${result.cases.length} Native/WASM PCM/read matches; core throughput ${result.benchmarks.map(b=>b.realtimeMultiple.toFixed(1)+'x').join('/')}`);
    }finally{await browser.close();}
  }
  report.passed=true;
  if(options['--out']){await mkdir(dirname(options['--out']),{recursive:true});await writeFile(options['--out'],JSON.stringify(report,null,2)+'\n');}
}finally{await new Promise(resolve=>server.close(resolve));}
