// SPDX-License-Identifier: BSD-3-Clause
// Real HuC6280 working/saved checks. Every physical destination is muted before
// app startup; numeric PCM and native state are observations, not listening.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const {selectHucChannel}=require('./huc6280_channel_browser_helpers.cjs');
const repo=path.resolve(__dirname,'..');
const config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',editor:'fallback',scope:'full',
  out:path.join(tmpdir(),'huc6280-working-saved.json'),screenshots:path.join(tmpdir(),'huc6280-working-saved')};
for(const arg of process.argv.slice(2)){
  const match=/^--(root|entry|engines|editor|scope|out|screenshots)=(.+)$/.exec(arg);
  assert(match,'Unknown argument '+arg);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);
assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
assert(['fallback','monaco'].includes(config.editor));assert(['full','files','layout'].includes(config.scope));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=value=>createHash('sha256').update(value).digest('hex'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=25000){
  const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(35);}throw Error('Timeout: '+label);
}
const served=new Map(),missing=[],external=[],cdn=[],results=[];
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
const A='/index.js',B='/other.js',TONE='/presets/Manual.huc6280.json',BIN='/opaque/keep.bin',SONG='/vgm/original.vgm';
const DB='tetorica-huc6280-synth-files',JOURNAL='tetorica-huc6280-synth-pending-code';
const source=label=>`// Working/saved fixture: ${label}.\nglobalThis.__hucWorkingMustNotRun=${JSON.stringify(label)};\n`;
const same=(a,b)=>a===undefined||b===undefined?a===b:Buffer.from(typeof a==='string'?a:a??[]).equals(Buffer.from(typeof b==='string'?b:b??[]));
const contentHash=data=>data?.sha256??hash(Buffer.from(data));
const layer=(value,version)=>value?.workspace?.[version];
const file=(value,version,name)=>layer(value,version)?.files.find(file=>file.path===name)?.data;
const text=(value,version,name)=>{const data=file(value,version,name);return data===undefined?undefined:Buffer.from(data).toString('utf8');};
function compactDraft(value){
  if(!value)return value;
  const compact=snapshot=>snapshot?{...snapshot,files:snapshot.files?.map(file=>{
    if(file.data?.sha256)return file;
    const data=Buffer.from(file.data);
    return data.length<=16384?file:{...file,data:{bytes:data.length,sha256:hash(data)}};
  })}:snapshot;
  return{...value,filesystem:compact(value.filesystem),workspace:value.workspace?{...value.workspace,
    working:compact(value.workspace.working),saved:compact(value.workspace.saved)}:undefined};
}

function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,put=IDBObjectStore.prototype.put;
  const contexts=[],nodes=[],meters=[],failures=[],rejections=[];let request=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
  };
  IDBObjectStore.prototype.put=function(value,...args){
    if(this.transaction.db.name==='tetorica-huc6280-synth-files'&&localStorage.getItem('__hucWorkingQuota')==='1'){
      failures.push('QuotaExceededError');throw new DOMException('Synthetic draft quota failure','QuotaExceededError');
    }
    return put.call(this,value,...args);
  };
  window.addEventListener('unhandledrejection',event=>rejections.push(String(event.reason?.stack??event.reason)));
  function sample({analyser,mute}){
    const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);
    let sum=0,square=0,peak=0,finite=true;const crossings=[];
    for(let i=0;i<values.length;i++){
      sum+=values[i];square+=values[i]*values[i];peak=Math.max(peak,Math.abs(values[i]));finite&&=Number.isFinite(values[i]);
      if(i&&values[i-1]<=0&&values[i]>0)crossings.push(i);
    }
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2)),peak,finite,
      frequency:crossings.length>2?analyser.context.sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]):0,muted:mute.gain.value===0};
  }
  async function read(method='read',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-huc6280-synth')?.node;
    if(!node)throw Error('HuC6280 editor Worklet missing');const id=--request;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Native audit read timed out'));},5000);
      function receive({data}){
        if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);
        data.error?reject(Error(data.error)):resolve(data.value);
      }
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});
    });
  }
  window.__hucWorkingAudit={read,output:()=>meters.map(sample).sort((a,b)=>b.acRms-a.acRms)[0]??null,
    failDrafts:value=>value?localStorage.setItem('__hucWorkingQuota','1'):localStorage.removeItem('__hucWorkingQuota'),
    state:()=>({contexts:contexts.length,worklets:nodes.filter(item=>item.name==='tetorica-huc6280-synth').length,
      physicallyMuted:meters.every(item=>item.mute.gain.value===0),failures:failures.slice(),rejections:rejections.slice()})};
}
async function draft(page){
  return page.evaluate(name=>new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');
      tx.oncomplete=async()=>{
        const value=read.result;db.close();
        for(const snapshot of [value?.filesystem,value?.workspace?.working,value?.workspace?.saved])if(snapshot?.files)
          snapshot.files=await Promise.all(snapshot.files.map(async file=>{
            if(typeof file.data==='string')return file;
            const bytes=file.data instanceof ArrayBuffer?new Uint8Array(file.data):file.data;
            // Large binary fixtures exercise persistence, not DevTools JSON
            // transfer. Hash them in-page rather than shipping megabyte arrays
            // on every state poll and stalling the UI thread under test.
            const data=bytes.byteLength>16384?{bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join('')}:Array.from(bytes);
            return{...file,data};
          }));
        resolve(value??null);
      };
      tx.onabort=()=>{db.close();reject(tx.error??read.error);};
    };
  }),DB);
}
const hold=`const pce=await useSoundChip('huc6280');
context.boots=(context.boots??0)+1;
const prepared=await livePrepare('saved-hold',()=>({visits:0}));
globalThis.__hucWorkingProbe={pce,context,prepared,ticks:0};
await pce.noteOn(CH1,'A3');
liveLoop('saved-hold',async()=>{__hucWorkingProbe.ticks++;prepared.visits++;await beat(.05);});
`;
const melody=`const {NOTE}=await import('./other.js');
const data=await file('./data.json',{type:'json'});
const pce=await useSoundChip('huc6280');
context.applies=(context.applies??0)+1;
globalThis.__hucWorkingMelody={pce,context,note:NOTE,marker:data.marker,ticks:0};
await pce.noteOn(CH1,NOTE);
liveLoop('saved-melody',async()=>{__hucWorkingMelody.ticks++;await beat(.2);});
`;

async function check(browser,name,origin,fixture){
  const context=await browser.newContext({viewport:{width:1360,height:1050},serviceWorkers:'block',acceptDownloads:true});
  const page=await context.newPage(),checks=[],measurements={},errors=[],consoleErrors=[],rawConsoleErrors=[],expectedConsoleErrors=[],cdnFailures=[],abortedMonaco=new Set();
  page.setDefaultTimeout(25000);await context.addInitScript(installAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{
    if(message.type()==='error')rawConsoleErrors.push({text:message.text(),location:message.location()});
  });
  function classifyConsoleErrors(){
    consoleErrors.length=0;expectedConsoleErrors.length=0;
    for(const error of rawConsoleErrors){
      // Only the exact CDN requests deliberately aborted by this fallback test
      // may fail. Local resource errors and all real Monaco errors are failures.
      const expected=config.editor==='fallback'&&isMonaco(error.location.url)&&abortedMonaco.has(error.location.url)&&
        /^Failed to load resource(?::|$)/i.test(error.text);
      (expected?expectedConsoleErrors:consoleErrors).push(error);
    }
  }
  page.on('requestfailed',request=>{if(isMonaco(request.url()))cdnFailures.push(request.url());});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    if(isMonaco(url.href)){cdn.push(url.href);if(config.editor==='monaco')return route.continue();abortedMonaco.add(url.href);return route.abort();}
    external.push(url.href);return route.abort();
  });
  const step=message=>{checks.push(message);console.log(`CHECK ${name}/${config.editor}: ${message}`);};
  const ready=()=>until(()=>page.locator('#hucFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');
  const row=name=>page.locator('#hucFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(name)}]`);
  async function openFiles(){
    if(!await page.locator('#hucFilesPanel').isVisible())await page.locator('#hucFilesToggle').click();
    for(let n=0;n<30;n++){const closed=page.locator('#hucFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  }
  async function select(name,{force=false}={}){
    await openFiles();if(force||await row(name).getAttribute('aria-current')!=='true')await row(name).click();await ready();
    await until(()=>page.locator('#hucFilesSelected').textContent().then(value=>value===name),'Selected '+name);
  }
  async function dot(name,value){
    await openFiles();await until(async()=>value?await row(name).locator('.huc-file-unsaved').count()>0:await row(name).locator('.huc-file-unsaved').count()===0,'Dirty dot '+name+'='+value);
    if(value){const marker=row(name).locator('.huc-file-unsaved');assert.equal((await marker.textContent()).trim(),'●');assert.equal(await marker.getAttribute('aria-label'),'Unsaved changes');}
  }
  async function auto(value){
    const toggle=page.locator('#hucAutoApplyToggle');if(await toggle.isChecked()!==value)await toggle.setChecked(value);
    await ready();await until(()=>draft(page).then(snapshot=>snapshot?.workspace?.autoSave===value),'Auto apply '+value);
    assert(await page.evaluate(()=>document.activeElement?.id!=='hucAutoApplyToggle'),'Auto apply releases performance focus');
  }
  async function editorReady(){
    await until(()=>page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))||
      /Fallback|unavailable|could not load/i.test(document.getElementById('synthCodeEditorNote').textContent)),'Editor initialization',60000);
    const actual=await page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))));
    if(config.editor==='monaco'&&!actual){const error=Error('Real Monaco unavailable');error.cdnUnavailable=Boolean(cdnFailures.length);throw error;}
    assert.equal(actual,config.editor==='monaco');
  }
  const currentSource=()=>page.evaluate(()=>window.monaco?.editor?.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))?.getValue()??document.getElementById('synthCodeEditor').value);
  async function edit(name,value){
    await select(name,{force:true});await page.locator('#synthInputCodeTab').click();await editorReady();
    if(config.editor==='fallback')await page.locator('#synthCodeEditor').fill(value);
    else await page.evaluate(value=>monaco.editor.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).setValue(value),value);
    assert.equal(await currentSource(),value);
  }
  async function durable(name,working,saved){
    let value;await until(async()=>{value=await draft(page);return same(file(value,'working',name),working)&&same(file(value,'saved',name),saved);},'Both layers durable '+name);return value;
  }
  async function save(name,shortcut){
    if(name)await select(name);
    if(shortcut)await page.keyboard.press(shortcut);else await page.locator('#hucFileSaveButton').click();await ready();
    if(name){await dot(name,false);if(!await page.evaluate(()=>localStorage.getItem('__hucWorkingQuota')==='1'))
      await until(()=>draft(page).then(value=>same(file(value,'working',name),file(value,'saved',name))),'Saved '+name);}
  }
  async function saveAll(){await page.locator('#hucFileSaveAllButton').click();await ready();await until(()=>page.locator('#hucFilesTree .huc-file-unsaved').count().then(count=>count===0),'Save all clears dots');}
  async function importFixture(data=fixture.cassette){
    const previous=(await draft(page))?.workspaceId;
    await page.locator('#hucProjectFileInput').setInputFiles({name:'working-saved.cassette.zip',mimeType:'application/zip',buffer:data});await ready();
    await until(()=>draft(page).then(value=>value?.workspace?.version===1&&value.workspaceId!==previous),'New two-version workspace durably restored');await ready();await openFiles();
  }
  async function exportCassette(){
    if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
    const pending=page.waitForEvent('download');await page.locator('#hucProjectExportButton').click();const item=await pending,chunks=[];
    for await(const chunk of await item.createReadStream())chunks.push(chunk);assert.equal(await item.failure(),null);
    const data=Buffer.concat(chunks);return{data,cassette:await fixture.loadCassette(data),snapshot:await fixture.loadProject(data)};
  }
  async function level(value){
    const field=page.locator('#volume');await field.scrollIntoViewIfNeeded();
    for(let i=0;i<32;i++){const current=Number(await field.textContent());if(current===value)return;
      await page.locator(`[data-stepper-for="volume"][data-stepper-delta="${value>current?1:-1}"]`).click();}
    assert.equal(Number(await field.textContent()),value);
  }
  async function audio(){
    await pause(220);const value=await page.evaluate(()=>__hucWorkingAudit.output());assert(value?.muted&&value.finite);return value;
  }
  const read=(method='read')=>page.evaluate(method=>__hucWorkingAudit.read(method),method);
  async function stablePitch(hz,tolerance=4){
    await until(async()=>{const value=await page.evaluate(()=>__hucWorkingAudit.output());return value?.finite&&value.muted&&value.acRms>1e-5&&Math.abs(value.frequency-hz)<tolerance;},'PCM settles at '+hz+' Hz');return audio();
  }
  async function run(apply=false){
    await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();
    await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Playing|Running/.test(await page.locator('#synthCodeState').textContent());},'Code '+(apply?'Apply':'Run'));
  }
  async function stop(){
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stopped');
    await until(async()=>{const value=await page.evaluate(()=>__hucWorkingAudit.output());return !value||value.peak<1e-7;},'Code silence');
  }
  async function running(){
    const before=await page.evaluate(()=>__hucWorkingProbe.ticks);await pause(100);assert((await page.evaluate(()=>__hucWorkingProbe.ticks))>before);
    assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
  }
  const noExecution=async()=>{assert.equal(await page.evaluate(()=>globalThis.__hucWorkingMustNotRun),undefined);assert.equal((await page.evaluate(()=>__hucWorkingAudit.state())).contexts,0);};
  function versionsEqual(actual,expected){
    for(const version of ['working','saved']){
      const normalized=value=>layer(value,version).files.map(file=>({path:file.path,type:file.type,sha256:contentHash(file.data)})).sort((a,b)=>a.path.localeCompare(b.path));
      assert.deepEqual(normalized(actual),normalized(expected),version+' files');assert.deepEqual(layer(actual,version).directories,layer(expected,version).directories);
    }
    assert.equal(actual.workspace.autoSave,expected.workspace.autoSave);assert.deepEqual(actual.settings,expected.settings);assert.deepEqual(actual.savedSettings,expected.savedSettings);
  }
  async function screenshot(label,width){
    await page.setViewportSize({width,height:1050});await pause(700);
    const inspect=()=>page.evaluate(()=>({viewport:innerWidth,elements:['body','main','#synthWorkspace','#hucSynthMain','#hucFilesPanel','#synthCodePanel','#synthCodeEditorHost','#synthExpandedCodeSlot'].flatMap(selector=>{
      const node=document.querySelector(selector),rect=node?.getBoundingClientRect();return rect?.width&&rect.height?[{selector,width:rect.width,left:rect.left,right:rect.right,client:node.clientWidth,scroll:node.scrollWidth}]:[];
    })}));
    function check(value){for(const node of value.elements){assert(node.width<=width+1&&node.left>=-1&&node.right<=width+1,label+' stays inside viewport: '+JSON.stringify(node));if(['body','main'].includes(node.selector))assert(node.scroll<=node.client+1,label+' has no masked page overflow: '+JSON.stringify(node));}}
    const before=await inspect();check(before);const filename=path.join(config.screenshots,`${name}-${config.editor}-${label}-${width}.png`);
    await page.screenshot({path:filename,fullPage:true});await pause(80);const after=await inspect();check(after);return{filename,before,after};
  }
  async function finalAudit(){
    classifyConsoleErrors();
    measurements.audit=await page.evaluate(()=>__hucWorkingAudit.state());assert(measurements.audit.physicallyMuted);
    assert.deepEqual(measurements.audit.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  }
  try{
    await page.goto(origin+config.entry);await ready();await openFiles();assert(await page.locator('#hucAutoApplyToggle').isChecked());
    await importFixture();await edit(A,source('auto'));await durable(A,source('auto'),source('auto'));await dot(A,false);await noExecution();
    await auto(false);await edit(A,source('manual A'));await durable(A,source('manual A'),source('auto'));await dot(A,true);
    await edit(B,"export const NOTE='G4';\n");await dot(B,true);await save(A,'Control+s');await dot(B,true);
    await saveAll();await durable(B,"export const NOTE='G4';\n","export const NOTE='G4';\n");
    await edit(A,source('Meta save'));await save(A,'Meta+s');await durable(A,source('Meta save'),source('Meta save'));await noExecution();
    step('Auto apply defaults On; manual files show dots, current Save/Control+S/Meta+S and Save all accept only intended data without execution');

    await edit(A,source('pending'));await durable(A,source('pending'),source('Meta save'));await dot(A,true);
    const portable=await exportCassette();assert.equal(Buffer.from(portable.cassette.files.get('index.js')).toString('utf8'),source('Meta save'));
    assert(Buffer.from(portable.cassette.files.get(BIN.slice(1))).equals(Buffer.from(fixture.opaque)),'Original binary bytes survive export');
    assert.equal(portable.data.length<fixture.opaque.length+512*1024,true,'Unchanged binary data is not duplicated for recovery');
    assert(same(file(portable.snapshot,'working',A),source('pending')));assert(same(file(portable.snapshot,'saved',A),source('Meta save')));
    await importFixture(portable.data);await durable(A,source('pending'),source('Meta save'));await page.reload();await ready();
    await select(A);await page.locator('#synthInputCodeTab').click();await editorReady();assert.equal(await currentSource(),source('pending'));await dot(A,true);
    await page.locator('#hucFileDiscardButton').click();await ready();await durable(A,source('Meta save'),source('Meta save'));assert.equal(await currentSource(),source('Meta save'));
    await edit(A,source('layout pending'));await durable(A,source('layout pending'),source('Meta save'));await dot(A,true);
    measurements.layouts=[];for(const width of [1360,390])measurements.layouts.push(await screenshot('manual-Files',width));await page.setViewportSize({width:1360,height:1050});
    await noExecution();step('Saved files and working differences survive Cassette/reload independently; Discard restores accepted source and layouts fit with keyboard focus intact');
    if(config.scope!=='files'){
      await page.locator('#synthCodeExpandButton').click();for(const width of [1360,390])measurements.layouts.push(await screenshot('expanded-Code',width));
      await page.locator('#synthCodeExpandButton').click();for(const width of [390,1360])measurements.layouts.push(await screenshot('restored-Code',width));
      await noExecution();step('Maximize/restore retains both files and settled mobile/desktop editor sizing');
      if(config.scope==='layout'){
        await finalAudit();
        return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
      }
    }
    if(config.scope==='files'){await finalAudit();return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};}

    await importFixture();await auto(false);await select(TONE);await edit(A,hold);await save(A);await run();await select(TONE);await selectHucChannel(page,'synth');
    await page.evaluate(async()=>{const p=__hucWorkingProbe.pce;await p.noteOn(0,'A3');await p.setFrequency(0,329.63);await p.setPan(0,13,14);globalThis.__hucWorkingIdentity=__hucWorkingProbe;});
    measurements.beforeSave=await stablePitch(329.63);const beforeHardware=await read('observeCode');assert.equal(beforeHardware.registers[0][4]&31,fixture.preset.volume);
    await level(12);await dot(TONE,true);await running();measurements.manual=await audio();const manualHardware=await read('observeCode');
    assert.equal(manualHardware.registers[0][4]&31,beforeHardware.registers[0][4]&31);assert(Math.abs(measurements.manual.acRms/measurements.beforeSave.acRms-1)<.06);
    await save(TONE);await running();await until(async()=>(await read('observeCode')).registers[0][4]%32===12,'Accepted level reaches sounding Code');
    measurements.saved=await stablePitch(329.63);const savedHardware=await read('observeCode');
    assert.equal(savedHardware.registers[0][5],beforeHardware.registers[0][5],'Save keeps Code-owned packed pan');assert.equal(savedHardware.registers[0][2],beforeHardware.registers[0][2]);assert.equal(savedHardware.registers[0][3],beforeHardware.registers[0][3]);
    assert(measurements.saved.acRms<measurements.beforeSave.acRms*.65,'Accepted lower volume changes actual rendered PCM');
    assert(await page.evaluate(()=>__hucWorkingProbe===__hucWorkingIdentity),'Save retains Code identity');
    measurements.beforeWave=await audio();
    const canvas=page.locator('#waveCanvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.3,box.y+box.height*.25);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.7,{steps:8});await page.mouse.up();await dot(TONE,true);
    let drawn;await until(async()=>{drawn=await draft(page);return JSON.stringify(JSON.parse(text(drawn,'working',TONE)).wave)!==JSON.stringify(JSON.parse(text(drawn,'saved',TONE)).wave);},'Drawn working wave durable');
    assert.notDeepEqual(JSON.parse(text(drawn,'working',TONE)).wave,JSON.parse(text(drawn,'saved',TONE)).wave);assert.deepEqual((await read('observeCode')).waveforms[0],savedHardware.waveforms[0]);
    measurements.unsavedWave=await audio();assert(Math.abs(measurements.unsavedWave.acRms/measurements.beforeWave.acRms-1)<.06,'Pending drawing leaves actual PCM unchanged');
    await save(TONE);await running();await until(async()=>JSON.stringify((await read('observeCode')).waveforms[0])===JSON.stringify(JSON.parse(text(await draft(page),'saved',TONE)).wave),'Accepted drawing reaches same held voice');
    assert((await read('observeCode')).registers[0][4]&128,'Drawing leaves held gate active');
    measurements.savedWave=await audio();assert(Math.abs(measurements.savedWave.acRms/measurements.beforeWave.acRms-1)>.05,'Accepted drawing changes actual held-voice PCM');await stop();
    step('Unsaved level and Wave edits leave sounding Code untouched; Save changes only intended fields and keeps note, frequency, pan, context and loops');

    await select(TONE);let sound=JSON.parse(text(await draft(page),'working',TONE));sound.volume=9;const valid=JSON.stringify(sound,null,2)+'\n';await edit(TONE,valid);await dot(TONE,true);
    await until(()=>page.locator('#volume').textContent().then(value=>Number(value)===9),'JSON edits update author controls');
    assert.notEqual((await read()).preset.volume,9,'Manual valid JSON has not reached the renderer');await save(TONE);await until(async()=>(await read()).preset.volume===9,'Saved JSON applied');
    const invalid='{ "format":';await edit(TONE,invalid);await dot(TONE,true);await save(TONE);assert.equal(await currentSource(),invalid);assert.equal((await read()).preset.volume,9,'Invalid saved text keeps last playable sound');
    await page.locator('[data-stepper-for="volume"][data-stepper-delta="-1"]').click();await pause(100);
    assert.equal(await currentSource(),invalid,'Knob edit cannot overwrite unfinished JSON');assert.equal((await read()).preset.volume,9);
    assert.equal(Number(await page.locator('#volume').textContent()),9,'Rejected knob edit restores the last valid author controls');
    sound.volume=7;const repaired=JSON.stringify(sound,null,2)+'\n';await edit(TONE,repaired);await save(TONE);await until(async()=>(await read()).preset.volume===7,'Repaired JSON applied');
    await auto(true);sound.volume=10;const immediate=JSON.stringify(sound,null,2)+'\n';await edit(TONE,immediate);await durable(TONE,immediate,immediate);await until(async()=>(await read()).preset.volume===10,'Valid auto JSON applied');await auto(false);
    step('Preset JSON and knobs share the active document; incomplete text survives Save and attempted knob edits while the last playable sound is retained');

    await edit(B,"export const NOTE='C4';\n");await save(B);await edit(A,melody);await save(A);await run();await until(()=>page.evaluate(()=>__hucWorkingMelody?.note==='C4'),'Saved entry and module execute');
    measurements.c4=await stablePitch(261.63);await edit(B,"export const NOTE='G4';\n");await select(A);await run(true);assert.equal(await page.evaluate(()=>__hucWorkingMelody.note),'C4','Apply uses saved module');
    const count=await page.evaluate(()=>__hucWorkingMelody.context.applies);await save(B);assert.equal(await page.evaluate(()=>__hucWorkingMelody.note),'C4');assert.equal(await page.evaluate(()=>__hucWorkingMelody.context.applies),count,'Module Save never executes');
    await select(A);await run(true);await until(()=>page.evaluate(()=>__hucWorkingMelody.note==='G4'),'Explicit Apply updates module');measurements.g4=await stablePitch(392);
    await edit('/data.json','{"marker":"pending data"}\n');await select(A);await run(true);
    assert.equal(await page.evaluate(()=>__hucWorkingMelody.marker),'accepted data','Apply reads saved local data');
    await save('/data.json');assert.equal(await page.evaluate(()=>__hucWorkingMelody.marker),'accepted data','Data Save never executes');
    await select(A);await run(true);assert.equal(await page.evaluate(()=>__hucWorkingMelody.marker),'pending data');
    await edit(A,source('unaccepted source'));await run(true);assert.equal(await page.evaluate(()=>__hucWorkingMelody.note),'G4','Apply still uses saved entry');assert.equal(await page.evaluate(()=>globalThis.__hucWorkingMustNotRun),undefined);await stop();
    step('Run/Apply reads saved entry, imported modules and data; editing and saving source never executes it or replaces the existing program');

    await edit(A,source('pending New'));await edit(B,"export const NOTE='D4';\n");const before=await durable(B,"export const NOTE='D4';\n","export const NOTE='G4';\n");
    if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();await page.locator('#hucProjectNewButton').click();await page.locator('#hucNewCassetteCreate').click();await page.locator('#hucNewCassetteDialog').waitFor({state:'hidden'});await ready();
    await page.locator('#hucFileUndoButton').click();await ready();await until(async()=>same(file(await draft(page),'working',A),source('pending New')),'Undo New restores draft');versionsEqual(await draft(page),before);
    await importFixture();await page.locator('#hucFileUndoButton').click();await ready();await until(async()=>same(file(await draft(page),'working',A),source('pending New')),'Undo import restores draft');versionsEqual(await draft(page),before);
    await select(B);await page.locator('#hucFileRenameButton').click();await page.locator('#hucFileNameInput').fill('/renamed.js');await page.locator('#hucFileNameConfirm').click();await ready();await dot('/renamed.js',true);
    await page.locator('#hucFileDiscardButton').click();await ready();await until(()=>row(B).count().then(count=>count===1),'Discard rename restores original path');await dot(B,false);await page.locator('#hucFileUndoButton').click();await ready();await dot('/renamed.js',true);
    await save('/renamed.js');await until(async()=>file(await draft(page),'saved',B)===undefined&&file(await draft(page),'saved','/renamed.js')!==undefined,'Save rename commits creation and deletion');
    const removeRenamed=async()=>{
      await select('/renamed.js');await page.locator('#hucFileDeleteButton').click();await page.locator('#hucFileNameConfirm').click();
      await until(()=>row('/renamed.js').count().then(count=>count===0),'Deleted working path disappears');await ready();
    };
    await removeRenamed();await until(async()=>file(await draft(page),'working','/renamed.js')===undefined&&file(await draft(page),'saved','/renamed.js')!==undefined,'Manual deletion keeps saved file');
    await page.locator('#hucFileUndoButton').click();await ready();await until(()=>row('/renamed.js').count().then(count=>count===1),'Undo deletion restores the logical file');
    await removeRenamed();await saveAll();await until(async()=>file(await draft(page),'saved','/renamed.js')===undefined,'Save all accepts deletion');
    step('Undo preserves both layers through New/import; rename and deletion commit the intended logical paths atomically');

    await importFixture();await page.locator('#hucSongSelect').selectOption(SONG);await page.locator('#hucSongPlayButton').click();await until(()=>page.locator('#hucSongPlayer').getAttribute('data-state').then(value=>value==='playing'),'VGM playing');
    await page.locator('#hucSongPlayButton').click();await until(()=>page.locator('#hucSongPlayer').getAttribute('data-state').then(value=>value==='paused'),'VGM paused');await selectHucChannel(page,0);
    const paused=await page.locator('#hucSongPlayer').getAttribute('data-position-frames');await select(TONE,{force:true});await until(()=>page.locator('#hucChannelSelect').inputValue().then(value=>value==='synth'),'Paused preset selection completes');assert.equal(await page.locator('#hucSongPlayer').getAttribute('data-state'),'paused');assert.equal(await page.locator('#hucSongPlayer').getAttribute('data-position-frames'),paused);assert.equal(await page.locator('#hucChannelSelect').inputValue(),'synth');
    await page.locator('#hucSongPlayButton').click();await until(()=>page.locator('#hucSongPlayer').getAttribute('data-state').then(value=>value==='playing'),'VGM resumes');await selectHucChannel(page,0);await select(TONE,{force:true});await until(()=>page.locator('#hucChannelSelect').inputValue().then(value=>value==='synth'),'Playing preset selection completes');assert.equal(await page.locator('#hucSongPlayer').getAttribute('data-state'),'playing');assert.equal(await page.locator('#hucChannelSelect').inputValue(),'synth');await page.locator('#hucSongStopButton').click();
    step('Choosing a preset from a physical reference CH returns to Auto and keeps VGM Play/Pause and the paused position');

    await auto(false);await edit(A,source('quota working'));await durable(A,source('quota working'),fixture.a);await page.evaluate(()=>__hucWorkingAudit.failDrafts(true));
    const accepted=source('quota accepted');await edit(A,accepted);await until(()=>page.evaluate(()=>__hucWorkingAudit.state().failures.length>0),'Real IDB failure');await save(A);assert.match(await page.locator('#hucFilesStatus').textContent(),/save|storage|export/i);
    const emergency=await exportCassette();assert.equal(Buffer.from(emergency.cassette.files.get('index.js')).toString('utf8'),accepted);assert.equal(text(await draft(page),'saved',A),fixture.a,'Durable accepted bytes remain old under quota');
    measurements.codeJournal=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),JOURNAL);assert.equal(measurements.codeJournal.source,accepted);assert.equal(measurements.codeJournal.savedSource,accepted);assert.equal(measurements.codeJournal.autoSave,false);
    await level(20);await dot(TONE,true);
    measurements.soundJournal=await page.evaluate(()=>JSON.parse(localStorage.getItem('tetorica-huc6280-synth-pending-sound-v2')));
    assert.equal(JSON.parse(measurements.soundJournal.workingText).volume,20);
    assert.equal(JSON.parse(measurements.soundJournal.savedText).volume,fixture.preset.volume);assert.equal(measurements.soundJournal.autoSave,false);
    await page.reload();await ready();await select(A);await page.locator('#synthInputCodeTab').click();await editorReady();assert.equal(await currentSource(),accepted);await dot(A,false);assert(!await page.locator('#hucAutoApplyToggle').isChecked());
    await dot(TONE,true);assert.equal(Number(await page.locator('#volume').textContent()),20);
    const restored=await exportCassette();assert.equal(Buffer.from(restored.cassette.files.get('index.js')).toString('utf8'),accepted);
    assert.equal(JSON.parse(text(restored.snapshot,'working',TONE)).volume,20);assert.equal(JSON.parse(text(restored.snapshot,'saved',TONE)).volume,fixture.preset.volume);
    await page.evaluate(()=>__hucWorkingAudit.failDrafts(false));await save(A,'Control+s');await durable(A,accepted,accepted);await noExecution();
    await finalAudit();step('Quota failure keeps accepted/working source recoverable and exportable; reload restores both without starting audio or executing source');
    return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
  }catch(error){
    classifyConsoleErrors();
    error.caseResult={browser:name,editor:config.editor,passed:false,checks,measurements,error:error.stack??String(error),cdnUnavailable:error.cdnUnavailable,
      status:await page.locator('#audioStatus').textContent().catch(()=>null),filesStatus:await page.locator('#hucFilesStatus').textContent().catch(()=>null),
      codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),source:await currentSource().catch(()=>null),draft:compactDraft(await draft(page).catch(()=>null)),
      audit:await page.evaluate(()=>__hucWorkingAudit.state()).catch(()=>null),errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
    await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-failed.png`),fullPage:true}).catch(()=>{});throw error;
  }finally{await context.close();}
}

function makeVgm(wave){
  const write=(r,v)=>[0xb9,r,v],upload=ch=>[...write(0,ch),...write(4,64),...write(4,0),...wave.flatMap(v=>write(6,v)),...write(5,255),...write(2,254),...write(3,0),...write(4,152)];
  const commands=[...write(1,255),...write(9,0),...upload(0),...upload(1)];let frames=44100*8;
  while(frames){const count=Math.min(65535,frames);commands.push(0x61,count&255,count>>8);frames-=count;}commands.push(0x66);
  const data=Buffer.alloc(256+commands.length);data.write('Vgm ');data.writeUInt32LE(data.length-4,4);data.writeUInt32LE(0x171,8);data.writeUInt32LE(44100*8,0x18);data.writeUInt32LE(0xcc,0x34);data.writeUInt32LE(3579545,0xa4);data.set(commands,256);return data;
}
(async()=>{
  const [{createPlaygroundCassetteZip,loadPlaygroundCassette},{createDefaultPreset},{PC_ENGINE_CODE_EXAMPLES},{createHuc6280CodeProject}]=await Promise.all([
    import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js'))),import(pathToFileURL(path.join(repo,'docs/synth-huc6280/preset.js'))),
    import(pathToFileURL(path.join(repo,'docs/synth-huc6280/cdrom2_examples.js'))),import(pathToFileURL(path.join(repo,'docs/synth-huc6280/code_project.js')))]);
  const preset=createDefaultPreset();preset.name='Manual';preset.envelope.enabled=false;
  const opaque=Uint8Array.from({length:1024*1024},(_,i)=>(i*73+Math.floor(i/13))&255);
  const fixture={preset,opaque,a:source('initial'),loadCassette:loadPlaygroundCassette,
    loadProject:async bytes=>createHuc6280CodeProject().prepareImport(bytes)};
  fixture.cassette=Buffer.from(createPlaygroundCassetteZip([
    {path:A,type:'text',data:fixture.a},{path:B,type:'text',data:"export const NOTE='C4';\n"},{path:TONE,type:'text',data:JSON.stringify(preset,null,2)+'\n'},
    {path:'/data.json',type:'text',data:'{"marker":"accepted data"}\n'},{path:BIN,type:'binary',data:opaque},{path:SONG,type:'binary',data:makeVgm(preset.wave)},
    ...Object.entries(PC_ENGINE_CODE_EXAMPLES).map(([path,data])=>({path,type:'text',data}))],{metadata:{title:'Working/saved original fixture'}}));
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const report={schemaVersion:1,root:config.root,entry:config.entry,editor:config.editor,scope:config.scope,physicalOutputMuted:true,listeningPerformed:false,results};
  try{
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin,fixture));}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;
  }catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.error=error.stack??String(error);process.exitCode=error.cdnUnavailable?2:1;console.error(report.error);}
  finally{
    server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));
    Object.assign(report,{missing,external,cdn,checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
