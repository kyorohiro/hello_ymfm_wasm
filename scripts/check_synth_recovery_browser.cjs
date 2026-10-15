// Real Synth controls, IndexedDB and Cassette downloads. Faults are confined
// to the pending-tone localStorage write or the absence of IndexedDB.
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const docs=path.resolve(__dirname,'../docs');
const PENDING='tetorica-fm2612-synth-pending-tone';
const server=http.createServer(async(request,response)=>{
  try{
    const file=path.resolve(docs,'.'+new URL(request.url,'http://localhost').pathname);
    if(!file.startsWith(docs+path.sep))throw Error('Invalid path');
    response.setHeader('Content-Type',{'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json','.css':'text/css'}[path.extname(file)]||'application/octet-stream');
    response.end(await fs.readFile(file));
  }catch(error){response.writeHead(404).end(String(error));}
});

const ready=page=>page.waitForFunction(()=>!document.getElementById('synthFileNewButton').disabled);
const algorithm=async page=>Number(await page.locator('.param-value[aria-label="ALGO"]').textContent());
async function editAlgorithm(page){
  const before=await algorithm(page);
  await page.locator('.param-value[aria-label="ALGO"]').locator('..').locator('.param-button').nth(before<7?1:0).click();
  const after=await algorithm(page);assert.notEqual(after,before);
  const tonePath=(await page.locator('#synthActiveFilePath').textContent()).trim();
  assert.match(tonePath,/^\/presets\/.*\.vgi$/);
  return {before,after,tonePath};
}
async function alternativeBuiltin(page){
  return page.locator('#presetSelect').evaluate(select=>Array.from(select.options).find(option=>option.value!=='custom'&&!option.value.startsWith('vfs:')&&option.value!==select.value).value);
}
async function readDraft(page){
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,read=db.transaction('projects','readonly').objectStore('projects').get('current');
      read.onerror=()=>{db.close();reject(read.error);};
      read.onsuccess=()=>{const value=read.result;db.close();resolve(value);};
    };
  }));
}
async function start(browser,url,mode){
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({mode,pending})=>{
    window.__recoveryRejections=[];
    window.addEventListener('unhandledrejection',event=>window.__recoveryRejections.push(String(event.reason?.message??event.reason)));
    if(mode==='quota'){
      const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){
        if(key===pending)throw new DOMException('Injected pending-tone quota failure','QuotaExceededError');
        return original.call(this,key,value);
      };
    }else Object.defineProperty(window,'indexedDB',{configurable:true,get:()=>undefined});
  },{mode,pending:PENDING});
  await page.goto(url);await ready(page);
  return {context,page,errors};
}
async function assertClean(page,errors){
  assert.deepEqual(errors,[]);
  assert.deepEqual(await page.evaluate(()=>window.__recoveryRejections),[]);
}

async function quotaFallback(browser,url){
  const {context,page,errors}=await start(browser,url,'quota');
  try{
    const edit=await editAlgorithm(page);
    assert.match(await page.locator('#status').textContent(),/Immediate recovery unavailable:.*Injected pending-tone quota failure/);
    // This read is queued immediately after the edit, before the 500 ms
    // debounce. A real immediate fallback transaction must already precede it.
    const saved=await readDraft(page);
    assert.equal(saved.activeTonePath,edit.tonePath);
    assert.equal(saved.project.files.find(file=>file.path===edit.tonePath).data[0],edit.after);
    assert.equal(saved.project.files.find(file=>file.path==='/.tet.ss'+edit.tonePath).data[0],edit.before);
    assert(saved.project.files.some(file=>file.path===edit.tonePath+'.synth.json'));
    await page.locator('#presetSelect').selectOption(await alternativeBuiltin(page));await ready(page);
    assert.equal((await page.locator('#synthActiveFilePath').textContent()).trim(),'Built-in instrument');
    await page.locator('#presetSelect').selectOption('vfs:'+edit.tonePath);await ready(page);
    assert.equal(await algorithm(page),edit.after);
    await page.reload();await ready(page);
    assert.equal((await page.locator('#synthActiveFilePath').textContent()).trim(),edit.tonePath);
    assert.equal(await algorithm(page),edit.after);
    assert.equal(await page.locator('#synthFileRevertButton').isEnabled(),true);
    await assertClean(page,errors);
  }finally{await context.close();}
}

async function noDatabase(browser,url,loadCassette){
  const {context,page,errors}=await start(browser,url,'no-idb');
  try{
    assert.match(await page.locator('#status').textContent(),/Local draft storage is unavailable/);
    const edit=await editAlgorithm(page);
    await page.locator('#presetSelect').selectOption(await alternativeBuiltin(page));await ready(page);
    assert.equal((await page.locator('#synthActiveFilePath').textContent()).trim(),edit.tonePath);
    assert.equal(await algorithm(page),edit.after);
    assert.match(await page.locator('#status').textContent(),/Local draft storage is unavailable\. Export Cassette before leaving the current instrument/);
    await page.locator('#synthMenuButton').click();
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#exportCassetteButton').click()]);
    assert.equal(await download.failure(),null);
    const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
    const cassette=await loadCassette(Buffer.concat(chunks));
    const relative=edit.tonePath.slice(1);
    assert.equal(cassette.files.get(relative)[0],edit.after);
    assert.equal(cassette.files.get('.tet.ss/'+relative)[0],edit.before);
    assert(cassette.files.has(relative+'.synth.json'));
    assert(cassette.files.has('.tet.ss/'+relative+'.synth.json'));
    assert.match(await page.locator('#status').textContent(),/^Exported /);
    await assertClean(page,errors);
  }finally{await context.close();}
}

(async()=>{
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(docs,'playground/playground_cassette.js')));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const url=`http://127.0.0.1:${server.address().port}/synth/index.html`;
    const engines=process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]];
    for(const [engine,type] of engines){
      const browser=await type.launch({headless:true});
      try{
        await quotaFallback(browser,url);await noDatabase(browser,url,loadPlaygroundCassette);
        console.log(JSON.stringify({engine,passed:true,quotaFailureVisible:true,immediateIndexedDBFallback:true,switchAndReload:true,noIndexedDBExport:true,noIndexedDBSwitchGuard:true,unhandledErrors:0}));
      }finally{await browser.close();}
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
