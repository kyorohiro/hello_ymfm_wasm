// Public Neo Geo Main/Worker UI -> ADPCM-A encoder -> actual YM2610/B AudioWorklet.
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
const usage='Usage: node scripts/check_adpcm_a_encoder_browser.cjs [--webkit | --webkit-only] [--host DIR | --zip ARCHIVE] [--out REPORT.json]';
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
const captureSource=`class AdpcmACapture extends AudioWorkletProcessor {
  constructor(){super();this.pending=null;this.port.onmessage=({data})=>{if(this.pending)throw Error('Concurrent ADPCM-A capture');this.pending={id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0};};}
  process(inputs,outputs){for(const ch of outputs[0])ch.fill(0);const p=this.pending;if(!p)return true;const count=Math.min(128,p.left.length-p.offset),input=inputs[0];for(let i=0;i<count;i++){p.left[p.offset+i]=input[0]?.[i]??0;p.right[p.offset+i]=input[1]?.[i]??input[0]?.[i]??0;}p.offset+=count;if(p.offset===p.left.length){this.pending=null;this.port.postMessage(p,[p.left.buffer,p.right.buffer]);}return true;}
}registerProcessor('adpcm-a-encoder-capture',AdpcmACapture);`;

async function selectHost() {
  let temporary=null,archive=null,directory=config.host??path.resolve(__dirname,'../docs');
  if(config.zip) {
    const bytes=await fs.readFile(config.zip);temporary=await fs.mkdtemp(path.join(os.tmpdir(),'adpcm-a-browser-'));directory=temporary;
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
    const entry=prefix+'index.html',example=prefix+'examples/neogeo/neogeo-adpcm-a-drums.js';
    try {
      await fs.access(path.join(candidate,entry));const source=await fs.readFile(path.join(candidate,example),'utf8');
      return {directory:candidate,entry:'/'+entry,example:'/'+example,source,temporary,archive};
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(temporary)await fs.rm(temporary,{recursive:true,force:true});
  throw Error('The selected host must contain Playground index.html and examples/neogeo/neogeo-adpcm-a-drums.js');
}

function instrumentation() {
  const audit=window.__adpcmAAudit={contexts:[],workers:[],worklets:[],sinks:new Map(),processorErrors:[]};
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
    const audit=window.__adpcmAAudit,context=[...audit.contexts].reverse().find(context=>context.state!=='closed'&&audit.sinks.has(context));
    if(!context)throw Error('No live Playground output graph');const sink=audit.sinks.get(context);
    if(!sink.capture) {
      await context.audioWorklet.addModule('/__adpcm_a_capture.js');
      const node=new AudioWorkletNode(context,'adpcm-a-encoder-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      audit.connect.call(sink.sum,node);audit.connect.call(node,sink.gate);sink.capture=node;sink.id=0;sink.pending=null;
      node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const p=sink.pending;sink.pending=null;clearTimeout(p.timer);p.resolve(data);}};
    }
    const data=await new Promise((resolve,reject)=>{
      if(sink.pending)throw Error('Concurrent output capture');const id=++sink.id;
      const timer=setTimeout(()=>{sink.pending=null;reject(Error('YM2610/B output capture timed out'));},10000);
      sink.pending={id,resolve,timer};sink.capture.port.postMessage({id,frames:16384});
    });
    const channels=[data.left.subarray(2048),data.right.subarray(2048)];let peak=0,energy=0,active=0;
    for(const channel of channels)for(const value of channel){if(!Number.isFinite(value))throw Error('Nonfinite final YM2610/B PCM');peak=Math.max(peak,Math.abs(value));energy+=value*value;if(Math.abs(value)>1e-5)active++;}
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
  const state=await page.evaluate(()=>({status:document.getElementById('status').textContent,log:document.getElementById('consoleOutput').textContent,processors:window.__adpcmAAudit.processorErrors}));
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
check(typeof encodeAdpcmA==='function'&&encodeAdpcmA===pg.encodeAdpcmA,'global and pg encoder availability');
const rate=fm.clock/432,pcm=Float32Array.from({length:Math.ceil(rate*.8)},(_,i)=>.18*Math.sin(2*Math.PI*440*i/rate)),before=Array.from(pcm);
const encoded=encodeAdpcmA(pcm),other=pg.encodeAdpcmA(pcm);
check(encoded.bytes instanceof Uint8Array&&encoded.bytes.length===Math.ceil(pcm.length/512)*256,'aligned ADPCM-A bytes');
check(encoded.sourceFrames===pcm.length&&encoded.frames===encoded.bytes.length*2&&encoded.paddingFrames===encoded.frames-pcm.length,'explicit padding and no resampling');
check(encoded.bytes.every((value,i)=>value===other.bytes[i])&&pcm.every((value,i)=>value===before[i]),'determinism and PCM ownership');
check(encoded.metrics.snrDb>25&&Number.isFinite(encoded.metrics.rmsError),'measured lossy quality');
let rejected=0;for(const bad of [()=>encodeAdpcmA([0]),()=>pg.encodeAdpcmA(pcm,null),()=>encodeAdpcmA(pcm,{sampleRate:44100}),()=>pg.encodeAdpcmA(pcm,{loop:true}),()=>encodeAdpcmA(pcm,{maxBytes:256}),()=>encodeAdpcmA(Float32Array.of(NaN)),()=>pg.encodeAdpcmA(Float32Array.of(1.01)),()=>encodeAdpcmA(new Float32Array())]){let threw=false;try{bad();}catch{threw=true;}check(threw,'invalid input/options rejected');rejected++;}
const rom=new Uint8Array(encoded.bytes.length*6);for(let voice=0;voice<6;voice++)rom.set(encoded.bytes,voice*encoded.bytes.length);
await adpcmA.loadMemory(rom);adpcmA.setVolume(52);
for(let voice=0;voice<6;voice++){adpcmA.setSample(voice,{start:voice*encoded.bytes.length,end:(voice+1)*encoded.bytes.length});adpcmA.setVoice(voice,{volume:24,left:voice<3,right:voice>=3});}
log(${JSON.stringify(marker)}+JSON.stringify({rejected,bytes:encoded.bytes.length,sourceFrames:encoded.sourceFrames,frames:encoded.frames,paddingFrames:encoded.paddingFrames,snrDb:encoded.metrics.snrDb,rate,voices:6}));
liveLoop('adpcm-a-probe',async()=>{adpcmA.keyOn([0,1,2,3,4,5]);await sleep(.4);});`;
}
async function runCase(browser,name,origin,host,execution,mode) {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});await context.addInitScript(instrumentation);
  const page=await context.newPage();page.setDefaultTimeout(40000);const errors=[],badResponses=[];
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
  try {
    await page.goto(origin+host.entry+'?mode='+mode+'&no-sw=1',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('startupNotice')?.hidden||document.getElementById('status')?.textContent==='Startup failed.');
    assert.equal(await page.locator('#startupNotice').isVisible(),false,await page.locator('#startupMessage').textContent());
    await page.waitForFunction(()=>window.monaco?.editor?.getEditors().length===1);
    assert.equal(await page.locator('#playgroundMode').inputValue(),mode);
    const marker=`__ADPCM_A_PROBE_${name}_${mode}_${execution}__`,beforeWorkers=await page.evaluate(()=>__adpcmAAudit.workers.length);
    await setSource(page,probeSource(marker),execution);await page.locator('#runButton').click();await waitLog(page,marker);
    const probe=await page.evaluate(marker=>{const text=document.getElementById('consoleOutput').textContent;return JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length).split('\n')[0]);},marker);
    assert.equal(probe.rejected,8);assert.equal(probe.voices,6);assert.equal(probe.rate,8000000/432);assert.equal(probe.bytes%256,0);await assertNoRuntimeError(page,`${name}/${execution} probe`);
    if(execution==='worker')assert(await page.evaluate(count=>__adpcmAAudit.workers.length>count,beforeWorkers),'Worker execution creates an actual Worker');
    const settle=execution==='worker'?await page.locator('#workerLookaheadMs').evaluate(input=>Number(input.value)+120):120;
    await page.waitForTimeout(settle);const probePcm=await capture(page);assert(probePcm.rms>.001&&probePcm.peak<1,`${name}/${execution}: encoded six-voice probe must produce finite nonzero YM2610/B audio`);
    const probeStop=await stop(page,`${name}/${execution} probe`),runs=[];
    for(let pass=0;pass<2;pass++) {
      // Execute the exact selected artifact's example, without test code added.
      await setSource(page,host.source,execution);assert.equal(await page.evaluate(()=>monaco.editor.getEditors()[0].getValue()),host.source);
      await page.locator('#runButton').click();await waitLog(page,'Six ADPCM-A drums:');await page.waitForTimeout(settle);
      const pcm=await capture(page);assert(pcm.rms>.001&&pcm.peak<1,`${name}/${execution}/pass${pass+1}: exact six-voice PCM→ADPCM-A example must sound`);
      await assertNoRuntimeError(page,`${name}/${execution}/pass${pass+1}`);const stopped=await stop(page,`${name}/${execution}/pass${pass+1}`);runs.push({pass:pass+1,pcm,stopped});
    }
    assert.deepEqual(errors,[],`${name}/${execution}: browser exceptions`);assert.deepEqual(badResponses,[],`${name}/${execution}: missing runtime assets`);
    const audit=await page.evaluate(()=>({worklets:__adpcmAAudit.worklets,workers:__adpcmAAudit.workers,physicalOutputMuted:[...__adpcmAAudit.sinks.values()].every(({gate})=>gate.gain.value===0)}));
    assert(audit.worklets.includes('ym2610b-processor'),'Actual YM2610/B AudioWorklet was created: '+audit.worklets.join(', '));assert(audit.physicalOutputMuted);
    return {browser:name,version:browser.version(),mode,execution,probe,probePcm,probeStop,runs,...audit};
  }catch(error) {
    const state=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,log:document.getElementById('consoleOutput')?.textContent,processors:window.__adpcmAAudit?.processorErrors})).catch(()=>null);
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
        if(pathname==='/__adpcm_a_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(captureSource);return;}
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
      try {for(const mode of ['neogeo','neogeo-b'])for(const execution of ['main','worker']){const result=await runCase(browser,name,`http://127.0.0.1:${server.address().port}`,host,execution,mode);results.push(result);console.log(`PASS ${name}/${mode}/${execution}: global/pg encoder, exact six-voice example twice, finite YM2610/B audio, Stop silence; physical output muted.`);}}
      finally{await browser.close();}
    }
    const report={schemaVersion:1,passed:true,physicalOutputMuted:true,publicUiOnly:true,repositoryFallback:false,host:host.directory,archive:host.archive,example:{path:host.example,bytes:Buffer.byteLength(host.source),sha256:sha(host.source)},results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))};
    if(config.out)await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
    console.log(`Neo Geo PCM→ADPCM-A browser check passed: ${results.length} browser/execution routes${config.out?'; '+config.out:''}.`);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));if(host.temporary)await fs.rm(host.temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
