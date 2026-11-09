// Exercise reference-song seeking and bounded in-memory checkpoints through the published UI.
// Self-authored music only. Every speaker edge is metered and physically muted.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');

const repository=path.resolve(__dirname,'..');
const config={root:path.join(repository,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:'/private/tmp/fm2612-synth-song-seek-browser.json',screenshots:null};
for(const argument of process.argv.slice(2)) {
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);
  assert(match,'Unknown option '+argument);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/'));
const engines=config.engines.split(',');assert(engines.every(name=>['chromium','webkit'].includes(name)));
const CLOCK=7670454,RATE=53267,DURATION=24.37,PSG_CLOCK=3579545;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(task,label,ms=25000) {
  let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out: '+label)),ms);})]);}
  finally{clearTimeout(timer);}
}
const evaluate=(page,callback,arg)=>bounded(page.evaluate(callback,arg),'page evaluation');
const write=(commands,register,value,port=0)=>commands.push(port?0x53:0x52,register,value);
function wait(commands,seconds) {
  let frames=Math.round(seconds*44100);
  while(frames){const count=Math.min(frames,65535);commands.push(0x61,count&255,count>>8);frames-=count;}
}
function vgm(commands,seconds) {
  const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  bytes.set([86,103,109,32]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x0c,PSG_CLOCK,true);view.setUint32(0x34,204,true);view.setUint32(0x18,Math.round(seconds*44100),true);view.setUint32(0x2c,CLOCK,true);
  bytes.set(commands,256);return bytes;
}
function installAudit() {
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const meters=[],writes=[];
  window.AudioContext=new Proxy(Context,{construct(Target,args){return Reflect.construct(Target,args);}});
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  MessagePort.prototype.postMessage=function(message,...args) {
    for(const command of Array.isArray(message)?message:[message])if(command?.type==='write')writes.push({time:performance.now(),port:command.port,register:command.register,value:command.value});
    if(writes.length>10000)writes.splice(0,writes.length-10000);
    return post.call(this,message,...args);
  };
  AudioNode.prototype.connect=function(destination,...args) {
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);
    meters.push({context:this.context,analyser,mute,bases:new Map()});return destination;
  };
  window.__recordAudit={drainWrites(){return writes.splice(0);},read(targets=[]){return meters.map(({context,analyser,mute,bases})=>{
    const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);
    let mean=0;for(const value of pcm)mean+=value;mean/=pcm.length;
    let squares=0,peak=0;for(const value of pcm){squares+=(value-mean)**2;peak=Math.max(peak,Math.abs(value));}
    const tones={};
    for(const hz of targets) {
      const key=String(hz);if(!bases.has(key)) {
        const hann=Float32Array.from(pcm,(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(pcm.length-1)));
        bases.set(key,{cosine:Float32Array.from(hann,(w,i)=>w*Math.cos(2*Math.PI*hz*i/context.sampleRate)),
          sine:Float32Array.from(hann,(w,i)=>w*Math.sin(2*Math.PI*hz*i/context.sampleRate)),weight:hann.reduce((a,b)=>a+b,0)});
      }
      const {cosine,sine,weight}=bases.get(key);let re=0,im=0;
      for(let i=0;i<pcm.length;i++){re+=(pcm[i]-mean)*cosine[i];im+=(pcm[i]-mean)*sine[i];}
      tones[key]=2*Math.hypot(re,im)/weight;
    }
    return {muted:mute.gain.value===0,finite:pcm.every(Number.isFinite),acRms:Math.sqrt(squares/pcm.length),peak,tones};
  });}};
}
const audit=(page,targets=[])=>evaluate(page,targets=>__recordAudit.read(targets),targets);
const drainWrites=page=>evaluate(page,()=>__recordAudit.drainWrites());
const transport=page=>evaluate(page,()=>{
  const root=document.getElementById('synthSongPlayer'),seek=document.getElementById('synthSongSeek'),data=root.dataset;
  return {state:document.getElementById('synthSongStatus').dataset.state,frame:Number(data.consumedFrames),
    target:document.getElementById('synthSongChannelSelect').value,source:document.getElementById('synthSongSelect').value,
    status:document.getElementById('status').textContent,time:document.getElementById('synthSongTime').textContent,
    seek:{value:Number(seek.value),max:Number(seek.max),disabled:seek.disabled},
    cache:{enabled:data.cacheEnabled,supported:data.cacheSupported,count:Number(data.cacheCount),bytes:Number(data.cacheBytes),
      maxCount:Number(data.cacheMaxCount),maxBytes:Number(data.cacheMaxBytes),lastRestoreFrame:Number(data.lastSeekCacheFrame)}};
});
const ui=page=>evaluate(page,()=>({path:document.getElementById('synthActiveFilePath').textContent,preset:document.getElementById('presetSelect').value,
  common:[...document.querySelectorAll('#commonControls .param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent]),
  operators:[...document.querySelectorAll('#operatorControls .operator-row')].map(row=>[...row.querySelectorAll('.param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent])),
  special:[...document.querySelectorAll('#channel3SpecialControls .param-value')].map(node=>[node.getAttribute('aria-label'),node.textContent])}));
async function until(page,predicate,label,ms=20000) {
  const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await pause(30);}
  throw new Error(label+'; '+JSON.stringify({transport:await transport(page).catch(()=>null),audit:await audit(page).catch(()=>null)}));
}
const ready=page=>page.waitForFunction(()=>!document.getElementById('importPresetButton').disabled);
const state=(page,value)=>until(page,async()=>(await transport(page)).state===value,'Expected reference '+value);
const keyState=(page,key,pressed)=>until(page,()=>evaluate(page,({key,pressed})=>document.querySelector(`#keyboard .key[data-key="${key}"]`).classList.contains('is-active')===pressed,{key,pressed}),`Keyboard ${key} ${pressed}`);
async function silence(page) {await pause(240);await until(page,async()=>(await audit(page)).every(meter=>meter.acRms<1e-7),'No remaining audible signal');}
async function toneLevel(page,hz) {return Math.max(0,...(await audit(page,[hz])).map(meter=>meter.tones[String(hz)]));}
async function sounding(page,hz) {await until(page,async()=>(await toneLevel(page,hz))>.0002,'Actual '+hz+' Hz signal');}
async function keyboardHz(page,key='a') {
  const label=await page.locator(`#keyboard .key[data-key="${key}"] small`).textContent(),match=/b(\d+)\s*\/\s*f(\d+)/.exec(label);
  assert(match,'Keyboard publishes raw BLOCK/FNUM');return Number(match[2])*CLOCK*2**(Number(match[1])-1)/(144*2**20);
}
async function files(page) {return evaluate(page,()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get('current');get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=async()=>{
    const entries=get.result.project.files;db.close();
    try {resolve(await Promise.all(entries.map(async file=>{
      const bytes=typeof file.data==='string'?new TextEncoder().encode(file.data):file.data,digest=await crypto.subtle.digest('SHA-256',bytes);
      return {path:file.path,bytes:bytes.byteLength,...(file.path.endsWith('.synth.json')?{extra:JSON.parse(typeof file.data==='string'?file.data:new TextDecoder().decode(bytes))}:{}),sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};
    })));}catch(error){reject(error);}
  };};
}));}

function program(commands,channel,hz,{feedback=0,mask=8,tl=42}={}) {
  const offset=channel%3,port=channel>=3?1:0;
  let block=4,rawFnum=hz*144*2**20/(CLOCK*2**(block-1));
  while(rawFnum>2047&&block<7){rawFnum/=2;block++;}
  const fnum=Math.round(rawFnum);assert(fnum>=0&&fnum<=2047,'Fixture uses a valid hardware frequency');
  write(commands,0xb0+offset,7|(feedback<<3),port);write(commands,0xb4+offset,0xc0,port);
  for(const slot of [0,8,4,12]){
    for(const [base,value]of[[0x30,1],[0x40,tl],[0x50,31],[0x60,0],[0x70,0],[0x80,15],[0x90,0]])write(commands,base+slot+offset,value,port);
  }
  write(commands,0x28,channel%3|(channel>=3?4:0));
  write(commands,0xa4+offset,(block<<3)|(fnum>>8),port);write(commands,0xa0+offset,fnum&255,port);
  write(commands,0x28,(mask<<4)|(channel%3)|(channel>=3?4:0));
  return fnum*CLOCK*2**(block-1)/(144*2**20);
}
function seekSong() {
  const commands=[],sections=[];
  write(commands,0x22,0);write(commands,0x27,0);write(commands,0x2b,0);
  const backgroundHz=program(commands,1,1685,{tl:55});
  const period=Math.round(PSG_CLOCK/(32*177));commands.push(0x50,0x80|(period&15),0x50,period>>4,0x50,0x9c);
  // Avoid harmonic-related destinations: the native YM2612 DAC produces a
  // measurable third harmonic, which is legitimate330Hz sound, not stale990Hz.
  for(const [index,hz]of[330,733,1171].entries()){
    const feedback=index*2,mask=[8,4,1][index],tl=42+index*4;
    const actualHz=program(commands,0,hz,{feedback,mask,tl});sections.push({start:index*6,hz:actualHz,feedback,mask,tl});
    wait(commands,index<2?6:DURATION-12);
  }
  commands.push(0x66);return {bytes:vgm(commands,DURATION),sections,
    suppressed:[{id:'muted backgroundFM',hz:backgroundHz},{id:'PSG group volume0',hz:PSG_CLOCK/(32*period)}]};
}
function otherSong() {
  const commands=[];write(commands,0x22,0);write(commands,0x27,0);write(commands,0x2b,0);
  const hz=program(commands,0,1450,{tl:46});wait(commands,8.5);commands.push(0x66);
  return {bytes:vgm(commands,8.5),hz};
}
async function openMix(page) {
  const button=page.locator('#synthSongMixButton');await button.scrollIntoViewIfNeeded();
  await evaluate(page,()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await pause(60);
  if(!await page.locator('#synthSongMixPanel').isVisible())await button.click();
  await page.locator('#synthSongMixPanel').waitFor({state:'visible'});
}
async function setRange(page,selector,value,event='input') {
  await page.locator(selector).evaluate((node,{value,event})=>{node.value=String(value);node.dispatchEvent(new Event(event,{bubbles:true}));},{value,event});
}
async function seek(page,seconds,expected='playing') {
  await setRange(page,'#synthSongSeek',seconds);await setRange(page,'#synthSongSeek',seconds,'change');
  await until(page,async()=>{
    const value=await transport(page);return value.state===expected&&Math.abs(value.frame/RATE-seconds)<(expected==='playing'?1:.002);
  },'Seek reaches '+seconds+'s as '+expected,30000);
}
async function sectionSound(page,section,sections,suppressed=[]) {
  let levels;const frequencies=[...sections,...suppressed].map(tone=>tone.hz);
  try {
    await until(page,async()=>{
      const readings=await audit(page,frequencies);
      levels=frequencies.map(hz=>Math.max(0,...readings.map(meter=>meter.tones[String(hz)])));
      const target=levels[sections.indexOf(section)];
      return target>.00015&&levels.slice(0,sections.length).every((value,index)=>index===sections.indexOf(section)||value<target*.12)
        &&levels.slice(sections.length).every(value=>value<target*.02+1e-6);
    },'Actual PCM belongs to '+section.start+'s section, drains old audio and preserves background Mute/PSG volume0',6000);
  } catch(error) {
    throw new Error(`Seek PCM section=${section.start}s targetHz=${section.hz}, frequencies=${JSON.stringify(frequencies)}, levels=${JSON.stringify(levels)}; ${error.message}`);
  }
  assert.equal(await page.locator('#commonControls .param-value[aria-label="FB"]').textContent(),String(section.feedback),'Live feedback comes from destination');
  const mask=await evaluate(page,()=>[...document.querySelectorAll('[data-operator-gate]')].reduce((mask,node)=>mask|(node.getAttribute('aria-pressed')==='true'?1<<(Number(node.dataset.operatorGate)-1):0),0));
  assert.equal(mask,section.mask,'Live operator mask comes from destination');
  return {sectionHz:section.hz,sectionLevels:levels.slice(0,sections.length),
    suppressed:suppressed.map((tone,index)=>({...tone,level:levels[sections.length+index]}))};
}
async function mixSettings(page) {
  return evaluate(page,()=>({master:document.getElementById('masterVolumeRange').value,
    volumes:Object.fromEntries([...document.querySelectorAll('[data-song-group-volume]')].map(node=>[node.dataset.songGroupVolume,node.value])),
    muted:[...document.querySelectorAll('[data-song-mute][aria-pressed="true"]')].map(node=>node.dataset.songMute)}));
}
async function cacheBounded(page,{nonempty=false}={}) {
  const cache=(await transport(page)).cache;
  assert(Number.isFinite(cache.count)&&Number.isFinite(cache.bytes),'Cache diagnostics are available');
  assert(cache.count>=0&&cache.count<=cache.maxCount&&cache.bytes>=0&&cache.bytes<=cache.maxBytes,'In-memory checkpoint counts and bytes stay within configured bounds');
  if(nonempty)assert(cache.count>0&&cache.bytes>0,'Forward reconstruction populated in-memory checkpoints');
  return cache;
}
async function cacheOff(page) {
  await openMix(page);await page.locator('#synthSongSeekCacheToggle').uncheck();
  await until(page,async()=>{const cache=(await transport(page)).cache;return cache.enabled==='false'&&cache.count===0&&cache.bytes===0;},'Cache Off releases checkpoint memory');
}
async function checkKeyboardSeek(page,seconds,key,nextSeconds) {
  await seek(page,seconds,'paused');await page.locator('#synthSongSeek').focus();await page.keyboard.press(key);
  await until(page,async()=>{const value=await transport(page);return value.state==='paused'&&Math.abs(value.frame/RATE-nextSeconds)<.002;},key+' commits its seek target');
  await silence(page);
}

const served=new Map(),missing=[],external=[],mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(request,response)=>{try{
  const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
  const name=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(name.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(name),key=path.relative(config.root,name).split(path.sep).join('/'),info={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(served.has(key))assert.deepEqual(served.get(key),info,'Asset changed during validation');served.set(key,info);
  response.setHeader('Content-Type',mime[path.extname(name)]??'application/octet-stream');response.end(bytes);
}catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}});
async function checkBrowser(browser,name,origin) {
  const fixture=seekSong(),other=otherSong(),page=await browser.newPage({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1240,height:1100}}),errors=[],steps=[];
  page.setDefaultTimeout(25000);page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installAudit);
  try {
    await page.goto(origin+config.entry);await ready(page);
    await page.locator('#tfiFile').setInputFiles([{name:'Seek.vgm',mimeType:'application/octet-stream',buffer:fixture.bytes},
      {name:'Other.vgm',mimeType:'application/octet-stream',buffer:other.bytes}]);await ready(page);
    await page.locator('#synthSongSelect').selectOption('/vgm/Seek.vgm');await page.locator('#synthSongChannelSelect').selectOption('0');
    await until(page,async()=>{const value=await transport(page);return !value.seek.disabled&&Math.abs(value.seek.max-DURATION)<1e-6;},'Metadata enables exact-duration seek before Play');
    const metadata=await transport(page);assert.equal(metadata.state,'stopped');assert(metadata.time.includes('0:00')&&metadata.time.includes('0:24'),'Time shows current and total duration');
    assert.equal(metadata.cache.count,0,'Metadata inspection creates no checkpoints');assert.equal(metadata.cache.bytes,0);
    if(await page.locator('#synthFilesPanel').isVisible())await page.locator('#synthFilesToggle').click();
    await openMix(page);assert.equal(await page.locator('#synthSongSeekCacheToggle').isChecked(),true,'In-memory seek cache defaults On');
    steps.push('duration and cache options are available from metadata before audio starts; no checkpoint memory is allocated');
    // Group faders are populated by the prepared playback engine. The cache
    // preference above remains available independently before preparation.
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await openMix(page);
    await setRange(page,'[data-song-group-volume="ym2612"]',50);await setRange(page,'[data-song-group-volume="psg"]',0);
    await page.locator('[data-song-mute="ym2612:1"]').click();await setRange(page,'#masterVolumeRange',60);
    const retainedMix=await mixSettings(page);await pause(650);const originalFiles=await files(page),originalUi=await ui(page);
    const first=await sectionSound(page,fixture.sections[0],fixture.sections,fixture.suppressed);
    const beforeDraft=await transport(page);await setRange(page,'#synthSongSeek',13.2);await pause(100);
    const draft=await transport(page);assert.equal(draft.state,'playing');assert(draft.frame/RATE<beforeDraft.frame/RATE+1,'Dragging input previews a destination without moving the running song');
    await sectionSound(page,fixture.sections[0],fixture.sections,fixture.suppressed);await setRange(page,'#synthSongSeek',13.2,'change');
    await until(page,async()=>{const value=await transport(page);return value.state==='playing'&&value.frame/RATE>=13.2&&value.frame/RATE<14.5;},'Forward commit reaches the new section',30000);
    const forward=await sectionSound(page,fixture.sections[2],fixture.sections,fixture.suppressed),warm=await cacheBounded(page,{nonempty:true});
    await seek(page,7.2);const backward=await sectionSound(page,fixture.sections[1],fixture.sections,fixture.suppressed),restored=await cacheBounded(page,{nonempty:true});
    assert(restored.lastRestoreFrame>0,'A backward seek restores an earlier checkpoint rather than always replaying from0');
    assert.deepEqual(await mixSettings(page),retainedMix,'Seeking keeps source volumes, channel Mute and Master');
    steps.push('playing forward/backward seeks replace queued PCM and synchronize destination Live controls; a warm checkpoint is actually restored');

    await cacheOff(page);await seek(page,13.2);await sectionSound(page,fixture.sections[2],fixture.sections,fixture.suppressed);
    assert.equal((await cacheBounded(page)).count,0,'Disabled cache remains empty during a cold seek');
    await openMix(page);await page.locator('#synthSongSeekCacheToggle').check();await seek(page,7.2);await sectionSound(page,fixture.sections[1],fixture.sections,fixture.suppressed);
    await cacheBounded(page,{nonempty:true});
    await page.locator('#synthSongPlayButton').click();await state(page,'paused');await silence(page);
    await seek(page,2.1,'paused');await silence(page);
    assert.equal(await page.locator('#commonControls .param-value[aria-label="FB"]').textContent(),'0','Paused seek updates destination settings without sounding');
    await checkKeyboardSeek(page,2.1,'ArrowRight',3.1);await checkKeyboardSeek(page,3.1,'Shift+ArrowRight',13.1);
    await checkKeyboardSeek(page,13.1,'Home',0);await checkKeyboardSeek(page,0,'End',DURATION);
    await seek(page,7.2,'paused');await silence(page);assert.deepEqual(await mixSettings(page),retainedMix);
    await pause(650);assert.deepEqual(await files(page),originalFiles,'Seeking and cache settings never rewrite source or editable tone files');
    steps.push('cache Off clears RAM and stops capture, On rebuilds it; paused seeks and navigation keys stay silent, reach exact fractionalEOF and preserve all files');

    // Copy at the paused destination is the one explicit file-creating action.
    await until(page,async()=>!await page.locator('#synthSongCopyButton').isDisabled(),'Paused destination can be copied');
    await page.locator('#synthSongCopyButton').click();await ready(page);await until(page,async()=>(await transport(page)).target==='synth','Copy chooses the editable Synth');
    const copied=await ui(page);assert.notEqual(copied.path,originalUi.path);assert.equal(copied.common.find(([label])=>label==='FB')[1],'2');
    await pause(650);const copiedFiles=await files(page),byPath=new Map(copiedFiles.map(file=>[file.path,file]));
    for(const file of originalFiles)assert.deepEqual(byPath.get(file.path),file,'Copy preserves original '+file.path);
    assert.equal(byPath.get(copied.path+'.synth.json')?.extra.capturedVoice.keyMask,4,'Copy uses the selected destination OP mask');
    const pausedFrame=(await transport(page)).frame,hz=await keyboardHz(page);await page.locator('#synthSongSeek').focus();await drainWrites(page);await page.keyboard.down('a');
    await keyState(page,'a',true);await sounding(page,hz);assert((await drainWrites(page)).some(write=>write.register===0x28&&(write.value>>4)===4),'Destination copy auditions its partial OP mask with seek slider focused');
    await page.keyboard.up('a');await silence(page);assert.equal((await transport(page)).frame,pausedFrame,'Musical letter keys do not commit or advance a seek');
    await page.locator('#synthSongChannelSelect').selectOption('0');
    steps.push('Copy uses the paused destination patch and OP mask; letter-key audition still works with the seek range focused');

    await page.locator('#synthSongStopButton').click();await state(page,'stopped');await seek(page,9,'paused');await silence(page);
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await sectionSound(page,fixture.sections[1],fixture.sections,fixture.suppressed);
    assert((await transport(page)).frame/RATE>=9,'Resume after a stopped seek starts at the selected time');
    assert.deepEqual(await mixSettings(page),retainedMix);
    await seek(page,DURATION,'ended');await silence(page);
    assert(Math.abs((await transport(page)).frame/RATE-DURATION)<.002,'Playing seek reaches actual fractional EOF');
    await page.locator('#synthSongPlayButton').click();await state(page,'playing');await sectionSound(page,fixture.sections[0],fixture.sections,fixture.suppressed);
    assert((await transport(page)).frame/RATE<2,'Play after EOF restarts from the beginning');
    await page.locator('#synthSongStopButton').click();await state(page,'stopped');
    // Commit/Stop in the same UI turn tests cancellation before reconstruction
    // completes, rather than stopping only after a successful seek.
    await evaluate(page,()=>{const seek=document.getElementById('synthSongSeek');seek.value='13.2';seek.dispatchEvent(new Event('input',{bubbles:true}));seek.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('synthSongStopButton').click();});
    await state(page,'stopped');await pause(550);await silence(page);assert.equal((await transport(page)).frame,0,'Stop cancels the pending seek without late position/audio');
    await evaluate(page,()=>{const seek=document.getElementById('synthSongSeek');seek.value='13.2';seek.dispatchEvent(new Event('input',{bubbles:true}));seek.dispatchEvent(new Event('change',{bubbles:true}));
      const source=document.getElementById('synthSongSelect');source.value='/vgm/Other.vgm';source.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(page,async()=>{const value=await transport(page);return value.source==='/vgm/Other.vgm'&&value.state==='stopped'&&Math.abs(value.seek.max-8.5)<1e-6;},'Source switch cancels the pending seek');
    await pause(550);await silence(page);assert.equal((await transport(page)).cache.count,0,'Changing source releases the old checkpoint cache');
    steps.push('stopped seek resumes from its destination, playing seek reaches EOF, and immediate Stop/source switch cancel pending reconstruction without late sound');

    await cacheOff(page);await page.reload();await ready(page);await openMix(page);
    assert.equal(await page.locator('#synthSongSeekCacheToggle').isChecked(),false,'Cache Off preference survives reload');
    await until(page,async()=>(await transport(page)).cache.enabled==='false','Reload applies saved cache preference');
    const finalCache=await cacheBounded(page);assert.equal(finalCache.count,0);assert.equal(finalCache.bytes,0);
    if(config.screenshots)await fs.mkdir(config.screenshots,{recursive:true});
    const layouts=[];for(const width of [1240,390]){
      await page.setViewportSize({width,height:1100});await page.locator('#synthSongSeek').scrollIntoViewIfNeeded();
      const rect=await page.locator('#synthSongSeek').boundingBox();assert(rect&&rect.width>0&&rect.height<=36&&rect.x>=0&&rect.x+rect.width<=width+1,'Compact seek range stays within '+width+'px');
      await openMix(page);layouts.push({width,seek:rect});
      if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-song-seek-${width}.png`)});
    }
    assert.deepEqual(errors,[]);assert((await audit(page)).every(meter=>meter.muted&&meter.finite));
    return {browser:name,steps,metadata,first,forward,backward,warm,restored,finalCache,layouts,physicalOutputMuted:true};
  }catch(error){console.error(JSON.stringify({browser:name,steps,transport:await transport(page).catch(()=>null),ui:await ui(page).catch(()=>null),errors}));throw error;}
  finally{await bounded(page.close(),'close song seek');}
}

(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try{for(const name of engines){const browser=await bounded(({chromium,webkit})[name].launch({headless:true}),'launch '+name);
    try{results.push(await checkBrowser(browser,name,origin));console.log('PASS '+name+': source seeking, realPCM/Live, boundedcache, cancellation and UI');}
    finally{await bounded(browser.close(),'close '+name);}}}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  assert.deepEqual(missing,[]);assert.deepEqual(external,[]);const report={passed:true,physicalOutputMuted:true,listeningPerformed:false,results,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('PASS '+results.length+' browsers; receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
