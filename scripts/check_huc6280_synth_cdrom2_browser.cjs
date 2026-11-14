// SPDX-License-Identifier: BSD-3-Clause
// Actual standalone PC Engine CD-ROM² routes, with generated audio only.
// All speaker destinations are muted before any application JavaScript runs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',out:path.join(tmpdir(),'huc6280-synth-cdrom2-browser.json'),screenshots:path.join(tmpdir(),'huc6280-synth-cdrom2-images')};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await wait(25);}throw Error('Timeout: '+label);}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const write=(register,value)=>[0xb9,register,value],adpcm=(register,value)=>[0x32,(register<<4)|value];

function wav(seconds=8){
  const rate=44100,frames=Math.round(rate*seconds),bytes=Buffer.alloc(44+frames*4);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*4,40);
  for(let i=0;i<frames;i++){bytes.writeInt16LE(Math.round(3500*Math.sin(i*2*Math.PI*660/rate)),44+i*4);bytes.writeInt16LE(Math.round(3500*Math.sin(i*2*Math.PI*880/rate)),46+i*4);}return bytes;
}
async function makeFixture(){
  const {prepareMSM5205Sample}=await import(pathToFileURL(path.join(repo,'docs/js/msm5205_sample.js')).href);
  const rate=8000,seconds=5,pcm=Float32Array.from({length:rate*seconds},(_,i)=>.25*Math.sin(i*2*Math.PI*440/rate));
  const sample=await prepareMSM5205Sample({channels:[pcm],sampleRate:rate},{rate:12});
  const period=Math.round(3579545/(32*220)),sine=Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16)));
  const commands=[...write(1,255),...write(9,0),...write(0,0),...write(4,64),...write(4,0),...sine.flatMap(n=>write(6,n)),...write(2,period&255),...write(3,period>>8),...write(5,255),...write(4,150),...adpcm(0,1),...adpcm(0,0),...adpcm(4,0),...adpcm(5,1)];
  let samples=0;
  for(let i=0;i<pcm.length;i++){
    const nibble=i&1?sample.data[i>>1]&15:sample.data[i>>1]>>4,target=Math.round((i+1)*44100/rate),duration=target-samples;
    commands.push(...adpcm(1,nibble),0x70+duration-1);samples=target;
  }
  commands.push(0x66);
  const bytes=Buffer.alloc(256+commands.length);bytes.write('Vgm ');bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x172,8);bytes.writeUInt32LE(samples,0x18);bytes.writeUInt32LE(0xcc,0x34);bytes.writeUInt32LE(3579545,0xa4);bytes[0xd7]=4;bytes.writeUInt32LE(768000,0xf0);bytes.set(commands,256);
  const unsupported=Buffer.from(bytes);unsupported.writeUInt32LE(3579545,0x0c);
  return{bytes,unsupported,samples,encodedBytes:sample.data.length,period};
}

function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect;
  const contexts=[],worklets=[],meters=[],captureMutes=[],info=new WeakMap();let request=0,capture=null;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);const value={node:this,name,connected:false};worklets.push(value);info.set(this,value);}};
  AudioNode.prototype.connect=function(destination,...args){
    const value=info.get(this);if(value)value.connected=true;
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  AudioNode.prototype.disconnect=function(...args){const value=info.get(this);if(value)value.connected=false;return disconnect.apply(this,args);};
  const muted=()=>meters.every(x=>x.mute.gain.value===0)&&captureMutes.every(x=>x.gain.value===0);
  async function mediaState(name){
    const node=worklets.findLast(x=>x.name===name&&x.connected)?.node;if(!node)return null;const id=--request;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Media state timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,action:{type:'state'}});});
  }
  async function prepareCapture(){
    if(capture)return;
    const source=meters.findLast(x=>x.source.context.state==='running')?.source;if(!source)throw Error('Post-Master output missing');
    const name='huc-cdrom2-audit-'+Math.abs(--request),url=URL.createObjectURL(new Blob([`class Capture extends AudioWorkletProcessor{constructor(){super();this.p=null;this.port.onmessage=({data})=>{this.p={id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),at:0};};}process(inputs,outputs){for(const x of outputs[0])x.fill(0);const p=this.p;if(!p)return true;const n=Math.min(128,p.left.length-p.at),x=inputs[0];for(let i=0;i<n;i++){p.left[p.at+i]=x[0]?.[i]??0;p.right[p.at+i]=x[1]?.[i]??0;}p.at+=n;if(p.at===p.left.length){this.p=null;this.port.postMessage(p,[p.left.buffer,p.right.buffer]);}return true;}}registerProcessor('${name}',Capture);`],{type:'text/javascript'}));
    try{await source.context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    const node=new AudioWorkletNode(source.context,name,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]}),mute=source.context.createGain();mute.gain.value=0;captureMutes.push(mute);
    connect.call(source,node);connect.call(node,mute);connect.call(mute,source.context.destination);let pending=null;
    node.port.onmessage=({data})=>{if(pending?.id===data.id){const item=pending;pending=null;clearTimeout(item.timer);item.resolve(data);}};
    capture={take(frames){return new Promise((resolve,reject)=>{if(pending)throw Error('Concurrent capture');const id=--request,timer=setTimeout(()=>{pending=null;reject(Error('CD-ROM² capture timed out'));},8000);pending={id,resolve,reject,timer};node.port.postMessage({id,frames});});}};
  }
  async function take(){
    await prepareCapture();const data=await capture.take(12288),left=data.left.subarray(2048),right=data.right.subarray(2048);let peak=0,energy=0;
    for(let i=0;i<left.length;i++){if(!Number.isFinite(left[i])||!Number.isFinite(right[i]))throw Error('Nonfinite post-Master PCM');peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));energy+=left[i]*left[i]+right[i]*right[i];}
    const amplitude=(channel,hz)=>{let s=0,c=0;for(let i=0;i<channel.length;i++){const phase=i*2*Math.PI*hz/data.rate;s+=channel[i]*Math.sin(phase);c+=channel[i]*Math.cos(phase);}return 2*Math.hypot(s,c)/channel.length;};
    // Worklet sample rate is the owning AudioContext clock.
    data.rate=meters.findLast(x=>x.source.context.state==='running').source.context.sampleRate;
    return{sampleRate:data.rate,frames:left.length,peak,rms:Math.sqrt(energy/left.length/2),left:[220,440,660,880].map(hz=>amplitude(left,hz)),right:[220,440,660,880].map(hz=>amplitude(right,hz)),muted:muted()};
  }
  window.__hucCdAudit={mediaState,take,graph:()=>({contexts:contexts.length,runningContexts:contexts.filter(x=>x.state==='running').length,destinationConnections:meters.length,muted:muted(),worklets:worklets.filter(x=>!x.name.startsWith('huc-cdrom2-audit')).map(({name,connected})=>({name,connected}))})};
}

const graph=page=>page.evaluate(()=>__hucCdAudit.graph());
// Runtime guards return Proxy capabilities. Copy only primitive status fields
// in the page instead of asking Playwright to serialize those proxies.
const media=page=>page.evaluate(async()=>{const a=await __pceCdProbe.a.getState(),c=await __pceCdProbe.c.getState();return{adpcm:{state:a.state},cdda:{state:c.state,track:c.track,positionFrames:c.positionFrames}};});
const state=page=>page.evaluate(()=>{const d=document.querySelector('#hucSongPlayer').dataset;return{...d,phase:d.state,frame:Number(d.positionFrames)};});
async function tab(page,name){await page.locator(`[data-huc-chip-tab="${name}"]`).click();assert.equal(await page.locator(`[data-huc-chip-tab="${name}"]`).getAttribute('aria-selected'),'true');assert(await page.locator(`[data-huc-chip-panel="${name}"]`).isVisible());}
async function files(page){if(await page.locator('#hucFilesPanel').isHidden())await page.locator('#hucFilesToggle').click();await until(()=>page.locator('#hucFileImportButton').isEnabled(),'Files ready');}
async function selectFile(page,filename,{code=false}={}){
  await files(page);for(let i=0;i<16;i++){const closed=page.locator('#hucFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#hucFilesTree [data-file-path]').locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).first().click();
  await until(()=>page.locator('#hucFilesSelected').textContent().then(x=>x===filename),'selected '+filename);if(code)await page.locator('#synthInputCodeTab').click();
}
async function source(page,text){await selectFile(page,'/index.js',{code:true});await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function run(page){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return page.evaluate(()=>Boolean(globalThis.__pceCdProbe?.ready));},'all three Code sources ready');}
async function stop(page){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(x=>/Stopped|Idle/.test(x)),'Code Stop');await wait(150);const pcm=await page.evaluate(()=>__hucCdAudit.take());assert(pcm.muted);assert.equal(pcm.peak,0,'Stop clears all three source outputs');return pcm;}
async function mix(page,only='all',volume=.4){
  await tab(page,'mixer');
  for(const id of ['huc6280','msm5205','cdda']){const row=page.locator(`[data-cdrom2-source="${id}"]`),slider=row.locator('[data-mixer-volume]'),button=row.locator('[data-mixer-mute]');
    if(volume!==null)await slider.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},volume);
    const muted=only!=='all'&&only!==id;if((await button.getAttribute('aria-pressed')==='true')!==muted)await button.click();assert.equal(await button.getAttribute('aria-pressed'),String(muted));
  }await wait(150);
}
async function capture(page){const pcm=await page.evaluate(()=>__hucCdAudit.take());assert(pcm.muted&&pcm.peak<1&&pcm.rms>=0);return pcm;}
function positive(pcm,index,right=false){assert((right?pcm.right:pcm.left)[index]>.001,'actual source frequency '+index+' '+JSON.stringify(pcm));}
function absent(pcm,all,index,right=false){const side=right?'right':'left';assert(pcm[side][index]<all[side][index]*.16+.00015,'muted sibling frequency '+index+' '+JSON.stringify(pcm));}
async function phase(page,value){await until(()=>state(page).then(x=>x.phase===value),'song '+value);}
async function seekPaused(page,seconds){if((await state(page)).phase==='playing'){await page.locator('#hucSongPlayButton').click();await phase(page,'paused');}
  await page.locator('#hucSongSeek').evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},seconds);
  await until(()=>state(page).then(x=>x.phase==='paused'&&x.frame===Math.round(seconds*44100)&&x.seeking==='false'&&x.seekPreparing==='false'),'paused Seek '+seconds);
}
const CODE=`const h=await useSoundChip('huc6280');
const a=await useSoundChip('msm5205');
const c=await useSoundChip('cdda');
await h.initialize();await h.setWaveform(0,Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16))));await h.setVolume(0,22);await h.setPan(0,15,15);await h.noteOn(0,'A3');
await a.loadSample({sampleRate:8000,channels:[Float32Array.from({length:8000},(_,i)=>.25*Math.sin(i*2*Math.PI*440/8000))]},{rate:12});await a.play({loop:true});
await c.load('/cdrom2-track.wav');await c.play();
const motion=await livePrepare('cdrom2-browser',()=>({ticks:0}));
const setGain=gain=>liveFx('cdrom2-gain',{context:{gain},process(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;}});
globalThis.__pceCdProbe={h,a,c,motion,setGain,ready:true};
liveLoop('cdrom2-clock',async()=>{motion.ticks++;await sleep(.1);});
`;
const APPLY=`const saved=globalThis.__pceCdProbe;
const h=await useSoundChip('huc6280'),a=await useSoundChip('msm5205'),c=await useSoundChip('cdda');
const motion=await livePrepare('cdrom2-browser',()=>({ticks:0}));
// Each Apply receives new execution-scoped proxies around the retained clients.
if(h.id!==saved.h.id||a.id!==saved.a.id||c.id!==saved.c.id||motion!==saved.motion)throw Error('Apply recreated a source or prepared context');
saved.applied=true;
liveLoop('cdrom2-clock',async()=>{motion.ticks++;await sleep(.1);});
`;
async function check(browser,name,origin,fixture,track){
  const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block'}),checks=[],measurements={},errors=[],consoleErrors=[];let stage='startup';
  page.setDefaultTimeout(25000);await page.addInitScript(installSilentAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  const step=text=>{stage=text;checks.push(text);console.log(`CHECK ${name}: ${text}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Four compact tabs are passive; MSM sample controls and the CD-DA construction page keep Code reachable');
    assert.deepEqual(await page.locator('[data-huc-chip-tab]').allTextContents().then(x=>x.map(v=>v.trim())),['HuC6280','MSM5205','CD-DA','Mixer']);
    for(const id of ['msm5205','cdda']){await tab(page,id);if(id==='cdda')assert.match(await page.locator(`[data-huc-chip-panel="${id}"]`).textContent(),/under construction|work in progress|工事中/i);else assert(await page.locator('#msm5205Controls').isVisible());await page.locator('#synthTitle').click();await page.keyboard.press('a');assert.equal((await graph(page)).contexts,0);}
    const selectedBefore=await page.locator('#hucFilesSelected').textContent(),modeBefore=await page.locator('#synthInputSection').getAttribute('data-input-mode');
    await page.locator('[data-huc-chip-panel="cdda"] [data-add-cdrom2-examples]').click();
    for(const filename of ['/examples/msm5205.js','/examples/cdda.js'])await until(()=>page.locator(`#hucFilesTree [data-file-path="${filename}"]`).count().then(Boolean),'passive Code example '+filename);
    assert.equal(await page.locator('#hucFilesSelected').textContent(),selectedBefore);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),modeBefore);assert.equal((await graph(page)).contexts,0);
    await tab(page,'mixer');assert.equal(await page.locator('[data-cdrom2-source]').count(),3);assert.equal((await graph(page)).contexts,0);
    for(const[id,value]of [['huc6280',.44],['msm5205',1],['cdda',1]])assert.equal(Number(await page.locator(`[data-cdrom2-source="${id}"] [data-mixer-volume]`).inputValue()),value,'standard source balance '+id);

    step('Code renders HuC6280, decoded MSM5205 and stereo CD-DA through one context and one final Master destination');
    await page.locator('#hucFilesInput').setInputFiles({name:'cdrom2-track.wav',mimeType:'audio/wav',buffer:track});
    await until(()=>page.locator('#hucFilesTree [data-file-path="/cdrom2-track.wav"]').count().then(Boolean),'WAV in Files');
    await source(page,CODE);await tab(page,'msm5205');await run(page);await mix(page,'all');measurements.all=await capture(page);
    positive(measurements.all,0);positive(measurements.all,1);positive(measurements.all,2);positive(measurements.all,3,true);
    assert.equal((await graph(page)).contexts,1);assert.equal((await graph(page)).destinationConnections,1);assert((await graph(page)).muted);
    await page.evaluate(()=>__pceCdProbe.setGain(.5));await wait(100);measurements.halfFx=await capture(page);
    for(const[index,right]of [[0,false],[1,false],[2,false],[3,true]]){const side=right?'right':'left',ratio=measurements.halfFx[side][index]/measurements.all[side][index];assert(ratio>.35&&ratio<.65,'shared liveFx processes every source: '+side+'/'+index+' '+ratio);}
    await page.evaluate(()=>__pceCdProbe.setGain(1));await wait(100);
    const status=await media(page);assert.equal(status.adpcm.state,'playing');assert.equal(status.cdda.state,'playing');assert.equal(status.cdda.track,1);
    await source(page,APPLY);await page.locator('#synthCodeApplyButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return page.evaluate(()=>Boolean(__pceCdProbe.applied));},'Apply keeps the same three source clients');
    assert((await media(page)).cdda.positionFrames>status.cdda.positionFrames,'Apply keeps the running CD-DA cursor');

    step('Mixer isolates each source and produces silence with all three muted without changing Master or stopping Code');
    const master=await page.locator('#masterVolume').inputValue();measurements.isolated={};
    for(const[id,index]of [['huc6280',0],['msm5205',1],['cdda',2]]){
      await mix(page,id);const pcm=measurements.isolated[id]=await capture(page);positive(pcm,index);if(id==='cdda')positive(pcm,3,true);
      for(const sibling of [0,1,2])if(sibling!==index)absent(pcm,measurements.all,sibling);
      if(id!=='cdda')absent(pcm,measurements.all,3,true);
    }
    await mix(page,'none');assert.equal((await capture(page)).peak,0);assert.equal(await page.locator('#masterVolume').inputValue(),master);assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    await mix(page,'cdda');await page.evaluate(async()=>{await __pceCdProbe.c.pause();});await wait(80);assert.equal((await capture(page)).peak,0);const frozen=(await media(page)).cdda;await wait(80);assert.equal((await media(page)).cdda.positionFrames,frozen.positionFrames);
    await page.evaluate(async()=>{await __pceCdProbe.c.seek(.25);await __pceCdProbe.c.resume();});positive(await capture(page),2);

    step('Stop fences old media clients, rerun has no duplicate routes, and Files loading/type descriptions remain reusable');
    await stop(page);assert.equal(await page.evaluate(async()=>{try{await __pceCdProbe.a.play({loop:true});return'allowed';}catch(error){return error.name;}}),'AbortError');
    await page.evaluate(()=>{__pceCdProbe.ready=false;});await source(page,CODE);await run(page);await mix(page,'all');positive(await capture(page),1);const route=await graph(page);assert.equal(route.contexts,1);assert.equal(route.destinationConnections,1);assert.equal(route.worklets.filter(x=>x.name==='tetorica-msm5205'&&x.connected).length,1);assert.equal(route.worklets.filter(x=>x.name==='tetorica-cdda'&&x.connected).length,1);await stop(page);
    const types=await page.evaluate(async()=>{const base=document.querySelector('script[type="module"]').src,decl=await import(new URL('./code_declarations.js',base)),source=await fetch(new URL('../playground/tetorica-playground-globals.d.ts',base)).then(r=>r.text());return decl.selectHuc6280CodeDeclarations(source);});assert.match(types,/msm5205\s*:/);assert.match(types,/cdda\s*:/);assert.match(types,/loadSample/);assert.match(types,/loadMemory/);assert.match(types,/seek/);

    step('VGM1.72 mixes HuC6280 and MSM5205, Pause retains position and Seek safely rebuilds without a false paired checkpoint');
    await tab(page,'huc6280');await page.locator('#vgmFileInput').setInputFiles({name:'cdrom2-reference.vgm',mimeType:'application/octet-stream',buffer:fixture.bytes});
    await until(()=>page.locator('#hucSongSelect option[value="/vgm/cdrom2-reference.vgm"]').count().then(Boolean),'mixed VGM in Files');await page.locator('#hucSongSelect').selectOption('/vgm/cdrom2-reference.vgm');await mix(page,'all');await page.locator('#hucSongPlayButton').click();await phase(page,'playing');await until(()=>state(page).then(x=>x.frame>4410),'heard mixed VGM');measurements.vgm=await capture(page);positive(measurements.vgm,0);positive(measurements.vgm,1);
    await page.locator('#hucSongPlayButton').click();await phase(page,'paused');const paused=(await state(page)).frame;await wait(120);assert.equal((await state(page)).frame,paused);assert.equal((await capture(page)).peak,0);
    await seekPaused(page,.75);assert.equal((await state(page)).cacheCount,'0');assert.match(await page.locator('#hucSongCacheStatus').textContent(),/state|checkpoint|rebuild|snapshot/i);await page.locator('#hucSongPlayButton').click();await phase(page,'playing');await wait(150);positive(await capture(page),1);
    await mix(page,'msm5205');measurements.vgmAdpcm=await capture(page);positive(measurements.vgmAdpcm,1);absent(measurements.vgmAdpcm,measurements.vgm,0);await mix(page,'huc6280');measurements.vgmHuc=await capture(page);positive(measurements.vgmHuc,0);absent(measurements.vgmHuc,measurements.vgm,1);await page.locator('#hucSongStopButton').click();await phase(page,'stopped');

    step('Unsupported VGM chips keep the accepted source; VGM does not silently launch an unrelated CD-DA track');
    const accepted=await page.locator('#hucSongSelect').inputValue();await page.locator('#vgmFileInput').setInputFiles({name:'unsupported-cdrom2.vgm',mimeType:'application/octet-stream',buffer:fixture.unsupported});await until(()=>page.locator('#vgmStatus').textContent().then(x=>/Unsupported|unsupported/.test(x)),'unsupported declaration explained');assert.equal(await page.locator('#hucSongSelect').inputValue(),accepted);assert.equal((await state(page)).phase,'stopped');assert.notEqual((await page.evaluate(()=>__hucCdAudit.mediaState('tetorica-cdda')))?.state,'playing');

    step('All four tabs and their construction/Mixer pages remain reachable at1240 and390 without changing playback');
    for(const width of [1240,390]){
      await page.setViewportSize({width,height:1050});for(const id of ['huc6280','msm5205','cdda','mixer'])await tab(page,id);
      await page.locator('[data-huc-chip-tab="mixer"]').focus();await page.keyboard.press('Home');assert.equal(await page.locator('[data-huc-chip-tab="huc6280"]').getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await page.locator('[data-huc-chip-tab="mixer"]').getAttribute('aria-selected'),'true');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});
      await tab(page,'msm5205');await page.screenshot({path:path.join(config.screenshots,name+'-msm5205-'+width+'.png'),fullPage:true});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);measurements.graph=await graph(page);return{browser:name,passed:true,checks,measurements,pageErrors:errors,consoleErrors};
  }catch(error){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic:{stage,codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),status:await page.locator('#audioStatus').textContent().catch(()=>''),song:await state(page).catch(()=>null)},pageErrors:errors,consoleErrors};throw error;}
  finally{await page.close();}
}

async function main(){
  for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
  config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));const engines=config.engines.split(',');assert(engines.length&&engines.every(x=>['chromium','webkit'].includes(x)));
  const fixture=await makeFixture(),track=wav(),server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};if(served.has(key))assert.deepEqual(served.get(key),metadata,'Served file changed');served.set(key,metadata);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit}[name]).launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}: {})});try{results.push(await check(browser,name,origin,fixture,track));}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);}
  catch(error){failure=error;if(error.receipt)results.push(error.receipt);}
  finally{await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),fixture:{vgmBytes:fixture.bytes.length,vgmSha256:hash(fixture.bytes),vgmSamples:fixture.samples,encodedBytes:fixture.encodedBytes,wavBytes:track.length,wavSha256:hash(track)},results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}: {})};
  await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log(JSON.stringify({passed:true,runs:results.length,checks:results.reduce((n,x)=>n+x.checks.length,0),out:config.out}));
}
module.exports={makeFixture,wav};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
