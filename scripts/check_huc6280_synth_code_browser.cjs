// SPDX-License-Identifier: BSD-3-Clause
// Real one-chip HuC6280 Code/Files checks, with all destinations muted before JS.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',
  out:path.join(tmpdir(),'huc6280-synth-code-browser.json'),screenshots:path.join(tmpdir(),'huc6280-synth-code-images')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const served=new Map(),missing=[],external=[],httpErrors=[],blockedMonaco=[],results=[],namedResources={};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.ico':'image/x-icon'};
async function until(check,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await wait(30);}throw Error('Timeout: '+label);}

function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const contexts=[],nodes=[],meters=[],commands=[],captureMutes=[];let request=0,capture=null;
  const compact=value=>{
    if(typeof value==='string'&&value.length>512)return{stringLength:value.length,prefix:value.slice(0,80)};
    if(ArrayBuffer.isView(value))return{type:value.constructor.name,length:value.length};
    if(Array.isArray(value))return value.length>128?{arrayLength:value.length}:value.map(compact);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,compact(item)]));
    return value;
  };
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=4096;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({source:this,analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(message,...args){
    if(message?.method){commands.push({method:message.method,args:compact(message.args??[])});if(commands.length>1500)commands.shift();}
    return post.call(this,message,...args);
  };
  const muted=()=>meters.every(item=>item.mute.gain.value===0)&&captureMutes.every(item=>item.gain.value===0);
  function sample(item){
    const values=new Float32Array(item.analyser.fftSize);item.analyser.getFloatTimeDomainData(values);
    let sum=0,square=0,peak=0;for(const value of values){sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2)),peak,finite:values.every(Number.isFinite)};
  }
  const output=()=>{
    const active=meters.filter(item=>item.source.context.state==='running').map(sample).sort((a,b)=>b.acRms-a.acRms);
    return{...(active[0]??{rms:0,acRms:0,peak:0,finite:true}),muted:muted()};
  };
  async function read(method='read',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-huc6280-synth')?.node;if(!node)throw Error('HuC6280 editor Worklet missing');
    const id=--request;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('HuC6280 audit read timed out'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Object.assign(Error(data.error),{name:data.name??'Error'})):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});
    });
  }
  async function beginCapture(){
    if(capture)throw Error('Capture already active');
    const source=meters.filter(item=>item.source.context.state==='running').sort((a,b)=>sample(b).acRms-sample(a).acRms)[0]?.source;
    if(!source)throw Error('No running post-Master output');
    const name='huc-code-stop-audit-'+Math.abs(--request),url=URL.createObjectURL(new Blob([
      `class Capture extends AudioWorkletProcessor{process(inputs){const x=inputs[0];if(x?.[0])this.port.postMessage({frame:currentFrame,values:x[0].slice()});return true;}}registerProcessor('${name}',Capture);`
    ],{type:'text/javascript'}));
    try{await source.context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    const node=new AudioWorkletNode(source.context,name,{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]}),mute=source.context.createGain();mute.gain.value=0;captureMutes.push(mute);
    const item=capture={source,node,mute,blocks:[],mark:null};node.port.onmessage=({data})=>{if(item.blocks.length<1024)item.blocks.push(data);};
    connect.call(source,node);connect.call(node,mute);connect.call(mute,source.context.destination);
  }
  function finishCapture(){
    const item=capture;capture=null;if(!item||item.mark===null)throw Error('Stop mark missing');
    item.source.disconnect(item.node);item.node.disconnect();item.mute.disconnect();item.node.port.close();
    const blocks=item.blocks.sort((a,b)=>a.frame-b.frame),rate=item.source.context.sampleRate;assertCapture(blocks.length>=20,'Capture too short');
    const first=blocks[0].frame,last=blocks.at(-1),values=new Float32Array(last.frame+last.values.length-first);let expected=first;
    for(const block of blocks){assertCapture(block.frame===expected,'Capture render gap');values.set(block.values,block.frame-first);expected+=block.values.length;}
    const mark=item.mark-first;let beforePeak=0,beforeJump=0,maxJump=0,tailPeak=0;
    for(let i=Math.max(1,mark-Math.round(.05*rate));i<values.length;i++){
      const peak=Math.abs(values[i]),jump=Math.abs(values[i]-values[i-1]);
      if(i<mark-128){beforePeak=Math.max(beforePeak,peak);beforeJump=Math.max(beforeJump,jump);}
      if(i>=mark-128&&i<mark+.04*rate)maxJump=Math.max(maxJump,jump);
      if(i>mark+.05*rate)tailPeak=Math.max(tailPeak,peak);
    }
    return{frames:values.length,sampleRate:rate,beforePeak,beforeJump,maxJump,normalizedJump:beforePeak?maxJump/beforePeak:null,tailPeak,muted:muted()};
  }
  function assertCapture(value,message){if(!value)throw Error(message);}
  window.__hucCodeAudit={read,output,beginCapture,finishCapture,markStop(){if(!capture)throw Error('Capture missing');capture.mark=Math.round(capture.source.context.currentTime*capture.source.context.sampleRate);},
    graph:()=>({contexts:contexts.length,editorWorklets:nodes.filter(item=>item.name==='tetorica-huc6280-synth').length,destinationConnections:meters.length,muted:muted()}),drain:()=>commands.splice(0)};
}
const read=(page,method='read',args=[])=>page.evaluate(({method,args})=>__hucCodeAudit.read(method,args),{method,args});
const observe=page=>read(page,'observeCode'),graph=page=>page.evaluate(()=>__hucCodeAudit.graph());
async function pcm(page,nonzero=true){let value;await until(async()=>{value=await page.evaluate(()=>__hucCodeAudit.output());return value.finite&&value.muted&&(nonzero?value.acRms>.00005:value.peak<1e-7);},nonzero?'actual HuC6280 PCM':'muted source silence');return value;}
async function files(page){if(await page.locator('#hucFilesPanel').isHidden())await page.locator('#hucFilesToggle').click();await until(()=>page.locator('#hucFileImportButton').isEnabled(),'Files ready');}
async function selectFile(page,filename,{code=false}={}){
  await files(page);for(let n=0;n<16;n++){const closed=page.locator('#hucFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator('#hucFilesTree button[data-file-path]').locator(`xpath=self::*[@data-file-path=${JSON.stringify(filename)}]`).click();
  await until(()=>page.locator('#hucFilesSelected').textContent().then(text=>text===filename),'selected '+filename);
  if(code)await page.locator('#synthInputCodeTab').click();
}
async function source(page,text){await selectFile(page,'/index.js',{code:true});await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);}
async function execute(page,apply=false){await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();if(error)throw Error(error);return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},apply?'Apply':'Run');}
async function stop(page){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(text=>/Stopped|Idle/.test(text)),'Code stopped');await wait(130);await pcm(page,false);}
async function download(page,selector){
  if(await page.locator(selector).evaluate(node=>Boolean(node.closest('#synthMenu')))&&!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const pending=page.waitForEvent('download');await page.locator(selector).click();const item=await pending,chunks=[];for await(const chunk of await item.createReadStream())chunks.push(chunk);return{name:item.suggestedFilename(),bytes:Buffer.concat(chunks)};
}
const sine=Array.from({length:32},(_,i)=>Math.round(15.5+15.5*Math.sin(i*Math.PI/16))),otherWave=Array.from({length:32},(_,i)=>(i*7)%32);
const HOLD=`const pce=await useSoundChip('huc6280');
const {notes}=await import('./notes.mjs');
const data=await file('./data.json',{type:'json'});
await livePrepare('hardware',async()=>{
  await pce.initialize();await pce.setMasterVolume(15,15);
  await pce.setWaveform(CH1,${JSON.stringify(sine)});
  await pce.setWaveform(CH2,${JSON.stringify(otherWave)});
  await pce.setWaveform(CH3,${JSON.stringify(sine)});
  await pce.setVolume(CH1,20);await pce.setVolume(CH2,0);await pce.setVolume(CH3,17);await pce.setVolume(CH5,13);
  for(const ch of [CH1,CH2,CH3,CH5])await pce.setPan(ch,15,15);
  await pce.setFrequency(CH2,110);await pce.keyOn(CH2);
  await pce.setLfo({frequency:17,depth:2,reset:false});
  await pce.setNoise(CH5,{enabled:true,frequency:12});
  await pce.noteOn(CH1,notes[0]);await pce.noteOn(CH3,notes[1]);await pce.keyOn(CH5);
  await pce.writeRegister(0,CH3);await pce.writeRegister(5,0xed);
  return {ready:true};
});
context.count=(context.count??0)+1;globalThis.__hucSaved=pce;
log('huc-apply-count',context.count,data.marker);
`;
const OWNER=`const pce=await useSoundChip('huc6280');
await pce.initialize();await pce.setLfo({frequency:0,depth:0});
await pce.setWaveform(CH1,${JSON.stringify(sine)});await pce.setVolume(CH1,20);await pce.setPan(CH1,15,15);await pce.noteOn(CH1,'A3');
globalThis.__hucSaved=pce;`;
const MOTION=`const pce=await useSoundChip('huc6280');
setBpm(120);context.boots=(context.boots??0)+1;
const prepared=await livePrepare('motion',()=>({visits:0}));
globalThis.__hucMotion={pce,prepared,context,ticks:0,source:null};
liveFx('huc-level',{context:{gain:.5},process(input,output,state,context){for(let ch=0;ch<input.length;ch++)for(let i=0;i<input[ch].length;i++)output[ch][i]=input[ch][i]*context.gain;}});
liveLoop('melody',async()=>{
  const s=globalThis.__hucMotion;s.source=(await pce.getState()).editorSource;s.ticks++;prepared.visits++;
  const ch=s.source==='noise'?CH5:CH1;await pce.noteOn(ch,'A3');
  await tween(.12,async p=>{await pce.setPan(ch,15,Math.round(8+7*p));});
  await pce.noteOff(ch);await beat(.125);
});
`;

async function check(browser,name,origin,fixture){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'}),errors=[],consoleErrors=[],checks=[],measurements={};let stage='startup';
  page.setDefaultTimeout(25000);await page.addInitScript(installSilentAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error'&&!/cdnjs|Failed to load resource/.test(message.text()+' '+message.location().url))consoleErrors.push(message.text());});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  const step=text=>{stage=text;checks.push(text);console.log(`CHECK ${name}: ${text}`);};
  try{
    await page.goto(origin+config.entry);await files(page);
    step('Code and Files are lazy; binary/text imports and JSON editing never run or initialize audio');
    assert.equal((await graph(page)).contexts,0);await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    assert.match(await page.locator('#synthCodeEditor').inputValue(),/useSoundChip\("huc6280"\)/);
    await page.locator('#hucFilesInput').setInputFiles([
      {name:'notes.mjs',mimeType:'text/javascript',buffer:Buffer.from('export const notes=["A3","E4"];\n')},
      {name:'data.json',mimeType:'application/json',buffer:Buffer.from('{"marker":"huc-code-files"}\n')},
      {name:'support.bin',mimeType:'application/octet-stream',buffer:Buffer.from([0,1,16,31,128,255])},
    ]);await until(()=>page.locator('#hucFilesStatus').textContent().then(text=>/Added 3/.test(text)),'module/data/binary import');
    await page.locator('#synthInputKeyboardTab').click();await selectFile(page,'/data.json');
    assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');await page.locator('#synthInputCodeTab').click();assert.match(await page.locator('#synthCodeEditor').inputValue(),/huc-code-files/);
    assert(await page.locator('#synthCodeRunButton').isDisabled());assert.equal((await graph(page)).contexts,0);

    step('Code plays Wave, Noise and hardware LFO on one existing six-channel Worklet and preserves the authored preset');
    await page.locator('#synthInputKeyboardTab').click();await page.locator('#startAudio').click();await until(async()=>{try{return Boolean((await read(page)).preset);}catch{return false;}},'HuC6280 ready');
    const author=(await read(page)).preset;await source(page,HOLD);await execute(page);await until(()=>page.locator('#synthCodeLog').textContent().then(text=>/huc-apply-count 1 huc-code-files/.test(text)),'first prepared Code');
    let state=await observe(page);assert(state.initialized);assert.equal(state.globals[8],17);assert.equal(state.globals[9]&3,2);assert.equal(state.registers[4][7]&159,140);
    assert.deepEqual(state.waveforms[0],sine);assert.deepEqual(state.waveforms[1],otherWave);assert.equal(state.registers[2][5],0xed);assert(state.registers[0][4]&128);assert(state.registers[2][4]&128);assert(state.registers[4][4]&128);
    assert.deepEqual((await read(page)).preset,author);measurements.hardware=await pcm(page);
    measurements.sharedGraph=await graph(page);assert.deepEqual(measurements.sharedGraph,{contexts:1,editorWorklets:1,destinationConnections:1,muted:true});

    step('Apply keeps context and livePrepare; physical CH edits and wave drawing touch only the selected voice');
    await page.evaluate(()=>__hucCodeAudit.drain());await page.locator('#synthCodeEditor').fill(HOLD+'\nawait pce.setVolume(CH3,11);\n');await execute(page,true);
    await until(()=>page.locator('#synthCodeLog').textContent().then(text=>/huc-apply-count 2/.test(text)),'retained Apply context');
    assert.equal((await observe(page)).registers[2][4]&31,11);assert(!(await page.evaluate(()=>__hucCodeAudit.drain())).some(cmd=>cmd.method==='beginCode'));
    await page.locator('#hucChannelSelect').selectOption('2');await until(()=>page.locator('#hucChannelReadout').textContent().then(text=>/CH\s*3/.test(text)),'physical CH3 view');
    const before=await observe(page);await page.locator('[data-stepper-for="volume"][data-stepper-delta="1"]').click();
    await until(async()=>{if(await page.locator('#audioStatus').getAttribute('data-error')==='true')throw Error(await page.locator('#audioStatus').textContent());return(await observe(page)).registers[2][4]%32===12;},'sparse physical channel volume');
    state=await observe(page);assert.equal(state.registers[2][2],before.registers[2][2]);assert.equal(state.registers[2][3],before.registers[2][3]);assert.equal(state.registers[2][5],before.registers[2][5]);assert.deepEqual(state.registers[0],before.registers[0]);assert.deepEqual(state.registers[4],before.registers[4]);
    const canvas=page.locator('#waveCanvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert(box);
    await page.mouse.move(box.x+box.width*.25,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.55,box.y+box.height*.75,{steps:8});await page.mouse.up();
    await until(async()=>JSON.stringify((await observe(page)).waveforms[2])!==JSON.stringify(before.waveforms[2]),'selected channel wave draw');
    state=await observe(page);assert(state.registers[2][4]&128);assert.deepEqual(state.waveforms[0],before.waveforms[0]);
    const authorAfterEdits=(await read(page)).preset;assert.deepEqual(authorAfterEdits,{...author,volume:12,wave:state.waveforms[2]},'only manual touched fields enter the authored sound');assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    await page.evaluate(()=>__hucSaved.noteOff(2));await until(async()=>!((await observe(page)).registers[2][4]&128),'Code releases the same note after a waveform edit');
    await stop(page);assert.equal(await observe(page),null);assert.deepEqual((await read(page)).preset,authorAfterEdits);
    assert.equal(await page.evaluate(async()=>{try{await __hucSaved.noteOn(0,'C5');return'allowed';}catch(error){return error.name;}}),'AbortError');

    step('Code and Keyboard views share physical CH ownership; an old release cannot cut the newer performer');
    await source(page,OWNER);await execute(page);await pcm(page);await page.locator('#hucChannelSelect').selectOption('0');await page.locator('#synthInputKeyboardTab').click();
    const key=await page.locator('#keyboard .key:not([disabled])').first().getAttribute('data-key');assert(key);
    await page.locator('#synthTitle').click();await page.keyboard.down(key);await until(async()=>Boolean((await observe(page)).registers[0][4]&128),'manual selected CH gate');
    await page.evaluate(()=>__hucSaved.noteOff(0));assert((await observe(page)).registers[0][4]&128,'older Code off does not stop manual key');
    await page.evaluate(()=>__hucSaved.noteOn(0,'A4'));const replacement=(await observe(page)).registers[0].slice();await page.keyboard.up(key);
    await wait(80);state=await observe(page);assert(state.registers[0][4]&128);assert.equal(state.registers[0][2],replacement[2]);assert.equal(state.registers[0][3],replacement[3]);
    assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);await page.locator('#synthInputCodeTab').click();await stop(page);

    step('Independent software loops, tween and liveFx continue through preset loads and manual editor changes');
    await source(page,MOTION.replace('context:{gain:.5}','context:{gain:0}'));await execute(page);await page.locator('#hucChannelSelect').selectOption('synth');await until(()=>page.evaluate(()=>__hucMotion.ticks>=2),'liveLoop ticks');
    measurements.fxSilence=await pcm(page,false);await page.evaluate(()=>{globalThis.__hucPreparedBefore=__hucMotion.prepared;globalThis.__hucContextBefore=__hucMotion.context;});
    await page.locator('#synthCodeEditor').fill(MOTION);await execute(page,true);await until(()=>page.evaluate(()=>__hucMotion.ticks>=2),'loop after FX context Apply');measurements.fxOutput=await pcm(page);
    assert(await page.evaluate(()=>__hucPreparedBefore===__hucMotion.prepared&&__hucContextBefore===__hucMotion.context),'Apply retains prepared objects and live context');
    const livePresets=[fixture.wave,fixture.noise].map((value,i)=>({name:`Code-live-${i}.huc6280.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))}));
    await page.locator('#hucFilesInput').setInputFiles(livePresets);await until(()=>page.locator('#hucFilesStatus').textContent().then(text=>/Added 2/.test(text)),'live preset imports');
    for(let i=0;i<2;i++){
      const ticks=await page.evaluate(()=>__hucMotion.ticks);await selectFile(page,`/presets/Code-live-${i}.huc6280.json`);
      await until(()=>page.evaluate(expected=>__hucMotion.source===expected&&__hucMotion.ticks>0,i?'noise':'wave'),'new authored source reaches next Code note');
      await until(()=>page.evaluate(ticks=>__hucMotion.ticks>ticks,ticks),'loop continues after preset');
      assert.equal(await page.evaluate(()=>__hucMotion.context.boots),2);assert(await page.evaluate(()=>__hucMotion.prepared.visits>1));await pcm(page);
      assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    }
    measurements.fxGraph=await graph(page);assert.equal(measurements.fxGraph.contexts,1);assert.equal(measurements.fxGraph.editorWorklets,1);assert.equal(measurements.fxGraph.destinationConnections,1);
    await page.locator('#synthInputCodeTab').click();await stop(page);

    step('DDA Code notes use the existing software sample feeder and restore the full authored PCM');
    await page.locator('#presetFileInput').setInputFiles({name:'Code-DDA.huc6280.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.dda))});
    await until(async()=>(await read(page)).preset.source==='dda','DDA authored source');
    await source(page,`const pce=await useSoundChip('huc6280');globalThis.__hucSaved=pce;await pce.noteOn(CH1,'C4');`);await execute(page);await pcm(page);
    const ddaBefore=await observe(page);assert(ddaBefore.registers[0][4]&64);assert(ddaBefore.registers[0][4]&128);assert.equal(ddaBefore.dda.samples,1024);assert.equal(ddaBefore.ddaVoices[0].sampleRate,8192);await wait(80);
    const ddaAfter=await observe(page);assert(ddaAfter.positionFrames>ddaBefore.positionFrames);assert(ddaAfter.ddaVoices[0].position>=0&&ddaAfter.ddaVoices[0].position<1024);measurements.dda=await pcm(page);
    await stop(page);const restored=(await read(page)).preset;assert.equal(restored.dda.name,fixture.dda.dda.name);assert.equal(restored.dda.sampleRate,fixture.dda.dda.sampleRate);assert.equal(restored.dda.loop,true);

    step('Software Stop fades actual output to silence and invalidates the saved Code client');
    await source(page,OWNER);await execute(page);await pcm(page);await wait(130);await page.evaluate(()=>__hucCodeAudit.beginCapture());await wait(100);
    await page.locator('#synthCodeStopButton').evaluate(button=>button.addEventListener('click',()=>__hucCodeAudit.markStop(),{once:true,capture:true}));
    await stop(page);await wait(160);measurements.stopFade=await page.evaluate(()=>__hucCodeAudit.finishCapture());
    assert(measurements.stopFade.beforePeak>.0001);assert(measurements.stopFade.tailPeak<1e-7);assert(measurements.stopFade.normalizedJump<1);assert(measurements.stopFade.muted);
    assert.equal(await page.evaluate(async()=>{try{await __hucSaved.getState();return'allowed';}catch(error){return error.name;}}),'AbortError');

    step('Files project roundtrip retains preset/PCM/Code/binary without autoplay, and Code fits desktop and 390px');
    await source(page,'// Restored source must never execute itself.\nglobalThis.__hucUnexpectedAutoRun=true;\n');await page.keyboard.press('Control+s');
    await page.locator('#hucFileSaveSoundButton').click();await until(()=>page.locator('#hucFilesStatus').textContent().then(text=>text.startsWith('Saved to /presets/')),'save authored sound');
    const sound=JSON.parse(await page.locator('#synthCodeEditor').inputValue());assert.equal(sound.format,'tetorica-huc6280-voice');assert.equal(sound.source,'dda');assert.equal(sound.dda.data,fixture.dda.dda.data);
    assert(await page.locator('#synthCodeRunButton').isDisabled());await selectFile(page,'/index.js',{code:true});
    const projectDownload=await download(page,'#hucProjectExportButton'),project=await fixture.loadCassette(projectDownload.bytes);
    for(const filename of ['index.js','notes.mjs','data.json','support.bin','huc6280-synth.project.json'])assert(project.files.has(filename),filename);
    assert.deepEqual(Buffer.from(project.files.get('support.bin')),Buffer.from([0,1,16,31,128,255]));
    await page.locator('#hucProjectFileInput').setInputFiles({name:'huc-project.zip',mimeType:'application/zip',buffer:projectDownload.bytes});
    await until(()=>page.locator('#hucFilesStatus').textContent().then(text=>/HuC6280 project imported/.test(text)),'project import');await selectFile(page,'/index.js',{code:true});await page.keyboard.press('Control+s');await wait(200);
    await page.reload();await files(page);await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    assert.match(await page.locator('#synthCodeEditor').inputValue(),/hucUnexpectedAutoRun/);assert.equal(await page.evaluate(()=>globalThis.__hucUnexpectedAutoRun),undefined);assert.equal((await graph(page)).contexts,0);assert.match(await page.locator('#synthCodeState').textContent(),/Idle|Stopped/);
    for(const width of [1240,390]){
      await page.setViewportSize({width,height:1050});await page.locator('#synthCodeExpandButton').click();assert(await page.locator('#synthExpandedCodeSlot #synthCodeEditor').isVisible());assert(await page.locator('#hucFilesPanel').isVisible());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'expanded layout fits '+width);await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-'+width+'.png'),fullPage:true});
      await page.locator('#synthCodeExpandButton').click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'normal layout fits '+width);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);return{browser:name,passed:true,checks,measurements,graph:await graph(page),pageErrors:errors,consoleErrors};
  }catch(error){
    const diagnostic={stage,codeState:await page.locator('#synthCodeState').textContent().catch(()=>''),codeError:await page.locator('#synthCodeError').textContent().catch(()=>''),status:await page.locator('#audioStatus').textContent().catch(()=>''),live:await page.locator('#hucChannelReadout').textContent().catch(()=>''),commands:await page.evaluate(()=>__hucCodeAudit.drain()).catch(()=>[])};
    await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,error:error.stack,checks,measurements,diagnostic,pageErrors:errors,consoleErrors};throw error;
  }finally{await page.close();}
}

const server=http.createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep));
  const bytes=await fs.readFile(filename),key=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};
  if(served.has(key))assert.deepEqual(served.get(key),metadata,'Asset changed during check');served.set(key,metadata);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
}catch(error){missing.push({url:req.url,error:error.message});res.writeHead(404).end(error.message);}});
(async()=>{
  for(const filename of ['playground/tetorica-playground-globals.d.ts','playground/tetorica-playground-huc6280.d.ts','playground/tetorica-shell.d.ts','js/native_audio_effect.wasm']){
    const bytes=await fs.readFile(path.join(config.root,filename));assert(bytes.length,filename+' is present');namedResources[filename]={bytes:bytes.length,sha256:hash(bytes)};
  }
  const [{createDefaultPreset},{encodeDdaData},{loadPlaygroundCassette}]=await Promise.all([
    import(pathToFileURL(path.join(repo,'docs/synth-huc6280/preset.js')).href),import(pathToFileURL(path.join(repo,'docs/synth-huc6280/dda_pcm.js')).href),import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href)]);
  const wave=createDefaultPreset();wave.name='Code loaded wave';wave.envelope.enabled=false;
  const noise=structuredClone(wave);noise.source='noise';noise.name='Code loaded Noise';noise.noise.frequency=19;
  const dda=structuredClone(wave);dda.name='Self-authored DDA';dda.source='dda';dda.dda={name:'original-five-bit.pcm',data:encodeDdaData(Uint8Array.from({length:1024},(_,i)=>sine[i%32])),sampleRate:8192,rootNote:60,loop:true,speed:1};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;let failure=null;
  try{
    for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await check(browser,name,origin,{wave,noise,dda,loadCassette:loadPlaygroundCassette}));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);assert(blockedMonaco.length,'fallback editor exercised');
  }catch(error){failure=error;}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,checkerSha256:hash(await fs.readFile(__filename)),results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,namedResources,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),...(failure?{error:failure.stack??String(failure)}:{})};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
