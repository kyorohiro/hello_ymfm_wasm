// SPDX-License-Identifier: BSD-3-Clause
// Reload the real project and exercise the portable fallback when IndexedDB is unavailable.
const path=require('node:path'),fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const server=http.createServer((req,res)=>{
   const root=path.resolve(__dirname,'../docs');
   const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
   if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
   if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream');
   fs.createReadStream(file).pipe(res);
 });
 await new Promise((ok,fail)=>server.listen(0,'127.0.0.1',ok).on('error',fail));
 let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/synth-fm21290/index.html');
  const ready=()=>page.waitForSelector('main:not([inert])');
  const saved=()=>page.waitForFunction(()=>document.querySelector('#draftStatus').textContent==='Saved locally');
  await ready();
  await page.selectOption('#bank','3');
  await page.fill('#name','LOCAL VOX');await page.locator('#name').press('Tab');
  const track=[0,144,60,95,0,145,67,100,0x83,0,128,60,0,0,129,67,0,0,255,47,0];
  await page.locator('#importFile').setInputFiles({name:'duet.mid',mimeType:'audio/midi',buffer:Buffer.from(
    [77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,track.length,...track])});
  await page.selectOption('#part',{index:1});
  const part=await page.inputValue('#part');
  await page.fill('#midiFrom','0.25');await page.fill('#midiUntil','1.5');await page.check('#midiLoop');
  await page.fill('#newPath','/sets/recovery.js');await page.click('#newFile');
  const code="throw Error('Restored Code must wait for Run')";
  await page.fill('#code',code);await saved();
  await page.reload();await ready();
  assert.equal(await page.innerText('#draftStatus'),'Local project restored');
  assert.equal(await page.inputValue('#bank'),'3');assert.equal(await page.inputValue('#name'),'LOCAL VOX');
  assert.equal(await page.innerText('#activeFile'),'/sets/recovery.js');assert.equal(await page.inputValue('#code'),code);
  assert.equal(await page.inputValue('#part'),part);assert.equal(await page.inputValue('#midiFrom'),'0.25');
  assert.equal(await page.inputValue('#midiUntil'),'1.5');assert.ok(await page.isChecked('#midiLoop'));
  assert.equal(await page.innerText('#slots'),'');assert.equal(await page.innerText('#status'),'');
  assert.equal(await page.locator('button[data-file-path="/songs/duet.mid"]').count(),1);
  await page.fill('#code','// immediate reload');await page.reload();await ready();
  assert.equal(await page.inputValue('#code'),'// immediate reload');
  await page.waitForFunction(()=>['Saved locally','Local project restored'].includes(document.querySelector('#draftStatus').textContent));
  await page.evaluate(()=>sessionStorage.setItem('tetorica-fm21290-pending','{'));
  await page.reload();await ready();
  assert.match(await page.innerText('#draftStatus'),/Restored last IndexedDB save/);
  assert.equal(await page.inputValue('#code'),'// immediate reload');
  // Storage denial keeps the editor and portable export usable.
  await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:null}));
  await page.reload();await ready();
  assert.match(await page.innerText('#draftStatus'),/Local recovery unavailable/);
  await page.fill('#code','// offline');const download=page.waitForEvent('download');await page.click('#saveSession');
  assert.equal((await download).suggestedFilename(),'FM21290.cassette.zip');
  assert.deepEqual(errors,[]);console.log('IndexedDB reload, selected MIDI region, editor, bank and unavailable-store export passed');
 } finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
