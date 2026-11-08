// SPDX-License-Identifier: BSD-3-Clause
// Direct SID file -> preview -> coherent capture -> Synth keyboard. Every
// physical output is intercepted and muted before application code runs.
const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');

const config = {root:path.resolve(__dirname,'../docs'),entry:'/synth-sid/index.html',
  out:'/private/tmp/tetorica-sid-synth-import-browser.json',screenshots:null,engines:'chromium,webkit'};
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i].replace(/^--/,''),value=process.argv[++i];
  assert(['root','entry','out','screenshots','engines'].includes(key)&&value&&!value.startsWith('--'),'Usage: --root DIR --entry /index.html --out JSON --screenshots DIR --engines chromium,webkit');
  config[key]=['entry','engines'].includes(key)?value:path.resolve(value);
}
const engines=config.engines.split(',');assert(engines.length&&new Set(engines).size===engines.length&&engines.every(e=>['chromium','webkit'].includes(e)));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.png':'image/png','.sid':'application/octet-stream'};
const digest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const report={schemaVersion:1,passed:false,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,
  fixtures:'Newly authored PSID/RSID programs only; no game music, firmware or recorded PCM',servedInputs:{},results:[]};

function instrument(){
  const audit=window.__sidImportAudit={contexts:[],nodes:[],sinks:[],messages:[],processorErrors:[],
    captureRequests:[],captureReplies:[],nextId:0,canvasDraws:0};
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,ports=new WeakMap();
  const clearRect=CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect=function(...args){
    if(this.canvas?.id==='outputCanvas')audit.canvasDraws++;
    return clearRect.apply(this,args);
  };
  const kind=node=>node?.__sidImportKind;
  window.AudioContext=class extends Context{
    constructor(...args){super(...args);audit.contexts.push(this);}
    close(){
      const closing=super.close();
      if(audit.holdNextPlayerClose&&audit.nodes.some(n=>n.context===this&&kind(n)==='player')){
        audit.holdNextPlayerClose=false;
        return new Promise((resolve,reject)=>{audit.releasePlayerClose=()=>{audit.releasePlayerClose=null;closing.then(resolve,reject);};});
      }
      return closing;
    }
  };
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{
    constructor(...args){
      super(...args);this.__sidImportKind=args[1]==='tetorica-sid-player'?'player':args[1]==='tetorica-sid-synth'?'synth':args[1];
      audit.nodes.push(this);const requests=new Map();ports.set(this.port,{kind:kind(this),requests});
      this.addEventListener('processorerror',()=>audit.processorErrors.push(args[1]));
      this.port.addEventListener('message',event=>{
        const request=requests.get(event.data?.id);if(!request?.capture||request.received)return;
        request.received=true;audit.captureReplies.push({id:event.data.id,state:event.data.value,error:event.data.error??null});
        if(audit.holdCaptureReply){
          audit.holdCaptureReply=false;event.stopImmediatePropagation();
          audit.releaseCaptureReply=()=>{audit.releaseCaptureReply=null;this.port.dispatchEvent(new MessageEvent('message',{data:event.data}));};
        }
      });
    }
  };
  MessagePort.prototype.postMessage=function(data,...args){
    const owner=ports.get(this);
    if(data?.method)audit.messages.push({kind:owner?.kind??null,id:data.id,method:data.method});
    if(data?.id>0&&owner){
      const capture=owner.kind==='player'&&data.method==='read'&&audit.markCapture;
      if(capture){audit.markCapture=false;audit.captureRequests.push(data.id);}
      owner.requests.set(data.id,{capture,received:false});
    }
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
  audit.active=(type)=>audit.nodes.filter(n=>kind(n)===type&&n.context.state!=='closed');
  audit.read=(type='synth')=>new Promise((resolve,reject)=>{
    const node=audit.active(type).at(-1),id=--audit.nextId;if(!node)return reject(Error('No open '+type+' Worklet'));
    const timeout=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error(type+' audit read timed out'));},5000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timeout);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'read',args:[]});
  });
  audit.sample=(type)=>{
    const sink=audit.sinks.findLast(s=>s.context.state==='running'&&(!type||audit.nodes.some(n=>n.context===s.context&&kind(n)===type)));
    const muted=audit.sinks.every(s=>s.mute.gain.value===0);
    if(!sink)return {rms:0,peak:0,finite:true,muted};
    const pcm=new Float32Array(sink.analyser.fftSize);sink.analyser.getFloatTimeDomainData(pcm);
    let square=0,peak=0;for(const value of pcm){square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return {rms:Math.sqrt(square/pcm.length),peak,finite:pcm.every(Number.isFinite),muted};
  };
  const arrayBuffer=File.prototype.arrayBuffer;
  File.prototype.arrayBuffer=function(){
    if(this.name==='held-file.sid'&&audit.holdFileRead){audit.holdFileRead=false;return new Promise((resolve,reject)=>{audit.releaseFileRead=()=>{audit.releaseFileRead=null;arrayBuffer.call(this).then(resolve,reject);};});}
    return arrayBuffer.call(this);
  };
}

async function checkBrowser(name,engine,origin,helpers){
  const browser=await engine.launch({headless:true}),context=await browser.newContext({acceptDownloads:true,viewport:{width:1180,height:1000}});
  await context.addInitScript(instrument);
  const errors=[],consoleErrors=[],failures=[],external=[],checks=[],captures=[];
  let page,stage='startup',holdNextPlayerWasm=false,releaseWasm;
  const check=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    page=await context.newPage();page.setDefaultTimeout(20000);
    page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)failures.push({path:new URL(r.url()).pathname,status:r.status()});});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}
      if(holdNextPlayerWasm&&/\/sid-rsid\/sid-rsid\.wasm$/.test(url.pathname)){
        holdNextPlayerWasm=false;await new Promise(resolve=>{releaseWasm=()=>{releaseWasm=null;resolve();};});
        return route.continue().catch(()=>{});
      }
      return route.continue();
    });
    const read=type=>page.evaluate(type=>__sidImportAudit.read(type),type);
    const sample=type=>page.evaluate(type=>__sidImportAudit.sample(type),type);
    const sound=type=>page.waitForFunction(type=>{const s=__sidImportAudit.sample(type);return s.finite&&s.muted&&s.rms>.00001;},type);
    const silent=type=>page.waitForFunction(type=>{const s=__sidImportAudit.sample(type);return s.finite&&s.muted&&s.peak<1e-8;},type);
    const waitState=async(type,predicate)=>{
      for(let i=0;i<160;i++){const state=await read(type);if(predicate(state))return state;await page.waitForTimeout(25);}
      throw Error(type+' state did not settle: '+JSON.stringify(await read(type)));
    };
    const imports=()=>page.locator('#sidImportTools');
    const openImports=async()=>{if(!await imports().evaluate(n=>n.open))await page.locator('#sidImportTools>summary').click();};
    const openPresets=async()=>{if(!await page.locator('#presetTools').evaluate(n=>n.open))await page.locator('#presetTools>summary').click();};
    const stopSynth=async()=>{await page.locator('#stopAudio').click();await silent('synth');await silent('player');};
    async function savedPreset(){
      await openPresets();const downloading=page.waitForEvent('download');await page.locator('#savePreset').click();
      const bytes=await fs.readFile(await(await downloading).path()),value=JSON.parse(bytes.toString());assert.deepEqual(helpers.readPreset(value),value);return {bytes,value};
    }
    async function load(bytes,filename){
      await openImports();await page.locator('#sidSoundFileInput').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
      await page.waitForFunction(filename=>document.getElementById('sidImportInfo').textContent.includes(filename)&&!document.getElementById('sidImportPlay').disabled,filename);
    }
    async function preview({audible=true}={}){
      await page.locator('#sidImportPlay').click();
      await page.waitForFunction(()=>__sidImportAudit.active('player').length>0);
      await waitState('player',s=>s.playing&&s.positionFrames>0);
      assert.equal(await page.locator('#sidImportCapture').isDisabled(),false);if(audible)await sound('player');
    }
    async function stopPreview(){await page.locator('#sidImportStop').click();await page.waitForFunction(()=>__sidImportAudit.active('player').length===0);await silent('player');}
    async function capture(){
      const count=await page.evaluate(()=>__sidImportAudit.captureRequests.length);
      await page.evaluate(()=>{__sidImportAudit.markCapture=true;document.getElementById('sidImportCapture').click();});
      await page.waitForFunction(count=>__sidImportAudit.captureReplies.length>count,count);
      await page.waitForFunction(()=>!document.getElementById('sidImportCapture').disabled);
      const observed=await page.evaluate(()=>({requests:__sidImportAudit.captureRequests,reply:__sidImportAudit.captureReplies.at(-1)}));
      assert.equal(observed.requests.length,count+1);assert.equal(observed.reply.id,observed.requests.at(-1));assert.equal(observed.reply.error,null);assert(observed.reply.state.positionFrames>0);
      return observed.reply.state;
    }
    async function usePreset(expected){
      assert.equal(await page.locator('#sidImportUse').isDisabled(),false);await page.locator('#sidImportUse').click();
      await page.waitForFunction(expected=>document.getElementById('instrumentName').value===expected.name&&document.getElementById('sidModelBadge').textContent===expected.model,expected);
      await page.waitForFunction(()=>__sidImportAudit.active('player').length===0);await silent('player');
      const saved=await savedPreset();assert.deepEqual(saved.value,expected);
      assert.equal(await page.evaluate(()=>document.activeElement?.matches('select,input[type=file]')),false);
      const key=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(key);
      await page.keyboard.down(key);await sound('synth');const state=await waitState('synth',s=>s.voices.length>0);
      assert.deepEqual(state.preset,expected);assert.equal(state.model,expected.model);
      if(expected.modulation.sync||expected.modulation.ring){assert.equal(state.capacity,1);assert.equal(state.registers[4]&6,(expected.modulation.sync?2:0)|(expected.modulation.ring?4:0));}
      await page.keyboard.up(key);await stopSynth();
      await page.locator('#copyCode').click();assert.equal(await page.locator('#codeOutput').inputValue(),helpers.presetToCode(expected));
      await page.locator('#presetFileInput').setInputFiles({name:'roundtrip.json',mimeType:'application/json',buffer:saved.bytes});
      await page.waitForFunction(()=>document.getElementById('audioStatus').textContent.includes('preset loaded'));
      assert.deepEqual((await savedPreset()).value,expected);return saved;
    }
    await page.goto(origin+config.entry);await page.waitForSelector('#sidImportTools');
    check('direct SID import is discoverable without allocating audio, and opening it keeps the current Synth preset');
    await openImports();assert.equal(await page.evaluate(()=>__sidImportAudit.contexts.length),0);
    assert.equal(await page.locator('#sidImportCapture').isDisabled(),true);assert.equal(await page.locator('#sidImportUse').isDisabled(),true);
    assert.match(await imports().textContent(),/SID/);const original=(await savedPreset()).value;

    check('file preflight preserves the current instrument and creates no AudioContext');
    await load(helpers.pair6581.bytes,'pair-6581.sid');assert.equal(await page.evaluate(()=>__sidImportAudit.contexts.length),0);
    assert.deepEqual((await savedPreset()).value,original);assert.match(await page.locator('#sidImportInfo').textContent(),/6581/);

    check('starting a SID preview stops held Synth voices without replacing the instrument');
    const firstKey=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');
    await page.keyboard.down(firstKey);await sound('synth');await preview();
    await waitState('synth',s=>s.voices.length===0);await silent('synth');assert.deepEqual((await savedPreset()).value,original);await page.keyboard.up(firstKey);

    check('the shared Master changes actual preview output while every physical sink stays muted');
    await page.waitForTimeout(260);const beforeVolume=await sample('player');
    await page.locator('#masterVolume').evaluate(input=>{input.value='.35';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForTimeout(260);const afterVolume=await sample('player');
    assert(beforeVolume.finite&&beforeVolume.muted&&afterVolume.finite&&afterVolume.muted);
    assert(afterVolume.rms/beforeVolume.rms>.35&&afterVolume.rms/beforeVolume.rms<.65,'The preview Master did not approximately halve actual PCM');
    captures.push({check:stage,previewBefore:beforeVolume,previewAfter:afterVolume});
    await page.locator('#masterVolume').evaluate(input=>{input.value='.7';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForTimeout(100);

    check('changing octave during song preview keeps the monitor drawing live audio');
    await page.locator('#octaveUp').click();await page.waitForTimeout(100);
    await page.evaluate(()=>{__sidImportAudit.canvasDraws=0;});
    await page.waitForFunction(()=>__sidImportAudit.canvasDraws>=3);
    assert((await read('player')).playing);await sound('player');
    await page.locator('#octaveDown').click();

    let lastSaved;
    for(const [model,fixture]of [['6581',helpers.pair6581],['8580',helpers.pair8580]]){
      check(`${model} captures a real no-wave Sync+Ring source and applies it directly in the same Synth`);
      if(model==='8580'){await load(fixture.bytes,'pair-8580.sid');await preview();}
      const observed=await capture();await page.locator('[data-sid-import-voice="0"]').click();
      const parsed=helpers.validatePlayerSid(fixture.bytes),expected=helpers.captureSidVoices(observed,{name:parsed.metadata.name,subtune:1}).voices[0].preset;assert(expected);
      assert.equal(expected.model,model);assert.deepEqual(expected.modulation,{sync:true,ring:true,ratio:0x2003/0x1800});
      assert.match(await page.locator('#sidImportVoicePreview').textContent(),/Sync|Ring/);
      lastSaved=await usePreset(expected);captures.push({model,positionFrames:observed.positionFrames,preset:expected,auditioned:true});
    }

    check('bad and cancelled SID selection preserve the current instrument, accepted file and capture');
    const acceptedInfo=await page.locator('#sidImportInfo').textContent(),acceptedPreview=await page.locator('#sidImportVoicePreview').textContent();
    await page.locator('#sidSoundFileInput').dispatchEvent('cancel');await page.waitForTimeout(40);
    assert.equal(await page.locator('#sidImportInfo').textContent(),acceptedInfo);assert.deepEqual((await savedPreset()).value,lastSaved.value);
    await page.locator('#sidSoundFileInput').setInputFiles({name:'invalid.sid',mimeType:'application/octet-stream',buffer:Buffer.from([1,2,3])});
    await page.waitForFunction(()=>document.getElementById('sidImportStatus').dataset.error==='true');
    assert.equal(await page.locator('#sidImportInfo').textContent(),acceptedInfo);assert.equal(await page.locator('#sidImportVoicePreview').textContent(),acceptedPreview);assert.deepEqual((await savedPreset()).value,lastSaved.value);

    check('an obsolete file read cannot overwrite a newer accepted SID');
    await page.evaluate(()=>{__sidImportAudit.holdFileRead=true;});
    await page.locator('#sidSoundFileInput').setInputFiles({name:'held-file.sid',mimeType:'application/octet-stream',buffer:Buffer.from(helpers.pair6581.bytes)});
    await page.waitForFunction(()=>typeof __sidImportAudit.releaseFileRead==='function');
    await load(helpers.cia.bytes,'latest-cia.sid');await page.evaluate(()=>__sidImportAudit.releaseFileRead());await page.waitForTimeout(80);
    assert.match(await page.locator('#sidImportInfo').textContent(),/latest-cia\.sid/);assert.deepEqual((await savedPreset()).value,lastSaved.value);

    check('subtune controls select the actual CIA song and return pointer focus to performance keys');
    await page.locator('#sidImportSubtuneUp').click();await page.waitForFunction(()=>/2\s*\/\s*2/.test(document.getElementById('sidImportSubtuneValue').textContent));
    await preview();const cia=await waitState('player',s=>s.subtune===2&&s.timing==='cia'&&s.playCalls>0);assert.equal(cia.model,'6581');
    assert.equal(await page.evaluate(()=>document.activeElement===document.getElementById('sidImportSubtuneUp')),false);
    await page.locator('[data-sid-import-voice="0"]').click();await capture();

    check('Stop fences a delayed actual capture reply and keeps the previously accepted snapshot');
    const beforeLate=await page.locator('#sidImportVoicePreview').textContent();
    await page.evaluate(()=>{__sidImportAudit.markCapture=true;__sidImportAudit.holdCaptureReply=true;document.getElementById('sidImportCapture').click();});
    await page.waitForFunction(()=>typeof __sidImportAudit.releaseCaptureReply==='function');await stopPreview();
    await page.evaluate(()=>__sidImportAudit.releaseCaptureReply());await page.waitForTimeout(80);
    assert.equal(await page.locator('#sidImportVoicePreview').textContent(),beforeLate);assert.deepEqual((await savedPreset()).value,lastSaved.value);

    check('a keyboard note stops the song preview and auditions the retained Synth instrument');
    await preview();await page.keyboard.down(firstKey);await sound('synth');await page.waitForFunction(()=>__sidImportAudit.active('player').length===0);
    assert.deepEqual((await read('synth')).preset,lastSaved.value);await page.keyboard.up(firstKey);await stopSynth();

    check('known-model mismatch keeps the accepted SID and current Synth sound');
    const ciaInfo=await page.locator('#sidImportInfo').textContent();
    await page.locator('[data-sid-import-model="8580"]').click();await page.waitForFunction(()=>document.getElementById('sidImportStatus').dataset.error==='true');
    assert.equal(await page.locator('#sidImportInfo').textContent(),ciaInfo);assert.deepEqual((await savedPreset()).value,lastSaved.value);
    await page.locator('[data-sid-import-model="auto"]').click();

    check('ROM-free authored RSID hardware interrupts preview and capture through the same direct import panel');
    await load(helpers.rsid.bytes,'authored-rsid.sid');await preview();
    const rsid=await waitState('player',s=>s.format==='RSID'&&s.irqCount>0);assert.equal(rsid.model,'6581');
    await page.locator('[data-sid-import-voice="0"]').click();const rsidCapture=await capture();
    const rsidParsed=helpers.validatePlayerSid(helpers.rsid.bytes),rsidPreset=helpers.captureSidVoices(rsidCapture,{name:rsidParsed.metadata.name,subtune:1}).voices[0].preset;assert(rsidPreset);await usePreset(rsidPreset);

    check('unsupported combined carrier settings show their reason and cannot replace the current instrument');
    const beforeUnsupported=(await savedPreset()).value;
    await load(helpers.combined.bytes,'combined-carrier.sid');await preview();await page.locator('[data-sid-import-voice="0"]').click();await capture();
    assert.equal(await page.locator('#sidImportUse').isDisabled(),true);assert.match(await page.locator('#sidImportVoicePreview').textContent(),/Combined waveforms/i);
    assert.deepEqual((await savedPreset()).value,beforeUnsupported);await stopPreview();

    check('Stop during delayed preview WASM startup cannot create a stale playing context');
    await load(helpers.pair6581.bytes,'startup-stop.sid');holdNextPlayerWasm=true;
    const startupContextCount=await page.evaluate(()=>__sidImportAudit.contexts.length);
    await page.locator('#sidImportPlay').click();
    for(let i=0;i<200&&!releaseWasm;i++)await page.waitForTimeout(20);assert(releaseWasm,'Preview did not request its C64 WASM');
    await page.locator('#sidImportStop').click();releaseWasm();await page.waitForTimeout(120);
    await page.waitForFunction(count=>__sidImportAudit.active('player').length===0&&__sidImportAudit.contexts.slice(count).every(c=>c.state==='closed'),startupContextCount);
    assert.deepEqual((await savedPreset()).value,beforeUnsupported);
    await preview();await stopPreview();

    check('editing the Synth while Use waits for preview disposal cancels the late instrument replacement');
    await preview();await page.locator('[data-sid-import-voice="0"]').click();await capture();
    await page.evaluate(()=>{__sidImportAudit.holdNextPlayerClose=true;document.getElementById('sidImportUse').click();});
    await page.waitForFunction(()=>typeof __sidImportAudit.releasePlayerClose==='function');
    await page.locator('[data-choice-for="waveform"][data-value="noise"]').click();
    await page.waitForFunction(()=>document.getElementById('patchStatus').dataset.busy!=='true');
    const edited=(await savedPreset()).value;assert.equal(edited.voice.waveform,'noise');
    await page.evaluate(()=>__sidImportAudit.releasePlayerClose());await page.waitForTimeout(100);
    assert.deepEqual((await savedPreset()).value,edited);

    check('desktop/mobile import controls stay in one page without horizontal overflow or remote assets');
    await openImports();
    for(const width of [1180,390]){
      await page.setViewportSize({width,height:width===390?844:1000});
      assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);
      if(config.screenshots)await page.screenshot({path:path.join(config.screenshots,`${name}-sid-import-${width}.png`),fullPage:true});
    }
    await stopSynth();
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(failures,[]);assert.deepEqual(external,[]);
    assert.deepEqual(await page.evaluate(()=>__sidImportAudit.processorErrors),[]);
    const muted=await page.evaluate(()=>__sidImportAudit.sinks.every(s=>s.mute.gain.value===0));assert(muted);
    report.results.push({browser:name,version:browser.version(),passed:true,checks,captures,errors,consoleErrors,failures,external,allPhysicalOutputsMuted:muted});
    console.log(`PASS ${name}: ${checks.length} direct SID import checks; every physical output muted.`);
  }catch(error){
    if(config.screenshots&&page)await page.screenshot({path:path.join(config.screenshots,`${name}-failed.png`),fullPage:true}).catch(()=>{});
    const state=await page?.evaluate(()=>({status:document.getElementById('sidImportStatus')?.textContent,info:document.getElementById('sidImportInfo')?.textContent,preview:document.getElementById('sidImportVoicePreview')?.textContent,audio:document.getElementById('audioStatus')?.textContent})).catch(()=>null);
    report.results.push({browser:name,passed:false,stage,error:error.message,state,checks,errors,consoleErrors,failures,external});
    throw new Error(`${name} (${stage}): ${error.message}; ${JSON.stringify(state)}`,{cause:error});
  }finally{if(releaseWasm)releaseWasm();await context.close();await browser.close();}
}

(async()=>{
  const {createSidPairFixture}=await import('../test/helpers/sid_voice_pair_fixtures.mjs');
  const {createPsidCiaFixture}=await import('../test/helpers/psid_cia_fixtures.mjs');
  const {createRsidFixture}=await import('../test/helpers/rsid_fixtures.mjs');
  const {captureSidVoices}=await import('../docs/sid-player/voice_snapshot.js');
  const {validatePlayerSid}=await import('../docs/sid-player/models.js');
  const {readPreset,presetToCode}=await import('../docs/synth-sid/preset.js');
  const options={sync:true,ring:true,sourceControl:0,voice3off:true,carrierFrequency:0x1800,sourceFrequency:0x2003};
  const helpers={pair6581:createSidPairFixture({model:'6581',...options}),pair8580:createSidPairFixture({model:'8580',...options}),
    cia:createPsidCiaFixture(),rsid:createRsidFixture('cia-irq'),combined:createSidPairFixture({sync:false,ring:false,voice3off:true,overrides:[[4,0x31]]}),captureSidVoices,validatePlayerSid,readPreset,presetToCode};
  report.inputs=Object.fromEntries(await Promise.all(['scripts/check_sid_synth_import_browser.cjs','test/helpers/sid_voice_pair_fixtures.mjs','test/helpers/psid_cia_fixtures.mjs','test/helpers/rsid_fixtures.mjs'].map(async file=>[file,digest(await fs.readFile(path.resolve(__dirname,'..',file)))])));
  report.fixtureInputs=Object.fromEntries(Object.entries(helpers).filter(([,value])=>value?.bytes).map(([key,value])=>[key,digest(value.bytes)]));
  if(config.screenshots)await fs.mkdir(config.screenshots,{recursive:true});
  const served=new Map(),server=http.createServer(async(req,res)=>{
    try{const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(config.root,'.'+pathname);assert(file.startsWith(config.root+path.sep));if(!served.has(pathname)){const original=await fs.readFile(file);served.set(pathname,original);report.servedInputs[pathname]=digest(original);}const bytes=served.get(pathname);res.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream','cache-control':'no-store'});res.end(bytes);}
    catch{res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{const origin='http://127.0.0.1:'+server.address().port;for(const name of engines)await checkBrowser(name,{chromium,webkit}[name],origin,helpers);report.passed=true;}
  finally{await new Promise(resolve=>server.close(resolve));await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
