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
    if (url.pathname === '/pwm-example.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(await fs.readFile(path.resolve(__dirname, '../docs/playground/examples/genesis/32x-pwm-sine.js')));
      return;
    }
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
      const {MegaSynth} = await import('/vendor/megasynth.js');
      const {Playground} = await import('/vendor/playground_runtime.js');
      const {createSoundChip} = await import('/vendor/soundchip.js');
      const {PWM32XWorkletTransport} = await import('/vendor/pwm32x_transport.js');
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      window.result = null;
      document.querySelector('#play').onclick = async () => {
        try {
          const chip = await createSoundChip('pwm', {execution: 'worklet', gain: 1});
          const transport = new PWM32XWorkletTransport(chip);
          await transport.write(0, 5); await transport.write(1, 1047);
          await transport.write(4, 700); await transport.start();
          const analyser = chip.audioContext.createAnalyser(); chip.node.connect(analyser);
          await wait(100);
          const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
          if (Math.max(...data) < .3) throw Error('Factory PWM produced no PCM');
          if ((await transport.getState()).model !== 'mame') throw Error('Wrong core');
          await transport.stop(); await transport.start(); await transport.close(); analyser.disconnect();
          const mega = new MegaSynth({mega32X: true});
          await mega.start();
          if (!mega.pwm) throw Error('Missing MegaSynth PWM');
          await mega.pwm.write(0, 5); await mega.pwm.write(1, 1047); await mega.pwm.write(4, 700);
          const a = mega.audioContext.createAnalyser(); mega.masterInputNode.connect(a);
          await wait(100); const values = new Float32Array(a.fftSize); a.getFloatTimeDomainData(values);
          if (Math.max(...values) < .3) throw Error('MegaSynth PWM is not mixed');
          await mega.reset(); await wait(100); a.getFloatTimeDomainData(values);
          if (Math.max(...values.map(Math.abs)) > .001) throw Error('Reset retained PWM audio');
          const old = mega.pwm; await mega.close();
          await old.getState().then(() => {throw Error('Disposed client accepted command');}, () => {});
          await mega.start(); await mega.close(); a.disconnect();
          for (const execution of ['main', 'worker']) {
            const pg = Playground({execution});
            await pg.playSource(`const pwm = await useSoundChip('pwm');
              const state = await pwm.getState();
              if(state.model !== 'mame') throw Error('Wrong Playground core');
              await pwm.scheduleWrites([{frame:0,register:0,value:5},{frame:0,register:1,value:1047},{frame:32,register:4,value:700}]);
              await sleep(.04);
              if((await pwm.getState()).currentFrame <= state.currentFrame) throw Error('PWM did not advance');
              await pwm.reset();`);
            await pg.playSource(await (await fetch('/pwm-example.js')).text());
            await pg.stop(); await pg.finalize();
          }
          window.result = 'ok';
        } catch (e) {window.result = e.stack;}
      };
    });
    await page.click('#play');
    await page.waitForFunction(() => window.result !== null, null, {timeout:20000});
    const result = await page.evaluate(() => window.result);
    assert.equal(result, 'ok');
    assert.deepEqual(errors, []);
    console.log('PASS: PWM factory/Worklet transport, MegaSynth mix/reset/restart, Playground Main and Worker; no missing assets.');
  } finally { await browser?.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
