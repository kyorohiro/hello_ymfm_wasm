// SPDX-License-Identifier: BSD-3-Clause
// Actual SPC700/S-DSP playback with speaker routes muted before all app scripts.
const {chromium,webkit}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const config={root:path.resolve(__dirname,'../docs'),entry:'/synth-snes/index.html',desktop:null,out:'/private/tmp/snes-spc-browser.json'};
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].replace(/^--/,'');assert(key in config);config[key]=key==='entry'?process.argv[i+1]:path.resolve(process.argv[i+1]);}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.webp':'image/webp','.json':'application/json'};
async function check(name,engine,origin,fixture,native){
 const browser=await engine.launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
 const page=await browser.newPage({viewport:{width:1240,height:1000}}),errors=[],missing=[],checks=[];
 const base=native?'http://tauri.localhost:'+new URL(origin).port:origin;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(['blob:','data:'].includes(url.protocol))return route.continue();
  if(url.origin!==base)return route.abort();
  if(!native)return route.continue();
  try{const file=path.resolve(config.root,'.'+decodeURIComponent(url.pathname));assert(file.startsWith(config.root+path.sep));return route.fulfill({body:await fs.readFile(file),contentType:mime[path.extname(file)]??'text/plain'});}catch(e){missing.push(url.pathname);return route.fulfill({status:404,body:'missing'});}
 });
 await page.addInitScript(native=>{
  const audit=window.spcAudit={contexts:[],nodes:[],mutes:[],meters:[],next:0,ipc:[]};
  if(native)window.__TAURI_INTERNALS__={invoke:async(command,args)=>{audit.ipc.push({command,args});if(command==='window_pin_state')return false;if(command==='set_window_pin')return args.pinned;if(command==='save_export_binary')return '/mock/sdsp-voice.json';return null;}};
  const Context=window.AudioContext??window.webkitAudioContext,Node=window.AudioWorkletNode,connect=AudioNode.prototype.connect;
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  window.AudioWorkletNode=class extends Node{constructor(...args){super(...args);audit.nodes.push({name:args[1],node:this});}};
  AudioNode.prototype.connect=function(destination,...ports){if(destination===this.context.destination){const meter=this.context.createAnalyser(),mute=this.context.createGain();meter.fftSize=4096;mute.gain.value=0;audit.mutes.push(mute);audit.meters.push(meter);connect.call(this,meter);connect.call(meter,mute);connect.call(mute,destination);return destination;}return connect.call(this,destination,...ports);};
  audit.request=(name,type)=>new Promise((resolve,reject)=>{const node=audit.nodes.findLast(n=>n.name===name)?.node,id=--audit.next;if(!node)return reject(Error('missing '+name));const timer=setTimeout(()=>reject(Error('audit timeout '+type)),5000);const receive=({data})=>{if(data.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);};node.port.addEventListener('message',receive);node.port.start();node.port.postMessage(name==='tetorica-spc'?{id,type}:{id,method:'read',args:[]});});
  audit.peak=()=>{const meter=audit.meters.at(-1);if(!meter)return 0;const values=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(values);if(!values.every(Number.isFinite))throw Error('nonfinite PCM');return Math.max(...values.map(Math.abs));};
 },native);
 if(native)await page.addInitScript({content:await fs.readFile(config.desktop,'utf8')});
 const mark=label=>{checks.push(label);console.log(name+(native?' Tauri':' Web')+': '+label);};
 const read=()=>page.evaluate(()=>spcAudit.request('tetorica-spc','state'));
 const wait=async predicate=>{await page.waitForFunction(()=>spcAudit.nodes.some(n=>n.name==='tetorica-spc')&&!/^(Preparing|Seeking)/.test(document.querySelector('#spcSongStatus').textContent));for(let i=0;i<100;i++){const s=await read();if(predicate(s))return s;await page.waitForTimeout(25);}throw Error('SPC state did not settle '+JSON.stringify(await read()));};
 const menu=async()=>{if(!await page.locator('#synthMenu').evaluate(e=>e.open))await page.locator('#synthMenuButton').click();};
 const load=async(bytes,name='authored.spc')=>{await menu();const chooser=page.waitForEvent('filechooser');await page.locator('#synthMenuSpc').click();await(await chooser).setFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});};
 try{
  await page.goto(base+config.entry);await page.waitForFunction(()=>!document.querySelector('.snes-main').inert);
  mark('Cassette, SPC and BRR lead the menu; import ellipses follow FM2612');await menu();
  assert.deepEqual(await page.locator('#synthMenuPanel button').evaluateAll(nodes=>nodes.slice(0,3).map(n=>n.textContent)),['Cassette…','SPC…','BRR…']);
  assert.equal(await page.locator('#snesProjectExportButton').textContent(),'Cassette · ZIP');
  const brrChooser=page.waitForEvent('filechooser');await page.locator('#synthMenuBrrImport').click();await(await brrChooser).setFiles([]);assert.equal(await page.locator('#synthMenu').evaluate(e=>e.open),false);await menu();
  assert(await page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('#loadPreset')).fontSize)<parseFloat(getComputedStyle(document.querySelector('#snesProjectImportButton')).fontSize)));
  await page.locator('#synthMenuPanel').screenshot({path:config.out.replace(/\.json$/,'-menu-'+name+(native?'-tauri':'-web')+'.png')});
  mark('one shared Menu, passive source selection and no Event Rec');assert.equal(await page.locator('#synthMenu').count(),1);assert.equal(await page.locator('#synthMenuAudio').count(),1);assert.equal(await page.locator('[id^="eventRecord"]').count(),0);
  await load(fixture);await page.waitForFunction(()=>document.querySelector('#spcSongTitle').textContent.includes('authored.spc'));assert.equal(await page.evaluate(()=>spcAudit.contexts.length),0);assert.equal(await page.locator('#spcSongSeek').getAttribute('max'),'3600','unknown-length SPC can seek up to one hour');assert.equal(await page.locator('#instrumentName').inputValue(),'Sine');
  mark('actual SPC700 playback through one context and Master');await page.locator('#spcSongPlay').click();await wait(s=>s.playing&&s.positionSeconds>.1);await page.waitForFunction(()=>spcAudit.peak()>.0001);
  assert.equal(await page.evaluate(()=>spcAudit.contexts.length),1);assert.equal(await page.evaluate(()=>spcAudit.nodes.filter(n=>n.name==='tetorica-spc').length),1);assert.equal(await page.evaluate(()=>spcAudit.mutes.length),1);
  const snapshot=await page.evaluate(async()=>{const seen=[];for(let i=0;i<10;i++){const s=await spcAudit.request('tetorica-spc','snapshot');seen.push({value:s.ram[0x30]+256*s.ram[0x31],frames:s.nativeFrames,position:s.positionSeconds});if((s.ram[0x30]||s.ram[0x31])&&s.nativeFrames>0)return seen.at(-1);await new Promise(r=>setTimeout(r,20));}throw Error('SPC CPU snapshots: '+JSON.stringify(seen));});assert(snapshot.frames>0,'SPC700 INC instruction executes');
  mark('Pause freezes position, paused seek stays paused and Stop resets');await page.locator('#spcSongPause').click();const paused=await wait(s=>!s.playing),at=paused.positionSeconds;await page.waitForTimeout(150);assert.equal((await read()).positionSeconds,at);await page.waitForFunction(()=>spcAudit.peak()<.000001);
  await page.locator('#spcSongSeek').evaluate(e=>{e.value='.8';e.dispatchEvent(new Event('change',{bubbles:true}));});await wait(s=>!s.playing&&Math.abs(s.positionSeconds-.8)<.001);
  await page.locator('#spcSongPlay').click();await wait(s=>s.playing&&s.positionSeconds>.8);await page.locator('#spcSongStop').click();await wait(s=>!s.playing&&s.positionSeconds===0);
  mark('channel On/Off and Master mute affect the SPC route once');await page.locator('#snesMixerTab').click();await page.locator('#spcSongPlay').click();await wait(s=>s.playing);await page.locator('[data-spc-mute="0"]').click();await wait(s=>s.muteMask===1);await page.waitForFunction(()=>spcAudit.peak()<.000001);await page.locator('[data-spc-mute="0"]').click();await page.waitForFunction(()=>spcAudit.peak()>.0001);
  await page.locator('#masterVolume').evaluate(e=>{e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>spcAudit.peak()<.000001);
  await page.locator('#masterVolume').evaluate(e=>{e.value='.7';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>spcAudit.peak()>.0001);
  mark('invalid replacement retains the playing source and edited instrument');await page.locator('#snesChipTab').click();await load([1,2,3],'invalid.spc');await page.waitForFunction(()=>document.querySelector('#spcImportStatus').dataset.error==='true');assert((await read()).playing);assert.match(await page.locator('#spcSongTitle').textContent(),/authored/);assert.equal(await page.locator('#instrumentName').inputValue(),'Sine');
  mark('SPC, Code and keyboard share output; Code Stop leaves SPC playing');await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').fill('const chip=await useSoundChip("snes");await chip.noteOn(CH1,"C4");');await page.locator('#synthCodeRunButton').click();await page.waitForFunction(()=>/Running/.test(document.querySelector('#synthCodeState').textContent));await page.locator('#synthInputCodeTab').click();await page.keyboard.down('q');
  await page.waitForFunction(async()=>(await spcAudit.request('tetorica-sdsp-synth','read')).voices.length===2);await page.locator('#synthCodeStopButton').click();await page.waitForFunction(async()=>(await spcAudit.request('tetorica-sdsp-synth','read')).voices.length===1);assert((await read()).playing);await page.keyboard.up('q');assert.equal(await page.evaluate(()=>spcAudit.mutes.length),1);
  await page.locator('#stopAudio').click();await wait(s=>!s.playing&&s.positionSeconds===0);await page.waitForFunction(()=>spcAudit.peak()<.000001);
  mark('SPC processor failure is isolated and Play retries on the same context');
  await page.locator('#spcSongPlay').click();await wait(s=>s.playing);await page.locator('#synthInputCodeTab').click();await page.keyboard.down('q');
  await page.waitForFunction(async()=>(await spcAudit.request('tetorica-sdsp-synth','read')).voices.length===1);
  await page.evaluate(()=>spcAudit.nodes.findLast(n=>n.name==='tetorica-spc').node.dispatchEvent(new Event('processorerror')));
  await page.waitForFunction(()=>document.querySelector('#spcSongStatus').dataset.error==='true');assert.equal(await page.evaluate(async()=>(await spcAudit.request('tetorica-sdsp-synth','read')).voices.length),1);
  await page.locator('#spcSongPlay').click();await wait(s=>s.playing&&s.positionSeconds>.1);assert.equal(await page.evaluate(()=>spcAudit.contexts.length),1);await page.keyboard.up('q');await page.locator('#spcSongStop').click();
  if(native){mark('desktop mount reuses Web menu and native export/Pin handlers once');await page.evaluate(()=>{dispatchEvent(new Event('tetorica-synth-ready'));dispatchEvent(new Event('tetorica-synth-ready'));});assert.equal(await page.locator('#synthMenu').count(),1);assert.equal(await page.locator('#synthMenuAudio').count(),1);assert.equal(await page.locator('#synthPinButton').count(),1);await page.locator('#synthPinButton').click();assert.equal(await page.evaluate(()=>spcAudit.ipc.filter(c=>c.command==='set_window_pin').length),1);
   await menu();await page.locator('#savePreset').click();await page.waitForFunction(()=>spcAudit.ipc.some(c=>c.command==='save_export_binary'));assert.equal(await page.evaluate(()=>spcAudit.ipc.filter(c=>c.command==='save_export_binary').length),1);
  }
  mark('menu, controls and seek fit narrow screens');await page.setViewportSize({width:390,height:844});await menu();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+(native?'-tauri':'-web')+'.png')});assert(await page.evaluate(()=>spcAudit.mutes.every(m=>m.gain.value===0)));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  return{engine:name,native,passed:true,checks,cpuSnapshot:snapshot,physicalOutputMuted:true};
 }catch(error){await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+'-failure.png')}).catch(()=>{});throw Error(name+(native?' Tauri':' Web')+' '+checks.at(-1)+': '+error.stack+'\npage errors: '+errors+'\nstatus: '+await page.locator('#spcSongStatus').textContent()+'\naudio: '+await page.locator('#audioStatus').textContent());}
 finally{await browser.close();}
}
(async()=>{
 await fs.mkdir(path.dirname(config.out),{recursive:true});
 const {createSyntheticSpc}=await import('../tetorica_src/runtime/spc_test_fixture.mjs'),fixture=createSyntheticSpc();
 // A 16-bit INC/BNE counter avoids wrapping exactly at 128-frame audio blocks.
 fixture.set([0xab,0x30,0xd0,0x02,0xab,0x31,0x2f,0xf8],0x300);
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(config.root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert(file.startsWith(config.root+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]??'text/plain');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end('missing');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const results=[];
 try{const origin='http://127.0.0.1:'+server.address().port;for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])for(const native of (config.desktop?[false,true]:[false]))results.push(await check(name,engine,origin,fixture,native));await fs.writeFile(config.out,JSON.stringify({passed:true,desktopAdapter:config.desktop,results},null,2)+'\n');}
 finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
