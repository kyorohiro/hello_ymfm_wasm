// SPDX-License-Identifier: BSD-3-Clause
// Real source/ZIP workspace checks; every speaker connection is muted before boot.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const {selectHucChannel}=require('./huc6280_channel_browser_helpers.cjs');
const repo=path.resolve(__dirname,'..');
const config={root:path.join(repo,'docs'),entry:'/synth-huc6280/index.html',engines:'chromium,webkit',editor:'fallback',
  out:path.join(tmpdir(),'huc6280-code-workspace.json'),screenshots:path.join(tmpdir(),'huc6280-code-workspace')};
for(const arg of process.argv.slice(2)){
  const match=/^--(root|entry|engines|editor|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
assert(['fallback','monaco'].includes(config.editor));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=value=>createHash('sha256').update(value).digest('hex'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(35);}throw Error('Timeout: '+label);}
const served=new Map(),missing=[],external=[],cdn=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml'};
const isMonaco=url=>url.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/');
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const filename=path.resolve(config.root,'.'+pathname);assert(filename.startsWith(config.root+path.sep));
    const data=await fs.readFile(filename),name=path.relative(config.root,filename),record={bytes:data.length,sha256:hash(data)};
    if(served.has(name))assert.deepEqual(served.get(name),record,'Asset changed during verification');served.set(name,record);
    response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(data);
  }catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
const CODE='/index.js',SONG='/vgm/workspace.vgm',DB='tetorica-huc6280-synth-files';
const TAB_IDS=['synthInputCodeTab','huc6280ChipTab','msm5205ChipTab','cddaChipTab','mixerChipTab','synthInputKeyboardTab'];
const HOLD=`const pce = await useSoundChip('huc6280');
context.starts = (context.starts ?? 0) + 1;
const prepared = await livePrepare('workspace-motion', () => ({visits: 0}));
globalThis.__hucWorkspaceProbe = {pce, context, prepared, ticks: 0};
await pce.noteOn(CH1, 'A3');
liveLoop('workspace-motion', async () => {
  __hucWorkspaceProbe.ticks++;
  prepared.visits++;
  await beat(0.05);
});
`;
function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect;
  const contexts=[],nodes=[],meters=[],commands=[],rejections=[];let serial=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});
    const post=this.port.postMessage.bind(this.port);this.port.postMessage=(data,...rest)=>{commands.push({name,method:data?.method??data?.action?.type,args:data?.method==='noteOn'?data.args:null});return post(data,...rest);};}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
  };
  window.addEventListener('unhandledrejection',event=>rejections.push(String(event.reason?.stack??event.reason)));
  function sample({analyser,mute}){
    const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0,finite=true;const crossings=[];
    for(let i=0;i<values.length;i++){sum+=values[i];square+=values[i]*values[i];peak=Math.max(peak,Math.abs(values[i]));finite&&=Number.isFinite(values[i]);if(i&&values[i-1]<=0&&values[i]>0)crossings.push(i);}
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2)),peak,finite,muted:mute.gain.value===0,
      frequency:crossings.length>2?analyser.context.sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]):0};
  }
  async function read(name='tetorica-huc6280-synth',method='read'){
    const node=nodes.findLast(item=>item.name===name)?.node;if(!node)throw Error('Worklet missing: '+name);const id=--serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Worklet read timeout'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage(name==='tetorica-huc6280-synth'?{id,method,args:[]}:{id,action:{type:'state'}});
    });
  }
  window.__hucWorkspaceAudit={read,output:()=>meters.map(sample).sort((a,b)=>b.acRms-a.acRms)[0]??null,
    commands:()=>commands.slice(),state:()=>({contexts:contexts.length,nodes:nodes.map(item=>item.name),
      mediaLoads:commands.filter(item=>['prepare','loadPreset'].includes(item.method)).map(item=>({name:item.name,method:item.method})),
      physicallyMuted:meters.every(item=>item.mute.gain.value===0),rejections:rejections.slice()})};
}
async function draft(page){return page.evaluate(name=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');
    tx.oncomplete=()=>{db.close();resolve(read.result??null);};tx.onabort=()=>{db.close();reject(tx.error??read.error);};};
}),DB);}
const fileText=(snapshot,version)=>{const value=snapshot?.workspace?.[version]?.files.find(file=>file.path===CODE)?.data;return typeof value==='string'?value:value?Buffer.from(value).toString('utf8'):null;};
async function check(browser,name,origin,fixture){
  const context=await browser.newContext({viewport:{width:1360,height:1050},serviceWorkers:'block'}),page=await context.newPage();
  const checks=[],measurements={layouts:[]},errors=[],rawConsoleErrors=[],consoleErrors=[],expectedConsoleErrors=[],cdnFailures=[],abortedMonaco=new Set();
  page.setDefaultTimeout(25000);await context.addInitScript(installAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error')rawConsoleErrors.push({text:message.text(),location:message.location()});});
  function classifyErrors(){consoleErrors.length=0;expectedConsoleErrors.length=0;for(const error of rawConsoleErrors){
    const expected=config.editor==='fallback'&&isMonaco(error.location.url)&&abortedMonaco.has(error.location.url)&&/^Failed to load resource(?::|$)/i.test(error.text);
    (expected?expectedConsoleErrors:consoleErrors).push(error);
  }}
  page.on('requestfailed',request=>{if(isMonaco(request.url()))cdnFailures.push(request.url());});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    if(isMonaco(url.href)){cdn.push(url.href);if(config.editor==='monaco')return route.continue();abortedMonaco.add(url.href);return route.abort();}
    external.push(url.href);return route.abort();});
  const step=message=>{checks.push(message);console.log(`CHECK ${name}/${config.editor}: ${message}`);};
  const ready=()=>until(()=>page.locator('#hucFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');
  const expanded=()=>page.locator('#synthWorkspace').evaluate(node=>node.classList.contains('is-code-expanded'));
  const read=(method='read')=>page.evaluate(method=>__hucWorkspaceAudit.read('tetorica-huc6280-synth',method),method);
  const audit=()=>page.evaluate(()=>__hucWorkspaceAudit.state());
  const currentSource=()=>page.evaluate(()=>window.monaco?.editor?.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))?.getValue()??document.getElementById('synthCodeEditor').value);
  async function setSource(value){
    if(config.editor==='fallback')await page.locator('#synthCodeEditor').fill(value);else await page.evaluate(value=>monaco.editor.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).setValue(value),value);
    assert.equal(await currentSource(),value);
  }
  async function editorReady(){
    await until(()=>page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))||/Fallback|unavailable|could not load/i.test(document.getElementById('synthCodeEditorNote').textContent)),'Editor initialization',60000);
    const actual=await page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))));
    if(config.editor==='monaco'&&!actual){const error=Error('Real Monaco unavailable');error.cdnUnavailable=cdnFailures.length>0;throw error;}assert.equal(actual,config.editor==='monaco');
  }
  async function openFiles(value=true){if(await page.locator('#hucFilesPanel').isVisible()!==value)await page.locator('#hucFilesToggle').click();}
  async function choose(id){await page.locator('#'+id).click();await until(()=>page.locator('#'+id).getAttribute('aria-selected').then(value=>value==='true'),'Selected tab '+id);}
  async function assertTabs(selected){
    const state=await page.evaluate(ids=>{const nodes=ids.map(id=>document.getElementById(id)),list=nodes[0].parentElement;return{
      ids:Array.from(list.querySelectorAll(':scope > [role="tab"]')).map(node=>node.id),selected:nodes.filter(node=>node.getAttribute('aria-selected')==='true').map(node=>node.id),
      tabbable:nodes.filter(node=>node.tabIndex===0).map(node=>node.id),parents:nodes.map(node=>node.parentElement===list),code:document.getElementById('synthWorkspaceCodeButton').getAttribute('aria-pressed'),synth:document.getElementById('synthWorkspaceSynthButton').getAttribute('aria-pressed')};},TAB_IDS);
    assert.deepEqual(state.ids,TAB_IDS);assert.deepEqual(state.selected,[selected]);assert.deepEqual(state.tabbable,[selected]);assert(state.parents.every(Boolean));assert.equal(state.code,'true');assert.equal(state.synth,'false');assert(await expanded());
  }
  async function save(shortcut='Control+s'){
    await page.keyboard.press(shortcut);await ready();await until(()=>draft(page).then(value=>fileText(value,'working')===fileText(value,'saved')),'Saved source');
  }
  async function running(){
    const before=await page.evaluate(()=>__hucWorkspaceProbe.ticks);await pause(90);assert((await page.evaluate(()=>__hucWorkspaceProbe.ticks))>before);
    assert(await page.evaluate(()=>__hucWorkspaceProbe===__hucWorkspaceIdentity&&__hucWorkspaceProbe.context===__hucWorkspaceIdentity.context&&__hucWorkspaceProbe.prepared===__hucWorkspaceIdentity.prepared));
    assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
  }
  async function snapshotLayout(label,width){
    await page.setViewportSize({width,height:1050});await pause(650);
    const inspect=()=>page.evaluate(()=>({viewport:innerWidth,elements:['body','main','#synthWorkspace','#hucSynthMain','#hucSynthEditor','#hucFilesPanel','#synthExpandedTabsSlot','#synthExpandedCodeSlot','#synthCodePanel','#synthCodeEditorHost'].flatMap(selector=>{
      const node=document.querySelector(selector),r=node?.getBoundingClientRect();return r?.width&&r.height?[{selector,width:r.width,left:r.left,right:r.right,client:node.clientWidth,scroll:node.scrollWidth}]:[];
    }),monaco:window.monaco?.editor?.getEditors().filter(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).map(editor=>({width:editor.getLayoutInfo().width,height:editor.getLayoutInfo().height}))??[]}));
    const check=value=>{for(const element of value.elements){assert(element.left>=-1&&element.right<=width+1,label+' viewport '+JSON.stringify(element));
      if(['body','main','#synthWorkspace','#hucSynthMain'].includes(element.selector))assert(element.scroll<=element.client+1,label+' unmasked overflow '+JSON.stringify(element));}
      if(config.editor==='monaco'&&codeVisible)for(const item of value.monaco)assert(item.width>100&&item.height>100,label+' nonzero Monaco');};
    const codeVisible=await page.locator('#synthCodePanel').isVisible();
    const before=await inspect();check(before);const filename=path.join(config.screenshots,`${name}-${config.editor}-${label}-${width}.png`);await page.screenshot({path:filename,fullPage:true});await pause(50);const after=await inspect();check(after);
    measurements.layouts.push({filename,before,after});
  }
  async function expectSameGraph(before){const after=await audit();assert.equal(after.contexts,before.contexts);assert.deepEqual(after.nodes,before.nodes);assert.deepEqual(after.mediaLoads,before.mediaLoads);return after;}
  async function returnCode(){await choose('synthInputCodeTab');await editorReady();}
  async function stopCode(){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Stopped Code');}
  try{
    await page.goto(origin+config.entry);await ready();await openFiles();
    await page.locator('#hucProjectFileInput').setInputFiles({name:'workspace.cassette.zip',mimeType:'application/zip',buffer:fixture.cassette});await ready();
    await until(()=>draft(page).then(value=>fileText(value,'working')===HOLD),'Imported workspace');
    await page.locator('#synthWorkspaceCodeButton').click();await editorReady();await assertTabs('synthInputCodeTab');
    assert.equal(await page.locator('#hucFilesPanel').isVisible(),true);assert.equal((await audit()).contexts,0,'Opening layout does not start audio');
    const initialGraph=await audit();
    await page.evaluate(()=>{globalThis.__hucWorkspaceDom={input:document.getElementById('masterVolume'),code:document.getElementById('synthCodeEditor'),host:document.getElementById('synthCodeEditorHost'),
      editor:window.monaco?.editor?.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))??null};if(__hucWorkspaceDom.editor)__hucWorkspaceDom.model=__hucWorkspaceDom.editor.getModel();});
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);assert(await page.locator('#masterVolume').isVisible());assert(await page.locator('#synthCodeRunButton').isVisible());}
    await expectSameGraph(initialGraph);step('Header Code opens one persistent six-tab workspace without opening audio; original Master and transport remain accessible');

    // Expanded keyboard navigation must intercept the original four-chip handler.
    await returnCode();await page.locator('#synthInputCodeTab').focus();
    for(let i=0;i<TAB_IDS.length;i++){const id=TAB_IDS[(i+1)%TAB_IDS.length];await page.keyboard.press('ArrowRight');await until(()=>page.locator('#'+id).getAttribute('aria-selected').then(value=>value==='true'),'Arrow selects '+id);await until(()=>page.evaluate(id=>document.activeElement?.id===id,id),'Arrow focus '+id);await assertTabs(id);}
    await page.keyboard.press('End');await until(()=>page.locator('#synthInputKeyboardTab').getAttribute('aria-selected').then(value=>value==='true'),'End selects Keyboard');await assertTabs('synthInputKeyboardTab');await page.keyboard.press('Home');await until(()=>page.locator('#synthInputCodeTab').getAttribute('aria-selected').then(value=>value==='true'),'Home selects Code');await assertTabs('synthInputCodeTab');
    await page.locator('#synthWorkspaceSynthButton').click();assert.equal(await expanded(),false);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'code');
    assert.equal(await page.locator('#synthWorkspaceSynthButton').getAttribute('aria-pressed'),'true');
    await page.locator('#synthCodeExpandButton').click();await assertTabs('synthInputCodeTab');
    await choose('synthInputKeyboardTab');await page.locator('#synthCodeExpandButton').click();assert.equal(await expanded(),false);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
    await page.locator('#synthWorkspaceCodeButton').click();await assertTabs('synthInputCodeTab');step('One tablist supports arrows, Home/End and focus; header or restore preserves the input mode and restores the original controls');

    await openFiles();await page.locator('#hucAutoApplyToggle').uncheck();await ready();await until(()=>draft(page).then(value=>value?.workspace?.autoSave===false),'Manual mode');
    const pending=HOLD+'\n// Pending layout draft; Save never runs it.\n';await setSource(pending);
    await until(()=>draft(page).then(value=>fileText(value,'working')===pending&&fileText(value,'saved')===HOLD),'Unsaved Code durable');
    for(const id of TAB_IDS){await choose(id);assert.equal(await currentSource(),pending);assert(await page.locator('#hucFilesTree [data-file-path="/index.js"] .huc-file-unsaved').count());}
    await returnCode();assert(await page.evaluate(()=>document.getElementById('masterVolume')===__hucWorkspaceDom.input&&document.getElementById('synthCodeEditor')===__hucWorkspaceDom.code&&document.getElementById('synthCodeEditorHost')===__hucWorkspaceDom.host&&
      (!__hucWorkspaceDom.editor||__hucWorkspaceDom.editor===monaco.editor.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))&&__hucWorkspaceDom.editor.getModel()===__hucWorkspaceDom.model)));
    await page.locator('#synthCodeRunButton').click();await until(()=>page.evaluate(()=>Boolean(globalThis.__hucWorkspaceProbe)),'Code runs saved source');
    await page.evaluate(()=>globalThis.__hucWorkspaceIdentity=__hucWorkspaceProbe);await running();
    await save('Control+s');assert.equal(await currentSource(),pending);assert.equal(await page.evaluate(()=>__hucWorkspaceProbe.context.starts),1);
    await setSource(pending+'// Cmd save\n');await choose('mixerChipTab');await save('Meta+s');await running();await returnCode();
    step('Layout changes retain the same working/saved text and Monaco model; Ctrl/Cmd+S works across views without executing or restarting Code');

    await choose('huc6280ChipTab');await selectHucChannel(page,2);const channel=await page.locator('#hucChannelSelect').inputValue(),state=await read('observeCode'),graph=await audit();
    measurements.initialOutput=await page.evaluate(()=>__hucWorkspaceAudit.output());assert(measurements.initialOutput?.finite&&measurements.initialOutput.muted&&measurements.initialOutput.acRms>1e-5);
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);await running();assert.equal(await page.locator('#hucChannelSelect').inputValue(),channel);
      const current=await read('observeCode');assert.deepEqual(current.registers,state.registers);assert.deepEqual(current.waveforms,state.waveforms);await expectSameGraph(graph);}
    measurements.afterTabs=await page.evaluate(()=>__hucWorkspaceAudit.output());assert(Math.abs(measurements.afterTabs.acRms/measurements.initialOutput.acRms-1)<.08);
    await returnCode();await page.locator('#masterVolume').evaluate(node=>{node.value='1.75';node.dispatchEvent(new Event('input',{bubbles:true}));});
    await until(()=>page.locator('#masterVolumeValue').textContent().then(value=>value==='175%'),'Master accepts boost');assert.equal(await page.locator('#masterVolume').getAttribute('data-boosted'),'true');
    assert(await page.evaluate(()=>document.getElementById('masterVolume')===__hucWorkspaceDom.input));
    measurements.boosted=await page.evaluate(()=>__hucWorkspaceAudit.output());await pause(220);measurements.boosted=await page.evaluate(()=>__hucWorkspaceAudit.output());assert(measurements.boosted.acRms>measurements.afterTabs.acRms*1.7);
    await page.locator('#masterVolume').evaluate(node=>{node.value='.7';node.dispatchEvent(new Event('input',{bubbles:true}));});await running();
    step('All six tabs keep selected CH, registers, wave RAM, held PCM, loop/context/livePrepare identities and the original graph; Master boost remains live');

    await choose('huc6280ChipTab');await page.locator('#huc6280ChipTab').focus();const start=(await page.evaluate(()=>__hucWorkspaceAudit.commands())).length;
    await page.keyboard.down('a');await until(()=>page.evaluate(start=>__hucWorkspaceAudit.commands().slice(start).some(item=>item.method==='noteOn'&&item.args?.[2]===2),start),'Physical CH keyboard note');await page.keyboard.up('a');await running();
    await returnCode();const beforeType=(await page.evaluate(()=>__hucWorkspaceAudit.commands())).filter(item=>item.method==='noteOn').length;
    if(config.editor==='fallback')await page.locator('#synthCodeEditor').focus();else await page.evaluate(()=>__hucWorkspaceDom.editor.focus());
    await page.keyboard.type('x');await pause(60);assert.equal((await page.evaluate(()=>__hucWorkspaceAudit.commands())).filter(item=>item.method==='noteOn').length,beforeType,'Editor typing does not play');
    await setSource(pending+'// Cmd save\n');await page.locator('#masterVolumeValue').click();await page.keyboard.down('a');await until(()=>page.evaluate(count=>__hucWorkspaceAudit.commands().filter(item=>item.method==='noteOn').length>count,beforeType),'Code-view keyboard plays after leaving editor');await page.keyboard.up('a');await running();
    step('Focused chip tabs and Code background accept performance keys; typing in Monaco/textarea does not steal notes, and physical CH ownership is retained');

    for(const [kind,tab,mount]of [['msm5205','msm5205ChipTab','msmTestPcm'],['cdda','cddaChipTab','cddaTestPcm']]){
      await choose(tab);await page.locator('#'+mount+' [data-test-shape="sine"]').click();await until(()=>page.locator('#'+mount).getAttribute('data-loading').then(value=>value==='false'),'Test source loaded '+kind);
      const before=(await page.evaluate(()=>__hucWorkspaceAudit.commands())).length;await page.locator('#'+tab).focus();await page.keyboard.down('a');
      await until(()=>page.evaluate(({before,kind})=>__hucWorkspaceAudit.commands().slice(before).some(item=>item.name==='tetorica-'+kind&&item.method==='play'),{before,kind}),'Media keyboard '+kind);await page.keyboard.up('a');await running();
      const stable=await audit();for(const id of ['synthInputCodeTab','mixerChipTab',tab]){await choose(id);await expectSameGraph(stable);await running();}
    }
    step('MSM5205 and CD-DA tab keyboard triggers use their existing players; subsequent view changes do not reload media or create another context/Worklet');

    // All views are measured after the editor has settled, both with and without Files.
    for(const width of [1360,390])for(const files of [true,false]){await openFiles(files);
      for(const id of TAB_IDS){await choose(id);await snapshotLayout('expanded-'+id+'-files-'+files,width);await running();}
      await page.locator('#synthWorkspaceSynthButton').click();assert.equal(await expanded(),false);await snapshotLayout('restored-files-'+files,width);
      await page.locator('#synthWorkspaceCodeButton').click();await assertTabs('synthInputCodeTab');
    }
    await page.setViewportSize({width:1360,height:1050});await openFiles();await returnCode();await stopCode();step('Expanded/restored Code, all chip/Mixer/Keyboard views and Files open/closed fit settled 390px and desktop layouts without zero-size Monaco');

    await page.locator('#synthWorkspaceSynthButton').click();await page.locator('#hucSongSelect').selectOption(SONG);await page.locator('#hucSongPlayButton').click();await until(()=>page.locator('#hucSongPlayer').getAttribute('data-state').then(value=>value==='playing'),'VGM playing');
    await until(()=>page.evaluate(()=>__hucWorkspaceAudit.output()?.acRms>1e-5),'VGM renders PCM');measurements.vgmBefore=await page.evaluate(()=>__hucWorkspaceAudit.output());
    const playingFrame=Number(await page.locator('#hucSongPlayer').getAttribute('data-position-frames'));
    await page.locator('#synthWorkspaceCodeButton').click();for(const id of TAB_IDS){await choose(id);assert.equal(await page.locator('#hucSongPlayer').getAttribute('data-state'),'playing');}
    measurements.vgmAfter=await page.evaluate(()=>__hucWorkspaceAudit.output());assert(measurements.vgmAfter.finite&&measurements.vgmAfter.muted&&measurements.vgmAfter.acRms>1e-5);
    assert(Number(await page.locator('#hucSongPlayer').getAttribute('data-position-frames'))>=playingFrame);
    await choose('huc6280ChipTab');await page.locator('#hucSongPlayButton').click();await until(()=>page.locator('#hucSongPlayer').getAttribute('data-state').then(value=>value==='paused'),'VGM paused');
    const frame=await page.locator('#hucSongPlayer').getAttribute('data-position-frames');await selectHucChannel(page,1);
    for(const id of TAB_IDS){await choose(id);assert.equal(await page.locator('#hucSongPlayer').getAttribute('data-state'),'paused');assert.equal(await page.locator('#hucSongPlayer').getAttribute('data-position-frames'),frame);assert.equal(await page.locator('#hucChannelSelect').inputValue(),'1');}
    await page.locator('#synthWorkspaceSynthButton').click();assert.equal(await page.locator('#hucSongPlayer').getAttribute('data-state'),'paused');await page.locator('#hucSongStopButton').click();
    step('Opening Code and switching every workspace tab preserves VGM Play/Pause, paused frame and selected channel; layout changes never start Code');
    classifyErrors();measurements.audit=await audit();assert(measurements.audit.physicallyMuted);assert.deepEqual(measurements.audit.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    if(config.editor==='monaco'){assert.deepEqual(rawConsoleErrors,[]);assert.deepEqual(cdnFailures,[]);}
    return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
  }catch(error){classifyErrors();error.caseResult={browser:name,editor:config.editor,passed:false,checks,measurements,error:error.stack??String(error),
    status:await page.locator('#audioStatus').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),audit:await audit().catch(()=>null),errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
    await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-failed.png`),fullPage:true}).catch(()=>{});throw error;
  }finally{await context.close();}
}
function makeVgm(wave){
  const write=(r,v)=>[0xb9,r,v],upload=ch=>[...write(0,ch),...write(4,64),...write(4,0),...wave.flatMap(v=>write(6,v)),...write(5,255),...write(2,254),...write(3,0),...write(4,152)];
  const commands=[...write(1,255),...write(9,0),...upload(0),...upload(1)];let frames=44100*120;
  while(frames){const count=Math.min(65535,frames);commands.push(0x61,count&255,count>>8);frames-=count;}commands.push(0x66);
  const data=Buffer.alloc(256+commands.length);data.write('Vgm ');data.writeUInt32LE(data.length-4,4);data.writeUInt32LE(0x171,8);data.writeUInt32LE(44100*120,0x18);data.writeUInt32LE(0xcc,0x34);data.writeUInt32LE(3579545,0xa4);data.set(commands,256);return data;
}
(async()=>{
  const [{createPlaygroundCassetteZip},{createDefaultPreset}]=await Promise.all([import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js'))),import(pathToFileURL(path.join(repo,'docs/synth-huc6280/preset.js')))]);
  const preset=createDefaultPreset();preset.envelope.enabled=false;
  const fixture={cassette:Buffer.from(createPlaygroundCassetteZip([{path:CODE,type:'text',data:HOLD},{path:SONG,type:'binary',data:makeVgm(preset.wave)}]))};
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,report={schemaVersion:1,root:config.root,entry:config.entry,editor:config.editor,physicalOutputMuted:true,listeningPerformed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,fixture));}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;
  }catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.error=error.stack??String(error);process.exitCode=error.cdnUnavailable?2:1;console.error(report.error);}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,cdn,checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
