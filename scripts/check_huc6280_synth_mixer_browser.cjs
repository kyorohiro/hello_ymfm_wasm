// SPDX-License-Identifier: BSD-3-Clause
// Original HuC6280 VGM / VGZ fixtures and the real WASM/audio route. No speaker
// receives audio: intercept every destination before application JS, use gain 0,
// and also launch Chromium with --mute-audio. This is not a listening test.
// node scripts/check_huc6280_synth_mixer_browser.cjs --root=docs --entry=/synth-huc6280/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'huc6280-synth-mixer-browser.json'),screenshots:path.join(tmpdir(),'huc6280-synth-mixer-images')};
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
function makeFixture(kind='wave'){
  const commands=[];let samples=0;
  const sleep=frames=>{while(frames){const count=Math.min(65535,frames);commands.push(0x61,count&255,count>>8);samples+=count;frames-=count;}};
  commands.push(...write(1,255),...write(8,7),...write(9,0));
  for(let channel=0;channel<6;channel++)commands.push(...upload(channel,channel===1?modulatorWave:wave,{volume:0,period:channel===1?713:500}),...write(4,0));
  if(kind==='wave'){
    commands.push(...upload(0,wave,{period:500,volume:24,balance:0xf0}),...upload(2,laterWave,{period:360,volume:24,balance:0x0f}));
    sleep(44100);commands.push(...write(0,0),...write(4,128|25));sleep(29*44100);
  }else if(kind==='noise'){
    commands.push(...write(0,4),...write(5,255),...write(7,0x8d),...write(4,128|24));sleep(30*44100);
  }else if(kind==='dda'){
    commands.push(...write(0,3),...write(5,255),...write(4,0xc0|24));
    for(let i=0;i<16384;i++){commands.push(...write(6,i%32));sleep(16);}
    commands.push(...write(4,0));sleep(4410);
  }else if(kind==='lfo'){
    commands.push(...upload(0,laterWave,{period:250,volume:24,balance:0xf0}),...upload(1,modulatorWave,{period:713,volume:0}),...write(8,7),...write(9,2));sleep(30*44100);
  }else throw Error('Unknown fixture kind');
  commands.push(0x66);const bytes=Buffer.alloc(256+commands.length);bytes.write('Vgm ');bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x171,8);
  bytes.writeUInt32LE(samples,0x18);bytes.writeUInt32LE(0xcc,0x34);bytes.writeUInt32LE(3579545,0xa4);bytes.set(commands,256);return{bytes,samples,kind};
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
    const analyser=this.context.createAnalyser(),mute=this.context.createGain(),split=this.context.createChannelSplitter(2),left=this.context.createAnalyser(),right=this.context.createAnalyser();
    analyser.fftSize=left.fftSize=right.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(this,split);connect.call(split,left,0);connect.call(split,right,1);connect.call(left,mute);connect.call(right,mute);
    connect.call(mute,destination);meters.push({source:this,analyser,left,right,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){const item=nodes.find(value=>value.node.port===this);
    if(data?.method==='dispose'&&item)item.disposed=true;
    if(data?.method){commands.push({method:data.method,args:data.method==='code'?data.args?.slice(0,2):[]});if(commands.length>1500)commands.shift();}
    if(trialGate&&!trialGate.entered&&data?.method==='loadPreset'&&item&&nodes.indexOf(item)>0){
      trialGate.entered=true;trialGate.release=()=>{if(!item.disposed)post.call(this,data,...args);};return;
    }
    return post.call(this,data,...args);};
  function channelLevel(analyser){const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let sum=0,squares=0,peak=0;for(const v of values){sum+=v;squares+=v*v;peak=Math.max(peak,Math.abs(v));}return{acRms:Math.sqrt(Math.max(0,squares/values.length-(sum/values.length)**2)),peak};}
  function output(){const active=meters.filter(item=>item.source.context.state==='running').map(item=>{
    const values=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0;
    for(const value of values){sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2)),peak,finite:values.every(Number.isFinite),left:channelLevel(item.left),right:channelLevel(item.right)};
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
const view=page=>page.evaluate(()=>({tools:{...document.querySelector('#hucCodeLiveTools').dataset},editor:{...document.querySelector('#voiceEditor').dataset},
  channel:document.querySelector('#hucChannelSelect').value,source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,
  volume:Number(document.querySelector('#volume').textContent),readout:document.querySelector('#hucChannelReadout').textContent,
  capture:document.querySelector('#hucSongCaptureStatus')?.textContent??'',captureDisabled:document.querySelector('#hucSongCaptureButton')?.disabled,
  wave:__hucSongAudit.wave()}));
async function channel(page,value){await page.locator('#hucChannelSelect').selectOption(String(value));await until(()=>view(page).then(v=>v.channel===String(value)&&v.tools.channel===String(value)),'view '+value);}
async function openMenu(page){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();}
async function press(page,key){await page.locator('#synthInputKeyboardTab').click();await page.locator('#synthTitle').click();await page.keyboard.down(key);await until(()=>view(page).then(v=>Number(v.tools.heldCount)>0),'paused audition note');await pcm(page);}
async function release(page,key){await page.keyboard.up(key);await until(()=>view(page).then(v=>Number(v.tools.heldCount)===0),'audition release');await pcm(page,false);}
async function capture(page){await page.locator('#hucSongCaptureButton').click();await until(()=>view(page).then(v=>v.channel==='synth'&&!/capturing/i.test(v.capture)),'captured Synth view');}
async function frozen(page,expected){const now=await state(page);assert.equal(now.phase,'paused');assert.equal(now.frame,expected.frame);assert.equal(now.rendered,expected.rendered);assert.equal(now.source,expected.source);}

async function check(browser,name,origin,fixtures){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(25000);await page.addInitScript(installSilentAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  const toggle=ch=>page.locator('#hucSongChannel'+(ch+1)+'Toggle');
  const enabled=()=>Promise.all(Array.from({length:6},(_,ch)=>toggle(ch).getAttribute('aria-pressed').then(value=>value==='true')));
  async function chip(value){await page.locator('[data-huc-chip-tab="'+value+'"]').click();assert.equal(await page.locator('[data-huc-chip-tab="'+value+'"]').getAttribute('aria-selected'),'true');}
  async function setEnabled(ch,on){
    const previous=await page.locator('[data-huc-chip-tab][aria-selected="true"]').getAttribute('data-huc-chip-tab');
    await chip('mixer');assert(await page.locator('#hucSongChannels').isVisible());
    if((await toggle(ch).getAttribute('aria-pressed')==='true')!==on)await toggle(ch).click();
    assert.equal(await toggle(ch).getAttribute('aria-pressed'),String(on));if(previous!=='mixer')await chip(previous);
  }
  async function setAll(on){for(let ch=0;ch<6;ch++)await setEnabled(ch,on);}
  async function importSource(kind,{menu=false}={}){const fixture=fixtures[kind],file={name:'mixer-'+kind+'.vgm',mimeType:'application/octet-stream',buffer:fixture.bytes};
    if(menu){await openMenu(page);const chooser=page.waitForEvent('filechooser');await page.locator('#loadVgm').click();await(await chooser).setFiles(file);}else await page.locator('#vgmFileInput').setInputFiles(file);
    await until(()=>page.locator('#hucSongSelect option[value="/vgm/mixer-'+kind+'.vgm"]').count().then(Boolean),'source '+kind);
    await until(()=>page.locator('#vgmLibrary').getAttribute('data-loading').then(value=>value==='false'),'analysis '+kind);await choose(page,'/vgm/mixer-'+kind+'.vgm');}
  async function levels(left,right){let out;await until(async()=>{out=await page.evaluate(()=>__hucSongAudit.output());return out.muted&&out.finite&&Boolean(out.left)&&
      (left?out.left.acRms>.00005:out.left.peak<1e-7)&&(right?out.right.acRms>.00005:out.right.peak<1e-7);},'stereo output '+left+'/'+right);return out;}
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Six VGM On/Off buttons default On, are passive before audio, and menu import plus loudest Wave grouping remain available');
    assert(await page.locator('#hucSongChannels').isHidden());await importSource('wave',{menu:true});assert(await page.locator('#hucSongChannels').isHidden(),'VGM output switches live only in Mixer');await chip('mixer');assert(await page.locator('#hucSongChannels').isVisible());
    assert.deepEqual(await enabled(),Array(6).fill(true));for(let ch=0;ch<6;ch++){assert.equal(await toggle(ch).evaluate(node=>Boolean(node.closest('#mixerChipPanel'))),true);await setEnabled(ch,false);await setEnabled(ch,true);}
    await chip('huc6280');assert(await page.locator('#hucSongChannels').isHidden());assert.equal((await graph(page)).contexts,0);assert.equal(await page.locator('#synthMenu').evaluate(node=>node.open),false);
    const all=await page.locator('[data-vgm-voice]').count();await page.locator('#vgmKeepLoudestPcm').check();const grouped=await page.locator('[data-vgm-voice]').count();assert(grouped<all);await page.locator('#vgmKeepLoudestPcm').uncheck();
    measurements.grouping={all,grouped};

    step('CH1 left and CH3 right mute independently while playback time advances, preserving the authored instrument and one shared Master route');
    await channel(page,0);await play(page);await levels(true,true);const author=(await read(page)).preset,first=await state(page);
    await setEnabled(0,false);measurements.onlyRight=await levels(false,true);await setEnabled(2,false);await levels(false,false);
    await setEnabled(0,true);measurements.onlyLeft=await levels(true,false);await setEnabled(2,true);await levels(true,true);
    await until(()=>state(page).then(value=>value.frame>first.frame+4410),'muting does not stop transport');assert.deepEqual((await read(page)).preset,author);
    const route=await graph(page);assert.equal(route.contexts,1);assert.equal(route.destinationConnections,1);assert.equal(route.editorWorklets,1);assert(route.muted);measurements.route=route;

    step('Mixer switches are independent of selected CH and Auto update; frozen source settings do not change when its output is muted');
    await page.locator('#hucLiveEnabled').uncheck();const live=await view(page);await setEnabled(0,false);await channel(page,2);assert.equal(await toggle(0).getAttribute('aria-pressed'),'false');await channel(page,0);
    const unchanged=await view(page);assert.equal(unchanged.volume,live.volume);assert.deepEqual(unchanged.wave,live.wave);assert.equal(unchanged.editor.positionFrames,live.editor.positionFrames);
    await page.locator('#hucLiveEnabled').check();await pause(page);const paused=await state(page);await setAll(false);await frozen(page,paused);

    step('All reference channels Off do not mute paused CH audition, Capture, or the captured Synth keyboard voice');
    const key=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(key);await press(page,key);await frozen(page,paused);await release(page,key);
    await capture(page);await frozen(page,paused);assert.deepEqual(await enabled(),Array(6).fill(false));const captured=(await read(page)).preset;assert.deepEqual(captured.wave,wave);assert.equal(captured.envelope.enabled,false);
    await page.locator('#synthTitle').click();await page.keyboard.down(key);await pcm(page);await page.keyboard.up(key);await pcm(page,false);await frozen(page,paused);

    step('Stop/Play and a new reference source retain the mixer flags; fully muted songs still advance and restoring a switch restores their PCM');
    await stop(page);assert.deepEqual(await enabled(),Array(6).fill(false));await play(page);await levels(false,false);const silent=await state(page);await until(()=>state(page).then(value=>value.frame>silent.frame+4410),'muted song advances');await stop(page);
    await importSource('noise');assert.deepEqual(await enabled(),Array(6).fill(false));await play(page);await levels(false,false);await setEnabled(4,true);measurements.noise=await levels(true,true);await setEnabled(4,false);await levels(false,false);await stop(page);
    await importSource('dda');assert.deepEqual(await enabled(),Array(6).fill(false));await setEnabled(3,true);await play(page);measurements.dda=await levels(true,true);await setEnabled(3,false);await levels(false,false);await setEnabled(3,true);await levels(true,true);await stop(page);

    step('CH2 output Off preserves the active hardware LFO carrier and source snapshot, and paused pair Capture ignores reference mute flags');
    await importSource('lfo');await setAll(false);await setEnabled(0,true);await setEnabled(1,true);await channel(page,0);await play(page);await levels(true,false);const lfoShown=await view(page),at=await state(page);
    await setEnabled(1,false);measurements.lfoCarrier=await levels(true,false);await until(()=>state(page).then(value=>value.frame>at.frame+4410),'LFO carrier continues');
    const after=await view(page);assert.equal(after.editor.source,'wave');assert.equal(after.volume,lfoShown.volume);assert.deepEqual(after.wave,lfoShown.wave);
    await pause(page);const lfoPause=await state(page);await capture(page);await frozen(page,lfoPause);const lfo=(await read(page)).preset;assert(lfo.lfo.enabled);assert.equal(lfo.lfo.modulatorPeriod,713);assert.equal(lfo.lfo.carrierPeriod,250);
    assert.deepEqual(await enabled(),[true,false,false,false,false,false]);

    step('Mixer buttons release focus and keep musical key input available without rewriting author or source parameters');
    await setEnabled(0,false);assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'hucSongChannel1Toggle');
    await page.keyboard.down(key);await pcm(page);await page.keyboard.up(key);await pcm(page,false);await frozen(page,lfoPause);assert.deepEqual((await read(page)).preset,lfo);
    await channel(page,0);assert.equal((await view(page)).editor.readonly,'false');

    step('Mixer, Channel/Auto/Capture, Sounds and monitor keep compact order at 1240/390px; pagehide releases the only muted output route');
    assert.equal(await page.locator('#hucCodeLiveTools').evaluate(node=>Boolean(node.closest('#hucSongPlayer'))),true);
    assert(await page.evaluate(()=>{const mixer=document.querySelector('#hucSongChannels'),live=document.querySelector('#hucCodeLiveTools'),song=document.querySelector('#hucSongPlayer'),sounds=document.querySelector('#vgmImport'),monitor=document.querySelector('.huc-monitor');return document.querySelector('#mixerChipPanel').contains(mixer)&&!song.contains(mixer)&&song.contains(live)&&Boolean(song.compareDocumentPosition(sounds)&4)&&Boolean(sounds.compareDocumentPosition(monitor)&4);}));
    for(const width of[1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#hucSongPlayer').scrollIntoViewIfNeeded();const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#hucSongPlayer button,#hucSongPlayer select,#hucSongPlayer input')].filter(node=>node.getClientRects().length).map(node=>({id:node.id,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));
      assert(bounds.scroll<=width+1);assert(bounds.controls.every(item=>item.left>=-1&&item.right<=width+1));measurements['layout'+width]=bounds;await chip('mixer');
      const mixerBounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('#hucSongChannels button')].map(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));
      assert(mixerBounds.scroll<=width+1);assert(mixerBounds.buttons.every(item=>item.left>=-1&&item.right<=width+1));assert(await page.locator('#hucSongChannels').isVisible());measurements['mixerLayout'+width]=mixerBounds;
      await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});await chip('huc6280');}
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await until(()=>graph(page).then(value=>value.runningContexts===0&&value.liveSources===0&&value.liveWorklets===0),'pagehide');
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,graph:await graph(page),pageErrors:errors,consoleErrors};
  }catch(error){const diagnostic={stage,song:await state(page).catch(()=>null),view:await view(page).catch(()=>null),enabled:await enabled().catch(()=>null),output:await page.evaluate(()=>__hucSongAudit.output()).catch(()=>null),graph:await graph(page).catch(()=>null)};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,consoleErrors};throw error;
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
  const fixtures=Object.fromEntries(['wave','noise','dda','lfo'].map(kind=>[kind,makeFixture(kind)]));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixtures));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),
    fixtures:Object.fromEntries(Object.entries(fixtures).map(([kind,value])=>[kind,{bytes:value.bytes.length,sha256:hash(value.bytes),samples:value.samples}])),results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
