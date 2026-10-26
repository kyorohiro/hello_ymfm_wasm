// Real WonderSwan Playground: four wavetable channels, authoring, Keyboard and PCM.
// Defaults to Chromium + WebKit; select --chromium or --webkit for a focused run.
// --docs-dir PATH also accepts the flat directory produced by the itch packager.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

function options(args) {
  const result = {docs:path.resolve(__dirname, '../docs'), engines:[],screenshots:null};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--chromium' || arg === '--webkit') {result.engines.push(arg.slice(2)); continue;}
    if (arg === '--docs-dir' || arg.startsWith('--docs-dir=')) {
      const value = arg === '--docs-dir' ? args[++i] : arg.slice('--docs-dir='.length);
      if (!value) throw Error('--docs-dir requires a path');
      result.docs = path.resolve(value); continue;
    }
    if(arg==='--screenshot-dir'){
      const value=args[++i];assert(value&&!value.startsWith('--'),'--screenshot-dir requires a path');
      result.screenshots=path.resolve(value);continue;
    }
    if (arg === '--help') {
      console.log('Usage: node scripts/check_playground_wonderswan_browser.cjs [--chromium] [--webkit] [--docs-dir PATH] [--screenshot-dir PATH]');
      process.exit(0);
    }
    throw Error('Unknown argument: ' + arg);
  }
  if (!result.engines.length) result.engines = ['chromium', 'webkit'];
  return result;
}
const config = options(process.argv.slice(2));
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css',
  '.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon'};
const accessor = '\nwindow.__wonderSwanCheck={runtime,megaDrive,selectedMode,virtualFiles,editorAdapter,setBottomTab};';

// Request fresh PCM only when needed. Both channels are captured in the same
// render quanta, avoiding races between two independent AnalyserNode buffers.
const probeSource = `
class WonderSwanStereoCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.capture = null;
    this.port.onmessage = ({data}) => {
      const frames = data.frames ?? 8192;
      this.capture = {id:data.id,index:0,left:new Float32Array(frames),right:new Float32Array(frames)};
    };
  }
  process(inputs,outputs) {
    for (const output of outputs[0]) output.fill(0);
    const input = inputs[0], capture = this.capture;
    if (!capture || input.length < 2) return true;
    const count = Math.min(input[0].length,capture.left.length-capture.index);
    capture.left.set(input[0].subarray(0,count),capture.index);
    capture.right.set(input[1].subarray(0,count),capture.index);
    capture.index += count;
    if (capture.index === capture.left.length) {
      this.capture = null;
      this.port.postMessage({id:capture.id,left:capture.left,right:capture.right},
        [capture.left.buffer,capture.right.buffer]);
    }
    return true;
  }
}
registerProcessor('wonderswan-stereo-capture',WonderSwanStereoCapture);
`;
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__wonderswan_probe.js') {
      response.setHeader('Content-Type','text/javascript'); response.end(probeSource); return;
    }
    if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
    let filename = path.resolve(config.docs, '.' + pathname);
    if (filename !== config.docs && !filename.startsWith(config.docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    let body = await fs.readFile(filename);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type',mime[path.extname(filename)] ?? 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(error.message);}
});

const panel = '#wonderswanPanel';
const control = name => `${panel} [data-chip-control="ws-${name}"]`;
const action = name => `${panel} [data-chip-action="ws-${name}"]`;
const read = (page,id='wonderswan') => page.evaluate(id => window.__wonderSwanCheck.runtime.chipInspector.read(id),id);
async function until(page,test,label,id='wonderswan') {
  const deadline = Date.now() + 6000; let state;
  while (Date.now() < deadline) {
    state = await read(page,id); if (test(state)) return state;
    await page.waitForTimeout(35);
  }
  throw Error(label + ': ' + JSON.stringify(state));
}
async function field(page,name,value) {
  await page.locator(control(name)).evaluate((node,value) => {
    if (node.type === 'checkbox') node.checked = Boolean(value); else node.value = String(value);
    node.dispatchEvent(new Event('change',{bubbles:true}));
  },value);
}
async function runSource(page,source,execution = 'main') {
  await page.evaluate(({source,execution}) => {
    document.getElementById('workerExecution').checked = execution === 'worker';
    return window.__wonderSwanCheck.runtime.playSource(source,{execution});
  },{source,execution});
}
async function installCapture(page) {
  await page.evaluate(async () => {
    const state = window.__wonderSwanCheck, context = state.megaDrive.audioContext;
    await context.audioWorklet.addModule(new URL('/__wonderswan_probe.js',location.href));
    const node = new AudioWorkletNode(context,'wonderswan-stereo-capture',{
      numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,
      channelCountMode:'explicit',channelInterpretation:'discrete',
    });
    const silent = context.createGain(); silent.gain.value = 0;
    node.connect(silent); silent.connect(context.destination);
    state.megaDrive.audio.connectOutputMonitor(node);
    let sequence = 0;
    const pending = new Map();
    node.port.onmessage = ({data}) => {
      const waiter = pending.get(data.id); if (!waiter) return;
      pending.delete(data.id); clearTimeout(waiter.timer);
      const channels = [data.left,data.right].map(values => {
        const mean = values.reduce((sum,value) => sum + value,0) / values.length;
        let square = 0,peak = 0,stepPeak = 0,finite = true; const crossings = [];
        for (let i = 0; i < values.length; i++) {
          const value = values[i]; square += (value-mean)**2; peak = Math.max(peak,Math.abs(value));
          if (i) stepPeak = Math.max(stepPeak,Math.abs(value-values[i-1]));
          finite = finite && Number.isFinite(value);
          if (i && values[i-1] < mean && value >= mean) crossings.push(i-1+(mean-values[i-1])/(value-values[i-1]));
        }
        return {mean,rms:Math.sqrt(square/values.length),peak,stepPeak,finite,
          hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
      });
      let difference = 0;
      for (let i = 0; i < data.left.length; i++) difference = Math.max(difference,Math.abs(data.left[i]-data.right[i]));
      waiter.resolve({channels,difference,frames:data.left.length,sampleRate:context.sampleRate});
    };
    state.capture = frames => new Promise((resolve,reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {pending.delete(id); reject(Error('PCM capture timed out'));},5000);
      pending.set(id,{resolve,timer}); node.port.postMessage({id,frames});
    });
  });
}
const capture = (page,frames) => page.evaluate(frames => window.__wonderSwanCheck.capture(frames),frames);

async function audible(page,label,{hz,mono=false,side}={}) {
  let pcm;
  const valid = result => result.channels.every((channel,index)=> channel.finite && channel.peak<.99 && (side!==undefined&&index!==side?channel.peak<.0001:channel.rms>.0002) && (hz===undefined||side!==undefined&&index!==side||Math.abs(channel.hz-hz)<1));
  for(let attempt=0;attempt<8;attempt++){pcm=await capture(page);if(valid(pcm))break;}
  assert(valid(pcm),label+': '+JSON.stringify(pcm));
  if(mono)assert(pcm.difference<1e-7,label+': centered pan must reach both outputs equally');
  if(hz!==undefined)assert(pcm.channels.every((channel,index)=>side!==undefined&&index!==side||Math.abs(channel.mean)<.008),label+': unexpected DC '+JSON.stringify(pcm));
  return pcm;
}
async function silent(page,label){
  let pcm;for(let attempt=0;attempt<8;attempt++){pcm=await capture(page);if(pcm.channels.every(channel=>channel.peak<.0001))return;}
  throw Error(label+': output stayed audible '+JSON.stringify(pcm));
}
async function stop(page){
  await page.click('#stopButton');await page.waitForFunction(()=>window.__wonderSwanCheck.runtime.getState().playback==='stopped');
  await until(page,state=>state.channels.every(channel=>!channel.active),'Stop releases all voices');await silent(page,'Stop');
  assert.equal((await read(page)).clock,3072000,'Stop preserves chip clock');
}
async function hold(page,callback){
  const button=page.locator(action('hold'));await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  try{return await callback();}finally{await page.mouse.move(4,4);await page.mouse.up();}
}
async function checkTypes(page){
  const result=await page.evaluate(async()=>{
    const selected=monaco.editor.getModels().find(model=>model.uri.path.endsWith('/tetorica-playground-wonderswan.d.ts'));
    const getWorker=await monaco.languages.typescript.getJavaScriptWorker();
    async function probe(name,source){const model=monaco.editor.createModel(source,'javascript',monaco.Uri.parse(`file:///wonderswan-check-${name}.js`));try{const worker=await getWorker(model.uri),uri=model.uri.toString();return{entries:(await worker.getCompletionsAtPosition(uri,source.length))?.entries.map(entry=>entry.name)??[],diagnostics:await worker.getSemanticDiagnostics(uri)};}finally{model.dispose();}}
    return{selected:selected?.getValue(),globals:await probe('globals',';\n'),pg:await probe('pg','pg.'),ws:await probe('ws','ws.'),valid:await probe('valid',"ws.setVolume(3,9,9);ws.noteOn(3,'A4');"),invalid:await probe('invalid',"ws.noteOn(4,'A4');")};
  });
  assert.match(result.selected??'',/type TetoricaSelectedChip\s*=\s*['"]wonderswan['"]/);
  for(const target of ['globals','pg']){
    assert(result[target].entries.includes('ws'),target+': WonderSwan global available');
    for(const name of ['fm','play','FM_PRESETS','CH1','psg','opll','opl'])assert(!result[target].entries.includes(name),target+': '+name+' leaked');
  }
  for(const method of ['setWaveform','setNoise','setSweep','setVoiceMode','noteOn','keyOff'])assert(result.ws.entries.includes(method),method+' completion');
  assert(!result.ws.entries.includes('dispose'),'borrowed primary has no dispose');assert.deepEqual(result.valid.diagnostics,[],'valid WonderSwan code typechecks');
  assert(result.invalid.diagnostics.some(diagnostic=>diagnostic.code===2345),'fifth channel is rejected');
  return{wsGlobal:true,noImplicitFM:true,fourChannelBounds:true};
}
async function keyboard(page){
  await page.evaluate(()=>window.__wonderSwanCheck.setBottomTab('keyboard'));
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Ukulele$/}).click();
  await page.selectOption('#playgroundKeyboardChip','chip:wonderswan');await page.selectOption('#playgroundKeyboardTargetChannel','3');
  assert.deepEqual(await page.locator('#playgroundKeyboardTargetChannel option').evaluateAll(nodes=>nodes.map(node=>node.value)),['0','1','2','3']);
  const key=await page.locator('#operatorKeyboardRoot .key').evaluateAll(nodes=>nodes.find(node=>node.querySelector('span')?.textContent==='A4')?.dataset.key);
  assert(key,'Ukulele Keyboard offers A4');await page.keyboard.down(key);
  try{const state=await until(page,state=>state.channels[3].active,'Keyboard selected CH4');assert(state.channels.slice(0,3).every(channel=>!channel.active));await audible(page,'Keyboard CH4',{hz:440,mono:true});}
  finally{await page.keyboard.up(key);}
  await until(page,state=>!state.channels[3].active,'Keyboard keyup releases CH4');await silent(page,'Keyboard keyup');
}
async function sharedChannels(page,execution,{setup='',name='ws',id='wonderswan'}={}){
  await runSource(page,`${setup}
    setBpm(120);${name}.allNotesOff();
    liveLoop('sibling',async()=>{${name}.noteOn(1,'A4');await beat(16);});
    liveLoop('release-own',async()=>{${name}.noteOn(0,'C5');await beat(2);${name}.allNotesOff();await beat(14);});`,execution);
  await until(page,state=>state?.channels[0].active&&state.channels[1].active,execution+' shared channels started',id);
  await until(page,state=>state?.channels[0].active===false&&state.channels[1].active,execution+' releases its own gate and preserves sibling',id);
  return{execution,releasedOwn:true,preservedSibling:true};
}
async function check(page,base,browserName){
  await page.goto(base+'?mode=wonderswan&no-sw=1');
  await page.waitForFunction(()=>window.__wonderSwanCheck&&window.monaco?.editor?.getEditors().length);await page.locator('#startupNotice').waitFor({state:'hidden'});
  assert.equal(await page.locator('#playgroundMode').inputValue(),'wonderswan');assert.match(await page.locator('#playgroundMode option[value="wonderswan"]').textContent(),/WonderSwan/);
  assert.equal(await page.evaluate(()=>window.__wonderSwanCheck.megaDrive.audioContext),null,'opening WonderSwan is lazy');
  for(const id of ['operatorTabButton','ay8910Tab','segapsgTab','ym2413Tab'])assert(!await page.locator('#'+id).isVisible(),id+' absent');
  assert(await page.locator('#wonderswanTab').isVisible());const types=await checkTypes(page);
  const programs=await page.evaluate(async()=>{
    const{MODE_DEFAULT_CODES,MODE_EXAMPLE_FILES}=await import(new URL('./playground_examples.js',location.href));const state=window.__wonderSwanCheck;
    return{starter:MODE_DEFAULT_CODES.wonderswan,editor:state.editorAdapter.getValue(),examples:MODE_EXAMPLE_FILES.wonderswan,actual:state.virtualFiles.list().filter(file=>file.path.startsWith('/examples/')&&file.path.endsWith('.js')).map(file=>file.path).sort()};
  });
  assert.equal(programs.editor,programs.starter);assert.equal(programs.examples.length,3);assert.deepEqual(programs.actual,programs.examples.map(file=>file.path).sort());
  await page.evaluate(()=>{
    const audio=window.__wonderSwanCheck.megaDrive.audio,ensure=audio.ensureRouting.bind(audio);
    audio.ensureRouting=context=>{if(!audio.outputNode){const sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);audio.outputNode=sink;}return ensure(context);};
  });
  await page.click('#runButton');await page.waitForFunction(()=>window.__wonderSwanCheck.megaDrive.isReady());await installCapture(page);
  const starter=await audible(page,'mode starter');await stop(page);
  const primaries=await page.evaluate(()=>({chips:window.__wonderSwanCheck.runtime.chipInspector.list().map(entry=>[entry.id,entry.kind]),endpoints:window.__wonderSwanCheck.megaDrive.primaryEndpoints.map(entry=>entry.name),strips:window.__wonderSwanCheck.megaDrive.mixer.list().map(entry=>entry.id),fm:window.__wonderSwanCheck.megaDrive.capabilities.fmChannels}));
  assert.deepEqual(primaries,{chips:[['wonderswan','wonderswan']],endpoints:['wonderswan'],strips:['wonderswan'],fm:0});
  assert.equal((await read(page)).clock,3072000);const executions=[];
  for(const execution of ['main','worker']){
    await runSource(page,`if(typeof fm!=='undefined'||typeof play!=='undefined')throw Error('Implicit FM');
      const a=await useSoundChip('wonderswan');if(a.id!=='wonderswan'||a.dispose||a.clock!==3072000)throw Error('Wrong borrowed primary');
      await livePrepare('wonderswan-profile',api=>{if(!api.ws||api.fm)throw Error('Wrong livePrepare globals');});
      ws.setNoise({enabled:false});ws.setSweep({enabled:false});ws.setVoiceMode(false);ws.allNotesOff();
      for(const ch of [0,1,2,3])ws.setVolume(ch,9,9);
      liveLoop('wonderswan-pitch',async()=>{ws.noteOn(0,'A4');await sleep(60);});`,execution);
    await until(page,state=>state.channels[0].active,execution+' note');const pcm=await audible(page,execution+' borrowed WonderSwan',{hz:440,mono:true});
    assert.deepEqual(await page.evaluate(()=>window.__wonderSwanCheck.runtime.chipInspector.list().map(entry=>entry.id)),['wonderswan'],'useSoundChip borrows primary');
    await stop(page);await keyboard(page);executions.push({execution,hz:pcm.channels[0].hz,dc:pcm.channels[0].mean,stereoDifference:pcm.difference});
  }
  const sharedChannelOwnership=[];
  for(const execution of ['main','worker']){sharedChannelOwnership.push(await sharedChannels(page,execution));await stop(page);}
  await page.click('#wonderswanTab');await page.locator(control('frequency')).waitFor();await page.click(`${panel} [data-chip-channel="0"]`);
  await page.click(action('wave-square'));await until(page,state=>state.channels[0].waveform.slice(0,16).every(value=>value===15)&&state.channels[0].waveform.slice(16).every(value=>value===0),'panel square wave');
  await field(page,'pan-left',9);await field(page,'pan-right',0);await until(page,state=>state.channels[0].pan.left===9&&state.channels[0].pan.right===0,'panel pan left');
  await hold(page,()=>audible(page,'panel left-only Hold',{hz:440,side:0}));await silent(page,'panel release outside');
  await field(page,'pan-right',9);await field(page,'wave-index',0);await field(page,'wave-value',12);await until(page,state=>state.channels[0].waveform[0]===12,'panel numeric wave edit');
  await page.click(`${panel} [data-chip-channel="3"]`);await field(page,'noise-enabled',true);await field(page,'noise-type',4);
  await until(page,state=>state.noise.enabled&&state.noise.type===4,'panel noise');await page.click(action('noise-reset'));
  await hold(page,()=>audible(page,'panel noise Hold'));await silent(page,'panel noise release');
  await page.click(`${panel} [data-chip-channel="2"]`);await field(page,'sweep-enabled',true);await field(page,'sweep-step',-2);await field(page,'sweep-time',1);
  await until(page,state=>state.sweep.enabled&&state.sweep.step===-2&&state.sweep.time===1,'panel sweep');await hold(page,()=>audible(page,'panel sweep Hold'));await silent(page,'panel sweep release');
  const configured=await read(page);await stop(page);await runSource(page,"console.log('WONDERSWAN_REUSED');");
  const reused=await read(page);assert.deepEqual(reused.channels[0].waveform,configured.channels[0].waveform);assert.deepEqual(reused.noise,configured.noise);assert.deepEqual(reused.sweep,configured.sweep);await stop(page);
  const examples=[];
  for(let index=0;index<programs.examples.length;index++){
    const example=programs.examples[index],execution=index%2?'worker':'main';await runSource(page,example.data,execution);await audible(page,example.path);await stop(page);examples.push({path:example.path,execution});
  }
  assert(!await page.locator('#consoleOutput').evaluate(node=>/Playback failed|ReferenceError|TypeError:|Error: Wrong|Error: Implicit/.test(node.textContent)),await page.locator('#consoleOutput').textContent());
  return{browser:browserName,passed:true,clock:3072000,primaries,types,starter,executions,sharedChannelOwnership,keyboard:true,editor:{wave:true,stereo:true,noise:true,sweep:true,retainedAfterRun:true},examples,physicalOutputMuted:true};
}
async function checkAdditional(browser,base,browserName){
  const results=[];
  for(const execution of ['main','worker']){
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1600,height:1100}});page.setDefaultTimeout(15000);const errors=[],missing=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()===404)missing.push(response.url());});
    try{
      await page.goto(base+'?mode=genesis&no-sw=1');await page.waitForFunction(()=>window.__wonderSwanCheck&&window.monaco?.editor?.getEditors().length);await page.locator('#startupNotice').waitFor({state:'hidden'});
      await page.evaluate(()=>{const audio=window.__wonderSwanCheck.megaDrive.audio,ensure=audio.ensureRouting.bind(audio);audio.ensureRouting=context=>{if(!audio.outputNode){const sink=context.createGain();sink.gain.value=0;sink.connect(context.destination);audio.outputNode=sink;}return ensure(context);};});
      await runSource(page,`const extra=await createSoundChip('wonderswan',{id:'wonderswan:browser-check'});extra.initialize();extra.setVolume(2,9,9);liveLoop('extra-wave',async()=>{extra.noteOn(2,'A4');await sleep(60);});`,execution);
      await page.waitForFunction(()=>window.__wonderSwanCheck.megaDrive.isReady());await installCapture(page);const pcm=await audible(page,'Genesis additional '+execution,{hz:440,mono:true});
      const entries=await page.evaluate(()=>({chips:window.__wonderSwanCheck.runtime.chipInspector.list().map(entry=>[entry.id,entry.kind]),strips:window.__wonderSwanCheck.megaDrive.mixer.list().map(entry=>entry.id)}));
      assert(entries.chips.some(([id,kind])=>id==='wonderswan:browser-check'&&kind==='wonderswan'));assert(entries.strips.includes('wonderswan:browser-check'));
      const state=await page.evaluate(()=>window.__wonderSwanCheck.runtime.chipInspector.read('wonderswan:browser-check'));assert(state.channels[2].active);assert.equal(state.clock,3072000);
      const ownership=await sharedChannels(page,execution,{setup:"const extra=await createSoundChip('wonderswan',{id:'wonderswan:ownership-check'});extra.initialize();",name:'extra',id:'wonderswan:ownership-check'});
      await page.click('#stopButton');await page.waitForFunction(()=>window.__wonderSwanCheck.runtime.getState().playback==='stopped');await silent(page,'Genesis additional Stop');
      assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);results.push({execution,hz:pcm.channels[0].hz,independentMixer:true,stopped:true,ownership});
    }finally{await page.close();}
  }
  return{browser:browserName,additionalInGenesis:results};
}

(async () => {
  try {
    const nested = await fs.stat(path.join(config.docs,'playground/index.html')).then(()=>true,()=>false);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base = `http://127.0.0.1:${server.address().port}/${nested?'playground/':''}index.html`;
    for (const name of [...new Set(config.engines)]) {
      const browser = await ({chromium,webkit})[name].launch({headless:true,
        ...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}:{})});
      try {
        const page = await browser.newPage({serviceWorkers:'block',viewport:{width:1600,height:1100}});
        page.setDefaultTimeout(15000); const errors=[],missing=[];
        page.on('pageerror',error=>errors.push(error.message)); page.on('response',response=>{if(response.status()===404)missing.push(response.url());});
        const result = await check(page,base,name);
        assert.deepEqual(errors,[],'browser runtime errors'); assert.deepEqual(missing,[],'missing packaged/runtime assets');
        if(config.screenshots){
          await fs.mkdir(config.screenshots,{recursive:true});await page.click('#wonderswanTab');
          await page.locator(control('frequency')).waitFor();
          await page.locator(panel).screenshot({path:path.join(config.screenshots,`wonderswan-${name}.png`)});
        }
        console.log(JSON.stringify({...result,...await checkAdditional(browser,base,name)}));
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
