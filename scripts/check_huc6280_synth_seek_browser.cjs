// SPDX-License-Identifier: BSD-3-Clause
// Original HuC6280 VGM / VGZ fixtures and the real WASM/audio route. No speaker
// receives audio: intercept every destination before application JS, use gain 0,
// and also launch Chromium with --mute-audio. This is not a listening test.
// node scripts/check_huc6280_synth_seek_browser.cjs --root=docs --entry=/synth-huc6280/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'huc6280-synth-seek-browser.json'),screenshots:path.join(tmpdir(),'huc6280-synth-seek-images')};
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
function makeFixture(){
  const commands=[];let samples=0;
  const sleep=frames=>{while(frames){const count=Math.min(65535,frames);commands.push(0x61,count&255,count>>8);samples+=count;frames-=count;}};
  commands.push(...write(1,255),...write(8,0),...write(9,0),...upload(0,wave,{period:500,volume:19,balance:0xe7}),
    ...upload(1,modulatorWave,{period:713,volume:0}),...upload(2,laterWave,{period:360,volume:21,balance:0xbd}),
    ...write(0,3),...write(2,444&255),...write(3,444>>8),...write(5,0xcb),...write(4,0xc0|20),...write(6,9),
    ...write(0,4),...write(5,0xf8),...write(7,0x8d),...write(4,0x80|17),
    ...write(0,5),...write(2,666&255),...write(3,666>>8),...write(5,0x9f),...write(7,0),...write(4,0x80|12));
  sleep(8820);commands.push(...write(0,0),...write(4,128|25));sleep(35280);
  commands.push(...upload(0,laterWave,{period:250,volume:17,balance:0x6c}),...write(0,3),...write(6,27),
    ...write(0,4),...write(5,0x8f),...write(7,0x83),...write(4,128|11),...write(8,7),...write(9,2));sleep(88200);
  commands.push(...upload(0,wave,{period:333,volume:20,balance:0xab}),...write(9,0),...write(0,3),...write(6,17),
    ...write(0,4),...write(7,0x93),...write(4,128|9));sleep(17*44100+123);commands.push(0x66);
  const bytes=Buffer.alloc(256+commands.length);bytes.write('Vgm ');bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x171,8);
  bytes.writeUInt32LE(samples,0x18);bytes.writeUInt32LE(0xcc,0x34);bytes.writeUInt32LE(3579545,0xa4);bytes.set(commands,256);return{bytes,samples,segments:[]};
}
function installSilentAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],sources=[],commands=[];let request=0,lastWave=null,trialGate=null;
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
      const start=source.start,stop=source.stop;source.start=function(...args){item.started=true;return start.apply(this,args);};source.stop=function(...args){item.stopped=true;return stop.apply(this,args);};
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
  window.__hucSongAudit={read,output,wave:()=>lastWave?.slice()??null,drain:()=>commands.splice(0),gateNextTrial(){trialGate={entered:false,release:null};},gate:()=>({entered:trialGate?.entered??false}),
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
const trial=page=>read(page,'read','trial');
const view=page=>page.evaluate(()=>({tools:{...document.querySelector('#hucCodeLiveTools').dataset},editor:{...document.querySelector('#voiceEditor').dataset},
  channel:document.querySelector('#hucChannelSelect').value,source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,
  volume:Number(document.querySelector('#volume').textContent),noise:Number(document.querySelector('#noiseFrequency').textContent),readout:document.querySelector('#hucChannelReadout').textContent,
  capture:document.querySelector('#hucSongCaptureStatus')?.textContent??'',captureDisabled:document.querySelector('#hucSongCaptureButton')?.disabled,
  wave:__hucSongAudit.wave()}));
async function channel(page,value){await page.locator('#hucChannelSelect').selectOption(String(value));await until(()=>view(page).then(v=>v.channel===String(value)&&v.tools.channel===String(value)),'view '+value);}
async function openMenu(page){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();}
async function download(page,selector){if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu'))))await openMenu(page);
  const pending=page.waitForEvent('download');await page.locator(selector).click();const item=await pending,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}
async function press(page,key){await page.locator('#synthInputKeyboardTab').click();await page.locator('#synthTitle').click();await page.keyboard.down(key);await until(()=>view(page).then(v=>Number(v.tools.heldCount)>0),'paused audition note');await pcm(page);}
async function release(page,key){await page.keyboard.up(key);await until(()=>view(page).then(v=>Number(v.tools.heldCount)===0),'audition release');await pcm(page,false);}
async function capture(page){await page.locator('#hucSongCaptureButton').click();await until(()=>view(page).then(v=>v.channel==='synth'&&!/capturing/i.test(v.capture)),'captured Synth view');}
async function frozen(page,expected){const now=await state(page);assert.equal(now.phase,'paused');assert.equal(now.frame,expected.frame);assert.equal(now.rendered,expected.rendered);assert.equal(now.source,expected.source);}

async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup',wasmGate=null;
  page.setDefaultTimeout(25000);await page.addInitScript(installSilentAudit);
  await page.addInitScript(()=>{window.__hucSeekInputEvents=[];for(const type of['pointerdown','pointerup','input','change','keydown'])window.addEventListener(type,event=>{
    if(event.target?.id!=='hucSongSeek'&&event.key!=='Escape')return;window.__hucSeekInputEvents.push({type,key:event.key,target:event.target?.id??'',active:document.activeElement?.id??'',value:document.querySelector('#hucSongSeek')?.value});
    if(window.__hucSeekInputEvents.length>100)window.__hucSeekInputEvents.shift();},{capture:true});});
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}
    if(wasmGate?.armed&&/\/huc6280_wasm\.wasm$/.test(url.pathname)){const gate=wasmGate;gate.armed=false;gate.entered=true;gate.route=route;return new Promise(resolve=>gate.resolve=resolve);}
    return route.continue();});
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  const seekbar=page.locator('#hucSongSeek');
  const seek=async seconds=>{await seekbar.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},seconds);};
  async function settled(seconds,expected='paused'){await phase(page,expected);await until(()=>state(page).then(value=>value.phase===expected&&(expected==='playing'?value.frame>=Math.round(seconds*44100)&&value.frame<Math.round(seconds*44100)+22050:value.frame===Math.round(seconds*44100))),'seek '+seconds+' '+expected);}
  async function idle(){await until(()=>state(page).then(value=>value.seeking==='false'&&value.seekPreparing==='false'),'seek cleanup settled');}
  async function exactSnapshot(seconds){const frame=Math.round(seconds*44100);await until(()=>view(page).then(value=>Number(value.editor.positionFrames)===frame),'exact destination snapshot '+frame);}
  async function armSeek(seconds){assert(!wasmGate,'one candidate gate at a time');wasmGate={armed:true,entered:false};await seek(seconds);await until(()=>Boolean(wasmGate?.entered),'candidate WASM fetch held');await phase(page,'seeking');}
  async function releaseGate(){const gate=wasmGate;wasmGate=null;if(gate?.route)try{await gate.route.continue();}catch{}finally{gate.resolve?.();}}
  async function importFile(filename){await page.locator('#vgmFileInput').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:fixture.bytes});await until(()=>page.locator('#vgmLibrary').getAttribute('data-loading').then(value=>value==='false'),'source analysis');await choose(page,'/vgm/'+filename);}
  const mask=()=>page.locator('#hucSongPlayer').getAttribute('data-channel-mute-mask');
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Seek is passive until a change is committed; dragging previews a position and Escape cancels the draft without audio');
    assert(await seekbar.isDisabled());await importFile('seek-source.vgm');await importFile('other-source.vgm');await choose(page,'/vgm/seek-source.vgm');assert(await seekbar.isEnabled());
    assert.equal(await seekbar.getAttribute('min'),'0');assert.equal(Number(await seekbar.getAttribute('max')),fixture.samples/44100);assert.equal(await seekbar.getAttribute('step'),'0.01');
    const projectBytes=await download(page,'#hucProjectExportButton');await seekbar.scrollIntoViewIfNeeded();const box=await seekbar.boundingBox();assert(box);await page.mouse.move(box.x+box.width*.2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height/2,{steps:3});
    assert(Number(await seekbar.inputValue())>5);assert.equal((await state(page)).phase,'stopped');assert.equal((await state(page)).frame,0);assert.equal((await graph(page)).contexts,0);
    await page.keyboard.press('Escape');await page.mouse.up();await wait(80);assert.equal((await state(page)).phase,'stopped');assert.equal((await state(page)).frame,0);assert.equal(Number(await seekbar.inputValue()),0);assert.equal((await graph(page)).contexts,0);

    step('Seeking from Stop builds a silent paused position with an exact snapshot; keyboard trial and Capture use the destination Wave');
    await channel(page,0);await seek(.5);await settled(.5);await exactSnapshot(.5);await pcm(page,false);const author=(await read(page)).preset;
    assert.equal((await view(page)).volume,25);assert.deepEqual((await view(page)).wave,wave);const wavePause=await state(page);
    const key=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(key);await press(page,key);assert.deepEqual((await trial(page)).preset.wave,wave);await release(page,key);await frozen(page,wavePause);await capture(page);await frozen(page,wavePause);
    assert.deepEqual((await read(page)).preset.wave,wave);measurements.waveSeek={frame:wavePause.frame,rendered:wavePause.rendered};

    step('A paused Seek forces the new snapshot even with Auto update Off, preserving CH/mute choices and capturing the complete destination LFO pair');
    await channel(page,0);await page.locator('#hucLiveEnabled').uncheck();await page.locator('[data-huc-chip-tab="mixer"]').click();assert(await page.locator('#hucSongChannels').isVisible());await page.locator('#hucSongChannel2Toggle').click();await page.locator('[data-huc-chip-tab="huc6280"]').click();assert.equal(await mask(),'2');await seek(2);await settled(2);await exactSnapshot(2);assert.equal(await page.locator('#hucChannelSelect').inputValue(),'0');assert.equal(await page.locator('#hucLiveEnabled').isChecked(),false);assert.equal(await mask(),'2');
    assert.equal((await view(page)).volume,17);assert.deepEqual((await view(page)).wave,laterWave);const lfoPause=await state(page),c4=await page.locator('#keyboard .key').evaluateAll(nodes=>nodes.find(node=>node.querySelector('span:last-child')?.textContent==='C4')?.dataset.key);assert(c4);
    await press(page,c4);let sounding=await trial(page);assert(sounding.preset.lfo.enabled);assert.equal(sounding.preset.lfo.carrierPeriod,250);assert.equal(sounding.preset.lfo.modulatorPeriod,713);await release(page,c4);await capture(page);await frozen(page,lfoPause);const captured=(await read(page)).preset;assert(captured.lfo.enabled);
    await channel(page,4);await exactSnapshot(2);assert.equal((await view(page)).noise,3);assert.equal((await view(page)).editor.source,'noise');
    await channel(page,3);await exactSnapshot(2);assert.equal(Number((await view(page)).editor.ddaValue),27);assert((await view(page)).captureDisabled);await channel(page,0);

    step('Forward and backward Seek during playback resume at the requested position while retaining mixer flags, selected CH and Auto update mode');
    await play(page);await pcm(page);await seek(4);await settled(4,'playing');await exactSnapshot(4);assert.equal((await view(page)).volume,20);assert.deepEqual((await view(page)).wave,wave);assert.equal(await mask(),'2');
    await seek(.75);await settled(.75,'playing');await exactSnapshot(.75);assert.equal((await view(page)).volume,25);assert.equal(await page.locator('#hucLiveEnabled').isChecked(),false);assert.equal(await page.locator('#hucChannelSelect').inputValue(),'0');await pause(page);
    await seek(4.13);await settled(4.13);await exactSnapshot(4.13);const beforeCancel=await state(page),beforeGraph=await graph(page);

    step('A held candidate exposes seek progress and Cancel, blocks keyboard/Capture, creates no audio route, and cancellation preserves the old paused PCM and frame');
    await armSeek(6);assert(await page.locator('#hucSongCancelSeek').isVisible());assert.equal((await state(page)).seeking,'true');assert.equal((await state(page)).seekPreparing,'true');assert.equal(Number((await state(page)).seekTargetSeconds),6);assert.equal(Number((await state(page)).seekProgressSeconds),0);
    assert(await page.locator('#hucSongCaptureButton').isDisabled());assert.equal(await page.locator('#keyboard .key:not([disabled])').count(),0);
    await page.locator('#synthTitle').click();await page.keyboard.down(c4);await wait(50);await page.keyboard.up(c4);
    const heldGraph=await graph(page);assert.equal(heldGraph.contexts,beforeGraph.contexts);assert.equal(heldGraph.destinationConnections,beforeGraph.destinationConnections);assert.equal(heldGraph.bufferSources,beforeGraph.bufferSources);assert.equal(heldGraph.editorWorklets,beforeGraph.editorWorklets);await pcm(page,false);
    await page.locator('#hucSongCancelSeek').click();await until(()=>state(page).then(value=>value.seekCancelling==='true'),'Cancel immediately acknowledged');
    assert(await page.locator('#hucSongCancelSeek').isDisabled());assert(await seekbar.isDisabled());assert.match(await page.locator('#hucSongPlayButton').textContent(),/cancelling/i);
    await releaseGate();await phase(page,'paused');await frozen(page,beforeCancel);assert.deepEqual((await read(page)).preset,captured);assert.equal(await mask(),'2');measurements.cancel={frame:beforeCancel.frame,graph:heldGraph};
    await armSeek(6);await page.locator('#synthTitle').click();await page.keyboard.press('Escape');await until(()=>state(page).then(value=>value.seekCancelling==='true'),'Escape from body immediately cancels committed seek');
    assert.match(await page.locator('#hucSongPlayButton').textContent(),/cancelling/i);await releaseGate();await phase(page,'paused');await frozen(page,beforeCancel);

    step('Stop and selecting another source invalidate held candidate work, preventing a late seek from restoring playback or the old source');
    await armSeek(7);await page.locator('#hucSongStopButton').click();await releaseGate();await phase(page,'stopped');await idle();assert.equal((await state(page)).frame,0);await pcm(page,false);
    await seek(.5);await settled(.5);await channel(page,0);await armSeek(7);const newSource=page.locator('#hucSongSelect').selectOption('/vgm/other-source.vgm');await newSource;await releaseGate();await until(()=>state(page).then(value=>value.source==='/vgm/other-source.vgm'&&value.phase==='stopped'),'new source fences seek');assert.equal((await state(page)).frame,0);await wait(100);assert.equal((await state(page)).phase,'stopped');

    step('Code Run and project replacement retire stale reconstructions without silencing a newer performer or reviving an imported song');
    await seek(.5);await settled(.5);await channel(page,0);await armSeek(7);await selectIndex(page);await page.locator('#synthCodeEditor').fill(`const pce=await useSoundChip('huc6280');\nawait pce.noteOn(CH3,'A3');\n`);await page.locator('#synthCodeRunButton').click();await releaseGate();await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Running|Playing/.test(text)),'Code replaces seek');await phase(page,'stopped');await pcm(page);assert((await read(page,'observeCode')).registers[2][4]&128);await page.locator('#synthCodeStopButton').click();await pcm(page,false);
    await page.locator('#synthInputKeyboardTab').click();await seek(.5);await settled(.5);await channel(page,0);await armSeek(7);await page.locator('#hucProjectFileInput').setInputFiles({name:'seek-project.cassette.zip',mimeType:'application/zip',buffer:projectBytes});await releaseGate();await until(()=>page.locator('#hucFilesStatus').textContent().then(text=>/project imported/i.test(text)),'project fences seek');await phase(page,'stopped');assert.equal((await state(page)).frame,0);assert.deepEqual((await read(page)).preset,author);await pcm(page,false);

    step('Home/End seek to bounded paused positions, focus stays musical afterwards, desktop/mobile controls fit, and pagehide retires every source');
    await choose(page,'/vgm/seek-source.vgm');await seekbar.focus();await page.keyboard.press('End');await settled(fixture.samples/44100);
    // Native range thumbs may quantize to the0.01s step; End must still seek
    // the exact fractional EOF in the core, rather than that rounded thumb.
    assert(Math.abs(Number(await seekbar.inputValue())-fixture.samples/44100)<.01);
    await seekbar.focus();await page.keyboard.press('Home');await settled(0);assert.equal(Number(await seekbar.inputValue()),0);assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'hucSongSeek');await channel(page,0);await exactSnapshot(0);
    assert.match(await page.locator('#hucSongSeekPosition').textContent(),/0:00/);await page.keyboard.down(key);await pcm(page);await page.keyboard.up(key);await pcm(page,false);
    for(const width of[1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#hucSongPlayer').scrollIntoViewIfNeeded();const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#hucSongPlayer button,#hucSongPlayer select,#hucSongPlayer input,#hucSongSeekPosition')].filter(node=>node.getClientRects().length).map(node=>({id:node.id,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));assert(bounds.scroll<=width+1);assert(bounds.controls.every(item=>item.left>=-1&&item.right<=width+1));measurements['layout'+width]=bounds;await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    const route=await graph(page);assert.equal(route.contexts,1);assert.equal(route.destinationConnections,1);assert(route.muted);measurements.route=route;await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await until(()=>graph(page).then(value=>value.runningContexts===0&&value.liveSources===0&&value.liveWorklets===0),'pagehide');
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,graph:await graph(page),pageErrors:errors,consoleErrors};
  }catch(error){const diagnostic={stage,song:await state(page).catch(()=>null),view:await view(page).catch(()=>null),gate:{armed:wasmGate?.armed,entered:wasmGate?.entered},inputEvents:await page.evaluate(()=>window.__hucSeekInputEvents).catch(()=>[]),output:await page.evaluate(()=>__hucSongAudit.output()).catch(()=>null),graph:await graph(page).catch(()=>null),audio:await page.locator('#audioStatus').textContent().catch(()=>''),code:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>'')};await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,consoleErrors};throw error;
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
  const fixture=makeFixture();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixture));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),
    fixture:{bytes:fixture.bytes.length,sha256:hash(fixture.bytes),samples:fixture.samples,segments:fixture.segments},results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
