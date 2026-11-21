// SPDX-License-Identifier: BSD-3-Clause
// Exercise the authored slot view through the real UI. Physical output is muted before initialization.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {
  root: path.join(repository, 'docs'), entry: '/synth-scsp/index.html', engines: 'chromium,webkit',
  out: path.join(os.tmpdir(), 'scsp-synth-slot-allocation-browser.json'),
  screenshots: path.join(os.tmpdir(), 'scsp-synth-slot-allocation-browser'),
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const match = /^--(root|entry|engines|out|screenshots)(?:=(.+))?$/.exec(args[index]);
  assert(match, 'Unknown argument ' + args[index]);
  config[match[1]] = match[2] ?? args[++index];
  assert(config[match[1]], 'Missing value for ' + match[1]);
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm',
  '.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.md':'text/plain','.scspasm':'text/plain'};
const served = new Map(), sourceErrors = [];
const server = http.createServer(async (request, response) => {
  try {
    let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (relative === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(config.root, '.' + relative);
    assert(file.startsWith(config.root + path.sep), 'Request stays inside the isolated static site');
    const bytes = await fs.readFile(file), asset = path.relative(config.root,file).split(path.sep).join('/');
    const record = {bytes:bytes.length,sha256:sha(bytes)};
    if (served.has(asset) && served.get(asset).sha256 !== record.sha256) {
      sourceErrors.push('Served source changed during verification: ' + asset);
      throw Error(sourceErrors.at(-1));
    }
    served.set(asset,record);
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  } catch {response.writeHead(404).end();}
});

function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  const audit = window.__scspAllocationAudit = {contexts:[],nodes:[],meters:[],commands:[],sequence:0};
  window.AudioContext = class extends Context {
    constructor(options={}) {super({...options,sampleRate:48000});audit.contexts.push(this);}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context,name,options) {super(context,name,options);audit.nodes.push({name,node:this});}
  };
  AudioNode.prototype.connect = function(destination,...rest) {
    if (destination !== this.context.destination) return connect.call(this,destination,...rest);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();
    analyser.fftSize=2048;mute.gain.value=0;
    connect.call(this,analyser);connect.call(analyser,mute);connect.call(mute,destination);
    audit.meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage = function(data,...rest) {
    if (data?.method || data?.type === 'chip-inspector') audit.commands.push(structuredClone(data));
    return post.call(this,data,...rest);
  };
  const reads=new Set(['readAuthoring','readPhysical','readDspProgram','readDspSetup','readDspCoefficients','readAudition','getState','exportPatch','exportIdleState']);
  audit.mutations=()=>audit.commands.filter(data=>data.type==='chip-inspector'
    ? data.action!=='read' && data.method!=='getPCM'
    : !reads.has(data.method==='code'?data.args?.[1]:data.method) && !(['invoke','invokePhysical'].includes(data.method)&&data.args?.[0]==='getPCM')).length;
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
    const id='allocation-audit-'+ ++audit.sequence;
    const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Read timed out'));},5000);
    function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);
      data.error?reject(Error(data.error)):resolve(data.value);}
    node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({...command,id});
  });
  audit.inspect=()=>audit.request({type:'chip-inspector',action:'read'});
}

async function until(read,label) {
  for(let attempt=0;attempt<400;attempt++) {
    const value=await read();if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw Error('Timed out: '+label);
}
const inspect=page=>page.evaluate(()=>__scspAllocationAudit.inspect());
const graph=page=>page.evaluate(()=>__scspAllocationAudit.graph());
const mutations=page=>page.evaluate(()=>__scspAllocationAudit.mutations());
const level=page=>page.evaluate(()=>__scspAllocationAudit.level());
const waitState=(page,predicate,label)=>until(async()=>{const state=await inspect(page);return predicate(state)?state:false;},label);
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const identity=state=>({codeActive:state.codeActive,codeSession:state.codeSession,
  groups:state.voiceGroups,manual:state.manualVoices,playing:state.playingSampleIds});
const control=(page,name)=>page.locator('#voice [data-chip-control="scsp-'+name+'"]');
async function number(page,id,value) {
  await page.locator('#'+id).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));},value);
}
async function physicalNumber(page,name,value) {
  await control(page,name).fill(String(value));await control(page,name).dispatchEvent('change');
}
async function selectOperator(page,index) {
  await page.locator('button[data-operator="'+index+'"]').click();
  await page.waitForFunction(index=>document.querySelector('button[data-operator="'+index+'"]').getAttribute('aria-pressed')==='true',index);
}
async function selectChannel(page,slot=null) {
  await page.locator('[data-scsp-channel="'+(slot??'auto')+'"]').click();
  await page.waitForFunction(slot=>document.getElementById('scspChannelTabs').dataset.selected===String(slot),slot??'auto');
}
async function allocation(page) {
  return page.evaluate(()=>{
    const root=document.getElementById('scspSynthSlotAllocation'),tabs=document.getElementById('scspChannelTabs');
    const text=id=>document.getElementById(id)?.textContent??'';
    return {hidden:root.hidden,kind:root.dataset.kind,group:root.dataset.groupId,selected:tabs.dataset.selected,source:tabs.dataset.source,
      badge:text('scspSynthAllocationBadge'),status:text('scspSynthAllocationStatus'),owner:text('scspSynthAllocationOwner'),
      mapping:text('scspSynthAllocationMapping'),connections:[...root.querySelectorAll('#scspSynthAllocationConnections p')]
        .filter(node=>!node.hidden).map(node=>node.textContent).join('\n'),
      cards:[...root.querySelectorAll('[data-operator]')].filter(node=>!node.hidden).map(node=>({operator:node.dataset.operator,
        slot:node.dataset.slot,text:node.textContent,direct:node.querySelector('.scsp-synth-allocation-direct')?.textContent,
        send:node.querySelector('.scsp-synth-allocation-send')?.textContent})),
      channels:[...tabs.querySelectorAll('[data-scsp-channel]')].map(node=>({slot:node.dataset.scspChannel,
        related:node.dataset.related,ownership:node.dataset.ownership,allocation:node.dataset.allocation,
        operator:node.dataset.operator,group:node.dataset.group,selected:node.getAttribute('aria-selected'),phase:node.dataset.phase}))};
  });
}
async function waitAllocation(page,group,label='selected group follows allocation') {
  return until(async()=>{const view=await allocation(page);return !view.hidden&&view.group===group.id?view:false;},label);
}
function assertMapping(view,group,expected) {
  assert.equal(view.group,group.id);
  const slots=expected??group.operatorSlots??group.slots;
  slots.forEach((slot,index)=>assert.match(view.mapping,new RegExp('ABCDEFG'[index]+'\\s*→\\s*CH'+(slot+1)+'(?:\\D|$)')));
  assert.deepEqual(view.channels.filter(channel=>channel.related==='true').map(channel=>Number(channel.slot)).sort((a,b)=>a-b),[...group.slots].sort((a,b)=>a-b));
  for(const slot of group.slots){const channel=view.channels.find(value=>Number(value.slot)===slot);
    assert.equal(channel.ownership,'group');assert.equal(channel.group,group.id);}
}
async function code(page,source,{apply=false}={}) {
  await page.locator('#synthInputCodeTab').click();
  await page.locator('#synthCodeEditor').waitFor({state:'visible'});
  await page.locator('#synthCodeEditor').fill(source);
  await page.locator(apply?'#synthCodeApplyButton':'#synthCodeRunButton').click();
  await page.waitForFunction(()=>!document.getElementById('synthCodeApplyButton').disabled);
  assert.equal(await page.locator('#synthCodeError').textContent(),'');
}
function holdSource(mode,custom,lane=3) {
  return `const scsp=await useSoundChip('scsp');
await scsp.setConfig(${JSON.stringify({mode,fm:{algorithm:'custom',custom}})});
await scsp.setMix(0,{directLevel:3});
await scsp.setDspSourceSend(0,{input:1,level:5});
await scsp.noteOn(${lane},'D4');
liveLoop('allocation-hold',async()=>{await beat(4096);});`;
}

async function exercise(name,origin) {
  const browser=await({chromium,webkit}[name]).launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}: {})});
  const context=await browser.newContext({viewport:{width:1400,height:1050}}),page=await context.newPage();
  page.setDefaultTimeout(20000);
  const errors=[],missing=[],external=[],checks=[],screenshots={},measurements={};
  let stage='cold authored view';
  await context.addInitScript(installSilentAudit);
  await context.route('**/*',route=>{
    if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}
    return route.continue();
  });
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  const step=label=>{stage=label;console.log('CHECK '+name+': '+label);};
  async function screenshot(label,locator=page.locator('.scsp-channel-overview')) {
    const filename=path.join(config.screenshots,name+'-'+label+'.png');
    await locator.screenshot({path:filename});screenshots[label]=filename;
  }
  try {
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('#scspChannelTabs [data-scsp-channel]').length===33);
    await page.locator('#scspSynthSlotAllocation').waitFor({state:'visible'});
    assert.equal((await graph(page)).contexts,0);
    await selectChannel(page,0);await selectChannel(page,31);await selectChannel(page);
    assert.equal((await graph(page)).contexts,0,'Reading the allocation UI does not initialize audio');
    assert.equal(await mutations(page),0);
    checks.push('The existing 33-button Auto / physical selector and authored allocation view are available cold; selection allocates no audio or owner');

    step('Cycle2 keyboard mapping, latest Auto and physical keyboard target');
    await page.locator('#voiceMode').selectOption('fm2');await page.locator('#algorithm').selectOption('cycle2');
    await page.locator('#start').click();
    await page.waitForFunction(()=>__scspAllocationAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    await page.keyboard.down('a');
    let state=await waitState(page,state=>state.voiceGroups.some(group=>group.held&&group.owner.kind==='keyboard'),'first keyboard group');
    const first=state.voiceGroups.find(group=>group.held&&group.owner.kind==='keyboard');
    assert.deepEqual(first.operatorSlots,[6,7]);
    let view=await waitAllocation(page,first);assertMapping(view,first,[6,7]);
    assert.match(view.owner,/keyboard/i);assert.match(view.badge,/held/i);
    assert.match(view.connections,/current/i);assert.match(view.connections,/history/i);
    measurements.cycleMapping={group:first,view};
    measurements.cycleOutput=await until(async()=>{const output=await level(page);return output.peak>1e-5?output:false;},'finite Cycle2 output before permanent mute');
    await page.locator('#scspSynthAllocationHelp > summary').click();
    await page.locator('#scspSynthAllocationHelp > summary').focus();
    await page.keyboard.down('s');
    state=await waitState(page,state=>state.voiceGroups.filter(group=>group.held).length===2,'polyphonic second group');
    const second=state.voiceGroups.find(group=>group.id!==first.id&&group.held);
    view=await waitAllocation(page,second);assertMapping(view,second);assert.equal(view.selected,'auto');
    assert(await page.locator('#scspSynthAllocationHelp').evaluate(node=>node.open),'Polling preserves the open explanation');
    assert(await page.locator('#scspSynthAllocationHelp > summary').evaluate(node=>node===document.activeElement),'Polling preserves keyboard focus');
    await page.locator('#scspSynthAllocationHelp > summary').click();
    const beforeSelection=identity(state),writes=await mutations(page);
    await selectChannel(page,6);view=await waitAllocation(page,first);assertMapping(view,first);
    assert.equal(await mutations(page),writes,'Inspecting a physical member posts no mutations');
    assert.deepEqual(identity(await inspect(page)),beforeSelection,'Selection preserves both groups and sample identities');
    await page.keyboard.down('d');
    state=await waitState(page,state=>state.manualVoices.some(voice=>voice.slot===6&&voice.held),'selected physical keyboard note');
    assert.equal((await allocation(page)).selected,'6');assert.equal(await page.locator('#voice').getAttribute('data-physical-channel'),'6');
    assert(state.manualVoices.some(voice=>voice.slot===6&&voice.held));
    await page.keyboard.up('d');await page.keyboard.up('a');await page.keyboard.up('s');
    await selectChannel(page,8);view=await waitAllocation(page,second);
    await until(async()=>/released/i.test((await allocation(page)).badge),'released retained ownership label');
    view=await allocation(page);assert.match(view.badge,/released.*retained/i);
    assert.equal(view.channels.find(channel=>channel.slot==='8').allocation,'released');
    assert(view.channels.filter(channel=>channel.related==='true').every(channel=>!channel.phase),'Authored ownership does not invent native envelope phases');
    await screenshot('cycle2-released');
    checks.push('Cycle2 keyboard A/B map to actual CH7/CH8 with current/history routes; Auto follows the latest polyphonic group, physical inspection preserves ownership and its keyboard target, and released groups remain retained without native envelope claims');

    step('Code logical owner and reordered Custom four/six mappings');
    await page.locator('#stop').click();await waitState(page,state=>state.voiceGroups.length===0&&state.manualVoices.length===0,'Stop clears initial owners');
    await selectChannel(page);
    const custom4={inputs:[[1,2],[3],[3],[]],outputs:[0,2]};
    await code(page,holdSource('fm4',custom4));
    state=await waitState(page,state=>state.codeActive&&state.voiceGroups.some(group=>group.held&&group.owner.channel===3),'logical Code CH4 four OP');
    let group=state.voiceGroups.find(group=>group.held&&group.owner.channel===3);
    assert.deepEqual(group.operatorSlots,[9,8,7,6]);
    view=await waitAllocation(page,group);assertMapping(view,group,[9,8,7,6]);assert.match(view.owner,/Code\s*CH4/i);
    measurements.custom4={group,view};
    await selectOperator(page,1);await number(page,'operatorRatio',1.75);
    state=await waitState(page,state=>state.config.fm.ratios[1]===1.75,'source OP ratio');
    assert.equal((await allocation(page)).selected,'auto','Editing a Source OP keeps Auto selection');
    assert(state.voiceGroups.some(value=>value.id===group.id&&value.held));
    await selectChannel(page,9);view=await waitAllocation(page,group);assertMapping(view,group,[9,8,7,6]);
    const card=await page.locator('#scspSynthAllocationOpA').innerText();
    assert.match(card,/Direct.*3/i);assert.match(card,/MIXS\s*1.*5/i);
    assert.match(await page.locator('#scspSynthAllocationHelp').textContent(),/request/i);
    const session=state.codeSession;
    await physicalNumber(page,'modulation-xOffset',32);await physicalNumber(page,'modulation-yOffset',0);
    state=await waitState(page,state=>state.slots[9].modulation.xOffset===32&&state.slots[9].modulation.yOffset===0,'physical modulation override');
    await until(()=>page.locator('#scspSynthAllocationOpA').evaluate(node=>node.dataset.recipe==='false'),'changed requested modulation falls back to references');
    const overriddenInput=await page.locator('#scspSynthAllocationOpA .scsp-synth-allocation-inputs').textContent();
    assert.match(overriddenInput,/X\s*32\s*\/\s*Y\s*0/i);
    assert(!/→/.test(await page.locator('#scspSynthAllocationConnections p').first().textContent()),'Changed requested fields do not invent an authored producer');
    view=await allocation(page);assert.equal(view.selected,'9');assert.equal(state.codeSession,session);assert(state.codeActive);
    measurements.rawOverride={voice:state.slots[9],view};
    await screenshot('custom4-raw');
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'four OP Code stopped');
    await selectChannel(page);
    const custom6={inputs:[[3,4],[0],[],[5],[2],[]],outputs:[0,1,4]};
    await code(page,holdSource('fm6',custom6,5));
    state=await waitState(page,state=>state.codeActive&&state.voiceGroups.some(group=>group.held&&group.owner.channel===5),'logical Code CH6 six OP');
    group=state.voiceGroups.find(group=>group.held&&group.owner.channel===5);
    assert.deepEqual(group.operatorSlots,[10,11,8,7,9,6]);
    view=await waitAllocation(page,group);assertMapping(view,group,[10,11,8,7,9,6]);assert.match(view.owner,/Code\s*CH6/i);
    assert.equal(view.cards.length,6);measurements.custom6={group,view};
    await screenshot('custom6-desktop');
    await page.setViewportSize({width:390,height:844});
    measurements.custom6MobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert(measurements.custom6MobileOverflow<=1,'Six-operator390px page overflow');
    assert.equal((await allocation(page)).cards.length,6);
    await screenshot('custom6-mobile');await page.setViewportSize({width:1400,height:1050});
    checks.push('Code logical CH4/CH6 show the independently expected reordered Custom4/6 A–F mappings; Source OP ratio edits keep Auto selected, physical modulation overrides fall back to raw references, and physical Direct / requested MIXS send are visible without restarting Code');

    const self4={inputs:[[0],[3],[],[]],outputs:[0,1]};
    await code(page,holdSource('fm4',self4,2),{apply:true});
    state=await waitState(page,state=>state.codeActive&&state.config.mode==='fm4'&&state.voiceGroups.some(value=>value.held&&value.owner.channel===2),'Custom Self Code group');
    group=state.voiceGroups.find(value=>value.held&&value.owner.channel===2);
    view=await waitAllocation(page,group);assertMapping(view,group);
    const selfInputs=await page.locator('#scspSynthAllocationOpA .scsp-synth-allocation-inputs').textContent();
    assert.match(selfInputs,/history 1/i);assert.match(selfInputs,/history 2/i);
    assert.match(view.connections,/A \(CH\d+\) → A \(CH\d+\).*history 1.*history 2/i);
    measurements.self={group,view};
    checks.push('Custom Self describes both distinct history taps and the group mapping while retaining the current Code session');

    step('stolen groups, stale logical lanes and group retirement');
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'six OP Code stopped');
    await selectChannel(page,6);
    const stealSource=`const scsp=await useSoundChip('scsp');
await scsp.setConfig({mode:'fm2',fm:{algorithm:'cycle2',cycle2:{outputs:[1]}}});
for(let channel=0;channel<14;channel++)await scsp.noteOn(channel,48+channel);
liveLoop('allocation-steal',async()=>{await beat(4096);});`;
    await code(page,stealSource);
    state=await waitState(page,state=>state.codeActive&&state.voiceGroups.length===13&&state.voiceGroups.some(group=>group.owner.channel===13),'polyphony steals the oldest pair');
    assert(!state.voiceGroups.some(group=>group.owner.channel===0));
    group=state.voiceGroups.find(group=>group.slots.includes(6));assert.equal(group.owner.channel,13);
    view=await waitAllocation(page,group);assertMapping(view,group);assert.match(view.owner,/Code\s*CH14/i);
    assert(!/Code\s*CH1(?:\D|$)/i.test(view.owner),'Stale logical CH1 is not displayed on stolen slots');
    measurements.stolen={group,view};
    await selectChannel(page);await page.locator('#algorithm').selectOption('chain');
    state=await waitState(page,state=>state.codeActive&&state.voiceGroups.length===0&&state.config.fm.algorithm==='chain','topology edit retires groups while Code continues');
    await until(async()=>!(await allocation(page)).channels.some(channel=>channel.related==='true'&&channel.ownership==='group'),'retired groups clear related highlights');
    assert.equal((await allocation(page)).group,'');
    await page.locator('#stop').click();state=await waitState(page,state=>!state.codeActive&&state.voiceGroups.length===0,'global Stop');
    assert.equal((await allocation(page)).group,'');
    checks.push('Capacity stealing replaces the selected physical pair with logical Code CH14 and removes stale CH1 ownership; topology retirement clears highlights while Code continues, and Stop removes all owners');

    step('desktop / 390px layout and keyboard focus');
    await page.locator('#voiceMode').selectOption('fm2');await page.locator('#algorithm').selectOption('cycle2');
    await waitState(page,state=>state.config.mode==='fm2'&&state.config.fm.algorithm==='cycle2','final Cycle2 configuration accepted');
    assert.equal(await page.locator('#algorithm').evaluate(node=>node===document.activeElement),false);
    await page.keyboard.down('a');state=await waitState(page,state=>state.voiceGroups.some(group=>group.held&&group.owner.kind==='keyboard'),'keyboard focus after route and selector edits');
    group=state.voiceGroups.find(group=>group.held&&group.owner.kind==='keyboard');
    await waitAllocation(page,group);await screenshot('cycle2-desktop');
    await page.setViewportSize({width:390,height:844});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert(overflow<=1,'390px horizontal overflow '+overflow);
    assert(await page.locator('#scspSynthAllocationMapping').isVisible());
    assert(await page.locator('#scspSynthAllocationDiagram').isVisible());
    const clipped=await page.locator('#scspChannelTabs [data-scsp-channel]').evaluateAll(nodes=>nodes.filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>node.textContent));
    assert.deepEqual(clipped,[],'all 33 channel labels fit at 390px');
    view=await waitAllocation(page,group);assertMapping(view,group);measurements.mobile={overflow,view};
    await screenshot('cycle2-mobile');
    await page.keyboard.up('a');await page.locator('#stop').click();
    measurements.stopped=await until(async()=>{const value=await level(page);return value.peak===0?value:false;},'global Stop silence');
    const audited=await graph(page);assert(audited.physicalOutputMuted&&audited.routes>0);assert(audited.rates.every(rate=>rate===48000));
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    checks.push('Keyboard remains playable after route / channel edits; desktop and390px show mappings and diagram with no page overflow or clipped channel labels; Stop is silent and every physical destination remains muted at48kHz');
    return {browser:name,passed:true,rate:48000,checks,measurements,screenshots,graph:audited,errors,missing,externalRequestsBlocked:external};
  } catch(error) {
    await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,stage,checks,measurements,screenshots,errors,missing,externalRequestsBlocked:external,
      error:error.stack,view:await allocation(page).catch(()=>null),graph:await graph(page).catch(()=>null),
      recentCommands:await page.evaluate(()=>__scspAllocationAudit.commands.slice(-25)).catch(()=>null),
      status:await page.locator('#status').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null)};
    throw error;
  } finally {await context.close();await browser.close();}
}

(async()=>{
  const started=Date.now(),results=[];let failure=null;
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.mkdir(config.screenshots,{recursive:true});
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){try{results.push(await exercise(name,origin));}catch(error){results.push(error.receipt??{browser:name,passed:false,error:error.stack});throw error;}}
    assert.deepEqual(sourceErrors,[]);
    for(const [name,record]of served)assert.equal(sha(await fs.readFile(path.join(config.root,name))),record.sha256,'Source changed '+name);
  } catch(error) {failure=error;}
  finally {server.closeIdleConnections?.();server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
  const report={schemaVersion:1,passed:!failure,elapsedSeconds:(Date.now()-started)/1000,root:config.root,entry:config.entry,
    physicalOutputMuted:true,listeningPerformed:false,appSourceInjected:false,results,sourceErrors,assets:Object.fromEntries(served),...(failure?{error:failure.stack}:{})};
  await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  if(failure)throw failure;
  console.log('SCSP Synth slot allocation browser PASS: '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
