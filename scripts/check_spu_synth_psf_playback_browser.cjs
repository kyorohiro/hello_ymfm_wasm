// SPDX-License-Identifier: BSD-3-Clause
// PSF song transport checks. Intercept every destination before app scripts;
// all measured PCM stays upstream of gain zero. No listening is performed.
// node scripts/check_spu_synth_psf_playback_browser.cjs --root=docs --entry=/synth-spu/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'spu-synth-psf-playback-browser.json'),screenshots:path.join(tmpdir(),'spu-synth-psf-playback-browser')};
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
  const match=/^--(root|entry|engines|out|screenshots)(?:=(.*))?$/.exec(args[i]);assert(match,'Unknown argument '+args[i]);
  const value=match[2]??args[++i];assert(typeof value==='string'&&value&&!value.startsWith('--'),'Missing '+match[1]);config[match[1]]=value;
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const served=new Map(),missing=[],external=[],blockedMonaco=[],httpErrors=[],results=[];
const psfRequests=[];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(fn,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await wait(30);}throw Error('Timeout: '+label);}

function silentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,
    post=MessagePort.prototype.postMessage,Worklet=window.AudioWorkletNode,start=AudioBufferSourceNode.prototype.start,
    stop=AudioBufferSourceNode.prototype.stop,stroke=CanvasRenderingContext2D.prototype.stroke,
    all=Promise.all,nativeTimer=window.setTimeout.bind(window);
  const contexts=[],meters=[],nodes=[],commands=[],starts=[],stops=[];let sequence=0,monitorStrokes=0,delayNextStop=0,stopDelays=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...ports){
    if(destination!==this.context.destination)return connect.call(this,destination,...ports);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...ports);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  AudioBufferSourceNode.prototype.start=function(...args){starts.push({at:this.context.currentTime,when:args[0],offset:args[1],duration:args[2],frames:this.buffer?.length,rate:this.buffer?.sampleRate});return start.apply(this,args);};
  AudioBufferSourceNode.prototype.stop=function(...args){stops.push({at:this.context.currentTime});return stop.apply(this,args);};
  CanvasRenderingContext2D.prototype.stroke=function(...args){if(['outputCanvas','outputEnvelopeCanvas'].includes(this.canvas.id))monitorStrokes++;return stroke.apply(this,args);};
  MessagePort.prototype.postMessage=function(message,...args){if(message?.method){commands.push({method:message.method,args:message.args});if(commands.length>10000)commands.shift();}return post.call(this,message,...args);};
  // Armed only once the PSF is playing and all startup promises have settled.
  // The next Promise.all is the song Stop cleanup; delay its acknowledgement
  // so a physical key-up deterministically overtakes a pending keyboard On.
  Promise.all=function(values){const result=all.call(this,values);if(!delayNextStop)return result;
    const delay=delayNextStop;delayNextStop=0;stopDelays++;return result.then(value=>new Promise(resolve=>nativeTimer(()=>resolve(value),delay)));};
  function output(){
    const values=meters.filter(item=>item.source.context.state==='running').map(item=>{
      const pcm=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(pcm);let peak=0,square=0;
      for(const value of pcm){peak=Math.max(peak,Math.abs(value));square+=value*value;}
      return {peak,rms:Math.sqrt(square/pcm.length),finite:pcm.every(Number.isFinite)};
    }).sort((a,b)=>b.rms-a.rms);
    return {...(values[0]??{peak:0,rms:0,finite:true}),muted:meters.every(item=>item.mute.gain.value===0)};
  }
  async function read(method='inspect',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-spu-synth')?.node;if(!node)throw Error('SPU editor Worklet missing');const id=--sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SPU audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});
  }
  window.__spuPsfAudit={read,instrument:()=>read('getInstrument',[0]),output,armStopDelay(ms=150){delayNextStop=ms;},
    graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(item=>item.name==='tetorica-spu-synth').length,
      destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0),bufferStarts:starts.length,bufferStops:stops.length,monitorStrokes,stopDelays}),
    starts:()=>starts.slice(),commands:()=>commands.slice()};
}
async function graph(page){return page.evaluate(()=>__spuPsfAudit.graph());}
async function instrument(page){return page.evaluate(()=>__spuPsfAudit.instrument());}
async function position(page){return page.locator('#psfSongPosition').getAttribute('data-seconds').then(value=>Number(value));}
async function sounding(page){let pcm;await until(async()=>{pcm=await page.evaluate(()=>__spuPsfAudit.output());return pcm.finite&&pcm.muted&&pcm.rms>.00001;},'nonzero PSF PCM upstream of gain zero');return pcm;}
async function silent(page){await wait(150);await until(async()=>{const pcm=await page.evaluate(()=>__spuPsfAudit.output());return pcm.finite&&pcm.muted&&pcm.peak<1e-7;},'silent preview output');}
async function choose(page,selector,input,files){
  if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const selection=page.waitForEvent('filechooser');await page.locator(selector).click();const picker=await selection;
  assert.equal(await picker.element().getAttribute('id'),input);await picker.setFiles(files);
}
async function play(page){
  await page.locator('#psfPlaySong').click();await until(async()=>{
    const status=await page.locator('#psfPlaybackStatus').textContent();if(/failed:/i.test(status))throw Error(status);
    return await page.locator('#psfPauseSong').isEnabled()&&await page.locator('#psfPauseSong').textContent()==='Pause';
  },'PSF starts');await until(async()=>await position(page)>.05,'PSF position progresses');
}
async function stopped(page){await until(()=>page.locator('#psfPlaySong').isEnabled(),'PSF stops');assert.equal(await page.locator('#psfPauseSong').isEnabled(),false);}
async function songLayout(page,name,width){
  await page.setViewportSize({width,height:1050});
  const player=page.locator('#psfSongPlayer');await player.scrollIntoViewIfNeeded();
  const layout=await page.evaluate(()=>{
    const player=document.getElementById('psfSongPlayer'),monitor=document.getElementById('spuMonitor');
    const row=player.getBoundingClientRect(),plot=monitor.getBoundingClientRect();
    return {viewport:innerWidth,document:document.documentElement.scrollWidth,
      player:{left:row.left,right:row.right,top:row.top,bottom:row.bottom},monitorTop:plot.top,
      selectors:document.querySelectorAll('#psfEntry').length};
  });
  assert.equal(layout.selectors,1,'one shared PSF selector drives song playback and VAB extraction');
  assert(layout.player.bottom<=layout.monitorTop+1,'the song list is above Envelope / Waveform / Spectrum');
  assert(layout.document<=layout.viewport+1,`${width}px document fits the viewport`);
  assert(layout.player.left>=-1&&layout.player.right<=layout.viewport+1,`${width}px song list fits the viewport`);
  await player.screenshot({path:path.join(config.screenshots,`${name}-psf-song-list-${width}.png`)});
  return layout;
}
async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block'});page.setDefaultTimeout(25000);
  const checks=[],errors=[],consoleErrors=[],expectedConsole=[],measurements={},layouts=[];let stage='startup';
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()!=='error')return;const value=message.text(),url=message.location().url;
    if(/cdnjs\.cloudflare\.com/.test(value+' '+url)||/^Failed to load resource/.test(value)&&blockedMonaco.length)expectedConsole.push(value);else consoleErrors.push(value);});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(silentAudit);
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files initialization');
    assert.equal(await page.locator('#psfSongPlayer').count(),1);assert(await page.locator('#psfSongPlayer').isHidden(),'the song list does not take space before a PSF set is accepted');
    step('The matching MAME SPU ABI loads from versioned local assets and stale components fail before machine allocation');
    measurements.backend=await page.evaluate(async text=>{
      const script=document.querySelector('script[src*="synth.js"]');
      const url=new URL('./psf_playback_core.js?v=psf-mame-spu-1',new URL(script.src,location.href));
      const {createPsfPlaybackCore}=await import(url.href),bytes=Uint8Array.from(atob(text),value=>value.charCodeAt(0));
      const ram=new Uint8Array(2*1024*1024),coverage=new Uint8Array(ram.length);
      ram.set(bytes,0x10000);coverage.fill(1,0x10000,0x10000+bytes.length);
      const image={ram,coverage,pc:0x80010000,gp:0x80020000,sp:0x801fff00,refresh:60};
      const core=await createPsfPlaybackCore({image});let measured;
      try{const pcm=core.render(8820);measured={backend:core.backend,frozen:Object.isFrozen(core.backend),finite:pcm.every(Number.isFinite),peak:pcm.reduce((a,b)=>Math.max(a,Math.abs(b)),0)};}
      finally{core.dispose();}
      let allocations=0,error='';
      try{await createPsfPlaybackCore({image,moduleOptions:{onRuntimeInitialized(){
        this._psf_abi_version=()=>1;const malloc=this._malloc;
        this._malloc=(...args)=>{allocations++;return malloc(...args);};
      }}});}catch(reason){error=reason.message;}
      return {...measured,staleAbi:{allocations,error}};
    },fixture.textBase64);
    assert.deepEqual(measurements.backend.backend,{abi:2,engine:'play-hle+mame-ps1-spu',sampleRate:44100});
    assert(measurements.backend.frozen&&measurements.backend.finite&&measurements.backend.peak>.001);
    assert.equal(measurements.backend.staleAbi.allocations,0);assert.match(measurements.backend.staleAbi.error,/out of date/);
    assert.equal((await graph(page)).contexts,0,'numeric core checks do not open an audio device');
    step('Public PSF import lists executable entries without starting audio and preserves the existing VAB selection');
    await choose(page,'#loadVab','vabFileInput',path.join(repo,'docs/playground/samples/spu-import/spu-synth-demo.vab'));
    await until(()=>page.locator('#loadVabTone').isEnabled(),'VAB parsed');
    assert(await page.locator('#psfSongPlayer').isHidden(),'opening a VAB bank alone does not show song controls');
    const banks=await page.locator('#vabBank').innerHTML(),tones=await page.locator('#vabTone').innerHTML();
    await choose(page,'#loadPsf','psfFileInput',fixture.files);
    await until(async()=>await page.locator('#psfEntry option').count()===2&&await page.locator('#psfPlaySong').isEnabled(),'PSF entries accepted');
    const initial=await graph(page);assert.equal(initial.contexts,0);assert.equal(initial.bufferStarts,0);assert.equal(initial.destinationConnections,0);assert(initial.muted);
    assert.equal(await page.locator('#vabBank').innerHTML(),banks);assert.equal(await page.locator('#vabTone').innerHTML(),tones);
    assert.equal(await page.locator('#instrumentTab-bank').getAttribute('aria-selected'),'true');
    step('One compact song list stays above the monitor in every instrument tab and at desktop / mobile widths');
    for(const tab of ['pcm','adsr','fx','audio','bank']){
      await page.locator(`[data-spu-editor-tab="${tab}"]`).click();
      assert(await page.locator('#psfSongPlayer').isVisible(),`song controls remain visible in ${tab}`);
      const order=await page.evaluate(()=>document.getElementById('psfSongPlayer').getBoundingClientRect().bottom<=document.getElementById('spuMonitor').getBoundingClientRect().top+1);
      assert(order,`${tab}: song list precedes the monitor`);
    }
    for(const width of [1240,390])layouts.push(await songLayout(page,name,width));
    await page.setViewportSize({width:1240,height:1050});
    await page.locator('#startAudio').click();await until(()=>page.locator('#startAudio').textContent().then(value=>value==='Audio ready'),'editor audio enabled');
    const authored=await instrument(page),before=await graph(page);await silent(page);
    step('Play schedules real stereo PSF PCM on the editor output and wakes its monitor');
    await play(page);measurements.playing=await sounding(page);
    await until(async()=>(await graph(page)).monitorStrokes>before.monitorStrokes+3,'PSF monitor draws');
    const playing=await graph(page);assert.equal(playing.contexts,1);assert.equal(playing.editorWorklets,1);assert.equal(playing.destinationConnections,1);assert(playing.bufferStarts>0);
    assert((await page.evaluate(()=>__spuPsfAudit.starts())).every(item=>item.rate===44100),'PSF buffers retain the native stereo sample rate');
    await page.screenshot({path:path.join(config.screenshots,`${name}-psf-playing.png`),fullPage:true});
    step('Pause stops output and scheduling; Resume advances from the retained playback position');
    await page.locator('#psfPauseSong').click();await until(()=>page.locator('#psfPauseSong').textContent().then(value=>value==='Resume'),'Resume label');
    const pausedAt=await position(page),pausedGraph=await graph(page);await wait(180);
    assert.equal(await position(page),pausedAt,'paused sample position is frozen');assert.equal((await graph(page)).bufferStarts,pausedGraph.bufferStarts,'Pause schedules no new buffers for more than 100 ms');await silent(page);
    await page.screenshot({path:path.join(config.screenshots,`${name}-psf-paused.png`),fullPage:true});
    await page.locator('#psfPauseSong').click();await until(async()=>await position(page)>pausedAt+.08,'Resume position advances');measurements.resumed=await sounding(page);
    assert.equal(await page.locator('#psfPauseSong').textContent(),'Pause');
    step('Stop keeps the authored instrument and the independent VAB extraction controls');
    await page.locator('#psfStopSong').click();await stopped(page);await silent(page);assert.deepEqual(await instrument(page),authored);
    assert.equal(await page.locator('#extractPsf').isEnabled(),true);assert.equal(await page.locator('#psfEntry').isEnabled(),true);
    assert.equal(await page.locator('#vabBank').innerHTML(),banks);assert.equal(await page.locator('#vabTone').innerHTML(),tones);
    step('Changing the PSF entry stops its old preview; malformed imports retain the accepted entry and instrument');
    await play(page);await page.locator('#psfEntry').selectOption('second.psf');await stopped(page);await silent(page);
    assert.equal(await page.locator('#psfEntry').inputValue(),'second.psf');assert.deepEqual(await instrument(page),authored);
    await choose(page,'#loadPsf','psfFileInput',{name:'broken.psf',mimeType:'application/octet-stream',buffer:fixture.broken});
    await until(()=>page.locator('#vabStatus').getAttribute('data-error').then(value=>value==='true'),'bad PSF reports an error');
    assert.equal(await page.locator('#psfEntry').inputValue(),'second.psf');assert.equal(await page.locator('#psfEntry option').count(),2);
    assert.equal(await page.locator('#psfPlaySong').isEnabled(),true);assert.deepEqual(await instrument(page),authored);
    step('A quick keyboard release while song Stop is pending never leaves an orphaned note');
    await play(page);await page.locator('#synthInputKeyboardTab').click();await page.locator('#synthTitle').click();
    const delayed=(await graph(page)).stopDelays;await page.evaluate(()=>__spuPsfAudit.armStopDelay(180));
    await page.keyboard.down('a');await until(async()=>(await graph(page)).stopDelays===delayed+1,'keyboard awaits song Stop');
    await page.keyboard.up('a');await stopped(page);await wait(220);
    const keyboardState=await page.evaluate(()=>__spuPsfAudit.read());assert.equal(keyboardState.auditions.length,0,'released key has no retained audition');
    assert.equal(await page.locator('.key.is-active').count(),0);await silent(page);
    step('Code Run retires the song; starting another song stops Code and returns its authored instrument');
    await play(page);await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    await page.locator('#synthCodeEditor').fill(`const ps1=await useSoundChip('ps1');\nawait ps1.noteOn(CH1,'C4');\nlog('psf-code-owner');`);
    await page.locator('#synthCodeRunButton').click();await until(async()=>{
      const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running/.test(await page.locator('#synthCodeState').textContent());
    },'Code starts');await stopped(page);
    await play(page);await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'song stops Code');
    measurements.afterCode=await sounding(page);assert.deepEqual(await instrument(page),authored);
    await page.locator('#stopAudio').click();await stopped(page);await silent(page);assert.deepEqual(await instrument(page),authored);
    step('Folder import lists PSF / MiniPSF songs with its physical folder name and shares selection with VAB extraction');
    await choose(page,'#loadPsfFolder','psfFolderInput',fixture.folder);
    await until(async()=>await page.locator('#psfEntry option').count()===2&&await page.locator('#psfSongFolder').textContent().then(value=>value.trim()==='Songs'),'folder songs and folder name');
    const entries=await page.locator('#psfEntry option').evaluateAll(options=>options.map(option=>({value:option.value,text:option.textContent})));
    assert(entries.every(entry=>!/\.(?:psflib|psf1lib)(?:$|\s)/i.test(entry.value)),'PSFLib dependencies are not listed as songs');
    assert(entries.some(entry=>/standalone\.psf$/i.test(entry.value)),'standalone PSF appears');
    const bankEntry=entries.find(entry=>/track\.minipsf$/i.test(entry.value));assert(bankEntry,'MiniPSF appears');
    await page.locator('#psfEntry').selectOption(bankEntry.value);
    await page.locator('[data-spu-editor-tab="bank"]').click();await page.locator('#extractPsf').click();
    await until(()=>page.locator('#vabStatus').textContent().then(value=>value.startsWith('Extracted 2 VAB banks')),'selected MiniPSF drives bank extraction');
    assert.equal(await page.locator('#vabBank option').count(),2);assert(await page.locator('#loadVabTone').isEnabled());
    assert.equal(await page.locator('#psfEntry').inputValue(),bankEntry.value);assert.deepEqual(await instrument(page),authored);
    await silent(page);
    await choose(page,'#loadPsf','psfFileInput',fixture.library);
    await until(()=>page.locator('#psfSongLabel').textContent().then(value=>value==='Library'),'library-only selection is identified');
    assert.equal(await page.locator('#psfEntry option').count(),1);assert.equal(await page.locator('#psfPlaySong').isEnabled(),false,'a PSFLib alone cannot be played as a song');
    assert(await page.locator('#extractPsf').isEnabled(),'library-only sets retain static extraction');
    await page.locator('#extractPsf').click();await until(()=>page.locator('#vabStatus').textContent().then(value=>value.startsWith('Extracted 2 VAB banks')),'library-only bank extraction');
    assert.deepEqual(await instrument(page),authored);await silent(page);
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);const final=await graph(page);assert(final.muted);assert.equal(final.contexts,1);
    return {browser:name,passed:true,checks,measurements,layouts,folderEntries:entries,graph:final,errors,consoleErrors,expectedFallbackConsole:expectedConsole};
  }catch(error){error.receipt={browser:name,stage,checks,errors,consoleErrors,body:await page.locator('body').innerText().catch(()=>''),graph:await graph(page).catch(()=>null),pcm:await page.evaluate(()=>__spuPsfAudit.output()).catch(()=>null)};throw error;}
  finally{await page.close();}
}
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    if(/psf[_-](?:player|playback_core)\.(?:js|wasm)$/.test(pathname))psfRequests.push(request.url);
    const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep),'outside root');
    const bytes=await fs.readFile(filename),relative=path.relative(config.root,filename).split(path.sep).join('/'),record={bytes:bytes.length,sha256:hash(bytes)};
    if(served.has(relative))assert.deepEqual(served.get(relative),record,'source changed');served.set(relative,record);response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream'}).end(bytes);
  }catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
(async()=>{
  await fs.mkdir(config.screenshots,{recursive:true});
  const {createPsfPlaybackFixture}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_playback_fixture.mjs')).href);
  const {createPsfFixture}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_fixture.mjs')).href);
  const first=createPsfPlaybackFixture(),second=createPsfPlaybackFixture({pitch:0x1800}),broken=Buffer.from(first.standalone);broken[16]^=1;
  const temporary=await fs.mkdtemp(path.join(tmpdir(),'tetorica-psf-song-list-')),folder=path.join(temporary,'Songs');
  await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'standalone.psf'),first.standalone);
  for(const file of createPsfFixture().files){const target=path.join(folder,file.webkitRelativePath||file.name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,Buffer.from(await file.arrayBuffer()));}
  await fs.writeFile(path.join(folder,'README.txt'),'Original synthetic fixtures only. Not a PSF dependency.\n');
  const fixture={textBase64:Buffer.from(first.text).toString('base64'),files:[{name:'first.psf',mimeType:'application/octet-stream',buffer:Buffer.from(first.standalone)},
    {name:'second.psf',mimeType:'application/octet-stream',buffer:Buffer.from(second.standalone)}],broken,folder,
    library:{name:'Bank.psflib',mimeType:'application/octet-stream',buffer:Buffer.from(createPsfFixture().library)}};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{} )});try{results.push(await check(browser,name,origin,fixture));}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
    for(const asset of ['psf_playback_core.js','psf_player.js','psf_player.wasm']) {
      const urls=psfRequests.filter(url=>new URL(url,origin).pathname.endsWith('/'+asset));
      assert(urls.length,asset+' was fetched locally');assert(urls.every(url=>new URL(url,origin).searchParams.get('v')==='psf-mame-spu-1'),asset+' has the matching cache identity');
    }
    const report={schemaVersion:1,passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,
      fixture:{authored:true,gameAssets:false,firstSha256:hash(fixture.files[0].buffer),secondSha256:hash(fixture.files[1].buffer)},
      results,missing,external,httpErrors,psfRequests,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('PASS receipt '+config.out);
  }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack??error);if(error.receipt)console.error(JSON.stringify(error.receipt,null,2));process.exitCode=1;});
