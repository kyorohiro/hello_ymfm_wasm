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
          await page.route('**/synth/synth.js*', async route => {
            const response = await route.fetch();
            await route.fulfill({response, body: await response.text() + '\nwindow.__scopeTest = {ensureAudioReady, history: () => outputEnvelopeHistory.slice(), configure: options => megaSynth.setOutputEnvelopeOptions(options), port: () => megaSynth.node.port, fm: () => synth, audio: () => audioContext, loopBus: () => loopOutputBus, patch: () => ({...commonState}), snapshot: buildLooperPatchSnapshot, voices: () => structuredClone(voices)};'});
          });
          await page.goto(url + (engine === 'nuked' ? '?engine=nuked' : ''));
          await page.waitForFunction(() => !!window.__scopeTest);
          await page.waitForFunction(() => !document.getElementById('synthFileNewButton').disabled);
          await page.evaluate(() => {
            const wheel = document.getElementById('modulationWheel');
            wheel.value = '64'; wheel.dispatchEvent(new Event('input', {bubbles:true}));
          });
          await page.locator('#keyboard .key').first().click();
          await page.waitForFunction(() => /Audio ready|Error:/.test(document.getElementById('status').textContent));
          assert.match(await page.locator('#status').textContent(), /Audio ready/);
          let state = await page.evaluate(() => window.__scopeTest.fm().getState());
          assert.equal(state.lfo.enabled, true);
          assert(state.channels.every(channel => channel.pms === 4));
          assert.equal(await page.evaluate(() => window.__scopeTest.patch().pms), 0);
          assert.equal(await page.evaluate(() => window.__scopeTest.snapshot().pms), 4);
          assert.equal(await page.locator('#visualModulationWheel').inputValue(), '64');
          assert.equal(await page.locator('#visualModulationValue').textContent(), '50%');
          await page.locator('#visualModulationWheel').press('End');
          assert.equal(await page.locator('#modulationWheel').inputValue(), '127');
          assert.equal(await page.locator('#modulationValue').textContent(), '100%');
          assert((await page.evaluate(() => window.__scopeTest.fm().getState())).channels.every(channel => channel.pms === 7));
          await page.evaluate(() => {
            const wheel = document.getElementById('modulationWheel');
            wheel.value = '0'; wheel.dispatchEvent(new Event('input', {bubbles:true}));
          });
          state = await page.evaluate(() => window.__scopeTest.fm().getState());
          assert.equal(state.lfo.enabled, false);
          assert(state.channels.every(channel => channel.pms === 0));
          const fret = await page.locator('#fretDisplay').textContent();
          await page.locator('#modulationWheel').focus();
          await page.keyboard.press('ArrowUp');
          assert.equal(await page.locator('#fretDisplay').textContent(), fret);
          assert.equal(await page.locator('#modulationWheel').inputValue(), '1');
          await page.locator('#modulationWheel').press('End');
          state = await page.evaluate(() => window.__scopeTest.fm().getState());
          assert(state.channels.every(channel => channel.pms === 7));
          await page.locator('#modulationWheel').press('Home');
          for (const id of ['modulationWheel', 'visualModulationWheel']) {
            const wheel = page.locator(`#${id}`);
            await wheel.scrollIntoViewIfNeeded();
            const box = await wheel.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2, box.y + 8, {steps:5});
            assert(Number(await wheel.inputValue()) > 100, 'Pointer drag still adjusts modulation');
            assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-modulation-wheel]')), false);
            await page.keyboard.down('a');
            await page.waitForFunction(() => document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
            await page.keyboard.up('a');
            await page.waitForFunction(() => !document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
            await page.mouse.up();
            assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-modulation-wheel]')), false);
            // Tab/programmatic focus still permits accessible slider controls,
            // while letter keydown AND keyup continue to reach the instrument.
            await wheel.focus();
            await page.keyboard.down('a');
            await page.waitForFunction(() => document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
            await page.keyboard.up('a');
            await page.waitForFunction(() => !document.querySelector('#keyboard .key[data-key="a"]')?.classList.contains('is-active'));
            await wheel.press('Home');
          }
          for (const id of ['pitchBendWheel','visualPitchBendWheel']) {
            const bend = page.locator(`#${id}`);
            await bend.scrollIntoViewIfNeeded();
            await page.keyboard.down('a');
            await page.waitForFunction(() => window.__scopeTest.voices().some(voice => voice.key === 'a' && voice.held));
            const base = await page.evaluate(() => window.__scopeTest.voices().find(voice => voice.key === 'a' && voice.held));
            const box = await bend.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2, box.y + 5, {steps:5});
            assert(Number(await bend.inputValue()) > 900);
            assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-pitch-bend-wheel]')), false);
            const changed = (await page.evaluate(() => window.__scopeTest.fm().getState())).channels[base.channel];
            const ratio = changed.fnum * 2 ** changed.block / (base.basePitch.fnum * 2 ** base.basePitch.block);
            assert(Math.abs(ratio - 2 ** (2 / 12)) < .01, 'Held note bends up by two semitones');
            await page.keyboard.down('d');
            await page.waitForFunction(() => window.__scopeTest.voices().some(voice => voice.key === 'd' && voice.held));
            const second = await page.evaluate(() => window.__scopeTest.voices().find(voice => voice.key === 'd' && voice.held));
            const newNote = (await page.evaluate(() => window.__scopeTest.fm().getState())).channels[second.channel];
            assert(Math.abs(newNote.fnum * 2 ** newNote.block / (second.basePitch.fnum * 2 ** second.basePitch.block) - 2 ** (2 / 12)) < .01, 'New note inherits current bend');
            await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5, {steps:5});
            const lowered = (await page.evaluate(() => window.__scopeTest.fm().getState())).channels[base.channel];
            assert(Math.abs(lowered.fnum * 2 ** lowered.block / (base.basePitch.fnum * 2 ** base.basePitch.block) - 2 ** (-2 / 12)) < .01);
            await page.mouse.up();
            for (const wheelId of ['pitchBendWheel','visualPitchBendWheel']) assert.equal(await page.locator(`#${wheelId}`).inputValue(), '0');
            const restored = (await page.evaluate(() => window.__scopeTest.fm().getState())).channels[base.channel];
            assert.equal(restored.block, base.basePitch.block); assert.equal(restored.fnum, base.basePitch.fnum);
            await page.keyboard.up('a'); await page.keyboard.up('d');
          }
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
          await small.locator('#modulationWheel').press('End');
          assert.equal(await small.locator('#modulationValue').textContent(), '100%');
          assert.equal(await small.locator('#visualModulationWheel').inputValue(), '127');
          await small.locator('#visualModulationWheel').press('Home');
          assert.equal(await small.locator('#modulationWheel').inputValue(), '0');
          const chart = await small.locator('#synthEnvelopeEditor [data-operator-envelope]').boundingBox();
          const wheel = await small.locator('#visualModulationWheel').boundingBox();
          assert(chart && wheel, 'Envelope editor and display wheel are visible on narrow screens');
          assert(wheel.x >= chart.x + chart.width || wheel.y >= chart.y + chart.height,
            'Display wheel remains beside or below the full-width Envelope editor');
          await small.locator('#visualModulationWheel').scrollIntoViewIfNeeded();
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
