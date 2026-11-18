// SPDX-License-Identifier: BSD-3-Clause
// Actual PC Engine media UI checks. As in check_pce_opna_new_cassette_browser,
// every speaker route is intercepted before app code and permanently muted.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),started=Date.now();
const config={root:path.join(repository,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',out:'',screenshots:'',compare:''};
const args=process.argv.slice(2);
for(let index=0;index<args.length;index++){
  const match=/^--(root|entry|engines|out|screenshots|compare)(?:=(.+))?$/.exec(args[index]);
  assert(match,'Unknown argument '+args[index]);config[match[1]]=match[2]??args[++index];assert(config[match[1]]);
}
config.root=path.resolve(config.root);config.out||=path.join(repository,'build/pce-media-auto-20261119/browser-source.json');
config.screenshots||=path.join(path.dirname(config.out),'images');assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),served=new Map(),sourceErrors=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(request,response)=>{
  try{
    let name=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(name==='/favicon.ico'){response.writeHead(204).end();return;}
    if(name.endsWith('/'))name+='index.html';const file=path.resolve(config.root,'.'+name);assert(file.startsWith(config.root+path.sep));
    const bytes=await fs.readFile(file),key=path.relative(config.root,file).split(path.sep).join('/'),record={bytes:bytes.length,sha256:sha(bytes)};
    if(served.has(key)&&served.get(key).sha256!==record.sha256){sourceErrors.push('Asset changed while served: '+key);throw Error(sourceErrors.at(-1));}
    served.set(key,record);response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch{response.writeHead(404).end();}
});

function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,open=indexedDB.open.bind(indexedDB),put=IDBObjectStore.prototype.put;
  const audit=window.__pceMediaAudit={contexts:[],gates:[],meters:[],databases:[],projectWrites:0};
  window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:48000});audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  AudioNode.prototype.connect=function(destination,...rest){
    if(destination!==this.context.destination)return connect.call(this,destination,...rest);
    const mute=this.context.createGain(),analyser=this.context.createAnalyser();mute.gain.value=0;analyser.fftSize=8192;
    connect.call(this,analyser);connect.call(this,mute);connect.call(mute,destination);audit.gates.push(mute);audit.meters.push(analyser);return destination;
  };
  indexedDB.open=(...args)=>{const request=open(...args);request.addEventListener('success',()=>audit.databases.push(request.result));return request;};
  IDBObjectStore.prototype.put=function(value,...args){if(this.name==='projects'&&value?.filesystem)audit.projectWrites++;return put.call(this,value,...args);};
  audit.graph=()=>({contexts:audit.contexts.length,rates:audit.contexts.map(item=>item.sampleRate),speakerRoutes:audit.gates.length,physicalOutputMuted:audit.gates.every(item=>item.gain.value===0)});
  audit.audio=()=>audit.meters.map(analyser=>{
    const pcm=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(pcm);let peak=0,square=0,maxStep=0;
    for(let i=0;i<pcm.length;i++){const value=pcm[i];if(!Number.isFinite(value))throw Error('Non-finite media output');peak=Math.max(peak,Math.abs(value));square+=value*value;if(i)maxStep=Math.max(maxStep,Math.abs(value-pcm[i-1]));}
    const amplitude=hz=>{let sine=0,cosine=0;for(let i=0;i<pcm.length;i++){const phase=i*2*Math.PI*hz/analyser.context.sampleRate;sine+=pcm[i]*Math.sin(phase);cosine+=pcm[i]*Math.cos(phase);}return 2*Math.hypot(sine,cosine)/pcm.length;};
    return{peak,rms:Math.sqrt(square/pcm.length),maxStep,hz440:amplitude(440),hz660:amplitude(660),hz880:amplitude(880),rate:analyser.context.sampleRate,physicalOutputMuted:audit.gates.every(item=>item.gain.value===0)};
  }).sort((a,b)=>b.rms-a.rms)[0]??{peak:0,rms:0,maxStep:0,hz440:0,hz660:0,hz880:0,physicalOutputMuted:true};
  audit.snapshot=async()=>{
    const db=audit.databases.findLast(item=>item.name==='tetorica-huc6280-synth-files');if(!db)return null;
    const value=await new Promise((resolve,reject)=>{const request=db.transaction('projects','readonly').objectStore('projects').get('current');request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});
    return JSON.parse(JSON.stringify(value,(_key,item)=>item instanceof Uint8Array?{$bytes:Array.from(item)}:item));
  };
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(value)return value;await wait(25);}throw Error('Timed out: '+label);}
const graph=page=>page.evaluate(()=>__pceMediaAudit.graph()),snapshot=page=>page.evaluate(()=>__pceMediaAudit.snapshot()),audio=page=>page.evaluate(()=>__pceMediaAudit.audio());
const media=[{key:'msm5205',tab:'#msm5205ChipTab',mount:'#msmTestPcm',source:'#msm5205Controls',play:'#msmPlay',stop:'#msmStop',stem:'MSM5205 test wave'},
  {key:'cdda',tab:'#cddaChipTab',mount:'#cddaTestPcm',source:'#cddaControls',play:'#cddaPlay',stop:'#cddaStop',stem:'CD-DA test wave'}];
const control=(item,name)=>'#'+item.key+'Test'+name,key=(page,name)=>page.locator('#keyboard .key[data-key="'+name+'"]');
const state=(page,item)=>page.locator(item.source).evaluate(node=>({...node.dataset}));
const playing=(page,item)=>until(()=>state(page,item).then(value=>value.sourceState==='playing'&&value.playPending!=='true'),'playing '+item.key);
const stopped=(page,item)=>until(()=>state(page,item).then(value=>value.sourceState!=='playing'&&value.playPending!=='true'),'stopped '+item.key);
async function blurInput(page){await page.locator('#synthTitle').click();await page.evaluate(()=>document.activeElement?.blur());}
async function range(page,item,name,value,{commit=false}={}){await page.locator(control(item,name)).evaluate((input,{value,commit})=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));if(commit)input.dispatchEvent(new Event('change',{bubbles:true}));},{value,commit});}
async function loaded(page,item){await until(()=>page.locator(item.mount).evaluate(node=>node.dataset.loading==='false'&&node.dataset.dirty==='false'),'persisted '+item.key+' test wave');assert.equal(await page.locator(control(item,'Status')).getAttribute('data-error'),'false');}
const fileBytes=file=>Buffer.from(file.data.$bytes??file.data);
async function file(page,item){return until(async()=>{const saved=await snapshot(page),entry=saved?.filesystem.files.find(value=>value.type==='binary'&&value.path.startsWith('/samples/'+item.stem));return entry?{entry,bytes:fileBytes(entry)}:false;},'saved '+item.key+' WAV');}
const fileRecord=value=>({path:value.entry.path,bytes:value.bytes.length,sha256:sha(value.bytes)});
function waveStats(bytes){
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');assert.equal(bytes.readUInt16LE(20),1);assert.equal(bytes.readUInt16LE(22),2);assert.equal(bytes.readUInt32LE(24),44100);assert.equal(bytes.readUInt16LE(34),16);
  const frames=bytes.readUInt32LE(40)/4;assert.equal(bytes.length,44+frames*4);let peak=0,square=0,crossings=0,previous=0;
  for(let i=0;i<frames;i++){const value=bytes.readInt16LE(44+i*4);assert.equal(value,bytes.readInt16LE(46+i*4));peak=Math.max(peak,Math.abs(value));square+=value*value;if(previous<0&&value>=0)crossings++;previous=value;}
  return{frames,peak:peak/32767,rms:Math.sqrt(square/frames)/32767,frequency:crossings/(frames/44100)};
}
async function sourceCode(page,text){
  if(await page.locator('#hucFilesPanel').isHidden())await page.locator('#hucFilesToggle').click();await page.locator('#hucFilesTree [data-file-path="/index.js"]').click();
  await page.locator('#synthInputCodeTab').click();await until(()=>page.locator('#synthCodeEditor').isEditable(),'Code fallback ready');await page.locator('#synthCodeEditor').fill(text);
}
async function prepare(page,item,{frequency=440,level=.5,duration=4}={}){
  await page.locator(item.tab).click();
  assert.equal(await page.locator(control(item,'Auto')).count(),0,'Test wave edits always apply automatically');
  assert.equal(await page.locator(control(item,'Load')).count(),0,'No Load/Reload button is required');
  await range(page,item,'Frequency',frequency);await range(page,item,'Level',level);await range(page,item,'Duration',duration);
  await page.locator(item.mount+' [data-test-shape="sine"]').click();await loaded(page,item);
  const saved=await until(async()=>{const value=await file(page,item),stats=waveStats(value.bytes);return stats.frames===Math.round(duration*44100)&&Math.abs(stats.peak-level)<.001&&Math.abs(stats.frequency-frequency)<2?value:false;},'latest '+item.key+' Sine WAV');
  assert.notEqual((await state(page,item)).sourceState,'playing');return saved;
}
async function assertSilent(page){await wait(220);const measured=await audio(page);assert(measured.physicalOutputMuted&&measured.peak<1e-7,JSON.stringify(measured));return measured;}
async function screenshot(page,engine,label,images){await fs.mkdir(config.screenshots,{recursive:true});const destination=path.join(config.screenshots,engine+'-'+label+'.png');await page.screenshot({path:destination,fullPage:false});images[label]={file:destination,sha256:sha(await fs.readFile(destination))};}

async function run(browser,engine,origin){
  const context=await browser.newContext({viewport:{width:1400,height:1000},serviceWorkers:'block'});await context.addInitScript(installSilentAudit);
  const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[],missing=[],external=[],blockedMonaco=[],checks=[],measurements={},images={};let stage='load';
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();(/monaco|jsdelivr/.test(url.href)?blockedMonaco:external).push(url.href);return route.abort();});
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  const step=label=>{stage=label;console.log('CHECK '+engine+': '+label);};
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#hucFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');assert.equal((await graph(page)).contexts,0);
    step('app media Mixer defaults and silent test preparation');await page.locator('#mixerChipTab').click();
    for(const[id,value]of [['huc6280',.44],['msm5205',.3],['cdda',.3]])assert.equal(Number(await page.locator('[data-cdrom2-source="'+id+'"] [data-mixer-volume]').inputValue()),value);
    assert.match(await page.locator('[data-cdrom2-source="huc6280"]').textContent(),/×4/);
    for(const item of media){const saved=await prepare(page,item);measurements[item.key]={initial:fileRecord(saved),initialWav:waveStats(saved.bytes)};assert.equal((await graph(page)).contexts,0);}
    checks.push('Fresh Mixer starts HuC at44%/×4 and MSM5205/CD-DA at30%; both four-second test Sines load silently without an AudioContext and have no Auto/Load/Reload controls');

    for(const item of media){
      const record=measurements[item.key];step(item.key+' held-key live parameters without Files churn');
      await page.locator(item.tab).click();if(item.key==='msm5205')await page.locator('#msmLoop').check();await page.locator('#synthInputKeyboardTab').click();await blurInput(page);
      const before=fileRecord(await file(page,item));await page.keyboard.down('a');await playing(page,item);await wait(230);record.baseline=await audio(page);
      assert(record.baseline.rms>.005&&record.baseline.hz440>record.baseline.hz880*5&&record.baseline.physicalOutputMuted);
      const writesBefore=await page.evaluate(()=>__pceMediaAudit.projectWrites);
      await range(page,item,'Frequency',880);await range(page,item,'Level',.25);await range(page,item,'Duration',3);
      record.live=await until(async()=>{const value=await audio(page);return value.rms>.003&&value.hz880>value.hz440*5&&value.rms<record.baseline.rms*.8?value:false;},'actual '+item.key+' 880Hz quarter-level output',5000);
      assert.equal((await state(page,item)).sourceState,'playing');assert(await key(page,'a').evaluate(node=>node.classList.contains('is-active')),'live update keeps the held keyboard owner');
      assert.deepEqual(fileRecord(await file(page,item)),before,'Input previews do not rewrite project WAV bytes');
      assert.equal(await page.evaluate(()=>__pceMediaAudit.projectWrites),writesBefore,'Input previews do not persist project revisions');
      assert.match(await page.locator(control(item,'Frequency')).locator('..').locator('output').textContent(),/880/);assert.match(await page.locator(control(item,'Level')).locator('..').locator('output').textContent(),/25%/);
      if(item.key==='cdda')assert.equal(Number((await state(page,item)).trackFrames),132300,'Length input updates the actual track length');
      await page.locator(control(item,'Duration')).dispatchEvent('change');await loaded(page,item);
      const committed=await until(async()=>{const value=await file(page,item),stats=waveStats(value.bytes);return stats.frames===132300&&Math.abs(stats.peak-.25)<.001&&Math.abs(stats.frequency-880)<2?value:false;},'gesture-end latest WAV persistence');
      record.committed=fileRecord(committed);record.committedWav=waveStats(committed.bytes);assert.notEqual(record.committed.sha256,before.sha256);assert.equal(record.committed.path,before.path);
      assert(await key(page,'a').evaluate(node=>node.classList.contains('is-active')),'persisting preview retains keyboard ownership');
      await page.keyboard.up('a');await stopped(page,item);record.release=await assertSilent(page);assert.equal(await page.locator('#keyboard .key.is-active').count(),0);
      checks.push(item.key+': held computer key updates Frequency/Level/Length from input-only events, real output changes, ownership stays held, Files persist only the final change, and keyup reaches silence');

      step(item.key+' automatic idle editing and Smooth edges');
      const idleBase=fileRecord(await file(page,item)),sourceRevision=(await state(page,item)).revision;
      await range(page,item,'Frequency',660);await range(page,item,'Level',.4);await range(page,item,'Duration',4);
      await until(()=>state(page,item).then(value=>Number(value.revision)>Number(sourceRevision)),'automatic idle source update');
      assert.deepEqual(fileRecord(await file(page,item)),idleBase,'Input preview does not save before the gesture ends');
      assert.notEqual((await state(page,item)).sourceState,'playing');await assertSilent(page);
      await page.locator(control(item,'Duration')).dispatchEvent('change');await loaded(page,item);
      record.idle=await until(async()=>{const stats=waveStats((await file(page,item)).bytes);return stats.frames===176400&&Math.abs(stats.frequency-660)<2&&Math.abs(stats.peak-.4)<.001?stats:false;},'automatic latest idle WAV persistence');
      await page.locator(control(item,'Smooth')).uncheck();await loaded(page,item);
      const unsmoothed=await until(async()=>{const value=await file(page,item);return Math.abs(value.bytes.readInt16LE(value.bytes.length-4))>100?value:false;},'Smooth edges Off automatically persists nonzero final sample');
      await page.locator(control(item,'Smooth')).check();await loaded(page,item);
      const smoothed=await until(async()=>{const value=await file(page,item);return value.bytes.readInt16LE(value.bytes.length-4)===0?value:false;},'Smooth edges On automatically persists zero final sample');
      record.smoothEdges={off:fileRecord(unsmoothed),on:fileRecord(smoothed)};
      assert.notEqual((await state(page,item)).sourceState,'playing');await assertSilent(page);
      await range(page,item,'Frequency',440,{commit:true});await loaded(page,item);
      await until(async()=>Math.abs(waveStats((await file(page,item)).bytes).frequency-440)<2,'idle 440Hz WAV automatically saved');
      assert.notEqual((await state(page,item)).sourceState,'playing');await assertSilent(page);
      checks.push(item.key+': idle Frequency/Level/Length and Smooth edges apply automatically without Load/Reload; transient previews do not write Files, final changes persist exact WAVs and never autoplay');

      step(item.key+' release ownership, screen keys and UI takeover');
      await blurInput(page);await page.keyboard.down('a');await playing(page,item);await page.keyboard.down('w');await playing(page,item);await page.keyboard.up('a');await wait(60);
      assert.equal((await state(page,item)).sourceState,'playing');assert(await key(page,'w').evaluate(node=>node.classList.contains('is-active')));await page.keyboard.up('w');await stopped(page,item);await assertSilent(page);
      await key(page,'w').scrollIntoViewIfNeeded();const box=await key(page,'w').boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await playing(page,item);await page.mouse.up();await stopped(page,item);await assertSilent(page);
      const uiFile=fileRecord(await file(page,item));await blurInput(page);await page.keyboard.down('a');await playing(page,item);const beforeUi=(await state(page,item)).revision;
      await page.evaluate(({frequency,play})=>{const input=document.querySelector(frequency);input.value='880';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector(play).click();},{frequency:control(item,'Frequency'),play:item.play});
      if(item.key==='cdda'){await until(()=>state(page,item).then(value=>value.sourceState==='paused'),'UI Pause owns track');await page.locator(item.play).click();}
      await playing(page,item);await wait(230);const uiAudio=await audio(page);assert(uiAudio.hz440>uiAudio.hz880*5,'Queued old edit cannot change the new UI-owned sound');assert.equal((await state(page,item)).revision,beforeUi);
      await page.keyboard.up('a');await wait(120);assert.equal((await state(page,item)).sourceState,'playing');assert.equal(await page.locator('#keyboard .key.is-active').count(),0);
      await page.locator(item.stop).click();await stopped(page,item);await assertSilent(page);assert.deepEqual(fileRecord(await file(page,item)),uiFile);
      checks.push(item.key+': overlapping old keyup preserves the new key; screen-key release is bounded and silent; a queued old edit is cancelled on UI takeover and newer UI playback survives the previous keyboard release');

      step(item.key+' Code takeover cancels a pending edit and survives old keyup');await prepare(page,item,{level:.4,duration:4});
      const takeover='media-live-code-owner:'+item.key;
      await sourceCode(page,`const media=await useSoundChip('${item.key}');await media.play(${item.key==='cdda'?'1':'{loop:true}'});log('${takeover}');liveLoop('media-owner',async()=>{await beat(1);});`);
      const codeFile=fileRecord(await file(page,item));await blurInput(page);await page.keyboard.down('a');await playing(page,item);const beforeCode=(await state(page,item)).revision;
      await page.evaluate(frequency=>{const input=document.querySelector(frequency);input.value='880';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#synthCodeRunButton').click();},control(item,'Frequency'));
      await until(()=>page.locator('#synthCodeLog').textContent().then(text=>text.includes(takeover)),'Code takes playback ownership');await wait(230);const codeAudio=await audio(page);
      assert(codeAudio.hz440>codeAudio.hz880*5,'Queued old edit cannot change the new Code-owned sound');assert.equal((await state(page,item)).revision,beforeCode);
      await page.keyboard.up('a');await wait(120);assert.equal((await state(page,item)).sourceState,'playing');assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);assert.equal(await page.locator('#keyboard .key.is-active').count(),0);
      await page.locator('#synthCodeStopButton').click();await stopped(page,item);await assertSilent(page);assert.deepEqual(fileRecord(await file(page,item)),codeFile);await page.locator('#synthInputKeyboardTab').click();
      checks.push(item.key+': documented Code Play cancels a queued old edit and cannot receive delayed keyboard edits/fade/Stop; Code Stop becomes silent');
    }
    step('mobile controls and cleanup');await page.setViewportSize({width:390,height:844});
    for(const item of media){await page.locator(item.tab).click();await page.locator(item.mount).evaluate(node=>node.scrollIntoView({block:'start'}));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await screenshot(page,engine,item.key+'-live-390',images);}
    await page.locator('#stopAudio').click();for(const item of media)await stopped(page,item);await assertSilent(page);assert.equal(await page.locator('#keyboard .key.is-active').count(),0);
    const routing=await graph(page);assert(routing.contexts===1&&routing.speakerRoutes===1&&routing.physicalOutputMuted);assert(routing.rates.every(rate=>rate===48000));measurements.graph=routing;
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(external,[]);checks.push('Both live test editors fit390px; global Stop leaves one permanently muted context and no active media key');
    return{browser:engine,passed:true,checks,measurements,images,errors,missing,external,expectedBlockedMonaco:blockedMonaco,physicalOutputMuted:true,listeningPerformed:false};
  }catch(error){await screenshot(page,engine,'failure',images).catch(()=>{});error.receipt={browser:engine,passed:false,stage,error:error.stack,checks,measurements,images,errors,missing,external,expectedBlockedMonaco:blockedMonaco,graph:await graph(page).catch(()=>null)};throw error;}
  finally{await context.close();}
}

(async()=>{
  let failure=null,comparison=null;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const engine of engines){const browser=await{chromium,webkit}[engine].launch({headless:true,...engine==='chromium'?{args:['--mute-audio']}:{}});try{results.push(await run(browser,engine,origin));}catch(error){results.push(error.receipt??{browser:engine,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(sourceErrors,[]);
    if(config.compare){
      const previous=JSON.parse(await fs.readFile(config.compare,'utf8')),canonical=name=>name.replace(/^synth-huc6280\//,''),old=new Map(Object.entries(previous.servedAssets).map(([name,value])=>[canonical(name),value])),matched=[];
      for(const[name,value]of served){const key=canonical(name);if(!key.endsWith('.html')&&old.has(key)){assert.equal(value.sha256,old.get(key).sha256,'Served source/package parity '+key);matched.push(key);}}
      for(const name of ['synth.js','synth.css','source_mix.js','test_pcm.js','test_pcm_controls.js','media_keyboard.js','media_output.js','msm5205_source.js','cdda_source.js'])assert(matched.includes(name),'Required parity '+name);
      comparison={file:config.compare,matchedAssets:matched.sort(),excluded:'HTML entry links are intentionally rewritten by standalone packaging.'};
    }
  }catch(error){failure=error;}finally{server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,elapsedSeconds:(Date.now()-started)/1000,physicalOutputMuted:true,listeningPerformed:false,
    checker:{file:path.relative(repository,__filename),sha256:sha(await fs.readFile(__filename))},servedAssets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),sourceErrors,comparison,results,...failure?{error:failure.stack}:{}};
  await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
