// SPDX-License-Identifier: BSD-3-Clause
// Original HuC6280 VGM / VGZ fixtures and the real WASM/audio route. No speaker
// receives audio: intercept every destination before application JS, use gain 0,
// and also launch Chromium with --mute-audio. This is not a listening test.
// node scripts/check_huc6280_synth_song_browser.cjs --root=docs --entry=/synth-huc6280/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os'),{gzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'huc6280-synth-song-browser.json'),screenshots:path.join(tmpdir(),'huc6280-synth-song-images')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(25);}throw Error('Timeout: '+label);}

// Self-authored register data, without game music, ROMs or recordings.
const wave=Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16)));
const lfoWave=Array.from({length:32},(_,i)=>(i*7)%32),write=(register,value)=>[0xb9,register,value];
function upload(channel,values,{volume=23,balance=255,period=428}={}){
  return [...write(0,channel),...write(4,64),...write(4,0),...values.flatMap(value=>write(6,value)),
    ...write(5,balance),...write(2,period&255),...write(3,period>>8),...write(7,0),...write(4,128|volume)];
}
function vgmBytes(commands,{samples=0,clock=3579545}={}){
  const bytes=Buffer.alloc(256+commands.length);bytes.write('Vgm ');bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x171,8);
  bytes.writeUInt32LE(samples,0x18);bytes.writeUInt32LE(0xcc,0x34);bytes.writeUInt32LE(clock,0xa4);bytes.set(commands,256);return bytes;
}
function makeFixture(){
  const commands=[],segments=[];let samples=0;
  const append=(...values)=>commands.push(...values),sleep=frames=>{while(frames){const count=Math.min(frames,65535);append(0x61,count&255,count>>8);samples+=count;frames-=count;}};
  const silence=()=>{for(let ch=0;ch<6;ch++)append(...write(0,ch),...write(4,0));append(...write(9,0));};
  append(...write(1,255),...write(9,0));
  append(...upload(0,wave));segments.push({kind:'Wave',from:samples,to:samples+88200});sleep(88200);silence();
  append(...write(0,4),...write(5,255),...write(7,0x90),...write(4,0x80|22));segments.push({kind:'Noise',from:samples,to:samples+66150});sleep(66150);silence();
  append(...upload(0,wave,{period:700}),...upload(1,lfoWave,{volume:0,period:913}),...write(8,7),...write(9,2));
  segments.push({kind:'LFO',from:samples,to:samples+66150});sleep(66150);silence();
  append(...write(0,3),...write(5,255),...write(4,0xc0|23));const directFrom=samples;
  for(let i=0;i<4410;i++){append(...write(6,wave[i%32]),0x77);samples+=8;}
  segments.push({kind:'Direct DDA',from:directFrom,to:samples});silence();
  const stream=Buffer.from(Array.from({length:7000},(_,i)=>0xe0|wave[i%32])),block=Buffer.alloc(7);block.set([0x67,0x66,5]);block.writeUInt32LE(stream.length,3);
  append(...block,...stream,...write(0,2),...write(5,255),...write(4,0xc0|23),0x90,0,0x1b,2,6,0x91,0,5,1,0,0x92,0,0x58,0x1b,0,0,0x95,0,0,0,1);
  segments.push({kind:'DAC stream',from:samples,to:samples+44100});sleep(44100);append(0x94,0);silence();
  append(...upload(2,wave,{period:300,volume:21}));segments.push({kind:'Wave ending',from:samples,to:samples+66150});sleep(66150);silence();append(0x66);
  return{bytes:vgmBytes(commands,{samples}),samples,segments};
}
function otherChipVgm(){const bytes=vgmBytes([0x52,0x22,0,0x61,0x44,0xac,0x66],{clock:0,samples:44100});bytes.writeUInt32LE(7670454,0x2c);return bytes;}
// A legal, timed source can have no extractable static instrument: Wave RAM
// contents were not recorded. Keep its original bytes without inventing a voice.
function zeroSnapshotVgm(){return vgmBytes([...write(1,255),...write(0,0),...write(5,255),...write(4,151),0x61,0x44,0xac,0x66],{samples:44100});}

function installSilentAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],sources=[],commands=[];let request=0;
  window.AudioContext=class extends Context{
    constructor(...args){super(...args);contexts.push(this);}
    createBufferSource(){const source=super.createBufferSource(),item={started:false,stopped:false,ended:false};sources.push(item);
      const start=source.start,stop=source.stop;source.start=function(...args){item.started=true;return start.apply(this,args);};source.stop=function(...args){item.stopped=true;return stop.apply(this,args);};
      source.addEventListener('ended',()=>{item.ended=true;});return source;}
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){if(data?.method){commands.push({method:data.method,args:data.method==='code'?data.args?.slice(0,2):[]});if(commands.length>1500)commands.shift();}return post.call(this,data,...args);};
  const originalRead=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){if(this.name==='slow.vgm')await new Promise(resolve=>setTimeout(resolve,650));return originalRead.call(this);};
  function output(){const active=meters.filter(item=>item.source.context.state==='running').map(item=>{
    const values=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0;
    for(const value of values){sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2)),peak,finite:values.every(Number.isFinite)};
  }).sort((a,b)=>b.acRms-a.acRms);return{...(active[0]??{rms:0,acRms:0,peak:0,finite:true}),muted:meters.every(item=>item.mute.gain.value===0)};}
  async function read(method='read'){
    const node=nodes.findLast(item=>item.name==='tetorica-huc6280-synth')?.node;if(!node)throw Error('HuC6280 author Worklet missing');const id=--request;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('HuC6280 audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Object.assign(Error(data.error),{name:data.name??'Error'})):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args:[]});});
  }
  window.__hucSongAudit={read,output,drain:()=>commands.splice(0),graph:()=>({contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,
    editorWorklets:nodes.filter(item=>item.name==='tetorica-huc6280-synth').length,destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0),
    bufferSources:sources.length,liveSources:sources.filter(item=>item.started&&!item.stopped&&!item.ended).length})};
}
const graph=page=>page.evaluate(()=>__hucSongAudit.graph()),read=(page,method='read')=>page.evaluate(method=>__hucSongAudit.read(method),method);
const state=page=>page.evaluate(()=>{const node=document.querySelector('#hucSongPlayer');return{...node.dataset,phase:node.dataset.state,frame:Number(node.dataset.positionFrames),
  rendered:Number(node.dataset.renderedFrames),status:document.querySelector('#hucSongStatus').textContent,position:document.querySelector('#hucSongPosition').textContent,source:document.querySelector('#hucSongSelect').value};});
async function phase(page,expected){await until(()=>state(page).then(value=>value.phase===expected),'song '+expected);}
async function pcm(page,audible=true){let value;await until(async()=>{value=await page.evaluate(()=>__hucSongAudit.output());return value.muted&&value.finite&&(audible?value.acRms>.00005:value.peak<1e-7);},audible?'actual song PCM':'output silence');return value;}
async function files(page){if(await page.locator('#hucFilesPanel').isHidden())await page.locator('#hucFilesToggle').click();await until(()=>page.locator('#hucFileImportButton').isEnabled(),'Files ready');}
async function choose(page,value){await page.locator('#hucSongSelect').selectOption(value);await until(async()=>await page.locator('#hucSongSelect').inputValue()===value&&!await page.locator('#hucSongPlayButton').isDisabled(),'song selected');}
async function play(page){await page.locator('#hucSongPlayButton').click();await phase(page,'playing');}
async function pause(page){await page.locator('#hucSongPlayButton').click();await phase(page,'paused');await pcm(page,false);}
async function stop(page){await page.locator('#hucSongStopButton').click();await phase(page,'stopped');await pcm(page,false);assert.equal((await state(page)).frame,0);}
async function openMenu(page){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();}
async function download(page,selector){if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu'))))await openMenu(page);
  const pending=page.waitForEvent('download');await page.locator(selector).click();const item=await pending,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}
async function selectIndex(page){await files(page);for(let i=0;i<12;i++){const closed=page.locator('#hucFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#hucFilesTree [data-file-path="/index.js"]').click();await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});}
async function runCode(page){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},'Code running');}

async function check(browser,name,origin,fixture,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup',wasmGate=null;
  page.setDefaultTimeout(25000);await page.addInitScript(installSilentAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}
    if(wasmGate&&/huc6280_wasm\.wasm$/.test(url.pathname)){const gate=wasmGate;gate.entered=true;await new Promise(resolve=>{gate.release=resolve;});}
    return route.continue();});
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('VGM / VGZ import stays passive; exact original sources join /vgm and the old extraction list still works');
    await page.locator('#vgmFileInput').setInputFiles({name:'reference.vgm',mimeType:'application/octet-stream',buffer:fixture.bytes});
    await until(()=>page.locator('#hucSongSelect option[value="/vgm/reference.vgm"]').count().then(Boolean),'VGM source in Files');
    await until(()=>page.locator('[data-vgm-voice]').count().then(count=>count>=4),'existing snapshot extraction');
    const extracted=await page.locator('#vgmVoices').textContent();for(const kind of ['Wave','Noise','LFO','PCM'])assert(extracted.includes(kind),'extract '+kind);
    await page.locator('#hucFilesInput').setInputFiles({name:'reference.vgz',mimeType:'application/gzip',buffer:gzipSync(fixture.bytes)});
    await until(()=>page.locator('#hucSongSelect option[value="/vgm/reference.vgz"]').count().then(Boolean),'VGZ source in Files');
    await page.locator('#vgmFileInput').setInputFiles({name:'unknown-wave-ram.vgm',mimeType:'application/octet-stream',buffer:zeroSnapshotVgm()});
    await until(()=>page.locator('#hucSongSelect option[value="/vgm/unknown-wave-ram.vgm"]').count().then(Boolean),'valid zero-snapshot source in Files');
    await until(async()=>await page.locator('#vgmFileName').textContent()==='unknown-wave-ram.vgm'&&await page.locator('#vgmLibrary').getAttribute('data-loading')==='false','zero-snapshot source analyzed');
    assert.equal(await page.locator('[data-vgm-voice]').count(),0);assert.equal(await page.locator('#vgmStatus').getAttribute('data-error'),'false');
    await choose(page,'/vgm/unknown-wave-ram.vgm');await choose(page,'/vgm/reference.vgm');
    assert.equal((await graph(page)).contexts,0);assert.equal(await page.locator('#instrumentName').inputValue(),'Sine');
    const projectBytes=await download(page,'#hucProjectExportButton'),project=await loadCassette(projectBytes);
    for(const [filename,bytes]of [['vgm/reference.vgm',fixture.bytes],['vgm/reference.vgz',gzipSync(fixture.bytes)],['vgm/unknown-wave-ram.vgm',zeroSnapshotVgm()]])assert.deepEqual(Buffer.from(project.files.get(filename)),bytes,filename+' exact bytes');
    measurements.cassetteBytes=projectBytes.length;

    step('Invalid, foreign-chip and cancelled imports keep the last valid source and do not create audio');
    for(const [filename,buffer]of [['invalid.vgm',Buffer.from('not VGM')],['other-chip.vgm',otherChipVgm()]]){
      await page.locator('#vgmFileInput').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer});
      await until(()=>page.locator('#vgmStatus').textContent().then(text=>/failed|unsupported|no HuC6280/i.test(text)),'rejected '+filename);
      assert.equal(await page.locator('#hucSongSelect').inputValue(),'/vgm/reference.vgm');assert.equal(await page.locator('#hucSongSelect option[value="/vgm/'+filename+'"]').count(),0);
      assert.equal((await graph(page)).contexts,0);
    }
    await page.locator('#vgmFileInput').setInputFiles({name:'slow.vgm',mimeType:'application/octet-stream',buffer:fixture.bytes});
    await page.locator('#cancelVgm').click();await wait(750);assert.equal(await page.locator('#hucSongSelect option[value="/vgm/slow.vgm"]').count(),0);assert.equal((await graph(page)).contexts,0);

    step('Play uses real Wave / Noise / LFO / direct DDA / DAC stream PCM through the existing post-Master route');
    await page.locator('#startAudio').click();await until(async()=>{try{return Boolean((await read(page)).preset);}catch{return false;}},'author Worklet ready');
    const author=(await read(page)).preset;await play(page);measurements.segments=[];
    for(const segment of fixture.segments){await until(()=>state(page).then(value=>value.frame>segment.from+4410),'audible '+segment.kind+' interval',20000);
      const consumed=await state(page);assert(consumed.frame<segment.to,'sampled '+segment.kind+' before its boundary');
      measurements.segments.push({...segment,consumed:consumed.frame,output:await pcm(page)});assert.deepEqual((await read(page)).preset,author);}
    await phase(page,'ended');await pcm(page,false);assert.deepEqual((await read(page)).preset,author);
    measurements.graph=await graph(page);assert.deepEqual({contexts:measurements.graph.contexts,editorWorklets:measurements.graph.editorWorklets,destinationConnections:measurements.graph.destinationConnections,muted:measurements.graph.muted},
      {contexts:1,editorWorklets:1,destinationConnections:1,muted:true});

    step('Pause stops all source PCM and freezes consumed position; Resume continues, Stop resets and Master scales once');
    await play(page);await pcm(page);await until(()=>state(page).then(value=>value.frame>6615),'song advances');await pause(page);
    const frozen=await state(page);assert.match(await page.locator('#hucSongPlayButton').textContent(),/Resume/i);await wait(180);assert.equal((await state(page)).frame,frozen.frame);
    assert.equal((await graph(page)).liveSources,0,'Pause retires prefetched source nodes');assert.deepEqual((await read(page)).preset,author);
    await play(page);await until(()=>state(page).then(value=>value.frame>frozen.frame+2205),'Resume advances original source timeline');
    assert((await state(page)).frame<frozen.frame+44100,'Resume did not restart at another region');await wait(110);const normal=await page.evaluate(()=>__hucSongAudit.output());
    await page.locator('#masterVolume').evaluate(input=>{input.value='.35';input.dispatchEvent(new Event('input',{bubbles:true}));});await wait(140);const half=await page.evaluate(()=>__hucSongAudit.output());
    measurements.master={normal,half,ratio:half.acRms/normal.acRms};assert(half.acRms/normal.acRms>.35&&half.acRms/normal.acRms<.65,'one Master gain scales reference playback');
    await page.locator('#masterVolume').evaluate(input=>{input.value='.7';input.dispatchEvent(new Event('input',{bubbles:true}));});await stop(page);await wait(180);assert.equal((await state(page)).phase,'stopped');assert.equal((await graph(page)).liveSources,0);

    step('Code and VGM are exclusive for playing and paused songs; keyboard returns to the authored sound after Stop');
    await selectIndex(page);await page.locator('#synthCodeEditor').fill(`const pce=await useSoundChip('huc6280');\nawait pce.noteOn(CH1,'A3');\nglobalThis.__hucSongCode=pce;\n`);await runCode(page);await pcm(page);
    await play(page);await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Stopped|Idle/.test(text)),'Play stops Code');assert.equal(await read(page,'observeCode'),null);await pcm(page);
    await pause(page);await runCode(page);await phase(page,'stopped');assert(await read(page,'observeCode'));await pcm(page);
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Stopped|Idle/.test(text)),'Code stopped');await pcm(page,false);
    await play(page);await runCode(page);await phase(page,'stopped');assert(await read(page,'observeCode'));await pcm(page);
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Stopped|Idle/.test(text)),'Code stops again');await pcm(page,false);
    await page.locator('#synthInputKeyboardTab').click();await page.locator('#synthTitle').click();const key=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(key);
    await page.keyboard.down(key);await pcm(page);await page.keyboard.up(key);await pcm(page,false);assert.deepEqual((await read(page)).preset,author);

    step('Stop and a newer Code owner invalidate delayed reference startup instead of resurrecting old playback');
    await selectIndex(page);wasmGate={entered:false,release:null};await page.locator('#hucSongPlayButton').click();await until(()=>Boolean(wasmGate?.entered),'deferred song WASM load');
    await page.locator('#hucSongStopButton').click();await phase(page,'stopped');await runCode(page);const gate=wasmGate;wasmGate=null;gate.release();await wait(300);
    assert.equal((await state(page)).phase,'stopped');assert(await read(page,'observeCode'));await pcm(page);await page.locator('#synthCodeStopButton').click();
    await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Stopped|Idle/.test(text)),'final Code Stop');await pcm(page,false);

    step('Cassette import and reload retain source bytes without autoplay; desktop and 390px transport fit');
    await page.locator('#hucProjectFileInput').setInputFiles({name:'reference-project.zip',mimeType:'application/zip',buffer:projectBytes});
    await until(()=>page.locator('#hucFilesStatus').textContent().then(text=>/project imported/i.test(text)),'Cassette restore');assert.notEqual((await state(page)).phase,'playing');
    await wait(250);await page.reload();await files(page);await until(()=>page.locator('#hucSongSelect option[value="/vgm/reference.vgz"]').count().then(Boolean),'source library reloaded');
    assert.equal((await graph(page)).contexts,0);assert.notEqual((await state(page)).phase,'playing');
    const restored=await loadCassette(await download(page,'#hucProjectExportButton'));assert.deepEqual(Buffer.from(restored.files.get('vgm/reference.vgm')),fixture.bytes);assert.deepEqual(Buffer.from(restored.files.get('vgm/reference.vgz')),gzipSync(fixture.bytes));
    assert.deepEqual(Buffer.from(restored.files.get('vgm/unknown-wave-ram.vgm')),zeroSnapshotVgm());
    await choose(page,'/vgm/reference.vgz');await play(page);await pcm(page);await pause(page);
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#hucSongPlayer').scrollIntoViewIfNeeded();
      const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#hucSongPlayer select,#hucSongPlayer button')].map(node=>({id:node.id,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));
      assert(bounds.scroll<=width+1,'layout fits '+width);assert(bounds.controls.every(item=>item.left>=-1&&item.right<=width+1),'transport controls fit '+width);measurements['layout'+width]=bounds;
      await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    await stop(page);await play(page);await pcm(page);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await until(()=>graph(page).then(value=>value.runningContexts===0&&value.liveSources===0),'pagehide retires output');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,measurements,graph:await graph(page),pageErrors:errors,consoleErrors};
  }catch(error){
    const diagnostic={stage,song:await state(page).catch(()=>null),audio:await page.locator('#audioStatus').textContent().catch(()=>''),code:await page.locator('#synthCodeState').textContent().catch(()=>''),
      codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),files:await page.locator('#hucFilesStatus').textContent().catch(()=>''),vgm:await page.locator('#vgmStatus').textContent().catch(()=>''),graph:await graph(page).catch(()=>null),commands:await page.evaluate(()=>__hucSongAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,consoleErrors};throw error;
  }finally{wasmGate?.release?.();wasmGate=null;await page.close();}
}

const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href),fixture=makeFixture();
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
