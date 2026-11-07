// Self-authored PSID playback through the real browser CPU/WASM/Worklet.
// Each physical output ends in a separate gain=0; no listening is performed.
const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');

const config = {root: path.resolve(__dirname, '../docs'), entry: '/sid-player/index.html',
  out: '/private/tmp/tetorica-sid-player-browser.json', screenshots: null};
for (let index = 2; index < process.argv.length; ++index) {
  const key = process.argv[index].replace(/^--/, ''), value = process.argv[++index];
  assert(['root', 'entry', 'out', 'screenshots'].includes(key) && value && !value.startsWith('--'), 'Usage: --root DIR --entry /index.html --out JSON --screenshots DIR');
  config[key] = key === 'entry' ? value : path.resolve(value);
}
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.md': 'text/plain', '.sid': 'application/octet-stream'};
const report = {schemaVersion: 1, passed: false, entry: config.entry, physicalOutputMuted: true,
  listeningPerformed: false, fixtures: 'Newly authored C64 PSID programs only; no game or ROM data', results: []};

function instrument() {
  const audit = window.__sidPlayerAudit = {contexts: [], worklets: [], sinks: [], messages: [], nextId: 0};
  const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  window.AudioContext = class extends Context {constructor(...args) {super(...args); audit.contexts.push(this);}};
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {constructor(...args) {super(...args); audit.worklets.push(this);}};
  MessagePort.prototype.postMessage = function(data, ...args) {
    if (data?.method) audit.messages.push({method: data.method, id: data.id});
    if (data?.id > 0 && audit.holdNextMethod === data.method) {
      audit.holdNextMethod = null;
      audit.releaseCommand = () => {audit.releaseCommand = null; return post.call(this, data, ...args);};
      return;
    }
    return post.call(this, data, ...args);
  };
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination === this.context.destination) {
      const analyser = this.context.createAnalyser(), finalGain = this.context.createGain();
      analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0; finalGain.gain.value = 0;
      connect.call(this, analyser, ...args); connect.call(analyser, finalGain); connect.call(finalGain, destination);
      audit.sinks.push({context: this.context, analyser, finalGain}); return destination;
    }
    return connect.call(this, destination, ...args);
  };
  audit.read = () => new Promise((resolve, reject) => {
    const node = audit.worklets.findLast(node => node.context.state !== 'closed'), id = --audit.nextId;
    if (!node) return reject(new Error('No open SID player worklet'));
    const timer = setTimeout(() => {node.port.removeEventListener('message', receive); reject(new Error('SID player audit read timeout'));}, 5000);
    function receive({data}) {
      if (data?.id !== id) return;
      clearTimeout(timer); node.port.removeEventListener('message', receive);
      data.error ? reject(new Error(data.error)) : resolve(data.value);
    }
    node.port.addEventListener('message', receive); node.port.start(); node.port.postMessage({id, method: 'read', args: []});
  });
  audit.sample = () => {
    const sink = audit.sinks.findLast(sink => sink.context.state === 'running');
    const muted = audit.sinks.every(sink => sink.finalGain.gain.value === 0);
    if (!sink) return {rms: 0, peak: 0, finite: true, muted, spectrum: []};
    const pcm = new Float32Array(sink.analyser.fftSize), db = new Float32Array(sink.analyser.frequencyBinCount);
    sink.analyser.getFloatTimeDomainData(pcm); sink.analyser.getFloatFrequencyData(db);
    let square = 0, peak = 0; for (const value of pcm) {square += value * value; peak = Math.max(peak, Math.abs(value));}
    return {rms: Math.sqrt(square / pcm.length), peak, finite: pcm.every(Number.isFinite), muted,
      spectrum: Array.from(db, value => Number.isFinite(value) ? 10 ** (value / 10) : 0)};
  };
}

async function checkBrowser(name, engine, origin, fixtures) {
  const browser = await engine.launch({headless: true}), errors = [], consoleErrors = [], failed = [], external = [], checks = [], measurements = {};
  let page, stage = 'startup', holdWasm = false, releaseWasm;
  try {
    page = await browser.newPage({viewport: {width: 1180, height: 1000}}); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text());});
    page.on('response', response => {if (response.status() >= 400) failed.push({url: response.url(), status: response.status()});});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {external.push(url.href); return route.abort();}
      if (url.origin === origin && /\/sid-player\/sid-player\.wasm$/.test(url.pathname) && holdWasm) {
        holdWasm = false; await new Promise(resolve => {releaseWasm = resolve;}); return route.continue().catch(() => {});
      }
      return route.continue();
    });
    await page.addInitScript(instrument);
    const check = label => {stage = label; checks.push(label); console.log(`CHECK ${name}: ${label}`);};
    const read = () => page.evaluate(() => __sidPlayerAudit.read());
    const waitState = async predicate => {
      for (let i = 0; i < 120; ++i) {const state = await read(); if (predicate(state)) return state; await page.waitForTimeout(25);}
      throw new Error('SID player state did not settle: ' + JSON.stringify(await read()));
    };
    const ready = () => page.waitForFunction(() => !document.querySelector('#play').disabled && document.querySelector('#status').dataset.state !== 'loading');
    const sound = () => page.waitForFunction(() => {const sample = __sidPlayerAudit.sample(); return sample.muted && sample.finite && sample.rms > .00001;});
    const silent = () => page.waitForFunction(() => {const sample = __sidPlayerAudit.sample(); return sample.muted && sample.finite && sample.peak < 1e-8;});
    const sample = async () => {await page.waitForTimeout(240); const value = await page.evaluate(() => __sidPlayerAudit.sample()); assert(value.finite && value.muted); return value;};
    const stop = async () => {await page.locator('#stop').click(); await silent(); await ready();};
    const play = async () => {
      await page.locator('#play').click();
      await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'playing');
      // The retained init samples can sound before the first VBI. Wait for an
      // actual completed play routine before inspecting program progression.
      await waitState(state => state.playing && state.positionFrames > 0 && state.playCalls > 0); await sound();
    };
    const range = (id, value) => page.locator('#' + id).evaluate((input, value) => {input.value = String(value); input.dispatchEvent(new Event('input', {bubbles: true}));}, value);
    const loadFile = async (bytes, filename) => {
      await page.locator('#sidFile').setInputFiles({name: filename, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes)});
    };
    const loadDemo = async profile => {
      const before = await page.locator('#demo').evaluate(select => ({html: select.outerHTML,
        options: Array.from(select.options, option => ({value: option.value, attribute: option.getAttribute('value'), text: option.textContent, disabled: option.disabled}))}));
      assert.equal(typeof profile, 'string'); assert(before.options.some(option => option.value === profile), `Missing demo option ${JSON.stringify({profile, ...before})}`);
      await page.locator('#demo').selectOption({value: profile}); await page.locator('#loadDemo').click();
      await page.waitForFunction(profile => document.querySelector('#title').textContent.toLowerCase().includes(profile), profile); await ready();
    };
    await page.goto(origin + config.entry); await page.waitForSelector('#loadDemo');

    check('local readable player loads without audio; selecting a demo preflights its real CPU and metadata');
    assert.match(await page.title(), /SID Player/); assert.equal(await page.evaluate(() => __sidPlayerAudit.contexts.length), 0);
    assert.equal(await page.locator('#play').isDisabled(), true);
    await loadDemo('melody-filter'); assert.equal(await page.evaluate(() => __sidPlayerAudit.contexts.length), 0);
    assert.match(await page.locator('#author').textContent(), /Tetorica/); assert.equal(await page.locator('#subtune option').count(), 1);
    const source = await page.evaluate(async () => {
      const module = document.querySelector('script[type="module"][src]'), response = await fetch(module.src);
      if (!response.ok) throw new Error('Unreadable player source'); return (await response.text()).split('\n').length;
    }); assert(source > 20);

    check('Stop cancels delayed audio startup and no stale Play becomes audible');
    holdWasm = true; await page.locator('#play').click();
    for (let i = 0; !releaseWasm && i < 120; ++i) await page.waitForTimeout(25);
    assert(releaseWasm, 'audio startup reached the independently held WASM request');
    await page.locator('#stop').click(); releaseWasm(); releaseWasm = null; await ready(); await silent();
    await page.waitForTimeout(120); assert.equal(await page.evaluate(() => __sidPlayerAudit.messages.filter(message => message.method === 'start').length), 0);

    check('all four local demos produce finite real PCM and program-driven voice/filter changes');
    measurements.demos = {};
    for (const profile of ['tone', 'pulse', 'noise', 'melody-filter']) {
      await loadDemo(profile); await play(); const first = await read(), measured = await sample();
      assert.equal(await page.locator('#voices tr').count(), 3); assert(first.cycles > first.initCycles && first.playCalls > 0);
      const cutoffs = new Set(); const widths = new Set();
      for (let i = 0; i < 4; ++i) {
        const state = await read(); cutoffs.add((state.registers[21] & 7) | state.registers[22] << 3);
        widths.add(state.registers[2] | (state.registers[3] & 15) << 8); await page.waitForTimeout(110);
      }
      if (profile === 'melody-filter') assert(cutoffs.size > 1, 'C64 play routine changes shared filter registers');
      if (profile === 'pulse') assert(widths.size > 1, 'C64 play routine changes pulse width');
      measurements.demos[profile] = {rms: measured.rms, peak: measured.peak, cycles: first.cycles,
        playCalls: first.playCalls, distinctCutoffs: cutoffs.size, distinctPulseWidths: widths.size};
      await stop(); assert.equal((await page.locator('#elapsed').textContent()).trim(), '0:00');
    }

    check('file selection exposes two subtunes and passes the selected init A value into actual SID frequency');
    await loadFile(fixtures.two, 'two-subtunes.sid'); await page.waitForFunction(() => document.querySelector('#subtune').options.length === 2); await ready();
    await play(); let state = await read(); assert.equal(state.subtune, 1);
    assert.equal(state.registers[0] | state.registers[1] << 8, fixtures.frequencies[0]); await stop();
    await page.locator('#subtune').selectOption('2'); await ready(); await play(); state = await read(); assert.equal(state.subtune, 2);
    assert.equal(state.registers[0] | state.registers[1] << 8, fixtures.frequencies[1]);

    check('Stop cancels a pending subtune preflight and restores the accepted selector and actual tune');
    await stop(); holdWasm = true; await page.locator('#subtune').selectOption({value: '1'});
    for (let i = 0; !releaseWasm && i < 120; ++i) await page.waitForTimeout(25);
    assert(releaseWasm, 'subtune preflight reached its held WASM request');
    // The accepted selection stays visible while the requested candidate is
    // checked; neither its pending label nor late completion may replace it.
    assert.equal(await page.locator('#subtune').inputValue(), '2');
    await page.locator('#stop').click(); releaseWasm(); releaseWasm = null; await ready(); await silent();
    assert.equal(await page.locator('#subtune').inputValue(), '2'); await page.waitForTimeout(100);
    assert.equal(await page.locator('#subtune').inputValue(), '2'); await play(); assert.equal((await read()).subtune, 2);

    check('synthetic persisted pagehide stops audio while pageshow leaves the selected tune and controls usable');
    const retainedTitle = await page.locator('#title').textContent();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted: true})));
    await ready(); await silent();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
    assert.equal(await page.locator('#title').textContent(), retainedTitle); assert.equal(await page.locator('#subtune').inputValue(), '2');
    await play(); assert.equal((await read()).subtune, 2);
    measurements.persistedLifecycle = {syntheticEvents: true, retainedSubtune: 2, restarted: true};

    check('cancel, malformed PSID and CPU preflight errors keep the selected and currently playing tune');
    const title = await page.locator('#title').textContent(), before = await read();
    await page.locator('#sidFile').dispatchEvent('cancel'); assert.equal(await page.locator('#title').textContent(), title);
    for (const [filename, bytes] of [['truncated.sid', new Uint8Array(8)], ['rom-read.sid', fixtures.rom], ['init-loop.sid', fixtures.loop]]) {
      const previous = await page.locator('#status').textContent(); await loadFile(bytes, filename);
      await page.waitForFunction(previous => {const status = document.querySelector('#status'); return status.dataset.state === 'error' && status.textContent !== previous;}, previous);
      state = await read(); assert.equal(state.playing, true); assert.equal(state.subtune, 2); assert.equal(await page.locator('#title').textContent(), title); await sound();
    }
    assert((await read()).positionFrames > before.positionFrames);

    check('Master is post-player, doubles amplitude and supports orange 380 percent');
    await range('master', .7); const base = await sample(); await range('master', 1.4); const doubled = await sample();
    measurements.masterRatio = doubled.rms / base.rms; assert(Math.abs(measurements.masterRatio - 2) < .05);
    await range('master', 3.8); assert.match(await page.locator('#masterValue').textContent(), /380/);
    assert.equal(await page.locator('#master').evaluate(input => input.closest('label').classList.contains('is-boost')), true);
    await range('master', .7); await stop();

    check('Stop fences a pending start command, then fresh Play restarts from the selected file');
    await page.evaluate(() => {__sidPlayerAudit.holdNextMethod = 'start'; __sidPlayerAudit.releaseCommand = null;});
    await page.locator('#play').click(); await page.waitForFunction(() => typeof __sidPlayerAudit.releaseCommand === 'function');
    await page.locator('#stop').click(); await page.evaluate(() => __sidPlayerAudit.releaseCommand?.());
    await ready(); await silent(); await page.waitForTimeout(100); await silent(); await play(); assert.equal((await read()).subtune, 2); await stop();

    check('a bounded runtime CPU fault becomes silent and a valid demo recovers without reloading the page');
    await loadFile(fixtures.playLoop, 'play-loop.sid'); await ready(); await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error'); await silent();
    await loadDemo('tone'); await play(); await stop();

    check('one passive waveform/spectrum monitor and compact desktop/mobile player stay entirely local');
    assert.equal(await page.locator('#outputCanvas').count(), 1);
    await page.locator('[data-view="spectrum"]').click(); assert.equal(await page.locator('[data-view="spectrum"]').getAttribute('aria-pressed'), 'true');
    measurements.layouts = [];
    for (const width of [1180, 390]) {
      await page.setViewportSize({width, height: width === 390 ? 844 : 1000}); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(100);
      const layout = await page.evaluate(() => ({width: innerWidth, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        iconLoaded: document.querySelector('.identity img').naturalWidth, voices: document.querySelectorAll('#voices tr').length}));
      assert.equal(layout.overflow, 0); assert.equal(layout.iconLoaded, 1254); assert.equal(layout.voices, 3); measurements.layouts.push(layout);
      if (config.screenshots) await page.screenshot({path: path.join(config.screenshots, `${name}-${width}.png`), fullPage: true});
    }
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(failed, []); assert.deepEqual(external, []);
    const outputBranches = await page.evaluate(() => __sidPlayerAudit.contexts.map(context => ({state: context.state,
      destinationConnections: __sidPlayerAudit.sinks.filter(sink => sink.context === context).length})));
    assert(outputBranches.every(context => context.destinationConnections <= 1), 'the passive meter must not create another physical output');
    const finalSample = await page.evaluate(() => {const {spectrum, ...sample} = __sidPlayerAudit.sample(); return sample;});
    assert.equal(finalSample.peak, 0);
    return {engine: name, version: browser.version(), passed: true, checks, measurements, errors, consoleErrors, failed, external,
      outputBranches, finalSample};
  } catch (error) {
    releaseWasm?.(); releaseWasm = null;
    if (config.screenshots && page) await page.screenshot({path: path.join(config.screenshots, `${name}-failed.png`), fullPage: true}).catch(() => {});
    const status = await page?.locator('#status').textContent().catch(() => null);
    const demo = await page?.locator('#demo').evaluate(select => ({html: select.outerHTML, value: select.value,
      options: Array.from(select.options, option => ({value: option.value, text: option.textContent}))})).catch(() => null);
    report.results.push({engine: name, passed: false, stage, error: error.message, status, demo, errors, consoleErrors, failed, external});
    throw new Error(`${name} (${stage}): ${error.message}; status=${status}`, {cause: error});
  } finally {releaseWasm?.(); await browser.close();}
}

(async () => {
  if (config.screenshots) await fs.mkdir(config.screenshots, {recursive: true});
  report.checkerSha256 = createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  const {createSidPlayerTestFixture, SID_PLAYER_TEST_FREQUENCIES} = await import(pathToFileURL(path.resolve(__dirname, '../test/helpers/sid_player_fixtures.mjs')));
  const fixtures = {two: createSidPlayerTestFixture(), rom: createSidPlayerTestFixture('rom-read'), loop: createSidPlayerTestFixture('init-loop'),
    playLoop: createSidPlayerTestFixture('late-play-loop'), frequencies: SID_PLAYER_TEST_FREQUENCIES};
  const server = http.createServer(async (request, response) => {
    try {
      const file = path.resolve(config.root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
      assert(file.startsWith(config.root + path.sep)); const data = await fs.readFile(file);
      response.writeHead(200, {'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'}); response.end(data);
    } catch {response.writeHead(404); response.end();}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) report.results.push(await checkBrowser(name, engine, origin, fixtures));
    report.passed = true;
  } finally {await new Promise(resolve => server.close(resolve)); await fs.mkdir(path.dirname(config.out), {recursive: true}); await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n');}
})().catch(error => {console.error(error); process.exitCode = 1;});
