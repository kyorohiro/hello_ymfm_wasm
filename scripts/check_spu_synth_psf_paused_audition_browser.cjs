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
  let sequence=0,session=null,delay=null,delays=0,restoreDelay=0,restoreDelays=0;
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
      if(restoreDelay&&message.method==='stop'){const ms=restoreDelay;restoreDelay=0;restoreDelays++;timer(()=>post.call(this,message,...args),ms);return;}
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
      return {noise:observed.noise,noiseMask:snapshot.registers[0x194/2]|snapshot.registers[0x196/2]<<16,noiseClock:(snapshot.registers[0x1aa/2]>>>8)&63,pmonMask:snapshot.registers[0x190/2]|snapshot.registers[0x192/2]<<16,active:voices.map(voice=>{
        const sample=snapshot.samples.find(value=>value.id===voice.sample);if(!sample)throw Error('Active preview sample missing');
        return {channel:voice.channel,pitch:voice.pitch,adsr1:voice.adsr1,adsr2:voice.adsr2,sample:{...sample},
          adpcm:Array.from(snapshot.ram.slice(sample.startAddress,sample.startAddress+sample.byteLength))};
      }),nativeFrames:observed.nativeFrames};
    },
    graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(value=>value.name==='tetorica-spu-synth').length,
      destinationConnections:meters.length,muted:meters.every(value=>value.mute.gain.value===0),bufferStarts:starts.length,bufferStops:stops.length}),
    gains:()=>({values:gains.map((gain,index)=>({index,value:gain.gain.value})),edges:edges.slice()}),
    commands:()=>commands.slice(),keys:()=>keys.slice(),pointer:()=>pointer.slice(),armPreparationDelay(ms=300){delay={method:'loadADPCM',ms};},delays:()=>delays,armRestoreDelay(ms=1000){restoreDelay=ms;},restoreDelays:()=>restoreDelays};
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
  writes.push([0x1aa,0xc000|(37<<8)]);
  for(const [at,value]of [[0,0x2000],[2,0x1000],[4,0x0c00],[6,0x3000/8],[8,0x000f],[10,0x1fc0],[14,0x3000/8]])writes.push([0x10+at,value]);
  // Noise does not need a sample address or PITCH; capture/preview must not
  // accidentally validate or decode these zero ADPCM registers.
  for(const [at,value]of [[0,0x0800],[2,0x0800],[4,0],[6,0],[8,0x000f],[10,0x1fc0],[14,0]])writes.push([0x20+at,value]);
  writes.push([0x194,4],[0x188,7]);
  const authored=createPsfSpuFeatureFixture({pitch:0x1800,noiseClock:37,steps:[{delay:4096,writes}]});
  return {...authored,a:Array.from(a),b:Array.from(b),pitches:[0x1800,0x0c00]};
}

/** Original source with a delayed encoded Loop Start. At frame 4410 its
 * decoder has not reached packet 3, so the raw Repeat still names an old
 * external address. A fresh key-on resolves the internal marker, unchanged. */
async function createStaleRepeatFixture(){
  const {playbackAdpcm,playbackExe}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_playback_fixture.mjs')).href);
  const {psfFromExe,psfFile}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_fixture.mjs')).href);
  const adpcm=playbackAdpcm();adpcm[1]=0;adpcm[49]=7;
  const startAddress=0x4000,repeatAddress=0x3000,markerAddress=0x4030,pitch=0x10,frame=4410;
  const words=[],emit=word=>words.push(word>>>0),ori=(rt,rs,value)=>emit((0x0d<<26)|(rs<<21)|(rt<<16)|(value&0xffff));
  const write=(offset,value)=>{ori(9,0,value);emit((0x29<<26)|(8<<21)|(9<<16)|(offset&0xffff));};
  emit((0x0f<<26)|(8<<16)|0x1f80);ori(8,8,0x1c00);
  write(0x1ac,4);write(0x1aa,0xc010);write(0x1a6,startAddress/8);
  const view=new DataView(adpcm.buffer);for(let at=0;at<adpcm.length;at+=2)write(0x1a8,view.getUint16(at,true));
  ori(10,0,4096);emit((0x09<<26)|(10<<21)|(10<<16)|0xffff);emit((0x05<<26)|(10<<21)|0xfffe);emit(0);
  write(0x1aa,0xc000);write(0x180,0x3fff);write(0x182,0x3fff);
  for(const [offset,value]of [[0,0x2000],[2,0x1000],[4,pitch],[6,startAddress/8],[8,0x000f],[10,0x1fc0],[14,repeatAddress/8]])write(offset,value);
  write(0x188,1);emit(0x1000ffff);emit(0);
  const text=new Uint8Array(words.length*4),code=new DataView(text.buffer);words.forEach((word,index)=>code.setUint32(index*4,word,true));
  const standalone=psfFromExe(playbackExe(text),'title=Original delayed ADPCM Loop Start\nlength=0:04\nfade=0:00\n');
  // The oracle uses actual CPU/SPU state and the same-boundary RAM, rather
  // than fabricating a snapshot that a browser could never observe.
  const {readPsfFileSet}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_ps1_psf.js')).href);
  const {preparePsfSongSource}=await import(pathToFileURL(path.join(repo,'docs/synth-spu/psf_song_source.js')).href);
  const {createPsfPlaybackCore}=await import(pathToFileURL(path.join(repo,'docs/synth-spu/psf_playback_core.js')).href);
  const {preparePsfVoiceCapture}=await import(pathToFileURL(path.join(repo,'docs/synth-spu/psf_capture.js')).href);
  const set=await readPsfFileSet([psfFile('marker-stale.psf',standalone)]),image=await preparePsfSongSource(set,'marker-stale.psf');
  const wasmBinary=new Uint8Array(await fs.readFile(path.join(repo,'docs/generated/psf-player/psf_player.wasm'))),core=await createPsfPlaybackCore({image,wasmBinary});
  let oracle;
  try{core.render(frame);const state=core.observe(),ram=core.copySpuRam();assert.equal(state.channels[0].startAddress,startAddress);assert.equal(state.channels[0].repeatAddress,repeatAddress);
    const prepared=preparePsfVoiceCapture({state,ram,voice:0,frame,source:{entry:'marker-stale.psf'}},{referenceNote:'C4',reverb:{preset:'off',volumeLeft:0,volumeRight:0}});
    oracle=prepared.capture;assert.equal(oracle.repeatAddress,repeatAddress);assert.equal(oracle.loopSource,'adpcm-marker');assert.equal(oracle.resolvedLoopAddress,markerAddress);assert.equal(oracle.loopStartSamples,84);
    assert.deepEqual(prepared.instrument.sample.adpcm,Array.from(adpcm));
  }finally{core.dispose();}
  return{standalone,adpcm:Array.from(adpcm),startAddress,repeatAddress,markerAddress,pitch,frame,oracle};
}

async function checkStaleRepeatCapture(browser,name,origin,{entry='/synth-spu/index.html',screenshots=tmpdir()}={}){
  const authored=await createStaleRepeatFixture(),page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block',acceptDownloads:true}),errors=[],checks=[];
  page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push(error.stack??error.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com')return route.abort();if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol))return route.abort();return route.continue();});
  await page.addInitScript(installSilentAudit);
  const read=()=>page.evaluate(()=>__pausedAuditionAudit.read()),instrument=()=>page.evaluate(()=>__pausedAuditionAudit.instrument()),preview=()=>page.evaluate(()=>__pausedAuditionAudit.preview());
  const point=()=>page.evaluate(()=>({frame:Number(document.getElementById('spuVoicePanel').dataset.observationFrame),position:document.getElementById('psfSongPosition').dataset.seconds,
    pause:document.getElementById('psfPauseSong').textContent,view:document.getElementById('spuCodeLiveTools').dataset.psfView,voice:document.getElementById('spuLiveChannel').value,
    activity:[...document.querySelectorAll('#spuPsfChannelActivity button')].map(button=>({...button.dataset,selected:button.getAttribute('aria-pressed')}))}));
  async function menu(id){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();await page.locator(id).click();}
  const step=label=>{checks.push(label);console.log('CHECK '+name+': '+label);};
  try{
    await page.goto(origin+entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'marker Files ready');await page.locator('#startAudio').click();await until(()=>page.locator('#startAudio').textContent().then(value=>value==='Audio ready'),'marker editor audio');
    const original=await instrument();await page.locator('#psfFileInput').setInputFiles({name:'marker-stale.psf',mimeType:'application/octet-stream',buffer:Buffer.from(authored.standalone)});
    await until(()=>page.locator('#psfPlaySong').isEnabled(),'marker PSF imported');await page.locator('[data-spu-editor-tab="pcm"]').click();
    step('A real paused PSF has stale external raw Repeat and one internal ADPCM marker');
    await page.locator('#psfSongSeek').evaluate(node=>{node.value='.1';node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(async()=>{const p=await point();return p.pause==='Resume'&&p.frame===authored.frame;},'exact marker paused frame');
    await page.locator('#spuLiveChannel').selectOption('0');await until(()=>page.locator('#spuPsfCapture').isEnabled(),'marker Capture ready');const frozen=await point();assert.equal(Number(frozen.position),0.1);
    step('Genuine paused keyboard audition preserves original bytes and resolves Loop Start to sample 84');
    const key=page.locator('#keyboardKeys .key').filter({hasText:/\bC4\b/}).first(),letter=await key.getAttribute('data-key');assert(letter);await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(letter);
    let temporary;await until(async()=>{temporary=await preview();return temporary?.active.length===1;},'marker temporary key');
    assert.equal(temporary.active[0].pitch,authored.pitch);assert.deepEqual(temporary.active[0].adpcm,authored.adpcm);assert.equal(temporary.active[0].sample.loopStartSamples,84);
    await until(async()=>{const output=await page.evaluate(()=>__pausedAuditionAudit.output());return output.muted&&output.finite&&output.rms>.00001;},'marker actual temporary PCM');
    assert.deepEqual(await instrument(),original);await page.keyboard.up(letter);await until(async()=>!(await preview())?.active.length,'marker key released');assert.deepEqual(await point(),frozen);
    step('Capture retains Pause and the raw source while its saved instrument keeps resolved loop metadata');
    await page.locator('#spuPsfCapture').click({delay:5});await until(()=>page.locator('#audioStatus').textContent().then(value=>value.startsWith('Captured CH 1')),'marker Capture applied');
    const captured=await instrument(),after=await point();assert.equal(after.pause,'Resume');assert.equal(after.position,frozen.position);assert.equal(after.voice,'synth');
    assert.deepEqual(Array.from(captured.sample.adpcm),authored.adpcm);assert.equal(captured.sample.loopStartSamples,84);assert.equal(captured.preset.pitch,authored.pitch);
    assert(Math.abs(captured.sample.baseFrequencyHz-(440*2**((60-69)/12))*4096/authored.pitch)<1e-7);assert.deepEqual(captured.reverb,original.reverb);
    assert.match(after.view,/synth/);await page.locator('#spuPsfChannelActivity [data-psf-channel="0"]').click({delay:5});assert.equal((await point()).frame,frozen.frame);assert.equal((await point()).position,frozen.position);await page.locator('#spuLiveChannel').selectOption('synth');assert.deepEqual(await instrument(),captured);
    await page.locator('#saveSoundToFiles').click();await until(()=>page.locator('#spuFilesStatus').textContent().then(value=>value.includes('saved to /presets/')),'marker preset saved');
    const download=page.waitForEvent('download');await menu('#savePreset');const item=await download,saved=JSON.parse(await fs.readFile(await item.path(),'utf8'));
    assert.deepEqual(saved.sample.adpcm,authored.adpcm);assert.equal(saved.sample.loopStartSamples,84);assert.equal(saved.preset.pitch,authored.pitch);
    await page.locator('#presetFileInput').setInputFiles({name:'marker-roundtrip.spu.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
    await until(()=>page.locator('#audioStatus').textContent().then(value=>value===`Loaded ${saved.name}.`),'marker preset reload');
    const restored=await instrument();assert.deepEqual(Array.from(restored.sample.adpcm),authored.adpcm);assert.equal(restored.sample.loopStartSamples,84);assert.equal(restored.sample.baseFrequencyHz,captured.sample.baseFrequencyHz);
    const current=await read();assert.equal(current.samples.find(sample=>sample.id===current.channels[0].sample).loopStartSamples,84);
    await fs.mkdir(screenshots,{recursive:true});const screenshot=path.join(screenshots,name+'-capture-stale-repeat.png');await page.screenshot({path:screenshot,fullPage:true});
    const graph=await page.evaluate(()=>__pausedAuditionAudit.graph());assert(graph.muted);assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert.deepEqual(errors,[]);
    return{browser:name,passed:true,checks,oracle:{frame:authored.frame,startAddress:authored.startAddress,repeatAddress:authored.oracle.repeatAddress,markerAddress:authored.markerAddress,
      loopSource:authored.oracle.loopSource,resolvedLoopAddress:authored.oracle.resolvedLoopAddress,loopStartSamples:authored.oracle.loopStartSamples},temporaryPitch:temporary.active[0].pitch,
      sourceBytes:authored.adpcm.length,sourceSha256:hash(Buffer.from(authored.adpcm)),saveReloadLoopStartSamples:restored.sample.loopStartSamples,graph,screenshot};
  }catch(error){error.receipt={browser:name,checks,point:await point().catch(()=>null),preview:await preview().catch(()=>null),errors,status:await page.locator('#audioStatus').textContent().catch(()=>null)};throw error;}
  finally{await page.close();}
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
    frame:document.getElementById('spuVoicePanel').dataset.observationFrame,voice:document.getElementById('spuLiveChannel').value,nativeVoice:document.getElementById('spuCodeLiveTools').dataset.psfVoice,display:document.getElementById('spuCodeLiveTools').dataset.psfView,
    monitor:{...document.getElementById('psfPlaybackStatus').dataset},audition:{...document.getElementById('spuCodeLiveTools').dataset},status:document.getElementById('audioStatus').textContent,
    activity:{ready:document.getElementById('spuPsfChannelActivity').dataset.ready,
      channels:[...document.querySelectorAll('#spuPsfChannelActivity [data-psf-channel]')].map(button=>({channel:Number(button.dataset.psfChannel),
        active:button.dataset.active,lit:button.dataset.lit,gate:button.dataset.gate,env:button.dataset.env,available:button.dataset.available,selected:button.getAttribute('aria-pressed')}))}}));
  async function monitorSettled(voice){await until(async()=>{const value=(await view()).monitor;return value.monitorEnabled==='true'&&value.monitorSwitching==='false'&&value.monitorVoice===String(voice);},'paused selected dry mode '+voice);}
  async function menu(id){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();await page.locator(id).click();}
  async function paused(){await page.locator('#psfPauseSong').click({delay:5});await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Resume'),'PSF paused');}
  async function playPaused(){if(await page.locator('#psfPlaySong').isEnabled()){await page.locator('#psfPlaySong').click({delay:5});await until(async()=>await page.locator('#spuCodeLiveTools').getAttribute('data-live-kind')==='psf'&&await page.locator('#psfPauseSong').isEnabled(),'PSF owns its toolbar');}
    if(!await page.locator('#spuLiveEnabled').isChecked())await page.locator('#spuLiveEnabled').check();if(await page.locator('#spuLiveChannel').inputValue()==='synth')await page.locator('#spuLiveChannel').selectOption(await page.locator('#spuCodeLiveTools').getAttribute('data-psf-voice'));await until(async()=>Number((await view()).frame)>=2205,'audible PSF snapshot');
    if(await page.locator('#psfPauseSong').textContent()==='Pause')await paused();await until(()=>page.locator('#spuPsfCapture').isEnabled(),'paused ordinary channel');}
  async function assertPaused(before){const after=await view();assert(after.bar&&after.songBar,'PSF and CH controls stay visible');assert.equal(after.pause,'Resume');assert.equal(after.frame,before.frame);assert.equal(after.position,before.position);
    assert.equal(after.monitor.monitorEnabled,before.monitor.monitorEnabled,'temporary audition preserves selected-dry preference');assert.equal(after.activity.ready,'true');assert.deepEqual(after.activity.channels.map(({selected,...channel})=>channel),before.activity.channels.map(({selected,...channel})=>channel),'temporary keyboard output cannot change the frozen PSF activity');return after;}
  async function keyFor(note){const key=page.locator('#keyboardKeys .key').filter({hasText:new RegExp('\\b'+note+'\\b')}).first();assert(await key.count(),'keyboard has '+note);const letter=await key.getAttribute('data-key');assert(letter);return letter;}
  async function held(expectedBytes,expectedPitch){let value;await until(async()=>{value=await preview();return value?.active.length===1;},'temporary selected-channel key');
    assert.equal(value.active[0].pitch,expectedPitch);assert.deepEqual(value.active[0].adpcm,expectedBytes);
    await until(async()=>{const output=await page.evaluate(()=>__pausedAuditionAudit.output());return output.finite&&output.muted&&output.rms>.00001;},'upstream preview PCM behind physical gain zero');return value;
  }
  async function heldNoise(){let value;await until(async()=>{value=await preview();return value?.active.length===1;},'temporary Noise key');
    const voice=value.active[0];assert.equal(voice.pitch,4096);assert.deepEqual(value.noise,{enabled:true,clock:37});assert.equal(value.noiseClock,37);assert(value.noiseMask&(1<<voice.channel));assert.equal(value.pmonMask,0);
    await until(async()=>{const output=await page.evaluate(()=>__pausedAuditionAudit.output());return output.muted&&output.finite&&output.rms>.00001;},'actual temporary Noise output behind physical gain zero');return value;}
  async function keyboardOctave(target){const current=Number(await page.locator('#octaveValue').textContent());for(let value=current;value!==target;value+=target>current?1:-1)await page.locator(target>current?'#octaveUp':'#octaveDown').click();assert.equal(Number(await page.locator('#octaveValue').textContent()),target);}
  async function pointerNote(note,on){const key=page.locator('#keyboardKeys .key').filter({hasText:new RegExp('\\b'+note+'\\b')}).first();assert(await key.count(),'onscreen keyboard has '+note);await key.scrollIntoViewIfNeeded();const box=await key.boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);if(on)await page.mouse.down();else await page.mouse.up();}
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
    assert.equal(await page.locator('#spuPsfMonitorEnabled').isChecked(),false);
    await page.locator('#spuPsfMonitorEnabled').check();await monitorSettled(0);
    assert.equal(await page.locator('#spuPsfMonitorEnabled').evaluate(input=>input===document.activeElement),false,'selected dry checkbox releases focus before real keyboard audition');
    const frozen=await view(),sourceGraph=await graph();measurements.selectedDry=frozen.monitor;
    step('A genuine paused keyboard key plays selected CH1 without stopping or advancing the PSF');
    await page.keyboard.down(c4);measurements.ch1=await held(authored.a,authored.pitches[0]);await assertPaused(frozen);
    assert.deepEqual(await instrument(),original,'temporary preview never replaces the authored instrument');
    await page.keyboard.up(c4);await noPreviewKeys();await assertPaused(frozen);
    assert.equal((await graph()).bufferStarts,sourceGraph.bufferStarts,'preview schedules no new PSF source buffers');
    assert.equal((await graph()).bufferStops,sourceGraph.bufferStops,'preview does not stop any additional PSF source buffer');
    step('Selected dry mode and genuine CH/reference selection preserve preview bytes/PITCH while retaining the same frozen all-channel frame');
    await page.locator('#spuPsfChannelActivity [data-psf-channel="1"]').click({delay:5});
    assert.equal(await page.locator('#spuLiveChannel').inputValue(),'1');assert.equal((await view()).activity.channels[1].selected,'true');
    assert.equal(await page.locator('#spuPsfChannelActivity [data-psf-channel="1"]').evaluate(button=>button===document.activeElement),false);
    await monitorSettled(1);await page.keyboard.down(c4);measurements.ch2=await held(authored.b,authored.pitches[1]);
    const sameChannelStart=(await commands()).length;await page.locator('#spuPsfChannelActivity [data-psf-channel="1"]').click({delay:5});await held(authored.b,authored.pitches[1]);
    assert(!(await commands()).slice(sameChannelStart).some(command=>command.method==='stop'||command.method==='code'&&!['snapshot','getState','getPreset'].includes(command.args[1])),'selecting the held current channel does not retire or retrigger its preview');
    await assertPaused(frozen);await page.keyboard.up(c4);await noPreviewKeys();
    await page.locator('#spuPsfReferenceKey').selectOption('C5');await page.keyboard.down(c4);await held(authored.b,authored.pitches[1]/2);
    await page.keyboard.up(c4);await noPreviewKeys();await assertPaused(frozen);
    step('Rapid key-up and real Noise-only preview preserve Pause; Noise follows clock rather than keyboard pitch');
    await page.locator('#spuLiveChannel').selectOption('0');const commandStart=(await commands()).length;
    await preparationRace(async()=>{});await assertPaused(frozen);
    assert(!(await commands()).slice(commandStart).some(value=>value.method==='code'&&value.args[1]==='noteOn'),'released pending key never posts a late note-on');
    await page.locator('#spuPsfChannelActivity [data-psf-channel="2"]').click({delay:5});await monitorSettled(2);
    assert(await page.locator('#spuPsfCapture').isEnabled());assert(await page.locator('#spuPsfReferenceKey').isDisabled());
    assert.equal(await page.locator('#spuPsfChannelActivity [data-psf-channel="2"]').evaluate(button=>button===document.activeElement),false);
    measurements.noise=[];
    for(const [note,octave] of [['C2',-1],['C5',2]]){await keyboardOctave(octave);await pointerNote(note,true);measurements.noise.push(await heldNoise());await assertPaused(frozen);assert.deepEqual(await instrument(),original);await pointerNote(note,false);await noPreviewKeys();}
    await keyboardOctave(0);assert.deepEqual(await instrument(),original);
    await page.keyboard.down(c4);await heldNoise();await page.locator('#spuPsfChannelActivity [data-psf-channel="0"]').click({delay:5});await page.keyboard.up(c4);await noPreviewKeys();await assertPaused(frozen);
    assert(await page.locator('#spuPsfReferenceKey').isEnabled());
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
    await page.locator('#spuLiveChannel').selectOption('2');await preparationRace(async()=>{await page.locator('#psfPauseSong').click({delay:5});});
    await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Pause'),'resumed source');
    await until(async()=>Number((await view()).position)>Number(frozen.position),'resumed source consumes later PCM');
    assert((await graph()).bufferStarts>sourceGraph.bufferStarts);assert.deepEqual(await instrument(),original);await paused();
    await page.locator('#spuLiveChannel').selectOption('0');await preparationRace(async()=>{await page.locator('#psfEntry').selectOption('other-fixture.psf');});
    await until(()=>page.locator('#psfPlaySong').isEnabled(),'replacement source ready');assert.deepEqual(await instrument(),original);
    await page.locator('#psfEntry').selectOption('audition-fixture.psf');await playPaused();await page.locator('#spuLiveChannel').selectOption('1');
    await preparationRace(async()=>{await page.locator('#psfStopSong').click();});await until(()=>page.locator('#psfPlaySong').isEnabled(),'PSF stopped');
    assert.deepEqual(await instrument(),original);const restored=await read();assert.deepEqual(restored.samples,originalBank.samples);assert.equal(restored.nextAddress,originalBank.nextAddress);
    step('Resume cancels a Synth edit awaiting temporary preview restoration without writing or surfacing AbortError');
    await playPaused();await page.locator('#spuLiveChannel').selectOption('0');await page.keyboard.down(c4);await held(authored.a,authored.pitches[0]);const raceAuthor=await instrument(),racePosition=(await view()).position,raceCommands=(await commands()).length,restoreCount=await page.evaluate(()=>__pausedAuditionAudit.restoreDelays());await page.evaluate(()=>__pausedAuditionAudit.armRestoreDelay());await page.locator('#spuLiveChannel').selectOption('synth');await until(async()=>await page.evaluate(()=>__pausedAuditionAudit.restoreDelays())>restoreCount,'delayed preview checkpoint restoration');
    await page.locator('[data-spu-editor-tab="adsr"]').click();const pendingRelease=page.locator('[data-chip-control="ps1-release-rate"]');await pendingRelease.fill('12');await pendingRelease.dispatchEvent('change');await pendingRelease.blur();await page.locator('#psfPauseSong').click({delay:5});await page.keyboard.up(c4);await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Pause'),'Resume supersedes queued Synth edit');await until(async()=>Number((await view()).position)>Number(racePosition)+.02,'source continues after cancelled Synth edit');await noPreviewKeys();assert.deepEqual(await instrument(),raceAuthor);assert(!(await commands()).slice(raceCommands).some(command=>command.method==='setInstrumentEnvelope'),'cancelled edit never writes its queued release rate');assert.doesNotMatch((await view()).status,/Abort|superseded|cancelled|failed/i);await paused();
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
    await monitorSettled(1);assert(await page.locator('#spuPsfMonitorEnabled').isChecked());await page.keyboard.down(c4);await held(authored.b,authored.pitches[1]/2);const captureFrozen=await view(),captureGraph=await graph(),captureStart=(await commands()).length;
    await page.locator('#spuPsfCapture').click({delay:5});await until(()=>page.locator('#audioStatus').textContent().then(value=>value.startsWith('Captured CH 2')),'permanent Capture');await page.keyboard.up(c4);
    const afterCapture=await view();assert(afterCapture.bar&&afterCapture.songBar);assert.equal(afterCapture.pause,'Resume');assert.equal(afterCapture.position,captureFrozen.position);assert.equal(afterCapture.voice,'synth');assert.equal(afterCapture.nativeVoice,captureFrozen.nativeVoice);assert.equal(afterCapture.display,'synth');assert.equal(afterCapture.monitor.monitorEnabled,'true');assert.equal(await page.locator('#spuLiveEnabled').isChecked(),true);assert.equal(afterCapture.activity.ready,'true');assert(afterCapture.activity.channels.every(channel=>channel.selected==='false'));assert.deepEqual(afterCapture.activity.channels.map(({selected,...channel})=>channel),captureFrozen.activity.channels.map(({selected,...channel})=>channel));
    assert.equal((await graph()).bufferStarts,captureGraph.bufferStarts);assert.equal((await graph()).bufferStops,captureGraph.bufferStops);
    await page.locator(`#spuPsfChannelActivity [data-psf-channel="${captureFrozen.nativeVoice}"]`).click({delay:5});assert.equal((await view()).frame,captureFrozen.frame);assert.equal((await view()).voice,captureFrozen.nativeVoice);await page.locator('#spuLiveChannel').selectOption('synth');
    const captured=await instrument(),captureCommands=(await commands()).slice(captureStart),lookup=captureCommands.findIndex(value=>value.method==='findADPCM'),restore=captureCommands.findIndex(value=>value.method==='stop');
    assert(restore>=0&&lookup>restore,'temporary checkpoint restoration precedes authored sample/capacity lookup');
    assert.deepEqual(Array.from(captured.sample.adpcm),authored.b,'retained PSF source bytes survive all temporary preview writes');
    assert.equal(captured.preset.pitch,authored.pitches[1]);const referenceHz=440*2**((72-69)/12);
    assert(Math.abs(captured.sample.baseFrequencyHz-referenceHz*4096/authored.pitches[1])<1e-8);assert.deepEqual(captured.reverb,original.reverb);
    const capturedBank=await read();assert(capturedBank.nextAddress>=originalBank.nextAddress);assert.equal(capturedBank.auditions.length,0);
    step('Paused Synth edits survive an original CH trial and checkpoint restoration');
    await page.locator('[data-spu-editor-tab="fx"]').click();const returnLeft=page.locator('[data-chip-control="ps1-reverb-left"]');await returnLeft.fill('.41');await returnLeft.dispatchEvent('change');await returnLeft.blur();await until(async()=>(await instrument()).reverb.volumeLeft===.41,'paused captured reverb edit');
    await page.locator('[data-spu-editor-tab="adsr"]').click();const release=page.locator('[data-chip-control="ps1-release-rate"]');await release.fill('10');await release.dispatchEvent('change');await release.blur();await until(async()=>(await read()).channels.every(channel=>channel.envelopeParameters.releaseRate===10),'paused captured ADSR edit');
    const editedTrial=await instrument();assert.equal((await view()).position,captureFrozen.position);assert.equal((await view()).pause,'Resume');assert.equal((await view()).voice,'synth');
    await page.locator('#spuPsfChannelActivity [data-psf-channel="0"]').click({delay:5});assert.equal((await view()).frame,captureFrozen.frame);await page.keyboard.down(c4);const originalTrial=await held(authored.a,authored.pitches[0]/2);assert.equal(originalTrial.active[0].adsr2,0x1fc0,'original CH retains its source envelope');assert.deepEqual(await instrument(),editedTrial,'temporary original CH audition keeps the edited author checkpoint');await page.keyboard.up(c4);await noPreviewKeys();await page.locator('#spuLiveChannel').selectOption('synth');assert.deepEqual(await instrument(),editedTrial);assert.equal((await view()).position,captureFrozen.position);measurements.editedCheckpoint={releaseRate:10,reverbLeft:.41,originalTrialPitch:authored.pitches[0]/2};
    await page.keyboard.down(c4);await until(async()=>(await read()).auditions.length===1,'captured ordinary Synth key');
    const permanent=await read();assert.equal(permanent.channels[permanent.auditions[0].channel].pitch,authored.pitches[1]/2);
    await until(async()=>{const output=await page.evaluate(()=>__pausedAuditionAudit.output());return output.muted&&output.finite&&output.rms>.00001;},'permanent Capture output after temporary preview');
    await page.keyboard.up(c4);await page.locator('#allNotesOff').click();assert.equal((await view()).position,captureFrozen.position);
    const editedCapture=await instrument();assert.equal((await view()).voice,'synth');assert(await page.locator('#spuLiveEnabled').isChecked());await page.locator('#psfPauseSong').click({delay:5});await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Pause'),'captured source Resume');
    await until(async()=>Number((await view()).position)>Number(captureFrozen.position)+.02,'captured source retains and advances its old position');assert.deepEqual(await instrument(),editedCapture);measurements.captureResume={before:captureFrozen.position,after:(await view()).position,voice:(await view()).nativeVoice};assert.equal((await view()).voice,'synth');assert.equal((await view()).display,'synth');
    await paused();
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
module.exports={createPausedAuditionFixture:fixture,createStaleRepeatFixture,checkStaleRepeatCapture};
if(require.main===module)void main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
