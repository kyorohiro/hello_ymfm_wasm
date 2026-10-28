// Public Playground Main/Worker UI -> PCM encoder -> actual S-DSP AudioWorklet.
// Capture the final graph before a permanently zeroed physical destination.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const config={host:null,zip:null,out:null,webkit:false,webkitOnly:false};
const usage='Usage: node scripts/check_snes_brr_encoder_browser.cjs [--webkit | --webkit-only] [--host DIR | --zip ARCHIVE] [--out REPORT.json]';
for(let i=2;i<process.argv.length;i++) {
  const arg=process.argv[i];
  if(arg==='--help'){console.log(usage);process.exit(0);}
  if(arg==='--webkit'){config.webkit=true;continue;}
  if(arg==='--webkit-only'){config.webkitOnly=true;continue;}
  const match=arg.match(/^--(host|zip|out)(?:=(.*))?$/);assert(match,usage);
  const value=match[2]??process.argv[++i];assert(value&&!value.startsWith('--'),usage);config[match[1]]=path.resolve(value);
}
assert(!(config.host&&config.zip),'Choose --host or --zip');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map();
const captureSource=`class BrrCapture extends AudioWorkletProcessor {
  constructor(){super();this.pending=null;this.port.onmessage=({data})=>{if(this.pending)throw Error('Concurrent BRR capture');this.pending={id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0};};}
  process(inputs,outputs){for(const ch of outputs[0])ch.fill(0);const p=this.pending;if(!p)return true;const count=Math.min(128,p.left.length-p.offset),input=inputs[0];for(let i=0;i<count;i++){p.left[p.offset+i]=input[0]?.[i]??0;p.right[p.offset+i]=input[1]?.[i]??input[0]?.[i]??0;}p.offset+=count;if(p.offset===p.left.length){this.pending=null;this.port.postMessage(p,[p.left.buffer,p.right.buffer]);}return true;}
}registerProcessor('snes-brr-encoder-capture',BrrCapture);`;

async function selectHost() {
  let temporary=null,archive=null,directory=config.host??path.resolve(__dirname,'../docs');
  if(config.zip) {
    const bytes=await fs.readFile(config.zip);temporary=await fs.mkdtemp(path.join(os.tmpdir(),'snes-brr-browser-'));directory=temporary;
    const unpack=String.raw`import sys,zipfile
from pathlib import Path
root=Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for entry in z.infolist():
  if not (root/entry.filename).resolve().is_relative_to(root):raise ValueError('Unsafe ZIP member')
 z.extractall(root)`;
    execFileSync('python3',['-c',unpack,config.zip,directory],{stdio:'pipe'});
    archive={path:config.zip,bytes:bytes.length,sha256:sha(bytes)};
  }
  const candidates=[directory,path.join(directory,'docs')];
  for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isDirectory())candidates.push(path.join(directory,entry.name));
  for(const candidate of new Set(candidates))for(const prefix of ['playground/','']) {
    const entry=prefix+'index.html',example=prefix+'examples/snes/snes-pcm-brr.js';
    try {
      await fs.access(path.join(candidate,entry));const source=await fs.readFile(path.join(candidate,example),'utf8');
      return {directory:candidate,entry:'/'+entry,example:'/'+example,source,temporary,archive};
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(temporary)await fs.rm(temporary,{recursive:true,force:true});
  throw Error('The selected host must contain Playground index.html and examples/snes/snes-pcm-brr.js');
}

function instrumentation() {
  const audit=window.__snesBrrAudit={contexts:[],workers:[],worklets:[],sinks:new Map(),processorErrors:[]};
  const Context=window.AudioContext,OriginalWorker=window.Worker,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;audit.connect=connect;
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  window.Worker=class extends OriginalWorker{constructor(url,...args){super(url,...args);audit.workers.push(String(url));}};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);audit.worklets.push(name);this.addEventListener('processorerror',()=>audit.processorErrors.push(name));}};
  AudioNode.prototype.connect=function(destination,...args) {
    if(destination===this.context.destination) {
      let sink=audit.sinks.get(this.context);
      if(!sink){const sum=this.context.createGain(),gate=this.context.createGain();gate.gain.value=0;connect.call(sum,gate);connect.call(gate,destination);sink={sum,gate};audit.sinks.set(this.context,sink);}
      connect.call(this,sink.sum,...args);return destination;
    }
    return connect.call(this,destination,...args);
  };
  AudioNode.prototype.disconnect=function(...args){if(args[0]===this.context.destination&&audit.sinks.has(this.context))args[0]=audit.sinks.get(this.context).sum;return disconnect.apply(this,args);};
}

async function capture(page) {
  return page.evaluate(async()=>{
    const audit=window.__snesBrrAudit,context=[...audit.contexts].reverse().find(context=>context.state!=='closed'&&audit.sinks.has(context));
    if(!context)throw Error('No live Playground output graph');const sink=audit.sinks.get(context);
    if(!sink.capture) {
      await context.audioWorklet.addModule('/__snes_brr_capture.js');
      const node=new AudioWorkletNode(context,'snes-brr-encoder-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      audit.connect.call(sink.sum,node);audit.connect.call(node,sink.gate);sink.capture=node;sink.id=0;sink.pending=null;
      node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const p=sink.pending;sink.pending=null;clearTimeout(p.timer);p.resolve(data);}};
    }
    const data=await new Promise((resolve,reject)=>{
      if(sink.pending)throw Error('Concurrent output capture');const id=++sink.id;
      const timer=setTimeout(()=>{sink.pending=null;reject(Error('S-DSP output capture timed out'));},10000);
      sink.pending={id,resolve,timer};sink.capture.port.postMessage({id,frames:16384});
    });
    const channels=[data.left.subarray(2048),data.right.subarray(2048)];let peak=0,energy=0,active=0;
    for(const channel of channels)for(const value of channel){if(!Number.isFinite(value))throw Error('Nonfinite final S-DSP PCM');peak=Math.max(peak,Math.abs(value));energy+=value*value;if(Math.abs(value)>1e-5)active++;}
    if(sink.gate.gain.value!==0)throw Error('Physical output gate must remain zero');
    return {sampleRate:context.sampleRate,frames:channels[0].length,peak,rms:Math.sqrt(energy/channels[0].length/2),active,physicalOutputMuted:true};
  });
}
async function setSource(page,source,execution) {
  await page.locator('#codeTab').click();
  await page.evaluate(({source,execution})=>{monaco.editor.getEditors()[0].setValue(source);document.getElementById('workerExecution').checked=execution==='worker';},{source,execution});
}
async function waitLog(page,marker) {
  await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker)||/^(?:Error:|Playback failed:)/.test(document.getElementById('status').textContent),marker);
  assert(await page.locator('#consoleOutput').evaluate((node,marker)=>node.textContent.includes(marker),marker),'Runtime stopped before '+marker);
}
async function assertNoRuntimeError(page,label) {
  const state=await page.evaluate(()=>({status:document.getElementById('status').textContent,log:document.getElementById('consoleOutput').textContent,processors:window.__snesBrrAudit.processorErrors}));
  assert(!/^Error:|failed|error:/i.test(state.status),`${label}: ${state.status}`);
  assert(!/\[error\]|(?:^|\n)(?:Error|TypeError|RangeError|ReferenceError):/.test(state.log),`${label}: ${state.log}`);
  assert.deepEqual(state.processors,[],`${label}: AudioWorklet processor errors`);
}
async function stop(page,label) {
  await page.locator('#stopButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
  // Discard a full fresh audio window after the asynchronous Stop fence.
  await capture(page);const stopped=await capture(page);assert.equal(stopped.peak,0,`${label}: Stop clears real output`);await assertNoRuntimeError(page,label);return stopped;
}
function probeSource(marker) {
  return `const check=(value,message)=>{if(!value)throw Error(message);};
check(typeof encodeBrr==='function'&&typeof pg.encodeBrr==='function','global and pg encoder availability');
const pcm=Float32Array.from({length:128},(_,i)=>.65*Math.sin(2*Math.PI*i/128)),before=Array.from(pcm);
const encoded=encodeBrr(pcm,{loopStartSamples:0}),other=pg.encodeBrr(pcm,{loopStartSamples:0});
check(encoded.brr instanceof Uint8Array&&encoded.brr.length===72,'BRR block bytes');
check(encoded.sourceFrames===128&&encoded.frames===128&&encoded.paddingFrames===0&&encoded.loopStartSamples===0,'source indices and no resampling');
check(encoded.brr.every((value,i)=>value===other.brr[i])&&pcm.every((value,i)=>value===before[i]),'determinism and PCM ownership');
check(encoded.metrics.snrDb>20&&Number.isFinite(encoded.metrics.rmsError),'measured lossy quality');
let rejected=0;for(const bad of [()=>encodeBrr([0]),()=>pg.encodeBrr(pcm,null),()=>encodeBrr(pcm,{sampleRate:44100}),()=>pg.encodeBrr(pcm,{loopStartSamples:1}),()=>encodeBrr(pcm,{maxBytes:9}),()=>encodeBrr(Float32Array.of(NaN)),()=>pg.encodeBrr(new Float32Array(17),{loopStartSamples:0})]){let threw=false;try{bad();}catch{threw=true;}check(threw,'invalid input/options rejected');rejected++;}
const snes=await useSoundChip('snes'),brrSample=await snes.loadBRR(encoded.brr,{baseFrequencyHz:250,loopStartSamples:0});
check(brrSample.frames===128&&brrSample.byteLength===72&&brrSample.loop&&brrSample.loopStartSamples===0&&brrSample.rootFrequencyHz===250,'encoded BRR upload metadata');
snes.setPreset(0,{sample:brrSample,gain:127,volumeLeft:80,volumeRight:80});snes.noteOn(0,'C4');
log(${JSON.stringify(marker)}+JSON.stringify({rejected,bytes:encoded.brr.length,sourceFrames:encoded.sourceFrames,snrDb:encoded.metrics.snrDb,sample:brrSample}));
liveLoop('snes-brr-probe',async()=>{await sleep(.1);});`;
}
async function runCase(browser,name,origin,host,execution) {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});await context.addInitScript(instrumentation);
  const page=await context.newPage();page.setDefaultTimeout(40000);const errors=[],badResponses=[];
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
  try {
    await page.goto(origin+host.entry+'?mode=snes&no-sw=1',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('startupNotice')?.hidden||document.getElementById('status')?.textContent==='Startup failed.');
    assert.equal(await page.locator('#startupNotice').isVisible(),false,await page.locator('#startupMessage').textContent());
    await page.waitForFunction(()=>window.monaco?.editor?.getEditors().length===1);
    assert.equal(await page.locator('#playgroundMode').inputValue(),'snes');
    const marker=`__SNES_BRR_PROBE_${name}_${execution}__`,beforeWorkers=await page.evaluate(()=>__snesBrrAudit.workers.length);
    await setSource(page,probeSource(marker),execution);await page.locator('#runButton').click();await waitLog(page,marker);
    const probe=await page.evaluate(marker=>{const text=document.getElementById('consoleOutput').textContent;return JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length).split('\n')[0]);},marker);
    assert.equal(probe.rejected,7);assert.equal(probe.bytes,72);await assertNoRuntimeError(page,`${name}/${execution} probe`);
    if(execution==='worker')assert(await page.evaluate(count=>__snesBrrAudit.workers.length>count,beforeWorkers),'Worker execution creates an actual Worker');
    const settle=execution==='worker'?await page.locator('#workerLookaheadMs').evaluate(input=>Number(input.value)+120):120;
    await page.waitForTimeout(settle);const probePcm=await capture(page);assert(probePcm.rms>.001&&probePcm.peak<1,`${name}/${execution}: encoded probe must produce finite nonzero S-DSP audio`);
    const probeStop=await stop(page,`${name}/${execution} probe`),runs=[];
    for(let pass=0;pass<2;pass++) {
      // Execute the exact selected artifact's example, without test code added.
      await setSource(page,host.source,execution);assert.equal(await page.evaluate(()=>monaco.editor.getEditors()[0].getValue()),host.source);
      await page.locator('#runButton').click();await waitLog(page,'PCM 128 frames → BRR 72 bytes;');await page.waitForTimeout(settle);
      const pcm=await capture(page);assert(pcm.rms>.001&&pcm.peak<1,`${name}/${execution}/pass${pass+1}: exact PCM→BRR example must sound`);
      await assertNoRuntimeError(page,`${name}/${execution}/pass${pass+1}`);const stopped=await stop(page,`${name}/${execution}/pass${pass+1}`);runs.push({pass:pass+1,pcm,stopped});
    }
    assert.deepEqual(errors,[],`${name}/${execution}: browser exceptions`);assert.deepEqual(badResponses,[],`${name}/${execution}: missing runtime assets`);
    const audit=await page.evaluate(()=>({worklets:__snesBrrAudit.worklets,workers:__snesBrrAudit.workers,physicalOutputMuted:[...__snesBrrAudit.sinks.values()].every(({gate})=>gate.gain.value===0)}));
    assert(audit.worklets.includes('tetorica-playground-snes'),'Actual SNES S-DSP AudioWorklet was created');assert(audit.physicalOutputMuted);
    return {browser:name,version:browser.version(),execution,probe,probePcm,probeStop,runs,...audit};
  }catch(error) {
    const state=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,log:document.getElementById('consoleOutput')?.textContent,processors:window.__snesBrrAudit?.processorErrors})).catch(()=>null);
    throw Error(`${name}/${execution}: ${error.message}\n${JSON.stringify({state,errors,badResponses})}`,{cause:error});
  }finally{await context.close();}
}

(async()=>{
  const host=await selectHost();let server;
  try {
    server=http.createServer(async(request,response)=>{
      try {
        const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
        if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
        if(pathname==='/__snes_brr_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(captureSource);return;}
        let file=path.resolve(host.directory,'.'+pathname);if(file!==host.directory&&!file.startsWith(host.directory+path.sep))throw Error('Outside selected host');
        if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');const bytes=await fs.readFile(file),name=path.relative(host.directory,file),hash=sha(bytes);
        if(served.has(name))assert.equal(served.get(name).sha256,hash,'Served source changed during check: '+name);served.set(name,{bytes:bytes.length,sha256:hash});
        const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
        response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
      }catch(error){response.writeHead(404).end(error.message);}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const results=[],engines=config.webkitOnly?[['webkit',webkit]]:[['chromium',chromium],...(config.webkit?[['webkit',webkit]]:[])];
    for(const [name,type]of engines) {
      const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try {for(const execution of ['main','worker']){const result=await runCase(browser,name,`http://127.0.0.1:${server.address().port}`,host,execution);results.push(result);console.log(`PASS ${name}/${execution}: global/pg encoder, exact example twice, finite S-DSP audio, Stop silence; physical output muted.`);}}
      finally{await browser.close();}
    }
    const report={schemaVersion:1,passed:true,physicalOutputMuted:true,publicUiOnly:true,repositoryFallback:false,host:host.directory,archive:host.archive,example:{path:host.example,bytes:Buffer.byteLength(host.source),sha256:sha(host.source)},results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))};
    if(config.out)await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
    console.log(`SNES PCM→BRR browser check passed: ${results.length} browser/execution routes${config.out?'; '+config.out:''}.`);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));if(host.temporary)await fs.rm(host.temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
