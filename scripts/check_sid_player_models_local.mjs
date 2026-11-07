#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Optional bounded pilot of user-local files through the ordinary SID Player.
// Music/ROM/PCM bytes are never written or included in the scalar report.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat,realpath} from 'node:fs/promises';
import {resolve,dirname,extname,sep,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium,webkit} from 'playwright';

const options={docs:resolve('docs'),root:resolve('ww/C64Music'),plan:resolve('docs/issues/sid8580_worklet_cases_plan_01.json'),
  out:resolve('docs/issues/sid_player_models_local_01.json'),engines:'chromium,webkit',validateOnly:false};
for(let i=2;i<process.argv.length;i++){
  const flag=process.argv[i];if(flag==='--validate-only'){options.validateOnly=true;continue;}
  assert(['--docs','--root','--plan','--out','--engines'].includes(flag)&&process.argv[i+1],`Unknown option ${flag}`);
  const key=flag.slice(2),value=process.argv[++i];options[key]=key==='engines'?value:resolve(value);
}
const engines=options.engines.split(',');assert(engines.length&&new Set(engines).size===engines.length&&engines.every(e=>['chromium','webkit'].includes(e)));
const digest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const planBytes=await readFile(options.plan),plan=JSON.parse(planBytes),archiveRoot=await realpath(options.root);
assert.equal(plan.format,'tetorica-sid8580-worklet-cases-plan');assert.equal(plan.version,1);assert.equal(plan.files.length,3);
assert.deepEqual(plan.target,{clock:'pal',model:'8580',environment:'minimal'});assert.deepEqual(plan.profiles,{resonance:false,cutoff:false});
for(const [path,hash]of Object.entries(plan.inputs))assert.deepEqual(digest(await readFile(resolve(path))),hash,`Frozen selection input changed: ${path}`);
const files=[];
for(const file of plan.files){
  const path=await realpath(resolve(options.root,file.path));assert(path.startsWith(archiveRoot+sep),'Selected music must remain in the user-local archive');
  const bytes=await readFile(path);assert.deepEqual(digest(bytes),file.input,`Selected file changed: ${file.path}`);
  assert.equal(file.header.clock,'pal');assert.equal(file.header.model,'8580');assert.equal(file.header.version,2);assert.equal(file.header.sidCount,1);
  files.push({...file,bytes});
}
const runtimeFiles=['sid-player/index.html','sid-player/player.css',
  ...['player','models','model_policy','core8580','audio','processor','core','rsid_core','roms'].map(n=>`sid-player/${n}.js`),
  ...['core','parser','psid_structure'].map(n=>`sid8580-lab/${n}.js`),'js/sid_psid.js','js/sid_rsid.js','synth-spu/spu_synth_visualizer.js','tetorica_sid_synth.webp',
  'generated/sid-player/sid-player.wasm','generated/sid-player/sid-player-build.json',
  'generated/sid-rsid/sid-rsid.wasm','generated/sid-rsid/sid-rsid-build.json',
  'generated/sid8580-machine/sid8580-endpoint.wasm','generated/sid8580-machine/sid8580-machine.wasm','generated/sid8580-machine/sid8580-machine-build.json'];
const inputs={};for(const path of runtimeFiles)inputs['docs/'+path]=digest(await readFile(resolve(options.docs,path)));
inputs['scripts/check_sid_player_models_local.mjs']=digest(await readFile(new URL(import.meta.url)));
for(const component of ['sid-player','sid-rsid']){
  const receipt=JSON.parse(await readFile(resolve(options.docs,`generated/${component}/${component}-build.json`)));
  assert.deepEqual(inputs[`docs/generated/${component}/${component}.wasm`],receipt.output,`${component} receipt mismatch`);
}
const receipt8580=JSON.parse(await readFile(resolve(options.docs,'generated/sid8580-machine/sid8580-machine-build.json')));
for(const name of ['sid8580-endpoint.wasm','sid8580-machine.wasm'])assert.deepEqual(inputs['docs/generated/sid8580-machine/'+name],receipt8580.outputs[name]);
const report={format:'tetorica-sid-player-models-local-pilot',version:1,completed:false,passed:false,date:'2026-11-08',
  productEntry:'/sid-player/index.html',target:{control:'auto',clock:'pal',declaredModel:'8580',runningModel:'8580',vbiBackend:'c64',environment:'minimal'},
  profileBits:0,physicalOutputMuted:true,listeningPerformed:false,containsMusicBytes:false,containsPcm:false,userFirmwareUsed:false,
  observation:{waitMilliseconds:2000,analyserWindowsPerCase:4,analyserWindowFrames:4096,
    scope:'Four noncontiguous sampled post-Master PCM windows while the actual AudioWorklet plays for approximately two seconds. This is not contiguous whole-frame capture.',
    performanceClaim:false,longRunClaim:false},plan:digest(planBytes),inputs,results:[],
  interpretation:'Header-default songs of the existing metadata-only frozen three-file plan; no execution-based file replacement. This pilot verifies ordinary-Player routing, sampled output and Stop, not listening quality, full-song compatibility or glitch-free timing.'};
if(options.validateOnly){console.log(JSON.stringify({valid:true,files:files.length,casesPerEngine:files.length,plan:report.plan,inputs:Object.keys(inputs).length}));process.exit(0);}
const save=async()=>{await mkdir(dirname(options.out),{recursive:true});await writeFile(options.out,JSON.stringify(report,null,2)+'\n');};
function instrument(){
  const audit=window.__sidModelsLocalAudit={contexts:[],worklets:[],sinks:[],nextId:0,fatal:[]};
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect;
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(...args){super(...args);audit.worklets.push(this);
    this.port.addEventListener('message',({data})=>{if(data?.fatal)audit.fatal.push(data.error);});this.port.start();}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){const analyser=this.context.createAnalyser(),mute=this.context.createGain();
      analyser.fftSize=4096;mute.gain.value=0;connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);
      audit.sinks.push({context:this.context,analyser,mute});return destination;}
    return connect.call(this,destination,...args);
  };
  audit.read=()=>new Promise((resolve,reject)=>{
    const node=audit.worklets.findLast(n=>n.context.state!=='closed');if(!node)return reject(new Error('No active ordinary Player Worklet'));
    const id=--audit.nextId,timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(new Error('Player audit read timeout'));},5000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);
      data.error?reject(new Error(data.error)):resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.postMessage({id,method:'read',args:[]});
  });
  audit.sample=()=>{
    const sink=audit.sinks.findLast(s=>s.context.state==='running'),pcm=new Float32Array(4096);
    if(sink)sink.analyser.getFloatTimeDomainData(pcm);let squares=0,peak=0;for(const x of pcm){squares+=x*x;peak=Math.max(peak,Math.abs(x));}
    return {rms:Math.sqrt(squares/pcm.length),peak,finite:pcm.every(Number.isFinite),muted:audit.sinks.every(s=>s.mute.gain.value===0),
      runningContexts:audit.contexts.filter(c=>c.state==='running').length,contexts:audit.contexts.map((c,id)=>({id,state:c.state,sampleRate:c.sampleRate}))};
  };
}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.md':'text/plain'};
const server=createServer(async(req,res)=>{
  try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),path=resolve(options.docs,'.'+pathname);
    if(!path.startsWith(options.docs+sep)||(await stat(path)).isDirectory())throw new Error('Invalid resource');
    res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(path));
  }catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
function checkState(state,file){
  assert.equal(state.model,'8580');assert.equal(state.declaredModel,'8580');assert.equal(state.declaredClock,'pal');
  assert.equal(state.clockHz,985248);assert.equal(state.profileBits,0);assert.deepEqual(state.profiles,{resonance:false,cutoff:false});
  assert.equal(state.environment,'minimal');assert.equal(state.backend,'c64');assert.equal(state.subtune,file.header.startSong);
  assert.equal(state.format,file.header.format);assert.equal(state.cycles,state.sidCycles);assert(state.playing);
}
try{
  for(const name of engines){
    const browser=await({chromium,webkit}[name]).launch({headless:true});
    const result={engine:name,version:browser.version(),passed:false,cases:[],errors:[],httpFailures:[],external:[],wasmRequests:[]};report.results.push(result);
    try{
      const page=await browser.newPage({viewport:{width:1180,height:1000}});page.setDefaultTimeout(20000);
      page.on('pageerror',e=>result.errors.push(e.message));page.on('response',r=>{const path=new URL(r.url()).pathname;
        if(r.status()>=400)result.httpFailures.push({path,status:r.status()});if(path.endsWith('.wasm'))result.wasmRequests.push(path);});
      await page.addInitScript(instrument);await page.route('**/*',route=>{
        const url=new URL(route.request().url());if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){result.external.push(url.href);return route.abort();}
        return route.continue();
      });
      await page.goto(origin+report.productEntry);await page.waitForSelector('#sidModel');
      assert.equal(await page.locator('#sidModel').inputValue(),'auto');assert.equal(await page.locator('#vbiBackend').inputValue(),'c64');
      assert.equal(await page.locator('#rsidEnvironment').inputValue(),'minimal');assert.equal(await page.locator('#assumeRsid').isChecked(),true);
      assert.equal((await page.evaluate(()=>__sidModelsLocalAudit.sample())).contexts.length,0);
      for(const file of files){
        const row={path:file.path,input:file.input,header:file.header,subtune:file.header.startSong,passed:false,stage:'load'};result.cases.push(row);
        console.log(`${name}: ${file.path} · default song ${row.subtune}`);
        try{
          await page.locator('#sidFile').setInputFiles({name:basename(file.path),mimeType:'application/octet-stream',buffer:file.bytes});
          await page.waitForFunction(()=>['ready','error'].includes(document.querySelector('#status').dataset.state));
          assert.equal(await page.locator('#status').getAttribute('data-state'),'ready',await page.locator('#status').textContent());
          assert.equal(await page.locator('#sidModel').inputValue(),'auto');assert.equal(await page.locator('#subtune').inputValue(),String(file.header.startSong));
          assert.equal(await page.locator('#runningModel').textContent(),'8580');assert.match(await page.locator('#fileInfo').textContent(),/Header pal \/ 8580 → PAL \/ 8580/);
          assert.equal((await page.evaluate(()=>__sidModelsLocalAudit.sample())).runningContexts,0,'file selection must not autoplay');
          row.stage='play';await page.locator('#play').click();
          await page.waitForFunction(()=>['playing','error'].includes(document.querySelector('#status').dataset.state));
          assert.equal(await page.locator('#status').getAttribute('data-state'),'playing',await page.locator('#status').textContent());
          const initial=await page.evaluate(()=>__sidModelsLocalAudit.read());checkState(initial,file);row.initialState=initial;
          row.stage='sample';row.samples=[];
          for(let i=0;i<4;i++){
            await page.waitForTimeout(500);const sample=await page.evaluate(()=>__sidModelsLocalAudit.sample());
            assert(sample.finite&&sample.muted);assert.equal(sample.runningContexts,1);row.samples.push(sample);
          }
          assert(row.samples.some(s=>s.rms>1e-5),'sampled windows remain silent');
          const final=await page.evaluate(()=>__sidModelsLocalAudit.read());checkState(final,file);
          assert(final.cycles>initial.cycles);assert(final.positionFrames>initial.positionFrames);row.finalState=final;
          row.audioFrameAdvance=final.positionFrames-initial.positionFrames;row.audioSecondsAdvance=row.audioFrameAdvance/final.sampleRate;
          row.stage='stop';await page.locator('#stop').click();
          await page.waitForFunction(()=>document.querySelector('#status').dataset.state==='stopped'&&__sidModelsLocalAudit.sample().contexts.every(c=>c.state==='closed'));
          row.stopped=await page.evaluate(()=>__sidModelsLocalAudit.sample());assert(row.stopped.muted&&row.stopped.finite&&row.stopped.peak===0);
          row.passed=true;row.stage='complete';console.log(`${name}: ${file.path} · passed`);
        }catch(error){row.error=error.message;row.status=await page.locator('#status').textContent().catch(()=>null);
          row.snapshot=await page.evaluate(()=>__sidModelsLocalAudit.sample()).catch(()=>null);
          if(!await page.locator('#stop').isDisabled())await page.locator('#stop').click().catch(()=>{});}
        await save();
      }
      result.finalSnapshot=await page.evaluate(()=>__sidModelsLocalAudit.sample());assert(result.finalSnapshot.contexts.every(c=>c.state==='closed'));
      assert.deepEqual(result.errors,[]);assert.deepEqual(result.httpFailures,[]);assert.deepEqual(result.external,[]);
      assert.deepEqual([...new Set(result.wasmRequests)].sort(),['/generated/sid8580-machine/sid8580-endpoint.wasm','/generated/sid8580-machine/sid8580-machine.wasm']);
      result.passed=result.cases.length===3&&result.cases.every(c=>c.passed);
    }catch(error){result.error=error.message;}
    finally{await browser.close();await save();}
  }
  for(const [path,hash]of Object.entries(inputs)){
    const source=path.startsWith('docs/')?resolve(options.docs,path.slice(5)):resolve(path);
    assert.deepEqual(digest(await readFile(source)),hash,`Runtime changed during pilot: ${path}`);
  }
  report.completed=true;report.passed=report.results.length===engines.length&&report.results.every(r=>r.passed);
  report.summary={files:files.length,cases:report.results.reduce((n,r)=>n+r.cases.length,0),passed:report.results.reduce((n,r)=>n+r.cases.filter(c=>c.passed).length,0)};
  await save();console.log(JSON.stringify({out:options.out,passed:report.passed,...report.summary}));if(!report.passed)process.exitCode=1;
}finally{await new Promise(resolve=>server.close(resolve));await save();}
