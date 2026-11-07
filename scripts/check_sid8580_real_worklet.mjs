#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Optional repository tool for user-local music. Never writes song bytes or PCM.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,dirname,extname,sep,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium,webkit} from 'playwright';

const options={root:resolve('ww/C64Music'),docs:resolve('docs'),
  plan:resolve('docs/issues/sid8580_worklet_cases_plan_01.json'),
  out:resolve('docs/issues/sid8580_real_worklet_01.json'),engines:'chromium,webkit',validateOnly:false};
for(let i=2;i<process.argv.length;i++){
  const flag=process.argv[i];
  if(flag==='--validate-only'){options.validateOnly=true;continue;}
  assert(['--root','--docs','--plan','--out','--engines'].includes(flag)&&process.argv[i+1],`Unknown option ${flag}`);
  const key=flag.slice(2),value=process.argv[++i];options[key]=key==='engines'?value:resolve(value);
}
const engines=options.engines.split(',');assert(engines.length>0&&new Set(engines).size===engines.length&&engines.every(e=>['chromium','webkit'].includes(e)));
const digest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const planBytes=await readFile(options.plan),plan=JSON.parse(planBytes);
assert.equal(plan.format,'tetorica-sid8580-worklet-cases-plan');assert.equal(plan.version,1);
assert.equal(plan.secondsPerCase,30);assert(plan.files.length<=3&&plan.cases.length<=6);
assert.deepEqual(plan.profiles,{resonance:false,cutoff:false});
assert.deepEqual(plan.target,{clock:'pal',model:'8580',environment:'minimal'});
for(const [path,hash]of Object.entries(plan.inputs))assert.deepEqual(digest(await readFile(resolve(path))),hash,`Frozen selection input changed: ${path}`);
const songs=new Map();
for(const file of plan.files){
  const path=resolve(options.root,file.path);assert(path.startsWith(options.root+sep));
  const bytes=await readFile(path);assert.deepEqual(digest(bytes),file.input,`Selected file changed: ${file.path}`);
  assert.equal(file.header.clock,'pal');assert.equal(file.header.model,'8580');assert.equal(file.header.version,2);assert.equal(file.header.sidCount,1);
  songs.set(file.id,{...file,bytes});
}

// Only the checker HTTP response is instrumented. The original processor class,
// render path and production files are untouched. The subclass observes every
// emitted raw mono/stereo frame AFTER the original process() and its timer.
// Audit scan overhead is consequently outside the core-render measurement.
const auditPrefix=String.raw`
const auditRegisterProcessor=globalThis.registerProcessor;
function registerProcessor(name,Original){
  class ObservedProcessor extends Original{
    receive(data){
      if(data?.method==='audit-begin'){
        const frames=data.args?.[0];
        if(!Number.isInteger(frames)||frames<1||frames>sampleRate*120){this.port.postMessage({id:data.id,error:'Invalid audit frame limit'});return;}
        this.capture={targetFrames:frames,frames:0,nonzeroFrames:0,nonfiniteSamples:0,stereoMismatches:0,missingChannelFrames:0,
          squareSum:0,peak:0,aboveUnityFrames:0,complete:false,start:this.auditState(),end:null};
        this.port.postMessage({id:data.id,value:this.state()});return;
      }
      return super.receive(data);
    }
    auditState(){
      const state=super.state();
      return {positionFrames:state.positionFrames,cycles:state.cycles,sidCycles:state.sidCycles,
        initPending:state.initPending,initReturned:state.initReturned,irqCount:state.irqCount,nmiCount:state.nmiCount,playCalls:state.playCalls,
        worklet:{...state.worklet},memoryBytes:{machine:this.core.api.memory.buffer.byteLength,endpoint:this.core.endpoint.exports.memory.buffer.byteLength}};
    }
    state(){return {...super.state(),auditCapture:this.capture?{...this.capture}:null};}
    process(inputs,outputs,parameters){
      const alive=super.process(inputs,outputs,parameters),c=this.capture;
      if(c&&!c.complete&&this.playing&&!this.dead){
        const [left,right]=outputs[0]??[],n=Math.min(c.targetFrames-c.frames,left?.length??128);
        for(let i=0;i<n;i++){
          if(!left||!right)c.missingChannelFrames++;
          const x=left?.[i]??0,y=right?.[i]??0;
          if(!Number.isFinite(x)||!Number.isFinite(y)){c.nonfiniteSamples++;continue;}
          if(x!==y)c.stereoMismatches++;if(x!==0)c.nonzeroFrames++;
          c.squareSum+=x*x;c.peak=Math.max(c.peak,Math.abs(x));if(Math.abs(x)>1)c.aboveUnityFrames++;
        }
        c.frames+=n;
        if(c.frames===c.targetFrames){c.complete=true;c.end=this.auditState();}
      }
      return alive;
    }
  }
  auditRegisterProcessor(name,ObservedProcessor);
}
`;

const runtimeFiles=['sid8580-lab/index.html','sid8580-lab/lab.css',
  ...['core','parser','psid_structure','audio','processor','player','preflight'].map(n=>`sid8580-lab/${n}.js`),
  'js/sid_rsid.js','sid-player/roms.js',
  ...['sid8580-endpoint.wasm','sid8580-machine.wasm','sid8580-machine-build.json'].map(n=>`generated/sid8580-machine/${n}`)];
const inputs={};for(const path of runtimeFiles)inputs['docs/'+path]=digest(await readFile(resolve(options.docs,path)));
inputs['scripts/check_sid8580_real_worklet.mjs']=digest(await readFile(new URL(import.meta.url)));
inputs['scripts/select_sid8580_worklet_cases.mjs']=digest(await readFile(resolve('scripts/select_sid8580_worklet_cases.mjs')));
const originalProcessor=await readFile(resolve(options.docs,'sid8580-lab/processor.js'),'utf8');
const instrumentedProcessor=auditPrefix+'\n'+originalProcessor;
const receipt=JSON.parse(await readFile(resolve(options.docs,'generated/sid8580-machine/sid8580-machine-build.json')));
for(const name of ['sid8580-endpoint.wasm','sid8580-machine.wasm'])assert.deepEqual(inputs['docs/generated/sid8580-machine/'+name],receipt.outputs[name]);
const report={format:'tetorica-sid8580-real-worklet',version:1,completed:false,allCasesExecuted:false,
  date:'2026-11-08',researchOnly:true,productionAdopted:false,physicalOutputMuted:true,listeningPerformed:false,
  bundledMusic:false,bundledPcm:false,userFirmwareUsed:false,plan:digest(planBytes),inputs,
  capture:{secondsPerCase:plan.secondsPerCase,scope:'Every emitted raw producer frame before Master; stereo equality and finite values, scalar aggregates only.',
    injection:'HTTP-only registerProcessor subclass calls original process() unchanged, then scans its output. No per-chip-cycle JavaScript wrapper.',
    originalProcessor:inputs['docs/sid8580-lab/processor.js'],instrumentedProcessor:digest(Buffer.from(instrumentedProcessor)),
    timing:'Original core-render timer excludes added scan; Date.now may be coarse. Window deltas, lifetime max and load timing are reported separately.',
    memory:'WASM linear-memory byte lengths at capture boundaries only; not allocation occupancy or JS heap/leak analysis.'},
  target:plan.target,profiles:plan.profiles,enginesRequested:engines,results:[],
  interpretation:'Bounded real-file execution, not listening approval, whole-song/corpus compatibility, glitch-free playback or hardware accuracy. Failures and silence are retained; no execution-based replacement.'};
async function save(){await mkdir(dirname(options.out),{recursive:true});await writeFile(options.out,JSON.stringify(report,null,2)+'\n');}
if(options.validateOnly){console.log(JSON.stringify({valid:true,files:songs.size,cases:plan.cases.length,plan:report.plan,inputs:Object.keys(inputs).length}));process.exit(0);}
await save();

function instrument(){
  const audit=window.__sid8580RealAudit={contexts:[],nodes:[],sinks:[],nextId:0,fatal:[],contextEvents:[]};
  const Context=window.AudioContext??window.webkitAudioContext,Node=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect;
  window.AudioContext=class extends Context{constructor(...args){super(...args);const id=audit.contexts.length;
    audit.contexts.push(this);this.addEventListener('statechange',()=>audit.contextEvents.push({id,state:this.state}));}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Node{constructor(...args){super(...args);audit.nodes.push(this);
    this.port.addEventListener('message',({data})=>{if(data?.fatal)audit.fatal.push(data.error);});this.port.start();}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){const analyser=this.context.createAnalyser(),mute=this.context.createGain();
      analyser.fftSize=4096;mute.gain.value=0;connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);
      audit.sinks.push({context:this.context,analyser,mute});return destination;}
    return connect.call(this,destination,...args);
  };
  audit.command=(method='read',args=[])=>new Promise((resolve,reject)=>{
    const node=audit.nodes.findLast(node=>node.context.state!=='closed');if(!node)return reject(new Error('No active Worklet'));
    const id=--audit.nextId,timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(new Error('Audit command timeout'));},6000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);
      data.error?reject(new Error(data.error)):resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.postMessage({id,method,args});
  });
  audit.snapshot=()=>{
    const sink=audit.sinks.findLast(s=>s.context.state==='running'),values=new Float32Array(4096);
    if(sink)sink.analyser.getFloatTimeDomainData(values);
    let squares=0,peak=0;for(const v of values){squares+=v*v;peak=Math.max(peak,Math.abs(v));}
    const active=audit.nodes.findLast(n=>n.context.state!=='closed');
    return {contexts:audit.contexts.map((c,id)=>({id,state:c.state,sampleRate:c.sampleRate})),
      activeNode:active?audit.nodes.indexOf(active):null,activeContext:active?audit.contexts.indexOf(active.context):null,
      running:audit.contexts.filter(c=>c.state==='running').length,muted:audit.sinks.every(s=>s.mute.gain.value===0),
      output:{rms:Math.sqrt(squares/values.length),peak,finite:values.every(Number.isFinite)},fatal:[...audit.fatal]};
  };
}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.md':'text/plain'};
const server=createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),path=resolve(options.docs,'.'+pathname);
    if(!path.startsWith(options.docs+sep)||(await stat(path)).isDirectory())throw new Error('Invalid resource');
    const bytes=pathname==='/sid8580-lab/processor.js'?instrumentedProcessor:await readFile(path);
    res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
function checkState(state,testCase,file){
  assert.equal(state.model,8580);assert.equal(state.declaredModel,'8580');assert.equal(state.declaredClock,'pal');
  assert.equal(state.subtune,testCase.subtune);assert.equal(state.format,file.header.format);assert.equal(state.timing,testCase.timing);
  assert.equal(state.environment,'minimal');assert.equal(state.profileBits,0);assert.equal(state.perCycleJavaScriptCallbacks,0);
  assert.equal(state.bridge,'direct-wasm-function-imports');assert.equal(state.cycles,state.sidCycles);assert(state.playing);
}
try{
  for(const engine of engines){
    const browser=await({chromium,webkit}[engine]).launch({headless:true}),result={engine,version:browser.version(),cases:[],transitions:[],errors:[],external:[],httpFailures:[]};
    report.results.push(result);let page,stage='startup';
    try{
      page=await browser.newPage({viewport:{width:1080,height:1000}});page.setDefaultTimeout(20000);
      page.on('pageerror',e=>result.errors.push(e.message));
      page.on('response',r=>{if(r.status()>=400)result.httpFailures.push({path:new URL(r.url()).pathname,status:r.status()});});
      await page.addInitScript(instrument);await page.route('**/*',route=>{
        const url=new URL(route.request().url());if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){result.external.push(url.href);return route.abort();}
        return route.continue();
      });
      const read=()=>page.evaluate(()=>__sid8580RealAudit.command());
      const snapshot=()=>page.evaluate(()=>__sid8580RealAudit.snapshot());
      const ready=async()=>{
        await page.waitForFunction(()=>['ready','error'].includes(document.querySelector('#status').dataset.state));
        assert.equal(await page.locator('#status').getAttribute('data-state'),'ready',await page.locator('#status').textContent());
      };
      const play=async()=>{
        await page.locator('#play').click();await page.waitForFunction(()=>['playing','error'].includes(document.querySelector('#status').dataset.state));
        assert.equal(await page.locator('#status').getAttribute('data-state'),'playing',await page.locator('#status').textContent());return read();
      };
      const stop=async()=>{
        await page.locator('#stop').click();await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='stopped'&&__sid8580RealAudit.snapshot().contexts.every(c=>c.state==='closed'));
        const stopped=await snapshot();assert.equal(stopped.running,0);assert(stopped.muted&&stopped.output.finite&&stopped.output.peak===0);return stopped;
      };
      await page.goto(origin+'/sid8580-lab/index.html');assert.equal((await snapshot()).contexts.length,0);
      for(const file of songs.values()){
        let selectedThisFile=false,lastSuccessful=null;
        for(const testCase of file.cases){
          const row={...testCase,input:file.input,stage:'selection',outcome:'pending'};result.cases.push(row);stage=testCase.id;
          console.log(`${engine}: ${testCase.id} · ${file.path} · begin`);await save();
          try{
            const previous=await snapshot();
            if(!selectedThisFile){
              await page.locator('#sidFile').setInputFiles({name:basename(file.path),mimeType:'application/octet-stream',buffer:file.bytes});await ready();
              selectedThisFile=true;
            }
            if(Number(await page.locator('#subtune').inputValue())!==testCase.subtune){
              await page.locator('#subtune').selectOption(String(testCase.subtune));await ready();
            }
            const prepared=await snapshot();assert.equal(prepared.running,0,'successful file/subtune selection must not autoplay');
            assert(prepared.contexts.every(c=>c.state==='closed'),'accepted selection retires the old audio context');
            row.selection={previousActiveNode:previous.activeNode,after:prepared,autoPlayed:false};
            row.stage='play';let state=await play();checkState(state,testCase,file);
            const frames=state.sampleRate*plan.secondsPerCase;
            row.stage='capture';const beginning=await page.evaluate(n=>__sid8580RealAudit.command('audit-begin',[n]),frames);checkState(beginning,testCase,file);
            const started=Date.now(),progress=[];row.progress=progress;let lastFrames=-1,lastProgress=Date.now();
            while(true){
              await page.waitForTimeout(1000);state=await read();checkState(state,testCase,file);
              const audit=await snapshot();assert(audit.muted&&audit.running===1&&audit.output.finite);
              const capture=state.auditCapture;row.partialCapture=capture;
              assert(capture&&capture.nonfiniteSamples===0&&capture.stereoMismatches===0&&capture.missingChannelFrames===0);
              const current={seconds:capture.frames/state.sampleRate,frames:capture.frames,positionFrames:state.positionFrames,cycles:state.cycles,
                sidCycles:state.sidCycles,irqCount:state.irqCount,playCalls:state.playCalls,postMaster: audit.output};progress.push(current);
              if(capture.frames!==lastFrames){lastFrames=capture.frames;lastProgress=Date.now();}
              assert(Date.now()-lastProgress<12000,'Audio frames stopped advancing');assert(Date.now()-started<75000,'30-second audio capture exceeded its wall deadline');
              if(progress.length%10===0)console.log(`${engine}: ${testCase.id} · ${current.seconds.toFixed(1)} audio seconds`);
              if(capture.complete)break;
            }
            const c=state.auditCapture,start=c.start,end=c.end;assert.equal(c.frames,frames);assert(c.complete&&end);
            assert.equal(end.cycles,end.sidCycles);assert(end.cycles>start.cycles);assert(end.positionFrames-start.positionFrames>=frames);
            assert(end.positionFrames-start.positionFrames<frames+128);
            const deltaFrames=end.worklet.frames-start.worklet.frames,deltaBlocks=end.worklet.blocks-start.worklet.blocks;
            assert(deltaFrames>=frames&&deltaFrames<frames+128);assert(deltaBlocks>0);
            if(file.header.format==='PSID')assert(end.playCalls>start.playCalls);
            row.stage='complete';row.outcome=c.nonzeroFrames?'executed_nonzero':'executed_silent';
            row.capture={...c,rms:Math.sqrt(c.squareSum/c.frames),durationSeconds:c.frames/state.sampleRate,wallElapsedMs:Date.now()-started};
            delete row.partialCapture;
            row.windowMetrics={frames:deltaFrames,blocks:deltaBlocks,meanCoreRenderMs:(end.worklet.totalRenderMs-start.worklet.totalRenderMs)/deltaBlocks,
              overBudgetBlocks:end.worklet.overBudgetBlocks-start.worklet.overBudgetBlocks,lifetimeMaxRenderMs:end.worklet.maxRenderMs,
              lastLoadMs:end.worklet.lastLoadMs,maxLoadMs:end.worklet.maxLoadMs,quantumBudgetMs:end.worklet.quantumBudgetMs,timingSource:end.worklet.timingSource};
            row.progress=progress;row.finalState={...state,auditCapture:undefined};row.finalSnapshot=await snapshot();
            lastSuccessful={testCase,state};console.log(`${engine}: ${testCase.id} · ${row.outcome} · RMS ${row.capture.rms.toFixed(6)}`);
          }catch(error){row.outcome='failed';row.error={message:error.message,name:error.name};row.uiStatus=await page.locator('#status').textContent().catch(()=>null);
            row.snapshot=await snapshot().catch(()=>null);console.log(`${engine}: ${testCase.id} · FAILED at ${row.stage}: ${error.message}`);}
          await save();
        }
        if(lastSuccessful){
          const transition={fileId:file.id,path:file.path,subtune:lastSuccessful.testCase.subtune,passed:false,stage:'failed-candidate-retention'};result.transitions.push(transition);
          try{
            const before=await snapshot(),beforeState=await read(),title=await page.locator('#title').textContent(),accepted=await page.locator('#subtune').inputValue();
            await page.locator('#sidFile').setInputFiles({name:'invalid-real-file-check.sid',mimeType:'application/octet-stream',buffer:Buffer.from([1,2,3])});
            await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='error');
            assert.match(await page.locator('#status').textContent(),/Current sound kept/);await page.waitForTimeout(250);
            const after=await snapshot(),afterState=await read();assert.equal(after.activeNode,before.activeNode);assert.equal(after.activeContext,before.activeContext);
            checkState(afterState,lastSuccessful.testCase,file);assert(afterState.cycles>beforeState.cycles);
            assert.equal(await page.locator('#title').textContent(),title);assert.equal(await page.locator('#subtune').inputValue(),accepted);
            transition.keptOldSound={sameNode:true,sameContext:true,cyclesAdvanced:true};transition.stage='stop-restart';
            const oldPosition=afterState.positionFrames;transition.stop=await stop();const restarted=await play();checkState(restarted,lastSuccessful.testCase,file);
            const fresh=await snapshot();assert.notEqual(fresh.activeNode,before.activeNode);assert.equal(fresh.running,1);
            assert(restarted.positionFrames<oldPosition);await page.waitForTimeout(250);checkState(await read(),lastSuccessful.testCase,file);
            transition.restart={newNode:true,positionReset:true,snapshot:fresh};await stop();transition.passed=true;transition.stage='complete';
          }catch(error){transition.error=error.message;transition.snapshot=await snapshot().catch(()=>null);
            if(!await page.locator('#stop').isDisabled())await stop().catch(()=>{});}
          await save();
        }
      }
      result.finalSnapshot=await snapshot();assert(result.finalSnapshot.contexts.every(c=>c.state==='closed'));
      assert.deepEqual(result.errors,[]);assert.deepEqual(result.external,[]);assert.deepEqual(result.httpFailures,[]);
      result.completed=true;
    }catch(error){result.completed=false;result.error={stage,message:error.message};}
    finally{await browser.close();await save();}
  }
  report.completed=true;
  const cases=report.results.flatMap(r=>r.cases),transitions=report.results.flatMap(r=>r.transitions);
  report.summary={plannedCasesPerEngine:plan.cases.length,engines:report.results.length,completedCases:cases.filter(c=>c.outcome!=='pending').length,
    executedNonzero:cases.filter(c=>c.outcome==='executed_nonzero').length,executedSilent:cases.filter(c=>c.outcome==='executed_silent').length,
    failed:cases.filter(c=>c.outcome==='failed').length,transitionsPassed:transitions.filter(t=>t.passed).length,transitionsFailed:transitions.filter(t=>!t.passed).length};
  report.allCasesExecuted=report.results.every(r=>r.completed&&r.cases.length===plan.cases.length)&&cases.every(c=>c.outcome.startsWith('executed_'))&&transitions.every(t=>t.passed);
  await save();console.log(JSON.stringify({out:options.out,allCasesExecuted:report.allCasesExecuted,...report.summary}));
  if(!report.allCasesExecuted)process.exitCode=1;
}finally{await new Promise(resolve=>server.close(resolve));await save();}
