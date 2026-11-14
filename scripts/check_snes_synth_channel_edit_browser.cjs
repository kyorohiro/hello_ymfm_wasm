// SPDX-License-Identifier: BSD-3-Clause
// Actual SPC700/S-DSP playback with speaker routes muted before all app scripts.
const {chromium,webkit}=require('playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const config={root:path.resolve(__dirname,'../docs'),entry:'/synth-snes/index.html',desktop:null,out:'/private/tmp/snes-channel-edit.json'};
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
  const portPost=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(message,...rest){if(message.method==='editVoice'&&audit.holdNextEdit){audit.holdNextEdit=false;audit.heldEdit=()=>portPost.call(this,message,...rest);return;}if(message.method==='snapshot'){audit.snapshotRequests=(audit.snapshotRequests||0)+1;if(audit.holdNextSnapshot){audit.holdNextSnapshot=false;audit.heldSnapshot=()=>portPost.call(this,message,...rest);return;}}return portPost.call(this,message,...rest);};
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
  const presets=()=>page.locator('#snesPresetSelect option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(Boolean));
  const select=async value=>{await page.locator(`[data-snes-channel="${value}"]`).click();await page.waitForFunction(value=>document.querySelector(`[data-snes-channel="${value}"]`).getAttribute('aria-selected')==='true',value);};
  const chip=()=>page.locator('#snesChipTab').click(),mix=()=>page.locator('#snesMixerTab').click();
  const exportSound=async()=>{await menu();await page.locator('#savePreset').click();return JSON.parse(await page.evaluate(()=>spcAudit.exportBlob.text()));};
  const source=fixtureVariants.pair;
  const snapshot=()=>page.evaluate(()=>spcAudit.request('tetorica-spc','snapshot')).then(s=>({...s,dsp:Array.from(s.dsp),ram:Array.from(s.ram)}));
  const edit=async(key,value)=>{const control=page.locator('#spcEdit-'+key);if(await control.evaluate(e=>e.tagName==='SELECT'))await control.selectOption(String(value));else{await control.fill(String(value));await control.press('Tab');}await page.waitForFunction(()=>document.querySelector('#spcChannelEditStatus').textContent.startsWith('CH')&&!document.querySelector('#spcEdit-pitch').disabled);};
  mark('Auto remains unchanged through importing and selecting a physical CH');
  const author=await exportSound();await load(source,'edit.spc');await page.waitForFunction(()=>document.querySelector('#spcSongTitle').textContent.includes('edit.spc'));const imported=await presets();await select('0');assert(await page.locator('#snesSpcEdit').isVisible());assert(await page.locator('#snesVoiceFields').isVisible());assert(await page.locator('#waveCanvas').isVisible());assert.match(await page.locator('#sampleInfo').textContent(),/BRR/);assert.equal(await page.locator('#voiceEditor').getAttribute('data-readonly'),'true');
  await page.waitForFunction(()=>{const c=document.querySelector('#waveCanvas'),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return pixels.some((v,i)=>i%4===3&&v>0);});await page.locator('#sampleSection').screenshot({path:config.out.replace(/\.json$/,'-sample-'+name+(native?'-tauri':'-web')+'.png')});
  mark('CH keeps the decoded sample and loop information without duplicate authoring controls');
  for(const id of ['levelSection','envelopeSection','loadAudio','loadBrr','sampleBudget','basePitch'])assert(await page.locator('#'+id).isHidden(),id+' is hidden only in CH');
  assert(await page.locator('#echoSection').isVisible());assert(await page.locator('#pmonSection').isVisible());assert(await page.locator('#capturedLoopInfo').isVisible());assert.match(await page.locator('#capturedLoopInfo').textContent(),/Loop start.*0/);assert.equal(await page.locator('#sampleSection > summary').textContent(),'Sample · decoded BRR / PCM');
  mark('cold edit prepares paused playback without advancing CPU/RAM or touching another CH');
  await edit('volumeLeft',-77);const first=await snapshot();assert.equal(first.dsp[0],179);assert.equal(first.positionSeconds,0);assert.equal((await read()).playing,false);assert.deepEqual(first.ram,Array.from(source.subarray(0x100,0x10100)));assert.deepEqual(first.dsp.slice(16,32),Array.from(source.subarray(0x10110,0x10120)));
  mark('raw PITCH endpoints, ADSR and GAIN packing are editable while paused');
  await edit('pitch',0);assert.equal((await snapshot()).dsp[2],0);await edit('pitch',16383);let s=await snapshot();assert.equal(s.dsp[2],255);assert.equal(s.dsp[3]&63,63);
  await edit('envelopeMode','adsr');await edit('attack',7);await edit('decay',3);await edit('sustainLevel',5);await edit('sustainRate',17);s=await snapshot();assert.equal(s.dsp[5],0xb7);assert.equal(s.dsp[6],0xb1);
  await edit('envelopeMode','gain');await edit('gainMode','bent-increase');await edit('gainRate',9);assert.equal((await snapshot()).dsp[7],0xe9);await edit('gainMode','direct');await edit('gainLevel',80);assert.equal((await snapshot()).dsp[7],80);assert.equal((await snapshot()).positionSeconds,0);
  await select('auto');assert.deepEqual(await exportSound(),author);assert.equal(await page.locator('#voiceEditor').getAttribute('data-readonly'),'false');for(const id of ['levelSection','envelopeSection','echoSection','pmonSection','loadAudio','loadBrr','sampleBudget'])assert(await page.locator('#'+id).isVisible(),id+' returns in Auto');assert(await page.locator('#capturedLoopInfo').isHidden());assert.equal(await page.locator('#sampleSection > summary').textContent(),'Sample · software preparation / BRR playback');assert.deepEqual(await presets(),imported);await select('0');
  assert(await page.locator('#waveCanvas').isVisible());
  mark('Stop restores the original DSP and a delayed edit cannot cross the transport fence');
  await page.locator('#spcSongStop').click();await wait(s=>!s.playing&&s.positionSeconds===0);await page.evaluate(()=>spcAudit.holdNextEdit=true);await page.locator('#spcEdit-volumeLeft').fill('-99');await page.locator('#spcEdit-volumeLeft').press('Tab');await page.waitForFunction(()=>!!spcAudit.heldEdit);await page.locator('#spcSongStop').click();await wait(s=>!s.playing&&s.positionSeconds===0);await page.evaluate(()=>{const release=spcAudit.heldEdit;spcAudit.heldEdit=null;release();});await page.waitForFunction(()=>!document.querySelector('#spcEdit-pitch').disabled);s=await snapshot();assert.equal(s.dsp[0],source[0x10100]);
  mark('delayed edit cannot cross a CH selection; Auto remains authored');
  await page.evaluate(()=>spcAudit.holdNextEdit=true);await page.locator('#spcEdit-volumeLeft').fill('-98');await page.locator('#spcEdit-volumeLeft').press('Tab');await page.waitForFunction(()=>!!spcAudit.heldEdit);await select('1');await page.evaluate(()=>{const release=spcAudit.heldEdit;spcAudit.heldEdit=null;release();});await page.waitForFunction(()=>!document.querySelector('#spcEdit-pitch').disabled);assert.equal((await snapshot()).dsp[0],source[0x10100]);await select('auto');assert.deepEqual(await exportSound(),author);
  mark('live channel volume changes actual PCM while preserving the held audition note');
  await load(Array.from(fixtureVariants.noise),'pcm.spc');await page.waitForFunction(()=>document.querySelector('#spcSongTitle').textContent.includes('pcm.spc'));await select('0');await page.locator('#spcSongPlay').click();await wait(s=>s.playing);await page.waitForFunction(()=>spcAudit.peak()>.0001);await edit('volumeLeft',0);await edit('volumeRight',0);await page.waitForFunction(()=>spcAudit.peak()<.000001);await edit('volumeLeft',100);await edit('volumeRight',100);await page.waitForFunction(()=>spcAudit.peak()>.0001);await page.locator('#spcSongPause').click();await wait(s=>!s.playing);await page.keyboard.down('q');await page.waitForFunction(async()=>(await spcAudit.request('tetorica-sdsp-synth','read')).voices.length===1);const held=(await page.evaluate(()=>spcAudit.request('tetorica-sdsp-synth','read'))).voices;await edit('volumeLeft',80);assert.deepEqual((await page.evaluate(()=>spcAudit.request('tetorica-sdsp-synth','read'))).voices,held);await page.keyboard.up('q');
  mark('later driver writes win');
  const driver=Array.from(fixture);await load(driver,'driver.spc');await page.waitForFunction(()=>document.querySelector('#spcSongTitle').textContent.includes('driver.spc'));await select('0');await page.locator('#spcSongPlay').click();await wait(s=>s.playing);await page.locator('#snesChannelLive').uncheck();await edit('volumeLeft',-101);await page.waitForTimeout(300);assert.equal(await page.locator('#spcEdit-volumeLeft').inputValue(),'-101');assert.notEqual((await snapshot()).dsp[0],155);await page.locator('#snesChannelLive').check();await page.waitForFunction(()=>Number(document.querySelector('#spcEdit-volumeLeft').value)!==-101);assert(await page.locator('#waveCanvas').isVisible());assert.match(await page.locator('#waveReadout').textContent(),/decoded BRR/);await page.locator('#spcSongPause').click();await wait(s=>!s.playing);await edit('pitch',4096);await edit('volumeLeft',44);await page.locator('#snesChannelCopy').click();await page.waitForFunction(()=>document.querySelector('#snesChannelAuto').getAttribute('aria-selected')==='true');assert.notDeepEqual(await exportSound(),author);
  mark('single audio context, output route and Menu; controls fit mobile');
  assert.equal(await page.evaluate(()=>spcAudit.contexts.length),1);assert.equal(await page.evaluate(()=>spcAudit.mutes.length),1);assert.equal(await page.locator('#synthMenu').count(),1);await select('0');await page.setViewportSize({width:390,height:844});if(await page.locator('#snesFilesPanel').isVisible())await page.locator('#snesFilesToggle').click();await page.locator('#snesSpcEdit').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+(native?'-tauri':'-web')+'.png')});assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
  return {engine:name,native,passed:true,checks,physicalOutputMuted:true};
 }catch(error){await page.screenshot({path:config.out.replace(/\.json$/,'-'+name+'-failure.png')}).catch(()=>{});throw Error(name+(native?' Tauri':' Web')+' '+checks.at(-1)+': '+error.stack+'\npage errors: '+errors+'\nstatus: '+await page.locator('#spcSongStatus').textContent()+'\naudio: '+await page.locator('#audioStatus').textContent());}
 finally{await browser.close();}
}
(async()=>{
 await fs.mkdir(path.dirname(config.out),{recursive:true});
 const {createSyntheticSpc}=await import('../tetorica_src/runtime/spc_test_fixture.mjs'),fixture=createSyntheticSpc();
 // Self-authored driver writes real DSP PITCH and SRCN while the CPU runs.
 fixture.set([0x8f,0,0xf2,0xe8,0x20,0xc4,0xf3,0xbc,0x2f,0xfb],0x300);
 fixture.set([0x00,0x21,0x00,0x21],0x1104);fixture.set([0xc3,0x77,0x66,0x44,0x22,0xee,0xcc,0xaa,0x99],0x2200);
 const fixtureVariants={pair:createSyntheticSpc({voices:2,pmon:true,echo:true}),noise:createSyntheticSpc({noise:true})};
 const server=http.createServer(async(req,res)=>{try{const file=path.resolve(config.root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));assert(file.startsWith(config.root+path.sep));res.setHeader('Content-Type',mime[path.extname(file)]??'text/plain');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end('missing');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const results=[];
 try{const origin='http://127.0.0.1:'+server.address().port;for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])for(const native of (config.desktop?[false,true]:[false]))results.push(await check(name,engine,origin,fixture,native,fixtureVariants));await fs.writeFile(config.out,JSON.stringify({passed:true,desktopAdapter:config.desktop,results},null,2)+'\n');}
 finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
