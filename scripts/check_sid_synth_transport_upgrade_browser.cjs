// SPDX-License-Identifier: BSD-3-Clause
// Focused mixed-version regression: keep a stale unversioned facade resident
// beside the current Synth, then reject an incompatible Worklet ready message.
// Routes simulate stale URLs; this is not a measurement of real HTTP caching.
const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');

const config = {root:path.resolve(__dirname,'../docs'),entry:'/synth-sid/index.html',
  out:'/private/tmp/tetorica-sid-synth-transport-upgrade-browser.json',screenshots:null,engines:'chromium,webkit'};
for(let index=2;index<process.argv.length;index++){
  const key=process.argv[index].replace(/^--/,''),value=process.argv[++index];
  assert(['root','entry','out','screenshots','engines'].includes(key)&&value&&!value.startsWith('--'),
    'Usage: --root DIR --entry /index.html --out JSON --screenshots DIR --engines chromium,webkit');
  config[key]=['entry','engines'].includes(key)?value:path.resolve(value);
}
const engines=config.engines.split(',');
assert(engines.length&&new Set(engines).size===engines.length&&engines.every(value=>['chromium','webkit'].includes(value)));
const digest=value=>{const bytes=typeof value==='string'?Buffer.from(value):value;return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.wasm':'application/wasm','.webp':'image/webp','.png':'image/png'};
const report={schemaVersion:1,passed:false,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,
  fixture:'Newly authored PAL PSID only; no game music, ROM or recorded PCM',
  simulation:'Routed stale unversioned facade retained in the same document, plus an injected legacy Worklet ready response; not a real HTTP-cache experiment',
  servedInputs:{},results:[]};

function instrument(){
  const audit=window.__sidUpgradeAudit={contexts:[],nodes:[],messages:[],sinks:[],moduleLoads:[],nextId:0,processorErrors:[]};
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,ports=new WeakMap();
  window.AudioContext=class extends Context{
    constructor(...args){
      super(...args);const index=audit.contexts.length;audit.contexts.push(this);
      if(this.audioWorklet){
        const worklet=this.audioWorklet,addModule=worklet.addModule;
        worklet.addModule=(url,options)=>{
          audit.moduleLoads.push({context:index,url:String(url)});
          return addModule.call(worklet,url,options);
        };
      }
    }
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{
    constructor(...args){
      super(...args);this.__sidUpgradeKind=args[1];audit.nodes.push(this);ports.set(this.port,this);
      this.addEventListener('processorerror',()=>audit.processorErrors.push(args[1]));
    }
  };
  MessagePort.prototype.postMessage=function(data,...args){
    const node=ports.get(this);
    if(node&&data?.method)audit.messages.push({node:audit.nodes.indexOf(node),method:data.method,id:data.id??null});
    return post.call(this,data,...args);
  };
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){
      const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
      connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);
      audit.sinks.push({context:this.context,analyser,mute});return destination;
    }
    return connect.call(this,destination,...args);
  };
  audit.active=()=>audit.nodes.filter(node=>node.__sidUpgradeKind==='tetorica-sid-player'&&node.context.state!=='closed');
  audit.read=()=>new Promise((resolve,reject)=>{
    const node=audit.active().at(-1),id=--audit.nextId;
    if(!node)return reject(Error('No active Player Worklet'));
    const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Upgrade audit read timed out'));},5000);
    function receive({data}){
      if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);
      data.error?reject(Error(data.error)):resolve(data.value);
    }
    node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'read',args:[]});
  });
  audit.identity=()=>{
    const node=audit.active().at(-1);
    return {node:audit.nodes.indexOf(node),context:audit.contexts.indexOf(node?.context),contexts:audit.contexts.length,
      loads:audit.messages.filter(item=>item.method==='load').length};
  };
  audit.sample=()=>{
    const sink=audit.sinks.findLast(item=>item.context.state==='running');
    const muted=audit.sinks.every(item=>item.mute.gain.value===0);
    if(!sink)return {finite:true,rms:0,peak:0,muted};
    const pcm=new Float32Array(sink.analyser.fftSize);sink.analyser.getFloatTimeDomainData(pcm);
    let squares=0,peak=0;for(const value of pcm){squares+=value*value;peak=Math.max(peak,Math.abs(value));}
    return {finite:pcm.every(Number.isFinite),rms:Math.sqrt(squares/pcm.length),peak,muted};
  };
}

async function checkBrowser(name,engine,origin,fixture,loadOptions,sources){
  const browser=await engine.launch({headless:true}),context=await browser.newContext({acceptDownloads:true,viewport:{width:1180,height:1000}});
  await context.addInitScript(instrument);
  const checks=[],errors=[],consoleErrors=[],external=[],requests=[],injections=[];
  let page,stage='startup',legacyRequests=0;
  sources.legacyReadyEnabled=false;sources.activeInjections=injections;
  const check=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  const frozen=state=>Object.fromEntries(['model','clockHz','sampleRate','positionFrames','cycles','sidCycles','initCycles',
    'irqCount','nmiCount','playCalls','pc','registers','voices'].filter(key=>key in state).map(key=>[key,state[key]]));
  try{
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());requests.push(url.pathname+url.search);
      if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}
      if(url.pathname==='/sid-player/audio.js'&&!url.search){
        legacyRequests++;injections.push({kind:'legacy-facade',url:url.pathname,...digest(sources.legacyFacade)});
        return route.fulfill({status:200,contentType:'text/javascript',body:sources.legacyFacade});
      }
      return route.continue();
    });
    page=await context.newPage();page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    const read=()=>page.evaluate(()=>__sidUpgradeAudit.read());
    const identity=()=>page.evaluate(()=>__sidUpgradeAudit.identity());
    const silent=()=>page.waitForFunction(()=>{const value=__sidUpgradeAudit.sample();return value.finite&&value.muted&&value.peak<1e-8;});
    const sound=()=>page.waitForFunction(()=>{const value=__sidUpgradeAudit.sample();return value.finite&&value.muted&&value.rms>.00001;});
    const closed=()=>page.waitForFunction(()=>__sidUpgradeAudit.contexts.every(value=>value.state==='closed'));
    const waitState=async predicate=>{
      for(let index=0;index<160;index++){const state=await read();if(predicate(state))return state;await page.waitForTimeout(25);}
      throw Error('Player state did not settle');
    };
    async function savedPreset(){
      if(!await page.locator('#presetTools').evaluate(node=>node.open))await page.locator('#presetTools>summary').click();
      const downloaded=page.waitForEvent('download');await page.locator('#savePreset').click();
      return JSON.parse(await fs.readFile(await(await downloaded).path(),'utf8'));
    }
    async function play(){
      await page.locator('#sidImportPlay').click();
      await page.waitForFunction(()=>__sidUpgradeAudit.active().length===1);
      await waitState(state=>state.playing&&state.positionFrames>0);await sound();
    }
    async function pause(){
      await page.locator('#sidImportPause').click();
      await page.waitForFunction(()=>document.getElementById('sidImportStatus').dataset.state==='paused');
      assert.equal((await page.locator('#sidImportPause').textContent()).trim(),'Resume');await silent();return read();
    }
    await page.goto(origin+config.entry);await page.waitForSelector('#sidImportTools');
    const authored=await savedPreset();

    check('a resident legacy unversioned facade reproduces Unknown SID command: pause and closes its muted probe');
    await page.evaluate(async()=>{window.__sidLegacyFacade=await import('/sid-player/audio.js');});
    await page.evaluate(({bytes,options})=>{
      const probe=document.createElement('button');probe.id='__legacyProbe';probe.textContent='Run legacy transport diagnostic';
      probe.addEventListener('click',()=>{
        window.__sidLegacyProbe=(async()=>{
          let audio;
          try{
            audio=await window.__sidLegacyFacade.createAudio({backend:'psid-vbi',volume:.1});
            await audio.command('load',[Uint8Array.from(bytes),options]);await audio.command('start');
            const playing=await audio.read();
            try{await audio.command('pause');return {error:null,playing};}
            catch(cause){return {error:cause.message,playing};}
          }finally{if(audio)await audio.dispose();}
        })();
      });document.body.append(probe);
    },{bytes:Array.from(fixture.bytes),options:loadOptions});
    await page.locator('#__legacyProbe').click();
    const legacy=await page.evaluate(()=>__sidLegacyProbe);
    assert.equal(legacy.error,'Unknown SID command: pause');assert.equal(legacy.playing.playing,true);
    assert.equal(legacyRequests,1);await closed();assert.deepEqual(await savedPreset(),authored);
    await page.locator('#__legacyProbe').evaluate(node=>node.remove());

    check('the current Synth entry/controller/facade/Worklet graph uses the versioned transport beside that legacy module');
    await page.locator('#sidSoundFileInput').setInputFiles({name:'transport-upgrade.sid',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
    await page.waitForFunction(()=>!document.getElementById('sidImportPlay').disabled);
    await play();
    for(const file of ['/synth-sid/synth.js','/synth-sid/sid_import.js','/sid-player/audio.js'])
      assert(requests.some(request=>{
        const url=new URL(request,origin);return url.pathname===file&&url.searchParams.get('sid-transport')==='2';
      }),`Current graph did not version ${file}`);
    assert(requests.some(request=>{
      const url=new URL(request,origin);return url.pathname==='/synth-sid/synth.js'&&url.searchParams.get('sid-channels')==='3';
    }),'Current Synth entry did not request the paired channel-controls revision');
    assert(requests.some(request=>{
      const url=new URL(request,origin);return url.pathname==='/synth-sid/synth.js'&&url.searchParams.get('sid-waves')==='1';
    }),'Current Synth entry did not request the waveform-controls revision');
    assert(requests.some(request=>{
      const url=new URL(request,origin);return url.pathname==='/synth-sid/synth.js'&&url.searchParams.get('sid-keys')==='1';
    }),'Current Synth entry did not request the software keyboard revision');
    // Worklet fetches do not consistently appear in Playwright's page routes.
    // Observe the API invocation on this exact context, including when a browser
    // can reuse a compiled response fetched by the earlier legacy probe.
    const currentIdentity=await identity();
    const currentModules=await page.evaluate(index=>__sidUpgradeAudit.moduleLoads.filter(value=>value.context===index),currentIdentity.context);
    assert(currentModules.some(value=>{
      const url=new URL(value.url);return url.pathname==='/sid-player/processor.js'&&url.search==='?sid-transport=2';
    }),'Current audio context did not request the versioned Player Worklet');
    assert(currentModules.every(value=>new URL(value.url).searchParams.get('sid-transport')==='2'));
    assert.equal(legacyRequests,1,'Current Synth requested the unversioned facade');
    assert.equal(injections.filter(value=>value.kind==='legacy-ready').length,0,'Current Synth requested an unversioned Worklet');

    check('Pause visibly becomes Resume, paused Capture matches the frozen core and Resume reuses its instance');
    const before=await identity(),held=await pause();
    // Auto update now adopts the playable song sound into the keyboard. The
    // fixed authored fixture keeps this paused snapshot stable across Resume;
    // the untouched authoring preset above remains the legacy-probe baseline.
    const songPreset=await savedPreset();
    assert.equal(held.paused,true);assert.equal(held.playing,false);
    assert.equal(await page.locator('#voiceEditor').getAttribute('data-observing'),'true');
    await page.waitForTimeout(200);assert.deepEqual(frozen(await read()),frozen(held));
    assert.equal(await page.locator('#sidLiveView').getAttribute('data-live-frames'),String(held.positionFrames));
    await page.locator('#sidImportCapture').click();
    await page.waitForFunction(()=>document.getElementById('sidImportCaptureInfo').textContent.startsWith('Captured:'));
    assert.deepEqual(frozen(await read()),frozen(held));
    assert.equal((await page.locator('#sidImportPause').textContent()).trim(),'Resume');
    if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-upgrade-resume-visible.png`),fullPage:true});
    await page.locator('#sidImportPause').click();
    await waitState(state=>state.playing&&!state.paused&&state.positionFrames>held.positionFrames);await sound();
    assert.deepEqual(await identity(),before);assert.deepEqual(await savedPreset(),songPreset);
    await page.locator('#sidImportStop').click();await closed();

    check('an incompatible versioned Worklet ready message is rejected before load/start and closes its context');
    const contextCount=await page.evaluate(()=>__sidUpgradeAudit.contexts.length);sources.legacyReadyEnabled=true;
    await page.locator('#sidImportPlay').click();
    await page.waitForFunction(()=>document.getElementById('sidImportStatus').textContent.includes('SID audio files are out of date. Reload the page.'));
    await closed();
    const rejected=await page.evaluate(count=>{
      const context=__sidUpgradeAudit.contexts[count],node=__sidUpgradeAudit.nodes.findIndex(value=>value.context===context);
      return {created:__sidUpgradeAudit.contexts.length-count,state:context?.state,
        messages:__sidUpgradeAudit.messages.filter(value=>value.node===node),
        connected:__sidUpgradeAudit.sinks.some(value=>value.context===context)};
    },contextCount);
    assert.equal(rejected.created,1);assert.equal(rejected.state,'closed');assert.equal(rejected.connected,false);
    assert.equal(rejected.messages.some(value=>value.method==='load'||value.method==='start'),false);
    assert.deepEqual(await savedPreset(),songPreset);

    check('retrying current transport recovers the same accepted file/instrument and Pause/Resume works again');
    sources.legacyReadyEnabled=false;await play();const recovered=await pause();
    assert.equal(recovered.paused,true);await page.locator('#sidImportPause').click();
    await waitState(state=>state.playing&&state.positionFrames>recovered.positionFrames);await sound();
    assert.match(await page.locator('#sidImportInfo').textContent(),/transport-upgrade\.sid/);
    assert.deepEqual(await savedPreset(),songPreset);
    await page.locator('#sidImportStop').click();await closed();
    const audit=await page.evaluate(()=>({muted:__sidUpgradeAudit.sinks.every(value=>value.mute.gain.value===0),
      processorErrors:__sidUpgradeAudit.processorErrors,contexts:__sidUpgradeAudit.contexts.map(value=>value.state)}));
    assert(audit.muted);assert.deepEqual(audit.processorErrors,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(external,[]);
    const moduleLoads=await page.evaluate(()=>__sidUpgradeAudit.moduleLoads);
    report.results.push({browser:name,version:browser.version(),passed:true,checks,legacy:{error:legacy.error,playingBeforeRejection:legacy.playing.playing},
      pause:{positionFrames:held.positionFrames,model:held.model,identity:before},rejected,requests,moduleLoads,injections,audit,errors,consoleErrors,external});
    console.log(`PASS ${name}: ${checks.length} transport upgrade checks; every physical output muted.`);
  }catch(cause){
    if(config.screenshots&&page)await page.screenshot({path:path.join(config.screenshots,`${name}-upgrade-failed.png`),fullPage:true}).catch(()=>{});
    const state=await page?.evaluate(()=>({status:document.getElementById('sidImportStatus')?.textContent,
      button:document.getElementById('sidImportPause')?.textContent,info:document.getElementById('sidImportInfo')?.textContent})).catch(()=>null);
    const moduleLoads=await page?.evaluate(()=>__sidUpgradeAudit.moduleLoads).catch(()=>null);
    report.results.push({browser:name,passed:false,stage,error:cause.message,state,checks,requests,moduleLoads,injections,errors,consoleErrors,external});
    throw new Error(`${name} (${stage}): ${cause.message}; ${JSON.stringify(state)}`,{cause});
  }finally{sources.legacyReadyEnabled=false;sources.activeInjections=null;await context.close();await browser.close();}
}

(async()=>{
  const {createSidPairFixture}=await import('../test/helpers/sid_voice_pair_fixtures.mjs');
  const {validatePlayerSid}=await import('../docs/sid-player/models.js');
  const fixture=createSidPairFixture({sync:true,ring:true,sourceControl:0,voice3off:true});
  const parsed=validatePlayerSid(fixture.bytes,{assumeUnknown:true,vbiBackend:'c64',environment:'minimal'});
  const loadOptions={...parsed.playerOptions,subtune:parsed.subtune,vbiBackend:'c64',environment:'minimal'};
  const facade=await fs.readFile(path.join(config.root,'sid-player/audio.js'),'utf8');
  const processor=await fs.readFile(path.join(config.root,'sid-player/processor.js'),'utf8');
  const legacyFacade=facade.replace(/const COMMANDS = new Set\(\[[^\n]+\]\);/,"const COMMANDS = new Set(['load', 'start', 'stop', 'read']);");
  const legacyReady=processor.replace(/this\.port\.postMessage\(\{ready:\s*true,[^\n]+\}\);/,'this.port.postMessage({ready:true});');
  assert.notEqual(legacyFacade,facade,'Legacy facade fixture failed to remove pause/resume');
  assert.notEqual(legacyReady,processor,'Legacy ready fixture failed to remove transport metadata');
  const sources={legacyFacade,legacyReady,legacyReadyEnabled:false,activeInjections:null};
  report.fixtureInput=digest(fixture.bytes);
  report.inputs=Object.fromEntries(await Promise.all(['scripts/check_sid_synth_transport_upgrade_browser.cjs','test/helpers/sid_voice_pair_fixtures.mjs'].map(async file=>[file,digest(await fs.readFile(path.resolve(__dirname,'..',file)))])));
  if(config.screenshots)await fs.mkdir(config.screenshots,{recursive:true});
  const served=new Map(),server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),pathname=decodeURIComponent(url.pathname),file=path.resolve(config.root,'.'+pathname);
      assert(file.startsWith(config.root+path.sep));
      if(!served.has(pathname)){const bytes=await fs.readFile(file);served.set(pathname,bytes);report.servedInputs[pathname]=digest(bytes);}
      let bytes=served.get(pathname);
      if(pathname==='/sid-player/processor.js'&&(!url.search||sources.legacyReadyEnabled)){
        bytes=Buffer.from(sources.legacyReady);
        sources.activeInjections?.push({kind:'legacy-ready',url:url.pathname+url.search,...digest(bytes)});
      }
      res.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream','cache-control':'no-store'});res.end(bytes);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines)await checkBrowser(name,{chromium,webkit}[name],origin,fixture,loadOptions,sources);
    report.passed=true;
  }finally{
    await new Promise(resolve=>server.close(resolve));await fs.mkdir(path.dirname(config.out),{recursive:true});
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  }
})().catch(cause=>{console.error(cause);process.exitCode=1;});
