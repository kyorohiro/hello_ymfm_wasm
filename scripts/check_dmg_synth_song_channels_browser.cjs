// SPDX-License-Identifier: BSD-3-Clause
// Original VGM / VGZ, actual DMG APU, headless only. Intercept every speaker
// destination before app JS and force gain zero; Chromium is muted as well.
// node scripts/check_dmg_synth_song_channels_browser.cjs --root=docs --entry=/synth-dmg/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os'),{gzipSync}=require('node:zlib');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-dmg/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'dmg-synth-song-channels-browser.json'),screenshots:path.join(tmpdir(),'dmg-synth-song-channels-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],blockedMonaco=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(25);}throw Error('Timeout: '+label);}

function installSilentAudit(){
  const nativeConnect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],commands=[],sources=[];let sequence=0,lastWave=null;
  window.AudioContext=class extends Context{
    constructor(...args){super(...args);contexts.push(this);}
    createBufferSource(){const source=super.createBufferSource(),item={node:source,started:false,stopped:false,ended:false};sources.push(item);
      const start=source.start,stop=source.stop;source.start=function(...args){item.started=true;return start.apply(this,args);};
      source.stop=function(...args){item.stopped=true;return stop.apply(this,args);};source.addEventListener('ended',()=>{item.ended=true;});return source;}
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return nativeConnect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=2048;analyser.smoothingTimeConstant=0;mute.gain.value=0;
    nativeConnect.call(this,analyser,...args);nativeConnect.call(analyser,mute);nativeConnect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){if(data?.method){commands.push({method:data.method,args:data.args});if(commands.length>10000)commands.shift();}return post.call(this,data,...args);};
  // Record the existing Wave RAM path without adding an app observation API.
  const begin=CanvasRenderingContext2D.prototype.beginPath,move=CanvasRenderingContext2D.prototype.moveTo,line=CanvasRenderingContext2D.prototype.lineTo,stroke=CanvasRenderingContext2D.prototype.stroke;
  const paths=new WeakMap();CanvasRenderingContext2D.prototype.beginPath=function(...args){if(this.canvas.id==='waveCanvas')paths.set(this,[]);return begin.apply(this,args);};
  for(const [name,original]of [['moveTo',move],['lineTo',line]])CanvasRenderingContext2D.prototype[name]=function(x,y){paths.get(this)?.push([x,y]);return original.call(this,x,y);};
  CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='waveCanvas'&&this.strokeStyle==='#c6dd95'){
    const points=paths.get(this);if(points?.length===64)lastWave=Array.from({length:32},(_,i)=>Math.round((this.canvas.height-25-points[i*2][1])/(this.canvas.height-43)*15));
  }return stroke.apply(this,args);};
  const arrayBuffer=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){if(this.name==='slow.vgm')await new Promise(resolve=>setTimeout(resolve,500));return arrayBuffer.call(this);};
  async function read(method='read'){
    const node=nodes.findLast(item=>item.name==='tetorica-gameboy-synth')?.node;if(!node)throw Error('DMG editor Worklet missing');const id=--sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('DMG audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args:[]});});
  }
  function output(){const samples=meters.filter(item=>item.source.context.state==='running').map(item=>{
    const pcm=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(pcm);let square=0,peak=0;for(const value of pcm){square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/pcm.length),peak,finite:pcm.every(Number.isFinite)};
  }).sort((a,b)=>b.rms-a.rms);return{...(samples[0]??{rms:0,peak:0,finite:true}),muted:meters.every(item=>item.mute.gain.value===0)};}
  function spectrum(){const item=meters.findLast(item=>item.source.context.state==='running');if(!item)return null;
    const bins=new Float32Array(item.analyser.frequencyBinCount);item.analyser.getFloatFrequencyData(bins);let peak=-Infinity,index=0;
    for(let i=1;i<bins.length;i++){const hz=i*item.source.context.sampleRate/item.analyser.fftSize;if(hz<80||hz>700)continue;if(bins[i]>peak){peak=bins[i];index=i;}}
    return{frequency:index*item.source.context.sampleRate/item.analyser.fftSize,peak,sampleRate:item.source.context.sampleRate};}
  window.__dmgSongAudit={read,output,spectrum,wave:()=>lastWave?.slice(),drain:()=>commands.splice(0),
    graph:()=>({contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,editorWorklets:nodes.filter(item=>item.name==='tetorica-gameboy-synth').length,
      destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0),bufferSources:sources.length,stoppedSources:sources.filter(item=>item.stopped).length,liveSources:sources.filter(item=>item.started&&!item.stopped&&!item.ended).length})};
}
const read=(page,method='read')=>page.evaluate(method=>__dmgSongAudit.read(method),method);
const state=page=>page.evaluate(()=>({phase:document.querySelector('#dmgSongPlayer').dataset.state,frame:Number(document.querySelector('#dmgSongPlayer').dataset.positionFrames),
  rendered:Number(document.querySelector('#dmgSongPlayer').dataset.renderedFrames),
  duty:document.querySelector('#pulseDuty [aria-checked=true]')?.dataset.choiceValue,source:document.querySelector('#source [aria-checked=true]')?.dataset.choiceValue,
  status:document.querySelector('#dmgSongStatus').textContent,live:document.querySelector('#dmgSongLiveStatus').textContent,readonly:document.querySelector('#voiceEditor').dataset.readonly}));
async function phase(page,expected){await until(()=>state(page).then(value=>value.phase===expected),'song '+expected);}
async function pcm(page,audible=true){let value;await until(async()=>{value=await page.evaluate(()=>__dmgSongAudit.output());return value.muted&&value.finite&&(audible?value.rms>.0001:value.peak<1e-7);},audible?'real song PCM':'output silence');return value;}
async function files(page){if(await page.locator('#dmgFilesPanel').isHidden())await page.locator('#dmgFilesToggle').click();await until(()=>page.locator('#dmgFileImportButton').isEnabled(),'Files ready');}
async function play(page){await page.locator('#dmgSongPlayButton').click();await phase(page,'playing');}
async function pause(page){await page.locator('#dmgSongPlayButton').click();await phase(page,'paused');}
async function stop(page){await page.locator('#dmgSongStopButton').click();await phase(page,'stopped');await pcm(page,false);}
async function choose(page,value){await page.locator('#dmgSongSelect').selectOption(value);await until(async()=>!await page.locator('#dmgSongPlayButton').isDisabled()&&await page.locator('#dmgSongSelect').inputValue()===value,'song selected');}
async function download(page,selector){if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu')))&&!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();const event=page.waitForEvent('download');await page.locator(selector).click();const item=await event,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);}


const mask=page=>page.locator('#dmgSongPlayer').getAttribute('data-channel-mute-mask').then(Number);
async function channels(page,enabled){
  for(let channel=0;channel<4;channel++){
    const button=page.locator('#dmgSongChannel'+(channel+1)+'Toggle'),on=enabled.includes(channel);
    if((await button.getAttribute('aria-pressed')==='true')!==on)await button.click();
    assert.equal(await button.getAttribute('aria-pressed'),String(on));assert.match(await button.textContent(),new RegExp(`CH${channel+1}.*${on?'On':'Off'}`));
  }
  const expected=[0,1,2,3].reduce((value,channel)=>enabled.includes(channel)?value:value|(1<<channel),0);assert.equal(await mask(page),expected);return expected;
}
async function seek(page,seconds){await page.locator('#dmgSongSeek').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},seconds);
  await until(()=>state(page).then(value=>value.phase==='paused'&&value.frame===Math.round(seconds*44100)),'paused seek');}
async function drained(page,audible){await wait(420);return pcm(page,audible);}
const CODE_HOLD=`const gb=await useSoundChip('gameboy');\nawait gb.initialize();\nawait gb.wave.stopAndSetWaveform(Array.from({length:32},(_,i)=>i%16));\nawait gb.wave.setLevel(.5);\nawait gb.wave.noteOn('C4');\n`;
async function check(browser,name,origin,fixture,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),pageErrors=[],consoleErrors=[],checks=[],measurements={};let stage='startup',wasmGate=null;
  page.setDefaultTimeout(20000);page.on('pageerror',error=>pageErrors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}
    if(wasmGate&&/gameboy_apu_wasm\.wasm$/.test(url.pathname)){const gate=wasmGate;gate.entered=true;await new Promise(resolve=>{gate.release=resolve;});}return route.continue();});
  await page.addInitScript(installSilentAudit);const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  const hold=()=>{assert.equal(wasmGate,null);wasmGate={entered:false,release:null};},release=()=>{const gate=wasmGate;wasmGate=null;gate?.release?.();};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Four accessible channel buttons default On and can be changed before files or audio exist');
    assert.equal(await page.locator('[data-dmg-song-channel]').count(),4);assert.equal(await mask(page),0);
    assert.match(await page.locator('.dmg-song-channels').textContent(),/software mute/);
    for(let channel=0;channel<4;channel++)assert.equal(await page.locator('#dmgSongChannel'+(channel+1)+'Toggle').getAttribute('aria-pressed'),'true');
    await page.locator('#dmgSongChannel2Toggle').focus();await page.keyboard.press('Space');assert.equal(await page.locator('#dmgSongChannel2Toggle').getAttribute('aria-pressed'),'false');assert.equal(await page.evaluate(()=>document.activeElement.id),'dmgSongChannel2Toggle');
    await page.locator('#dmgSongChannel4Toggle').focus();await page.keyboard.press('Enter');assert.equal(await mask(page),10);assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);
    await page.locator('#dmgFilesInput').setInputFiles([
      {name:'held-channels.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)},
      {name:'held-channels.vgz',mimeType:'application/gzip',buffer:gzipSync(fixture.bytes)},
    ]);await choose(page,'/vgm/held-channels.vgm');assert.equal(await mask(page),10);
    await page.locator('#startAudio').click();await until(async()=>{try{return Boolean((await read(page)).preset);}catch{return false;}},'author APU');const author=await read(page);

    step('The latest mask reaches a delayed reference APU before its first queued audio');
    hold();await page.locator('#dmgSongPlayButton').click();await until(()=>Boolean(wasmGate?.entered),'reference engine creation paused');
    await channels(page,[]);release();await phase(page,'playing');await until(()=>state(page).then(value=>value.frame>=8820),'muted song is actually advancing');await pcm(page,false);assert.equal(await mask(page),15);

    step('Each physical channel has real finite output; All Off drains to silence without flushing the song queue');
    const isolated=[];
    for(let channel=0;channel<4;channel++){
      const before=await state(page),stopped=(await page.evaluate(()=>__dmgSongAudit.graph())).stoppedSources;
      await channels(page,[channel]);const output=await drained(page,true),spectrum=await page.evaluate(()=>__dmgSongAudit.spectrum());
      assert((await state(page)).frame>before.frame);assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).stoppedSources,stopped,'channel monitor does not cancel queued sources');
      if(channel<3){const expected=[4194304/(32*(2048-0x60b)),4194304/(32*(2048-0x672)),4194304/(64*(2048-0x6d0))][channel];assert(Math.abs(spectrum.frequency-expected)<30,`CH${channel+1} spectral peak ${spectrum.frequency} vs ${expected}`);}
      isolated.push({channel,output,spectrum});
    }
    measurements.isolated=isolated;await channels(page,[]);measurements.allOff=await drained(page,false);assert.equal((await state(page)).phase,'playing');
    await page.locator('#dmgSongChannelSelect').selectOption('2');const wave=await page.evaluate(()=>__dmgSongAudit.wave());assert.deepEqual(wave,fixture.wave);
    await page.locator('#dmgSongLiveEnabled').uncheck();const readout=await page.locator('#dmgSongReadout').textContent();
    await channels(page,[2]);await drained(page,true);assert.deepEqual(await page.evaluate(()=>__dmgSongAudit.wave()),wave);assert.equal(await page.locator('#dmgSongReadout').textContent(),readout);await page.locator('#dmgSongLiveEnabled').check();
    assert.deepEqual((await read(page)).preset,author.preset);

    step('Channel choices persist through Stop, source change, replay and seek');
    await stop(page);assert.equal(await mask(page),11);await choose(page,'/vgm/held-channels.vgz');assert.equal(await mask(page),11);
    await seek(page,2.5);assert.equal(await mask(page),11);await play(page);await drained(page,true);assert.equal(await mask(page),11);await pause(page);
    hold();await page.locator('#dmgSongSeek').evaluate(input=>{input.value='3.25';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>Boolean(wasmGate?.entered),'seek engine creation paused');await channels(page,[]);release();
    await until(()=>state(page).then(value=>value.phase==='paused'&&value.frame===143325),'seek committed latest all-Off mask');assert.equal(await mask(page),15);
    await play(page);await drained(page,false);await pause(page);

    step('An Off song channel remains available for paused keyboard audition and Capture');
    await page.locator('#dmgSongChannelSelect').selectOption('2');const frozen=await state(page);assert(await page.locator('#dmgSongCaptureButton').isEnabled());
    await page.keyboard.down('z');await until(()=>page.locator('#dmgSongPlayer').getAttribute('data-audition-sounding').then(value=>value==='1'),'muted-channel trial');await pcm(page);
    assert.equal((await state(page)).frame,frozen.frame);assert.equal(await mask(page),15);assert.deepEqual((await read(page)).preset,author.preset);
    await page.keyboard.up('z');await pcm(page,false);await page.locator('#dmgSongCaptureButton').click();
    await until(()=>page.locator('#dmgSongPlayer').getAttribute('data-view').then(value=>value==='synth'),'captured author view');const captured=(await read(page)).preset;
    assert.equal(captured.source,'wave');assert.deepEqual(captured.wave.samples,fixture.wave);assert(!Object.hasOwn(captured,'channelEnabled'));assert(!Object.hasOwn(captured,'channelMuteMask'));assert.equal(await mask(page),15);
    await page.keyboard.down('z');await until(async()=>(await read(page)).voices.length===1,'captured author key');await pcm(page);await page.keyboard.up('z');await pcm(page,false);
    assert.equal((await state(page)).frame,frozen.frame);

    step('Code output and authored presets are independent of the all-Off reference monitor');
    await files(page);await page.locator('#synthInputCodeTab').click();for(let i=0;i<12;i++){const closed=page.locator('#dmgFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
    await page.locator('#dmgFilesTree button[data-file-path="/index.js"]').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    await until(async()=>await page.locator('#synthCodePanel').getAttribute('data-editor-kind')==='javascript'&&await page.locator('#synthCodeRunButton').isEnabled(),'JavaScript model ready after captured JSON');
    await page.locator('#synthCodeEditor').fill(CODE_HOLD);
    await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'Code with reference muted');await pcm(page);assert.equal(await mask(page),15);assert.equal((await state(page)).phase,'stopped');
    await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stopped');await pcm(page,false);assert.deepEqual((await read(page)).preset,captured);await page.locator('#synthInputKeyboardTab').click();
    const projectBytes=await download(page,'#dmgProjectExportButton'),project=await loadCassette(projectBytes);
    const sounds=[...project.files].filter(([filename])=>/^presets\/.*\.json$/.test(filename)).map(([,bytes])=>JSON.parse(Buffer.from(bytes).toString('utf8')));assert.equal(sounds.length,2);assert(sounds.every(value=>!Object.hasOwn(value,'channelEnabled')&&!Object.hasOwn(value,'channelMuteMask')));
    const graph=await page.evaluate(()=>__dmgSongAudit.graph());assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);assert.equal(graph.destinationConnections,1);assert(graph.muted);measurements.graph=graph;

    step('390px buttons fit; channel monitor settings are session-only and restore defaults without autoplay');
    await seek(page,2);await page.locator('#dmgSongChannelSelect').selectOption('2');await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await page.locator('#dmgSongChannel1Toggle').scrollIntoViewIfNeeded();
      const layout=await page.locator('[data-dmg-song-channel]').evaluateAll(nodes=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:nodes.map(node=>{const r=node.getBoundingClientRect();return{id:node.id,left:r.left,right:r.right,width:r.width,height:r.height,text:node.textContent};})}));
      assert(layout.scroll<=width+1);assert(layout.buttons.every(value=>value.left>=-1&&value.right<=width+1&&value.width>=40&&value.height>=25));measurements['layout'+width]=layout;
      await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});}
    await page.reload();await files(page);assert.equal(await mask(page),0);assert.equal((await page.evaluate(()=>__dmgSongAudit.graph())).contexts,0);assert.notEqual((await state(page)).phase,'playing');
    for(let channel=0;channel<4;channel++)assert.equal(await page.locator('#dmgSongChannel'+(channel+1)+'Toggle').getAttribute('aria-pressed'),'true');
    assert.deepEqual(pageErrors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,graph,pageErrors,consoleErrors};
  }catch(error){const diagnostic={stage,state:await state(page).catch(()=>null),mask:await mask(page).catch(()=>null),audio:await page.locator('#audioStatus').textContent().catch(()=>''),code:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),commands:await page.evaluate(()=>__dmgSongAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors,consoleErrors};throw error;
  }finally{release();await page.close();}
}
const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const {createDmgSongFixture,DMG_SONG_INITIAL_WAVE}=await import(pathToFileURL(path.join(repo,'test/helpers/dmg_synth_song_fixture.mjs')).href);
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href);
  // Extend only the original authored initial registers: twenty seconds of
  // stationary four-channel sound lets each short monitor queue drain fully.
  const base=createDmgSongFixture(),commands=[...base.events[0].writes];let remaining=20*44100;
  while(remaining){const frames=Math.min(65535,remaining);commands.push(0x61,frames&255,frames>>8);remaining-=frames;}commands.push(0x66);
  const bytes=new Uint8Array(256+commands.length);bytes.set(base.bytes.subarray(0,256));bytes.set(commands,256);const header=new DataView(bytes.buffer);header.setUint32(4,bytes.length-4,true);header.setUint32(0x18,20*44100,true);
  const fixture={bytes,wave:DMG_SONG_INITIAL_WAVE};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
    try{results.push(await check(browser,name,origin,fixture,loadPlaygroundCassette));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');
  if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
