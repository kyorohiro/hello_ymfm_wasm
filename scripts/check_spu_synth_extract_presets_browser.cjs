// SPDX-License-Identifier: BSD-3-Clause
// Public Extract VAB -> named preset -> Files recall checks. Install the
// destination gain-zero interception before any application script runs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'spu-synth-extract-presets-browser.json'),screenshots:path.join(tmpdir(),'spu-synth-extract-presets-browser')};
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
  const match=/^--(root|entry|engines|out|screenshots)(?:=(.*))?$/.exec(args[i]);assert(match,'Unknown argument '+args[i]);
  const value=match[2]??args[++i];assert(typeof value==='string'&&value&&!value.startsWith('--'),'Missing '+match[1]);config[match[1]]=value;
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const served=new Map(),missing=[],external=[],blockedMonaco=[],httpErrors=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(fn,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await wait(25);}throw Error('Timeout: '+label);}
function silentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,Worklet=window.AudioWorkletNode,post=MessagePort.prototype.postMessage;
  const contexts=[],meters=[],nodes=[],commands=[];let sequence=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...ports){
    if(destination!==this.context.destination)return connect.call(this,destination,...ports);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...ports);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(message,...args){if(message?.method)commands.push({method:message.method,args:message.args});return post.call(this,message,...args);};
  async function read(method='inspect',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-spu-synth')?.node;if(!node)throw Error('SPU editor Worklet missing');const id=--sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SPU audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});
  }
  window.__spuExtractAudit={read,commands:()=>commands.slice(),graph:()=>({contexts:contexts.length,editorWorklets:nodes.length,destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0)}),
    async instrument(){const result=await read('getInstrument',[0]);delete result.preset.sample;return JSON.parse(JSON.stringify(result,(_key,value)=>ArrayBuffer.isView(value)?Array.from(value):value));},
    output(){let peak=0;for(const {analyser} of meters){const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);for(const sample of pcm)peak=Math.max(peak,Math.abs(sample));}return{peak,muted:meters.every(item=>item.mute.gain.value===0)};}};
}
const graph=page=>page.evaluate(()=>__spuExtractAudit.graph());
const instrument=page=>page.evaluate(()=>__spuExtractAudit.instrument());
async function noAudio(page){const state=await graph(page);assert.equal(state.contexts,0);assert.equal(state.editorWorklets,0);assert.equal(state.destinationConnections,0);assert(state.muted);}
async function choose(page,selector,input,files){
  if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const selection=page.waitForEvent('filechooser');await page.locator(selector).click();const picker=await selection;
  assert.equal(await picker.element().getAttribute('id'),input);await picker.setFiles(files);
}
async function extract(page){await page.locator('#extractPsf').click();await until(()=>page.locator('#vabStatus').textContent().then(value=>value.startsWith('Extracted 2 VAB banks')),'VAB banks extracted');}
async function loadTone(page,value){
  await page.locator('[data-spu-editor-tab="bank"]').click();await page.locator('#vabTone').selectOption(String(value));
  const option=await page.locator('#vabTone option:checked').textContent(),match=/Program (\d+) · Tone (\d+)/.exec(option);assert(match);
  await page.locator('#loadVabTone').click();await until(async()=>await page.locator('#vabStatus').textContent().then(value=>value.startsWith('Loaded '))&&await page.locator('#instrumentName').inputValue().then(value=>value.endsWith(`P${match[1]} T${match[2]}`)),'selected Tone loaded');return instrument(page);
}
async function nameSound(page,value){await page.locator('#instrumentName').fill(value);await page.locator('#instrumentName').press('Tab');}
async function saveSound(page){
  const before=await presetPaths(page);await page.locator('#saveSoundToFiles').click();
  await until(async()=>await page.locator('#spuFilesPanel').isVisible()&&(await presetPaths(page)).length===before.length+1,'named preset appears in Files');
  const filename=await page.locator('#spuFilesSelected').textContent();
  await until(()=>page.locator('#spuFilesStatus').textContent().then(value=>/Current SPU instrument.*saved/.test(value)&&value.includes(filename)),'named preset persistence completes');
  assert(filename.startsWith('/presets/')&&filename.endsWith('.spu.json'));assert.equal(filename.split('/').length,3,'saved name is one path component');
  return{path:filename,sound:JSON.parse(await page.locator('#synthCodeEditor').inputValue())};
}
async function presetPaths(page){return page.locator('#spuFilesTree button.file-entry').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-file-path')).filter(value=>value?.startsWith('/presets/')&&value.endsWith('.spu.json')));}
async function selectPreset(page,filename){
  if(await page.locator('#spuFilesPanel').isHidden())await page.locator('#spuFilesToggle').click();
  const directory=page.locator('#spuFilesTree summary[data-file-path="/presets"]');if(await directory.count()&&!await directory.evaluate(node=>node.parentElement.open))await directory.click();
  const entry=page.locator('#spuFilesTree button.file-entry').filter({hasText:path.posix.basename(filename)});
  // Similar names can include one another; match the actual path attribute.
  await entry.locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();
  await until(async()=>await page.locator('#spuFilesSelected').textContent().then(value=>value===filename)&&await page.locator('#spuFilesStatus').textContent().then(value=>value.startsWith('SPU sound loaded.')),'Files applies the saved sound');
  assert.equal(await page.locator('#spuFilesSelected').textContent(),filename);return instrument(page);
}
async function downloadProject(page){
  if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const pending=page.waitForEvent('download');await page.locator('#spuProjectExportButton').click();const file=await pending,chunks=[];
  for await(const chunk of await file.createReadStream())chunks.push(chunk);return Buffer.concat(chunks);
}
async function layout(page,name,width,filesVisible){
  await page.setViewportSize({width,height:1050});if(await page.locator('#spuFilesPanel').isVisible()!==filesVisible)await page.locator('#spuFilesToggle').click();
  await page.locator('#psfSongPlayer').scrollIntoViewIfNeeded();
  const value=await page.evaluate(()=>{const bounds=node=>{const box=node.getBoundingClientRect();return{left:box.left,right:box.right,top:box.top,bottom:box.bottom};};return{viewport:innerWidth,document:document.documentElement.scrollWidth,player:bounds(document.getElementById('psfSongPlayer')),extract:bounds(document.getElementById('extractPsf')),monitorTop:document.getElementById('spuMonitor').getBoundingClientRect().top};});
  assert(value.document<=width+1,'document fits the viewport');assert(value.player.bottom<=value.monitorTop+1,'controls remain above monitor');
  assert(value.extract.left>=-1&&value.extract.right<=width+1,'Extract VAB fits viewport');
  assert.equal(await page.locator('#psfSongPlayer #extractPsf').count(),1,'Extract VAB belongs to the song row');assert.equal(await page.locator('#extractPsf').count(),1);
  await page.locator('#psfSongPlayer').screenshot({path:path.join(config.screenshots,`${name}-extract-${width}-${filesVisible?'files':'normal'}.png`)});
  return{...value,filesVisible};
}
async function check(browser,name,origin,fixture,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block'});page.setDefaultTimeout(25000);
  const checks=[],errors=[],consoleErrors=[],expectedConsole=[],layouts=[],saved=[],largeRecalls=[];let stage='startup';
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()!=='error')return;const value=message.text(),url=message.location().url;if(/cdnjs\.cloudflare\.com/.test(value+' '+url)||/^Failed to load resource/.test(value)&&blockedMonaco.length)expectedConsole.push(value);else consoleErrors.push(value);});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(silentAudit);
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files initialization');
    step('The song-row Extract VAB opens its bank results from other tabs without creating audio or saving every Tone');
    await choose(page,'#loadPsf','psfFileInput',fixture.files);
    await until(()=>page.locator('#extractPsf').isEnabled(),'PSF set accepted');await page.locator('[data-spu-editor-tab="pcm"]').click();await extract(page);
    assert.equal(await page.locator('#instrumentTab-bank').getAttribute('aria-selected'),'true');assert(await page.locator('#instrumentPanel-bank').isVisible());assert.equal(await page.locator('#vabBank option').count(),2);assert.equal((await presetPaths(page)).length,0);await noAudio(page);
    await page.locator('[data-spu-editor-tab="fx"]').click();await extract(page);assert.equal(await page.locator('#instrumentTab-bank').getAttribute('aria-selected'),'true');await noAudio(page);
    for(const width of [1240,390])layouts.push(await layout(page,name,width,false));await page.setViewportSize({width:1240,height:1050});
    step('Two chosen Tones save as separate named presets and the Files list is revealed');
    const first=await loadTone(page,0);await nameSound(page,'Preset α');saved.push(await saveSound(page));
    assert.equal(saved[0].sound.name,'Preset α');assert(saved[0].path.includes('Preset α'));assert.equal(await page.locator('#spuFilesSelected').textContent(),saved[0].path);
    const second=await loadTone(page,2);assert.notDeepEqual(second.sample.adpcm,first.sample.adpcm,'the selected Tones have distinct ADPCM payloads');await nameSound(page,'Preset β');saved.push(await saveSound(page));assert.equal(saved[1].sound.name,'Preset β');assert.notEqual(saved[0].path,saved[1].path);
    step('Selecting each saved file restores its original ADPCM, envelope, tuning and instrument name');
    assert.deepEqual(await selectPreset(page,saved[0].path),first);assert.equal(await page.locator('#instrumentName').inputValue(),'Preset α');
    assert.deepEqual(await selectPreset(page,saved[1].path),second);assert.equal(await page.locator('#instrumentName').inputValue(),'Preset β');
    step('Repeated saves and a manually edited name retain previous files and add safe unique names');
    const before=JSON.stringify(saved[0].sound);await selectPreset(page,saved[0].path);saved.push(await saveSound(page));assert.notEqual(saved[2].path,saved[0].path);assert.equal(JSON.stringify(saved[2].sound),before);
    await nameSound(page,'手描き / sound?');saved.push(await saveSound(page));assert.equal(saved[3].sound.name,'手描き / sound?');assert(saved[3].path.includes('手描き'));assert(!saved[3].path.includes('..'));assert.equal(new Set(saved.map(item=>item.path)).size,4);
    const canonical=await instrument(page),bankHtml=await page.locator('#vabBank').innerHTML(),toneHtml=await page.locator('#vabTone').innerHTML();
    step('Cancelled imports and failed / empty extraction keep the accepted bank, saved files and current instrument');
    const entry=await page.locator('#psfEntry').inputValue();await choose(page,'#loadPsf','psfFileInput',[]);assert.equal(await page.locator('#psfEntry').inputValue(),entry);
    await choose(page,'#loadPsf','psfFileInput',fixture.noBank);await until(()=>page.locator('#psfEntry').inputValue().then(value=>value==='empty.psf'),'empty PSF accepted');await page.locator('#extractPsf').click();await until(()=>page.locator('#vabStatus').textContent().then(value=>value.startsWith('No standard VAB found')),'no-bank result');
    assert.equal(await page.locator('#vabBank').innerHTML(),bankHtml);assert.equal(await page.locator('#vabTone').innerHTML(),toneHtml);assert.deepEqual(await instrument(page),canonical);
    await choose(page,'#loadPsf','psfFileInput',fixture.missing);await until(()=>page.locator('#psfEntry').inputValue().then(value=>value==='missing.minipsf'),'missing dependency source accepted');await page.locator('#extractPsf').click();await until(()=>page.locator('#vabStatus').getAttribute('data-error').then(value=>value==='true'),'missing library reports extraction error');
    assert.equal(await page.locator('#vabBank').innerHTML(),bankHtml);assert.deepEqual(await instrument(page),canonical);assert.equal((await presetPaths(page)).length,4);
    step('Project ZIP and local reload retain all named presets without automatically starting audio');
    const archive=await downloadProject(page),cassette=await loadCassette(archive);assert(cassette.files.has('spu-synth.project.json'));
    for(const item of saved)assert.deepEqual(JSON.parse(Buffer.from(cassette.files.get(item.path.slice(1))).toString()),item.sound);
    for(const width of [1240,390])layouts.push(await layout(page,name,width,true));await page.setViewportSize({width:1240,height:1050});
    await page.screenshot({path:path.join(config.screenshots,`${name}-named-presets.png`),fullPage:true});
    const beforeReload=await graph(page);assert(beforeReload.muted);assert.equal(beforeReload.contexts,1);assert.equal(beforeReload.editorWorklets,1);
    await page.reload();await until(()=>page.locator('#spuFileImportButton').isEnabled(),'restored Files');assert(await page.locator('#spuFilesPanel').isVisible());await noAudio(page);
    assert.deepEqual((await presetPaths(page)).sort(),saved.map(item=>item.path).sort());await selectPreset(page,saved[0].path);assert.deepEqual(await instrument(page),first);assert.equal(await page.locator('#instrumentName').inputValue(),'Preset α');
    step('Recalling two 200 KiB presets reuses their existing SPU samples without consuming more RAM');
    await choose(page,'#spuFileImportButton','spuFilesInput',fixture.large.map(item=>item.file));
    await until(()=>page.locator('#spuFilesStatus').textContent().then(value=>/^Added 2 file/.test(value)),'large preset files imported');
    const originals=[];
    for(const item of fixture.large){
      const actual=await selectPreset(page,'/'+item.file.name),state=await page.evaluate(()=>__spuExtractAudit.read());
      assert.deepEqual(actual.sample.adpcm,item.sound.sample.adpcm,'the full large ADPCM payload is preserved');
      assert.equal(actual.sample.baseFrequencyHz,item.sound.sample.baseFrequencyHz);assert.equal(actual.sample.loopStartSamples,0);
      assert.equal(actual.preset.adsr1,item.sound.preset.adsr1);assert.equal(actual.preset.adsr2,item.sound.preset.adsr2);
      originals.push({sample:state.channels[0].sample,instrument:actual,saved:await saveSound(page)});
    }
    const stable=await page.evaluate(()=>__spuExtractAudit.read());
    for(const index of [0,1,0,1,0]){
      const expected=originals[index],actual=await selectPreset(page,expected.saved.path),state=await page.evaluate(()=>__spuExtractAudit.read());
      assert.deepEqual(actual,expected.instrument,'large preset ADPCM, tuning and ADSR are restored exactly');
      assert.equal(state.nextAddress,stable.nextAddress,'recall does not allocate another ADPCM copy');
      assert.equal(state.samples.length,stable.samples.length,'recall does not add a sample descriptor');
      assert.equal(state.channels[0].sample,expected.sample,'recall reuses the original sample ID');
      largeRecalls.push({path:expected.saved.path,sample:state.channels[0].sample,nextAddress:state.nextAddress,samples:state.samples.length,adpcmBytes:actual.sample.adpcm.length});
    }
    await page.locator('#stopAudio').click();await wait(100);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,savedPresets:saved.map(item=>({path:item.path,name:item.sound.name,adpcmBytes:item.sound.sample.adpcm.length})),largeRecalls,layouts,projectBytes:archive.length,graph:await graph(page),errors,consoleErrors,expectedFallbackConsole:expectedConsole};
  }catch(error){error.receipt={browser:name,stage,checks,saved:saved.map(item=>item.path),errors,consoleErrors,body:await page.locator('body').innerText().catch(()=>''),graph:await graph(page).catch(()=>null)};throw error;}
  finally{await page.close();}
}
const server=http.createServer(async(request,response)=>{
  try{const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep),'outside root');
    const bytes=await fs.readFile(filename),relative=path.relative(config.root,filename).split(path.sep).join('/'),record={bytes:bytes.length,sha256:hash(bytes)};if(served.has(relative))assert.deepEqual(served.get(relative),record,'source changed');served.set(relative,record);response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream'}).end(bytes);
  }catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
(async()=>{
  await fs.mkdir(config.screenshots,{recursive:true});
  const {createPsfFixture,makePsf}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_fixture.mjs')).href);
  const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href);
  const first=createPsfFixture(),payload=(name,data)=>({name,mimeType:'application/octet-stream',buffer:Buffer.from(data)});
  const fixture={files:[payload('demo.psf',first.standalone)],noBank:payload('empty.psf',makePsf(new Uint8Array(32))),missing:payload('missing.minipsf',makePsf(new Uint8Array(16),0x80010000,'_lib=absent.psflib\n')),
    large:[0,1].map(index=>{
      const adpcm=new Uint8Array(200*1024);
      for(let at=0;at<adpcm.length;at+=16){adpcm[at]=12;adpcm.fill(index?0x54:0x23,at+2,at+16);}
      adpcm[1]=6;adpcm[adpcm.length-15]=3;
      const sound={schema:'tetorica-spu-synth.instrument',version:1,name:`Large ${index?'B':'A'}`,
        preset:{volumeLeft:.5,volumeRight:.25,adsr1:index?0x1234:15,adsr2:index?0x44:0,pitch:4096,reverb:false},
        sample:{adpcm:Array.from(adpcm),baseFrequencyHz:index?660:440,loopStartSamples:0},
        reverb:{preset:'off',volumeLeft:.25,volumeRight:.25},waveform:null,morph:{enabled:false},noise:{enabled:false},pmon:{enabled:false}};
      return{sound,file:payload(`large-${index?'b':'a'}.spu.json`,Buffer.from(JSON.stringify(sound)))};
    })};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{} )});try{results.push(await check(browser,name,origin,fixture,loadPlaygroundCassette));}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
    await fs.writeFile(config.out,JSON.stringify({schemaVersion:1,passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,fixture:{authored:true,gameAssets:false,psfSha256:hash(fixture.files[0].buffer)},results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');console.log('PASS receipt '+config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack??error);if(error.receipt)console.error(JSON.stringify(error.receipt,null,2));process.exitCode=1;});
