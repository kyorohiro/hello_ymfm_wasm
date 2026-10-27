// Real Playground VGM/VGZ import -> editable JavaScript -> POKEY AudioWorklets.
// Authored fixtures contain no game music. The physical sink is always muted;
// captured PCM is compared against the original parser and actual WASM cores.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {gzipSync,gunzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('Usage: node scripts/check_playground_pokey_import_browser.cjs [--root=docs-or-flat-playground] [--chromium-only] [--webkit-only] [--sample-rate=44100|48000] [--out=REPORT.json]');process.exit(0);
}
for(const arg of args)if(!arg.startsWith('--root=')&&!arg.startsWith('--out=')&&!arg.startsWith('--sample-rate=')&&!['--chromium-only','--webkit-only'].includes(arg))throw Error('Unknown argument: '+arg);
assert(!(args.includes('--chromium-only')&&args.includes('--webkit-only')),'Choose at most one browser');
const root=path.resolve(repository,args.find(arg=>arg.startsWith('--root='))?.slice(7)??'docs');
const out=args.find(arg=>arg.startsWith('--out='))?.slice(6),rateArgument=args.find(arg=>arg.startsWith('--sample-rate='))?.slice(14);
const rates=rateArgument?[Number(rateArgument)]:[44100,48000];
assert(rates.every(rate=>[44100,48000].includes(rate)),'Supported fixture sample rates are 44100 and 48000');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex'),servedSources=new Map();
const hook=`
window.__pokeyImportCheck={runtime,megaDrive,virtualFiles,open:openVirtualFile,runOutcomes:[],get path(){return activeVirtualPath;},get editor(){return editorAdapter;}};
const __pokeyOriginalPlay=runtime.play.bind(runtime);
runtime.play=async(...args)=>{const started=performance.now();try{const result=await __pokeyOriginalPlay(...args);window.__pokeyImportCheck.runOutcomes.push({ok:true,durationMs:performance.now()-started});return result;}
catch(error){window.__pokeyImportCheck.runOutcomes.push({ok:false,name:error.name,message:error.message,durationMs:performance.now()-started});throw error;}};
`;
const captureSource=`
class PokeyImportCapture extends AudioWorkletProcessor {
  constructor(){super();this.capture=null;this.port.onmessage=({data})=>{this.capture={id:data.id,index:0,left:new Float32Array(data.frames),right:new Float32Array(data.frames)};};}
  process(inputs,outputs){
    for(const side of outputs[0])side.fill(0);
    const capture=this.capture;if(!capture)return true;
    const count=Math.min(128,capture.left.length-capture.index),input=inputs[0];
    if(input?.[0])capture.left.set(input[0].subarray(0,count),capture.index);
    if(input?.[1])capture.right.set(input[1].subarray(0,count),capture.index);
    capture.index+=count;
    if(capture.index===capture.left.length){this.capture=null;this.port.postMessage({id:capture.id,left:capture.left,right:capture.right},[capture.left.buffer,capture.right.buffer]);}
    return true;
  }
}registerProcessor('pokey-import-capture',PokeyImportCapture);
`;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    if(pathname==='/__pokey-import-capture.js'){response.writeHead(200,{'Content-Type':'text/javascript'}).end(captureSource);return;}
    let file=path.resolve(root,'.'+pathname);
    if(file!==root&&!file.startsWith(root+path.sep))throw Error('Outside test root');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    const original=await fs.readFile(file),name=path.relative(root,file).replaceAll(path.sep,'/'),hash=sha256(original);
    assert(!servedSources.has(name)||servedSources.get(name).sha256===hash,'Served source changed during browser check: '+name);
    servedSources.set(name,{bytes:original.length,sha256:hash});
    const body=path.basename(file)==='playground.js'?Buffer.concat([original,Buffer.from(hook)]):original;
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);
  }catch(error){response.writeHead(404).end(error.message);}
});
async function files(page){return page.evaluate(()=>window.__pokeyImportCheck.virtualFiles.list().map(file=>{
  const bytes=file.type==='text'?new TextEncoder().encode(file.data):file.data;
  let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619);
  return {path:file.path,type:file.type,length:bytes.length,hash:hash>>>0};
}).sort((a,b)=>a.path.localeCompare(b.path)));}
async function chooseVgm(page,bytes,name){
  if(!await page.locator('#mainMenu').evaluate(menu=>menu.open))await page.locator('#mainMenu > summary').click();
  if(!await page.locator('#menuImport').evaluate(menu=>menu.open))await page.locator('#menuImport > summary').click();
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#importVgmButton').click()]);
  await chooser.setFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
  await page.locator('#vgmImportDialog').waitFor({state:'visible'});
}
async function importVgm(page,input,{name,style,target,dense=false,dual=false}){
  const before=await files(page);await chooseVgm(page,input,name);
  assert.match(await page.locator('#vgmImportDetected').innerText(),/POKEY/i);
  assert(await page.locator('#pokeyImportOptions').isVisible(),'POKEY-specific import options are visible');
  for(const id of ['opnImportOptions','gameboyImportOptions','nesImportOptions','wonderswanImportOptions'])assert(!await page.locator('#'+id).isVisible(),id+' stays hidden');
  assert.deepEqual(await page.locator('#pokeyImportOptions input[name="pokeyImportMode"]').evaluateAll(nodes=>nodes.map(node=>node.value)),['raw','readable','high']);
  await page.locator(`input[name="pokeyImportMode"][value="${style}"]`).check();await page.locator('#vgmImportTarget').fill(target);
  assert(!await page.locator('#convertVgmButton').isDisabled());await page.locator('#convertVgmButton').click();
  await page.locator('#vgmImportDialog').waitFor({state:'hidden'});
  await page.waitForFunction(target=>window.__pokeyImportCheck.path===target&&window.__pokeyImportCheck.virtualFiles.get(target)?.type==='text',target);
  const after=await files(page),map=new Map(after.map(file=>[file.path,file])),prior=new Set(before.map(file=>file.path));
  for(const file of before)assert.deepEqual(map.get(file.path),file,'Import preserves '+file.path);
  const assets=after.filter(file=>!prior.has(file.path)&&file.path!==target),source=await page.evaluate(target=>window.__pokeyImportCheck.virtualFiles.get(target).data,target);
  assert.equal(assets.length,dense?1:0,'Only dense stream imports add one packed binary event sidecar');
  for(const asset of assets){assert.match(asset.path,/^\/pokey-[\w-]+\.dat$/);assert.notEqual(asset.type,'text');assert(asset.length>0);assert(source.includes(asset.path));}
  assert.match(source,/createSoundChip\(['"]pokey['"]/);assert.match(source,/createTimeline\(/);
  for(const method of ['prepareTimeline','getTimelineState','playTimeline'])assert.match(source,new RegExp('\\.'+method+'\\('));
  assert.match(source,/startFrame/);assert.match(source,/finally/);assert.match(source,/\.dispose\(/);
  assert(!source.includes('timeline.waitUntil('),'Renderer-owned playback avoids JavaScript timers per event');
  assert.equal((source.match(/createSoundChip\(['"]pokey['"]/g)??[]).length,dual?2:1,'Generated source creates one independent core per recorded POKEY');
  if(dense)assert(Buffer.byteLength(source)<65536,'Dense register streams remain outside small editable JavaScript');
  const diagnostic=await page.evaluate(async()=>{
    const model=monaco.editor.getEditors().find(editor=>editor.getModel()?.uri.path==='/project'+window.__pokeyImportCheck.path)?.getModel();
    if(!model)throw Error('Imported source is not active in Monaco');
    const factory=await monaco.languages.typescript.getJavaScriptWorker(),worker=await factory(model.uri),uri=model.uri.toString();
    const entries=[...await worker.getSyntacticDiagnostics(uri),...await worker.getSemanticDiagnostics(uri)];
    const ignored=monaco.languages.typescript.javascriptDefaults.getDiagnosticsOptions().diagnosticCodesToIgnore??[];
    const message=value=>typeof value==='string'?value:[value.messageText,...(value.next??[]).map(message)].join('\n');
    return entries.filter(entry=>!ignored.includes(entry.code)).map(entry=>({code:entry.code,message:message(entry.messageText)}));
  });
  assert.deepEqual(diagnostic,[],'Generated JavaScript Monaco diagnostics');
  return {target,style,input:name,inputBytes:input.length,inputSha256:sha256(input),dual,dense,sourceBytes:Buffer.byteLength(source),sourceSha256:sha256(source),assets,monacoDiagnostics:0};
}
async function installCapture(page){await page.evaluate(async()=>{
  const p=window.__pokeyImportCheck;if(p.capture)return;
  const context=p.megaDrive.audioContext;await context.audioWorklet.addModule('/__pokey-import-capture.js');
  const node=new AudioWorkletNode(context,'pokey-import-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',channelInterpretation:'discrete'});
  const sink=context.createGain();sink.gain.value=0;node.connect(sink);sink.connect(context.destination);p.megaDrive.audio.connectOutputMonitor(node);
  let sequence=0;const pending=new Map();node.port.onmessage=({data})=>{
    const entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);clearTimeout(entry.timer);
    const channels=[data.left,data.right].map(values=>{
      let square=0,peak=0,bad=0;for(const value of values){square+=value*value;peak=Math.max(peak,Math.abs(value));if(!Number.isFinite(value))bad++;}
      return {rms:Math.sqrt(square/values.length),peak,bad};
    });entry.resolve({sampleRate:context.sampleRate,frames:data.left.length,channels,...(entry.raw?{left:Array.from(data.left),right:Array.from(data.right)}:{})});
  };
  p.capture=(frames,{raw=false}={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('PCM capture timed out'));},8000);pending.set(id,{resolve,reject,timer,raw});node.port.postMessage({id,frames});});
});}
const capture=(page,frames=8192)=>page.evaluate(frames=>window.__pokeyImportCheck.capture(frames),frames);
const chipIds=page=>page.evaluate(()=>window.__pokeyImportCheck.runtime.chipInspector.list().map(entry=>entry.id).sort());
async function quiet(page,label){let pcm;for(let i=0;i<6;i++){pcm=await capture(page);if(pcm.channels.every(side=>side.bad===0&&side.peak<1e-7))return pcm;}throw Error(label+' remains audible: '+JSON.stringify(pcm));}
async function stop(page,baseline){
  await page.locator('#stopButton').click();
  await page.waitForFunction(()=>window.__pokeyImportCheck.runtime.getState().playback==='stopped');
  await page.waitForFunction(ids=>JSON.stringify(window.__pokeyImportCheck.runtime.chipInspector.list().map(entry=>entry.id).sort())===JSON.stringify(ids),baseline);
  return quiet(page,'Stop');
}
let modules;const references=new Map();
async function referencePcm(input,sampleRate){
  const key=sha256(input)+':'+sampleRate;if(references.has(key))return references.get(key);
  modules??=(async()=>{
    const [{PokeyAudioEngine},{Ym2612VGM},{VgmPlayer},{MultiChipAudioEngine},{default:factory},wasm]=await Promise.all([
      import(pathToFileURL(path.join(repository,'web/pokeyaudioengine.js'))),import(pathToFileURL(path.join(repository,'web/ym2612vgm.js'))),
      import(pathToFileURL(path.join(repository,'web/vgmplayer.js'))),import(pathToFileURL(path.join(repository,'web/multichipaudioengine.js'))),
      import(pathToFileURL(path.join(repository,'docs/generated/pokey_wasm.js'))),fs.readFile(path.join(repository,'docs/generated/pokey_wasm.wasm'))]);
    return {PokeyAudioEngine,Ym2612VGM,VgmPlayer,MultiChipAudioEngine,module:await factory({wasmBinary:wasm})};
  })();
  const {PokeyAudioEngine,Ym2612VGM,VgmPlayer,MultiChipAudioEngine,module}=await modules;
  const bytes=input[0]===0x1f&&input[1]===0x8b?gunzipSync(input):input,parser=new Ym2612VGM(bytes,{logger:{warn:message=>{throw Error(message);}}});
  const clock=parser.header.pokeyClock&0x3fffffff,count=parser.header.pokeyClock&0x40000000?2:1;
  const engines=await Promise.all(Array.from({length:count},()=>PokeyAudioEngine.create({moduleFactory:async()=>module,clock,outputSampleRate:sampleRate,masterVolume:1})));
  const frames=Math.ceil(parser.header.totalSamples*sampleRate/44100),left=new Float32Array(frames),right=new Float32Array(frames);let time=0,frame=0,writes=0;
  const targets={resolveChip:(kind,index)=>{assert.equal(kind,'pokey');assert(index<count);return {writeRegister:(r,v)=>{engines[index].writeRegister(r,v);writes++;}};}};
  try{
    while(!parser.ended){
      const event=parser.playStep(targets);
      if(event.type==='wait')parser.consumeWait(targets,event.samples,samples=>{
        time+=samples;const end=Math.min(frames,Math.ceil(time*sampleRate/44100)),length=end-frame;
        if(length){const mixedLeft=new Float64Array(length),mixedRight=new Float64Array(length);
          for(const engine of engines){const pcm=engine.generateStereoView(length);for(let i=0;i<length;i++){mixedLeft[i]+=pcm.left[i];mixedRight[i]+=pcm.right[i];}}
          left.set(mixedLeft,frame);right.set(mixedRight,frame);frame=end;
        }
      });
    }
  }finally{for(const engine of engines)engine.dispose();}
  assert.equal(frame,frames,'Original parser reaches the declared one-pass duration');
  let vgmPlayerParity=null;
  // Analyzer renders at44100 Hz. At that native VGM rate its existing player
  // and the independent absolute-sample reference must agree exactly. At
  // other output rates the timeline's explicit ceil-to-next-frame contract
  // is tested directly, without claiming equivalence to Analyzer resampling.
  if(sampleRate===44100){
    const entries=await Promise.all(Array.from({length:count},async(_,index)=>{
      const engine=await PokeyAudioEngine.create({moduleFactory:async()=>module,clock,outputSampleRate:sampleRate});
      return {type:'pokey',index,engine,target:{writeRegister:(r,v)=>engine.writeRegister(r,v)}};
    }));
    const engine=new MultiChipAudioEngine(entries,sampleRate,1),player=new VgmPlayer(engine),actualLeft=new Float32Array(frames),actualRight=new Float32Array(frames);
    try{
      player.load(bytes);player.setPrefetchFactor(1);player.play();
      for(let offset=0;offset<frames;offset+=128){const size=Math.min(128,frames-offset);player.process(actualLeft.subarray(offset,offset+size),actualRight.subarray(offset,offset+size),size);}
      let maximumDifference=0;for(let i=0;i<frames;i++)maximumDifference=Math.max(maximumDifference,Math.abs(left[i]-actualLeft[i]),Math.abs(right[i]-actualRight[i]));
      assert.equal(maximumDifference,0,'44100-Hz original VgmPlayer agrees with the independent reference');
      vgmPlayerParity={sampleRate,framesComparedPerChannel:frames,maximumDifference};
    }finally{engine.dispose();}
  }
  const value={left,right,frames,sampleRate,clock,chipCount:count,writes,vgmPlayerParity,sha256:sha256(Buffer.concat([Buffer.from(left.buffer),Buffer.from(right.buffer)]))};references.set(key,value);return value;
}
function comparePcm(actual,reference,label){
  assert.equal(actual.sampleRate,reference.sampleRate);assert(actual.channels.every(side=>side.bad===0),label+' finite PCM');
  const first=values=>values.findIndex(value=>Math.abs(value)>1e-6),expectedFirst=first(reference.left),actualFirst=first(actual.left),offset=actualFirst-expectedFirst;
  assert(expectedFirst>=0&&actualFirst>=0,label+' has an authored onset');assert(offset>=0,label+' capture precedes the authored onset');
  assert(actual.frames-offset>=reference.frames,label+' captures the complete reference interval');
  let maximumDifference=0,mismatchedSamples=0,square=0,transitions=0;const firstMismatches=[];
  for(const channel of ['left','right'])for(let i=0;i<reference.frames;i++){
    const difference=Math.abs(actual[channel][i+offset]-reference[channel][i]);maximumDifference=Math.max(maximumDifference,difference);square+=difference*difference;
    if(difference>2e-6){mismatchedSamples++;if(firstMismatches.length<6)firstMismatches.push({channel,frame:i,actual:actual[channel][i+offset],expected:reference[channel][i]});}
    if(i&&reference[channel][i]!==reference[channel][i-1])transitions++;
  }
  const result={framesComparedPerChannel:reference.frames,sampleRate:reference.sampleRate,captureOffsetFrames:offset,maximumDifference,mismatchedSamples,rmsError:Math.sqrt(square/(reference.frames*2)),firstMismatches,referenceTransitions:transitions,referenceSha256:reference.sha256,writes:reference.writes,referenceMapping:'absolute VGM samples rounded up to the next output frame',vgmPlayerParity:reference.vgmPlayerParity};
  assert.equal(mismatchedSamples,0,label+' matches original parser/core timing and unity gain: '+JSON.stringify(result));assert(transitions>1000,label+' exercises dense transitions');return result;
}
async function runImported(page,target,execution,input){
  const baseline=await chipIds(page),outcomes=await page.evaluate(()=>window.__pokeyImportCheck.runOutcomes.length),sampleRate=await page.evaluate(()=>window.__pokeyImportCheck.megaDrive.audioContext.sampleRate),reference=await referencePcm(input,sampleRate);
  await page.evaluate(({target,execution})=>{window.__pokeyImportCheck.open(target);document.getElementById('workerExecution').checked=execution==='worker';},{target,execution});
  await page.evaluate(frames=>{window.__pokeyImportCheck.rawCapture=window.__pokeyImportCheck.capture(frames,{raw:true});},Math.ceil(sampleRate*2));
  await page.locator('#runButton').click();
  const raw=await page.evaluate(()=>window.__pokeyImportCheck.rawCapture),pcm=comparePcm(raw,reference,`${execution} ${target}`);
  await page.waitForFunction(count=>window.__pokeyImportCheck.runOutcomes.length>count,outcomes);
  const outcome=await page.evaluate(()=>window.__pokeyImportCheck.runOutcomes.at(-1));assert.equal(outcome.ok,true,'Generated source completes: '+JSON.stringify(outcome));
  await page.waitForFunction(ids=>JSON.stringify(window.__pokeyImportCheck.runtime.chipInspector.list().map(entry=>entry.id).sort())===JSON.stringify(ids),baseline);
  const ended=await quiet(page,'Natural completion');await stop(page,baseline);
  return {target,execution,chipCount:reference.chipCount,clock:reference.clock,pcm,naturalCompletion:true,disposed:true,completionDurationMs:outcome.durationMs,stoppedPeak:Math.max(...ended.channels.map(side=>side.peak)),listeningPerformed:false};
}
async function invalidImport(page,input,name){
  const before=await files(page);await chooseVgm(page,input,name);
  if(!await page.locator('#convertVgmButton').isDisabled()){
    await page.locator('#vgmImportTarget').fill('/imports/invalid-'+name+'.js');await page.locator('#convertVgmButton').click();
    await page.waitForFunction(()=>/failed|unsupported|invalid|unexpected|requires|second|mixed|POKEY/i.test(document.getElementById('vgmImportNotice').textContent));
  }
  assert(await page.locator('#vgmImportDialog').isVisible(),name+' is rejected without closing into a successful import');
  const message=await page.locator('#vgmImportNotice').innerText();assert(message.length>5,name+' has a useful reason');
  await page.locator('#cancelVgmImportButton').click();await page.locator('#vgmImportDialog').waitFor({state:'hidden'});
  assert.deepEqual(await files(page),before,name+' writes no project or binary files');return {name,message,filesUnchanged:true};
}
async function checkBrowser(name,type,url,fixture){
  const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
  try{
    const results=[];
    for(const sampleRate of rates){
      const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1100}}),errors=[],missing=[];
      page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));page.on('response',response=>{if(response.status()===404)missing.push(response.url());});
      await page.addInitScript(rate=>{const Context=window.AudioContext??window.webkitAudioContext;class ForcedSampleRateContext extends Context{constructor(options={}){super({...options,sampleRate:rate});}}window.AudioContext=ForcedSampleRateContext;if(window.webkitAudioContext)window.webkitAudioContext=ForcedSampleRateContext;},sampleRate);
      try{
        await page.goto(url+'?mode=genesis&no-sw=1');await page.waitForFunction(()=>window.__pokeyImportCheck?.editor.kind==='monaco');await page.locator('#startupNotice').waitFor({state:'hidden'});
        const before=await files(page);
        for(const dense of [false,true]){
          await chooseVgm(page,fixture({dual:true,dense}),'cancel-'+dense+'.vgm');await page.locator('#cancelVgmImportButton').click();await page.locator('#vgmImportDialog').waitFor({state:'hidden'});
          assert.deepEqual(await files(page),before,'Cancel imports no JavaScript or binary sidecars');
        }
        await page.evaluate(()=>{const p=window.__pokeyImportCheck,audio=p.megaDrive.audio,ensure=audio.ensureRouting.bind(audio);audio.ensureRouting=context=>{if(!audio.outputNode){const sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);audio.outputNode=sink;}return ensure(context);};p.editor.setValue('await sleep(0.01);');});
        await page.locator('#runButton').click();await page.waitForFunction(()=>window.__pokeyImportCheck.megaDrive.isReady());await installCapture(page);
        assert.equal(await page.evaluate(()=>window.__pokeyImportCheck.megaDrive.audioContext.sampleRate),sampleRate);
        const baseline=await chipIds(page);await stop(page,baseline);const imports=[],runs=[];
        for(const dense of [false,true])for(const dual of [false,true])for(const style of ['raw','readable','high']){
          console.error(`[${name} ${sampleRate}] ${dual?'dual':'single'} ${dense?'12kHz-DAC':'register'} ${style}: Main + Worker`);
          const input=fixture({dual,dense}),compressed=style==='readable',inputName=`${dual?'dual':'single'}-${dense?'dac':'register'}-${style}.${compressed?'vgz':'vgm'}`,target='/imports/'+inputName.replace(/\.[^.]+$/,'.js');
          imports.push(await importVgm(page,compressed?gzipSync(input):input,{name:inputName,style,target,dense,dual}));
          for(const execution of ['main','worker'])runs.push(await runImported(page,target,execution,input));
        }
        const target='/imports/repeated-dual.js',longInput=fixture({dual:true,dense:true,seconds:3});
        imports.push(await importVgm(page,longInput,{name:'repeated-dual.vgm',style:'high',target,dense:true,dual:true}));
        const replacements=[];
        for(const execution of ['main','worker']){
          await page.evaluate(({target,execution})=>{window.__pokeyImportCheck.open(target);document.getElementById('workerExecution').checked=execution==='worker';},{target,execution});
          await page.locator('#runButton').click();await page.waitForFunction(ids=>window.__pokeyImportCheck.runtime.chipInspector.list().filter(entry=>!ids.includes(entry.id)).length===2,baseline);
          await page.locator('#runButton').click();await page.waitForTimeout(450);
          assert.equal((await chipIds(page)).length,baseline.length+2,'Run -> Run replaces two additional POKEYs');
          const pcm=await capture(page);assert(pcm.channels.every(side=>side.bad===0&&side.rms>.001),'Replacement stream remains audible');
          await stop(page,baseline);
          await page.locator('#runButton').click();await page.locator('#stopButton').click();await page.waitForTimeout(450);
          assert.deepEqual(await chipIds(page),baseline,'Immediate Stop leaves no retired asynchronous extra creation');await quiet(page,'Immediate Stop');
          replacements.push({execution,repeatedRun:true,immediateStop:true,disposed:true});
        }
        const variant=Buffer.from(fixture());variant.writeUInt32LE((0x80000000|1789773)>>>0,0xb0);
        const mixed=Buffer.from(fixture());mixed.writeUInt32LE(3579545,0x0c);
        const undeclared=Buffer.from(fixture());undeclared[0x101]|=0x80;
        const invalid=[];for(const [name,bytes] of [['variant.vgm',variant],['mixed-psg.vgm',mixed],['undeclared-second.vgm',undeclared],['truncated.vgm',fixture().subarray(0,0x102)]])invalid.push(await invalidImport(page,bytes,name));
        assert.equal(await page.locator('#playgroundMode').inputValue(),'genesis','POKEY import preserves the selected mode');
        assert.deepEqual(missing,[],'No missing source or flat-package assets');
        const knownCancellation=error=>['Canceled','Canceled: Canceled'].includes(error.message)&&error.stack?.includes('monaco-editor')&&error.stack.includes('setModel')&&error.stack.includes('dispose');
        assert.deepEqual(errors.filter(error=>!knownCancellation(error)),[],'Browser runtime errors');
        results.push({sampleRate,imports,runs,replacements,cancelChangesNoFiles:true,unsupported:invalid,modelCancellations:errors.filter(knownCancellation).length});
      }finally{await page.close();}
    }
    return {browser:name,browserVersion:browser.version(),passed:true,physicalOutputMuted:true,results};
  }finally{await browser.close();}
}
(async()=>{
  try{
    const {createPokeyImportVgm}=await import(pathToFileURL(path.join(repository,'test/helpers/pokey_vgm_fixture.mjs')));
    const nested=await fs.stat(path.join(root,'playground/index.html')).then(()=>true,()=>false);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const url=`http://127.0.0.1:${server.address().port}/${nested?'playground/':''}index.html`,results=[];
    for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
      if(args.includes('--chromium-only')&&name!=='chromium'||args.includes('--webkit-only')&&name!=='webkit')continue;
      results.push(await checkBrowser(name,type,url,createPokeyImportVgm));
    }
    const referenceSources={};
    for(const name of ['web/pokey.js','web/pokeyaudioengine.js','web/ym2612vgm.js','web/vgmplayer.js','web/multichipaudioengine.js','docs/generated/pokey_wasm.js','docs/generated/pokey_wasm.wasm']){
      const bytes=await fs.readFile(path.join(repository,name));referenceSources[name]={bytes:bytes.length,sha256:sha256(bytes)};
    }
    const report={schemaVersion:1,root,fixture:{path:'test/helpers/pokey_vgm_fixture.mjs',sha256:sha256(await fs.readFile(path.join(repository,'test/helpers/pokey_vgm_fixture.mjs')))},checkerSha256:sha256(await fs.readFile(__filename)),servedSources:Object.fromEntries([...servedSources].sort(([a],[b])=>a.localeCompare(b))),referenceSources,results};
    if(out)await fs.writeFile(path.resolve(out),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({passed:true,root,browsers:results.map(result=>result.browser),sampleRates:rates,pcmRuns:results.reduce((sum,result)=>sum+result.results.reduce((sum,result)=>sum+result.runs.length,0),0),out:out??null}));
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
