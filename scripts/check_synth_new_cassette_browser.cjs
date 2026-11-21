// SPDX-License-Identifier: BSD-3-Clause
// Isolated fresh browser contexts; all physical audio destinations are muted.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../docs'),out=path.resolve('build/new-cassette-browser.json');
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp'};
(async()=>{
 const server=http.createServer(async(req,res)=>{try{const name=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert(name.startsWith(root+path.sep));res.setHeader('Content-Type',mime[path.extname(name)]??'application/octet-stream');res.end(await fs.readFile(name));}catch{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port,results=[];
 try{for(const [engine,browserType]of [['chromium',chromium],['webkit',webkit]])for(const [folder,prefix,chip,example]of [['synth-2a03','nes','nes','timed-fds.js'],['synth-snes','snes','snes','timed-sdsp.js']]){
 const browser=await browserType.launch({headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.addInitScript(()=>{window.audioAudit={contexts:0,mutes:[]};const Base=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect;window.AudioContext=class extends Base{constructor(...args){super(...args);audioAudit.contexts++;}};AudioNode.prototype.connect=function(destination,...args){if(destination===this.context.destination){const gain=this.context.createGain();gain.gain.value=0;audioAudit.mutes.push(gain);connect.call(this,gain);connect.call(gain,destination);return destination;}return connect.call(this,destination,...args);};});
 await page.goto(origin+'/'+folder+'/index.html');await page.waitForFunction(()=>!document.querySelector('#synthInputCodeTab').disabled);
 assert.deepEqual(await page.locator('#synthMenuPanel > section h2').allTextContents().then(a=>a.slice(0,2)),['New','Import']);
 await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
 const before=`const chip=await useSoundChip("${chip}");liveLoop("keep",async()=>{await chip.noteOn(CH1,"C4");await beat(.1);await chip.noteOff(CH1);await beat(.1);}); // replaced only on confirmation`;
 await page.locator('#synthCodeEditor').fill(before);await page.locator('#synthCodeRunButton').click();await page.waitForFunction(()=>/Running|Playing/.test(document.querySelector('#synthCodeState').textContent));
 await page.locator('#synthMenuButton').click();await page.locator('#'+prefix+'ProjectNewButton').click();assert(await page.locator('#'+prefix+'FileNameDialog').isVisible());
 await page.locator('#'+prefix+'FileNameCancel').click();assert.equal(await page.locator('#synthCodeEditor').inputValue(),before);assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
 await page.locator('#synthMenuButton').click();await page.locator('#'+prefix+'ProjectNewButton').click();await page.locator('#'+prefix+'FileNameConfirm').click();
 await page.waitForFunction(id=>document.getElementById(id).textContent.includes('New Cassette created'),prefix+'FilesStatus');assert(!/Running|Playing/.test(await page.locator('#synthCodeState').textContent()));
 await page.locator('#'+prefix+'FilesTree button[data-file-path="/index.js"]').click();await page.locator('#synthInputCodeTab').click();await page.waitForFunction(()=>document.querySelector('#synthCodeEditor').value.includes('setBpm(120)'));assert(!(await page.locator('#synthCodeEditor').inputValue()).includes('replaced only'));
 assert(await page.locator('#'+prefix+'FilesTree button[data-file-path="/examples/'+example+'"]').count());assert(await page.evaluate(()=>audioAudit.mutes.length>0&&audioAudit.mutes.every(g=>g.gain.value===0)));
 await page.reload();await page.waitForFunction(()=>!document.querySelector('#synthInputCodeTab').disabled);await page.locator('#synthInputCodeTab').click();await page.waitForFunction(()=>document.querySelector('#synthCodeEditor').value.includes('setBpm(120)'));assert.equal(await page.evaluate(()=>audioAudit.contexts),0);assert.deepEqual(errors,[]);
 results.push({engine,chip,passed:true,cancelRetainsCode:true,newRestoresStarterAndExamples:true,reloadSilent:true,physicalOutputMuted:true});console.log('PASS '+engine+' '+chip+' New / Cancel / persistence');
 }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify({passed:true,listeningPerformed:false,results},null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;});
