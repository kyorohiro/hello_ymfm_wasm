// SPDX-License-Identifier: BSD-3-Clause
// PSF CH Live display checks. Every destination is intercepted before application
// scripts and held at gain zero. Chromium is additionally launched mute-audio.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url'),{tmpdir}=require('node:os'),{chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',out:path.join(tmpdir(),'spu-synth-psf-live-browser.json'),screenshots:path.join(tmpdir(),'spu-psf-live-screenshots')};
for(const arg of process.argv.slice(2)){const m=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(m,'Unknown option '+arg);config[m[1]]=m[2];}
config.root=path.resolve(config.root);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const end=Date.now()+25000;while(Date.now()<end){if(await fn())return;await wait(30);}throw Error('Timeout: '+label);}
function silentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,
    post=MessagePort.prototype.postMessage,Worklet=window.AudioWorkletNode,start=AudioBufferSourceNode.prototype.start,
    stop=AudioBufferSourceNode.prototype.stop,stroke=CanvasRenderingContext2D.prototype.stroke,
    all=Promise.all,nativeTimer=window.setTimeout.bind(window);
  const contexts=[],meters=[],nodes=[],commands=[],starts=[],stops=[];let sequence=0,monitorStrokes=0,delayNextStop=0,stopDelays=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...ports){
    if(destination!==this.context.destination)return connect.call(this,destination,...ports);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...ports);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  AudioBufferSourceNode.prototype.start=function(...args){starts.push({at:this.context.currentTime,when:args[0],offset:args[1],duration:args[2],frames:this.buffer?.length,rate:this.buffer?.sampleRate});return start.apply(this,args);};
  AudioBufferSourceNode.prototype.stop=function(...args){stops.push({at:this.context.currentTime});return stop.apply(this,args);};
  CanvasRenderingContext2D.prototype.stroke=function(...args){if(['outputCanvas','outputEnvelopeCanvas'].includes(this.canvas.id))monitorStrokes++;return stroke.apply(this,args);};
  MessagePort.prototype.postMessage=function(message,...args){if(message?.method){commands.push({method:message.method,args:message.args});if(commands.length>10000)commands.shift();}return post.call(this,message,...args);};
  // Armed only once the PSF is playing and all startup promises have settled.
  // The next Promise.all is the song Stop cleanup; delay its acknowledgement
  // so a physical key-up deterministically overtakes a pending keyboard On.
  Promise.all=function(values){const result=all.call(this,values);if(!delayNextStop)return result;
    const delay=delayNextStop;delayNextStop=0;stopDelays++;return result.then(value=>new Promise(resolve=>nativeTimer(()=>resolve(value),delay)));};
  function output(){
    const values=meters.filter(item=>item.source.context.state==='running').map(item=>{
      const pcm=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(pcm);let peak=0,square=0;
      for(const value of pcm){peak=Math.max(peak,Math.abs(value));square+=value*value;}
      return {peak,rms:Math.sqrt(square/pcm.length),finite:pcm.every(Number.isFinite)};
    }).sort((a,b)=>b.rms-a.rms);
    return {...(values[0]??{peak:0,rms:0,finite:true}),muted:meters.every(item=>item.mute.gain.value===0)};
  }
  async function read(method='inspect',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-spu-synth')?.node;if(!node)throw Error('SPU editor Worklet missing');const id=--sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SPU audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});
  }
  window.__spuPsfAudit={read,instrument:()=>read('getInstrument',[0]),output,armStopDelay(ms=150){delayNextStop=ms;},
    graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(item=>item.name==='tetorica-spu-synth').length,
      destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0),bufferStarts:starts.length,bufferStops:stops.length,monitorStrokes,stopDelays}),
    starts:()=>starts.slice(),commands:()=>commands.slice()};
}
const missing=[],external=[],results=[];
async function runMetadata(){
  const hashes={};for(const relative of [config.entry.slice(1),'synth-spu/synth.js','synth-spu/spu_synth_panel.js','synth-spu/synth.css','synth-spu/psf_song_preview.js','synth-spu/psf_playback_core.js','synth-spu/psf_live_snapshot.js','generated/psf-player/psf_player.js','generated/psf-player/psf_player.wasm']){const bytes=await fs.readFile(path.join(config.root,relative));hashes[relative]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
  return {root:config.root,entry:config.entry,checkerSha256:createHash('sha256').update(await fs.readFile(__filename)).digest('hex'),assets:hashes};
}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.webp':'image/webp','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(file.startsWith(config.root+path.sep));res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'}).end(await fs.readFile(file));
}catch(error){missing.push(req.url);res.writeHead(404).end(error.message);}});
async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1000},serviceWorkers:'block'}),errors=[];page.setDefaultTimeout(25000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com')return route.abort();if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(silentAudit);
  await page.addInitScript(()=>{window.__spuLiveInput=[];window.__spuLivePauseMutations=[];new MutationObserver(records=>{for(const record of records)if(record.target.id==='psfPauseSong'){window.__spuLivePauseMutations.push({at:performance.now(),text:record.target.textContent});if(window.__spuLivePauseMutations.length>40)window.__spuLivePauseMutations.shift();}}).observe(document,{subtree:true,childList:true});for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>{window.__spuLiveInput.push({type,id:event.target.id,button:event.target.closest?.('button')?.id,x:event.clientX,y:event.clientY,trusted:event.isTrusted,at:performance.now()});},true);});
  const view=()=>page.evaluate(()=>({inert:document.getElementById('spuVoicePanel').inert,...document.getElementById('spuVoicePanel').dataset,status:document.getElementById('spuLiveStatus').textContent,seconds:Number(document.getElementById('psfSongPosition').dataset.seconds)}));
  const authored=()=>page.evaluate(()=>__spuPsfAudit.instrument());
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files ready');
    assert(await page.locator('#spuCodeLiveTools').isHidden());
    await page.locator('#startAudio').click();await until(()=>page.locator('#startAudio').textContent().then(text=>text==='Audio ready'),'audio ready');
    const original=await authored();
    await page.locator('#synthMenuButton').click();const chooser=page.waitForEvent('filechooser');await page.locator('#loadPsf').click();await(await chooser).setFiles({name:'live-fixture.psf',mimeType:'application/octet-stream',buffer:Buffer.from(fixture)});
    await until(()=>page.locator('#psfPlaySong').isEnabled(),'PSF import');await page.locator('[data-spu-editor-tab="pcm"]').click();
    await page.locator('#psfPlaySong').click();await until(async()=>{const v=await view();return v.observationKind==='psf'&&Number(v.observationFrame)>=2205;},'PSF observation');
    const playing=await view();assert(playing.inert);assert(Number(playing.observationFrame)<=Math.floor(playing.seconds*44100));
    assert(await page.locator('#spuLiveEnabled').isChecked());assert.equal(await page.locator('#spuLiveChannel option').count(),24);assert.equal(await page.locator('#spuLiveSourceLabel').textContent(),'PSF view');
    assert.equal(await page.locator('#spuLiveEnabledLabel').textContent(),'Live from PSF');
    await page.locator('#psfPauseSong').click();await until(()=>page.locator('#psfPauseSong').textContent().then(text=>text==='Resume'),'paused');
    // Genuine pointer clicks must survive repeated Live updates. In WebKit,
    // rewriting unchanged caption text used to cancel clicks across a tick.
    const pauseResumeCycles=name==='webkit'?30:0;
    for(let cycle=0;cycle<pauseResumeCycles;cycle++){
      await page.locator('#psfPauseSong').click({delay:5});await until(()=>page.locator('#psfPauseSong').textContent().then(text=>text==='Pause'),'stress resume '+cycle);
      await page.locator('#psfPauseSong').click({delay:5});await until(()=>page.locator('#psfPauseSong').textContent().then(text=>text==='Resume'),'stress pause '+cycle);
    }
    const pauseClicks=await page.evaluate(()=>__spuLiveInput.filter(event=>event.type==='click'&&event.button==='psfPauseSong'));
    assert.equal(pauseClicks.length,1+pauseResumeCycles*2);assert(pauseClicks.every(event=>event.trusted));
    const paused=await view();await wait(150);assert.equal((await view()).observationFrame,paused.observationFrame);
    assert.match(paused.status,/Paused.*frozen/);
    const commandsBefore=await page.evaluate(()=>__spuPsfAudit.commands().length);
    await page.locator('#spuLiveChannel').selectOption('1');
    assert.equal((await view()).observationFrame,paused.observationFrame);
    assert.equal(await page.locator('[data-noise="source"]').inputValue(),'noise');assert(await page.locator('[data-pmon="enabled"]').isChecked());
    assert(await page.locator('.pmon-fields').isHidden());
    await page.locator('[data-spu-editor-tab="fx"]').click();assert.equal(await page.locator('[data-chip-control="ps1-reverb-preset"]').inputValue(),'custom');
    assert.match(await page.locator('[data-psf-reverb-state]').textContent(),/Custom register configuration.*Main L/);
    assert.equal(await page.locator('[data-chip-control="ps1-reverb-left"]').inputValue(),String(0x2000/0x7fff));
    await page.locator('#spuLiveChannel').selectOption('23');assert.equal((await view()).observationFrame,paused.observationFrame);
    assert.equal(await page.locator('[data-noise="source"]').inputValue(),'sample');assert.equal(await page.locator('[data-pmon="enabled"]').isChecked(),false);
    await page.locator('#spuLiveChannel').selectOption('0');await page.locator('[data-spu-editor-tab="pcm"]').click();
    assert.match(await page.locator('[data-chip-control="ps1-waveform"]').getAttribute('aria-label'),/Read-only ADPCM preview/);
    assert.match(await page.locator('[data-chip-output="ps1-wave-info"]').textContent(),/Not the current audible waveform.*no root note/);
    assert.match(await page.locator('#spuLiveReadout').textContent(),/Gate request.*ENV.*ENDX.*Start.*Repeat.*programmed/);
    assert(await page.locator('.spu-morph').isHidden());
    for(const id of ['saveSoundToFiles','spuFileSaveSoundButton','savePreset'])assert.equal(await page.locator('#'+id).isEnabled(),false);
    assert.deepEqual(await authored(),original);
    const commandsAfter=await page.evaluate(()=>__spuPsfAudit.commands());
    assert(!commandsAfter.slice(commandsBefore).some(entry=>/^setInstrument|^instrumentNote|^load/.test(entry.method)));
    for(const width of [1240,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(config.screenshots,`${name}-paused-ch1-pcm-${width}.png`),fullPage:true});}
    await page.locator('#spuLiveEnabled').uncheck();assert.equal((await view()).inert,false);assert.equal((await view()).observationFrame,undefined);
    assert.equal(await page.locator('#psfPauseSong').textContent(),'Resume');assert.deepEqual(await authored(),original);assert(await page.locator('#saveSoundToFiles').isEnabled());
    assert.equal(await page.locator('[data-chip-control="ps1-reverb-preset"]').inputValue(),'off');
    // A real user edit after Live Off retains the existing stop-first ownership.
    await page.locator('[data-noise="source"]').selectOption('noise');await until(()=>page.locator('#psfPlaySong').isEnabled(),'edit stops PSF');
    await until(()=>page.locator('.spu-morph').isHidden(),'authored Noise hides Software morph');
    await page.locator('[data-noise="source"]').selectOption('sample');await until(()=>page.locator('.spu-morph').isVisible(),'authored Sample restores Software morph');
    await page.locator('[data-chip-action="ps1-wave-triangle"]').click();
    assert(await page.locator('#spuCodeLiveTools').isHidden());assert.equal((await view()).inert,false);
    const graph=await page.evaluate(()=>__spuPsfAudit.graph());assert(graph.muted);assert.equal(graph.contexts,1);assert.equal(graph.destinationConnections,1);
    assert.deepEqual(errors,[]);
    return {browser:name,passed:true,playing,paused,graph,pauseResumeCycles,trustedPauseClicks:pauseClicks.length,checks:['default-on physical CH1–24','audible-time snapshot','Pause frozen with CH switching; 30 WebKit Pause/Resume click cycles','actual Noise / PMON flags','custom shared reverb and returns','bounded source preview labels','readonly authored state and saves','Off restores editor; edit stops PSF; authored Noise hides Morph','desktop / mobile layout'],errors};
  }catch(error){error.receipt={browser:name,view:await view().catch(()=>null),input:await page.evaluate(()=>__spuLiveInput.slice(-12)).catch(()=>null),pauseMutations:await page.evaluate(()=>__spuLivePauseMutations).catch(()=>null),pauseButton:await page.locator('#psfPauseSong').boundingBox().catch(()=>null),errors,body:await page.locator('body').innerText().catch(()=>'' )};throw error;}finally{await page.close();}
}
(async()=>{
 await fs.rm(config.out,{force:true});
 const {createPsfSpuFeatureFixture}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_playback_fixture.mjs')).href);
 await fs.mkdir(config.screenshots,{recursive:true});
 const fixture=createPsfSpuFeatureFixture({pmon:true,noise:true,noiseClock:37,reverb:true,steps:[{delay:10000,writes:[[0x1c0,0x1234]]}]}).standalone;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
 try{for(const name of config.engines.split(',')){assert(['chromium','webkit'].includes(name));const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{} )});try{results.push(await check(browser,name,origin,fixture));}finally{await browser.close();}}
 assert.deepEqual(missing,[]);assert.deepEqual(external,[]);await fs.writeFile(config.out,JSON.stringify({...await runMetadata(),passed:true,physicalOutputMuted:true,listeningPerformed:false,results,missing,external},null,2)+'\n');console.log('PASS '+config.out);
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(async error=>{console.error(error.stack??error);if(error.receipt)console.error(JSON.stringify(error.receipt,null,2));const metadata=await runMetadata().catch(()=>({root:config.root,entry:config.entry}));await fs.writeFile(config.out,JSON.stringify({...metadata,passed:false,error:error.message,receipt:error.receipt??null,results,missing,external},null,2)+'\n').catch(cause=>console.error(cause.message));process.exitCode=1;});
