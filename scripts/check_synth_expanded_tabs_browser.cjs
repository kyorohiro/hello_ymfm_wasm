// Expanded FM2612 Synth workspace and New Cassette regression check.
// Every physical Web Audio destination is intercepted before application load
// and passes through gain zero. Audio is inspected only as numeric PCM levels.
// Run against docs or an extracted itch ZIP with --root=... --entry=/index.html.
// --editor=monaco requires the real pinned CDN editor; exit 2 means unavailable.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {tmpdir} = require('node:os');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repo = path.resolve(__dirname, '..');
const config = {root:path.join(repo,'docs'), entry:'/synth/index.html', engines:'chromium,webkit', editor:'fallback',
  out:path.join(tmpdir(),'fm2612-synth-expanded-tabs-browser.json'), screenshots:path.join(tmpdir(),'fm2612-synth-expanded-tabs-browser')};
for (const arg of process.argv.slice(2)) {
  const match = /^--(root|entry|engines|editor|out|screenshots)=(.+)$/.exec(arg);
  assert(match, 'Unknown argument: '+arg); config[match[1]]=match[2];
}
config.root=path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
assert(['fallback','monaco'].includes(config.editor));
const engines=config.engines.split(',');
assert(engines.length && engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test,label,ms=25000) {
  const end=Date.now()+ms;
  while(Date.now()<end) {if(await test())return;await pause(35);}
  throw Error('Timeout: '+label);
}
const served=new Map(),missing=[],external=[],cdn=[],results=[];
const isMonacoCdn=url=>url.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon'};
const server=http.createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    const filename=path.resolve(config.root,'.'+pathname);
    assert(filename.startsWith(config.root+path.sep),'Outside package');
    const bytes=await fs.readFile(filename),name=path.relative(config.root,filename),meta={bytes:bytes.length,sha256:hash(bytes)};
    if(served.has(name))assert.deepEqual(served.get(name),meta,'Asset changed during check');
    served.set(name,meta);
    response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  } catch(error) {missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});

function installAudioAudit() {
  const connect=AudioNode.prototype.connect,meters=[],contexts=[],rejections=[];
  const Context=window.AudioContext??window.webkitAudioContext;
  window.AudioContext=class extends Context {constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  window.addEventListener('unhandledrejection',event=>rejections.push(String(event.reason?.stack??event.reason)));
  AudioNode.prototype.connect=function(destination,...ports) {
    if(destination!==this.context.destination)return connect.call(this,destination,...ports);
    const meter=this.context.createAnalyser(),gate=this.context.createGain();
    meter.fftSize=8192;gate.gain.value=0;
    connect.call(this,meter,...ports);connect.call(meter,gate);connect.call(gate,destination);
    meters.push({meter,gate});return destination;
  };
  function read() {
    let peak=0,rms=0,finite=true;
    for(const {meter} of meters) {
      const data=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(data);let sum=0;
      for(const value of data){sum+=value*value;peak=Math.max(peak,Math.abs(value));finite&&=Number.isFinite(value);}
      rms=Math.max(rms,Math.sqrt(sum/data.length));
    }
    return {peak,rms,finite,physicallyMuted:meters.every(({gate})=>gate.gain.value===0),destinations:meters.length,contexts:contexts.length,rejections:rejections.slice()};
  }
  window.__expandedAudioAudit={read};
}
const TABS=['synthInputCodeTab','synthChipTabYm2612','synthChipTabPsg','synthChipTabPcm','synthChipTabCdda','synthChipTabPwm','synthSongMixButton','synthInputKeyboardTab'];
const LABELS=['Code','YM2612','PSG','RF5C164','CD-DA','32X PWM','Mixer','Keyboard'];
const LIVE_SOURCE=`const fm = await useSoundChip('ym2612');
fm.setPreset(CH2, FM_PRESETS.sine);
fm.noteOn(CH2, 'C4');
globalThis.__expandedTabProbe = {ticks: 0};
liveLoop('expanded-tabs-hold', async () => {
  globalThis.__expandedTabProbe.ticks++;
  await sleep(0.05);
});
`;
const SECOND_SOURCE="// Selection must not execute a different document.\nglobalThis.__expandedMustNotRun = true;\n";
function authoredVgm() {
  const commands=[0x50,0x85,0x50,0x12,0x50,0x94];
  for(let i=0;i<80;i++)commands.push(0x61,0x44,0xac);
  commands.push(0x66);
  const bytes=Buffer.alloc(256+commands.length),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  bytes.write('Vgm ');view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(12,3579545,true);view.setUint32(0x34,204,true);view.setUint32(0x18,80*44100,true);
  bytes.set(commands,256);return bytes;
}
async function draft(page) {
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('tetorica-fm2612-synth-drafts',1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');
      tx.oncomplete=()=>{db.close();const saved=read.result;
        if(saved?.project?.files)saved.project.files=saved.project.files.map(item=>({...item,data:typeof item.data==='string'?item.data:Array.from(item.data)}));
        resolve(saved??null);};
      tx.onabort=()=>{db.close();reject(tx.error??read.error);};
    };
  }));
}
const file=(saved,name)=>saved?.project?.files?.find(item=>item.path===name)?.data;
const textFile=(saved,name)=>{const data=file(saved,name);return data===undefined?undefined:typeof data==='string'?data:Buffer.from(data).toString('utf8');};
async function run(browser,name,origin,fixture,starterExamples) {
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:true,viewport:{width:1360,height:1000}});
  const page=await context.newPage(),errors=[],consoleErrors=[],cdnFailures=[],checks=[];
  let masterLevels=null;
  page.setDefaultTimeout(25000);
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('requestfailed',request=>{if(isMonacoCdn(request.url()))cdnFailures.push({url:request.url(),error:request.failure()?.errorText});});
  page.on('console',message=>{if(message.type()==='error'&&!/cdnjs\.cloudflare\.com|net::ERR_FAILED|Load failed|Failed to load resource/i.test(message.text()))consoleErrors.push(message.text());});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    if(isMonacoCdn(url.href)) {cdn.push(url.href);return config.editor==='monaco'?route.continue():route.abort();}
    external.push(url.href);return route.abort();
  });
  await context.addInitScript(installAudioAudit);
  const step=text=>{checks.push(text);console.log(`CHECK ${name}/${config.editor}: ${text}`);};
  const ready=()=>until(()=>page.locator('.synth-editor').getAttribute('aria-busy').then(value=>value==='false'),'Synth ready');
  const expanded=()=>page.locator('#synthWorkspace').evaluate(node=>node.classList.contains('is-code-expanded'));
  async function assertExpanded(selected) {
    await until(()=>page.locator('#'+selected).getAttribute('aria-selected').then(value=>value==='true'),'Selected expanded tab '+selected);
    assert(await expanded(),'Maximized mode remains active');
    const state=await page.locator('#synthExpandedTabsSlot [role="tablist"]').evaluate(node=>({
      labels:[...node.children].filter(item=>item.getAttribute('role')==='tab').map(item=>item.textContent.trim()),
      selected:[...node.children].filter(item=>item.getAttribute('aria-selected')==='true').map(item=>item.id),
      tabbable:[...node.children].filter(item=>item.tabIndex===0).map(item=>item.id),
    }));
    assert.deepEqual(state,{labels:LABELS,selected:[selected],tabbable:[selected]});
    assert.equal(await page.locator('#synthCodeExpandButton').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#synthWorkspaceCodeButton').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#synthWorkspaceSynthButton').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('#masterVolumeRange').count(),1,'A single shared Master control');
    assert(await page.locator('#synthExpandedVolumeSlot #masterVolumeRange').isVisible(),'Expanded Master remains accessible');
  }
  async function assertSynthLayout() {
    await until(async()=>!await expanded(),'Synth layout restored');
    assert.equal(await page.locator('#synthWorkspaceCodeButton').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('#synthWorkspaceSynthButton').getAttribute('aria-pressed'),'true');
    assert(await page.locator('.synth-editor .volume-control #masterVolumeRange').isVisible(),'Same Master returns to Synth');
    assert.equal(await page.locator('#synthExpandedVolumeSlot').isVisible(),false);
  }
  async function chooseHeaderSynth() {
    const button=page.locator('#synthWorkspaceSynthButton');
    await button.click();await assertSynthLayout();
    await until(()=>page.evaluate(()=>document.activeElement?.id==='synthWorkspaceSynthButton'),'Synth header keeps focus after restoring layout');
    const box=await button.boundingBox(),viewport=page.viewportSize();
    assert(box&&box.y>=0&&box.y+box.height<=viewport.height,'Synth header stays in the viewport after restoring '+JSON.stringify(box));
  }
  async function editorReady() {
    await until(async()=>page.evaluate(()=>{
      const host=document.getElementById('synthCodeEditorHost');
      return Boolean(window.monaco?.editor?.getEditors().some(editor=>host.contains(editor.getDomNode())))||
        /Fallback|could not load|unavailable/i.test(document.getElementById('synthCodeEditorNote').textContent);
    }),'Editor initialized',60000);
    const real=await page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))));
    if(config.editor==='monaco'&&!real) {const error=Error('Real Monaco unavailable: '+await page.locator('#synthCodeEditorNote').textContent());error.cdnUnavailable=Boolean(cdnFailures.length);throw error;}
    assert.equal(real,config.editor==='monaco');
  }
  async function source(value) {
    if(config.editor==='fallback')await page.locator('#synthCodeEditor').fill(value);
    else await page.evaluate(value=>{
      const host=document.getElementById('synthCodeEditorHost');
      monaco.editor.getEditors().find(editor=>host.contains(editor.getDomNode())).setValue(value);
    },value);
  }
  const currentSource=()=>page.evaluate(()=>{
    const host=document.getElementById('synthCodeEditorHost');
    return window.monaco?.editor?.getEditors().find(editor=>host.contains(editor.getDomNode()))?.getValue()??document.getElementById('synthCodeEditor').value;
  });
  async function selectFile(name) {
    if(!await page.locator('#synthFilesPanel').isVisible())await page.locator('#synthFilesToggle').click();
    for(let index=0;index<30;index++) {
      const closed=page.locator('#synthFilesTree details:not([open]) > summary[data-file-path]');
      if(!await closed.count())break;await closed.first().click();
    }
    await page.locator('#synthFilesTree button.file-entry').locator(`xpath=self::*[@data-file-path=${JSON.stringify(name)}]`).click();
    await ready();
    await until(()=>page.locator('#synthActiveFilePath').textContent().then(value=>value===name),'Selected '+name);
  }
  async function openMenu() {
    if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
  }
  async function newDialog() {
    await openMenu();await page.locator('#newCassetteButton').click();
    await page.locator('#synthNewCassetteDialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#synthMenu').evaluate(node=>node.open),false,'New closes Menu');
  }
  async function running() {
    const state=await page.locator('#synthCodeState').textContent();
    assert.match(state,/Running|Playing/,'Code remains running');
    assert.equal(await page.locator('#synthCodeError').textContent(),'');
    const before=await page.evaluate(()=>__expandedTabProbe.ticks);await pause(75);
    assert((await page.evaluate(()=>__expandedTabProbe.ticks))>before,'Same Code loop advances');
    await until(()=>page.evaluate(()=>__expandedAudioAudit.read().rms>0.0001),'Held Code voice still produces PCM');
    const audio=await page.evaluate(()=>__expandedAudioAudit.read());assert(audio.physicallyMuted&&audio.finite);
  }
  async function checkMaster() {
    const set=async value=>{
      await page.locator('#synthExpandedVolumeSlot #masterVolumeRange').evaluate((node,value)=>{
        node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));
      },value);
      assert.equal(await page.locator('#masterVolumeRange').inputValue(),String(value));
      await pause(220);
    };
    const level=async()=>{
      const values=[];
      for(let index=0;index<3;index++) {
        const data=await page.evaluate(()=>__expandedAudioAudit.read());
        assert(data.physicallyMuted&&data.finite);values.push(data.rms);await pause(35);
      }
      return values.sort((a,b)=>a-b)[1];
    };
    await set(100);const full=await level();assert(full>0.0001);
    await set(50);const half=await level();assert(Math.abs(half/full-0.5)<0.07,'Master halves actual Code PCM '+JSON.stringify({full,half}));
    const before=await page.evaluate(()=>__expandedTabProbe.ticks);
    await set(0);const zero=await level();assert(zero<1e-7,'Master zero mutes Code PCM');
    assert((await page.evaluate(()=>__expandedTabProbe.ticks))>before,'Master mute leaves live Code running');
    await set(100);const restored=await level();assert(Math.abs(restored/full-1)<0.07,'Master restores actual Code PCM');await running();
    return {full,half,zero,restored};
  }
  async function layout(selected,width) {
    await page.setViewportSize({width,height:1000});await pause(80);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow at '+width);
    await assertExpanded(selected);
    if(selected==='synthInputCodeTab'&&config.editor==='monaco') {
      const dimensions=await page.evaluate(()=>{
        const host=document.getElementById('synthCodeEditorHost'),editor=monaco.editor.getEditors().find(item=>host.contains(item.getDomNode()));
        const rect=host.getBoundingClientRect(),info=editor.getLayoutInfo();
        return {width:rect.width,height:rect.height,editorWidth:info.width,editorHeight:info.height};
      });
      assert(dimensions.width>100&&dimensions.height>100,JSON.stringify(dimensions));
      assert(Math.abs(dimensions.width-dimensions.editorWidth)<=2&&Math.abs(dimensions.height-dimensions.editorHeight)<=2,'Real Monaco relayout '+JSON.stringify(dimensions));
    }
    if(['synthInputCodeTab','synthInputKeyboardTab','synthSongMixButton'].includes(selected))
      await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-${selected}-${width}.png`),fullPage:true});
  }
  try {
    await page.goto(origin+config.entry);await ready();
    assert.equal(await expanded(),false,'Legacy layout is the default');
    assert.deepEqual(await page.locator('.synth-workspace-actions button').evaluateAll(nodes=>nodes.map(node=>node.id)),
      ['synthFilesToggle','synthWorkspaceCodeButton','synthWorkspaceSynthButton'],'Files and Code/Synth layouts share the header');
    await assertSynthLayout();
    await page.locator('#synthWorkspaceCodeButton').focus();await page.keyboard.press('Enter');
    await assertExpanded(TABS[0]);await editorReady();
    const starter=await currentSource();assert(starter.includes('useSoundChip'));
    await chooseHeaderSynth();
    assert.equal(await currentSource(),starter);
    step('Header Code/Synth toggle beside Files enters and restores the workspace, keeping Synth focus and viewport without executing starter Code');
    await page.locator('#cassetteImportInput').setInputFiles({name:'expanded-fixture.cassette.zip',mimeType:'application/zip',buffer:fixture});
    await ready();await until(async()=>textFile(await draft(page),'/notes/keep.txt')==='Preserve me through Cancel and Undo.\n','Imported fixture durable');
    await selectFile('/index.js');assert.equal(await currentSource(),LIVE_SOURCE,'Same-path imported source replaces the previous Monaco model');await source(LIVE_SOURCE);
    await page.locator('#synthCodeRunButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Running|Playing/.test(value)),'Code starts');await running();
    await page.evaluate(()=>{
      const host=document.getElementById('synthCodeEditorHost'),editor=window.monaco?.editor?.getEditors().find(item=>host.contains(item.getDomNode()));
      window.__expandedEditorIdentity={editor,model:editor?.getModel()};
      editor?.setPosition({lineNumber:5,column:3});
    });
    await page.locator('#synthWorkspaceCodeButton').click();await assertExpanded(TABS[0]);
    assert(await page.locator('#synthFilesPanel').isVisible(),'Expanded layout opens Files');
    step('Opt-in maximize opens Files and exactly one eight-tab workspace row in the requested order');
    masterLevels=await checkMaster();
    step('Expanded Master changes measured Code PCM at 100/50/0 percent and restores it while the same live loop advances');

    for(const id of TABS) {
      await page.locator('#'+id).click();await ready();await assertExpanded(id);await running();
      for(const width of [1360,390])await layout(id,width);
    }
    await page.setViewportSize({width:1360,height:1000});
    step('All eight tabs preserve maximized mode, the same live loop and held PCM; desktop and mobile layouts fit');

    await page.locator('#synthInputCodeTab').click();await page.locator('#synthInputCodeTab').focus();
    for(const [key,id] of [['ArrowRight',TABS[1]],['End',TABS.at(-1)],['ArrowRight',TABS[0]],['ArrowLeft',TABS.at(-1)],['Home',TABS[0]],['ArrowDown',TABS[1]],['ArrowUp',TABS[0]]]) {
      await page.keyboard.press(key);await ready();await assertExpanded(id);
      assert.equal(await page.evaluate(()=>document.activeElement?.id),id,'Navigation keeps focus on '+id);
    }
    await running();
    step('Arrow keys wrap all eight tabs; Home/End select endpoints and focus stays on the selected tab');

    await selectFile('/lib/second.js');await assertExpanded(TABS[0]);assert.equal(await currentSource(),SECOND_SOURCE);await running();
    assert.equal(await page.evaluate(()=>globalThis.__expandedMustNotRun),undefined);
    await selectFile('/index.js');assert.equal(await currentSource(),LIVE_SOURCE);await running();
    if(await page.locator('#synthCodeMixerButton').isVisible())await page.locator('#synthCodeMixerButton').click();
    else await page.locator('#synthSongMixButton').click();
    await assertExpanded('synthSongMixButton');await running();
    await page.locator('#synthInputCodeTab').click();
    assert(await page.evaluate(()=>{
      const host=document.getElementById('synthCodeEditorHost');
      return !__expandedEditorIdentity.editor||monaco.editor.getEditors().find(item=>host.contains(item.getDomNode()))===__expandedEditorIdentity.editor;
    }),'Same Monaco editor survives views and Files selections');
    await chooseHeaderSynth();
    assert(await page.locator('.synth-editor #synthInputSection').isVisible());
    assert.equal(await page.locator('#synthExpandedTabsSlot').isVisible(),false);
    assert.equal(await currentSource(),LIVE_SOURCE);await running();
    await page.locator('#synthFileSaveButton').click();
    await until(()=>page.locator('#synthFileSaveButton').getAttribute('data-feedback').then(value=>value==='success'),'Code Save feedback');
    assert.equal((await page.locator('#synthFileSaveButton').textContent()).trim(),'✓ Saved');
    assert(await page.locator('#synthFileRevertButton').isHidden(),'Code hides the instrument-only Revert action');
    await page.locator('#synthCodeExpandButton').click();await assertExpanded(TABS[0]);
    await page.locator('#synthCodeExpandButton').click();await assertSynthLayout();
    await page.locator('#synthWorkspaceCodeButton').click();await assertExpanded(TABS[0]);await running();
    step('Files selects JavaScript without running it; Mixer preserves the view; header and icon restore the same editor and running Code to the legacy body');

    await openMenu();
    const order=await page.locator('#synthMenu button').evaluateAll(nodes=>nodes.map(node=>node.id));
    assert(order.indexOf('newCassetteButton')>=0&&order.indexOf('newCassetteButton')<order.indexOf('importCassetteButton'),'New precedes Cassette Import');
    await page.keyboard.press('Escape');
    const beforeCancel=await draft(page),workspaceId=beforeCancel.workspaceId;
    await newDialog();await page.locator('#synthNewCassetteCancel').click();
    await page.locator('#synthNewCassetteDialog').waitFor({state:'hidden'});
    assert.equal((await draft(page)).workspaceId,workspaceId);assert.equal(await currentSource(),LIVE_SOURCE);await running();
    step('Menu places New before Import; cancel preserves workspace, editor and live Code');

    const old=await draft(page),oldPaths=old.project.files.map(item=>item.path);
    await newDialog();await page.locator('#synthNewCassetteCreate').click();
    await page.locator('#synthNewCassetteDialog').waitFor({state:'hidden'});await ready();
    await until(async()=>{const saved=await draft(page);return saved?.workspaceId!==workspaceId&&file(saved,'/index.js')===starter&&!file(saved,'/notes/keep.txt');},'Fresh Cassette durable');
    const fresh=await draft(page);
    assert.equal(fresh.project.cassetteName,'cassette');
    assert.equal(file(fresh,'/lib/second.js'),undefined);assert.equal(file(fresh,'/opaque/keep.bin'),undefined);
    for(const [name,text] of Object.entries(starterExamples))assert.equal(file(fresh,name),text,'Fresh example '+name);
    assert.doesNotMatch(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
    assert.notEqual(await page.locator('#synthSongStatus').getAttribute('data-state'),'playing');
    await until(()=>page.evaluate(()=>__expandedAudioAudit.read().rms<1e-7),'New stops physical audio');
    assert.equal(await page.locator('#presetSelect').inputValue(),'one-op-basic');
    await page.locator('#synthInputCodeTab').click();await assertExpanded('synthInputCodeTab');
    assert.equal(await currentSource(),starter,'First Code open after New shows the fresh starter in the actual editor');
    await page.keyboard.press('Control+s');
    await until(()=>page.locator('#synthFileSaveButton').getAttribute('data-feedback').then(value=>value==='success'),'New starter save feedback');
    await until(async()=>textFile(await draft(page),'/index.js')===starter,'Opening and saving New starter preserves its durable source');
    step('New Cassette first Code open shows the fresh starter and saving it preserves the durable source');
    await page.locator('#synthInputKeyboardTab').click();await assertExpanded('synthInputKeyboardTab');
    await page.locator('#keyboard .key[data-key="a"]').click();
    await page.locator('#synthInputKeyboardTab').focus();await page.keyboard.down('a');
    await until(()=>page.locator('#keyboard .key[data-key="a"]').evaluate(node=>node.classList.contains('is-active')),'Expanded keyboard playable');
    await page.keyboard.up('a');
    await until(()=>page.locator('#keyboard .key[data-key="a"]').evaluate(node=>!node.classList.contains('is-active')),'Expanded keyboard releases');
    assert.equal(await page.locator('#synthFileUndoButton').isEnabled(),true);
    await page.locator('#synthFileUndoButton').click();await ready();
    await until(async()=>textFile(await draft(page),'/notes/keep.txt')==='Preserve me through Cancel and Undo.\n','Undo restores old Cassette');
    const restored=await draft(page);assert.deepEqual(restored.project.files.map(item=>item.path).sort(),oldPaths.sort());
    for(const item of old.project.files)assert.deepEqual(file(restored,item.path),item.data,'Undo restores '+item.path);
    assert.doesNotMatch(await page.locator('#synthCodeState').textContent(),/Playing|Running/,'Undo never runs restored Code');
    step('Confirmed New stops live Code, clears old files, resets default sound and starter/examples; expanded Keyboard plays and Files Undo restores every prior file without running Code');

    await page.locator('#tfiFile').setInputFiles({name:'reset-fixture.vgm',mimeType:'application/octet-stream',buffer:authoredVgm()});await ready();
    await page.locator('#synthChipTabPsg').click();await ready();await assertExpanded('synthChipTabPsg');
    await page.locator('#synthSongPlayButton').click();
    await until(()=>page.locator('#synthSongStatus').getAttribute('data-state').then(value=>value==='playing'),'VGM starts before New');
    await newDialog();await page.locator('#synthNewCassetteCreate').click();await page.locator('#synthNewCassetteDialog').waitFor({state:'hidden'});await ready();
    await until(async()=>file(await draft(page),'/index.js')===starter&&!file(await draft(page),'/notes/keep.txt'),'Second fresh draft durable');
    assert.notEqual(await page.locator('#synthSongStatus').getAttribute('data-state'),'playing');
    await until(()=>page.evaluate(()=>__expandedAudioAudit.read().rms<1e-7),'New stops VGM audio');
    await page.reload();await ready();
    const reloaded=await draft(page);assert.equal(file(reloaded,'/index.js'),starter);assert.equal(file(reloaded,'/notes/keep.txt'),undefined);
    assert.doesNotMatch(await page.locator('#synthCodeState').textContent(),/Playing|Running/,'Fresh draft reload does not execute starter');
    assert.equal(await page.locator('#presetSelect').inputValue(),'one-op-basic');
    const audio=await page.evaluate(()=>__expandedAudioAudit.read());assert(audio.physicallyMuted&&audio.finite);assert.deepEqual(audio.rejections,[]);
    assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-fresh-reloaded.png`),fullPage:true});
    step('A second New stops a playing VGM; reload retains the fresh workspace and default sound without executing starter Code');
    return {browser:name,editor:config.editor,passed:true,checks,masterLevels,audio,cdnFailures,errors,consoleErrors};
  } catch(error) {
    error.caseResult={browser:name,editor:config.editor,passed:false,checks,failure:error.stack??String(error),cdnUnavailable:error.cdnUnavailable,
      audio:await page.evaluate(()=>__expandedAudioAudit?.read()).catch(()=>null),masterLevels,errors,consoleErrors,cdnFailures,
      status:await page.locator('#status').textContent().catch(()=>null),codeState:await page.locator('#synthCodeState').textContent().catch(()=>null),
      newError:await page.locator('#synthNewCassetteError').textContent().catch(()=>null),
      displayedSource:await currentSource().catch(()=>null),storedIndex:await draft(page).then(saved=>textFile(saved,'/index.js')).catch(()=>null)};
    await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-failed.png`),fullPage:true}).catch(()=>{});
    throw error;
  } finally {await context.close();}
}
(async()=>{
  const {createPlaygroundCassetteZip}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')));
  const {createTfiFromPreset}=await import(pathToFileURL(path.join(repo,'docs/js/tfi.js')));
  const {FM_CODE_EXAMPLES}=await import(pathToFileURL(path.join(repo,'docs/synth/synth_code_examples.js')));
  const fixture=Buffer.from(createPlaygroundCassetteZip([
    {path:'/index.js',type:'text',data:LIVE_SOURCE},{path:'/lib/second.js',type:'text',data:SECOND_SOURCE},
    {path:'/notes/keep.txt',type:'text',data:'Preserve me through Cancel and Undo.\n'},
    {path:'/opaque/keep.bin',type:'binary',data:new Uint8Array([0,255,128,13,10])},
    {path:'/presets/custom.tfi',type:'binary',data:createTfiFromPreset({algorithm:4,feedback:2,operators:{1:{multi:2,ar:23,tl:12},2:{ar:17,tl:24},3:{ar:20,tl:18},4:{ar:31,tl:8}}})},
  ],{metadata:{title:'Expanded browser fixture'},directories:['/old-empty']}));
  await fs.mkdir(config.screenshots,{recursive:true});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,report={schemaVersion:1,root:config.root,entry:config.entry,editor:config.editor,
    physicalOutputMuted:true,listeningPerformed:false,results};
  try {
    for(const name of engines) {
      const browser=await ({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});
      try{results.push(await run(browser,name,origin,fixture,FM_CODE_EXAMPLES));}finally{await browser.close();}
    }
    assert.deepEqual(missing,[],'No missing source or packaged assets');assert.deepEqual(external,[],'No unexpected external requests');report.passed=true;
  } catch(error) {
    if(error.caseResult)results.push(error.caseResult);report.passed=false;report.failure=error.stack??String(error);
    report.status=error.cdnUnavailable?'cdn-unavailable':'failed';process.exitCode=error.cdnUnavailable?2:1;console.error(report.failure);
  } finally {
    server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));
    Object.assign(report,{missing,external,cdn,checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});
    await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
