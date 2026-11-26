// SPDX-License-Identifier: BSD-3-Clause
// Focused Analyzer integration proof with real WASM, and zero physical output.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {chromium, webkit} = require('playwright');
const repo = path.resolve(__dirname, '..'), started = Date.now();
const options = {root:path.join(repo, 'docs'), entry:'', engines:'chromium,webkit',
  out:path.join(repo, 'build/analyzer-ym2608-source-mixer-20261119/browser-source.json'), compare:''};
for (let index = 2; index < process.argv.length; index++) {
  const match = /^--(root|entry|engines|out|compare)(?:=(.+))?$/.exec(process.argv[index]);
  assert(match, 'Unknown option ' + process.argv[index]);
  options[match[1]] = match[2] ?? process.argv[++index];
}
options.root = path.resolve(options.root);
const engines = options.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const key = 'tetorica-vgm-analyzer.audio.v1', parts = ['fm', 'ssg', 'rhythm', 'adpcm'];
const defaults = () => Object.fromEntries(parts.map(part => [part, {gain:1, muted:false}]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = new Map(), sourceErrors = [], results = [];
const canonical = name => name.replace(/^vgm_analyzer\//, '');
const normalized = bytes => Buffer.from(bytes.toString().replace(/\.\.\/(js|generated|playground)\//g, './$1/'));
const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'};

// Appended only by this server, leaving production files unchanged.
const hook = `
let __sourceConfig = null, __sourceFrames = 0, __sourceViews = 0, __sourceWrites = 0;
let __sourceWorklets = 0, __sourceSets = 0;
const __sourceObserved = new WeakSet();
const __sourceLoad = mixerUi.load;
mixerUi.load = configuration => {__sourceConfig = configuration; return __sourceLoad(configuration);};
function __findOpna(part) {
  if (!part) return null;
  if (part.ym2608) return part.ym2608;
  if (part.mixerEngine) return __findOpna(part.mixerEngine);
  for (const entry of part.entries?.values?.() ?? []) {const chip = __findOpna(entry.engine); if (chip) return chip;}
  for (const entry of part.playbackMixerSources ?? []) if (entry.id === 'ym2608') return entry.source;
  return null;
}
const __sourceAttach = mixerUi.attach;
mixerUi.attach = mixer => {
  if (engine && !__sourceObserved.has(engine)) {
    __sourceObserved.add(engine);
    const render = engine.processFrames.bind(engine);
    engine.processFrames = frames => {__sourceFrames += frames; return render(frames);};
    const chip = __findOpna(engine);
    if (chip) {
      const prior = chip.hooks?.onWrite;
      chip.setHooks({...chip.hooks, onWrite:value => {__sourceWrites++; prior?.(value);}});
      const view = chip.generateStereoView.bind(chip);
      chip.generateStereoView = frames => {__sourceViews++; return view(frames);};
      const set = chip.setSourceGains.bind(chip);
      chip.setSourceGains = gains => {__sourceSets++; return set(gains);};
    }
  }
  return __sourceAttach(mixer);
};
const __sourceStart = startWorkletStream;
startWorkletStream = async (...args) => {const value = await __sourceStart(...args); if (value) __sourceWorklets++; return value;};
function __pcmStats(left, right) {
  const result = {peak:0, rms:0, acRms:0, left:0, right:0, frames:left.length};
  let sum = 0, square = 0;
  for (const [side, samples] of [['left', left], ['right', right]]) {
    let power = 0;
    for (const value of samples) {
      if (!Number.isFinite(value)) throw Error('Non-finite real playback PCM');
      result.peak = Math.max(result.peak, Math.abs(value)); sum += value; square += value * value; power += value * value;
    }
    result[side] = Math.sqrt(power / samples.length);
  }
  result.rms = Math.sqrt(square / (left.length * 2));
  result.acRms = Math.sqrt(Math.max(0, square / (left.length * 2) - (sum / (left.length * 2)) ** 2));
  return result;
}
window.__analyzerSourceTest = {
  snapshot:() => ({file:lastLoadedFileName, configuration:__sourceConfig,
    sources:engine?.playbackMixer?.sourceMixers.get('ym2608')?.getState() ?? null,
    native:__findOpna(engine)?.getSourceGains() ?? null,
    strips:engine?.playbackMixer ? Object.fromEntries([...engine.playbackMixer.strips.keys()].map(id => [id, engine.playbackMixer.get(id)])) : null,
    master:masterVolume, effect:audioPreferences.getEffect(), saved:localStorage.getItem('${key}'),
    frames:__sourceFrames, views:__sourceViews, writes:__sourceWrites, sets:__sourceSets, worklets:__sourceWorklets,
    playing:player?.isPlaying() ?? false, paused:player?.isPaused() ?? false,
    position:player?.processedWaitSamples ?? 0, storageWrites:window.__sourceAudioAudit.storageWrites}),
  counts:() => ({writes:__sourceWrites, views:__sourceViews, sets:__sourceSets}),
  capture:() => {
    if (!player || !__findOpna(engine)) throw Error('Expected prepared real YM2608 engine');
    stopActiveStream(); player.stop(); player.reset(); player.play();
    const frames = Math.round(engine.sampleRate() * .15);
    const left = new Float32Array(frames), right = new Float32Array(frames);
    player.process(left, right, frames); player.stop(); updatePlaybackButtons(player.stats());
    return __pcmStats(left, right);
  }
};
`;
const server = http.createServer(async (request, response) => {
  try {
    let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(options.root, '.' + name);
    assert(file.startsWith(options.root + path.sep));
    let bytes = await fs.readFile(file);
    const relative = path.relative(options.root, file).split(path.sep).join('/');
    const value = {bytes:bytes.length, sha256:sha(bytes),
      normalizedSha256:/\.(js|css)$/.test(file) ? sha(normalized(bytes)) : sha(bytes)};
    if (assets.has(relative) && assets.get(relative).sha256 !== value.sha256) {
      sourceErrors.push('Changed served asset ' + relative); throw Error(sourceErrors.at(-1));
    }
    assets.set(relative, value);
    if (file === path.join(options.root, options.entry, 'vgm_analyzer.js')) bytes = Buffer.concat([bytes, Buffer.from(hook)]);
    response.writeHead(200, {'Content-Type':mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control':'no-store'}).end(bytes);
  } catch (error) {response.writeHead(404).end(error.message);}
});

function installPhysicalMute(storageKey) {
  const connect = AudioNode.prototype.connect, store = Storage.prototype.setItem;
  const audit = window.__sourceAudioAudit = {meters:[], storageWrites:[]};
  AudioNode.prototype.connect = function(destination, ...args) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...args);
    const analyser = this.context.createAnalyser(), mute = this.context.createGain();
    analyser.fftSize = 2048; mute.gain.value = 0;
    connect.call(this, analyser); connect.call(analyser, mute); connect.call(mute, destination);
    audit.meters.push({analyser, mute}); return destination;
  };
  Storage.prototype.setItem = function(name, value) {
    if (name === storageKey) audit.storageWrites.push(String(value));
    return store.call(this, name, value);
  };
  audit.read = () => ({connections:audit.meters.length,
    physicalOutputMuted:audit.meters.every(value => value.mute.gain.value === 0),
    peak:Math.max(0, ...audit.meters.map(({analyser}) => {
      const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
      return values.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    }))});
}
const snapshot = page => page.evaluate(() => __analyzerSourceTest.snapshot());
const capture = page => page.evaluate(() => __analyzerSourceTest.capture());
const parent = '#mixerStrips > [data-chip="ym2608"]';
const source = part => parent + ' [data-source="' + part + '"]';
async function range(page, selector, value, independent = false, prepared = true) {
  const counts = await page.locator(selector).evaluate((node, value) => {
    const before = __analyzerSourceTest.counts();
    node.value = String(value); node.dispatchEvent(new Event('input', {bubbles:true}));
    return {before, after:__analyzerSourceTest.counts()};
  }, value);
  assert.equal(Number(await page.locator(selector).inputValue()), value);
  if (independent) {
    assert.equal(counts.after.writes, counts.before.writes, 'Source fader emitted register writes');
    assert.equal(counts.after.views, counts.before.views, 'Source fader rendered extra PCM');
    if (prepared) assert(counts.after.sets > counts.before.sets, 'Source fader did not reach native gain API');
  }
}
const gain = (page, part, value, prepared = true) => range(page, source(part) + ' input[type=range]', value, true, prepared);
async function mute(page, part) {
  const delta = await page.locator(source(part) + ' button').evaluate(node => {
    const before = __analyzerSourceTest.counts(); node.click(); return {before, after:__analyzerSourceTest.counts()};
  });
  assert.equal(delta.after.writes, delta.before.writes, 'Source mute emitted register writes');
  assert.equal(delta.after.views, delta.before.views, 'Source mute rendered PCM');
}
async function load(page, name, bytes) {
  await page.locator('#fileInput').setInputFiles({name, mimeType:'application/octet-stream',
    buffer:bytes ?? await fs.readFile(path.join(repo, 'test/fixtures', name))});
  await page.waitForFunction(name => __analyzerSourceTest.snapshot().file === name &&
    document.getElementById('status').textContent.startsWith('Parsed ' + name + ' ') &&
    !document.getElementById('inlinePlayButton').disabled, name);
  await page.locator('#playlistTab').click();
  await page.locator('#dockMixerTab').click();
}
async function play(page) {
  const before = await snapshot(page); await page.locator('#inlinePlayButton').click();
  await page.waitForFunction(before => {
    const state = __analyzerSourceTest.snapshot(); return state.frames > before.frames && state.worklets > before.worklets;
  }, before);
}
async function stop(page) {await page.locator('#inlineStopButton').evaluate(node => {if (!node.disabled) node.click();});}
async function rom(page) {
  await page.locator('#fileInput').setInputFiles({name:'ym2608_adpcm_rom.bin', mimeType:'application/octet-stream',
    buffer:await fs.readFile(path.join(repo, 'docs/js/tetorica_ym2608_adpcm_rom.bin'))});
  await page.waitForFunction(() => document.getElementById('romFileStatus').textContent.includes('8192 bytes'));
}
function longFixture(bytes, mixed = false) {
  // Preserve the authored fixture writes, extending only its final wait.
  assert.deepEqual([...bytes.subarray(-4)], [0x61, 0x22, 0x56, 0x66]);
  const waits = Buffer.from([...Array.from({length:60}, () => [0x61, 0x22, 0x56]).flat(), 0x66]);
  const ay = mixed ? Buffer.from([0xa0, 0, 120, 0xa0, 1, 0, 0xa0, 7, 62, 0xa0, 8, 12]) : Buffer.alloc(0);
  const output = Buffer.concat([bytes.subarray(0, bytes.length - 4), ay, waits]);
  output.writeUInt32LE(output.length - 4, 4); output.writeUInt32LE(30 * 44100, 0x18);
  if (mixed) output.writeUInt32LE(1789773, 0x74);
  return output;
}
function wavStats(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.readUInt16LE(22), 2);
  let peak = 0, square = 0;
  for (let offset = 44; offset < bytes.length; offset += 2) {
    const value = bytes.readInt16LE(offset) / 32768; peak = Math.max(peak, Math.abs(value)); square += value * value;
  }
  return {bytes:bytes.length, sha256:sha(bytes), peak, rms:Math.sqrt(square / ((bytes.length - 44) / 2))};
}
async function exportWav(page) {
  await page.locator('#exportTab').click();
  await page.locator('#exportWavButton').click(); await page.locator('#wavMaxSecondsInput').fill('1');
  const pending = page.waitForEvent('download'); await page.locator('#wavExportDialog button[value=export]').click();
  const download = await pending; assert.equal(await download.failure(), null);
  const bytes = await fs.readFile(await download.path());
  await page.waitForFunction(() => !document.getElementById('wavExportDialog').open);
  await page.locator('#playlistTab').click();
  return wavStats(bytes);
}

async function checkBrowser(name, browser, origin) {
  const context = await browser.newContext({serviceWorkers:'block', viewport:{width:1440, height:1000}});
  await context.addInitScript(installPhysicalMute, key);
  const page = await context.newPage(), errors = [], missing = [], external = [], blocked = [], checks = [], measurements = {};
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {if (response.status() >= 400) missing.push(response.url());});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    (/monaco|jsdelivr/.test(url.href) ? blocked : external).push(url.href); return route.abort();
  });
  const entryPath = options.entry ? '/' + options.entry + '/index.html' : '/index.html';
  const open = async () => {await page.goto(origin + entryPath); await page.waitForFunction(() => window.__analyzerSourceTest);};
  let stage = 'initial defaults';
  try {
    await open(); await load(page, 'ym2608-fm.vgm');
    assert.equal((await snapshot(page)).saved, null); assert.equal((await snapshot(page)).storageWrites.length, 0);
    for (const part of parts) {
      const slider = page.locator(source(part) + ' input[type=range]');
      assert.equal(await slider.inputValue(), '100'); assert.equal(await slider.getAttribute('min'), '0');
      assert.equal(await slider.getAttribute('max'), '380'); assert.equal(await slider.getAttribute('step'), '1');
      assert.equal(await page.locator(source(part) + ' button').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator(source(part) + ' input[type=range]').count(), 1);
    }
    assert.equal(await page.locator(parent + ' > label input[type=range]').count(), 2);
    assert.equal(await page.locator(parent + ' > label input[type=range]').first().inputValue(), '103');
    checks.push('Unity source defaults stay lazy; calibrated whole-chip Volume/Pan/Mute remain distinct');
    const layout = () => page.locator(parent + ' .mixer-source-group').evaluate(node => ({
      columns:getComputedStyle(node).gridTemplateColumns.split(/\s+/).length,
      width:node.clientWidth, scrollWidth:node.scrollWidth}));
    measurements.layout = {desktop:await layout()}; assert.equal(measurements.layout.desktop.columns, 2);
    await page.setViewportSize({width:390, height:900});
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.mixer-source-group')).gridTemplateColumns.split(/\s+/).length === 1);
    measurements.layout.mobile = await layout();
    assert(measurements.layout.mobile.scrollWidth <= measurements.layout.mobile.width + 1, 'Mobile source panel overflows');
    await fs.mkdir(path.dirname(options.out), {recursive:true});
    measurements.layout.mobileScreenshot = options.out.replace(/\.json$/, '') + '-' + name + '-mobile.png';
    await page.locator(parent).screenshot({path:measurements.layout.mobileScreenshot});
    await page.setViewportSize({width:1440, height:1000});
    checks.push('Source panel uses two desktop columns and one mobile column without horizontal overflow');

    stage = 'real fixture source gains'; await rom(page); measurements.fixtures = {};
    for (const part of parts) {
      await load(page, 'ym2608-' + part + '.vgm'); await page.locator('#mixerReset').click(); await play(page); await stop(page);
      assert.deepEqual((await snapshot(page)).sources, defaults());
      const unity = await capture(page); assert(unity.acRms > 1e-5, part + ' fixture is silent');
      await gain(page, part, 50); const half = await capture(page), ratio = half.acRms / unity.acRms;
      assert(Math.abs(ratio - .5) < .015, part + ' half-amplitude ratio ' + ratio);
      await gain(page, part, 380);
      assert(await page.locator(source(part)).evaluate(node => node.classList.contains('is-boosted')));
      assert.equal((await snapshot(page)).native[part], 3.8);
      if (part === 'fm') {
        measurements.layout.boostScreenshot = options.out.replace(/\.json$/, '') + '-' + name + '-boost.png';
        await page.locator(parent).screenshot({path:measurements.layout.boostScreenshot});
      }
      await mute(page, part); const muted = await capture(page); assert.equal(muted.peak, 0, part + ' mute');
      assert.equal((await snapshot(page)).sources[part].gain, 3.8); assert.equal((await snapshot(page)).native[part], 0);
      await mute(page, part); await gain(page, part, 100);
      const other = parts.find(value => value !== part); await gain(page, other, 0);
      const independent = await capture(page); assert(Math.abs(independent.acRms / unity.acRms - 1) < .03, other + ' affects ' + part);
      await gain(page, part, 0); assert.equal((await capture(page)).peak, 0, part + ' zero gain');
      measurements.fixtures[part] = {unity, half, ratio, muted, unrelatedSourceZero:independent};
    }
    checks.push('All four real fixture outputs reach half amplitude, zero and mute; unrelated faders remain independent; handlers cause zero register writes and zero extra renders');

    stage = 'parent gain pan mute'; await load(page, 'ym2608-fm.vgm'); await page.locator('#mixerReset').click();
    await play(page); await stop(page); await gain(page, 'fm', 50);
    await range(page, parent + ' > label:first-of-type input[type=range]', 100);
    const parentUnity = await capture(page);
    await range(page, parent + ' > label:first-of-type input[type=range]', 50);
    const parentHalf = await capture(page); assert(Math.abs(parentHalf.acRms / parentUnity.acRms - .5) < .015);
    await range(page, parent + ' > label:nth-of-type(2) input[type=range]', -100);
    const pan = await capture(page); assert.equal(pan.right, 0); assert(pan.left > 1e-5);
    await page.locator(parent + ' > .mixer-strip-title button').click(); assert.equal((await capture(page)).peak, 0);
    assert.equal((await snapshot(page)).sources.fm.gain, .5);
    measurements.parent = {unity:parentUnity, half:parentHalf, pan};
    checks.push('Calibrated parent gain still multiplies source gain; shared pan and mute retain independent source values');

    stage = 'live pause resume seek';
    await load(page, 'Long OPNA.vgm', longFixture(await fs.readFile(path.join(repo, 'test/fixtures/ym2608-fm.vgm'))));
    await page.locator('#mixerReset').click();
    const retained = {fm:{gain:.63, muted:false}, ssg:{gain:.42, muted:false}, rhythm:{gain:.31, muted:true}, adpcm:{gain:.24, muted:false}};
    for (const part of parts) await gain(page, part, retained[part].gain * 100, false);
    await mute(page, 'rhythm'); await play(page);
    await gain(page, 'fm', 64); retained.fm.gain = .64;
    await page.waitForFunction(() => __sourceAudioAudit.read().peak > 1e-5);
    measurements.live = {audible:await page.evaluate(() => __sourceAudioAudit.read())};
    await gain(page, 'fm', 0);
    await page.waitForFunction(() => __sourceAudioAudit.read().peak < 1e-7);
    measurements.live.zero = await page.evaluate(() => __sourceAudioAudit.read());
    assert((await snapshot(page)).playing, 'Live source zero stopped transport');
    await gain(page, 'fm', 64); await page.waitForFunction(() => __sourceAudioAudit.read().peak > 1e-5);
    assert((await snapshot(page)).playing); await page.locator('#inlinePauseButton').click();
    await page.waitForFunction(() => __analyzerSourceTest.snapshot().paused);
    assert.deepEqual((await snapshot(page)).sources, retained);
    await range(page, '#inlinePlaybackSeek', 3 * 44100);
    await page.locator('#inlinePlaybackSeek').evaluate(node => node.dispatchEvent(new Event('change', {bubbles:true})));
    assert((await snapshot(page)).paused); assert.deepEqual((await snapshot(page)).sources, retained);
    await page.locator('#inlinePlayButton').click(); await page.waitForFunction(() => __analyzerSourceTest.snapshot().playing);
    await range(page, '#inlinePlaybackSeek', 5 * 44100);
    await page.locator('#inlinePlaybackSeek').evaluate(node => node.dispatchEvent(new Event('change', {bubbles:true})));
    await page.waitForFunction(() => __analyzerSourceTest.snapshot().playing && __analyzerSourceTest.snapshot().position >= 5 * 44100);
    assert.deepEqual((await snapshot(page)).sources, retained); await stop(page);
    await play(page); assert.deepEqual((await snapshot(page)).sources, retained); await stop(page);
    checks.push('Live Worklet output reaches source silence and resumes without stopping; Pause/Resume, paused/playing seek and Stop/restart preserve all four settings');

    stage = 'reload unrelated track and Reset';
    const persisted = (await snapshot(page)).saved;
    assert.deepEqual(JSON.parse(persisted).chips, {}, 'Source edits authored a parent chip override');
    assert.deepEqual(JSON.parse(persisted).sourceMixes.ym2608,
      Object.fromEntries(parts.map(part => [part, {...{gain:retained[part].gain}, ...(retained[part].muted ? {muted:true} : {})}])));
    await open(); await load(page, 'ay-tone.vgm'); assert.equal(await page.locator('[data-source]').count(), 0);
    await load(page, 'ym2608-fm.vgm'); assert.equal((await snapshot(page)).saved, persisted);
    assert.equal((await snapshot(page)).storageWrites.length, 0);
    await play(page); assert.deepEqual((await snapshot(page)).sources, retained); await stop(page);
    await page.locator('#dockEffectTab').click(); await range(page, '#effectBass', 4);
    const effect = (await snapshot(page)).effect;
    await page.locator('#dockMixerTab').click(); await page.locator('#mixerReset').click();
    assert.deepEqual((await snapshot(page)).sources, defaults()); assert.deepEqual((await snapshot(page)).effect, effect);
    await open(); await load(page, 'ym2608-fm.vgm'); await play(page); await stop(page);
    assert.deepEqual((await snapshot(page)).sources, defaults());
    checks.push('Explicit sources survive reload and another chip; Mixer Reset restores all unity/unmuted sources and retains FX');

    stage = 'WAV export';
    measurements.wav = {unity:await exportWav(page)}; await gain(page, 'fm', 50);
    measurements.wav.half = await exportWav(page);
    assert(Math.abs(measurements.wav.half.rms / measurements.wav.unity.rms - .5) < .015);
    await mute(page, 'fm'); measurements.wav.muted = await exportWav(page); assert.equal(measurements.wav.muted.peak, 0);
    assert.deepEqual((await snapshot(page)).sources.fm, {gain:.5, muted:true});
    checks.push('Actual downloaded WAV reflects source half gain and mute while retaining authored settings');

    stage = 'mixed YM2608 and AY';
    await load(page, 'OPNA and AY.vgm', longFixture(await fs.readFile(path.join(repo, 'test/fixtures/ym2608-ssg.vgm')), true));
    await page.locator('#mixerReset').click(); await play(page); await stop(page);
    const mixed = await snapshot(page); assert(mixed.strips.ym2608 && mixed.strips.ay8910);
    await gain(page, 'ssg', 0); const ayOnly = await capture(page); assert(ayOnly.acRms > 1e-5);
    await page.locator('#mixerStrips > [data-chip="ay8910"] > .mixer-strip-title button').click();
    assert.equal((await capture(page)).peak, 0); await gain(page, 'ssg', 100);
    const opnaOnly = await capture(page); assert(opnaOnly.acRms > 1e-5);
    measurements.mixed = {ayOnly, opnaOnly};
    checks.push('Mixed YM2608 and AY retain separate chip strips; muting the YM2608 source leaves AY audio');

    stage = 'final physical graph'; measurements.graph = await page.evaluate(() => __sourceAudioAudit.read());
    assert(measurements.graph.connections > 0); assert(measurements.graph.physicalOutputMuted);
    assert((await snapshot(page)).views > 0); assert((await snapshot(page)).worklets > 0);
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(external, []);
    return {browser:name, passed:true, checks, measurements, errors, missing, external,
      expectedBlockedMonaco:blocked, physicalOutputMuted:true, listeningPerformed:false};
  } catch (error) {
    error.receipt = {browser:name, passed:false, stage, error:error.stack, checks, measurements, errors, missing, external,
      status:await page.locator('#status').textContent().catch(() => null), state:await snapshot(page).catch(() => null)};
    throw error;
  } finally {await context.close();}
}

(async () => {
  let failure = null, comparison = null;
  try {
    if (!options.entry) {try {await fs.access(path.join(options.root, 'vgm_analyzer/index.html')); options.entry = 'vgm_analyzer';} catch {options.entry = '';}}
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const name of engines) {
      const browser = await {chromium, webkit}[name].launch({headless:true,
        ...(name === 'chromium' ? {args:['--mute-audio', '--autoplay-policy=no-user-gesture-required']} : {})});
      try {results.push(await checkBrowser(name, browser, origin));}
      catch (error) {results.push(error.receipt ?? {browser:name, passed:false, error:error.stack}); throw error;}
      finally {await browser.close();}
    }
    assert.deepEqual(sourceErrors, []);
    if (options.compare) {
      const previous = JSON.parse(await fs.readFile(options.compare, 'utf8'));
      const before = new Map(Object.entries(previous.servedAssets).map(([name, value]) => [canonical(name), value]));
      const matched = [];
      for (const [name, value] of assets) {
        const normalizedName = canonical(name);
        if (!before.has(normalizedName) || normalizedName.endsWith('.html') || normalizedName === 'js/vgi.js') continue;
        assert.equal(value.normalizedSha256, before.get(normalizedName).normalizedSha256, normalizedName); matched.push(normalizedName);
      }
      for (const name of ['vgm_analyzer.js', 'mixer_ui.js', 'audio_preferences.js', 'playback_mixer.js', 'ym2608_source_mix.js',
        'js/ym2608.js', 'js/ym2608audioengine.js', 'generated/ym2608_wasm.js', 'generated/ym2608_wasm.wasm'])
        assert(matched.includes(name), 'Missing packaged/source match: ' + name);
      comparison = {file:options.compare, matchedAssets:matched.sort(), normalization:'Standalone relative js/generated/playground paths; rewritten HTML and vgi implementation excluded'};
    }
  } catch (error) {failure = error;}
  finally {server.closeAllConnections?.(); if (server.listening) await new Promise(resolve => server.close(resolve));}
  const receipt = {schemaVersion:1, passed:!failure, root:options.root, entry:options.entry,
    elapsedSeconds:(Date.now() - started) / 1000, physicalOutputMuted:true, listeningPerformed:false,
    checker:{file:path.relative(repo, __filename), sha256:sha(await fs.readFile(__filename))},
    servedAssets:Object.fromEntries([...assets].sort()), sourceErrors, comparison, results,
    ...(failure ? {error:failure.stack} : {})};
  await fs.mkdir(path.dirname(options.out), {recursive:true}); await fs.writeFile(options.out, JSON.stringify(receipt, null, 2) + '\n');
  if (failure) throw failure; console.log('PASS ' + options.out);
})().catch(error => {console.error(error); process.exitCode = 1;});
