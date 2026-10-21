// Actual Playground/WASM capture in fresh Chromium and WebKit contexts.
// The HTTP response exposes test accessors; production files and renderers stay intact.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require('playwright');
const root = path.resolve(__dirname, '..'), docs = path.join(root, 'docs');
const outputOption = process.argv.find(value => value.startsWith('--out='));
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml'};
const accessor = '\nwindow.__audioDiagTest={runtime,get diagnostics(){return audioDiagnostics},get editor(){return editorAdapter}};';
const source = `setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
const notes = ['E3','G3','A3','B3','D4','E4','G4','A4','B4','D5'];
let index = 0;
liveLoop('diagnostic-phrase', async () => {
  await play(notes[index++ % notes.length], {channel: CH1, duration: 0.8});
  await beat(cycle([0.04, 0.04, 0.08]));
});`;
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let file = path.resolve(docs, '.' + pathname);
    if (!file.startsWith(docs + path.sep)) throw Error('Invalid path');
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    let body = await fs.readFile(file);
    if (pathname.endsWith('/playground.js')) body = Buffer.from(body.toString() + accessor);
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(body);
  } catch (error) { response.writeHead(404).end(String(error)); }
});

function observeDiagnosticNodes() {
  globalThis.__diagnosticNodes = [];
  globalThis.AudioWorkletNode = new Proxy(globalThis.AudioWorkletNode, {
    construct(Type, args, Target) {
      const node = Reflect.construct(Type, args, Target);
      if (args[1] === 'tetorica-audio-diagnostic') {
        const state = {closed:false, disconnected:false};
        const close = node.port.close.bind(node.port), disconnect = node.disconnect.bind(node);
        node.port.close = () => {state.closed = true; return close();};
        node.disconnect = (...args) => {state.disconnected = true; return disconnect(...args);};
        globalThis.__diagnosticNodes.push(state);
      }
      return node;
    },
  });
}

async function checkBrowser(name, type, url, artifacts) {
  const browser = await type.launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
  const context = await browser.newContext({serviceWorkers:'block', acceptDownloads:true});
  try {
    const page = await context.newPage(), errors = [], requests = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.addInitScript(observeDiagnosticNodes);
    await page.goto(url);
    await page.waitForFunction(() => window.__audioDiagTest?.editor?.kind === 'monaco');
    assert.equal(await page.locator('.audio-diagnostics').count(), 0);
    assert.equal(requests.some(url => /playground_audio_diagnostics\.js|audio-diagnostic-worklet\.js/.test(url)), false);
    const hadAudio = await page.evaluate(() => Boolean(window.__audioDiagTest.runtime.megaDrive.audioContext));
    await page.locator('#mainMenu > summary').click();
    await page.click('#audioDiagnosticsButton');
    await page.waitForFunction(() => Boolean(window.__audioDiagTest.diagnostics));
    assert.equal(await page.evaluate(() => Boolean(window.__audioDiagTest.runtime.megaDrive.audioContext)), hadAudio);
    assert.equal(await page.evaluate(() => window.__diagnosticNodes.length), 0);
    await page.getByRole('button', {name:'Close diagnostics', exact:true}).click();
    assert.equal(await page.locator('.audio-diagnostics').count(), 0);
    requests.length = 0;
    await page.goto(url + '&audio-diagnostic=1');
    await page.waitForFunction(() => window.__audioDiagTest?.editor?.kind === 'monaco' && window.__audioDiagTest.diagnostics);
    const panel = page.getByRole('region', {name:'Audio diagnostics'});
    assert.equal(await panel.count(), 1);
    await page.evaluate(source => {
      document.getElementById('workerExecution').checked = false;
      window.__audioDiagTest.editor.setValue(source);
    }, source);
    await page.click('#runButton');
    await page.waitForFunction(() => window.__audioDiagTest.runtime.megaDrive.audioContext?.state === 'running' && window.__audioDiagTest.runtime.getState().playback === 'running');
    const initialMonitors = await page.evaluate(() => window.__audioDiagTest.runtime.megaDrive.audio.outputMonitors.size);
    await panel.getByRole('button', {name:'Record 30 s', exact:true}).click();
    await page.waitForFunction(() => window.__audioDiagTest.diagnostics.getState().recording);
    await page.waitForTimeout(1000);
    await panel.getByRole('button', {name:'Mark noise', exact:true}).click();
    await panel.getByRole('button', {name:'Stop recording', exact:true}).click();
    await page.waitForFunction(() => window.__audioDiagTest.diagnostics.getState().hasResult);
    const capture = await page.evaluate(() => {
      const {runtime, diagnostics} = window.__audioDiagTest;
      const {channels, report} = diagnostics.getResult(), {frames} = report.capture;
      const peaks = [], nonFinite = [], lengths = channels.map(channel => channel.length);
      let maxDifference = 0;
      for (const channel of channels) {
        let peak = 0, invalid = 0;
        for (let i = 0; i < frames; i++) {peak = Math.max(peak, Math.abs(channel[i])); if (!Number.isFinite(channel[i])) invalid++;}
        peaks.push(peak); nonFinite.push(invalid);
      }
      for (let i = 0; i < frames; i++) for (let ch = 0; ch < 2; ch++) maxDifference = Math.max(maxDifference, Math.abs(channels[ch][i] - channels[ch + 2][i]));
      return {report, lengths, peaks, nonFinite, maxDifference, playback:runtime.getState().playback,
        monitors:runtime.megaDrive.audio.outputMonitors.size, nodes:window.__diagnosticNodes};
    });
    assert(capture.report.capture.frames > 1000);
    assert.equal(new Set(capture.lengths).size, 1);
    assert(capture.lengths.every(length => length >= capture.report.capture.frames));
    assert(capture.peaks.every(peak => peak > .001));
    assert.deepEqual(capture.nonFinite, [0, 0, 0, 0]);
    assert.equal(capture.maxDifference, 0, `${name}: chip and output PCM differ`);
    assert.equal(capture.report.capture.frameGaps, 0);
    assert.deepEqual(capture.report.capture.missingInputFrames, [0, 0]);
    assert.equal(capture.report.marks.length, 1);
    assert.equal(capture.playback, 'running');
    assert.equal(capture.monitors, initialMonitors);
    assert(capture.nodes.every(node => node.closed && node.disconnected));
    await page.screenshot({path:path.join(artifacts, name + '-audio-diagnostics.png')});
    const downloads = {};
    for (const [kind, label] of [['chip','Save chip WAV'],['output','Save output WAV'],['json','Save JSON']]) {
      const waiting = page.waitForEvent('download');
      await panel.getByRole('button', {name:label, exact:true}).click();
      const download = await waiting, destination = path.join(artifacts, name + '-' + download.suggestedFilename());
      await download.saveAs(destination); downloads[kind] = destination;
    }
    const savedReport = JSON.parse(await fs.readFile(downloads.json, 'utf8'));
    assert.deepEqual(savedReport, capture.report);
    const decoded = [];
    for (const kind of ['chip', 'output']) {
      const bytes = await fs.readFile(downloads[kind]);
      assert.equal(bytes.readUInt16LE(20), 3, 'WAV must retain Float32 samples');
      const info = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const audio = await window.__audioDiagTest.runtime.megaDrive.audioContext.decodeAudioData(bytes.buffer);
        let peak = 0;
        for (const sample of audio.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
        return {length:audio.length, channels:audio.numberOfChannels, sampleRate:audio.sampleRate, peak};
      }, bytes.toString('base64'));
      assert.equal(info.length, capture.report.capture.frames); assert.equal(info.channels, 2);
      assert.equal(info.sampleRate, capture.report.capture.sampleRate); assert(info.peak > .001);
      decoded.push(info);
    }
    await panel.getByRole('button', {name:'Close diagnostics', exact:true}).click();
    assert.equal(await panel.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.__audioDiagTest.diagnostics.getState()), {phase:'disposed', recording:false, hasResult:false});
    assert.equal(await page.evaluate(() => window.__audioDiagTest.diagnostics.getResult()), null);
    assert.equal(await page.evaluate(() => window.__audioDiagTest.runtime.getState().playback), 'running');
    assert.equal(capture.nodes.length, 1);
    // WebKit may fail the external Monaco language worker's importScripts.
    // Keep that known editor-only failure visible; every other page error fails.
    const monacoFailure = errors.some(error => error.startsWith('Load failed\n') && error.includes('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/base/worker/workerMain.js'));
    const editorErrors = monacoFailure ? errors.filter(error => error === 'NetworkError: Load failed' || error.startsWith('Load failed\n') && error.includes('/monaco-editor/0.52.2/min/vs/base/worker/workerMain.js')) : [];
    assert.deepEqual(errors.filter(error => !editorErrors.includes(error)), []);
    await fs.writeFile(path.join(artifacts, name + '-summary.json'), JSON.stringify({capture, decoded, editorErrors}, null, 2));
    await page.evaluate(() => window.__audioDiagTest.runtime.finalize());
    console.log(`${name}: PASS ${capture.report.capture.frames} frames, four channels, float WAV decode, JSON download, cleanup`);
    if (editorErrors.length) console.log(`${name}: ${editorErrors.length} unrelated Monaco CDN worker errors retained in summary`);
  } finally { await context.close(); await browser.close(); }
}

(async () => {
  const artifacts = outputOption ? path.resolve(outputOption.slice(6)) : await fs.mkdtemp(path.join(os.tmpdir(), 'playground-audio-diagnostic-'));
  await fs.mkdir(artifacts, {recursive:true});
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  try {
    const url = `http://127.0.0.1:${server.address().port}/playground/index.html?mode=genesis`;
    for (const [name, type] of [['chromium',chromium],['webkit',webkit]]) {
      if (!process.argv.includes('--chromium') && !process.argv.includes('--webkit') || process.argv.includes('--' + name)) await checkBrowser(name, type, url, artifacts);
    }
    console.log('Artifacts: ' + artifacts);
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error); process.exitCode = 1;});
