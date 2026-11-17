// SPDX-License-Identifier: BSD-3-Clause
// Save acknowledged DSP setup as editable Files Code and explicitly restore it with permanently muted physical output.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {
  root: path.join(repository, 'docs'), entry: '/synth-scsp/index.html',
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-dsp-save-browser.json'),
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const match = /^--(root|entry|engines|out)(?:=(.+))?$/.exec(args[index]);
  assert(match, 'Unknown argument ' + args[index]);
  config[match[1]] = match[2] ?? args[++index];
  assert(config[match[1]], 'Missing value for ' + match[1]);
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.md': 'text/plain', '.scspasm': 'text/plain',
};
const served = new Map();
const server = http.createServer(async (request, response) => {
  try {
    let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (relative === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(config.root, '.' + relative);
    assert(file.startsWith(config.root + path.sep), 'Request stays inside the isolated static site');
    const bytes = await fs.readFile(file);
    served.set(path.relative(config.root, file).split(path.sep).join('/'), {bytes: bytes.length, sha256: sha(bytes)});
    response.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'}).end(bytes);
  } catch {response.writeHead(404).end();}
});

// Install before application modules. The real signal feeds analysers followed
// by gains fixed at zero; no signal ever connects directly to a destination.
function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect;
  const post = MessagePort.prototype.postMessage;
  const audit = window.__scspDspSaveAudit = {
    contexts: [], nodes: [], meters: [], commands: [], clipboard: [],
    clipboardMode: 'success', sequence: 0, holdNextApply: false, heldApply: null,
  };
  window.AudioContext = class extends Context {
    constructor(...args) {super(...args); audit.contexts.push(this);}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {
      super(context, name, options); audit.nodes.push({name, node: this});
    }
  };
  AudioNode.prototype.connect = function(destination, ...rest) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...rest);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 2048;
    mute.gain.value = 0;
    connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
    audit.meters.push({analyser, mute});
    return destination;
  };
  MessagePort.prototype.postMessage = function(data, ...rest) {
    if (data?.method || data?.type === 'chip-inspector') audit.commands.push(structuredClone(data));
    const method = data?.method === 'code' ? data.args?.[1] : data?.method;
    if (data?.method === 'readDspSetup' && audit.holdNextSetupSnapshot) {
      audit.holdNextSetupSnapshot = false;
      audit.heldSetup = {port:this, data:structuredClone(data), rest};
      return;
    }
    if (data?.method === 'code' && method === audit.holdNextCodeMethod) {
      audit.holdNextCodeMethod = null;
      audit.heldApply = {port: this, id: data.id, data: structuredClone(data), rest};
      return;
    }
    if (data?.method === 'code' && method === audit.blockReadsAfterCodeMethod) {
      audit.blockReadsAfterCodeMethod = null;
      audit.holdAuthoring = true;
      audit.bridgeAck = null;
      const id = data.id;
      this.addEventListener('message', function receive({data: reply}) {
        if (reply?.id !== id) return;
        this.removeEventListener('message', receive);
        audit.bridgeAck = structuredClone(reply);
      });
    }
    if (data?.method === 'readAuthoring' && audit.holdAuthoring) {
      audit.heldReads = (audit.heldReads ?? 0) + 1;
      return;
    }
    return post.call(this, data, ...rest);
  };
  audit.releaseHeldSetup = () => {
    if (!audit.heldSetup) throw Error('No pending DSP snapshot');
    const {port, data, rest} = audit.heldSetup; audit.heldSetup = null;
    post.call(port, data, ...rest);
  };
  audit.rejectHeldApply = () => {
    if (!audit.heldApply) throw Error('No pending DSP Apply transport request');
    const {port, id} = audit.heldApply; audit.heldApply = null;
    port.dispatchEvent(new MessageEvent('message', {data: {id, error: 'Injected DSP Apply transport rejection'}}));
  };
  audit.releaseHeldApply = () => {
    if (!audit.heldApply) throw Error('No pending DSP Apply transport request');
    const {port, data, rest} = audit.heldApply; audit.heldApply = null;
    post.call(port, data, ...rest);
  };
  // Both paths are test doubles, never operating-system clipboard calls.
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
    async writeText(text) {
      audit.clipboard.push({method: 'clipboard', text: String(text)});
      if (audit.clipboardMode !== 'success') throw Error('Clipboard test denial');
    },
  }});
  Object.defineProperty(document, 'execCommand', {configurable: true, value(command) {
    const active = document.activeElement;
    const text = typeof active?.value === 'string' ? active.value : String(window.getSelection());
    const result = command === 'copy' && audit.clipboardMode === 'fallback';
    audit.clipboard.push({method: 'execCommand', command, text, result}); return result;
  }});
  audit.level = () => {
    let peak = 0, sum = 0, square = 0, count = 0;
    for (const {analyser} of audit.meters) {
      // A closed context cannot output, but its analyser can retain the last block.
      if (analyser.context.state === 'closed') continue;
      const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
      for (const value of values) {
        if (!Number.isFinite(value)) throw Error('Non-finite destination PCM');
        peak = Math.max(peak, Math.abs(value)); sum += value; square += value * value; count++;
      }
    }
    const denominator = Math.max(1, count);
    return {peak, rms: Math.sqrt(square / denominator),
      acRms: Math.sqrt(Math.max(0, square / denominator - (sum / denominator) ** 2))};
  };
  audit.graph = () => ({contexts: audit.contexts.length, contextStates: audit.contexts.map(item => item.state),
    nodes: audit.nodes.map(item => item.name), destinationRoutes: audit.meters.length,
    physicalOutputMuted: audit.meters.every(item => item.mute.gain.value === 0)});
  audit.request = command => new Promise((resolve, reject) => {
    const node = audit.nodes.findLast(item => item.name === 'tetorica-scsp-synth')?.node;
    if (!node) {reject(Error('SCSP primary Synth endpoint is unavailable')); return;}
    const id = 'dsp-save-audit-' + ++audit.sequence;
    const timer = setTimeout(() => {
      node.port.removeEventListener('message', receive); reject(Error('SCSP response exceeded five seconds'));
    }, 5000);
    function receive({data}) {
      if (data?.id !== id) return;
      clearTimeout(timer); node.port.removeEventListener('message', receive);
      if (data.error) {const error = Error(data.error); error.name = data.name ?? 'Error'; reject(error);}
      else resolve(data.value);
    }
    node.port.addEventListener('message', receive); node.port.start();
    node.port.postMessage({...command, id});
  });
  audit.inspect = () => audit.request({type: 'chip-inspector', action: 'read'});
}

const graph = page => page.evaluate(() => __scspDspSaveAudit.graph());
const inspect = page => page.evaluate(() => __scspDspSaveAudit.inspect());
const request = (page, command) => page.evaluate(command => __scspDspSaveAudit.request(command), command);
const program = page => request(page, {method: 'readDspProgram', args: []});
const coefficients = page => request(page, {method: 'readDspCoefficients', args: []});
const controls = page => Promise.all([0, 1, 2].map(index =>
  page.locator('#scspDspCoef' + index).inputValue().then(Number)));
const draft = page => page.locator('#scspDspProgramEditor').inputValue();
const applied = page => page.locator('#scspDspProgramApplied').textContent();
const stableVoices = state => ({bankId: state.bankId, voiceGroups: state.voiceGroups,
  playingSampleIds: state.playingSampleIds, codeActive: state.codeActive,
  codeSession: state.codeSession, codeLanes: state.codeLanes});

async function until(test, label, limit = 250) {
  for (let attempt = 0; attempt < limit; attempt++) {
    if (await test()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Timed out waiting for ' + label);
}
async function waitState(page, predicate, label) {
  let state;
  await until(async () => {state = await inspect(page); return predicate(state);}, label);
  return state;
}
async function level(page, nonzero = true) {
  let value;
  await until(async () => {
    value = await page.evaluate(() => __scspDspSaveAudit.level());
    return nonzero ? value.acRms > 0.00005 : value.peak < 1e-7;
  }, nonzero ? 'finite nonzero upstream PCM' : 'silent stopped upstream PCM');
  return value;
}
async function openDsp(page) {
  await page.locator('#scspDspTab').click();
  await page.locator('#scspDspProgramEditor').waitFor({state: 'visible'});
}
async function ready(page) {
  await page.waitForFunction(() => document.getElementById('scspDspProgramRows')?.children.length === 6 &&
    !document.getElementById('voiceMode').disabled);
  await openDsp(page);
}
async function openFiles(page) {
  if (await page.locator('#scspFilesPanel').isHidden()) await page.locator('#scspFilesToggle').click();
  await until(() => page.locator('#scspFileImportButton').isEnabled(), 'Files ready');
  for (let index = 0; index < 16; index++) {
    const closed = page.locator('#scspFilesTree details:not([open]) > summary');
    if (!await closed.count()) break;
    await closed.first().click();
  }
}
async function selectFile(page, filename) {
  await openFiles(page);
  await page.locator('#scspFilesTree button[data-file-path="' + filename + '"]').click();
  await page.locator('#synthInputCodeTab').click();
  await page.locator('#synthCodeEditor').waitFor({state: 'visible'});
}
let codeSequence = 0;
async function runCode(page, source, apply = false) {
  const token = ++codeSequence;
  await page.locator('#synthInputCodeTab').click();
  await page.locator('#synthCodeEditor').waitFor({state: 'visible'});
  await page.locator('#synthCodeEditor').fill(`try {\n${source}\nglobalThis.__scspCodeResult = {token:${token},ok:true};\n` +
    `} catch (error) { globalThis.__scspCodeResult = {token:${token},ok:false,error:error.stack??String(error)}; throw error; }`);
  await page.locator(apply ? '#synthCodeApplyButton' : '#synthCodeRunButton').click();
  await until(() => page.evaluate(token => window.__scspCodeResult?.token === token, token), 'Code ' + (apply ? 'Apply' : 'Run'));
  const result = await page.evaluate(() => __scspCodeResult);
  assert(result.ok, result.error);
}
async function waitControls(page, codes) {
  await until(async () => (await controls(page)).every((value, index) => value === codes[index]),
    'Main coefficient controls ' + codes.join('/'));
}
async function waitSetup(page, words, codes) {
  let setup;
  await until(async () => {
    setup = {program: await program(page), coefficients: await coefficients(page)};
    return setup.program.words.every((word, index) => word === words[index]) &&
      setup.coefficients.codes.every((code, index) => code === codes[index]);
  }, 'acknowledged DSP setup');
  return setup;
}
async function inputValue(page, id, value) {
  await page.locator('#' + id).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('change', {bubbles: true}));
  }, value);
}
async function caught(page, body) {
  return page.evaluate(async body => {
    try {await new Function('client', 'return (async()=>{' + body + '})()')(__scspCodeClient); return null;}
    catch (error) {return {name: error.name, message: error.message};}
  }, body);
}

const setup = page => request(page, {method:'readDspSetup',args:[]});
const savedPaths = page => page.locator('#scspFilesTree button[data-file-path]').evaluateAll(nodes =>
  nodes.map(node => node.dataset.filePath).filter(name => name.startsWith('/dsp/') && name.endsWith('.js')).sort());
const keyboardMode = page => page.locator('#synthInputKeyboardTab').getAttribute('aria-selected');
async function readSavedCode(page, filename) {
  await selectFile(page, filename);
  return page.locator('#synthCodeEditor').inputValue();
}
async function saveSetup(page, expectedCount) {
  await openDsp(page);
  await page.locator('#scspDspSetupSave').click();
  await openFiles(page);
  await until(async () => (await savedPaths(page)).length === expectedCount &&
    await page.locator('#scspDspSetupSave').isEnabled(), 'DSP Code file saved');
  return savedPaths(page);
}
async function captureSavedCode(source) {
  const {checkScspDspDelaySource} = await import(pathToFileURL(path.join(repository,'docs/synth-scsp/dsp_program.js')));
  const calls = [], captured = {};
  const client = {
    compileDsp(text) {calls.push('compileDsp');return checkScspDspDelaySource(text).words;},
    async applyDspProgram(words, options) {
      calls.push('applyDspProgram');captured.words=Array.from(words);captured.coefficients=structuredClone(options.coefficients);
    },
    async setEffect(effect) {calls.push('setEffect');captured.effect=structuredClone(effect);},
  };
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction('useSoundChip',source)(async name => {assert.equal(name,'scsp');return client;});
  assert.deepEqual(calls,['compileDsp','applyDspProgram','setEffect']);
  return captured;
}

async function check(browser, name, origin, examples) {
  const page = await browser.newPage({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1360,height:1024}});
  const errors=[],missing=[],external=[],blockedEditor=[],cases=[];
  page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.url().startsWith(origin)&&response.status()>=400)missing.push(response.url());});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();
    if(url.href.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/'))blockedEditor.push(url.href);
    else external.push(url.href);
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(installSilentAudit);
  try {
    await page.goto(origin+config.entry);await ready(page);await openFiles(page);
    assert.equal((await graph(page)).contexts,0);
    const invalidDraft='; This draft must not be saved as applied Code.\n003: INVALID=1\n';
    await page.locator('#scspDspProgramEditor').fill(invalidDraft);
    assert.equal(await keyboardMode(page),'true');
    const coldPaths=await saveSetup(page,1),first=coldPaths[0];
    assert.equal(first,'/dsp/SCSP DSP setup.js');
    assert.equal(await keyboardMode(page),'true','Saving does not force Keyboard into Code');
    assert.equal((await graph(page)).contexts,0,'Cold Save does not create an AudioContext');
    assert.equal(await draft(page),invalidDraft);
    const coldSource=await readSavedCode(page,first),coldExport=await captureSavedCode(coldSource);
    assert.deepEqual(coldExport.words,Array.from(examples.delay.words));
    assert.deepEqual(coldExport.coefficients,{0:4095,1:1433,2:4095});
    assert.deepEqual(coldExport.effect,{enabled:false,timeMs:240,feedback:.35,send:7,returnLevel:6});
    assert(!coldSource.includes('INVALID'));
    assert.equal((await graph(page)).contexts,0,'Opening saved Code never runs it');
    cases.push('cold Save serializes the acknowledged Delay, coefficients and effect without audio, draft changes or forced Code mode');

    await page.locator('#synthInputKeyboardTab').click();
    const duplicatePaths=await saveSetup(page,2);
    assert.deepEqual(duplicatePaths,['/dsp/SCSP DSP setup (2).js',first]);
    assert.equal(await keyboardMode(page),'true');
    assert.equal(await readSavedCode(page,first),coldSource);
    assert.equal(await readSavedCode(page,'/dsp/SCSP DSP setup (2).js'),coldSource);
    assert.equal((await graph(page)).contexts,0);
    cases.push('repeated saves use unique Files paths and preserve earlier source verbatim without automatic execution');

    await page.reload();await ready(page);await openFiles(page);
    assert.deepEqual(await savedPaths(page),duplicatePaths);
    assert.equal(await readSavedCode(page,first),coldSource);
    assert.equal((await graph(page)).contexts,0);
    assert.match(await applied(page),/built.in delay/i);
    cases.push('local project restoration retains saved JavaScript but never runs or applies the stored setup');

    await selectFile(page,'/index.js');
    await page.evaluate(source=>{window.__scspIirSource=source;},examples.iir.source);
    await runCode(page,`
const scsp = await useSoundChip('scsp');
globalThis.__scspCodeClient = scsp;
await scsp.setConfig({mode:'pcm'});
await scsp.setMix(0,{directLevel:0,totalLevel:0});
await scsp.applyDspProgram(scsp.compileDsp(globalThis.__scspIirSource),{coefficients:{0:-1000,1:3400,2:696}});
await scsp.setEffect({enabled:true,timeMs:145,send:6,returnLevel:7});
await scsp.noteOn(CH1,'E3');`);
    await request(page,{method:'noteOn',args:['keyboard-save',60]});
    const patch=await request(page,{method:'exportPatch',args:[]});
    await request(page,{method:'loadAudition',args:[patch,'save-audition']});
    const auditionBefore=await request(page,{method:'readAudition',args:[]});
    await page.locator('#synthInputKeyboardTab').click();await openDsp(page);
    await inputValue(page,'scspDspCoef2',800);
    await until(async()=>((await coefficients(page)).codes[2]===800),'live GUI coefficient');
    // A staged example and invalid newer draft must not leak into the saved setup.
    await page.locator('#scspDspProgramExample').selectOption('fir2-lowpass');
    await page.locator('#scspDspProgramEditor').fill(invalidDraft);
    const staged=await page.locator('#scspDspProgramSetupStatus').textContent();
    const current=await setup(page),owners=stableVoices(await inspect(page)),audible=await level(page);
    const beforeCommands=await page.evaluate(()=>__scspDspSaveAudit.commands.length);
    const warmPaths=await saveSetup(page,3),warmPath=warmPaths.find(value=>!duplicatePaths.includes(value));
    assert.equal(warmPath,'/dsp/SCSP DSP setup (3).js');
    assert.equal(await keyboardMode(page),'true');
    assert.equal(await draft(page),invalidDraft);
    assert.equal(await page.locator('#scspDspProgramSetupStatus').textContent(),staged);
    assert.deepEqual(await setup(page),current);
    assert.deepEqual(stableVoices(await inspect(page)),owners);
    assert.deepEqual(await request(page,{method:'readAudition',args:[]}),auditionBefore);
    const commands=await page.evaluate(index=>__scspDspSaveAudit.commands.slice(index),beforeCommands);
    assert.equal(commands.filter(command=>command.method==='readDspSetup').length,2,
      'Saving reads one atomic owner snapshot, plus the explicit verification read above');
    assert(!commands.some(command=>['stopVoices','endCode','applyDspProgram','setDspCoefficients','setEffect'].includes(command.method)));
    await level(page);
    const warmSource=await readSavedCode(page,warmPath),warmExport=await captureSavedCode(warmSource);
    assert.deepEqual(warmExport.words,current.words);
    assert.deepEqual(warmExport.coefficients,Object.fromEntries(current.coefficients.codes.map((code,index)=>[index,code])));
    assert.deepEqual(warmExport.effect,current.effect);
    assert(!warmSource.includes('INVALID'));
    assert.deepEqual(stableVoices(await inspect(page)),owners);
    cases.push('warm Save uses one consistent primary snapshot while keyboard and Code continue, ignoring drafts and separate audition');

    await page.evaluate(async words=>{
      await __scspCodeClient.applyDspProgram(words,{coefficients:{0:123,1:500,2:-50}});
      await __scspCodeClient.setEffect({enabled:false,timeMs:33,send:2,returnLevel:3});
    },Array.from(examples.delay.words));
    const changed=await setup(page);assert.notDeepEqual(changed.words,current.words);
    // Merely selecting the saved file has not changed the live setup.
    assert.equal(await page.locator('#synthCodeEditor').inputValue(),warmSource);
    assert.deepEqual(await setup(page),changed);
    await page.locator('#synthCodeRunButton').click();
    await until(async()=>{
      const restored=await setup(page);
      return JSON.stringify(restored.words)===JSON.stringify(current.words)&&
        JSON.stringify(restored.coefficients.codes)===JSON.stringify(current.coefficients.codes)&&
        JSON.stringify(restored.effect)===JSON.stringify(current.effect);
    },'explicit Run restores the exact saved setup');
    const restored=await setup(page);
    assert((await inspect(page)).voiceGroups.some(group=>group.id==='keyboard-save'&&group.held));
    await level(page);
    assert.deepEqual(await request(page,{method:'readAudition',args:[]}),auditionBefore);
    cases.push('only explicit Run restores saved program, signed coefficients and complete effects using existing voices and primary DSP');

    await openFiles(page);
    if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();
    const [archive]=await Promise.all([page.waitForEvent('download'),page.locator('#scspProjectExportButton').click()]);
    const archivePath=await archive.path();
    const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')));
    const cassette=await loadPlaygroundCassette(new Uint8Array(await fs.readFile(archivePath)));
    const cassetteFile=cassette.files.get(warmPath.slice(1));
    assert(cassetteFile,'Project export contains saved DSP Code');
    assert.equal(new TextDecoder().decode(cassetteFile),warmSource);
    cases.push('saved DSP JavaScript survives the existing Cassette project export without a new preset format');

    // Hold only the outbound snapshot. Import intent may replace the workspace
    // while Save is awaiting its owner reply; the old result must not leak in.
    await openDsp(page);
    await page.evaluate(()=>{__scspDspSaveAudit.holdNextSetupSnapshot=true;});
    await page.locator('#scspDspSetupSave').click();
    await until(()=>page.evaluate(()=>!!__scspDspSaveAudit.heldSetup),'held Save snapshot');
    const {createScspCodeProject}=await import(pathToFileURL(path.join(repository,'docs/synth-scsp/code_project.js')));
    const replacement=createScspCodeProject({starterCode:'globalThis.__scspImportedExecuted = true;'});
    replacement.importFiles([{path:'/replacement.txt',type:'text',data:'new workspace'}]);
    await page.locator('#scspProjectFileInput').setInputFiles({name:'replacement.cassette.zip',
      mimeType:'application/zip',buffer:Buffer.from(replacement.exportProject())});
    await until(()=>page.locator('#scspFileImportButton').isDisabled(),'workspace replacement intent');
    await page.evaluate(()=>__scspDspSaveAudit.releaseHeldSetup());
    await until(async()=>/SCSP project imported/.test(await page.locator('#status').textContent()),'replacement project committed');
    await until(()=>page.locator('#scspDspSetupSave').isEnabled(),'retired Save completion');
    await openFiles(page);
    assert.deepEqual(await savedPaths(page),[]);
    assert.equal(await page.locator('#scspFilesTree button[data-file-path="/replacement.txt"]').count(),1);
    assert.equal(await page.evaluate(()=>window.__scspImportedExecuted),undefined);
    assert.match(await page.locator('#scspDspProgramStatus').textContent(),/save cancelled/i);
    cases.push('a pending Save snapshot cannot write into a replacement workspace, and importing JavaScript never executes it');

    await openDsp(page);await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert(mobileOverflow<=1,'390px document overflow '+mobileOverflow);
    await page.locator('#scspDspProgramView').screenshot({path:config.out.replace(/\.json$/,'')+'-'+name+'-mobile.png'});
    await page.setViewportSize({width:1360,height:1024});
    await page.locator('#scspDspProgramView').screenshot({path:config.out.replace(/\.json$/,'')+'-'+name+'-desktop.png'});
    const activeGraph=await graph(page);
    assert.equal(activeGraph.contextStates.filter(state=>state==='running').length,1);
    assert.equal(activeGraph.destinationRoutes,1);assert(activeGraph.physicalOutputMuted);
    await page.locator('#stop').click();await level(page,false);
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
    cases.push('Save action fits a narrow viewport, one permanently muted route handles the workflow and Stop silences output');
    return{browser:name,passed:true,cases,coldPath:first,warmPath,
      coldSource:{bytes:Buffer.byteLength(coldSource),sha256:sha(coldSource)},
      warmSource:{bytes:Buffer.byteLength(warmSource),sha256:sha(warmSource)},
      current,restored,audible,graph:activeGraph,mobileOverflow,blockedEditor,errors,missing};
  }catch(error){
    error.browserResult={browser:name,passed:false,cases,error:error.stack??String(error),errors,missing,external,
      audioStatus:await page.locator('#status').textContent().catch(()=>null),
      saveStatus:await page.locator('#scspDspProgramStatus').textContent().catch(()=>null),
      savedPaths:await savedPaths(page).catch(()=>null),applied:await applied(page).catch(()=>null)};
    await page.screenshot({path:config.out.replace(/\.json$/,'')+'-'+name+'-failure.png',fullPage:true}).catch(()=>{});
    throw error;
  }finally{await page.close();}
}

(async()=>{
  const {createScspDspExample}=await import(pathToFileURL(path.join(repository,'docs/synth-scsp/dsp_examples.js')));
  const examples={delay:createScspDspExample('delay'),fir:createScspDspExample('fir2-lowpass'),iir:createScspDspExample('iir1-lowpass')};
  const results=[];let failure;
  await fs.mkdir(path.dirname(config.out),{recursive:true});
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port;
    for(const name of engines){
      const browser=await({chromium,webkit}[name]).launch({headless:true,
        ...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{})});
      try{results.push(await check(browser,name,origin,examples));}finally{await browser.close();}
      console.log('PASS '+name+' SCSP DSP Save Code (physical gain zero)');
    }
  }catch(error){failure=error;if(error.browserResult)results.push(error.browserResult);}
  finally{
    server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));
    await fs.writeFile(config.out,JSON.stringify({passed:!failure,entry:config.entry,
      physicalOutputMuted:true,operatingSystemClipboardUsed:false,listeningPerformed:false,
      staticSiteOnly:true,results,assets:Object.fromEntries([...served].sort())},null,2)+'\n');
  }
  if(failure)throw failure;
})().catch(error=>{console.error(error);process.exitCode=1;});

