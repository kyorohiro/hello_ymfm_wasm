// SPDX-License-Identifier: BSD-3-Clause
// Original VGM / VGZ, actual DMG APU, headless only. Intercept every speaker
// destination before app JS and force gain zero; Chromium is muted as well.
// node scripts/check_dmg_synth_song_seek_browser.cjs --root=docs --entry=/synth-dmg/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os'),{gzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-dmg/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'dmg-synth-song-seek-browser.json'),screenshots:path.join(tmpdir(),'dmg-synth-song-seek-browser')};
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
  status:document.querySelector('#dmgSongStatus').textContent,live:document.querySelector('#dmgSongLiveStatus').textContent,readonly:document.querySelector('#voiceEditor').dataset.readonly}));
async function phase(page,expected){await until(()=>state(page).then(value=>value.phase===expected),'song '+expected);}
async function pcm(page,audible=true){let value;await until(async()=>{value=await page.evaluate(()=>__dmgSongAudit.output());return value.muted&&value.finite&&(audible?value.rms>.0001:value.peak<1e-7);},audible?'real song PCM':'output silence');return value;}
async function files(page){if(await page.locator('#dmgFilesPanel').isHidden())await page.locator('#dmgFilesToggle').click();await until(()=>page.locator('#dmgFileImportButton').isEnabled(),'Files ready');}
async function play(page){await page.locator('#dmgSongPlayButton').click();await phase(page,'playing');}
async function pause(page){await page.locator('#dmgSongPlayButton').click();await phase(page,'paused');}
async function stop(page){await page.locator('#dmgSongStopButton').click();await phase(page,'stopped');await pcm(page,false);}
async function choose(page,value){await page.locator('#dmgSongSelect').selectOption(value);await until(async()=>!await page.locator('#dmgSongPlayButton').isDisabled()&&await page.locator('#dmgSongSelect').inputValue()===value,'song selected');}
async function download(page,selector){if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu')))&&!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();const event=page.waitForEvent('download');await page.locator(selector).click();const item=await event,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}


const seekState=page=>page.evaluate(()=>{const node=document.querySelector('#dmgSongPlayer');return{
  phase:node.dataset.state,frame:Number(node.dataset.positionFrames),rendered:Number(node.dataset.renderedFrames),view:node.dataset.view,
  seeking:node.dataset.seeking==='true',target:Number(node.dataset.seekTargetSeconds),progress:Number(node.dataset.seekProgressSeconds),
  preparing:node.dataset.seekPreparing==='true',held:Number(node.dataset.auditionHeld),sounding:Number(node.dataset.auditionSounding),
  status:document.querySelector('#dmgSongStatus').textContent,position:document.querySelector('#dmgSongSeekPosition').textContent};});
async function setSeek(page,seconds){await page.locator('#dmgSongSeek').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},seconds);}
async function seek(page,seconds,playback='paused'){
  await setSeek(page,seconds);const frame=Math.round(seconds*44100);
  await until(()=>seekState(page).then(value=>!value.seeking&&!value.preparing&&value.phase===playback&&(playback==='playing'?value.frame>=frame&&value.frame<frame+8820:value.frame===frame)),'seek '+seconds+' '+playback);
  return seekState(page);
}
async function channel(page,value){await page.locator('#dmgSongChannelSelect').selectOption(String(value));await until(()=>page.locator('#dmgSongChannelSelect').inputValue().then(current=>current===String(value)),'selected channel');}
const CODE_HOLD=`const gb=await useSoundChip('gameboy');\nawait gb.initialize();\nawait gb.pulse.setVoice(0,{duty:.5,volume:5,envelope:{direction:'down',period:0}});\nawait gb.pulse.noteOn(0,'C4');\n`;

async function check(browser,name,origin,fixture,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),pageErrors=[],consoleErrors=[],checks=[],measurements={};let stage='startup',wasmGate=null;
  page.setDefaultTimeout(20000);page.on('pageerror',error=>pageErrors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}
    if(wasmGate&&/gameboy_apu_wasm\.wasm$/.test(url.pathname)){const gate=wasmGate;gate.entered=true;await new Promise(resolve=>{gate.release=resolve;});}
    return route.continue();});
  await page.addInitScript(installSilentAudit);
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  const hold=()=>{assert.equal(wasmGate,null);wasmGate={entered:false,release:null};};
  const release=()=>{const gate=wasmGate;wasmGate=null;gate?.release?.();};
  try{
    await page.goto(origin+config.entry);await files(page);
    await page.locator('#dmgFilesInput').setInputFiles([
      {name:'reference.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)},
      {name:'reference.vgz',mimeType:'application/gzip',buffer:gzipSync(fixture.bytes)},
    ]);
    await choose(page,'/vgm/reference.vgm');assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);
    await page.locator('#dmgFilesToggle').click();

    step('A genuine slider drag previews only; stopped seek lands paused without scheduling audio');
    const slider=page.locator('#dmgSongSeek');assert(await slider.isEnabled());await slider.scrollIntoViewIfNeeded();
    const box=await slider.boundingBox();assert(box);await page.mouse.move(box.x+8,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width*.18,box.y+box.height/2,{steps:6});await wait(60);
    const draft=Number(await slider.inputValue());assert(draft>0&&draft<.8);
    const during=await seekState(page);assert.equal(during.phase,'stopped');assert.equal(during.frame,0);assert.equal(during.seeking,false);
    assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0,'dragging does not prepare the APU or audio');
    assert((await page.locator('#dmgSongSeekPosition').textContent()).length>0);await page.mouse.up();
    await until(()=>seekState(page).then(value=>value.phase==='paused'&&!value.seeking&&value.frame===Math.round(draft*44100)),'stopped drag seek lands paused');
    await pcm(page,false);assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).bufferSources,0,'stopped seek never schedules a song buffer');
    if((await page.evaluate(()=>__dmgSongAudit.graph())).contexts===0)await page.locator('#startAudio').click();
    await until(async()=>{try{return Boolean((await read(page)).preset);}catch{return false;}},'editor APU ready');const author=await read(page);measurements.initialSeek=await seekState(page);

    step('Paused forward / backward seek refreshes every channel at the exact destination even with Live Off');
    await page.locator('#dmgSongLiveEnabled').uncheck();await seek(page,1.12);await channel(page,0);
    assert.equal(await page.locator('#pulseDuty [aria-checked=true]').getAttribute('data-choice-value'),'0.75');
    await channel(page,1);assert.equal(await page.locator('#pulseDuty [aria-checked=true]').getAttribute('data-choice-value'),'0.125');
    await channel(page,2);assert.deepEqual(await page.evaluate(()=>__dmgSongAudit.wave()),fixture.futureWave);
    await channel(page,3);assert.equal(await page.locator('#noiseVolume').textContent(),'6');assert.equal(await page.locator('#noiseShift').textContent(),'1');assert.equal(await page.locator('#noiseWidth [aria-checked=true]').getAttribute('data-choice-value'),'7');
    assert.equal(await page.locator('#dmgSongLiveEnabled').isChecked(),false);assert.deepEqual((await read(page)).preset,author.preset);
    await seek(page,.23);await channel(page,0);assert.equal(await page.locator('#pulseDuty [aria-checked=true]').getAttribute('data-choice-value'),'0.25');
    await channel(page,2);assert.deepEqual(await page.evaluate(()=>__dmgSongAudit.wave()),fixture.initialWave);
    await channel(page,3);assert.equal(await page.locator('#noiseShift').textContent(),'4');
    await page.locator('#dmgSongLiveEnabled').check();

    step('Seek retires a held trial; audition and Capture use the new Wave RAM while preserving Pause');
    await channel(page,2);await page.keyboard.down('z');await until(()=>seekState(page).then(value=>value.sounding===1),'held original Wave trial');await pcm(page);
    await seek(page,1.12);assert.equal((await seekState(page)).sounding,0);assert.equal(await read(page,'observeCode'),null);await pcm(page,false);
    await page.keyboard.down('x');await until(()=>seekState(page).then(value=>value.sounding===1),'new destination trial');await page.keyboard.up('z');await pcm(page);
    const raw=await read(page,'observeCode');assert.deepEqual(raw.registers.slice(32,48),Array.from({length:16},(_,i)=>(fixture.futureWave[i*2]<<4)|fixture.futureWave[i*2+1]));
    await page.keyboard.up('x');await until(()=>seekState(page).then(value=>value.sounding===0),'destination trial released');await pcm(page,false);
    assert.equal((await seekState(page)).frame,49392);await page.locator('#dmgSongCaptureButton').click();
    await until(()=>seekState(page).then(value=>value.view==='synth'&&value.phase==='paused'),'capture at seek destination');
    const captured=(await read(page)).preset;assert.equal(captured.source,'wave');assert.deepEqual(captured.wave.samples,fixture.futureWave);
    assert.equal((await seekState(page)).frame,49392);await files(page);const project=await loadCassette(await download(page,'#dmgProjectExportButton'));
    assert.deepEqual(Buffer.from(project.files.get('vgm/reference.vgm')),Buffer.from(fixture.bytes));
    const sounds=[...project.files].filter(([filename])=>/^presets\/.*\.json$/.test(filename)).map(([,bytes])=>JSON.parse(Buffer.from(bytes).toString('utf8')));
    assert.equal(sounds.length,2);assert(sounds.some(value=>JSON.stringify(value)===JSON.stringify(author.preset)));assert(sounds.some(value=>JSON.stringify(value)===JSON.stringify(captured)));

    step('Playing seek resumes from its target; keyboard range commits retain the paused destination');
    await channel(page,0);await seek(page,.31);await play(page);await pcm(page);await seek(page,1.22,'playing');await pcm(page);await pause(page);
    await seek(page,.17);await play(page);await seek(page,.42,'playing');await pause(page);await seek(page,.31);
    await slider.focus();await page.keyboard.press('ArrowRight');await until(()=>seekState(page).then(value=>value.phase==='paused'&&!value.seeking&&value.frame===14112),'keyboard range seek .32 seconds');
    assert.deepEqual((await read(page)).preset,captured);measurements.pausedKeyboardSeek=await seekState(page);

    step('Latest seek wins; Stop cancels a candidate before it can publish a stale position');
    hold();await setSeek(page,1.3);await until(()=>Boolean(wasmGate?.entered),'first candidate native loader');
    await until(()=>seekState(page).then(value=>value.seeking),'seeking state');assert(await page.locator('#dmgSongCaptureButton').isDisabled());
    assert(await slider.isEnabled(),'the UI allows a newer target while the candidate is being prepared');
    const originalPosition=(await seekState(page)).frame;await page.keyboard.down('z');await page.keyboard.up('z');assert.equal(await read(page,'observeCode'),null,'keys cannot audition a partial seek');
    await setSeek(page,.22);await until(()=>seekState(page).then(value=>value.seeking&&Math.abs(value.target-.22)<1e-6),'new seek target queued');
    assert.equal((await seekState(page)).frame,originalPosition,'target preview does not replace the last heard position');release();
    await until(()=>seekState(page).then(value=>value.phase==='paused'&&!value.seeking&&value.frame===9702),'latest seek committed');
    hold();await setSeek(page,1.3);await until(()=>Boolean(wasmGate?.entered),'candidate before Stop');await page.locator('#dmgSongStopButton').click();await phase(page,'stopped');release();await wait(160);
    assert.equal((await seekState(page)).phase,'stopped');assert.equal((await seekState(page)).frame,0);await pcm(page,false);

    step('Code and source changes fence pending seek work without touching the captured author');
    await seek(page,.25);hold();await setSeek(page,1.3);await until(()=>Boolean(wasmGate?.entered),'candidate before Code');
    await page.locator('#synthInputCodeTab').click();
    for(let i=0;i<8;i++){const closed=page.locator('#dmgFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
    await page.locator('#dmgFilesTree button[data-file-path="/index.js"]').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(CODE_HOLD);
    await page.locator('#synthCodeRunButton').click();await wait(100);assert.equal(await read(page,'observeCode'),null,'Code waits for retired native candidate cleanup');release();
    await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'Code after seek cleanup');assert.equal((await seekState(page)).phase,'stopped');await pcm(page);assert.deepEqual((await read(page)).preset,captured);
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Idle|Stopped/.test(value)),'Code stopped');await page.locator('#synthInputKeyboardTab').click();await pcm(page,false);
    await seek(page,.25);hold();await setSeek(page,1.3);await until(()=>Boolean(wasmGate?.entered),'candidate before source change');
    await page.locator('#dmgSongSelect').selectOption('/vgm/reference.vgz');release();await until(()=>seekState(page).then(value=>value.phase==='stopped'&&!value.seeking),'source change cancels candidate');
    assert.equal(await page.locator('#dmgSongSelect').inputValue(),'/vgm/reference.vgz');await pcm(page,false);assert.deepEqual((await read(page)).preset,captured);

    step('390px seek controls fit; pagehide cancels pending work and closes all audible routes');
    await seek(page,1.12);await channel(page,2);await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await slider.scrollIntoViewIfNeeded();
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:['dmgSongSeek','dmgSongSeekPosition','dmgSongPlayButton','dmgSongCaptureButton'].map(id=>{const node=document.getElementById(id),rect=node.getBoundingClientRect();return{id,left:rect.left,right:rect.right};})}));
      assert(layout.scroll<=width+1);assert(layout.controls.every(value=>value.left>=-1&&value.right<=width+1));measurements['layout'+width]=layout;
      await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    hold();await setSeek(page,.3);await until(()=>Boolean(wasmGate?.entered),'candidate before pagehide');await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));release();
    await until(()=>page.evaluate(()=>__dmgSongAudit.graph()).then(value=>value.runningContexts===0&&value.liveSources===0),'pagehide native cleanup');
    const graph=await page.evaluate(()=>__dmgSongAudit.graph());assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert.equal(graph.destinationConnections,1);assert(graph.muted);
    assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,graph,pageErrors,consoleErrors};
  }catch(error){const diagnostic={stage,state:await seekState(page).catch(()=>null),audio:await page.locator('#audioStatus').textContent().catch(()=>''),code:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),commands:await page.evaluate(()=>__dmgSongAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors,consoleErrors};throw error;
  }finally{release();await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createDmgSongFixture,DMG_SONG_FUTURE_WAVE,DMG_SONG_INITIAL_WAVE}=await import(pathToFileURL(path.join(repo,'test/helpers/dmg_synth_song_fixture.mjs')).href);
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href),fixture={...createDmgSongFixture(),futureWave:DMG_SONG_FUTURE_WAVE,initialWave:DMG_SONG_INITIAL_WAVE};
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
