// Exercise an installed npm tarball, with no imports from the source checkout.
// Usage: node scripts/check_fm2612_dx7_browser.cjs /path/to/node_modules/tetorica-fm2612
const {chromium, webkit} = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

if (!process.argv[2]) throw Error('Pass the installed tetorica-fm2612 package directory');
const installed = path.resolve(process.argv[2]);
// Playwright page response events omit AudioWorklet module fetches on some engines.
const servedAssets = new Set();
const html = `<!doctype html><meta charset="utf-8"><button id="start">Initialize audio</button>
<script type="module">
import {Playground} from '/vendor/playground_runtime.js';
import {createInitVoice, createVoiceSysex} from '/vendor/msfa_dx7/src/sysex.js';
const logs = [], runtime = Playground({guardExecution:true, onLog:line => logs.push(line)});
window.test = {runtime, logs, sysex:Array.from(createVoiceSysex(createInitVoice('NPM SINE')))};
document.querySelector('#start').onclick = async () => {
  try {
    await runtime.initialize();
    const mega = runtime.megaDrive, context = mega.audioContext;
    const splitter = context.createChannelSplitter(2);
    const meters = [context.createAnalyser(), context.createAnalyser()];
    const silent = context.createGain(); silent.gain.value = 0; silent.connect(context.destination);
    for (let channel = 0; channel < 2; channel++) {
      meters[channel].fftSize = 2048;
      splitter.connect(meters[channel], channel); meters[channel].connect(silent);
    }
    const detach = mega.audio.connectOutputMonitor(splitter);
    Object.assign(window.test, {meters, splitter, silent, detach, ready:true});
  } catch (error) { window.test.error = String(error.stack || error); }
};
</script>`;

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/nested/consumer/index.html') {
      response.setHeader('Content-Type', 'text/html'); response.end(html); return;
    }
    if (!pathname.startsWith('/vendor/')) throw Error('Only installed package assets are served');
    const file = path.resolve(installed, pathname.slice('/vendor/'.length));
    if (!file.startsWith(installed + path.sep)) throw Error('Invalid package asset path');
    const body = await fs.readFile(file);
    servedAssets.add(pathname);
    response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.json') ? 'application/json' : 'text/javascript');
    response.end(body);
  } catch (error) { response.writeHead(404).end(String(error)); }
});

async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label} timed out`)), 30000);
    })]);
  } finally { clearTimeout(timer); }
}

async function checkBrowser(name, type, url) {
  const browser = await type.launch({headless:true});
  const results = [];
  try {
    for (const execution of ['main', 'worker']) {
      servedAssets.clear();
      const page = await browser.newPage({serviceWorkers:'block'});
      page.setDefaultTimeout(20000);
      const errors = [], unwantedRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      page.on('request', request => {
        if (new URL(request.url()).origin !== new URL(url).origin) unwantedRequests.push(request.url());
      });
      try {
        await page.goto(url);
        await page.waitForFunction(() => window.test);
        // The real click is required by WebKit's user-gesture audio policy.
        await page.click('#start');
        await page.waitForFunction(() => window.test.ready || window.test.error);
        assert.equal(await page.evaluate(() => window.test.error), undefined);
        let serial = 0;
        const run = async source => {
          const marker = `NPM_DX7_${++serial}:`;
          await bounded(page.evaluate(async ({source, execution, marker}) => {
            await window.test.runtime.playSource(source + `\nconsole.log(${JSON.stringify(marker)} + JSON.stringify(typeof result === 'undefined' ? {} : result));`, {execution});
          }, {source, execution, marker}), `${name}/${execution} Run`);
          return page.evaluate(marker => {
            const line = window.test.logs.find(line => line.includes(marker));
            if (!line) throw Error('Missing completed Run result: ' + marker);
            return JSON.parse(line.slice(line.indexOf(marker) + marker.length));
          }, marker);
        };
        const meter = async () => {
          await page.waitForTimeout(100);
          const frames = [];
          for (let i = 0; i < 3; i++) {
            frames.push(await page.evaluate(() => window.test.meters.map(meter => {
              const pcm = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(pcm);
              return Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
            })));
            await page.waitForTimeout(20);
          }
          return [0, 1].map(channel => frames.reduce((sum, frame) => sum + frame[channel], 0) / frames.length);
        };
        const initial = await run(`
          let guarded = false;
          try { await fetch('https://example.com/npm-dx7-forbidden'); }
          catch (error) { guarded = /Network access is disabled/.test(error.message); }
          if (!guarded) throw Error('Network execution guard is inactive');
          const dx7 = await useSoundChip('dx7');
          if (dx7 !== await useSoundChip('dx7')) throw Error('DX7 was not cached');
          dx7.noteOn(60, 100);
          context.dx7 = dx7;
          const result = {id:dx7.id, voices:dx7.voices, state:await dx7.getState()};
        `);
        assert.equal(initial.voices[0].name, 'INIT SINE');
        assert.equal(initial.state.internalSampleRate, 44100);
        assert([44100, 48000].includes(initial.state.sampleRate));
        const baseline = await meter();
        assert(baseline.every(value => value > .005), `${name}/${execution}: INIT SINE is silent ${baseline}`);
        assert(Math.abs(baseline[0] / baseline[1] - 1) < .08, 'DX7 stereo output differs');
        const sysex = await page.evaluate(() => window.test.sysex);
        const loaded = await run(`
          const dx7 = await useSoundChip('dx7'); dx7.panic();
          await dx7.loadSysex(new Uint8Array(${JSON.stringify(sysex)}));
          dx7.selectVoice(0); dx7.noteOn(67, 100);
          const result = {same:dx7 === context.dx7, voices:dx7.voices};
        `);
        assert.equal(loaded.same, true);
        assert.equal(loaded.voices[0].name, 'NPM SINE');
        const full = await meter();
        assert(full.every(value => value > .005), `${name}/${execution}: loaded SysEx is silent ${full}`);
        await run(`await mixer.set(context.dx7.id, {volume:.5});`);
        const half = await meter();
        assert(Math.abs(half[0] / full[0] - .5) < .06, `${name}/${execution}: mixer gain ${full} -> ${half}`);
        await run(`await mixer.set(context.dx7.id, {muted:true});`);
        assert((await meter()).every(value => value < .00001), `${name}/${execution}: mixer mute retained PCM`);
        await run(`await mixer.set(context.dx7.id, {muted:false, volume:1});`);
        await bounded(page.evaluate(() => window.test.runtime.stopWithFade()), 'STOP');
        const stopped = await meter();
        assert(stopped.every(value => value < .00001), `${name}/${execution}: STOP retained PCM ${stopped}`);
        const recreated = await run(`
          const dx7 = await useSoundChip('dx7'); dx7.noteOn(60, 100);
          const result = {id:dx7.id, voices:dx7.voices};
        `);
        assert.notEqual(recreated.id, initial.id);
        assert.equal(recreated.voices[0].name, 'INIT SINE');
        assert((await meter()).every(value => value > .005), `${name}/${execution}: Run after STOP is silent`);
        await bounded(page.evaluate(async () => {
          await window.test.runtime.stopWithFade();
          window.test.detach(); window.test.splitter.disconnect();
          window.test.meters.forEach(node => node.disconnect()); window.test.silent.disconnect();
          await window.test.runtime.finalize();
        }), 'Finalization');
        for (const asset of ['playground_dx7_worklet.js', 'msfa_dx7/src/index.js', 'msfa_dx7/wasm/msfa.wasm']) {
          assert(servedAssets.has('/vendor/' + asset), `${name}/${execution}: installed ${asset} was not loaded`);
        }
        if (execution === 'worker') assert(servedAssets.has('/vendor/playground_logic_worker.js'));
        assert.deepEqual(errors, [], `${name}/${execution}: browser errors`);
        assert.deepEqual(unwantedRequests, [], `${name}/${execution}: external network requests`);
        results.push({execution, sampleRate:initial.state.sampleRate, baseline, full, half, stopped});
      } finally { await page.close(); }
    }
    console.log(JSON.stringify({browser:name, passed:true, results}));
  } finally { await browser.close(); }
}

(async () => {
  const metadata = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.equal(metadata.name, 'tetorica-fm2612');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/nested/consumer/index.html`;
    await checkBrowser('chromium', chromium, url);
    await checkBrowser('webkit', webkit, url);
    console.log(`Installed tetorica-fm2612@${metadata.version}: DX7 Main/Worker, SysEx, final PCM, mixer and STOP/restart passed.`);
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
