// Silent real-WASM SPU working/saved regression. No speaker output.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const root=path.resolve(process.env.SPU_TEST_ROOT||path.resolve(__dirname,'../docs')),entry=process.env.SPU_TEST_ENTRY||'/synth-spu/index.html',engines=(process.env.SPU_TEST_ENGINES||'chromium,webkit').split(',');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await pause(30);}throw Error('Timeout: '+label);}
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
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/favicon.ico'){res.writeHead(204).end();return;}const file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));const data=await fs.readFile(file);res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data);}catch(e){res.writeHead(404).end(e.message);}});
const SONG=`const ps1=await useSoundChip('ps1');context.identity??={};globalThis.__workingMemo??=context.identity;globalThis.__workingVoice=ps1;
liveLoop('clock',async()=>{context.identity.ticks=(context.identity.ticks||0)+1;await beat(.1);});
await ps1.noteOn(CH1,'C4');`;
async function check(browser,name,origin){
 const page=await browser.newPage({viewport:{width:1240,height:1000}}),errors=[];
 await page.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='cdnjs.cloudflare.com'?route.abort():route.continue();});
 await page.addInitScript(installSilentAudit);page.on('pageerror',e=>errors.push(e.message));
 const rpc=(method,args=[])=>page.evaluate(({method,args})=>__spuCodeAudit.rpc(method,args),{method,args});
 const state=()=>rpc('getInstrument',[0]);
 const edit=async(value)=>{const control=page.locator('[data-chip-control=ps1-release-rate]');await control.fill(String(value));await control.press('Tab');};
 try{
  await page.goto(origin+entry);await page.locator('#spuFilesToggle').click();
  await page.locator('#spuAutoApplyToggle').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>__spuCodeAudit.graph().contexts),0);
  await page.locator('#startAudio').click();await until(()=>page.evaluate(()=>__spuCodeAudit.graph().editorWorklets===1),'worklet');await until(()=>state().then(s=>Boolean(s.sample)),'audio');
  const before=await state(),original=before.preset.adsr2&31;
  await page.locator('#spuAutoApplyToggle').uncheck();await page.locator('[data-spu-editor-tab=adsr]').click();await edit(9);
  await until(()=>page.locator('#spuFilesTree [data-unsaved=true]').count().then(n=>n>0),'unsaved dot');
  assert.equal((await state()).preset.adsr2&31,original,'manual draft must not reach renderer');
  await page.locator('#spuFileSaveButton').click();await until(()=>state().then(s=>(s.preset.adsr2&31)===9),'saved envelope');
  await edit(14);assert.equal((await state()).preset.adsr2&31,9);await page.locator('#spuFileDiscardButton').click();await until(()=>page.locator('[data-chip-control=ps1-release-rate]').inputValue().then(v=>v==='9'),'discard paints saved');
  await page.locator('#synthInputCodeTab').click();await page.locator('#spuFilesTree [data-file-path="/index.js"]').click();
  await page.locator('#synthCodeEditor').fill(SONG);
  await page.locator('#spuFileSaveButton').click();assert.equal(await page.evaluate(()=>typeof __workingVoice),'undefined','Save never runs');
  await page.locator('#synthCodeRunButton').click();await until(()=>page.evaluate(()=>Boolean(globalThis.__workingMemo?.ticks)),'Code starts');
  await page.locator('#spuLiveEnabled').uncheck();
  await page.locator('[data-spu-editor-tab=adsr]').click();const liveBefore=await rpc('observeCode');await edit(17);
  assert.equal((await state()).preset.adsr2&31,9);await page.locator('#spuFileSaveButton').click();await until(()=>state().then(s=>(s.preset.adsr2&31)===17),'Code author Save');
  const liveAfter=await rpc('observeCode');assert.equal(liveAfter.channels[0].pitch,liveBefore.channels[0].pitch);assert.equal(liveAfter.channels[0].gate,true);
  const ticks=await page.evaluate(()=>__workingMemo.ticks);await until(()=>page.evaluate(t=>__workingMemo.ticks>t,ticks),'same loop continues');
  assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
  // Both file layers survive a real IndexedDB save and reload; no automatic Run.
  await edit(22);await pause(350);await page.reload();await page.locator('#spuAutoApplyToggle').waitFor({state:'attached'});
  await until(()=>page.locator('#spuAutoApplyToggle').isEnabled(),'project restored');
  assert.equal(await page.locator('#spuAutoApplyToggle').isChecked(),false);assert.equal(await page.evaluate(()=>__spuCodeAudit.graph().contexts),0);
  await page.locator('#startAudio').click();await until(()=>page.evaluate(()=>__spuCodeAudit.graph().editorWorklets===1),'restored worklet');await until(()=>state().then(s=>(s.preset.adsr2&31)===17),'reload accepted sound');
  await page.locator('[data-spu-editor-tab=adsr]').click();assert.equal(await page.locator('[data-chip-control=ps1-release-rate]').inputValue(),'22');
  assert(await page.locator('#spuFilesTree [data-unsaved=true]').count());
  await page.locator('#spuAutoApplyToggle').check();await until(()=>state().then(s=>(s.preset.adsr2&31)===22),'auto on accepts');
  // A portable full sample uses the same draft boundary, retaining the
  // source bytes/tuning/loop until explicit Save.
  const portable=await page.evaluate(async()=>{
    const {writeSpuInstrument}=await import('/synth-spu/spu_synth_instrument.js');
    const doc=writeSpuInstrument('Full sample',await __spuCodeAudit.rpc('getInstrument',[0]));
    doc.waveform=null;doc.morph.enabled=false;return doc;
  });
  await page.locator('#presetFileInput').setInputFiles({name:'Full.spu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(portable))});
  await until(()=>page.locator('#audioStatus').textContent().then(s=>s==='Loaded Full sample.'),'full sample load');
  await page.locator('#spuAutoApplyToggle').uncheck();await page.locator('[data-spu-editor-tab=pcm]').click();
  await until(()=>page.locator('.spu-sample-pcm-editor').getAttribute('data-phase').then(s=>s==='ready'),'full sample draft source');
  const originalBytes=Array.from((await state()).sample.adpcm);
  await page.locator('[data-sample-pcm=value]').fill('0.25');await page.locator('[data-sample-pcm=value]').press('Tab');
  await until(()=>page.locator('#spuFilesTree [data-unsaved=true]').count().then(n=>n>0),'PCM draft dirty');
  assert.deepEqual(Array.from((await state()).sample.adpcm),originalBytes,'drawing does not rewrite sounding ADPCM');
  await page.locator('#spuFileSaveButton').click();await until(async()=>JSON.stringify(Array.from((await state()).sample.adpcm))!==JSON.stringify(originalBytes),'PCM accepted');
  assert.equal((await state()).sample.baseFrequencyHz,portable.sample.baseFrequencyHz);
  assert.equal(await page.evaluate(()=>__spuCodeAudit.graph().muted),true);assert.deepEqual(errors,[]);
  for(const width of[1240,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'layout '+width);}
  console.log('PASS '+name+': drafts, Save/Discard, Code continuity, reload and muted output');
 }catch(e){console.error('STATUS',await page.locator('#audioStatus').textContent(),errors);await page.screenshot({path:'/private/tmp/spu-working-'+name+'-failure.png',fullPage:true});throw e;}finally{await page.close();}
}
(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{await check(browser,name,origin);}finally{await browser.close();}}
}catch(e){console.error(e);process.exitCode=1;}finally{server.closeAllConnections();server.close();}})();
