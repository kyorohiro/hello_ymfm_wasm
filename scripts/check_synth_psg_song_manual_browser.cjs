// FM2612 Synth: a VGM and a person write to the same reference Sega PSG.
// Self-authored fixtures only. Every destination is intercepted before app JS
// at gain zero; Chromium is additionally launched with --mute-audio.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),config={root:path.join(repository,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'fm2612-synth-psg-song-manual-browser.json'),screenshots:path.join(tmpdir(),'fm2612-synth-psg-song-manual-browser')};
for(const argument of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);assert(match,'Unknown argument '+argument);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const CLOCK=7670454,PSG_CLOCK=3579545,RATE=53267,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(25);}throw Error('Timeout: '+label);}
const ready=page=>page.waitForFunction(()=>document.querySelector('.synth-editor')?.getAttribute('aria-busy')==='false');

function installSilentAudit(){
  const connect=AudioNode.prototype.connect,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,post=MessagePort.prototype.postMessage;
  const contexts=[],worklets=[],meters=[],commands=[];
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);worklets.push(name);}};
  MessagePort.prototype.postMessage=function(data,...args){for(const command of Array.isArray(data)?data:[data])if(command?.type==='write'||command?.method==='write')commands.push({port:command.port,register:command.register,value:command.value,method:command.method,args:command.args});if(commands.length>10000)commands.splice(0,commands.length-10000);return post.call(this,data,...args);};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  window.__psgManualOutput={drain:()=>commands.splice(0),graph:()=>({contexts:contexts.length,worklets:worklets.slice(),destinations:meters.length,muted:meters.every(item=>item.mute.gain.value===0)}),
    read(){return meters.map(({source,analyser,mute})=>{const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);let sum=0,squares=0,peak=0;
      for(const value of pcm){sum+=value;squares+=value*value;peak=Math.max(peak,Math.abs(value));}const mean=sum/pcm.length;
      return{sampleRate:source.context.sampleRate,state:source.context.state,muted:mute.gain.value===0,finite:pcm.every(Number.isFinite),peak,mean,acRms:Math.sqrt(Math.max(0,squares/pcm.length-mean*mean))};}).sort((a,b)=>b.acRms-a.acRms);}};
}

// Observe the very class imported by the application, before it constructs a
// reference engine. This adds no renderer and consumes no extra native frames.
async function installReferenceAudit(page){await page.evaluate(async()=>{
  const url=performance.getEntriesByType('resource').map(item=>item.name).find(name=>/\/genesisaudioengine\.js(?:\?|$)/.test(name));
  if(!url)throw Error('GenesisAudioEngine module missing');
  const {GenesisAudioEngine}=await import(url),prototype=GenesisAudioEngine.prototype,records=[],entries=new WeakMap();let next=0;
  function entry(engine){let item=entries.get(engine);if(!item){item={id:++next,closed:false,resets:0,frames:0,processCalls:0,finite:true,
    psg:{latched:0,periods:[0,0,0],attenuations:[15,15,15,15],noiseMode:0,noiseWrites:0},writes:[],fmWrites:[],pcm:[]};entries.set(engine,item);records.push(item);}return item;}
  function decode(state,byte){if(byte&128)state.latched=(byte>>4)&7;const channel=state.latched>>1;
    if(state.latched&1)state.attenuations[channel]=byte&15;
    else if(channel===3){state.noiseMode=byte&7;state.noiseWrites++;}
    else if(byte&128)state.periods[channel]=(state.periods[channel]&1008)|(byte&15);
    else state.periods[channel]=(state.periods[channel]&15)|((byte&63)<<4);
  }
  const psg=prototype.writePsg,fm=prototype.writeYm2612,reset=prototype.reset,process=prototype.processFrames,dispose=prototype.dispose;
  prototype.writePsg=function(value){const item=entry(this),result=psg.call(this,value);decode(item.psg,value);item.writes.push({frame:item.frames,value});if(item.writes.length>20000)item.writes.shift();return result;};
  prototype.writeYm2612=function(port,register,value){const item=entry(this),result=fm.call(this,port,register,value);item.fmWrites.push({frame:item.frames,port,register,value});if(item.fmWrites.length>20000)item.fmWrites.shift();return result;};
  prototype.reset=function(...args){const item=entry(this),result=reset.apply(this,args);item.resets++;item.frames=0;item.psg={latched:0,periods:[0,0,0],attenuations:[15,15,15,15],noiseMode:0,noiseWrites:0};item.pcm=[];return result;};
  prototype.processFrames=function(frames){const item=entry(this),pcm=process.call(this,frames);item.frames+=frames;item.processCalls++;
    for(const channel of [pcm.left,pcm.right])for(const value of channel)if(!Number.isFinite(value))item.finite=false;
    for(const value of pcm.left)item.pcm.push(value);if(item.pcm.length>8192)item.pcm.splice(0,item.pcm.length-8192);return pcm;};
  prototype.dispose=function(...args){entry(this).closed=true;return dispose.apply(this,args);};
  function snapshot(item){if(!item)return null;const {pcm,...value}=item;let sum=0,squares=0,peak=0;for(const sample of pcm){sum+=sample;squares+=sample*sample;peak=Math.max(peak,Math.abs(sample));}const mean=pcm.length?sum/pcm.length:0;
    return structuredClone({...value,signal:{frames:pcm.length,mean,peak,acRms:pcm.length?Math.sqrt(Math.max(0,squares/pcm.length-mean*mean)):0}});}
  window.__psgManualReference={read:()=>records.map(snapshot),current:()=>snapshot(records.findLast(item=>!item.closed))};
});}
const reference=page=>page.evaluate(()=>__psgManualReference.current());
const view=page=>page.evaluate(()=>{const root=document.getElementById('synthSongPlayer');return{state:root.dataset.state,frame:Number(root.dataset.consumedFrames),
  manualReady:root.dataset.manualReady,psgManualReady:root.dataset.psgManualReady,target:document.getElementById('synthSongChannelSelect').value,live:document.getElementById('synthSongLiveToggle').checked,
  status:document.getElementById('synthSongLiveStatus').textContent,inputMode:document.getElementById('synthInputSection').dataset.inputMode,code:document.getElementById('synthCodeState').textContent};});
const readOutput=page=>page.evaluate(()=>__psgManualOutput.read());
async function pcm(page,audible=true){let readings;await until(async()=>{readings=await readOutput(page);return readings.every(value=>value.muted&&value.finite)&&(audible?readings.some(value=>value.acRms>.0001):readings.every(value=>value.acRms<1e-7));},audible?'actual muted PCM':'actual output silence');return readings[0];}
const channel=(page,value)=>page.locator('#synthSongChannelSelect').selectOption(String(value));
async function change(node,direction,count=1){await node.scrollIntoViewIfNeeded();await node.locator('..').locator('.param-button').nth(direction>0?1:0).evaluate((button,count)=>{for(let i=0;i<count;i++)button.click();},count);}
async function range(page,selector,value){await page.locator(selector).first().evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function keyboard(page){await page.locator('#synthInputKeyboardTab').click();await until(()=>view(page).then(value=>value.inputMode==='keyboard'),'Keyboard mode');}
async function pressed(page,key,value){await until(()=>page.locator(`#keyboard .key[data-key="${key}"]`).evaluate((node,value)=>node.classList.contains('is-active')===value,value),`Keyboard ${key} ${value}`);}
async function seek(page,seconds,state='playing'){await page.locator('#synthSongSeek').evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},seconds);
  await until(()=>view(page).then(value=>value.state===state&&value.frame/RATE>=seconds-.002&&value.frame/RATE<seconds+.6),'seek '+seconds);}
async function chooseFile(page,file){if(!await page.locator('#synthFilesPanel').isVisible())await page.locator('#synthFilesToggle').click();
  for(let i=0;i<16;i++){const closed=page.locator('#synthFilesTree details:not([open]) > summary[data-file-path]');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#synthFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(file)}]`).click();await ready(page);}
async function storedFiles(page){return page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
    const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('current');get.onerror=()=>{db.close();reject(get.error);};
    get.onsuccess=async()=>{const files=get.result.project.files;db.close();try{resolve((await Promise.all(files.map(async file=>{
      const bytes=typeof file.data==='string'?new TextEncoder().encode(file.data):file.data,digest=await crypto.subtle.digest('SHA-256',bytes);
      return{path:file.path,bytes:bytes.length,sha256:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')};
    }))).sort((a,b)=>a.path.localeCompare(b.path)));}catch(error){reject(error);}};
  };
}));}
async function code(page,source){await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(source);}
async function runCode(page){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},'Code running');}

// Keep the source latch across waits deliberately. A hand volume/noise write
// must not redirect the following source data byte into its own register.
function fixture({other=false}={}){
  const c=[],write=value=>c.push(0x50,value),tone=(ch,period)=>{write(0x80|(ch<<5)|(period&15));write(period>>4);},
    volume=(ch,value)=>write(0x90|(ch<<5)|value),waitSeconds=seconds=>{let n=Math.round(seconds*44100);while(n){const take=Math.min(n,65535);c.push(0x61,take&255,take>>8);n-=take;}};
  [other?190:254,381,509].forEach((period,ch)=>{tone(ch,period);volume(ch,[6,8,9][ch]);});write(0xe7);volume(3,15);
  waitSeconds(2);write(0x86);waitSeconds(1);write(0x19);
  waitSeconds(1);write(0xe4);waitSeconds(1);write(7);
  waitSeconds(1);write(0x96);waitSeconds(2);write(4);
  waitSeconds(1);tone(2,354);volume(2,9);write(0xe7);volume(3,6);
  waitSeconds(3);tone(2,420);waitSeconds(18);c.push(0x66);
  const bytes=Buffer.alloc(256+c.length),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  bytes.write('Vgm ');v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x0c,PSG_CLOCK,true);
  v.setUint32(0x18,30*44100,true);v.setUint32(0x34,204,true);bytes.set(c,256);return bytes;
}
function fmFixture(){
  const c=[],write=(register,value)=>c.push(0x52,register,value);write(0xb0,7);write(0xb4,0xc0);
  for(const [operator,slot]of[0,8,4,12].entries())for(const [register,value]of[[0x30,1],[0x40,operator===3?48:127],[0x50,31],[0x60,0],[0x70,0],[0x80,15]])write(register+slot,value);
  write(0xa4,0x22);write(0xa0,0x40);write(0x28,0x80);
  let remaining=30*44100;while(remaining){const frames=Math.min(remaining,65535);c.push(0x61,frames&255,frames>>8);remaining-=frames;}c.push(0x66);
  const bytes=Buffer.alloc(256+c.length),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);bytes.write('Vgm ');
  v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x2c,CLOCK,true);v.setUint32(0x18,30*44100,true);v.setUint32(0x34,204,true);bytes.set(c,256);return bytes;
}
const attenuation=page=>page.locator('#synthPsgAttenuation');
const period=page=>page.locator('#synthPsgPeriod');
const noiseType=(page,value)=>page.locator(`[data-psg-noise-type="${value}"]`);
const noiseRate=(page,value)=>page.locator(`[data-psg-noise-rate="${value}"]`);
const selected=node=>node.getAttribute('aria-pressed').then(value=>value==='true');
const locked=node=>node.evaluate(value=>Boolean(value.disabled||value.closest('[inert]')));
async function cacheState(page){return page.locator('#synthSongPlayer').evaluate(node=>({count:Number(node.dataset.cacheCount),restoredFrame:Number(node.dataset.lastSeekCacheFrame),enabled:node.dataset.cacheEnabled}));}

async function check(browser,name,origin,presetBytes,fmPresetBytes){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await ready(page);await installReferenceAudit(page);
    step('A PSG-only VGM imports passively and manual Tone controls share its actual reference engine');
    await page.locator('#tfiFile').setInputFiles([
      {name:'PSG manual reference.vgm',mimeType:'application/octet-stream',buffer:fixture()},
      {name:'PSG other reference.vgm',mimeType:'application/octet-stream',buffer:fixture({other:true})},
      {name:'YM only reference.vgm',mimeType:'application/octet-stream',buffer:fmFixture()},
      {name:'PSG manual preset.psg.json',mimeType:'application/json',buffer:presetBytes},
      {name:'Cross FM preset.tfi',mimeType:'application/octet-stream',buffer:fmPresetBytes}]);await ready(page);
    assert.equal((await page.evaluate(()=>__psgManualOutput.graph())).contexts,0);assert.equal((await page.evaluate(()=>__psgManualReference.read())).length,0);
    await wait(650);const originalFiles=await storedFiles(page),presetPath=originalFiles.find(file=>file.path.endsWith('/PSG manual preset.psg.json'))?.path,
      fmPresetPath=originalFiles.find(file=>file.path.endsWith('/Cross FM preset.tfi'))?.path;
    assert(presetPath&&fmPresetPath,'The imported PSG JSON and FM TFI remain available through Files');
    await page.locator('#synthChipTabPsg').click();await page.locator('#synthSongSelect').selectOption('/vgm/PSG manual reference.vgm');await channel(page,'psg:0');await keyboard(page);await page.locator('#synthSongPlayButton').click();
    await until(()=>view(page).then(value=>value.state==='playing'&&value.psgManualReady==='true'&&value.frame>RATE*.1),'PSG reference playback');
    await until(()=>attenuation(page).textContent().then(value=>value==='6'),'selected Tone1 level');
    assert.equal(await page.locator('#keyboard').getAttribute('aria-disabled'),'false');assert.equal(await page.locator('#keyboard').getAttribute('data-song-audition'),'live');
    assert(await locked(page.locator('[data-psg-source="noise"]')),'Physical tone/noise channel type stays fixed');
    assert(await locked(page.locator('#synthPsgEnvelopeEnabled')),'VGM hand control is hardware-only, not an added ADSR');
    await range(page,'#masterVolumeRange',100);await wait(250);measurements.initial=await pcm(page);
    const initial=await reference(page),identity={id:initial.id,resets:initial.resets};measurements.native=initial.signal;
    measurements.renderAheadSeconds=(initial.frames-(await view(page)).frame)/RATE;assert(measurements.renderAheadSeconds>=0&&measurements.renderAheadSeconds<.11);
    assert(Math.abs(measurements.initial.acRms/initial.signal.acRms-1)<.15,'Calibrated native PSG gain reaches the browser unchanged');
    assert(measurements.initial.peak<=initial.signal.peak*1.15+.0001,'No new browser-output peak');
    await range(page,'#masterVolumeRange',50);await wait(250);measurements.half=await pcm(page);assert(Math.abs(measurements.half.acRms/measurements.initial.acRms-.5)<.07);await range(page,'#masterVolumeRange',100);
    await change(attenuation(page),-1,3);await until(()=>attenuation(page).textContent().then(value=>value==='3'),'rapid attenuation retains latest value');await wait(90);
    let native=await reference(page);assert.equal(native.psg.attenuations[0],3);assert.equal(native.id,identity.id);assert.equal(native.resets,identity.resets);assert.equal((await view(page)).state,'playing');
    // Switching the visual editor happens before its remembered channel is
    // installed. A previous FM CH6 must never be validated as PSG channel 5.
    await page.locator('#synthChipTabYm2612').click();await channel(page,5);await page.locator('#synthChipTabPsg').click();await channel(page,'psg:0');
    assert.equal((await view(page)).state,'playing');assert.equal((await reference(page)).id,identity.id);assert.deepEqual(errors,[],'FM CH6 to PSG transition does not address a nonexistent PSG channel');

    step('Manual writes preserve later source tone data and editable periods reach the selected physical CH');
    await seek(page,2.15);await until(()=>attenuation(page).textContent().then(value=>value==='6'),'source level after seek');
    await change(attenuation(page),1);await until(()=>reference(page).then(value=>value.psg.attenuations[0]===7),'manual volume between source tone bytes');
    await until(()=>view(page).then(value=>value.frame>3.12*RATE),'source high-data byte');native=await reference(page);assert.equal(native.psg.periods[0],406);assert.equal(native.psg.attenuations[0],7);
    await until(()=>period(page).textContent().then(value=>value==='406'),'tone period display');await change(period(page),1);
    await until(()=>reference(page).then(value=>value.psg.periods[0]===407),'manual period reaches Tone1');assert.equal(await period(page).textContent(),'407');

    step('Live Off keeps observation frozen while sparse Noise edits preserve the latest source clock');
    await channel(page,'psg:3');await seek(page,4.15);await page.locator('#synthSongLiveToggle').uncheck();
    assert(await selected(noiseRate(page,'low')));await change(attenuation(page),-1);
    await until(()=>reference(page).then(value=>value.psg.attenuations[3]===14),'manual Noise volume between source noise bytes');
    const noiseWritesBefore=(await reference(page)).psg.noiseWrites;
    await until(()=>view(page).then(value=>value.frame>5.12*RATE),'source unlatched noise data');native=await reference(page);assert.equal(native.psg.noiseMode,7);assert.equal(native.psg.attenuations[3],14,'Source noise data does not become volume data');assert.equal(native.psg.noiseWrites,noiseWritesBefore+1,'No extra LFSR reset to restore the source latch');
    assert(await selected(noiseRate(page,'low')),'Noise observation remains frozen');await noiseType(page,'periodic').click();
    await until(()=>reference(page).then(value=>value.psg.noiseMode===3),'manual type preserves current Tone3 clock');
    assert(await selected(noiseRate(page,'low')));assert(await selected(noiseType(page,'periodic')));await page.locator('#synthSongLiveToggle').check();
    await until(()=>selected(noiseRate(page,'tone3')),'Live catches up to Tone3 dependency');

    step('Later source volume data defeats old keyboard key-up and Pitch cleanup without a layered PSG');
    await channel(page,'psg:0');await seek(page,7);await keyboard(page);await page.evaluate(()=>__psgManualOutput.drain());const before=await reference(page);
    await page.keyboard.down('a');await pressed(page,'a',true);await until(()=>reference(page).then(value=>value.writes.length>before.writes.length),'manual key writes reference PSG');
    native=await reference(page);assert.equal(native.id,before.id);assert.equal(native.resets,before.resets);assert.equal(native.psg.attenuations[0],6);
    assert(!(await page.evaluate(()=>__psgManualOutput.drain())).some(value=>value.method==='write'),'No layered author PSG worklet writes');
    await range(page,'[data-pitch-bend-wheel]',500);await until(()=>view(page).then(value=>value.frame>8.12*RATE),'source volume reclaims Tone1');
    native=await reference(page);assert.equal(native.psg.attenuations[0],4);const takeoverWrites=native.writes.length;
    await page.keyboard.up('a');await range(page,'[data-pitch-bend-wheel]',0);await wait(100);native=await reference(page);assert.equal(native.psg.attenuations[0],4);
    assert(!native.writes.slice(takeoverWrites).some(value=>(value.value&0xf0)===0x90&&(value.value&15)===15),'Old key-up cannot mute a new source level');

    step('Tone3-clock Noise follows hand pitch without muting Tone3, and later Tone3 pitch defeats stale wheel reset');
    await channel(page,'psg:3');await seek(page,10.8);await keyboard(page);native=await reference(page);assert.equal(native.psg.noiseMode,7);assert.equal(native.psg.attenuations[2],9);
    await page.keyboard.down('s');await pressed(page,'s',true);const heldNoise=await reference(page);assert.equal(heldNoise.psg.attenuations[3],6);assert.equal(heldNoise.psg.attenuations[2],9);
    await range(page,'[data-pitch-bend-wheel]',750);await wait(100);native=await reference(page);assert.notEqual(native.psg.periods[2],heldNoise.psg.periods[2]);assert.equal(native.psg.attenuations[2],9);
    await until(()=>view(page).then(value=>value.frame>12.12*RATE),'VGM Tone3 clock changes');assert.equal((await reference(page)).psg.periods[2],420);
    await range(page,'[data-pitch-bend-wheel]',0);await wait(80);assert.equal((await reference(page)).psg.periods[2],420,'Stale bend cleanup preserves the newer Tone3 period');
    await page.keyboard.up('s');await wait(90);native=await reference(page);assert.equal(native.psg.attenuations[3],15);assert.equal(native.psg.attenuations[2],9);
    await wait(650);assert.deepEqual(await storedFiles(page),originalFiles,'Temporary song edits never rewrite author presets or original VGM files');

    step('Pause audition remains independent; Copy and Seek retain the frozen sound and source-only cache');
    await channel(page,'psg:1');await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(value=>value.state==='paused'),'Pause');
    await until(()=>page.locator('#keyboard').getAttribute('data-song-audition').then(value=>value==='ready'),'Independent paused PSG audition');
    const paused=await reference(page),pausedFrame=(await view(page)).frame;await keyboard(page);await page.keyboard.down('a');await pressed(page,'a',true);await pcm(page);await page.keyboard.up('a');
    assert.equal((await reference(page)).writes.length,paused.writes.length);assert.equal((await view(page)).frame,pausedFrame);
    await page.locator('#synthSongCopyButton').click();await ready(page);assert.equal((await view(page)).state,'paused');assert.equal((await view(page)).target,'synth');
    await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(value=>value.state==='playing'),'Resume');await channel(page,'psg:0');await seek(page,1);
    await until(()=>reference(page).then(value=>value.psg.attenuations[0]===6&&value.psg.periods[0]===254),'Seek restores original PSG registers');measurements.cache=await cacheState(page);

    step('Loading an author PSG preset and round-robin keyboard keep the original reference transport');
    await channel(page,'synth');const loadNative=await reference(page),loadFrame=(await view(page)).frame;await chooseFile(page,presetPath);
    await until(()=>reference(page).then(value=>value.psg.attenuations.slice(0,3).every(level=>level===11)),'author Tone preset reaches all three source tone channels');
    assert.equal((await view(page)).state,'playing');assert((await view(page)).frame>loadFrame);assert.equal((await reference(page)).id,loadNative.id);assert.equal((await reference(page)).resets,loadNative.resets);
    await keyboard(page);await page.keyboard.down('a');await pressed(page,'a',true);await page.keyboard.down('s');await pressed(page,'s',true);await page.keyboard.down('d');await pressed(page,'d',true);
    native=await reference(page);assert(native.psg.attenuations.slice(0,3).every(level=>level===11));await page.keyboard.up('a');await page.keyboard.up('s');await page.keyboard.up('d');

    step('Cross-kind author presets stay visible and playable while an unrelated reference chip keeps running');
    const psgBefore=await reference(page),psgFrame=(await view(page)).frame;await chooseFile(page,fmPresetPath);
    await until(()=>page.locator('#synthChipTabYm2612').getAttribute('aria-selected').then(value=>value==='true'),'FM preset opens author FM editor');
    assert.equal((await view(page)).target,'synth');assert.equal((await view(page)).state,'playing');assert((await view(page)).frame>psgFrame);assert.equal((await reference(page)).id,psgBefore.id);
    assert.equal(await page.locator('#presetSelect').inputValue(),'vfs:'+fmPresetPath);await keyboard(page);await page.evaluate(()=>__psgManualOutput.drain());await page.keyboard.down('a');await pressed(page,'a',true);await page.keyboard.up('a');
    assert((await page.evaluate(()=>__psgManualOutput.drain())).some(value=>value.register===0x28&&(value.value&0xf0)),'Cross-kind keyboard addresses the author FM worklet');
    await page.locator('#synthSongSelect').selectOption('/vgm/YM only reference.vgm');await channel(page,0);await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(value=>value.state==='playing'&&value.manualReady==='true'),'YM-only reference starts');
    const fmBefore=await reference(page),fmFrame=(await view(page)).frame;await chooseFile(page,presetPath);
    await until(()=>page.locator('#synthChipTabPsg').getAttribute('aria-selected').then(value=>value==='true'),'PSG preset opens author PSG editor');
    assert.equal((await view(page)).target,'synth');assert.equal((await view(page)).state,'playing');assert((await view(page)).frame>fmFrame);assert.equal((await reference(page)).id,fmBefore.id);
    assert.equal(await page.locator('#synthPsgPresetSelect').inputValue(),'vfs:'+presetPath);await keyboard(page);await page.evaluate(()=>__psgManualOutput.drain());await page.keyboard.down('a');await pressed(page,'a',true);await page.keyboard.up('a');
    assert((await page.evaluate(()=>__psgManualOutput.drain())).some(value=>value.method==='write'),'Cross-kind keyboard addresses the author PSG worklet');

    step('Code and VGM remain exclusive while manual PSG edits and Keyboard view preserve running Code');
    await code(page,`const psg=await useSoundChip('segapsg');globalThis.__psgManualCode={ticks:0};psg.tone(0,{period:254,attenuation:6});liveLoop('clock',async()=>{__psgManualCode.ticks++;await sleep(.05);});`);await runCode(page);
    await until(()=>view(page).then(value=>value.state==='stopped'),'Code retires VGM');const codeSound=await pcm(page),ticks=await page.evaluate(()=>__psgManualCode.ticks);await keyboard(page);await change(attenuation(page),1);await wait(150);
    assert(await page.evaluate(()=>__psgManualCode.ticks)>ticks);const quieter=await pcm(page);assert(quieter.acRms<codeSound.acRms,'Upper attenuation changes the Code-owned PSG');
    await page.locator('#synthSongSelect').selectOption('/vgm/PSG other reference.vgm');await channel(page,'psg:0');await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(value=>value.state==='playing'),'VGM retires Code');
    assert.match(await page.locator('#synthCodeState').textContent(),/Stopped/i);const stoppedTicks=await page.evaluate(()=>__psgManualCode.ticks);await wait(150);assert.equal(await page.evaluate(()=>__psgManualCode.ticks),stoppedTicks);
    await keyboard(page);await page.keyboard.down('a');await pressed(page,'a',true);await page.locator('#synthSongStopButton').click();await until(()=>view(page).then(value=>value.state==='stopped'),'Stop');await page.keyboard.up('a');await pcm(page,false);
    assert.equal(await page.locator('#synthPsgEnvelopeEnabled').isDisabled(),false,'Stopping VGM restores author Software Envelope controls');
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#synthSongPlayer').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-${width}.png`)});}
    const finalFiles=new Map((await storedFiles(page)).map(file=>[file.path,file]));for(const file of originalFiles.filter(file=>file.path.startsWith('/vgm/')))assert.deepEqual(finalFiles.get(file.path),file);
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert((await page.evaluate(()=>__psgManualOutput.graph())).muted);
    return{browser:name,passed:true,checks,measurements,graph:await page.evaluate(()=>__psgManualOutput.graph()),references:await page.evaluate(()=>__psgManualReference.read().map(({writes,fmWrites,...item})=>({...item,writeCount:writes.length,fmWriteCount:fmWrites.length}))),errors,consoleErrors};
  }catch(error){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-failure.png`)}).catch(()=>{});
    error.receipt={browser:name,passed:false,stage,error:error.stack,checks,measurements,diagnostic:{view:await view(page).catch(()=>null),references:await page.evaluate(()=>__psgManualReference?.read()).catch(()=>null),output:await readOutput(page).catch(()=>null)},errors,consoleErrors};throw error;
  }finally{await page.close();}
}

const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),meta,'Asset changed during browser check');served.set(key,meta);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createPsgPreset}=await import(pathToFileURL(path.join(repository,'docs/synth/synth_psg_preset.js')).href),presetBytes=Buffer.from(JSON.stringify(createPsgPreset({source:'tone',attenuation:11,envelope:{enabled:false}})));
  const {createTfiFromPreset}=await import(pathToFileURL(path.join(repository,'docs/js/tfi.js')).href),fmPreset={algorithm:7,feedback:0,operators:{}};
  for(let operator=1;operator<=4;operator++)fmPreset.operators[operator]={multi:1,dt:0,tl:operator===4?36:127,rs:0,ar:31,d1r:0,d2r:0,sl:0,rr:15,ssg:0};const fmPresetBytes=Buffer.from(createTfiFromPreset(fmPreset));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,presetBytes,fmPresetBytes));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});

