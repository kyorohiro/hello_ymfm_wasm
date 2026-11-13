// FM2612 Synth: a VGM and a person write to the same reference YM2612.
// Self-authored fixtures only. Every destination is intercepted before app JS
// at gain zero; Chromium is additionally launched with --mute-audio.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),config={root:path.join(repository,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'fm2612-synth-song-manual-browser.json'),screenshots:path.join(tmpdir(),'fm2612-synth-song-manual-browser')};
for(const argument of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(argument);assert(match,'Unknown argument '+argument);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const CLOCK=7670454,RATE=53267,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
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
  MessagePort.prototype.postMessage=function(data,...args){for(const command of Array.isArray(data)?data:[data])if(command?.type==='write')commands.push({port:command.port,register:command.register,value:command.value});if(commands.length>10000)commands.splice(0,commands.length-10000);return post.call(this,data,...args);};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  window.__fmManualOutput={drain:()=>commands.splice(0),graph:()=>({contexts:contexts.length,worklets:worklets.slice(),destinations:meters.length,muted:meters.every(item=>item.mute.gain.value===0)}),
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
  function entry(engine){let item=entries.get(engine);if(!item){item={id:++next,closed:false,resets:0,frames:0,processCalls:0,finite:true,registers:[Array(256).fill(0),Array(256).fill(0)],writes:[],pcm:[]};entries.set(engine,item);records.push(item);}return item;}
  const write=prototype.writeYm2612,reset=prototype.reset,process=prototype.processFrames,dispose=prototype.dispose;
  prototype.writeYm2612=function(port,register,value){const item=entry(this),result=write.call(this,port,register,value);item.registers[port][register]=value;
    item.writes.push({frame:item.frames,port,register,value});if(item.writes.length>20000)item.writes.shift();return result;};
  prototype.reset=function(...args){const item=entry(this),result=reset.apply(this,args);item.resets++;item.frames=0;item.registers=[Array(256).fill(0),Array(256).fill(0)];item.pcm=[];return result;};
  prototype.processFrames=function(frames){const item=entry(this),pcm=process.call(this,frames);item.frames+=frames;item.processCalls++;
    for(const channel of [pcm.left,pcm.right])for(const value of channel)if(!Number.isFinite(value))item.finite=false;
    for(const value of pcm.left)item.pcm.push(value);if(item.pcm.length>8192)item.pcm.splice(0,item.pcm.length-8192);return pcm;};
  prototype.dispose=function(...args){entry(this).closed=true;return dispose.apply(this,args);};
  function snapshot(item){if(!item)return null;const {pcm,...value}=item;let sum=0,squares=0,peak=0;for(const sample of pcm){sum+=sample;squares+=sample*sample;peak=Math.max(peak,Math.abs(sample));}const mean=pcm.length?sum/pcm.length:0;
    return structuredClone({...value,signal:{frames:pcm.length,mean,peak,acRms:pcm.length?Math.sqrt(Math.max(0,squares/pcm.length-mean*mean)):0}});}
  window.__fmManualReference={read:()=>records.map(snapshot),current:()=>snapshot(records.findLast(item=>!item.closed))};
});}
const reference=page=>page.evaluate(()=>__fmManualReference.current());
const view=page=>page.evaluate(()=>{const root=document.getElementById('synthSongPlayer');return{state:root.dataset.state,frame:Number(root.dataset.consumedFrames),
  manualReady:root.dataset.manualReady,target:document.getElementById('synthSongChannelSelect').value,live:document.getElementById('synthSongLiveToggle').checked,
  status:document.getElementById('synthSongLiveStatus').textContent,inputMode:document.getElementById('synthInputSection').dataset.inputMode,code:document.getElementById('synthCodeState').textContent};});
const readOutput=page=>page.evaluate(()=>__fmManualOutput.read());
async function pcm(page,audible=true){let readings;await until(async()=>{readings=await readOutput(page);return readings.every(value=>value.muted&&value.finite)&&(audible?readings.some(value=>value.acRms>.0001):readings.every(value=>value.acRms<1e-7));},audible?'actual muted PCM':'actual output silence');return readings[0];}
const channel=(page,value)=>page.locator('#synthSongChannelSelect').selectOption(String(value));
const common=(page,label)=>page.locator(`#commonControls .param-value[aria-label="${label}"]`);
const operator=(page,number,label)=>page.locator(`#operatorControls .param-value[aria-label="${label}"]`).nth(number-1);
async function change(node,direction,count=1){await node.scrollIntoViewIfNeeded();await node.locator('..').locator('.param-button').nth(direction>0?1:0).evaluate((button,count)=>{for(let i=0;i<count;i++)button.click();},count);}
async function range(page,selector,value){await page.locator(selector).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
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

function fixture({special=false,csm=false}={}){
  const c=[],write=(r,v,p=0)=>c.push(p?0x53:0x52,r,v),waitSeconds=seconds=>{let n=Math.round(seconds*44100);while(n){const take=Math.min(n,65535);c.push(0x61,take&255,take>>8);n-=take;}},pitch=(ch,hz)=>{
    const p=ch>2?1:0,index=ch%3,block=4,fnum=Math.round(hz*144*2**20/(CLOCK*2**(block-1)));write(0xa4+index,(block<<3)|(fnum>>8),p);write(0xa0+index,fnum&255,p);};
  write(0x22,0);write(0x27,csm?0x80:special?0x40:0);write(0x2b,special?0x80:0);
  for(let ch=0;ch<6;ch++){const p=ch>2?1:0,index=ch%3;write(0xb0+index,7,p);write(0xb4+index,0xc0,p);
    for(const [op,slot]of[0,8,4,12].entries())for(const [r,v]of[[0x30,1],[0x40,op===3?48:127],[0x50,31],[0x60,0],[0x70,0],[0x80,15],[0x90,0]])write(r+slot+index,v,p);
    pitch(ch,440+ch*40);write(0x28,ch%3|(ch>2?4:0));}
  write(0x28,0x80);
  if(special||csm){for(const [lo,hi,b,f]of[[0xa9,0xad,2,321],[0xaa,0xae,3,654],[0xa8,0xac,4,987],[0xa2,0xa6,5,1111]]){write(hi,(b<<3)|(f>>8));write(lo,f&255);}write(0x28,0xf2);}
  waitSeconds(4);write(0x30,0x73);write(0xb0,(6<<3)|4);write(0x50,(3<<6)|17);waitSeconds(4);
  write(0x28,0);pitch(0,733);write(0x28,0x80);waitSeconds(22);c.push(0x66);
  const bytes=Buffer.alloc(256+c.length),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);bytes.write('Vgm ');v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x18,30*44100,true);v.setUint32(0x34,204,true);v.setUint32(0x2c,CLOCK,true);bytes.set(c,256);return bytes;
}

async function check(browser,name,origin,presetBytes){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await ready(page);await installReferenceAudit(page);
    step('Import is passive; playing CH1 shares one reference YM2612 with manual controls');
    await page.locator('#tfiFile').setInputFiles([{name:'Manual reference.vgm',mimeType:'application/octet-stream',buffer:fixture()},
      {name:'Special reference.vgm',mimeType:'application/octet-stream',buffer:fixture({special:true})},{name:'CSM reference.vgm',mimeType:'application/octet-stream',buffer:fixture({csm:true})},
      {name:'Manual preset.tfi',mimeType:'application/octet-stream',buffer:presetBytes}]);await ready(page);
    assert.equal((await page.evaluate(()=>__fmManualOutput.graph())).contexts,0);assert.equal((await page.evaluate(()=>__fmManualReference.read())).length,0);
    await wait(650);const originalFiles=await storedFiles(page),manualPresetPath=originalFiles.find(file=>file.path.endsWith('/Manual preset.tfi'))?.path;
    assert(manualPresetPath,'Imported TFI is available through Files');
    await page.locator('#synthSongSelect').selectOption('/vgm/Manual reference.vgm');await channel(page,0);await keyboard(page);await page.locator('#synthSongPlayButton').click();
    await until(()=>view(page).then(value=>value.state==='playing'&&value.frame>RATE*.1),'reference playback');await until(()=>common(page,'ALGO').textContent().then(value=>value==='7'),'initial CH1 patch');
    await range(page,'#masterVolumeRange',100);await wait(250);measurements.initial=await pcm(page);
    const initial=await reference(page),identity={id:initial.id,resets:initial.resets};assert(initial.finite);measurements.native=initial.signal;
    measurements.renderAheadSeconds=(initial.frames-(await view(page)).frame)/RATE;
    assert(measurements.renderAheadSeconds>=0&&measurements.renderAheadSeconds<.11,'Reference render-ahead remains bounded for hand interaction');
    assert(Math.abs(measurements.initial.acRms/initial.signal.acRms-1)<.12,'Master100 preserves native calibrated PCM gain');
    assert(measurements.initial.peak<=initial.signal.peak*1.12+.0001,'Steady native PCM gains no new browser-output peak');
    await range(page,'#masterVolumeRange',50);await wait(250);measurements.half=await pcm(page);assert(Math.abs(measurements.half.acRms/measurements.initial.acRms-.5)<.07);await range(page,'#masterVolumeRange',100);
    await change(operator(page,4,'TL'),-1,6);await until(()=>operator(page,4,'TL').textContent().then(value=>value==='42'),'rapid TL gestures retain latest value');await wait(90);
    assert.equal(await operator(page,4,'TL').textContent(),'42');let native=await reference(page);assert.equal(native.registers[0][0x4c],42);assert.equal(native.id,identity.id);assert.equal(native.resets,identity.resets);assert.equal((await view(page)).state,'playing');
    const releaseHandle=page.locator('[data-envelope-handle="release"]');await releaseHandle.scrollIntoViewIfNeeded();assert(await releaseHandle.isVisible(),'Playing song envelope exposes its editable handles');
    await releaseHandle.press('ArrowRight');await until(()=>reference(page).then(value=>(value.registers[0][0x8c]&15)===14),'Envelope graph edit reaches the playing selected CH');

    step('Live Off freezes observation but sparse edits preserve newer packed register fields');
    await seek(page,2.8);await until(()=>common(page,'ALGO').textContent().then(value=>value==='7'),'seek initial patch');await page.locator('#synthSongLiveToggle').uncheck();
    const frozen={multi:await operator(page,1,'MULTI').textContent(),dt:await operator(page,1,'DT').textContent(),rs:await operator(page,1,'RS').textContent(),algo:await common(page,'ALGO').textContent()};
    await until(()=>view(page).then(value=>value.frame>4.12*RATE),'programmed 4-second update');native=await reference(page);assert.equal(native.registers[0][0x30],0x73);assert.equal(native.registers[0][0xb0],52);
    assert.equal(await common(page,'ALGO').textContent(),frozen.algo);assert.equal(await operator(page,1,'DT').textContent(),frozen.dt);
    await change(operator(page,1,'MULTI'),1);await change(operator(page,1,'AR'),-1);await change(common(page,'FB'),1);
    await until(()=>reference(page).then(value=>value.registers[0][0x30]===0x72&&value.registers[0][0x50]===0xde&&value.registers[0][0xb0]===12),'manual MULTI/AR/FB use newest DT/RS/ALGO');
    assert.equal(await operator(page,1,'DT').textContent(),frozen.dt);assert.equal(await operator(page,1,'RS').textContent(),frozen.rs);assert.equal(await common(page,'ALGO').textContent(),frozen.algo);
    await page.locator('#synthSongLiveToggle').check();await until(()=>common(page,'ALGO').textContent().then(value=>value==='4'),'Live catches up');

    step('Manual key is on the same physical CH; later VGM KON defeats its stale key-up');
    await seek(page,7);await keyboard(page);await page.evaluate(()=>__fmManualOutput.drain());const before=await reference(page);
    await page.keyboard.down('a');await pressed(page,'a',true);await until(()=>reference(page).then(value=>value.writes.length>before.writes.length),'physical manual key writes');
    native=await reference(page);assert.equal(native.id,before.id);assert.equal(native.resets,before.resets);assert(native.writes.slice(before.writes.length).some(value=>value.register===0x28&&(value.value&0xf0)));
    assert(!(await page.evaluate(()=>__fmManualOutput.drain())).some(value=>value.register===0x28&&(value.value&0xf0)),'No layered editor Worklet voice');
    await until(()=>view(page).then(value=>value.frame>8.12*RATE),'VGM retakes CH1');const takeover=await reference(page),writeCount=takeover.writes.length;assert.equal(takeover.registers[0][0x28],0x80);
    await page.keyboard.up('a');await wait(90);native=await reference(page);assert(!native.writes.slice(writeCount).some(value=>value.register===0x28&&value.value===0),'stale key-up cannot stop a newer recorded note');
    measurements.afterTakeover=await pcm(page);await wait(650);assert.deepEqual(await storedFiles(page),originalFiles,'Temporary song-CH edits and keyboard never rewrite author presets or raw VGM files');

    step('Synth preset loading and keyboard keep reference transport and all six physical patches');
    await channel(page,'synth');const loadFrame=(await view(page)).frame,loadNative=await reference(page);await chooseFile(page,manualPresetPath);
    await until(()=>reference(page).then(value=>[0,1].every(port=>[0,1,2].every(ch=>value.registers[port][0xb0+ch]===7&&value.registers[port][0x4c+ch]===36))),'file preset reaches reference six channels');
    native=await reference(page);assert.equal(native.id,loadNative.id);assert.equal(native.resets,loadNative.resets);assert((await view(page)).frame>=loadFrame);assert.equal((await view(page)).state,'playing');
    await keyboard(page);const beforeSynthKey=(await reference(page)).writes.length;await page.keyboard.down('a');await pressed(page,'a',true);await wait(80);await page.keyboard.up('a');await pressed(page,'a',false);
    assert((await reference(page)).writes.slice(beforeSynthKey).some(value=>value.register===0x28&&(value.value&0xf0)),'Synth pool keyboard is a reference key, not a second chip');

    step('Pause keeps frozen audition independent; Copy, resume and seek preserve transport ownership');
    await seek(page,.3);await channel(page,0);await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(value=>value.state==='paused'),'Pause');await pcm(page,false);
    await until(()=>page.locator('#keyboard').getAttribute('data-song-audition').then(value=>value==='ready'),'paused trial ready');
    const paused=await view(page),pausedWrites=(await reference(page)).writes.length;await keyboard(page);await page.keyboard.down('a');await pressed(page,'a',true);await pcm(page);await page.keyboard.up('a');await pressed(page,'a',false);await pcm(page,false);
    assert.equal((await view(page)).frame,paused.frame);assert.equal((await reference(page)).writes.length,pausedWrites,'paused trial never writes frozen reference chip');
    await page.locator('#synthSongCopyButton').click();await ready(page);assert.equal((await view(page)).state,'paused');await channel(page,0);
    await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(value=>value.state==='playing'),'Resume');await seek(page,.7);assert.equal((await reference(page)).registers[0][0xb0],7,'seek reconstructs original data rather than manual patch');

    step('CH3 ratios and partial OP gates remain hardware values; DAC and CSM explain unavailable keys');
    await page.locator('#synthSongSelect').selectOption('/vgm/Special reference.vgm');await channel(page,2);await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(value=>value.state==='playing'&&value.frame>RATE*.1),'special playback');
    await keyboard(page);const specialStart=(await reference(page)).writes.length;await page.keyboard.down('a');await pressed(page,'a',true);await wait(60);
    native=await reference(page);const writes=native.writes.slice(specialStart),registers={};for(const value of writes)if(value.port===0)registers[value.register]=value.value;
    const values=[[0xa9,0xad],[0xaa,0xae],[0xa8,0xac],[0xa2,0xa6]].map(([lo,hi])=>{assert(Number.isInteger(registers[lo])&&Number.isInteger(registers[hi]));return (((registers[hi]&7)<<8)|registers[lo])*2**((registers[hi]>>3)&7);});
    for(const [i,value]of[321*4,654*8,987*16,1111*32].entries())assert(Math.abs(values[i]/values[3]-value/(1111*32))<.004);assert(native.registers[0][0x27]&0x40);await page.keyboard.up('a');
    await channel(page,5);await until(()=>view(page).then(value=>/DAC.*unavailable/i.test(value.status)),'DAC reason');await keyboard(page);const dacWrites=(await reference(page)).writes.length;await page.keyboard.down('a');await wait(70);await page.keyboard.up('a');assert(!(await reference(page)).writes.slice(dacWrites).some(value=>value.register===0x28&&(value.value&0xf0)));
    await page.locator('#synthSongSelect').selectOption('/vgm/CSM reference.vgm');await channel(page,2);await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(value=>value.state==='playing'&&/CSM.*unavailable/i.test(value.status)),'CSM reason');
    const csmWrites=(await reference(page)).writes.length;await keyboard(page);await page.keyboard.down('a');await wait(70);await page.keyboard.up('a');assert(!(await reference(page)).writes.slice(csmWrites).some(value=>value.register===0x28&&(value.value&0xf0)));

    step('Code and VGM are exclusive while mode switches and manual control preserve the chosen automatic source');
    await code(page,`const fm=await useSoundChip('ym2612');globalThis.__fmManualCode={ticks:0};fm.setAlgo(CH1,4,6);fm.setPan(CH1,true,true,3,7);fm.setOperator(CH1,0,{dt:7,multi:3,rs:3,ar:17});fm.noteOn(CH1,'E3');liveLoop('clock',async()=>{__fmManualCode.ticks++;await sleep(.05);});`);await runCode(page);
    await until(()=>view(page).then(value=>value.state==='stopped'),'Code retires VGM');await pcm(page);const ticks=await page.evaluate(()=>__fmManualCode.ticks);await keyboard(page);await page.evaluate(()=>__fmManualOutput.drain());
    await change(common(page,'FB'),1);await change(common(page,'AMS'),1);await change(operator(page,1,'MULTI'),1);await change(operator(page,1,'AR'),-1);await change(operator(page,4,'TL'),1);await wait(120);
    const codeWrites=await page.evaluate(()=>__fmManualOutput.drain()),last=(register)=>codeWrites.findLast(value=>value.port===0&&value.register===register)?.value;
    assert.equal(last(0xb0),12,'Manual Code feedback preserves latest Code ALGO');assert.equal(last(0xb4),0xd7,'Manual Code AMS preserves latest Code PMS');
    assert.equal(last(0x30),0x72,'Manual Code MULTI preserves latest Code DT');assert.equal(last(0x50),0xde,'Manual Code AR preserves latest Code RS');
    assert(await page.evaluate(()=>__fmManualCode.ticks)>ticks,'manual knob and Code→Keyboard preserve running Code');
    await page.locator('#synthSongSelect').selectOption('/vgm/Manual reference.vgm');await channel(page,0);await page.locator('#synthSongPlayButton').click();await until(()=>view(page).then(value=>value.state==='playing'),'VGM retires Code');
    assert.match(await page.locator('#synthCodeState').textContent(),/Stopped/i);const stoppedTicks=await page.evaluate(()=>__fmManualCode.ticks);await wait(150);assert.equal(await page.evaluate(()=>__fmManualCode.ticks),stoppedTicks);
    await keyboard(page);await page.keyboard.down('a');await pressed(page,'a',true);await page.locator('#synthSongStopButton').click();await until(()=>view(page).then(value=>value.state==='stopped'),'Stop');await page.keyboard.up('a');await pressed(page,'a',false);await pcm(page,false);
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#synthSongPlayer').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-${width}.png`)});}
    const finalFiles=new Map((await storedFiles(page)).map(file=>[file.path,file]));for(const file of originalFiles.filter(file=>file.path.startsWith('/vgm/')))assert.deepEqual(finalFiles.get(file.path),file,'Original song bytes remain reusable: '+file.path);
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert((await page.evaluate(()=>__fmManualOutput.graph())).muted);
    return{browser:name,passed:true,checks,measurements,graph:await page.evaluate(()=>__fmManualOutput.graph()),references:await page.evaluate(()=>__fmManualReference.read().map(({writes,...item})=>({...item,writeCount:writes.length}))),errors,consoleErrors};
  }catch(error){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-failure.png`)}).catch(()=>{});
    error.receipt={browser:name,passed:false,stage,error:error.stack,checks,measurements,diagnostic:{view:await view(page).catch(()=>null),references:await page.evaluate(()=>__fmManualReference?.read()).catch(()=>null),output:await readOutput(page).catch(()=>null)},errors,consoleErrors};throw error;
  }finally{await page.close();}
}
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),meta,'Asset changed during browser check');served.set(key,meta);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createTfiFromPreset}=await import(pathToFileURL(path.join(repository,'docs/js/tfi.js')).href),preset={algorithm:7,feedback:0,operators:{}};
  for(let op=1;op<=4;op++)preset.operators[op]={multi:1,dt:0,tl:op===4?36:127,rs:0,ar:31,d1r:0,d2r:0,sl:0,rr:15,ssg:0};const presetBytes=Buffer.from(createTfiFromPreset(preset));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,presetBytes));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
