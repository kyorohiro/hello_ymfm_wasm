// SPDX-License-Identifier: BSD-3-Clause
// Original VGM / VGZ, actual DMG APU, headless only. Intercept every speaker
// destination before app JS and force gain zero; Chromium is muted as well.
// node scripts/check_dmg_synth_song_browser.cjs --root=docs --entry=/synth-dmg/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os'),{gzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-dmg/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'dmg-synth-song-browser.json'),screenshots:path.join(tmpdir(),'dmg-synth-song-browser')};
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

async function check(browser,name,origin,fixture,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'});
  const pageErrors=[],consoleErrors=[],checks=[],measurements={};let stage='startup',wasmGate=null;
  page.setDefaultTimeout(20000);page.on('pageerror',error=>pageErrors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}
    if(wasmGate&&/gameboy_apu_wasm\.wasm$/.test(url.pathname)){const gate=wasmGate;gate.entered=true;await new Promise(resolve=>{gate.release=resolve;});}
    return route.continue();});
  await page.addInitScript(installSilentAudit);
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Original VGM / VGZ sources live in /vgm; import, selection and restore do not start audio');
    await page.locator('#vgmFileInput').setInputFiles({name:'reference.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
    await until(()=>page.locator('#dmgSongSelect option[value="/vgm/reference.vgm"]').count().then(Boolean),'imported VGM source');
    await page.locator('#dmgFilesInput').setInputFiles({name:'reference.vgz',mimeType:'application/gzip',buffer:gzipSync(fixture.bytes)});
    await until(()=>page.locator('#dmgSongSelect option[value="/vgm/reference.vgz"]').count().then(Boolean),'imported VGZ source');
    await choose(page,'/vgm/reference.vgm');assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');assert.equal(await page.locator('#instrumentName').inputValue(),'Pulse');
    const projectBytes=await download(page,'#dmgProjectExportButton'),project=await loadCassette(projectBytes);
    assert.deepEqual(Buffer.from(project.files.get('vgm/reference.vgm').data??project.files.get('vgm/reference.vgm')),Buffer.from(fixture.bytes));
    measurements.projectBytes=projectBytes.length;

    step('Invalid and cancelled file reads preserve the selected source and authored sound');
    await page.locator('#vgmFileInput').setInputFiles({name:'invalid.vgm',mimeType:'application/octet-stream',buffer:Buffer.from('not a VGM')});
    await until(()=>page.locator('#vgmStatus').textContent().then(value=>/failed|extraction:/i.test(value)),'invalid input reported');
    assert.equal(await page.locator('#dmgSongSelect').inputValue(),'/vgm/reference.vgm');
    await page.locator('#vgmFileInput').setInputFiles({name:'slow.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
    if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
    await page.locator('#cancelVgm').click();await wait(650);assert.equal(await page.locator('#dmgSongSelect option[value="/vgm/slow.vgm"]').count(),0);
    assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);
    await page.locator('#startAudio').click();await until(async()=>{try{return Boolean((await read(page)).preset);}catch{return false;}},'author APU');
    const author=await read(page);await page.locator('#dmgFilesToggle').click();

    step('Live follows audible position, not prefetched future writes, through the same editor');
    await page.locator('#dmgSongChannelSelect').selectOption('0');await play(page);await pcm(page);
    const history=[];await until(async()=>{const value=await state(page);history.push(value);return value.frame>=Math.round(1.05*44100);},'future register change becomes audible');
    const early=history.filter(value=>value.frame>4410&&value.frame<Math.round(.87*44100));assert(early.length>=2,'observed real pre-boundary playback');
    assert(early.every(value=>value.duty==='0.25'),'future Duty must not leak out of render-ahead');
    assert(early.some(value=>value.rendered>39690),'actual queued audio passed the future write while Live stayed at the audible position');
    const late=history.filter(value=>value.frame>=Math.round(.96*44100));assert(late.length&&late.every(value=>value.duty==='0.75'));
    measurements.liveBoundary=history;await pause(page);const frozen=await state(page);await wait(160);assert.equal((await state(page)).frame,frozen.frame);
    assert.equal(frozen.readonly,'true');assert(await page.locator('#voiceEditor').evaluate(node=>node.inert));assert.deepEqual((await read(page)).preset,author.preset);

    step('Pause freezes all four channels; CH changes and Live Off / On only change observation');
    await page.evaluate(()=>__dmgSongAudit.drain());
    for(const [channel,kind]of [[0,'Pulse'],[1,'Pulse'],[2,'Wave'],[3,'Noise']]){
      await page.locator('#dmgSongChannelSelect').selectOption(String(channel));
      await until(()=>page.locator('#dmgSongReadout').textContent().then(value=>value.includes(`CH ${channel+1} · ${kind}`)),'Live '+kind);
      assert.equal((await state(page)).frame,frozen.frame);
      if(channel===1)assert.equal((await state(page)).duty,'0.125');
      if(channel===2)assert.deepEqual(await page.evaluate(()=>__dmgSongAudit.wave()),fixture.futureWave);
      if(channel===3){assert.equal(await page.locator('#noiseVolume').textContent(),'6');assert.equal(await page.locator('#noiseDivisor').textContent(),'3');assert.equal(await page.locator('#noiseShift').textContent(),'1');assert.equal(await page.locator('#noiseWidth [aria-checked=true]').getAttribute('data-choice-value'),'7');}
    }
    await page.locator('#dmgSongLiveEnabled').uncheck();const off=await state(page);await wait(120);assert.equal((await state(page)).frame,frozen.frame);assert.equal(off.readonly,'true');assert.match(off.live,/Frozen|Paused/);
    await page.locator('#dmgSongLiveEnabled').check();assert.equal((await state(page)).frame,frozen.frame);
    assert(!(await page.evaluate(()=>__dmgSongAudit.drain())).some(command=>['code','beginCode','noteOn','noteOff','setPreset','loadPreset','stop'].includes(command.method)),'observing never writes the authored APU');
    await page.locator('#dmgSongChannelSelect').selectOption('2');await fs.mkdir(config.screenshots,{recursive:true});
    await page.locator('#dmgSongPlayer').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(config.screenshots,name+'-paused-wave.png'),fullPage:true});
    await page.locator('#dmgSongChannelSelect').selectOption('3');await page.locator('#dmgSongLiveEnabled').uncheck();
    await play(page);await until(()=>state(page).then(value=>value.frame>72765+2205),'Resume advances past the authored DAC-off writes');
    assert.equal(await page.locator('#noiseVolume').textContent(),'6','Live Off retains the old Noise settings while audio keeps advancing');
    await page.locator('#dmgSongLiveEnabled').check();await until(()=>page.locator('#noiseVolume').textContent().then(value=>value==='0'),'Live On catches up to the audible DAC-off event');
    await until(()=>state(page).then(value=>value.phase==='ended'),'song EOF');await pcm(page,false);assert.deepEqual((await read(page)).preset,author.preset);

    step('The reference APU uses one Master / monitor path; keyboard cannot layer over the song');
    await page.locator('#dmgSongChannelSelect').selectOption('0');await play(page);await pcm(page);await wait(110);
    const normal=await page.evaluate(()=>__dmgSongAudit.output());
    await page.locator('#masterVolume').evaluate(input=>{input.value='.35';input.dispatchEvent(new Event('input',{bubbles:true}));});await wait(110);
    const half=await page.evaluate(()=>__dmgSongAudit.output());measurements.master={normal,half,ratio:half.rms/normal.rms};
    assert(half.rms/normal.rms>.35&&half.rms/normal.rms<.65,'Master scales the actual output once');
    await page.locator('#masterVolume').evaluate(input=>{input.value='.7';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.evaluate(()=>__dmgSongAudit.drain());await page.keyboard.down('z');await page.keyboard.up('z');
    assert(!(await page.evaluate(()=>__dmgSongAudit.drain())).some(command=>command.method==='noteOn'),'song excludes ordinary keyboard auditions');
    const graph=await page.evaluate(()=>__dmgSongAudit.graph());assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert.equal(graph.destinationConnections,1);assert(graph.muted);measurements.graph=graph;
    await stop(page);assert.equal((await state(page)).readonly,'false');assert.deepEqual((await read(page)).preset,author.preset);

    step('Code and song ownership are exclusive, including cancelled slow reference initialization');
    await files(page);await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    await page.locator('#synthCodeEditor').fill(`const gb=await useSoundChip('gameboy');\nawait gb.initialize();\nawait gb.pulse.setVoice(0,{duty:.5,volume:5,envelope:{direction:'down',period:0}});\nawait gb.pulse.noteOn(0,'C4');\n`);
    await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'Code owner');await pcm(page);
    await play(page);assert.equal(await read(page,'observeCode'),null,'Play closes the Code lease before reference output');await pcm(page);
    await stop(page);wasmGate={entered:false,release:null};
    await page.locator('#dmgSongPlayButton').click();await until(()=>Boolean(wasmGate?.entered),'deferred reference WASM load');
    await page.locator('#dmgSongStopButton').click();await phase(page,'stopped');
    await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'new Code owner during old song startup');
    const gate=wasmGate;wasmGate=null;gate.release();await wait(250);
    assert.equal((await state(page)).phase,'stopped');assert(await read(page,'observeCode'));await pcm(page);
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code Stop');await pcm(page,false);
    assert.deepEqual((await read(page)).preset,author.preset);

    step('Project reload remains passive; 390px controls fit and Stop / pagehide retire all song sources');
    await page.locator('#dmgProjectFileInput').setInputFiles({name:'song-project.zip',mimeType:'application/zip',buffer:projectBytes});
    await until(()=>page.locator('#dmgFilesStatus').textContent().then(value=>/imported|loaded/i.test(value)),'project restored');
    assert.notEqual((await state(page)).phase,'playing');await wait(200);await page.reload();await files(page);
    await until(()=>page.locator('#dmgSongSelect option[value="/vgm/reference.vgz"]').count().then(Boolean),'song library restored');
    assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);assert.notEqual((await state(page)).phase,'playing');
    await choose(page,'/vgm/reference.vgz');await play(page);await pcm(page);await pause(page);
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#dmgSongPlayer').scrollIntoViewIfNeeded();
      const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#dmgSongPlayer select,#dmgSongPlayer button')].map(node=>({id:node.id,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));
      assert(bounds.scroll<=width+1,'song layout fits '+width);assert(bounds.controls.every(item=>item.left>=-1&&item.right<=width+1));measurements['layout'+width]=bounds;
      await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    await stop(page);await wait(100);const afterStop=await page.evaluate(()=>__dmgSongAudit.graph());assert.equal(afterStop.liveSources,0);
    await play(page);await pcm(page);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await until(()=>page.evaluate(()=>__dmgSongAudit.graph()).then(value=>value.runningContexts===0&&value.liveSources===0),'pagehide releases sources and closes context');
    const finalGraph=await page.evaluate(()=>__dmgSongAudit.graph());assert(finalGraph.muted);assert.equal(finalGraph.liveSources,0);
    assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,measurements,graph:finalGraph,pageErrors,consoleErrors};
  }catch(error){
    const diagnostic={stage,state:await state(page).catch(()=>null),audio:await page.locator('#audioStatus').textContent().catch(()=>''),code:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),files:await page.locator('#dmgFilesStatus').textContent().catch(()=>''),graph:await page.evaluate(()=>__dmgSongAudit.graph()).catch(()=>null),commands:await page.evaluate(()=>__dmgSongAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors,consoleErrors};throw error;
  }finally{wasmGate?.release?.();wasmGate=null;await page.close();}
}

const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createDmgSongFixture,DMG_SONG_FUTURE_WAVE}=await import(pathToFileURL(path.join(repo,'test/helpers/dmg_synth_song_fixture.mjs')).href);
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href),fixture={...createDmgSongFixture(),futureWave:DMG_SONG_FUTURE_WAVE};
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
