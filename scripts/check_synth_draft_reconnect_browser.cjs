// SPDX-License-Identifier: BSD-3-Clause
// Real IndexedDB fault injection on an isolated, self-authored Synth project.
// No application hooks: close/abort native storage and use normal Files UI.
// Install gain zero before all application JS; Chromium is also muted.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os'),{pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'synth-draft-reconnect-browser.json'),screenshots:path.join(tmpdir(),'synth-draft-reconnect-images')};
for(const arg of process.argv.slice(2)){const m=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(m,'Unknown option '+arg);config[m[1]]=m[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DB='tetorica-fm2612-synth-drafts',PENDING='tetorica-fm2612-synth-pending-tone';
const served=new Map(),missing=[],external=[],httpErrors=[],expectedCdn=[],results=[];
async function until(test,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await wait(25);}throw Error('Timeout: '+label);}
const ready=page=>until(()=>page.locator('.synth-editor').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');

function installAudit({dbName,pendingKey}){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect;
  const contexts=[],gates=[];
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const gate=this.context.createGain();gate.gain.value=0;gates.push(gate);connect.call(this,gate,...args);connect.call(gate,destination);return destination;
  };
  const open=IDBFactory.prototype.open,transaction=IDBDatabase.prototype.transaction,close=IDBDatabase.prototype.close,put=IDBObjectStore.prototype.put;
  const connections=[],transactions=new WeakMap(),puts=[],commits=[],failures=[],rejections=[];
  let calls=0,closes=0,aborts=0,abortNext=false,holdNextOpen=false,held=null;
  window.addEventListener('unhandledrejection',event=>rejections.push(String(event.reason?.message??event.reason)));
  const state=()=>({opens:calls,connections:connections.length,closes,aborts,held:Boolean(held),puts:puts.slice(),commits:commits.slice(),failures:failures.slice(),rejections:rejections.slice(),audioContexts:contexts.length,physicalOutputMuted:gates.every(g=>g.gain.value===0)});
  IDBFactory.prototype.open=function(name,...args){
    const request=open.call(this,name,...args);if(name!==dbName)return request;calls++;
    request.addEventListener('success',event=>{
      if(!connections.includes(request.result))connections.push(request.result);
      if(holdNextOpen){holdNextOpen=false;held=request;event.stopImmediatePropagation();}
    });return request;
  };
  IDBDatabase.prototype.close=function(...args){if(this.name===dbName)closes++;return close.apply(this,args);};
  IDBDatabase.prototype.transaction=function(...args){
    let tx;try{tx=transaction.apply(this,args);}catch(error){if(this.name===dbName)failures.push({name:error.name,message:error.message});throw error;}
    if(this.name===dbName){const info={mode:args[1]??'readonly',generation:null};transactions.set(tx,info);
      tx.addEventListener('abort',()=>{aborts++;});
      tx.addEventListener('complete',()=>{if(info.mode==='readwrite'&&info.generation!==null)commits.push({...info,journal:localStorage.getItem(pendingKey)});});
    }return tx;
  };
  IDBObjectStore.prototype.put=function(value,...args){
    const relevant=this.name==='projects'&&this.transaction.db.name===dbName,info=transactions.get(this.transaction);
    if(relevant){const item={generation:value?.generation,activeTonePath:value?.activeTonePath,journal:localStorage.getItem(pendingKey)};puts.push(item);if(info)Object.assign(info,item);}
    const request=put.call(this,value,...args);
    if(relevant&&abortNext){abortNext=false;const tx=this.transaction;queueMicrotask(()=>{
      // Deliver the actual rollback event before closing its native handle.
      // Closing inside put() itself suppresses that event in WebKit.
      tx.addEventListener('abort',()=>tx.db.close(),{once:true});tx.abort();
    });}
    return request;
  };
  async function read(){
    return new Promise((resolve,reject)=>{
      const request=open.call(indexedDB,dbName,1);request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result,tx=transaction.call(db,'projects','readonly'),get=tx.objectStore('projects').get('current');
        tx.oncomplete=()=>{const value=get.result;close.call(db);resolve(value?{...value,project:{...value.project,files:value.project.files.map(file=>({...file,data:Array.from(typeof file.data==='string'?new TextEncoder().encode(file.data):file.data)}))}}:null);};
        tx.onabort=()=>{close.call(db);reject(tx.error??get.error);};
      };
    });
  }
  window.__draftReconnectAudit={state,read,
    closeCurrent(){const db=connections.at(-1);if(!db)throw Error('No draft connection');db.close();},
    versionChange(){return new Promise((resolve,reject)=>{
      // A real upgrade request notifies the app connection. Abort its upgrade
      // transaction so the existing version/schema/data remain unchanged.
      const request=open.call(indexedDB,dbName,2);
      request.onupgradeneeded=()=>request.transaction.abort();
      request.onerror=event=>{event.preventDefault();request.error?.name==='AbortError'?resolve():reject(request.error);};
      request.onblocked=()=>reject(Error('The app did not release its version-change connection'));
      request.onsuccess=()=>{close.call(request.result);reject(Error('Test upgrade unexpectedly committed'));};
    });},
    abortAndHold(){abortNext=true;holdNextOpen=true;},
    releaseOpen(){if(!held)throw Error('No held reopen');const request=held;held=null;request.onsuccess?.call(request,new Event('success'));},
    journal:()=>localStorage.getItem(pendingKey),
  };
}
const audit=page=>page.evaluate(()=>__draftReconnectAudit.state()),draft=page=>page.evaluate(()=>__draftReconnectAudit.read()),journal=page=>page.evaluate(()=>__draftReconnectAudit.journal());
const algorithm=page=>page.locator('#commonControls .param-value[aria-label="ALGO"]').textContent().then(Number);
async function editAlgorithm(page){const before=await algorithm(page);await page.locator('#commonControls .param-value[aria-label="ALGO"]').locator('..').locator('.param-button').nth(before<7?1:0).click();const after=await algorithm(page);assert.notEqual(after,before);return after;}
const file=(saved,name)=>saved.project.files.find(item=>item.path===name)?.data;
function assertStable(saved,stable){for(const[name,data]of stable)assert.deepEqual(file(saved,name),data,name+' preserved exactly');}
async function fixture(){
  const {createSynthProject}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_project.js')).href);
  const {createPcmPreset,PCM_ENCODING}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_pcm.js')).href);
  const project=createSynthProject(),fm={algorithm:1,feedback:2,operators:Array.from({length:4},(_,i)=>({dt:0,multi:i+1,tl:i===3?16:127,rs:0,ar:31,am:false,d1r:8,d2r:2,sl:5,rr:8,ssg:0}))};
  const tone=project.createTone(fm,'Reconnect FM'),pcm=project.createTone(createPcmPreset({sample:{name:'Reconnect PCM',sampleRate:16276.041666666666,encoding:PCM_ENCODING,data:Buffer.from(Uint8Array.from({length:4096},(_,i)=>128|(i*11%127))).toString('base64')},settings:{rootNote:60,volume:47,loopStart:2048,loopEnd:4096}}),'Reconnect PCM');
  project.fs.writeText('/notes/readme.txt','Self-authored storage fixture.\n日本語と binary data stay intact.\n');
  project.fs.writeText('/index.js','// Imported project must not execute itself.\ncontext.storageFixture = 42;\n');
  project.fs.writeBinary('/raw/support.bin',Uint8Array.from({length:257},(_,i)=>i%256));
  return {bytes:Buffer.from(project.exportCassette()),fmPath:tone.path,pcmPath:pcm.path,stablePaths:[pcm.path,'/notes/readme.txt','/index.js','/raw/support.bin']};
}

async function check(browser,name,origin,fixture){
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true,viewport:{width:1360,height:1000}}),page=await context.newPage(),errors=[],consoleErrors=[],checks=[];
  await context.addInitScript(installAudit,{dbName:DB,pendingKey:PENDING});page.setDefaultTimeout(25000);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!/monaco|loader.min.js|net::ERR_FAILED/i.test(message.text()))consoleErrors.push(message.text());});
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(url.hostname==='cdnjs.cloudflare.com'&&url.pathname.includes('monaco-editor')){expectedCdn.push(url.href);return route.abort();}external.push(url.href);return route.abort();});
  const step=text=>{checks.push(text);console.log(`CHECK ${name}: ${text}`);};
  async function durable(wanted){let saved;await until(async()=>{saved=await draft(page);return saved?.activeTonePath===fixture.fmPath&&file(saved,fixture.fmPath)?.[0]===wanted&&await journal(page)===null;},'latest draft committed');return saved;}
  try{
    await page.goto(origin+config.entry);await ready(page);await until(async()=>Boolean(await draft(page)),'initial draft');
    assert.equal((await audit(page)).audioContexts,0);
    await page.locator('#cassetteImportInput').setInputFiles({name:'draft-reconnect.cassette.zip',mimeType:'application/zip',buffer:fixture.bytes});
    await until(()=>page.locator('#status').textContent().then(text=>text==='Imported draft-reconnect.cassette.zip.'),'Cassette import');await ready(page);
    await page.locator('#presetSelect').selectOption('vfs:'+fixture.fmPath);await ready(page);
    let current=await algorithm(page),saved=await durable(current);const stable=fixture.stablePaths.map(name=>[name,file(saved,name)]);assert(stable.every(([,data])=>Array.isArray(data)));
    step('An isolated self-authored FM/PCM/text/binary project persists without initializing audio');

    const first=await audit(page);await page.evaluate(()=>__draftReconnectAudit.closeCurrent());current=await editAlgorithm(page);assert(await journal(page),'new tone immediately journaled');
    saved=await durable(current);assertStable(saved,stable);assert.equal(await algorithm(page),current,'reconnect must not restore an old sound');
    let state=await audit(page);assert(state.opens>first.opens);assert(state.failures.some(error=>error.name==='InvalidStateError'),'native closed-connection transaction reproduced');
    step('Native closing-connection InvalidStateError reopens and autosaves the live sound without replaying startup restoration');

    const beforeSync=await audit(page);await page.evaluate(()=>__draftReconnectAudit.closeCurrent());await page.locator('#synthFileSaveButton').click();
    await until(()=>page.locator('#status').textContent().then(text=>text===`Synced ${fixture.fmPath}.`),'Files Sync after closure');await ready(page);
    saved=await durable(current);assertStable(saved,stable);assert.equal(file(saved,'/.tet.ss'+fixture.fmPath)[0],current);assert((await audit(page)).opens>beforeSync.opens);
    step('Files Sync also recovers the closed connection and records its checkpoint');

    const beforeVersion=await audit(page);await page.evaluate(()=>__draftReconnectAudit.versionChange());assert((await audit(page)).closes>beforeVersion.closes);
    current=await editAlgorithm(page);saved=await durable(current);assertStable(saved,stable);assert((await audit(page)).opens>beforeVersion.opens);
    step('Version-change notification closes the old handle and later saves reconnect without deleting the database');

    await page.evaluate(()=>__draftReconnectAudit.abortAndHold());const older=await editAlgorithm(page),oldPending=await journal(page),oldGeneration=JSON.parse(oldPending).generation;
    await until(()=>audit(page).then(value=>value.held),'aborted transaction reopened and held');
    current=await editAlgorithm(page);const newestPending=await journal(page),newGeneration=JSON.parse(newestPending).generation;assert(newGeneration>oldGeneration);
    await wait(650);const waiting=await audit(page);assert(waiting.held);assert.equal((await draft(page)).project.files.find(item=>item.path===fixture.fmPath).data[0],saved.project.files.find(item=>item.path===fixture.fmPath).data[0],'aborted write rolled back');
    await page.evaluate(()=>__draftReconnectAudit.releaseOpen());saved=await durable(current);assertStable(saved,stable);
    state=await audit(page);const latestPuts=state.puts.filter(item=>item.generation>=oldGeneration),latestCommits=state.commits.filter(item=>item.generation>=oldGeneration);
    assert(latestPuts.filter(item=>item.generation===oldGeneration).length>=2,'aborted whole snapshot retried');assert(latestPuts.some(item=>item.generation===newGeneration&&item.journal===newestPending),'older completion must retain the newer recovery journal');
    assert.deepEqual(latestCommits.map(item=>item.generation),[oldGeneration,newGeneration],'complete retries and newer snapshot are serialized');assert(state.aborts>=1);
    step('A native transaction abort plus concurrent later edit retries in order and keeps the newest recovery journal until its own commit');

    const exercised=state;
    await page.reload();await ready(page);assert.equal(await algorithm(page),current);saved=await durable(current);assertStable(saved,stable);assert.equal(await journal(page),null);
    assert.equal((await page.locator('#synthActiveFilePath').textContent()).trim(),fixture.fmPath);await page.screenshot({path:path.join(config.screenshots,`${name}-reconnected.png`),fullPage:true});
    state=await audit(page);assert.equal(state.audioContexts,0,'storage/file operations never enable audio');assert(state.physicalOutputMuted);assert.deepEqual(state.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    step('Reload restores the newest FM setting and all PCM/text/binary bytes exactly, with no audio or unhandled errors');
    return{browser:name,passed:true,checks,nativeClosingErrors:exercised.failures,storageAudit:{opens:exercised.opens,connections:exercised.connections,closes:exercised.closes,aborts:exercised.aborts,puts:exercised.puts,commits:exercised.commits},finalAlgorithm:current,restoredFileCount:saved.project.files.length,stableFiles:stable.map(([name,data])=>({path:name,bytes:data.length,sha256:hash(Buffer.from(data))})),audioContexts:state.audioContexts,physicalOutputMuted:state.physicalOutputMuted,errors,consoleErrors};
  }catch(error){error.caseResult={browser:name,passed:false,checks,failure:error.stack??String(error),audit:await audit(page).catch(()=>null),status:await page.locator('#status').textContent().catch(()=>null),errors,consoleErrors};throw error;}
  finally{await context.close();}
}
const server=http.createServer(async(request,response)=>{
  try{const url=new URL(request.url,'http://local'),pathname=decodeURIComponent(url.pathname),file=path.resolve(config.root,'.'+pathname);if(!file.startsWith(config.root+path.sep))throw Error('Outside package');
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const bytes=await fs.readFile(file),name=path.relative(config.root,file),record={bytes:bytes.length,sha256:hash(bytes)};if(served.has(name))assert.deepEqual(record,served.get(name));served.set(name,record);
    response.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'}[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch(error){missing.push(request.url);response.writeHead(404).end(String(error));}
});
(async()=>{
  const source=await fixture();await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  const report={schemaVersion:1,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,source));}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;}
  catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.failure=error.stack??String(error);console.error(report.failure);process.exitCode=1;}
  finally{await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,httpErrors,expectedCdn,servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);process.exitCode=1;});
