// Mega-CD built-ins, examples, input dialog and sampled keyboard in real browsers.
// Self-hosts docs; --webkit includes WebKit and --webkit-only selects it alone.
// --quality-only records the current four-source starter and FM/PCM isolation cases for four
// seconds each, in Main and Worker, without analyser polling or microphone input.
// Finite loadSample starters assert smooth PCM/combined output after 0.5 s.
// --quality-assert-envelope requires that finite starter; --quality-baseline
// records metrics without envelope assertions for a deliberate comparison.
// Microphone input is an oscillator-backed MediaStream; no hardware is accessed.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let file = path.resolve(docs,'.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file,'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + '\nwindow.__megacdTest={runtime,megaDrive,selectedMode,virtualFiles,setSource:value=>editorAdapter.setValue(value)};');
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch(error) {response.writeHead(404).end(error.message);}
});

function waveFile() {
  const rate = 16000, frames = rate * 3, data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8,4); data.write('WAVEfmt ',8);
  data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22);
  data.writeUInt32LE(rate,24); data.writeUInt32LE(rate * 2,28); data.writeUInt16LE(2,32);
  data.writeUInt16LE(16,34); data.write('data',36); data.writeUInt32LE(frames * 2,40);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / rate) * 15000),44 + i * 2);
  return data;
}

async function run(page, source, execution) {
  await page.evaluate(({source,execution}) => {
    window.__megacdTest.setSource(source);
    document.getElementById('workerExecution').checked = execution === 'worker';
  },{source,execution});
  await page.locator('#runButton').click();
}
const waitLog = (page,text) => page.waitForFunction(text => document.getElementById('consoleOutput').textContent.includes(text),text);
const state = page => page.evaluate(() => window.__megacdTest.runtime.chipInspector.read('rf5c164'));
async function waitState(page, predicate) {
  const deadline = Date.now() + 20000;
  let current;
  do {
    current = await state(page);
    if (predicate(current)) return current;
    await new Promise(resolve => setTimeout(resolve,20));
  } while (Date.now() < deadline);
  throw Error(`PCM state did not settle: ${JSON.stringify(current)}`);
}
async function activeState(page,count,minimumFirstStep = 0) {
  return waitState(page,current => current.channels.filter(ch => ch.active).length === count && current.channels[0].step >= minimumFirstStep);
}
async function meter(page) {
  await page.evaluate(() => {
    if (window.__megacdMeter) {window.__megacdMeter.peak = 0; return;}
    const {megaDrive} = window.__megacdTest, context = megaDrive.audioContext;
    const analyser = context.createAnalyser(), silent = context.createGain();
    analyser.fftSize = 2048; silent.gain.value = 0;
    analyser.connect(silent); silent.connect(context.destination);
    const current = window.__megacdMeter = {peak:0,finite:true};
    megaDrive.audio.connectOutputMonitor(analyser);
    current.timer = setInterval(() => {
      const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
      for (const value of pcm) {current.finite &&= Number.isFinite(value); current.peak = Math.max(current.peak,Math.abs(value));}
    },10);
  });
}
async function audible(page) {
  await page.waitForFunction(() => window.__megacdMeter.peak > .0001);
  assert.equal(await page.evaluate(() => window.__megacdMeter.finite),true,'finite PCM');
}
async function stopped(page) {
  await page.locator('#stopButton').click();
  await waitState(page,current => current.channels.every(ch => !ch.active));
}
async function press(page,key,voices = 1) {
  if (!await page.locator('#keyboardPanel').isVisible()) await page.locator('#keyboardTab').click();
  await page.locator(`#playgroundKeyboardKeys [data-key="${key}"]`).focus();
  await page.keyboard.down(key);
  await activeState(page,voices);
}
async function samplerReady(page) {
  await page.waitForFunction(() => window.__megacdTest.runtime.getKeyboardTarget()?.name === 'sampler');
}
async function chooseFile(page, screenshotName) {
  const dialog = page.locator('dialog[data-audio-input]');
  await dialog.waitFor({state:'visible'});
  await dialog.locator('[data-audio-file]').setInputFiles({name:'sine.wav',mimeType:'audio/wav',buffer:waveFile()});
  await dialog.locator('[data-audio-action="use"]:enabled').waitFor();
  await dialog.locator('[data-field="rootMidi"]').selectOption('69');
  await dialog.locator('[data-field="loopEnabled"]').check();
  await page.screenshot({path:`/private/tmp/playground-megacd-input-${screenshotName}.png`});
  await dialog.locator('[data-audio-action="use"]').click();
  await dialog.waitFor({state:'detached'});
}

async function checkTypes(page) {
  const result = await page.evaluate(async () => {
    const selected = monaco.editor.getModels().find(model => model.uri.path.endsWith('/tetorica-playground-mega-cd.d.ts'));
    const valid = `async function check() {\nfm.setPreset(CH6, FM_PRESETS['one-op-basic']);\npg.psg.noteOn(PSG1, 'C4');\nconst audio = await pg.inputAudio();\nconst pcm = await useSoundChip('rf5c164');\nif (audio) await pcm.loadSample(audio);\nawait pcm.keyOn(7);\n`;
    const source = valid + 'pcm.dispose();\nfm.setPreset(6, {});\n}';
    const model = monaco.editor.createModel(source,'javascript',monaco.Uri.parse('file:///mega-cd-types.js'));
    try {
      const worker = await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri);
      const diagnostics = await worker.getSemanticDiagnostics(model.uri.toString());
      return {selected:selected?.getValue(),validLength:valid.length,diagnostics:diagnostics.map(({start,code,messageText}) => ({start,code,messageText}))};
    } finally {model.dispose();}
  });
  assert(result.selected?.includes('"mega-cd"'));
  assert.deepEqual(result.diagnostics.filter(item => item.start < result.validLength),[], 'FM/PSG/decoded PCM/input types');
  assert(result.diagnostics.some(item => item.code === 2339),'borrowed PCM does not expose dispose');
  assert(result.diagnostics.some(item => item.code === 2345),'FM channel range remains bounded');
}

async function checkSamplerTypes(page,source) {
  const diagnostics = await page.evaluate(async source => {
    const model = monaco.editor.createModel(source,'javascript',monaco.Uri.parse('file:///mega-cd-actual-sampler-types.js'));
    try {
      const worker = await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri);
      return (await worker.getSemanticDiagnostics(model.uri.toString())).map(({start,code,messageText}) => ({start,code,messageText}));
    } finally {model.dispose();}
  },source);
  assert.deepEqual(diagnostics,[],'the actual sampler source has no Monaco checkJs diagnostics');
}

const qualityDirectory = `/private/tmp/megacd-quality-${Date.now()}`;
function floatWav(left,right,rate) {
  const frames = left.length, buffer = Buffer.alloc(44 + frames * 8);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8,4); buffer.write('WAVEfmt ',8);
  buffer.writeUInt32LE(16,16); buffer.writeUInt16LE(3,20); buffer.writeUInt16LE(2,22);
  buffer.writeUInt32LE(rate,24); buffer.writeUInt32LE(rate * 8,28); buffer.writeUInt16LE(8,32);
  buffer.writeUInt16LE(32,34); buffer.write('data',36); buffer.writeUInt32LE(frames * 8,40);
  for (let i = 0; i < frames; i++) {buffer.writeFloatLE(left[i],44 + i * 8); buffer.writeFloatLE(right[i],48 + i * 8);}
  return buffer;
}
function qualityStats(left,right,rate,{sustained = false,analysisStartSeconds = .5} = {}) {
  let peak = 0, maxDerivative = 0, squares = 0, sum = 0, clipped = 0, nonFinite = 0, jumps = 0;
  const first = Math.min(left.length - 2,Math.round(analysisStartSeconds * rate));
  const framesAnalyzed = left.length - first;
  const topJumps = [];
  for (let i = first; i < left.length; i++) {
    for (const channel of [left,right]) {
      const value = channel[i];
      if (!Number.isFinite(value)) {nonFinite++; continue;}
      peak = Math.max(peak,Math.abs(value)); squares += value * value; sum += value;
      if (Math.abs(value) >= 1) clipped++;
      if (i > first) maxDerivative = Math.max(maxDerivative,Math.abs(value - channel[i - 1]));
    }
    if (i > first) {
      const delta = Math.max(Math.abs(left[i] - left[i - 1]),Math.abs(right[i] - right[i - 1]));
      if (delta > .1) jumps++;
      if (topJumps.length < 12 || delta > topJumps.at(-1).delta) {
        topJumps.push({seconds:i / rate,delta}); topJumps.sort((a,b) => b.delta - a.delta); topJumps.length = Math.min(12,topJumps.length);
      }
    }
  }
  // Select the highest-energy power-of-two window after startup, so a finite
  // sample's final silence cannot masquerade as a clean spectrum.
  const n = Math.min(65536,2 ** Math.floor(Math.log2(framesAnalyzed / 2)));
  const energy = new Float64Array(left.length + 1);
  for (let i = first; i < left.length; i++) {const mono=(left[i]+right[i])*.5;energy[i+1]=energy[i]+mono*mono;}
  let start = first, maximumEnergy = -1;
  const hop = Math.max(1,n >> 2);
  for (let candidate = first; candidate <= left.length - n; candidate += hop) {
    const current = energy[candidate + n] - energy[candidate];
    if (current > maximumEnergy) {maximumEnergy = current; start = candidate;}
  }
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (left[start + i] + right[start + i]) * .5 * (.5 - .5 * Math.cos(2 * Math.PI * i / (n - 1)));
  for (let i = 1,j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) {[re[i],re[j]] = [re[j],re[i]];}
  }
  for (let width = 2; width <= n; width <<= 1) {
    const angle = -2 * Math.PI / width, realStep = Math.cos(angle), imagStep = Math.sin(angle);
    for (let offset = 0; offset < n; offset += width) {
      let wr = 1, wi = 0;
      for (let j = 0; j < width / 2; j++) {
        const a = offset + j, b = a + width / 2, tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const next = wr * realStep - wi * imagStep; wi = wr * imagStep + wi * realStep; wr = next;
      }
    }
  }
  const powers = Array.from({length:n / 2},(_,i) => re[i] * re[i] + im[i] * im[i]);
  let spectral = 0, above4k = 0;
  const peaks = [];
  for (let i = 2; i < powers.length - 1; i++) {
    spectral += powers[i]; if (i * rate / n > 4000) above4k += powers[i];
    if (powers[i] >= powers[i - 1] && powers[i] > powers[i + 1]) peaks.push({hz:i * rate / n,power:powers[i]});
  }
  peaks.sort((a,b) => b.power - a.power);
  const expectedHz = Math.round(440 * 2 ** ((48 - 69) / 12) * 128 * 384 * 2048 / 12500000) * 12500000 / (128 * 384 * 2048);
  let fundamental = 0;
  for (let i = 2; i < powers.length; i++) if (Math.abs(i * rate / n - expectedHz) <= rate / n * 4) fundamental += powers[i];
  return {frames:left.length,sampleRate:rate,seconds:left.length / rate,
    analysisWindow:{startSeconds:first / rate,endSeconds:left.length / rate,frames:framesAnalyzed,excludes:'first 0.5 s of startup and preceding release'},
    peak,rms:Math.sqrt(squares / (framesAnalyzed * 2)),dc:sum / (framesAnalyzed * 2),clipped,nonFinite,maxDerivative,jumpsAbovePointOne:jumps,topJumps,
    spectrumWindow:{selection:'highest-energy window after startup',startSeconds:start / rate,seconds:n / rate,rms:Math.sqrt(maximumEnergy / n),above4kRatio:spectral ? above4k / spectral : 0,
      strongest:peaks.slice(0,8).map(({hz,power}) => ({hz,powerRatio:spectral ? power / spectral : 0})),
      ...(sustained ? {expectedHz,outsideFundamentalRatio:spectral ? Math.max(0,1 - fundamental / spectral) : 0} : {})}};
}

async function checkQuality(page,browserName) {
  await fs.mkdir(qualityDirectory,{recursive:true});
  await run(page,"console.log('QUALITY_AUDIO_READY');",'main');
  await waitLog(page,'QUALITY_AUDIO_READY'); await stopped(page);
  await page.evaluate(async () => {
    const context = window.__megacdTest.megaDrive.audioContext;
    const source = `class Capture extends AudioWorkletProcessor {
      constructor(){super();this.capture=null;this.port.onmessage=({data})=>{if(data.action==='start')this.capture={left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0,startFrame:null};};}
      process(inputs,outputs){for(const channel of outputs[0])channel.fill(0);const c=this.capture,input=inputs[0];if(!c||!input[0])return true;if(c.startFrame===null)c.startFrame=currentFrame;const count=Math.min(input[0].length,c.left.length-c.offset);c.left.set(input[0].subarray(0,count),c.offset);c.right.set((input[1]||input[0]).subarray(0,count),c.offset);c.offset+=count;if(c.offset===c.left.length){this.capture=null;this.port.postMessage({left:c.left,right:c.right,sampleRate,startFrame:c.startFrame},[c.left.buffer,c.right.buffer]);}return true;}
    }registerProcessor('tetorica-quality-capture',Capture);`;
    const url = URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    try {await context.audioWorklet.addModule(url);} finally {URL.revokeObjectURL(url);}
    const node = new AudioWorkletNode(context,'tetorica-quality-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
    node.connect(context.destination);
    window.__qualityTap = {node,detach:window.__megacdTest.megaDrive.audio.connectOutputMonitor(node)};
  });
  const starter = await page.evaluate(async () => (await import('./playground_examples.js')).MODE_DEFAULT_CODES['mega-cd']);
  assert(starter.includes('await pcm.keyOn(0);') && starter.includes('await play(note, {channel: CH1, beats: 0.8});'),'quality isolation matches the exact current starter');
  const finiteSample = /\bpcm\.loadSample\(/.test(starter);
  if (process.argv.includes('--quality-assert-envelope')) assert(finiteSample,'--quality-assert-envelope requires the updated finite loadSample starter');
  const assertEnvelope = finiteSample && !process.argv.includes('--quality-baseline');
  // The current starter includes PSG/CD-DA as well as FM/PCM. Explicit strips
  // prevent those siblings leaking into either older FM/PCM isolation case,
  // and reset persisted mute choices before each Main/Worker starter run.
  const isolated=(source,enabled)=>`for(const id of ['ym2612','segapsg','rf5c164','cdda'])await mixer.set(id,{muted:!${JSON.stringify(enabled)}.includes(id)});\n`+source;
  const cases = [
    {name:'exact-starter',source:isolated(starter,['ym2612','segapsg','rf5c164','cdda'])},
    {name:'fm-only',source:isolated(starter.replaceAll('await pcm.keyOn(0);','// PCM keyOn omitted for isolation.'),['ym2612'])},
    {name:'pcm-only-gated',source:isolated(starter.replaceAll('await play(note, {channel: CH1, beats: 0.8});','await beat(0.8);'),['rf5c164'])},
    ...(!finiteSample ? [{name:'pcm-only-sustained',source:starter.slice(0,starter.indexOf("liveLoop('fm-and-pcm'")) + "await pcm.setPitch(0, stepFor(48));\nawait pcm.keyOn(0);\nliveLoop('quality-hold', async () => {await beat(8);});\n"}] : []),
  ];
  const summaries = [];
  for (const execution of ['main','worker']) for (const test of cases) {
    await stopped(page);
    await page.evaluate(() => {
      const {node} = window.__qualityTap;
      window.__qualityResult = new Promise(resolve => {node.port.onmessage = ({data}) => resolve(data);});
      node.port.postMessage({action:'start',frames:Math.round(window.__megacdTest.megaDrive.audioContext.sampleRate * 4)});
    });
    await run(page,test.source,execution);
    const result = await page.evaluate(async () => {
      const data = await window.__qualityResult;
      return {left:Array.from(data.left),right:Array.from(data.right),sampleRate:data.sampleRate,startFrame:data.startFrame};
    });
    const output = path.join(qualityDirectory,`${browserName}-${execution}-${test.name}.wav`);
    await fs.writeFile(output,floatWav(result.left,result.right,result.sampleRate));
    const summary = {browser:browserName,execution,case:test.name,finiteSample,assertEnvelope,output,startAudioSeconds:result.startFrame / result.sampleRate,
      ...qualityStats(result.left,result.right,result.sampleRate,{sustained:test.name === 'pcm-only-sustained'})};
    summaries.push(summary); console.log(JSON.stringify({quality:summary}));
    assert.equal(summary.nonFinite,0,'recorded PCM is finite');
    assert(summary.peak > .01,'the analyzed region contains audible signal');
    if (assertEnvelope) {
      assert.equal(summary.clipped,0,'finite starter output does not clip');
      assert.equal(summary.jumpsAbovePointOne,0,'finite starter has no >0.1 FS discontinuities after startup');
      if (test.name === 'pcm-only-gated') assert(summary.maxDerivative < .01,'finite PCM note edges stay below 0.01 FS/sample after startup');
      if (test.name === 'exact-starter') assert(summary.maxDerivative < .04,'combined FM and finite PCM stay below 0.04 FS/sample after startup');
    }
  }
  await stopped(page);
  await page.evaluate(() => {const tap=window.__qualityTap;tap.detach();tap.node.disconnect();tap.node.port.close();delete window.__qualityTap;});
  await fs.writeFile(path.join(qualityDirectory,`${browserName}-summary.json`),JSON.stringify(summaries,null,2));
  console.log(JSON.stringify({browser:browserName,qualityOnly:true,directory:qualityDirectory,recordings:summaries.length}));
}

async function checkBrowser(name,type,base) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  const context = await browser.newContext({serviceWorkers:'block',viewport:{width:1320,height:960}});
  await context.addInitScript(() => {
    const connect=AudioNode.prototype.connect,gates=new WeakMap();
    AudioNode.prototype.connect=function(destination,...rest){
      if(destination===this.context.destination){let gate=gates.get(this.context);if(!gate){gate=this.context.createGain();gate.gain.value=0;gates.set(this.context,gate);connect.call(gate,destination);}return connect.call(this,gate,...rest);}
      return connect.call(this,destination,...rest);
    };
    window.__testCapture = {requests:0,stopped:0,defer:false};
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async () => {
      window.__testCapture.requests++;
      const audio = new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain();
      gain.gain.value = .4;
      const destination = audio.createMediaStreamDestination();
      oscillator.connect(gain); gain.connect(destination); oscillator.start(); await audio.resume();
      // WebKit may expose another JS wrapper on each getTracks() call. Keep
      // the instrumented track objects stable for cleanup accounting.
      const tracks = destination.stream.getTracks();
      Object.defineProperty(destination.stream,'getTracks',{value:()=>tracks});
      for (const track of tracks) {
        const stop = track.stop.bind(track); let ended = false;
        track.stop = () => {if (!ended) {ended = true; window.__testCapture.stopped++; oscillator.stop(); void audio.close();} stop();};
      }
      if (window.__testCapture.defer) return new Promise(resolve => {window.__testCapture.release = () => {window.__testCapture.defer = false; resolve(destination.stream);};});
      return destination.stream;
    }});
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(20000); page.on('pageerror',error => errors.push(error.message));
  try {
    await page.goto(`${base}?mode=mega-cd&no-sw=1`);
    await page.waitForFunction(() => window.__megacdTest && window.monaco?.editor?.getEditors().length);
    await page.locator('#startupNotice').waitFor({state:'hidden'});
    if (process.argv.includes('--quality-only')) {
      await checkQuality(page,name);
      assert.deepEqual(errors,[],'quality capture page errors');
      return;
    }
    assert.equal(await page.title(),'Tetorica Mega CD Playground');
    for (const selector of ['#operatorTabButton','#segapsgTab','#rf5c164Tab']) assert(await page.locator(selector).isVisible());
    assert.equal(await page.locator('#pwmTab').isVisible(),false);
    await checkTypes(page);
    const files = await page.evaluate(async () => {
      const {MODE_DEFAULT_CODES,MODE_EXAMPLE_FILES} = await import('./playground_examples.js');
      return [{path:'/index.js',data:MODE_DEFAULT_CODES['mega-cd']},...MODE_EXAMPLE_FILES['mega-cd']];
    });
    assert.equal(files.length,4);
    await checkSamplerTypes(page,files.find(file => file.path.endsWith('megacd-sampler.js')).data);
    if (process.argv.includes('--rf-only')) {
      for (const execution of ['main','worker']) {
        const source=`const audio={channels:[Float32Array.from({length:4096},(_,i)=>.5*Math.sin(2*Math.PI*440*i/16000))],sampleRate:16000,rootMidi:69,loopEnabled:true};keyboard.bind('sampler',await createSampleInstrument(audio));`;
        await run(page,source,execution);await samplerReady(page);await meter(page);await press(page,'1');await audible(page);
        const loaded=await state(page),sample=loaded.samples.find(sample=>sample.address===0);
        assert.equal(sample.frames,4096);assert.equal(sample.endGuardBytes,32);assert.equal(sample.end,4128);
        assert(sample.waveform.some(value=>Math.abs(value)>.1),'Inspector keeps the loaded sample waveform');
        await page.keyboard.down('2');const chord=await activeState(page,2),active=chord.channels.filter(channel=>channel.active);
        assert(Math.abs(active[1].step/active[0].step-2**(1/12))<.002);
        await page.keyboard.up('1');await page.keyboard.up('2');await activeState(page,0);await stopped(page);
        console.log(JSON.stringify({browser:name,execution,rfOnly:true,waveformMetadata:true,guardBytes:32,audible:true,pitch:true,release:true}));
      }
      assert.deepEqual(errors,[]);return;
    }
    for (const execution of ['main','worker']) {
      const marker = `PRIMARY_OK:${execution}`;
      await run(page,`const pcm = await useSoundChip('rf5c164');\nif (pcm !== await useSoundChip('rf5c164')) throw Error('Not shared');\nif (pcm.id !== 'rf5c164' || typeof pcm.dispose !== 'undefined') throw Error('Wrong primary');\nconsole.log('${marker}');`,execution);
      await waitLog(page,marker);
      await meter(page);
      const instruments = await page.evaluate(() => ({pcm:Boolean(window.__megacdTest.megaDrive.pcm),pwm:Boolean(window.__megacdTest.megaDrive.pwm),endpoints:window.__megacdTest.runtime.chipInspector.list()}));
      assert.equal(instruments.pcm,true); assert.equal(instruments.pwm,false);
      assert.equal(instruments.endpoints.filter(chip => chip.kind === 'rf5c164').length,1,'one physical PCM device');
      for (const file of files.filter(file => !file.path.endsWith('megacd-sampler.js'))) {
        await meter(page);
        await run(page,file.data,execution);
        await waitState(page,current => current.channels.some(ch => ch.active));
        await audible(page);
        await stopped(page);
        console.log(JSON.stringify({browser:name,execution,example:file.path,voices:true,stop:true}));
      }
      const sampler = files.find(file => file.path.endsWith('megacd-sampler.js'));
      await run(page,sampler.data,execution);
      if (execution === 'main') await chooseFile(page,`${name}-${execution}`);
      await samplerReady(page);
      assert.equal(await page.locator('dialog[data-audio-input]').count(),0,'a saved sample restores without opening the editor');
      assert(await page.evaluate(() => Boolean(window.__megacdTest.virtualFiles.get('/samples/sampler.sample.json'))),'sample edits are saved in the Cassette');
      await meter(page);
      await press(page,'1');
      assert.equal(await page.locator('#playgroundKeyboardChannelTools').isVisible(),false,'sample targets hide FM channel controls');
      const keys = await page.locator('#playgroundKeyboardKeys [data-key]').evaluateAll(buttons => buttons.map(button => ({key:button.dataset.key,note:button.querySelector('span').textContent})));
      assert.equal(keys.find(entry=>entry.key==='1').note,'G3');assert.equal(keys.find(entry=>entry.key==='2').note,'G#3');
      await audible(page);
      const first = await state(page); assert(first.samples.some(sample=>sample.address===0&&sample.endGuardBytes===32&&sample.waveform.length),'sampler guard load preserves Inspector waveform metadata');
      await page.keyboard.down('2');
      const chord = await activeState(page,2), active = chord.channels.filter(ch => ch.active);
      assert(Math.abs(active[1].step / active[0].step - 2 ** (1 / 12)) < .002,'sample pitch changes by a semitone');
      await page.keyboard.up('1'); await page.keyboard.up('2');
      await waitState(page,current => current.channels.every(ch => !ch.active));
      await page.locator('#codeTab').click();
      await page.locator('.monaco-editor textarea').first().focus();
      await page.keyboard.down('1');
      await page.waitForTimeout(execution === 'worker' ? 750 : 250);
      assert((await state(page)).channels.every(ch => !ch.active),'typing in Code does not play the sampler');
      await page.keyboard.up('1');
      await press(page,'1');
      await page.locator('#codeTab').click();
      await page.locator('.monaco-editor textarea').first().focus();
      await page.keyboard.up('1');
      await waitState(page,current => current.channels.every(ch => !ch.active));
      await page.locator('#consoleTab').click();
      if (!await page.locator('#keyboardPanel').isVisible()) await page.locator('#keyboardTab').click();
      for (const key of ['1','2','3','4','5','6','7','8']) await page.keyboard.down(key);
      await waitState(page,current => current.channels.every(ch => ch.active));
      await page.keyboard.down('9'); await page.keyboard.up('1');
      const stolen = await activeState(page,8,Math.floor(first.channels[0].step * 1.5));
      assert.equal(stolen.channels.filter(ch => ch.active).length,8,'ninth note steals one voice; release of the old owner does not silence it');
      for (const key of ['2','3','4','5','6','7','8','9']) await page.keyboard.up(key);
      await waitState(page,current => current.channels.every(ch => !ch.active));
      await press(page,'1'); await stopped(page); await page.keyboard.up('1');
      await run(page,sampler.data,execution);
      await samplerReady(page);
      assert.equal(await page.locator('dialog[data-audio-input]').count(),0,'re-Run restores the saved instrument without a dialog');
      await press(page,'1');await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await waitState(page,current => current.channels.every(ch => !ch.active));await page.keyboard.up('1');
      await stopped(page);
      await run(page,"const audio = await inputAudio(); if (audio !== null) throw Error('Cancel result'); console.log('FILE_CANCEL_OK');",execution);
      await page.locator('dialog[data-audio-input] [data-audio-action="cancel"]').click();
      await waitLog(page,'FILE_CANCEL_OK');
      await page.locator('dialog[data-audio-input]').waitFor({state:'detached'});
      console.log(JSON.stringify({browser:name,execution,samplerFile:true,sharedKeyboard:true,savedAssetRestore:true,polyphony:8,voiceSteal:true,pitch:true,keyRelease:true,editorSuppressesKeys:true,editorFocusRelease:true,heldStop:true,blurRelease:true,cancel:true}));
      await run(page,"const audio = await inputAudio(); if (audio) {keyboard.bind('sampler', await createSampleInstrument(audio)); console.log('MIC_READY');}",execution);
      const dialog = page.locator('dialog[data-audio-input]');
      await dialog.locator('[data-audio-action="record"]').click();
      await dialog.locator('[data-audio-action="stop"]').waitFor({state:'visible'});
      await page.waitForTimeout(350);
      await dialog.locator('[data-audio-action="stop"]').click();
      await dialog.locator('[data-field="save"]').uncheck();
      await dialog.locator('[data-audio-action="use"]:enabled').click();
      await waitLog(page,'MIC_READY');await samplerReady(page);
      await meter(page);
      await press(page,'1'); await audible(page); await page.keyboard.up('1'); await stopped(page);
      const capture = await page.evaluate(() => window.__testCapture);
      assert.equal(capture.requests,capture.stopped,'microphone tracks closed after use');
      await run(page,"const audio = await inputAudio(); console.log('UNEXPECTED_INPUT');",execution);
      await page.locator('dialog[data-audio-input]').waitFor({state:'visible'});
      await page.evaluate(() => window.__megacdTest.runtime.stop());
      await page.locator('dialog[data-audio-input]').waitFor({state:'detached'});
      assert.equal(await page.locator('#consoleOutput').textContent().then(text => text.includes('UNEXPECTED_INPUT')),false);
      await run(page,"const audio = await inputAudio(); if (audio !== null) throw Error('Cancel result'); console.log('MIC_CANCEL_OK');",execution);
      await page.locator('dialog[data-audio-input] [data-audio-action="record"]').click();
      await page.locator('dialog[data-audio-input] [data-audio-action="stop"]').waitFor({state:'visible'});
      await page.locator('dialog[data-audio-input] [data-audio-action="cancel"]').click();
      await waitLog(page,'MIC_CANCEL_OK');
      await page.waitForFunction(() => window.__testCapture.requests === window.__testCapture.stopped);
      await run(page,"await inputAudio(); console.log('UNEXPECTED_MIC_INPUT');",execution);
      await page.locator('dialog[data-audio-input] [data-audio-action="record"]').click();
      await page.locator('dialog[data-audio-input] [data-audio-action="stop"]').waitFor({state:'visible'});
      await page.evaluate(() => window.__megacdTest.runtime.stop());
      await page.locator('dialog[data-audio-input]').waitFor({state:'detached'});
      await page.waitForFunction(() => window.__testCapture.requests === window.__testCapture.stopped);
      await page.evaluate(() => {window.__testCapture.defer = true;});
      await run(page,"const audio = await inputAudio(); if (audio !== null) throw Error('Late cancel result'); console.log('LATE_CANCEL_OK');",execution);
      await page.locator('dialog[data-audio-input] [data-audio-action="record"]').click();
      await page.waitForFunction(() => typeof window.__testCapture.release === 'function');
      await page.locator('dialog[data-audio-input] [data-audio-action="cancel"]').click();
      await waitLog(page,'LATE_CANCEL_OK');
      await page.evaluate(() => {window.__testCapture.release(); delete window.__testCapture.release;});
      await page.waitForFunction(() => window.__testCapture.requests === window.__testCapture.stopped);
      console.log(JSON.stringify({browser:name,execution,samplerMicrophone:true,tracksClosed:true,stopClosesDialog:true,recordingCancel:true,recordingStop:true,latePermissionCleanup:true}));
    }
    assert.deepEqual(errors,[],'page errors');
    console.log(JSON.stringify({browser:name,megaCD:true,types:true,main:true,worker:true,passed:true}));
  } catch(error) {
    console.error(JSON.stringify({browser:name,console:await page.locator('#consoleOutput').textContent().catch(() => null),errors,dialog:await page.locator('dialog[data-audio-input]').count() ? await page.locator('dialog[data-audio-input]').textContent() : null}));
    await page.screenshot({path:`/private/tmp/playground-megacd-${name}-failure.png`}).catch(() => {});
    throw error;
  } finally {await context.close(); await browser.close();}
}

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/playground/index.html`;
    if (!process.argv.includes('--webkit-only')) await checkBrowser('chromium',chromium,base);
    if (process.argv.includes('--webkit') || process.argv.includes('--webkit-only')) await checkBrowser('webkit',webkit,base);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error);process.exitCode = 1;});
