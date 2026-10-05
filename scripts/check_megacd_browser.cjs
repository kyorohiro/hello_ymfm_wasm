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
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
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
          const wait = () => new Promise(r => setTimeout(r, 120));
          const energy = analyser => {
            const data = new Float32Array(2048);
            analyser.getFloatTimeDomainData(data);
            return (Math.max(...data) - Math.min(...data)) / 2;
          };
          const wave = Float32Array.from({length:256}, (_,i) => Math.sin(i * 2 * Math.PI / 256));
          const sample = await cd.pcm.loadSample({channels:[wave], sampleRate:32768}, {loopStart:0});
          for (let ch = 0; ch < 8; ch++) {
            await cd.pcm.setChannel(ch, {...sample, volume:200, pan:{left:15,right:0}});
            await cd.pcm.keyOn(ch); await wait();
            if (energy(left) < .01 || energy(right) > .001) throw Error('PCM channel/pan ' + ch + ' ' + energy(left) + '/' + energy(right) + ' ' + cd.audioContext.state);
            await cd.pcm.keyOff(ch); await wait();
            if (energy(left) > .001) throw Error('PCM keyOff ' + ch);
          }
          await cd.pcm.setChannel(0, {pan:{left:0,right:15}});
          await cd.pcm.keyOn(0); await wait();
          if (energy(right) < .01 || energy(left) > .001) throw Error('PCM right pan');
          cd.fm.setPreset(0, FM_PRESETS.sine); cd.fm.noteOn(0,4,553);
          cd.psg.tone(0,{note:'C4',volume:.3}); await wait();
          if (energy(left) < .01 || energy(right) < .01) throw Error('Mixed FM/PSG/PCM output');
          await cd.reset();
          await cd.pcm.setChannel(0, {...sample, volume:200, pan:{left:0,right:15}});
          await cd.pcm.keyOn(0); await wait();
          if (energy(right) < .01) throw Error('PCM RAM lost on reset');
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
    await page.waitForFunction(() => window.result !== null, {timeout:20000});
    const result = await page.evaluate(() => window.result);
    assert.equal(result, 'ok');
    assert.deepEqual(errors, []);
    console.log('PASS: Mega CD 8 channels, L/R pan, keyOff, FM/PSG/PCM mixing, reset RAM, close/restart and Playground Worker; no missing assets.');
  } finally { await browser?.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
