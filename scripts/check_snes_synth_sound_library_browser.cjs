// SPDX-License-Identifier: BSD-3-Clause
// Actual SPC700/S-DSP playback with speaker routes muted before all app scripts.
const {chromium,webkit}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const config={root:path.resolve(__dirname,'../docs'),entry:'/synth-snes/index.html',desktop:null,out:'/private/tmp/snes-sound-library-browser.json'};
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].replace(/^--/,'');assert(key in config);config[key]=key==='entry'?process.argv[i+1]:path.resolve(process.argv[i+1]);}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.webp':'image/webp','.json':'application/json'};
async function check(name,engine,origin,fixture,native,fixtureVariants){
 const browser=await engine.launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
 const page=await browser.newPage({viewport:{width:1240,height:1000}}),errors=[],missing=[],checks=[];
 page.setDefaultTimeout(15000);
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
  const createUrl=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{audit.exportBlob=blob;return createUrl(blob);};
  const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)return;return click.call(this);};
  const Context=window.AudioContext??window.webkitAudioContext,Node=window.AudioWorkletNode,connect=AudioNode.prototype.connect;
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  window.AudioWorkletNode=class extends Node{constructor(...args){super(...args);audit.nodes.push({name:args[1],node:this});}};
  const portPost=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(message,...rest){if(message.method==='snapshot'){audit.snapshotRequests=(audit.snapshotRequests||0)+1;if(audit.holdNextSnapshot){audit.holdNextSnapshot=false;audit.heldSnapshot=()=>portPost.call(this,message,...rest);return;}}return portPost.call(this,message,...rest);};
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
  const paths=()=>page.locator('#snesPresetSelect option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(Boolean));
  const choose=async path=>{await page.locator('#snesPresetSelect').selectOption(path);await page.waitForFunction(path=>document.querySelector('#snesPresetSelect').value===path&&!document.querySelector('#snesPresetSelect').disabled,path);};
  const exportSound=async()=>{await menu();await page.locator('#savePreset').click();return JSON.parse(await page.evaluate(()=>spcAudit.exportBlob.text()));};
  const save=async(name,fromSpc=false)=>{await page.locator(fromSpc?'#spcLiveSaveSound':'#snesSaveSoundAs').click();await page.locator('#snesFileNameDialog').waitFor({state:'visible'});await page.locator('#snesFileNameInput').fill(name);await page.locator('#snesFileNameConfirm').click();await page.waitForFunction(()=>!document.querySelector('#snesSaveSoundAs').disabled&&document.querySelector('#snesFilesStatus').textContent.startsWith('Current S-DSP instrument saved'));return JSON.parse(await page.locator('#synthCodeEditor').inputValue());};
  const capture=async index=>{await page.locator(`[data-live-capture="${index}"]`).click();await page.waitForFunction(index=>document.querySelector('#spcLiveStatus').textContent.startsWith('Captured CH'+(index+1)),index);};
  mark('visible library saves and cancels named copies without starting audio or changing the current instrument');
  assert(await page.locator('#snesSaveSoundAs').isEnabled());assert(await page.locator('#snesPresetSelect').isDisabled());await page.locator('#snesSaveSoundAs').click();await page.locator('#snesFileNameCancel').click();assert.deepEqual(await paths(),[]);
  const basic=await save('Default sound');assert.equal(basic.name,'Default sound');assert.equal(basic.source,'wave');assert.equal(await page.locator('#instrumentName').inputValue(),'Sine');assert.equal(await page.evaluate(()=>spcAudit.contexts.length),0);assert.equal(await page.locator('#synthInputKeyboardTab').getAttribute('aria-selected'),'true');
  mark('current SPC sound saves complete BRR via the nearby shortcut');
  await load(fixture);await page.waitForFunction(()=>!document.querySelector('#spcSongPlay').disabled);await page.locator('#spcSongPlay').click();await page.waitForFunction(()=>document.querySelector('#spcLivePosition').textContent.startsWith('Live'));await page.locator('#spcSongPause').click();await page.waitForFunction(()=>document.querySelector('#spcLivePosition').textContent.startsWith('Frozen'));await capture(0);const imported=await exportSound(),lead=await save('Lead',true);assert.equal(lead.name,'Lead');assert.deepEqual(lead,{...imported,name:'Lead'});assert(lead.brr.data.length>0);assert.equal(await page.locator('#synthInputKeyboardTab').getAttribute('aria-selected'),'true');
  mark('same-name PMON / Echo capture adds another file and keeps the earlier sample');
  await load(fixtureVariants.pair,'pair.spc');await page.waitForFunction(()=>document.querySelector('#spcSongTitle').textContent.includes('pair.spc'));await page.locator('#spcSongPlay').click();await page.waitForFunction(()=>document.querySelector('#spcLivePosition').textContent.startsWith('Live'));await page.locator('#spcSongPause').click();await page.waitForFunction(()=>document.querySelector('#spcLivePosition').textContent.startsWith('Frozen'));await page.locator('#spcIncludeEcho').check();await page.locator('#spcIncludePmon').check();await capture(1);const pair=await save('Lead',true);assert(pair.pmon.enabled&&pair.echo.enabled&&pair.pmon.brr.data);assert((await paths()).includes('/presets/Lead (2).sdsp.json'));assert((await paths()).includes('/presets/Lead.sdsp.json'));
  mark('dropdown restores independent sounds for real keyboard audition through one Master');
  await choose('/presets/Lead.sdsp.json');assert.deepEqual(await exportSound(),lead);assert.equal(await page.locator('#instrumentName').inputValue(),'Lead');await page.keyboard.down('q');await page.waitForFunction(()=>spcAudit.peak()>.0001);await page.keyboard.up('q');
  await choose('/presets/Lead (2).sdsp.json');assert.deepEqual(await exportSound(),pair);await page.keyboard.down('q');await page.waitForFunction(()=>spcAudit.peak()>.0001);await page.keyboard.up('q');assert.equal(await page.evaluate(()=>spcAudit.contexts.length),1);assert.equal(await page.evaluate(()=>spcAudit.mutes.length),1);assert.equal(await page.locator('#synthMenu').count(),1);
  mark('editing a loaded sound does not overwrite saved copies; blank names and Cancel add no file');
  await page.locator('#instrumentName').fill('Scratch edit');await page.locator('#instrumentName').press('Enter');assert.equal(await page.locator('#snesPresetSelect').inputValue(),'');await choose('/presets/Lead.sdsp.json');assert.deepEqual(await exportSound(),lead);const before=await paths();await page.locator('#snesSaveSoundAs').click();await page.locator('#snesFileNameInput').fill('   ');await page.locator('#snesFileNameConfirm').click();await page.waitForFunction(()=>document.querySelector('#snesFilesStatus').textContent.includes('Enter a sound name'));assert.deepEqual(await paths(),before);
  mark('reload retains named files and switching without the SPC source remains passive');
  await page.waitForTimeout(200);await page.reload();await page.waitForFunction(()=>!document.querySelector('.snes-main').inert);assert.equal(await page.evaluate(()=>spcAudit.contexts.length),0);assert.equal(await page.locator('#spcSongTitle').textContent(),'No SPC loaded');assert(await page.locator('#snesSongSelect option[value]').count()>1);assert.deepEqual(await paths(),before);await choose('/presets/Lead (2).sdsp.json');assert.deepEqual(await exportSound(),pair);await choose('/presets/Lead.sdsp.json');assert.deepEqual(await exportSound(),lead);assert.equal(await page.evaluate(()=>spcAudit.contexts.length),0);
  mark('project ZIP restores multiple named sounds with their binary samples and leaves Code stopped');
  await menu();await page.locator('#snesProjectExportButton').click();await page.waitForFunction(()=>spcAudit.exportBlob?.type==='application/zip');const zip=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await spcAudit.exportBlob.arrayBuffer()))));
  await page.locator('#snesFileDeleteButton').click();await page.locator('#snesFileNameConfirm').click();await page.waitForFunction(()=>!Array.from(document.querySelector('#snesPresetSelect').options).some(o=>o.value==='/presets/Lead.sdsp.json'));
  await page.locator('#snesProjectFileInput').setInputFiles({name:'library.cassette.zip',mimeType:'application/zip',buffer:zip});await page.waitForFunction(()=>document.querySelector('#snesFilesStatus').textContent.startsWith('S-DSP project imported'));assert.deepEqual(await paths(),before);await choose('/presets/Lead.sdsp.json');assert.deepEqual(await exportSound(),lead);assert.equal(await page.evaluate(()=>spcAudit.contexts.length),0);assert(!/Running|Playing/.test(await page.locator('#synthCodeState').textContent()));
  mark('library and name dialog fit narrow screens; Tauri reuses one menu');
  await page.setViewportSize({width:390,height:844});if(await page.locator('#snesFilesPanel').isVisible())await page.locator('#snesFilesToggle').click();await page.locator('#snesSaveSoundAs').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert((await page.locator('#snesPresetSelect').boundingBox()).width>=180,'saved sound names stay readable on mobile');await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+(native?'-tauri':'-web')+'.png')});await page.locator('#snesSaveSoundAs').click();const box=await page.locator('#snesFileNameDialog').boundingBox();assert(box.x>=0&&box.x+box.width<=390);await page.locator('#snesFileNameCancel').click();assert.equal(await page.locator('#synthMenu').count(),1);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  return {engine:name,native,passed:true,checks,physicalOutputMuted:true};
 }catch(error){await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+'-failure.png')}).catch(()=>{});throw Error(name+(native?' Tauri':' Web')+' '+checks.at(-1)+': '+error.stack+'\npage errors: '+errors+'\nstatus: '+await page.locator('#spcSongStatus').textContent()+'\naudio: '+await page.locator('#audioStatus').textContent());}
 finally{await browser.close();}
}
(async()=>{
 await fs.mkdir(path.dirname(config.out),{recursive:true});
 const {createSyntheticSpc}=await import('../tetorica_src/runtime/spc_test_fixture.mjs'),fixture=createSyntheticSpc();
 // Self-authored driver writes real DSP PITCH and SRCN while the CPU runs.
 fixture.set([0xab,0x30,0xd0,0x02,0xab,0x31,0xe4,0x31,0x28,0x01,0x8f,0x04,0xf2,0xc4,0xf3,0x8f,0x02,0xf2,0xe4,0x30,0xc4,0xf3,0x2f,0xe8],0x300);
 fixture.set([0x00,0x21,0x00,0x21],0x1104);fixture.set([0xc3,0x77,0x66,0x44,0x22,0xee,0xcc,0xaa,0x99],0x2200);
 const fixtureVariants={pair:createSyntheticSpc({voices:2,pmon:true,echo:true}),noise:createSyntheticSpc({noise:true})};
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(config.root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert(file.startsWith(config.root+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]??'text/plain');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end('missing');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const results=[];
 try{const origin='http://127.0.0.1:'+server.address().port;for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])for(const native of (config.desktop?[false,true]:[false]))results.push(await check(name,engine,origin,fixture,native,fixtureVariants));await fs.writeFile(config.out,JSON.stringify({passed:true,desktopAdapter:config.desktop,results},null,2)+'\n');}
 finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
