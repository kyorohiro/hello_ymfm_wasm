// SPDX-License-Identifier: BSD-3-Clause
// Verify selectable Cycle2 UI, routing, ownership and presets with permanently muted output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-cycle2-ui-browser.json'),
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
  const audit=window.__scspCycleAudit={contexts:[],nodes:[],meters:[],commands:[],sequence:0};
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
    const id='cycle2-audit-'+ ++audit.sequence;
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
const inspect=page=>page.evaluate(()=>__scspCycleAudit.inspect());
const graph=page=>page.evaluate(()=>__scspCycleAudit.graph());
const mutations=page=>page.evaluate(()=>__scspCycleAudit.mutations());
const level=page=>page.evaluate(()=>__scspCycleAudit.level());
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
async function voiceNumber(page,key,value){
  await page.locator(`[data-chip-control="scsp-${key}"]`).evaluate((input,value)=>{
    input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
}
async function portable(page){return request(page,{method:'exportPatch',args:[]});}
const withoutName=value=>{const {name,...sound}=value;return sound;};
async function samePortable(page,expected,label){
  return until(async()=>{const actual=await portable(page);return same(withoutName(actual),withoutName(expected))?actual:false;},label);
}
async function saveFileSound(page,name){
  const previous=await page.locator('#scspFilesSelected').textContent();
  if(name){
    await page.locator('#scspSaveSoundAs').click();
    await page.locator('#scspFileNameDialog').waitFor({state:'visible'});
    await page.locator('#scspFileNameInput').fill(name);
    await page.locator('#scspFileNameConfirm').click();
  }else await page.locator('#scspFileSaveSoundButton').click();
  return until(async()=>{const selected=await page.locator('#scspFilesSelected').textContent();
    return selected!==previous&&/\/presets\/.+\.scsp\.json$/.test(selected)&&await page.locator('#scspFilesPanel').getAttribute('aria-busy')==='false'?selected:false;
  },'Cycle preset saved in Files');
}
async function presetOption(page,filePath){
  return until(()=>page.locator('#scspPresetSelect option').evaluateAll((options,target)=>options.find(option=>option.title===target)?.value??null,filePath),'preset option '+filePath);
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
const request=(page,command)=>page.evaluate(command=>__scspCycleAudit.request(command),command);
const identity=state=>({session:state.codeSession,active:state.codeActive,groups:state.voiceGroups.map(({id,slots,operatorSlots,held,order})=>({id,slots,operatorSlots,held,order})),manual:state.manualVoices});
async function file(page,target='/index.js'){
  if(await page.locator('#scspFilesPanel').isHidden())await page.locator('#scspFilesToggle').click();
  for(let i=0;i<12;i++){
    const closed=page.locator('#scspFilesTree details:not([open]) > summary');
    if(!await closed.count())break;await closed.first().click();
  }
  await page.locator(`#scspFilesTree button[data-file-path="${target}"]`).click();
  await page.waitForFunction(target=>document.getElementById('scspFilesSelected').textContent===target&&!document.getElementById('synthCodeRunButton').disabled,target);
  await page.locator('#synthInputCodeTab').click();
}
async function evaluateCode(page,source,{apply=false}={}){
  await page.locator('#synthCodeEditor').fill(source);
  await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();
  await page.waitForFunction(()=>!document.getElementById('synthCodeApplyButton').disabled);
  assert.equal(await page.locator('#synthCodeError').textContent(),'');
}

async function cycleGraph(page){
  await until(()=>page.locator('#scspCycle2Controls').isVisible(),'Cycle controls visible');
  await until(async()=>await page.locator('#connectionPaths path[data-cycle-edge]').count()===2,'Cycle paths rendered');
  const paths=await page.locator('#connectionPaths path[data-cycle-edge]').evaluateAll(paths=>paths.map(path=>({edge:path.dataset.cycleEdge,d:path.getAttribute('d'),title:path.querySelector('title')?.textContent??''})));
  assert.equal(paths.length,2);assert.deepEqual(paths.map(value=>value.edge).sort(),['forward','return']);
  assert(paths.every(value=>value.title.trim()),'Both directions have accessible descriptions');
  assert.notEqual(paths[0].d,paths[1].d,'The forward and return paths remain visually distinct');
  assert.match(await page.locator('#routingSummary').textContent(),/A.*B/);
  assert.match(await page.locator('#routingSummary').textContent(),/histor/i);
  return paths;
}
function pair(state,kind='keyboard'){
  const group=state.voiceGroups.find(value=>value.held&&value.owner?.kind===kind);
  assert(group,'A held '+kind+' group exists');assert.equal(group.slots.length,2);
  assert.deepEqual(group.operatorSlots,group.slots);const [a,b]=group.slots;assert.equal(b,a+1);
  assert.equal(state.slots[a].modulation.xOffset,33);assert.equal(state.slots[a].modulation.yOffset,1);
  assert.equal(state.slots[b].modulation.xOffset,63);assert.equal(state.slots[b].modulation.yOffset,63);
  return group;
}
const holdSource=`const scsp=await useSoundChip('scsp');
setBpm(120);
await livePrepare('ui-held-note',()=>scsp.noteOn(CH1,'A3'));
liveLoop('ui-hold',async()=>{await beat(4096);});
`;

async function exercise(name,origin){
  const browser=await({chromium,webkit}[name]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:1050}}),page=await context.newPage();
  const errors=[],missing=[],external=[],cases=[],screenshots={};
  const imageBase=path.join(path.dirname(path.resolve(config.out)),path.basename(config.out,'.json')+'-'+name);
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  try{
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('[data-scsp-channel]').length===33);
    assert.equal((await graph(page)).contexts,0);
    const base=await saveInstrument(page);
    assert(await page.locator('#scspCycle2Option').evaluate(option=>option.disabled),'PCM cannot choose a two-operator Cycle');
    await page.locator('#voiceMode').selectOption('fm4');
    await page.waitForFunction(()=>document.getElementById('voiceMode').value==='fm4');
    await until(()=>page.locator('#scspCycle2Option').evaluate(option=>option.disabled),'Cycle option disabled in non-FM2 context');
    await page.locator('#voiceMode').selectOption('fm2');
    await until(()=>page.locator('#scspCycle2Option').evaluate(option=>!option.disabled),'Cycle enabled for FM2');
    await page.locator('#algorithm').selectOption('cycle2');
    await page.waitForFunction(()=>document.getElementById('algorithm').value==='cycle2'&&!document.getElementById('scspCycle2Controls').hidden);
    const paths=await cycleGraph(page);
    assert.equal((await graph(page)).contexts,0,'Changing the connection does not start audio');
    await selectOperator(page,0);assert.match(await page.locator('#scspCycle2Input').textContent(),/B.*history/i);
    assert.match(await page.locator('#scspOperatorDepthLabel').textContent(),/B.*A/);
    assert.equal(await page.locator('#scspCycle2Output').isChecked(),false);
    await selectOperator(page,1);assert.match(await page.locator('#scspCycle2Input').textContent(),/A.*current/i);
    assert.equal(await page.locator('#scspCycle2Output').isChecked(),true);
    cases.push('Cold FM2 offers Cycle 2OP while PCM/FM4 reject it; UI selection allocates no audio and shows distinct accessible forward/current and history-return routes');

    await page.locator('#start').click();
    await page.waitForFunction(()=>__scspCycleAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    await selectOperator(page,0);await voiceNumber(page,'totalLevel',28);await voiceNumber(page,'directLevel',5);
    await selectOperator(page,1);await voiceNumber(page,'totalLevel',28);await voiceNumber(page,'directLevel',5);
    await page.locator('#algorithm').selectOption('chain');
    await waitState(page,state=>state.config.fm.algorithm==='chain','chain before keyboard focus test');
    await page.locator('#algorithm').selectOption('cycle2');
    await waitState(page,state=>state.config.fm.algorithm==='cycle2','Cycle selected by UI');
    assert.equal(await page.locator('#algorithm').evaluate(node=>node===document.activeElement),false);
    await page.keyboard.down('a');
    let state=await waitState(page,state=>state.voiceGroups.some(value=>value.held&&value.owner.kind==='keyboard'),'Cycle keyboard note after select');
    const first=pair(state),stableIdentity=identity(state),sampleIds=state.playingSampleIds.slice(first.slots[0],first.slots[1]+1);
    const audible=await until(async()=>{const value=await level(page);return value.peak>1e-5?value:false;},'finite Cycle keyboard output');
    await selectOperator(page,0);await number(page,'operatorRatio',.5);await number(page,'operatorDepth',3);
    state=await waitState(page,state=>state.config.fm.ratios[0]===.5&&(state.config.fm.depths??[])[0]===3,'A ratio and return Depth');
    assert.deepEqual(identity(state),stableIdentity);
    await selectOperator(page,1);await number(page,'operatorRatio',1.5);await number(page,'operatorDepth',5);
    state=await waitState(page,state=>state.config.fm.ratios[1]===1.5&&(state.config.fm.depths??[])[1]===5,'B ratio and forward Depth');
    assert.deepEqual(identity(state),stableIdentity);
    assert.match(await page.locator('#scspCycle2Hint').textContent(),/3(?:\.0+)?(?:\D|$)/,'Requested B/A reflects editable A ratio');
    await number(page,'fmDepth',0);state=await waitState(page,state=>state.config.fm.depth===0&&!state.config.fm.depths,'batch Depth Off');
    assert.deepEqual(identity(state),stableIdentity);
    await number(page,'fmDepth',8);state=await waitState(page,state=>state.config.fm.depth===8,'batch Depth On');
    assert.deepEqual(identity(state),stableIdentity);assert.deepEqual(state.playingSampleIds.slice(first.slots[0],first.slots[1]+1),sampleIds);
    pair(state);await page.keyboard.up('a');
    cases.push('Keyboard input works immediately after Connection selection; A/B ratio and directional Depth plus batch Off/On retain the held pair and PCM without resetting A ratio');

    await selectOperator(page,0);await page.locator('#scspCycle2Output').check();
    state=await waitState(page,state=>same(state.config.fm.cycle2.outputs,[0,1]),'A plus B outputs');
    assert.equal(await page.locator('#scspCycle2Output').evaluate(node=>node===document.activeElement),false);
    await selectOperator(page,1);await page.locator('#scspCycle2Output').uncheck();
    await waitState(page,state=>same(state.config.fm.cycle2.outputs,[0]),'A-only output');
    await selectOperator(page,0);await page.locator('#scspCycle2Output').uncheck();
    await waitState(page,state=>same(state.config.fm.cycle2.outputs,[]),'direct outputs Off');
    await selectOperator(page,1);await page.locator('#scspCycle2Output').check();
    await waitState(page,state=>same(state.config.fm.cycle2.outputs,[1]),'B output restored');
    await selectOperator(page,2);assert(await page.locator('#scspCycle2Output').isDisabled(),'Unused C cannot edit the two-operator output list');
    await selectOperator(page,1);
    const saved=await saveInstrument(page);assert.equal(saved.version,11);assert.deepEqual(saved.fm.cycle2,{outputs:[1]});
    assert.equal(saved.fm.ratios[0],.5);assert.equal(saved.fm.ratios[1],1.5);
    cases.push('Selected A/B output checkboxes support both/A/B/none, blur after editing and exclude unused operators; actual v11 JSON saves the authored ratios and outputs');

    await page.locator('#algorithm').selectOption('custom');
    await waitState(page,state=>state.config.fm.algorithm==='custom','Custom from Cycle');
    assert.equal(await page.locator('#scspCustomFmInput').isVisible(),true);
    await selectOperator(page,1);await page.locator('#scspCustomFmInput').selectOption('1');
    state=await waitState(page,state=>state.config.fm.custom.inputs[1][0]===1,'Custom B Self');
    const dormant=structuredClone(state.config.fm.custom);
    assert(await page.locator('#connectionPaths path[data-self-feedback="true"]').count()>0);
    await page.locator('#algorithm').selectOption('cycle2');
    await waitState(page,state=>state.config.fm.algorithm==='cycle2','Cycle after dormant Self graph');
    for(const mode of ['fm4','fm6','pcm']){
      await page.locator('#voiceMode').selectOption(mode);
      state=await waitState(page,state=>state.config.mode===mode&&state.config.fm.algorithm==='chain','Cycle -> '+mode+' safe Chain transition');
      await until(()=>page.locator('#scspCycle2Option').evaluate(option=>option.disabled),'Cycle option disabled in non-FM2 context');
      assert.deepEqual(state.config.fm.custom,dormant);
      await page.locator('#voiceMode').selectOption('fm2');
      state=await waitState(page,state=>state.config.mode==='fm2'&&state.config.fm.algorithm==='chain','FM2 return does not silently reactivate Cycle');
      await page.locator('#algorithm').selectOption('custom');
      state=await waitState(page,state=>state.config.fm.algorithm==='custom','dormant Custom restored');
      assert.deepEqual(state.config.fm.custom,dormant);
      await page.locator('#algorithm').selectOption('cycle2');
      await waitState(page,state=>state.config.fm.algorithm==='cycle2','Cycle reentry');
    }
    cases.push('UI Cycle -> PCM/FM4/FM6 submits a valid Chain transition; returning to FM2 is explicit and dormant Custom/Self graphs survive each round trip');

    const example=await fs.readFile(path.join(config.root,'synth-scsp/examples/cycle2.js'),'utf8');
    await file(page,'/examples/cycle2.js');assert.equal(await page.locator('#synthCodeEditor').inputValue(),example);
    await page.locator('#synthCodeRunButton').click();
    await waitState(page,state=>state.codeActive&&state.config.fm.algorithm==='cycle2'&&state.voiceGroups.some(value=>value.held&&value.owner.kind==='code'),'actual bundled Cycle example');
    assert.equal(await page.locator('#synthCodeError').textContent(),'');
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'Cycle example stopped');
    await file(page);await evaluateCode(page,holdSource);
    state=await waitState(page,state=>state.codeActive&&state.voiceGroups.some(value=>value.held&&value.owner.kind==='code'),'held Code Cycle');
    const codeSession=state.codeSession,codePair=pair(state,'code'),codeIdentity=identity(state);
    await selectOperator(page,0);await number(page,'operatorDepth',4);
    state=await waitState(page,state=>(state.config.fm.depths??[])[0]===4,'UI return depth during Code');
    assert.deepEqual(identity(state),codeIdentity);
    await page.locator('#scspCycle2Output').check();
    state=await waitState(page,state=>state.codeActive&&state.codeSession===codeSession&&same(state.config.fm.cycle2.outputs,[0,1])&&!state.voiceGroups.some(value=>value.id===codePair.id),'output topology retires notes without stopping Code');
    await evaluateCode(page,holdSource.replace('ui-held-note','ui-after-output').replace("CH1,'A3'","CH2,'A3'"),{apply:true});
    state=await waitState(page,state=>state.voiceGroups.some(value=>value.held&&value.owner.kind==='code'),'Code note after UI output edit');
    assert.equal(state.codeSession,codeSession);
    await page.locator('#voiceMode').selectOption('fm4');
    state=await waitState(page,state=>state.config.mode==='fm4'&&state.config.fm.algorithm==='chain'&&state.codeActive,'mode change keeps Code');
    assert.equal(state.codeSession,codeSession);
    await page.locator('#voiceMode').selectOption('fm2');await waitState(page,state=>state.config.mode==='fm2','Code FM2');
    await page.locator('#algorithm').selectOption('cycle2');await waitState(page,state=>state.config.fm.algorithm==='cycle2','Code UI Cycle');
    await evaluateCode(page,holdSource.replace('ui-held-note','ui-after-mode').replace("CH1,'A3'","CH3,'A3'"),{apply:true});
    state=await waitState(page,state=>state.voiceGroups.some(value=>value.held&&value.owner.kind==='code'),'Code note after UI mode change');
    assert.equal(state.codeSession,codeSession);pair(state,'code');
    cases.push('The actual bundled Synth Cycle example runs; UI Depth stays live and output/mode changes retire grouped notes while Code keeps its session and can sound the next note');

    await selectChannel(page,31);assert(await page.locator('#scspCycle2Output').isDisabled());
    await page.keyboard.down('s');state=await waitState(page,state=>state.manualVoices.some(value=>value.slot===31&&value.held),'independent physical CH');
    const manual=state.manualVoices.find(value=>value.slot===31&&value.held);
    const program=await request(page,{method:'readDspProgram',args:[]});
    await page.locator('#synthCodeStopButton').click();state=await waitState(page,state=>!state.codeActive,'Code stopped with physical owner');
    assert(state.manualVoices.some(value=>value.id===manual.id&&value.held));assert.deepEqual(await request(page,{method:'readDspProgram',args:[]}),program);
    await page.keyboard.up('s');await selectChannel(page,null);assert(await page.locator('#scspCycle2Output').isEnabled());
    const authored=await portable(page);
    const {createScspSsfCaptureFixture}=await import(pathToFileURL(path.join(repository,'test/helpers/scsp_ssf_fixture.mjs')).href);
    const fixture=createScspSsfCaptureFixture();
    await page.locator('#ssfFileInput').setInputFiles({name:'cycle-ui-reference.ssf',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
    await page.locator('#scspSongPlay').click();
    await page.waitForFunction(()=>document.getElementById('scspSsfLive').dataset.active==='true');
    assert(await page.locator('#scspCycle2Output').isDisabled());await until(()=>page.locator('#scspCycle2Option').evaluate(option=>option.disabled),'Cycle option disabled in non-FM2 context');
    assert(await page.locator('#operatorDepth').isDisabled());assert.deepEqual(await portable(page),authored);
    await page.locator('#scspSongPause').click();await page.waitForFunction(()=>document.getElementById('scspSongPause').textContent==='Resume');
    assert(await page.locator('#scspCycle2Output').isDisabled());assert.deepEqual(await portable(page),authored);
    await page.locator('#scspSongStop').click();await selectChannel(page,null);assert(await page.locator('#scspCycle2Output').isEnabled());
    cases.push('Physical CH and SSF play/pause contexts cannot use hidden Auto Cycle controls; Code Stop preserves an independent physical owner and DSP while SSF leaves the authored Cycle unchanged');

    const expected=await saveInstrument(page),named=await saveFileSound(page,'UI Cycle preset');
    await page.locator('#scspPresetSelect').selectOption(await presetOption(page,named));
    await samePortable(page,expected,'saved Cycle preset toolbar');await cycleGraph(page);
    const archive=await exportProject(page),{loadPlaygroundCassette}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')).href);
    const cassette=await loadPlaygroundCassette(new Uint8Array(archive));
    const manifest=JSON.parse(new TextDecoder().decode(cassette.files.get('scsp-synth.project.json')));
    assert.equal(manifest.settings.version,11);assert.deepEqual(withoutName(manifest.settings),withoutName(expected));
    assert.equal(new TextDecoder().decode(cassette.files.get('examples/cycle2.js')),example);
    screenshots.desktop=imageBase+'-desktop.png';await page.locator('.operator-panel').screenshot({path:screenshots.desktop});
    await page.reload();
    await page.waitForFunction(()=>!document.querySelector('.scsp-main').inert&&!document.getElementById('start').disabled&&document.getElementById('algorithm').value==='cycle2');
    assert.equal((await graph(page)).contexts,0);await cycleGraph(page);assert(await page.locator('#scspCycle2Option').evaluate(option=>!option.disabled));
    await page.locator('#start').click();await page.waitForFunction(()=>__scspCycleAudit.nodes.length>0&&!document.getElementById('start').disabled);
    state=await inspect(page);assert.equal(state.codeActive,false);assert.equal(state.voiceGroups.length,0);
    assert.deepEqual(withoutName(await portable(page)),withoutName(expected));
    await loadInstrument(page,base,'normal-before-cycle-cassette.json');await samePortable(page,base,'normal sound before project import');
    await page.locator('#scspProjectFileInput').setInputFiles({name:'cycle-ui.cassette.zip',mimeType:'application/zip',buffer:archive});
    await page.waitForFunction(()=>/project imported/i.test(document.getElementById('scspFilesStatus').textContent));
    await samePortable(page,expected,'Cycle Cassette restored');await cycleGraph(page);
    assert.equal((await inspect(page)).codeActive,false);
    cases.push('Actual v11/Files preset selection, Cassette and local draft restore the selectable Cycle UI, distinct routes and bundled example without autoplay or replacing the edited sound');

    await selectOperator(page,0);await page.setViewportSize({width:390,height:844});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'Mobile overflow '+overflow);
    assert(await page.locator('#scspCycle2Controls').isVisible());await cycleGraph(page);
    screenshots.mobile=imageBase+'-mobile.png';await page.locator('.operator-panel').screenshot({path:screenshots.mobile});
    await page.locator('#stop').click();const stopped=await until(async()=>{const value=await level(page);return value.peak===0?value:false;},'global Stop silence');
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    cases.push('Narrow layout keeps both Cycle directions and controls visible without horizontal overflow; Stop is silent and every output stays permanently muted at 48 kHz');
    return{browser:name,rate:48000,passed:true,cases,paths,first,audible,stopped,graph:audited,mobileOverflow:overflow,screenshots,errors,missing,externalRequestsBlocked:external.length};
  }catch(error){console.error(JSON.stringify({name,errors,missing,option:await page.locator('#scspCycle2Option').evaluate(n=>({disabled:n.disabled,attr:n.getAttribute('disabled'),mode:document.getElementById('voiceMode').value,parent:n.parentElement.disabled})),status:await page.locator('#status').textContent(),codeError:await page.locator('#synthCodeError').textContent(),body:(await page.locator('body').innerText()).slice(0,7000)},null,2));throw error;}
  finally{await context.close();await browser.close();}
}

(async()=>{
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    const results=[];for(const name of engines)results.push(await exercise(name,origin));
    for(const [name,record]of served)assert.equal(sha(await fs.readFile(path.join(config.root,name))),record.sha256,'Source changed '+name);
    const report={passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,appSourceInjected:false,results,assets:Object.fromEntries(served)};
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP Cycle2 UI browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
