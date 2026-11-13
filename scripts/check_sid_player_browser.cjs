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
  listeningPerformed: false, fixtures: 'Self-authored PSID/RSID programs and synthetic test firmware only; no game music or Commodore ROM dumps', results: []};

function instrument() {
  const audit = window.__sidPlayerAudit = {contexts: [], worklets: [], sinks: [], messages: [], nextId: 0};
  const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  const readFile = File.prototype.arrayBuffer;
  const schedule = window.setTimeout;
  window.setTimeout = function(callback, delay, ...args) {
    if (audit.holdNextPreflightYield && delay === 0 && typeof callback === 'function') {
      audit.holdNextPreflightYield = false;
      audit.releasePreflightYield = () => {audit.releasePreflightYield = null; return schedule.call(window, callback, 0, ...args);};
      return 0x70000000;
    }
    return schedule.call(window, callback, delay, ...args);
  };
  File.prototype.arrayBuffer = function(...args) {
    if (this.name !== audit.holdFileName) return readFile.call(this, ...args);
    audit.holdFileName = null; const bytes = readFile.call(this, ...args);
    return new Promise((resolve, reject) => {audit.releaseFile = () => {audit.releaseFile = null; bytes.then(resolve, reject);};});
  };
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
  const browser = await engine.launch({headless: true, ...(name === 'chromium' ? {args:['--mute-audio']} : {})}), errors = [], consoleErrors = [], failed = [], external = [], checks = [], measurements = {};
  let page, stage = 'startup', holdWasm = false, releaseWasm;
  try {
    page = await browser.newPage({viewport: {width: 1180, height: 1000}}); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text());});
    page.on('response', response => {if (response.status() >= 400) failed.push({url: response.url(), status: response.status()});});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {external.push(url.href); return route.abort();}
      if (url.origin === origin && /\/(?:sid-(?:player|rsid)\/sid-(?:player|rsid)|sid8580-machine\/sid8580-(?:endpoint|machine))\.wasm$/.test(url.pathname) && holdWasm) {
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
      // Retained init samples can sound before the first PSID VBI. Require an
      // actual PSID play call or RSID machine SID writes, as appropriate.
      await waitState(state => state.playing && state.positionFrames > 0 && (state.format === 'RSID' ? state.writeCount > 0 : state.playCalls > 0)); await sound();
    };
    const range = (id, value) => page.locator('#' + id).evaluate((input, value) => {input.value = String(value); input.dispatchEvent(new Event('input', {bubbles: true}));}, value);
    const loadFile = async (bytes, filename) => {
      await page.locator('#sidFile').setInputFiles({name: filename, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes)});
    };
    const loadDemo = async (profile, title = profile) => {
      const before = await page.locator('#demo').evaluate(select => ({html: select.outerHTML,
        options: Array.from(select.options, option => ({value: option.value, attribute: option.getAttribute('value'), text: option.textContent, disabled: option.disabled}))}));
      assert.equal(typeof profile, 'string'); assert(before.options.some(option => option.value === profile), `Missing demo option ${JSON.stringify({profile, ...before})}`);
      await page.locator('#demo').selectOption({value: profile}); await page.locator('#loadDemo').click();
      await page.waitForFunction(title => document.querySelector('#title').textContent.toLowerCase().includes(title), title); await ready();
    };
    await page.goto(origin + config.entry); await page.waitForSelector('#loadDemo');

    check('local readable player loads without audio; selecting a demo preflights its real CPU and metadata');
    assert.match(await page.title(), /SID Player/); assert.equal(await page.evaluate(() => __sidPlayerAudit.contexts.length), 0);
    assert.equal(await page.locator('#vbiBackend').inputValue(), 'c64', 'new UI defaults to the C64 machine');
    assert.equal(await page.locator('#sidModel').inputValue(), 'auto', 'file model declaration is the default');
    assert.equal(await page.locator('#assumeRsid').isChecked(), true, 'unknown/either targets default to PAL / 6581');
    assert.equal(await page.locator('#play').isDisabled(), true);
    await loadFile(fixtures.psidUnknown, 'default-unknown-target.psid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('default-unknown-target.psid'));
    await ready(); assert.match(await page.locator('#fileInfo').textContent(), /Header unknown \/ unknown → PAL \/ 6581/);
    assert.equal(await page.evaluate(() => __sidPlayerAudit.contexts.length), 0, 'default target preflight does not start audio');
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
      assert.equal(first.backend, 'c64'); assert.equal(first.timing, 'vbi');
      assert.equal(await page.locator('#voices tr').count(), 3); assert(first.cycles > first.initCycles && first.playCalls > 0);
      const cutoffs = new Set(); const widths = new Set();
      for (let i = 0; i < 4; ++i) {
        const state = await read(); cutoffs.add((state.registers[21] & 7) | state.registers[22] << 3);
        widths.add(state.registers[2] | (state.registers[3] & 15) << 8); await page.waitForTimeout(110);
      }
      if (profile === 'melody-filter') assert(cutoffs.size > 1, 'C64 play routine changes shared filter registers');
      if (profile === 'pulse') assert(widths.size > 1, 'C64 play routine changes pulse width');
      measurements.demos[profile] = {rms: measured.rms, peak: measured.peak, cycles: first.cycles,
        backend: first.backend, playCalls: first.playCalls, distinctCutoffs: cutoffs.size, distinctPulseWidths: widths.size};
      await stop(); assert.equal((await page.locator('#elapsed').textContent()).trim(), '0:00');
    }
    // Retain the direct-runner regression checks below as an explicit manual
    // comparison. They must not silently follow the UI's new machine default.
    if (!await page.locator('#rsidSettings').evaluate(details => details.open)) await page.locator('#rsidSettings > summary').click();
    await page.locator('#vbiBackend').selectOption({value: 'direct'});
    await page.locator('#rsidSettings > summary').click();
    await loadDemo('melody-filter');

    check('unknown PSID targets preserve the old sound until explicit PAL/6581 choices reach real playback');
    await play(); const previousPsidTitle = await page.locator('#title').textContent();
    if (!await page.locator('#rsidSettings').evaluate(details => details.open)) await page.locator('#rsidSettings > summary').click();
    await page.locator('#rsidEnvironment').selectOption({value: 'rom'}); await page.locator('#assumeRsid').uncheck();
    await loadFile(fixtures.psidUnknown, 'unknown-target.psid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /choose|unspecified/i.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#title').textContent(), previousPsidTitle); assert.equal((await read()).playing, true); await sound();
    assert.equal(await page.locator('#rsidSettings').evaluate(details => details.open), true);
    assert.equal(await page.locator('#applyRsidEnvironment').isDisabled(), false, 'PSID retry must not require a missing RSID ROM set');
    await page.locator('#assumeRsid').check(); await page.locator('#applyRsidEnvironment').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('unknown-target.psid'));
    await ready(); await silent(); assert.match(await page.locator('#fileInfo').textContent(), /Header unknown \/ unknown/);
    await play(); let psidState = await read(); assert.equal(psidState.format, 'PSID');
    assert.equal(psidState.declaredClock, 'unknown'); assert.equal(psidState.declaredModel, 'unknown');
    assert.deepEqual(psidState.targetSelection, {clock: 'explicit', model: 'explicit'});
    assert.equal(psidState.registers[0] | psidState.registers[1] << 8, fixtures.frequencies[0]);
    await page.locator('#assumeRsid').uncheck(); await page.locator('#subtune').selectOption({value: '2'});
    await ready(); await silent(); await play(); psidState = await read();
    assert.equal(psidState.subtune, 2); assert.equal(psidState.registers[0] | psidState.registers[1] << 8, fixtures.frequencies[1]);
    assert.deepEqual(psidState.targetSelection, {clock: 'explicit', model: 'explicit'});
    assert.equal(await page.locator('#assumeRsid').isChecked(), false, 'accepted options survive an unapplied control change');

    check('cancelling an unknown-PSID subtune does not cache its draft as the Apply target');
    await stop(); await page.locator('#assumeRsid').check(); holdWasm = true;
    await page.locator('#subtune').selectOption({value: '1'});
    for (let i = 0; !releaseWasm && i < 120; ++i) await page.waitForTimeout(25);
    assert(releaseWasm); await page.locator('#stop').click(); releaseWasm(); releaseWasm = null; await ready(); await silent();
    assert.equal(await page.locator('#subtune').inputValue(), '2'); await page.locator('#applyRsidEnvironment').click();
    await ready(); await silent(); await play(); assert.equal((await read()).subtune, 2);

    check('PSID VBI ignores pending ROM files, CIA guards them, and known NTSC or 8580 Direct VBI remain refused');
    await page.evaluate(() => {__sidPlayerAudit.holdFileName = 'pending-psid-choice-chars.bin';});
    await page.locator('#romChars').setInputFiles({name: 'pending-psid-choice-chars.bin', mimeType: 'application/octet-stream', buffer: Buffer.from(fixtures.roms.chars)});
    await page.waitForFunction(() => typeof __sidPlayerAudit.releaseFile === 'function');
    assert.equal(await page.locator('#applyRsidEnvironment').isDisabled(), false);
    await loadFile(fixtures.psidEither, 'either-target.psid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('either-target.psid'));
    await ready(); await silent(); await play(); assert.equal((await read()).format, 'PSID');
    assert.equal((await read()).declaredClock, 'any'); assert.equal((await read()).declaredModel, 'any');
    await page.locator('#applyRsidEnvironment').click(); await ready(); await silent(); await play();
    assert.match(await page.locator('#fileInfo').textContent(), /Header any \/ any/);
    const beforePendingCia = await page.locator('#fileInfo').textContent();
    await loadFile(fixtures.psidCiaSelected, 'pending-cia-roms.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /finish reading/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#fileInfo').textContent(), beforePendingCia);
    assert.equal((await read()).timing, 'vbi'); assert.equal((await read()).playing, true); await sound();
    assert.equal(await page.locator('#applyRsidEnvironment').isDisabled(), true, 'CIA retry must wait for its selected ROM read');
    await page.evaluate(() => __sidPlayerAudit.releaseFile());
    await page.waitForFunction(() => document.querySelector('#romCharsInfo').textContent.includes('pending-psid-choice-chars.bin'));
    assert.equal(await page.locator('#applyRsidEnvironment').isDisabled(), false);
    const acceptedPsidInfo = await page.locator('#fileInfo').textContent();
    for (const [bytes, filename, reason] of [[fixtures.psidNtsc, 'ntsc-target.psid', 'NTSC'], [fixtures.psid8580, '8580-target.psid', '8580']]) {
      await loadFile(bytes, filename);
      await page.waitForFunction(reason => document.querySelector('#status').dataset.state === 'error' && document.querySelector('#status').textContent.includes(reason), reason);
      assert.equal(await page.locator('#fileInfo').textContent(), acceptedPsidInfo); assert.equal((await read()).playing, true); await sound();
    }

    check('mixed PSID songs select real VBI or CIA playback and never autoplay after changing backend');
    await page.locator('#rsidEnvironment').selectOption({value: 'minimal'});
    await loadFile(fixtures.psidCia, 'mixed-vbi-cia.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('mixed-vbi-cia.sid'));
    await ready(); await silent(); await play(); let ciaState = await read();
    assert.equal(ciaState.format, 'PSID'); assert.equal(ciaState.timing, 'vbi');
    assert.equal(ciaState.subtune, 1); assert.equal(ciaState.registers[0] | ciaState.registers[1] << 8, fixtures.ciaFrequencies[0]);
    await page.locator('#subtune').selectOption({value: '2'}); await ready(); await silent(); await play();
    ciaState = await waitState(value => value.timing === 'cia' && value.irqCount > 100 && value.playCalls > 100);
    assert.equal(ciaState.format, 'PSID'); assert.equal(ciaState.subtune, 2);
    assert.equal(ciaState.registers[0] | ciaState.registers[1] << 8, fixtures.ciaFrequencies[1]);
    const firstPlayCalls = ciaState.playCalls; await page.waitForTimeout(300); ciaState = await read();
    assert(ciaState.playCalls - firstPlayCalls > 100, 'actual CIA plays far more often than a 50Hz VBI callback');
    assert.equal(ciaState.nmiCount, 0); await sound();
    measurements.psidCia = {timing: ciaState.timing, playCalls: ciaState.playCalls, irqCount: ciaState.irqCount, rms: (await sample()).rms};
    await stop(); await page.locator('#rsidEnvironment').selectOption({value: 'rom'});
    for (const [key, input] of [['chars', '#romChars'], ['basic', '#romBasic'], ['kernal', '#romKernal']]) {
      await page.locator(input).setInputFiles({name: `cia-saved-a-${key}.bin`, mimeType: 'application/octet-stream', buffer: Buffer.from(fixtures.ciaRoms[key])});
      await page.waitForFunction(({input, key}) => document.querySelector(input + 'Info').textContent.includes(`cia-saved-a-${key}.bin`), {input, key});
    }
    await loadFile(fixtures.psidCiaSelected, 'mixed-saved-roms.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('mixed-saved-roms.sid'));
    await ready(); await silent(); await play(); assert.equal((await read()).environment, 'rom');
    await page.locator('#subtune').selectOption({value: '1'}); await ready(); await silent(); await play();
    assert.equal((await read()).timing, 'vbi');
    await page.locator('#rsidEnvironment').selectOption({value: 'minimal'});
    await page.evaluate(() => {__sidPlayerAudit.holdFileName = 'pending-cia-saved-b-kernal.bin';});
    await page.locator('#romKernal').setInputFiles({name: 'pending-cia-saved-b-kernal.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(8192, 0x02)});
    await page.waitForFunction(() => typeof __sidPlayerAudit.releaseFile === 'function');
    await page.locator('#subtune').selectOption({value: '2'}); await ready(); await silent(); await play();
    ciaState = await waitState(value => value.timing === 'cia' && value.playCalls > 100);
    assert.equal(ciaState.environment, 'rom'); assert.equal(ciaState.bootCycles, 2000000);
    assert.equal(await page.locator('#rsidEnvironment').inputValue(), 'minimal', 'an unapplied environment draft does not replace accepted ROM settings');
    await page.evaluate(() => __sidPlayerAudit.releaseFile());
    await page.waitForFunction(() => document.querySelector('#romKernalInfo').textContent.includes('pending-cia-saved-b-kernal.bin'));
    await stop(); await play(); ciaState = await read();
    assert.equal(ciaState.environment, 'rom'); assert.equal(ciaState.bootCycles, 2000000); await sound();
    measurements.psidCia.savedRomsAcrossVbi = {preserved: true, pendingReplacementIgnored: true, restartAfterBadReplacement: true};

    check('CIA candidate CPU faults keep the playing machine and Stop cancels a cross-backend subtune transition');
    const acceptedCiaInfo = await page.locator('#fileInfo').textContent();
    await loadFile(fixtures.psidCiaRom, 'cia-rom-error.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /ROM/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#fileInfo').textContent(), acceptedCiaInfo); assert.equal((await read()).timing, 'cia'); await sound();
    await page.locator('#subtune').selectOption({value: '1'}); await ready(); await silent(); await play();
    assert.equal((await read()).timing, 'vbi'); await stop(); holdWasm = true;
    await page.locator('#subtune').selectOption({value: '2'});
    for (let i = 0; !releaseWasm && i < 120; ++i) await page.waitForTimeout(25);
    assert(releaseWasm, 'CIA transition reached the separate C64 WASM request');
    await page.locator('#stop').click(); releaseWasm(); releaseWasm = null; await ready(); await silent();
    assert.equal(await page.locator('#subtune').inputValue(), '1'); await play(); assert.equal((await read()).timing, 'vbi');

    check('positive relocation preserves raw metadata and runs CIA from its declared free driver page');
    await loadFile(fixtures.psidRelocated, 'relocated-mixed.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('relocated-mixed.sid'));
    await ready(); await silent(); await play();
    let relocatedState = await read(); assert.equal(relocatedState.timing, 'vbi'); assert.equal(relocatedState.driverAddress, null);
    assert.deepEqual(relocatedState.relocation, {startPage: 0x20, pageLength: 1});
    await page.locator('#subtune').selectOption({value: '2'}); await ready(); await silent(); await play();
    relocatedState = await waitState(value => value.timing === 'cia' && value.playCalls > 100);
    assert.equal(relocatedState.driverAddress, 0x2000); assert.deepEqual(relocatedState.relocation, {startPage: 0x20, pageLength: 1});
    assert.match(await page.locator('#fileInfo').textContent(), /Driver \$2000/); await sound();
    measurements.relocation = {declaredStartPage: 0x20, declaredLength: 1, actualDriver: relocatedState.driverAddress, audiblePcm: true};

    check('VBI accepts FF/0 while unsupported CIA or malformed relocation keeps the old playing song');
    await loadFile(fixtures.psidNoDriver, 'no-free-pages.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('no-free-pages.sid'));
    await ready(); await silent(); await play();
    const noDriverInfo = await page.locator('#fileInfo').textContent(); assert.match(noDriverInfo, /No free driver pages/);
    assert.deepEqual((await read()).relocation, {startPage: 255, pageLength: 0});
    await page.locator('#subtune').selectOption({value: '2'});
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /free RAM page/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#subtune').inputValue(), '1'); assert.equal(await page.locator('#fileInfo').textContent(), noDriverInfo);
    assert.equal((await read()).timing, 'vbi'); assert.equal((await read()).playing, true); await sound();
    for (const [name, bytes, reason] of [['relocation-overlap.sid', fixtures.psidRelocationOverlap, 'overlap'], ['relocation-invalid-sentinel.sid', fixtures.psidRelocationSentinel, 'pageLength']]) {
      await loadFile(bytes, name);
      await page.waitForFunction(reason => document.querySelector('#status').dataset.state === 'error' && document.querySelector('#status').textContent.includes(reason), reason);
      assert.equal(await page.locator('#fileInfo').textContent(), noDriverInfo); assert.equal((await read()).playing, true); await sound();
      assert.deepEqual((await read()).relocation, {startPage: 255, pageLength: 0});
    }

    check('file selection exposes two subtunes and passes the selected init A value into actual SID frequency');
    await loadFile(fixtures.two, 'two-subtunes.sid'); await page.waitForFunction(() => document.querySelector('#fileInfo').textContent.includes('two-subtunes.sid') && document.querySelector('#subtune').options.length === 2); await ready();
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

    check('PAL and bank setup, indexed SID stores and phase-specific CPU diagnostics work through the real VBI worklet');
    await loadFile(fixtures.palEnvironment, 'pal-environment.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('pal-environment.sid'));
    await ready(); await play(); state = await read();
    assert.equal(state.registers[0] | state.registers[1] << 8, fixtures.palFrequency);
    await loadFile(fixtures.bankEnvironment, 'bank-environment.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('bank-environment.sid'));
    await ready(); await play(); state = await read();
    assert.equal(state.registers[2], fixtures.bankInit); assert.equal(state.registers[3], fixtures.bankPlay);
    await loadFile(fixtures.indexedStore, 'indexed-sid-block.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('indexed-sid-block.sid'));
    await ready(); await play(); assert((await read()).playCalls > 0); await sound();
    const indexedInfo = await page.locator('#fileInfo').textContent();
    for (const [filename, bytes, reason] of [['init-budget.sid', fixtures.loop, 'initialization subroutine'],
      ['play-budget.sid', fixtures.playImmediate, 'play subroutine'], ['cpu-jam.sid', fixtures.jam, 'JAM'],
      ['real-vic-read.sid', fixtures.realVicRead, '$D318']]) {
      await loadFile(bytes, filename);
      await page.waitForFunction(({filename, reason}) => {const status = document.querySelector('#status'); return status.dataset.state === 'error' && status.textContent.includes(filename) && status.textContent.includes(reason);}, {filename, reason});
      assert.equal(await page.locator('#fileInfo').textContent(), indexedInfo); assert.equal((await read()).playing, true); await sound();
    }
    measurements.vbiEnvironment = {palFrequency: fixtures.palFrequency, bankInit: fixtures.bankInit, bankPlay: fixtures.bankPlay,
      indexedStoreSucceeded: true, namedCandidateErrorsKeptOldSound: true};

    check('C64 VBI streams a long init, stops and restarts pending audio, and keeps accepted backend settings');
    await page.locator('#vbiBackend').selectOption({value: 'c64'}); await page.locator('#rsidEnvironment').selectOption({value: 'minimal'});
    await loadFile(fixtures.machineVbiLong, 'machine-vbi-long-init.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('machine-vbi-long-init.sid'));
    await ready(); await silent(); await page.locator('#play').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'playing');
    let machineState = await waitState(value => value.backend === 'c64' && value.initPending && value.positionFrames > 0);
    assert.equal(machineState.playCalls, 0); assert.equal(machineState.initCycleLimit, 2000000); await sound();
    await stop(); await play(); machineState = await waitState(value => value.initReturned && !value.initPending && value.playCalls > 0);
    assert.equal(machineState.backend, 'c64'); assert(machineState.initCycles > 100000);
    await page.locator('#vbiBackend').selectOption({value: 'direct'});
    await page.locator('#subtune').selectOption({value: '2'}); await ready(); await silent(); await play(); machineState = await read();
    assert.equal(machineState.backend, 'c64'); assert.equal(machineState.subtune, 2);
    assert.equal(machineState.registers[0] | machineState.registers[1] << 8, fixtures.machineFrequencies[1]);
    assert.equal(await page.locator('#vbiBackend').inputValue(), 'direct', 'an unapplied backend draft must not replace the accepted machine');
    await page.locator('#vbiBackend').selectOption({value: 'c64'}); await page.locator('#rsidEnvironment').selectOption({value: 'rom'});
    await page.evaluate(() => {__sidPlayerAudit.holdFileName = 'pending-machine-vbi-roms.bin';});
    await page.locator('#romChars').setInputFiles({name: 'pending-machine-vbi-roms.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4096)});
    await page.waitForFunction(() => typeof __sidPlayerAudit.releaseFile === 'function');
    const beforeMachineRom = await page.locator('#fileInfo').textContent();
    await loadFile(fixtures.two, 'machine-vbi-rom-pending.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /finish reading/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#fileInfo').textContent(), beforeMachineRom); assert.equal((await read()).backend, 'c64'); await sound();
    assert.equal(await page.locator('#applyRsidEnvironment').isDisabled(), true);
    await page.locator('#vbiBackend').selectOption({value: 'direct'}); assert.equal(await page.locator('#applyRsidEnvironment').isDisabled(), false);
    await page.locator('#applyRsidEnvironment').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('machine-vbi-rom-pending.sid'));
    await ready(); await silent(); await play(); assert.equal((await read()).backend, 'direct');
    await page.evaluate(() => __sidPlayerAudit.releaseFile());
    await page.waitForFunction(() => document.querySelector('#romCharsInfo').textContent.includes('pending-machine-vbi-roms.bin'));
    await page.locator('#rsidEnvironment').selectOption({value: 'minimal'});
    measurements.machineVbi = {pendingAudioStoppedAndRestarted: true, initCycles: machineState.initCycles, acceptedBackendKept: true, explicitDirectRetry: true};

    check('pending machine-VBI candidate cancellation and delayed init faults preserve the accepted tune');
    const acceptedBeforePending = await page.locator('#fileInfo').textContent();
    await page.locator('#vbiBackend').selectOption({value: 'c64'});
    await page.evaluate(() => {__sidPlayerAudit.holdNextPreflightYield = true;});
    await loadFile(fixtures.machineVbiLong, 'cancel-machine-pending.sid');
    await page.waitForFunction(() => typeof __sidPlayerAudit.releasePreflightYield === 'function');
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'loading');
    assert.equal(await page.locator('#fileInfo').textContent(), acceptedBeforePending); assert.equal((await read()).backend, 'direct'); await sound();
    await page.locator('#stop').click(); await page.evaluate(() => __sidPlayerAudit.releasePreflightYield());
    await ready(); await silent(); assert.equal(await page.locator('#fileInfo').textContent(), acceptedBeforePending);
    await play(); assert.equal((await read()).backend, 'direct');
    for (const [filename, bytes, reason] of [['pending-vbi-rom-fault.sid', fixtures.machineVbiLateRom, 'ROM'],
      ['pending-vbi-jam.sid', fixtures.machineVbiLateJam, 'JAM'], ['pending-vbi-deadline.sid', fixtures.machineVbiTimeout, '2000000']]) {
      await loadFile(bytes, filename);
      await page.waitForFunction(({filename, reason}) => {const status = document.querySelector('#status'); return status.dataset.state === 'error' && status.textContent.includes(filename) && status.textContent.includes(reason);}, {filename, reason});
      assert.equal(await page.locator('#fileInfo').textContent(), acceptedBeforePending); assert.equal((await read()).backend, 'direct'); await sound();
    }
    await page.locator('#vbiBackend').selectOption({value: 'direct'});
    measurements.machineVbi.pendingCandidateCancelled = true; measurements.machineVbi.delayedFaultsKeptOldSound = true;

    check('local RSID demo executes continuous CIA interrupts and drives real SID pulse width');
    if (!await page.locator('#rsidSettings').evaluate(details => details.open)) await page.locator('#rsidSettings > summary').click();
    await page.locator('#rsidEnvironment').selectOption({value: 'minimal'}); await page.locator('#assumeRsid').uncheck();
    await loadDemo('rsid-irq', 'rsid cia-irq'); await play(); state = await read();
    assert.equal(state.format, 'RSID'); assert.equal(state.environment, 'minimal'); assert(state.irqCount > 1);
    const initialIrqs = state.irqCount, pulseWidths = new Set();
    for (let i = 0; i < 5; ++i) {pulseWidths.add((await read()).registers[2]); await page.waitForTimeout(90);}
    assert(pulseWidths.size > 1); assert((await read()).irqCount > initialIrqs);
    measurements.rsidDemo = {irqCount: (await read()).irqCount, distinctPulseWidths: pulseWidths.size}; await stop();

    check('RSID raster IRQ, CIA2 NMI under SEI and a reprogrammed CIA timer all render real machine audio');
    measurements.rsidProfiles = {};
    for (const [profile, bytes] of [['raster-irq', fixtures.rsidRaster], ['cia-nmi', fixtures.rsidNmi], ['multispeed', fixtures.rsidMultispeed]]) {
      await loadFile(bytes, profile + '.rsid');
      await page.waitForFunction(profile => document.querySelector('#title').textContent.includes(profile), profile); await ready(); await play();
      const initial = await read(), measured = await sample(), current = await read();
      assert.equal(current.format, 'RSID'); assert.equal(current.environment, 'minimal');
      if (profile === 'cia-nmi') {assert(current.nmiCount > initial.nmiCount); assert.equal(current.initReturned, false);}
      else assert(current.irqCount > initial.irqCount);
      measurements.rsidProfiles[profile] = {rms: measured.rms, peak: measured.peak, irqCount: current.irqCount, nmiCount: current.nmiCount};
      await stop();
    }

    check('RSID init can remain in a busy loop while hardware IRQs and audio continue');
    await loadFile(fixtures.rsidBusy, 'rsid-busy-loop.sid'); await page.waitForFunction(() => document.querySelector('#title').textContent.includes('busy-loop')); await ready(); await play();
    state = await read(); assert.equal(state.format, 'RSID'); assert.equal(state.initReturned, false); assert(state.irqCount > 1);

    check('numeric RSID CPU/ROM preflight errors preserve the currently playing machine');
    const rsidTitle = await page.locator('#title').textContent();
    await loadFile(fixtures.rsidRomRequired, 'rom-dependent.rsid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /ROM/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#title').textContent(), rsidTitle); assert.equal((await read()).playing, true); await sound();

    check('unknown RSID hints require explicit PAL/6581 choice; known NTSC cannot be overridden');
    await loadFile(fixtures.rsidUnknown, 'unknown-hints.rsid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /choose|unspecified/i.test(document.querySelector('#status').textContent));
    assert.equal((await read()).playing, true);
    await page.locator('#assumeRsid').check(); await page.locator('#applyRsidEnvironment').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && document.querySelector('#fileInfo').textContent.includes('unknown-hints.rsid'));
    await ready(); await silent(); assert.match(await page.locator('#fileInfo').textContent(), /Header unknown \/ unknown/);
    await play(); const acceptedTitle = await page.locator('#title').textContent();
    await loadFile(fixtures.rsidNtsc, 'declared-ntsc.rsid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /NTSC/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#title').textContent(), acceptedTitle); assert.equal((await read()).playing, true); await sound();

    check('BASIC requires explicit in-memory user ROMs and synthetic ROM execution preserves subtune selection');
    await loadFile(fixtures.rsidBasic, 'original-basic-test.rsid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /BASIC/.test(document.querySelector('#status').textContent));
    assert.equal((await read()).playing, true);
    await page.locator('#rsidEnvironment').selectOption({value: 'rom'});
    for (const [suffix, bytes] of [['Chars', fixtures.roms.chars], ['Basic', fixtures.roms.basic], ['Kernal', fixtures.roms.kernal]]) {
      const filename = `synthetic-test-${suffix.toLowerCase()}.bin`;
      await page.locator('#rom' + suffix).setInputFiles({name: filename, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes)});
      await page.waitForFunction(({suffix, filename}) => document.querySelector('#rom' + suffix + 'Info').textContent.includes(filename), {suffix, filename});
    }
    await page.locator('#applyRsidEnvironment').click();
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'ready' && /BASIC/.test(document.querySelector('#fileInfo').textContent));
    await ready(); await silent(); await play(); state = await read();
    assert.equal(state.environment, 'rom'); assert(state.bootCycles > 0); assert.equal(state.registers[0] | state.registers[1] << 8, fixtures.basicFrequencies[0]);
    await stop(); await page.locator('#subtune').selectOption({value: '2'}); await ready(); await play(); state = await read();
    assert.equal(state.subtune, 2); assert.equal(state.registers[0] | state.registers[1] << 8, fixtures.basicFrequencies[1]);
    measurements.romTest = {syntheticTestRomsOnly: true, provesRomRamRunAndSongPlumbing: true, provesBasicInterpreterCompatibility: false, bootCycles: state.bootCycles};

    check('an aborted RSID subtune candidate never becomes the Apply retry target');
    await stop(); holdWasm = true; await page.locator('#subtune').selectOption({value: '1'});
    for (let i = 0; !releaseWasm && i < 120; ++i) await page.waitForTimeout(25);
    assert(releaseWasm); await page.locator('#stop').click(); releaseWasm(); releaseWasm = null;
    await ready(); await silent(); assert.equal(await page.locator('#subtune').inputValue(), '2');
    await page.locator('#applyRsidEnvironment').click(); await ready(); await silent();
    assert.equal(await page.locator('#subtune').inputValue(), '2'); await play(); assert.equal((await read()).subtune, 2);

    check('stale ROM reads and unapplied environment settings never replace accepted firmware');
    await page.evaluate(() => {__sidPlayerAudit.holdFileName = 'slow-old-chars.bin';});
    await page.locator('#romChars').setInputFiles({name: 'slow-old-chars.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4096, 0x55)});
    await page.waitForFunction(() => typeof __sidPlayerAudit.releaseFile === 'function');
    assert.equal(await page.locator('#applyRsidEnvironment').isDisabled(), true);
    const acceptedFileInfo = await page.locator('#fileInfo').textContent();
    await loadFile(fixtures.rsidBasic, 'candidate-during-rom-read.rsid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /finish reading/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#fileInfo').textContent(), acceptedFileInfo);
    assert.equal((await read()).playing, true); assert.equal((await read()).subtune, 2); await sound();
    await page.locator('#romChars').setInputFiles({name: 'latest-chars.bin', mimeType: 'application/octet-stream', buffer: Buffer.from(fixtures.roms.chars)});
    await page.waitForFunction(() => document.querySelector('#romCharsInfo').textContent.includes('latest-chars.bin'));
    await page.waitForFunction(() => !document.querySelector('#applyRsidEnvironment').disabled);
    await page.evaluate(() => __sidPlayerAudit.releaseFile()); await page.waitForTimeout(100);
    assert.match(await page.locator('#romCharsInfo').textContent(), /latest-chars\.bin/); assert.equal((await read()).playing, true);
    await stop(); await page.locator('#rsidEnvironment').selectOption({value: 'minimal'});
    await play(); state = await read(); assert.equal(state.environment, 'rom'); assert.equal(state.subtune, 2);
    assert.equal(state.registers[0] | state.registers[1] << 8, fixtures.basicFrequencies[1]);
    await page.locator('#rsidEnvironment').selectOption({value: 'rom'});

    check('invalid ROM replacement keeps prior firmware and audio; Stop cancels RSID-specific startup');
    const charsInfo = await page.locator('#romCharsInfo').textContent();
    await page.locator('#romChars').setInputFiles({name: 'wrong-size.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4095)});
    await page.waitForFunction(() => /Previous ROM kept/.test(document.querySelector('#romStatus').textContent));
    assert.equal(await page.locator('#romCharsInfo').textContent(), charsInfo); assert.equal((await read()).playing, true); await sound(); await stop();
    const starts = await page.evaluate(() => __sidPlayerAudit.messages.filter(message => message.method === 'start').length);
    holdWasm = true; await page.locator('#play').click();
    for (let i = 0; !releaseWasm && i < 120; ++i) await page.waitForTimeout(25);
    assert(releaseWasm); await page.locator('#stop').click(); releaseWasm(); releaseWasm = null; await ready(); await silent();
    await page.waitForTimeout(100); assert.equal(await page.evaluate(() => __sidPlayerAudit.messages.filter(message => message.method === 'start').length), starts);
    await play(); assert.equal((await read()).subtune, 2); await stop();

    check('PSID and RSID backend switching keeps output ownership and never stores supplied ROMs');
    await loadDemo('tone'); await play(); assert.equal((await read()).format, 'PSID'); await stop();
    await page.locator('#rsidEnvironment').selectOption({value: 'minimal'}); await page.locator('#assumeRsid').uncheck();
    await loadDemo('rsid-irq', 'rsid cia-irq'); await play(); assert.equal((await read()).format, 'RSID'); await stop();
    assert.deepEqual(await page.evaluate(() => ({local: Object.keys(localStorage), session: Object.keys(sessionStorage)})), {local: [], session: []});

    check('Auto selects the actual 8580 core for authored VBI, CIA and RSID without fabricating envelope values');
    await page.locator('#rsidEnvironment').selectOption({value: 'minimal'}); await page.locator('#vbiBackend').selectOption({value: 'c64'});
    await page.locator('#assumeRsid').check();
    measurements.models8580 = {};
    for (const [profile, bytes, format, timing] of [
      ['vbi', fixtures.machine8580Vbi, 'PSID', 'vbi'], ['cia', fixtures.machine8580Cia, 'PSID', 'cia'], ['rsid', fixtures.machine8580Rsid, 'RSID', 'c64-irq'],
    ]) {
      await loadFile(bytes, `model-8580-${profile}.sid`); await ready(); await silent();
      assert.match(await page.locator('#fileInfo').textContent(), /Header pal \/ 8580 → PAL \/ 8580/);
      assert.match(await page.locator('#runningModel').textContent(), /8580/); assert.match(await page.locator('#modelNote').textContent(), /preview/i);
      await play(); state = await read(); assert.equal(state.model, '8580'); assert.equal(state.backend, 'c64');
      assert.equal(state.format, format); assert.equal(state.timing, timing); assert.equal(state.declaredModel, '8580');
      assert.equal(state.cycles, state.sidCycles); assert.equal(state.profileBits, 0); assert.equal(state.perCycleJavaScriptCallbacks, 0);
      assert.equal(state.voices[0].envelope, null); assert.equal(state.voices[0].phase, null);
      await page.waitForFunction(() => [...document.querySelectorAll('#voices tr')].every(row => row.cells[5].textContent === '—'));
      measurements.models8580[profile] = {model: state.model, format: state.format, timing: state.timing,
        irqCount: state.irqCount, playCalls: state.playCalls, output: await sample(), envelopeUnavailable: true};
      if (profile === 'vbi' && config.screenshots) {
        for (const width of [1180, 390]) {
          await page.setViewportSize({width, height: width === 390 ? 844 : 1000}); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(100);
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '8580 controls fit a narrow viewport');
          await page.screenshot({path: path.join(config.screenshots, `${name}-8580-${width}.png`), fullPage: true});
        }
        await page.setViewportSize({width: 1180, height: 1000});
      }
      await stop();
    }

    check('manual model changes retry unknown headers without rewriting them, preserving subtune and requiring Play');
    await loadFile(fixtures.psidUnknown, 'model-choice-unknown.sid'); await ready(); await page.locator('#subtune').selectOption({value: '2'}); await ready();
    await play(); state = await read(); assert.equal(state.model, '6581'); assert.equal(state.subtune, 2);
    for (const model of ['8580', '6581']) {
      await page.locator('#sidModel').selectOption({value: model}); await ready(); await silent();
      assert.equal(await page.locator('#subtune').inputValue(), '2');
      assert.match(await page.locator('#fileInfo').textContent(), new RegExp(`Header unknown / unknown → PAL / ${model}`));
      await play(); state = await read(); assert.equal(state.model, model); assert.equal(state.subtune, 2);
      assert.equal(state.declaredModel, 'unknown'); assert.equal(state.declaredClock, 'unknown');
      assert.equal(state.registers[0] | state.registers[1] << 8, fixtures.frequencies[1]);
    }

    check('known-model mismatch keeps current audio and Auto retries the original declared 8580 file');
    const beforeMismatch = await page.locator('#fileInfo').textContent();
    await loadFile(fixtures.machine8580Vbi, 'known-8580-model-mismatch.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /6581|8580/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#fileInfo').textContent(), beforeMismatch); assert.equal((await read()).model, '6581'); await sound();
    await page.locator('#sidModel').selectOption({value: 'auto'}); await ready(); await silent(); await play();
    state = await read(); assert.equal(state.model, '8580'); assert.equal(state.declaredModel, '8580');
    const knownInfo = await page.locator('#fileInfo').textContent();
    await page.locator('#sidModel').selectOption({value: '6581'});
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error');
    assert.equal(await page.locator('#fileInfo').textContent(), knownInfo); assert.equal((await read()).model, '8580'); await sound();
    assert.equal(await page.locator('#sidModel').inputValue(), '6581', 'a failed choice remains a draft until recovery or Stop');
    await page.locator('#subtune').selectOption({value: '2'}); await ready(); await silent();
    assert.equal(await page.locator('#sidModel').inputValue(), 'auto', 'successful subtune recovery restores the accepted model choice');
    assert.equal(await page.locator('#subtune').inputValue(), '2'); await play();
    state = await read(); assert.equal(state.model, '8580'); assert.equal(state.subtune, 2);
    await page.locator('#sidModel').selectOption({value: '6581'});
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error');
    assert.equal((await read()).model, '8580'); await sound(); await stop();
    assert.equal(await page.locator('#sidModel').inputValue(), 'auto', 'Stop restores the accepted model choice after a failed draft');
    assert.equal(await page.locator('#subtune').inputValue(), '2'); await play();
    state = await read(); assert.equal(state.model, '8580'); assert.equal(state.subtune, 2);
    measurements.models8580.rejectedChoiceRecovery = {subtune: 2, acceptedChoice: 'auto', subtuneRestoredChoice: true, stopRestoredChoice: true};

    check('failed 8580 POT preflight preserves the active model and Stop cancels paired-WASM startup');
    const accepted8580Info = await page.locator('#fileInfo').textContent(), beforePot = await read();
    await loadFile(fixtures.machine8580Pot, 'unsupported-8580-pot.sid');
    await page.waitForFunction(() => document.querySelector('#status').dataset.state === 'error' && /POT|D419/.test(document.querySelector('#status').textContent));
    assert.equal(await page.locator('#fileInfo').textContent(), accepted8580Info);
    state = await read(); assert.equal(state.model, '8580'); assert(state.cycles >= beforePot.cycles); await sound();
    await stop(); const starts8580 = await page.evaluate(() => __sidPlayerAudit.messages.filter(message => message.method === 'start').length);
    holdWasm = true; await page.locator('#play').click();
    for (let i = 0; !releaseWasm && i < 120; ++i) await page.waitForTimeout(25);
    assert(releaseWasm, '8580 startup reached its held WASM request'); await page.locator('#stop').click(); releaseWasm(); releaseWasm = null;
    await ready(); await silent(); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => __sidPlayerAudit.messages.filter(message => message.method === 'start').length), starts8580);
    await play(); assert.equal((await read()).model, '8580'); await stop();

    // Keep the existing final layout/ROM controls check on its 6581 path.
    await loadDemo('tone'); await ready();

    check('one passive waveform/spectrum monitor and compact desktop/mobile player stay entirely local');
    assert.equal(await page.locator('#outputCanvas').count(), 1);
    await page.locator('[data-view="spectrum"]').click(); assert.equal(await page.locator('[data-view="spectrum"]').getAttribute('aria-pressed'), 'true');
    if (!await page.locator('#rsidSettings').evaluate(details => details.open)) await page.locator('#rsidSettings > summary').click();
    await page.locator('#rsidEnvironment').selectOption({value: 'rom'}); // Show all optional inputs; do not change the accepted tune.
    assert.equal(await page.locator('#romFiles').isVisible(), true);
    measurements.layouts = [];
    for (const width of [1180, 390]) {
      await page.setViewportSize({width, height: width === 390 ? 844 : 1000}); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(100);
      const layout = await page.evaluate(() => ({width: innerWidth, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        iconLoaded: document.querySelector('.identity img').naturalWidth, voices: document.querySelectorAll('#voices tr').length,
        romFilesVisible: !document.querySelector('#romFiles').hidden && document.querySelector('#rsidSettings').open}));
      assert.equal(layout.overflow, 0); assert.equal(layout.iconLoaded, 1254); assert.equal(layout.voices, 3); measurements.layouts.push(layout);
      assert.equal(layout.romFilesVisible, true);
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
  const {createSidPlayerTestFixture, SID_PLAYER_TEST_FREQUENCIES, createSidPlayerPalFixture, createSidPlayerBankEnvironmentFixture,
    createSidPlayerJamFixture, createSidPlayerIndexedStoreFixture} = await import(pathToFileURL(path.resolve(__dirname, '../test/helpers/sid_player_fixtures.mjs')));
  const {createPsidCiaFixture} = await import(pathToFileURL(path.resolve(__dirname, '../test/helpers/psid_cia_fixtures.mjs')));
  const {createRsidFixture, createRsidBasicFixture} = await import(pathToFileURL(path.resolve(__dirname, '../test/helpers/rsid_fixtures.mjs')));
  const {createRsidTestRoms} = await import(pathToFileURL(path.resolve(__dirname, '../test/helpers/rsid_test_roms.mjs')));
  const {createPsidVbiMachineFixture} = await import(pathToFileURL(path.resolve(__dirname, '../test/helpers/psid_vbi_machine_fixtures.mjs')));
  const {createSid8580MachineFixture} = await import(pathToFileURL(path.resolve(__dirname, '../test/helpers/sid8580_machine_fixtures.mjs')));
  const unknown = createRsidFixture().bytes.slice(), ntsc = createRsidFixture().bytes.slice(), basic = createRsidBasicFixture();
  new DataView(unknown.buffer).setUint16(118, 0); new DataView(ntsc.buffer).setUint16(118, 0x18);
  const psidChoices = [0, 0x3c, 0x18, 0x24].map(flags => {const bytes = createSidPlayerTestFixture(); new DataView(bytes.buffer).setUint16(118, flags); return bytes;});
  const ciaFixture = createPsidCiaFixture(), ciaRomFixture = createPsidCiaFixture({fault: 'init-rom'});
  const ciaSelected = ciaFixture.bytes.slice(); new DataView(ciaSelected.buffer).setUint16(16, 2);
  const ciaRoms = createRsidTestRoms();
  ciaRoms.kernal.set([0x48, 0x8a, 0x48, 0x98, 0x48, 0x6c, 0x14, 0x03], 0xff48 - 0xe000);
  ciaRoms.kernal[0x1ffe] = 0x48; ciaRoms.kernal[0x1fff] = 0xff;
  const relocated = createPsidCiaFixture({driverRange: [0x20, 1], protectLegacy: true}).bytes;
  const noDriver = createPsidCiaFixture({driverRange: [255, 0]}).bytes;
  const overlap = relocated.slice(), invalidSentinel = noDriver.slice(); overlap[120] = 0x10; invalidSentinel[121] = 1;
  const pal = createSidPlayerPalFixture(), bank = createSidPlayerBankEnvironmentFixture({playAddress: 0xc000});
  const machineLong = createPsidVbiMachineFixture({delayBlocks: 6});
  const machine8580Cia = createSid8580MachineFixture('psid-cia');
  const machine8580CiaBytes = machine8580Cia.bytes.slice(); new DataView(machine8580CiaBytes.buffer).setUint16(16, machine8580Cia.subtune);
  new DataView(ciaRomFixture.bytes.buffer).setUint16(16, 2);
  const fixtures = {two: createSidPlayerTestFixture(), rom: createSidPlayerTestFixture('rom-read'), loop: createSidPlayerTestFixture('init-loop'),
    playLoop: createSidPlayerTestFixture('late-play-loop'), frequencies: SID_PLAYER_TEST_FREQUENCIES,
    psidUnknown: psidChoices[0], psidEither: psidChoices[1], psidNtsc: psidChoices[2], psid8580: psidChoices[3],
    psidCia: ciaFixture.bytes, psidCiaSelected: ciaSelected, psidCiaRom: ciaRomFixture.bytes, ciaFrequencies: ciaFixture.frequencies, ciaRoms,
    psidRelocated: relocated, psidNoDriver: noDriver, psidRelocationOverlap: overlap, psidRelocationSentinel: invalidSentinel,
    palEnvironment: pal.bytes, palFrequency: pal.palFrequency, bankEnvironment: bank.bytes, bankInit: bank.initBank, bankPlay: bank.playBank,
    indexedStore: createSidPlayerIndexedStoreFixture().bytes, realVicRead: createSidPlayerIndexedStoreFixture({realIoRead: true}).bytes,
    jam: createSidPlayerJamFixture().bytes, playImmediate: createSidPlayerTestFixture('play-loop'),
    machineVbiLong: machineLong.bytes, machineFrequencies: machineLong.frequencies,
    machineVbiLateRom: createPsidVbiMachineFixture({delayBlocks: 6, fault: 'late-rom'}).bytes,
    machineVbiLateJam: createPsidVbiMachineFixture({delayBlocks: 6, fault: 'late-jam'}).bytes,
    machineVbiTimeout: createPsidVbiMachineFixture({fault: 'init-loop'}).bytes,
    machine8580Vbi: createSid8580MachineFixture('psid-vbi').bytes, machine8580Cia: machine8580CiaBytes,
    machine8580Rsid: createSid8580MachineFixture('rsid-cia-irq').bytes, machine8580Pot: createSid8580MachineFixture('pot-x').bytes,
    rsidBusy: createRsidFixture('busy-loop').bytes, rsidRomRequired: createRsidFixture('rom-required').bytes,
    rsidRaster: createRsidFixture('raster-irq').bytes, rsidNmi: createRsidFixture('cia-nmi').bytes, rsidMultispeed: createRsidFixture('multispeed').bytes,
    rsidUnknown: unknown, rsidNtsc: ntsc, rsidBasic: basic.bytes, basicFrequencies: basic.frequencies, roms: createRsidTestRoms()};
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
