// Real Playground VGM/VGZ import, generated JavaScript and Web Audio/WASM output.
// Fixtures are original register streams without game music, ROMs or BIOS data.
// The final graph is muted downstream; PCM is measured before the mute.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {gzipSync,gunzipSync} = require('node:zlib');
const {chromium,webkit} = require('playwright');
const repository = path.resolve(__dirname,'..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/check_playground_wonderswan_import_browser.cjs [--root=docs-or-flat-playground] [--chromium-only] [--webkit-only] [--timing-only] [--large-file=local.vgm-or.vgz] [--out=REPORT.json]');
  process.exit(0);
}
for (const arg of args) if (!arg.startsWith('--root=') && !arg.startsWith('--out=') && !arg.startsWith('--large-file=') &&
    !['--chromium-only','--webkit-only','--timing-only'].includes(arg)) throw Error('Unknown argument: ' + arg);
assert(!(args.includes('--chromium-only') && args.includes('--webkit-only')),'Choose at most one focused browser');
const docs = path.resolve(repository,args.find(arg=>arg.startsWith('--root='))?.slice(7) ?? 'docs');
const reportPath = args.find(arg=>arg.startsWith('--out='))?.slice(6);
const largeFilePath = args.find(arg=>arg.startsWith('--large-file='))?.slice(13);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const servedSources = new Map();
const hook = `
window.__wsImportCheck={runtime,megaDrive,virtualFiles,open:openVirtualFile,runOutcomes:[],get path(){return activeVirtualPath;},get editor(){return editorAdapter;}};
const __wsOriginalPlay=runtime.play.bind(runtime);
runtime.play=async(...args)=>{const started=performance.now();try{const result=await __wsOriginalPlay(...args);window.__wsImportCheck.runOutcomes.push({ok:true,durationMs:performance.now()-started});return result;}
catch(error){window.__wsImportCheck.runOutcomes.push({ok:false,name:error.name,message:error.message,durationMs:performance.now()-started});throw error;}};
`;
const captureSource = `
class WonderSwanImportCapture extends AudioWorkletProcessor {
  constructor(){super();this.capture=null;this.port.onmessage=({data})=>{this.capture={id:data.id,index:0,left:new Float32Array(data.frames),right:new Float32Array(data.frames)};};}
  process(inputs,outputs){
    for(const channel of outputs[0])channel.fill(0);
    const capture=this.capture;if(!capture)return true;
    const count=Math.min(128,capture.left.length-capture.index),input=inputs[0];
    if(input?.[0])capture.left.set(input[0].subarray(0,count),capture.index);
    if(input?.[1])capture.right.set(input[1].subarray(0,count),capture.index);
    capture.index+=count;
    if(capture.index===capture.left.length){this.capture=null;this.port.postMessage({id:capture.id,left:capture.left,right:capture.right},[capture.left.buffer,capture.right.buffer]);}
    return true;
  }
}
registerProcessor('wonderswan-import-capture',WonderSwanImportCapture);
`;
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server = http.createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    if(pathname==='/__wonderswan-import-capture.js'){response.setHeader('Content-Type','text/javascript');response.end(captureSource);return;}
    let file=path.resolve(docs,'.'+pathname);
    if(file!==docs&&!file.startsWith(docs+path.sep))throw Error('Outside test root');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    let body=await fs.readFile(file);
    servedSources.set(path.relative(docs,file).replaceAll(path.sep,'/'),{bytes:body.length,sha256:sha256(body)});
    if(path.basename(file)==='playground.js')body=Buffer.concat([body,Buffer.from(hook)]);
    response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');response.end(body);
  }catch(error){response.writeHead(404).end(error.message);}
});
async function files(page) {
  return page.evaluate(()=>window.__wsImportCheck.virtualFiles.list().map(file=>{
    const bytes=file.type==='text'?new TextEncoder().encode(file.data):file.data;
    let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619);
    return {path:file.path,type:file.type,length:bytes.length,hash:hash>>>0};
  }).sort((a,b)=>a.path.localeCompare(b.path)));
}
async function chooseVgm(page,bytes,name) {
  if(!await page.locator('#mainMenu').evaluate(menu=>menu.open))await page.locator('#mainMenu > summary').click();
  if(!await page.locator('#menuImport').evaluate(menu=>menu.open))await page.locator('#menuImport > summary').click();
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#importVgmButton').click()]);
  await chooser.setFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
  await page.locator('#vgmImportDialog').waitFor({state:'visible'});
}
async function importVgm(page,bytes,{name,style,target,pcm=false,large=false}) {
  const before=await files(page);
  await chooseVgm(page,bytes,name);
  assert.match(await page.locator('#vgmImportDetected').innerText(),/WonderSwan/i);
  assert(await page.locator('#wonderswanImportOptions').isVisible(),'WonderSwan options are visible');
  for(const id of ['opnImportOptions','gameboyImportOptions','nesImportOptions'])assert(!await page.locator('#'+id).isVisible(),id+' stays hidden');
  assert.deepEqual(await page.locator('#wonderswanImportOptions input[name="wonderswanImportMode"]').evaluateAll(nodes=>nodes.map(node=>node.value)),['raw','readable','high']);
  await page.locator(`input[name="wonderswanImportMode"][value="${style}"]`).check();
  await page.locator('#vgmImportTarget').fill(target);
  assert(!await page.locator('#convertVgmButton').isDisabled());
  await page.locator('#convertVgmButton').click();
  await page.locator('#vgmImportDialog').waitFor({state:'hidden'});
  await page.waitForFunction(target=>window.__wsImportCheck.path===target&&window.__wsImportCheck.virtualFiles.get(target)?.type==='text',target);
  const after=await files(page),afterMap=new Map(after.map(file=>[file.path,file]));
  for(const original of before)assert.deepEqual(afterMap.get(original.path),original,'Import preserves '+original.path);
  const previous=new Set(before.map(file=>file.path));
  const added=after.filter(file=>!previous.has(file.path)),assets=added.filter(file=>file.path!==target);
  assert(added.some(file=>file.path===target),'Import creates the requested JavaScript');
  assert.equal(assets.length,pcm?1:0,'Voice PCM imports add exactly one packed asset; wave imports add only JavaScript');
  for(const asset of assets){
    assert.match(asset.path,/^\/wonderswan-pcm-[\da-f-]+\.dat$/,'PCM asset has its own generated path');
    assert.notEqual(asset.type,'text','PCM data remains binary');
    assert(asset.length>0,'PCM asset contains data');
  }
  const source=await page.evaluate(target=>window.__wsImportCheck.virtualFiles.get(target).data,target);
  assert.match(source,/createSoundChip\(['"]wonderswan['"]/);
  assert.match(source,/finally/);assert.match(source,/\.dispose\(/);
  assert.match(source,/createTimeline\(/);assert.match(source,/\.prepareTimeline\(/);assert.match(source,/\.playTimeline\(/);
  assert(!source.includes('timeline.waitUntil('),'Imported PCM uses renderer sample boundaries rather than per-byte JavaScript timers');
  for(const asset of assets)assert(source.includes(asset.path),'Generated source reads the imported PCM asset');
  if(large){
    assert(Buffer.byteLength(source)<65536,'Dense Voice PCM stays outside the small editable JavaScript');
    assert(assets[0].length>2000000&&assets[0].length<3000000,'The local large-file check stores roughly 2.3 MB of packed PCM events');
  }
  if(style==='raw')assert.match(source,/writeRegister\(/);
  if(style==='readable')assert.match(source,/\/\/.*(?:CH|wave|Wave|register|RAM|sample)/);
  if(style==='high')assert.match(source,/\.(?:setWaveform|setVolume|setFrequency|setSweep|setNoise|setVoiceMode)\(/);
  const diagnostic=await page.evaluate(async()=>{
    const model=monaco.editor.getEditors().find(editor=>editor.getModel()?.uri.path==='/project'+window.__wsImportCheck.path)?.getModel();
    if(!model)throw Error('Imported source is not active in Monaco');
    const factory=await monaco.languages.typescript.getJavaScriptWorker(),worker=await factory(model.uri),uri=model.uri.toString();
    const syntax=await worker.getSyntacticDiagnostics(uri),semantic=await worker.getSemanticDiagnostics(uri);
    const ignored=monaco.languages.typescript.javascriptDefaults.getDiagnosticsOptions().diagnosticCodesToIgnore??[];
    const message=value=>typeof value==='string'?value:[value.messageText,...(value.next??[]).map(message)].join('\n');
    return [...syntax,...semantic].filter(item=>!ignored.includes(item.code)).map(item=>({code:item.code,message:message(item.messageText)}));
  });
  assert.deepEqual(diagnostic,[],'Generated JavaScript Monaco diagnostics');
  return {target,style,input:name,sourceBytes:Buffer.byteLength(source),sourceSha256:sha256(source),assets,monacoDiagnostics:0};
}
async function installCapture(page) {
  await page.evaluate(async()=>{
    const p=window.__wsImportCheck;if(p.capture)return;
    const context=p.megaDrive.audioContext;
    await context.audioWorklet.addModule('/__wonderswan-import-capture.js');
    const node=new AudioWorkletNode(context,'wonderswan-import-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',channelInterpretation:'discrete'});
    const sink=context.createGain();sink.gain.value=0;node.connect(sink);sink.connect(context.destination);
    p.megaDrive.audio.connectOutputMonitor(node);
    let sequence=0;const pending=new Map();
    node.port.onmessage=({data})=>{
      const request=pending.get(data.id);if(!request)return;pending.delete(data.id);clearTimeout(request.timer);
      const channels=[data.left,data.right].map(values=>{
        const mean=values.reduce((sum,value)=>sum+value,0)/values.length;
        let square=0,peak=0,bad=0;const crossings=[];
        for(let i=0;i<values.length;i++){const value=values[i];square+=(value-mean)**2;peak=Math.max(peak,Math.abs(value));if(!Number.isFinite(value))bad++;if(i&&values[i-1]<mean&&value>=mean)crossings.push(i-1+(mean-values[i-1])/(value-values[i-1]));}
        return {mean,rms:Math.sqrt(square/values.length),peak,bad,hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
      });request.resolve({frames:data.left.length,sampleRate:context.sampleRate,channels,...(request.raw?{left:Array.from(data.left),right:Array.from(data.right)}:{})});
    };
    p.capture=(frames=8192,{raw=false}={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('PCM capture timed out'));},6000);pending.set(id,{resolve,reject,timer,raw});node.port.postMessage({id,frames});});
    p.connections=[];const connected=new Set();
    const observeConnections=entries=>{
      const current=new Set(entries.map(entry=>entry.id));
      for(const entry of entries)if(!connected.has(entry.id)){
        p.connections.push({id:entry.id,kind:entry.kind,time:performance.now()});
        if(entry.kind==='wonderswan'&&p.captureOnConnection){
          const request=p.captureOnConnection;p.captureOnConnection=null;clearTimeout(request.timer);
          p.capture(request.frames,{raw:true}).then(request.resolve,request.reject);
        }
      }
      connected.clear();for(const id of current)connected.add(id);
    };
    p.runtime.chipInspector.subscribe(observeConnections);observeConnections(p.runtime.chipInspector.list());
  });
}
const capture=(page,frames=8192)=>page.evaluate(frames=>window.__wsImportCheck.capture(frames),frames);
const armRawCapture=(page,frames)=>page.evaluate(frames=>{
  const p=window.__wsImportCheck;
  p.rawCapture=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{p.captureOnConnection=null;reject(Error('No new WonderSwan connection to capture'));},5000);
    p.captureOnConnection={frames,resolve,reject,timer};
  });
},frames);
const readRawCapture=page=>page.evaluate(async()=>{const pcm=await window.__wsImportCheck.rawCapture;window.__wsImportCheck.rawCapture=null;return pcm;});
const chipIds=page=>page.evaluate(()=>window.__wsImportCheck.runtime.chipInspector.list().map(entry=>entry.id).sort());

// Original 12 kHz unsigned PCM with an observable silent onset and a long,
// nonrepeating byte sequence. A timer-batched trace may still be finite and
// nonzero; it cannot match these authored 3/4-sample transitions.
function timedVoiceFixture() {
  const commands=[],write=(register,value)=>commands.push(0xbc,register-0x80,value),wait=count=>{
    while(count){const n=Math.min(count,65535);commands.push(0x61,n&255,n>>>8);count-=n;}
  };
  write(0x91,8);write(0x94,15);write(0x88,0);write(0x90,0);
  const onset=2205,count=6000,durationSamples=onset+22050;
  wait(onset);write(0x90,0x22);
  let sample=onset,state=0x65a39d27;
  for(let i=0;i<count;i++){
    const next=onset+Math.floor(i*44100/12000);wait(next-sample);sample=next;
    state^=state<<13;state^=state>>>17;state^=state<<5;
    write(0x89,i<16?0xe0:i<32?0x20:16+((state>>>0)%224));
  }
  wait(durationSamples-sample);commands.push(0x66);
  const bytes=Buffer.alloc(0x100+commands.length);bytes.write('Vgm ');
  bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x171,8);bytes.writeUInt32LE(durationSamples,0x18);
  bytes.writeUInt32LE(0x100-0x34,0x34);bytes.writeUInt32LE(3072000,0xc0);bytes.set(commands,0x100);
  return bytes;
}

let referenceModules;
const referenceCache=new Map();
async function referencePcm(input,sampleRate,seconds=.5) {
  const key=`${sha256(input)}:${sampleRate}:${seconds}`;
  if(referenceCache.has(key))return referenceCache.get(key);
  referenceModules??=(async()=>{
    const [{WonderSwanAudioEngine},{Ym2612VGM},{default:factory},binary]=await Promise.all([
      import(pathToFileURL(path.join(repository,'web/wonderswanaudioengine.js'))),
      import(pathToFileURL(path.join(repository,'web/ym2612vgm.js'))),
      import(pathToFileURL(path.join(repository,'docs/generated/wonderswan_wasm.js'))),
      fs.readFile(path.join(repository,'docs/generated/wonderswan_wasm.wasm')),
    ]);
    return {WonderSwanAudioEngine,Ym2612VGM,module:await factory({wasmBinary:binary})};
  })();
  const {WonderSwanAudioEngine,Ym2612VGM,module}=await referenceModules;
  const bytes=input[0]===0x1f&&input[1]===0x8b?gunzipSync(input):input;
  const parser=new Ym2612VGM(bytes,{logger:{warn:message=>{throw Error(message);}}});
  const engine=await WonderSwanAudioEngine.create({moduleFactory:async()=>module,clock:parser.header.wonderswanClock,outputSampleRate:sampleRate,masterVolume:1});
  const frames=Math.round(seconds*sampleRate),left=new Float32Array(frames),right=new Float32Array(frames);
  let sample=0,frame=0;
  const targets={wonderswan:{writeRegister:(r,v)=>engine.writeWonderSwan(r,v),writeMemory:(a,v)=>engine.writeWonderSwanMemory(a,v)}};
  try{
    while(frame<frames){
      const event=parser.playStep(targets);if(event.type==='end')break;
      if(event.type==='wait')parser.consumeWait(targets,event.samples,count=>{
        sample+=count;const end=Math.min(frames,Math.ceil(sample*sampleRate/44100));
        if(end>frame){const pcm=engine.processFrames(end-frame);left.set(pcm.left,frame);right.set(pcm.right,frame);frame=end;}
      });
    }
  }finally{engine.dispose();}
  const reference={left,right,sampleRate,frames,sha256:sha256(Buffer.concat([Buffer.from(left.buffer),Buffer.from(right.buffer)]))};
  referenceCache.set(key,reference);return reference;
}
function compareTiming(actual,expected,label) {
  assert.equal(actual.sampleRate,expected.sampleRate);
  assert(actual.channels.every(side=>side.bad===0),label+' has finite PCM');
  const threshold=.0001,first=values=>values.findIndex(value=>Math.abs(value)>threshold);
  const actualFirst=first(actual.left),expectedFirst=first(expected.left);
  assert(actualFirst>=0&&expectedFirst>=0,label+' has a detectable authored onset');
  const offset=actualFirst-expectedFirst;
  assert(offset>=0,label+' capture starts before the authored onset');
  assert(actual.left.length-offset>=expected.frames,label+' capture contains the complete reference interval');
  let maximumDifference=0,squareError=0,mismatchedSamples=0,transitions=0;const firstMismatches=[];
  for(const channel of ['left','right'])for(let i=0;i<expected.frames;i++){
    const difference=Math.abs(actual[channel][offset+i]-expected[channel][i]);
    maximumDifference=Math.max(maximumDifference,difference);squareError+=difference*difference;
    if(difference>2e-6){mismatchedSamples++;if(firstMismatches.length<8)firstMismatches.push({channel,frame:i,actual:actual[channel][offset+i],expected:expected[channel][i]});}
    if(i&&expected[channel][i]!==expected[channel][i-1])transitions++;
  }
  const result={framesComparedPerChannel:expected.frames,sampleRate:expected.sampleRate,captureOffsetFrames:offset,maximumDifference,rmsError:Math.sqrt(squareError/(expected.frames*2)),mismatchedSamples,firstMismatches,referenceTransitions:transitions,referenceSha256:expected.sha256};
  assert.equal(mismatchedSamples,0,label+' matches direct-core PCM at the authored sample boundaries: '+JSON.stringify(result));
  assert(transitions>1000,label+' checks a dense waveform, not just nonzero output');
  return result;
}
async function quiet(page,label) {
  let pcm;for(let i=0;i<8;i++){pcm=await capture(page);if(pcm.channels.every(side=>side.bad===0&&side.peak<.00001))return pcm;}
  throw Error(label+' remains audible: '+JSON.stringify(pcm));
}
async function stop(page,baseline) {
  await page.locator('#stopButton').click();
  await page.waitForFunction(()=>window.__wsImportCheck.runtime.getState().playback==='stopped'&&!document.getElementById('stopButton').disabled);
  await page.waitForFunction(ids=>JSON.stringify(window.__wsImportCheck.runtime.chipInspector.list().map(entry=>entry.id).sort())===JSON.stringify(ids),baseline);
  return quiet(page,'Stop');
}
async function run(page,target,execution,{mode='wave',channel=0,finish=false}={}) {
  const baseline=await chipIds(page),outcomes=await page.evaluate(()=>window.__wsImportCheck.runOutcomes.length),connections=await page.evaluate(()=>window.__wsImportCheck.connections.length);
  await page.evaluate(({target,execution})=>{window.__wsImportCheck.open(target);document.getElementById('workerExecution').checked=execution==='worker';},{target,execution});
  await page.locator('#runButton').click();
  try{
    await page.waitForFunction(count=>window.__wsImportCheck.connections.slice(count).some(entry=>entry.kind==='wonderswan'),connections,{timeout:5000});
  }catch(error){
    const debug=await page.evaluate(()=>({outcomes:window.__wsImportCheck.runOutcomes,connections:window.__wsImportCheck.connections,state:window.__wsImportCheck.runtime.getState(),chips:window.__wsImportCheck.runtime.chipInspector.list(),body:document.body.innerText.slice(-8000)}));
    console.error('Run startup diagnostics',JSON.stringify({target,execution,mode,debug}));throw error;
  }
  const expectedFrequency=[220,330,440,550][channel];
  let pcm;for(let i=0;i<8;i++){
    pcm=await capture(page);
    if(pcm.channels.every(side=>side.bad===0&&side.rms>.0001&&(mode!=='wave'||Math.abs(side.hz-expectedFrequency)<2)))break;
  }
  assert(pcm.channels.every(side=>side.bad===0&&side.rms>.0001&&side.peak<.99),execution+' '+mode+' actual PCM: '+JSON.stringify(pcm));
  if(mode==='wave'){
    for(const side of pcm.channels)assert(Math.abs(side.hz-expectedFrequency)<2,`${execution} CH${channel+1} expected ~${expectedFrequency} Hz: ${JSON.stringify(pcm)}`);
  }
  const state=await page.evaluate(async ids=>{
    const p=window.__wsImportCheck,entry=p.runtime.chipInspector.list().find(entry=>entry.kind==='wonderswan'&&!ids.includes(entry.id));
    return {id:entry.id,state:await p.runtime.chipInspector.read(entry.id),mixer:p.megaDrive.mixer.list().map(entry=>entry.id)};
  },baseline);
  assert.equal(state.state.clock,3072000);assert.equal(state.state.sampleAddress,0x1200,'Physical high-byte RAM address and bank survive import');assert(state.mixer.includes(state.id),'Additional chip owns a mixer strip');
  if(mode!=='voice'){
    assert(state.state.channels[channel].waveform.slice(0,16).every(value=>value===15),'Original first half of waveform survives import');
    assert(state.state.channels[channel].waveform.slice(16).every(value=>value===0),'Original second half of waveform survives import');
  }
  if(mode==='wave')assert(state.state.channels[channel].active,'The recorded wave channel is active');
  if(mode==='noise')assert(state.state.noise.enabled,'Noise mode survives import');
  if(mode==='sweep')assert(state.state.sweep.enabled,'Sweep mode survives import');
  if(mode==='voice')assert(state.state.voiceMode,'Voice PCM mode survives import');
  let completionDurationMs=null;
  if(finish){
    await page.waitForFunction(count=>window.__wsImportCheck.runOutcomes.length>count,outcomes);
    const outcome=await page.evaluate(()=>window.__wsImportCheck.runOutcomes.at(-1));
    assert.equal(outcome.ok,true,'One-pass generated source completes successfully: '+JSON.stringify(outcome));
    completionDurationMs=outcome.durationMs;
    if(mode==='voice')assert(completionDurationMs>=1500&&completionDurationMs<=3500,
      `${execution}: dense 2-second Voice PCM stream must retain its duration without accumulated timer delays; actual ${completionDurationMs} ms`);
    await page.waitForFunction(ids=>JSON.stringify(window.__wsImportCheck.runtime.chipInspector.list().map(entry=>entry.id).sort())===JSON.stringify(ids),baseline);
    await quiet(page,'Natural completion');
  }
  const stopped=await stop(page,baseline);
  await page.waitForFunction(count=>window.__wsImportCheck.runOutcomes.length>count,outcomes);
  return {execution,mode,channel,pcm,createdMixerStrip:true,disposed:true,naturalCompletion:finish,completionDurationMs,stoppedPeak:Math.max(...stopped.channels.map(side=>side.peak))};
}
async function runTimedVoice(page,target,execution,{input,localLarge=false}={}) {
  const baseline=await chipIds(page),outcomes=await page.evaluate(()=>window.__wsImportCheck.runOutcomes.length);
  await page.evaluate(({target,execution})=>{window.__wsImportCheck.open(target);document.getElementById('workerExecution').checked=execution==='worker';},{target,execution});
  const sampleRate=await page.evaluate(()=>window.__wsImportCheck.megaDrive.audioContext.sampleRate);
  const reference=await referencePcm(input,sampleRate,localLarge ? .5 : .65);
  // Arm before Run so the silence preceding timeline playback and its first
  // authored frame are captured together. Only metrics leave this function.
  // Include Worker startup, its configured performance lead, and the complete
  // bounded reference. This is capture duration, not an expanded song render.
  await armRawCapture(page,Math.ceil(sampleRate*2));
  const started=Date.now();
  await page.locator('#runButton').click();
  if(localLarge)await page.waitForFunction(ids=>window.__wsImportCheck.runtime.chipInspector.list().some(entry=>entry.kind==='wonderswan'&&!ids.includes(entry.id)),baseline);
  const raw=await readRawCapture(page),timing=compareTiming(raw,reference,`${execution} ${localLarge?'local large':'synthetic 12 kHz'} Voice PCM`);
  const pcm={frames:raw.frames,sampleRate:raw.sampleRate,channels:raw.channels};
  if(localLarge){
    const state=await page.evaluate(async ids=>{
      const p=window.__wsImportCheck,entry=p.runtime.chipInspector.list().find(entry=>entry.kind==='wonderswan'&&!ids.includes(entry.id));
      return {id:entry.id,state:await p.runtime.chipInspector.read(entry.id),mixer:p.megaDrive.mixer.list().map(entry=>entry.id)};
    },baseline);
    assert.equal(state.state.clock,3072000);assert(state.state.voiceMode,'Local track retains Voice PCM mode');
    assert(state.mixer.includes(state.id),'Additional PCM chip owns a mixer strip');
  }else{
    await page.waitForFunction(count=>window.__wsImportCheck.runOutcomes.length>count,outcomes);
    const outcome=await page.evaluate(()=>window.__wsImportCheck.runOutcomes.at(-1));
    assert.equal(outcome.ok,true,'Renderer-completed timeline ends successfully: '+JSON.stringify(outcome));
    await page.waitForFunction(ids=>JSON.stringify(window.__wsImportCheck.runtime.chipInspector.list().map(entry=>entry.id).sort())===JSON.stringify(ids),baseline);
  }
  const stopped=await stop(page,baseline);
  await page.waitForFunction(count=>window.__wsImportCheck.runOutcomes.length>count,outcomes);
  return {execution,mode:localLarge?'local-large-voice':'synthetic-12khz-voice',pcm,timing,elapsedMs:Date.now()-started,disposed:true,naturalCompletion:!localLarge,stoppedPeak:Math.max(...stopped.channels.map(side=>side.peak)),listeningPerformed:false};
}
async function unsupported(page,fixture,name) {
  const before=await files(page);await chooseVgm(page,fixture,name);
  assert(await page.locator('#convertVgmButton').isDisabled(),name+' must not enable conversion');
  const message=await page.locator('#vgmImportNotice').innerText();assert(message.length>10,name+' needs an explanation');
  await page.locator('#cancelVgmImportButton').click();await page.locator('#vgmImportDialog').waitFor({state:'hidden'});
  assert.deepEqual(await files(page),before,'Unsupported '+name+' changes no project files');return {name,message,filesUnchanged:true};
}
async function checkBrowser(name,type,url,createFixture,largeFile) {
  const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
  try {
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1100}}),errors=[],missing=[];
    page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));page.on('response',response=>{if(response.status()===404)missing.push(response.url());});
    await page.goto(url+'?mode=wonderswan&no-sw=1');await page.waitForFunction(()=>window.__wsImportCheck?.editor.kind==='monaco');await page.locator('#startupNotice').waitFor({state:'hidden'});
    const before=await files(page);
    for(const mode of ['wave','voice']){
      await chooseVgm(page,createFixture({mode,seconds:2,loop:false}),`cancel-${mode}.vgm`);
      await page.locator('#cancelVgmImportButton').click();await page.locator('#vgmImportDialog').waitFor({state:'hidden'});
      assert.deepEqual(await files(page),before,'Cancelling '+mode+' import changes no project files or PCM assets');
    }
    await page.evaluate(()=>{const audio=window.__wsImportCheck.megaDrive.audio,ensure=audio.ensureRouting.bind(audio);audio.ensureRouting=context=>{if(!audio.outputNode){const sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);audio.outputNode=sink;}return ensure(context);};});
    await page.locator('#runButton').click();await page.waitForFunction(()=>window.__wsImportCheck.megaDrive.isReady());await installCapture(page);await stop(page,['wonderswan']);
    const imports=[],runs=[];
    if(!args.includes('--timing-only')){
    for(const style of ['raw','readable','high']){
      console.error(`[${name}] ${style}: VGM import, Main + Worker audio`);
      const bytes=createFixture({channel:0,seconds:2,loop:true}),compressed=style==='readable',inputName=`wave-${style}.${compressed?'vgz':'vgm'}`,target=`/imports/${inputName.replace(/\.[^.]+$/,'.js')}`;
      imports.push(await importVgm(page,compressed?gzipSync(bytes):bytes,{name:inputName,style,target}));
      runs.push(await run(page,target,'main',{finish:style==='high'}));
      runs.push(await run(page,target,'worker',{finish:style==='high'}));
    }
    for(const channel of [1,2,3]){
      console.error(`[${name}] high: wave CH${channel+1}`);
      const target=`/imports/wave-ch${channel+1}.js`;
      imports.push(await importVgm(page,createFixture({channel,seconds:2,loop:false}),{name:`wave-ch${channel+1}.vgm`,style:'high',target}));
      runs.push(await run(page,target,'main',{channel}));
    }
    for(const mode of ['noise','sweep','voice']){
      console.error(`[${name}] high: ${mode}, Main + Worker audio`);
      const target=`/imports/${mode}.js`,bytes=createFixture({mode,seconds:2,loop:false});
      imports.push(await importVgm(page,bytes,{name:`${mode}.vgm`,style:'high',target,pcm:mode==='voice'}));
      for(const execution of ['main','worker'])runs.push(await run(page,target,execution,{mode,finish:mode==='voice'}));
    }
    }
    const timedImports=[],timedRuns=[],timedInput=timedVoiceFixture();
    for(const style of ['raw','readable','high']){
      console.error(`[${name}] ${style}: authored 12 kHz PCM sample-boundary comparison, Main + Worker`);
      const target=`/imports/timed-12khz-${style}.js`;
      timedImports.push(await importVgm(page,timedInput,{name:'synthetic-12khz.vgm',style,target,pcm:true}));
      for(const execution of ['main','worker'])timedRuns.push(await runTimedVoice(page,target,execution,{input:timedInput}));
    }
    const largeImports=[],largeRuns=[];
    if(largeFile)for(const style of ['raw','readable','high']){
      console.error(`[${name}] ${style}: local large Voice PCM import, Main + Worker initial playback`);
      const target=`/imports/local-large-${style}.js`;
      largeImports.push(await importVgm(page,largeFile.bytes,{name:largeFile.name,style,target,pcm:true,large:true}));
      for(const execution of ['main','worker'])largeRuns.push(await runTimedVoice(page,target,execution,{input:largeFile.bytes,localLarge:true}));
    }
    if(largeFile)assert.equal(new Set(largeImports.map(item=>`${item.assets[0].length}:${item.assets[0].hash}`)).size,1,'Raw / Readable / High retain identical packed PCM event payloads');
    if(args.includes('--timing-only')){
      assert.deepEqual(missing,[],'No missing runtime or packaged assets');
      assert.deepEqual(errors,[],'Browser runtime errors');
      return {browser:name,browserVersion:browser.version(),passed:true,scope:'timing-only',imports,runs,timedImports,timedRuns,largeImports,largeRuns,physicalOutputMuted:true};
    }
    console.error(`[${name}] repeated Run and unsupported imports`);
    // Repeat Run while a generated one-pass stream is still alive. Runtime
    // replacement must dispose the retired extra chip rather than duplicate it.
    const repeat='/imports/wave-high.js',baseline=await chipIds(page);
    await page.evaluate(target=>{window.__wsImportCheck.open(target);document.getElementById('workerExecution').checked=false;},repeat);
    await page.locator('#runButton').click();await page.waitForFunction(()=>window.__wsImportCheck.runtime.chipInspector.list().length===2);
    await page.locator('#runButton').click();await page.waitForTimeout(300);
    assert.equal((await chipIds(page)).length,2,'Run → Run replaces its additional sound chip');
    const repeatPcm=await capture(page);assert(repeatPcm.channels.every(side=>side.bad===0&&side.rms>.0001),'Replacement Run is audible');await stop(page,baseline);
    const invalid=[];
    for(const [label,flags] of [['dual',0x40000000],['variant',0x80000000]]){
      const fixture=Buffer.from(createFixture({seconds:1,loop:false}));fixture.writeUInt32LE((3072000|flags)>>>0,0xc0);invalid.push(await unsupported(page,fixture,label+'.vgm'));
    }
    const mixed=Buffer.from(createFixture({seconds:1,loop:false}));mixed.writeUInt32LE(3579545,0x0c);invalid.push(await unsupported(page,mixed,'mixed-psg.vgm'));
    console.error(`[${name}] independent WonderSwan import in Genesis mode`);
    const genesisPage=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1100}}),genesis=[];
    genesisPage.setDefaultTimeout(20000);genesisPage.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));genesisPage.on('response',response=>{if(response.status()===404)missing.push(response.url());});
    try {
      await genesisPage.goto(url+'?mode=genesis&no-sw=1');await genesisPage.waitForFunction(()=>window.__wsImportCheck?.editor.kind==='monaco');await genesisPage.locator('#startupNotice').waitFor({state:'hidden'});
      assert.equal(await genesisPage.locator('#playgroundMode').inputValue(),'genesis');
      await genesisPage.evaluate(()=>{const audio=window.__wsImportCheck.megaDrive.audio,ensure=audio.ensureRouting.bind(audio);audio.ensureRouting=context=>{if(!audio.outputNode){const sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);audio.outputNode=sink;}return ensure(context);};});
      await genesisPage.locator('#runButton').click();await genesisPage.waitForFunction(()=>window.__wsImportCheck.megaDrive.isReady());await installCapture(genesisPage);await stop(genesisPage,await chipIds(genesisPage));
      const target='/imports/genesis-independent-wonderswan.js';
      const imported=await importVgm(genesisPage,createFixture({channel:0,seconds:2,loop:false}),{name:'independent-wonderswan.vgm',style:'high',target});
      for(const execution of ['main','worker'])genesis.push({...imported,...await run(genesisPage,target,execution,{finish:true})});
      assert.equal(await genesisPage.locator('#playgroundMode').inputValue(),'genesis','Import does not change the selected mode');
    } finally {await genesisPage.close();}
    assert.deepEqual(missing,[],'No missing runtime or packaged assets');
    const knownCancellation=error=>['Canceled','Canceled: Canceled'].includes(error.message)&&error.stack.includes('monaco-editor')&&error.stack.includes('setModel')&&error.stack.includes('dispose');
    assert.deepEqual(errors.filter(error=>!knownCancellation(error)),[],'Browser runtime errors');
    return {browser:name,browserVersion:browser.version(),passed:true,imports,runs,timedImports,timedRuns,largeImports,largeRuns,genesis,repeatRun:true,cancelChangesNoFiles:true,unsupported:invalid,physicalOutputMuted:true,modelCancellations:errors.filter(knownCancellation).length};
  } finally {await browser.close();}
}
(async()=>{
  try {
    const {createWonderSwanVgm}=await import(pathToFileURL(path.join(repository,'test/helpers/wonderswan_vgm_fixture.mjs')));
    // The optional game file is read only from the caller's local path. It is
    // never copied into the repository, served as an asset, or embedded in a report.
    const largeFile=largeFilePath?{name:path.basename(largeFilePath),bytes:await fs.readFile(path.resolve(largeFilePath))}:null;
    const nested=await fs.stat(path.join(docs,'playground/index.html')).then(()=>true,()=>false);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const url=`http://127.0.0.1:${server.address().port}/${nested?'playground/':''}index.html`;
    const results=[];
    for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
      if(args.includes('--chromium-only')&&name!=='chromium'||args.includes('--webkit-only')&&name!=='webkit')continue;
      const result=await checkBrowser(name,type,url,createWonderSwanVgm,largeFile);results.push(result);console.log(JSON.stringify(result));
    }
    const report={schemaVersion:1,root:docs,fixture:{path:'test/helpers/wonderswan_vgm_fixture.mjs',sha256:sha256(await fs.readFile(path.join(repository,'test/helpers/wonderswan_vgm_fixture.mjs')))},localLargeFile:largeFile?{name:largeFile.name,bytes:largeFile.bytes.length,sha256:sha256(largeFile.bytes),copiedIntoRepository:false}:null,checkerSha256:sha256(await fs.readFile(__filename)),servedSources:Object.fromEntries([...servedSources].sort(([a],[b])=>a.localeCompare(b))),results};
    if(reportPath)await fs.writeFile(path.resolve(reportPath),JSON.stringify(report,null,2)+'\n');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
