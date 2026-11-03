// Run after build:fm2612. Requires Playwright with Chromium; optionally pass its module path.
const {chromium} = require(process.argv[2] || 'playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/fm2612');
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/vendor/')) {
      res.setHeader('Content-Type', 'text/html');
      res.end('<button id="play">Play</button>');
      return;
    }
    const file = path.join(root, url.pathname.slice('/vendor/'.length));
    res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    res.end(await fs.readFile(file));
  } catch (e) { res.statusCode = 404; res.end(e.message); }
});
(async () => {
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {server.off('error', reject); resolve();});
    });
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.goto(`http://127.0.0.1:${server.address().port}/deeply/nested/ebook/index.html`);
    await page.evaluate(async () => {
      const {createSoundChip} = await import('/vendor/soundchip.js');
      const chip = await createSoundChip('ym2151');
      try { if (chip.generateStereo(128).left.length !== 128) throw Error('PCM size'); }
      finally { chip.dispose(); }
      const {MegaSynth} = await import('/vendor/megasynth.js');
      const {FM_PRESETS} = await import('/vendor/megasynth-fm-presets.js');
      const {Playground} = await import('/vendor/playground_runtime.js');
      window.result = null;
      document.querySelector('#play').onclick = async () => {
        try {
          const mega = new MegaSynth();
          await mega.start();
          mega.fm.noteOn(0, 4, 553);
          await mega.close();
          const cd = new MegaSynth({megaCD: true});
          await cd.start();
          if (!cd.pcm || !cd.psg) throw Error('Mega CD devices missing');
          const splitter = cd.audioContext.createChannelSplitter(2);
          const left = cd.audioContext.createAnalyser(), right = cd.audioContext.createAnalyser();
          left.fftSize = right.fftSize = 2048;
          cd.masterOutputNode.connect(splitter);
          splitter.connect(left, 0); splitter.connect(right, 1);
          const silent = cd.audioContext.createGain(); silent.gain.value = 0;
          left.connect(silent); right.connect(silent); silent.connect(cd.audioContext.destination);
          const energy = analyser => {
            const data = new Float32Array(2048);
            analyser.getFloatTimeDomainData(data);
            return (Math.max(...data) - Math.min(...data)) / 2;
          };
          // RPC acknowledgements do not imply that the audio renderer has run.
          // Wait for two fresh analyser windows and the expected signal, with
          // a deadline so a stalled or silent graph still fails the check.
          const waitForOutput = async (label, matches) => {
            const before = cd.audioContext.currentTime, started = performance.now();
            const windowSeconds = 2 * left.fftSize / cd.audioContext.sampleRate;
            let levels;
            while (performance.now() - started < 5000) {
              await new Promise(resolve => setTimeout(resolve, 20));
              levels = {left:energy(left), right:energy(right)};
              if (cd.audioContext.currentTime - before >= windowSeconds && matches(levels)) return;
            }
            throw Error(label + ' ' + JSON.stringify({...levels,state:cd.audioContext.state,before,after:cd.audioContext.currentTime,mixer:cd.mixer.list()}));
          };
          const wave = Float32Array.from({length:256}, (_,i) => Math.sin(i * 2 * Math.PI / 256));
          const sample = await cd.pcm.loadSample({channels:[wave], sampleRate:32768}, {loopStart:0});
          for (let ch = 0; ch < 8; ch++) {
            await cd.pcm.setChannel(ch, {...sample, volume:200, pan:{left:15,right:0}});
            await cd.pcm.keyOn(ch);
            await waitForOutput('PCM channel/pan ' + ch, ({left,right}) => left >= .01 && right <= .001);
            await cd.pcm.keyOff(ch);
            await waitForOutput('PCM keyOff ' + ch, ({left,right}) => left <= .001 && right <= .001);
          }
          await cd.pcm.setChannel(0, {pan:{left:0,right:15}});
          await cd.pcm.keyOn(0);
          await waitForOutput('PCM right pan', ({left,right}) => right >= .01 && left <= .001);
          cd.fm.setPreset(0, FM_PRESETS.sine); cd.fm.noteOn(0,4,553);
          cd.psg.tone(0,{note:'C4',volume:.3});
          await waitForOutput('Mixed FM/PSG/PCM output', ({left,right}) => left >= .01 && right >= .01);
          await cd.reset();
          await cd.pcm.setChannel(0, {...sample, volume:200, pan:{left:0,right:15}});
          await cd.pcm.keyOn(0);
          await waitForOutput('PCM RAM lost on reset', ({left,right}) => right >= .01 && left <= .001);
          const old = cd.pcm;
          await cd.close();
          if (cd.pcm !== null) throw Error('PCM retained after close');
          await old.keyOn(0).then(() => {throw Error('Disposed client accepted command');}, () => {});
          await cd.start(); await cd.close();
          splitter.disconnect();
          const pg = Playground({execution: 'worker'});
          await pg.playSource('fm.setPreset(0, FM_PRESETS.sine); fm.noteOn(0, 4, 553); await sleep(0.02); fm.noteOff(0);');
          await pg.stop();
          await pg.finalize();
          window.result = 'ok';
        } catch (e) { window.result = e.stack; }
      };
    });
    await page.click('#play');
    await page.waitForFunction(() => window.result !== null, undefined, {timeout:30000});
    const result = await page.evaluate(() => window.result);
    assert.equal(result, 'ok');
    assert.deepEqual(errors, []);
    console.log('PASS: Mega CD 8 channels, L/R pan, keyOff, FM/PSG/PCM mixing, reset RAM, close/restart and Playground Worker; no missing assets.');
  } finally {
    try {await browser?.close();}
    finally {if (server.listening) await new Promise(resolve => server.close(resolve));}
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
