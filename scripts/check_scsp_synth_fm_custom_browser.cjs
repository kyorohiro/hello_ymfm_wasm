// SPDX-License-Identifier: BSD-3-Clause
// Verify the two-operator custom FM editor with permanently muted physical output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-fm-custom-browser.json'),
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
  const audit=window.__scspCustomAudit={contexts:[],nodes:[],meters:[],commands:[],sequence:0};
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
    const id='custom-fm-audit-'+ ++audit.sequence;
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
const inspect=page=>page.evaluate(()=>__scspCustomAudit.inspect());
const graph=page=>page.evaluate(()=>__scspCustomAudit.graph());
const mutations=page=>page.evaluate(()=>__scspCustomAudit.mutations());
const level=page=>page.evaluate(()=>__scspCustomAudit.level());
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
async function currentGraph(page){
  return page.locator('#scspCustomFmControls').evaluate(panel=>({hidden:panel.hidden,
    target:document.getElementById('scspCustomFmTarget').textContent,
    input:document.getElementById('scspCustomFmInput').value,
    output:document.getElementById('scspCustomFmOutput').checked,
    summary:document.getElementById('routingSummary').textContent,
    paths:document.querySelectorAll('#connectionPaths path').length,
    hint:document.getElementById('scspCustomFmHint').textContent}));
}
async function customGraph(page,inputs,outputs){
  return waitState(page,state=>state.config.fm.algorithm==='custom'&&same(state.config.fm.custom,{inputs,outputs}),'custom graph '+JSON.stringify({inputs,outputs}));
}
async function exercise(name,origin){
  const browser=await({chromium,webkit}[name]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
  const errors=[],missing=[],external=[],cases=[];
  const imageBase=path.join(path.dirname(path.resolve(config.out)),path.basename(config.out,'.json')+'-'+name);
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>{
    if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}
    return route.continue();
  });
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  try{
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('[data-scsp-channel]').length===33);
    const coldBefore=await graph(page),coldWrites=await mutations(page);
    await page.locator('#voiceMode').selectOption('fm2');
    await page.locator('#algorithm').selectOption('custom');
    await page.locator('#scspCustomFmControls').waitFor({state:'visible'});
    await selectOperator(page,0);
    await page.waitForFunction(()=>document.getElementById('scspCustomFmInput').value==='1'&&document.getElementById('scspCustomFmOutput').checked);
    await page.locator('#scspCustomFmInput').selectOption('');
    await page.waitForFunction(()=>document.querySelectorAll('#connectionPaths path').length===0);
    await selectOperator(page,1);await page.locator('#scspCustomFmInput').selectOption('0');
    await page.locator('#scspCustomFmOutput').check();
    await selectOperator(page,0);await page.locator('#scspCustomFmOutput').uncheck();
    await page.waitForFunction(()=>document.getElementById('routingSummary').textContent.includes('A → B'));
    assert.equal((await graph(page)).contexts,0,'Cold custom editing must not start audio');
    assert.equal(await mutations(page),coldWrites,'Cold custom editing has no audio transport writes');
    assert.deepEqual(await graph(page),coldBefore);
    cases.push('Cold two-operator custom graph edits are passive until audio is explicitly enabled');

    await page.locator('#start').click();
    await page.waitForFunction(()=>__scspCustomAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    await customGraph(page,[[],[0]],[1]);
    // The selected graph source must remain an authored A/B identity even when
    // its native physical slot changes to make source processing precede target.
    await page.keyboard.down('a');
    const forward=await waitState(page,state=>state.voiceGroups.some(group=>group.held),'custom A to B note');
    const group=forward.voiceGroups.find(group=>group.held);
    assert.equal(group.operatorSlots.length,2);
    assert(group.operatorSlots[0]<group.operatorSlots[1],'A runs before its B target');
    assert.equal(forward.slots[group.operatorSlots[0]].directLevel,0);
    assert.equal(forward.slots[group.operatorSlots[1]].modulation.depth,forward.config.fm.depth);
    assert.equal(forward.slots[group.operatorSlots[1]].directLevel,forward.slots[1].directLevel);
    const audible=await until(async()=>{const value=await level(page);return value.peak>.00005?value:false;},'finite actual custom PCM');
    const requested=structuredClone(forward.config),owners=forward.voiceGroups.map(group=>({id:group.id,slots:group.slots,held:group.held}));
    await page.locator('#scspCustomFmInput').selectOption('1');
    await page.waitForFunction(()=>document.getElementById('status').dataset.error==='true');
    await page.waitForFunction(()=>document.getElementById('scspCustomFmInput').value==='');
    const rejected=await inspect(page);
    assert.deepEqual(rejected.config,requested,'A cycle must not change the current graph');
    assert.deepEqual(rejected.voiceGroups.map(group=>({id:group.id,slots:group.slots,held:group.held})),owners,'A cycle must not retire the current note');
    await page.keyboard.up('a');
    cases.push('Actual WASM plays A to B in dependency order and rejects cyclic edits without retiring held notes');

    // Mapping-aware source editing must address B's current destination, rather
    // than the reverse-operator position used by the legacy Chain template.
    await selectOperator(page,1);await page.keyboard.down('s');
    const editing=await waitState(page,state=>state.voiceGroups.some(group=>group.held),'second custom note');
    const editingGroup=editing.voiceGroups.find(group=>group.held);
    await number(page,'operatorRatio',3);
    const retuned=await waitState(page,state=>state.config.fm.ratios[1]===3,'ratio edit');
    assert(retuned.slots[editingGroup.operatorSlots[1]].frequencyHz>retuned.slots[editingGroup.operatorSlots[0]].frequencyHz*2.9);
    assert(retuned.slots[editingGroup.operatorSlots[1]].gate);
    await page.keyboard.up('s');
    await page.locator('#scspCustomFmInput').selectOption('');
    await selectOperator(page,0);await page.locator('#scspCustomFmInput').selectOption('1');
    await page.locator('#scspCustomFmOutput').check();
    await selectOperator(page,1);await page.locator('#scspCustomFmOutput').uncheck();
    await customGraph(page,[[1],[]],[0]);
    await page.keyboard.down('a');
    const backward=await waitState(page,state=>state.voiceGroups.some(group=>group.held),'custom B to A note');
    const reverse=backward.voiceGroups.find(group=>group.held);
    assert(reverse.operatorSlots[1]<reverse.operatorSlots[0],'B runs before its A target');
    await page.keyboard.up('a');
    cases.push('Reverse routing and ratio edits preserve A/B identities while using the mapped native slot');

    // Outputs are independent of modulation and may mix both or mute both.
    await page.locator('#scspCustomFmOutput').check();await customGraph(page,[[1],[]],[0,1]);
    await selectOperator(page,0);await page.locator('#scspCustomFmOutput').uncheck();
    await selectOperator(page,1);await page.locator('#scspCustomFmOutput').uncheck();
    await customGraph(page,[[1],[]],[]);
    await page.keyboard.down('a');await waitState(page,state=>state.voiceGroups.some(group=>group.held),'silent custom group still owns its slots');
    const dryOff=await until(async()=>{const value=await level(page);return value.peak===0?value:false;},'no direct outputs');
    assert.equal(dryOff.peak,0);await page.keyboard.up('a');
    await page.locator('#scspCustomFmOutput').check();await customGraph(page,[[1],[]],[1]);
    cases.push('Direct outputs can be both on or both off independently from the selected modulation source');

    // The last key for a physical CH must still receive its noteOff even if an
    // Auto graph edit retires unrelated grouped voices in the meantime.
    await selectChannel(page,31);await page.keyboard.down('a');
    await waitState(page,state=>state.manualVoices.some(voice=>voice.slot===31&&voice.held),'held physical voice');
    await selectChannel(page,null);await selectOperator(page,0);
    await page.locator('#scspCustomFmOutput').check();
    const manualKept=await waitState(page,state=>state.config.fm.custom.outputs.length===2,'graph edit alongside manual owner');
    assert(manualKept.manualVoices.some(voice=>voice.slot===31&&voice.held));
    await page.keyboard.up('a');await waitState(page,state=>state.manualVoices.every(voice=>voice.slot!==31||!voice.held),'manual key-up after Auto edit');
    cases.push('Auto graph changes do not strand the key-up of an independently held physical channel');

    const savedV5=await saveInstrument(page);
    assert.equal(savedV5.version,5);assert.equal(savedV5.fm.algorithm,'custom');
    assert.deepEqual(savedV5.fm.custom,{inputs:[[1],[]],outputs:[0,1]});
    await page.locator('#algorithm').selectOption('chain');
    await waitState(page,state=>state.config.fm.algorithm==='chain','fixed Chain');
    const savedV4=await saveInstrument(page);assert.equal(savedV4.version,4);assert.equal(savedV4.fm.custom,undefined);
    await loadInstrument(page,savedV5,'custom-v5.json');await customGraph(page,[[1],[]],[0,1]);
    await page.locator('#voiceMode').selectOption('fm4');
    await waitState(page,state=>state.config.mode==='fm4'&&state.config.fm.algorithm==='chain','custom to four-op fallback');
    await page.waitForFunction(()=>document.querySelector('#algorithm option[value="custom"]').disabled&&document.getElementById('scspCustomFmControls').hidden);
    assert.equal(await page.locator('#algorithm option[value="custom"]').evaluate(option=>option.disabled),true);
    assert(await page.locator('#scspCustomFmControls').isHidden());
    await loadInstrument(page,savedV4,'fixed-v4.json');
    await waitState(page,state=>state.config.mode==='fm2'&&state.config.fm.algorithm==='chain','legacy fixed preset restore');
    await loadInstrument(page,savedV5,'custom-again.json');await customGraph(page,[[1],[]],[0,1]);
    cases.push('Version-5 custom presets round-trip while fixed v4 files stay unchanged and higher-OP mode falls back explicitly');

    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').evaluate(input=>{
      input.value=`const scsp=await useSoundChip('scsp');setBpm(120);liveLoop('custom-ui',async()=>{await scsp.noteOn(CH1,'A3');await beat(.5);await scsp.noteOff(CH1);await beat(.25);});`;
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.locator('#synthCodeRunButton').click();await waitState(page,state=>state.codeActive,'Code running');
    const beforeSession=(await inspect(page)).codeSession;
    await selectOperator(page,0);await page.locator('#scspCustomFmInput').selectOption('');
    const codeKept=await waitState(page,state=>state.config.fm.custom.inputs[0].length===0&&state.codeActive,'graph edit preserves Code session');
    assert.equal(codeKept.codeSession,beforeSession);
    await waitState(page,state=>state.codeActive&&state.voiceGroups.some(group=>group.held),'next Code note uses new graph');
    await page.locator('.operator-panel').screenshot({path:imageBase+'-desktop.png'});
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'Code Stop');
    await page.locator('#stop').click();await page.waitForTimeout(160);
    const stopped=await level(page);assert.equal(stopped.peak,0);
    cases.push('Code remains running across valid graph edits and Stop releases all custom output');

    await page.setViewportSize({width:390,height:844});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'Mobile overflow '+overflow);
    await page.locator('.operator-panel').screenshot({path:imageBase+'-mobile.png'});
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    return {browser:name,rate:48000,passed:true,cases,coldBefore,forwardOperatorSlots:group.operatorSlots,backwardOperatorSlots:reverse.operatorSlots,audible,dryOff,stopped,
      graph:audited,mobileOverflow:overflow,screenshots:{desktop:imageBase+'-desktop.png',mobile:imageBase+'-mobile.png'},errors,missing,externalRequestsBlocked:external.length};
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
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP custom FM browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

