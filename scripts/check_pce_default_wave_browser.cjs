// SPDX-License-Identifier: BSD-3-Clause
// Narrow cold-start checks; speaker routes are permanently muted before load.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),started=Date.now(),config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',out:'',compare:''};
for(let i=2;i<process.argv.length;i++){
  const arg=/^--(root|entry|engines|out|compare)(?:=(.+))?$/.exec(process.argv[i]);assert(arg,'Unknown option '+process.argv[i]);config[arg[1]]=arg[2]??process.argv[++i];
}
config.root=path.resolve(config.root);config.out||=path.join(repo,'build/pce-default-wave-20261119/browser-source.json');
const engines=config.engines.split(',');assert(engines.length&&engines.every(id=>['chromium','webkit'].includes(id)));
const sha=b=>createHash('sha256').update(b).digest('hex'),assets=new Map(),sourceErrors=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{
  try{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/favicon.ico'){res.writeHead(204).end();return;}
    if(name.endsWith('/'))name+='index.html';const file=path.resolve(config.root,'.'+name);assert(file.startsWith(config.root+path.sep));
    const bytes=await fs.readFile(file),key=path.relative(config.root,file).split(path.sep).join('/'),value={bytes:bytes.length,sha256:sha(bytes)};
    if(assets.has(key)&&assets.get(key).sha256!==value.sha256){sourceErrors.push('Changed asset '+key);throw Error(sourceErrors.at(-1));}
    assets.set(key,value);res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch{res.writeHead(404).end();}
});
function audit(){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,open=indexedDB.open.bind(indexedDB);
  const a=window.__defaultWaveAudit={contexts:[],gates:[],meters:[],databases:[]};
  window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:48000});a.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  AudioNode.prototype.connect=function(to,...args){
    if(to!==this.context.destination)return connect.call(this,to,...args);
    const mute=this.context.createGain(),meter=this.context.createAnalyser();mute.gain.value=0;meter.fftSize=4096;
    connect.call(this,meter);connect.call(this,mute);connect.call(mute,to);a.gates.push(mute);a.meters.push(meter);return to;
  };
  indexedDB.open=(...args)=>{const request=open(...args);request.addEventListener('success',()=>a.databases.push(request.result));return request;};
  a.read=()=>({contexts:a.contexts.length,muted:a.gates.every(g=>g.gain.value===0),audio:a.meters.map(m=>{
    const pcm=new Float32Array(m.fftSize);m.getFloatTimeDomainData(pcm);let peak=0,square=0,sine=0,cosine=0;
    for(let i=0;i<pcm.length;i++){assertFinite(pcm[i]);peak=Math.max(peak,Math.abs(pcm[i]));square+=pcm[i]**2;const p=i*2*Math.PI*440/m.context.sampleRate;sine+=pcm[i]*Math.sin(p);cosine+=pcm[i]*Math.cos(p);}
    return{peak,rms:Math.sqrt(square/pcm.length),hz440:2*Math.hypot(sine,cosine)/pcm.length};
  }).sort((x,y)=>y.rms-x.rms)[0]??{peak:0,rms:0,hz440:0}});
  function assertFinite(n){if(!Number.isFinite(n))throw Error('Non-finite PCM');}
  a.files=async()=>{
    const db=a.databases.findLast(d=>d.name==='tetorica-huc6280-synth-files');if(!db)return[];
    const saved=await new Promise((resolve,reject)=>{const r=db.transaction('projects','readonly').objectStore('projects').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return(saved?.filesystem?.files??[]).map(({path,type})=>({path,type}));
  };
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const result=await read();if(result)return result;await wait(25);}throw Error('Timed out '+label);}
const sources=[{id:'msm5205',tab:'#msm5205ChipTab',root:'#msm5205Controls',info:'#msmSampleInfo',frames:'assetFrames',expected:8000},{id:'cdda',tab:'#cddaChipTab',root:'#cddaControls',info:'#cddaSourceInfo',frames:'trackFrames',expected:44100}];
const state=(page,s)=>page.locator(s.root).evaluate(n=>({...n.dataset}));
const graph=page=>page.evaluate(()=>__defaultWaveAudit.read());
async function ready(page){await until(()=>page.locator('#hucFilesPanel').getAttribute('aria-busy').then(v=>v==='false'),'Files ready');}
async function seeded(page){for(const s of sources)await until(()=>state(page,s).then(v=>v.sourceState==='ready'&&Number(v[s.frames])===s.expected),'default '+s.id+' ready');}
async function noGeneratedFiles(page){const files=await page.evaluate(()=>__defaultWaveAudit.files());assert(!files.some(f=>/\.wav$/i.test(f.path)),'Default initialization must not create project WAV files');return files;}
async function scene(browser,engine,origin,{holdFirstMsm=false}={}){
  const context=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'block'});await context.addInitScript(audit);
  const page=await context.newPage();page.setDefaultTimeout(20000);const errors=[],missing=[],external=[],blocked=[],network={held:null,seen:false};
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){(/monaco|jsdelivr/.test(url.href)?blocked:external).push(url.href);return route.abort();}
    if(holdFirstMsm&&!network.seen&&url.pathname.endsWith('/generated/msm5205_wasm.wasm')){network.seen=true;network.held=route;return;}
    return route.continue();
  });
  page.on('pageerror',error=>errors.push(error.message));page.on('response',r=>{if(r.status()>=400)missing.push({url:r.url(),status:r.status()});});
  return{context,page,errors,missing,external,blocked,network,engine,origin};
}
async function run(browser,engine,origin){
  const checks=[],measurements={},s=await scene(browser,engine,origin);let stage='cold defaults';
  try{
    const {page}=s;await page.goto(origin+config.entry);await ready(page);await seeded(page);
    await noGeneratedFiles(page);assert.equal((await graph(page)).contexts,0);
    for(const source of sources){
      assert.equal(await page.locator('#'+source.id+'TestFrequency').inputValue(),'440');assert.equal(Number(await page.locator('#'+source.id+'TestLevel').inputValue()),.5);assert.equal(Number(await page.locator('#'+source.id+'TestDuration').inputValue()),1);
      assert.equal(await page.locator('#'+source.id+'TestLoad').count(),0);assert.equal(await page.locator('#'+source.id+'TestAuto').count(),0);
    }
    checks.push('Cold startup prepares the displayed440Hz/50%/1s Sines for both media with no AudioContext, autoplay or generated WAV files');
    stage='direct default keyboard';
    for(const source of sources){
      await page.locator(source.tab).click();await page.locator('#synthInputKeyboardTab').click();await page.locator('#synthTitle').click();await page.evaluate(()=>document.activeElement?.blur());
      assert(await page.locator('#keyboard .key[data-key="a"]').isEnabled());await page.keyboard.down('a');
      await until(()=>state(page,source).then(v=>v.sourceState==='playing'),'default keyboard '+source.id);await wait(120);
      const value=await graph(page);assert(value.muted&&value.contexts===1&&value.audio.rms>.005&&value.audio.hz440>.02,JSON.stringify(value));measurements[source.id]=value.audio;
      await page.keyboard.up('a');await until(()=>state(page,source).then(v=>v.sourceState!=='playing'),'default keyup '+source.id);await wait(160);assert((await graph(page)).audio.peak<1e-7);
    }
    await noGeneratedFiles(page);checks.push('Both untouched default sources play actual440Hz PCM from computer keys and release to silence on one shared clock');
    stage='reload';await page.reload();await ready(page);await seeded(page);assert.equal((await graph(page)).contexts,0);await noGeneratedFiles(page);
    checks.push('Reload passively prepares defaults again without adding generated files or starting audio');
    assert.deepEqual(s.errors,[]);assert.deepEqual(s.missing,[]);assert.deepEqual(s.external,[]);
  }catch(error){error.receipt={browser:engine,passed:false,stage,error:error.stack,checks,measurements,errors:s.errors,missing:s.missing,external:s.external};throw error;}
  finally{await s.context.close();}
  const newer=await scene(browser,engine,origin,{holdFirstMsm:true});
  try{
    stage='newer Code beats delayed startup seed';const {page}=newer;await page.goto(origin+config.entry);await ready(page);await until(()=>newer.network.held,'initial MSM preparation held');
    assert.equal((await graph(page)).contexts,0);
    if(await page.locator('#hucFilesPanel').isHidden())await page.locator('#hucFilesToggle').click();await page.locator('#hucFilesTree [data-file-path="/index.js"]').click();await page.locator('#synthInputCodeTab').click();
    await until(()=>page.locator('#synthCodeEditor').isEditable(),'Code ready');
    await page.locator('#synthCodeEditor').fill('const msm=await useSoundChip("msm5205");\nawait msm.loadMemory(Uint8Array.from({length:64},()=>0x17),{name:"Code startup winner"});\nawait msm.play({loop:true});\nlog("STARTUP_WINNER_READY");\nliveLoop("keep",async()=>{await beat(1);});');
    await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeLog').textContent().then(t=>t.includes('STARTUP_WINNER_READY')),'newer Code source');
    await newer.network.held.continue().catch(()=>{});newer.network.held=null;await wait(160);await page.locator('#msm5205ChipTab').click();
    assert.match(await page.locator('#msmSampleInfo').textContent(),/Code startup winner/);assert.equal((await state(page,sources[0])).sourceState,'playing');await noGeneratedFiles(page);
    await page.locator('#stopAudio').click();await until(()=>state(page,sources[0]).then(v=>v.sourceState!=='playing'),'Code stop');
    checks.push('A newer Code source/Play wins over delayed initial preparation; late default completion cannot overwrite it or add WAV files');
    assert.deepEqual(newer.errors,[]);assert.deepEqual(newer.missing,[]);assert.deepEqual(newer.external,[]);
    return{browser:engine,passed:true,checks,measurements,physicalOutputMuted:true,listeningPerformed:false,errors:[],missing:[],external:[],expectedBlockedMonaco:[...s.blocked,...newer.blocked]};
  }catch(error){error.receipt={browser:engine,passed:false,stage,error:error.stack,checks,measurements,errors:newer.errors,missing:newer.missing,external:newer.external};throw error;}
  finally{await newer.network.held?.abort().catch(()=>{});await newer.context.close();}
}
(async()=>{
  let failure=null,comparison=null;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const engine of engines){const browser=await{chromium,webkit}[engine].launch({headless:true,...engine==='chromium'?{args:['--mute-audio']}:{}});try{results.push(await run(browser,engine,origin));}catch(error){results.push(error.receipt??{browser:engine,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(sourceErrors,[]);
    if(config.compare){const previous=JSON.parse(await fs.readFile(config.compare,'utf8')),canonical=n=>n.replace(/^synth-huc6280\//,''),old=new Map(Object.entries(previous.servedAssets).map(([n,v])=>[canonical(n),v])),matched=[];
      for(const[n,v]of assets){const key=canonical(n);if(!key.endsWith('.html')&&old.has(key)){assert.equal(v.sha256,old.get(key).sha256,key);matched.push(key);}}
      for(const key of ['synth.js','test_pcm_controls.js','msm5205_source.js','cdda_source.js'])assert(matched.includes(key));comparison={file:config.compare,matchedAssets:matched.sort()};}
  }catch(error){failure=error;}finally{server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const result={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,elapsedSeconds:(Date.now()-started)/1000,physicalOutputMuted:true,listeningPerformed:false,checker:{file:path.relative(repo,__filename),sha256:sha(await fs.readFile(__filename))},servedAssets:Object.fromEntries([...assets].sort()),sourceErrors,comparison,results,...failure?{error:failure.stack}:{}};
  await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(result,null,2)+'\n');if(failure)throw failure;console.log('PASS '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
