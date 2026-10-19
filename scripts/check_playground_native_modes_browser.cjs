// Actual native-mode audio, Monaco types, primary devices and project migration.
// Self-hosts docs. Chromium runs by default; --webkit includes WebKit and
// --webkit-only selects WebKit. --modes=nes,snes,x68000,pc-engine focuses a run.
// --types-only and --audio-only support focused diagnosis after a failure.
// --project-only checks transfer without repeating the audio matrix.
// --trace-rpc adds primary request/reply traces to failure output.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'};
const accessor = '\nwindow.__nativeRegression={runtime,megaDrive,selectedMode,virtualFiles,getEditorValue,setEditorValue:value=>editorAdapter.setValue(value),captureProjectSnapshot,openVirtualFile,runCode};';
const modes = [
  {id:'nes', declaration:'nes', globals:['nes'], primaries:{nes:'nes'},
    valid:"nes.pulse.noteOn(1, 'C4');\nnes.triangle.noteOn('C3');\nnes.fds.setVolume(20);\n",
    invalid:"nes.pulse.noteOn(2, 'C4');\n",
    methods:{nes:['pulse','triangle','noise','dmc','fds','setClock','writeRegister']}},
  {id:'snes', declaration:'snes', globals:['snes'], primaries:{snes:'snes'},
    valid:"snes.setPreset(7, {sample:0, adsr1:143});\nsnes.noteOn(7, 'C4');\n",
    invalid:"snes.noteOn(8, 'C4');\n",
    methods:{snes:['loadBRR','setPreset','noteOn','keyOff','getState','readDsp']}},
  {id:'x68000', declaration:'x68000', globals:['opm','adpcm'], primaries:{opm:'ym2151',adpcm:'okim6258'},
    valid:"opm.setOperator(7, 3, {mul:1, tl:32});\nopm.noteOn(7, 'C4');\nadpcm.setDivider(512);\nadpcm.play({repeat:true});\n",
    invalid:"opm.noteOn(8, 'C4');\nadpcm.setDivider(256);\n",
    methods:{opm:['setOperator','setAlgo','setPan','noteOn','setNoise','setClock'],adpcm:['loadSample','loadMemory','play','stop','setPlaybackRate','setClock']}},
  {id:'pc-engine', declaration:'huc6280', globals:['pce'], primaries:{pce:'huc6280'},
    valid:"pce.noteOn(5, 'C4');\npce.setNoise(4, {enabled:true, frequency:12});\npce.setPan(0,15,15);\n",
    invalid:"pce.noteOn(6, 'C4');\npce.setNoise(3, {enabled:true});\n",
    methods:{pce:['setWaveform','setFrequency','noteOn','keyOff','setNoise','setDda','setClock']}},
];
const forbidden = ['fm','play','write','FM_PRESETS','CH1','OP1','midi','noteToBlockFnum','hzToBlockFnum','psg','dac','ssg','rhythm','adpcmA','adpcmB'];
const server = http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let file = path.resolve(docs,'.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file,'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) {response.writeHead(404).end(error.message);}
});

async function ready(page) {
  await page.waitForFunction(() => window.__nativeRegression && window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  await page.evaluate(async () => {
    const model = monaco.editor.getEditors()[0].getModel();
    const worker = await (await monaco.languages.typescript.getJavaScriptWorker())(model.uri);
    await worker.getSemanticDiagnostics(model.uri.toString());
  });
}

async function checkTypes(page,mode) {
  const result = await page.evaluate(async ({mode,forbidden}) => {
    const selected = monaco.editor.getModels().find(model => model.uri.path.endsWith(`/tetorica-playground-${mode.declaration}.d.ts`));
    const getWorker = await monaco.languages.typescript.getJavaScriptWorker();
    const probe = async (name,source,position=source.length) => {
      const model = monaco.editor.createModel(source,'javascript',monaco.Uri.parse(`file:///native-${mode.id}-${name}.js`));
      try {
        const worker = await getWorker(model.uri), uri = model.uri.toString();
        return {entries:(await worker.getCompletionsAtPosition(uri,position))?.entries.map(entry => entry.name) || [],
          diagnostics:(await worker.getSemanticDiagnostics(uri)).map(({start,code,messageText}) => ({start,code,messageText}))};
      } finally {model.dispose();}
    };
    const prepare = "livePrepare('native-types', api => {api.});";
    const completions = {globals:(await probe('globals',';\n')).entries,
      pg:(await probe('pg','pg.')).entries,
      prepare:(await probe('prepare',prepare,prepare.indexOf('api.') + 4)).entries};
    for (const name of mode.globals) completions[name] = (await probe(name,`${name}.`)).entries;
    const valid = mode.valid + mode.globals.map(name => `pg.${name};\nlivePrepare('types-${name}', api => api.${name});\n`).join('');
    const invalid = mode.invalid + forbidden.map(name => `${name};\npg.${name};\n`).join('');
    return {selected:selected?.getValue(),completions,validLength:valid.length,
      diagnostics:(await probe('diagnostics',valid + invalid)).diagnostics};
  },{mode,forbidden});
  assert(new RegExp(`type TetoricaSelectedChip\\s*=\\s*["']${mode.declaration}["']`).test(result.selected || ''),`${mode.id}: selected declaration missing`);
  assert(!result.diagnostics.some(d => d.start < result.validLength),`${mode.id}: valid native declarations rejected: ${JSON.stringify(result.diagnostics)}`);
  assert(result.diagnostics.some(d => d.code === 2345),`${mode.id}: invalid hardware channel accepted`);
  let invalidOffset = result.validLength;
  for (const line of mode.invalid.trimEnd().split('\n')) {
    assert(result.diagnostics.some(d => d.code === 2345 && d.start >= invalidOffset && d.start < invalidOffset + line.length),`${mode.id}: invalid hardware constraint accepted: ${line}`);
    invalidOffset += line.length + 1;
  }
  for (const target of ['globals','pg','prepare']) {
    for (const name of mode.globals) assert(result.completions[target].includes(name),`${mode.id}: ${target}.${name} missing`);
    for (const name of forbidden) assert(!result.completions[target].includes(name),`${mode.id}: ${target}.${name} leaked`);
    for (const name of ['nes','snes','opm','adpcm','pce','gameboy']) {
      assert.equal(result.completions[target].includes(name),mode.globals.includes(name),`${mode.id}: ${target}.${name} follows selected machine`);
    }
    const generic = target === 'prepare' ? ['sample','stream','noise','fx'] : ['sample','stream','noise','mixer','fx','beat','sleep'];
    for (const name of generic) assert(result.completions[target].includes(name),`${mode.id}: generic ${target}.${name} missing`);
  }
  for (const [name,methods] of Object.entries(mode.methods)) {
    for (const method of methods) assert(result.completions[name].includes(method),`${mode.id}: ${name}.${method} missing`);
    assert(!result.completions[name].includes('dispose'),`${mode.id}: primary ${name} exposes disposal`);
  }
  console.log(JSON.stringify({mode:mode.id,types:true,channelBounds:true,selectedGlobals:true,passed:true}));
}

async function checkCatalogAndTabs(page,mode) {
  const state = await page.evaluate(async modeId => {
    const test = window.__nativeRegression;
    const {MODE_DEFAULT_CODES,MODE_EXAMPLE_FILES} = await import('./playground_examples.js');
    const examples = MODE_EXAMPLE_FILES[modeId];
    return {mode:test.selectedMode,expected:MODE_DEFAULT_CODES[modeId],editor:test.getEditorValue(),index:test.virtualFiles.get('/index.js')?.data,
      examples:examples.map(({path,data}) => ({path,data})),actual:test.virtualFiles.list().filter(file => file.path.startsWith('/examples/') && file.path.endsWith('.js')).map(({path,data}) => ({path,data})),
      tree:Array.from(document.querySelectorAll('#fileExplorerList button[data-file-path]'),node => node.dataset.filePath).filter(path => path.startsWith('/examples/') && path.endsWith('.js')),
      run:Array.from(document.querySelectorAll('#runFileSelect option'),node => node.value).filter(path => path.startsWith('/examples/') && path.endsWith('.js'))};
  },mode.id);
  assert.equal(state.mode.fmChannels,0,`${mode.id}: no legacy FM allocation`);
  assert.equal(typeof state.expected,'string');
  assert.equal(state.editor,state.expected,`${mode.id}: fresh editor has selected starter`);
  assert.equal(state.index,state.expected);
  assert(state.examples.length >= 2 && state.examples.length <= 3,`${mode.id}: two or three examples`);
  const sort = values => values.toSorted((a,b) => a.path.localeCompare(b.path));
  assert.deepEqual(sort(state.actual),sort(state.examples),`${mode.id}: VFS has curated examples`);
  const paths = state.examples.map(file => file.path).sort();
  assert.deepEqual(state.tree.sort(),paths); assert.deepEqual(state.run.sort(),paths);
  for (const selector of ['#operatorTabButton','#segapsgTab','#rf5c164Tab','#pwmTab','#keyboardTab']) {
    assert.equal(await page.locator(selector).isVisible(),false,`${mode.id}: legacy FM tab ${selector} hidden`);
  }
  for (const selector of ['#codeTab','#audioMonitorTab','#fxMonitorTab','#mixerTab','#consoleTab','#shellTab','#helpersTab']) {
    assert(await page.locator(selector).isVisible(),`${mode.id}: generic tool ${selector} remains available`);
  }
  return [{path:'/index.js',data:state.expected},...state.examples];
}

async function initializeAudio(page,mode) {
  await page.evaluate(() => {
    document.getElementById('workerExecution').checked = false;
    window.__nativeRegression.setEditorValue("console.log('NATIVE_AUDIO_READY');");
  });
  await page.click('#runButton');
  await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('NATIVE_AUDIO_READY'));
  if (process.argv.includes('--trace-rpc')) await page.evaluate(() => {
    window.__nativeRpc = [];
    for (const endpoint of window.__nativeRegression.megaDrive.primaryEndpoints) {
      const port = endpoint.port, send = port.postMessage.bind(port);
      port.postMessage = (data,...args) => {
        window.__nativeRpc.push({chip:endpoint.name,direction:'send',method:data.method,id:data.id,args:data.args?.map(value => ArrayBuffer.isView(value) ? `${value.constructor.name}:${value.byteLength}` : value)});
        return send(data,...args);
      };
      port.addEventListener('message',({data}) => window.__nativeRpc.push({chip:endpoint.name,direction:'reply',data}));
      endpoint.node.port.addEventListener('message',({data}) => window.__nativeRpc.push({chip:endpoint.name,direction:'node',data}));
    }
  });
  const primary = await page.evaluate(() => {
    const {megaDrive} = window.__nativeRegression, context = megaDrive.audioContext;
    const meter = context.createAnalyser(), silent = context.createGain();
    meter.fftSize = 2048; silent.gain.value = 0; meter.connect(silent); silent.connect(context.destination);
    const state = window.__nativeMeter = {meter,silent,detach:megaDrive.audio.connectOutputMonitor(meter),peak:0,acPeak:0,recentAc:[],samples:0,quietThreshold:.00001,quietSince:null};
    state.timer = setInterval(() => {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      const mean = pcm.reduce((sum,value) => sum + value,0) / pcm.length;
      const acPeak = pcm.reduce((max,value) => Math.max(max,Math.abs(value - mean)),0);
      state.peak = Math.max(state.peak,...pcm.map(Math.abs)); state.acPeak = Math.max(state.acPeak,acPeak); state.lastAcPeak = acPeak; state.samples++;
      state.recentAc.push(acPeak); if (state.recentAc.length > 10) state.recentAc.shift();
      if (acPeak < state.quietThreshold) state.quietSince ??= performance.now(); else state.quietSince = null;
    },10);
    return {fm:megaDrive.fm,capabilities:megaDrive.capabilities,
      endpoints:megaDrive.primaryEndpoints.map(endpoint => ({name:endpoint.name,globalName:endpoint.globalName,node:endpoint.node instanceof AudioWorkletNode})),
      chips:megaDrive.mixer.list().filter(chip => chip.connected).map(chip => chip.id)};
  });
  assert.equal(primary.fm,null,`${mode.id}: no hidden FM synth`);
  assert.equal(primary.capabilities.fmChannels,0);
  assert.deepEqual(primary.endpoints.map(({name,globalName}) => ({name,globalName})),Object.entries(mode.primaries).map(([globalName,name]) => ({name,globalName})));
  assert(primary.endpoints.every(endpoint => endpoint.node),`${mode.id}: primary devices are direct AudioWorklets`);
  assert.deepEqual(primary.chips,Object.values(mode.primaries),`${mode.id}: only native primary hardware connected`);
  await page.waitForFunction(() => window.__nativeMeter.samples >= 30);
  return page.evaluate(() => {
    const state = window.__nativeMeter,baseline = Math.max(...state.recentAc);
    state.quietThreshold = Math.max(.00001,baseline * 2);
    return {acPeak:baseline,threshold:state.quietThreshold};
  });
}

async function resetMeter(page) {
  await page.evaluate(() => {window.__nativeMeter.peak = 0; window.__nativeMeter.acPeak = 0; window.__nativeMeter.quietSince = null;});
}
async function audible(page,lookahead=0) {
  await page.waitForFunction(() => window.__nativeMeter.acPeak > window.__nativeMeter.quietThreshold * 5,null,{timeout:6000 + lookahead});
  return page.evaluate(() => window.__nativeMeter.acPeak);
}
async function quiet(page,lookahead=0) {
  await page.evaluate(() => {window.__nativeMeter.quietSince = null;});
  await page.waitForFunction(ms => window.__nativeMeter.quietSince !== null && performance.now() - window.__nativeMeter.quietSince >= ms,
    Math.max(250,lookahead + 150),{timeout:6000 + lookahead});
}
async function stop(page,lookahead=0) {
  // Keep the master output open so silence must come from stopping voices.
  await page.evaluate(() => window.__nativeRegression.runtime.stop());
  await quiet(page,lookahead);
}
async function runSource(page,source,execution) {
  await page.evaluate(async ({source,execution}) => Promise.race([
    window.__nativeRegression.runtime.playSource(source,{execution}),
    new Promise((_,reject) => setTimeout(() => reject(Error('Native source did not finish registering within 25 seconds')),25000)),
  ]),{source,execution});
}
async function primaryOnly(page,mode) {
  await page.waitForFunction(expected => {
    const actual = window.__nativeRegression.megaDrive.mixer.list().filter(chip => chip.connected).map(chip => chip.id);
    return JSON.stringify(actual) === JSON.stringify(expected);
  },Object.values(mode.primaries));
}

const brrSetup = `const tone = await livePrepare('native-regression-brr', () =>
  snes.loadBRR(new Uint8Array([0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf]),{baseFrequencyHz:2000,loopStartSamples:0}));
  snes.setPreset(0,{sample:tone,adsr1:0x8f,adsr2:0xe0,gain:127,volumeLeft:80,volumeRight:80});`;
const okiSetup = `await livePrepare('native-regression-oki', () => {
  const pcm = Float32Array.from({length:4096},(_,i) => .6*Math.sin(2*Math.PI*440*i/15625));
  return adpcm.loadSample({channels:[pcm],sampleRate:15625},{sampleRate:15625});
}); adpcm.setPan(true,true);`;
const sectionCases = {
  nes:{
    pulse:{setup:"nes.pulse.setVoice(0,{duty:.25,volume:10});",on:"nes.pulse.noteOn(0,'A4');"},
    triangle:{setup:'',on:"nes.triangle.noteOn('C4');"},
    noise:{setup:'nes.noise.setVoice({volume:10,period:6});',on:'nes.noise.noteOn();'},
    dmc:{setup:"await livePrepare('native-regression-dmc', () => nes.dmc.loadSample(new Uint8Array(65).fill(0x0f)));",on:'nes.dmc.play({rate:15,loop:true,level:64});'},
    fds:{setup:'nes.fds.setWave(Array.from({length:64},(_,i) => i < 32 ? 50 : 12)); nes.fds.setVolume(24);',on:"nes.fds.noteOn('C4');"},
  },
  snes:{brr:{setup:brrSetup,on:"snes.noteOn(0,'A4');"}},
  x68000:{
    opm:{setup:'opm.setAlgo(0,7); opm.setPan(0,true,true); opm.setOperator(0,3,{mul:1,tl:32,ar:31,d1r:0,d2r:0,d1l:0,rr:15});',on:"opm.setNote(0,'A4'); opm.keyOn(0,8);"},
    adpcm:{setup:okiSetup,on:'adpcm.play({repeat:true});'},
  },
  'pc-engine':{
    wave:{setup:'pce.setWaveform(0,Array.from({length:32},(_,i) => i < 16 ? 28 : 3)); pce.setVolume(0,24); pce.setPan(0,15,15);',on:"pce.noteOn(0,'A4');"},
    noise:{setup:'pce.setNoise(4,{enabled:true,frequency:16}); pce.setVolume(4,20); pce.setPan(4,15,15);',on:'pce.keyOn(4);'},
  },
};

async function checkPrimaryContract(page,mode,execution) {
  const marker = `NATIVE_CONTRACT:${mode.id}:${execution}`;
  const source = `
    ${forbidden.map(name => `if (typeof ${name} !== 'undefined' || ${JSON.stringify(name)} in pg) throw Error('Legacy global leaked: ${name}');`).join('\n')}
    ${Object.entries(mode.primaries).map(([globalName,chip]) => `
      if (${globalName} !== pg.${globalName} || ${globalName} !== await useSoundChip(${JSON.stringify(chip)})) throw Error('Primary aliases differ: ${globalName}');
      if (typeof ${globalName}.dispose !== 'undefined') throw Error('Primary disposal exposed: ${globalName}');
      await livePrepare(${JSON.stringify(`native-contract-${execution}-${globalName}`)}, api => {
        if (api.${globalName} !== ${globalName} || 'fm' in api || 'play' in api || 'midi' in api) throw Error('Preparation context differs');
        return true;
      });
      const extra_${globalName} = await createSoundChip(${JSON.stringify(chip)});
      if (extra_${globalName} === ${globalName} || extra_${globalName}.id === ${globalName}.id || typeof extra_${globalName}.dispose !== 'function') throw Error('Independent chip contract differs');
      extra_${globalName}.dispose();
    `).join('\n')}
    ${mode.id === 'nes' ? "if (!nes.fdsEnabled) throw Error('Primary NES has no FDS');" : ''}
    if (typeof sample.load !== 'function' || typeof stream.load !== 'function' || typeof noise.create !== 'function' || typeof mixer.set !== 'function' || typeof fx.gain !== 'function') throw Error('Generic audio services missing');
    console.log(${JSON.stringify(marker)});
  `;
  await runSource(page,source,execution);
  await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker),marker);
  await primaryOnly(page,mode);
}

async function checkSections(page,browserName,mode) {
  for (const execution of ['main','worker']) {
    const lookahead = await page.evaluate(execution => execution === 'worker' ? window.__nativeRegression.runtime.getTiming().workerLookaheadSeconds * 1000 : 0,execution);
    await checkPrimaryContract(page,mode,execution);
    for (const [section,body] of Object.entries(sectionCases[mode.id])) {
      const name = `native-held-${mode.id}-${section}`;
      const source = `${body.setup}\nliveLoop(${JSON.stringify(name)},async () => {${body.on} await sleep(3);});`;
      await resetMeter(page); await runSource(page,source,execution);
      const peak = await audible(page,lookahead); await primaryOnly(page,mode);
      await stop(page,lookahead);
      // Restart exactly the same source: uploaded BRR/ADPCM and chip clocks must
      // remain usable after Stop in both execution environments.
      await resetMeter(page); await runSource(page,source,execution); await audible(page,lookahead);
      await runSource(page,`stopLoop(${JSON.stringify(name)});`,execution); await quiet(page,lookahead);
      console.log(JSON.stringify({browser:browserName,mode:mode.id,execution,section,peak,primaryOnly:true,stopQuiet:true,restart:true,cancelQuiet:true,passed:true}));
    }
  }
  if (mode.id === 'snes') {
    // Keep the uploaded sample metadata as control moves Main → Worker → Main.
    // Stop intentionally clears livePrepare callbacks; uploaded RAM/IDs remain.
    // Query the actual DSP so client-side metadata alone cannot pass.
    const preparedMarker = 'SNES_PERSISTED_BRR:';
    await runSource(page,`${brrSetup}\nconsole.log(${JSON.stringify(preparedMarker)} + JSON.stringify(tone));`,'main');
    const prepared = await page.evaluate(marker => {
      const line = document.getElementById('consoleOutput').textContent.split('\n').find(line => line.includes(marker));
      return JSON.parse(line.slice(line.indexOf(marker) + marker.length));
    },preparedMarker);
    const sampleIds = [];
    for (const execution of ['main','worker','main']) {
      await resetMeter(page);
      await runSource(page,`const tone = ${JSON.stringify(prepared)}; snes.setPreset(0,{sample:tone,adsr1:0x8f,adsr2:0xe0,gain:127,volumeLeft:80,volumeRight:80}); snes.noteOn(0,'C4');`,execution);
      sampleIds.push(prepared.id); await audible(page,1000);
      const applied = await page.evaluate(() => window.__nativeRegression.megaDrive.snes.getPreset(0));
      assert.equal(applied.sample,prepared.id,`${execution}: DSP uses the cached sample ID`);
      await stop(page,1000);
    }
    assert(sampleIds.every(id => id === sampleIds[0]),'Main/Worker BRR cache must preserve sample IDs');
    console.log(JSON.stringify({browser:browserName,mode:mode.id,cachedBrrAcrossMainWorker:true,sampleIds,passed:true}));
  }
}

async function checkExamples(page,browserName,mode,files) {
  for (const execution of ['main','worker']) for (const file of files) {
    const lookahead = await page.evaluate(execution => execution === 'worker' ? window.__nativeRegression.runtime.getTiming().workerLookaheadSeconds * 1000 : 0,execution);
    await resetMeter(page);
    await page.evaluate(async ({file,execution}) => {
      const test = window.__nativeRegression; test.openVirtualFile(file.path); test.setEditorValue(file.data);
      document.getElementById('workerExecution').checked = execution === 'worker';
      await Promise.race([test.runCode({propagateError:true}),new Promise((_,reject) => setTimeout(() => reject(Error(`Native file did not finish registering: ${file.path}`)),25000))]);
    },{file,execution});
    const peak = await audible(page,lookahead);
    assert(!/\[error\]|(?:Reference|Syntax|Type)Error:/.test(await page.locator('#consoleOutput').textContent()),`${mode.id}/${execution}/${file.path}: runtime console error`);
    await primaryOnly(page,mode); await stop(page,lookahead);
    console.log(JSON.stringify({browser:browserName,mode:mode.id,execution,file:file.path,virtualFileWrapper:true,peak,stopQuiet:true,passed:true}));
  }
}

async function checkMixerFxMedia(page,browserName,mode) {
  const body = Object.values(sectionCases[mode.id])[0];
  const execution = 'main';
  await resetMeter(page);
  await runSource(page,`${body.setup}\n${body.on}`,execution); await audible(page);
  const primaryIds = Object.values(mode.primaries);
  await runSource(page,`for (const id of ${JSON.stringify(primaryIds)}) await mixer.set(id,{muted:true});`,execution);
  await quiet(page);
  // Muting hardware leaves ordinary PCM playback connected to the same master
  // output. Generate original WAV bytes, then load them through the public API.
  await resetMeter(page);
  await runSource(page,`
    const wav = new ArrayBuffer(44 + 8000 * 2), view = new DataView(wav);
    const text = (at,s) => {for (let i=0;i<s.length;i++) view.setUint8(at+i,s.charCodeAt(i));};
    text(0,'RIFF'); view.setUint32(4,wav.byteLength-8,true); text(8,'WAVE'); text(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,8000,true); view.setUint32(28,16000,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    text(36,'data'); view.setUint32(40,16000,true);
    for(let i=0;i<8000;i++) view.setInt16(44+i*2,Math.round(12000*Math.sin(2*Math.PI*330*i/8000)),true);
    const gain = await livePrepare('native-media-gain', () => fx.gain({gain:1}));
    fx.setChain([gain]);
    await sample.load('native-media-isolation',wav); await sample.play('native-media-isolation',{loop:true,gain:.5});
  `,execution);
  await audible(page);
  // Prepared effect controls survive Run, so this observes the same playing
  // PCM voice through both gain settings. Clearing a native rack deliberately
  // stops its samples and would not establish this routing contract.
  const gainSource = value => `const gain = await livePrepare('native-media-gain', () => fx.gain({gain:1})); gain.gain.set(${value});`;
  await runSource(page,gainSource(0),execution); await quiet(page);
  await resetMeter(page); await runSource(page,gainSource(1),execution); await audible(page);
  await runSource(page,`sample.stopAll(); for (const id of ${JSON.stringify(primaryIds)}) await mixer.reset(id);`,execution);
  await stop(page);
  console.log(JSON.stringify({browser:browserName,mode:mode.id,mixerMute:true,mediaIndependent:true,masterFx:true,stopQuiet:true,passed:true}));
}

async function changeMode(page,id) {
  await ready(page); await page.waitForTimeout(150);
  if (!await page.locator('#playgroundMode').isVisible()) await page.locator('#mainMenu > summary').click();
  await Promise.all([page.waitForURL(url => url.searchParams.get('mode') === id),page.locator('#playgroundMode').selectOption(id)]);
  await ready(page);
}
async function checkTransfer(page,base) {
  await page.goto(`${base}?mode=nes&no-sw=1`); await ready(page);
  for (const id of ['snes','x68000','pc-engine','nes']) {
    await changeMode(page,id);
    const state = await page.evaluate(async id => {
      const test = window.__nativeRegression;
      return {actual:test.getEditorValue(),expected:(await import('./playground_examples.js')).MODE_DEFAULT_CODES[id]};
    },id);
    assert.equal(state.actual,state.expected,`${id}: untouched starter switches with mode`);
  }
  const edited = '// Edited native project stays intact.\nnes.pulse.noteOn(0, "C4");\n';
  await page.evaluate(edited => {
    const test = window.__nativeRegression; test.setEditorValue(edited);
    test.virtualFiles.writeText('/lib/native.js','export const retained = true;\n');
    test.virtualFiles.writeBinary('/samples/retained.bin',new Uint8Array([0,255,128]));
    test.virtualFiles.mkdir('/samples/empty',{recursive:true});
  },edited);
  await changeMode(page,'pc-engine');
  const actual = await page.evaluate(() => {
    const test = window.__nativeRegression;
    return {editor:test.getEditorValue(),index:test.virtualFiles.get('/index.js')?.data,
      own:test.virtualFiles.get('/lib/native.js')?.data,binary:Array.from(test.virtualFiles.get('/samples/retained.bin')?.data || []),
      empty:test.virtualFiles.stat('/samples/empty')?.type};
  });
  assert.deepEqual(actual,{editor:edited,index:edited,own:'export const retained = true;\n',binary:[0,255,128],empty:'directory'});
  console.log(JSON.stringify({nativeModeTransfer:true,untouchedDefaults:true,editedCode:true,binaryDirectories:true,passed:true}));
}

async function checkBrowser(name,type,base) {
  const browser = await type.launch({headless:true,...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  const context = await browser.newContext({serviceWorkers:'block',viewport:{width:1320,height:960}});
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror',error => errors.push({message:error.message,stack:error.stack,url:page.url()}));
  const ids = process.argv.find(arg => arg.startsWith('--modes='))?.split('=')[1].split(',');
  const selectedModes = process.argv.includes('--project-only') ? [] : ids ? modes.filter(mode => ids.includes(mode.id)) : modes;
  assert(process.argv.includes('--project-only') || selectedModes.length,'No recognized native modes selected');
  try {
    for (const mode of selectedModes) {
      await page.goto(`${base}?mode=${mode.id}&no-sw=1`); await ready(page);
      assert.equal(await page.locator('#playgroundMode').inputValue(),mode.id);
      const files = await checkCatalogAndTabs(page,mode);
      if (!process.argv.includes('--audio-only')) await checkTypes(page,mode);
      if (!process.argv.includes('--types-only')) {
        const baseline = await initializeAudio(page,mode);
        try {
          await checkSections(page,name,mode);
          await checkExamples(page,name,mode,files);
          await checkMixerFxMedia(page,name,mode);
        } finally {
          await page.evaluate(async () => {
            const state = window.__nativeMeter;
            if (state) {clearInterval(state.timer);state.detach();state.meter.disconnect();state.silent.disconnect();delete window.__nativeMeter;}
            await window.__nativeRegression.runtime.stopWithFade();
          }).catch(() => {});
        }
        console.log(JSON.stringify({browser:name,mode:mode.id,baseline,passed:true}));
      }
    }
    if (!process.argv.includes('--types-only') && !process.argv.includes('--audio-only')) await checkTransfer(page,base);
    assert.deepEqual(errors,[],`${name}: native mode page errors`);
    console.log(JSON.stringify({browser:name,modes:selectedModes.map(mode => mode.id),passed:true}));
  } catch (error) {
    console.error(JSON.stringify({browser:name,url:page.url(),status:await page.locator('#status').textContent().catch(() => null),
      startup:await page.locator('#startupNotice').textContent().catch(() => null),
      console:await page.locator('#consoleOutput').textContent().catch(() => null),errors,
      meter:await page.evaluate(() => window.__nativeMeter && {acPeak:window.__nativeMeter.acPeak,lastAcPeak:window.__nativeMeter.lastAcPeak,threshold:window.__nativeMeter.quietThreshold}).catch(() => null)}));
    if (process.argv.includes('--trace-rpc')) console.error(JSON.stringify(await page.evaluate(() => ({rpc:window.__nativeRpc,audioState:window.__nativeRegression.megaDrive.audioContext?.state,hardware:window.__nativeRegression.megaDrive.primaryEndpoints.map(endpoint => ({name:endpoint.name,state:endpoint.client._getState?.()}))})).catch(() => null)));
    throw error;
  } finally {await context.close();await browser.close();}
}

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/playground/`;
    if (!process.argv.includes('--webkit-only')) await checkBrowser('chromium',chromium,base);
    if (process.argv.includes('--webkit') || process.argv.includes('--webkit-only')) await checkBrowser('webkit',webkit,base);
  } finally {server.close();}
})().catch(error => {console.error(error);process.exitCode = 1;});
