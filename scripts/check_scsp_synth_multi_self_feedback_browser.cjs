// SPDX-License-Identifier: BSD-3-Clause
// Verify single-Self Custom4/6 feedback with permanently muted physical output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-multi-self-feedback-browser.json'),
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
function verifyMapping(state,expected){
  const group=state.voiceGroups.find(value=>value.held);assert(group,'A held group exists');
  assert.equal(group.operatorSlots.length,expected.inputs.length);
  assert.equal(new Set(group.operatorSlots).size,expected.inputs.length);
  const self=expected.inputs.findIndex((sources,target)=>same(sources,[target]));assert(self>=0);
  for(let target=0;target<expected.inputs.length;target++){
    const slot=group.operatorSlots[target],voice=state.slots[slot],sources=expected.inputs[target];
    assert.equal(voice.directLevel,expected.outputs.includes(target)?state.slots[target].directLevel:0,'Direct output follows authored OP '+target);
    const depth=depths(state)[target];assert.equal(voice.modulation.depth,sources.length?depth:0);
    const offsets=target===self?[32,0]:sources.map(source=>{
      assert(group.operatorSlots[source]<slot,'External source precedes target');return(group.operatorSlots[source]-slot+64)%64;});
    assert.equal(voice.modulation.xOffset,depth?(offsets[0]??0):0);
    assert.equal(voice.modulation.yOffset,depth?(offsets[1]??offsets[0]??0):0);
  }
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
async function selectedDepth(page,operator,value){
  await selectOperator(page,operator);await number(page,'operatorDepth',value);
  return waitState(page,state=>depths(state)[operator]===value,'OP '+operator+' MDL '+value);
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
const graph4={inputs:[[1,2],[3],[3],[3]],outputs:[0,2]};
const graph6={inputs:[[1,2],[5],[5],[1,2],[3],[5]],outputs:[0,4]};
async function nativeProbe(page){
  return page.evaluate(async graphs=>{
    const script=document.querySelector('script[type="module"][src*="synth.js"]').src;
    const [{default:factory},{Scsp},{SynthInstrument}]=await Promise.all([
      import(new URL('../generated/scsp_wasm.js',script)),import(new URL('../js/scsp.js',script)),import(new URL('./instrument.js',script))]);
    const results=[];
    for(const custom of graphs){
      const core=await Scsp.create({moduleFactory:factory});let owner;
      try{
        owner=new SynthInstrument(core);owner.setConfig({mode:'fm'+custom.inputs.length,fm:{algorithm:'custom',custom,depth:4}});
        const calls=[],write=core.write.bind(core);core.write=(...args)=>{calls.push(args);return write(...args);};
        const ring=()=>Array.from({length:64},(_,i)=>core.read(0x600+i*2));
        const ringCalls=()=>calls.filter(([address])=>address>=0x600&&address<0x680);
        for(let i=0;i<64;i++)core.write(0x600+i*2,1000+i);
        const before=ring();calls.length=0;owner.noteOn('first',69);
        const state=owner.read(),group=state.voiceGroups.find(value=>value.id==='first');
        const self=custom.inputs.findIndex((sources,target)=>sources.length===1&&sources[0]===target),slot=group.operatorSlots[self];
        const clears=ringCalls();
        if(JSON.stringify(clears)!==JSON.stringify([[0x600+slot*2,0],[0x600+(slot+32)*2,0]]))throw Error('Self attack must clear only two owned cells');
        for(let i=0;i<64;i++)if(ring()[i]!==([slot,slot+32].includes(i)?0:before[i]))throw Error('Attack changed unrelated history');
        const words=[];
        for(let target=0;target<custom.inputs.length;target++){
          const physical=group.operatorSlots[target],sources=custom.inputs[target];
          const offsets=target===self?[32,0]:sources.map(source=>(group.operatorSlots[source]-physical+64)%64);
          const expected=sources.length?(4<<12)|(offsets[0]<<6)|(offsets[1]??offsets[0]):0;
          const actual=core.read(physical*32+14);if(actual!==expected)throw Error('Raw modulation word mismatch at OP '+target);
          words.push(actual);
        }
        core.write(0x600+slot*2,2345);core.write(0x600+(slot+32)*2,3456);const seeded=ring();calls.length=0;
        owner.setConfig({fm:{depth:0}});if(core.read(slot*32+14)!==0||ringCalls().length||JSON.stringify(ring())!==JSON.stringify(seeded))throw Error('Live Off changed history');
        owner.setConfig({fm:{depth:4}});if(core.read(slot*32+14)!==0x4800||ringCalls().length||JSON.stringify(ring())!==JSON.stringify(seeded))throw Error('Live On changed history');
        const left=new Float32Array(128),right=new Float32Array(128);owner.synth.renderInto(left,right,128);
        if([...left,...right].some(value=>!Number.isFinite(value)))throw Error('Non-finite feedback render');
        calls.length=0;owner.noteOn('second',72);
        const retriggered=owner.read().voiceGroups.find(value=>value.id==='second'),next=retriggered.operatorSlots[self];
        if(JSON.stringify(ringCalls())!==JSON.stringify([[0x600+next*2,0],[0x600+(next+32)*2,0]]))throw Error('Next Auto attack must initialize its own two cells');
        results.push({operators:custom.inputs.length,selfOperator:self,operatorSlots:group.operatorSlots,modulationWords:words,clearAddresses:clears.map(row=>row[0]),nextSelfSlot:next,nativeRate:core.sampleRate,historyPreservedDuringLiveEdits:true,deviceOpened:false});
      }finally{if(owner)owner.dispose();else core.dispose();}
    }
    return results;
  },[graph4,graph6]);
}
async function rejectPatch(page,patch){
  const before=await request(page,{method:'exportPatch',args:[]});
  const error=await page.evaluate(async patch=>{try{await __scspSelfAudit.request({method:'loadPatch',args:[patch]});return null;}catch(error){return error.message;}},patch);
  assert(error,'Invalid preset rejects');assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),before);return error;
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
    await page.locator('#voiceMode').selectOption('fm4');await page.locator('#algorithm').selectOption('branch');await page.locator('#algorithm').selectOption('custom');await selectOperator(page,0);
    await page.waitForFunction(()=>document.getElementById('scspCustomFmInput').value==='1'&&document.getElementById('scspCustomFmInputY').value==='2');
    assert.equal(await page.locator('#scspCustomFmInput option[value="0"]').evaluate(value=>value.disabled),false);
    await page.locator('#scspCustomFmInput').selectOption('0');await page.waitForFunction(()=>document.getElementById('scspCustomFmInputY').disabled);
    assert.equal(await page.locator('#scspCustomFmInputY').inputValue(),'');
    assert.equal(await page.locator('#scspCustomFmInputY option[value=""]').textContent(),'Past history · Y0');
    assert.match(await page.locator('#scspCustomFmHint').textContent(),/Self.*A.*X32.*Y0/);
    assert.equal(await page.locator('#connectionPaths path[data-self-feedback="true"]').count(),1);
    await selectOperator(page,3);assert.equal(await page.locator('#scspCustomFmInput option[value="3"]').evaluate(value=>value.disabled),false);
    assert.deepEqual(await graph(page),coldBefore);assert.equal(await mutations(page),coldWrites);
    cases.push('Cold Custom4 Self replaces two external inputs, occupies X/Y histories, permits an independent second Self and draws its loop without audio');
    await page.locator('#start').click();await page.waitForFunction(()=>__scspSelfAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    await editGraph(page,graph4.inputs,graph4.outputs);await page.keyboard.down('a');let state=await waitState(page,state=>state.voiceGroups.some(value=>value.held),'four OP keyboard');
    const four=verifyMapping(state,graph4),fourOperatorSlots=four.operatorSlots;
    const audible=await until(async()=>{const value=await level(page);return value.peak>.00005?value:false;},'finite multi Self output');
    await request(page,{method:'setDspSourceSend',args:[3,{input:1,level:6}]});
    state=await waitState(page,state=>state.dspRouting.slots[fourOperatorSlots[3]].input===1&&state.dspRouting.slots[fourOperatorSlots[3]].level===6,'Self source DSP mapping');
    let before=identity(state),dsp=await request(page,{method:'readDspSetup',args:[]});state=await selectedDepth(page,3,0);assert.deepEqual(identity(state),before);
    state=await selectedDepth(page,3,4);assert.deepEqual(identity(state),before);verifyMapping(state,graph4);assert.deepEqual(await request(page,{method:'readDspSetup',args:[]}),dsp);
    await page.keyboard.up('a');await waitState(page,state=>state.voiceGroups.every(value=>!value.held),'four OP key-up');
    const saved4=await saveInstrument(page);assert.equal(saved4.version,9);assert.deepEqual(saved4.fm.custom,graph4);assert.equal(saved4.fm.depths[3],4);
    screenshots.four=imageBase+'-four.png';await page.locator('.operator-panel').screenshot({path:screenshots.four});
    const beforeProbe=await graph(page),native=await nativeProbe(page);assert.deepEqual(await graph(page),beforeProbe);
    cases.push('Custom4 Self fan-out/merge/direct/DSP routes follow physical allocation; live Off/On preserves owners/setup, native WASM verifies X32/Y0, external average words and only owned history initialization');
    await page.locator('#voiceMode').selectOption('fm6');await editGraph(page,graph6.inputs,graph6.outputs);await page.keyboard.down('s');state=await waitState(page,state=>state.voiceGroups.some(value=>value.held),'six OP keyboard');
    const six=verifyMapping(state,graph6),sixOperatorSlots=six.operatorSlots;assert(sixOperatorSlots[5]<sixOperatorSlots[0]);
    const rejected=[];for(const patch of [
      {fm:{custom:{inputs:[[0,1],[],[],[],[],[5]],outputs:[0]}}},
      {fm:{custom:{inputs:[[],[],[],[],[],[4,5]],outputs:[0]}}},
      {fm:{custom:{inputs:[[1,1],[],[],[],[],[5]],outputs:[0]}}},
      {fm:{custom:{inputs:[[1],[0],[],[],[],[5]],outputs:[0]}}},
      {fm:{custom:{inputs:[[1,2,3],[],[],[],[],[5]],outputs:[0]}}},
      {mode:'fm4',fm:{custom:graph6}}
    ])rejected.push(await rejectConfig(page,patch));
    await page.keyboard.up('s');await number(page,'fmDepth',5);await waitState(page,state=>!state.config.fm.depths&&state.config.fm.depth===5,'scalar six depth');
    const saved6=await saveInstrument(page);assert.equal(saved6.version,9);assert.equal(saved6.fm.depths,undefined);assert.deepEqual(saved6.fm.custom,graph6);
    await selectOperator(page,5);screenshots.six=imageBase+'-six.png';await page.locator('.operator-panel').screenshot({path:screenshots.six});
    cases.push('Custom6 high-ID Self fans out through two-input merges and independent outputs; mixed Self inputs, duplicates, cycles, excess inputs and count mismatch reject atomically');
    await page.locator('#voiceMode').selectOption('fm4');await customGraph(page,[[1,2],[],[],[1,2]],[0]);
    assert.equal(await page.locator('#connectionPaths path[data-self-feedback="true"]').count(),0);
    await loadInstrument(page,saved4,'four-self-v9.json');await customGraph(page,graph4.inputs,graph4.outputs);
    await page.locator('#voiceMode').selectOption('fm6');await customGraph(page,[...graph4.inputs,[],[]],graph4.outputs);
    await page.locator('#algorithm').selectOption('chain');await page.locator('#voiceMode').selectOption('fm4');await page.locator('#algorithm').selectOption('custom');await customGraph(page,graph4.inputs,graph4.outputs);
    await loadInstrument(page,saved6,'six-self-v9.json');await customGraph(page,graph6.inputs,graph6.outputs);
    for(let version=1;version<=8;version++){
      const invalid={...saved6,version};if(version===7)invalid.fm={...invalid.fm,depths:Array(6).fill(5)};
      await rejectPatch(page,invalid);
    }
    for(const invalid of [
      {...saved6,mode:'fm2',fm:{...saved6.fm,custom:{inputs:[[1],[1]],outputs:[0]}}},
      {...saved6,fm:{...saved6.fm,custom:{inputs:[[1,2],[],[],[1,2],[3],[]],outputs:[0]}}},
      {...saved6,fm:{...saved6.fm,custom:undefined}}
    ])await rejectPatch(page,invalid);
    const legacy8={...saved6,version:8,mode:'fm2',fm:{...saved6.fm,custom:{inputs:[[1],[1]],outputs:[0]}}};
    await loadInstrument(page,legacy8,'legacy-two-self-v8.json');await customGraph(page,[[1],[1]],[0]);assert.equal((await saveInstrument(page)).version,8);
    await loadInstrument(page,saved4,'restore-four-mixed-v9.json');await customGraph(page,graph4.inputs,graph4.outputs);assert.deepEqual(depths(await inspect(page)),saved4.fm.depths);
    cases.push('Resize preserves surviving/dormant Self and removes high-ID Self/references; scalar/mixed v9 round-trip, legacy v8 stays two-OP and invalid old/new formats preserve current sound');
    await file(page,'/examples/self-feedback-6op.js');assert.match(await page.locator('#synthCodeEditor').inputValue(),/self-feedback-6op-melody/);await page.locator('#synthCodeRunButton').click();
    await waitState(page,state=>state.codeActive&&state.voiceGroups.some(value=>value.held&&value.owner?.kind==='code'&&value.operatorSlots?.length===6),'bundled six Self example');
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'example stopped');
    await loadInstrument(page,saved6,'self-for-code.json');await customGraph(page,graph6.inputs,graph6.outputs);const code=await holdCode(page);
    await selectChannel(page,31);await page.keyboard.down('a');await waitState(page,state=>state.manualVoices.some(value=>value.slot===31&&value.held),'manual alongside Code');
    await selectChannel(page,null);before=identity(await inspect(page));dsp=await request(page,{method:'readDspSetup',args:[]});state=await selectedDepth(page,5,0);assert.deepEqual(identity(state),before);state=await selectedDepth(page,5,8);assert.deepEqual(identity(state),before);
    const prior=state.voiceGroups.find(value=>value.owner?.kind==='code'&&value.held);verifyMapping(state,graph6);
    await request(page,{method:'code',args:[code.codeSession,'noteOn',[0,69]]});state=await waitState(page,state=>state.voiceGroups.some(value=>value.id===prior.id&&value.order>prior.order),'Code Self retrigger');
    assert.equal(state.codeSession,code.codeSession);assert(state.manualVoices.some(value=>value.slot===31&&value.held));verifyMapping(state,graph6);assert.deepEqual(await request(page,{method:'readDspSetup',args:[]}),dsp);
    await page.keyboard.up('a');await waitState(page,state=>state.manualVoices.every(value=>value.slot!==31||!value.held),'manual physical key-up');
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'Code stop');await page.locator('#stop').click();
    cases.push('Fresh six-OP Code example runs; live Self depth and retrigger preserve Code session, independent physical owner/key-up and DSP setup');
    await loadInstrument(page,saved4,'four-before-ssf.json');await customGraph(page,graph4.inputs,graph4.outputs);const authored=await request(page,{method:'exportPatch',args:[]});
    const {createScspSsfCaptureFixture}=await import(pathToFileURL(path.join(repository,'test/helpers/scsp_ssf_fixture.mjs')).href),fixture=createScspSsfCaptureFixture();
    await page.locator('#ssfFileInput').setInputFiles({name:'multi-self-scope.ssf',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
    await page.locator('#scspSongPlay').click();await page.waitForFunction(()=>document.getElementById('scspSsfLive').dataset.active==='true');
    assert(await page.locator('#scspCustomFmInput').isHidden()||await page.locator('#scspCustomFmInput').isDisabled());assert(await page.locator('#operatorDepth').isDisabled());assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),authored);
    await page.locator('#scspSongPause').click();await page.waitForFunction(()=>document.getElementById('scspSongPause').textContent==='Resume');assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),authored);
    await page.locator('#scspSongStop').click();await selectChannel(page,null);await customGraph(page,graph4.inputs,graph4.outputs);
    cases.push('SSF Live play/pause retains read-only scope and keeps the authored Custom4 v9 graph, PCM, depths and DSP intact');
    const archive=await exportProject(page),{loadPlaygroundCassette}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')).href),cassette=await loadPlaygroundCassette(new Uint8Array(archive));
    const settings=JSON.parse(new TextDecoder().decode(cassette.files.get('scsp-synth.project.json'))).settings;assert.equal(settings.version,9);assert.deepEqual(settings.fm.custom,graph4);assert.deepEqual(settings.fm.depths,saved4.fm.depths);
    await loadInstrument(page,legacy8,'legacy-before-project.json');await customGraph(page,[[1],[1]],[0]);
    await page.locator('#scspProjectFileInput').setInputFiles({name:'multi-self.cassette.zip',mimeType:'application/zip',buffer:archive});await until(async()=>/project imported/.test(await page.locator('#scspFilesStatus').textContent()),'v9 Cassette imported');await customGraph(page,graph4.inputs,graph4.outputs);
    await page.reload();await page.waitForFunction(()=>!document.querySelector('.scsp-main').inert&&!document.getElementById('start').disabled);await page.waitForFunction(()=>document.getElementById('voiceMode').value==='fm4'&&document.querySelectorAll('#connectionPaths path[data-self-feedback="true"]').length===1);
    assert.equal((await graph(page)).contexts,0);await page.locator('#start').click();await page.waitForFunction(()=>__scspSelfAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);await customGraph(page,graph4.inputs,graph4.outputs);assert.equal((await inspect(page)).codeActive,false);
    await page.locator('#stop').click();const stopped=await until(async()=>{const value=await level(page);return value.peak===0?value:false;},'Stop silence');
    cases.push('V9 Custom4 graph/depths/PCM survive Cassette and local draft restore without starting audio or Code');
    await selectOperator(page,3);await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'Mobile overflow '+overflow);screenshots.mobile=imageBase+'-mobile.png';await page.locator('.operator-panel').screenshot({path:screenshots.mobile});
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    cases.push('Narrow layout keeps Self controls/diagram readable; all destination routes remain permanently muted at 48 kHz with no page or asset errors');
    return{browser:name,rate:48000,passed:true,cases,coldBefore,fourOperatorSlots,sixOperatorSlots,audible,stopped,nativeProbe:native,rejected,graph:audited,mobileOverflow:overflow,screenshots,errors,missing,externalRequestsBlocked:external.length};
  }catch(error){console.error(JSON.stringify({name,errors,missing,status:await page.locator('#status').textContent(),custom:await currentGraph(page).catch(()=>null),body:(await page.locator('body').innerText()).slice(0,6500)},null,2));throw error;}
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
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP multi Self-feedback browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
