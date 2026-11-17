// SPDX-License-Identifier: BSD-3-Clause
// Check an installed npm consumer, with every physical output permanently muted.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const options = {
  root: null,
  entry: '/node_modules/tetorica-fm2612/examples/scsp-dsp/routing.html',
  engines: 'chromium,webkit', rates: '44100,48000',
  out: path.join(os.tmpdir(), 'scsp-dsp-routing-npm-browser.json'),
};
for (let i = 2; i < process.argv.length; i++) {
  const match = /^--(root|entry|engines|rates|out)(?:=(.+))?$/.exec(process.argv[i]);
  assert(match, 'Unknown argument ' + process.argv[i]);
  options[match[1]] = match[2] ?? process.argv[++i];
  assert(options[match[1]], 'Missing value for ' + match[1]);
}
assert(options.root, 'Pass --root with a real isolated npm consumer directory');
options.root = path.resolve(options.root);
options.out = path.resolve(options.out);
assert(options.entry.startsWith('/'), 'Entry must be a local URL path');
const engines = options.engines.split(','), rates = options.rates.split(',').map(Number);
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
assert(rates.length && rates.every(rate => [44100, 48000].includes(rate)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.wasm':'application/wasm', '.json':'application/json', '.css':'text/css',
  '.md':'text/plain', '.ts':'text/plain'};
const served = new Map(), serverFailures = [];
const server = http.createServer(async (request, response) => {
  try {
    let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (name.endsWith('/')) name += 'index.html';
    const filename = path.resolve(options.root, '.' + name);
    assert(filename.startsWith(options.root + path.sep), 'Request stays inside the installed consumer');
    const actual = await fs.realpath(filename);
    assert(actual.startsWith(options.root + path.sep), 'Installed assets must not escape through symlinks');
    const bytes = await fs.readFile(actual), relative = path.relative(options.root, actual).split(path.sep).join('/');
    const record = {bytes: bytes.length, sha256: hash(bytes)};
    assert(!served.has(relative) || served.get(relative).sha256 === record.sha256,
      'Installed package changed during browser verification: ' + relative);
    served.set(relative, record);
    response.writeHead(200, {'Content-Type': mime[path.extname(actual)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'}).end(bytes);
  } catch (error) {
    serverFailures.push({path: request.url, error: error.message});
    response.writeHead(404).end(error.message);
  }
});

// This runs before any installed-package module. The example cannot connect an
// audible edge to context.destination; only a gain fixed at zero reaches it.
function installSilentAudit(rate) {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect;
  const audit = window.__scspDspNpmExecutionAudit = {contexts: [], nodes: [], routes: [], sequence: 0, mediaAttempts: 0};
  window.AudioContext = class extends Context {
    constructor(settings = {}) {super({...settings, sampleRate: rate}); audit.contexts.push(this);}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, settings) {
      super(context, name, settings); audit.nodes.push({name, node: this});
    }
  };
  AudioNode.prototype.connect = function(destination, ...rest) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...rest);
    const split = this.context.createChannelSplitter(2), left = this.context.createAnalyser(), right = this.context.createAnalyser(), mute = this.context.createGain();
    left.fftSize = right.fftSize = 2048; mute.gain.value = 0;
    connect.call(this, split); connect.call(split, left, 0); connect.call(split, right, 1);
    connect.call(left, mute); connect.call(right, mute); connect.call(mute, destination);
    audit.routes.push({left, right, mute}); return destination;
  };
  HTMLMediaElement.prototype.play = function() {
    audit.mediaAttempts++;
    throw Error('Installed SCSP example must use its permanently muted Web Audio route');
  };
  audit.level = () => {
    const channel = key => {
      let peak = 0, sum = 0, squares = 0, count = 0, nonFinite = 0;
      for (const route of audit.routes) {
        const analyser = route[key]; if (analyser.context.state === 'closed') continue;
        const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
        for (const value of values) {
          if (!Number.isFinite(value)) nonFinite++;
          peak = Math.max(peak, Math.abs(value)); sum += value; squares += value * value; count++;
        }
      }
      const n = Math.max(1, count);
      return {peak, rms: Math.sqrt(squares / n), acRms: Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2)), nonFinite};
    };
    const left = channel('left'), right = channel('right');
    return {left, right, peak: Math.max(left.peak, right.peak), rms: Math.sqrt((left.rms ** 2 + right.rms ** 2) / 2), nonFinite: left.nonFinite + right.nonFinite};
  };
  // Read-only observation through the real installed audio owner. It never
  // invokes application callbacks or replaces application code.
  audit.state = () => new Promise((resolve, reject) => {
    const node = audit.nodes.findLast(item => item.name === 'tetorica-playground-scsp')?.node;
    if (!node || node.context.state === 'closed') {reject(Error('SCSP example has no active audio owner')); return;}
    const id = 'npm-dsp-audit-' + ++audit.sequence;
    const timeout = setTimeout(() => {
      node.port.removeEventListener('message', receive); reject(Error('SCSP state observation timed out'));
    }, 5000);
    function receive({data}) {
      if (data?.id !== id) return;
      clearTimeout(timeout); node.port.removeEventListener('message', receive);
      if (data.error) reject(Error(data.error)); else resolve(data.value);
    }
    node.port.addEventListener('message', receive); node.port.start();
    node.port.postMessage({id, method: 'getState', args: []});
  });
  audit.graph = () => ({contexts: audit.contexts.length, rates: audit.contexts.map(context => context.sampleRate),
    contextStates: audit.contexts.map(context => context.state), worklets: audit.nodes.map(item => item.name),
    routes: audit.routes.length, physicalOutputMuted: audit.routes.every(item => item.mute.gain.value === 0),
    mediaAttempts: audit.mediaAttempts});
}

const observe = page => page.evaluate(() => __scspDspNpmExecutionAudit.state());
const level = page => page.evaluate(() => __scspDspNpmExecutionAudit.level());
async function settle(page, predicate, label) {
  const deadline = Date.now() + 10000;
  let state;
  do {
    state = await observe(page);
    if (predicate(state)) return state;
    await page.waitForTimeout(30);
  } while (Date.now() < deadline);
  assert.fail(label + ': ' + JSON.stringify(state));
}
async function setSlider(page, id, code, coefficient) {
  const input = page.locator('#' + id); await input.waitFor({state: 'visible'});
  await input.evaluate((element, value) => {element.value = String(value); element.dispatchEvent(new Event('input', {bubbles:true}));}, code);
  const state = await settle(page, value => value.dsp?.coefficients.codes[coefficient] === code,
    'Coefficient was not acknowledged');
  await page.waitForTimeout(150); return state;
}
async function nonzero(page) {
  const handle = await page.waitForFunction(() => {
    const result = __scspDspNpmExecutionAudit.level();
    return result.left.acRms > .00005 && result.right.acRms > .00005 ? result : false;
  }, null, {timeout:10000});
  const result = await handle.jsonValue(); await handle.dispose(); assert.equal(result.nonFinite, 0); return result;
}

async function exercise(name, rate, origin) {
  const browser = await {chromium, webkit}[name].launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1160, height: 900}});
  const errors = [], missing = [], external = [], cases = [], requests = [];
  await context.addInitScript(installSilentAudit, rate);
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) {
      external.push(route.request().url()); return route.abort();
    }
    requests.push(new URL(route.request().url()).pathname);
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {if (response.status() >= 400) missing.push({url: response.url(), status: response.status()});});
  try {
    await page.goto(origin + options.entry);
    await page.locator('#start').waitFor({state: 'visible'});
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#source').textContent.includes('IRA=32'));
    await page.waitForTimeout(100);
    const cold = await page.evaluate(() => __scspDspNpmExecutionAudit.graph());
    assert.equal(cold.contexts, 0); assert.equal(cold.routes, 0); assert.equal(cold.worklets.length, 0);
    assert(!requests.some(filename => filename.endsWith('.wasm')), 'Cold example must not load a sound engine');
    cases.push('cold installed example creates no audio context, Worklet or WASM playback');

    await page.locator('#start').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'playing');
    const initialState = await settle(page, value => value.dsp?.returns?.length === 2 && value.slots[0].gate && value.slots[1].gate,
      'Two DSP paths did not start');
    await nonzero(page);
    // Let several full analyser windows replace the startup fade / empty buffer.
    await page.waitForTimeout(250);
    const initial = await level(page);
    assert(initial.left.acRms > initial.right.acRms * 1.1, 'IIR smooths the equal source on the right');
    assert.deepEqual(initialState.slots.slice(0, 2).map(slot => slot.dspInput ?? 0), [0, 1]);
    assert.deepEqual(initialState.dsp.return, initialState.dsp.returns[0]);
    assert.equal(initialState.slots[0].sample.id, initialState.slots[1].sample.id);
    assert.equal(initialState.dspRam, undefined, 'RAM-free routing must not reserve a Delay ring');
    const sampleId = initialState.slots[0].sample.id, bankId = initialState.bankId, ram = initialState.ramUsedBytes;
    cases.push('Start runs equal saw notes through MIXS0 Gain left and MIXS1 IIR right');

    await page.locator('#rightEnabled').uncheck();
    await settle(page, value => value.dsp?.returns?.[1].level === 0, 'Output 1 mute was not acknowledged');
    await page.waitForTimeout(150); const leftOnly = await level(page);
    assert(leftOnly.left.acRms > .00005 && leftOnly.right.peak < 1e-6, 'Output 1 mute affects only right');
    await page.locator('#leftEnabled').uncheck(); await page.locator('#rightEnabled').check();
    await settle(page, value => value.dsp?.returns?.[0].level === 0 && value.dsp?.returns?.[1].level === 7,
      'Independent return edits were not acknowledged');
    await page.waitForTimeout(150); const rightOnly = await level(page);
    assert(rightOnly.right.acRms > .00005 && rightOnly.left.peak < 1e-6, 'Output 0 mute affects only left');
    cases.push('Indexed return mutes isolate the actual left and right wet outputs');

    await page.locator('#leftEnabled').check();
    await settle(page, value => value.dsp?.returns?.[0].level === 7, 'Output 0 did not restore');
    await setSlider(page, 'gain', 0, 0); const zeroGain = await level(page);
    assert(zeroGain.left.peak < 1e-6 && zeroGain.right.acRms > .00005, 'Zero Gain must leave the IIR path active');
    const coefficientState = await setSlider(page, 'history', 3072, 1), changedIir = await level(page);
    assert(changedIir.right.acRms > rightOnly.right.acRms * 1.1, 'The live IIR coefficient must change right output');
    assert.equal(coefficientState.dsp.coefficients.codes[2], 1024);
    assert(coefficientState.slots[0].gate && coefficientState.slots[1].gate);
    assert(coefficientState.slots.slice(0, 2).every(slot => slot.sample.id === sampleId));
    assert.equal(coefficientState.bankId, bankId); assert.equal(coefficientState.ramUsedBytes, ram);
    await setSlider(page, 'gain', 2048, 0); const halfGain = await level(page);
    const halfGainRatio = halfGain.left.acRms / initial.left.acRms;
    assert(halfGainRatio > .43 && halfGainRatio < .57, JSON.stringify({halfGainRatio, initial, halfGain}));
    assert.match(await page.locator('#snapshot').innerText(), /"dspInput": 1/);
    assert.match(await page.locator('#source').innerText(), /IRA=33/);
    assert.equal(await page.getByRole('link', {name:'Read the browser source'}).getAttribute('href'), 'routing-browser.js');
    cases.push('Coefficient changes preserve both held PCM voices, bus selection, sample bank and RAM');

    await page.locator('#stop').click();
    await page.waitForFunction(() => !document.querySelector('#start').disabled && document.querySelector('#stop').disabled);
    await page.waitForTimeout(150);
    const stopped = await level(page), graph = await page.evaluate(() => __scspDspNpmExecutionAudit.graph());
    assert.equal(stopped.peak, 0, 'Stop must silence both outputs: ' + JSON.stringify(stopped));
    assert(graph.physicalOutputMuted && graph.routes > 0); assert.equal(graph.mediaAttempts, 0);
    assert(graph.rates.every(value => value === rate));
    cases.push('Stop is silent and every physical output route remained permanently muted');
    await page.setViewportSize({width: 390, height: 844});
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(mobileOverflow <= 1, 'Example overflows the mobile viewport: ' + mobileOverflow);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(external, []);
    return {browser: name, rate, passed: true, cases, cold, initial, leftOnly, rightOnly, zeroGain, changedIir, halfGain, halfGainRatio, stopped, graph,
      state: {bankId, sampleId, ramUsedBytes: ram, gateDuringCoefficientEdit: coefficientState.slots[0].gate}, mobileOverflow, requests, errors, missing, external};
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => 'Page unavailable');
    console.error(JSON.stringify({browser: name, rate, body: body.slice(0,6000), errors, missing, external, serverFailures}, null, 2));
    throw error;
  } finally {await context.close(); await browser.close();}
}

(async () => {
  options.root = await fs.realpath(options.root);
  const installed = path.join(options.root, 'node_modules/tetorica-fm2612');
  const metadata = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(metadata.name, 'tetorica-fm2612');
  const example = await fs.readFile(path.join(installed, 'examples/scsp-dsp/routing-browser.js'), 'utf8');
  assert(example.split('\n').length > 20, 'The shipped example must remain readable source');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const results = [];
    for (const name of engines) for (const rate of rates) results.push(await exercise(name, rate, origin));
    for (const [filename, record] of served) {
      const bytes = await fs.readFile(path.join(options.root, filename));
      assert.equal(bytes.length, record.bytes); assert.equal(hash(bytes), record.sha256, 'Installed asset changed after verification');
    }
    assert.deepEqual(serverFailures, []);
    const report = {passed: true, package: {name: metadata.name, version: metadata.version},
      root: options.root, entry: options.entry, physicalOutputMuted: true, listeningPerformed: false,
      sourceModified: false, results, assets: Object.fromEntries(served)};
    await fs.mkdir(path.dirname(options.out), {recursive: true});
    await fs.writeFile(options.out, JSON.stringify(report, null, 2) + '\n');
    console.log('Installed SCSP DSP routing browser PASS:', options.out);
  } finally {await new Promise(resolve => server.close(resolve));}
})().catch(error => {console.error(error); process.exitCode = 1;});
