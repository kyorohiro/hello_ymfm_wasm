// SPDX-License-Identifier: BSD-3-Clause
// Exercise staged FIR examples on the real SCSP Worklet, never a physical output.
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
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-dsp-fir-browser.json'),
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
  const audit = window.__scspDspFirAudit = {
    contexts: [], nodes: [], meters: [], commands: [], clipboard: [],
    clipboardMode: 'success', sequence: 0, holdNextApply: false, heldApply: null,
    armReadAfterApply: false, holdReadsAfterApply: false, heldAuthoring: [], acknowledgedApply: null,
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
    if (data?.method === 'applyDspProgram' && audit.armReadAfterApply) {
      audit.armReadAfterApply = false;
      // Hold reads from this request onward, including the post-ACK refresh.
      // MessagePort listeners can checkpoint promises before later listeners.
      audit.holdReadsAfterApply = true;
      const port = this, id = data.id;
      function acknowledged({data: reply}) {
        if (reply?.id !== id) return;
        port.removeEventListener('message', acknowledged, true);
        if (!reply.error && !reply.fatal) {
          audit.acknowledgedApply = structuredClone(reply);
          audit.holdReadsAfterApply = true;
        }
      }
      // The ACK itself still reaches the application normally.
      port.addEventListener('message', acknowledged, true);
    }
    if (data?.method === 'readAuthoring' && audit.holdReadsAfterApply) {
      audit.heldAuthoring.push({port: this, id: data.id, data: structuredClone(data), rest});
      return;
    }
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
    const id = 'dsp-fir-audit-' + ++audit.sequence;
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

const graph = page => page.evaluate(() => __scspDspFirAudit.graph());
const inspect = page => page.evaluate(() => __scspDspFirAudit.inspect());
const request = (page, command) => page.evaluate(command => __scspDspFirAudit.request(command), command);
const program = page => request(page, {method: 'readDspProgram', args: []});
const mutations = page => page.evaluate(() => __scspDspFirAudit.commands.filter(command =>
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
    value = await page.evaluate(() => __scspDspFirAudit.level());
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
async function apply(page) {
  await page.locator('#scspDspProgramApply').click();
  await until(async () => !(await page.locator('#scspDspProgramApply').isDisabled()), 'Apply acknowledged');
  assert.equal((await page.locator('#scspDspProgramError').textContent()).trim(), '');
  assert.notEqual(await page.locator('#scspDspProgramStatus').getAttribute('data-error'), 'true', await status(page));
  assert.match(await status(page), /program (?:already )?applied/i);
}
async function resetAndApply(page) {
  await page.locator('#scspDspProgramReset').click();
  assert(await page.locator('#scspDspProgramApply').isDisabled(), 'Reset draft still needs Check');
  await checkValid(page); await apply(page);
}
async function copy(page, mode, expected) {
  const before = await page.evaluate(mode => {
    __scspDspFirAudit.clipboardMode = mode; return __scspDspFirAudit.clipboard.length;
  }, mode);
  await page.locator('#scspDspProgramCopy').click();
  await until(() => page.evaluate(before => __scspDspFirAudit.clipboard.length > before, before), 'Copy attempt');
  if (mode === 'failure') await until(async () => /unavailable|could not|failed|unable/i.test(await status(page)), 'Copy denial');
  else await until(async () => /copied/i.test(await status(page)), 'Copy success');
  const attempts = await page.evaluate(before => __scspDspFirAudit.clipboard.slice(before), before);
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
    await page.goto(origin + config.entry); await ready(page);
    const defaultSource = await draft(page), initialApplied = await applied(page), initialCodes = await controls(page);
    assert.equal((await graph(page)).contexts, 0);
    assert.match(initialApplied, /built.in.*delay/i);
    const firSource = await choose(page, 'fir2-lowpass');
    assert.notEqual(firSource, defaultSource);
    assert.deepEqual(Array.from(assemble(firSource)), Array.from(examples.fir.words));
    const stagedFir = await page.locator('#scspDspProgramSetupStatus').textContent();
    assert.match(stagedFir, /2048/);
    assert.match(await page.locator('#scspDspProgramExampleInfo').textContent(), /FIR|low.pass|two.tap|2.tap/i);
    assert.deepEqual(await controls(page), initialCodes, 'Loading a FIR example does not change live coefficient controls');
    assert.equal(await applied(page), initialApplied);
    await checkValid(page);
    assert.equal((await graph(page)).contexts, 0); assert.deepEqual(await mutations(page), []);
    cases.push('cold FIR selection stages readable source and coefficients; Check leaves applied sound and audio untouched');

    await copy(page, 'success', firSource);
    const exportedFir = await save(page, firSource);
    const fixtureResponse = await page.request.get(origin + '/synth-scsp/examples/fir2-lowpass.scspasm');
    assert.equal(fixtureResponse.status(), 200, 'Editable FIR fixture is shipped at its authored path');
    const shippedFixture = await fixtureResponse.text();
    assert.deepEqual(Array.from(assemble(shippedFixture)), Array.from(examples.fir.words));
    cases.push('FIR source Copy / Save and packaged editable fixture retain the complete microprogram');

    await applySetup(page);
    await waitControls(page, examples.fir.codes);
    assert.match(await applied(page), /FIR|low.pass|two.tap|2.tap/i);
    assert.equal((await graph(page)).contexts, 0); assert.deepEqual(await mutations(page), []);
    assert(await page.locator('#delayTime').isDisabled(), 'FIR does not expose an effective Delay time');
    cases.push('explicit cold Apply installs the complete FIR setup without acquiring an audio device');

    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Audio ready');
    const migrated = await waitSetup(page, examples.fir.words, examples.fir.codes);
    await waitControls(page, examples.fir.codes);
    const auditionBefore = await request(page, {method: 'readAudition', args: []});
    cases.push('cold-applied FIR program and recommended coefficients migrate together to the real Worklet');

    await effectSettings(page);
    await request(page, {type: 'chip-inspector', action: 'invoke', method: 'setMix', args: [0, {directLevel: 0}]});
    await startCode(page); await openDsp(page);
    await page.locator('#scspDspProgramCheck').focus(); await page.keyboard.down('a');
    const held = await waitState(page, state => state.codeActive && state.voiceGroups.filter(group => group.held).length >= 2,
      'held Code and keyboard voices under FIR');
    const owners = stableVoices(held), audibleFir = await level(page), installedFir = await program(page);
    assert.equal(await page.locator('#scspDspPanel input[id*="cutoff" i]').count(), 0, 'This two-tap example does not advertise a cutoff control');
    const roles = await Promise.all([0, 1, 2].map(index => page.locator('label[for="scspDspCoef' + index + '"]').textContent()));
    assert.match(roles[1], /previous|history|tap/i);
    assert.match(roles[2], /current|tap|input/i);
    const enableText = await page.locator('#effectEnabled').evaluate(node => node.closest('label').textContent);
    assert.match(enableText, /DSP|return/i);
    cases.push('FIR renders real wet PCM with held Code and keyboard; roles and routing controls describe its taps');

    await choose(page, 'delay'); await checkValid(page);
    assert.deepEqual(await program(page), installedFir); assert.deepEqual((await coefficients(page)).codes, examples.fir.codes);
    await level(page);
    cases.push('live example selection and Check preserve the current FIR program, coefficients and signal');

    await page.evaluate(() => {__scspDspFirAudit.holdNextApply = true;});
    await page.locator('#scspDspProgramApply').click();
    await until(() => page.evaluate(() => !!__scspDspFirAudit.heldApply), 'held old Delay setup Apply');
    const heldSetup = await page.evaluate(() => __scspDspFirAudit.heldApply.data);
    assert.deepEqual(heldSetup.args[1]?.coefficients, {0: 4095, 1: 1433, 2: 4095},
      'One owner request carries the complete checked program and coefficient setup');
    const newerFir = await choose(page, 'fir2-lowpass');
    await edit(page, newerFir + '\n; newer checked FIR draft\n'); await checkValid(page, true);
    const newerSource = await draft(page), newerPreview = await page.locator('#scspDspProgramPreview').textContent();
    const newerSetup = await page.locator('#scspDspProgramSetupStatus').textContent();
    await page.evaluate(() => __scspDspFirAudit.releaseHeldApply());
    await until(() => page.locator('#scspDspProgramApply').isEnabled(), 'newer FIR Check after old setup ACK');
    await waitSetup(page, examples.delay.words, examples.delay.codes); await waitControls(page, examples.delay.codes);
    assert.equal(await draft(page), newerSource); assert.equal(await page.locator('#scspDspProgramPreview').textContent(), newerPreview);
    assert.equal(await page.locator('#scspDspProgramSetupStatus').textContent(), newerSetup);
    assert.match(await page.locator('#scspDspProgramDraftStatus').textContent(), /checked.*(?:unapplied|staged)/i);
    assert.match(await applied(page), /delay/i);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    assert(await page.locator('#delayTime').isEnabled());
    const audibleDelay = await level(page);
    await applySetup(page); await waitSetup(page, examples.fir.words, examples.fir.codes);
    assert.deepEqual(stableVoices(await inspect(page)), owners); await level(page);
    cases.push('older complete-setup ACK preserves newer checked FIR text, recommended coefficients and pending Apply');

    const beforeRejected = {program: await program(page), coefficients: await coefficients(page), applied: await applied(page)};
    await choose(page, 'delay'); await checkValid(page);
    await page.evaluate(() => {__scspDspFirAudit.holdNextApply = true;});
    await page.locator('#scspDspProgramApply').click();
    await until(() => page.evaluate(() => !!__scspDspFirAudit.heldApply), 'held failing setup Apply');
    assert.deepEqual(await program(page), beforeRejected.program); assert.deepEqual(await coefficients(page), beforeRejected.coefficients);
    await page.evaluate(() => __scspDspFirAudit.rejectHeldApply());
    await until(async () => /Injected DSP Apply transport rejection/.test(await status(page)), 'setup rejection feedback');
    assert.equal(await applied(page), beforeRejected.applied);
    assert.deepEqual(await program(page), beforeRejected.program); assert.deepEqual(await coefficients(page), beforeRejected.coefficients);
    assert.deepEqual(stableVoices(await inspect(page)), owners); await level(page);
    cases.push('failed complete setup Apply retains the previous program, coefficients, applied label and held signal');

    const invalid = (await draft(page)) + '\n127: UNKNOWN=1\n';
    await edit(page, invalid); await page.locator('#scspDspProgramCheck').click();
    assert.match(await page.locator('#scspDspProgramError').textContent(), /line.*unknown/i);
    assert(await page.locator('#scspDspProgramApply').isDisabled());
    assert.deepEqual(await program(page), beforeRejected.program); assert.deepEqual(await coefficients(page), beforeRejected.coefficients);
    await page.locator('#scspDspProgramReset').click();
    assert(!/2048/.test(await page.locator('#scspDspProgramSetupStatus').textContent()), 'Reset draft drops staged recommendation');
    assert.deepEqual(await program(page), beforeRejected.program); assert.deepEqual(await coefficients(page), beforeRejected.coefficients);
    cases.push('invalid text and Reset draft never install staged example coefficients');

    await choose(page, 'fir2-lowpass'); await checkValid(page); await applySetup(page);
    await waitSetup(page, examples.fir.words, examples.fir.codes);
    const unchanged = await program(page);
    await page.evaluate(() => {
      const audit = __scspDspFirAudit;
      audit.continuity = [audit.level()]; audit.continuityTimer = setInterval(() => audit.continuity.push(audit.level()), 8);
    });
    await applySetup(page); await page.waitForTimeout(300);
    const continuity = await page.evaluate(() => {
      clearInterval(__scspDspFirAudit.continuityTimer); return __scspDspFirAudit.continuity;
    });
    assert(continuity.length >= 10 && continuity.every(item => item.acRms > 0.00005));
    assert.deepEqual(await program(page), unchanged); assert.deepEqual(stableVoices(await inspect(page)), owners);
    cases.push('same complete FIR setup is a no-op and preserves real output continuity and every voice owner');

    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').fill("const scsp = await useSoundChip('scsp');\nawait scsp.setEffect({feedback:-0.25});\n");
    await page.locator('#synthCodeApplyButton').click(); await openDsp(page);
    await waitControls(page, [4095, -1024, 2048]);
    assert.equal(Number(await page.locator('#delayFeedback').inputValue()), -0.25);
    assert.deepEqual(stableVoices(await inspect(page)), owners);
    assert.deepEqual(await request(page, {method: 'readAudition', args: []}), auditionBefore);
    await level(page);
    cases.push('existing Code Feedback remains the FIR previous-tap coefficient and leaves separate audition untouched');

    await choose(page, 'delay'); await checkValid(page); await applySetup(page);
    await waitSetup(page, examples.delay.words, examples.delay.codes); await waitControls(page, examples.delay.codes);
    assert.match(await applied(page), /delay/i); assert(await page.locator('#delayTime').isEnabled());
    assert.deepEqual(stableVoices(await inspect(page)), owners); await level(page);
    cases.push('selecting and applying the Delay example restores its program and recommended coefficients together');

    await choose(page, 'fir2-lowpass'); await checkValid(page);
    await page.evaluate(() => {
      const audit = __scspDspFirAudit;
      audit.heldAuthoring = []; audit.acknowledgedApply = null; audit.armReadAfterApply = true;
    });
    await page.locator('#scspDspProgramApply').click();
    await until(() => page.evaluate(() => !!__scspDspFirAudit.acknowledgedApply &&
      __scspDspFirAudit.heldAuthoring.length > 0), 'owner ACK before held authoring refresh');
    assert(await page.locator('#scspDspProgramApply').isDisabled(),
      'The acknowledged Apply is still waiting for its deliberately held authoring refresh');
    await waitSetup(page, examples.fir.words, examples.fir.codes);
    await page.evaluate(async () => {
      const audit = __scspDspFirAudit;
      await audit.contexts.at(-1).close();
      audit.holdReadsAfterApply = false;
    });
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Enable audio');
    await until(async () => /FIR|low.pass|two.tap|2.tap/i.test(await applied(page)) &&
      await page.locator('#scspDspProgramApply').isEnabled(), 'successful acknowledged FIR label after refresh failure');
    await waitControls(page, examples.fir.codes);
    assert.equal(Number(await page.locator('#delayFeedback').inputValue()), 0.5);
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Audio ready');
    const restarted = await waitSetup(page, examples.fir.words, examples.fir.codes);
    assert.equal(restarted.coefficients.feedback, 0.5);
    await waitControls(page, examples.fir.codes);
    assert.match(await applied(page), /FIR|low.pass|two.tap|2.tap/i);
    cases.push('ACK followed by authoring-refresh failure retains complete FIR setup and applied label across audio restart');

    await page.keyboard.up('a');
    await startCode(page); await openDsp(page);
    await page.locator('#scspDspProgramCheck').focus(); await page.keyboard.down('a');
    await waitState(page, state => state.codeActive && state.voiceGroups.filter(group => group.held).length >= 2,
      'held voices after acknowledged setup restart');
    await level(page);
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(mobileOverflow <= 1, '390px overflow ' + mobileOverflow);
    const bounds = await page.locator('#scspDspProgramExample').boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.locator('#scspDspProgramView').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-mobile.png'});
    await page.setViewportSize({width: 1360, height: 1024});
    await page.locator('#scspDspProgramView').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-desktop.png'});
    cases.push('390px example chooser, pending setup and editable source fit without document overflow');

    const activeGraph = await graph(page);
    assert.equal(activeGraph.contexts, 2); assert.deepEqual(activeGraph.contextStates, ['closed', 'running']);
    assert(activeGraph.physicalOutputMuted);
    await page.keyboard.up('a'); await page.locator('#stop').click();
    await waitState(page, state => !state.codeActive && state.voiceGroups.every(group => !group.held), 'Stop owners');
    await level(page, false);
    await page.reload(); await ready(page);
    assert.match(await applied(page), /built.in.*delay/i, 'Reload does not auto-apply the FIR source draft');
    assert.equal((await graph(page)).contexts, 0);
    assert.equal((await controls(page))[0], 4095); assert.equal((await controls(page))[2], 4095);
    assert(await page.locator('#scspDspProgramApply').isDisabled());
    assert(!/2048/.test(await page.locator('#scspDspProgramSetupStatus').textContent()), 'Reload restores text without staged coefficients');
    cases.push('reload restores source text only, retaining explicit Check / Apply and session coefficient boundaries');

    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(unexpectedExternal, []);
    return {browser: name, passed: true, cases, initialCodes, stagedFir, migrated,
      exportedFir, fixture: {bytes: Buffer.byteLength(shippedFixture), sha256: sha(shippedFixture)}, roles,
      audibleFir, audibleDelay, restarted, mobileOverflow,
      continuity: {samples: continuity.length, minimumAcRms: Math.min(...continuity.map(item => item.acRms))},
      graph: activeGraph, blockedEditor, errors, missing};
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
  const examples = {delay: createScspDspExample('delay'), fir: createScspDspExample('fir2-lowpass')};
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
      console.log('PASS ' + name + ' SCSP DSP FIR examples (physical gain zero)');
    }
  } catch (error) {failure = error; if (error.browserResult) results.push(error.browserResult);}
  finally {
    server.closeAllConnections?.(); if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.writeFile(config.out, JSON.stringify({passed: !failure, entry: config.entry,
      physicalOutputMuted: true, operatingSystemClipboardUsed: false, listeningPerformed: false,
      staticSiteOnly: true, results, assets: Object.fromEntries([...served].sort())}, null, 2) + '\n');
  }
  if (failure) throw failure;
})().catch(error => {console.error(error); process.exitCode = 1;});

