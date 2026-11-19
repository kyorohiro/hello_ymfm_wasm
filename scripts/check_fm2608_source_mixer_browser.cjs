// SPDX-License-Identifier: BSD-3-Clause
// Real OPNA source-fader integration. Every connection to speakers is muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repo = path.resolve(__dirname, '..'), started = Date.now();
const config = {root:path.join(repo, 'docs'), entry:'/synth-fm2608/index.html',
  engines:'chromium,webkit', out:path.join(repo, 'build/fm2608-source-mixer-20261119/browser-source.json'), compare:''};
for (let i = 2; i < process.argv.length; i++) {
  const option = /^--(root|entry|engines|out|compare)(?:=(.+))?$/.exec(process.argv[i]);
  assert(option, 'Unknown option ' + process.argv[i]);
  config[option[1]] = option[2] ?? process.argv[++i];
}
config.root = path.resolve(config.root);
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const sources = {fm:'Fm', ssg:'Ssg', rhythm:'Rhythm', adpcm:'Adpcm'};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = new Map(), sourceErrors = [], results = [];
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.wasm':'application/wasm', '.json':'application/json', '.webp':'image/webp', '.svg':'image/svg+xml'};
const server = http.createServer(async (request, response) => {
  try {
    let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(config.root, '.' + name);
    assert(file.startsWith(config.root + path.sep));
    const bytes = await fs.readFile(file), key = path.relative(config.root, file).split(path.sep).join('/');
    const value = {bytes:bytes.length, sha256:sha(bytes)};
    if (assets.has(key) && assets.get(key).sha256 !== value.sha256) {
      sourceErrors.push('Changed served asset ' + key); throw Error(sourceErrors.at(-1));
    }
    assets.set(key, value);
    response.writeHead(200, {'Content-Type':mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control':'no-store'}).end(bytes);
  } catch { response.writeHead(404).end(); }
});

function installAudit() {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  const audit = window.__sourceMixerAudit = {contexts:[], meters:[], messages:[]};
  window.AudioContext = class extends Context {
    constructor(options = {}) { super({...options, sampleRate:48000}); audit.contexts.push(this); }
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 4096; mute.gain.value = 0;
    connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
    audit.meters.push({analyser, mute}); return destination;
  };
  MessagePort.prototype.postMessage = function (message, ...args) {
    if (message && ['write', 'write-batch', 'writes', 'source-gains', 'output-gains'].includes(message.type))
      audit.messages.push(JSON.parse(JSON.stringify(message)));
    return post.call(this, message, ...args);
  };
  audit.read = () => {
    const values = audit.meters.map(({analyser}) => {
      const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
      const mean = pcm.reduce((sum, value) => sum + value, 0) / pcm.length;
      let square = 0, peak = 0;
      for (const value of pcm) {
        if (!Number.isFinite(value)) throw Error('Non-finite mixer output');
        square += (value - mean) ** 2; peak = Math.max(peak, Math.abs(value));
      }
      return {rms:Math.sqrt(square / pcm.length), peak};
    });
    return {contexts:audit.contexts.length, sampleRates:audit.contexts.map(value => value.sampleRate),
      physicalOutputMuted:audit.meters.every(value => value.mute.gain.value === 0),
      rms:Math.max(0, ...values.map(value => value.rms)), peak:Math.max(0, ...values.map(value => value.peak))};
  };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value; await wait(25); }
  throw Error('Timed out: ' + label);
}
const graph = page => page.evaluate(() => __sourceMixerAudit.read());
async function quiet(page) { return until(() => graph(page).then(value => value.peak < 1e-7 && value), 'all source outputs muted'); }
async function audible(page) { return until(() => graph(page).then(value => value.rms > 1e-5 && value), 'source remains audible'); }
async function peakRms(page) {
  await wait(150);
  let maximum = 0;
  for (let trial = 0; trial < 10; trial++) { maximum = Math.max(maximum, (await graph(page)).rms); await wait(40); }
  return maximum;
}
async function readFaders(page) {
  return page.evaluate(() => Object.fromEntries(['Fm', 'Ssg', 'Rhythm', 'Adpcm'].map(id =>
    [id.toLowerCase(), Number(document.getElementById('mixer' + id + 'Volume').value)])));
}
async function fader(page, source, value, {visible = true} = {}) {
  const id = sources[source];
  const previous = Number(await page.locator('#mixer' + id + 'Volume').inputValue());
  const sent = await page.locator('#mixer' + id + 'Volume').evaluate((node, value) => {
    const start = __sourceMixerAudit.messages.length;
    node.focus(); node.value = String(value); node.dispatchEvent(new Event('input', {bubbles:true}));
    return __sourceMixerAudit.messages.slice(start);
  }, value);
  assert(!sent.some(message => ['write', 'write-batch', 'writes'].includes(message.type)),
    source + ' fader must not emit instrument register writes');
  const messages = sent.filter(message => message.type === 'source-gains');
  if (previous !== value) assert(messages.length, source + ' fader sends the independent source-gains protocol');
  assert(!sent.some(message => message.type === 'output-gains'), 'legacy bus gain protocol must stay separate');
  for (const message of messages) assert.equal(message.gains[source], value);
  assert.equal(Number(await page.locator('#mixer' + id + 'Volume').inputValue()), value);
  assert.equal(await page.locator('#mixer' + id + 'Value').textContent(), Math.round(value * 100) + '%');
  assert.equal(await page.locator('#mixer' + id + 'Volume').getAttribute('data-boosted'), String(value > 1));
  if (visible) assert(await page.locator('#mixer' + id + 'Volume').isVisible());
}
async function faders(page, values) { for (const [source, value] of Object.entries(values)) await fader(page, source, value); }

async function fixtures() {
  const url = name => pathToFileURL(path.join(repo, 'docs', name)).href;
  const [{YM2608Synth}, {createDefaultPreset, readFmPreset, FM_PRESETS}] = await Promise.all([
    import(url('js/ym2608synth.js')), import(url('synth-fm2608/preset.js'))]);
  const preset = readFmPreset(FM_PRESETS.sine); preset.operators[3].tl = 40;
  const sample = Buffer.from(createDefaultPreset().adpcm.data, 'base64'), writes = [];
  const chip = new YM2608Synth({transport:{write:(port, register, value) => writes.push([port, register, value])}});
  chip.setPreset(0, preset); chip.noteOn(0, 'C4'); chip.ssg.tone(0, {frequency:330, volume:4});
  chip.rhythm.setVolume(40); chip.rhythm.setVoice(0, {volume:18, left:true, right:true}); chip.rhythm.keyOn(0);
  chip.adpcm.setSample({start:256, end:256 + sample.length}); chip.adpcm.setPlaybackRate(22050);
  chip.adpcm.setVolume(96); chip.adpcm.setPan(true, true); chip.adpcm.keyOn({repeat:true});
  const block = Buffer.alloc(15 + sample.length); block.set([0x67, 0x66, 0x81]);
  block.writeUInt32LE(8 + sample.length, 3); block.writeUInt32LE(0x200000, 7); block.writeUInt32LE(256, 11); sample.copy(block, 15);
  const commands = [...block, ...writes.flatMap(([port, register, value]) => [0x56 + port, register, value])];
  for (let step = 0; step < 120; step++) commands.push(0x56, 0x10, 1, 0x61, 0x11, 0x2b); // 1/4 second
  commands.push(0x66);
  const vgm = Buffer.alloc(256 + commands.length); vgm.write('Vgm '); vgm.writeUInt32LE(vgm.length - 4, 4);
  vgm.writeUInt32LE(0x171, 8); vgm.writeUInt32LE(256 - 0x34, 0x34); vgm.writeUInt32LE(8000000, 0x48);
  vgm.writeUInt32LE(30 * 44100, 0x18); vgm.set(commands, 256);
  const code = `const opna = await useSoundChip("ym2608");
await opna.setPreset(CH1, ${JSON.stringify(preset)});
await opna.noteOn(CH1, "C4");
opna.ssg.tone(CH1, {frequency:330, volume:4});
opna.rhythm.setVolume(40);
opna.rhythm.setVoice(0, {volume:18, left:true, right:true});
opna.adpcm.setPlaybackRate(22050);
opna.adpcm.setVolume(96);
opna.adpcm.setPan(true, true);
opna.adpcm.keyOn({repeat:true});
setBpm(120);
liveLoop("mixer-rhythm", async () => { opna.rhythm.keyOn(0); await beat(0.5); });
`;
  return {code, vgm};
}

async function run(browser, engine, origin, fixture) {
  const context = await browser.newContext({viewport:{width:1280, height:1000}, serviceWorkers:'block'});
  await context.addInitScript(installAudit);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const errors = [], missing = [], external = [], blocked = [], checks = [], measurements = {};
  let stage = 'startup';
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    (/monaco|jsdelivr/.test(url.href) ? blocked : external).push(url.href); return route.abort();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) missing.push(response.url()); });
  try {
    await page.goto(origin + config.entry);
    await until(() => page.locator('#opnaSaveSoundAs').isEnabled(), 'default project ready');
    assert.equal((await graph(page)).contexts, 0);
    assert.equal(Number(await page.locator('#masterVolume').inputValue()), .7);
    await page.locator('#tab-mixer').click();
    assert.deepEqual(await readFaders(page), {fm:1, ssg:1, rhythm:1, adpcm:1});
    for (const id of Object.values(sources)) {
      const range = page.locator('#mixer' + id + 'Volume');
      assert.equal(await range.getAttribute('min'), '0'); assert.equal(await range.getAttribute('max'), '3.8');
    }
    checks.push('Untouched Master70% and all four source gains100%; no AudioContext before enabling audio');

    stage = 'keyboard focus and gain continuity';
    await page.locator('#startAudio').click();
    await until(() => page.locator('#startAudio').textContent().then(value => /Audio ready/i.test(value)), 'OPNA audio initialization');
    await faders(page, {fm:.52, ssg:0, rhythm:0, adpcm:0});
    await page.locator('#tab-fm').click(); await page.locator('#fmPreset').selectOption('sine');
    // Mixer deliberately has no keyboard source of its own. Returning to FM
    // must restore keys; changing source-gain handlers must not key off a note.
    await page.locator('#masterVolume').focus();
    const keyCount = await page.evaluate(() => __sourceMixerAudit.messages.filter(value => value.type === 'write' && value.register === 0x28).length);
    await page.keyboard.down('a'); await audible(page);
    assert((await page.evaluate(() => __sourceMixerAudit.messages.filter(value => value.type === 'write' && value.register === 0x28).length)) > keyCount);
    await fader(page, 'fm', 0, {visible:false}); await quiet(page);
    await fader(page, 'fm', .52, {visible:false}); await audible(page);
    await page.keyboard.up('a'); await quiet(page);
    checks.push('Returning from Mixer restores musical keys; focused Master range accepts keyboard notes and source-gain handlers retain a held FM note across mute/unmute');

    stage = 'Code four-source isolation';
    await page.locator('#synthInputCodeTab').click();
    await page.locator('#synthCodeEditor').waitFor({state:'visible'});
    await page.locator('#synthCodeEditor').fill(fixture.code); await page.locator('#synthCodeRunButton').click();
    await until(() => page.locator('#synthCodeState').textContent().then(value => /Playing|Running/.test(value)), 'Code running');
    await page.locator('#tab-mixer').click();
    await faders(page, {fm:0, ssg:0, rhythm:0, adpcm:0}); await quiet(page);
    measurements.isolation = {};
    for (const source of Object.keys(sources)) {
      stage = 'Code ' + source + ' source isolation';
      await fader(page, source, 1); const unity = await peakRms(page); assert(unity > 1e-5, source + ' must produce independent audio');
      await fader(page, source, .5); const half = await peakRms(page), ratio = half / unity;
      assert(Math.abs(ratio - .5) < .09, source + ' half-gain ratio ' + ratio);
      await fader(page, source, 3.8); assert((await graph(page)).physicalOutputMuted);
      await fader(page, source, 0); await quiet(page);
      assert.match(await page.locator('#synthCodeState').textContent(), /Playing|Running/);
      assert.equal(await page.locator('#synthCodeError').textContent(), '');
      measurements.isolation[source] = {unity, half, ratio, zeroSilence:true, registerWritesByFader:0, rangeMaximum:3.8};
    }
    checks.push('Real FM/SSG/Rhythm/ADPCM independently reach silence and half amplitude without instrument register writes or stopping Code');

    stage = 'VGM transport gain retention';
    const retained = {fm:.63, ssg:.42, rhythm:.31, adpcm:.24}; await faders(page, retained);
    await page.locator('#synthCodeStopButton').click();
    await until(() => page.locator('#synthCodeState').textContent().then(value => /Stopped|Idle/.test(value)), 'Code Stop');
    assert.deepEqual(await readFaders(page), retained);
    await page.locator('#songFileInput').setInputFiles({name:'Four source synthetic.vgm', mimeType:'application/octet-stream', buffer:fixture.vgm});
    await until(() => page.locator('#songSelect option').allTextContents().then(values => values.some(value => value.includes('Four source synthetic'))), 'synthetic VGM import');
    await page.locator('#songSelect').selectOption('/vgm/Four source synthetic.vgm');
    await page.locator('#songPlay').click();
    await until(() => page.locator('#referenceSong').getAttribute('data-playback').then(value => value === 'playing'), 'VGM Play');
    await audible(page); assert.deepEqual(await readFaders(page), retained);
    await fader(page, 'rhythm', .35); retained.rhythm = .35;
    assert.equal(await page.locator('#referenceSong').getAttribute('data-playback'), 'playing');
    await page.locator('#songPause').click();
    await until(() => page.locator('#referenceSong').getAttribute('data-playback').then(value => value === 'paused'), 'VGM Pause');
    await until(() => page.locator('#referenceSong').getAttribute('data-manual-ready').then(value => value === 'true'), 'paused audition preparation');
    assert.deepEqual(await readFaders(page), retained);
    await fader(page, 'adpcm', .28); retained.adpcm = .28;
    const pausedPosition = await page.locator('#songSeek').inputValue(); await wait(180);
    assert.equal(await page.locator('#songSeek').inputValue(), pausedPosition);
    await page.locator('#songSeek').evaluate(node => { node.value = '8'; node.dispatchEvent(new Event('change', {bubbles:true})); });
    await until(async () => await page.locator('#referenceSong').getAttribute('data-playback') === 'paused' &&
      Math.abs(Number(await page.locator('#songSeek').inputValue()) - 8) < .05, 'paused VGM seek');
    assert.deepEqual(await readFaders(page), retained);
    await page.locator('#songPlay').click();
    await until(() => page.locator('#songSeek').inputValue().then(value => Number(value) > 8.15), 'VGM Resume');
    await audible(page); assert.deepEqual(await readFaders(page), retained);
    await page.locator('#songSeek').evaluate(node => { node.value = '12'; node.dispatchEvent(new Event('change', {bubbles:true})); });
    await until(async () => await page.locator('#referenceSong').getAttribute('data-playback') === 'playing' &&
      Number(await page.locator('#songSeek').inputValue()) >= 12, 'playing VGM seek');
    assert.deepEqual(await readFaders(page), retained);
    await page.locator('#songStop').click(); await quiet(page); assert.deepEqual(await readFaders(page), retained);
    measurements.retained = retained;
    checks.push('Four independent levels persist through Code Stop, synthetic VGM import/Play/Pause, paused and playing seek, Resume and Stop');

    stage = 'final graph and errors';
    measurements.graph = await graph(page);
    assert.equal(measurements.graph.contexts, 1); assert(measurements.graph.sampleRates.every(value => value === 48000));
    assert(measurements.graph.physicalOutputMuted); assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(external, []);
    return {browser:engine, passed:true, checks, measurements, errors, missing, external, expectedBlockedMonaco:blocked,
      physicalOutputMuted:true, listeningPerformed:false};
  } catch (error) {
    error.receipt = {browser:engine, passed:false, stage, error:error.stack, checks, measurements, errors, missing, external,
      audioStatus:await page.locator('#audioStatus').textContent().catch(() => null),
      codeError:await page.locator('#synthCodeError').textContent().catch(() => null)}; throw error;
  } finally { await context.close(); }
}

(async () => {
  let failure = null, comparison = null;
  try {
    const fixture = await fixtures();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const engine of engines) {
      const browser = await {chromium, webkit}[engine].launch({headless:true,
        ...(engine === 'chromium' ? {args:['--mute-audio']} : {})});
      try { results.push(await run(browser, engine, origin, fixture)); }
      catch (error) { results.push(error.receipt ?? {browser:engine, passed:false, error:error.stack}); throw error; }
      finally { await browser.close(); }
    }
    assert.deepEqual(sourceErrors, []);
    if (config.compare) {
      const previous = JSON.parse(await fs.readFile(config.compare, 'utf8'));
      const canonical = name => name.replace(/^synth-fm2608\//, '');
      const before = new Map(Object.entries(previous.servedAssets).map(([name, value]) => [canonical(name), value])), matched = [];
      for (const [name, value] of assets) {
        const key = canonical(name); if (key.endsWith('.html') || !before.has(key)) continue;
        assert.equal(value.sha256, before.get(key).sha256, key); matched.push(key);
      }
      for (const key of ['synth.js', 'output_mix.js', 'audio.js', 'audio_worklet.js', 'song_player.js',
        'js/ym2608.js', 'js/ym2608synth.js', 'js/ym2608audioengine.js', 'generated/ym2608_wasm.wasm'])
        assert(matched.includes(key), 'Packaged/source asset must match: ' + key);
      comparison = {file:config.compare, matchedAssets:matched.sort(), excluded:'Rewritten standalone HTML entry'};
    }
  } catch (error) { failure = error; }
  finally { server.closeAllConnections?.(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
  const receipt = {schemaVersion:1, passed:!failure, root:config.root, entry:config.entry,
    elapsedSeconds:(Date.now() - started) / 1000, physicalOutputMuted:true, listeningPerformed:false,
    checker:{file:path.relative(repo, __filename), sha256:sha(await fs.readFile(__filename))},
    servedAssets:Object.fromEntries([...assets].sort()), sourceErrors, comparison, results,
    ...(failure ? {error:failure.stack} : {})};
  await fs.mkdir(path.dirname(config.out), {recursive:true}); await fs.writeFile(config.out, JSON.stringify(receipt, null, 2) + '\n');
  if (failure) throw failure; console.log('PASS ' + config.out);
})().catch(error => { console.error(error); process.exitCode = 1; });
