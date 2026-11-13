// Silent actual-WASM regression: selecting SPU sounds keeps the Code runtime and FX.
// Destination interception is installed before app scripts. No listening occurs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',out:path.join(tmpdir(),'spu-parameters-keyboard-browser.json'),screenshots:path.join(tmpdir(),'spu-parameters-keyboard-browser')};
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


const SONG=`const ps1=await useSoundChip('ps1');
const memo=await livePrepare('retained',()=>({ticks:0,motion:0}));context.identity??={retained:true};
globalThis.__spuParameters={memo,context,ps1};globalThis.__spuOriginal??=__spuParameters;
await ps1.setEnvelope(CH1,{attackRate:0,sustainLevel:15,sustainRate:127,releaseRate:0});await ps1.setEnvelope(CH2,{attackRate:22,sustainLevel:15,sustainRate:127,releaseRate:0});
await ps1.noteOn(CH1,'C4');await ps1.noteOn(CH2,'E4');await ps1.setReverb({preset:'room',volumeLeft:.2,volumeRight:.2});
liveFx('half',{process(input,output){for(let ch=0;ch<output.length;ch++)for(let i=0;i<output[ch].length;i++)output[ch][i]=(input[ch]?.[i]??0)*.5;}});
liveLoop('motion',async()=>{memo.motion++;await ps1.setReverb({volumeLeft:.15+.02*Math.sin(memo.motion)});await sleep(.05);});
liveLoop('melody',async()=>{await ps1.noteOn(CH3,60+(memo.ticks%3)*3);await sleep(.08);await ps1.noteOff(CH3);memo.ticks++;await sleep(.03);});`;
const MOTION=`const ps1=await useSoundChip('ps1');const memo=await livePrepare('retained',()=>({ticks:0,motion:0}));context.identity??={retained:true};
globalThis.__spuParameters={memo,context,ps1};globalThis.__spuOriginal??=__spuParameters;
liveFx('half',{process(input,output){for(let ch=0;ch<output.length;ch++)for(let i=0;i<output[ch].length;i++)output[ch][i]=(input[ch]?.[i]??0)*.5;}});
liveLoop('motion',async()=>{memo.ticks++;memo.motion++;await ps1.setReverb({volumeLeft:.15+.02*Math.sin(memo.motion)});await sleep(.05);});`;
const control=name=>`#spuVoicePanel [data-chip-control="ps1-${name}"]`;
async function rpc(page,method,args=[]){return page.evaluate(async({method,args})=>JSON.parse(JSON.stringify(await __spuCodeAudit.rpc(method,args),(_key,value)=>ArrayBuffer.isView(value)?Array.from(value):value)),{method,args});}
async function observation(page){return rpc(page,'observeCode');}
async function run(page,code){await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(code);await page.evaluate(()=>{delete globalThis.__spuOriginal;});await page.locator('#synthCodeRunButton').click();await running(page,0);await until(()=>page.locator('#spuVoicePanel').getAttribute('data-observing').then(value=>value==='true'),'Live ready');}
async function running(page,before){await until(async()=>{const error=await page.locator('#synthCodeError').textContent();assert.equal(error,'');return page.evaluate(tick=>Boolean(globalThis.__spuParameters&&globalThis.__spuOriginal&&__spuParameters===__spuOriginal&&__spuParameters.memo.ticks>tick&&__spuParameters.context.identity.retained),before);},'same Code runtime continues');assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);}
async function sounding(page){await until(()=>page.evaluate(()=>{const out=__spuCodeAudit.output();return out.muted&&out.finite&&out.rms>.00005;}),'finite actual PCM behind gain0');return page.evaluate(()=>__spuCodeAudit.output());}
async function editNumber(page,name,value){const input=page.locator(control(name));await input.fill(String(value));await input.press('Tab');}
async function stop(page){await page.locator('#synthCodeStopButton').click();await until(async()=>await observation(page)===null,'Code lease retired');await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'stopped');}
async function check(browser,name,origin){
 const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block'}),checks=[],measurements={},errors=[],consoleErrors=[];let phase='startup';
 const step=label=>{phase=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
 page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()))consoleErrors.push(message.text());});
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});await page.addInitScript(installSilentAudit);
 try{
  await page.goto(origin+config.entry);assert.equal((await page.evaluate(()=>__spuCodeAudit.graph())).contexts,0);await run(page,SONG);
  let nodes=await page.evaluate(()=>__spuCodeAudit.nodeNames());let tick=await page.evaluate(()=>__spuParameters.memo.ticks);
  step('Live ADSR edits the selected CH while Code melody, context, preparations and FX continue');
  await page.locator('#spuLiveChannel').selectOption('1');await until(()=>page.locator('#spuVoicePanel').getAttribute('data-observation-channel').then(value=>value==='1'),'CH2 selected');assert.equal(await page.locator('#spuVoicePanel').evaluate(node=>node.inert),false);
  await page.locator('[data-spu-editor-tab=adsr]').click();const before=await observation(page);await editNumber(page,'release-rate',9);
  await until(async()=>((await observation(page)).channels[1].adsr2&31)===9,'selected release changed');const after=await observation(page);
  assert.equal(after.channels[0].adsr2,before.channels[0].adsr2);for(const ch of[0,1]){assert.equal(after.channels[ch].pitch,before.channels[ch].pitch);assert.equal(after.channels[ch].sample,before.channels[ch].sample);assert(after.channels[ch].gate);}
  await running(page,tick);assert.equal((await rpc(page,'getInstrument',[0])).preset.adsr2&31,9);await page.locator('#spuLiveEnabled').uncheck();await until(()=>page.locator(control('attack-rate')).inputValue().then(value=>value==='0'),'Live Off repaints authored attack');await page.locator('#spuLiveEnabled').check();await until(()=>page.locator(control('attack-rate')).inputValue().then(value=>value==='22'),'Live On restores physical attack');
  step('shared Reverb remains editable and CH1 clearly disables impossible hardware PMON');
  await page.locator('[data-spu-editor-tab=fx]').click();await editNumber(page,'reverb-right',.35);await until(async()=>Math.abs((await observation(page)).reverb.volumeRight-.35)<1e-8,'shared right return');
  await page.locator('#spuLiveChannel').selectOption('0');await until(()=>page.locator('#spuVoicePanel [data-pmon=enabled]').isDisabled(),'CH1 PMON disabled');assert.match(await page.locator('#spuVoicePanel [data-pmon=enabled]').getAttribute('title'),/no preceding/);
  await page.locator('#spuLiveChannel').selectOption('1');await until(()=>page.locator('#spuVoicePanel [data-pmon=enabled]').isEnabled(),'CH2 PMON enabled');
  step('Code to Keyboard keeps Run; latest Note On owns the same selected physical CH');
  await page.locator('#synthInputKeyboardTab').click();assert(await page.locator('#synthCodeStopButton').isVisible());await page.locator('h1').click();await page.keyboard.down('y');
  await until(async()=>Boolean((await rpc(page,'inspect')).auditions.find(item=>item.channel===1)),'keyboard CH2 acquired');await sounding(page);
  assert.equal(await page.evaluate(()=>__spuParameters.ps1.noteOff(1)),false,'old Code noteOff does not stop keyboard');assert((await observation(page)).channels[1].gate);
  await page.evaluate(()=>__spuParameters.ps1.noteOn(1,72));await page.keyboard.up('y');const replacement=await observation(page);assert(replacement.channels[1].gate);assert(!replacement.auditions.some(item=>item.channel===1));
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert((await observation(page)).channels[1].gate);await running(page,tick);assert.deepEqual(await page.evaluate(()=>__spuCodeAudit.nodeNames()),nodes);
  await page.locator('#synthInputCodeTab').click();await running(page,tick);await page.locator('#synthInputKeyboardTab').click();await stop(page);
  step('Stop in Keyboard reopens the neutral route; a parameter-only Code loop accompanies keyboard melody');
  await page.locator('h1').click();await page.keyboard.down('y');measurements.afterStop=await sounding(page);await page.keyboard.up('y');await run(page,MOTION);nodes=await page.evaluate(()=>__spuCodeAudit.nodeNames());await page.locator('#spuLiveChannel').selectOption('1');await page.locator('#synthInputKeyboardTab').click();await page.locator('h1').click();await page.keyboard.down('y');await sounding(page);
  const motion=await page.evaluate(()=>__spuParameters.memo.motion);await wait(160);assert(await page.evaluate(value=>__spuParameters.memo.motion>value,motion));assert((await observation(page)).channels[1].gate);
  step('cycle/Morph, selected Noise and PMON edits keep the same runtime and shared source routing');
  await page.locator('[data-spu-editor-tab=pcm]').click();await until(()=>page.locator('#spuVoicePanel [data-chip-action=ps1-wave-saw]').isEnabled(),'shape available');await page.locator('#spuVoicePanel [data-chip-action=ps1-wave-saw]').click();await until(async()=>Boolean((await observation(page)).channels[1].waveform),'selected cycle applied');assert((await observation(page)).channels[1].gate);
  await page.locator('#spuVoicePanel [data-morph=enabled]').check();await page.locator('#spuVoicePanel [data-morph=amount]').evaluate(input=>{input.value='.4';input.dispatchEvent(new Event('input',{bubbles:true}));});await until(async()=>Math.abs((await observation(page)).channels[1].morphSettings.amount-.4)<.001,'selected Morph amount');
  await page.keyboard.up('y');await page.locator('#spuVoicePanel [data-noise=source]').selectOption('noise');await until(async()=>Boolean((await observation(page)).channels[1].noise),'CH2 Noise');const noise=await observation(page);assert.equal(noise.channels[0].noise,false);assert.equal(noise.channels[2].noise,false);
  await page.locator('h1').click();await page.keyboard.down('y');await sounding(page);await page.keyboard.up('y');await page.locator('#spuVoicePanel [data-noise=source]').selectOption('sample');await page.locator('[data-spu-editor-tab=fx]').click();await page.locator('#spuVoicePanel [data-pmon=enabled]').check();
  await until(async()=>Boolean((await observation(page)).channels[1].pmonSettings.enabled),'selected PMON');await page.locator('h1').click();await page.keyboard.down('y');await sounding(page);await page.keyboard.up('y');
  tick=await page.evaluate(()=>__spuParameters.memo.ticks);await running(page,tick);assert.deepEqual(await page.evaluate(()=>__spuCodeAudit.nodeNames()),nodes,'Code rerun reuses rack?');
  step('Keyboard transport and editor fit 390px; final Stop keeps edited settings and releases every owner');
  await fs.mkdir(config.screenshots,{recursive:true});for(const width of[1240,390]){await page.setViewportSize({width,height:1050});await wait(80);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'layout '+width);await page.screenshot({path:path.join(config.screenshots,`${name}-${width}.png`),fullPage:true});}
  await stop(page);const author=await rpc(page,'getInstrument',[0]);assert.equal(author.preset.adsr2&31,9);assert.equal(author.pmon.enabled,true);assert.equal(author.morph.amount,.4);const graph=await page.evaluate(()=>__spuCodeAudit.graph());assert(graph.muted&&graph.contexts===1&&graph.editorWorklets===1&&graph.destinationConnections===1);measurements.graph=graph;measurements.author=author;
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,errors,consoleErrors};
 }catch(error){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,phase,checks,measurements,errors,consoleErrors,error:error.stack,status:await page.locator('#audioStatus').textContent().catch(()=>null),live:await observation(page).catch(()=>null)};throw error;}finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);
  res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  let failure;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);assert(blockedMonaco.length,'Monaco fallback exercised');
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}: {})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
