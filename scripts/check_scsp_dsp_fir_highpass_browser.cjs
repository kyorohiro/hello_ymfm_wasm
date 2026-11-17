// SPDX-License-Identifier: BSD-3-Clause
// Exercise FIR coefficient variants through the actual Synth with muted physical output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-dsp-fir-highpass-browser.json'),
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
  const audit = window.__scspDspFirHighpassAudit = {
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
    if (data?.method === 'applyDspProgram' && audit.holdNextApply) {
      audit.holdNextApply = false;
      audit.heldApply = {port: this, id: data.id, data: structuredClone(data), rest};
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
    const id = 'dsp-fir-highpass-audit-' + ++audit.sequence;
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

const graph = page => page.evaluate(() => __scspDspFirHighpassAudit.graph());
const inspect = page => page.evaluate(() => __scspDspFirHighpassAudit.inspect());
const request = (page, command) => page.evaluate(command => __scspDspFirHighpassAudit.request(command), command);
const program = page => request(page, {method: 'readDspProgram', args: []});
const mutations = page => page.evaluate(() => __scspDspFirHighpassAudit.commands.filter(command =>
  !(command.type === 'chip-inspector' && command.action === 'read') &&
  !['readAuthoring', 'readPhysical', 'readAudition', 'readDspProgram', 'readDspCoefficients'].includes(command.method)));
const draft = page => page.locator('#scspDspProgramEditor').inputValue();
const status = page => page.locator('#scspDspProgramStatus').textContent();
const applied = page => page.locator('#scspDspProgramApplied').textContent();
const stableVoices = state => ({bankId: state.bankId, voiceGroups: state.voiceGroups,
  playingSampleIds: state.playingSampleIds, codeActive: state.codeActive,
  codeSession: state.codeSession, codeLanes: state.codeLanes});
async function until(test, label, limit = 200) {
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
    value = await page.evaluate(() => __scspDspFirHighpassAudit.level());
    return nonzero ? value.acRms > 0.00005 : value.peak < 1e-7;
  }, nonzero ? 'nonzero real SCSP PCM' : 'real SCSP output silence');
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
async function edit(page, source) {
  await page.locator('#scspDspProgramEditor').fill(source);
  assert(await page.locator('#scspDspProgramApply').isDisabled(), 'Editing invalidates the previous Check');
}
async function checkValid(page, pending = false) {
  await page.locator('#scspDspProgramCheck').click();
  assert.equal((await page.locator('#scspDspProgramError').textContent()).trim(), '');
  assert.equal(await page.locator('#scspDspProgramApply').isDisabled(), pending,
    pending ? 'A valid newer draft waits for the previous Apply acknowledgement' : 'Valid checked draft can be applied');
  assert.match(await page.locator('#scspDspProgramPreview').textContent(), /000:/);
}
async function copy(page, mode, expected) {
  const before = await page.evaluate(mode => {
    __scspDspFirHighpassAudit.clipboardMode = mode; return __scspDspFirHighpassAudit.clipboard.length;
  }, mode);
  await page.locator('#scspDspProgramCopy').click();
  await until(() => page.evaluate(before => __scspDspFirHighpassAudit.clipboard.length > before, before), 'Copy attempt');
  if (mode === 'failure') await until(async () => /unavailable|could not|failed|unable/i.test(await status(page)), 'Copy denial');
  else await until(async () => /copied/i.test(await status(page)), 'Copy success');
  const attempts = await page.evaluate(before => __scspDspFirHighpassAudit.clipboard.slice(before), before);
  assert.equal(attempts.find(item => item.method === 'clipboard').text, expected, 'Copy preserves exact current draft');
  if (mode !== 'success') assert.equal(attempts.find(item => item.method === 'execCommand').text, expected);
  assert.equal(await page.locator('#scspDspProgramView textarea').count(), 1, 'Temporary copy textarea is removed');
  return {mode, attempts: attempts.map(({text, ...rest}) => ({...rest, bytes: text.length})), status: await status(page)};
}
async function save(page, expected) {
  const pending = page.waitForEvent('download'); await page.locator('#scspDspProgramSave').click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /\.scspasm$/);
  const source = await fs.readFile(await download.path(), 'utf8');
  assert.equal(source, expected, 'Save preserves the exact current draft');
  return {filename: download.suggestedFilename(), bytes: Buffer.byteLength(source), sha256: sha(source)};
}
async function startCode(page) {
  if (await page.locator('#scspFilesPanel').isHidden()) await page.locator('#scspFilesToggle').click();
  await until(() => page.locator('#scspFileImportButton').isEnabled(), 'Files ready');
  for (let index = 0; index < 12; index++) {
    const closed = page.locator('#scspFilesTree details:not([open]) > summary');
    if (!await closed.count()) break;
    await closed.first().click();
  }
  await page.locator('#scspFilesTree button[data-file-path="/index.js"]').click();
  await page.locator('#synthInputCodeTab').click();
  await page.locator('#synthCodeEditor').waitFor({state: 'visible'});
  await page.locator('#synthCodeEditor').fill("const scsp = await useSoundChip('scsp');\nawait scsp.noteOn(CH1, 'E3');\n");
  await page.locator('#synthCodeRunButton').click();
  await waitState(page, state => state.codeActive && state.voiceGroups.some(group => group.held && group.owner?.kind === 'code'),
    'live Code voice');
}
async function inputValue(page, id, value) {
  await page.locator('#' + id).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('change', {bubbles: true}));
  }, value);
}

const coefficients = page => request(page, {method: 'readDspCoefficients', args: []});
const controls = page => Promise.all([0, 1, 2].map(index => page.locator('#scspDspCoef' + index).inputValue().then(Number)));
async function waitSetup(page, words, codes) {
  let setup;
  await until(async () => {
    setup = {program: await program(page), coefficients: await coefficients(page)};
    return setup.program.words.every((word, index) => word === words[index]) &&
      setup.coefficients.codes.every((code, index) => code === codes[index]);
  }, 'acknowledged program and coefficient setup');
  return setup;
}
async function waitControls(page, codes) {
  await until(async () => (await controls(page)).every((code, index) => code === codes[index]),
    'coefficient controls ' + codes.join('/'));
}
async function choose(page, id) {
  const chooser = page.locator('#scspDspProgramExample');
  await chooser.focus(); await chooser.selectOption(id);
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'scspDspProgramExample',
    'Example selection releases keyboard focus');
  assert(await page.locator('#scspDspProgramApply').isDisabled(), 'Loading an example still requires Check');
  return draft(page);
}
async function applySetup(page) {
  await page.locator('#scspDspProgramApply').click();
  await until(() => page.locator('#scspDspProgramApply').isEnabled(), 'setup Apply acknowledgement');
  assert.notEqual(await page.locator('#scspDspProgramStatus').getAttribute('data-error'), 'true', await status(page));
}
async function effectSettings(page) {
  await page.locator('#scspDelayPanel').evaluate(node => {node.open = true;});
  await inputValue(page, 'effectSend', 7); await inputValue(page, 'effectReturn', 7);
  await page.locator('#effectEnabled').check();
  return waitState(page, state => state.config.effect.enabled && state.config.effect.send === 7 &&
    state.config.effect.returnLevel === 7, 'enabled Synth DSP return');
}

async function waitLabel(page, variant) {
  const pattern = variant === 'custom' ? /FIR.*custom/i : new RegExp(variant + '.pass', 'i');
  await until(async () => pattern.test(await applied(page)), 'actual FIR ' + variant + ' label');
  return applied(page);
}
async function changeCoefficient(page, index, code, expectedCodes, variant) {
  await inputValue(page, 'scspDspCoef' + index, code);
  await waitControls(page, expectedCodes);
  await waitLabel(page, variant);
  assert(await page.locator('#delayTime').isDisabled());
  return coefficients(page);
}
async function codeFeedback(page, feedback, codes, variant) {
  await page.locator('#synthInputCodeTab').click();
  await page.locator('#synthCodeEditor').fill(
    "const scsp = await useSoundChip('scsp');\nawait scsp.setEffect({feedback:" + feedback + '});\n');
  await page.locator('#synthCodeApplyButton').click();
  await openDsp(page);
  await waitControls(page, codes);
  await waitLabel(page, variant);
  assert.equal(Number(await page.locator('#delayFeedback').inputValue()), feedback);
}

async function check(browser, name, origin, assemble, examples) {
  const page = await browser.newPage({acceptDownloads: true, serviceWorkers: 'block', viewport: {width: 1360, height: 1024}});
  const errors = [], missing = [], blockedEditor = [], unexpectedExternal = [], cases = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());});
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    if (url.href.startsWith('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/')) blockedEditor.push(url.href);
    else unexpectedExternal.push(url.href);
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(installSilentAudit);
  try {
    await page.goto(origin + config.entry);
    await ready(page);
    const initialCodes = await controls(page), initialApplied = await applied(page);
    const originalMutations = await mutations(page);
    const highpassSource = await choose(page, 'fir2-highpass');
    assert.deepEqual(Array.from(assemble(highpassSource)), Array.from(examples.hp.words));
    assert.deepEqual(Array.from(examples.hp.words), Array.from(examples.lp.words), 'LP and HP use exactly the same 512 words');
    assert.match(await page.locator('#scspDspProgramSetupStatus').textContent(), /COEF1=-2048/);
    assert.match(await page.locator('#scspDspProgramExampleInfo').textContent(), /high.pass/i);
    assert.equal(await applied(page), initialApplied);
    assert.deepEqual(await controls(page), initialCodes);
    await checkValid(page);
    assert.equal((await graph(page)).contexts, 0);
    assert.deepEqual(await mutations(page), originalMutations);
    cases.push('cold high-pass selection and Check stage coefficients while retaining the applied sound and audio state');

    await copy(page, 'success', highpassSource);
    const exportedHighpass = await save(page, highpassSource);
    assert.equal(exportedHighpass.filename, examples.hp.filename);
    const fixtureResponse = await page.request.get(origin + '/synth-scsp/examples/fir2-highpass.scspasm');
    assert.equal(fixtureResponse.status(), 200);
    const fixture = await fixtureResponse.text();
    assert.equal(fixture, examples.hp.source);
    assert.deepEqual(Array.from(assemble(fixture)), Array.from(examples.lp.words));
    cases.push('high-pass Copy, Save and editable fixture preserve the coefficient comments and shared FIR words');

    await applySetup(page);
    await waitControls(page, examples.hp.codes);
    await waitLabel(page, 'high');
    assert.equal((await graph(page)).contexts, 0);
    assert.deepEqual(await mutations(page), originalMutations);
    assert(await page.locator('#delayTime').isDisabled());
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Audio ready');
    const migrated = await waitSetup(page, examples.hp.words, examples.hp.codes);
    assert.equal(migrated.coefficients.feedback, -0.5);
    await waitLabel(page, 'high');
    cases.push('explicit cold Apply and startup migrate the high-pass program and negative previous-sample coefficient');

    await effectSettings(page);
    await request(page, {type: 'chip-inspector', action: 'invoke', method: 'setMix', args: [0, {directLevel: 0}]});
    await startCode(page);
    await openDsp(page);
    await page.locator('#scspDspProgramCheck').focus();
    await page.keyboard.down('a');
    const held = await waitState(page, state => state.codeActive && state.voiceGroups.filter(group => group.held).length >= 2,
      'held Code and keyboard voices under high-pass');
    const owners = stableVoices(held), audibleHighpass = await level(page);
    const auditionBefore = await request(page, {method: 'readAudition', args: []});
    const firProgram = await program(page);
    const roles = await Promise.all([0, 1, 2].map(index => page.locator('label[for="scspDspCoef' + index + '"]').textContent()));
    assert.match(roles[0], /history/i);
    assert.match(roles[1], /previous/i);
    assert.match(roles[2], /current/i);
    assert.match(await page.locator('#scspDspParametersHint').textContent(), /low.frequency|low frequencies|low-frequency|difference/i);
    cases.push('high-pass produces finite wet PCM and describes its shared FIR taps with Code and keyboard held');

    await choose(page, 'fir2-lowpass');
    await checkValid(page);
    await waitLabel(page, 'high');
    assert.deepEqual(await program(page), firProgram);
    assert.deepEqual((await coefficients(page)).codes, examples.hp.codes);
    await applySetup(page);
    await waitSetup(page, examples.lp.words, examples.lp.codes);
    await waitLabel(page, 'low');
    assert.equal((await program(page)).revision, firProgram.revision);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    const audibleLowpass = await level(page);
    assert.match(await page.locator('#scspDspParametersHint').textContent(), /high.frequency|high frequencies|high-frequency/i);
    cases.push('LP selection preserves HP until Apply and changes only coefficients while retaining the program revision and voices');

    await choose(page, 'fir2-highpass');
    await checkValid(page);
    await waitLabel(page, 'low');
    const beforeFlip = await program(page);
    await applySetup(page);
    await waitSetup(page, examples.hp.words, examples.hp.codes);
    await waitLabel(page, 'high');
    assert.deepEqual(await program(page), beforeFlip);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    await level(page);
    cases.push('HP Apply flips COEF1 to negative with identical MPRO words and program revision');

    await changeCoefficient(page, 1, 2048, [4095, 2048, 2048], 'low');
    await changeCoefficient(page, 1, -1024, [4095, -1024, 2048], 'custom');
    assert.match(await page.locator('#scspDspParametersHint').textContent(), /custom|coefficients|weights|taps/i);
    await changeCoefficient(page, 1, -2048, examples.hp.codes, 'high');
    await changeCoefficient(page, 0, 2048, [2048, -2048, 2048], 'custom');
    await changeCoefficient(page, 0, 4095, examples.hp.codes, 'high');
    await changeCoefficient(page, 2, 1024, [4095, -2048, 1024], 'custom');
    await changeCoefficient(page, 2, 2048, examples.hp.codes, 'high');
    assert.deepEqual(await program(page), firProgram);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    cases.push('manual live coefficient edits update LP, HP and custom applied labels without program Apply');

    await codeFeedback(page, 0.5, examples.lp.codes, 'low');
    await codeFeedback(page, -0.25, [4095, -1024, 2048], 'custom');
    await codeFeedback(page, -0.5, examples.hp.codes, 'high');
    assert.deepEqual(await program(page), firProgram);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    assert.deepEqual(await request(page, {method: 'readAudition', args: []}), auditionBefore);
    await level(page);
    cases.push('Code Feedback changes update the actual FIR variant label and leave held owners and separate audition intact');

    const beforeInvalid = {program: await program(page), coefficients: await coefficients(page), applied: await applied(page)};
    const rawRejected = await request(page, {method: 'setDspCoefficients', args: [{1: 4096}]}).then(
      () => null, error => error.message);
    assert.match(rawRejected, /COEF1/);
    assert.deepEqual(await program(page), beforeInvalid.program);
    assert.deepEqual(await coefficients(page), beforeInvalid.coefficients);
    assert.equal(await applied(page), beforeInvalid.applied);
    await choose(page, 'fir2-lowpass');
    await edit(page, (await draft(page)) + '\n127: UNKNOWN=1\n');
    await page.locator('#scspDspProgramCheck').click();
    assert.match(await page.locator('#scspDspProgramError').textContent(), /line.*unknown/i);
    assert(await page.locator('#scspDspProgramApply').isDisabled());
    assert.deepEqual(await coefficients(page), beforeInvalid.coefficients);
    await page.locator('#scspDspProgramReset').click();
    assert.equal(await applied(page), beforeInvalid.applied);
    assert.deepEqual(await coefficients(page), beforeInvalid.coefficients);
    cases.push('invalid raw coefficient and source edits preserve the acknowledged HP state and applied label');

    await choose(page, 'fir2-lowpass');
    await checkValid(page);
    await page.evaluate(() => {__scspDspFirHighpassAudit.holdNextApply = true;});
    await page.locator('#scspDspProgramApply').click();
    await until(() => page.evaluate(() => !!__scspDspFirHighpassAudit.heldApply), 'held failing LP Apply');
    await page.evaluate(() => __scspDspFirHighpassAudit.rejectHeldApply());
    await until(async () => /Injected DSP Apply transport rejection/.test(await status(page)), 'transport rejection feedback');
    assert.deepEqual(await program(page), beforeInvalid.program);
    assert.deepEqual(await coefficients(page), beforeInvalid.coefficients);
    assert.equal(await applied(page), beforeInvalid.applied);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    await level(page);
    cases.push('rejected variant Apply retains HP coefficients, applied label and held PCM');

    await page.evaluate(() => {__scspDspFirHighpassAudit.holdNextApply = true;});
    await page.locator('#scspDspProgramApply').click();
    await until(() => page.evaluate(() => !!__scspDspFirHighpassAudit.heldApply), 'held old LP Apply');
    const pendingPayload = await page.evaluate(() => __scspDspFirHighpassAudit.heldApply.data);
    assert.deepEqual(pendingPayload.args[1].coefficients, {0: 4095, 1: 2048, 2: 2048});
    const newerSource = (await choose(page, 'fir2-highpass')) + '\n; newer HP draft\n';
    await edit(page, newerSource);
    await checkValid(page, true);
    const stagedNewer = await page.locator('#scspDspProgramSetupStatus').textContent();
    await page.evaluate(() => __scspDspFirHighpassAudit.releaseHeldApply());
    await until(() => page.locator('#scspDspProgramApply').isEnabled(), 'newer HP draft after old LP ACK');
    await waitSetup(page, examples.lp.words, examples.lp.codes);
    await waitLabel(page, 'low');
    assert.equal(await draft(page), newerSource);
    assert.equal(await page.locator('#scspDspProgramSetupStatus').textContent(), stagedNewer);
    assert.match(await page.locator('#scspDspProgramDraftStatus').textContent(), /checked.*staged/i);
    await applySetup(page);
    await waitSetup(page, examples.hp.words, examples.hp.codes);
    await waitLabel(page, 'high');
    assert.equal((await program(page)).revision, firProgram.revision);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    cases.push('older LP ACK preserves a newer checked HP draft and staged negative coefficient for its next Apply');

    await choose(page, 'delay');
    await checkValid(page);
    await applySetup(page);
    await waitSetup(page, examples.delay.words, examples.delay.codes);
    assert.match(await applied(page), /delay/i);
    assert(await page.locator('#delayTime').isEnabled());
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    assert.deepEqual(await request(page, {method: 'readAudition', args: []}), auditionBefore);
    cases.push('Delay restoration selects its independent program and coefficients with the existing owner sessions');

    await choose(page, 'fir2-highpass');
    await checkValid(page);
    await applySetup(page);
    await waitSetup(page, examples.hp.words, examples.hp.codes);
    await waitLabel(page, 'high');
    await level(page);
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(mobileOverflow <= 1, '390px document overflow ' + mobileOverflow);
    const chooserBounds = await page.locator('#scspDspProgramExample').boundingBox();
    assert(chooserBounds.x >= 0 && chooserBounds.x + chooserBounds.width <= 391);
    await page.locator('#scspDspProgramView').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-mobile.png'});
    await page.setViewportSize({width: 1360, height: 1024});
    await page.locator('#scspDspProgramView').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-desktop.png'});
    const activeGraph = await graph(page);
    assert.equal(activeGraph.contexts, 1);
    assert.deepEqual(activeGraph.contextStates, ['running']);
    assert(activeGraph.physicalOutputMuted);
    cases.push('390px chooser and HP source fit while one muted SCSP engine serves all variant changes');

    await page.keyboard.up('a');
    await page.locator('#stop').click();
    await waitState(page, state => !state.codeActive && state.voiceGroups.every(group => !group.held), 'Stop owners');
    await level(page, false);
    await page.reload();
    await ready(page);
    assert.match(await applied(page), /built.in.*delay/i);
    assert.equal((await graph(page)).contexts, 0);
    assert.equal((await controls(page))[0], 4095);
    assert.equal((await controls(page))[2], 4095);
    assert(await page.locator('#scspDspProgramApply').isDisabled());
    assert(!/COEF1=-2048/.test(await page.locator('#scspDspProgramSetupStatus').textContent()));
    assert.equal(await draft(page), examples.hp.source);
    cases.push('reload restores HP source text with explicit Check and Apply while the new session starts on Delay');

    assert.deepEqual(errors, []);
    assert.deepEqual(missing, []);
    assert.deepEqual(unexpectedExternal, []);
    return {browser: name, passed: true, cases, initialCodes, migrated, exportedHighpass,
      fixture: {bytes: Buffer.byteLength(fixture), sha256: sha(fixture)}, roles,
      sharedFirRevision: firProgram.revision, audibleHighpass, audibleLowpass, rawRejected,
      mobileOverflow, graph: activeGraph, blockedEditor, errors, missing};
  } catch (error) {
    error.browserResult = {browser: name, passed: false, cases, error: error.stack ?? String(error), errors, missing,
      status: await status(page).catch(() => null), applied: await applied(page).catch(() => null),
      setupStatus: await page.locator('#scspDspProgramSetupStatus').textContent().catch(() => null),
      draftStatus: await page.locator('#scspDspProgramDraftStatus').textContent().catch(() => null),
      audioStatus: await page.locator('#status').textContent().catch(() => null)};
    await page.screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-failure.png', fullPage: true}).catch(() => {});
    throw error;
  } finally {await page.close();}
}

(async () => {
  const {assembleScspDsp} = await import(pathToFileURL(path.join(repository, 'docs/synth-scsp/dsp_assembler.js')));
  const {createScspDspExample} = await import(pathToFileURL(path.join(repository, 'docs/synth-scsp/dsp_examples.js')));
  const examples = {delay: createScspDspExample('delay'), lp: createScspDspExample('fir2-lowpass'), hp: createScspDspExample('fir2-highpass')};
  const results = [];
  let failure;
  await fs.mkdir(path.dirname(config.out), {recursive: true});
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const name of engines) {
      const browser = await ({chromium, webkit}[name]).launch({headless: true,
        ...(name === 'chromium' ? {args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']} : {})});
      try {results.push(await check(browser, name, origin, assembleScspDsp, examples));}
      finally {await browser.close();}
      console.log('PASS ' + name + ' SCSP DSP FIR high-pass (physical gain zero)');
    }
  } catch (error) {failure = error; if (error.browserResult) results.push(error.browserResult);}
  finally {
    server.closeAllConnections?.();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.writeFile(config.out, JSON.stringify({passed: !failure, entry: config.entry,
      physicalOutputMuted: true, operatingSystemClipboardUsed: false, listeningPerformed: false,
      staticSiteOnly: true, results, assets: Object.fromEntries([...served].sort())}, null, 2) + '\n');
  }
  if (failure) throw failure;
})().catch(error => {console.error(error); process.exitCode = 1;});

