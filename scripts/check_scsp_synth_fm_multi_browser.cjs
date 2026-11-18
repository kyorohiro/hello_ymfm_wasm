// SPDX-License-Identifier: BSD-3-Clause
// Verify the multi-operator custom FM editor with permanently muted physical output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-fm-multi-browser.json'),
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
  const audit=window.__scspMultiAudit={contexts:[],nodes:[],meters:[],commands:[],sequence:0};
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
    const id='multi-fm-audit-'+ ++audit.sequence;
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
const inspect=page=>page.evaluate(()=>__scspMultiAudit.inspect());
const graph=page=>page.evaluate(()=>__scspMultiAudit.graph());
const mutations=page=>page.evaluate(()=>__scspMultiAudit.mutations());
const level=page=>page.evaluate(()=>__scspMultiAudit.level());
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
const request=(page,command)=>page.evaluate(command=>__scspMultiAudit.request(command),command);
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
    assert.equal(voice.modulation.depth,sources.length?state.config.fm.depth:0);
    const offsets=sources.map(source=>{assert(group.operatorSlots[source]<slot,'Source precedes target in native sound stack');return(group.operatorSlots[source]-slot+64)%64;});
    assert.equal(voice.modulation.xOffset,offsets[0]??0);
    assert.equal(voice.modulation.yOffset,offsets[1]??offsets[0]??0,'One source is duplicated; two sources use both hardware average inputs');
  }
  return group.operatorSlots;
}
async function rejectConfig(page,patch){
  const before=await inspect(page);
  const rejected=await page.evaluate(async patch=>{try{await __scspMultiAudit.request({method:'setConfig',args:[patch]});return null;}catch(error){return error.message;}},patch);
  assert(rejected,'Invalid request is rejected');
  const after=await inspect(page);assert.deepEqual(after.config,before.config);
  assert.deepEqual(after.voiceGroups.map(({id,slots,held})=>({id,slots,held})),before.voiceGroups.map(({id,slots,held})=>({id,slots,held})));
  return rejected;
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
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('[data-scsp-channel]').length===33);
    const coldBefore=await graph(page),coldWrites=await mutations(page);
    await page.locator('#voiceMode').selectOption('fm4');await page.locator('#algorithm').selectOption('branch');
    await page.locator('#algorithm').selectOption('custom');await selectOperator(page,0);
    await page.waitForFunction(()=>document.getElementById('scspCustomFmInput').value==='1'&&document.getElementById('scspCustomFmInputY').value==='2');
    assert.equal((await graph(page)).contexts,0);assert.equal(await mutations(page),coldWrites);assert.deepEqual(await graph(page),coldBefore);
    cases.push('Cold 4OP Custom seeds the existing Branch template without audio or transport writes');
    await page.locator('#start').click();await page.waitForFunction(()=>__scspMultiAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    await customGraph(page,[[1,2],[3],[],[]],[0]);
    const graph4={inputs:[[1,2],[3],[3],[]],outputs:[0,2]};await editGraph(page,graph4.inputs,graph4.outputs);await selectOperator(page,0);
    assert.equal(await page.locator('#scspCustomFmInput option[value="0"]').evaluate(option=>option.disabled),true);
    assert.equal(await page.locator('#scspCustomFmInputY option[value="1"]').evaluate(option=>option.disabled),true);
    assert.equal(await page.locator('#scspCustomFmInput option[value="4"]').evaluate(option=>option.disabled),true);
    await page.keyboard.down('a');const four=await waitState(page,state=>state.voiceGroups.some(value=>value.held),'four OP keyboard');
    const fourOperatorSlots=verifyMapping(four,graph4.inputs,graph4.outputs);
    const audible=await until(async()=>{const value=await level(page);return value.peak>.00005?value:false;},'finite native four OP output');
    await selectOperator(page,2);await number(page,'operatorRatio',3);
    const retuned=await waitState(page,state=>state.config.fm.ratios[2]===3,'mapped C ratio');assert(retuned.slots[fourOperatorSlots[2]].gate);
    assert(retuned.slots[fourOperatorSlots[2]].frequencyHz>retuned.slots[fourOperatorSlots[0]].frequencyHz*2.9);
    await selectOperator(page,3);await page.locator('#scspCustomFmInput').selectOption('0');
    await page.waitForFunction(()=>document.getElementById('status').dataset.error==='true');
    await page.waitForFunction(()=>document.getElementById('scspCustomFmInput').value==='');
    const cycleKept=await inspect(page);assert.deepEqual(cycleKept.config,retuned.config);assert(cycleKept.voiceGroups.some(value=>value.id===four.voiceGroups.find(value=>value.held).id&&value.held));
    const rejections=[];
    rejections.push(await rejectConfig(page,{fm:{custom:{inputs:[[1,2,3],[],[],[]],outputs:[0]}}}));
    rejections.push(await rejectConfig(page,{mode:'fm6',fm:{custom:graph4}}));
    rejections.push(await rejectConfig(page,{fm:{custom:{inputs:[[4],[],[],[]],outputs:[0]}}}));
    await page.keyboard.up('a');
    cases.push('4OP merge and branch map both native average inputs, preserve direct outputs and live C ratio; cycles/count/range/third-input errors preserve notes');
    await selectOperator(page,0);screenshots.four=imageBase+'-four.png';await page.locator('.operator-panel').screenshot({path:screenshots.four});
    const saved4=await saveInstrument(page);assert.equal(saved4.version,6);assert.equal(saved4.mode,'fm4');assert.deepEqual(saved4.fm.custom,graph4);
    await page.locator('#voiceMode').selectOption('fm6');await customGraph(page,[...graph4.inputs,[],[]],graph4.outputs);
    const graph6={inputs:[[],[0],[0],[1,2],[2],[3,4]],outputs:[0,5]};await editGraph(page,graph6.inputs,graph6.outputs);
    await page.keyboard.down('s');const six=await waitState(page,state=>state.voiceGroups.some(value=>value.held),'six OP keyboard');const sixOperatorSlots=verifyMapping(six,graph6.inputs,graph6.outputs);
    assert(sixOperatorSlots[0]<sixOperatorSlots[5],'A to F reverse-ID routing uses dependency order');await page.keyboard.up('s');
    await selectOperator(page,5);screenshots.six=imageBase+'-six.png';await page.locator('.operator-panel').screenshot({path:screenshots.six});
    const saved6=await saveInstrument(page);assert.equal(saved6.version,6);assert.equal(saved6.mode,'fm6');assert.deepEqual(saved6.fm.custom,graph6);
    await page.locator('#voiceMode').selectOption('fm2');await customGraph(page,[[],[0]],[0]);
    assert(await page.locator('#scspCustomFmInputYLabel').isHidden());
    await page.locator('#voiceMode').selectOption('fm4');await customGraph(page,[[],[0],[],[]],[0]);
    await selectOperator(page,2);assert(await page.locator('#scspCustomFmInputY').isDisabled());
    await loadInstrument(page,saved4,'custom-four-v6.json');await customGraph(page,graph4.inputs,graph4.outputs);
    await loadInstrument(page,saved6,'custom-six-v6.json');await customGraph(page,graph6.inputs,graph6.outputs);
    cases.push('6OP reverse-ID graph and multiple outputs use native slots; v6 four/six presets round-trip; mode resizing keeps surviving routes and leaves new operators disconnected');
    // Shrink and author the legacy B to A form, retaining the exact v5 format.
    await page.locator('#voiceMode').selectOption('fm2');await customGraph(page,[[],[0]],[0]);await editGraph(page,[[1],[]],[0]);
    await page.keyboard.down('d');const two=await waitState(page,state=>state.voiceGroups.some(value=>value.held),'legacy two OP keyboard');const twoOperatorSlots=verifyMapping(two,[[1],[]],[0]);assert(twoOperatorSlots[1]<twoOperatorSlots[0]);await page.keyboard.up('d');
    const saved5=await saveInstrument(page);assert.equal(saved5.version,5);assert.deepEqual(saved5.fm.custom,{inputs:[[1],[]],outputs:[0]});
    await page.locator('#algorithm').selectOption('chain');await waitState(page,state=>state.config.fm.algorithm==='chain','fixed connection');
    const savedFixed=await saveInstrument(page);assert.equal(savedFixed.version,4);assert.equal(savedFixed.fm.custom,undefined);
    await loadInstrument(page,saved5,'custom-two-v5.json');await customGraph(page,[[1],[]],[0]);
    await loadInstrument(page,savedFixed,'fixed-v4.json');await waitState(page,state=>state.config.fm.algorithm==='chain','fixed v4 load');
    cases.push('Original 2OP B to A slot order and v5 preset shape are unchanged; fixed connections still save/load v4');
    await loadInstrument(page,saved6,'custom-six-code.json');await customGraph(page,graph6.inputs,graph6.outputs);
    await selectChannel(page,31);await page.keyboard.down('a');await waitState(page,state=>state.manualVoices.some(value=>value.slot===31&&value.held),'manual physical owner');
    await selectChannel(page,null);await selectOperator(page,4);await page.locator('#scspCustomFmOutput').check();
    const alongside=await waitState(page,state=>state.config.fm.custom.outputs.includes(4),'graph edit with physical owner');assert(alongside.manualVoices.some(value=>value.slot===31&&value.held));
    await page.keyboard.up('a');await waitState(page,state=>state.manualVoices.every(value=>value.slot!==31||!value.held),'physical key up after edit');
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').evaluate(input=>{
      input.value=`const scsp=await useSoundChip('scsp');setBpm(120);liveLoop('custom-multi',async()=>{await scsp.noteOn(CH1,'A3');await beat(.5);await scsp.noteOff(CH1);await beat(.25);});`;input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#synthCodeRunButton').click();const code=await waitState(page,state=>state.codeActive&&state.voiceGroups.some(value=>value.held),'Code uses six OP');
    await selectOperator(page,0);await page.locator('#scspCustomFmOutput').uncheck();const codeKept=await waitState(page,state=>state.codeActive&&!state.config.fm.custom.outputs.includes(0),'Code graph edit');assert.equal(codeKept.codeSession,code.codeSession);
    await waitState(page,state=>state.codeActive&&state.voiceGroups.some(value=>value.held&&value.operatorSlots?.length===6),'next six OP Code note');
    screenshots.code=imageBase+'-code.png';await page.locator('.operator-panel').screenshot({path:screenshots.code});
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'Code Stop');await page.locator('#stop').click();
    const stopped=await until(async()=>{const value=await level(page);return value.peak===0?value:false;},'muted stop');
    cases.push('Custom graph edits retain running Code and independent physical owners; physical key-up and Code Stop release their notes');
    const archive=await exportProject(page),{loadPlaygroundCassette}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')).href);
    const cassette=await loadPlaygroundCassette(new Uint8Array(archive));
    const settings=JSON.parse(new TextDecoder().decode(cassette.files.get('scsp-synth.project.json'))).settings;
    assert.equal(settings.version,6);assert.equal(settings.mode,'fm6');
    assert.deepEqual(settings.fm.custom,{inputs:graph6.inputs,outputs:[4,5]});
    await loadInstrument(page,saved5,'custom-two-before-project.json');await customGraph(page,[[1],[]],[0]);
    await page.locator('#scspProjectFileInput').setInputFiles({name:'multi-custom.cassette.zip',mimeType:'application/zip',buffer:archive});
    await until(async()=>/project imported/.test(await page.locator('#scspFilesStatus').textContent()),'v6 Cassette imported');
    await customGraph(page,graph6.inputs,[4,5]);assert.equal((await inspect(page)).codeActive,false);
    await page.reload();await page.waitForFunction(()=>!document.querySelector('.scsp-main').inert&&!document.getElementById('start').disabled);
    await page.waitForFunction(()=>document.getElementById('voiceMode').value==='fm6'&&document.getElementById('algorithm').value==='custom');
    assert.equal((await graph(page)).contexts,0,'Local draft restoration never starts audio or Code');
    await page.locator('#start').click();await page.waitForFunction(()=>__scspMultiAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    await customGraph(page,graph6.inputs,[4,5]);assert.equal((await inspect(page)).codeActive,false);
    cases.push('Version-6 Custom graph survives Cassette and local draft restoration without starting audio or Code');
    await page.setViewportSize({width:390,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'Mobile overflow '+overflow);
    screenshots.mobile=imageBase+'-mobile.png';await page.locator('.operator-panel').screenshot({path:screenshots.mobile});
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    return{browser:name,rate:48000,passed:true,cases,coldBefore,fourOperatorSlots,sixOperatorSlots,twoOperatorSlots,audible,stopped,rejections,graph:audited,mobileOverflow:overflow,screenshots,errors,missing,externalRequestsBlocked:external.length};
  }catch(error){console.error(JSON.stringify({name,errors,missing,status:await page.locator('#status').textContent(),custom:await currentGraph(page).catch(()=>null),body:(await page.locator('body').innerText()).slice(0,5500)},null,2));throw error;}
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
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP multi-operator custom FM browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

