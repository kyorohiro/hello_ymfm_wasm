// SPDX-License-Identifier: BSD-3-Clause
// Focused timed-operation source/readable-ZIP checks. Every physical output is
// muted before app boot. --monaco-root points at pinned 0.52.2 min/vs assets.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),evidence=path.join(repo,'build/dmg-timed-20261120');
const config={root:path.join(repo,'docs'),entry:'/synth-dmg/index.html',engines:'chromium,webkit',editor:'fallback',
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
const CODE='/index.js',TONE='/presets/Timed.dmg.json',SONG='/vgm/timed.vgm',DB='tetorica-dmg-synth-files';
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
    const node=nodes.findLast(item=>item.name==='tetorica-gameboy-synth')?.node;if(!node)throw Error('DMG Worklet missing');const id=--serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Native read timeout'));},5000);
      function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
      node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({id,method,args});});
  }
  window.__dmgTimedAudit={read,commands:()=>commands.slice(),output:()=>meters.map(sample).sort((a,b)=>b.acRms-a.acRms)[0]??null,
    state:()=>({contexts:contexts.length,nodeNames:nodes.map(item=>item.name),destinationConnections:meters.length,
      physicallyMuted:meters.every(item=>item.mute.gain.value===0),rejections:rejections.slice()})};
}
async function draft(page){return page.evaluate(name=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects','readonly'),read=tx.objectStore('projects').get('current');
    tx.oncomplete=()=>{db.close();resolve(read.result??null);};tx.onabort=()=>{db.close();reject(tx.error??read.error);};};
}),DB);}
const PLAY=`const gb=await useSoundChip('gameboy');
setBpm(120);
context.visits=(context.visits??0)+1;
const shared=await livePrepare('timed-phase',()=>({ticks:0}));
const probe=globalThis.__dmgTimedProbe={gb,context,shared,builds:0,loop:0,plan:null,rows:null,snapshot:null};
const plan=gb.build(b=>{probe.builds++;b.pulse.setVoice(CH1,{duty:.25,volume:9,envelope:{direction:'down',period:0}}).pulse.setFrequency(CH1,329.63).pulse.keyOn(CH1).pulse.keyOn(CH1);b.atSample(2205).pulse.setDuty(CH1,.5);});
probe.plan=plan;
probe.snapshot=await gb.captureState();
probe.rows=await gb.compile(plan,{initialState:probe.snapshot});
probe.current=await gb.compile(plan);
probe.again=await gb.compile(plan,{initialState:probe.snapshot});
try{await gb.compile(plan,{initialState:'client'});}catch(error){probe.clientError=error.message;}
await gb.schedule(plan,{name:'timed-main',repeatSeconds:.4});
liveFx('timed-quiet',{context:{gain:.55},process(input,output,state,ctx){for(let c=0;c<output.length;c++)for(let i=0;i<output[c].length;i++)output[c][i]=(input[c]?.[i]??0)*ctx.gain;}});
liveLoop('ticks',async()=>{probe.loop++;shared.ticks++;await beat(.05);});
`;
const REPLACE=`const gb=await useSoundChip('gameboy');
const shared=await livePrepare('timed-phase',()=>({ticks:0}));
globalThis.__dmgTimedReplaced={gb,shared,context,ticks:0};
await gb.schedule(gb.build(b=>b.pulse.setFrequency(CH1,440).pulse.keyOn(CH1)),{name:'timed-main',repeatSeconds:20});
liveFx('timed-quiet',{context:{gain:.55},process(input,output,state,ctx){for(let c=0;c<output.length;c++)for(let i=0;i<output[c].length;i++)output[c][i]=(input[c]?.[i]??0)*ctx.gain;}});
liveLoop('ticks',async()=>{__dmgTimedReplaced.ticks++;shared.ticks++;if(globalThis.__dmgTimedRequestClear&&!globalThis.__dmgTimedCleared){await gb.clearSchedule('timed-main');globalThis.__dmgTimedCleared=true;}await beat(.05);});
`;
const BAD=`const gb=await useSoundChip('gameboy');
await gb.schedule(gb.build(b=>b.pulse.noteOn(CH1,'C6')),{name:'timed-main',repeatSeconds:.4});
throw new Error('intentional failed Apply after staging');
`;
const INVALID=`const gb=await useSoundChip('gameboy');
await gb.schedule(gb.build(b=>b.keyOn(99)),{name:'timed-main',repeatSeconds:.4});
`;
const OWNED=`const gb=await useSoundChip('gameboy');
let started=false;
liveLoop('owned',async()=>{if(!started){await gb.schedule(gb.build(b=>b.pulse.noteOn(CH1,'G4')),{name:'loop-owned',repeatSeconds:.1});started=true;}await beat(.05);});
liveLoop('keep',async()=>{await beat(.05);});
`;
const STOP_LOOP=`stopLoop('owned');
globalThis.__dmgTimedLoopStopped=true;
liveLoop('keep',async()=>{await beat(.05);});
`;
const WAVE=`const gb=await useSoundChip('gameboy');
await gb.keyOff(CH1);await gb.keyOff(CH2);await gb.noise.keyOff();
const samples=Array.from({length:32},(_,i)=>i<16?15:0);
const plan=gb.build(b=>b.wave.setWaveform(samples).wave.setLevel(.5).wave.noteOn('C4'));
globalThis.__dmgTimedWave={gb,samples,plan,rows:await gb.compile(plan)};
await gb.schedule(plan,{name:'wave'});
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
  const ready=()=>until(()=>page.locator('#dmgFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');
  const read=(method='read')=>page.evaluate(method=>__dmgTimedAudit.read(method),method),output=()=>page.evaluate(()=>__dmgTimedAudit.output()),audit=()=>page.evaluate(()=>__dmgTimedAudit.state());
  const currentSource=()=>page.evaluate(()=>window.monaco?.editor?.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode()))?.getValue()??document.getElementById('synthCodeEditor').value);
  async function editorReady(){await until(()=>page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))||/Fallback|unavailable|could not load/i.test(document.getElementById('synthCodeEditorNote').textContent)),'Editor initialization',60000);assert.equal(await page.evaluate(()=>Boolean(window.monaco?.editor?.getEditors().some(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())))),config.editor==='monaco');}
  async function source(value){if(config.editor==='fallback')await page.locator('#synthCodeEditor').fill(value);else await page.evaluate(value=>monaco.editor.getEditors().find(editor=>document.getElementById('synthCodeEditorHost').contains(editor.getDomNode())).setValue(value),value);await until(()=>draft(page).then(state=>state?.workspace?.saved?.files.find(file=>file.path===CODE)?.data===value),'Saved Code source');assert.equal(await currentSource(),value);}
  async function apply(value){await page.locator('#synthInputCodeTab').click();await source(value);await page.locator('#synthCodeApplyButton').click();}
  async function audible(hz){await until(async()=>{const value=await output();return value?.finite&&value.muted&&value.acRms>1e-5&&Math.abs(value.frequency-hz)<8;},'PCM '+hz+'Hz');return output();}
  async function silent(){await until(async()=>{const value=await output();return !value||value.acRms<1e-6;},'Silent output');}
  async function choose(id){await page.locator('#'+id).click();await until(()=>page.locator('#'+id).getAttribute('aria-selected').then(value=>value==='true'),'View '+id);}
  async function stop(){await page.locator('#synthCodeStopButton').click();await until(()=>page.locator('#synthCodeState').textContent().then(value=>/Stopped|Idle/.test(value)),'Code Stop');await silent();}
  const begins=()=>page.evaluate(()=>__dmgTimedAudit.commands().filter(row=>row.method==='beginCode').length);
  try{
    await page.goto(origin+config.entry);await ready();await page.locator('#dmgFilesToggle').click();
    await page.locator('#dmgProjectFileInput').setInputFiles({name:'timed.cassette.zip',mimeType:'application/zip',buffer:fixture.cassette});await page.locator('#dmgImportCassetteDialog').waitFor({state:'visible'});await page.locator('#dmgImportCassetteReplace').click();await page.locator('#dmgImportCassetteDialog').waitFor({state:'hidden'});await ready();
    await page.locator('#synthWorkspaceCodeButton').click();await editorReady();assert.equal((await audit()).contexts,0,'opening Code starts no sound');
    await page.locator('#synthCodeRunButton').click();await until(()=>page.evaluate(()=>Boolean(globalThis.__dmgTimedProbe?.rows?.length&&globalThis.__dmgTimedProbe.loop>1)),'Timed program started');measurements.initial=await audible(329.63);
    const compilation=await page.evaluate(()=>({builds:__dmgTimedProbe.builds,plan:__dmgTimedProbe.plan,rows:__dmgTimedProbe.rows,again:__dmgTimedProbe.again,current:__dmgTimedProbe.current,snapshot:__dmgTimedProbe.snapshot,clientError:__dmgTimedProbe.clientError}));
    assert.equal(compilation.builds,1);assert.deepEqual(compilation.rows,compilation.again);assert(compilation.rows.filter(row=>row.register===4&&row.value&128).length>=2,'same-value trigger writes retained');assert(compilation.rows.every(row=>Number.isFinite(row.offsetSeconds)&&Number.isInteger(row.register)&&Number.isInteger(row.value)));assert.match(compilation.clientError,/Incomplete/);
    assert.equal(compilation.snapshot.format,'tetorica-gameboy-state');assert(compilation.snapshot.sampleRate>=44100);assert.equal(compilation.plan.referenceSampleRate,44100);
    const native=await read('observeCode');assert(native.initialized);assert(native.positionFrames>0);assert.equal(native.registers[2],144);
    const scheduleMessages=await page.evaluate(()=>__dmgTimedAudit.commands().filter(row=>row.method==='codeTimed'&&['stage','schedule'].includes(row.args?.[1]?.action)).length);const tick=await page.evaluate(()=>__dmgTimedProbe.loop);await pause(1000);assert((await page.evaluate(()=>__dmgTimedProbe.loop))>tick);assert.equal(await page.evaluate(()=>__dmgTimedAudit.commands().filter(row=>row.method==='codeTimed'&&['stage','schedule'].includes(row.args?.[1]?.action)).length),scheduleMessages,'compact repeat needs no JS reservation repost');await audible(329.63);
    measurements.compilation=compilation;step('Recorded nested operations are serializable and built once; current/reused compilation keeps repeated triggers, incomplete client state rejects explicitly, and one compact Worklet pattern drives real PCM');

    const firstBegin=await begins(),contextState=await page.evaluate(()=>{globalThis.__dmgTimedIdentity={context:__dmgTimedProbe.context,shared:__dmgTimedProbe.shared};return{visits:__dmgTimedProbe.context.visits};});
    for(const id of ['dmgChipTab','synthInputKeyboardTab','synthInputCodeTab']){await choose(id);assert(await page.locator('#synthWorkspace').evaluate(node=>node.classList.contains('is-code-expanded')));await audible(329.63);}
    assert.equal(await begins(),firstBegin);assert(await page.evaluate(()=>__dmgTimedProbe.context===__dmgTimedIdentity.context&&__dmgTimedProbe.shared===__dmgTimedIdentity.shared));
    await apply(REPLACE);await until(()=>page.evaluate(()=>Boolean(globalThis.__dmgTimedReplaced?.ticks>1)),'Applied pattern');measurements.replaced=await audible(440);assert.equal(await begins(),firstBegin);assert(await page.evaluate(()=>__dmgTimedReplaced.context===__dmgTimedIdentity.context&&__dmgTimedReplaced.shared===__dmgTimedIdentity.shared));
    await apply(BAD);await until(()=>page.locator('#synthCodeError').textContent().then(value=>value.includes('intentional failed Apply')),'Failed Apply reported');await pause(600);await audible(440);assert.equal(await begins(),firstBegin);
    await apply(INVALID);await until(()=>page.locator('#synthCodeError').textContent().then(value=>/channel|integer|0\.\.3/i.test(value)),'Invalid reservation rejected');await pause(500);await audible(440);assert.equal(await begins(),firstBegin);step('Code/APU/Keyboard views retain scheduled sound; Apply replaces its named pattern on the same APU/context/FX, and failed/staged or invalid replacements retain the old pattern');

    await choose('dmgChipTab');await page.locator('#dmgChannelSelect').selectOption('0');await page.locator('#dmgChannelSelect').blur();
    await page.keyboard.down('a');await until(()=>read().then(value=>value.voices.length===1),'Manual CH1 note');const manual=await read();
    await page.evaluate(()=>{globalThis.__dmgTimedRequestClear=true;});await until(()=>page.evaluate(()=>globalThis.__dmgTimedCleared===true),'Pattern clear');await pause(600);const afterClear=await read();assert.deepEqual(afterClear.voices,manual.voices,'clear cannot release later manual Gate');assert((await output()).acRms>1e-5);await page.keyboard.up('a');await until(()=>read().then(value=>value.voices.length===0),'Manual key release');await silent();step('A later keyboard Gate owns the physical channel; clearing the old reservation preserves it and its normal key-up release');

    await apply(OWNED);measurements.owned=await audible(392);await apply(STOP_LOOP);await until(()=>page.evaluate(()=>globalThis.__dmgTimedLoopStopped===true),'stopLoop evaluated');await silent();const beforeWait=await read('observeCode');await pause(500);const afterWait=await read('observeCode');assert.equal(afterWait.registers[2],0);assert.equal(beforeWait.registers[2],0);assert.equal(await begins(),firstBegin);step('stopLoop cancels only its owned repeating reservation and no later trigger reappears');

    await apply(WAVE);await until(()=>page.evaluate(()=>Boolean(globalThis.__dmgTimedWave?.rows?.length)),'Wave trace');const packed=Array.from({length:16},(_,i)=>i<8?255:0);await until(()=>read('observeCode').then(state=>state.registers.slice(32,48).every((value,i)=>value===packed[i])),'Scheduled Wave RAM applied');measurements.wave=await audible(261.63);
    const wave=await page.evaluate(()=>({rows:__dmgTimedWave.rows,samples:__dmgTimedWave.samples}));assert.equal(wave.rows.filter(row=>row.register>=32&&row.register<=47).length,16);assert.equal(wave.rows.find(row=>row.register===10).value&128,0,'Wave upload explicitly stops DAC before data');assert(wave.rows.some(row=>row.register===14&&row.value&128));
    await stop();const restored=await read();assert.deepEqual(restored.preset,fixture.preset);assert.deepEqual(restored.registers.slice(32,48),fixture.preset.wave.samples.reduce((a,value,i)=>{if(i%2===0)a.push(value*16+fixture.preset.wave.samples[i+1]);return a;},[]));await pause(450);assert.equal((await read()).voices.length,0);await silent();step('Bounded32sample Wave RAM compiles and plays through CH3; upload DAC stop is explicit, and Stop removes all reservations and restores the accepted author preset/Wave RAM');

    if(config.editor==='monaco'){
      await source(PLAY);const info=await page.evaluate(async()=>{const editor=monaco.editor.getEditors().find(e=>document.getElementById('synthCodeEditorHost').contains(e.getDomNode())),model=editor.getModel(),worker=await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri);const text=model.getValue(),at=text.indexOf('gb.build')+4;return worker.getQuickInfoAtPosition(model.uri.toString(),at);});assert(info);assert(info.displayParts.map(part=>part.text).join('').includes('build'),'real Monaco resolves the new build API');measurements.monacoBuildType=info.displayParts.map(part=>part.text).join('');
      measurements.sourceNavigation=[];for(const target of [{needle:'gb.build',symbol:'build',file:'gameboy_operations.js',sourceSymbol:'buildGameboyOperations'},{needle:'gb.captureState',symbol:'captureState',file:'gameboy_timed_client.js',sourceSymbol:'attachGameboyTimedClient'}])measurements.sourceNavigation.push(await definition(page,target));
    }
    for(const width of [1360,390]){await page.setViewportSize({width,height:1050});await pause(400);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-timed-${width}.png`),fullPage:true});}
    await page.setViewportSize({width:1360,height:1050});await page.locator('#synthWorkspaceSynthButton').click();await page.locator('#dmgSongSelect').selectOption(SONG);await page.locator('#dmgSongPlayButton').click();await until(()=>page.locator('#dmgSongPlayer').getAttribute('data-state').then(value=>value==='playing'),'VGM playing');await until(()=>page.locator('#dmgSongPlayer').getAttribute('data-position-frames').then(value=>Number(value)>4410),'Nonzero VGM');await page.locator('#dmgSongPlayButton').click();await until(()=>page.locator('#dmgSongPlayer').getAttribute('data-state').then(value=>value==='paused'),'VGM paused');const frame=await page.locator('#dmgSongPlayer').getAttribute('data-position-frames');measurements.pausedVgmFrames=Number(frame);await page.locator('#synthWorkspaceCodeButton').click();for(const id of ['dmgChipTab','synthInputKeyboardTab','synthInputCodeTab']){await choose(id);assert.equal(await page.locator('#dmgSongPlayer').getAttribute('data-position-frames'),frame);assert.equal(await page.locator('#dmgSongPlayer').getAttribute('data-state'),'paused');}await choose('dmgChipTab');await page.locator('#dmgSongStopButton').click();step('Timed API types/source navigation (when Monaco is active), narrow/readable layouts and the pre-existing nonzero paused VGM position remain intact');
    classifyErrors();measurements.audit=await audit();assert(measurements.audit.physicallyMuted);assert.deepEqual(measurements.audit.rejections,[]);assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);if(config.editor==='monaco'){assert.deepEqual(rawConsoleErrors,[]);assert.deepEqual(cdnFailures,[]);}return{browser:name,editor:config.editor,passed:true,checks,measurements,errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};
  }catch(error){classifyErrors();error.caseResult={browser:name,editor:config.editor,passed:false,checks,measurements,error:error.stack??String(error),status:await page.locator('#audioStatus').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),native:await read('observeCode').catch(()=>null),output:await output().catch(()=>null),audit:await audit().catch(()=>null),errors,consoleErrors,rawConsoleErrors,expectedConsoleErrors,cdnFailures};await page.screenshot({path:path.join(config.screenshots,`${name}-${config.editor}-failed.png`),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();}
}
// The distributable Synth borrows its APU. This additional source-only probe
// exercises the actual public client, primary facade and transferred Worker
// port against the public AudioWorklet, rather than substituting an RPC mock.
async function publicRoutes(browser,name,origin){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  await context.addInitScript(installAudit);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  try{
    await page.goto(origin+config.entry);
    const value=await page.evaluate(async()=>{
      const {GameboyRuntimeSynth}=await import('/js/gameboy_runtime_synth.js');
      const {createPrimaryGameboyApi}=await import('/js/playground_gameboy.js');
      const runtime=new GameboyRuntimeSynth({audioContext:new AudioContext({sampleRate:48000})});
      await runtime.start();const gb=createPrimaryGameboyApi(runtime.gameboy);
      gb.pulse.setVoice(0,{duty:.5,volume:8,envelope:{direction:'down',period:0}});
      gb.pulse.noteOn(0,'C4');gb.pulse.keyOff(0);
      const snapshot=await gb.captureState(),plan=gb.build(b=>b.pulse.noteOn(0,'E4').pulse.keyOn(0));
      const main={snapshot,client:await gb.compile(plan,{initialState:'client'}),current:await gb.compile(plan),
        reused:await gb.compile(plan,{initialState:snapshot})};
      await gb.schedule(plan,{name:'main',repeatSeconds:.1});
      await new Promise(resolve=>setTimeout(resolve,130));main.applied=await gb.captureState();
      await gb.clearSchedule('main');
      const channel=new MessageChannel();runtime.node.port.postMessage({primaryWorker:true,port:channel.port2},[channel.port2]);
      const moduleUrl=new URL('/js/playground_gameboy.js',location.href).href;
      const source=`import {createGameboyClient} from ${JSON.stringify(moduleUrl)};
        onmessage=async({data})=>{try{const gb=createGameboyClient(data.port,{primary:true});gb.initialize();
          gb.pulse.setVoice(0,{duty:.25,volume:7,envelope:{direction:'down',period:0}});
          const plan=gb.build(b=>b.pulse.noteOn(0,'G4').pulse.keyOn(0));
          const local=await gb.compile(plan,{initialState:'client'}),current=await gb.compile(plan);
          await gb.schedule(plan,{name:'worker',repeatSeconds:.1});await new Promise(resolve=>setTimeout(resolve,130));
          const applied=await gb.captureState();await gb.clearSchedule('worker');
          postMessage({plan,local,current,applied});gb._timedOperations.detach();data.port.close();
        }catch(error){postMessage({error:error.stack??String(error)});}};`;
      const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});
      let remote;try{remote=await new Promise((resolve,reject)=>{worker.onmessage=event=>resolve(event.data);worker.onerror=event=>reject(Error(event.message));worker.postMessage({port:channel.port1},[channel.port1]);});}
      finally{worker.terminate();URL.revokeObjectURL(url);runtime.node.port.postMessage({primaryWorker:true});}
      await runtime.close();return{main,worker:remote,audit:__dmgTimedAudit.state()};
    });
    assert.deepEqual(errors,[]);assert.equal(value.worker.error,undefined);assert(value.audit.physicallyMuted);
    assert.equal(value.main.snapshot.state.registers[2],0);assert.equal(value.main.snapshot.state.voice[2],128,'configured voice survives immediate keyOff');
    assert.deepEqual(value.main.client,value.main.current);assert.deepEqual(value.main.current,value.main.reused);
    assert.equal(value.main.snapshot.sampleRate,48000);assert(value.main.applied.frame>value.main.snapshot.frame);
    assert(value.main.applied.state.registers[2]>0);assert.equal(value.worker.applied.sampleRate,48000);
    assert.deepEqual(value.worker.local,value.worker.current);assert(value.worker.applied.state.registers[2]>0);
    assert(value.worker.plan.operations.length===2);console.log(`CHECK ${name}: public Main/primary and transferred Worker clients drive the real 48kHz Worklet`);
    return{browser:name,passed:true,...value};
  }finally{await context.close();}
}
function makeVgm(){const write=(r,v)=>[0xb3,r,v],commands=[...write(22,128),...write(20,119),...write(21,255),...write(1,128),...write(2,160),...write(3,11),...write(4,134)];let frames=44100*60;while(frames){const count=Math.min(65535,frames);commands.push(0x61,count&255,count>>8);frames-=count;}commands.push(0x66);const data=Buffer.alloc(256+commands.length);data.write('Vgm ');data.writeUInt32LE(data.length-4,4);data.writeUInt32LE(0x171,8);data.writeUInt32LE(44100*60,0x18);data.writeUInt32LE(0xcc,0x34);data.writeUInt32LE(4194304,0x80);data.set(commands,256);return data;}
(async()=>{
  const [{createGameboyCodeProject},{createDefaultPreset}]=await Promise.all([import(pathToFileURL(path.join(repo,'docs/synth-dmg/code_project.js'))),import(pathToFileURL(path.join(repo,'docs/synth-dmg/preset.js')))]);const preset=createDefaultPreset();preset.name='Timed';const project=createGameboyCodeProject({settings:preset,starterCode:PLAY});project.importFiles([{path:TONE,type:'text',data:JSON.stringify(preset,null,2)+'\n'},{path:SONG,type:'binary',data:makeVgm()}]);const fixture={preset,cassette:Buffer.from(await project.exportProject())};
  await fs.mkdir(config.screenshots,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`,report={schemaVersion:1,root:config.root,entry:config.entry,editor:config.editor,physicalOutputMuted:true,listeningPerformed:false,networkAccessUsed:false,results};
  try{for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}:{})});try{results.push(await check(browser,name,origin,fixture));if(config.root===path.join(repo,'docs'))(report.publicRoutes??=[]).push(await publicRoutes(browser,name,origin));}finally{await browser.close();}}assert.deepEqual(missing,[]);assert.deepEqual(external,[]);report.passed=true;}
  catch(error){report.passed=false;if(error.caseResult)results.push(error.caseResult);report.error=error.stack??String(error);process.exitCode=1;console.error(report.error);}
  finally{server.closeIdleConnections?.();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));Object.assign(report,{missing,external,cdn,localMonaco:Object.fromEntries(localMonaco),checkerSha256:hash(await fs.readFile(__filename)),servedFiles:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))});await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`${report.passed?'PASS':'FAIL'} ${config.out}`);}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
