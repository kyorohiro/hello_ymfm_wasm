// SPDX-License-Identifier: BSD-3-Clause
// Exercise live DSP coefficient controls and real SCSP Worklet, never a physical output.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {
  root: path.join(repository, 'docs'), entry: '/synth-scsp/index.html',
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-dsp-coefficients-browser.json'),
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
  const audit = window.__scspDspCoefAudit = {
    contexts: [], nodes: [], meters: [], commands: [], clipboard: [],
    clipboardMode: 'success', sequence: 0, holdNextCoefficient: false, heldCoefficient: null,
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
    if (data?.method === 'setDspCoefficients' && audit.holdNextCoefficient) {
      audit.holdNextCoefficient = false;
      audit.heldCoefficient = {port: this, id: data.id, data: structuredClone(data), rest};
      return;
    }
    return post.call(this, data, ...rest);
  };
  audit.rejectHeldCoefficient = () => {
    if (!audit.heldCoefficient) throw Error('No pending DSP coefficient transport request');
    const {port, id} = audit.heldCoefficient; audit.heldCoefficient = null;
    port.dispatchEvent(new MessageEvent('message', {data: {id, error: 'Injected DSP coefficient transport rejection'}}));
  };
  audit.releaseHeldCoefficient = () => {
    if (!audit.heldCoefficient) throw Error('No pending DSP coefficient transport request');
    const {port, data, rest} = audit.heldCoefficient; audit.heldCoefficient = null;
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
    const id = 'dsp-coefficient-audit-' + ++audit.sequence;
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

const graph = page => page.evaluate(() => __scspDspCoefAudit.graph());
const inspect = page => page.evaluate(() => __scspDspCoefAudit.inspect());
const request = (page, command) => page.evaluate(command => __scspDspCoefAudit.request(command), command);
const coefficients = page => request(page, {method: 'readDspCoefficients', args: []});
const program = page => request(page, {method: 'readDspProgram', args: []});
const status = page => page.locator('#scspDspCoefficientsStatus').textContent();
const stableVoices = state => ({bankId: state.bankId, voiceGroups: state.voiceGroups,
  playingSampleIds: state.playingSampleIds, codeActive: state.codeActive,
  codeSession: state.codeSession, codeLanes: state.codeLanes});
const controls = page => Promise.all([0, 1, 2].map(index => page.locator('#scspDspCoef' + index).inputValue().then(Number)));
const rawWord = code => ((code & 0x1fff) << 3).toString(16).padStart(4, '0');
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
async function waitCoefficients(page, expected) {
  let result;
  await until(async () => {result = await coefficients(page); return result.codes.every((code, index) => code === expected[index]);},
    'audio-owner coefficients ' + expected.join('/'));
  return result;
}
async function waitControls(page, expected) {
  await until(async () => (await controls(page)).every((value, index) => value === expected[index]),
    'coefficient controls ' + expected.join('/'));
}
async function level(page, nonzero = true) {
  let value;
  await until(async () => {
    value = await page.evaluate(() => __scspDspCoefAudit.level());
    return nonzero ? value.acRms > 0.00005 : value.peak < 1e-7;
  }, nonzero ? 'nonzero real SCSP PCM' : 'real SCSP output silence');
  return value;
}
async function inputValue(page, id, value) {
  await page.locator('#' + id).evaluate((node, value) => {
    node.value = String(value); node.dispatchEvent(new Event('change', {bubbles: true}));
  }, value);
}
async function setCoefficient(page, index, code, expected) {
  await inputValue(page, 'scspDspCoef' + index, code);
  await waitControls(page, expected);
  await until(async () => (await page.locator('#scspDspCoef' + index + 'Register').textContent()).toLowerCase().includes(rawWord(code)),
    'acknowledged coefficient register ' + index);
}
async function metadata(page, codes) {
  for (let index = 0; index < 3; index++) {
    const multiplier = await page.locator('#scspDspCoef' + index + 'Value').textContent();
    assert(multiplier.includes(String(codes[index] / 4096)), 'Exact Q12 multiplier ' + index + ': ' + multiplier);
    const register = (await page.locator('#scspDspCoef' + index + 'Register').textContent()).toLowerCase();
    assert(register.includes('0x' + (0x700 + index * 2).toString(16)), 'Coefficient register address ' + index);
    assert(register.includes(rawWord(codes[index])), 'Coefficient register bits ' + index);
  }
}
async function openDsp(page) {
  await page.locator('#scspDspTab').click();
  await page.locator('#scspDspCoefficients').waitFor({state: 'visible'});
}
async function ready(page) {
  await page.waitForFunction(() => document.getElementById('scspDspProgramRows')?.children.length === 6 &&
    !document.getElementById('voiceMode').disabled);
  await openDsp(page);
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
async function checkAndApplyProgram(page, source) {
  await page.locator('#scspDspProgramEditor').fill(source);
  await page.locator('#scspDspProgramCheck').click();
  assert.equal((await page.locator('#scspDspProgramError').textContent()).trim(), '');
  await page.locator('#scspDspProgramApply').click();
  await until(() => page.locator('#scspDspProgramApply').isEnabled(), 'program Apply acknowledged');
  assert.notEqual(await page.locator('#scspDspProgramStatus').getAttribute('data-error'), 'true');
}

async function check(browser, name, origin) {
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
    const initial = [4095, Math.floor(0.35 * 4096), 4095];
    await waitControls(page, initial); await metadata(page, initial);
    assert.equal(Number(await page.locator('#delayFeedback').inputValue()), initial[1] / 4096);
    assert.equal((await graph(page)).contexts, 0);
    cases.push('cold signed-Q12 controls show actual coefficient addresses and 16-bit words without audio');

    await setCoefficient(page, 0, -2048, [-2048, initial[1], 4095]);
    await setCoefficient(page, 2, 2048, [-2048, initial[1], 2048]);
    await setCoefficient(page, 1, -2048, [-2048, -2048, 2048]);
    assert.equal(Number(await page.locator('#delayFeedback').inputValue()), -0.5);
    await metadata(page, [-2048, -2048, 2048]);
    assert.equal((await graph(page)).contexts, 0);
    const noCommands = await page.evaluate(() => __scspDspCoefAudit.commands);
    assert.deepEqual(noCommands, [], 'Cold edits have no Worklet / sound commands');
    cases.push('cold coefficient edits update setup and Feedback together without acquiring audio');

    await page.locator('#scspDelayPanel').evaluate(node => {node.open = true;});
    const feedback = page.locator('#delayFeedback'), frame = feedback.locator('..');
    await inputValue(page, 'delayFeedback', 0); await waitControls(page, [-2048, 0, 2048]);
    await frame.locator('button').last().click(); await waitControls(page, [-2048, 1, 2048]);
    assert.equal(Number(await feedback.inputValue()), 1 / 4096, 'One Feedback step survives exact Q12 precision');
    await inputValue(page, 'delayFeedback', 4095 / 4096); await waitControls(page, [-2048, 4095, 2048]);
    assert.equal(Number(await feedback.inputValue()), 4095 / 4096);
    assert(await frame.locator('button').last().isDisabled(), 'Maximum button cannot exceed signed hardware endpoint');
    await frame.locator('button').first().click(); await waitControls(page, [-2048, 4094, 2048]);
    assert.equal(Number(await feedback.inputValue()), 4094 / 4096);
    await inputValue(page, 'delayFeedback', -1); await waitControls(page, [-2048, -4096, 2048]);
    assert(await frame.locator('button').first().isDisabled());
    await frame.locator('button').last().click(); await waitControls(page, [-2048, -4095, 2048]);
    assert.equal(Number(await feedback.inputValue()), -4095 / 4096);
    await inputValue(page, 'delayFeedback', 0); await waitControls(page, [-2048, 0, 2048]);
    const box = await feedback.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, {steps: 2});
    await page.mouse.up(); await waitControls(page, [-2048, 2, 2048]);
    assert.equal(Number(await feedback.inputValue()), 2 / 4096, 'Horizontal drag keeps binary-fraction precision');
    cases.push('Feedback plus/minus/drag preserve exact 1/4096 steps and both signed endpoints');

    await setCoefficient(page, 0, 3072, [3072, 2, 2048]);
    await setCoefficient(page, 1, 0, [3072, 0, 2048]);
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Audio ready');
    const migrated = await waitCoefficients(page, [3072, 0, 2048]);
    assert.equal(migrated.feedback, 0);
    await metadata(page, migrated.codes);
    cases.push('cold COEF0/2 and exact COEF1 transfer through real asynchronous Worklet startup');

    await setCoefficient(page, 0, 4095, [4095, 0, 2048]);
    await setCoefficient(page, 2, 4095, [4095, 0, 4095]);
    await inputValue(page, 'delayTime', 100); await inputValue(page, 'effectSend', 7); await inputValue(page, 'effectReturn', 7);
    await page.locator('#effectEnabled').check();
    await waitState(page, state => state.config.effect.enabled && state.config.effect.timeMs === 100 &&
      state.config.effect.feedback === 0 && state.config.effect.returnLevel === 7, 'wet-only Delay configuration');
    await request(page, {type: 'chip-inspector', action: 'invoke', method: 'setMix', args: [0, {directLevel: 0}]});
    await startCode(page); await openDsp(page);
    await page.locator('#scspDspProgramCheck').focus(); await page.keyboard.down('a');
    const held = await waitState(page, state => state.codeActive && state.voiceGroups.filter(group => group.held).length >= 2,
      'simultaneous held keyboard and Code');
    const heldStable = stableVoices(held), beforeProgram = await program(page);
    const audibleBefore = await level(page), auditionBefore = await request(page, {method: 'readAudition', args: []});
    await page.evaluate(() => {
      const audit = __scspDspCoefAudit;
      audit.continuity = [audit.level()]; audit.continuityTimer = setInterval(() => audit.continuity.push(audit.level()), 8);
    });
    await setCoefficient(page, 0, 3072, [3072, 0, 4095]);
    await setCoefficient(page, 2, 2048, [3072, 0, 2048]);
    await page.waitForTimeout(350);
    const continuity = await page.evaluate(() => {
      clearInterval(__scspDspCoefAudit.continuityTimer); return __scspDspCoefAudit.continuity;
    });
    assert(continuity.length >= 10);
    assert(continuity.every(item => item.acRms > 0.00005), 'Live coefficient editing does not clear the DSP ring');
    assert.deepEqual(await program(page), beforeProgram, 'Coefficients do not rewrite or restart MPRO');
    assert.deepEqual(stableVoices(await inspect(page)), heldStable, 'Coefficient edits preserve every held owner');
    const audibleEdited = await level(page);
    cases.push('live coefficient edits preserve real wet continuity, MPRO revision and held keyboard / Code owners');

    await page.locator('#scspDspCoef2').focus(); await page.keyboard.press('j');
    assert.deepEqual(stableVoices(await inspect(page)), heldStable, 'Number-field keys do not create musical notes');
    await setCoefficient(page, 2, 0, [3072, 0, 0]);
    const silentInput = await level(page, false);
    assert.deepEqual(stableVoices(await inspect(page)), heldStable);
    await setCoefficient(page, 2, 4095, [3072, 0, 4095]);
    const audibleRestored = await level(page);
    cases.push('COEF2 input multiplier changes real wet signal without releasing voices and can restore it');

    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').fill("const scsp = await useSoundChip('scsp');\nawait scsp.setEffect({feedback: -0.25});\n");
    await page.locator('#synthCodeApplyButton').click();
    await waitControls(page, [3072, -1024, 4095]);
    assert.equal(Number(await feedback.inputValue()), -0.25, 'Existing Code setEffect updates Feedback');
    await openDsp(page); await metadata(page, [3072, -1024, 4095]);
    const afterCode = await waitCoefficients(page, [3072, -1024, 4095]);
    assert.equal(afterCode.feedback, -0.25);
    assert.deepEqual(stableVoices(await inspect(page)), heldStable, 'Apply of a parameter-only script keeps existing Code voice');
    await setCoefficient(page, 2, 2048, [3072, -1024, 2048]);
    assert.equal((await coefficients(page)).codes[1], -1024, 'Partial COEF2 update retains the Code-written COEF1');
    await inputValue(page, 'delayFeedback', 0.25); await waitControls(page, [3072, 1024, 2048]);
    await waitCoefficients(page, [3072, 1024, 2048]);
    cases.push('Code Feedback and raw COEF1 stay synchronized while partial edits retain unrelated coefficients');

    await page.evaluate(() => {__scspDspCoefAudit.holdNextCoefficient = true;});
    await inputValue(page, 'scspDspCoef2', 3000);
    await until(() => page.evaluate(() => !!__scspDspCoefAudit.heldCoefficient), 'pending partial COEF2 patch');
    const heldPatch = await page.evaluate(() => __scspDspCoefAudit.heldCoefficient.data.args[0]);
    assert.deepEqual(heldPatch, {2: 3000}, 'UI transmits only the requested coefficient');
    await request(page, {method: 'code', args: [held.codeSession, 'setEffect', [{feedback: -0.125}]]});
    await waitCoefficients(page, [3072, -512, 2048]);
    await page.evaluate(() => __scspDspCoefAudit.releaseHeldCoefficient());
    await waitCoefficients(page, [3072, -512, 3000]); await waitControls(page, [3072, -512, 3000]);
    assert.deepEqual(stableVoices(await inspect(page)), heldStable);
    await inputValue(page, 'delayFeedback', 0.25); await waitControls(page, [3072, 1024, 3000]);
    await setCoefficient(page, 2, 2048, [3072, 1024, 2048]);
    cases.push('pending UI partial patch preserves a Code-written COEF1 that changes before delivery');

    const validBefore = await coefficients(page), invalidRejected = [];
    for (const patch of [{0: 4096, 2: 0}, {0: -4097}, {1: 1.5}, {wrong: 1}, [0, 0, 0], null]) {
      const error = await page.evaluate(async patch => {
        try {await __scspDspCoefAudit.request({method: 'setDspCoefficients', args: [patch]}); return null;}
        catch (error) {return error.message;}
      }, patch);
      assert(error, 'Invalid coefficient patch is rejected atomically: ' + JSON.stringify(patch));
      invalidRejected.push(error);
      assert.deepEqual(await coefficients(page), validBefore);
      assert.deepEqual(await program(page), beforeProgram);
      assert.deepEqual(stableVoices(await inspect(page)), heldStable);
    }
    cases.push('audio owner rejects malformed and mixed invalid coefficient patches before changing any entry');

    await page.evaluate(() => {__scspDspCoefAudit.holdNextCoefficient = true;});
    await inputValue(page, 'scspDspCoef0', 4000);
    await until(() => page.evaluate(() => !!__scspDspCoefAudit.heldCoefficient), 'held coefficient transport');
    assert.deepEqual(await coefficients(page), validBefore, 'Pending edit does not change the audio owner');
    await page.evaluate(() => __scspDspCoefAudit.rejectHeldCoefficient());
    await until(async () => /Injected DSP coefficient transport rejection/.test(await status(page)), 'coefficient failure feedback');
    await waitControls(page, validBefore.codes); await metadata(page, validBefore.codes);
    assert.deepEqual(await coefficients(page), validBefore); assert.deepEqual(stableVoices(await inspect(page)), heldStable);
    await level(page);
    cases.push('transport failure restores acknowledged controls and leaves program, signal and owners intact');

    const builtin = await page.locator('#scspDspProgramEditor').inputValue(), wetless = builtin.replace(/\bEWT=1\b/, 'EWT=0');
    assert.notEqual(builtin, wetless);
    await checkAndApplyProgram(page, wetless);
    assert.deepEqual(await coefficients(page), validBefore, 'Program Apply retains coefficient settings');
    await level(page, false);
    await checkAndApplyProgram(page, builtin); await level(page);
    assert.deepEqual(await coefficients(page), validBefore);
    assert.deepEqual(await request(page, {method: 'readAudition', args: []}), auditionBefore,
      'Primary coefficient / program edits do not modify the independent audition DSP');
    cases.push('program Check / Apply and separate audition remain independent of coefficient values');

    await page.keyboard.up('a'); await page.locator('#stop').click();
    await waitState(page, state => !state.codeActive && state.voiceGroups.every(group => !group.held), 'all owners stopped');
    await waitCoefficients(page, validBefore.codes);
    await page.locator('#scspChipTab').click(); await inputValue(page, 'voiceMode', 'fm2');
    await waitState(page, state => state.config.mode === 'fm2', 'mode changes');
    await waitCoefficients(page, validBefore.codes);
    const preset = await request(page, {method: 'exportPatch', args: []});
    assert.equal(preset.version, 4); assert.equal(preset.effect.feedback, 0.25);
    assert.equal(Object.hasOwn(preset, 'dspCoefficients'), false);
    preset.effect.feedback = 0.5;
    await page.locator('#open').setInputFiles({name: 'coefficient-feedback-test.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(preset))});
    await waitCoefficients(page, [3072, 2048, 2048]); await openDsp(page); await waitControls(page, [3072, 2048, 2048]);
    cases.push('Stop / mode preserve session COEF0/2 and ordinary voice preset Feedback determines COEF1');

    await page.evaluate(async () => {await __scspDspCoefAudit.contexts.at(-1).close();});
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Enable audio');
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Audio ready');
    await waitCoefficients(page, [3072, 2048, 2048]); await waitControls(page, [3072, 2048, 2048]);
    cases.push('audio failure / restart retains acknowledged session coefficients and restored voice Feedback');

    // Keep the deliberate failure scenario in the report, then show the normal
    // acknowledged state in the visual review rather than its injected error.
    await inputValue(page, 'scspDspCoef0', 3072);
    await until(() => page.locator('#scspDspCoefficientsStatus').getAttribute('data-error').then(value => value === 'false'),
      'successful coefficient feedback after injected failure');
    assert.equal(await page.locator('#status').getAttribute('data-error'), 'false',
      'Successful coefficient retry clears the earlier global failure state too');
    assert.match(await page.locator('#status').textContent(), /COEF0 updated/i);
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(mobileOverflow <= 1, '390px document overflow ' + mobileOverflow);
    const bounds = await page.locator('#scspDspCoefficients').boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Coefficient controls fit narrow viewport');
    await page.locator('#scspDspCoefficients').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-mobile.png'});
    await page.setViewportSize({width: 1360, height: 1024});
    await page.locator('#scspDspCoefficients').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-desktop.png'});
    const activeGraph = await graph(page);
    assert(activeGraph.destinationRoutes >= 2 && activeGraph.physicalOutputMuted);
    cases.push('390px coefficient controls retain readable multipliers / register words without document overflow');

    await page.reload(); await ready(page);
    await until(async () => {const value = await controls(page); return value[0] === 4095 && value[2] === 4095;},
      'new session defaults for COEF0/2');
    assert.equal((await graph(page)).contexts, 0, 'Reload does not resume audio automatically');
    cases.push('reload resets session-only COEF0/2 without auto-applying saved coefficient overrides');
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(unexpectedExternal, []);
    return {browser: name, passed: true, cases, initial, migrated, afterCode, invalidRejected, mobileOverflow,
      audibleBefore, audibleEdited, silentInput, audibleRestored,
      continuity: {samples: continuity.length, minimumAcRms: Math.min(...continuity.map(item => item.acRms))},
      graph: activeGraph, blockedEditor, errors, missing};
  } catch (error) {
    error.browserResult = {browser: name, passed: false, cases, error: error.stack ?? String(error), errors, missing,
      status: await status(page).catch(() => null), controls: await controls(page).catch(() => null),
      audioStatus: await page.locator('#status').textContent().catch(() => null)};
    await page.screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-failure.png', fullPage: true}).catch(() => {});
    throw error;
  } finally {await page.close();}
}

(async () => {
  const results = [];
  let failure;
  await fs.mkdir(path.dirname(config.out), {recursive: true});
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const name of engines) {
      const browser = await ({chromium, webkit}[name]).launch({headless: true,
        ...(name === 'chromium' ? {args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']} : {})});
      try {results.push(await check(browser, name, origin));}
      finally {await browser.close();}
      console.log('PASS ' + name + ' SCSP DSP coefficients (physical gain zero)');
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

