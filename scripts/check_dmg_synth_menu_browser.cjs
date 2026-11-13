// SPDX-License-Identifier: BSD-3-Clause
// Original VGM / VGZ, actual DMG APU, headless only. Intercept every speaker
// destination before app JS and force gain zero; Chromium is muted as well.
// node scripts/check_dmg_synth_menu_browser.cjs --root=docs --entry=/synth-dmg/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os'),{gzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-dmg/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'dmg-synth-menu-browser.json'),screenshots:path.join(tmpdir(),'dmg-synth-menu-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(25);}throw Error('Timeout: '+label);}

function installSilentAudit(){
  const nativeConnect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],commands=[],sources=[];let sequence=0,lastWave=null;
  window.AudioContext=class extends Context{
    constructor(...args){super(...args);contexts.push(this);}
    createBufferSource(){const source=super.createBufferSource(),item={node:source,started:false,stopped:false,ended:false};sources.push(item);
      const start=source.start,stop=source.stop;source.start=function(...args){item.started=true;return start.apply(this,args);};
      source.stop=function(...args){item.stopped=true;return stop.apply(this,args);};source.addEventListener('ended',()=>{item.ended=true;});return source;}
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return nativeConnect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=2048;mute.gain.value=0;
    nativeConnect.call(this,analyser,...args);nativeConnect.call(analyser,mute);nativeConnect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){if(data?.method){commands.push({method:data.method,args:data.args});if(commands.length>10000)commands.shift();}return post.call(this,data,...args);};
  // Record the existing Wave RAM path without adding an app observation API.
  const begin=CanvasRenderingContext2D.prototype.beginPath,move=CanvasRenderingContext2D.prototype.moveTo,line=CanvasRenderingContext2D.prototype.lineTo,stroke=CanvasRenderingContext2D.prototype.stroke;
  const paths=new WeakMap();CanvasRenderingContext2D.prototype.beginPath=function(...args){if(this.canvas.id==='waveCanvas')paths.set(this,[]);return begin.apply(this,args);};
  for(const [name,original]of [['moveTo',move],['lineTo',line]])CanvasRenderingContext2D.prototype[name]=function(x,y){paths.get(this)?.push([x,y]);return original.call(this,x,y);};
  CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='waveCanvas'&&this.strokeStyle==='#c6dd95'){
    const points=paths.get(this);if(points?.length===64)lastWave=Array.from({length:32},(_,i)=>Math.round((this.canvas.height-25-points[i*2][1])/(this.canvas.height-43)*15));
  }return stroke.apply(this,args);};
  const arrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){if(this.name==='slow.vgm')await new Promise(resolve=>setTimeout(resolve,500));return arrayBuffer.call(this);};
  async function read(method='read'){
    const node=nodes.findLast(item=>item.name==='tetorica-gameboy-synth')?.node;if(!node)throw Error('DMG editor Worklet missing');const id=--sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('DMG audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args:[]});});
  }
  function output(){const samples=meters.filter(item=>item.source.context.state==='running').map(item=>{
    const pcm=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(pcm);let square=0,peak=0;for(const value of pcm){square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/pcm.length),peak,finite:pcm.every(Number.isFinite)};
  }).sort((a,b)=>b.rms-a.rms);return{...(samples[0]??{rms:0,peak:0,finite:true}),muted:meters.every(item=>item.mute.gain.value===0)};}
  window.__dmgSongAudit={read,output,wave:()=>lastWave?.slice(),drain:()=>commands.splice(0),
    graph:()=>({contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,editorWorklets:nodes.filter(item=>item.name==='tetorica-gameboy-synth').length,
      destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0),bufferSources:sources.length,liveSources:sources.filter(item=>item.started&&!item.stopped&&!item.ended).length})};
}
const read=(page,method='read')=>page.evaluate(method=>__dmgSongAudit.read(method),method);
const state=page=>page.evaluate(()=>({phase:document.querySelector('#dmgSongPlayer').dataset.state,frame:Number(document.querySelector('#dmgSongPlayer').dataset.positionFrames),
  rendered:Number(document.querySelector('#dmgSongPlayer').dataset.renderedFrames),
  duty:document.querySelector('#pulseDuty [aria-checked=true]')?.dataset.choiceValue,source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,
  status:document.querySelector('#dmgSongStatus').textContent,live:document.querySelector('#dmgChannelStatus').textContent,readonly:document.querySelector('#voiceEditor').dataset.readonly}));
async function phase(page,expected){await until(()=>state(page).then(value=>value.phase===expected),'song '+expected);}
async function pcm(page,audible=true){let value;await until(async()=>{value=await page.evaluate(()=>__dmgSongAudit.output());return value.muted&&value.finite&&(audible?value.rms>.0001:value.peak<1e-7);},audible?'real song PCM':'output silence');return value;}
async function files(page){if(await page.locator('#dmgFilesPanel').isHidden())await page.locator('#dmgFilesToggle').click();await until(()=>page.locator('#dmgFileImportButton').isEnabled(),'Files ready');}
async function play(page){await page.locator('#dmgSongPlayButton').click();await phase(page,'playing');}
async function pause(page){await page.locator('#dmgSongPlayButton').click();await phase(page,'paused');}
async function stop(page){await page.locator('#dmgSongStopButton').click();await phase(page,'stopped');await pcm(page,false);}
async function choose(page,value){await page.locator('#dmgSongSelect').selectOption(value);await until(async()=>!await page.locator('#dmgSongPlayButton').isDisabled()&&await page.locator('#dmgSongSelect').inputValue()===value,'song selected');}
async function download(page,selector){if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu')))&&!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();const event=page.waitForEvent('download');await page.locator(selector).click();const item=await event,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}


async function openMenu(page){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();assert(await page.locator('#synthMenu').evaluate(node=>node.open));}
async function chooser(page,selector,file){await openMenu(page);const event=page.waitForEvent('filechooser');await page.locator(selector).click();const input=await event;await input.setFiles(file);assert.equal(await page.locator('#synthMenu').evaluate(node=>node.open),false,'choosing a menu action closes it');}
async function selectedFile(page,filename){await files(page);for(let i=0;i<12;i++){const closed=page.locator('#dmgFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#dmgFilesTree button[data-file-path]').locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();}
const jsons=project=>[...project.files].filter(([filename])=>/^presets\/.*\.json$/.test(filename)).map(([filename,bytes])=>({filename,value:JSON.parse(Buffer.from(bytes).toString('utf8'))}));
async function importedVgm(page,count){await until(()=>page.locator('#vgmImport').getAttribute('data-loading').then(value=>value==='false'),'import completed');assert.match(await page.locator('#vgmStatus').textContent(),count?new RegExp(`${count} sounds? saved`):/No static sounds found|No complete, audible Game Boy voices/);}
async function check(browser,name,origin,fixture,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),pageErrors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',error=>pageErrors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('One hamburger owns all import / export actions and closes with outside click, Escape and selection');
    for(const id of ['synthMenu','synthMenuButton','synthMenuPanel','loadVgm','vgmFileInput','loadPreset','presetFileInput','savePreset','copyCode','resetPreset','dmgProjectImportButton','dmgProjectExportButton','dmgFileImportButton','dmgFileExportButton'])assert.equal(await page.locator('#'+id).count(),1,id+' is unique');
    for(const id of ['loadVgm','loadPreset','savePreset','copyCode','resetPreset','dmgProjectImportButton','dmgProjectExportButton','dmgFileImportButton','dmgFileExportButton'])assert(await page.locator('#'+id).evaluate(node=>Boolean(node.closest('#synthMenuPanel'))),id+' belongs to Menu');
    assert.equal(await page.locator('#vgmVoices,[data-vgm-filter],#vgmPage').count(),0,'the separate voice picker and paging UI are removed');
    await openMenu(page);await page.locator('#synthTitle').click();assert.equal(await page.locator('#synthMenu').evaluate(node=>node.open),false);
    await openMenu(page);await page.locator('#loadVgm').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('#synthMenu').evaluate(node=>node.open),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'synthMenuButton');
    await chooser(page,'#loadVgm',[]);assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);

    step('VGM import stores its exact source and all six original static sounds without applying or playing');
    await chooser(page,'#loadVgm',{name:'reference.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});await importedVgm(page,6);
    assert(await page.locator('#dmgFilesPanel').isVisible());assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);
    assert.equal(await page.locator('#instrumentName').inputValue(),'Pulse');assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
    const first=await loadCassette(await download(page,'#dmgProjectExportButton')),firstSounds=jsons(first);assert.equal(firstSounds.length,6);
    assert.deepEqual(Buffer.from(first.files.get('vgm/reference.vgm')),Buffer.from(fixture.bytes));
    assert.deepEqual(firstSounds.map(item=>item.value.source).sort(),['noise','noise','pulse','pulse','wave','wave']);
    assert(firstSounds.some(item=>JSON.stringify(item.value.wave.samples)===JSON.stringify(fixture.initialWave)&&item.value.source==='wave'));
    assert(firstSounds.some(item=>JSON.stringify(item.value.wave.samples)===JSON.stringify(fixture.futureWave)&&item.value.source==='wave'));
    assert(firstSounds.some(item=>item.value.source==='noise'&&item.value.noise.volume===3&&item.value.noise.shift===4&&item.value.noise.width===15));
    assert(firstSounds.some(item=>item.value.source==='noise'&&item.value.noise.volume===6&&item.value.noise.shift===1&&item.value.noise.width===7));

    step('Repeated import is collision-safe; zero static sounds still preserve the raw source');
    await chooser(page,'#loadVgm',{name:'reference.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});await importedVgm(page,6);
    const repeat=await loadCassette(await download(page,'#dmgProjectExportButton'));assert.equal(jsons(repeat).length,12);
    assert([...repeat.files.keys()].some(filename=>filename.startsWith('presets/reference (2)/')));assert([...repeat.files.keys()].some(filename=>filename==='vgm/reference-2.vgm'));
    for(const [filename,bytes]of first.files)if(filename.startsWith('presets/')||filename.startsWith('vgm/'))assert.deepEqual(repeat.files.get(filename),bytes,'earlier bytes preserved: '+filename);
    await chooser(page,'#loadVgm',{name:'no-static-sounds.vgm',mimeType:'application/octet-stream',buffer:fixture.empty});await importedVgm(page,0);
    const empty=await loadCassette(await download(page,'#dmgProjectExportButton'));assert.equal(jsons(empty).length,12);assert.deepEqual(Buffer.from(empty.files.get('vgm/no-static-sounds.vgm')),fixture.empty);
    assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);measurements.savedVgmPresets=12;

    step('JSON import is passive; Files selection alone applies the sound and leaves keyboard input available');
    await chooser(page,'#loadPreset',{name:'menu-wave.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.wavePreset))});
    await until(()=>page.locator('#dmgFilesStatus').textContent().then(value=>/Added 1/.test(value)),'JSON stored');assert.equal(await page.locator('#instrumentName').inputValue(),'Pulse');assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);
    await selectedFile(page,'/menu-wave.json');await until(()=>page.locator('#instrumentName').inputValue().then(value=>value===fixture.wavePreset.name),'Files applies imported JSON');assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
    await page.locator('#startAudio').click();await until(async()=>{try{return JSON.stringify((await read(page)).preset)===JSON.stringify(fixture.wavePreset);}catch{return false;}},'actual author APU');
    await page.keyboard.down('z');await pcm(page);const held=await read(page);assert.equal(held.voices.length,1);
    await page.evaluate(()=>__dmgSongAudit.drain());await openMenu(page);await page.keyboard.press('Escape');
    assert.deepEqual((await read(page)).voices,held.voices,'Escape closes Menu without global Stop');assert(!(await page.evaluate(()=>__dmgSongAudit.drain())).some(command=>command.method==='stop'));await pcm(page);await page.keyboard.up('z');await pcm(page,false);
    await page.keyboard.down('z');await pcm(page);await page.keyboard.up('z');await pcm(page,false);

    step('A second passive JSON import preserves held notes; explicit Files apply changes the instrument');
    await page.keyboard.down('z');await pcm(page);const before=await read(page);
    await chooser(page,'#loadPreset',{name:'menu-noise.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.noisePreset))});
    await until(()=>page.locator('#dmgFilesStatus').textContent().then(value=>/Added 1/.test(value)),'second JSON stored');assert.deepEqual((await read(page)).preset,before.preset);assert.deepEqual((await read(page)).voices,before.voices);await pcm(page);
    await selectedFile(page,'/menu-noise.json');await until(async()=>JSON.stringify((await read(page)).preset)===JSON.stringify(fixture.noisePreset),'explicit Noise preset');assert.equal((await read(page)).voices.length,0);await page.keyboard.up('z');
    await page.keyboard.down('x');await pcm(page);await page.keyboard.up('x');await pcm(page,false);

    step('Preset / source / selected file exports and project round-trip retain portable editable data');
    const saved=JSON.parse((await download(page,'#savePreset')).toString('utf8'));assert.deepEqual(saved,fixture.noisePreset);
    await openMenu(page);await page.locator('#copyCode').click();assert.equal(await page.locator('#synthMenu').evaluate(node=>node.open),false);await until(()=>page.locator('#codeOutput').inputValue().then(value=>value.includes('gameboy.noise.keyOn()')),'copy JavaScript source');
    assert.deepEqual(JSON.parse((await download(page,'#dmgFileExportButton')).toString('utf8')),fixture.noisePreset);
    const bytes=await download(page,'#dmgProjectExportButton'),project=await loadCassette(bytes);assert.equal(jsons(project).length,12);assert.deepEqual(Buffer.from(project.files.get('vgm/reference.vgm')),Buffer.from(fixture.bytes));
    await chooser(page,'#dmgProjectImportButton',{name:'menu-project.zip',mimeType:'application/zip',buffer:bytes});await until(()=>page.locator('#dmgFilesStatus').textContent().then(value=>/imported/i.test(value)),'project restored');
    assert.equal(await read(page,'observeCode'),null);assert.deepEqual((await read(page)).preset,fixture.noisePreset);await pcm(page,false);
    await until(()=>page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('tetorica-dmg-synth-files',1);request.onerror=()=>resolve(false);request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('current');get.onerror=()=>{db.close();resolve(false);};get.onsuccess=()=>{db.close();resolve(get.result?.codeState?.path==='/menu-noise.json'&&get.result?.codeState?.mode==='keyboard');};};})),'persisted menu project');
    await page.reload();await files(page);assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);assert.notEqual((await state(page)).phase,'playing');

    step('The opened menu and Files fit 390px, restore safely and return to live keyboard performance');
    await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await openMenu(page);await page.locator('#synthMenuButton').scrollIntoViewIfNeeded();
      const bounds=await page.locator('#synthMenuPanel').evaluate(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,width:innerWidth,scroll:document.documentElement.scrollWidth};});assert(bounds.left>=-1&&bounds.right<=width+1&&bounds.top>=0&&bounds.scroll<=width+1);measurements['layout'+width]=bounds;
      await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});await page.keyboard.press('Escape');}
    assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);await page.keyboard.down('z');await until(async()=>{try{return(await read(page)).voices.length===1;}catch{return false;}},'keyboard after menu restore');await pcm(page);await page.keyboard.up('z');await pcm(page,false);
    const graph=await page.evaluate(()=>__dmgSongAudit.graph());assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert.equal(graph.destinationConnections,1);assert(graph.muted);
    assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,graph,pageErrors,consoleErrors};
  }catch(error){const diagnostic={stage,import:await page.locator('#vgmStatus').textContent().catch(()=>''),files:await page.locator('#dmgFilesStatus').textContent().catch(()=>''),audio:await page.locator('#audioStatus').textContent().catch(()=>''),menu:await page.locator('#synthMenu').evaluate(node=>node.open).catch(()=>null),commands:await page.evaluate(()=>__dmgSongAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors,consoleErrors};throw error;
  }finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createDmgSongFixture,DMG_SONG_FUTURE_WAVE,DMG_SONG_INITIAL_WAVE}=await import(pathToFileURL(path.join(repo,'test/helpers/dmg_synth_song_fixture.mjs')).href);
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href);
  const {createDefaultPreset,waveShape}=await import(pathToFileURL(path.join(repo,'docs/synth-dmg/preset.js')).href);
  const wavePreset=createDefaultPreset();wavePreset.name='Menu Wave';wavePreset.source='wave';wavePreset.wave.samples=waveShape('saw');
  const noisePreset=createDefaultPreset();noisePreset.name='Menu Noise';noisePreset.source='noise';noisePreset.noise={volume:5,envelope:{direction:'down',period:0},divisor:3,shift:4,width:7};
  const commands=Uint8Array.from([0xb3,22,128,0x61,0xe8,0x03,0x66]),empty=Buffer.alloc(256+commands.length);empty.set(createDmgSongFixture().bytes.subarray(0,256));empty.writeUInt32LE(empty.length-4,4);empty.writeUInt32LE(1000,0x18);empty.set(commands,256);
  const fixture={...createDmgSongFixture(),futureWave:DMG_SONG_FUTURE_WAVE,initialWave:DMG_SONG_INITIAL_WAVE,empty,wavePreset,noisePreset};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixture,loadPlaygroundCassette));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');
  if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
