// SPDX-License-Identifier: BSD-3-Clause
// Verify Phase-1 Cycle2 through actual Synth Files/Code with permanently muted physical output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-cycle2-browser.json'),
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
const cycleSource=`const scsp = await useSoundChip('scsp');
setBpm(120);
await scsp.setConfig({mode:'fm2',fm:{algorithm:'cycle2',cycle2:{outputs:[1]},depth:8,ratios:[1,1.5,1,1,1,1]}});
await livePrepare('cycle2-source', async () => {
  const pcm=Int16Array.from({length:64},(_,i)=>Math.round(4096*Math.sin(i*Math.PI/32)));
  for (const operator of [0,1]) await scsp.applyPCM(operator,pcm,{baseFrequencyHz:44100/64,loopStartSamples:0});
  await scsp.setMix(0,{totalLevel:12,directLevel:0});
  await scsp.setMix(1,{totalLevel:16,directLevel:5});
  return true;
});
await livePrepare('cycle2-note',()=>scsp.noteOn(CH1,'A3'));
liveLoop('cycle2-hold',async()=>{await beat(4096);});
`;
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
function verifyPair(state){
  assert.equal(state.config.fm.algorithm,'cycle2');
  const group=state.voiceGroups.find(value=>value.held&&value.owner?.kind==='code');
  assert(group,'A held Code pair exists');assert.deepEqual(group.operatorSlots,group.slots);
  const [a,b]=group.slots;assert.equal(b,a+1);assert(a>=6&&b<=31);
  assert.deepEqual(state.slots[a].modulation,{depth:8,xOffset:33,yOffset:1,writeInhibit:false});
  assert.deepEqual(state.slots[b].modulation,{depth:8,xOffset:63,yOffset:63,writeInhibit:false});
  assert.equal(state.slots[a].directLevel,0);assert.equal(state.slots[b].directLevel,5);
  return group;
}
async function exercise(name,origin){
  const browser=await({chromium,webkit}[name]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
  const errors=[],missing=[],external=[],cases=[],downloads=[];
  const image=path.join(path.dirname(path.resolve(config.out)),path.basename(config.out,'.json')+'-'+name+'-code.png');
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  page.on('download',download=>downloads.push(download.suggestedFilename()));
  try{
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('[data-scsp-channel]').length===33);
    assert.equal((await graph(page)).contexts,0);
    const base=await saveInstrument(page);assert.equal((await graph(page)).contexts,0);
    await file(page);await evaluateCode(page,cycleSource);
    let state=await waitState(page,state=>state.codeActive&&state.voiceGroups.some(value=>value.held&&value.owner?.kind==='code'),'Code Cycle attack');
    const first=verifyPair(state),before=identity(state),sampleIds=state.slots.slice(6,8).map(voice=>voice.sample.id);
    const audible=await until(async()=>{const value=await level(page);return value.peak>1e-5?value:false;},'finite nonzero Cycle output');
    cases.push('Actual Files index.js and Code Run borrow the Synth, initialize a fixed A-before-B pair with the measured taps and produce finite nonzero muted output');
    await evaluateCode(page,cycleSource.replace('depth:8','depth:0'),{apply:true});
    state=await waitState(page,state=>state.config.fm.depth===0,'Apply Depth Off');assert.deepEqual(identity(state),before);
    assert.deepEqual(state.slots.slice(6,8).map(voice=>voice.sample.id),sampleIds);
    // getState reports retained requested taps; native serialization of the
    // existing adapter's depth0 is verified independently in real-WASM tests.
    assert.deepEqual(state.slots[first.slots[0]].modulation,{depth:0,xOffset:33,yOffset:1,writeInhibit:false});
    assert.deepEqual(state.slots[first.slots[1]].modulation,{depth:0,xOffset:63,yOffset:63,writeInhibit:false});
    await evaluateCode(page,cycleSource,{apply:true});state=await waitState(page,state=>state.config.fm.depth===8,'Apply Depth On');assert.deepEqual(identity(state),before);verifyPair(state);
    cases.push('Apply Depth Off/On retains session, pair identity, order and prepared PCM without a new attack');
    const checks=`\ntry { await scsp.setConfig({mode:'fm4'}); log('ERROR invalid mode accepted'); } catch(error) { log('cycle2 invalid mode rejected',error.message); }\ntry { await scsp.exportPatch(); log('ERROR export accepted'); } catch(error) { log('cycle2 export rejected',error.message); }\n`;
    await evaluateCode(page,cycleSource+checks,{apply:true});
    await page.waitForFunction(()=>document.getElementById('synthCodeLog').textContent.includes('cycle2 export rejected'));
    state=await inspect(page);assert.deepEqual(identity(state),before);assert(!await page.locator('#synthCodeLog').textContent().then(value=>value.includes('ERROR')));
    cases.push('Actual borrowed Code rejects an incompatible mode and premature portable export while the current Cycle keeps running');
    const savedDownloads=downloads.length,filesBefore=await page.locator('#scspFilesTree button[data-file-path]').evaluateAll(nodes=>nodes.map(node=>node.dataset.filePath));
    if(!await page.locator('#synthMenu').evaluate(menu=>menu.open))await page.locator('#synthMenuButton').click();
    await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').dataset.error==='true'&&/Cycle.*(?:Code-only|version 11)/i.test(document.getElementById('status').textContent));
    await page.locator('#scspFileSaveSoundButton').click();
    await page.waitForFunction(()=>/Cycle.*(?:Code-only|version 11)/i.test(document.getElementById('scspFilesStatus').textContent));
    await page.locator('#scspSaveSoundAs').click();
    assert.equal(await page.locator('dialog[open]').count(),0,'Save-to-presets must not stage a stale portable sound in a naming dialog');
    assert.equal(downloads.length,savedDownloads);assert.deepEqual(await page.locator('#scspFilesTree button[data-file-path]').evaluateAll(nodes=>nodes.map(node=>node.dataset.filePath)),filesBefore);
    assert.equal((await inspect(page)).codeActive,true);
    cases.push('Menu Instrument JSON, Files Save sound and Save-to-presets dialog entry explicitly reject Cycle saving, producing neither a stale download, staged naming dialog nor misleading preset file');
    await selectChannel(page,first.slots[0]);await page.keyboard.down('a');
    state=await waitState(page,state=>state.manualVoices.some(value=>value.slot===first.slots[0]&&value.held)&&!state.voiceGroups.some(group=>group.id===first.id),'physical takeover');
    const physical=state.manualVoices.find(value=>value.slot===first.slots[0]&&value.held);
    assert.equal(await request(page,{method:'code',args:[state.codeSession,'noteOff',[0]]}),false);
    assert((await inspect(page)).manualVoices.some(value=>value.id===physical.id&&value.held));
    await page.keyboard.up('a');await selectChannel(page,31);await page.keyboard.down('s');
    await waitState(page,state=>state.manualVoices.some(value=>value.slot===31&&value.held),'independent physical owner');
    await request(page,{method:'invokePhysical',args:['setMix',[31,{directLevel:5,totalLevel:16}]]});
    const finalSource=cycleSource+checks+`\nawait livePrepare('cycle2-second',()=>scsp.noteOn(CH2,'C4'));\nawait scsp.setDspSourceSend(1,{input:1,level:5});\n`;
    await evaluateCode(page,finalSource,{apply:true});
    state=await waitState(page,state=>state.voiceGroups.some(group=>group.owner?.channel===1&&group.held),'second Code lane');
    const manual=state.manualVoices.find(value=>value.slot===31&&value.held),program=await request(page,{method:'readDspProgram',args:[]});
    const overrides=state.dspRoutingOverrides;
    await page.screenshot({path:image,fullPage:true});
    await page.locator('#synthCodeStopButton').click();state=await waitState(page,state=>!state.codeActive,'Code Stop');
    assert(state.manualVoices.some(value=>value.id===manual.id&&value.held));assert.deepEqual(await request(page,{method:'readDspProgram',args:[]}),program);assert.deepEqual(state.dspRoutingOverrides,overrides);
    await until(async()=>{const value=await level(page);return value.peak>1e-5?value:false;},'independent physical sound survives Code Stop');
    cases.push('Physical takeover retires the entire former pair; stale Code release cannot erase it, and later Code Stop preserves an independent physical owner and DSP setup');
    await page.keyboard.up('s');await page.locator('#stop').click();
    const archive=await exportProject(page),{loadPlaygroundCassette}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')).href),cassette=await loadPlaygroundCassette(new Uint8Array(archive));
    const manifest=JSON.parse(new TextDecoder().decode(cassette.files.get('scsp-synth.project.json')));
    assert.deepEqual(manifest.settings,base);assert.equal(new TextDecoder().decode(cassette.files.get('index.js')),finalSource);
    await page.reload();await page.waitForFunction(()=>!document.querySelector('.scsp-main').inert&&!document.getElementById('start').disabled);
    assert.equal((await graph(page)).contexts,0);await file(page);assert.equal(await page.locator('#synthCodeEditor').inputValue(),finalSource);assert.equal((await graph(page)).contexts,0);
    await page.locator('#start').click();await page.waitForFunction(()=>__scspCycleAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    state=await inspect(page);assert.equal(state.codeActive,false);assert.equal(state.config.fm.algorithm,'chain');assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),base);
    cases.push('Workspace export and local autosave preserve Cycle JavaScript with the last portable base sound; reload never executes Code or starts audio');
    await evaluateCode(page,cycleSource);await waitState(page,state=>state.config.fm.algorithm==='cycle2','Cycle before normal preset');
    await loadInstrument(page,base,'normal-base.json');state=await waitState(page,state=>state.config.fm.algorithm==='chain','normal preset exits Cycle');
    assert.deepEqual(await request(page,{method:'exportPatch',args:[]}),base);
    await page.locator('#stop').click();const stopped=await until(async()=>{const value=await level(page);return value.peak===0?value:false;},'global Stop silence');
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    cases.push('A normal preset exits Cycle through the existing sound-loading path; global Stop is silent and every physical output remains muted at 48 kHz');
    return {browser:name,rate:48000,passed:true,cases,first,audible,stopped,graph:audited,errors,missing,screenshot:image,externalRequestsBlocked:external.length};
  }catch(error){console.error(JSON.stringify({name,errors,missing,status:await page.locator('#status').textContent(),codeError:await page.locator('#synthCodeError').textContent(),body:(await page.locator('body').innerText()).slice(0,6500)},null,2));throw error;}
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
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP Cycle2 browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
