// SPDX-License-Identifier: BSD-3-Clause
// Real UI, Code and self-authored 68000 SSF checks. Every physical destination is muted before initialization.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');
const startedAt = Date.now(), repository = path.resolve(__dirname, '..');
const config = {root:path.join(repository,'docs'),entry:'/synth-scsp/index.html',engines:'chromium,webkit',
  out:path.join(os.tmpdir(),'scsp-live-parameter-highlight-browser.json'),
  screenshots:path.join(os.tmpdir(),'scsp-live-parameter-highlight-browser')};
const args = process.argv.slice(2);
for(let index=0;index<args.length;index++){
  const match=/^--(root|entry|engines|out|screenshots)(?:=(.+))?$/.exec(args[index]);
  assert(match,'Unknown argument '+args[index]);config[match[1]]=match[2]??args[++index];assert(config[match[1]]);
}
config.root=path.resolve(config.root);
assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.md':'text/plain','.scspasm':'text/plain'};
const served=new Map(),sourceErrors=[],results=[];
const server=http.createServer(async(request,response)=>{
  try{
    let relative=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(relative==='/favicon.ico'){response.writeHead(204).end();return;}
    if(relative.endsWith('/'))relative+='index.html';
    const file=path.resolve(config.root,'.'+relative);assert(file.startsWith(config.root+path.sep));
    const bytes=await fs.readFile(file),asset=path.relative(config.root,file).split(path.sep).join('/');
    const record={bytes:bytes.length,sha256:sha(bytes)};
    if(served.has(asset)&&served.get(asset).sha256!==record.sha256){sourceErrors.push('Source changed while served: '+asset);throw Error(sourceErrors.at(-1));}
    served.set(asset,record);response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch{response.writeHead(404).end();}
});
function installSilentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const audit=window.__scspHighlightAudit={contexts:[],nodes:[],meters:[],commands:[],classes:[],animations:[],sequence:0};
  window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:48000});audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,options){super(context,name,options);audit.nodes.push({name,node:this});}};
  AudioNode.prototype.connect=function(destination,...rest){
    if(destination!==this.context.destination)return connect.call(this,destination,...rest);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=2048;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);audit.meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...rest){
    if(data?.method||data?.type==='chip-inspector')audit.commands.push({time:performance.now(),...structuredClone(data)});
    return post.call(this,data,...rest);
  };
  const reads=new Set(['readAuthoring','readPhysical','readDspProgram','readDspSetup','readDspCoefficients','readAudition','getState','exportPatch','exportIdleState']);
  audit.mutations=()=>audit.commands.filter(data=>data.type==='chip-inspector'
    ?data.action!=='read'&&data.method!=='getPCM'
    :!reads.has(data.method==='code'?data.args?.[1]:data.method)&&!(['invoke','invokePhysical'].includes(data.method)&&data.args?.[0]==='getPCM'));
  audit.graph=()=>({contexts:audit.contexts.length,rates:audit.contexts.map(value=>value.sampleRate),
    worklets:audit.nodes.map(value=>value.name),routes:audit.meters.length,physicalOutputMuted:audit.meters.every(value=>value.mute.gain.value===0)});
  audit.output=()=>{
    let peak=0;for(const {analyser}of audit.meters){if(analyser.context.state==='closed')continue;
      const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
      for(const sample of samples){if(!Number.isFinite(sample))throw Error('Non-finite native output');peak=Math.max(peak,Math.abs(sample));}}
    return{peak,physicalOutputMuted:audit.meters.every(value=>value.mute.gain.value===0)};
  };
  audit.request=command=>new Promise((resolve,reject)=>{
    const node=audit.nodes.findLast(value=>value.name==='tetorica-scsp-synth')?.node;
    if(!node){reject(Error('Primary Synth is unavailable'));return;}
    const id='highlight-read-'+ ++audit.sequence,timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Inspector read timed out'));},5000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({...command,id});
  });
  audit.inspect=()=>audit.request({type:'chip-inspector',action:'read'});
  function key(node){
    if(node.id)return node.id;if(node.dataset?.chipControl)return node.dataset.chipControl;
    const input=node.querySelector?.('input,select');if(input)return input.id||input.dataset.chipControl;
    if(node.matches?.('.scsp-ssf-modulation label'))return 'ssf-modulation-'+['depth','xOffset','yOffset','writeInhibit'][[...node.parentElement.querySelectorAll('label')].indexOf(node)];
    return node.tagName+':'+(node.textContent??'').slice(0,60);
  }
  audit.key=key;
  new MutationObserver(records=>{
    for(const record of records){
      if(record.type!=='attributes'||record.attributeName!=='class')continue;
      const before=(record.oldValue??'').split(/\s+/).includes('is-live-changed'),after=record.target.classList.contains('is-live-changed');
      if(before!==after)audit.classes.push({time:performance.now(),key:key(record.target),active:after,
        value:(record.target.querySelector?.('input,select')??record.target).value??record.target.textContent});
    }
  }).observe(document,{subtree:true,attributes:true,attributeFilter:['class'],attributeOldValue:true});
  for(const type of ['animationstart','animationend','animationcancel'])document.addEventListener(type,event=>{
    if(event.animationName==='synth-live-change')audit.animations.push({time:performance.now(),type,key:key(event.target),
      trusted:event.isTrusted,elapsed:event.elapsedTime,animationName:getComputedStyle(event.target).animationName,
      duration:getComputedStyle(event.target).animationDuration,iterations:getComputedStyle(event.target).animationIterationCount});
  },true);
}
function blockHighlightStorage(){
  const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
  Storage.prototype.getItem=function(key){if(key==='tetorica-scsp-synth-live-highlight')throw new DOMException('Blocked storage','SecurityError');return get.call(this,key);};
  Storage.prototype.setItem=function(key,value){if(key==='tetorica-scsp-synth-live-highlight')throw new DOMException('Blocked storage','SecurityError');return set.call(this,key,value);};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label,timeout=20000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await read();if(value)return value;await sleep(20);}throw Error('Timed out: '+label);}
const audit=(page,kind)=>page.evaluate(kind=>{const value=__scspHighlightAudit[kind];return typeof value==='function'?value():structuredClone(value);},kind);
const inspect=page=>audit(page,'inspect');
const pulseKeys=page=>page.locator('.is-live-changed').evaluateAll(nodes=>nodes.map(node=>__scspHighlightAudit.key(node)));
const control=(page,name)=>page.locator('#voice [data-chip-control="scsp-'+name+'"]');
async function mark(page){return page.evaluate(()=>({time:performance.now(),classes:__scspHighlightAudit.classes.length,animations:__scspHighlightAudit.animations.length,commands:__scspHighlightAudit.commands.length}));}
async function events(page,after){return page.evaluate(after=>({classes:__scspHighlightAudit.classes.slice(after.classes),animations:__scspHighlightAudit.animations.slice(after.animations)}),after);}
async function silent(page){await until(async()=>{const value=await audit(page,'output');return value.physicalOutputMuted&&value.peak<1e-7;},'silent muted output');}
async function sounding(page){return until(async()=>{const value=await audit(page,'output');return value.physicalOutputMuted&&value.peak>1e-5?value:false;},'finite native PCM before permanent mute');}
async function selectChannel(page,slot){await page.locator('[data-scsp-channel="'+(slot??'auto')+'"]').click();await page.waitForFunction(value=>document.getElementById('scspChannelTabs').dataset.selected===String(value),slot??'auto');}
async function selectedOperator(page,index){await page.locator('button[data-operator="'+index+'"]').click();await page.waitForFunction(value=>document.querySelector('button[data-operator="'+value+'"]').getAttribute('aria-pressed')==='true',index);}
async function source(page,text,{run=true}={}){
  if(await page.locator('#scspFilesPanel').isHidden())await page.locator('#scspFilesToggle').click();
  await page.locator('#scspFilesTree button[data-file-path="/index.js"]').click();
  await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});
  await page.locator('#synthCodeEditor').fill(text);
  if(run){await page.locator('#synthCodeRunButton').click();await until(async()=>{const error=await page.locator('#synthCodeError').textContent();assert.equal(error,'');return /Running|Playing/.test(await page.locator('#synthCodeState').textContent());},'Code running');}
}
function motionSource(steps=60){return `const scsp=await useSoundChip('scsp');setBpm(120);
await scsp.setConfig({mode:'fm2',fm:{algorithm:'custom',custom:{inputs:[[],[0]],outputs:[1]},depth:4}});
await scsp.setMix(0,{totalLevel:18});await scsp.setMix(1,{totalLevel:20});
await scsp.setLfo(0,{frequencyCode:10,pitchDepth:2});await scsp.setLfo(1,{frequencyCode:11,pitchDepth:3});
await scsp.noteOn(CH1,'A3');let step=0;
liveLoop('highlight-motion',async()=>{if(step===0){log('highlight-ready');await beat(2);}if(step>=${steps}){log('highlight-steady-${steps}');await beat(4096);return;}
step++;await scsp.setFrequency(CH1,220+step*7);await scsp.setLfo(0,{frequencyCode:step%2?12:10,pitchDepth:step%2?4:2});
await scsp.setLfo(1,{frequencyCode:step%2?13:11,pitchDepth:step%2?5:3});await scsp.setConfig({fm:{depth:step%2?7:4}});log('highlight-motion',step);await beat(.24);});`;}
const holdSource=`const scsp=await useSoundChip('scsp');await scsp.noteOn(CH1,'D4');log('highlight-held');`;
async function loadSsf(page,bytes,name='highlight-original.ssf'){
  if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  const chooser=page.waitForEvent('filechooser');await page.locator('#loadSsf').click();
  await(await chooser).setFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
  await until(()=>page.locator('#scspSongPlay').isEnabled(),'self-authored SSF ready');
}
function createFixture(ssfFromProgram){
  const image=new Uint8Array(0x1140),view=new DataView(image.buffer);view.setUint32(0,0x7fff0,false);view.setUint32(4,0x100,false);
  let address=0x100;const word=value=>{view.setUint16(address,value,false);address+=2;};
  const long=value=>{view.setUint32(address,value,false);address+=4;};
  const write=(register,value)=>{word(0x33fc);word(value);long(0x100000+register);};
  const delay=()=>{word(0x203c);long(700000);word(0x5380);word(0x66fc);};
  word(0x46fc);word(0x2000);write(0x400,0x020f);
  for(let slot=0;slot<2;slot++)for(const [register,value]of [[2,slot?0x1100:0x1000],[4,0],[6,64],[8,slot?27:31],
    [10,0x3c1f],[12,12],[14,0],[16,slot?0x7800:0],[18,0x2953],[20,0],[22,0xe000]])write(slot*0x20+register,value);
  write(0x20,0x0830);write(0,0x1820);const loopAddress=address;
  for(const high of [true,false]){delay();write(8,high?30:31);write(10,high?0x3cdf:0x3c1f);write(12,high?36:12);
    write(14,high?0x2041:0);write(16,high?0x7800:0);write(18,high?0x578a:0x2953);write(22,high?0xb600:0xe000);}
  word(0x4ef9);long(loopAddress);
  for(let index=0;index<64;index++){view.setInt16(0x1000+index*2,Math.round(8192*Math.sin(index*Math.PI/32)),false);
    view.setInt8(0x1100+index,Math.round(64*(1-4*Math.abs(index/64-.5))));}
  return{bytes:ssfFromProgram(image,0,'title=Original parameter highlight driver\nartist=Tetorica\nlength=0:45\nfade=0:00.25\n'),
    provenance:'Original 68000 MOVE.W immediate register writes, SUBQ/BNE delay and sine/triangle samples authored in this checker; no game data',imageSha256:sha(image),loopAddress};
}
async function screenshot(page,engine,label,screenshots){await fs.mkdir(config.screenshots,{recursive:true});
  const file=path.join(config.screenshots,engine+'-'+label+'.png');await page.screenshot({path:file,fullPage:false});screenshots[label]={file,sha256:sha(await fs.readFile(file))};}
async function check(browser,engine,origin,fixture){
  const context=await browser.newContext({viewport:{width:1400,height:1050},serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],missing=[],external=[],expectedBlockedMonaco=[],checks=[],measurements={},screenshots={};let stage='cold default and preference';
  await context.addInitScript(installSilentAudit);page.setDefaultTimeout(20000);
  context.on('page',other=>{if(other!==page)other.on('pageerror',error=>errors.push(error.message));});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();
    (/monaco|jsdelivr/.test(url.href)?expectedBlockedMonaco:external).push(url.href);return route.abort();});
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  const step=label=>{stage=label;console.log('CHECK '+engine+': '+label);};
  async function goto(){await page.goto(origin+config.entry);await until(()=>page.locator('#scspFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');await page.locator('#scspLiveHighlightToggle').waitFor();}
  async function noPulses(label,delay=180){await sleep(delay);assert.deepEqual(await pulseKeys(page),[],label);}
  async function cleanNavigation(action,label,{releasePreview=false}={}){const before=await mark(page),mutations=(await audit(page,'mutations')).length;await action();await noPulses(label);
    const posted=(await audit(page,'mutations')).slice(mutations);
    assert.deepEqual(posted.map(value=>value.method),releasePreview?['stopAudition']:[],label+' sends only its existing preview-release command');assert.deepEqual((await events(page,before)).classes.filter(value=>value.active),[],label+' initial read is a silent baseline');}
  try{
    await goto();assert(await page.locator('#scspLiveHighlightToggle').isChecked());assert.equal((await audit(page,'graph')).contexts,0);
    await page.uncheck('#scspLiveHighlightToggle');await page.reload();await page.locator('#scspLiveHighlightToggle').waitFor();assert(!await page.locator('#scspLiveHighlightToggle').isChecked());
    await page.check('#scspLiveHighlightToggle');await page.reload();await page.locator('#scspLiveHighlightToggle').waitFor();assert(await page.locator('#scspLiveHighlightToggle').isChecked());
    assert.equal((await audit(page,'graph')).contexts,0);checks.push('Highlight defaults On, persists Off/On across reload, and creates no audio before user play');

    step('real Code frequency/LFO/depth pulses');
    await page.locator('[data-chip-action="scsp-triangle"]').click();await control(page,'root').fill('500');await control(page,'root').dispatchEvent('change');
    const draftWave=await page.locator('#voice canvas').evaluate(node=>node.toDataURL()),code=motionSource();
    await source(page,code);const state=await until(async()=>{const value=await inspect(page);return value.codeActive&&value.voiceGroups.some(group=>group.held&&group.owner.kind==='code')?value:false;},'held Code group');
    const group=state.voiceGroups.find(group=>group.held&&group.owner.kind==='code'),slot=group.operatorSlots[0],session=state.codeSession;
    await selectChannel(page,slot);await noPulses('first physical Code observation establishes baseline',120);
    const motionMark=await mark(page);await until(async()=> (await events(page,motionMark)).animations.some(value=>value.key==='scspPhysicalFrequency'&&value.type==='animationstart'),'native frequency pulse');
    const pulseMark=await mark(page),values=new Set(),pulseStarted=(await audit(page,'animations')).findLast(value=>value.key==='scspPhysicalFrequency'&&value.type==='animationstart');
    await until(async()=>{values.add(await page.locator('#scspPhysicalFrequency').inputValue());return(await audit(page,'animations')).some(value=>value.key==='scspPhysicalFrequency'&&value.type==='animationend'&&value.time>pulseStarted.time);},'native bounded frequency animation end');
    const pulseEvents=await events(page,pulseMark);assert(values.size>=2,'normal 100ms observations expose rapid pitch changes within one pulse');
    assert.equal(pulseEvents.classes.filter(value=>value.key==='scspPhysicalFrequency'&&value.active).length,0,'rapid changes never restart an active CSS pulse');
    const ended=(await audit(page,'animations')).find(value=>value.key==='scspPhysicalFrequency'&&value.type==='animationend'&&value.time>pulseStarted.time);
    assert(ended.trusted&&pulseStarted.trusted);assert(Math.abs(ended.elapsed-.42)<.02);assert.equal(pulseStarted.iterations,'1');
    assert(pulseStarted.duration.split(',').some(value=>Math.abs(parseFloat(value)-.42)<.01));
    measurements.nativePulse={start:pulseStarted,end:ended,observedFrequencyValues:[...values],classEvents:pulseEvents.classes.filter(value=>value.key==='scspPhysicalFrequency')};
    const allMotion=await events(page,motionMark);assert(allMotion.classes.some(value=>value.key==='scsp-lfo-frequencyCode'&&value.active));
    assert(!allMotion.classes.some(value=>value.key==='scsp-totalLevel'&&value.active),'unchanged mix receives no pulse');
    assert(!allMotion.classes.some(value=>value.key==='scsp-attackRate'&&value.active),'unchanged Envelope receives no pulse');
    assert(!allMotion.classes.some(value=>/Channel|channel|ENV/.test(value.key)),'channel activity and ENV meters are excluded');
    measurements.codePcm=await sounding(page);checks.push('Documented Code API typed in the real editor changes native frequency/LFO and produces trusted 420ms pulses; rapid values share one pulse, unchanged mix/Envelope and ENV meters stay unmarked');

    step('Off clears active pulse, values keep updating, On rebases');
    await page.locator('#scspPhysicalFrequency').scrollIntoViewIfNeeded();
    await until(async()=> (await pulseKeys(page)).includes('scspPhysicalFrequency'),'next active pulse');
    await screenshot(page,engine,'code-active-pulse',screenshots);
    await until(async()=> (await pulseKeys(page)).includes('scspPhysicalFrequency'),'active pulse immediately before Off');
    await page.uncheck('#scspLiveHighlightToggle');assert.deepEqual(await pulseKeys(page),[]);const offMark=await mark(page),offValues=new Set();
    const offEnd=Date.now()+650;while(Date.now()<offEnd){offValues.add(await page.locator('#scspPhysicalFrequency').inputValue());await sleep(25);}
    assert(offValues.size>=3,'Off does not stop live value updates');assert.deepEqual((await events(page,offMark)).classes.filter(value=>value.active),[]);assert.deepEqual(await pulseKeys(page),[]);
    const onMark=await mark(page);await page.check('#scspLiveHighlightToggle');assert.deepEqual(await pulseKeys(page),[]);
    await until(async()=> (await events(page,onMark)).classes.some(value=>value.key==='scspPhysicalFrequency'&&value.active),'future changed value after On baseline');
    assert.equal((await inspect(page)).codeSession,session);assert.match(await page.locator('#synthCodeState').textContent(),/Running|Playing/);
    measurements.offFrequencyValues=[...offValues];checks.push('Off immediately clears classes while values advance; On establishes a fresh baseline and later changes pulse without ending Code');

    step('focus, Code source and Auto depth');
    await control(page,'totalLevel').focus();const focusBefore=await control(page,'totalLevel').evaluate(node=>node===document.activeElement);
    await sleep(300);assert(focusBefore&&await control(page,'totalLevel').evaluate(node=>node===document.activeElement),'observer pulses preserve keyboard focus');
    await page.locator('#scspChannelTabs [data-scsp-channel="auto"]').click();await until(async()=> (await pulseKeys(page)).some(key=>['fmDepth','operatorDepth'].includes(key)),'Auto Code FM depth pulse');
    assert.equal(await page.locator('#synthCodeEditor').inputValue(),code);assert.equal((await inspect(page)).codeSession,session);
    await until(()=>page.locator('#synthCodeLog').textContent().then(text=>text.includes('highlight-steady-60')),'motion settles to held Code');
    await noPulses('finite pulses finish after Code becomes steady',550);
    checks.push('Existing 100ms observer reflects documented FM depth motion in Auto while preserving focused controls, source text and Code session');

    step('CH, Auto and operator contexts establish silent baselines');
    await cleanNavigation(()=>selectedOperator(page,1),'operator B selection');
    await cleanNavigation(()=>selectChannel(page,slot),'Auto to physical CH');
    await cleanNavigation(()=>selectChannel(page,group.operatorSlots[1]),'physical CH to another CH');
    await cleanNavigation(()=>selectChannel(page,null),'physical CH to Auto');
    await selectedOperator(page,0);assert.equal(await control(page,'root').inputValue(),'500');
    assert.equal(await page.locator('#voice canvas').evaluate(node=>node.toDataURL()),draftWave);assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled(),'unapplied sample draft survives Code inspection');
    const beforeToggle=(await audit(page,'mutations')).length;await page.uncheck('#scspLiveHighlightToggle');await page.check('#scspLiveHighlightToggle');await noPulses('toggle at steady source');
    assert.equal((await audit(page,'mutations')).length,beforeToggle,'highlight preference posts no chip mutations');
    await page.locator('#synthInputKeyboardTab').click();await noPulses('keyboard tab clears highlights');await page.locator('#synthInputCodeTab').click();await noPulses('Code tab rebases');
    assert.equal((await inspect(page)).codeSession,session);checks.push('CH/Auto/operator/tab changes rebase without false flashes; navigation and preference send no extra chip mutations and preserve unapplied sample draft');

    step('Code Stop and a new session');
    await page.locator('#synthCodeStopButton').click();await until(async()=>!(await inspect(page)).codeActive,'Code stopped');await noPulses('Code Stop clears pulse');
    const sessionMark=await mark(page);await source(page,holdSource);await sleep(200);assert.deepEqual((await events(page,sessionMark)).classes.filter(value=>value.active),[],'new held session has no startup flashes');
    assert.notEqual((await inspect(page)).codeSession,session);await page.locator('#synthCodeStopButton').click();await until(async()=>!(await inspect(page)).codeActive,'new session stopped');await silent(page);
    checks.push('Code Stop clears state and a new Code session takes a silent first baseline');

    step('self-authored SSF CPU edits frequency, Envelope, LFO, mix and modulation');
    await loadSsf(page,fixture.bytes);await page.locator('#scspSongPlay').click();await until(()=>page.locator('#scspSsfLive').getAttribute('data-active').then(value=>value==='true'),'SSF Live active');
    await selectChannel(page,0);await noPulses('initial SSF CH snapshot baseline',100);const ssfMark=await mark(page);
    await until(async()=>{const value=await events(page,ssfMark),keys=new Set(value.classes.filter(item=>item.active).map(item=>item.key));return ['scsp-root','scsp-attackRate','scsp-lfo-frequencyCode','scsp-totalLevel','ssf-modulation-depth'].every(key=>keys.has(key));},'CPU-driven parameter pulses');
    const ssfEvents=await events(page,ssfMark);assert(!ssfEvents.classes.some(value=>value.active&&(/Channel|channel|ENV/.test(value.key))));
    await control(page,'totalLevel').scrollIntoViewIfNeeded();await until(async()=> (await pulseKeys(page)).includes('scsp-totalLevel'),'active SSF mix pulse for screenshot');
    await screenshot(page,engine,'ssf-active-pulse',screenshots);
    measurements.ssfPcm=await sounding(page);measurements.ssfPulseKeys=[...new Set(ssfEvents.classes.filter(value=>value.active).map(value=>value.key))];
    checks.push('Original 68000 fixture drives real SSF frequency/Envelope/LFO/mix and read-only modulation pulses; activity and ENV meters stay excluded');

    step('SSF Pause/Resume, seek, Live Off, session and Stop boundaries');
    await page.locator('#scspSongPause').click();await until(()=>page.locator('#scspSongPause').textContent().then(value=>value==='Resume'),'SSF paused');
    await noPulses('Pause clears classes');const pauseMark=await mark(page),frame=await page.locator('#scspSsfLive').getAttribute('data-frame');
    await cleanNavigation(()=>selectChannel(page,1),'paused other SSF CH',{releasePreview:true});await cleanNavigation(()=>selectChannel(page,0),'paused first SSF CH',{releasePreview:true});
    assert.equal(await page.locator('#scspSsfLive').getAttribute('data-frame'),frame);assert.deepEqual((await events(page,pauseMark)).classes.filter(value=>value.active),[]);
    await page.locator('#scspSongPause').click();assert.deepEqual(await pulseKeys(page),[]);await until(()=>page.locator('#scspSongPause').textContent().then(value=>value==='Pause'),'SSF resumed');
    await until(async()=> (await pulseKeys(page)).length>0,'later SSF CPU mutation after Resume');
    await page.locator('#scspSongPause').click();await until(()=>page.locator('#scspSongPause').textContent().then(value=>value==='Resume'),'SSF paused for seek');
    const seekMark=await mark(page);await page.locator('#scspSongSeek').evaluate(input=>{input.value='1.75';input.dispatchEvent(new Event('change',{bubbles:true}));});
    await until(()=>page.locator('#scspSongStatus').textContent().then(text=>!text.startsWith('Seeking')),'paused seek completed');await noPulses('paused seek takes a silent new snapshot');
    assert.deepEqual((await events(page,seekMark)).classes.filter(value=>value.active),[]);
    await page.uncheck('#scspSsfLiveEnabled');await noPulses('paused Live Off clears');await page.check('#scspSsfLiveEnabled');await noPulses('paused Live On rebases');
    await page.locator('#scspSongPause').click();await until(async()=> (await pulseKeys(page)).length>0,'active SSF pulse before Live Off');
    await page.uncheck('#scspSsfLiveEnabled');assert.deepEqual(await pulseKeys(page),[]);await noPulses('playing Live Off stays clear');
    await page.check('#scspSsfLiveEnabled');assert.deepEqual(await pulseKeys(page),[]);await until(async()=> (await pulseKeys(page)).length>0,'active SSF pulse before Stop');
    await page.locator('#scspSongStop').click();assert.deepEqual(await pulseKeys(page),[]);await noPulses('SSF Stop clears an active pulse');await silent(page);
    const replacementMark=await mark(page);await loadSsf(page,fixture.bytes,'highlight-another-original.ssf');await noPulses('replacement song session clears');
    assert.deepEqual((await events(page,replacementMark)).classes.filter(value=>value.active),[]);
    checks.push('Pause, paused CH changes, Resume first observation, seek, Live Off/On, Stop and replacement session clear/rebase without stale flashes');

    step('390 px layout and bounded reduced-motion CSS');
    for(const width of [1400,390]){await page.setViewportSize({width,height:1050});await page.locator('#scspLiveHighlightToggle').scrollIntoViewIfNeeded();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'layout fits '+width);await screenshot(page,engine,'layout-'+width,screenshots);}
    await page.setViewportSize({width:1400,height:1050});await page.emulateMedia({reducedMotion:'reduce'});await source(page,motionSource(8));
    const reducedState=await until(async()=>{const value=await inspect(page);return value.voiceGroups.find(group=>group.held&&group.owner.kind==='code');},'reduced-motion held Code');
    await selectChannel(page,reducedState.operatorSlots[0]);const reducedMark=await mark(page);
    await until(async()=> (await events(page,reducedMark)).animations.some(value=>value.type==='animationend'&&value.key==='scspPhysicalFrequency'),'real reduced-motion animation finishes');
    const reducedEvents=await events(page,reducedMark);const reducedEnd=reducedEvents.animations.find(value=>value.type==='animationend'&&value.key==='scspPhysicalFrequency');
    assert(reducedEnd.trusted&&reducedEnd.elapsed<=.005,'reduced-motion CSS has a finite 1ms native animation');
    await until(()=>page.locator('#synthCodeLog').textContent().then(text=>text.includes('highlight-steady-8')),'reduced-motion motions complete');await noPulses('reduced motion never leaves an infinite class',200);
    await page.locator('#synthCodeStopButton').click();await silent(page);measurements.reducedMotion=reducedEvents;
    checks.push('1400/390 px layouts fit and reduced motion uses trusted finite 1ms CSS animations that remove every class');

    step('storage refusal retains usable default On');
    const blocked=await browser.newContext({viewport:{width:1000,height:900},serviceWorkers:'block'});await blocked.addInitScript(installSilentAudit);await blocked.addInitScript(blockHighlightStorage);
    await blocked.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
    const blockedPage=await blocked.newPage(),blockedErrors=[];blockedPage.on('pageerror',error=>blockedErrors.push(error.message));await blockedPage.goto(origin+config.entry);await blockedPage.locator('#scspLiveHighlightToggle').waitFor();
    assert(await blockedPage.locator('#scspLiveHighlightToggle').isChecked());await blockedPage.uncheck('#scspLiveHighlightToggle');assert(!await blockedPage.locator('#scspLiveHighlightToggle').isChecked());
    await blockedPage.check('#scspLiveHighlightToggle');assert(await blockedPage.locator('#scspLiveHighlightToggle').isChecked());assert.equal((await audit(blockedPage,'graph')).contexts,0);assert.deepEqual(blockedErrors,[]);await blocked.close();
    checks.push('Storage SecurityError keeps default On and the switch remains usable without initializing audio');
    const readTimes=(await audit(page,'commands')).filter(value=>value.method==='readAuthoring').map(value=>value.time);
    const readDeltas=readTimes.slice(1).map((time,index)=>time-readTimes[index]).filter(value=>value>50&&value<250).sort((a,b)=>a-b);
    measurements.existingObserver={samples:readDeltas.length,medianReadIntervalMs:readDeltas[Math.floor(readDeltas.length/2)]};
    assert(readDeltas.length>20&&measurements.existingObserver.medianReadIntervalMs>=75&&measurements.existingObserver.medianReadIntervalMs<=160,'real Live values use the existing approximately 100ms observer');
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(external,[]);const graph=await audit(page,'graph');assert(graph.physicalOutputMuted);assert(graph.rates.every(value=>value===48000));
    return{browser:engine,passed:true,checks,measurements,screenshots,graph,errors,missing,external,expectedBlockedMonaco,physicalOutputMuted:true,listeningPerformed:false,
      auditMethod:'Passive class MutationObserver, trusted native CSS animation events, read-only inspector, recorded MessagePort commands; no production DOM/source injection or helper replacement'};
  }catch(error){await screenshot(page,engine,'failure',screenshots).catch(()=>{});error.receipt={browser:engine,passed:false,stage,checks,measurements,screenshots,error:error.stack,
      errors,missing,external,expectedBlockedMonaco,graph:await audit(page,'graph').catch(()=>null),pulseKeys:await pulseKeys(page).catch(()=>null),
      codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),recentCommands:(await audit(page,'commands').catch(()=>[])).slice(-25),events:await audit(page,'classes').catch(()=>null)};throw error;
  }finally{await context.close();}
}
(async()=>{
  const {ssfFromProgram}=await import(pathToFileURL(path.join(repository,'test/helpers/scsp_ssf_fixture.mjs'))),fixture=createFixture(ssfFromProgram);let failure=null;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
    for(const engine of engines){const browser=await{chromium,webkit}[engine].launch({headless:true,...engine==='chromium'?{args:['--mute-audio']}: {}});
      try{results.push(await check(browser,engine,origin,fixture));}catch(error){results.push(error.receipt??{browser:engine,passed:false,error:error.stack});throw error;}finally{await browser.close();}}
    assert.deepEqual(sourceErrors,[]);
  }catch(error){failure=error;}finally{server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const receipt={schemaVersion:1,passed:!failure,elapsedSeconds:(Date.now()-startedAt)/1000,root:config.root,entry:config.entry,
    physicalOutputMuted:true,listeningPerformed:false,fixture:{provenance:fixture.provenance,imageSha256:fixture.imageSha256,ssfSha256:sha(fixture.bytes),loopAddress:fixture.loopAddress},
    checker:{file:path.relative(repository,__filename),sha256:sha(await fs.readFile(__filename))},servedAssets:Object.fromEntries([...served].sort(([left],[right])=>left.localeCompare(right))),sourceErrors,results,...failure?{error:failure.stack}:{}};
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
