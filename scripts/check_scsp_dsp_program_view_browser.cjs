// SPDX-License-Identifier: BSD-3-Clause
// Exercise the DSP listing through the actual Synth UI with silent output.
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
  root: path.join(repository, 'docs'),
  entry: '/synth-scsp/index.html',
  engines: 'chromium,webkit',
  out: path.join(os.tmpdir(), 'scsp-dsp-program-view-browser.json'),
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
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.md': 'text/plain', '.scspasm': 'text/plain',
};
const served = new Map();
const server = http.createServer(async (request, response) => {
  try {
    let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (relative === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(config.root, '.' + relative);
    assert(file.startsWith(config.root + path.sep), 'Request stays inside the static site');
    const bytes = await fs.readFile(file);
    served.set(path.relative(config.root, file).split(path.sep).join('/'), {
      bytes: bytes.length, sha256: sha(bytes),
    });
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(bytes);
  } catch {response.writeHead(404).end();}
});

function installSilentAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect;
  const post = MessagePort.prototype.postMessage;
  const audit = window.__scspDspViewAudit = {
    contexts: [], nodes: [], meters: [], commands: [], clipboard: [],
    clipboardMode: 'success', sequence: 0,
  };
  window.AudioContext = class extends Context {
    constructor(...args) {super(...args); audit.contexts.push(this);}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {
      super(context, name, options);
      audit.nodes.push({name, node: this});
    }
  };
  AudioNode.prototype.connect = function(destination, ...rest) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...rest);
    const analyser = this.context.createAnalyser();
    const mute = this.context.createGain();
    analyser.fftSize = 4096;
    mute.gain.value = 0;
    connect.call(this, analyser);
    connect.call(analyser, mute);
    connect.call(mute, destination);
    audit.meters.push({analyser, mute});
    return destination;
  };
  MessagePort.prototype.postMessage = function(data, ...rest) {
    if (data?.method || data?.type === 'chip-inspector') {
      audit.commands.push(structuredClone(data));
    }
    return post.call(this, data, ...rest);
  };
  // These implementations never invoke an operating-system clipboard API.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      async writeText(text) {
        audit.clipboard.push({method: 'clipboard', text: String(text)});
        if (audit.clipboardMode !== 'success') throw new Error('Clipboard test denial');
      },
    },
  });
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value(command) {
      const active = document.activeElement;
      const text = typeof active?.value === 'string' ? active.value : String(window.getSelection());
      const result = command === 'copy' && audit.clipboardMode === 'fallback';
      audit.clipboard.push({method: 'execCommand', command, text, result});
      return result;
    },
  });
  audit.level = () => {
    let peak = 0, sum = 0, square = 0, count = 0;
    for (const {analyser} of audit.meters) {
      const values = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(values);
      for (const value of values) {
        assertFinite(value);
        peak = Math.max(peak, Math.abs(value));
        sum += value; square += value * value; count++;
      }
    }
    const denominator = Math.max(1, count);
    return {peak, rms: Math.sqrt(square / denominator),
      acRms: Math.sqrt(Math.max(0, square / denominator - (sum / denominator) ** 2))};
  };
  function assertFinite(value) {
    if (!Number.isFinite(value)) throw new Error('Non-finite destination PCM');
  }
  audit.graph = () => ({
    contexts: audit.contexts.length,
    contextStates: audit.contexts.map(context => context.state),
    nodes: audit.nodes.map(item => item.name),
    destinationRoutes: audit.meters.length,
    physicalOutputMuted: audit.meters.every(item => item.mute.gain.value === 0),
  });
  audit.inspect = () => new Promise((resolve, reject) => {
    const node = audit.nodes.findLast(item => item.name === 'tetorica-scsp-synth')?.node;
    if (!node) {reject(Error('SCSP editor endpoint is unavailable')); return;}
    const id = 'dsp-program-view-audit-' + ++audit.sequence;
    const timer = setTimeout(() => {
      node.port.removeEventListener('message', receive);
      reject(Error('SCSP inspector response exceeded five seconds'));
    }, 5000);
    function receive({data}) {
      if (data?.id !== id) return;
      clearTimeout(timer);
      node.port.removeEventListener('message', receive);
      data.error ? reject(Error(data.error)) : resolve(data.value);
    }
    node.port.addEventListener('message', receive); node.port.start();
    node.port.postMessage({type: 'chip-inspector', action: 'read', id});
  });
}

const graph = page => page.evaluate(() => __scspDspViewAudit.graph());
const inspect = page => page.evaluate(() => __scspDspViewAudit.inspect());
const mutations = page => page.evaluate(() => __scspDspViewAudit.commands.filter(command =>
  !(command.type === 'chip-inspector' && command.action === 'read') &&
  !['readAuthoring', 'readPhysical', 'readAudition'].includes(command.method)));
const status = page => page.locator('#scspDspProgramStatus').textContent();
const stableVoice = state => ({
  config: state.config, bankId: state.bankId, voiceGroups: state.voiceGroups,
  playingSampleIds: state.playingSampleIds,
});
async function audible(page) {
  await page.waitForFunction(() => __scspDspViewAudit.level().acRms > 0.00005);
  return page.evaluate(() => __scspDspViewAudit.level());
}
async function waitState(page, predicate, label) {
  let state;
  for (let attempt = 0; attempt < 200; attempt++) {
    state = await inspect(page);
    if (predicate(state)) return state;
    await page.waitForTimeout(20);
  }
  assert.fail(label + ' ' + JSON.stringify(state));
}
async function settings(page) {
  return page.evaluate(() => Object.fromEntries(
    ['voiceMode', 'algorithm', 'pitch', 'effectEnabled', 'delayTime', 'delayFeedback', 'effectSend', 'effectReturn']
      .map(id => {const node = document.getElementById(id); return [id, node.type === 'checkbox' ? node.checked : node.value];}),
  ));
}
async function copy(page, mode) {
  const before = await page.evaluate(mode => {
    __scspDspViewAudit.clipboardMode = mode;
    return __scspDspViewAudit.clipboard.length;
  }, mode);
  await page.locator('#scspDspProgramCopy').click();
  await page.waitForFunction(before => __scspDspViewAudit.clipboard.length > before, before);
  if (mode === 'success') {
    await page.waitForFunction(() => /copied/i.test(document.getElementById('scspDspProgramStatus').textContent));
  } else if (mode === 'fallback') {
    await page.waitForFunction(before => __scspDspViewAudit.clipboard.slice(before).some(item =>
      item.method === 'execCommand' && item.result), before);
    await page.waitForFunction(() => /copied/i.test(document.getElementById('scspDspProgramStatus').textContent));
  } else {
    await page.waitForFunction(() => /unavailable|could not|failed|unable/i.test(document.getElementById('scspDspProgramStatus').textContent));
  }
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'TEXTAREA',
    'Fallback cleanup returns focus from its temporary textarea');
  return {attempts: await page.evaluate(before => __scspDspViewAudit.clipboard.slice(before), before), status: await status(page)};
}
async function save(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#scspDspProgramSave').click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), 'tetorica-scsp-delay.scspasm');
  const source = await fs.readFile(await download.path(), 'utf8');
  return {source, filename: download.suggestedFilename(), sha256: sha(source)};
}

async function check(browser, name, origin, assembleScspDsp, expectedWords) {
  const page = await browser.newPage({acceptDownloads: true, serviceWorkers: 'block',
    viewport: {width: 1360, height: 1024}});
  const errors = [], missing = [], blockedEditor = [], unexpectedExternal = [];
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(origin) && response.status() >= 400) missing.push(response.url());
  });
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
    await page.waitForFunction(() => document.getElementById('scspDspProgramRows')?.children.length === 6 &&
      !document.getElementById('voiceMode').disabled);
    assert.equal((await graph(page)).contexts, 0);
    const initialSettings = await settings(page), initialStatus = await page.locator('#status').textContent();
    await page.locator('#scspDspTab').click();
    await page.locator('#scspDspProgramView').waitFor({state: 'visible'});
    assert.match(await page.locator('#scspDspProgramView').textContent(), /built.in|synth.*delay/i);
    assert.equal(await page.locator('#scspDspProgramView textarea').count(), 0);
    const rows = await page.locator('#scspDspProgramRows tr').evaluateAll(nodes => nodes.map(node => ({
      step: node.children[0].textContent.trim(),
      instruction: node.children[1].textContent.trim(),
      role: node.children[2].textContent.trim(),
    })));
    assert.deepEqual(rows.map(row => Number(row.step)), [0, 1, 2, 3, 4, 5]);
    assert(rows.every(row => row.instruction && row.role));
    assert.match(rows[1].instruction, /MRD=1/); assert.match(rows[3].instruction, /EWT=1/);
    assert.match(rows[5].instruction, /MWT=1/);

    const modern = await copy(page, 'success');
    const exportText = modern.attempts.find(item => item.method === 'clipboard').text;
    assert.deepEqual(assembleScspDsp(exportText), expectedWords);
    const fallback = await copy(page, 'fallback');
    assert.equal(fallback.attempts.find(item => item.method === 'execCommand').text, exportText);
    const denied = await copy(page, 'failure');
    assert.match(denied.status, /save/i);
    const downloaded = await save(page);
    assert.equal(downloaded.source, exportText);
    assert.deepEqual(assembleScspDsp(downloaded.source), expectedWords);
    assert.deepEqual(await settings(page), initialSettings);
    assert.equal(await page.locator('#status').textContent(), initialStatus);
    assert.equal((await graph(page)).contexts, 0);
    assert.deepEqual(await mutations(page), []);

    await page.locator('#scspDspProgramView').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-desktop.png'});
    await page.setViewportSize({width: 390, height: 844});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(mobileOverflow <= 1, 'Mobile document overflow ' + mobileOverflow);
    await page.locator('#scspDspProgramView').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-mobile.png'});
    const scrollRegion = page.locator('#scspDspProgramView [role="region"][tabindex="0"]');
    await scrollRegion.focus();
    for (let key = 0; key < 12; key++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => {
      const region = document.querySelector('#scspDspProgramView [role="region"]');
      const role = region.querySelector('thead th:last-child').getBoundingClientRect();
      const bounds = region.getBoundingClientRect();
      return region.scrollLeft > 0 && role.left < bounds.right && role.right > bounds.left;
    });
    const mobileRoles = await scrollRegion.evaluate(node => {
      const role = node.querySelector('thead th:last-child').getBoundingClientRect();
      const region = node.getBoundingClientRect();
      return {scrollLeft: node.scrollLeft, roleVisible: role.left < region.right && role.right > region.left};
    });
    assert(mobileRoles.roleVisible, 'Keyboard scrolling reveals the Role column');
    assert.deepEqual(await settings(page), initialSettings);
    assert.equal((await graph(page)).contexts, 0);
    await page.locator('#scspDspProgramView').screenshot({path: config.out.replace(/\.json$/, '') + '-' + name + '-mobile-roles.png'});
    const rightPosition = await scrollRegion.evaluate(node => node.scrollLeft);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(position => document.querySelector('#scspDspProgramView [role="region"]').scrollLeft < position,
      rightPosition);
    await page.setViewportSize({width: 1360, height: 1024});

    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('start').textContent === 'Audio ready');
    await scrollRegion.focus();
    await page.keyboard.down('a');
    const held = await waitState(page, state => state.voiceGroups.some(group => group.held), 'Held keyboard voice');
    const audibleBefore = await audible(page), commandBefore = (await mutations(page)).length;
    const activeCopy = await copy(page, 'success');
    assert.equal(activeCopy.attempts[0].text, exportText);
    const activeSaved = await save(page);
    assert.equal(activeSaved.source, exportText);
    const after = await inspect(page);
    assert.deepEqual(stableVoice(after), stableVoice(held));
    assert.equal((await mutations(page)).length, commandBefore, 'Exports do not issue sound commands');
    const audibleAfter = await audible(page);
    for (let sample = 0; sample < 8; sample++) {
      assert((await page.evaluate(() => __scspDspViewAudit.level())).acRms > 0.00005);
      await page.waitForTimeout(20);
    }
    const activeGraph = await graph(page);
    assert.equal(activeGraph.contexts, 1);
    assert.equal(activeGraph.nodes.filter(node => node === 'tetorica-scsp-synth').length, 1);
    assert(activeGraph.physicalOutputMuted);

    await page.locator('#scspDelayPanel').evaluate(node => {node.open = true;});
    await page.locator('#effectEnabled').check();
    await waitState(page, state => state.config.effect.enabled, 'Delay enabled');
    await page.waitForFunction(() => /delay.*on/i.test(document.getElementById('scspDspTab').textContent));
    assert.deepEqual((await inspect(page)).voiceGroups.map(group => ({id: group.id, slots: group.slots, held: group.held})),
      held.voiceGroups.map(group => ({id: group.id, slots: group.slots, held: group.held})));
    await page.locator('#effectEnabled').uncheck();
    await waitState(page, state => !state.config.effect.enabled, 'Delay disabled');
    assert(!/delay.*on/i.test(await page.locator('#scspDspTab').textContent()));
    await page.keyboard.up('a');
    await waitState(page, state => state.voiceGroups.every(group => !group.held), 'Keyboard release after exports');
    await page.locator('#stop').click();
    await page.waitForFunction(() => __scspDspViewAudit.level().peak < 1e-7);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(unexpectedExternal, []);
    return {browser: name, passed: true, rows, coldAudioContexts: 0,
      exportedFilename: downloaded.filename, exportedBytes: Buffer.byteLength(exportText), exportedSha256: downloaded.sha256,
      clipboardSuccess: true, clipboardFallback: true, clipboardFailure: denied.status,
      temporaryFocusRestored: true, coldSettingsPreserved: true, exportWordsExact: true,
      heldVoicePreserved: true, soundCommandsDuringExports: 0, audibleBefore, audibleAfter,
      delayIndicatorAndControls: true, keyboardRelease: true, mobileOverflow, mobileRoles,
      graph: activeGraph, blockedEditor, errors, missing};
  } catch (error) {
    error.browserResult = {browser: name, passed: false, error: error.stack ?? String(error), errors, missing,
      status: await status(page).catch(() => null), audioStatus: await page.locator('#status').textContent().catch(() => null)};
    throw error;
  } finally {await page.close();}
}

(async () => {
  const {assembleScspDsp} = await import(pathToFileURL(path.join(repository, 'docs/synth-scsp/dsp_assembler.js')));
  const {delayProgram} = await import(pathToFileURL(path.join(repository, 'docs/synth-scsp/dsp.js')));
  const expectedWords = delayProgram(), results = [];
  let failure;
  await fs.mkdir(path.dirname(config.out), {recursive: true});
  try {
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const name of engines) {
      const browser = await ({chromium, webkit}[name]).launch({headless: true,
        ...(name === 'chromium' ? {args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required']} : {})});
      try {results.push(await check(browser, name, origin, assembleScspDsp, expectedWords));}
      finally {await browser.close();}
      console.log('PASS ' + name + ' SCSP DSP program view (physical gain zero)');
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
