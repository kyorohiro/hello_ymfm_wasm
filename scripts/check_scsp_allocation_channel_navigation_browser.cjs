// SPDX-License-Identifier: BSD-3-Clause
// Exercise allocation CH navigation through real UI callbacks and native pointer/keyboard events. Physical output is muted before initialization.
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
  out: path.join(os.tmpdir(), 'scsp-allocation-channel-navigation-browser.json'),
  screenshots: path.join(os.tmpdir(), 'scsp-allocation-channel-navigation-browser'),
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

const link=(page,name='A')=>page.locator('#scspSynthAllocationEdit'+name);
const selected=page=>page.locator('#scspChannelTabs').getAttribute('data-selected');
const canvas=page=>page.locator('#voice canvas').evaluate(async node=>{
  const bytes=node.getContext('2d').getImageData(0,0,node.width,node.height).data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].join(',');
});
const physical=(page,slot)=>page.evaluate(slot=>__scspAllocationAudit.request({method:'readPhysical',args:[slot]}),slot);
async function ticks(page) {
  const log=await page.locator('#synthCodeLog').textContent();
  return Number([...log.matchAll(/navigation-tick\s+(\d+)/g)].at(-1)?.[1]??0);
}
function program(mode='fm2',custom=null,lane=3) {
  const fm=custom?{algorithm:'custom',custom}:{algorithm:'cycle2',cycle2:{outputs:[1]}};
  return `const scsp=await useSoundChip('scsp');\nsetBpm(120);\nawait scsp.setConfig(${JSON.stringify({mode,fm})});\nawait scsp.noteOn(${lane},'D4');\nliveLoop('navigation-progress',async()=>{context.navigationTicks=(context.navigationTicks??0)+1;log('navigation-tick',context.navigationTicks);await beat(.25);});`;
}
async function nativeActivate(page,name,key) {
  await link(page,name).focus();
  await page.keyboard.press(key);
}
async function assertEditor(page,slot) {
  await until(async()=>await selected(page)===String(slot)&&await page.locator('#voice').getAttribute('data-physical-channel')===String(slot),'physical CH'+(slot+1)+' editor');
  assert.equal(await page.locator('#scspChipTab').getAttribute('aria-selected'),'true');
  assert(await page.locator('#scspPhysicalControls').isVisible());
}
async function linkSnapshot(page) {
  return page.locator('#scspSynthSlotAllocation button').evaluateAll(nodes=>nodes.map(node=>({
    id:node.id,tag:node.tagName,type:node.type,slot:node.dataset.allocationSlot,
    label:node.getAttribute('aria-label'),text:node.textContent,disabled:node.disabled,
    visible:!!node.getClientRects().length,focused:node===document.activeElement,
  })));
}

async function exercise(name,origin) {
  const browser=await({chromium,webkit}[name]).launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}: {})});
  const context=await browser.newContext({viewport:{width:1400,height:1050}}),page=await context.newPage();
  page.setDefaultTimeout(20000);
  const errors=[],missing=[],external=[],checks=[],screenshots={},measurements={};
  let stage='cold source navigation';
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
  async function preservesCode(expected,label) {
    const tick=await ticks(page);
    const state=await waitState(page,state=>state.codeActive&&state.codeSession===expected.codeSession,label+' session');
    assert.deepEqual(identity(state),identity(expected),label+' preserves held owners and sounding sample identities');
    await until(async()=>await ticks(page)>tick,label+' progress');
    assert.equal(await page.locator('#synthCodeError').textContent(),'');
    return state;
  }
  async function clickWithoutWrites(operator,slot,state) {
    const before=await mutations(page);
    assert.equal(await link(page,operator).getAttribute('data-allocation-slot'),String(slot));
    await link(page,operator).click();
    await assertEditor(page,slot);
    assert.equal(await mutations(page),before,'CH link posts no mutations');
    assert(await link(page,operator).evaluate(node=>node!==document.activeElement),'Pointer navigation releases button focus for musical keys');
    if(state)assert.deepEqual(identity(await inspect(page)),identity(state),'CH navigation preserves the current owner and PCM');
  }
  try {
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('#scspChannelTabs [data-scsp-channel]').length===33);
    await page.locator('#scspSynthSlotAllocation').waitFor({state:'visible'});
    assert.equal((await graph(page)).contexts,0);
    const coldLinks=await linkSnapshot(page),cold=coldLinks.find(value=>value.visible);
    assert.equal(cold.tag,'BUTTON');assert.equal(cold.type,'button');assert.equal(cold.slot,'0');
    assert.match(cold.label,/Edit physical CH1.*operator A/i);assert.equal(cold.disabled,false);
    await clickWithoutWrites('A',0);
    assert.equal((await graph(page)).contexts,0,'Cold navigation acquires no audio');
    assert.equal(await mutations(page),0,'Cold navigation posts no writes');
    measurements.cold={links:coldLinks,graph:await graph(page)};
    checks.push('Cold Source A is a labelled native CH1 button; pointer activation opens the existing physical editor, releases focus, and acquires no audio or writes');

    step('changed source mapping during a pointer gesture');
    await selectChannel(page);await page.locator('#voiceMode').selectOption('fm2');
    await selectOperator(page,0);await link(page,'A').scrollIntoViewIfNeeded();
    const oldBox=await link(page,'A').boundingBox();
    await page.mouse.move(oldBox.x+oldBox.width/2,oldBox.y+oldBox.height/2);await page.mouse.down();
    // A native keyboard action changes the source target while the pointer remains held.
    await page.locator('button[data-operator="1"]').focus();await page.keyboard.press('Enter');
    await until(async()=>await link(page,'A').getAttribute('data-allocation-slot')==='1','Source B replaces the same stable card');
    await link(page,'A').scrollIntoViewIfNeeded();const newBox=await link(page,'A').boundingBox();
    await page.mouse.move(newBox.x+newBox.width/2,newBox.y+newBox.height/2);await page.mouse.up();
    assert.equal(await selected(page),'auto','A stale press never navigates to the new source target');
    assert.equal((await graph(page)).contexts,0);assert.equal(await mutations(page),0);
    await selectOperator(page,0);
    checks.push('A real held pointer press is invalidated when the stable card changes from Source A / CH1 to Source B / CH2; release does not navigate to its replacement');

    step('running Code Cycle2 B to physical CH8');
    await code(page,program());
    let state=await waitState(page,state=>state.codeActive&&state.voiceGroups.some(group=>group.held&&group.owner.channel===3),'Code CH4 Cycle2 allocation');
    let group=state.voiceGroups.find(group=>group.held&&group.owner.channel===3);
    assert.deepEqual(group.operatorSlots,[6,7]);await waitAllocation(page,group);
    const sourceOperator=await page.locator('button[data-operator][aria-pressed="true"]').getAttribute('data-operator');
    const currentIdentity=identity(state);
    await clickWithoutWrites('B',7,state);
    assert.equal(await page.locator('button[data-operator][aria-pressed="true"]').getAttribute('data-operator'),sourceOperator,'Navigation keeps the Source operator selection');
    state=await preservesCode(state,'Cycle2 CH8 navigation');
    measurements.cycle2={mapping:group.operatorSlots,identity:currentIdentity,links:await linkSnapshot(page)};
    measurements.cycle2Output=await until(async()=>{const output=await level(page);return output.peak>1e-5?output:false;},'finite Code output before permanent mute');
    await screenshot('cycle2-ch8');
    checks.push('Running Cycle2 Code logical CH4 maps B to actual physical CH8; the link selects that existing editor without source-operator changes, owner/sample changes, writes, or a Code restart, and progress continues');

    step('unapplied Auto PCM draft survives physical CH shortcut');
    await selectChannel(page);
    const autoBefore=await canvas(page),autoVoice=await physical(page,0),autoState=await inspect(page);
    const autoCanvas=page.locator('#voice canvas');await autoCanvas.scrollIntoViewIfNeeded();
    const autoBounds=await autoCanvas.boundingBox();
    await page.mouse.move(autoBounds.x+12,autoBounds.y+20);await page.mouse.down();
    await page.mouse.move(autoBounds.x+autoBounds.width/2,autoBounds.y+autoBounds.height-20,{steps:8});await page.mouse.up();
    const autoDraft=await canvas(page);assert.notEqual(autoDraft,autoBefore);
    assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
    await clickWithoutWrites('B',7,autoState);await selectChannel(page);
    assert.equal(await canvas(page),autoDraft,'Auto waveform draft returns after the physical shortcut');
    assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
    assert.deepEqual(await physical(page,0),autoVoice,'CH navigation never applies the Auto source draft');
    await clickWithoutWrites('B',7,autoState);state=await preservesCode(autoState,'Auto PCM draft roundtrip');
    measurements.autoDraft={before:autoBefore,draft:autoDraft,source:0};
    checks.push('An unapplied Auto source PCM drawing survives the physical CH8 shortcut and Auto return exactly; navigation never applies it or changes the running Code owner / sounding samples');

    step('Envelope and LFO edit the selected physical CH while Code continues');
    const beforeEdits=await inspect(page),beforeVoice=await physical(page,7);
    await physicalNumber(page,'attackRate',17);
    await control(page,'lfo-frequencyCode').selectOption('12');
    await control(page,'lfo-pitchDepth').selectOption('1');
    state=await waitState(page,state=>state.slots[7].envelope.attackRate===17&&state.slots[7].lfo.frequencyCode===12&&state.slots[7].lfo.pitchDepth===1,'physical CH8 Envelope / LFO edits');
    for(let slot=0;slot<32;slot++)if(slot!==7)assert.deepEqual(state.slots[slot],beforeEdits.slots[slot],'Only selected physical CH8 changes, slot '+slot);
    await preservesCode(state,'physical Envelope / LFO edits');
    assert.deepEqual(identity(state),identity(beforeEdits));
    measurements.physicalEdit={before:beforeVoice,after:await physical(page,7)};
    checks.push('Real Envelope attack and LFO controls edit physical CH8 only; all other slots, source templates, held groups, sounding samples and the advancing Code session remain intact');

    step('physical PCM drawing survives CH navigation; Apply retains held PCM');
    const appliedCanvas=await canvas(page),beforeDraft=await physical(page,7),beforeDrawingState=await inspect(page);
    const sourceCanvas=page.locator('#voice canvas');await sourceCanvas.scrollIntoViewIfNeeded();
    const bounds=await sourceCanvas.boundingBox();
    await page.mouse.move(bounds.x+12,bounds.y+20);await page.mouse.down();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height-20,{steps:8});await page.mouse.up();
    assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
    const draftCanvas=await canvas(page);assert.notEqual(draftCanvas,appliedCanvas);
    assert.deepEqual(await physical(page,7),beforeDraft,'Drawing remains an unapplied local draft');
    await clickWithoutWrites('A',6,beforeDrawingState);
    await clickWithoutWrites('B',7,beforeDrawingState);
    assert.equal(await canvas(page),draftCanvas,'Returning through CH links restores the exact physical draft');
    assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
    assert.deepEqual(await physical(page,7),beforeDraft,'Navigation never applies the draft');
    await page.locator('[data-chip-action="scsp-apply"]').click();
    await until(()=>page.locator('[data-chip-action="scsp-apply"]').isDisabled(),'physical PCM draft applied');
    state=await inspect(page);
    const afterDraft=await physical(page,7);
    assert.notDeepEqual(afterDraft.pcm,beforeDraft.pcm,'Apply changes the selected editing PCM');
    assert.deepEqual(state.playingSampleIds,beforeDrawingState.playingSampleIds,'Held notes retain their sounding PCM identity after Apply');
    assert.deepEqual(state.voiceGroups,beforeDrawingState.voiceGroups,'Apply retains current Code held groups');
    assert.equal(state.codeSession,beforeDrawingState.codeSession);assert(state.codeActive);
    await preservesCode(state,'PCM draft Apply');
    measurements.pcmDraft={appliedCanvas,draftCanvas,restoredCanvas:await canvas(page),heldSampleIds:state.playingSampleIds,oldEditingSample:beforeDraft.sample,newEditingSample:afterDraft.sample};
    checks.push('An actual PCM pointer drawing stays unapplied during A/B CH navigation and restores exactly on return; Apply changes editing PCM for new notes while existing Code groups keep their sounding sample identities');

    step('DSP to SCSP same-selected navigation and native keyboard focus');
    await page.locator('#scspDspTab').click();assert(await page.locator('#scspDspPanel').isVisible());
    const beforeDsp=await inspect(page);await clickWithoutWrites('B',7,beforeDsp);
    assert(await page.locator('#scspChipPanel').isVisible());
    await page.locator('#scspSynthAllocationHelp > summary').click();
    const beforeKeyboard=await inspect(page),beforeKeyboardWrites=await mutations(page);
    for(const [operator,slot,key]of [['A',6,'Enter'],['B',7,'Space']]) {
      await nativeActivate(page,operator,key);await assertEditor(page,slot);
      await page.waitForTimeout(450);
      assert(await link(page,operator).evaluate(node=>node===document.activeElement),'Native '+key+' retains link focus across polling');
      assert(await page.locator('#scspSynthAllocationHelp').evaluate(node=>node.open),'Polling preserves open help');
      assert.equal(await mutations(page),beforeKeyboardWrites);
    }
    await preservesCode(beforeKeyboard,'native Enter / Space navigation');
    await screenshot('keyboard-focus');
    await page.locator('#scspSynthAllocationHelp > summary').click();
    // Pointer activation must leave musical letter keys available to the existing physical target.
    await link(page,'B').click();await page.keyboard.down('a');
    state=await waitState(page,state=>state.codeActive&&state.manualVoices.some(voice=>voice.slot===7&&voice.held),'musical key after pointer CH activation');
    await page.keyboard.up('a');
    await waitState(page,state=>state.manualVoices.every(voice=>voice.slot!==7||!voice.held),'physical musical key released');
    measurements.keyboard={links:await linkSnapshot(page),selected:await selected(page),codeSession:state.codeSession};
    checks.push('The same-selected CH8 link switches DSP back to SCSP; native Enter / Space retain button focus and open help through polling, pointer clicks release focus and subsequent musical keys use physical CH8 while Code stays active');

    step('same physical CH remains clickable across rapid Code retriggers');
    await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,'previous fixed-held Code stopped');
    await selectChannel(page);
    await code(page,`const scsp=await useSoundChip('scsp');\nsetBpm(120);\nawait scsp.setConfig({mode:'fm2',fm:{algorithm:'cycle2',cycle2:{outputs:[1]}}});\nliveLoop('navigation-retrigger',async()=>{context.navigationTicks=(context.navigationTicks??0)+1;await scsp.noteOn(3,context.navigationTicks%2?'D4':'E4');log('navigation-tick',context.navigationTicks);await beat(.25);});`);
    state=await waitState(page,state=>state.codeActive&&state.voiceGroups.some(group=>group.held&&group.owner.channel===3),'rapid Code Cycle2 group');
    group=state.voiceGroups.find(group=>group.held&&group.owner.channel===3);await waitAllocation(page,group);
    assert.deepEqual(group.operatorSlots,[6,7]);
    await link(page,'B').scrollIntoViewIfNeeded();const rapidBox=await link(page,'B').boundingBox();
    await page.mouse.move(rapidBox.x+rapidBox.width/2,rapidBox.y+rapidBox.height/2);await page.mouse.down();
    const atPress=await inspect(page),order=atPress.voiceGroups.find(group=>group.owner.channel===3).order;
    const retriggered=await waitState(page,state=>state.codeActive&&state.voiceGroups.some(group=>group.owner.channel===3&&group.order>order),'Code retriggers while CH8 pointer held');
    await page.waitForTimeout(180);
    assert.equal(await link(page,'B').getAttribute('data-allocation-slot'),'7');
    await page.mouse.up();await assertEditor(page,7);
    const afterRapid=await inspect(page);assert.equal(afterRapid.codeSession,atPress.codeSession);assert(afterRapid.codeActive);
    assert.deepEqual(afterRapid.voiceGroups.find(group=>group.owner.channel===3).operatorSlots,[6,7]);
    assert(await link(page,'B').evaluate(node=>node!==document.activeElement));
    measurements.sameSlotRetrigger={session:afterRapid.codeSession,pressedOrder:order,retriggeredOrder:retriggered.voiceGroups.find(group=>group.owner.channel===3).order,selected:await selected(page)};
    checks.push('A native pointer press held through multiple live Code retriggers still opens physical CH8 when its address remains unchanged; Code keeps the same running session and pointer focus releases');

    step('reordered Custom4 and Custom6 physical link mapping');
    for(const {mode,custom,lane,expected}of [
      {mode:'fm4',custom:{inputs:[[1,2],[3],[3],[]],outputs:[0,2]},lane:3,expected:[9,8,7,6]},
      {mode:'fm6',custom:{inputs:[[3,4],[0],[],[5],[2],[]],outputs:[0,1,4]},lane:5,expected:[10,11,8,7,9,6]},
    ]) {
      await page.locator('#synthCodeStopButton').click();await waitState(page,state=>!state.codeActive,mode+' previous Code stopped');
      await selectChannel(page);await code(page,program(mode,custom,lane));
      state=await waitState(page,state=>state.codeActive&&state.voiceGroups.some(group=>group.held&&group.owner.channel===lane),mode+' held allocation');
      group=state.voiceGroups.find(group=>group.held&&group.owner.channel===lane);
      assert.deepEqual(group.operatorSlots,expected);await waitAllocation(page,group);
      for(let index=0;index<expected.length;index++) {
        const operator='ABCDEF'[index];
        assert.match(await link(page,operator).getAttribute('aria-label'),new RegExp('Edit physical CH'+(expected[index]+1)+' \\(operator '+operator+'\\)'));
        await clickWithoutWrites(operator,expected[index],state);
      }
      await preservesCode(state,mode+' reordered links');
      measurements[mode]={mapping:expected,links:await linkSnapshot(page),codeSession:state.codeSession};
      await screenshot(mode+'-desktop');
    }
    checks.push('Independently expected reordered Custom4 [CH10, CH9, CH8, CH7] and Custom6 [CH11, CH12, CH9, CH8, CH10, CH7] links all navigate to their physical editor with no selection mutations or session/owner changes');

    step('390px native button layout');
    await page.setViewportSize({width:390,height:844});
    const narrow=await page.locator('#scspSynthAllocationDiagram').evaluate(node=>({
      overflow:document.documentElement.scrollWidth-innerWidth,
      buttons:[...node.querySelectorAll('button')].filter(button=>!!button.getClientRects().length).map(button=>({
        id:button.id,text:button.textContent,width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height,
        clipped:button.scrollWidth>button.clientWidth+1,
      })),
    }));
    assert(narrow.overflow<=1,'390px page overflow');assert.equal(narrow.buttons.length,6);
    assert(narrow.buttons.every(button=>!button.clipped&&button.width>=36&&button.height>=28),'All six native CH buttons fit and remain usable at390px');
    await clickWithoutWrites('D',7,state);await screenshot('custom6-mobile');measurements.narrow=narrow;
    await page.setViewportSize({width:1400,height:1050});
    checks.push('All six physical CH buttons remain visible, readable and clickable at390px without horizontal page overflow; narrow activation still selects the mapped editor');

    step('Stop retires unavailable member links');
    await page.locator('#stop').click();
    await waitState(page,state=>!state.codeActive&&state.voiceGroups.length===0,'global Stop clears Code groups');
    await selectChannel(page);
    const stoppedLinks=await linkSnapshot(page);
    assert(stoppedLinks.filter(value=>!value.visible).every(value=>value.disabled),'Unavailable hidden member buttons are disabled after Stop');
    const beforeUnavailable=await mutations(page);
    await link(page,'F').evaluate(node=>node.click());
    assert.equal(await selected(page),'auto');assert.equal(await mutations(page),beforeUnavailable);
    measurements.stoppedLinks=stoppedLinks;
    checks.push('Global Stop retires Code groups, disables unavailable member buttons and leaves a stale hidden member activation inert');

    step('native touch navigation and coarse-pointer layout');
    const touchContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
    try {
      await touchContext.addInitScript(installSilentAudit);
      await touchContext.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
      const touchPage=await touchContext.newPage();
      touchPage.on('pageerror',error=>errors.push('touch: '+error.message));
      touchPage.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status(),touch:true});});
      await touchPage.goto(origin+config.entry);
      await link(touchPage,'A').waitFor({state:'visible'});
      await link(touchPage,'A').tap();await assertEditor(touchPage,0);
      assert(await link(touchPage,'A').evaluate(node=>node!==document.activeElement),'Touch releases link focus');
      assert.equal((await graph(touchPage)).contexts,0);assert.equal(await mutations(touchPage),0);
      const touchSize=await link(touchPage,'A').evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,coarse:matchMedia('(pointer:coarse)').matches,overflow:document.documentElement.scrollWidth-innerWidth}));
      assert(touchSize.coarse&&touchSize.width>=44&&touchSize.height>=44&&touchSize.overflow<=1,'Touch CH link has a44px target without narrow overflow');
      measurements.touch={...touchSize,graph:await graph(touchPage)};
      const filename=path.join(config.screenshots,name+'-touch.png');
      await touchPage.locator('.scsp-channel-overview').screenshot({path:filename});screenshots.touch=filename;
    } finally {await touchContext.close();}
    checks.push('A native touch tap at390px opens physical CH1, releases focus and acquires no audio/writes; coarse-pointer CH targets are at least44×44px without page overflow');

    step('disposed view disables every link');
    const finalGraph=await graph(page);assert(finalGraph.physicalOutputMuted&&finalGraph.routes>0);assert(finalGraph.rates.every(rate=>rate===48000));
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
    await until(async()=>(await linkSnapshot(page)).every(value=>value.disabled),'disposed links disabled');
    await link(page,'A').evaluate(node=>node.click());
    assert.equal(await page.locator('#scspChannelTabs [data-scsp-channel]').count(),0,'Disposed selector is not revived');
    measurements.disposedLinks=await linkSnapshot(page);
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    checks.push('A terminal pagehide uses the real production disposal path: every retained CH button disables, stale activation does not revive the selector, and all physical output routes remain muted at48kHz');
    return {browser:name,passed:true,rate:48000,checks,measurements,screenshots,graph:finalGraph,errors,missing,externalRequestsBlocked:external};
  } catch(error) {
    await page.screenshot({path:path.join(config.screenshots,name+'-failure.png'),fullPage:true}).catch(()=>{});
    error.receipt={browser:name,passed:false,stage,checks,measurements,screenshots,errors,missing,externalRequestsBlocked:external,
      error:error.stack,view:await allocation(page).catch(()=>null),links:await linkSnapshot(page).catch(()=>null),graph:await graph(page).catch(()=>null),
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
    physicalOutputMuted:true,listeningPerformed:false,appSourceInjected:false,
    setup:'Code programs entered through the real textarea / Run controls; read-only authoring and physical inspector port requests; production pagehide event for terminal lifecycle verification',
    results,sourceErrors,assets:Object.fromEntries(served),...(failure?{error:failure.stack}:{})};
  await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');
  if(failure)throw failure;
  console.log('SCSP allocation CH navigation browser PASS: '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});

