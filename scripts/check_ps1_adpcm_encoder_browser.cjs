// Public Playground Main/Worker UI → PCM encoder → actual PS1 SPU AudioWorklet.
// The capture's physical output is always zero; this is not a listening test.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const {PROCESSOR_NAMES,processorSource,analyzePilotPcm,analyzeClockRows}=require('./audio_clock_audit.cjs');
const config={host:null,zip:null,out:null,engines:[]};
const usage='Usage: node scripts/check_ps1_adpcm_encoder_browser.cjs [--chromium-only | --webkit-only] [--host DIR | --zip ARCHIVE] [--out REPORT.json]';
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(arg==='--help'){console.log(usage);process.exit(0);}
  if(['--chromium-only','--webkit-only'].includes(arg)){config.engines.push(arg.slice(2,-5));continue;}
  const match=arg.match(/^--(host|zip|out)(?:=(.*))?$/);assert(match,usage);
  const value=match[2]??process.argv[++i];assert(value&&!value.startsWith('--'),usage);config[match[1]]=path.resolve(value);
}
assert(!(config.host&&config.zip),'Choose --host or --zip');
assert(config.engines.length<=1,'Choose one browser flag or neither for both');
if(!config.engines.length)config.engines=['chromium','webkit'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),served=new Map();
const captureSource=processorSource;

async function selectHost(){
  let temporary=null,archive=null,directory=config.host??path.resolve(__dirname,'../docs');
  if(config.zip){
    const bytes=await fs.readFile(config.zip);temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ps1-adpcm-browser-'));directory=temporary;
    const unpack=String.raw`import sys,zipfile
from pathlib import Path
root=Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for entry in z.infolist():
  if not (root/entry.filename).resolve().is_relative_to(root):raise ValueError('Unsafe ZIP member')
 z.extractall(root)`;
    execFileSync('python3',['-c',unpack,config.zip,directory],{stdio:'pipe'});archive={path:config.zip,bytes:bytes.length,sha256:sha(bytes)};
  }
  const candidates=[directory,path.join(directory,'docs')];
  for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isDirectory())candidates.push(path.join(directory,entry.name));
  for(const candidate of new Set(candidates))for(const prefix of ['playground/','']){
    const entry='/'+prefix+'index.html',example='/'+prefix+'examples/ps1/ps1-pcm-adpcm.js';
    try{await fs.access(path.join(candidate,entry));const source=await fs.readFile(path.join(candidate,example),'utf8');return {directory:candidate,entry,example,source,temporary,archive};}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(temporary)await fs.rm(temporary,{recursive:true,force:true});
  throw Error('Selected host must contain Playground index.html and examples/ps1/ps1-pcm-adpcm.js');
}
function instrumentation(){
  const audit=window.__ps1AdpcmAudit={contexts:[],workers:[],worklets:[],sinks:new Map(),processorErrors:[],snapshots:[],captures:[]};
  const Context=window.AudioContext,OriginalWorker=window.Worker,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;audit.connect=connect;
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);audit.workers.push(String(url));}};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);audit.worklets.push(name);this.addEventListener('processorerror',()=>audit.processorErrors.push(name));
    // Observe replies to public SPU-tab reads, without injecting audio commands.
    if(name==='tetorica-playground-ps1')this.port.addEventListener('message',({data})=>{const state=data?.state??data?.value;if(Array.isArray(state?.samples)&&state?.channels?.length===24)audit.snapshots.push({samples:state.samples.length,time:performance.now()});});
  }};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){let sink=audit.sinks.get(this.context);
      if(!sink){const sum=this.context.createGain(),gate=this.context.createGain();gate.gain.value=0;connect.call(sum,gate);connect.call(gate,destination);sink={sum,gate};audit.sinks.set(this.context,sink);}
      connect.call(this,sink.sum,...args);return destination;
    }return connect.call(this,destination,...args);
  };
  AudioNode.prototype.disconnect=function(...args){if(args[0]===this.context.destination&&audit.sinks.has(this.context))args[0]=audit.sinks.get(this.context).sum;return disconnect.apply(this,args);};
}
async function capture(page,frames=16384,label='SPU output'){
  const pcm=await page.evaluate(async({frames,label,captureName,pilotName})=>{
  const audit=window.__ps1AdpcmAudit,context=[...audit.contexts].reverse().find(context=>context.state!=='closed'&&audit.sinks.has(context));
  if(!context)throw Error('No live Playground output graph');const sink=audit.sinks.get(context);
  if(!sink.capture){
    await context.audioWorklet.addModule('/__ps1_adpcm_capture.js');const node=new AudioWorkletNode(context,captureName,{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{pilotInput:1}});
    // An independent sample counter goes only to capture input1. The SPU mix
    // stays on input0, and the capture's own output and destination gate are zero.
    const pilot=new AudioWorkletNode(context,pilotName,{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
    audit.connect.call(pilot,node,0,1);sink.pilot=pilot;
    audit.connect.call(sink.sum,node);audit.connect.call(node,sink.gate);sink.capture=node;sink.sequence=0;sink.pending=null;
    node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const p=sink.pending;sink.pending=null;clearTimeout(p.timer);p.resolve(data);}};
  }
  const data=await new Promise((resolve,reject)=>{if(sink.pending)throw Error('Concurrent SPU capture');const id=++sink.sequence;
    const timer=setTimeout(()=>{sink.pending=null;reject(Error('SPU output capture timed out'));},10000);sink.pending={id,resolve,timer};sink.capture.port.postMessage({id,frames});});
  const pilot=window.__ps1AdpcmClockAnalysis.pilot(data.pilot,{expectedFrames:frames,pilotInputFrames:data.pilotInputFrames});
  const clock=window.__ps1AdpcmClockAnalysis.clock(data.rows);
  audit.captures.push({id:data.id,label,frames:data.left.length,frameGaps:data.frameGaps,gaps:data.gaps,pilot,clock});
  const channels=[data.left,data.right].map(values=>{let peak=0,energy=0,nonFinite=0,nonZero=0;for(const value of values){if(!Number.isFinite(value))nonFinite++;peak=Math.max(peak,Math.abs(value));energy+=value*value;if(value!==0)nonZero++;}return {peak,rms:Math.sqrt(energy/values.length),nonFinite,nonZero};});
  if(sink.gate.gain.value!==0)throw Error('Physical output must remain zero');
  return {sampleRate:context.sampleRate,frames:data.left.length,frameGaps:data.frameGaps,gaps:data.gaps,firstFrame:data.firstFrame,lastFrame:data.lastFrame,quantumFrames:data.quantumFrames,pilot,clock,channels,physicalOutputMuted:true};
  },{frames,label,captureName:PROCESSOR_NAMES.capture,pilotName:PROCESSOR_NAMES.pilot});
  // currentFrame is a clock observation, not the captured PCM sequence. Check
  // every capture, including level/Stop retries, and preserve clock anomalies.
  assert.equal(pcm.pilot.continuous,true,label+': independent captured PCM continuity '+JSON.stringify(pcm.pilot));
  assert.equal(pcm.clock.measurementValid,true,label+': complete capture callback sequence '+JSON.stringify(pcm.clock));
  assert.equal(pcm.clock.frames,pcm.frames,label+': every capture quantum accounted for');
  assert.equal(pcm.clock.gapCount,pcm.frameGaps,label+': all observed clock anomalies retained');
  return pcm;
}
async function audible(page,label){let pcm;for(let attempt=0;attempt<6;attempt++){pcm=await capture(page,16384,label+' attempt '+(attempt+1));if(pcm.channels.every(ch=>!ch.nonFinite&&ch.rms>.0001&&ch.peak<1))break;}
  assert(pcm.channels.every(ch=>!ch.nonFinite&&ch.rms>.0001&&ch.peak<1),label+': finite nonzero unclipped SPU audio '+JSON.stringify(pcm));return pcm;}
async function silent(page,label){let pcm;for(let attempt=0;attempt<8;attempt++){pcm=await capture(page,4096,label+' attempt '+(attempt+1));if(pcm.channels.every(ch=>!ch.nonFinite&&!ch.nonZero))return pcm;}throw Error(label+': expected exact-zero output '+JSON.stringify(pcm));}
async function setSource(page,source,execution){await page.locator('#codeTab').click();await page.evaluate(({source,execution})=>{monaco.editor.getEditors()[0].setValue(source);document.getElementById('workerExecution').checked=execution==='worker';},{source,execution});}
async function run(page,source,execution){await setSource(page,source,execution);await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);}
async function waitLog(page,marker){await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker)||/^Error:|^Playback failed:/i.test(document.getElementById('status').textContent),marker);const text=await page.locator('#consoleOutput').textContent();assert(text.includes(marker),'Runtime failed before '+marker+': '+text);return text;}
async function healthy(page,label){const state=await page.evaluate(()=>({status:document.getElementById('status').textContent,processors:__ps1AdpcmAudit.processorErrors}));assert(!/^Error:|failed|error:/i.test(state.status),label+': '+state.status);assert.deepEqual(state.processors,[],label+': no AudioWorklet processor errors');}
async function stop(page,label){await page.locator('#stopButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);await capture(page,4096,label+' settling');const stopped=await silent(page,label);await healthy(page,label);return stopped;}
async function sampleCount(page){
  const before=await page.evaluate(()=>__ps1AdpcmAudit.snapshots.length);await page.locator('#ps1Tab').click();
  await page.locator('#ps1Panel button').filter({hasText:/^Refresh$/}).click();
  await page.waitForFunction(before=>__ps1AdpcmAudit.snapshots.length>before,before);
  const samples=await page.evaluate(()=>__ps1AdpcmAudit.snapshots.at(-1).samples);
  await page.waitForFunction(samples=>document.querySelectorAll('#ps1Panel [data-chip-control="ps1-sample"] option').length===samples+1,samples);
  await page.locator('#codeTab').click();return samples;
}
function probeSource(marker){return `const check=(value,message)=>{if(!value)throw Error(message);};
check(typeof encodePs1Adpcm==='function'&&typeof pg.encodePs1Adpcm==='function','global and pg encoder availability');
const pcm=Float32Array.from({length:112},(_,i)=>.65*Math.sin(2*Math.PI*i/112)),before=Array.from(pcm);
const encoded=encodePs1Adpcm(pcm,{loopStartSamples:0}),other=pg.encodePs1Adpcm(pcm,{loopStartSamples:0});
check(encoded.adpcm instanceof Uint8Array&&encoded.adpcm.length===64,'SPU ADPCM packet bytes');
check(encoded.sourceFrames===112&&encoded.frames===112&&encoded.paddingFrames===0&&encoded.blockCount===4&&encoded.loopStartSamples===0,'source indices and no resampling');
check(encoded.adpcm.every((value,i)=>value===other.adpcm[i])&&pcm.every((value,i)=>value===before[i]),'determinism and PCM ownership');
check(encoded.adpcm[0]>>4===0&&(encoded.adpcm[1]&4)!==0&&encoded.adpcm[49]===3,'history-independent loop start and final END/LOOP');
check(encoded.metrics.snrDb>12&&Number.isFinite(encoded.metrics.rmsError)&&encoded.metrics.errorFrames===112,'measured lossy quality');
const hit=pg.encodePs1Adpcm(Float32Array.of(.1,.2,.1));check(hit.frames===28&&hit.paddingFrames===25&&hit.adpcm[1]===1&&hit.loopStartSamples===null,'one-shot padding and END');
let rejected=0;for(const bad of [()=>encodePs1Adpcm([0]),()=>pg.encodePs1Adpcm(pcm,null),()=>encodePs1Adpcm(pcm,{sampleRate:44100}),()=>pg.encodePs1Adpcm(pcm,{loopStartSamples:1}),()=>encodePs1Adpcm(pcm,{maxBytes:16}),()=>encodePs1Adpcm(Float32Array.of(NaN)),()=>pg.encodePs1Adpcm(new Float32Array(111),{loopStartSamples:0}),()=>encodePs1Adpcm(Float32Array.of(1.1))]){let threw=false;try{bad();}catch{threw=true;}check(threw,'invalid input/options rejected');rejected++;}
const ps1=await useSoundChip('ps1'),instrument=await ps1.loadADPCM(encoded.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});
check(instrument.decodedFrames===112&&instrument.byteLength===64&&instrument.loop&&instrument.loopStartSamples===0&&instrument.rootFrequencyHz===44100/112,'explicit upload tuning metadata');
ps1.setPreset(23,{sample:instrument,volumeLeft:.5,volumeRight:.5,adsr2:8});ps1.noteOn(23,'A4');
log(${JSON.stringify(marker)}+JSON.stringify({rejected,bytes:encoded.adpcm.length,sourceFrames:encoded.sourceFrames,metrics:encoded.metrics,sample:instrument,oneShot:{frames:hit.frames,paddingFrames:hit.paddingFrames,bytes:hit.adpcm.length}}));
liveLoop('ps1-adpcm-probe',async()=>{await sleep(60);});`;}

async function runCase(browser,name,origin,host,execution){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});
  await context.addInitScript({content:`globalThis.__ps1AdpcmClockAnalysis={pilot:${analyzePilotPcm.toString()},clock:${analyzeClockRows.toString()}};`});
  await context.addInitScript(instrumentation);
  const page=await context.newPage();page.setDefaultTimeout(40000);const errors=[],badResponses=[];
  page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
  try{
    console.log(`CHECK ${name}/${execution}: ${host.archive?'Run ZIP':'source'}`);
    await page.goto(origin+host.entry+'?mode=ps1&no-sw=1',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('startupNotice')?.hidden||document.getElementById('status')?.textContent==='Startup failed.');
    assert.equal(await page.locator('#startupNotice').isVisible(),false,await page.locator('#startupMessage').textContent());await page.waitForFunction(()=>window.monaco?.editor?.getEditors().length===1);
    assert.equal(await page.locator('#playgroundMode').inputValue(),'ps1');assert.equal(await page.evaluate(()=>__ps1AdpcmAudit.contexts.length),0,'Encoder example page remains audio-lazy');
    const marker=`__PS1_ADPCM_PROBE_${name}_${execution}__`;
    await run(page,probeSource(marker),execution);const text=await waitLog(page,marker),probe=JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length).split('\n')[0]);
    assert.equal(probe.rejected,8);assert.equal(probe.bytes,64);await healthy(page,'Encoder probe');
    if(execution==='worker')assert(await page.evaluate(()=>__ps1AdpcmAudit.workers.some(url=>/\/playground_logic_worker\.js(?:\?|$)/.test(url))),'Worker execution uses the real logic Worker');
    const probePcm=await audible(page,'Encoded loop on physical CH24'),probeStop=await stop(page,'Probe Stop'),runs=[];
    for(let pass=0;pass<2;pass++){
      const before=await sampleCount(page);
      // Use the exact selected artifact's source in the public editor, without test additions.
      await run(page,host.source,execution);assert.equal(await page.evaluate(()=>monaco.editor.getEditors()[0].getValue()),host.source);
      await waitLog(page,'PCM 112 frames → SPU ADPCM 64 bytes;');const pcm=await audible(page,'Exact PCM→ADPCM example '+(pass+1));await healthy(page,'Exact example');
      const after=await sampleCount(page);assert.equal(after-before,1,'Each fresh performance uploads exactly one encoded instrument');
      let liveSync=null;
      if(pass===0){await run(page,host.source,execution);const syncPcm=await audible(page,'Exact example live rerun');await healthy(page,'Example live rerun');const synced=await sampleCount(page);assert.equal(synced,after,'livePrepare reuses the sample during a live rerun');liveSync={pcm:syncPcm,additionalUploads:synced-after};}
      const stopped=await stop(page,'Example Stop '+(pass+1));runs.push({pass:pass+1,pcm,stopped,instrumentUploads:after-before,liveSync});
    }
    await run(page,"spu.noteOn(0,'A4');throw Error('PS1_ADPCM_EXPECTED_RECOVERY_CHECK');",execution);
    await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('PS1_ADPCM_EXPECTED_RECOVERY_CHECK'));
    await page.locator('#stopButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);await capture(page,4096,'Authored error Stop settling');const errorStop=await silent(page,'Authored error Stop');
    await run(page,host.source,execution);const recovery=await audible(page,'Exact example after authored error');await healthy(page,'Recovery');await stop(page,'Recovery Stop');
    assert.deepEqual(errors,[],'Browser exceptions');assert.deepEqual(badResponses,[],'Missing runtime assets');
    const audit=await page.evaluate(()=>({worklets:__ps1AdpcmAudit.worklets,workers:__ps1AdpcmAudit.workers,snapshots:__ps1AdpcmAudit.snapshots,physicalOutputMuted:[...__ps1AdpcmAudit.sinks.values()].every(({gate})=>gate.gain.value===0),
      captureContinuity:{captures:__ps1AdpcmAudit.captures.length,frames:__ps1AdpcmAudit.captures.reduce((sum,capture)=>sum+capture.frames,0),
        pcmContinuous:__ps1AdpcmAudit.captures.length>0&&__ps1AdpcmAudit.captures.every(capture=>capture.pilot.continuous&&capture.clock.measurementValid&&capture.clock.frames===capture.frames&&capture.clock.gapCount===capture.frameGaps),
        clockContinuous:__ps1AdpcmAudit.captures.every(capture=>capture.clock.continuous),
        clockAnomalies:__ps1AdpcmAudit.captures.filter(capture=>!capture.clock.continuous),measurements:__ps1AdpcmAudit.captures}}));
    assert(audit.worklets.includes('tetorica-playground-ps1'),'Actual PS1 SPU AudioWorklet created');assert(audit.physicalOutputMuted);assert(audit.captureContinuity.pcmContinuous,'Every capture, including retries, preserves independent PCM continuity');
    return {browser:name,version:browser.version(),execution,openingIsAudioLazy:true,probe,probePcm,probeStop,runs,errorStop,authoredErrorRecovery:recovery,...audit};
  }catch(error){
    const state=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,log:document.getElementById('consoleOutput')?.textContent,processors:window.__ps1AdpcmAudit?.processorErrors,snapshots:window.__ps1AdpcmAudit?.snapshots,captures:window.__ps1AdpcmAudit?.captures})).catch(()=>null);
    throw Error(`${name}/${execution}: ${error.message}\n${JSON.stringify({state,errors,badResponses})}`,{cause:error});
  }finally{await context.close();}
}
(async()=>{
  const helperPath=require.resolve('./audio_clock_audit.cjs');
  const checkerSha256=sha(await fs.readFile(__filename)),captureHelperSha256=sha(await fs.readFile(helperPath)),host=await selectHost();let server;
  try{
    server=http.createServer(async(request,response)=>{
      try{
        const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
        if(pathname==='/__ps1_adpcm_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(captureSource);return;}
        let file=path.resolve(host.directory,'.'+pathname);assert(file===host.directory||file.startsWith(host.directory+path.sep),'Outside selected host');if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
        const bytes=await fs.readFile(file),name=path.relative(host.directory,file),hash=sha(bytes);if(served.has(name))assert.equal(served.get(name).sha256,hash,'Served source changed during check: '+name);served.set(name,{bytes:bytes.length,sha256:hash});
        const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
        response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
      }catch(error){response.writeHead(404).end(error.message);}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const results=[];
    for(const name of config.engines){
      const browser=await ({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try{for(const execution of ['main','worker']){results.push(await runCase(browser,name,`http://127.0.0.1:${server.address().port}`,host,execution));console.log(`PASS ${name}/${execution}: encoder validation, exact example twice, livePrepare reuse, finite SPU audio, Stop and recovery; physical output muted.`);}}
      finally{await browser.close();}
    }
    for(const [name,entry]of served)assert.equal(sha(await fs.readFile(path.join(host.directory,name))),entry.sha256,'Source remained frozen: '+name);
    assert.equal(sha(await fs.readFile(__filename)),checkerSha256,'Checker bytes remained frozen throughout execution');
    assert.equal(sha(await fs.readFile(helperPath)),captureHelperSha256,'Capture helper remained frozen throughout execution');
    const report={schemaVersion:2,passed:true,pcmContinuous:results.every(result=>result.captureContinuity.pcmContinuous),clockContinuous:results.every(result=>result.captureContinuity.clockContinuous),continuityOracle:'independent-24-bit-pilot-PCM',physicalOutputMuted:true,listeningPerformed:false,publicUiOnly:true,repositoryFallback:false,host:host.directory,archive:host.archive,example:{path:host.example,bytes:Buffer.byteLength(host.source),sha256:sha(host.source)},results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256,captureHelperSha256};
    if(config.out)await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`PS1 PCM→ADPCM browser check passed: ${results.length} routes${config.out?'; '+config.out:''}.`);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));if(host.temporary)await fs.rm(host.temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
