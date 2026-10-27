// Actual browser Main/Worker clients -> independent POKEY AudioWorklets.
// Synthetic traces only. Capture occurs before the processor zeros its output.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('Usage: node scripts/check_playground_pokey_prepare_browser.cjs [--root=docs] [--chromium-only|--webkit-only] [--sample-rate=44100|48000] [--execution=main|worker] [--small-only] [--out=REPORT.json]');process.exit(0);
}
for(const arg of args)if(!['--chromium-only','--webkit-only','--small-only'].includes(arg)&&!['--root=','--out=','--sample-rate=','--execution='].some(prefix=>arg.startsWith(prefix)))throw Error('Unknown argument: '+arg);
assert(!(args.includes('--chromium-only')&&args.includes('--webkit-only')));
const root=path.resolve(repository,args.find(arg=>arg.startsWith('--root='))?.slice(7)??'docs');
const out=args.find(arg=>arg.startsWith('--out='))?.slice(6)??'/private/tmp/pokey-prepare-browser.json';
const rate=args.find(arg=>arg.startsWith('--sample-rate='))?.slice(14),rates=rate?[Number(rate)]:[44100,48000];
const execution=args.find(arg=>arg.startsWith('--execution='))?.slice(12),executions=execution?[execution]:['main','worker'];
assert(rates.every(value=>[44100,48000].includes(value)));assert(executions.every(value=>['main','worker'].includes(value)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),sources=new Map(),errors=[];

// Observes the original port without changing messages, timing or transfer lists.
function observePort(port){
  let stats;
  const reset=()=>stats={methods:{},chunks:0,chunkBytes:0,maximumChunkBytes:0,maximumPendingAppends:0,pendingAppends:0,appendAcks:0,appendErrors:0,uploadIds:[],chunksTransferred:0};
  reset();const requests=new Map(),post=port.postMessage.bind(port);
  port.postMessage=(data,transfer)=>{
    const commands=Array.isArray(data)?data:data.commands??[data];
    for(const command of commands){
      if(!command?.method)continue;stats.methods[command.method]=(stats.methods[command.method]??0)+1;
      if(command.id!==undefined)requests.set(command.id,command.method);
      if(command.method==='beginTimelineUpload')stats.uploadIds.push(command.args[0].uploadId);
      if(command.method==='appendTimelineChunk'){
        const bytes=command.args[0].data.byteLength;stats.chunks++;stats.chunkBytes+=bytes;stats.maximumChunkBytes=Math.max(stats.maximumChunkBytes,bytes);
        stats.pendingAppends++;stats.maximumPendingAppends=Math.max(stats.maximumPendingAppends,stats.pendingAppends);
        if(transfer?.includes(command.args[0].data.buffer))stats.chunksTransferred++;
      }
    }
    return post(data,transfer);
  };
  port.addEventListener('message',({data})=>{
    const method=requests.get(data?.id);if(!method)return;requests.delete(data.id);
    if(method==='appendTimelineChunk'){stats.pendingAppends--;stats.appendAcks++;if(data.error)stats.appendErrors++;}
  });port.start();
  return {reset,get:()=>structuredClone(stats)};
}
function traceBytes(bytes){
  if(!Number.isInteger(bytes)||bytes<3||bytes>8*1024*1024)throw Error('Invalid fixture size');
  const data=new Uint8Array(bytes);let at=0,sample=0,records=0;
  const extra=bytes%3;
  if(extra===1){data.set([128,1,0,73],at);at+=4;sample+=128;records++;}
  if(extra===2){data.set([128,128,1,0,73],at);at+=5;sample+=16384;records++;}
  while(at<bytes){data[at++]=32;data[at++]=0;data[at++]=73+(records++&1);sample+=32;}
  return {version:1,clock:1789790,durationSamples:sample+64,data};
}
const workerSource=`import {createPokeyClient} from '/js/playground_pokey.js';
const observePort=${observePort.toString()},traceBytes=${traceBytes.toString()};
let client,observation;
self.onmessage=async({data})=>{try{let value;
if(data.method==='connect'){observation=observePort(data.port);client=createPokeyClient(data.port);value=true;}
else if(data.method==='prepareBytes')value=await client.prepareTimeline(traceBytes(data.args[0]));
else if(data.method==='resetStats'){observation.reset();value=true;}
else if(data.method==='stats')value=observation.get();
else value=await client[data.method](...(data.args??[]));
self.postMessage({id:data.id,value});}catch(error){self.postMessage({id:data.id,error:error.message,name:error.name});}};`;
const captureSource=`
class Capture extends AudioWorkletProcessor{
 constructor(){super();this.capture=null;this.port.onmessage=({data})=>{
  if(data.method==='start'){this.startId=data.id;this.capture={firstFrame:null,index:0,subject:new Float32Array(data.capacity),target:new Float32Array(data.capacity),pairMaximumDifference:0,pairMismatches:0,stereoMismatches:0,nonFinite:0,frameGaps:0,firstGap:null,transitions:0,peak:0,last:0,quanta:0};}
  else if(data.method==='stop'){const c=this.capture;this.capture=null;if(!c){this.port.postMessage({id:data.id,error:'No capture'});return;}
   const subject=c.subject.slice(0,c.index),target=c.target.slice(0,c.index);delete c.subject;delete c.target;
   this.port.postMessage({id:data.id,value:{...c,endFrame:c.firstFrame+c.index,stopMessageFrame:currentFrame,subject,target}},[subject.buffer,target.buffer]);}
 };}
 process(inputs,outputs){
  const c=this.capture,a=inputs[0]?.[0],b=inputs[1]?.[0],t=inputs[2]?.[0];
  if(c&&a&&b){if(c.firstFrame===null){c.firstFrame=currentFrame;this.port.postMessage({id:this.startId,value:{firstFrame:currentFrame}});}
   if(currentFrame!==c.firstFrame+c.index){c.frameGaps++;c.firstGap??={expected:c.firstFrame+c.index,actual:currentFrame};}
   if(c.index+a.length>c.subject.length){this.port.postMessage({fatal:'Capture capacity exceeded'});this.capture=null;}
   else{c.quanta++;for(let i=0;i<a.length;i++){
    const value=a[i],difference=Math.abs(value-b[i]);c.pairMaximumDifference=Math.max(c.pairMaximumDifference,difference);if(difference!==0)c.pairMismatches++;
    if(!Number.isFinite(value)||!Number.isFinite(b[i]))c.nonFinite++;
    if(value!==inputs[0][1]?.[i]||b[i]!==inputs[1][1]?.[i]||(t&&t[i]!==inputs[2][1]?.[i]))c.stereoMismatches++;
    if(c.index+i&&value!==c.last)c.transitions++;c.last=value;c.peak=Math.max(c.peak,Math.abs(value));
    c.subject[c.index+i]=value;c.target[c.index+i]=t?.[i]??0;
   }c.index+=a.length;}
  }
  for(const side of outputs[0])side.fill(0);return true;
 }
}registerProcessor('pokey-prepare-capture',Capture);`;
async function harness(){
  const [{createPokeyAudio},{createPokeyClient}]=await Promise.all([import('/js/playground_pokey_audio.js'),import('/js/playground_pokey.js')]);
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const context=new AudioContext({sampleRate:Number(new URL(location.href).searchParams.get('rate'))});
  await context.resume();
  await context.audioWorklet.addModule('/__capture.js');
  const capture=new AudioWorkletNode(context,'pokey-prepare-capture',{numberOfInputs:3,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',channelInterpretation:'discrete'});
  capture.connect(context.destination);
  const endpoints=await Promise.all(Array.from({length:3},()=>createPokeyAudio(context,null)));
  endpoints.forEach((endpoint,index)=>endpoint.node.connect(capture,0,index));
  const subject=createPokeyClient(endpoints[0].port),reference=createPokeyClient(endpoints[1].port);
  let rpcSequence=0;const request=(port,command,transfer)=>new Promise((resolve,reject)=>{
    const id='harness:'+ ++rpcSequence,timer=setTimeout(()=>{port.removeEventListener('message',listener);reject(Error('RPC timed out: '+(command.method??command.type)));},90000);
    const listener=({data})=>{if(data.id!==id)return;clearTimeout(timer);port.removeEventListener('message',listener);if(data.error){const error=Error(data.error);error.name=data.name??'Error';reject(error);}else resolve(data.value??data);};
    port.addEventListener('message',listener);port.start();port.postMessage({...command,id},transfer);
  });
  const raw=(method,args=[])=>request(endpoints[2].node.port,{method,args});
  const performance=(type,session,owner)=>request(endpoints[2].node.port,{type,session,...(owner?{owner}:{})});
  const envelope=(method,args,session,owner,followingControl)=>{
    const id='harness:'+ ++rpcSequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{endpoints[2].node.port.removeEventListener('message',listener);reject(Error('Envelope timed out'));},10000);
      const listener=({data})=>{if(data.id!==id)return;clearTimeout(timer);endpoints[2].node.port.removeEventListener('message',listener);if(data.error){const error=Error(data.error);error.name=data.name??'Error';reject(error);}else resolve(data.value);};
      endpoints[2].node.port.addEventListener('message',listener);const message={performance:{session,owner,time:context.currentTime},commands:[{method,args,id}]};
      endpoints[2].node.port.postMessage(followingControl?[message,followingControl]:message);
    });
  };
  const execution=new URL(location.href).searchParams.get('execution');let target,worker;
  if(execution==='worker'){
    worker=new Worker('/__worker.js',{type:'module'});let sequence=0;const pending=new Map();
    worker.onmessage=({data})=>{const entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);if(data.error){const error=Error(data.error);error.name=data.name??'Error';entry.reject(error);}else entry.resolve(data.value);};
    const call=(method,args=[],transfer)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,method,args},transfer);});
    await new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,method:'connect',port:endpoints[2].port},[endpoints[2].port]);});
    target={call};
  }else{
    const observation=window.observePort(endpoints[2].port),client=createPokeyClient(endpoints[2].port);
    target={call:async(method,args=[])=>method==='prepareBytes'?client.prepareTimeline(window.traceBytes(args[0])):method==='stats'?observation.get():method==='resetStats'?observation.reset():client[method](...args)};
  }
  const tone={version:1,clock:1789790,durationSamples:44100*300,data:new Uint8Array([0,15,3,0,8,0,0,0,73,0,1,168,0,9,0])};
  await Promise.all([subject.prepareTimeline(tone),reference.prepareTimeline(tone)]);
  const state=await subject.getTimelineState(),toneStartFrame=Math.ceil((state.currentFrame+context.sampleRate*.15)/128)*128;
  const soundPromises=[subject.playTimeline({startFrame:toneStartFrame}),reference.playTimeline({startFrame:toneStartFrame})];soundPromises.forEach(p=>p.catch(()=>{}));
  await context.resume();
  while(context.currentTime*context.sampleRate<toneStartFrame+4096)await new Promise(resolve=>setTimeout(resolve,10));
  await request(capture.port,{method:'start',capacity:context.sampleRate*90});
  const before=await raw('getTimelineState');
  const waitPreparing=async()=>{
    const deadline=performanceNow()+15000;let state;
    while(performanceNow()<deadline){state=await raw('getTimelineState');if(state.preparing&&state.bytesReceived>=16384)return state;await new Promise(resolve=>setTimeout(resolve,1));}
    throw Error('Did not observe staged preparation: '+JSON.stringify(state));
  };
  const assertAborted=async promise=>{const outcome=await promise;check(!outcome.ok&&outcome.name==='AbortError','Preparation cancellation must reject AbortError: '+JSON.stringify(outcome));return outcome;};
  const outcome=promise=>promise.then(value=>({ok:true,value}),error=>({ok:false,name:error.name,message:error.message}));
  const cancelled=[];
  await target.call('resetStats');const started=performanceNow();
  const prepared=await target.call('prepareBytes',[Number(new URL(location.href).searchParams.get('bytes'))]);
  const prepareDurationMs=performanceNow()-started,prepareStats=await target.call('stats');
  check(prepared.loaded&&!prepared.preparing,'Prepared trace commits atomically');
  for(const kind of ['stopTimeline','reset','performance-stop','replacement']){
    await target.call('resetStats');const preparing=outcome(target.call('prepareBytes',[307200]));
    const staged=await waitPreparing(),stats=await target.call('stats'),uploadId=stats.uploadIds.at(-1);check(uploadId!==undefined,'Observed original upload ID');
    let replacement;
    if(kind==='performance-stop')await performance('performance-stop',10);
    else if(kind==='replacement')replacement=outcome(target.call('prepareBytes',[307200]));
    else await target.call(kind);
    const aborted=await assertAborted(preparing);
    const staleCommit=await outcome(target.call('_requestControl',['commitTimelineUpload',[{uploadId}]]));check(!staleCommit.ok,'Cancelled upload cannot commit on its original actual port');
    const staleChunk=await outcome(target.call('_requestControl',['appendTimelineChunk',[{uploadId,offset:0,data:new Uint8Array([32,0,73])}]]));check(!staleChunk.ok,'Cancelled upload cannot append on its original actual port');
    let replacementOutcome;if(replacement){replacementOutcome=await replacement;check(replacementOutcome.ok&&replacementOutcome.value.loaded&&!replacementOutcome.value.preparing,'Old stale messages preserve replacement preparation');}
    const after=await raw('getTimelineState');check(!after.preparing,'Cancellation removes staging');
    cancelled.push({kind,staged,aborted,staleCommit,staleChunk,replacementOutcome,after,stats:await target.call('stats')});
  }
  // An actual tagged performance owner cancels an ACK still pending on the
  // renderer. A different owner cannot append to that owner's upload.
  await performance('performance-start',20);
  await envelope('beginTimelineUpload',[{uploadId:900002,version:1,clock:1789790,durationSamples:400000,byteLength:307200}],20,'prepare-owner');
  const wrongOwner=await outcome(envelope('appendTimelineChunk',[{uploadId:900002,offset:0,data:new Uint8Array([32,0,73])}],20,'other-owner'));
  check(!wrongOwner.ok,'Upload owner is enforced');
  const ownedData=window.traceBytes(307200).data.slice(0,16384);
  const pendingOwner=outcome(envelope('appendTimelineChunk',[{uploadId:900002,offset:0,data:ownedData}],20,'prepare-owner',{type:'performance-cancel-owner',session:20,owner:'prepare-owner'}));
  const ownerAborted=await assertAborted(pendingOwner),ownerAfter=await raw('getTimelineState');check(!ownerAfter.preparing,'Owner cancellation removes staging');
  cancelled.push({kind:'performance-cancel-owner',wrongOwner,aborted:ownerAborted,after:ownerAfter});
  // Replacing the actual endpoint port retires the old owner's staging.
  await target.call('resetStats');const portPreparation=outcome(target.call('prepareBytes',[307200]));const portStaged=await waitPreparing();
  const replacementChannel=new MessageChannel();endpoints[2].node.port.postMessage({port:replacementChannel.port1},[replacementChannel.port1]);
  const portAborted=await assertAborted(portPreparation),portAfter=await raw('getTimelineState');check(!portAfter.preparing,'Endpoint replacement removes staging');
  cancelled.push({kind:'port-replaced',staged:portStaged,aborted:portAborted,after:portAfter});
  replacementChannel.port2.close();
  const after=await raw('getTimelineState'),captured=await request(capture.port,{method:'stop'});
  check(captured.firstFrame<=before.currentFrame&&captured.endFrame>=after.currentFrame,'Capture covers all preparation and cancellation');
  check(captured.pairMismatches===0&&captured.stereoMismatches===0&&captured.nonFinite===0&&captured.frameGaps===0&&captured.peak>0.01&&captured.transitions>1000,'Held stereo PCM remains exactly equal to continuously running independent core');
  const encode=values=>{const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);};
  const subjectBase64=encode(captured.subject);delete captured.subject;delete captured.target;
  // Reuse the renderer after all aborted uploads. Play a short known score,
  // capturing its exact onset and completion against the independent core.
  const scoreData=new Uint8Array([0,15,3,0,8,0,0,0,41,0,1,168,0,9,0]);
  await raw('beginTimelineUpload',[{uploadId:900003,version:1,clock:1789790,durationSamples:8192,byteLength:scoreData.length}]);
  await raw('appendTimelineChunk',[{uploadId:900003,offset:0,data:scoreData}]);await raw('commitTimelineUpload',[{uploadId:900003}]);
  const scoreNow=await raw('getTimelineState'),scoreStartFrame=Math.ceil((scoreNow.currentFrame+context.sampleRate*.12)/128)*128;
  await request(capture.port,{method:'start',capacity:context.sampleRate*2});
  const scoreCompletion=await raw('playTimeline',[{startFrame:scoreStartFrame}]);
  const scoreCapture=await request(capture.port,{method:'stop'}),scoreBase64=encode(scoreCapture.target);
  delete scoreCapture.subject;delete scoreCapture.target;
  subject.dispose();reference.dispose();worker?.terminate();for(const endpoint of endpoints)endpoint.dispose();await context.close();
  return {execution,sampleRate:context.sampleRate,toneStartFrame,before,after,prepared,prepareDurationMs,prepareStats,cancelled,capture:captured,subjectBase64,score:{startFrame:scoreStartFrame,durationSamples:8192,completion:scoreCompletion,capture:scoreCapture,base64:scoreBase64}};
}
function performanceNow(){return globalThis.performance.now();}
const harnessSource=`window.observePort=${observePort.toString()};window.traceBytes=${traceBytes.toString()};const performanceNow=${performanceNow.toString()};window.__start=()=>window.__result=(${harness.toString()})();`;
const mime={'.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);let body;
    if(pathname==='/'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>POKEY incremental preparation PCM check</title><button id="start" onclick="window.__start()">Start synthetic PCM check</button><script type="module" src="/__harness.js"></script>');return;}
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    if(pathname==='/__worker.js')body=workerSource;else if(pathname==='/__capture.js')body=captureSource;else if(pathname==='/__harness.js')body=harnessSource;
    if(body!==undefined){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(body);return;}
    const file=path.resolve(root,'.'+pathname);assert(file.startsWith(root+path.sep),'Outside test root');
    const original=await fs.readFile(file),name=path.relative(root,file).replaceAll(path.sep,'/'),hash=sha(original);
    assert(sources.has(name),'Asset absent from prelaunch source snapshot: '+name);assert.equal(sources.get(name).sha256,hash,'Source changed during capture: '+name);sources.get(name).served=true;
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(original);
  }catch(error){errors.push(String(error));response.writeHead(404).end(error.message);}
});
async function snapshot(){
  for(const directory of ['js','generated'])for(const entry of await fs.readdir(path.join(root,directory),{withFileTypes:true})){
    if(!entry.isFile()||(!entry.name.endsWith('.js')&&!entry.name.startsWith('pokey_wasm.')))continue;
    const name=directory+'/'+entry.name,bytes=await fs.readFile(path.join(root,name));sources.set(name,{bytes:bytes.length,sha256:sha(bytes),served:false});
  }
}
async function independentPcm(result){
  const [{PokeyAudioEngine},{default:factory},wasmBinary]=await Promise.all([import(pathToFileURL(path.join(repository,'web/pokeyaudioengine.js'))),import(pathToFileURL(path.join(root,'generated/pokey_wasm.js'))),fs.readFile(path.join(root,'generated/pokey_wasm.wasm'))]);
  const engine=await PokeyAudioEngine.create({moduleFactory:factory,moduleOptions:{wasmBinary},clock:1789790,outputSampleRate:result.sampleRate});
  const bytes=Buffer.from(result.subjectBase64,'base64'),actual=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4),offset=result.capture.firstFrame-result.toneStartFrame;
  assert(offset>=0);let maximumDifference=0,mismatchedSamples=0,firstMismatch=null;
  try{
    engine.reset();for(const [register,value]of [[15,3],[8,0],[0,73],[1,168],[9,0]])engine.writeRegister(register,value);
    for(let frame=0;frame<offset;frame+=128)engine.generateStereoView(Math.min(128,offset-frame));
    for(let frame=0;frame<actual.length;frame+=128){const pcm=engine.generateStereoView(Math.min(128,actual.length-frame));for(let i=0;i<pcm.left.length;i++){
      const difference=Math.abs(actual[frame+i]-pcm.left[i]);maximumDifference=Math.max(maximumDifference,difference);
      if(difference!==0){mismatchedSamples++;firstMismatch??={frame:frame+i,actual:actual[frame+i],expected:pcm.left[i]};}
    }}
  }finally{engine.dispose();}
  const comparison={reference:'fresh independent WASM core, reset once, uninterrupted absolute-frame rendering',framesCompared:actual.length,offsetFrames:offset,maximumDifference,mismatchedSamples,firstMismatch,pcmSha256:sha(bytes)};
  assert.equal(mismatchedSamples,0,'Complete held-tone PCM matches fresh independent reference: '+JSON.stringify(comparison));
  delete result.subjectBase64;result.independentPcm=comparison;
  const scoreBytes=Buffer.from(result.score.base64,'base64'),scorePcm=new Float32Array(scoreBytes.buffer,scoreBytes.byteOffset,scoreBytes.byteLength/4),scoreFrames=Math.ceil(result.score.durationSamples*result.sampleRate/44100),scoreOffset=result.score.startFrame-result.score.capture.firstFrame;
  assert(scoreOffset>=0&&scoreOffset+scoreFrames<=scorePcm.length,'Short score capture contains its entire absolute renderer interval');
  const scoreEngine=await PokeyAudioEngine.create({moduleFactory:factory,moduleOptions:{wasmBinary},clock:1789790,outputSampleRate:result.sampleRate});let scoreMaximumDifference=0,scoreMismatches=0;
  try{
    scoreEngine.reset();for(const [register,value]of [[15,3],[8,0],[0,41],[1,168],[9,0]])scoreEngine.writeRegister(register,value);
    for(let frame=0;frame<scoreFrames;frame+=128){const pcm=scoreEngine.generateStereoView(Math.min(128,scoreFrames-frame));for(let i=0;i<pcm.left.length;i++){const difference=Math.abs(scorePcm[scoreOffset+frame+i]-pcm.left[i]);scoreMaximumDifference=Math.max(scoreMaximumDifference,difference);if(difference!==0)scoreMismatches++;}}
  }finally{scoreEngine.dispose();}
  assert.equal(scoreMismatches,0,'Short score after cancelled preparations preserves exact core PCM');assert(result.score.completion.ended);
  delete result.score.base64;result.score.independentPcm={framesCompared:scoreFrames,maximumDifference:scoreMaximumDifference,mismatchedSamples:scoreMismatches,pcmSha256:sha(scoreBytes)};
}
(async()=>{
  try{
    await snapshot();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+server.address().port,results=[];
    const names=args.includes('--chromium-only')?['chromium']:args.includes('--webkit-only')?['webkit']:['chromium','webkit'];
    for(const name of names){
      const browser=await ({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try{for(const sampleRate of rates)for(const execution of executions){
        const bytes=sampleRate===48000&&!args.includes('--small-only')?8*1024*1024:307200;
        console.log(`[${name} ${sampleRate} ${execution}] ${bytes} bytes: held PCM, staged transfer, cancellation and stale ownership`);
        const page=await browser.newPage({serviceWorkers:'block'}),pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error)));page.setDefaultTimeout(120000);
        try{
          await page.goto(`${base}/?rate=${sampleRate}&execution=${execution}&bytes=${bytes}`);
          await page.waitForFunction(()=>window.__start);await page.click('#start');
          const result=await page.evaluate(()=>Promise.race([window.__result,new Promise((resolve,reject)=>setTimeout(()=>reject(Error('Browser route exceeded 120 seconds')),120000))]));assert.deepEqual(pageErrors,[],'Browser errors');
          assert.equal(result.sampleRate,sampleRate,'AudioContext uses the requested actual sample rate');
          assert.equal(result.prepareStats.chunkBytes,bytes);assert(result.prepareStats.chunks>1);assert(result.prepareStats.maximumChunkBytes<=16384);assert.equal(result.prepareStats.maximumPendingAppends,1);assert.equal(result.prepareStats.pendingAppends,0);assert.equal(result.prepareStats.chunksTransferred,result.prepareStats.chunks);
          await independentPcm(result);results.push({browser:name,traceBytes:bytes,...result,physicalOutputZeroedAfterCapture:true});
          console.log(`  PASS ${result.independentPcm.framesCompared} exact PCM frames, ${result.prepareStats.chunks} acknowledged chunks, ${result.cancelled.length} cancellations`);
        }finally{await page.close();}
      }}finally{await browser.close();}
    }
    assert.deepEqual(errors,[],'Asset/source failures');
    for(const [name,entry]of sources)if(entry.served)assert.equal(sha(await fs.readFile(path.join(root,name))),entry.sha256,'Source remained frozen: '+name);
    const report={schemaVersion:1,passed:true,root,results,sources:Object.fromEntries([...sources].filter(([,entry])=>entry.served)),checkerSha256:sha(await fs.readFile(__filename)),syntheticFixtures:true,physicalOutputZeroedAfterCapture:true,listeningPerformed:false};
    await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log('PASS POKEY incremental preparation: '+results.length+' actual browser routes; '+out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
