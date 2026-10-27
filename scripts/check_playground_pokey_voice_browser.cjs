// Real POKEY Operators UI, actual Main/Worker ownership, and captured stereo PCM.
// Synthetic programs only. The physical output is zero after the capture point.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),config={root:path.join(repository,'docs'),engines:[],out:'/private/tmp/pokey-voice-browser.json',screenshots:null};
for(const arg of process.argv.slice(2)){
  if(arg==='--help'){console.log('Usage: node scripts/check_playground_pokey_voice_browser.cjs [--chromium-only|--webkit-only] [--root=docs-or-flat] [--out=REPORT.json] [--screenshot-dir=DIR]');process.exit(0);}
  if(arg==='--chromium-only'||arg==='--webkit-only')config.engines.push(arg.slice(2,-5));
  else if(arg.startsWith('--root='))config.root=path.resolve(repository,arg.slice(7));
  else if(arg.startsWith('--out='))config.out=path.resolve(arg.slice(6));
  else if(arg.startsWith('--screenshot-dir='))config.screenshots=path.resolve(arg.slice(17));
  else throw Error('Unknown argument: '+arg);
}
assert(config.engines.length<2,'Choose one browser flag, or neither for both');
if(!config.engines.length)config.engines=['chromium','webkit'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),served=new Map(),sourceErrors=[];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.ico':'image/x-icon'};
const hook=`
window.__pokeyVoiceCheck={runtime,megaDrive,editor:editorAdapter,setBottomTab,requests:[],captureBeforeFinalize:false};
{
 const p=window.__pokeyVoiceCheck,inspector=runtime.chipInspector;
 for(const method of ['read','invoke']){const original=inspector[method].bind(inspector);inspector[method]=(...args)=>{
  p.requests.push({action:method,id:args[0],kind:inspector.list().find(entry=>entry.id===args[0])?.kind,method:args[1],args:args[2],time:performance.now()});return original(...args);
 };}
 const finalize=runtime.finalize.bind(runtime);
 runtime.finalize=async(...args)=>{
  if(p.captureBeforeFinalize&&p.capture){p.captureBeforeFinalize=false;const pcm=await p.capture(2048);sessionStorage.setItem('__pokeyVoiceModeStop',JSON.stringify({pcm,ids:inspector.list().map(entry=>entry.id),observedBeforeOriginalFinalize:true}));}
  return finalize(...args);
 };
}
`;
const captureSource=`
class PokeyVoiceCapture extends AudioWorkletProcessor{
 constructor(){super();this.capture=null;this.port.onmessage=({data})=>{this.capture={id:data.id,index:0,firstFrame:null,left:new Float32Array(data.frames),right:new Float32Array(data.frames),frameGaps:0};};}
 process(inputs,outputs){const c=this.capture,input=inputs[0];if(c&&input?.length>=2){if(c.firstFrame===null)c.firstFrame=currentFrame;if(currentFrame!==c.firstFrame+c.index)c.frameGaps++;
  const count=Math.min(input[0].length,c.left.length-c.index);c.left.set(input[0].subarray(0,count),c.index);c.right.set(input[1].subarray(0,count),c.index);c.index+=count;
  if(c.index===c.left.length){this.capture=null;this.port.postMessage(c,[c.left.buffer,c.right.buffer]);}}
  for(const side of outputs[0])side.fill(0);return true;
 }
}registerProcessor('pokey-voice-capture',PokeyVoiceCapture);`;
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/__pokey-voice-capture.js'){response.writeHead(200,{'Content-Type':'text/javascript'}).end(captureSource);return;}
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    let file=path.resolve(config.root,'.'+pathname);assert(file===config.root||file.startsWith(config.root+path.sep),'Outside test root');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    const bytes=await fs.readFile(file),name=path.relative(config.root,file).replaceAll(path.sep,'/'),sha256=hash(bytes);
    assert(!served.has(name)||served.get(name).sha256===sha256,'Production source changed during capture: '+name);served.set(name,{bytes:bytes.length,sha256});
    const body=path.basename(file)==='playground.js'?Buffer.concat([bytes,Buffer.from(hook)]):bytes;
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);
  }catch(error){sourceErrors.push(String(error));response.writeHead(404).end(error.message);}
});
const panel='#pokeyPanel',control=name=>`${panel} [data-chip-control="pokey-${name}"]`,action=name=>`${panel} [data-chip-action="pokey-${name}"]`,channel=number=>`${panel} [data-chip-channel="${number}"]`;
const read=(page,id='pokey')=>page.evaluate(id=>window.__pokeyVoiceCheck.runtime.chipInspector.read(id),id);
async function until(page,test,label,id='pokey',timeout=6500){
  const deadline=Date.now()+timeout;let state;
  while(Date.now()<deadline){state=await read(page,id);if(test(state))return state;await page.waitForTimeout(30);}
  throw Error(label+': '+JSON.stringify(state));
}
const profile=state=>({clock:state.clock,registers:state.registers,configuredVolumes:state.channels.map(ch=>ch.configuredVolume)});
async function field(page,name,value){await page.locator(control(name)).evaluate((node,value)=>{
  if(node.type==='checkbox')node.checked=Boolean(value);else node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));node.blur();
},value);}
async function selectChannel(page,number){await page.locator(channel(number)).click();await page.waitForFunction(({selector,number})=>document.querySelector(selector)?.getAttribute('aria-pressed')==='true',{selector:channel(number),number});}
async function selectInstance(page,id){await page.locator(`${panel} [data-chip-control="instance"]`).selectOption(id);await page.locator(control('volume')).waitFor();await page.waitForFunction(id=>document.querySelector('#pokeyPanel [data-chip-control="instance"]')?.value===id,id);}
async function runSource(page,source,execution='main'){await page.evaluate(({source,execution})=>{
  document.getElementById('workerExecution').checked=execution==='worker';return window.__pokeyVoiceCheck.runtime.playSource(source,{execution});
},{source,execution});}
async function installCapture(page){await page.evaluate(async()=>{
  const p=window.__pokeyVoiceCheck,context=p.megaDrive.audioContext;if(p.capture)return;
  await context.audioWorklet.addModule('/__pokey-voice-capture.js');
  const node=new AudioWorkletNode(context,'pokey-voice-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit',channelInterpretation:'discrete'});
  node.connect(context.destination);p.megaDrive.audio.connectOutputMonitor(node);
  let sequence=0;const pending=new Map();
  node.port.onmessage=({data})=>{
    const entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);clearTimeout(entry.timer);
    const channels=[data.left,data.right].map(values=>{
      const mean=values.reduce((sum,v)=>sum+v,0)/values.length;let peak=0,square=0,nonFinite=0,nonZero=0,fnv=2166136261;const crossings=[];
      for(let i=0;i<values.length;i++){const v=values[i];peak=Math.max(peak,Math.abs(v));square+=(v-mean)**2;if(!Number.isFinite(v))nonFinite++;if(v!==0)nonZero++;if(i&&values[i-1]<mean&&v>=mean)crossings.push(i-1+(mean-values[i-1])/(v-values[i-1]));}
      for(const byte of new Uint8Array(values.buffer,values.byteOffset,values.byteLength))fnv=Math.imul(fnv^byte,16777619);
      return {mean,peak,rms:Math.sqrt(square/values.length),nonFinite,nonZero,fnv:fnv>>>0,hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
    });let stereoDifference=0;for(let i=0;i<data.left.length;i++)stereoDifference=Math.max(stereoDifference,Math.abs(data.left[i]-data.right[i]));
    entry.resolve({frames:data.left.length,sampleRate:context.sampleRate,firstFrame:data.firstFrame,frameGaps:data.frameGaps,stereoDifference,channels});
  };
  p.capture=(frames=8192)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('PCM capture timed out'));},7000);pending.set(id,{resolve,reject,timer});node.port.postMessage({id,frames});});
});}
const capture=(page,frames=8192)=>page.evaluate(frames=>window.__pokeyVoiceCheck.capture(frames),frames);
async function audible(page,label,{hz}={}){
  let pcm;for(let attempt=0;attempt<5;attempt++){
    pcm=await capture(page);if(pcm.channels.every(ch=>ch.nonFinite===0&&ch.rms>.0002&&ch.peak<.99&&(hz===undefined||Math.abs(ch.hz-hz)<Math.max(1.5,hz*.015))))break;
  }
  assert(pcm.channels.every(ch=>ch.nonFinite===0&&ch.rms>.0002&&ch.peak<.99&&(hz===undefined||Math.abs(ch.hz-hz)<Math.max(1.5,hz*.015))),label+': '+JSON.stringify(pcm));
  assert.equal(pcm.stereoDifference,0,label+' mono centered stereo');assert.equal(pcm.frameGaps,0,label+' complete rendering quanta');return pcm;
}
async function silent(page,label){
  let pcm;for(let attempt=0;attempt<6;attempt++){pcm=await capture(page,2048);if(pcm.channels.every(ch=>ch.nonFinite===0&&ch.nonZero===0)){assert.equal(pcm.frameGaps,0);return pcm;}}
  throw Error(label+' must produce exact zero stereo PCM: '+JSON.stringify(pcm));
}
async function stop(page,ids){
  await page.locator('#stopButton').evaluate(button=>button.click());await page.waitForFunction(()=>window.__pokeyVoiceCheck.runtime.getState().playback==='stopped');
  for(const id of ids)await until(page,state=>state.channels.every(ch=>!ch.active)&&state.held.length===0,'Stop releases '+id,id);
  return silent(page,'Stop');
}
async function beginHold(page){const button=page.locator(action('hold'));await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();}
async function endHold(page){await page.mouse.move(3,3);await page.mouse.up();}
async function holdPcm(page,id,ch,label){await beginHold(page);try{const state=await until(page,state=>state.channels[ch].active&&state.held.includes(ch),label,id);return {state,pcm:await audible(page,label,{hz:state.channels[ch].frequency})};}finally{await endHold(page);}}
async function hiddenRequests(page,label){
  await page.locator('#codeTab').evaluate(button=>button.click());await page.waitForTimeout(80);
  const before=await page.evaluate(()=>window.__pokeyVoiceCheck.requests.length);await page.waitForTimeout(700);
  const entries=await page.evaluate(before=>window.__pokeyVoiceCheck.requests.slice(before).filter(entry=>entry.kind==='pokey'),before);
  assert.deepEqual(entries,[],label+' sends no hidden POKEY reads or invokes');return {intervalMs:700,readRequests:0,invokeRequests:0};
}
async function readyPage(browser,base,mode){
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1600,height:1150}}),errors=[],missing=[];page.setDefaultTimeout(18000);
  page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack}));page.on('response',response=>{if(response.status()===404)missing.push(response.url());});
  await page.goto(base+'?mode='+mode+'&no-sw=1');await page.waitForFunction(()=>window.__pokeyVoiceCheck&&window.monaco?.editor?.getEditors().length);await page.locator('#startupNotice').waitFor({state:'hidden'});
  await page.evaluate(()=>{const p=window.__pokeyVoiceCheck,audio=p.megaDrive.audio,ensure=audio.ensureRouting.bind(audio);audio.ensureRouting=context=>{
    if(!audio.outputNode){const sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);audio.outputNode=sink;}return ensure(context);
  };});
  return {page,errors,missing};
}
function assertErrors(errors,missing){
  const known=error=>['Canceled','Canceled: Canceled'].includes(error.message)&&error.stack?.includes('monaco-editor')&&error.stack.includes('dispose');
  assert.deepEqual(errors.filter(error=>!known(error)),[],'Browser runtime errors');assert.deepEqual(missing,[],'No missing runtime assets');
}
async function openPanel(page){await page.locator('#pokeyTab').click();await page.locator(control('volume')).waitFor();}
async function basicVoice(page,id,ch){await selectInstance(page,id);await selectChannel(page,ch);await field(page,'distortion',5);await field(page,'volume-only',false);await field(page,'volume',9);await field(page,'audition-midi',69);}
async function keyboard(page,id,ch){
  await basicVoice(page,id,ch);await page.locator(action('keyboard')).click();await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Ukulele$/}).click();
  const key=page.locator('#operatorKeyboardRoot .key').filter({has:page.locator('span').filter({hasText:/^A4$/})}).first();await key.waitFor();const letter=await key.getAttribute('data-key');assert(letter,'Keyboard has a PC mapping for A4');
  await page.locator('#keyboardTab').focus();await page.keyboard.down(letter);
  let pc;try{const state=await until(page,state=>state.held.includes(ch)&&state.channels[ch].active,'PC Keyboard selected channel',id);pc=await audible(page,'PC Keyboard',{hz:state.channels[ch].frequency});}finally{await page.keyboard.up(letter);}
  await until(page,state=>state.held.length===0&&!state.channels[ch].active,'PC keyup',id);const pcRelease=await silent(page,'PC keyup');
  const box=await key.boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  let pointer;try{const state=await until(page,state=>state.held.includes(ch)&&state.channels[ch].active,'Pointer Keyboard selected channel',id);pointer=await audible(page,'Pointer Keyboard',{hz:state.channels[ch].frequency});}finally{await page.mouse.move(2,2);await page.mouse.up();}
  await until(page,state=>state.held.length===0&&!state.channels[ch].active,'Pointer Keyboard release',id);const pointerRelease=await silent(page,'Pointer Keyboard release');
  return {id,channel:ch,pc,pointer,pcRelease,pointerRelease};
}
async function floatingSuppressed(page,label,{busy=false}={}){
  // Exercise the shared floating editor Keyboard without using the panel's
  // disabled Use Keyboard button. Suppression must happen before any RPC.
  await page.locator('#consoleTab').click();
  assert(await page.locator('#keyboardPanel').evaluate(node=>node.classList.contains('is-floating-keyboard')),label+' uses actual floating Keyboard');
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Ukulele$/}).click();
  const key=page.locator('#operatorKeyboardRoot .key').filter({has:page.locator('span').filter({hasText:/^A4$/})}).first();await key.waitFor({state:'attached'});
  const letter=await key.getAttribute('data-key');assert(letter,label+' floating key has PC mapping');
  const pointerVisible=await key.isVisible(),pointerDisabled=await key.isDisabled();
  assert(!pointerVisible||pointerDisabled,label+' renders its unavailable floating key hidden or disabled');
  const before=await page.evaluate(()=>window.__pokeyVoiceCheck.requests.length);
  await page.locator('#pokeyTab').focus();await page.keyboard.down(letter);await page.waitForTimeout(80);await page.keyboard.up(letter);
  if(pointerVisible){const box=await key.boundingBox();assert(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(80);await page.mouse.up();}
  const requests=await page.evaluate(before=>window.__pokeyVoiceCheck.requests.slice(before).filter(entry=>entry.kind==='pokey'),before);
  const invokes=requests.filter(entry=>entry.action==='invoke');assert.deepEqual(invokes,[],label+' floating PC/pointer presses send no attempted or failed POKEY RPC');
  const state=await read(page);assert.equal(state.held.length,0,label+' does not acquire a manual lease');
  let silence;if(busy)assert(state.timeline?.playing,label+' preserves renderer-owned playback');else{assert(state.channels.every(ch=>!ch.active),label+' cannot activate any physical voice');silence=await silent(page,label);}
  return {pcAttempted:true,pointerAttempted:pointerVisible,pointerVisible,pointerDisabled,invokeRequests:0,visibleReadRequests:requests.filter(entry=>entry.action==='read').length,manualLeases:0,silence};
}
async function sourceOwnership(page,execution,ids){
  const chips=ids.length===2?'[pokey,pokey2]':'[pokey]';
  await runSource(page,`for(const chip of ${chips}){chip.initialize();for(let ch=0;ch<4;ch++){chip.setVolume(ch,9);chip.setDistortion(ch,5);}}
liveLoop('old-owner',async()=>{pokey.noteOn(0,'C4');await sleep(2);pokey.keyOff(0);await sleep(60);});
liveLoop('sibling-owner',async()=>{pokey.noteOn(1,'E5');await sleep(60);});`,execution);
  await until(page,state=>state.channels[0].active&&state.channels[1].active,'Two source owners active');await openPanel(page);await basicVoice(page,'pokey',0);
  await beginHold(page);let held,sibling;
  try{await until(page,state=>state.held.includes(0),'Manual lease acquired');await page.waitForTimeout(2150);held=await read(page);assert(held.held.includes(0)&&held.channels[0].active,'Old source keyOff cannot release manual lease');assert(held.channels[1].active,'Manual lease preserves sibling source');await audible(page,'Manual and sibling source mixed');}
  finally{await endHold(page);}
  sibling=await until(page,state=>!state.channels[0].active&&state.channels[1].active,'Manual release preserves sibling');const pcm=await audible(page,'Only sibling survives manual release',{hz:sibling.channels[1].frequency});
  await stop(page,ids);return {execution,oldSourceReleaseIgnored:true,siblingPreserved:true,held:profile(held),siblingPcm:pcm};
}
async function timelineBusy(page,ids){
  await runSource(page,`liveLoop('renderer-owned-timeline',async()=>{await pokey.prepareTimeline({version:1,clock:pokey.clock,durationSamples:176400,data:new Uint8Array([0,15,3,0,8,0,0,0,73,0,1,168,0,9,0])});await pokey.playTimeline();await sleep(60);});`);
  await until(page,state=>state.timeline?.playing,'Renderer-owned timeline starts');await openPanel(page);
  await page.waitForFunction(()=>document.querySelector('#pokeyPanel [data-chip-control="pokey-volume"]')?.disabled||document.querySelector('#pokeyPanel [data-chip-control="pokey-volume"]')?.matches(':disabled'));
  for(const name of ['volume','distortion','frequency','note','base-clock'])assert(await page.locator(control(name)).isDisabled(),'Timeline owns '+name);
  for(const name of ['hold','play','keyboard'])assert(await page.locator(action(name)).isDisabled(),'Timeline owns '+name);
  assert.match(await page.locator(`${panel} [data-chip-output="pokey-timeline"]`).textContent(),/playing|pending/i);
  assert(await page.locator(control('code')).evaluate(node=>node.readOnly),'Timeline permits read-only voice code');
  const floatingKeyboard=await floatingSuppressed(page,'Timeline busy',{busy:true});
  const pcm=await audible(page,'Renderer-owned timeline'),released=await stop(page,ids);await page.waitForFunction(()=>!document.querySelector('#pokeyPanel [data-chip-control="pokey-volume"]')?.matches(':disabled'));
  return {controlsDisabled:true,codeRemainsReadOnly:true,floatingKeyboard,pcm,released};
}
async function modeStop(page){
  await openPanel(page);await basicVoice(page,'pokey',0);await beginHold(page);await until(page,state=>state.held.includes(0),'Held before mode switch');
  await page.evaluate(()=>{window.__pokeyVoiceCheck.captureBeforeFinalize=true;sessionStorage.removeItem('__pokeyVoiceModeStop');});
  await page.locator('#mainMenu > summary').evaluate(button=>{if(!button.parentElement.open)button.click();});
  await page.locator('#playgroundMode').selectOption('genesis');await page.locator('#changeModeDialog').waitFor({state:'visible'});
  await Promise.all([page.waitForURL(url=>url.searchParams.get('mode')==='genesis'),page.locator('#modeChoiceKeep').evaluate(button=>button.click())]);
  await page.mouse.up();await page.waitForFunction(()=>window.__pokeyVoiceCheck&&window.monaco?.editor?.getEditors().length);await page.locator('#startupNotice').waitFor({state:'hidden'});
  const receipt=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('__pokeyVoiceModeStop')));assert(receipt?.observedBeforeOriginalFinalize,'Observed old graph before mode finalize');
  assert(receipt.pcm.channels.every(ch=>ch.nonZero===0&&ch.nonFinite===0),'Mode Stop produces exact zero PCM before closing old graph');
  assert(!await page.locator('#pokeyTab').isVisible(),'New Genesis mode has no primary POKEY tab');assert.equal(await page.evaluate(()=>window.__pokeyVoiceCheck.megaDrive.audioContext),null,'Mode transition stays lazy');return receipt;
}
async function checkMode(browser,base,name,mode){
  const {page,errors,missing}=await readyPage(browser,base,mode),ids=mode==='pokey-dual'?['pokey','pokey:2']:['pokey'];
  try{
    console.log(`[${name}] ${mode}: panel/read/edit/audition/lifecycle`);
    assert(await page.locator('#pokeyTab').isVisible());assert.match(await page.locator('#pokeyTab').textContent(),/POKEY/i);
    await page.locator('#pokeyTab').click();await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.__pokeyVoiceCheck.megaDrive.audioContext),null,'Opening Operators does not create audio');
    assert.deepEqual(await page.evaluate(()=>window.__pokeyVoiceCheck.requests.filter(entry=>entry.kind==='pokey')),[],'Opening unprepared panel sends no POKEY RPCs');
    await page.evaluate(source=>window.__pokeyVoiceCheck.editor.setValue(source),`for(const chip of ${ids.length===2?'[pokey,pokey2]':'[pokey]'}){chip.initialize();for(let ch=0;ch<4;ch++){chip.setVolume(ch,9);chip.setDistortion(ch,5);chip.setFrequency(ch,440+ch*110);}}`);
    await page.locator('#runButton').click();await page.waitForFunction(()=>window.__pokeyVoiceCheck.megaDrive.isReady());await installCapture(page);await stop(page,ids);await openPanel(page);
    assert.deepEqual(await page.locator(`${panel} [data-chip-control="instance"] option`).evaluateAll(nodes=>nodes.map(node=>node.value)),ids,'All connected primary instances selectable');
    assert.deepEqual(await page.locator(`${panel} [data-chip-channel]`).evaluateAll(nodes=>nodes.map(node=>node.dataset.chipChannel)),['0','1','2','3']);
    const before=await Promise.all(ids.map(id=>read(page,id))),invokeStart=await page.evaluate(()=>window.__pokeyVoiceCheck.requests.filter(entry=>entry.action==='invoke').length);
    for(const id of ids){await selectInstance(page,id);for(let ch=0;ch<4;ch++){
      await selectChannel(page,ch);const snapshot=await read(page,id),voice=snapshot.channels[ch];
      assert(await page.locator(control('period')).evaluate(node=>node.readOnly),'Applied AUDF period is read only');
      assert.equal(Number(await page.locator(control('period')).inputValue()),voice.period,'Applied period readout matches actual state');
      assert.equal(Number(await page.locator(control('volume')).inputValue()),voice.configuredVolume,'Configured volume readout');
      assert(Math.abs(Number(await page.locator(control('frequency')).inputValue())-voice.frequency)<.001,'Applied frequency readout');
      assert.match(await page.locator(`${panel} [data-chip-output="pokey-clock"]`).textContent(),new RegExp(String(snapshot.clock).replace(/\B(?=(\d{3})+(?!\d))/g,',')));
      assert.match(await page.locator(`${panel} [data-chip-output="pokey-shared-info"]`).textContent(),/AUDCTL.*SKCTL/);
    }}
    const after=await Promise.all(ids.map(id=>read(page,id)));assert.deepEqual(after.map(profile),before.map(profile),'Viewing/selecting every voice does not reset or write settings');
    assert.equal(await page.evaluate(()=>window.__pokeyVoiceCheck.requests.filter(entry=>entry.action==='invoke').length),invokeStart,'Selection is read only');
    const holds=[];
    for(const id of ids)for(let ch=0;ch<4;ch++){await basicVoice(page,id,ch);const sample=await holdPcm(page,id,ch,`${id} CH${ch+1} Hold`);for(const other of ids.filter(other=>other!==id))assert((await read(page,other)).channels.every(voice=>!voice.active),'Only selected instance sounds');const release=await silent(page,'Hold pointer release outside');holds.push({id,channel:ch,pcm:sample.pcm,release});}
    await basicVoice(page,'pokey',0);await field(page,'volume',4);await beginHold(page);let quiet,loud,pitch;
    try{const initial=await until(page,state=>state.held.includes(0),'Edit audition starts');quiet=await audible(page,'Volume4',{hz:initial.channels[0].frequency});await field(page,'volume',12);await until(page,state=>state.channels[0].volume===12,'Live volume edit');loud=await audible(page,'Volume12',{hz:initial.channels[0].frequency});assert(loud.channels[0].rms>quiet.channels[0].rms*1.3,'Actual PCM responds to volume edit');await field(page,'frequency',660);const tuned=await until(page,state=>Math.abs(state.channels[0].frequency-660)<15,'Live frequency edit');pitch=await audible(page,'Frequency660',{hz:tuned.channels[0].frequency});}
    finally{await endHold(page);}await silent(page,'Edited Hold release');
    await field(page,'note','A5');await until(page,state=>Math.abs(state.channels[0].frequency-880)<25,'Note control');await field(page,'distortion',7);await field(page,'volume-only',true);await field(page,'base-clock','15khz');await field(page,'poly9',true);
    await until(page,state=>state.channels[0].distortion===7&&state.channels[0].volumeOnly&&!!(state.registers[8]&1)&&!!(state.registers[8]&128),'POKEY control bits');
    await field(page,'distortion',5);await field(page,'volume-only',false);await field(page,'base-clock','64khz');await field(page,'poly9',false);
    const joined=[];
    for(const pair of [0,1]){
      await field(page,'joined-'+pair,true);await selectChannel(page,pair*2);await until(page,state=>state.channels[pair*2].helper,'Joined helper');
      for(const name of ['frequency','note','audition-midi'])assert(await page.locator(control(name)).isDisabled(),'Joined helper disables '+name);
      for(const name of ['hold','play','keyboard'])assert(await page.locator(action(name)).isDisabled(),'Joined helper disables '+name);
      const floatingKeyboard=await floatingSuppressed(page,'Joined helper CH'+(pair*2+1));
      await selectChannel(page,pair*2+1);await field(page,'high-clock-'+(pair*2),true);await field(page,'volume',9);await field(page,'audition-midi',69);
      const sample=await holdPcm(page,'pokey',pair*2+1,'Joined upper channel');joined.push({pair,floatingKeyboard,pcm:sample.pcm,state:sample.state.channels[pair*2+1]});await silent(page,'Joined upper release');
      await field(page,'joined-'+pair,false);await field(page,'high-clock-'+(pair*2),false);
    }
    await basicVoice(page,'pokey',1);const previewStart=Date.now();await page.locator(action('play')).click();const previewState=await until(page,state=>state.held.includes(1),'One-second preview begins');const preview=await audible(page,'One-second preview',{hz:previewState.channels[1].frequency});await until(page,state=>!state.channels[1].active&&state.held.length===0,'One-second preview ends');const previewDurationMs=Date.now()-previewStart;assert(previewDurationMs>=700&&previewDurationMs<2500,'Preview releases near one second');const previewRelease=await silent(page,'One-second preview timeout');
    await basicVoice(page,'pokey',2);await page.locator(action('hold')).focus();await page.keyboard.down('Space');const accessibleState=await until(page,state=>state.held.includes(2),'Space Hold');const accessibleHold=await audible(page,'Space Hold',{hz:accessibleState.channels[2].frequency});await page.keyboard.up('Space');await silent(page,'Space keyup');
    const keyboardResult=await keyboard(page,'pokey',3);await openPanel(page);await basicVoice(page,'pokey',0);
    await beginHold(page);await until(page,state=>state.held.includes(0),'Held before channel change');await page.locator(channel(1)).evaluate(button=>button.click());await until(page,state=>state.held.length===0&&!state.channels[0].active,'Channel change releases old Hold');const channelRelease=await silent(page,'Channel change');await endHold(page);
    await beginHold(page);await until(page,state=>state.held.includes(1),'Held before tab change');await page.locator('#codeTab').evaluate(button=>button.click());const tabRelease=await silent(page,'Tab change');await endHold(page);const hidden=await hiddenRequests(page,'Hidden panel');
    let instanceRelease;
    if(ids.length===2){await openPanel(page);await basicVoice(page,'pokey',0);await beginHold(page);await until(page,state=>state.held.includes(0),'Held before chip change');await selectInstance(page,'pokey:2');await until(page,state=>state.held.length===0&&!state.channels[0].active,'Chip selection releases previous instance');instanceRelease=await silent(page,'Chip change');await endHold(page);await selectChannel(page,0);assert.match(await page.locator(control('code')).inputValue(),/pokey2\./,'Second primary generated code names pokey2');}
    await openPanel(page);await basicVoice(page,'pokey',0);await beginHold(page);await until(page,state=>state.held.includes(0),'Held before Stop');const stopRelease=await stop(page,ids);await endHold(page);
    const retained=await Promise.all(ids.map(id=>read(page,id)));await runSource(page,"console.log('POKEY_VOICE_REUSE');");assert.deepEqual((await Promise.all(ids.map(id=>read(page,id)))).map(profile),retained.map(profile),'Empty rerun preserves configured POKEY state');await silent(page,'Empty rerun');
    await openPanel(page);await basicVoice(page,'pokey',0);await beginHold(page);await until(page,state=>state.held.includes(0),'Held before rerun');await runSource(page,"console.log('POKEY_VOICE_RERUN');");const rerunRelease=await silent(page,'Rerun releases preview');await endHold(page);
    const owners=[];let timeline;if(mode==='pokey'){for(const execution of ['main','worker'])owners.push(await sourceOwnership(page,execution,ids));timeline=await timelineBusy(page,ids);}
    await openPanel(page);if(config.screenshots){await fs.mkdir(config.screenshots,{recursive:true});await page.screenshot({path:path.join(config.screenshots,`${name}-${mode}.png`),fullPage:true});}
    const requests=await page.evaluate(()=>window.__pokeyVoiceCheck.requests);const modeRelease=await modeStop(page);assertErrors(errors,missing);
    return {browser:name,mode,ids,openingIsLazy:true,selectionIsReadOnly:true,holds,edits:{quiet,loud,pitch},joined,preview:{pcm:preview,durationMs:previewDurationMs,release:previewRelease},accessibleHold,keyboard:keyboardResult,lifecycle:{channelRelease,tabRelease,instanceRelease,stopRelease,rerunRelease,modeRelease,retainedAfterRerun:true},hidden,owners,timeline,requests,physicalOutputZeroedAfterCapture:true};
  }finally{await page.close();}
}
async function checkExtras(browser,base,name){
  const {page,errors,missing}=await readyPage(browser,base,'genesis');try{
    console.log(`[${name}] Genesis: additional POKEY tab and disposal`);assert(!await page.locator('#pokeyTab').isVisible(),'No POKEY tab without POKEY instance');
    await page.evaluate(()=>window.__pokeyVoiceCheck.editor.setValue("console.log('EXTRA_BOOTSTRAP');"));await page.locator('#runButton').click();await page.waitForFunction(()=>window.__pokeyVoiceCheck.megaDrive.isReady());await installCapture(page);await stop(page,[]);await page.locator('#codeTab').click();
    const before=await page.evaluate(()=>window.__pokeyVoiceCheck.requests.length);
    await runSource(page,`const a=await createSoundChip('pokey',{id:'voice-extra-a'}),b=await createSoundChip('pokey',{id:'voice-extra-b'});for(const chip of [a,b])chip.initialize();
globalThis.__pokeyVoiceDispose=()=>a.dispose();liveLoop('retain-extra-pokeys',async()=>{await sleep(60);});`);
    await page.locator('#pokeyTab').waitFor({state:'visible'});await page.waitForFunction(()=>window.__pokeyVoiceCheck.runtime.chipInspector.list().filter(entry=>entry.kind==='pokey').length===2);
    const hiddenCreation=await page.evaluate(before=>window.__pokeyVoiceCheck.requests.slice(before).filter(entry=>entry.kind==='pokey'),before);assert.deepEqual(hiddenCreation,[],'Additional tab availability sends no hidden POKEY RPCs');
    await openPanel(page);await basicVoice(page,'voice-extra-a',0);await beginHold(page);await until(page,state=>state.held.includes(0),'Additional selected audition','voice-extra-a');const pcm=await audible(page,'Additional POKEY Hold');
    const siblingBefore=await read(page,'voice-extra-b');
    await page.evaluate(()=>{if(typeof globalThis.__pokeyVoiceDispose!=='function')throw Error('Authored disposal action is unavailable');return globalThis.__pokeyVoiceDispose();});
    await page.waitForFunction(()=>{const entries=window.__pokeyVoiceCheck.runtime.chipInspector.list();return !entries.some(entry=>entry.id==='voice-extra-a')&&entries.some(entry=>entry.id==='voice-extra-b');});
    const siblingAfter=await read(page,'voice-extra-b');assert.deepEqual(profile(siblingAfter),profile(siblingBefore),'Disposing the selected POKEY preserves its sibling state');
    const disposedRelease=await silent(page,'Disposed selected instance');await endHold(page);
    await basicVoice(page,'voice-extra-b',3);const survivor=await holdPcm(page,'voice-extra-b',3,'Surviving additional POKEY');await silent(page,'Surviving additional release');
    const stopped=await stop(page,[]);await page.locator('#pokeyTab').waitFor({state:'hidden'});await page.waitForFunction(()=>!window.__pokeyVoiceCheck.runtime.chipInspector.list().some(entry=>entry.kind==='pokey'));
    const hidden=await hiddenRequests(page,'Disposed additional panel');assertErrors(errors,missing);return {browser:name,mode:'genesis-extras',created:['voice-extra-a','voice-extra-b'],hiddenAvailabilityRequests:0,explicitDisposalAfterCapture:true,siblingStatePreserved:true,pcm,disposedRelease,survivor:survivor.pcm,stopped,hidden,physicalOutputZeroedAfterCapture:true};
  }finally{await page.close();}
}
(async()=>{
  try{
    const nested=await fs.stat(path.join(config.root,'playground/index.html')).then(()=>true,()=>false);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${server.address().port}/${nested?'playground/':''}index.html`,results=[],browserVersions={};
    for(const name of config.engines){const browser=await ({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});try{browserVersions[name]=browser.version();for(const mode of ['pokey','pokey-dual'])results.push(await checkMode(browser,base,name,mode));results.push(await checkExtras(browser,base,name));}finally{await browser.close();}}
    assert.deepEqual(sourceErrors,[],'Asset/source failures');for(const [name,entry]of served)assert.equal(hash(await fs.readFile(path.join(config.root,name))),entry.sha256,'Source remained frozen: '+name);
    const report={schemaVersion:1,passed:true,root:config.root,browserVersions,results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:hash(await fs.readFile(__filename)),syntheticPrograms:true,physicalOutputZeroedAfterCapture:true,listeningPerformed:false};
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('PASS POKEY Operators: '+results.length+' browser/mode routes; '+config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
