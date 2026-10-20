// Real DX7 mode, primary MSFA Worklet/WASM, Monaco, Cassette examples and mode changes.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium,webkit} = require('playwright');
const docs = path.resolve(__dirname,'../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor = '\nwindow.__dx7Mode={runtime,megaDrive,selectedMode,virtualFiles,operatorKeyboard,getSource:getEditorValue,setSource:value=>editorAdapter.setValue(value)};';
const server = http.createServer(async(request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);let filename=path.resolve(docs,'.'+pathname);
    if(!filename.startsWith(docs+path.sep))throw Error('Invalid path');if((await fs.stat(filename)).isDirectory())filename=path.join(filename,'index.html');
    let body=await fs.readFile(filename);if(pathname.endsWith('/playground.js'))body=Buffer.from(body.toString()+accessor);
    response.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');response.end(body);
  }catch(error){response.writeHead(404).end(error.message);}
});
function observeAudioNodes() {
  const nodes=globalThis.__dx7ModeNodes=[];
  globalThis.AudioWorkletNode=new Proxy(globalThis.AudioWorkletNode,{construct(Type,args,Target){
    const node=Reflect.construct(Type,args,Target),entry={name:args[1],disposeSent:false};nodes.push(entry);
    const send=node.port.postMessage.bind(node.port);node.port.postMessage=(message,...transfer)=>{if(message?.method==='dispose')entry.disposeSent=true;return send(message,...transfer);};return node;
  }});
}
async function ready(page) {
  await page.waitForFunction(()=>window.__dx7Mode&&window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  // Complete a real TS request before any navigation can cancel its lazy worker.
  await page.evaluate(async()=>{const model=monaco.editor.getEditors()[0].getModel();const worker=await(await monaco.languages.typescript.getJavaScriptWorker())(model.uri);await worker.getSemanticDiagnostics(model.uri.toString());});
}
async function installMeter(page) {
  await page.evaluate(()=>{
    const shared=window.__dx7Mode,{megaDrive}=shared,context=megaDrive.audioContext,splitter=context.createChannelSplitter(2),silent=context.createGain();silent.gain.value=0;silent.connect(context.destination);
    shared.meters=[context.createAnalyser(),context.createAnalyser()];shared.meters.forEach((meter,index)=>{meter.fftSize=8192;splitter.connect(meter,index);meter.connect(silent);});megaDrive.audio.connectOutputMonitor(splitter);
    shared.measure=()=>shared.meters.map(meter=>{
      const pcm=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(pcm);const mean=pcm.reduce((sum,value)=>sum+value,0)/pcm.length,crossings=[];
      for(let index=1;index<pcm.length;index++)if(pcm[index-1]<mean&&pcm[index]>=mean)crossings.push(index-1+(mean-pcm[index-1])/(pcm[index]-pcm[index-1]));
      return {rms:Math.sqrt(pcm.reduce((sum,value)=>sum+(value-mean)**2,0)/pcm.length),peak:Math.max(...pcm.map(Math.abs)),finite:pcm.every(Number.isFinite),hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
    });
  });
}
async function audible(page,label,hz) {
  await page.waitForFunction(hz=>window.__dx7Mode.measure().every(value=>value.rms>.001&&(hz===undefined||Math.abs(value.hz/hz-1)<.025)),hz,{timeout:8000}).catch(error=>{throw new Error(`${label}: inaudible or wrong pitch. ${error.message}`);});
  const pcm=await page.evaluate(()=>window.__dx7Mode.measure());assert(pcm.every(value=>value.finite&&value.peak<.99),`${label}: nonfinite or clipped PCM`);return pcm;
}
async function silent(page,label) {
  await page.waitForTimeout(220);await page.waitForFunction(()=>window.__dx7Mode.measure().every(value=>value.peak<.00003),null,{timeout:8000}).catch(error=>{throw new Error(`${label}: audio remained after release. ${error.message}`);});
}
async function stop(page) {await page.click('#stopButton');await page.waitForFunction(()=>window.__dx7Mode.runtime.getState().playback==='stopped');await silent(page,'Stop');}
let runSequence=0;
async function runSource(page,source,worker) {
  const marker=`DX7_MODE_RESULT_${++runSequence}:`;
  await page.selectOption('#runFileSelect','/index.js');
  await page.evaluate(({source,worker,marker})=>{window.__dx7Mode.setSource(source+'\nconsole.log('+JSON.stringify(marker)+'+JSON.stringify(typeof result===\'undefined\'?{}:result));');document.getElementById('workerExecution').checked=worker;},{source,worker,marker});
  await page.click('#runButton');await page.waitForFunction(marker=>document.getElementById('consoleOutput').textContent.includes(marker),marker);
  return page.evaluate(marker=>{const text=document.getElementById('consoleOutput').textContent;return JSON.parse(text.slice(text.lastIndexOf(marker)+marker.length).split('\n')[0]);},marker);
}
async function assertPrimary(page) {
  const state=await page.evaluate(async()=>{
    const {megaDrive}=window.__dx7Mode;
    return {chip:megaDrive.chip,fm:megaDrive.fm,psg:megaDrive.psg,fmChannels:megaDrive.capabilities.fmChannels,
      endpoints:megaDrive.primaryEndpoints.map(entry=>({name:entry.name,globalName:entry.globalName})),
      connected:megaDrive.mixer.list().filter(entry=>entry.connected).map(entry=>entry.id),
      dx7:await megaDrive.dx7.getState(),nodes:window.__dx7ModeNodes.map(entry=>({...entry}))};
  });
  assert.equal(state.chip,'dx7');assert.equal(state.fm,null,'DX7 mode creates no hidden OPN synth');assert.equal(state.psg,null,'DX7 mode creates no PSG');assert.equal(state.fmChannels,0,'DX7 uses MIDI voices instead of legacy FM channels');
  assert.deepEqual(state.endpoints,[{name:'dx7',globalName:'dx7'}]);assert.deepEqual(state.connected,['dx7'],'only the primary DX7 reaches the chip mixer');
  assert(!state.nodes.some(entry=>/ym2612|ym2610|segapsg/i.test(entry.name)),'no hidden Genesis AudioWorklet node');assert.equal(state.nodes.filter(entry=>entry.name==='tetorica-playground-dx7').length,1,'the primary DX7 is reused');
  assert.equal(state.dx7.internalSampleRate,44100);assert([44100,48000].includes(state.dx7.sampleRate));return state;
}
async function checkCatalogAndTypes(page) {
  const catalog=await page.evaluate(async()=>{
    const test=window.__dx7Mode,{MODE_DEFAULT_CODES,MODE_EXAMPLE_FILES}=await import('./playground_examples.js');
    return {mode:test.selectedMode,starter:MODE_DEFAULT_CODES.dx7,source:test.getSource(),index:test.virtualFiles.get('/index.js')?.data,
      expected:MODE_EXAMPLE_FILES.dx7.map(({path,data})=>({path,data})),actual:test.virtualFiles.list().filter(file=>file.path.startsWith('/examples/')&&file.path.endsWith('.js')).map(({path,data})=>({path,data})),
      tree:[...document.querySelectorAll('#fileExplorerList button[data-file-path]')].map(node=>node.dataset.filePath).filter(value=>value.startsWith('/examples/')&&value.endsWith('.js')),
      run:[...document.querySelectorAll('#runFileSelect option')].map(node=>node.value).filter(value=>value.startsWith('/examples/')&&value.endsWith('.js'))};
  });
  assert.equal(catalog.mode.id,'dx7');assert.equal(catalog.mode.chip,'dx7');assert.equal(catalog.source,catalog.starter);assert.equal(catalog.index,catalog.starter);assert(catalog.expected.length>=2&&catalog.expected.length<=3,'two or three curated DX7 examples');
  const sort=files=>files.toSorted((a,b)=>a.path.localeCompare(b.path));assert.deepEqual(sort(catalog.actual),sort(catalog.expected));const paths=catalog.expected.map(file=>file.path).sort();assert(paths.every(value=>value.startsWith('/examples/dx7/')));assert.deepEqual(catalog.tree.sort(),paths);assert.deepEqual(catalog.run.sort(),paths);
  for(const selector of ['#operatorTabButton','#segapsgTab','#rf5c164Tab','#pwmTab','#gameboyTab','#nesTab','#ym2151Tab','#okim6258Tab','#huc6280Tab'])assert(await page.locator(selector).isHidden(),`DX7 hides unrelated tab ${selector}`);
  for(const selector of ['#codeTab','#audioMonitorTab','#fxMonitorTab','#mixerTab','#consoleTab','#shellTab','#keyboardTab','#helpersTab'])assert(await page.locator(selector).isVisible(),`DX7 keeps common tool ${selector}`);
  const types=await page.evaluate(async files=>{
    const selected=monaco.editor.getModels().find(model=>model.uri.path.endsWith('/tetorica-playground-dx7.d.ts'));
    const getWorker=await monaco.languages.typescript.getJavaScriptWorker();
    const probe=async(name,source,position=source.length)=>{const model=monaco.editor.createModel(source,'javascript',monaco.Uri.parse('file:///dx7-mode-'+name+'.js'));try{const worker=await getWorker(model.uri),uri=model.uri.toString();const diagnostics=await worker.getSemanticDiagnostics(uri);return {diagnostics:diagnostics.map(({start,code})=>({start,code})),entries:(await worker.getCompletionsAtPosition(uri,position))?.entries.map(entry=>entry.name)||[],hover:(await worker.getQuickInfoAtPosition(uri,Math.max(0,source.indexOf('dx7'))+1))?.displayParts.map(part=>part.text).join('')};}finally{model.dispose();}};
    const valid="dx7.noteOn(60,100);\npg.dx7.noteOff(60);\nlivePrepare('dx7-type',api=>api.dx7.setFeedback(1));\nkeyboard.bind('DX7',{noteOn:({midi,velocity})=>dx7.noteOn(midi,velocity),noteOff:({midi})=>dx7.noteOff(midi),allNotesOff:()=>dx7.panic()});\n";
    const bad=["dx7.noteOn('C4',100);","dx7.setClock(3579545);","dx7.dispose();","fm;","psg;","play('C4');","CH1;","OP1;","pg.fm;"];
    const diagnostic=await probe('valid-invalid',valid+bad.join('\n'));
    const prepare="livePrepare('dx7-completion',api=>{api.});";
    const fields="await dx7.setOperator(1,{  });";
    // Each example is an independent script. Concurrent temporary models would
    // accidentally put their top-level `synth` declarations in one TS program.
    const sourceChecks=[];
    for(const {path,data}of files)sourceChecks.push({path,diagnostics:(await probe('source-'+path.replaceAll('/','_'),data)).diagnostics});
    return {selected:selected?.getValue(),validLength:valid.length,badStarts:bad.map((line,index)=>({text:line,start:valid.length+bad.slice(0,index).reduce((sum,value)=>sum+value.length+1,0)})),diagnostic,
      global:(await probe('globals',';\n')).entries,pg:(await probe('pg','pg.')).entries,prepare:(await probe('prepare',prepare,prepare.indexOf('api.')+4)).entries,
      dx7:(await probe('methods','dx7.')).entries,fields:(await probe('operator-fields',fields,fields.indexOf('{  }')+2)).entries,
      sourceChecks};
  },[{path:'/index.js',data:catalog.starter},...catalog.expected]);
  assert(types.selected,'DX7 declarations loaded');assert(!types.diagnostic.diagnostics.some(value=>value.start<types.validLength),'mode-specific DX7/pg/livePrepare/Keyboard source is well typed');
  for(let index=0;index<types.badStarts.length;index++){const start=types.badStarts[index].start,end=types.badStarts[index+1]?.start??Infinity;assert(types.diagnostic.diagnostics.some(value=>value.start>=start&&value.start<end),`invalid DX7 mode API accepted: ${types.badStarts[index].text}`);}
  for(const target of ['global','pg','prepare']){assert(types[target].includes('dx7'),`${target} exposes primary DX7`);for(const name of ['fm','play','write','FM_PRESETS','CH1','OP1','midi','psg','dac','ssg','rhythm','adpcm','opm','pce','gameboy','nes','snes'])assert(!types[target].includes(name),`${target} hides ${name}`);}
  for(const method of ['setPreset','setOperator','setOperators','setFeedback','getPreset','loadSysex','selectVoice','noteOn','noteOff','panic','getState'])assert(types.dx7.includes(method),'DX7 method completion: '+method);assert(!types.dx7.includes('dispose')&&!types.dx7.includes('setClock'),'primary lifetime and fixed internal rate are reflected in types');for(const field of ['coarse','fine','outputLevel','envelope'])assert(types.fields.includes(field),'DX7 operator field completion: '+field);
  for(const source of types.sourceChecks)assert.deepEqual(source.diagnostics,[],`bundled ${source.path} has Monaco diagnostics`);
  return catalog;
}
async function keyEvent(page,type,key) {
  key??=await page.locator('#operatorKeyboardRoot .key').first().getAttribute('data-key');await page.evaluate(({type,key})=>document.body.dispatchEvent(new KeyboardEvent(type,{key,code:/^[a-z]$/i.test(key)?'Key'+key.toUpperCase():'Digit'+key,bubbles:true,cancelable:true})),{type,key});return key;
}
async function changeMode(page,id,choice) {
  if(!await page.locator('#playgroundMode').isVisible())await page.locator('#mainMenu > summary').click();await page.selectOption('#playgroundMode',id);await page.locator('#changeModeDialog').waitFor({state:'visible'});
  await Promise.all([page.waitForURL(url=>url.searchParams.get('mode')===id),page.click(choice==='initial'?'#modeChoiceInitial':'#modeChoiceKeep')]);await ready(page);
}
async function check(page,url,browserName,worker,fixture) {
  const errors=[],failedRequests=[],result={browser:browserName,worker};page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)failedRequests.push({url:response.url(),status:response.status()});});console.log(JSON.stringify({...result,stage:'start'}));await page.addInitScript(observeAudioNodes);
  await page.goto(url+'?mode=dx7&no-sw=1');await ready(page);const catalog=await checkCatalogAndTypes(page);assert.equal(await page.locator('#playgroundMode').inputValue(),'dx7');assert.equal(await page.evaluate(()=>window.__dx7Mode.megaDrive.audioContext),null,'opening DX7 mode starts no audio');assert.deepEqual(await page.evaluate(()=>window.__dx7ModeNodes),[],'opening DX7 mode creates no core nodes');
  await page.evaluate(worker=>document.getElementById('workerExecution').checked=worker,worker);await page.click('#runButton');await page.waitForFunction(()=>window.__dx7Mode.runtime.getState().playback==='running'&&window.__dx7Mode.megaDrive.dx7);await installMeter(page);result.starter=await audible(page,'mode starter');await assertPrimary(page);
  const starterPreset=await page.evaluate(()=>window.__dx7Mode.megaDrive.dx7.getPreset());assert.equal(starterPreset.name,'MODE KEYS');await stop(page);assert.deepEqual(await page.evaluate(()=>window.__dx7Mode.megaDrive.dx7.getPreset()),starterPreset,'Stop preserves primary preset');
  await page.click('#runButton');await page.waitForFunction(()=>window.__dx7Mode.runtime.getState().playback==='running');await audible(page,'starter Run after Stop');await assertPrimary(page);await stop(page);

  const bank='new Uint8Array('+JSON.stringify(fixture.bank)+')';
  const initial=await runSource(page,`
    if(dx7!==await useSoundChip('dx7'))throw Error('useSoundChip created another DX7');
    if(typeof dx7.dispose!=='undefined'||typeof dx7.setClock!=='undefined')throw Error('primary lifetime/rate leaked');
    if(typeof fm!=='undefined'||typeof psg!=='undefined'||typeof play!=='undefined')throw Error('Genesis globals leaked');
    await dx7.loadSysex(${bank});dx7.selectVoice(31);
    await dx7.setPreset({name:'MODE HOLD',algorithm:31,operators:{1:{coarse:1,fine:0,detune:7,outputLevel:90,envelope:{rates:[99,99,99,0],levels:[99,99,99,0]}}}});
    dx7.noteOn(69,100);const result={id:dx7.id,same:dx7===await useSoundChip('dx7'),state:await dx7.getState(),preset:await dx7.getPreset()};`,worker);
  assert.equal(initial.id,'dx7');assert(initial.same);assert.equal(initial.state.voices.length,32,'voices lists preset slots rather than polyphony');assert.equal(initial.state.selectedVoice,31);result.primary=await audible(page,'primary global/SysEx bank',440);
  const live=await runSource(page,`dx7.panic();await dx7.setOperator(1,{coarse:2});dx7.noteOn(69,100);const result={preset:await dx7.getPreset(),state:await dx7.getState()};`,worker);assert.equal(live.preset.operators[1].coarse,2);await audible(page,'primary object operator edit',880);
  const applied=await page.evaluate(async()=>({state:await window.__dx7Mode.megaDrive.dx7.getState(),preset:await window.__dx7Mode.megaDrive.dx7.getPreset()}));assert.equal(applied.state.selectedVoice,31);assert.equal(applied.state.voices.length,32);assert.equal(applied.preset.operators[1].coarse,2,'Main admin RPC sees Worker edits');await stop(page);
  // Read cached metadata before any getState RPC can repair stale client state.
  const stoppedMetadata=await page.evaluate(()=>({voices:window.__dx7Mode.megaDrive.dx7.voices,selectedVoice:window.__dx7Mode.megaDrive.dx7.selectedVoice}));assert.deepEqual(stoppedMetadata.voices,applied.state.voices,'Stop retains applied bank metadata without a read RPC');assert.equal(stoppedMetadata.selectedVoice,applied.state.selectedVoice,'Stop retains applied selection without a read RPC');
  assert.deepEqual(await page.evaluate(()=>window.__dx7Mode.megaDrive.dx7.getPreset()),applied.preset,'Stop keeps the edited bank slot');
  const opposite=await runSource(page,`if(dx7!==await useSoundChip('dx7'))throw Error('primary alias changed');const preset=await dx7.getPreset();dx7.noteOn(69,100);const result={state:await dx7.getState(),preset};`,!worker);assert.equal(opposite.state.selectedVoice,31);assert.equal(opposite.preset.name,'MODE HOLD');assert.equal(opposite.preset.operators[1].coarse,2);await audible(page,'execution handoff after Stop',880);await assertPrimary(page);await stop(page);
  await runSource(page,`dx7.panic();for(let note=48;note<64;note++)dx7.noteOn(note,40);`,worker);result.chord=await audible(page,'sixteen MIDI note chord');await stop(page);

  for(const example of catalog.expected) {
    await page.selectOption('#runFileSelect',example.path);await page.evaluate(worker=>document.getElementById('workerExecution').checked=worker,worker);await page.click('#runButton');await page.waitForFunction(()=>window.__dx7Mode.runtime.getState().playback==='running');
    if(example.path.endsWith('/dx7-keyboard.js')){
      await page.waitForFunction(()=>document.getElementById('playgroundKeyboardHint')?.textContent.includes('DX7 Keyboard'));await page.click('#keyboardTab');await page.locator('#keyboardPanel').waitFor({state:'visible'});let key=await keyEvent(page,'keydown');result.keyboard=await audible(page,'DX7 Guitar example');await keyEvent(page,'keyup',key);await silent(page,'DX7 Guitar keyup');key=await keyEvent(page,'keydown');await audible(page,'DX7 Guitar before blur');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await silent(page,'DX7 Guitar blur');await keyEvent(page,'keyup',key);key=await keyEvent(page,'keydown');await audible(page,'DX7 Guitar before Stop');await stop(page);await keyEvent(page,'keyup',key);
    }else{await audible(page,example.path);await stop(page);}
    await assertPrimary(page);
  }
  await page.selectOption('#runFileSelect','/index.js');
  if(!worker){
    const retained='// DX7 mode transfer keeps this edited source.\nawait sleep(.01);';await page.evaluate(source=>{window.__dx7Mode.setSource(source);window.__dx7Mode.virtualFiles.writeBinary('/samples/dx7-mode-retained.bin',new Uint8Array([0,5,255]));},retained);await changeMode(page,'genesis','keep');assert.equal(await page.evaluate(()=>window.__dx7Mode.getSource()),retained,'Keep preserves edited DX7 source');assert(await page.locator('#operatorTabButton').isVisible(),'Genesis tabs restored');await changeMode(page,'dx7','initial');const restored=await page.evaluate(async()=>({actual:window.__dx7Mode.getSource(),expected:(await import('./playground_examples.js')).MODE_DEFAULT_CODES.dx7,bytes:Array.from(window.__dx7Mode.virtualFiles.get('/samples/dx7-mode-retained.bin')?.data??[])}));assert.equal(restored.actual,restored.expected,'Initial loads the DX7 starter');assert.deepEqual(restored.bytes,[0,5,255],'mode change preserves user assets');await checkCatalogAndTypes(page);
    await page.click('#runButton');await page.waitForFunction(()=>window.__dx7Mode.runtime.getState().playback==='running'&&window.__dx7Mode.megaDrive.dx7);await installMeter(page);await audible(page,'menu-switched DX7 starter');await assertPrimary(page);await stop(page);result.menuTransfer=true;
  }
  assert.deepEqual(errors,[],'no browser page errors');assert.deepEqual(failedRequests,[],'no missing mode/runtime/type assets');
  if(process.argv.includes('--screenshots')){await page.click('#mixerTab');result.screenshot=`/private/tmp/dx7-mode-${browserName}-${worker?'worker':'main'}-success.png`;await page.screenshot({path:result.screenshot});}console.log(JSON.stringify({...result,stage:'passed'}));
}
(async()=>{
  const {createInitVoice,createBankSysex}=await import(pathToFileURL(path.resolve(__dirname,'../web/msfa_dx7/src/sysex.js')).href);const fixture={bank:Array.from(createBankSysex(Array.from({length:32},(_,index)=>createInitVoice('BANK '+String(index).padStart(2,'0')))))};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const url=`http://127.0.0.1:${server.address().port}/playground/index.html`,engines=process.argv.includes('--chromium')?[['chromium',chromium]]:process.argv.includes('--webkit')?[['webkit',webkit]]:[['chromium',chromium],['webkit',webkit]],workers=process.argv.includes('--main')?[false]:process.argv.includes('--worker')?[true]:[false,true];
    for(const[name,type]of engines){const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});try{for(const worker of workers){const page=await browser.newPage({viewport:{width:1380,height:1100},serviceWorkers:'block'});page.setDefaultTimeout(25000);try{await check(page,url,name,worker,fixture);}catch(error){console.error(JSON.stringify({browser:name,worker,diagnostic:await page.evaluate(()=>({status:document.getElementById('status')?.textContent,startup:document.getElementById('startupNotice')?.textContent,console:document.getElementById('consoleOutput')?.textContent,nodes:window.__dx7ModeNodes,mode:window.__dx7Mode?.selectedMode})).catch(()=>null)}));await page.screenshot({path:`/private/tmp/dx7-mode-${name}-${worker?'worker':'main'}-failed.png`}).catch(()=>{});throw error;}finally{await page.close();}}}finally{await browser.close();}}
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
