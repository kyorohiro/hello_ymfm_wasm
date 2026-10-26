// Real Atari ST Playground: YM2149 profile, authoring, Keyboard and PCM.
// Defaults to Chromium + WebKit; select --chromium or --webkit for a focused run.
// --docs-dir PATH also accepts the flat directory produced by the itch packager.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

function options(args) {
  const result = {docs:path.resolve(__dirname, '../docs'), engines:[]};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--chromium' || arg === '--webkit') {result.engines.push(arg.slice(2)); continue;}
    if (arg === '--docs-dir' || arg.startsWith('--docs-dir=')) {
      const value = arg === '--docs-dir' ? args[++i] : arg.slice('--docs-dir='.length);
      if (!value) throw Error('--docs-dir requires a path');
      result.docs = path.resolve(value); continue;
    }
    if (arg === '--help') {
      console.log('Usage: node scripts/check_playground_atari_st_browser.cjs [--chromium] [--webkit] [--docs-dir PATH]');
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
const accessor = '\nwindow.__atariSTCheck={runtime,megaDrive,selectedMode,virtualFiles,editorAdapter,setBottomTab};';

// Request fresh PCM only when needed. Both channels are captured in the same
// render quanta, avoiding races between two independent AnalyserNode buffers.
const probeSource = `
class AtariStereoCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.capture = null;
    this.port.onmessage = ({data}) => {
      this.capture = {id:data.id,index:0,left:new Float32Array(8192),right:new Float32Array(8192)};
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
registerProcessor('atari-st-stereo-capture',AtariStereoCapture);
`;
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__atari_st_probe.js') {
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

const panel = '#ay8910Panel';
const control = name => `${panel} [data-chip-control="ay-${name}"]`;
const action = name => `${panel} [data-chip-action="ay-${name}"]`;
const read = page => page.evaluate(() => window.__atariSTCheck.runtime.chipInspector.read('ay8910'));
async function until(page,test,label) {
  const deadline = Date.now() + 6000; let state;
  while (Date.now() < deadline) {
    state = await read(page); if (test(state)) return state;
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
    return window.__atariSTCheck.runtime.playSource(source,{execution});
  },{source,execution});
}
function profile(state) {return {clock:state.clock,type:state.type,flags:state.flags};}
const expectedProfile = {clock:2000000,type:16,flags:1};

async function installCapture(page) {
  await page.evaluate(async () => {
    const state = window.__atariSTCheck, context = state.megaDrive.audioContext;
    await context.audioWorklet.addModule(new URL('/__atari_st_probe.js',location.href));
    const node = new AudioWorkletNode(context,'atari-st-stereo-capture',{
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
        let square = 0,peak = 0,finite = true; const crossings = [];
        for (let i = 0; i < values.length; i++) {
          const value = values[i]; square += (value-mean)**2; peak = Math.max(peak,Math.abs(value));
          finite = finite && Number.isFinite(value);
          if (i && values[i-1] < mean && value >= mean) crossings.push(i-1+(mean-values[i-1])/(value-values[i-1]));
        }
        return {rms:Math.sqrt(square/values.length),peak,finite,
          hz:crossings.length>2?(crossings.length-1)*context.sampleRate/(crossings.at(-1)-crossings[0]):0};
      });
      let difference = 0;
      for (let i = 0; i < data.left.length; i++) difference = Math.max(difference,Math.abs(data.left[i]-data.right[i]));
      waiter.resolve({channels,difference,frames:data.left.length,sampleRate:context.sampleRate});
    };
    state.capture = () => new Promise((resolve,reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {pending.delete(id); reject(Error('PCM capture timed out'));},5000);
      pending.set(id,{resolve,timer}); node.port.postMessage({id});
    });
  });
}
const capture = page => page.evaluate(() => window.__atariSTCheck.capture());
async function audible(page,label,hz) {
  let pcm;
  for (let attempt = 0; attempt < 8; attempt++) {
    pcm = await capture(page);
    if (pcm.channels.every(channel => channel.rms > .0002 && (hz === undefined || Math.abs(channel.hz-hz) < 3))) break;
  }
  assert(pcm.channels.every(channel => channel.finite && channel.rms > .0002 && channel.peak < .99),label+': '+JSON.stringify(pcm));
  assert(pcm.difference < 1e-7,label+': YM2149 reaches both outputs as mono');
  if (hz !== undefined) assert(pcm.channels.every(channel => Math.abs(channel.hz-hz) < 3),label+': wrong pitch '+JSON.stringify(pcm));
  return pcm;
}
async function silent(page,label) {
  let pcm;
  for (let attempt = 0; attempt < 8; attempt++) {pcm = await capture(page); if (pcm.channels.every(channel => channel.peak < .0001)) return;}
  throw Error(label+': output stayed audible '+JSON.stringify(pcm));
}
async function stop(page) {
  await page.click('#stopButton');
  await page.waitForFunction(() => window.__atariSTCheck.runtime.getState().playback === 'stopped');
  await until(page,state => state.channels.every(channel => !channel.active),'Stop releases all voices');
  await silent(page,'Stop'); assert.deepEqual(profile(await read(page)),expectedProfile,'Stop preserves YM2149 profile');
}
async function hold(page,callback) {
  const button = page.locator(action('hold')); await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox(); await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  try {return await callback();} finally {await page.mouse.move(4,4); await page.mouse.up();}
}
async function checkTypes(page) {
  const result = await page.evaluate(async () => {
    const selected = monaco.editor.getModels().find(model => model.uri.path.endsWith('/tetorica-playground-atari-st.d.ts'));
    const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
    async function probe(name,source) {
      const model = monaco.editor.createModel(source,'javascript',monaco.Uri.parse(`file:///atari-check-${name}.js`));
      try {
        const worker = await getWorker(model.uri),uri = model.uri.toString();
        return {entries:(await worker.getCompletionsAtPosition(uri,source.length))?.entries.map(entry=>entry.name) ?? [],
          diagnostics:await worker.getSemanticDiagnostics(uri)};
      } finally {model.dispose();}
    }
    return {selected:selected?.getValue(),globals:await probe('globals',';\n'),pg:await probe('pg','pg.'),
      ay:await probe('ay','ay.'),valid:await probe('valid',"ay.setVoice(2,{tone:true,noise:false,volume:9}); ay.noteOn(2,'A4');"),
      invalid:await probe('invalid',"ay.noteOn(3,'A4');")};
  });
  assert.match(result.selected ?? '',/type TetoricaSelectedChip\s*=\s*['"]atari-st['"]/);
  for (const target of ['globals','pg']) {
    assert(result[target].entries.includes('ay'),target+': AY global is available');
    for (const name of ['fm','play','FM_PRESETS','CH1','psg','opll','opl']) assert(!result[target].entries.includes(name),target+': '+name+' leaked');
  }
  for (const method of ['setVoice','setNoisePeriod','setEnvelope','noteOn','keyOff']) assert(result.ay.entries.includes(method),method+' completion');
  assert(!result.ay.entries.includes('dispose'),'borrowed primary has no dispose');
  assert.deepEqual(result.valid.diagnostics,[],'valid AY code typechecks');
  assert(result.invalid.diagnostics.some(diagnostic => diagnostic.code === 2345),'fourth tone channel is rejected');
  return {ayGlobal:true,noImplicitFM:true,threeChannelBounds:true};
}
async function keyboard(page) {
  await page.evaluate(() => window.__atariSTCheck.setBottomTab('keyboard'));
  await page.locator('#operatorKeyboardRoot button').filter({hasText:/^Ukulele$/}).click();
  await page.selectOption('#playgroundKeyboardChip','chip:ay8910');
  await page.selectOption('#playgroundKeyboardTargetChannel','2');
  assert.deepEqual(await page.locator('#playgroundKeyboardTargetChannel option').evaluateAll(nodes=>nodes.map(node=>node.value)),['0','1','2']);
  assert.equal(await page.locator('#playgroundKeyboardChip option[value="chip:ym2413"]').count(),0);
  const key = await page.locator('#operatorKeyboardRoot .key').evaluateAll(nodes =>
    nodes.find(node=>node.querySelector('span')?.textContent==='A4')?.dataset.key);
  assert(key,'Ukulele Keyboard offers A4');
  await page.keyboard.down(key);
  try {
    const state = await until(page,state => state.channels[2].active,'Keyboard selected CH3');
    assert(state.channels.slice(0,2).every(channel=>!channel.active),'Keyboard addresses only selected physical channel');
    await audible(page,'Keyboard CH3',440);
  } finally {await page.keyboard.up(key);}
  await until(page,state => !state.channels[2].active,'Keyboard keyup releases CH3'); await silent(page,'Keyboard keyup');
}
async function check(page,base,browserName) {
  await page.goto(base+'?mode=atari-st&no-sw=1');
  await page.waitForFunction(() => window.__atariSTCheck && window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  assert.equal(await page.locator('#playgroundMode').inputValue(),'atari-st');
  assert.match(await page.locator('#playgroundMode option[value="atari-st"]').textContent(),/Atari ST/);
  assert.equal(await page.evaluate(() => window.__atariSTCheck.megaDrive.audioContext),null,'opening Atari ST is lazy');
  for (const id of ['operatorTabButton','segapsgTab','ym2413Tab','y8950Tab']) assert(!await page.locator('#'+id).isVisible(),id+' is absent');
  assert(await page.locator('#ay8910Tab').isVisible()); assert.match(await page.locator('#ay8910Tab').textContent(),/YM2149/);
  const types = await checkTypes(page);
  const programs = await page.evaluate(async () => {
    const {MODE_DEFAULT_CODES,MODE_EXAMPLE_FILES} = await import(new URL('./playground_examples.js',location.href));
    const state = window.__atariSTCheck,examples = MODE_EXAMPLE_FILES['atari-st'];
    return {starter:MODE_DEFAULT_CODES['atari-st'],editor:state.editorAdapter.getValue(),examples,
      actual:state.virtualFiles.list().filter(file => file.path.startsWith('/examples/') && file.path.endsWith('.js')).map(file=>file.path).sort()};
  });
  assert.equal(programs.editor,programs.starter); assert(programs.examples.length>=2 && programs.examples.length<=3);
  assert.deepEqual(programs.actual,programs.examples.map(file=>file.path).sort());
  // Replace only the final hardware sink before lazy initialization. Worklets,
  // Mixer, FX and their output-monitor tap still process the actual PCM.
  await page.evaluate(() => {
    const audio = window.__atariSTCheck.megaDrive.audio,ensure = audio.ensureRouting.bind(audio);
    audio.ensureRouting = context => {
      if (!audio.outputNode) {const sink = context.createGain(); sink.gain.value = 0; sink.connect(context.destination); audio.outputNode = sink;}
      return ensure(context);
    };
  });
  await page.click('#runButton'); await page.waitForFunction(() => window.__atariSTCheck.megaDrive.isReady());
  await installCapture(page); await audible(page,'mode starter'); await stop(page);
  const primaries = await page.evaluate(() => ({
    chips:window.__atariSTCheck.runtime.chipInspector.list().map(entry=>[entry.id,entry.kind]),
    endpoints:window.__atariSTCheck.megaDrive.primaryEndpoints.map(entry=>entry.name),
    strips:window.__atariSTCheck.megaDrive.mixer.list().map(entry=>entry.id),
    fm:window.__atariSTCheck.megaDrive.capabilities.fmChannels,
  }));
  assert.deepEqual(primaries,{chips:[['ay8910','ay8910']],endpoints:['ay8910'],strips:['ay8910'],fm:0});
  assert.deepEqual(profile(await read(page)),expectedProfile);
  const executions = [];
  for (const execution of ['main','worker']) {
    await runSource(page,`if(typeof fm!=='undefined'||typeof opll!=='undefined'||typeof opl!=='undefined'||typeof play!=='undefined')throw Error('Implicit FM');
      const a=await useSoundChip('ay8910');if(a.id!=='ay8910'||a.dispose||a.clock!==2000000)throw Error('Wrong borrowed primary');
      await livePrepare('atari-st-profile',api=>{if(!api.ay||api.fm||api.opll||api.opl)throw Error('Wrong livePrepare globals');});
      for(const ch of [0,1,2])ay.setVoice(ch,{tone:true,noise:false,volume:9,envelope:false});ay.allNotesOff();
      liveLoop('atari-st-pitch',async()=>{ay.noteOn(0,'A4');await sleep(60);});`,execution);
    await until(page,state=>state.channels[0].active,execution+' note');
    const pcm = await audible(page,execution+' borrowed AY',440);
    assert.deepEqual(profile(await read(page)),expectedProfile);
    assert.deepEqual(await page.evaluate(()=>window.__atariSTCheck.runtime.chipInspector.list().map(entry=>entry.id)),['ay8910'],'useSoundChip borrows rather than allocates');
    await stop(page); await keyboard(page); executions.push({execution,hz:pcm.channels[0].hz,monoDifference:pcm.difference});
  }
  await page.click('#ay8910Tab'); await page.locator(control('volume')).waitFor();
  await page.click(`${panel} [data-chip-channel="1"]`); await page.click(action('basic'));
  await field(page,'frequency',660); await until(page,state=>Math.abs(state.channels[1].frequency-660)<3,'panel tone pitch');
  await field(page,'tone',false); await field(page,'noise',true); await field(page,'volume',8); await field(page,'noise-period',7);
  await until(page,state=>!state.channels[1].toneEnabled&&state.channels[1].noiseEnabled&&state.noise.period===7,'panel shared noise');
  await hold(page,()=>audible(page,'panel noise Hold')); await silent(page,'panel noise release outside');
  await field(page,'tone',true); await field(page,'noise',false);
  await field(page,'envelope-period',500); await field(page,'envelope-shape',10); await field(page,'envelope',true);
  await until(page,state=>state.channels[1].configuredEnvelope&&state.envelope.period===500&&state.envelope.shape===10,'panel hardware envelope');
  await page.click(action('envelope-retrigger')); await hold(page,()=>audible(page,'panel envelope Hold')); await silent(page,'panel envelope release');
  const configured = await read(page); await stop(page);
  await runSource(page,"console.log('ATARI_ST_REUSED');");
  const reused = await read(page); assert.deepEqual(profile(reused),expectedProfile);
  assert.deepEqual(reused.noise,configured.noise); assert.deepEqual(reused.envelope,configured.envelope);
  assert.equal(reused.channels[1].configuredEnvelope,true,'Run retains editor envelope choice'); await stop(page);
  const examples = [];
  for (let i=0; i<programs.examples.length; i++) {
    const example = programs.examples[i],execution = i%2?'worker':'main';
    await runSource(page,example.data,execution); await audible(page,example.path);
    assert.deepEqual(profile(await read(page)),expectedProfile); await stop(page);
    examples.push({path:example.path,execution});
  }
  assert(!await page.locator('#consoleOutput').evaluate(node=>/Playback failed|ReferenceError|TypeError:|Error: Wrong|Error: Implicit/.test(node.textContent)),await page.locator('#consoleOutput').textContent());
  return {browser:browserName,passed:true,profile:expectedProfile,primaries,types,executions,keyboard:true,
    editor:{tone:true,noise:true,envelope:true,retainedAfterRun:true},examples,physicalOutputMuted:true};
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
        console.log(JSON.stringify(result));
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
