// SPDX-License-Identifier: BSD-3-Clause
// Original HuC6280 VGM / VGZ fixtures and the real WASM/audio route. No speaker
// receives audio: intercept every destination before application JS, use gain 0,
// and also launch Chromium with --mute-audio. This is not a listening test.
// node scripts/check_huc6280_synth_cache_browser.cjs --root=docs --entry=/synth-huc6280/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'huc6280-synth-cache-browser.json'),screenshots:path.join(tmpdir(),'huc6280-synth-cache-images')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(25);}throw Error('Timeout: '+label);}


const wave=Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16)));
const laterWave=Array.from({length:32},(_,i)=>(i*7)%32),modulatorWave=Array.from({length:32},(_,i)=>(i*3+5)%32);
const write=(register,value)=>[0xb9,register,value];
function upload(channel,values,{volume=23,balance=255,period=428}={}){
  return [...write(0,channel),...write(4,64),...write(4,0),...values.flatMap(value=>write(6,value)),
    ...write(5,balance),...write(2,period&255),...write(3,period>>8),...write(7,0),...write(4,128|volume)];
}
const alternateWave=Array.from({length:32},(_,i)=>(i*5+7)%32);
const u32=value=>[value&255,value>>>8&255,value>>>16&255,value>>>24&255];
function makeFixture({alternate=false}={}){
  const commands=[];let samples=0;
  const sleep=frames=>{while(frames){const count=Math.min(65535,frames);commands.push(0x61,count&255,count>>8);samples+=count;frames-=count;}};
  const first=alternate?alternateWave:wave,last=alternate?wave:laterWave,pcm=Array.from({length:32},(_,i)=>(i*7+3)%32);
  commands.push(...write(1,255),...write(8,0),...write(9,0),...upload(0,first,{period:500,volume:19,balance:0xe7}),
    ...upload(1,modulatorWave,{period:713,volume:0}),...upload(2,laterWave,{period:360,volume:21,balance:0xbd}),
    ...write(0,3),...write(2,444&255),...write(3,444>>8),...write(5,0xcb),...write(4,0xc0|20),
    0x67,0x66,5,...u32(pcm.length),...pcm,0x90,0,0x1b,3,6,0x91,0,5,1,0,0x92,0,...u32(11025),0x93,0,...u32(0),129,...u32(pcm.length),
    ...write(0,4),...write(5,0xf8),...write(7,0x8d),...write(4,0x80|17),...write(0,5),...write(5,0xff),...write(7,0),...write(4,0));
  sleep(44100);commands.push(...write(0,0),...write(4,128|25));sleep(19*44100);
  commands.push(...upload(0,last,{period:250,volume:17,balance:0x6c}),...write(0,4),...write(7,0x83),...write(4,128|11),...write(8,7),...write(9,2));sleep(20*44100);
  commands.push(...upload(0,first,{period:333,volume:20,balance:0xab}),...write(9,0),...write(0,4),...write(7,0x93),...write(4,128|9));sleep(40*44100);
  commands.push(...upload(0,last,{period:240,volume:23,balance:0xf9}),...upload(1,modulatorWave,{period:17,volume:0}),...write(8,5),...write(9,1),...write(0,4),...write(7,0x87),...write(4,128|14));sleep(40*44100+123);commands.push(0x94,0,0x66);
  const bytes=Buffer.alloc(256+commands.length);bytes.write('Vgm ');bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x171,8);
  bytes.writeUInt32LE(samples,0x18);bytes.writeUInt32LE(0xcc,0x34);bytes.writeUInt32LE(3579545,0xa4);bytes.set(commands,256);return{bytes,samples,alternate};
}
function installSilentAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],sources=[],commands=[];let request=0,lastWave=null,trialGate=null,pcmCapture=null;
  const begin=CanvasRenderingContext2D.prototype.beginPath,move=CanvasRenderingContext2D.prototype.moveTo,line=CanvasRenderingContext2D.prototype.lineTo,stroke=CanvasRenderingContext2D.prototype.stroke,fill=CanvasRenderingContext2D.prototype.fillRect,paths=new WeakMap();
  CanvasRenderingContext2D.prototype.fillRect=function(...args){if(this.canvas.id==='waveCanvas')lastWave=null;return fill.apply(this,args);};
  CanvasRenderingContext2D.prototype.beginPath=function(...args){if(this.canvas.id==='waveCanvas')paths.set(this,[]);return begin.apply(this,args);};
  for(const[name,original]of[['moveTo',move],['lineTo',line]])CanvasRenderingContext2D.prototype[name]=function(x,y){paths.get(this)?.push([x,y]);return original.call(this,x,y);};
  CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='waveCanvas'&&this.strokeStyle==='#ffb04f'){
    const points=paths.get(this);if(points?.length===64)lastWave=Array.from({length:32},(_,i)=>Math.round((this.canvas.height-25-points[i*2][1])/(this.canvas.height-43)*31));
  }return stroke.apply(this,args);};
  window.AudioContext=class extends Context{
    constructor(...args){super(...args);contexts.push(this);}
    createBufferSource(){const source=super.createBufferSource(),item={started:false,stopped:false,ended:false};sources.push(item);
      const start=source.start,stop=source.stop;source.start=function(...args){const result=start.apply(this,args);item.started=true;if(pcmCapture&&source.buffer&&pcmCapture.frames<pcmCapture.limit){const buffer=source.buffer,offset=Math.round((args[1]??0)*buffer.sampleRate),count=Math.min(buffer.length-offset,pcmCapture.limit-pcmCapture.frames);if(count>0){pcmCapture.rates.push(buffer.sampleRate);for(let channel=0;channel<2;channel++)pcmCapture.channels[channel].push(...buffer.getChannelData(Math.min(channel,buffer.numberOfChannels-1)).subarray(offset,offset+count));pcmCapture.frames+=count;}}return result;};source.stop=function(...args){item.stopped=true;return stop.apply(this,args);};
      source.addEventListener('ended',()=>{item.ended=true;});return source;}
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);const item={node:this,name,disposed:false};nodes.push(item);const disconnect=this.disconnect;this.disconnect=function(...args){item.disconnected=true;return disconnect.apply(this,args);};}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){const item=nodes.find(value=>value.node.port===this);
    if(data?.method==='dispose'&&item)item.disposed=true;
    if(data?.method){commands.push({method:data.method,args:data.method==='code'?data.args?.slice(0,2):[]});if(commands.length>1500)commands.shift();}
    if(trialGate&&!trialGate.entered&&data?.method==='loadPreset'&&item&&nodes.indexOf(item)>0){
      trialGate.entered=true;trialGate.release=()=>{if(!item.disposed)post.call(this,data,...args);};return;
    }
    return post.call(this,data,...args);};
  function output(){const active=meters.filter(item=>item.source.context.state==='running').map(item=>{
    const values=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0;
    for(const value of values){sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2)),peak,finite:values.every(Number.isFinite)};
  }).sort((a,b)=>b.acRms-a.acRms);return{...(active[0]??{rms:0,acRms:0,peak:0,finite:true}),muted:meters.every(item=>item.mute.gain.value===0)};}
  async function read(method='read',which='author'){
    const matching=nodes.filter(item=>item.name==='tetorica-huc6280-synth'&&!item.disposed),node=(which==='author'?matching[0]:matching.at(-1))?.node;if(!node||which==='trial'&&matching.length<2)throw Error('HuC6280 '+which+' Worklet missing');const id=--request;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('HuC6280 audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Object.assign(Error(data.error),{name:data.name??'Error'})):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args:[]});});
  }
  window.__hucSongAudit={armPcm(limit=4096){pcmCapture={limit,frames:0,rates:[],channels:[[],[]]};},capturedPcm:()=>pcmCapture,read,output,wave:()=>lastWave?.slice()??null,drain:()=>commands.splice(0),gateNextTrial(){trialGate={entered:false,release:null};},gate:()=>({entered:trialGate?.entered??false}),
    releaseTrialGate(){const gate=trialGate;trialGate=null;gate?.release?.();},graph:()=>({contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,
    editorWorklets:nodes.filter(item=>item.name==='tetorica-huc6280-synth').length,liveWorklets:nodes.filter(item=>item.name==='tetorica-huc6280-synth'&&!item.disposed&&!item.disconnected).length,destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0),
    bufferSources:sources.length,liveSources:sources.filter(item=>item.started&&!item.stopped&&!item.ended).length})};
}
const graph=page=>page.evaluate(()=>__hucSongAudit.graph()),read=(page,method='read',which='author')=>page.evaluate(({method,which})=>__hucSongAudit.read(method,which),{method,which});
const state=page=>page.evaluate(()=>{const node=document.querySelector('#hucSongPlayer');return{...node.dataset,phase:node.dataset.state,frame:Number(node.dataset.positionFrames),
  rendered:Number(node.dataset.renderedFrames),status:document.querySelector('#hucSongStatus').textContent,position:document.querySelector('#hucSongPosition').textContent,source:document.querySelector('#hucSongSelect').value};});
async function phase(page,expected){await until(()=>state(page).then(value=>value.phase===expected),'song '+expected);}
async function pcm(page,audible=true){let value;await until(async()=>{value=await page.evaluate(()=>__hucSongAudit.output());return value.muted&&value.finite&&(audible?value.acRms>.00005:value.peak<1e-7);},audible?'actual song PCM':'output silence');return value;}
async function files(page){if(await page.locator('#hucFilesPanel').isHidden())await page.locator('#hucFilesToggle').click();await until(()=>page.locator('#hucFileImportButton').isEnabled(),'Files ready');}
async function choose(page,value){await page.locator('#hucSongSelect').selectOption(value);await until(async()=>await page.locator('#hucSongSelect').inputValue()===value&&!await page.locator('#hucSongPlayButton').isDisabled(),'song selected');}
async function play(page){await page.locator('#hucSongPlayButton').click();await phase(page,'playing');}
async function pause(page){await page.locator('#hucSongPlayButton').click();await phase(page,'paused');await pcm(page,false);}
async function stop(page){await page.locator('#hucSongStopButton').click();await phase(page,'stopped');await pcm(page,false);assert.equal((await state(page)).frame,0);}
async function selectIndex(page){await files(page);for(let i=0;i<12;i++){const closed=page.locator('#hucFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#hucFilesTree [data-file-path="/index.js"]').click();await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});}
const view=page=>page.evaluate(()=>({tools:{...document.querySelector('#hucCodeLiveTools').dataset},editor:{...document.querySelector('#voiceEditor').dataset},
  channel:document.querySelector('#hucChannelSelect').value,source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,
  volume:Number(document.querySelector('#volume').textContent),noise:Number(document.querySelector('#noiseFrequency').textContent),readout:document.querySelector('#hucChannelReadout').textContent,
  capture:document.querySelector('#hucSongCaptureStatus')?.textContent??'',captureDisabled:document.querySelector('#hucSongCaptureButton')?.disabled,
  wave:__hucSongAudit.wave()}));
async function channel(page,value){await page.locator('#hucChannelSelect').selectOption(String(value));await until(()=>view(page).then(v=>v.channel===String(value)&&v.tools.channel===String(value)),'view '+value);}
async function openMenu(page){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();}
async function download(page,selector){if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu'))))await openMenu(page);
  const pending=page.waitForEvent('download');await page.locator(selector).click();const item=await pending,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}
async function frozen(page,expected){const now=await state(page);assert.equal(now.phase,'paused');assert.equal(now.frame,expected.frame);assert.equal(now.rendered,expected.rendered);assert.equal(now.source,expected.source);}

const cacheStats=page=>page.evaluate(()=>{const d=document.querySelector('#hucSongPlayer').dataset;return{enabled:d.cacheEnabled==='true',count:Number(d.cacheCount),bytes:Number(d.cacheBytes),hits:Number(d.cacheHits),misses:Number(d.cacheMisses),restoredFrame:Number(d.cacheRestoredFrame),reconstructedFrames:Number(d.cacheReconstructedFrames)};});
function pcmHash(value){return hash(Buffer.concat(value.channels.map(values=>Buffer.from(Float32Array.from(values).buffer))));}
async function check(browser,name,origin,fixtures){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup',wasmGate=null;
  page.setDefaultTimeout(30000);await page.addInitScript(installSilentAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}
    if(wasmGate?.armed&&/\/huc6280_wasm\.wasm$/.test(url.pathname)){const gate=wasmGate;gate.armed=false;gate.entered=true;gate.route=route;return new Promise(resolve=>gate.resolve=resolve);}return route.continue();});
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);},bar=page.locator('#hucSongSeek'),cacheCheckbox=page.locator('#hucSongCacheEnabled');
  const mask=()=>page.locator('#hucSongPlayer').getAttribute('data-channel-mute-mask');
  const seek=async seconds=>{await bar.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},seconds);};
  async function idle(){await until(()=>state(page).then(value=>value.seeking==='false'&&value.seekPreparing==='false'),'seek cleanup');}
  async function seekPaused(seconds){const started=Date.now();await seek(seconds);await until(()=>state(page).then(value=>value.phase==='paused'&&value.frame===Math.round(seconds*44100)),'paused seek '+seconds,60000);await idle();await until(()=>view(page).then(value=>Number(value.editor.positionFrames)===Math.round(seconds*44100)),'exact destination snapshot');return{milliseconds:Date.now()-started,stats:await cacheStats(page)};}
  async function setCache(enabled){if(enabled)await cacheCheckbox.check();else await cacheCheckbox.uncheck();await until(()=>cacheStats(page).then(value=>value.enabled===enabled),'cache preference');}
  function bounded(value){assert(Number.isInteger(value.count)&&value.count>=0&&value.count<=64);assert(Number.isInteger(value.bytes)&&value.bytes>=0&&value.bytes<=8*1024*1024);}
  function empty(value){assert.equal(value.count,0);assert.equal(value.bytes,0);assert.equal(value.hits,0);assert.equal(value.misses,0);}
  async function clearCache(){const button=page.locator('#hucSongClearCache');let close=null;if(await button.isHidden()){const detail=page.locator('details:has(#hucSongClearCache)').last();if(await detail.count()&&!await detail.evaluate(node=>node.open)){await detail.locator(':scope > summary').click();close=detail;}}
    if(await button.isEnabled()){await button.click();assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'hucSongClearCache');}else assert.equal((await cacheStats(page)).count,0);
    await until(()=>cacheStats(page).then(value=>value.count===0&&value.bytes===0),'cache cleared');if(close)await close.locator(':scope > summary').click();}
  async function importSource(key){const f=fixtures[key],name='cache-'+key+'.vgm';await page.locator('#vgmFileInput').setInputFiles({name,mimeType:'application/octet-stream',buffer:f.bytes});await until(()=>page.locator('#vgmLibrary').getAttribute('data-loading').then(value=>value==='false'),'source analysis '+key);await choose(page,'/vgm/'+name);}
  async function sample(frames=4096){await page.evaluate(limit=>__hucSongAudit.armPcm(limit),frames);await play(page);await until(()=>page.evaluate(()=>__hucSongAudit.capturedPcm()?.frames??0).then(value=>value>=frames),'scheduled native PCM');const captured=await page.evaluate(()=>__hucSongAudit.capturedPcm());await pause(page);assert.equal(captured.frames,frames);assert(captured.rates.every(rate=>rate===44100));assert(captured.channels.every(values=>values.length===frames&&values.every(Number.isFinite)));assert(captured.channels.some(values=>values.some(value=>Math.abs(value)>.00001)));return captured;}
  const signature=()=>page.evaluate(()=>({source:document.querySelector('#voiceEditor').dataset.source,volume:document.querySelector('#volume').textContent,wave:__hucSongAudit.wave(),period:document.querySelector('#voiceEditor').dataset.period,gate:document.querySelector('#voiceEditor').dataset.gate,lfo:document.querySelector('#lfoEnabled').checked,rate:document.querySelector('#lfoFrequency').textContent}));
  async function armSeek(seconds){assert(!wasmGate);wasmGate={armed:true,entered:false};await seek(seconds);await until(()=>Boolean(wasmGate?.entered),'candidate WASM held');await phase(page,'seeking');}
  async function releaseGate(){const gate=wasmGate;wasmGate=null;if(gate?.route)try{await gate.route.continue();}catch{}finally{gate.resolve?.();}}
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Cache defaults On; preference and Clear are passive and do not initialize audio before a performance');
    assert(await cacheCheckbox.isChecked());empty(await cacheStats(page));await importSource('main');await importSource('other');await choose(page,'/vgm/cache-main.vgm');
    await setCache(false);empty(await cacheStats(page));await setCache(true);empty(await cacheStats(page));await clearCache();assert.equal((await graph(page)).contexts,0);
    const projectBytes=await download(page,'#hucProjectExportButton');await channel(page,0);await page.locator('#hucLiveEnabled').uncheck();

    step('A cold cache-Off seek reconstructs Wave, LFO, Noise and looping DAC-stream state and provides a real stereo PCM baseline');
    const target=92.34;await setCache(false);measurements.coldOff=await seekPaused(target);empty(await cacheStats(page));const author=(await read(page)).preset,goldenSnapshot=await signature(),golden=await sample();assert(goldenSnapshot.lfo);assert.equal(goldenSnapshot.period,'240');measurements.goldenPcm={frames:golden.frames,sha256:pcmHash(golden)};

    step('A bounded cold cache-On seek and exact/nearby warm restores produce bit-identical scheduled PCM and exact snapshots with less reconstruction');
    await setCache(true);measurements.coldOn=await seekPaused(target);bounded(measurements.coldOn.stats);assert(measurements.coldOn.stats.count>0);assert(measurements.coldOn.stats.bytes>0);assert.equal(measurements.coldOn.stats.restoredFrame,0);assert.deepEqual(await signature(),goldenSnapshot);const coldOn=await sample();assert.equal(pcmHash(coldOn),pcmHash(golden));
    const previousHits=(await cacheStats(page)).hits;measurements.warmExact=await seekPaused(target);assert(measurements.warmExact.stats.hits>previousHits);assert(measurements.warmExact.stats.restoredFrame>0);assert(measurements.warmExact.stats.restoredFrame<=Math.round(target*44100));assert(measurements.warmExact.stats.reconstructedFrames<measurements.coldOn.stats.reconstructedFrames);assert.deepEqual(await signature(),goldenSnapshot);const warm=await sample();assert.equal(pcmHash(warm),pcmHash(golden));
    measurements.warmNearby=await seekPaused(target+.01);assert(measurements.warmNearby.stats.restoredFrame>0);const nearby=await sample(2048);for(let channel=0;channel<2;channel++)assert.deepEqual(nearby.channels[channel],golden.channels[channel].slice(441,441+2048),'nearby cached PCM advances441 exact frames');bounded(await cacheStats(page));

    step('Changing a reference mute clears incompatible checkpoints; cold and warm PCM match for the new mix while snapshots and authored sound stay unchanged');
    const beforeMute=await signature(),paused=await state(page);await page.locator('#hucSongChannel5Toggle').click();assert.equal(await mask(),'16');empty(await cacheStats(page));await frozen(page,paused);assert.deepEqual(await signature(),beforeMute);
    measurements.maskCold=await seekPaused(target);assert.equal(measurements.maskCold.stats.restoredFrame,0);const masked=await sample();assert.notEqual(pcmHash(masked),pcmHash(golden));measurements.maskWarm=await seekPaused(target);assert(measurements.maskWarm.stats.restoredFrame>0);const maskedWarm=await sample();assert.equal(pcmHash(maskedWarm),pcmHash(masked));assert.deepEqual((await read(page)).preset,author);assert.equal(await mask(),'16');

    step('Rejected input retains valid checkpoints; a different accepted source invalidates them and restores its own waveform rather than old cached state');
    const keep=await cacheStats(page),source=(await state(page)).source,bad=Buffer.from(fixtures.main.bytes);bad.writeUInt32LE(0,0xa4);await page.locator('#vgmFileInput').setInputFiles({name:'wrong-chip.vgm',mimeType:'application/octet-stream',buffer:bad});await until(()=>page.locator('#vgmStatus').getAttribute('data-error').then(value=>value==='true'),'invalid source rejected');assert.equal((await state(page)).source,source);assert.deepEqual(await cacheStats(page),keep);
    await choose(page,'/vgm/cache-other.vgm');empty(await cacheStats(page));measurements.otherSource=await seekPaused(.5);assert.equal(measurements.otherSource.stats.restoredFrame,0);assert.deepEqual((await view(page)).wave,alternateWave);assert((await cacheStats(page)).count>0);assert.equal(await mask(),'16');

    step('Warm cancellation, Stop and Code retain the accepted source cache without creating extra audio routes or letting stale seek work cut a newer performer');
    const beforeCancel=await state(page),cacheBefore=await cacheStats(page),graphBefore=await graph(page);await armSeek(.6);await page.locator('#hucSongCancelSeek').click();await until(()=>state(page).then(value=>value.seekCancelling==='true'),'cancel acknowledged');await releaseGate();await phase(page,'paused');await idle();await frozen(page,beforeCancel);assert.equal((await cacheStats(page)).count,cacheBefore.count);assert.equal((await cacheStats(page)).bytes,cacheBefore.bytes);
    await stop(page);assert.equal((await cacheStats(page)).count,cacheBefore.count);measurements.afterStop=await seekPaused(.5);assert(measurements.afterStop.stats.restoredFrame>0);
    await armSeek(.6);await selectIndex(page);await page.locator('#synthCodeEditor').fill(`const pce=await useSoundChip('huc6280');\nawait pce.noteOn(CH3,'A3');\n`);await page.locator('#synthCodeRunButton').click();await releaseGate();await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Running|Playing/.test(text)),'Code replaces cached seek');await phase(page,'stopped');await pcm(page);assert((await read(page,'observeCode')).registers[2][4]&128);assert.equal((await cacheStats(page)).count,cacheBefore.count);await page.locator('#synthCodeStopButton').click();await pcm(page,false);assert.deepEqual((await read(page)).preset,author);
    const graphAfter=await graph(page);assert.equal(graphAfter.contexts,graphBefore.contexts);assert.equal(graphAfter.destinationConnections,graphBefore.destinationConnections);assert.equal(graphAfter.editorWorklets,graphBefore.editorWorklets);

    step('Clear/Disable release checkpoints without moving paused PCM, and project replacement fences a pending cached seek without autoplay');
    await clearCache();empty(await cacheStats(page));await page.locator('#synthInputKeyboardTab').click();await channel(page,0);await seekPaused(.5);const beforeDisable=await state(page);await setCache(false);empty(await cacheStats(page));await frozen(page,beforeDisable);await setCache(true);empty(await cacheStats(page));await seekPaused(.5);
    await armSeek(1.5);await page.locator('#hucProjectFileInput').setInputFiles({name:'cache-project.cassette.zip',mimeType:'application/zip',buffer:projectBytes});await releaseGate();await until(()=>page.locator('#hucFilesStatus').textContent().then(text=>/project imported/i.test(text)),'project replacement');await phase(page,'stopped');await idle();assert.equal((await state(page)).frame,0);empty(await cacheStats(page));assert.deepEqual((await read(page)).preset,author);await pcm(page,false);

    step('Normal playback collects usable bounded checkpoints; controls fit1240/390px and pagehide releases the one muted output graph');
    await choose(page,'/vgm/cache-main.vgm');await channel(page,0);await play(page);await until(()=>state(page).then(value=>value.frame>5.1*44100),'normal playback beyond checkpoint',15000);await until(()=>cacheStats(page).then(value=>value.count>0),'normal playback checkpoint');await pause(page);measurements.normalPlayback=await cacheStats(page);bounded(measurements.normalPlayback);measurements.normalRestore=await seekPaused(5.2);assert(measurements.normalRestore.stats.restoredFrame>0);const finalPause=await state(page);await clearCache();empty(await cacheStats(page));await frozen(page,finalPause);
    for(const width of[1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#hucSongPlayer').scrollIntoViewIfNeeded();const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#hucSongPlayer button,#hucSongPlayer select,#hucSongPlayer input,#hucSongCacheStatus')].filter(node=>node.getClientRects().length).map(node=>({id:node.id,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));assert(bounds.scroll<=width+1);assert(bounds.controls.every(item=>item.left>=-1&&item.right<=width+1));measurements['layout'+width]=bounds;await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    measurements.route=await graph(page);assert.equal(measurements.route.contexts,1);assert.equal(measurements.route.destinationConnections,1);assert(measurements.route.muted);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await until(()=>graph(page).then(value=>value.runningContexts===0&&value.liveSources===0&&value.liveWorklets===0),'pagehide');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,graph:await graph(page),pageErrors:errors,consoleErrors};
  }catch(error){const diagnostic={stage,song:await state(page).catch(()=>null),cache:await cacheStats(page).catch(()=>null),view:await view(page).catch(()=>null),gate:{armed:wasmGate?.armed,entered:wasmGate?.entered},graph:await graph(page).catch(()=>null),status:await page.locator('#hucSongCacheStatus').textContent().catch(()=>''),audio:await page.locator('#audioStatus').textContent().catch(()=>''),code:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>'')};await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,consoleErrors};throw error;
  }finally{await releaseGate();await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
module.exports={makeFixture};
if(require.main===module)(async()=>{
  const fixtures={main:makeFixture(),other:makeFixture({alternate:true})};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixtures));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),
    fixtures:Object.fromEntries(Object.entries(fixtures).map(([key,value])=>[key,{bytes:value.bytes.length,sha256:hash(value.bytes),samples:value.samples,alternate:value.alternate}])),results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
