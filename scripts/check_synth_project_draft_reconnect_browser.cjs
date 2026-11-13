// SPDX-License-Identifier: BSD-3-Clause
// Real storage fault injection on isolated SPU/SID/DMG projects. All physical
// destinations pass through gain zero before application JavaScript runs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os'),{pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={mode:null,root:path.join(repo,'docs'),entry:null,engines:'chromium,webkit',
  out:path.join(tmpdir(),'synth-project-draft-reconnect-browser.json'),screenshots:path.join(tmpdir(),'synth-project-draft-reconnect-images')};
for(const arg of process.argv.slice(2)){const m=/^--(mode|root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(m,'Unknown option '+arg);config[m[1]]=m[2];}
assert(['spu','sid','dmg'].includes(config.mode),'Use --mode=spu|sid|dmg');
config.root=path.resolve(config.root);config.entry??=`/synth-${config.mode}/index.html`;assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const DB=`tetorica-${config.mode}-synth-files`,JOURNAL=`tetorica-${config.mode}-synth-pending-code`;
const projectTitle={spu:'SPU',sid:'SID',dmg:'Game Boy'}[config.mode];
const served=new Map(),missing=[],external=[],expectedCdn=[],results=[];
async function until(test,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await wait(25);}throw Error('Timeout: '+label);}

function installAudit({dbName,journalKey}){
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
  let calls=0,closes=0,aborts=0,abortSource=null,holdNextOpen=false,held=null;
  const source=value=>value?.filesystem?.files?.find(file=>file.path==='/index.js')?.data??null;
  const journal=()=>localStorage.getItem(journalKey);
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
    if(this.name===dbName){const info={mode:args[1]??'readonly',source:null};transactions.set(tx,info);
      tx.addEventListener('abort',()=>{aborts++;});
      tx.addEventListener('complete',()=>{if(info.mode==='readwrite'&&info.source!==null)commits.push({...info,journal:journal()});});
    }return tx;
  };
  IDBObjectStore.prototype.put=function(value,...args){
    const relevant=this.name==='projects'&&this.transaction.db.name===dbName,info=transactions.get(this.transaction),text=source(value);
    if(relevant){const item={source:text,workspaceId:value?.workspaceId,journal:journal()};puts.push(item);if(info)Object.assign(info,item);}
    const request=put.call(this,value,...args);
    if(relevant&&abortSource!==null&&text===abortSource){abortSource=null;holdNextOpen=true;const tx=this.transaction;queueMicrotask(()=>{
      // Deliver the real rollback event before closing its native handle.
      // Closing synchronously inside put() suppresses this event in WebKit.
      tx.addEventListener('abort',()=>tx.db.close(),{once:true});tx.abort();
    });}
    return request;
  };
  function read(){return new Promise((resolve,reject)=>{
    // Bypass app-open auditing so verification does not replace closeCurrent's
    // selected application connection or consume its held reconnect.
    const request=open.call(indexedDB,dbName,1);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=transaction.call(db,'projects','readonly'),get=tx.objectStore('projects').get('current');
      tx.oncomplete=()=>{const value=get.result;close.call(db);resolve(value?{...value,filesystem:{...value.filesystem,files:value.filesystem.files.map(file=>({...file,data:typeof file.data==='string'?file.data:Array.from(file.data)}))}}:null);};
      tx.onabort=()=>{close.call(db);reject(tx.error??get.error);};
    };
  });}
  window.__projectDraftAudit={state,read,journal,
    closeCurrent(){const db=connections.at(-1);if(!db)throw Error('No application draft connection');db.close();},
    versionChange(){return new Promise((resolve,reject)=>{
      // Exercise a genuine notification, then roll back the test upgrade so
      // version 1 and every stored byte remain unchanged.
      const request=open.call(indexedDB,dbName,2);
      request.onupgradeneeded=()=>request.transaction.abort();
      request.onerror=event=>{event.preventDefault();request.error?.name==='AbortError'?resolve():reject(request.error);};
      request.onblocked=()=>reject(Error('The app did not release its version-change connection'));
      request.onsuccess=()=>{close.call(request.result);reject(Error('Test upgrade unexpectedly committed'));};
    });},
    abortAndHold(text){abortSource=text;},
    releaseOpen(){if(!held)throw Error('No held reopen');const request=held;held=null;request.onsuccess?.call(request,new Event('success'));},
  };
}
const audit=page=>page.evaluate(()=>__projectDraftAudit.state()),draft=page=>page.evaluate(()=>__projectDraftAudit.read()),journal=page=>page.evaluate(()=>__projectDraftAudit.journal());
const file=(saved,name)=>saved.filesystem.files.find(item=>item.path===name)?.data;
function assertStable(saved,stable,settings){for(const[name,data]of stable)assert.deepEqual(file(saved,name),data,name+' preserved exactly');assert.deepEqual(saved.settings,settings,'authored settings preserved');}
const source=revision=>`// Self-authored persistence fixture: ${revision}.\n// Loading or restoring this file must never execute it.\nglobalThis.__projectStorageMustNotRun = ${JSON.stringify(revision)};\n`;
async function fixture(){
  const directory=path.join(repo,`docs/synth-${config.mode}`),module=await import(pathToFileURL(path.join(directory,'code_project.js')).href);
  const create=module[{spu:'createSpuCodeProject',sid:'createSidCodeProject',dmg:'createGameboyCodeProject'}[config.mode]],project=create({starterCode:source('initial')});
  let sound;
  if(config.mode==='spu'){
    const {writeSpuInstrument}=await import(pathToFileURL(path.join(directory,'spu_synth_instrument.js')).href),{preparePs1Waveform}=await import(pathToFileURL(path.join(repo,'docs/js/ps1_waveform.js')).href);
    const wave=preparePs1Waveform(Array.from({length:112},(_,i)=>.5*Math.sin(2*Math.PI*i/112)));
    sound=writeSpuInstrument('Reconnect PCM',{preset:{sample:0,volumeLeft:.5,volumeRight:.5,adsr1:15,adsr2:0,pitch:4096,reverb:false},sample:{adpcm:wave.adpcm,baseFrequencyHz:44100/112,loopStartSamples:0},waveform:wave.pcm,reverb:{preset:'off',volumeLeft:.25,volumeRight:.25}});
  }else sound=project.settings;
  const soundPath=`/presets/reconnect.${config.mode==='spu'?'spu':config.mode==='sid'?'sid-channels':'dmg'}.json`;
  project.importFiles([{path:soundPath,data:JSON.stringify(sound,null,2)+'\n'},
    {path:'/notes/readme.txt',data:'Storage reconnect fixture.\n日本語と opaque binary bytes stay intact.\n'},
    {path:'/raw/support.bin',type:'binary',data:Uint8Array.from({length:257},(_,i)=>i%256)}]);
  project.select('/index.js');project.setCodeState({mode:'code',path:'/index.js'});
  return{bytes:Buffer.from(project.exportProject()),stablePaths:[soundPath,'/notes/readme.txt','/raw/support.bin'],code:source('initial')};
}

async function check(browser,name,origin,fixture){
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true,viewport:{width:1360,height:1000}}),page=await context.newPage(),errors=[],consoleErrors=[],checks=[];
  await context.addInitScript(installAudit,{dbName:DB,journalKey:JOURNAL});page.setDefaultTimeout(25000);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!/monaco|loader.min.js|net::ERR_FAILED/i.test(message.text()))consoleErrors.push(message.text());});
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(url.hostname==='cdnjs.cloudflare.com'&&url.pathname.includes('monaco-editor')){expectedCdn.push(url.href);return route.abort();}external.push(url.href);return route.abort();});
  const step=text=>{checks.push(text);console.log(`CHECK ${config.mode}/${name}: ${text}`);};
  const ready=()=>until(()=>page.locator(`#${config.mode}FileNewButton`).isEnabled(),'Files ready');
  const editor=page.locator('#synthCodeEditor');
  async function durable(text){let saved;await until(async()=>{saved=await draft(page);return saved?.codeState?.mode==='code'&&saved.codeState.path==='/index.js'&&file(saved,'/index.js')===text;},'latest full project committed');return saved;}
  async function edit(text){await editor.fill(text);assert.equal(await editor.inputValue(),text);const value=await journal(page);assert(value,'Code immediately protected by recovery journal');assert.equal(JSON.parse(value).source,text);return value;}
  try{
    await page.goto(origin+config.entry);await ready();
    await page.locator(`#${config.mode}ProjectFileInput`).setInputFiles({name:'reconnect.cassette.zip',mimeType:'application/zip',buffer:fixture.bytes});
    await until(()=>page.locator(`#${config.mode}FilesStatus`).textContent().then(text=>text===`${projectTitle} project imported. Code was not run.`),'Project import');await ready();
    await until(()=>editor.isEditable(),'Code editor ready');assert.equal(await page.locator('#synthInputCodeTab').getAttribute('aria-selected'),'true');assert.equal(await editor.inputValue(),fixture.code);
    let current=fixture.code,saved=await durable(current);const settings=saved.settings,stable=fixture.stablePaths.map(name=>[name,file(saved,name)]);
    assert(stable.every(([,data])=>data!==undefined));assert.equal((await audit(page)).audioContexts,0);
    assert.equal(await page.evaluate(()=>globalThis.__projectStorageMustNotRun),undefined);
    step('Existing project import keeps sound JSON, text, binary, Code path/mode and authored settings without running Code or audio');

    const first=await audit(page);await page.evaluate(()=>__projectDraftAudit.closeCurrent());current=source('after-close');await edit(current);saved=await durable(current);assertStable(saved,stable,settings);
    let state=await audit(page);assert(state.opens>first.opens);assert(state.failures.some(error=>error.name==='InvalidStateError'),'native closed-connection transaction reproduced');assert.equal(await editor.inputValue(),current,'reconnect never reapplies the old project');
    step('Native closing-connection InvalidStateError reopens and autosaves the current Code without replaying restoration');

    const beforeFile=await audit(page);await page.evaluate(()=>__projectDraftAudit.closeCurrent());
    await page.locator(`#${config.mode}FilesInput`).setInputFiles({name:'added.txt',mimeType:'text/plain',buffer:Buffer.from('Added after closing the database.\n')});
    await until(()=>page.locator(`#${config.mode}FilesStatus`).textContent().then(text=>text==='Added 1 file(s). Code was not run.'),'Files operation after closure');await ready();
    await until(async()=>file(await draft(page),'/added.txt')==='Added after closing the database.\n','added file committed');saved=await durable(current);stable.push(['/added.txt',file(saved,'/added.txt')]);assertStable(saved,stable,settings);assert((await audit(page)).opens>beforeFile.opens);
    step('Normal Files import also recovers a closed handle while preserving the active Code document and existing project bytes');

    const beforeVersion=await audit(page);await page.evaluate(()=>__projectDraftAudit.versionChange());assert((await audit(page)).closes>beforeVersion.closes);
    current=source('after-versionchange');await edit(current);saved=await durable(current);assertStable(saved,stable,settings);assert((await audit(page)).opens>beforeVersion.opens);
    step('A genuine version-change notification releases the old connection; later writes reconnect without schema or data changes');

    const older=source('older-flush'),newer=source('newer-edit');
    await page.evaluate(text=>__projectDraftAudit.abortAndHold(text),older);await edit(older);
    await until(()=>audit(page).then(value=>value.held),'aborted write reconnect held');
    // The earlier explicit flush must not acknowledge a later edit's journal.
    await page.keyboard.press('Control+s');const latestJournal=await edit(newer);current=newer;
    await page.evaluate(text=>__projectDraftAudit.abortAndHold(text),newer);await wait(300);assert((await audit(page)).held);
    await page.evaluate(()=>__projectDraftAudit.releaseOpen());
    await until(()=>audit(page).then(value=>value.held),'newer write held before commit');await wait(80);
    assert.equal(await journal(page),latestJournal,'older Ctrl+S completion keeps the newer uncommitted recovery journal');
    assert.equal(file(await draft(page),'/index.js'),older,'only the older snapshot is durable until the newer retry commits');
    assert.equal(await editor.inputValue(),newer);
    await page.evaluate(()=>__projectDraftAudit.releaseOpen());saved=await durable(newer);assertStable(saved,stable,settings);
    assert.equal(await journal(page),latestJournal,'autosave cannot acknowledge an unrelated explicit flush receipt');
    state=await audit(page);const commits=state.commits.filter(item=>[older,newer].includes(item.source));
    const ordered=commits.map(item=>item.source).filter((value,i,array)=>i===0||value!==array[i-1]);assert.deepEqual(ordered,[older,newer]);
    assert(state.puts.filter(item=>item.source===older).length>=2);assert(state.puts.filter(item=>item.source===newer).length>=2);assert(state.aborts>=2);
    await page.keyboard.press('Control+s');await until(async()=>await journal(page)===null,'latest Code journal acknowledged');saved=await durable(newer);
    step('Aborted writes and queued edits commit in order; an older explicit flush cannot clear a newer journal before its own matching flush');

    const exercised=await audit(page);await page.reload();await ready();await until(()=>editor.isEditable(),'restored Code editor');
    assert.equal(await page.locator('#synthInputCodeTab').getAttribute('aria-selected'),'true');assert.equal(await editor.inputValue(),current);saved=await durable(current);assertStable(saved,stable,settings);
    // pagehide may have journaled the already durable source again while its
    // asynchronous flush was cut short by navigation. It must describe only
    // this restored document, and an explicit matching flush acknowledges it.
    const restoredJournal=await journal(page);
    if(restoredJournal)assert.deepEqual(JSON.parse(restoredJournal),{workspaceId:saved.workspaceId,path:'/index.js',source:current});
    await page.keyboard.press('Control+s');await until(async()=>await journal(page)===null,'restored matching journal acknowledged');
    assert.equal(await page.evaluate(()=>globalThis.__projectStorageMustNotRun),undefined);assert.doesNotMatch(await page.locator('#synthCodeState').textContent(),/Running/);
    state=await audit(page);assert.equal(state.audioContexts,0);assert(state.physicalOutputMuted);assert.deepEqual(state.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    await page.screenshot({path:path.join(config.screenshots,`${config.mode}-${name}-restored.png`),fullPage:true});
    step('Reload restores the newest Code, mode/path, sound and every opaque file exactly without executing the project');
    return{browser:name,passed:true,checks,nativeClosingErrors:exercised.failures,storageAudit:{opens:exercised.opens,connections:exercised.connections,closes:exercised.closes,aborts:exercised.aborts,puts:exercised.puts,commits:exercised.commits},stableFiles:stable.map(([name,data])=>{const bytes=typeof data==='string'?Buffer.from(data):Buffer.from(data);return{path:name,bytes:bytes.length,sha256:hash(bytes)};}),restoredFileCount:saved.filesystem.files.length,audioContexts:state.audioContexts,physicalOutputMuted:state.physicalOutputMuted,errors,consoleErrors};
  }catch(error){error.caseResult={browser:name,passed:false,checks,failure:error.stack??String(error),audit:await audit(page).catch(()=>null),status:await page.locator(`#${config.mode}FilesStatus`).textContent().catch(()=>null),editor:await editor.inputValue().catch(()=>null),errors,consoleErrors};throw error;}
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
  const data=await fixture();await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  const report={schemaVersion:1,mode:config.mode,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,data));}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;}
  catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.failure=error.stack??String(error);console.error(report.failure);process.exitCode=1;}
  finally{await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,expectedCdn,checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);process.exitCode=1;});
