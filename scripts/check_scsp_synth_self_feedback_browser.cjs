// SPDX-License-Identifier: BSD-3-Clause
// Verify the bounded Custom2 self-feedback with permanently muted physical output.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {
  root: path.join(repository, 'docs'), entry: '/synth-scsp/index.html',
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-self-feedback-browser.json'),
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const match = /^--(root|entry|engines|out)(?:=(.+))?$/.exec(args[index]);
  assert(match, 'Unknown argument ' + args[index]);
  config[match[1]] = match[2] ?? args[++index];
  assert(config[match[1]], 'Missing value for ' + match[1]);
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.md': 'text/plain', '.scspasm': 'text/plain',
};
const served = new Map();
const server = http.createServer(async (request, response) => {
  try {
    let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (relative === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(config.root, '.' + relative);
    assert(file.startsWith(config.root + path.sep), 'Request stays inside the isolated static site');
    const bytes = await fs.readFile(file);
    const asset=path.relative(config.root,file).split(path.sep).join('/'),record={bytes:bytes.length,sha256:sha(bytes)};
    assert(!served.has(asset)||served.get(asset).sha256===record.sha256,'Source changed during verification: '+asset);
    served.set(asset, record);
    response.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'}).end(bytes);
  } catch {response.writeHead(404).end();}
});

// All real output reaches an analyser followed by a gain fixed at zero. The
// view cannot make a speaker route, and does not receive any test hooks.
function installSilentAudit() {
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode;
  const connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const audit=window.__scspSelfAudit={contexts:[],nodes:[],meters:[],commands:[],sequence:0};
  window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:48000});audit.contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,options){super(context,name,options);audit.nodes.push({name,node:this});}};
  AudioNode.prototype.connect=function(destination,...rest){
    if(destination!==this.context.destination)return connect.call(this,destination,...rest);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=2048;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);
    audit.meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(data,...rest){
    if(data?.method||data?.type==='chip-inspector')audit.commands.push(structuredClone(data));
    return post.call(this,data,...rest);
  };
  const reads=new Set(['readAuthoring','readPhysical','readDspProgram','readDspSetup','readDspCoefficients','getState','exportPatch']);
  audit.mutations=()=>audit.commands.filter(data=>{
    if(data.type==='chip-inspector')return data.action!=='read'&&data.method!=='getPCM';
    const method=data.method==='code'?data.args?.[1]:data.method;
    return !reads.has(method);
  }).length;
  audit.graph=()=>({contexts:audit.contexts.length,worklets:audit.nodes.map(value=>value.name),
    rates:audit.contexts.map(value=>value.sampleRate),routes:audit.meters.length,
    physicalOutputMuted:audit.meters.every(value=>value.mute.gain.value===0)});
  audit.level=()=>{
    let peak=0;for(const {analyser}of audit.meters){if(analyser.context.state==='closed')continue;
      const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
      for(const value of samples){if(!Number.isFinite(value))throw Error('Non-finite output');peak=Math.max(peak,Math.abs(value));}}
    return {peak};
  };
  audit.request=command=>new Promise((resolve,reject)=>{
    const node=audit.nodes.findLast(value=>value.name==='tetorica-scsp-synth')?.node;
    if(!node){reject(Error('Primary Synth is unavailable'));return;}
    const id='self-fm-audit-'+ ++audit.sequence;
    const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Primary Synth request timed out'));},5000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);
      if(data.error){const error=Error(data.error);error.name=data.name??'Error';reject(error);}else resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({...command,id});
  });
  audit.inspect=()=>audit.request({type:'chip-inspector',action:'read'});
}

async function until(read,label){
  for(let attempt=0;attempt<200;attempt++){
    const value=await read();if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw Error('Timed out: '+label);
}
const inspect=page=>page.evaluate(()=>__scspSelfAudit.inspect());
const graph=page=>page.evaluate(()=>__scspSelfAudit.graph());
const mutations=page=>page.evaluate(()=>__scspSelfAudit.mutations());
const level=page=>page.evaluate(()=>__scspSelfAudit.level());
const waitState=(page,predicate,label)=>until(async()=>{const state=await inspect(page);return predicate(state)?state:false;},label);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function selectOperator(page,index){
  await page.locator(`[data-operator="${index}"]`).click();
  await page.waitForFunction(value=>document.querySelector(`[data-operator="${value}"]`).getAttribute('aria-pressed')==='true',index);
}
async function selectChannel(page,slot){
  await page.locator(`[data-scsp-channel="${slot??'auto'}"]`).click();
  await page.waitForFunction(value=>document.getElementById('scspChannelTabs').dataset.selected===String(value),slot??'auto');
}
async function number(page,id,value){
  await page.locator('#'+id).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));},value);
}
async function saveInstrument(page){
  if(!await page.locator('#synthMenu').evaluate(menu=>menu.open))await page.locator('#synthMenuButton').click();
  const download=page.waitForEvent('download');await page.locator('#save').click();
  return JSON.parse(await fs.readFile(await(await download).path(),'utf8'));
}
async function loadInstrument(page,preset,name){
  await page.setInputFiles('#open',{name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preset))});
}
async function exportProject(page){
  if(!await page.locator('#synthMenu').evaluate(menu=>menu.open))await page.locator('#synthMenuButton').click();
  const pending=page.waitForEvent('download');await page.locator('#scspProjectExportButton').click();
  return fs.readFile(await(await pending).path());
}
async function currentGraph(page){
  return page.locator('#scspCustomFmControls').evaluate(panel=>({hidden:panel.hidden,
    target:document.getElementById('scspCustomFmTarget').textContent,
    inputX:document.getElementById('scspCustomFmInput').value,
    inputY:document.getElementById('scspCustomFmInputY').value,
    output:document.getElementById('scspCustomFmOutput').checked,
    summary:document.getElementById('routingSummary').textContent,
    paths:document.querySelectorAll('#connectionPaths path').length,
    hint:document.getElementById('scspCustomFmHint').textContent}));
}
async function customGraph(page,inputs,outputs){
  return waitState(page,state=>state.config.fm.algorithm==='custom'&&same(state.config.fm.custom,{inputs,outputs}),'custom graph '+JSON.stringify({inputs,outputs}));
}
const request=(page,command)=>page.evaluate(command=>__scspSelfAudit.request(command),command);
async function editGraph(page,inputs,outputs){
  // Clear existing edges first so intermediate UI edits never introduce a cycle.
  for(let target=0;target<inputs.length;target++){
    await selectOperator(page,target);await page.locator('#scspCustomFmInput').selectOption('');
    await until(async()=>!(await inspect(page)).config.fm.custom.inputs[target].length,'clear input '+target);
  }
  for(let target=0;target<inputs.length;target++){
    await selectOperator(page,target);
    if(inputs[target].length){
      await page.locator('#scspCustomFmInput').selectOption(String(inputs[target][0]));
      await until(async()=>same((await inspect(page)).config.fm.custom.inputs[target],[inputs[target][0]]),'first input '+target);
      if(inputs[target].length===2){
        await page.locator('#scspCustomFmInputY').selectOption(String(inputs[target][1]));
        await until(async()=>same((await inspect(page)).config.fm.custom.inputs[target],inputs[target]),'second input '+target);
      }
    }
    await page.locator('#scspCustomFmOutput').setChecked(outputs.includes(target));
    await until(async()=>(await inspect(page)).config.fm.custom.outputs.includes(target)===outputs.includes(target),'output '+target);
  }
  return customGraph(page,inputs,outputs);
}
function verifySelf(state){
  const group=state.voiceGroups.find(value=>value.held);assert(group);assert.equal(group.operatorSlots.length,2);
  const a=group.operatorSlots[0],b=group.operatorSlots[1];assert(b<a);
  assert.equal(state.slots[b].modulation.xOffset,32);assert.equal(state.slots[b].modulation.yOffset,0);
  assert.equal(state.slots[b].modulation.depth,state.config.fm.depths?.[1]??state.config.fm.depth);
  assert.equal(state.slots[a].modulation.xOffset,(b-a+64)%64);assert.equal(state.slots[a].modulation.yOffset,(b-a+64)%64);
  return group;
}
async function rejectConfig(page,patch){
  const before=await inspect(page);
  const rejected=await page.evaluate(async patch=>{try{await __scspSelfAudit.request({method:'setConfig',args:[patch]});return null;}catch(error){return error.message;}},patch);
  assert(rejected,'Invalid request is rejected');
  const after=await inspect(page);assert.deepEqual(after.config,before.config);
  assert.deepEqual(after.voiceGroups.map(({id,slots,held})=>({id,slots,held})),before.voiceGroups.map(({id,slots,held})=>({id,slots,held})));
  return rejected;
}
const depths=state=>state.config.fm.depths??Array(6).fill(state.config.fm.depth);
const identity=state=>({session:state.codeSession,code:state.codeActive,groups:state.voiceGroups.map(({id,slots,operatorSlots,held,order})=>({id,slots,operatorSlots,held,order})),manual:state.manualVoices.map(({id,slot,held})=>({id,slot,held}))});
async function selectedDepth(page,value){
  await selectOperator(page,1);await number(page,'operatorDepth',value);return waitState(page,state=>depths(state)[1]===value,'B MDL '+value);
}
async function file(page,path){
  if(await page.locator('#scspFilesPanel').isHidden())await page.locator('#scspFilesToggle').click();
  for(let i=0;i<12;i++){const closed=page.locator('#scspFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}
  await page.locator(`#scspFilesTree button[data-file-path="${path}"]`).click();
  await page.waitForFunction(path=>document.getElementById('scspFilesSelected').textContent===path&&!document.getElementById('synthCodeRunButton').disabled,path);
  await page.locator('#synthInputCodeTab').click();
}
async function holdCode(page){
  await file(page,'/index.js');await page.locator('#synthCodeEditor').fill(`const scsp=await useSoundChip('scsp');setBpm(120);liveLoop('self-hold',async()=>{await scsp.noteOn(CH1,'A3');await beat(4096);});`);
  await page.locator('#synthCodeRunButton').click();assert.match(await page.locator('#synthCodeEditor').inputValue(),/self-hold/);
  return waitState(page,state=>state.codeActive&&state.voiceGroups.some(value=>value.held&&value.owner?.kind==='code'),'Code self hold');
}
async function nativeProbe(page){
  return page.evaluate(async()=>{
    const script=document.querySelector('script[type="module"][src*="synth.js"]').src;
    const [{default:factory},{Scsp},{SynthInstrument}]=await Promise.all([
      import(new URL('../generated/scsp_wasm.js',script)),import(new URL('../js/scsp.js',script)),import(new URL('./instrument.js',script))]);
    const core=await Scsp.create({moduleFactory:factory});let owner;
    try{
      owner=new SynthInstrument(core);owner.setConfig({mode:'fm2',fm:{algorithm:'custom',custom:{inputs:[[1],[1]],outputs:[0]},depth:4}});
      const calls=[],write=core.write.bind(core);core.write=(...args)=>{calls.push(args);return write(...args);};
      const readRing=()=>Array.from({length:64},(_,index)=>core.read(0x600+index*2));
      const ringCalls=()=>calls.filter(([address])=>address>=0x600&&address<0x680);
      for(let i=0;i<64;i++)core.write(0x600+i*2,1000+i);
      const initial=readRing();calls.length=0;owner.noteOn('first',69);
      const group=owner.read().voiceGroups.find(value=>value.id==='first'),slot=group.operatorSlots[1],clear=ringCalls(),after=readRing();
      if(JSON.stringify(clear)!==JSON.stringify([[0x600+slot*2,0],[0x600+(slot+32)*2,0]]))throw Error('A fresh self attack did not clear exactly its two owned ring cells');
      for(let i=0;i<64;i++)if(after[i]!==([slot,slot+32].includes(i)?0:initial[i]))throw Error('Self attack changed another ring cell');
      const onWord=core.read(slot*32+14);if(onWord!==0x4800)throw Error('Self must use X32/Y0 at MDL4');
      core.write(0x600+slot*2,2345);core.write(0x600+(slot+32)*2,3456);const seeded=readRing();
      calls.length=0;owner.setConfig({fm:{depth:0}});const offWord=core.read(slot*32+14);
      if(offWord!==0||ringCalls().length||JSON.stringify(readRing())!==JSON.stringify(seeded))throw Error('Depth0 must use adapter Off without clearing history');
      owner.setConfig({fm:{depth:4}});const restoredWord=core.read(slot*32+14);
      if(restoredWord!==onWord||ringCalls().length||JSON.stringify(readRing())!==JSON.stringify(seeded))throw Error('Live On must restore X32/Y0 and preserve history');
      core.write(0x600+31*2,4567);core.write(0x600+63*2,5678);const manualBefore=readRing();calls.length=0;
      owner.physicalNoteOn('raw-manual',31,60);
      if(ringCalls().length||JSON.stringify(readRing())!==JSON.stringify(manualBefore))throw Error('Raw physical attacks must retain sound-stack history');
      const nonself=new Float32Array(64);owner.synth.renderInto(nonself,new Float32Array(64),64);
      const beforeSecond=readRing();calls.length=0;owner.noteOn('second',72);
      const second=owner.read().voiceGroups.find(value=>value.id==='second'),next=second.operatorSlots[1],secondClear=ringCalls(),secondRing=readRing();
      if(JSON.stringify(secondClear)!==JSON.stringify([[0x600+next*2,0],[0x600+(next+32)*2,0]]))throw Error('The next Auto group must clear only its own feedback history');
      for(let i=0;i<64;i++)if(secondRing[i]!==([next,next+32].includes(i)?0:beforeSecond[i]))throw Error('A second group changed another feedback history');
      return{nativeRate:core.sampleRate,onWord,offWord,restoredWord,selfSlot:slot,clearAddresses:clear.map(row=>row[0]),secondSelfSlot:next,secondClearAddresses:secondClear.map(row=>row[0]),otherHistoryPreserved:true,manualHistoryPreserved:true,deviceOpened:false};
    }finally{if(owner)owner.dispose();else core.dispose();}
  });
}
async function exercise(name,origin){
  const browser=await({chromium,webkit}[name]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
  const errors=[],missing=[],external=[],cases=[],screenshots={};
  const imageBase=path.join(path.dirname(path.resolve(config.out)),path.basename(config.out,'.json')+'-'+name);
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  try{
    await page.goto(origin+config.entry);await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('[data-scsp-channel]').length===33);
    const coldBefore=await graph(page),coldWrites=await mutations(page);
    await page.locator('#voiceMode').selectOption('fm2');await page.locator('#algorithm').selectOption('custom');await selectOperator(page,1);
    assert.match(await page.locator('#scspCustomFmInput option[value="1"]').textContent(),/Self.*B.*2 taps/);assert.equal(await page.locator('#scspCustomFmInput option[value="1"]').evaluate(value=>value.disabled),false);
    await page.locator('#scspCustomFmInput').selectOption('1');await number(page,'operatorDepth',4);
    await page.waitForFunction(()=>document.querySelectorAll('#connectionPaths path[data-self-feedback="true"]').length===1);
    assert(await page.locator('#scspCustomFmInputYLabel').isHidden());assert.match(await page.locator('#scspCustomFmHint').textContent(),/Self.*B.*X32.*Y0/);
    await selectOperator(page,0);assert.equal(await page.locator('#scspCustomFmInput option[value="0"]').evaluate(value=>value.disabled),true);
    assert.deepEqual(await graph(page),coldBefore);assert.equal(await mutations(page),coldWrites);
    cases.push('Cold Custom2 offers one Self operator, its two-tap hint/loop and existing external edge without starting audio');
    await page.locator('#start').click();await page.waitForFunction(()=>__scspSelfAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    const self={inputs:[[1],[1]],outputs:[0]};await customGraph(page,self.inputs,self.outputs);
    await page.keyboard.down('a');let state=await waitState(page,state=>state.voiceGroups.some(value=>value.held),'keyboard self group');const first=verifySelf(state);
    const audible=await until(async()=>{const value=await level(page);return value.peak>.00005?value:false;},'finite native self output');
    let before=identity(state),dsp=await request(page,{method:'readDspSetup',args:[]});state=await selectedDepth(page,0);assert.deepEqual(identity(state),before);
    assert.match(await page.locator('#scspCustomFmHint').textContent(),/Off|depth 0/i);state=await selectedDepth(page,4);assert.deepEqual(identity(state),before);verifySelf(state);
    assert.deepEqual(await request(page,{method:'readDspSetup',args:[]}),dsp);await page.keyboard.up('a');
    const savedMixed8=await saveInstrument(page);assert.equal(savedMixed8.version,8);assert.deepEqual(savedMixed8.fm.custom,self);assert.equal(savedMixed8.fm.depths[1],4);
    screenshots.desktop=imageBase+'-desktop.png';await page.locator('.operator-panel').screenshot({path:screenshots.desktop});
    const beforeProbe=await graph(page),native=await nativeProbe(page);assert.deepEqual(await graph(page),beforeProbe);
    cases.push('Real keyboard self feedback stays finite; live Depth Off/On preserves owners and DSP, while a device-free browser WASM probe verifies raw X32/Y0 bits and exactly two owned history-cell clears');
    await page.keyboard.down('s');await waitState(page,state=>state.voiceGroups.some(value=>value.held),'held group for atomic errors');
    const rejected=[];for(const patch of [
      {fm:{custom:{inputs:[[0],[1]],outputs:[0]}}},{fm:{custom:{inputs:[[0,1],[]],outputs:[0]}}},
      {fm:{custom:{inputs:[[1],[0]],outputs:[0]}}},{mode:'fm4',fm:{custom:{inputs:[[0,1],[1],[],[]],outputs:[0]}}},
      {mode:'fm6',fm:{custom:{inputs:[[],[],[],[],[],[4,5]],outputs:[0]}}},{mode:'fm4',fm:{custom:self}}
    ])rejected.push(await rejectConfig(page,patch));
    await page.keyboard.up('s');cases.push('Double Self in Custom2, a second self input, multi-OP cycles and mode/count mismatches reject atomically without retiring notes');
    await page.locator('#voiceMode').selectOption('fm4');await customGraph(page,[[1],[1],[],[]],[0]);assert.equal(await page.locator('#connectionPaths path[data-self-feedback="true"]').count(),1);
    await page.locator('#voiceMode').selectOption('fm6');await customGraph(page,[[1],[1],[],[],[],[]],[0]);
    await page.locator('#voiceMode').selectOption('fm2');await customGraph(page,[[1],[1]],[0]);
    await loadInstrument(page,savedMixed8,'self-mixed-v8.json');await customGraph(page,self.inputs,self.outputs);
    await page.locator('#algorithm').selectOption('chain');await waitState(page,state=>state.config.fm.algorithm==='chain','fixed dormant Self');
    await page.locator('#voiceMode').selectOption('fm4');await waitState(page,state=>state.config.mode==='fm4','fixed mode with dormant Self');
    await page.locator('#algorithm').selectOption('custom');await customGraph(page,[[1],[1],[],[]],[0]);
    await selectOperator(page,1);await page.locator('#scspCustomFmInput').selectOption('');await customGraph(page,[[1],[],[],[]],[0]);
    await number(page,'fmDepth',7);await waitState(page,state=>!state.config.fm.depths&&state.config.fm.depth===7,'uniform legacy depth');const custom6=await saveInstrument(page);assert.equal(custom6.version,6);
    await page.locator('#voiceMode').selectOption('fm2');await customGraph(page,[[1],[]],[0]);const custom5=await saveInstrument(page);assert.equal(custom5.version,5);
    await page.locator('#algorithm').selectOption('chain');await waitState(page,state=>state.config.fm.algorithm==='chain','legacy fixed mode');const fixed4=await saveInstrument(page);assert.equal(fixed4.version,4);
    await number(page,'operatorDepth',5);await waitState(page,state=>Boolean(state.config.fm.depths),'mixed nonself legacy');const nonself7=await saveInstrument(page);assert.equal(nonself7.version,7);
    cases.push('Mode growth and dormant projection preserve surviving Self; explicitly removing it retains nonself v4/v5/v6/v7 export formats');
    await loadInstrument(page,savedMixed8,'self-v8-to-scalar.json');await customGraph(page,self.inputs,self.outputs);await number(page,'fmDepth',6);await waitState(page,state=>!state.config.fm.depths&&state.config.fm.depth===6,'uniform Self depth');
    const savedScalar8=await saveInstrument(page);assert.equal(savedScalar8.version,8);assert.equal(savedScalar8.fm.depths,undefined);
    await loadInstrument(page,savedMixed8,'self-v8-roundtrip.json');await customGraph(page,self.inputs,self.outputs);assert.deepEqual(depths(await inspect(page)),savedMixed8.fm.depths);
    for(let version=1;version<=7;version++){
      const invalid={...savedScalar8,version};if(version===7)invalid.fm={...invalid.fm,depths:[6,6,6,6,6,6]};
      const before=await request(page,{method:'exportPatch',args:[]});
      const message=await page.evaluate(async patch=>{try{await __scspSelfAudit.request({method:'loadPatch',args:[patch]});return null;}catch(error){return error.message;}},invalid);
      assert(message,'Old v'+version+' must reject Self');assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),before);
    }
    for(const custom of [null,{inputs:[[1],[]],outputs:[0]}]){
      const invalid={...savedScalar8,fm:{...savedScalar8.fm}};if(custom)invalid.fm.custom=custom;else delete invalid.fm.custom;
      const before=await request(page,{method:'exportPatch',args:[]});const message=await page.evaluate(async patch=>{try{await __scspSelfAudit.request({method:'loadPatch',args:[patch]});return null;}catch(error){return error.message;}},invalid);
      assert(message);assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),before);
    }
    cases.push('Scalar and mixed Self presets round-trip as v8; v1–v7 reject Self and v8 rejects absent or nonself graphs while preserving the current sound');
    await file(page,'/examples/self-feedback.js');assert.match(await page.locator('#synthCodeEditor').inputValue(),/inputs: \[\[1\], \[1\]\]/);await page.locator('#synthCodeRunButton').click();
    await waitState(page,state=>state.codeActive&&state.voiceGroups.some(value=>value.held&&value.owner?.kind==='code'),'bundled Self Code example');
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'example stopped');
    await loadInstrument(page,savedMixed8,'self-for-code.json');await customGraph(page,self.inputs,self.outputs);const code=await holdCode(page);
    await selectChannel(page,31);await page.keyboard.down('a');await waitState(page,state=>state.manualVoices.some(value=>value.slot===31&&value.held),'manual owner with Code');
    await selectChannel(page,null);before=identity(await inspect(page));dsp=await request(page,{method:'readDspSetup',args:[]});state=await selectedDepth(page,0);assert.deepEqual(identity(state),before);state=await selectedDepth(page,8);assert.deepEqual(identity(state),before);
    const prior=state.voiceGroups.find(value=>value.owner?.kind==='code'&&value.held);
    await request(page,{method:'code',args:[code.codeSession,'noteOn',[0,69]]});const retriggered=await waitState(page,state=>state.voiceGroups.some(value=>value.id===prior.id&&value.order>prior.order),'Code self retrigger');
    assert.equal(retriggered.codeSession,code.codeSession);assert(retriggered.manualVoices.some(value=>value.slot===31&&value.held));verifySelf(retriggered);
    assert.deepEqual(await request(page,{method:'readDspSetup',args:[]}),dsp);await page.keyboard.up('a');await waitState(page,state=>state.manualVoices.every(value=>value.slot!==31||!value.held),'manual key-up after Self live edit/retrigger');
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'Code Self Stop');await page.locator('#stop').click();
    cases.push('Fresh-project Self example runs through Code; live edits and Code retrigger preserve its session, independent physical owners/key-up and DSP');
    await loadInstrument(page,savedMixed8,'self-before-cassette.json');await customGraph(page,self.inputs,self.outputs);
    const archive=await exportProject(page),{loadPlaygroundCassette}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')).href),cassette=await loadPlaygroundCassette(new Uint8Array(archive));
    const settings=JSON.parse(new TextDecoder().decode(cassette.files.get('scsp-synth.project.json'))).settings;assert.equal(settings.version,8);assert.deepEqual(settings.fm.custom,self);assert.deepEqual(settings.fm.depths,savedMixed8.fm.depths);
    await loadInstrument(page,fixed4,'fixed-before-self-project.json');await waitState(page,state=>state.config.fm.algorithm==='chain','fixed before Self restore');
    await page.locator('#scspProjectFileInput').setInputFiles({name:'self.cassette.zip',mimeType:'application/zip',buffer:archive});await until(async()=>/project imported/.test(await page.locator('#scspFilesStatus').textContent()),'Self Cassette imported');await customGraph(page,self.inputs,self.outputs);
    await page.reload();await page.waitForFunction(()=>!document.querySelector('.scsp-main').inert&&!document.getElementById('start').disabled);await page.waitForFunction(()=>document.querySelectorAll('#connectionPaths path[data-self-feedback="true"]').length===1);
    assert.equal((await graph(page)).contexts,0);await page.locator('#start').click();await page.waitForFunction(()=>__scspSelfAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);await customGraph(page,self.inputs,self.outputs);assert.equal((await inspect(page)).codeActive,false);
    await selectOperator(page,1);await page.locator('#stop').click();const stopped=await until(async()=>{const value=await level(page);return value.peak===0?value:false;},'Self Stop silence');
    await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'Mobile overflow '+overflow);screenshots.mobile=imageBase+'-mobile.png';await page.locator('.operator-panel').screenshot({path:screenshots.mobile});
    cases.push('V8 Self graph/PCM/depths survive Cassette and silent local draft restoration; narrow layout and Stop remain sound');
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    return{browser:name,rate:48000,passed:true,cases,coldBefore,operatorSlots:first.operatorSlots,audible,stopped,nativeProbe:native,rejected,graph:audited,mobileOverflow:overflow,screenshots,errors,missing,externalRequestsBlocked:external.length};
  }catch(error){console.error(JSON.stringify({name,errors,missing,status:await page.locator('#status').textContent(),custom:await currentGraph(page).catch(()=>null),body:(await page.locator('body').innerText()).slice(0,6000)},null,2));throw error;}
  finally{await context.close();await browser.close();}
}

(async()=>{
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    const results=[];for(const name of engines)results.push(await exercise(name,origin));
    for(const [name,record]of served)assert.equal(sha(await fs.readFile(path.join(config.root,name))),record.sha256,'Source changed '+name);
    const report={passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,assets:Object.fromEntries(served)};
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP bounded self-feedback browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

