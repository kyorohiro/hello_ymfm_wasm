// SPDX-License-Identifier: BSD-3-Clause
// Focused timed-operation source/readable-ZIP checks. Every physical output is
// muted before app boot. --monaco-root points at pinned 0.52.2 min/vs assets.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),evidence=path.join(repo,'build/sid-timed-20261121');
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
const CODE='/index.js',TONE='/presets/Timed.sid-channels.json',DB='tetorica-sid-synth-files';
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
  async function read(method='read',args=[]){
    const node=nodes.findLast(item=>item.name==='tetorica-sid-synth')?.node;if(!node)throw Error('SID Worklet missing');const id=--serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Native read timeout'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});
  }
  window.__sidTimedAudit={read,commands:()=>commands.slice(),output:()=>meters.map(sample).sort((a,b)=>b.acRms-a.acRms)[0]??null,
    state:()=>({contexts:contexts.length,nodeNames:nodes.map(item=>item.name),destinationConnections:meters.length,
      physicallyMuted:meters.every(item=>item.mute.gain.value===0),rejections:rejections.slice()})};
}
async function draft(page){return page.evaluate(name=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');
    tx.oncomplete=()=>{db.close();resolve(read.result??null);};tx.onabort=()=>{db.close();reject(tx.error??read.error);};};
}),DB);}
const PLAY=`const sid=await useSoundChip('sid');
setBpm(120);
context.visits=Number(context.visits??0)+1;
const shared=await livePrepare('timed-phase',()=>({ticks:0}));
/** @type {any} */ const probe=globalThis.__sidTimedProbe={sid,context,shared,builds:0,loop:0,plan:null,rows:null,snapshot:null};
const plan=sid.build(b=>{probe.builds++;b.setVoice(CH1,{waveform:'saw',attack:0,decay:0,sustain:12,release:4}).setFrequency(CH1,329.63).keyOn(CH1).keyOn(CH1);b.atSample(2205).setVoice(CH1,{sync:false});});
probe.plan=plan;
probe.snapshot=await sid.captureState();
probe.rows=await sid.compile(plan,{initialState:probe.snapshot});
probe.current=await sid.compile(plan);
probe.again=await sid.compile(plan,{initialState:probe.snapshot});
try{await sid.compile(plan,{initialState:'client'});}catch(error){probe.clientError=error.message;}
await sid.schedule(plan,{name:'timed-main',repeatSeconds:.4});
liveFx('timed-quiet',{context:{gain:.55},process(input,output,state,ctx){for(let c=0;c<output.length;c++)for(let i=0;i<output[c].length;i++)output[c][i]=(input[c]?.[i]??0)*ctx.gain;}});
liveLoop('ticks',async()=>{probe.loop++;shared.ticks++;await beat(.05);});
`;
const EDIT=PLAY.replace('repeatSeconds:.4','repeatSeconds:20');
const REPLACE=`const sid=await useSoundChip('sid');
const shared=await livePrepare('timed-phase',()=>({ticks:0}));
globalThis.__sidTimedReplaced={sid,shared,context,ticks:0};
await sid.schedule(sid.build(b=>b.setFrequency(CH1,440).keyOn(CH1)),{name:'timed-main',repeatSeconds:20});
liveFx('timed-quiet',{context:{gain:.55},process(input,output,state,ctx){for(let c=0;c<output.length;c++)for(let i=0;i<output[c].length;i++)output[c][i]=(input[c]?.[i]??0)*ctx.gain;}});
liveLoop('ticks',async()=>{__sidTimedReplaced.ticks++;shared.ticks++;if(globalThis.__sidTimedRequestClear&&!globalThis.__sidTimedCleared){await sid.clearSchedule('timed-main');globalThis.__sidTimedCleared=true;}await beat(.05);});
`;
const BAD=`const sid=await useSoundChip('sid');
await sid.schedule(sid.build(b=>b.noteOn(CH1,'C6')),{name:'timed-main',repeatSeconds:.4});
throw new Error('intentional failed Apply after staging');
`;
const INVALID=`const sid=await useSoundChip('sid');
await sid.schedule(sid.build(b=>b.keyOn(99)),{name:'timed-main',repeatSeconds:.4});
`;
const OWNED=`const sid=await useSoundChip('sid');
let started=false;
liveLoop('owned',async()=>{if(!started){await sid.schedule(sid.build(b=>b.noteOn(CH1,'G4')),{name:'loop-owned',repeatSeconds:.1});started=true;}await beat(.05);});
liveLoop('keep',async()=>{await beat(.05);});
`;
const STOP_LOOP=`stopLoop('owned');
globalThis.__sidTimedLoopStopped=true;
liveLoop('keep',async()=>{await beat(.05);});
`;
const NEW_MODEL=`const sid=await useSoundChip('sid');
try{await sid.compile(__sidTimedOriginalSnapshotPlan,{initialState:__sidTimedOriginalSnapshot});}catch(error){globalThis.__sidTimedOldModelError=error.message;}
const plan=sid.build(b=>b.setVoice(CH1,{waveform:'saw',attack:0,decay:0,sustain:12,release:4,sync:false,ring:false,test:false}).noteOn(CH1,'C4'));
globalThis.__sidTimedNewModel={sid,plan,snapshot:await sid.captureState(),rows:await sid.compile(plan)};
await sid.schedule(plan,{name:'new-model',repeatSeconds:.1});
liveLoop('keep',async()=>{await beat(.05);});
`;
async function definition(page, {needle, symbol, file, sourceSymbol}) {
  const navigation = await page.evaluate(async ({needle, symbol}) => {
    const host = document.getElementById('synthCodeEditorHost');
    const editor = monaco.editor.getEditors().find(item => host.contains(item.getDomNode()));
    const model = editor.getModel(), index = model.getValue().indexOf(needle);
    if (index < 0) throw Error('Definition probe missing: ' + needle);
    // Overloaded hardware methods can have several declaration locations.
    // Follow the first through the public editor opener instead of a peek list.
    editor.updateOptions({gotoLocation: {multipleDefinitions: 'goto'}});
    editor.setPosition(model.getPositionAt(index + needle.indexOf(symbol) + 1));
    editor.focus();
    const action = editor.getAction('editor.action.revealDefinition');
    // Registered editor commands need not appear in getAction(). trigger() is
    // the public command route also used by the app's source-view context menu.
    // The visible dialog and requested source model are still asserted below.
    if (action) await action.run();
    else editor.trigger('synth-code-monaco-check', 'editor.action.revealDefinition', {});
    return {dispatch: action ? 'action.run' : 'editor.trigger',
      relatedActions: editor.getSupportedActions().map(item => item.id).filter(id => /defin|declar|symbol/i.test(id))};
  }, {needle, symbol});
  const dialog = page.locator('dialog[data-monaco-definition="true"]');
  await dialog.waitFor({state: 'visible'}).catch(error => {
    throw Error(`${error.message}\nNavigation diagnostic: ${JSON.stringify(navigation)}`);
  });
  await page.waitForFunction(() => {
    const dialog = document.querySelector('dialog[data-monaco-definition="true"]');
    return dialog?.open && dialog.querySelector('strong')?.textContent.endsWith('.d.ts (read-only)');
  });
  await dialog.getByRole('button', {name: 'View implementation', exact: true}).click();
  await page.waitForFunction(file => {
    const dialog = document.querySelector('dialog[data-monaco-definition="true"]');
    return dialog?.querySelector('strong')?.textContent === file + ' (read-only)' ||
      /Could not load/.test(dialog?.querySelector('[role="status"]')?.textContent ?? '');
  }, file);
  assert.equal(await dialog.locator('strong').textContent(), file + ' (read-only)',
    await dialog.locator('[role="status"]').textContent());
  const result = await page.evaluate(file => {
    const model = monaco.editor.getModels().find(item => item.uri.path === '/tetorica-runtime/' + file);
    const editor = monaco.editor.getEditors().find(item => item.getModel() === model);
    return model && editor ? {
      path: model.uri.path, text: model.getValue(), position: editor.getPosition(),
      readOnly: editor.getOption(monaco.editor.EditorOption.readOnly),
      line: model.getLineContent(editor.getPosition().lineNumber),
    } : null;
  }, file);
  assert(result, 'Implementation opens a real Monaco source model');
  assert(result.readOnly, 'Implementation is read-only');
  assert(result.text.length > 1000 && result.text.split('\n').length > 30, 'Readable source, not a stub');
  assert(result.position.lineNumber > 1, 'Implementation navigates to the function');
  assert(result.line.includes(sourceSymbol ?? symbol), 'Implementation points to the requested symbol');
  const receipt = {file, symbol, bytes: Buffer.byteLength(result.text),
    sha256: hash(result.text), line: result.position.lineNumber, readOnly: result.readOnly, navigation};
  await dialog.getByRole('button', {name: 'Close', exact: true}).click();
  return receipt;
}

async function check(browser,name,origin,fixture){
  const context=await browser.newContext({viewport:{width:1360,height:1050},serviceWorkers:'block'}),page=await context.newPage();
  const checks=[],measurements={},errors=[],rawConsoleErrors=[],consoleErrors=[],expectedConsoleErrors=[],cdnFailures=[],abortedMonaco=new Set();
  page.setDefaultTimeout(25000);await context.addInitScript(installAudit);
  page.on('pageerror',error=>errors.push(error.stack??error.message));page.on('console',message=>{if(message.type()==='error')rawConsoleErrors.push({text:message.text(),location:message.location()});});
  function classifyErrors(){consoleErrors.length=0;expectedConsoleErrors.length=0;for(const error of rawConsoleErrors){const expected=config.editor==='fallback'&&isMonaco(error.location.url)&&abortedMonaco.has(error.location.url)&&/^Failed to load resource(?::|$)/i.test(error.text);(expected?expectedConsoleErrors:consoleErrors).push(error);}}
  page.on('requestfailed',request=>{if(isMonaco(request.url()))cdnFailures.push(request.url());});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    if(isMonaco(url.href)){
      cdn.push(url.href);if(config.editor==='fallback'){abortedMonaco.add(url.href);return route.abort();}
      const relative=decodeURIComponent(url.pathname.split('/min/vs/')[1]);let fixturePath=relative,filename=path.resolve(config.monacoRoot,relative);assert(filename.startsWith(path.resolve(config.monacoRoot)+path.sep));
      try{let body;try{body=await fs.readFile(filename);}catch(error){if(error.code!=='ENOENT'||!relative.endsWith('.min.js'))throw error;fixturePath=relative.replace(/\.min\.js$/,'.js');filename=path.resolve(config.monacoRoot,fixturePath);body=await fs.readFile(filename);}localMonaco.set(relative,{fixturePath,bytes:body.length,sha256:hash(body)});return route.fulfill({status:200,contentType:mime[path.extname(filename)]??'application/octet-stream',body,headers:{'Access-Control-Allow-Origin':'*'}});}catch{cdnFailures.push(url.href);return route.abort();}
    }external.push(url.href);return route.abort();
  });
  const step=message=>{checks.push(message);console.log(`CHECK ${name}/${config.editor}: ${message}`);};
  const ready=()=>until(()=>page.locator('#sidFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');
  const read=(method='read')=>page.evaluate(method=>__sidTimedAudit.read(method),method),output=()=>page.evaluate(()=>__sidTimedAudit.output()),audit=()=>page.evaluate(()=>__sidTimedAudit.state());
  const currentSource=()=>page.evaluate(()=>window.monaco?.editor?.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))?.getValue()??document.getElementById('synthCodeEditor').value);
  async function editorReady(){await until(()=>page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))||/Fallback|unavailable|could not load/i.test(document.getElementById('synthCodeEditorNote').textContent)),'Editor initialization',60000);assert.equal(await page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))),config.editor==='monaco');}
  async function source(value){if(config.editor==='fallback')await page.locator('#synthCodeEditor').fill(value);else await page.evaluate(value=>monaco.editor.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).setValue(value),value);await until(()=>draft(page).then(state=>state?.workspace?.saved?.files.find(file=>file.path===CODE)?.data===value),'Saved Code source');assert.equal(await currentSource(),value);}
  async function apply(value){await page.locator('#synthInputCodeTab').click();await source(value);await page.locator('#synthCodeApplyButton').click();}
  async function audible(hz){await until(async()=>{const value=await output();return value?.finite&&value.muted&&value.acRms>1e-5&&Math.abs(value.frequency-hz)<8;},'PCM '+hz+'Hz');return output();}
  async function silent(){await until(async()=>{const value=await output();return !value||value.acRms<1e-6;},'Silent output');}
  async function choose(id){await page.locator('#'+id).click();await until(()=>page.locator('#'+id).getAttribute('aria-selected').then(value=>value==='true'),'View '+id);}
  async function stop(){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code Stop');await silent();}
  const begins=()=>page.evaluate(()=>__sidTimedAudit.commands().filter(row=>row.method==='beginCode').length);
  try{
    await page.goto(origin+config.entry);await ready();await page.locator('#sidFilesToggle').click();
    await page.locator('#sidProjectFileInput').setInputFiles({name:'timed.cassette.zip',mimeType:'application/zip',buffer:fixture.cassette});await page.locator('#sidImportCassetteDialog').waitFor({state:'visible'});await page.locator('#sidImportCassetteReplace').click();await page.locator('#sidImportCassetteDialog').waitFor({state:'hidden'});await ready();
    await page.locator('#synthWorkspaceCodeButton').click();await editorReady();assert.equal((await audit()).contexts,0,'opening Code starts no sound');
    await page.locator('#synthCodeRunButton').click();await until(()=>page.evaluate(()=>Boolean(globalThis.__sidTimedProbe?.rows?.length&&globalThis.__sidTimedProbe.loop>1)),'Timed program started');measurements.initial=await audible(329.63);
    const compilation=await page.evaluate(()=>({builds:__sidTimedProbe.builds,plan:__sidTimedProbe.plan,rows:__sidTimedProbe.rows,again:__sidTimedProbe.again,current:__sidTimedProbe.current,snapshot:__sidTimedProbe.snapshot,clientError:__sidTimedProbe.clientError}));
    assert.equal(compilation.builds,1);assert.deepEqual(compilation.rows,compilation.again);assert(compilation.rows.filter(row=>row.register===4&&row.value&1).length>=2,'same-value Gate writes retained');assert(compilation.rows.every(row=>Number.isFinite(row.offsetSeconds)&&Number.isInteger(row.register)&&Number.isInteger(row.value)));assert.match(compilation.clientError,/Incomplete/);
    assert.equal(compilation.snapshot.format,'tetorica-sid-state');assert(compilation.snapshot.sampleRate>=44100);assert.equal(compilation.plan.referenceSampleRate,44100);
    const native=await read('observeCode');assert(native.positionFrames>0);assert.equal(native.registers[4]&1,1);
    const scheduleCount=()=>page.evaluate(()=>__sidTimedAudit.commands().filter(row=>row.method==='codeTimed'&&['stage','schedule'].includes(row.args?.[1]?.action)).length);
    const scheduleMessages=await scheduleCount(),tick=await page.evaluate(()=>__sidTimedProbe.loop);await pause(1000);assert((await page.evaluate(()=>__sidTimedProbe.loop))>tick);assert.equal(await scheduleCount(),scheduleMessages,'compact repeat needs no JS reservation repost');await audible(329.63);
    measurements.compilation=compilation;step('build runs once; current/reused snapshots retain Gate events, incomplete client state rejects, and compact Worklet repeats drive the actual 6581');

    const firstBegin=await begins();await page.evaluate(()=>{globalThis.__sidTimedIdentity={context:__sidTimedProbe.context,shared:__sidTimedProbe.shared};globalThis.__sidTimedOriginalSnapshot=__sidTimedProbe.snapshot;globalThis.__sidTimedOriginalSnapshotPlan=__sidTimedProbe.plan;});
    for(const id of ['sidChipTab','synthInputKeyboardTab','synthInputCodeTab']){await choose(id);await audible(329.63);}
    assert.equal(await begins(),firstBegin);
    await apply(REPLACE);await until(()=>page.evaluate(()=>Boolean(globalThis.__sidTimedReplaced?.ticks>1)),'Applied pattern');measurements.replaced=await audible(440);assert.equal(await begins(),firstBegin);assert(await page.evaluate(()=>__sidTimedReplaced.context===__sidTimedIdentity.context&&__sidTimedReplaced.shared===__sidTimedIdentity.shared));
    await apply(BAD);await until(()=>page.locator('#synthCodeError').textContent().then(value=>value.includes('intentional failed Apply')),'Failed Apply reported');await pause(500);await audible(440);assert.equal(await begins(),firstBegin);
    await apply(INVALID);await until(()=>page.locator('#synthCodeError').textContent().then(value=>/channel|integer|0\.\.2/i.test(value)),'Invalid reservation rejected');await pause(500);await audible(440);assert.equal(await begins(),firstBegin);step('Code/SID/Keyboard navigation and Apply reuse the same lease/context; failed or invalid staged replacements preserve the previous pattern');

    await choose('sidChipTab');await page.locator('[data-sid-live-voice="0"]').click();
    await page.keyboard.down('a');await until(()=>read().then(value=>value.voices.length===1),'Manual CH1 note');const manual=await read();
    await page.evaluate(()=>{globalThis.__sidTimedRequestClear=true;});await until(()=>page.evaluate(()=>globalThis.__sidTimedCleared===true),'Pattern clear');await pause(600);const afterClear=await read();assert.deepEqual(afterClear.voices,manual.voices,'clear cannot release later manual Gate');assert.equal(afterClear.registers[4]&1,1);assert((await output()).acRms>1e-5);await page.keyboard.up('a');await until(()=>read().then(value=>value.voices.length===0),'Manual key release');await silent();step('Later manual keyboard Gate survives clearing the old timed reservation and still releases normally');

    await apply(OWNED);measurements.owned=await audible(392);await apply(STOP_LOOP);await until(()=>page.evaluate(()=>globalThis.__sidTimedLoopStopped===true),'stopLoop evaluated');await silent();assert.equal((await read('observeCode')).registers[4]&1,0);await pause(500);assert.equal((await read('observeCode')).registers[4]&1,0);assert.equal(await begins(),firstBegin);step('stopLoop releases its owned Gate and cancels compact repeats without later revival');

    await apply(EDIT);await audible(329.63);await choose('sidChipTab');await page.locator('[data-sid-live-voice="0"]').click();
    const modCard=page.locator('#syncEnabled').locator('xpath=ancestor::details[1]');if(!await modCard.evaluate(node=>node.open))await modCard.locator('summary').click();
    // Live controls publish after their audio-thread ACK. A poll may repaint
    // the preceding sample before that ACK, so assert the actual applied byte
    // rather than Playwright.check()'s immediate DOM postcondition.
    await page.locator('#syncEnabled').click();
    await until(()=>read('observeCode').then(value=>Boolean(value.registers[4]&2)),'Live Sync patch applied');assert.equal((await read('observeCode')).registers[4]&1,1);await pause(150);assert.equal((await read('observeCode')).registers[4]&1,1);step('Live selected-channel parameter edit preserves the scheduled Gate and uses the same SID register state');
    if(await page.locator('#sidLiveEnabled').isChecked())await page.locator('#sidLiveEnabled').uncheck();
    await until(()=>page.locator('#voiceEditor').getAttribute('data-observing').then(value=>value==='false'),'Authoring mode');
    await page.locator('[data-choice-for="sidModel"][data-value="8580"]').click();await until(()=>read().then(value=>value.model==='8580'),'8580 model accepted');await silent();assert.match(await page.locator('#synthCodeState').textContent(),/Playing|Running/);
    await apply(NEW_MODEL);await until(()=>page.evaluate(()=>Boolean(globalThis.__sidTimedNewModel?.rows?.length)),'New-model pattern');measurements.model8580=await audible(261.63);const afterModel=await page.evaluate(()=>({snapshot:__sidTimedNewModel.snapshot,error:__sidTimedOldModelError}));assert.equal(afterModel.snapshot.state.model,'8580');assert.match(afterModel.error,/model|compatible|configuration/i);measurements.afterModel=afterModel;
    await stop();const restored=await read();assert.equal(restored.model,'8580');assert([4,11,18].every(register=>!(restored.registers[register]&1)));await pause(450);await silent();
    const stale=await page.evaluate(async()=>{try{await __sidTimedNewModel.sid.schedule(__sidTimedNewModel.plan,{name:'late'});return false;}catch(error){return error.name==='AbortError';}});assert(stale);step('Successful 6581→8580 replacement clears old patterns but keeps Code usable, rejects incompatible snapshots, and Stop prevents stale lease revival');
    await choose('synthInputCodeTab');await source(PLAY);await page.locator('#synthCodeRunButton').click();await until(()=>page.evaluate(()=>__sidTimedProbe?.snapshot?.state?.model==='8580'&&__sidTimedProbe.loop>1),'New Run on 8580');await audible(329.63);await stop();assert.equal(await begins(),firstBegin+1);step('A new Run obtains a fresh reusable 8580 lease and scheduled sound remains audible internally');

    if(config.editor==='monaco'){
      await source(PLAY);const info=await page.evaluate(async()=>{const editor=monaco.editor.getEditors().find(e=>document.getElementById('synthCodeEditorHost').contains(e.getDomNode())),model=editor.getModel(),worker=await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri);const text=model.getValue(),at=text.indexOf('sid.build')+5;return worker.getQuickInfoAtPosition(model.uri.toString(),at);});assert(info);assert(info.displayParts.map(part=>part.text).join('').includes('build'));measurements.monacoBuildType=info.displayParts.map(part=>part.text).join('');
      measurements.sourceNavigation=[];for(const target of [{needle:'sid.build',symbol:'build',file:'sid_operations.js',sourceSymbol:'buildSidOperations'},{needle:'sid.captureState',symbol:'captureState',file:'sid_timed_client.js',sourceSymbol:'attachSidTimedClient'}])measurements.sourceNavigation.push(await definition(page,target));
    }
    for(const width of [1360,390]){await page.setViewportSize({width,height:1050});await pause(400);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-timed-${width}.png`),fullPage:true});}
    classifyErrors();measurements.audit=await audit();assert(measurements.audit.physicallyMuted);assert.deepEqual(measurements.audit.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);if(config.editor==='monaco'){assert.deepEqual(rawConsoleErrors,[]);assert.deepEqual(cdnFailures,[]);}return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
  }catch(error){classifyErrors();error.caseResult={browser:name,editor:config.editor,passed:false,checks,measurements,error:error.stack??String(error),status:await page.locator('#audioStatus').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),native:await read('observeCode').catch(()=>null),output:await output().catch(()=>null),audit:await audit().catch(()=>null),errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-failed.png`),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();}
}
// Shared Main/primary and transferred Worker clients use the same actual
// standalone Worklet, not the Synth's borrowed RPC facade or a mocked endpoint.
async function publicRoutes(browser,name,origin){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  await context.addInitScript(installAudit);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  try{
    await page.goto(origin+config.entry);await page.locator('body').click({position:{x:4,y:4}});
    const models=await page.evaluate(async()=>{
      const {createSidAudio}=await import('/js/playground_sid_audio.js');
      const {createNativePrimaryClient}=await import('/js/playground_native_primary.js');
      const results=[];
      for(const model of ['6581','8580']){
        const ctx=new AudioContext({sampleRate:48000});await ctx.resume();
        const endpoint=await createSidAudio(ctx,ctx.destination,{model});
        const sid=createNativePrimaryClient('sid',endpoint.port,endpoint);
        sid.setVoice(0,{waveform:'saw',attack:0,decay:0,sustain:12,release:4});
        const snapshot=await sid.captureState(),plan=sid.build(b=>b.noteOn(0,'E4').keyOn(0));
        const main={snapshot,client:await sid.compile(plan,{initialState:'client'}),current:await sid.compile(plan),reused:await sid.compile(plan,{initialState:snapshot})};
        await sid.schedule(plan,{name:'main',repeatSeconds:.1});await new Promise(resolve=>setTimeout(resolve,150));main.applied=await sid.captureState();await sid.clearSchedule('main');
        const channel=new MessageChannel();endpoint.node.port.postMessage({primaryWorker:true,port:channel.port2},[channel.port2]);
        const moduleUrl=new URL('/js/playground_native_primary.js',location.href).href;
        const source=`import {createNativePrimaryClient} from ${JSON.stringify(moduleUrl)};
          onmessage=async({data})=>{try{const sid=createNativePrimaryClient('sid',data.port,{model:data.model});
            sid.setVoice(0,{waveform:'pulse',pulseWidth:1000,attack:0,decay:0,sustain:11,release:4});
            const plan=sid.build(b=>b.noteOn(0,'G4').keyOn(0));
            const local=await sid.compile(plan,{initialState:'client'}),current=await sid.compile(plan);
            await sid.schedule(plan,{name:'worker',repeatSeconds:.1});await new Promise(resolve=>setTimeout(resolve,150));
            const applied=await sid.captureState();await sid.clearSchedule('worker');
            postMessage({plan,local,current,applied});sid._timedOperations.detach();data.port.close();
          }catch(error){postMessage({error:error.stack??String(error)});}};`;
        const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});
        let remote;try{remote=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Worker SID timed timeout')),10000);worker.onmessage=event=>{clearTimeout(timeout);resolve(event.data);};worker.onerror=event=>{clearTimeout(timeout);reject(Error(event.message));};worker.postMessage({port:channel.port1,model},[channel.port1]);});}
        finally{worker.terminate();URL.revokeObjectURL(url);endpoint.node.port.postMessage({primaryWorker:true});}
        results.push({model,main,worker:remote,audit:__sidTimedAudit.state()});sid._timedOperations.detach();endpoint.dispose();await ctx.close();
      }
      return results;
    });
    assert.deepEqual(errors,[]);
    for(const value of models){assert.equal(value.worker.error,undefined);assert(value.audit.physicallyMuted);assert.deepEqual(value.main.client,value.main.current);assert.deepEqual(value.main.current,value.main.reused);
      assert.equal(value.main.snapshot.sampleRate,48000);assert.equal(value.main.snapshot.state.model,value.model);assert(value.main.applied.frame>value.main.snapshot.frame);assert.equal(value.main.applied.state.registers[4]&1,1);
      assert.equal(value.worker.applied.sampleRate,48000);assert.equal(value.worker.applied.state.model,value.model);assert.deepEqual(value.worker.local,value.worker.current);assert.equal(value.worker.applied.state.registers[4]&1,1);assert.equal(value.worker.plan.operations.length,2);}
    console.log(`CHECK ${name}: actual 48kHz standalone 6581/8580 Main/primary and transferred Worker ports compile and schedule`);
    return{browser:name,passed:true,models};
  }finally{await context.close();}
}
(async()=>{
  const [{createSidCodeProject},{createDefaultPreset},{createChannelSettings}]=await Promise.all([import(pathToFileURL(path.join(repo,'docs/synth-sid/code_project.js'))),import(pathToFileURL(path.join(repo,'docs/synth-sid/preset.js'))),import(pathToFileURL(path.join(repo,'docs/synth-sid/channel_settings.js')))]);
  const voice=createDefaultPreset();voice.name='Timed';voice.voice.waveform='saw';voice.voice.attack=0;voice.voice.decay=0;voice.voice.sustain=12;voice.voice.release=4;voice.modulation.sync=false;voice.modulation.ring=false;voice.filter.enabled=false;
  const preset=createChannelSettings(voice),project=createSidCodeProject({settings:preset,starterCode:PLAY});project.importFiles([{path:TONE,type:'text',data:JSON.stringify(preset,null,2)+'\n'}]);const fixture={preset,cassette:Buffer.from(await project.exportProject())};
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`,report={schemaVersion:1,root:config.root,entry:config.entry,editor:config.editor,physicalOutputMuted:true,listeningPerformed:false,networkAccessUsed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,fixture));if(config.root===path.join(repo,'docs'))(report.publicRoutes??=[]).push(await publicRoutes(browser,name,origin));}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;}
  catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.error=error.stack??String(error);process.exitCode=1;console.error(report.error);}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,cdn,localMonaco:Object.fromEntries(localMonaco),checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
