// SPDX-License-Identifier: BSD-3-Clause
// Focused real-source/readable-ZIP workspace checks. Every physical output is
// muted before app boot. --monaco-root points at pinned 0.52.2 min/vs assets.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),evidence=path.join(repo,'build/sid-code-workspace-20261121');
const config={root:path.join(repo,'docs'),entry:'/synth-sid/index.html',engines:'chromium,webkit',editor:'fallback',
  monacoRoot:path.join(repo,'build/dmg-working-saved-20261120/monaco/package/min/vs'),out:path.join(evidence,'browser.json'),screenshots:path.join(evidence,'screenshots')};
for(const arg of process.argv.slice(2)){
  const match=/^--(root|entry|engines|editor|monaco-root|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]==='monaco-root'?'monacoRoot':match[1]]=match[2];
}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));assert(['fallback','monaco'].includes(config.editor));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=value=>createHash('sha256').update(value).digest('hex'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(35);}throw Error('Timeout: '+label);}
const served=new Map(),missing=[],external=[],cdn=[],localMonaco=new Map(),results=[];
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml'};
const isMonaco=url=>url.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/');
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const filename=path.resolve(config.root,'.'+pathname);assert(filename.startsWith(config.root+path.sep));
    const body=await fs.readFile(filename),name=path.relative(config.root,filename),record={bytes:body.length,sha256:hash(body)};
    if(served.has(name))assert.deepEqual(served.get(name),record,'Asset changed during verification');served.set(name,record);
    response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(body);
  }catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
const CODE='/index.js',TONE='/presets/Workspace.sid-channels.json',TEXT='/notes.txt',SONG='/sid/workspace.sid',DB='tetorica-sid-synth-files';
const TAB_IDS=['synthInputCodeTab','sidChipTab','synthInputKeyboardTab'];
const HOLD=`const sid=await useSoundChip('sid');
context.starts=(context.starts??0)+1;
const prepared=await livePrepare('workspace-motion',()=>({visits:0}));
globalThis.__sidWorkspaceProbe={sid,context,prepared,ticks:0};
await sid.noteOn(CH1,'E4');
await sid.setFrequency(CH1,329.63);
liveFx('workspace-quiet',{context:{gain:.55},process(input,output,state,ctx){for(let c=0;c<output.length;c++)for(let i=0;i<output[c].length;i++)output[c][i]=(input[c]?.[i]??0)*ctx.gain;}});
liveLoop('workspace-motion',async()=>{__sidWorkspaceProbe.ticks++;prepared.visits++;await beat(.05);});
`;
function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const contexts=[],nodes=[],meters=[],commands=[],rejections=[];let serial=0;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(value,...args){if(value?.method)commands.push({method:value.method,args:value.args});return post.call(this,value,...args);};
  window.addEventListener('unhandledrejection',event=>rejections.push(String(event.reason?.stack??event.reason)));
  function sample({analyser,mute}){
    const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0,finite=true;const crossings=[];
    for(const value of values){sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));finite&&=Number.isFinite(value);}
    const dc=sum/values.length;for(let i=1;i<values.length;i++)if(values[i-1]<=dc&&values[i]>dc)crossings.push(i);
    return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-dc*dc)),peak,finite,dc,
      frequency:crossings.length>2?analyser.context.sampleRate*(crossings.length-1)/(crossings.at(-1)-crossings[0]):0,muted:mute.gain.value===0};
  }
  async function read(method='read',args=[],kind='tetorica-sid-synth'){
    const node=nodes.findLast(item=>item.name===kind&&item.node.context.state!=='closed')?.node;if(!node)throw Error('SID Worklet missing');const id=--serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Native read timeout'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});
  }
  window.__sidWorkspaceAudit={read,player:()=>read('read',[],'tetorica-sid-player'),commands:()=>commands.slice(),output:()=>meters.map(sample).sort((a,b)=>b.acRms-a.acRms)[0]??null,
    state:()=>({contexts:contexts.length,nodeNames:nodes.map(item=>item.name),destinationConnections:meters.length,
      physicallyMuted:meters.every(item=>item.mute.gain.value===0),rejections:rejections.slice()})};
}
async function draft(page){return page.evaluate(name=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');
    tx.oncomplete=()=>{db.close();resolve(read.result??null);};tx.onabort=()=>{db.close();reject(tx.error??read.error);};};
}),DB);}
const fileText=(value,version,name=CODE)=>{const data=value?.workspace?.[version]?.files.find(file=>file.path===name)?.data;return typeof data==='string'?data:data?Buffer.from(data).toString('utf8'):null;};
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
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    if(isMonaco(url.href)){
      cdn.push(url.href);if(config.editor==='fallback'){abortedMonaco.add(url.href);return route.abort();}
      assert(config.monacoRoot,'A pinned local Monaco fixture is required');const relative=decodeURIComponent(url.pathname.split('/min/vs/')[1]);
      let fixturePath=relative,filename=path.resolve(config.monacoRoot,fixturePath);assert(filename.startsWith(path.resolve(config.monacoRoot)+path.sep));
      try{let body;try{body=await fs.readFile(filename);}catch(error){if(error.code!=='ENOENT'||!relative.endsWith('.min.js'))throw error;fixturePath=relative.replace(/\.min\.js$/,'.js');filename=path.resolve(config.monacoRoot,fixturePath);body=await fs.readFile(filename);}
        localMonaco.set(relative,{fixturePath,bytes:body.length,sha256:hash(body)});return route.fulfill({status:200,contentType:mime[path.extname(filename)]??'application/octet-stream',body,headers:{'Access-Control-Allow-Origin':'*'}});
      }catch{cdnFailures.push(url.href);return route.abort();}
    }
    external.push(url.href);return route.abort();
  });
  const step=message=>{checks.push(message);console.log(`CHECK ${name}/${config.editor}: ${message}`);};
  const ready=()=>until(()=>page.locator('#sidFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');
  const expanded=()=>page.locator('#synthWorkspace').evaluate(node=>node.classList.contains('is-code-expanded'));
  const audit=()=>page.evaluate(()=>__sidWorkspaceAudit.state()),read=(method='read')=>page.evaluate(method=>__sidWorkspaceAudit.read(method),method);
  const output=()=>page.evaluate(()=>__sidWorkspaceAudit.output());
  const row=name=>page.locator('#sidFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(name)}]`);
  const currentSource=()=>page.evaluate(()=>window.monaco?.editor?.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))?.getValue()??document.getElementById('synthCodeEditor').value);
  async function setSource(value){
    if(config.editor==='fallback')await page.locator('#synthCodeEditor').fill(value);else await page.evaluate(value=>monaco.editor.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).setValue(value),value);
    assert.equal(await currentSource(),value);
  }
  async function focusEditor(){if(config.editor==='fallback')await page.locator('#synthCodeEditor').focus();else await page.evaluate(()=>__sidWorkspaceDom.editor.focus());}
  async function editorReady(){
    await until(()=>page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))||/Fallback|unavailable|could not load/i.test(document.getElementById('synthCodeEditorNote').textContent)),'Editor initialization',60000);
    assert.equal(await page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))),config.editor==='monaco','Requested editor is active');
  }
  async function openFiles(value=true){if(await page.locator('#sidFilesPanel').isVisible()!==value)await page.locator('#sidFilesToggle').click();
    if(value)for(let n=0;n<20;n++){const closed=page.locator('#sidFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}}
  async function select(name){await openFiles();await row(name).click();await ready();await until(()=>page.locator('#sidFilesSelected').textContent().then(value=>value===name),'Selected file '+name);}
  async function choose(id){await page.locator('#'+id).click();await until(()=>page.locator('#'+id).getAttribute('aria-selected').then(value=>value==='true'),'Selected tab '+id);}
  async function assertTabs(selected){
    const state=await page.evaluate(ids=>{const nodes=ids.map(id=>document.getElementById(id)),list=nodes[0].parentElement;return{
      ids:Array.from(list.querySelectorAll(':scope > [role="tab"]')).map(node=>node.id),selected:nodes.filter(node=>node.getAttribute('aria-selected')==='true').map(node=>node.id),
      tabbable:nodes.filter(node=>node.tabIndex===0).map(node=>node.id),parents:nodes.map(node=>node.parentElement===list),code:document.getElementById('synthWorkspaceCodeButton').getAttribute('aria-pressed'),synth:document.getElementById('synthWorkspaceSynthButton').getAttribute('aria-pressed')};},TAB_IDS);
    assert.deepEqual(state.ids,TAB_IDS);assert.deepEqual(state.selected,[selected]);assert.deepEqual(state.tabbable,[selected]);assert(state.parents.every(Boolean));assert.equal(state.code,'true');assert.equal(state.synth,'false');assert(await expanded());
    for(const id of ['masterVolume','synthCodeRunButton','synthCodeApplyButton','synthCodeStopButton'])assert(await page.locator('#'+id).isVisible(),id+' accessible');
  }
  async function identity(){assert(await page.evaluate(()=>{
    const d=__sidWorkspaceDom;return document.getElementById('masterVolume')===d.master&&document.getElementById('synthCodeEditor')===d.textarea&&document.getElementById('synthCodeEditorHost')===d.host&&
      document.getElementById('synthCodeRunButton')===d.run&&document.getElementById('synthKeyboardPanel')===d.keyboard&&document.getElementById('synthInputSection')===d.section&&
      (!d.editor||d.editor===monaco.editor.getEditors().find(editor=>d.host.contains(editor.getDomNode()))&&d.editor.getModel()===d.model)&&
      ['masterVolume','synthCodeRunButton','synthInputCodeTab','synthInputKeyboardTab','sidChipTab'].every(id=>document.querySelectorAll('#'+id).length===1);
  }),'Original controls, section, editor and model are reused');}
  async function save(shortcut='Control+s'){
    await page.keyboard.press(shortcut);await ready();await until(()=>draft(page).then(value=>fileText(value,'working')===fileText(value,'saved')),'Source saved');
  }
  async function running(){const tick=await page.evaluate(()=>__sidWorkspaceProbe.ticks);await pause(90);assert((await page.evaluate(()=>__sidWorkspaceProbe.ticks))>tick);
    assert(await page.evaluate(()=>__sidWorkspaceProbe===__sidWorkspaceIdentity&&__sidWorkspaceProbe.context===__sidWorkspaceIdentity.context&&__sidWorkspaceProbe.prepared===__sidWorkspaceIdentity.prepared&&__sidWorkspaceProbe.sid===__sidWorkspaceIdentity.sid));
    assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);}
  async function sameGraph(before){const after=await audit();assert.equal(after.contexts,before.contexts);assert.deepEqual(after.nodeNames,before.nodeNames);assert.equal(after.destinationConnections,before.destinationConnections);assert(after.physicallyMuted);}
  async function snapshotLayout(label,width){
    await page.setViewportSize({width,height:1050});await pause(450);const visible=await page.locator('#synthCodePanel').isVisible();
    const inspect=()=>page.evaluate(()=>({elements:['body','main','#synthWorkspace','#sidSynthMain','#sidSynthEditor','#sidFilesPanel','#synthExpandedTabsSlot','#synthExpandedVolumeSlot','#synthExpandedCodeSlot','#synthCodePanel','#synthCodeEditorHost','#keyboard'].flatMap(selector=>{
      const node=document.querySelector(selector),r=node?.getBoundingClientRect();return r?.width&&r.height?[{selector,width:r.width,left:r.left,right:r.right,client:node.clientWidth,scroll:node.scrollWidth}]:[];
    }),monaco:window.monaco?.editor?.getEditors().filter(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).map(editor=>({width:editor.getLayoutInfo().width,height:editor.getLayoutInfo().height}))??[]}));
    const validate=value=>{for(const node of value.elements){assert(node.left>=-1&&node.right<=width+1,label+' viewport '+JSON.stringify(node));
      if(['body','main','#synthWorkspace','#sidSynthMain'].includes(node.selector))assert(node.scroll<=node.client+1,label+' unmasked overflow '+JSON.stringify(node));}
      if(visible&&config.editor==='monaco')for(const node of value.monaco)assert(node.width>100&&node.height>100,label+' nonzero Monaco');};
    const before=await inspect();validate(before);const filename=path.join(config.screenshots,`${name}-${config.editor}-${label}-${width}.png`);await page.screenshot({path:filename,fullPage:true});await pause(60);const after=await inspect();validate(after);measurements.layouts.push({filename,before,after});
  }
  const returnCode=async()=>{await choose('synthInputCodeTab');await editorReady();};
  try{
    await page.goto(origin+config.entry);await ready();await openFiles();
    await page.locator('#sidProjectFileInput').setInputFiles({name:'workspace.cassette.zip',mimeType:'application/zip',buffer:fixture.cassette});
    await page.locator('#sidImportCassetteDialog').waitFor({state:'visible'});await page.locator('#sidImportCassetteReplace').click();await page.locator('#sidImportCassetteDialog').waitFor({state:'hidden'});await ready();
    await until(()=>draft(page).then(value=>fileText(value,'working')===HOLD),'Imported workspace');
    await page.locator('#synthWorkspaceCodeButton').click();await editorReady();await assertTabs('synthInputCodeTab');
    assert.equal((await audit()).contexts,0,'Code layout does not start audio');assert.equal(await page.locator('#sidFilesPanel').isVisible(),true);
    await page.evaluate(()=>{
      const editor=window.monaco?.editor?.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))??null;
      globalThis.__sidWorkspaceDom={master:document.getElementById('masterVolume'),masterParent:document.getElementById('masterVolume').closest('label'),textarea:document.getElementById('synthCodeEditor'),host:document.getElementById('synthCodeEditorHost'),editor,model:editor?.getModel(),run:document.getElementById('synthCodeRunButton'),keyboard:document.getElementById('synthKeyboardPanel'),section:document.getElementById('synthInputSection')};
    });
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);await identity();}
    assert(await page.locator('#synthExpandedVolumeSlot #masterVolume').count());
    assert.equal((await audit()).contexts,0);step('Header Code opens one persistent Code / SID / Keyboard workspace without starting audio, cloning controls or losing Master');

    await returnCode();await page.locator('#synthInputCodeTab').focus();
    for(const direction of ['ArrowRight','ArrowLeft'])for(let i=0;i<TAB_IDS.length;i++){
      const active=await page.evaluate(()=>document.activeElement?.id),index=TAB_IDS.indexOf(active),id=TAB_IDS[(index+(direction==='ArrowRight'?1:TAB_IDS.length-1))%TAB_IDS.length];
      await page.keyboard.press(direction);await until(()=>page.evaluate(id=>document.activeElement?.id===id,id),'Arrow focus '+id);await assertTabs(id);
    }
    await page.keyboard.press('End');await until(()=>page.locator('#synthInputKeyboardTab').getAttribute('aria-selected').then(value=>value==='true'),'End Keyboard');await assertTabs('synthInputKeyboardTab');
    await page.keyboard.press('Home');await until(()=>page.locator('#synthInputCodeTab').getAttribute('aria-selected').then(value=>value==='true'),'Home Code');await assertTabs('synthInputCodeTab');
    await page.locator('#synthWorkspaceSynthButton').click();assert.equal(await expanded(),false);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'code');
    assert(await page.locator('.audio-toolbar #masterVolume').count());await identity();
    await page.locator('#synthCodeExpandButton').click();await assertTabs('synthInputCodeTab');await choose('synthInputKeyboardTab');await page.locator('#synthCodeExpandButton').click();
    assert.equal(await expanded(),false);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');assert(await page.locator('.audio-toolbar #masterVolume').count());
    await page.locator('#synthWorkspaceCodeButton').click();await assertTabs('synthInputCodeTab');step('Arrow keys, Home/End, restore and header switches retain focus, input mode and original Master/header placement');

    const toggle=page.locator('#sidAutoApplyToggle');if(await toggle.isChecked())await toggle.click();await ready();await until(()=>draft(page).then(value=>value?.workspace?.autoSave===false),'Manual mode');
    const pending=HOLD+'\n// Pending layout draft: Save must not run it.\n';await setSource(pending);await until(()=>draft(page).then(value=>fileText(value,'working')===pending&&fileText(value,'saved')===HOLD),'Both source versions');
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);assert.equal(await currentSource(),pending);await identity();}
    await returnCode();await focusEditor();const begins=(await page.evaluate(()=>__sidWorkspaceAudit.commands())).filter(item=>item.method==='beginCode').length;
    await page.keyboard.press('Control+Enter');await until(()=>page.evaluate(()=>Boolean(globalThis.__sidWorkspaceProbe)),'Code runs saved source');await pause(150);
    assert.equal(await currentSource(),pending,'Run shortcut does not insert a newline');assert.equal((await page.evaluate(()=>__sidWorkspaceAudit.commands())).filter(item=>item.method==='beginCode').length,begins+1,'One shortcut starts one Code lease');
    await page.evaluate(()=>globalThis.__sidWorkspaceIdentity=__sidWorkspaceProbe);await running();await save();assert.equal(await page.evaluate(()=>__sidWorkspaceProbe.context.starts),1);
    await setSource(pending+'// Cmd save\n');await choose('sidChipTab');await save('Meta+s');await running();await returnCode();
    step('Working/saved source and editor model survive every view; Run shortcut executes once, and Ctrl/Cmd+S saves without running or restarting Code');

    await choose('sidChipTab');await page.locator('[data-sid-live-voice="1"]').click();
    const before=await read('observeCode'),graph=await audit();await until(async()=>{const value=await output();return value?.finite&&value.muted&&value.acRms>1e-5;},'Held PCM');measurements.initialOutput=await output();
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);await running();await identity();assert.equal(await page.locator('[data-sid-live-voice="1"]').getAttribute('aria-pressed'),'true');
      const current=await read('observeCode');assert.deepEqual(current.registers,before.registers);assert.equal(current.model,before.model);await sameGraph(graph);}
    measurements.afterViews=await output();assert(Math.abs(measurements.afterViews.acRms/measurements.initialOutput.acRms-1)<.08);
    await returnCode();await page.locator('#masterVolume').evaluate(node=>{node.value='1.4';node.dispatchEvent(new Event('input',{bubbles:true}));});await until(()=>page.locator('#masterVolumeValue').textContent().then(value=>value==='140%'),'Master boost');
    await pause(220);measurements.boosted=await output();measurements.masterRatio=measurements.boosted.acRms/measurements.afterViews.acRms;assert(measurements.masterRatio>1.8&&measurements.masterRatio<2.2,'One Master applies gain once');assert.equal(await page.locator('#masterVolume').getAttribute('data-boosted'),'true');
    await page.locator('#masterVolume').evaluate(node=>{node.value='.7';node.dispatchEvent(new Event('input',{bubbles:true}));});
    step('View switches preserve selected CH, registers, shared Filter, held PCM, Gate/frequency, loop/context/livePrepare/client identities and FX graph; the original Master remains live');

    await choose('synthInputKeyboardTab');await page.locator('#synthInputKeyboardTab').focus();const keyStart=(await page.evaluate(()=>__sidWorkspaceAudit.commands())).length;
    await page.keyboard.down('a');await until(()=>page.evaluate(start=>__sidWorkspaceAudit.commands().slice(start).some(item=>item.method==='noteOn'&&item.args?.[2]===1),keyStart),'CH2 keyboard gate');await page.keyboard.up('a');await running();
    await returnCode();const beforeType=(await page.evaluate(()=>__sidWorkspaceAudit.commands())).filter(item=>item.method==='noteOn').length;await focusEditor();await page.keyboard.type('x');await pause(70);
    assert.equal((await page.evaluate(()=>__sidWorkspaceAudit.commands())).filter(item=>item.method==='noteOn').length,beforeType,'Editor typing does not play');await setSource(pending+'// Cmd save\n');
    await page.locator('#masterVolumeValue').click();await page.keyboard.down('a');await until(()=>page.evaluate(count=>__sidWorkspaceAudit.commands().filter(item=>item.method==='noteOn').length>count,beforeType),'Code background performance');await page.keyboard.up('a');await running();
    await choose('sidChipTab');if(await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').uncheck();await select(TONE);await until(()=>page.locator('#synthCodePanel').getAttribute('data-runnable').then(value=>value==='false'),'JSON editor selected');await editorReady();
    const tone=structuredClone(fixture.preset);tone.channels[0].voice.release=7;const toneText=JSON.stringify(tone,null,2)+'\n';await setSource(toneText);await until(()=>draft(page).then(value=>fileText(value,'working',TONE)===toneText&&fileText(value,'saved',TONE)===fixture.presetText),'Manual JSON retained');
    await choose('synthInputKeyboardTab');await select(TEXT);assert.equal(await page.locator('#synthKeyboardPanel').isVisible(),true,'Text selection never forces Keyboard to Code');await returnCode();assert.equal(await currentSource(),fixture.notes);
    await select(TONE);await until(()=>currentSource().then(value=>value===toneText),'Pending JSON model selected');assert.equal(await currentSource(),toneText);assert.equal(await page.locator('#synthCodePanel').getAttribute('data-runnable'),'false');await running();
    await select(CODE);await returnCode();assert.equal(await currentSource(),pending+'// Cmd save\n');await running();
    step('Keyboard works in Keyboard and Code background without stopping loops; text entry is silent, and JSON/text selection retains manual drafts without forcing Keyboard mode');

    for(const width of [1360,390]){
      await openFiles();for(const id of TAB_IDS){await choose(id);await snapshotLayout('expanded-'+id,width);await running();}
      await page.locator('#synthWorkspaceSynthButton').click();assert.equal(await expanded(),false);await snapshotLayout('restored',width);await identity();
      await page.locator('#synthWorkspaceCodeButton').click();await openFiles(false);await snapshotLayout('expanded-Code-files-closed',width);await openFiles();
    }
    await page.setViewportSize({width:1360,height:1050});await returnCode();await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Stopped Code');
    step('Desktop and 390px Code/SID/Keyboard layouts, Files open/closed and restoration fit without zero-size Monaco or unmasked page overflow');

    await page.locator('#synthWorkspaceSynthButton').click();await page.locator('#sidImportTools').evaluate(node=>{node.open=true;});
    await page.locator('#sidSoundFileInput').setInputFiles({name:'workspace-tone.sid',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.song)});
    await until(()=>page.locator('#sidImportPlay').isEnabled(),'SID accepted');await page.locator('#sidImportPlay').click();
    const player=()=>page.evaluate(()=>__sidWorkspaceAudit.player());
    await until(()=>page.locator('#sidImportStatus').getAttribute('data-state').then(value=>value==='playing'),'SID player ready');
    await until(async()=>{const state=await player();return state.playing&&state.positionFrames>4410;},'SID playing at nonzero position');
    const playingFrame=(await player()).positionFrames,beginsBeforeSong=(await page.evaluate(()=>__sidWorkspaceAudit.commands())).filter(item=>item.method==='beginCode').length;
    await page.locator('#synthWorkspaceCodeButton').click();for(const id of TAB_IDS){await choose(id);assert((await player()).playing);}
    assert((await player()).positionFrames>=playingFrame);await choose('sidChipTab');await page.locator('#sidImportPause').click();
    await until(async()=>(await player()).paused,'SID paused');const paused=await player();assert(paused.positionFrames>4410);measurements.pausedSidFrames=paused.positionFrames;
    await page.locator('[data-sid-live-voice="0"]').click();
    for(const id of TAB_IDS){await choose(id);const state=await player();assert(state.paused);assert.equal(state.positionFrames,paused.positionFrames);assert.equal(await page.locator('[data-sid-live-voice="0"]').getAttribute('aria-pressed'),'true');}
    await page.locator('#synthWorkspaceSynthButton').click();assert.equal((await player()).positionFrames,paused.positionFrames);
    assert.equal((await page.evaluate(()=>__sidWorkspaceAudit.commands())).filter(item=>item.method==='beginCode').length,beginsBeforeSong,'Navigation never starts Code');
    await page.locator('#sidImportPause').click();await until(async()=>(await player()).positionFrames>paused.positionFrames,'SID resumes');await page.locator('#sidImportStop').click();
    step('Header and workspace navigation preserve SID Play/Pause, exact nonzero paused frame and selected physical channel without starting Code');
    classifyErrors();measurements.audit=await audit();assert(measurements.audit.physicallyMuted);assert.deepEqual(measurements.audit.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    if(config.editor==='monaco'){assert.deepEqual(rawConsoleErrors,[]);assert.deepEqual(cdnFailures,[]);}
    return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
  }catch(error){classifyErrors();error.caseResult={browser:name,editor:config.editor,passed:false,checks,measurements,error:error.stack??String(error),
    status:await page.locator('#audioStatus').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),native:await read('observeCode').catch(()=>null),output:await output().catch(()=>null),audit:await audit().catch(()=>null),errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
    await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-failed.png`),fullPage:true}).catch(()=>{});throw error;
  }finally{await context.close();}
}
(async()=>{
  const [{createSidCodeProject},{createDefaultPreset},{createChannelSettings},{createSidReferenceFixture}]=await Promise.all([
    import(pathToFileURL(path.join(repo,'docs/synth-sid/code_project.js'))),import(pathToFileURL(path.join(repo,'docs/synth-sid/preset.js'))),
    import(pathToFileURL(path.join(repo,'docs/synth-sid/channel_settings.js'))),import(pathToFileURL(path.join(repo,'test/fixtures/sid-reference/fixture.mjs')))]);
  const voice=createDefaultPreset();voice.name='Workspace';voice.voice.waveform='saw';voice.voice.attack=0;voice.voice.decay=0;voice.voice.sustain=12;
  voice.modulation.sync=false;voice.modulation.ring=false;voice.filter.enabled=false;
  const preset=createChannelSettings(voice);preset.channels[1].voice.waveform='pulse';preset.channels[1].voice.pulseWidth=1024;preset.channels[2].voice.waveform='triangle';
  const presetText=JSON.stringify(preset,null,2)+'\n',notes='Workspace text remains editable.\n',song=createSidReferenceFixture('tone').bytes;
  const project=createSidCodeProject({settings:preset,starterCode:HOLD});project.importFiles([{path:TONE,type:'text',data:presetText},{path:TEXT,type:'text',data:notes},{path:SONG,type:'binary',data:song}]);
  const fixture={preset,presetText,notes,song,cassette:Buffer.from(await project.exportProject())};
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,report={schemaVersion:1,root:config.root,entry:config.entry,editor:config.editor,physicalOutputMuted:true,listeningPerformed:false,networkAccessUsed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,fixture));}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;
  }catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.error=error.stack??String(error);process.exitCode=1;console.error(report.error);}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,cdn,localMonaco:Object.fromEntries(localMonaco),checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
