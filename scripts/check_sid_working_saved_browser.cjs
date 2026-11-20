// SPDX-License-Identifier: BSD-3-Clause
// Real SID working/saved checks. Every physical destination is muted before
// app startup; numeric PCM and native state are observations, not listening.
// --monaco-root is the existing Monaco 0.52.2 min/vs directory. All Monaco
// requests are fulfilled from that fixture; this runner never fetches a CDN.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..');
const config={root:path.join(repo,'docs'),entry:'/synth-sid/index.html',engines:'chromium,webkit',editor:'fallback',scope:'full',monacoRoot:path.join(repo,'build/dmg-working-saved-20261120/monaco/package/min/vs'),
  out:path.join(tmpdir(),'sid-working-saved.json'),screenshots:path.join(tmpdir(),'sid-working-saved')};
for(const arg of process.argv.slice(2)){
  const match=/^--(root|entry|engines|editor|scope|monaco-root|out|screenshots)=(.+)$/.exec(arg);
  assert(match,'Unknown argument '+arg);config[match[1]==='monaco-root'?'monacoRoot':match[1]]=match[2];
}
config.root=path.resolve(config.root);
assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
assert(['fallback','monaco'].includes(config.editor));assert(['full','files','layout'].includes(config.scope));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=value=>createHash('sha256').update(value).digest('hex'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=25000){
  const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(35);}throw Error('Timeout: '+label);
}
const served=new Map(),missing=[],external=[],cdn=[],results=[],localMonaco=new Map();
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
const isMonaco=url=>url.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/');
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const filename=path.resolve(config.root,'.'+pathname);assert(filename.startsWith(config.root+path.sep));
    const data=await fs.readFile(filename),name=path.relative(config.root,filename),receipt={bytes:data.length,sha256:hash(data)};
    if(served.has(name))assert.deepEqual(served.get(name),receipt,'Asset changed during check');served.set(name,receipt);
    response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(data);
  }catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
const A='/index.js',B='/other.js',DATA='/data.json',SETUP='/presets/Three.sid-channels.json',TONE='/presets/Voice.sid.json',BIN='/opaque/keep.bin';
const DB='tetorica-sid-synth-files',JOURNAL='tetorica-sid-synth-pending-code';
const source=label=>`// Working/saved fixture: ${label}.\nglobalThis.__sidWorkingMustNotRun=${JSON.stringify(label)};\n`;
const file=(value,version,name)=>value?.workspace?.[version]?.files.find(file=>file.path===name)?.data;
const same=(a,b)=>a===undefined||b===undefined?a===b:Buffer.from(a).equals(Buffer.from(b));
const text=(value,version,name)=>{const valueFile=file(value,version,name);return valueFile===undefined?undefined:Buffer.from(valueFile).toString('utf8');};
function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,
    connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,put=IDBObjectStore.prototype.put;
  const contexts=[],nodes=[],meters=[],commands=[],rejections=[],failures=[];let sequence=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(value,...args){if(value?.method){commands.push({method:value.method,args:value.args});if(commands.length>10000)commands.shift();}return post.call(this,value,...args);};
  IDBObjectStore.prototype.put=function(value,...args){
    if(this.transaction.db.name==='tetorica-sid-synth-files'&&localStorage.getItem('__sidWorkingQuota')==='1'){
      failures.push('QuotaExceededError');throw new DOMException('Synthetic draft quota failure','QuotaExceededError');
    }return put.call(this,value,...args);
  };
  window.addEventListener('unhandledrejection',event=>rejections.push(String(event.reason?.stack??event.reason)));
  function sample({analyser,mute}){
    const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0,finite=true;const crossings=[];
    for(const value of values){sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));finite&&=Number.isFinite(value);}
    const dc=sum/values.length;for(let i=1;i<values.length;i++)if(values[i-1]<=dc&&values[i]>dc)crossings.push(i);
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-dc*dc)),peak,finite,dc,muted:mute.gain.value===0,
      frequency:crossings.length>2?analyser.context.sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]):0};
  }
  const active=kind=>nodes.filter(item=>item.name===kind&&item.node.context.state!=='closed');
  async function read(kind='tetorica-sid-synth',method='read',args=[]){
    const node=active(kind).at(-1)?.node;if(!node)throw Error('Worklet missing: '+kind);const id=--sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Native audit timeout'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});
    });
  }
  window.__sidWorkingAudit={read,
    output:()=>meters.filter(item=>item.source.context.state==='running').map(sample).sort((a,b)=>b.acRms-a.acRms)[0]??null,
    failDrafts:value=>value?localStorage.setItem('__sidWorkingQuota','1'):localStorage.removeItem('__sidWorkingQuota'),commands:()=>commands.slice(),
    state:()=>({contexts:contexts.length,worklets:active('tetorica-sid-synth').length,players:active('tetorica-sid-player').length,
      playerIndex:nodes.findLastIndex(item=>item.name==='tetorica-sid-player'&&item.node.context.state!=='closed'),nodeNames:nodes.map(item=>item.name),
      physicallyMuted:meters.every(item=>item.mute.gain.value===0),destinationConnections:meters.length,failures:failures.slice(),rejections:rejections.slice()})};
}
async function draft(page){return page.evaluate(name=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
    const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');
    tx.oncomplete=async()=>{
      const value=read.result;db.close();
      for(const snapshot of new Set([value?.filesystem,value?.workspace?.working,value?.workspace?.saved]))if(snapshot?.files)
        snapshot.files=await Promise.all(snapshot.files.map(async file=>{
          if(typeof file.data==='string'||file.data?.sha256)return file;
          const bytes=file.data instanceof ArrayBuffer?new Uint8Array(file.data):file.data;
          const data=bytes.byteLength>16384?{bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join('')}:Array.from(bytes);
          return{...file,data};
        }));resolve(value??null);
    };tx.onabort=()=>{db.close();reject(tx.error??read.error);};
  };
}),DB);}
const hold=`const sid=await useSoundChip('sid');
context.boots=(context.boots??0)+1;
const prepared=await livePrepare('saved-hold',()=>({visits:0}));
globalThis.__sidWorkingProbe={sid,context,prepared,ticks:0};
await sid.noteOn(CH1,'E4');await sid.setFrequency(CH1,329.63);
liveFx('saved-quiet',{context:{gain:.55},process(input,output,state,ctx){for(let c=0;c<output.length;c++)for(let i=0;i<output[c].length;i++)output[c][i]=(input[c]?.[i]??0)*ctx.gain;}});
liveLoop('saved-hold',async()=>{__sidWorkingProbe.ticks++;prepared.visits++;await beat(.05);});
`;
const melody=`const {NOTE}=await import('./other.js');
const data=await file('./data.json',{type:'json'});
const sid=await useSoundChip('sid');
context.applies=(context.applies??0)+1;
const prepared=await livePrepare('saved-module-state',()=>({uses:0}));prepared.uses++;
globalThis.__sidWorkingMelody={sid,context,prepared,note:NOTE,marker:data.marker,ticks:0};
await sid.noteOn(CH1,NOTE);
liveLoop('saved-melody',async()=>{__sidWorkingMelody.ticks++;await beat(.05);});
`;

async function check(browser,name,origin,fixture){
  const context=await browser.newContext({viewport:{width:1360,height:1050},serviceWorkers:'block',acceptDownloads:true}),page=await context.newPage();
  const checks=[],measurements={},errors=[],rawConsoleErrors=[],consoleErrors=[],expectedConsoleErrors=[],abortedMonaco=new Set(),cdnFailures=[];
  page.setDefaultTimeout(25000);await context.addInitScript(installAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error')rawConsoleErrors.push({text:message.text(),location:message.location()});});
  const classify=()=>{consoleErrors.length=0;expectedConsoleErrors.length=0;for(const error of rawConsoleErrors){const expected=config.editor==='fallback'&&isMonaco(error.location.url)&&abortedMonaco.has(error.location.url)&&/^Failed to load resource(?::|$)/i.test(error.text);(expected?expectedConsoleErrors:consoleErrors).push(error);}};
  page.on('requestfailed',request=>{if(isMonaco(request.url()))cdnFailures.push(request.url());});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    if(isMonaco(url.href)){
      cdn.push(url.href);if(config.editor==='fallback'){abortedMonaco.add(url.href);return route.abort();}
      const relative=decodeURIComponent(url.pathname.split('/min/vs/')[1]);let fixturePath=relative,filename=path.resolve(config.monacoRoot,fixturePath);assert(filename.startsWith(path.resolve(config.monacoRoot)+path.sep));
      try{let body;try{body=await fs.readFile(filename);}catch(error){if(error.code!=='ENOENT'||!relative.endsWith('.min.js'))throw error;fixturePath=relative.replace(/\.min\.js$/,'.js');filename=path.resolve(config.monacoRoot,fixturePath);body=await fs.readFile(filename);}localMonaco.set(relative,{fixturePath,bytes:body.length,sha256:hash(body)});return route.fulfill({status:200,contentType:mime[path.extname(filename)]??'application/octet-stream',body,headers:{'Access-Control-Allow-Origin':'*'}});}catch{cdnFailures.push(url.href);return route.abort();}
    }external.push(url.href);return route.abort();
  });
  const step=message=>{checks.push(message);console.log(`CHECK ${name}/${config.editor}: ${message}`);};
  const ready=()=>until(()=>page.locator('#sidFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');
  const row=name=>page.locator('#sidFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(name)}]`);
  async function openFiles(){if(!await page.locator('#sidFilesPanel').isVisible())await page.locator('#sidFilesToggle').click();for(let i=0;i<30;i++){const closed=page.locator('#sidFilesTree details:not([open])>summary');if(!await closed.count())break;await closed.first().click();}}
  async function select(name,{force=false}={}){await openFiles();if(force||await row(name).getAttribute('aria-current')!=='true')await row(name).click();await ready();await until(()=>page.locator('#sidFilesSelected').textContent().then(value=>value===name),'Selected '+name);}
  async function dot(name,value){await openFiles();await until(async()=>value?await row(name).locator('.sid-file-unsaved').count()>0:await row(name).locator('.sid-file-unsaved').count()===0,'Dirty dot '+name+'='+value);if(value)assert.equal((await row(name).locator('.sid-file-unsaved').textContent()).trim(),'●');}
  async function auto(value){const input=page.locator('#sidAutoApplyToggle');if(await input.isChecked()!==value)await input.click();await ready();await until(()=>draft(page).then(valueState=>valueState?.workspace?.autoSave===value),'Auto apply '+value);assert.equal(await input.isChecked(),value);assert(await page.evaluate(()=>document.activeElement?.id!=='sidAutoApplyToggle'));}
  const currentSource=()=>page.evaluate(()=>window.monaco?.editor?.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))?.getValue()??document.getElementById('synthCodeEditor').value);
  async function editorReady(){await until(()=>page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))||/Fallback|unavailable|could not load/i.test(document.getElementById('synthCodeEditorNote').textContent)),'Editor ready',60000);assert.equal(await page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))),config.editor==='monaco');}
  async function edit(name,value){await select(name,{force:true});await page.locator('#synthInputCodeTab').click();await editorReady();if(config.editor==='fallback')await page.locator('#synthCodeEditor').fill(value);else await page.evaluate(value=>monaco.editor.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).setValue(value),value);assert.equal(await currentSource(),value);}
  async function durable(name,working,saved){let value;await until(async()=>{value=await draft(page);return same(file(value,'working',name),working)&&same(file(value,'saved',name),saved);},'Both layers durable '+name);return value;}
  async function save(name,shortcut){if(name)await select(name);if(shortcut)await page.keyboard.press(shortcut);else await page.locator('#sidFileSaveButton').click();await ready();if(name)await dot(name,false);}
  async function saveAll(){await page.locator('#sidFileSaveAllButton').click();await ready();await until(()=>page.locator('#sidFilesTree .sid-file-unsaved').count().then(count=>count===0),'Save all');}
  async function importFixture(bytes=fixture.cassette){const old=(await draft(page))?.workspaceId;await page.locator('#sidProjectFileInput').setInputFiles({name:'working-saved.cassette.zip',mimeType:'application/zip',buffer:bytes});await page.locator('#sidImportCassetteDialog').waitFor({state:'visible'});await page.locator('#sidImportCassetteReplace').click();await page.locator('#sidImportCassetteDialog').waitFor({state:'hidden'});await ready();await until(()=>draft(page).then(value=>value?.workspace?.version===1&&value.workspaceId!==old),'Imported two-layer project');await openFiles();}
  async function menu(){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();}
  async function exportCassette(){await menu();const promise=page.waitForEvent('download');await page.locator('#sidProjectExportButton').click();const download=await promise,chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);assert.equal(await download.failure(),null);const bytes=Buffer.concat(chunks);return{bytes,cassette:await fixture.loadCassette(bytes),snapshot:await fixture.loadProject(bytes)};}
  const read=(method='read')=>page.evaluate(method=>__sidWorkingAudit.read('tetorica-sid-synth',method),method);
  const player=()=>page.evaluate(()=>__sidWorkingAudit.read('tetorica-sid-player'));
  const audit=()=>page.evaluate(()=>__sidWorkingAudit.state());
  async function audio(){await pause(220);const value=await page.evaluate(()=>__sidWorkingAudit.output());assert(value?.muted&&value.finite);return value;}
  async function run(apply=false){await select(A);await page.locator('#synthInputCodeTab').click();await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Playing|Running/.test(await page.locator('#synthCodeState').textContent());},'Code starts');}
  async function stop(){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stopped');await until(async()=>{const value=await page.evaluate(()=>__sidWorkingAudit.output());return !value||value.peak<1e-6;},'Stopped PCM silence');}
  async function running(){const before=await page.evaluate(()=>__sidWorkingProbe.ticks);await pause(120);assert((await page.evaluate(()=>__sidWorkingProbe.ticks))>before);assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);}
  async function openNew(){await menu();await page.locator('#sidProjectNewButton').click();await page.locator('#sidNewCassetteDialog').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>document.activeElement?.id),'sidNewCassetteCancel');}
  async function undo(){await openFiles();await ready();await page.locator('#sidFilesTree').scrollIntoViewIfNeeded();await pause(150);await page.locator('#sidFilesTree').click({button:'right',position:{x:4,y:4}});await page.locator('#spuFileContextMenu').waitFor({state:'visible'});await page.keyboard.press('Home');await page.keyboard.press('Enter');await ready();}
  async function noExecution(){assert.equal(await page.evaluate(()=>globalThis.__sidWorkingMustNotRun),undefined);assert.equal((await audit()).contexts,0);}
  async function parameter(id,value){const node=page.locator('#'+id+'Range');await node.evaluate((element,next)=>{element.value=String(next);element.dispatchEvent(new Event('input',{bubbles:true}));},value);}
  async function finalAudit(){classify();measurements.audit=await audit();assert(measurements.audit.physicallyMuted);assert.deepEqual(measurements.audit.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);}
  async function screenshot(label,width){await page.setViewportSize({width,height:1050});await pause(500);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Layout fits '+width);await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-${label}-${width}.png`),fullPage:true});}
  try{
    await page.goto(origin+config.entry);await ready();await openFiles();assert(await page.locator('#sidAutoApplyToggle').isChecked());await noExecution();
    await openNew();await page.keyboard.press('a');await noExecution();await page.keyboard.press('Escape');await page.locator('#sidNewCassetteDialog').waitFor({state:'hidden'});
    await importFixture();const migrated=await draft(page);assert.equal(migrated.version,2);
    for(const version of ['working','saved']){assert.equal(text(migrated,version,SETUP),fixture.setupText);assert.equal(text(migrated,version,TONE),fixture.voiceText);assert.equal(text(migrated,version,'/notes.txt'),fixture.notes);assert.equal(file(migrated,version,BIN).sha256,hash(fixture.opaque));}
    await select(SETUP);assert.equal(await page.locator('#synthInputKeyboardTab').getAttribute('aria-selected'),'true','JSON selection keeps Keyboard mode');assert(await page.locator('#synthCodePanel').isHidden());
    await edit(A,source('auto'));await durable(A,source('auto'),source('auto'));await dot(A,false);await noExecution();
    await auto(false);await edit(A,source('manual'));await durable(A,source('manual'),source('auto'));await dot(A,true);await edit(B,"export const NOTE='G4';\n");await dot(B,true);await save(A,'Control+s');await dot(B,true);await saveAll();await durable(B,"export const NOTE='G4';\n","export const NOTE='G4';\n");
    await edit(A,source('meta'));await save(A,'Meta+s');await durable(A,source('meta'),source('meta'));await edit(A,source('discard'));await edit(B,"export const NOTE='D4';\n");await page.locator('#sidFileDiscardAllButton').click();await ready();await durable(A,source('meta'),source('meta'));await dot(A,false);await dot(B,false);await noExecution();
    step('Legacy files migrate byte-for-byte; JSON selection stays in Keyboard; default Auto apply, dots, current/all Save and both shortcuts accept files without running source');

    await edit(A,source('pending'));await durable(A,source('pending'),source('meta'));const portable=await exportCassette();assert.equal(Buffer.from(portable.cassette.files.get('index.js')).toString('utf8'),source('meta'));assert(Buffer.from(portable.cassette.files.get(BIN.slice(1))).equals(fixture.opaque));
    const manifest=JSON.parse(Buffer.from(portable.cassette.files.get('sid-synth.project.json')).toString('utf8'));assert(!manifest.workingDelta.files.some(file=>file.path===BIN),'Unchanged opaque binary not duplicated for recovery');assert.equal(text(portable.snapshot,'working',A),source('pending'));assert.equal(text(portable.snapshot,'saved',A),source('meta'));
    await importFixture(portable.bytes);await page.reload();await ready();await select(A);await page.locator('#synthInputCodeTab').click();await editorReady();assert.equal(await currentSource(),source('pending'));await dot(A,true);await page.locator('#sidFileDiscardButton').click();await ready();await durable(A,source('meta'),source('meta'));assert.equal(await currentSource(),source('meta'));
    for(const width of [1360,390])await screenshot('Files',width);await page.setViewportSize({width:1360,height:1050});await noExecution();step('Cassette and reload retain saved/working source independently and keep original binary once; Discard restores the accepted Code model and responsive Files fit');

    await importFixture();await select(SETUP);await auto(false);const prior=await draft(page);
    await page.locator('[data-sid-live-voice="1"]').click();await page.locator('[data-sid-live-voice="round-robin"]').click();let targetOnly=await draft(page);assert.deepEqual(targetOnly.settings.channels,prior.settings.channels,'Selecting round robin never unifies CH voices');
    const changed=structuredClone(fixture.setup);changed.channels[0].voice.pulseWidth=777;await edit(SETUP,JSON.stringify(changed,null,2)+'\n');await dot(SETUP,true);assert.equal((await draft(page)).savedSettings.channels[0].voice.pulseWidth,fixture.setup.channels[0].voice.pulseWidth);
    await save(SETUP);assert.equal((await draft(page)).savedSettings.channels[0].voice.pulseWidth,777);await edit(SETUP,'{"format":');await dot(SETUP,true);await save(SETUP);await ready();await dot(SETUP,false);assert.equal(await currentSource(),'{\"format\":');assert.equal((await draft(page)).savedSettings.channels[0].voice.pulseWidth,777);assert.match(await page.locator('#sidFilesStatus').textContent(),/JSON|invalid|finish|unexpected|failed/i);
    await edit(SETUP,JSON.stringify(changed,null,2)+'\n');await save(SETUP);await dot(SETUP,false);await noExecution();step('Independent channel settings survive target selection; valid JSON accepts on Save and unfinished saved JSON stays editable without replacing accepted sound');

    measurements.models=[];
    if(config.scope==='full')for(const model of ['6581','8580']){
      await importFixture();await select(SETUP);await auto(false);const settings=structuredClone(fixture.setup);settings.target=0;for(const voice of settings.channels)voice.model=model;
      await edit(SETUP,JSON.stringify(settings,null,2)+'\n');await save(SETUP);
      await page.locator('#voiceCard').evaluate(node=>{node.open=true;});await parameter('pulseWidth',768);await dot(SETUP,true);await page.locator('#synthInputKeyboardTab').click();await page.locator('#startAudio').click();await until(async()=>(await audit()).worklets===1,'SID Worklet ready');
      await until(async()=>{const state=await read();return state.model===model&&(state.registers[2]|state.registers[3]<<8)===1024;},'Audio startup uses accepted width');
      const performanceKey=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(performanceKey);await page.keyboard.down(performanceKey);
      await until(async()=>(await read()).voices.length>0,'Keyboard uses accepted instrument');assert.equal(((await read()).registers[2]|(await read()).registers[3]<<8),1024,'Pending width does not leak on first key');await page.keyboard.up(performanceKey);
      for(const channel of [1,0]){await page.locator(`[data-sid-live-voice="${channel}"]`).click();await until(async()=>(await read()).channelSettings.target===channel,'Accepted target switch');assert.equal(((await read()).registers[2]|(await read()).registers[3]<<8),1024,'Target switch does not accept pending width');}
      await page.locator('#sidFileDiscardButton').click();await ready();await dot(SETUP,false);
      await edit(A,hold);await save(A);await run();await until(()=>page.evaluate(()=>Boolean(globalThis.__sidWorkingProbe?.ticks>1)),'Loop ticks');
      await page.evaluate(()=>{globalThis.__sidWorkingIdentity=__sidWorkingProbe;});if(await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').uncheck();await select(SETUP);await page.evaluate(async()=>{await __sidWorkingProbe.sid.noteOn(0,'E4');await __sidWorkingProbe.sid.setFrequency(0,329.63);});
      const beforeHardware=await read('observeCode'),before=await audio(),graphBefore=await audit();assert.equal(beforeHardware.model,model);assert(before.acRms>1e-5,'Real held '+model+' PCM');
      await page.locator('#voiceCard').evaluate(node=>{node.open=true;});await parameter('pulseWidth',512);await dot(SETUP,true);await running();const pendingHardware=await read('observeCode'),pending=await audio();assert.deepEqual(pendingHardware.registers,beforeHardware.registers,'Pending author control does not change live SID');assert(Math.abs(pending.acRms/before.acRms-1)<.12);
      await save(SETUP);await running();await until(async()=>{const state=await read('observeCode');return(state.registers[2]|state.registers[3]<<8)===512;},'Accepted pulse width reaches held '+model);const savedHardware=await read('observeCode'),saved=await audio();assert(saved.acRms>1e-5);assert.deepEqual(savedHardware.registers.slice(0,2),beforeHardware.registers.slice(0,2),'Save retains frequency');assert.equal(savedHardware.registers[4]&1,1,'Save retains Gate');assert.deepEqual(savedHardware.registers.slice(7,21),beforeHardware.registers.slice(7,21),'Other channel values stay distinct');assert(await page.evaluate(()=>__sidWorkingProbe===__sidWorkingIdentity));assert.deepEqual((await audit()).nodeNames,graphBefore.nodeNames,'Save does not rebuild Code/FX graph');
      await page.locator('#filterCard').evaluate(node=>{node.open=true;});await parameter('filterCutoff',333);await dot(SETUP,true);assert.deepEqual((await read('observeCode')).registers,savedHardware.registers);await save(SETUP);await running();const filtered=await read('observeCode');assert.equal((filtered.registers[21]&7)|(filtered.registers[22]<<3),333);assert.equal(filtered.registers[24]&0x70,0x30,'LP/BP outputs preserved');assert.equal(filtered.registers[23]>>4,fixture.setup.channels[0].filter.resonance);assert.deepEqual(filtered.registers.slice(0,21),savedHardware.registers.slice(0,21));
      await parameter('pulseWidth',640);await dot(SETUP,true);await until(async()=>JSON.parse(text(await draft(page),'working',SETUP)).channels[0].voice.pulseWidth===640,'Pending author width durable');const pendingText=text(await draft(page),'working',SETUP);
      await page.locator('#sidLiveEnabled').check();await page.locator('[data-sid-live-voice="1"]').click();
      await until(()=>page.locator('#voiceEditor').getAttribute('data-observation-voice').then(value=>value==='1'),'Code Live CH2');await until(()=>page.locator('#voiceEditor').getAttribute('data-live-editable').then(value=>value==='true'),'Code Live editable');
      const oldAttack=(await read('observeCode')).registers[12]>>4;await page.locator('[data-stepper-for="attack"][data-stepper-delta="1"]').click();await until(async()=>((await read('observeCode')).registers[12]>>4)===oldAttack+1,'Physical Code edit accepted');
      assert.equal(text(await draft(page),'working',SETUP),pendingText,'Physical Code edits do not rewrite pending author JSON');await page.locator('#sidLiveEnabled').uncheck();await save(SETUP);await running();const sessionFiltered=await read('observeCode');assert.equal(sessionFiltered.registers[12]>>4,oldAttack+1,'Unrelated document Save preserves physical session edits');assert.equal(sessionFiltered.registers[2]|sessionFiltered.registers[3]<<8,640);assert.equal(sessionFiltered.registers[4]&1,1);
      await auto(true);await page.locator('#sidLiveEnabled').check();await page.locator('[data-sid-live-voice="1"]').click();await until(()=>page.locator('#voiceEditor').getAttribute('data-observation-voice').then(value=>value==='1'),'Auto Code Live CH2');
      const autoBefore=await read('observeCode'),autoAttack=(autoBefore.registers[12]>>4)+1;await page.locator('[data-stepper-for="attack"][data-stepper-delta="1"]').click();await until(async()=>((await read('observeCode')).registers[12]>>4)===autoAttack,'Auto Live native attack');
      await until(async()=>{const state=await draft(page);return ['working','saved'].every(version=>JSON.parse(text(state,version,SETUP)).channels[1].voice.attack===autoAttack);},'Auto Live saved and working JSON');await dot(SETUP,false);const autoAfter=await read('observeCode');
      for(const channel of [0,2])assert.deepEqual(autoAfter.registers.slice(channel*7,channel*7+7),autoBefore.registers.slice(channel*7,channel*7+7),'Auto Live preserves other physical CHs');assert.deepEqual(autoAfter.registers.slice(7,12),autoBefore.registers.slice(7,12));assert.equal(autoAfter.registers[13],autoBefore.registers[13]);await running();await page.locator('#sidLiveEnabled').uncheck();await auto(false);
      const activeBefore=await draft(page),codeBefore=await read('observeCode');await openNew();await page.evaluate(()=>{window.__sidBackupAttempted=0;window.tetoricaSynthSave=async()=>{window.__sidBackupAttempted++;return false;};});await page.locator('#sidNewCassetteExport').click();await ready();await until(()=>page.evaluate(()=>__sidBackupAttempted===1),'Backup callback');assert(await page.locator('#sidNewCassetteDialog').isVisible());await page.evaluate(()=>{delete window.tetoricaSynthSave;});await page.locator('#sidNewCassetteCancel').click();await page.locator('#sidNewCassetteDialog').waitFor({state:'hidden'});assert.equal((await draft(page)).workspaceId,activeBefore.workspaceId);assert.deepEqual((await read('observeCode')).registers,codeBefore.registers);await running();
      measurements.models.push({model,before,pending,saved,beforeHardware,savedHardware,sessionFiltered,autoBefore,autoAfter,graphBefore});await page.locator('#synthInputCodeTab').click();await stop();
    }
    if(config.scope==='full')step('6581 and 8580 held PCM, frequency, Gate, independent channels and shared LP/BP survive pending edits; Save changes only accepted fields while retaining Code/context/FX and unrelated physical Live edits; Auto Live records acknowledged CH edits in both JSON layers; canceled backup keeps performance');

    if(config.scope==='full'){
      await importFixture();await auto(false);await edit(A,melody);await save(A);await edit(B,"export const NOTE='G4';\n");await edit(DATA,'{"marker":"working data"}\n');await run();await until(()=>page.evaluate(()=>Boolean(globalThis.__sidWorkingMelody)),'Saved-source program');assert.equal(await page.evaluate(()=>__sidWorkingMelody.note),'C4');assert.equal(await page.evaluate(()=>__sidWorkingMelody.marker),'accepted data');const client=await page.evaluate(()=>{globalThis.__sidSavedClient=__sidWorkingMelody.sid;globalThis.__sidSavedContext=__sidWorkingMelody.context;globalThis.__sidSavedPrepared=__sidWorkingMelody.prepared;globalThis.__sidSavedBeginCount=__sidWorkingAudit.commands().filter(item=>item.method==='beginCode').length;return true;});assert(client);
      await saveAll();assert.equal(await page.evaluate(()=>__sidWorkingMelody.note),'C4','Save does not Apply');await select(A);await page.locator('#synthInputCodeTab').click();await run(true);await until(()=>page.evaluate(()=>__sidWorkingMelody.note==='G4'),'Explicit Apply uses accepted module');assert.equal(await page.evaluate(()=>__sidWorkingMelody.marker),'working data');assert(await page.evaluate(()=>__sidWorkingMelody.context===__sidSavedContext&&__sidWorkingMelody.prepared===__sidSavedPrepared));assert.equal(await page.evaluate(()=>__sidWorkingAudit.commands().filter(item=>item.method==='beginCode').length),await page.evaluate(()=>__sidSavedBeginCount),'Apply retains the same physical Code lease');await stop();step('Run/Apply reads only saved entry, modules and data; accepting files never executes them and explicit Apply retains the physical Code lease, context and prepared state');

      await importFixture();await select(B);await page.locator('#sidFileRenameButton').click();await page.locator('#sidFileNameInput').fill('/renamed.js');await page.locator('#sidFileNameConfirm').click();await ready();await until(()=>row('/renamed.js').count().then(count=>count===1),'Renamed file');await undo();await until(()=>row(B).count().then(count=>count===1),'Undo restores rename');await select(B);await page.locator('#sidFileDeleteButton').click();await page.locator('#sidFileNameConfirm').click();await ready();await undo();await until(()=>row(B).count().then(count=>count===1),'Undo restores deletion');
      await openNew();await page.locator('#sidNewCassetteCreate').click();await page.locator('#sidNewCassetteDialog').waitFor({state:'hidden'});await ready();assert((await draft(page)).workspace.saved.files.some(file=>file.path===A&&file.data.length>0));await undo();await select(SETUP);assert.equal(text(await draft(page),'saved',SETUP),fixture.setupText);step('Basic context history restores rename/deletion and the complete prior Cassette after New; the new starter is populated without autorun');

      await page.locator('#sidImportTools').evaluate(node=>{node.open=true;});await page.locator('#sidSoundFileInput').setInputFiles({name:'working-saved-tone.sid',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.song)});await until(()=>page.locator('#sidImportPlay').isEnabled(),'Song accepted');await page.locator('#sidImportPlay').click();await until(async()=>{if((await audit()).players!==1)return false;return(await player()).positionFrames>4410;},'Song advances');await page.locator('#sidImportPause').click();await until(async()=>(await player()).paused,'Song paused');const paused=await player(),playerIndex=(await audit()).playerIndex;assert(paused.positionFrames>0);await select(SETUP,{force:true});assert.equal((await player()).positionFrames,paused.positionFrames);assert((await player()).paused);await auto(false);await edit(B,"export const NOTE='F4';\n");await save(B);assert.equal((await player()).positionFrames,paused.positionFrames);assert.equal((await audit()).playerIndex,playerIndex);await page.locator('#sidImportPause').click();await until(async()=>(await player()).positionFrames>paused.positionFrames,'Song resumes');await select(TONE,{force:true});const playing=await player();assert(playing.playing);assert.equal((await audit()).playerIndex,playerIndex);await page.locator('#sidImportStop').click();measurements.pausedSongFrames=paused.positionFrames;step('Ordinary selection/saving preserves a real nonzero paused SID position and resumes the same player; sound selection during Play keeps the song running');

      await importFixture();await select(SETUP);await auto(false);await edit(A,source('before quota'));await durable(A,source('before quota'),fixture.a);await page.evaluate(()=>__sidWorkingAudit.failDrafts(true));const accepted=source('quota accepted');await edit(A,accepted);await until(()=>page.evaluate(()=>__sidWorkingAudit.state().failures.length>0),'Real IDB quota failure');await save(A);const backup=await exportCassette();assert.equal(Buffer.from(backup.cassette.files.get('index.js')).toString('utf8'),accepted);assert.equal(text(await draft(page),'saved',A),fixture.a);const journal=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),JOURNAL);assert.equal(journal.source,accepted);assert.equal(journal.savedSource,accepted);assert.equal(journal.autoSave,false);await page.locator('#voiceCard').evaluate(node=>{node.open=true;});await parameter('pulseWidth',320);await dot(SETUP,true);await until(()=>page.evaluate(()=>Boolean(localStorage.getItem('tetorica-sid-synth-pending-sound-v2'))),'Sound journal');const soundJournal=await page.evaluate(()=>JSON.parse(localStorage.getItem('tetorica-sid-synth-pending-sound-v2')));assert.equal(JSON.parse(soundJournal.workingText).channels[0].voice.pulseWidth,320);assert.equal(JSON.parse(soundJournal.savedText).channels[0].voice.pulseWidth,1024);assert.equal(soundJournal.autoSave,false);await page.reload();await ready();await select(A);await page.locator('#synthInputCodeTab').click();await editorReady();assert.equal(await currentSource(),accepted);await dot(A,false);await dot(SETUP,true);const recovery=await exportCassette();assert.equal(JSON.parse(text(recovery.snapshot,'working',SETUP)).channels[0].voice.pulseWidth,320);assert.equal(JSON.parse(text(recovery.snapshot,'saved',SETUP)).channels[0].voice.pulseWidth,1024);await page.evaluate(()=>__sidWorkingAudit.failDrafts(false));await save(A,'Control+s');await durable(A,accepted,accepted);assert.equal((await audit()).contexts,0);step('IDB quota failure keeps accepted Code and pending sound independently recoverable/exportable from journals; reload never starts audio or source');
    }
    for(const width of [1360,390])await screenshot('final',width);await finalAudit();return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
  }catch(error){classify();error.caseResult={browser:name,editor:config.editor,passed:false,checks,measurements,error:error.stack??String(error),filesStatus:await page.locator('#sidFilesStatus').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),source:await currentSource().catch(()=>null),draft:await draft(page).catch(()=>null),audit:await audit().catch(()=>null),errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};error.caseResult.native=await read('observeCode').catch(()=>null);error.caseResult.output=await page.evaluate(()=>__sidWorkingAudit.output()).catch(()=>null);await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-failed.png`),fullPage:true}).catch(()=>{});throw error;}
  finally{await context.close();}
}

(async()=>{
  const [{createPlaygroundCassetteZip,loadPlaygroundCassette},{createDefaultPreset},{createChannelSettings},{createSidCodeProject},{createSidReferenceFixture}]=await Promise.all([
    import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js'))),import(pathToFileURL(path.join(repo,'docs/synth-sid/preset.js'))),
    import(pathToFileURL(path.join(repo,'docs/synth-sid/channel_settings.js'))),import(pathToFileURL(path.join(repo,'docs/synth-sid/code_project.js'))),import(pathToFileURL(path.join(repo,'test/fixtures/sid-reference/fixture.mjs')))]);
  const voice=createDefaultPreset();voice.name='Voice';voice.voice.waveform='pulse';voice.voice.attack=0;voice.voice.decay=0;voice.voice.sustain=12;
  voice.filter={enabled:true,mode:'lowpass+bandpass',cutoff:600,resonance:4,volume:8};const setup=createChannelSettings(voice);setup.channels[0].name='Pulse';setup.channels[0].voice.pulseWidth=1024;
  setup.channels[1].name='Combined';setup.channels[1].voice.waveform='triangle+saw';setup.channels[1].voice.pulseWidth=1536;setup.channels[1].voice.attack=6;
  setup.channels[2].name='Saw';setup.channels[2].voice.waveform='saw';setup.channels[2].voice.pulseWidth=3000;setup.channels[2].voice.release=9;
  const opaque=Uint8Array.from({length:1024*1024},(_,i)=>(i*73+Math.floor(i/13))&255),song=createSidReferenceFixture('tone').bytes;
  const fixture={voice,setup,opaque,song,setupText:JSON.stringify(setup,null,2)+'\n',voiceText:JSON.stringify(voice,null,2)+'\n',notes:'\ufeffUnrelated original text\r\nKeep these bytes.\r\n',a:source('initial'),loadCassette:loadPlaygroundCassette,loadProject:bytes=>createSidCodeProject().prepareImport(bytes)};
  fixture.cassette=Buffer.from(createPlaygroundCassetteZip([
    {path:A,type:'text',data:fixture.a},{path:B,type:'text',data:"export const NOTE='C4';\n"},{path:DATA,type:'text',data:'{"marker":"accepted data"}\n'},
    {path:SETUP,type:'text',data:fixture.setupText},{path:TONE,type:'text',data:fixture.voiceText},{path:'/notes.txt',type:'text',data:fixture.notes},{path:BIN,type:'binary',data:opaque},{path:'/sid/original.sid',type:'binary',data:song},
    {path:'/sid-synth.project.json',type:'text',data:JSON.stringify({format:'tetorica-sid-code-project',version:1,name:'Original SID v1',settings:setup,selectedPath:null,codeState:{mode:'keyboard',path:null}},null,2)+'\n'}
  ],{metadata:{title:'SID working/saved original fixture'},preserveMetadataFiles:true}));
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  const report={schemaVersion:1,root:config.root,entry:config.entry,editor:config.editor,scope:config.scope,physicalOutputMuted:true,listeningPerformed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,fixture));}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;}
  catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.error=error.stack??String(error);process.exitCode=1;console.error(report.error);}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,cdn,localMonaco:Object.fromEntries(localMonaco),checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
