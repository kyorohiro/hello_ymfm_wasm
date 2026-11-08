// SPDX-License-Identifier: BSD-3-Clause
// Direct SID file -> live CH observation / coherent capture -> Synth keyboard. Every
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

// A small PAL VBI program changes the real chip's pulse width, ADSR and
// waveform flags on every play call. CH2 intentionally keeps a combined
// waveform, so an unsupported portable preset still has observable registers.
function createLiveFixture(base){
  const init=[...base.program.slice(0,-2),0xa9,0,0x8d,0x30,0x03,0x60];
  const play=[0xee,0x30,0x03,0xad,0x30,0x03,0x8d,0x02,0xd4,
    0x49,0xa5,0x8d,0x05,0xd4,0xad,0x30,0x03,0x29,0x10,
    0x0a,0x0a,0x09,0x11,0x8d,0x04,0xd4,0xad,0x30,0x03,
    0x8d,0x15,0xd4,0x60];
  const bytes=new Uint8Array(124+init.length+play.length);bytes.set(base.bytes.subarray(0,124));
  new DataView(bytes.buffer).setUint16(12,base.loadAddress+init.length);
  bytes.fill(0,22,54);bytes.set(new TextEncoder().encode('Tetorica live CH observation'),22);
  bytes.set(init,124);bytes.set(play,124+init.length);return {bytes};
}

function instrument(){
  const audit=window.__sidImportAudit={contexts:[],nodes:[],sinks:[],messages:[],processorErrors:[],
    captureRequests:[],captureReplies:[],transportReplies:[],nextId:0,canvasDraws:0,playerReadsPending:0,playerReadsMax:0,playerReadReplies:0};
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
        const request=requests.get(event.data?.id);if(!request||request.received)return;
        request.received=true;if(request.read){audit.playerReadsPending--;audit.playerReadReplies++;}
        if(ownerTransport(request.method)){
          audit.transportReplies.push({id:event.data.id,method:request.method,state:event.data.value,error:event.data.error??null});
          const flag=request.method==='pause'?'holdPauseReply':'holdResumeReply';
          if(audit[flag]){
            audit[flag]=false;event.stopImmediatePropagation();
            const release=request.method==='pause'?'releasePauseReply':'releaseResumeReply';
            audit[release]=()=>{audit[release]=null;this.port.dispatchEvent(new MessageEvent('message',{data:event.data}));};
          }
        }
        if(!request.capture)return;
        audit.captureReplies.push({id:event.data.id,state:event.data.value,error:event.data.error??null});
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
      const read=owner.kind==='player'&&data.method==='read';
      if(read){audit.playerReadsPending++;audit.playerReadsMax=Math.max(audit.playerReadsMax,audit.playerReadsPending);}
      owner.requests.set(data.id,{capture,read,method:data.method,received:false});
    }
    return post.call(this,data,...args);
  };
  function ownerTransport(method){return method==='pause'||method==='resume';}
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
  const errors=[],consoleErrors=[],failures=[],external=[],checks=[],captures=[],liveObservations=[],pauseObservations=[],pointerHoldObservations=[];
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
    const frozenCore=state=>Object.fromEntries([
      'model','backend','clockHz','sampleRate','positionFrames','cycles','sidCycles','bootCycles','initCycles',
      'initReturned','initPending','playCalls','irqCount','nmiCount','writeCount','readCount','pc','registers','voices',
      'hostDcHz','lastCpuReads','format','timing','subtune','environment','targetSelection','relocation',
    ].filter(key=>key in state).map(key=>[key,state[key]]));
    const playerIdentity=()=>page.evaluate(()=>{
      const node=__sidImportAudit.active('player').at(-1);
      return {node:__sidImportAudit.nodes.indexOf(node),context:__sidImportAudit.contexts.indexOf(node?.context),
        contexts:__sidImportAudit.contexts.length,loads:__sidImportAudit.messages.filter(m=>m.kind==='player'&&m.method==='load').length};
    });
    async function pausePreview({heldPointer=false}={}){
      const count=await page.evaluate(()=>__sidImportAudit.transportReplies.filter(reply=>reply.method==='pause').length);
      const button=page.locator('#sidImportPause');
      if(heldPointer){
        await button.scrollIntoViewIfNeeded();
        const box=await button.boundingBox();assert(box,'Pause has no pointer target');
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
        await page.evaluate(()=>{
          const button=document.getElementById('sidImportPause');
          window.__sidHeldPause={button,label:button.firstChild,text:button.textContent,started:performance.now(),
            reads:__sidImportAudit.messages.filter(item=>item.kind==='player'&&item.method==='read'&&item.id>0).length,
            completedReads:__sidImportAudit.playerReadReplies,
            frame:document.getElementById('sidLiveView').dataset.liveFrames};
        });
        let observation;
        await page.mouse.down();
        try{
          // A normal pointer press spans several 50ms observations. Locator
          // click() alone can finish before the first update and miss native
          // Safari losing the click when its pressed text node is replaced.
          await page.waitForTimeout(250);
          await page.waitForFunction(()=>{
            const held=window.__sidHeldPause;
            return __sidImportAudit.playerReadReplies>=held.completedReads+2&&document.getElementById('sidLiveView').dataset.liveFrames!==held.frame;
          },null,{timeout:5000});
          observation=await page.evaluate(()=>{
            const held=window.__sidHeldPause,button=document.getElementById('sidImportPause');
            return {heldMs:performance.now()-held.started,sameButton:button===held.button,sameTextNode:button.firstChild===held.label,
              initialLabel:held.text,labelDuringHold:button.textContent,initialFrame:held.frame,
              frameDuringHold:document.getElementById('sidLiveView').dataset.liveFrames,
              liveReadRequestsDuringHold:__sidImportAudit.messages.filter(item=>item.kind==='player'&&item.method==='read'&&item.id>0).length-held.reads,
              completedLiveReadsDuringHold:__sidImportAudit.playerReadReplies-held.completedReads,
              pauseRepliesBeforeRelease:__sidImportAudit.transportReplies.filter(reply=>reply.method==='pause').length};
          });
          pointerHoldObservations.push(observation);
        }finally{await page.mouse.up();}
        assert(observation.heldMs>=250,'Pointer press did not span Live observations');
        assert(observation.completedLiveReadsDuringHold>=2,'Live reads did not occur during the pointer press');
        assert.notEqual(observation.frameDuringHold,observation.initialFrame,'Live display did not update during the pointer press');
        assert.equal(observation.sameButton,true,'A Live update replaced the pressed Pause button');
        assert.equal(observation.sameTextNode,true,'A Live update replaced the pressed Pause text node');
        assert.equal(observation.labelDuringHold,'Pause');
        assert.equal(observation.pauseRepliesBeforeRelease,count,'Pause ran before pointer release');
      }else await button.click();
      await page.waitForFunction(()=>document.getElementById('sidImportStatus').dataset.state==='paused');
      const reply=await page.evaluate(count=>__sidImportAudit.transportReplies.filter(reply=>reply.method==='pause')[count],count);
      assert(reply&&!reply.error,'Pause did not return a coherent Worklet ACK');
      assert.equal(reply.state.playing,false);assert.equal(reply.state.paused,true);
      assert.match(await page.locator('#sidImportPause').textContent(),/Resume/);
      assert.equal(await page.locator('#sidImportPlay').isDisabled(),true);
      assert.equal(await page.locator('#sidImportCapture').isDisabled(),false);
      await silent('player');return reply.state;
    }
    async function resumePreview({delay=0}={}){
      await page.locator('#sidImportPause').click({delay});
      await page.waitForFunction(()=>document.getElementById('sidImportStatus').dataset.state==='playing');
      assert.match(await page.locator('#sidImportPause').textContent(),/Pause/);
      await waitState('player',state=>state.playing&&!state.paused);await sound('player');
    }
    async function setLive(value){
      await page.locator('#sidLiveEnabled').evaluate((input,value)=>{input.checked=value;input.dispatchEvent(new Event('change',{bubbles:true}));},value);
      await page.waitForFunction(value=>document.getElementById('sidLiveView').dataset.liveEnabled===String(value),value);
    }
    async function capture(){
      // Keep the next explicitly marked read owned by this capture, rather than
      // a periodic observer read. There is no polling backlog after disabling.
      await setLive(false);await page.waitForTimeout(100);
      const count=await page.evaluate(()=>__sidImportAudit.captureRequests.length);
      await page.evaluate(()=>{__sidImportAudit.markCapture=true;document.getElementById('sidImportCapture').click();});
      await page.waitForFunction(count=>__sidImportAudit.captureReplies.length>count,count);
      await page.waitForFunction(()=>!document.getElementById('sidImportCapture').disabled);
      const observed=await page.evaluate(()=>({requests:__sidImportAudit.captureRequests,reply:__sidImportAudit.captureReplies.at(-1)}));
      assert.equal(observed.requests.length,count+1);assert.equal(observed.reply.id,observed.requests.at(-1));assert.equal(observed.reply.error,null);assert(observed.reply.state.positionFrames>0);
      return observed.reply.state;
    }
    async function usePreset(expected,voice=0){
      const button=page.locator(`[data-sid-import-voice="${voice}"]`);
      assert.equal(await button.isDisabled(),false);await button.click();
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
    assert.equal(await page.locator('#sidImportCapture').isDisabled(),true);assert.equal(await page.locator('#sidImportUse').count(),0);
    assert.equal(await page.locator('#sidLiveEnabled').isChecked(),true);
    assert.match(await imports().textContent(),/SID/);const original=(await savedPreset()).value;

    check('question-mark explanations are closed by default and open without folding the card or starting audio');
    for(const card of ['filterCard','voiceCard','modulationCard']){
      assert.equal(await page.locator(`#${card}HelpButton`).getAttribute('aria-expanded'),'false');
      assert.equal(await page.locator(`#${card}HelpPanel`).isVisible(),false);
    }
    assert.equal(await page.locator('#filterHelp').isVisible(),false);
    await page.locator('#filterCardHelpButton').click();
    assert.equal(await page.locator('#filterCard').evaluate(node=>node.open),true);
    assert.equal(await page.locator('#filterCardHelpButton').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#filterCardHelpPanel').isVisible(),true);
    assert.equal(await page.locator('#filterHelp').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.activeElement===document.getElementById('filterCardHelpButton')),false);
    assert.equal(await page.evaluate(()=>__sidImportAudit.contexts.length),0);
    assert.deepEqual((await savedPreset()).value,original);
    await page.locator('#filterCardHelpButton').click();
    assert.equal(await page.locator('#filterCardHelpPanel').isVisible(),false);

    check('question-mark help opens a closed section, and closing help leaves that section open');
    assert.equal(await page.locator('#modulationCard').evaluate(node=>node.open),false);
    await page.locator('#modulationCardHelpButton').click();
    assert.equal(await page.locator('#modulationCard').evaluate(node=>node.open),true);
    assert.equal(await page.locator('#modulationCardHelpButton').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#modulationCardHelpPanel').isVisible(),true);
    await page.locator('#modulationCardHelpButton').click();
    assert.equal(await page.locator('#modulationCardHelpPanel').isVisible(),false);
    assert.equal(await page.locator('#modulationCard').evaluate(node=>node.open),true);
    assert.equal(await page.evaluate(()=>__sidImportAudit.contexts.length),0);
    assert.deepEqual((await savedPreset()).value,original);
    await page.locator('#modulationCard').evaluate(node=>{node.open=false;});

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
      const observed=await capture();
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
    await capture();

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
    const rsidCapture=await capture();
    const rsidParsed=helpers.validatePlayerSid(helpers.rsid.bytes),rsidPreset=helpers.captureSidVoices(rsidCapture,{name:rsidParsed.metadata.name,subtune:1}).voices[0].preset;assert(rsidPreset);await usePreset(rsidPreset);

    check('unsupported combined carrier settings show their reason and cannot replace the current instrument');
    const beforeUnsupported=(await savedPreset()).value;
    await load(helpers.combined.bytes,'combined-carrier.sid');await preview();await capture();
    await page.locator('[data-sid-import-voice="0"]').click();await page.waitForTimeout(50);assert.match(await page.locator('#sidImportVoicePreview').textContent(),/Combined waveforms/i);
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

    check('editing the Synth while a captured Voice selection waits for disposal cancels the late replacement');
    await preview();await capture();
    await page.evaluate(()=>{__sidImportAudit.holdNextPlayerClose=true;document.querySelector('[data-sid-import-voice="0"]').click();});
    await page.waitForFunction(()=>typeof __sidImportAudit.releasePlayerClose==='function');
    await page.locator('[data-choice-for="waveform"][data-value="noise"]').click();
    await page.waitForFunction(()=>document.getElementById('patchStatus').dataset.busy!=='true');
    const edited=(await savedPreset()).value;assert.equal(edited.voice.waveform,'noise');
    await page.evaluate(()=>__sidImportAudit.releasePlayerClose());await page.waitForTimeout(100);
    assert.deepEqual((await savedPreset()).value,edited);

    const liveValue=field=>page.locator(`#sidLiveView [data-live-field="${field}"]`).getAttribute('data-value');
    const liveFrame=()=>page.locator('#sidLiveView').getAttribute('data-live-frames');
    const applicationReadCount=()=>page.evaluate(()=>__sidImportAudit.messages.filter(m=>m.kind==='player'&&m.method==='read'&&m.id>0).length);
    const waitLive=()=>page.waitForFunction(()=>document.getElementById('sidLiveView').dataset.liveActive==='true'&&Number(document.getElementById('sidLiveView').dataset.liveFrames)>0);
    const editorValues=()=>page.evaluate(()=>{
      const field=id=>document.getElementById(id).dataset.value;
      const mask=[['triangle',16],['saw',32],['pulse',64],['noise',128]].reduce((mask,[wave,bit])=>
        mask|(document.querySelector(`[data-choice-for="waveform"][data-value="${wave}"]`).getAttribute('aria-pressed')==='true'?bit:0),0);
      return {waveforms:String(mask),pulseWidth:field('pulseWidth'),adsr:['attack','decay','sustain','release'].map(field).join('/')};
    });
    async function checkPausedUi(state,voice=0){
      await page.waitForFunction(frame=>Number(document.getElementById('sidLiveView').dataset.liveFrames)===frame,state.positionFrames);
      const base=voice*7,registers=state.registers,values=await editorValues();
      assert.equal(await page.locator('#sidLiveView').isVisible(),true);
      assert.equal(await page.locator('#voiceEditor').getAttribute('data-observing'),'true');
      assert.equal(await page.locator('#sidLiveView').getAttribute('data-live-voice'),String(voice));
      assert.equal(values.waveforms,String(registers[base+4]&0xf0));
      assert.equal(values.pulseWidth,String(registers[base+2]|(registers[base+3]&15)<<8));
      assert.equal(values.adsr,[registers[base+5]>>4,registers[base+5]&15,registers[base+6]>>4,registers[base+6]&15].join('/'));
      assert.equal(await liveValue('frequencyRegister'),String(registers[base]|registers[base+1]<<8));
      assert.equal(await liveValue('gate'),String(Boolean(registers[base+4]&1)));
      assert.equal(await page.locator('#attack').isDisabled(),true);
    }
    const rememberEditor=()=>page.evaluate(()=>{
      const root=document.getElementById('voiceEditor'),box=root.getBoundingClientRect();
      const ids=['filterCard','voiceCard','modulationCard','filterCutoff','pulseWidth','attack','modulationRatio'];
      window.__sidSharedEditorNodes=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
      window.__sidSharedEditorOffsets=Object.fromEntries(['filterCutoff','pulseWidth','attack','modulationRatio'].map(id=>{
        const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x-box.x,y:r.y-box.y}];
      }));
    });
    const checkEditorIdentity=async({layout=false}={})=>{
      const state=await page.evaluate(()=>{
        const root=document.getElementById('voiceEditor'),box=root.getBoundingClientRect();
        return {same:Object.entries(window.__sidSharedEditorNodes).every(([id,node])=>document.getElementById(id)===node&&document.querySelectorAll(`#${id}`).length===1),
          offsets:Object.fromEntries(Object.keys(window.__sidSharedEditorOffsets).map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x-box.x,y:r.y-box.y}];})),
          expected:window.__sidSharedEditorOffsets};
      });
      assert(state.same,'Live mode rebuilt or duplicated the authored editor controls');
      assert.equal(await page.locator('#voiceEditor').isVisible(),true);
      if(layout)for(const [id,offset]of Object.entries(state.offsets)){
        const expected=state.expected[id];
        assert(Math.abs(offset.x-expected.x)<1&&Math.abs(offset.y-expected.y)<1,`${id} moved within the shared editor: ${JSON.stringify({expected,actual:offset})}`);
      }
    };

    check('Live and edit reuse the same control nodes and preserve their relative layout');
    await page.evaluate(()=>{for(const id of ['filterCard','voiceCard','modulationCard'])document.getElementById(id).open=true;});
    await rememberEditor();

    check('live CH observation follows real changing registers with one read in flight and keeps the authored preset');
    await load(helpers.live.bytes,'authored-live-ch.sid');await setLive(true);
    await page.evaluate(()=>{__sidImportAudit.playerReadsMax=0;__sidImportAudit.playerReadsPending=0;});
    await preview();await waitLive();
    const liveContextCount=await page.evaluate(()=>__sidImportAudit.contexts.length),values=[];
    for(let i=0;i<14;i++){
      values.push({frame:await liveFrame(),...await editorValues()});
      await page.waitForTimeout(80);
    }
    assert(new Set(values.map(v=>v.frame)).size>5,'Live observation frames did not advance');
    assert(new Set(values.map(v=>v.pulseWidth)).size>5,'Real per-play pulse-width writes were not displayed');
    assert(new Set(values.map(v=>v.adsr)).size>5,'Real per-play ADSR writes were not displayed');
    assert.deepEqual([...new Set(values.map(v=>v.waveforms))].sort(),['16','80'],'Live view must retain combined waveform flags');
    assert.equal(await page.evaluate(()=>__sidImportAudit.playerReadsMax),1,'Observer/capture reads overlapped');
    assert.equal(await page.evaluate(()=>__sidImportAudit.contexts.length),liveContextCount,'Observation allocated another audio context');
    assert.deepEqual((await savedPreset()).value,edited);liveObservations.push({model:'6581',voice:0,values,maxReadConcurrency:1});
    assert.equal(await page.locator('#voiceEditor').getAttribute('data-observing'),'true');
    await checkEditorIdentity({layout:true});

    check('the shared Live controls are read-only while question-mark help and folds remain usable through polling');
    for(const id of ['pulseWidth','pulseWidthRange','attack','decay','sustain','release','filterCutoff','filterCutoffRange','filterResonance','chipVolume','modulationRatio'])
      assert.equal(await page.locator(`#${id}`).isDisabled(),true,id);
    assert.equal(await page.locator('[data-choice-for="waveform"][data-value="pulse"]').isDisabled(),true);
    const playerCommands=await page.evaluate(()=>__sidImportAudit.messages.filter(m=>m.kind==='player'&&m.method!=='read').length);
    await page.locator('#filterCardHelpButton').click();
    assert.equal(await page.locator('#filterCard').evaluate(node=>node.open),true);
    assert.equal(await page.locator('#filterCardHelpPanel').isVisible(),true);
    const helpFrame=await liveFrame();await page.waitForFunction(frame=>document.getElementById('sidLiveView').dataset.liveFrames!==frame,helpFrame);
    assert.equal(await page.locator('#filterCardHelpButton').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('#filterCardHelpPanel').isVisible(),true);
    await page.locator('#filterCardHelpButton').click();
    await page.locator('#voiceCard>summary').click();
    assert.equal(await page.locator('#voiceCard').evaluate(node=>node.open),false);
    const foldFrame=await liveFrame();await page.waitForFunction(frame=>document.getElementById('sidLiveView').dataset.liveFrames!==frame,foldFrame);
    assert.equal(await page.locator('#voiceCard').evaluate(node=>node.open),false,'A Live update reopened the folded section');
    await page.locator('#voiceCard>summary').click();
    assert.equal(await page.evaluate(()=>__sidImportAudit.messages.filter(m=>m.kind==='player'&&m.method!=='read').length),playerCommands,'A Live help/fold action wrote to the tune');
    assert.deepEqual((await savedPreset()).value,edited);
    await checkEditorIdentity({layout:true});

    check('live CH selection immediately shows the chosen combined-waveform channel without changing the song or instrument');
    await page.locator('[data-sid-live-voice="1"]').click();
    await page.waitForFunction(()=>document.getElementById('sidLiveView').dataset.liveVoice==='1');
    const combinedValues=await editorValues();
    assert.equal(combinedValues.waveforms,'48');assert.equal(await liveValue('frequencyRegister'),String(0x2030));
    assert.equal(combinedValues.adsr,'5/8/9/3');assert.match(await liveValue('import'),/Combined waveforms/i);
    assert((await read('player')).playing);assert.deepEqual((await savedPreset()).value,edited);
    assert.equal(await page.evaluate(()=>document.activeElement?.matches('[data-sid-live-voice]')),false);
    await checkEditorIdentity();

    check('disabling live observation freezes its values and stops periodic reads while the real song continues');
    await setLive(false);await page.waitForTimeout(100);
    const frozen=await liveFrame(),reads=await applicationReadCount(),positionBefore=(await read('player')).positionFrames;
    await page.waitForTimeout(240);
    assert.equal(await liveFrame(),frozen);assert.equal(await applicationReadCount(),reads);
    assert.equal(await page.locator('#sidLiveView').getAttribute('data-live-active'),'false');
    assert((await read('player')).positionFrames>positionBefore);await sound('player');
    assert.equal(await page.locator('#voiceEditor').getAttribute('data-observing'),'false');
    assert.equal(await page.locator('#attack').getAttribute('data-value'),String(edited.voice.attack));
    assert.equal(await page.locator('#pulseWidth').getAttribute('data-value'),String(edited.voice.pulseWidth));
    assert.equal(await page.locator('[data-choice-for="waveform"][data-value="noise"]').getAttribute('aria-checked'),'true');
    assert.equal(await page.locator('#attack').isDisabled(),false);
    await checkEditorIdentity({layout:true});

    check('an unavailable captured Voice click preserves the preset and live raw settings remain observable');
    await setLive(true);await waitLive();
    await capture();await page.locator('[data-sid-import-voice="1"]').click();await page.waitForTimeout(50);
    assert.match(await page.locator('#sidImportVoicePreview').textContent(),/Combined waveforms/i);
    assert.deepEqual((await savedPreset()).value,edited);assert((await read('player')).playing);
    await setLive(true);await waitLive();assert.equal((await editorValues()).waveforms,'48');

    check('Stop fences a delayed observer reply and leaves a visibly frozen last CH frame');
    await setLive(true);await waitLive();
    await page.evaluate(()=>{__sidImportAudit.markCapture=true;__sidImportAudit.holdCaptureReply=true;});
    await page.waitForFunction(()=>typeof __sidImportAudit.releaseCaptureReply==='function');
    await stopPreview();const stoppedFrame=await liveFrame();
    await page.evaluate(()=>__sidImportAudit.releaseCaptureReply());await page.waitForTimeout(120);
    assert.equal(await liveFrame(),stoppedFrame);assert.equal(await page.locator('#sidLiveView').getAttribute('data-live-active'),'false');
    assert.deepEqual((await savedPreset()).value,edited);

    check('8580 live observation uses its real preview model and labels unavailable envelope observation');
    await load(helpers.pair8580.bytes,'live-8580.sid');await page.locator('[data-sid-live-voice="0"]').click();
    await setLive(true);await preview();await waitLive();
    assert.equal(await page.locator('#sidLiveView').getAttribute('data-live-model'),'8580');
    assert.equal(await liveValue('envelope'),'unavailable');assert.equal((await editorValues()).waveforms,'16');
    assert.equal(await page.locator('#syncEnabled').isChecked(),true);assert.equal(await page.locator('#ringEnabled').isChecked(),true);
    assert.deepEqual((await savedPreset()).value,edited);
    liveObservations.push({model:'8580',voice:0,frame:await liveFrame(),envelope:'unavailable'});

    check('holding Pause across real Live updates preserves its text node and delivers Pause/Resume with the same engine');
    const heldPointerIdentity=await playerIdentity(),heldPointerState=await pausePreview({heldPointer:true});
    await checkPausedUi(heldPointerState);
    assert.deepEqual(frozenCore(await read('player')),frozenCore(heldPointerState));
    assert.deepEqual(await playerIdentity(),heldPointerIdentity);
    await resumePreview({delay:250});
    await waitState('player',state=>state.positionFrames>heldPointerState.positionFrames);
    assert.deepEqual(await playerIdentity(),heldPointerIdentity);

    for(const entry of [
      {label:'6581 VBI',fixture:helpers.pair6581},
      {label:'6581 CIA',fixture:helpers.cia,subtune:2},
      {label:'6581 RSID',fixture:helpers.rsid},
      {label:'8580 VBI',fixture:helpers.pair8580},
    ]){
      check(`${entry.label} Pause freezes the real CPU/SID state for Capture and Resume continues the same engine`);
      await load(entry.fixture.bytes,`pause-${entry.label.replaceAll(' ','-')}.sid`);
      if(entry.subtune){await page.locator('#sidImportSubtuneUp').click();await page.waitForFunction(()=>/2\s*\/\s*2/.test(document.getElementById('sidImportSubtuneValue').textContent));}
      await page.locator('[data-sid-live-voice="0"]').click();await setLive(true);await preview();await waitLive();
      const identity=await playerIdentity(),beforePausePreset=(await savedPreset()).value;
      const paused=await pausePreview();await checkPausedUi(paused);
      const expected=frozenCore(paused),firstRead=await read('player');assert.deepEqual(frozenCore(firstRead),expected);
      await page.waitForTimeout(200);const later=await read('player');
      assert.equal(later.paused,true);assert.equal(later.playing,false);assert.deepEqual(frozenCore(later),expected);
      assert.deepEqual(await playerIdentity(),identity,'Pause replaced or reloaded the C64 engine');
      const captured=await capture();assert.deepEqual(frozenCore(captured),expected,'Capture did not read the stopped state');
      await setLive(true);await checkPausedUi(paused);assert.deepEqual((await savedPreset()).value,beforePausePreset);
      await resumePreview();const resumed=await waitState('player',state=>state.positionFrames>paused.positionFrames);
      assert.equal(resumed.paused,false);assert.deepEqual(await playerIdentity(),identity,'Resume replaced or reloaded the C64 engine');
      pauseObservations.push({case:entry.label,model:paused.model,subtune:paused.subtune,pauseFrames:paused.positionFrames,
        resumedFrames:resumed.positionFrames,cycles:paused.cycles,sidCycles:paused.sidCycles,exactPausedReads:2,captureMatches:true,identity});
      await stopPreview();
    }

    check('paused CH switching and Live toggling inspect the fixed ACK without advancing the song or unmuting on Master changes');
    await load(helpers.live.bytes,'paused-live-ch.sid');await setLive(true);await preview();await waitLive();
    const pausedChannels=await pausePreview(),pausedExpected=frozenCore(pausedChannels),pausedIdentity=await playerIdentity();
    await page.locator('[data-sid-live-voice="1"]').click();await checkPausedUi(pausedChannels,1);
    const channelsCapture=await capture();assert.deepEqual(frozenCore(channelsCapture),pausedExpected);
    await setLive(true);await checkPausedUi(pausedChannels,1);
    await page.waitForTimeout(100);const pausedReadCount=await applicationReadCount();
    await setLive(false);assert.equal(await page.locator('#voiceEditor').getAttribute('data-observing'),'false');
    await setLive(true);await checkPausedUi(pausedChannels,1);
    await page.locator('#masterVolume').evaluate(input=>{input.value='3.8';input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForTimeout(240);await silent('player');assert.equal(await applicationReadCount(),pausedReadCount,'Paused observation kept polling');
    assert.deepEqual(frozenCore(await read('player')),pausedExpected);assert.deepEqual(await playerIdentity(),pausedIdentity);
    await page.locator('#masterVolume').evaluate(input=>{input.value='.7';input.dispatchEvent(new Event('input',{bubbles:true}));});

    check('cancelled and invalid file selection retain the accepted paused instance and exact stopped state');
    const pausedInfo=await page.locator('#sidImportInfo').textContent(),pausedAuthored=(await savedPreset()).value;
    await page.locator('#sidSoundFileInput').dispatchEvent('cancel');
    await page.locator('#sidSoundFileInput').setInputFiles({name:'bad-paused.sid',mimeType:'application/octet-stream',buffer:Buffer.from([1,2,3])});
    await page.waitForFunction(()=>document.getElementById('sidImportStatus').dataset.error==='true');
    assert.equal(await page.locator('#sidImportInfo').textContent(),pausedInfo);
    const keptPause=await read('player');assert.equal(keptPause.paused,true);assert.deepEqual(frozenCore(keptPause),pausedExpected);
    assert.deepEqual(await playerIdentity(),pausedIdentity);assert.deepEqual((await savedPreset()).value,pausedAuthored);
    assert.equal(await page.locator('#sidImportPause').isDisabled(),false);await stopPreview();

    check('selecting a supported Voice captured while paused closes its preview and imports that fixed instrument');
    await load(helpers.pair6581.bytes,'paused-capture-use.sid');await page.locator('[data-sid-live-voice="0"]').click();
    await setLive(true);await preview();const pausedImport=await pausePreview(),pausedCapture=await capture();
    assert.deepEqual(frozenCore(pausedCapture),frozenCore(pausedImport));
    const pausedParsed=helpers.validatePlayerSid(helpers.pair6581.bytes);
    const pausedPreset=helpers.captureSidVoices(pausedCapture,{name:pausedParsed.metadata.name,subtune:1}).voices[0].preset;assert(pausedPreset);
    await usePreset(pausedPreset);

    check('Stop fences a delayed Pause ACK and cannot leave a stale paused or playing context');
    await preview();
    const pauseRacePreset=(await savedPreset()).value;
    await page.evaluate(()=>{__sidImportAudit.holdPauseReply=true;document.getElementById('sidImportPause').click();});
    await page.waitForFunction(()=>typeof __sidImportAudit.releasePauseReply==='function');
    await stopPreview();await page.evaluate(()=>__sidImportAudit.releasePauseReply());await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>__sidImportAudit.active('player').length),0);
    assert.equal(await page.locator('#sidImportPause').isDisabled(),true);assert.equal(await page.locator('#sidImportPlay').isDisabled(),false);
    assert.deepEqual((await savedPreset()).value,pauseRacePreset);

    check('Stop fences a delayed Resume ACK and an explicit new Play owns the next preview');
    await preview();await pausePreview();
    await page.evaluate(()=>{__sidImportAudit.holdResumeReply=true;document.getElementById('sidImportPause').click();});
    await page.waitForFunction(()=>typeof __sidImportAudit.releaseResumeReply==='function');
    await stopPreview();await page.evaluate(()=>__sidImportAudit.releaseResumeReply());await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>__sidImportAudit.active('player').length),0);
    assert.deepEqual((await savedPreset()).value,pauseRacePreset);
    await preview();await pausePreview();await resumePreview();await pausePreview();

    check('a keyboard attack retires a paused preview before the authored Synth note sounds');
    const pausedKeyboardPreset=(await savedPreset()).value;
    await page.keyboard.down(firstKey);await sound('synth');
    await page.waitForFunction(()=>__sidImportAudit.active('player').length===0);
    assert.deepEqual((await read('synth')).preset,pausedKeyboardPreset);await page.keyboard.up(firstKey);await stopSynth();
    // Leave a paused preview visible for both responsive screenshots.
    await setLive(true);await preview();await pausePreview();

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
    report.results.push({browser:name,version:browser.version(),passed:true,checks,captures,liveObservations,pauseObservations,pointerHoldObservations,errors,consoleErrors,failures,external,allPhysicalOutputsMuted:muted});
    console.log(`PASS ${name}: ${checks.length} direct SID import checks; every physical output muted.`);
  }catch(error){
    if(config.screenshots&&page)await page.screenshot({path:path.join(config.screenshots,`${name}-failed.png`),fullPage:true}).catch(()=>{});
    const state=await page?.evaluate(()=>({status:document.getElementById('sidImportStatus')?.textContent,info:document.getElementById('sidImportInfo')?.textContent,preview:document.getElementById('sidImportVoicePreview')?.textContent,audio:document.getElementById('audioStatus')?.textContent,live:document.getElementById('sidLiveView')?.dataset,liveText:document.getElementById('sidLiveView')?.textContent})).catch(()=>null);
    report.results.push({browser:name,passed:false,stage,error:error.message,state,checks,pointerHoldObservations,errors,consoleErrors,failures,external});
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
    cia:createPsidCiaFixture(),rsid:createRsidFixture('cia-irq'),combined:createSidPairFixture({sync:false,ring:false,voice3off:true,overrides:[[4,0x31]]}),
    live:createLiveFixture(createSidPairFixture({sync:false,ring:false,sourceControl:0,thirdControl:0x31,voice3off:true,overrides:[[7,0x30],[8,0x20],[12,0x58],[13,0x93]]})),
    captureSidVoices,validatePlayerSid,readPreset,presetToCode};
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
