// SPDX-License-Identifier: BSD-3-Clause
// Real source/ZIP Live highlight checks; every speaker connection is muted before boot.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const {selectHucChannel}=require('./huc6280_channel_browser_helpers.cjs');
const repo=path.resolve(__dirname,'..');
const config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',editor:'fallback',
  out:path.join(tmpdir(),'huc6280-live-highlight.json'),screenshots:path.join(tmpdir(),'huc6280-live-highlight')};
for(const arg of process.argv.slice(2)){
  const match=/^--(root|entry|engines|editor|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
assert(['fallback','monaco'].includes(config.editor));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=value=>createHash('sha256').update(value).digest('hex'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(35);}throw Error('Timeout: '+label);}
const served=new Map(),missing=[],external=[],cdn=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml'};
const isMonaco=url=>url.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/');
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const filename=path.resolve(config.root,'.'+pathname);assert(filename.startsWith(config.root+path.sep));
    const data=await fs.readFile(filename),name=path.relative(config.root,filename),record={bytes:data.length,sha256:hash(data)};
    if(served.has(name))assert.deepEqual(served.get(name),record,'Asset changed during verification');served.set(name,record);
    response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(data);
  }catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
const CODE='/index.js',SONG='/vgm/highlight.vgm',DB='tetorica-huc6280-synth-files';
const TAB_IDS=['synthInputCodeTab','huc6280ChipTab','msm5205ChipTab','cddaChipTab','mixerChipTab','synthInputKeyboardTab'];
const HOLD=`const pce = await useSoundChip('huc6280');
context.starts = (context.starts ?? 0) + 1;
const prepared = await livePrepare('highlight-motion', () => ({visits: 0}));
globalThis.__hucHighlightProbe = {pce, context, prepared, ticks: 0};
await pce.noteOn(CH1, 'A3');
liveLoop('highlight-motion', async () => {
  __hucHighlightProbe.ticks++;
  prepared.visits++;
  await beat(0.05);
});
`;
function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect;
  const contexts=[],nodes=[],meters=[],commands=[],rejections=[];let serial=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});
    const post=this.port.postMessage.bind(this.port);this.port.postMessage=(data,...rest)=>{commands.push({name,method:data?.method??data?.action?.type,args:data?.method==='noteOn'?data.args:null});return post(data,...rest);};}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
  };
  window.addEventListener('unhandledrejection',event=>rejections.push(String(event.reason?.stack??event.reason)));
  function sample({analyser,mute}){
    const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0,finite=true;const crossings=[];
    for(let i=0;i<values.length;i++){sum+=values[i];square+=values[i]*values[i];peak=Math.max(peak,Math.abs(values[i]));finite&&=Number.isFinite(values[i]);if(i&&values[i-1]<=0&&values[i]>0)crossings.push(i);}
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2)),peak,finite,muted:mute.gain.value===0,
      frequency:crossings.length>2?analyser.context.sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]):0};
  }
  async function read(name='tetorica-huc6280-synth',method='read'){
    const node=nodes.findLast(item=>item.name===name)?.node;if(!node)throw Error('Worklet missing: '+name);const id=--serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Worklet read timeout'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage(name==='tetorica-huc6280-synth'?{id,method,args:[]}:{id,action:{type:'state'}});
    });
  }
  window.__hucHighlightAudit={read,output:()=>meters.map(sample).sort((a,b)=>b.acRms-a.acRms)[0]??null,
    commands:()=>commands.slice(),state:()=>({contexts:contexts.length,nodes:nodes.map(item=>item.name),
      mediaLoads:commands.filter(item=>['prepare','loadPreset'].includes(item.method)).map(item=>({name:item.name,method:item.method})),
      physicallyMuted:meters.every(item=>item.mute.gain.value===0),rejections:rejections.slice()})};
}
async function draft(page){return page.evaluate(name=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');
    tx.oncomplete=()=>{db.close();resolve(read.result??null);};tx.onabort=()=>{db.close();reject(tx.error??read.error);};};
}),DB);}
const fileText=(snapshot,version)=>{const value=snapshot?.workspace?.[version]?.files.find(file=>file.path===CODE)?.data;return typeof value==='string'?value:value?Buffer.from(value).toString('utf8'):null;};
// A test-only observer records CSS pulses without changing app scheduling.
function installTrace(){
  const events=[];let freezeNext=null;
  const key=node=>node.id||node.querySelector?.('input[id]')?.id||node.className;
  const record=(kind,node,extra={})=>events.push({kind,id:key(node),at:performance.now(),...extra});
  const previous=new WeakMap();
  new MutationObserver(records=>{for(const entry of records){const node=entry.target;if(!node.classList?.contains('huc-live-value'))continue;
    const active=node.classList.contains('is-live-changed');if(previous.get(node)!==active){previous.set(node,active);if(active)record('class',node);}
  }}).observe(document,{subtree:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('animationstart',event=>{if(event.animationName!=='synth-live-change')return;const node=event.target;
    record('start',node,{duration:getComputedStyle(node).animationDuration});
    if(freezeNext===key(node)){freezeNext=null;node.getAnimations().forEach(animation=>animation.pause());}
  },true);
  document.addEventListener('animationend',event=>{if(event.animationName==='synth-live-change')record('end',event.target,{elapsed:event.elapsedTime});},true);
  window.__hucHighlightTrace={events:()=>events.slice(),now:()=>performance.now(),freeze:id=>{freezeNext=id;},
    release(){document.querySelectorAll('.is-live-changed').forEach(node=>node.getAnimations().forEach(animation=>animation.finish()));},
    active:()=>Array.from(document.querySelectorAll('.is-live-changed')).map(key)};
}
async function check(browser,name,origin,fixture){
  const context=await browser.newContext({viewport:{width:1360,height:1050},serviceWorkers:'block'}),page=await context.newPage();
  const checks=[],measurements={layouts:[]},errors=[],rawConsoleErrors=[],consoleErrors=[],expectedConsoleErrors=[],cdnFailures=[],abortedMonaco=new Set();
  page.setDefaultTimeout(25000);await context.addInitScript(installAudit);await context.addInitScript(installTrace);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error')rawConsoleErrors.push({text:message.text(),location:message.location()});});
  function classifyErrors(){consoleErrors.length=0;expectedConsoleErrors.length=0;for(const error of rawConsoleErrors){
    const expected=config.editor==='fallback'&&isMonaco(error.location.url)&&abortedMonaco.has(error.location.url)&&/^Failed to load resource(?::|$)/i.test(error.text);
    (expected?expectedConsoleErrors:consoleErrors).push(error);
  }}
  page.on('requestfailed',request=>{if(isMonaco(request.url()))cdnFailures.push(request.url());});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    if(isMonaco(url.href)){cdn.push(url.href);if(config.editor==='monaco')return route.continue();abortedMonaco.add(url.href);return route.abort();}
    external.push(url.href);return route.abort();});
  const step=message=>{checks.push(message);console.log(`CHECK ${name}/${config.editor}: ${message}`);};
  const ready=()=>until(()=>page.locator('#hucFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');
  const mark=()=>page.evaluate(()=>__hucHighlightTrace.now());
  const events=(id,since=0,kind='class')=>page.evaluate(({id,since,kind})=>__hucHighlightTrace.events().filter(event=>event.id===id&&event.at>=since&&event.kind===kind),{id,since,kind});
  const active=()=>page.evaluate(()=>__hucHighlightTrace.active());
  const quiet=async()=>{await until(()=>active().then(ids=>ids.length===0),'All CSS pulses expire');};
  const read=(method='read')=>page.evaluate(method=>__hucHighlightAudit.read('tetorica-huc6280-synth',method),method);
  const audit=()=>page.evaluate(()=>__hucHighlightAudit.state());
  const output=()=>page.evaluate(()=>__hucHighlightAudit.output());
  const pce=async(method,args)=>page.evaluate(({method,args})=>__hucHighlightProbe.pce[method](...args),{method,args});
  const text=id=>page.locator('#'+id).textContent();
  async function value(id,wanted){await until(()=>text(id).then(text=>Number(text)===wanted),'Displayed '+id+' = '+wanted);}
  async function pulse(id,since){await until(()=>events(id,since).then(log=>log.length>0),'Pulse '+id);}
  async function noPulse(id,since){await pause(120);assert.deepEqual(await events(id,since),[],'No synthetic pulse for '+id);}
  async function editorReady(){
    await until(()=>page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))||/Fallback|unavailable|could not load/i.test(document.getElementById('synthCodeEditorNote').textContent)),'Editor initialization',60000);
    const actual=await page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))));
    if(config.editor==='monaco'&&!actual){const error=Error('Real Monaco unavailable');error.cdnUnavailable=cdnFailures.length>0;throw error;}assert.equal(actual,config.editor==='monaco');
  }
  async function openFiles(){if(!await page.locator('#hucFilesPanel').isVisible())await page.locator('#hucFilesToggle').click();}
  async function choose(id){await page.locator('#'+id).click();await until(()=>page.locator('#'+id).getAttribute('aria-selected').then(value=>value==='true'),'Selected tab '+id);}
  async function chip(){if(await page.locator('#synthWorkspace').evaluate(node=>node.classList.contains('is-code-expanded')))await choose('huc6280ChipTab');else if(!await page.locator('#huc6280ChipPanel').isVisible())await choose('huc6280ChipTab');}
  async function running(){const before=await page.evaluate(()=>__hucHighlightProbe.ticks);await pause(90);assert((await page.evaluate(()=>__hucHighlightProbe.ticks))>before);
    assert(await page.evaluate(()=>__hucHighlightProbe===__hucHighlightIdentity&&__hucHighlightProbe.context===__hucHighlightIdentity.context&&__hucHighlightProbe.prepared===__hucHighlightIdentity.prepared));
    assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
  }
  async function stableGraph(before){const after=await audit();assert.equal(after.contexts,before.contexts);assert.deepEqual(after.nodes,before.nodes);assert.deepEqual(after.mediaLoads,before.mediaLoads);}
  async function snapshot(label,width){
    await page.setViewportSize({width,height:1050});await pause(500);
    const inspect=()=>page.evaluate(()=>({viewport:innerWidth,elements:['body','main','#synthWorkspace','#hucSynthMain','#hucCodeLiveTools','#hucFilesPanel','#synthExpandedTabsSlot'].flatMap(selector=>{const node=document.querySelector(selector),r=node?.getBoundingClientRect();return r?.width&&r.height?[{selector,width:r.width,left:r.left,right:r.right,client:node.clientWidth,scroll:node.scrollWidth}]:[];})}));
    const verify=state=>{for(const element of state.elements){assert(element.left>=-1&&element.right<=width+1,label+' viewport '+JSON.stringify(element));if(['body','main','#synthWorkspace','#hucSynthMain'].includes(element.selector))assert(element.scroll<=element.client+1,label+' horizontal overflow '+JSON.stringify(element));}};
    const before=await inspect();verify(before);const filename=path.join(config.screenshots,`${name}-${config.editor}-${label}-${width}.png`);await page.screenshot({path:filename,fullPage:true});const after=await inspect();verify(after);measurements.layouts.push({filename,before,after});
  }
  async function stopCode(){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stops');}
  const observeCount=()=>page.evaluate(()=>__hucHighlightAudit.commands().filter(item=>item.method==='observeCode').length);
  try{
    await page.goto(origin+config.entry);await ready();assert(await page.locator('#hucLiveHighlightToggle').isChecked());assert.equal((await audit()).contexts,0);
    await openFiles();await page.locator('#hucProjectFileInput').setInputFiles({name:'highlight.cassette.zip',mimeType:'application/zip',buffer:fixture.cassette});await ready();
    await until(()=>draft(page).then(value=>fileText(value,'saved')===HOLD),'Highlight project imported');
    await page.locator('#synthWorkspaceCodeButton').click();await editorReady();await page.locator('#synthCodeRunButton').click();await until(()=>page.evaluate(()=>Boolean(globalThis.__hucHighlightProbe)),'Code probe created');
    await page.evaluate(()=>globalThis.__hucHighlightIdentity=__hucHighlightProbe);await chip();
    const beforeAuthor=await mark();await pce('setVolume',[0,20]);await pause(180);assert.deepEqual(await active(),[],'Auto instrument is not an observed CH');
    await selectHucChannel(page,0);await value('volume',20);await noPulse('volume',beforeAuthor);await running();
    step('Live highlight defaults On, starts passively, and Auto/first channel observation establish a baseline without flashing');

    const selective=await mark();await pce('setVolume',[0,18]);await value('volume',18);await pulse('volume',selective);
    assert.deepEqual(await events('panLeft',selective),[]);assert.deepEqual(await events('panRight',selective),[]);
    await quiet();const same=await mark();await pce('setVolume',[0,18]);await noPulse('volume',same);
    const rapid=await mark();await pce('setVolume',[0,17]);await pulse('volume',rapid);
    await page.evaluate(async()=>{for(const volume of [16,15,14,13,12])await __hucHighlightProbe.pce.setVolume(0,volume);});await value('volume',12);
    assert.equal((await events('volume',rapid,'start')).length,1,'Rapid changes share a bounded CSS animation');await quiet();
    const nextPulse=await mark();await pce('setVolume',[0,13]);await pulse('volume',nextPulse);await quiet();
    const stereo=await mark();await pce('setPan',[0,11,15]);await value('panLeft',11);await pulse('panLeft',stereo);assert.deepEqual(await events('panRight',stereo),[]);await quiet();
    step('Only changed scalar values pulse; identical writes do not flash, rapid writes do not restart a pulse, and a later change can pulse again');

    await pce('setLfo',[{frequency:7,depth:2,reset:false}]);await until(()=>page.locator('#lfoEnabled').isChecked(),'LFO enabled');await value('lfoFrequency',7);await quiet();
    const lfo=await mark();await pce('setLfo',[{frequency:9,depth:3,reset:false}]);await value('lfoFrequency',9);await pulse('lfoFrequency',lfo);await pulse('lfoDepth',lfo);await quiet();
    const period=await mark();await pce('setFrequency',[1,90]);await pulse('lfoModulatorPeriod',period);await quiet();
    await page.locator('#lfoSection > summary').click();const hiddenCard=await mark();await pce('setLfo',[{frequency:10,depth:3}]);await noPulse('lfoFrequency',hiddenCard);
    await page.locator('#lfoSection > summary').click();await value('lfoFrequency',10);await noPulse('lfoFrequency',hiddenCard);
    const visibleAgain=await mark();await pce('setLfo',[{frequency:11,depth:3}]);await value('lfoFrequency',11);await pulse('lfoFrequency',visibleAgain);await quiet();
    const disabledDepth=await mark();await pce('setLfo',[{frequency:11,depth:0}]);await until(()=>page.locator('#lfoEnabled').isChecked().then(value=>!value),'LFO disabled');await pulse('lfoEnabled',disabledDepth);await noPulse('lfoDepth',disabledDepth);await quiet();
    const reenabledDepth=await mark();await pce('setLfo',[{frequency:11,depth:3}]);await until(()=>page.locator('#lfoEnabled').isChecked(),'LFO re-enabled');await pulse('lfoEnabled',reenabledDepth);await noPulse('lfoDepth',reenabledDepth);await quiet();
    await pce('setLfo',[{frequency:0,depth:0}]);await selectHucChannel(page,4);await quiet();
    const noise=await mark();await pce('setNoise',[4,{enabled:true,frequency:9}]);await until(()=>page.locator('#source [aria-checked="true"]').getAttribute('data-value').then(value=>value==='noise'),'Noise source displayed');await value('noiseFrequency',9);
    await pulse('source',noise);assert.deepEqual(await events('noiseFrequency',noise),[],'Newly visible Noise value starts its own baseline');await quiet();
    const noiseNext=await mark();await pce('setNoise',[4,{enabled:true,frequency:15}]);await value('noiseFrequency',15);await pulse('noiseFrequency',noiseNext);await quiet();
    step('LFO rate/depth/CH2 period and Noise use their existing controls; disabled/fallback depth and newly visible fields rebaseline while known Source/LFO-enable changes still pulse');

    const switchAt=await mark();await selectHucChannel(page,0);await noPulse('volume',switchAt);
    await pce('setVolume',[0,24]);await pce('setPan',[0,15,15]);await pce('noteOn',[0,'A3']);await value('volume',24);await quiet();await running();
    const filesBeforeToggle=await draft(page);measurements.beforeToggle=await output();const graph=await audit(),state=(await read('observeCode')).registers,commandsBefore=(await page.evaluate(()=>__hucHighlightAudit.commands())).length;
    await page.locator('#hucLiveHighlightToggle').uncheck();assert.deepEqual(await active(),[]);await running();
    await page.locator('#hucLiveHighlightToggle').check();await running();await quiet();
    const commands=(await page.evaluate(()=>__hucHighlightAudit.commands())).slice(commandsBefore);assert(commands.every(item=>['observeCode','read'].includes(item.method)),'Highlight preference sends no chip writes');
    assert.deepEqual((await read('observeCode')).registers,state);await stableGraph(graph);const filesAfterToggle=await draft(page);for(const field of ['settings','savedSettings','workspace'])assert.deepEqual(filesAfterToggle[field],filesBeforeToggle[field],'Display preference does not change Project '+field);measurements.afterToggle=await output();
    assert(measurements.beforeToggle.finite&&measurements.afterToggle.finite&&measurements.afterToggle.muted&&measurements.afterToggle.acRms>1e-5);
    assert(Math.abs(measurements.afterToggle.acRms/measurements.beforeToggle.acRms-1)<.08,'Highlight toggle leaves actual PCM stable');
    await page.locator('#hucLiveEnabled').uncheck();await pause(100);const frozenText=await text('volume'),frozenReads=await observeCount(),frozen=await mark();
    await pce('setVolume',[0,19]);await page.locator('#hucLiveHighlightToggle').uncheck();await page.locator('#hucLiveHighlightToggle').check();await pause(150);
    assert.equal(await text('volume'),frozenText);assert.equal(await observeCount(),frozenReads,'Highlight does not add native reads while Auto update is Off');assert.deepEqual(await active(),[]);
    await page.locator('#hucLiveEnabled').check();await value('volume',19);await noPulse('volume',frozen);
    const resumed=await mark();await pce('setVolume',[0,18]);await value('volume',18);await pulse('volume',resumed);await quiet();
    step('Off clears pulses without changing registers, PCM, loops or graph; frozen Auto update adds no reads, and re-enabling takes a fresh baseline');

    for(const tab of ['synthInputCodeTab','msm5205ChipTab','synthInputKeyboardTab']){
      await choose(tab);const since=await mark();await pce('setVolume',[0,17]);await pause(100);assert.deepEqual(await active(),[]);
      await chip();await value('volume',17);await noPulse('volume',since);await pce('setVolume',[0,18]);await value('volume',18);await quiet();await running();
    }
    await page.locator('#panRight').scrollIntoViewIfNeeded();const rect=await page.locator('#panRight').boundingBox();assert(rect);await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
    const interacting=await mark();await pce('setVolume',[0,16]);await pause(100);assert.deepEqual(await active(),[],'Interaction suspends comparison without stealing the drag');await page.mouse.up();await value('volume',16);await noPulse('volume',interacting);
    await page.locator('#hucLiveHighlightToggle').focus();const focusAt=(await page.evaluate(()=>__hucHighlightAudit.commands())).length;await page.locator('#hucLiveHighlightToggle').uncheck();await page.locator('#hucLiveHighlightToggle').check();await page.keyboard.down('a');
    await until(()=>page.evaluate(index=>__hucHighlightAudit.commands().slice(index).some(item=>item.method==='noteOn'),focusAt),'Keyboard plays after preference control');await page.keyboard.up('a');await running();
    step('Hidden Code/Keyboard/chip views and parameter drags do not accumulate pulses; returning to the editor rebaselines and preference controls return keyboard focus');

    await page.emulateMedia({reducedMotion:'reduce'});await quiet();const reducedAt=await mark();await pce('setVolume',[0,15]);await value('volume',15);await pulse('volume',reducedAt);
    await until(()=>events('volume',reducedAt,'end').then(log=>log.length>0),'Reduced-motion pulse finishes');const reduced=await events('volume',reducedAt,'start');assert(reduced.some(event=>event.duration==='0.001s'));await quiet();measurements.reducedMotion=reduced;
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.locator('#synthWorkspaceSynthButton').click();for(const width of [1360,390])await snapshot('normal-huc',width);
    await page.locator('#synthWorkspaceCodeButton').click();await chip();for(const width of [1360,390])await snapshot('expanded-huc',width);
    await page.evaluate(()=>__hucHighlightTrace.freeze('volume'));await pce('setVolume',[0,14]);await until(()=>page.locator('#volume').evaluate(node=>node.classList.contains('is-live-changed')),'Frozen pulse for visual screenshot');await snapshot('active-volume-highlight',1360);await page.evaluate(()=>__hucHighlightTrace.release());await quiet();
    step('Reduced motion uses a bounded 1ms cleanup pulse, and the added option fits settled normal/expanded 390px and desktop layouts');

    await stopCode();await page.locator('#synthWorkspaceSynthButton').click();await page.locator('#hucSongSelect').selectOption(SONG);await page.locator('#hucSongPlayButton').click();await until(()=>page.locator('#hucSongPlayer').getAttribute('data-state').then(value=>value==='playing'),'VGM playing');await selectHucChannel(page,0);
    const songAt=await mark();await value('volume',18);await pulse('volume',songAt);measurements.vgmOutput=await output();assert(measurements.vgmOutput?.finite&&measurements.vgmOutput.muted&&measurements.vgmOutput.acRms>1e-5);
    await page.locator('#hucSongPlayButton').click();await until(()=>page.locator('#hucSongPlayer').getAttribute('data-state').then(value=>value==='paused'),'VGM paused');await quiet();const frame=await page.locator('#hucSongPlayer').getAttribute('data-position-frames');
    await selectHucChannel(page,2);await until(()=>page.locator('#volume').getAttribute('data-unknown').then(value=>value==='true'),'Unrecorded CH remains unknown');const knownAt=await mark();await page.locator('#hucSongPlayButton').click();
    await value('volume',24);await noPulse('volume',knownAt);const knownNext=await mark();await value('volume',11);await pulse('volume',knownNext);await quiet();
    await page.locator('#hucSongPlayButton').click();await until(()=>page.locator('#hucSongPlayer').getAttribute('data-state').then(value=>value==='paused'),'VGM repaused');const seekAt=await mark();
    await page.locator('#hucSongSeek').focus();await page.keyboard.press('Home');await until(()=>page.locator('#hucSongPlayer').getAttribute('data-position-frames').then(value=>value==='0'),'Seek to zero stays paused');
    await selectHucChannel(page,0);await value('volume',24);assert.equal(await page.locator('#hucSongPlayer').getAttribute('data-state'),'paused');await noPulse('volume',seekAt);assert.deepEqual(await active(),[]);measurements.pausedFrame=frame;
    await page.locator('#hucSongStopButton').click();
    step('Timed VGM changes pulse at the heard channel; Pause/Seek/new CH rebaseline, and first-known registers stay distinct from unknown placeholders');

    measurements.pulseEvents=await page.evaluate(()=>__hucHighlightTrace.events());
    await page.locator('#hucLiveHighlightToggle').uncheck();await page.reload();await ready();await editorReady();await page.waitForLoadState('networkidle');assert.equal(await page.locator('#hucLiveHighlightToggle').isChecked(),false);assert.equal((await audit()).contexts,0,'Reload never starts audio');
    await page.locator('#hucLiveHighlightToggle').check();await page.reload();await ready();await editorReady();await page.waitForLoadState('networkidle');assert(await page.locator('#hucLiveHighlightToggle').isChecked());assert.equal((await audit()).contexts,0);
    step('The independent display preference survives reload while Code and audio remain stopped');
    classifyErrors();measurements.audit=await audit();assert(measurements.audit.physicallyMuted);assert.deepEqual(measurements.audit.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    if(config.editor==='monaco'){assert.deepEqual(rawConsoleErrors,[]);assert.deepEqual(cdnFailures,[]);}
    return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
  }catch(error){classifyErrors();error.caseResult={browser:name,editor:config.editor,passed:false,checks,measurements,error:error.stack??String(error),status:await page.locator('#audioStatus').textContent().catch(()=>null),
    codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),audit:await audit().catch(()=>null),events:await page.evaluate(()=>__hucHighlightTrace?.events()).catch(()=>null),errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
    await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-failed.png`),fullPage:true}).catch(()=>{});throw error;
  }finally{await context.close();}
}
function makeVgm(wave){
  const write=(r,v)=>[0xb9,r,v],wait=frames=>{const out=[];while(frames){const n=Math.min(65535,frames);out.push(0x61,n&255,n>>8);frames-=n;}return out;};
  const upload=(ch,volume=24)=>[...write(0,ch),...write(4,64),...write(4,0),...wave.flatMap(v=>write(6,v)),...write(5,255),...write(2,254),...write(3,0),...write(4,128|volume)];
  const commands=[...write(1,255),...write(8,0),...write(9,0),...upload(0),...upload(1),...wait(44100),...write(0,0),...write(4,146),...wait(44100*2),...upload(2),...wait(44100),...write(0,2),...write(4,139),...wait(44100*116),0x66];
  const data=Buffer.alloc(256+commands.length);data.write('Vgm ');data.writeUInt32LE(data.length-4,4);data.writeUInt32LE(0x171,8);data.writeUInt32LE(44100*120,0x18);data.writeUInt32LE(0xcc,0x34);data.writeUInt32LE(3579545,0xa4);data.set(commands,256);return data;
}
(async()=>{
  const [{createPlaygroundCassetteZip},{createDefaultPreset}]=await Promise.all([import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js'))),import(pathToFileURL(path.join(repo,'docs/synth-huc6280/preset.js')))]);
  const preset=createDefaultPreset();preset.envelope.enabled=false;
  const fixture={cassette:Buffer.from(createPlaygroundCassetteZip([{path:CODE,type:'text',data:HOLD},{path:SONG,type:'binary',data:makeVgm(preset.wave)}]))};
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,report={schemaVersion:1,root:config.root,entry:config.entry,editor:config.editor,physicalOutputMuted:true,listeningPerformed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,fixture));}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;
  }catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.error=error.stack??String(error);process.exitCode=error.cdnUnavailable?2:1;console.error(report.error);}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,cdn,checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
