#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Optional local-music experiment. Normal Player assets are served unchanged;
// instrumented Worklets exist only in this checker's HTTP responses.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {chromium,webkit} from 'playwright';
import {validateSidWorkletPerfPlan} from './sid_worklet_perf_plan.mjs';
import {createSidPairFixture} from '../test/helpers/sid_voice_pair_fixtures.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const options={plan:resolve(root,'docs/issues/sid_worklet_perf_plan_02.json'),
  corpus:resolve(root,'ww/C64Music'),docs:resolve(root,'docs'),out:resolve(root,'release/sid-worklet-performance.json'),
  engines:'webkit,chromium',limit:null,resume:false,validateOnly:false};
for(let i=2;i<process.argv.length;i++){
  const flag=process.argv[i];
  if(flag==='--resume'){options.resume=true;continue;}
  if(flag==='--validate-only'){options.validateOnly=true;continue;}
  const key={'--plan':'plan','--corpus':'corpus','--docs':'docs','--out':'out','--engines':'engines','--limit':'limit'}[flag];
  const value=process.argv[++i];assert(key&&value&&!value.startsWith('--'),'Invalid SID performance option '+flag);
  options[key]=key==='engines'?value:key==='limit'?Number(value):resolve(value);
}
const engines=options.engines.split(',');assert(engines.length&&new Set(engines).size===engines.length&&engines.every(e=>['webkit','chromium'].includes(e)));
if(options.limit!==null)assert(Number.isInteger(options.limit)&&options.limit>0&&options.limit<=80);
const sha=b=>createHash('sha256').update(b).digest('hex'),record=b=>({bytes:b.length,sha256:sha(b)});
const planBytes=await readFile(options.plan),plan=await validateSidWorkletPerfPlan(options.plan,{corpusRoot:options.corpus});
const plannedEngineOrder=[...new Set(plan.runs.map(run=>run.engine))];
assert.deepEqual(engines,plannedEngineOrder.filter(engine=>engines.includes(engine)),'Keep the frozen plan engine order');
const selectedRuns=plan.runs.filter(run=>engines.includes(run.engine)).slice(0,options.limit??Infinity);
assert(selectedRuns.length);
const songs=new Map();
for(const item of plan.cases){
  const bytes=item.source==='generated'?createSidPairFixture(item.generated.options).bytes:await readFile(resolve(options.corpus,item.path));
  assert.deepEqual(record(bytes),item.input,'Selected program differs: '+item.id);songs.set(item.id,{...item,bytes});
}
const metricSource=await readFile(resolve(root,'scripts/sid_worklet_metrics.mjs'),'utf8');
const processor=await readFile(resolve(options.docs,'sid-player/processor.js'),'utf8');
const inputs={};
for(const name of ['scripts/check_sid_worklet_performance.mjs','scripts/sid_worklet_metrics.mjs','scripts/sid_worklet_perf_plan.mjs',
  'docs/sid-player/index.html','docs/sid-player/player.js','docs/sid-player/processor.js','docs/sid-player/audio.js',
  'docs/sid-player/core.js','docs/sid-player/rsid_core.js','docs/sid-player/core8580.js','docs/sid8580-lab/core.js',
  'docs/synth-spu/spu_synth_visualizer.js','docs/generated/sid-rsid/sid-rsid.wasm','docs/generated/sid-rsid/sid-rsid-build.json',
  'docs/generated/sid8580-machine/sid8580-endpoint.wasm','docs/generated/sid8580-machine/sid8580-machine.wasm',
  'docs/generated/sid8580-machine/sid8580-machine-build.json']){
  const source=name.startsWith('docs/')?resolve(options.docs,name.slice(5)):resolve(root,name);
  inputs[name]=record(await readFile(source));
}

function measuredProcessor(mode){
  assert(['timed','capture','quiet-ui'].includes(mode));
  const config=JSON.stringify({mode,...plan.measurement});
  return `import {SidWorkletMetrics} from '/__sid-perf/metrics.js';\n`+String.raw`
const sidPerfConfig=CONFIG;
const sidPerfRegister=globalThis.registerProcessor;
function registerProcessor(name,Original){
  class Measured extends Original{
    constructor(...args){
      super(...args);
      this.perfClock=globalThis.performance?.now?()=>globalThis.performance.now():()=>Date.now();
      this.perfTimerSource=globalThis.performance?.now?'performance.now':'Date.now';
      const settings={sampleRate,timerSource:this.perfTimerSource,quantumMs:1};
      this.perfWarmup=new SidWorkletMetrics(settings);this.perfWindow=new SidWorkletMetrics(settings);
      this.perfBlocks=0;this.perfComplete=false;this.perfStart=null;this.perfEnd=null;
      this.perfScan={scope:'Warmup plus measurement window; timing histograms keep those intervals separate.',
        frames:0,nonzeroFrames:0,nonfiniteSamples:0,stereoMismatches:0,missingChannelFrames:0,squareSum:0,peak:0};
    }
    receive(data){
      if(data?.method==='__perf-snapshot'){
        this.port.postMessage({id:data.id,value:{complete:this.perfComplete,timerSource:this.perfTimerSource,
          warmup:this.perfWarmup.snapshot(),window:this.perfWindow.snapshot(),scan:this.perfScan,
          start:this.perfStart,end:this.perfEnd,producerState:super.state()}});return;
      }
      return super.receive(data);
    }
    perfState(){
      const s=super.state();return {positionFrames:s.positionFrames,cycles:s.cycles,sidCycles:s.sidCycles,
        irqCount:s.irqCount,nmiCount:s.nmiCount,playCalls:s.playCalls,model:s.model,format:s.format,timing:s.timing};
    }
    process(inputs,outputs,parameters){
      if(!this.core||!this.playing||this.dead||this.perfComplete)return super.process(inputs,outputs,parameters);
      const frameCount=outputs[0]?.[0]?.length??0;
      if(frameCount!==sidPerfConfig.quantumFrames)throw Error('Unexpected render quantum');
      const isWindow=this.perfBlocks>=sidPerfConfig.warmupBlocks;
      if(isWindow&&!this.perfStart)this.perfStart=this.perfState();
      const began=this.perfClock(),alive=super.process(inputs,outputs,parameters),renderEnd=this.perfClock();
      if(sidPerfConfig.mode==='capture'){
        const [left,right]=outputs[0]??[],s=this.perfScan;
        for(let i=0;i<frameCount;i++){
          if(!left||!right)s.missingChannelFrames++;
          const x=left?.[i]??0,y=right?.[i]??0;
          if(!Number.isFinite(x)||!Number.isFinite(y)){s.nonfiniteSamples++;continue;}
          if(x!==y)s.stereoMismatches++;if(x!==0)s.nonzeroFrames++;
          s.squareSum+=x*x;s.peak=Math.max(s.peak,Math.abs(x));
        }
        s.frames+=frameCount;
      }
      const totalEnd=sidPerfConfig.mode==='capture'?this.perfClock():renderEnd;
      (isWindow?this.perfWindow:this.perfWarmup).record(renderEnd-began,totalEnd-began,frameCount,began);
      this.perfBlocks++;
      if(this.perfBlocks===sidPerfConfig.warmupBlocks+sidPerfConfig.windowBlocks){
        this.perfComplete=true;this.perfEnd=this.perfState();
        this.port.postMessage({sidPerfWindowComplete:true});
      }
      return alive;
    }
  }
  sidPerfRegister(name,Measured);
}
`.replace('CONFIG',config)+'\n'+processor;
}
const sources={ordinary:processor,...Object.fromEntries(['timed','capture','quiet-ui'].map(mode=>[mode,measuredProcessor(mode)]))};
const runSelection={engines,limit:options.limit,indices:selectedRuns.map(r=>r.index)};
let report={format:'tetorica-sid-worklet-performance',version:1,completed:false,allPlannedRunsExecuted:false,
  environment:{platform:process.platform,arch:process.arch,osRelease:os.release(),node:process.version,
    cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,initialLoadAverage:os.loadavg(),
    note:'One experiment browser/page/context at a time. Other OS activity is uncontrolled; load average is context, not this Worklet CPU utilization.'},
  plan:{path:options.plan,...record(planBytes)},inputs,selection:runSelection,
  measurement:plan.measurement,processorResponses:Object.fromEntries(Object.entries(sources).map(([m,s])=>[m,record(Buffer.from(s))])),
  physicalOutputMuted:true,listeningPerformed:false,gameOrFirmwareOrPcmSaved:false,
  interpretation:{ordinary:'Production processor bytes unchanged: no per-block timer, counters or PCM scan. Processing-time metrics are unavailable.',
    timing:'Instrumented producer process() wall span includes renderInto and stereo copy, not pure WASM or CPU time; total adds the old-style PCM scan. Aggregate updates and boundary state reads are outside the timer.',
    clocks:'AudioContext.currentTime/currentFrame are logical progress, never render-duration clocks. Date.now is non-monotonic. The same nominal 1ms quantization allowance is used for observed clocks as a declared assumption, not a measured error guarantee.',
    windows:'Only instrumented modes pre-arm an identical producer-frame window. Ordinary mode remains a distinct approximate wall-duration progress baseline, with actual IPC bookend positions recorded; it has no measured producer-cost or full-PCM window.',
    outcome:'Timing threshold counts, context progress and sparse analyser samples do not establish actual device underruns, audible glitches, whole-song compatibility or long-term stability.'},
  results:[],abandonedRuns:[],activeRun:null,servedInputs:{}};
try{
  const previous=JSON.parse(await readFile(options.out,'utf8'));
  assert(options.resume,'Output already exists; use a new --out or --resume');
  assert.equal(previous.format,report.format);assert.deepEqual(previous.plan,report.plan);assert.deepEqual(previous.inputs,inputs);assert.deepEqual(previous.selection,runSelection);
  if(previous.activeRun)previous.abandonedRuns.push(previous.activeRun);
  report={...previous,completed:false,activeRun:null};
}catch(error){if(error.code!=='ENOENT')throw error;assert(!options.resume,'No report to resume');}
if(options.validateOnly){console.log(JSON.stringify({valid:true,plannedRuns:plan.runs.length,selectedRuns:selectedRuns.length,files:songs.size,measurement:plan.measurement}));process.exit(0);}
async function save(){await mkdir(dirname(options.out),{recursive:true});const temp=options.out+'.tmp';await writeFile(temp,JSON.stringify(report,null,2)+'\n');await rename(temp,options.out);}
await save();let stopping=false;
const stop=()=>{stopping=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);

function instrumentPage({quiet,sampleRate}){
  const audit=window.__sidPerf={contexts:[],nodes:[],sinks:[],fatal:[],nextId:0,done:false,suppressedRaf:0,suppressedPoll:0};
  audit.windowPromise=new Promise(resolve=>{audit.finishWindow=resolve;});
  const Context=window.AudioContext??window.webkitAudioContext,Node=window.AudioWorkletNode,connect=AudioNode.prototype.connect;
  window.AudioContext=class extends Context{
    constructor(settings={}){super({...settings,sampleRate});audit.contexts.push(this);}
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Node{
    constructor(...args){super(...args);audit.nodes.push(this);this.port.addEventListener('message',({data})=>{
      if(data?.fatal)audit.fatal.push(data.error);if(data?.sidPerfWindowComplete){audit.done=true;audit.finishWindow();}
    });this.port.start();}
  };
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){
      const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
      connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);
      audit.sinks.push({context:this.context,analyser,mute});return destination;
    }
    return connect.call(this,destination,...args);
  };
  if(quiet){
    window.requestAnimationFrame=()=>{audit.suppressedRaf++;return 0;};
    const interval=window.setInterval;
    window.setInterval=function(fn,delay,...args){if(delay===200){audit.suppressedPoll++;return 0;}return interval(fn,delay,...args);};
  }
  audit.command=(method='read')=>new Promise((resolve,reject)=>{
    const node=audit.nodes.findLast(n=>n.context.state!=='closed');if(!node)return reject(Error('No active Worklet'));
    const id=--audit.nextId,timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Audit read timed out'));},15000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.postMessage({id,method,args:[]});
  });
  audit.boundary=async()=>{
    const before=performance.now(),state=await audit.command(),after=performance.now();
    const sink=audit.sinks.findLast(s=>s.context.state==='running'),samples=new Float32Array(4096);
    if(sink)sink.analyser.getFloatTimeDomainData(samples);
    let squares=0,peak=0;for(const value of samples){squares+=value*value;peak=Math.max(peak,Math.abs(value));}
    const context=sink?.context;
    return {wallBeforeMs:before,wallAfterMs:after,contextTime:context?.currentTime,state,
      output:{frames:samples.length,rms:Math.sqrt(squares/samples.length),peak,finite:samples.every(Number.isFinite)},
      muted:audit.sinks.length>0&&audit.sinks.every(s=>s.mute.gain.value===0),visibility:document.visibilityState,
      sampleRate:context?.sampleRate,baseLatency:context?.baseLatency??null,outputLatency:context?.outputLatency??null};
  };
  audit.close=async()=>{await Promise.all(audit.contexts.map(c=>c.state==='closed'?null:c.close()));return audit.contexts.map(c=>c.state);};
}

let activeMode='ordinary';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.png':'image/png','.sid':'application/octet-stream'};
const staticResponses=new Map();
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let bytes;
    if(pathname==='/__sid-perf/metrics.js')bytes=metricSource;
    else if(pathname==='/sid-player/processor.js')bytes=sources[activeMode];
    else{
      if(!staticResponses.has(pathname)){
        const file=resolve(options.docs,'.'+pathname);assert(file.startsWith(options.docs+sep));assert((await stat(file)).isFile());
        const original=await readFile(file),hash=record(original);
        if(report.servedInputs[pathname])assert.deepEqual(hash,report.servedInputs[pathname],'A served source changed since the interrupted run');
        report.servedInputs[pathname]=hash;staticResponses.set(pathname,original);
      }
      bytes=staticResponses.get(pathname);
    }
    res.writeHead(200,{'content-type':mime[extname(pathname)]??'application/octet-stream','cache-control':'no-store'});res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;
try{
  for(const engine of engines){
    const runs=selectedRuns.filter(run=>run.engine===engine&&!report.results.some(row=>row.index===run.index));
    if(!runs.length)continue;
    const browser=await({webkit,chromium}[engine]).launch({headless:true});
    try{
      for(const run of runs){
        if(stopping)break;
        activeMode=run.mode;const item=songs.get(run.caseId),row={...run,status:'running',browserVersion:browser.version(),loadAverageBefore:os.loadavg(),errors:[],consoleErrors:[],httpFailures:[],external:[]};
        report.activeRun={...run,startedAt:new Date().toISOString()};await save();
        const context=await browser.newContext({viewport:{width:1180,height:1000}}),page=await context.newPage();page.setDefaultTimeout(20000);
        try{
          await page.addInitScript(instrumentPage,{quiet:run.mode==='quiet-ui',sampleRate:plan.measurement.sampleRate});
          page.on('pageerror',error=>row.errors.push(error.message));page.on('console',m=>{if(m.type()==='error')row.consoleErrors.push(m.text());});
          page.on('response',r=>{if(r.status()>=400)row.httpFailures.push({path:new URL(r.url()).pathname,status:r.status()});});
          await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('blob:')||url.startsWith('data:'))return route.continue();row.external.push(url);return route.abort();});
          await page.goto(origin+'/sid-player/index.html');await page.bringToFront();
          await page.locator('#sidFile').setInputFiles({name:item.id+'.sid',mimeType:'application/octet-stream',buffer:Buffer.from(item.bytes)});
          await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('status').dataset.state),null,{polling:50});
          assert.equal(await page.locator('#status').getAttribute('data-state'),'ready',await page.locator('#status').textContent());
          if(Number(await page.locator('#subtune').inputValue())!==item.subtune){await page.locator('#subtune').selectOption(String(item.subtune));await page.waitForFunction(()=>document.getElementById('status').dataset.state==='ready',null,{polling:50});}
          await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('status').dataset.state==='playing',null,{polling:50});
          const start=await page.evaluate(()=>__sidPerf.boundary());
          assert.equal(start.sampleRate,plan.measurement.sampleRate);assert(start.muted);assert.equal(start.visibility,'visible');
          assert.equal(start.state.model,item.model);assert.equal(start.state.subtune,item.subtune);assert(start.state.playing);
          row.initial=start;
          if(run.mode==='ordinary'){
            await page.waitForTimeout(plan.measurement.ordinaryBaseline.warmupWaitMs);
            row.windowStart=await page.evaluate(()=>__sidPerf.boundary());
            await page.waitForTimeout(plan.measurement.ordinaryBaseline.windowWaitMs);
            row.windowEnd=await page.evaluate(()=>__sidPerf.boundary());row.metrics=null;
          }else{
            await page.evaluate(()=>new Promise((resolve,reject)=>{
              const timeout=setTimeout(()=>reject(Error('Worklet measurement window timed out')),25000);
              __sidPerf.windowPromise.then(()=>{clearTimeout(timeout);resolve();});
            }));
            row.metrics=await page.evaluate(()=>__sidPerf.command('__perf-snapshot'));
            row.windowEnd=await page.evaluate(()=>__sidPerf.boundary());
            assert(row.metrics.complete);assert.equal(row.metrics.warmup.blocks,plan.measurement.warmupBlocks);
            assert.equal(row.metrics.window.blocks,plan.measurement.windowBlocks);assert.equal(row.metrics.window.frames,plan.measurement.windowFrames);
            assert.equal(row.metrics.start.positionFrames,plan.measurement.warmupFrames);
            assert.equal(row.metrics.end.positionFrames-row.metrics.start.positionFrames,plan.measurement.windowFrames);
            assert.equal(row.metrics.window.render.invalidBlocks,0);assert.equal(row.metrics.window.total.invalidBlocks,0);
            if(run.mode==='capture'){
              assert.equal(row.metrics.scan.frames,plan.measurement.warmupFrames+plan.measurement.windowFrames);
              assert.equal(row.metrics.scan.nonfiniteSamples,0);assert.equal(row.metrics.scan.stereoMismatches,0);assert.equal(row.metrics.scan.missingChannelFrames,0);
            }else assert.equal(row.metrics.scan.frames,0);
          }
          const end=row.windowEnd;
          assert(end.state.playing);assert(end.state.positionFrames>start.state.positionFrames);assert(end.muted&&end.output.finite);assert.equal(end.visibility,'visible');
          row.producerFramesPerWallSecond=(end.state.positionFrames-start.state.positionFrames)/((end.wallBeforeMs+end.wallAfterMs-start.wallBeforeMs-start.wallAfterMs)/2000);
          row.nonzeroBoundaryObserved=[start.output,end.output].some(v=>v.rms>0);
          assert(row.nonzeroBoundaryObserved,'No nonzero output in the independent boundary samples');
          await page.locator('#stop').click();await page.waitForFunction(()=>document.getElementById('status').dataset.state==='stopped',null,{polling:50});
          const audit=await page.evaluate(()=>({fatal:__sidPerf.fatal,suppressedRaf:__sidPerf.suppressedRaf,suppressedPoll:__sidPerf.suppressedPoll}));
          row.audit=audit;assert.deepEqual(audit.fatal,[]);
          if(run.mode==='quiet-ui'){assert(audit.suppressedRaf>0);assert.equal(audit.suppressedPoll,1);}else{assert.equal(audit.suppressedRaf,0);assert.equal(audit.suppressedPoll,0);}
          assert.deepEqual(row.errors,[]);assert.deepEqual(row.consoleErrors,[]);assert.deepEqual(row.httpFailures,[]);assert.deepEqual(row.external,[]);
          row.status='passed';
        }catch(error){row.status='failed';row.error={message:error.message,stack:error.stack};}
        finally{row.closedContexts=await page.evaluate(()=>__sidPerf?.close()).catch(()=>null);await context.close();}
        row.loadAverageAfter=os.loadavg();report.results.push(row);report.activeRun=null;await save();
        console.log(JSON.stringify({run:run.index,engine,case:run.caseId,repeat:run.repetition,mode:run.mode,status:row.status,
          renderMs:row.metrics?.window.render.meanMs,totalMs:row.metrics?.window.total.meanMs,
          rawThreshold:row.metrics?.window.render.rawOverBudgetBlocks,error:row.error?.message}));
      }
    }finally{await browser.close();}
    if(stopping)break;
  }
  report.completed=selectedRuns.every(run=>report.results.some(row=>row.index===run.index));
  report.allPlannedRunsExecuted=report.completed&&selectedRuns.length===plan.runs.length;
  report.passed=report.completed&&report.results.every(row=>row.status==='passed');
  report.interrupted=stopping;await save();
  if(!report.passed)process.exitCode=1;
}finally{await new Promise(resolve=>server.close(resolve));process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
