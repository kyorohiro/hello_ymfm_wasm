// Real standalone SID Synth checks. The measured post-Master branch ends in
// a separate finalGain=0 before the physical destination; no listening occurs.
const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');

const config = {root: path.resolve(__dirname, '../docs'), entry: '/synth-sid/index.html',
  out: '/private/tmp/tetorica-sid-synth-browser.json', screenshots: null};
for (let i = 2; i < process.argv.length; ++i) {
  const key = process.argv[i].replace(/^--/, '');
  assert(['root', 'entry', 'out', 'screenshots'].includes(key), 'Usage: --root DIR --entry /index.html --out JSON --screenshots DIR');
  const value = process.argv[++i]; assert(value && !value.startsWith('--'), `Missing --${key}`);
  config[key] = key === 'entry' ? value : path.resolve(value);
}
const mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon'};
const report = {schemaVersion: 1, entry: config.entry, passed: false, physicalOutputMuted: true, listeningPerformed: false, results: []};
const frequency = (midi, pitch = 0, ratio = 1) => Math.round(440 * 2 ** ((midi + pitch - 69) / 12) * ratio * 16777216 / 985248);
const registerFrequency = (state, channel) => state.registers[channel * 7] | state.registers[channel * 7 + 1] << 8;
const difference = (a, b) => { let distance = 0, total = 0; for (let i = 0; i < a.length; ++i) { distance += Math.abs(a[i] - b[i]); total += a[i] + b[i]; } return total ? distance / total : 0; };

function instrumentation() {
  const audit = window.__sidSynthAudit = {contexts: [], worklets: [], sinks: [], messages: [], nextId: 0};
  const Context = window.AudioContext ?? window.webkitAudioContext, Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect, post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function(data, ...args) {
    if (data?.method) audit.messages.push({method: data.method, id: data.id});
    if (data?.id > 0 && audit.holdNextMethod === data.method) {
      audit.holdNextMethod = null; audit.releaseCommand = () => { audit.releaseCommand = null; return post.call(this, data, ...args); }; return;
    }
    return post.call(this, data, ...args);
  };
  window.AudioContext = class extends Context { constructor(...args) { super(...args); audit.contexts.push(this); } };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet { constructor(...args) { super(...args); audit.worklets.push(this); } };
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
    const node = audit.worklets.at(-1), id = --audit.nextId;
    if (!node) return reject(new Error('No SID worklet'));
    const timer = setTimeout(() => { node.port.removeEventListener('message', receive); reject(new Error('SID audit read timed out')); }, 5000);
    function receive({data}) {
      if (data.id !== id) return;
      clearTimeout(timer); node.port.removeEventListener('message', receive);
      data.error ? reject(new Error(data.error)) : resolve(data.value);
    }
    node.port.addEventListener('message', receive); node.port.start(); node.port.postMessage({id, method: 'read', args: []});
  });
  audit.sample = () => {
    const sink = audit.sinks.findLast(value => value.context.state === 'running');
    const muted = audit.sinks.every(value => value.finalGain.gain.value === 0);
    if (!sink) return {rms: 0, peak: 0, finite: true, muted, spectrum: []};
    const pcm = new Float32Array(sink.analyser.fftSize), db = new Float32Array(sink.analyser.frequencyBinCount);
    sink.analyser.getFloatTimeDomainData(pcm); sink.analyser.getFloatFrequencyData(db);
    let square = 0, peak = 0; for (const value of pcm) { square += value * value; peak = Math.max(peak, Math.abs(value)); }
    return {rms: Math.sqrt(square / pcm.length), peak, finite: pcm.every(Number.isFinite), muted,
      spectrum: Array.from(db, value => Number.isFinite(value) ? 10 ** (value / 10) : 0)};
  };
}

async function checkEngine(name, engine, origin) {
  const browser = await engine.launch({headless: true});
  const errors = [], consoleErrors = [], failed = [], external = [], checks = [], measurements = {};
  let page, stage = 'startup', holdWasm = true, releaseWasm;
  try {
    page = await browser.newPage({acceptDownloads: true, viewport: {width: 1180, height: 1000}}); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) failed.push({url: response.url(), status: response.status()}); });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) { external.push(url.href); return route.abort(); }
      if (url.origin === origin && /\/sid\/sid\.wasm$/.test(url.pathname) && holdWasm) {
        holdWasm = false; await new Promise(resolve => { releaseWasm = resolve; });
        return route.continue().catch(() => {}); // Startup Stop may have cancelled this held request.
      }
      return route.continue();
    });
    await page.addInitScript(instrumentation);
    const check = label => { stage = label; checks.push(label); console.log(`CHECK ${name}: ${label}`); };
    const read = () => page.evaluate(() => __sidSynthAudit.read());
    const wait = async predicate => {
      for (let i = 0; i < 120; ++i) { const state = await read(); if (predicate(state)) return state; await page.waitForTimeout(25); }
      throw new Error(`SID state did not settle: ${JSON.stringify(await read())}`);
    };
    const sound = () => page.waitForFunction(() => { const value = __sidSynthAudit.sample(); return value.finite && value.muted && value.rms > .00001; });
    const silent = () => page.waitForFunction(() => { const value = __sidSynthAudit.sample(); return value.finite && value.muted && value.peak < 1e-8; });
    const measure = async () => { await page.waitForTimeout(260); const value = await page.evaluate(() => __sidSynthAudit.sample()); assert(value.finite && value.muted); return value; };
    const choice = (group, value) => page.locator(`[data-choice-for="${group}"][data-value="${value}"]`).click();
    const range = (id, value) => page.locator('#' + id).evaluate((input, next) => { input.value = String(next); input.dispatchEvent(new Event('input', {bubbles: true})); }, value);
    const settle = () => page.waitForFunction(() => document.querySelector('#patchStatus').dataset.busy !== 'true');
    const stopped = async () => { await page.locator('#stopAudio').click(); await wait(state => state.voices.length === 0 && state.pitch === 0); await silent(); };
    const ready = () => page.waitForFunction(() => document.querySelector('#startAudio').textContent.includes('ready'));
    await page.goto(origin + config.entry); await page.waitForFunction(() => document.querySelector('[data-choice-for="waveform"]'));

    check('lazy local UI and first keyboard press/release during delayed WASM loading');
    assert.match(await page.title(), /Tetorica SID Synth/); assert.equal(await page.evaluate(() => __sidSynthAudit.contexts.length), 0);
    const keys = await page.locator('#keyboard .key:not([disabled])').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.key))].slice(0, 4));
    assert.equal(keys.length, 4); assert.equal(await page.locator('select').count(), 0);
    await page.keyboard.down(keys[0]);
    for (let i = 0; !releaseWasm && i < 120; ++i) await page.waitForTimeout(25);
    assert(releaseWasm, 'lazy key reached SID fetch'); await page.keyboard.up(keys[0]); releaseWasm(); releaseWasm = null;
    await ready(); await wait(state => state.voices.length === 0); await silent();
    assert.equal(await page.evaluate(() => __sidSynthAudit.sinks.length), 1, 'the visualizer must remain a passive branch of the one Master output');
    assert.equal(await page.evaluate(() => __sidSynthAudit.messages.filter(message => message.method === 'noteOn').length), 0, 'released loading key must never play later');

    check('three-voice round robin, fourth-note steal and harmless stale key release');
    for (const key of keys.slice(0, 3)) await page.keyboard.down(key);
    let state = await wait(value => value.voices.length === 3); assert.equal(new Set(state.voices.map(voice => voice.channel)).size, 3); await sound();
    const oldest = state.voices[0].id;
    await page.keyboard.down(keys[3]); state = await wait(value => value.voices.length === 3 && !value.voices.some(voice => voice.id === oldest));
    await page.keyboard.up(keys[0]); assert.equal((await read()).voices.length, 3);
    for (const key of keys.slice(1)) await page.keyboard.up(key); await wait(value => value.voices.length === 0); await stopped();

    check('hardware release continues after Gate off; Stop flushes the tail without discarding the patch');
    await page.locator('#attack').press('Home'); await page.locator('#decay').press('Home'); await page.locator('#release').press('End');
    await wait(value => value.preset.voice.attack === 0 && value.preset.voice.decay === 0 && value.preset.voice.release === 15);
    await page.keyboard.down(keys[0]); state = await wait(value => value.voices.length === 1); const midi = state.voices[0].midi; await sound(); await page.waitForTimeout(120);
    await page.keyboard.up(keys[0]); await wait(value => value.voices.length === 0); assert((await measure()).rms > .00001, 'hardware Release remains audible');
    await stopped(); assert.equal((await read()).preset.voice.release, 15);

    check('held waveform, pulse width and hardware sustain edits alter actual PCM and retain the owner');
    await page.keyboard.down(keys[0]); state = await wait(value => value.voices.length === 1); const owner = state.voices[0].id, waves = {};
    for (const waveform of ['triangle', 'saw', 'pulse', 'noise']) {
      await choice('waveform', waveform); state = await wait(value => value.preset.voice.waveform === waveform);
      assert.equal(state.voices[0].id, owner); await sound(); waves[waveform] = await measure();
    }
    assert(difference(waves.triangle.spectrum, waves.saw.spectrum) > .02);
    await choice('waveform', 'pulse'); await range('pulseWidthRange', 512); await wait(value => value.preset.voice.pulseWidth === 512); const narrow = await measure();
    await range('pulseWidthRange', 2048); await wait(value => value.preset.voice.pulseWidth === 2048); const square = await measure();
    assert(difference(narrow.spectrum, square.spectrum) > .02);
    await choice('waveform', 'saw'); const highSustain = await measure();
    // Do not pass through Sustain=0: reaching zero freezes the real hardware
    // envelope, and raising Sustain alone does not open that envelope again.
    for (let i = 0; i < 6; ++i) await page.locator('#sustain').press('ArrowDown');
    state = await wait(value => value.preset.voice.sustain === 6); assert.equal(state.voices[0].id, owner); const lowSustain = await measure();
    assert(lowSustain.rms < highSustain.rms * .8, 'lower Sustain changes the held hardware envelope');
    measurements.waveforms = Object.fromEntries(Object.entries(waves).map(([wave, {rms, peak}]) => [wave, {rms, peak}]));
    measurements.pulseSpectrumDifference = difference(narrow.spectrum, square.spectrum);

    check('shared LP/BP/HP/Notch, live cutoff/resonance and chip volume reach held real output');
    measurements.filters = {};
    for (const mode of ['lowpass', 'bandpass', 'highpass']) {
      await choice('filterMode', mode); await wait(value => value.preset.filter.enabled && value.preset.filter.mode === mode);
      await range('filterCutoffRange', 180); await wait(value => value.preset.filter.cutoff === 180); const low = await measure();
      await range('filterCutoffRange', 1700); await wait(value => value.preset.filter.cutoff === 1700); const high = await measure();
      assert(difference(low.spectrum, high.spectrum) > .01, `${mode}: cutoff changes PCM`);
      await range('filterCutoffRange', 700); await range('filterResonanceRange', 0); await wait(value => value.preset.filter.resonance === 0); const flat = await measure();
      await range('filterResonanceRange', 15); state = await wait(value => value.preset.filter.resonance === 15); const resonant = await measure();
      assert.equal(state.voices[0].id, owner); assert(difference(flat.spectrum, resonant.spectrum) > .005, `${mode}: resonance changes PCM`);
      measurements.filters[mode] = {cutoffSpectrumDifference: difference(low.spectrum, high.spectrum), resonanceSpectrumDifference: difference(flat.spectrum, resonant.spectrum)};
    }
    await choice('filterMode', 'notch'); state = await wait(value => value.preset.filter.mode === 'notch'); assert.equal(state.registers[24] & 0x70, 0x50);
    await page.locator('#filterEnabled').uncheck(); await wait(value => !value.preset.filter.enabled); const chipEight = await measure();
    await page.locator('#chipVolume').press('Home'); for (let i = 0; i < 4; ++i) await page.locator('#chipVolume').press('ArrowUp');
    await wait(value => value.preset.filter.volume === 4); const chipFour = await measure(); assert(Math.abs(chipFour.rms / chipEight.rms - .5) < .08);
    for (let i = 0; i < 4; ++i) await page.locator('#chipVolume').press('ArrowUp'); await wait(value => value.preset.filter.volume === 8);
    await page.keyboard.up(keys[0]); await stopped();

    check('Sync/Ring reserve one carrier with silent unrouted voice 3; ratio and both Pitch wheels act live');
    await page.locator('#modulationCard > summary').click(); await page.locator('#syncEnabled').check(); await wait(value => value.capacity === 1 && value.preset.modulation.sync);
    await page.locator('#filterEnabled').check(); await page.keyboard.down(keys[0]); state = await wait(value => value.voices.length === 1);
    assert.equal(state.voices[0].channel, 0); assert.equal(state.registers[18], 0x10); assert.equal(state.registers[23] & 7, 1); assert.equal(state.registers[24] & 128, 128); await sound();
    const pairOwner = state.voices[0].id, carrier = registerFrequency(state, 0);
    await range('modulationRatioRange', 1.5); state = await wait(value => value.preset.modulation.ratio === 1.5);
    assert.equal(state.voices[0].id, pairOwner); assert.equal(registerFrequency(state, 0), carrier); assert.equal(registerFrequency(state, 2), frequency(state.voices[0].midi, 0, 1.5));
    await range('pitchBend', 1.5); state = await wait(value => value.pitch === 1.5);
    assert.equal(await page.locator('#keyboardPitchBend').inputValue(), '1.5'); assert.equal(registerFrequency(state, 0), frequency(state.voices[0].midi, 1.5));
    await page.locator('#keyboardPitchBend').dispatchEvent('pointercancel'); await wait(value => value.pitch === 0); assert.equal(await page.locator('#pitchBend').inputValue(), '0');
    await page.keyboard.down(keys[1]); state = await wait(value => value.voices.length === 1 && value.voices[0].id !== pairOwner);
    await page.keyboard.up(keys[0]); assert.equal((await read()).voices.length, 1); await page.keyboard.up(keys[1]); await stopped();
    await page.locator('#syncEnabled').uncheck(); await page.locator('#ringEnabled').check(); await wait(value => value.preset.modulation.ring && !value.preset.modulation.sync);
    assert.match(await page.locator('#modulationHelp').textContent(), /Triangle only/);
    await choice('waveform', 'triangle'); await page.keyboard.down(keys[0]); await wait(value => value.voices.length === 1); await sound(); const ringA = await measure();
    await range('modulationRatioRange', 1.75); await wait(value => value.preset.modulation.ratio === 1.75); const ringB = await measure();
    measurements.ringRatioSpectrumDifference = difference(ringA.spectrum, ringB.spectrum); assert(measurements.ringRatioSpectrumDifference > .01);
    await page.keyboard.up(keys[0]); await stopped();

    check('portable preset save, cancel/invalid retention, load reset and readable executable Playground JavaScript');
    await page.locator('#presetTools > summary').click();
    const downloadPromise = page.waitForEvent('download'); await page.locator('#savePreset').click(); const download = await downloadPromise;
    const saved = JSON.parse(await fs.readFile(await download.path(), 'utf8')); assert.equal(saved.format, 'tetorica-sid-voice'); assert.equal(saved.version, 1); assert(saved.modulation.ring);
    await page.keyboard.down(keys[0]); state = await wait(value => value.voices.length === 1); const savedOwner = state.voices[0].id;
    await page.locator('#presetFileInput').dispatchEvent('cancel'); assert.deepEqual((await read()).preset, saved); assert.equal((await read()).voices[0].id, savedOwner);
    await page.locator('#presetFileInput').setInputFiles({name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"wrong"}')});
    await page.waitForFunction(() => document.querySelector('#audioStatus').dataset.error === 'true'); assert.deepEqual((await read()).preset, saved); assert.equal((await read()).voices[0].id, savedOwner);
    await page.locator('#resetPreset').click(); await wait(value => value.capacity === 3 && value.voices.length === 0); await page.keyboard.up(keys[0]);
    await page.locator('#presetFileInput').setInputFiles({name: 'voice.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved))});
    state = await wait(value => value.capacity === 1 && value.preset.modulation.ring); assert.deepEqual(state.preset, saved); assert.equal(state.pitch, 0);
    await page.locator('#copyCode').click(); const code = await page.locator('#codeOutput').inputValue(); assert(code.split('\n').length > 10); assert.match(code, /sid\.setVoice/);
    measurements.copiedCode = await page.evaluate(async ({code}) => {
      const {SidCore} = await import(new URL('../js/sid.js', location.href).href), {SidSynth} = await import(new URL('../js/sidsynth.js', location.href).href);
      const response = await fetch(new URL('../generated/sid/sid.wasm', location.href)), wasmBinary = await response.arrayBuffer();
      const core = await SidCore.create({wasmBinary}), sid = new SidSynth({core});
      try { new Function('sid', code)(sid); const pcm = core.render(4096); return {lines: code.split('\n').length, peak: pcm.reduce((p, value) => Math.max(p, Math.abs(value)), 0), finite: pcm.every(Number.isFinite), registers: sid._getState().registers}; }
      finally { sid.dispose(); core.dispose(); }
    }, {code});
    assert(measurements.copiedCode.finite && measurements.copiedCode.peak > .0001);

    check('rapid topology edits and a coalesced preset load still reset held owners and both Pitch wheels');
    await page.keyboard.down(keys[0]); await wait(value => value.voices.length === 1);
    await range('pitchBend', 1.25); await wait(value => value.pitch === 1.25);
    await page.evaluate(() => {
      const input = document.querySelector('#syncEnabled');
      for (const value of [true, false]) { input.checked = value; input.dispatchEvent(new Event('change', {bubbles: true})); }
    });
    await wait(value => !value.preset.modulation.sync && value.voices.length === 0 && value.pitch === 0); await silent();
    assert.equal(await page.locator('#pitchBend').inputValue(), '0'); assert.equal(await page.locator('#keyboardPitchBend').inputValue(), '0'); await page.keyboard.up(keys[0]);
    await page.keyboard.down(keys[0]); await wait(value => value.voices.length === 1);
    await page.evaluate(() => { __sidSynthAudit.holdNextMethod = 'setPitch'; __sidSynthAudit.releaseCommand = null; });
    await range('pitchBend', 1.25); await page.waitForFunction(() => !!__sidSynthAudit.releaseCommand);
    // Keep the same topology: otherwise setPreset's own topology reset could
    // conceal a lost loadPreset reset when its queued draft is superseded.
    const importedPreset = {...saved, name: 'Coalesced import'};
    await page.locator('#presetFileInput').setInputFiles({name: 'coalesced.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(importedPreset))});
    await page.waitForFunction(() => document.querySelector('#instrumentName').value === 'Coalesced import');
    await choice('waveform', 'pulse'); await page.evaluate(() => __sidSynthAudit.releaseCommand());
    state = await wait(value => value.preset.name === 'Coalesced import' && value.preset.voice.waveform === 'pulse' && value.voices.length === 0 && value.pitch === 0);
    assert.equal(await page.locator('#pitchBend').inputValue(), '0'); assert.equal(await page.locator('#keyboardPitchBend').inputValue(), '0');
    await page.keyboard.up(keys[0]); await silent(); measurements.coalescedOwnerReset = true;

    check('post-Master gain ratios, 380% orange boost, octave/focus and preserved collapsed sections');
    await page.keyboard.down(keys[0]); await wait(value => value.voices.length === 1); await sound(); await range('masterVolume', .7); const base = await measure();
    await range('masterVolume', 1.4); const doubled = await measure(); assert(Math.abs(doubled.rms / base.rms - 2) < .12);
    await range('masterVolume', 3.8); assert.equal(await page.locator('#masterVolumeValue').textContent(), '380%'); assert.equal(await page.locator('#masterVolume').getAttribute('data-boosted'), 'true');
    assert.equal(await page.locator('#masterVolume').evaluate(node => getComputedStyle(node).accentColor), 'rgb(225, 132, 48)');
    measurements.masterRatio = doubled.rms / base.rms; await range('masterVolume', .7); await page.keyboard.up(keys[0]); await stopped();
    await page.locator('#octaveUp').click(); assert.equal((await page.locator('#octaveValue').textContent()).trim(), '+1');
    await page.keyboard.down(keys[0]); state = await wait(value => value.voices.length === 1); assert.equal(state.voices[0].midi, midi + 12); const foldedOwner = state.voices[0].id;
    await page.locator('#filterCard > summary').click(); assert.equal(await page.locator('#filterCard').evaluate(node => node.open), false);
    await choice('waveform', 'saw'); state = await wait(value => value.preset.voice.waveform === 'saw'); assert.equal(state.voices[0].id, foldedOwner);
    assert.equal(await page.locator('#filterCard').evaluate(node => node.open), false); await page.keyboard.up(keys[0]); await stopped();
    await page.locator('#ringEnabled').uncheck(); await wait(value => !value.preset.modulation.ring);
    await page.keyboard.down(keys[0]); await wait(value => value.voices.length === 1); await sound();
    await page.locator('[data-stepper-for="attack"][data-stepper-delta="1"]').click();
    await page.keyboard.down(keys[1]); await wait(value => value.voices.length === 2); await page.keyboard.up(keys[0]); await page.keyboard.up(keys[1]); await stopped();

    check('render failure is visible; Stop cancels a delayed retry and explicit Enable recovers the same preset');
    const beforeFailure = (await read()).preset;
    await page.evaluate(() => __sidSynthAudit.worklets.at(-1).onprocessorerror(new Event('processorerror')));
    await page.waitForFunction(() => document.querySelector('#audioStatus').dataset.error === 'true'); await silent();
    holdWasm = true; await page.locator('#startAudio').click();
    for (let i = 0; !releaseWasm && i < 120; ++i) await page.waitForTimeout(25);
    assert(releaseWasm); await page.locator('#stopAudio').click(); releaseWasm(); releaseWasm = null;
    await page.waitForFunction(() => document.querySelector('#startAudio').textContent === 'Enable audio'); await silent();
    await page.locator('#startAudio').click(); await ready(); state = await read(); assert.deepEqual(state.preset, beforeFailure); assert.equal(state.voices.length, 0);
    await page.keyboard.down(keys[0]); await wait(value => value.voices.length === 1); await sound(); await page.keyboard.up(keys[0]); await stopped();

    check('one post-Master Waveform/Spectrum canvas, readable source and 390px layout');
    await page.locator('[data-visual-mode="spectrum"]').click(); assert.equal(await page.locator('[data-visual-mode="spectrum"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#outputCanvas').count(), 1);
    const readable = await page.evaluate(async () => {
      const application = document.querySelector('script[type="module"][src]');
      if (!application) throw new Error('No application module source');
      const response = await fetch(application.src); if (!response.ok) throw new Error(`Application source HTTP ${response.status}`);
      return (await response.text()).split('\n').length;
    }); assert(readable > 20);
    if (config.screenshots) await page.screenshot({path: path.join(config.screenshots, `${name}-1180.png`), fullPage: true});
    await page.setViewportSize({width: 390, height: 844}); await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0);
    if (config.screenshots) await page.screenshot({path: path.join(config.screenshots, `${name}-390.png`), fullPage: true});
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(failed, []); assert.deepEqual(external, []);
    const outputBranches = await page.evaluate(() => __sidSynthAudit.contexts.map(context => ({state: context.state, destinationConnections: __sidSynthAudit.sinks.filter(sink => sink.context === context).length})));
    assert(outputBranches.every(context => context.destinationConnections <= 1), 'no meter creates a second physical output path');
    return {engine: name, version: browser.version(), passed: true, checks, measurements, errors, consoleErrors, failed, external,
      contexts: await page.evaluate(() => __sidSynthAudit.contexts.length), outputBranches, sample: await page.evaluate(() => { const {spectrum, ...value} = __sidSynthAudit.sample(); return value; })};
  } catch (error) {
    releaseWasm?.(); releaseWasm = null;
    if (config.screenshots && page) await page.screenshot({path: path.join(config.screenshots, `${name}-failed.png`), fullPage: true}).catch(() => {});
    const status = await page?.evaluate(() => ({audio: document.querySelector('#audioStatus')?.textContent, patch: document.querySelector('#patchStatus')?.textContent})).catch(() => ({}));
    report.results.push({engine: name, passed: false, stage, error: error.message, errors, consoleErrors, failed, external, status});
    throw new Error(`${name} (${stage}): ${error.message}; ${JSON.stringify({errors, consoleErrors, failed, external, status})}`, {cause: error});
  } finally { releaseWasm?.(); await browser.close(); }
}

(async () => {
  if (config.screenshots) await fs.mkdir(config.screenshots, {recursive: true});
  report.checkerSha256 = createHash('sha256').update(await fs.readFile(__filename)).digest('hex');
  const server = http.createServer(async (request, response) => {
    try {
      const file = path.resolve(config.root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)); assert(file.startsWith(config.root + path.sep));
      const data = await fs.readFile(file);
      response.writeHead(200, {'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store'}); response.end(data);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) report.results.push(await checkEngine(name, engine, origin));
    report.passed = true;
  } finally { await new Promise(resolve => server.close(resolve)); await fs.mkdir(path.dirname(config.out), {recursive: true}); await fs.writeFile(config.out, JSON.stringify(report, null, 2) + '\n'); }
})().catch(error => { console.error(error); process.exitCode = 1; });
