// SPDX-License-Identifier: BSD-3-Clause
// A self-authored held Saw lesson, measured only upstream of a physical gain0.
// No ordinary browser, device output, game assets or external service is used.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');

const config={root:path.resolve(__dirname,'../docs'),engines:'chromium,webkit',
  'entry-en':'/introductions/tetorica-sid-filter.html','entry-ja':'/introductions/tetorica-sid-filter_ja.html',
  out:'/private/tmp/sid-filter-introduction-browser.json',screenshots:'/private/tmp/sid-filter-introduction-screens'};
for(const argument of process.argv.slice(2)){
  const match=/^--(root|engines|entry-en|entry-ja|out|screenshots)=(.+)$/.exec(argument);
  assert(match,'Unknown argument '+argument);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);
const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const hash=value=>createHash('sha256').update(value).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await delay(25);}throw Error('Timeout: '+label);}
const served=new Map(),missing=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};

function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,
    connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const contexts=[],nodes=[],sinks=[],commands=[],lifecycle=[],disposed=new WeakSet();let nextId=0;
  const record=(context,event)=>lifecycle.push({context:contexts.indexOf(context)+1,event,state:context.state,at:performance.now()});
  window.AudioContext=class extends Context{
    constructor(...args){super(...args);contexts.push(this);record(this,'created');this.addEventListener('statechange',()=>record(this,'statechange'));}
    resume(...args){record(this,'resume-called');const pending=super.resume(...args);pending.then(()=>record(this,'resume-resolved'),()=>record(this,'resume-rejected'));return pending;}
    close(...args){record(this,'close-called');const pending=super.close(...args);pending.then(()=>record(this,'close-resolved'),()=>record(this,'close-rejected'));return pending;}
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();
    analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);
    sinks.push({context:this.context,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(message,...args){
    for(const command of Array.isArray(message)?message:[message]){
      if(command?.method)commands.push({method:command.method,args:command.args});
      if(command?.method==='dispose'){
        const found=nodes.find(item=>item.node.port===this);if(found)disposed.add(found.node);
      }
    }
    return post.call(this,message,...args);
  };
  const graph=()=>({contexts:contexts.length,activeContexts:contexts.filter(value=>value.state!=='closed').length,
    sidWorklets:nodes.filter(value=>value.name==='tetorica-sid').length,
    activeSidWorklets:nodes.filter(value=>value.name==='tetorica-sid'&&!disposed.has(value.node)&&value.node.context.state!=='closed').length,
    destinations:sinks.length,contextStates:contexts.map(value=>value.state),muted:sinks.every(value=>value.mute.gain.value===0)});
  async function read(){
    const node=nodes.findLast(value=>value.name==='tetorica-sid'&&!disposed.has(value.node)&&value.node.context.state!=='closed')?.node;
    if(!node)throw Error('No active lesson SID');const id=--nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SID observation timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'getState',args:[]});
    });
  }
  function sample(){
    let peak=0,square=0,count=0,finite=true;
    for(const {context,analyser}of sinks){if(context.state!=='running')continue;const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);for(const value of values){finite&&=Number.isFinite(value);peak=Math.max(peak,Math.abs(value));square+=value*value;count++;}}
    return{finite,peak,rms:count?Math.sqrt(square/count):0,muted:graph().muted};
  }
  window.__sidFilterAudit={graph,read,sample,commands:()=>commands.slice(),lifecycle:()=>lifecycle.slice()};
}

async function checkPage(browser,name,language,origin){
  const page=await browser.newPage({viewport:{width:1180,height:1000},serviceWorkers:'block'});
  const errors=[],consoleErrors=[],external=[],failed=[],requests=[],checks=[],measurements={};
  let phase='startup',holdNextWasm=false,releaseWasm,holdNextJs=false,releaseJs;
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)failed.push({url:response.url(),status:response.status()});});
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}
    if(holdNextJs&&/\/js\/playground_sid_audio\.js$/.test(url.pathname)){
      holdNextJs=false;await new Promise(resolve=>{releaseJs=resolve;});return route.continue().catch(()=>{});
    }
    if(holdNextWasm&&/\/generated\/sid\/sid\.wasm$/.test(url.pathname)){
      holdNextWasm=false;await new Promise(resolve=>{releaseWasm=resolve;});return route.continue().catch(()=>{});
    }
    return route.continue();
  });
  await page.addInitScript(installSilentAudit);
  const step=label=>{phase=label;checks.push(label);console.log(`CHECK ${name}/${language}: ${label}`);};
  const lab=page.locator('#sid-filter-lab'),field=name=>page.locator(`#sid-filter-controls [name=${JSON.stringify(name)}]`),
    start=page.locator('#sid-filter-start'),stop=page.locator('#sid-filter-stop');
  const graph=()=>page.evaluate(()=>__sidFilterAudit.graph()),read=()=>page.evaluate(()=>__sidFilterAudit.read());
  const state=async predicate=>{let result;await until(async()=>{result=await read();return predicate(result);},'SID state');return result;};
  const sounding=()=>page.waitForFunction(()=>{const value=__sidFilterAudit.sample();return value.finite&&value.muted&&value.rms>1e-6;});
  const commandIndex=()=>page.evaluate(()=>__sidFilterAudit.commands().length);
  const commandSlice=index=>page.evaluate(index=>__sidFilterAudit.commands().slice(index),index);
  const voiceWrites=commands=>commands.filter(command=>command.method==='writeRegister'&&command.args?.[0]<21);
  const filterHeld=(before,after)=>{
    assert.deepEqual(after.registers.slice(0,21),before.registers.slice(0,21),'Changing the shared filter leaves every voice register untouched');
    assert.deepEqual(after.channels.map(value=>value.gate),before.channels.map(value=>value.gate));
    assert(after.cycles>=before.cycles,'The existing SID clock is never reset');
  };
  async function codeMatches(){
    const visible=(await page.locator('#sid-filter-code').textContent()).trim(),source=(await page.locator('#sid-filter-example').textContent()).trim();
    assert.equal(visible,source);assert.match(visible,/useSoundChip\(["']sid["']\)/);assert.match(visible,/setFilter\(/);
    const settings=await page.locator('#sid-filter-controls').evaluate(form=>({mode:form.elements.mode.value,
      cutoff:Number(form.elements.cutoff.value),resonance:Number(form.elements.resonance.value),
      routing:[1,2,3].reduce((mask,index)=>mask|(form.elements['route'+index].checked?1<<(index-1):0),0)}));
    assert.match(visible,new RegExp(`mode:\\s*['"]${settings.mode==='bypass'?'off':settings.mode}['"]`));
    for(const [key,value]of [['cutoff',settings.cutoff],['resonance',settings.resonance],['routing',settings.mode==='bypass'?0:settings.routing]])
      assert.match(visible,new RegExp(`\\b${key}:\\s*${value}\\b`),'Readable source matches '+key);
    const link=page.locator('a[data-playground-src="sid-filter-example"]');assert.equal(await link.count(),1);
    const url=new URL(await link.getAttribute('href'),page.url());assert.equal(url.origin,origin);assert(url.pathname.endsWith('/playground/index.html'));
    assert.equal(Buffer.from(url.searchParams.get('src'),'base64').toString('utf8'),source,'Playground receives the current readable source');
    return visible;
  }
  try{
    await page.goto(origin+config['entry-'+language]);await lab.waitFor();await until(()=>start.isEnabled(),'lesson mounted');
    step('Readable localized lesson and passive controls create no audio or WASM request');
    assert.equal(await page.locator('html').getAttribute('lang'),language);assert((await page.locator('h1').textContent()).trim());
    assert.equal((await graph()).contexts,0);assert.equal((await graph()).sidWorklets,0);assert(!requests.some(url=>url.endsWith('.wasm')));
    assert.equal(await page.locator('#sid-filter-status').getAttribute('role'),'status');
    for(const name of ['mode','cutoff','resonance','route1','route2','route3','chord'])assert(await field(name).evaluate(input=>input.labels?.length>0),'Accessible label: '+name);
    const defaults=await page.locator('#sid-filter-controls').evaluate(form=>Object.fromEntries([...form.elements].filter(input=>input.name).map(input=>[input.name,input.type==='checkbox'?input.checked:input.value])));
    assert.equal(defaults.cutoff,'500');assert.equal(defaults.resonance,'5');assert.equal(defaults.chord,false);
    await field('mode').selectOption('lowpass');await field('cutoff').focus();await field('cutoff').press('End');await codeMatches();
    assert.equal((await graph()).contexts,0);assert(!requests.some(url=>url.endsWith('.wasm')));
    await page.locator('#sid-filter-reset').click();assert.deepEqual(await page.locator('#sid-filter-controls').evaluate(form=>Object.fromEntries([...form.elements].filter(input=>input.name).map(input=>[input.name,input.type==='checkbox'?input.checked:input.value]))),defaults);
    step('Stop settles while a dynamically imported audio adapter is still pending');
    holdNextJs=true;await start.click();await until(()=>Boolean(releaseJs),'held SID audio adapter import');assert(await stop.isEnabled());const moduleStopAt=Date.now();await stop.click();
    await until(async()=>(await graph()).activeContexts===0&&await lab.getAttribute('data-phase')==='idle','Stop closes context without waiting for the JS fetch',2500);measurements.delayedModuleStopMs=Date.now()-moduleStopAt;
    assert(await start.isEnabled());assert.equal((await graph()).activeSidWorklets,0);releaseJs();releaseJs=null;await delay(150);
    assert.equal((await graph()).activeContexts,0);assert.equal((await graph()).activeSidWorklets,0);assert.equal(voiceWrites(await commandSlice(0)).length,0,'Late imported code cannot start its retired run');
    assert.equal(await page.locator('#sid-filter-status').getAttribute('data-error'),'false');
    step('Stop cancels an initialization waiting for WASM without a late key-on');
    holdNextWasm=true;await start.click();await until(()=>Boolean(releaseWasm),'held initial SID WASM request');assert(await stop.isEnabled());await stop.click();
    await until(async()=>(await graph()).activeContexts===0,'cancelled initialization context closed');releaseWasm();releaseWasm=null;await until(()=>start.isEnabled(),'Start restored after cancellation');await delay(100);
    assert.equal((await graph()).activeSidWorklets,0);assert.equal(voiceWrites(await commandSlice(0)).length,0,'Cancelled initialization never starts a voice');
    measurements.startupCancellation={delayedModule:true,delayedWasm:true};
    step('Explicit keyboard Start creates one SID and holds the original Saw voice');
    const beforeStart=await graph();await start.focus();await start.press('Enter');await until(async()=>(await graph()).activeSidWorklets===1,'one active SID endpoint');
    let current=await state(value=>value.channels[0].gate&&value.channels[0].waveform==='saw'&&value.channels[0].envelope>0);await sounding();
    const started=await graph();assert.equal(started.sidWorklets,beforeStart.sidWorklets+1);assert.equal(started.activeContexts,1);assert.equal(started.activeSidWorklets,1);assert(started.muted);measurements.started=started;
    step('LP/BP/HP, keyboard Cutoff and Resonance edit only shared filter registers');
    const held=current,filterStart=await commandIndex();
    for(const mode of ['lowpass','bandpass','highpass']){
      await field('mode').selectOption(mode);current=await state(value=>value.filter.mode===mode);filterHeld(held,current);await codeMatches();
    }
    await field('cutoff').focus();await field('cutoff').press('Home');await state(value=>value.filter.cutoff===0);await field('cutoff').press('ArrowRight');current=await state(value=>value.filter.cutoff>0);filterHeld(held,current);
    await field('resonance').focus();await field('resonance').press('End');current=await state(value=>value.filter.resonance===15);filterHeld(held,current);await sounding();
    assert.equal(voiceWrites(await commandSlice(filterStart)).length,0,'Filter edits send no oscillator, ADSR or Gate writes');
    step('All three routing controls use one filter while the same Saw stays held');
    await field('route1').uncheck();current=await state(value=>value.filter.routing===6);filterHeld(held,current);
    await field('route2').uncheck();await state(value=>value.filter.routing===4);await field('route3').uncheck();current=await state(value=>value.filter.routing===0);filterHeld(held,current);
    assert((await page.locator('#sid-filter-routing-status').textContent()).trim());await field('route1').check();current=await state(value=>value.filter.routing===1);filterHeld(held,current);await codeMatches();
    step('The optional chord adds and releases CH2/CH3 without retriggering CH1');
    const chordStart=await commandIndex();await field('chord').check();current=await state(value=>value.channels.every(channel=>channel.gate));assert.deepEqual(current.registers.slice(0,7),held.registers.slice(0,7));
    assert(!voiceWrites(await commandSlice(chordStart)).some(command=>command.args[0]<7));
    await field('route2').check();await field('route3').check();current=await state(value=>value.filter.routing===7);
    // A near-zero LP cutoff can correctly make a held Saw nearly silent.
    // Use an audible passband before asking the real-PCM liveness question.
    await field('cutoff').evaluate(input=>{input.value='700';input.dispatchEvent(new Event('input',{bubbles:true}));});await state(value=>value.filter.cutoff===700);
    const chordHeld=current,chordFilterStart=await commandIndex();await field('mode').selectOption('lowpass');current=await state(value=>value.filter.mode==='lowpass');filterHeld(chordHeld,current);await sounding();
    assert.equal(voiceWrites(await commandSlice(chordFilterStart)).length,0);await codeMatches();
    await field('chord').uncheck();current=await state(value=>value.channels[0].gate&&!value.channels[1].gate&&!value.channels[2].gate);assert.deepEqual(current.registers.slice(0,7),held.registers.slice(0,7));
    const afterChord=current;await field('mode').selectOption('bypass');current=await state(value=>value.filter.routing===0);filterHeld(afterChord,current);await sounding();
    assert(current.cycles>held.cycles,'The held SID continues rendering throughout the filter comparison');
    measurements.cycles={before:held.cycles,after:current.cycles};measurements.livePcm=await page.evaluate(()=>__sidFilterAudit.sample());
    step('Desktop/mobile layout, current Playground source and internal navigation remain usable');
    for(const width of [1180,390]){
      await page.setViewportSize({width,height:1000});await lab.scrollIntoViewIfNeeded();assert(await start.isVisible());assert(await stop.isVisible());assert(await field('cutoff').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow at '+width);await codeMatches();
      await page.screenshot({path:path.join(config.screenshots,`${name}-${language}-${width}.png`),fullPage:true});
    }
    const links=await page.locator('a[href]').evaluateAll(nodes=>nodes.map(node=>node.href));
    assert(links.some(href=>new URL(href).pathname.endsWith('/synth-sid/index.html')));assert(links.some(href=>new URL(href).pathname.endsWith('/introductions/index'+(language==='ja'?'-ja':'')+'.html')));
    for(const href of new Set(links)){const url=new URL(href);if(url.origin!==origin)continue;const response=await page.request.get(origin+url.pathname);assert.equal(response.status(),200,'Local link '+url.pathname);}
    step('Keyboard Stop retires the endpoint; Reset is passive and pagehide retires a restarted run');
    await stop.focus();await stop.press('Space');await until(async()=>(await graph()).activeContexts===0&&(await graph()).activeSidWorklets===0,'Stop disposes audio');
    assert.equal(await page.locator('#sid-filter-status').getAttribute('data-error'),'false');
    assert.equal((await page.evaluate(()=>__sidFilterAudit.sample())).peak,0);await page.locator('#sid-filter-reset').click();assert.deepEqual(await page.locator('#sid-filter-controls').evaluate(form=>Object.fromEntries([...form.elements].filter(input=>input.name).map(input=>[input.name,input.type==='checkbox'?input.checked:input.value]))),defaults);assert.equal((await graph()).activeContexts,0);await codeMatches();
    await start.click();await until(async()=>(await graph()).activeSidWorklets===1,'restarted SID');await sounding();await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await until(async()=>(await graph()).activeContexts===0&&(await graph()).activeSidWorklets===0,'pagehide disposes audio');
    measurements.finalGraph=await graph();measurements.contextLifecycle=await page.evaluate(()=>__sidFilterAudit.lifecycle());assert(measurements.finalGraph.muted);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(failed,[]);assert.deepEqual(external,[]);
    return{browser:name,language,passed:true,checks,measurements,physicalOutputMuted:true,listeningPerformed:false,errors,consoleErrors,failed,external};
  }catch(error){
    await page.screenshot({path:path.join(config.screenshots,`${name}-${language}-failure.png`),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,language,passed:false,phase,error:error.stack,checks,measurements,errors,consoleErrors,failed,external,
      diagnostic:await page.evaluate(()=>({graph:__sidFilterAudit.graph(),contextLifecycle:__sidFilterAudit.lifecycle(),status:document.getElementById('sid-filter-status')?.textContent,commands:__sidFilterAudit.commands().slice(-35)})).catch(()=>null)};throw error;
  }finally{releaseWasm?.();releaseJs?.();await page.close();}
}

const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const filename=path.resolve(config.root,'.'+pathname);assert(filename.startsWith(config.root+path.sep));
    const bytes=await fs.readFile(filename),relative=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
    if(served.has(relative))assert.deepEqual(served.get(relative),metadata,'Served source changed during check');served.set(relative,metadata);
    response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch(error){missing.push({url:request.url,message:error.message});response.writeHead(404).end(error.message);}
});
(async()=>{
  let failure;await fs.mkdir(config.screenshots,{recursive:true});
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{for(const language of ['en','ja'])results.push(await checkPage(browser,name,language,origin));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const report={passed:!failure,root:config.root,physicalOutputMuted:true,listeningPerformed:false,results,missing,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');if(failure)throw failure;console.log('PASS '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
