// Actual Playground Main/Worker -> public VAB helpers -> PS1 AudioWorklet.
// Every physical destination is intercepted at gain zero before app startup.
// This is a silent numeric check, not a listening or exact-clock test.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'../docs'),out:'/private/tmp/ps1-vab-api-browser.json',engines:'chromium,webkit'};
for(let i=2;i<process.argv.length;i++){
  const argument=process.argv[i];
  if(argument==='--help'){console.log('node scripts/check_ps1_vab_public_api_browser.cjs [--root=docs] [--engines=chromium,webkit] [--out=REPORT.json]');process.exit(0);}
  const match=/^--(root|engines|out)(?:=(.*))?$/.exec(argument);assert(match,'Unknown argument: '+argument);
  config[match[1]]=match[2]??process.argv[++i];assert(config[match[1]],'Missing '+argument);
}
config.root=path.resolve(config.root);config.out=path.resolve(config.out);
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)),'Unknown browser');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),results=[],examplePath='/playground/examples/ps1/ps1-vab-tone.js',assetPath='/playground/samples/spu-import/spu-synth-demo.vab';
const hook=`\nwindow.__vabPublicPage={runtime,megaDrive,virtualFiles,open:openVirtualFile,get path(){return activeVirtualPath;},get editor(){return editorAdapter;}};\n`;
const spuHook=`\nwindow.__vabSpuPage={functions:{readVab,prepareVabTone,exportVab},get bank(){return vabBank;},get host(){return codeHost;},get audio(){return audio;}};\n`;
const processor=`class VabApiCapture extends AudioWorkletProcessor {
 constructor(){super();this.capture=null;this.port.onmessage=({data})=>{this.capture={id:data.id,index:0,left:new Float32Array(data.frames),right:new Float32Array(data.frames)};};}
 process(inputs,outputs){for(const side of outputs[0])side.fill(0);const c=this.capture;if(!c)return true;
  const n=Math.min(128,c.left.length-c.index),input=inputs[0];if(input?.[0])c.left.set(input[0].subarray(0,n),c.index);if(input?.[1])c.right.set(input[1].subarray(0,n),c.index);c.index+=n;
  if(c.index===c.left.length){this.capture=null;this.port.postMessage({id:c.id,left:c.left,right:c.right},[c.left.buffer,c.right.buffer]);}return true;
 }
}registerProcessor('ps1-vab-public-capture',VabApiCapture);`;
function installSilentAudit(){
  const audit=window.__vabPublicAudio={contexts:[],workers:[],worklets:[],sinks:new Map(),processorErrors:[],commands:[]};
  const Context=window.AudioContext,WorkerClass=window.Worker,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect,post=MessagePort.prototype.postMessage,labels=new WeakMap();audit.connect=connect;
  window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
  if(window.webkitAudioContext===Context)window.webkitAudioContext=window.AudioContext;
  window.Worker=class extends WorkerClass{constructor(url,...args){super(url,...args);audit.workers.push(String(url));}};
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);audit.worklets.push(name);labels.set(this.port,name);this.addEventListener('processorerror',()=>audit.processorErrors.push(name));}};
  MessagePort.prototype.postMessage=function(data,...args){if(data&&typeof data.method==='string')audit.commands.push({name:labels.get(this)??null,method:data.method,channel:typeof data.args?.[0]==='number'?data.args[0]:null});return post.call(this,data,...args);};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination===this.context.destination){let sink=audit.sinks.get(this.context);
      if(!sink){const sum=this.context.createGain(),gate=this.context.createGain();gate.gain.value=0;connect.call(sum,gate);connect.call(gate,destination);sink={sum,gate};audit.sinks.set(this.context,sink);}
      connect.call(this,sink.sum,...args);return destination;
    }return connect.call(this,destination,...args);
  };
  AudioNode.prototype.disconnect=function(...args){if(args[0]===this.context.destination&&audit.sinks.has(this.context))args[0]=audit.sinks.get(this.context).sum;return disconnect.apply(this,args);};
}
async function capture(page,frames=4096){return page.evaluate(async frames=>{
  const audit=__vabPublicAudio,context=[...audit.contexts].reverse().find(c=>c.state!=='closed'&&audit.sinks.has(c));
  if(!context)throw Error('No live Playground output');const sink=audit.sinks.get(context);
  if(!sink.capture){await context.audioWorklet.addModule('/__vab_api_capture.js');
    const node=new AudioWorkletNode(context,'ps1-vab-public-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
    audit.connect.call(sink.sum,node);audit.connect.call(node,sink.gate);sink.capture=node;sink.sequence=0;
    node.port.onmessage=({data})=>{if(sink.pending?.id===data.id){const p=sink.pending;sink.pending=null;clearTimeout(p.timer);p.resolve(data);}};
  }
  const data=await new Promise((resolve,reject)=>{const id=++sink.sequence;const timer=setTimeout(()=>{sink.pending=null;reject(Error('Capture timeout'));},10000);sink.pending={id,resolve,timer};sink.capture.port.postMessage({id,frames});});
  const channels=[data.left,data.right].map(values=>{let peak=0,energy=0,nonFinite=0,nonZero=0;for(const value of values){if(!Number.isFinite(value))nonFinite++;peak=Math.max(peak,Math.abs(value));energy+=value*value;if(value!==0)nonZero++;}return{peak,rms:Math.sqrt(energy/values.length),nonFinite,nonZero};});
  if(sink.gate.gain.value!==0)throw Error('Physical output was not muted');return{frames:data.left.length,sampleRate:context.sampleRate,channels,physicalOutputMuted:true};
},frames);}
async function measured(page,label,expectSound){
  let pcm;for(let i=0;i<12;i++){pcm=await capture(page);assert(pcm.channels.every(ch=>!ch.nonFinite),label+': nonfinite PCM');
    if(expectSound?pcm.channels.every(ch=>ch.rms>.0001):pcm.channels.every(ch=>!ch.nonZero))return pcm;
  }throw Error(label+': '+JSON.stringify(pcm));
}
async function source(page,text,execution){await page.locator('#codeTab').click();await page.evaluate(({text,execution})=>{__vabPublicPage.editor.setValue(text);document.getElementById('workerExecution').checked=execution==='worker';},{text,execution});}
async function run(page,text,execution){await source(page,text,execution);await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);}
async function waitLog(page,marker){await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker)||/^(?:Playback failed|Error|Loop error):/i.test(document.getElementById('status').textContent)||/\[liveLoop:[^\]]+\] Error:/.test(document.getElementById('consoleOutput').textContent),marker);
  const text=await page.locator('#consoleOutput').textContent();assert(text.includes(marker),'Runtime failed: '+text);return text;
}
function probeSource(){return `const check=(ok,message)=>{if(!ok)throw Error(message);};
check(readVab===pg.readVab&&prepareVabTone===pg.prepareVabTone&&exportVab===pg.exportVab,'global/pg identity');
check(MAX_VAB_FILE_BYTES===pg.MAX_VAB_FILE_BYTES&&MAX_VAB_FILE_BYTES===1048576,'global/pg byte limit');
const bytes=new Uint8Array(await file('/spu-synth-demo.vab',{type:'arrayBuffer'})),before=bytes.slice();
const bank=readVab(bytes);context.bank=bank;
const prepared=pg.prepareVabTone(bank,1),full=pg.exportVab(bank),single=exportVab(bank,{toneNumber:1}),selected=pg.readVab(single);
check(full.length===before.length&&full.every((v,i)=>v===before[i])&&bytes.every((v,i)=>v===before[i]),'original source unchanged');
check(bank.tones.length===3&&selected.programs.length===1&&selected.programs[0].index===3&&selected.tones[0].index===0&&selected.tones[0].sample===1,'selected Program/Tone metadata');
check(prepared.adpcm.length===64&&prepared.trimmedBytes===16&&prepared.options.loopStartSamples===0,'END trim and loop metadata');
let rejected=0;for(const call of [()=>readVab(new Uint8Array()),()=>prepareVabTone(bank,99),()=>exportVab({...bank})]){try{call();}catch{rejected++;}}check(rejected===3,'invalid data must fail');
const ps1=await useSoundChip('ps1'),instrument=await ps1.loadADPCM(prepared.adpcm,prepared.options);
check(instrument.byteLength===64&&instrument.decodedFrames===112&&instrument.loop&&instrument.loopStartSamples===0&&instrument.rootFrequencyHz===prepared.options.baseFrequencyHz,'uploaded original sample tuning');
await ps1.setPreset(0,{...prepared.preset,sample:instrument});
log('__VAB_API_PROBE__'+JSON.stringify({rejected,tones:bank.tones.length,program:selected.tones[0].program,tone:selected.tones[0].index,sample:selected.tones[0].sample,fullBytes:full.length,selectedBytes:single.length,prepared:{bytes:prepared.adpcm.length,trimmedBytes:prepared.trimmedBytes,options:prepared.options,preset:prepared.preset},uploaded:instrument}));
liveLoop('vab-release-check',async()=>{await ps1.noteOn(0,'C4');await sleep(1.8);await ps1.noteOff(0);
  // Worker sends scheduled notes ahead of the audible cursor. Observe only
  // after that bounded lookahead, rather than demanding a future KOFF now.
  await sleep(.6);const state=await ps1.getState();check(state.channels[0].gate===false,'noteOff lowers the hardware Gate');log('__VAB_API_NOTE_OFF__'+JSON.stringify({gate:state.channels[0].gate,envelope:state.channels[0].envelope,releaseRate:state.channels[0].envelopeParameters.releaseRate}));stopLoop('vab-release-check');});`;
}
async function importedFile(page){return page.evaluate(()=>{const file=__vabPublicPage.virtualFiles.get('/spu-synth-demo.vab');return file?{path:file.path,type:file.type,bytes:Array.from(file.data)}:null;});}
async function checkCase(browser,browserName,execution,origin,asset,example,screenshotDir){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),errors=[],requests=[],blocked=[];
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){blocked.push(url.href);return route.abort('blockedbyclient');}return route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(40000);
  page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));
  page.on('response',response=>{if(response.status()>=400)requests.push({url:response.url(),status:response.status()});});
  try{
    console.log('CHECK '+browserName+'/'+execution);
    await page.goto(origin+'/playground/index.html?mode=ps1&no-sw=1',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__vabPublicPage&&document.getElementById('startupNotice')?.hidden);
    assert.equal(await page.evaluate(()=>__vabPublicPage.editor.kind),'textarea','Use local fallback editor; no Monaco CDN required');
    assert.equal(await page.evaluate(()=>__vabPublicAudio.contexts.length),0,'Opening the actual Playground is audio-lazy');
    page.once('dialog',dialog=>dialog.accept('/spu-synth-demo.vab'));
    const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#importFileButton').click()]);
    await chooser.setFiles({name:'spu-synth-demo.vab',mimeType:'application/octet-stream',buffer:asset});
    await page.waitForFunction(()=>__vabPublicPage.virtualFiles.has('/spu-synth-demo.vab'));
    const imported=await importedFile(page);assert.deepEqual(imported.bytes,Array.from(asset));
    await run(page,probeSource(),execution);const log=await waitLog(page,'__VAB_API_PROBE__');
    const probe=JSON.parse(log.slice(log.lastIndexOf('__VAB_API_PROBE__')+'__VAB_API_PROBE__'.length).split('\n')[0]);
    const probePcm=await measured(page,'Prepared Tone audio',true);
    const crossModule=await page.evaluate(async({execution})=>{
      const core=await import('/js/ps1_vab.js'),pgUi=await import('/playground/playground_ps1_vab.js'),synthUi=await import('/synth-spu/spu_synth_vab.js');
      const functions=['readVab','prepareVabTone','exportVab'];
      for(const name of functions)if(core[name]!==pgUi[name]||core[name]!==synthUi[name])throw Error('VAB module identity split: '+name);
      const bytes=new Uint8Array(__vabPublicPage.virtualFiles.get('/spu-synth-demo.vab').data),bank=pgUi.readVab(bytes);
      const full=synthUi.exportVab(bank),selected=core.readVab(core.exportVab(bank,{toneNumber:1}));
      if(!full.every((v,i)=>v===bytes[i])||full.length!==bytes.length)throw Error('Cross-module full bank changed');
      if(selected.tones.length!==1||selected.tones[0].program!==3)throw Error('Cross-module selected Tone changed');
      if(execution==='main'){const actualBank=__vabPublicPage.runtime.context.bank;if(!actualBank)throw Error('Missing Main global bank');
        if(synthUi.exportVab(actualBank).length!==bytes.length)throw Error('Actual Main helper WeakMap provenance lost');}
      return{functionIdentity:true,fullExport:true,selectedExport:true,actualMainBankExport:execution==='main',selectedProgram:selected.tones[0].program};
    },{execution});
    const offLog=await waitLog(page,'__VAB_API_NOTE_OFF__'),noteOff=JSON.parse(offLog.slice(offLog.lastIndexOf('__VAB_API_NOTE_OFF__')+'__VAB_API_NOTE_OFF__'.length).split('\n')[0]);
    assert.equal(noteOff.gate,false);const released=await capture(page);assert(released.channels.every(ch=>!ch.nonFinite),'Finite original ADSR release; raw RR=0 need not be silent');
    await page.locator('#stopButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
    const probeStopped=await measured(page,'Probe Stop',false);
    await page.evaluate(path=>__vabPublicPage.open(path),'/examples/ps1/ps1-vab-tone.js');
    assert.equal(await page.evaluate(()=>__vabPublicPage.editor.getValue()),example,'Run the exact registered example file');
    await page.locator('#runButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
    await waitLog(page,'toneNumber');const examplePcm=await measured(page,'Registered VAB example audio',true);
    const pathBeforeStop=await page.evaluate(()=>__vabPublicPage.path);await page.locator('#stopButton').click();await page.waitForFunction(()=>!document.getElementById('runButton').disabled);
    const exampleStopped=await measured(page,'Example Stop',false);
    assert.equal(await page.evaluate(()=>__vabPublicPage.path),pathBeforeStop);assert.equal(await page.evaluate(()=>__vabPublicPage.editor.getValue()),example);
    assert.deepEqual(await importedFile(page),imported,'noteOff / Stop keep the imported original file');
    const audit=await page.evaluate(()=>({contexts:__vabPublicAudio.contexts.length,workers:__vabPublicAudio.workers,worklets:__vabPublicAudio.worklets,
      processorErrors:__vabPublicAudio.processorErrors,methods:__vabPublicAudio.commands.map(command=>command.method),physicalOutputMuted:[...__vabPublicAudio.sinks.values()].every(sink=>sink.gate.gain.value===0)}));
    assert(audit.worklets.includes('tetorica-playground-ps1'));assert(audit.physicalOutputMuted);assert.deepEqual(audit.processorErrors,[]);
    if(execution==='worker')assert(audit.workers.some(url=>/playground_logic_worker\.js(?:\?|$)/.test(url)),'Actual logic Worker ran');
    assert.deepEqual(errors,[],'No browser exceptions');assert.deepEqual(requests,[],'All requested local assets exist');
    await fs.mkdir(screenshotDir,{recursive:true});const screenshot=path.join(screenshotDir,browserName+'-'+execution+'.png');await page.screenshot({path:screenshot,fullPage:true});
    return{browser:browserName,version:browser.version(),execution,probe,crossModule,probePcm,noteOff,released,probeStopped,examplePcm,exampleStopped,
      importedFile:{path:imported.path,bytes:asset.length,sha256:hash(asset)},example:{path:examplePath,sha256:hash(example)},audit,screenshot,blockedExternalRequests:blocked};
  }catch(error){
    const state=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,log:document.getElementById('consoleOutput')?.textContent,editorKind:window.__vabPublicPage?.editor.kind})).catch(()=>null);
    await fs.mkdir(screenshotDir,{recursive:true});await page.screenshot({path:path.join(screenshotDir,browserName+'-'+execution+'-failed.png'),fullPage:true}).catch(()=>{});
    throw Error(browserName+'/'+execution+': '+error.message+'\n'+JSON.stringify({state,errors,requests}),{cause:error});
  }finally{await context.close();}
}
async function checkSynthCode(browser,browserName,origin,asset,screenshotDir){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),errors=[],badResponses=[];
  await context.addInitScript(installSilentAudit);await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const page=await context.newPage();page.setDefaultTimeout(40000);page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));
  page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
  try{
    console.log('CHECK '+browserName+'/synth-code');await page.goto(origin+'/synth-spu/index.html?no-sw=1',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__vabSpuPage?.host&&document.getElementById('spuFilesInput'));
    await page.locator('#vabFileInput').setInputFiles({name:'spu-synth-demo.vab',mimeType:'application/octet-stream',buffer:asset});
    await page.waitForFunction(()=>__vabSpuPage.bank?.tones.length===3);
    await page.locator('#spuFilesInput').setInputFiles({name:'spu-synth-demo.vab',mimeType:'application/octet-stream',buffer:asset});
    await page.waitForFunction(()=>__vabSpuPage.host.project.fs.has('/spu-synth-demo.vab'));
    assert.equal(await page.evaluate(()=>__vabPublicAudio.contexts.length),0,'VAB Files/UI import remains audio-lazy');
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    await page.locator('#synthCodeEditor').fill(`
      const check=(ok,message)=>{if(!ok)throw Error(message);},ui=globalThis.__vabSpuPage;
      check(readVab===pg.readVab&&prepareVabTone===pg.prepareVabTone&&exportVab===pg.exportVab,'Code global/pg identity');
      for(const name of ['readVab','prepareVabTone','exportVab'])check(pg[name]===ui.functions[name],'Code/UI function identity '+name);
      const bytes=new Uint8Array(await file('/spu-synth-demo.vab',{type:'arrayBuffer'})),bank=readVab(bytes);
      const prepared=pg.prepareVabTone(bank,1),uiFull=exportVab(ui.bank),selected=readVab(pg.exportVab(ui.bank,{toneNumber:1}));
      check(uiFull.length===bytes.length&&uiFull.every((v,i)=>v===bytes[i]),'Code exports actual UI-owned bank without lost WeakMap provenance');
      check(selected.tones.length===1&&selected.tones[0].program===3&&selected.tones[0].index===0,'Code selected VAB');
      const ps1=await useSoundChip('ps1'),instrument=await ps1.loadADPCM(prepared.adpcm,prepared.options);
      await ps1.setPreset(CH1,{...prepared.preset,sample:instrument});await ps1.noteOn(CH1,'C4');
      log('__VAB_SYNTH_CODE__'+JSON.stringify({globalIdentity:true,uiIdentity:true,uiBankExport:true,limit:MAX_VAB_FILE_BYTES,
        preparedBytes:prepared.adpcm.length,rootFrequencyHz:instrument.rootFrequencyHz,loop:instrument.loop,loopStartSamples:instrument.loopStartSamples,
        program:selected.tones[0].program,tone:selected.tones[0].index,sourceBytes:bytes.length}));
      liveLoop('vab-code-held',async()=>{await sleep(60);});
    `);
    await page.locator('#synthCodeRunButton').click();await page.waitForFunction(()=>document.getElementById('synthCodeLog').textContent.includes('__VAB_SYNTH_CODE__')||document.getElementById('synthCodeError').textContent);
    const error=await page.locator('#synthCodeError').textContent();assert.equal(error,'','Shared Code error');
    const log=await page.locator('#synthCodeLog').textContent(),probe=JSON.parse(log.slice(log.lastIndexOf('__VAB_SYNTH_CODE__')+'__VAB_SYNTH_CODE__'.length).split('\n')[0]);
    const pcm=await measured(page,'Shared SPU Code Tone',true);await page.locator('#synthCodeStopButton').click();
    await page.waitForFunction(()=>/Stopped|Idle/.test(document.getElementById('synthCodeState').textContent));const stopped=await measured(page,'Shared Code Stop',false);
    const kept=await page.evaluate(()=>({file:Array.from(__vabSpuPage.host.project.fs.get('/spu-synth-demo.vab').data),
      bank:Array.from(__vabSpuPage.functions.exportVab(__vabSpuPage.bank)),muted:[...__vabPublicAudio.sinks.values()].every(sink=>sink.gate.gain.value===0),processors:__vabPublicAudio.processorErrors}));
    assert.deepEqual(kept.file,Array.from(asset));assert.deepEqual(kept.bank,Array.from(asset));assert(kept.muted);assert.deepEqual(kept.processors,[]);assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
    const screenshot=path.join(screenshotDir,browserName+'-synth-code.png');await page.screenshot({path:screenshot,fullPage:true});
    return{browser:browserName,version:browser.version(),execution:'synth-code',probe,pcm,stopped,uiBankKept:true,importedFileKept:true,physicalOutputMuted:true,screenshot};
  }catch(error){const state=await page.evaluate(()=>({status:document.getElementById('audioStatus')?.textContent,error:document.getElementById('synthCodeError')?.textContent,log:document.getElementById('synthCodeLog')?.textContent})).catch(()=>null);
    await page.screenshot({path:path.join(screenshotDir,browserName+'-synth-code-failed.png'),fullPage:true}).catch(()=>{});throw Error(browserName+'/synth-code: '+error.message+'\n'+JSON.stringify({state,errors,badResponses}),{cause:error});
  }finally{await context.close();}
}
(async()=>{
  let server,failure;const checkerSha256=hash(await fs.readFile(__filename)),asset=await fs.readFile(path.join(config.root,assetPath)),example=await fs.readFile(path.join(config.root,examplePath),'utf8');
  const screenshots=config.out.replace(/\.json$/,'')+'-screens';
  try{
    server=http.createServer(async(request,response)=>{try{
      const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
      if(pathname==='/__vab_api_capture.js'){response.writeHead(200,{'Content-Type':'text/javascript'}).end(processor);return;}
      let file=path.resolve(config.root,'.'+pathname);assert(file.startsWith(config.root+path.sep),'Outside docs');if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
      const original=await fs.readFile(file),name=path.relative(config.root,file),sha256=hash(original);if(served.has(name))assert.equal(served.get(name).sha256,sha256,'Served bytes changed: '+name);served.set(name,{bytes:original.length,sha256});
      const body=name==='playground/playground.js'?Buffer.concat([original,Buffer.from(hook)]):name==='synth-spu/synth.js'?Buffer.concat([original,Buffer.from(spuHook)]):original;
      const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
      response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);
    }catch(error){response.writeHead(404).end(error.message);}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{})});
      try{for(const execution of ['main','worker']){results.push(await checkCase(browser,name,execution,origin,asset,example,screenshots));console.log('PASS '+name+'/'+execution+' (physical output gain zero)');}
        results.push(await checkSynthCode(browser,name,origin,asset,screenshots));console.log('PASS '+name+'/synth-code (physical output gain zero)');
      }finally{await browser.close();}
    }
    for(const[name,entry]of served)assert.equal(hash(await fs.readFile(path.join(config.root,name))),entry.sha256,'Product source remained frozen: '+name);
    assert.equal(hash(await fs.readFile(__filename)),checkerSha256,'Checker remained frozen');
  }catch(error){failure=error;}
  finally{
    if(server)await new Promise(resolve=>server.close(resolve));await fs.mkdir(path.dirname(config.out),{recursive:true});
    await fs.writeFile(config.out,JSON.stringify({schemaVersion:1,passed:!failure,physicalOutputMuted:true,listeningPerformed:false,host:config.root,
      checkerSha256,results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})},null,2)+'\n');
  }
  if(failure)throw failure;console.log('VAB public API browser check passed: '+results.length+' routes; '+config.out);
})().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
