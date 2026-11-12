// SPDX-License-Identifier: BSD-3-Clause
// Separated VH/VB and one-shot LOOP START checks. All Web Audio destination
// connections are intercepted before the app starts and physically gain-zeroed.
// Optional --real-arc selects a local user-owned PSF set; only metadata/hashes
// enter the report. No game bytes, audio buffers, BIOS or recordings are saved.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'spu-synth-split-vab-browser.json'),screenshots:path.join(tmpdir(),'spu-synth-split-vab-browser'),realArc:null};
for(let i=0,args=process.argv.slice(2);i<args.length;i++){
  const match=/^--(root|entry|engines|out|screenshots|real-arc)(?:=(.*))?$/.exec(args[i]);assert(match,'Unknown argument '+args[i]);
  const value=match[2]??args[++i];assert(value&&!value.startsWith('--'),'Missing '+match[1]);config[match[1]==='real-arc'?'realArc':match[1]]=value;
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const served=new Map(),missing=[],external=[],blockedMonaco=[],httpErrors=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(fn,label,ms=30000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await wait(25);}throw Error('Timeout: '+label);}
function silentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,Worklet=window.AudioWorkletNode,post=MessagePort.prototype.postMessage;
  const contexts=[],meters=[],nodes=[];let sequence=0,presetRequests=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...ports){
    if(destination!==this.context.destination)return connect.call(this,destination,...ports);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...ports);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(message,...args){if(message?.method==='setInstrumentPreset')presetRequests++;return post.call(this,message,...args);};
  async function read(method='inspect',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-spu-synth')?.node;if(!node)throw Error('Editor Worklet missing');const id=--sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SPU audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});
  }
  let numericModules;
  async function analyzeNative(){
    const source=await read('getInstrument',[0]),script=document.querySelector('script[type="module"][src*="synth.js"]').src;
    numericModules??=Promise.all([import(new URL('../js/ps1_spu.js',script).href),import(new URL('../js/ps1synth.js',script).href),import(new URL('../generated/ps1_spu_wasm.js',script).href),fetch(new URL('../generated/ps1_spu_wasm.wasm',script)).then(response=>{if(!response.ok)throw Error('Native numerical WASM missing');return response.arrayBuffer();})]);
    const [{Ps1Spu},{Ps1Synth},factory,wasmBinary]=await numericModules;
    const core=await Ps1Spu.create({moduleFactory:factory.default,moduleOptions:{wasmBinary}}),synth=new Ps1Synth({core});
    try{
      const {adpcm,...options}=source.sample,sample=synth.loadADPCM(new Uint8Array(adpcm),options);
      synth.setPreset(0,{...source.preset,sample});synth.keyOn(0);
      const frames=Math.max(8192,Math.ceil(adpcm.length/16*28*4096/(source.preset.pitch||4096))+512);
      const left=new Float32Array(frames),right=new Float32Array(frames);synth.renderInto(left,right);
      let peak=0,tailPeak=0,finite=true;
      for(let frame=0;frame<left.length;frame++){for(const value of [left[frame],right[frame]]){finite&&=Number.isFinite(value);peak=Math.max(peak,Math.abs(value));if(frame>=left.length-256)tailPeak=Math.max(tailPeak,Math.abs(value));}}
      return{frames:left.length,peak,tailPeak,finite,envelope:core.read(12),ended:!!(core.read(0x19c)&1),loop:sample.loop,adpcmBytes:adpcm.length};
    }finally{synth.dispose();}
  }
  window.__spuSplitAudit={read,analyzeNative,
    graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(item=>item.name==='tetorica-spu-synth').length,destinationConnections:meters.length,muted:meters.every(item=>item.mute.gain.value===0),presetRequests}),
    async instrument(){const result=await read('getInstrument',[0]);delete result.preset.sample;return JSON.parse(JSON.stringify(result,(_key,value)=>ArrayBuffer.isView(value)?Array.from(value):value));},
    output(){let peak=0;for(const {analyser} of meters){const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);for(const value of pcm)peak=Math.max(peak,Math.abs(value));}return{peak,muted:meters.every(item=>item.mute.gain.value===0)};}};
}
const graph=page=>page.evaluate(()=>__spuSplitAudit.graph()),instrument=page=>page.evaluate(()=>__spuSplitAudit.instrument());
async function noAudio(page){const value=await graph(page);assert.equal(value.contexts,0);assert.equal(value.editorWorklets,0);assert.equal(value.destinationConnections,0);assert(value.muted);}
async function choose(page,selector,input,files){
  if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const pending=page.waitForEvent('filechooser');await page.locator(selector).click();const picker=await pending;
  assert.equal(await picker.element().getAttribute('id'),input);await picker.setFiles(files);
}
async function openPsf(page,files){await choose(page,'#loadPsf','psfFileInput',files);await until(()=>page.locator('#vabStatus').textContent().then(value=>value.startsWith('Opened ')),'PSF set accepted');}
async function extract(page,success=true){
  await page.locator('#extractPsf').click();await until(async()=>await page.locator('#extractPsf').isEnabled()&&await page.locator('#vabStatus').textContent().then(value=>success?value.startsWith('Extracted '):value.startsWith('No standard VAB found')||value.startsWith('PSF:')),'VAB extraction settles');
}
async function loadTone(page,index){
  await page.locator('#vabTone').selectOption(String(index));const label=await page.locator('#vabTone option:checked').textContent(),match=/Program (\d+) · Tone (\d+)/.exec(label);assert(match);
  const before=(await graph(page)).presetRequests;
  await page.locator('#loadVabTone').click();await until(async()=>(await graph(page)).presetRequests>before&&await page.locator('#vabStatus').textContent().then(value=>value.startsWith('Loaded '))&&await page.locator('#instrumentName').inputValue().then(value=>value.endsWith(`P${match[1]} T${match[2]}`)),'Tone loaded');return instrument(page);
}
async function saveSound(page){
  const before=await page.locator('#spuFilesSelected').textContent();await page.locator('#saveSoundToFiles').click();
  await until(async()=>await page.locator('#spuFilesPanel').isVisible()&&await page.locator('#spuFilesSelected').textContent()!==before&&await page.locator('#spuFilesStatus').textContent().then(value=>value.startsWith('Current SPU instrument')&&value.includes('saved')),'preset saved');
  return{path:await page.locator('#spuFilesSelected').textContent(),sound:JSON.parse(await page.locator('#synthCodeEditor').inputValue())};
}
async function selectPreset(page,filename){
  if(await page.locator('#spuFilesPanel').isHidden())await page.locator('#spuFilesToggle').click();
  const directory=page.locator('#spuFilesTree summary[data-file-path="/presets"]');if(await directory.count()&&!await directory.evaluate(node=>node.parentElement.open))await directory.click();
  await page.locator('#spuFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();
  await until(()=>page.locator('#spuFilesStatus').textContent().then(value=>value.startsWith('SPU sound loaded.')),'preset applied');return instrument(page);
}
async function layout(page,name,width){
  await page.setViewportSize({width,height:1050});await page.locator('#psfSongPlayer').scrollIntoViewIfNeeded();
  const value=await page.evaluate(()=>{const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom};};return{viewport:innerWidth,document:document.documentElement.scrollWidth,player:box('psfSongPlayer'),monitor:box('spuMonitor'),extract:box('extractPsf')};});
  assert(value.document<=width+1,'document fits viewport');assert(value.player.bottom<=value.monitor.top+1);assert(value.extract.left>=-1&&value.extract.right<=width+1);
  await page.screenshot({path:path.join(config.screenshots,`${name}-split-vab-${width}.png`),fullPage:true});return value;
}
async function check(browser,name,origin,fixture,prepareVabTone,real){
  const page=await browser.newPage({viewport:{width:1240,height:1050},serviceWorkers:'block'});page.setDefaultTimeout(30000);
  const checks=[],errors=[],consoleErrors=[],expectedConsole=[],measurements=[],layouts=[],realTones=[];let stage='startup';
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()!=='error')return;const text=message.text(),url=message.location().url;if(/cdnjs\.cloudflare\.com/.test(text+' '+url)||/^Failed to load resource/.test(text)&&blockedMonaco.length)expectedConsole.push(text);else consoleErrors.push(text);});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(silentAudit);const step=text=>{stage=text;checks.push(text);console.log(`CHECK ${name}: ${text}`);};
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files ready');
    step('Unique separated VH / VB resolves all synthetic Tones without creating audio');
    await openPsf(page,fixture.uniqueFiles);await page.locator('#instrumentTab-pcm').click();await extract(page);
    assert.equal(await page.locator('#instrumentTab-bank').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#vabBank option').count(),1);
    assert.equal(await page.locator('#vabTone option').count(),fixture.unique.bank.tones.length);assert.equal(await page.locator('#vabTone option:disabled').count(),0);await noAudio(page);
    step('Loaded split-bank packets match their authored source and one-shot LOOP START reaches hardware END');
    let oneShot=null,oneShotIndex=null;
    for(let index=0;index<fixture.unique.bank.tones.length;index++){
      const expected=prepareVabTone(fixture.unique.bank,index),actual=await loadTone(page,index);
      assert.equal(hash(Buffer.from(actual.sample.adpcm)),hash(expected.adpcm),'synthetic sample bytes match');
      assert.equal(actual.sample.baseFrequencyHz,expected.options.baseFrequencyHz);assert.equal(actual.sample.loopStartSamples,expected.options.loopStartSamples);
      assert.equal(actual.preset.adsr1,expected.preset.adsr1);assert.equal(actual.preset.adsr2,expected.preset.adsr2);
      const measured=await page.evaluate(()=>__spuSplitAudit.analyzeNative());assert(measured.finite);assert(measured.peak>1e-7,'the authored sample produces numerical PCM');
      if(!measured.loop){assert(measured.ended);assert(measured.tailPeak<1e-7);oneShot=actual;oneShotIndex=index;}
      else assert(measured.tailPeak>1e-7,'the authored loop keeps playing after its first END');
      measurements.push({tone:index,adpcmBytes:actual.sample.adpcm.length,adpcmSha256:hash(Buffer.from(actual.sample.adpcm)),...measured});
    }
    assert(oneShot&&oneShotIndex!==null,'fixture contains a one-shot with LOOP START');
    assert(oneShot.sample.adpcm.some((byte,index)=>index%16===1&&(byte&4)),'LOOP START was preserved');
    await page.locator('h1').click();await page.keyboard.down('y');await until(()=>page.evaluate(async()=>{const state=await __spuSplitAudit.read();return state.auditions.length>0;}),'physical keyboard note');
    await wait(180);const held=await page.evaluate(()=>__spuSplitAudit.read());for(const audition of held.auditions)assert(held.channels[audition.channel].ended);
    assert((await page.evaluate(()=>__spuSplitAudit.output())).peak<1e-7,'hardware END is silent even while the physical key is held');
    await page.keyboard.up('y');await page.locator('#stopAudio').click();
    step('One-shot preset saving and Files recall preserve its original flags, envelope and tuning');
    await loadTone(page,oneShotIndex);const saved=await saveSound(page);assert.equal(hash(Buffer.from(saved.sound.sample.adpcm)),hash(Buffer.from(oneShot.sample.adpcm)));
    await page.locator('#resetPreset').click();await until(()=>page.locator('#instrumentName').inputValue().then(value=>value==='Sine'),'Sine reset');
    const restored=await selectPreset(page,saved.path);assert.deepEqual(restored,oneShot);const repeat=await page.evaluate(()=>__spuSplitAudit.analyzeNative());assert(repeat.finite&&repeat.peak>1e-7);assert(repeat.ended&&repeat.tailPeak<1e-7);
    step('Ambiguous or missing separated bodies retain the accepted bank and edited instrument');
    const bankHtml=await page.locator('#vabBank').innerHTML(),toneHtml=await page.locator('#vabTone').innerHTML(),before=await instrument(page);
    for(const [kind,files]of [['ambiguous',fixture.ambiguousFiles],['missing',fixture.missingFiles]]){
      await openPsf(page,files);await extract(page,false);assert.equal(await page.locator('#vabBank').innerHTML(),bankHtml);assert.equal(await page.locator('#vabTone').innerHTML(),toneHtml);assert.deepEqual(await instrument(page),before);assert.match(await page.locator('#vabStatus').textContent(),/No standard VAB|ambiguous|missing|not fully loaded|no.*body/i,kind);
    }
    step('Unavailable Tones expose their reason in the picker and an expandable bank summary');
    const beforeReason=await instrument(page),beforeReasonGraph=await graph(page);
    await choose(page,'#loadVab','vabFileInput',fixture.reasonVab);
    await until(()=>page.locator('#vabStatus').textContent().then(value=>value.includes(fixture.reasonVab.name)&&value.includes('programs')),'partial bank opened');
    assert.equal(await page.locator('#vabTone option').count(),3);assert.equal(await page.locator('#vabTone option:disabled').count(),1);
    assert.match(await page.locator('#vabAvailability').textContent(),/^2 \/ 3 Tones available/);
    assert.match(await page.locator('#vabTone option:disabled').textContent(),/unavailable:.*Noise/i);
    assert(await page.locator('#vabUnavailableDetails').isVisible());await page.locator('#vabUnavailableDetails summary').click();
    assert(await page.locator('#vabUnavailableDetails').evaluate(node=>node.open));assert.match(await page.locator('#vabUnavailableReasons').innerText(),/Noise/);
    assert.deepEqual(await instrument(page),beforeReason);assert.deepEqual(await graph(page),beforeReasonGraph,'opening a bank and its reasons does not acquire or change audio');
    step('The split-bank workflow fits desktop and mobile layouts');
    for(const width of [1240,390])layouts.push(await layout(page,name,width));await page.setViewportSize({width:1240,height:1050});
    if(real){
      step('The local Arc the Lad entry exposes all ten correctly paired Tones with exact sample hashes');
      await openPsf(page,real.files);await extract(page);assert.equal(await page.locator('#vabBank option').count(),1);assert.equal(await page.locator('#vabTone option').count(),10);assert.equal(await page.locator('#vabTone option:disabled').count(),0);
      assert.match(await page.locator('#vabAvailability').textContent(),/^10 \/ 10 Tones available/);assert(await page.locator('#vabUnavailableDetails').isHidden());
      assert.match(await page.locator('#vabBank option:checked').textContent(),/(?:800)?90000/i,'the UI exposes the separate VB address');
      for(let index=0;index<10;index++){
        const expected=prepareVabTone(real.bank,index),actual=await loadTone(page,index);
        const digest=hash(Buffer.from(actual.sample.adpcm));assert.equal(digest,hash(expected.adpcm),'real sample hash matches the separately located source');
        assert.equal(actual.sample.baseFrequencyHz,expected.options.baseFrequencyHz);assert.equal(actual.sample.loopStartSamples,expected.options.loopStartSamples);assert.equal(actual.preset.adsr1,expected.preset.adsr1);assert.equal(actual.preset.adsr2,expected.preset.adsr2);
        const measured=await page.evaluate(()=>__spuSplitAudit.analyzeNative());assert(measured.finite);
        if(!measured.loop){assert(measured.ended&&measured.tailPeak<1e-7);}
        realTones.push({program:expected.tone.program,tone:expected.tone.index,sample:expected.tone.sample,adpcmBytes:actual.sample.adpcm.length,adpcmSha256:digest,baseFrequencyHz:actual.sample.baseFrequencyHz,adsr1:actual.preset.adsr1,adsr2:actual.preset.adsr2,...measured});
      }
      assert(realTones.some(value=>value.peak>1e-7),'at least one real Tone produces nonzero numerical PCM');
      await page.locator('#instrumentPanel-bank').screenshot({path:path.join(config.screenshots,`${name}-arc-bank-metadata.png`)});
    }
    await page.locator('#stopAudio').click();await wait(80);const finalGraph=await graph(page);assert(finalGraph.muted);assert.equal(finalGraph.contexts,1);assert.equal(finalGraph.editorWorklets,1);assert.equal(finalGraph.destinationConnections,1);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,measurements,layouts,realTones,savedPreset:{path:saved.path,adpcmBytes:saved.sound.sample.adpcm.length,adpcmSha256:hash(Buffer.from(saved.sound.sample.adpcm))},graph:finalGraph,errors,consoleErrors,expectedFallbackConsole:expectedConsole};
  }catch(error){error.receipt={browser:name,stage,checks,errors,consoleErrors,status:await page.locator('#vabStatus').textContent().catch(()=>''),graph:await graph(page).catch(()=>null)};throw error;}
  finally{await page.close();}
}
const server=http.createServer(async(request,response)=>{
  try{const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep),'outside root');
    const bytes=await fs.readFile(filename),relative=path.relative(config.root,filename).split(path.sep).join('/'),record={bytes:bytes.length,sha256:hash(bytes)};if(served.has(relative))assert.deepEqual(served.get(relative),record,'source changed');served.set(relative,record);response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream'}).end(bytes);
  }catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
(async()=>{
  await fs.mkdir(config.screenshots,{recursive:true});
  const {createPsfSplitVabFixture}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_psf_split_vab_fixture.mjs')).href);
  const {readVab,prepareVabTone}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_ps1_vab.js')).href);
  const {createVabFixture}=await import(pathToFileURL(path.join(repo,'test/helpers/spu_vab_fixture.mjs')).href);
  const payloads=async value=>Promise.all(value.files.map(async file=>({name:file.name,mimeType:'application/octet-stream',buffer:Buffer.from(await file.arrayBuffer())})));
  const unique=createPsfSplitVabFixture(),ambiguous=createPsfSplitVabFixture({duplicateBody:true}),empty=createPsfSplitVabFixture({missingBody:true});
  unique.bank??=readVab(unique.vh,unique.vb);
  const reason=createVabFixture();new DataView(reason.vab.buffer).setUint16(0x840+22,255,true);
  const fixture={unique,uniqueFiles:await payloads(unique),ambiguousFiles:await payloads(ambiguous),missingFiles:await payloads(empty),
    reasonVab:{name:'unavailable-noise.vab',mimeType:'application/octet-stream',buffer:Buffer.from(reason.vab)}};
  let real=null;
  if(config.realArc){
    const directory=path.resolve(config.realArc),names=['Arc_The_Lad_psf_driver.psflib','30 - Alatos.minipsf'];
    const records=await Promise.all(names.map(async name=>{const data=await fs.readFile(path.join(directory,name));return{name,data};}));
    const {readPsfFileSet,composePsfRam}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_ps1_psf.js')).href);
    const files=records.map(item=>({name:item.name,size:item.data.length,arrayBuffer:async()=>item.data.buffer.slice(item.data.byteOffset,item.data.byteOffset+item.data.length)}));
    const image=await composePsfRam(await readPsfFileSet(files),'30 - Alatos.minipsf');
    real={files:names.map(name=>path.join(directory,name)),bank:readVab(image.ram.subarray(0x80000,0x80000+6688),image.ram.subarray(0x90000,0x90000+72768)),
      metadata:records.map(item=>({name:item.name,bytes:item.data.length,sha256:hash(item.data)}))};
  }
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{} )});try{results.push(await check(browser,name,origin,fixture,prepareVabTone,real));}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);
    await fs.writeFile(config.out,JSON.stringify({schemaVersion:1,passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,
      fixture:{authored:true,gameAssets:false,psfSha256:hash(fixture.uniqueFiles[0].buffer)},realInput:real?{metadataOnly:true,files:real.metadata}:null,results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');console.log('PASS receipt '+config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack??error);if(error.receipt)console.error(JSON.stringify(error.receipt,null,2));process.exitCode=1;});
