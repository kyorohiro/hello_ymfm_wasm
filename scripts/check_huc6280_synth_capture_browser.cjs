// SPDX-License-Identifier: BSD-3-Clause
// Original HuC6280 VGM / VGZ fixtures and the real WASM/audio route. No speaker
// receives audio: intercept every destination before application JS, use gain 0,
// and also launch Chromium with --mute-audio. This is not a listening test.
// node scripts/check_huc6280_synth_capture_browser.cjs --root=docs --entry=/synth-huc6280/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'huc6280-synth-capture-browser.json'),screenshots:path.join(tmpdir(),'huc6280-synth-capture-images')};
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
  commands.push(...write(1,255),...write(9,0),...upload(0,wave,{period:500,volume:19,balance:0xe7}),
    ...upload(1,modulatorWave,{period:713,volume:0}),...upload(2,laterWave,{period:360,volume:21,balance:0xbd}),
    ...write(0,3),...write(2,444&255),...write(3,444>>8),...write(5,0xcb),...write(4,0xc0|20),...write(6,9),
    ...write(0,4),...write(5,0xf8),...write(7,0x8d),...write(4,0x80|17),
    ...write(0,5),...write(2,666&255),...write(3,666>>8),...write(5,0x9f),...write(4,0x80|12));
  sleep(8820);commands.push(...write(0,0),...write(4,128|25));sleep(35280);
  commands.push(...upload(0,laterWave,{period:250,volume:17,balance:0x6c}),...write(0,3),...write(6,27),
    ...write(0,4),...write(5,0x8f),...write(7,0x83),...write(4,128|11),...write(8,7),...write(9,2));
  sleep(308700);commands.push(0x66);
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
async function runCode(page){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},'Code running');}



const observe=page=>read(page,'observeEditor'),trial=page=>read(page,'read','trial');
const view=page=>page.evaluate(()=>({tools:{...document.querySelector('#hucCodeLiveTools').dataset},editor:{...document.querySelector('#voiceEditor').dataset},
  channel:document.querySelector('#hucChannelSelect').value,source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,
  volume:Number(document.querySelector('#volume').textContent),readout:document.querySelector('#hucChannelReadout').textContent,
  capture:document.querySelector('#hucSongCaptureStatus')?.textContent??'',captureDisabled:document.querySelector('#hucSongCaptureButton')?.disabled,
  wave:__hucSongAudit.wave()}));
async function channel(page,value){await page.locator('#hucChannelSelect').selectOption(String(value));await until(()=>view(page).then(v=>v.channel===String(value)&&v.tools.channel===String(value)),'view '+value);}
async function openMenu(page){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();}
async function download(page,selector){if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu'))))await openMenu(page);
  const pending=page.waitForEvent('download');await page.locator(selector).click();const item=await pending,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}
async function press(page,key){await page.locator('#synthInputKeyboardTab').click();await page.locator('#synthTitle').click();await page.keyboard.down(key);await until(()=>view(page).then(v=>Number(v.tools.heldCount)>0),'paused audition note');await pcm(page);}
async function release(page,key){await page.keyboard.up(key);await until(()=>view(page).then(v=>Number(v.tools.heldCount)===0),'audition release');await pcm(page,false);}
async function capture(page){await page.locator('#hucSongCaptureButton').click();await until(()=>view(page).then(v=>v.channel==='synth'&&!/capturing/i.test(v.capture)),'captured Synth view');}
function sameBank(actual,expected){assert.deepEqual(actual.waveforms,expected.waveforms);assert.deepEqual(actual.registers,expected.registers);
  // Register0 is only the chip's selected-write cursor, which author-side Stop
  // may advance while visiting all6 channels before reference playback starts.
  assert.deepEqual(actual.globals.slice(1),expected.globals.slice(1));assert.deepEqual(actual.envelopes,expected.envelopes);}
async function frozen(page,expected){const now=await state(page);assert.equal(now.phase,'paused');assert.equal(now.frame,expected.frame);assert.equal(now.rendered,expected.rendered);assert.equal(now.source,expected.source);}

async function check(browser,name,origin,fixture,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(25000);await page.addInitScript(installSilentAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Import VGM lives in the menu; sounds and channel controls precede the monitor, and loudest Wave/PCM grouping remains passive');
    assert.equal(await page.locator('#loadVgm').evaluate(node=>Boolean(node.closest('#synthMenu'))),true);
    assert(await page.locator('#loadVgm').isHidden());
    const order=await page.evaluate(()=>{
      const a=document.querySelector('#hucSongPlayer'),b=document.querySelector('#vgmImport'),c=document.querySelector('#hucCodeLiveTools'),d=document.querySelector('.huc-monitor');
      return [a,b,c].every((node,index)=>Boolean(node.compareDocumentPosition([b,c,d][index])&Node.DOCUMENT_POSITION_FOLLOWING));
    });assert(order,'song → sounds → channel controls → waveform/spectrum');
    await openMenu(page);const chooser=page.waitForEvent('filechooser');await page.locator('#loadVgm').click();
    await(await chooser).setFiles({name:'capture-source.vgm',mimeType:'application/octet-stream',buffer:fixture.bytes});
    await until(()=>page.locator('#hucSongSelect option[value="/vgm/capture-source.vgm"]').count().then(Boolean),'menu import stored source');
    await until(()=>page.locator('#vgmLibrary').getAttribute('data-loading').then(value=>value==='false'),'snapshot analysis');
    assert.equal(await page.locator('#synthMenu').evaluate(node=>node.open),false);
    if(!await page.locator('#vgmImport').evaluate(node=>node.open))await page.locator('#vgmImport > summary').click();
    const all=await page.locator('[data-vgm-voice]').count();assert(all>2);
    await page.locator('#vgmKeepLoudestPcm').check();const grouped=await page.locator('[data-vgm-voice]').count();assert(grouped<all,'volume-only Wave variants group');
    await page.locator('#vgmKeepLoudestPcm').uncheck();assert.equal(await page.locator('[data-vgm-voice]').count(),all);
    assert.equal((await graph(page)).contexts,0);assert.equal(await page.locator('#instrumentName').inputValue(),'Sine');
    measurements.grouping={all,grouped};

    step('A paused configured Wave auditions on a separate lazy Worklet, sharing the same context/Master while preserving source and normal CH settings');
    await page.locator('#startAudio').click();await until(async()=>{try{return Boolean((await read(page)).preset);}catch{return false;}},'author audio ready');
    const original=(await read(page)).preset;await channel(page,2);await page.locator('[data-stepper-for="volume"][data-stepper-delta="-1"]').click();
    await until(async()=>((await observe(page)).registers[2][4]&31)===23,'normal independent CH3');const bank=await observe(page);
    await choose(page,'/vgm/capture-source.vgm');await channel(page,0);await play(page);await until(()=>state(page).then(v=>v.frame>13230),'Wave audible position');await pause(page);
    const wavePause=await state(page);assert(wavePause.frame<44100,'Wave before LFO');await until(()=>page.locator('#hucSongCaptureButton').isEnabled(),'known Wave capturable');
    const key=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(key);
    const sourceWave=await view(page);assert.deepEqual(sourceWave.wave,wave);assert.equal((await graph(page)).editorWorklets,1,'no audition worklet before key');
    await press(page,key);let sounding=await trial(page);assert.equal(sounding.preset.source,'wave');assert.deepEqual(sounding.preset.wave,wave);assert.equal(sounding.preset.envelope.enabled,false);
    assert.equal(sounding.preset.volume,sourceWave.volume);assert.equal(sounding.voices.length,1);await frozen(page,wavePause);
    assert.deepEqual((await read(page)).preset,original);sameBank(await observe(page),bank);
    const route=await graph(page);assert.equal(route.contexts,1);assert.equal(route.destinationConnections,1);assert.equal(route.liveWorklets,2);assert(route.muted);measurements.auditionGraph=route;

    step('The newest audition key owns its temporary voice; an older key release cannot silence it');
    const keys=await page.locator('#keyboard .key:not([disabled])').evaluateAll(nodes=>nodes.slice(0,2).map(node=>node.dataset.key));assert.equal(keys.length,2);
    const newer=keys.find(value=>value!==key);assert(newer);const oldId=sounding.voices[0].id;
    await page.keyboard.down(newer);await until(async()=>{try{const v=await trial(page);return v.voices.length===1&&v.voices[0].id!==oldId;}catch{return false;}},'new key owns audition');
    const latest=(await trial(page)).voices[0].id;await page.keyboard.up(key);await pcm(page);assert.equal((await trial(page)).voices[0].id,latest);
    await release(page,newer);await frozen(page,wavePause);assert.deepEqual((await read(page)).preset,original);sameBank(await observe(page),bank);

    step('Capture stops held audition, selects Synth and saves an ordinary preset while keeping Pause; later Synth edits do not move the song');
    await press(page,key);await capture(page);await page.keyboard.up(key);await pcm(page,false);await frozen(page,wavePause);
    const capturedWave=(await read(page)).preset;assert.equal(capturedWave.source,'wave');assert.deepEqual(capturedWave.wave,wave);assert.equal(capturedWave.volume,sourceWave.volume);assert.equal(capturedWave.envelope.enabled,false);
    await until(()=>graph(page).then(v=>v.liveWorklets===1),'capture retires audition worklet');
    await page.locator('#saveSoundToFiles').click();await until(()=>page.locator('#hucFilesStatus').textContent().then(text=>/saved to \/presets\//i.test(text)),'captured Wave saved to Files');
    const projectBytes=await download(page,'#hucProjectExportButton'),saved=await loadCassette(projectBytes);
    const savedSounds=[...saved.files.entries()].filter(([p])=>/^presets\/.*\.huc6280\.json$/i.test(p)).map(([p,data])=>({path:p,preset:JSON.parse(new TextDecoder().decode(data))}));
    assert(savedSounds.some(value=>JSON.stringify(value.preset)===JSON.stringify(capturedWave)),'Files contains exact captured single-voice preset');
    assert.deepEqual(Buffer.from(saved.files.get('vgm/capture-source.vgm')),fixture.bytes);
    await page.locator('[data-stepper-for="volume"][data-stepper-delta="1"]').click();await until(async()=>(await read(page)).preset.volume===capturedWave.volume+1,'Synth knob edits captured sound');await frozen(page,wavePause);
    await channel(page,0);assert.equal((await view(page)).volume,sourceWave.volume);await channel(page,'synth');assert.equal((await view(page)).volume,capturedWave.volume+1);
    measurements.waveCapture={frame:wavePause.frame,preset:capturedWave,projectBytes:projectBytes.length};

    step('Noise audition retains its hardware clock across notes, and LFO carrier audition/Capture retains both waves and recorded periods');
    await channel(page,4);await until(()=>page.locator('#hucSongCaptureButton').isEnabled(),'Noise capturable');await press(page,key);
    sounding=await trial(page);assert.equal(sounding.preset.source,'noise');assert.equal(sounding.preset.noise.frequency,13);const noiseChannel=sounding.voices[0].channel;
    assert.equal(sounding.registers[noiseChannel][7]&31,13);await release(page,key);await frozen(page,wavePause);await capture(page);
    const noise=(await read(page)).preset;assert.equal(noise.source,'noise');assert.equal(noise.noise.frequency,13);await frozen(page,wavePause);
    await play(page);await until(()=>state(page).then(v=>v.frame>57330),'LFO audible position');await pause(page);const lfoPause=await state(page);
    await channel(page,0);await until(()=>page.locator('#hucSongCaptureButton').isEnabled(),'LFO carrier capturable');
    const c4=await page.locator('#keyboard .key').evaluateAll(nodes=>nodes.find(node=>node.querySelector('span:last-child')?.textContent==='C4')?.dataset.key);assert(c4,'C4 key present');
    await press(page,c4);sounding=await trial(page);assert(sounding.preset.lfo.enabled);assert.equal(sounding.preset.lfo.mode,'recorded');
    assert.deepEqual(sounding.preset.wave,laterWave);assert.deepEqual(sounding.preset.lfo.wave,modulatorWave);
    assert.equal((sounding.registers[0][2]|(sounding.registers[0][3]&15)<<8)||4096,250);assert.equal((sounding.registers[1][2]|(sounding.registers[1][3]&15)<<8)||4096,713);
    await release(page,c4);await frozen(page,lfoPause);await capture(page);const lfo=(await read(page)).preset;
    assert(lfo.lfo.enabled);assert.equal(lfo.lfo.carrierPeriod,250);assert.equal(lfo.lfo.modulatorPeriod,713);assert.equal(lfo.lfo.frequency,7);assert.equal(lfo.lfo.depth,2);
    assert.deepEqual(lfo.wave,laterWave);assert.deepEqual(lfo.lfo.wave,modulatorWave);await frozen(page,lfoPause);measurements.lfoCapture={frame:lfoPause.frame,preset:lfo};

    step('DDA, unknown RAM and the reserved LFO modulator explain unsupported audition/Capture without inventing samples or changing the sound');
    for(const[ch,reason]of[[1,/CH2|CH 2|modulat|CH1/i],[3,/DDA|PCM|sample/i],[5,/unknown|record|Wave RAM/i]]){
      await channel(page,ch);await until(()=>page.locator('#hucSongCaptureButton').isDisabled(),'unsupported CH '+ch);assert.match(await page.locator('#hucSongCaptureStatus').textContent(),reason);
      const before=await graph(page);await page.locator('#synthTitle').click();await page.keyboard.down(c4);await wait(100);await page.keyboard.up(c4);await pcm(page,false);
      assert.equal((await graph(page)).editorWorklets,before.editorWorklets);assert.deepEqual((await read(page)).preset,lfo);await frozen(page,lfoPause);
    }

    step('Channel changes, Resume, Stop, Code Run and project replacement retire temporary audition and fence late preparation without losing newer performers');
    await channel(page,2);await press(page,c4);await channel(page,4);await page.keyboard.up(c4);await pcm(page,false);
    await until(()=>graph(page).then(v=>v.liveWorklets===1),'view change retires audition');assert.deepEqual((await read(page)).preset,lfo);await frozen(page,lfoPause);
    await channel(page,2);await page.evaluate(()=>__hucSongAudit.gateNextTrial());await page.locator('#synthTitle').click();await page.keyboard.down(c4);
    await until(()=>page.evaluate(()=>__hucSongAudit.gate().entered),'held audition setup');await page.locator('#hucSongPlayButton').click();await page.evaluate(()=>__hucSongAudit.releaseTrialGate());
    await phase(page,'playing');await page.keyboard.up(c4);await until(()=>graph(page).then(v=>v.liveWorklets===1),'late trial disposed');await pcm(page);
    assert.deepEqual((await read(page)).preset,lfo);await until(()=>state(page).then(v=>v.frame>lfoPause.frame+4410),'Resume advances original source');
    await pause(page);await channel(page,2);await press(page,c4);await selectIndex(page);
    await page.locator('#synthCodeEditor').fill(`const pce=await useSoundChip('huc6280');\nawait pce.noteOn(CH3,'A3');\n`);await runCode(page);
    await phase(page,'stopped');await until(()=>graph(page).then(v=>v.liveWorklets===1),'Code has no audition owner');await page.keyboard.up(c4);await pcm(page);
    assert.equal((await read(page,'observeCode')).registers[2][4]&128,128,'late trial release cannot cut Code');await page.locator('#synthCodeStopButton').click();await pcm(page,false);
    await page.locator('#synthInputKeyboardTab').click();await play(page);await until(()=>state(page).then(v=>v.frame>8820),'Stop trial position');await pause(page);await channel(page,0);await press(page,c4);
    await stop(page);await page.keyboard.up(c4);await until(()=>graph(page).then(v=>v.liveWorklets===1),'Stop retires audition');assert.deepEqual((await read(page)).preset,lfo);
    await play(page);await until(()=>state(page).then(v=>v.frame>8820),'project trial position');await pause(page);await channel(page,0);await press(page,c4);
    await page.locator('#hucProjectFileInput').setInputFiles({name:'captured.cassette.zip',mimeType:'application/zip',buffer:projectBytes});
    await until(()=>page.locator('#hucFilesStatus').textContent().then(text=>/project imported/i.test(text)),'project replaced');await page.keyboard.up(c4);await phase(page,'stopped');await pcm(page,false);
    assert.equal((await state(page)).frame,0);assert.deepEqual((await read(page)).preset,capturedWave);await until(()=>graph(page).then(v=>v.liveWorklets===1),'workspace replacement disposes trial');
    await channel(page,'synth');await page.locator('[data-stepper-for="volume"][data-stepper-delta="1"]').click();
    await until(async()=>(await read(page)).preset.volume===capturedWave.volume+1,'restore selection sentinel');
    await files(page);for(let i=0;i<12;i++){const closed=page.locator('#hucFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
    const savedPath='/'+savedSounds.find(value=>JSON.stringify(value.preset)===JSON.stringify(capturedWave)).path;
    await page.locator('#hucFilesTree [data-file-path='+JSON.stringify(savedPath)+']').click();
    await until(async()=>JSON.stringify((await read(page)).preset)===JSON.stringify(capturedWave),'saved Capture preset reloads from Files');

    step('Capture and compact reference controls fit desktop/mobile; pagehide closes the shared context and every temporary source');
    await page.locator('#synthInputKeyboardTab').click();await play(page);await until(()=>state(page).then(v=>v.frame>48510),'final LFO snapshot');await pause(page);await channel(page,0);
    for(const width of[1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#hucCodeLiveTools').scrollIntoViewIfNeeded();
      const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#hucCodeLiveTools select,#hucCodeLiveTools input,#hucCodeLiveTools button,#hucSongPlayer select,#hucSongPlayer button')].filter(node=>!node.hidden&&node.getClientRects().length).map(node=>({id:node.id,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));
      assert(bounds.scroll<=width+1);assert(bounds.controls.every(item=>item.left>=-1&&item.right<=width+1));measurements['layout'+width]=bounds;
      await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    await press(page,c4);measurements.finalGraph=await graph(page);assert.equal(measurements.finalGraph.contexts,1);assert.equal(measurements.finalGraph.destinationConnections,1);assert(measurements.finalGraph.muted);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await until(()=>graph(page).then(v=>v.runningContexts===0&&v.liveSources===0&&v.liveWorklets===0),'pagehide retires all routes');
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,graph:await graph(page),pageErrors:errors,consoleErrors};
  }catch(error){const diagnostic={stage,song:await state(page).catch(()=>null),view:await view(page).catch(()=>null),audio:await page.locator('#audioStatus').textContent().catch(()=>''),
    code:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),graph:await graph(page).catch(()=>null),commands:await page.evaluate(()=>__hucSongAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,consoleErrors};throw error;
  }finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
module.exports={makeFixture};
if(require.main===module)(async()=>{
  const{loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href),fixture=makeFixture();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixture,loadPlaygroundCassette));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),
    fixture:{bytes:fixture.bytes.length,sha256:hash(fixture.bytes),samples:fixture.samples,segments:fixture.segments},results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
