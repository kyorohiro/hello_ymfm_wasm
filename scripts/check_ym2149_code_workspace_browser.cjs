// SPDX-License-Identifier: BSD-3-Clause
// Focused real-source/readable-ZIP workspace checks. Every physical output is
// muted before app boot. --monaco-root points at pinned 0.52.2 min/vs assets.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),evidence=path.join(repo,'build/st-code-row-alignment-20261121');
const config={root:path.join(repo,'docs'),entry:'/synth-ym2149-st/index.html',engines:'chromium,webkit',editor:'fallback',
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
const CODE='/index.js',TONE='/presets/Workspace.ym2149-st.json',TEXT='/notes.txt',INSTRUMENT='/presets/Instrument-select.ym2149-st.json',DB='tetorica-ym2149-st-synth-files';
const TAB_IDS=['synthInputCodeTab','ymChipTab','ymMixerTab','synthInputKeyboardTab'];
const LEVELS=[2,5,9,12,15,12,9,5];
const HOLD=`const ym=await useSoundChip("ay8910");
setBpm(120);
context.starts=(context.starts??0)+1;
const prepared=await livePrepare("workspace-motion",()=>({visits:0}));
ym.keyOff(CH2);ym.keyOff(CH3);
ym.setVoice(CH1,{tone:true,noise:false,volume:0,envelope:false});
ym.setNote(CH1,"A4");
const levels=[2,5,9,12,15,12,9,5];
const pattern=ym.build(b=>levels.forEach((level,index)=>b.atSeconds(index/(40*levels.length)).setVolume(CH1,level,false)));
const captured=await ym.captureState();
const compiled=await ym.compile(pattern,{initialState:captured});
console.table(compiled);
globalThis.__ymWorkspaceProbe={ym,context,prepared,compiled,ticks:0};
liveLoop("workspace-motion",async()=>{
  await ym.schedule(pattern,{name:"workspace-volume",repeatSeconds:1/40});
  __ymWorkspaceProbe.ticks++;prepared.visits++;
  await beat(.5);
});
liveCleanup(["workspace-motion"],()=>ym.keyOff(CH1));
`;
function installAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const contexts=[],nodes=[],meters=[],commands=[],traffic=[],receipts=[],rejections=[];let serial=0;
  const addMessage=MessagePort.prototype.addEventListener,removeMessage=MessagePort.prototype.removeEventListener;
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);nodes.push({node:this,name});}};
  // This runs before any app code: even the first speaker connection is muted.
  AudioNode.prototype.connect=function(destination,...args){
    if(destination!==this.context.destination)return connect.call(this,destination,...args);
    const analyser=this.context.createAnalyser(),mute=this.context.createGain();analyser.fftSize=8192;mute.gain.value=0;
    connect.call(this,analyser,...args);connect.call(analyser,mute);connect.call(mute,destination);meters.push({analyser,mute});return destination;
  };
  MessagePort.prototype.postMessage=function(value,...args){
    if(value?.method==='ayTimed'){
      const payload=structuredClone(value.args[0]);traffic.push({...payload,id:value.id,audioTime:contexts.at(-1)?.currentTime});
      if(value.id!==undefined){const port=this,receive=event=>{
        if(event.data?.id!==value.id)return;removeMessage.call(port,'message',receive);
        receipts.push({action:payload.action,owner:payload.owner,id:value.id,ok:!event.data.error,value:event.data.value,error:event.data.error});
      };addMessage.call(port,'message',receive);port.start();}
    }
    for(const command of value?.commands??(Array.isArray(value)?value:[value]))if(command?.method)commands.push(structuredClone(command));
    return post.call(this,value,...args);
  };
  window.addEventListener('unhandledrejection',event=>rejections.push(String(event.reason?.stack??event.reason)));
  function sample({analyser,mute}){
    const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);let sum=0,square=0,peak=0,finite=true;
    for(const value of values){sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));finite&&=Number.isFinite(value);}
    const dc=sum/values.length;return{rms:Math.sqrt(square/values.length),acRms:Math.sqrt(Math.max(0,square/values.length-dc*dc)),peak,finite,dc,muted:mute.gain.value===0};
  }
  async function request(method,args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-ay8910'&&item.node.context.state!=='closed')?.node;if(!node)throw Error('YM2149 Worklet missing');const id=`workspace-audit:${++serial}`;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Native read timeout'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});
  }
  window.__ymWorkspaceAudit={capture:()=>request('ayTimed',[{action:'capture'}]),commands:()=>commands.slice(),traffic:()=>traffic.slice(),receipts:()=>receipts.slice(),
    output:()=>meters.map(sample).sort((a,b)=>b.acRms-a.acRms)[0]??null,state:()=>({contexts:contexts.length,nodeNames:nodes.map(item=>item.name),destinationConnections:meters.length,
      physicallyMuted:meters.every(item=>item.mute.gain.value===0),rejections:rejections.slice()})};
}
async function draft(page){return page.evaluate(name=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');
    tx.oncomplete=()=>{db.close();resolve(read.result??null);};tx.onabort=()=>{db.close();reject(tx.error??read.error);};};
}),DB);}
const fileText=(value,name=CODE)=>{const data=value?.filesystem?.files.find(file=>file.path===name)?.data;return typeof data==='string'?data:data?Buffer.from(data).toString('utf8'):null;};
async function check(browser,name,origin,fixture){
  const context=await browser.newContext({viewport:{width:1360,height:1050},serviceWorkers:'block'}),page=await context.newPage();
  const checks=[],measurements={layouts:[],alignment:[]},errors=[],rawConsoleErrors=[],consoleErrors=[],expectedConsoleErrors=[],cdnFailures=[],abortedMonaco=new Set();
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
  const ready=()=>until(()=>page.locator('#ymFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');
  const expanded=()=>page.locator('#synthWorkspace').evaluate(node=>node.classList.contains('is-code-expanded'));
  const audit=()=>page.evaluate(()=>__ymWorkspaceAudit.state()),capture=()=>page.evaluate(()=>__ymWorkspaceAudit.capture());
  const output=()=>page.evaluate(()=>__ymWorkspaceAudit.output()),code=()=>page.evaluate(()=>tetoricaYm2149StSynth.getCodeState());
  const row=name=>page.locator('#ymFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(name)}]`);
  const currentSource=()=>page.evaluate(()=>window.monaco?.editor?.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))?.getValue()??document.getElementById('synthCodeEditor').value);
  async function setSource(value){
    if(config.editor==='fallback')await page.locator('#synthCodeEditor').fill(value);else await page.evaluate(value=>monaco.editor.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).setValue(value),value);
    assert.equal(await currentSource(),value);
  }
  async function focusEditor(){if(config.editor==='fallback')await page.locator('#synthCodeEditor').focus();else await page.evaluate(()=>__ymWorkspaceDom.editor.focus());}
  async function editorReady(){
    await until(()=>page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))||/Fallback|unavailable|could not load/i.test(document.getElementById('synthCodeEditorNote').textContent)),'Editor initialization',60000);
    assert.equal(await page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))),config.editor==='monaco','Requested editor is active');
  }
  async function openFiles(value=true){if(await page.locator('#ymFilesPanel').isVisible()!==value)await page.locator('#ymFilesToggle').click();
    if(value)for(let n=0;n<20;n++){const closed=page.locator('#ymFilesTree details:not([open]) > summary');if(!await closed.count())break;await closed.first().click();}}
  async function select(name){await openFiles();await row(name).click();await ready();await until(()=>page.locator('#ymFilesSelected').textContent().then(value=>value===name),'Selected file '+name);}
  async function choose(id){await page.locator('#'+id).click();await until(()=>page.locator('#'+id).getAttribute('aria-selected').then(value=>value==='true'),'Selected tab '+id);}
  async function assertTabs(selected){
    const state=await page.evaluate(ids=>{const nodes=ids.map(id=>document.getElementById(id)),list=nodes[0].parentElement;return{
      ids:Array.from(list.querySelectorAll(':scope > [role="tab"]')).map(node=>node.id),selected:nodes.filter(node=>node.getAttribute('aria-selected')==='true').map(node=>node.id),
      tabbable:nodes.filter(node=>node.tabIndex===0).map(node=>node.id),parents:nodes.map(node=>node.parentElement===list),code:document.getElementById('synthWorkspaceCodeButton').getAttribute('aria-pressed'),synth:document.getElementById('synthWorkspaceSynthButton').getAttribute('aria-pressed')};},TAB_IDS);
    assert.deepEqual(state.ids,TAB_IDS);assert.deepEqual(state.selected,[selected]);assert.deepEqual(state.tabbable,[selected]);assert(state.parents.every(Boolean));assert.equal(state.code,'true');assert.equal(state.synth,'false');assert(await expanded());
    for(const id of ['masterVolume','synthCodeRunButton','synthCodeApplyButton','synthCodeStopButton','ymSongPanel','ymSongToggle'])assert(await page.locator('#'+id).isVisible(),id+' accessible in '+selected);
    const referenceExpanded=await page.locator('#ymSongPanel').evaluate(node=>node.open);
    for(const id of ['ymSongBody','ymSongSelect','ymSongPlay','ymSongPause','ymSongStop','ymSongSeek','ymSongPosition'])assert.equal(await page.locator('#'+id).isVisible(),referenceExpanded,id+' follows the native reference disclosure in '+selected);
    assert.equal(await page.locator('#synthWorkspace > #ymWorkspaceMeta > #ymReferenceControls > details#ymSongPanel > summary#ymSongToggle').count(),1,'One native reference disclosure shares metadata above both columns');
    assert(await page.locator('#ymSongPanel').evaluate(node=>!node.closest('#ymSynthEditor')&&document.getElementById('synthWorkspace').firstElementChild.id==='ymWorkspaceMeta'),'Reference stays outside the hidden editor and above the Files/main row');
  }
  async function referenceFold(open,key){
    if(await page.locator('#ymSongPanel').evaluate(node=>node.open)!==open){
      if(key){await page.locator('#ymSongToggle').focus();await page.keyboard.press(key);}else await page.locator('#ymSongToggle').click();
    }
    await until(()=>page.locator('#ymSongPanel').evaluate((node,open)=>node.open===open,open),'Reference disclosure '+open);
    assert(await page.locator('#ymSongToggle').isVisible());assert.equal(await page.locator('#ymSongBody').isVisible(),open);
  }
  async function identity(checkModel=true){assert(await page.evaluate(checkModel=>{
    const d=__ymWorkspaceDom;return d.nodes.every(([id,node])=>document.getElementById(id)===node&&document.querySelectorAll('#'+id).length===1)&&
      (!d.editor||d.editor===monaco.editor.getEditors().find(editor=>d.host.contains(editor.getDomNode()))&&(!checkModel||d.editor.getModel()===d.model));
  },checkModel),'Original Master, transport, File tree, editor, panels and model are reused');}
  async function running(){const tick=await page.evaluate(()=>__ymWorkspaceProbe.ticks);await until(()=>page.evaluate(tick=>__ymWorkspaceProbe.ticks>tick,tick),'Named loop advances');
    assert(await page.evaluate(()=>__ymWorkspaceProbe===__ymWorkspaceIdentity&&__ymWorkspaceProbe.context===__ymWorkspaceIdentity.context&&__ymWorkspaceProbe.prepared===__ymWorkspaceIdentity.prepared&&__ymWorkspaceProbe.ym===__ymWorkspaceIdentity.ym));
    const state=await code();assert(state.running);assert.deepEqual(state.loopNames,['workspace-motion']);assert.equal(await page.evaluate(()=>__ymWorkspaceProbe.context.starts),1);}
  async function sameGraph(before){const after=await audit();assert.equal(after.contexts,before.contexts);assert.deepEqual(after.nodeNames,before.nodeNames);assert.equal(after.destinationConnections,before.destinationConnections);assert(after.physicallyMuted);}
  async function motion(label){
    const samples=[],start=Date.now();do{const s=await capture();samples.push({frame:s.frame,value:s.registers[8]});assert(LEVELS.includes(s.registers[8]),'Scheduled R8 stays within the pattern');await pause(6);}while(Date.now()-start<120);
    const values=[...new Set(samples.map(s=>s.value))];assert(values.length>=3,'Actual repeating R8 writes continue in '+label);assert(samples.at(-1).frame>samples[0].frame);
    return{view:label,firstFrame:samples[0].frame,lastFrame:samples.at(-1).frame,register:8,values};
  }
  async function meanOutput(){const values=[];for(let n=0;n<4;n++){await pause(55);values.push(await output());}assert(values.every(v=>v?.finite&&v.muted&&v.acRms>1e-5));return{acRms:values.reduce((sum,v)=>sum+v.acRms,0)/values.length,peak:Math.max(...values.map(v=>v.peak))};}
  const rowGeometry=()=>page.evaluate(()=>{
    const rect=node=>{const r=node?.getBoundingClientRect();return r?.width&&r.height?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,centerY:(r.top+r.bottom)/2}:null;};
    const meta=document.getElementById('ymWorkspaceMeta'),master=document.getElementById('masterVolume').closest('.master-control');
    return{viewport:innerWidth,expanded:document.getElementById('synthWorkspace').classList.contains('is-code-expanded'),referenceOpen:document.getElementById('ymSongPanel').open,
      meta:rect(meta),status:rect(document.getElementById('audioStatus')),reference:rect(document.getElementById('ymSongPanel')),master:rect(master),masterInMeta:meta.contains(master),
      filesPanel:rect(document.getElementById('ymFilesPanel')),filesHeading:rect(document.querySelector('#ymFilesPanel .ym-files-heading')),
      tabs:['synthInputCodeTab','ymChipTab','ymMixerTab','synthInputKeyboardTab'].map(id=>({id,rect:rect(document.getElementById(id))}))};
  });
  function validateRows(row,label){
    for(const key of ['meta','status','reference']){assert(row[key],label+' visible '+key);assert(row[key].left>=-1&&row[key].right<=row.viewport+1,label+' bounded '+key);}
    const statusGap=Math.max(row.reference.top-row.status.bottom,row.status.top-row.reference.bottom,0);assert(statusGap<=32,label+' Reference stays near audio status: '+statusGap);
    if(row.filesPanel){assert(row.meta.bottom<=row.filesPanel.top+1,label+' shared metadata precedes Files');assert(row.reference.bottom<=row.filesPanel.top+1,label+' Reference stays above Files');}
    if(!row.expanded)return;
    assert(row.master&&row.masterInMeta,label+' original Master stays in shared metadata');assert(row.master.left>=-1&&row.master.right<=row.viewport+1,label+' bounded Master');
    assert(row.tabs.every(tab=>tab.rect),label+' all four tabs visible');const first=row.tabs[0].rect;
    assert(row.meta.bottom<=first.top+1,label+' metadata stays above tabs');assert(row.master.bottom<=first.top+1,label+' Master does not push only the right tabs down');
    if(row.viewport>=900&&row.filesHeading){
      const topDelta=row.filesHeading.top-first.top,centerDelta=row.filesHeading.centerY-first.centerY;
      assert(Math.abs(topDelta)<=2&&Math.abs(centerDelta)<=2,label+' Files heading/buttons and workspace tabs share a row: '+JSON.stringify({topDelta,centerDelta,files:row.filesHeading,tabs:first}));
      for(const tab of row.tabs)assert(Math.abs(tab.rect.top-first.top)<=1,label+' all expanded tabs share Y');
    }
  }
  async function assertRowAlignment(label){const row=await rowGeometry();validateRows(row,label);measurements.alignment.push({label,...row});return row;}
  async function snapshotLayout(label,width){
    await page.setViewportSize({width,height:1050});await pause(350);const visible=await page.locator('#synthCodePanel').isVisible();
    const inspect=()=>page.evaluate(()=>({elements:['body','main','#synthWorkspace','#ymWorkspaceMeta','#ymReferenceControls','#ymSynthMain','#ymSongPanel','#ymSongBody','#ymSynthEditor','#ymFilesPanel','#synthExpandedTabsSlot','#synthExpandedVolumeSlot','#synthExpandedCodeSlot','#synthCodePanel','#synthCodeEditorHost','#keyboard'].flatMap(selector=>{
      const node=document.querySelector(selector),r=node?.getBoundingClientRect();return r?.width&&r.height?[{selector,width:r.width,left:r.left,right:r.right,client:node.clientWidth,scroll:node.scrollWidth}]:[];
    }),monaco:window.monaco?.editor?.getEditors().filter(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).map(editor=>({width:editor.getLayoutInfo().width,height:editor.getLayoutInfo().height}))??[]}));
    const validate=value=>{for(const node of value.elements){assert(node.left>=-1&&node.right<=width+1,label+' viewport '+JSON.stringify(node));
      if(['body','main','#synthWorkspace','#ymSynthMain'].includes(node.selector))assert(node.scroll<=node.client+1,label+' unmasked overflow '+JSON.stringify(node));}
      if(visible&&config.editor==='monaco')for(const node of value.monaco)assert(node.width>100&&node.height>100,label+' nonzero Monaco');};
    const before=await inspect();validate(before);const rowBefore=await assertRowAlignment(label+' before '+width);const filename=path.join(config.screenshots,`${name}-${config.editor}-${label}-${width}.png`);await page.screenshot({path:filename,fullPage:true});const after=await inspect();validate(after);const rowAfter=await assertRowAlignment(label+' after '+width);measurements.layouts.push({filename,before,after,rowBefore,rowAfter});
  }
  const returnCode=async()=>{await choose('synthInputCodeTab');await editorReady();};
  try{
    await page.goto(origin+config.entry);await ready();await openFiles();
    await page.locator('#ymProjectFileInput').setInputFiles({name:'workspace.cassette.zip',mimeType:'application/zip',buffer:fixture.cassette});await ready();
    await until(()=>draft(page).then(value=>fileText(value)===HOLD),'Imported workspace');await select(CODE);
    await page.locator('#synthWorkspaceCodeButton').click();await editorReady();await assertTabs('synthInputCodeTab');
    assert.equal((await audit()).contexts,0,'Code layout does not start audio');assert.equal(await page.locator('#ymFilesPanel').isVisible(),true);
    await page.evaluate(()=>{
      const host=document.getElementById('synthCodeEditorHost'),editor=window.monaco?.editor?.getEditors().find(editor=>host.contains(editor.getDomNode()))??null;
      globalThis.__ymWorkspaceDom={host,editor,model:editor?.getModel(),masterHome:document.getElementById('masterVolume').closest('label'),
        nodes:['masterVolume','synthCodeEditor','synthCodeEditorHost','synthCodeRunButton','synthCodeApplyButton','synthCodeStopButton','synthInputSection','synthKeyboardPanel','ymFilesTree','ymFilesPanel','audioStatus','ymWorkspaceMeta','ymReferenceControls','ymChipPanel','ymMixerPanel','ymSongPanel','ymSongToggle','ymSongBody','ymSongSelect','ymSongPlay','ymSongPause','ymSongStop','ymSongSeek','ymSongPosition',...['synthInputCodeTab','ymChipTab','ymMixerTab','synthInputKeyboardTab']].map(id=>[id,document.getElementById(id)])};
    });
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);await identity();}
    assert(await page.locator('#synthExpandedVolumeSlot #masterVolume').count());assert.equal((await audit()).contexts,0);
    assert(await page.locator('#ymSongPanel').evaluate(node=>node.open),'Reference disclosure starts expanded');await referenceFold(false);
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);await identity();assert.equal(await page.locator('#ymSongPanel').evaluate(node=>node.open),false,'Views keep the user fold');}
    await referenceFold(true,'Space');await returnCode();assert.equal((await audit()).contexts,0,'Cold folding never creates audio');
    measurements.referenceFold={defaultExpanded:true,coldAudioContexts:0,foldPreservedAcrossViews:true,keyboardToggle:true};
    step('Header Code opens persistent Code / YM2149 / Mixer / Keyboard views with original Master, transport, File tree and editor; layout alone creates no audio');

    await returnCode();await page.locator('#synthInputCodeTab').focus();
    for(const direction of ['ArrowRight','ArrowLeft'])for(let i=0;i<TAB_IDS.length;i++){
      const active=await page.evaluate(()=>document.activeElement?.id),index=TAB_IDS.indexOf(active),id=TAB_IDS[(index+(direction==='ArrowRight'?1:TAB_IDS.length-1))%TAB_IDS.length];
      await page.keyboard.press(direction);await until(()=>page.evaluate(id=>document.activeElement?.id===id,id),'Arrow focus '+id);await assertTabs(id);
    }
    await page.keyboard.press('End');await until(()=>page.locator('#synthInputKeyboardTab').getAttribute('aria-selected').then(value=>value==='true'),'End Keyboard');await assertTabs('synthInputKeyboardTab');await page.keyboard.press('Home');await until(()=>page.locator('#synthInputCodeTab').getAttribute('aria-selected').then(value=>value==='true'),'Home Code');await assertTabs('synthInputCodeTab');
    await page.locator('#synthWorkspaceSynthButton').click();assert.equal(await expanded(),false);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'code');
    assert(await page.locator('.ym-monitor-toolbar #masterVolume').count());await identity();
    await page.locator('#synthCodeExpandButton').click();await assertTabs('synthInputCodeTab');await choose('synthInputKeyboardTab');await page.locator('#synthCodeExpandButton').click();
    assert.equal(await expanded(),false);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');assert(await page.locator('.ym-monitor-toolbar #masterVolume').count());
    await page.locator('#synthWorkspaceCodeButton').click();await assertTabs('synthInputCodeTab');assert.equal((await audit()).contexts,0);
    step('Arrow keys, Home/End, header Synth and maximize/restore retain expansion, focus and the original Master placement');

    const pending=HOLD+'\n// Kept layout draft.\n';await setSource(pending);await until(()=>draft(page).then(value=>fileText(value)===pending),'Source persisted');
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);assert.equal(await currentSource(),pending);await identity();}
    await returnCode();await focusEditor();await page.keyboard.press('Control+Enter');await until(()=>page.evaluate(()=>Boolean(globalThis.__ymWorkspaceProbe)),'One Run shortcut starts source');
    assert.equal(await currentSource(),pending,'Run shortcut does not insert a newline');await page.evaluate(()=>globalThis.__ymWorkspaceIdentity=__ymWorkspaceProbe);await running();
    assert.equal((await audit()).contexts,1);const graph=await audit();assert.equal(graph.nodeNames.filter(value=>value==='tetorica-ay8910').length,1);assert.equal(graph.destinationConnections,1);
    const compiled=await page.evaluate(()=>__ymWorkspaceProbe.compiled);assert.equal(compiled.length,LEVELS.length);assert.deepEqual(compiled.map(row=>row.register),LEVELS.map(()=>8));assert.deepEqual(compiled.map(row=>row.value),LEVELS);measurements.compiled=compiled;
    await until(()=>page.evaluate(()=>__ymWorkspaceAudit.receipts().some(r=>r.action==='schedule'&&r.ok)),'Native schedule ACK');
    const nativeStart=await page.evaluate(()=>({traffic:__ymWorkspaceAudit.traffic().length,commands:__ymWorkspaceAudit.commands().length}));
    measurements.motion=[];await choose('ymChipTab');await page.locator('#ymChannel2Tab').click();
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);await running();await identity();assert.equal(await page.locator('#ymChannel2Tab').getAttribute('aria-selected'),'true');await sameGraph(graph);measurements.motion.push(await motion(id));}
    await choose('ymChipTab');const selectedFile=await page.locator('#ymFilesSelected').textContent(),sourceBeforeInstrument=await currentSource();
    await page.locator('#ymPresetSelect').selectOption(INSTRUMENT);await ready();await until(()=>page.evaluate(name=>tetoricaYm2149StSynth.getSettings().name===name,fixture.instrument.name),'Instrument applies from YM2149');
    await assertTabs('ymChipTab');assert.equal(await page.locator('#ymFilesSelected').textContent(),selectedFile,'Instrument keeps the selected performance file');assert.equal(await currentSource(),sourceBeforeInstrument,'Instrument keeps the Code source');await identity();
    const instrumentSettings=await page.evaluate(()=>tetoricaYm2149StSynth.getSettings());assert.deepEqual(instrumentSettings,fixture.instrument,'Instrument changes the actual shared settings');
    const clientRegisters=await page.evaluate(()=>Array.from(__ymWorkspaceProbe.ym.getRegisterSnapshot()));
    const expectedRegisters={0:18,1:2,2:219,3:2,4:132,5:3,6:23,7:10,11:210,12:4,13:12};
    for(const [register,value]of Object.entries(expectedRegisters))assert.equal(clientRegisters[register],value,'Applied client R'+register);
    await until(async()=>{const native=await capture();return Object.entries(expectedRegisters).every(([register,value])=>native.registers[register]===value);},'Applied native YM2149 registers');
    await running();await sameGraph(graph);measurements.instrument={path:INSTRUMENT,selectedView:'ymChipTab',selectedFile,settings:instrumentSettings,registers:expectedRegisters,codeSourcePreserved:true};
    step('Instrument selection from expanded YM2149 applies distinct settings to the shared client and native chip while preserving YM2149 view, performance file, editor/model and running Code owner');await snapshotLayout('instrument-applied-YM2149',1360);
    await referenceFold(false);await running();await choose('ymMixerTab');await assertTabs('ymMixerTab');assert.equal(await page.locator('#ymSongPanel').evaluate(node=>node.open),false);await returnCode();await snapshotLayout('reference-folded-Code-running',1360);await running();await sameGraph(graph);await referenceFold(true,'Enter');await assertTabs('synthInputCodeTab');
    measurements.referenceFold.codeContinuesWithSameOwner=true;

    await returnCode();measurements.initialOutput=await meanOutput();
    await page.locator('#masterVolume').evaluate(node=>{node.value='1.2';node.dispatchEvent(new Event('input',{bubbles:true}));});await until(()=>page.locator('#masterValue').textContent().then(value=>value==='120%'),'Live Master');
    measurements.boostedOutput=await meanOutput();measurements.masterAcRmsRatio=measurements.boostedOutput.acRms/measurements.initialOutput.acRms;measurements.masterRatio=measurements.boostedOutput.peak/measurements.initialOutput.peak;assert(measurements.masterRatio>1.95&&measurements.masterRatio<2.05,'One Master scales the shared chip once');
    await page.locator('#masterVolume').evaluate(node=>{node.value='.6';node.dispatchEvent(new Event('input',{bubbles:true}));});
    step('One AudioContext and chip keep the same loop/context/client/livePrepare identities, compiled R8 pattern and native reservation moving across all four views; Master gain remains live');

    await choose('synthInputKeyboardTab');await page.locator('#synthInputKeyboardTab').focus();await page.keyboard.down('a');
    await until(()=>page.locator('#keyboard .key[data-key="a"]').evaluateAll(nodes=>nodes.some(node=>node.classList.contains('is-active'))),'Keyboard key held');
    await until(()=>page.evaluate(()=>tetoricaYm2149StSynth.getState().activeChannels.includes(1)),'Keyboard uses selected physical CH2');await page.keyboard.up('a');await running();
    await returnCode();const beforeType=(await page.evaluate(()=>__ymWorkspaceAudit.commands())).length;await focusEditor();await page.keyboard.type('x');await pause(70);
    const typingCommands=await page.evaluate(index=>__ymWorkspaceAudit.commands().slice(index).filter(row=>row.method==='writeRegister'&&[2,3,9].includes(row.args?.[0])),beforeType);
    assert.deepEqual(typingCommands,[],'Text typing does not play the selected channel');await setSource(pending);
    await page.locator('#synthInputCodeTab').click();await page.keyboard.down('a');await until(()=>page.evaluate(()=>tetoricaYm2149StSynth.getState().activeChannels.includes(1)),'Code background performance');await page.keyboard.up('a');await running();
    await choose('ymChipTab');await select(TONE);await returnCode();await editorReady();assert.equal(await page.locator('#synthCodePanel').getAttribute('data-runnable'),'false');
    const toneText=JSON.stringify({...fixture.preset,name:'Workspace draft retained'},null,2)+'\n';await setSource(toneText);await until(()=>draft(page).then(value=>fileText(value,TONE)===toneText),'JSON text retained');
    await choose('synthInputKeyboardTab');await select(TEXT);assert.equal(await page.locator('#synthKeyboardPanel').isVisible(),true,'Text selection preserves Keyboard view');await returnCode();assert.equal(await currentSource(),fixture.notes);
    await select(TONE);assert.equal(await currentSource(),toneText);await identity(false);await running();await select(CODE);await returnCode();assert.equal(await currentSource(),pending);await identity();await running();
    step('Keyboard and Code background performance share selected CH2 without changing the loop owner; typing is silent and JSON/text drafts and Monaco models survive file/view selection');

    for(const width of [1360,390]){
      await openFiles();await referenceFold(true);for(const id of TAB_IDS){await choose(id);await snapshotLayout('expanded-'+id,width);await running();}
      await referenceFold(false);for(const id of TAB_IDS){await choose(id);await assertTabs(id);await assertRowAlignment('folded-'+id+' '+width);}
      await returnCode();await snapshotLayout('expanded-Code-reference-folded',width);await running();
      await page.locator('#synthWorkspaceSynthButton').click();assert.equal(await expanded(),false);await snapshotLayout('restored',width);await identity();await running();
      await page.locator('#synthWorkspaceCodeButton').click();await openFiles(false);await snapshotLayout('expanded-Code-files-closed-reference-folded',width);await referenceFold(true);await snapshotLayout('expanded-Code-files-closed-reference-open',width);await openFiles();
    }
    const nativeEnd=await page.evaluate(start=>({traffic:__ymWorkspaceAudit.traffic().slice(start.traffic),commands:__ymWorkspaceAudit.commands().slice(start.commands),receipts:__ymWorkspaceAudit.receipts()}),nativeStart);
    const reservations=nativeEnd.traffic.filter(row=>row.action==='schedule'&&row.options?.name==='workspace-volume');assert(reservations.length>4);
    const owners=[...new Set(reservations.map(row=>row.owner))];assert.equal(owners.length,1);assert(owners[0].includes(':loop:'));
    const lifecycle=nativeEnd.traffic.filter(row=>!['capture','schedule'].includes(row.action));assert.deepEqual(lifecycle,[],'View changes never cancel or release native ownership');
    assert(!nativeEnd.commands.some(row=>['reset','initialize'].includes(row.method)),'View changes never reset the chip');
    const compact=reservations.map(row=>{const ack=nativeEnd.receipts.find(r=>r.id===row.id);assert(ack?.ok);assert.equal(ack.value.entries,LEVELS.length);assert.equal(ack.value.repeatSeconds,1/40);return{owner:row.owner,name:row.options.name,entries:ack.value.entries,startFrame:ack.value.startFrame,repeatSeconds:ack.value.repeatSeconds};});
    assert(compact.at(-1).startFrame>compact[0].startFrame);measurements.reservations={count:compact.length,first:compact[0],last:compact.at(-1),lifecycle};await sameGraph(graph);
    await page.setViewportSize({width:1360,height:1050});await returnCode();await running();
    step('1360px Files heading/buttons align with all four tabs for open/folded Reference; shared Reference/Master metadata stays above both columns near status, including Files hidden/restored and 390px layouts, while the native owner keeps running');

    // The reference player remains reachable from Code itself. Importing does
    // not stop Code; its explicit Play action takes the shared performance.
    await assertTabs('synthInputCodeTab');await page.locator('#ymMusicInput').setInputFiles({name:'workspace.vgm',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.song)});
    const song=()=>page.evaluate(()=>tetoricaYm2149StSynth.getSongState());await until(async()=>{const s=await song();return s.loaded&&!s.busy;},'Reference accepted from Code');
    assert((await code()).running,'Import preserves the current Code run');await assertTabs('synthInputCodeTab');await page.locator('#ymSongPlay').click();
    await until(async()=>{const s=await song();return s.playing&&s.positionFrames>4410;},'Reference plays from Code');assert.equal((await code()).running,false,'Reference Play stops Code');await assertTabs('synthInputCodeTab');
    const playingFoldBefore=await page.evaluate(()=>({commands:__ymWorkspaceAudit.commands().length,traffic:__ymWorkspaceAudit.traffic().length})),playingFoldFrame=(await song()).positionFrames;
    await referenceFold(false);await pause(85);assert((await song()).playing);assert((await song()).positionFrames>playingFoldFrame,'Reference continues while folded');await referenceFold(true);await assertTabs('synthInputCodeTab');await sameGraph(graph);
    const playingFoldAfter=await page.evaluate(()=>({commands:__ymWorkspaceAudit.commands().length,traffic:__ymWorkspaceAudit.traffic().length}));assert.deepEqual(playingFoldAfter,playingFoldBefore,'Playing disclosure sends no audio commands or lifecycle events');measurements.referenceFold.playingContinuesWithoutAudioCommands=true;
    const playingFrame=(await song()).positionFrames;for(const id of TAB_IDS){await choose(id);await assertTabs(id);assert((await song()).playing);assert.equal((await code()).running,false);}
    assert((await song()).positionFrames>playingFrame);await returnCode();await page.locator('#ymSongPause').click();await until(async()=>(await song()).paused,'Reference pauses from Code');
    const paused=await song();assert(paused.positionFrames>4410);assert.equal(await page.locator('#ymChannel2Tab').getAttribute('aria-selected'),'true');
    await choose('ymChipTab');
    for(const id of ['toneEnabled','noiseEnabled','envelopeEnabled','fixedVolume','noisePeriod','envelopePeriod','envelopeShape'])assert.equal(await page.locator('#'+id).isDisabled(),false,'Paused hardware control editable: '+id);
    await page.locator('#noiseEnabled').check();
    await page.locator('#envelopeEnabled').check();
    await page.locator('#noisePeriod').evaluate(node=>{node.value='23';node.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal((await song()).positionFrames,paused.positionFrames);
    await choose('synthInputKeyboardTab');await page.locator('#synthInputKeyboardTab').focus();await page.keyboard.down('a');
    await until(()=>page.evaluate(()=>tetoricaYm2149StSynth.getState().activeChannels.includes(1)),'Paused edited audition');
    let auditionState=await page.evaluate(()=>tetoricaYm2149StSynth.getState());
    assert.equal(auditionState.preset.voices[1].noise,true);assert.equal(auditionState.preset.voices[1].envelope,true);assert.equal(auditionState.preset.noisePeriod,23);
    await choose('ymChipTab');await page.locator('#toneEnabled').uncheck();
    auditionState=await page.evaluate(()=>tetoricaYm2149StSynth.getState());assert.equal(auditionState.preset.voices[1].tone,false,'Held audition updates');
    await page.keyboard.up('a');
    await choose('ymChipTab');assert.equal(await page.locator('#noiseEnabled').isChecked(),true,'Edits survive release');
    await returnCode();measurements.pausedEditing={controlsEnabled:true,auditionUsesEdits:true,heldEditApplied:true,positionPreserved:true};
    const pausedFoldBefore=await page.evaluate(()=>({commands:__ymWorkspaceAudit.commands().length,traffic:__ymWorkspaceAudit.traffic().length}));await referenceFold(false);
    for(const id of TAB_IDS){await choose(id);await assertTabs(id);const s=await song();assert(s.paused);assert.equal(s.positionFrames,paused.positionFrames);assert.equal(await page.locator('#ymChannel2Tab').getAttribute('aria-selected'),'true');assert.equal((await code()).running,false);}
    await page.locator('#synthWorkspaceSynthButton').click();assert.equal((await song()).positionFrames,paused.positionFrames);await page.locator('#synthWorkspaceCodeButton').click();await assertTabs('synthInputCodeTab');
    assert.equal(await page.locator('#ymSongPanel').evaluate(node=>node.open),false,'Header views keep the user fold');await snapshotLayout('reference-folded-paused-Code',390);assert.equal((await song()).positionFrames,paused.positionFrames);await identity();await sameGraph(graph);
    const pausedFoldAfter=await page.evaluate(()=>({commands:__ymWorkspaceAudit.commands().length,traffic:__ymWorkspaceAudit.traffic().length}));assert.deepEqual(pausedFoldAfter,pausedFoldBefore,'Paused disclosure and navigation send no audio commands or lifecycle events');await referenceFold(true);await assertTabs('synthInputCodeTab');assert.equal((await song()).positionFrames,paused.positionFrames);measurements.referenceFold.pausedFrame=paused.positionFrames;measurements.referenceFold.pausedPositionPreservedWithoutAudioCommands=true;
    await snapshotLayout('reference-paused-Code',390);assert.equal((await song()).positionFrames,paused.positionFrames);await page.setViewportSize({width:1360,height:1050});
    await page.locator('#ymSongPause').click();await until(async()=>(await song()).positionFrames>paused.positionFrames,'Reference resumes from Code');await assertTabs('synthInputCodeTab');
    await page.locator('#ymSongStop').click();await until(async()=>{const s=await song();return !s.playing&&!s.paused&&s.positionFrames===0;},'Reference stops from Code');assert.equal((await code()).running,false);await sameGraph(graph);
    // The opposite explicit transport handoff also remains exclusive. A fresh
    // Run may rebuild its existing FX rack; it must reuse the one physical AY
    // and AudioContext rather than creating another output owner.
    await page.locator('#ymSongPlay').click();await until(async()=>(await song()).playing,'Reference replay from Code');await page.locator('#synthCodeRunButton').click();
    await until(async()=>(await code()).running,'Code Run replaces reference');assert.equal((await song()).playing,false,'Code Run stops reference playback');assert.equal((await song()).paused,false);await assertTabs('synthInputCodeTab');
    await page.locator('#synthCodeStopButton').click();await until(async()=>{const s=await code();return !s.running&&!s.stopping&&!s.busy;},'Stopped explicit Code run');
    const handoffGraph=await audit();assert.equal(handoffGraph.contexts,1);assert.equal(handoffGraph.nodeNames.filter(value=>value==='tetorica-ay8910').length,1);assert.equal(handoffGraph.destinationConnections,1);
    measurements.reference={format:'vgm',pausedFrames:paused.positionFrames,selectedChannel:1,controlsVisibleIn:TAB_IDS,playPauseResumeStopView:'code',importPreservesCode:true,referencePlayStopsCode:true,codeRunStopsReference:true};
    step('The original reference disclosure preserves its fold across views and live/paused playback without audio lifecycle changes; actual VGM Play/Pause/Resume/Stop work directly in Code, exact paused frames survive navigation, and explicit Code/song transports stay exclusive');
    classifyErrors();measurements.audit=await audit();assert(measurements.audit.physicallyMuted);assert.deepEqual(measurements.audit.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    const failed=await page.evaluate(()=>__ymWorkspaceAudit.receipts().filter(row=>!row.ok));assert.deepEqual(failed,[]);
    if(config.editor==='monaco'){assert.deepEqual(rawConsoleErrors,[]);assert.deepEqual(cdnFailures,[]);}
    return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
  }catch(error){classifyErrors();error.caseResult={browser:name,editor:config.editor,passed:false,checks,measurements,error:error.stack??String(error),
    status:await page.locator('#audioStatus').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),native:await capture().catch(()=>null),output:await output().catch(()=>null),audit:await audit().catch(()=>null),errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
    await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-failed.png`),fullPage:true}).catch(()=>{});throw error;
  }finally{await context.close();}
}
(async()=>{
  const [{createYmCodeProject},{createDefaultPreset},{createYmVgmFixture,ayWrite,ayWait}]=await Promise.all([
    import(pathToFileURL(path.join(repo,'docs/synth-ym2149-st/code_project.js'))),import(pathToFileURL(path.join(repo,'docs/synth-ym2149-st/preset.js'))),
    import(pathToFileURL(path.join(repo,'docs/synth-ym2149-st/vgm_test_helpers.mjs')))]);
  const preset=createDefaultPreset();preset.name='Workspace';const presetText=JSON.stringify(preset,null,2)+'\n',notes='Workspace text remains editable.\n';
  const instrument=createDefaultPreset();instrument.name='Instrument dropdown applied';instrument.voices=[{tone:true,noise:false,volume:6,envelope:false,period:530},{tone:false,noise:true,volume:11,envelope:false,period:731},{tone:true,noise:true,volume:5,envelope:false,period:900}];instrument.noisePeriod=23;instrument.envelope={period:1234,shape:12};
  const commands=[];for(const [r,v]of [[0,100],[1,0],[2,200],[3,0],[4,44],[5,1],[6,8],[7,0x38],[8,9],[9,7],[10,6],[11,80],[12,0],[13,10]])commands.push(...ayWrite(r,v));
  for(let n=0;n<30;n++)commands.push(...ayWait(44100));commands.push(0x66);const song=createYmVgmFixture(commands);
  const project=createYmCodeProject({settings:preset,starterCode:HOLD});project.importFiles([{path:TONE,type:'text',data:presetText},{path:TEXT,type:'text',data:notes},{path:INSTRUMENT,type:'text',data:JSON.stringify(instrument,null,2)+'\n'}]);project.select(CODE);project.setCodeState({mode:'keyboard',path:CODE});
  const fixture={preset,presetText,notes,instrument,song,cassette:Buffer.from(await project.exportProject())};
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,report={schemaVersion:1,root:config.root,entry:config.entry,editor:config.editor,physicalOutputMuted:true,listeningPerformed:false,networkAccessUsed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,fixture));}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;
  }catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.error=error.stack??String(error);process.exitCode=1;console.error(report.error);}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,cdn,localMonaco:Object.fromEntries(localMonaco),checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
