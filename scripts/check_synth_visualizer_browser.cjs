const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const { chromium, webkit } = require(root + '/node_modules/playwright');
const docs = path.join(root, 'docs');
const server = http.createServer(async (req, res) => {
  try {
    const file = path.resolve(docs, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(docs + '/')) throw new Error('Invalid path');
    const types = {'.js':'text/javascript', '.wasm':'application/wasm', '.html':'text/html', '.json':'application/json'};
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/synth/index.html`;
  try {
    for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await type.launch({headless:true, ...(name === 'chromium' ? {args:['--autoplay-policy=no-user-gesture-required']} : {})});
      try {
        for (const engine of ['ymfm', 'nuked']) {
          const page = await browser.newPage();
          const errors = [];
          await page.addInitScript(() => {
            for (const [method, kind] of [['getFloatTimeDomainData','waveform'], ['getFloatFrequencyData','spectrum']]) {
              const original = AnalyserNode.prototype[method];
              AnalyserNode.prototype[method] = function (data) {
                original.call(this, data);
                window.__analysed = window.__analysed || {};
                window.__analysed[kind] = {peak: Math.max(...data), bin: data.indexOf(Math.max(...data)), rate: this.context.sampleRate};
              };
            }
          });
          page.on('pageerror', error => errors.push(error.message));
          page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
          await page.route('**/synth/synth.js', async route => {
            const response = await route.fetch();
            await route.fulfill({response, body: await response.text() + '\nwindow.__scopeTest = {ensureAudioReady, history: () => outputEnvelopeHistory.slice(), configure: options => megaSynth.setOutputEnvelopeOptions(options), port: () => megaSynth.node.port, fm: () => synth, audio: () => audioContext, loopBus: () => loopOutputBus};'});
          });
          await page.goto(url + (engine === 'nuked' ? '?engine=nuked' : ''));
          await page.waitForFunction(() => !!window.__scopeTest);
          await page.locator('#keyboard .key').first().click();
          await page.waitForFunction(() => /Audio ready|Error:/.test(document.getElementById('status').textContent));
          assert.match(await page.locator('#status').textContent(), /Audio ready/);
          const key = page.locator('#keyboard .key').first();
          await key.hover();
          await page.mouse.down();
          await page.waitForFunction(() => window.__scopeTest.history().some(value => value > .0001));
          const peak = await page.evaluate(() => Math.max(...window.__scopeTest.history()));
          await page.mouse.up();
          await page.locator('[data-visual-mode=waveform]').click();
          assert.equal(await page.locator('[data-visual-mode=waveform]').getAttribute('aria-pressed'), 'true');
          await page.evaluate(() => window.__scopeTest.fm().noteOn(0, 'A4'));
          await page.waitForFunction(() => window.__analysed?.waveform?.peak > .001);
          await page.evaluate(() => {
            const input = document.getElementById('masterVolumeRange');
            input.value = '0'; input.dispatchEvent(new Event('input', {bubbles:true}));
          });
          await page.waitForFunction(() => Math.abs(window.__analysed.waveform.peak) < .00001);
          await page.evaluate(() => {
            const input = document.getElementById('masterVolumeRange');
            input.value = '100'; input.dispatchEvent(new Event('input', {bubbles:true}));
          });
          await page.waitForFunction(() => window.__analysed.waveform.peak > .001);
          await page.locator('[data-visual-mode=spectrum]').click();
          await page.waitForFunction(() => window.__analysed?.spectrum?.peak > -80);
          // A looper-only test signal must also reach the final-output monitor.
          await page.evaluate(() => {
            window.__scopeTest.fm().noteOff(0);
            const oscillator = window.__scopeTest.audio().createOscillator();
            oscillator.frequency.value = 880;
            oscillator.connect(window.__scopeTest.loopBus());
            oscillator.start(); window.__loopSignal = oscillator;
          });
          await page.waitForFunction(() => {
            const capture = window.__analysed.spectrum;
            return Math.abs(capture.bin * capture.rate / 2048 - 880) < 35;
          });
          await page.screenshot({path:`/private/tmp/synth-spectrum-${name}-${engine}.png`});
          await page.evaluate(() => {window.__loopSignal.stop(); window.__loopSignal.disconnect();});
          await page.locator('[data-visual-mode=envelope]').click();
          assert.equal(await page.locator('[data-visual-mode=envelope]').getAttribute('aria-pressed'), 'true');
          await page.evaluate(() => window.__scopeTest.fm().noteOn(0, 'A4'));
          await page.waitForFunction(() => window.__scopeTest.history().some(value => value > .001));
          // Modes can be selected before audio starts and fit a narrow display.
          const small = await browser.newPage({viewport:{width:390,height:844}});
          await small.goto(url);
          for (const mode of ['waveform','spectrum','envelope']) {
            await small.locator(`[data-visual-mode=${mode}]`).click();
            assert.equal(await small.locator(`[data-visual-mode=${mode}]`).getAttribute('aria-pressed'), 'true');
          }
          await small.screenshot({path:`/private/tmp/synth-visualizer-mobile-${name}.png`});
          await small.close();
          assert.deepEqual(errors, []);
          console.log(JSON.stringify({browser:name, engine, envelopePeak:peak, passed:true}));
          await page.close();
        }
      } finally { await browser.close(); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
