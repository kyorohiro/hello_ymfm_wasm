// SPDX-License-Identifier: BSD-3-Clause
// PSF ordinary ADPCM Capture checks. Every destination is intercepted before application
// scripts and held at gain zero. Chromium is additionally launched mute-audio.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url'),{tmpdir}=require('node:os'),{chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',out:path.join(tmpdir(),'spu-synth-psf-capture-browser.json'),screenshots:path.join(tmpdir(),'spu-psf-capture-screenshots')};
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
  const hashes={};for(const relative of [config.entry.slice(1),'synth-spu/synth.js','synth-spu/spu_synth_panel.js','synth-spu/synth.css','synth-spu/psf_song_preview.js','synth-spu/psf_playback_core.js','synth-spu/psf_live_snapshot.js','synth-spu/psf_capture.js','generated/psf-player/psf_player.js','generated/psf-player/psf_player.wasm']){const bytes=await fs.readFile(path.join(config.root,relative));hashes[relative]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
  return {root:config.root,entry:config.entry,checkerSha256:createHash('sha256').update(await fs.readFile(__filename)).digest('hex'),assets:hashes};
}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.webp':'image/webp','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(file.startsWith(config.root+path.sep));res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'}).end(await fs.readFile(file));
}catch(error){missing.push(req.url);res.writeHead(404).end(error.message);}});
async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1000},serviceWorkers:'block',acceptDownloads:true}),errors=[],checks=[];page.setDefaultTimeout(25000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='cdnjs.cloudflare.com')return route.abort();if(u.origin!==origin&&!['blob:','data:'].includes(u.protocol)){external.push(u.href);return route.abort();}return route.continue();});
  await page.addInitScript(silentAudit);
  await page.addInitScript(()=>{
    const post=MessagePort.prototype.postMessage,timer=setTimeout.bind(window);let delay=0,delayed=0;
    MessagePort.prototype.postMessage=function(message,...args){if(delay&&message?.method==='findADPCM'){const ms=delay;delay=0;delayed++;timer(()=>post.call(this,message,...args),ms);return;}return post.call(this,message,...args);};
    window.__spuCaptureAudit={armFindDelay(ms=300){delay=ms;},delayed:()=>delayed};
  });
  const inspect=()=>page.evaluate(()=>__spuPsfAudit.read('inspect'));
  const instrument=()=>page.evaluate(()=>__spuPsfAudit.instrument());
  const view=()=>page.evaluate(()=>({inert:document.getElementById('spuVoicePanel').inert,...document.getElementById('spuVoicePanel').dataset,status:document.getElementById('audioStatus').textContent}));
  const step=label=>{checks.push(label);console.log('CHECK '+name+': '+label);};
  async function menu(id){if(!await page.locator('#synthMenu').evaluate(n=>n.open))await page.locator('#synthMenuButton').click();await page.locator(id).click();}
  async function pause(){await page.locator('#psfPauseSong').click({delay:5});await until(()=>page.locator('#psfPauseSong').textContent().then(t=>t==='Resume'),'Pause');}
  async function playPaused(){await page.locator('#psfPlaySong').click({delay:5});await until(async()=>Number((await view()).observationFrame)>=2205,'audible Live snapshot');await pause();await until(()=>page.locator('#spuPsfCapture').isEnabled(),'Capture ready');}
  async function importDocument(doc){await page.locator('#presetFileInput').setInputFiles({name:'capture-roundtrip.spu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await until(()=>page.locator('#audioStatus').textContent().then(t=>t===`Loaded ${doc.name}.`),'instrument import');}
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files ready');
    assert(await page.locator('#spuPsfCaptureTools').isHidden());await page.locator('#startAudio').click();await until(()=>page.locator('#startAudio').textContent().then(t=>t==='Audio ready'),'audio');
    await page.locator('[data-spu-editor-tab="fx"]').click();await page.locator('[data-chip-control="ps1-reverb-preset"]').selectOption('room');
    for(const [part,value]of [['left','0.3'],['right','0.2']]){const input=page.locator(`[data-chip-control="ps1-reverb-${part}"]`);await input.fill(value);await input.dispatchEvent('change');}
    await until(async()=>{const s=await instrument();return s.reverb.preset==='room'&&Math.abs(s.reverb.volumeLeft-.3)<.0001&&Math.abs(s.reverb.volumeRight-.2)<.0001;},'editor shared reverb');
    const beforeSong=await instrument();
    const chooser=page.waitForEvent('filechooser');await menu('#loadPsf');await(await chooser).setFiles({name:'capture-fixture.psf',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.standalone)});
    await until(()=>page.locator('#psfPlaySong').isEnabled(),'PSF import');await page.locator('[data-spu-editor-tab="pcm"]').click();
    step('Capture requires Pause and Live; reference key is explicit and defaults to C4');
    await page.locator('#psfPlaySong').click({delay:5});await until(async()=>Number((await view()).observationFrame)>=2205,'playing Live');
    assert(await page.locator('#spuPsfCapture').isDisabled());assert.equal(await page.locator('#spuPsfReferenceKey').inputValue(),'C4');await pause();await until(()=>page.locator('#spuPsfCapture').isEnabled(),'paused Capture');
    const initialFrame=(await view()).observationFrame;assert((await view()).inert);
    step('Changing CH during readonly preflight cancels Capture and preserves the paused song and editor');
    let commandStart=await page.evaluate(()=>__spuPsfAudit.commands().length),delayed=await page.evaluate(()=>__spuCaptureAudit.delayed());
    await page.evaluate(()=>__spuCaptureAudit.armFindDelay());await page.locator('#spuPsfCapture').click({delay:5});assert(await page.locator('#spuPsfCapture').isDisabled());
    await until(async()=>await page.evaluate(()=>__spuCaptureAudit.delayed())>delayed,'delayed readonly lookup');await page.locator('#spuLiveChannel').selectOption('1');await wait(450);
    assert.equal(await page.locator('#psfPauseSong').textContent(),'Resume');assert.equal((await view()).observationFrame,initialFrame);assert.deepEqual(await instrument(),beforeSong);
    let commands=await page.evaluate(()=>__spuPsfAudit.commands());assert(!commands.slice(commandStart).some(c=>['stop','loadADPCM','setInstrumentPreset'].includes(c.method)));
    await page.locator('#spuLiveChannel').selectOption('0');await until(()=>page.locator('#spuPsfCapture').isEnabled(),'same CH ready');
    step('Resume during readonly preflight cancels Capture before any Stop or editor write');
    commandStart=await page.evaluate(()=>__spuPsfAudit.commands().length);delayed=await page.evaluate(()=>__spuCaptureAudit.delayed());await page.evaluate(()=>__spuCaptureAudit.armFindDelay());
    await page.locator('#spuPsfCapture').click({delay:5});await until(async()=>await page.evaluate(()=>__spuCaptureAudit.delayed())>delayed,'second delayed readonly lookup');
    await page.locator('#psfPauseSong').click({delay:5});await until(()=>page.locator('#psfPauseSong').textContent().then(t=>t==='Pause'),'Resume during Capture');await wait(450);
    assert.deepEqual(await instrument(),beforeSong);commands=await page.evaluate(()=>__spuPsfAudit.commands());assert(!commands.slice(commandStart).some(c=>['stop','loadADPCM','setInstrumentPreset'].includes(c.method)));
    await pause();await until(()=>page.locator('#spuPsfCapture').isEnabled(),'Capture ready again');
    await page.locator('#spuPsfReferenceKey').selectOption('C5');
    step('Genuine Capture copies original ADPCM, loops, ADSR and sends, keeps editor reverb, and never starts a note');
    commandStart=await page.evaluate(()=>__spuPsfAudit.commands().length);await page.locator('#spuPsfCapture').click({delay:5});
    await until(()=>page.locator('#audioStatus').textContent().then(t=>t.startsWith('Captured CH 1')),'Capture applied');
    const captured=await instrument(),firstBank=await inspect();assert.deepEqual(Array.from(captured.sample.adpcm),Array.from(fixture.adpcm));
    assert.equal(captured.preset.pitch,0x1800);assert.equal(captured.preset.adsr1,15);assert.equal(captured.preset.adsr2,0x1fc0);assert.equal(captured.preset.reverb,true);
    assert.deepEqual(captured.reverb,beforeSong.reverb);assert.equal(captured.noise.enabled,false);assert.equal(captured.pmon.enabled,false);assert.equal(captured.morph.enabled,false);assert.equal(captured.waveform,null);
    const referenceHz=440*2**((72-69)/12);assert(Math.abs(captured.sample.baseFrequencyHz-referenceHz*4096/0x1800)<1e-8);
    assert.equal(captured.sample.loopStartSamples,0);assert.equal((await view()).inert,false);assert(await page.locator('#spuCodeLiveTools').isHidden());assert.equal(firstBank.auditions.length,0);
    commands=await page.evaluate(()=>__spuPsfAudit.commands());assert(!commands.slice(commandStart).some(c=>['instrumentNoteOn','auditionOn'].includes(c.method)));
    assert.match((await view()).status,/C5 reproduces PITCH 6144.*new note.*envelope.*reverb kept/);
    step('Keyboard C5 reproduces the captured raw PITCH through the real SPU, upstream of gain zero');
    await page.locator('#octaveUp').click();const key=page.locator('#keyboardKeys .key').filter({hasText:'C5'}).first();await key.scrollIntoViewIfNeeded();const box=await key.boundingBox();assert(box);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await until(async()=>(await inspect()).auditions.length===1,'fresh keyboard note');
    const held=await inspect();assert.equal(held.channels[held.auditions[0].channel].pitch,0x1800);await until(async()=>{const p=await page.evaluate(()=>__spuPsfAudit.output());return p.muted&&p.finite&&p.rms>.00001;},'nonzero muted Capture PCM');
    await page.mouse.up();await page.locator('#stopAudio').click();
    step('Save to presets and exported SPU JSON preserve bytes and tuning; repeated Capture reuses immutable sample RAM');
    await page.locator('#saveSoundToFiles').click();await until(()=>page.locator('#spuFilesStatus').textContent().then(t=>t.includes('saved to /presets/')),'saved preset');
    const download=page.waitForEvent('download');await menu('#savePreset');const item=await download,saved=JSON.parse(await fs.readFile(await item.path(),'utf8'));
    assert.deepEqual(saved.sample.adpcm,Array.from(fixture.adpcm));assert.equal(saved.preset.pitch,0x1800);assert.equal(saved.sample.baseFrequencyHz,captured.sample.baseFrequencyHz);
    await playPaused();await page.locator('#spuPsfCapture').click({delay:5});await until(()=>page.locator('#audioStatus').textContent().then(t=>t.startsWith('Captured CH 1')),'repeat Capture');
    const secondBank=await inspect();assert.equal(secondBank.nextAddress,firstBank.nextAddress);assert.equal(secondBank.samples.length,firstBank.samples.length);
    step('Normal preset import stops Code temporary RAM ownership before resolving cached sample IDs');
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    const code=`const ps1=await useSoundChip('ps1'); await ps1.reset({clearRam:true}); const temporary=await ps1.loadADPCM(new Uint8Array(${JSON.stringify(Array.from(fixture.adpcm))}),{baseFrequencyHz:${captured.sample.baseFrequencyHz},loopStartSamples:0}); await ps1.setPreset(CH1,{sample:temporary}); log('temporary-capture-ready');`;
    await page.locator('#synthCodeEditor').fill(code);await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeLog').textContent().then(t=>t.includes('temporary-capture-ready')),'temporary Code bank');
    assert.equal((await inspect()).samples[0].id,0);commandStart=await page.evaluate(()=>__spuPsfAudit.commands().length);await importDocument(saved);
    commands=(await page.evaluate(()=>__spuPsfAudit.commands())).slice(commandStart);const lookup=commands.findIndex(c=>c.method==='findADPCM'),stop=commands.findIndex(c=>c.method==='stop');assert(stop>=0&&lookup>stop,'Code Stop precedes sample lookup in ordinary imports');
    assert.deepEqual(Array.from((await instrument()).sample.adpcm),Array.from(fixture.adpcm));assert.equal((await inspect()).nextAddress,firstBank.nextAddress);
    step('Actual editor RAM exhaustion fails preflight without stopping the paused PSF or replacing its instrument');
    const capacity=await inspect(),length=Math.floor((524288-capacity.nextAddress-32)/16)*16,adpcm=Array(length).fill(0);for(let at=0;at<length;at+=16)adpcm[at]=12;adpcm[length-15]=1;
    const filler={...saved,name:'Capacity guard fixture',preset:{...saved.preset,pitch:4096,reverb:false},sample:{adpcm,baseFrequencyHz:440},waveform:null};
    await importDocument(filler);const full=await inspect(),fullSource=await instrument();assert.equal(524288-full.nextAddress,32);
    await playPaused();await page.locator('#spuPsfReferenceKey').selectOption('C4');const frameBefore=(await view()).observationFrame;
    await page.locator('#spuPsfCapture').click({delay:5});await until(()=>page.locator('#audioStatus').textContent().then(t=>t.includes('free SPU sample RAM')),'capacity error');
    assert.equal(await page.locator('#psfPauseSong').textContent(),'Resume');assert.equal((await view()).observationFrame,frameBefore);assert.deepEqual(await instrument(),fullSource);assert.equal((await inspect()).nextAddress,full.nextAddress);
    for(const width of [1240,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(config.screenshots,`${name}-paused-capture-${width}.png`),fullPage:true});}
    await page.locator('#psfStopSong').click();const graph=await page.evaluate(()=>__spuPsfAudit.graph());assert(graph.muted);assert.equal(graph.contexts,1);assert.equal(graph.destinationConnections,1);assert.deepEqual(errors,[]);
    return {browser:name,passed:true,checks,referenceNote:'C5',rawPitch:0x1800,adpcmBytes:fixture.adpcm.length,firstNextAddress:firstBank.nextAddress,secondNextAddress:secondBank.nextAddress,capacityRemaining:32,graph,errors};
  }catch(error){error.receipt={browser:name,checks,view:await view().catch(()=>null),errors,body:await page.locator('body').innerText().catch(()=>'' )};throw error;}finally{await page.close();}
}
(async()=>{
 await fs.rm(config.out,{force:true});await fs.mkdir(config.screenshots,{recursive:true});
 const {createPsfSpuFeatureFixture}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_playback_fixture.mjs')).href);
 const fixture=createPsfSpuFeatureFixture({pitch:0x1800,reverb:true,steps:[{delay:10000,writes:[[0x1c0,0x1234]]}]});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
 try{for(const name of config.engines.split(',')){assert(['chromium','webkit'].includes(name));const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{} )});try{results.push(await check(browser,name,origin,fixture));}finally{await browser.close();}}
 assert.deepEqual(missing,[]);assert.deepEqual(external,[]);await fs.writeFile(config.out,JSON.stringify({...await runMetadata(),passed:true,physicalOutputMuted:true,listeningPerformed:false,results,missing,external},null,2)+'\n');console.log('PASS '+config.out);
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(async error=>{console.error(error.stack??error);if(error.receipt)console.error(JSON.stringify(error.receipt,null,2));const metadata=await runMetadata().catch(()=>({root:config.root,entry:config.entry}));await fs.writeFile(config.out,JSON.stringify({...metadata,passed:false,error:error.message,receipt:error.receipt??null,results,missing,external},null,2)+'\n').catch(cause=>console.error(cause.message));process.exitCode=1;});
