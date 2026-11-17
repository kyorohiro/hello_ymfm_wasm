// SPDX-License-Identifier: BSD-3-Clause
// Exercise Code compilation, DSP application and live coefficients through the actual Synth with muted physical output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-dsp-code-browser.json'),
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
  const audit = window.__scspDspCodeAudit = {
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
    const id = 'dsp-code-audit-' + ++audit.sequence;
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

const graph = page => page.evaluate(() => __scspDspCodeAudit.graph());
const inspect = page => page.evaluate(() => __scspDspCodeAudit.inspect());
const request = (page, command) => page.evaluate(command => __scspDspCodeAudit.request(command), command);
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
    value = await page.evaluate(() => __scspDspCodeAudit.level());
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

async function check(browser, name, origin, examples) {
  const page = await browser.newPage({acceptDownloads: true, serviceWorkers: 'block', viewport: {width: 1360, height: 1024}});
  const errors = [], missing = [], blockedEditor = [], external = [], cases = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    if (url.href.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/')) blockedEditor.push(url.href);
    else external.push(url.href);
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(installSilentAudit);
  try {
    await page.goto(origin + config.entry);
    await ready(page);
    assert.equal((await graph(page)).contexts, 0, 'Opening Code/DSP does not automatically enable audio');
    const previousDraft = '; A separate in-progress GUI draft. Code must not replace this.\n' + examples.delay.source;
    await page.locator('#scspDspProgramEditor').fill(previousDraft);
    await openFiles(page);
    assert.equal(await page.locator('#scspFilesTree button[data-file-path="/examples/dsp-iir-motion.js"]').count(), 1,
      'Fresh projects include the editable DSP Code example');
    const exampleResponse = await page.request.get(origin + '/synth-scsp/examples/dsp-iir-motion.js');
    assert.equal(exampleResponse.status(), 200);
    const shippedExample = await exampleResponse.text();
    assert.match(shippedExample, /compileDsp/);
    assert.match(shippedExample, /applyDspProgram/);
    assert.match(shippedExample, /setDspCoefficients/);
    cases.push('fresh Files exposes the editable IIR Code example without automatically starting audio');

    await selectFile(page, '/index.js');
    await page.evaluate(source => {window.__scspIirSource = source;}, examples.iir.source);
    await runCode(page, `
const scsp = await useSoundChip('scsp');
globalThis.__scspCodeClient = scsp;
const audit = globalThis.__scspDspCodeAudit;
const commands = audit.commands.length;
const words = scsp.compileDsp(globalThis.__scspIirSource);
const second = scsp.compileDsp(globalThis.__scspIirSource);
const local = {typed:words instanceof Uint16Array,length:words.length,words:Array.from(words),
  commandsBefore:commands,commandsAfter:audit.commands.length,independent:words !== second};
words[0] ^= 1;
local.secondUnchanged = second[0] !== words[0];
globalThis.__scspCompile = local;
await scsp.setConfig({mode:'pcm'});
await scsp.setMix(0,{directLevel:0});
await scsp.setEffect({enabled:true,send:7,returnLevel:7});
globalThis.__scspApplied = await scsp.applyDspProgram(second,{coefficients:{0:4095,1:3840,2:256}});
globalThis.__scspRead = await scsp.getDspProgram();
globalThis.__scspReadCoefs = await scsp.getDspCoefficients();
await scsp.noteOn(CH1,'E3');`);
    const compiled = await page.evaluate(() => __scspCompile);
    assert(compiled.typed && compiled.independent && compiled.secondUnchanged);
    assert.equal(compiled.length, 512);
    assert.equal(compiled.commandsAfter, compiled.commandsBefore, 'Local synchronous compile makes no RPC');
    assert.deepEqual(compiled.words, Array.from(examples.iir.words));
    const returned = await page.evaluate(() => ({applied:__scspApplied, read:__scspRead, coefs:__scspReadCoefs}));
    assert.deepEqual(returned.applied, returned.read);
    assert.deepEqual(returned.read.coefficients, returned.coefs);
    assert.deepEqual(returned.read.words, compiled.words);
    assert.deepEqual(returned.coefs.codes, examples.iir.codes);
    assert.equal(returned.coefs.feedback, 3840 / 4096);
    assert.equal(returned.applied.custom, true);
    await openDsp(page);
    await waitControls(page, examples.iir.codes);
    await until(async () => /1.pole IIR low.pass/i.test(await applied(page)), 'Main Applied IIR label from Code ACK');
    assert.equal(await draft(page), previousDraft);
    assert(await page.locator('#scspDspCoef0').isDisabled());
    assert(await page.locator('#delayTime').isDisabled());
    const roles = await Promise.all([0, 1, 2].map(index => page.locator('label[for="scspDspCoef' + index + '"]').textContent()));
    assert.match(roles[0], /unused/i); assert.match(roles[1], /output.*feedback/i); assert.match(roles[2], /input/i);
    const owners = stableVoices(await waitState(page, state => state.codeActive &&
      state.voiceGroups.some(group => group.held && group.owner?.kind === 'code'), 'held Code note'));
    const audible = await level(page), originalProgram = await program(page);
    cases.push('real Code Run compiles locally, applies a complete IIR setup and reads it back over one primary Worklet');
    cases.push('Code ACK updates Main Applied roles and coefficients while preserving the independent GUI DSP draft');

    await runCode(page, `
const scsp = await useSoundChip('scsp');
globalThis.__scspPartial = await scsp.setDspCoefficients({1:3200,2:896});
globalThis.__scspPartialProgram = await scsp.getDspProgram();`, true);
    await openDsp(page);
    await waitControls(page, [4095, 3200, 896]);
    const partial = await page.evaluate(() => ({coefs:__scspPartial,program:__scspPartialProgram}));
    assert.equal(partial.coefs.codes[1] + partial.coefs.codes[2], 4096);
    assert.equal(partial.coefs.feedback, 3200 / 4096);
    assert.equal(partial.program.revision, originalProgram.revision);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    await inputValue(page, 'scspDspCoef2', 900);
    await waitControls(page, [4095, 3200, 900]);
    assert.deepEqual((await coefficients(page)).codes, [4095, 3200, 900]);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    assert.equal(await draft(page), previousDraft);
    await level(page);
    cases.push('Code Apply and live GUI partial coefficient edits retain held voices, unrelated coefficients and MPRO revision');

    const beforeInvalid = {program:await program(page),coefs:await coefficients(page),applied:await applied(page)};
    const invalid = [];
    for (const source of ['000: UNKNOWN=1', '000: RAW0=0x8000']) {
      invalid.push(await caught(page, 'client.compileDsp(' + JSON.stringify(source) + ');'));
    }
    invalid.push(await caught(page, 'await client.applyDspProgram(new Uint16Array(4));'));
    invalid.push(await caught(page, 'await client.applyDspProgram(client.compileDsp(globalThis.__scspIirSource),{coefficients:{1:3840}});'));
    invalid.push(await caught(page, 'await client.setDspCoefficients({1:4096});'));
    assert(invalid.every(item => item?.message), 'Invalid local/profile and owner requests reject');
    const session = (await inspect(page)).codeSession;
    const directRejected = [];
    for (const [method,args] of [['setDspCoefficients',[{1:NaN}]], ['applyDspProgram',[new Array(512).fill(0x8000)]], ['compileDsp',['000: ZERO=1']]]) {
      try {await request(page, {method:'code',args:[session,method,args]}); directRejected.push(null);}
      catch (error) {directRejected.push(error.message);}
    }
    assert(directRejected.every(Boolean), 'Worklet independently rejects invalid/unexposed operations');
    assert.deepEqual(await program(page), beforeInvalid.program);
    assert.deepEqual(await coefficients(page), beforeInvalid.coefs);
    assert.equal(await applied(page), beforeInvalid.applied);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    cases.push('invalid source, unsafe words, incomplete setups and malicious direct Worklet requests retain the full previous setup');

    await page.evaluate(words => {
      const audit = __scspDspCodeAudit;
      audit.holdNextCodeMethod = 'applyDspProgram';
      const image = new Uint16Array(words), options = {coefficients:{0:4095,1:2048,2:2048}};
      window.__scspMutation = {done:false};
      __scspCodeClient.applyDspProgram(image,options).then(value => {__scspMutation = {done:true,value};},
        error => {__scspMutation = {done:true,error:error.message};});
      image.fill(0); options.coefficients[1] = -4096;
    }, Array.from(examples.fir.words));
    await until(() => page.evaluate(() => !!__scspDspCodeAudit.heldApply), 'held Code Apply request');
    const heldPayload = await page.evaluate(() => {
      const args = __scspDspCodeAudit.heldApply.data.args[2];
      return {words:Array.from(args[0]),coefficients:args[1].coefficients};
    });
    assert.deepEqual(heldPayload.words, Array.from(examples.fir.words));
    assert.deepEqual(heldPayload.coefficients, {0:4095,1:2048,2:2048});
    assert.deepEqual(await program(page), beforeInvalid.program);
    await page.evaluate(() => __scspDspCodeAudit.releaseHeldApply());
    await until(() => page.evaluate(() => __scspMutation.done), 'snapshot Apply response');
    assert.equal(await page.evaluate(() => __scspMutation.error), undefined);
    await waitSetup(page, examples.fir.words, examples.fir.codes);
    await waitControls(page, examples.fir.codes);
    assert.equal(await draft(page), previousDraft);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    cases.push('caller mutation after Apply cannot change the snapshotted program or atomic coefficient payload');

    await page.evaluate(() => {
      __scspDspCodeAudit.holdNextCodeMethod = 'setDspCoefficients';
      const patch = {2:1234};
      window.__scspMutation = {done:false};
      __scspCodeClient.setDspCoefficients(patch).then(value => {__scspMutation = {done:true,value};},
        error => {__scspMutation = {done:true,error:error.message};});
      patch[2] = -4096;
    });
    await until(() => page.evaluate(() => !!__scspDspCodeAudit.heldApply), 'held coefficient setter');
    await page.evaluate(() => __scspDspCodeAudit.releaseHeldApply());
    await until(() => page.evaluate(() => __scspMutation.done), 'snapshot coefficient setter');
    assert.deepEqual((await coefficients(page)).codes, [4095,2048,1234]);
    await page.evaluate(async () => {window.__scspProgramOnly = await __scspCodeClient.applyDspProgram(
      __scspCodeClient.compileDsp(__scspIirSource));});
    const programOnly = await page.evaluate(() => __scspProgramOnly);
    assert.deepEqual(programOnly.coefficients.codes, [4095,2048,1234]);
    await waitControls(page, [4095,2048,1234]);
    assert.equal(await draft(page), previousDraft);
    cases.push('partial setter arguments are copied and program-only Apply preserves every existing coefficient');

    const beforeStop = {program:await program(page),coefs:await coefficients(page)};
    await page.locator('#synthCodeStopButton').click();
    await waitState(page, state => !state.codeActive && state.voiceGroups.every(group => group.owner?.kind !== 'code'), 'Code Stop ownership');
    assert.deepEqual(await program(page), beforeStop.program);
    assert.deepEqual(await coefficients(page), beforeStop.coefs);
    const stale = [await caught(page, 'client.compileDsp(globalThis.__scspIirSource);'),
      await caught(page, 'await client.getDspProgram();'), await caught(page, 'await client.setDspCoefficients({1:3000});')];
    assert(stale.every(error => error?.name === 'AbortError'));
    cases.push('Code Stop retires notes and stale clients while retaining the shared DSP program and coefficients');

    // Exercise the actual bundled example, including independent beat melody
    // and coefficient tween loops. This is not a substitute endpoint instance.
    await selectFile(page, '/examples/dsp-iir-motion.js');
    assert.equal(await page.locator('#synthCodeEditor').inputValue(), shippedExample);
    await page.locator('#synthCodeRunButton').click();
    await waitState(page, state => state.codeActive && state.voiceGroups.some(group => group.owner?.kind === 'code'), 'shipped example melody');
    const motionCodes = [];
    for (let index = 0; index < 8; index++) {
      const codes = (await coefficients(page)).codes;
      assert.equal(codes[1] + codes[2], 4096);
      assert(codes[1] >= 3072 && codes[1] <= 3968);
      motionCodes.push(codes); await page.waitForTimeout(100);
    }
    assert(new Set(motionCodes.map(codes => codes[1])).size > 1, 'Independent tween changes actual Worklet coefficients');
    await level(page);
    assert.equal((await graph(page)).contexts, 1);
    assert.equal((await graph(page)).destinationRoutes, 1);
    assert.equal((await graph(page)).nodes.filter(item => item === 'tetorica-scsp-synth').length, 1);
    assert((await graph(page)).physicalOutputMuted);
    cases.push('the shipped Code example plays beat-based notes and independently tweens complementary IIR coefficients on one engine');

    // Arm before posting the mutation: every authoring read after the Code
    // request is held, so only the ACK bridge can update Main's restart memo.
    await runCode(page, `
const scsp = await useSoundChip('scsp');
globalThis.__scspCodeClient = scsp;
await scsp.setEffect({enabled:true,send:7,returnLevel:7});
await scsp.noteOn(CH1,'E3');`, false);
    await page.evaluate(() => {
      const audit = __scspDspCodeAudit;
      audit.blockReadsAfterCodeMethod = 'applyDspProgram';
      audit.heldReads = 0;
      window.__scspBridge = {done:false};
      __scspCodeClient.applyDspProgram(__scspCodeClient.compileDsp(__scspIirSource),
        {coefficients:{0:1234,1:3500,2:596}}).then(value => {__scspBridge = {done:true,value,
          mainCodesAtResolve:[0,1,2].map(index => Number(document.getElementById('scspDspCoef' + index).value)),
          appliedAtResolve:document.getElementById('scspDspProgramApplied').textContent};},
        error => {__scspBridge = {done:true,error:error.message};});
    });
    await until(() => page.evaluate(() => __scspBridge.done && !!__scspDspCodeAudit.bridgeAck &&
      __scspDspCodeAudit.heldReads > 0), 'Code Apply ACK before blocked observation');
    const bridgeAck = await page.evaluate(() => ({api:__scspBridge,ack:__scspDspCodeAudit.bridgeAck,
      heldReads:__scspDspCodeAudit.heldReads}));
    assert.equal(bridgeAck.api.error, undefined);
    assert.deepEqual(bridgeAck.api.value.coefficients.codes, [1234,3500,596]);
    assert.deepEqual(bridgeAck.api.mainCodesAtResolve, [1234,3500,596],
      'Main records the complete ACK before the consuming Code promise resolves');
    assert.match(bridgeAck.api.appliedAtResolve, /IIR/i);
    await page.evaluate(async () => {
      await __scspDspCodeAudit.contexts.findLast(context => context.state !== 'closed').close();
      __scspDspCodeAudit.holdAuthoring = false;
    });
    await until(async () => await page.locator('#start').isEnabled() &&
      (await page.locator('#start').textContent()).trim() !== 'Audio ready', 'restart button after closed context');
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Audio ready');
    const restarted = await waitSetup(page, examples.iir.words, [1234,3500,596]);
    await openDsp(page);
    await waitControls(page, [1234,3500,596]);
    assert.equal(await draft(page), previousDraft);
    assert.match(await applied(page), /IIR/i);
    assert.equal((await graph(page)).contexts, 2);
    assert.deepEqual((await graph(page)).contextStates, ['closed','running']);
    assert((await graph(page)).physicalOutputMuted);
    cases.push('Code Apply ACK survives blocked authoring observation and AudioContext closure with complete program/coefficient restart recovery');

    await runCode(page, `
const scsp = await useSoundChip('scsp');
globalThis.__scspCodeClient = scsp;
globalThis.__scspRestartRead = await scsp.getDspProgram();
await scsp.noteOn(CH1,'E3');`);
    assert.deepEqual((await page.evaluate(() => __scspRestartRead)).coefficients.codes, [1234,3500,596]);
    await level(page);
    const activeGraph = await graph(page);
    assert.equal(activeGraph.contextStates.filter(state => state === 'running').length, 1);
    assert.equal(activeGraph.destinationRoutes, 2, 'Only one permanently muted route per context lifetime');
    assert(activeGraph.physicalOutputMuted);
    await openDsp(page);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(mobileOverflow <= 1, '390px document overflow ' + mobileOverflow);
    await page.locator('#scspDspProgramView').screenshot({path:config.out.replace(/\.json$/, '') + '-' + name + '-mobile.png'});
    await page.setViewportSize({width:1360,height:1024});
    await page.locator('#scspDspProgramView').screenshot({path:config.out.replace(/\.json$/, '') + '-' + name + '-desktop.png'});
    await page.locator('#scspDspCoefficients').screenshot({path:config.out.replace(/\.json$/, '') + '-' + name + '-coefficients.png'});
    await page.locator('#stop').click();
    await waitState(page, state => !state.codeActive && state.voiceGroups.every(group => !group.held), 'global Stop owners');
    await level(page,false);
    cases.push('restarted Code uses the same retained setup; narrow layout fits and global Stop clears output without duplicate routes');
    assert.deepEqual(errors,[]); assert.deepEqual(missing,[]); assert.deepEqual(external,[]);
    return {browser:name,passed:true,cases,compiled:{...compiled,words:undefined},roles,audible,invalid,directRejected,
      motionCodes,bridgeAck,restarted,graph:activeGraph,mobileOverflow,blockedEditor,errors,missing};
  } catch (error) {
    error.browserResult = {browser:name,passed:false,cases,error:error.stack??String(error),errors,missing,external,
      codeResult:await page.evaluate(() => window.__scspCodeResult).catch(() => null),
      audioStatus:await page.locator('#status').textContent().catch(() => null),
      codeStatus:await page.locator('#synthCodeStatus').textContent().catch(() => null),
      applied:await applied(page).catch(() => null)};
    await page.screenshot({path:config.out.replace(/\.json$/, '') + '-' + name + '-failure.png',fullPage:true}).catch(() => {});
    throw error;
  } finally {await page.close();}
}

(async () => {
  const {createScspDspExample} = await import(pathToFileURL(path.join(repository,'docs/synth-scsp/dsp_examples.js')));
  const examples = {delay:createScspDspExample('delay'),fir:createScspDspExample('fir2-lowpass'),iir:createScspDspExample('iir1-lowpass')};
  const results = [];
  let failure;
  await fs.mkdir(path.dirname(config.out),{recursive:true});
  try {
    await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const name of engines) {
      const browser = await ({chromium,webkit}[name]).launch({headless:true,
        ...(name === 'chromium' ? {args:['--mute-audio','--autoplay-policy=no-user-gesture-required']} : {})});
      try {results.push(await check(browser,name,origin,examples));}
      finally {await browser.close();}
      console.log('PASS ' + name + ' SCSP DSP Code (physical gain zero)');
    }
  } catch (error) {failure=error;if(error.browserResult)results.push(error.browserResult);}
  finally {
    server.closeAllConnections?.();
    if(server.listening)await new Promise(resolve => server.close(resolve));
    await fs.writeFile(config.out,JSON.stringify({passed:!failure,entry:config.entry,
      physicalOutputMuted:true,operatingSystemClipboardUsed:false,listeningPerformed:false,
      staticSiteOnly:true,results,assets:Object.fromEntries([...served].sort())},null,2)+'\n');
  }
  if(failure)throw failure;
})().catch(error => {console.error(error);process.exitCode=1;});

