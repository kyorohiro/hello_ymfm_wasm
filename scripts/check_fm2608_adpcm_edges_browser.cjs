// SPDX-License-Identifier: BSD-3-Clause
// Narrow OPNA decoded-wave / keyboard edge checks. Physical output is muted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {chromium, webkit} = require('playwright');

const repo = path.resolve(__dirname, '..'), started = Date.now();
const config = {root:path.join(repo, 'docs'), entry:'/synth-fm2608/index.html',
  engines:'chromium,webkit', out:'', compare:''};
for (let i = 2; i < process.argv.length; i++) {
  const option = /^--(root|entry|engines|out|compare)(?:=(.+))?$/.exec(process.argv[i]);
  assert(option, 'Unknown option ' + process.argv[i]);
  config[option[1]] = option[2] ?? process.argv[++i];
}
config.root = path.resolve(config.root);
config.out ||= path.join(repo, 'build/fm2608-adpcm-edges-20261119/browser-source.json');
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
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
  const audit = window.__opnaEdgeAudit = {contexts:[], meters:[], gates:[], releases:[]};
  window.AudioContext = class extends Context {
    constructor(options = {}) { super({...options, sampleRate:48000}); audit.contexts.push(this); }
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const meter = this.context.createAnalyser(), mute = this.context.createGain();
    meter.fftSize = 4096; mute.gain.value = 0;
    connect.call(this, meter); connect.call(this, mute); connect.call(mute, destination);
    audit.meters.push(meter); audit.gates.push(mute); return destination;
  };
  MessagePort.prototype.postMessage = function (message, ...args) {
    if (message?.performance?.owner?.startsWith('fm2608-adpcm-release:'))
      audit.releases.push(JSON.parse(JSON.stringify(message)));
    return post.call(this, message, ...args);
  };
  audit.read = () => {
    const values = audit.meters.map(meter => {
      const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
      let peak = 0, square = 0, maxStep = 0;
      for (let i = 0; i < pcm.length; i++) {
        if (!Number.isFinite(pcm[i])) throw Error('Non-finite OPNA output');
        peak = Math.max(peak, Math.abs(pcm[i])); square += pcm[i] ** 2;
        if (i) maxStep = Math.max(maxStep, Math.abs(pcm[i] - pcm[i - 1]));
      }
      return {peak, rms:Math.sqrt(square / pcm.length), maxStep};
    }).sort((a, b) => b.rms - a.rms);
    return {contexts:audit.contexts.length, rates:audit.contexts.map(context => context.sampleRate),
      physicalOutputMuted:audit.gates.every(gain => gain.gain.value === 0),
      releases:audit.releases.length, audio:values[0] ?? {peak:0, rms:0, maxStep:0}};
  };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value; await wait(25); }
  throw Error('Timed out: ' + label);
}
const graph = page => page.evaluate(() => __opnaEdgeAudit.read());
async function quiet(page) { await until(() => graph(page).then(value => value.audio.peak < 1e-7), 'released PCM silence'); }
async function downloadBytes(download) {
  const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function exportWave(page) {
  const pending = page.waitForEvent('download'); await page.locator('#saveWaveButton').click();
  const bytes = await downloadBytes(await pending);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt16LE(34), 16);
  const frames = bytes.readUInt32LE(40) / 2;
  const samples = Array.from({length:frames}, (_, i) => bytes.readInt16LE(44 + i * 2) / 32767);
  return {bytes:bytes.length, sha256:sha(bytes), rate:bytes.readUInt32LE(24), samples};
}
async function chooseShape(page, shape) {
  await page.locator('[data-wave-shape="' + shape + '"]').click();
  await until(() => page.locator('#audioStatus').textContent().then(value =>
    value.includes('Software ' + shape + ' wave encoded')), 'generated ' + shape);
  assert.match(await page.locator('#sampleInfo').textContent(), /128 decoded frames · 64 ADPCM bytes/);
}
async function noteKey(page) {
  return page.locator('#keyboard .key').evaluateAll(nodes => {
    const key = nodes.find(node => node.querySelector('span')?.textContent === 'C4');
    if (!key) throw Error('C4 key is missing'); return key.dataset.key;
  });
}
async function keyTrial(page, key, screen = false) {
  await page.evaluate(() => document.activeElement?.blur());
  const before = (await graph(page)).releases;
  if (screen) {
    const node = page.locator('#keyboard .key[data-key="' + key + '"]');
    await node.scrollIntoViewIfNeeded(); const box = await node.boundingBox(); assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  } else await page.keyboard.down(key);
  await until(() => graph(page).then(value => value.audio.rms > .01), 'actual ADPCM keyboard PCM');
  await wait(110); const held = await graph(page);
  assert(held.physicalOutputMuted && held.audio.rms > .01 && held.audio.peak < 1);
  assert(held.audio.maxStep < .04, JSON.stringify(held));
  if (screen) await page.mouse.up(); else await page.keyboard.up(key);
  await until(() => graph(page).then(value => value.releases - before === 193), 'dense frame-owner release batches at level192');
  await quiet(page); assert.equal(await page.locator('#keyboard .key.is-active').count(), 0);
  return held.audio;
}
async function run(browser, engine, origin) {
  const context = await browser.newContext({viewport:{width:1280, height:1000}, acceptDownloads:true, serviceWorkers:'block'});
  await context.addInitScript(installAudit);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const errors = [], missing = [], external = [], blocked = [], checks = [], measurements = {}, images = {};
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    (/monaco|jsdelivr/.test(url.href) ? blocked : external).push(url.href); return route.abort();
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) missing.push(response.url()); });
  let stage = 'startup';
  try {
    await page.goto(origin + config.entry);
    await until(() => page.locator('#opnaSaveSoundAs').isEnabled(), 'Files and default preset ready');
    assert.equal((await graph(page)).contexts, 0);
    await page.locator('#tab-adpcm').click();
    assert.equal(Number(await page.locator('#masterVolume').inputValue()), .7);
    checks.push('The untouched PC98 Synth opens without an AudioContext and retains default Master70%');

    stage = 'Triangle decoded wave'; await chooseShape(page, 'triangle');
    const triangle = await exportWave(page);
    assert.equal(triangle.samples.length, 128); assert(Math.abs(triangle.rate - 33488) <= 1);
    const target = i => .6 * (1 - 4 * Math.abs((i / 128 + .25) % 1 - .5));
    const errorsOfWave = triangle.samples.map((value, i) => value - target(i));
    const maxError = Math.max(...errorsOfWave.map(Math.abs));
    const rmsError = Math.sqrt(errorsOfWave.reduce((sum, value) => sum + value * value, 0) / 128);
    assert(Math.abs(triangle.samples[0]) < .002 && maxError < .02 && rmsError < .004,
      JSON.stringify({first:triangle.samples.slice(0, 8), maxError, rmsError}));
    assert.match(await page.locator('#sampleInfo').textContent(), /Root C4 · aligned range 0–64/);
    measurements.triangle = {rate:triangle.rate, frames:128, first:triangle.samples.slice(0, 8), maxError, rmsError, wavSha256:triangle.sha256};
    const imagePath = path.join(path.dirname(config.out), 'images', engine + '-triangle.png');
    await fs.mkdir(path.dirname(imagePath), {recursive:true});
    await page.locator('#waveCanvas').screenshot({path:imagePath}); images.triangle = {path:imagePath, sha256:sha(await fs.readFile(imagePath))};
    checks.push('Triangle export/canvas data starts at a zero crossing with128decoded frames,64bytes,RootC4 and unchanged33488Hz tuning');

    stage = 'Triangle keyboard and release';
    const key = await noteKey(page); measurements.triangle.computer = await keyTrial(page, key);
    measurements.triangle.screen = await keyTrial(page, key, true);
    checks.push('Computer and screen C4 Triangle keys emit smooth actual PCM without the old large loop edge, then use193 queued software-release batches at level192 and become silent');

    stage = 'Sine retained'; await chooseShape(page, 'sine');
    const sine = await exportWave(page); assert.equal(sine.samples.length, 128);
    const sineError = Math.max(...sine.samples.map((value, i) => Math.abs(value - .6 * Math.sin(i / 128 * Math.PI * 2))));
    assert(sineError < .04); measurements.sine = {maxError:sineError, audio:await keyTrial(page, key)};
    const final = await graph(page); assert.equal(final.contexts, 1); assert(final.rates.every(rate => rate === 48000));
    assert(final.physicalOutputMuted); measurements.graph = final;
    checks.push('Sine generation and musical keyboard release remain working on one shared48000Hz clock');
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(external, []);
    return {browser:engine, passed:true, checks, measurements, images, errors, missing, external,
      expectedBlockedMonaco:blocked, physicalOutputMuted:true, listeningPerformed:false};
  } catch (error) {
    error.receipt = {browser:engine, passed:false, stage, error:error.stack, checks, measurements,
      errors, missing, external, images}; throw error;
  } finally { await context.close(); }
}
(async () => {
  let failure = null, comparison = null;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const engine of engines) {
      const browser = await {chromium, webkit}[engine].launch({headless:true,
        ...(engine === 'chromium' ? {args:['--mute-audio']} : {})});
      try { results.push(await run(browser, engine, origin)); }
      catch (error) { results.push(error.receipt ?? {browser:engine, passed:false, error:error.stack}); throw error; }
      finally { await browser.close(); }
    }
    assert.deepEqual(sourceErrors, []);
    if (config.compare) {
      const previous = JSON.parse(await fs.readFile(config.compare, 'utf8'));
      const canonical = name => name.replace(/^synth-fm2608\//, '');
      const before = new Map(Object.entries(previous.servedAssets).map(([name, value]) => [canonical(name), value]));
      const matched = [];
      for (const [name, value] of assets) {
        const key = canonical(name); if (key.endsWith('.html') || !before.has(key)) continue;
        assert.equal(value.sha256, before.get(key).sha256, key); matched.push(key);
      }
      for (const key of ['synth.js', 'preset.js', 'audio.js', 'adpcm_noteoff_guard.js']) assert(matched.includes(key), key);
      comparison = {file:config.compare, matchedAssets:matched.sort(), excluded:'Rewritten standalone HTML entry'};
    }
  } catch (error) { failure = error; }
  finally { server.closeAllConnections?.(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
  const receipt = {schemaVersion:1, passed:!failure, root:config.root, entry:config.entry,
    elapsedSeconds:(Date.now() - started) / 1000, physicalOutputMuted:true, listeningPerformed:false,
    checker:{file:path.relative(repo, __filename), sha256:sha(await fs.readFile(__filename))},
    servedAssets:Object.fromEntries([...assets].sort()), sourceErrors, comparison, results,
    ...(failure ? {error:failure.stack} : {})};
  await fs.mkdir(path.dirname(config.out), {recursive:true});
  await fs.writeFile(config.out, JSON.stringify(receipt, null, 2) + '\n');
  if (failure) throw failure; console.log('PASS ' + config.out);
})().catch(error => { console.error(error); process.exitCode = 1; });
