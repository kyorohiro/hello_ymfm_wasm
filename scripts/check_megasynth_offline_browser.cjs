// Run after build:fm2612. Compare Node PCM with browser PCM and native Worklet FX.
const {chromium} = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/fm2612');
async function bounded(promise, label, timeout = 30000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout} ms`)), timeout);
    })]);
  } finally {clearTimeout(timer);}
}
function checkPcm(values, label) {
  assert.equal(values.length, 4096, `${label}: PCM frame count`);
  assert(values.every(Number.isFinite), `${label}: non-finite PCM`);
  assert(values.some(value => value !== 0), `${label}: silent positive control`);
}
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {response.setHeader('Content-Type', 'text/html'); response.end('<p>Offline audio test</p>'); return;}
    if (!pathname.startsWith('/vendor/')) throw new Error('Unknown path');
    const file = path.resolve(root, '.' + pathname.slice('/vendor'.length));
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    response.end(await fs.readFile(file));
  } catch (error) {response.statusCode = 404; response.end(error.message);}
});
(async () => {
  const {createMegaSynthOffline} = await import(pathToFileURL(path.join(root, 'megasynth_offline.js')));
  const {FM_PRESETS} = await import(pathToFileURL(path.join(root, 'megasynth-fm-presets.js')));
  const node = await createMegaSynthOffline();
  let expected;
  try {
    node.fm.setPreset(0, FM_PRESETS.sine);
    node.schedule(0, {target: 'fm', method: 'noteOn', args: [0, 4, 553]});
    node.schedule(1024, {target: 'fm', method: 'noteOff', args: [0]});
    node.fx.setChain([node.fx.delay({time: .01, mix: .25}), node.fx.reverb({mix: .15})]);
    expected = node.render(4096);
  } finally {node.close();}
  checkPcm(expected.left, 'Node left'); checkPcm(expected.right, 'Node right');
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {server.off('error', reject); resolve();});
    });
    browser = await chromium.launch();
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {if (response.status() >= 400) errors.push(response.url());});
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.goto('http://127.0.0.1:' + server.address().port);
    const result = await bounded(page.evaluate(async () => {
      const {createMegaSynthOffline} = await import('/vendor/megasynth_offline.js');
      const {FM_PRESETS} = await import('/vendor/megasynth-fm-presets.js');
      const {createNativeFXController} = await import('/vendor/native_fx.js');
      const offline = await createMegaSynthOffline();
      let pcm;
      try {
        offline.fm.setPreset(0, FM_PRESETS.sine);
        offline.schedule(0, {target: 'fm', method: 'noteOn', args: [0, 4, 553]});
        offline.schedule(1024, {target: 'fm', method: 'noteOff', args: [0]});
        offline.fx.setChain([offline.fx.delay({time: .01, mix: .25}), offline.fx.reverb({mix: .15})]);
        pcm = offline.render(4096);
      } finally {offline.close();}
      const dry = await createMegaSynthOffline();
      let input;
      try {
        dry.fm.setPreset(0, FM_PRESETS.sine);
        dry.schedule(0, {target: 'fm', method: 'noteOn', args: [0, 4, 553]});
        dry.schedule(1024, {target: 'fm', method: 'noteOff', args: [0]});
        input = dry.render(4096);
      } finally {dry.close();}
      const context = new OfflineAudioContext(2, 4096, 48000);
      const initialCommands = [];
      const fx = createNativeFXController(command => initialCommands.push(structuredClone(command)));
      fx.setChain([fx.delay({time: .01, mix: .25}), fx.reverb({mix: .15})]);
      const module = await WebAssembly.compile(await (await fetch('/vendor/native_audio_effect.wasm')).arrayBuffer());
      await context.audioWorklet.addModule('/vendor/native-fx-worklet.js');
      const node = new AudioWorkletNode(context, 'tetorica-native-fx', {numberOfInputs: 1,
        numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {module, initialCommands}});
      const buffer = context.createBuffer(2, 4096, 48000);
      buffer.copyToChannel(input.left, 0); buffer.copyToChannel(input.right, 1);
      const source = context.createBufferSource(); source.buffer = buffer;
      let timer;
      try {
        source.connect(node); node.connect(context.destination); source.start(0);
        const rendered = await Promise.race([context.startRendering(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('OfflineAudioContext rendering timed out after 10000 ms')), 10000);
          node.onprocessorerror = () => reject(new Error('Native FX AudioWorklet processor failed'));
        })]);
        return {left: [...pcm.left], right: [...pcm.right], workletLeft: [...rendered.getChannelData(0)], workletRight: [...rendered.getChannelData(1)]};
      } finally {
        clearTimeout(timer); node.onprocessorerror = null;
        source.disconnect(); node.disconnect(); node.port.close();
      }
    }), 'Browser offline PCM and AudioWorklet verification');
    const same = (actual, expected, label) => {
      checkPcm(actual, label);
      assert.equal(actual.length, expected.length, `${label}: PCM length differs from Node`);
      const index = actual.findIndex((value, i) => value !== expected[i]);
      assert.equal(index, -1, `${label}: first difference at ${index}: ${actual[index]} / ${expected[index]}`);
    };
    same(result.left, expected.left, 'browser left'); same(result.right, expected.right, 'browser right');
    same(result.workletLeft, expected.left, 'Worklet left'); same(result.workletRight, expected.right, 'Worklet right');
    assert.deepEqual(errors, []);
    console.log('PASS Node / browser offline PCM / actual nativeFX AudioWorklet: exact stereo match, local WASM loading, event clock and delay/reverb');
  } finally {
    try {await browser?.close();}
    finally {if (server.listening) await new Promise(resolve => server.close(resolve));}
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
