// SPDX-License-Identifier: BSD-3-Clause
// Genuine keyboard checks for paused PSF channel audition. Every physical
// destination is intercepted before app startup and stays at gain zero.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'spu-psf-paused-audition-browser.json'),screenshots:path.join(tmpdir(),'spu-psf-paused-audition-browser')};
for(const argument of process.argv.slice(2)){
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);assert(match,'Unknown option '+argument);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function until(predicate,label){const end=Date.now()+25000;while(Date.now()<end){if(await predicate())return;await wait(30);}throw Error('Timeout: '+label);}
const served=new Map(),missing=[],external=[],results=[];

function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,
    connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,
    createGain=BaseAudioContext.prototype.createGain,sourceStart=AudioBufferSourceNode.prototype.start,sourceStop=AudioBufferSourceNode.prototype.stop,timer=setTimeout.bind(window);
  const contexts=[],nodes=[],meters=[],gains=[],edges=[],commands=[],keys=[],pointer=[],starts=[],stops=[],pending=new WeakMap();
  let sequence=0,session=null,delay=null,delays=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  BaseAudioContext.prototype.createGain=function(...args){const gain=createGain.apply(this,args);gains.push(gain);return gain;};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){
    super(context,name,...args);nodes.push({node:this,name});
    this.port.addEventListener('message',({data})=>{
      const requests=pending.get(this.port),command=requests?.get(data?.id);if(!command)return;requests.delete(data.id);
      if(command.method==='beginCode'&&!data.error)session=data.value?.session??null;
      if(command.method==='stop'&&!data.error)session=null;
    });
  }};
  AudioNode.prototype.connect=function(destination,...ports){
    const label=node=>gains.includes(node)?'gain:'+gains.indexOf(node):node.constructor.name;
    edges.push({source:label(this),destination:label(destination)});
    if(destination!==this.context.destination)return connect.call(this,destination,...ports);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...ports);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  AudioBufferSourceNode.prototype.start=function(...args){starts.push({time:this.context.currentTime,when:args[0],offset:args[1],duration:args[2]});return sourceStart.apply(this,args);};
  AudioBufferSourceNode.prototype.stop=function(...args){stops.push({time:this.context.currentTime});return sourceStop.apply(this,args);};
  const summarize=value=>{
    if(ArrayBuffer.isView(value))return {typedArray:value.constructor.name,length:value.length,byteLength:value.byteLength};
    if(value instanceof ArrayBuffer)return {arrayBufferBytes:value.byteLength};
    if(Array.isArray(value))return value.map(summarize);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,summarize(item)]));
    return value;
  };
  MessagePort.prototype.postMessage=function(message,...args){
    if(message?.method){
      commands.push({at:performance.now(),method:message.method,args:summarize(message.args??[])});
      let requests=pending.get(this);if(!requests)pending.set(this,requests=new Map());requests.set(message.id,{method:message.method});
      if(delay&&message.method==='code'&&message.args?.[1]===delay.method){const ms=delay.ms;delay=null;delays++;timer(()=>post.call(this,message,...args),ms);return;}
    }
    return post.call(this,message,...args);
  };
  for(const type of ['keydown','keyup'])window.addEventListener(type,event=>keys.push({type,key:event.key,code:event.code,trusted:event.isTrusted,at:performance.now()}),true);
  for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>{
    const target=event.target.closest('button,select,input'),box=target?.getBoundingClientRect();
    pointer.push({type,trusted:event.isTrusted,id:target?.id??'',text:target?.textContent?.slice(0,100),x:event.clientX,y:event.clientY,
      box:box?{x:box.x,y:box.y,width:box.width,height:box.height}:null,at:performance.now()});
  },true);
  async function read(method='inspect',args=[]){
    const node=nodes.findLast(value=>value.name==='tetorica-spu-synth')?.node;if(!node)throw Error('SPU Worklet missing');
    const id=--sequence;
    return new Promise((resolve,reject)=>{
      const timeout=timer(()=>{node.port.removeEventListener('message',receive);reject(Error('Readonly Worklet audit timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timeout);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});
    });
  }
  function output(){
    const active=meters.filter(value=>value.source.context.state==='running').map(value=>{
      const pcm=new Float32Array(value.analyser.fftSize);value.analyser.getFloatTimeDomainData(pcm);let square=0,peak=0;
      for(const sample of pcm){square+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
      return {peak,rms:Math.sqrt(square/pcm.length),finite:pcm.every(Number.isFinite)};
    }).sort((a,b)=>b.rms-a.rms);
    return {...(active[0]??{peak:0,rms:0,finite:true}),muted:meters.every(value=>value.mute.gain.value===0)};
  }
  window.__pausedAuditionAudit={read,output,instrument:()=>read('getInstrument',[0]),
    async physical(){
      const snapshot=await read('snapshot');return {ramBytes:snapshot.ram.length,
        main:Array.from(snapshot.registers.slice(0x180/2,0x188/2)),control:snapshot.registers[0x1aa/2],
        voices:Array.from({length:3},(_,channel)=>{const raw=Array.from(snapshot.registers.slice(channel*8,channel*8+8)),start=raw[3]*8;
          return {channel,raw,start,adpcm:Array.from(snapshot.ram.slice(start,start+64))};})};
    },
    async preview(){
      const observed=await read('observeCode');if(!observed)return null;
      const voices=observed.channels.filter(value=>value.gate);
      if(!voices.length)return {active:[],nativeFrames:observed.nativeFrames};
      if(session===null)throw Error('Preview has no observed Code session');
      const snapshot=await read('code',[session,'snapshot',[]]);
      return {active:voices.map(voice=>{
        const sample=snapshot.samples.find(value=>value.id===voice.sample);if(!sample)throw Error('Active preview sample missing');
        return {channel:voice.channel,pitch:voice.pitch,adsr1:voice.adsr1,adsr2:voice.adsr2,sample:{...sample},
          adpcm:Array.from(snapshot.ram.slice(sample.startAddress,sample.startAddress+sample.byteLength))};
      }),nativeFrames:observed.nativeFrames};
    },
    graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(value=>value.name==='tetorica-spu-synth').length,
      destinationConnections:meters.length,muted:meters.every(value=>value.mute.gain.value===0),bufferStarts:starts.length,bufferStops:stops.length}),
    gains:()=>({values:gains.map((gain,index)=>({index,value:gain.gain.value})),edges:edges.slice()}),
    commands:()=>commands.slice(),keys:()=>keys.slice(),pointer:()=>pointer.slice(),armPreparationDelay(ms=300){delay={method:'loadADPCM',ms};},delays:()=>delays};
}

async function fixture(){
  const {createPsfSpuFeatureFixture,playbackAdpcm}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_playback_fixture.mjs')).href);
  const a=playbackAdpcm(),b=playbackAdpcm();
  // Original triangle data differs from the original sine in every packet.
  for(let block=0;block<4;block++)for(let pair=0;pair<14;pair++){
    const nibble=index=>Math.round(6*(1-4*Math.abs(index/112-.5)))&15,index=block*28+pair*2;
    b[block*16+pair+2]=nibble(index)|(nibble(index+1)<<4);
  }
  const data=new DataView(b.buffer),writes=[[0x1aa,0xc010],[0x1a6,0x3000/8]];
  for(let at=0;at<b.length;at+=2)writes.push([0x1a8,data.getUint16(at,true)]);
  writes.push([0x1aa,0xc000]);
  for(const [at,value]of [[0,0x2000],[2,0x1000],[4,0x0c00],[6,0x3000/8],[8,0x000f],[10,0x1fc0],[14,0x3000/8]])writes.push([0x10+at,value]);
  // CH3 is deliberately Noise: unsupported preview must not retire the song.
  for(const [at,value]of [[0,0x0800],[2,0x0800],[4,0x1000],[6,0x3000/8],[8,0x000f],[10,0x1fc0],[14,0x3000/8]])writes.push([0x20+at,value]);
  writes.push([0x194,4],[0x188,7]);
  const authored=createPsfSpuFeatureFixture({pitch:0x1800,steps:[{delay:4096,writes}]});
  return {...authored,a:Array.from(a),b:Array.from(b),pitches:[0x1800,0x0c00]};
}

const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(request,response)=>{try{
  const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),relative=path.relative(config.root,filename).split(path.sep).join('/'),record={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(relative))assert.deepEqual(served.get(relative),record,'asset changed during check');served.set(relative,record);
  response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
}catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}});

async function check(browser,name,origin,authored){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'});
  page.setDefaultTimeout(25000);const errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs\.cloudflare\.com|Failed to load resource|Load failed/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com')return route.abort();
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);
  const step=value=>{stage=value;checks.push(value);console.log(`CHECK ${name}: ${value}`);};
  const read=()=>page.evaluate(()=>__pausedAuditionAudit.read()),instrument=()=>page.evaluate(()=>__pausedAuditionAudit.instrument());
  const preview=()=>page.evaluate(()=>__pausedAuditionAudit.preview());
  const commands=()=>page.evaluate(()=>__pausedAuditionAudit.commands());
  const graph=()=>page.evaluate(()=>__pausedAuditionAudit.graph());
  const view=()=>page.evaluate(()=>({bar:!document.getElementById('spuCodeLiveTools').hidden,songBar:!document.getElementById('psfSongPlayer').hidden,
    pause:document.getElementById('psfPauseSong').textContent,position:document.getElementById('psfSongPosition').dataset.seconds,
    frame:document.getElementById('spuVoicePanel').dataset.observationFrame,voice:document.getElementById('spuLiveChannel').value,
    audition:{...document.getElementById('spuCodeLiveTools').dataset},status:document.getElementById('audioStatus').textContent,
    activity:{ready:document.getElementById('spuPsfChannelActivity').dataset.ready,
      channels:[...document.querySelectorAll('#spuPsfChannelActivity [data-psf-channel]')].map(button=>({channel:Number(button.dataset.psfChannel),
        active:button.dataset.active,lit:button.dataset.lit,gate:button.dataset.gate,env:button.dataset.env,available:button.dataset.available,selected:button.getAttribute('aria-pressed')}))}}));
  async function menu(id){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();await page.locator(id).click();}
  async function paused(){await page.locator('#psfPauseSong').click({delay:5});await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Resume'),'PSF paused');}
  async function playPaused(){await page.locator('#psfPlaySong').click({delay:5});await until(async()=>Number((await view()).frame)>=2205,'audible PSF snapshot');await paused();await until(()=>page.locator('#spuPsfCapture').isEnabled(),'paused ordinary channel');}
  async function assertPaused(before){const after=await view();assert(after.bar&&after.songBar,'PSF and CH controls stay visible');assert.equal(after.pause,'Resume');assert.equal(after.frame,before.frame);assert.equal(after.position,before.position);
    assert.equal(after.activity.ready,'true');assert.deepEqual(after.activity.channels.map(({selected,...channel})=>channel),before.activity.channels.map(({selected,...channel})=>channel),'temporary keyboard output cannot change the frozen PSF activity');return after;}
  async function keyFor(note){const key=page.locator('#keyboardKeys .key').filter({hasText:new RegExp('\\b'+note+'\\b')}).first();assert(await key.count(),'keyboard has '+note);const letter=await key.getAttribute('data-key');assert(letter);return letter;}
  async function held(expectedBytes,expectedPitch){let value;await until(async()=>{value=await preview();return value?.active.length===1;},'temporary selected-channel key');
    assert.equal(value.active[0].pitch,expectedPitch);assert.deepEqual(value.active[0].adpcm,expectedBytes);
    await until(async()=>{const output=await page.evaluate(()=>__pausedAuditionAudit.output());return output.finite&&output.muted&&output.rms>.00001;},'upstream preview PCM behind physical gain zero');return value;
  }
  async function noPreviewKeys(){await until(async()=>{const value=await preview();return !value||value.active.length===0;},'no orphaned preview gate');}
  async function importDocument(document){await page.locator('#presetFileInput').setInputFiles({name:'audition-author.spu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});
    await until(()=>page.locator('#audioStatus').textContent().then(value=>value===`Loaded ${document.name}.`),'authored instrument import');}
  async function preparationRace(action){
    const before=await page.evaluate(()=>__pausedAuditionAudit.delays());await page.evaluate(()=>__pausedAuditionAudit.armPreparationDelay());
    await page.keyboard.down(c4);await until(async()=>await page.evaluate(()=>__pausedAuditionAudit.delays())>before,'delayed temporary sample preparation');
    await action();await page.keyboard.up(c4);await wait(400);await noPreviewKeys();
  }
  let c4;
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files ready');
    await page.locator('#startAudio').click();await until(()=>page.locator('#startAudio').textContent().then(value=>value==='Audio ready'),'editor audio ready');
    let original=await instrument();const originalBank=await read();c4=await keyFor('C4');
    const chooser=page.waitForEvent('filechooser');await menu('#loadPsf');await(await chooser).setFiles([
      {name:'audition-fixture.psf',mimeType:'application/octet-stream',buffer:Buffer.from(authored.standalone)},
      {name:'other-fixture.psf',mimeType:'application/octet-stream',buffer:Buffer.from(authored.standalone)},
    ]);
    await until(()=>page.locator('#psfPlaySong').isEnabled(),'PSF imported');await page.locator('#psfEntry').selectOption('audition-fixture.psf');
    await page.locator('[data-spu-editor-tab="pcm"]').click();await playPaused();
    const frozen=await view(),sourceGraph=await graph();
    step('A genuine paused keyboard key plays selected CH1 without stopping or advancing the PSF');
    await page.keyboard.down(c4);measurements.ch1=await held(authored.a,authored.pitches[0]);await assertPaused(frozen);
    assert.deepEqual(await instrument(),original,'temporary preview never replaces the authored instrument');
    await page.keyboard.up(c4);await noPreviewKeys();await assertPaused(frozen);
    assert.equal((await graph()).bufferStarts,sourceGraph.bufferStarts,'preview schedules no new PSF source buffers');
    assert.equal((await graph()).bufferStops,sourceGraph.bufferStops,'preview does not stop any additional PSF source buffer');
    step('CH and reference-key selection change preview bytes/PITCH while retaining the same frozen all-channel frame');
    await page.locator('#spuPsfChannelActivity [data-psf-channel="1"]').click({delay:5});
    assert.equal(await page.locator('#spuLiveChannel').inputValue(),'1');assert.equal((await view()).activity.channels[1].selected,'true');
    assert.equal(await page.locator('#spuPsfChannelActivity [data-psf-channel="1"]').evaluate(button=>button===document.activeElement),false);
    await page.keyboard.down(c4);measurements.ch2=await held(authored.b,authored.pitches[1]);
    const sameChannelStart=(await commands()).length;await page.locator('#spuPsfChannelActivity [data-psf-channel="1"]').click({delay:5});await held(authored.b,authored.pitches[1]);
    assert(!(await commands()).slice(sameChannelStart).some(command=>command.method==='stop'||command.method==='code'&&!['snapshot','getState','getPreset'].includes(command.args[1])),'selecting the held current channel does not retire or retrigger its preview');
    await assertPaused(frozen);await page.keyboard.up(c4);await noPreviewKeys();
    await page.locator('#spuPsfReferenceKey').selectOption('C5');await page.keyboard.down(c4);await held(authored.b,authored.pitches[1]/2);
    await page.keyboard.up(c4);await noPreviewKeys();await assertPaused(frozen);
    step('Rapid key-up during delayed setup and unsupported Noise selection leave no late note or PSF Stop');
    await page.locator('#spuLiveChannel').selectOption('0');const commandStart=(await commands()).length;
    await preparationRace(async()=>{});await assertPaused(frozen);
    assert(!(await commands()).slice(commandStart).some(value=>value.method==='code'&&value.args[1]==='noteOn'),'released pending key never posts a late note-on');
    await page.locator('#spuLiveChannel').selectOption('2');await page.keyboard.down(c4);
    await until(async()=>/Noise|ordinary ADPCM|cannot|not supported/i.test((await view()).status),'unsupported Noise preview rejected');
    await page.keyboard.up(c4);await noPreviewKeys();await assertPaused(frozen);
    await page.locator('#spuLiveChannel').selectOption('0');await page.locator('#spuPsfReferenceKey').selectOption('C4');
    step('Sustain, Release notes, blur and Live Off do not strand notes or remove the paused song');
    await page.locator('#sustainToggle').check();await page.keyboard.down(c4);await held(authored.a,authored.pitches[0]);await page.keyboard.up(c4);
    assert.equal((await preview()).active.length,1);await page.locator('#allNotesOff').click();await noPreviewKeys();await assertPaused(frozen);
    await page.keyboard.down(c4);await held(authored.a,authored.pitches[0]);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up(c4);await noPreviewKeys();
    await page.locator('#spuLiveEnabled').uncheck();await page.keyboard.down(c4);await until(async()=>(await read()).auditions.length===1,'Live Off auditions the authored editor');
    await until(async()=>{const output=await page.evaluate(()=>__pausedAuditionAudit.output());return output.muted&&output.finite&&output.rms>.00001;},'restored neutral editor output after preview');
    assert.equal((await view()).pause,'Resume');assert.equal((await view()).position,frozen.position);await page.keyboard.up(c4);await page.locator('#allNotesOff').click();
    await until(async()=>(await read()).auditions.length===0,'Live Off Release notes clears authored key owners');
    await page.locator('#spuLiveEnabled').check();await assertPaused(frozen);
    const playedEditor=await instrument(),expectedEditorPitch=Math.round(4096*(440*2**((60-69)/12))/original.sample.baseFrequencyHz);
    assert.equal(playedEditor.preset.pitch,expectedEditorPitch,'explicit authored C4 updates its ordinary sounding pitch');
    assert.deepEqual({...playedEditor,preset:{...playedEditor.preset,pitch:original.preset.pitch}},original,'ordinary key leaves every other authored setting and sample unchanged');
    const playedBank=await read();assert.deepEqual(playedBank.samples,originalBank.samples);assert.equal(playedBank.nextAddress,originalBank.nextAddress);
    original=playedEditor;
    step('Resume, source replacement and Stop fence pending preview setup and restore the exact authored bank');
    await page.locator('#spuLiveChannel').selectOption('1');await preparationRace(async()=>{await page.locator('#psfPauseSong').click({delay:5});});
    await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Pause'),'resumed source');
    await until(async()=>Number((await view()).position)>Number(frozen.position),'resumed source consumes later PCM');
    assert((await graph()).bufferStarts>sourceGraph.bufferStarts);assert.deepEqual(await instrument(),original);await paused();
    await page.locator('#spuLiveChannel').selectOption('0');await preparationRace(async()=>{await page.locator('#psfEntry').selectOption('other-fixture.psf');});
    await until(()=>page.locator('#psfPlaySong').isEnabled(),'replacement source ready');assert.deepEqual(await instrument(),original);
    await page.locator('#psfEntry').selectOption('audition-fixture.psf');await playPaused();await page.locator('#spuLiveChannel').selectOption('1');
    await preparationRace(async()=>{await page.locator('#psfStopSong').click();});await until(()=>page.locator('#psfPlaySong').isEnabled(),'PSF stopped');
    assert.deepEqual(await instrument(),original);const restored=await read();assert.deepEqual(restored.samples,originalBank.samples);assert.equal(restored.nextAddress,originalBank.nextAddress);
    step('Code Run retires preview ownership; a stale keyboard release cannot stop its new session');
    await playPaused();await page.locator('#spuLiveChannel').selectOption('0');await page.keyboard.down(c4);await held(authored.a,authored.pitches[0]);
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    await page.locator('#synthCodeEditor').fill("const ps1=await useSoundChip('ps1');await ps1.noteOn(CH1,'A4');log('paused-preview-code-owner');");
    await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeLog').textContent().then(value=>value.includes('paused-preview-code-owner')),'new Code owner');
    await page.keyboard.up(c4);assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    assert.deepEqual(await instrument(),original);assert((await page.evaluate(()=>__pausedAuditionAudit.read('observeCode'))).channels[0].gate);
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code Stop');
    await page.locator('#synthInputKeyboardTab').click();await noPreviewKeys();
    step('Capture after temporary preview preflights the authored bank and keeps original PSF bytes and reference tuning');
    await playPaused();await page.locator('#spuLiveChannel').selectOption('1');await page.locator('#spuPsfReferenceKey').selectOption('C5');
    await page.keyboard.down(c4);await held(authored.b,authored.pitches[1]/2);const captureStart=(await commands()).length;
    await page.locator('#spuPsfCapture').click({delay:5});await until(()=>page.locator('#audioStatus').textContent().then(value=>value.startsWith('Captured CH 2')),'permanent Capture');await page.keyboard.up(c4);
    const captured=await instrument(),captureCommands=(await commands()).slice(captureStart),lookup=captureCommands.findIndex(value=>value.method==='findADPCM'),restore=captureCommands.findIndex(value=>value.method==='stop');
    assert(restore>=0&&lookup>restore,'temporary checkpoint restoration precedes authored sample/capacity lookup');
    assert.deepEqual(Array.from(captured.sample.adpcm),authored.b,'retained PSF source bytes survive all temporary preview writes');
    assert.equal(captured.preset.pitch,authored.pitches[1]);const referenceHz=440*2**((72-69)/12);
    assert(Math.abs(captured.sample.baseFrequencyHz-referenceHz*4096/authored.pitches[1])<1e-8);assert.deepEqual(captured.reverb,original.reverb);
    const capturedBank=await read();assert(capturedBank.nextAddress>=originalBank.nextAddress);assert.equal(capturedBank.auditions.length,0);
    await page.keyboard.down(c4);await until(async()=>(await read()).auditions.length===1,'captured ordinary Synth key');
    const permanent=await read();assert.equal(permanent.channels[permanent.auditions[0].channel].pitch,authored.pitches[1]/2);
    await until(async()=>{const output=await page.evaluate(()=>__pausedAuditionAudit.output());return output.muted&&output.finite&&output.rms>.00001;},'permanent Capture output after temporary preview');
    await page.keyboard.up(c4);await page.locator('#allNotesOff').click();
    const download=page.waitForEvent('download');await menu('#savePreset');const item=await download,saved=JSON.parse(await fs.readFile(await item.path(),'utf8'));
    step('A full authored RAM bank rejects Capture after preview without losing the paused PSF or authored sound');
    const length=Math.floor((524288-capturedBank.nextAddress-32)/16)*16,adpcm=Array(length).fill(0);for(let at=0;at<length;at+=16)adpcm[at]=12;adpcm[length-15]=1;
    const filler={...saved,name:'Paused audition capacity guard',preset:{...saved.preset,pitch:4096,reverb:false},sample:{adpcm,baseFrequencyHz:440},waveform:null};
    await importDocument(filler);const full=await read(),fullSource=await instrument();assert.equal(524288-full.nextAddress,32);
    await playPaused();await page.locator('#spuLiveChannel').selectOption('0');await page.locator('#spuPsfReferenceKey').selectOption('C3');const capacityFrozen=await view();
    await page.keyboard.down(c4);await held(authored.a,authored.pitches[0]*2);await page.locator('#spuPsfCapture').click({delay:5});await page.keyboard.up(c4);
    await until(()=>page.locator('#audioStatus').textContent().then(value=>value.includes('free SPU sample RAM')),'author-bank capacity failure');await assertPaused(capacityFrozen);
    assert.deepEqual(await instrument(),fullSource);assert.equal((await read()).nextAddress,full.nextAddress);await noPreviewKeys();
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(config.screenshots,`${name}-paused-audition-${width}.png`),fullPage:true});}
    await page.locator('#psfStopSong').click();await noPreviewKeys();
    const finalGraph=await graph();assert(finalGraph.muted);assert.equal(finalGraph.contexts,1);assert.equal(finalGraph.editorWorklets,1);assert.equal(finalGraph.destinationConnections,1);
    const keyEvents=await page.evaluate(()=>__pausedAuditionAudit.keys());assert(keyEvents.length>10&&keyEvents.every(value=>value.trusted),'performance tests use genuine keyboard events');
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return {browser:name,passed:true,checks,measurements,sourceFrozen:frozen,capacityRemaining:32,sourceSampleBytesPreserved:true,
      rawPitches:authored.pitches,referenceNote:'C5',graph:finalGraph,trustedKeyEvents:keyEvents.length,errors,consoleErrors};
  }catch(error){
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-failure.png`),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,stage,error:error.stack,checks,view:await view().catch(()=>null),graph:await graph().catch(()=>null),
      preview:await preview().catch(cause=>({error:cause.message})),commands:(await commands().catch(()=>[])).slice(-30),
      output:await page.evaluate(()=>__pausedAuditionAudit.output()).catch(()=>null),
      gains:await page.evaluate(()=>__pausedAuditionAudit.gains()).catch(()=>null),
      physical:await page.evaluate(()=>__pausedAuditionAudit.physical()).catch(cause=>({error:cause.message})),
      pointer:await page.evaluate(()=>__pausedAuditionAudit.pointer().slice(-20)).catch(()=>[]),errors,consoleErrors};throw error;
  }finally{await page.close();}
}

async function main(){
  await fs.rm(config.out,{force:true});await fs.mkdir(config.screenshots,{recursive:true});const authored=await fixture();
  const checkerSha256=hash(await fs.readFile(__filename));let failure;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{})});
      try{results.push(await check(browser,name,origin,authored));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.equal(hash(await fs.readFile(__filename)),checkerSha256);
    for(const [filename,record]of served)assert.equal(hash(await fs.readFile(path.join(config.root,filename))),record.sha256,'frozen stage '+filename);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const report={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,
    checkerSha256,fixture:{original:true,gameData:false,sha256:hash(authored.standalone),voicePitches:authored.pitches,
      sampleSha256:[hash(Buffer.from(authored.a)),hash(Buffer.from(authored.b))]},results,missing,external,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}:{})};
  await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');if(failure)throw failure;console.log('PASS '+config.out);
}
module.exports={createPausedAuditionFixture:fixture};
if(require.main===module)void main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
