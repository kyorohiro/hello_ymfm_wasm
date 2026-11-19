// SPDX-License-Identifier: BSD-3-Clause
// Focused OPNA ADPCM codec and software-release checks. Physical output is muted.
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
config.out ||= path.join(repo, 'build/fm2608-audio-release-20261119/browser-source.json');
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
  const audit = window.__opnaSineAudit = {contexts:[], meters:[], gates:[], releases:[], cancels:[], writes:[]};
  // Compare the actually stroked decoded waveform with the exported PCM;
  // a separately smoothed preview must not conceal the ADPCM starting shape.
  const canvas = CanvasRenderingContext2D.prototype;
  const begin = canvas.beginPath, move = canvas.moveTo, line = canvas.lineTo, stroke = canvas.stroke;
  canvas.beginPath = function (...args) {
    if (this.canvas.id === 'waveCanvas') this.__opnaPoints = [];
    return begin.apply(this, args);
  };
  for (const [name, original] of [['moveTo', move], ['lineTo', line]]) canvas[name] = function (x, y) {
    if (this.canvas.id === 'waveCanvas') this.__opnaPoints?.push([x, y]);
    return original.call(this, x, y);
  };
  canvas.stroke = function (...args) {
    if (this.canvas.id === 'waveCanvas' && this.strokeStyle === '#76e1cb')
      audit.wavePath = {width:this.canvas.width, height:this.canvas.height, points:this.__opnaPoints};
    return stroke.apply(this, args);
  };
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
    if (message?.type === 'synth-adpcm-release' && message.action === 'release')
      audit.releases.push(JSON.parse(JSON.stringify(message)));
    if (message?.type === 'synth-adpcm-release' && message.action === 'cancel') audit.cancels.push(JSON.parse(JSON.stringify(message)));
    if (message?.type === 'write') audit.writes.push(JSON.parse(JSON.stringify(message)));
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
const graph = page => page.evaluate(() => __opnaSineAudit.read());
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
function sourceWave(shape) {
  return Array.from({length:128}, (_, index) => Math.fround(.6 * (shape === 'sine'
    ? Math.sin(index / 128 * Math.PI * 2) : shape === 'saw' ? index / 128 * 2 - 1 : index < 64 ? 1 : -1)));
}
function floatWave(samples, rate = 33488) {
  const bytes = Buffer.alloc(44 + samples.length * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(32, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 4, 40);
  samples.forEach((value, index) => bytes.writeFloatLE(value, 44 + index * 4));
  return bytes;
}
async function importWave(page, shape) {
  const name = 'same-' + shape + '-float32.wav';
  await page.locator('#audioFileInput').setInputFiles({name, mimeType:'audio/wav', buffer:floatWave(sourceWave(shape))});
  await until(() => page.locator('#audioStatus').textContent().then(value =>
    value.includes('Loaded ' + name + ' as ADPCM-B')), 'Float32 WAV import ' + shape);
}
async function codecTrial(page, shape, imported, engine, images) {
  if (imported) await importWave(page, shape); else await chooseShape(page, shape);
  const wave = await exportWave(page), samples = sourceWave(shape);
  assert.equal(wave.samples.length, 128); assert(Math.abs(wave.rate - 33488) <= 1);
  const sourceRate = imported ? 33488 : 440 * 2 ** ((60 - 69) / 12) * 128;
  const reference = await page.evaluate(async ({samples, sourceRate}) => {
    const entry = [...document.scripts].find(script => /\/synth\.js$/.test(new URL(script.src).pathname));
    if (!entry) throw Error('Actual synth module entry is missing');
    const {encodeAdpcmB} = await import(new URL('../js/adpcm_b_sample.js', entry.src));
    const {decodeAdpcm} = await import(new URL('preset.js', entry.src));
    const actualRate = Math.round(sourceRate * 144 * 65536 / 8000000) * 8000000 / (144 * 65536);
    const target = samples.map((_, index) => {
      const position = Math.min(index * sourceRate / actualRate, samples.length - 1);
      const first = Math.floor(position), fraction = position - first;
      return samples[first] * (1 - fraction) + samples[Math.min(first + 1, samples.length - 1)] * fraction;
    });
    const baseline = Array.from(decodeAdpcm(encodeAdpcmB({channels:[Float32Array.from(samples)],sampleRate:sourceRate},actualRate).bytes));
    return {target, baseline, actualRate};
  }, {samples, sourceRate});
  const error = (pcm, offset = 0) => {
    const values = pcm.slice(offset).map((value, index) => value - reference.target[index + offset]);
    return {max:Math.max(...values.map(Math.abs)), rms:Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)};
  };
  const actual = error(wave.samples), baseline = error(reference.baseline);
  assert(actual.rms <= baseline.rms + .00002, shape + ' fresh decoded RMS must not regress from shared greedy: ' + JSON.stringify({actual,baseline}));
  assert(actual.max < (shape === 'sine' ? .012 : .65), shape + ' explicit maximum error bound: ' + JSON.stringify(actual));
  assert(Math.abs(wave.samples[0]) < .01, 'bounded decoder starting step');
  const canvasError = await page.evaluate(samples => {
    const plot = __opnaSineAudit.wavePath;
    if (!plot || plot.points.length !== plot.width) throw Error('Decoded canvas path is missing');
    return Math.max(...plot.points.map(([x, y]) => Math.abs(
      1 - 2 * y / plot.height - samples[Math.floor(x * samples.length / plot.width)])));
  }, wave.samples);
  assert(canvasError < .00004, 'canvas represents exported decoded PCM: ' + canvasError);
  assert.match(await page.locator('#sampleInfo').textContent(), /Root C4 · aligned range 0–64/);
  const label = (imported ? 'wav-' : 'generated-') + shape;
  const imagePath = path.join(path.dirname(config.out), 'images', engine + '-' + label + '.png');
  await fs.mkdir(path.dirname(imagePath), {recursive:true});
  await page.locator('#waveCanvas').screenshot({path:imagePath}); images[label] = {path:imagePath,sha256:sha(await fs.readFile(imagePath))};
  return {shape,route:imported?'Float32 WAV import':'Software waveform button',rate:wave.rate,
    exactRate:reference.actualRate,frames:128,first:wave.samples.slice(0,8),actualError:actual,
    sharedGreedyError:baseline,afterFirst16:{actual:error(wave.samples,16),sharedGreedy:error(reference.baseline,16)},
    rmsImprovement:1-actual.rms/baseline.rms,canvasError,wavSha256:wave.sha256};
}
async function noteKey(page, note = 'C4') {
  return page.locator('#keyboard .key').evaluateAll((nodes, note) => {
    const key = nodes.find(node => node.querySelector('span')?.textContent === note);
    if (!key) throw Error(note + ' key is missing'); return key.dataset.key;
  }, note);
}
function releaseProfile(events) {
  assert.equal(events.length, 1, 'one receiver-relative musical release request');
  const [request] = events;
  assert.equal(request.type, 'synth-adpcm-release');
  assert.equal(request.action, 'release');
  assert.match(request.owner, /^fm2608-adpcm-release:\d+$/);
  assert.equal(request.durationSeconds, .008);
  assert(!('performance' in request) && !('commands' in request), 'no sender-clock deadlines or register burst');
  return {requests:1,durationSeconds:.008,receiverRelative:true,owner:request.owner};
}
async function keyTrial(page, key, screen = false, shape = 'sine') {
  await page.evaluate(() => document.activeElement?.blur());
  const before = (await graph(page)).releases;
  if (screen) {
    const node = page.locator('#keyboard .key[data-key="' + key + '"]');
    await node.scrollIntoViewIfNeeded(); const box = await node.boundingBox(); assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  } else await page.keyboard.down(key);
  await until(() => graph(page).then(value => value.audio.rms > .01), 'actual ' + shape + ' keyboard PCM');
  await wait(110); const held = await graph(page);
  assert(held.physicalOutputMuted && held.audio.rms > .01 && held.audio.peak < 1);
  assert(held.audio.maxStep < (shape === 'sine' ? .04 : .4), JSON.stringify(held));
  if (screen) await page.mouse.up(); else await page.keyboard.up(key);
  await until(() => graph(page).then(value => value.releases - before === 1), 'single audio-owned release request');
  await quiet(page);
  const events = await page.evaluate(before => __opnaSineAudit.releases.slice(before), before);
  assert.equal(await page.locator('#keyboard .key.is-active').count(), 0);
  return {held:held.audio, release:releaseProfile(events)};
}
async function retriggerTrial(page, key) {
  const next = await noteKey(page, 'D4');
  await page.evaluate(() => document.activeElement?.blur());
  const before = (await graph(page)).releases;
  await page.keyboard.down(key); await until(() => graph(page).then(value => value.audio.rms > .01), 'first Sine');
  // Dispatch the two handlers in one browser turn, so automation transport
  // latency cannot let the complete 8 ms old tail elapse before the retrigger.
  await page.evaluate(({key, next}) => {
    document.body.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles:true}));
    document.body.dispatchEvent(new KeyboardEvent('keydown', {key:next, bubbles:true}));
  }, {key, next});
  await wait(100);
  const held = await graph(page);
  assert(held.audio.rms > .01 && held.physicalOutputMuted, 'old tail cannot stop retrigger');
  const owner = await page.evaluate(before => __opnaSineAudit.releases[before]?.owner, before);
  assert(owner, 'old release was queued');
  assert(await page.evaluate(owner => __opnaSineAudit.cancels.some(item => item.owner === owner), owner));
  await page.evaluate(key => document.body.dispatchEvent(new KeyboardEvent('keyup', {key, bubbles:true})), next);
  await page.keyboard.up(key); await quiet(page);
  assert.equal(await page.locator('#keyboard .key.is-active').count(), 0);
  return {held:held.audio, cancelledOwner:owner};
}
async function codeStopTrial(page, musical = false) {
  const method = musical ? 'noteOff' : 'keyOff';
  const before = (await graph(page)).releases;
  await page.locator('#synthInputCodeTab').click();
  await page.locator('#synthCodeEditor').waitFor({state:'visible'});
  await page.locator('#synthCodeEditor').fill(`const opna = await useSoundChip("ym2608");
setBpm(120);
opna.adpcm.keyOn({repeat:true});
log("raw-sine-on");
await beat(1);
opna.adpcm.${method}();
log("raw-sine-off");
liveLoop("raw-hold", async () => { await beat(1); });
`);
  await page.locator('#synthCodeRunButton').click();
  await until(() => page.locator('#synthCodeLog').textContent().then(text => text.includes('raw-sine-on')), 'raw keyOn');
  await until(() => graph(page).then(value => value.audio.rms > .01), 'raw keyOn PCM');
  await until(() => page.locator('#synthCodeLog').textContent().then(text => text.includes('raw-sine-off')), 'raw keyOff');
  await quiet(page);
  const events = await page.evaluate(before => __opnaSineAudit.releases.slice(before), before);
  if (musical) releaseProfile(events);
  else assert.equal(events.length, 0, 'raw keyOff does not schedule musical release');
  assert.equal(await page.locator('#synthCodeError').textContent(), '');
  await page.locator('#synthCodeStopButton').click();
  await until(() => page.locator('#synthCodeState').textContent().then(text => /Stopped|Idle/.test(text)), 'Code Stop');
  await page.locator('#synthInputKeyboardTab').click();
  return musical ? {release:releaseProfile(events),silence:true} : {releaseBatches:0,rawStopPreserved:true};
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

    const key = await noteKey(page);
    measurements.waveforms = [];
    for (const shape of ['sine','saw','square']) for (const imported of [false,true]) {
      stage = (imported ? 'Float32 WAV ' : 'Software ') + shape + ' decoded codec/canvas';
      const measured = await codecTrial(page,shape,imported,engine,images);
      measurements.waveforms.push(measured);
      stage += ' computer/screen musical release';
      measured.computer = await keyTrial(page,key,false,shape);
      measured.screen = await keyTrial(page,key,true,shape);
    }
    checks[0] += '; Sine/Saw/Square buttons and identical Float32 WAVs preserve decoded sample/canvas/export parity and bounded error against shared greedy';
    stage = 'Imported Saw Code noteOff'; await importWave(page,'saw');
    measurements.codeMusical = await codeStopTrial(page,true);
    checks.push('Sine/Saw/Square button/WAV computer and screen keys plus imported Saw Code noteOff send one receiver-relative release request and reach silence');

    stage = 'Sine rapid retrigger'; await chooseShape(page,'sine');
    measurements.retrigger = await retriggerTrial(page, key);
    checks.push('A rapid second key cancels the former release owner and remains audible after its old deadline');

    stage = 'raw Code keyOff'; measurements.raw = await codeStopTrial(page);
    checks.push('Raw Code keyOff remains immediate without a musical fade reservation');
    const final = await graph(page); assert.equal(final.contexts, 1); assert(final.rates.every(rate => rate === 48000));
    assert(final.physicalOutputMuted); measurements.graph = final;
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
      for (const key of ['synth.js', 'preset.js', 'audio.js', 'adpcm_encoder.js', 'adpcm_noteoff_guard.js',
        'adpcm_audio_release.js', 'adpcm_audio_receiver.js', 'audio_worklet.js']) assert(matched.includes(key), key);
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
