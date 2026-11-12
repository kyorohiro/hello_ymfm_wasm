// Silent actual-WASM regression: selecting SPU sounds keeps the Code runtime and FX.
// Destination interception is installed before app scripts. No listening occurs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',out:path.join(tmpdir(),'spu-live-presets-browser.json'),screenshots:path.join(tmpdir(),'spu-live-presets-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(30);}throw Error('Timeout: '+label);}
function installSilentAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],commands=[],captureMutes=[],pendingObserved=new WeakMap();let sequence=0,capture=null,delayNext=0,delaySound=0,held=0;
  const nativeTimer=window.setTimeout.bind(window);
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){
    if(data?.method){commands.push({method:data.method,args:data.args});if(commands.length>10000)commands.shift();}
    if(data?.method==='applyInstrument'&&delaySound){let pending=pendingObserved.get(this);if(!pending)pendingObserved.set(this,pending=new Map());pending.set(data.id,delaySound);delaySound=0;}
    if(data?.method==='observeCode'){let pending=pendingObserved.get(this);if(!pending)pendingObserved.set(this,pending=new Map());pending.set(data.id,delayNext);delayNext=0;}
    return post.call(this,data,...args);
  };
  let descriptor,prototype=MessagePort.prototype;
  while(prototype&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(prototype,'onmessage');prototype=Object.getPrototypeOf(prototype);}
  if(!descriptor?.set)throw Error('MessagePort callback descriptor unavailable');
  Object.defineProperty(MessagePort.prototype,'onmessage',{configurable:true,get(){return descriptor.get.call(this);},set(fn){
    if(typeof fn!=='function'){descriptor.set.call(this,fn);return;}const port=this;
    descriptor.set.call(this,event=>{const pending=pendingObserved.get(port),delay=pending?.get(event.data?.id);pending?.delete(event.data?.id);
      if(delay){held++;nativeTimer(()=>{held--;fn.call(port,event);},delay);}else fn.call(port,event);});
  }});
  const muted=()=>meters.every(item=>item.mute.gain.value===0)&&captureMutes.every(item=>item.gain.value===0);
  function sample(item){
    const values=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(values);
    let square=0,peak=0;for(const value of values){square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/values.length),peak,finite:values.every(Number.isFinite)};
  }
  const readOutput=()=>{
    const active=meters.filter(item=>item.source.context.state==='running').map(item=>sample(item)).sort((a,b)=>b.rms-a.rms);
    return{...(active[0]??{rms:0,peak:0,finite:true}),muted:muted()};
  };
  async function read(){
    const node=nodes.findLast(item=>item.name==='tetorica-spu-synth')?.node;if(!node)throw Error('SPU editor Worklet missing');
    const id=--sequence;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SPU audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timeout);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'inspect',args:[]});
    });
  }
  async function beginCapture(){
    if(capture)throw Error('Capture already active');
    const source=meters.filter(item=>item.source.context.state==='running').sort((a,b)=>sample(b).rms-sample(a).rms)[0]?.source;
    if(!source)throw Error('No post-Master source');
    const name='spu-code-fade-audit-'+Math.abs(--sequence),url=URL.createObjectURL(new Blob([
      `class Capture extends AudioWorkletProcessor{process(inputs){const x=inputs[0];if(x?.[0])this.port.postMessage({frame:currentFrame,values:x[0].slice()});return true;}}registerProcessor('${name}',Capture);`
    ],{type:'text/javascript'}));
    try{await source.context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    const node=new AudioWorkletNode(source.context,name,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]}),mute=source.context.createGain();mute.gain.value=0;captureMutes.push(mute);
    const current=capture={source,node,mute,blocks:[],mark:null};
    node.port.onmessage=({data})=>{if(current.blocks.length<1024)current.blocks.push(data);};
    connect.call(source,node);connect.call(node,mute);connect.call(mute,source.context.destination);
  }
  function finishCapture(){
    const item=capture;capture=null;if(!item||item.mark===null)throw Error('Stop capture missing');
    item.source.disconnect(item.node);item.node.disconnect();item.mute.disconnect();item.node.port.close();
    const blocks=item.blocks.sort((a,b)=>a.frame-b.frame),rate=item.source.context.sampleRate;
    if(blocks.length<20)throw Error('Stop capture is too short');
    const first=blocks[0].frame,last=blocks.at(-1),values=new Float32Array(last.frame+last.values.length-first);
    let expected=first;for(const block of blocks){if(block.frame!==expected)throw Error('Stop capture has render gaps');values.set(block.values,block.frame-first);expected+=block.values.length;}
    const mark=item.mark-first;let beforePeak=0,beforeJump=0,maxJump=0,tailPeak=0,lastNonzero=null;
    for(let i=Math.max(1,mark-Math.round(.05*rate));i<values.length;i++){
      const peak=Math.abs(values[i]),jump=Math.abs(values[i]-values[i-1]);
      if(i<mark-128){beforePeak=Math.max(beforePeak,peak);beforeJump=Math.max(beforeJump,jump);}
      if(i>=mark-128&&i<mark+.04*rate)maxJump=Math.max(maxJump,jump);
      if(i>mark+.05*rate)tailPeak=Math.max(tailPeak,peak);
      if(peak>1e-8)lastNonzero=first+i;
    }
    return{frames:values.length,sampleRate:rate,beforePeak,beforeJump,maxJump,normalizedJump:maxJump/beforePeak,tailPeak,
      lastNonzeroAfterStopMs:lastNonzero===null?null:1000*(lastNonzero-item.mark)/rate,muted:muted()};
  }
  async function rpc(method,args=[]){const node=nodes.findLast(item=>item.name==='tetorica-spu-synth')?.node,id=--sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('audit RPC timeout')),5000);function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});}
  window.__spuCodeAudit={read,rpc,nodeNames:()=>nodes.map(item=>item.name),commands:()=>commands.slice(),armDelay(ms=400){delayNext=ms;},armSoundDelay(ms=400){delaySound=ms;},held:()=>held,output:readOutput,beginCapture,finishCapture,markStop(){if(!capture)throw Error('Capture missing');capture.mark=Math.round(capture.source.context.currentTime*capture.source.context.sampleRate);},
    graph(){return{contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,editorWorklets:nodes.filter(item=>item.name==='tetorica-spu-synth').length,
      destinationConnections:meters.length,captureBranches:captureMutes.length,muted:muted()};},drain(){return commands.splice(0);}};
}

const LOOP=`const ps1=await useSoundChip('ps1');
const memo=await livePrepare('proof',()=>({ticks:0,prepared:1}));
context.marker??={retained:true};
globalThis.__spuPresetProbe={memo,context,ps1};globalThis.__spuPresetOriginal??=globalThis.__spuPresetProbe;
liveFx('half',{process(input,output){for(let ch=0;ch<output.length;ch++)for(let i=0;i<output[ch].length;i++)output[ch][i]=(input[ch]?.[i]??0)*.5;}});
liveLoop('phrase',async()=>{const state=await ps1.getState();const channel=state.pmon.enabled?CH2:CH1;
 await ps1.noteOn(channel,'C4');await sleep(.08);await ps1.noteOff(channel);memo.ticks++;await sleep(.03);});`;
async function rpc(page,method,args=[]){return page.evaluate(async({method,args})=>JSON.parse(JSON.stringify(await __spuCodeAudit.rpc(method,args),(_key,value)=>ArrayBuffer.isView(value)?Array.from(value):value)),{method,args});}
async function file(page,name){if(await page.locator('#spuFilesPanel').isHidden())await page.locator('#spuFilesToggle').click();for(let i=0;i<8;i++){const closed=page.locator('#spuFilesTree details:not([open])>summary');if(!await closed.count())break;await closed.first().click();}await page.locator('#spuFilesTree button[data-file-path='+JSON.stringify(name)+']').click();await until(()=>page.locator('#spuFilesSelected').textContent().then(value=>value===name),'Files '+name);}
async function running(page,ticks){await until(async()=>{const error=await page.locator('#synthCodeError').textContent();assert.equal(error,'');return page.evaluate(before=>Boolean(globalThis.__spuPresetProbe&&globalThis.__spuPresetOriginal&&__spuPresetProbe===globalThis.__spuPresetOriginal&&__spuPresetProbe.memo.prepared===1&&__spuPresetProbe.memo.ticks>before),ticks);},'same prepared loop advances');assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);assert.equal(await page.evaluate(()=>__spuPresetProbe.context.marker.retained),true);}
async function check(browser,name,origin,fixture){
 const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),checks=[],measurements={},errors=[],consoleErrors=[];let phase='startup';
 const step=label=>{phase=label;checks.push(label);console.log('CHECK '+name+': '+label);};
 page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()))consoleErrors.push(message.text());});
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
 await page.addInitScript(installSilentAudit);
 try{
  await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files ready');
  await page.locator('#spuProjectFileInput').setInputFiles({name:'live-presets.zip',mimeType:'application/zip',buffer:Buffer.from(fixture.zip)});
  await until(()=>page.locator('#spuFilesTree [data-file-path="/index.js"]').count().then(Boolean),'project restored');assert.equal((await page.evaluate(()=>__spuCodeAudit.graph())).contexts,0);
  await file(page,'/index.js');await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeRunButton').click();await running(page,1);
  const names=await page.evaluate(()=>__spuCodeAudit.nodeNames()),beforeCommands=(await page.evaluate(()=>__spuCodeAudit.commands())).length;
  const tick=()=>page.evaluate(()=>__spuPresetProbe.memo.ticks);
  async function changed(action,expected){const before=await tick();await action();await until(async()=>expected(await rpc(page,'getInstrument',[0])),'new authored sound');await running(page,before);await until(()=>page.evaluate(()=>{const value=__spuCodeAudit.output();return value.muted&&value.finite&&value.rms>.00001;}),'selected sound actual PCM');const pcm=await page.evaluate(()=>__spuCodeAudit.output());assert(pcm.muted&&pcm.finite);assert.deepEqual(await page.evaluate(()=>__spuCodeAudit.nodeNames()),names,'same APU and software FX nodes');}
  step('Files JSON updates sample, ADSR and reverb while the exact loop/context/preparation/FX survive');
  await changed(()=>file(page,'/presets/Triangle.spu.json'),value=>value.preset.adsr1===fixture.json.preset.adsr1&&value.reverb.preset==='room'&&value.sample.adpcm.join(',')===fixture.json.sample.adpcm.join(','));
  step('saved VAB Tone picker uses the same Code client and keeps original VAB tuning');
  const vabValue='vab:'+encodeURIComponent('/presets/Demo.vab')+'#1';await changed(()=>page.locator('#spuPresetSelect').selectOption(vabValue),value=>Math.abs(value.sample.baseFrequencyHz-fixture.tone.options.baseFrequencyHz)<1e-8&&value.sample.adpcm.join(',')===Array.from(fixture.tone.adpcm).join(','));
  step('direct Load selected Tone and menu preset import keep Run alive');
  await page.locator('[data-spu-editor-tab=bank]').click();await page.locator('#vabFileInput').setInputFiles({name:'Demo.vab',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.vab)});
  await until(()=>page.locator('#loadVabTone').isEnabled(),'VAB Tone ready');await page.locator('#vabTone').selectOption('0');
  await changed(()=>page.locator('#loadVabTone').click(),value=>Math.abs(value.sample.baseFrequencyHz-fixture.first.options.baseFrequencyHz)<1e-8);
  await changed(()=>page.locator('#presetFileInput').setInputFiles({name:'Triangle.spu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.json))}),value=>value.reverb.preset==='room'&&value.preset.adsr1===fixture.json.preset.adsr1);
  step('invalid sound keeps the current Run and bank; Reset to Sine is also a live sound selection');
  const previous=await rpc(page,'getInstrument',[0]),before=await tick();
  await page.locator('#presetFileInput').setInputFiles({name:'bad.spu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...fixture.json,preset:{...fixture.json.preset,pitch:-1}}))});
  await until(()=>page.locator('#audioStatus').getAttribute('data-error').then(value=>value==='true'),'invalid preset shown');assert.deepEqual(await rpc(page,'getInstrument',[0]),previous);await running(page,before);
  await page.locator('#synthMenuButton').click();await changed(()=>page.locator('#resetPreset').click(),value=>value.waveform?.length===112&&value.morph.enabled&&!value.noise.enabled&&!value.pmon.enabled);
  await changed(()=>page.locator('#spuPresetSelect').selectOption('/presets/Triangle.spu.json'),value=>value.preset.adsr1===fixture.json.preset.adsr1);
  const mutationCommands=(await page.evaluate(()=>__spuCodeAudit.commands())).slice(beforeCommands);assert(!mutationCommands.some(item=>['stop','stopVoices','beginCode'].includes(item.method)),'sound selection never tears down Code');
  let latest=await rpc(page,'getInstrument',[0]);measurements.newSound=latest;measurements.loop=await page.evaluate(()=>({ticks:__spuPresetProbe.memo.ticks,prepared:__spuPresetProbe.memo.prepared}));
  step('Stop during a committed preset acknowledgement keeps the newest author without restarting Code');
  await page.evaluate(()=>__spuCodeAudit.armSoundDelay(400));
  const duringStop={...fixture.json,name:'Committed before Stop',preset:{...fixture.json.preset,volumeLeft:.31}};
  await page.locator('#presetFileInput').setInputFiles({name:'during-stop.spu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(duringStop))});
  await until(()=>page.evaluate(()=>__spuCodeAudit.held()>0),'committed sound ACK held');
  latest=await rpc(page,'getInstrument',[0]);assert.equal(latest.preset.volumeLeft,.31);
  await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stopped');
  await until(async()=>await rpc(page,'observeCode')===null,'Stop fully retires the Code lease');await until(()=>page.evaluate(()=>__spuCodeAudit.held()===0),'late sound ACK reconciled');await until(()=>page.locator('#instrumentName').inputValue().then(value=>value===duringStop.name),'committed author name after Stop');assert.deepEqual(await rpc(page,'getInstrument',[0]),latest);
  const stale=await page.evaluate(async()=>{try{await __spuPresetProbe.ps1.noteOn(0,60);return false;}catch(error){return error.name==='AbortError';}});assert(stale);
  step('project replacement remains an owner transition that stops Code');await file(page,'/index.js');await page.evaluate(()=>{delete globalThis.__spuPresetOriginal;});await page.locator('#synthCodeRunButton').click();await running(page,1);
  await page.locator('#spuProjectFileInput').setInputFiles({name:'replacement.zip',mimeType:'application/zip',buffer:Buffer.from(fixture.zip)});await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'project replacement retires Run');await until(async()=>await rpc(page,'observeCode')===null,'project Code lease fully stopped');
  const graph=await page.evaluate(()=>__spuCodeAudit.graph());assert(graph.muted&&graph.contexts===1&&graph.editorWorklets===1&&graph.destinationConnections===1);measurements.graph=graph;
  await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-1240.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,errors,consoleErrors};
 }catch(error){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,phase,checks,measurements,errors,consoleErrors,error:error.stack,status:await page.locator('#audioStatus').textContent().catch(()=>null)};throw error;}finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);
  res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const [{createSpuCodeProject},{writeSpuInstrument},{preparePs1Waveform},{readVab,prepareVabTone},{createVabFixture}]=await Promise.all([
    import(pathToFileURL(path.join(repo,'docs/synth-spu/code_project.js')).href),import(pathToFileURL(path.join(repo,'docs/synth-spu/spu_synth_instrument.js')).href),
    import(pathToFileURL(path.join(repo,'docs/js/ps1_waveform.js')).href),import(pathToFileURL(path.join(repo,'docs/synth-spu/spu_synth_vab.js')).href),import(pathToFileURL(path.join(repo,'test/helpers/spu_vab_fixture.mjs')).href)]);
  const vab=createVabFixture().vab,bank=readVab(vab),wave=preparePs1Waveform(Array.from({length:112},(_,i)=>.45*2/Math.PI*Math.asin(Math.sin(2*Math.PI*i/112))));
  const json=writeSpuInstrument('Triangle selection',{preset:{volumeLeft:.4,volumeRight:.35,adsr1:0x000f,adsr2:0x1fc0,pitch:4096,reverb:true},sample:{adpcm:wave.adpcm,baseFrequencyHz:44100/112,loopStartSamples:0},reverb:{preset:'room',volumeLeft:.2,volumeRight:.3},waveform:null,pmon:{enabled:false},noise:{enabled:false},morph:{enabled:false}});
  const project=createSpuCodeProject({starterCode:LOOP});project.importFiles([{path:'/presets/Triangle.spu.json',data:JSON.stringify(json)},{path:'/presets/Demo.vab',type:'binary',data:vab}]);project.select('/index.js');project.setCodeState({mode:'code',path:'/index.js'});
  const fixture={zip:project.exportProject(),json,vab,tone:prepareVabTone(bank,1),first:prepareVabTone(bank,0)};
  let failure;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin,fixture));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);assert(blockedMonaco.length,'Monaco fallback exercised');
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}: {})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
