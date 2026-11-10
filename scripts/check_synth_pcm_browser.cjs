// Public Mega CD PCM editor integration, using self-authored WAV/VGM fixtures.
// Every speaker edge is physically muted before application code runs; native
// worklet PCM is inspected only as numeric data. No listening test is performed.
//
// node scripts/check_synth_pcm_browser.cjs [--engines=chromium,webkit]
//   [--root=release/itch_synth] [--entry=/synth/index.html]
//   [--out=/tmp/pcm-browser.json] [--screenshots=/tmp/pcm-browser]
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {tmpdir}=require('node:os');
const repo=path.resolve(__dirname,'..');
const {chromium,webkit}=require('playwright');
const options={root:path.join(repo,'docs'),entry:'/synth/index.html',engines:'chromium,webkit',out:path.join(tmpdir(),'fm2612-synth-pcm-browser.json'),screenshots:path.join(tmpdir(),'fm2612-synth-pcm-browser')};
for(const arg of process.argv.slice(2)){const m=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(m,'Unknown argument '+arg);options[m[1]]=m[2];}options.root=path.resolve(options.root);
assert(options.entry.startsWith('/'),'Entry must be an absolute URL path');
assert(options.engines.split(',').every(name=>['chromium','webkit'].includes(name)),'Unsupported browser engine');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(task,label,ms=25000){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timeout '+label)),ms);})]);}finally{clearTimeout(timer);}}
const evaluate=(page,fn,arg)=>bounded(page.evaluate(fn,arg),'evaluate');
async function until(page,test,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await test())return;await pause(40);}throw Error(label);}
function installAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,NativeWorklet=window.AudioWorkletNode,meters=[],writes=[];
  let mask=255,selected=0;const steps=Array(8).fill(0),nodes=new WeakMap();
  function meter(source,kind,destination){
    const ctx=source.context,split=ctx.createChannelSplitter(2),left=ctx.createAnalyser(),right=ctx.createAnalyser(),mute=ctx.createGain();
    left.fftSize=right.fftSize=8192;mute.gain.value=0;connect.call(source,split);connect.call(split,left,0);connect.call(split,right,1);
    connect.call(left,mute);connect.call(right,mute);connect.call(mute,destination??ctx.destination);meters.push({left,right,mute,kind});
  }
  window.AudioWorkletNode=new Proxy(NativeWorklet,{construct(target,args,newTarget){const node=Reflect.construct(target,args,newTarget);nodes.set(node,args[1]);return node;}});
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){meter(this,'output',destination);return destination;}
    const result=connect.call(this,destination,...args);
    if(nodes.get(this)==='tetorica-rf5c164'&&!this.__pcmRawAudited){this.__pcmRawAudited=true;meter(this,'raw-pcm');}
    return result;
  };
  MessagePort.prototype.postMessage=function(message,...args){
    for(const c of Array.isArray(message)?message:[message]){
      if(c?.method==='writeRegister'&&Array.isArray(c.args)){
        const [register,value]=c.args;writes.push({kind:'rf',register,value});
        if(register===7&&(value&64))selected=value&7;
        if(register===2)steps[selected]=(steps[selected]&65280)|value;
        if(register===3)steps[selected]=(steps[selected]&255)|(value<<8);
        if(register===8){for(let channel=0;channel<8;channel++)if((mask&(1<<channel))&&!(value&(1<<channel)))writes.push({kind:'rf-keyOn',channel,step:steps[channel]});mask=value;}
      }else if(c?.method==='loadMemory'){
        const bytes=c.args?.[0];writes.push({kind:'rf-memory',length:bytes?.length,address:c.args?.[1],end:bytes?.indexOf(255),tail:bytes?.at(-1)});
      }else if(c?.type==='write'||c?.method==='write')writes.push({...c});
    }
    return post.call(this,message,...args);
  };
  function sample(analyser){
    const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);
    const mean=pcm.reduce((a,b)=>a+b,0)/pcm.length;let square=0,min=Infinity,max=-Infinity;
    for(const value of pcm){square+=(value-mean)**2;min=Math.min(min,value);max=Math.max(max,value);}
    const threshold=(min+max)/2,edges=[];if(max-min>1e-6)for(let i=1;i<pcm.length;i++)if(pcm[i-1]<threshold&&pcm[i]>=threshold)edges.push(i);
    const gaps=edges.slice(1).map((v,i)=>v-edges[i]).sort((a,b)=>a-b);
    return{rms:Math.sqrt(square/pcm.length),peak:Math.max(Math.abs(min),Math.abs(max)),edgeHz:gaps.length?analyser.context.sampleRate/gaps[gaps.length>>1]:null,finite:pcm.every(Number.isFinite)};
  }
  window.__pcmAudit={drain:()=>writes.splice(0),state:()=>({mask,steps:[...steps]}),read:()=>meters.map(({left,right,mute,kind})=>({kind,left:sample(left),right:sample(right),muted:mute.gain.value===0}))};
}
const audit=page=>evaluate(page,()=>__pcmAudit.read()),drain=page=>evaluate(page,()=>__pcmAudit.drain());
async function level(page,kind='output'){return Math.max(0,...(await audit(page)).filter(m=>m.kind===kind).flatMap(m=>[m.left.rms,m.right.rms]));}
async function silence(page){await pause(400);await until(page,async()=>(await level(page))<1e-7,'Output becomes silent');}
async function sounding(page){await until(page,async()=>(await level(page))>.0001,'Actual muted PCM reaches output');}
async function reading(page,kind='output'){await pause(250);return(await audit(page)).filter(m=>m.kind===kind).sort((a,b)=>b.left.rms+b.right.rms-a.left.rms-a.right.rms)[0];}
async function ready(page){await page.waitForFunction(()=>!document.getElementById('importPresetButton').disabled&&document.querySelector('.synth-editor').getAttribute('aria-busy')!=='true');}
const tab=(page,id)=>page.locator(`[data-synth-chip="${id}"]`);
async function chip(page,id){await tab(page,id).click();await until(page,async()=>await tab(page,id).getAttribute('aria-selected')==='true'&&await page.locator('.synth-editor').getAttribute('aria-busy')!=='true'&&!await page.locator('#importPresetButton').isDisabled(),'Instrument context '+id);await ready(page);}
async function pcmReady(page){await until(page,()=>evaluate(page,()=>!document.getElementById('keyboard').classList.contains('is-loading')&&document.getElementById('keyboard').getAttribute('aria-disabled')!=='true'),'PCM memory acknowledged and keyboard ready');}
async function blur(page){await evaluate(page,()=>document.activeElement?.blur?.());}
async function down(page,id='a'){await blur(page);await page.keyboard.down(id);}
async function up(page,id='a'){await page.keyboard.up(id);}
async function note(page,id='a'){await down(page,id);await sounding(page);}
async function prime(page){await page.keyboard.press('a');await pcmReady(page);await until(page,()=>evaluate(page,()=>document.getElementById('status').textContent.includes('Audio ready')),'Audio context primes');await up(page);}
async function range(page,selector,value){await page.locator(selector).first().evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},value);}
const fields={volume:'Volume',panLeft:'PanLeft',panRight:'PanRight',rootNote:'RootNote',loopStart:'LoopStart',loopEnd:'LoopEnd'};
async function settings(page){return evaluate(page,()=>({volume:Number(document.getElementById('synthPcmVolume').textContent),panLeft:Number(document.getElementById('synthPcmPanLeft').textContent),panRight:Number(document.getElementById('synthPcmPanRight').textContent),rootNote:Number(document.getElementById('synthPcmRootNote').textContent),loopStart:Number(document.getElementById('synthPcmLoopStart').textContent),loopEnd:Number(document.getElementById('synthPcmLoopEnd').textContent),loopEnabled:document.getElementById('synthPcmLoopEnabled').getAttribute('aria-pressed')==='true'}));}
async function field(page,name,value){
  const id='#synthPcm'+fields[name],node=page.locator(id),before=Number(await node.textContent()),span={volume:255,panLeft:15,panRight:15,rootNote:127,loopStart:65502,loopEnd:65502}[name];
  if(before===value)return;await node.scrollIntoViewIfNeeded();const box=await node.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+(value-before)/span*160,y,{steps:3});await page.mouse.up();
  for(let i=0;i<100;i++){const current=Number(await node.textContent());if(current===value)return;await page.locator(`[data-pcm-field="${name}"][data-pcm-step="${value>current?1:-1}"]`).click();}
  assert.equal(Number(await node.textContent()),value,'Numeric drag and +/- '+name);
}
async function builtin(page,shape){await page.locator(`[data-pcm-builtin="${shape}"]`).click();await pcmReady(page);await until(page,()=>page.locator(`[data-pcm-builtin="${shape}"]`).getAttribute('aria-pressed').then(v=>v==='true'),'Builtin '+shape);}
async function loop(page,on){if((await settings(page)).loopEnabled!==on)await page.locator('#synthPcmLoopEnabled').click();}
async function marker(page,from,to,frames){const node=page.locator('#synthPcmCanvas');await node.scrollIntoViewIfNeeded();const box=await node.boundingBox(),size=await node.evaluate(n=>({width:n.width,height:n.height}));const px=frame=>box.x+(28+frame/frames*(size.width-40))*box.width/size.width,y=box.y+box.height/2;
  await page.mouse.move(px(from),y);await page.mouse.down();await page.mouse.move(px(to),y,{steps:3});await page.mouse.up();await pcmReady(page);}
async function menu(page){if(!await page.locator('#synthMenu').evaluate(n=>n.open))await page.locator('#synthMenuButton').click();}
async function download(page,id){await menu(page);const promise=page.waitForEvent('download');await page.locator(id).click();const item=await promise,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return{bytes:Buffer.concat(chunks),name:item.suggestedFilename()};}
async function exported(page){const file=await download(page,'#exportPcmButton');assert.match(file.name,/\.pcm\.json$/);return JSON.parse(file.bytes.toString());}
let loadCassette,calibratedPcmGain;
async function cassette(page){const file=await download(page,'#exportCassetteButton');return{...file,value:await loadCassette(file.bytes)};}
const bytesAt=(archive,p)=>{const bytes=archive.files.get(p.replace(/^\//,''));assert(bytes,'Missing virtual file '+p);return Buffer.from(bytes);};
const pathNow=page=>page.locator('#synthActiveFilePath').textContent();
async function sync(page){await page.locator('#synthFileSaveButton').click();await ready(page);await until(page,()=>page.locator('#synthFileSaveButton').getAttribute('data-feedback').then(v=>v==='success'),'Sync succeeds');}
async function choose(page,tonePath){if(!await page.locator('#synthFilesPanel').isVisible())await page.locator('#synthFilesToggle').click();for(let i=0;i<20;i++){const closed=page.locator('#synthFilesTree details:not([open]) > summary[data-file-path]');if(!await closed.count())break;await closed.first().click();}
  const nodes=page.locator('#synthFilesTree button.file-entry');await nodes.locator(`xpath=self::*[@data-file-path=${JSON.stringify(tonePath)}]`).click();await until(page,async()=>(await pathNow(page))===tonePath,'Select virtual PCM');await ready(page);}
function wav(seconds=.25,rate=16000){const frames=Math.round(seconds*rate),bytes=Buffer.alloc(44+frames*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++){const fade=Math.min(1,i/(rate*.005),(frames-i-1)/(rate*.005));bytes.writeInt16LE(Math.round(Math.sin(i/rate*2*Math.PI*440)*.65*fade*32767),44+i*2);}return bytes;}
async function loadWav(page,name,bytes){await page.locator('#synthPcmAudioFile').setInputFiles({name,mimeType:'audio/wav',buffer:bytes});await until(page,()=>page.locator('#status').textContent().then(v=>v.includes('Loaded '+name)),'WAV import '+name);await pcmReady(page);}
function authoredReference(){const commands=[0x52,0xb0,7,0x52,0xb4,0xc0,0x52,0xa4,0x22,0x52,0xa0,0x44,0x52,0x28,0xf0,0x50,0x84,0x50,0x1a,0x50,0x96];let frames=12*44100;while(frames){const n=Math.min(frames,65535);commands.push(0x61,n&255,n>>8);frames-=n;}commands.push(0x66);const bytes=Buffer.alloc(256+commands.length),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);bytes.write('Vgm ');v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);v.setUint32(12,3579545,true);v.setUint32(0x2c,7670454,true);v.setUint32(0x34,204,true);v.setUint32(0x18,12*44100,true);bytes.set(commands,256);return bytes;}
const served=new Map(),missing=[],external=[];
const server=http.createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}const file=path.resolve(options.root,'.'+decodeURIComponent(pathname));assert(file.startsWith(options.root+path.sep));const bytes=await fs.readFile(file),name=path.relative(options.root,file).split(path.sep).join('/'),meta={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};if(served.has(name))assert.deepEqual(served.get(name),meta,'Served asset changed');served.set(name,meta);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(bytes);}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
async function open(browser,origin){const page=await browser.newPage({viewport:{width:1240,height:1100},serviceWorkers:'block'}),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin&&!['blob:','data:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});await page.addInitScript(installAudit);await page.goto(origin+options.entry);await ready(page);return{page,errors};}
async function run(browser,name,origin){const{page,errors}=await open(browser,origin),steps=[];const result={browser:name,steps};
 try{
  await chip(page,'ym2612');await page.locator('#presetSelect').selectOption('sine');await ready(page);await sync(page);const fmPath=await pathNow(page);
  await chip(page,'psg');await sync(page);const psgPath=await pathNow(page);const before=(await cassette(page)).value,otherFiles=new Map([...before.files].filter(([p])=>!p.endsWith('.pcm.json')).map(([p,b])=>[p,Buffer.from(b)]));
  await chip(page,'pcm');assert.equal(await tab(page,'pcm').getAttribute('aria-selected'),'true');assert.match(await page.locator('#synthPcmHelp').textContent(),/software operations/i);
  assert(!await page.locator('#looperStartButton').isDisabled(),'PCM Software Looper is available');assert(!await page.locator('#eventRecordStartButton').isDisabled(),'PCM software Event Rec is available');
  assert.match(await page.locator('#synthPcmHelp').textContent(),/software.*looper/i);assert.equal((await settings(page)).volume,64);await prime(page);
  for(const shape of['triangle','saw','square','sine']){await builtin(page,shape);const doc=await exported(page);assert.equal(doc.kind,'tetorica-rf5c164');assert.equal(doc.version,1);assert.equal(Buffer.from(doc.sample.data,'base64').length,256);assert.equal(doc.sample.name.toLowerCase(),shape);}
  await note(page);const base=await reading(page),raw=await reading(page,'raw-pcm');assert(raw?.left.rms>.001);const gain=base.left.rms/raw.left.rms;assert(Math.abs(gain-calibratedPcmGain)<.025,'Shared System PCM gain applied once');result.base={base,raw,gain};
  await range(page,'#masterVolumeRange',200);const boosted=await reading(page);assert(Math.abs(boosted.left.rms/base.left.rms-2)<.15,'200% Master doubles PCM');await range(page,'#masterVolumeRange',0);await silence(page);await range(page,'#masterVolumeRange',100);await sounding(page);await up(page);await silence(page);
  await field(page,'volume',128);await note(page);const volume128=await reading(page);assert(Math.abs(volume128.left.rms/base.left.rms-2)<.15,'Hardware volume live control');await field(page,'panLeft',0);const pan=await reading(page);assert(pan.left.rms<1e-7&&pan.right.rms>.001,'Independent native left/right pan');await up(page);await field(page,'panLeft',15);await field(page,'volume',64);
  await note(page);const normal=(await reading(page)).left.edgeHz;await field(page,'rootNote',72);const lower=(await reading(page)).left.edgeHz;assert(Math.abs(lower/normal-.5)<.03,'Root note changes sample speed');await field(page,'rootNote',60);await range(page,'[data-pitch-bend-wheel]',1000);const bent=(await reading(page)).left.edgeHz;assert(Math.abs(bent/normal-2**(2/12))<.03,'PCM uses common Pitch wheels');await range(page,'[data-pitch-bend-wheel]',0);await up(page);await silence(page);
  const keys=await evaluate(page,()=>[...document.querySelectorAll('#keyboard .key[data-key]')].map(n=>n.dataset.key).filter((k,i,a)=>/^[a-z0-9]$/i.test(k)&&a.indexOf(k)===i).slice(0,9));assert(keys.length>=9,'Keyboard exposes nine distinct physical test keys');await drain(page);for(const k of keys.slice(0,8))await down(page,k);await sounding(page);assert.equal((await evaluate(page,()=>__pcmAudit.state())).mask,0,'All eight hardware voices active');const allocation=(await drain(page)).filter(w=>w.kind==='rf-keyOn');assert.deepEqual([...new Set(allocation.map(w=>w.channel))].sort(),[0,1,2,3,4,5,6,7]);await down(page,keys[8]);assert.equal((await evaluate(page,()=>__pcmAudit.state())).mask,0,'Ninth note steals within eight voices');for(const k of keys)await up(page,k);await silence(page);assert.equal((await evaluate(page,()=>__pcmAudit.state())).mask,255);result.allocation=allocation;
  for(const mode of['waveform','spectrum','sample']){await page.locator(`[data-pcm-visual-mode="${mode}"]`).click();assert.equal(await page.locator(`[data-pcm-visual-mode="${mode}"]`).getAttribute('aria-pressed'),'true');}
  await marker(page,0,16,256);assert(Math.abs((await settings(page)).loopStart-16)<=1);await marker(page,256,128,256);assert(Math.abs((await settings(page)).loopEnd-128)<=1);await note(page);await field(page,'loopEnd',100);await pcmReady(page);assert.equal(await page.locator('#keyboard .key.is-active').count(),0,'Changing end stops held keyboard state');await up(page);await silence(page);const memory=(await drain(page)).filter(w=>w.kind==='rf-memory').at(-1);assert(memory&&memory.length===65536&&memory.end===100&&memory.tail===255,'End marker reloads complete guarded shared RAM');
  await builtin(page,'sine');steps.push('Builtins, native 8-voice round robin, signal-derived System/Master gain, hardware volume/pan/root/Pitch, visual modes and draggable guarded loop markers');
  await loadWav(page,'Short authored.wav',wav(.25));assert.equal((await settings(page)).loopEnabled,false);await note(page);await pause(700);await silence(page);assert(await page.locator('#keyboard .key[data-key="a"]').evaluate(n=>n.classList.contains('is-active')),'One shot silences while key stays held');await up(page);await loop(page,true);await note(page);await pause(700);await sounding(page);await up(page);await silence(page);
  await loadWav(page,'Long authored.wav',wav(3,48000));assert.match(await page.locator('#synthPcmLoadStatus').textContent(),/Software resampling/);const fitted=await exported(page),frames=Buffer.from(fitted.sample.data,'base64').length;assert(frames<=65503&&frames>65000);assert(Math.abs(frames/fitted.sample.sampleRate-3)<.002,'Software fit preserves duration');result.wav={frames,rate:fitted.sample.sampleRate,duration:frames/fitted.sample.sampleRate};
  await page.locator('#synthPcmAudioFile').setInputFiles({name:'Bad.wav',mimeType:'audio/wav',buffer:Buffer.from('not wave')});await until(page,()=>page.locator('#status').textContent().then(v=>v.includes('WAV load failed')),'Invalid WAV rejects');assert.deepEqual(await exported(page),fitted,'Invalid WAV preserves current sample/settings');
  await evaluate(page,()=>{const original=File.prototype.arrayBuffer;window.__releaseDelayedPcm=null;File.prototype.arrayBuffer=function(){if(this.name!=='Delayed.wav')return original.call(this);const file=this;return new Promise(resolve=>{window.__releaseDelayedPcm=async()=>{File.prototype.arrayBuffer=original;resolve(await original.call(file));};});};});
  await page.locator('#synthPcmAudioFile').setInputFiles({name:'Delayed.wav',mimeType:'audio/wav',buffer:wav(.12)});await until(page,()=>evaluate(page,()=>!!window.__releaseDelayedPcm),'Delayed WAV starts');await builtin(page,'square');await evaluate(page,()=>window.__releaseDelayedPcm());await pause(300);assert.equal((await exported(page)).sample.name,'Square','Latest builtin cancels late WAV completion');
  steps.push('RIFF WAV decoding/conversion is labeled software; native one-shot/loop behavior, oversize duration-preserving fit and invalid/stale WAV atomicity');
  await field(page,'volume',73);await field(page,'panLeft',11);await field(page,'loopStart',12);await field(page,'loopEnd',190);await sync(page);const pcmPath=await pathNow(page);assert.match(pcmPath,/\.pcm\.json$/);const saved=await exported(page);await field(page,'volume',90);await loop(page,false);await page.locator('#synthFileRevertButton').click();await ready(page);assert.deepEqual(await exported(page),saved,'Revert restores checkpoint sample and settings');
  await page.locator('#tfiFile').setInputFiles({name:'bad.pcm.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...saved,version:999}))});await ready(page);await page.locator('#presetImportError').waitFor({state:'visible'});assert.deepEqual(await exported(page),saved,'Invalid PCM JSON is atomic');
  const archive=await cassette(page);for(const [p,b]of otherFiles)assert.deepEqual(bytesAt(archive.value,p),b,'Original FM/PSG/opaque bytes preserved: '+p);assert.deepEqual(JSON.parse(bytesAt(archive.value,pcmPath).toString()),saved);assert(archive.value.files.has(fmPath.slice(1))&&archive.value.files.has(psgPath.slice(1)),'Cassette contains FM, PSG and PCM together');
  await page.locator('#cassetteImportInput').setInputFiles({name:'Mixed PCM.cassette.zip',mimeType:'application/zip',buffer:archive.bytes});await ready(page);await until(page,()=>page.locator('#status').textContent().then(v=>v.includes('Imported Mixed PCM.cassette.zip')),'Mixed Cassette imports');await choose(page,pcmPath);await pcmReady(page);assert.deepEqual(await exported(page),saved,'Self-contained sample survives Cassette');
  await field(page,'panRight',9);const unsynced=await exported(page);await page.reload();await ready(page);await until(page,()=>tab(page,'pcm').getAttribute('aria-selected').then(v=>v==='true'),'Dirty PCM context recovers after reload');assert.deepEqual(await exported(page),unsynced,'Immediate recovery retains last hardware setting and sample');await prime(page);await sync(page);
  steps.push('Self-contained PCM JSON export, strict invalid import, Sync/Revert, mixed FM/PSG/PCM Cassette byte preservation and dirty reload recovery');
  await chip(page,'ym2612');await page.locator('#presetSelect').selectOption('sine');await ready(page);await drain(page);for(const k of keys.slice(0,8))await down(page,k);await pause(100);assert.equal(await page.locator('#keyboard .key.is-active').count(),6,'FM allocator remains six voices');const fm=(await drain(page)).filter(w=>w.type==='write'&&w.register===0x28&&(w.value&0xf0));assert(fm.length>=6&&fm.every(w=>[0,1,2,4,5,6].includes(w.value&7)),'FM never writes invalid seventh/eighth hardware channel');for(const k of keys)await up(page,k);await silence(page);
  await chip(page,'psg');await page.locator('[data-psg-source="tone"]').click();await drain(page);for(const k of keys.slice(0,4))await down(page,k);await pause(100);assert.equal(await page.locator('#keyboard .key.is-active').count(),3,'PSG Tone allocator remains three voices');for(const k of keys)await up(page,k);await silence(page);
  await page.locator('#tfiFile').setInputFiles({name:'Authored reference.vgm',mimeType:'application/octet-stream',buffer:authoredReference()});await ready(page);await page.locator('#synthSongChannelSelect').selectOption('0');await page.locator('#synthSongPlayButton').click();await until(page,()=>page.locator('#synthSongStatus').getAttribute('data-state').then(v=>v==='playing'),'Reference VGM starts');assert(!await tab(page,'pcm').isDisabled(),'PCM remains selectable during reference Live');await tab(page,'pcm').click();assert.equal(await page.locator('#synthSongChannelSelect').inputValue(),'pcm:0','Switching chip keeps a reference target');assert.equal(await tab(page,'pcm').getAttribute('aria-selected'),'true');assert.match(await page.locator('#synthSongLiveStatus').textContent(),/No Mega CD PCM in this VGM/);await page.locator('#synthSongStopButton').click();await page.locator('#synthSongChannelSelect').selectOption('synth');await chip(page,'pcm');await pcmReady(page);
  steps.push('Eight-slot pool keeps FM at six and PSG Tone at three; switching reference Live to a missing PCM chip preserves its target until Synth is selected');
  await silence(page);result.routeReplacement=await evaluate(page,async()=>{
    const {createSynthPcmAudio}=await import(new URL('./synth_pcm_audio.js?v=pcm-editor-1',location.href).href);
    const context=new AudioContext(),first=context.createGain(),second=context.createGain(),failures=[];
    first.connect(context.destination);second.connect(context.destination);
    const endpoint=createSynthPcmAudio({onError:error=>failures.push(error.message)}),memory=new Uint8Array(65536).fill(255);
    try{const api1=await endpoint.prepare(context,first);await api1.loadMemory(memory,0);const api2=await endpoint.prepare(context,second);await api2.loadMemory(memory,0);
      const replaced=api1!==api2;endpoint.dispose();if(context.state==='closed')throw Error('Endpoint closed borrowed context');if(!replaced||failures.length)throw Error('Route replacement failed: '+failures.join(', '));return{replaced,contextKeptOpen:true,failures};
    }finally{endpoint.dispose();first.disconnect();second.disconnect();await context.close();}
  });steps.push('Two real RF worklet owners reuse the same module URL while changing route; disposal preserves the borrowed AudioContext');
  const layouts=[];await fs.mkdir(options.screenshots,{recursive:true});for(const width of[1240,390]){await page.setViewportSize({width,height:1100});await page.locator('#synthPcmSettings').scrollIntoViewIfNeeded();const box=await page.locator('#synthPcmSettings').boundingBox();assert(box&&box.x>=-1&&box.x+box.width<=width+1,'PCM controls fit viewport');assert(await evaluate(page,()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow');await page.screenshot({path:path.join(options.screenshots,`${name}-pcm-${width}.png`)});layouts.push({width,box});}
  const meters=await audit(page);assert(meters.length&&meters.every(m=>m.muted&&m.left.finite&&m.right.finite),'Every physical output remains zero-gain and finite');assert.deepEqual(errors,[]);return{...result,layouts,physicalOutputMuted:true,listeningPerformed:false};
 }catch(error){console.error(JSON.stringify({browser:name,steps,status:await page.locator('#status').textContent().catch(()=>null),settings:await settings(page).catch(()=>null),audio:await audit(page).catch(()=>null),writes:await drain(page).catch(()=>null),errors}));throw error;}
 finally{await bounded(page.close(),'close PCM page');}
}
(async()=>{
 ({loadPlaygroundCassette:loadCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href));
 ({SYNTH_SONG_MIX_DEFAULTS:{pcm:calibratedPcmGain}}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_song_mix_defaults.js')).href));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`,results=[];
 try{for(const name of options.engines.split(',')){assert(['chromium','webkit'].includes(name));const browser=await bounded(({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})}),'launch');try{results.push(await run(browser,name,origin));console.log('PASS '+name+': PCM editor, actual silent stereo worklets, guarded RAM, Files/Cassette and FM/PSG regression');}finally{await bounded(browser.close(),'close browser');}}}
 finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
 assert.deepEqual(missing,[]);assert.deepEqual(external,[]);await fs.mkdir(path.dirname(options.out),{recursive:true});await fs.writeFile(options.out,JSON.stringify({passed:true,physicalOutputMuted:true,listeningPerformed:false,results,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');console.log('PASS receipt '+options.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
