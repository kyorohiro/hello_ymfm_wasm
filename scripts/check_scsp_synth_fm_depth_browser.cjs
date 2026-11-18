// SPDX-License-Identifier: BSD-3-Clause
// Verify the per-operator FM depth controls with permanently muted physical output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-fm-depth-browser.json'),
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
  const audit=window.__scspDepthAudit={contexts:[],nodes:[],meters:[],commands:[],sequence:0};
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
    const id='depth-fm-audit-'+ ++audit.sequence;
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
const inspect=page=>page.evaluate(()=>__scspDepthAudit.inspect());
const graph=page=>page.evaluate(()=>__scspDepthAudit.graph());
const mutations=page=>page.evaluate(()=>__scspDepthAudit.mutations());
const level=page=>page.evaluate(()=>__scspDepthAudit.level());
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
const request=(page,command)=>page.evaluate(command=>__scspDepthAudit.request(command),command);
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
function verifyMapping(state,inputs,outputs){
  const group=state.voiceGroups.find(value=>value.held);assert(group,'A held group exists');
  assert.equal(group.operatorSlots.length,inputs.length);assert.equal(new Set(group.operatorSlots).size,inputs.length);
  for(let target=0;target<inputs.length;target++){
    const slot=group.operatorSlots[target],voice=state.slots[slot],sources=inputs[target];
    assert.equal(voice.directLevel,outputs.includes(target)?state.slots[target].directLevel:0,'Direct output follows authored operator '+target);
    assert.equal(voice.modulation.depth,sources.length?(state.config.fm.depths?.[target]??state.config.fm.depth):0);
    const offsets=sources.map(source=>{assert(group.operatorSlots[source]<slot,'Source precedes target in native sound stack');return(group.operatorSlots[source]-slot+64)%64;});
    assert.equal(voice.modulation.xOffset,offsets[0]??0);
    assert.equal(voice.modulation.yOffset,offsets[1]??offsets[0]??0,'One source is duplicated; two sources use both hardware average inputs');
  }
  return group.operatorSlots;
}
async function rejectConfig(page,patch){
  const before=await inspect(page);
  const rejected=await page.evaluate(async patch=>{try{await __scspDepthAudit.request({method:'setConfig',args:[patch]});return null;}catch(error){return error.message;}},patch);
  assert(rejected,'Invalid request is rejected');
  const after=await inspect(page);assert.deepEqual(after.config,before.config);
  assert.deepEqual(after.voiceGroups.map(({id,slots,held})=>({id,slots,held})),before.voiceGroups.map(({id,slots,held})=>({id,slots,held})));
  return rejected;
}
const effectiveDepths=state=>state.config.fm.depths??Array(6).fill(state.config.fm.depth);
const ownerIdentity=state=>({codeActive:state.codeActive,codeSession:state.codeSession,
  groups:state.voiceGroups.map(({id,slots,operatorSlots,held})=>({id,slots,operatorSlots,held})),
  manual:state.manualVoices.map(({id,slot,held})=>({id,slot,held}))});
async function depth(page,operator,value){
  await selectOperator(page,operator);await number(page,'operatorDepth',value);
  return waitState(page,state=>effectiveDepths(state)[operator]===value,'operator '+operator+' depth '+value);
}
async function changedWithoutRestart(page,change){
  const before=await inspect(page),dsp=await request(page,{method:'readDspSetup',args:[]});
  const start=await page.evaluate(()=>__scspDepthAudit.commands.length);
  await change();
  const after=await inspect(page);
  assert.deepEqual(ownerIdentity(after),ownerIdentity(before),'Depth retains Code and physical / grouped owners');
  assert.deepEqual(await request(page,{method:'readDspSetup',args:[]}),dsp,'Depth does not replace DSP program, coefficients or routing');
  const methods=await page.evaluate(start=>__scspDepthAudit.commands.slice(start).map(value=>value.method),start);
  assert(!methods.some(method=>['stopVoices','stopPhysicalVoices','endCode','loadPatch','applyDspProgram','keyOff','noteOff','physicalNoteOff'].includes(method)),'Depth must not send note-off, reset or DSP replacement');
  return after;
}
async function runHeldCode(page){
  if(await page.locator('#scspFilesPanel').isHidden())await page.locator('#scspFilesToggle').click();
  await page.locator('#scspFilesTree button[data-file-path="/index.js"]').click();
  await page.waitForFunction(()=>document.getElementById('scspFilesSelected').textContent==='/index.js'&&!document.getElementById('synthCodeRunButton').disabled);
  await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').fill(`const scsp=await useSoundChip('scsp');setBpm(120);liveLoop('depth-hold',async()=>{await scsp.noteOn(CH1,'A3');await beat(4096);});`);
  await page.locator('#synthCodeRunButton').click();
  assert.match(await page.locator('#synthCodeEditor').inputValue(),/depth-hold/);
  return waitState(page,state=>state.codeActive&&state.voiceGroups.some(value=>value.held&&value.owner?.kind==='code'),'held Code group');
}
async function exercise(name,origin){
  const browser=await({chromium,webkit}[name]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
  const errors=[],missing=[],external=[],cases=[],screenshots={};
  const imageBase=path.join(path.dirname(path.resolve(config.out)),path.basename(config.out,'.json')+'-'+name);
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  try{
    await page.goto(origin+config.entry);await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('[data-scsp-channel]').length===33);
    const coldBefore=await graph(page),coldWrites=await mutations(page);
    assert(await page.locator('#operatorDepth').isDisabled(),'PCM keeps receiving-OP MDL dormant');
    await page.locator('#voiceMode').selectOption('fm4');await page.locator('#algorithm').selectOption('custom');await selectOperator(page,0);
    await number(page,'operatorDepth',3);await page.getByRole('button',{name:'Increase operatorDepth',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('operatorDepth').value==='4');
    await page.getByRole('button',{name:'Decrease operatorDepth',exact:true}).click();await page.waitForFunction(()=>document.getElementById('operatorDepth').value==='3');
    const box=await page.locator('#operatorDepth').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+18,box.y+box.height/2);await page.mouse.up();
    await page.waitForFunction(()=>document.getElementById('operatorDepth').value==='6');
    assert(await page.locator('#scspFmDepthSummary').isVisible());assert.equal((await graph(page)).contexts,0);assert.equal(await mutations(page),coldWrites);assert.deepEqual(await graph(page),coldBefore);
    cases.push('Cold selected MDL uses existing increment/decrement/drag controls, shows mixed values and never starts audio');
    await page.locator('#start').click();await page.waitForFunction(()=>__scspDepthAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    await waitState(page,state=>same(effectiveDepths(state),[6,9,9,9,9,9]),'cold MDL migration');
    const graph4={inputs:[[1,2],[3],[3],[]],outputs:[0]};await editGraph(page,graph4.inputs,graph4.outputs);
    await page.keyboard.down('a');let state=await waitState(page,state=>state.voiceGroups.some(value=>value.held),'keyboard four OP');
    const fourOperatorSlots=verifyMapping(state,graph4.inputs,graph4.outputs);
    state=await changedWithoutRestart(page,()=>depth(page,0,3));verifyMapping(state,graph4.inputs,graph4.outputs);
    await selectOperator(page,1);state=await changedWithoutRestart(page,async()=>{await page.getByRole('button',{name:'Increase operatorDepth',exact:true}).click();await waitState(page,state=>effectiveDepths(state)[1]===10,'B MDL increment');});
    verifyMapping(state,graph4.inputs,graph4.outputs);state=await changedWithoutRestart(page,()=>depth(page,3,12));
    assert.equal(state.slots[fourOperatorSlots[3]].modulation.depth,0,'An unconnected D stores its MDL but does not modulate');
    await selectOperator(page,4);assert(await page.locator('#operatorDepth').isDisabled(),'Inactive E cannot edit active four OP depth');
    const audible=await until(async()=>{const value=await level(page);return value.peak>.00005?value:false;},'finite real FM output');
    await page.keyboard.up('a');await selectOperator(page,0);
    screenshots.four=imageBase+'-four.png';await page.locator('.operator-panel').screenshot({path:screenshots.four});
    const saved4=await saveInstrument(page);assert.equal(saved4.version,7);assert.equal(saved4.mode,'fm4');assert.deepEqual(saved4.fm.depths,[3,10,9,12,9,9]);assert.deepEqual(saved4.fm.custom,graph4);
    cases.push('4OP selected receiver MDL follows its physical slot and both X/Y inputs without note-off, DSP replacement or owner loss; unconnected/inactive operators are explicit');
    await page.locator('#voiceMode').selectOption('fm6');await waitState(page,state=>state.config.mode==='fm6','six OP mode');
    assert.deepEqual(effectiveDepths(await inspect(page)),[3,10,9,12,9,9]);
    const graph6={inputs:[[],[0],[0],[1,2],[2],[3,4]],outputs:[5]};await editGraph(page,graph6.inputs,graph6.outputs);
    const code=await runHeldCode(page);const sixOperatorSlots=verifyMapping(code,graph6.inputs,graph6.outputs);
    await selectChannel(page,31);await page.keyboard.down('a');await waitState(page,state=>state.manualVoices.some(value=>value.slot===31&&value.held),'physical owner alongside Code');
    await selectChannel(page,null);state=await changedWithoutRestart(page,()=>depth(page,5,5));verifyMapping(state,graph6.inputs,graph6.outputs);
    assert.equal(state.codeSession,code.codeSession);await page.keyboard.up('a');await waitState(page,state=>state.manualVoices.every(value=>value.slot!==31||!value.held),'physical key release after MDL edit');
    const invalid=[];
    for(const depths of [[1,2],[1,2,3,4,5,13],[1,2,3,4,5,-1],[1,2,3,4,5,1.5],[1,2,3,4,5,null]])invalid.push(await rejectConfig(page,{fm:{depths}}));
    screenshots.six=imageBase+'-six.png';await page.locator('.operator-panel').screenshot({path:screenshots.six});
    const saved6=await saveInstrument(page);assert.equal(saved6.version,7);assert.equal(saved6.mode,'fm6');assert.deepEqual(saved6.fm.depths,[3,10,9,12,9,5]);assert.deepEqual(saved6.fm.custom,graph6);
    cases.push('6OP reverse-ID receiver mapping retains running Code and independent manual keys; invalid count/range/fraction/null arrays reject atomically');
    // The held Code group retains graph6 even when a different authored graph is loaded.
    await loadInstrument(page,saved4,'four-v7-running-code.json');await customGraph(page,graph4.inputs,graph4.outputs);
    const retained=await inspect(page),retainedGroup=retained.voiceGroups.find(value=>value.held&&value.owner?.kind==='code');assert.equal(retainedGroup.id,code.voiceGroups.find(value=>value.held).id);assert.deepEqual(retainedGroup.operatorSlots,sixOperatorSlots);
    state=await changedWithoutRestart(page,()=>depth(page,2,2));
    assert.equal(state.slots[sixOperatorSlots[2]].modulation.depth,2,'Old group maps authored C through its retained six OP graph');
    assert.equal(state.slots[sixOperatorSlots[5]].modulation.depth,9,'Old F remains a receiver despite inactive authored four OP mode');
    assert.equal(state.slots[sixOperatorSlots[0]].modulation.depth,0,'Old A remains a source although new graph A is a receiver');
    cases.push('A preset loaded during Code keeps the old group route/slot mapping; later MDL edits update that retained group without relabeling its sources');
    state=await changedWithoutRestart(page,async()=>{await number(page,'fmDepth',7);await waitState(page,state=>state.config.fm.depth===7&&!state.config.fm.depths,'common MDL resets individual values');});
    assert.deepEqual(effectiveDepths(state),Array(6).fill(7));assert.equal(state.slots[sixOperatorSlots[5]].modulation.depth,7);assert(await page.locator('#scspFmDepthSummary').isHidden());
    const scalar6=await saveInstrument(page);assert.equal(scalar6.version,6);assert.equal(scalar6.fm.depths,undefined);
    const explicit=[1,2,3,4,5,6];await request(page,{method:'setConfig',args:[{fm:{depth:8,depths:explicit}}]});
    assert.deepEqual(effectiveDepths(await inspect(page)),explicit);assert.equal((await inspect(page)).config.fm.depth,8);
    await request(page,{method:'setConfig',args:[{fm:{depths:[4,4,4,4,4,4]}}]});assert.equal((await inspect(page)).config.fm.depth,4);assert.equal((await inspect(page)).config.fm.depths,undefined);
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'Code stopped');await page.locator('#stop').click();
    cases.push('Common MDL batch edits restore the scalar format, explicit arrays override a simultaneous scalar, and uniform arrays normalize without restarting held Code');
    await loadInstrument(page,saved6,'six-v7-roundtrip.json');await customGraph(page,graph6.inputs,graph6.outputs);assert.deepEqual(effectiveDepths(await inspect(page)),saved6.fm.depths);
    await page.locator('#voiceMode').selectOption('fm2');await waitState(page,state=>state.config.mode==='fm2','depths in two OP mode');assert.deepEqual(effectiveDepths(await inspect(page)),saved6.fm.depths);
    await page.locator('#voiceMode').selectOption('pcm');await waitState(page,state=>state.config.mode==='pcm','depths in PCM mode');assert.deepEqual(effectiveDepths(await inspect(page)),saved6.fm.depths);assert(await page.locator('#operatorDepth').isDisabled());
    const pcm7=await saveInstrument(page);assert.equal(pcm7.version,7);assert.equal(pcm7.mode,'pcm');assert.deepEqual(pcm7.fm.depths,saved6.fm.depths);
    await page.locator('#voiceMode').selectOption('fm6');await waitState(page,state=>state.config.mode==='fm6','restored FM mode');assert.deepEqual(effectiveDepths(await inspect(page)),saved6.fm.depths);
    const fixed7=await saveInstrument(page);assert.equal(fixed7.version,7);assert.equal(fixed7.fm.algorithm,'chain');
    await loadInstrument(page,fixed7,'fixed-v7.json');await waitState(page,state=>state.config.mode==='fm6'&&state.config.fm.algorithm==='chain'&&same(effectiveDepths(state),saved6.fm.depths),'fixed v7 roundtrip');
    await number(page,'fmDepth',8);await waitState(page,state=>state.config.fm.depth===8&&!state.config.fm.depths,'scalar for migration');
    await page.locator('#algorithm').selectOption('chain');const fixed4=await saveInstrument(page);assert.equal(fixed4.version,4);
    await loadInstrument(page,fixed4,'legacy-v4.json');await waitState(page,state=>state.config.fm.algorithm==='chain'&&!state.config.fm.depths,'legacy v4');
    await page.locator('#voiceMode').selectOption('fm2');await page.locator('#algorithm').selectOption('custom');const custom5=await saveInstrument(page);assert.equal(custom5.version,5);assert.equal(custom5.fm.depths,undefined);
    await loadInstrument(page,custom5,'legacy-v5.json');await waitState(page,state=>state.config.mode==='fm2'&&!state.config.fm.depths,'legacy v5');
    await loadInstrument(page,scalar6,'legacy-v6.json');await waitState(page,state=>state.config.mode==='fm4'&&!state.config.fm.depths,'legacy v6');
    const invalid7={...saved4};delete invalid7.fm;invalid7.fm={...saved4.fm};delete invalid7.fm.depths;
    for(const [preset,label] of [[invalid7,'v7 missing depth'],[{...fixed4,fm:{...fixed4.fm,depths:explicit}},'legacy depth array']]){
      const before=await request(page,{method:'exportPatch',args:[]});
      const message=await page.evaluate(async preset=>{try{await __scspDepthAudit.request({method:'loadPatch',args:[preset]});return null;}catch(error){return error.message;}},preset);
      assert(message,label);assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),before,label+' keeps previous sound');
    }
    cases.push('V7 Custom/fixed/PCM presets retain six authored depths across mode changes; v4/v5/v6 scalar files still round-trip and incompatible replacements preserve sound');
    await loadInstrument(page,saved6,'six-v7-project.json');await customGraph(page,graph6.inputs,graph6.outputs);
    const authoredBefore=await request(page,{method:'exportPatch',args:[]});
    const {createScspSsfCaptureFixture}=await import(pathToFileURL(path.join(repository,'test/helpers/scsp_ssf_fixture.mjs')).href),fixture=createScspSsfCaptureFixture();
    await page.locator('#ssfFileInput').setInputFiles({name:'depth-scope.ssf',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
    await page.locator('#scspSongPlay').click();await page.waitForFunction(()=>document.getElementById('scspSsfLive').dataset.active==='true');
    await selectChannel(page,0);assert(await page.locator('#operatorDepth').isDisabled());assert(await page.locator('#fmDepth').isHidden()||await page.locator('#fmDepth').isDisabled());
    assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),authoredBefore,'SSF scope never overwrites authored per-OP MDL');
    await page.locator('#scspSongPause').click();await page.waitForFunction(()=>document.getElementById('scspSongPause').textContent==='Resume');assert(await page.locator('#operatorDepth').isDisabled());
    await page.locator('#scspSongStop').click();await selectChannel(page,null);await until(async()=>await page.locator('#operatorDepth').isEnabled(),'return to authored depth');
    cases.push('SSF play and pause keep Auto per-OP depth controls disabled and preserve the complete authored sound');
    const archive=await exportProject(page),{loadPlaygroundCassette}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')).href);
    const cassette=await loadPlaygroundCassette(new Uint8Array(archive));const settings=JSON.parse(new TextDecoder().decode(cassette.files.get('scsp-synth.project.json'))).settings;
    assert.equal(settings.version,7);assert.deepEqual(settings.fm.depths,saved6.fm.depths);
    await loadInstrument(page,fixed4,'fixed-before-project.json');await waitState(page,state=>!state.config.fm.depths,'replace before Cassette');
    await page.locator('#scspProjectFileInput').setInputFiles({name:'depth.cassette.zip',mimeType:'application/zip',buffer:archive});
    await until(async()=>/project imported/.test(await page.locator('#scspFilesStatus').textContent()),'v7 Cassette imported');await waitState(page,state=>same(effectiveDepths(state),saved6.fm.depths),'v7 Cassette depth');
    await page.reload();await page.waitForFunction(()=>!document.querySelector('.scsp-main').inert&&!document.getElementById('start').disabled);await page.waitForFunction(()=>document.getElementById('voiceMode').value==='fm6');
    assert.equal((await graph(page)).contexts,0);await selectOperator(page,5);await page.waitForFunction(()=>document.getElementById('operatorDepth').value==='5');
    await page.locator('#start').click();await page.waitForFunction(()=>__scspDepthAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    assert.deepEqual(effectiveDepths(await inspect(page)),saved6.fm.depths);assert.equal((await inspect(page)).codeActive,false);
    await page.locator('#stop').click();const stopped=await until(async()=>{const value=await level(page);return value.peak===0?value:false;},'zero output after stop');
    cases.push('V7 per-OP depths and graph survive Cassette and local draft restoration without starting audio or Code');
    await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'Mobile overflow '+overflow);
    screenshots.mobile=imageBase+'-mobile.png';await page.locator('.operator-panel').screenshot({path:screenshots.mobile});
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    return{browser:name,rate:48000,passed:true,cases,coldBefore,fourOperatorSlots,sixOperatorSlots,audible,stopped,invalid,graph:audited,mobileOverflow:overflow,screenshots,errors,missing,externalRequestsBlocked:external.length};
  }catch(error){console.error(JSON.stringify({name,errors,missing,status:await page.locator('#status').textContent(),custom:await currentGraph(page).catch(()=>null),code:await page.locator('#synthCodeEditor').inputValue().catch(()=>null),commands:await page.evaluate(()=>__scspDepthAudit.commands.filter(command=>command.method&&command.method!=='readAuthoring').slice(-30)),body:(await page.locator('body').innerText()).slice(0,5500)},null,2));throw error;}
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
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP per-operator FM depth browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

