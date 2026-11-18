// SPDX-License-Identifier: BSD-3-Clause
// Verify the passive, collapsible Synth DSP flow diagram with permanently muted physical output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-dsp-flow-browser.json'),
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
  const audit=window.__scspFlowAudit={contexts:[],nodes:[],meters:[],commands:[],sequence:0};
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
    const id='flow-audit-'+ ++audit.sequence;
    const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Primary Synth request timed out'));},5000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);
      if(data.error){const error=Error(data.error);error.name=data.name??'Error';reject(error);}else resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({...command,id});
  });
  audit.inspect=()=>audit.request({type:'chip-inspector',action:'read'});
}

async function until(read,label){
  for(let attempt=0;attempt<200;attempt++){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}
  throw Error('Timed out: '+label);
}
const inspect=page=>page.evaluate(()=>__scspFlowAudit.inspect());
const request=(page,command)=>page.evaluate(command=>__scspFlowAudit.request(command),command);
const graph=page=>page.evaluate(()=>__scspFlowAudit.graph());
const mutations=page=>page.evaluate(()=>__scspFlowAudit.mutations());
const waitState=(page,predicate,label)=>until(async()=>{const state=await inspect(page);return predicate(state)?state:false;},label);
async function number(page,id,value){
  await page.locator('#'+id).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));},value);
}
async function selectChannel(page,slot){
  await page.locator(`[data-scsp-channel="${slot??'auto'}"]`).click();
  await page.waitForFunction(value=>document.getElementById('scspChannelTabs').dataset.selected===String(value),slot??'auto');
}
async function flow(page){return page.locator('#scspDspSignalFlowBody').evaluate(body=>{
  const read=node=>node?{text:node.textContent.trim(),...node.dataset,
    sides:Object.fromEntries([...node.querySelectorAll('[data-side]')].map(side=>[side.dataset.side,{text:side.textContent.trim(),...side.dataset}]))}:null;
  return {source:read(body.querySelector('[data-flow="source"]')),send:read(body.querySelector('[data-flow="send"]')),
    program:read(body.querySelector('[data-flow="program"]')),direct:read(body.querySelector('[data-flow="direct"]')),
    returns:[0,1].map(output=>read(body.querySelector(`[data-flow="return"][data-output="${output}"]`))),
    notice:read(body.querySelector('[data-flow="notice"]')),text:body.textContent.trim()};
});}
const waitFlow=(page,predicate,label)=>until(async()=>{const value=await flow(page);return predicate(value)?value:false;},label);
async function example(page,id,family){
  await page.locator('#scspDspProgramExample').selectOption(id);
  await page.locator('#scspDspProgramCheck').click();await page.locator('#scspDspProgramApply').click();
  return waitFlow(page,value=>value.program?.program===family,'applied '+family+' flow');
}
const stable=state=>({dspRoutingOverrides:state.dspRoutingOverrides,dspReturns:state.dspReturns,
  samples:state.playingSampleIds,gate:state.slots.map(voice=>voice.gate),ramUsedBytes:state.ramUsedBytes,
  codeActive:state.codeActive});

async function exercise(name,origin,fixture){
  const browser=await({chromium,webkit}[name]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
  const errors=[],missing=[],external=[],cases=[];
  const imageBase=path.join(path.dirname(path.resolve(config.out)),path.basename(config.out,'.json')+'-'+name);
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
  page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  try{
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('[data-scsp-channel]').length===33);
    await page.locator('#scspDspTab').click();
    assert.equal(await page.locator('#scspDspSignalFlow').evaluate(node=>node.open),false,'The flow is collapsed by default');
    const coldBefore=await graph(page),coldMutations=await mutations(page);
    await page.locator('#scspDspSignalFlowSummary').click();
    const initial=await waitFlow(page,value=>value.source&&value.program?.program==='delay','cold Delay flow');
    assert.equal(initial.send.input,'0');assert(initial.text.includes('MIXS0'));
    assert(initial.returns.every(value=>value.state==='disabled'));
    assert.equal(initial.direct.state,'enabled','Direct output remains independent');
    await selectChannel(page,1);await page.locator('#scspDspInput').selectOption('1');await number(page,'scspDspSend',0);
    const zeroSend=await waitFlow(page,value=>value.send?.input==='1'&&value.send.level==='0','cold Send zero');
    assert.equal(zeroSend.send.state,'muted');assert.equal(zeroSend.direct.state,'enabled');
    await page.locator('#scspDspRouteDefault').click();await selectChannel(page,null);
    await page.locator('#scspDspProgramExample').selectOption('routing-gain-iir');
    assert.equal((await flow(page)).program.program,'delay','Staging source must not change the applied path');
    await page.locator('#scspDspProgramCheck').click();await page.locator('#scspDspProgramApply').click();
    const coldApplied=await waitFlow(page,value=>value.program?.program==='routing','cold applied routing');
    assert.equal(coldApplied.returns[0].route,'selected');assert.equal(coldApplied.returns[1].route,'other-input');
    const coldAfter=await graph(page);assert.equal(coldAfter.contexts,0);assert.equal(coldAfter.routes,0);
    assert.equal(coldMutations,await mutations(page));assert.deepEqual(coldBefore,coldAfter);
    cases.push('Cold opening, target changes and applied/staged distinction need no AudioContext or transport writes');

    await page.locator('#start').click();
    await page.waitForFunction(()=>__scspFlowAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    await waitState(page,state=>state.dspReturns?.length===2,'primary audio ready');
    await page.locator('#scspDspSignalFlowSummary').focus();
    await page.keyboard.down('a');
    await waitState(page,state=>state.voiceGroups.some(group=>group.held),'summary focus permits keyboard notes');
    await page.keyboard.up('a');
    await waitState(page,state=>state.voiceGroups.every(group=>!group.held),'summary key released');
    await page.locator('#stop').click();
    cases.push('A focused flow disclosure still permits normal keyboard note On/Off');
    await page.locator('#effectEnabled').check();
    await number(page,'effectReturn',7);await number(page,'scspDspReturn0Pan',31);
    await number(page,'scspDspReturn1Level',7);await number(page,'scspDspReturn1Pan',15);
    for(const [slot,input]of [[0,0],[1,1]]){
      await selectChannel(page,slot);await page.locator('#scspDspInput').selectOption(String(input));await number(page,'scspDspSend',7);
      await waitState(page,state=>state.dspRouting.slots[slot].input===input&&state.dspRouting.slots[slot].level===7,'selected bus '+input);
      await request(page,{method:'invokePhysical',args:['setMix',[slot,{directLevel:0,totalLevel:12}]]});
      await request(page,{method:'physicalNoteOn',args:['flow-'+slot,slot,69]});
    }
    const held=await waitState(page,state=>state.slots[0].gate&&state.slots[1].gate,'two held slots');
    const right=await waitFlow(page,value=>value.source?.text.includes('CH2')&&value.send.input==='1'&&value.returns[1].route==='selected'&&value.direct.state==='muted'&&value.returns[0].pan==='31'&&value.returns[1].pan==='15','CH2 routing and direct mute');
    assert.equal(right.returns[0].route,'other-input');assert.equal(right.direct.state,'muted');
    assert.equal(right.returns[0].sides.left.state,'enabled');assert.equal(right.returns[0].sides.right.state,'muted');
    assert.equal(right.returns[1].sides.right.state,'enabled');assert.equal(right.returns[1].sides.left.state,'muted');
    const beforeToggle=stable(await inspect(page)),beforeWrites=await mutations(page);
    await page.locator('#scspDspSignalFlowSummary').click();await page.locator('#scspDspSignalFlowSummary').click();
    await page.waitForTimeout(120);
    assert.deepEqual(stable(await inspect(page)),beforeToggle);assert.equal(await mutations(page),beforeWrites,'Opening the view must not edit the owner');
    cases.push('Known bus connections and independent Pan sides update while holding notes; expanding is passive');

    await number(page,'scspDspSend',0);
    const noContribution=await waitFlow(page,value=>value.send.level==='0','selected contribution muted');
    assert.equal(noContribution.send.state,'muted');assert.equal(noContribution.returns[0].state,'enabled');assert.equal(noContribution.returns[1].state,'enabled','Shared outputs are not inferred silent from one Send');
    await number(page,'scspDspSend',7);await number(page,'scspDspReturn1Level',0);
    await waitFlow(page,value=>value.returns[1].state==='muted','Return 1 muted');
    await number(page,'scspDspReturn1Level',7);await page.locator('#effectEnabled').uncheck();
    await waitFlow(page,value=>value.returns.every(output=>output.state==='disabled'),'returns disabled');
    await page.locator('#effectEnabled').check();
    await number(page,'scspDspReturn1Pan',0);
    const center=await waitFlow(page,value=>value.returns[1].pan==='0'&&value.returns[1].state==='enabled','center Pan');
    assert.equal(center.returns[1].sides.left.state,'enabled');assert.equal(center.returns[1].sides.right.state,'enabled');
    await request(page,{method:'invokePhysical',args:['setMix',[1,{directLevel:7,pan:15}]]});
    await waitFlow(page,value=>value.direct.state==='enabled'&&value.direct.pan==='15','direct branch');
    const after=await inspect(page);assert.deepEqual(after.playingSampleIds,held.playingSampleIds);assert(after.slots[0].gate&&after.slots[1].gate);
    cases.push('Send, Enable, Return zero and Pan changes are configured paths, not total-output meters; dry output stays independent');

    await example(page,'delay','delay');
    const unused=await waitFlow(page,value=>value.program.route==='unused','Delay does not consume MIXS1');
    assert.equal(unused.returns[1].route,'unused');assert.equal(unused.direct.state,'enabled');
    const source='000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=2\n001: EWT=1 EWA=1 ZERO=1\n';
    await page.locator('#scspDspProgramEditor').fill(source);await page.locator('#scspDspProgramCheck').click();await page.locator('#scspDspProgramApply').click();
    const custom=await waitFlow(page,value=>value.program.program==='custom','arbitrary program');
    assert.equal(custom.program.route,'program-defined');assert(custom.returns.every(output=>output.route==='program-defined'));
    await example(page,'routing-gain-iir','routing');
    await page.locator('#scspDspSignalFlow').screenshot({path:imageBase+'-desktop.png'});
    cases.push('Only recognized applied programs infer connectivity; custom instructions remain program-defined');

    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').evaluate(input=>{input.value=`const scsp=await useSoundChip('scsp');liveLoop('flow-ui',async()=>{await scsp.noteOn(CH1,'A3');await beat(.5);await scsp.noteOff(CH1);await beat(.25);});`;input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#synthCodeRunButton').click();await waitState(page,state=>state.codeActive,'Code active');
    await number(page,'scspDspReturn1Pan',15);await waitFlow(page,value=>value.returns[1].pan==='15','flow during Code');
    assert((await inspect(page)).codeActive);
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'Code Stop');
    await page.locator('#stop').click();await page.waitForTimeout(140);
    assert.equal((await page.evaluate(()=>__scspFlowAudit.level())).peak,0);
    cases.push('Flow follows live UI edits during Code and Stop remains silent');

    if(!(await page.locator('#synthMenu').evaluate(node=>node.open)))await page.locator('#synthMenuButton').click();
    const chooser=page.waitForEvent('filechooser');await page.locator('#loadSsf').click();
    await(await chooser).setFiles({name:'flow-original.ssf',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
    await until(()=>page.locator('#scspSongPlay').isEnabled(),'SSF source ready');
    const primaryBefore=await request(page,{method:'readDspSetup',args:[]});
    await page.locator('#scspSongPlay').click();
    await page.waitForFunction(()=>document.getElementById('scspSsfLive').dataset.active==='true');
    await page.locator('#scspSongPause').click();
    await page.waitForFunction(()=>document.getElementById('scspSongPause').textContent.includes('Resume'));
    const separate=await waitFlow(page,value=>value.notice?.text.includes('SSF has a separate DSP'),'SSF separation notice');
    assert(await page.locator('#scspDspTab').isDisabled(),'The existing SSF policy keeps the Synth DSP tab unavailable');
    assert(await page.locator('#scspDspInput').isDisabled());
    assert.deepEqual(await request(page,{method:'readDspSetup',args:[]}),primaryBefore,'SSF view must not change Synth DSP');
    await page.locator('#scspSongStop').click();
    await page.waitForTimeout(140);
    await page.locator('#scspDspTab').click();
    assert.equal((await page.evaluate(()=>__scspFlowAudit.level())).peak,0);
    cases.push('SSF live view labels its separate DSP and cannot mutate the primary configuration');

    await page.setViewportSize({width:390,height:844});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'Mobile overflow '+overflow);
    await page.locator('#scspDspSignalFlow').screenshot({path:imageBase+'-mobile.png'});
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    return {browser:name,rate:48000,passed:true,cases,coldBefore,coldAfter,right,noContribution,center,unused,custom,separate,
      graph:audited,mobileOverflow:overflow,screenshots:{desktop:imageBase+'-desktop.png',mobile:imageBase+'-mobile.png'},errors,missing,externalRequestsBlocked:external.length};
  }catch(error){console.error(JSON.stringify({name,errors,missing,status:await page.locator('#status').textContent(),flow:await flow(page).catch(()=>null),body:(await page.locator('body').innerText()).slice(0,5500)},null,2));throw error;}
  finally{await context.close();await browser.close();}
}
(async()=>{
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});
  const {createScspSsfLiveFixture}=await import(pathToFileURL(path.join(repository,'test/helpers/scsp_ssf_fixture.mjs')).href);
  const fixture=createScspSsfLiveFixture();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  try{
    const results=[];for(const name of engines)results.push(await exercise(name,origin,fixture));
    for(const [name,record]of served)assert.equal(sha(await fs.readFile(path.join(config.root,name))),record.sha256,'Source changed '+name);
    const report={passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,assets:Object.fromEntries(served)};
    await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP DSP flow browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

