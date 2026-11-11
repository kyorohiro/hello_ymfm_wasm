// SID Code Live -> the same authoring controls, with no physical audio output.
// Every AudioNode destination is intercepted before app code and muted at 0.
// node scripts/check_sid_synth_code_live_browser.cjs --root=docs --entry=/synth-sid/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os'),{chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'../docs'),entry:'/synth-sid/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'sid-synth-code-live-browser.json'),screenshots:path.join(tmpdir(),'sid-synth-code-live-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assets=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(30);}throw Error('Timeout: '+label);}

function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,
    connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,nativeSetTimeout=window.setTimeout.bind(window);
  const contexts=[],nodes=[],gates=[],commands=[],observations=new WeakMap();let sequence=0,delayNext=0,held=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const mute=this.context.createGain();mute.gain.value=0;gates.push(mute);
    connect.call(this,mute,...args);connect.call(mute,destination);return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){
    if(data?.method){commands.push({method:data.method,args:data.args});if(commands.length>20000)commands.shift();}
    if(data?.method==='observeCode'){
      let pending=observations.get(this);if(!pending)observations.set(this,pending=new Map());
      pending.set(data.id,delayNext);delayNext=0;
    }
    return post.call(this,data,...args);
  };
  // Delay one *applied response*, rather than its request, to exercise a truly
  // stale snapshot after Stop. This wraps only the app's public port callback.
  let owner=MessagePort.prototype,descriptor;
  while(owner&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(owner,'onmessage');if(!descriptor)owner=Object.getPrototypeOf(owner);}
  if(!descriptor?.set)throw Error('MessagePort onmessage descriptor unavailable');
  Object.defineProperty(MessagePort.prototype,'onmessage',{configurable:true,get(){return descriptor.get.call(this);},set(fn){
    if(typeof fn!=='function'){descriptor.set.call(this,fn);return;}
    const port=this;descriptor.set.call(this,event=>{
      const pending=observations.get(port),delay=pending?.get(event.data?.id);pending?.delete(event.data?.id);
      if(delay){held++;nativeSetTimeout(()=>{held--;fn.call(port,event);},delay);}else fn.call(port,event);
    });
  }});
  async function read(){
    const node=nodes.findLast(item=>item.name==='tetorica-sid-synth')?.node;if(!node)throw Error('SID Worklet missing');
    const id=--sequence;
    return new Promise((resolve,reject)=>{
      const timer=nativeSetTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SID audit read timeout'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'read',args:[]});
    });
  }
  window.__sidCodeLiveAudit={read,armDelay(ms=400){delayNext=ms;},held:()=>held,
    commands:()=>commands.slice(),drain:()=>commands.splice(0),
    graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(item=>item.name==='tetorica-sid-synth').length,
      physicalOutputMuted:gates.every(gate=>gate.gain.value===0),destinationConnections:gates.length})};
}
async function source(page,text){await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function execute(page,apply=false){await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();await until(async()=>{
  const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());
},apply?'Apply completes':'Code starts');}
async function savedSetup(page){
  await page.locator('#presetTools').evaluate(node=>{node.open=true;});
  const[item]=await Promise.all([page.waitForEvent('download'),page.locator('#saveChannelSettings').click()]),chunks=[];
  for await(const chunk of await item.createReadStream())chunks.push(chunk);return JSON.parse(Buffer.concat(chunks));
}
async function observed(page,voice,values={}){
  await until(()=>page.locator('#voiceEditor').getAttribute('data-observation-voice').then(value=>value===String(voice)),'observing CH '+(voice+1));
  assert.equal(await page.locator('#voiceEditor').getAttribute('data-observing'),'true');
  assert.equal(await page.locator('#sidLiveView').getAttribute('data-live-kind'),'code');
  for(const[id,value]of Object.entries(values))await until(()=>page.locator('#'+id).getAttribute('data-value').then(actual=>actual===String(value)),id+'='+value);
}
async function editable(page){await until(()=>page.locator('#voiceEditor').getAttribute('data-observing').then(value=>value==='false'),'authored editor restored');assert(await page.locator('#attack').isEnabled());}
const observeCount=async page=>(await page.evaluate(()=>__sidCodeLiveAudit.commands())).filter(item=>item.method==='observeCode').length;
const CODE=`const sid=await useSoundChip('sid');
await sid.setVoice(CH1,{waveform:'pulse',pulseWidth:513,attack:3,decay:4,sustain:5,release:6,sync:false,ring:false,test:false});
await sid.setVoice(CH2,{waveform:'triangle+saw',pulseWidth:1234,attack:7,decay:8,sustain:9,release:10,sync:true,ring:true,test:false});
await sid.setVoice(CH3,{waveform:'off',pulseWidth:3456,attack:11,decay:12,sustain:13,release:14,sync:false,ring:false,test:true});
await sid.setFrequency(CH2,660);await sid.setFrequency(CH3,110);
await sid.setFilter({mode:'notch',cutoff:888,resonance:9,routing:5,volume:7,voice3off:true});
await sid.noteOn(CH1,'A4');globalThis.__sidCodeLiveHandle=sid;
log('code-live-ready');
`;
async function check(browser,name,origin){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'});
  const errors=[],consoleErrors=[],expectedConsole=[],checks=[],models=[];let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()!=='error')return;const value=message.text(),url=message.location().url;
    if(/cdnjs\.cloudflare\.com/.test(value+' '+url)||/^Failed to load resource/.test(value)&&blockedMonaco.length)expectedConsole.push(value);else consoleErrors.push(value);});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());
    if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);
  const step=label=>{stage=label;checks.push(label);console.log('CHECK '+name+': '+label);};
  try{
    await page.goto(origin+config.entry);assert.equal((await page.evaluate(()=>__sidCodeLiveAudit.graph())).contexts,0);
    // Code Live is separate from the user's original song-follow choice.
    if(await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').uncheck();
    const savedSongFollow=false;
    for(const model of ['6581','8580']){
      if(model==='8580'){
        await page.locator('[data-choice-for="sidModel"][data-value="8580"]').click();
        await until(()=>page.locator('#sidModelBadge').textContent().then(value=>value==='8580'),'8580 authored model');
        await until(()=>page.evaluate(async()=>(await __sidCodeLiveAudit.read()).model==='8580'),'8580 applied Worklet model');
      }
      const baseline=await savedSetup(page);assert.equal(baseline.channels[0].model,model);
      await page.locator('#modulationCard').evaluate(node=>{node.open=true;});
      await page.locator('#voiceCard').evaluate(node=>{node.open=true;});
      await page.evaluate(()=>{window.__sidCodeLiveNodes=[...document.getElementById('voiceEditor').querySelectorAll('*')];});
      step(model+': Code register mutations are shown in the same read-only controls without applying a preset');
      await source(page,CODE);await execute(page);
      assert(await page.locator('#sidLiveEnabled').isChecked(),'Code Live defaults to On independently of song-follow');
      assert.match(await page.locator('#sidLiveEnabledLabel').textContent(),/Live.*Code/i);
      await observed(page,0,{pulseWidth:513,attack:3,decay:4,sustain:5,release:6,filterCutoff:888,filterResonance:9,chipVolume:7});
      assert(await page.locator('#attack').isDisabled());assert(await page.locator('#filterCutoffRange').isDisabled());
      assert.equal(await page.locator('[data-choice-for="waveform"][data-value="pulse"]').getAttribute('aria-pressed'),'true');
      assert(await page.locator('[data-sid-live-voice="round-robin"]').isHidden());
      assert.deepEqual(await savedSetup(page),baseline,'observations never replace any authored CH or target');
      const before=await page.evaluate(()=>__sidCodeLiveAudit.read());
      await page.locator('[data-sid-live-voice="1"]').click();await observed(page,1,{pulseWidth:1234,attack:7,sustain:9});
      assert.equal(await page.locator('#voiceEditor').getAttribute('data-observation-waveform-mask'),'48');
      assert.equal(await page.locator('#syncEnabled').isChecked(),true);assert.equal(await page.locator('#ringEnabled').isChecked(),true);
      await page.locator('[data-sid-live-voice="2"]').click();await observed(page,2,{pulseWidth:3456,attack:11,release:14});
      assert.equal(await page.locator('#voiceEditor').getAttribute('data-observation-waveform-mask'),'0');assert(await page.locator('#oscillatorTest').isChecked());
      const after=await page.evaluate(()=>__sidCodeLiveAudit.read());assert.deepEqual(after.registers,before.registers,'CH selection does not write the chip');
      assert.deepEqual(await savedSetup(page),baseline);assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
      if(model==='8580')assert.match(await page.locator('[data-live-field="envelope"]').textContent(),/Unavailable/i);
      await page.locator('[data-sid-live-voice="0"]').click();await observed(page,0);
      await page.evaluate(()=>{window.__sidPulseHighlighted=false;const target=document.getElementById('pulseWidth');
        window.__sidPulseHighlightObserver?.disconnect();window.__sidPulseHighlightObserver=new MutationObserver(()=>{if(target.dataset.changed==='true')__sidPulseHighlighted=true;});
        __sidPulseHighlightObserver.observe(target,{attributes:true,attributeFilter:['data-changed']});});
      await page.evaluate(async()=>__sidCodeLiveHandle.setVoice(0,{pulseWidth:1977,attack:6}));
      await observed(page,0,{pulseWidth:1977,attack:6});
      assert(await page.evaluate(()=>__sidPulseHighlighted),'changed values are highlighted in place');
      assert(await page.evaluate(()=>__sidCodeLiveNodes.every((node,index)=>document.getElementById('voiceEditor').querySelectorAll('*')[index]===node)),'editor nodes are never rebuilt');
      assert(await page.locator('#modulationCard').evaluate(node=>node.open),'polling preserves opened sections');

      step(model+': Live Off stops polling and restores the authored editor while Code continues; On reads the latest hardware');
      await page.locator('#sidLiveEnabled').uncheck();await editable(page);await wait(100);const offCount=await observeCount(page);await wait(220);
      assert.equal(await observeCount(page),offCount,'Live Off sends no further observation requests');
      assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
      await page.evaluate(async()=>__sidCodeLiveHandle.setVoice(0,{pulseWidth:2345}));
      assert.equal(await page.locator('#pulseWidth').getAttribute('data-value'),String(baseline.channels[0].voice.pulseWidth));
      await page.locator('[data-sid-live-voice="1"]').click();assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
      assert.deepEqual(await savedSetup(page),baseline);
      await page.locator('[data-sid-live-voice="0"]').click();await page.locator('#sidLiveEnabled').check();await observed(page,0,{pulseWidth:2345});
      const countBefore=await observeCount(page);await wait(250);const polls=await observeCount(page)-countBefore;assert(polls>0&&polls<=8,'bounded display polling, not one read per audio block');
      step(model+': delayed prior observation cannot revive after Stop and the exact authored settings return');
      await page.evaluate(()=>__sidCodeLiveAudit.armDelay());await until(()=>page.evaluate(()=>__sidCodeLiveAudit.held()>0),'one applied observation response held');
      await page.locator('#synthCodeStopButton').click();await editable(page);await wait(550);assert.equal(await page.locator('#voiceEditor').getAttribute('data-observing'),'false');
      assert.equal(await page.locator('#sidLiveEnabled').isChecked(),savedSongFollow,'Code choices do not change song-follow');
      assert(await page.locator('[data-sid-live-voice="round-robin"]').isVisible());
      assert.deepEqual(await savedSetup(page),baseline);assert.equal(await page.locator('#pulseWidth').getAttribute('data-value'),String(baseline.channels[0].voice.pulseWidth));
      const stopped=await page.evaluate(()=>__sidCodeLiveAudit.read());assert([0,1,2].every(channel=>!(stopped.registers[channel*7+4]&1)));
      models.push({model,pollingSamplesIn250ms:polls,authoredSetupPreserved:true,staleResponseRetired:true});
    }
    step('Apply and returning to Keyboard preserve live state ownership and stop observing');
    await source(page,CODE);await execute(page);await observed(page,0,{pulseWidth:513});
    await page.locator('#synthCodeEditor').fill(CODE.replace('pulseWidth:513','pulseWidth:999'));await execute(page,true);await observed(page,0,{pulseWidth:999});
    await page.locator('#synthInputKeyboardTab').click();await editable(page);await wait(100);const stoppedCount=await observeCount(page);await wait(160);assert.equal(await observeCount(page),stoppedCount);
    assert(await page.locator('[data-sid-live-voice="round-robin"]').isVisible());
    await fs.mkdir(config.screenshots,{recursive:true});
    await source(page,CODE);await execute(page);await observed(page,0,{pulseWidth:513});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await wait(80);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'layout fits '+width);await page.screenshot({path:path.join(config.screenshots,name+'-code-live-'+width+'.png'),fullPage:true});}
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await editable(page);await wait(150);assert.equal(await page.locator('#voiceEditor').getAttribute('data-observing'),'false');
    const graph=await page.evaluate(()=>__sidCodeLiveAudit.graph());assert(graph.physicalOutputMuted);assert.equal(graph.contexts,1,'the observation layer creates no second audio context');
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,models,graph,errors,consoleErrors,expectedFallbackConsole:expectedConsole};
  }catch(error){
    let diagnostic;try{diagnostic=await page.evaluate(async()=>({state:await __sidCodeLiveAudit.read(),graph:__sidCodeLiveAudit.graph(),commands:__sidCodeLiveAudit.commands().slice(-30),
      heading:document.getElementById('voiceHeading').textContent,label:document.getElementById('sidLiveEnabledLabel')?.textContent,view:{...document.getElementById('sidLiveView').dataset},editor:{...document.getElementById('voiceEditor').dataset},
      code:document.getElementById('synthCodeState').textContent,error:document.getElementById('synthCodeError').textContent}));}catch{}
    error.receipt={browser:name,passed:false,stage,error:error.stack,checks,models,diagnostic,errors,consoleErrors};throw error;
  }finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),record={bytes:bytes.length,sha256:hash(bytes)};
  if(assets.has(key))assert.deepEqual(assets.get(key),record,'Asset changed during check');assets.set(key,record);
  res.setHeader('Content-Type',filename.endsWith('.wasm')?'application/wasm':filename.endsWith('.css')?'text/css':filename.endsWith('.html')?'text/html':filename.endsWith('.webp')?'image/webp':'text/javascript');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  let failure;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);assert(blockedMonaco.length);
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...assets].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}: {})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
