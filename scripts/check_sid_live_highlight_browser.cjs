// SPDX-License-Identifier: BSD-3-Clause
// Focused source/readable-ZIP checks. Every physical destination is muted
// before app boot; actual SID and song AudioWorklets still render upstream.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-sid/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'sid-live-highlight.json'),screenshots:path.join(tmpdir(),'sid-live-highlight')};
for(const arg of process.argv.slice(2)){const m=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(m,'Unknown argument '+arg);config[m[1]]=m[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(n=>['chromium','webkit'].includes(n)));
const hash=b=>createHash('sha256').update(b).digest('hex'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(30);}throw Error('Timeout: '+label);}
const served=new Map(),missing=[],external=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path.resolve(config.root,'.'+pathname);assert(file.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(file),name=path.relative(config.root,file),record={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(name))assert.deepEqual(served.get(name),record,'Asset changed during check');served.set(name,record);
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
const HOLD=`const sid=await useSoundChip('sid');
context.starts=(context.starts??0)+1;
const prepared=await livePrepare('highlight',()=>({ticks:0}));
globalThis.__sidHighlightProbe={sid,context,prepared};
await sid.setVoice(CH1,{waveform:'pulse',pulseWidth:700,attack:2,decay:3,sustain:10,release:4,sync:false,ring:false,test:false});
await sid.setVoice(CH2,{waveform:'triangle',pulseWidth:1200,attack:5,decay:6,sustain:9,release:7,sync:false,ring:false,test:false});
await sid.setFrequency(CH3,110);
await sid.setFilter({mode:'lowpass',routing:1,cutoff:400,resonance:4,volume:8,voice3off:true});
await sid.noteOn(CH1,'A3');
liveLoop('highlight',async()=>{prepared.ticks++;await beat(.05);});
`;
function installAudit(){
 const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
 const contexts=[],nodes=[],meters=[],commands=[],rejections=[];let serial=0;
 window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
 if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
 window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({name,node:this});}};
 AudioNode.prototype.connect=function(destination,...args){
  if(destination!==this.context.destination)return connect.call(this,destination,...args);
  const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
  connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
 };
 MessagePort.prototype.postMessage=function(data,...args){if(data?.method)commands.push({method:data.method,args:data.args});return post.call(this,data,...args);};
 window.addEventListener('unhandledrejection',event=>rejections.push(String(event.reason?.stack??event.reason)));
 const output=()=>meters.map(({analyser,mute})=>{
  const v=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(v);let sum=0,square=0,peak=0;
  for(const x of v){sum+=x;square+=x*x;peak=Math.max(peak,Math.abs(x));}
  return{muted:mute.gain.value===0,finite:v.every(Number.isFinite),peak,acRms:Math.sqrt(Math.max(0,square/v.length-(sum/v.length)**2))};
 }).sort((a,b)=>b.acRms-a.acRms)[0]??null;
 const read=(kind='tetorica-sid-synth')=>{
  const node=nodes.findLast(item=>item.name===kind&&item.node.context.state!=='closed')?.node;if(!node)throw Error('Missing Worklet '+kind);const id=--serial;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SID audit timeout'));},5000);
   function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
   node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'read',args:[]});});
 };
 window.__sidHighlightAudit={read,output,commands:()=>commands.slice(),state:()=>({contexts:contexts.length,nodes:nodes.map(x=>x.name),destinationConnections:meters.length,
  physicalOutputMuted:meters.every(x=>x.mute.gain.value===0),rejections:rejections.slice()})};
}
function installTrace(){
 const events=[],previous=new WeakMap();
 const key=node=>node.id||node.querySelector?.('.param-value[id],input[id]')?.id||node.dataset.choiceFor&&node.dataset.choiceFor+':'+node.dataset.value||'';
 const record=(kind,node,extra={})=>events.push({kind,id:key(node),at:performance.now(),...extra});
 new MutationObserver(records=>{for(const{target:node}of records){const active=node.classList?.contains('is-live-changed');
  if(previous.get(node)===active)continue;previous.set(node,active);if(active)record('class',node);
 }}).observe(document,{subtree:true,attributes:true,attributeFilter:['class']});
 document.addEventListener('animationstart',event=>{if(event.animationName==='synth-live-change')record('start',event.target,{duration:getComputedStyle(event.target).animationDuration});},true);
 document.addEventListener('animationend',event=>{if(event.animationName==='synth-live-change')record('end',event.target,{elapsed:event.elapsedTime});},true);
 window.__sidHighlightTrace={events:()=>events.slice(),now:()=>performance.now(),active:()=>Array.from(document.querySelectorAll('.is-live-changed')).map(key)};
}
async function check(browser,name,origin,fixture){
 const context=await browser.newContext({viewport:{width:1360,height:1050},serviceWorkers:'block',reducedMotion:'no-preference'}),page=await context.newPage();
 const checks=[],measurements={models:[],layouts:[]},errors=[],consoleErrors=[],expectedConsole=[];let stage='startup';
 page.setDefaultTimeout(25000);page.setDefaultNavigationTimeout(25000);await context.addInitScript(installAudit);await context.addInitScript(installTrace);
 page.on('dialog',dialog=>{if(dialog.type()==='beforeunload')void dialog.accept();else{errors.push('Unexpected dialog '+dialog.type()+': '+dialog.message());void dialog.dismiss();}});
 page.on('pageerror',e=>errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error'){const record={text:m.text(),url:m.location().url};
  (/cdnjs\.cloudflare\.com/.test(record.url)&&/^Failed to load resource/i.test(record.text)?expectedConsole:consoleErrors).push(record);}});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();
  if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}external.push(url.href);return route.abort();});
 const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
 const ready=()=>until(()=>page.locator('#sidFilesPanel').getAttribute('aria-busy').then(x=>x==='false'),'Files ready');
 const mark=()=>page.evaluate(()=>__sidHighlightTrace.now());
 const events=(id,since=0,kind='class')=>page.evaluate(({id,since,kind})=>__sidHighlightTrace.events().filter(x=>x.id===id&&x.at>=since&&x.kind===kind),{id,since,kind});
 const active=()=>page.evaluate(()=>__sidHighlightTrace.active());
 const quiet=()=>until(()=>active().then(x=>x.length===0),'CSS pulses expire');
 const pulse=(id,since)=>until(()=>events(id,since).then(x=>x.length>0),'Pulse '+id);
 const noPulse=async(id,since)=>{await pause(160);assert.deepEqual(await events(id,since),[],'No synthetic pulse for '+id);};
 const value=(id,next)=>until(()=>page.locator('#'+id).getAttribute('data-value').then(x=>Number(x)===next),'Displayed '+id+'='+next);
 const audit=()=>page.evaluate(()=>__sidHighlightAudit.state()),commands=()=>page.evaluate(()=>__sidHighlightAudit.commands());
 const mutate=(method,args)=>page.evaluate(({method,args})=>__sidHighlightProbe.sid[method](...args),{method,args});
 const read=()=>page.evaluate(()=>__sidHighlightAudit.read()),player=()=>page.evaluate(()=>__sidHighlightAudit.read('tetorica-sid-player'));
 const codeRuns=async()=>{const tick=await page.evaluate(()=>__sidHighlightProbe.prepared.ticks);await pause(100);assert(await page.evaluate(x=>__sidHighlightProbe.prepared.ticks>x,tick));
  assert(await page.evaluate(()=>__sidHighlightProbe===__sidHighlightIdentity&&__sidHighlightProbe.context===__sidHighlightIdentity.context&&__sidHighlightProbe.prepared===__sidHighlightIdentity.prepared));
  assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);};
 const controlWrites=items=>items.filter(x=>!['read','observeCode'].includes(x.method));
 async function layout(label,width){await page.setViewportSize({width,height:1050});await pause(400);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow '+label);
  const file=path.join(config.screenshots,`${name}-${label}-${width}.png`);await page.screenshot({path:file,fullPage:true});measurements.layouts.push(file);}
 async function choose(id){await page.locator('#'+id).click();await until(()=>page.locator('#'+id).getAttribute('aria-selected').then(x=>x==='true'),'Tab '+id);}
 try{
  await page.goto(origin+config.entry);await ready();assert(await page.locator('#sidLiveHighlightToggle').isChecked());assert.equal((await audit()).contexts,0);
  if(await page.locator('#sidFilesPanel').isHidden())await page.locator('#sidFilesToggle').click();
  await page.locator('#sidProjectFileInput').setInputFiles({name:'highlight.cassette.zip',mimeType:'application/zip',buffer:fixture.cassette});
  await page.locator('#sidImportCassetteDialog').waitFor({state:'visible'});await page.locator('#sidImportCassetteReplace').click();await page.locator('#sidImportCassetteDialog').waitFor({state:'hidden'});await ready();
  await page.locator('#synthWorkspaceCodeButton').click();await until(()=>page.locator('#synthCodeEditor').isVisible(),'Fallback editor visible');
  for(const model of ['6581','8580']){
   if(model==='8580'){await choose('sidChipTab');await page.locator('[data-choice-for="sidModel"][data-value="8580"]').click();await until(()=>page.locator('#sidModelBadge').textContent().then(x=>x==='8580'),'8580 selected');}
   await page.locator('#synthCodeRunButton').click();await until(()=>page.evaluate(()=>Boolean(globalThis.__sidHighlightProbe)),'Code probe starts');
   await page.evaluate(()=>globalThis.__sidHighlightIdentity=__sidHighlightProbe);await choose('sidChipTab');await value('pulseWidth',700);await value('attack',2);await quiet();
   assert.deepEqual(await active(),[]);await codeRuns();const native=await read();assert.equal(native.model,model);
   const first=await mark();await mutate('setVoice',[0,{pulseWidth:900}]);await value('pulseWidth',900);await pulse('pulseWidth',first);await noPulse('attack',first);await quiet();
   const same=await mark();await mutate('setVoice',[0,{pulseWidth:900}]);await noPulse('pulseWidth',same);
   const rapid=await mark();await mutate('setVoice',[0,{pulseWidth:901}]);await pulse('pulseWidth',rapid);
   await mutate('setVoice',[0,{pulseWidth:902}]);await mutate('setVoice',[0,{pulseWidth:903}]);await value('pulseWidth',903);await pause(80);
   assert.equal((await events('pulseWidth',rapid,'start')).length,1,'Rapid changes share one bounded animation');await quiet();
   const adsr=await mark();await mutate('setVoice',[0,{attack:6,decay:7,sustain:8,release:9}]);
   for(const[id,v]of[['attack',6],['decay',7],['sustain',8],['release',9]]){await value(id,v);await pulse(id,adsr);}await quiet();
   const filter=await mark();await mutate('setFilter',[{cutoff:888,resonance:9}]);await value('filterCutoff',888);await value('filterResonance',9);await pulse('filterCutoff',filter);await pulse('filterResonance',filter);await quiet();
   const output=await page.evaluate(()=>__sidHighlightAudit.output());assert(output?.muted&&output.finite&&output.acRms>.00001);measurements.models.push({model,output});
   step(model+': actual Code Pulse width, ADSR and shared Filter pulse selectively; repeated values stay quiet and rapid changes keep one bounded animation');

   const beforeCommands=controlWrites(await commands()).length,graphBefore=await audit();await page.locator('#sidLiveHighlightToggle').uncheck();assert.deepEqual(await active(),[]);
   const off=await mark();await mutate('setVoice',[0,{pulseWidth:1001}]);await value('pulseWidth',1001);await noPulse('pulseWidth',off);await codeRuns();
   // Compare only toggling itself: the deliberate mutation above is one extra command.
   assert.equal(controlWrites(await commands()).length,beforeCommands+1);assert.deepEqual((await audit()).nodes,graphBefore.nodes);assert.equal((await audit()).contexts,graphBefore.contexts);
   await page.locator('#sidLiveHighlightToggle').check();await noPulse('pulseWidth',await mark());const renewed=await mark();await mutate('setVoice',[0,{pulseWidth:1002}]);await value('pulseWidth',1002);await pulse('pulseWidth',renewed);await quiet();
   const scope=await mark();await page.locator('[data-sid-live-voice="1"]').click();await value('pulseWidth',1200);await noPulse('pulseWidth',scope);await page.locator('[data-sid-live-voice="0"]').click();await value('pulseWidth',1002);await quiet();
   await page.locator('#voiceCard').evaluate(n=>{n.open=false;});const folded=await mark();await mutate('setVoice',[0,{pulseWidth:1003}]);await value('pulseWidth',1003);await noPulse('pulseWidth',folded);
   await page.locator('#voiceCard').evaluate(n=>{n.open=true;});await noPulse('pulseWidth',await mark());
   await page.locator('#pulseWidth').focus();const focused=await mark();await mutate('setVoice',[0,{pulseWidth:1004}]);await value('pulseWidth',1004);await noPulse('pulseWidth',focused);await page.locator('#pulseWidth').blur();
   await pause(100);const afterFocus=await mark();await mutate('setVoice',[0,{pulseWidth:1005}]);await value('pulseWidth',1005);await pulse('pulseWidth',afterFocus);await quiet();
   await choose('synthInputCodeTab');const hidden=await mark();await mutate('setVoice',[0,{pulseWidth:1006}]);await pause(120);await noPulse('pulseWidth',hidden);
   await choose('sidChipTab');await value('pulseWidth',1006);await noPulse('pulseWidth',await mark());await codeRuns();
   step(model+': Highlight Off clears immediately without stopping Code or adding an audio command; On, CH, fold, focus and hidden-panel changes establish fresh baselines');
   if(model==='6581'){await layout('expanded-sid',1360);await layout('expanded-sid',390);await page.setViewportSize({width:1360,height:1050});}
   await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(x=>/Stopped|Idle/.test(x)),'Code stops');await quiet();await page.evaluate(()=>{delete globalThis.__sidHighlightProbe;});
  }
  await page.locator('#synthWorkspaceSynthButton').click();await page.locator('#sidImportTools').evaluate(n=>{n.open=true;});
  await page.locator('#sidSoundFileInput').setInputFiles({name:'highlight-melody-filter.sid',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.song)});
  await until(()=>page.locator('#sidImportPlay').isEnabled(),'Song accepted');await page.locator('#sidImportPlay').click();await until(()=>page.locator('#sidImportStatus').getAttribute('data-state').then(x=>x==='playing'),'Song playing');
  await page.locator('[data-sid-live-voice="0"]').click();const songStart=await mark();await pulse('filterCutoff',songStart);
  const songOutput=await page.evaluate(()=>__sidHighlightAudit.output());assert(songOutput?.muted&&songOutput.finite&&songOutput.acRms>.00001);measurements.songOutput=songOutput;
  await page.locator('#sidImportPause').click();await until(async()=>(await player()).paused,'Song paused');await quiet();const paused=await player();assert(paused.positionFrames>0);
  await pause(200);assert.equal((await player()).positionFrames,paused.positionFrames);assert.deepEqual(await active(),[]);
  await page.locator('#sidImportPause').click();await until(async()=>(await player()).positionFrames>paused.positionFrames,'Song resumes');await pulse('filterCutoff',await mark());
  await page.locator('#sidLiveHighlightToggle').uncheck();assert.deepEqual(await active(),[]);const moving=(await player()).positionFrames;await pause(220);assert((await player()).positionFrames>moving);assert.deepEqual(await active(),[]);
  await page.locator('#sidLiveHighlightToggle').check();await pulse('filterCutoff',await mark());
  await layout('normal-song',1360);await layout('normal-song',390);await page.locator('#sidImportStop').click();await quiet();
  step('Self-authored PSID actual Filter writes pulse, Pause freezes the position and clears highlights, Resume and Off keep correct playback behavior');

  step('Persisting Highlight Off and reloading the owned test project');
  await page.locator('#sidLiveHighlightToggle').uncheck();await page.reload({waitUntil:'domcontentloaded'});await ready();assert.equal(await page.locator('#sidLiveHighlightToggle').isChecked(),false);assert.equal((await audit()).contexts,0);assert.deepEqual(await active(),[]);
  step('Highlight Off survives reload independently of the Live following preference and does not start audio');
  measurements.audit=await audit();assert(measurements.audit.physicalOutputMuted);assert.deepEqual(measurements.audit.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  return{browser:name,passed:true,checks,measurements,errors,consoleErrors,expectedConsole};
 }catch(error){error.caseResult={browser:name,passed:false,stage,checks,measurements,error:error.stack??String(error),
   status:await page.locator('#audioStatus').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),active:await active().catch(()=>[]),trace:await page.evaluate(()=>__sidHighlightTrace.events()).catch(()=>[]),
   live:await page.locator('#sidLiveView').evaluate(n=>({...n.dataset})).catch(()=>null),errors,consoleErrors};
  await page.screenshot({path:path.join(config.screenshots,name+'-failed.png'),fullPage:true}).catch(()=>{});throw error;
 }finally{await context.close();}
}
(async()=>{
 const[{createSidCodeProject},{createDefaultPreset},{createChannelSettings},{createSidReferenceFixture}]=await Promise.all([
  import(pathToFileURL(path.join(repo,'docs/synth-sid/code_project.js'))),import(pathToFileURL(path.join(repo,'docs/synth-sid/preset.js'))),import(pathToFileURL(path.join(repo,'docs/synth-sid/channel_settings.js'))),import(pathToFileURL(path.join(repo,'test/fixtures/sid-reference/fixture.mjs')))]);
 const preset=createDefaultPreset();preset.modulation.sync=false;preset.modulation.ring=false;
 const project=createSidCodeProject({settings:createChannelSettings(preset),starterCode:HOLD});const fixture={cassette:Buffer.from(await project.exportProject()),song:createSidReferenceFixture('melody-filter').bytes};
 await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
 let failure;
 try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
   try{results.push(await check(browser,name,origin,fixture));}catch(error){results.push(error.caseResult??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
 }catch(error){failure=error;process.exitCode=1;console.error(error.stack??String(error));}
 finally{server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
 const report={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,networkAccessUsed:false,checkerSha256:hash(await fs.readFile(__filename)),
  results,missing,external,expectedBlockedMonaco:blockedMonaco,servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
 await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
