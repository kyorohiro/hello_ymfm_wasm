// Exercise the authored formant lessons in their real editable Playground embeds.
// Test hooks are served from memory; no production source is rewritten on disk.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {chromium, webkit} = require('playwright');

const docs = path.resolve(__dirname, '../docs');
const artifacts = process.env.FORMANT_TEST_ARTIFACT_DIR || os.tmpdir();
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png'};

function instrumentBrowser() {
  window.__formantMetrics = {snapshots:[], canvas:{}, commands:[], errors:[]};
  for (const method of ['stroke', 'fillRect']) {
    const draw = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(...args) {
      if (['fxMonitorWave', 'fxMonitorFFT'].includes(this.canvas.id)) {
        const counts = window.__formantMetrics.canvas[this.canvas.id] ??= {};
        counts[method] = (counts[method] || 0) + 1;
      }
      return draw.apply(this, args);
    };
  }
}

async function serve() {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let filename = path.resolve(docs, '.' + pathname);
      if (!filename.startsWith(docs + path.sep)) throw Error('Invalid path');
      if ((await fs.stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
      let body = await fs.readFile(filename);
      if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() +
        '\nwindow.__formantTest = {runtime, megaDrive, get editor() { return editorAdapter; }};');
      if (pathname.endsWith('/playground_fx_monitor.js')) {
        const source = body.toString();
        assert(source.includes(' function receive(data){'), 'FX Monitor receive hook exists');
        body = Buffer.from(source.replace(' function receive(data){', ` function receive(data){
  if (visible && !document.hidden && data.id === id && data.input) {
    const snapshots = window.__formantMetrics.snapshots;
    snapshots.push({input:Array.from(data.input), output:Array.from(data.output), rate:data.rate});
    if (snapshots.length > 64) snapshots.shift();
  }`));
      }
      if (pathname.endsWith('/native_fx.js')) {
        const source = body.toString(), signature = 'export function createNativeFXController(send, {getBeatSeconds=()=>.5}={}) {';
        assert(source.includes(signature), 'native FX controller hook exists');
        body = Buffer.from(source.replace(signature, signature + `
 const testSend = send;
 send = message => {
   const metrics = globalThis.__formantMetrics;
   if (metrics) metrics.commands.push({...message, source:undefined});
   return testSend(message);
 };`));
      }
      response.writeHead(200, {'Content-Type':mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store'});
      response.end(body);
    } catch (error) { response.writeHead(404).end(String(error)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {origin:`http://127.0.0.1:${server.address().port}`, close:() => new Promise(resolve => server.close(resolve))};
}

async function prepareFrame(page, sourceId) {
  const iframe = page.locator(`iframe[data-playground-src="${sourceId}"]`);
  await iframe.scrollIntoViewIfNeeded();
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.__formantTest?.editor.kind === 'monaco');
  await frame.locator('#startupNotice').waitFor({state:'hidden'});
  await frame.locator('#workerExecution').uncheck();
  return frame;
}

async function applySource(frame, source) {
  await frame.evaluate(source => window.__formantTest.editor.setValue(source), source);
  await frame.locator('#runButton').click();
  await frame.waitForFunction(() => !document.getElementById('runButton').disabled);
}

async function observe(frame, target) {
  await frame.evaluate(() => {
    const p = window.__formantTest, rack = p.megaDrive.audio.nativeFX;
    if (!p.errorWatched) {
      const report = rack.onError;
      rack.onError = message => { window.__formantMetrics.errors.push(String(message)); report?.(message); };
      p.errorWatched = true;
    }
  });
  await frame.locator('#fxMonitorTab').click();
  await frame.locator(`#fxMonitorTarget option[value="${target}"]`).waitFor({state:'attached'});
  await frame.locator('#fxMonitorTarget').selectOption(target);
  await frame.waitForFunction(() => window.__formantMetrics.snapshots.some(x => x.input.some(v => Math.abs(v) > .0001)));
}

async function capture(frame, milliseconds = 450) {
  await frame.evaluate(() => { window.__formantMetrics.snapshots = []; });
  await frame.waitForTimeout(milliseconds);
  return frame.evaluate(async () => {
    const {spectrum} = await import('./playground_fx_monitor.js');
    const snapshots = window.__formantMetrics.snapshots;
    function summarize(key) {
      const data = snapshots.flatMap(snapshot => snapshot[key]);
      const finite = data.every(Number.isFinite);
      const rms = data.length ? Math.sqrt(data.reduce((sum, v) => sum + v*v, 0) / data.length) : 0;
      const peak = data.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
      const bins = new Array(1024).fill(0);
      const peakFrequencies = [];
      for (const snapshot of snapshots) {
        const values = spectrum(snapshot[key]);
        for (let i = 0; i < bins.length; i++) bins[i] += 10**(values[i]/10) / snapshots.length;
        let peak = Math.ceil(80 * values.length * 2 / snapshot.rate);
        for (let i = peak; i <= Math.floor(500 * values.length * 2 / snapshot.rate); i++) if (values[i] > values[peak]) peak = i;
        peakFrequencies.push(peak * snapshot.rate / (values.length * 2));
      }
      return {finite, rms, peak, bins, peakFrequencies};
    }
    const input = summarize('input'), output = summarize('output');
    let differenceSquared = 0, differenceCount = 0;
    for (const snapshot of snapshots) for (let i = 0; i < snapshot.input.length; i++) {
      differenceSquared += (snapshot.output[i] - snapshot.input[i]) ** 2; differenceCount++;
    }
    return {count:snapshots.length, rate:snapshots.at(-1)?.rate, input, output,
      relativeInputOutputError:Math.sqrt(differenceSquared / Math.max(1,differenceCount)) / Math.max(1e-12,input.rms)};
  });
}

function assertSignal(result, label) {
  assert(result.count >= 2, `${label}: real FX Monitor snapshots arrived`);
  assert([44100, 48000].includes(result.rate), `${label}: actual browser output rate is reported`);
  assert(result.input.finite && result.output.finite, `${label}: no non-finite PCM`);
  assert(result.input.rms > .0001 && result.output.rms > .0001, `${label}: both physical input and output are audible`);
  assert(result.output.peak <= 1, `${label}: output remains bounded`);
}

async function stopAndCheck(frame) {
  await frame.evaluate(() => {
    const p = window.__formantTest, context = p.megaDrive.audioContext;
    if (!p.stopMeter) {
      p.stopMeter = context.createAnalyser(); p.stopMeter.fftSize = 2048;
      const mute = context.createGain(); mute.gain.value = 0;
      p.stopMeter.connect(mute); mute.connect(context.destination);
      p.megaDrive.audio.connectOutputMonitor(p.stopMeter);
    }
  });
  await frame.locator('#stopButton').click();
  await frame.waitForFunction(() => !document.getElementById('stopButton').disabled);
  const state = await frame.evaluate(() => window.__formantTest.runtime.getState().playback);
  assert.notEqual(state, 'running', 'Stop ends the script');
  await frame.waitForTimeout(180);
  const peak = await frame.evaluate(() => {
    const pcm = new Float32Array(window.__formantTest.stopMeter.fftSize);
    window.__formantTest.stopMeter.getFloatTimeDomainData(pcm);
    return pcm.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  });
  assert(peak < 1e-5, `Stop silences output including the filter tail: ${peak}`);
  const messages = await frame.locator('#consoleOutput').textContent();
  assert(!/Effect bypassed|\[liveFx:|ReferenceError|TypeError/.test(messages), 'no liveFx runtime error: ' + messages);
  assert.deepEqual(await frame.evaluate(() => window.__formantMetrics.errors), [], 'no AudioWorklet errors');
}

function compact(result) {
  return {snapshots:result.count, rate:result.rate, inputRms:result.input.rms, outputRms:result.output.rms, peak:result.output.peak};
}

function dominantFrequency(result, low = 80, high = 500) {
  const bins = result.input.bins, step = result.rate / (bins.length * 2);
  let peak = Math.ceil(low / step);
  for (let bin = peak; bin <= Math.floor(high / step); bin++) if (bins[bin] > bins[peak]) peak = bin;
  return peak * step;
}

function spectralDistance(a, b, key = 'output') {
  const normalize = values => {
    const total = values.reduce((sum, v) => sum + v, 0);
    return values.map(v => v / total);
  };
  const x = normalize(a[key].bins), y = normalize(b[key].bins);
  return x.reduce((sum, v, index) => sum + Math.abs(v - y[index]), 0);
}

function highFrequencyFraction(result, cutoff = 500) {
  const bins = result.input.bins, first = Math.ceil(cutoff * bins.length * 2 / result.rate);
  return bins.slice(first).reduce((sum,v) => sum + v,0) / bins.reduce((sum,v) => sum + v,0);
}

// The lesson-specific checks below are intentionally coupled to the editable
// parameter names in the examples: this catches drift between prose and code.

async function checkExistingLesson(page, origin, name, id, target) {
  await page.goto(`${origin}/introductions/tetorica-fx-${name}.html`);
  const source = await page.locator(`script[id="${id}"]`).textContent();
  const frame = await prepareFrame(page, id);
  await applySource(frame, source);
  await observe(frame, target);
  const original = await capture(frame, 800);
  assertSignal(original, name);
  if (name === 'gain') {
    const edited = source.replace('cycle([0.25, 0.5, 1.0])', 'cycle([1.0])');
    assert.notEqual(edited, source, 'Gain experiment retains its documented editable cycle');
    await applySource(frame, edited); await observe(frame, target);
    await frame.waitForTimeout(1400);
    const applied = await capture(frame, 800);
    assertSignal(applied, 'Gain Apply');
    assert(Math.abs(applied.output.rms / applied.input.rms - 1) < .001, 'Gain Apply changes actual DSP output to unity');
  }
  await stopAndCheck(frame);
  return {lesson:name, ...compact(original)};
}

async function registration(frame, target) {
  return frame.evaluate(target => window.__formantMetrics.commands.findLast(command => command.op === 'live-fx' && command.action === 'register' && command.name === target), target);
}

async function checkDiagnostics(frame, label) {
  const diagnostics = await frame.evaluate(async () => {
    const model = monaco.editor.getEditors().find(editor => editor.getModel()?.uri.path.startsWith('/project/'))?.getModel();
    if (!model) throw Error('Lesson is not open in the real Monaco editor');
    const factory = await monaco.languages.typescript.getJavaScriptWorker();
    const worker = await factory(model.uri), uri = model.uri.toString();
    const [syntax, semantic] = await Promise.all([worker.getSyntacticDiagnostics(uri), worker.getSemanticDiagnostics(uri)]);
    const ignored = monaco.languages.typescript.javascriptDefaults.getDiagnosticsOptions().diagnosticCodesToIgnore || [];
    const flatten = value => typeof value === 'string' ? value : [value.messageText, ...(value.next || []).map(flatten)].join('\n');
    return [...syntax,...semantic].filter(item => !ignored.includes(item.code)).map(item => ({code:item.code, message:flatten(item.messageText), start:item.start}));
  });
  assert.deepEqual(diagnostics, [], `${label}: no Monaco syntax/semantic diagnostics`);
}

function replaceParameter(source, name, value) {
  const pattern = new RegExp(`(${name}:\\s*)(?:true|false|[-+]?\\d+(?:\\.\\d+)?)\\b`);
  const edited = source.replace(pattern, (_, prefix) => prefix + value);
  assert.notEqual(edited, source, `documented editable ${name} parameter exists`);
  return edited;
}

function fixedVowelSource(source, vowel) {
  let edited = source.replace(/autoVowels:\s*true\b/, 'autoVowels: false');
  edited = edited.replace(/(vowel:\s*)0\b/, (_, prefix) => prefix + vowel);
  return edited;
}

function fixedPitchVowelSource(source) {
  return source.replace(/(?:const|let) experiment\s*=\s*["']A["']/, 'let experiment = "B"')
    .replace(/\[carrierHz,\s*carrierHz\s*\*\s*1\.25,\s*carrierHz\s*\*\s*1\.5,\s*carrierHz\s*\*\s*1\.25\]/, '[carrierHz]');
}

function replaceConstant(source, name, from, to) {
  const pattern = new RegExp(`(const ${name}\\s*=\\s*)${from}\\b`);
  const edited = source.replace(pattern, (_,prefix) => prefix + to);
  assert.notEqual(edited, source, `editable ${name} constant exists`);
  return edited;
}

async function checkFormantLesson(page, origin, kind, browserName) {
  const id = `formant-${kind}`;
  await page.goto(`${origin}/introductions/tetorica-fx-${id}.html`);
  const source = await page.locator(`script[id="${id}"]`).textContent();
  const frame = await prepareFrame(page, id);
  await applySource(frame, source);
  await checkDiagnostics(frame, id);
  await observe(frame, id);
  const initial = await capture(frame, 1400);
  assertSignal(initial, id);
  const installed = await registration(frame, id);
  assert(installed && !installed.resetState, 'same-name Apply preserves the resonator state');
  assert(!Object.hasOwn(installed.context, 'sampleRate'), 'lesson uses the actual AudioWorklet sample rate');
  await frame.locator('#fxMonitorMode').selectOption('spectrum');
  await frame.waitForTimeout(200);
  assert(await frame.locator('#fxMonitorSpectrumView').isVisible(), 'Spectrum view is visible');
  assert((await frame.evaluate(() => window.__formantMetrics.canvas.fxMonitorFFT?.stroke)) > 0, 'Spectrum paints input and output');
  await page.screenshot({path:path.join(artifacts, `formant-${kind}-${browserName}.png`)});
  await frame.locator('#fxMonitorMode').selectOption('waveform');

  const result = {lesson:id, initial:compact(initial)};
  if (kind === 'vowels') {
    const a = fixedVowelSource(source, 0), i = fixedVowelSource(source, 1);
    assert.notEqual(a, source, 'vowel sequence can be disabled');
    assert.notEqual(a, i, 'vowel selection is editable');
    await applySource(frame, a); await observe(frame, id); await frame.waitForTimeout(300);
    const before = await capture(frame, 550);
    await applySource(frame, i); await observe(frame, id); await frame.waitForTimeout(300);
    const after = await capture(frame, 550);
    assertSignal(before, 'fixed あ'); assertSignal(after, 'fixed い');
    const f0a = dominantFrequency(before), f0i = dominantFrequency(after), distance = spectralDistance(before, after);
    assert(Math.abs(f0a - 130) < 25 && Math.abs(f0i - 130) < 25, `vowel change preserves source pitch (${f0a}, ${f0i})`);
    assert(distance > .2, `changing vowel changes the measured spectral envelope: ${distance}`);
    result.vowels = {inputHz:[f0a,f0i], spectralDistance:distance, before:compact(before), after:compact(after)};
  }
  if (kind === 'voice') {
    const staticSource = replaceParameter(source, 'lfoDepth', 0);
    await applySource(frame, staticSource); await observe(frame, id); await frame.waitForTimeout(300);
    const before = await capture(frame, 1500);
    const movingSource = replaceParameter(source, 'lfoDepth', .6);
    await applySource(frame, movingSource); await observe(frame, id); await frame.waitForTimeout(300);
    const after = await capture(frame, 1500);
    assertSignal(before, 'voice static'); assertSignal(after, 'voice LFO');
    const distance = spectralDistance(before, after);
    assert(distance > .05, `LFO depth changes the measured formant envelope: ${distance}`);
    result.lfo = {spectralDistance:distance, before:compact(before), after:compact(after)};
  }
  if (kind === 'pitch') {
    // Keep the authored DSP and fixed-vowel experiment; make the pitch list
    // constant so the two source frequencies can be compared unambiguously.
    const fixed = source.replace(/(?:const|let) experiment\s*=\s*["']A["']/, 'let experiment = "B"')
      .replace(/\[carrierHz,\s*carrierHz\s*\*\s*1\.25,\s*carrierHz\s*\*\s*1\.5,\s*carrierHz\s*\*\s*1\.25\]/, '[carrierHz]');
    assert.notEqual(fixed, source, 'B fixes the vowel while changing source pitch');
    await applySource(frame, fixed); await observe(frame, id); await frame.waitForTimeout(900);
    const before = await capture(frame, 550), beforeCommand = await registration(frame, id);
    const high = fixed.replace(/const carrierHz\s*=\s*130\b/, 'const carrierHz = 390');
    assert.notEqual(high, fixed, 'source frequency is independently editable');
    await applySource(frame, high); await observe(frame, id); await frame.waitForTimeout(900);
    const after = await capture(frame, 550), afterCommand = await registration(frame, id);
    assertSignal(before, 'pitch low'); assertSignal(after, 'pitch high');
    assert.deepEqual(afterCommand.context, beforeCommand.context, 'pitch changes do not change the formant parameters');
    const lowHz = dominantFrequency(before), highHz = dominantFrequency(after);
    assert(Math.abs(lowHz - 130) < 25 && Math.abs(highHz - 390) < 25, `independent source pitch reaches both frequencies: ${lowHz}, ${highHz}`);
    result.pitch = {inputHz:[lowHz,highHz], before:compact(before), after:compact(after)};
    const simultaneous = source.replace(/(?:const|let) experiment\s*=\s*["']A["']/, 'let experiment = "C"');
    await applySource(frame, simultaneous); await observe(frame, id); await frame.waitForTimeout(900);
    const both = await capture(frame, 2100), simultaneousCommand = await registration(frame, id);
    assertSignal(both, 'pitch and vowel C');
    assert.equal(simultaneousCommand.context.autoVowels, true, 'C enables formant movement');
    assert(Math.max(...both.input.peakFrequencies) - Math.min(...both.input.peakFrequencies) > 35, 'C also moves the independently controlled source pitch');
    result.simultaneous = {inputHzRange:[Math.min(...both.input.peakFrequencies),Math.max(...both.input.peakFrequencies)], ...compact(both)};
  }
  await stopAndCheck(frame);
  return result;
}

async function checkJapaneseWorker(page, origin, browserName) {
  await page.goto(`${origin}/introductions/tetorica-fx-formant-vowels_ja.html`);
  assert.equal(await page.locator('html').getAttribute('lang'), 'ja');
  assert.match(await page.locator('h1').textContent(), /母音/);
  const source = await page.locator('script[id="formant-vowels"]').textContent();
  await page.screenshot({path:path.join(artifacts, `formant-vowels-ja-article-${browserName}.png`)});
  const frame = await prepareFrame(page, 'formant-vowels');
  await frame.locator('#workerExecution').check();
  await applySource(frame, source); await observe(frame, 'formant-vowels');
  const initial = await capture(frame, 650); assertSignal(initial, 'Japanese Worker Run');
  await applySource(frame, fixedVowelSource(source, 3)); await observe(frame, 'formant-vowels');
  await frame.waitForTimeout(800);
  const applied = await capture(frame, 650); assertSignal(applied, 'Japanese Worker Apply');
  await frame.locator('#fxMonitorMode').selectOption('spectrum'); await frame.waitForTimeout(200);
  await page.screenshot({path:path.join(artifacts, `formant-vowels-ja-monitor-${browserName}.png`)});
  await stopAndCheck(frame);
  return {lesson:'formant-vowels-ja-worker', initial:compact(initial), applied:compact(applied)};
}

async function checkYm2612Lesson(page, origin, browserName, {japanese = false, worker = false} = {}) {
  const id = 'formant-ym2612', suffix = japanese ? '_ja' : '';
  await page.goto(`${origin}/introductions/tetorica-fx-${id}${suffix}.html`);
  assert.equal(await page.locator('html').getAttribute('lang'), japanese ? 'ja' : 'en');
  assert.match(await page.locator('h1').textContent(), /YM2612/);
  const source = await page.locator(`script[id="${id}"]`).textContent();
  if (japanese) await page.screenshot({path:path.join(artifacts, `formant-ym2612-ja-article-${browserName}.png`)});
  const frame = await prepareFrame(page, id);
  if (worker) await frame.locator('#workerExecution').check();
  await applySource(frame, source);
  await checkDiagnostics(frame, `${id}${suffix}`);
  await observe(frame, id);
  const initial = await capture(frame, 700); assertSignal(initial, `${id} initial`);
  await frame.locator('#fxMonitorMode').selectOption('spectrum'); await frame.waitForTimeout(200);
  assert(await frame.locator('#fxMonitorSpectrumView').isVisible());
  await page.screenshot({path:path.join(artifacts, `formant-ym2612${japanese ? '-ja' : ''}-monitor-${browserName}.png`)});
  await frame.locator('#fxMonitorMode').selectOption('waveform');

  const fixed = fixedPitchVowelSource(source);
  assert.notEqual(fixed, source, 'YM2612 B can hold a fixed source pitch and vowel');
  const drySource = replaceParameter(fixed, 'mix', 0);
  const settle = worker ? 1400 : 800; // Include Worker lookahead before the smoothing tail.
  await applySource(frame, drySource); await observe(frame, id); await frame.waitForTimeout(settle);
  const dry = await capture(frame, 550); assertSignal(dry, `${id} mix0`);
  assert(dry.relativeInputOutputError < .001, `mix0 passes actual source PCM through after smoothing: ${dry.relativeInputOutputError}`);
  await applySource(frame, fixed); await observe(frame, id); await frame.waitForTimeout(settle);
  const wet = await capture(frame, 550); assertSignal(wet, `${id} mix1`);
  const wetDistance = spectralDistance({output:wet.input}, wet);
  assert(wet.relativeInputOutputError > .1 && wetDistance > .1, `mix1 shapes actual YM2612 input: ${wet.relativeInputOutputError}, ${wetDistance}`);
  const result = {lesson:`${id}${japanese ? '-ja' : ''}${worker ? '-worker' : ''}`, initial:compact(initial),
    mix:{dryRelativeError:dry.relativeInputOutputError, wetRelativeError:wet.relativeInputOutputError, wetSpectralDistance:wetDistance}};

  if (!worker) {
    const sineSource = replaceConstant(fixed, 'feedback', 6, 0);
    await applySource(frame, sineSource); await observe(frame, id); await frame.waitForTimeout(650);
    const sine = await capture(frame, 550); assertSignal(sine, 'YM2612 feedback0');
    const lowCommand = await registration(frame, id);
    await applySource(frame, fixed); await observe(frame, id); await frame.waitForTimeout(650);
    const bright = await capture(frame, 550); assertSignal(bright, 'YM2612 feedback6');
    const pureHigh = highFrequencyFraction(sine), brightHigh = highFrequencyFraction(bright), distance = spectralDistance(sine, bright, 'input');
    assert(brightHigh > pureHigh * 5 && brightHigh > .01 && distance > .1,
      `feedback creates real source harmonics: ${JSON.stringify({pureHigh,brightHigh,distance})}`);
    const highSource = replaceConstant(sineSource, 'carrierHz', 130, 260);
    await applySource(frame, highSource); await observe(frame, id); await frame.waitForTimeout(800);
    const high = await capture(frame, 550); assertSignal(high, 'YM2612 pitch260');
    const highCommand = await registration(frame, id);
    assert.deepEqual(highCommand.context, lowCommand.context, 'YM2612 source pitch changes independently of all formant parameters');
    const lowHz = dominantFrequency(sine), highHz = dominantFrequency(high);
    assert(Math.abs(lowHz - 130) < 25 && Math.abs(highHz - 260) < 25, `YM2612 source pitch130→260: ${lowHz}, ${highHz}`);
    result.feedback = {sineHighFrequencyFraction:pureHigh, brightHighFrequencyFraction:brightHigh, sourceSpectralDistance:distance};
    result.pitch = {inputHz:[lowHz,highHz], low:compact(sine), high:compact(high)};
  }
  await stopAndCheck(frame);
  return result;
}

async function attachOutputMeter(page) {
  await page.evaluate(() => {
    const p = window.__formantTest, context = p.megaDrive.audioContext;
    p.keyboardMeter = context.createAnalyser(); p.keyboardMeter.fftSize = 4096;
    const mute = context.createGain(); mute.gain.value = 0;
    p.keyboardMeter.connect(mute); mute.connect(context.destination);
    p.megaDrive.audio.connectOutputMonitor(p.keyboardMeter);
  });
}

async function keyboardOutput(page) {
  return page.evaluate(() => {
    const meter = window.__formantTest.keyboardMeter, pcm = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(pcm);
    return {finite:pcm.every(Number.isFinite), peak:pcm.reduce((max,v) => Math.max(max,Math.abs(v)),0),
      rms:Math.sqrt(pcm.reduce((sum,v) => sum + v*v,0) / pcm.length)};
  });
}

// One existing monitor request observes the live effect while the Keyboard tab
// stays selected. Changing tabs would deliberately release its held notes.
async function heldKeyboardAudio(page, expectedHz) {
  return page.evaluate(expectedHz => new Promise((resolve,reject) => {
    const p = window.__formantTest, rack = p.megaDrive.audio.nativeFX;
    const previous = rack.onMonitor, id = 1000000 + (p.keyboardMonitorId = (p.keyboardMonitorId || 0) + 1);
    const timeout = setTimeout(() => {rack.onMonitor = previous; reject(Error('Keyboard liveFx capture timed out'));}, 5000);
    rack.onMonitor = data => {
      if (data.id !== id) {previous?.(data); return;}
      clearTimeout(timeout); rack.onMonitor = previous;
      if (!data.input?.length) {reject(Error('Singing keyboard liveFx is not registered')); return;}
      const summarize = values => ({finite:values.every(Number.isFinite), peak:values.reduce((max,v) => Math.max(max,Math.abs(v)),0),
        rms:Math.sqrt(values.reduce((sum,v) => sum + v*v,0) / values.length)});
      const mean = data.input.reduce((sum,v) => sum + v,0) / data.input.length;
      let best = {correlation:-1, hz:null};
      for (let lag = Math.floor(data.rate / (expectedHz * 1.04)); lag <= Math.ceil(data.rate / (expectedHz * .96)); lag++) {
        let cross = 0, a2 = 0, b2 = 0;
        for (let i = lag; i < data.input.length; i++) {
          const a = data.input[i] - mean, b = data.input[i-lag] - mean;
          cross += a*b; a2 += a*a; b2 += b*b;
        }
        const correlation = cross / Math.sqrt(a2*b2);
        if (correlation > best.correlation) best = {correlation, hz:data.rate/lag};
      }
      resolve({rate:data.rate, input:summarize(data.input), output:summarize(data.output), pitch:best});
    };
    rack.node.port.postMessage({op:'fx-monitor', enabled:true, id, name:'formant-ym2612', channel:0});
  }), expectedHz);
}

function assertKeyboardAudio(result, expectedHz, label) {
  assert(result.input.finite && result.output.finite, `${label}: real Worklet PCM is finite`);
  assert(result.input.rms > .001 && result.output.rms > .0001, `${label}: keyboard reaches the formant filter`);
  assert(result.output.peak <= 1, `${label}: processed output is bounded`);
  // Feedback6 enriches and slightly varies the waveform between periods;
  // the repeated source pitch must remain clear without requiring pure sine PCM.
  assert(result.pitch.correlation > .9 && Math.abs(result.pitch.hz - expectedHz) < 4,
    `${label}: held note remains at ${expectedHz} Hz, not automatic130 Hz: ${JSON.stringify(result.pitch)}`);
}

async function checkBundledSingingKeyboard(page, origin, browserName, execution) {
  const filePath = '/examples/basic/singing-keyboard.js';
  await page.goto(`${origin}/playground/index.html?mode=full&expanded=1`);
  await page.waitForFunction(() => window.__formantTest?.editor.kind === 'monaco');
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  await page.locator('#workerExecution').setChecked(execution === 'worker');
  for (const folder of ['/examples','/examples/basic']) {
    const label = page.locator(`summary[data-file-path="${folder}"]`);
    if (!await label.evaluate(element => element.parentElement.open)) await label.click();
  }
  const example = page.locator(`button.file-entry[data-file-path="${filePath}"]`);
  await example.click();
  assert.equal(await page.locator('#runFileSelect').inputValue(), filePath, 'opening Basic example selects the real Run file');
  assert.equal(await page.locator(`#runFileSelect optgroup[label="/examples/basic"] option[value="${filePath}"]`).count(), 1,
    'singing keyboard appears in the Basic root');
  assert.match(await page.evaluate(() => window.__formantTest.editor.getValue()), /let experiment = ['"]K['"]/);
  await checkDiagnostics(page, 'bundled singing keyboard');
  await page.screenshot({path:path.join(artifacts, `singing-keyboard-files-${browserName}-${execution}.png`)});
  await page.locator('#runButton').click();
  await page.waitForFunction(() => !document.getElementById('runButton').disabled);
  await attachOutputMeter(page);
  await page.waitForTimeout(execution === 'worker' ? 800 : 200);
  const initial = await keyboardOutput(page);
  assert(initial.peak < 1e-5, 'K mode does not start an automatic source note');
  await page.locator('#keyboardTab').click();
  await page.locator('#playgroundKeyboardChannelMode').selectOption('fixed');
  await page.locator('#playgroundKeyboardChannel').selectOption('0');
  await page.locator('#playgroundKeyboardPreset').selectOption('');
  const keys = await page.locator('#operatorKeyboardRoot .key').evaluateAll(buttons => {
    const key = (note, letterOnly = false) => {
      const button = buttons.find(button => button.querySelector('span')?.textContent === note && (!letterOnly || /^[a-z]$/.test(button.dataset.key)));
      if (!button) throw Error('Default Guitar layout does not show ' + note);
      return button.dataset.key;
    };
    return {a:key('A3'), computer:key('B3',true)};
  });
  const pointerKey = page.locator(`#operatorKeyboardRoot .key[data-key="${keys.a}"]`);
  await pointerKey.scrollIntoViewIfNeeded();
  const bounds = await pointerKey.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2); await page.mouse.down();
  await page.waitForTimeout(220);
  const pointerFirst = await heldKeyboardAudio(page, 220); assertKeyboardAudio(pointerFirst, 220, 'pointer press');
  await page.waitForTimeout(900);
  const pointerLater = await heldKeyboardAudio(page, 220); assertKeyboardAudio(pointerLater, 220, 'pointer held beyond control-loop boundary');
  await page.screenshot({path:path.join(artifacts, `singing-keyboard-keys-${browserName}-${execution}.png`)});
  await page.mouse.up(); await page.waitForTimeout(350);
  const released = await keyboardOutput(page); assert(released.peak < .0001, `pointer release ends the note: ${released.peak}`);
  // Real PC input after leaving Code; derive its binding from the shown key.
  await page.locator('#codeTab').click();
  await page.locator('#editorHost .monaco-editor').click();
  await page.locator('#keyboardTab').click();
  assert(!await page.evaluate(() => document.activeElement?.closest('.monaco-editor')), 'Code editor focus has been left');
  await page.keyboard.down(keys.computer); await page.waitForTimeout(220);
  const typed = await heldKeyboardAudio(page, 246.9416506); assertKeyboardAudio(typed, 246.9416506, 'PC letter press after leaving Code');
  await page.waitForTimeout(900);
  const typedLater = await heldKeyboardAudio(page, 246.9416506); assertKeyboardAudio(typedLater, 246.9416506, 'PC letter held beyond control-loop boundary');
  await stopAndCheck(page); await page.keyboard.up(keys.computer);
  return {lesson:'bundled-singing-keyboard', execution, initial, pointerFirst, pointerLater, released, typed, typedLater};
}

async function checkBrowser(name, type, origin) {
  const browser = await type.launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  try {
    const context = await browser.newContext({viewport:{width:1280,height:1000}, serviceWorkers:'block'});
    await context.addInitScript(instrumentBrowser);
    const results = [];
    const onlyYm2612 = process.argv.includes('--only-ym2612');
    if (process.argv.includes('--only-keyboard')) {
      for (const execution of ['main','worker']) {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
        results.push(await checkBundledSingingKeyboard(page, origin, name, execution));
        assert.deepEqual(errors, [], `${execution}: bundled keyboard has no page errors`);
        await page.close();
      }
      console.log(JSON.stringify({browser:name, passed:true, results})); return;
    }
    if (!process.argv.includes('--only-existing') && !onlyYm2612) for (const kind of ['vowels','voice','pitch']) {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(15000);
      results.push(await checkFormantLesson(page, origin, kind, name));
      assert.deepEqual(errors, [], `${kind}: no page errors`);
      await page.close();
    }
    if (!process.argv.includes('--only-existing') && !onlyYm2612) {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
      results.push(await checkJapaneseWorker(page, origin, name));
      assert.deepEqual(errors, [], 'Japanese Worker: no page errors');
      await page.close();
    }
    if (!process.argv.includes('--only-existing')) for (const settings of [{}, {japanese:true,worker:true}]) {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
      results.push(await checkYm2612Lesson(page, origin, name, settings));
      assert.deepEqual(errors, [], `YM2612 ${settings.worker ? 'Worker' : 'Main'}: no page errors`);
      await page.close();
    }
    if (!onlyYm2612) for (const [name,id,target] of [['gain','gain-live','gain-lab'],['slicer','slicer-live','slicer-lab']]) {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(15000);
      results.push(await checkExistingLesson(page, origin, name, id, target));
      assert.deepEqual(errors, [], `${name}: no page errors`);
      await page.close();
    }
    console.log(JSON.stringify({browser:name, passed:true, results}));
  } finally { await browser.close(); }
}

(async () => {
  const server = await serve();
  try {
    const selected = process.argv.includes('--chromium') ? [['chromium',chromium]]
      : process.argv.includes('--webkit') ? [['webkit',webkit]] : [['chromium',chromium],['webkit',webkit]];
    for (const [name,type] of selected) await checkBrowser(name, type, server.origin);
  } finally { await server.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});

