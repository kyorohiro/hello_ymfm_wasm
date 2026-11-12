// Real SPU Synth Code/Files integration, headless and physically silent.
// Every destination connection is intercepted before application code loads
// and passes through gain zero. Chromium also starts with --mute-audio.
// node scripts/check_spu_synth_code_browser.cjs --root=docs --entry=/synth-spu/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'spu-synth-code-browser.json'),screenshots:path.join(tmpdir(),'spu-synth-code-browser')};
for(const arg of process.argv.slice(2)){
  const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],blockedMonaco=[],httpErrors=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json',
  '.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(predicate,label,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await wait(35);}throw Error('Timeout: '+label);}

function installSilentAudit(){
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage,Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const contexts=[],nodes=[],meters=[],commands=[],captureMutes=[],pendingObserved=new WeakMap();let sequence=0,capture=null,delayNext=0,held=0;
  const nativeTimer=window.setTimeout.bind(window);
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...args){
    if(data?.method){commands.push({method:data.method,args:data.args});if(commands.length>10000)commands.shift();}
    if(data?.method==='observeCode'){let pending=pendingObserved.get(this);if(!pending)pendingObserved.set(this,pending=new Map());pending.set(data.id,delayNext);delayNext=0;}
    return post.call(this,data,...args);
  };
  let descriptor,prototype=MessagePort.prototype;
  while(prototype&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(prototype,'onmessage');prototype=Object.getPrototypeOf(prototype);}
  if(!descriptor?.set)throw Error('MessagePort callback descriptor unavailable');
  Object.defineProperty(MessagePort.prototype,'onmessage',{configurable:true,get(){return descriptor.get.call(this);},set(fn){
    if(typeof fn!=='function'){descriptor.set.call(this,fn);return;}const port=this;
    descriptor.set.call(this,event=>{const pending=pendingObserved.get(port),delay=pending?.get(event.data?.id);pending?.delete(event.data?.id);
      if(delay){held++;nativeTimer(()=>{held--;fn.call(port,event);},delay);}else fn.call(port,event);});
  }});
  const muted=()=>meters.every(item=>item.mute.gain.value===0)&&captureMutes.every(item=>item.gain.value===0);
  function sample(item){
    const values=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(values);
    let square=0,peak=0;for(const value of values){square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/values.length),peak,finite:values.every(Number.isFinite)};
  }
  const readOutput=()=>{
    const active=meters.filter(item=>item.source.context.state==='running').map(item=>sample(item)).sort((a,b)=>b.rms-a.rms);
    return{...(active[0]??{rms:0,peak:0,finite:true}),muted:muted()};
  };
  async function read(){
    const node=nodes.findLast(item=>item.name==='tetorica-spu-synth')?.node;if(!node)throw Error('SPU editor Worklet missing');
    const id=--sequence;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('SPU audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timeout);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method:'inspect',args:[]});
    });
  }
  async function beginCapture(){
    if(capture)throw Error('Capture already active');
    const source=meters.filter(item=>item.source.context.state==='running').sort((a,b)=>sample(b).rms-sample(a).rms)[0]?.source;
    if(!source)throw Error('No post-Master source');
    const name='spu-code-fade-audit-'+Math.abs(--sequence),url=URL.createObjectURL(new Blob([
      `class Capture extends AudioWorkletProcessor{process(inputs){const x=inputs[0];if(x?.[0])this.port.postMessage({frame:currentFrame,values:x[0].slice()});return true;}}registerProcessor('${name}',Capture);`
    ],{type:'text/javascript'}));
    try{await source.context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    const node=new AudioWorkletNode(source.context,name,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]}),mute=source.context.createGain();mute.gain.value=0;captureMutes.push(mute);
    const current=capture={source,node,mute,blocks:[],mark:null};
    node.port.onmessage=({data})=>{if(current.blocks.length<1024)current.blocks.push(data);};
    connect.call(source,node);connect.call(node,mute);connect.call(mute,source.context.destination);
  }
  function finishCapture(){
    const item=capture;capture=null;if(!item||item.mark===null)throw Error('Stop capture missing');
    item.source.disconnect(item.node);item.node.disconnect();item.mute.disconnect();item.node.port.close();
    const blocks=item.blocks.sort((a,b)=>a.frame-b.frame),rate=item.source.context.sampleRate;
    if(blocks.length<20)throw Error('Stop capture is too short');
    const first=blocks[0].frame,last=blocks.at(-1),values=new Float32Array(last.frame+last.values.length-first);
    let expected=first;for(const block of blocks){if(block.frame!==expected)throw Error('Stop capture has render gaps');values.set(block.values,block.frame-first);expected+=block.values.length;}
    const mark=item.mark-first;let beforePeak=0,beforeJump=0,maxJump=0,tailPeak=0,lastNonzero=null;
    for(let i=Math.max(1,mark-Math.round(.05*rate));i<values.length;i++){
      const peak=Math.abs(values[i]),jump=Math.abs(values[i]-values[i-1]);
      if(i<mark-128){beforePeak=Math.max(beforePeak,peak);beforeJump=Math.max(beforeJump,jump);}
      if(i>=mark-128&&i<mark+.04*rate)maxJump=Math.max(maxJump,jump);
      if(i>mark+.05*rate)tailPeak=Math.max(tailPeak,peak);
      if(peak>1e-8)lastNonzero=first+i;
    }
    return{frames:values.length,sampleRate:rate,beforePeak,beforeJump,maxJump,normalizedJump:maxJump/beforePeak,tailPeak,
      lastNonzeroAfterStopMs:lastNonzero===null?null:1000*(lastNonzero-item.mark)/rate,muted:muted()};
  }
  window.__spuCodeAudit={read,commands:()=>commands.slice(),armDelay(ms=400){delayNext=ms;},held:()=>held,output:readOutput,beginCapture,finishCapture,markStop(){if(!capture)throw Error('Capture missing');capture.mark=Math.round(capture.source.context.currentTime*capture.source.context.sampleRate);},
    graph(){return{contexts:contexts.length,runningContexts:contexts.filter(item=>item.state==='running').length,editorWorklets:nodes.filter(item=>item.name==='tetorica-spu-synth').length,
      destinationConnections:meters.length,captureBranches:captureMutes.length,muted:muted()};},drain(){return commands.splice(0);}};
}

async function snapshot(page){return page.evaluate(()=>__spuCodeAudit.read());}
async function stateIs(page,predicate,label){let current;await until(async()=>{current=await snapshot(page);return predicate(current);},label);return current;}
async function output(page){await wait(130);const value=await page.evaluate(()=>__spuCodeAudit.output());assert(value.finite&&value.muted,'finite output behind physical gain zero');return value;}
async function sounding(page){let value;await until(async()=>{value=await page.evaluate(()=>__spuCodeAudit.output());return value.finite&&value.muted&&value.rms>.0001;},'actual SPU PCM');return output(page);}
async function silent(page){await wait(150);await until(async()=>{const value=await page.evaluate(()=>__spuCodeAudit.output());return value.finite&&value.muted&&value.peak<1e-7;},'SPU output silence');}
async function source(page,text){await selectFile(page,'/index.js');await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function execute(page,apply=false){await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();await until(async()=>{
  const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);
  return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());
},apply?'Apply completes':'Run completes');}
async function stopped(page){await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code stopped');await silent(page);}
async function stop(page){await page.locator('#synthCodeStopButton').click();await stopped(page);}
async function range(page,id,value){await page.locator('#'+id).evaluate((input,next)=>{input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function files(page){if(await page.locator('#spuFilesPanel').isHidden())await page.locator('#spuFilesToggle').click();await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files ready');}
async function selectFile(page,filename){
  await files(page);for(let i=0;i<10;i++){const closed=page.locator('#spuFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#spuFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();
  await until(async()=>await page.locator('#spuFilesSelected').textContent()===filename&&await page.locator('#synthInputSection').getAttribute('data-input-mode')==='code'&&await page.locator('#synthCodePanel').getAttribute('data-editor-kind')===(/\.m?js$/i.test(filename)?'javascript':'text')&&(!/\.json$/i.test(filename)||/^(SPU sound loaded\.|JSON was not applied;|Text edits save)/.test(await page.locator('#spuFilesStatus').textContent())),'shared editor opens '+filename);
}
async function download(page,id){if(await page.locator(id).evaluate(node=>Boolean(node.closest('#synthMenu')))&&!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();const task=page.waitForEvent('download');await page.locator(id).click();const item=await task,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return{bytes:Buffer.concat(chunks),name:item.suggestedFilename()};}
async function savedSound(page){
  await files(page);const previous=await page.locator('#spuFilesSelected').textContent(),before=await page.evaluate(()=>({mode:document.getElementById('synthInputSection').dataset.inputMode,focus:{id:document.activeElement?.id,tag:document.activeElement?.tagName},commands:__spuCodeAudit.commands().length})),voices=await snapshot(page);await page.locator('#spuFileSaveSoundButton').click();
  await until(async()=>await page.locator('#spuFileSaveSoundButton').isEnabled()&&
    await page.locator('#spuFilesSelected').textContent()!==previous&&
    /Current SPU instrument.*saved/.test(await page.locator('#spuFilesStatus').textContent()),'Save sound');
  const after=await page.evaluate(()=>({mode:document.getElementById('synthInputSection').dataset.inputMode,focus:{id:document.activeElement?.id,tag:document.activeElement?.tagName}}));assert.equal(after.mode,before.mode,'Save sound does not switch the input mode');if(before.mode==='code')assert.deepEqual(after.focus,before.focus,'Save sound keeps the Code editor focus');assert.equal(await page.locator('#spuFileTextEditor').count(),0,'one shared editor replaces the Files textarea');assert(await page.locator('#synthCodeRunButton').isDisabled());assert(await page.locator('#synthCodeApplyButton').isDisabled());assert.equal(await page.locator('#synthCodePanel').getAttribute('data-editor-kind'),'text');assert.equal(await page.locator('#synthCodePanel').getAttribute('data-runnable'),'false');
  const current=await snapshot(page),voice=value=>({sample:value.sample,pitch:value.pitch,gate:value.gate,adsr1:value.adsr1,adsr2:value.adsr2});assert.deepEqual(current.channels.map(voice),voices.channels.map(voice),'Save sound preserves every sounding voice');const commands=(await page.evaluate(()=>__spuCodeAudit.commands())).slice(before.commands);assert(!commands.some(command=>command.method==='stop'||command.method==='beginCode'||command.method==='code'&&!['snapshot','getState','getPreset'].includes(command.args?.[1])),'saving JSON neither stops nor restarts Code');
  return JSON.parse(await page.locator('#synthCodeEditor').inputValue());
}
const control=name=>`#spuVoicePanel [data-chip-control="ps1-${name}"]`;
const HOLD=`const ps1=await useSoundChip('ps1');
await ps1.setEnvelope(CH1,{attackRate:0,decayRate:0,sustainLevel:15,sustainRate:127,releaseRate:0});
await ps1.noteOn(CH1,'A4');globalThis.__spuSaved=ps1;log('held-a4');
`;
const LIVE=`const ps1=await useSoundChip('ps1');
await ps1.setEnvelope(CH1,{attackRate:11,decayRate:3,sustainLevel:8,sustainRate:127,releaseRate:4});
await ps1.setEnvelope(CH2,{attackRate:22,decayRate:5,sustainLevel:10,sustainRate:127,releaseRate:7});
await ps1.setPreset(CH1,{reverb:true,volumeLeft:.4,volumeRight:.3});
await ps1.setReverb({preset:'room',volumeLeft:.2,volumeRight:.35});
await ps1.noteOn(CH1,'A4');await ps1.setNote(CH2,'C5');
globalThis.__spuSaved=ps1;log('spu-live-ready');
`;
async function observed(page,channel,attack){
  await until(()=>page.locator('#spuVoicePanel').getAttribute('data-observing').then(value=>value==='true'),'Code Live active');
  await until(()=>page.locator('#spuVoicePanel').getAttribute('data-observation-channel').then(value=>value===String(channel)),'observed CH '+(channel+1));
  assert(await page.locator('#spuVoicePanel').evaluate(node=>node.inert),'Live controls are read-only');
  if(attack!==undefined)await until(()=>page.locator(control('attack-rate')).inputValue().then(value=>value===String(attack)),'live attack '+attack);
}
async function editable(page){
  await until(()=>page.locator('#spuVoicePanel').getAttribute('data-observing').then(value=>value!=='true'),'authored view restored');
  assert.equal(await page.locator('#spuVoicePanel').evaluate(node=>node.inert),false);
}
const observeCount=async page=>(await page.evaluate(()=>__spuCodeAudit.commands())).filter(value=>value.method==='observeCode').length;
async function check(browser,name,origin,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'});
  const errors=[],consoleErrors=[],expectedConsole=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()!=='error')return;const text=message.text(),url=message.location().url;
    if(/cdnjs\.cloudflare\.com/.test(text+' '+url)||/^Failed to load resource/.test(text)&&blockedMonaco.length)expectedConsole.push(text);else consoleErrors.push(text);});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());
    if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}
    if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(installSilentAudit);
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Files uses compact file rows and one visible project root, with actions below the tree');
    measurements.files=await page.evaluate(()=>{
      const tree=document.getElementById('spuFilesTree'),row=tree.querySelector('.file-entry'),style=getComputedStyle(row),
        bounds=row.getBoundingClientRect(),actions=document.querySelector('.spu-files-actions');
      return{rowHeight:bounds.height,rowShadow:style.boxShadow,rowFont:parseFloat(style.fontSize),
        roots:[...document.querySelectorAll('#spuFilesPanel p,#spuFilesTree .file-tree-root')].filter(node=>node.textContent==='Project /'&&node.getClientRects().length).length,
        actionsBelowTree:actions?.getBoundingClientRect().top>=tree.getBoundingClientRect().bottom};
    });
    assert(measurements.files.rowHeight<=34);assert.equal(measurements.files.rowShadow,'none');
    assert(measurements.files.rowFont<=13);assert.equal(measurements.files.roots,1);assert.equal(measurements.files.actionsBelowTree,true);
    await fs.mkdir(config.screenshots,{recursive:true});
    await page.locator('#spuFilesPanel').screenshot({path:path.join(config.screenshots,`${name}-spu-files.png`)});
    step('Code/Files start without audio; local modules and JSON share a visible fallback editor');
    assert.equal((await page.evaluate(()=>__spuCodeAudit.graph())).contexts,0);
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    assert.match(await page.locator('#synthCodeEditor').inputValue(),/useSoundChip\(["']ps1["']\)/);
    const notes='export const notes=["A4","C5","E5"];\n';let data='{"marker":"spu-code-files"}\n';
    await page.locator('#spuFilesInput').setInputFiles([{name:'notes.js',mimeType:'text/javascript',buffer:Buffer.from(notes)},{name:'notes.json',mimeType:'application/json',buffer:Buffer.from(data)}]);
    await until(()=>page.locator('#spuFilesStatus').textContent().then(value=>/Added 2 file/.test(value)),'module/data imports');
    assert.equal((await page.evaluate(()=>__spuCodeAudit.graph())).contexts,0);
    step('Explicit JSON selection uses the shared text editor; shortcuts cannot run JSON and edits persist through rename/delete');await page.locator('#synthInputKeyboardTab').click();await until(()=>page.locator('#synthInputSection').getAttribute('data-input-mode').then(value=>value==='keyboard'),'Keyboard before JSON selection');await selectFile(page,'/notes.json');await page.locator('#synthCodeEditor').waitFor({state:'visible'});assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'code');assert.equal(await page.locator('#synthCodeEditor').inputValue(),data);assert.equal(await page.locator('#synthCodePanel').getAttribute('data-editor-kind'),'text');assert(await page.locator('#synthCodeRunButton').isDisabled());assert(await page.locator('#synthCodeApplyButton').isDisabled());data='{"marker":"spu-code-files","edited":true}\n';await page.locator('#synthCodeEditor').fill(data);await page.keyboard.press('Control+Enter');await page.keyboard.press('Control+Shift+Enter');assert.equal((await page.evaluate(()=>__spuCodeAudit.graph())).contexts,0);assert.equal(await page.locator('#synthCodeError').textContent(),'');
    async function renameFile(path){await page.locator('#spuFileRenameButton').click();await page.locator('#spuFileNameInput').fill(path);await page.locator('#spuFileNameConfirm').click();await until(()=>page.locator('#spuFilesSelected').textContent().then(value=>value===path),'renamed '+path);}
    await renameFile('/notes-renamed.json');assert.equal(await page.locator('#synthCodeEditor').inputValue(),data);assert.equal((await download(page,'#spuFileExportButton')).bytes.toString(),data);await renameFile('/notes.json');await page.locator('#spuFilesInput').setInputFiles({name:'discard.json',mimeType:'application/json',buffer:Buffer.from('{"discard":true}\n')});await until(()=>page.locator('#spuFilesStatus').textContent().then(value=>/Added 1 file/.test(value)),'temporary JSON imported');await selectFile(page,'/discard.json');await page.locator('#spuFileDeleteButton').click();await page.locator('#spuFileNameConfirm').click();await until(()=>page.locator('#spuFilesTree [data-file-path="/discard.json"]').count().then(value=>value===0),'selected JSON deleted');assert.equal(await page.locator('#synthCodeEditor').inputValue(),'');assert.equal(await page.locator('#synthCodePanel').getAttribute('data-editor-kind'),'none');assert.equal((await page.evaluate(()=>__spuCodeAudit.graph())).contexts,0);await selectFile(page,'/index.js');assert.equal(await page.locator('#synthCodePanel').getAttribute('data-editor-kind'),'javascript');assert(await page.locator('#synthCodeRunButton').isEnabled());
    await page.locator('#startAudio').click();await until(()=>page.locator('#startAudio').textContent().then(value=>/ready/i.test(value)),'SPU ready');
    await page.locator('#synthInputKeyboardTab').click();await until(()=>page.locator('#synthInputSection').getAttribute('data-input-mode').then(value=>value==='keyboard'),'Keyboard mode before passive Save sound');const baseline=await savedSound(page),initialState=await snapshot(page),presetPath=await page.locator('#spuFilesSelected').textContent();
    step('Preset JSON editing does not apply audio until that valid preset is explicitly selected again');await page.locator('#synthInputKeyboardTab').click();await selectFile(page,presetPath);await page.locator('#synthCodeEditor').waitFor({state:'visible'});const editedPreset={...baseline,preset:{...baseline.preset,volumeLeft:.41}};await page.locator('#synthCodeEditor').fill(JSON.stringify(editedPreset,null,2)+'\n');await wait(170);assert.equal((await snapshot(page)).channels[0].volumeLeft,initialState.channels[0].volumeLeft);await selectFile(page,'/index.js');await selectFile(page,presetPath);await stateIs(page,value=>value.channels[0].volumeLeft===.41,'explicit JSON selection applies the edited sound');await page.locator('#synthCodeEditor').fill(JSON.stringify(baseline,null,2)+'\n');await selectFile(page,'/index.js');await selectFile(page,presetPath);await stateIs(page,value=>value.channels[0].volumeLeft===initialState.channels[0].volumeLeft,'explicit selection restores baseline');await selectFile(page,'/index.js');
    await source(page,`const {notes}=await import('./notes.js');const data=await file('./notes.json',{type:'json'});
const ps1=await useSoundChip('ps1');context.marker=data.marker;
for(let channel=0;channel<3;channel++)await ps1.noteOn(channel,notes[channel]);log('files-ready',context.marker);`);
    await execute(page);await sounding(page);let state=await stateIs(page,value=>[0,1,2].every(ch=>value.channels[ch].gate),'three physical SPU gates');
    assert.match(await page.locator('#synthCodeLog').textContent(),/files-ready spu-code-files/);
    const firstGraph=await page.evaluate(()=>__spuCodeAudit.graph());assert.equal(firstGraph.contexts,1);assert.equal(firstGraph.editorWorklets,1);assert(firstGraph.muted);
    await page.locator('#synthCodeEditor').focus();assert.deepEqual(await savedSound(page),baseline,'Code notes do not replace the authored instrument');
    const savedWhileRunning=await page.locator('#spuFilesSelected').textContent();await page.locator('#spuFileDeleteButton').click();await page.locator('#spuFileNameConfirm').click();await until(()=>page.locator('#spuFilesTree [data-file-path='+JSON.stringify(savedWhileRunning)+']').count().then(value=>value===0),'saved JSON deleted while old JS plays');assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);await sounding(page);assert(await page.locator('#synthCodeStopButton').isEnabled());await stop(page);state=await snapshot(page);assert(state.channels.every(value=>!value.gate));
    assert.deepEqual(state.samples,initialState.samples);assert.equal(state.nextAddress,initialState.nextAddress);

    step('Code Live follows applied CH values, is read-only and preserves authored sample data');
    await source(page,LIVE);await execute(page);await observed(page,0,11);
    assert(await page.locator('#spuLiveEnabled').isChecked(),'Code Live defaults to On');
    assert.deepEqual(await savedSound(page),baseline);const before=await snapshot(page);await page.evaluate(()=>__spuCodeAudit.drain());
    await page.locator('#spuLiveChannel').selectOption('1');await observed(page,1,22);
    assert.deepEqual((await page.evaluate(()=>__spuCodeAudit.commands())).filter(value=>value.method==='code'),[],'selecting an observation channel writes no voice settings');
    const after=await snapshot(page);for(const ch of [0,1])assert.equal(after.channels[ch].adsr1,before.channels[ch].adsr1);
    assert.equal(await page.locator(control('reverb-preset')).inputValue(),'room');
    await page.locator('[data-spu-editor-tab="adsr"]').click();
    await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await wait(80);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Live layout fits '+width);await page.screenshot({path:path.join(config.screenshots,`${name}-spu-code-live-${width}.png`),fullPage:true});}
    await page.setViewportSize({width:1240,height:1050});
    await page.locator('#spuLiveEnabled').uncheck();await editable(page);await wait(100);const offCount=await observeCount(page);await wait(200);
    assert.equal(await observeCount(page),offCount,'Live Off stops observation requests');assert.match(await page.locator('#synthCodeState').textContent(),/Running/);
    await page.evaluate(async()=>__spuSaved.setEnvelope(1,{attackRate:33}));
    assert.equal(await page.locator(control('attack-rate')).inputValue(),String(initialState.channels[0].envelopeParameters.attackRate));
    await page.locator('#spuLiveEnabled').check();await observed(page,1,33);
    const count=await observeCount(page);await wait(250);const polls=await observeCount(page)-count;assert(polls>0&&polls<=8);measurements.pollingSamplesIn250ms=polls;
    await page.evaluate(()=>__spuCodeAudit.armDelay());await until(()=>page.evaluate(()=>__spuCodeAudit.held()>0),'one old observation held');
    await stop(page);await editable(page);await wait(500);assert.equal(await page.locator('#spuVoicePanel').getAttribute('data-observing'),'false');
    assert.deepEqual(await savedSound(page),baseline);assert.equal(await page.locator(control('attack-rate')).inputValue(),String(initialState.channels[0].envelopeParameters.attackRate));

    step('liveFx processes the shared SPU PCM once and Master retains its calibrated single route');
    const fxHold=HOLD.replace("await ps1.noteOn(CH1,'A4');","if(!context.fxHeld){await ps1.noteOn(CH1,'A4');context.fxHeld=true;}");
    await source(page,fxHold);await execute(page);await sounding(page);await wait(150);const full=await output(page);
    const halfFx=`liveFx('half',{process(input,output){for(let ch=0;ch<output.length;ch++)for(let i=0;i<output[ch].length;i++)output[ch][i]=(input[ch]?.[i]??0)*.5;}});`;
    await page.locator('#synthCodeEditor').fill(fxHold+halfFx);await execute(page,true);await wait(150);const half=await output(page);
    assert(Math.abs(half.rms/full.rms-.5)<.08,'liveFx halves real PCM: '+JSON.stringify({full,half}));
    await page.locator('#synthCodeEditor').fill(fxHold);await execute(page,true);await wait(150);const restored=await output(page);
    assert(Math.abs(restored.rms/full.rms-1)<.1,'removing FX restores the direct held output');
    await range(page,'masterVolume',1);const masterFull=await output(page);await range(page,'masterVolume',.5);const masterHalf=await output(page);
    assert(Math.abs(masterHalf.rms/masterFull.rms-.5)<.08);await range(page,'masterVolume',.7);
    measurements.liveFx={full,half,restored};measurements.master={full:masterFull,half:masterHalf};await stop(page);

    step('Apply preserves context/named loops, and Stop fades PCM then retires every old Code client');
    const loop=`const ps1=await useSoundChip('ps1');context.applies=(context.applies??0)+1;log('applies',context.applies);
globalThis.__spuLoop??={active:0,max:0,ticks:0};liveLoop('phrase',async()=>{const p=globalThis.__spuLoop;p.active++;p.max=Math.max(p.max,p.active);
try{await ps1.noteOn(CH1,'A4');await sleep(.04);await ps1.noteOff(CH1);p.ticks++;await beat(.25);}finally{p.active--;}});`;
    await source(page,loop);await execute(page);await until(()=>page.evaluate(()=>__spuLoop.ticks>=1),'loop ticks');
    await page.locator('#synthCodeEditor').fill(loop);await execute(page,true);await until(()=>page.evaluate(()=>__spuLoop.ticks>=3),'retained loop ticks');
    assert.equal(await page.evaluate(()=>__spuLoop.max),1);assert.match(await page.locator('#synthCodeLog').textContent(),/applies 2/);
    await source(page,HOLD);await execute(page);await sounding(page);await page.evaluate(()=>__spuCodeAudit.beginCapture());await wait(100);
    await page.evaluate(()=>{__spuCodeAudit.markStop();document.getElementById('synthCodeStopButton').click();});await stopped(page);await wait(130);
    const fade=await page.evaluate(()=>__spuCodeAudit.finishCapture());assert(fade.muted&&fade.beforePeak>.0001&&fade.tailPeak<1e-7);
    assert(fade.normalizedJump<.5,'bounded Stop discontinuity: '+JSON.stringify(fade));assert(fade.lastNonzeroAfterStopMs<45);measurements.fade=fade;
    const stale=await page.evaluate(async()=>{try{await __spuSaved.noteOn(0,'C6');return false;}catch(error){return error.name==='AbortError';}});assert(stale);await silent(page);

    step('Code RAM reset/upload is temporary; keyboard returns to the exact authored bank and instrument');
    await source(page,`const ps1=await useSoundChip('ps1');await ps1.reset({clearRam:true});
const bytes=new Uint8Array(16);bytes[0]=12;bytes[1]=1;
const sample=await ps1.loadADPCM(bytes,{baseFrequencyHz:440});await ps1.setPreset(CH1,{sample});log('temporary-bank');`);
    await execute(page);assert((await snapshot(page)).samples.length<initialState.samples.length);await stop(page);
    state=await snapshot(page);assert.deepEqual(state.samples,initialState.samples);assert.equal(state.nextAddress,initialState.nextAddress);assert.deepEqual(await savedSound(page),baseline);
    await source(page,HOLD);await execute(page);await page.locator('#synthInputKeyboardTab').click();await silent(page);
    const key=await page.locator('#keyboardKeys .key:not([disabled])').first().getAttribute('data-key');assert(key);
    await page.keyboard.down(key);await stateIs(page,value=>value.auditions.length>0,'keyboard note after Code');await sounding(page);await page.keyboard.up(key);await page.locator('#stopAudio').click();await silent(page);

    step('Files project ZIP retains code/modules/data/samples; import and reload never start audio or Code');
    await source(page,'globalThis.__spuProjectRan=(globalThis.__spuProjectRan??0)+1;\n');
    const archive=await download(page,'#spuProjectExportButton'),contents=await loadCassette(archive.bytes);
    for(const[file,expected]of [['notes.js',notes],['notes.json',data],['index.js','globalThis.__spuProjectRan=(globalThis.__spuProjectRan??0)+1;\n']])assert.equal(Buffer.from(contents.files.get(file)).toString(),expected);
    assert(contents.files.has('spu-synth.project.json'));
    const sounds=[...contents.files].filter(([path])=>path.startsWith('presets/')&&path.endsWith('.spu.json'));
    assert(sounds.length>=2,'named saves retain multiple sound files');
    for(const[,bytes]of sounds)assert.deepEqual(JSON.parse(Buffer.from(bytes).toString()),baseline,'Code saves the authored instrument');
    await page.locator('#spuProjectFileInput').setInputFiles({name:'roundtrip.cassette.zip',mimeType:'application/zip',buffer:archive.bytes});
    await until(()=>page.locator('#spuFilesStatus').textContent().then(value=>/project imported/.test(value)),'project imported');
    assert.equal(await page.evaluate(()=>typeof __spuProjectRan),'undefined');await silent(page);
    await page.reload();await files(page);await until(()=>page.locator('#synthCodeEditor').inputValue().then(value=>value.includes('__spuProjectRan')),'restored source');
    assert.equal(await page.evaluate(()=>typeof __spuProjectRan),'undefined');assert.equal((await page.evaluate(()=>__spuCodeAudit.graph())).contexts,0);
    await selectFile(page,'/notes.json');assert.equal(await page.locator('#synthCodeEditor').inputValue(),data);assert(await page.locator('#synthCodeRunButton').isDisabled());await until(()=>page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('tetorica-spu-synth-files',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,request=db.transaction('projects','readonly').objectStore('projects').get('current');request.onerror=()=>{db.close();reject(request.error);};request.onsuccess=()=>{const value=request.result;db.close();resolve(value?.codeState?.path==='/notes.json'&&value.codeState.mode==='code');};};})),'JSON active path autosaved before reload');await page.reload();await files(page);await until(()=>page.locator('#synthCodeEditor').inputValue().then(value=>value===data),'selected JSON restores in shared editor');assert.equal(await page.locator('#synthCodePanel').getAttribute('data-editor-kind'),'text');assert.equal((await page.evaluate(()=>__spuCodeAudit.graph())).contexts,0);assert.equal(await page.evaluate(()=>typeof __spuProjectRan),'undefined');
    await selectFile(page,'/index.js');await source(page,HOLD);await execute(page);await sounding(page);

    step('Code maximizes beside Files at 1240/390px and pagehide stops its held notes');
    await page.locator('#synthCodeExpandButton').click();assert.equal(await page.locator('#synthCodeExpandButton').getAttribute('aria-pressed'),'true');
    assert(await page.locator('#synthExpandedCodeSlot #synthCodePanel').isVisible());assert(await page.locator('#spuFilesPanel').isVisible());
    await fs.mkdir(config.screenshots,{recursive:true});
    for(const width of [1240,390]){await page.setViewportSize({width,height:1050});await wait(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'layout fits '+width);await page.screenshot({path:path.join(config.screenshots,`${name}-spu-code-${width}.png`),fullPage:true});}
    await page.locator('#synthCodeExpandButton').click();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await stopped(page);await editable(page);
    assert.equal(await page.locator('#synthCodeError').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    const graph=await page.evaluate(()=>__spuCodeAudit.graph());assert(graph.muted);assert.equal(graph.contexts,1);assert.equal(graph.editorWorklets,1);measurements.graph=graph;
    return{browser:name,passed:true,checks,measurements,errors,consoleErrors,expectedFallbackConsole:expectedConsole};
  }catch(error){
    await fs.mkdir(config.screenshots,{recursive:true});try{await page.screenshot({path:path.join(config.screenshots,name+'-spu-code-failure.png'),fullPage:true});}catch{}
    let diagnostic;try{diagnostic=await page.evaluate(async()=>({state:await __spuCodeAudit.read().catch(()=>null),editor:{kind:document.getElementById('synthCodePanel').dataset.editorKind,runnable:document.getElementById('synthCodePanel').dataset.runnable,mode:document.getElementById('synthInputSection').dataset.inputMode,selected:document.getElementById('spuFilesSelected').textContent,text:document.getElementById('synthCodeEditor').value.slice(0,600)},output:__spuCodeAudit.output(),graph:__spuCodeAudit.graph(),
      code:document.getElementById('synthCodeState')?.textContent,error:document.getElementById('synthCodeError')?.textContent,log:document.getElementById('synthCodeLog')?.textContent,
      live:document.getElementById('spuLiveStatus')?.textContent,panel:{...document.getElementById('spuVoicePanel').dataset},commands:__spuCodeAudit.commands().slice(-30)}));}catch{}
    error.receipt={browser:name,passed:false,stage,error:error.stack,checks,measurements,diagnostic,errors,consoleErrors};throw error;
  }finally{await page.close();}
}

const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);
  res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  const{loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href);
  let failure;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin,loadPlaygroundCassette));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);assert(blockedMonaco.length,'Monaco fallback exercised');
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,
    assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack}: {})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
